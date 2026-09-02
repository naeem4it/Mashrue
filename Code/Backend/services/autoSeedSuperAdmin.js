const bcrypt = require('bcryptjs');
const db = require('../config/db');

const getSuperAdminConfig = () => ({
  username: (process.env.SUPER_ADMIN_USERNAME || 'naeem4it').trim().toLowerCase(),
  password: process.env.SUPER_ADMIN_PASSWORD || 'Password123!',
  email: (process.env.SUPER_ADMIN_EMAIL || 'naeem@mashrue.com').trim().toLowerCase(),
  fullName: process.env.SUPER_ADMIN_NAME || 'Muhammad Naeem Khan (Super Admin)'
});

/**
 * Ensures the primary Super Admin account is auto-created on application startup
 * and runs schema migrations for created_by and indexing
 */
async function autoSeedSuperAdmin() {
  const config = getSuperAdminConfig();

  // 1. Ensure migrations for users, tenants & business_profiles tables run seamlessly
  try {
    await db.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS free_business_profile_limit INT DEFAULT 2;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS additional_profile_monthly_fee NUMERIC(10, 2) DEFAULT 2500.00;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS free_employee_limit INT DEFAULT 2;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS additional_employee_monthly_fee NUMERIC(10, 2) DEFAULT 1500.00;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_period VARCHAR(50) DEFAULT '15 Days';
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP;

      ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS can_see_bidding_prices BOOLEAN DEFAULT TRUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by UUID;
      ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;
      ALTER TABLE users ALTER COLUMN email DROP NOT NULL;

      ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS created_by UUID;

      -- Performance Optimizations: Database Indexes
      CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by);
      CREATE INDEX IF NOT EXISTS idx_business_profiles_tenant_id ON business_profiles(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_business_profiles_created_by ON business_profiles(created_by);
      CREATE INDEX IF NOT EXISTS idx_uba_user ON user_business_access(user_id);
      CREATE INDEX IF NOT EXISTS idx_uba_biz ON user_business_access(business_profile_id);
    `);
  } catch (migErr) {
    console.warn('⚠️ [AutoSeed] Migration notice (non-fatal):', migErr.message);
  }

  try {
    // 2. Check if Super Admin user already exists by role, username, or email
    const checkRes = await db.query(
      `SELECT id, username, email, role FROM users WHERE LOWER(username) = $1 OR (email IS NOT NULL AND LOWER(email) = $2) OR role = 'SuperAdmin' LIMIT 1`,
      [config.username, config.email]
    );

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(config.password, salt);

    if (checkRes.rows.length === 0) {
      console.log(`[AutoSeed] Creating primary Super Admin account (${config.username})...`);
      await db.query(
        `INSERT INTO users (id, tenant_id, username, full_name, email, password_hash, role, status, must_change_password, can_see_bidding_prices, permissions)
         VALUES (uuid_generate_v4(), NULL, $1, $2, $3, $4, 'SuperAdmin', 'Active', FALSE, TRUE, '{}'::jsonb)`,
        [config.username, config.fullName, config.email, passwordHash]
      );
      console.log(`✅ [AutoSeed] Super Admin (${config.username}) provisioned successfully.`);
    } else {
      const existing = checkRes.rows[0];
      await db.query(
        `UPDATE users 
         SET username = COALESCE(username, $1), 
             role = 'SuperAdmin', 
             tenant_id = NULL, 
             status = 'Active', 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2`,
        [config.username, existing.id]
      );
      console.log(`✅ [AutoSeed] Verified primary Super Admin account: ${existing.username || config.username}`);
    }
  } catch (err) {
    console.error(`⚠️ [AutoSeed] Notice during Super Admin check:`, err.message);
  }
}

module.exports = {
  autoSeedSuperAdmin,
  getSuperAdminConfig
};

