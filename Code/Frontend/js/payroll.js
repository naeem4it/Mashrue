/**
 * ============================================================================
 * MASHRUE ENTERPRISE PAYROLL APPLICATION — FRONTEND CONTROLLER
 * ============================================================================
 * Complete, independently sellable Payroll UI Suite covering:
 *  1. Dashboard, Calendar Periods & Integration Status
 *  2. Standalone Employee Payroll Profiles (+ optional HRM sync)
 *  3. Payroll Run Processing (Draft -> Adjust -> Preview -> Approve -> Finalize -> Reverse)
 *  4. Payslips (Print via TemplatesEngine) & Payment Batches (with Retry handling)
 *  5. Employee Loans, Advances & Repayments
 *  6. Configurable Components, Tax Jurisdictions/Slabs & Payroll Settings
 *  7. Year-to-Date (YTD) Reports & Year-End Closing
 *  8. Immutable Payroll Audit Trail
 * ============================================================================
 */

window.PayrollModule = {
  activeTab: 'dashboard',
  _cache: {
    employees: [],
    runs: [],
    periods: [],
    components: [],
    jurisdictions: [],
    loans: [],
    batches: [],
    settings: null
  },

  async api(endpoint, method = 'GET', body = null) {
    try {
      const base = typeof API_BASE !== 'undefined' ? API_BASE : '/api';
      const opts = {
        method,
        headers: typeof API !== 'undefined' && API.getHeaders ? API.getHeaders() : { 'Content-Type': 'application/json' }
      };
      if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
        opts.body = JSON.stringify(body);
      }
      const res = await fetch(`${base}/payroll${endpoint}`, opts);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      }
      return json;
    } catch (err) {
      if (typeof showToast === 'function' && method !== 'GET') {
        showToast(`Payroll Error: ${err.message}`, 'error');
      }
      return { success: false, message: err.message, data: null };
    }
  },

  switchTab(tab) {
    this.activeTab = tab;
    const viewMap = {
      'dashboard': 'payroll',
      'employees': 'payroll-employees',
      'runs': 'payroll-runs',
      'payments': 'payroll-payments',
      'loans': 'payroll-loans',
      'config': 'payroll-config',
      'reports': 'payroll-reports',
      'audit': 'payroll-audit'
    };
    const nextView = viewMap[tab] || 'payroll';
    if (typeof switchView === 'function' && typeof State !== 'undefined' && State.activeView !== nextView) {
      switchView(nextView);
    } else if (typeof renderActiveView === 'function') {
      renderActiveView();
    }
  },

  fmt(n) {
    if (typeof formatCurrency === 'function') return formatCurrency(n || 0);
    return `PKR ${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  esc(s) {
    if (typeof escapeHtml === 'function') return escapeHtml(String(s ?? ''));
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  fdate(d) {
    if (!d) return '—';
    if (typeof formatDateDDMMYYYY === 'function') return formatDateDDMMYYYY(d);
    return String(d).slice(0, 10);
  },

  modal(title, html, width = '780px') {
    if (window.ModularERP && typeof ModularERP.showDynamicModal === 'function') {
      ModularERP.showDynamicModal(title, html, width);
    } else {
      alert(title);
    }
  },

  closeModal() {
    if (typeof closeModal === 'function') closeModal('modal-erp-dynamic');
  },

  async preloadLookups() {
    const [empRes, runRes, perRes, compRes, jurRes, loanRes, batchRes, setRes] = await Promise.all([
      this.api('/employees'),
      this.api('/runs'),
      this.api('/periods'),
      this.api('/components'),
      this.api('/tax-jurisdictions'),
      this.api('/loans'),
      this.api('/payment-batches'),
      this.api('/settings')
    ]);
    this._cache.employees = empRes.data || [];
    this._cache.runs = runRes.data || [];
    this._cache.periods = perRes.data || [];
    this._cache.components = compRes.data || [];
    this._cache.jurisdictions = jurRes.data || [];
    this._cache.loans = loanRes.data || [];
    this._cache.batches = batchRes.data || [];
    this._cache.settings = setRes.data || {};
  },

  // ==========================================================================
  // MASTER SHELL
  // ==========================================================================
  async renderHTML() {
    await this.preloadLookups();

    const tabs = [
      { key: 'dashboard', label: '📊 Dashboard & Periods' },
      { key: 'employees', label: '👥 Payroll Employees' },
      { key: 'runs', label: '🧮 Process Payroll Runs' },
      { key: 'payments', label: '💵 Payslips & Payments' },
      { key: 'loans', label: '🏦 Loans & Advances' },
      { key: 'config', label: '⚙️ Components, Tax & Config' },
      { key: 'reports', label: '📈 YTD & Year-End' },
      { key: 'audit', label: '🛡️ Audit History' }
    ];

    let bodyHtml = '';
    if (this.activeTab === 'dashboard') bodyHtml = await this.renderDashboardTab();
    else if (this.activeTab === 'employees') bodyHtml = await this.renderEmployeesTab();
    else if (this.activeTab === 'runs') bodyHtml = await this.renderRunsTab();
    else if (this.activeTab === 'payments') bodyHtml = await this.renderPaymentsTab();
    else if (this.activeTab === 'loans') bodyHtml = await this.renderLoansTab();
    else if (this.activeTab === 'config') bodyHtml = await this.renderConfigTab();
    else if (this.activeTab === 'reports') bodyHtml = await this.renderReportsTab();
    else if (this.activeTab === 'audit') bodyHtml = await this.renderAuditTab();

    return `<div id="payroll-tab-content">${bodyHtml}</div>`;
  },

  // ==========================================================================
  // 1. DASHBOARD & CALENDAR PERIODS
  // ==========================================================================
  async renderDashboardTab() {
    const res = await this.api('/dashboard');
    const d = res.data || {};
    const k = d.kpis || {};
    const ints = d.integrations || {};
    const periods = d.periods || [];

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px; padding:12px 16px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:10px;">
        <div style="font-size:0.82rem; color:#334155;">
          <strong>HRM Integration:</strong> <span class="badge ${ints.hrm_available ? 'badge-won' : 'badge-submitted'}">${ints.hrm_available ? 'Connected (Attendance/Leaves Active)' : 'Standalone Payroll Profiles Mode'}</span>
          <strong style="margin-left:12px;">Finance GL Integration:</strong> <span class="badge ${ints.finance_available ? 'badge-won' : 'badge-submitted'}">${ints.finance_available ? 'Connected (Liabilities & Payouts Posted)' : 'Standalone (No GL Posting)'}</span>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="secondary-btn" onclick="PayrollModule.openAddEmployeeModal()">👥 + Payroll Employee</button>
          <button class="primary-btn" onclick="PayrollModule.openCreateRunModal()">🧮 + New Draft Payroll Run</button>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:18px;">
        <div class="kpi-card">
          <div class="kpi-label">👥 Active Payroll Staff</div>
          <div class="kpi-value" style="color:#0284c7;">${k.active_employees || 0}</div>
          <div class="kpi-trend">Independent & Synced Profiles</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">💰 YTD Finalized Gross</div>
          <div class="kpi-value" style="color:#0f172a;">${this.fmt(k.ytd_gross)}</div>
          <div class="kpi-trend">YTD Net: ${this.fmt(k.ytd_net)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">🏛️ YTD Tax Withheld</div>
          <div class="kpi-value" style="color:#dc2626;">${this.fmt(k.ytd_tax)}</div>
          <div class="kpi-trend">Jurisdiction-Configured Rules</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">🏦 Open Loans / Advances</div>
          <div class="kpi-value" style="color:#d97706;">${this.fmt(k.open_loans_balance)}</div>
          <div class="kpi-trend">${k.open_loans_count || 0} Active Recoveries</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:1rem;">📅 Payroll Calendar & Periods</h3>
          <button class="secondary-btn" style="padding:4px 10px; font-size:0.78rem;" onclick="PayrollModule.openNewPeriodModal()">+ Create Period</button>
        </div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Period</th><th>Frequency</th><th>Start – End</th><th>Pay Date</th><th>Status</th><th style="text-align:center;">Action</th></tr></thead>
          <tbody>${periods.map(p => `
            <tr>
              <td style="font-weight:700;">${this.esc(p.period_name)}</td>
              <td>${this.esc(p.pay_frequency)}</td>
              <td>${this.fdate(p.start_date)} to ${this.fdate(p.end_date)}</td>
              <td>${this.fdate(p.pay_date)}</td>
              <td><span class="badge ${p.status === 'Open' ? 'badge-won' : (p.status === 'Closed' ? 'badge-lost' : 'badge-submitted')}">${this.esc(p.status)}</span></td>
              <td style="text-align:center;">
                ${p.status === 'Open' ? `<button class="secondary-btn" style="padding:2px 8px; font-size:0.72rem;" onclick="PayrollModule.setPeriodStatus('${p.id}', 'Closed')">Close Period</button>` : `<button class="secondary-btn" style="padding:2px 8px; font-size:0.72rem;" onclick="PayrollModule.setPeriodStatus('${p.id}', 'Open')">Reopen</button>`}
              </td>
            </tr>
          `).join('')}</tbody>
        </table></div>
      </div>
    `;
  },

  openNewPeriodModal() {
    const now = new Date();
    this.modal('📅 Create Payroll Calendar Period', `
      <form onsubmit="event.preventDefault(); PayrollModule.submitNewPeriod();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Year *</label><input type="number" class="form-input" id="pay-per-yr" value="${now.getFullYear()}" required></div>
          <div class="form-group"><label class="form-label">Month (1–12) *</label><input type="number" min="1" max="12" class="form-input" id="pay-per-mo" value="${now.getMonth() + 1}" required></div>
          <div class="form-group"><label class="form-label">Working Days</label><input type="number" class="form-input" id="pay-per-days" value="30"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="PayrollModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Create Period</button></div>
      </form>
    `);
  },

  async submitNewPeriod() {
    const res = await this.api('/periods', 'POST', {
      period_year: parseInt(document.getElementById('pay-per-yr').value, 10),
      period_month: parseInt(document.getElementById('pay-per-mo').value, 10),
      working_days: parseInt(document.getElementById('pay-per-days').value || 30, 10)
    });
    if (res.success) { this.closeModal(); showToast('✓ Period created.', 'success'); renderActiveView(); }
  },

  async setPeriodStatus(id, status) {
    const res = await this.api(`/periods/${id}/status`, 'POST', { status });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 2. EMPLOYEE PAYROLL PROFILES (Standalone + Optional HRM Sync)
  // ==========================================================================
  async renderEmployeesTab() {
    const emps = this._cache.employees || [];
    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1rem;">👥 Employee Payroll Profiles</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Maintain payroll-only employees directly OR sync from HRM when active</p>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="secondary-btn" onclick="PayrollModule.syncFromHrm()">🔄 Sync from HRM</button>
            <button class="primary-btn" onclick="PayrollModule.openAddEmployeeModal()">➕ Add Payroll Employee</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;"><div class="table-responsive"><table class="data-table">
          <thead><tr><th>Code</th><th>Employee Name</th><th>Dept / Role</th><th>Tax Jur.</th><th style="text-align:right;">Basic</th><th style="text-align:right;">Gross Salary</th><th>Payment & Bank</th><th>Status</th></tr></thead>
          <tbody>
            ${emps.length === 0 ? `<tr><td colspan="8" style="text-align:center; padding:22px; color:#64748b;">No payroll employees yet. Click <strong>+ Add Payroll Employee</strong> or <strong>Sync from HRM</strong>.</td></tr>` : emps.map(e => `
              <tr>
                <td style="font-family:monospace; font-weight:700; color:#0284c7;">${this.esc(e.employee_code)}</td>
                <td><strong>${this.esc(e.full_name)}</strong><br><span style="font-size:0.72rem; color:#64748b;">Hired: ${this.fdate(e.hire_date)}</span></td>
                <td>${this.esc(e.department)}<br><span style="font-size:0.72rem; color:#64748b;">${this.esc(e.designation)}</span></td>
                <td><span class="badge">${this.esc(e.tax_jurisdiction_code || 'PK-FBR')}${e.tax_exempt ? ' (Exempt)' : ''}</span></td>
                <td style="text-align:right; font-family:monospace;">${this.fmt(e.basic_salary)}</td>
                <td style="text-align:right; font-family:monospace; font-weight:800; color:#059669;">${this.fmt(e.gross_salary)}</td>
                <td style="font-size:0.76rem;">${this.esc(e.payment_method)}<br>${this.esc(e.bank_name || '')} ${this.esc(e.bank_iban || '')}</td>
                <td><span class="badge ${e.status === 'Active' ? 'badge-won' : 'badge-lost'}">${this.esc(e.status)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table></div></div>
      </div>
    `;
  },

  openAddEmployeeModal() {
    const jOpts = (this._cache.jurisdictions || []).map(j => `<option value="${this.esc(j.jurisdiction_code)}">${this.esc(j.jurisdiction_code)} — ${this.esc(j.jurisdiction_name)}</option>`).join('');
    this.modal('👥 Add Standalone Employee Payroll Profile', `
      <form onsubmit="event.preventDefault(); PayrollModule.submitEmployeeForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Employee Code *</label><input class="form-input" id="pay-emp-code" required value="EMP-${Date.now().toString().slice(-4)}"></div>
          <div class="form-group"><label class="form-label">Full Name *</label><input class="form-input" id="pay-emp-name" required placeholder="Ayesha Siddiqui"></div>
          <div class="form-group"><label class="form-label">Hire Date *</label><input type="date" class="form-input" id="pay-emp-hire" required value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Department</label><input class="form-input" id="pay-emp-dept" value="Operations"></div>
          <div class="form-group"><label class="form-label">Designation</label><input class="form-input" id="pay-emp-desig" value="Executive"></div>
          <div class="form-group"><label class="form-label">Tax Jurisdiction</label><select class="form-select" id="pay-emp-jur">${jOpts}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Basic Salary *</label><input type="number" step="0.01" class="form-input" id="pay-emp-basic" required value="80000"></div>
          <div class="form-group"><label class="form-label">House Rent</label><input type="number" step="0.01" class="form-input" id="pay-emp-hra" value="24000"></div>
          <div class="form-group"><label class="form-label">Medical</label><input type="number" step="0.01" class="form-input" id="pay-emp-med" value="8000"></div>
          <div class="form-group"><label class="form-label">Conveyance</label><input type="number" step="0.01" class="form-input" id="pay-emp-conv" value="5000"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Payment Method</label><select class="form-select" id="pay-emp-pmeth"><option value="Bank Transfer">Bank Transfer</option><option value="Cash">Cash</option><option value="Cheque">Cheque</option></select></div>
          <div class="form-group"><label class="form-label">Bank Name</label><input class="form-input" id="pay-emp-bank" placeholder="Meezan Bank"></div>
          <div class="form-group"><label class="form-label">IBAN / Account #</label><input class="form-input" id="pay-emp-iban" placeholder="PK00MEZN0000..."></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="PayrollModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Save Payroll Profile</button></div>
      </form>
    `, '820px');
  },

  async submitEmployeeForm() {
    const res = await this.api('/employees', 'POST', {
      employee_code: document.getElementById('pay-emp-code').value,
      full_name: document.getElementById('pay-emp-name').value,
      hire_date: document.getElementById('pay-emp-hire').value,
      department: document.getElementById('pay-emp-dept').value,
      designation: document.getElementById('pay-emp-desig').value,
      tax_jurisdiction_code: document.getElementById('pay-emp-jur').value,
      basic_salary: parseFloat(document.getElementById('pay-emp-basic').value || 0),
      house_rent_allowance: parseFloat(document.getElementById('pay-emp-hra').value || 0),
      medical_allowance: parseFloat(document.getElementById('pay-emp-med').value || 0),
      conveyance_allowance: parseFloat(document.getElementById('pay-emp-conv').value || 0),
      payment_method: document.getElementById('pay-emp-pmeth').value,
      bank_name: document.getElementById('pay-emp-bank').value,
      bank_iban: document.getElementById('pay-emp-iban').value
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  async syncFromHrm() {
    const res = await this.api('/employees/sync-hrm', 'POST', {});
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 3. PAYROLL RUN PROCESSING (Draft -> Preview -> Approve -> Finalize -> Reverse)
  // ==========================================================================
  async renderRunsTab() {
    const runs = this._cache.runs || [];
    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h3 style="margin:0; font-size:1rem;">🧮 Payroll Runs & Approval Queue</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Draft runs allow adjustments & previews without posting to Finance. Only Finalized runs lock & post liabilities.</p>
          </div>
          <button class="primary-btn" onclick="PayrollModule.openCreateRunModal()">🧮 + Create Draft Run</button>
        </div>
        <div class="card-body" style="padding:0;"><div class="table-responsive"><table class="data-table">
          <thead><tr><th>Run #</th><th>Period</th><th>Staff</th><th style="text-align:right;">Gross</th><th style="text-align:right;">Deductions</th><th style="text-align:right;">Net Payable</th><th>Status</th><th style="text-align:center;">Workflow</th></tr></thead>
          <tbody>
            ${runs.length === 0 ? `<tr><td colspan="8" style="text-align:center; padding:22px; color:#64748b;">No payroll runs created yet.</td></tr>` : runs.map(r => `
              <tr>
                <td style="font-family:monospace; font-weight:800; color:#0284c7;">${this.esc(r.run_number || r.id.slice(0, 8))}</td>
                <td style="font-weight:700;">${r.payroll_month}/${r.payroll_year}</td>
                <td>${r.total_employees} staff</td>
                <td style="text-align:right; font-family:monospace;">${this.fmt(r.total_gross)}</td>
                <td style="text-align:right; font-family:monospace; color:#dc2626;">${this.fmt(r.total_deductions)}</td>
                <td style="text-align:right; font-family:monospace; font-weight:800; color:#059669;">${this.fmt(r.total_net_payable)}</td>
                <td><span class="badge ${r.is_finalized && !r.is_reversed ? 'badge-won' : (r.is_reversed ? 'badge-lost' : 'badge-submitted')}">${this.esc(r.status)}${r.gl_posted ? ' 🔗GL' : ''}</span></td>
                <td style="text-align:center; white-space:nowrap;">
                  <button class="secondary-btn" style="padding:3px 8px; font-size:0.72rem;" onclick="PayrollModule.openRunPreview('${r.id}')">🔍 Review (${(r.payslips || []).length})</button>
                  ${r.status === 'Draft' ? `<button class="primary-btn" style="padding:3px 8px; font-size:0.72rem;" onclick="PayrollModule.runAction('${r.id}', 'approve')">Approve</button>` : ''}
                  ${r.status === 'Approved' && !r.is_finalized ? `<button class="primary-btn" style="padding:3px 8px; font-size:0.72rem; background:#059669;" onclick="PayrollModule.runAction('${r.id}', 'finalize')">🔒 Finalize</button>` : ''}
                  ${r.is_finalized && !r.is_reversed ? `<button class="secondary-btn" style="padding:3px 8px; font-size:0.72rem; color:#dc2626;" onclick="PayrollModule.reverseRunPrompt('${r.id}', '${this.esc(r.run_number || '')}')">↩ Reverse</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div></div>
      </div>
    `;
  },

  openCreateRunModal() {
    const now = new Date();
    this.modal('🧮 Create Draft Payroll Run', `
      <form onsubmit="event.preventDefault(); PayrollModule.submitCreateRun();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Year *</label><input type="number" class="form-input" id="pay-run-yr" value="${now.getFullYear()}" required></div>
          <div class="form-group"><label class="form-label">Month (1–12) *</label><input type="number" min="1" max="12" class="form-input" id="pay-run-mo" value="${now.getMonth() + 1}" required></div>
        </div>
        <div style="font-size:0.82rem; color:#475569; padding:10px; background:#eff6ff; border-radius:6px; margin-bottom:12px;">
          ℹ️ Calculates prorated salaries, HRM unpaid leave/overtime (if connected), configured tax slabs, and active loan recoveries into a Draft preview.
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="PayrollModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Calculate Draft Payroll</button></div>
      </form>
    `);
  },

  async submitCreateRun() {
    const res = await this.api('/runs', 'POST', {
      payroll_year: parseInt(document.getElementById('pay-run-yr').value, 10),
      payroll_month: parseInt(document.getElementById('pay-run-mo').value, 10)
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  async runAction(id, action) {
    const res = await this.api(`/runs/${id}/${action}`, 'POST', {});
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  async reverseRunPrompt(id, runNo) {
    const reason = prompt(`Enter reversal reason for finalized run ${runNo}:`, 'Correction adjustment');
    if (!reason) return;
    const res = await this.api(`/runs/${id}/reverse`, 'POST', { reason });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  openRunPreview(runId) {
    const run = (this._cache.runs || []).find(r => r.id === runId);
    if (!run) return;
    const slips = run.payslips || [];
    const editable = !run.is_finalized && run.status !== 'Reversed';

    this.modal(`🔍 Payroll Preview: ${run.run_number || ''} (${run.status})`, `
      <div style="display:flex; justify-content:space-between; background:#f8fafc; padding:10px 14px; border-radius:8px; margin-bottom:12px; font-size:0.84rem;">
        <div>Gross: <strong>${this.fmt(run.total_gross)}</strong></div>
        <div>Tax + Ded: <strong style="color:#dc2626;">${this.fmt(run.total_deductions)}</strong></div>
        <div>Net Payable: <strong style="color:#059669;">${this.fmt(run.total_net_payable)}</strong></div>
      </div>
      <div class="table-responsive" style="max-height:380px; overflow-y:auto;">
        <table class="data-table">
          <thead><tr><th>Employee</th><th style="text-align:right;">Worked Days</th><th style="text-align:right;">Gross</th><th style="text-align:right;">Tax</th><th style="text-align:right;">Loans</th><th style="text-align:right;">Net</th><th>Alerts</th><th style="text-align:center;">Action</th></tr></thead>
          <tbody>${slips.map(s => `
            <tr>
              <td><strong>${this.esc(s.full_name)}</strong><br><span style="font-size:0.72rem; color:#64748b;">${this.esc(s.employee_code)}</span></td>
              <td style="text-align:right;">${s.worked_days || 30}</td>
              <td style="text-align:right; font-family:monospace;">${this.fmt(s.gross_salary)}</td>
              <td style="text-align:right; font-family:monospace;">${this.fmt(s.income_tax_deduction)}</td>
              <td style="text-align:right; font-family:monospace;">${this.fmt(s.loan_deduction || 0)}</td>
              <td style="text-align:right; font-family:monospace; font-weight:700; color:#059669;">${this.fmt(s.net_salary)}</td>
              <td>${(s.exceptions || []).map(ex => `<div style="font-size:0.7rem; color:#d97706;">⚠ ${this.esc(ex.code)}</div>`).join('') || '✓ OK'}</td>
              <td style="text-align:center;">
                ${editable ? `<button class="secondary-btn" style="padding:2px 6px; font-size:0.7rem;" onclick="PayrollModule.adjustSlipPrompt('${run.id}', '${s.id}', '${this.esc(s.full_name)}')">Adjust</button>` : ''}
                <button class="secondary-btn" style="padding:2px 6px; font-size:0.7rem;" onclick='if(window.TemplatesEngine?.printPayslip) TemplatesEngine.printPayslip(${JSON.stringify(s).replace(/'/g, "&#39;")}, "${run.payroll_month}/${run.payroll_year}");'>🖨️</button>
              </td>
            </tr>
          `).join('')}</tbody>
        </table>
      </div>
    `, '940px');
  },

  async adjustSlipPrompt(runId, slipId, name) {
    const bonus = prompt(`Enter bonus amount (PKR) for ${name} (or 0):`, '0');
    if (bonus === null) return;
    const ot = prompt(`Enter overtime hours for ${name} (or 0):`, '0');
    const res = await this.api(`/runs/${runId}/payslips/${slipId}`, 'PUT', {
      bonus_amount: parseFloat(bonus || 0),
      overtime_hours: parseFloat(ot || 0)
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 4. PAYSLIPS & PAYMENT BATCHES TAB
  // ==========================================================================
  async renderPaymentsTab() {
    const finalizedRuns = (this._cache.runs || []).filter(r => r.is_finalized && !r.is_reversed);
    const batches = this._cache.batches || [];

    return `
      <div class="card" style="margin-bottom:18px;">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:1rem;">💵 Payroll Payment Batches (Bank / Cash Disbursements)</h3>
          <button class="primary-btn" onclick="PayrollModule.openCreateBatchModal()">💳 + Stage Payment Batch</button>
        </div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Batch #</th><th>Payroll Run</th><th>Method</th><th style="text-align:right;">Total</th><th>Paid / Failed</th><th>Status</th><th style="text-align:center;">Action</th></tr></thead>
          <tbody>
            ${batches.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:20px;">No payment batches staged yet. Finalize a payroll run first.</td></tr>` : batches.map(b => `
              <tr>
                <td style="font-family:monospace; font-weight:700; color:#0284c7;">${this.esc(b.batch_number)}</td>
                <td>${this.esc(b.run_number)}</td>
                <td>${this.esc(b.payment_method)}</td>
                <td style="text-align:right; font-weight:700;">${this.fmt(b.total_amount)}</td>
                <td>${b.paid_count || 0} paid / ${b.failed_count || 0} failed</td>
                <td><span class="badge ${b.status === 'Completed' ? 'badge-won' : (b.status === 'Failed' ? 'badge-lost' : 'badge-submitted')}">${this.esc(b.status)}</span></td>
                <td style="text-align:center;">
                  ${b.status !== 'Completed' ? `<button class="primary-btn" style="padding:3px 9px; font-size:0.74rem;" onclick="PayrollModule.confirmBatch('${b.id}')">✓ Confirm Transfer</button>` : '✓ Settled'}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>

      <div class="card">
        <div class="card-header"><h4 style="margin:0;">🧾 Finalized Payslips Register</h4></div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Payslip #</th><th>Run</th><th>Employee</th><th style="text-align:right;">Net Salary</th><th>Payment Status</th><th style="text-align:center;">Print</th></tr></thead>
          <tbody>
            ${finalizedRuns.flatMap(r => (r.payslips || []).map(s => `
              <tr>
                <td style="font-family:monospace; font-weight:700;">${this.esc(s.payslip_number || s.id.slice(0, 8))}</td>
                <td>${this.esc(r.run_number)}</td>
                <td>${this.esc(s.full_name)}</td>
                <td style="text-align:right; font-weight:700;">${this.fmt(s.net_salary)}</td>
                <td><span class="badge ${s.payment_status === 'Paid' ? 'badge-won' : (s.payment_status === 'Failed' ? 'badge-lost' : 'badge-submitted')}">${this.esc(s.payment_status || 'Unpaid')}</span></td>
                <td style="text-align:center;"><button class="secondary-btn" style="padding:2px 8px; font-size:0.74rem;" onclick='if(window.TemplatesEngine?.printPayslip) TemplatesEngine.printPayslip(${JSON.stringify(s).replace(/'/g, "&#39;")}, "${r.payroll_month}/${r.payroll_year}");'>🖨️ Payslip</button></td>
              </tr>
            `)).join('') || `<tr><td colspan="6" style="text-align:center; padding:18px;">No finalized payslips yet.</td></tr>`}
          </tbody>
        </table></div>
      </div>
    `;
  },

  openCreateBatchModal() {
    const finRuns = (this._cache.runs || []).filter(r => r.is_finalized && !r.is_reversed);
    if (finRuns.length === 0) { showToast('Finalize a payroll run before staging payments.', 'error'); return; }
    const rOpts = finRuns.map(r => `<option value="${r.id}">${this.esc(r.run_number)} (${r.payroll_month}/${r.payroll_year}) — ${this.fmt(r.total_net_payable)}</option>`).join('');
    this.modal('💳 Stage Payroll Payment Batch', `
      <form onsubmit="event.preventDefault(); PayrollModule.submitCreateBatch();">
        <div class="form-group"><label class="form-label">Finalized Payroll Run *</label><select class="form-select" id="pay-bat-run">${rOpts}</select></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Method</label><select class="form-select" id="pay-bat-meth"><option value="Bank Transfer">Bank Transfer</option><option value="Cash">Cash</option><option value="Cheque">Cheque</option></select></div>
          <div class="form-group"><label class="form-label">Payment Date</label><input type="date" class="form-input" id="pay-bat-date" value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="PayrollModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Stage Batch</button></div>
      </form>
    `);
  },

  async submitCreateBatch() {
    const res = await this.api('/payment-batches', 'POST', {
      payroll_run_id: document.getElementById('pay-bat-run').value,
      payment_method: document.getElementById('pay-bat-meth').value,
      payment_date: document.getElementById('pay-bat-date').value
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  async confirmBatch(id) {
    const res = await this.api(`/payment-batches/${id}/process`, 'POST', {});
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 5. LOANS & ADVANCES TAB
  // ==========================================================================
  async renderLoansTab() {
    const loans = this._cache.loans || [];
    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:1rem;">🏦 Employee Loans & Salary Advances</h3>
          <button class="primary-btn" onclick="PayrollModule.openLoanModal()">➕ Issue Loan / Advance</button>
        </div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Loan #</th><th>Employee</th><th>Type</th><th style="text-align:right;">Principal</th><th style="text-align:right;">Installment</th><th style="text-align:right;">Repaid</th><th style="text-align:right;">Remaining</th><th>Status</th></tr></thead>
          <tbody>
            ${loans.length === 0 ? `<tr><td colspan="8" style="text-align:center; padding:20px;">No employee loans or advances recorded.</td></tr>` : loans.map(l => `
              <tr>
                <td style="font-family:monospace; font-weight:700;">${this.esc(l.loan_number)}</td>
                <td><strong>${this.esc(l.full_name)}</strong> (${this.esc(l.employee_code)})</td>
                <td>${this.esc(l.loan_type)}</td>
                <td style="text-align:right;">${this.fmt(l.principal_amount)}</td>
                <td style="text-align:right;">${this.fmt(l.installment_amount)}</td>
                <td style="text-align:right; color:#059669;">${this.fmt(l.total_repaid)}</td>
                <td style="text-align:right; font-weight:800;">${this.fmt(l.remaining_balance)}</td>
                <td><span class="badge ${l.status === 'Closed' ? 'badge-won' : 'badge-submitted'}">${this.esc(l.status)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table></div>
      </div>
    `;
  },

  openLoanModal() {
    const eOpts = (this._cache.employees || []).map(e => `<option value="${e.id}">[${this.esc(e.employee_code)}] ${this.esc(e.full_name)}</option>`).join('');
    this.modal('🏦 Issue Employee Loan or Salary Advance', `
      <form onsubmit="event.preventDefault(); PayrollModule.submitLoanForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Employee *</label><select class="form-select" id="pay-ln-emp" required>${eOpts}</select></div>
          <div class="form-group"><label class="form-label">Type</label><select class="form-select" id="pay-ln-type"><option value="Salary Advance">Salary Advance</option><option value="Employee Loan">Employee Loan</option></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Principal Amount *</label><input type="number" step="0.01" class="form-input" id="pay-ln-prin" required></div>
          <div class="form-group"><label class="form-label">Monthly Installment *</label><input type="number" step="0.01" class="form-input" id="pay-ln-inst" required></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="PayrollModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Approve & Activate</button></div>
      </form>
    `);
  },

  async submitLoanForm() {
    const res = await this.api('/loans', 'POST', {
      payroll_profile_id: document.getElementById('pay-ln-emp').value,
      loan_type: document.getElementById('pay-ln-type').value,
      principal_amount: parseFloat(document.getElementById('pay-ln-prin').value || 0),
      installment_amount: parseFloat(document.getElementById('pay-ln-inst').value || 0)
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 6. COMPONENTS, TAX JURISDICTIONS & PAYROLL SETTINGS
  // ==========================================================================
  async renderConfigTab() {
    const s = this._cache.settings || {};
    const comps = this._cache.components || [];
    const jurs = this._cache.jurisdictions || [];

    return `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:start; margin-bottom:18px;">
        <div class="card" style="padding:18px;">
          <h3 style="margin-top:0;">⚙️ Payroll Settings & Integrations</h3>
          <form onsubmit="event.preventDefault(); PayrollModule.saveSettings();">
            <div class="form-row">
              <div class="form-group"><label class="form-label">Currency</label><input class="form-input" id="pay-set-curr" value="${this.esc(s.default_currency || 'PKR')}"></div>
              <div class="form-group"><label class="form-label">Working Days/Mo</label><input type="number" class="form-input" id="pay-set-days" value="${s.working_days_per_month || 30}"></div>
              <div class="form-group"><label class="form-label">OT Multiplier</label><input type="number" step="0.1" class="form-input" id="pay-set-ot" value="${s.overtime_multiplier || 1.5}"></div>
            </div>
            <div style="display:grid; gap:8px; margin:12px 0; font-size:0.85rem;">
              <label><input type="checkbox" id="pay-set-reqapp" ${s.require_run_approval !== false ? 'checked' : ''}> Require Approval Before Finalization</label>
              <label><input type="checkbox" id="pay-set-hrm" ${s.enable_hrm_integration !== false ? 'checked' : ''}> Enable HRM Sync (Attendance & Unpaid Leave)</label>
              <label><input type="checkbox" id="pay-set-fin" ${s.enable_finance_posting !== false ? 'checked' : ''}> Post Finalized Liabilities & Payouts to Finance</label>
            </div>
            <button type="submit" class="primary-btn">💾 Save Payroll Config</button>
          </form>
        </div>

        <div class="card">
          <div class="card-header"><h3 style="margin:0; font-size:1rem;">🏛️ Configurable Tax Jurisdictions</h3></div>
          <div class="card-body" style="padding:0;"><table class="data-table">
            <thead><tr><th>Code</th><th>Jurisdiction</th><th>Slabs</th></tr></thead>
            <tbody>${jurs.map(j => `<tr><td style="font-family:monospace; font-weight:700;">${this.esc(j.jurisdiction_code)}</td><td>${this.esc(j.jurisdiction_name)}</td><td>${(j.slabs || []).length} slabs</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 style="margin:0; font-size:1rem;">🧩 Salary Components & Statutory Deductions</h3></div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Code</th><th>Component Name</th><th>Type</th><th>Calculation</th><th style="text-align:right;">Default Value</th><th>Taxable</th><th>COA</th></tr></thead>
          <tbody>${comps.map(c => `<tr><td style="font-family:monospace; font-weight:700;">${this.esc(c.component_code)}</td><td>${this.esc(c.component_name)}</td><td><span class="badge">${this.esc(c.component_type)}</span></td><td>${this.esc(c.calc_type)}</td><td style="text-align:right;">${c.default_value}</td><td>${c.is_taxable ? 'Yes' : 'Exempt'}</td><td>${this.esc(c.coa_account_code || '—')}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    `;
  },

  async saveSettings() {
    const res = await this.api('/settings', 'PUT', {
      default_currency: document.getElementById('pay-set-curr').value,
      working_days_per_month: parseInt(document.getElementById('pay-set-days').value || 30, 10),
      overtime_multiplier: parseFloat(document.getElementById('pay-set-ot').value || 1.5),
      require_run_approval: document.getElementById('pay-set-reqapp').checked,
      enable_hrm_integration: document.getElementById('pay-set-hrm').checked,
      enable_finance_posting: document.getElementById('pay-set-fin').checked
    });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 7. YTD & YEAR-END REPORTS TAB
  // ==========================================================================
  async renderReportsTab() {
    const curYear = new Date().getFullYear();
    const res = await this.api(`/reports/ytd?year=${curYear}`);
    const emps = res.data?.employees || [];

    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:1rem;">📈 Year-to-Date (YTD ${curYear}) Payroll Summary</h3>
          <button class="secondary-btn" style="color:#dc2626; border-color:#fecaca;" onclick="PayrollModule.closeYearPrompt(${curYear})">🔒 Close Tax Year ${curYear}</button>
        </div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Code</th><th>Employee</th><th style="text-align:right;">Payslips</th><th style="text-align:right;">YTD Gross</th><th style="text-align:right;">YTD Tax</th><th style="text-align:right;">YTD Employer Cost</th><th style="text-align:right;">YTD Net Pay</th></tr></thead>
          <tbody>${emps.map(e => `<tr><td style="font-family:monospace;">${this.esc(e.employee_code)}</td><td style="font-weight:600;">${this.esc(e.full_name)}</td><td style="text-align:right;">${e.payslip_count}</td><td style="text-align:right;">${this.fmt(e.ytd_gross)}</td><td style="text-align:right; color:#dc2626;">${this.fmt(e.ytd_tax)}</td><td style="text-align:right;">${this.fmt(e.ytd_employer_cost)}</td><td style="text-align:right; font-weight:700; color:#059669;">${this.fmt(e.ytd_net)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    `;
  },

  async closeYearPrompt(year) {
    if (!confirm(`Close Payroll Tax Year ${year}? All ${year} periods will be locked.`)) return;
    const res = await this.api('/year-end/close', 'POST', { tax_year: year });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 8. AUDIT HISTORY TAB
  // ==========================================================================
  async renderAuditTab() {
    const res = await this.api('/audit-logs');
    const logs = res.data || [];
    return `
      <div class="card">
        <div class="card-header"><h3 style="margin:0; font-size:1rem;">🛡️ Sensitive Payroll Audit Trail</h3></div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Timestamp</th><th>User</th><th>Entity</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>${logs.map(l => `<tr><td style="font-size:0.78rem;">${this.fdate(l.created_at)}</td><td>${this.esc(l.user_name)}</td><td>${this.esc(l.entity_type)}</td><td><span class="badge">${this.esc(l.action)}</span></td><td style="font-size:0.74rem; color:#475569;">${this.esc(JSON.stringify(l.details || {}))}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    `;
  }
};

