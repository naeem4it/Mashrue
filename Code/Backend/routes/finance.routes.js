/**
 * ============================================================================
 * MASHRUE FINANCIAL MANAGEMENT MODULE — COMPLETE REST CONTROLLER
 * Mounted at: /api/finance and /api/erp/finance
 * Module License: 'mod_finance' (also accepts 'mod_accounting')
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireModuleLicense, requirePermission, resolveTenantId } = require('../middleware/rbac.middleware');
const financeService = require('../services/financeService');

function round2(n) {
  const v = Number(n || 0);
  return isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}

const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

// Global Finance auth + license guard
const finAuth = [authenticate, requireModuleLicense('mod_finance')];

// ============================================================================
// 1. FINANCIAL DASHBOARD
// ============================================================================
router.get('/dashboard', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    await financeService.ensureCoaMap(null, tid);
    const settings = await financeService.getCompanySettings(null, tid);

    const [
      bankRes, arRes, apRes, pnlRes, draftJvRes, unreconciledRes, periodsRes, recentJvRes
    ] = await Promise.all([
      db.query(`SELECT COALESCE(SUM(current_balance), 0) as total_cash_bank, COUNT(*) as account_count FROM bank_cash_accounts WHERE tenant_id = $1 AND is_active = TRUE`, [tid]),
      db.query(`SELECT COALESCE(SUM(GREATEST(0, total_amount - COALESCE(paid_amount, 0) - COALESCE(credited_amount, 0))), 0) as open_ar, COUNT(*) as open_count FROM invoices WHERE tenant_id = $1 AND COALESCE(status,'') NOT IN ('Voided','Cancelled','Draft','Paid')`, [tid]),
      db.query(`SELECT COALESCE(SUM(GREATEST(0, total_amount - COALESCE(paid_amount, 0) - COALESCE(credited_amount, 0))), 0) as open_ap, COUNT(*) as open_count FROM supplier_bills WHERE tenant_id = $1 AND status NOT IN ('Voided','Draft','Paid')`, [tid]),
      financeService.getProfitAndLoss(tid, {}),
      db.query(`SELECT COUNT(*) as cnt FROM journal_entries WHERE tenant_id = $1 AND status IN ('Draft', 'Pending Approval')`, [tid]),
      db.query(`SELECT COUNT(*) as cnt FROM bank_statement_lines WHERE tenant_id = $1 AND is_matched = FALSE`, [tid]),
      db.query(`SELECT * FROM accounting_periods WHERE tenant_id = $1 ORDER BY start_date ASC`, [tid]),
      db.query(`SELECT id, entry_number, entry_date, reference_type, narration, total_debit, status FROM journal_entries WHERE tenant_id = $1 ORDER BY entry_date DESC, created_at DESC LIMIT 8`, [tid])
    ]);

    const curDate = new Date().toISOString().slice(0, 10);
    const currentPeriod = periodsRes.rows.find(p => p.start_date <= curDate && p.end_date >= curDate) || periodsRes.rows[0] || null;

    res.json({
      success: true,
      data: {
        settings,
        kpis: {
          cash_and_bank: round2(bankRes.rows[0]?.total_cash_bank),
          bank_accounts_count: parseInt(bankRes.rows[0]?.account_count || 0, 10),
          ar_outstanding: round2(arRes.rows[0]?.open_ar),
          ar_open_count: parseInt(arRes.rows[0]?.open_count || 0, 10),
          ap_outstanding: round2(apRes.rows[0]?.open_ap),
          ap_open_count: parseInt(apRes.rows[0]?.open_count || 0, 10),
          total_revenue: pnlRes.current.summary.total_revenue,
          total_expenses: pnlRes.current.summary.total_operating_expenses + pnlRes.current.summary.total_cogs,
          net_profit: pnlRes.current.summary.net_profit,
          pending_journals: parseInt(draftJvRes.rows[0]?.cnt || 0, 10),
          unreconciled_bank_lines: parseInt(unreconciledRes.rows[0]?.cnt || 0, 10)
        },
        current_period: currentPeriod,
        recent_journals: recentJvRes.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 2. COMPANY ACCOUNTING SETTINGS, FISCAL YEARS, PERIODS & OPENING BALANCES
// ============================================================================
router.get('/settings', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const settings = await financeService.getCompanySettings(null, tid);
    res.json({ success: true, data: settings });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/settings', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    await financeService.getCompanySettings(null, tid);
    const allowed = [
      'base_currency', 'multi_currency_enabled', 'fiscal_year_start_month', 'fiscal_year_start_day',
      'journal_prefix', 'invoice_prefix', 'bill_prefix', 'credit_note_prefix',
      'require_journal_approval', 'journal_approval_threshold', 'allow_backdated_postings',
      'enforce_period_locking', 'tax_rounding_rule', 'default_ar_account_code', 'default_ap_account_code',
      'default_revenue_account_code', 'default_expense_account_code', 'default_tax_payable_code',
      'enable_tender_integration', 'enable_inventory_integration', 'enable_crm_integration',
      'enable_payroll_integration', 'enable_mfg_integration', 'opening_balances_locked'
    ];
    const sets = [];
    const params = [tid, req.user?.id || null];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        params.push(req.body[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return res.json({ success: true, data: await financeService.getCompanySettings(null, tid) });
    sets.push(`updated_by = $2`, `updated_at = NOW()`);
    const upd = await db.query(`UPDATE finance_company_settings SET ${sets.join(', ')} WHERE tenant_id = $1 RETURNING *`, params);
    await financeService.logAudit(null, { tenantId: tid, entityType: 'settings', entityId: tid, action: 'UPDATED_SETTINGS', userId: req.user?.id, userName: req.user?.full_name || req.user?.username, afterState: req.body });
    res.json({ success: true, data: upd.rows[0], message: 'Company accounting settings saved.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/fiscal-years', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const fys = await db.query(`SELECT * FROM fiscal_years WHERE tenant_id = $1 ORDER BY start_date DESC`, [tid]);
    const periods = await db.query(`SELECT * FROM accounting_periods WHERE tenant_id = $1 ORDER BY start_date ASC`, [tid]);
    res.json({ success: true, data: { fiscal_years: fys.rows, periods: periods.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/fiscal-years', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const { year_name, start_date, end_date } = req.body;
    if (!year_name || !start_date || !end_date) throw new Error('Year name, start date, and end date are required.');

    const fyRes = await client.query(
      `INSERT INTO fiscal_years (tenant_id, year_name, start_date, end_date) VALUES ($1,$2,$3,$4) RETURNING *`,
      [tid, year_name, start_date, end_date]
    );
    const fy = fyRes.rows[0];

    // Generate monthly accounting periods across range
    const start = new Date(start_date);
    const end = new Date(end_date);
    let pNum = 1;
    let cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
    while (cur <= end && pNum <= 24) {
      const pEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0));
      const pName = cur.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      await client.query(
        `INSERT INTO accounting_periods (tenant_id, fiscal_year_id, period_number, period_name, start_date, end_date, status)
         VALUES ($1,$2,$3,$4,$5,$6,'Open') ON CONFLICT (tenant_id, start_date, end_date) DO NOTHING`,
        [tid, fy.id, pNum, pName, cur.toISOString().slice(0, 10), pEnd.toISOString().slice(0, 10)]
      );
      cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
      pNum++;
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: fy, message: `Fiscal year "${year_name}" and monthly periods created.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/periods/:id/status', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { status, notes } = req.body;
    if (!['Open', 'Soft-Closed', 'Closed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be Open, Soft-Closed, or Closed.' });
    }
    const upd = await db.query(
      `UPDATE accounting_periods
       SET status = $1, notes = COALESCE($2, notes),
           locked_by = CASE WHEN $1 = 'Closed' THEN $3::uuid ELSE NULL END,
           locked_at = CASE WHEN $1 = 'Closed' THEN NOW() ELSE NULL END
       WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [status, notes || null, req.user?.id || null, req.params.id, tid]
    );
    if (upd.rows.length === 0) return res.status(404).json({ success: false, message: 'Period not found.' });
    await financeService.logAudit(null, { tenantId: tid, entityType: 'accounting_period', entityId: req.params.id, action: `PERIOD_${status.toUpperCase()}`, userId: req.user?.id, userName: req.user?.full_name, afterState: { status } });
    res.json({ success: true, data: upd.rows[0], message: `Accounting period marked as ${status}.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/opening-balances', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const settings = await financeService.getCompanySettings(client, tid);
    if (settings.opening_balances_locked) {
      throw new Error('Opening balances are locked for this company.');
    }
    const { as_of_date, balances = [], lock_after_post = false } = req.body;
    if (!Array.isArray(balances) || balances.length === 0) throw new Error('At least one opening balance line is required.');

    let totalDr = 0;
    let totalCr = 0;
    const jeLines = [];
    for (const b of balances) {
      const dr = round2(b.debit || 0);
      const cr = round2(b.credit || 0);
      if (!b.account_id || (dr === 0 && cr === 0)) continue;
      totalDr = round2(totalDr + dr);
      totalCr = round2(totalCr + cr);
      jeLines.push({ account_id: b.account_id, debit: dr, credit: cr, line_description: b.description || 'Controlled Opening Balance Migration' });
    }
    if (Math.abs(totalDr - totalCr) > 0.01) {
      throw new Error(`Opening balances must balance! Debit (${totalDr}) != Credit (${totalCr}).`);
    }

    const resJe = await financeService.createJournal(client, {
      tenantId: tid,
      entryDate: as_of_date || new Date().toISOString().slice(0, 10),
      referenceType: 'Opening Balance',
      narration: 'Controlled Opening Balance Migration Entry',
      lines: jeLines,
      requestedStatus: 'Posted',
      userId: req.user?.id,
      userName: req.user?.full_name,
      bypassApprovalThreshold: true
    });

    if (lock_after_post) {
      await client.query(`UPDATE finance_company_settings SET opening_balances_locked = TRUE WHERE tenant_id = $1`, [tid]);
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: resJe.journal, message: 'Opening balances posted cleanly.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 3. CURRENCIES & EXCHANGE RATES
// ============================================================================
router.get('/currencies', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const [cur, fx] = await Promise.all([
      db.query(`SELECT * FROM finance_currencies WHERE tenant_id = $1 ORDER BY is_base DESC, currency_code ASC`, [tid]),
      db.query(`SELECT * FROM finance_exchange_rates WHERE tenant_id = $1 ORDER BY effective_date DESC, created_at DESC LIMIT 100`, [tid])
    ]);
    res.json({ success: true, data: { currencies: cur.rows, exchange_rates: fx.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/currencies', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { currency_code, currency_name, symbol, is_active = true } = req.body;
    const r = await db.query(
      `INSERT INTO finance_currencies (tenant_id, currency_code, currency_name, symbol, is_active)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, currency_code) DO UPDATE SET currency_name = EXCLUDED.currency_name, symbol = EXCLUDED.symbol, is_active = EXCLUDED.is_active
       RETURNING *`,
      [tid, String(currency_code).toUpperCase(), currency_name, symbol || currency_code, Boolean(is_active)]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/exchange-rates', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { from_currency, to_currency, exchange_rate, effective_date, source } = req.body;
    const r = await db.query(
      `INSERT INTO finance_exchange_rates (tenant_id, from_currency, to_currency, exchange_rate, effective_date, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, String(from_currency).toUpperCase(), String(to_currency || 'PKR').toUpperCase(), parseFloat(exchange_rate), effective_date || new Date().toISOString().slice(0, 10), source || 'Manual', req.user?.id || null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 4. TAX MANAGEMENT (Configurable Codes, Calculations & Reports)
// ============================================================================
router.get('/tax-codes', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT tc.*, a.account_code, a.account_name
       FROM finance_tax_codes tc
       LEFT JOIN coa_accounts a ON tc.tax_account_id = a.id
       WHERE tc.tenant_id = $1 ORDER BY tc.tax_category ASC, tc.code ASC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/tax-codes', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { code, name, tax_category, rate_pct, is_inclusive, is_exempt, rounding_rule, tax_account_id, effective_from, effective_to, description, is_active = true } = req.body;
    const r = await db.query(
      `INSERT INTO finance_tax_codes (tenant_id, code, name, tax_category, rate_pct, is_inclusive, is_exempt, rounding_rule, tax_account_id, effective_from, effective_to, description, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (tenant_id, code) DO UPDATE
       SET name = EXCLUDED.name, tax_category = EXCLUDED.tax_category, rate_pct = EXCLUDED.rate_pct, is_inclusive = EXCLUDED.is_inclusive, is_exempt = EXCLUDED.is_exempt, rounding_rule = EXCLUDED.rounding_rule, tax_account_id = EXCLUDED.tax_account_id, effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to, is_active = EXCLUDED.is_active
       RETURNING *`,
      [tid, code.trim().toUpperCase(), name.trim(), tax_category || 'Sales', parseFloat(rate_pct || 0), Boolean(is_inclusive), Boolean(is_exempt), rounding_rule || 'HALF_UP', tax_account_id || null, effective_from || new Date().toISOString().slice(0, 10), effective_to || null, description || '', Boolean(is_active)]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/tax-codes/calculate', ...finAuth, async (req, res) => {
  try {
    const { amount, rate_pct, is_inclusive, is_exempt, rounding_rule } = req.body;
    const calc = financeService.calculateTaxBreakdown({
      amount,
      ratePct: rate_pct,
      isInclusive: Boolean(is_inclusive),
      isExempt: Boolean(is_exempt),
      roundingRule: rounding_rule || 'HALF_UP'
    });
    res.json({ success: true, data: calc });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/tax-summary', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { from_date, to_date } = req.query;
    const paramsInv = [tid];
    const paramsBill = [tid];
    let invFilter = '';
    let billFilter = '';
    if (from_date) {
      paramsInv.push(from_date); invFilter += ` AND invoice_date >= $${paramsInv.length}::date`;
      paramsBill.push(from_date); billFilter += ` AND bill_date >= $${paramsBill.length}::date`;
    }
    if (to_date) {
      paramsInv.push(to_date); invFilter += ` AND invoice_date <= $${paramsInv.length}::date`;
      paramsBill.push(to_date); billFilter += ` AND bill_date <= $${paramsBill.length}::date`;
    }

    const [salesTaxRes, purchaseTaxRes, arWhtRes, apWhtRes] = await Promise.all([
      db.query(`SELECT COALESCE(SUM(subtotal),0) as taxable_sales, COALESCE(SUM(tax_amount),0) as output_tax, COUNT(*) as count FROM invoices WHERE tenant_id = $1 AND status NOT IN ('Voided','Cancelled','Draft') ${invFilter}`, paramsInv),
      db.query(`SELECT COALESCE(SUM(subtotal),0) as taxable_purchases, COALESCE(SUM(tax_amount),0) as input_tax, COUNT(*) as count FROM supplier_bills WHERE tenant_id = $1 AND status NOT IN ('Voided','Draft') ${billFilter}`, paramsBill),
      db.query(`SELECT COALESCE(SUM(COALESCE(income_tax_wht_amount,0) + COALESCE(sales_tax_wht_amount,0)), 0) as ar_wht FROM payments WHERE tenant_id = $1`, [tid]),
      db.query(`SELECT COALESCE(SUM(wht_deducted), 0) as ap_wht FROM supplier_payments WHERE tenant_id = $1`, [tid])
    ]);

    const outputTax = round2(salesTaxRes.rows[0]?.output_tax);
    const inputTax = round2(purchaseTaxRes.rows[0]?.input_tax);
    res.json({
      success: true,
      data: {
        disclaimer: 'Tax figures are calculated based on tenant-configured tax codes. Verify statutory filings with your tax advisor before official submission.',
        taxable_sales: round2(salesTaxRes.rows[0]?.taxable_sales),
        output_sales_tax: outputTax,
        sales_invoice_count: parseInt(salesTaxRes.rows[0]?.count || 0, 10),
        taxable_purchases: round2(purchaseTaxRes.rows[0]?.taxable_purchases),
        input_purchase_tax: inputTax,
        supplier_bill_count: parseInt(purchaseTaxRes.rows[0]?.count || 0, 10),
        net_sales_tax_payable: round2(outputTax - inputTax),
        wht_deducted_by_customers: round2(arWhtRes.rows[0]?.ar_wht),
        wht_withheld_from_suppliers: round2(apWhtRes.rows[0]?.ap_wht)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 5. CHART OF ACCOUNTS (COA) & ACCOUNT LEDGER DRILL-DOWN
// ============================================================================
router.get('/coa', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    await financeService.ensureCoaMap(null, tid);
    const { search, account_type, is_active } = req.query;
    const params = [tid];
    let where = `a.tenant_id = $1`;
    if (account_type && account_type !== 'all') {
      params.push(account_type);
      where += ` AND a.account_type = $${params.length}`;
    }
    if (is_active === 'true' || is_active === 'false') {
      params.push(is_active === 'true');
      where += ` AND a.is_active = $${params.length}`;
    }
    if (search) {
      params.push(`%${search.trim()}%`);
      where += ` AND (a.account_code ILIKE $${params.length} OR a.account_name ILIKE $${params.length})`;
    }

    const q = await db.query(
      `SELECT a.*, pa.account_code as parent_code, pa.account_name as parent_name,
              COALESCE((SELECT SUM(jl.debit) FROM journal_entry_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id WHERE jl.account_id = a.id AND je.tenant_id = $1 AND COALESCE(je.is_posted, TRUE) = TRUE), 0) as total_debit,
              COALESCE((SELECT SUM(jl.credit) FROM journal_entry_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id WHERE jl.account_id = a.id AND je.tenant_id = $1 AND COALESCE(je.is_posted, TRUE) = TRUE), 0) as total_credit
       FROM coa_accounts a
       LEFT JOIN coa_accounts pa ON a.parent_account_id = pa.id
       WHERE ${where}
       ORDER BY a.account_code ASC`,
      params
    );

    const accounts = q.rows.map(r => {
      const dr = round2(r.total_debit);
      const cr = round2(r.total_credit);
      const open = round2(r.opening_balance);
      const isDr = ['Asset', 'Expense'].includes(r.account_type);
      return { ...r, total_debit: dr, total_credit: cr, net_balance: round2(open + (isDr ? dr - cr : cr - dr)) };
    });

    res.json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/coa', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { account_code, account_name, account_type, account_sub_type, parent_account_id, currency, opening_balance, is_reconcilable, description, is_active = true } = req.body;
    if (!account_code || !account_name || !account_type) return res.status(400).json({ success: false, message: 'Account code, name, and type are required.' });
    const r = await db.query(
      `INSERT INTO coa_accounts (tenant_id, account_code, account_name, account_type, account_sub_type, parent_account_id, currency, opening_balance, is_reconcilable, description, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [tid, account_code.trim(), account_name.trim(), account_type, account_sub_type || account_type, parent_account_id || null, currency || 'PKR', parseFloat(opening_balance || 0), Boolean(is_reconcilable), description || '', Boolean(is_active)]
    );
    await financeService.logAudit(null, { tenantId: tid, entityType: 'coa_account', entityId: r.rows[0].id, action: 'CREATED', userId: req.user?.id, userName: req.user?.full_name, afterState: r.rows[0] });
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put('/coa/:id', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { account_name, account_type, account_sub_type, parent_account_id, is_reconcilable, is_active, description } = req.body;
    const r = await db.query(
      `UPDATE coa_accounts
       SET account_name = COALESCE($1, account_name),
           account_type = COALESCE($2, account_type),
           account_sub_type = COALESCE($3, account_sub_type),
           parent_account_id = $4,
           is_reconcilable = COALESCE($5, is_reconcilable),
           is_active = COALESCE($6, is_active),
           description = COALESCE($7, description),
           updated_at = NOW()
       WHERE id = $8 AND tenant_id = $9 RETURNING *`,
      [account_name, account_type, account_sub_type, parent_account_id || null, is_reconcilable, is_active, description, req.params.id, tid]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, message: 'Account not found.' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/coa/:id/ledger', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await financeService.getAccountLedger(tid, req.params.id, { fromDate: req.query.from_date, toDate: req.query.to_date });
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 6. GENERAL LEDGER & JOURNAL LIFECYCLE (Draft, Post, Reverse)
// ============================================================================
router.get('/journals', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { search, status, reference_type, from_date, to_date, limit = 50, offset = 0 } = req.query;
    const params = [tid];
    let where = `je.tenant_id = $1`;
    if (status && status !== 'all') { params.push(status); where += ` AND je.status = $${params.length}`; }
    if (reference_type && reference_type !== 'all') { params.push(reference_type); where += ` AND je.reference_type = $${params.length}`; }
    if (from_date) { params.push(from_date); where += ` AND je.entry_date >= $${params.length}::date`; }
    if (to_date) { params.push(to_date); where += ` AND je.entry_date <= $${params.length}::date`; }
    if (search) { params.push(`%${search.trim()}%`); where += ` AND (je.entry_number ILIKE $${params.length} OR je.narration ILIKE $${params.length})`; }

    const countRes = await db.query(`SELECT COUNT(*) as total FROM journal_entries je WHERE ${where}`, params);
    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const off = Math.max(0, parseInt(offset, 10) || 0);
    params.push(lim, off);

    const q = await db.query(
      `SELECT je.*,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', jl.id, 'account_id', jl.account_id, 'account_code', a.account_code,
                  'account_name', a.account_name, 'account_type', a.account_type,
                  'line_description', jl.line_description, 'debit', jl.debit, 'credit', jl.credit,
                  'department', jl.department, 'cost_center', jl.cost_center
                ))
                FROM journal_entry_lines jl
                LEFT JOIN coa_accounts a ON jl.account_id = a.id
                WHERE jl.journal_entry_id = je.id
              ), '[]'::json) as lines
       FROM journal_entries je
       WHERE ${where}
       ORDER BY je.entry_date DESC, je.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ success: true, data: q.rows, total: parseInt(countRes.rows[0].total, 10) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/journals', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const resJe = await financeService.createJournal(client, {
      tenantId: tid,
      businessProfileId: req.body.business_profile_id || null,
      entryDate: req.body.entry_date,
      referenceType: req.body.reference_type || 'Manual Voucher',
      narration: req.body.narration || 'Manual Journal Entry',
      lines: req.body.lines || [],
      requestedStatus: req.body.status || 'Posted',
      currency: req.body.currency,
      exchangeRate: req.body.exchange_rate,
      idempotencyKey: req.body.idempotency_key || null,
      userId: req.user?.id || null,
      userName: req.user?.full_name || req.user?.username || 'Accountant'
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: resJe.journal, message: `Journal ${resJe.journal.entry_number} (${resJe.journal.status}) saved.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// Edit Draft Journal ONLY (Posted/Reversed strictly blocked!)
router.put('/journals/:id', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const cur = await client.query(`SELECT * FROM journal_entries WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (cur.rows.length === 0) throw new Error('Journal entry not found.');
    const existing = cur.rows[0];
    if (existing.is_posted || existing.status === 'Posted' || existing.status === 'Reversed') {
      throw new Error('Posted or Reversed journal entries are IMMUTABLE and cannot be modified. Create a reversal entry instead.');
    }

    const lines = Array.isArray(req.body.lines) ? req.body.lines : [];
    let dr = 0; let cr = 0;
    lines.forEach(l => { dr = round2(dr + parseFloat(l.debit || 0)); cr = round2(cr + parseFloat(l.credit || 0)); });
    if (lines.length < 2 || Math.abs(dr - cr) > 0.01) throw new Error('Edited journal lines must remain balanced.');

    await client.query(
      `UPDATE journal_entries SET entry_date = COALESCE($1, entry_date), narration = COALESCE($2, narration), total_debit = $3, total_credit = $4, updated_at = NOW() WHERE id = $5`,
      [req.body.entry_date || existing.entry_date, req.body.narration || existing.narration, dr, cr, existing.id]
    );
    await client.query(`DELETE FROM journal_entry_lines WHERE journal_entry_id = $1`, [existing.id]);
    for (const l of lines) {
      await client.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit, department, cost_center)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [existing.id, l.account_id, l.line_description || req.body.narration || '', round2(l.debit || 0), round2(l.credit || 0), l.department || null, l.cost_center || null]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, message: 'Draft journal updated.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/journals/:id/post', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const posted = await financeService.postDraftJournal(client, tid, req.params.id, req.user?.id, req.user?.full_name || 'Approver');
    await client.query('COMMIT');
    res.json({ success: true, data: posted, message: `Journal ${posted.entry_number} posted to General Ledger.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/journals/:id/reverse', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const resRev = await financeService.reverseJournal(client, tid, req.params.id, {
      reversalDate: req.body.reversal_date,
      reason: req.body.reason || 'Authorized Accounting Reversal',
      userId: req.user?.id,
      userName: req.user?.full_name || req.user?.username || 'Controller'
    });
    await client.query('COMMIT');
    res.json({ success: true, data: resRev, message: `Reversal Voucher ${resRev.reversal.entry_number} posted.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 7. ACCOUNTS RECEIVABLE (Standalone Invoices, Credit Notes, Receipts & Allocations)
// ============================================================================
router.get('/ar/invoices', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { search, status, customer_id, limit = 50, offset = 0 } = req.query;
    const params = [tid];
    let where = `i.tenant_id = $1`;
    if (status && status !== 'all') { params.push(status); where += ` AND LOWER(i.status) = LOWER($${params.length})`; }
    if (customer_id && isUuid(customer_id)) { params.push(customer_id); where += ` AND i.customer_id = $${params.length}`; }
    if (search) { params.push(`%${search.trim()}%`); where += ` AND (i.invoice_number ILIKE $${params.length} OR c.business_name ILIKE $${params.length})`; }

    const lim = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const off = Math.max(0, parseInt(offset, 10) || 0);
    params.push(lim, off);

    const q = await db.query(
      `SELECT i.*, c.business_name as customer_name, c.ntn as customer_ntn,
              GREATEST(0, (i.total_amount - COALESCE(i.paid_amount, 0) - COALESCE(i.credited_amount, 0))) as outstanding_amount,
              COALESCE((SELECT json_agg(ii.*) FROM invoice_items ii WHERE ii.invoice_id = i.id), '[]'::json) as items
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE ${where}
       ORDER BY i.invoice_date DESC, i.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ success: true, data: q.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/ar/invoices', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const { customer_id, business_profile_id, invoice_number, invoice_date, due_date, currency, exchange_rate, discount_amount = 0, payment_terms, notes, items = [], status = 'Issued', opportunity_id } = req.body;
    if (!customer_id) throw new Error('Customer is required.');

    let bpId = business_profile_id;
    if (!bpId) {
      const bpRes = await client.query(`SELECT id FROM business_profiles WHERE tenant_id = $1 LIMIT 1`, [tid]);
      bpId = bpRes.rows[0]?.id || null;
    }

    const invDate = invoice_date || new Date().toISOString().slice(0, 10);
    await financeService.assertOpenPeriod(client, tid, invDate);
    const fx = await financeService.resolveExchangeRate(client, tid, currency, exchange_rate, invDate);
    const invNum = invoice_number || await financeService.getNextDocumentNumber(client, tid, 'invoice');

    let subtotal = 0;
    let totalTax = 0;
    const processedItems = [];

    if (Array.isArray(items) && items.length > 0) {
      for (const itm of items) {
        const qty = parseFloat(itm.quantity || 1);
        const price = parseFloat(itm.unit_price || 0);
        const disc = parseFloat(itm.discount_amount || 0);
        const lineSub = round2(Math.max(0, (qty * price) - disc));
        const rate = parseFloat(itm.tax_rate || 0);
        const calc = financeService.calculateTaxBreakdown({ amount: lineSub, ratePct: rate, isInclusive: Boolean(itm.is_inclusive), isExempt: Boolean(itm.is_exempt) });
        subtotal = round2(subtotal + calc.net_amount);
        totalTax = round2(totalTax + calc.tax_amount);
        processedItems.push({ ...itm, quantity: qty, unit_price: price, discount_amount: disc, tax_rate: calc.effective_rate, tax_amount: calc.tax_amount, line_total: calc.gross_amount });
      }
    } else {
      subtotal = round2(req.body.subtotal || 0);
      totalTax = round2(req.body.tax_amount || 0);
    }

    const discTotal = round2(discount_amount || 0);
    const totalAmount = round2(Math.max(0, subtotal - discTotal + totalTax));

    const invRes = await client.query(
      `INSERT INTO invoices (
        tenant_id, business_profile_id, customer_id, opportunity_id, invoice_number, invoice_date, due_date,
        currency, exchange_rate, subtotal, discount_amount, tax_amount, total_amount, paid_amount,
        credited_amount, payment_terms, notes, status, fbr_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0,$14,$15,$16,'N/A') RETURNING *`,
      [tid, bpId, customer_id, opportunity_id || null, invNum, invDate, due_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), fx.txCurrency, fx.exchangeRate, subtotal, discTotal, totalTax, totalAmount, payment_terms || 'Net 30', notes || '', status]
    );
    const inv = invRes.rows[0];

    for (const pi of processedItems) {
      await client.query(
        `INSERT INTO invoice_items (tenant_id, invoice_id, product_id, description, quantity, unit, unit_price, discount_amount, tax_code_id, tax_rate, tax_amount, line_total, revenue_account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [tid, inv.id, pi.product_id || null, pi.description || 'Item / Service', pi.quantity, pi.unit || 'PCS', pi.unit_price, pi.discount_amount, pi.tax_code_id || null, pi.tax_rate, pi.tax_amount, pi.line_total, pi.revenue_account_id || null]
      );
    }

    // Auto-post to GL if not Draft
    if (status !== 'Draft' && totalAmount > 0) {
      const ev = await financeService.postAccountingEvent(client, {
        tenantId: tid,
        sourceModule: 'finance',
        eventType: 'CUSTOMER_INVOICE',
        sourceId: inv.id,
        sourceNumber: inv.invoice_number,
        date: invDate,
        narration: `Customer Invoice ${inv.invoice_number}`,
        payload: {
          business_profile_id: bpId,
          customer_id,
          subtotal: round2(subtotal - discTotal),
          tax_amount: totalTax,
          total_amount: totalAmount,
          currency: fx.txCurrency,
          exchange_rate: fx.exchangeRate
        },
        userId: req.user?.id,
        userName: req.user?.full_name
      });
      if (ev.journal?.id) {
        await client.query(`UPDATE invoices SET gl_posted = TRUE, journal_entry_id = $1 WHERE id = $2`, [ev.journal.id, inv.id]);
      }
    }

    await financeService.logAudit(client, { tenantId: tid, entityType: 'invoice', entityId: inv.id, action: 'CREATED', userId: req.user?.id, userName: req.user?.full_name, afterState: { invoice_number: invNum, total_amount: totalAmount, status } });
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: inv, message: `Customer Invoice ${invNum} created.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/ar/invoices/:id/void', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const invRes = await client.query(`SELECT * FROM invoices WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (invRes.rows.length === 0) throw new Error('Invoice not found.');
    const inv = invRes.rows[0];
    if (parseFloat(inv.paid_amount || 0) > 0) throw new Error('Cannot void an invoice that has payments applied. Issue a Credit Note instead.');
    if (inv.status === 'Voided') throw new Error('Invoice is already voided.');

    await client.query(`UPDATE invoices SET status = 'Voided', voided_at = NOW(), void_reason = $1 WHERE id = $2`, [req.body.reason || 'Voided by user', inv.id]);
    if (inv.journal_entry_id) {
      await financeService.reverseJournal(client, tid, inv.journal_entry_id, { reason: req.body.reason || `Invoice ${inv.invoice_number} voided`, userId: req.user?.id, userName: req.user?.full_name });
    }
    await client.query('COMMIT');
    res.json({ success: true, message: `Invoice ${inv.invoice_number} voided and GL reversed.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get('/ar/credit-notes', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT cn.*, c.business_name as customer_name, i.invoice_number
       FROM ar_credit_notes cn
       JOIN customers c ON cn.customer_id = c.id
       LEFT JOIN invoices i ON cn.invoice_id = i.id
       WHERE cn.tenant_id = $1 ORDER BY cn.credit_date DESC, cn.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/ar/credit-notes', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const { customer_id, invoice_id, credit_date, subtotal, tax_amount = 0, reason, lines = [] } = req.body;
    if (!customer_id) throw new Error('Customer is required.');
    const cDate = credit_date || new Date().toISOString().slice(0, 10);
    await financeService.assertOpenPeriod(client, tid, cDate);

    const sub = round2(subtotal || 0);
    const tax = round2(tax_amount || 0);
    const total = round2(sub + tax);
    if (total <= 0) throw new Error('Credit note amount must be greater than zero.');

    const cnNum = await financeService.getNextDocumentNumber(client, tid, 'credit_note');
    const cnRes = await client.query(
      `INSERT INTO ar_credit_notes (tenant_id, customer_id, invoice_id, credit_note_number, credit_date, subtotal, tax_amount, total_amount, applied_amount, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [tid, customer_id, invoice_id || null, cnNum, cDate, sub, tax, total, invoice_id ? total : 0, reason || 'Sales Return / Adjustment', req.user?.id || null]
    );
    const cn = cnRes.rows[0];

    for (const l of lines) {
      await client.query(
        `INSERT INTO ar_credit_note_lines (credit_note_id, description, quantity, unit_price, tax_rate, tax_amount, line_total, account_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [cn.id, l.description || reason || 'Credit Line', l.quantity || 1, l.unit_price || sub, l.tax_rate || 0, l.tax_amount || tax, l.line_total || total, l.account_id || null]
      );
    }

    if (invoice_id) {
      await client.query(
        `UPDATE invoices
         SET credited_amount = COALESCE(credited_amount, 0) + $1,
             status = CASE WHEN (total_amount - COALESCE(paid_amount, 0) - (COALESCE(credited_amount, 0) + $1)) <= 0.01 THEN 'Credited' ELSE status END
         WHERE id = $2 AND tenant_id = $3`,
        [total, invoice_id, tid]
      );
    }

    const ev = await financeService.postAccountingEvent(client, {
      tenantId: tid,
      sourceModule: 'finance',
      eventType: 'CUSTOMER_CREDIT_NOTE',
      sourceId: cn.id,
      sourceNumber: cnNum,
      date: cDate,
      narration: `Customer Credit Note ${cnNum} (${reason || ''})`,
      payload: { customer_id, subtotal: sub, tax_amount: tax, total_amount: total },
      userId: req.user?.id,
      userName: req.user?.full_name
    });
    if (ev.journal?.id) {
      await client.query(`UPDATE ar_credit_notes SET journal_entry_id = $1 WHERE id = $2`, [ev.journal.id, cn.id]);
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: cn, message: `Credit Note ${cnNum} posted.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get('/ar/receipts', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT p.*, COALESCE(c.business_name, ic.business_name) as customer_name, i.invoice_number, b.account_name as bank_account_name
       FROM payments p
       LEFT JOIN invoices i ON p.invoice_id = i.id
       LEFT JOIN customers c ON p.customer_id = c.id
       LEFT JOIN customers ic ON i.customer_id = ic.id
       LEFT JOIN bank_cash_accounts b ON p.bank_account_id = b.id
       WHERE p.tenant_id = $1
       ORDER BY p.payment_date DESC, p.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Record Customer Receipt with Multi-Invoice Allocations, Partial Payments, WHT & Unapplied Cash
router.post('/ar/receipts', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const {
      customer_id, invoice_id, bank_account_id, payment_date, payment_method, reference_number,
      amount, wht_amount = 0, allocations = [], is_advance = false, notes
    } = req.body;

    const pDate = payment_date || new Date().toISOString().slice(0, 10);
    await financeService.assertOpenPeriod(client, tid, pDate);

    const netAmt = round2(amount || 0);
    const whtAmt = round2(wht_amount || 0);
    const grossCleared = round2(netAmt + whtAmt);
    if (grossCleared <= 0) throw new Error('Receipt amount must be greater than zero.');

    // Determine allocations
    const allocList = Array.isArray(allocations) && allocations.length > 0
      ? allocations
      : (invoice_id ? [{ invoice_id, allocated_amount: grossCleared }] : []);

    let totalAllocated = 0;
    for (const a of allocList) {
      const allocVal = round2(a.allocated_amount || 0);
      if (allocVal <= 0) continue;
      const invCheck = await client.query(`SELECT id, total_amount, paid_amount, credited_amount, customer_id FROM invoices WHERE id = $1 AND tenant_id = $2`, [a.invoice_id, tid]);
      if (invCheck.rows.length === 0) throw new Error(`Target invoice not found: ${a.invoice_id}`);
      const inv = invCheck.rows[0];
      const rem = round2(parseFloat(inv.total_amount) - parseFloat(inv.paid_amount || 0) - parseFloat(inv.credited_amount || 0));
      if (allocVal > rem + 0.05) {
        throw new Error(`Allocation (${allocVal}) exceeds invoice remaining balance (${rem}).`);
      }
      totalAllocated = round2(totalAllocated + allocVal);
    }

    if (totalAllocated > grossCleared + 0.05) {
      throw new Error(`Total allocations (${totalAllocated}) exceed receipt gross amount (${grossCleared}).`);
    }
    const unapplied = round2(Math.max(0, grossCleared - totalAllocated));

    let bankCoaId = null;
    if (bank_account_id) {
      const bRes = await client.query(`SELECT id, coa_account_id FROM bank_cash_accounts WHERE id = $1 AND tenant_id = $2`, [bank_account_id, tid]);
      if (bRes.rows.length > 0) {
        bankCoaId = bRes.rows[0].coa_account_id;
        await client.query(`UPDATE bank_cash_accounts SET current_balance = current_balance + $1 WHERE id = $2`, [netAmt, bank_account_id]);
      }
    }

    const payNum = `RCPT-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;
    const primaryInvId = allocList.length === 1 ? allocList[0].invoice_id : (invoice_id || null);

    const payRes = await client.query(
      `INSERT INTO payments (
        tenant_id, customer_id, invoice_id, bank_account_id, payment_number, payment_date, payment_method,
        amount, net_received_amount, income_tax_wht_amount, gross_invoice_amount, reference_number,
        unapplied_amount, is_advance, notes, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,'Posted') RETURNING *`,
      [tid, customer_id || null, primaryInvId, bank_account_id || null, payNum, pDate, payment_method || 'Bank Transfer', netAmt, whtAmt, grossCleared, reference_number || '', unapplied, Boolean(is_advance || unapplied > 0), notes || '']
    );
    const pay = payRes.rows[0];

    for (const a of allocList) {
      const allocVal = round2(a.allocated_amount || 0);
      if (allocVal <= 0) continue;
      await client.query(
        `INSERT INTO ar_receipt_allocations (tenant_id, payment_id, invoice_id, allocated_amount, allocation_date)
         VALUES ($1,$2,$3,$4,$5)`,
        [tid, pay.id, a.invoice_id, allocVal, pDate]
      );
      await client.query(
        `UPDATE invoices
         SET paid_amount = COALESCE(paid_amount, 0) + $1,
             status = CASE WHEN (total_amount - (COALESCE(paid_amount, 0) + $1) - COALESCE(credited_amount, 0)) <= 0.01 THEN 'Paid' ELSE 'Partially Paid' END
         WHERE id = $2`,
        [allocVal, a.invoice_id]
      );
    }

    const ev = await financeService.postAccountingEvent(client, {
      tenantId: tid,
      sourceModule: 'finance',
      eventType: 'CUSTOMER_RECEIPT',
      sourceId: pay.id,
      sourceNumber: payNum,
      date: pDate,
      narration: `Customer Receipt ${payNum} (${payment_method || 'Bank'})`,
      payload: { customer_id, bank_coa_id: bankCoaId, net_amount: netAmt, wht_amount: whtAmt },
      userId: req.user?.id,
      userName: req.user?.full_name
    });
    if (ev.journal?.id) {
      await client.query(`UPDATE payments SET journal_entry_id = $1 WHERE id = $2`, [ev.journal.id, pay.id]);
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: pay, message: `Customer Receipt ${payNum} recorded and posted.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get('/ar/aging', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await financeService.getAgingReport(tid, 'AR');
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/ar/statements/:customerId', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await financeService.getPartyStatement(tid, 'customer', req.params.customerId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 8. ACCOUNTS PAYABLE (Supplier Bills, Credit Notes, Payments & Aging)
// ============================================================================
router.get('/ap/bills', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { search, status, supplier_id } = req.query;
    const params = [tid];
    let where = `b.tenant_id = $1`;
    if (status && status !== 'all') { params.push(status); where += ` AND b.status = $${params.length}`; }
    if (supplier_id && isUuid(supplier_id)) { params.push(supplier_id); where += ` AND b.supplier_id = $${params.length}`; }
    if (search) { params.push(`%${search.trim()}%`); where += ` AND (b.bill_number ILIKE $${params.length} OR b.vendor_invoice_number ILIKE $${params.length} OR s.supplier_name ILIKE $${params.length})`; }

    const q = await db.query(
      `SELECT b.*, s.supplier_name, s.ntn as supplier_ntn,
              GREATEST(0, (b.total_amount - COALESCE(b.paid_amount, 0) - COALESCE(b.credited_amount, 0))) as outstanding_amount,
              COALESCE((SELECT json_agg(bl.*) FROM supplier_bill_lines bl WHERE bl.bill_id = b.id), '[]'::json) as lines
       FROM supplier_bills b
       JOIN suppliers s ON b.supplier_id = s.id
       WHERE ${where}
       ORDER BY b.bill_date DESC, b.created_at DESC`,
      params
    );
    res.json({ success: true, data: q.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/ap/bills', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const {
      supplier_id, business_profile_id, vendor_invoice_number, bill_date, due_date,
      procurement_id, grn_id, currency, exchange_rate, discount_amount = 0,
      lines = [], status = 'Approved', notes
    } = req.body;
    if (!supplier_id) throw new Error('Supplier is required for Accounts Payable bill.');

    // Duplicate Supplier Bill Detection
    if (vendor_invoice_number) {
      const dupBill = await client.query(
        `SELECT id, bill_number FROM supplier_bills WHERE tenant_id = $1 AND supplier_id = $2 AND LOWER(vendor_invoice_number) = LOWER($3) AND status != 'Voided' LIMIT 1`,
        [tid, supplier_id, vendor_invoice_number.trim()]
      );
      if (dupBill.rows.length > 0) {
        throw new Error(`Duplicate Supplier Bill Detected! Vendor invoice "${vendor_invoice_number}" already exists as ${dupBill.rows[0].bill_number}.`);
      }
    }

    const bDate = bill_date || new Date().toISOString().slice(0, 10);
    await financeService.assertOpenPeriod(client, tid, bDate);
    const fx = await financeService.resolveExchangeRate(client, tid, currency, exchange_rate, bDate);
    const billNum = req.body.bill_number || await financeService.getNextDocumentNumber(client, tid, 'bill');

    let subtotal = 0;
    let totalTax = 0;
    const processedLines = [];
    if (Array.isArray(lines) && lines.length > 0) {
      for (const l of lines) {
        const qty = parseFloat(l.quantity || 1);
        const cost = parseFloat(l.unit_cost || 0);
        const lineSub = round2(qty * cost);
        const rate = parseFloat(l.tax_rate || 0);
        const calc = financeService.calculateTaxBreakdown({ amount: lineSub, ratePct: rate, isInclusive: Boolean(l.is_inclusive), isExempt: Boolean(l.is_exempt) });
        subtotal = round2(subtotal + calc.net_amount);
        totalTax = round2(totalTax + calc.tax_amount);
        processedLines.push({ ...l, quantity: qty, unit_cost: cost, tax_rate: calc.effective_rate, tax_amount: calc.tax_amount, line_total: calc.gross_amount });
      }
    } else {
      subtotal = round2(req.body.subtotal || 0);
      totalTax = round2(req.body.tax_amount || 0);
    }

    const totalAmt = round2(Math.max(0, subtotal - round2(discount_amount) + totalTax));
    const bRes = await client.query(
      `INSERT INTO supplier_bills (
        tenant_id, business_profile_id, supplier_id, procurement_id, grn_id, bill_number, vendor_invoice_number,
        bill_date, due_date, currency, exchange_rate, subtotal, discount_amount, tax_amount, total_amount,
        status, notes, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [tid, business_profile_id || null, supplier_id, procurement_id || null, grn_id || null, billNum, vendor_invoice_number || null, bDate, due_date || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), fx.txCurrency, fx.exchangeRate, subtotal, round2(discount_amount), totalTax, totalAmt, status, notes || '', req.user?.id || null]
    );
    const bill = bRes.rows[0];

    const coa = await financeService.ensureCoaMap(client, tid);
    const defaultExpAcc = coa['5300'];
    for (const pl of processedLines) {
      await client.query(
        `INSERT INTO supplier_bill_lines (tenant_id, bill_id, product_id, expense_account_id, description, quantity, unit_cost, tax_code_id, tax_rate, tax_amount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [tid, bill.id, pl.product_id || null, pl.expense_account_id || defaultExpAcc, pl.description || 'Supplier Charge', pl.quantity, pl.unit_cost, pl.tax_code_id || null, pl.tax_rate, pl.tax_amount, pl.line_total]
      );
    }

    if (status === 'Approved' && totalAmt > 0) {
      const expenseAccId = processedLines[0]?.expense_account_id || defaultExpAcc;
      const ev = await financeService.postAccountingEvent(client, {
        tenantId: tid,
        sourceModule: 'finance',
        eventType: 'SUPPLIER_BILL',
        sourceId: bill.id,
        sourceNumber: billNum,
        date: bDate,
        narration: `Supplier Bill ${billNum} (Vendor Ref: ${vendor_invoice_number || 'N/A'})`,
        payload: {
          business_profile_id,
          supplier_id,
          expense_account_id: expenseAccId,
          subtotal: round2(subtotal - round2(discount_amount)),
          tax_amount: totalTax,
          total_amount: totalAmt
        },
        userId: req.user?.id,
        userName: req.user?.full_name
      });
      if (ev.journal?.id) {
        await client.query(`UPDATE supplier_bills SET gl_posted = TRUE, journal_entry_id = $1 WHERE id = $2`, [ev.journal.id, bill.id]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: bill, message: `Supplier Bill ${billNum} created.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get('/ap/payments', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT sp.*, s.supplier_name, b.account_name as bank_account_name
       FROM supplier_payments sp
       JOIN suppliers s ON sp.supplier_id = s.id
       LEFT JOIN bank_cash_accounts b ON sp.bank_account_id = b.id
       WHERE sp.tenant_id = $1 ORDER BY sp.payment_date DESC, sp.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/ap/payments', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const {
      supplier_id, bank_account_id, payment_date, payment_method, reference_number,
      net_paid_amount, wht_deducted = 0, allocations = [], bill_id, is_advance = false, notes
    } = req.body;
    if (!supplier_id) throw new Error('Supplier is required.');

    const pDate = payment_date || new Date().toISOString().slice(0, 10);
    await financeService.assertOpenPeriod(client, tid, pDate);

    const netAmt = round2(net_paid_amount || 0);
    const whtAmt = round2(wht_deducted || 0);
    const grossSettled = round2(netAmt + whtAmt);
    if (grossSettled <= 0) throw new Error('Payment amount must be greater than zero.');

    const allocList = Array.isArray(allocations) && allocations.length > 0
      ? allocations
      : (bill_id ? [{ bill_id, allocated_amount: grossSettled }] : []);

    let totalAlloc = 0;
    for (const a of allocList) {
      const val = round2(a.allocated_amount || 0);
      if (val <= 0) continue;
      const bCheck = await client.query(`SELECT id, total_amount, paid_amount, credited_amount FROM supplier_bills WHERE id = $1 AND tenant_id = $2`, [a.bill_id, tid]);
      if (bCheck.rows.length === 0) throw new Error('Supplier bill not found.');
      const b = bCheck.rows[0];
      const rem = round2(parseFloat(b.total_amount) - parseFloat(b.paid_amount || 0) - parseFloat(b.credited_amount || 0));
      if (val > rem + 0.05) throw new Error(`Allocation (${val}) exceeds remaining bill payable (${rem}).`);
      totalAlloc = round2(totalAlloc + val);
    }

    const unapplied = round2(Math.max(0, grossSettled - totalAlloc));
    let bankCoaId = null;
    if (bank_account_id) {
      const bRes = await client.query(`SELECT id, coa_account_id FROM bank_cash_accounts WHERE id = $1 AND tenant_id = $2`, [bank_account_id, tid]);
      if (bRes.rows.length > 0) {
        bankCoaId = bRes.rows[0].coa_account_id;
        await client.query(`UPDATE bank_cash_accounts SET current_balance = current_balance - $1 WHERE id = $2`, [netAmt, bank_account_id]);
      }
    }

    const payNum = `VPAY-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;
    const spRes = await client.query(
      `INSERT INTO supplier_payments (
        tenant_id, supplier_id, bank_account_id, payment_number, payment_date, payment_method,
        reference_number, gross_amount, wht_deducted, net_paid_amount, unapplied_amount, is_advance, notes, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [tid, supplier_id, bank_account_id || null, payNum, pDate, payment_method || 'Bank Transfer', reference_number || '', grossSettled, whtAmt, netAmt, unapplied, Boolean(is_advance || unapplied > 0), notes || '', req.user?.id || null]
    );
    const sp = spRes.rows[0];

    for (const a of allocList) {
      const val = round2(a.allocated_amount || 0);
      if (val <= 0) continue;
      await client.query(`INSERT INTO ap_payment_allocations (tenant_id, supplier_payment_id, bill_id, allocated_amount, allocation_date) VALUES ($1,$2,$3,$4,$5)`, [tid, sp.id, a.bill_id, val, pDate]);
      await client.query(
        `UPDATE supplier_bills
         SET paid_amount = COALESCE(paid_amount, 0) + $1,
             status = CASE WHEN (total_amount - (COALESCE(paid_amount, 0) + $1) - COALESCE(credited_amount, 0)) <= 0.01 THEN 'Paid' ELSE 'Partially Paid' END
         WHERE id = $2`,
        [val, a.bill_id]
      );
    }

    const ev = await financeService.postAccountingEvent(client, {
      tenantId: tid,
      sourceModule: 'finance',
      eventType: 'SUPPLIER_PAYMENT',
      sourceId: sp.id,
      sourceNumber: payNum,
      date: pDate,
      narration: `Supplier Payment ${payNum} (${payment_method || 'Bank'})`,
      payload: { supplier_id, bank_coa_id: bankCoaId, net_amount: netAmt, wht_amount: whtAmt },
      userId: req.user?.id,
      userName: req.user?.full_name
    });
    if (ev.journal?.id) {
      await client.query(`UPDATE supplier_payments SET journal_entry_id = $1 WHERE id = $2`, [ev.journal.id, sp.id]);
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: sp, message: `Supplier Payment ${payNum} posted.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get('/ap/aging', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await financeService.getAgingReport(tid, 'AP');
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/ap/statements/:supplierId', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await financeService.getPartyStatement(tid, 'supplier', req.params.supplierId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 9. CASH & BANK MANAGEMENT, TRANSFERS & RECONCILIATION
// ============================================================================
router.get('/bank-accounts', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT b.*, a.account_code, a.account_name as coa_name
       FROM bank_cash_accounts b
       LEFT JOIN coa_accounts a ON b.coa_account_id = a.id
       WHERE b.tenant_id = $1 ORDER BY b.account_type DESC, b.account_name ASC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/bank-accounts', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { account_name, account_type = 'Bank', bank_name, account_number, iban, branch_code, currency = 'PKR', coa_account_id, opening_balance = 0 } = req.body;
    if (!account_name) return res.status(400).json({ success: false, message: 'Account title is required.' });
    const coa = await financeService.ensureCoaMap(null, tid);
    const linkedCoa = coa_account_id || (account_type === 'Cash' ? coa['1001'] : coa['1010']);
    const openBal = round2(opening_balance);
    const r = await db.query(
      `INSERT INTO bank_cash_accounts (tenant_id, account_name, account_type, bank_name, account_number, iban, branch_code, currency, coa_account_id, opening_balance, current_balance)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
      [tid, account_name, account_type, bank_name || '', account_number || '', iban || '', branch_code || '', currency, linkedCoa, openBal]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/bank-transfers', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT t.*, fa.account_name as from_account_name, ta.account_name as to_account_name
       FROM bank_cash_transfers t
       JOIN bank_cash_accounts fa ON t.from_account_id = fa.id
       JOIN bank_cash_accounts ta ON t.to_account_id = ta.id
       WHERE t.tenant_id = $1 ORDER BY t.transfer_date DESC, t.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/bank-transfers', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const { from_account_id, to_account_id, transfer_date, amount, reference_number, notes } = req.body;
    if (!from_account_id || !to_account_id || from_account_id === to_account_id) {
      throw new Error('Select two different source and destination Cash/Bank accounts.');
    }
    const amt = round2(amount || 0);
    if (amt <= 0) throw new Error('Transfer amount must be positive.');

    const tDate = transfer_date || new Date().toISOString().slice(0, 10);
    await financeService.assertOpenPeriod(client, tid, tDate);

    const fromRes = await client.query(`SELECT * FROM bank_cash_accounts WHERE id = $1 AND tenant_id = $2`, [from_account_id, tid]);
    const toRes = await client.query(`SELECT * FROM bank_cash_accounts WHERE id = $1 AND tenant_id = $2`, [to_account_id, tid]);
    if (fromRes.rows.length === 0 || toRes.rows.length === 0) throw new Error('Account not found.');

    const fromAcc = fromRes.rows[0];
    const toAcc = toRes.rows[0];
    const trfNum = `TRF-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    const trfRes = await client.query(
      `INSERT INTO bank_cash_transfers (tenant_id, transfer_number, transfer_date, from_account_id, to_account_id, amount, reference_number, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, trfNum, tDate, from_account_id, to_account_id, amt, reference_number || '', notes || '', req.user?.id || null]
    );

    await client.query(`UPDATE bank_cash_accounts SET current_balance = current_balance - $1 WHERE id = $2`, [amt, from_account_id]);
    await client.query(`UPDATE bank_cash_accounts SET current_balance = current_balance + $1 WHERE id = $2`, [amt, to_account_id]);

    if (fromAcc.coa_account_id && toAcc.coa_account_id && fromAcc.coa_account_id !== toAcc.coa_account_id) {
      const ev = await financeService.postAccountingEvent(client, {
        tenantId: tid,
        sourceModule: 'finance',
        eventType: 'BANK_TRANSFER',
        sourceId: trfRes.rows[0].id,
        sourceNumber: trfNum,
        date: tDate,
        narration: `Fund Transfer: ${fromAcc.account_name} -> ${toAcc.account_name}`,
        payload: { from_coa_id: fromAcc.coa_account_id, to_coa_id: toAcc.coa_account_id, total_amount: amt },
        userId: req.user?.id,
        userName: req.user?.full_name
      });
      if (ev.journal?.id) {
        await client.query(`UPDATE bank_cash_transfers SET journal_entry_id = $1 WHERE id = $2`, [ev.journal.id, trfRes.rows[0].id]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: trfRes.rows[0], message: `Transfer ${trfNum} completed.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get('/bank-reconciliations', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT br.*, b.account_name,
              COALESCE((SELECT json_agg(bsl.* ORDER BY bsl.transaction_date ASC) FROM bank_statement_lines bsl WHERE bsl.reconciliation_id = br.id), '[]'::json) as statement_lines
       FROM bank_reconciliations br
       JOIN bank_cash_accounts b ON br.bank_account_id = b.id
       WHERE br.tenant_id = $1 ORDER BY br.statement_end_date DESC, br.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/bank-reconciliations', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const { bank_account_id, statement_start_date, statement_end_date, opening_statement_balance = 0, closing_statement_balance, statement_lines = [] } = req.body;
    if (!bank_account_id || closing_statement_balance === undefined) throw new Error('Bank account and closing statement balance are required.');

    const accRes = await client.query(`SELECT current_balance FROM bank_cash_accounts WHERE id = $1 AND tenant_id = $2`, [bank_account_id, tid]);
    if (accRes.rows.length === 0) throw new Error('Bank account not found.');
    const bookBal = round2(accRes.rows[0].current_balance);
    const closeStmt = round2(closing_statement_balance);
    const diff = round2(closeStmt - bookBal);

    const recRes = await client.query(
      `INSERT INTO bank_reconciliations (tenant_id, bank_account_id, statement_start_date, statement_end_date, opening_statement_balance, closing_statement_balance, book_balance, reconciled_difference, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, bank_account_id, statement_start_date || new Date().toISOString().slice(0, 10), statement_end_date || new Date().toISOString().slice(0, 10), round2(opening_statement_balance), closeStmt, bookBal, diff, Math.abs(diff) < 0.01 ? 'Reconciled' : 'In Progress']
    );
    const rec = recRes.rows[0];

    for (const sl of statement_lines) {
      await client.query(
        `INSERT INTO bank_statement_lines (tenant_id, reconciliation_id, transaction_date, description, reference_number, debit_withdrawal, credit_deposit)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, rec.id, sl.transaction_date || statement_end_date, sl.description || '', sl.reference_number || '', round2(sl.debit_withdrawal || 0), round2(sl.credit_deposit || 0)]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: rec, message: `Bank reconciliation started (Difference: ${diff.toFixed(2)}).` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/bank-reconciliations/:id/match', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { statement_line_id, matched_journal_line_id, is_matched = true, discrepancy_note } = req.body;
    const r = await db.query(
      `UPDATE bank_statement_lines
       SET is_matched = $1, matched_journal_line_id = $2, discrepancy_note = $3
       WHERE id = $4 AND reconciliation_id = $5 AND tenant_id = $6 RETURNING *`,
      [Boolean(is_matched), matched_journal_line_id || null, discrepancy_note || null, statement_line_id, req.params.id, tid]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/bank-reconciliations/:id/complete', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const upd = await db.query(
      `UPDATE bank_reconciliations SET status = 'Reconciled', reconciled_by = $1, reconciled_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [req.user?.id || null, req.params.id, tid]
    );
    res.json({ success: true, data: upd.rows[0], message: 'Bank statement reconciliation completed.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 10. EXPENSES, APPROVALS & BUDGETS
// ============================================================================
router.get('/expenses', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT e.*, a.account_code, a.account_name
       FROM general_expenses e
       LEFT JOIN coa_accounts a ON e.coa_account_id = a.id
       WHERE e.tenant_id = $1 ORDER BY e.expense_date DESC, e.created_at DESC LIMIT 200`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/expenses', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const {
      expense_name, category, expense_tier, expense_date, amount, tax_amount = 0,
      payment_mode, bank_account_id, coa_account_id, is_recurring = false,
      recurrence_frequency, status = 'Approved', notes
    } = req.body;
    const eDate = expense_date || new Date().toISOString().slice(0, 10);
    await financeService.assertOpenPeriod(client, tid, eDate);

    const amt = round2(amount || 0);
    const tax = round2(tax_amount || 0);
    if (amt <= 0) throw new Error('Expense amount must be positive.');

    const r = await client.query(
      `INSERT INTO general_expenses (
        tenant_id, expense_name, title, category, expense_tier, expense_date, amount, tax_amount,
        payment_mode, bank_account_id, coa_account_id, is_recurring, recurrence_frequency, status, notes
      ) VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [tid, expense_name || category || 'General Expense', category || 'General Overhead', expense_tier || 'Tier 3 - General Overheads', eDate, amt, tax, payment_mode || 'Bank Transfer', bank_account_id || null, coa_account_id || null, Boolean(is_recurring), recurrence_frequency || null, status, notes || '']
    );
    const exp = r.rows[0];

    if (status === 'Approved' || status === 'Paid') {
      let bankCoaId = null;
      if (bank_account_id) {
        const bRes = await client.query(`SELECT coa_account_id FROM bank_cash_accounts WHERE id = $1`, [bank_account_id]);
        bankCoaId = bRes.rows[0]?.coa_account_id || null;
        await client.query(`UPDATE bank_cash_accounts SET current_balance = current_balance - $1 WHERE id = $2`, [amt, bank_account_id]);
      }
      const ev = await financeService.postAccountingEvent(client, {
        tenantId: tid,
        sourceModule: 'finance',
        eventType: 'EXPENSE_CLAIM',
        sourceId: exp.id,
        sourceNumber: `EXP-${exp.id.slice(0, 6).toUpperCase()}`,
        date: eDate,
        narration: `Expense: ${exp.expense_name} (${exp.category})`,
        payload: { coa_account_id, bank_coa_id: bankCoaId, subtotal: round2(amt - tax), tax_amount: tax, total_amount: amt },
        userId: req.user?.id,
        userName: req.user?.full_name
      });
      if (ev.journal?.id) {
        await client.query(`UPDATE general_expenses SET journal_entry_id = $1 WHERE id = $2`, [ev.journal.id, exp.id]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: exp, message: 'Expense recorded cleanly.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get('/budgets', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT b.*, a.account_code, a.account_name, fy.year_name
       FROM expense_budgets b
       LEFT JOIN coa_accounts a ON b.coa_account_id = a.id
       LEFT JOIN fiscal_years fy ON b.fiscal_year_id = fy.id
       WHERE b.tenant_id = $1 ORDER BY b.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/budgets', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { fiscal_year_id, coa_account_id, category_name, period_month, budget_amount, notes } = req.body;
    const r = await db.query(
      `INSERT INTO expense_budgets (tenant_id, fiscal_year_id, coa_account_id, category_name, period_month, budget_amount, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tid, fiscal_year_id || null, coa_account_id || null, category_name || 'General Expense', period_month || null, round2(budget_amount), notes || '', req.user?.id || null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 11. FIXED ASSETS SUBMODULE (Register, Depreciation Run & Disposal)
// ============================================================================
router.get('/fixed-assets', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(`SELECT * FROM fixed_assets WHERE tenant_id = $1 ORDER BY acquisition_date DESC, asset_code ASC`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/fixed-assets', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const {
      asset_code, asset_name, category = 'Equipment & Machinery', acquisition_date,
      acquisition_cost, salvage_value = 0, useful_life_years = 5, depreciation_method = 'Straight-Line',
      annual_depreciation_rate = 20, location, serial_number, notes, post_acquisition_jv = true, payment_coa_id
    } = req.body;
    if (!asset_code || !asset_name || !acquisition_cost) throw new Error('Asset code, name, and acquisition cost are required.');

    const cost = round2(acquisition_cost);
    const salvage = round2(salvage_value);
    const coa = await financeService.ensureCoaMap(client, tid);
    const assetCoaId = req.body.asset_coa_id || coa['1500'];
    const accumCoaId = req.body.accum_dep_coa_id || coa['1590'];
    const depExpCoaId = req.body.dep_expense_coa_id || coa['5500'];
    const acqDate = acquisition_date || new Date().toISOString().slice(0, 10);

    const aRes = await client.query(
      `INSERT INTO fixed_assets (
        tenant_id, asset_code, asset_name, category, acquisition_date, acquisition_cost, salvage_value,
        useful_life_years, depreciation_method, annual_depreciation_rate, accumulated_depreciation, net_book_value,
        asset_coa_id, accum_dep_coa_id, dep_expense_coa_id, location, serial_number, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$6,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [tid, asset_code.trim(), asset_name.trim(), category, acqDate, cost, salvage, parseFloat(useful_life_years), depreciation_method, parseFloat(annual_depreciation_rate), assetCoaId, accumCoaId, depExpCoaId, location || '', serial_number || '', notes || '']
    );
    const asset = aRes.rows[0];

    if (post_acquisition_jv && cost > 0) {
      await financeService.assertOpenPeriod(client, tid, acqDate);
      const creditCoa = payment_coa_id || coa['1010'] || coa['2001'];
      await financeService.postAccountingEvent(client, {
        tenantId: tid,
        sourceModule: 'finance',
        eventType: 'ASSET_ACQUISITION',
        sourceId: asset.id,
        sourceNumber: asset.asset_code,
        date: acqDate,
        narration: `Fixed Asset Acquisition: ${asset.asset_name} [${asset.asset_code}]`,
        lines: [
          { account_id: assetCoaId, debit: cost, credit: 0, line_description: `Capitalized Asset: ${asset.asset_name}` },
          { account_id: creditCoa, debit: 0, credit: cost, line_description: `Payment / Payable for ${asset.asset_code}` }
        ],
        userId: req.user?.id,
        userName: req.user?.full_name
      });
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: asset, message: `Fixed Asset ${asset_code} registered.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/fixed-assets/run-depreciation', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const summary = await financeService.runFixedAssetDepreciation(client, tid, {
      year: req.body.year,
      month: req.body.month,
      userId: req.user?.id,
      userName: req.user?.full_name
    });
    await client.query('COMMIT');
    res.json({ success: true, data: summary, message: `Depreciation executed for ${summary.assets_processed} assets (Total: ${summary.total_depreciation.toFixed(2)}).` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/fixed-assets/:id/dispose', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const { disposal_date, disposal_proceeds = 0, bank_coa_id } = req.body;
    const aRes = await client.query(`SELECT * FROM fixed_assets WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (aRes.rows.length === 0) throw new Error('Fixed asset not found.');
    const asset = aRes.rows[0];
    if (asset.status === 'Disposed') throw new Error('Asset is already disposed.');

    const dDate = disposal_date || new Date().toISOString().slice(0, 10);
    await financeService.assertOpenPeriod(client, tid, dDate);

    const proceeds = round2(disposal_proceeds);
    const cost = round2(asset.acquisition_cost);
    const accum = round2(asset.accumulated_depreciation);
    const nbv = round2(cost - accum);
    const gainLoss = round2(proceeds - nbv);

    const coa = await financeService.ensureCoaMap(client, tid);
    const depBankCoa = bank_coa_id || coa['1010'];
    const gainLossCoa = gainLoss >= 0 ? (coa['4200'] || coa['4001']) : coa['5300'];

    const lines = [];
    if (proceeds > 0) lines.push({ account_id: depBankCoa, debit: proceeds, credit: 0, line_description: `Disposal Proceeds: ${asset.asset_code}` });
    if (accum > 0) lines.push({ account_id: asset.accum_dep_coa_id || coa['1590'], debit: accum, credit: 0, line_description: `Clear Accum. Depreciation: ${asset.asset_code}` });
    lines.push({ account_id: asset.asset_coa_id || coa['1500'], debit: 0, credit: cost, line_description: `Derecognize Asset Cost: ${asset.asset_code}` });
    if (gainLoss > 0) {
      lines.push({ account_id: gainLossCoa, debit: 0, credit: gainLoss, line_description: `Gain on Asset Disposal: ${asset.asset_code}` });
    } else if (gainLoss < 0) {
      lines.push({ account_id: gainLossCoa, debit: Math.abs(gainLoss), credit: 0, line_description: `Loss on Asset Disposal: ${asset.asset_code}` });
    }

    await financeService.postAccountingEvent(client, {
      tenantId: tid,
      sourceModule: 'finance',
      eventType: 'ASSET_DISPOSAL',
      sourceId: asset.id,
      sourceNumber: asset.asset_code,
      date: dDate,
      narration: `Disposal of Fixed Asset ${asset.asset_name} [${asset.asset_code}]`,
      lines,
      userId: req.user?.id,
      userName: req.user?.full_name
    });

    const upd = await client.query(
      `UPDATE fixed_assets SET status = 'Disposed', disposal_date = $1, disposal_proceeds = $2, disposal_gain_loss = $3, net_book_value = 0 WHERE id = $4 RETURNING *`,
      [dDate, proceeds, gainLoss, asset.id]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: upd.rows[0], message: `Asset ${asset.asset_code} disposed (Gain/Loss: ${gainLoss.toFixed(2)}).` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 12. FINANCIAL STATEMENTS (Trial Balance, P&L, Balance Sheet, Cash Flow)
// ============================================================================
router.get('/statements/trial-balance', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await financeService.getTrialBalance(tid, { fromDate: req.query.from_date, toDate: req.query.to_date });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/statements/profit-loss', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await financeService.getProfitAndLoss(tid, {
      fromDate: req.query.from_date,
      toDate: req.query.to_date,
      compareFromDate: req.query.compare_from,
      compareToDate: req.query.compare_to
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/statements/balance-sheet', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await financeService.getBalanceSheet(tid, { asOfDate: req.query.as_of_date });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/statements/cash-flow', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await financeService.getCashFlowStatement(tid, { fromDate: req.query.from_date, toDate: req.query.to_date });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 13. AUDIT TRAIL, POSTING EVENTS & IDEMPOTENT SUBLEDGER SYNC
// ============================================================================
router.get('/audit-logs', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(`SELECT * FROM finance_audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/posting-events', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT pe.*, je.entry_number FROM finance_posting_events pe
       LEFT JOIN journal_entries je ON pe.journal_entry_id = je.id
       WHERE pe.tenant_id = $1 ORDER BY pe.created_at DESC LIMIT 150`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/sync-subledgers', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    let synced = 0;

    const [invs, pays, bills] = await Promise.all([
      client.query(`SELECT * FROM invoices WHERE tenant_id = $1 AND status NOT IN ('Draft','Voided','Cancelled') AND total_amount > 0`, [tid]),
      client.query(`SELECT * FROM payments WHERE tenant_id = $1 AND amount > 0`, [tid]),
      client.query(`SELECT * FROM supplier_bills WHERE tenant_id = $1 AND status NOT IN ('Draft','Voided') AND total_amount > 0`, [tid])
    ]);

    for (const inv of invs.rows) {
      const ev = await financeService.postAccountingEvent(client, {
        tenantId: tid, sourceModule: 'finance', eventType: 'CUSTOMER_INVOICE',
        sourceId: inv.id, sourceNumber: inv.invoice_number, date: inv.invoice_date,
        narration: `Synced Customer Invoice ${inv.invoice_number}`,
        payload: { business_profile_id: inv.business_profile_id, customer_id: inv.customer_id, subtotal: round2(parseFloat(inv.total_amount) - parseFloat(inv.tax_amount || 0)), tax_amount: round2(inv.tax_amount || 0), total_amount: round2(inv.total_amount) },
        userId: req.user?.id
      });
      if (ev.action === 'posted') synced++;
    }

    for (const pay of pays.rows) {
      const ev = await financeService.postAccountingEvent(client, {
        tenantId: tid, sourceModule: 'finance', eventType: 'CUSTOMER_RECEIPT',
        sourceId: pay.id, sourceNumber: pay.payment_number || pay.id.slice(0, 8), date: pay.payment_date,
        narration: `Synced Customer Payment ${pay.payment_number || ''}`,
        payload: { customer_id: pay.customer_id, net_amount: round2(pay.net_received_amount || pay.amount), wht_amount: round2(pay.income_tax_wht_amount || 0) },
        userId: req.user?.id
      });
      if (ev.action === 'posted') synced++;
    }

    for (const b of bills.rows) {
      const ev = await financeService.postAccountingEvent(client, {
        tenantId: tid, sourceModule: 'finance', eventType: 'SUPPLIER_BILL',
        sourceId: b.id, sourceNumber: b.bill_number, date: b.bill_date,
        narration: `Synced Supplier Bill ${b.bill_number}`,
        payload: { supplier_id: b.supplier_id, subtotal: round2(parseFloat(b.total_amount) - parseFloat(b.tax_amount || 0)), tax_amount: round2(b.tax_amount || 0), total_amount: round2(b.total_amount) },
        userId: req.user?.id
      });
      if (ev.action === 'posted') synced++;
    }

    await client.query('COMMIT');
    res.json({ success: true, synced_count: synced, message: `Idempotent Ledger Sync complete. ${synced} new vouchers posted.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// Allocate Unapplied Customer Receipt to Invoice(s)
router.post('/ar/receipts/:id/allocate', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const payRes = await client.query(`SELECT * FROM payments WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (payRes.rows.length === 0) throw new Error('Receipt not found.');
    const pay = payRes.rows[0];
    let unapplied = round2(pay.unapplied_amount || 0);

    const allocs = Array.isArray(req.body.allocations) ? req.body.allocations : [];
    for (const a of allocs) {
      const val = round2(a.allocated_amount || 0);
      if (val <= 0 || val > unapplied + 0.01) throw new Error(`Invalid allocation amount (${val}) vs unapplied balance (${unapplied}).`);
      await client.query(
        `INSERT INTO ar_receipt_allocations (tenant_id, payment_id, invoice_id, allocated_amount) VALUES ($1,$2,$3,$4)`,
        [tid, pay.id, a.invoice_id, val]
      );
      await client.query(
        `UPDATE invoices SET paid_amount = COALESCE(paid_amount,0) + $1,
         status = CASE WHEN (total_amount - (COALESCE(paid_amount,0) + $1) - COALESCE(credited_amount,0)) <= 0.01 THEN 'Paid' ELSE 'Partially Paid' END
         WHERE id = $2 AND tenant_id = $3`,
        [val, a.invoice_id, tid]
      );
      unapplied = round2(unapplied - val);
    }
    await client.query(`UPDATE payments SET unapplied_amount = $1 WHERE id = $2`, [unapplied, pay.id]);
    await client.query('COMMIT');
    res.json({ success: true, unapplied_amount: unapplied, message: 'Receipt allocated cleanly.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// Supplier Bill Approve & Void + Supplier Credit Notes
router.post('/ap/bills/:id/approve', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const bRes = await client.query(`SELECT * FROM supplier_bills WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (bRes.rows.length === 0) throw new Error('Bill not found.');
    const bill = bRes.rows[0];
    if (bill.status === 'Voided') throw new Error('Voided bill cannot be approved.');
    await client.query(`UPDATE supplier_bills SET status = 'Approved', approved_by = $1, approved_at = NOW() WHERE id = $2`, [req.user?.id || null, bill.id]);
    if (!bill.gl_posted && parseFloat(bill.total_amount) > 0) {
      const ev = await financeService.postAccountingEvent(client, {
        tenantId: tid, sourceModule: 'finance', eventType: 'SUPPLIER_BILL',
        sourceId: bill.id, sourceNumber: bill.bill_number, date: bill.bill_date,
        narration: `Supplier Bill ${bill.bill_number}`,
        payload: { supplier_id: bill.supplier_id, subtotal: round2(parseFloat(bill.total_amount) - parseFloat(bill.tax_amount || 0)), tax_amount: round2(bill.tax_amount || 0), total_amount: round2(bill.total_amount) },
        userId: req.user?.id
      });
      if (ev.journal?.id) await client.query(`UPDATE supplier_bills SET gl_posted = TRUE, journal_entry_id = $1 WHERE id = $2`, [ev.journal.id, bill.id]);
    }
    await client.query('COMMIT');
    res.json({ success: true, message: `Bill ${bill.bill_number} approved.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/ap/bills/:id/void', ...finAuth, requirePermission('accounting', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const bRes = await client.query(`SELECT * FROM supplier_bills WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (bRes.rows.length === 0) throw new Error('Bill not found.');
    const bill = bRes.rows[0];
    if (parseFloat(bill.paid_amount || 0) > 0) throw new Error('Cannot void a bill with payments applied.');
    await client.query(`UPDATE supplier_bills SET status = 'Voided', voided_at = NOW(), void_reason = $1 WHERE id = $2`, [req.body.reason || 'Voided', bill.id]);
    if (bill.journal_entry_id) {
      await financeService.reverseJournal(client, tid, bill.journal_entry_id, { reason: req.body.reason || `Bill ${bill.bill_number} voided`, userId: req.user?.id });
    }
    await client.query('COMMIT');
    res.json({ success: true, message: `Bill ${bill.bill_number} voided.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get('/ap/credit-notes', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT acn.*, s.supplier_name, sb.bill_number
       FROM ap_credit_notes acn
       JOIN suppliers s ON acn.supplier_id = s.id
       LEFT JOIN supplier_bills sb ON acn.bill_id = sb.id
       WHERE acn.tenant_id = $1 ORDER BY acn.credit_date DESC`,
      [tid]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/ap/credit-notes', ...finAuth, requirePermission('accounting', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const { supplier_id, bill_id, credit_date, subtotal, tax_amount = 0, reason } = req.body;
    if (!supplier_id) throw new Error('Supplier is required.');
    const cDate = credit_date || new Date().toISOString().slice(0, 10);
    await financeService.assertOpenPeriod(client, tid, cDate);
    const sub = round2(subtotal || 0);
    const tax = round2(tax_amount || 0);
    const total = round2(sub + tax);
    const cnNum = `VCN-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;
    const r = await client.query(
      `INSERT INTO ap_credit_notes (tenant_id, supplier_id, bill_id, credit_note_number, credit_date, subtotal, tax_amount, total_amount, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [tid, supplier_id, bill_id || null, cnNum, cDate, sub, tax, total, reason || 'Supplier Credit', req.user?.id || null]
    );
    if (bill_id) {
      await client.query(
        `UPDATE supplier_bills SET credited_amount = COALESCE(credited_amount,0) + $1,
         status = CASE WHEN (total_amount - COALESCE(paid_amount,0) - (COALESCE(credited_amount,0) + $1)) <= 0.01 THEN 'Credited' ELSE status END
         WHERE id = $2`,
        [total, bill_id]
      );
    }
    const ev = await financeService.postAccountingEvent(client, {
      tenantId: tid, sourceModule: 'finance', eventType: 'SUPPLIER_CREDIT_NOTE',
      sourceId: r.rows[0].id, sourceNumber: cnNum, date: cDate,
      narration: `Supplier Credit Note ${cnNum}`, payload: { supplier_id, subtotal: sub, tax_amount: tax, total_amount: total }, userId: req.user?.id
    });
    if (ev.journal?.id) await client.query(`UPDATE ap_credit_notes SET journal_entry_id = $1 WHERE id = $2`, [ev.journal.id, r.rows[0].id]);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// Budget vs Actual Comparison
router.get('/budgets/vs-actual', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT b.*, a.account_code, a.account_name,
              COALESCE((
                SELECT SUM(jl.debit - jl.credit)
                FROM journal_entry_lines jl
                JOIN journal_entries je ON jl.journal_entry_id = je.id
                WHERE jl.account_id = b.coa_account_id AND je.tenant_id = $1 AND COALESCE(je.is_posted, TRUE) = TRUE
              ), 0) as actual_amount
       FROM expense_budgets b
       LEFT JOIN coa_accounts a ON b.coa_account_id = a.id
       WHERE b.tenant_id = $1`,
      [tid]
    );
    const data = r.rows.map(row => {
      const budget = round2(row.budget_amount);
      const actual = round2(row.actual_amount);
      return { ...row, budget_amount: budget, actual_amount: actual, variance: round2(budget - actual), utilization_pct: budget > 0 ? round2((actual / budget) * 100) : 0 };
    });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Fixed Asset Detail & History
router.get('/fixed-assets/:id', ...finAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const [aRes, logRes] = await Promise.all([
      db.query(`SELECT * FROM fixed_assets WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]),
      db.query(`SELECT * FROM fixed_asset_depreciation_logs WHERE asset_id = $1 AND tenant_id = $2 ORDER BY period_year DESC, period_month DESC`, [req.params.id, tid])
    ]);
    if (aRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Asset not found.' });
    res.json({ success: true, data: { asset: aRes.rows[0], depreciation_logs: logRes.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Authorized Cross-Module Integration Hook (Tender / Inventory / Payroll / Manufacturing)
router.post('/integrations/post-event', ...finAuth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const result = await financeService.postAccountingEvent(client, {
      tenantId: tid,
      sourceModule: req.body.source_module || 'finance',
      eventType: req.body.event_type,
      sourceId: req.body.source_id,
      sourceNumber: req.body.source_number,
      date: req.body.date,
      narration: req.body.narration,
      payload: req.body.payload || {},
      lines: req.body.lines || null,
      userId: req.user?.id,
      userName: req.user?.full_name
    });
    await client.query('COMMIT');
    res.json(result);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
