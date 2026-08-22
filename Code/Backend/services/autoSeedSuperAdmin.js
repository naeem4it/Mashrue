const bcrypt = require('bcryptjs');
const db = require('../config/db');

const DEFAULT_SUPER_ADMIN_USERNAME = 'naeem4it';
const DEFAULT_SUPER_ADMIN_PASSWORD = 'Password123!';
const DEFAULT_SUPER_ADMIN_EMAIL = 'naeem@mashrue.com';
const DEFAULT_SUPER_ADMIN_NAME = 'Muhammad Naeem Khan (Super Admin)';

/**
 * Ensures the primary Super Admin account is auto-created on application startup
 */
async function autoSeedSuperAdmin() {
  try {
    // 1. Ensure migrations for users & tenants tables run seamlessly
    await db.query(`
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS free_business_profile_limit INT DEFAULT 2;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS additional_profile_monthly_fee NUMERIC(10, 2) DEFAULT 2500.00;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS free_employee_limit INT DEFAULT 2;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS additional_employee_monthly_fee NUMERIC(10, 2) DEFAULT 1500.00;

      ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS can_see_bidding_prices BOOLEAN DEFAULT TRUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;
    `);

    // 2. Check if Super Admin user already exists
    const checkRes = await db.query(
      `SELECT id, username, email, role FROM users WHERE username = $1 OR email = $2 LIMIT 1`,
      [DEFAULT_SUPER_ADMIN_USERNAME, DEFAULT_SUPER_ADMIN_EMAIL]
    );

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(DEFAULT_SUPER_ADMIN_PASSWORD, salt);

    if (checkRes.rows.length === 0) {
      console.log(`[AutoSeed] Creating primary Super Admin account: ${DEFAULT_SUPER_ADMIN_USERNAME}...`);
      await db.query(
        `INSERT INTO users (id, tenant_id, username, full_name, email, password_hash, role, status, must_change_password, can_see_bidding_prices, permissions)
         VALUES (uuid_generate_v4(), NULL, $1, $2, $3, $4, 'SuperAdmin', 'Active', FALSE, TRUE, '{}'::jsonb)`,
        [DEFAULT_SUPER_ADMIN_USERNAME, DEFAULT_SUPER_ADMIN_NAME, DEFAULT_SUPER_ADMIN_EMAIL, passwordHash]
      );
      console.log(`✅ [AutoSeed] Super Admin (${DEFAULT_SUPER_ADMIN_USERNAME}) provisioned successfully.`);
    } else {
      // Ensure naeem4it is permanently assigned the SuperAdmin role at system level
      const existing = checkRes.rows[0];
      await db.query(
        `UPDATE users SET username = $1, role = 'SuperAdmin', tenant_id = NULL, status = 'Active', updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [DEFAULT_SUPER_ADMIN_USERNAME, existing.id]
      );
      console.log(`✅ [AutoSeed] Verified primary Super Admin account: ${DEFAULT_SUPER_ADMIN_USERNAME}`);
    }
  } catch (err) {
    console.error(`⚠️ [AutoSeed] Notice during Super Admin check:`, err.message);
  }
}

module.exports = {
  autoSeedSuperAdmin,
  DEFAULT_SUPER_ADMIN_USERNAME,
  DEFAULT_SUPER_ADMIN_PASSWORD
};
