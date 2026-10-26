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

    // 2. Query user by username or email
    const result = await db.query(
      `SELECT u.*, 
              c.role as creator_role,
              (c.role = 'SuperAdmin' OR u.role = 'SuperAdmin' OR (u.role IN ('ClientAdmin', 'CompanyAdmin') AND (c.role = 'SuperAdmin' OR u.id = (
                SELECT u_first.id FROM users u_first 
                WHERE u_first.tenant_id = u.tenant_id AND u_first.role IN ('ClientAdmin', 'CompanyAdmin') 
                ORDER BY u_first.created_at ASC LIMIT 1
              )))) as is_created_by_super_admin,
              t.company_name as tenant_name, 
              t.subdomain, 
              t.subscription_plan,
              t.status as tenant_status,
              t.free_business_profile_limit,
              t.free_employee_limit,
              t.tender_limit,
              t.bid_security_limit,
              t.active_modules,
              t.billing_cycle,
              t.custom_base_price,
              t.trial_period,
              t.trial_ends_at,
              t.pending_paid_company_payment,
              t.pending_paid_company_amount,
              t.paid_companies_count,
              (SELECT COUNT(*) FROM business_profiles bp WHERE bp.tenant_id = u.tenant_id) as company_count,
              (SELECT COUNT(*) FROM users emp WHERE emp.tenant_id = u.tenant_id AND emp.role = 'ClientEmployee') as employee_count,
              (SELECT COUNT(*) FROM opportunities opp WHERE opp.tenant_id = u.tenant_id) as tender_count,
              (SELECT COUNT(*) FROM bid_securities bs WHERE bs.tenant_id = u.tenant_id) as cdr_count
       FROM users u
       LEFT JOIN users c ON u.created_by = c.id
       LEFT JOIN tenants t ON u.tenant_id = t.id
       WHERE (u.username IS NOT NULL AND LOWER(TRIM(u.username)) = LOWER(TRIM($1))) 
          OR (u.email IS NOT NULL AND LOWER(TRIM(u.email)) = LOWER(TRIM($1)))
       ORDER BY CASE 
         WHEN u.email IS NOT NULL AND LOWER(TRIM(u.email)) = LOWER(TRIM($1)) THEN 0 
         WHEN u.username IS NOT NULL AND LOWER(TRIM(u.username)) = LOWER(TRIM($1)) THEN 1 
         ELSE 2 
       END, u.created_at DESC
       LIMIT 1`,
      [loginIdentifier]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid username/email or password.' });
    }

    const user = result.rows[0];

    // 3. Verify password hash using bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({ success: false, message: 'Invalid username/email or password.' });
    }

    // 4. Verify user status
    if (user.status !== 'Active') {
      return res.status(403).json({ success: false, message: 'Your account is inactive or suspended. Please contact administrator.' });
    }

    // 5. Generate JWT Token
    const tokenPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
      tenantId: user.tenant_id
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    // 6. Fetch user's assigned business profiles
    let assignedBusinessProfiles = [];
    try {
      const accessRes = await db.query(
        `SELECT business_profile_id FROM user_business_access WHERE user_id = $1`,
        [user.id]
      );
      assignedBusinessProfiles = accessRes.rows.map(r => r.business_profile_id);
    } catch (e) {}

    // 7. Update last login timestamp
    try {
      await db.query(`UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`, [user.id]);
    } catch (e) {}

    // 8. Return successful response with clean user object
    res.json({
      success: true,
      message: 'Login successful.',
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          fullName: user.full_name,
          email: user.email || null,
          role: user.role,
          status: user.status,
          isPrimaryAdmin: Boolean(user.is_primary_admin),
          isCreatedBySuperAdmin: Boolean(user.is_primary_admin || user.is_created_by_super_admin),
          createdBy: user.created_by,
          mustChangePassword: user.must_change_password || false,
          canSeeBiddingPrices: user.can_see_bidding_prices !== false,
          permissions: user.permissions || {},
          assignedBusinessProfiles,
          tenant: user.tenant_id ? {
            id: user.tenant_id,
            name: user.tenant_name,
            subdomain: user.subdomain,
            status: user.tenant_status || 'Active',
            subscriptionPlan: user.subscription_plan || 'Advance',
            freeCompanyLimit: parseInt(user.free_business_profile_limit !== undefined && user.free_business_profile_limit !== null ? user.free_business_profile_limit : (user.subscription_plan === 'Advance' ? 3 : 1), 10),
            freeEmployeeLimit: parseInt(user.free_employee_limit !== undefined && user.free_employee_limit !== null ? user.free_employee_limit : (user.subscription_plan === 'Advance' ? 3 : 1), 10),
            tenderLimit: user.tender_limit || (user.subscription_plan === 'Advance' ? 'unlimited' : '5'),
            bidSecurityLimit: user.bid_security_limit || (user.subscription_plan === 'Advance' ? 'unlimited' : '10'),
            activeModules: user.active_modules || ['mod_tenders', 'mod_quotations', 'mod_bid_security', 'mod_costing_eval', 'mod_supply_dc', 'mod_inventory', 'mod_fbr_invoicing', 'mod_finance_kpi'],
            billingCycle: user.billing_cycle || 'monthly',
            customBasePrice: parseFloat(user.custom_base_price || 35000),
            trialPeriod: user.trial_period || '15 Days',
            trialEndsAt: user.trial_ends_at || null,
            pendingPaidCompanyPayment: Boolean(user.pending_paid_company_payment),
            pendingPaidCompanyAmount: parseFloat(user.pending_paid_company_amount || 0),
            paidCompaniesCount: parseInt(user.paid_companies_count || 0, 10),
            applicationStopped: Boolean(user.pending_paid_company_payment),
            companyCount: parseInt(user.company_count || 0, 10),
            employeeCount: parseInt(user.employee_count || 0, 10),
            tenderCount: parseInt(user.tender_count || 0, 10),
            cdrCount: parseInt(user.cdr_count || 0, 10)
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
 * Public User & Organization Sign-Up Endpoint (/api/auth/register & /api/auth/signup)
 * Creates new Tenant with 15-Day Free Trial, Primary ClientAdmin user, and initial business profile.
 * Automatically signs in user with JWT token for instant access.
 */
const handleRegister = async (req, res) => {
  const { company_name, full_name, email, password, phone } = req.body;
  const cleanCompanyName = (company_name || '').trim();
  const cleanFullName = (full_name || '').trim();
  const cleanEmail = (email || '').trim().toLowerCase();

  if (!cleanCompanyName || !cleanFullName || !cleanEmail || !password) {
    return res.status(400).json({
      success: false,
      message: 'Company name, full name, email address, and password are required.'
    });
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    return res.status(400).json({ success: false, message: 'Please provide a valid email address.' });
  }

  // Password policy validation
  const policyCheck = validatePasswordPolicy(password);
  if (!policyCheck.valid) {
    return res.status(400).json({ success: false, message: policyCheck.message });
  }

  try {
    // 1. Check if email is already registered
    const existingUser = await db.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [cleanEmail]
    );
    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `An account with email '${cleanEmail}' already exists. Please sign in instead.`
      });
    }

    // 2. Generate clean subdomain and unique username
    let baseSubdomain = cleanCompanyName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'workspace';
    let cleanSubdomain = `${baseSubdomain}-${Math.floor(1000 + Math.random() * 9000)}`;

    let baseUsername = cleanEmail.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 25) || 'admin';
    let finalUsername = baseUsername;
    const usernameCheck = await db.query(
      `SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
      [finalUsername]
    );
    if (usernameCheck.rows.length > 0) {
      finalUsername = `${baseUsername}_${Math.floor(100 + Math.random() * 900)}`;
    }

    // 3. 15-Day Free Trial calculation
    const trialEndsAt = new Date(Date.now() + 15 * 86400000);

    // 4. Create new Tenant
    const tenantRes = await db.query(
      `INSERT INTO tenants (
        company_name, subdomain, subscription_plan, 
        free_business_profile_limit, free_employee_limit, 
        trial_period, trial_ends_at, status
       )
       VALUES ($1, $2, 'Standard', 2, 2, '15 Days', $3, 'Active')
       RETURNING *`,
      [cleanCompanyName, cleanSubdomain, trialEndsAt]
    );
    const newTenant = tenantRes.rows[0];

    // 5. Hash password (preserving bcrypt integrity)
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // 6. Create Primary Admin User
    const userRes = await db.query(
      `INSERT INTO users (
        tenant_id, username, full_name, email, password_hash, 
        role, status, must_change_password, can_see_bidding_prices, 
        permissions, is_primary_admin
       )
       VALUES ($1, $2, $3, $4, $5, 'ClientAdmin', 'Active', FALSE, TRUE, '{}'::jsonb, TRUE)
       RETURNING id, username, full_name, email, role, status, is_primary_admin`,
      [newTenant.id, finalUsername, cleanFullName, cleanEmail, passwordHash]
    );
    const newUser = userRes.rows[0];

    // 7. Auto-create initial default business profile for instant workflow
    let createdProfile = null;
    try {
      const bpRes = await db.query(
        `INSERT INTO business_profiles (
          tenant_id, business_name, legal_name, email, phone, city, is_active
         )
         VALUES ($1, $2, $2, $3, $4, 'Pakistan', TRUE)
         RETURNING id, business_name`,
        [newTenant.id, cleanCompanyName, cleanEmail, phone || null]
      );
      createdProfile = bpRes.rows[0];
      if (createdProfile) {
        await db.query(
          `INSERT INTO user_business_access (user_id, business_profile_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [newUser.id, createdProfile.id]
        );
      }
    } catch (bpErr) {
      console.warn('Initial business profile seed warning:', bpErr.message);
    }

    // 8. Generate JWT token for instant access
    const tokenPayload = {
      userId: newUser.id,
      username: newUser.username,
      role: newUser.role,
      tenantId: newTenant.id
    };
    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: '24h' });

    res.status(201).json({
      success: true,
      message: 'Account created successfully! Your 15-day free trial is now active.',
      data: {
        token,
        user: {
          id: newUser.id,
          username: newUser.username,
          fullName: newUser.full_name,
          email: newUser.email,
          role: newUser.role,
          status: newUser.status,
          isPrimaryAdmin: true,
          isCreatedBySuperAdmin: true,
          mustChangePassword: false,
          canSeeBiddingPrices: true,
          permissions: {},
          assignedBusinessProfiles: createdProfile ? [createdProfile.id] : [],
          tenant: {
            id: newTenant.id,
            name: newTenant.company_name,
            subdomain: newTenant.subdomain,
            status: newTenant.status || 'Active',
            subscriptionPlan: newTenant.subscription_plan || 'Standard',
            trialPeriod: '15 Days',
            trialEndsAt: trialEndsAt,
            isTrialActive: true,
            daysRemaining: 15,
            freeCompanyLimit: 2,
            freeEmployeeLimit: 2,
            companyCount: 1,
            employeeCount: 0,
            tenderCount: 0,
            cdrCount: 0
          }
        }
      }
    });
  } catch (err) {
    console.error('Sign-Up Error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create account. Please try again.',
      error: err.message
    });
  }
};

