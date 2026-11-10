/**
 * ============================================================================
 * MASHRUE ENTERPRISE PAYROLL ENGINE (services/payrollService.js)
 * ============================================================================
 * Independently usable Payroll Application Engine covering:
 *  - Configurable Payroll Settings, Calendar Periods & Components
 *  - Jurisdiction-Configurable Tax Engine (Zero hardcoded country constraints)
 *  - Standalone Payroll Employee Profiles + Optional HRM Sync (Attendance/Leaves)
 *  - Decimal-safe Proration, Component Calculation, Loan Recovery & Exception Checks
 *  - Run Lifecycle: Draft -> Review/Adjust -> Approve -> Finalize -> Reverse
 *  - Separated Accounting Treatment: Finalization (Liabilities) vs Payment (Cash/Bank)
 *  - Payment Batches with Failure Recording & Idempotent Retries
 *  - YTD Reports, Statutory Summaries & Year-End Closing
 * ============================================================================
 */

const db = require('../config/db');
const financeService = require('./financeService');

function round2(n) {
  const v = Number(n || 0);
  return isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}

class PayrollService {
  applyRounding(val, rule = 'ROUND_NEAREST') {
    const n = Number(val || 0);
    if (!isFinite(n)) return 0;
    if (rule === 'FLOOR') return Math.floor(n);
    if (rule === 'CEIL') return Math.ceil(n);
    if (rule === 'ROUND_2') return round2(n);
    return Math.round(n);
  }

