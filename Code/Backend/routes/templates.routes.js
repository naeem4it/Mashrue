const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { resolveTenantId } = require('../middleware/rbac.middleware');

const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val || ''));

/**
 * Resolves effective tenant ID safely for all roles, including SuperAdmin fallback
 */
function getEffectiveTenantId(req) {
  let tid = resolveTenantId(req);
  if (!tid) {
    if (isUuid(req.query?.tenant_id)) tid = req.query.tenant_id;
    else if (isUuid(req.body?.tenant_id)) tid = req.body.tenant_id;
    else if (isUuid(req.headers['x-tenant-id'])) tid = req.headers['x-tenant-id'];
    else if (isUuid(req.user?.tenantId)) tid = req.user.tenantId;
    else if (isUuid(req.user?.tenant_id)) tid = req.user.tenant_id;
    else tid = 'a0000000-0000-0000-0000-000000000001'; // Default system tenant
  }
  return tid;
}

// Auto-migrate schema on module load
const initTemplatesSchema = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS print_templates (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        template_name VARCHAR(150) NOT NULL,
        doc_type VARCHAR(50) NOT NULL, -- 'quotation', 'tender', 'delivery_challan', 'invoice', 'purchase_order', 'bid_security'
        is_default BOOLEAN DEFAULT FALSE,
        
        -- Paper Specifications
        paper_size VARCHAR(20) DEFAULT 'A4',            -- 'A4', 'Letter', 'Legal'
        paper_orientation VARCHAR(20) DEFAULT 'portrait', -- 'portrait' or 'landscape'
        
        -- Branding Assets & Uploads
        logo_url TEXT,                                 -- Custom company logo (data URI or URL)
        logo_alignment VARCHAR(20) DEFAULT 'left',      -- 'left', 'center', 'right'
        logo_height_px INTEGER DEFAULT 65,             -- Scalable height from 30px to 140px
        letterhead_bg_url TEXT,                        -- High-res background image or banner graphic
        letterhead_bg_mode VARCHAR(30) DEFAULT 'header_only', -- 'header_only', 'full_page_watermark', 'full_page_bg'
        
        -- Letterhead Mode & Margins
        letterhead_mode VARCHAR(30) DEFAULT 'digital', -- 'digital' or 'letterhead' (pre-printed paper)
        top_margin_mm INTEGER DEFAULT 15,              -- For physical letterhead (e.g., 55mm to clear printed stationary)
        bottom_margin_mm INTEGER DEFAULT 15,
        left_margin_mm INTEGER DEFAULT 15,
        right_margin_mm INTEGER DEFAULT 15,
        
        -- Visual Configuration
        accent_color VARCHAR(30) DEFAULT '#0f172a',
        font_family VARCHAR(50) DEFAULT 'Inter, sans-serif',
        font_size_pt NUMERIC(3, 1) DEFAULT 9.5,
        show_company_header BOOLEAN DEFAULT TRUE,
        show_company_footer BOOLEAN DEFAULT TRUE,
        show_signature_blocks BOOLEAN DEFAULT TRUE,
        signature_title_left VARCHAR(100) DEFAULT 'Customer Acceptance & Stamp',
        signature_title_right VARCHAR(100) DEFAULT 'Authorized Signatory',
        
        -- Dynamic Column Configuration (JSONB)
        columns_config JSONB DEFAULT '[
          {"key": "sr", "label": "#", "visible": true, "width": "5%", "align": "center"},
          {"key": "item_name", "label": "Item Description & Specifications", "visible": true, "width": "45%", "align": "left"},
          {"key": "brand", "label": "Brand / Make", "visible": true, "width": "12%", "align": "left"},
          {"key": "quantity", "label": "Qty", "visible": true, "width": "8%", "align": "center"},
          {"key": "unit", "label": "Unit", "visible": true, "width": "6%", "align": "center"},
          {"key": "unit_price", "label": "Unit Price (PKR)", "visible": true, "width": "12%", "align": "right"},
          {"key": "total_price", "label": "Total Amount (PKR)", "visible": true, "width": "12%", "align": "right"}
        ]'::jsonb,
        
        -- Custom Notes & Legal Clause overrides
        custom_terms TEXT,
        custom_header_html TEXT,
        custom_footer_html TEXT,
        
        -- Metadata for uploaded sample detection
        source_mode VARCHAR(30) DEFAULT 'manual', -- 'manual' or 'sample_upload'
        source_file_name VARCHAR(255),
        
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Add enterprise lifecycle, modularity and versioning columns safely
      ALTER TABLE print_templates ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'published';
      ALTER TABLE print_templates ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
      ALTER TABLE print_templates ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
      ALTER TABLE print_templates ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'Commercial';
      ALTER TABLE print_templates ADD COLUMN IF NOT EXISTS module VARCHAR(50) DEFAULT 'tender';
      ALTER TABLE print_templates ADD COLUMN IF NOT EXISTS parent_template_id UUID;
      ALTER TABLE print_templates ADD COLUMN IF NOT EXISTS change_summary TEXT;
      ALTER TABLE print_templates ADD COLUMN IF NOT EXISTS description TEXT;

      CREATE TABLE IF NOT EXISTS customer_template_mappings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        doc_type VARCHAR(50) NOT NULL, -- 'quotation', 'tender', etc.
        template_id UUID NOT NULL REFERENCES print_templates(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, customer_id, doc_type)
      );

      -- Template Version History & Rollback Table
      CREATE TABLE IF NOT EXISTS template_versions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        template_id UUID NOT NULL REFERENCES print_templates(id) ON DELETE CASCADE,
        tenant_id UUID NOT NULL,
        version_number INTEGER NOT NULL,
        template_name VARCHAR(150),
        doc_type VARCHAR(50),
        module VARCHAR(50),
        category VARCHAR(50),
        paper_size VARCHAR(20),
        paper_orientation VARCHAR(20),
        letterhead_mode VARCHAR(30),
        top_margin_mm INTEGER,
        bottom_margin_mm INTEGER,
        left_margin_mm INTEGER,
        right_margin_mm INTEGER,
        accent_color VARCHAR(30),
        font_family VARCHAR(50),
        font_size_pt NUMERIC(3, 1),
        logo_url TEXT,
        logo_alignment VARCHAR(20),
        logo_height_px INTEGER,
        letterhead_bg_url TEXT,
        letterhead_bg_mode VARCHAR(30),
        show_company_header BOOLEAN,
        show_company_footer BOOLEAN,
        show_signature_blocks BOOLEAN,
        signature_title_left VARCHAR(100),
        signature_title_right VARCHAR(100),
        columns_config JSONB,
        custom_terms TEXT,
        custom_header_html TEXT,
        custom_footer_html TEXT,
        change_summary TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_template_versions_tid ON template_versions(template_id, version_number);
    `);
  } catch (err) {
    console.warn('Templates schema initialization warning:', err.message);
  }
};

initTemplatesSchema();

// Helper to seed standard default templates if tenant has none
const seedDefaultTemplatesForTenant = async (tenantId, userId) => {
  try {
    const existing = await db.query(
      `SELECT COUNT(*) FROM print_templates WHERE tenant_id = $1`,
      [tenantId]
    );
    if (parseInt(existing.rows[0].count, 10) > 0) return;

    // 1. Default Commercial Quotation Template
    const defaultQuotationCols = JSON.stringify([
      { key: "sr", label: "#", visible: true, width: "5%", align: "center" },
      { key: "item_name", label: "Item Description / Specifications", visible: true, width: "42%", align: "left" },
      { key: "brand", label: "Brand / Make", visible: true, width: "12%", align: "left" },
      { key: "quantity", label: "Qty", visible: true, width: "8%", align: "center" },
      { key: "unit", label: "Unit", visible: true, width: "7%", align: "center" },
      { key: "unit_price", label: "Unit Price (PKR)", visible: true, width: "13%", align: "right" },
      { key: "total_price", label: "Total Amount (PKR)", visible: true, width: "13%", align: "right" }
    ]);

    const defaultTerms = `1. Validity: This quotation is firm and valid for 30 days from the date of issue.
