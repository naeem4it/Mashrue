/**
 * ============================================================================
 * MASHRUE PAYROLL MODULE — COMPLETE ENTERPRISE REST CONTROLLER
 * Mounted at: /api/payroll and /api/erp/payroll-suite
 * Module License: 'mod_payroll'
 * Works 100% Standalone without HRM or Finance; integrates when licensed & enabled
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireModuleLicense, requirePermission, resolveTenantId } = require('../middleware/rbac.middleware');
const payrollService = require('../services/payrollService');

const payAuth = [authenticate, requireModuleLicense('mod_payroll')];

function round2(n) {
  const v = Number(n || 0);
  return isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}

// ============================================================================
// 1. PAYROLL DASHBOARD & INTEGRATION TELEMETRY
// ============================================================================
router.get('/dashboard', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const settings = await payrollService.getSettings(null, tid);
    const [hrmAvail, finAvail] = await Promise.all([
      payrollService.isModuleLicensed(null, tid, 'mod_hrm'),
      payrollService.isModuleLicensed(null, tid, 'mod_finance')
    ]);

    const [empCnt, runRes, loanRes, periodRes, recentRuns] = await Promise.all([
      db.query(`SELECT COUNT(*) as cnt FROM payroll_employee_profiles WHERE tenant_id = $1 AND status = 'Active'`, [tid]),
      db.query(`SELECT COALESCE(SUM(total_gross),0) as ytd_gross, COALESCE(SUM(total_net_payable),0) as ytd_net, COALESCE(SUM(total_tax_deducted),0) as ytd_tax FROM payroll_runs WHERE tenant_id = $1 AND is_finalized = TRUE AND COALESCE(is_reversed, FALSE) = FALSE AND payroll_year = $2`, [tid, new Date().getFullYear()]),
      db.query(`SELECT COALESCE(SUM(remaining_balance),0) as open_loans, COUNT(*) as cnt FROM payroll_loans_advances WHERE tenant_id = $1 AND status IN ('Approved', 'Active')`, [tid]),
      db.query(`SELECT * FROM payroll_periods WHERE tenant_id = $1 ORDER BY period_year DESC, period_month DESC LIMIT 12`, [tid]),
      db.query(`SELECT * FROM payroll_runs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 8`, [tid])
    ]);

    res.json({
      success: true,
      data: {
        settings,
        integrations: {
          hrm_available: hrmAvail && settings.enable_hrm_integration !== false,
          finance_available: finAvail && settings.enable_finance_posting !== false
        },
        kpis: {
          active_employees: parseInt(empCnt.rows[0]?.cnt || 0, 10),
          ytd_gross: round2(runRes.rows[0]?.ytd_gross),
          ytd_net: round2(runRes.rows[0]?.ytd_net),
          ytd_tax: round2(runRes.rows[0]?.ytd_tax),
          open_loans_balance: round2(loanRes.rows[0]?.open_loans),
          open_loans_count: parseInt(loanRes.rows[0]?.cnt || 0, 10)
        },
        periods: periodRes.rows,
        recent_runs: recentRuns.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 2. SETTINGS, PERIODS, SALARY COMPONENTS & TAX RULES
// ============================================================================
router.get('/settings', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await payrollService.getSettings(null, tid);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/settings', ...payAuth, requirePermission('payroll', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    await payrollService.getSettings(null, tid);
    const allowed = [
      'default_currency', 'default_pay_frequency', 'run_prefix', 'payslip_prefix', 'batch_prefix',
      'working_days_per_month', 'overtime_multiplier', 'rounding_rule', 'default_tax_jurisdiction',
      'require_run_approval', 'enable_hrm_integration', 'enable_finance_posting'
    ];
    const sets = [];
    const params = [tid, req.user?.id || null];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        params.push(req.body[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return res.json({ success: true, data: await payrollService.getSettings(null, tid) });
    sets.push(`updated_by = $2`, `updated_at = NOW()`);
    const upd = await db.query(`UPDATE payroll_settings SET ${sets.join(', ')} WHERE tenant_id = $1 RETURNING *`, params);
    res.json({ success: true, data: upd.rows[0], message: 'Payroll configuration updated.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/periods', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(`SELECT * FROM payroll_periods WHERE tenant_id = $1 ORDER BY period_year DESC, period_month DESC`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/periods', ...payAuth, requirePermission('payroll', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { period_year, period_month, pay_frequency = 'Monthly', working_days = 30, pay_date } = req.body;
    const y = parseInt(period_year || new Date().getFullYear(), 10);
    const m = parseInt(period_month || (new Date().getMonth() + 1), 10);
    const sDate = new Date(Date.UTC(y, m - 1, 1)).toISOString().slice(0, 10);
    const eDate = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    const pName = new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

    const r = await db.query(
      `INSERT INTO payroll_periods (tenant_id, period_year, period_month, period_name, pay_frequency, start_date, end_date, pay_date, working_days)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, y, m, pName, pay_frequency, sDate, eDate, pay_date || eDate, parseInt(working_days, 10)]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/periods/:id/status', ...payAuth, requirePermission('payroll', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { status } = req.body;
    if (!['Open', 'Locked', 'Closed'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid period status.' });
    const r = await db.query(
      `UPDATE payroll_periods SET status = $1, closed_by = CASE WHEN $1 = 'Closed' THEN $2::uuid ELSE NULL END, closed_at = CASE WHEN $1 = 'Closed' THEN NOW() ELSE NULL END
       WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [status, req.user?.id || null, req.params.id, tid]
    );
    res.json({ success: true, data: r.rows[0], message: `Period status set to ${status}.` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/components', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    await payrollService.getSettings(null, tid);
    const r = await db.query(`SELECT * FROM payroll_components WHERE tenant_id = $1 ORDER BY component_type ASC, component_code ASC`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/components', ...payAuth, requirePermission('payroll', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { component_code, component_name, component_type, calc_type = 'Fixed', default_value = 0, is_taxable = true, is_statutory = false, coa_account_code } = req.body;
    const r = await db.query(
      `INSERT INTO payroll_components (tenant_id, component_code, component_name, component_type, calc_type, default_value, is_taxable, is_statutory, coa_account_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (tenant_id, component_code) DO UPDATE SET component_name = EXCLUDED.component_name, default_value = EXCLUDED.default_value, calc_type = EXCLUDED.calc_type, is_taxable = EXCLUDED.is_taxable
       RETURNING *`,
      [tid, component_code.trim().toUpperCase(), component_name.trim(), component_type, calc_type, parseFloat(default_value), Boolean(is_taxable), Boolean(is_statutory), coa_account_code || null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/tax-jurisdictions', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    await payrollService.getSettings(null, tid);
    const r = await db.query(
      `SELECT j.*,
              COALESCE((SELECT json_agg(s.* ORDER BY s.min_annual_income ASC) FROM payroll_tax_slabs s WHERE s.jurisdiction_id = j.id), '[]'::json) as slabs
       FROM payroll_tax_jurisdictions j WHERE j.tenant_id = $1 ORDER BY j.jurisdiction_code ASC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/tax-jurisdictions', ...payAuth, requirePermission('payroll', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const { jurisdiction_code, jurisdiction_name, country_code = 'ANY', currency = 'PKR', slabs = [] } = req.body;
    const jRes = await client.query(
      `INSERT INTO payroll_tax_jurisdictions (tenant_id, jurisdiction_code, jurisdiction_name, country_code, currency)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, jurisdiction_code) DO UPDATE SET jurisdiction_name = EXCLUDED.jurisdiction_name RETURNING *`,
      [tid, jurisdiction_code.trim().toUpperCase(), jurisdiction_name.trim(), country_code, currency]
    );
    const jur = jRes.rows[0];
    if (Array.isArray(slabs) && slabs.length > 0) {
      await client.query(`DELETE FROM payroll_tax_slabs WHERE jurisdiction_id = $1`, [jur.id]);
      for (const s of slabs) {
        await client.query(
          `INSERT INTO payroll_tax_slabs (tenant_id, jurisdiction_id, min_annual_income, max_annual_income, fixed_tax, rate_pct, excess_over)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tid, jur.id, parseFloat(s.min_annual_income || 0), s.max_annual_income !== null && s.max_annual_income !== '' ? parseFloat(s.max_annual_income) : null, parseFloat(s.fixed_tax || 0), parseFloat(s.rate_pct || 0), parseFloat(s.excess_over || 0)]
        );
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: jur });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/tax-calculate', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await payrollService.calculateJurisdictionTax(null, tid, req.body.monthly_gross || 0, req.body.jurisdiction_code || 'PK-FBR');
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 3. STANDALONE EMPLOYEE PAYROLL PROFILES & HRM SYNC
// ============================================================================
router.get('/employees', ...payAuth, requirePermission('payroll', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT *, (basic_salary + house_rent_allowance + medical_allowance + conveyance_allowance + other_allowances) as gross_salary
       FROM payroll_employee_profiles WHERE tenant_id = $1 ORDER BY employee_code ASC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/employees', ...payAuth, requirePermission('payroll', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const {
      employee_code, full_name, email, phone, national_tax_id, department, designation,
      hire_date, pay_frequency = 'Monthly', tax_jurisdiction_code = 'PK-FBR',
      basic_salary = 0, house_rent_allowance = 0, medical_allowance = 0, conveyance_allowance = 0, other_allowances = 0,
      payment_method = 'Bank Transfer', bank_name, bank_iban, tax_exempt = false, user_id = null
    } = req.body;
    if (!full_name) return res.status(400).json({ success: false, message: 'Employee full name is required.' });
    const code = employee_code || `EMP-${Date.now().toString().slice(-5)}`;

    // Bi-directional unified sync into hrm_employees & payroll_salary_structures
    let hrmEmpId = null;
    try {
      const nameParts = String(full_name).trim().split(/\s+/);
      const firstName = nameParts[0] || full_name;
      const lastName = nameParts.slice(1).join(' ');
      const grossSal = round2(parseFloat(basic_salary || 0) + parseFloat(house_rent_allowance || 0) + parseFloat(medical_allowance || 0) + parseFloat(conveyance_allowance || 0) + parseFloat(other_allowances || 0));
      const hrmCheck = await db.query(`SELECT id FROM hrm_employees WHERE tenant_id = $1 AND employee_code = $2 LIMIT 1`, [tid, code.trim()]);
      if (hrmCheck.rows.length > 0) {
        hrmEmpId = hrmCheck.rows[0].id;
      } else {
        const hrmIns = await db.query(
          `INSERT INTO hrm_employees (
            tenant_id, user_id, employee_code, first_name, last_name, cnic,
            department_name, designation_name, joining_date, official_email, personal_phone,
            bank_name, bank_iban, basic_salary, gross_salary, employment_status
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Active') RETURNING id`,
          [
            tid, user_id, code.trim(), firstName, lastName, national_tax_id || `CNIC-${code.trim()}`,
            department || 'General', designation || 'Staff', hire_date || new Date().toISOString().slice(0, 10),
            email || '', phone || '', bank_name || '', bank_iban || '', round2(basic_salary), grossSal
          ]
        );
        hrmEmpId = hrmIns.rows[0]?.id || null;
      }
      if (hrmEmpId) {
        await db.query(
          `INSERT INTO payroll_salary_structures (
            tenant_id, employee_id, basic_salary, house_rent_allowance, medical_allowance, conveyance_allowance, other_allowances, gross_salary
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (employee_id) DO UPDATE SET
            basic_salary = EXCLUDED.basic_salary, house_rent_allowance = EXCLUDED.house_rent_allowance,
            medical_allowance = EXCLUDED.medical_allowance, conveyance_allowance = EXCLUDED.conveyance_allowance,
            other_allowances = EXCLUDED.other_allowances, gross_salary = EXCLUDED.gross_salary`,
          [tid, hrmEmpId, round2(basic_salary), round2(house_rent_allowance), round2(medical_allowance), round2(conveyance_allowance), round2(other_allowances), grossSal]
        );
      }
    } catch (_) {}

    const r = await db.query(
      `INSERT INTO payroll_employee_profiles (
        tenant_id, hrm_employee_id, user_id, employee_code, full_name, email, phone, national_tax_id, department, designation,
        hire_date, pay_frequency, tax_jurisdiction_code, basic_salary, house_rent_allowance,
        medical_allowance, conveyance_allowance, other_allowances, payment_method, bank_name, bank_iban, tax_exempt
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      ON CONFLICT (tenant_id, employee_code) DO UPDATE SET
        hrm_employee_id = COALESCE(EXCLUDED.hrm_employee_id, payroll_employee_profiles.hrm_employee_id),
        full_name = EXCLUDED.full_name, basic_salary = EXCLUDED.basic_salary,
        house_rent_allowance = EXCLUDED.house_rent_allowance, medical_allowance = EXCLUDED.medical_allowance,
        conveyance_allowance = EXCLUDED.conveyance_allowance, other_allowances = EXCLUDED.other_allowances,
        updated_at = NOW()
      RETURNING *`,
      [
        tid, hrmEmpId, user_id, code.trim(), full_name.trim(), email || null, phone || null, national_tax_id || null,
        department || 'General', designation || 'Staff', hire_date || new Date().toISOString().slice(0, 10),
        pay_frequency, tax_jurisdiction_code, round2(basic_salary), round2(house_rent_allowance),
        round2(medical_allowance), round2(conveyance_allowance), round2(other_allowances),
        payment_method, bank_name || null, bank_iban || null, Boolean(tax_exempt)
      ]
    );
    await payrollService.logAudit(null, { tenantId: tid, entityType: 'employee_profile', entityId: r.rows[0].id, action: 'CREATED', userId: req.user?.id, userName: req.user?.full_name, details: { employee_code: code } });
    res.status(201).json({ success: true, data: r.rows[0], message: `Employee ${full_name} added to Payroll.` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put('/employees/:id', ...payAuth, requirePermission('payroll', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const allowed = [
      'full_name', 'email', 'phone', 'national_tax_id', 'department', 'designation',
      'hire_date', 'termination_date', 'pay_frequency', 'tax_jurisdiction_code',
      'basic_salary', 'house_rent_allowance', 'medical_allowance', 'conveyance_allowance', 'other_allowances',
      'payment_method', 'bank_name', 'bank_iban', 'tax_exempt', 'status'
    ];
    const sets = [];
    const params = [req.params.id, tid];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        params.push(req.body[k] === '' ? null : req.body[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return res.json({ success: true });
    sets.push(`updated_at = NOW()`);
    const r = await db.query(`UPDATE payroll_employee_profiles SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING *`, params);
    await payrollService.logAudit(null, { tenantId: tid, entityType: 'employee_profile', entityId: req.params.id, action: 'UPDATED_SALARY_PROFILE', userId: req.user?.id, userName: req.user?.full_name, details: req.body });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/employees/sync-hrm', ...payAuth, requirePermission('payroll', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const resSync = await payrollService.syncFromHrm(client, tid);
    await client.query('COMMIT');
    res.json({ success: true, data: resSync, message: resSync.skipped ? `HRM Sync skipped (${resSync.skipped})` : `Synced ${resSync.synced} employees from HRM.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// Legacy salary-structures endpoint preserved
router.get('/salary-structures', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT id as employee_id, employee_code, full_name, department, designation,
              basic_salary, house_rent_allowance, medical_allowance, conveyance_allowance, other_allowances,
              (basic_salary + house_rent_allowance + medical_allowance + conveyance_allowance + other_allowances) as gross_salary
       FROM payroll_employee_profiles WHERE tenant_id = $1 AND status = 'Active' ORDER BY employee_code ASC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 4. PAYROLL RUN PROCESSING (Draft -> Review -> Approve -> Finalize -> Reverse)
// ============================================================================
router.get('/runs', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT r.*,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', ps.id, 'payslip_number', ps.payslip_number,
                  'payroll_profile_id', ps.payroll_profile_id, 'employee_id', ps.employee_id,
                  'employee_code', pep.employee_code, 'full_name', pep.full_name,
                  'designation', pep.designation, 'bank_name', pep.bank_name, 'bank_iban', pep.bank_iban,
                  'proration_factor', ps.proration_factor, 'worked_days', ps.worked_days,
                  'unpaid_leave_days', ps.unpaid_leave_days, 'overtime_hours', ps.overtime_hours, 'overtime_pay', ps.overtime_pay,
                  'bonus_amount', ps.bonus_amount, 'arrears_amount', ps.arrears_amount, 'reimbursement_amount', ps.reimbursement_amount,
                  'basic_salary', ps.basic_salary, 'total_allowances', ps.total_allowances, 'gross_salary', ps.gross_salary,
                  'income_tax_deduction', ps.income_tax_deduction, 'eobi_employee_deduction', ps.eobi_employee_deduction,
                  'unpaid_leave_deduction', ps.unpaid_leave_deduction, 'loan_deduction', ps.loan_deduction,
                  'total_deductions', ps.total_deductions, 'net_salary', ps.net_salary,
                  'component_breakdown', ps.component_breakdown, 'exceptions', ps.exceptions,
                  'is_included', ps.is_included, 'payment_status', ps.payment_status, 'is_paid', ps.is_paid
                ) ORDER BY pep.employee_code ASC)
                FROM payroll_payslips ps
                LEFT JOIN payroll_employee_profiles pep ON ps.payroll_profile_id = pep.id
                WHERE ps.payroll_run_id = r.id
              ), '[]'::json) as payslips
       FROM payroll_runs r WHERE r.tenant_id = $1
       ORDER BY r.payroll_year DESC, r.payroll_month DESC, r.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/runs', ...payAuth, requirePermission('payroll', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const created = await payrollService.createDraftRun(client, tid, {
      periodId: req.body.period_id || null,
      year: req.body.payroll_year,
      month: req.body.payroll_month,
      payFrequency: req.body.pay_frequency || 'Monthly',
      overrides: req.body.overrides || {},
      userId: req.user?.id || null,
      userName: req.user?.full_name || req.user?.username || 'Payroll Admin'
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: created.run, payslips: created.payslips, message: `Draft Payroll Run ${created.run.run_number} calculated.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.put('/runs/:runId/payslips/:slipId', ...payAuth, requirePermission('payroll', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const runRes = await client.query(`SELECT * FROM payroll_runs WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [req.params.runId, tid]);
    if (runRes.rows.length === 0) throw new Error('Payroll run not found.');
    const run = runRes.rows[0];
    if (run.is_finalized || run.status === 'Finalized' || run.status === 'Reversed') {
      throw new Error('Cannot modify payslips in a Finalized or Reversed payroll run. Create an authorized reversal instead.');
    }

    const slipRes = await client.query(`SELECT * FROM payroll_payslips WHERE id = $1 AND payroll_run_id = $2`, [req.params.slipId, run.id]);
    if (slipRes.rows.length === 0) throw new Error('Payslip not found.');
    const slip = slipRes.rows[0];

    const empRes = await client.query(`SELECT * FROM payroll_employee_profiles WHERE id = $1`, [slip.payroll_profile_id]);
    const periodRes = await client.query(`SELECT * FROM payroll_periods WHERE id = $1`, [run.period_id]);
    const settings = await payrollService.getSettings(client, tid);

    const calc = await payrollService.calculateEmployeeSlip(client, tid, empRes.rows[0], periodRes.rows[0], settings, req.body);
    const isIncluded = req.body.is_included !== undefined ? Boolean(req.body.is_included) : slip.is_included;

    await client.query(
      `UPDATE payroll_payslips
       SET is_included = $1, overtime_hours = $2, overtime_pay = $3, bonus_amount = $4,
           commission_amount = $5, arrears_amount = $6, reimbursement_amount = $7,
           unpaid_leave_days = $8, unpaid_leave_deduction = $9, other_deductions = $10,
           gross_salary = $11, taxable_gross = $12, income_tax_deduction = $13,
           loan_deduction = $14, total_deductions = $15, net_salary = $16,
           component_breakdown = $17::jsonb, exceptions = $18::jsonb
       WHERE id = $19`,
      [
        isIncluded, calc.overtime_hours, calc.overtime_pay, calc.bonus_amount,
        calc.commission_amount, calc.arrears_amount, calc.reimbursement_amount,
        calc.unpaid_leave_days, calc.unpaid_leave_deduction, calc.other_deductions,
        calc.gross_salary, calc.taxable_gross, calc.income_tax_deduction,
        calc.loan_deduction, calc.total_deductions, calc.net_salary,
        JSON.stringify(calc.component_breakdown), JSON.stringify(calc.exceptions), slip.id
      ]
    );
    const updatedRun = await payrollService.refreshRunTotals(client, run.id);
    await client.query('COMMIT');
    res.json({ success: true, data: updatedRun, message: 'Draft payslip recalculated.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/runs/:id/approve', ...payAuth, requirePermission('payroll', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `UPDATE payroll_runs SET status = 'Approved', approved_by = $1, approved_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND status = 'Draft' AND is_finalized = FALSE RETURNING *`,
      [req.user?.id || null, req.params.id, tid]
    );
    if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'Run must be in Draft status to approve.' });
    await payrollService.logAudit(null, { tenantId: tid, entityType: 'payroll_run', entityId: req.params.id, action: 'APPROVED', userId: req.user?.id, userName: req.user?.full_name });
    res.json({ success: true, data: r.rows[0], message: 'Payroll run approved for finalization.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/runs/:id/finalize', ...payAuth, requirePermission('payroll', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const result = await payrollService.finalizeRun(client, tid, req.params.id, req.user?.id || null, req.user?.full_name || 'Controller');
    await client.query('COMMIT');
    res.json({ success: true, data: result.run, finance: result.finance, message: `Payroll Run ${result.run.run_number} finalized!` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/runs/:id/reverse', ...payAuth, requirePermission('payroll', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const rev = await payrollService.reverseFinalizedRun(client, tid, req.params.id, req.body.reason || 'Authorized Reversal', req.user?.id || null, req.user?.full_name || 'Controller');
    await client.query('COMMIT');
    res.json({ success: true, data: rev, message: `Payroll Run ${rev.run_number} reversed cleanly.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 5. PAYSLIPS (Self-Service) & PAYMENT BATCHES (With Retry Safety)
// ============================================================================
router.get('/my-payslips', authenticate, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT ps.*, pr.run_number, pr.payroll_month, pr.payroll_year, pep.employee_code, pep.full_name
       FROM payroll_payslips ps
       JOIN payroll_runs pr ON ps.payroll_run_id = pr.id
       JOIN payroll_employee_profiles pep ON ps.payroll_profile_id = pep.id
       WHERE ps.tenant_id = $1 AND pep.user_id = $2 AND pr.is_finalized = TRUE AND COALESCE(pr.is_reversed, FALSE) = FALSE
       ORDER BY pr.payroll_year DESC, pr.payroll_month DESC`,
      [tid, req.user.id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/payment-batches', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT pb.*, pr.run_number,
              COALESCE((SELECT json_agg(pi.*) FROM payroll_payment_items pi WHERE pi.batch_id = pb.id), '[]'::json) as items
       FROM payroll_payment_batches pb
       JOIN payroll_runs pr ON pb.payroll_run_id = pr.id
       WHERE pb.tenant_id = $1 ORDER BY pb.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/payment-batches', ...payAuth, requirePermission('payroll', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const resBatch = await payrollService.createPaymentBatch(client, tid, req.body.payroll_run_id, {
      paymentMethod: req.body.payment_method || 'Bank Transfer',
      bankAccountId: req.body.bank_account_id || null,
      paymentDate: req.body.payment_date,
      userId: req.user?.id || null,
      userName: req.user?.full_name
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: resBatch.batch, message: `Payment Batch ${resBatch.batch.batch_number} staged (${resBatch.items_count} payslips).` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/payment-batches/:id/process', ...payAuth, requirePermission('payroll', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const resProc = await payrollService.processPaymentBatchResults(client, tid, req.params.id, {
      failedPayslipIds: req.body.failed_payslip_ids || [],
      failureReason: req.body.failure_reason || 'Bank rejection',
      userId: req.user?.id || null,
      userName: req.user?.full_name
    });
    await client.query('COMMIT');
    res.json({ success: true, data: resProc, message: `Payment batch processed: ${resProc.paid_count} paid, ${resProc.failed_count} failed.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 6. LOANS & ADVANCES
// ============================================================================
router.get('/loans', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT l.*, pep.employee_code, pep.full_name
       FROM payroll_loans_advances l
       JOIN payroll_employee_profiles pep ON l.payroll_profile_id = pep.id
       WHERE l.tenant_id = $1 ORDER BY l.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/loans', ...payAuth, requirePermission('payroll', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { payroll_profile_id, loan_type = 'Salary Advance', principal_amount, installment_amount, repayment_start_date, reason, status = 'Approved' } = req.body;
    const principal = round2(principal_amount);
    const inst = round2(installment_amount || principal);
    if (!payroll_profile_id || principal <= 0) return res.status(400).json({ success: false, message: 'Employee and principal amount required.' });
    const loanNo = `LN-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    const r = await db.query(
      `INSERT INTO payroll_loans_advances (
        tenant_id, payroll_profile_id, loan_number, loan_type, principal_amount, installment_amount,
        remaining_balance, repayment_start_date, status, reason, approved_by, approved_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$5,$7,$8,$9,$10,$11) RETURNING *`,
      [tid, payroll_profile_id, loanNo, loan_type, principal, inst, repayment_start_date || new Date().toISOString().slice(0, 10), status, reason || '', status === 'Approved' ? (req.user?.id || null) : null, status === 'Approved' ? new Date() : null]
    );
    res.status(201).json({ success: true, data: r.rows[0], message: `${loan_type} ${loanNo} recorded.` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 7. YTD REPORTS, STATUTORY SUMMARY, YEAR-END CLOSING & AUDIT LOGS
// ============================================================================
router.get('/reports/ytd', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await payrollService.getYtdReport(tid, req.query.year);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/year-end/close', ...payAuth, requirePermission('payroll', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const year = parseInt(req.body.tax_year || new Date().getFullYear(), 10);
    const ytd = await payrollService.getYtdReport(tid, year);
    const totGross = round2(ytd.employees.reduce((s, e) => s + parseFloat(e.ytd_gross || 0), 0));
    const totTax = round2(ytd.employees.reduce((s, e) => s + parseFloat(e.ytd_tax || 0), 0));
    const totEr = round2(ytd.employees.reduce((s, e) => s + parseFloat(e.ytd_employer_cost || 0), 0));
    const totNet = round2(ytd.employees.reduce((s, e) => s + parseFloat(e.ytd_net || 0), 0));

    const r = await db.query(
      `INSERT INTO payroll_year_closures (tenant_id, tax_year, total_gross, total_tax_withheld, total_employer_cost, total_net_paid, closed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, tax_year) DO UPDATE SET total_gross = EXCLUDED.total_gross, total_tax_withheld = EXCLUDED.total_tax_withheld
       RETURNING *`,
      [tid, year, totGross, totTax, totEr, totNet, req.user?.id || null]
    );
    await db.query(`UPDATE payroll_periods SET status = 'Closed' WHERE tenant_id = $1 AND period_year = $2`, [tid, year]);
    res.json({ success: true, data: r.rows[0], message: `Payroll Year ${year} closed cleanly.` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/audit-logs', ...payAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(`SELECT * FROM payroll_audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Backward-compatible static helper export for legacy callers & standards suite
router.calculatePakistanMonthlySalaryTax = function calculatePakistanMonthlySalaryTax(monthlyTaxable) {
  const annual = Math.max(0, Number(monthlyTaxable || 0)) * 12;
  let annualTax = 0;
  if (annual <= 600000) annualTax = 0;
  else if (annual <= 1200000) annualTax = (annual - 600000) * 0.05;
  else if (annual <= 2200000) annualTax = 30000 + (annual - 1200000) * 0.15;
  else if (annual <= 3200000) annualTax = 180000 + (annual - 2200000) * 0.25;
  else if (annual <= 4100000) annualTax = 430000 + (annual - 3200000) * 0.30;
  else annualTax = 700000 + (annual - 4100000) * 0.35;
  return Math.round(annualTax / 12);
};

module.exports = router;
