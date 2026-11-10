/**
 * Mashrue B2B Platform — Print Template Engine Module
 * Covers Document Templates (Tenders, Quotes, etc.), Sample Auto-Design,
 * Dynamic Columns, Logo/Letterhead Branding, Paper Sizes, and Customer Mappings.
 */

function convertNumberToWordsPKR(amount) {
  if (amount == null || isNaN(amount)) return '';
  const num = Math.round(Number(amount));
  if (num === 0) return 'Zero Rupees Only';

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function convertChunk(n) {
    let str = '';
    if (n >= 100) {
      str += ones[Math.floor(n / 100)] + ' Hundred ';
      n %= 100;
    }
    if (n >= 20) {
      str += tens[Math.floor(n / 10)] + (n % 10 > 0 ? '-' + ones[n % 10] : '') + ' ';
    } else if (n > 0) {
      str += ones[n] + ' ';
    }
    return str.trim();
  }

  const billions = Math.floor(num / 1000000000);
  let rem = num % 1000000000;
  const millions = Math.floor(rem / 1000000);
  rem = rem % 1000000;
  const thousands = Math.floor(rem / 1000);
  const hundreds = rem % 1000;

  let words = '';
  if (billions > 0) words += convertChunk(billions) + ' Billion ';
  if (millions > 0) words += convertChunk(millions) + ' Million ';
  if (thousands > 0) words += convertChunk(thousands) + ' Thousand ';
  if (hundreds > 0) {
    if (words !== '' && hundreds < 100) words += 'and ';
    words += convertChunk(hundreds) + ' ';
  }

  return words.trim() + ' Only';
}
window.convertNumberToWordsPKR = convertNumberToWordsPKR;

