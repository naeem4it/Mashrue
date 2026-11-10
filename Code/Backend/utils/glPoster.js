/**
 * ============================================================================
 * SHARED GENERAL LEDGER (GL) AUTO-POSTING ENGINE (glPoster.js)
 * ============================================================================
 * Automatically creates balanced double-entry Journal Vouchers in `journal_entries`
 * and `journal_entry_lines` when operational events occur across modules:
 *  - Sales Invoice Created (Module 1 -> Module 6 GL)
 *  - Customer Payment Logged (Module 1 -> Module 6 GL & Module 10 WHT Ledger)
 *  - General / Tender Expense Recorded (Module 6 Subledger -> Module 6 GL)
 *
 * Non-blocking & fault-tolerant: If COA accounts do not exist yet, it auto-seeds
 * them for the tenant so operational transactions never fail.
 * ============================================================================
 */

const db = require('../config/db');

async function ensureTenantCoaMap(tenantId) {
  let coaRes = await db.query(`SELECT id, account_code FROM coa_accounts WHERE tenant_id = $1`, [tenantId]);
  if (coaRes.rows.length === 0) {
    const defaults = [
      ['1001', 'Cash in Hand (Petty Cash)', 'Asset', 'Current Asset'],
      ['1010', 'Bank Current Account (PKR)', 'Asset', 'Current Asset'],
      ['1200', 'Accounts Receivable (Trade Debtors)', 'Asset', 'Current Asset'],
      ['1300', 'Inventory Asset (Warehouse Stock)', 'Asset', 'Current Asset'],
      ['1450', 'Withholding Tax (WHT) Receivable / Advance Tax', 'Asset', 'Current Asset'],
      ['2001', 'Accounts Payable (Trade Creditors)', 'Liability', 'Current Liability'],
      ['2100', 'Output Sales Tax Payable (FBR / Provincial)', 'Liability', 'Current Liability'],
      ['2200', 'Salaries & Payroll Payable', 'Liability', 'Current Liability'],
      ['3001', 'Owner Capital / Share Equity', 'Equity', 'Equity'],
      ['4001', 'Government Tender Sales Revenue', 'Revenue', 'Operating Revenue'],
      ['5001', 'Cost of Goods Sold (COGS)', 'Expense', 'Direct Cost'],
      ['5100', 'Salaries & Wages Expense', 'Expense', 'Operating Expense'],
      ['5300', 'General & Administrative Expense', 'Expense', 'Operating Expense']
    ];
    for (const [code, name, type, sub] of defaults) {
      await db.query(
        `INSERT INTO coa_accounts (tenant_id, account_code, account_name, account_type, account_sub_type)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, account_code) DO NOTHING`,
        [tenantId, code, name, type, sub]
      );
    }
    coaRes = await db.query(`SELECT id, account_code FROM coa_accounts WHERE tenant_id = $1`, [tenantId]);
  }
  const map = {};
  coaRes.rows.forEach(r => { map[r.account_code] = r.id; });
  return map;
}

/**
 * Auto-post Sales Invoice to General Ledger:
 *   Debit 1200 (Accounts Receivable) = total_amount
 *   Credit 4001 (Sales Revenue) = total_amount - tax_amount
 *   Credit 2100 (Output Sales Tax Payable) = tax_amount (if > 0)
 */
