/**
 * ============================================================================
 * MASHRUE PAYROLL MODULE — DATABASE MIGRATION (migrate_payroll_module.js)
 * ============================================================================
 * Preserves & extends existing tables:
 *   hrm_employees, hrm_attendance, hrm_leave_applications,
 *   payroll_salary_structures, payroll_runs, payroll_payslips
 *
 * Adds standalone & enterprise payroll tables:
 *   - payroll_settings, payroll_periods, payroll_components
 *   - payroll_tax_jurisdictions, payroll_tax_slabs
 *   - payroll_employee_profiles, payroll_employee_components
 *   - payroll_loans_advances, payroll_loan_repayments
 *   - payroll_payment_batches, payroll_payment_items
 *   - payroll_year_closures, payroll_audit_logs, payroll_posting_events
 * ============================================================================
 */

const db = require('./config/db');

async function migratePayrollModule() {
  console.log('================================================================');
  console.log('💵 RUNNING MASHRUE PAYROLL MODULE DATABASE MIGRATION');
  console.log('================================================================');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // 1. Settings, Calendar Periods, Components & Configurable Tax Jurisdictions
    console.log('1. Creating payroll_settings, payroll_periods, payroll_components, tax jurisdictions...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_settings (
        tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        default_currency VARCHAR(10) DEFAULT 'PKR',
        default_pay_frequency VARCHAR(30) DEFAULT 'Monthly',
        run_prefix VARCHAR(20) DEFAULT 'PR',
        run_next_seq INT DEFAULT 1001,
        payslip_prefix VARCHAR(20) DEFAULT 'PS',
        payslip_next_seq INT DEFAULT 1001,
        batch_prefix VARCHAR(20) DEFAULT 'PB',
        batch_next_seq INT DEFAULT 1001,
        working_days_per_month INT DEFAULT 30,
        overtime_multiplier NUMERIC(6, 2) DEFAULT 1.50,
        rounding_rule VARCHAR(20) DEFAULT 'ROUND_NEAREST',
        default_tax_jurisdiction VARCHAR(50) DEFAULT 'PK-FBR',
        require_run_approval BOOLEAN DEFAULT TRUE,
        enable_hrm_integration BOOLEAN DEFAULT TRUE,
        enable_finance_posting BOOLEAN DEFAULT TRUE,
        default_salary_expense_coa VARCHAR(30) DEFAULT '5100',
        default_net_payable_coa VARCHAR(30) DEFAULT '2200',
        default_deductions_payable_coa VARCHAR(30) DEFAULT '2250',
        default_bank_coa VARCHAR(30) DEFAULT '1010',
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payroll_periods (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        period_year INT NOT NULL,
        period_month INT NOT NULL,
        period_name VARCHAR(100) NOT NULL,
        pay_frequency VARCHAR(30) DEFAULT 'Monthly',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        pay_date DATE NOT NULL,
        working_days INT DEFAULT 30,
        status VARCHAR(30) DEFAULT 'Open',
        closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        closed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, period_year, period_month, pay_frequency)
      );

      CREATE TABLE IF NOT EXISTS payroll_components (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        component_code VARCHAR(50) NOT NULL,
        component_name VARCHAR(150) NOT NULL,
        component_type VARCHAR(40) NOT NULL,
        calc_type VARCHAR(30) DEFAULT 'Fixed',
        default_value NUMERIC(18, 4) DEFAULT 0,
        is_taxable BOOLEAN DEFAULT TRUE,
        is_statutory BOOLEAN DEFAULT FALSE,
        is_recurring BOOLEAN DEFAULT TRUE,
        coa_account_code VARCHAR(30),
        effective_from DATE DEFAULT CURRENT_DATE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, component_code)
      );

      CREATE TABLE IF NOT EXISTS payroll_tax_jurisdictions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        jurisdiction_code VARCHAR(50) NOT NULL,
        jurisdiction_name VARCHAR(150) NOT NULL,
        country_code VARCHAR(10) DEFAULT 'PK',
        currency VARCHAR(10) DEFAULT 'PKR',
        effective_from DATE DEFAULT '2025-07-01',
        disclaimer TEXT DEFAULT 'Verify local statutory tax slabs with a qualified tax advisor before production filing.',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, jurisdiction_code)
      );

      CREATE TABLE IF NOT EXISTS payroll_tax_slabs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        jurisdiction_id UUID NOT NULL REFERENCES payroll_tax_jurisdictions(id) ON DELETE CASCADE,
        min_annual_income NUMERIC(18, 2) NOT NULL DEFAULT 0,
        max_annual_income NUMERIC(18, 2),
        fixed_tax NUMERIC(18, 2) NOT NULL DEFAULT 0,
        rate_pct NUMERIC(8, 4) NOT NULL DEFAULT 0,
        excess_over NUMERIC(18, 2) NOT NULL DEFAULT 0,
        effective_from DATE DEFAULT '2025-07-01',
        effective_to DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Standalone Employee Payroll Profiles & Effective-Dated Overrides
    console.log('2. Creating standalone payroll_employee_profiles & employee component overrides...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_employee_profiles (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        hrm_employee_id UUID REFERENCES hrm_employees(id) ON DELETE SET NULL,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        employee_code VARCHAR(100) NOT NULL,
        full_name VARCHAR(200) NOT NULL,
        email VARCHAR(150),
        phone VARCHAR(50),
        national_tax_id VARCHAR(100),
        department VARCHAR(150) DEFAULT 'General',
        designation VARCHAR(150) DEFAULT 'Staff',
        hire_date DATE NOT NULL DEFAULT CURRENT_DATE,
        termination_date DATE,
        pay_frequency VARCHAR(30) DEFAULT 'Monthly',
        tax_jurisdiction_code VARCHAR(50) DEFAULT 'PK-FBR',
        salary_grade VARCHAR(50) DEFAULT 'G-1',
        currency VARCHAR(10) DEFAULT 'PKR',
        basic_salary NUMERIC(18, 4) NOT NULL DEFAULT 0,
        house_rent_allowance NUMERIC(18, 4) DEFAULT 0,
        medical_allowance NUMERIC(18, 4) DEFAULT 0,
        conveyance_allowance NUMERIC(18, 4) DEFAULT 0,
        other_allowances NUMERIC(18, 4) DEFAULT 0,
        payment_method VARCHAR(50) DEFAULT 'Bank Transfer',
        bank_name VARCHAR(150),
        bank_account_title VARCHAR(150),
        bank_iban VARCHAR(100),
        tax_exempt BOOLEAN DEFAULT FALSE,
        status VARCHAR(30) DEFAULT 'Active',
        effective_from DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, employee_code)
      );
      CREATE INDEX IF NOT EXISTS idx_pay_emp_tenant ON payroll_employee_profiles (tenant_id, status);

      CREATE TABLE IF NOT EXISTS payroll_employee_components (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        payroll_employee_id UUID NOT NULL REFERENCES payroll_employee_profiles(id) ON DELETE CASCADE,
        component_id UUID NOT NULL REFERENCES payroll_components(id) ON DELETE CASCADE,
        override_value NUMERIC(18, 4) NOT NULL,
        effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
        effective_to DATE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Extend payroll_runs & payroll_payslips cleanly (keeping existing HRM FK optional!)
    console.log('3. Extending payroll_runs and payroll_payslips...');
    await client.query(`
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS run_number VARCHAR(100);
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS period_id UUID REFERENCES payroll_periods(id) ON DELETE SET NULL;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS pay_frequency VARCHAR(30) DEFAULT 'Monthly';
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_overtime NUMERIC(18, 4) DEFAULT 0;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_bonuses NUMERIC(18, 4) DEFAULT 0;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_arrears NUMERIC(18, 4) DEFAULT 0;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_reimbursements NUMERIC(18, 4) DEFAULT 0;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_loan_deductions NUMERIC(18, 4) DEFAULT 0;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS total_employer_contributions NUMERIC(18, 4) DEFAULT 0;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS is_finalized BOOLEAN DEFAULT FALSE;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN DEFAULT FALSE;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS reversal_of_id UUID REFERENCES payroll_runs(id) ON DELETE SET NULL;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS reversed_by_id UUID REFERENCES payroll_runs(id) ON DELETE SET NULL;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS finalized_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS gl_posted BOOLEAN DEFAULT FALSE;
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(200);
      ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS notes TEXT;

      ALTER TABLE payroll_payslips ALTER COLUMN employee_id DROP NOT NULL;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS payslip_number VARCHAR(100);
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS payroll_profile_id UUID REFERENCES payroll_employee_profiles(id) ON DELETE CASCADE;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS proration_factor NUMERIC(8, 6) DEFAULT 1.000000;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS worked_days NUMERIC(6, 2) DEFAULT 30;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS unpaid_leave_days NUMERIC(6, 2) DEFAULT 0;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS overtime_hours NUMERIC(8, 2) DEFAULT 0;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS overtime_pay NUMERIC(14, 2) DEFAULT 0;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS bonus_amount NUMERIC(14, 2) DEFAULT 0;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS commission_amount NUMERIC(14, 2) DEFAULT 0;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS arrears_amount NUMERIC(14, 2) DEFAULT 0;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS reimbursement_amount NUMERIC(14, 2) DEFAULT 0;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS loan_deduction NUMERIC(14, 2) DEFAULT 0;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS other_deductions NUMERIC(14, 2) DEFAULT 0;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS employer_contributions NUMERIC(14, 2) DEFAULT 0;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS taxable_gross NUMERIC(14, 2) DEFAULT 0;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS component_breakdown JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS exceptions JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS is_included BOOLEAN DEFAULT TRUE;
      ALTER TABLE payroll_payslips ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) DEFAULT 'Unpaid';
      ALTER TABLE payroll_payslips ALTER COLUMN is_paid SET DEFAULT FALSE;
    `);

    // 4. Loans, Advances, Repayments, Payment Batches, Year Closures, Audit & Posting Events
    console.log('4. Creating loans, payment batches, year closures, audit & posting events...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS payroll_loans_advances (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        payroll_profile_id UUID NOT NULL REFERENCES payroll_employee_profiles(id) ON DELETE CASCADE,
        loan_number VARCHAR(100) NOT NULL,
        loan_type VARCHAR(30) DEFAULT 'Salary Advance',
        principal_amount NUMERIC(18, 4) NOT NULL,
        installment_amount NUMERIC(18, 4) NOT NULL,
        total_repaid NUMERIC(18, 4) DEFAULT 0,
        remaining_balance NUMERIC(18, 4) NOT NULL,
        disbursement_date DATE DEFAULT CURRENT_DATE,
        repayment_start_date DATE DEFAULT CURRENT_DATE,
        status VARCHAR(30) DEFAULT 'Pending',
        approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
        approved_at TIMESTAMP WITH TIME ZONE,
        reason TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, loan_number)
      );

      CREATE TABLE IF NOT EXISTS payroll_loan_repayments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        loan_id UUID NOT NULL REFERENCES payroll_loans_advances(id) ON DELETE CASCADE,
        payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        payslip_id UUID REFERENCES payroll_payslips(id) ON DELETE CASCADE,
        repaid_amount NUMERIC(18, 4) NOT NULL,
        repayment_date DATE DEFAULT CURRENT_DATE,
        status VARCHAR(30) DEFAULT 'Posted',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(loan_id, payroll_run_id)
      );

      CREATE TABLE IF NOT EXISTS payroll_payment_batches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        batch_number VARCHAR(100) NOT NULL,
        payment_date DATE DEFAULT CURRENT_DATE,
        payment_method VARCHAR(50) DEFAULT 'Bank Transfer',
        bank_account_id UUID,
        total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
        paid_count INT DEFAULT 0,
        failed_count INT DEFAULT 0,
        status VARCHAR(30) DEFAULT 'Pending',
        journal_entry_id UUID,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, batch_number)
      );

      CREATE TABLE IF NOT EXISTS payroll_payment_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        batch_id UUID NOT NULL REFERENCES payroll_payment_batches(id) ON DELETE CASCADE,
        payslip_id UUID NOT NULL REFERENCES payroll_payslips(id) ON DELETE CASCADE,
        payroll_profile_id UUID REFERENCES payroll_employee_profiles(id) ON DELETE SET NULL,
        amount NUMERIC(18, 4) NOT NULL,
        payment_method VARCHAR(50) DEFAULT 'Bank Transfer',
        reference_number VARCHAR(100),
        status VARCHAR(30) DEFAULT 'Pending',
        failure_reason TEXT,
        retry_count INT DEFAULT 0,
        paid_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(payslip_id, batch_id)
      );

      CREATE TABLE IF NOT EXISTS payroll_year_closures (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        tax_year INT NOT NULL,
        total_gross NUMERIC(18, 4) DEFAULT 0,
        total_tax_withheld NUMERIC(18, 4) DEFAULT 0,
        total_employer_cost NUMERIC(18, 4) DEFAULT 0,
        total_net_paid NUMERIC(18, 4) DEFAULT 0,
        closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        closed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, tax_year)
      );

      CREATE TABLE IF NOT EXISTS payroll_audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        entity_type VARCHAR(60) NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        action VARCHAR(50) NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(150),
        details JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payroll_posting_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        payroll_run_id UUID REFERENCES payroll_runs(id) ON DELETE CASCADE,
        event_type VARCHAR(60) NOT NULL,
        idempotency_key VARCHAR(200) NOT NULL,
        journal_entry_id UUID,
        status VARCHAR(30) DEFAULT 'Posted',
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, event_type, idempotency_key)
      );
    `);

    // 5. Seed Configurable Defaults (Settings, Components, Jurisdictions & Tax Slabs) for Existing Tenants
    console.log('5. Seeding default Payroll configuration, components & tax jurisdictions...');
    const tenantsRes = await client.query(`SELECT id FROM tenants`);
    const curYear = new Date().getFullYear();

    for (const t of tenantsRes.rows) {
      const tid = t.id;
      await client.query(`INSERT INTO payroll_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [tid]);

      // Seed Default Components
      const comps = [
        ['BASIC', 'Basic Salary', 'Earning', 'Fixed', 0, true, false, '5100'],
        ['HRA', 'House Rent Allowance', 'Allowance', 'Pct of Basic', 30, true, false, '5100'],
        ['MED', 'Medical Allowance', 'Allowance', 'Pct of Basic', 10, false, false, '5100'],
        ['CONV', 'Conveyance Allowance', 'Allowance', 'Fixed', 5000, true, false, '5100'],
        ['OT', 'Overtime Pay', 'Earning', 'Formula', 0, true, false, '5100'],
        ['BONUS', 'Performance Bonus', 'Earning', 'Fixed', 0, true, false, '5100'],
        ['REIMB', 'Expense Reimbursement', 'Reimbursement', 'Fixed', 0, false, false, '5300'],
        ['STAT_EMP', 'Statutory Social Security (Employee)', 'Deduction', 'Fixed', 370, false, true, '2250'],
        ['STAT_ER', 'Statutory Social Security (Employer)', 'Employer Contribution', 'Fixed', 1850, false, true, '2250']
      ];
      for (const [code, name, type, ctype, val, taxable, stat, coa] of comps) {
        await client.query(
          `INSERT INTO payroll_components (tenant_id, component_code, component_name, component_type, calc_type, default_value, is_taxable, is_statutory, coa_account_code)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (tenant_id, component_code) DO NOTHING`,
          [tid, code, name, type, ctype, val, taxable, stat, coa]
        );
      }

      // Seed Configurable Tax Jurisdictions (PK-FBR as editable preset + EXEMPT-0 + CUSTOM-10)
      const jurRes = await client.query(
        `INSERT INTO payroll_tax_jurisdictions (tenant_id, jurisdiction_code, jurisdiction_name, country_code, currency)
         VALUES ($1, 'PK-FBR', 'Pakistan FBR Salaried Progressive Slabs (Configurable)', 'PK', 'PKR')
         ON CONFLICT (tenant_id, jurisdiction_code) DO UPDATE SET jurisdiction_name = EXCLUDED.jurisdiction_name
         RETURNING id`,
        [tid]
      );
      const jurId = jurRes.rows[0].id;
      const slabCheck = await client.query(`SELECT id FROM payroll_tax_slabs WHERE jurisdiction_id = $1 LIMIT 1`, [jurId]);
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
          await client.query(
            `INSERT INTO payroll_tax_slabs (tenant_id, jurisdiction_id, min_annual_income, max_annual_income, fixed_tax, rate_pct, excess_over)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [tid, jurId, minI, maxI, fix, rate, ex]
          );
        }
      }

      await client.query(
        `INSERT INTO payroll_tax_jurisdictions (tenant_id, jurisdiction_code, jurisdiction_name, country_code, currency)
         VALUES ($1, 'EXEMPT-0', 'Tax-Free / Zero Tax Jurisdiction', 'ANY', 'PKR')
         ON CONFLICT (tenant_id, jurisdiction_code) DO NOTHING`,
        [tid]
      );

      // Seed current month payroll period if none exists
      const m = new Date().getMonth() + 1;
      const sDate = new Date(Date.UTC(curYear, m - 1, 1)).toISOString().slice(0, 10);
      const eDate = new Date(Date.UTC(curYear, m, 0)).toISOString().slice(0, 10);
      const pName = new Date(Date.UTC(curYear, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
      await client.query(
        `INSERT INTO payroll_periods (tenant_id, period_year, period_month, period_name, start_date, end_date, pay_date)
         VALUES ($1,$2,$3,$4,$5,$6,$6) ON CONFLICT (tenant_id, period_year, period_month, pay_frequency) DO NOTHING`,
        [tid, curYear, m, pName, sDate, eDate]
      );
    }

    await client.query('COMMIT');
    console.log('✅ MASHRUE PAYROLL MODULE MIGRATION COMPLETED SUCCESSFULLY!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Payroll Migration Error:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = migratePayrollModule;

if (require.main === module) {
  migratePayrollModule()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

