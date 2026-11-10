/**
 * ============================================================================
 * MASHRUE ENTERPRISE FINANCIAL MANAGEMENT SUITE — FRONTEND CONTROLLER
 * ============================================================================
 * Complete, independently usable Financial Accounting Workspace covering:
 *  1. Financial Dashboard & KPIs
 *  2. Chart of Accounts (COA) & Account Ledger Drill-Down
 *  3. Double-Entry Journals (Draft, Approve, Post, Reverse, Multi-line Editor)
 *  4. Accounts Receivable (Standalone Invoices, Credit Notes, Receipts & Allocations, Aging, Statements)
 *  5. Accounts Payable (Supplier Bills, Duplicate Check, Credit Notes, Payments, Aging, Statements)
 *  6. Cash & Bank Accounts, Transfers & Bank Reconciliation
 *  7. Expenses, Approvals & Budgets vs. Actual
 *  8. Configurable Tax Codes, Tax Calculator & Tax Summary Report
 *  9. Fixed Assets Register, Depreciation Runs & Disposals
 * 10. Financial Statements (P&L Comparative, Balance Sheet, Indirect Cash Flow, Trial Balance)
 * 11. Company Accounting Config, Fiscal Periods, Multi-Currency & Integrations
 * 12. Immutable Audit Trail & Automated Posting Events Monitor
 * ============================================================================
 */