async function autoPostInvoiceToGL(invoice, userId = null) {
  try {
    if (!invoice || !invoice.id || !invoice.tenant_id) return null;
    const total = parseFloat(invoice.total_amount || 0);
    if (total <= 0) return null;

    // Avoid duplicate posting
    const existing = await db.query(
      `SELECT id FROM journal_entries WHERE tenant_id = $1 AND reference_type = 'Sales Invoice' AND reference_id = $2 LIMIT 1`,
      [invoice.tenant_id, invoice.id]
    );
    if (existing.rows.length > 0) return existing.rows[0];

    const coa = await ensureTenantCoaMap(invoice.tenant_id);
    if (!coa['1200'] || !coa['4001']) return null;

    const tax = parseFloat(invoice.tax_amount || 0);
    const netRev = Math.max(0, total - tax);
    const jvNo = `JV-INV-${String(invoice.invoice_number || invoice.id).slice(-6)}`;

    const jvRes = await db.query(
      `INSERT INTO journal_entries
       (tenant_id, business_profile_id, entry_number, entry_date, reference_type, reference_id, narration, total_debit, total_credit, is_posted, posted_by)
       VALUES ($1,$2,$3,$4,'Sales Invoice',$5,$6,$7,$7,TRUE,$8) RETURNING *`,
      [
        invoice.tenant_id,
        invoice.business_profile_id || null,
        jvNo,
        invoice.invoice_date || new Date().toISOString().slice(0, 10),
        invoice.id,
        `Auto-posted Sales Invoice ${invoice.invoice_number || ''}`,
        total,
        userId
      ]
    );
    const jvId = jvRes.rows[0].id;

    await db.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit, party_type, party_id)
       VALUES ($1,$2,$3,$4,0,'Customer',$5)`,
      [jvId, coa['1200'], `Receivable on Invoice ${invoice.invoice_number || ''}`, total, invoice.customer_id || null]
    );
    await db.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit)
       VALUES ($1,$2,$3,0,$4)`,
      [jvId, coa['4001'], `Net Revenue on Invoice ${invoice.invoice_number || ''}`, netRev]
    );
    if (tax > 0 && coa['2100']) {
      await db.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit)
         VALUES ($1,$2,$3,0,$4)`,
        [jvId, coa['2100'], `Output Tax on Invoice ${invoice.invoice_number || ''}`, tax]
      );
    }
    return jvRes.rows[0];
  } catch (err) {
    console.warn('[GL Auto-Post Invoice Note]:', err.message);
    return null;
  }
}

/**
 * Auto-post Customer Payment to General Ledger & WHT CPR Ledger:
 *   Debit 1010 (Bank) = amount_received
 *   Debit 1450 (WHT Receivable) = tax_deducted (if > 0)
 *   Credit 1200 (Accounts Receivable) = amount_received + tax_deducted
 */
async function autoPostPaymentToGL(payment, userId = null) {
  try {
    if (!payment || !payment.id || !payment.tenant_id) return null;
    const netReceived = parseFloat(payment.net_received_amount || payment.amount_received || payment.amount || 0);
    const whtDeducted = parseFloat(payment.tax_deducted || 0) + parseFloat(payment.income_tax_wht_amount || 0) + parseFloat(payment.sales_tax_wht_amount || 0);
    const grossCleared = netReceived + whtDeducted;
    if (grossCleared <= 0) return null;

    const existing = await db.query(
      `SELECT id FROM journal_entries WHERE tenant_id = $1 AND reference_type = 'Payment Received' AND reference_id = $2 LIMIT 1`,
      [payment.tenant_id, payment.id]
    );
    if (existing.rows.length > 0) return existing.rows[0];

    const coa = await ensureTenantCoaMap(payment.tenant_id);
    if (!coa['1010'] || !coa['1200']) return null;

    const refCheque = payment.check_no || payment.cheque_number || payment.payment_number || payment.id;
    const jvNo = `JV-PMT-${String(refCheque).slice(-6)}`;
    const jvRes = await db.query(
      `INSERT INTO journal_entries
       (tenant_id, business_profile_id, entry_number, entry_date, reference_type, reference_id, narration, total_debit, total_credit, is_posted, posted_by)
       VALUES ($1,$2,$3,$4,'Payment Received',$5,$6,$7,$7,TRUE,$8) RETURNING *`,
      [
        payment.tenant_id,
        payment.business_profile_id || null,
        jvNo,
        payment.payment_date || new Date().toISOString().slice(0, 10),
        payment.id,
        `Payment received (${payment.payment_method || payment.payment_mode || 'Bank'} ${refCheque})`,
        grossCleared,
        userId
      ]
    );
    const jvId = jvRes.rows[0].id;

    if (netReceived > 0) {
      await db.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit)
         VALUES ($1,$2,$3,$4,0)`,
        [jvId, coa['1010'], `Net Receipt to Bank (${refCheque})`, netReceived]
      );
    }
    if (whtDeducted > 0 && coa['1450']) {
      await db.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit)
         VALUES ($1,$2,$3,$4,0)`,
        [jvId, coa['1450'], `WHT Deducted at Source by Client`, whtDeducted]
      );

      // Also auto-log into Module 10 `tax_withholding_deductions`
      await db.query(
        `INSERT INTO tax_withholding_deductions
         (tenant_id, business_profile_id, transaction_type, invoice_id, payment_id, section_code, taxable_amount, wht_rate, wht_amount, cpr_number, status)
         VALUES ($1,$2,'Deducted by Client on Our Invoice',$3,$4,'153(1)(a) Goods',$5,$6,$7,$8,$9)`,
        [
          payment.tenant_id,
          payment.business_profile_id || null,
          payment.invoice_id || null,
          payment.id,
          grossCleared,
          grossCleared > 0 ? Number(((whtDeducted / grossCleared) * 100).toFixed(2)) : 5.0,
          whtDeducted,
          payment.deduction_certificate_no || null,
          payment.deduction_certificate_no ? 'Verified / CPR Attached' : 'Pending CPR'
        ]
      );
    }
    await db.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit)
       VALUES ($1,$2,$3,0,$4)`,
      [jvId, coa['1200'], `Accounts Receivable Cleared`, grossCleared]
    );
    return jvRes.rows[0];
  } catch (err) {
    console.warn('[GL Auto-Post Payment Note]:', err.message);
    return null;
  }
}

