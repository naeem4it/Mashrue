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

      CREATE TABLE IF NOT EXISTS customer_template_mappings (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        doc_type VARCHAR(50) NOT NULL, -- 'quotation', 'tender', etc.
        template_id UUID NOT NULL REFERENCES print_templates(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, customer_id, doc_type)
      );
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

// GET /api/templates — List all templates for tenant
router.get('/', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    await seedDefaultTemplatesForTenant(tenantId, req.user?.id);

    const { doc_type } = req.query;
    let sql = `
      SELECT pt.*, u.full_name as author_name 
      FROM print_templates pt
      LEFT JOIN users u ON pt.created_by = u.id
      WHERE (pt.tenant_id = $1 OR ($2 = 'SuperAdmin' AND pt.tenant_id = 'a0000000-0000-0000-0000-000000000001'))
    `;
    const params = [tenantId, req.user?.role || ''];

    if (doc_type) {
      sql += ` AND pt.doc_type = $${params.length + 1}`;
      params.push(doc_type);
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

// POST /api/templates — Create new template
router.post('/', authenticate, async (req, res) => {
  try {
    const tenantId = getEffectiveTenantId(req);
    const {
      template_name,
      doc_type = 'quotation',
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
        tenant_id, template_name, doc_type, is_default, paper_size, paper_orientation,
        logo_url, logo_alignment, logo_height_px, letterhead_bg_url, letterhead_bg_mode,
        letterhead_mode, top_margin_mm, bottom_margin_mm, left_margin_mm, right_margin_mm,
        accent_color, font_family, font_size_pt, show_company_header, show_company_footer,
        show_signature_blocks, signature_title_left, signature_title_right,
        columns_config, custom_terms, custom_header_html, custom_footer_html,
        source_mode, source_file_name, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21,
        $22, $23, $24,
        $25, $26, $27, $28,
        $29, $30, $31
      ) RETURNING *
    `;

    const values = [
      tenantId,
      template_name.trim(),
      doc_type,
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
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('POST /api/templates error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/templates/:id — Update template
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

    const updateSql = `
      UPDATE print_templates SET
        template_name = COALESCE($1, template_name),
        doc_type = COALESCE($2, doc_type),
        is_default = COALESCE($3, is_default),
        paper_size = COALESCE($4, paper_size),
        paper_orientation = COALESCE($5, paper_orientation),
        logo_url = $6,
        logo_alignment = COALESCE($7, logo_alignment),
        logo_height_px = COALESCE($8, logo_height_px),
        letterhead_bg_url = $9,
        letterhead_bg_mode = COALESCE($10, letterhead_bg_mode),
        letterhead_mode = COALESCE($11, letterhead_mode),
        top_margin_mm = COALESCE($12, top_margin_mm),
        bottom_margin_mm = COALESCE($13, bottom_margin_mm),
        left_margin_mm = COALESCE($14, left_margin_mm),
        right_margin_mm = COALESCE($15, right_margin_mm),
        accent_color = COALESCE($16, accent_color),
        font_family = COALESCE($17, font_family),
        font_size_pt = COALESCE($18, font_size_pt),
        show_company_header = COALESCE($19, show_company_header),
        show_company_footer = COALESCE($20, show_company_footer),
        show_signature_blocks = COALESCE($21, show_signature_blocks),
        signature_title_left = COALESCE($22, signature_title_left),
        signature_title_right = COALESCE($23, signature_title_right),
        columns_config = COALESCE($24, columns_config),
        custom_terms = COALESCE($25, custom_terms),
        custom_header_html = COALESCE($26, custom_header_html),
        custom_footer_html = COALESCE($27, custom_footer_html),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $28
      RETURNING *
    `;

    const values = [
      template_name ? template_name.trim() : null,
      doc_type || null,
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
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('PUT /api/templates/:id error:', err);
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