window.FinanceModule = {
  activeTab: 'dashboard',
  arSubTab: 'invoices',
  apSubTab: 'bills',
  bankSubTab: 'accounts',
  stmtSubTab: 'pnl',
  _cache: {
    coa: [],
    settings: null,
    bankAccounts: [],
    customers: [],
    suppliers: [],
    taxCodes: []
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
      const res = await fetch(`${base}/finance${endpoint}`, opts);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      }
      return json;
    } catch (err) {
      if (typeof showToast === 'function' && method !== 'GET') {
        showToast(`Finance Error: ${err.message}`, 'error');
      }
      return { success: false, message: err.message, data: null };
    }
  },

  switchTab(tab) {
    this.activeTab = tab;
    const viewMap = {
      'dashboard': 'accounting',
      'coa': 'finance-coa',
      'journals': 'finance-journals',
      'ar': 'finance-ar',
      'ap': 'finance-ap',
      'banking': 'finance-banking',
      'expenses': 'finance-expenses',
      'tax': 'finance-tax',
      'assets': 'finance-assets',
      'statements': 'finance-statements',
      'settings': 'finance-settings',
      'audit': 'finance-audit'
    };
    const nextView = viewMap[tab] || 'accounting';
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

  modal(title, html, width = '740px') {
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
    const base = typeof API_BASE !== 'undefined' ? API_BASE : '/api';
    const headers = typeof API !== 'undefined' && API.getHeaders ? API.getHeaders() : {};
    const [coaRes, bankRes, taxRes, custRes, supRes] = await Promise.all([
      this.api('/coa'),
      this.api('/bank-accounts'),
      this.api('/tax-codes'),
      fetch(`${base}/masters/customers`, { headers }).then(r => r.json()).catch(() => ({ data: [] })),
      fetch(`${base}/masters/suppliers`, { headers }).then(r => r.json()).catch(() => ({ data: [] }))
    ]);
    this._cache.coa = coaRes.data || [];
    this._cache.bankAccounts = bankRes.data || [];
    this._cache.taxCodes = taxRes.data || [];
    this._cache.customers = custRes.data || [];
    this._cache.suppliers = supRes.data || [];
  },

  // ==========================================================================
  // MASTER SHELL RENDERER
  // ==========================================================================
  async renderHTML() {
    await this.preloadLookups();

    const tabs = [
      { key: 'dashboard', label: '📊 Dashboard' },
      { key: 'coa', label: '📒 Chart of Accounts' },
      { key: 'journals', label: '📝 Journals & GL' },
      { key: 'ar', label: '🧾 Receivables (AR)' },
      { key: 'ap', label: '📥 Payables (AP)' },
      { key: 'banking', label: '🏦 Cash & Bank' },
      { key: 'expenses', label: '💳 Expenses & Budgets' },
      { key: 'tax', label: '🏛️ Tax Setup' },
      { key: 'assets', label: '🏗️ Fixed Assets' },
      { key: 'statements', label: '📈 Statements' },
      { key: 'settings', label: '⚙️ Periods & Config' },
      { key: 'audit', label: '🛡️ Audit & Events' }
    ];

    let bodyHtml = '';
    if (this.activeTab === 'dashboard') bodyHtml = await this.renderDashboardTab();
    else if (this.activeTab === 'coa') bodyHtml = await this.renderCoaTab();
    else if (this.activeTab === 'journals') bodyHtml = await this.renderJournalsTab();
    else if (this.activeTab === 'ar') bodyHtml = await this.renderArTab();
    else if (this.activeTab === 'ap') bodyHtml = await this.renderApTab();
    else if (this.activeTab === 'banking') bodyHtml = await this.renderBankingTab();
    else if (this.activeTab === 'expenses') bodyHtml = await this.renderExpensesTab();
    else if (this.activeTab === 'tax') bodyHtml = await this.renderTaxTab();
    else if (this.activeTab === 'assets') bodyHtml = await this.renderAssetsTab();
    else if (this.activeTab === 'statements') bodyHtml = await this.renderStatementsTab();
    else if (this.activeTab === 'settings') bodyHtml = await this.renderSettingsTab();
    else if (this.activeTab === 'audit') bodyHtml = await this.renderAuditTab();

    return `<div id="finance-tab-content">${bodyHtml}</div>`;
  },

  // ==========================================================================
  // 1. DASHBOARD TAB
  // ==========================================================================
  async renderDashboardTab() {
    const res = await this.api('/dashboard');
    const d = res.data || {};
    const k = d.kpis || {};
    const p = d.current_period;
    const recent = d.recent_journals || [];

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px; padding:12px 16px; background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px;">
        <div>
          <strong style="color:#1e3a8a;">Active Accounting Period:</strong>
          <span style="font-weight:700; color:#0284c7;">${p ? `${this.esc(p.period_name)} (${p.status})` : 'Open Fiscal Period'}</span>
          <span style="margin-left:12px; font-size:0.8rem; color:#475569;">Base Currency: <strong>${this.esc(d.settings?.base_currency || 'PKR')}</strong></span>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button class="secondary-btn" onclick="FinanceModule.openJournalModal()">📝 + Manual Journal</button>
          <button class="secondary-btn" onclick="FinanceModule.openArInvoiceModal()">🧾 + Customer Invoice</button>
          <button class="secondary-btn" onclick="FinanceModule.openApBillModal()">📥 + Supplier Bill</button>
          <button class="primary-btn" onclick="FinanceModule.runSyncSubledgers()">🔄 Sync Subledgers to GL</button>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:18px;">
        <div class="kpi-card">
          <div class="kpi-label">🏦 Cash & Bank Balances</div>
          <div class="kpi-value" style="color:#0284c7;">${this.fmt(k.cash_and_bank)}</div>
          <div class="kpi-trend">${k.bank_accounts_count || 0} Active Cash/Bank Accounts</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">🧾 Accounts Receivable (Open AR)</div>
          <div class="kpi-value" style="color:#059669;">${this.fmt(k.ar_outstanding)}</div>
          <div class="kpi-trend">${k.ar_open_count || 0} Open Customer Invoices</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">📥 Accounts Payable (Open AP)</div>
          <div class="kpi-value" style="color:#dc2626;">${this.fmt(k.ap_outstanding)}</div>
          <div class="kpi-trend">${k.ap_open_count || 0} Unpaid Supplier Bills</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">📈 Net Operating Profit</div>
          <div class="kpi-value" style="color:${(k.net_profit || 0) >= 0 ? '#059669' : '#dc2626'};">${this.fmt(k.net_profit)}</div>
          <div class="kpi-trend">Rev: ${this.fmt(k.total_revenue)} | Exp: ${this.fmt(k.total_expenses)}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:1rem;">🕒 Recent General Ledger Activity</h3>
          <div style="font-size:0.8rem; color:#64748b;">
            Pending Approval/Draft JVs: <strong>${k.pending_journals || 0}</strong> | Unreconciled Bank Lines: <strong>${k.unreconciled_bank_lines || 0}</strong>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table">
              <thead><tr><th>Journal #</th><th>Date</th><th>Source</th><th>Narration</th><th style="text-align:right;">Amount</th><th>Status</th></tr></thead>
              <tbody>
                ${recent.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:20px; color:#64748b;">No journals posted yet.</td></tr>` : recent.map(j => `
                  <tr>
                    <td style="font-family:monospace; font-weight:700; color:#0284c7;">${this.esc(j.entry_number)}</td>
                    <td>${this.fdate(j.entry_date)}</td>
                    <td><span class="badge">${this.esc(j.reference_type)}</span></td>
                    <td>${this.esc(j.narration)}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:700;">${this.fmt(j.total_debit)}</td>
                    <td><span class="badge ${j.status === 'Posted' ? 'badge-won' : (j.status === 'Reversed' ? 'badge-lost' : 'badge-submitted')}">${this.esc(j.status || 'Posted')}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  // ==========================================================================
  // 2. CHART OF ACCOUNTS (COA) & ACCOUNT LEDGER DRILL-DOWN
  // ==========================================================================
  async renderCoaTab() {
    const coa = this._cache.coa || [];
    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1rem;">📒 Chart of Accounts (COA)</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Click "Ledger" on any account for chronological opening/running/closing balance drill-down</p>
          </div>
          <div style="display:flex; gap:8px;">
            <input type="text" class="form-input" style="width:200px; padding:6px 10px;" placeholder="Filter accounts..." oninput="FinanceModule.filterTable('table-fin-coa', this.value)">
            <button class="secondary-btn" onclick="FinanceModule.openOpeningBalanceModal()">📥 Opening Balances</button>
            <button class="primary-btn" onclick="FinanceModule.openCoaModal()">➕ New Account</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-fin-coa">
              <thead>
                <tr>
                  <th>Code</th><th>Account Name</th><th>Type</th><th>Sub-Type</th>
                  <th style="text-align:right;">Total Debit</th>
                  <th style="text-align:right;">Total Credit</th>
                  <th style="text-align:right;">Closing Balance</th>
                  <th style="text-align:center;">Status</th>
                  <th style="text-align:center;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${coa.map(a => `
                  <tr>
                    <td style="font-family:monospace; font-weight:800; color:#0284c7;">${this.esc(a.account_code)}</td>
                    <td style="font-weight:700;">${this.esc(a.account_name)}</td>
                    <td><span class="badge">${this.esc(a.account_type)}</span></td>
                    <td style="color:#64748b; font-size:0.8rem;">${this.esc(a.account_sub_type || '')}</td>
                    <td style="text-align:right; font-family:monospace;">${this.fmt(a.total_debit)}</td>
                    <td style="text-align:right; font-family:monospace;">${this.fmt(a.total_credit)}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:800;">${this.fmt(a.net_balance)}</td>
                    <td style="text-align:center;"><span class="badge ${a.is_active !== false ? 'badge-won' : 'badge-lost'}">${a.is_active !== false ? 'Active' : 'Inactive'}</span></td>
                    <td style="text-align:center;">
                      <button class="secondary-btn" style="padding:3px 8px; font-size:0.74rem;" onclick="FinanceModule.viewAccountLedger('${a.id}')">🔍 Ledger</button>
                      <button class="secondary-btn" style="padding:3px 8px; font-size:0.74rem;" onclick="FinanceModule.toggleCoaStatus('${a.id}', ${a.is_active !== false})">${a.is_active !== false ? 'Disable' : 'Enable'}</button>
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

  openCoaModal() {
    const parentOpts = `<option value="">-- None (Top Level) --</option>` + (this._cache.coa || []).map(a => `<option value="${a.id}">[${this.esc(a.account_code)}] ${this.esc(a.account_name)}</option>`).join('');
    this.modal('➕ Create Chart of Accounts Head', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitCoaForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Account Code *</label><input class="form-input" id="fin-coa-code" required placeholder="e.g. 1030"></div>
          <div class="form-group"><label class="form-label">Classification *</label>
            <select class="form-select" id="fin-coa-type" required>
              <option value="Asset">Asset</option><option value="Liability">Liability</option>
              <option value="Equity">Equity</option><option value="Revenue">Revenue</option><option value="Expense">Expense</option>
            </select>
          </div>
        </div>
        <div class="form-group"><label class="form-label">Account Name *</label><input class="form-input" id="fin-coa-name" required placeholder="e.g. Allied Bank Escrow Account"></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Sub-Type</label><input class="form-input" id="fin-coa-sub" value="Current Asset"></div>
          <div class="form-group"><label class="form-label">Parent Account</label><select class="form-select" id="fin-coa-parent">${parentOpts}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Opening Balance</label><input type="number" step="0.01" class="form-input" id="fin-coa-open" value="0"></div>
          <div class="form-group" style="display:flex; align-items:center; gap:8px; padding-top:26px;">
            <input type="checkbox" id="fin-coa-rec"><label for="fin-coa-rec">Reconcilable Bank/Cash Account</label>
          </div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Save Account</button></div>
      </form>
    `);
  },

  async submitCoaForm() {
    const res = await this.api('/coa', 'POST', {
      account_code: document.getElementById('fin-coa-code').value,
      account_name: document.getElementById('fin-coa-name').value,
      account_type: document.getElementById('fin-coa-type').value,
      account_sub_type: document.getElementById('fin-coa-sub').value,
      parent_account_id: document.getElementById('fin-coa-parent').value || null,
      opening_balance: parseFloat(document.getElementById('fin-coa-open').value || 0),
      is_reconcilable: document.getElementById('fin-coa-rec').checked
    });
    if (res.success) {
      this.closeModal();
      showToast('✓ Account added to Chart of Accounts!', 'success');
      renderActiveView();
    }
  },

  async toggleCoaStatus(id, currentlyActive) {
    const res = await this.api(`/coa/${id}`, 'PUT', { is_active: !currentlyActive });
    if (res.success) {
      showToast('✓ Account status updated.', 'success');
      renderActiveView();
    }
  },

  async viewAccountLedger(accountId) {
    const res = await this.api(`/coa/${accountId}/ledger`);
    if (!res.success || !res.data) return;
    const d = res.data;
    this.modal(`🔍 Account Ledger: [${d.account.account_code}] ${d.account.account_name}`, `
      <div style="display:flex; justify-content:space-between; background:#f8fafc; padding:10px 14px; border-radius:8px; margin-bottom:12px; font-size:0.85rem;">
        <div>Opening: <strong>${this.fmt(d.opening_balance)}</strong></div>
        <div>Total Dr: <strong>${this.fmt(d.total_debit)}</strong></div>
        <div>Total Cr: <strong>${this.fmt(d.total_credit)}</strong></div>
        <div>Closing: <strong style="color:#0284c7;">${this.fmt(d.closing_balance)}</strong></div>
      </div>
      <div class="table-responsive" style="max-height:380px; overflow-y:auto;">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Voucher #</th><th>Description</th><th style="text-align:right;">Debit</th><th style="text-align:right;">Credit</th><th style="text-align:right;">Running Bal</th></tr></thead>
          <tbody>
            ${d.entries.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:18px; color:#64748b;">No ledger movements recorded.</td></tr>` : d.entries.map(e => `
              <tr>
                <td>${this.fdate(e.entry_date)}</td>
                <td style="font-family:monospace; font-weight:700;">${this.esc(e.entry_number)}</td>
                <td>${this.esc(e.line_description || e.narration)}</td>
                <td style="text-align:right; font-family:monospace;">${e.debit > 0 ? this.fmt(e.debit) : '—'}</td>
                <td style="text-align:right; font-family:monospace;">${e.credit > 0 ? this.fmt(e.credit) : '—'}</td>
                <td style="text-align:right; font-family:monospace; font-weight:700;">${this.fmt(e.running_balance)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `, '860px');
  },

  openOpeningBalanceModal() {
    const coaOpts = (this._cache.coa || []).map(a => `<option value="${a.id}">[${this.esc(a.account_code)}] ${this.esc(a.account_name)}</option>`).join('');
    this.modal('📥 Controlled Opening Balance Migration', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitOpeningBalances();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Migration Date *</label><input type="date" class="form-input" id="fin-ob-date" required value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="form-group" style="display:flex; align-items:center; gap:8px; padding-top:26px;"><input type="checkbox" id="fin-ob-lock"><label for="fin-ob-lock">Lock Opening Balances After Post</label></div>
        </div>
        <div style="display:grid; grid-template-columns:2fr 1fr 1fr; gap:8px; margin-bottom:8px;">
          <select class="form-select" id="fin-ob-acc1">${coaOpts}</select>
          <input type="number" step="0.01" class="form-input" id="fin-ob-dr1" placeholder="Debit" value="0">
          <input type="number" step="0.01" class="form-input" id="fin-ob-cr1" placeholder="Credit" value="0">
        </div>
        <div style="display:grid; grid-template-columns:2fr 1fr 1fr; gap:8px; margin-bottom:12px;">
          <select class="form-select" id="fin-ob-acc2">${coaOpts}</select>
          <input type="number" step="0.01" class="form-input" id="fin-ob-dr2" placeholder="Debit" value="0">
          <input type="number" step="0.01" class="form-input" id="fin-ob-cr2" placeholder="Credit" value="0">
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Post Balanced Opening Entry</button></div>
      </form>
    `);
  },

  async submitOpeningBalances() {
    const res = await this.api('/opening-balances', 'POST', {
      as_of_date: document.getElementById('fin-ob-date').value,
      lock_after_post: document.getElementById('fin-ob-lock').checked,
      balances: [
        { account_id: document.getElementById('fin-ob-acc1').value, debit: parseFloat(document.getElementById('fin-ob-dr1').value || 0), credit: parseFloat(document.getElementById('fin-ob-cr1').value || 0) },
        { account_id: document.getElementById('fin-ob-acc2').value, debit: parseFloat(document.getElementById('fin-ob-dr2').value || 0), credit: parseFloat(document.getElementById('fin-ob-cr2').value || 0) }
      ]
    });
    if (res.success) {
      this.closeModal();
      showToast('✓ Opening balances posted cleanly!', 'success');
      renderActiveView();
    }
  },

  // ==========================================================================
  // 3. JOURNALS & GL TAB (Draft, Approve, Post, Reverse)
  // ==========================================================================
  async renderJournalsTab() {
    const res = await this.api('/journals?limit=100');
    const journals = res.data || [];

    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1rem;">📝 General Ledger Journal Register</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Posted entries are immutable — corrections use authorized Reversal Vouchers</p>
          </div>
          <div style="display:flex; gap:8px;">
            <input type="text" class="form-input" style="width:200px; padding:6px 10px;" placeholder="Search JV # or narration..." oninput="FinanceModule.filterTable('table-fin-journals', this.value)">
            <button class="primary-btn" onclick="FinanceModule.openJournalModal()">📝 + Create Journal</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-fin-journals">
              <thead><tr><th>Voucher #</th><th>Date</th><th>Source</th><th>Narration & Lines</th><th style="text-align:right;">Debit</th><th style="text-align:right;">Credit</th><th>Status</th><th style="text-align:center;">Actions</th></tr></thead>
              <tbody>
                ${journals.length === 0 ? `<tr><td colspan="8" style="text-align:center; padding:22px; color:#64748b;">No journals found.</td></tr>` : journals.map(j => `
                  <tr>
                    <td style="font-family:monospace; font-weight:700; color:#0284c7;">${this.esc(j.entry_number)}</td>
                    <td>${this.fdate(j.entry_date)}</td>
                    <td><span class="badge">${this.esc(j.reference_type)}</span></td>
                    <td>
                      <div style="font-weight:700; margin-bottom:3px;">${this.esc(j.narration)}</div>
                      ${(j.lines || []).map(l => `<div style="font-size:0.74rem; color:#475569; font-family:monospace;">• [${this.esc(l.account_code)}] ${this.esc(l.account_name)}: ${parseFloat(l.debit) > 0 ? `Dr ${this.fmt(l.debit)}` : `Cr ${this.fmt(l.credit)}`}</div>`).join('')}
                    </td>
                    <td style="text-align:right; font-family:monospace; font-weight:700;">${this.fmt(j.total_debit)}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:700;">${this.fmt(j.total_credit)}</td>
                    <td><span class="badge ${j.status === 'Posted' ? 'badge-won' : (j.status === 'Reversed' ? 'badge-lost' : 'badge-submitted')}">${this.esc(j.status || 'Posted')}</span></td>
                    <td style="text-align:center; white-space:nowrap;">
                      ${(j.status === 'Draft' || j.status === 'Pending Approval') ? `<button class="primary-btn" style="padding:3px 8px; font-size:0.72rem;" onclick="FinanceModule.postDraftJournal('${j.id}')">✓ Post</button>` : ''}
                      ${(j.status === 'Posted' && !j.is_reversed) ? `<button class="secondary-btn" style="padding:3px 8px; font-size:0.72rem; color:#dc2626; border-color:#fecaca;" onclick="FinanceModule.reverseJournalPrompt('${j.id}', '${this.esc(j.entry_number)}')">↩ Reverse</button>` : ''}
                      <button class="secondary-btn" style="padding:3px 8px; font-size:0.72rem;" onclick='if(window.TemplatesEngine?.printJournalVoucher) TemplatesEngine.printJournalVoucher(${JSON.stringify(j).replace(/'/g, "&#39;")});'>🖨️</button>
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

  openJournalModal() {
    const coaOpts = (this._cache.coa || []).filter(a => a.is_active !== false).map(a => `<option value="${a.id}">[${this.esc(a.account_code)}] ${this.esc(a.account_name)}</option>`).join('');
    this.modal('📝 Multi-Line Balanced Journal Voucher', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitJournalForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Entry Date *</label><input type="date" class="form-input" id="fin-jv-date" required value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="form-group"><label class="form-label">Action Status</label>
            <select class="form-select" id="fin-jv-status"><option value="Posted">Post Immediately</option><option value="Draft">Save as Draft</option></select>
          </div>
        </div>
        <div class="form-group"><label class="form-label">Narration / Audit Memo *</label><input class="form-input" id="fin-jv-narration" required placeholder="e.g. Monthly office rent accrual"></div>
        <div id="fin-jv-lines" style="margin-bottom:10px;">
          <div style="display:grid; grid-template-columns:2.2fr 1fr 1fr 1.2fr; gap:6px; font-size:0.75rem; font-weight:700; color:#475569; margin-bottom:4px;">
            <div>GL Account</div><div>Debit</div><div>Credit</div><div>Cost Center / Note</div>
          </div>
          ${[0, 1].map(i => `
            <div class="fin-jv-row" style="display:grid; grid-template-columns:2.2fr 1fr 1fr 1.2fr; gap:6px; margin-bottom:6px;">
              <select class="form-select jv-acc">${coaOpts}</select>
              <input type="number" step="0.01" class="form-input jv-dr" value="0" oninput="FinanceModule.recalcJvModal()">
              <input type="number" step="0.01" class="form-input jv-cr" value="0" oninput="FinanceModule.recalcJvModal()">
              <input type="text" class="form-input jv-cc" placeholder="Dept / Note">
            </div>
          `).join('')}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:#f8fafc; border-radius:6px; margin-bottom:12px;">
          <button type="button" class="secondary-btn" style="padding:4px 10px; font-size:0.78rem;" onclick="FinanceModule.addJvLineRow()">➕ Add Line</button>
          <div id="fin-jv-balance-indicator" style="font-size:0.85rem; font-weight:700; color:#dc2626;">Dr: 0.00 | Cr: 0.00</div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">💾 Save Journal</button></div>
      </form>
    `, '840px');
  },

  addJvLineRow() {
    const coaOpts = (this._cache.coa || []).filter(a => a.is_active !== false).map(a => `<option value="${a.id}">[${this.esc(a.account_code)}] ${this.esc(a.account_name)}</option>`).join('');
    const row = document.createElement('div');
    row.className = 'fin-jv-row';
    row.style.cssText = 'display:grid; grid-template-columns:2.2fr 1fr 1fr 1.2fr; gap:6px; margin-bottom:6px;';
    row.innerHTML = `<select class="form-select jv-acc">${coaOpts}</select><input type="number" step="0.01" class="form-input jv-dr" value="0" oninput="FinanceModule.recalcJvModal()"><input type="number" step="0.01" class="form-input jv-cr" value="0" oninput="FinanceModule.recalcJvModal()"><input type="text" class="form-input jv-cc" placeholder="Dept / Note">`;
    document.getElementById('fin-jv-lines').appendChild(row);
  },

  recalcJvModal() {
    let dr = 0, cr = 0;
    document.querySelectorAll('.fin-jv-row').forEach(r => {
      dr += parseFloat(r.querySelector('.jv-dr').value || 0);
      cr += parseFloat(r.querySelector('.jv-cr').value || 0);
    });
    const el = document.getElementById('fin-jv-balance-indicator');
    const balanced = Math.abs(dr - cr) < 0.01 && dr > 0;
    el.style.color = balanced ? '#059669' : '#dc2626';
    el.innerText = `Dr: ${dr.toFixed(2)} | Cr: ${cr.toFixed(2)} ${balanced ? '✓ Balanced' : '(Unbalanced)'}`;
  },

  async submitJournalForm() {
    const lines = [];
    document.querySelectorAll('.fin-jv-row').forEach(r => {
      const dr = parseFloat(r.querySelector('.jv-dr').value || 0);
      const cr = parseFloat(r.querySelector('.jv-cr').value || 0);
      if (dr > 0 || cr > 0) {
        lines.push({
          account_id: r.querySelector('.jv-acc').value,
          debit: dr,
          credit: cr,
          cost_center: r.querySelector('.jv-cc').value || null
        });
      }
    });
    const res = await this.api('/journals', 'POST', {
      entry_date: document.getElementById('fin-jv-date').value,
      status: document.getElementById('fin-jv-status').value,
      narration: document.getElementById('fin-jv-narration').value,
      lines
    });
    if (res.success) {
      this.closeModal();
      showToast(res.message, 'success');
      renderActiveView();
    }
  },

  async postDraftJournal(id) {
    const res = await this.api(`/journals/${id}/post`, 'POST', {});
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  async reverseJournalPrompt(id, jvNo) {
    const reason = prompt(`Enter reversal reason for ${jvNo}:`, 'Authorized correction reversal');
    if (!reason) return;
    const res = await this.api(`/journals/${id}/reverse`, 'POST', { reason });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 4. ACCOUNTS RECEIVABLE (AR) TAB
  // ==========================================================================
  async renderArTab() {
    const [invRes, cnRes, rcptRes, agingRes] = await Promise.all([
      this.api('/ar/invoices'),
      this.api('/ar/credit-notes'),
      this.api('/ar/receipts'),
      this.api('/ar/aging')
    ]);
    const invoices = invRes.data || [];
    const cns = cnRes.data || [];
    const receipts = rcptRes.data || [];
    const aging = agingRes.data || { buckets: {}, items: [] };

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
        <div style="display:flex; gap:6px;">
          ${['invoices', 'credit-notes', 'receipts', 'aging', 'statements'].map(s => `
            <button class="${this.arSubTab === s ? 'primary-btn' : 'secondary-btn'}" style="padding:6px 12px; font-size:0.8rem;" onclick="FinanceModule.arSubTab='${s}'; renderActiveView();">
              ${s === 'invoices' ? '🧾 Invoices' : s === 'credit-notes' ? '↩ Credit Notes' : s === 'receipts' ? '💵 Receipts' : s === 'aging' ? '⏱️ AR Aging' : '📄 Statements'}
            </button>
          `).join('')}
        </div>
        <div style="display:flex; gap:8px;">
          <button class="secondary-btn" onclick="FinanceModule.openArCreditNoteModal()">+ Credit Note</button>
          <button class="secondary-btn" onclick="FinanceModule.openArReceiptModal()">💵 + Customer Receipt</button>
          <button class="primary-btn" onclick="FinanceModule.openArInvoiceModal()">🧾 + Standalone Invoice</button>
        </div>
      </div>

      ${this.arSubTab === 'invoices' ? `
        <div class="card"><div class="card-body" style="padding:0;"><div class="table-responsive"><table class="data-table">
          <thead><tr><th>Invoice #</th><th>Date</th><th>Customer</th><th style="text-align:right;">Total</th><th style="text-align:right;">Paid/Credited</th><th style="text-align:right;">Balance Due</th><th>Status</th><th style="text-align:center;">Actions</th></tr></thead>
          <tbody>
            ${invoices.length === 0 ? `<tr><td colspan="8" style="text-align:center; padding:20px; color:#64748b;">No customer invoices.</td></tr>` : invoices.map(i => `
              <tr>
                <td style="font-family:monospace; font-weight:700; color:#0284c7;">${this.esc(i.invoice_number)}</td>
                <td>${this.fdate(i.invoice_date)}</td>
                <td style="font-weight:600;">${this.esc(i.customer_name)}</td>
                <td style="text-align:right; font-family:monospace;">${this.fmt(i.total_amount)}</td>
                <td style="text-align:right; font-family:monospace; color:#059669;">${this.fmt(parseFloat(i.paid_amount || 0) + parseFloat(i.credited_amount || 0))}</td>
                <td style="text-align:right; font-family:monospace; font-weight:800;">${this.fmt(i.outstanding_amount)}</td>
                <td><span class="badge ${i.status === 'Paid' ? 'badge-won' : (i.status === 'Voided' ? 'badge-lost' : 'badge-submitted')}">${this.esc(i.status)}</span></td>
                <td style="text-align:center;">
                  ${i.status !== 'Voided' && parseFloat(i.paid_amount || 0) === 0 ? `<button class="secondary-btn" style="padding:3px 7px; font-size:0.72rem;" onclick="FinanceModule.voidArInvoice('${i.id}', '${this.esc(i.invoice_number)}')">Void</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div></div></div>
      ` : this.arSubTab === 'credit-notes' ? `
        <div class="card"><div class="card-body" style="padding:0;"><div class="table-responsive"><table class="data-table">
          <thead><tr><th>CN #</th><th>Date</th><th>Customer</th><th>Ref Invoice</th><th style="text-align:right;">Total Credit</th><th>Reason</th><th>Status</th></tr></thead>
          <tbody>
            ${cns.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:20px;">No credit notes issued.</td></tr>` : cns.map(c => `
              <tr>
                <td style="font-family:monospace; font-weight:700;">${this.esc(c.credit_note_number)}</td>
                <td>${this.fdate(c.credit_date)}</td>
                <td>${this.esc(c.customer_name)}</td>
                <td>${this.esc(c.invoice_number || '—')}</td>
                <td style="text-align:right; font-family:monospace; font-weight:700;">${this.fmt(c.total_amount)}</td>
                <td>${this.esc(c.reason)}</td>
                <td><span class="badge badge-won">${this.esc(c.status)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table></div></div></div>
      ` : this.arSubTab === 'receipts' ? `
        <div class="card"><div class="card-body" style="padding:0;"><div class="table-responsive"><table class="data-table">
          <thead><tr><th>Receipt #</th><th>Date</th><th>Customer</th><th>Method / Bank</th><th style="text-align:right;">Net Received</th><th style="text-align:right;">WHT Deducted</th><th style="text-align:right;">Unapplied</th></tr></thead>
          <tbody>
            ${receipts.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:20px;">No customer receipts recorded.</td></tr>` : receipts.map(r => `
              <tr>
                <td style="font-family:monospace; font-weight:700;">${this.esc(r.payment_number || r.id.slice(0, 8))}</td>
                <td>${this.fdate(r.payment_date)}</td>
                <td>${this.esc(r.customer_name || '—')}</td>
                <td>${this.esc(r.payment_method)} ${r.bank_account_name ? `(${this.esc(r.bank_account_name)})` : ''}</td>
                <td style="text-align:right; font-family:monospace; font-weight:700; color:#059669;">${this.fmt(r.net_received_amount || r.amount)}</td>
                <td style="text-align:right; font-family:monospace;">${this.fmt(r.income_tax_wht_amount || 0)}</td>
                <td style="text-align:right; font-family:monospace;">${this.fmt(r.unapplied_amount || 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table></div></div></div>
      ` : this.arSubTab === 'aging' ? `
        <div class="kpi-grid" style="margin-bottom:14px;">
          <div class="kpi-card"><div class="kpi-label">0–30 Days</div><div class="kpi-value">${this.fmt(aging.buckets.days_0_30)}</div></div>
          <div class="kpi-card"><div class="kpi-label">31–60 Days</div><div class="kpi-value">${this.fmt(aging.buckets.days_31_60)}</div></div>
          <div class="kpi-card"><div class="kpi-label">61–90 Days</div><div class="kpi-value" style="color:#d97706;">${this.fmt(aging.buckets.days_61_90)}</div></div>
          <div class="kpi-card"><div class="kpi-label">90+ Days Overdue</div><div class="kpi-value" style="color:#dc2626;">${this.fmt(aging.buckets.days_90_plus)}</div></div>
        </div>
        <div class="card"><div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Invoice #</th><th>Customer</th><th>Due Date</th><th style="text-align:right;">Age (Days)</th><th style="text-align:right;">Outstanding</th></tr></thead>
          <tbody>${(aging.items || []).map(x => `<tr><td>${this.esc(x.doc_number)}</td><td>${this.esc(x.party_name)}</td><td>${this.fdate(x.due_date)}</td><td style="text-align:right;">${x.age_days}</td><td style="text-align:right; font-weight:700;">${this.fmt(x.outstanding)}</td></tr>`).join('')}</tbody>
        </table></div></div>
      ` : `
        <div class="card" style="padding:18px;">
          <div style="display:flex; gap:10px; align-items:flex-end; margin-bottom:16px;">
            <div class="form-group" style="margin:0; flex:1;"><label class="form-label">Select Customer for Statement</label>
              <select class="form-select" id="fin-ar-stmt-cust">${(this._cache.customers || []).map(c => `<option value="${c.id}">${this.esc(c.business_name)}</option>`).join('')}</select>
            </div>
            <button class="primary-btn" onclick="FinanceModule.loadPartyStatement('customer', 'fin-ar-stmt-cust', 'fin-ar-stmt-out')">Generate Statement</button>
          </div>
          <div id="fin-ar-stmt-out" style="color:#64748b;">Select a customer and click Generate Statement.</div>
        </div>
      `}
    `;
  },

  openArInvoiceModal() {
    const custOpts = (this._cache.customers || []).map(c => `<option value="${c.id}">${this.esc(c.business_name)}</option>`).join('');
    this.modal('🧾 Standalone Customer Tax Invoice', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitArInvoiceForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Customer *</label><select class="form-select" id="fin-inv-cust" required>${custOpts}</select></div>
          <div class="form-group"><label class="form-label">Invoice Date *</label><input type="date" class="form-input" id="fin-inv-date" required value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Description *</label><input class="form-input" id="fin-inv-desc" required value="Professional Services / Goods Supply"></div>
          <div class="form-group"><label class="form-label">Payment Terms</label><input class="form-input" id="fin-inv-terms" value="Net 30"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Quantity</label><input type="number" step="0.01" class="form-input" id="fin-inv-qty" value="1"></div>
          <div class="form-group"><label class="form-label">Unit Price</label><input type="number" step="0.01" class="form-input" id="fin-inv-price" required value="10000"></div>
          <div class="form-group"><label class="form-label">Tax Rate (%)</label><input type="number" step="0.01" class="form-input" id="fin-inv-tax" value="18"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Issue & Post to GL</button></div>
      </form>
    `);
  },

  async submitArInvoiceForm() {
    const res = await this.api('/ar/invoices', 'POST', {
      customer_id: document.getElementById('fin-inv-cust').value,
      invoice_date: document.getElementById('fin-inv-date').value,
      payment_terms: document.getElementById('fin-inv-terms').value,
      status: 'Issued',
      items: [{
        description: document.getElementById('fin-inv-desc').value,
        quantity: parseFloat(document.getElementById('fin-inv-qty').value || 1),
        unit_price: parseFloat(document.getElementById('fin-inv-price').value || 0),
        tax_rate: parseFloat(document.getElementById('fin-inv-tax').value || 0)
      }]
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  async voidArInvoice(id, num) {
    const reason = prompt(`Void reason for Invoice ${num}:`, 'Issued in error');
    if (!reason) return;
    const res = await this.api(`/ar/invoices/${id}/void`, 'POST', { reason });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  openArCreditNoteModal() {
    const custOpts = (this._cache.customers || []).map(c => `<option value="${c.id}">${this.esc(c.business_name)}</option>`).join('');
    this.modal('↩ Issue Customer Credit Note', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitArCnForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Customer *</label><select class="form-select" id="fin-cn-cust" required>${custOpts}</select></div>
          <div class="form-group"><label class="form-label">Credit Date</label><input type="date" class="form-input" id="fin-cn-date" value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Subtotal Amount *</label><input type="number" step="0.01" class="form-input" id="fin-cn-sub" required></div>
          <div class="form-group"><label class="form-label">Tax Reversal Amount</label><input type="number" step="0.01" class="form-input" id="fin-cn-tax" value="0"></div>
        </div>
        <div class="form-group"><label class="form-label">Reason *</label><input class="form-input" id="fin-cn-reason" required value="Sales Return / Price Adjustment"></div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Post Credit Note</button></div>
      </form>
    `);
  },

  async submitArCnForm() {
    const res = await this.api('/ar/credit-notes', 'POST', {
      customer_id: document.getElementById('fin-cn-cust').value,
      credit_date: document.getElementById('fin-cn-date').value,
      subtotal: parseFloat(document.getElementById('fin-cn-sub').value || 0),
      tax_amount: parseFloat(document.getElementById('fin-cn-tax').value || 0),
      reason: document.getElementById('fin-cn-reason').value
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  openArReceiptModal() {
    const custOpts = (this._cache.customers || []).map(c => `<option value="${c.id}">${this.esc(c.business_name)}</option>`).join('');
    const bankOpts = (this._cache.bankAccounts || []).map(b => `<option value="${b.id}">${this.esc(b.account_name)}</option>`).join('');
    this.modal('💵 Record Customer Receipt', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitArReceiptForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Customer *</label><select class="form-select" id="fin-rcpt-cust" required>${custOpts}</select></div>
          <div class="form-group"><label class="form-label">Deposit Into Bank/Cash *</label><select class="form-select" id="fin-rcpt-bank">${bankOpts}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Net Amount Received *</label><input type="number" step="0.01" class="form-input" id="fin-rcpt-amt" required></div>
          <div class="form-group"><label class="form-label">WHT Deducted by Client</label><input type="number" step="0.01" class="form-input" id="fin-rcpt-wht" value="0"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Receipt Date</label><input type="date" class="form-input" id="fin-rcpt-date" value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="form-group"><label class="form-label">Reference / Cheque #</label><input class="form-input" id="fin-rcpt-ref" placeholder="CHQ-12345"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Save & Post Receipt</button></div>
      </form>
    `);
  },

  async submitArReceiptForm() {
    const res = await this.api('/ar/receipts', 'POST', {
      customer_id: document.getElementById('fin-rcpt-cust').value,
      bank_account_id: document.getElementById('fin-rcpt-bank').value || null,
      amount: parseFloat(document.getElementById('fin-rcpt-amt').value || 0),
      wht_amount: parseFloat(document.getElementById('fin-rcpt-wht').value || 0),
      payment_date: document.getElementById('fin-rcpt-date').value,
      reference_number: document.getElementById('fin-rcpt-ref').value
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  async loadPartyStatement(partyType, selectId, outId) {
    const pid = document.getElementById(selectId).value;
    if (!pid) return;
    const ep = partyType === 'customer' ? `/ar/statements/${pid}` : `/ap/statements/${pid}`;
    const res = await this.api(ep);
    const out = document.getElementById(outId);
    if (!res.success || !res.data) { out.innerHTML = 'No statement data.'; return; }
    const d = res.data;
    out.innerHTML = `
      <div style="margin-bottom:10px; font-weight:700;">Closing Balance: <span style="color:#0284c7;">${this.fmt(d.closing_balance)}</span></div>
      <table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Document #</th><th style="text-align:right;">Debit</th><th style="text-align:right;">Credit</th><th style="text-align:right;">Running Bal</th></tr></thead>
      <tbody>${d.lines.map(l => `<tr><td>${this.fdate(l.date)}</td><td>${this.esc(l.type)}</td><td>${this.esc(l.doc_no)}</td><td style="text-align:right;">${this.fmt(l.debit)}</td><td style="text-align:right;">${this.fmt(l.credit)}</td><td style="text-align:right; font-weight:700;">${this.fmt(l.running_balance)}</td></tr>`).join('')}</tbody></table>
    `;
  },

  // ==========================================================================
  // 5. ACCOUNTS PAYABLE (AP) TAB
  // ==========================================================================
  async renderApTab() {
    const [billsRes, paysRes, agingRes] = await Promise.all([
      this.api('/ap/bills'),
      this.api('/ap/payments'),
      this.api('/ap/aging')
    ]);
    const bills = billsRes.data || [];
    const pays = paysRes.data || [];
    const aging = agingRes.data || { buckets: {}, items: [] };

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
        <div style="display:flex; gap:6px;">
          ${['bills', 'payments', 'aging', 'statements'].map(s => `
            <button class="${this.apSubTab === s ? 'primary-btn' : 'secondary-btn'}" style="padding:6px 12px; font-size:0.8rem;" onclick="FinanceModule.apSubTab='${s}'; renderActiveView();">
              ${s === 'bills' ? '📥 Supplier Bills' : s === 'payments' ? '💸 Vendor Payments' : s === 'aging' ? '⏱️ AP Aging' : '📄 Statements'}
            </button>
          `).join('')}
        </div>
        <div style="display:flex; gap:8px;">
          <button class="secondary-btn" onclick="FinanceModule.openApPaymentModal()">💸 + Vendor Payment</button>
          <button class="primary-btn" onclick="FinanceModule.openApBillModal()">📥 + Supplier Bill</button>
        </div>
      </div>

      ${this.apSubTab === 'bills' ? `
        <div class="card"><div class="card-body" style="padding:0;"><div class="table-responsive"><table class="data-table">
          <thead><tr><th>Bill #</th><th>Vendor Inv #</th><th>Supplier</th><th>Date</th><th style="text-align:right;">Total</th><th style="text-align:right;">Balance Due</th><th>Status</th><th style="text-align:center;">Actions</th></tr></thead>
          <tbody>
            ${bills.length === 0 ? `<tr><td colspan="8" style="text-align:center; padding:20px;">No supplier bills recorded.</td></tr>` : bills.map(b => `
              <tr>
                <td style="font-family:monospace; font-weight:700; color:#0284c7;">${this.esc(b.bill_number)}</td>
                <td>${this.esc(b.vendor_invoice_number || '—')}</td>
                <td style="font-weight:600;">${this.esc(b.supplier_name)}</td>
                <td>${this.fdate(b.bill_date)}</td>
                <td style="text-align:right; font-family:monospace;">${this.fmt(b.total_amount)}</td>
                <td style="text-align:right; font-family:monospace; font-weight:800;">${this.fmt(b.outstanding_amount)}</td>
                <td><span class="badge ${b.status === 'Paid' ? 'badge-won' : (b.status === 'Voided' ? 'badge-lost' : 'badge-submitted')}">${this.esc(b.status)}</span></td>
                <td style="text-align:center;">
                  ${b.status !== 'Voided' && parseFloat(b.paid_amount || 0) === 0 ? `<button class="secondary-btn" style="padding:3px 7px; font-size:0.72rem;" onclick="FinanceModule.voidApBill('${b.id}', '${this.esc(b.bill_number)}')">Void</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div></div></div>
      ` : this.apSubTab === 'payments' ? `
        <div class="card"><div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Payment #</th><th>Date</th><th>Supplier</th><th>Method / Bank</th><th style="text-align:right;">Net Paid</th><th style="text-align:right;">WHT Withheld</th></tr></thead>
          <tbody>${pays.map(p => `<tr><td style="font-family:monospace; font-weight:700;">${this.esc(p.payment_number)}</td><td>${this.fdate(p.payment_date)}</td><td>${this.esc(p.supplier_name)}</td><td>${this.esc(p.payment_method)}</td><td style="text-align:right; font-weight:700;">${this.fmt(p.net_paid_amount)}</td><td style="text-align:right;">${this.fmt(p.wht_deducted)}</td></tr>`).join('')}</tbody>
        </table></div></div>
      ` : this.apSubTab === 'aging' ? `
        <div class="kpi-grid" style="margin-bottom:14px;">
          <div class="kpi-card"><div class="kpi-label">0–30 Days</div><div class="kpi-value">${this.fmt(aging.buckets.days_0_30)}</div></div>
          <div class="kpi-card"><div class="kpi-label">31–60 Days</div><div class="kpi-value">${this.fmt(aging.buckets.days_31_60)}</div></div>
          <div class="kpi-card"><div class="kpi-label">61–90 Days</div><div class="kpi-value">${this.fmt(aging.buckets.days_61_90)}</div></div>
          <div class="kpi-card"><div class="kpi-label">90+ Days Overdue</div><div class="kpi-value" style="color:#dc2626;">${this.fmt(aging.buckets.days_90_plus)}</div></div>
        </div>
      ` : `
        <div class="card" style="padding:18px;">
          <div style="display:flex; gap:10px; align-items:flex-end; margin-bottom:16px;">
            <div class="form-group" style="margin:0; flex:1;"><label class="form-label">Select Supplier for Statement</label>
              <select class="form-select" id="fin-ap-stmt-sup">${(this._cache.suppliers || []).map(s => `<option value="${s.id}">${this.esc(s.supplier_name)}</option>`).join('')}</select>
            </div>
            <button class="primary-btn" onclick="FinanceModule.loadPartyStatement('supplier', 'fin-ap-stmt-sup', 'fin-ap-stmt-out')">Generate Statement</button>
          </div>
          <div id="fin-ap-stmt-out" style="color:#64748b;">Select a supplier and click Generate Statement.</div>
        </div>
      `}
    `;
  },

  openApBillModal() {
    const supOpts = (this._cache.suppliers || []).map(s => `<option value="${s.id}">${this.esc(s.supplier_name)}</option>`).join('');
    const expCoaOpts = (this._cache.coa || []).filter(a => ['Expense', 'Asset'].includes(a.account_type)).map(a => `<option value="${a.id}">[${this.esc(a.account_code)}] ${this.esc(a.account_name)}</option>`).join('');
    this.modal('📥 Enter Standalone Supplier Bill', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitApBillForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Supplier *</label><select class="form-select" id="fin-bill-sup" required>${supOpts}</select></div>
          <div class="form-group"><label class="form-label">Vendor Invoice # (Duplicate Check)</label><input class="form-input" id="fin-bill-vref" placeholder="SUP-INV-2026-01"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Bill Date *</label><input type="date" class="form-input" id="fin-bill-date" required value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="form-group"><label class="form-label">Expense / Asset GL Account</label><select class="form-select" id="fin-bill-coa">${expCoaOpts}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Description *</label><input class="form-input" id="fin-bill-desc" required value="Vendor Goods / Services Bill"></div>
          <div class="form-group"><label class="form-label">Subtotal (Excl. Tax) *</label><input type="number" step="0.01" class="form-input" id="fin-bill-sub" required></div>
          <div class="form-group"><label class="form-label">Tax Rate (%)</label><input type="number" step="0.01" class="form-input" id="fin-bill-tax" value="18"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Approve & Post Bill</button></div>
      </form>
    `);
  },

  async submitApBillForm() {
    const res = await this.api('/ap/bills', 'POST', {
      supplier_id: document.getElementById('fin-bill-sup').value,
      vendor_invoice_number: document.getElementById('fin-bill-vref').value || null,
      bill_date: document.getElementById('fin-bill-date').value,
      status: 'Approved',
      lines: [{
        expense_account_id: document.getElementById('fin-bill-coa').value,
        description: document.getElementById('fin-bill-desc').value,
        quantity: 1,
        unit_cost: parseFloat(document.getElementById('fin-bill-sub').value || 0),
        tax_rate: parseFloat(document.getElementById('fin-bill-tax').value || 0)
      }]
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  async voidApBill(id, num) {
    const reason = prompt(`Void reason for Bill ${num}:`, 'Duplicate / Error');
    if (!reason) return;
    const res = await this.api(`/ap/bills/${id}/void`, 'POST', { reason });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  openApPaymentModal() {
    const supOpts = (this._cache.suppliers || []).map(s => `<option value="${s.id}">${this.esc(s.supplier_name)}</option>`).join('');
    const bankOpts = (this._cache.bankAccounts || []).map(b => `<option value="${b.id}">${this.esc(b.account_name)}</option>`).join('');
    this.modal('💸 Record Supplier Payment', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitApPaymentForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Supplier *</label><select class="form-select" id="fin-sp-sup" required>${supOpts}</select></div>
          <div class="form-group"><label class="form-label">Pay From Cash/Bank *</label><select class="form-select" id="fin-sp-bank">${bankOpts}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Net Paid Amount *</label><input type="number" step="0.01" class="form-input" id="fin-sp-amt" required></div>
          <div class="form-group"><label class="form-label">WHT Withheld</label><input type="number" step="0.01" class="form-input" id="fin-sp-wht" value="0"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Payment Date</label><input type="date" class="form-input" id="fin-sp-date" value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="form-group"><label class="form-label">Reference / IBFT #</label><input class="form-input" id="fin-sp-ref"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Post Payment</button></div>
      </form>
    `);
  },

  async submitApPaymentForm() {
    const res = await this.api('/ap/payments', 'POST', {
      supplier_id: document.getElementById('fin-sp-sup').value,
      bank_account_id: document.getElementById('fin-sp-bank').value || null,
      net_paid_amount: parseFloat(document.getElementById('fin-sp-amt').value || 0),
      wht_deducted: parseFloat(document.getElementById('fin-sp-wht').value || 0),
      payment_date: document.getElementById('fin-sp-date').value,
      reference_number: document.getElementById('fin-sp-ref').value
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 6. CASH & BANKING TAB
  // ==========================================================================
  async renderBankingTab() {
    const [trfRes, recRes] = await Promise.all([this.api('/bank-transfers'), this.api('/bank-reconciliations')]);
    const accounts = this._cache.bankAccounts || [];
    const transfers = trfRes.data || [];
    const recs = recRes.data || [];

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <div style="display:flex; gap:6px;">
          ${['accounts', 'transfers', 'reconciliation'].map(s => `
            <button class="${this.bankSubTab === s ? 'primary-btn' : 'secondary-btn'}" style="padding:6px 12px; font-size:0.8rem;" onclick="FinanceModule.bankSubTab='${s}'; renderActiveView();">
              ${s === 'accounts' ? '🏦 Accounts' : s === 'transfers' ? '🔄 Inter-Account Transfers' : '✔️ Bank Reconciliation'}
            </button>
          `).join('')}
        </div>
        <div style="display:flex; gap:8px;">
          <button class="secondary-btn" onclick="FinanceModule.openBankTransferModal()">🔄 Fund Transfer</button>
          <button class="secondary-btn" onclick="FinanceModule.openReconciliationModal()">✔️ Reconcile Bank</button>
          <button class="primary-btn" onclick="FinanceModule.openBankAccountModal()">➕ Add Cash/Bank</button>
        </div>
      </div>

      ${this.bankSubTab === 'accounts' ? `
        <div class="card"><div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Account Name</th><th>Type</th><th>Bank / IBAN</th><th>Linked GL</th><th style="text-align:right;">Opening</th><th style="text-align:right;">Current Balance</th></tr></thead>
          <tbody>${accounts.map(a => `<tr><td style="font-weight:700;">${this.esc(a.account_name)}</td><td><span class="badge">${this.esc(a.account_type)}</span></td><td>${this.esc(a.bank_name || '')} ${this.esc(a.iban || a.account_number || '')}</td><td style="font-family:monospace;">[${this.esc(a.account_code)}] ${this.esc(a.coa_name)}</td><td style="text-align:right;">${this.fmt(a.opening_balance)}</td><td style="text-align:right; font-weight:800; color:#0284c7;">${this.fmt(a.current_balance)}</td></tr>`).join('')}</tbody>
        </table></div></div>
      ` : this.bankSubTab === 'transfers' ? `
        <div class="card"><div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Transfer #</th><th>Date</th><th>From</th><th>To</th><th style="text-align:right;">Amount</th><th>Reference</th></tr></thead>
          <tbody>${transfers.map(t => `<tr><td style="font-family:monospace; font-weight:700;">${this.esc(t.transfer_number)}</td><td>${this.fdate(t.transfer_date)}</td><td>${this.esc(t.from_account_name)}</td><td>${this.esc(t.to_account_name)}</td><td style="text-align:right; font-weight:700;">${this.fmt(t.amount)}</td><td>${this.esc(t.reference_number || '—')}</td></tr>`).join('')}</tbody>
        </table></div></div>
      ` : `
        <div class="card"><div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Bank Account</th><th>Statement Period</th><th style="text-align:right;">Statement Bal</th><th style="text-align:right;">Book Bal</th><th style="text-align:right;">Difference</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${recs.map(r => `<tr><td style="font-weight:700;">${this.esc(r.account_name)}</td><td>${this.fdate(r.statement_start_date)} to ${this.fdate(r.statement_end_date)}</td><td style="text-align:right;">${this.fmt(r.closing_statement_balance)}</td><td style="text-align:right;">${this.fmt(r.book_balance)}</td><td style="text-align:right; font-weight:700;">${this.fmt(r.reconciled_difference)}</td><td><span class="badge ${r.status === 'Reconciled' ? 'badge-won' : 'badge-submitted'}">${this.esc(r.status)}</span></td><td>${r.status !== 'Reconciled' ? `<button class="primary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="FinanceModule.completeReconciliation('${r.id}')">Mark Reconciled</button>` : '✓ Done'}</td></tr>`).join('')}</tbody>
        </table></div></div>
      `}
    `;
  },

  openBankAccountModal() {
    this.modal('🏦 Add Cash or Bank Account', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitBankAccountForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Account Title *</label><input class="form-input" id="fin-ba-name" required placeholder="e.g. Meezan Bank Main Operational"></div>
          <div class="form-group"><label class="form-label">Type</label><select class="form-select" id="fin-ba-type"><option value="Bank">Bank</option><option value="Cash">Cash</option></select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Bank Name</label><input class="form-input" id="fin-ba-bank" placeholder="Meezan Bank"></div>
          <div class="form-group"><label class="form-label">IBAN / Account #</label><input class="form-input" id="fin-ba-iban"></div>
          <div class="form-group"><label class="form-label">Opening Balance</label><input type="number" step="0.01" class="form-input" id="fin-ba-open" value="0"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Save Account</button></div>
      </form>
    `);
  },

  async submitBankAccountForm() {
    const res = await this.api('/bank-accounts', 'POST', {
      account_name: document.getElementById('fin-ba-name').value,
      account_type: document.getElementById('fin-ba-type').value,
      bank_name: document.getElementById('fin-ba-bank').value,
      iban: document.getElementById('fin-ba-iban').value,
      opening_balance: parseFloat(document.getElementById('fin-ba-open').value || 0)
    });
    if (res.success) { this.closeModal(); showToast('✓ Account created.', 'success'); renderActiveView(); }
  },

  openBankTransferModal() {
    const opts = (this._cache.bankAccounts || []).map(b => `<option value="${b.id}">${this.esc(b.account_name)} (${this.fmt(b.current_balance)})</option>`).join('');
    this.modal('🔄 Inter-Account Cash / Bank Transfer', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitBankTransferForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">From Account *</label><select class="form-select" id="fin-trf-from" required>${opts}</select></div>
          <div class="form-group"><label class="form-label">To Account *</label><select class="form-select" id="fin-trf-to" required>${opts}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Amount *</label><input type="number" step="0.01" class="form-input" id="fin-trf-amt" required></div>
          <div class="form-group"><label class="form-label">Date</label><input type="date" class="form-input" id="fin-trf-date" value="${new Date().toISOString().slice(0, 10)}"></div>
          <div class="form-group"><label class="form-label">Ref #</label><input class="form-input" id="fin-trf-ref"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Execute Transfer & Post GL</button></div>
      </form>
    `);
  },

  async submitBankTransferForm() {
    const res = await this.api('/bank-transfers', 'POST', {
      from_account_id: document.getElementById('fin-trf-from').value,
      to_account_id: document.getElementById('fin-trf-to').value,
      amount: parseFloat(document.getElementById('fin-trf-amt').value || 0),
      transfer_date: document.getElementById('fin-trf-date').value,
      reference_number: document.getElementById('fin-trf-ref').value
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  openReconciliationModal() {
    const opts = (this._cache.bankAccounts || []).map(b => `<option value="${b.id}">${this.esc(b.account_name)}</option>`).join('');
    this.modal('✔️ Start Bank Statement Reconciliation', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitReconciliationForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Bank Account *</label><select class="form-select" id="fin-rec-bank" required>${opts}</select></div>
          <div class="form-group"><label class="form-label">Statement Closing Balance *</label><input type="number" step="0.01" class="form-input" id="fin-rec-bal" required></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Start Date</label><input type="date" class="form-input" id="fin-rec-start" value="${new Date().toISOString().slice(0, 8)}01"></div>
          <div class="form-group"><label class="form-label">End Date</label><input type="date" class="form-input" id="fin-rec-end" value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div class="form-group"><label class="form-label">Optional Statement Lines (CSV: Date,Description,Withdrawal,Deposit)</label>
          <textarea class="form-input" id="fin-rec-csv" rows="3" placeholder="2026-11-05,Client Deposit,0,50000"></textarea>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Start Reconciliation</button></div>
      </form>
    `);
  },

  async submitReconciliationForm() {
    const csv = (document.getElementById('fin-rec-csv').value || '').trim();
    const lines = csv ? csv.split('\n').filter(Boolean).map(line => {
      const [transaction_date, description, w, d] = line.split(',').map(x => x.trim());
      return { transaction_date, description, debit_withdrawal: parseFloat(w || 0), credit_deposit: parseFloat(d || 0) };
    }) : [];
    const res = await this.api('/bank-reconciliations', 'POST', {
      bank_account_id: document.getElementById('fin-rec-bank').value,
      closing_statement_balance: parseFloat(document.getElementById('fin-rec-bal').value || 0),
      statement_start_date: document.getElementById('fin-rec-start').value,
      statement_end_date: document.getElementById('fin-rec-end').value,
      statement_lines: lines
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  async completeReconciliation(id) {
    const res = await this.api(`/bank-reconciliations/${id}/complete`, 'POST', {});
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 7. EXPENSES & BUDGETS TAB
  // ==========================================================================
  async renderExpensesTab() {
    const [expRes, budRes] = await Promise.all([this.api('/expenses'), this.api('/budgets/vs-actual')]);
    const exps = expRes.data || [];
    const budgets = budRes.data || [];

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <h3 style="margin:0; font-size:1rem;">💳 Expenses, Claims & Budgets</h3>
        <div style="display:flex; gap:8px;">
          <button class="secondary-btn" onclick="FinanceModule.openBudgetModal()">🎯 + Set Account Budget</button>
          <button class="primary-btn" onclick="FinanceModule.openExpenseModal()">💳 + Record Expense</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:18px;">
        <div class="card-header"><h4 style="margin:0;">🎯 Budget vs. Actual Variance</h4></div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Account / Category</th><th style="text-align:right;">Budget</th><th style="text-align:right;">Actual</th><th style="text-align:right;">Variance</th><th style="text-align:right;">Utilization</th></tr></thead>
          <tbody>${budgets.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:16px; color:#64748b;">No budgets defined yet.</td></tr>` : budgets.map(b => `<tr><td>${this.esc(b.account_name || b.category_name)}</td><td style="text-align:right;">${this.fmt(b.budget_amount)}</td><td style="text-align:right;">${this.fmt(b.actual_amount)}</td><td style="text-align:right; color:${b.variance >= 0 ? '#059669' : '#dc2626'}; font-weight:700;">${this.fmt(b.variance)}</td><td style="text-align:right;">${b.utilization_pct}%</td></tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div class="card">
        <div class="card-header"><h4 style="margin:0;">🧾 Expense Vouchers Register</h4></div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Date</th><th>Title / Claim</th><th>Category</th><th>Payment Mode</th><th style="text-align:right;">Amount</th><th>Status</th></tr></thead>
          <tbody>${exps.slice(0, 30).map(e => `<tr><td>${this.fdate(e.expense_date)}</td><td style="font-weight:600;">${this.esc(e.expense_name || e.title)}</td><td>${this.esc(e.category)}</td><td>${this.esc(e.payment_mode || 'Bank')}</td><td style="text-align:right; font-weight:700;">${this.fmt(e.amount)}</td><td><span class="badge badge-won">${this.esc(e.status || 'Approved')}</span></td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    `;
  },

  openExpenseModal() {
    const expCoa = (this._cache.coa || []).filter(a => a.account_type === 'Expense').map(a => `<option value="${a.id}">[${this.esc(a.account_code)}] ${this.esc(a.account_name)}</option>`).join('');
    const banks = (this._cache.bankAccounts || []).map(b => `<option value="${b.id}">${this.esc(b.account_name)}</option>`).join('');
    this.modal('💳 Record Expense Voucher', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitExpenseForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Expense Title *</label><input class="form-input" id="fin-exp-name" required placeholder="Office Electricity Bill"></div>
          <div class="form-group"><label class="form-label">Date *</label><input type="date" class="form-input" id="fin-exp-date" value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Expense GL Account</label><select class="form-select" id="fin-exp-coa">${expCoa}</select></div>
          <div class="form-group"><label class="form-label">Pay From Bank/Cash</label><select class="form-select" id="fin-exp-bank">${banks}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Total Amount *</label><input type="number" step="0.01" class="form-input" id="fin-exp-amt" required></div>
          <div class="form-group"><label class="form-label">Included Tax</label><input type="number" step="0.01" class="form-input" id="fin-exp-tax" value="0"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Post Expense</button></div>
      </form>
    `);
  },

  async submitExpenseForm() {
    const res = await this.api('/expenses', 'POST', {
      expense_name: document.getElementById('fin-exp-name').value,
      expense_date: document.getElementById('fin-exp-date').value,
      coa_account_id: document.getElementById('fin-exp-coa').value,
      bank_account_id: document.getElementById('fin-exp-bank').value || null,
      amount: parseFloat(document.getElementById('fin-exp-amt').value || 0),
      tax_amount: parseFloat(document.getElementById('fin-exp-tax').value || 0),
      status: 'Approved'
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  openBudgetModal() {
    const expCoa = (this._cache.coa || []).filter(a => a.account_type === 'Expense').map(a => `<option value="${a.id}">[${this.esc(a.account_code)}] ${this.esc(a.account_name)}</option>`).join('');
    this.modal('🎯 Set Account Expense Budget', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitBudgetForm();">
        <div class="form-group"><label class="form-label">Expense GL Account *</label><select class="form-select" id="fin-bud-coa">${expCoa}</select></div>
        <div class="form-group"><label class="form-label">Budget Amount *</label><input type="number" step="0.01" class="form-input" id="fin-bud-amt" required></div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Save Budget</button></div>
      </form>
    `);
  },

  async submitBudgetForm() {
    const res = await this.api('/budgets', 'POST', {
      coa_account_id: document.getElementById('fin-bud-coa').value,
      budget_amount: parseFloat(document.getElementById('fin-bud-amt').value || 0)
    });
    if (res.success) { this.closeModal(); showToast('✓ Budget saved.', 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 8. TAX MANAGEMENT TAB
  // ==========================================================================
  async renderTaxTab() {
    const sumRes = await this.api('/tax-summary');
    const s = sumRes.data || {};
    const codes = this._cache.taxCodes || [];

    return `
      <div style="padding:10px 14px; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; margin-bottom:14px; font-size:0.82rem; color:#92400e;">
        ⚠️ <strong>Tax Compliance Notice:</strong> ${this.esc(s.disclaimer || 'All tax rates are configurable. Verify statutory rules before filing.')}
      </div>

      <div class="kpi-grid" style="margin-bottom:16px;">
        <div class="kpi-card"><div class="kpi-label">Output Sales Tax</div><div class="kpi-value" style="color:#dc2626;">${this.fmt(s.output_sales_tax)}</div><div class="kpi-trend">${s.sales_invoice_count || 0} Invoices</div></div>
        <div class="kpi-card"><div class="kpi-label">Input Purchase Tax</div><div class="kpi-value" style="color:#059669;">${this.fmt(s.input_purchase_tax)}</div><div class="kpi-trend">${s.supplier_bill_count || 0} Bills</div></div>
        <div class="kpi-card"><div class="kpi-label">Net Sales Tax Payable</div><div class="kpi-value" style="color:#0284c7;">${this.fmt(s.net_sales_tax_payable)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Withholding Tax (AR / AP)</div><div class="kpi-value">${this.fmt(s.wht_deducted_by_customers)}</div><div class="kpi-trend">Vendor Withheld: ${this.fmt(s.wht_withheld_from_suppliers)}</div></div>
      </div>

      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:1rem;">🏛️ Configurable Company Tax Codes</h3>
          <button class="primary-btn" onclick="FinanceModule.openTaxCodeModal()">➕ Add Tax Code</button>
        </div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Code</th><th>Tax Name</th><th>Category</th><th style="text-align:right;">Rate (%)</th><th>Mode</th><th>Linked GL</th><th>Status</th></tr></thead>
          <tbody>${codes.map(c => `<tr><td style="font-family:monospace; font-weight:700;">${this.esc(c.code)}</td><td>${this.esc(c.name)}</td><td>${this.esc(c.tax_category)}</td><td style="text-align:right; font-weight:700;">${parseFloat(c.rate_pct).toFixed(2)}%</td><td>${c.is_exempt ? 'Exempt' : (c.is_inclusive ? 'Inclusive' : 'Exclusive')}</td><td>${c.account_code ? `[${this.esc(c.account_code)}] ${this.esc(c.account_name)}` : '—'}</td><td><span class="badge ${c.is_active ? 'badge-won' : 'badge-lost'}">${c.is_active ? 'Active' : 'Inactive'}</span></td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    `;
  },

  openTaxCodeModal() {
    const coaOpts = `<option value="">-- Default --</option>` + (this._cache.coa || []).map(a => `<option value="${a.id}">[${this.esc(a.account_code)}] ${this.esc(a.account_name)}</option>`).join('');
    this.modal('🏛️ Add Configurable Tax Code', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitTaxCodeForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Tax Code *</label><input class="form-input" id="fin-tc-code" required placeholder="e.g. SRB-13"></div>
          <div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="fin-tc-name" required placeholder="Sindh Sales Tax 13%"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Category</label><select class="form-select" id="fin-tc-cat"><option value="Sales">Sales</option><option value="Purchase">Purchase</option><option value="Withholding">Withholding</option><option value="Both">Both</option></select></div>
          <div class="form-group"><label class="form-label">Rate (%)</label><input type="number" step="0.01" class="form-input" id="fin-tc-rate" value="18"></div>
          <div class="form-group"><label class="form-label">Tax GL Account</label><select class="form-select" id="fin-tc-acc">${coaOpts}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group" style="display:flex; gap:8px; align-items:center;"><input type="checkbox" id="fin-tc-incl"><label for="fin-tc-incl">Tax Inclusive</label></div>
          <div class="form-group" style="display:flex; gap:8px; align-items:center;"><input type="checkbox" id="fin-tc-ex"><label for="fin-tc-ex">Tax Exempt (0%)</label></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Save Tax Code</button></div>
      </form>
    `);
  },

  async submitTaxCodeForm() {
    const res = await this.api('/tax-codes', 'POST', {
      code: document.getElementById('fin-tc-code').value,
      name: document.getElementById('fin-tc-name').value,
      tax_category: document.getElementById('fin-tc-cat').value,
      rate_pct: parseFloat(document.getElementById('fin-tc-rate').value || 0),
      tax_account_id: document.getElementById('fin-tc-acc').value || null,
      is_inclusive: document.getElementById('fin-tc-incl').checked,
      is_exempt: document.getElementById('fin-tc-ex').checked
    });
    if (res.success) { this.closeModal(); showToast('✓ Tax code saved.', 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 9. FIXED ASSETS TAB
  // ==========================================================================
  async renderAssetsTab() {
    const res = await this.api('/fixed-assets');
    const assets = res.data || [];
    const totalCost = assets.reduce((s, a) => s + parseFloat(a.acquisition_cost || 0), 0);
    const totalNbv = assets.reduce((s, a) => s + parseFloat(a.net_book_value || 0), 0);

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px;">
        <div>
          <h3 style="margin:0; font-size:1rem;">🏗️ Fixed Assets Register & Depreciation Engine</h3>
          <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Total Cost: <strong>${this.fmt(totalCost)}</strong> | Net Book Value: <strong style="color:#0284c7;">${this.fmt(totalNbv)}</strong></p>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="secondary-btn" onclick="FinanceModule.runMonthlyDepreciation()">📉 Run This Month's Depreciation</button>
          <button class="primary-btn" onclick="FinanceModule.openAssetModal()">➕ Register Asset</button>
        </div>
      </div>
      <div class="card"><div class="card-body" style="padding:0;"><table class="data-table">
        <thead><tr><th>Asset Code</th><th>Name</th><th>Category</th><th>Method</th><th style="text-align:right;">Cost</th><th style="text-align:right;">Accum. Dep</th><th style="text-align:right;">Net Book Value</th><th>Status</th><th style="text-align:center;">Action</th></tr></thead>
        <tbody>
          ${assets.length === 0 ? `<tr><td colspan="9" style="text-align:center; padding:20px; color:#64748b;">No fixed assets registered.</td></tr>` : assets.map(a => `
            <tr>
              <td style="font-family:monospace; font-weight:700;">${this.esc(a.asset_code)}</td>
              <td style="font-weight:600;">${this.esc(a.asset_name)}</td>
              <td>${this.esc(a.category)}</td>
              <td>${this.esc(a.depreciation_method)} (${a.useful_life_years}y)</td>
              <td style="text-align:right; font-family:monospace;">${this.fmt(a.acquisition_cost)}</td>
              <td style="text-align:right; font-family:monospace; color:#dc2626;">${this.fmt(a.accumulated_depreciation)}</td>
              <td style="text-align:right; font-family:monospace; font-weight:800;">${this.fmt(a.net_book_value)}</td>
              <td><span class="badge ${a.status === 'Active' ? 'badge-won' : 'badge-lost'}">${this.esc(a.status)}</span></td>
              <td style="text-align:center;">${a.status === 'Active' ? `<button class="secondary-btn" style="padding:3px 7px; font-size:0.72rem;" onclick="FinanceModule.disposeAssetPrompt('${a.id}', '${this.esc(a.asset_code)}')">Dispose</button>` : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table></div></div>
    `;
  },

  openAssetModal() {
    this.modal('🏗️ Register Fixed Asset', `
      <form onsubmit="event.preventDefault(); FinanceModule.submitAssetForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Asset Code *</label><input class="form-input" id="fin-fa-code" required value="FA-${Date.now().toString().slice(-4)}"></div>
          <div class="form-group"><label class="form-label">Asset Name *</label><input class="form-input" id="fin-fa-name" required placeholder="CNC Lathe Machine"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Acquisition Cost *</label><input type="number" step="0.01" class="form-input" id="fin-fa-cost" required></div>
          <div class="form-group"><label class="form-label">Salvage Value</label><input type="number" step="0.01" class="form-input" id="fin-fa-salv" value="0"></div>
          <div class="form-group"><label class="form-label">Useful Life (Years)</label><input type="number" step="0.5" class="form-input" id="fin-fa-life" value="5"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Method</label><select class="form-select" id="fin-fa-meth"><option value="Straight-Line">Straight-Line</option><option value="Reducing Balance">Reducing Balance</option></select></div>
          <div class="form-group"><label class="form-label">Acquisition Date</label><input type="date" class="form-input" id="fin-fa-date" value="${new Date().toISOString().slice(0, 10)}"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="FinanceModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Capitalize & Register</button></div>
      </form>
    `);
  },

  async submitAssetForm() {
    const res = await this.api('/fixed-assets', 'POST', {
      asset_code: document.getElementById('fin-fa-code').value,
      asset_name: document.getElementById('fin-fa-name').value,
      acquisition_cost: parseFloat(document.getElementById('fin-fa-cost').value || 0),
      salvage_value: parseFloat(document.getElementById('fin-fa-salv').value || 0),
      useful_life_years: parseFloat(document.getElementById('fin-fa-life').value || 5),
      depreciation_method: document.getElementById('fin-fa-meth').value,
      acquisition_date: document.getElementById('fin-fa-date').value
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  async runMonthlyDepreciation() {
    const now = new Date();
    const res = await this.api('/fixed-assets/run-depreciation', 'POST', { year: now.getFullYear(), month: now.getMonth() + 1 });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  async disposeAssetPrompt(id, code) {
    const proceeds = prompt(`Enter disposal sale proceeds (PKR) for asset ${code}:`, '0');
    if (proceeds === null) return;
    const res = await this.api(`/fixed-assets/${id}/dispose`, 'POST', { disposal_proceeds: parseFloat(proceeds || 0) });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 10. FINANCIAL STATEMENTS TAB (P&L, Balance Sheet, Cash Flow, Trial Balance)
  // ==========================================================================
  async renderStatementsTab() {
    const [pnlRes, bsRes, cfRes, tbRes] = await Promise.all([
      this.api('/statements/profit-loss'),
      this.api('/statements/balance-sheet'),
      this.api('/statements/cash-flow'),
      this.api('/statements/trial-balance')
    ]);
    const pnl = pnlRes.data?.current || { revenue: [], cogs: [], expenses: [], summary: {} };
    const bs = bsRes.data || { assets: [], liabilities: [], equity: [], summary: {} };
    const cf = cfRes.data || { operating_activities: {}, investing_activities: {}, financing_activities: {}, reconciliation: {} };
    const tb = tbRes.data || { rows: [], totals: {} };

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
        <div style="display:flex; gap:6px;">
          ${['pnl', 'bs', 'cf', 'tb'].map(s => `
            <button class="${this.stmtSubTab === s ? 'primary-btn' : 'secondary-btn'}" style="padding:6px 12px; font-size:0.8rem;" onclick="FinanceModule.stmtSubTab='${s}'; renderActiveView();">
              ${s === 'pnl' ? '📊 Profit & Loss' : s === 'bs' ? '⚖️ Balance Sheet' : s === 'cf' ? '💵 Cash Flow' : '📒 Trial Balance'}
            </button>
          `).join('')}
        </div>
        <button class="secondary-btn" onclick="window.print()">🖨️ Print Statement</button>
      </div>

      ${this.stmtSubTab === 'pnl' ? `
        <div class="card" style="padding:18px;">
          <h3 style="margin-top:0;">📊 Profit & Loss Statement (Income Statement)</h3>
          <table class="data-table">
            <thead><tr><th>Account</th><th style="text-align:right;">Amount</th></tr></thead>
            <tbody>
              <tr style="background:#f8fafc; font-weight:700;"><td colspan="2">REVENUE</td></tr>
              ${pnl.revenue.map(r => `<tr><td>[${this.esc(r.account_code)}] ${this.esc(r.account_name)}</td><td style="text-align:right;">${this.fmt(r.amount)}</td></tr>`).join('')}
              <tr style="font-weight:800;"><td>Total Revenue</td><td style="text-align:right; color:#059669;">${this.fmt(pnl.summary.total_revenue)}</td></tr>
              <tr style="background:#f8fafc; font-weight:700;"><td colspan="2">COST OF GOODS SOLD</td></tr>
              ${pnl.cogs.map(r => `<tr><td>[${this.esc(r.account_code)}] ${this.esc(r.account_name)}</td><td style="text-align:right;">${this.fmt(r.amount)}</td></tr>`).join('')}
              <tr style="font-weight:800; background:#eff6ff;"><td>Gross Profit</td><td style="text-align:right;">${this.fmt(pnl.summary.gross_profit)}</td></tr>
              <tr style="background:#f8fafc; font-weight:700;"><td colspan="2">OPERATING EXPENSES</td></tr>
              ${pnl.expenses.map(r => `<tr><td>[${this.esc(r.account_code)}] ${this.esc(r.account_name)}</td><td style="text-align:right;">${this.fmt(r.amount)}</td></tr>`).join('')}
              <tr style="font-weight:900; font-size:1.05rem; background:#ecfdf5;"><td>NET PROFIT / (LOSS)</td><td style="text-align:right; color:${pnl.summary.net_profit >= 0 ? '#059669' : '#dc2626'};">${this.fmt(pnl.summary.net_profit)}</td></tr>
            </tbody>
          </table>
        </div>
      ` : this.stmtSubTab === 'bs' ? `
        <div class="card" style="padding:18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h3 style="margin:0;">⚖️ Balance Sheet (As of ${this.esc(bs.as_of_date)})</h3>
            <span class="badge ${bs.summary.is_balanced ? 'badge-won' : 'badge-lost'}">${bs.summary.is_balanced ? '✓ Assets = Liabilities + Equity' : `Variance: ${bs.summary.variance}`}</span>
          </div>
          <table class="data-table">
            <thead><tr><th>Account</th><th style="text-align:right;">Balance</th></tr></thead>
            <tbody>
              <tr style="background:#f8fafc; font-weight:700;"><td colspan="2">ASSETS</td></tr>
              ${bs.assets.map(a => `<tr><td>[${this.esc(a.account_code)}] ${this.esc(a.account_name)}</td><td style="text-align:right;">${this.fmt(a.balance)}</td></tr>`).join('')}
              <tr style="font-weight:800; background:#eff6ff;"><td>TOTAL ASSETS</td><td style="text-align:right; color:#0284c7;">${this.fmt(bs.summary.total_assets)}</td></tr>
              <tr style="background:#f8fafc; font-weight:700;"><td colspan="2">LIABILITIES</td></tr>
              ${bs.liabilities.map(l => `<tr><td>[${this.esc(l.account_code)}] ${this.esc(l.account_name)}</td><td style="text-align:right;">${this.fmt(l.balance)}</td></tr>`).join('')}
              <tr style="font-weight:700;"><td>Total Liabilities</td><td style="text-align:right;">${this.fmt(bs.summary.total_liabilities)}</td></tr>
              <tr style="background:#f8fafc; font-weight:700;"><td colspan="2">EQUITY & RETAINED EARNINGS</td></tr>
              ${bs.equity.map(e => `<tr><td>[${this.esc(e.account_code)}] ${this.esc(e.account_name)}</td><td style="text-align:right;">${this.fmt(e.balance)}</td></tr>`).join('')}
              <tr><td>Current Period Net Earnings</td><td style="text-align:right;">${this.fmt(bs.summary.current_year_earnings)}</td></tr>
              <tr style="font-weight:800; background:#ecfdf5;"><td>TOTAL LIABILITIES & EQUITY</td><td style="text-align:right; color:#059669;">${this.fmt(bs.summary.total_liabilities_and_equity)}</td></tr>
            </tbody>
          </table>
        </div>
      ` : this.stmtSubTab === 'cf' ? `
        <div class="card" style="padding:18px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h3 style="margin:0;">💵 Cash Flow Statement (${this.esc(cf.methodology)})</h3>
            <span class="badge ${cf.reconciliation.reconciles ? 'badge-won' : 'badge-lost'}">${cf.reconciliation.reconciles ? '✓ Reconciles to Cash & Bank' : 'Check Variance'}</span>
          </div>
          <table class="data-table">
            <tbody>
              <tr style="background:#f8fafc; font-weight:700;"><td colspan="2">OPERATING ACTIVITIES</td></tr>
              <tr><td>Net Profit / (Loss)</td><td style="text-align:right;">${this.fmt(cf.operating_activities.net_profit)}</td></tr>
              <tr><td>Non-Cash Depreciation Add-back</td><td style="text-align:right;">${this.fmt(cf.operating_activities.depreciation_addback)}</td></tr>
              <tr><td>Working Capital Changes (AR / Inv / AP)</td><td style="text-align:right;">${this.fmt(cf.operating_activities.working_capital_changes)}</td></tr>
              <tr style="font-weight:800; background:#eff6ff;"><td>Net Cash From Operating Activities</td><td style="text-align:right;">${this.fmt(cf.operating_activities.net_operating_cash)}</td></tr>
              <tr style="font-weight:800;"><td>Net Cash From Investing Activities</td><td style="text-align:right;">${this.fmt(cf.investing_activities.net_investing_cash)}</td></tr>
              <tr style="font-weight:800;"><td>Net Cash From Financing Activities</td><td style="text-align:right;">${this.fmt(cf.financing_activities.net_financing_cash)}</td></tr>
              <tr style="background:#f8fafc; font-weight:700;"><td>Opening Cash & Bank</td><td style="text-align:right;">${this.fmt(cf.reconciliation.opening_cash_and_bank)}</td></tr>
              <tr style="font-weight:900; background:#ecfdf5;"><td>Closing Cash & Bank</td><td style="text-align:right; color:#059669;">${this.fmt(cf.reconciliation.closing_cash_and_bank)}</td></tr>
            </tbody>
          </table>
        </div>
      ` : `
        <div class="card"><div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>Code</th><th>Account</th><th style="text-align:right;">Period Dr</th><th style="text-align:right;">Period Cr</th><th style="text-align:right;">Closing Dr</th><th style="text-align:right;">Closing Cr</th></tr></thead>
          <tbody>
            ${tb.rows.map(r => `<tr><td style="font-family:monospace; font-weight:700;">${this.esc(r.account_code)}</td><td>${this.esc(r.account_name)}</td><td style="text-align:right;">${this.fmt(r.period_debit)}</td><td style="text-align:right;">${this.fmt(r.period_credit)}</td><td style="text-align:right; font-weight:700;">${this.fmt(r.closing_debit)}</td><td style="text-align:right; font-weight:700;">${this.fmt(r.closing_credit)}</td></tr>`).join('')}
            <tr style="background:#f1f5f9; font-weight:900;"><td colspan="2">TOTALS (${tb.totals.is_balanced ? '✓ BALANCED' : 'UNBALANCED'})</td><td style="text-align:right;">${this.fmt(tb.totals.period_debit)}</td><td style="text-align:right;">${this.fmt(tb.totals.period_credit)}</td><td style="text-align:right;">${this.fmt(tb.totals.closing_debit)}</td><td style="text-align:right;">${this.fmt(tb.totals.closing_credit)}</td></tr>
          </tbody>
        </table></div></div>
      `}
    `;
  },

  // ==========================================================================
  // 11. COMPANY ACCOUNTING CONFIG, PERIOD CLOSING & INTEGRATIONS
  // ==========================================================================
  async renderSettingsTab() {
    const [setRes, fyRes] = await Promise.all([this.api('/settings'), this.api('/fiscal-years')]);
    const s = setRes.data || {};
    const periods = fyRes.data?.periods || [];

    return `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:start;">
        <div class="card" style="padding:18px;">
          <h3 style="margin-top:0;">⚙️ Accounting Policy & Integration Switches</h3>
          <form onsubmit="event.preventDefault(); FinanceModule.saveCompanySettings();">
            <div class="form-row">
              <div class="form-group"><label class="form-label">Base Currency</label><input class="form-input" id="fin-set-curr" value="${this.esc(s.base_currency || 'PKR')}"></div>
              <div class="form-group"><label class="form-label">Journal Approval Threshold</label><input type="number" class="form-input" id="fin-set-thresh" value="${s.journal_approval_threshold || 500000}"></div>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:12px 0; font-size:0.85rem;">
              <label><input type="checkbox" id="fin-set-lock" ${s.enforce_period_locking !== false ? 'checked' : ''}> Enforce Closed Period Lock</label>
              <label><input type="checkbox" id="fin-set-reqapp" ${s.require_journal_approval ? 'checked' : ''}> Require JV Approval</label>
              <label><input type="checkbox" id="fin-set-mc" ${s.multi_currency_enabled ? 'checked' : ''}> Enable Multi-Currency</label>
              <label><input type="checkbox" id="fin-set-int-inv" ${s.enable_inventory_integration !== false ? 'checked' : ''}> Inventory Cost Integration</label>
              <label><input type="checkbox" id="fin-set-int-tnd" ${s.enable_tender_integration !== false ? 'checked' : ''}> Tender Award Integration</label>
              <label><input type="checkbox" id="fin-set-int-pay" ${s.enable_payroll_integration !== false ? 'checked' : ''}> Payroll Posting Integration</label>
            </div>
            <button type="submit" class="primary-btn">💾 Save Accounting Settings</button>
          </form>
        </div>

        <div class="card">
          <div class="card-header"><h3 style="margin:0; font-size:1rem;">📅 Fiscal Accounting Periods</h3></div>
          <div class="card-body" style="padding:0; max-height:380px; overflow-y:auto;"><table class="data-table">
            <thead><tr><th>Period</th><th>Dates</th><th>Status</th><th style="text-align:center;">Action</th></tr></thead>
            <tbody>${periods.map(p => `
              <tr>
                <td style="font-weight:700;">${this.esc(p.period_name)}</td>
                <td style="font-size:0.78rem;">${this.fdate(p.start_date)} – ${this.fdate(p.end_date)}</td>
                <td><span class="badge ${p.status === 'Open' ? 'badge-won' : (p.status === 'Closed' ? 'badge-lost' : 'badge-submitted')}">${this.esc(p.status)}</span></td>
                <td style="text-align:center;">
                  ${p.status !== 'Closed' ? `<button class="secondary-btn" style="padding:2px 7px; font-size:0.72rem;" onclick="FinanceModule.setPeriodStatus('${p.id}', 'Closed')">Close</button>` : `<button class="secondary-btn" style="padding:2px 7px; font-size:0.72rem;" onclick="FinanceModule.setPeriodStatus('${p.id}', 'Open')">Reopen</button>`}
                </td>
              </tr>
            `).join('')}</tbody>
          </table></div>
        </div>
      </div>
    `;
  },

  async saveCompanySettings() {
    const res = await this.api('/settings', 'PUT', {
      base_currency: document.getElementById('fin-set-curr').value,
      journal_approval_threshold: parseFloat(document.getElementById('fin-set-thresh').value || 500000),
      enforce_period_locking: document.getElementById('fin-set-lock').checked,
      require_journal_approval: document.getElementById('fin-set-reqapp').checked,
      multi_currency_enabled: document.getElementById('fin-set-mc').checked,
      enable_inventory_integration: document.getElementById('fin-set-int-inv').checked,
      enable_tender_integration: document.getElementById('fin-set-int-tnd').checked,
      enable_payroll_integration: document.getElementById('fin-set-int-pay').checked
    });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  async setPeriodStatus(id, status) {
    const res = await this.api(`/periods/${id}/status`, 'POST', { status });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 12. AUDIT LOGS & AUTOMATED POSTING EVENTS TAB
  // ==========================================================================
  async renderAuditTab() {
    const [audRes, evRes] = await Promise.all([this.api('/audit-logs'), this.api('/posting-events')]);
    const logs = audRes.data || [];
    const events = evRes.data || [];

    return `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px;">
        <div class="card">
          <div class="card-header"><h4 style="margin:0;">🛡️ Immutable Finance Audit Trail</h4></div>
          <div class="card-body" style="padding:0; max-height:420px; overflow-y:auto;"><table class="data-table">
            <thead><tr><th>Time</th><th>User</th><th>Entity</th><th>Action</th></tr></thead>
            <tbody>${logs.map(l => `<tr><td style="font-size:0.75rem;">${this.fdate(l.created_at)}</td><td>${this.esc(l.user_name)}</td><td>${this.esc(l.entity_type)}</td><td><span class="badge">${this.esc(l.action)}</span></td></tr>`).join('')}</tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-header"><h4 style="margin:0;">⚡ Idempotent Posting Event Ledger</h4></div>
          <div class="card-body" style="padding:0; max-height:420px; overflow-y:auto;"><table class="data-table">
            <thead><tr><th>Module</th><th>Event Type</th><th>Source #</th><th>Journal #</th><th>Status</th></tr></thead>
            <tbody>${events.map(e => `<tr><td>${this.esc(e.source_module)}</td><td>${this.esc(e.event_type)}</td><td>${this.esc(e.source_number)}</td><td style="font-family:monospace;">${this.esc(e.entry_number || '—')}</td><td><span class="badge badge-won">${this.esc(e.status)}</span></td></tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
    `;
  },

  async runSyncSubledgers() {
    const res = await this.api('/sync-subledgers', 'POST', {});
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  filterTable(tableId, query) {
    const q = (query || '').toLowerCase();
    document.querySelectorAll(`#${tableId} tbody tr`).forEach(tr => {
      tr.style.display = tr.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
  }
};

