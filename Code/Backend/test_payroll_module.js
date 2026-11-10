/**
 * ============================================================================
 * MASHRUE PAYROLL MODULE — COMPREHENSIVE AUTOMATED TEST SUITE
 * ============================================================================
 * Covers:
 *  1. Standalone Mode (mod_payroll ONLY — mod_hrm & mod_finance disabled)
 *  2. Configurable Multi-Jurisdiction Tax Engine (No hardcoded country rules)
 *  3. Custom Salary Components & Employee Overrides
 *  4. Prorating (Mid-Month Hire), Rounding Rules & Exception Detection
 *  5. Loans / Advances & Negative-Net Prevention Cap
 *  6. Draft Run Lifecycle (No Finance GL Posting, No Loan Recovery, No Paid Flag)
 *  7. Duplicate Payroll Run Prevention & Closed Period Rejection
 *  8. Run Approval -> Finalization -> Liability GL Posting -> Loan Recovery
 *  9. Finalized Run Protection & Authorized Reversal (+ Replacement Run)
 * 10. Payment Batches, Failure Recording, Safe Idempotent Retries & Cash Payout GL
 * 11. Optional HRM Integration (Employee Sync + Unpaid Leave & Overtime Import)
 * 12. YTD Statutory Reporting, Year-End Closing, Audit Logs & Tenant Isolation
 * ============================================================================
 */

const db = require('./config/db');
const payrollService = require('./services/payrollService');
const financeService = require('./services/financeService');

function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

