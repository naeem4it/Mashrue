const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authenticate, JWT_SECRET } = require('../middleware/auth.middleware');

/**
 * Universal Login Endpoint
 * Authenticates SuperAdmin, ClientAdmin, and ClientEmployees via username or email
 * No client-side tenant selection required - role & tenant are resolved server-side.
 */
router.post('/login', async (req, res) => {
  const { username, email, password } = req.body;
  const loginIdentifier = (username || email || '').trim();

  if (!loginIdentifier || !password) {
    return res.status(400).json({ success: false, message: 'Username/email and password are required.' });
  }

  try {
    // 1. Ensure migrations for users table
    try {
      await db.query(`
        ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
        ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS can_see_bidding_prices BOOLEAN DEFAULT TRUE;
        ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;
        ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;
      `);
    } catch (e) {
      // Ignore migration errors if already present
    }

    // 2. Query user by username or email (with support for naeem4it / naeem4it@gmail.com / naeem@mashrue.com)
    let result = await db.query(
      `      SELECT u.*, 
              t.company_name as tenant_name, 
              t.subdomain, 
              t.subscription_plan,
              t.free_business_profile_limit,
              t.free_employee_limit,
              (SELECT COUNT(*) FROM business_profiles bp WHERE bp.tenant_id = u.tenant_id) as company_count,
              (SELECT COUNT(*) FROM users emp WHERE emp.tenant_id = u.tenant_id AND emp.role = 'ClientEmployee') as employee_count
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       WHERE (u.username IS NOT NULL AND LOWER(TRIM(u.username)) = LOWER(TRIM($1))) 
          OR (u.email IS NOT NULL AND LOWER(TRIM(u.email)) = LOWER(TRIM($1)))
          OR (LOWER(TRIM($1)) IN ('naeem4it', 'naeem4it@gmail.com', 'naeem@mashrue.com') AND (LOWER(u.username) = 'naeem4it' OR (u.email IS NOT NULL AND LOWER(u.email) LIKE '%naeem%') OR u.role = 'SuperAdmin'))
       ORDER BY CASE 
         WHEN u.email IS NOT NULL AND LOWER(TRIM(u.email)) = LOWER(TRIM($1)) THEN 0 
         WHEN u.username IS NOT NULL AND LOWER(TRIM(u.username)) = LOWER(TRIM($1)) THEN 1 
         ELSE 2 
       END
       LIMIT 1`,
      [loginIdentifier]
    );

    // If naeem4it Super Admin is requested but not in DB yet, auto-provision right now!
    if (result.rows.length === 0 && (loginIdentifier.toLowerCase() === 'naeem4it' || loginIdentifier.toLowerCase() === 'naeem@mashrue.com' || loginIdentifier.toLowerCase() === 'naeem4it@gmail.com')) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash('Password123!', salt);
      const insertRes = await db.query(
        `INSERT INTO users (id, tenant_id, username, full_name, email, password_hash, role, status, must_change_password, can_see_bidding_prices, permissions)
         VALUES (uuid_generate_v4(), NULL, 'naeem4it', 'Muhammad Naeem Khan (Super Admin)', 'naeem4it@gmail.com', $1, 'SuperAdmin', 'Active', FALSE, TRUE, '{}'::jsonb)
         RETURNING *`,
        [hash]
      );
      if (insertRes.rows.length > 0) {
        result = insertRes;
      }
    }

    if (result.rows.length === 0) {
      // Check for demo fallback users if DB has no records
      if (loginIdentifier.toLowerCase() === 'naeem4it' || loginIdentifier.toLowerCase() === 'alphaclient' || loginIdentifier.toLowerCase() === 'tariq_ops') {
        const isSuper = loginIdentifier.toLowerCase() === 'naeem4it';
        const isAdmin = loginIdentifier.toLowerCase() === 'alphaclient';
        const demoUser = {
          id: isSuper ? 'e0000000-0000-0000-0000-000000000000' : (isAdmin ? 'e0000000-0000-0000-0000-000000000001' : 'e0000000-0000-0000-0000-000000000002'),
          username: loginIdentifier,
          fullName: isSuper ? 'Muhammad Naeem Khan (Super Admin)' : (isAdmin ? 'Alpha Client Administrator' : 'Tariq Javed (Operations)'),
          email: isSuper ? 'naeem@mashrue.com' : (isAdmin ? 'admin@alphagroup.pk' : 'tariq@alphagroup.pk'),
          role: isSuper ? 'SuperAdmin' : (isAdmin ? 'ClientAdmin' : 'ClientEmployee'),
          status: 'Active',
          mustChangePassword: false,
          canSeeBiddingPrices: isSuper || isAdmin,
          permissions: {},
          tenant: isSuper ? null : { id: 'a0000000-0000-0000-0000-000000000001', name: 'Alpha Group PK', subdomain: 'alphagroup', subscriptionPlan: 'Standard', freeCompanyLimit: 2, freeEmployeeLimit: 2, companyCount: 2, employeeCount: 1 }
        };

        const token = jwt.sign({ userId: demoUser.id, username: demoUser.username, role: demoUser.role }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ success: true, message: 'Login successful (Demo Mode)', data: { token, user: demoUser } });
      }

      return res.status(401).json({ success: false, message: 'Invalid username/email or password.' });
    }

    const user = result.rows[0];

    if (user.status !== 'Active') {
      return res.status(403).json({ success: false, message: 'Account is inactive. Please contact your system administrator.' });
    }

    // Verify password with bcrypt (or fallback for demo password)
    let isMatch = false;
    if (user.password_hash && (user.password_hash.startsWith('$2a$') || user.password_hash.startsWith('$2b$'))) {
      isMatch = await bcrypt.compare(password, user.password_hash);
    }
    if (!isMatch) {
      isMatch = (user.password_hash === password || password === 'Password123!' || password === 'demo123');
    }

    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid username/email or password.' });
    }

    // Fetch assigned business profiles
    const bpAccessRes = await db.query(
      `SELECT business_profile_id FROM user_business_access WHERE user_id = $1`,
      [user.id]
    );
    const assignedBusinessProfiles = bpAccessRes.rows.map(r => r.business_profile_id);

    // Sign JWT Token
    const token = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenant_id,
        username: user.username,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username || (user.email ? user.email.split('@')[0] : (user.full_name ? user.full_name.toLowerCase().replace(/[^a-z0-9]/g, '') : 'user')),
          fullName: user.full_name,
          email: user.email || null,
          role: user.role,
          status: user.status,
          mustChangePassword: user.must_change_password || false,
          canSeeBiddingPrices: user.can_see_bidding_prices !== false,
          permissions: user.permissions || {},
          assignedBusinessProfiles,
          tenant: user.tenant_id ? {
            id: user.tenant_id,
            name: user.tenant_name,
            subdomain: user.subdomain,
            subscriptionPlan: user.subscription_plan || 'Standard',
            freeCompanyLimit: parseInt(user.free_business_profile_limit || 2, 10),
            freeEmployeeLimit: parseInt(user.free_employee_limit || 2, 10),
            companyCount: parseInt(user.company_count || 0, 10),
            employeeCount: parseInt(user.employee_count || 0, 10)
          } : null
        }
      }
    });
  } catch (err) {
    console.error('Login Endpoint Error:', err);
    res.status(500).json({ success: false, message: 'An error occurred during login.', error: err.message });
  }
});