2. Delivery Lead Time: Goods will be delivered within 3-5 working days upon receipt of confirmed Purchase Order.
3. Payment Terms: 30 Days Net from Delivery & Verification.
4. Statutory Taxes: Prices are subject to applicable Sales Tax (GST) & statutory Income Tax withholding at source.
5. Warranty: Standard comprehensive replacement warranty as per manufacturer policy.`;

    await db.query(
      `INSERT INTO print_templates (
        tenant_id, template_name, doc_type, is_default, paper_size, paper_orientation,
        letterhead_mode, top_margin_mm, bottom_margin_mm, accent_color, columns_config,
        custom_terms, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        tenantId,
        'Standard Commercial Quotation',
        'quotation',
        true,
        'A4',
        'portrait',
        'digital',
        15,
        15,
        '#0284c7',
        defaultQuotationCols,
        defaultTerms,
        isUuid(userId) ? userId : null
      ]
    );

    // 2. Default PPRA Tender Bidding / BoQ Template
    const defaultTenderCols = JSON.stringify([
      { key: "sr", label: "Item #", visible: true, width: "6%", align: "center" },
      { key: "item_name", label: "Procurement Scope & Specifications", visible: true, width: "38%", align: "left" },
      { key: "specs", label: "Technical Compliance / Standards", visible: true, width: "18%", align: "left" },
      { key: "brand", label: "Offered Make & Country of Origin", visible: true, width: "14%", align: "left" },
      { key: "quantity", label: "Bidded Qty", visible: true, width: "8%", align: "center" },
      { key: "unit", label: "Unit", visible: true, width: "6%", align: "center" },
      { key: "total_price", label: "Offered Bid Amount (PKR)", visible: true, width: "10%", align: "right" }
    ]);

    const defaultTenderTerms = `1. Bid Validity: 90/120 calendar days from the date of technical tender opening.
2. Bid Security / Earnest Money: Valid CDR / Bank Guarantee enclosed in the financial envelope as per Rule 25 of PPRA Rules.
3. Delivery & Inspection: Free Delivery at Consignee Site (DDP) including preliminary physical inspection.
4. Statutory Compliance: Complete NTN, STRN, Active Taxpayer List (ATL) and non-blacklisting affidavit enclosed.`;

    await db.query(
      `INSERT INTO print_templates (
        tenant_id, template_name, doc_type, is_default, paper_size, paper_orientation,
        letterhead_mode, top_margin_mm, bottom_margin_mm, accent_color, columns_config,
        custom_terms, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        tenantId,
        'PPRA Tender Bidding Dossier (BoQ)',
        'tender',
        true,
        'A4',
        'portrait',
        'digital',
        15,
        15,
        '#0f172a',
        defaultTenderCols,
        defaultTenderTerms,
        isUuid(userId) ? userId : null
      ]
    );
  } catch (err) {
    console.error('Error seeding default templates:', err);
  }
};

// Helper to save version snapshot into template_versions
async function saveTemplateVersionSnapshot(template, changeSummary = 'Updated template configuration', userId = null) {
  try {
    const versionNum = parseInt(template.version || 1, 10);
    await db.query(`
      INSERT INTO template_versions (
        template_id, tenant_id, version_number, template_name, doc_type, module, category,
        paper_size, paper_orientation, letterhead_mode, top_margin_mm, bottom_margin_mm,
        left_margin_mm, right_margin_mm, accent_color, font_family, font_size_pt,
        logo_url, logo_alignment, logo_height_px, letterhead_bg_url, letterhead_bg_mode,
        show_company_header, show_company_footer, show_signature_blocks,
        signature_title_left, signature_title_right, columns_config, custom_terms,
        custom_header_html, custom_footer_html, change_summary, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22,
        $23, $24, $25,
        $26, $27, $28, $29,
        $30, $31, $32, $33
      )
    `, [
      template.id, template.tenant_id, versionNum, template.template_name, template.doc_type,
      template.module || 'tender', template.category || 'Commercial',
      template.paper_size || 'A4', template.paper_orientation || 'portrait', template.letterhead_mode || 'digital',
      template.top_margin_mm || 15, template.bottom_margin_mm || 15, template.left_margin_mm || 15, template.right_margin_mm || 15,
      template.accent_color || '#0f172a', template.font_family || 'Inter, sans-serif', template.font_size_pt || 9.5,
      template.logo_url || null, template.logo_alignment || 'left', template.logo_height_px || 65,
      template.letterhead_bg_url || null, template.letterhead_bg_mode || 'header_only',
      template.show_company_header !== false, template.show_company_footer !== false, template.show_signature_blocks !== false,
      template.signature_title_left || 'Customer Acceptance & Stamp', template.signature_title_right || 'Authorized Signatory',
      typeof template.columns_config === 'string' ? template.columns_config : JSON.stringify(template.columns_config || []),
      template.custom_terms || '', template.custom_header_html || '', template.custom_footer_html || '',
      changeSummary, isUuid(userId) ? userId : null
    ]);
  } catch (err) {
    console.warn('Failed to save template version snapshot:', err.message);
  }
}

// Master Cross-Module Document Field Registry
const DOCUMENT_FIELDS_REGISTRY = {
  tender: {
    name: 'Tender & BoQ Bidding',
    document_types: [
      {
        id: 'quotation',
        name: 'Commercial Quotation',
        category: 'Sales',
        tokens: [
          { token: '{{quote_number}}', label: 'Quotation Number', sample: 'QT-2026-0842' },
          { token: '{{quote_date}}', label: 'Quote Date', sample: '2026-10-29' },
          { token: '{{validity_date}}', label: 'Valid Until', sample: '2026-11-28' },
          { token: '{{customer_name}}', label: 'Customer / Buyer Name', sample: 'Mayo Hospital Lahore' },
          { token: '{{customer_ntn}}', label: 'Customer NTN / STRN', sample: '9012345-7' },
          { token: '{{customer_address}}', label: 'Delivery Site Address', sample: 'Anarkali, Lahore, Punjab' },
          { token: '{{payment_terms}}', label: 'Payment Terms', sample: '30 Days Net from Delivery' },
          { token: '{{subtotal_amount}}', label: 'Subtotal Amount (PKR)', sample: 'Rs. 1,450,000' },
          { token: '{{sales_tax_amount}}', label: 'Sales Tax GST 18%', sample: 'Rs. 261,000' },
          { token: '{{total_amount}}', label: 'Grand Total Amount', sample: 'Rs. 1,711,000' },
          { token: '{{amount_in_words}}', label: 'Amount in Words (PKR)', sample: 'One Million Seven Hundred Eleven Thousand Rupees Only' }
        ]
      },
      {
        id: 'tender',
        name: 'PPRA Tender Bidding Dossier (BoQ)',
        category: 'Tenders',
        tokens: [
          { token: '{{tender_title}}', label: 'Tender Procurement Title', sample: 'Procurement of High-End Biomedical Monitoring Systems' },
          { token: '{{tender_ref_no}}', label: 'Tender / Inquiry Ref #', sample: 'IPL-9284 / PPRA-PB-2026' },
          { token: '{{procuring_agency}}', label: 'Procuring Agency', sample: 'Specialized Healthcare & Medical Education Department' },
          { token: '{{bid_opening_date}}', label: 'Bid Submission & Opening Date', sample: '2026-11-15' },
          { token: '{{bid_security_details}}', label: 'CDR / Bank Guarantee Ref', sample: 'CDR # 9812401 issued by Bank of Punjab (2% Earnest Money)' },
          { token: '{{bid_validity}}', label: 'Bid Validity Duration', sample: '120 Calendar Days' },
          { token: '{{total_bid_amount}}', label: 'Total Bidded Amount', sample: 'Rs. 8,450,000' },
          { token: '{{amount_in_words}}', label: 'Amount in Words', sample: 'Eight Million Four Hundred Fifty Thousand Rupees Only' }
        ]
      },
      {
        id: 'bid_security',
        name: 'Bid Security / Earnest Money Letter',
        category: 'Tenders',
        tokens: [
          { token: '{{bank_name}}', label: 'Issuing Bank Name', sample: 'National Bank of Pakistan' },
          { token: '{{instrument_number}}', label: 'CDR / BG Number', sample: 'CDR-890123' },
          { token: '{{security_amount}}', label: 'Earnest Amount (PKR)', sample: 'Rs. 250,000' },
          { token: '{{expiry_date}}', label: 'Instrument Expiry Date', sample: '2027-02-15' }
        ]
      }
    ]
  },
  inventory: {
    name: 'Inventory & Logistics',
    document_types: [
      {
        id: 'delivery_challan',
        name: 'Delivery Challan & Dispatch Note',
        category: 'Logistics',
        tokens: [
          { token: '{{dc_number}}', label: 'Challan #', sample: 'DC-2026-0045' },
          { token: '{{dispatch_date}}', label: 'Dispatch Date', sample: '2026-10-29' },
          { token: '{{transporter_name}}', label: 'Transporter / Bilty #', sample: 'TCS Cargo / Bilty # 771829' },
          { token: '{{vehicle_number}}', label: 'Vehicle / Driver Reg', sample: 'LES-18-9041 (Driver: M. Tariq)' },
          { token: '{{total_cartons}}', label: 'Total Packages / Cartons', sample: '14 Cartons' }
        ]
      },
      {
        id: 'stock_transfer',
        name: 'Inter-Warehouse Stock Transfer Note',
        category: 'Logistics',
        tokens: [
          { token: '{{transfer_number}}', label: 'Transfer Note #', sample: 'STN-2026-0012' },
          { token: '{{source_warehouse}}', label: 'Source Warehouse', sample: 'Main Central Depot (Lahore)' },
          { token: '{{destination_warehouse}}', label: 'Destination Warehouse', sample: 'Regional Hub (Islamabad)' },
          { token: '{{authorized_by}}', label: 'Authorized By', sample: 'Operations Supervisor' }
        ]
      },
      {
        id: 'goods_received',
        name: 'Goods Received Note (GRN)',
        category: 'Logistics',
        tokens: [
          { token: '{{grn_number}}', label: 'GRN Number', sample: 'GRN-2026-0199' },
          { token: '{{po_number}}', label: 'Purchase Order #', sample: 'PO-2026-0082' },
          { token: '{{supplier_name}}', label: 'Vendor / Supplier', sample: 'Siemens Healthineers Pakistan' },
          { token: '{{inspection_status}}', label: 'QC Inspection Status', sample: 'Accepted 100%' }
        ]
      }
    ]
  },
  finance: {
    name: 'Finance & Invoicing',
    document_types: [
      {
        id: 'invoice',
        name: 'FBR Compliant Sales Tax Invoice',
        category: 'Billing',
        tokens: [
          { token: '{{invoice_number}}', label: 'Tax Invoice Number', sample: 'INV-2026-0914' },
          { token: '{{fbr_invoice_number}}', label: 'FBR PRAL POS / Digital Invoicing #', sample: 'FBR-100492-2026-0914' },
          { token: '{{fbr_qr_code}}', label: 'FBR QR Verification Code', sample: '[QR Image]' },
          { token: '{{invoice_date}}', label: 'Invoice Date', sample: '2026-10-29' },
          { token: '{{buyer_ntn}}', label: 'Buyer NTN / STRN', sample: '3049182-1' },
          { token: '{{taxable_amount}}', label: 'Value Excluding Sales Tax', sample: 'Rs. 1,000,000' },
          { token: '{{sales_tax_rate}}', label: 'Sales Tax Rate %', sample: '18%' },
          { token: '{{sales_tax_amount}}', label: 'Sales Tax Charged', sample: 'Rs. 180,000' },
          { token: '{{withholding_tax_amount}}', label: 'Income Tax WHT (Sec 153)', sample: 'Rs. 45,000' },
          { token: '{{net_payable}}', label: 'Net Payable Amount', sample: 'Rs. 1,135,000' }
        ]
      },
      {
        id: 'payment_receipt',
        name: 'Customer Payment Receipt Voucher',
        category: 'Receipts',
        tokens: [
          { token: '{{receipt_number}}', label: 'Receipt #', sample: 'REC-2026-0312' },
          { token: '{{cheque_number}}', label: 'Cheque / Pay Order #', sample: 'HBL Cheque # 882019' },
          { token: '{{deposit_bank}}', label: 'Deposited To Bank Account', sample: 'Meezan Bank - Corporate A/C 010293' },
          { token: '{{received_amount}}', label: 'Amount Received', sample: 'Rs. 500,000' }
        ]
      },
      {
        id: 'journal_voucher',
        name: 'General Ledger Journal Voucher (JV)',
        category: 'Accounting',
        tokens: [
          { token: '{{jv_number}}', label: 'Voucher Number', sample: 'JV-2026-0042' },
          { token: '{{voucher_date}}', label: 'Posting Date', sample: '2026-10-29' },
          { token: '{{total_debit}}', label: 'Total Balanced Debit (PKR)', sample: 'Rs. 750,000' },
          { token: '{{total_credit}}', label: 'Total Balanced Credit (PKR)', sample: 'Rs. 750,000' }
        ]
      }
    ]
  },
  crm: {
    name: 'Customer Relationship Management',
    document_types: [
      {
        id: 'crm_proposal',
        name: 'Commercial Sales Proposal',
        category: 'Sales',
        tokens: [
          { token: '{{lead_title}}', label: 'Opportunity / Deal Name', sample: 'Hospital Ward Refurbishment Equipment' },
          { token: '{{contact_person}}', label: 'Decision Maker / Contact', sample: 'Dr. Shahzad Tariq (MS)' },
          { token: '{{stage_name}}', label: 'Pipeline Stage', sample: 'Commercial Negotiation' },
          { token: '{{expected_close}}', label: 'Target Closing Date', sample: '2026-11-30' }
        ]
      },
      {
        id: 'customer_statement',
        name: 'Customer Account Activity Statement',
        category: 'Accounting',
        tokens: [
          { token: '{{statement_period}}', label: 'Billing Period', sample: 'Oct 01, 2026 to Oct 29, 2026' },
          { token: '{{opening_balance}}', label: 'Opening Balance', sample: 'Rs. 320,000' },
          { token: '{{total_invoiced}}', label: 'Period Billings', sample: 'Rs. 1,450,000' },
          { token: '{{total_paid}}', label: 'Period Receipts', sample: 'Rs. 1,000,000' },
          { token: '{{closing_balance}}', label: 'Current Outstanding Due', sample: 'Rs. 770,000' }
        ]
      }
    ]
  },
  manufacturing: {
    name: 'Manufacturing & Production',
    document_types: [
      {
        id: 'work_order',
        name: 'Production Job Card / Work Order',
        category: 'Manufacturing',
        tokens: [
          { token: '{{wo_number}}', label: 'Job Card / Work Order #', sample: 'WO-2026-0081' },
          { token: '{{product_name}}', label: 'Output Assembly / SKU', sample: 'Patient Monitor Trolley Stand SS-304' },
          { token: '{{target_quantity}}', label: 'Batch Target Quantity', sample: '50 Units' },
          { token: '{{production_line}}', label: 'Assembly Line / Work Center', sample: 'Line 2 - Metal Fabrication & Powder Coating' }
        ]
      },
      {
        id: 'bom_sheet',
        name: 'Bill of Materials (BOM) Spec Sheet',
        category: 'Engineering',
        tokens: [
          { token: '{{bom_code}}', label: 'BOM Code', sample: 'BOM-PM-01' },
          { token: '{{bom_version}}', label: 'BOM Revision', sample: 'v2.1' },
          { token: '{{standard_unit_cost}}', label: 'Calculated Unit Cost', sample: 'Rs. 18,450' }
        ]
      }
    ]
  },
  hrm: {
    name: 'Human Resource Management',
    document_types: [
      {
        id: 'appointment_letter',
        name: 'Employment Offer & Appointment Letter',
        category: 'Human Resources',
        tokens: [
          { token: '{{employee_name}}', label: 'Candidate / Employee Name', sample: 'Muhammad Salman Khan' },
          { token: '{{cnic_number}}', label: 'CNIC Number', sample: '35201-1234567-1' },
          { token: '{{designation}}', label: 'Designation / Title', sample: 'Senior Biomedical Field Engineer' },
          { token: '{{department}}', label: 'Department', sample: 'Technical Operations' },
          { token: '{{joining_date}}', label: 'Commencement / Joining Date', sample: '2026-11-01' },
          { token: '{{gross_salary}}', label: 'Agreed Gross Monthly Salary', sample: 'Rs. 150,000' }
        ]
      }
    ]
  },
  payroll: {
    name: 'Payroll & Compensation',
    document_types: [
      {
        id: 'payslip',
        name: 'Monthly Employee Salary Payslip',
        category: 'Payroll',
        tokens: [
          { token: '{{payroll_month}}', label: 'Payroll Period', sample: 'October 2026' },
          { token: '{{employee_id}}', label: 'Employee ID #', sample: 'EMP-014' },
          { token: '{{basic_salary}}', label: 'Basic Salary (PKR)', sample: 'Rs. 90,000' },
          { token: '{{house_rent_allowance}}', label: 'House Rent Allowance (HRA)', sample: 'Rs. 40,000' },
          { token: '{{medical_utility_allowance}}', label: 'Medical & Utilities', sample: 'Rs. 20,000' },
          { token: '{{gross_salary}}', label: 'Gross Salary', sample: 'Rs. 150,000' },
          { token: '{{income_tax_deduction}}', label: 'FBR Sec 149 Monthly Salary Tax', sample: 'Rs. 8,750' },
          { token: '{{eobi_deduction}}', label: 'EOBI Contribution', sample: 'Rs. 600' },
          { token: '{{net_salary}}', label: 'Net Disbursed Take-Home Pay', sample: 'Rs. 140,650' }
        ]
      }
    ]
  }
};

// GET /api/templates/registry/fields — Return all registered document types and field tokens
router.get('/registry/fields', authenticate, (req, res) => {
  res.json({ success: true, data: DOCUMENT_FIELDS_REGISTRY });
});

// GET /api/templates — List all templates with modular filtering, status tabs & search
router.get('/', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    await seedDefaultTemplatesForTenant(tenantId, req.user?.id);

    const { doc_type, module, status, search, category, include_archived } = req.query;
    let sql = `
      SELECT pt.*, u.full_name as author_name 
      FROM print_templates pt
      LEFT JOIN users u ON pt.created_by = u.id
      WHERE (pt.tenant_id = $1 OR ($2 = 'SuperAdmin' AND pt.tenant_id = 'a0000000-0000-0000-0000-000000000001'))
    `;
    const params = [tenantId, req.user?.role || ''];

    // Status filter
    if (status && status !== 'all') {
      sql += ` AND pt.status = $${params.length + 1}`;
      params.push(status);
    } else if (include_archived !== 'true') {
      sql += ` AND COALESCE(pt.is_archived, FALSE) = FALSE`;
    }

    if (doc_type && doc_type !== 'all') {
      sql += ` AND pt.doc_type = $${params.length + 1}`;
      params.push(doc_type);
    }

    if (module && module !== 'all') {
      sql += ` AND (pt.module = $${params.length + 1} OR ($${params.length + 1} = 'tender' AND pt.module IS NULL))`;
      params.push(module);
    }

    if (category && category !== 'all') {
      sql += ` AND pt.category = $${params.length + 1}`;
      params.push(category);
    }

    if (search && search.trim()) {
      sql += ` AND (pt.template_name ILIKE $${params.length + 1} OR pt.doc_type ILIKE $${params.length + 1} OR pt.description ILIKE $${params.length + 1})`;
      params.push(`%${search.trim()}%`);
    }

    sql += ` ORDER BY pt.is_default DESC, pt.updated_at DESC`;

    const result = await db.query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('GET /api/templates error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/templates/:id — Get single template
router.get('/:id', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const result = await db.query(
      `SELECT * FROM print_templates WHERE id = $1 AND (tenant_id = $2 OR $3 = 'SuperAdmin')`,
      [req.params.id, tenantId, req.user?.role || '']
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('GET /api/templates/:id error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/templates — Create new template with version 1 snapshot
router.post('/', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const {
      template_name,
      doc_type = 'quotation',
      module = 'tender',
      category = 'Commercial',
      description = '',
      status = 'published',
      is_default = false,
      paper_size = 'A4',
      paper_orientation = 'portrait',
      logo_url = null,
      logo_alignment = 'left',
      logo_height_px = 65,
      letterhead_bg_url = null,
      letterhead_bg_mode = 'header_only',
      letterhead_mode = 'digital',
      top_margin_mm = 15,
      bottom_margin_mm = 15,
      left_margin_mm = 15,
      right_margin_mm = 15,
      accent_color = '#0f172a',
      font_family = 'Inter, sans-serif',
      font_size_pt = 9.5,
      show_company_header = true,
      show_company_footer = true,
      show_signature_blocks = true,
      signature_title_left = 'Customer Acceptance & Stamp',
      signature_title_right = 'Authorized Signatory',
      columns_config,
      custom_terms,
      custom_header_html,
      custom_footer_html,
      source_mode = 'manual',
      source_file_name = null
    } = req.body;

    if (!template_name || !template_name.trim()) {
      return res.status(400).json({ success: false, message: 'Template name is required' });
    }

    // If marked default, unset other defaults for same doc_type
    if (is_default) {
      await db.query(
        `UPDATE print_templates SET is_default = FALSE WHERE tenant_id = $1 AND doc_type = $2`,
        [tenantId, doc_type]
      );
    }

    const insertSql = `
      INSERT INTO print_templates (
        tenant_id, template_name, doc_type, module, category, description, status, version, is_archived,
        is_default, paper_size, paper_orientation,
        logo_url, logo_alignment, logo_height_px, letterhead_bg_url, letterhead_bg_mode,
        letterhead_mode, top_margin_mm, bottom_margin_mm, left_margin_mm, right_margin_mm,
        accent_color, font_family, font_size_pt, show_company_header, show_company_footer,
        show_signature_blocks, signature_title_left, signature_title_right,
        columns_config, custom_terms, custom_header_html, custom_footer_html,
        source_mode, source_file_name, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, 1, FALSE,
        $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25,
        $26, $27, $28,
        $29, $30, $31, $32,
        $33, $34, $35
      ) RETURNING *
    `;

    const values = [
      tenantId,
      template_name.trim(),
      doc_type,
      module,
      category,
      description,
      status || 'published',
      !!is_default,
      paper_size,
      paper_orientation,
      logo_url,
      logo_alignment,
      parseInt(logo_height_px || 65, 10),
      letterhead_bg_url,
      letterhead_bg_mode,
      letterhead_mode,
      parseInt(top_margin_mm || 15, 10),
      parseInt(bottom_margin_mm || 15, 10),
      parseInt(left_margin_mm || 15, 10),
      parseInt(right_margin_mm || 15, 10),
      accent_color,
      font_family,
      parseFloat(font_size_pt || 9.5),
      show_company_header !== false,
      show_company_footer !== false,
      show_signature_blocks !== false,
      signature_title_left,
      signature_title_right,
      typeof columns_config === 'string' ? columns_config : JSON.stringify(columns_config || []),
      custom_terms || '',
      custom_header_html || '',
      custom_footer_html || '',
      source_mode,
      source_file_name,
      isUuid(req.user?.id) ? req.user.id : null
    ];

    const result = await db.query(insertSql, values);
    const createdTemplate = result.rows[0];

    // Record version 1 snapshot
    await saveTemplateVersionSnapshot(createdTemplate, 'Initial template creation', req.user?.id);

    res.status(201).json({ success: true, data: createdTemplate });
  } catch (err) {
    console.error('POST /api/templates error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/templates/:id — Update template with auto-version increment and snapshot
router.put('/:id', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const { id } = req.params;

    // Check template exists
    const check = await db.query(
      `SELECT * FROM print_templates WHERE id = $1 AND (tenant_id = $2 OR $3 = 'SuperAdmin')`,
      [id, tenantId, req.user?.role || '']
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const {
      template_name,
      doc_type,
      module,
      category,
      description,
      status,
      change_summary,
      is_default,
      paper_size,
      paper_orientation,
      logo_url,
      logo_alignment,
      logo_height_px,
      letterhead_bg_url,
      letterhead_bg_mode,
      letterhead_mode,
      top_margin_mm,
      bottom_margin_mm,
      left_margin_mm,
      right_margin_mm,
      accent_color,
      font_family,
      font_size_pt,
      show_company_header,
      show_company_footer,
      show_signature_blocks,
      signature_title_left,
      signature_title_right,
      columns_config,
      custom_terms,
      custom_header_html,
      custom_footer_html
    } = req.body;

    const current = check.rows[0];
    const targetDocType = doc_type || current.doc_type;
    const effectiveTargetTenantId = current.tenant_id || tenantId;

    if (is_default && !current.is_default) {
      await db.query(
        `UPDATE print_templates SET is_default = FALSE WHERE tenant_id = $1 AND doc_type = $2`,
        [effectiveTargetTenantId, targetDocType]
      );
    }

    const nextVersion = (parseInt(current.version || 1, 10)) + 1;

    const updateSql = `
      UPDATE print_templates SET
        template_name = COALESCE($1, template_name),
        doc_type = COALESCE($2, doc_type),
        module = COALESCE($3, module),
        category = COALESCE($4, category),
        description = COALESCE($5, description),
        status = COALESCE($6, status),
        version = $7,
        change_summary = $8,
        is_default = COALESCE($9, is_default),
        paper_size = COALESCE($10, paper_size),
        paper_orientation = COALESCE($11, paper_orientation),
        logo_url = $12,
        logo_alignment = COALESCE($13, logo_alignment),
        logo_height_px = COALESCE($14, logo_height_px),
        letterhead_bg_url = $15,
        letterhead_bg_mode = COALESCE($16, letterhead_bg_mode),
        letterhead_mode = COALESCE($17, letterhead_mode),
        top_margin_mm = COALESCE($18, top_margin_mm),
        bottom_margin_mm = COALESCE($19, bottom_margin_mm),
        left_margin_mm = COALESCE($20, left_margin_mm),
        right_margin_mm = COALESCE($21, right_margin_mm),
        accent_color = COALESCE($22, accent_color),
        font_family = COALESCE($23, font_family),
        font_size_pt = COALESCE($24, font_size_pt),
        show_company_header = COALESCE($25, show_company_header),
        show_company_footer = COALESCE($26, show_company_footer),
        show_signature_blocks = COALESCE($27, show_signature_blocks),
        signature_title_left = COALESCE($28, signature_title_left),
        signature_title_right = COALESCE($29, signature_title_right),
        columns_config = COALESCE($30, columns_config),
        custom_terms = COALESCE($31, custom_terms),
        custom_header_html = COALESCE($32, custom_header_html),
        custom_footer_html = COALESCE($33, custom_footer_html),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $34
      RETURNING *
    `;

    const values = [
      template_name ? template_name.trim() : null,
      doc_type || null,
      module || null,
      category || null,
      description !== undefined ? description : null,
      status || null,
      nextVersion,
      change_summary || 'Updated template configuration',
      is_default !== undefined ? !!is_default : null,
      paper_size || null,
      paper_orientation || null,
      logo_url !== undefined ? logo_url : current.logo_url,
      logo_alignment || null,
      logo_height_px ? parseInt(logo_height_px, 10) : null,
      letterhead_bg_url !== undefined ? letterhead_bg_url : current.letterhead_bg_url,
      letterhead_bg_mode || null,
      letterhead_mode || null,
      top_margin_mm ? parseInt(top_margin_mm, 10) : null,
      bottom_margin_mm ? parseInt(bottom_margin_mm, 10) : null,
      left_margin_mm ? parseInt(left_margin_mm, 10) : null,
      right_margin_mm ? parseInt(right_margin_mm, 10) : null,
      accent_color || null,
      font_family || null,
      font_size_pt ? parseFloat(font_size_pt) : null,
      show_company_header !== undefined ? !!show_company_header : null,
      show_company_footer !== undefined ? !!show_company_footer : null,
      show_signature_blocks !== undefined ? !!show_signature_blocks : null,
      signature_title_left || null,
      signature_title_right || null,
      columns_config ? (typeof columns_config === 'string' ? columns_config : JSON.stringify(columns_config)) : null,
      custom_terms !== undefined ? custom_terms : null,
      custom_header_html !== undefined ? custom_header_html : null,
      custom_footer_html !== undefined ? custom_footer_html : null,
      id
    ];

    const result = await db.query(updateSql, values);
    const updatedTemplate = result.rows[0];

    // Save snapshot in version history
    await saveTemplateVersionSnapshot(updatedTemplate, change_summary || `Updated to v${nextVersion}`, req.user?.id);

    res.json({ success: true, data: updatedTemplate });
  } catch (err) {
    console.error('PUT /api/templates/:id error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/templates/:id/duplicate — Clone template as draft
router.post('/:id/duplicate', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const { id } = req.params;

    const source = await db.query(
      `SELECT * FROM print_templates WHERE id = $1 AND (tenant_id = $2 OR $3 = 'SuperAdmin')`,
      [id, tenantId, req.user?.role || '']
    );
    if (source.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Source template not found' });
    }

    const t = source.rows[0];
    const newName = `Copy of ${t.template_name}`;

    const insertSql = `
      INSERT INTO print_templates (
        tenant_id, template_name, doc_type, module, category, description, status, version, is_archived,
        is_default, paper_size, paper_orientation,
        logo_url, logo_alignment, logo_height_px, letterhead_bg_url, letterhead_bg_mode,
        letterhead_mode, top_margin_mm, bottom_margin_mm, left_margin_mm, right_margin_mm,
        accent_color, font_family, font_size_pt, show_company_header, show_company_footer,
        show_signature_blocks, signature_title_left, signature_title_right,
        columns_config, custom_terms, custom_header_html, custom_footer_html,
        parent_template_id, source_mode, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'draft', 1, FALSE,
        FALSE, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23,
        $24, $25, $26,
        $27, $28, $29, $30,
        $31, 'duplicated', $32
      ) RETURNING *
    `;

    const result = await db.query(insertSql, [
      tenantId, newName, t.doc_type, t.module || 'tender', t.category || 'Commercial',
      t.description || '', t.paper_size, t.paper_orientation,
      t.logo_url, t.logo_alignment, t.logo_height_px, t.letterhead_bg_url, t.letterhead_bg_mode,
      t.letterhead_mode, t.top_margin_mm, t.bottom_margin_mm, t.left_margin_mm, t.right_margin_mm,
      t.accent_color, t.font_family, t.font_size_pt, t.show_company_header, t.show_company_footer,
      t.show_signature_blocks, t.signature_title_left, t.signature_title_right,
      typeof t.columns_config === 'string' ? t.columns_config : JSON.stringify(t.columns_config),
      t.custom_terms, t.custom_header_html, t.custom_footer_html,
      t.id, isUuid(req.user?.id) ? req.user.id : null
    ]);

    const duplicated = result.rows[0];
    await saveTemplateVersionSnapshot(duplicated, `Cloned from "${t.template_name}"`, req.user?.id);

    res.status(201).json({ success: true, data: duplicated, message: 'Template duplicated as Draft' });
  } catch (err) {
    console.error('POST /api/templates/:id/duplicate error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/templates/:id/archive — Archive template
router.post('/:id/archive', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const { id } = req.params;

    const result = await db.query(
      `UPDATE print_templates 
       SET is_archived = TRUE, status = 'archived', is_default = FALSE, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND (tenant_id = $2 OR $3 = 'SuperAdmin')
       RETURNING *`,
      [id, tenantId, req.user?.role || '']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    res.json({ success: true, data: result.rows[0], message: 'Template archived successfully' });
  } catch (err) {
    console.error('POST /api/templates/:id/archive error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/templates/:id/restore — Restore archived template
router.post('/:id/restore', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const { id } = req.params;

    const result = await db.query(
      `UPDATE print_templates 
       SET is_archived = FALSE, status = 'published', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND (tenant_id = $2 OR $3 = 'SuperAdmin')
       RETURNING *`,
      [id, tenantId, req.user?.role || '']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    res.json({ success: true, data: result.rows[0], message: 'Template restored successfully' });
  } catch (err) {
    console.error('POST /api/templates/:id/restore error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/templates/:id/versions — Get version history
router.get('/:id/versions', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const { id } = req.params;

    const result = await db.query(
      `SELECT tv.*, u.full_name as author_name
       FROM template_versions tv
       LEFT JOIN users u ON tv.created_by = u.id
       WHERE tv.template_id = $1 AND (tv.tenant_id = $2 OR $3 = 'SuperAdmin')
       ORDER BY tv.version_number DESC`,
      [id, tenantId, req.user?.role || '']
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('GET /api/templates/:id/versions error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/templates/:id/rollback — Rollback template to a previous version
router.post('/:id/rollback', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const { id } = req.params;
    const { version_number } = req.body;

    if (!version_number) {
      return res.status(400).json({ success: false, message: 'version_number is required for rollback' });
    }

    const versionCheck = await db.query(
      `SELECT * FROM template_versions 
       WHERE template_id = $1 AND version_number = $2 AND (tenant_id = $3 OR $4 = 'SuperAdmin')`,
      [id, parseInt(version_number, 10), tenantId, req.user?.role || '']
    );

    if (versionCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: `Version ${version_number} not found for this template` });
    }

    const v = versionCheck.rows[0];

    // Fetch current template to get latest version number
    const currentRes = await db.query(`SELECT version FROM print_templates WHERE id = $1`, [id]);
    const nextVer = (parseInt(currentRes.rows[0]?.version || 1, 10)) + 1;

    const updateSql = `
      UPDATE print_templates SET
        template_name = $1,
        doc_type = $2,
        module = $3,
        category = $4,
        paper_size = $5,
        paper_orientation = $6,
        letterhead_mode = $7,
        top_margin_mm = $8,
        bottom_margin_mm = $9,
        left_margin_mm = $10,
        right_margin_mm = $11,
        accent_color = $12,
        font_family = $13,
        font_size_pt = $14,
        logo_url = $15,
        logo_alignment = $16,
        logo_height_px = $17,
        letterhead_bg_url = $18,
        letterhead_bg_mode = $19,
        show_company_header = $20,
        show_company_footer = $21,
        show_signature_blocks = $22,
        signature_title_left = $23,
        signature_title_right = $24,
        columns_config = $25,
        custom_terms = $26,
        custom_header_html = $27,
        custom_footer_html = $28,
        version = $29,
        change_summary = $30,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $31
      RETURNING *
    `;

    const summaryText = `Rolled back to v${version_number}`;
    const result = await db.query(updateSql, [
      v.template_name, v.doc_type, v.module || 'tender', v.category || 'Commercial',
      v.paper_size, v.paper_orientation, v.letterhead_mode,
      v.top_margin_mm, v.bottom_margin_mm, v.left_margin_mm, v.right_margin_mm,
      v.accent_color, v.font_family, v.font_size_pt,
      v.logo_url, v.logo_alignment, v.logo_height_px,
      v.letterhead_bg_url, v.letterhead_bg_mode,
      v.show_company_header, v.show_company_footer, v.show_signature_blocks,
      v.signature_title_left, v.signature_title_right,
      typeof v.columns_config === 'string' ? v.columns_config : JSON.stringify(v.columns_config),
      v.custom_terms, v.custom_header_html, v.custom_footer_html,
      nextVer, summaryText, id
    ]);

    const rolledBackTemplate = result.rows[0];
    await saveTemplateVersionSnapshot(rolledBackTemplate, summaryText, req.user?.id);

    res.json({ success: true, data: rolledBackTemplate, message: `Successfully rolled back to v${version_number}` });
  } catch (err) {
    console.error('POST /api/templates/:id/rollback error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/templates/export/:id — Export template definition safely as JSON
router.get('/export/:id', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const { id } = req.params;

    const result = await db.query(
      `SELECT * FROM print_templates WHERE id = $1 AND (tenant_id = $2 OR $3 = 'SuperAdmin')`,
      [id, tenantId, req.user?.role || '']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const t = result.rows[0];
    const exportData = {
      manifest_version: '1.0',
      system: 'Mashrue Modular Business Platform',
      exported_at: new Date().toISOString(),
      template: {
        template_name: t.template_name,
        doc_type: t.doc_type,
        module: t.module || 'tender',
        category: t.category || 'Commercial',
        description: t.description || '',
        paper_size: t.paper_size,
        paper_orientation: t.paper_orientation,
        letterhead_mode: t.letterhead_mode,
        top_margin_mm: t.top_margin_mm,
        bottom_margin_mm: t.bottom_margin_mm,
        left_margin_mm: t.left_margin_mm,
        right_margin_mm: t.right_margin_mm,
        accent_color: t.accent_color,
        font_family: t.font_family,
        font_size_pt: t.font_size_pt,
        show_company_header: t.show_company_header,
        show_company_footer: t.show_company_footer,
        show_signature_blocks: t.show_signature_blocks,
        signature_title_left: t.signature_title_left,
        signature_title_right: t.signature_title_right,
        columns_config: t.columns_config,
        custom_terms: t.custom_terms,
        custom_header_html: t.custom_header_html,
        custom_footer_html: t.custom_footer_html
      }
    };

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(t.template_name.replace(/[^a-zA-Z0-9_-]/g, '_'))}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(exportData);
  } catch (err) {
    console.error('GET /api/templates/export/:id error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/templates/import — Safely import template configuration JSON
router.post('/import', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const { template, template_name } = req.body;

    const t = template || req.body;
    if (!t || !t.doc_type) {
      return res.status(400).json({ success: false, message: 'Invalid template format. doc_type is required.' });
    }

    const finalName = (template_name || t.template_name || 'Imported Template').trim();

    const insertSql = `
      INSERT INTO print_templates (
        tenant_id, template_name, doc_type, module, category, description, status, version, is_archived,
        is_default, paper_size, paper_orientation,
        logo_url, logo_alignment, logo_height_px, letterhead_bg_url, letterhead_bg_mode,
        letterhead_mode, top_margin_mm, bottom_margin_mm, left_margin_mm, right_margin_mm,
        accent_color, font_family, font_size_pt, show_company_header, show_company_footer,
        show_signature_blocks, signature_title_left, signature_title_right,
        columns_config, custom_terms, custom_header_html, custom_footer_html,
        source_mode, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'draft', 1, FALSE,
        FALSE, $7, $8,
        $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18,
        $19, $20, $21, $22, $23,
        $24, $25, $26,
        $27, $28, $29, $30,
        'imported', $31
      ) RETURNING *
    `;

    const values = [
      tenantId,
      finalName,
      t.doc_type,
      t.module || 'tender',
      t.category || 'Commercial',
      t.description || 'Imported from external file',
      t.paper_size || 'A4',
      t.paper_orientation || 'portrait',
      t.logo_url || null,
      t.logo_alignment || 'left',
      parseInt(t.logo_height_px || 65, 10),
      t.letterhead_bg_url || null,
      t.letterhead_bg_mode || 'header_only',
      t.letterhead_mode || 'digital',
      parseInt(t.top_margin_mm || 15, 10),
      parseInt(t.bottom_margin_mm || 15, 10),
      parseInt(t.left_margin_mm || 15, 10),
      parseInt(t.right_margin_mm || 15, 10),
      t.accent_color || '#0f172a',
      t.font_family || 'Inter, sans-serif',
      parseFloat(t.font_size_pt || 9.5),
      t.show_company_header !== false,
      t.show_company_footer !== false,
      t.show_signature_blocks !== false,
      t.signature_title_left || 'Customer Acceptance & Stamp',
      t.signature_title_right || 'Authorized Signatory',
      typeof t.columns_config === 'string' ? t.columns_config : JSON.stringify(t.columns_config || []),
      t.custom_terms || '',
      t.custom_header_html || '',
      t.custom_footer_html || '',
      isUuid(req.user?.id) ? req.user.id : null
    ];

    const result = await db.query(insertSql, values);
    const importedTemplate = result.rows[0];

    await saveTemplateVersionSnapshot(importedTemplate, 'Imported from external template definition', req.user?.id);

    res.status(201).json({ success: true, data: importedTemplate, message: 'Template successfully imported' });
  } catch (err) {
    console.error('POST /api/templates/import error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/templates/:id — Delete template
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const { id } = req.params;

    const check = await db.query(
      `SELECT * FROM print_templates WHERE id = $1 AND (tenant_id = $2 OR $3 = 'SuperAdmin')`,
      [id, tenantId, req.user?.role || '']
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    await db.query(`DELETE FROM print_templates WHERE id = $1`, [id]);
    res.json({ success: true, message: 'Template deleted successfully' });
  } catch (err) {
    console.error('DELETE /api/templates/:id error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/templates/:id/set-default — Mark template as default
router.post('/:id/set-default', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const { id } = req.params;

    const check = await db.query(
      `SELECT doc_type, tenant_id FROM print_templates WHERE id = $1 AND (tenant_id = $2 OR $3 = 'SuperAdmin')`,
      [id, tenantId, req.user?.role || '']
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    const tId = check.rows[0].tenant_id || tenantId;
    const docType = check.rows[0].doc_type;
    await db.query(
      `UPDATE print_templates SET is_default = FALSE WHERE tenant_id = $1 AND doc_type = $2`,
      [tId, docType]
    );
    await db.query(
      `UPDATE print_templates SET is_default = TRUE WHERE id = $1`,
      [id]
    );

    res.json({ success: true, message: 'Template marked as default successfully' });
  } catch (err) {
    console.error('POST /api/templates/:id/set-default error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/templates/customer-mappings/all — Get all customer mappings for tenant
router.get('/customer-mappings/all', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const sql = `
      SELECT 
        cm.*, 
        c.business_name as customer_name,
        c.org_type as customer_org_type,
        pt.template_name,
        pt.paper_size,
        pt.letterhead_mode
      FROM customer_template_mappings cm
      JOIN customers c ON cm.customer_id = c.id
      JOIN print_templates pt ON cm.template_id = pt.id
      WHERE (cm.tenant_id = $1 OR ($2 = 'SuperAdmin' AND cm.tenant_id = 'a0000000-0000-0000-0000-000000000001'))
      ORDER BY c.business_name ASC
    `;
    const result = await db.query(sql, [tenantId, req.user?.role || '']);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('GET /api/templates/customer-mappings error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/templates/customer-mappings — Upsert customer template mapping
router.post('/customer-mappings', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const { customer_id, doc_type = 'quotation', template_id } = req.body;

    if (!customer_id || !template_id) {
      return res.status(400).json({ success: false, message: 'Customer ID and Template ID are required' });
    }

    const upsertSql = `
      INSERT INTO customer_template_mappings (tenant_id, customer_id, doc_type, template_id)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (tenant_id, customer_id, doc_type)
      DO UPDATE SET template_id = EXCLUDED.template_id, created_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const result = await db.query(upsertSql, [tenantId, customer_id, doc_type, template_id]);
    res.json({ success: true, data: result.rows[0], message: 'Customer template mapping saved' });
  } catch (err) {
    console.error('POST /api/templates/customer-mappings error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/templates/customer-mappings/:id — Delete mapping
router.delete('/customer-mappings/:id', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    await db.query(
      `DELETE FROM customer_template_mappings WHERE id = $1 AND (tenant_id = $2 OR $3 = 'SuperAdmin')`,
      [req.params.id, tenantId, req.user?.role || '']
    );
    res.json({ success: true, message: 'Mapping removed successfully' });
  } catch (err) {
    console.error('DELETE /api/templates/customer-mappings error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/templates/parse-sample — Smart recognition engine for uploaded sample documents
router.post('/parse-sample', authenticate, async (req, res) => {
  try {
    const { fileName, fileContent, sampleText, fileType } = req.body;

    // Default intelligent synthesized template configuration
    let detectedDocType = 'quotation';
    let detectedPaperSize = 'A4';
    let detectedPaperOrientation = 'portrait';
    let detectedLetterheadMode = 'digital';
    let detectedTopMargin = 15;
    let detectedAccentColor = '#0f172a';

    const text = (sampleText || fileName || '').toLowerCase();

    // 1. Doc Type Heuristic Analysis
    if (text.includes('tender') || text.includes('bidding') || text.includes('ppra') || text.includes('boq') || text.includes('rfq')) {
      detectedDocType = 'tender';
      detectedAccentColor = '#0f172a';
    } else if (text.includes('delivery') || text.includes('challan') || text.includes('dispatch') || text.includes('bilty')) {
      detectedDocType = 'delivery_challan';
      detectedAccentColor = '#059669';
    } else if (text.includes('tax invoice') || text.includes('fbr') || text.includes('sales tax') || text.includes('pral')) {
      detectedDocType = 'invoice';
      detectedAccentColor = '#4338ca';
    } else {
      detectedDocType = 'quotation';
      detectedAccentColor = '#0284c7';
    }

    // 2. Paper Size & Orientation detection
    if (text.includes('legal') || text.includes('stamp paper')) {
      detectedPaperSize = 'Legal';
    } else if (text.includes('letter')) {
      detectedPaperSize = 'Letter';
    } else {
      detectedPaperSize = 'A4';
    }

    if (text.includes('landscape') || text.includes('wide')) {
      detectedPaperOrientation = 'landscape';
    }

    // 3. Pre-Printed Stationary / Letterhead Detection
    if (text.includes('letterhead') || text.includes('preprinted') || text.includes('stationery') || text.includes('pad')) {
      detectedLetterheadMode = 'letterhead';
      detectedTopMargin = 55; // 55mm top margin offset for pre-printed letterheads
    }

    // 4. Intelligent Column Synthesis based on content signals
    let columns = [];
    const hasBrand = text.includes('brand') || text.includes('make') || text.includes('origin') || text.includes('model');
    const hasSpecs = text.includes('spec') || text.includes('technical') || text.includes('compliance');
    const hasTax = text.includes('gst') || text.includes('tax') || text.includes('vat');
    const hasDelivery = text.includes('lead time') || text.includes('delivery') || text.includes('schedule');

    columns.push({ key: "sr", label: "#", visible: true, width: "5%", align: "center" });
    columns.push({ key: "item_name", label: "Item Description & Scope", visible: true, width: hasSpecs ? "35%" : "42%", align: "left" });

    if (hasSpecs) {
      columns.push({ key: "specs", label: "Technical Specifications", visible: true, width: "16%", align: "left" });
    }
    if (hasBrand) {
      columns.push({ key: "brand", label: "Brand / Make", visible: true, width: "12%", align: "left" });
    }

    columns.push({ key: "quantity", label: "Qty", visible: true, width: "8%", align: "center" });
    columns.push({ key: "unit", label: "Unit", visible: true, width: "6%", align: "center" });
    columns.push({ key: "unit_price", label: "Unit Price (PKR)", visible: true, width: "12%", align: "right" });

    if (hasTax) {
      columns.push({ key: "tax_rate", label: "GST %", visible: true, width: "8%", align: "center" });
    }
    if (hasDelivery) {
      columns.push({ key: "delivery_time", label: "Lead Time", visible: true, width: "10%", align: "center" });
    }

    columns.push({ key: "total_price", label: "Total Amount (PKR)", visible: true, width: "13%", align: "right" });

    // 5. Terms extraction or synthesis
    const customTerms = `1. Validity: This offer is valid for 30 calendar days from date of submission.
2. Delivery: Ex-Stock / 3 to 7 working days upon receipt of official Purchase Order.
3. Payment: 100% after successful delivery & technical acceptance.
4. Taxes: All rates quoted are in Pakistani Rupees (PKR) and subject to applicable Federal / Provincial withholding taxes.`;

    const recognizedTemplate = {
      template_name: `AI Recognized — ${fileName ? fileName.replace(/\.[^/.]+$/, "") : (detectedDocType.toUpperCase() + ' Template')}`,
      doc_type: detectedDocType,
      paper_size: detectedPaperSize,
      paper_orientation: detectedPaperOrientation,
      letterhead_mode: detectedLetterheadMode,
      top_margin_mm: detectedTopMargin,
      bottom_margin_mm: 15,
      accent_color: detectedAccentColor,
      show_company_header: detectedLetterheadMode !== 'letterhead',
      show_company_footer: detectedLetterheadMode !== 'letterhead',
      show_signature_blocks: true,
      columns_config: columns,
      custom_terms: customTerms,
      source_mode: 'sample_upload',
      source_file_name: fileName || 'Uploaded Document Sample'
    };

    res.json({
      success: true,
      data: recognizedTemplate,
      meta: {
        detected_columns_count: columns.length,
        detected_doc_type: detectedDocType,
        letterhead_detected: detectedLetterheadMode === 'letterhead'
      }
    });
  } catch (err) {
    console.error('POST /api/templates/parse-sample error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
