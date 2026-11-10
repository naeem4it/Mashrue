/**
 * ============================================================================
 * MASHRUE TAXGUARD ENTERPRISE FRONTEND (Frontend/js/tax-compliance.js)
 * ============================================================================
 * Features:
 *  - Period-Scoped Annex-C (Output) & Annex-A (Input) Return Compiler
 *  - Filing Lock & Revised/Amended Workflow + Safe CSV Export (Formula Guard)
 *  - STATL Active Taxpayer List (ATL) Bulk Filer Verifier Modal
 *  - WHT u/s 153 CPR Certificate Ledger (Create, Edit/Verify, Delete)
 *  - Configurable Federal & Provincial Jurisdictions + WHT Rate Rules
 * ============================================================================
 */

const TaxComplianceModule = {
  _tab: 'returns',
  _cache: { jurisdictions: [], whtRules: [], cprs: [], returns: [] },

  async api(path, method = 'GET', body = null) {
    try {
      const base = typeof API_BASE !== 'undefined' ? API_BASE : '/api';
      const opts = {
        method,
        headers: typeof API !== 'undefined' && API.getHeaders ? API.getHeaders() : { 'Content-Type': 'application/json' }
      };
      if (body && (method === 'POST' || method === 'PUT')) opts.body = JSON.stringify(body);
      const r = await fetch(`${base}/tax-compliance${path}`, opts);
      return await r.json();
    } catch (e) {
      return { success: false, message: e.message, data: [] };
    }
  },

  csvCell(val) {
    let s = String(val === null || val === undefined ? '' : val);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  },

  switchTab(t) {
    this._tab = t;
    const viewMap = {
      'returns': 'tax-compliance',
      'cprs': 'tax-cpr-ledger',
      'rules': 'tax-jurisdictions'
    };
    const nextView = viewMap[t] || 'tax-compliance';
    if (typeof switchView === 'function' && typeof State !== 'undefined' && State.activeView !== nextView) {
      switchView(nextView);
    } else if (typeof renderActiveView === 'function') {
      renderActiveView();
    }
  },

  async renderHTML() {
    const [jurRes, whtRes, cprRes, retRes] = await Promise.all([
      this.api('/jurisdictions'),
      this.api('/withholding-rules'),
      this.api('/cpr-deductions'),
      this.api('/returns')
    ]);
    const jurisdictions = jurRes.data || [];
    const whtRules = whtRes.data || [];
    const cprs = cprRes.data || [];
    const returns = retRes.data || [];
    this._cache = { jurisdictions, whtRules, cprs, returns };

    const totalWht = cprs.reduce((s, c) => s + parseFloat(c.wht_amount || 0), 0);
    const now = new Date();

    const tabBtn = (id, label) => `
      <button class="secondary-btn" style="border:none; border-bottom:3px solid ${this._tab === id ? '#0284c7' : 'transparent'}; border-radius:0; font-weight:700; color:${this._tab === id ? '#0284c7' : '#64748b'}; background:transparent; padding:8px 14px;" onclick="TaxComplianceModule.switchTab('${id}')">${label}</button>
    `;

    return `
      <div class="kpi-grid" style="margin-bottom:16px;">
        <div class="kpi-card">
          <div class="kpi-label">Active Authorities</div>
          <div class="kpi-value" style="color:#0284c7;">${jurisdictions.length} Authorities</div>
          <div class="kpi-trend positive">FBR, PRA, SRB, KPRA, BRA</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">WHT u/s 153 CPR Ledger</div>
          <div class="kpi-value" style="color:#059669;">${formatCurrency(totalWht)}</div>
          <div class="kpi-trend">${cprs.length} Certificates Logged</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Monthly Tax Returns</div>
          <div class="kpi-value" style="color:#7c3aed;">${returns.length} Periods</div>
          <div class="kpi-trend">${returns.filter(r => r.filing_status === 'Filed').length} Filed & Locked</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">ATL Taxpayer Verification</div>
          <div class="kpi-value" style="color:#d97706;">STATL Bulk</div>
          <div class="kpi-trend"><button class="secondary-btn" style="padding:2px 8px; font-size:0.75rem;" onclick="ModularERP.openStatlBulkVerifierModal()">Run ATL Scan Now</button></div>
        </div>
      </div>

      ${this._tab === 'returns' ? `
      <div style="display:flex; justify-content:flex-end; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:8px;">
        <div style="display:flex; gap:8px; align-items:center;">
          <select id="tg-month" class="form-select" style="width:95px; padding:4px 8px; font-size:0.8rem;">
            ${[1,2,3,4,5,6,7,8,9,10,11,12].map(m => `<option value="${m}" ${m === (now.getMonth() + 1) ? 'selected' : ''}>Month ${m}</option>`).join('')}
          </select>
          <input id="tg-year" type="number" class="form-input" style="width:82px; padding:4px 8px; font-size:0.8rem;" value="${now.getFullYear()}">
          <select id="tg-jur" class="form-select" style="width:110px; padding:4px 8px; font-size:0.8rem;">
            ${(jurisdictions.length ? jurisdictions : [{ jurisdiction_code: 'FBR_FED' }]).map(j => `<option value="${escapeHtml(j.jurisdiction_code)}">${escapeHtml(j.jurisdiction_code)}</option>`).join('')}
          </select>
          <button class="primary-btn" style="background:#059669;" onclick="TaxComplianceModule.compileSelectedPeriod()">Compile Return</button>
        </div>
      </div>` : ''}

      ${this.renderTab()}
    `;
  },

  renderTab() {
    if (this._tab === 'cprs') return this.renderCprsTab();
    if (this._tab === 'rules') return this.renderRulesTab();
    return this.renderReturnsTab();
  },

  renderReturnsTab() {
    const returns = this._cache.returns || [];
    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:800;">FBR Iris Monthly Sales Tax Returns (Annex-C Output & Annex-A Input)</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Strictly scoped by invoice & bill tax period; Filed returns lock automatically against overwrite.</p>
          </div>
          <button class="secondary-btn" onclick="ModularERP.openStatlBulkVerifierModal()">Verify Customers & Suppliers ATL</button>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Period</th><th>Jurisdiction</th><th style="text-align:right;">Sales Value</th>
                  <th style="text-align:right;">Output Tax</th><th style="text-align:right;">Input Tax</th>
                  <th style="text-align:right;">Net Payable</th><th>Status</th><th style="text-align:center;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${returns.length === 0 ? `<tr><td colspan="8" style="text-align:center; padding:22px; color:#64748b;">Select period above and click Compile Return.</td></tr>` : returns.map((r, idx) => `
                  <tr>
                    <td style="font-weight:800;">${r.tax_month}/${r.tax_year}</td>
                    <td><span class="badge">${escapeHtml(r.jurisdiction_code)}</span></td>
                    <td style="text-align:right; font-family:monospace;">${formatCurrency(r.total_sales_value)}</td>
                    <td style="text-align:right; font-family:monospace; color:#dc2626;">${formatCurrency(r.total_output_tax)}</td>
                    <td style="text-align:right; font-family:monospace; color:#059669;">${formatCurrency(r.total_input_tax)}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:800;">${formatCurrency(r.net_tax_payable)}</td>
                    <td><span class="badge ${r.filing_status === 'Filed' ? 'badge-won' : 'badge-submitted'}">${escapeHtml(r.filing_status)}</span></td>
                    <td style="text-align:center; white-space:nowrap;">
                      <button class="secondary-btn" style="padding:3px 8px; font-size:0.74rem;" onclick="TaxComplianceModule.exportCsv(${idx}, 'annexC')">Annex-C</button>
                      <button class="secondary-btn" style="padding:3px 8px; font-size:0.74rem;" onclick="TaxComplianceModule.exportCsv(${idx}, 'annexA')">Annex-A</button>
                      ${r.filing_status !== 'Filed' ? `<button class="primary-btn" style="padding:3px 8px; font-size:0.74rem; background:#059669;" onclick="TaxComplianceModule.markFiled('${r.id}')">Mark Filed</button>` : ''}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  renderCprsTab() {
    const cprs = this._cache.cprs || [];
    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:1.05rem; font-weight:800;">Withholding Tax u/s 153 & Bank CPR Registry</h3>
          <button class="primary-btn" onclick="TaxComplianceModule.openCprModal()">+ Log CPR Certificate</button>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr><th>CPR # & Date</th><th>Party / Agency</th><th>Section</th><th style="text-align:right;">Taxable</th><th style="text-align:right;">WHT Amount</th><th>Status</th><th style="text-align:center;">Action</th></tr>
              </thead>
              <tbody>
                ${cprs.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:22px; color:#64748b;">No WHT CPR certificates recorded.</td></tr>` : cprs.map(c => `
                  <tr>
                    <td><strong>${escapeHtml(c.cpr_number)}</strong><div style="font-size:0.73rem; color:#64748b;">${formatDateDDMMYYYY(c.cpr_date)}</div></td>
                    <td>${escapeHtml(c.party_name || c.customer_name || 'Procuring Agency')}</td>
                    <td><span class="badge">${escapeHtml(c.section_code)}</span></td>
                    <td style="text-align:right; font-family:monospace;">${formatCurrency(c.taxable_amount)}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:800; color:#059669;">${formatCurrency(c.wht_amount)}</td>
                    <td><span class="badge ${String(c.status).includes('Verified') ? 'badge-won' : 'badge-submitted'}">${escapeHtml(c.status)}</span></td>
                    <td style="text-align:center;">
                      <button class="edit-btn" style="padding:3px 8px; font-size:0.74rem;" onclick="TaxComplianceModule.openCprModal('${c.id}')">Edit</button>
                      <button class="delete-btn" style="padding:3px 8px; font-size:0.74rem;" onclick="TaxComplianceModule.deleteCpr('${c.id}')">Del</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  renderRulesTab() {
    const jurs = this._cache.jurisdictions || [];
    const rules = this._cache.whtRules || [];
    return `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px;">
        <div class="card">
          <div class="card-header"><h3 style="margin:0; font-size:1rem; font-weight:800;">Tax Jurisdictions & Rates</h3></div>
          <div class="card-body" style="padding:0;">
            <table class="data-table">
              <thead><tr><th>Code</th><th>Authority</th><th style="text-align:right;">Std %</th><th style="text-align:right;">Further %</th><th style="text-align:center;">Edit</th></tr></thead>
              <tbody>
                ${jurs.map(j => `
                  <tr>
                    <td style="font-weight:700;">${escapeHtml(j.jurisdiction_code)}</td>
                    <td>${escapeHtml(j.authority_name)}</td>
                    <td style="text-align:right; font-family:monospace;">${j.standard_rate}%</td>
                    <td style="text-align:right; font-family:monospace;">${j.further_tax_rate || 0}%</td>
                    <td style="text-align:center;"><button class="edit-btn" style="padding:2px 8px; font-size:0.74rem;" onclick="TaxComplianceModule.editJurisdiction('${j.id}','${escapeHtml(j.jurisdiction_code)}',${j.standard_rate},${j.further_tax_rate || 0})">Rate</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 style="margin:0; font-size:1rem; font-weight:800;">Section 153 WHT Slabs</h3></div>
          <div class="card-body" style="padding:0;">
            <table class="data-table">
              <thead><tr><th>Section</th><th style="text-align:right;">Filer %</th><th style="text-align:right;">Non-Filer %</th></tr></thead>
              <tbody>
                ${rules.map(w => `
                  <tr>
                    <td style="font-weight:700;">${escapeHtml(w.section_code)}</td>
                    <td style="text-align:right; font-family:monospace; color:#059669;">${w.filer_rate}%</td>
                    <td style="text-align:right; font-family:monospace; color:#dc2626;">${w.non_filer_rate}%</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  async compileSelectedPeriod(amend = false) {
    const tax_month = parseInt(document.getElementById('tg-month')?.value || (new Date().getMonth() + 1), 10);
    const tax_year = parseInt(document.getElementById('tg-year')?.value || new Date().getFullYear(), 10);
    const jurisdiction_code = document.getElementById('tg-jur')?.value || 'FBR_FED';
    const res = await this.api('/returns/compile', 'POST', { tax_month, tax_year, jurisdiction_code, amend });
    if (res && res.success) {
      showToast(res.message || 'Return compiled!', 'success');
      renderActiveView();
    } else if (res.message && res.message.includes('already Filed')) {
      if (confirm(res.message + ' Proceed to file an Amendment?')) {
        return this.compileSelectedPeriod(true);
      }
    } else {
      showToast(res.message || 'Compile failed.', 'error');
    }
  },

  async markFiled(id) {
    const ack = prompt('Enter FBR Iris Acknowledgement Number (optional):', `IRIS-${Date.now().toString().slice(-6)}`);
    if (ack === null) return;
    const res = await this.api(`/returns/${id}/file`, 'POST', { iris_acknowledgement_number: ack });
    if (res && res.success) {
      showToast(res.message || 'Marked Filed & Locked.', 'success');
      renderActiveView();
    } else {
      showToast(res.message || 'Failed.', 'error');
    }
  },

  exportCsv(idx, type = 'annexC') {
    const ret = (this._cache.returns || [])[idx];
    if (!ret) return;
    const rows = type === 'annexC' ? (ret.annex_c_json || []) : (ret.annex_a_json || []);
    let lines = [];
    if (type === 'annexC') {
      lines.push(['Invoice No', 'Date', 'FBR Invoice No', 'Buyer Name', 'Buyer NTN', 'Buyer STRN', 'Tax Rate %', 'Value Excl Tax', 'Sales Tax', 'Total Value'].map(c => this.csvCell(c)).join(','));
      rows.forEach(r => lines.push([r.invoice_no, r.invoice_date, r.fbr_invoice_no, r.buyer_name, r.buyer_ntn, r.buyer_strn, r.tax_rate, r.value_excl_tax, r.sales_tax_amount, r.total_value].map(c => this.csvCell(c)).join(',')));
    } else {
      lines.push(['Document No', 'Date', 'Source', 'Supplier Name', 'Supplier NTN', 'Value Excl Tax', 'Input Tax'].map(c => this.csvCell(c)).join(','));
      rows.forEach(r => lines.push([r.document_no, r.document_date, r.source_type, r.supplier_name, r.supplier_ntn, r.value_excl_tax, r.input_tax_amount].map(c => this.csvCell(c)).join(',')));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `TaxGuard_${type}_${ret.tax_year}_${ret.tax_month}.csv`;
    a.click();
    showToast(`${type} CSV exported safely.`, 'success');
  },

  openCprModal(cprId = null) {
    const c = cprId ? (this._cache.cprs || []).find(x => String(x.id) === String(cprId)) || {} : {};
    ModularERP.showDynamicModal(cprId ? 'Edit / Verify CPR Certificate' : 'Log WHT u/s 153 CPR Certificate', `
      <form onsubmit="event.preventDefault(); TaxComplianceModule.saveCpr('${cprId || ''}');">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Deducting Agency / Party *</label><input type="text" class="form-input" id="tg-cpr-party" required value="${escapeHtml(c.party_name || '')}"></div>
          <div class="form-group"><label class="form-label">Section *</label><input type="text" class="form-input" id="tg-cpr-sec" required value="${escapeHtml(c.section_code || '153(1)(a) Goods')}"></div>
        </div>
        <div class="form-row-3">
          <div class="form-group"><label class="form-label">Taxable Base</label><input type="number" class="form-input" id="tg-cpr-base" value="${c.taxable_amount || 1000000}" min="1" required></div>
          <div class="form-group"><label class="form-label">Rate %</label><input type="number" step="0.1" class="form-input" id="tg-cpr-rate" value="${c.wht_rate || 5}" required></div>
          <div class="form-group"><label class="form-label">CPR Number *</label><input type="text" class="form-input" id="tg-cpr-no" required value="${escapeHtml(c.cpr_number || `CPR-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`)}"></div>
        </div>
        <div class="form-group">
          <label class="form-label">Verification Status</label>
          <select class="form-select" id="tg-cpr-status">
            <option value="Verified / CPR Attached" ${String(c.status).includes('Verified') ? 'selected' : ''}>Verified / CPR Attached</option>
            <option value="Pending CPR" ${c.status === 'Pending CPR' ? 'selected' : ''}>Pending CPR</option>
          </select>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">Save CPR</button>
        </div>
      </form>
    `);
  },

  async saveCpr(cprId) {
    const base = parseFloat(document.getElementById('tg-cpr-base')?.value || 0);
    const rate = parseFloat(document.getElementById('tg-cpr-rate')?.value || 5);
    const payload = {
      party_name: document.getElementById('tg-cpr-party')?.value,
      section_code: document.getElementById('tg-cpr-sec')?.value,
      taxable_amount: base,
      wht_rate: rate,
      wht_amount: Math.round((base * rate) / 100),
      cpr_number: document.getElementById('tg-cpr-no')?.value,
      status: document.getElementById('tg-cpr-status')?.value
    };
    const res = await this.api(cprId ? `/cpr-deductions/${cprId}` : '/cpr-deductions', cprId ? 'PUT' : 'POST', payload);
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('CPR saved.', 'success');
      renderActiveView();
    } else {
      showToast(res.message || 'Save failed.', 'error');
    }
  },

  async deleteCpr(id) {
    if (!confirm('Delete this CPR record?')) return;
    const base = typeof API_BASE !== 'undefined' ? API_BASE : '/api';
    await fetch(`${base}/tax-compliance/cpr-deductions/${id}`, {
      method: 'DELETE',
      headers: typeof API !== 'undefined' && API.getHeaders ? API.getHeaders() : {}
    });
    showToast('CPR removed.', 'success');
    renderActiveView();
  },

  async editJurisdiction(id, code, curStd, curFur) {
    const std = prompt(`Standard Tax Rate (%) for ${code}:`, curStd);
    if (std === null) return;
    const fur = prompt(`Further Tax Rate (%) for Non-Filers (${code}):`, curFur);
    if (fur === null) return;
    const res = await this.api(`/jurisdictions/${id}`, 'PUT', {
      standard_rate: parseFloat(std),
      further_tax_rate: parseFloat(fur)
    });
    if (res && res.success) {
      showToast(`${code} rates updated.`, 'success');
      renderActiveView();
    }
  }
};

window.TaxComplianceModule = TaxComplianceModule;

