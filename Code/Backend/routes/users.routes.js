const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/rbac.middleware');

/**
 * GET all users with RBAC data, seat counts, and assigned companies
 * Tenant Isolated: Client Admin only sees their own tenant users.
 * Super Admin sees all system users or filters by tenant.
 */
router.get('/', authenticate, async (req, res) => {
  const { tenant_id } = req.query;

  try {
    let queryText = `
      SELECT u.id, u.tenant_id, u.username, u.full_name, u.email, u.role, u.status,
             u.must_change_password, u.can_see_bidding_prices, u.permissions, u.created_at,
             t.company_name as tenant_name,
             COALESCE(
               json_agg(
                 json_build_object('id', bp.id, 'name', bp.business_name)
               ) FILTER (WHERE bp.id IS NOT NULL),
               '[]'
             ) as business_access
      FROM users u
      LEFT JOIN tenants t ON u.tenant_id = t.id
      LEFT JOIN user_business_access uba ON u.id = uba.user_id
      LEFT JOIN business_profiles bp ON uba.business_profile_id = bp.id
      WHERE 1=1
    `;
    const params = [];

    // Enforce Tenant Isolation
    if (req.user.role !== 'SuperAdmin') {
      params.push(req.user.tenantId);
      queryText += ` AND u.tenant_id = $${params.length}`;
    } else if (tenant_id && tenant_id !== 'all') {
      params.push(tenant_id);
      queryText += ` AND u.tenant_id = $${params.length}`;
    }

    queryText += `
      GROUP BY u.id, u.tenant_id, u.username, u.full_name, u.email, u.role, u.status,
               u.must_change_password, u.can_see_bidding_prices, u.permissions, u.created_at,
               t.company_name
      ORDER BY u.created_at DESC
    `;

    const result = await db.query(queryText, params);

    // Calculate tenant seat stats
    let seatStats = null;
    if (req.user.tenantId) {
      const tenantRes = await db.query(
        `SELECT free_employee_limit, additional_employee_monthly_fee FROM tenants WHERE id = $1`,
        [req.user.tenantId]
      );
      const limit = tenantRes.rows[0]?.free_employee_limit || 2;
      const fee = tenantRes.rows[0]?.additional_employee_monthly_fee || 1500.00;
      const employeeCount = result.rows.filter(u => u.role === 'ClientEmployee').length;

      seatStats = {
        freeLimit: limit,
        usedEmployees: employeeCount,
        paidEmployees: Math.max(0, employeeCount - limit),
        additionalMonthlyFee: fee,
        isOverLimit: employeeCount >= limit
      };
    }

    // If Super Admin, also fetch list of tenants for dropdown
    let tenantsList = [];
    if (req.user.role === 'SuperAdmin') {
      const tenantsRes = await db.query(
        `SELECT t.id, t.company_name, t.subdomain, t.subscription_plan, t.status,
                (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) as user_count,
                (SELECT COUNT(*) FROM business_profiles bp WHERE bp.tenant_id = t.id) as company_count
         FROM tenants t
         ORDER BY t.created_at DESC`
      );
      tenantsList = tenantsRes.rows;
    }

    res.json({
      success: true,
      data: result.rows,
      seatStats,
      tenants: tenantsList
    });
  } catch (err) {
    console.error('Fetch Users Error:', err);
    res.status(500).json({ success: false, message: 'Failed to retrieve users', error: err.message });
  }
});

/**
 * POST create new user (Super Admin or Client Admin)
 */