  async logAudit(client, { tenantId, entityType, entityId, action, userId = null, userName = 'System', details = {} }) {
    const qClient = client || db;
    await qClient.query(
      `INSERT INTO payroll_audit_logs (tenant_id, entity_type, entity_id, action, user_id, user_name, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [tenantId, entityType, String(entityId), action, userId, userName || 'System', JSON.stringify(details)]
    );
  }

  async isModuleLicensed(client, tenantId, moduleKey) {
    const qClient = client || db;
    const r = await qClient.query(`SELECT subscription_plan, active_modules FROM tenants WHERE id = $1`, [tenantId]);
    if (r.rows.length === 0) return false;
    const plan = r.rows[0].subscription_plan || 'Advance';
    if (plan !== 'Custom') return true;
    const mods = Array.isArray(r.rows[0].active_modules) ? r.rows[0].active_modules : [];
    if (moduleKey === 'mod_finance' || moduleKey === 'mod_accounting') {
      return mods.includes('mod_finance') || mods.includes('mod_accounting');
    }
    return mods.includes(moduleKey);
  }

  /**
   * Ensure tenant payroll settings, default components, and default tax jurisdiction exist
   */
  async getSettings(client, tenantId) {
    const qClient = client || db;
    let res = await qClient.query(`SELECT * FROM payroll_settings WHERE tenant_id = $1`, [tenantId]);
    if (res.rows.length === 0) {
      res = await qClient.query(
        `INSERT INTO payroll_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW() RETURNING *`,
        [tenantId]
      );
      // Seed default components & configurable PK-FBR / EXEMPT-0 tax rules for brand-new tenants
      await qClient.query(
        `INSERT INTO payroll_components (tenant_id, component_code, component_name, component_type, calc_type, default_value, is_taxable, is_statutory, coa_account_code)
         VALUES
           ($1, 'BASIC', 'Basic Salary', 'Earning', 'Fixed', 0, TRUE, FALSE, '5100'),
           ($1, 'HRA', 'House Rent Allowance', 'Allowance', 'Pct of Basic', 30, TRUE, FALSE, '5100'),
           ($1, 'MED', 'Medical Allowance', 'Allowance', 'Pct of Basic', 10, FALSE, FALSE, '5100'),
           ($1, 'CONV', 'Conveyance Allowance', 'Allowance', 'Fixed', 5000, TRUE, FALSE, '5100'),
           ($1, 'STAT_EMP', 'Statutory Social Security (Employee)', 'Deduction', 'Fixed', 370, FALSE, TRUE, '2250'),
           ($1, 'STAT_ER', 'Statutory Social Security (Employer)', 'Employer Contribution', 'Fixed', 1850, FALSE, TRUE, '2250')
         ON CONFLICT (tenant_id, component_code) DO NOTHING`,
        [tenantId]
      );

      const jurRes = await qClient.query(
        `INSERT INTO payroll_tax_jurisdictions (tenant_id, jurisdiction_code, jurisdiction_name, country_code, currency)
         VALUES ($1, 'PK-FBR', 'Pakistan FBR Salaried Slabs (Configurable)', 'PK', 'PKR')
         ON CONFLICT (tenant_id, jurisdiction_code) DO UPDATE SET jurisdiction_name = EXCLUDED.jurisdiction_name RETURNING id`,
        [tenantId]
      );
      const jurId = jurRes.rows[0].id;
      const slabCheck = await qClient.query(`SELECT id FROM payroll_tax_slabs WHERE jurisdiction_id = $1 LIMIT 1`, [jurId]);
      if (slabCheck.rows.length === 0) {
        const slabs = [
          [0, 600000, 0, 0, 0],
          [600000.01, 1200000, 0, 5, 600000],
          [1200000.01, 2200000, 30000, 15, 1200000],
          [2200000.01, 3200000, 180000, 25, 2200000],
          [3200000.01, 4100000, 430000, 30, 3200000],
          [4100000.01, null, 700000, 35, 4100000]
        ];
        for (const [minI, maxI, fix, rate, ex] of slabs) {
          await qClient.query(
            `INSERT INTO payroll_tax_slabs (tenant_id, jurisdiction_id, min_annual_income, max_annual_income, fixed_tax, rate_pct, excess_over)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [tenantId, jurId, minI, maxI, fix, rate, ex]
          );
        }
      }
      await qClient.query(
        `INSERT INTO payroll_tax_jurisdictions (tenant_id, jurisdiction_code, jurisdiction_name, country_code, currency)
         VALUES ($1, 'EXEMPT-0', 'Tax-Free Jurisdiction (0%)', 'ANY', 'PKR') ON CONFLICT DO NOTHING`,
        [tenantId]
      );
    }
    return res.rows[0];
  }

  async getNextNumber(client, tenantId, type = 'run') {
    const qClient = client || db;
    await this.getSettings(qClient, tenantId);
    const map = {
      run: { pCol: 'run_prefix', sCol: 'run_next_seq', def: 'PR' },
      payslip: { pCol: 'payslip_prefix', sCol: 'payslip_next_seq', def: 'PS' },
      batch: { pCol: 'batch_prefix', sCol: 'batch_next_seq', def: 'PB' }
    };
    const cfg = map[type] || map.run;
    const r = await qClient.query(
      `UPDATE payroll_settings SET ${cfg.sCol} = COALESCE(${cfg.sCol}, 1001) + 1 WHERE tenant_id = $1
       RETURNING ${cfg.pCol} as prefix, (${cfg.sCol} - 1) as seq`,
      [tenantId]
    );
    return `${r.rows[0]?.prefix || cfg.def}-${new Date().getFullYear()}-${r.rows[0]?.seq || 1001}`;
  }

  /**
   * Sync HRM Employees into Payroll Employee Profiles (Only when HRM is licensed & enabled)
   */
  async syncFromHrm(client, tenantId) {
    const qClient = client || db;
    const settings = await this.getSettings(qClient, tenantId);
    if (settings.enable_hrm_integration === false) return { synced: 0, skipped: 'integration_disabled' };

    const hrmActive = await this.isModuleLicensed(qClient, tenantId, 'mod_hrm');
    if (!hrmActive) return { synced: 0, skipped: 'hrm_unlicensed' };

    const hrmEmps = await qClient.query(
      `SELECT e.*, ps.basic_salary as s_basic, ps.house_rent_allowance as s_hra,
              ps.medical_allowance as s_med, ps.conveyance_allowance as s_conv,
              ps.other_allowances as s_other
       FROM hrm_employees e
       LEFT JOIN payroll_salary_structures ps ON ps.employee_id = e.id
       WHERE e.tenant_id = $1 AND e.employment_status = 'Active'`,
      [tenantId]
    );

    let synced = 0;
    for (const he of hrmEmps.rows) {
      const fullName = `${he.first_name || ''} ${he.last_name || ''}`.trim() || he.employee_code;
      const basic = parseFloat(he.s_basic || he.basic_salary || 0);
      const hra = parseFloat(he.s_hra || 0);
      const med = parseFloat(he.s_med || 0);
      const conv = parseFloat(he.s_conv || 0);
      const other = parseFloat(he.s_other || 0);

      await qClient.query(
        `INSERT INTO payroll_employee_profiles (
          tenant_id, hrm_employee_id, user_id, employee_code, full_name, email, phone,
          national_tax_id, department, designation, hire_date, bank_name, bank_account_title,
          bank_iban, basic_salary, house_rent_allowance, medical_allowance, conveyance_allowance, other_allowances, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'Active')
        ON CONFLICT (tenant_id, employee_code) DO UPDATE SET
          hrm_employee_id = EXCLUDED.hrm_employee_id,
          full_name = EXCLUDED.full_name,
          department = EXCLUDED.department,
          designation = EXCLUDED.designation,
          updated_at = NOW()`,
        [
          tenantId, he.id, he.user_id || null, he.employee_code, fullName, he.official_email || null,
          he.personal_phone || null, he.cnic || null, he.department_name || 'General',
          he.designation_name || 'Staff', he.joining_date || new Date().toISOString().slice(0, 10),
          he.bank_name || null, he.bank_account_title || fullName, he.bank_iban || null,
          basic, hra, med, conv, other
        ]
      );
      synced++;
    }
    return { synced };
  }

  /**
   * Jurisdiction-Configurable Tax Calculation Engine (Database-Driven Slabs)
   */
  async calculateJurisdictionTax(client, tenantId, monthlyTaxableIncome, jurisdictionCode = 'PK-FBR', asOfDate = null, roundingRule = 'ROUND_NEAREST') {
    const qClient = client || db;
    const taxableMonthly = Math.max(0, Number(monthlyTaxableIncome || 0));
    if (taxableMonthly <= 0 || jurisdictionCode === 'EXEMPT-0') {
      return { monthly_tax: 0, annual_tax: 0, annual_taxable: 0, slab_applied: 'Exempt / Zero Income' };
    }

    const dateStr = asOfDate || new Date().toISOString().slice(0, 10);
    const jurRes = await qClient.query(
      `SELECT * FROM payroll_tax_jurisdictions WHERE tenant_id = $1 AND jurisdiction_code = $2 AND is_active = TRUE LIMIT 1`,
      [tenantId, jurisdictionCode]
    );
    if (jurRes.rows.length === 0) {
      return { monthly_tax: 0, annual_tax: 0, annual_taxable: taxableMonthly * 12, slab_applied: 'Unconfigured Jurisdiction (0%)' };
    }

    const annualIncome = round2(taxableMonthly * 12);
    const slabsRes = await qClient.query(
      `SELECT * FROM payroll_tax_slabs
       WHERE jurisdiction_id = $1 AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $2::date)
       ORDER BY min_annual_income ASC`,
      [jurRes.rows[0].id, dateStr]
    );

    let matchedSlab = null;
    for (const s of slabsRes.rows) {
      const minI = parseFloat(s.min_annual_income || 0);
      const maxI = s.max_annual_income !== null ? parseFloat(s.max_annual_income) : Infinity;
      if (annualIncome >= minI && annualIncome <= maxI) {
        matchedSlab = s;
        break;
      }
    }

    if (!matchedSlab) {
      return { monthly_tax: 0, annual_tax: 0, annual_taxable: annualIncome, slab_applied: 'No Matching Slab (0%)' };
    }

    const fixedTax = parseFloat(matchedSlab.fixed_tax || 0);
    const ratePct = parseFloat(matchedSlab.rate_pct || 0);
    const excessOver = parseFloat(matchedSlab.excess_over || 0);
    const annualTax = fixedTax + Math.max(0, annualIncome - excessOver) * (ratePct / 100);
    const monthlyTax = this.applyRounding(annualTax / 12, roundingRule);

    return {
      monthly_tax: monthlyTax,
      annual_tax: round2(annualTax),
      annual_taxable: annualIncome,
      slab_applied: `${jurisdictionCode}: ${ratePct}% above ${excessOver}`
    };
  }

  /**
   * Calculate Single Employee Payslip with Prorating, HRM Attendance/Leave Import, Loans & Exceptions
   */
  async calculateEmployeeSlip(client, tenantId, emp, period, settings, override = {}) {
    const qClient = client || db;
    const rounding = settings.rounding_rule || 'ROUND_NEAREST';

    // 1. Proration calculation for mid-period joiners or leavers
    const pStart = new Date(period.start_date);
    const pEnd = new Date(period.end_date);
    const totalPeriodDays = Math.max(1, Math.round((pEnd - pStart) / 86400000) + 1);

    const effStart = emp.hire_date && new Date(emp.hire_date) > pStart ? new Date(emp.hire_date) : pStart;
    const effEnd = emp.termination_date && new Date(emp.termination_date) < pEnd ? new Date(emp.termination_date) : pEnd;
    const workedDays = effEnd >= effStart ? Math.min(totalPeriodDays, Math.round((effEnd - effStart) / 86400000) + 1) : 0;
    const prorationFactor = Number((workedDays / totalPeriodDays).toFixed(6));

    // 2. Optional HRM Attendance & Leave Integration
    let unpaidLeaveDays = override.unpaid_leave_days !== undefined ? parseFloat(override.unpaid_leave_days) : 0;
    let overtimeHours = override.overtime_hours !== undefined ? parseFloat(override.overtime_hours) : 0;

    if (emp.hrm_employee_id && settings.enable_hrm_integration !== false) {
      const hrmLicensed = await this.isModuleLicensed(qClient, tenantId, 'mod_hrm');
      if (hrmLicensed) {
        if (override.unpaid_leave_days === undefined) {
          const lvRes = await qClient.query(
            `SELECT COALESCE(SUM(total_days), 0) as unpaid
             FROM hrm_leave_applications
             WHERE tenant_id = $1 AND employee_id = $2 AND LOWER(leave_type) = 'unpaid' AND status = 'Approved'
               AND start_date <= $3::date AND end_date >= $4::date`,
            [tenantId, emp.hrm_employee_id, period.end_date, period.start_date]
          );
          unpaidLeaveDays = parseFloat(lvRes.rows[0]?.unpaid || 0);
        }
        if (override.overtime_hours === undefined) {
          const attRes = await qClient.query(
            `SELECT COALESCE(SUM(GREATEST(0, COALESCE(work_hours, 8) - 8)), 0) as ot_hrs
             FROM hrm_attendance
             WHERE tenant_id = $1 AND employee_id = $2 AND attendance_date BETWEEN $3::date AND $4::date`,
            [tenantId, emp.hrm_employee_id, period.start_date, period.end_date]
          );
          overtimeHours = parseFloat(attRes.rows[0]?.ot_hrs || 0);
        }
      }
    }

    // 3. Base Earnings & Allowances (Prorated)
    const rawBasic = parseFloat(emp.basic_salary || 0);
    const basic = this.applyRounding(rawBasic * prorationFactor, rounding);
    const hra = this.applyRounding(parseFloat(emp.house_rent_allowance || 0) * prorationFactor, rounding);
    const med = this.applyRounding(parseFloat(emp.medical_allowance || 0) * prorationFactor, rounding);
    const conv = this.applyRounding(parseFloat(emp.conveyance_allowance || 0) * prorationFactor, rounding);
    const otherAll = this.applyRounding(parseFloat(emp.other_allowances || 0) * prorationFactor, rounding);
    const totalAllowances = round2(hra + med + conv + otherAll);

    // Overtime calculation: hourly rate = (rawBasic / workingDays / 8) * multiplier
    const hourlyRate = rawBasic / Math.max(1, parseInt(settings.working_days_per_month || 30, 10)) / 8;
    const overtimePay = override.overtime_pay !== undefined
      ? round2(override.overtime_pay)
      : this.applyRounding(overtimeHours * hourlyRate * parseFloat(settings.overtime_multiplier || 1.5), rounding);

    const bonus = round2(override.bonus_amount || 0);
    const commission = round2(override.commission_amount || 0);
    const arrears = round2(override.arrears_amount || 0);
    const reimbursement = round2(override.reimbursement_amount || 0);

    // 4. Configurable Components & Overrides (Deductions / Employer Contributions)
    const compsRes = await qClient.query(
      `SELECT pc.*, pec.override_value
       FROM payroll_components pc
       LEFT JOIN payroll_employee_components pec
         ON pec.component_id = pc.id AND pec.payroll_employee_id = $2 AND pec.is_active = TRUE
         AND pec.effective_from <= $3::date AND (pec.effective_to IS NULL OR pec.effective_to >= $3::date)
       WHERE pc.tenant_id = $1 AND pc.is_active = TRUE`,
      [tenantId, emp.id, period.end_date]
    );

    let statEmpDed = 0;
    let employerContrib = 0;
    let extraTaxableEarnings = 0;
    let nonTaxableAllowances = med; // Medical allowance up to statutory exempt limit or configured non-taxable

    const breakdown = [
      { code: 'BASIC', name: 'Basic Salary', type: 'Earning', amount: basic, is_taxable: true },
      ...(hra > 0 ? [{ code: 'HRA', name: 'House Rent Allowance', type: 'Allowance', amount: hra, is_taxable: true }] : []),
      ...(med > 0 ? [{ code: 'MED', name: 'Medical Allowance', type: 'Allowance', amount: med, is_taxable: false }] : []),
      ...(conv > 0 ? [{ code: 'CONV', name: 'Conveyance Allowance', type: 'Allowance', amount: conv, is_taxable: true }] : []),
      ...(otherAll > 0 ? [{ code: 'OTHER_ALL', name: 'Other Allowances', type: 'Allowance', amount: otherAll, is_taxable: true }] : []),
      ...(overtimePay > 0 ? [{ code: 'OT', name: `Overtime (${overtimeHours} hrs)`, type: 'Earning', amount: overtimePay, is_taxable: true }] : []),
      ...(bonus > 0 ? [{ code: 'BONUS', name: 'Bonus', type: 'Earning', amount: bonus, is_taxable: true }] : []),
      ...(commission > 0 ? [{ code: 'COMM', name: 'Commission', type: 'Earning', amount: commission, is_taxable: true }] : []),
      ...(arrears > 0 ? [{ code: 'ARREARS', name: 'Salary Arrears', type: 'Earning', amount: arrears, is_taxable: true }] : []),
      ...(reimbursement > 0 ? [{ code: 'REIMB', name: 'Expense Reimbursement', type: 'Reimbursement', amount: reimbursement, is_taxable: false }] : [])
    ];

    for (const c of compsRes.rows) {
      if (['BASIC', 'HRA', 'MED', 'CONV', 'OT', 'BONUS', 'REIMB'].includes(c.component_code)) continue;
      const val = c.override_value !== null ? parseFloat(c.override_value) : parseFloat(c.default_value || 0);
      if (val <= 0) continue;

      let computedVal = val;
      if (c.calc_type === 'Pct of Basic') computedVal = this.applyRounding((basic * val) / 100, rounding);
      else if (c.calc_type === 'Pct of Gross') computedVal = this.applyRounding(((basic + totalAllowances) * val) / 100, rounding);

      if (c.component_type === 'Deduction') {
        statEmpDed = round2(statEmpDed + computedVal);
        breakdown.push({ code: c.component_code, name: c.component_name, type: 'Deduction', amount: computedVal });
      } else if (c.component_type === 'Employer Contribution') {
        employerContrib = round2(employerContrib + computedVal);
        breakdown.push({ code: c.component_code, name: c.component_name, type: 'Employer Contribution', amount: computedVal });
      } else if (c.component_type === 'Earning' || c.component_type === 'Allowance') {
        extraTaxableEarnings = round2(extraTaxableEarnings + (c.is_taxable ? computedVal : 0));
        breakdown.push({ code: c.component_code, name: c.component_name, type: c.component_type, amount: computedVal, is_taxable: c.is_taxable });
      }
    }

    const grossSalary = round2(basic + totalAllowances + overtimePay + bonus + commission + arrears + extraTaxableEarnings);
    const unpaidLeaveDed = this.applyRounding(((rawBasic + parseFloat(emp.house_rent_allowance || 0) + parseFloat(emp.medical_allowance || 0) + parseFloat(emp.conveyance_allowance || 0)) / totalPeriodDays) * unpaidLeaveDays, rounding);

    // Taxable gross excludes non-taxable medical & reimbursements and unpaid leave reduction
    const taxableGross = Math.max(0, round2(grossSalary - nonTaxableAllowances - unpaidLeaveDed));

    // 5. Configurable Jurisdiction Tax
    let incomeTax = 0;
    if (!emp.tax_exempt) {
      const jurCode = emp.tax_jurisdiction_code || settings.default_tax_jurisdiction || 'PK-FBR';
      const taxCalc = await this.calculateJurisdictionTax(qClient, tenantId, taxableGross, jurCode, period.pay_date, rounding);
      incomeTax = taxCalc.monthly_tax;
      if (incomeTax > 0) {
        breakdown.push({ code: 'INCOME_TAX', name: `Withholding Tax (${taxCalc.slab_applied})`, type: 'Deduction', amount: incomeTax });
      }
    }

    // 6. Active Loans & Advances Recovery (Prevent over-recovery & negative net)
    const loansRes = await qClient.query(
      `SELECT * FROM payroll_loans_advances
       WHERE tenant_id = $1 AND payroll_profile_id = $2 AND status IN ('Approved', 'Active') AND remaining_balance > 0 AND repayment_start_date <= $3::date
       ORDER BY disbursement_date ASC`,
      [tenantId, emp.id, period.end_date]
    );

    const otherDed = round2(override.other_deductions || 0);
    const preLoanNet = round2(grossSalary + reimbursement - incomeTax - statEmpDed - unpaidLeaveDed - otherDed);
    let loanDed = 0;
    const loanAllocations = [];
    const exceptions = [];

    for (const ln of loansRes.rows) {
      const inst = Math.min(parseFloat(ln.installment_amount || 0), parseFloat(ln.remaining_balance || 0));
      const roomLeft = Math.max(0, round2(preLoanNet - loanDed));
      const take = Math.min(inst, roomLeft);
      if (take < inst) {
        exceptions.push({ code: 'LOAN_CAPPED', message: `Loan ${ln.loan_number} installment capped from ${inst} to ${take} to prevent negative net pay.` });
      }
      if (take > 0) {
        loanDed = round2(loanDed + take);
        loanAllocations.push({ loan_id: ln.id, loan_number: ln.loan_number, amount: take });
        breakdown.push({ code: `LOAN_${ln.loan_number}`, name: `Recovery (${ln.loan_number})`, type: 'Deduction', amount: take });
      }
    }

    if (unpaidLeaveDed > 0) breakdown.push({ code: 'UNPAID_LV', name: `Unpaid Leave (${unpaidLeaveDays} days)`, type: 'Deduction', amount: unpaidLeaveDed });
    if (otherDed > 0) breakdown.push({ code: 'OTHER_DED', name: 'Other Deductions', type: 'Deduction', amount: otherDed });

    const totalDeductions = round2(incomeTax + statEmpDed + unpaidLeaveDed + loanDed + otherDed);
    const netSalary = Math.max(0, round2(grossSalary + reimbursement - totalDeductions));

    // Exception Checks
    if ((emp.payment_method || 'Bank Transfer') === 'Bank Transfer' && !emp.bank_iban) {
      exceptions.push({ code: 'MISSING_BANK_DETAILS', message: 'Bank IBAN / Account Number missing for Bank Transfer employee.' });
    }
    if (grossSalary <= 0) {
      exceptions.push({ code: 'ZERO_GROSS', message: 'Employee gross salary evaluates to 0.' });
    }

    return {
      payroll_profile_id: emp.id,
      hrm_employee_id: emp.hrm_employee_id || null,
      proration_factor: prorationFactor,
      worked_days: workedDays,
      unpaid_leave_days: unpaidLeaveDays,
      overtime_hours: overtimeHours,
      overtime_pay: overtimePay,
      bonus_amount: bonus,
      commission_amount: commission,
      arrears_amount: arrears,
      reimbursement_amount: reimbursement,
      basic_salary: basic,
      total_allowances: totalAllowances,
      gross_salary: grossSalary,
      taxable_gross: taxableGross,
      income_tax_deduction: incomeTax,
      eobi_employee_deduction: statEmpDed,
      eobi_employer_contribution: employerContrib,
      employer_contributions: employerContrib,
      unpaid_leave_deduction: unpaidLeaveDed,
      loan_deduction: loanDed,
      other_deductions: otherDed,
      total_deductions: totalDeductions,
      net_salary: netSalary,
      component_breakdown: breakdown,
      loan_allocations: loanAllocations,
      exceptions
    };
  }

  /**
   * Create Draft Payroll Run (Does NOT post to Finance or mark Paid!)
   */
  async createDraftRun(client, tenantId, { periodId = null, year, month, payFrequency = 'Monthly', overrides = {}, userId = null, userName = 'Admin' }) {
    const qClient = client || db;
    const settings = await this.getSettings(qClient, tenantId);

    // Sync from HRM automatically if HRM is licensed & enabled
    await this.syncFromHrm(qClient, tenantId);

    let period;
    if (periodId) {
      const pRes = await qClient.query(`SELECT * FROM payroll_periods WHERE id = $1 AND tenant_id = $2`, [periodId, tenantId]);
      if (pRes.rows.length === 0) throw new Error('Payroll period not found.');
      period = pRes.rows[0];
    } else {
      const pYear = parseInt(year || new Date().getFullYear(), 10);
      const pMonth = parseInt(month || (new Date().getMonth() + 1), 10);
      const sDate = new Date(Date.UTC(pYear, pMonth - 1, 1)).toISOString().slice(0, 10);
      const eDate = new Date(Date.UTC(pYear, pMonth, 0)).toISOString().slice(0, 10);
      const pName = new Date(Date.UTC(pYear, pMonth - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });

      const pRes = await qClient.query(
        `INSERT INTO payroll_periods (tenant_id, period_year, period_month, period_name, pay_frequency, start_date, end_date, pay_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
         ON CONFLICT (tenant_id, period_year, period_month, pay_frequency) DO UPDATE SET period_name = EXCLUDED.period_name
         RETURNING *`,
        [tenantId, pYear, pMonth, pName, payFrequency, sDate, eDate]
      );
      period = pRes.rows[0];
    }

    if (period.status === 'Closed' || period.status === 'Locked') {
      throw new Error(`Payroll period "${period.period_name}" is ${period.status}. Cannot create or modify payroll runs.`);
    }

    // Duplicate Payroll Run Prevention (cannot create second non-reversed run for same period unless previous was reversed)
    const dupRun = await qClient.query(
      `SELECT id, run_number, status FROM payroll_runs
       WHERE tenant_id = $1 AND payroll_year = $2 AND payroll_month = $3 AND COALESCE(is_reversed, FALSE) = FALSE AND status != 'Reversed'
       LIMIT 1`,
      [tenantId, period.period_year, period.period_month]
    );
    if (dupRun.rows.length > 0) {
      throw new Error(`Duplicate Payroll Run prevented: Run "${dupRun.rows[0].run_number || dupRun.rows[0].id}" (${dupRun.rows[0].status}) already exists for ${period.period_name}.`);
    }

    const empsRes = await qClient.query(
      `SELECT * FROM payroll_employee_profiles WHERE tenant_id = $1 AND status = 'Active' ORDER BY employee_code ASC`,
      [tenantId]
    );
    if (empsRes.rows.length === 0) {
      throw new Error('No active employee payroll profiles found. Add payroll employees first.');
    }

    const runNum = await this.getNextNumber(qClient, tenantId, 'run');
    const initialStatus = settings.require_run_approval ? 'Draft' : 'Approved';

    const runRes = await qClient.query(
      `INSERT INTO payroll_runs (
        tenant_id, run_number, period_id, payroll_month, payroll_year, pay_frequency, status, is_finalized, gl_posted
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,FALSE) RETURNING *`,
      [tenantId, runNum, period.id, period.period_month, period.period_year, period.pay_frequency, initialStatus]
    );
    const run = runRes.rows[0];

    const slips = [];
    for (const emp of empsRes.rows) {
      const ov = overrides[emp.id] || {};
      const calc = await this.calculateEmployeeSlip(qClient, tenantId, emp, period, settings, ov);
      const psNum = await this.getNextNumber(qClient, tenantId, 'payslip');

      const psIns = await qClient.query(
        `INSERT INTO payroll_payslips (
          tenant_id, payroll_run_id, payslip_number, payroll_profile_id, employee_id,
          proration_factor, worked_days, unpaid_leave_days, overtime_hours, overtime_pay,
          bonus_amount, commission_amount, arrears_amount, reimbursement_amount,
          basic_salary, total_allowances, gross_salary, taxable_gross,
          income_tax_deduction, eobi_employee_deduction, eobi_employer_contribution,
          unpaid_leave_deduction, loan_deduction, other_deductions, employer_contributions,
          total_deductions, net_salary, component_breakdown, exceptions, is_included, is_paid, payment_status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28::jsonb,$29::jsonb,TRUE,FALSE,'Unpaid')
        RETURNING *`,
        [
          tenantId, run.id, psNum, emp.id, emp.hrm_employee_id || null,
          calc.proration_factor, calc.worked_days, calc.unpaid_leave_days, calc.overtime_hours, calc.overtime_pay,
          calc.bonus_amount, calc.commission_amount, calc.arrears_amount, calc.reimbursement_amount,
          calc.basic_salary, calc.total_allowances, calc.gross_salary, calc.taxable_gross,
          calc.income_tax_deduction, calc.eobi_employee_deduction, calc.eobi_employer_contribution,
          calc.unpaid_leave_deduction, calc.loan_deduction, calc.other_deductions, calc.employer_contributions,
          calc.total_deductions, calc.net_salary, JSON.stringify(calc.component_breakdown), JSON.stringify(calc.exceptions)
        ]
      );
      slips.push({ ...psIns.rows[0], loan_allocations: calc.loan_allocations });
    }

    const updatedRun = await this.refreshRunTotals(qClient, run.id);
    await this.logAudit(qClient, {
      tenantId, entityType: 'payroll_run', entityId: run.id, action: 'CREATED_DRAFT',
      userId, userName, details: { run_number: runNum, employees: slips.length }
    });

    return { run: updatedRun, payslips: slips };
  }

  /**
   * Recompute Totals on Payroll Run from Included Payslips
   */
  async refreshRunTotals(client, runId) {
    const qClient = client || db;
    const agg = await qClient.query(
      `SELECT COUNT(*) FILTER (WHERE is_included = TRUE) as emp_cnt,
              COALESCE(SUM(gross_salary) FILTER (WHERE is_included = TRUE), 0) as gross,
              COALESCE(SUM(income_tax_deduction) FILTER (WHERE is_included = TRUE), 0) as tax,
              COALESCE(SUM(eobi_employee_deduction) FILTER (WHERE is_included = TRUE), 0) as eobi,
              COALESCE(SUM(overtime_pay) FILTER (WHERE is_included = TRUE), 0) as ot,
              COALESCE(SUM(bonus_amount) FILTER (WHERE is_included = TRUE), 0) as bonus,
              COALESCE(SUM(arrears_amount) FILTER (WHERE is_included = TRUE), 0) as arrears,
              COALESCE(SUM(reimbursement_amount) FILTER (WHERE is_included = TRUE), 0) as reimb,
              COALESCE(SUM(loan_deduction) FILTER (WHERE is_included = TRUE), 0) as loan,
              COALESCE(SUM(employer_contributions) FILTER (WHERE is_included = TRUE), 0) as er,
              COALESCE(SUM(total_deductions) FILTER (WHERE is_included = TRUE), 0) as ded,
              COALESCE(SUM(net_salary) FILTER (WHERE is_included = TRUE), 0) as net
       FROM payroll_payslips WHERE payroll_run_id = $1`,
      [runId]
    );
    const a = agg.rows[0];
    const upd = await qClient.query(
      `UPDATE payroll_runs
       SET total_employees = $1, total_gross = $2, total_tax_deducted = $3, total_eobi_deducted = $4,
           total_overtime = $5, total_bonuses = $6, total_arrears = $7, total_reimbursements = $8,
           total_loan_deductions = $9, total_employer_contributions = $10, total_deductions = $11, total_net_payable = $12
       WHERE id = $13 RETURNING *`,
      [
        parseInt(a.emp_cnt || 0, 10), round2(a.gross), round2(a.tax), round2(a.eobi),
        round2(a.ot), round2(a.bonus), round2(a.arrears), round2(a.reimb),
        round2(a.loan), round2(a.er), round2(a.ded), round2(a.net), runId
      ]
    );
    return upd.rows[0];
  }

  /**
   * Finalize Approved Payroll Run -> Locks Run, Recovers Loans, Posts Liability GL Entry (NOT Bank Payment)
   */
  async finalizeRun(client, tenantId, runId, userId = null, userName = 'Controller') {
    const qClient = client || db;
    const settings = await this.getSettings(qClient, tenantId);
    const runRes = await qClient.query(`SELECT * FROM payroll_runs WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [runId, tenantId]);
    if (runRes.rows.length === 0) throw new Error('Payroll run not found.');
    const run = runRes.rows[0];

    if (run.is_finalized || run.status === 'Finalized') throw new Error(`Payroll Run ${run.run_number} is already Finalized.`);
    if (run.status === 'Reversed') throw new Error('Reversed payroll runs cannot be finalized.');
    if (settings.require_run_approval && run.status === 'Draft') {
      throw new Error('Payroll run must be Approved before Finalization.');
    }

    const slipsRes = await qClient.query(
      `SELECT ps.*, pep.id as prof_id, pep.bank_iban, pep.payment_method
       FROM payroll_payslips ps
       JOIN payroll_employee_profiles pep ON ps.payroll_profile_id = pep.id
       WHERE ps.payroll_run_id = $1 AND ps.is_included = TRUE`,
      [run.id]
    );
    if (slipsRes.rows.length === 0) throw new Error('Cannot finalize a payroll run with 0 included employees.');

    // Re-verify period not closed
    if (run.period_id) {
      const pRes = await qClient.query(`SELECT status, period_name FROM payroll_periods WHERE id = $1`, [run.period_id]);
      if (pRes.rows[0]?.status === 'Closed') throw new Error(`Period "${pRes.rows[0].period_name}" is Closed.`);
    }

    // 1. Recover Loan Installments atomically (preventing duplicate recovery per loan+run)
    for (const ps of slipsRes.rows) {
      const loanDed = round2(ps.loan_deduction || 0);
      if (loanDed <= 0) continue;

      const loansRes = await qClient.query(
        `SELECT * FROM payroll_loans_advances WHERE tenant_id = $1 AND payroll_profile_id = $2 AND status IN ('Approved', 'Active') AND remaining_balance > 0 ORDER BY disbursement_date ASC`,
        [tenantId, ps.prof_id]
      );
      let remToApply = loanDed;
      for (const ln of loansRes.rows) {
        if (remToApply <= 0) break;
        const payAmt = Math.min(remToApply, parseFloat(ln.remaining_balance));
        if (payAmt <= 0) continue;

        await qClient.query(
          `INSERT INTO payroll_loan_repayments (tenant_id, loan_id, payroll_run_id, payslip_id, repaid_amount)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (loan_id, payroll_run_id) DO NOTHING`,
          [tenantId, ln.id, run.id, ps.id, payAmt]
        );
        const newRem = round2(Math.max(0, parseFloat(ln.remaining_balance) - payAmt));
        await qClient.query(
          `UPDATE payroll_loans_advances
           SET total_repaid = COALESCE(total_repaid, 0) + $1,
               remaining_balance = $2,
               status = CASE WHEN $2 <= 0.01 THEN 'Closed' ELSE 'Active' END
           WHERE id = $3`,
          [payAmt, newRem, ln.id]
        );
        remToApply = round2(remToApply - payAmt);
      }
    }

    // 2. Post Payroll Liability Journal to Finance (ONLY on Finalization, NEVER on Draft!)
    let finResult = { status: 'skipped_unavailable' };
    const finEnabled = settings.enable_finance_posting !== false && await this.isModuleLicensed(qClient, tenantId, 'mod_finance');

    if (finEnabled) {
      const totalGross = round2(run.total_gross || 0);
      const totalUnpaidLeave = round2(slipsRes.rows.reduce((s, r) => s + parseFloat(r.unpaid_leave_deduction || 0), 0));
      const totalReimb = round2(run.total_reimbursements || 0);
      const totalErContrib = round2(run.total_employer_contributions || 0);
      const totalNet = round2(run.total_net_payable || 0);
      const totalDedLiab = round2(parseFloat(run.total_tax_deducted || 0) + parseFloat(run.total_eobi_deducted || 0) + totalErContrib + parseFloat(run.total_loan_deductions || 0));

      const totalExpense = round2((totalGross - totalUnpaidLeave + totalReimb) + totalErContrib);
      // Adjust rounding delta cleanly to deductions liability if 1-2 cents rounding difference
      const liabilitySum = round2(totalNet + totalDedLiab);
      const diff = round2(totalExpense - liabilitySum);
      const adjDedLiab = round2(totalDedLiab + diff);

      if (totalExpense > 0) {
        const coa = await financeService.ensureCoaMap(qClient, tenantId);
        const expCoa = coa[settings.default_salary_expense_coa || '5100'];
        const payCoa = coa[settings.default_net_payable_coa || '2200'];
        const taxDedCoa = coa[settings.default_deductions_payable_coa || '2250'] || coa['2100'];

        const lines = [
          { account_id: expCoa, debit: totalExpense, credit: 0, line_description: `Salary Expense & Employer Contributions (${run.run_number})` },
          ...(totalNet > 0 ? [{ account_id: payCoa, debit: 0, credit: totalNet, line_description: `Net Salaries Payable (${run.run_number})` }] : []),
          ...(adjDedLiab > 0 ? [{ account_id: taxDedCoa, debit: 0, credit: adjDedLiab, line_description: `Payroll Tax, Statutory & Loan Recoveries (${run.run_number})` }] : [])
        ];

        const ev = await financeService.postAccountingEvent(qClient, {
          tenantId,
          sourceModule: 'payroll',
          eventType: 'PAYROLL_FINALIZED',
          sourceId: run.id,
          sourceNumber: run.run_number,
          date: new Date().toISOString().slice(0, 10),
          narration: `Finalized Payroll Liabilities: ${run.run_number} (${run.payroll_month}/${run.payroll_year})`,
          lines,
          userId,
          userName
        });

        if (ev.action === 'posted' || ev.action === 'skipped_duplicate') {
          finResult = { status: ev.action, journal_id: ev.journal?.id || ev.event?.journal_entry_id };
          await qClient.query(`UPDATE payroll_runs SET gl_posted = TRUE, journal_entry_id = $1 WHERE id = $2`, [finResult.journal_id, run.id]);
        }
      }
    }

    const updRun = await qClient.query(
      `UPDATE payroll_runs SET status = 'Finalized', is_finalized = TRUE, finalized_by = $1, finalized_at = NOW() WHERE id = $2 RETURNING *`,
      [userId, run.id]
    );

    await qClient.query(
      `INSERT INTO payroll_posting_events (tenant_id, payroll_run_id, event_type, idempotency_key, journal_entry_id, status, notes)
       VALUES ($1,$2,'FINALIZED',$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [tenantId, run.id, `FIN_${run.id}`, finResult.journal_id || null, finResult.status, `Finalized ${slipsRes.rows.length} payslips`]
    );

    await this.logAudit(qClient, {
      tenantId, entityType: 'payroll_run', entityId: run.id, action: 'FINALIZED',
      userId, userName, details: { run_number: run.run_number, finance: finResult }
    });

    return { run: updRun.rows[0], finance: finResult };
  }

  /**
   * Authorized Reversal of a Finalized Payroll Run (Rolls back loan deductions & reverses GL JV)
   */
  async reverseFinalizedRun(client, tenantId, runId, reason = 'Payroll correction reversal', userId = null, userName = 'Controller') {
    const qClient = client || db;
    const runRes = await qClient.query(`SELECT * FROM payroll_runs WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [runId, tenantId]);
    if (runRes.rows.length === 0) throw new Error('Payroll run not found.');
    const run = runRes.rows[0];

    if (!run.is_finalized) throw new Error('Only Finalized payroll runs require reversal. Draft runs can be edited or deleted.');
    if (run.is_reversed || run.status === 'Reversed') throw new Error('This payroll run has already been reversed.');

    // Roll back loan repayments
    const repRes = await qClient.query(`SELECT * FROM payroll_loan_repayments WHERE payroll_run_id = $1 AND status = 'Posted'`, [run.id]);
    for (const rep of repRes.rows) {
      await qClient.query(
        `UPDATE payroll_loans_advances
         SET total_repaid = GREATEST(0, COALESCE(total_repaid, 0) - $1),
             remaining_balance = remaining_balance + $1,
             status = 'Active'
         WHERE id = $2`,
        [rep.repaid_amount, rep.loan_id]
      );
      await qClient.query(`UPDATE payroll_loan_repayments SET status = 'Reversed' WHERE id = $1`, [rep.id]);
    }

    // Reverse Finance Journal if posted
    if (run.journal_entry_id) {
      await financeService.reverseJournal(qClient, tenantId, run.journal_entry_id, {
        reason: `Payroll Run ${run.run_number} Reversed: ${reason}`,
        userId,
        userName
      });
    }

    const upd = await qClient.query(
      `UPDATE payroll_runs SET status = 'Reversed', is_reversed = TRUE, notes = $1 WHERE id = $2 RETURNING *`,
      [`Reversed (${reason})`, run.id]
    );

    await this.logAudit(qClient, {
      tenantId, entityType: 'payroll_run', entityId: run.id, action: 'REVERSED',
      userId, userName, details: { run_number: run.run_number, reason }
    });

    return upd.rows[0];
  }

  /**
   * Payment Batches & Retries (Separates Payment Transfer from Finalization)
   */
  async createPaymentBatch(client, tenantId, runId, { paymentMethod = 'Bank Transfer', bankAccountId = null, paymentDate = null, userId = null, userName = 'Treasurer' }) {
    const qClient = client || db;
    const runRes = await qClient.query(`SELECT * FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tenantId]);
    if (runRes.rows.length === 0) throw new Error('Payroll run not found.');
    const run = runRes.rows[0];
    if (!run.is_finalized || run.is_reversed) throw new Error('Only active Finalized payroll runs can be paid.');

    // Only pick Unpaid or Failed payslips (never duplicate already Paid slips!)
    const payableSlips = await qClient.query(
      `SELECT * FROM payroll_payslips
       WHERE payroll_run_id = $1 AND is_included = TRUE AND net_salary > 0 AND payment_status IN ('Unpaid', 'Failed')`,
      [run.id]
    );
    if (payableSlips.rows.length === 0) throw new Error('All payslips in this run are already Paid or Pending.');

    const batchNum = await this.getNextNumber(qClient, tenantId, 'batch');
    const totalAmt = round2(payableSlips.rows.reduce((s, r) => s + parseFloat(r.net_salary), 0));

    const bRes = await qClient.query(
      `INSERT INTO payroll_payment_batches (tenant_id, payroll_run_id, batch_number, payment_date, payment_method, bank_account_id, total_amount, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Pending',$8) RETURNING *`,
      [tenantId, run.id, batchNum, paymentDate || new Date().toISOString().slice(0, 10), paymentMethod, bankAccountId, totalAmt, userId]
    );
    const batch = bRes.rows[0];

    for (const ps of payableSlips.rows) {
      await qClient.query(
        `INSERT INTO payroll_payment_items (tenant_id, batch_id, payslip_id, payroll_profile_id, amount, payment_method, status)
         VALUES ($1,$2,$3,$4,$5,$6,'Pending')`,
        [tenantId, batch.id, ps.id, ps.payroll_profile_id, round2(ps.net_salary), paymentMethod]
      );
      await qClient.query(`UPDATE payroll_payslips SET payment_status = 'Pending' WHERE id = $1`, [ps.id]);
    }

    return { batch, items_count: payableSlips.rows.length };
  }

  /**
   * Process/Confirm Payment Batch Items (Handles confirmed paid items & failures with retry safety)
   */
  async processPaymentBatchResults(client, tenantId, batchId, { failedPayslipIds = [], failureReason = 'Bank gateway rejected IBAN', referencePrefix = 'TXN', userId = null, userName = 'Treasurer' } = {}) {
    const qClient = client || db;
    const settings = await this.getSettings(qClient, tenantId);
    const bRes = await qClient.query(`SELECT * FROM payroll_payment_batches WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [batchId, tenantId]);
    if (bRes.rows.length === 0) throw new Error('Payment batch not found.');
    const batch = bRes.rows[0];

    const itemsRes = await qClient.query(`SELECT * FROM payroll_payment_items WHERE batch_id = $1 AND status IN ('Pending', 'Failed')`, [batch.id]);
    const failSet = new Set(failedPayslipIds.map(String));

    let paidTotal = 0;
    let paidCount = 0;
    let failedCount = 0;

    for (const itm of itemsRes.rows) {
      if (failSet.has(String(itm.payslip_id))) {
        await qClient.query(
          `UPDATE payroll_payment_items SET status = 'Failed', failure_reason = $1, retry_count = retry_count + 1 WHERE id = $2`,
          [failureReason, itm.id]
        );
        await qClient.query(`UPDATE payroll_payslips SET payment_status = 'Failed', is_paid = FALSE WHERE id = $1`, [itm.payslip_id]);
        failedCount++;
      } else {
        const refNo = `${referencePrefix}-${itm.id.slice(0, 6).toUpperCase()}`;
        await qClient.query(
          `UPDATE payroll_payment_items SET status = 'Paid', reference_number = $1, paid_at = NOW(), failure_reason = NULL WHERE id = $2`,
          [refNo, itm.id]
        );
        await qClient.query(`UPDATE payroll_payslips SET payment_status = 'Paid', is_paid = TRUE, paid_at = NOW() WHERE id = $1`, [itm.payslip_id]);
        paidTotal = round2(paidTotal + parseFloat(itm.amount));
        paidCount++;
      }
    }

    const batchStatus = failedCount === 0 ? 'Completed' : (paidCount > 0 ? 'Partial' : 'Failed');
    await qClient.query(`UPDATE payroll_payment_batches SET status = $1, paid_count = paid_count + $2, failed_count = $3 WHERE id = $4`, [batchStatus, paidCount, failedCount, batch.id]);

    // Post Payment Settlement to Finance ONLY for actually confirmed paidTotal (Idempotent per batch+retry!)
    if (paidTotal > 0 && settings.enable_finance_posting !== false && await this.isModuleLicensed(qClient, tenantId, 'mod_finance')) {
      const coa = await financeService.ensureCoaMap(qClient, tenantId);
      let bankCoa = coa[settings.default_bank_coa || '1010'];
      if (batch.bank_account_id) {
        const baRes = await qClient.query(`SELECT coa_account_id FROM bank_cash_accounts WHERE id = $1`, [batch.bank_account_id]);
        if (baRes.rows[0]?.coa_account_id) bankCoa = baRes.rows[0].coa_account_id;
        await qClient.query(`UPDATE bank_cash_accounts SET current_balance = current_balance - $1 WHERE id = $2`, [paidTotal, batch.bank_account_id]);
      }

      const ev = await financeService.postAccountingEvent(qClient, {
        tenantId,
        sourceModule: 'payroll',
        eventType: 'PAYROLL_PAYMENT',
        sourceId: `${batch.id}_PASS_${parseInt(batch.paid_count || 0, 10)}`,
        sourceNumber: batch.batch_number,
        date: batch.payment_date || new Date().toISOString().slice(0, 10),
        narration: `Payroll Disbursement ${batch.batch_number} (${paidCount} staff confirmed paid)`,
        lines: [
          { account_id: coa[settings.default_net_payable_coa || '2200'], debit: paidTotal, credit: 0, line_description: `Net Salaries Settled - ${batch.batch_number}` },
          { account_id: bankCoa, debit: 0, credit: paidTotal, line_description: `Bank/Cash Payout - ${batch.batch_number}` }
        ],
        userId,
        userName
      });
      if (ev.journal?.id) {
        await qClient.query(`UPDATE payroll_payment_batches SET journal_entry_id = $1 WHERE id = $2`, [ev.journal.id, batch.id]);
      }
    }

    await this.logAudit(qClient, {
      tenantId, entityType: 'payment_batch', entityId: batch.id, action: `BATCH_${batchStatus.toUpperCase()}`,
      userId, userName, details: { paidCount, failedCount, paidTotal }
    });

    return { batch_status: batchStatus, paid_count: paidCount, failed_count: failedCount, paid_amount: paidTotal };
  }

  /**
   * YTD & Statutory Reports
   */
  async getYtdReport(tenantId, year) {
    const pYear = parseInt(year || new Date().getFullYear(), 10);
    const r = await db.query(
      `SELECT pep.id as employee_id, pep.employee_code, pep.full_name, pep.department, pep.national_tax_id,
              COUNT(pr.id) as payslip_count,
              COALESCE(SUM(CASE WHEN pr.id IS NOT NULL AND ps.is_included = TRUE THEN ps.basic_salary ELSE 0 END), 0) as ytd_basic,
              COALESCE(SUM(CASE WHEN pr.id IS NOT NULL AND ps.is_included = TRUE THEN ps.total_allowances ELSE 0 END), 0) as ytd_allowances,
              COALESCE(SUM(CASE WHEN pr.id IS NOT NULL AND ps.is_included = TRUE THEN ps.overtime_pay + ps.bonus_amount + ps.commission_amount + ps.arrears_amount ELSE 0 END), 0) as ytd_variable,
              COALESCE(SUM(CASE WHEN pr.id IS NOT NULL AND ps.is_included = TRUE THEN ps.gross_salary ELSE 0 END), 0) as ytd_gross,
              COALESCE(SUM(CASE WHEN pr.id IS NOT NULL AND ps.is_included = TRUE THEN ps.income_tax_deduction ELSE 0 END), 0) as ytd_tax,
              COALESCE(SUM(CASE WHEN pr.id IS NOT NULL AND ps.is_included = TRUE THEN ps.eobi_employee_deduction ELSE 0 END), 0) as ytd_statutory_emp,
              COALESCE(SUM(CASE WHEN pr.id IS NOT NULL AND ps.is_included = TRUE THEN ps.employer_contributions ELSE 0 END), 0) as ytd_employer_cost,
              COALESCE(SUM(CASE WHEN pr.id IS NOT NULL AND ps.is_included = TRUE THEN ps.loan_deduction ELSE 0 END), 0) as ytd_loan_repaid,
              COALESCE(SUM(CASE WHEN pr.id IS NOT NULL AND ps.is_included = TRUE THEN ps.net_salary ELSE 0 END), 0) as ytd_net
       FROM payroll_employee_profiles pep
       LEFT JOIN payroll_payslips ps ON ps.payroll_profile_id = pep.id
       LEFT JOIN payroll_runs pr ON ps.payroll_run_id = pr.id AND pr.payroll_year = $2 AND pr.is_finalized = TRUE AND COALESCE(pr.is_reversed, FALSE) = FALSE
       WHERE pep.tenant_id = $1
       GROUP BY pep.id, pep.employee_code, pep.full_name, pep.department, pep.national_tax_id
       ORDER BY pep.employee_code ASC`,
      [tenantId, pYear]
    );
    return { tax_year: pYear, employees: r.rows };
  }
}

module.exports = new PayrollService();