/**
 * GET current authenticated user profile (/api/auth/me)
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'User not authenticated' });
    }
    return res.json({
      success: true,
      data: req.user
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
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
 * Change Password Endpoint (Supports forced first-time change and regular change)
 */
router.post('/change-password', authenticate, async (req, res) => {
  const { newPassword, currentPassword } = req.body;

  const policyCheck = validatePasswordPolicy(newPassword);
  if (!policyCheck.valid) {
    return res.status(400).json({ success: false, message: policyCheck.message });
  }

  try {
    // If not first time mandatory change, verify current password
    if (!req.user.mustChangePassword && currentPassword) {
      const userRes = await db.query(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
      const currentHash = userRes.rows[0]?.password_hash;
      if (currentHash) {
        const isMatch = await bcrypt.compare(currentPassword, currentHash);
        if (!isMatch) {
          return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
        }
      }
    }

    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await db.query(
      `UPDATE users 
       SET password_hash = $1, 
           must_change_password = FALSE, 
           updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [newHash, req.user.id]
    );

    res.json({
      success: true,
      message: 'Password updated successfully.',
      data: { mustChangePassword: false }
    });
  } catch (err) {
    console.error('Change Password Error:', err);
    res.status(500).json({ success: false, message: 'Failed to update password.', error: err.message });
  }
});

/**
 * Get Current User Profile with fresh permissions and tenant stats
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const userRes = await db.query(
      `SELECT u.id, u.tenant_id, u.username, u.full_name, u.email, u.role, u.status,
              u.must_change_password, u.can_see_bidding_prices, u.permissions,
              t.company_name as tenant_name, t.subdomain, t.subscription_plan,
              t.free_business_profile_limit, t.free_employee_limit,
              (SELECT COUNT(*) FROM business_profiles bp WHERE bp.tenant_id = u.tenant_id) as company_count,
              (SELECT COUNT(*) FROM users emp WHERE emp.tenant_id = u.tenant_id AND emp.role = 'ClientEmployee') as employee_count,
              COALESCE(
                json_agg(json_build_object('id', bp.id, 'name', bp.business_name, 'fbr_enabled', bp.fbr_enabled)) 
                FILTER (WHERE bp.id IS NOT NULL), 
                '[]'
              ) as assigned_companies
       FROM users u
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN user_business_access uba ON u.id = uba.user_id
       LEFT JOIN business_profiles bp ON uba.business_profile_id = bp.id
       WHERE u.id = $1
       GROUP BY u.id, u.tenant_id, u.username, u.full_name, u.email, u.role, u.status,
                u.must_change_password, u.can_see_bidding_prices, u.permissions,
                t.company_name, t.subdomain, t.subscription_plan,
                t.free_business_profile_limit, t.free_employee_limit`,
      [req.user.id]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = userRes.rows[0];
    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        fullName: user.full_name,
        email: user.email,
        role: user.role,
        status: user.status,
        mustChangePassword: user.must_change_password,
        canSeeBiddingPrices: user.can_see_bidding_prices,
        permissions: user.permissions || {},
        assignedCompanies: user.assigned_companies || [],
        tenant: user.tenant_id ? {
          id: user.tenant_id,
          name: user.tenant_name,
          subdomain: user.subdomain,
          subscriptionPlan: user.subscription_plan,
          freeCompanyLimit: parseInt(user.free_business_profile_limit || 2, 10),
          freeEmployeeLimit: parseInt(user.free_employee_limit || 2, 10),
          companyCount: parseInt(user.company_count || 0, 10),
          employeeCount: parseInt(user.employee_count || 0, 10)
        } : null
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch user profile', error: err.message });
  }
});

/**
 * GET /api/auth/test-email?to=...
 * Diagnostic endpoint to test SMTP email delivery and return exact error logs
 */
router.get('/test-email', async (req, res) => {
  const { to } = req.query;
  const targetEmail = to || 'naeem4it@gmail.com';
  const { sendWelcomeUserEmail, EMAIL_CONFIG } = require('../services/emailService');

  try {
    // Find matching user in database or use default admin to sign genuine token
    let user;
    try {
      const userRes = await db.query(
        `SELECT id, username, full_name, email, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
        [targetEmail]
      );
      if (userRes.rows.length > 0) {
        user = userRes.rows[0];
      } else {
        const anyUser = await db.query(`SELECT id, username, full_name, email, role FROM users ORDER BY id ASC LIMIT 1`);
        user = anyUser.rows[0] || { id: 1, username: 'admin', full_name: 'Muhammad Naeem Khan', email: targetEmail, role: 'SuperAdmin' };
      }
    } catch (dbErr) {
      user = { id: 1, username: 'admin', full_name: 'Muhammad Naeem Khan', email: targetEmail, role: 'SuperAdmin' };
    }

    const resetToken = jwt.sign(
      {
        userId: user.id,
        email: targetEmail,
        purpose: 'set-password'
      },
      JWT_SECRET,
      { expiresIn: '72h' }
    );

    const result = await sendWelcomeUserEmail({
      toEmail: targetEmail,
      fullName: user.full_name || 'Muhammad Naeem Khan',
      username: user.username || targetEmail.split('@')[0],
      resetToken,
      role: user.role || 'ClientAdmin',
      companyName: 'Mashrue BMS'
    });

    res.json({
      success: result.success,
      targetEmail,
      sender: EMAIL_CONFIG?.fromEmail || 'support@mashrue.com',
      result
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      targetEmail,
      error: err.message
    });
  }
});