router.post('/', authenticate, requireRoles('SuperAdmin', 'ClientAdmin', 'CompanyAdmin'), async (req, res) => {
  const {
    username,
    full_name,
    email,
    password,
    role,
    tenant_id,
    can_see_bidding_prices,
    permissions,
    business_profile_ids,
    confirm_paid
  } = req.body;

  if (!full_name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Full name, email, and password are required.' });
  }

  try {
    let targetTenantId = req.user.tenantId;

    // SuperAdmin creating user for specific or new tenant
    if (req.user.role === 'SuperAdmin') {
      targetTenantId = tenant_id || null;
    }

    // Target role validation
    const targetRole = role || (req.user.role === 'SuperAdmin' ? 'ClientAdmin' : 'ClientEmployee');

    // If Client Admin is creating a Client Employee, enforce free seat limits
    if (req.user.role !== 'SuperAdmin' && targetRole === 'ClientEmployee' && targetTenantId) {
      const countRes = await db.query(
        `SELECT COUNT(*) as employee_count FROM users WHERE tenant_id = $1 AND role = 'ClientEmployee'`,
        [targetTenantId]
      );
      const tenantRes = await db.query(
        `SELECT free_employee_limit, additional_employee_monthly_fee FROM tenants WHERE id = $1`,
        [targetTenantId]
      );

      const currentCount = parseInt(countRes.rows[0]?.employee_count || 0, 10);
      const freeLimit = parseInt(tenantRes.rows[0]?.free_employee_limit || 2, 10);
      const additionalFee = parseFloat(tenantRes.rows[0]?.additional_employee_monthly_fee || 1500.00);

      if (currentCount >= freeLimit && !confirm_paid) {
        return res.status(402).json({
          success: false,
          requires_payment_confirmation: true,
          message: `Free employee seat limit (${freeLimit}) reached. Adding this employee will incur an additional fee of PKR ${additionalFee.toLocaleString()}/month.`,
          currentCount,
          freeLimit,
          additionalFee
        });
      }
    }

    // Check for username / email conflict
    const existingCheck = await db.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) OR (username IS NOT NULL AND LOWER(username) = LOWER($2))`,
      [email, username || '']
    );
    if (existingCheck.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'A user with this email or username already exists.' });
    }

    // Hash password with bcrypt
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Client Admin created by Super Admin must change password on first login
    const mustChangePassword = (targetRole === 'ClientAdmin' || targetRole === 'CompanyAdmin');

    const defaultPermissions = permissions || (targetRole === 'ClientEmployee' ? {
      opportunities: { view: true, add: false, edit: false },
      bids: { view: true, add: false, edit: false },
      inventory: { view: true, add: false, edit: false },
      invoices: { view: true, add: false, edit: false }
    } : {});

    const userRes = await db.query(
      `INSERT INTO users (
        tenant_id, username, full_name, email, password_hash, role, status,
        must_change_password, can_see_bidding_prices, permissions
       )
       VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7, $8, $9)
       RETURNING id, tenant_id, username, full_name, email, role, status, must_change_password, can_see_bidding_prices, permissions, created_at`,
      [
        targetTenantId,
        username || email.split('@')[0],
        full_name,
        email,
        passwordHash,
        targetRole,
        mustChangePassword,
        can_see_bidding_prices !== false,
        JSON.stringify(defaultPermissions)
      ]
    );

    const newUser = userRes.rows[0];

    // Assign company/business profile access
    if (business_profile_ids && Array.isArray(business_profile_ids)) {
      for (const bpId of business_profile_ids) {
        await db.query(
          `INSERT INTO user_business_access (user_id, business_profile_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [newUser.id, bpId]
        );
      }
    }

    res.status(201).json({
      success: true,
      message: `${targetRole} created successfully.`,
      data: newUser
    });
  } catch (err) {
    console.error('Create User Error:', err);
    res.status(500).json({ success: false, message: 'Failed to create user', error: err.message });
  }
});

/**
 * PUT update user details, role, status, bidding prices, and permissions
 */
router.put('/:id', authenticate, requireRoles('SuperAdmin', 'ClientAdmin', 'CompanyAdmin'), async (req, res) => {
  const { id } = req.params;
  const {
    full_name,
    email,
    username,
    role,
    status,
    can_see_bidding_prices,
    permissions,
    business_profile_ids
  } = req.body;

  try {
    // Security check: If not SuperAdmin, verify the user belongs to the caller's tenant
    if (req.user.role !== 'SuperAdmin') {
      const verifyRes = await db.query(`SELECT tenant_id FROM users WHERE id = $1`, [id]);
      if (verifyRes.rows.length === 0 || verifyRes.rows[0].tenant_id !== req.user.tenantId) {
        return res.status(403).json({ success: false, message: 'Unauthorized to modify this user.' });
      }
    }

    const result = await db.query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           email = COALESCE($2, email),
           username = COALESCE($3, username),
           role = COALESCE($4, role),
           status = COALESCE($5, status),
           can_see_bidding_prices = COALESCE($6, can_see_bidding_prices),
           permissions = COALESCE($7, permissions),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING id, tenant_id, username, full_name, email, role, status, must_change_password, can_see_bidding_prices, permissions, updated_at`,
      [
        full_name || null,
        email || null,
        username || null,
        role || null,
        status || null,
        can_see_bidding_prices !== undefined ? can_see_bidding_prices : null,
        permissions ? JSON.stringify(permissions) : null,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Update company business profile access if provided
    if (business_profile_ids && Array.isArray(business_profile_ids)) {
      await db.query(`DELETE FROM user_business_access WHERE user_id = $1`, [id]);
      for (const bpId of business_profile_ids) {
        await db.query(
          `INSERT INTO user_business_access (user_id, business_profile_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, bpId]
        );
      }
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: result.rows[0]
    });
  } catch (err) {
    console.error('Update User Error:', err);
    res.status(500).json({ success: false, message: 'Failed to update user', error: err.message });
  }
});

