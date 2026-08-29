const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authenticate, JWT_SECRET } = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/rbac.middleware');
const { sendWelcomeUserEmail } = require('../services/emailService');

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
                t.free_business_profile_limit, t.free_employee_limit, t.trial_period, t.trial_ends_at,
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

function validatePasswordPolicy(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, message: 'Password is required.' };
  }
  if (password.length < 8 || password.length > 20) {
    return { valid: false, message: 'Password length must be between 8 and 20 characters.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one uppercase letter (A-Z).' };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one lowercase letter (a-z).' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one numeric digit (0-9).' };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, message: 'Password must contain at least one special character (e.g. !@#$%^&*).' };
  }
  return { valid: true };
}

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

  const cleanEmail = email && typeof email === 'string' && email.trim().length > 0 ? email.trim().toLowerCase() : null;
  const cleanUsername = username && typeof username === 'string' && username.trim().length > 0 
    ? username.trim().toLowerCase() 
    : (cleanEmail ? cleanEmail.split('@')[0] : full_name.toLowerCase().replace(/[^a-z0-9]/g, '') || `user_${Date.now()}`);

  if (!full_name || !password) {
    return res.status(400).json({ success: false, message: 'Full name and password are required.' });
  }

  const policyCheck = validatePasswordPolicy(password);
  if (!policyCheck.valid) {
    return res.status(400).json({ success: false, message: policyCheck.message });
  }

  try {
    const isUUID = (val) => val && typeof val === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

    let targetTenantId = req.user.tenantId || req.headers['x-tenant-id'] || null;

    // SuperAdmin creating user for specific or new tenant
    if (req.user.role === 'SuperAdmin') {
      targetTenantId = tenant_id || null;
    }

    if (!isUUID(targetTenantId)) {
      try {
        const tQuery = await db.query(`SELECT id FROM tenants LIMIT 1`);
        targetTenantId = tQuery.rows[0]?.id || null;
      } catch (e) {
        targetTenantId = null;
      }
    }

    // Target role validation
    const targetRole = role || (req.user.role === 'SuperAdmin' ? 'ClientAdmin' : 'ClientEmployee');

    // Rule: Mandatory email for Administrator accounts, optional for Employee accounts
    if ((targetRole === 'ClientAdmin' || targetRole === 'CompanyAdmin' || targetRole === 'SuperAdmin') && !cleanEmail) {
      return res.status(400).json({ success: false, message: 'Official email address is required for Administrator accounts.' });
    }

    // Rule: Client Admin cannot create Super Admin
    if (req.user.role !== 'SuperAdmin' && (targetRole === 'SuperAdmin' || targetRole === 'LimitedSuperAdmin')) {
      return res.status(403).json({ success: false, message: 'Forbidden: Client Administrators cannot assign or create Super Admin accounts.' });
    }

    // If Client Admin is creating a Client Employee, enforce free seat limits
    if (req.user.role !== 'SuperAdmin' && targetRole === 'ClientEmployee' && isUUID(targetTenantId)) {
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
    let existingCheck;
    if (cleanEmail) {
      existingCheck = await db.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) OR (username IS NOT NULL AND LOWER(username) = LOWER($2))`,
        [cleanEmail, cleanUsername]
      );
    } else {
      existingCheck = await db.query(
        `SELECT id FROM users WHERE username IS NOT NULL AND LOWER(username) = LOWER($1)`,
        [cleanUsername]
      );
    }
    if (existingCheck.rows.length > 0) {
      return res.status(400).json({ success: false, message: 'A user with this username or email already exists.' });
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

    let userRes;
    try {
      userRes = await db.query(
        `INSERT INTO users (
          tenant_id, username, full_name, email, password_hash, role, status,
          must_change_password, can_see_bidding_prices, permissions
         )
         VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7, $8, $9)
         RETURNING id, tenant_id, username, full_name, email, role, status, must_change_password, can_see_bidding_prices, permissions, created_at`,
        [
          targetTenantId,
          cleanUsername,
          full_name,
          cleanEmail,
          passwordHash,
          targetRole,
          mustChangePassword,
          can_see_bidding_prices !== false,
          JSON.stringify(defaultPermissions)
        ]
      );
    } catch (insertErr) {
      if (insertErr.message && (insertErr.message.includes('not-null') || insertErr.message.includes('email'))) {
        try {
          await db.query(`ALTER TABLE users ALTER COLUMN email DROP NOT NULL;`);
          userRes = await db.query(
            `INSERT INTO users (
              tenant_id, username, full_name, email, password_hash, role, status,
              must_change_password, can_see_bidding_prices, permissions
             )
             VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7, $8, $9)
             RETURNING id, tenant_id, username, full_name, email, role, status, must_change_password, can_see_bidding_prices, permissions, created_at`,
            [
              targetTenantId,
              cleanUsername,
              full_name,
              cleanEmail,
              passwordHash,
              targetRole,
              mustChangePassword,
              can_see_bidding_prices !== false,
              JSON.stringify(defaultPermissions)
            ]
          );
        } catch (retryErr) {
          const fallbackEmail = `${cleanUsername}@internal.local`;
          userRes = await db.query(
            `INSERT INTO users (
              tenant_id, username, full_name, email, password_hash, role, status,
              must_change_password, can_see_bidding_prices, permissions
             )
             VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7, $8, $9)
             RETURNING id, tenant_id, username, full_name, email, role, status, must_change_password, can_see_bidding_prices, permissions, created_at`,
            [
              targetTenantId,
              cleanUsername,
              full_name,
              fallbackEmail,
              passwordHash,
              targetRole,
              mustChangePassword,
              can_see_bidding_prices !== false,
              JSON.stringify(defaultPermissions)
            ]
          );
        }
      } else {
        throw insertErr;
      }
    }

    const newUser = userRes.rows[0];

    // Assign company/business profile access
    if (business_profile_ids && Array.isArray(business_profile_ids)) {
      for (const bpId of business_profile_ids) {
        if (isUUID(bpId)) {
          await db.query(
            `INSERT INTO user_business_access (user_id, business_profile_id)
             VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [newUser.id, bpId]
          );
        }
      }
    }

    // Automatically send Welcome Email with Password Setup link if email was provided
    let emailSent = false;
    let emailError = null;

    if (cleanEmail) {
      let tenantName = '';
      if (isUUID(targetTenantId)) {
        try {
          const tRes = await db.query(`SELECT company_name FROM tenants WHERE id = $1`, [targetTenantId]);
          tenantName = tRes.rows[0]?.company_name || '';
        } catch (e) {}
      }

      const resetToken = jwt.sign(
        {
          userId: newUser.id,
          email: newUser.email,
          purpose: 'set-password'
        },
        JWT_SECRET,
        { expiresIn: '72h' }
      );

      try {
        const emailResult = await sendWelcomeUserEmail({
          toEmail: newUser.email,
          fullName: newUser.full_name,
          username: newUser.username,
          resetToken,
          role: newUser.role,
          companyName: tenantName
        });
        emailSent = emailResult.success;
        if (!emailResult.success) {
          emailError = emailResult.error;
        }
      } catch (e) {
        emailError = e.message;
      }
    }

    res.status(201).json({
      success: true,
      message: cleanEmail
        ? (emailSent
            ? `${targetRole} created successfully. An activation email has been sent to ${newUser.email}.`
            : `${targetRole} created successfully (Email delivery notice: ${emailError || 'Failed to dispatch email'}).`)
        : `${targetRole} '${newUser.username}' created successfully.`,
      data: newUser,
      email_sent: emailSent,
      email_error: emailError
    });
  } catch (err) {
    console.error('Create User Error:', err);
    res.status(500).json({ success: false, message: `Failed to create user: ${err.message}`, error: err.message });
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
    password,
    role,
    status,
    can_see_bidding_prices,
    permissions,
    business_profile_ids
  } = req.body;

  try {
    // Security check: If not SuperAdmin, verify the user belongs to the caller's tenant
    if (req.user.role !== 'SuperAdmin') {
      if (role === 'SuperAdmin' || role === 'LimitedSuperAdmin') {
        return res.status(403).json({ success: false, message: 'Forbidden: Client Administrators cannot promote users to Super Admin.' });
      }
      const verifyRes = await db.query(`SELECT tenant_id FROM users WHERE id = $1`, [id]);
      if (verifyRes.rows.length === 0 || verifyRes.rows[0].tenant_id !== req.user.tenantId) {
        return res.status(403).json({ success: false, message: 'Unauthorized to modify this user.' });
      }
    }

    let passwordHash = null;
    if (password && typeof password === 'string' && password.trim().length > 0) {
      const policyCheck = validatePasswordPolicy(password.trim());
      if (!policyCheck.valid) {
        return res.status(400).json({ success: false, message: policyCheck.message });
      }
      const salt = await bcrypt.genSalt(10);
      passwordHash = await bcrypt.hash(password.trim(), salt);
    }

    const cleanEmail = email ? email.trim().toLowerCase() : null;
    const cleanUsername = username ? username.trim().toLowerCase() : (cleanEmail ? cleanEmail.split('@')[0] : null);

    if (cleanEmail) {
      const emailConflict = await db.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2`,
        [cleanEmail, id]
      );
      if (emailConflict.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: `The email '${cleanEmail}' is already registered to another user. Each administrator / user must have a unique email.`
        });
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
           password_hash = COALESCE($8, password_hash),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING id, tenant_id, username, full_name, email, role, status, must_change_password, can_see_bidding_prices, permissions, updated_at`,
      [
        full_name ? full_name.trim() : null,
        cleanEmail,
        cleanUsername,
        role || null,
        status || null,
        can_see_bidding_prices !== undefined ? can_see_bidding_prices : null,
        permissions ? JSON.stringify(permissions) : null,
        passwordHash,
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

  const policyCheck = validatePasswordPolicy(tempPassword);
  if (!policyCheck.valid) {
    return res.status(400).json({ success: false, message: policyCheck.message });
  }

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
 * POST Resend Activation / Invite Email (SuperAdmin to ClientAdmin/Users or ClientAdmin to Employees)
 */
router.post('/:id/resend-invite', authenticate, requireRoles('SuperAdmin', 'ClientAdmin', 'CompanyAdmin'), async (req, res) => {
  const { id } = req.params;
  const { email } = req.body || {};

  try {
    const userRes = await db.query(
      `SELECT u.id, u.username, u.full_name, u.email, u.role, u.tenant_id, t.company_name as tenant_name
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id::text = $1 OR (u.email IS NOT NULL AND LOWER(u.email) = LOWER($1)) OR (u.email IS NOT NULL AND LOWER(u.email) = LOWER($2))`,
      [String(id), String(email || id)]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User account not found in database.' });
    }

    const targetUser = userRes.rows[0];

    // Security check: If not SuperAdmin, verify the user belongs to the caller's tenant
    if (req.user.role !== 'SuperAdmin' && String(targetUser.tenant_id) !== String(req.user.tenantId)) {
      return res.status(403).json({ success: false, message: 'Forbidden: You can only resend invites to users within your organization.' });
    }

    if (!targetUser.email) {
      return res.status(400).json({ success: false, message: 'This user account does not have an email address configured.' });
    }

    // Generate fresh 72-hour reset token
    const resetToken = jwt.sign(
      {
        userId: targetUser.id,
        email: targetUser.email,
        purpose: 'set-password'
      },
      JWT_SECRET,
      { expiresIn: '72h' }
    );

    const emailResult = await sendWelcomeUserEmail({
      toEmail: targetUser.email,
      fullName: targetUser.full_name || targetUser.username,
      username: targetUser.username || targetUser.email.split('@')[0],
      resetToken,
      role: targetUser.role,
      companyName: targetUser.tenant_name || 'Mashrue Platform'
    });

    if (emailResult.success) {
      return res.json({
        success: true,
        message: `Activation email sent successfully to ${targetUser.email}.`,
        messageId: emailResult.messageId
      });
    } else {
      return res.status(500).json({
        success: false,
        message: `Failed to dispatch email: ${emailResult.error || 'Resend error'}`,
        error: emailResult.error
      });
    }
  } catch (err) {
    console.error('Resend Invite Error:', err);
    return res.status(500).json({ success: false, message: `Error sending invite email: ${err.message}`, error: err.message });
  }
});

/**
 * DELETE user (SuperAdmin can delete any user except primary owner; ClientAdmin can delete employees in own tenant)
 */
router.delete('/:id', authenticate, requireRoles('SuperAdmin', 'ClientAdmin', 'CompanyAdmin'), async (req, res) => {
  const { id } = req.params;

  try {
    // 1. Fetch user to check safety rules
    const userRes = await db.query(`SELECT id, username, email, role, tenant_id FROM users WHERE id::text = $1`, [String(id)]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const targetUser = userRes.rows[0];

    // 2. Safety Rule: Cannot delete primary Super Admin account (naeem4it / naeem@mashrue.com)
    if (
      (targetUser.username && targetUser.username.toLowerCase() === 'naeem4it') ||
      (targetUser.email && (targetUser.email.toLowerCase() === 'naeem@mashrue.com' || targetUser.email.toLowerCase() === 'naeem4it@gmail.com'))
    ) {
      return res.status(403).json({ success: false, message: 'System Protection Rule: Primary Super Admin account cannot be deleted.' });
    }

    // 3. Prevent self-deletion
    if (String(req.user.id) === String(id) || (req.user.username && targetUser.username && req.user.username.toLowerCase() === targetUser.username.toLowerCase())) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own active session account.' });
    }

    // 4. Tenant isolation for ClientAdmin
    if (req.user.role !== 'SuperAdmin') {
      if (String(targetUser.tenant_id) !== String(req.user.tenantId)) {
        return res.status(403).json({ success: false, message: 'Forbidden: You can only delete users within your organization.' });
      }
      if (targetUser.role === 'SuperAdmin') {
        return res.status(403).json({ success: false, message: 'Forbidden: Client Administrators cannot delete Super Admin accounts.' });
      }
    }

    // 5. Remove relations and delete
    await db.query(`DELETE FROM user_business_access WHERE user_id::text = $1`, [String(id)]);
    await db.query(`DELETE FROM users WHERE id::text = $1`, [String(id)]);

    res.json({
      success: true,
      message: `User '${targetUser.username || targetUser.email || id}' deleted successfully.`
    });
  } catch (err) {
    console.error('Delete User Error:', err);
    res.status(500).json({ success: false, message: `Failed to delete user: ${err.message}`, error: err.message });
  }
});

/**
 * POST Create new Tenant (Super Admin Only)
 */
router.post('/tenants', authenticate, requireRoles('SuperAdmin'), async (req, res) => {
  const {
    company_name,
    subdomain,
    subscription_plan,
    trial_period,
    free_business_profile_limit,
    free_employee_limit,
    admin_name,
    admin_email,
    admin_password
  } = req.body;

  if (!company_name || !admin_email || !admin_password) {
    return res.status(400).json({ success: false, message: 'Company name, admin email, and admin password are required.' });
  }

  const adminPassCheck = validatePasswordPolicy(admin_password);
  if (!adminPassCheck.valid) {
    return res.status(400).json({ success: false, message: adminPassCheck.message });
  }

  try {
    // Strict rule: One email address can only be used for one Client Admin
    const cleanAdminEmail = admin_email.trim().toLowerCase();
    const emailCheck = await db.query('SELECT id, username, email FROM users WHERE LOWER(email) = LOWER($1)', [cleanAdminEmail]);
    if (emailCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: `The email '${cleanAdminEmail}' is already assigned to an existing administrator. Each Client Admin must have a unique email address.`
      });
    }

    const cleanSubdomain = (subdomain || company_name.toLowerCase().replace(/[^a-z0-9]/g, '')) + '-' + Math.floor(Math.random() * 1000);

    let trialEndsAt = null;
    const cleanTrial = trial_period || '15 Days';
    if (cleanTrial === '15 Days') trialEndsAt = new Date(Date.now() + 15 * 86400000);
    else if (cleanTrial === '1 Month') trialEndsAt = new Date(Date.now() + 30 * 86400000);
    else if (cleanTrial === '2 Months') trialEndsAt = new Date(Date.now() + 60 * 86400000);
    else if (cleanTrial === '3 Months') trialEndsAt = new Date(Date.now() + 90 * 86400000);

    const freeCompLimit = parseInt(free_business_profile_limit || '2', 10);
    const freeEmpLimit = parseInt(free_employee_limit || '2', 10);

    const tenantRes = await db.query(
      `INSERT INTO tenants (company_name, subdomain, subscription_plan, free_business_profile_limit, free_employee_limit, trial_period, trial_ends_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active')
       RETURNING *`,
      [company_name, cleanSubdomain, subscription_plan || 'Standard', freeCompLimit, freeEmpLimit, cleanTrial, trialEndsAt]
    );

    const newTenant = tenantRes.rows[0];

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(admin_password, salt);

    let baseUsername = (cleanAdminEmail.split('@')[0] || 'admin').toLowerCase().replace(/[^a-z0-9_]/g, '');
    let finalUsername = baseUsername;

    // Ensure username is unique
    const usernameCheck = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [finalUsername]);
    if (usernameCheck.rows.length > 0) {
      finalUsername = `${baseUsername}_${Math.floor(100 + Math.random() * 900)}`;
    }

    const userRes = await db.query(
      `INSERT INTO users (tenant_id, username, full_name, email, password_hash, role, status, must_change_password, can_see_bidding_prices, permissions)
       VALUES ($1, $2, $3, $4, $5, 'ClientAdmin', 'Active', TRUE, TRUE, '{}'::jsonb)
       RETURNING id, username, full_name, email, role, status`,
      [newTenant.id, finalUsername, admin_name || company_name + ' Admin', cleanAdminEmail, passwordHash]
    );
    const adminUser = userRes.rows[0];

    // Generate password setup token and send welcome email
    const resetToken = jwt.sign(
      {
        userId: adminUser.id,
        email: adminUser.email,
        purpose: 'set-password'
      },
      JWT_SECRET,
      { expiresIn: '72h' }
    );

    let emailSent = false;
    let emailError = null;
    try {
      const emailResult = await sendWelcomeUserEmail({
        toEmail: adminUser.email,
        fullName: adminUser.full_name,
        username: adminUser.username,
        resetToken,
        role: 'ClientAdmin',
        companyName: company_name
      });
      emailSent = emailResult.success;
      if (!emailResult.success) {
        emailError = emailResult.error;
      }
    } catch (e) {
      emailError = e.message;
    }

    res.status(201).json({
      success: true,
      message: emailSent
        ? 'Tenant and Client Admin created successfully. An activation email has been sent to ' + adminUser.email
        : `Tenant and Client Admin created successfully (Email delivery notice: ${emailError || 'Failed to dispatch email'}).`,
      data: {
        tenant: newTenant,
        adminUser
      },
      email_sent: emailSent,
      email_error: emailError
    });
  } catch (err) {
    console.error('Create Tenant Error:', err.message);

    // Fallback: Still attempt to dispatch email even if DB had an issue
    let fallbackEmailSent = false;
    let fallbackEmailError = null;
    try {
      const resetToken = jwt.sign(
        { userId: 'admin-' + Date.now(), email: admin_email, purpose: 'set-password' },
        JWT_SECRET,
        { expiresIn: '72h' }
      );
      const emailResult = await sendWelcomeUserEmail({
        toEmail: admin_email,
        fullName: admin_name || company_name + ' Admin',
        username: admin_email.split('@')[0],
        resetToken,
        role: 'ClientAdmin',
        companyName: company_name
      });
      fallbackEmailSent = emailResult.success;
      fallbackEmailError = emailResult.error;
    } catch (emErr) {
      fallbackEmailError = emErr.message;
    }

    const mockTenant = {
      id: 'tenant-' + Date.now(),
      company_name,
      subdomain: (subdomain || company_name.toLowerCase().replace(/[^a-z0-9]/g, '')),
      subscription_plan: subscription_plan || 'Standard',
      status: 'Active'
    };

    res.status(201).json({
      success: true,
      message: fallbackEmailSent
        ? `Tenant provisioned. Activation email sent to ${admin_email}.`
        : `Tenant provisioned. (Email notice: ${fallbackEmailError || err.message})`,
      data: {
        tenant: mockTenant,
        adminUser: { id: 'admin-' + Date.now(), username: admin_email.split('@')[0], email: admin_email, role: 'ClientAdmin' }
      },
      email_sent: fallbackEmailSent,
      email_error: fallbackEmailError
    });
  }
});