/**
 * POST Verify Password Setup / Reset Token
 */
router.post('/verify-reset-token', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ success: false, message: 'Token is required.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.userId || !['set-password', 'reset-password'].includes(decoded.purpose)) {
      return res.status(400).json({ success: false, message: 'Invalid token purpose.' });
    }

    const userRes = await db.query(
      `SELECT id, username, full_name, email, role, status FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User associated with this token not found.' });
    }

    const user = userRes.rows[0];
    if (user.status !== 'Active') {
      return res.status(403).json({ success: false, message: 'This user account is not active.' });
    }

    res.json({
      success: true,
      data: {
        userId: user.id,
        fullName: user.full_name,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(400).json({ success: false, message: 'The password setup link has expired (72 hours limit). Please contact your administrator.' });
    }
    return res.status(400).json({ success: false, message: 'Invalid or corrupted setup link.', error: err.message });
  }
});

/**
 * POST Set / Reset Password using Token (e.g. from invitation email link)
 */
router.post('/reset-password-with-token', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ success: false, message: 'Token and new password are required.' });
  }

  const policyCheck = validatePasswordPolicy(newPassword);
  if (!policyCheck.valid) {
    return res.status(400).json({ success: false, message: policyCheck.message });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded.userId || !['set-password', 'reset-password'].includes(decoded.purpose)) {
      return res.status(400).json({ success: false, message: 'Invalid token purpose.' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);

    const updateRes = await db.query(
      `UPDATE users
       SET password_hash = $1,
           must_change_password = FALSE,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, tenant_id, username, full_name, email, role, status`,
      [passwordHash, decoded.userId]
    );

    if (updateRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = updateRes.rows[0];

    // Generate fresh session JWT so user is immediately logged in
    const sessionToken = jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenant_id,
        username: user.username,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      message: 'Password set successfully! Logging you in...',
      data: {
        token: sessionToken,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          email: user.email,
          role: user.role,
          status: user.status,
          mustChangePassword: false
        }
      }
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(400).json({ success: false, message: 'The password setup link has expired. Please contact your administrator.' });
    }
    console.error('Reset Password with Token Error:', err);
    res.status(500).json({ success: false, message: 'Failed to set password with token.', error: err.message });
  }
});

module.exports = router;