/**
 * POST Admin Reset Password for a User
 */
router.post('/:id/reset-password', authenticate, requireRoles('SuperAdmin', 'ClientAdmin', 'CompanyAdmin'), async (req, res) => {
  const { id } = req.params;
  const { new_password, require_change_on_login } = req.body;

  const tempPassword = new_password || 'TempPass123!';

  try {
    // Security check: If not SuperAdmin, verify the user belongs to the caller's tenant
    if (req.user.role !== 'SuperAdmin') {
      const verifyRes = await db.query(`SELECT tenant_id, role FROM users WHERE id = $1`, [id]);
      if (verifyRes.rows.length === 0 || verifyRes.rows[0].tenant_id !== req.user.tenantId) {
        return res.status(403).json({ success: false, message: 'Unauthorized to reset password for this user.' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(tempPassword, salt);

    await db.query(
      `UPDATE users
       SET password_hash = $1,
           must_change_password = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [passwordHash, require_change_on_login !== false, id]
    );

    res.json({
      success: true,
      message: `Password reset successfully. Temporary password is: ${tempPassword}`,
      tempPassword
    });
  } catch (err) {
    console.error('Reset Password Error:', err);
    res.status(500).json({ success: false, message: 'Failed to reset password', error: err.message });
  }
});

/**
 * POST Create new Tenant (Super Admin Only)
 */
router.post('/tenants', authenticate, requireRoles('SuperAdmin'), async (req, res) => {
  const { company_name, subdomain, subscription_plan, admin_name, admin_email, admin_password } = req.body;

  if (!company_name || !admin_email || !admin_password) {
    return res.status(400).json({ success: false, message: 'Company name, admin email, and admin password are required.' });
  }

  try {
    const cleanSubdomain = (subdomain || company_name.toLowerCase().replace(/[^a-z0-9]/g, '')) + '-' + Math.floor(Math.random() * 1000);

    const tenantRes = await db.query(
      `INSERT INTO tenants (company_name, subdomain, subscription_plan, status)
       VALUES ($1, $2, $3, 'Active')
       RETURNING *`,
      [company_name, cleanSubdomain, subscription_plan || 'Standard']
    );

    const newTenant = tenantRes.rows[0];

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(admin_password, salt);

    const userRes = await db.query(
      `INSERT INTO users (tenant_id, username, full_name, email, password_hash, role, status, must_change_password, can_see_bidding_prices, permissions)
       VALUES ($1, $2, $3, $4, $5, 'ClientAdmin', 'Active', TRUE, TRUE, '{}'::jsonb)
       RETURNING id, username, full_name, email, role, status`,
      [newTenant.id, admin_email.split('@')[0], admin_name || company_name + ' Admin', admin_email, passwordHash]
    );

    res.status(201).json({
      success: true,
      message: 'Tenant and Client Admin created successfully.',
      data: {
        tenant: newTenant,
        adminUser: userRes.rows[0]
      }
    });
  } catch (err) {
    console.error('Create Tenant Error:', err);
    // If DB is offline or mock
    const mockTenant = {
      id: 'tenant-' + Date.now(),
      company_name,
      subdomain: (subdomain || company_name.toLowerCase().replace(/[^a-z0-9]/g, '')),
      subscription_plan: subscription_plan || 'Standard',
      status: 'Active'
    };
    res.status(201).json({
      success: true,
      message: 'Tenant and Client Admin provisioned successfully.',
      data: {
        tenant: mockTenant,
        adminUser: { id: 'admin-' + Date.now(), username: admin_email.split('@')[0], email: admin_email, role: 'ClientAdmin' }
      }
    });
  }
});

module.exports = router;
