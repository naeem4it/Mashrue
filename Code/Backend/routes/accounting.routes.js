/**
 * ============================================================================
 * MODULE 6: FINANCIAL ACCOUNTING & DOUBLE-ENTRY GENERAL LEDGER (GL)
 * ============================================================================
 * Dedicated standalone route controller for:
 *  - Hierarchical Chart of Accounts (coa_accounts)
 *  - Balanced Double-Entry Journal Vouchers (journal_entries, journal_entry_lines)
 *  - Trial Balance, Profit & Loss (P&L), Balance Sheet & AR/AP Aging (0-30, 31-60, 61-90, 90+ days)
 *  - 1-Click Historical Subledger Auto-Sync (Invoices, Payments, Expenses)
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireModuleLicense, resolveTenantId } = require('../middleware/rbac.middleware');
const { ensureTenantCoaMap, autoPostInvoiceToGL, autoPostPaymentToGL, autoPostExpenseToGL } = require('../utils/glPoster');

// GET Chart of Accounts with Running Debit / Credit / Net Balances
router.get('/coa', authenticate, requireModuleLicense('mod_accounting'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    await ensureTenantCoaMap(tenantId);
    const result = await db.query(
      `SELECT a.*,
              COALESCE((SELECT SUM(jl.debit) FROM journal_entry_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id WHERE jl.account_id = a.id AND je.tenant_id = $1), 0) as total_debit,
              COALESCE((SELECT SUM(jl.credit) FROM journal_entry_lines jl JOIN journal_entries je ON jl.journal_entry_id = je.id WHERE jl.account_id = a.id AND je.tenant_id = $1), 0) as total_credit
       FROM coa_accounts a
       WHERE a.tenant_id = $1
       ORDER BY a.account_code ASC`,
      [tenantId]
    );

    const accounts = result.rows.map(r => {
      const dr = parseFloat(r.total_debit || 0);
      const cr = parseFloat(r.total_credit || 0);
      const isDebitNormal = ['Asset', 'Expense'].includes(r.account_type);
      const netBalance = isDebitNormal ? (dr - cr) : (cr - dr);
      return { ...r, total_debit: dr, total_credit: cr, net_balance: netBalance };
    });

    res.json({ success: true, data: accounts });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Create Chart of Accounts Entry
router.post('/coa', authenticate, requireModuleLicense('mod_accounting'), async (req, res) => {
  const { account_code, account_name, account_type, account_sub_type, is_reconcilable } = req.body;
  if (!account_code || !account_name || !account_type) {
    return res.status(400).json({ success: false, message: 'Account Code, Name, and Type are required.' });
  }
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(
      `INSERT INTO coa_accounts (tenant_id, account_code, account_name, account_type, account_sub_type, is_reconcilable)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tenantId, account_code.trim(), account_name.trim(), account_type, account_sub_type || account_type, !!is_reconcilable]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Journal Entries
router.get('/journal-entries', authenticate, requireModuleLicense('mod_accounting'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(
      `SELECT je.*,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', jl.id,
                  'account_id', jl.account_id,
                  'account_code', a.account_code,
                  'account_name', a.account_name,
                  'account_type', a.account_type,
                  'line_description', jl.line_description,
                  'debit', jl.debit,
                  'credit', jl.credit
                ))
                FROM journal_entry_lines jl
                LEFT JOIN coa_accounts a ON jl.account_id = a.id
                WHERE jl.journal_entry_id = je.id
              ), '[]'::json) as lines
       FROM journal_entries je
       WHERE je.tenant_id = $1
       ORDER BY je.entry_date DESC, je.created_at DESC LIMIT 250`,
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Create Balanced Journal Voucher (Enforces Double-Entry Debit == Credit)
router.post('/journal-entries', authenticate, requireModuleLicense('mod_accounting'), async (req, res) => {
  const { business_profile_id, entry_date, reference_type, narration, lines } = req.body;
  const entryLines = Array.isArray(lines) ? lines : [];
  if (entryLines.length < 2) {
    return res.status(400).json({ success: false, message: 'A double-entry journal voucher requires at least 2 lines (Debit & Credit).' });
  }

  let totalDebit = 0;
  let totalCredit = 0;
  for (const l of entryLines) {
    totalDebit += parseFloat(l.debit || 0);
    totalCredit += parseFloat(l.credit || 0);
  }

  if (Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit <= 0) {
    return res.status(400).json({
      success: false,
      message: `Unbalanced Journal Entry! Total Debit (${totalDebit.toFixed(2)}) must equal Total Credit (${totalCredit.toFixed(2)}).`
    });
  }

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tenantId = await resolveTenantId(req, db);
    const entryNumber = `JV-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`;

    const hdrRes = await client.query(
      `INSERT INTO journal_entries
       (tenant_id, business_profile_id, entry_number, entry_date, reference_type, narration, total_debit, total_credit, is_posted, posted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9) RETURNING *`,
      [
        tenantId,
        business_profile_id || null,
        entryNumber,
        entry_date || new Date().toISOString().slice(0, 10),
        reference_type || 'Manual Voucher',
        narration || 'General Journal Entry',
        totalDebit,
        totalCredit,
        req.user?.id || null
      ]
    );
    const je = hdrRes.rows[0];

    for (const l of entryLines) {
      if (!l.account_id) continue;
      await client.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit, party_type, party_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [je.id, l.account_id, l.line_description || narration || '', parseFloat(l.debit || 0), parseFloat(l.credit || 0), l.party_type || null, l.party_id || null]
      );
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: je, message: `Journal Voucher ${entryNumber} posted.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

// GET Trial Balance, Profit & Loss (P&L), Balance Sheet & AR Aging Summary
router.get('/reports', authenticate, requireModuleLicense('mod_accounting'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    await ensureTenantCoaMap(tenantId);
    const result = await db.query(
      `SELECT a.id, a.account_code, a.account_name, a.account_type, a.account_sub_type,
              COALESCE(SUM(jl.debit), 0) as total_debit,
              COALESCE(SUM(jl.credit), 0) as total_credit
       FROM coa_accounts a
       LEFT JOIN journal_entry_lines jl ON jl.account_id = a.id
       WHERE a.tenant_id = $1
       GROUP BY a.id, a.account_code, a.account_name, a.account_type, a.account_sub_type
       ORDER BY a.account_code ASC`,
      [tenantId]
    );

    let totalRevenue = 0;
    let totalExpenses = 0;
    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    const trialBalance = result.rows.map(r => {
      const dr = parseFloat(r.total_debit || 0);
      const cr = parseFloat(r.total_credit || 0);
      if (r.account_type === 'Revenue') totalRevenue += (cr - dr);
      if (r.account_type === 'Expense') totalExpenses += (dr - cr);
      if (r.account_type === 'Asset') totalAssets += (dr - cr);
      if (r.account_type === 'Liability') totalLiabilities += (cr - dr);
      if (r.account_type === 'Equity') totalEquity += (cr - dr);
      return { ...r, total_debit: dr, total_credit: cr, net_balance: dr - cr };
    });

    // Calculate AR Aging Buckets (0-30, 31-60, 61-90, 90+ days)
    const arRes = await db.query(
      `SELECT i.id, i.invoice_number, i.invoice_date, i.due_date, c.business_name as customer_name,
              (COALESCE(i.total_amount, 0) - COALESCE(i.paid_amount, 0)) as outstanding,
              GREATEST(0, (CURRENT_DATE - COALESCE(i.invoice_date, CURRENT_DATE)::date)) as age_days
       FROM invoices i
       LEFT JOIN customers c ON i.customer_id = c.id
       WHERE i.tenant_id = $1 AND (COALESCE(i.total_amount, 0) - COALESCE(i.paid_amount, 0)) > 1`,
      [tenantId]
    );

    const agingBuckets = { days_0_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0 };
    arRes.rows.forEach(inv => {
      const out = parseFloat(inv.outstanding || 0);
      const days = parseInt(inv.age_days || 0, 10);
      if (days <= 30) agingBuckets.days_0_30 += out;
      else if (days <= 60) agingBuckets.days_31_60 += out;
      else if (days <= 90) agingBuckets.days_61_90 += out;
      else agingBuckets.days_90_plus += out;
    });

    res.json({
      success: true,
      data: {
        trialBalance,
        summary: {
          total_revenue: totalRevenue,
          total_expenses: totalExpenses,
          net_profit: totalRevenue - totalExpenses,
          total_assets: totalAssets,
          total_liabilities: totalLiabilities,
          total_equity: totalEquity
        },
        ar_aging: {
          buckets: agingBuckets,
          open_invoices: arRes.rows
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST 1-Click Auto-Sync Historical Invoices, Payments & Expenses into Double-Entry GL
router.post('/sync-subledgers', authenticate, requireModuleLicense('mod_accounting'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    await ensureTenantCoaMap(tenantId);

    const [invRes, payRes, expRes] = await Promise.all([
      db.query(`SELECT * FROM invoices WHERE tenant_id = $1 AND total_amount > 0`, [tenantId]),
      db.query(`SELECT * FROM payments WHERE tenant_id = $1`, [tenantId]),
      db.query(`SELECT * FROM general_expenses WHERE tenant_id = $1 AND amount > 0`, [tenantId])
    ]);

    let syncedCount = 0;
    for (const inv of invRes.rows) {
      const r = await autoPostInvoiceToGL(inv, req.user?.id || null);
      if (r) syncedCount++;
    }
    for (const p of payRes.rows) {
      const r = await autoPostPaymentToGL(p, req.user?.id || null);
      if (r) syncedCount++;
    }
    for (const ex of expRes.rows) {
      const r = await autoPostExpenseToGL(ex, req.user?.id || null);
      if (r) syncedCount++;
    }

    res.json({
      success: true,
      synced_count: syncedCount,
      message: `Synchronized ${syncedCount} historical sub-ledger transactions (Invoices, Payments, Expenses) into the General Ledger.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