/**
 * Auto-post General Expense to General Ledger:
 *   Debit 5300 (Operating Expense) = amount
 *   Credit 1010 (Bank / Cash) = amount
 */
async function autoPostExpenseToGL(expense, userId = null) {
  try {
    if (!expense || !expense.id || !expense.tenant_id) return null;
    const amt = parseFloat(expense.amount || 0);
    if (amt <= 0) return null;

    const existing = await db.query(
      `SELECT id FROM journal_entries WHERE tenant_id = $1 AND reference_type = 'Vendor Bill' AND reference_id = $2 LIMIT 1`,
      [expense.tenant_id, expense.id]
    );
    if (existing.rows.length > 0) return existing.rows[0];

    const coa = await ensureTenantCoaMap(expense.tenant_id);
    if (!coa['5300'] || !coa['1010']) return null;

    const jvNo = `JV-EXP-${String(expense.id).slice(0, 6).toUpperCase()}`;
    const jvRes = await db.query(
      `INSERT INTO journal_entries
       (tenant_id, business_profile_id, entry_number, entry_date, reference_type, reference_id, narration, total_debit, total_credit, is_posted, posted_by)
       VALUES ($1,$2,$3,$4,'Vendor Bill',$5,$6,$7,$7,TRUE,$8) RETURNING *`,
      [
        expense.tenant_id,
        expense.business_profile_id || null,
        jvNo,
        expense.expense_date || new Date().toISOString().slice(0, 10),
        expense.id,
        `Expense: ${expense.category || 'Operating'} - ${expense.description || ''}`,
        amt,
        userId
      ]
    );
    const jvId = jvRes.rows[0].id;

    await db.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit)
       VALUES ($1,$2,$3,$4,0)`,
      [jvId, coa['5300'], `${expense.category || 'Expense'}: ${expense.description || ''}`, amt]
    );
    await db.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit)
       VALUES ($1,$2,$3,0,$4)`,
      [jvId, coa['1010'], `Expense Paid (${expense.payment_method || 'Bank/Cash'})`, amt]
    );
    return jvRes.rows[0];
  } catch (err) {
    console.warn('[GL Auto-Post Expense Note]:', err.message);
    return null;
  }
}

/**
 * Auto-post Inventory Movements to General Ledger:
 *   - STOCK_IN / Purchase Receipt:
 *       Debit 1300 (Inventory Asset) = totalAmount
 *       Credit 2001 (Accounts Payable) = totalAmount
 *   - STOCK_OUT / Dispatch (COGS):
 *       Debit 5001 (Cost of Goods Sold) = totalAmount
 *       Credit 1300 (Inventory Asset) = totalAmount
 *   - ADJUSTMENT_POS (Inventory Count Gain):
 *       Debit 1300 (Inventory Asset) = totalAmount
 *       Credit 5300 (Inventory Adjustment Gain / Operating) = totalAmount
 *   - ADJUSTMENT_NEG (Inventory Count Loss / Shrinkage):
 *       Debit 5300 (Inventory Variance / Loss) = totalAmount
 *       Credit 1300 (Inventory Asset) = totalAmount
 *   - SUPPLIER_RETURN:
 *       Debit 2001 (Accounts Payable) = totalAmount
 *       Credit 1300 (Inventory Asset) = totalAmount
 */
