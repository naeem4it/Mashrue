/**
 * ============================================================================
 * MASHRUE ENTERPRISE MANUFACTURING SUITE — FRONTEND CONTROLLER
 * ============================================================================
 * Complete, independently usable Manufacturing & Production Control UI:
 *  1. Planning Board & KPIs (with clear Finance standalone notice)
 *  2. Multi-Level BOM Studio (Create, Versioning, Activate/Archive, MRP Check)
 *  3. Production Work Orders (Draft -> Approve -> Release/Reserve -> Execute -> Close/Cancel)
 *  4. Shop Floor Actions (Material Issue, Additional Consumption, Return, Scrap, Partial/Full Receipt)
 *  5. MRP Shortages & Cross-Order Material Requirements
 *  6. Work Centres, UOM Conversions & Manufacturing Settings
 *  7. Costing Variance, Yield/Scrap & Output Traceability Reports
 * ============================================================================
 */

window.ManufacturingModule = {
  activeTab: 'dashboard',
  _cache: {
    boms: [],
    workOrders: [],
    workCentres: [],
    products: [],
    warehouses: [],
    settings: null,
    uomConversions: []
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
      const res = await fetch(`${base}/manufacturing${endpoint}`, opts);
      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.message || json.error || `HTTP ${res.status}`);
      }
      return json;
    } catch (err) {
      if (typeof showToast === 'function' && method !== 'GET') {
        showToast(`Manufacturing Error: ${err.message}`, 'error');
      }
      return { success: false, message: err.message, data: null };
    }
  },

  switchTab(tab) {
    this.activeTab = tab;
    const viewMap = {
      'dashboard': 'manufacturing',
      'boms': 'mfg-boms',
      'orders': 'mfg-orders',
      'mrp': 'mfg-mrp',
      'config': 'mfg-config',
      'reports': 'mfg-reports'
    };
    const nextView = viewMap[tab] || 'manufacturing';
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

  modal(title, html, width = '760px') {
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
    const [bomsRes, woRes, wcRes, prodList, whList, setRes, convRes] = await Promise.all([
      this.api('/boms?include_archived=true'),
      this.api('/work-orders'),
      this.api('/work-centres'),
      typeof API !== 'undefined' && API.getProducts ? API.getProducts() : Promise.resolve([]),
      typeof API !== 'undefined' && API.getWarehouses ? API.getWarehouses() : Promise.resolve([]),
      this.api('/settings'),
      this.api('/uom-conversions')
    ]);
    this._cache.boms = bomsRes.data || [];
    this._cache.workOrders = woRes.data || [];
    this._cache.workCentres = wcRes.data || [];
    this._cache.products = Array.isArray(prodList) ? prodList : (prodList?.data || []);
    this._cache.warehouses = Array.isArray(whList) ? whList : (whList?.data || []);
    this._cache.settings = setRes.data || {};
    this._cache.uomConversions = convRes.data || [];
  },

  // ==========================================================================
  // MASTER SHELL
  // ==========================================================================
  async renderHTML() {
    await this.preloadLookups();

    const tabs = [
      { key: 'dashboard', label: '📊 Planning Board' },
      { key: 'boms', label: '📐 BOM Studio' },
      { key: 'orders', label: '🏭 Work Orders' },
      { key: 'mrp', label: '📦 MRP & Shortages' },
      { key: 'config', label: '⚙️ Work Centres & Config' },
      { key: 'reports', label: '📈 Costing & Reports' }
    ];

    let bodyHtml = '';
    if (this.activeTab === 'dashboard') bodyHtml = await this.renderDashboardTab();
    else if (this.activeTab === 'boms') bodyHtml = await this.renderBomsTab();
    else if (this.activeTab === 'orders') bodyHtml = await this.renderWorkOrdersTab();
    else if (this.activeTab === 'mrp') bodyHtml = await this.renderMrpTab();
    else if (this.activeTab === 'config') bodyHtml = await this.renderConfigTab();
    else if (this.activeTab === 'reports') bodyHtml = await this.renderReportsTab();

    return `<div id="mfg-tab-content">${bodyHtml}</div>`;
  },

  // ==========================================================================
  // 1. PLANNING BOARD & KPIs
  // ==========================================================================
  async renderDashboardTab() {
    const res = await this.api('/dashboard');
    const d = res.data || {};
    const k = d.kpis || {};
    const finAvail = d.finance_posting_available;
    const recent = d.recent_work_orders || [];

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:14px; padding:12px 16px; background:${finAvail ? '#ecfdf5' : '#fffbeb'}; border:1px solid ${finAvail ? '#a7f3d0' : '#fde68a'}; border-radius:10px;">
        <div style="font-size:0.84rem; color:${finAvail ? '#065f46' : '#92400e'};">
          ${finAvail
            ? '🔗 <strong>Finance GL Integration Active:</strong> Approved COGM production receipts automatically post balanced capitalization entries.'
            : 'ℹ️ <strong>Standalone Manufacturing Mode:</strong> Financial GL posting is currently unavailable or disabled. Stock quantities, costing, and production receipts operate normally without Finance.'}
        </div>
        <div style="display:flex; gap:8px;">
          <button class="secondary-btn" onclick="ManufacturingModule.openBomModal()">📐 + New BOM</button>
          <button class="primary-btn" onclick="ManufacturingModule.openWorkOrderModal()">🏭 + Plan Work Order</button>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom:18px;">
        <div class="kpi-card">
          <div class="kpi-label">📐 Active BOM Recipes</div>
          <div class="kpi-value" style="color:#0284c7;">${k.active_boms || 0}</div>
          <div class="kpi-trend">${k.total_boms || 0} Total Versions</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">🏭 Active Work Orders</div>
          <div class="kpi-value" style="color:#d97706;">${k.active_work_orders || 0}</div>
          <div class="kpi-trend">${k.completed_work_orders || 0} Completed & Closed</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">📦 Finished Units Produced</div>
          <div class="kpi-value" style="color:#059669;">${Number(k.total_units_produced || 0).toLocaleString()}</div>
          <div class="kpi-trend">Received into FG Warehouses</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">💰 Total Production Cost (COGM)</div>
          <div class="kpi-value" style="color:#0f172a;">${this.fmt(k.total_cogm)}</div>
          <div class="kpi-trend">Scrap Cost: ${this.fmt(k.total_scrap_cost)}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3 style="margin:0; font-size:1rem;">🗓️ Shop Floor Production Queue</h3></div>
        <div class="card-body" style="padding:0;"><div class="table-responsive"><table class="data-table">
          <thead><tr><th>Order #</th><th>Finished Good</th><th>Work Centre</th><th style="text-align:right;">Progress (Produced / Target)</th><th style="text-align:right;">Total Cost</th><th>Status</th><th style="text-align:center;">Inspect</th></tr></thead>
          <tbody>
            ${recent.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:22px; color:#64748b;">No work orders planned yet.</td></tr>` : recent.map(w => `
              <tr>
                <td style="font-family:monospace; font-weight:700; color:#0284c7;">${this.esc(w.order_number)}</td>
                <td style="font-weight:600;">${this.esc(w.product_name)} <span style="font-size:0.75rem; color:#64748b;">[${this.esc(w.sku || '')}]</span></td>
                <td>${this.esc(w.centre_name || 'Main Line')}</td>
                <td style="text-align:right; font-family:monospace; font-weight:700;">${parseFloat(w.produced_quantity || 0)} / ${parseFloat(w.target_quantity || 0)}</td>
                <td style="text-align:right; font-family:monospace;">${this.fmt(w.total_production_cost)}</td>
                <td><span class="badge ${w.status === 'Completed' || w.status === 'Closed' ? 'badge-won' : (w.status === 'Cancelled' ? 'badge-lost' : 'badge-submitted')}">${this.esc(w.status)}</span></td>
                <td style="text-align:center;"><button class="secondary-btn" style="padding:3px 8px; font-size:0.74rem;" onclick="ManufacturingModule.openWorkOrderDetail('${w.id}')">🔍 Open</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table></div></div>
      </div>
    `;
  },

  // ==========================================================================
  // 2. BOM STUDIO TAB
  // ==========================================================================
  async renderBomsTab() {
    const boms = this._cache.boms || [];
    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1rem;">📐 Multi-Level Bills of Materials (BOM Studio)</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Versioned recipes with circular dependency protection, yield %, UOM conversion & cost roll-ups</p>
          </div>
          <div style="display:flex; gap:8px;">
            <input type="text" class="form-input" style="width:200px; padding:6px 10px;" placeholder="Search BOM..." oninput="ManufacturingModule.filterTable('table-mfg-boms', this.value)">
            <button class="primary-btn" onclick="ManufacturingModule.openBomModal()">📐 + Create BOM</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;"><div class="table-responsive"><table class="data-table" id="table-mfg-boms">
          <thead><tr><th>BOM Code</th><th>Ver</th><th>Finished Good</th><th>Batch Output & Yield</th><th>Components</th><th style="text-align:right;">Est. Unit Cost</th><th>Status</th><th style="text-align:center;">Actions</th></tr></thead>
          <tbody>
            ${boms.length === 0 ? `<tr><td colspan="8" style="text-align:center; padding:22px; color:#64748b;">No BOMs defined. Click <strong>+ Create BOM</strong>.</td></tr>` : boms.map(b => `
              <tr>
                <td style="font-family:monospace; font-weight:800; color:#0284c7;">${this.esc(b.bom_code)}</td>
                <td><span class="badge">v${b.bom_version || 1}${b.is_default ? ' ★' : ''}</span></td>
                <td style="font-weight:700;">${this.esc(b.finished_product_name)}<br><span style="font-size:0.72rem; color:#64748b;">${this.esc(b.finished_product_sku || '')}</span></td>
                <td>${b.output_quantity} ${this.esc(b.finished_product_unit || 'PCS')}<br><span style="font-size:0.72rem; color:#64748b;">Yield: ${b.expected_yield_pct || 100}%</span></td>
                <td>
                  ${(b.items || []).map(i => `<div style="font-size:0.75rem;">• ${this.esc(i.raw_material_name)}: <strong>${i.required_quantity} ${this.esc(i.unit_code || '')}</strong> (Scrap ${i.scrap_allowance_pct || 0}%)</div>`).join('')}
                </td>
                <td style="text-align:right; font-family:monospace; font-weight:700; color:#059669;">${this.fmt(b.total_estimated_unit_cost)}</td>
                <td><span class="badge ${b.status === 'Active' ? 'badge-won' : (b.status === 'Archived' ? 'badge-lost' : 'badge-submitted')}">${this.esc(b.status || 'Active')}</span></td>
                <td style="text-align:center; white-space:nowrap;">
                  <button class="secondary-btn" style="padding:3px 7px; font-size:0.72rem;" onclick="ManufacturingModule.openShortageCheckModal('${b.id}', '${this.esc(b.bom_code)}')">🔍 MRP Check</button>
                  <button class="secondary-btn" style="padding:3px 7px; font-size:0.72rem;" onclick="ManufacturingModule.createNewBomVersion('${b.id}')">🧬 +v${(b.bom_version || 1) + 1}</button>
                  ${b.status !== 'Archived' ? `<button class="secondary-btn" style="padding:3px 7px; font-size:0.72rem;" onclick="ManufacturingModule.setBomStatus('${b.id}', 'Archived')">Archive</button>` : `<button class="secondary-btn" style="padding:3px 7px; font-size:0.72rem;" onclick="ManufacturingModule.setBomStatus('${b.id}', 'Active')">Restore</button>`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div></div>
      </div>
    `;
  },

  openBomModal() {
    const prods = this._cache.products || [];
    const prodOpts = prods.map(p => `<option value="${p.id}">[${this.esc(p.sku)}] ${this.esc(p.name)} (${this.esc(p.unit || 'PCS')})</option>`).join('');
    this.modal('📐 Create Multi-Level Bill of Materials (BOM)', `
      <form onsubmit="event.preventDefault(); ManufacturingModule.submitBomForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Finished Good / Sub-Assembly *</label><select class="form-select" id="mfg-bom-fg" required>${prodOpts}</select></div>
          <div class="form-group"><label class="form-label">BOM Name</label><input class="form-input" id="mfg-bom-name" placeholder="Standard Production Recipe"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Batch Output Qty</label><input type="number" step="0.01" class="form-input" id="mfg-bom-outqty" value="1" required></div>
          <div class="form-group"><label class="form-label">Expected Yield (%)</label><input type="number" step="0.1" max="100" class="form-input" id="mfg-bom-yield" value="100"></div>
          <div class="form-group"><label class="form-label">Est. Labor Cost</label><input type="number" step="0.01" class="form-input" id="mfg-bom-labor" value="0"></div>
          <div class="form-group"><label class="form-label">Est. Overhead</label><input type="number" step="0.01" class="form-input" id="mfg-bom-ovh" value="0"></div>
        </div>
        <div style="font-weight:700; font-size:0.82rem; margin:10px 0 6px;">Component Materials</div>
        <div id="mfg-bom-lines">
          <div class="mfg-bom-row" style="display:grid; grid-template-columns:2.4fr 1fr 0.9fr 0.9fr; gap:6px; margin-bottom:6px;">
            <select class="form-select bm-prod">${prodOpts}</select>
            <input type="number" step="0.0001" class="form-input bm-qty" value="1" placeholder="Qty">
            <input type="text" class="form-input bm-unit" value="PCS" placeholder="Unit">
            <input type="number" step="0.1" class="form-input bm-scrap" value="0" placeholder="Scrap %">
          </div>
        </div>
        <button type="button" class="secondary-btn" style="padding:4px 10px; font-size:0.78rem; margin-bottom:12px;" onclick="ManufacturingModule.addBomLineRow()">➕ Add Component</button>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="ManufacturingModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Save BOM Recipe</button></div>
      </form>
    `, '820px');
  },

  addBomLineRow() {
    const prodOpts = (this._cache.products || []).map(p => `<option value="${p.id}">[${this.esc(p.sku)}] ${this.esc(p.name)} (${this.esc(p.unit || 'PCS')})</option>`).join('');
    const row = document.createElement('div');
    row.className = 'mfg-bom-row';
    row.style.cssText = 'display:grid; grid-template-columns:2.4fr 1fr 0.9fr 0.9fr; gap:6px; margin-bottom:6px;';
    row.innerHTML = `<select class="form-select bm-prod">${prodOpts}</select><input type="number" step="0.0001" class="form-input bm-qty" value="1"><input type="text" class="form-input bm-unit" value="PCS"><input type="number" step="0.1" class="form-input bm-scrap" value="0">`;
    document.getElementById('mfg-bom-lines').appendChild(row);
  },

  async submitBomForm() {
    const items = [];
    document.querySelectorAll('.mfg-bom-row').forEach(r => {
      items.push({
        raw_material_product_id: r.querySelector('.bm-prod').value,
        required_quantity: parseFloat(r.querySelector('.bm-qty').value || 1),
        unit_code: (r.querySelector('.bm-unit').value || 'PCS').trim(),
        scrap_allowance_pct: parseFloat(r.querySelector('.bm-scrap').value || 0)
      });
    });
    const res = await this.api('/boms', 'POST', {
      finished_product_id: document.getElementById('mfg-bom-fg').value,
      bom_name: document.getElementById('mfg-bom-name').value || undefined,
      output_quantity: parseFloat(document.getElementById('mfg-bom-outqty').value || 1),
      expected_yield_pct: parseFloat(document.getElementById('mfg-bom-yield').value || 100),
      labor_cost_estimate: parseFloat(document.getElementById('mfg-bom-labor').value || 0),
      overhead_cost_estimate: parseFloat(document.getElementById('mfg-bom-ovh').value || 0),
      items
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  async createNewBomVersion(id) {
    const res = await this.api(`/boms/${id}/new-version`, 'POST', {});
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  async setBomStatus(id, status) {
    const res = await this.api(`/boms/${id}/status`, 'POST', { status });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  async openShortageCheckModal(bomId, bomCode) {
    const qty = prompt(`Enter target batch quantity for MRP shortage check (${bomCode}):`, '10');
    if (!qty) return;
    const res = await this.api(`/boms/${bomId}/shortage-check?qty=${encodeURIComponent(qty)}`);
    if (!res.success || !res.data) return;
    const d = res.data;
    this.modal(`🔍 MRP Explosion & Shortage Check: ${d.bom_code} (Target: ${d.target_quantity})`, `
      <div style="margin-bottom:10px; padding:10px; border-radius:6px; background:${d.can_start_production ? '#ecfdf5' : '#fef2f2'}; color:${d.can_start_production ? '#065f46' : '#991b1b'}; font-weight:700;">
        ${d.can_start_production ? '✅ All materials are available for production!' : '⚠️ Material shortages detected! Procure missing items before release.'}
      </div>
      <table class="data-table">
        <thead><tr><th>SKU</th><th>Material</th><th style="text-align:right;">Required</th><th style="text-align:right;">Available</th><th style="text-align:right;">Shortage</th><th>Status</th></tr></thead>
        <tbody>${d.components.map(c => `<tr><td>${this.esc(c.sku)}</td><td>${this.esc(c.item_name)}</td><td style="text-align:right;">${c.required_quantity} ${this.esc(c.stock_unit)}</td><td style="text-align:right;">${c.available_stock}</td><td style="text-align:right; font-weight:700; color:${c.shortage_qty > 0 ? '#dc2626' : '#059669'};">${c.shortage_qty}</td><td><span class="badge ${c.shortage_qty > 0 ? 'badge-lost' : 'badge-won'}">${c.status}</span></td></tr>`).join('')}</tbody>
      </table>
    `);
  },

  // ==========================================================================
  // 3. PRODUCTION WORK ORDERS TAB
  // ==========================================================================
  async renderWorkOrdersTab() {
    const wos = this._cache.workOrders || [];
    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1rem;">🏭 Production Work Orders</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Full lifecycle: Draft → Approve → Release/Reserve → Issue/Return/Scrap → Partial/Final Receipt → Close</p>
          </div>
          <div style="display:flex; gap:8px;">
            <input type="text" class="form-input" style="width:200px; padding:6px 10px;" placeholder="Filter WO #..." oninput="ManufacturingModule.filterTable('table-mfg-wos', this.value)">
            <button class="primary-btn" onclick="ManufacturingModule.openWorkOrderModal()">🏭 + Create Work Order</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;"><div class="table-responsive"><table class="data-table" id="table-mfg-wos">
          <thead><tr><th>WO #</th><th>Finished Product & BOM</th><th>Warehouses</th><th style="text-align:right;">Produced / Target</th><th style="text-align:right;">Total Cost</th><th>Status</th><th style="text-align:center;">Workflow Actions</th></tr></thead>
          <tbody>
            ${wos.length === 0 ? `<tr><td colspan="7" style="text-align:center; padding:22px; color:#64748b;">No work orders found.</td></tr>` : wos.map(w => `
              <tr>
                <td style="font-family:monospace; font-weight:800; color:#0284c7;">${this.esc(w.order_number)}</td>
                <td><strong>${this.esc(w.product_name)}</strong><br><span style="font-size:0.74rem; color:#64748b;">BOM: ${this.esc(w.bom_code)} v${w.bom_version || 1}</span></td>
                <td style="font-size:0.76rem;">Raw: ${this.esc(w.raw_warehouse_name || 'Default')}<br>FG: ${this.esc(w.finished_warehouse_name || 'Default')}</td>
                <td style="text-align:right; font-family:monospace; font-weight:700;">${parseFloat(w.produced_quantity || 0)} / ${parseFloat(w.target_quantity || 0)}</td>
                <td style="text-align:right; font-family:monospace; font-weight:700;">${this.fmt(w.total_production_cost)}</td>
                <td><span class="badge ${['Completed', 'Closed'].includes(w.status) ? 'badge-won' : (w.status === 'Cancelled' ? 'badge-lost' : 'badge-submitted')}">${this.esc(w.status)}</span></td>
                <td style="text-align:center; white-space:nowrap;">
                  <button class="secondary-btn" style="padding:3px 7px; font-size:0.72rem;" onclick="ManufacturingModule.openWorkOrderDetail('${w.id}')">🔍 Execution</button>
                  ${w.status === 'Draft' ? `<button class="primary-btn" style="padding:3px 7px; font-size:0.72rem;" onclick="ManufacturingModule.woAction('${w.id}', 'approve')">Approve</button>` : ''}
                  ${['Draft', 'Approved'].includes(w.status) ? `<button class="primary-btn" style="padding:3px 7px; font-size:0.72rem; background:#0284c7;" onclick="ManufacturingModule.woAction('${w.id}', 'release')">Release</button>` : ''}
                  ${['Released', 'In Production', 'Partially Completed'].includes(w.status) ? `<button class="primary-btn" style="padding:3px 7px; font-size:0.72rem; background:#059669;" onclick="ManufacturingModule.openReceiveModal('${w.id}', ${Math.max(0, parseFloat(w.target_quantity) - parseFloat(w.produced_quantity || 0))})">📥 Receive FG</button>` : ''}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table></div></div>
      </div>
    `;
  },

  openWorkOrderModal() {
    const bomOpts = (this._cache.boms || []).filter(b => b.status === 'Active' && !b.is_archived).map(b => `<option value="${b.id}">[${this.esc(b.bom_code)} v${b.bom_version || 1}] ${this.esc(b.finished_product_name)}</option>`).join('');
    const whOpts = (this._cache.warehouses || []).map(w => `<option value="${w.id}">${this.esc(w.warehouse_name || w.name)}</option>`).join('');
    const wcOpts = `<option value="">-- Default Line --</option>` + (this._cache.workCentres || []).map(wc => `<option value="${wc.id}">[${this.esc(wc.centre_code)}] ${this.esc(wc.centre_name)}</option>`).join('');
    this.modal('🏭 Issue Production Work Order', `
      <form onsubmit="event.preventDefault(); ManufacturingModule.submitWorkOrderForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Active BOM Recipe *</label><select class="form-select" id="mfg-wo-bom" required>${bomOpts}</select></div>
          <div class="form-group"><label class="form-label">Target Quantity *</label><input type="number" step="0.01" class="form-input" id="mfg-wo-qty" value="10" required></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Raw Materials Warehouse *</label><select class="form-select" id="mfg-wo-rawwh">${whOpts}</select></div>
          <div class="form-group"><label class="form-label">Finished Goods Warehouse *</label><select class="form-select" id="mfg-wo-fgwh">${whOpts}</select></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Work Centre</label><select class="form-select" id="mfg-wo-wc">${wcOpts}</select></div>
          <div class="form-group"><label class="form-label">Planned Hours</label><input type="number" step="0.5" class="form-input" id="mfg-wo-hrs" value="8"></div>
          <div class="form-group"><label class="form-label">Due Date</label><input type="date" class="form-input" id="mfg-wo-due" value="${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="ManufacturingModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Create Work Order</button></div>
      </form>
    `);
  },

  async submitWorkOrderForm() {
    const res = await this.api('/work-orders', 'POST', {
      bom_id: document.getElementById('mfg-wo-bom').value,
      target_quantity: parseFloat(document.getElementById('mfg-wo-qty').value || 1),
      raw_materials_warehouse_id: document.getElementById('mfg-wo-rawwh').value || null,
      finished_goods_warehouse_id: document.getElementById('mfg-wo-fgwh').value || null,
      work_centre_id: document.getElementById('mfg-wo-wc').value || null,
      planned_hours: parseFloat(document.getElementById('mfg-wo-hrs').value || 0),
      due_date: document.getElementById('mfg-wo-due').value
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  async woAction(id, action, body = {}) {
    const res = await this.api(`/work-orders/${id}/${action}`, 'POST', body);
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  async openWorkOrderDetail(id) {
    const res = await this.api(`/work-orders/${id}`);
    if (!res.success || !res.data) return;
    const { work_order: wo, materials, movements, scrap_logs } = res.data;
    const active = !['Completed', 'Closed', 'Cancelled'].includes(wo.status);

    this.modal(`🏭 Work Order Execution: ${wo.order_number} (${wo.status})`, `
      <div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; background:#f8fafc; padding:10px 14px; border-radius:8px; margin-bottom:12px; font-size:0.84rem;">
        <div>Product: <strong>${this.esc(wo.product_name)}</strong></div>
        <div>Produced: <strong>${wo.produced_quantity || 0} / ${wo.target_quantity}</strong> (Rej: ${wo.rejected_quantity || 0})</div>
        <div>Actual Cost: <strong style="color:#059669;">${this.fmt(wo.total_production_cost)}</strong></div>
      </div>

      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:12px;">
        ${active ? `
          <button class="secondary-btn" onclick="ManufacturingModule.openIssueModal('${wo.id}')">📤 Issue / Add Material</button>
          <button class="secondary-btn" onclick="ManufacturingModule.openReturnModal('${wo.id}')">↩ Return Unused</button>
          <button class="secondary-btn" onclick="ManufacturingModule.openScrapModal('${wo.id}')">🗑️ Log Scrap</button>
          <button class="primary-btn" style="background:#059669;" onclick="ManufacturingModule.openReceiveModal('${wo.id}', ${Math.max(0, parseFloat(wo.target_quantity) - parseFloat(wo.produced_quantity || 0))})">📥 Receive FG</button>
          ${wo.status === 'Paused' ? `<button class="secondary-btn" onclick="ManufacturingModule.woAction('${wo.id}', 'resume'); ManufacturingModule.closeModal();">▶ Resume</button>` : `<button class="secondary-btn" onclick="ManufacturingModule.woAction('${wo.id}', 'pause'); ManufacturingModule.closeModal();">⏸ Pause</button>`}
          <button class="secondary-btn" style="color:#dc2626;" onclick="if(confirm('Cancel Work Order and release reservations?')) { ManufacturingModule.woAction('${wo.id}', 'cancel'); ManufacturingModule.closeModal(); }">✖ Cancel</button>
        ` : ''}
        ${wo.status === 'Completed' ? `<button class="primary-btn" onclick="ManufacturingModule.woAction('${wo.id}', 'close'); ManufacturingModule.closeModal();">🔒 Close Order</button>` : ''}
      </div>

      <h4 style="margin:8px 0 6px;">Material Consumption & Reservations</h4>
      <table class="data-table" style="margin-bottom:12px;">
        <thead><tr><th>Material</th><th style="text-align:right;">Planned</th><th style="text-align:right;">Reserved</th><th style="text-align:right;">Issued</th><th style="text-align:right;">Returned</th><th style="text-align:right;">Actual Cost</th></tr></thead>
        <tbody>${materials.map(m => `<tr><td>${this.esc(m.product_name)}</td><td style="text-align:right;">${m.planned_quantity}</td><td style="text-align:right;">${m.reserved_quantity || 0}</td><td style="text-align:right; font-weight:700;">${m.issued_quantity || 0}</td><td style="text-align:right;">${m.returned_quantity || 0}</td><td style="text-align:right;">${this.fmt(m.actual_cost)}</td></tr>`).join('')}</tbody>
      </table>

      <h4 style="margin:8px 0 6px;">Traceability Log (${movements.length} movements, ${scrap_logs.length} scrap events)</h4>
      <div style="max-height:160px; overflow-y:auto;">
        <table class="data-table"><thead><tr><th>Type</th><th>Item</th><th style="text-align:right;">Qty</th><th>Notes</th></tr></thead>
        <tbody>${movements.map(mv => `<tr><td><span class="badge">${this.esc(mv.movement_type)}</span></td><td>${this.esc(mv.product_name)}</td><td style="text-align:right;">${mv.base_quantity}</td><td>${this.esc(mv.remarks || '')}</td></tr>`).join('')}</tbody></table>
      </div>
    `, '900px');
  },

  openIssueModal(woId) {
    const prods = (this._cache.products || []).map(p => `<option value="${p.id}">[${this.esc(p.sku)}] ${this.esc(p.name)} (${this.esc(p.unit || 'PCS')})</option>`).join('');
    this.modal('📤 Issue / Consume Material to Work Order', `
      <form onsubmit="event.preventDefault(); ManufacturingModule.submitIssueForm('${woId}');">
        <div class="form-group"><label class="form-label">Material SKU *</label><select class="form-select" id="mfg-iss-prod">${prods}</select></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Quantity *</label><input type="number" step="0.0001" class="form-input" id="mfg-iss-qty" required></div>
          <div class="form-group"><label class="form-label">Unit</label><input class="form-input" id="mfg-iss-unit" placeholder="Leave blank for stock unit"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="ManufacturingModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Issue to Floor</button></div>
      </form>
    `);
  },

  async submitIssueForm(woId) {
    const res = await this.api(`/work-orders/${woId}/issue-material`, 'POST', {
      product_id: document.getElementById('mfg-iss-prod').value,
      quantity: parseFloat(document.getElementById('mfg-iss-qty').value || 0),
      unit_code: document.getElementById('mfg-iss-unit').value || undefined
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  openReturnModal(woId) {
    const prods = (this._cache.products || []).map(p => `<option value="${p.id}">[${this.esc(p.sku)}] ${this.esc(p.name)}</option>`).join('');
    this.modal('↩ Return Unused Material to Warehouse', `
      <form onsubmit="event.preventDefault(); ManufacturingModule.submitReturnForm('${woId}');">
        <div class="form-group"><label class="form-label">Material SKU *</label><select class="form-select" id="mfg-ret-prod">${prods}</select></div>
        <div class="form-group"><label class="form-label">Return Quantity *</label><input type="number" step="0.0001" class="form-input" id="mfg-ret-qty" required></div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="ManufacturingModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Return to Stock</button></div>
      </form>
    `);
  },

  async submitReturnForm(woId) {
    const res = await this.api(`/work-orders/${woId}/return-material`, 'POST', {
      product_id: document.getElementById('mfg-ret-prod').value,
      quantity: parseFloat(document.getElementById('mfg-ret-qty').value || 0)
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  openScrapModal(woId) {
    const prods = (this._cache.products || []).map(p => `<option value="${p.id}">[${this.esc(p.sku)}] ${this.esc(p.name)}</option>`).join('');
    this.modal('🗑️ Record Production Scrap / Rework', `
      <form onsubmit="event.preventDefault(); ManufacturingModule.submitScrapForm('${woId}');">
        <div class="form-group"><label class="form-label">Item / Material *</label><select class="form-select" id="mfg-scr-prod">${prods}</select></div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Scrap Quantity *</label><input type="number" step="0.0001" class="form-input" id="mfg-scr-qty" required></div>
          <div class="form-group" style="display:flex; align-items:center; gap:8px; padding-top:24px;"><input type="checkbox" id="mfg-scr-rew"><label for="mfg-scr-rew">Reworkable</label></div>
        </div>
        <div class="form-group"><label class="form-label">Reason</label><input class="form-input" id="mfg-scr-reason" value="Process wastage / defect"></div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="ManufacturingModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Log Scrap</button></div>
      </form>
    `);
  },

  async submitScrapForm(woId) {
    const res = await this.api(`/work-orders/${woId}/scrap`, 'POST', {
      product_id: document.getElementById('mfg-scr-prod').value,
      quantity: parseFloat(document.getElementById('mfg-scr-qty').value || 0),
      is_reworkable: document.getElementById('mfg-scr-rew').checked,
      scrap_reason: document.getElementById('mfg-scr-reason').value
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  openReceiveModal(woId, suggestedQty = 1) {
    this.modal('📥 Receive Finished Goods (Partial or Final)', `
      <form onsubmit="event.preventDefault(); ManufacturingModule.submitReceiveForm('${woId}');">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Good Output Quantity *</label><input type="number" step="0.01" class="form-input" id="mfg-rec-qty" value="${suggestedQty}" required></div>
          <div class="form-group"><label class="form-label">Rejected Qty</label><input type="number" step="0.01" class="form-input" id="mfg-rec-rej" value="0"></div>
          <div class="form-group"><label class="form-label">Actual Hours</label><input type="number" step="0.5" class="form-input" id="mfg-rec-hrs" value="8"></div>
        </div>
        <div class="form-group"><label><input type="checkbox" id="mfg-rec-final" checked> Mark Work Order Final / Completed</label></div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="ManufacturingModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Receive into Stock</button></div>
      </form>
    `);
  },

  async submitReceiveForm(woId) {
    const res = await this.api(`/work-orders/${woId}/receive`, 'POST', {
      produced_quantity: parseFloat(document.getElementById('mfg-rec-qty').value || 0),
      rejected_quantity: parseFloat(document.getElementById('mfg-rec-rej').value || 0),
      actual_hours: parseFloat(document.getElementById('mfg-rec-hrs').value || 0),
      is_final: document.getElementById('mfg-rec-final').checked
    });
    if (res.success) { this.closeModal(); showToast(res.message, 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 4. MRP & SHORTAGES TAB
  // ==========================================================================
  async renderMrpTab() {
    const res = await this.api('/mrp-shortages');
    const rows = res.data || [];
    return `
      <div class="card">
        <div class="card-header"><h3 style="margin:0; font-size:1rem;">📦 Open Work Order Material Requirements & Shortages (MRP)</h3></div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>SKU</th><th>Raw Material</th><th style="text-align:right;">Open WO Demand</th><th style="text-align:right;">In Stock</th><th style="text-align:right;">Net Shortage</th></tr></thead>
          <tbody>${rows.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:20px; color:#64748b;">No pending material requirements.</td></tr>` : rows.map(r => `<tr><td>${this.esc(r.sku)}</td><td>${this.esc(r.product_name)}</td><td style="text-align:right;">${r.total_required_open} ${this.esc(r.unit)}</td><td style="text-align:right;">${r.current_stock}</td><td style="text-align:right; font-weight:800; color:${r.shortage > 0 ? '#dc2626' : '#059669'};">${r.shortage}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    `;
  },

  // ==========================================================================
  // 5. WORK CENTRES & CONFIGURATION TAB
  // ==========================================================================
  async renderConfigTab() {
    const s = this._cache.settings || {};
    const wcs = this._cache.workCentres || [];
    const whOpts = `<option value="">-- Select Warehouse --</option>` + (this._cache.warehouses || []).map(w => `<option value="${w.id}">${this.esc(w.warehouse_name || w.name)}</option>`).join('');

    return `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px; align-items:start;">
        <div class="card" style="padding:18px;">
          <h3 style="margin-top:0;">⚙️ Manufacturing Policies & Numbering</h3>
          <form onsubmit="event.preventDefault(); ManufacturingModule.saveSettings();">
            <div class="form-row">
              <div class="form-group"><label class="form-label">WO Prefix</label><input class="form-input" id="mfg-set-wop" value="${this.esc(s.wo_prefix || 'WO')}"></div>
              <div class="form-group"><label class="form-label">BOM Prefix</label><input class="form-input" id="mfg-set-bomp" value="${this.esc(s.bom_prefix || 'BOM')}"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">Default Raw Warehouse</label><select class="form-select" id="mfg-set-rawwh">${whOpts}</select></div>
              <div class="form-group"><label class="form-label">Default FG Warehouse</label><select class="form-select" id="mfg-set-fgwh">${whOpts}</select></div>
            </div>
            <div style="display:grid; gap:8px; margin:12px 0; font-size:0.85rem;">
              <label><input type="checkbox" id="mfg-set-reqapp" ${s.require_wo_approval ? 'checked' : ''}> Require Work Order Approval</label>
              <label><input type="checkbox" id="mfg-set-autores" ${s.auto_reserve_on_release !== false ? 'checked' : ''}> Auto-Reserve Materials on Release</label>
              <label><input type="checkbox" id="mfg-set-block" ${s.block_if_insufficient_material !== false ? 'checked' : ''}> Block Release if Insufficient Materials</label>
              <label><input type="checkbox" id="mfg-set-fin" ${s.enable_finance_posting !== false ? 'checked' : ''}> Post Approved COGM Events to Finance</label>
            </div>
            <button type="submit" class="primary-btn">💾 Save Manufacturing Config</button>
          </form>
        </div>

        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; font-size:1rem;">🏭 Work Centres</h3>
            <button class="secondary-btn" style="padding:4px 10px; font-size:0.78rem;" onclick="ManufacturingModule.openWorkCentreModal()">+ Add Work Centre</button>
          </div>
          <div class="card-body" style="padding:0;"><table class="data-table">
            <thead><tr><th>Code</th><th>Name</th><th style="text-align:right;">Labor/Hr</th><th style="text-align:right;">Overhead/Hr</th></tr></thead>
            <tbody>${wcs.map(wc => `<tr><td style="font-family:monospace; font-weight:700;">${this.esc(wc.centre_code)}</td><td>${this.esc(wc.centre_name)}</td><td style="text-align:right;">${this.fmt(wc.hourly_labor_rate)}</td><td style="text-align:right;">${this.fmt(wc.hourly_overhead_rate)}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
    `;
  },

  async saveSettings() {
    const res = await this.api('/settings', 'PUT', {
      wo_prefix: document.getElementById('mfg-set-wop').value,
      bom_prefix: document.getElementById('mfg-set-bomp').value,
      default_raw_warehouse_id: document.getElementById('mfg-set-rawwh').value || null,
      default_fg_warehouse_id: document.getElementById('mfg-set-fgwh').value || null,
      require_wo_approval: document.getElementById('mfg-set-reqapp').checked,
      auto_reserve_on_release: document.getElementById('mfg-set-autores').checked,
      block_if_insufficient_material: document.getElementById('mfg-set-block').checked,
      enable_finance_posting: document.getElementById('mfg-set-fin').checked
    });
    if (res.success) { showToast(res.message, 'success'); renderActiveView(); }
  },

  openWorkCentreModal() {
    this.modal('🏭 Add Work Centre', `
      <form onsubmit="event.preventDefault(); ManufacturingModule.submitWcForm();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Code *</label><input class="form-input" id="mfg-wc-code" required placeholder="WC-02"></div>
          <div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="mfg-wc-name" required placeholder="CNC Machining Bay"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label class="form-label">Hourly Labor Rate</label><input type="number" step="0.01" class="form-input" id="mfg-wc-lab" value="1500"></div>
          <div class="form-group"><label class="form-label">Hourly Overhead Rate</label><input type="number" step="0.01" class="form-input" id="mfg-wc-ovh" value="800"></div>
        </div>
        <div class="modal-footer"><button type="button" class="secondary-btn" onclick="ManufacturingModule.closeModal()">Cancel</button><button type="submit" class="primary-btn">Save Work Centre</button></div>
      </form>
    `);
  },

  async submitWcForm() {
    const res = await this.api('/work-centres', 'POST', {
      centre_code: document.getElementById('mfg-wc-code').value,
      centre_name: document.getElementById('mfg-wc-name').value,
      hourly_labor_rate: parseFloat(document.getElementById('mfg-wc-lab').value || 0),
      hourly_overhead_rate: parseFloat(document.getElementById('mfg-wc-ovh').value || 0)
    });
    if (res.success) { this.closeModal(); showToast('✓ Work Centre saved.', 'success'); renderActiveView(); }
  },

  // ==========================================================================
  // 6. COSTING & REPORTS TAB
  // ==========================================================================
  async renderReportsTab() {
    const res = await this.api('/reports');
    const d = res.data || {};
    const costing = d.planned_vs_actual_costing || [];
    const scraps = d.scrap_and_wastage_log || [];
    const outputs = d.finished_goods_output_history || [];

    return `
      <div class="card" style="margin-bottom:18px;">
        <div class="card-header"><h3 style="margin:0; font-size:1rem;">💰 Planned vs. Actual Production Costing Variance</h3></div>
        <div class="card-body" style="padding:0;"><table class="data-table">
          <thead><tr><th>WO #</th><th>Product</th><th style="text-align:right;">Output</th><th style="text-align:right;">Planned Mat</th><th style="text-align:right;">Actual Mat</th><th style="text-align:right;">Mat Variance</th><th style="text-align:right;">Scrap</th><th style="text-align:right;">Total Cost</th></tr></thead>
          <tbody>${costing.map(c => `<tr><td style="font-family:monospace; font-weight:700;">${this.esc(c.order_number)}</td><td>${this.esc(c.product_name)}</td><td style="text-align:right;">${c.produced_quantity} / ${c.target_quantity}</td><td style="text-align:right;">${this.fmt(c.planned_material_cost)}</td><td style="text-align:right;">${this.fmt(c.actual_material_cost)}</td><td style="text-align:right; color:${parseFloat(c.material_variance) > 0 ? '#dc2626' : '#059669'};">${this.fmt(c.material_variance)}</td><td style="text-align:right;">${this.fmt(c.scrap_cost)}</td><td style="text-align:right; font-weight:800;">${this.fmt(c.total_production_cost)}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:18px;">
        <div class="card">
          <div class="card-header"><h4 style="margin:0;">🗑️ Scrap & Wastage Log</h4></div>
          <div class="card-body" style="padding:0;"><table class="data-table">
            <thead><tr><th>WO #</th><th>Item</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Cost Impact</th></tr></thead>
            <tbody>${scraps.length === 0 ? `<tr><td colspan="4" style="text-align:center; padding:16px;">No scrap logged.</td></tr>` : scraps.map(s => `<tr><td>${this.esc(s.order_number)}</td><td>${this.esc(s.product_name)}</td><td style="text-align:right;">${s.quantity}</td><td style="text-align:right;">${this.fmt(s.cost_impact)}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
        <div class="card">
          <div class="card-header"><h4 style="margin:0;">📦 Finished Goods Output History</h4></div>
          <div class="card-body" style="padding:0;"><table class="data-table">
            <thead><tr><th>WO #</th><th>Product</th><th>Warehouse</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Unit Cost</th></tr></thead>
            <tbody>${outputs.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:16px;">No finished goods receipts yet.</td></tr>` : outputs.map(o => `<tr><td>${this.esc(o.order_number)}</td><td>${this.esc(o.product_name)}</td><td>${this.esc(o.warehouse_name)}</td><td style="text-align:right;">${o.base_quantity}</td><td style="text-align:right;">${this.fmt(o.unit_cost)}</td></tr>`).join('')}</tbody>
          </table></div>
        </div>
      </div>
    `;
  },

  filterTable(tableId, query) {
    const q = (query || '').toLowerCase();
    document.querySelectorAll(`#${tableId} tbody tr`).forEach(tr => {
      tr.style.display = tr.innerText.toLowerCase().includes(q) ? '' : 'none';
    });
  }
};

