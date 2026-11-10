/**
 * ============================================================================
 * MASHRUE CORE HRM MODULE — COMPREHENSIVE AUTOMATED TEST SUITE
 * ============================================================================
 */

const db = require('./config/db');
const hrmService = require('./services/hrmService');

async function runHrmTestSuite() {
  console.log('================================================================');
  console.log('👥 RUNNING MASHRUE CORE HRM MODULE TEST SUITE');
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
  const tenantA = 'a7000000-0000-0000-0000-000000' + ts;
  const tenantB = 'b7000000-0000-0000-0000-000000' + ts;

  try {
    console.log('--- 1. Standalone Setup (mod_hrm ONLY — No Payroll Required) ---');
    await db.query(
      `INSERT INTO tenants (id, company_name, subdomain, subscription_plan, active_modules, status)
       VALUES ($1, $2, $3, 'Custom', '["mod_hrm"]'::jsonb, 'Active'),
              ($4, $5, $6, 'Custom', '["mod_hrm"]'::jsonb, 'Active')`,
      [tenantA, `HRM Corp A ${ts}`, `hrm-a-${ts}`, tenantB, `HRM Corp B ${ts}`, `hrm-b-${ts}`]
    );

    const emp1 = await hrmService.createEmployee(null, tenantA, {
      first_name: 'Amna', last_name: 'Rasheed', cnic: '35202-1111111-2',
      department_name: 'Engineering', designation_name: 'Senior Architect',
      basic_salary: 120000, gross_salary: 180000, bank_iban: 'PK00HBL123'
    });
    assert(Boolean(emp1.id) && emp1.employment_status === 'Active', `Employee ${emp1.employee_code} onboarded standalone`);

    console.log('--- 2. Employee Update, Offboarding & Quota Initialization ---');
    const updatedEmp1 = await hrmService.updateEmployee(null, tenantA, emp1.id, {
      designation_name: 'Principal Architect', gross_salary: 210000, basic_salary: 140000
    });
    assert(updatedEmp1.designation_name === 'Principal Architect' && parseFloat(updatedEmp1.gross_salary) === 210000,
      'Employee update persisted cleanly (fixes missing PUT /employees/:id)');

    const curYr = new Date().getFullYear();
    const balInit = await db.query(`SELECT * FROM hrm_leave_balances WHERE employee_id = $1 AND leave_year = $2`, [emp1.id, curYr]);
    assert(balInit.rows.length >= 4, `Leave quota balances initialized cleanly (${balInit.rows.length} types)`);

    console.log('--- 3. Stateful Leave Workflow (Pending -> Approved, Quota Deduction & Overlap Guard) ---');
    const lv1 = await hrmService.submitLeaveRequest(null, tenantA, {
      employee_id: emp1.id, leave_type: 'Casual', start_date: `${curYr}-05-10`, end_date: `${curYr}-05-12`, total_days: 3, reason: 'Family travel'
    });
    assert(lv1.status === 'Pending', 'Leave submission defaults to Pending (no auto-approval)');

    // Overlap guard must reject second leave on 2026-05-11
    let overlapBlocked = false;
    try {
      await hrmService.submitLeaveRequest(null, tenantA, {
        employee_id: emp1.id, leave_type: 'Annual', start_date: `${curYr}-05-11`, end_date: `${curYr}-05-13`, total_days: 3
      });
    } catch (e) {
      if (e.message.includes('Overlapping')) overlapBlocked = true;
    }
    assert(overlapBlocked, 'Overlapping leave dates strictly rejected');

    // Approve lv1 -> deducts 3 Casual days (10 -> 7 remaining)
    const lvApproved = await hrmService.updateLeaveStatus(null, tenantA, lv1.id, { status: 'Approved' });
    const casBal = await db.query(`SELECT allocated_days, used_days FROM hrm_leave_balances WHERE employee_id = $1 AND leave_year = $2 AND leave_type = 'Casual'`, [emp1.id, curYr]);
    assert(lvApproved.status === 'Approved' && parseFloat(casBal.rows[0].used_days) === 3,
      `Leave approved cleanly and Casual used_days updated to ${casBal.rows[0].used_days}`);

    // Rejecting/Cancelling approved leave restores balance (3 -> 0)
    await hrmService.updateLeaveStatus(null, tenantA, lv1.id, { status: 'Cancelled' });
    const casBalAfter = await db.query(`SELECT used_days FROM hrm_leave_balances WHERE employee_id = $1 AND leave_year = $2 AND leave_type = 'Casual'`, [emp1.id, curYr]);
    assert(parseFloat(casBalAfter.rows[0].used_days) === 0, 'Cancelling approved leave restored Casual quota back to 0 used');

    // Insufficient quota guard (request 50 Casual days when quota is 10)
    let quotaBlocked = false;
    try {
      await hrmService.submitLeaveRequest(null, tenantA, {
        employee_id: emp1.id, leave_type: 'Casual', start_date: `${curYr}-07-01`, end_date: `${curYr}-08-20`, total_days: 50
      });
    } catch (e) {
      if (e.message.includes('Insufficient')) quotaBlocked = true;
    }
    assert(quotaBlocked, 'Request exceeding available leave quota strictly blocked');

    console.log('--- 4. Offboarding, Terminated Leave Block & Tenant Isolation ---');
    const termEmp = await hrmService.terminateEmployee(null, tenantA, emp1.id, { termination_reason: 'Resigned cleanly' });
    assert(termEmp.employment_status === 'Terminated' && Boolean(termEmp.termination_date), 'Employee offboarded with termination date');

    let termLeaveBlocked = false;
    try {
      await hrmService.submitLeaveRequest(null, tenantA, {
        employee_id: emp1.id, leave_type: 'Unpaid', start_date: `${curYr}-09-01`, end_date: `${curYr}-09-02`, total_days: 2
      });
    } catch (e) {
      if (e.message.includes('Terminated')) termLeaveBlocked = true;
    }
    assert(termLeaveBlocked, 'Terminated employee blocked from submitting new leave');

    const kpiB = await hrmService.getDashboard(tenantB);
    assert(kpiB.active_employees === 0 && kpiB.terminated_employees === 0,
      'Multi-Tenant Isolation: Tenant B sees 0 employees/metrics from Tenant A');

    const audits = await db.query(`SELECT COUNT(*) as cnt FROM hrm_audit_logs WHERE tenant_id = $1`, [tenantA]);
    assert(parseInt(audits.rows[0].cnt, 10) >= 5, `HRM Audit log captured ${audits.rows[0].cnt} events`);

    console.log('\n================================================================');
    console.log(`🎉 ALL ${passed}/${passed + failed} CORE HRM TESTS PASSED (100%)!`);
    console.log('================================================================\n');
  } finally {
    await db.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [tenantA, tenantB]).catch(() => {});
  }
  process.exit(failed > 0 ? 1 : 0);
}

runHrmTestSuite().catch(err => {
  console.error('FATAL HRM TEST ERROR:', err);
  process.exit(1);
});

