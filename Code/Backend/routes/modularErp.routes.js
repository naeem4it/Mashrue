const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireModuleLicense, requirePermission } = require('../middleware/rbac.middleware');
const inventoryValuationService = require('../services/inventoryValuationService');

/**
 * Helper to resolve effective tenant ID for queries and inserts
 */
async function getEffectiveTenantId(req) {
  if (req.user?.tenantId) return req.user.tenantId;
  if (req.user?.tenant?.id) return req.user.tenant.id;
  const headerTid = req.headers['x-tenant-id'];
  if (headerTid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(headerTid)) {
    return headerTid;
  }
  const fallback = await db.query(`SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`);
  return fallback.rows[0]?.id || null;
}

/**
 * Helper to resolve default business profile ID for a tenant
 */
async function getEffectiveBusinessProfileId(req, tenantId, explicitBpId) {
  if (explicitBpId && explicitBpId !== 'all' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(explicitBpId)) {
    return explicitBpId;
  }
  const bpRes = await db.query(
    `SELECT id FROM business_profiles WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [tenantId]
  );
  return bpRes.rows[0]?.id || null;
}

/**
 * Pakistan FBR Section 149 Salaried Individual Progressive Tax Calculator (Finance Act 2025/2026)
 * Calculates annual & monthly income tax from monthly gross salary (assuming 10% medical exemption or taxable base).
 */
function calculatePakistanSalaryTax(monthlyGross) {
  const gross = Math.max(0, parseFloat(monthlyGross || 0));
  const annualTaxable = gross * 12;
  let annualTax = 0;

  if (annualTaxable <= 600000) {
    annualTax = 0;
  } else if (annualTaxable <= 1200000) {
    annualTax = (annualTaxable - 600000) * 0.05;
  } else if (annualTaxable <= 2200000) {
    annualTax = 30000 + (annualTaxable - 1200000) * 0.15;
  } else if (annualTaxable <= 3200000) {
    annualTax = 180000 + (annualTaxable - 2200000) * 0.25;
  } else if (annualTaxable <= 4100000) {
    annualTax = 430000 + (annualTaxable - 3200000) * 0.30;
  } else {
    annualTax = 700000 + (annualTaxable - 4100000) * 0.35;
  }

  return {
    monthly_gross: gross,
    annual_taxable: annualTaxable,
    annual_tax: Math.round(annualTax),
    monthly_tax: Math.round(annualTax / 12)
  };
}

// ============================================================================
// 0. MODULAR LICENSING ENDPOINTS (tenant_modules)
// ============================================================================
router.get('/modules', authenticate, async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    if (!tid) return res.json({ success: true, data: [] });

    const result = await db.query(
      `SELECT * FROM tenant_modules WHERE tenant_id = $1 ORDER BY module_key ASC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/modules', authenticate, async (req, res) => {
  try {
    const tid = req.body.tenant_id || (await getEffectiveTenantId(req));
    const { active_modules, plan_tier } = req.body;
    if (!tid || !Array.isArray(active_modules)) {
      return res.status(400).json({ success: false, message: 'tenant_id and active_modules array are required.' });
    }

    await db.query(`UPDATE tenants SET active_modules = $1::jsonb WHERE id = $2`, [JSON.stringify(active_modules), tid]);

    await db.query(`UPDATE tenant_modules SET is_active = FALSE WHERE tenant_id = $1`, [tid]);
    for (const modKey of active_modules) {
      await db.query(
        `INSERT INTO tenant_modules (tenant_id, module_key, is_active, plan_tier)
         VALUES ($1, $2, TRUE, $3)
         ON CONFLICT (tenant_id, module_key) DO UPDATE SET is_active = TRUE, plan_tier = EXCLUDED.plan_tier`,
        [tid, modKey, plan_tier || 'Enterprise']
      );
    }

    res.json({ success: true, message: 'Modular licenses updated successfully.', data: active_modules });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 1. MODULE 1 ADDITIONS: TENDER DOCUMENTS & COMPETITOR BIDS
// ============================================================================
router.get('/tender-documents', authenticate, requireModuleLicense('mod_tenders'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const { opportunity_id } = req.query;
    const params = [tid];
    let q = `
      SELECT td.*, o.opportunity_number, o.title as opportunity_title
      FROM tender_documents td
      LEFT JOIN opportunities o ON td.opportunity_id = o.id
      WHERE td.tenant_id = $1
    `;
    if (opportunity_id) {
      params.push(opportunity_id);
      q += ` AND td.opportunity_id = $2`;
    }
    q += ` ORDER BY td.created_at DESC`;
    const result = await db.query(q, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/tender-documents', authenticate, requireModuleLicense('mod_tenders'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const { opportunity_id, document_title, document_category, checklist_status, file_url, file_size_kb, notes } = req.body;
    const result = await db.query(
      `INSERT INTO tender_documents (tenant_id, opportunity_id, document_title, document_category, checklist_status, file_url, file_size_kb, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [tid, opportunity_id, document_title, document_category || 'Technical Bid', checklist_status || 'Verified', file_url || '', file_size_kb || 0, notes || '']
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/tender-competitors', authenticate, requireModuleLicense('mod_tenders'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const { opportunity_id } = req.query;
    const params = [tid];
    let q = `
      SELECT tc.*, o.opportunity_number, o.title as opportunity_title
      FROM tender_competitor_bids tc
      LEFT JOIN opportunities o ON tc.opportunity_id = o.id
      WHERE tc.tenant_id = $1
    `;
    if (opportunity_id) {
      params.push(opportunity_id);
      q += ` AND tc.opportunity_id = $2`;
    }
    q += ` ORDER BY tc.ranking ASC, tc.financial_bid_amount ASC`;
    const result = await db.query(q, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/tender-competitors', authenticate, requireModuleLicense('mod_tenders'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const { opportunity_id, competitor_name, quoted_brand, technical_score, financial_bid_amount, ranking, is_winner, rejection_grounds } = req.body;
    const result = await db.query(
      `INSERT INTO tender_competitor_bids (tenant_id, opportunity_id, competitor_name, quoted_brand, technical_score, financial_bid_amount, ranking, is_winner, rejection_grounds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [tid, opportunity_id, competitor_name, quoted_brand || '', parseFloat(technical_score || 0), parseFloat(financial_bid_amount || 0), parseInt(ranking || 1, 10), Boolean(is_winner), rejection_grounds || '']
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 2. MODULE 2: TENDER NOTIFICATION RADAR (PPRA / EPADS Feed & Alert Rules)
// ============================================================================
router.get('/tender-radar/scrapes', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const { province, portal_source, q } = req.query;
    const params = [];
    let sql = `SELECT * FROM public_tender_scrapes WHERE 1=1`;

    if (province && province !== 'all') {
      params.push(province);
      sql += ` AND LOWER(province) = LOWER($${params.length})`;
    }
    if (portal_source && portal_source !== 'all') {
      params.push(portal_source);
      sql += ` AND LOWER(portal_source) = LOWER($${params.length})`;
    }
    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      sql += ` AND (title ILIKE $${params.length} OR organization_name ILIKE $${params.length} OR tender_ref_number ILIKE $${params.length} OR category ILIKE $${params.length})`;
    }

    sql += ` ORDER BY closing_date ASC, scraped_at DESC`;
    const result = await db.query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/tender-radar/scrapes', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const {
      portal_source, tender_ref_number, title, organization_name,
      city, province, publication_date, closing_date,
      estimated_cost, bid_security_pct, category, tender_notice_url
    } = req.body;

    const result = await db.query(
      `INSERT INTO public_tender_scrapes (
        portal_source, tender_ref_number, title, organization_name,
        city, province, publication_date, closing_date,
        estimated_cost, bid_security_pct, category, tender_notice_url
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (portal_source, tender_ref_number) DO UPDATE
      SET title = EXCLUDED.title,
          closing_date = EXCLUDED.closing_date,
          estimated_cost = EXCLUDED.estimated_cost
      RETURNING *`,
      [
        portal_source || 'Federal PPRA',
        tender_ref_number || `PPRA-${Date.now().toString().slice(-6)}`,
        title,
        organization_name,
        city || 'Islamabad',
        province || 'Federal',
        publication_date || new Date().toISOString().split('T')[0],
        closing_date || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
        parseFloat(estimated_cost || 0),
        parseFloat(bid_security_pct || 2.0),
        category || 'General Procurement',
        tender_notice_url || 'https://ppra.org.pk'
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 1-Click Import Scraped PPRA/EPADS Tender into Tenant's Active Opportunities (Module 1)
router.post('/tender-radar/import/:id', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const bpId = await getEffectiveBusinessProfileId(req, tid, req.body.business_profile_id);
    const scrapeRes = await db.query(`SELECT * FROM public_tender_scrapes WHERE id = $1`, [req.params.id]);

    if (scrapeRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Scraped tender notice not found.' });
    }
    const s = scrapeRes.rows[0];

    // 1. Find or create procuring agency in shared `customers` table
    let customerId = null;
    const custCheck = await db.query(
      `SELECT id FROM customers WHERE tenant_id = $1 AND LOWER(business_name) = LOWER($2) LIMIT 1`,
      [tid, s.organization_name]
    );
    if (custCheck.rows.length > 0) {
      customerId = custCheck.rows[0].id;
    } else {
      const newCust = await db.query(
        `INSERT INTO customers (tenant_id, business_name, customer_type, org_type, city, address)
         VALUES ($1, $2, 'Government Department', 'Government Department', $3, $4) RETURNING id`,
        [tid, s.organization_name, s.city || 'Islamabad', `${s.organization_name}, ${s.city || 'Pakistan'}`]
      );
      customerId = newCust.rows[0].id;
    }

    // 2. Insert into `opportunities` table (Module 1)
    const estCost = parseFloat(s.estimated_cost || 0);
    const secPct = parseFloat(s.bid_security_pct || 2);
    const secAmt = Math.round((estCost * secPct) / 100);

    const oppRes = await db.query(
      `INSERT INTO opportunities (
        tenant_id, business_profile_id, customer_id, opportunity_number,
        title, tender_source, tender_type, publication_date, closing_date,
        opening_date, estimated_value_pkr, bid_security_required, bid_security_amount,
        status, description
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,TRUE,$11,'New',$12)
      RETURNING *`,
      [
        tid,
        bpId,
        customerId,
        s.tender_ref_number,
        s.title,
        s.portal_source.includes('EPADS') ? 'EPADS' : 'PPRA',
        'Single Stage Two Envelope',
        s.publication_date || new Date().toISOString().split('T')[0],
        s.closing_date,
        estCost,
        secAmt,
        `Imported from ${s.portal_source} Radar (${s.category || 'Public Tender'}). Procuring Agency: ${s.organization_name}, ${s.city}.`
      ]
    );

    res.status(201).json({
      success: true,
      message: `Tender "${s.tender_ref_number}" imported into your active Bidding Pipeline!`,
      data: oppRes.rows[0]
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/tender-radar/rules', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const result = await db.query(
      `SELECT * FROM tenant_tender_alert_rules WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/tender-radar/rules', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const {
      rule_name, keywords, target_provinces, min_estimated_value,
      notification_channels, whatsapp_number, recipient_emails
    } = req.body;

    const kwArr = Array.isArray(keywords)
      ? keywords
      : String(keywords || '').split(',').map(k => k.trim()).filter(Boolean);
    const provArr = Array.isArray(target_provinces)
      ? target_provinces
      : String(target_provinces || 'Federal,Punjab,Sindh,KP').split(',').map(p => p.trim()).filter(Boolean);
    const chanArr = Array.isArray(notification_channels)
      ? notification_channels
      : ['Email', 'WhatsApp', 'InApp'];
    const emailArr = Array.isArray(recipient_emails)
      ? recipient_emails
      : String(recipient_emails || '').split(',').map(e => e.trim()).filter(Boolean);

    const result = await db.query(
      `INSERT INTO tenant_tender_alert_rules (
        tenant_id, rule_name, keywords, target_provinces,
        min_estimated_value, notification_channels, whatsapp_number, recipient_emails
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tid, rule_name, kwArr, provArr, parseFloat(min_estimated_value || 0), chanArr, whatsapp_number || '', emailArr]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/tender-radar/rules/:id', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    await db.query(`DELETE FROM tenant_tender_alert_rules WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    res.json({ success: true, message: 'Alert rule deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 3. MODULE 3 ADDITIONS: INTER-WAREHOUSE STOCK TRANSFERS & RECONCILIATION AUDITS
// ============================================================================
router.get('/inventory-transfers', authenticate, requireModuleLicense('mod_inventory'), requirePermission('stock_transfers', 'view'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const result = await db.query(
      `SELECT it.*,
              wf.warehouse_name as from_warehouse_name,
              wt.warehouse_name as to_warehouse_name,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', iti.id,
                  'product_id', iti.product_id,
                  'product_name', p.name,
                  'sku_code', p.sku,
                  'quantity', iti.quantity,
                  'unit_cost', iti.unit_cost,
                  'batch_number', iti.batch_number
                ))
                FROM inventory_transfer_items iti
                LEFT JOIN products_services p ON iti.product_id = p.id
                WHERE iti.transfer_id = it.id), '[]'::json
              ) as items
       FROM inventory_transfers it
       LEFT JOIN warehouses wf ON it.from_warehouse_id = wf.id
       LEFT JOIN warehouses wt ON it.to_warehouse_id = wt.id
       WHERE it.tenant_id = $1
       ORDER BY it.transfer_date DESC, it.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/inventory-transfers', authenticate, requireModuleLicense('mod_inventory'), requirePermission('stock_transfers', 'add'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const transfer = await inventoryValuationService.executeStockTransfer({
      tenantId: tid,
      fromWarehouseId: req.body.from_warehouse_id,
      toWarehouseId: req.body.to_warehouse_id,
      transferDate: req.body.transfer_date,
      transferNumber: req.body.transfer_number,
      driverName: req.body.driver_name,
      vehicleNumber: req.body.vehicle_number,
      notes: req.body.notes,
      items: req.body.items || [],
      userId: req.user?.id || null
    });
    res.status(201).json({ success: true, message: `Stock Transfer ${transfer.transfer_number} completed.`, data: transfer });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/inventory-adjustments', authenticate, requireModuleLicense('mod_inventory'), requirePermission('inventory', 'view'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const result = await db.query(
      `SELECT ia.*, w.warehouse_name as warehouse_name,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', iai.id,
                  'product_id', iai.product_id,
                  'product_name', p.name,
                  'system_stock', iai.system_stock,
                  'physical_stock', iai.physical_stock,
                  'difference_qty', iai.difference_qty,
                  'unit_cost', iai.unit_cost
                ))
                FROM inventory_adjustment_items iai
                LEFT JOIN products_services p ON iai.product_id = p.id
                WHERE iai.adjustment_id = ia.id), '[]'::json
              ) as items
       FROM inventory_adjustments ia
       LEFT JOIN warehouses w ON ia.warehouse_id = w.id
       WHERE ia.tenant_id = $1
       ORDER BY ia.adjustment_date DESC, ia.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/inventory-adjustments', authenticate, requireModuleLicense('mod_inventory'), requirePermission('inventory', 'edit'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const lineItems = Array.isArray(req.body.items) && req.body.items.length > 0
      ? req.body.items
      : (req.body.product_id ? [{
          product_id: req.body.product_id,
          physical_stock: req.body.physical_stock,
          system_stock: req.body.system_stock,
          unit_cost: req.body.unit_cost,
          batch_number: req.body.batch_number
        }] : []);
    const adj = await inventoryValuationService.executeStockAdjustment({
      tenantId: tid,
      warehouseId: req.body.warehouse_id,
      adjustmentDate: req.body.adjustment_date,
      adjustmentNumber: req.body.adjustment_number,
      adjustmentType: req.body.adjustment_type || 'Physical Count Audit',
      remarks: req.body.remarks,
      items: lineItems,
      userId: req.user?.id || null
    });
    res.status(201).json({ success: true, message: `Stock Adjustment ${adj.adjustment_number} posted.`, data: adj });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 5. MODULE 5: CUSTOMER RESOURCE MANAGEMENT (CRM)
// ============================================================================
router.get('/crm/leads', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const result = await db.query(
      `SELECT l.*,
              bp.business_name as business_profile_name,
              (SELECT COUNT(*) FROM crm_activities a WHERE a.lead_id = l.id) as activity_count
       FROM crm_leads l
       LEFT JOIN business_profiles bp ON l.business_profile_id = bp.id
       WHERE l.tenant_id = $1
       ORDER BY l.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/crm/leads', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const bpId = await getEffectiveBusinessProfileId(req, tid, req.body.business_profile_id);
    const {
      lead_source, company_name, contact_name, contact_email,
      contact_phone, department, city, pipeline_stage,
      win_probability, estimated_deal_value, notes
    } = req.body;

    const leadCode = req.body.lead_code || `LD-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const result = await db.query(
      `INSERT INTO crm_leads (
        tenant_id, business_profile_id, lead_code, lead_source,
        company_name, contact_name, contact_email, contact_phone,
        department, city, pipeline_stage, win_probability, estimated_deal_value, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        tid, bpId, leadCode, lead_source || 'Direct Inquiry',
        company_name, contact_name || '', contact_email || '', contact_phone || '',
        department || 'Procurement Dept', city || 'Lahore',
        pipeline_stage || 'New Lead', parseInt(win_probability || 30, 10),
        parseFloat(estimated_deal_value || 0), notes || ''
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/crm/leads/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const { pipeline_stage, win_probability, estimated_deal_value, notes, contact_name, contact_phone, company_name } = req.body;
    const result = await db.query(
      `UPDATE crm_leads
       SET pipeline_stage = COALESCE($1, pipeline_stage),
           win_probability = COALESCE($2, win_probability),
           estimated_deal_value = COALESCE($3, estimated_deal_value),
           notes = COALESCE($4, notes),
           contact_name = COALESCE($5, contact_name),
           contact_phone = COALESCE($6, contact_phone),
           company_name = COALESCE($7, company_name),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 AND tenant_id = $9
       RETURNING *`,
      [pipeline_stage, win_probability, estimated_deal_value, notes, contact_name, contact_phone, company_name, req.params.id, tid]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// 1-Click Convert CRM Lead into Shared Customer Master Record
router.post('/crm/leads/:id/convert', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const leadRes = await db.query(`SELECT * FROM crm_leads WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (leadRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Lead not found.' });
    }
    const lead = leadRes.rows[0];

    const custRes = await db.query(
      `INSERT INTO customers (
        tenant_id, business_name, customer_type, org_type,
        contact_person, email, phone, city, address
      ) VALUES ($1,$2,'Private Commercial','Private Commercial',$3,$4,$5,$6,$7)
      RETURNING *`,
      [
        tid, lead.company_name, lead.contact_name || '',
        lead.contact_email || '', lead.contact_phone || '',
        lead.city || 'Lahore', `${lead.department ? lead.department + ', ' : ''}${lead.city || 'Pakistan'}`
      ]
    );
    const newCustomer = custRes.rows[0];

    await db.query(
      `UPDATE crm_leads SET pipeline_stage = 'Won', win_probability = 100, converted_customer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newCustomer.id, lead.id]
    );

    res.json({
      success: true,
      message: `Lead "${lead.company_name}" converted to Customer Directory!`,
      data: newCustomer
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/crm/activities', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const result = await db.query(
      `SELECT a.*, l.company_name as lead_company_name, c.business_name as customer_name
       FROM crm_activities a
       LEFT JOIN crm_leads l ON a.lead_id = l.id
       LEFT JOIN customers c ON a.customer_id = c.id
       WHERE a.tenant_id = $1
       ORDER BY a.scheduled_at DESC, a.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/crm/activities', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const { lead_id, customer_id, activity_type, subject, scheduled_at, status, outcome } = req.body;
    const result = await db.query(
      `INSERT INTO crm_activities (tenant_id, lead_id, customer_id, activity_type, subject, scheduled_at, status, outcome)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tid, lead_id || null, customer_id || null, activity_type || 'Phone Call', subject, scheduled_at || new Date().toISOString().split('T')[0], status || 'Completed', outcome || '']
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 6. MODULE 6: FINANCIAL ACCOUNTING, COA & DOUBLE-ENTRY GENERAL LEDGER
// ============================================================================
router.get('/finance/coa', authenticate, requireModuleLicense('mod_finance'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const result = await db.query(
      `SELECT a.*,
              COALESCE((SELECT SUM(jl.debit) FROM journal_entry_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id WHERE jl.account_id = a.id AND je.tenant_id = $1), 0) as total_debit,
              COALESCE((SELECT SUM(jl.credit) FROM journal_entry_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id WHERE jl.account_id = a.id AND je.tenant_id = $1), 0) as total_credit
       FROM coa_accounts a
       WHERE a.tenant_id = $1
       ORDER BY a.account_code ASC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/finance/coa', authenticate, requireModuleLicense('mod_finance'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const { account_code, account_name, account_type, account_sub_type, opening_balance, is_reconcilable } = req.body;
    const result = await db.query(
      `INSERT INTO coa_accounts (tenant_id, account_code, account_name, account_type, account_sub_type, opening_balance, is_reconcilable)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, account_code) DO UPDATE
       SET account_name = EXCLUDED.account_name, account_type = EXCLUDED.account_type
       RETURNING *`,
      [tid, account_code, account_name, account_type || 'Asset', account_sub_type || 'Current Asset', parseFloat(opening_balance || 0), Boolean(is_reconcilable)]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/finance/journals', authenticate, requireModuleLicense('mod_finance'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const result = await db.query(
      `SELECT je.*,
              bp.business_name as business_profile_name,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', jl.id,
                  'account_id', jl.account_id,
                  'account_code', a.account_code,
                  'account_name', a.account_name,
                  'line_description', jl.line_description,
                  'debit', jl.debit,
                  'credit', jl.credit
                ))
                FROM journal_entry_lines jl
                LEFT JOIN coa_accounts a ON jl.account_id = a.id
                WHERE jl.journal_entry_id = je.id), '[]'::json
              ) as lines
       FROM journal_entries je
       LEFT JOIN business_profiles bp ON je.business_profile_id = bp.id
       WHERE je.tenant_id = $1
       ORDER BY je.entry_date DESC, je.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/finance/journals', authenticate, requireModuleLicense('mod_finance'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await getEffectiveTenantId(req);
    const bpId = await getEffectiveBusinessProfileId(req, tid, req.body.business_profile_id);
    const { entry_date, reference_type, narration, lines = [] } = req.body;

    let totalDebit = 0;
    let totalCredit = 0;
    for (const l of lines) {
      totalDebit += parseFloat(l.debit || 0);
      totalCredit += parseFloat(l.credit || 0);
    }

    if (lines.length < 2 || Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit <= 0) {
      throw new Error(`Double-entry journal voucher must be balanced (Total Debit ${totalDebit} != Total Credit ${totalCredit}).`);
    }

    const entryNo = req.body.entry_number || `JV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const jeRes = await client.query(
      `INSERT INTO journal_entries (tenant_id, business_profile_id, entry_number, entry_date, reference_type, narration, total_debit, total_credit, is_posted)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE) RETURNING *`,
      [tid, bpId, entryNo, entry_date || new Date().toISOString().split('T')[0], reference_type || 'Manual Voucher', narration, totalDebit, totalCredit]
    );
    const je = jeRes.rows[0];

    for (const l of lines) {
      await client.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit)
         VALUES ($1,$2,$3,$4,$5)`,
        [je.id, l.account_id, l.line_description || narration, parseFloat(l.debit || 0), parseFloat(l.credit || 0)]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, message: `Journal Voucher ${entryNo} posted to General Ledger.`, data: je });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// 1-Click Auto-Sync Invoices, Payments & Expenses into Double-Entry General Ledger
router.post('/finance/sync-ledger', authenticate, requireModuleLicense('mod_finance'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await getEffectiveTenantId(req);
    const bpId = await getEffectiveBusinessProfileId(req, tid, req.body.business_profile_id);

    const coaRes = await client.query(`SELECT id, account_code FROM coa_accounts WHERE tenant_id = $1`, [tid]);
    const accMap = {};
    coaRes.rows.forEach(r => { accMap[r.account_code] = r.id; });

    let syncedCount = 0;

    // 1. Sync Sales Invoices (Debit AR 1200, Credit Revenue 4001, Credit GST Output 2100)
    if (accMap['1200'] && accMap['4001'] && accMap['2100']) {
      const invs = await client.query(
        `SELECT i.* FROM invoices i
         WHERE i.tenant_id = $1
           AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.tenant_id = $1 AND je.reference_id = i.id AND je.reference_type = 'Sales Invoice')`,
        [tid]
      );
      for (const inv of invs.rows) {
        const total = parseFloat(inv.total_amount || 0);
        const gst = parseFloat(inv.gst_amount || 0);
        const sub = total - gst;
        if (total <= 0) continue;

        const jeRes = await client.query(
          `INSERT INTO journal_entries (tenant_id, business_profile_id, entry_number, entry_date, reference_type, reference_id, narration, total_debit, total_credit)
           VALUES ($1,$2,$3,$4,'Sales Invoice',$5,$6,$7,$7) RETURNING id`,
          [tid, inv.business_profile_id || bpId, `JV-INV-${inv.invoice_number}`, inv.invoice_date || new Date(), inv.id, `Sales Invoice ${inv.invoice_number} issued`, total]
        );
        const jeId = jeRes.rows[0].id;
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,$4,0)`,
          [jeId, accMap['1200'], `AR Receivable - ${inv.invoice_number}`, total]
        );
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,0,$4)`,
          [jeId, accMap['4001'], `Sales Revenue - ${inv.invoice_number}`, sub]
        );
        if (gst > 0) {
          await client.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,0,$4)`,
            [jeId, accMap['2100'], `GST Output Tax - ${inv.invoice_number}`, gst]
          );
        }
        syncedCount++;
      }
    }

    // 2. Sync Payments Received (Debit Bank 1010, Debit WHT Asset 1400, Credit AR 1200)
    if (accMap['1010'] && accMap['1200']) {
      const pays = await client.query(
        `SELECT p.* FROM payments p
         WHERE p.tenant_id = $1
           AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.tenant_id = $1 AND je.reference_id = p.id AND je.reference_type = 'Payment Received')`,
        [tid]
      );
      for (const p of pays.rows) {
        const netAmt = parseFloat(p.amount_received || 0);
        const whtAmt = parseFloat(p.wht_deducted || 0);
        const grossAmt = netAmt + whtAmt;
        if (grossAmt <= 0) continue;

        const jeRes = await client.query(
          `INSERT INTO journal_entries (tenant_id, business_profile_id, entry_number, entry_date, reference_type, reference_id, narration, total_debit, total_credit)
           VALUES ($1,$2,$3,$4,'Payment Received',$5,$6,$7,$7) RETURNING id`,
          [tid, p.business_profile_id || bpId, `JV-PAY-${p.id.slice(0, 6).toUpperCase()}`, p.payment_date || new Date(), p.id, `Payment received (${p.payment_method || 'Bank'})`, grossAmt]
        );
        const jeId = jeRes.rows[0].id;
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,$4,0)`,
          [jeId, accMap['1010'], `Bank Deposit (${p.cheque_number || 'Transfer'})`, netAmt]
        );
        if (whtAmt > 0 && accMap['1400']) {
          await client.query(
            `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,$4,0)`,
            [jeId, accMap['1400'], `WHT Deducted at Source u/s 153`, whtAmt]
          );
        }
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,0,$4)`,
          [jeId, accMap['1200'], `Customer AR Settlement`, grossAmt]
        );
        syncedCount++;
      }
    }

    // 3. Sync General Expenses (Debit Expense 5400, Credit Cash/Bank 1010)
    if (accMap['5400'] && accMap['1010']) {
      const exps = await client.query(
        `SELECT e.* FROM general_expenses e
         WHERE e.tenant_id = $1
           AND NOT EXISTS (SELECT 1 FROM journal_entries je WHERE je.tenant_id = $1 AND je.reference_id = e.id AND je.reference_type = 'Expense Voucher')`,
        [tid]
      );
      for (const e of exps.rows) {
        const amt = parseFloat(e.amount || 0);
        if (amt <= 0) continue;
        const expAcc = (e.category && e.category.toLowerCase().includes('tender')) ? (accMap['5200'] || accMap['5400']) : accMap['5400'];

        const jeRes = await client.query(
          `INSERT INTO journal_entries (tenant_id, business_profile_id, entry_number, entry_date, reference_type, reference_id, narration, total_debit, total_credit)
           VALUES ($1,$2,$3,$4,'Expense Voucher',$5,$6,$7,$7) RETURNING id`,
          [tid, e.business_profile_id || bpId, `JV-EXP-${e.id.slice(0, 6).toUpperCase()}`, e.expense_date || new Date(), e.id, `Expense: ${e.title || e.category}`, amt]
        );
        const jeId = jeRes.rows[0].id;
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,$4,0)`,
          [jeId, expAcc, `${e.category}: ${e.title}`, amt]
        );
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,0,$4)`,
          [jeId, accMap['1010'], `Paid via ${e.payment_mode || 'Bank'}`, amt]
        );
        syncedCount++;
      }
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: syncedCount > 0
        ? `Successfully synchronized ${syncedCount} commercial transactions into the General Ledger!`
        : 'All Invoices, Payments, and Expenses are already synchronized with the General Ledger.',
      synced_count: syncedCount
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 7. MODULE 7: CORE HRM (Delegated to Enterprise hrm.routes.js controller)
// ============================================================================
router.use('/hrm', require('./hrm.routes'));

// ============================================================================
// 8. MODULE 8: PAYROLL & PAKISTAN SECTION 149 SALARY TAX ENGINE
// ============================================================================
router.post('/payroll/calculate-tax', authenticate, requireModuleLicense('mod_payroll'), (req, res) => {
  const calc = calculatePakistanSalaryTax(req.body.monthly_gross || 0);
  res.json({ success: true, data: calc });
});

router.get('/payroll/runs', authenticate, requireModuleLicense('mod_payroll'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const result = await db.query(
      `SELECT pr.*,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', pp.id,
                  'employee_id', pp.employee_id,
                  'employee_code', e.employee_code,
                  'employee_name', CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')),
                  'designation', e.designation_name,
                  'bank_name', e.bank_name,
                  'bank_iban', e.bank_iban,
                  'basic_salary', pp.basic_salary,
                  'total_allowances', pp.total_allowances,
                  'gross_salary', pp.gross_salary,
                  'income_tax_deduction', pp.income_tax_deduction,
                  'eobi_employee_deduction', pp.eobi_employee_deduction,
                  'total_deductions', pp.total_deductions,
                  'net_salary', pp.net_salary,
                  'is_paid', pp.is_paid
                ))
                FROM payroll_payslips pp
                LEFT JOIN hrm_employees e ON pp.employee_id = e.id
                WHERE pp.payroll_run_id = pr.id), '[]'::json
              ) as payslips
       FROM payroll_runs pr
       WHERE pr.tenant_id = $1
       ORDER BY pr.payroll_year DESC, pr.payroll_month DESC, pr.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/payroll/runs', authenticate, requireModuleLicense('mod_payroll'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await getEffectiveTenantId(req);
    const bpId = await getEffectiveBusinessProfileId(req, tid, req.body.business_profile_id);
    const payrollMonth = parseInt(req.body.payroll_month || (new Date().getMonth() + 1), 10);
    const payrollYear = parseInt(req.body.payroll_year || new Date().getFullYear(), 10);

    const empsRes = await client.query(
      `SELECT e.*, ps.basic_salary as struct_basic, ps.gross_salary as struct_gross, ps.eobi_enabled
       FROM hrm_employees e
       LEFT JOIN payroll_salary_structures ps ON ps.employee_id = e.id
       WHERE e.tenant_id = $1 AND e.employment_status = 'Active'`,
      [tid]
    );

    if (empsRes.rows.length === 0) {
      throw new Error('No active employees found in HRM directory. Please add employees before generating payroll.');
    }

    let totalGross = 0;
    let totalTax = 0;
    let totalEobi = 0;
    let totalDed = 0;
    let totalNet = 0;

    const slipsToInsert = [];
    for (const emp of empsRes.rows) {
      const gross = parseFloat(emp.struct_gross || emp.gross_salary || 0);
      const basic = parseFloat(emp.struct_basic || emp.basic_salary || Math.round(gross * 0.6));
      const allowances = Math.max(0, gross - basic);
      const taxCalc = calculatePakistanSalaryTax(gross);
      const incomeTax = taxCalc.monthly_tax;
      const eobiEmp = emp.eobi_enabled !== false ? 370 : 0; // Standard EOBI employee share PKR 370
      const eobiEmployer = emp.eobi_enabled !== false ? 1850 : 0;
      const ded = incomeTax + eobiEmp;
      const net = Math.max(0, gross - ded);

      totalGross += gross;
      totalTax += incomeTax;
      totalEobi += eobiEmp;
      totalDed += ded;
      totalNet += net;

      slipsToInsert.push({
        employee_id: emp.id,
        basic,
        allowances,
        gross,
        incomeTax,
        eobiEmp,
        eobiEmployer,
        ded,
        net
      });
    }

    const runRes = await client.query(
      `INSERT INTO payroll_runs (
        tenant_id, business_profile_id, payroll_month, payroll_year,
        total_employees, total_gross, total_tax_deducted, total_eobi_deducted,
        total_deductions, total_net_payable, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Disbursed') RETURNING *`,
      [tid, bpId, payrollMonth, payrollYear, slipsToInsert.length, totalGross, totalTax, totalEobi, totalDed, totalNet]
    );
    const run = runRes.rows[0];

    for (const s of slipsToInsert) {
      await client.query(
        `INSERT INTO payroll_payslips (
          payroll_run_id, employee_id, basic_salary, total_allowances,
          gross_salary, income_tax_deduction, eobi_employee_deduction,
          eobi_employer_contribution, total_deductions, net_salary, is_paid
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE)`,
        [run.id, s.employee_id, s.basic, s.allowances, s.gross, s.incomeTax, s.eobiEmp, s.eobiEmployer, s.ded, s.net]
      );
    }

    // Auto-post Payroll Voucher to General Ledger (Module 6)
    const coaRes = await client.query(`SELECT id, account_code FROM coa_accounts WHERE tenant_id = $1`, [tid]);
    const accMap = {};
    coaRes.rows.forEach(r => { accMap[r.account_code] = r.id; });

    if (accMap['5100'] && accMap['1010'] && totalGross > 0) {
      const jeRes = await client.query(
        `INSERT INTO journal_entries (tenant_id, business_profile_id, entry_number, entry_date, reference_type, reference_id, narration, total_debit, total_credit)
         VALUES ($1,$2,$3,CURRENT_DATE,'Payroll Run',$4,$5,$6,$6) RETURNING id`,
        [tid, bpId, `JV-PAYROLL-${payrollYear}-${String(payrollMonth).padStart(2, '0')}`, run.id, `Monthly Salary Payroll (${payrollMonth}/${payrollYear}) for ${slipsToInsert.length} staff`, totalGross]
      );
      const jeId = jeRes.rows[0].id;
      await client.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,$4,0)`,
        [jeId, accMap['5100'], `Gross Salaries & Allowances (${payrollMonth}/${payrollYear})`, totalGross]
      );
      if (totalTax > 0 && accMap['2150']) {
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,0,$4)`,
          [jeId, accMap['2150'], `FBR Section 149 Salary WHT Deducted`, totalTax]
        );
      }
      if (totalEobi > 0 && accMap['2200']) {
        await client.query(
          `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,0,$4)`,
          [jeId, accMap['2200'], `EOBI Employee Contribution Payable`, totalEobi]
        );
      }
      await client.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit) VALUES ($1,$2,$3,0,$4)`,
        [jeId, accMap['1010'], `Net Salary Bank Transfer Disbursement`, totalNet]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: `Payroll for ${payrollMonth}/${payrollYear} processed for ${slipsToInsert.length} employees & posted to General Ledger!`,
      data: run
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 9. MODULE 9: MANUFACTURING ERP (Bill of Materials & Production Work Orders)
// ============================================================================
router.get('/mfg/boms', authenticate, requireModuleLicense('mod_manufacturing'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const result = await db.query(
      `SELECT b.*, p.name as finished_product_name, p.sku as finished_sku, p.unit as finished_unit,
              COALESCE(
                (SELECT json_agg(json_build_object(
                  'id', bi.id,
                  'raw_material_product_id', bi.raw_material_product_id,
                  'raw_material_name', rp.name,
                  'raw_material_sku', rp.sku,
                  'required_quantity', bi.required_quantity,
                  'scrap_allowance_pct', bi.scrap_allowance_pct,
                  'unit_cost', bi.unit_cost,
                  'total_cost', bi.total_cost
                ))
                FROM mfg_bom_items bi
                LEFT JOIN products_services rp ON bi.raw_material_product_id = rp.id
                WHERE bi.bom_id = b.id), '[]'::json
              ) as components
       FROM mfg_boms b
       LEFT JOIN products_services p ON b.finished_product_id = p.id
       WHERE b.tenant_id = $1
       ORDER BY b.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/mfg/boms', authenticate, requireModuleLicense('mod_manufacturing'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await getEffectiveTenantId(req);
    const {
      bom_code, bom_name, finished_product_id, output_quantity,
      labor_cost_estimate, overhead_cost_estimate, components = []
    } = req.body;

    if (!finished_product_id) throw new Error('Finished product SKU is required for BOM.');

    let matCost = 0;
    for (const c of components) {
      const q = parseFloat(c.required_quantity || 0);
      const u = parseFloat(c.unit_cost || 0);
      const scrap = parseFloat(c.scrap_allowance_pct || 0);
      matCost += q * u * (1 + scrap / 100);
    }
    const labor = parseFloat(labor_cost_estimate || 0);
    const overhead = parseFloat(overhead_cost_estimate || 0);
    const outQty = Math.max(1, parseFloat(output_quantity || 1));
    const totalUnitCost = (matCost + labor + overhead) / outQty;
    const code = bom_code || `BOM-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

    const bomRes = await client.query(
      `INSERT INTO mfg_boms (
        tenant_id, bom_code, bom_name, finished_product_id, output_quantity,
        labor_cost_estimate, overhead_cost_estimate, material_cost_estimate, total_estimated_unit_cost
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, code, bom_name || code, finished_product_id, outQty, labor, overhead, matCost, totalUnitCost]
    );
    const bom = bomRes.rows[0];

    for (const c of components) {
      if (!c.raw_material_product_id) continue;
      const q = parseFloat(c.required_quantity || 1);
      const u = parseFloat(c.unit_cost || 0);
      const scrap = parseFloat(c.scrap_allowance_pct || 0);
      const lineTotal = q * u * (1 + scrap / 100);
      await client.query(
        `INSERT INTO mfg_bom_items (bom_id, raw_material_product_id, required_quantity, scrap_allowance_pct, unit_cost, total_cost)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [bom.id, c.raw_material_product_id, q, scrap, u, lineTotal]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: bom });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get('/mfg/work-orders', authenticate, requireModuleLicense('mod_manufacturing'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const result = await db.query(
      `SELECT wo.*,
              b.bom_code, b.bom_name,
              p.name as target_product_name, p.sku as target_sku,
              rw.warehouse_name as raw_warehouse_name,
              fw.warehouse_name as finished_warehouse_name,
              o.opportunity_number
       FROM mfg_work_orders wo
       LEFT JOIN mfg_boms b ON wo.bom_id = b.id
       LEFT JOIN products_services p ON wo.target_product_id = p.id
       LEFT JOIN warehouses rw ON wo.raw_materials_warehouse_id = rw.id
       LEFT JOIN warehouses fw ON wo.finished_goods_warehouse_id = fw.id
       LEFT JOIN opportunities o ON wo.opportunity_id = o.id
       WHERE wo.tenant_id = $1
       ORDER BY wo.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/mfg/work-orders', authenticate, requireModuleLicense('mod_manufacturing'), async (req, res) => {
  try {
    const tid = await getEffectiveTenantId(req);
    const bpId = await getEffectiveBusinessProfileId(req, tid, req.body.business_profile_id);
    const {
      bom_id, target_quantity, raw_materials_warehouse_id,
      finished_goods_warehouse_id, start_date, due_date, opportunity_id, notes
    } = req.body;

    const bomRes = await db.query(`SELECT * FROM mfg_boms WHERE id = $1 AND tenant_id = $2`, [bom_id, tid]);
    if (bomRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Selected BOM not found.' });
    }
    const bom = bomRes.rows[0];
    const qty = Math.max(1, parseFloat(target_quantity || 1));
    const matCost = parseFloat(bom.material_cost_estimate || 0) * qty;
    const labCost = parseFloat(bom.labor_cost_estimate || 0) * qty;
    const ovhCost = parseFloat(bom.overhead_cost_estimate || 0) * qty;
    const totalCost = matCost + labCost + ovhCost;
    const woNo = req.body.order_number || `WO-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const result = await db.query(
      `INSERT INTO mfg_work_orders (
        tenant_id, business_profile_id, order_number, bom_id, target_product_id,
        target_quantity, raw_materials_warehouse_id, finished_goods_warehouse_id,
        start_date, due_date, status, opportunity_id,
        actual_material_cost, actual_labor_cost, actual_overhead_cost, total_production_cost, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'In Production',$11,$12,$13,$14,$15,$16)
      RETURNING *`,
      [
        tid, bpId, woNo, bom.id, bom.finished_product_id,
        qty, raw_materials_warehouse_id || null, finished_goods_warehouse_id || null,
        start_date || new Date().toISOString().split('T')[0],
        due_date || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
        opportunity_id || null,
        matCost, labCost, ovhCost, totalCost, notes || ''
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Complete Production Work Order -> Consume Raw Materials & Receive Finished Goods in Inventory
router.post('/mfg/work-orders/:id/complete', authenticate, requireModuleLicense('mod_manufacturing'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await getEffectiveTenantId(req);
    const woRes = await client.query(`SELECT * FROM mfg_work_orders WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (woRes.rows.length === 0) throw new Error('Work Order not found.');
    const wo = woRes.rows[0];

    if (wo.status === 'Completed') {
      throw new Error('This Work Order is already marked Completed.');
    }

    const producedQty = parseFloat(req.body.produced_quantity || wo.target_quantity || 1);
    const unitProdCost = producedQty > 0 ? (parseFloat(wo.total_production_cost || 0) / producedQty) : 0;

    // 1. Deduct BOM raw materials from raw_materials_warehouse_id
    if (wo.raw_materials_warehouse_id) {
      const bomItems = await client.query(`SELECT * FROM mfg_bom_items WHERE bom_id = $1`, [wo.bom_id]);
      for (const bi of bomItems.rows) {
        const reqQty = parseFloat(bi.required_quantity || 1) * producedQty;
        await client.query(
          `INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, batch_number, quantity_on_hand)
           VALUES ($1,$2,$3,'STANDARD',-$4)
           ON CONFLICT (warehouse_id, product_id, batch_number)
           DO UPDATE SET quantity_on_hand = warehouse_stock.quantity_on_hand - $4, updated_at = CURRENT_TIMESTAMP`,
          [tid, wo.raw_materials_warehouse_id, bi.raw_material_product_id, reqQty]
        );
        await client.query(
          `INSERT INTO inventory_transactions (tenant_id, warehouse_id, product_id, transaction_type, quantity, unit_cost, batch_number, reference_number, remarks)
           VALUES ($1,$2,$3,'OUT',$4,$5,'STANDARD',$6,$7)`,
          [tid, wo.raw_materials_warehouse_id, bi.raw_material_product_id, reqQty, parseFloat(bi.unit_cost || 0), wo.order_number, `Raw Material Consumed in Work Order ${wo.order_number}`]
        );
      }
    }

    // 2. Receive finished goods into finished_goods_warehouse_id
    if (wo.finished_goods_warehouse_id) {
      await client.query(
        `INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, batch_number, quantity_on_hand)
         VALUES ($1,$2,$3,'STANDARD',$4)
         ON CONFLICT (warehouse_id, product_id, batch_number)
         DO UPDATE SET quantity_on_hand = warehouse_stock.quantity_on_hand + $4, updated_at = CURRENT_TIMESTAMP`,
        [tid, wo.finished_goods_warehouse_id, wo.target_product_id, producedQty]
      );
      await client.query(
        `INSERT INTO inventory_transactions (tenant_id, warehouse_id, product_id, transaction_type, quantity, unit_cost, batch_number, reference_number, remarks)
         VALUES ($1,$2,$3,'IN',$4,$5,'STANDARD',$6,$7)`,
        [tid, wo.finished_goods_warehouse_id, wo.target_product_id, producedQty, unitProdCost, wo.order_number, `Finished Goods Manufactured (${wo.order_number})`]
      );
    }

    const updated = await client.query(
      `UPDATE mfg_work_orders
       SET status = 'Completed', produced_quantity = $1, completed_date = CURRENT_DATE
       WHERE id = $2 RETURNING *`,
      [producedQty, wo.id]
    );

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `Work Order ${wo.order_number} completed! ${producedQty} units added to Finished Goods Inventory.`,
      data: updated.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 10. MODULE 10: TAXATION & REGULATORY COMPLIANCE (Delegated to taxCompliance.routes.js)
// ============================================================================
router.use('/tax', require('./taxCompliance.routes'));

module.exports = router;