async function autoPostInventoryToGL({
  tenantId,
  transactionType,
  referenceType = 'Inventory Movement',
  referenceId,
  referenceNumber,
  totalAmount,
  quantity,
  unitCost,
  date,
  narration,
  userId = null
}) {
  try {
    const effectiveTotal = parseFloat(totalAmount || (quantity && unitCost ? quantity * unitCost : 0));
    if (!tenantId || !effectiveTotal || effectiveTotal <= 0) {
      return { success: true, action: 'skipped_zero_amount' };
    }

    // Check if auto-post is enabled in tenant_inventory_settings and finance_company_settings
    const settingsRes = await db.query(
      `SELECT auto_post_gl FROM tenant_inventory_settings WHERE tenant_id = $1`,
      [tenantId]
    );
    if (settingsRes.rows.length > 0 && settingsRes.rows[0].auto_post_gl === false) {
      return { success: true, action: 'skipped_disabled' };
    }

    const finSetRes = await db.query(
      `SELECT enable_inventory_integration FROM finance_company_settings WHERE tenant_id = $1`,
      [tenantId]
    ).catch(() => ({ rows: [] }));
    if (finSetRes.rows.length > 0 && finSetRes.rows[0].enable_inventory_integration === false) {
      return { success: true, action: 'skipped_integration_disabled' };
    }

    // Check if tenant has mod_finance or mod_accounting active
    const tenantRes = await db.query(`SELECT subscription_plan, active_modules FROM tenants WHERE id = $1`, [tenantId]);
    const plan = tenantRes.rows[0]?.subscription_plan || 'Advance';
    const activeMods = tenantRes.rows[0]?.active_modules;
    if (plan === 'Custom' && Array.isArray(activeMods) && !activeMods.includes('mod_finance') && !activeMods.includes('mod_accounting')) {
      return { success: true, action: 'skipped_unlicensed' }; // Finance not installed, non-blocking exit
    }

    // Prevent duplicate GL entries
    const refKey = referenceNumber || String(referenceId);
    const existing = await db.query(
      `SELECT id FROM journal_entries WHERE tenant_id = $1 AND reference_type = $2 AND reference_id = $3 LIMIT 1`,
      [tenantId, referenceType, String(referenceId)]
    );
    if (existing.rows.length > 0) {
      return { success: true, action: 'skipped_duplicate', entry: existing.rows[0] };
    }

    const coa = await ensureTenantCoaMap(tenantId);
    if (!coa['1300']) {
      return { success: true, action: 'skipped_no_coa' };
    }

    let debitAcc = null;
    let creditAcc = null;
    let debitLabel = '';
    let creditLabel = '';

    if (transactionType === 'STOCK_IN' || transactionType === 'PURCHASE_RECEIPT') {
      debitAcc = coa['1300']; // Inventory Asset
      creditAcc = coa['2001'] || coa['1010']; // Accounts Payable / Bank
      debitLabel = `Inventory Inward Asset (${refKey})`;
      creditLabel = `Payable to Supplier for Inward Stock (${refKey})`;
    } else if (transactionType === 'STOCK_OUT' || transactionType === 'DISPATCH') {
      debitAcc = coa['5001']; // Cost of Goods Sold
      creditAcc = coa['1300']; // Inventory Asset
      debitLabel = `Cost of Goods Sold (${refKey})`;
      creditLabel = `Inventory Relieved for Dispatch (${refKey})`;
    } else if (transactionType === 'ADJUSTMENT_POS') {
      debitAcc = coa['1300'];
      creditAcc = coa['5300'] || coa['4001'];
      debitLabel = `Inventory Value Reconciled Positive (${refKey})`;
      creditLabel = `Inventory Adjustment Variance Gain (${refKey})`;
    } else if (transactionType === 'ADJUSTMENT_NEG') {
      debitAcc = coa['5300'];
      creditAcc = coa['1300'];
      debitLabel = `Inventory Shrinkage / Variance Loss (${refKey})`;
      creditLabel = `Inventory Written Off (${refKey})`;
    } else if (transactionType === 'SUPPLIER_RETURN') {
      debitAcc = coa['2001'] || coa['1010'];
      creditAcc = coa['1300'];
      debitLabel = `Payable Reduced on Return to Vendor (${refKey})`;
      creditLabel = `Inventory Returned to Supplier (${refKey})`;
    }

    if (!debitAcc || !creditAcc) {
      return { success: true, action: 'skipped_missing_accounts' };
    }

    const jvNo = `JV-INV-${String(refKey).slice(-8).replace(/[^a-zA-Z0-9]/g, '')}`;
    const jvRes = await db.query(
      `INSERT INTO journal_entries
       (tenant_id, entry_number, entry_date, reference_type, reference_id, narration, total_debit, total_credit, is_posted, posted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, TRUE, $8) RETURNING *`,
      [
        tenantId,
        jvNo,
        date || new Date().toISOString().slice(0, 10),
        referenceType,
        String(referenceId),
        narration || `Inventory ${transactionType} ${refKey}`,
        effectiveTotal,
        userId
      ]
    );
    const jvId = jvRes.rows[0].id;

    await db.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit)
       VALUES ($1, $2, $3, $4, 0)`,
      [jvId, debitAcc, debitLabel, effectiveTotal]
    );
    await db.query(
      `INSERT INTO journal_entry_lines (journal_entry_id, account_id, line_description, debit, credit)
       VALUES ($1, $2, $3, 0, $4)`,
      [jvId, creditAcc, creditLabel, effectiveTotal]
    );

    return { success: true, action: 'posted', entry: jvRes.rows[0] };
  } catch (err) {
    console.warn('[GL Auto-Post Inventory Note]:', err.message);
    return { success: false, reason: err.message };
  }
}

module.exports = {
  ensureTenantCoaMap,
  autoPostInvoiceToGL,
  autoPostPaymentToGL,
  autoPostExpenseToGL,
  autoPostInventoryToGL
};