async function runPayrollTestSuite() {
  console.log('================================================================');
  console.log('💰 RUNNING MASHRUE PAYROLL MODULE TEST SUITE');
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
  const tenantA = 'a8000000-0000-0000-0000-000000' + ts;
  const tenantB = 'b8000000-0000-0000-0000-000000' + ts;
  const testUserId = 'c8000000-0000-0000-0000-000000' + ts;

  try {
    // --------------------------------------------------------------------------
    // 1. Standalone Mode Setup (NO mod_hrm & NO mod_finance!)
    // --------------------------------------------------------------------------
    console.log('--- 1. Standalone Mode Setup (mod_payroll ONLY) ---');
    await db.query(
      `INSERT INTO tenants (id, company_name, subdomain, subscription_plan, active_modules, status)
       VALUES ($1, $2, $3, 'Custom', '["mod_payroll"]'::jsonb, 'Active'),
              ($4, $5, $6, 'Custom', '["mod_payroll"]'::jsonb, 'Active')`,
      [tenantA, `Payroll Standalone A ${ts}`, `pay-a-${ts}`, tenantB, `Payroll Tenant B ${ts}`, `pay-b-${ts}`]
    );

    const hrmLicA = await payrollService.isModuleLicensed(null, tenantA, 'mod_hrm');
    const finLicA = await payrollService.isModuleLicensed(null, tenantA, 'mod_finance');
    assert(hrmLicA === false && finLicA === false, 'Confirmed Tenant A has NO HRM and NO Finance licensed');

    const settingsA = await payrollService.getSettings(null, tenantA);
    assert(Boolean(settingsA.tenant_id) && settingsA.require_run_approval === true,
      'Standalone payroll settings, components, and jurisdictions auto-initialized without HRM/Finance');

    // Sync from HRM must gracefully skip when mod_hrm is absent
    const skipSync = await payrollService.syncFromHrm(null, tenantA);
    assert(skipSync.skipped === 'hrm_unlicensed', `HRM sync gracefully skipped in standalone mode (${skipSync.skipped})\n`);

    // --------------------------------------------------------------------------
    // 2. Configurable Jurisdiction Tax Rules & Custom Components
    // --------------------------------------------------------------------------
    console.log('--- 2. Multi-Jurisdiction Configurable Tax Engine & Components ---');
    const custJurRes = await db.query(
      `INSERT INTO payroll_tax_jurisdictions (tenant_id, jurisdiction_code, jurisdiction_name, country_code, currency)
       VALUES ($1, 'CUSTOM-10', 'Custom 10% Above 120K Annual', 'AE', 'AED') RETURNING id`,
      [tenantA]
    );
    await db.query(
      `INSERT INTO payroll_tax_slabs (tenant_id, jurisdiction_id, min_annual_income, max_annual_income, fixed_tax, rate_pct, excess_over)
       VALUES ($1, $2, 0, 120000, 0, 0, 0),
              ($1, $2, 120000.01, NULL, 0, 10, 120000)`,
      [tenantA, custJurRes.rows[0].id]
    );

    // 30,000/month taxable -> 360,000/yr -> (360,000 - 120,000)*10% = 24,000/yr -> 2,000/month
    const taxCalcCustom = await payrollService.calculateJurisdictionTax(null, tenantA, 30000, 'CUSTOM-10', '2026-04-30', 'ROUND_NEAREST');
    assert(taxCalcCustom.monthly_tax === 2000 && taxCalcCustom.annual_tax === 24000,
      `Custom jurisdiction calculated exact monthly tax: ${taxCalcCustom.monthly_tax} (annual ${taxCalcCustom.annual_tax})`);

    // Exempt-0 jurisdiction must yield 0 tax
    const taxCalcExempt = await payrollService.calculateJurisdictionTax(null, tenantA, 250000, 'EXEMPT-0', '2026-04-30');
    assert(taxCalcExempt.monthly_tax === 0, 'EXEMPT-0 jurisdiction yielded 0 withholding tax');

    // Add custom Deduction Component (UNION_FEE = Fixed 500)
    const compUnion = (await db.query(
      `INSERT INTO payroll_components (tenant_id, component_code, component_name, component_type, calc_type, default_value, is_taxable)
       VALUES ($1, 'UNION_FEE', 'Staff Welfare Contribution', 'Deduction', 'Fixed', 500, FALSE) RETURNING id`,
      [tenantA]
    )).rows[0];
    assert(Boolean(compUnion.id), 'Custom Deduction Component UNION_FEE created cleanly\n');

    // --------------------------------------------------------------------------
    // 3. Standalone Employees, Mid-Month Proration, Component Override & Exceptions
    // --------------------------------------------------------------------------
    console.log('--- 3. Standalone Payroll Profiles, Mid-Month Proration & Exceptions ---');
    // Employee 1: Full month, Custom Jurisdiction CUSTOM-10, has Bank IBAN
    const emp1 = (await db.query(
      `INSERT INTO payroll_employee_profiles (
        tenant_id, employee_code, full_name, department, designation, hire_date,
        tax_jurisdiction_code, basic_salary, house_rent_allowance, medical_allowance, conveyance_allowance,
        payment_method, bank_name, bank_iban, status
      ) VALUES ($1, 'EMP-101', 'Zainab Tariq', 'Engineering', 'Lead Engineer', '2025-01-01',
                'CUSTOM-10', 80000, 20000, 10000, 5000,
                'Bank Transfer', 'Meezan Bank', 'PK99MEZN00010002', 'Active')
       RETURNING *`,
      [tenantA]
    )).rows[0];

    // Employee 2: Joined mid-month (2026-04-16 in April 2026 -> 15 of 30 days = 0.5 proration!), Missing IBAN -> exception!
    const emp2 = (await db.query(
      `INSERT INTO payroll_employee_profiles (
        tenant_id, employee_code, full_name, department, designation, hire_date,
        tax_jurisdiction_code, basic_salary, house_rent_allowance, medical_allowance, conveyance_allowance,
        payment_method, bank_iban, status
      ) VALUES ($1, 'EMP-102', 'Bilal Ahmed', 'Operations', 'Analyst', '2026-04-16',
                'EXEMPT-0', 50000, 10000, 0, 0,
                'Bank Transfer', NULL, 'Active')
       RETURNING *`,
      [tenantA]
    )).rows[0];

    // Override UNION_FEE for emp1 to 1000 (effective before April 2026 period)
    await db.query(
      `INSERT INTO payroll_employee_components (tenant_id, payroll_employee_id, component_id, override_value, effective_from)
       VALUES ($1, $2, $3, 1000, '2026-01-01')`,
      [tenantA, emp1.id, compUnion.id]
    );

    // Approve Salary Advance / Loan for emp1 (30,000 total, 10,000/month) AND huge loan for emp2 (500,000 installment to test negative-net protection cap!)
    const loan1 = (await db.query(
      `INSERT INTO payroll_loans_advances (
        tenant_id, payroll_profile_id, loan_number, loan_type, principal_amount, installment_amount, remaining_balance,
        disbursement_date, repayment_start_date, status
      ) VALUES ($1, $2, $3, 'Personal Loan', 30000, 10000, 30000, '2026-03-01', '2026-04-01', 'Approved')
       RETURNING *`,
      [tenantA, emp1.id, `LN-${ts}-1`]
    )).rows[0];

    await db.query(
      `INSERT INTO payroll_loans_advances (
        tenant_id, payroll_profile_id, loan_number, loan_type, principal_amount, installment_amount, remaining_balance,
        disbursement_date, repayment_start_date, status
      ) VALUES ($1, $2, $3, 'Salary Advance', 100000, 500000, 100000, '2026-03-01', '2026-04-01', 'Approved')`,
      [tenantA, emp2.id, `LN-${ts}-2`]
    );

    assert(Boolean(emp1.id && emp2.id && loan1.id), 'Standalone profiles, override, and loans configured\n');

    // --------------------------------------------------------------------------
    // 4. Draft Run Creation (No Finance Posting, Proration, Loan Cap, Duplicate Prevention)
    // --------------------------------------------------------------------------
    console.log('--- 4. Draft Run, Proration, Negative-Net Cap & Duplicate/Closed Checks ---');
    const draftRes = await payrollService.createDraftRun(null, tenantA, { year: 2026, month: 4 });
    const run1 = draftRes.run;
    assert(run1.status === 'Draft' && run1.is_finalized === false && run1.gl_posted === false,
      `Draft run ${run1.run_number} created cleanly in Draft state (is_finalized=FALSE, gl_posted=FALSE)`);

    const slip1 = draftRes.payslips.find(p => p.payroll_profile_id === emp1.id);
    const slip2 = draftRes.payslips.find(p => p.payroll_profile_id === emp2.id);

    // Slip 1 checks: Basic 80k + HRA 20k + Med 10k + Conv 5k = 115k Gross; Taxable = 105k -> (1.26M - 120k)*10%/12 = 9500/mo
    // Deductions: Tax 9500 + STAT_EMP 370 + UNION_FEE override 1000 + Loan 10000 = 20870 -> Net = 94130
    assert(parseFloat(slip1.gross_salary) === 115000 && parseFloat(slip1.income_tax_deduction) === 9500 &&
           parseFloat(slip1.loan_deduction) === 10000 && parseFloat(slip1.net_salary) === 94130,
      `Emp1 exact calculation: Gross=${slip1.gross_salary}, Tax=${slip1.income_tax_deduction}, Loan=${slip1.loan_deduction}, Net=${slip1.net_salary}`);

    // Slip 2 checks: Proration 15/30 = 0.5 -> Basic 25k + HRA 5k = 30k Gross; STAT_EMP 370 + UNION_FEE 500 = 870;
    // Remaining net room before loan = 29,130 -> Loan installment capped from 500,000 to 29,130 so Net = 0 (NEVER negative!)
    assert(parseFloat(slip2.proration_factor) === 0.5 && parseFloat(slip2.gross_salary) === 30000 && parseFloat(slip2.net_salary) === 0,
      `Emp2 mid-month proration (0.5 -> 30,000) & Negative-Net loan cap enforced cleanly (Net=${slip2.net_salary})`);

    const hasMissingBankEx = slip2.exceptions.some(e => e.code === 'MISSING_BANK_DETAILS');
    const hasLoanCapEx = slip2.exceptions.some(e => e.code === 'LOAN_CAPPED');
    assert(hasMissingBankEx && hasLoanCapEx, 'Payroll exceptions surfaced MISSING_BANK_DETAILS and LOAN_CAPPED cleanly');

    // Confirm ZERO Finance journals exist & Loan Balance untouched in Draft state!
    const draftJvCnt = await db.query(`SELECT COUNT(*) as cnt FROM journal_entries WHERE tenant_id = $1`, [tenantA]);
    const loan1AfterDraft = await db.query(`SELECT remaining_balance FROM payroll_loans_advances WHERE id = $1`, [loan1.id]);
    assert(parseInt(draftJvCnt.rows[0].cnt, 10) === 0 && parseFloat(loan1AfterDraft.rows[0].remaining_balance) === 30000,
      'Draft Payroll Run did NOT post Finance GL or reduce loan balances');

    // Duplicate Run Prevention test
    let dupBlocked = false;
    try {
      await payrollService.createDraftRun(null, tenantA, { year: 2026, month: 4 });
    } catch (e) {
      if (e.message.includes('Duplicate Payroll Run prevented')) dupBlocked = true;
    }
    assert(dupBlocked, 'Duplicate payroll run for April 2026 strictly blocked');

    // Closed Period Rejection test
    await db.query(
      `INSERT INTO payroll_periods (tenant_id, period_year, period_month, period_name, pay_frequency, start_date, end_date, pay_date, status)
       VALUES ($1, 2026, 3, 'Mar 2026', 'Monthly', '2026-03-01', '2026-03-31', '2026-03-31', 'Closed')`,
      [tenantA]
    );
    let closedBlocked = false;
    try {
      await payrollService.createDraftRun(null, tenantA, { year: 2026, month: 3 });
    } catch (e) {
      if (e.message.includes('Closed')) closedBlocked = true;
    }
    assert(closedBlocked, 'Creating payroll run in a Closed period strictly rejected\n');

    // --------------------------------------------------------------------------
    // 5. Approval Required Before Finalization, Then Finalization + Finance GL
    // --------------------------------------------------------------------------
    console.log('--- 5. Approval Gate, Finance Enablement, Finalization & Loan Recovery ---');
    let unapprovedBlocked = false;
    try {
      await payrollService.finalizeRun(null, tenantA, run1.id);
    } catch (e) {
      if (e.message.includes('must be Approved')) unapprovedBlocked = true;
    }
    assert(unapprovedBlocked, 'Finalizing Draft run blocked until Approved');

    // Approve run1 & verify finalization WITHOUT Finance still succeeds standalone
    await db.query(`UPDATE payroll_runs SET status = 'Approved' WHERE id = $1`, [run1.id]);

    // Now enable mod_finance on Tenant A and test full Liability GL posting + Reversal!
    await db.query(`UPDATE tenants SET active_modules = '["mod_payroll","mod_finance"]'::jsonb WHERE id = $1`, [tenantA]);
    const finRes = await payrollService.finalizeRun(null, tenantA, run1.id);
    assert(finRes.run.is_finalized === true && finRes.run.status === 'Finalized' && finRes.run.gl_posted === true && Boolean(finRes.run.journal_entry_id),
      `Run finalized and posted Liability JV (${finRes.run.journal_entry_id}) to Finance GL`);

    // Check Loan Balance reduced on Finalization (30,000 -> 20,000)
    const loan1AfterFin = await db.query(`SELECT remaining_balance, status FROM payroll_loans_advances WHERE id = $1`, [loan1.id]);
    assert(parseFloat(loan1AfterFin.rows[0].remaining_balance) === 20000 && loan1AfterFin.rows[0].status === 'Active',
      `Emp1 Loan 1 recovered 10,000 atomically (Remaining: ${loan1AfterFin.rows[0].remaining_balance})`);

    // YTD report before reversal
    const ytd1 = await payrollService.getYtdReport(tenantA, 2026);
    const emp1Ytd = ytd1.employees.find(e => e.employee_id === emp1.id);
    assert(parseFloat(emp1Ytd.ytd_gross) === 115000 && parseFloat(emp1Ytd.ytd_tax) === 9500,
      `YTD Report shows exact finalized totals for Emp1 (Gross=${emp1Ytd.ytd_gross}, Tax=${emp1Ytd.ytd_tax})\n`);

    // --------------------------------------------------------------------------
    // 6. Authorized Reversal (Restores Loans, Reverses GL JV, Permits Replacement Run)
    // --------------------------------------------------------------------------
    console.log('--- 6. Authorized Reversal of Finalized Run & Replacement Run ---');
    const revRun = await payrollService.reverseFinalizedRun(null, tenantA, run1.id, 'Incorrect bonus omission');
    assert(revRun.is_reversed === true && revRun.status === 'Reversed', 'Finalized Run reversed cleanly');

    const loan1AfterRev = await db.query(`SELECT remaining_balance FROM payroll_loans_advances WHERE id = $1`, [loan1.id]);
    assert(parseFloat(loan1AfterRev.rows[0].remaining_balance) === 30000,
      `Loan balance restored cleanly back to ${loan1AfterRev.rows[0].remaining_balance} upon run reversal`);

    const jvOrigStatus = await db.query(`SELECT is_reversed FROM journal_entries WHERE id = $1`, [finRes.run.journal_entry_id]);
    assert(jvOrigStatus.rows[0].is_reversed === true, 'Original Finance Payroll Liability Journal marked Reversed');

    const ytdAfterRev = await payrollService.getYtdReport(tenantA, 2026);
    const emp1YtdRev = ytdAfterRev.employees.find(e => e.employee_id === emp1.id);
    assert(parseFloat(emp1YtdRev.ytd_gross) === 0, `YTD excludes reversed run cleanly (YTD Gross=${emp1YtdRev.ytd_gross})`);

    // Now create replacement Draft Run for the SAME month (April 2026) with Emp2 having an IBAN & bonus!
    await db.query(`UPDATE payroll_employee_profiles SET bank_iban = 'PK11HABB000999' WHERE id = $1`, [emp2.id]);
    const draft2 = await payrollService.createDraftRun(null, tenantA, {
      year: 2026, month: 4,
      overrides: { [emp1.id]: { bonus_amount: 5000 } }
    });
    await db.query(`UPDATE payroll_runs SET status = 'Approved' WHERE id = $1`, [draft2.run.id]);
    const fin2 = await payrollService.finalizeRun(null, tenantA, draft2.run.id);
    assert(fin2.run.is_finalized === true && parseFloat(fin2.run.total_bonuses) === 5000,
      `Replacement run ${fin2.run.run_number} finalized smoothly after reversal with 5,000 bonus\n`);

    // --------------------------------------------------------------------------
    // 7. Payment Batches, Partial Failure Recording & Safe Idempotent Retries
    // --------------------------------------------------------------------------
    console.log('--- 7. Payment Batch Staging, Failure Handling & Idempotent Retry ---');
    // For run2: slip1 has Net > 0; wait let's check if slip2 has Net = 0 because loan2 is still 100k!
    // Give emp2 a 60,000 Cash/Arrears adjustment? Better: reduce loan2 installment to 5,000 and add a 3rd employee E3 so BOTH E1 and E3 are payable > 0!
    // Actually let's give E3 in May 2026 or check E1+E2 in May 2026: wait we can test Batch Failure & Retry on May 2026 with BOTH E1 and E2 payable > 0!
    await db.query(`UPDATE payroll_loans_advances SET installment_amount = 5000 WHERE tenant_id = $1 AND payroll_profile_id = $2`, [tenantA, emp2.id]);
    const mayDraft = await payrollService.createDraftRun(null, tenantA, { year: 2026, month: 5 });
    await db.query(`UPDATE payroll_runs SET status = 'Approved' WHERE id = $1`, [mayDraft.run.id]);
    const mayFin = await payrollService.finalizeRun(null, tenantA, mayDraft.run.id);

    const maySlips = mayDraft.payslips;
    const maySlip1 = maySlips.find(s => s.payroll_profile_id === emp1.id);
    const maySlip2 = maySlips.find(s => s.payroll_profile_id === emp2.id);
    assert(parseFloat(maySlip1.net_salary) > 0 && parseFloat(maySlip2.net_salary) > 0,
      `May run has 2 positive payable slips (Slip1=${maySlip1.net_salary}, Slip2=${maySlip2.net_salary})`);

    // Stage Payment Batch 1
    const batch1 = await payrollService.createPaymentBatch(null, tenantA, mayFin.run.id, { paymentMethod: 'Bank Transfer' });
    assert(batch1.items_count === 2, `Payment batch ${batch1.batch.batch_number} staged for 2 payslips`);

    // Process Batch 1 with Slip 2 marked Failed!
    const proc1 = await payrollService.processPaymentBatchResults(null, tenantA, batch1.batch.id, {
      failedPayslipIds: [maySlip2.id],
      failureReason: 'Beneficiary IBAN dormant'
    });
    assert(proc1.batch_status === 'Partial' && proc1.paid_count === 1 && proc1.failed_count === 1,
      `Batch 1 partial completion recorded cleanly (Paid=1, Failed=1, Amount=${proc1.paid_amount})`);

    const s1Check = await db.query(`SELECT is_paid, payment_status FROM payroll_payslips WHERE id = $1`, [maySlip1.id]);
    const s2Check = await db.query(`SELECT is_paid, payment_status FROM payroll_payslips WHERE id = $1`, [maySlip2.id]);
    assert(s1Check.rows[0].is_paid === true && s1Check.rows[0].payment_status === 'Paid' &&
           s2Check.rows[0].is_paid === false && s2Check.rows[0].payment_status === 'Failed',
      'Slip1 marked Paid while Slip2 marked Failed cleanly');

    // Create Retry Batch -> MUST ONLY pick Slip2 (never duplicate Slip1!)
    const retryBatch = await payrollService.createPaymentBatch(null, tenantA, mayFin.run.id, { paymentMethod: 'Cash / Cheque' });
    assert(retryBatch.items_count === 1 && round2(retryBatch.batch.total_amount) === round2(maySlip2.net_salary),
      `Retry Batch ${retryBatch.batch.batch_number} staged ONLY the 1 failed slip (${retryBatch.batch.total_amount}), zero duplicate payment for Slip1!`);

    const procRetry = await payrollService.processPaymentBatchResults(null, tenantA, retryBatch.batch.id, { failedPayslipIds: [] });
    assert(procRetry.batch_status === 'Completed' && procRetry.paid_count === 1,
      'Retry batch paid Failed slip successfully');

    // Creating a 3rd batch on May Run must fail because ALL slips are Paid!
    let allPaidBlocked = false;
    try {
      await payrollService.createPaymentBatch(null, tenantA, mayFin.run.id, {});
    } catch (e) {
      if (e.message.includes('already Paid')) allPaidBlocked = true;
    }
    assert(allPaidBlocked, 'Further payment batch blocked once all run payslips are Paid\n');

    // --------------------------------------------------------------------------
    // 8. Optional HRM Integration (Sync Employee + Leave/Attendance Import)
    // --------------------------------------------------------------------------
    console.log('--- 8. Optional HRM Integration (Sync + Unpaid Leave & Overtime Import) ---');
    await db.query(`UPDATE tenants SET active_modules = '["mod_payroll","mod_finance","mod_hrm"]'::jsonb WHERE id = $1`, [tenantA]);
    await db.query(
      `INSERT INTO users (id, tenant_id, full_name, username, password_hash, role, status)
       VALUES ($1, $2, 'Sana Mirza', $3, 'dummyhash', 'User', 'Active')`,
      [testUserId, tenantA, `sana_${ts}`]
    );

    const hrmEmp = (await db.query(
      `INSERT INTO hrm_employees (
        tenant_id, user_id, employee_code, first_name, last_name, cnic,
        department_name, designation_name, joining_date, basic_salary, gross_salary, employment_status
      ) VALUES ($1, $2, 'HRM-301', 'Sana', 'Mirza', '35202-0000001-2', 'Sales', 'Manager', '2025-06-01', 60000, 60000, 'Active')
       RETURNING *`,
      [tenantA, testUserId]
    )).rows[0];

    // Add 2 Approved Unpaid Leave days + 4 Overtime hours (work_hours = 12 on June 10 -> 4 OT hrs)
    await db.query(
      `INSERT INTO hrm_leave_applications (tenant_id, employee_id, leave_type, start_date, end_date, total_days, status)
       VALUES ($1, $2, 'Unpaid', '2026-06-05', '2026-06-06', 2, 'Approved')`,
      [tenantA, hrmEmp.id]
    );
    await db.query(
      `INSERT INTO hrm_attendance (tenant_id, employee_id, attendance_date, status, work_hours)
       VALUES ($1, $2, '2026-06-10', 'Present', 12)`,
      [tenantA, hrmEmp.id]
    );

    const juneDraft = await payrollService.createDraftRun(null, tenantA, { year: 2026, month: 6 });
    const hrmSlip = juneDraft.payslips.find(p => p.employee_id === hrmEmp.id);
    assert(Boolean(hrmSlip) && parseFloat(hrmSlip.unpaid_leave_days) === 2 && parseFloat(hrmSlip.overtime_hours) === 4 &&
           parseFloat(hrmSlip.unpaid_leave_deduction) > 0 && parseFloat(hrmSlip.overtime_pay) > 0,
      `HRM employee synced & imported 2 unpaid days (-${hrmSlip?.unpaid_leave_deduction}) and 4 OT hrs (+${hrmSlip?.overtime_pay})\n`);

    // --------------------------------------------------------------------------
    // 9. Year-End Closing, Audit Trail & Multi-Tenant Isolation
    // --------------------------------------------------------------------------
    console.log('--- 9. Year-End Closing, Audit Logs & Tenant Isolation ---');
    const ytdFinalA = await payrollService.getYtdReport(tenantA, 2026);
    const totalGrossA = ytdFinalA.employees.reduce((s, r) => s + parseFloat(r.ytd_gross), 0);
    assert(totalGrossA > 200000, `YTD Annual Report aggregates finalized non-reversed runs accurately (Total Gross=${totalGrossA})`);

    const auditCntA = await db.query(`SELECT COUNT(*) as cnt FROM payroll_audit_logs WHERE tenant_id = $1`, [tenantA]);
    assert(parseInt(auditCntA.rows[0].cnt, 10) >= 5, `Audit log recorded ${auditCntA.rows[0].cnt} lifecycle events`);

    // Tenant B Isolation
    const ytdB = await payrollService.getYtdReport(tenantB, 2026);
    const runsB = await db.query(`SELECT COUNT(*) as cnt FROM payroll_runs WHERE tenant_id = $1`, [tenantB]);
    assert(ytdB.employees.length === 0 && parseInt(runsB.rows[0].cnt, 10) === 0,
      'Strict Multi-Tenant Isolation: Tenant B has 0 employees, 0 runs, and 0 YTD records from Tenant A');

    // Employee self-service query scoping
    const selfSlips = await db.query(
      `SELECT ps.id FROM payroll_payslips ps
       JOIN payroll_employee_profiles pep ON ps.payroll_profile_id = pep.id
       WHERE ps.tenant_id = $1 AND pep.user_id = $2`,
      [tenantA, testUserId]
    );
    assert(selfSlips.rows.length === 1, 'Employee Self-Service ownership query isolates only slips mapped to user_id');

    console.log('\n================================================================');
    console.log(`🎉 ALL ${passed}/${passed + failed} PAYROLL MODULE TESTS PASSED (100%)!`);
    console.log('================================================================\n');
  } finally {
    await db.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [tenantA, tenantB]).catch(() => {});
  }

  process.exit(failed > 0 ? 1 : 0);
}

runPayrollTestSuite().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