router.post('/register', handleRegister);
router.post('/signup', handleRegister);

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
    // Only SuperAdmin and Primary Client Admin created by Super Admin can change password
    if (req.user.role !== 'SuperAdmin') {
      const userCheck = await db.query(
        `SELECT is_primary_admin, role FROM users WHERE id = $1`,
        [req.user.id]
      );
      if (!userCheck.rows[0]?.is_primary_admin) {
        return res.status(403).json({
          success: false,
          message: 'Security Policy: Sub-users cannot change their own password. Please contact your organization administrator.'
        });
      }
    }

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
              c.role as creator_role,
              (c.role = 'SuperAdmin' OR u.role = 'SuperAdmin' OR (u.role IN ('ClientAdmin', 'CompanyAdmin') AND (c.role = 'SuperAdmin' OR u.id = (
                SELECT u_first.id FROM users u_first 
                WHERE u_first.tenant_id = u.tenant_id AND u_first.role IN ('ClientAdmin', 'CompanyAdmin') 
                ORDER BY u_first.created_at ASC LIMIT 1
              )))) as is_created_by_super_admin,
              t.company_name as tenant_name, t.subdomain, t.subscription_plan,
              t.free_business_profile_limit, t.free_employee_limit,
              t.pending_paid_company_payment, t.pending_paid_company_amount, t.paid_companies_count,
              (SELECT COUNT(*) FROM business_profiles bp WHERE bp.tenant_id = u.tenant_id) as company_count,
              (SELECT COUNT(*) FROM users emp WHERE emp.tenant_id = u.tenant_id AND emp.role = 'ClientEmployee') as employee_count,
              (SELECT COUNT(*) FROM opportunities opp WHERE opp.tenant_id = u.tenant_id) as tender_count,
              (SELECT COUNT(*) FROM bid_securities bs WHERE bs.tenant_id = u.tenant_id) as cdr_count,
              COALESCE(
                json_agg(json_build_object('id', bp.id, 'name', bp.business_name, 'fbr_enabled', bp.fbr_enabled)) 
                FILTER (WHERE bp.id IS NOT NULL), 
                '[]'
              ) as assigned_companies
       FROM users u
       LEFT JOIN users c ON u.created_by = c.id
       LEFT JOIN tenants t ON u.tenant_id = t.id
       LEFT JOIN user_business_access uba ON u.id = uba.user_id
       LEFT JOIN business_profiles bp ON uba.business_profile_id = bp.id
       WHERE u.id = $1
       GROUP BY u.id, u.tenant_id, u.username, u.full_name, u.email, u.role, u.status,
                u.must_change_password, u.can_see_bidding_prices, u.permissions,
                c.role, t.company_name, t.subdomain, t.subscription_plan,
                t.free_business_profile_limit, t.free_employee_limit,
                t.pending_paid_company_payment, t.pending_paid_company_amount, t.paid_companies_count`,
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
        email: user.email || null,
        role: user.role,
        status: user.status,
        isPrimaryAdmin: Boolean(user.is_primary_admin),
        isCreatedBySuperAdmin: Boolean(user.is_primary_admin || user.is_created_by_super_admin),
        createdBy: user.created_by,
        mustChangePassword: user.must_change_password || false,
        canSeeBiddingPrices: user.can_see_bidding_prices !== false,
        permissions: user.permissions || {},
        assignedCompanies: user.assigned_companies || [],
        tenant: user.tenant_id ? {
          id: user.tenant_id,
          name: user.tenant_name,
          subdomain: user.subdomain,
          subscriptionPlan: user.subscription_plan,
          freeCompanyLimit: parseInt(user.free_business_profile_limit || 2, 10),
          freeEmployeeLimit: parseInt(user.free_employee_limit || 2, 10),
          pendingPaidCompanyPayment: Boolean(user.pending_paid_company_payment),
          pendingPaidCompanyAmount: parseFloat(user.pending_paid_company_amount || 0),
          paidCompaniesCount: parseInt(user.paid_companies_count || 0, 10),
          applicationStopped: Boolean(user.pending_paid_company_payment),
          companyCount: parseInt(user.company_count || 0, 10),
          employeeCount: parseInt(user.employee_count || 0, 10),
          tenderCount: parseInt(user.tender_count || 0, 10),
          cdrCount: parseInt(user.cdr_count || 0, 10)
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
 * POST /api/auth/support-request
 * Handles trial expiration subscription activation & general support requests
 */
router.post('/support-request', async (req, res) => {
  const { subject, message, companyName, senderEmail, phone } = req.body;
  const { sendEmail } = require('../services/emailService');

  try {
    const notifyEmail = process.env.SUPER_ADMIN_EMAIL || 'naeem@mashrue.com';
    const fallbackEmail = process.env.SMTP_USER || 'mashruebms@gmail.com';
    const subTitle = subject || `[Mashrue Subscription Request] ${companyName || 'Trial Tenant'}`;

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 24px; color: #0f172a; max-width: 600px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
        <div style="border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 16px;">
          <h2 style="color: #2563eb; margin: 0 0 6px;">Enterprise Subscription Request</h2>
          <span style="font-size: 13px; color: #64748b;">Source: Free Trial Expiry / Commercial Portal</span>
        </div>
        <p style="margin: 8px 0;"><strong>Company / Tenant:</strong> ${companyName || 'Not specified'}</p>
        <p style="margin: 8px 0;"><strong>User Contact:</strong> ${senderEmail || 'N/A'}</p>
        <p style="margin: 8px 0;"><strong>Phone:</strong> ${phone || 'N/A'}</p>
        <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 16px; border-radius: 8px; margin: 16px 0; font-size: 14px; line-height: 1.6;">
          ${message || 'The user has requested subscription activation following the completion of their 15-day free trial.'}
        </div>
        <p style="font-size: 12px; color: #94a3b8; margin-top: 20px;">
          Mashrue Enterprise BMS • Automated Dispatch System
        </p>
      </div>
    `;

    await sendEmail({
      to: [notifyEmail, fallbackEmail],
      subject: subTitle,
      html: htmlContent,
      text: `Subscription Request\nCompany: ${companyName}\nUser: ${senderEmail}\nMessage:\n${message}`
    }).catch(e => console.warn('Support email notification dispatch error:', e.message));

    res.json({ success: true, message: 'Your subscription activation request has been dispatched to support@mashrue.com.' });
  } catch (err) {
    console.error('Support request error:', err);
    res.json({ success: true, message: 'Request recorded.' });
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