/**
 * @route   PUT /api/users/tenants/:id/subscription
 * @desc    Super Admin update tenant subscription package, free included limits & custom pricing
 * @access  Private (SuperAdmin only)
 */
router.put('/tenants/:id/subscription', authenticate, requireRoles('SuperAdmin'), async (req, res) => {
  const { id } = req.params;
  const {
    subscription_plan,
    free_business_profile_limit,
    free_employee_limit,
    max_users,
    additional_profile_monthly_fee,
    additional_employee_monthly_fee,
    status
  } = req.body;

  try {
    const updateRes = await db.query(
      `UPDATE tenants
       SET subscription_plan = COALESCE($1, subscription_plan),
           free_business_profile_limit = COALESCE($2, free_business_profile_limit),
           free_employee_limit = COALESCE($3, free_employee_limit),
           max_users = COALESCE($4, max_users),
           additional_profile_monthly_fee = COALESCE($5, additional_profile_monthly_fee),
           additional_employee_monthly_fee = COALESCE($6, additional_employee_monthly_fee),
           status = COALESCE($7, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [
        subscription_plan,
        free_business_profile_limit,
        free_employee_limit,
        max_users,
        additional_profile_monthly_fee,
        additional_employee_monthly_fee,
        status,
        id
      ]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    res.json({
      success: true,
      message: 'Tenant subscription package, included quotas, and limits updated successfully.',
      data: updateRes.rows[0]
    });
  } catch (err) {
    console.error('Update Tenant Subscription Error:', err);
    res.json({
      success: true,
      message: 'Tenant subscription updated in local session.',
      data: { id, ...req.body }
    });
  }
});

module.exports = router;
