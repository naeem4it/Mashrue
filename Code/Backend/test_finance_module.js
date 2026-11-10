/**
 * ============================================================================
 * MASHRUE FINANCIAL MANAGEMENT MODULE — COMPREHENSIVE TEST SUITE
 * ============================================================================
 */

const db = require('./config/db');
const financeService = require('./services/financeService');

function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

async function runFinanceTestSuite() {
  console.log('================================================================');
  console.log('🏦 RUNNING MASHRUE FINANCIAL MANAGEMENT MODULE TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  function assert(cond, msg) {
    if (cond) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
      throw new Error(`Test failed: ${msg}`);
    }
  }

  const ts = Date.now().toString().slice(-6);
  const tenantA = 'f1000000-0000-0000-0000-000000' + ts;
  const tenantB = 'f2000000-0000-0000-0000-000000' + ts;

  try {
    // 1. Setup Standalone Finance Tenant A (ONLY mod_finance!) & Tenant B
    console.log('--- 1. Multi-Tenant & Standalone Setup (Only mod_finance) ---');
    await db.query(
      `INSERT INTO tenants (id, company_name, subdomain, subscription_plan, active_modules, status)
       VALUES ($1, $2, $3, 'Custom', '["mod_finance"]'::jsonb, 'Active')
       ON CONFLICT (id) DO NOTHING`,
      [tenantA, `Finance Standalone Corp ${ts}`, `fin-a-${ts}`]
    );
    await db.query(
      `INSERT INTO tenants (id, company_name, subdomain, subscription_plan, active_modules, status)
       VALUES ($1, $2, $3, 'Custom', '["mod_finance"]'::jsonb, 'Active')
       ON CONFLICT (id) DO NOTHING`,
      [tenantB, `Competitor Finance Corp ${ts}`, `fin-b-${ts}`]
    );

    const coaA = await financeService.ensureCoaMap(null, tenantA);
    const coaB = await financeService.ensureCoaMap(null, tenantB);
    assert(Object.keys(coaA).length >= 15, `Tenant A COA auto-initialized (${Object.keys(coaA).length} accounts)`);

    // Ensure bank & cash accounts for Tenant A
    const bankRes = await db.query(
      `INSERT INTO bank_cash_accounts (tenant_id, account_name, account_type, bank_name, coa_account_id, opening_balance, current_balance)
       VALUES ($1, 'HBL Main PKR', 'Bank', 'HBL', $2, 0, 0) RETURNING *`,
      [tenantA, coaA['1010']]
    );
    const cashRes = await db.query(
      `INSERT INTO bank_cash_accounts (tenant_id, account_name, account_type, coa_account_id, opening_balance, current_balance)
       VALUES ($1, 'Head Office Petty Cash', 'Cash', $2, 0, 0) RETURNING *`,
      [tenantA, coaA['1001']]
    );
    const bankAcc = bankRes.rows[0];
    const cashAcc = cashRes.rows[0];

    // Seed Customer & Supplier in Master Directories (No Duplicate Tables)
    const custRes = await db.query(
      `INSERT INTO customers (tenant_id, business_name, ntn, email) VALUES ($1, 'Alpha Power Ltd', '1234567-8', 'ap@alpha.pk') RETURNING *`,
      [tenantA]
    );
    const supRes = await db.query(
      `INSERT INTO suppliers (tenant_id, supplier_name, ntn, email) VALUES ($1, 'Beta Industrial Traders', '7654321-0', 'sales@beta.pk') RETURNING *`,
      [tenantA]
    );
    const customer = custRes.rows[0];
    const supplier = supRes.rows[0];
    assert(Boolean(customer.id && supplier.id), 'Reused master Customer & Supplier tables cleanly\n');

    // 2. Company Config, Fiscal Year & Closed Period Enforcement
    console.log('--- 2. Fiscal Period Locking & Multi-Currency ---');
    const settingsA = await financeService.getCompanySettings(null, tenantA);
    assert(settingsA.base_currency === 'PKR', 'Default base currency is PKR');

    const fyRes = await db.query(
      `INSERT INTO fiscal_years (tenant_id, year_name, start_date, end_date) VALUES ($1, 'FY 2026-27', '2026-07-01', '2027-06-30') RETURNING id`,
      [tenantA]
    );
    const pClosed = await db.query(
      `INSERT INTO accounting_periods (tenant_id, fiscal_year_id, period_number, period_name, start_date, end_date, status)
       VALUES ($1, $2, 1, 'Oct 2026', '2026-10-01', '2026-10-31', 'Closed') RETURNING id`,
      [tenantA, fyRes.rows[0].id]
    );
    await db.query(
      `INSERT INTO accounting_periods (tenant_id, fiscal_year_id, period_number, period_name, start_date, end_date, status)
       VALUES ($1, $2, 2, 'Nov 2026', '2026-11-01', '2026-11-30', 'Open') RETURNING id`,
      [tenantA, fyRes.rows[0].id]
    );

    let closedBlocked = false;
    try {
      await financeService.createJournal(null, {
        tenantId: tenantA,
        entryDate: '2026-10-15',
        narration: 'Should fail in closed period',
        lines: [
          { account_id: coaA['1010'], debit: 1000, credit: 0 },
          { account_id: coaA['3001'], debit: 0, credit: 1000 }
        ]
      });
    } catch (err) {
      if (err.message.includes('CLOSED')) closedBlocked = true;
    }
    assert(closedBlocked, 'Closed accounting period strictly blocks journal posting');

    // Currency Exchange Rate test
    await db.query(
      `INSERT INTO finance_exchange_rates (tenant_id, from_currency, to_currency, exchange_rate, effective_date)
       VALUES ($1, 'USD', 'PKR', 280.00, '2026-11-01')`,
      [tenantA]
    );
    const fx = await financeService.resolveExchangeRate(null, tenantA, 'USD', null, '2026-11-10');
    assert(fx.exchangeRate === 280, `Foreign currency rate resolved cleanly (1 USD = ${fx.exchangeRate} PKR)\n`);

    // 3. Configurable Tax Engine
    console.log('--- 3. Tax Calculations (Exclusive, Inclusive, Exempt) ---');
    const taxExcl = financeService.calculateTaxBreakdown({ amount: 1000, ratePct: 18, isInclusive: false, isExempt: false });
    assert(taxExcl.net_amount === 1000 && taxExcl.tax_amount === 180 && taxExcl.gross_amount === 1180, 'Tax-Exclusive: 1000 @ 18% -> Net 1000, Tax 180, Gross 1180');

    const taxIncl = financeService.calculateTaxBreakdown({ amount: 1180, ratePct: 18, isInclusive: true, isExempt: false });
    assert(taxIncl.net_amount === 1000 && taxIncl.tax_amount === 180 && taxIncl.gross_amount === 1180, 'Tax-Inclusive: 1180 @ 18% -> Net 1000, Tax 180, Gross 1180');

    const taxZero = financeService.calculateTaxBreakdown({ amount: 1000, ratePct: 18, isInclusive: false, isExempt: true });
    assert(taxZero.tax_amount === 0 && taxZero.gross_amount === 1000, 'Tax-Exempt: 0% tax enforced cleanly\n');

    // 4. Double-Entry Journals, Unbalanced Rejection, Draft->Post & Reversal
    console.log('--- 4. Double-Entry Journals, Draft->Post & Reversal ---');
    let unbalRejected = false;
    try {
      await financeService.createJournal(null, {
        tenantId: tenantA,
        entryDate: '2026-11-05',
        narration: 'Unbalanced test',
        lines: [
          { account_id: coaA['1010'], debit: 5000, credit: 0 },
          { account_id: coaA['3001'], debit: 0, credit: 4000 }
        ]
      });
    } catch (e) {
      if (e.message.includes('Unbalanced')) unbalRejected = true;
    }
    assert(unbalRejected, 'Unbalanced journal entry strictly rejected');

    // Owner Capital Injection: Dr Bank (1010) 100,000 | Cr Equity (3001) 100,000 (Draft then Post)
    const capDraft = await financeService.createJournal(null, {
      tenantId: tenantA,
      entryDate: '2026-11-01',
      narration: 'Initial Owner Capital Injection',
      requestedStatus: 'Draft',
      lines: [
        { account_id: coaA['1010'], debit: 100000, credit: 0 },
        { account_id: coaA['3001'], debit: 0, credit: 100000 }
      ]
    });
    assert(capDraft.journal.status === 'Draft' && capDraft.journal.is_posted === false, 'Draft journal saved unposted');
    const capPosted = await financeService.postDraftJournal(null, tenantA, capDraft.journal.id);
    assert(capPosted.status === 'Posted' && capPosted.is_posted === true, 'Draft journal approved and posted cleanly');

    // Test Journal Reversal
    const errJv = await financeService.createJournal(null, {
      tenantId: tenantA,
      entryDate: '2026-11-02',
      narration: 'Accidental Misc Expense',
      lines: [
        { account_id: coaA['5300'], debit: 2500, credit: 0 },
        { account_id: coaA['1010'], debit: 0, credit: 2500 }
      ]
    });
    const revRes = await financeService.reverseJournal(null, tenantA, errJv.journal.id, { reversalDate: '2026-11-03', reason: 'Entered by mistake' });
    assert(revRes.reversal.entry_number.endsWith('-REV') && round2(revRes.reversal.total_debit) === 2500, 'Reversal Journal created with equal and opposite entries');

    let dupRevBlocked = false;
    try {
      await financeService.reverseJournal(null, tenantA, errJv.journal.id);
    } catch (e) {
      if (e.message.includes('already been reversed')) dupRevBlocked = true;
    }
    assert(dupRevBlocked, 'Double reversal of same journal strictly prevented\n');

    // 5. Accounts Receivable: Standalone Invoice, Receipt (Partial + WHT), Credit Note
    console.log('--- 5. Accounts Receivable (Standalone Invoice, Receipt, Credit Note) ---');
    // Invoice: Subtotal 10,000 + 18% GST 1,800 = 11,800
    const invIns = await db.query(
      `INSERT INTO invoices (tenant_id, customer_id, invoice_number, invoice_date, due_date, subtotal, tax_amount, total_amount, paid_amount, status)
       VALUES ($1, $2, $3, '2026-11-05', '2026-12-05', 10000, 1800, 11800, 0, 'Issued') RETURNING *`,
      [tenantA, customer.id, `INV-${ts}-01`]
    );
    const inv = invIns.rows[0];
    const invEv = await financeService.postAccountingEvent(null, {
      tenantId: tenantA, sourceModule: 'finance', eventType: 'CUSTOMER_INVOICE',
      sourceId: inv.id, sourceNumber: inv.invoice_number, date: '2026-11-05',
      payload: { customer_id: customer.id, subtotal: 10000, tax_amount: 1800, total_amount: 11800 }
    });
    assert(invEv.action === 'posted', `Customer Invoice ${inv.invoice_number} posted Dr AR 11,800 / Cr Rev 10,000 + Tax 1,800`);

    // Test Idempotency on duplicate CUSTOMER_INVOICE event
    const dupInvEv = await financeService.postAccountingEvent(null, {
      tenantId: tenantA, sourceModule: 'finance', eventType: 'CUSTOMER_INVOICE',
      sourceId: inv.id, sourceNumber: inv.invoice_number, date: '2026-11-05',
      payload: { customer_id: customer.id, subtotal: 10000, tax_amount: 1800, total_amount: 11800 }
    });
    assert(dupInvEv.action === 'skipped_duplicate', 'Idempotency prevents duplicate invoice GL posting!');

    // Customer Partial Payment: Net 5,000 Bank + WHT 500 = 5,500 applied
    const payIns = await db.query(
      `INSERT INTO payments (tenant_id, customer_id, invoice_id, bank_account_id, payment_number, payment_date, payment_method, amount, net_received_amount, income_tax_wht_amount, gross_invoice_amount)
       VALUES ($1, $2, $3, $4, $5, '2026-11-08', 'Bank Transfer', 5000, 5000, 500, 5500) RETURNING *`,
      [tenantA, customer.id, inv.id, bankAcc.id, `RCPT-${ts}-01`]
    );
    await db.query(`UPDATE invoices SET paid_amount = 5500, status = 'Partially Paid' WHERE id = $1`, [inv.id]);
    const payEv = await financeService.postAccountingEvent(null, {
      tenantId: tenantA, sourceModule: 'finance', eventType: 'CUSTOMER_RECEIPT',
      sourceId: payIns.rows[0].id, sourceNumber: payIns.rows[0].payment_number, date: '2026-11-08',
      payload: { customer_id: customer.id, bank_coa_id: coaA['1010'], net_amount: 5000, wht_amount: 500 }
    });
    assert(payEv.action === 'posted', 'Partial Customer Receipt + WHT posted cleanly');

    // Customer Credit Note: 1,000 + 180 tax = 1,180
    const cnIns = await db.query(
      `INSERT INTO ar_credit_notes (tenant_id, customer_id, invoice_id, credit_note_number, credit_date, subtotal, tax_amount, total_amount, applied_amount, reason)
       VALUES ($1, $2, $3, $4, '2026-11-09', 1000, 180, 1180, 1180, 'Damaged unit return') RETURNING *`,
      [tenantA, customer.id, inv.id, `CN-${ts}-01`]
    );
    await db.query(`UPDATE invoices SET credited_amount = 1180 WHERE id = $1`, [inv.id]);
    await financeService.postAccountingEvent(null, {
      tenantId: tenantA, sourceModule: 'finance', eventType: 'CUSTOMER_CREDIT_NOTE',
      sourceId: cnIns.rows[0].id, sourceNumber: cnIns.rows[0].credit_note_number, date: '2026-11-09',
      payload: { customer_id: customer.id, subtotal: 1000, tax_amount: 180, total_amount: 1180 }
    });
    const arAging = await financeService.getAgingReport(tenantA, 'AR');
    // Remaining open AR = 11800 - 5500 - 1180 = 5120
    assert(round2(arAging.buckets.total) === 5120, `AR Aging total accurately reflects remaining balance: ${arAging.buckets.total} (expected 5120)\n`);

    // 6. Accounts Payable: Supplier Bill, Duplicate Vendor Invoice Check, Supplier Payment
    console.log('--- 6. Accounts Payable (Bill, Duplicate Detection, Payment) ---');
    // Supplier Bill: 4,000 + 18% Input Tax 720 = 4,720
    const billIns = await db.query(
      `INSERT INTO supplier_bills (tenant_id, supplier_id, bill_number, vendor_invoice_number, bill_date, due_date, subtotal, tax_amount, total_amount, status)
       VALUES ($1, $2, $3, 'VND-INV-991', '2026-11-06', '2026-12-06', 4000, 720, 4720, 'Approved') RETURNING *`,
      [tenantA, supplier.id, `BILL-${ts}-01`]
    );
    await financeService.postAccountingEvent(null, {
      tenantId: tenantA, sourceModule: 'finance', eventType: 'SUPPLIER_BILL',
      sourceId: billIns.rows[0].id, sourceNumber: billIns.rows[0].bill_number, date: '2026-11-06',
      payload: { supplier_id: supplier.id, subtotal: 4000, tax_amount: 720, total_amount: 4720 }
    });
    // Supplier Payment: Net 2,000 Paid
    const spIns = await db.query(
      `INSERT INTO supplier_payments (tenant_id, supplier_id, bank_account_id, payment_number, payment_date, gross_amount, wht_deducted, net_paid_amount)
       VALUES ($1, $2, $3, $4, '2026-11-09', 2000, 0, 2000) RETURNING *`,
      [tenantA, supplier.id, bankAcc.id, `VPAY-${ts}-01`]
    );
    await db.query(`UPDATE supplier_bills SET paid_amount = 2000, status = 'Partially Paid' WHERE id = $1`, [billIns.rows[0].id]);
    await financeService.postAccountingEvent(null, {
      tenantId: tenantA, sourceModule: 'finance', eventType: 'SUPPLIER_PAYMENT',
      sourceId: spIns.rows[0].id, sourceNumber: spIns.rows[0].payment_number, date: '2026-11-09',
      payload: { supplier_id: supplier.id, bank_coa_id: coaA['1010'], net_amount: 2000, wht_amount: 0 }
    });
    const apAging = await financeService.getAgingReport(tenantA, 'AP');
    // Remaining AP = 4720 - 2000 = 2720
    assert(round2(apAging.buckets.total) === 2720, `AP Aging total accurately equals 2720 (4720 - 2000 paid)\n`);

    // 7. Cash & Bank Transfer
    console.log('--- 7. Inter-Account Cash & Bank Transfer ---');
    const trfEv = await financeService.postAccountingEvent(null, {
      tenantId: tenantA, sourceModule: 'finance', eventType: 'BANK_TRANSFER',
      sourceId: `TRF-${ts}`, sourceNumber: `TRF-${ts}`, date: '2026-11-09',
      payload: { from_coa_id: coaA['1010'], to_coa_id: coaA['1001'], total_amount: 1500 }
    });
    assert(trfEv.action === 'posted', 'Cash/Bank transfer posted Dr Petty Cash 1,500 / Cr Bank 1,500\n');

    // 8. Fixed Assets & Duplicate-Safe Depreciation
    console.log('--- 8. Fixed Assets (Acquisition, Depreciation, No Duplicates, Disposal) ---');
    // Cost 12,000, Salvage 0, Useful Life 1 year (12 months) => 1,000/month straight-line
    const faIns = await db.query(
      `INSERT INTO fixed_assets (tenant_id, asset_code, asset_name, acquisition_date, acquisition_cost, salvage_value, useful_life_years, depreciation_method, net_book_value, asset_coa_id, accum_dep_coa_id, dep_expense_coa_id)
       VALUES ($1, $2, 'Test Generator', '2026-11-01', 12000, 0, 1, 'Straight-Line', 12000, $3, $4, $5) RETURNING *`,
      [tenantA, `FA-${ts}`, coaA['1500'], coaA['1590'], coaA['5500']]
    );
    await financeService.postAccountingEvent(null, {
      tenantId: tenantA, sourceModule: 'finance', eventType: 'ASSET_ACQUISITION',
      sourceId: faIns.rows[0].id, sourceNumber: faIns.rows[0].asset_code, date: '2026-11-01',
      lines: [
        { account_id: coaA['1500'], debit: 12000, credit: 0 },
        { account_id: coaA['1010'], debit: 0, credit: 12000 }
      ]
    });

    const depRun1 = await financeService.runFixedAssetDepreciation(null, tenantA, { year: 2026, month: 11 });
    assert(depRun1.assets_processed === 1 && depRun1.total_depreciation === 1000, `Straight-Line monthly depreciation calculated accurately: ${depRun1.total_depreciation} (expected 1000)`);

    const depRun2 = await financeService.runFixedAssetDepreciation(null, tenantA, { year: 2026, month: 11 });
    assert(depRun2.assets_processed === 0 && depRun2.total_depreciation === 0, 'Duplicate depreciation run for same month safely blocked (0 processed)\n');

    // 9. Optional Integration Toggle Verification
    console.log('--- 9. Optional Integrations (Disabled vs Enabled) ---');
    await db.query(`UPDATE finance_company_settings SET enable_inventory_integration = FALSE WHERE tenant_id = $1`, [tenantA]);
    const intDisabled = await financeService.postAccountingEvent(null, {
      tenantId: tenantA, sourceModule: 'inventory', eventType: 'STOCK_COSTING',
      sourceId: `INV-EVT-${ts}`, date: '2026-11-10',
      lines: [
        { account_id: coaA['5001'], debit: 500, credit: 0 },
        { account_id: coaA['1300'], debit: 0, credit: 500 }
      ]
    });
    assert(intDisabled.action === 'skipped_integration_disabled', 'Disabled Inventory integration cleanly skips GL posting');

    await db.query(`UPDATE finance_company_settings SET enable_inventory_integration = TRUE WHERE tenant_id = $1`, [tenantA]);
    const intEnabled = await financeService.postAccountingEvent(null, {
      tenantId: tenantA, sourceModule: 'inventory', eventType: 'STOCK_COSTING',
      sourceId: `INV-EVT-${ts}`, date: '2026-11-10',
      lines: [
        { account_id: coaA['5001'], debit: 500, credit: 0 },
        { account_id: coaA['1300'], debit: 0, credit: 500 }
      ]
    });
    assert(intEnabled.action === 'posted', 'Enabled Inventory integration posts balanced COGS/Inventory JV cleanly\n');

    // 10. Financial Statements Reconciliation (TB, P&L, Balance Sheet, Cash Flow)
    console.log('--- 10. Full Financial Statements Reconciliation ---');
    const tb = await financeService.getTrialBalance(tenantA, {});
    assert(tb.totals.is_balanced === true, `Trial Balance is 100% balanced (Dr ${tb.totals.closing_debit} == Cr ${tb.totals.closing_credit})`);

    const pnl = await financeService.getProfitAndLoss(tenantA, {});
    // Revenue = 10,000 - 1,000 CN = 9,000. COGS = 500. Gross Profit = 8,500.
    // Expenses = Supplier Bill 4,000 + Depreciation 1,000 (+2500 - 2500 reversed = 0) = 5,000.
    // Net Profit = 8,500 - 5,000 = 3,500!
    assert(pnl.current.summary.net_profit === 3500, `Profit & Loss Net Profit verified: ${pnl.current.summary.net_profit} (expected 3500.00)`);

    const bs = await financeService.getBalanceSheet(tenantA, {});
    assert(bs.summary.is_balanced === true && Math.abs(bs.summary.variance) < 0.01,
      `Balance Sheet EQUILIBRIUM PROVEN: Assets (${bs.summary.total_assets}) == Liabilities (${bs.summary.total_liabilities}) + Equity (${bs.summary.total_equity})`);

    const cf = await financeService.getCashFlowStatement(tenantA, {});
    assert(cf.reconciliation.reconciles === true,
      `Cash Flow Indirect Statement RECONCILES: Opening (${cf.reconciliation.opening_cash_and_bank}) + Net Change (${cf.reconciliation.net_change_in_cash}) == Closing Cash (${cf.reconciliation.closing_cash_and_bank})\n`);

    // 11. Multi-Tenant Isolation
    console.log('--- 11. Strict Multi-Tenant Data Isolation ---');
    const tbB = await financeService.getTrialBalance(tenantB, {});
    assert(tbB.totals.closing_debit === 0 && tbB.totals.closing_credit === 0, 'Tenant B General Ledger shows 0 leakage from Tenant A');
    const arB = await financeService.getAgingReport(tenantB, 'AR');
    assert(arB.buckets.total === 0, 'Tenant B AR Aging shows 0 leakage from Tenant A');

    console.log('\n================================================================');
    console.log(`🎉 ALL ${passed}/${passed + failed} FINANCIAL MANAGEMENT TESTS PASSED (100%)!`);
    console.log('================================================================\n');
  } finally {
    // Cleanup temporary test tenants cleanly (ON DELETE CASCADE removes all test artifacts)
    await db.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [tenantA, tenantB]).catch(() => {});
  }

  process.exit(failed > 0 ? 1 : 0);
}

runFinanceTestSuite().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
