/**
 * ============================================================================
 * MASHRUE TAXGUARD MODULE — COMPREHENSIVE AUTOMATED TEST SUITE
 * ============================================================================
 */

const db = require('./config/db');
const taxComplianceService = require('./services/taxComplianceService');

function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

async function runTaxComplianceTestSuite() {
  console.log('================================================================');
  console.log('🇵🇰 RUNNING MASHRUE TAXGUARD MODULE TEST SUITE');
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
      throw new Error(`Assertion failed: ${msg}`);
    }
  }

  const ts = Date.now().toString().slice(-6);
  const tenantA = 'a6000000-0000-0000-0000-000000' + ts;
  const tenantB = 'b6000000-0000-0000-0000-000000' + ts;

  try {
    console.log('--- 1. Standalone Setup & Configurable Jurisdictions/WHT ---');
    await db.query(
      `INSERT INTO tenants (id, company_name, subdomain, subscription_plan, active_modules, status)
       VALUES ($1, $2, $3, 'Custom', '["mod_tax_compliance"]'::jsonb, 'Active'),
              ($4, $5, $6, 'Custom', '["mod_tax_compliance"]'::jsonb, 'Active')`,
      [tenantA, `TaxGuard Corp A ${ts}`, `tg-a-${ts}`, tenantB, `TaxGuard Corp B ${ts}`, `tg-b-${ts}`]
    );

    await taxComplianceService.ensureDefaults(null, tenantA);
    const jurs = await db.query(`SELECT * FROM tax_jurisdictions WHERE tenant_id = $1`, [tenantA]);
    const whts = await db.query(`SELECT * FROM tax_withholding_rules WHERE tenant_id = $1`, [tenantA]);
    assert(jurs.rows.length >= 5 && whts.rows.length >= 4,
      `Initialized ${jurs.rows.length} jurisdictions & ${whts.rows.length} Sec 153 WHT rules standalone`);

    console.log('--- 2. Period-Filtered Annex-C & Annex-A Return Compilation ---');
    const custFiler = (await db.query(
      `INSERT INTO customers (tenant_id, business_name, ntn, org_type)
       VALUES ($1, 'Alpha Filer Ltd', '1234567-8', 'Private') RETURNING *`,
      [tenantA]
    )).rows[0];
    const custNonFiler = (await db.query(
      `INSERT INTO customers (tenant_id, business_name, ntn, org_type)
       VALUES ($1, 'Beta Unregistered Traders', '', 'Private') RETURNING *`,
      [tenantA]
    )).rows[0];
    const supFiler = (await db.query(
      `INSERT INTO suppliers (tenant_id, supplier_name, ntn)
       VALUES ($1, 'National Steel Suppliers', '7654321-0') RETURNING *`,
      [tenantA]
    )).rows[0];

    // Invoice 1 in April 2026 (100,000 + 18,000 tax)
    await db.query(
      `INSERT INTO invoices (tenant_id, customer_id, invoice_number, invoice_date, subtotal, tax_amount, total_amount, status)
       VALUES ($1, $2, $3, '2026-04-15', 100000, 18000, 118000, 'Posted')`,
      [tenantA, custFiler.id, `INV-APR-${ts}`]
    );
    // Invoice 2 in May 2026 (200,000 + 36,000 tax) — MUST NOT bleed into April return!
    await db.query(
      `INSERT INTO invoices (tenant_id, customer_id, invoice_number, invoice_date, subtotal, tax_amount, total_amount, status)
       VALUES ($1, $2, $3, '2026-05-10', 200000, 36000, 236000, 'Posted')`,
      [tenantA, custNonFiler.id, `INV-MAY-${ts}`]
    );
    // Voided invoice in April 2026 — MUST be excluded!
    await db.query(
      `INSERT INTO invoices (tenant_id, customer_id, invoice_number, invoice_date, subtotal, tax_amount, total_amount, status)
       VALUES ($1, $2, $3, '2026-04-20', 500000, 90000, 590000, 'Voided')`,
      [tenantA, custFiler.id, `INV-VOID-${ts}`]
    );

    // Supplier Bill in April 2026 (50,000 + 9,000 input tax)
    await db.query(
      `INSERT INTO supplier_bills (tenant_id, supplier_id, bill_number, bill_date, subtotal, tax_amount, total_amount, status)
       VALUES ($1, $2, $3, '2026-04-18', 50000, 9000, 59000, 'Posted')`,
      [tenantA, supFiler.id, `BILL-APR-${ts}`]
    );

    // WHT CPR in April 2026 (5,000)
    await db.query(
      `INSERT INTO tax_withholding_deductions (tenant_id, transaction_type, party_name, section_code, taxable_amount, wht_rate, wht_amount, cpr_number, cpr_date, status)
       VALUES ($1, 'Deducted by Client', 'Alpha Filer Ltd', '153(1)(a) Goods', 100000, 5, 5000, $2, '2026-04-19', 'Verified / CPR Attached')`,
      [tenantA, `CPR-${ts}`]
    );

    // Compile April 2026 Return -> Output 18,000 - Input 9,000 = Net 9,000 (May & Voided strictly excluded!)
    const aprRet = await taxComplianceService.compileMonthlyReturn(null, tenantA, { month: 4, year: 2026, jurisdictionCode: 'FBR_FED' });
    assert(round2(aprRet.total_sales_value) === 100000 && round2(aprRet.total_output_tax) === 18000 &&
           round2(aprRet.total_purchases_value) === 50000 && round2(aprRet.total_input_tax) === 9000 &&
           round2(aprRet.net_tax_payable) === 9000 && round2(aprRet.total_wht_adjustable) === 5000,
      `April 2026 Return accurate & strictly period-scoped: Sales=100k, OutputTax=18k, InputTax=9k, Net=9k, WHT=5k`);

    console.log('--- 3. Filed Return Lock & Controlled Amendment ---');
    const filedRet = await taxComplianceService.markReturnFiled(null, tenantA, aprRet.id, { iris_acknowledgement_number: `IRIS-APR-${ts}` });
    assert(filedRet.filing_status === 'Filed' && Boolean(filedRet.locked_at), 'April return marked Filed & Locked');

    let overwriteBlocked = false;
    try {
      await taxComplianceService.compileMonthlyReturn(null, tenantA, { month: 4, year: 2026, jurisdictionCode: 'FBR_FED' });
    } catch (e) {
      if (e.message.includes('already Filed')) overwriteBlocked = true;
    }
    assert(overwriteBlocked, 'Re-compiling locked Filed return without amend=true strictly blocked');

    const amendedRet = await taxComplianceService.compileMonthlyReturn(null, tenantA, { month: 4, year: 2026, jurisdictionCode: 'FBR_FED', amendIfFiled: true });
    assert(amendedRet.filing_status === 'Amended' && parseInt(amendedRet.amended_count, 10) >= 1,
      `Authorized amendment incremented amended_count cleanly (status=${amendedRet.filing_status})`);

    console.log('--- 4. STATL ATL Verifier & Multi-Tenant Isolation ---');
    const statl = await taxComplianceService.runStatlBulkVerify(tenantA);
    assert(statl.total_verified === 3 && statl.active_filers === 2 && statl.non_filers === 1,
      `STATL Bulk Verify classified ${statl.active_filers} Active Filers and ${statl.non_filers} Non-Filer cleanly`);

    const statlB = await taxComplianceService.runStatlBulkVerify(tenantB);
    const returnsB = await db.query(`SELECT COUNT(*) as cnt FROM tax_monthly_returns WHERE tenant_id = $1`, [tenantB]);
    assert(statlB.total_verified === 0 && parseInt(returnsB.rows[0].cnt, 10) === 0,
      'Multi-Tenant Isolation: Tenant B sees 0 returns, 0 customers, and 0 suppliers from Tenant A');

    console.log('\n================================================================');
    console.log(`🎉 ALL ${passed}/${passed + failed} TAXGUARD TESTS PASSED (100%)!`);
    console.log('================================================================\n');
  } finally {
    await db.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [tenantA, tenantB]).catch(() => {});
  }
  process.exit(failed > 0 ? 1 : 0);
}

runTaxComplianceTestSuite().catch(err => {
  console.error('FATAL TAXGUARD TEST ERROR:', err);
  process.exit(1);
});

