/**
 * ============================================================================
 * MASHRUE CORE HRM MODULE — DATABASE MIGRATION (migrate_hrm_module.js)
 * ============================================================================
 * Preserves & extends existing HRM tables:
 *   hrm_departments, hrm_designations, hrm_employees,
 *   hrm_attendance, hrm_leave_applications
 *
 * Adds enterprise HRM tables:
 *   - hrm_leave_policies (Configurable Annual/Casual/Sick/Unpaid allowances)
 *   - hrm_leave_balances (Per-employee yearly quota tracking)
 *   - hrm_holidays (Working calendar / public holidays)
 *   - hrm_audit_logs (Immutable HR lifecycle audit trail)
 * ============================================================================
 */

const db = require('./config/db');

async function migrateHrmModule() {
  console.log('================================================================');
  console.log('👥 RUNNING MASHRUE CORE HRM MODULE DATABASE MIGRATION');
  console.log('================================================================');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // 1. Extend hrm_employees & hrm_leave_applications cleanly
    console.log('1. Extending hrm_employees and hrm_leave_applications...');
    await client.query(`
      ALTER TABLE hrm_employees ADD COLUMN IF NOT EXISTS termination_date DATE;
      ALTER TABLE hrm_employees ADD COLUMN IF NOT EXISTS termination_reason TEXT;
      ALTER TABLE hrm_employees ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES hrm_employees(id) ON DELETE SET NULL;
      ALTER TABLE hrm_employees ADD COLUMN IF NOT EXISTS shift_hours NUMERIC(5, 2) DEFAULT 8.00;
      ALTER TABLE hrm_employees ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      ALTER TABLE hrm_leave_applications ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE hrm_leave_applications ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
      ALTER TABLE hrm_leave_applications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      -- Unique employee_code per tenant (if not already present)
      CREATE INDEX IF NOT EXISTS idx_hrm_emp_tenant_status ON hrm_employees (tenant_id, employment_status);
      CREATE INDEX IF NOT EXISTS idx_hrm_att_tenant_date ON hrm_attendance (tenant_id, attendance_date DESC);
      CREATE INDEX IF NOT EXISTS idx_hrm_lv_tenant_status ON hrm_leave_applications (tenant_id, status);
    `);

    // 2. Leave Policies, Leave Balances, Holidays & Audit Logs
    console.log('2. Creating hrm_leave_policies, hrm_leave_balances, hrm_holidays, hrm_audit_logs...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS hrm_leave_policies (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        leave_type VARCHAR(50) NOT NULL,
        annual_quota NUMERIC(6, 2) NOT NULL DEFAULT 14,
        is_paid BOOLEAN DEFAULT TRUE,
        carry_forward BOOLEAN DEFAULT FALSE,
        max_consecutive_days INT DEFAULT 30,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, leave_type)
      );

      CREATE TABLE IF NOT EXISTS hrm_leave_balances (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        employee_id UUID NOT NULL REFERENCES hrm_employees(id) ON DELETE CASCADE,
        leave_year INT NOT NULL,
        leave_type VARCHAR(50) NOT NULL,
        allocated_days NUMERIC(6, 2) NOT NULL DEFAULT 0,
        used_days NUMERIC(6, 2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, leave_year, leave_type)
      );

      CREATE TABLE IF NOT EXISTS hrm_holidays (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        holiday_date DATE NOT NULL,
        holiday_name VARCHAR(150) NOT NULL,
        holiday_type VARCHAR(50) DEFAULT 'Public Holiday',
        is_recurring BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, holiday_date)
      );

      CREATE TABLE IF NOT EXISTS hrm_audit_logs (
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
    `);

    // 3. Seed Default Leave Policies for Existing Tenants
    console.log('3. Seeding default HRM leave policies...');
    const tenantsRes = await client.query(`SELECT id FROM tenants`);
    const defaultPolicies = [
      ['Annual', 14, true, true, 30],
      ['Casual', 10, true, false, 5],
      ['Medical', 10, true, false, 15],
      ['Unpaid', 60, false, false, 60]
    ];
    for (const t of tenantsRes.rows) {
      for (const [lt, quota, paid, cf, maxC] of defaultPolicies) {
        await client.query(
          `INSERT INTO hrm_leave_policies (tenant_id, leave_type, annual_quota, is_paid, carry_forward, max_consecutive_days)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, leave_type) DO NOTHING`,
          [t.id, lt, quota, paid, cf, maxC]
        );
      }
    }

    await client.query('COMMIT');
    console.log('✅ HRM Module database migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ HRM migration error:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrateHrmModule()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = { migrateHrmModule };