window.TemplatesEngine = {
  templates: [],
  customerMappings: [],
  currentEditingTemplate: null,
  sampleDraft: null,
  activePreviewDocType: 'quotation',

  async init() {
    if (typeof State !== 'undefined' && typeof State.isLoggedIn === 'function' && !State.isLoggedIn()) {
      return; // Do NOT fetch templates or customer mappings when user is on the guest/login screen
    }
    await this.loadTemplates();
    await this.loadCustomerMappings();
  },

  async loadTemplates(docType) {
    try {
      this.templates = await API.getTemplates(docType);
      return this.templates;
    } catch (e) {
      console.warn('Failed to load templates:', e);
      return [];
    }
  },

  async loadCustomerMappings() {
    try {
      this.customerMappings = await API.getCustomerTemplateMappings();
      return this.customerMappings;
    } catch (e) {
      console.warn('Failed to load customer mappings:', e);
      return [];
    }
  },

  // Resolve active template for a print operation (Customer Override > Doc Default > First Available)
  resolveTemplateForPrint(docType, customerId) {
    if (customerId && this.customerMappings.length > 0) {
      const mapping = this.customerMappings.find(
        m => String(m.customer_id) === String(customerId) && m.doc_type === docType
      );
      if (mapping) {
        const found = this.templates.find(t => t.id === mapping.template_id);
        if (found) return found;
      }
    }
    // Fallback to default template for this docType
    const def = this.templates.find(t => t.doc_type === docType && t.is_default);
    if (def) return def;

    // Fallback to any template for this docType
    const anyDoc = this.templates.find(t => t.doc_type === docType);
    if (anyDoc) return anyDoc;

    // Fallback to first available or built-in standard
    return this.templates[0] || this.getStandardFallbackTemplate(docType);
  },

  getStandardFallbackTemplate(docType = 'quotation') {
    if (docType === 'purchase_order') {
      return {
        id: 'standard-po-mayo',
        template_name: 'Institutional Purchase Order (Mayo Hospital Standard)',
        doc_type: 'purchase_order',
        is_default: true,
        paper_size: 'A4',
        paper_orientation: 'portrait',
        letterhead_mode: 'digital',
        top_margin_mm: 12,
        bottom_margin_mm: 12,
        accent_color: '#000000',
        font_family: 'Arial, sans-serif',
        show_company_header: true,
        show_company_footer: true,
        show_signature_blocks: false,
        columns_config: [
          { key: "item_description", label: "Item Description", visible: true, width: "16%", align: "left" },
          { key: "specs", label: "Specification", visible: true, width: "16%", align: "left" },
          { key: "unit", label: "Unit Of Measure", visible: true, width: "9%", align: "center" },
          { key: "pack_size", label: "Pack Size", visible: true, width: "7%", align: "center" },
          { key: "unit_price", label: "Price", visible: true, width: "10%", align: "right" },
          { key: "quantity", label: "Quantity", visible: true, width: "8%", align: "center" },
          { key: "amount", label: "Amount", visible: true, width: "11%", align: "right" },
          { key: "tax_amount", label: "Tax Amount", visible: true, width: "10%", align: "right" },
          { key: "delivery_date", label: "Delivery Date", visible: true, width: "13%", align: "center" }
        ],
        custom_terms: `AS PER PPRA should mention brand and Defacement is mandatory (govt. property, mayo Hospital Lahore. NOT FOR SALE) DRAP registration/Enlistment is compulsory (if applicable)`
      };
    }

    if (docType === 'technical_proposal') {
      return {
        id: 'standard-tech-proposal',
        template_name: 'Government Technical Proposal (Mayo Hospital Framework)',
        doc_type: 'technical_proposal',
        is_default: true,
        paper_size: 'A4',
        paper_orientation: 'portrait',
        letterhead_mode: 'digital',
        top_margin_mm: 15,
        bottom_margin_mm: 15,
        accent_color: '#000000',
        font_family: 'Arial, sans-serif',
        show_company_header: true,
        show_company_footer: true,
        show_signature_blocks: true,
        columns_config: [
          { key: "sr", label: "Sr.#", visible: true, width: "6%", align: "center" },
          { key: "item_name_specs", label: "Item Name & Description / Specification", visible: true, width: "55%", align: "left" },
          { key: "brand", label: "Brand", visible: true, width: "17%", align: "left" },
          { key: "unit", label: "Unit", visible: true, width: "11%", align: "center" },
          { key: "quantity", label: "Qty", visible: true, width: "11%", align: "center" }
        ],
        custom_terms: `Note:\nBid Validity as per Bidding Documents`
      };
    }

    if (docType === 'financial_proposal') {
      return {
        id: 'standard-financial-pitb',
        template_name: 'Government Financial Proposal (PITB Framework Format)',
        doc_type: 'financial_proposal',
        is_default: true,
        paper_size: 'A4',
        paper_orientation: 'portrait',
        letterhead_mode: 'digital',
        top_margin_mm: 15,
        bottom_margin_mm: 15,
        accent_color: '#000000',
        font_family: 'Arial, sans-serif',
        show_company_header: true,
        show_company_footer: true,
        show_signature_blocks: true,
        columns_config: [
          { key: "sr", label: "Sr.#", visible: true, width: "6%", align: "center" },
          { key: "item_name", label: "Item Name", visible: true, width: "22%", align: "left" },
          { key: "specs", label: "Offered Parameters (Specification/Dimensions)", visible: true, width: "28%", align: "left" },
          { key: "unit", label: "Medium", visible: true, width: "9%", align: "center" },
          { key: "unit_price", label: "Unit price (inclusive of all taxes & duties etc.)", visible: true, width: "13%", align: "right" },
          { key: "quantity", label: "Quantity", visible: true, width: "8%", align: "center" },
          { key: "total_price", label: "Total price (inclusive of all taxes & duties etc.)", visible: true, width: "14%", align: "right" }
        ],
        custom_terms: `Note: Bid Validity as per Tender`
      };
    }

    if (docType === 'executive_report') {
      return {
        id: 'standard-exec-report',
        template_name: 'C-Suite Executive Audit Ledger',
        doc_type: 'executive_report',
        is_default: true,
        paper_size: 'A4',
        paper_orientation: 'landscape',
        letterhead_mode: 'digital',
        top_margin_mm: 10,
        bottom_margin_mm: 10,
        accent_color: '#0f172a',
        font_family: 'Inter, Arial, sans-serif',
        show_company_header: true,
        show_company_footer: true,
        show_signature_blocks: true,
        columns_config: [],
        custom_terms: `🔒 STRICTLY CONFIDENTIAL • FOR INTERNAL MANAGEMENT & AUDIT PURPOSES ONLY`
      };
    }

    return {
      id: 'standard-fallback',
      template_name: docType === 'tender' ? 'Standard PPRA Tender BoQ' : 'Standard Commercial Quotation',
      doc_type: docType,
      is_default: true,
      paper_size: 'A4',
      paper_orientation: 'portrait',
      letterhead_mode: 'digital',
      top_margin_mm: 15,
      bottom_margin_mm: 15,
      accent_color: docType === 'tender' ? '#0f172a' : '#0284c7',
      font_family: 'Inter, sans-serif',
      show_company_header: true,
      show_company_footer: true,
      show_signature_blocks: true,
      signature_title_left: 'Customer Acceptance & Stamp',
      signature_title_right: 'Authorized Signatory',
      columns_config: [
        { key: "sr", label: "#", visible: true, width: "5%", align: "center" },
        { key: "item_name", label: "Item Description & Specifications", visible: true, width: "42%", align: "left" },
        { key: "brand", label: "Brand / Make", visible: true, width: "12%", align: "left" },
        { key: "quantity", label: "Qty", visible: true, width: "8%", align: "center" },
        { key: "unit", label: "Unit", visible: true, width: "7%", align: "center" },
        { key: "unit_price", label: "Unit Price (PKR)", visible: true, width: "13%", align: "right" },
        { key: "total_price", label: "Total Amount (PKR)", visible: true, width: "13%", align: "right" }
      ],
      custom_terms: `1. Validity: This offer is valid for 30 calendar days from date of issue.\n2. Delivery: Within 3 to 7 working days upon receipt of Purchase Order.\n3. Payment: 30 Days Net from delivery & verification.\n4. Taxes: All rates quoted are in PKR and subject to statutory sales tax/withholding.`
    };
  },

  // --------------------------------------------------------------------------
  // 0. STUDIO UNIFIED SUB-TABS (10/10 UX)
  // --------------------------------------------------------------------------
  renderStudioTabs() {
    // All Print & Template Studio screens are directly accessible from the left Sidebar
    return '';
  },

  // --------------------------------------------------------------------------
  // 1. VIEW: Document Templates Directory
  // --------------------------------------------------------------------------
  currentFilterDocType: 'all',
  currentFilterModule: 'all',
  currentFilterStatus: 'published',
  currentSearchQuery: '',

  async renderTemplatesView() {
    await this.loadTemplates();
    const tList = this.getFilteredTemplates();

    return `
      <div style="padding: 10px 0;">
        ${this.renderStudioTabs('templates')}
        <!-- Top Toolbar -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
          <div>
            <h2 style="font-size:1.35rem; font-weight:800; color:#0f172a; margin:0 0 4px 0;">🖨️ Document Templates Hub</h2>
            <div style="font-size:0.85rem; color:#64748b;">Enterprise print layouts, version history, and multi-module document generation.</div>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="secondary-btn" style="display:flex; align-items:center; gap:6px; background:#f0f9ff; border:1px solid #bae6fd; color:#0369a1; font-weight:700;" onclick="switchView('template-branding')">
              <span>🎨</span> Logo & Letterhead
            </button>
            <button class="secondary-btn" style="display:flex; align-items:center; gap:6px; background:#f8fafc; border:1px solid #cbd5e1;" onclick="switchView('template-sample-upload')">
              <span>⚡</span> Upload Sample
            </button>
            <button class="secondary-btn" style="display:flex; align-items:center; gap:6px; background:#f8fafc; border:1px solid #cbd5e1;" onclick="TemplatesEngine.openImportModal()">
              <span>📥</span> Import JSON
            </button>
            <button class="primary-btn" style="display:flex; align-items:center; gap:6px; background:#0284c7;" onclick="TemplatesEngine.openTemplateEditorModal()">
              <span>➕</span> Design New Template
            </button>
          </div>
        </div>

        <!-- Filter & Search Toolbar -->
        <div style="background:white; border:1px solid #e2e8f0; border-radius:10px; padding:14px 16px; margin-bottom:20px; display:flex; flex-direction:column; gap:12px; box-shadow:0 1px 3px rgba(0,0,0,0.03);">
          <!-- Top Row: Search, Module Dropdown & Status Tabs -->
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div style="display:flex; gap:10px; align-items:center; flex:1; min-width:280px;">
              <input type="text" id="tpl-search-input" class="form-input" placeholder="🔍 Search templates by name or description..." 
                value="${this.currentSearchQuery || ''}" oninput="TemplatesEngine.onSearchChange(this.value)" style="max-width:320px;">
              
              <select id="tpl-module-filter" class="form-select" style="max-width:200px;" onchange="TemplatesEngine.onModuleFilterChange(this.value)">
                <option value="all" ${this.currentFilterModule === 'all' ? 'selected' : ''}>🏢 All Modules</option>
                <option value="tender" ${this.currentFilterModule === 'tender' ? 'selected' : ''}>📑 Tender & Quotation</option>
                <option value="finance" ${this.currentFilterModule === 'finance' ? 'selected' : ''}>💰 Finance & Invoicing</option>
                <option value="inventory" ${this.currentFilterModule === 'inventory' ? 'selected' : ''}>📦 Inventory & DC</option>
                <option value="crm" ${this.currentFilterModule === 'crm' ? 'selected' : ''}>🤝 CRM & Proposals</option>
                <option value="manufacturing" ${this.currentFilterModule === 'manufacturing' ? 'selected' : ''}>⚙️ Manufacturing & BOM</option>
                <option value="hrm" ${this.currentFilterModule === 'hrm' ? 'selected' : ''}>👥 HRM & Appointment</option>
                <option value="payroll" ${this.currentFilterModule === 'payroll' ? 'selected' : ''}>💵 Payroll & Payslips</option>
              </select>
            </div>

            <!-- Status Tabs -->
            <div style="display:flex; gap:6px; background:#f1f5f9; padding:3px; border-radius:8px;">
              <button class="tab-btn ${this.currentFilterStatus === 'published' ? 'active' : ''}" style="padding:4px 12px; font-size:0.78rem;" onclick="TemplatesEngine.onStatusFilterChange('published')">Published</button>
              <button class="tab-btn ${this.currentFilterStatus === 'draft' ? 'active' : ''}" style="padding:4px 12px; font-size:0.78rem;" onclick="TemplatesEngine.onStatusFilterChange('draft')">Drafts</button>
              <button class="tab-btn ${this.currentFilterStatus === 'archived' ? 'active' : ''}" style="padding:4px 12px; font-size:0.78rem;" onclick="TemplatesEngine.onStatusFilterChange('archived')">Archived</button>
              <button class="tab-btn ${this.currentFilterStatus === 'all' ? 'active' : ''}" style="padding:4px 12px; font-size:0.78rem;" onclick="TemplatesEngine.onStatusFilterChange('all')">All</button>
            </div>
          </div>

          <!-- Document Type Pills -->
          <div style="display:flex; gap:6px; flex-wrap:wrap; border-top:1px solid #f1f5f9; padding-top:10px; font-size:0.78rem;">
            <button class="badge-tab ${this.currentFilterDocType === 'all' ? 'active' : ''}" onclick="TemplatesEngine.filterTemplatesByType('all', this)">All Types (${this.templates.length})</button>
            <button class="badge-tab ${this.currentFilterDocType === 'quotation' ? 'active' : ''}" onclick="TemplatesEngine.filterTemplatesByType('quotation', this)">Quotations</button>
            <button class="badge-tab ${this.currentFilterDocType === 'tender' ? 'active' : ''}" onclick="TemplatesEngine.filterTemplatesByType('tender', this)">Tenders & BoQ</button>
            <button class="badge-tab ${this.currentFilterDocType === 'invoice' ? 'active' : ''}" onclick="TemplatesEngine.filterTemplatesByType('invoice', this)">Tax Invoices</button>
            <button class="badge-tab ${this.currentFilterDocType === 'delivery_challan' ? 'active' : ''}" onclick="TemplatesEngine.filterTemplatesByType('delivery_challan', this)">Delivery Challans</button>
            <button class="badge-tab ${this.currentFilterDocType === 'purchase_order' ? 'active' : ''}" onclick="TemplatesEngine.filterTemplatesByType('purchase_order', this)">Purchase Orders</button>
            <button class="badge-tab ${this.currentFilterDocType === 'payslip' ? 'active' : ''}" onclick="TemplatesEngine.filterTemplatesByType('payslip', this)">Payslips</button>
          </div>
        </div>

        <!-- Templates Grid -->
        <div id="templates-grid-container" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap:20px;">
          ${this.renderTemplatesCardsHTML(tList)}
        </div>
      </div>
    `;
  },

  getFilteredTemplates() {
    return this.templates.filter(t => {
      // Document Type
      if (this.currentFilterDocType !== 'all' && t.doc_type !== this.currentFilterDocType) return false;
      // Module
      if (this.currentFilterModule !== 'all') {
        const mod = (t.module || 'tender').toLowerCase();
        if (mod !== this.currentFilterModule.toLowerCase()) return false;
      }
      // Status
      if (this.currentFilterStatus === 'published') {
        if (t.is_archived || (t.status && t.status !== 'published')) return false;
      } else if (this.currentFilterStatus === 'draft') {
        if (t.is_archived || t.status !== 'draft') return false;
      } else if (this.currentFilterStatus === 'archived') {
        if (!t.is_archived && t.status !== 'archived') return false;
      }
      // Search
      if (this.currentSearchQuery) {
        const q = this.currentSearchQuery.toLowerCase();
        const name = (t.template_name || '').toLowerCase();
        const doc = (t.doc_type || '').toLowerCase();
        const desc = (t.description || '').toLowerCase();
        if (!name.includes(q) && !doc.includes(q) && !desc.includes(q)) return false;
      }
      return true;
    });
  },

  onSearchChange(val) {
    this.currentSearchQuery = val;
    this.refreshGrid();
  },

  onModuleFilterChange(val) {
    this.currentFilterModule = val;
    this.refreshGrid();
  },

  onStatusFilterChange(val) {
    this.currentFilterStatus = val;
    const container = document.getElementById('templates-grid-container');
    if (container) {
      this.refreshGrid();
    } else {
      switchView('templates');
    }
  },

  refreshGrid() {
    const container = document.getElementById('templates-grid-container');
    if (container) {
      container.innerHTML = this.renderTemplatesCardsHTML(this.getFilteredTemplates());
    }
  },

  renderTemplatesCardsHTML(list) {
    if (!list || list.length === 0) {
      return `
        <div style="grid-column: 1 / -1; text-align:center; padding:50px 20px; background:white; border:1px dashed #cbd5e1; border-radius:12px;">
          <div style="font-size:2.8rem; margin-bottom:12px;">📋</div>
          <h3 style="font-size:1.15rem; font-weight:700; color:#0f172a; margin-bottom:6px;">No Templates Found</h3>
          <p style="font-size:0.85rem; color:#64748b; max-width:460px; margin:0 auto 16px auto;">
            No templates match your active filters. Try adjusting your search query, status tabs, or create a new template.
          </p>
          <div style="display:flex; justify-content:center; gap:10px;">
            <button class="secondary-btn" onclick="TemplatesEngine.onStatusFilterChange('all')">View All Templates</button>
            <button class="primary-btn" onclick="TemplatesEngine.openTemplateEditorModal()">➕ Design New</button>
          </div>
        </div>
      `;
    }

    return list.map(t => {
      const cols = typeof t.columns_config === 'string' ? JSON.parse(t.columns_config || '[]') : (t.columns_config || []);
      const visibleCols = cols.filter(c => c.visible !== false);
      const isLetterhead = t.letterhead_mode === 'letterhead';
      const isArchived = !!t.is_archived || t.status === 'archived';
      const versionNum = t.version || 1;
      const mod = t.module || 'tender';

      return `
        <div class="card" style="border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; display:flex; flex-direction:column; box-shadow:0 2px 8px rgba(0,0,0,0.04); transition:transform 0.2s; opacity:${isArchived ? '0.75' : '1'};" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='none'">
          <!-- Card Accent Bar -->
          <div style="height:6px; background:${t.accent_color || '#0f172a'};"></div>
          <div style="padding:16px; flex:1; display:flex; flex-direction:column;">
            
            <!-- Badges Row -->
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px; flex-wrap:wrap; gap:6px;">
              <div style="display:flex; gap:5px; align-items:center; flex-wrap:wrap;">
                <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700; text-transform:uppercase; font-size:0.68rem; padding:3px 7px;">
                  ${(t.doc_type || 'quotation').replace(/_/g, ' ')}
                </span>
                <span class="badge" style="background:#f1f5f9; color:#475569; font-weight:700; font-size:0.68rem; padding:3px 7px;">
                  ${mod.toUpperCase()}
                </span>
                <span class="badge" style="background:#ede9fe; color:#6d28d9; font-weight:700; font-size:0.68rem; padding:3px 7px;" title="Template Version">
                  v${versionNum}
                </span>
                ${t.status === 'draft' ? `<span class="badge" style="background:#fef3c7; color:#b45309; font-weight:700; font-size:0.68rem; padding:3px 7px;">Draft</span>` : ''}
                ${isArchived ? `<span class="badge" style="background:#fee2e2; color:#b91c1c; font-weight:700; font-size:0.68rem; padding:3px 7px;">Archived</span>` : ''}
                ${t.is_default ? `<span class="badge" style="background:#dcfce7; color:#15803d; font-weight:700; font-size:0.68rem; padding:3px 7px;">★ Default</span>` : ''}
              </div>
              <div style="font-size:0.75rem; color:#64748b; font-weight:600;">
                ${t.paper_size || 'A4'} • ${(t.paper_orientation || 'portrait').toUpperCase()}
              </div>
            </div>

            <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; margin:0 0 6px 0; line-height:1.4;">
              ${t.template_name}
            </h3>

            <div style="font-size:0.8rem; color:#64748b; margin-bottom:12px; line-height:1.5;">
              Mode: <strong>${isLetterhead ? '📄 Stationery (' + (t.top_margin_mm || 55) + 'mm margin)' : '🖨️ Digital Letterhead'}</strong><br>
              Columns: <strong>${visibleCols.length} Visible</strong> (${visibleCols.map(c => c.label).slice(0, 3).join(', ')}${visibleCols.length > 3 ? '...' : ''})
            </div>

            <!-- Mini Preview Box -->
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 10px; margin-bottom:14px; font-size:0.73rem; color:#475569; flex:1;">
              <div style="display:flex; justify-content:space-between; border-bottom:1px solid #cbd5e1; padding-bottom:3px; margin-bottom:5px; font-weight:700; color:${t.accent_color || '#0f172a'};">
                <span>Sample Layout Structure</span>
                <span>${t.accent_color || '#0f172a'}</span>
              </div>
              <div style="display:flex; gap:4px; overflow-x:hidden;">
                ${visibleCols.slice(0, 4).map(c => `
                  <span style="background:#e2e8f0; padding:2px 5px; border-radius:3px; font-size:0.68rem; white-space:nowrap;">${c.label}</span>
                `).join('')}
              </div>
            </div>

            <!-- Card Actions -->
            <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #f1f5f9; padding-top:10px; gap:6px; flex-wrap:wrap;">
              <div style="display:flex; gap:4px; flex-wrap:wrap;">
                <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="TemplatesEngine.editTemplate('${t.id}')">✏️ Edit</button>
                <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="TemplatesEngine.previewTemplate('${t.id}')">👁️ Preview</button>
                <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem; color:#6d28d9;" onclick="TemplatesEngine.viewVersionHistory('${t.id}')" title="Version History">🕒 v${versionNum}</button>
              </div>

              <div style="display:flex; gap:4px; align-items:center;">
                <button class="secondary-btn" style="padding:4px 7px; font-size:0.75rem;" onclick="TemplatesEngine.duplicateTemplate('${t.id}')" title="Duplicate as Draft">📄 Clone</button>
                <button class="secondary-btn" style="padding:4px 7px; font-size:0.75rem;" onclick="TemplatesEngine.exportTemplateJson('${t.id}')" title="Export as JSON">📥</button>
                ${!isArchived ? `
                  <button class="secondary-btn" style="padding:4px 7px; font-size:0.75rem; color:#d97706;" onclick="TemplatesEngine.archiveTemplate('${t.id}')" title="Archive Template">📦</button>
                ` : `
                  <button class="secondary-btn" style="padding:4px 7px; font-size:0.75rem; color:#16a34a;" onclick="TemplatesEngine.restoreTemplate('${t.id}')" title="Restore Template">♻️</button>
                `}
                <button class="secondary-btn" style="padding:4px 7px; font-size:0.75rem; color:#ef4444;" onclick="TemplatesEngine.deleteTemplate('${t.id}', '${t.template_name.replace(/'/g, "\\'")}')" title="Delete">🗑️</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  },

  filterTemplatesByType(type, btnEl) {
    this.currentFilterDocType = type;
    if (btnEl && btnEl.parentElement) {
      btnEl.parentElement.querySelectorAll('.badge-tab, .tab-btn').forEach(b => b.classList.remove('active'));
      btnEl.classList.add('active');
    }
    this.refreshGrid();
  },

  // --------------------------------------------------------------------------
  // 2. VIEW: Sample Upload & AI Auto-Design (Mode 2)
  // --------------------------------------------------------------------------
  renderSampleUploadView() {
    return `
      <div style="padding: 10px 0; max-width: 1000px; margin: 0 auto;">
        ${this.renderStudioTabs('sample')}
        <div style="margin-bottom:20px;">
          <h2 style="font-size:1.35rem; font-weight:800; color:#0f172a; margin:0 0 4px 0;">⚡ Sample Upload & Auto-Design Studio</h2>
          <div style="font-size:0.85rem; color:#64748b;">
            Upload any existing quotation, tender BoQ or commercial document. Our engine identifies table columns, headers, terms and paper layout, generating a ready-to-approve template.
          </div>
        </div>

        <!-- Upload Container -->
        <div class="card" style="padding:24px; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:24px;">
          <div id="sample-dropzone" style="border:2px dashed #38bdf8; background:#f0f9ff; border-radius:10px; padding:40px 20px; text-align:center; cursor:pointer; position:relative; transition:all 0.2s;"
               onclick="document.getElementById('sample-file-input').click()"
               ondragover="event.preventDefault(); this.style.background='#e0f2fe';"
               ondragleave="this.style.background='#f0f9ff';"
               ondrop="TemplatesEngine.handleSampleFileDrop(event)">
            <input type="file" id="sample-file-input" style="display:none;" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.txt" onchange="TemplatesEngine.handleSampleFileSelect(event)">
            <div style="font-size:3rem; margin-bottom:10px;">📄</div>
            <h3 style="font-size:1.15rem; font-weight:800; color:#0369a1; margin:0 0 6px 0;">Drop your Sample Document here, or Click to Browse</h3>
            <p style="font-size:0.85rem; color:#64748b; margin:0 0 14px 0;">
              Supports PDF, Word (.docx), Scanned Invoices/Quotes (.png, .jpg), or BoQ Sheets
            </p>
            <div style="display:inline-block; background:#0284c7; color:white; padding:8px 20px; border-radius:6px; font-weight:700; font-size:0.85rem;">
              Select Document Sample
            </div>
          </div>

          <div style="display:flex; align-items:center; gap:12px; margin:20px 0; color:#94a3b8;">
            <div style="flex:1; height:1px; background:#e2e8f0;"></div>
            <span style="font-size:0.8rem; font-weight:700; text-transform:uppercase;">Or Paste Sample Text / Column Names</span>
            <div style="flex:1; height:1px; background:#e2e8f0;"></div>
          </div>

          <div>
            <textarea id="sample-text-paste" class="form-textarea" rows="4" placeholder="Paste sample table headers or document text here (e.g. Item Description, Brand, Qty, Unit, Rate, Sales Tax, Total Amount)..."></textarea>
            <div style="display:flex; justify-content:flex-end; margin-top:10px;">
              <button class="primary-btn" style="background:#0f172a; padding:8px 18px;" onclick="TemplatesEngine.analyzeSampleText()">
                🔍 Analyze Sample & Generate Template
              </button>
            </div>
          </div>
        </div>

        <!-- Dynamic Results & Interactive Approval Studio -->
        <div id="sample-recognition-results" style="display:none;"></div>
      </div>
    `;
  },

  handleSampleFileSelect(e) {
    const file = e.target.files && e.target.files[0];
    if (file) this.processSampleFile(file);
  },

  handleSampleFileDrop(e) {
    e.preventDefault();
    const dropzone = document.getElementById('sample-dropzone');
    if (dropzone) dropzone.style.background = '#f0f9ff';
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) this.processSampleFile(file);
  },

  async processSampleFile(file) {
    showToast(`Analyzing ${file.name}...`, 'info');
    try {
      const payload = {
        fileName: file.name,
        fileType: file.type,
        sampleText: file.name + ' ' + (file.type || '')
      };
      const res = await API.parseSampleTemplate(payload);
      if (res && res.success && res.data) {
        this.sampleDraft = res.data;
        this.renderSampleApprovalStudio(res.data, res.meta);
        showToast('✓ Sample successfully analyzed & template synthesized!', 'success');
      } else {
        alert(res.message || 'Could not analyze sample document.');
      }
    } catch (err) {
      console.error('Sample processing error:', err);
      showToast('Error analyzing sample: ' + err.message, 'error');
    }
  },

  async analyzeSampleText() {
    const text = document.getElementById('sample-text-paste')?.value || '';
    if (!text.trim()) {
      alert('Please paste some sample text or column headers first.');
      return;
    }
    showToast('Synthesizing template from sample text...', 'info');
    try {
      const res = await API.parseSampleTemplate({ sampleText: text, fileName: 'Custom Text Sample' });
      if (res && res.success && res.data) {
        this.sampleDraft = res.data;
        this.renderSampleApprovalStudio(res.data, res.meta);
        showToast('✓ Template synthesized from sample text!', 'success');
      }
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  },

  renderSampleApprovalStudio(draft, meta = {}) {
    const container = document.getElementById('sample-recognition-results');
    if (!container) return;
    container.style.display = 'block';

    const cols = draft.columns_config || [];

    container.innerHTML = `
      <div class="card" style="border:2px solid #0284c7; border-radius:12px; padding:24px; background:#ffffff; box-shadow:0 10px 25px -5px rgba(2,132,199,0.1);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px; border-bottom:1px solid #e2e8f0; padding-bottom:16px;">
          <div>
            <span class="badge" style="background:#dcfce7; color:#15803d; font-weight:800; font-size:0.75rem; text-transform:uppercase;">
              ✓ Template Recognition Complete
            </span>
            <h3 style="font-size:1.25rem; font-weight:800; color:#0f172a; margin:6px 0 2px 0;">
              ${draft.template_name}
            </h3>
            <div style="font-size:0.83rem; color:#64748b;">
              Detected: <strong>${(draft.doc_type || 'quotation').toUpperCase()}</strong> • Paper: <strong>${draft.paper_size || 'A4'} ${draft.paper_orientation || 'portrait'}</strong> • Mode: <strong>${draft.letterhead_mode === 'letterhead' ? 'Pre-Printed Stationery' : 'Digital Letterhead'}</strong>
            </div>
          </div>
          <div style="display:flex; gap:10px;">
            <button class="secondary-btn" style="padding:8px 16px; font-weight:700;" onclick="TemplatesEngine.openCustomizerForSample()">
              ✏️ Refine & Customize First
            </button>
            <button class="primary-btn" style="background:#16a34a; padding:8px 20px; font-weight:800; font-size:0.9rem;" onclick="TemplatesEngine.approveAndSaveSampleDraft()">
              ✓ 1-Click Approve & Save Template
            </button>
          </div>
        </div>

        <!-- Detected Columns Section -->
        <div style="margin-bottom:24px;">
          <h4 style="font-size:0.95rem; font-weight:800; color:#0f172a; margin-bottom:10px;">Detected Table Columns (${cols.length})</h4>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:10px;">
            ${cols.map((c, i) => `
              <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:10px; display:flex; align-items:center; gap:8px;">
                <input type="checkbox" id="sample-col-${i}" ${c.visible !== false ? 'checked' : ''} onchange="TemplatesEngine.toggleSampleCol(${i}, this.checked)">
                <input type="text" class="form-input" style="padding:3px 6px; font-size:0.82rem; height:28px;" value="${c.label}" onchange="TemplatesEngine.renameSampleCol(${i}, this.value)">
                <span style="font-size:0.75rem; color:#94a3b8; width:35px; text-align:right;">${c.width || 'auto'}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Live Preview Component -->
        <div>
          <h4 style="font-size:0.95rem; font-weight:800; color:#0f172a; margin-bottom:10px;">Live Document Sheet Preview</h4>
          <div style="background:#64748b; padding:20px; border-radius:8px; overflow-x:auto;">
            <div id="sample-sheet-preview" style="background:white; border-radius:4px; box-shadow:0 4px 15px rgba(0,0,0,0.3); max-width:800px; margin:0 auto; padding:30px; font-family:${draft.font_family || 'Inter, sans-serif'};">
              ${this.compilePreviewHTML(draft)}
            </div>
          </div>
        </div>
      </div>
    `;
    container.scrollIntoView({ behavior: 'smooth' });
  },

  toggleSampleCol(idx, checked) {
    if (this.sampleDraft && this.sampleDraft.columns_config[idx]) {
      this.sampleDraft.columns_config[idx].visible = checked;
      const preview = document.getElementById('sample-sheet-preview');
      if (preview) preview.innerHTML = this.compilePreviewHTML(this.sampleDraft);
    }
  },

  renameSampleCol(idx, newLabel) {
    if (this.sampleDraft && this.sampleDraft.columns_config[idx]) {
      this.sampleDraft.columns_config[idx].label = newLabel;
      const preview = document.getElementById('sample-sheet-preview');
      if (preview) preview.innerHTML = this.compilePreviewHTML(this.sampleDraft);
    }
  },

  async approveAndSaveSampleDraft() {
    if (!this.sampleDraft) return;
    try {
      const res = await API.createTemplate(this.sampleDraft);
      if (res && res.success) {
        showToast('✓ Template approved & saved to registry!', 'success');
        await this.loadTemplates();
        switchView('templates');
      } else {
        alert(res.message || 'Error saving template');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  openCustomizerForSample() {
    if (!this.sampleDraft) return;
    this.openTemplateEditorModal(this.sampleDraft);
  },

  // --------------------------------------------------------------------------
  // 3. VIEW: Column & Table Configurator (Add, Remove, Reorder)
  // --------------------------------------------------------------------------
  async renderColumnDesignerView() {
    await this.loadTemplates();
    const defaultTpl = this.templates[0] || this.getStandardFallbackTemplate();

    return `
      <div style="padding:10px 0;">
        ${this.renderStudioTabs('columns')}
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
          <div>
            <h2 style="font-size:1.35rem; font-weight:800; color:#0f172a; margin:0 0 4px 0;">📐 Column & Table Configurator</h2>
            <div style="font-size:0.85rem; color:#64748b;">Add, remove, reorder, and customize column headers for your document item tables.</div>
          </div>
          <div>
            <select id="col-designer-template-select" class="form-select" style="min-width:260px;" onchange="TemplatesEngine.onColumnDesignerTemplateChange(this.value)">
              ${this.templates.map(t => `<option value="${t.id}">${t.template_name} (${(t.doc_type || 'quote').toUpperCase()})</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1.3fr; gap:24px; align-items:start;">
          <!-- Left: Column Config List -->
          <div class="card" style="padding:20px; border:1px solid #e2e8f0; border-radius:10px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
              <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; margin:0;">Item Table Columns</h3>
              <button class="secondary-btn" style="padding:4px 10px; font-size:0.8rem;" onclick="TemplatesEngine.addNewCustomColumn()">➕ Add Column</button>
            </div>

            <div id="col-designer-list-container">
              ${this.renderColumnListManager(defaultTpl)}
            </div>

            <div style="margin-top:20px; display:flex; justify-content:flex-end;">
              <button class="primary-btn" style="background:#0284c7; padding:8px 20px;" onclick="TemplatesEngine.saveColumnConfiguration()">
                💾 Save Column Changes
              </button>
            </div>
          </div>

          <!-- Right: Interactive Live Table Preview -->
          <div class="card" style="padding:20px; border:1px solid #e2e8f0; border-radius:10px;">
            <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; margin:0 0 14px 0;">Live Table Rendering</h3>
            <div id="col-designer-table-preview" style="overflow-x:auto;">
              ${this.renderColumnsTablePreview(defaultTpl)}
            </div>
          </div>
        </div>
      </div>
    `;
  },

  renderColumnListManager(tpl) {
    const cols = typeof tpl.columns_config === 'string' ? JSON.parse(tpl.columns_config || '[]') : (tpl.columns_config || []);

    return `
      <div style="display:flex; flex-direction:column; gap:8px;" id="columns-sortable-list">
        ${cols.map((c, i) => `
          <div class="col-item-row" data-index="${i}" style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
            <div style="display:flex; align-items:center; gap:8px; flex:1;">
              <input type="checkbox" id="col-vis-${i}" ${c.visible !== false ? 'checked' : ''} onchange="TemplatesEngine.updateColVis(${i}, this.checked)">
              <input type="text" class="form-input" style="padding:4px 8px; font-size:0.82rem; height:30px; font-weight:600;" value="${c.label}" onchange="TemplatesEngine.updateColLabel(${i}, this.value)">
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <select class="form-select" style="padding:2px 6px; font-size:0.75rem; height:28px; width:75px;" onchange="TemplatesEngine.updateColAlign(${i}, this.value)">
                <option value="left" ${c.align === 'left' ? 'selected' : ''}>Left</option>
                <option value="center" ${c.align === 'center' ? 'selected' : ''}>Center</option>
                <option value="right" ${c.align === 'right' ? 'selected' : ''}>Right</option>
              </select>
              <input type="text" class="form-input" style="padding:2px 6px; font-size:0.75rem; height:28px; width:55px; text-align:center;" value="${c.width || 'auto'}" onchange="TemplatesEngine.updateColWidth(${i}, this.value)" title="Width e.g. 10% or 60px">
              <button class="secondary-btn" style="padding:2px 6px; font-size:0.75rem;" onclick="TemplatesEngine.moveCol(${i}, -1)" ${i === 0 ? 'disabled' : ''}>▲</button>
              <button class="secondary-btn" style="padding:2px 6px; font-size:0.75rem;" onclick="TemplatesEngine.moveCol(${i}, 1)" ${i === cols.length - 1 ? 'disabled' : ''}>▼</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  },

  renderColumnsTablePreview(tpl) {
    const cols = typeof tpl.columns_config === 'string' ? JSON.parse(tpl.columns_config || '[]') : (tpl.columns_config || []);
    const visible = cols.filter(c => c.visible !== false);

    const dummyRows = [
      { sr: 1, item_code: 'MED-902', item_name: 'High Precision Medical Pulse Oximeter Digital', specs: 'CE Certified, Grade-A Sensors, 2 Year Warranty', brand: 'Omron Japan', quantity: 25, unit: 'SET', unit_price: 18500, tax_rate: '18%', tax_amount: 83250, total_price: 462500, delivery_time: 'Ex-Stock' },
      { sr: 2, item_code: 'INF-104', item_name: 'Sterile IV Infusion Delivery Sets (Boxes of 100)', specs: 'ISO 13485 Compliant, Non-Pyrogenic, Latex Free', brand: 'B. Braun', quantity: 50, unit: 'BOX', unit_price: 4200, tax_rate: '18%', tax_amount: 37800, total_price: 210000, delivery_time: '3 Working Days' }
    ];

    return `
      <table style="width:100%; border-collapse:collapse; font-size:0.8rem; background:white; border:1px solid #cbd5e1;">
        <thead>
          <tr style="background:${tpl.accent_color || '#0f172a'}; color:white;">
            ${visible.map(c => `
              <th style="padding:8px 10px; text-align:${c.align || 'left'}; width:${c.width || 'auto'}; border:1px solid rgba(255,255,255,0.15);">
                ${c.label}
              </th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          ${dummyRows.map(r => `
            <tr style="border-bottom:1px solid #e2e8f0;">
              ${visible.map(c => {
                let val = r[c.key] !== undefined ? r[c.key] : '-';
                if (c.key === 'unit_price' || c.key === 'total_price' || c.key === 'tax_amount') {
                  val = 'PKR ' + Number(val).toLocaleString();
                }
                return `<td style="padding:8px 10px; text-align:${c.align || 'left'}; border:1px solid #f1f5f9;">${val}</td>`;
              }).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  onColumnDesignerTemplateChange(templateId) {
    const tpl = this.templates.find(t => t.id === templateId);
    if (!tpl) return;
    this.currentEditingTemplate = JSON.parse(JSON.stringify(tpl));
    const listCont = document.getElementById('col-designer-list-container');
    const prevCont = document.getElementById('col-designer-table-preview');
    if (listCont) listCont.innerHTML = this.renderColumnListManager(this.currentEditingTemplate);
    if (prevCont) prevCont.innerHTML = this.renderColumnsTablePreview(this.currentEditingTemplate);
  },

  updateColVis(idx, checked) {
    const tpl = this.getActiveDesignerTemplate();
    const cols = this.getTplCols(tpl);
    if (cols[idx]) cols[idx].visible = checked;
    this.refreshDesignerPreviews();
  },

  updateColLabel(idx, val) {
    const tpl = this.getActiveDesignerTemplate();
    const cols = this.getTplCols(tpl);
    if (cols[idx]) cols[idx].label = val;
    this.refreshDesignerPreviews();
  },

  updateColAlign(idx, val) {
    const tpl = this.getActiveDesignerTemplate();
    const cols = this.getTplCols(tpl);
    if (cols[idx]) cols[idx].align = val;
    this.refreshDesignerPreviews();
  },

  updateColWidth(idx, val) {
    const tpl = this.getActiveDesignerTemplate();
    const cols = this.getTplCols(tpl);
    if (cols[idx]) cols[idx].width = val;
    this.refreshDesignerPreviews();
  },

  moveCol(idx, dir) {
    const tpl = this.getActiveDesignerTemplate();
    const cols = this.getTplCols(tpl);
    const target = idx + dir;
    if (target >= 0 && target < cols.length) {
      const temp = cols[idx];
      cols[idx] = cols[target];
      cols[target] = temp;
      const listCont = document.getElementById('col-designer-list-container');
      if (listCont) listCont.innerHTML = this.renderColumnListManager(tpl);
      this.refreshDesignerPreviews();
    }
  },

  addNewCustomColumn() {
    const label = prompt('Enter Column Header Name (e.g. "HS Code", "Warranty", "Pack Size"):');
    if (!label) return;
    const key = label.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const tpl = this.getActiveDesignerTemplate();
    const cols = this.getTplCols(tpl);
    cols.push({ key, label, visible: true, width: '10%', align: 'left' });
    const listCont = document.getElementById('col-designer-list-container');
    if (listCont) listCont.innerHTML = this.renderColumnListManager(tpl);
    this.refreshDesignerPreviews();
  },

  getActiveDesignerTemplate() {
    if (!this.currentEditingTemplate) {
      const select = document.getElementById('col-designer-template-select');
      const id = select ? select.value : (this.templates[0]?.id);
      const found = this.templates.find(t => t.id === id) || this.templates[0];
      this.currentEditingTemplate = JSON.parse(JSON.stringify(found));
    }
    return this.currentEditingTemplate;
  },

  getTplCols(tpl) {
    if (!tpl.columns_config) tpl.columns_config = [];
    if (typeof tpl.columns_config === 'string') {
      tpl.columns_config = JSON.parse(tpl.columns_config);
    }
    return tpl.columns_config;
  },

  refreshDesignerPreviews() {
    const tpl = this.getActiveDesignerTemplate();
    const prevCont = document.getElementById('col-designer-table-preview');
    if (prevCont) prevCont.innerHTML = this.renderColumnsTablePreview(tpl);
  },

  async saveColumnConfiguration() {
    const tpl = this.getActiveDesignerTemplate();
    if (!tpl || !tpl.id) return;
    try {
      const res = await API.updateTemplate(tpl.id, { columns_config: tpl.columns_config });
      if (res && res.success) {
        showToast('✓ Column configuration saved successfully!', 'success');
        await this.loadTemplates();
      } else {
        alert(res.message || 'Failed to save columns');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  // --------------------------------------------------------------------------
  // 4. VIEW: Logo & Letterhead Branding Studio (Multi-Company Logo Center)
  // --------------------------------------------------------------------------
  _selectedCompanyLogoId: null,

  async renderBrandingStudioView() {
    await this.loadTemplates();
    const profiles = State.businessProfiles && State.businessProfiles.length > 0 
      ? State.businessProfiles 
      : await API.getBusinessProfiles();

    // Default to currently selected company in state or first profile
    if (!this._selectedCompanyLogoId && profiles.length > 0) {
      this._selectedCompanyLogoId = (State.currentBusinessProfileId && State.currentBusinessProfileId !== 'all') 
        ? State.currentBusinessProfileId 
        : profiles[0].id;
    }

    const activeCompany = profiles.find(p => p.id === this._selectedCompanyLogoId) || profiles[0] || {};
    const tpl = this.templates[0] || this.getStandardFallbackTemplate();

    return `
      <div style="padding:10px 0; max-width:1050px; margin:0 auto;">
        ${this.renderStudioTabs('branding')}
        <!-- Header Banner -->
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:24px;">
          <div>
            <h2 style="font-size:1.4rem; font-weight:800; color:#0f172a; margin:0 0 4px 0;">🎨 Corporate Logo & Template Branding Hub</h2>
            <div style="font-size:0.86rem; color:#64748b;">Upload official business logos for each company profile. The saved logo automatically reflects across all Executive Reports, Quotations, Tenders, POs, Invoices & Delivery Challans.</div>
          </div>
          <div style="display:flex; gap:10px; align-items:center;">
            <button class="secondary-btn" style="padding:7px 14px; font-size:0.82rem;" onclick="switchView('reports')">
              📈 View Executive Reports
            </button>
            <button class="secondary-btn" style="padding:7px 14px; font-size:0.82rem;" onclick="switchView('templates')">
              📋 Document Templates
            </button>
          </div>
        </div>

        <!-- 1. PRIMARY SECTION: BUSINESS ENTITY LOGO UPLOADER -->
        <div class="card" style="padding:24px; border:1px solid #cbd5e1; border-radius:12px; margin-bottom:24px; background:white; box-shadow:0 4px 15px rgba(0,0,0,0.03);">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:16px; margin-bottom:18px; border-bottom:1px solid #f1f5f9; padding-bottom:16px;">
            <div>
              <div style="font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; color:#0284c7;">STEP 1: SELECT BUSINESS ENTITY</div>
              <h3 style="font-size:1.15rem; font-weight:800; color:#0f172a; margin:4px 0 2px 0;">Select Which Company This Logo Is For</h3>
              <div style="font-size:0.82rem; color:#64748b;">Choose the corporate business profile from your organization to attach or update its official branding.</div>
            </div>
            <div style="min-width:280px;">
              <label class="form-label" style="font-weight:700; font-size:0.82rem;">Target Business Company:</label>
              <select id="branding-company-select" class="form-select" style="font-weight:700; border-color:#0284c7; background:#f0f9ff;" onchange="TemplatesEngine.onCompanyLogoSelectChange(this.value)">
                ${profiles.map(p => `
                  <option value="${p.id}" ${p.id === this._selectedCompanyLogoId ? 'selected' : ''}>
                    🏢 ${p.business_name || p.legal_name || 'Business Entity'} ${p.ntn ? `(NTN: ${p.ntn})` : ''}
                  </option>
                `).join('')}
              </select>
            </div>
          </div>

          <!-- Active Selected Company Details Banner -->
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 18px; margin-bottom:20px; flex-wrap:wrap; gap:12px;">
            <div>
              <div style="font-size:1.05rem; font-weight:800; color:#0f172a;">${activeCompany.business_name || 'MASHRUE ENTERPRISE'}</div>
              <div style="font-size:0.78rem; color:#64748b; margin-top:2px;">
                <strong>NTN:</strong> ${activeCompany.ntn || 'Not Set'} &bull; 
                <strong>STRN:</strong> ${activeCompany.strn || 'Not Set'} &bull; 
                <strong>City:</strong> ${activeCompany.city || 'Pakistan'} &bull; 
                ${activeCompany.address ? `<span>${activeCompany.address}</span>` : ''}
              </div>
            </div>
            <div>
              <span class="badge ${activeCompany.logo_url ? 'badge-won' : 'badge-withdraw'}" style="font-size:0.78rem; padding:4px 10px;">
                ${activeCompany.logo_url ? '✓ Official Logo Configured' : '⚠️ No Logo Uploaded'}
              </span>
            </div>
          </div>

          <!-- Logo Uploader & Preview Box -->
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px; align-items:start;">
            <div>
              <div style="font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; color:#0284c7; margin-bottom:8px;">STEP 2: UPLOAD IMAGE</div>
              <div style="border:2px dashed ${activeCompany.logo_url ? '#10b981' : '#0284c7'}; border-radius:10px; padding:28px 16px; text-align:center; background:#f8fafc; cursor:pointer; transition:all 0.2s;" onclick="document.getElementById('company-logo-file-input').click()">
                <input type="file" id="company-logo-file-input" style="display:none;" accept="image/png, image/jpeg, image/svg+xml, image/webp" onchange="TemplatesEngine.handleCompanyLogoUpload(event)">
                <div id="company-logo-upload-preview" style="min-height:90px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px;">
                  ${activeCompany.logo_url ? `
                    <img src="${activeCompany.logo_url}" style="max-height:90px; max-width:240px; object-fit:contain; border-radius:4px; box-shadow:0 2px 8px rgba(0,0,0,0.06); background:white; padding:4px;">
                    <div style="font-size:0.75rem; color:#059669; font-weight:700;">✓ Active Logo (Click to change file)</div>
                  ` : `
                    <div style="font-size:2.2rem; color:#0284c7;">📷</div>
                    <div style="font-weight:700; color:#0f172a; font-size:0.9rem;">Click to Select Logo File</div>
                    <div style="font-size:0.75rem; color:#64748b;">Supports high-res PNG, SVG, JPG or WebP (Max 5MB)</div>
                  `}
                </div>
              </div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
                <span style="font-size:0.75rem; color:#64748b;">Transparent PNG or SVG recommended</span>
                ${activeCompany.logo_url ? `
                  <button type="button" class="secondary-btn" style="color:#dc2626; border-color:#fecaca; background:#fff5f5; padding:3px 10px; font-size:0.75rem;" onclick="TemplatesEngine.removeCompanyLogo()">
                    🗑️ Remove Logo
                  </button>
                ` : ''}
              </div>
            </div>

            <!-- Live Print & Report Preview -->
            <div>
              <div style="font-size:0.75rem; font-weight:800; text-transform:uppercase; letter-spacing:0.5px; color:#475569; margin-bottom:8px;">LIVE PREVIEW (ON REPORTS & DOCUMENTS)</div>
              <div style="border:1px solid #e2e8f0; border-radius:10px; padding:16px; background:#ffffff; box-shadow:0 2px 6px rgba(0,0,0,0.02);">
                <div style="border-bottom:2px solid #0f172a; padding-bottom:12px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                  <div style="display:flex; gap:12px; align-items:center;">
                    <div id="company-logo-live-preview-box" style="width:70px; height:50px; display:flex; align-items:center; justify-content:center; background:#f8fafc; border:1px dashed #cbd5e1; border-radius:4px; overflow:hidden;">
                      ${activeCompany.logo_url ? `
                        <img src="${activeCompany.logo_url}" style="max-height:46px; max-width:66px; object-fit:contain;">
                      ` : `
                        <span style="font-size:0.65rem; color:#94a3b8; font-weight:700;">LOGO</span>
                      `}
                    </div>
                    <div>
                      <div style="font-size:0.95rem; font-weight:800; color:#0f172a;">${activeCompany.business_name || 'COMPANY NAME'}</div>
                      <div style="font-size:0.7rem; color:#64748b;">NTN: ${activeCompany.ntn || '901920-3'} | STRN: ${activeCompany.strn || '03-09-9920-001'}</div>
                    </div>
                  </div>
                  <div style="text-align:right;">
                    <div style="font-size:0.8rem; font-weight:800; color:#0284c7;">EXECUTIVE REPORT</div>
                    <div style="font-size:0.68rem; color:#94a3b8;">${new Date().toLocaleDateString('en-GB')}</div>
                  </div>
                </div>
                <div style="font-size:0.72rem; color:#475569; line-height:1.4; background:#f8fafc; padding:8px 10px; border-radius:4px;">
                  ℹ️ This is how your company logo will appear on printable Executive Reports, Quotations, Tenders, POs, and Delivery Challans.
                </div>
              </div>

              <!-- Save Action Button -->
              <div style="margin-top:20px;">
                <button type="button" id="btn-save-company-logo" class="primary-btn" style="width:100%; padding:10px 18px; font-size:0.92rem; font-weight:700; background:#0284c7; display:flex; align-items:center; justify-content:center; gap:8px;" onclick="TemplatesEngine.saveCompanyLogo()">
                  <span>💾</span> Save & Apply Company Logo to All Reports & Documents
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 2. QUICK DIRECTORY: ALL REGISTERED COMPANIES & LOGO STATUS -->
        <div class="card" style="padding:20px; border:1px solid #e2e8f0; border-radius:12px; margin-bottom:24px; background:white;">
          <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; margin:0 0 14px 0;">🏢 Organization Business Profiles & Logo Status Directory</h3>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:16px;">
            ${profiles.map(p => `
              <div style="border:1px solid ${p.id === this._selectedCompanyLogoId ? '#0284c7' : '#e2e8f0'}; border-radius:8px; padding:14px; background:${p.id === this._selectedCompanyLogoId ? '#f0f9ff' : '#f8fafc'}; display:flex; justify-content:space-between; align-items:center; gap:12px;">
                <div style="display:flex; align-items:center; gap:10px; overflow:hidden;">
                  <div style="width:50px; height:45px; flex-shrink:0; background:white; border:1px solid #cbd5e1; border-radius:6px; display:flex; align-items:center; justify-content:center; overflow:hidden;">
                    ${p.logo_url ? `<img src="${p.logo_url}" style="max-height:40px; max-width:46px; object-fit:contain;">` : `<span style="font-size:1.3rem;">🏢</span>`}
                  </div>
                  <div style="overflow:hidden;">
                    <div style="font-weight:700; font-size:0.86rem; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${p.business_name}</div>
                    <div style="font-size:0.72rem; color:#64748b;">NTN: ${p.ntn || 'N/A'}</div>
                  </div>
                </div>
                <div>
                  <button class="secondary-btn" style="padding:4px 8px; font-size:0.74rem;" onclick="TemplatesEngine.onCompanyLogoSelectChange('${p.id}')">
                    ${p.logo_url ? '✏️ Edit' : '➕ Upload'}
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- 3. ADVANCED TEMPLATE LETTERHEAD BACKGROUND GRAPHIC (OPTIONAL) -->
        <div class="card" style="padding:20px; border:1px solid #e2e8f0; border-radius:12px; background:white;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div>
              <h3 style="font-size:1.02rem; font-weight:800; color:#0f172a; margin:0 0 2px 0;">📄 Optional: Document Print Template Banner</h3>
              <div style="font-size:0.8rem; color:#64748b;">Attach custom top banner graphics to specific document templates (e.g. Quotations, Tenders).</div>
            </div>
            <div>
              <select id="branding-template-select" class="form-select" style="min-width:220px; font-size:0.82rem;" onchange="TemplatesEngine.onBrandingTemplateChange(this.value)">
                ${this.templates.map(t => `<option value="${t.id}">${t.template_name}</option>`).join('')}
              </select>
            </div>
          </div>

          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; align-items:center;">
            <div style="border:2px dashed #cbd5e1; border-radius:8px; padding:16px; text-align:center; background:#f8fafc; cursor:pointer;" onclick="document.getElementById('branding-bg-input').click()">
              <input type="file" id="branding-bg-input" style="display:none;" accept="image/*" onchange="TemplatesEngine.handleLetterheadBgUpload(event)">
              <div id="branding-bg-preview" style="min-height:60px; display:flex; align-items:center; justify-content:center;">
                ${tpl.letterhead_bg_url ? `<img src="${tpl.letterhead_bg_url}" style="max-height:60px; max-width:100%; object-fit:contain;">` : `<span style="font-size:0.8rem; color:#64748b;">🖼️ Click to upload Template Top Banner Graphic</span>`}
              </div>
            </div>
            <div>
              <label class="form-label" style="font-size:0.8rem;">Letterhead Graphic Mode</label>
              <select id="branding-bg-mode" class="form-select" style="font-size:0.82rem; margin-bottom:10px;" onchange="TemplatesEngine.updateBrandingState()">
                <option value="header_only" ${tpl.letterhead_bg_mode === 'header_only' ? 'selected' : ''}>Top Header Banner Only</option>
                <option value="full_page_bg" ${tpl.letterhead_bg_mode === 'full_page_bg' ? 'selected' : ''}>Full Page Stationery Background</option>
              </select>
              <button class="secondary-btn" style="padding:6px 14px; font-size:0.8rem;" onclick="TemplatesEngine.saveBrandingSettings()">
                💾 Save Template Banner
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  onCompanyLogoSelectChange(companyId) {
    this._selectedCompanyLogoId = companyId;
    const viewArea = document.getElementById('main-content');
    if (viewArea) {
      this.renderBrandingStudioView().then(html => viewArea.innerHTML = html);
    }
  },

  handleCompanyLogoUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('File too large. Please select an image under 5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUri = evt.target.result;
      this._stagedCompanyLogoUri = dataUri;

      // Update upload preview box
      const previewBox = document.getElementById('company-logo-upload-preview');
      if (previewBox) {
        previewBox.innerHTML = `
          <img src="${dataUri}" style="max-height:90px; max-width:240px; object-fit:contain; border-radius:4px; box-shadow:0 2px 8px rgba(0,0,0,0.06); background:white; padding:4px;">
          <div style="font-size:0.75rem; color:#0284c7; font-weight:700;">✓ New Image Ready to Save</div>
        `;
      }

      // Update live report preview box
      const liveBox = document.getElementById('company-logo-live-preview-box');
      if (liveBox) {
        liveBox.innerHTML = `<img src="${dataUri}" style="max-height:46px; max-width:66px; object-fit:contain;">`;
      }

      showToast('Logo loaded into preview. Click "Save & Apply" to finalize.', 'info');
    };
    reader.readAsDataURL(file);
  },

  async saveCompanyLogo() {
    if (!this._selectedCompanyLogoId) {
      const select = document.getElementById('branding-company-select');
      this._selectedCompanyLogoId = select ? select.value : State.currentBusinessProfileId;
    }

    const companyId = this._selectedCompanyLogoId;
    if (!companyId || companyId === 'all') {
      alert('Please select a specific business company profile to attach this logo to.');
      return;
    }

    const logoUri = this._stagedCompanyLogoUri;
    const currentComp = State.businessProfiles ? State.businessProfiles.find(p => p.id === companyId) : null;
    const finalLogo = logoUri !== undefined ? logoUri : (currentComp ? currentComp.logo_url : null);

    if (!finalLogo) {
      alert('Please choose an image file to upload first.');
      return;
    }

    const btn = document.getElementById('btn-save-company-logo');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span>⏳</span> Saving Company Logo...`;
    }

    try {
      const res = await API.updateBusinessProfileLogo(companyId, finalLogo);
      if (res && res.success) {
        showToast('✓ Official Business Logo saved! Now applied across all Reports & Documents.', 'success');
        this._stagedCompanyLogoUri = null;

        // Sync with templates loaded
        if (this.templates && this.templates.length > 0) {
          this.templates.forEach(t => {
            t.logo_url = finalLogo;
          });
        }

        // Re-render view to reflect clean saved state
        const viewArea = document.getElementById('main-content');
        if (viewArea) {
          const html = await this.renderBrandingStudioView();
          viewArea.innerHTML = html;
        }
      } else {
        alert(res.message || 'Error updating business profile logo.');
      }
    } catch (e) {
      console.error('Save Company Logo Error:', e);
      alert('Network error saving logo: ' + e.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<span>💾</span> Save & Apply Company Logo to All Reports & Documents`;
      }
    }
  },

  async removeCompanyLogo() {
    if (!this._selectedCompanyLogoId) return;
    if (!confirm('Remove official logo from this business profile?')) return;

    try {
      const res = await API.updateBusinessProfileLogo(this._selectedCompanyLogoId, null);
      if (res && res.success) {
        showToast('Logo removed from business profile.', 'info');
        this._stagedCompanyLogoUri = null;
        const viewArea = document.getElementById('main-content');
        if (viewArea) {
          const html = await this.renderBrandingStudioView();
          viewArea.innerHTML = html;
        }
      }
    } catch (e) {
      alert('Error removing logo: ' + e.message);
    }
  },

  handleLogoUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUri = evt.target.result;
      const preview = document.getElementById('branding-logo-preview');
      if (preview) preview.innerHTML = `<img src="${dataUri}" style="max-height:80px; max-width:100%; object-fit:contain;">`;
      const tpl = this.getActiveBrandingTemplate();
      tpl.logo_url = dataUri;
    };
    reader.readAsDataURL(file);
  },

  handleLetterheadBgUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const dataUri = evt.target.result;
      const preview = document.getElementById('branding-bg-preview');
      if (preview) preview.innerHTML = `<img src="${dataUri}" style="max-height:80px; max-width:100%; object-fit:contain;">`;
      const tpl = this.getActiveBrandingTemplate();
      tpl.letterhead_bg_url = dataUri;
    };
    reader.readAsDataURL(file);
  },

  getActiveBrandingTemplate() {
    if (!this.currentEditingTemplate) {
      const select = document.getElementById('branding-template-select');
      const id = select ? select.value : (this.templates[0]?.id);
      const found = this.templates.find(t => t.id === id) || this.templates[0];
      this.currentEditingTemplate = JSON.parse(JSON.stringify(found));
    }
    return this.currentEditingTemplate;
  },

  onBrandingTemplateChange(id) {
    const tpl = this.templates.find(t => t.id === id);
    if (!tpl) return;
    this.currentEditingTemplate = JSON.parse(JSON.stringify(tpl));
    const viewArea = document.getElementById('main-content');
    if (viewArea) this.renderBrandingStudioView().then(html => viewArea.innerHTML = html);
  },

  updateBrandingState() {
    const tpl = this.getActiveBrandingTemplate();
    if (!tpl) return;
    tpl.logo_alignment = document.getElementById('branding-logo-align')?.value || 'left';
    tpl.logo_height_px = parseInt(document.getElementById('branding-logo-height')?.value || 65, 10);
    tpl.letterhead_bg_mode = document.getElementById('branding-bg-mode')?.value || 'header_only';
  },

  async saveBrandingSettings() {
    this.updateBrandingState();
    const tpl = this.getActiveBrandingTemplate();
    if (!tpl || !tpl.id) return;
    try {
      const res = await API.updateTemplate(tpl.id, {
        logo_url: tpl.logo_url,
        logo_alignment: tpl.logo_alignment,
        logo_height_px: tpl.logo_height_px,
        letterhead_bg_url: tpl.letterhead_bg_url,
        letterhead_bg_mode: tpl.letterhead_bg_mode
      });
      if (res && res.success) {
        showToast('✓ Branding assets updated successfully!', 'success');
        await this.loadTemplates();
      } else {
        alert(res.message || 'Error updating branding');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  // --------------------------------------------------------------------------
  // 5. VIEW: Paper Size, Margins & Letterhead Mode
  // --------------------------------------------------------------------------
  async renderPaperMarginsView() {
    await this.loadTemplates();
    const tpl = this.templates[0] || this.getStandardFallbackTemplate();

    return `
      <div style="padding:10px 0; max-width:960px; margin:0 auto;">
        ${this.renderStudioTabs('margins')}
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
          <div>
            <h2 style="font-size:1.35rem; font-weight:800; color:#0f172a; margin:0 0 4px 0;">📄 Paper Size & Letterhead Margins</h2>
            <div style="font-size:0.85rem; color:#64748b;">Configure standard paper dimensions (A4, Letter, Legal) and set physical letterhead clearance offsets.</div>
          </div>
          <div>
            <select id="paper-template-select" class="form-select" style="min-width:240px;" onchange="TemplatesEngine.onPaperTemplateChange(this.value)">
              ${this.templates.map(t => `<option value="${t.id}">${t.template_name}</option>`).join('')}
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:24px;">
          <!-- Paper Dimension Card -->
          <div class="card" style="padding:20px; border:1px solid #e2e8f0; border-radius:10px;">
            <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; margin:0 0 14px 0;">Paper Size & Orientation</h3>

            <div style="margin-bottom:14px;">
              <label class="form-label" style="font-size:0.8rem;">Paper Format</label>
              <select id="paper-size-select" class="form-select" onchange="TemplatesEngine.updatePaperState()">
                <option value="A4" ${tpl.paper_size === 'A4' ? 'selected' : ''}>A4 (210 × 297 mm) — PPRA & Pakistan Corporate Standard</option>
                <option value="Letter" ${tpl.paper_size === 'Letter' ? 'selected' : ''}>Letter (8.5 × 11 in) — Commercial Standard</option>
                <option value="Legal" ${tpl.paper_size === 'Legal' ? 'selected' : ''}>Legal (8.5 × 14 in) — Multi-item BoQ & Legal Agreements</option>
              </select>
            </div>

            <div style="margin-bottom:14px;">
              <label class="form-label" style="font-size:0.8rem;">Orientation</label>
              <select id="paper-orientation-select" class="form-select" onchange="TemplatesEngine.updatePaperState()">
                <option value="portrait" ${tpl.paper_orientation === 'portrait' ? 'selected' : ''}>Portrait (Vertical Standard)</option>
                <option value="landscape" ${tpl.paper_orientation === 'landscape' ? 'selected' : ''}>Landscape (Horizontal — Best for wide BoQ tables)</option>
              </select>
            </div>

            <div style="margin-bottom:14px;">
              <label class="form-label" style="font-size:0.8rem;">Template Accent Color</label>
              <input type="color" id="paper-accent-color" class="form-input" style="height:38px; padding:2px 4px;" value="${tpl.accent_color || '#0f172a'}" onchange="TemplatesEngine.updatePaperState()">
            </div>
          </div>

          <!-- Letterhead Mode & Margin Clearance -->
          <div class="card" style="padding:20px; border:1px solid #e2e8f0; border-radius:10px;">
            <h3 style="font-size:1.05rem; font-weight:800; color:#0f172a; margin:0 0 14px 0;">Letterhead Stationery Mode</h3>

            <div style="margin-bottom:14px;">
              <label class="form-label" style="font-size:0.8rem;">Printing Mode</label>
              <select id="paper-lh-mode" class="form-select" onchange="TemplatesEngine.onLetterheadModeChange(this.value)">
                <option value="digital" ${tpl.letterhead_mode === 'digital' ? 'selected' : ''}>🖨️ Full Digital Letterhead (Render Logo & Company Details)</option>
                <option value="letterhead" ${tpl.letterhead_mode === 'letterhead' ? 'selected' : ''}>📄 Pre-Printed Physical Letterhead (Suppress Headers)</option>
              </select>
            </div>

            <div id="physical-margin-controls" style="${tpl.letterhead_mode === 'letterhead' ? '' : 'opacity:0.6; pointer-events:none;'}">
              <div style="margin-bottom:14px;">
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:4px;">
                  <span class="form-label" style="margin:0;">Top Margin Offset (Clearance for Pre-Printed Header)</span>
                  <strong id="top-margin-display">${tpl.top_margin_mm || 55} mm</strong>
                </div>
                <input type="range" id="paper-top-margin" min="15" max="90" step="1" value="${tpl.top_margin_mm || 55}" class="form-range" style="width:100%;" oninput="document.getElementById('top-margin-display').innerText = this.value + ' mm'; TemplatesEngine.updatePaperState();">
                <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">Typical corporate stationery uses 50mm–65mm clearance.</div>
              </div>

              <div style="margin-bottom:14px;">
                <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:4px;">
                  <span class="form-label" style="margin:0;">Bottom Margin (Footer Clearance)</span>
                  <strong id="bottom-margin-display">${tpl.bottom_margin_mm || 20} mm</strong>
                </div>
                <input type="range" id="paper-bottom-margin" min="10" max="60" step="1" value="${tpl.bottom_margin_mm || 20}" class="form-range" style="width:100%;" oninput="document.getElementById('bottom-margin-display').innerText = this.value + ' mm'; TemplatesEngine.updatePaperState();">
              </div>
            </div>
          </div>
        </div>

        <div style="margin-top:20px; display:flex; justify-content:flex-end;">
          <button class="primary-btn" style="background:#0284c7; padding:8px 24px;" onclick="TemplatesEngine.savePaperSettings()">
            💾 Save Paper & Margin Settings
          </button>
        </div>
      </div>
    `;
  },

  onLetterheadModeChange(mode) {
    const controls = document.getElementById('physical-margin-controls');
    if (controls) {
      if (mode === 'letterhead') {
        controls.style.opacity = '1';
        controls.style.pointerEvents = 'auto';
      } else {
        controls.style.opacity = '0.6';
        controls.style.pointerEvents = 'none';
      }
    }
    this.updatePaperState();
  },

  getActivePaperTemplate() {
    if (!this.currentEditingTemplate) {
      const select = document.getElementById('paper-template-select');
      const id = select ? select.value : (this.templates[0]?.id);
      const found = this.templates.find(t => t.id === id) || this.templates[0];
      this.currentEditingTemplate = JSON.parse(JSON.stringify(found));
    }
    return this.currentEditingTemplate;
  },

  onPaperTemplateChange(id) {
    const tpl = this.templates.find(t => t.id === id);
    if (!tpl) return;
    this.currentEditingTemplate = JSON.parse(JSON.stringify(tpl));
    const viewArea = document.getElementById('main-content');
    if (viewArea) this.renderPaperMarginsView().then(html => viewArea.innerHTML = html);
  },

  updatePaperState() {
    const tpl = this.getActivePaperTemplate();
    tpl.paper_size = document.getElementById('paper-size-select')?.value || 'A4';
    tpl.paper_orientation = document.getElementById('paper-orientation-select')?.value || 'portrait';
    tpl.accent_color = document.getElementById('paper-accent-color')?.value || '#0f172a';
    tpl.letterhead_mode = document.getElementById('paper-lh-mode')?.value || 'digital';
    tpl.top_margin_mm = parseInt(document.getElementById('paper-top-margin')?.value || 15, 10);
    tpl.bottom_margin_mm = parseInt(document.getElementById('paper-bottom-margin')?.value || 15, 10);
  },

  async savePaperSettings() {
    this.updatePaperState();
    const tpl = this.getActivePaperTemplate();
    if (!tpl || !tpl.id) return;
    try {
      const res = await API.updateTemplate(tpl.id, {
        paper_size: tpl.paper_size,
        paper_orientation: tpl.paper_orientation,
        accent_color: tpl.accent_color,
        letterhead_mode: tpl.letterhead_mode,
        top_margin_mm: tpl.top_margin_mm,
        bottom_margin_mm: tpl.bottom_margin_mm
      });
      if (res && res.success) {
        showToast('✓ Paper and margin settings saved!', 'success');
        await this.loadTemplates();
      } else {
        alert(res.message || 'Error saving settings');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  // --------------------------------------------------------------------------
  // 6. VIEW: Customer Template Mappings
  // --------------------------------------------------------------------------
  async renderCustomerMappingsView() {
    await this.loadCustomerMappings();
    await this.loadTemplates();
    const customers = State.customers || (await API.getCustomers()) || [];

    return `
      <div style="padding:10px 0;">
        ${this.renderStudioTabs('mappings')}
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:20px;">
          <div>
            <h2 style="font-size:1.35rem; font-weight:800; color:#0f172a; margin:0 0 4px 0;">👥 Customer Template Mappings</h2>
            <div style="font-size:0.85rem; color:#64748b;">Assign customer-specific templates (e.g. WAPDA, Armed Forces, Health Dept) that override system defaults automatically.</div>
          </div>
          <button class="primary-btn" style="background:#0284c7;" onclick="TemplatesEngine.openAddCustomerMappingModal()">
            ➕ Link Customer to Template
          </button>
        </div>

        <div class="card" style="padding:0; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden;">
          <table class="data-table" style="width:100%; border-collapse:collapse;">
            <thead>
              <tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:0.82rem; color:#475569;">
                <th style="padding:12px 16px; text-align:left;">Customer / Client Organization</th>
                <th style="padding:12px 16px; text-align:left;">Document Type</th>
                <th style="padding:12px 16px; text-align:left;">Assigned Custom Template</th>
                <th style="padding:12px 16px; text-align:left;">Paper & Mode</th>
                <th style="padding:12px 16px; text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${this.customerMappings.length === 0 ? `
                <tr>
                  <td colspan="5" style="text-align:center; padding:30px; color:#64748b;">
                    No customer mappings created yet. All customers are currently using tenant default templates.
                  </td>
                </tr>
              ` : this.customerMappings.map(m => `
                <tr style="border-bottom:1px solid #f1f5f9; font-size:0.85rem;">
                  <td style="padding:12px 16px;">
                    <strong style="color:#0f172a;">${m.customer_name}</strong>
                    ${m.customer_org_type ? `<br><span style="font-size:0.75rem; color:#64748b;">${m.customer_org_type}</span>` : ''}
                  </td>
                  <td style="padding:12px 16px;">
                    <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">
                      ${(m.doc_type || 'quotation').toUpperCase()}
                    </span>
                  </td>
                  <td style="padding:12px 16px;">
                    <strong style="color:#0284c7;">${m.template_name}</strong>
                  </td>
                  <td style="padding:12px 16px; color:#475569; font-size:0.8rem;">
                    ${m.paper_size || 'A4'} • ${m.letterhead_mode === 'letterhead' ? '📄 Pre-Printed Stationery' : '🖨️ Digital Letterhead'}
                  </td>
                  <td style="padding:12px 16px; text-align:right;">
                    <button class="secondary-btn" style="padding:4px 8px; color:#ef4444; font-size:0.8rem;" onclick="TemplatesEngine.deleteCustomerMapping('${m.id}')">Remove</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  async openAddCustomerMappingModal() {
    const customers = State.customers || (await API.getCustomers()) || [];
    const tpls = this.templates;

    const modalHtml = `
      <div class="modal-backdrop" id="modal-add-cust-mapping" style="display:flex;">
        <div class="modal-card" style="max-width:540px;">
          <div class="modal-header">
            <h3 style="font-size:1.15rem; font-weight:800; margin:0;">👥 Link Customer to Custom Template</h3>
            <button class="modal-close-btn" onclick="closeModal('modal-add-cust-mapping')">&times;</button>
          </div>
          <div class="modal-body" style="padding:20px;">
            <div class="form-group" style="margin-bottom:14px;">
              <label class="form-label">Select Customer / Client</label>
              <select id="cust-mapping-cust-id" class="form-select">
                ${customers.map(c => `<option value="${c.id}">${c.business_name || c.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label class="form-label">Document Type</label>
              <select id="cust-mapping-doc-type" class="form-select" onchange="TemplatesEngine.filterMappingTemplatesDropdown(this.value)">
                <option value="quotation">Commercial Quotations</option>
                <option value="tender">Tenders & BoQ Submissions</option>
                <option value="purchase_order">Purchase Orders (PO)</option>
                <option value="technical_proposal">Technical Proposals</option>
                <option value="financial_proposal">Financial Proposals</option>
                <option value="delivery_challan">Delivery Challans</option>
                <option value="invoice">Tax Invoices</option>
              </select>
            </div>
            <div class="form-group" style="margin-bottom:20px;">
              <label class="form-label">Select Assigned Template</label>
              <select id="cust-mapping-tpl-id" class="form-select">
                ${tpls.map(t => `<option value="${t.id}">${t.template_name} (${(t.doc_type || 'quote').toUpperCase()})</option>`).join('')}
              </select>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px;">
              <button class="secondary-btn" onclick="closeModal('modal-add-cust-mapping')">Cancel</button>
              <button class="primary-btn" style="background:#0284c7;" onclick="TemplatesEngine.saveNewCustomerMapping()">Save Customer Mapping</button>
            </div>
          </div>
        </div>
      </div>
    `;
    let existing = document.getElementById('modal-add-cust-mapping');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    if (typeof openModal === 'function') {
      openModal('modal-add-cust-mapping');
    } else {
      const el = document.getElementById('modal-add-cust-mapping');
      if (el) el.classList.add('open');
    }
  },

  async saveNewCustomerMapping() {
    const customer_id = document.getElementById('cust-mapping-cust-id')?.value;
    const doc_type = document.getElementById('cust-mapping-doc-type')?.value;
    const template_id = document.getElementById('cust-mapping-tpl-id')?.value;

    if (!customer_id || !template_id) {
      alert('Please select both Customer and Template.');
      return;
    }

    try {
      const res = await API.saveCustomerTemplateMapping({ customer_id, doc_type, template_id });
      if (res && res.success) {
        showToast('✓ Customer template mapping linked!', 'success');
        closeModal('modal-add-cust-mapping');
        await this.loadCustomerMappings();
        const viewArea = document.getElementById('main-content');
        if (viewArea) this.renderCustomerMappingsView().then(html => viewArea.innerHTML = html);
      } else {
        alert(res.message || 'Failed to save mapping');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  async deleteCustomerMapping(id) {
    if (!confirm('Remove this custom mapping? The customer will revert to default templates.')) return;
    try {
      const res = await API.deleteCustomerTemplateMapping(id);
      if (res && res.success) {
        showToast('✓ Customer mapping removed', 'success');
        await this.loadCustomerMappings();
        const viewArea = document.getElementById('main-content');
        if (viewArea) this.renderCustomerMappingsView().then(html => viewArea.innerHTML = html);
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  // --------------------------------------------------------------------------
  // 7. COMPILER ENGINE: Compile Template & Data into Pixel-Perfect HTML
  // --------------------------------------------------------------------------
  compilePreviewHTML(tpl, overrideData = null) {
    if (overrideData) {
      return this.compileDocumentHTML(tpl, overrideData);
    }

    // 1. Resolve concrete active business entity dynamically
    const printProfile = State.getPrintableBusinessProfile();
    const docType = (tpl.doc_type || 'quotation').toLowerCase();
    const isTender = docType === 'tender';

    // 2. Resolve Customer dynamically from real customer records or linked active record
    let dynamicCustomer = null;
    const cachedCustomers = window._cachedCustomers || [];
    if (tpl.customer_id && cachedCustomers.length > 0) {
      dynamicCustomer = cachedCustomers.find(c => String(c.id) === String(tpl.customer_id));
    }
    if (!dynamicCustomer && cachedCustomers.length > 0) {
      dynamicCustomer = cachedCustomers[0];
    }
    if (!dynamicCustomer && window.currentTenderPrintData?.customer) {
      dynamicCustomer = window.currentTenderPrintData.customer;
    }
    if (!dynamicCustomer && window.currentQuotationPrintData?.customer) {
      dynamicCustomer = window.currentQuotationPrintData.customer;
    }

    const customerObj = {
      business_name: dynamicCustomer?.business_name || dynamicCustomer?.name || 'Valued Client Organization',
      contact_person: dynamicCustomer?.contact_person || 'Procurement & Commercial Directorate',
      phone: dynamicCustomer?.phone || '',
      email: dynamicCustomer?.email || '',
      address: dynamicCustomer?.address || (dynamicCustomer?.city ? `${dynamicCustomer.city}, Pakistan` : 'Pakistan')
    };

    // 3. Resolve Items dynamically from real SKU products or template sample draft
    let dynamicItems = [];
    if (tpl.items && Array.isArray(tpl.items) && tpl.items.length > 0) {
      dynamicItems = tpl.items;
    } else if (this.sampleDraft?.items && Array.isArray(this.sampleDraft.items) && this.sampleDraft.items.length > 0) {
      dynamicItems = this.sampleDraft.items;
    } else {
      const cachedProducts = window._cachedProducts || [];
      if (cachedProducts.length > 0) {
        dynamicItems = cachedProducts.slice(0, 3).map((p, idx) => {
          const qty = idx === 0 ? 5 : (idx === 1 ? 2 : 10);
          const unitPrice = parseFloat(p.selling_price || p.price || p.cost_price || 25000);
          return {
            item_name: p.name || 'Catalog Item',
            specs: p.specifications || p.description || p.size || 'Standard Specification Requirements Compliant',
            brand: p.brand_name || printProfile.business_name || '',
            quantity: qty,
            unit: p.unit || 'PCS',
            estimated_unit_price: unitPrice,
            estimated_total_price: unitPrice * qty,
            delivery_time: 'Ex-Stock / 3-5 Days'
          };
        });
      }
    }

    // Dynamic fallback if no products registered in SKU catalog yet
    if (!dynamicItems || dynamicItems.length === 0) {
      const companyWord = printProfile.business_name || 'Commercial';
      dynamicItems = [
        {
          item_name: `${companyWord} Supply Scope Item - 01`,
          specs: 'Standard technical specification, ISO quality compliant',
          brand: printProfile.business_name || 'Brand Origin',
          quantity: 1,
          unit: 'LOT',
          estimated_unit_price: 150000,
          estimated_total_price: 150000,
          delivery_time: 'Ex-Stock'
        }
      ];
    }

    // 4. Resolve Reference Number & Subject dynamically
    const prefix = isTender ? 'TND' : 'QTN';
    const year = new Date().getFullYear();
    const activeRef = isTender
      ? (window.currentTenderPrintData?.opportunity_number)
      : (window.currentQuotationPrintData?.opportunity_number);
    const oppNumber = activeRef || `${prefix}-${year}-${String(Math.floor(100 + Math.random() * 900))}`;

    const activeTitle = isTender
      ? (window.currentTenderPrintData?.tender_name || window.currentTenderPrintData?.title)
      : (window.currentQuotationPrintData?.tender_name || window.currentQuotationPrintData?.title);
    const tenderTitle = activeTitle || `${tpl.template_name || 'Commercial Proposal'} — Bidding & Scope`;

    const dynamicData = {
      opportunity_number: oppNumber,
      created_at: new Date().toISOString(),
      opening_date: new Date().toISOString(),
      quotation_validity_days: tpl.quotation_validity_days || 30,
      tender_name: tenderTitle,
      delivery_lead_time: tpl.delivery_lead_time || '3-5 Working Days',
      payment_terms: tpl.payment_terms || '30 Days Net',
      rfq_reference: tpl.rfq_reference || 'Official Inquiry',
      items: dynamicItems,
      customer: customerObj,
      business_name: printProfile.business_name,
      business_profile_id: printProfile.id
    };

    return this.compileDocumentHTML(tpl, dynamicData);
  },

  compilePurchaseOrderHTML(tpl, docData, currentProfile) {
    const cust = docData.customer || {};
    const items = docData.items && docData.items.length > 0 ? docData.items : [
      { item_name: 'Surgical gloves', specs: 'SURGICAL GLOVES 7.0', unit: 'EACH', pack_size: 1, estimated_unit_price: 120, quantity: 4000, estimated_total_price: 480000, delivery_date: 'Mar 16, 2026', quoted_delivery_date: 'Mar 16, 2026' }
    ];

    const subtotal = items.reduce((acc, itm) => acc + (parseFloat(itm.estimated_total_price) || (parseFloat(itm.quantity || 1) * parseFloat(itm.estimated_unit_price || 0))), 0);
    const taxRate = docData.tax_rate_pct != null ? parseFloat(docData.tax_rate_pct) : 0;
    const taxTotal = (subtotal * taxRate) / 100;
    const grandTotal = subtotal + taxTotal;

    const poNumber = docData.po_number || docData.opportunity_number || '3464344';
    const poDateStr = formatDateDDMMYYYY(docData.po_date || docData.created_at || new Date());
    const validDateStr = formatDateDDMMYYYY(docData.validity_date || new Date(Date.now() + 14 * 86400000));
    const generatedBy = docData.generated_by || State.currentUser?.fullName || 'Amber Iqbal Khan';

    const supplierName = docData.supplier_name || currentProfile.business_name || 'ECON&CO';
    const supplierMobile = docData.supplier_mobile || currentProfile.phone || '+923224670704';
    const supplierEmail = docData.supplier_email || currentProfile.email || 'ahmedch08@gmail.com';
    const supplierAddress = docData.supplier_address || currentProfile.address || 'House no 191-b B block Johar town';

    const orgTitle = docData.organization_name || cust.business_name || 'Mayo Hospital, Lahore - SH&MED';
    const orgAddress = docData.organization_address || cust.address || 'Hospital Rd, Anarkali Bazaar Lahore, Punjab 54000 Phone: 042-99211129 Fax: ';

    this.injectPrintPageStyle(tpl.paper_size || 'A4', tpl.paper_orientation || 'portrait', tpl.top_margin_mm || 12, tpl.bottom_margin_mm || 12);

    return `
      <div class="printable-content-root po-mayo-style" style="font-family:${tpl.font_family || 'Arial, sans-serif'}; font-size:8pt; line-height:1.35; color:#000; background:#fff; padding:4px;">
        <div style="text-align:center; margin-bottom:12px;">
          <div style="font-size:12pt; font-weight:bold; letter-spacing:-0.2px;">${orgTitle}</div>
          <div style="font-size:7.5pt; color:#222; margin-top:2px;">${orgAddress}</div>
        </div>

        <div style="display:grid; grid-template-columns:1.2fr 1fr; gap:14px; font-size:7.5pt; margin-bottom:10px; line-height:1.45;">
          <div>
            <div style="font-weight:bold; font-size:8.5pt;">PO# ${poNumber}</div>
            <div><strong>Supplier:</strong> ${supplierName}</div>
            <div style="padding-left:18px;"><strong>Mobile:</strong> ${supplierMobile}</div>
            <div style="padding-left:18px;"><strong>Email:</strong> ${supplierEmail}</div>
            <div style="padding-left:18px;"><strong>Supplier Address:</strong> ${supplierAddress}</div>
          </div>
          <div style="text-align:right;">
            <div><strong>PO Date:</strong> ${poDateStr}</div>
            <div><strong>Generated By:</strong> ${generatedBy}</div>
            <div><strong>Validity Date:</strong> ${validDateStr}</div>
          </div>
        </div>

        <div style="font-size:7pt; margin-bottom:12px; line-height:1.35;">
          <strong>Term(s) and Condition(s):</strong><br>
          ${tpl.custom_terms || 'AS PER PPRA should mention brand and Defacement is mandatory (govt. property, mayo Hospital Lahore. NOT FOR SALE) DRAP registration/Enlistment is compulsory (if applicable)'}
        </div>

        <div style="text-align:center; font-weight:bold; font-size:10.5pt; letter-spacing:1px; margin:10px 0 8px 0;">
          PURCHASE ORDER
        </div>

        <table style="width:100%; border-collapse:collapse; margin-bottom:12px; font-size:7.5pt;">
          <thead>
            <tr style="background:#000; color:#fff; font-weight:bold; text-align:left;">
              <th style="padding:6px 6px; border:1px solid #000; width:15%;">Item Description</th>
              <th style="padding:6px 6px; border:1px solid #000; width:15%;">Specification</th>
              <th style="padding:6px 6px; border:1px solid #000; width:9%; text-align:center;">Unit Of Measure</th>
              <th style="padding:6px 6px; border:1px solid #000; width:7%; text-align:center;">Pack Size</th>
              <th style="padding:6px 6px; border:1px solid #000; width:9%; text-align:right;">Price</th>
              <th style="padding:6px 6px; border:1px solid #000; width:8%; text-align:center;">Quantity</th>
              <th style="padding:6px 6px; border:1px solid #000; width:11%; text-align:right;">Amount</th>
              <th style="padding:6px 6px; border:1px solid #000; width:9%; text-align:right;">Tax Amount</th>
              <th style="padding:6px 6px; border:1px solid #000; width:9%; text-align:center;">Delivery Date</th>
              <th style="padding:6px 6px; border:1px solid #000; width:9%; text-align:center;">Quoted Delivery Date</th>
            </tr>
          </thead>
          <tbody>
            ${items.map(it => {
              const uPrice = parseFloat(it.estimated_unit_price || it.price || 0);
              const qty = parseFloat(it.quantity || 1);
              const lineAmt = parseFloat(it.estimated_total_price || (uPrice * qty));
              const lineTax = parseFloat(it.tax_amount || 0);
              return `
                <tr style="border-bottom:1px solid #ddd;">
                  <td style="padding:6px 6px; border:1px solid #eee; vertical-align:top;">${it.item_name || it.item_description || 'Scope Item'}</td>
                  <td style="padding:6px 6px; border:1px solid #eee; vertical-align:top;">${it.specs || it.specifications || it.specification || '-'}</td>
                  <td style="padding:6px 6px; border:1px solid #eee; text-align:center; vertical-align:top;">${it.unit || it.uom || 'EACH'}</td>
                  <td style="padding:6px 6px; border:1px solid #eee; text-align:center; vertical-align:top;">${it.pack_size || 1}</td>
                  <td style="padding:6px 6px; border:1px solid #eee; text-align:right; vertical-align:top;">PKR. ${uPrice.toLocaleString('en-PK', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                  <td style="padding:6px 6px; border:1px solid #eee; text-align:center; vertical-align:top;">${qty}</td>
                  <td style="padding:6px 6px; border:1px solid #eee; text-align:right; vertical-align:top;">PKR. ${lineAmt.toLocaleString('en-PK', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                  <td style="padding:6px 6px; border:1px solid #eee; text-align:right; vertical-align:top;">PKR. ${lineTax.toLocaleString('en-PK', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
                  <td style="padding:6px 6px; border:1px solid #eee; text-align:center; vertical-align:top;">${it.delivery_date || poDateStr}</td>
                  <td style="padding:6px 6px; border:1px solid #eee; text-align:center; vertical-align:top;">${it.quoted_delivery_date || poDateStr}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>

        <div style="display:flex; justify-content:flex-end; margin-bottom:16px;">
          <table style="font-size:7.5pt; border-collapse:collapse; min-width:320px;">
            <tr>
              <td style="padding:3px 12px; text-align:left;">Total Exclusive Tax Amount</td>
              <td style="padding:3px 12px; text-align:right; font-weight:bold;">PKR. ${subtotal.toLocaleString('en-PK', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
            </tr>
            <tr>
              <td style="padding:3px 12px; text-align:left;">Total Tax</td>
              <td style="padding:3px 12px; text-align:right; font-weight:bold;">PKR. ${taxTotal.toLocaleString('en-PK', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
            </tr>
            <tr style="border-top:1px solid #000; font-weight:bold;">
              <td style="padding:5px 12px; text-align:left;">Total Inclusive Tax Amount</td>
              <td style="padding:5px 12px; text-align:right;">PKR. ${grandTotal.toLocaleString('en-PK', {minimumFractionDigits:2, maximumFractionDigits:2})}</td>
            </tr>
          </table>
        </div>

        <div style="text-align:center; font-size:7.5pt; color:#333; margin-top:28px;">
          This is a system generated document and does not deem necessary to have physical signatures.
        </div>
        <div style="text-align:right; font-size:7pt; color:#555; margin-top:10px;">
          Print Date and Time: ${new Date().toLocaleString('en-GB')}
        </div>
      </div>
    `;
  },

  compileTechnicalProposalHTML(tpl, docData, currentProfile) {
    const cust = docData.customer || {};
    const items = docData.items && docData.items.length > 0 ? docData.items : [
      { item_name: 'Rolled Register Hard Binding Size 8*13 Paper Weight 68gm Pages 200', specs: '', brand: 'As per sample', unit: 'Per Nos', quantity: 2200 },
      { item_name: 'White Paper Size A4 Paper Weight 80gm Pages of 500/Rim Type Imported', specs: '', brand: 'BLC', unit: 'Per Nos', quantity: 20000 },
      { item_name: 'Ball Point Color: Blue/Red', specs: '', brand: 'Piano', unit: 'Per Nos', quantity: 22000 }
    ];

    const currentYear = new Date().getFullYear();
    const financialYear = `${currentYear}-${currentYear + 1}`;
    const subjectTitle = (docData.tender_name || docData.title || 'PROCUREMENT OF STATIONARY ITEMS (A-16)').toUpperCase();
    const orgName = (cust.business_name || cust.name || 'MAYO HOSPITAL LAHORE').toUpperCase();
    const sectionTitle = (docData.lot_title || docData.category_name || 'STAIONARY ITEMS').toUpperCase();

    this.injectPrintPageStyle(tpl.paper_size || 'A4', tpl.paper_orientation || 'portrait', tpl.top_margin_mm || 15, tpl.bottom_margin_mm || 15);

    return `
      <div class="printable-content-root tech-proposal-style" style="font-family:${tpl.font_family || 'Arial, sans-serif'}; font-size:9pt; line-height:1.4; color:#000; background:#fff; padding:6px;">
        <div style="margin-bottom:14px; font-size:9.5pt; line-height:1.45;">
          <div>To,</div>
          <div style="font-weight:bold;">${docData.addressed_to || 'Chief Executive Officer'}</div>
          <div style="font-weight:bold;">${cust.business_name || cust.name || 'Mayo Hospital Lahore.'}</div>
        </div>

        <div style="margin-bottom:14px; font-size:9.5pt; line-height:1.45;">
          <strong>Subject: TECHNICAL PROPOSAL FRAMEWORK CONTRACT FOR ${subjectTitle} FOR THE FINANCIAL YEAR ${financialYear} ${orgName}.</strong>
        </div>

        <div style="text-align:center; font-weight:bold; font-size:10.5pt; letter-spacing:0.5px; margin:14px 0 8px 0;">
          ${sectionTitle}
        </div>

        <table style="width:100%; border-collapse:collapse; margin-bottom:18px; font-size:8.5pt;">
          <thead>
            <tr style="background:#fff; font-weight:bold; text-align:left;">
              <th style="padding:6px 8px; border:1px solid #000; width:7%; text-align:center;">Sr.#</th>
              <th style="padding:6px 8px; border:1px solid #000; width:55%;">Item Name & Description / Specification</th>
              <th style="padding:6px 8px; border:1px solid #000; width:16%;">Brand</th>
              <th style="padding:6px 8px; border:1px solid #000; width:11%; text-align:center;">Unit</th>
              <th style="padding:6px 8px; border:1px solid #000; width:11%; text-align:center;">Qty</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((it, idx) => {
              const fullDesc = [it.item_name || it.item_description, it.specs || it.specifications].filter(Boolean).join('<br>');
              return `
                <tr>
                  <td style="padding:6px 8px; border:1px solid #000; text-align:center; vertical-align:top;">${idx + 1}</td>
                  <td style="padding:6px 8px; border:1px solid #000; vertical-align:top;">${fullDesc || 'Scope Item Specification Compliant'}</td>
                  <td style="padding:6px 8px; border:1px solid #000; vertical-align:top;">${it.brand || it.brand_name || 'As per sample'}</td>
                  <td style="padding:6px 8px; border:1px solid #000; text-align:center; vertical-align:top;">${it.unit || 'Per Nos'}</td>
                  <td style="padding:6px 8px; border:1px solid #000; text-align:center; vertical-align:top;">${it.quantity || 1}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>

        <div style="font-size:8.5pt; margin-top:16px;">
          <strong>Note:</strong><br>
          ${tpl.custom_terms || 'Bid Validity as per Bidding Documents'}
        </div>

        <div style="margin-top:40px; font-size:12pt; font-weight:900; letter-spacing:1px;">
          ${(currentProfile.business_name || 'DO WIDE TRADERS').toUpperCase()}
        </div>
        <div style="font-size:7.5pt; color:#555; margin-top:4px;">
          Authorized Corporate Representative & Stamp
        </div>
      </div>
    `;
  },

  compileFinancialProposalHTML(tpl, docData, currentProfile) {
    const cust = docData.customer || {};
    const items = docData.items && docData.items.length > 0 ? docData.items : [
      { item_name: 'Standee with stand', specs: "Size 2'x5', 4 color printing on star flex with A+ stand", unit: 'Nos', unit_price: 837, quantity: 3500, total_price: 2929500 },
      { item_name: 'Standees (Print only)', specs: "Size 2' x 5', 4 color printing on star flex without Stands", unit: 'Nos', unit_price: 405, quantity: 500, total_price: 202500 }
    ];

    const grandTotal = items.reduce((acc, itm) => acc + (parseFloat(itm.total_price) || (parseFloat(itm.quantity || 1) * parseFloat(itm.unit_price || 0))), 0);
    const inWords = convertNumberToWordsPKR(grandTotal);

    const docDateStr = formatDateDDMMYYYY(docData.opening_date || docData.created_at || new Date());
    const subjectTitle = (docData.tender_name || docData.title || 'Procurement of Printing & Publication').toUpperCase();
    const customerTitle = cust.business_name || 'Punjab Information Technology Board,';
    const customerCity = cust.city || 'Lahore.';
    const frameworkRef = docData.rfq_reference || docData.external_tender_number || 'Framework Contract NDP – 01';

    this.injectPrintPageStyle(tpl.paper_size || 'A4', tpl.paper_orientation || 'portrait', tpl.top_margin_mm || 15, tpl.bottom_margin_mm || 15);

    return `
      <div class="printable-content-root financial-proposal-style" style="font-family:${tpl.font_family || 'Arial, sans-serif'}; font-size:9pt; line-height:1.4; color:#000; background:#fff; padding:6px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:14px; font-size:9.5pt;">
          <div>
            <div>To,</div>
            <div style="font-weight:bold;">${customerTitle}</div>
            <div>${customerCity}</div>
          </div>
          <div style="font-weight:bold;">
            Date: ${docDateStr}
          </div>
        </div>

        <div style="margin-bottom:14px; font-size:9.5pt; line-height:1.45;">
          <strong>Subject: Financial Proposal for the ${subjectTitle} for ${customerTitle} and its Various Projects Under ${frameworkRef}</strong>
        </div>

        <div style="margin-top:12px; border:1px solid #000; background:#e2e8f0; text-align:center; padding:4px; font-weight:bold; font-size:9.5pt;">
          ${docData.lot_name || 'LOT No. 1'}
        </div>
        <div style="border:1px solid #000; border-top:none; background:#cbd5e1; text-align:center; padding:4px; font-weight:bold; font-size:9.5pt; margin-bottom:0;">
          ${(docData.category_name || 'FLEXOGRAPHIC PRINTING ITEMS').toUpperCase()}
        </div>

        <table style="width:100%; border-collapse:collapse; margin-bottom:0; font-size:8.5pt;">
          <thead>
            <tr style="background:#f1f5f9; font-weight:bold; text-align:left;">
              <th style="padding:6px 6px; border:1px solid #000; width:5%; text-align:center;">Sr.#</th>
              <th style="padding:6px 8px; border:1px solid #000; width:20%;">Item Name</th>
              <th style="padding:6px 8px; border:1px solid #000; width:30%;">Offered Parameters<br>(Specification/Dimensions)</th>
              <th style="padding:6px 6px; border:1px solid #000; width:8%; text-align:center;">Medium</th>
              <th style="padding:6px 8px; border:1px solid #000; width:13%; text-align:right;">Unit price<br>(inclusive of all taxes & duties etc.)</th>
              <th style="padding:6px 8px; border:1px solid #000; width:9%; text-align:center;">Quantity</th>
              <th style="padding:6px 8px; border:1px solid #000; width:15%; text-align:right;">Total price<br>(inclusive of all taxes & duties etc.)</th>
            </tr>
          </thead>
          <tbody>
            ${items.map((it, idx) => {
              const uPrice = parseFloat(it.unit_price || it.estimated_unit_price || 0);
              const qty = parseFloat(it.quantity || 1);
              const lineTot = parseFloat(it.total_price || it.estimated_total_price || (uPrice * qty));
              return `
                <tr>
                  <td style="padding:6px 6px; border:1px solid #000; text-align:center; vertical-align:top;">${idx + 1}</td>
                  <td style="padding:6px 8px; border:1px solid #000; vertical-align:top; font-weight:600;">${it.item_name || 'Scope Item'}</td>
                  <td style="padding:6px 8px; border:1px solid #000; vertical-align:top;">${it.specs || it.specifications || it.description || '-'}</td>
                  <td style="padding:6px 6px; border:1px solid #000; text-align:center; vertical-align:top;">${it.unit || it.medium || 'Nos'}</td>
                  <td style="padding:6px 8px; border:1px solid #000; text-align:right; vertical-align:top;">${uPrice.toLocaleString('en-PK')}</td>
                  <td style="padding:6px 8px; border:1px solid #000; text-align:center; vertical-align:top;">${qty.toLocaleString('en-PK')}</td>
                  <td style="padding:6px 8px; border:1px solid #000; text-align:right; vertical-align:top; font-weight:600;">${lineTot.toLocaleString('en-PK')}</td>
                </tr>
              `;
            }).join('')}
            <tr style="font-weight:bold; background:#fff;">
              <td colspan="6" style="padding:6px 12px; border:1px solid #000; text-align:right;">Total Bid Price:</td>
              <td style="padding:6px 8px; border:1px solid #000; text-align:right; font-size:9.5pt;">${grandTotal.toLocaleString('en-PK')}</td>
            </tr>
          </tbody>
        </table>

        <div style="margin-top:12px; font-size:9pt; line-height:1.6;">
          <div>Total Bid value (against which a Bid shall be evaluated) in figure (PKR). <strong>${grandTotal.toLocaleString('en-PK')}/-</strong></div>
          <div>Total Bid value (against which a Bid shall be evaluated) in words (PKR). <strong>${inWords}</strong></div>
        </div>

        <div style="margin-top:20px; font-size:8.5pt;">
          <strong>Note:</strong> ${tpl.custom_terms || 'Bid Validity as per Tender'}
        </div>

        <div style="margin-top:35px; text-align:right; font-size:12pt; font-weight:900; letter-spacing:1px;">
          ${(currentProfile.business_name || 'ECON & CO').toUpperCase()}
        </div>
        <div style="text-align:right; font-size:7.5pt; color:#555; margin-top:4px;">
          Authorized Corporate Representative & Stamp
        </div>
      </div>
    `;
  },

  compileDocumentHTML(tpl, docData) {
    // ── Universal Rule: Concrete Commercial Entity for ALL Current and Future Printouts ──
    const currentProfile = State.getPrintableBusinessProfile(docData);
    const docType = (tpl.doc_type || 'quotation').toLowerCase();

    if (docType === 'purchase_order') {
      return this.compilePurchaseOrderHTML(tpl, docData, currentProfile);
    }
    if (docType === 'technical_proposal') {
      return this.compileTechnicalProposalHTML(tpl, docData, currentProfile);
    }
    if (docType === 'financial_proposal') {
      return this.compileFinancialProposalHTML(tpl, docData, currentProfile);
    }

    const cust = docData.customer || {};
    const items = docData.items && docData.items.length > 0 ? docData.items : [
      { item_name: docData.tender_name || 'Item Scope', quantity: 1, unit: 'JOB', estimated_unit_price: 0, estimated_total_price: 0 }
    ];

    const isLetterhead = tpl.letterhead_mode === 'letterhead';
    const topMargin = isLetterhead ? (tpl.top_margin_mm || 55) : (tpl.top_margin_mm || 15);
    const bottomMargin = tpl.bottom_margin_mm || 15;
    const accent = tpl.accent_color || '#0f172a';

    // Subtotal and tax calculations
    const subtotal = items.reduce((acc, itm) => acc + (parseFloat(itm.estimated_total_price) || (parseFloat(itm.quantity || 1) * parseFloat(itm.estimated_unit_price || 0))), 0);
    const isExempt = !!docData.is_gst_exempt;
    const isInclusive = !!docData.is_gst_inclusive;
    const gstRate = docData.gst_rate_pct != null ? parseFloat(docData.gst_rate_pct) : 18;

    let gstAmount = 0;
    let grandTotal = subtotal;
    if (isExempt) {
      gstAmount = 0;
      grandTotal = subtotal;
    } else if (isInclusive) {
      gstAmount = (subtotal * gstRate) / (100 + gstRate);
      grandTotal = subtotal;
    } else {
      gstAmount = (subtotal * gstRate) / 100;
      grandTotal = subtotal + gstAmount;
    }

    const cols = typeof tpl.columns_config === 'string' ? JSON.parse(tpl.columns_config || '[]') : (tpl.columns_config || []);
    const visibleCols = cols.filter(c => c.visible !== false);

    // Apply dynamic @page print styles to document
    this.injectPrintPageStyle(tpl.paper_size || 'A4', tpl.paper_orientation || 'portrait', topMargin, bottomMargin);

    const hasTaxInfo = Boolean(currentProfile.ntn || currentProfile.strn);
    const hasContactInfo = Boolean(currentProfile.phone || currentProfile.email);

    return `
      <div class="printable-content-root ${isLetterhead ? 'letterhead-mode-physical' : 'letterhead-mode-digital'}" style="font-family:${tpl.font_family || 'Inter, sans-serif'}; font-size:${tpl.font_size_pt || 9.5}pt; line-height:1.45; color:#0f172a; padding-top:${isLetterhead ? topMargin + 'mm' : '0'};">
        
        <!-- Header Banner / Graphic Letterhead (if uploaded) -->
        ${tpl.letterhead_bg_url && !isLetterhead ? `
          <div style="margin-bottom:16px; text-align:center;">
            <img src="${tpl.letterhead_bg_url}" style="max-width:100%; max-height:120px; object-fit:contain;">
          </div>
        ` : ''}

        <!-- Digital Header (Suppressed in physical letterhead mode) -->
        ${!isLetterhead && tpl.show_company_header !== false ? `
          <div class="lh-digital-header" style="border-bottom:2px solid ${accent}; padding-bottom:14px; margin-bottom:16px; display:flex; justify-content:space-between; align-items:flex-start;">
            <div style="display:flex; gap:14px; align-items:center;">
              ${(currentProfile.logo_url || tpl.logo_url) ? `
                <div style="text-align:${tpl.logo_alignment || 'left'};">
                  <img src="${currentProfile.logo_url || tpl.logo_url}" style="height:${tpl.logo_height_px || 65}px; max-width:180px; object-fit:contain;">
                </div>
              ` : ''}
              <div>
                <div style="font-size:1.35rem; font-weight:800; color:${accent}; letter-spacing:-0.5px;">${currentProfile.business_name || 'MASHRUE ENTERPRISE'}</div>
                <div style="font-size:0.78rem; color:#475569; margin-top:3px; line-height:1.4;">
                  ${hasTaxInfo ? `${currentProfile.ntn ? `<strong>NTN:</strong> ${currentProfile.ntn}` : ''}${currentProfile.ntn && currentProfile.strn ? ' | ' : ''}${currentProfile.strn ? `<strong>STRN:</strong> ${currentProfile.strn}` : ''}<br>` : ''}
                  ${currentProfile.address ? `${currentProfile.address}<br>` : ''}
                  ${hasContactInfo ? `${currentProfile.phone ? `<strong>Tel:</strong> ${currentProfile.phone}` : ''}${currentProfile.phone && currentProfile.email ? ' | ' : ''}${currentProfile.email ? `<strong>Email:</strong> ${currentProfile.email}` : ''}` : ''}
                </div>
              </div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:1.15rem; font-weight:800; color:${accent}; letter-spacing:0.5px;">${(tpl.doc_type || 'quotation').toUpperCase()}</div>
              <div style="font-size:0.9rem; font-weight:800; color:#0f172a; margin-top:2px;"># ${docData.opportunity_number || 'REF-2026-001'}</div>
              <div style="font-size:0.75rem; color:#64748b; margin-top:2px;">Date: <strong>${formatDateDDMMYYYY(docData.opening_date || docData.created_at || new Date())}</strong></div>
              ${docData.quotation_validity_days ? `<div style="font-size:0.75rem; color:${accent}; font-weight:600;">Validity: ${docData.quotation_validity_days} Days</div>` : ''}
            </div>
          </div>
        ` : ''}

        <!-- Client & Metadata Grid -->
        <div style="display:grid; grid-template-columns:1.2fr 1fr; gap:16px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; margin-bottom:16px; font-size:0.8rem;">
          <div>
            <strong style="color:${accent}; text-transform:uppercase; font-size:0.72rem; letter-spacing:0.5px;">Document Prepared For:</strong><br>
            <span style="font-size:0.92rem; font-weight:800; color:#0f172a;">${cust.business_name || cust.name || 'Valued Client'}</span><br>
            ${cust.contact_person ? `<strong>Attn:</strong> ${cust.contact_person}<br>` : ''}
            ${cust.phone ? `<strong>Phone:</strong> ${cust.phone} | ` : ''}${cust.email ? `<strong>Email:</strong> ${cust.email}<br>` : ''}
            ${cust.address ? `<strong>Address:</strong> ${cust.address}` : ''}
          </div>
          <div>
            <strong style="color:${accent}; text-transform:uppercase; font-size:0.72rem; letter-spacing:0.5px;">Reference & Terms:</strong><br>
            <strong>RFQ / Inquiry Ref:</strong> ${docData.rfq_reference || docData.external_tender_number || 'Official Inquiry'}<br>
            <strong>Delivery Lead Time:</strong> ${docData.delivery_lead_time || '3-5 Working Days'}<br>
            <strong>Payment Terms:</strong> ${docData.payment_terms || '30 Days Net'}<br>
            <strong>Paper Format:</strong> ${tpl.paper_size || 'A4'} (${(tpl.paper_orientation || 'portrait').toUpperCase()})
          </div>
        </div>

        <!-- Subject Line -->
        <div style="margin-bottom:12px; font-size:0.9rem;">
          <strong style="color:${accent};">Subject:</strong> <strong>${docData.tender_name || docData.title || 'Commercial Bid / Proposal Scope'}</strong>
        </div>

        <!-- Dynamic Columns Item Table -->
        <table style="width:100%; border-collapse:collapse; margin-bottom:16px; font-size:0.8rem;">
          <thead>
            <tr style="background:${accent}; color:white;">
              ${visibleCols.map(c => `
                <th style="padding:7px 8px; text-align:${c.align || 'left'}; width:${c.width || 'auto'}; border:1px solid rgba(255,255,255,0.15);">
                  ${c.label}
                </th>
              `).join('')}
            </tr>
          </thead>
          <tbody>
            ${items.map((it, idx) => {
              const uPrice = parseFloat(it.estimated_unit_price || 0);
              const lineTot = parseFloat(it.estimated_total_price) || (parseFloat(it.quantity || 1) * uPrice);
              const rowData = {
                sr: idx + 1,
                item_code: it.item_code || ('SKU-' + (idx + 101)),
                item_name: it.item_name || it.item_description || 'Scope Item',
                specs: it.specs || it.specifications || '',
                brand: it.brand_name || it.brand || '',
                quantity: it.quantity || 1,
                unit: it.unit || 'PCS',
                unit_price: formatCurrency(uPrice, 'PKR'),
                tax_rate: (it.tax_rate_pct != null ? it.tax_rate_pct : gstRate) + '%',
                tax_amount: formatCurrency((lineTot * gstRate) / 100, 'PKR'),
                total_price: formatCurrency(lineTot, 'PKR'),
                delivery_time: it.delivery_time || docData.delivery_lead_time || 'Ex-Stock'
              };

              return `
                <tr style="border-bottom:1px solid #e2e8f0;">
                  ${visibleCols.map(c => {
                    let cellVal = rowData[c.key] !== undefined ? rowData[c.key] : '';
                    if (c.key === 'item_name' && rowData.brand) {
                      cellVal = `<strong>${cellVal}</strong><br><span style="font-size:0.72rem; color:#4338ca; font-weight:700;">Make: ${rowData.brand}</span>`;
                    }
                    return `<td style="padding:7px 8px; text-align:${c.align || 'left'}; vertical-align:top; border:1px solid #f1f5f9;">${cellVal}</td>`;
                  }).join('')}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>

        <!-- Calculation Summary -->
        <div style="display:flex; justify-content:flex-end; margin-bottom:18px;">
          <div style="min-width:300px; background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:10px 14px; font-size:0.82rem;">
            <div style="display:flex; justify-content:space-between; margin-bottom:5px; color:#475569;">
              <span>Subtotal:</span>
              <strong style="color:#0f172a;">${formatCurrency(subtotal, 'PKR')}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; margin-bottom:5px; color:#475569;">
              <span>Sales Tax (GST ${isExempt ? 'Exempt' : (isInclusive ? gstRate + '% Incl.' : gstRate + '%')}):</span>
              <strong style="color:#0f172a;">${formatCurrency(gstAmount, 'PKR')}</strong>
            </div>
            <div style="display:flex; justify-content:space-between; padding-top:6px; border-top:2px solid ${accent}; font-size:0.95rem;">
              <strong style="color:#0f172a;">Grand Total:</strong>
              <strong style="color:${accent};">${formatCurrency(grandTotal, 'PKR')}</strong>
            </div>
          </div>
        </div>

        <!-- Custom Terms & Conditions -->
        ${tpl.custom_terms ? `
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 14px; margin-bottom:24px; font-size:0.75rem; color:#475569; line-height:1.5;">
            <strong style="color:${accent}; text-transform:uppercase; font-size:0.72rem;">Terms & Conditions of Sale:</strong>
            <div style="margin-top:4px; white-space:pre-line;">${tpl.custom_terms}</div>
          </div>
        ` : ''}

        <!-- Signature Blocks -->
        ${tpl.show_signature_blocks !== false ? `
          <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-top:35px; padding:0 20px;">
            <div style="text-align:center; width:220px;">
              <div style="border-bottom:1px dashed #94a3b8; height:45px;"></div>
              <div style="margin-top:5px; font-size:0.75rem; font-weight:700; color:#0f172a;">${tpl.signature_title_left || 'Customer Acceptance & Stamp'}</div>
              <div style="font-size:0.7rem; color:#64748b;">Sign & Return with Official PO</div>
            </div>
            <div style="text-align:center; width:220px;">
              <div style="border-bottom:1px dashed #94a3b8; height:45px;"></div>
              <div style="margin-top:5px; font-size:0.75rem; font-weight:700; color:#0f172a;">${tpl.signature_title_right || 'Authorized Signatory'}</div>
              <div style="font-size:0.7rem; color:#64748b;">For ${currentProfile.business_name || 'Mashrue Enterprise'}</div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  },

  injectPrintPageStyle(paperSize = 'A4', orientation = 'portrait', topMm = 15, bottomMm = 15) {
    let style = document.getElementById('dynamic-print-page-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'dynamic-print-page-style';
      document.head.appendChild(style);
    }
    style.innerHTML = `
      @page {
        size: ${paperSize} ${orientation};
        margin: ${topMm}mm 12mm ${bottomMm}mm 12mm;
      }
    `;
  },

  // --------------------------------------------------------------------------
  // 8. TEMPLATE MODAL EDITOR (Full Visual Designer Mode 1)
  // --------------------------------------------------------------------------
  openTemplateEditorModal(tplToEdit = null) {
    const isNew = !tplToEdit || !tplToEdit.id;
    const tpl = tplToEdit || {
      template_name: 'New Custom Template',
      doc_type: 'quotation',
      module: 'tender',
      category: 'Commercial',
      status: 'published',
      is_default: false,
      paper_size: 'A4',
      paper_orientation: 'portrait',
      letterhead_mode: 'digital',
      top_margin_mm: 15,
      bottom_margin_mm: 15,
      left_margin_mm: 15,
      right_margin_mm: 15,
      accent_color: '#0284c7',
      font_family: 'Inter, sans-serif',
      columns_config: [
        { key: "sr", label: "#", visible: true, width: "5%", align: "center" },
        { key: "item_name", label: "Item Description & Specifications", visible: true, width: "42%", align: "left" },
        { key: "brand", label: "Brand / Make", visible: true, width: "12%", align: "left" },
        { key: "quantity", label: "Qty", visible: true, width: "8%", align: "center" },
        { key: "unit", label: "Unit", visible: true, width: "7%", align: "center" },
        { key: "unit_price", label: "Unit Price (PKR)", visible: true, width: "13%", align: "right" },
        { key: "total_price", label: "Total Amount (PKR)", visible: true, width: "13%", align: "right" }
      ],
      custom_terms: `1. Validity: 30 days from date of issue.\n2. Delivery: 3-5 working days upon PO.\n3. Payment: 30 Days Net.`
    };

    const modalHtml = `
      <div class="modal-backdrop" id="modal-template-editor" style="display:flex;">
        <div class="modal-card modal-lg" style="max-width:920px; max-height:92vh; display:flex; flex-direction:column;">
          <div class="modal-header" style="background:#0f172a; color:white;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span>🖨️</span>
              <h3 style="font-size:1.15rem; font-weight:800; color:white; margin:0;">${isNew ? 'Create Document Template' : 'Edit Template: ' + tpl.template_name + ' (v' + (tpl.version || 1) + ')'}</h3>
            </div>
            <button class="modal-close-btn" style="color:white;" onclick="closeModal('modal-template-editor')">&times;</button>
          </div>
          <div class="modal-body" style="overflow-y:auto; padding:20px;">
            <form id="template-editor-form" onsubmit="event.preventDefault(); TemplatesEngine.submitTemplateEditor('${tpl.id || ''}')">
              
              <!-- Basic Metadata -->
              <div style="display:grid; grid-template-columns:1.8fr 1fr 1fr; gap:14px; margin-bottom:14px;">
                <div>
                  <label class="form-label">Template Name</label>
                  <input type="text" id="tpl-edit-name" class="form-input" required value="${tpl.template_name}">
                </div>
                <div>
                  <label class="form-label">Associated Module</label>
                  <select id="tpl-edit-module" class="form-select">
                    <option value="tender" ${(tpl.module || 'tender') === 'tender' ? 'selected' : ''}>Tender & Bidding</option>
                    <option value="finance" ${tpl.module === 'finance' ? 'selected' : ''}>Finance & Invoicing</option>
                    <option value="inventory" ${tpl.module === 'inventory' ? 'selected' : ''}>Inventory & Logistics</option>
                    <option value="crm" ${tpl.module === 'crm' ? 'selected' : ''}>CRM & Deals</option>
                    <option value="manufacturing" ${tpl.module === 'manufacturing' ? 'selected' : ''}>Manufacturing</option>
                    <option value="hrm" ${tpl.module === 'hrm' ? 'selected' : ''}>HRM</option>
                    <option value="payroll" ${tpl.module === 'payroll' ? 'selected' : ''}>Payroll</option>
                  </select>
                </div>
                <div>
                  <label class="form-label">Document Type</label>
                  <select id="tpl-edit-doc-type" class="form-select">
                    <option value="quotation" ${tpl.doc_type === 'quotation' ? 'selected' : ''}>Commercial Quotation</option>
                    <option value="tender" ${tpl.doc_type === 'tender' ? 'selected' : ''}>PPRA Tender BoQ Dossier</option>
                    <option value="purchase_order" ${tpl.doc_type === 'purchase_order' ? 'selected' : ''}>Purchase Order (PO)</option>
                    <option value="delivery_challan" ${tpl.doc_type === 'delivery_challan' ? 'selected' : ''}>Delivery Challan (DC)</option>
                    <option value="invoice" ${tpl.doc_type === 'invoice' ? 'selected' : ''}>Tax Invoice</option>
                    <option value="stock_transfer" ${tpl.doc_type === 'stock_transfer' ? 'selected' : ''}>Stock Transfer Note</option>
                    <option value="payslip" ${tpl.doc_type === 'payslip' ? 'selected' : ''}>Employee Payslip</option>
                    <option value="appointment_letter" ${tpl.doc_type === 'appointment_letter' ? 'selected' : ''}>Appointment Letter</option>
                    <option value="work_order" ${tpl.doc_type === 'work_order' ? 'selected' : ''}>Production Job Card</option>
                  </select>
                </div>
              </div>

              <!-- Paper & Styling Configuration -->
              <div style="display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:12px; margin-bottom:14px;">
                <div>
                  <label class="form-label">Paper Format</label>
                  <select id="tpl-edit-paper-size" class="form-select">
                    <option value="A4" ${tpl.paper_size === 'A4' ? 'selected' : ''}>A4 (210 × 297 mm)</option>
                    <option value="Letter" ${tpl.paper_size === 'Letter' ? 'selected' : ''}>Letter (8.5 × 11 in)</option>
                    <option value="Legal" ${tpl.paper_size === 'Legal' ? 'selected' : ''}>Legal (8.5 × 14 in)</option>
                  </select>
                </div>
                <div>
                  <label class="form-label">Orientation</label>
                  <select id="tpl-edit-orientation" class="form-select">
                    <option value="portrait" ${tpl.paper_orientation === 'portrait' ? 'selected' : ''}>Portrait</option>
                    <option value="landscape" ${tpl.paper_orientation === 'landscape' ? 'selected' : ''}>Landscape</option>
                  </select>
                </div>
                <div>
                  <label class="form-label">Publication Status</label>
                  <select id="tpl-edit-status" class="form-select">
                    <option value="published" ${(tpl.status || 'published') === 'published' ? 'selected' : ''}>Published (Active)</option>
                    <option value="draft" ${tpl.status === 'draft' ? 'selected' : ''}>Draft</option>
                  </select>
                </div>
                <div>
                  <label class="form-label">Brand Accent Color</label>
                  <input type="color" id="tpl-edit-color" class="form-input" style="height:38px; padding:2px 4px;" value="${tpl.accent_color || '#0284c7'}">
                </div>
              </div>

              <!-- Letterhead & Margin Offsets -->
              <div style="background:#f8fafc; padding:14px; border-radius:8px; border:1px solid #e2e8f0; margin-bottom:14px;">
                <div style="display:grid; grid-template-columns:1.5fr 1fr 1fr 1fr 1fr; gap:10px; align-items:center;">
                  <div>
                    <label class="form-label">Letterhead Mode</label>
                    <select id="tpl-edit-lh-mode" class="form-select">
                      <option value="digital" ${tpl.letterhead_mode === 'digital' ? 'selected' : ''}>Digital Letterhead (Full Logo)</option>
                      <option value="letterhead" ${tpl.letterhead_mode === 'letterhead' ? 'selected' : ''}>Pre-Printed Stationery</option>
                    </select>
                  </div>
                  <div>
                    <label class="form-label">Top Margin (mm)</label>
                    <input type="number" id="tpl-edit-top-margin" class="form-input" min="5" max="100" value="${tpl.top_margin_mm || 15}">
                  </div>
                  <div>
                    <label class="form-label">Bottom (mm)</label>
                    <input type="number" id="tpl-edit-bottom-margin" class="form-input" min="5" max="100" value="${tpl.bottom_margin_mm || 15}">
                  </div>
                  <div>
                    <label class="form-label">Left (mm)</label>
                    <input type="number" id="tpl-edit-left-margin" class="form-input" min="5" max="50" value="${tpl.left_margin_mm || 15}">
                  </div>
                  <div>
                    <label class="form-label">Right (mm)</label>
                    <input type="number" id="tpl-edit-right-margin" class="form-input" min="5" max="50" value="${tpl.right_margin_mm || 15}">
                  </div>
                </div>
              </div>

              <!-- Dynamic Field Token Picker Toolbar -->
              <div style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
                <label class="form-label" style="margin:0;">Standard Terms & Dynamic Field Bindings</label>
                <div style="font-size:0.75rem; color:#64748b;">Click any token below to insert it dynamically:</div>
              </div>

              <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:6px; padding:8px 12px; margin-bottom:12px; display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
                <span style="font-size:0.75rem; font-weight:700; color:#1e40af;">Common Tokens:</span>
                <button type="button" class="badge" style="background:#ffffff; border:1px solid #93c5fd; color:#1d4ed8; cursor:pointer;" onclick="TemplatesEngine.insertDynamicToken('{{company_name}}')">{{company_name}}</button>
                <button type="button" class="badge" style="background:#ffffff; border:1px solid #93c5fd; color:#1d4ed8; cursor:pointer;" onclick="TemplatesEngine.insertDynamicToken('{{customer_name}}')">{{customer_name}}</button>
                <button type="button" class="badge" style="background:#ffffff; border:1px solid #93c5fd; color:#1d4ed8; cursor:pointer;" onclick="TemplatesEngine.insertDynamicToken('{{doc_date}}')">{{doc_date}}</button>
                <button type="button" class="badge" style="background:#ffffff; border:1px solid #93c5fd; color:#1d4ed8; cursor:pointer;" onclick="TemplatesEngine.insertDynamicToken('{{total_amount}}')">{{total_amount}}</button>
                <button type="button" class="badge" style="background:#ffffff; border:1px solid #93c5fd; color:#1d4ed8; cursor:pointer;" onclick="TemplatesEngine.insertDynamicToken('{{amount_in_words}}')">{{amount_in_words}}</button>
                <button type="button" class="badge" style="background:#ffffff; border:1px solid #93c5fd; color:#1d4ed8; cursor:pointer;" onclick="TemplatesEngine.insertDynamicToken('{{payment_terms}}')">{{payment_terms}}</button>
              </div>

              <div class="form-group" style="margin-bottom:14px;">
                <textarea id="tpl-edit-terms" class="form-textarea" rows="4">${tpl.custom_terms || ''}</textarea>
              </div>

              ${!isNew ? `
                <div class="form-group" style="margin-bottom:14px;">
                  <label class="form-label">Version Change Summary (Audit Trail)</label>
                  <input type="text" id="tpl-edit-change-summary" class="form-input" placeholder="e.g. Updated standard payment terms to 30 days net">
                </div>
              ` : ''}

              <!-- Footer Controls -->
              <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid #e2e8f0; margin-top:16px; padding-top:14px;">
                <label style="display:flex; align-items:center; gap:6px; font-size:0.85rem; cursor:pointer;">
                  <input type="checkbox" id="tpl-edit-is-default" ${tpl.is_default ? 'checked' : ''}>
                  <strong>Set as Default Template for this Document Type</strong>
                </label>
                <div style="display:flex; gap:10px;">
                  <button type="button" class="secondary-btn" onclick="closeModal('modal-template-editor')">Cancel</button>
                  <button type="submit" class="primary-btn" style="background:#0284c7; padding:8px 24px;">Save Template</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;

    let existing = document.getElementById('modal-template-editor');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    if (typeof openModal === 'function') {
      openModal('modal-template-editor');
    } else {
      const el = document.getElementById('modal-template-editor');
      if (el) el.classList.add('open');
    }
  },

  insertDynamicToken(token) {
    const el = document.getElementById('tpl-edit-terms');
    if (!el) return;
    const start = el.selectionStart || el.value.length;
    const end = el.selectionEnd || el.value.length;
    el.value = el.value.substring(0, start) + ' ' + token + ' ' + el.value.substring(end);
    el.focus();
  },

  async submitTemplateEditor(templateId) {
    const payload = {
      template_name: document.getElementById('tpl-edit-name')?.value,
      doc_type: document.getElementById('tpl-edit-doc-type')?.value,
      module: document.getElementById('tpl-edit-module')?.value,
      paper_size: document.getElementById('tpl-edit-paper-size')?.value,
      paper_orientation: document.getElementById('tpl-edit-orientation')?.value,
      status: document.getElementById('tpl-edit-status')?.value || 'published',
      accent_color: document.getElementById('tpl-edit-color')?.value,
      letterhead_mode: document.getElementById('tpl-edit-lh-mode')?.value,
      top_margin_mm: parseInt(document.getElementById('tpl-edit-top-margin')?.value || 15, 10),
      bottom_margin_mm: parseInt(document.getElementById('tpl-edit-bottom-margin')?.value || 15, 10),
      left_margin_mm: parseInt(document.getElementById('tpl-edit-left-margin')?.value || 15, 10),
      right_margin_mm: parseInt(document.getElementById('tpl-edit-right-margin')?.value || 15, 10),
      custom_terms: document.getElementById('tpl-edit-terms')?.value,
      change_summary: document.getElementById('tpl-edit-change-summary')?.value || 'Updated template configuration',
      is_default: !!document.getElementById('tpl-edit-is-default')?.checked
    };

    let targetTenantId = State.currentUser?.tenant?.id || State.currentUser?.tenant_id;
    if (typeof State.isSuperAdmin === 'function' && State.isSuperAdmin()) {
      const activeProfile = typeof State.getCurrentBusinessProfile === 'function' ? State.getCurrentBusinessProfile() : null;
      if (activeProfile && activeProfile.tenant_id) {
        targetTenantId = activeProfile.tenant_id;
      }
    }
    if (targetTenantId) payload.tenant_id = targetTenantId;

    const isRealUuid = (id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ''));

    try {
      let res;
      if (templateId && isRealUuid(templateId)) {
        res = await API.updateTemplate(templateId, payload);
      } else {
        res = await API.createTemplate(payload);
      }
      if (res && res.success) {
        showToast('✓ Template saved successfully!', 'success');
        closeModal('modal-template-editor');
        await this.loadTemplates();
        this.refreshGrid();
      } else {
        alert(res?.message || 'Error saving template');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  async duplicateTemplate(id) {
    try {
      const res = await API.duplicateTemplate(id);
      if (res && res.success) {
        showToast('✓ Template cloned as Draft!', 'success');
        await this.loadTemplates();
        this.refreshGrid();
      } else {
        showToast(res?.message || 'Failed to duplicate template', 'error');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  async archiveTemplate(id) {
    if (!confirm('Archive this template? It will be hidden from default printing menus.')) return;
    try {
      const res = await API.archiveTemplate(id);
      if (res && res.success) {
        showToast('✓ Template archived', 'success');
        await this.loadTemplates();
        this.refreshGrid();
      } else {
        showToast(res?.message || 'Failed to archive', 'error');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  async restoreTemplate(id) {
    try {
      const res = await API.restoreTemplate(id);
      if (res && res.success) {
        showToast('✓ Template restored to Published', 'success');
        await this.loadTemplates();
        this.refreshGrid();
      } else {
        showToast(res?.message || 'Failed to restore', 'error');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  async viewVersionHistory(id) {
    try {
      const tpl = this.templates.find(t => t.id === id);
      const versions = await API.getTemplateVersions(id);

      const rowsHtml = (!versions || versions.length === 0)
        ? `<tr><td colspan="5" style="text-align:center; padding:20px; color:#64748b;">No previous versions recorded yet.</td></tr>`
        : versions.map(v => `
          <tr style="border-bottom:1px solid #f1f5f9;">
            <td style="padding:10px 14px; font-weight:700; color:#0f172a;">v${v.version_number}</td>
            <td style="padding:10px 14px; color:#475569;">${v.change_summary || 'Configuration change'}</td>
            <td style="padding:10px 14px; color:#64748b; font-size:0.8rem;">${v.author_name || 'System / Admin'}</td>
            <td style="padding:10px 14px; color:#64748b; font-size:0.8rem;">${new Date(v.created_at).toLocaleString()}</td>
            <td style="padding:10px 14px; text-align:right;">
              ${v.version_number !== (tpl?.version || 1) ? `
                <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem; color:#6d28d9;" onclick="TemplatesEngine.rollbackToVersion('${id}', ${v.version_number})">
                  ↺ Rollback
                </button>
              ` : `<span class="badge" style="background:#dcfce7; color:#15803d; font-size:0.7rem;">Active</span>`}
            </td>
          </tr>
        `).join('');

      const modalHtml = `
        <div class="modal-backdrop" id="modal-template-versions" style="display:flex;">
          <div class="modal-card modal-lg" style="max-width:800px; max-height:85vh; display:flex; flex-direction:column;">
            <div class="modal-header" style="background:#0f172a; color:white;">
              <h3 style="font-size:1.1rem; font-weight:800; color:white; margin:0;">Version History: ${tpl?.template_name || 'Template'}</h3>
              <button class="modal-close-btn" style="color:white;" onclick="closeModal('modal-template-versions')">&times;</button>
            </div>
            <div class="modal-body" style="padding:20px; overflow-y:auto;">
              <table class="data-table" style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                <thead>
                  <tr style="background:#f8fafc; border-bottom:1px solid #e2e8f0; text-align:left; color:#475569;">
                    <th style="padding:10px 14px;">Version</th>
                    <th style="padding:10px 14px;">Change Summary</th>
                    <th style="padding:10px 14px;">Author</th>
                    <th style="padding:10px 14px;">Timestamp</th>
                    <th style="padding:10px 14px; text-align:right;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;

      let existing = document.getElementById('modal-template-versions');
      if (existing) existing.remove();
      document.body.insertAdjacentHTML('beforeend', modalHtml);
      if (typeof openModal === 'function') openModal('modal-template-versions');
    } catch (e) {
      showToast('Error loading version history: ' + e.message, 'error');
    }
  },

  async rollbackToVersion(id, versionNum) {
    if (!confirm(`Are you sure you want to rollback this template to Version ${versionNum}?`)) return;
    try {
      const res = await API.rollbackTemplateVersion(id, versionNum);
      if (res && res.success) {
        showToast(`✓ Rolled back to v${versionNum}!`, 'success');
        closeModal('modal-template-versions');
        await this.loadTemplates();
        this.refreshGrid();
      } else {
        showToast(res?.message || 'Rollback failed', 'error');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  async exportTemplateJson(id) {
    try {
      const data = await API.exportTemplate(id);
      if (!data) return showToast('Failed to export template', 'error');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(data.template?.template_name || 'template').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('✓ Template exported as JSON', 'success');
    } catch (e) {
      showToast('Export error: ' + e.message, 'error');
    }
  },

  openImportModal() {
    const modalHtml = `
      <div class="modal-backdrop" id="modal-template-import" style="display:flex;">
        <div class="modal-card" style="max-width:600px; display:flex; flex-direction:column;">
          <div class="modal-header" style="background:#0f172a; color:white;">
            <h3 style="font-size:1.1rem; font-weight:800; color:white; margin:0;">📥 Import Template (JSON)</h3>
            <button class="modal-close-btn" style="color:white;" onclick="closeModal('modal-template-import')">&times;</button>
          </div>
          <div class="modal-body" style="padding:20px;">
            <p style="font-size:0.85rem; color:#64748b; margin-bottom:14px;">
              Select a previously exported template JSON file, or paste the template configuration definition below.
            </p>
            <div style="margin-bottom:14px;">
              <input type="file" id="tpl-import-file" class="form-input" accept=".json" onchange="TemplatesEngine.handleImportFileSelect(event)">
            </div>
            <div class="form-group" style="margin-bottom:14px;">
              <label class="form-label">Or Paste JSON Content</label>
              <textarea id="tpl-import-json-text" class="form-textarea" rows="6" placeholder='{"template": {"template_name": "..."}}'></textarea>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px;">
              <button class="secondary-btn" onclick="closeModal('modal-template-import')">Cancel</button>
              <button class="primary-btn" style="background:#0284c7;" onclick="TemplatesEngine.submitImportTemplate()">Import Template</button>
            </div>
          </div>
        </div>
      </div>
    `;
    let existing = document.getElementById('modal-template-import');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    if (typeof openModal === 'function') openModal('modal-template-import');
  },

  handleImportFileSelect(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const area = document.getElementById('tpl-import-json-text');
      if (area) area.value = e.target.result;
    };
    reader.readAsText(file);
  },

  async submitImportTemplate() {
    const text = document.getElementById('tpl-import-json-text')?.value;
    if (!text || !text.trim()) return showToast('Please select a JSON file or paste content', 'warning');
    try {
      const parsed = JSON.parse(text);
      const payload = parsed.template || parsed;
      const res = await API.importTemplate(payload);
      if (res && res.success) {
        showToast('✓ Template imported successfully as Draft!', 'success');
        closeModal('modal-template-import');
        await this.loadTemplates();
        this.refreshGrid();
      } else {
        alert(res?.message || 'Error importing template');
      }
    } catch (e) {
      showToast('Invalid JSON file format: ' + e.message, 'error');
    }
  },

  // Token Validation & Missing-Field Warnings
  validateTemplateTokens(text = '') {
    const tokenRegex = /\{\{([a-zA-Z0-9_]+)\}\}/g;
    const foundTokens = [];
    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
      foundTokens.push(match[0]);
    }

    const KNOWN_GLOBAL_TOKENS = [
      '{{company_name}}', '{{company_ntn}}', '{{company_strn}}', '{{company_address}}', '{{company_phone}}', '{{company_email}}',
      '{{customer_name}}', '{{customer_ntn}}', '{{customer_address}}', '{{doc_date}}', '{{quote_number}}', '{{quote_date}}',
      '{{validity_date}}', '{{payment_terms}}', '{{subtotal_amount}}', '{{sales_tax_amount}}', '{{total_amount}}', '{{amount_in_words}}',
      '{{tender_title}}', '{{tender_ref_no}}', '{{procuring_agency}}', '{{bid_opening_date}}', '{{bid_validity}}',
      '{{dc_number}}', '{{dispatch_date}}', '{{transporter_name}}', '{{vehicle_number}}',
      '{{invoice_number}}', '{{fbr_invoice_number}}', '{{taxable_amount}}', '{{sales_tax_rate}}', '{{net_payable}}',
      '{{payroll_month}}', '{{employee_id}}', '{{employee_name}}', '{{gross_salary}}', '{{net_salary}}'
    ];

    const unmapped = foundTokens.filter(t => !KNOWN_GLOBAL_TOKENS.includes(t));
    return {
      totalFound: foundTokens.length,
      unmappedTokens: Array.from(new Set(unmapped))
    };
  },

  async editTemplate(id) {
    const tpl = this.templates.find(t => t.id === id);
    if (tpl) this.openTemplateEditorModal(tpl);
  },

  async previewTemplate(id) {
    const tpl = this.templates.find(t => t.id === id);
    if (!tpl) return;
    const html = this.compilePreviewHTML(tpl);

    // Validate tokens in terms and html
    const tokenCheck = this.validateTemplateTokens((tpl.custom_terms || '') + ' ' + (tpl.custom_header_html || ''));
    const hasUnmapped = tokenCheck.unmappedTokens.length > 0;

    const modalHtml = `
      <div class="modal-backdrop" id="modal-template-preview-full" style="display:flex;">
        <div class="modal-card modal-lg" style="max-width:920px; max-height:94vh; display:flex; flex-direction:column;">
          <div class="modal-header" style="background:#0f172a; color:white; display:flex; justify-content:space-between; align-items:center;">
            <div>
              <h3 style="font-size:1.1rem; font-weight:800; color:white; margin:0 0 2px 0;">Template Preview: ${tpl.template_name} (v${tpl.version || 1})</h3>
              <div style="font-size:0.75rem; color:#94a3b8;">Format: ${tpl.paper_size || 'A4'} • ${(tpl.paper_orientation || 'portrait').toUpperCase()} • Module: ${(tpl.module || 'tender').toUpperCase()}</div>
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
              <button class="primary-btn" style="padding:6px 14px; font-size:0.8rem; background:#0284c7;" onclick="TemplatesEngine.openPrintWindow('${tpl.template_name.replace(/'/g, "\\'")}', document.getElementById('tpl-preview-rendered-doc').innerHTML)">
                🖨️ Print / Save PDF
              </button>
              <button class="modal-close-btn" style="color:white;" onclick="closeModal('modal-template-preview-full')">&times;</button>
            </div>
          </div>

          ${hasUnmapped ? `
            <div style="background:#fef3c7; border-bottom:1px solid #fde68a; padding:10px 18px; display:flex; align-items:center; gap:8px; font-size:0.82rem; color:#92400e;">
              <span style="font-size:1rem;">⚠️</span>
              <div>
                <strong>Missing Field / Unmapped Token Warning:</strong> The following tokens in your template are not mapped to known database fields: 
                <code>${tokenCheck.unmappedTokens.join(', ')}</code>. They may appear verbatim when generating official documents.
              </div>
            </div>
          ` : ''}

          <div class="modal-body" style="background:#64748b; padding:24px; overflow-y:auto;">
            <div id="tpl-preview-rendered-doc" style="background:white; padding:35px; border-radius:4px; box-shadow:0 10px 25px rgba(0,0,0,0.3); max-width:800px; margin:0 auto; position:relative;">
              ${html}

              <!-- Document Generation Metadata Watermark & Audit Stamp -->
              <div style="margin-top:35px; pt-3; border-top:1px dashed #cbd5e1; padding-top:10px; display:flex; justify-content:space-between; align-items:center; font-size:0.7rem; color:#94a3b8;">
                <span>🔒 Official Mashrue Document Engine • Template: ${tpl.template_name} (Rev ${tpl.version || 1})</span>
                <span>Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    let existing = document.getElementById('modal-template-preview-full');
    if (existing) existing.remove();
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    if (typeof openModal === 'function') {
      openModal('modal-template-preview-full');
    } else {
      const el = document.getElementById('modal-template-preview-full');
      if (el) el.classList.add('open');
    }
  },

  async setDefaultTemplate(id) {
    try {
      const res = await API.setDefaultTemplate(id);
      if (res && res.success) {
        showToast('✓ Set as default template!', 'success');
        await this.loadTemplates();
        switchView('templates');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  async deleteTemplate(id, name) {
    if (!confirm(`Are you sure you want to delete template "${name}"?`)) return;
    try {
      const res = await API.deleteTemplate(id);
      if (res && res.success) {
        showToast('✓ Template deleted', 'success');
        await this.loadTemplates();
        switchView('templates');
      }
    } catch (e) {
      showToast('Error: ' + e.message, 'error');
    }
  },

  // ============================================================================
  // PHASE 4: CROSS-MODULE UNIVERSAL PRINT ENGINE (STN, JV, PAYSLIP, JOB CARD, WHT)
  // ============================================================================
  openPrintWindow(title, bodyHtml) {
    const bp = (typeof State !== 'undefined' && State.businessProfiles && State.businessProfiles.find(b => b.id === State.currentBusinessProfileId)) || (typeof State !== 'undefined' && State.businessProfiles && State.businessProfiles[0]) || {};
    const companyName = bp.business_name || bp.legal_name || 'Mashrue Enterprise BMS';
    const companyMeta = [bp.address, bp.phone ? `Tel: ${bp.phone}` : '', bp.ntn ? `NTN: ${bp.ntn}` : '', bp.strn ? `STRN: ${bp.strn}` : ''].filter(Boolean).join(' | ');

    const w = window.open('', '_blank', 'width=920,height=780');
    if (!w) {
      if (typeof showToast === 'function') showToast('Please allow pop-ups to print documents.', 'warning');
      return;
    }
    w.document.write(`<!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <title>${title} - ${companyName}</title>
        <style>
          body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; margin: 28px; font-size: 13px; }
          .hdr { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #0f172a; padding-bottom: 14px; margin-bottom: 18px; }
          .hdr h1 { margin: 0 0 4px 0; font-size: 20px; color: #0f172a; }
          .hdr .meta { font-size: 11px; color: #475569; }
          .doc-badge { background: #0f172a; color: #fff; padding: 6px 14px; border-radius: 6px; font-weight: 800; font-size: 14px; text-transform: uppercase; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th { background: #f1f5f9; color: #1e293b; text-align: left; padding: 8px 10px; border: 1px solid #cbd5e1; font-size: 12px; }
          td { padding: 8px 10px; border: 1px solid #cbd5e1; font-size: 12px; }
          .sig-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 36px; margin-top: 48px; text-align: center; }
          .sig-box { border-top: 1px solid #334155; padding-top: 6px; font-size: 11px; font-weight: 700; color: #475569; }
          @media print { .no-print { display: none !important; } body { margin: 12mm; } }
        </style>
      </head>
      <body>
        <div class="no-print" style="margin-bottom:14px; text-align:right;">
          <button onclick="window.print()" style="background:#2563eb;color:#fff;border:none;padding:8px 16px;border-radius:6px;font-weight:700;cursor:pointer;">🖨️ Print / Save PDF</button>
        </div>
        <div class="hdr">
          <div>
            <h1>${companyName}</h1>
            <div class="meta">${companyMeta}</div>
          </div>
          <div class="doc-badge">${title}</div>
        </div>
        ${bodyHtml}
      </body>
      </html>`);
    w.document.close();
  },

  printStockTransferNote(trf) {
    const items = Array.isArray(trf.items) ? trf.items : [];
    const rows = items.map((it, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${it.item_name || ''}</strong><br/><small>${it.sku || ''}</small></td>
        <td>${it.batch_number || 'LOT-PRIMARY'}</td>
        <td style="text-align:right;font-weight:700;">${parseFloat(it.quantity || 0).toLocaleString()}</td>
        <td style="text-align:right;">PKR ${parseFloat(it.unit_cost || 0).toLocaleString()}</td>
      </tr>
    `).join('');
    this.openPrintWindow('Stock Transfer Note', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <div><strong>Transfer No:</strong> ${trf.transfer_number || ''}<br/><strong>Source Warehouse:</strong> ${trf.from_warehouse_name || ''}</div>
        <div><strong>Date:</strong> ${(trf.transfer_date || '').slice(0, 10)}<br/><strong>Destination Warehouse:</strong> ${trf.to_warehouse_name || ''}<br/><strong>Driver / Vehicle:</strong> ${trf.driver_name || '-'} / ${trf.vehicle_number || '-'}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Item Description</th><th>Batch</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Unit Cost</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="sig-grid">
        <div class="sig-box">Issued By (Source Store)</div>
        <div class="sig-box">Driver / Carrier Signature</div>
        <div class="sig-box">Received By (Destination Store)</div>
      </div>
    `);
  },

  printJournalVoucher(jv) {
    const lines = Array.isArray(jv.lines) ? jv.lines : [];
    const rows = lines.map((l, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${l.account_code || ''} - ${l.account_name || ''}</strong></td>
        <td>${l.line_description || ''}</td>
        <td style="text-align:right;">${parseFloat(l.debit || 0) > 0 ? 'PKR ' + parseFloat(l.debit).toLocaleString() : '-'}</td>
        <td style="text-align:right;">${parseFloat(l.credit || 0) > 0 ? 'PKR ' + parseFloat(l.credit).toLocaleString() : '-'}</td>
      </tr>
    `).join('');
    this.openPrintWindow('Journal Voucher (JV)', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <div><strong>Voucher No:</strong> ${jv.entry_number || ''}<br/><strong>Reference Type:</strong> ${jv.reference_type || 'Manual Voucher'}</div>
        <div><strong>Date:</strong> ${(jv.entry_date || '').slice(0, 10)}<br/><strong>Narration:</strong> ${jv.narration || ''}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>GL Account</th><th>Line Description</th><th style="text-align:right;">Debit (PKR)</th><th style="text-align:right;">Credit (PKR)</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="font-weight:800;background:#f1f5f9;">
            <td colspan="3" style="text-align:right;">TOTAL BALANCED AMOUNT:</td>
            <td style="text-align:right;">PKR ${parseFloat(jv.total_debit || 0).toLocaleString()}</td>
            <td style="text-align:right;">PKR ${parseFloat(jv.total_credit || 0).toLocaleString()}</td>
          </tr>
        </tfoot>
      </table>
      <div class="sig-grid">
        <div class="sig-box">Prepared By (Accountant)</div>
        <div class="sig-box">Checked By (Finance Manager)</div>
        <div class="sig-box">Approved By (Director / CFO)</div>
      </div>
    `);
  },

  printPayslip(slip, periodLabel) {
    this.openPrintWindow('Employee Salary Slip', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <div><strong>Employee:</strong> ${slip.first_name || ''} ${slip.last_name || ''} (${slip.employee_code || ''})<br/><strong>CNIC:</strong> ${slip.cnic || '-'}<br/><strong>Designation:</strong> ${slip.designation_name || '-'}</div>
        <div><strong>Payroll Period:</strong> ${periodLabel || ''}<br/><strong>Bank / IBAN:</strong> ${slip.bank_name || 'Bank Transfer'} ${slip.bank_iban ? '(' + slip.bank_iban + ')' : ''}<br/><strong>Status:</strong> ${slip.is_paid ? 'PAID' : 'APPROVED'}</div>
      </div>
      <table>
        <thead><tr><th>Earnings Breakdown</th><th style="text-align:right;">Amount (PKR)</th><th>Statutory & Deductions</th><th style="text-align:right;">Amount (PKR)</th></tr></thead>
        <tbody>
          <tr>
            <td>Basic Salary</td><td style="text-align:right;">${parseFloat(slip.basic_salary || 0).toLocaleString()}</td>
            <td>FBR Section 149 Income Tax</td><td style="text-align:right;">${parseFloat(slip.income_tax_deduction || 0).toLocaleString()}</td>
          </tr>
          <tr>
            <td>Allowances (HRA, Medical, Conveyance)</td><td style="text-align:right;">${parseFloat(slip.total_allowances || 0).toLocaleString()}</td>
            <td>EOBI Employee Contribution</td><td style="text-align:right;">${parseFloat(slip.eobi_employee_deduction || 0).toLocaleString()}</td>
          </tr>
          <tr>
            <td></td><td></td>
            <td>Unpaid Leave / Loan Adjustment</td><td style="text-align:right;">${(parseFloat(slip.unpaid_leave_deduction || 0) + parseFloat(slip.loan_deduction || 0)).toLocaleString()}</td>
          </tr>
          <tr style="font-weight:800;background:#f1f5f9;">
            <td>GROSS SALARY</td><td style="text-align:right;">PKR ${parseFloat(slip.gross_salary || 0).toLocaleString()}</td>
            <td>TOTAL DEDUCTIONS</td><td style="text-align:right;">PKR ${parseFloat(slip.total_deductions || 0).toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      <div style="margin-top:16px;padding:14px;background:#ecfdf5;border:2px solid #059669;border-radius:6px;display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:800;font-size:15px;color:#065f46;">NET TAKE-HOME SALARY PAYABLE:</span>
        <span style="font-weight:900;font-size:18px;color:#047857;">PKR ${parseFloat(slip.net_salary || 0).toLocaleString()}</span>
      </div>
      <div class="sig-grid">
        <div class="sig-box">HR & Payroll Department</div>
        <div class="sig-box">Finance Authorization</div>
        <div class="sig-box">Employee Signature</div>
      </div>
    `);
  },

  printWorkOrderJobCard(wo) {
    this.openPrintWindow('Production Job Card / Work Order', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;background:#f8fafc;padding:12px;border:1px solid #cbd5e1;border-radius:6px;">
        <div><strong>Work Order No:</strong> ${wo.order_number || ''}<br/><strong>BOM Recipe:</strong> ${wo.bom_code || ''}<br/><strong>Target Finished Product:</strong> ${wo.product_name || ''} (${wo.sku || ''})</div>
        <div><strong>Start Date:</strong> ${(wo.start_date || '').slice(0, 10)} | <strong>Due:</strong> ${(wo.due_date || '-').slice(0, 10)}<br/><strong>Status:</strong> ${wo.status || 'Draft'}<br/><strong>Target Quantity:</strong> ${parseFloat(wo.target_quantity || 0).toLocaleString()}</div>
      </div>
      <table>
        <thead><tr><th>Cost Component</th><th style="text-align:right;">Estimated / Actual (PKR)</th></tr></thead>
        <tbody>
          <tr><td>Direct Raw Materials Cost</td><td style="text-align:right;">PKR ${parseFloat(wo.actual_material_cost || 0).toLocaleString()}</td></tr>
          <tr><td>Direct Factory Labor Cost</td><td style="text-align:right;">PKR ${parseFloat(wo.actual_labor_cost || 0).toLocaleString()}</td></tr>
          <tr><td>Manufacturing Overhead Absorption</td><td style="text-align:right;">PKR ${parseFloat(wo.actual_overhead_cost || 0).toLocaleString()}</td></tr>
          <tr style="font-weight:800;background:#f1f5f9;"><td>TOTAL COST OF GOODS MANUFACTURED (COGM)</td><td style="text-align:right;">PKR ${parseFloat(wo.total_production_cost || 0).toLocaleString()}</td></tr>
        </tbody>
      </table>
      <div class="sig-grid">
        <div class="sig-box">Store Material Issuer</div>
        <div class="sig-box">Production Floor Supervisor</div>
        <div class="sig-box">Quality Assurance (QA) Inspector</div>
      </div>
    `);
  }
};

// Auto-initialize when window loads or script executes
if (typeof window !== 'undefined') {
  window.openTemplateEditorModal = (t) => TemplatesEngine.openTemplateEditorModal(t);
  window.previewTemplate = (id) => TemplatesEngine.previewTemplate(id);
  window.addEventListener('DOMContentLoaded', () => {
    if (typeof State !== 'undefined' && typeof State.isLoggedIn === 'function' && !State.isLoggedIn()) {
      return;
    }
    if (window.TemplatesEngine && typeof window.TemplatesEngine.init === 'function') {
      window.TemplatesEngine.init();
    }
  });
}
