/**
 * ============================================================================
 * MASHRUE TAXGUARD ENTERPRISE REST CONTROLLER (routes/taxCompliance.routes.js)
 * Mounted at: /api/tax-compliance and /api/erp/tax
 * Module License: 'mod_tax_compliance'
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireModuleLicense, requirePermission, resolveTenantId } = require('../middleware/rbac.middleware');
const taxComplianceService = require('../services/taxComplianceService');

const taxAuth = [authenticate, requireModuleLicense('mod_tax_compliance')];

// Jurisdictions CRUD
router.get('/jurisdictions', ...taxAuth, requirePermission('tax_compliance', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    await taxComplianceService.ensureDefaults(null, tid);
    const result = await db.query(`SELECT * FROM tax_jurisdictions WHERE tenant_id = $1 ORDER BY jurisdiction_code ASC`, [tid]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/jurisdictions', ...taxAuth, requirePermission('tax_compliance', 'edit'), async (req, res) => {
  const { jurisdiction_code, authority_name, tax_type, standard_rate, further_tax_rate, reduced_rate } = req.body;
  if (!jurisdiction_code || !authority_name) return res.status(400).json({ success: false, message: 'Code and authority name required.' });
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `INSERT INTO tax_jurisdictions (tenant_id, jurisdiction_code, authority_name, tax_type, standard_rate, further_tax_rate, reduced_rate, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
       ON CONFLICT (tenant_id, jurisdiction_code) DO UPDATE SET
         authority_name = EXCLUDED.authority_name,
         standard_rate = EXCLUDED.standard_rate,
         further_tax_rate = EXCLUDED.further_tax_rate,
         reduced_rate = EXCLUDED.reduced_rate
       RETURNING *`,
      [tid, jurisdiction_code.trim().toUpperCase(), authority_name, tax_type || 'Sales Tax', parseFloat(standard_rate || 18), parseFloat(further_tax_rate || 0), parseFloat(reduced_rate || 0)]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put('/jurisdictions/:id', ...taxAuth, requirePermission('tax_compliance', 'edit'), async (req, res) => {
  const { standard_rate, further_tax_rate, reduced_rate, is_active } = req.body;
  try {
    const tid = await resolveTenantId(req, db);
    const result = await db.query(
      `UPDATE tax_jurisdictions
       SET standard_rate = COALESCE($1, standard_rate),
           further_tax_rate = COALESCE($2, further_tax_rate),
           reduced_rate = COALESCE($3, reduced_rate),
           is_active = COALESCE($4, is_active)
       WHERE id = $5 AND tenant_id = $6 RETURNING *`,
      [standard_rate, further_tax_rate, reduced_rate, is_active, req.params.id, tid]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Withholding Tax Rules (GET supporting both /withholding-rules and /wht-rules alias)
const listWhtRules = async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    await taxComplianceService.ensureDefaults(null, tid);
    const result = await db.query(`SELECT * FROM tax_withholding_rules WHERE tenant_id = $1 ORDER BY section_code ASC`, [tid]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
router.get('/withholding-rules', ...taxAuth, requirePermission('tax_compliance', 'view'), listWhtRules);
router.get('/wht-rules', ...taxAuth, requirePermission('tax_compliance', 'view'), listWhtRules);

router.put('/withholding-rules/:id', ...taxAuth, requirePermission('tax_compliance', 'edit'), async (req, res) => {
  const { filer_rate, non_filer_rate, threshold_amount, is_active } = req.body;
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `UPDATE tax_withholding_rules
       SET filer_rate = COALESCE($1, filer_rate),
           non_filer_rate = COALESCE($2, non_filer_rate),
           threshold_amount = COALESCE($3, threshold_amount),
           is_active = COALESCE($4, is_active)
       WHERE id = $5 AND tenant_id = $6 RETURNING *`,
      [filer_rate, non_filer_rate, threshold_amount, is_active, req.params.id, tid]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// WHT Deductions & CPR Ledger (supporting both /withholding-deductions and /cpr-deductions aliases)
const listCprs = async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const result = await db.query(
      `SELECT d.*, i.invoice_number, c.business_name as customer_name, c.ntn as customer_ntn
       FROM tax_withholding_deductions d
       LEFT JOIN invoices i ON d.invoice_id = i.id
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE d.tenant_id = $1
       ORDER BY COALESCE(d.cpr_date, d.created_at::date) DESC, d.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
router.get('/withholding-deductions', ...taxAuth, requirePermission('tax_compliance', 'view'), listCprs);
router.get('/cpr-deductions', ...taxAuth, requirePermission('tax_compliance', 'view'), listCprs);

const createCpr = async (req, res) => {
  const {
    business_profile_id, transaction_type, party_name, party_ntn, invoice_id, payment_id,
    vendor_expense_id, section_code, taxable_amount, wht_rate, wht_amount,
    cpr_number, cpr_date, cpr_certificate_url, status
  } = req.body;
  try {
    const tid = await resolveTenantId(req, db);
    const taxable = parseFloat(taxable_amount || 0);
    const rate = parseFloat(wht_rate || 5.0);
    const amount = wht_amount !== undefined ? parseFloat(wht_amount) : Number(((taxable * rate) / 100).toFixed(2));
    const cprNo = cpr_number || `CPR-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

    const result = await db.query(
      `INSERT INTO tax_withholding_deductions
       (tenant_id, business_profile_id, transaction_type, party_name, party_ntn, invoice_id, payment_id, vendor_expense_id, section_code, taxable_amount, wht_rate, wht_amount, cpr_number, cpr_date, cpr_certificate_url, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [
        tid, business_profile_id || null, transaction_type || 'Deducted by Client on Our Invoice',
        party_name || '', party_ntn || '', invoice_id || null, payment_id || null, vendor_expense_id || null,
        section_code || '153(1)(a) Goods', taxable, rate, amount, cprNo,
        cpr_date || new Date().toISOString().slice(0, 10), cpr_certificate_url || '',
        status || (cpr_number ? 'Verified / CPR Attached' : 'Pending CPR')
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
router.post('/withholding-deductions', ...taxAuth, requirePermission('tax_compliance', 'add'), createCpr);
router.post('/cpr-deductions', ...taxAuth, requirePermission('tax_compliance', 'add'), createCpr);

const updateCpr = async (req, res) => {
  const { cpr_number, cpr_date, status, party_name, wht_amount } = req.body;
  try {
    const tid = await resolveTenantId(req, db);
    const result = await db.query(
      `UPDATE tax_withholding_deductions
       SET cpr_number = COALESCE($1, cpr_number),
           cpr_date = COALESCE($2, cpr_date),
           status = COALESCE($3, status),
           party_name = COALESCE($4, party_name),
           wht_amount = COALESCE($5, wht_amount)
       WHERE id = $6 AND tenant_id = $7 RETURNING *`,
      [cpr_number, cpr_date, status, party_name, wht_amount, req.params.id, tid]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'CPR record not found.' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
router.put('/withholding-deductions/:id', ...taxAuth, requirePermission('tax_compliance', 'edit'), updateCpr);
router.put('/cpr-deductions/:id', ...taxAuth, requirePermission('tax_compliance', 'edit'), updateCpr);

router.delete('/cpr-deductions/:id', ...taxAuth, requirePermission('tax_compliance', 'delete'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    await db.query(`DELETE FROM tax_withholding_deductions WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    res.json({ success: true, message: 'CPR record deleted.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Monthly Sales Tax Returns (Annex-C & Annex-A)
router.get('/returns', ...taxAuth, requirePermission('tax_compliance', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const result = await db.query(
      `SELECT * FROM tax_monthly_returns WHERE tenant_id = $1 ORDER BY tax_year DESC, tax_month DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const compileReturn = async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const ret = await taxComplianceService.compileMonthlyReturn(client, tid, {
      businessProfileId: req.body.business_profile_id || null,
      month: req.body.tax_month,
      year: req.body.tax_year,
      jurisdictionCode: req.body.jurisdiction_code || 'FBR_FED',
      amendIfFiled: Boolean(req.body.amend),
      userId: req.user?.id || null,
      userName: req.user?.full_name || req.user?.username || 'Tax Officer'
    });
    await client.query('COMMIT');
    res.status(201).json({
      success: true,
      message: `Compiled ${ret.jurisdiction_code} Return (${ret.tax_month}/${ret.tax_year}): ${(ret.annex_c_json || []).length} Annex-C Sales & ${(ret.annex_a_json || []).length} Annex-A Inputs.`,
      data: ret
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};
router.post('/returns/compile', ...taxAuth, requirePermission('tax_compliance', 'add'), compileReturn);
router.post('/returns/generate', ...taxAuth, requirePermission('tax_compliance', 'add'), compileReturn);

router.post('/returns/:id/file', ...taxAuth, requirePermission('tax_compliance', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const filed = await taxComplianceService.markReturnFiled(client, tid, req.params.id, {
      iris_acknowledgement_number: req.body.iris_acknowledgement_number,
      userId: req.user?.id || null,
      userName: req.user?.full_name || req.user?.username || 'Tax Officer'
    });
    await client.query('COMMIT');
    res.json({ success: true, data: filed, message: `Return ${filed.tax_month}/${filed.tax_year} marked Filed & Locked.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// STATL Bulk Verifier
router.post('/statl-bulk-verify', ...taxAuth, requirePermission('tax_compliance', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const report = await taxComplianceService.runStatlBulkVerify(tid);
    res.json({ success: true, ...report });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/audit-logs', ...taxAuth, requirePermission('tax_compliance', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(`SELECT * FROM tax_audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
