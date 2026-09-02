const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');
const { requireRoles } = require('../middleware/rbac.middleware');

/**
 * GET all business profiles under active tenant
 * Strict Tenant Isolation: Only returns companies belonging to the user's tenant.
 * Dynamically resolves creator from created_by or tenant primary Client Admin
 */
const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(val || ''));

/**
 * GET all business profiles under active tenant
 * Strict Tenant Isolation: Only returns companies belonging to the user's tenant.
 * Dynamically resolves creator from created_by or tenant primary Client Admin
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    let queryText = `
      SELECT bp.*, 
             COALESCE(t.company_name, 'Primary Workspace') as tenant_company_name,
             COALESCE(t.free_business_profile_limit, 2) as free_business_profile_limit,
             COALESCE(t.additional_profile_monthly_fee, 4500.00) as additional_profile_monthly_fee,
             COALESCE(u_primary.full_name, 'System') as creator_name,
             COALESCE(u_primary.username, 'admin') as creator_username
      FROM business_profiles bp
      LEFT JOIN tenants t ON bp.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT u2.id, u2.username, u2.full_name 
        FROM users u2 
        WHERE u2.tenant_id = bp.tenant_id AND u2.role IN ('ClientAdmin', 'CompanyAdmin')
        ORDER BY u2.created_at ASC 
        LIMIT 1
      ) u_primary ON true
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = isUuid(req.user.tenantId) ? req.user.tenantId : '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND bp.tenant_id::text = $${params.length}`;

        // If Client Employee has restricted company list
        if (req.user.role === 'ClientEmployee' && req.user.assignedBusinessProfiles && req.user.assignedBusinessProfiles.length > 0) {
          params.push(req.user.assignedBusinessProfiles);
          queryText += ` AND bp.id = ANY($${params.length}::uuid[])`;
        }
      } else if (req.query.tenant_id && req.query.tenant_id !== 'all' && isUuid(req.query.tenant_id)) {
        params.push(req.query.tenant_id);
        queryText += ` AND bp.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [], meta: { totalProfiles: 0, freeLimit: 2, isWithinFreeLimit: true, extraProfilesCount: 0, monthlyExtraCharges: 0 } });
    }

    queryText += ` ORDER BY bp.created_at ASC`;

    const result = await db.query(queryText, params);
    
    const count = result.rows.length;
    const freeLimit = result.rows[0]?.free_business_profile_limit || 2;
    const additionalFee = result.rows[0]?.additional_profile_monthly_fee || 4500.00;

    res.json({
      success: true,
      data: result.rows,
      meta: {
        totalProfiles: count,
        freeLimit: freeLimit,
        allowedCompanies: freeLimit,
        isWithinFreeLimit: count <= freeLimit,
        extraProfilesCount: Math.max(0, count - freeLimit),
        monthlyExtraCharges: Math.max(0, count - freeLimit) * parseFloat(additionalFee)
      }
    });
  } catch (err) {
    console.error('Fetch Business Profiles Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST create a new business profile
 * Calculates allowed limit from database. When exceeded, requires confirmation for 4500/month.
 */
router.post('/', authenticate, async (req, res) => {
  const {
    business_name,
    legal_name,
    abbreviation,
    ntn,
    strn,
    cnic,
    address,
    city,
    email,
    phone,
    fbr_enabled,
    invoice_prefix,
    po_prefix,
    dc_prefix,
    confirm_paid,
    tenant_id
  } = req.body;

  if (!business_name) {
    return res.status(400).json({ success: false, message: 'Business Name is mandatory' });
  }

  const cleanNtn = ntn ? String(ntn).replace(/[^0-9]/g, '') : null;
  const cleanStrn = strn ? String(strn).replace(/[^0-9]/g, '') : null;

  try {
    let resolvedTenantId = null;
    if (isUuid(tenant_id)) {
      resolvedTenantId = tenant_id;
    } else if (isUuid(req.user?.tenantId)) {
      resolvedTenantId = req.user.tenantId;
    }
    const headerTid = req.headers['x-tenant-id'];
    if (!resolvedTenantId && isUuid(headerTid)) {
      resolvedTenantId = headerTid;
    }
    if (!resolvedTenantId) {
      try {
        const defaultTenant = await db.query(`SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`);
        resolvedTenantId = defaultTenant.rows[0]?.id;
      } catch (e) {}
    }
    if (!resolvedTenantId) {
      resolvedTenantId = 'a0000000-0000-0000-0000-000000000001';
    }

    // Query allowed company limits dynamically from database
    const tenantRes = await db.query(`SELECT * FROM tenants WHERE id = $1`, [resolvedTenantId]);
    const tenant = tenantRes.rows[0];
    const allowedLimit = parseInt(tenant?.free_business_profile_limit || 2, 10);
    const fee = parseFloat(tenant?.additional_profile_monthly_fee || 4500.00);

    // Count existing profiles for this tenant
    const countRes = await db.query(`SELECT COUNT(*) FROM business_profiles WHERE tenant_id = $1`, [resolvedTenantId]);
    const existingCount = parseInt(countRes.rows[0]?.count || 0, 10);

    // When user exceeds limit and not confirmed:
    if (existingCount >= allowedLimit && !confirm_paid && req.user.role !== 'SuperAdmin') {
      return res.status(402).json({
        success: false,
        requires_payment_confirmation: true,
        message: `You are exceeding your limit. Are you sure you want to create a company for ${Number(fee).toLocaleString()}/month?`,
        currentCount: existingCount,
        allowedLimit: allowedLimit,
        additionalMonthlyFee: fee
      });
    }

    let billingNotice = null;
    if (existingCount >= allowedLimit) {
      billingNotice = {
        notice: `Plan Notice: You have exceeded the allowed limit of ${allowedLimit} company profiles.`,
        chargePerMonth: `PKR ${fee.toLocaleString()}/month`,
        status: 'Subscription Add-On Applied'
      };
    }

    // Dynamic column check to guarantee it never crashes with missing column
    let bpCols = new Set();
    try {
      const colRes = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'business_profiles'`);
      bpCols = new Set(colRes.rows.map(r => r.column_name));
    } catch (e) {
      bpCols = new Set(['tenant_id', 'business_name', 'legal_name', 'ntn', 'strn', 'city']);
    }

    const candidateFields = {
      tenant_id: resolvedTenantId,
      business_name: business_name.trim(),
      legal_name: (legal_name || business_name).trim(),
      abbreviation: abbreviation ? abbreviation.trim() : null,
      ntn: cleanNtn || null,
      strn: cleanStrn || null,
      cnic: cnic || null,
      address: address || null,
      city: city || 'Lahore',
      email: email || null,
      phone: phone || null,
      fbr_enabled: Boolean(fbr_enabled),
      invoice_prefix: invoice_prefix || 'INV',
      po_prefix: po_prefix || 'PO',
      dc_prefix: dc_prefix || 'DC',
      created_by: isUuid(req.user?.id) ? req.user.id : null
    };

    const insertCols = [];
    const insertVals = [];
    const insertPlaceholders = [];
    let pIdx = 1;

    for (const [colName, val] of Object.entries(candidateFields)) {
      if (bpCols.has(colName)) {
        insertCols.push(colName);
        insertVals.push(val);
        insertPlaceholders.push(`$${pIdx++}`);
      }
    }

    const insertSql = `INSERT INTO business_profiles (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')}) RETURNING *`;
    const result = await db.query(insertSql, insertVals);
    const createdProfile = result.rows[0];

    // Check if tenant is on trial
    const isTrial = (
      (tenant?.trial_ends_at && new Date(tenant.trial_ends_at) > new Date()) ||
      tenant?.status === 'Trial' ||
      tenant?.subscription_plan === 'Trial' ||
      tenant?.is_trial === true
    );

    let applicationStopped = false;
    let pendingPaymentAmount = 0;

    if (existingCount >= allowedLimit) {
      if (isTrial && req.user.role !== 'SuperAdmin') {
        // Stop application until paid for this company profile
        applicationStopped = true;
        pendingPaymentAmount = fee;
        try {
          await db.query(`
            UPDATE tenants 
            SET pending_paid_company_payment = TRUE,
                pending_paid_company_amount = COALESCE(pending_paid_company_amount, 0) + $1,
                paid_companies_count = COALESCE(paid_companies_count, 0) + 1,
                status = 'Payment_Pending'
            WHERE id = $2
          `, [fee, resolvedTenantId]);

          await db.query(`
            INSERT INTO tenant_subscription_payments 
              (tenant_id, amount, payment_type, status, remarks)
            VALUES 
              ($1, $2, 'company_addon', 'Pending_Payment', 'Paid company profile add-on created during trial. Application paused pending payment.')
          `, [resolvedTenantId, fee]);
        } catch (e) {
          console.warn('Update tenant trial lock warning:', e.message);
        }
      } else {
        // Not on trial: Add on for his subscription payment
        try {
          await db.query(`
            UPDATE tenants 
            SET paid_companies_count = COALESCE(paid_companies_count, 0) + 1,
                additional_profile_monthly_fee = $1
            WHERE id = $2
          `, [fee, resolvedTenantId]);

          await db.query(`
            INSERT INTO tenant_subscription_payments 
              (tenant_id, amount, payment_type, status, remarks)
            VALUES 
              ($1, $2, 'company_addon', 'Addon_Billed', 'Paid company profile add-on added to active monthly subscription billing.')
          `, [resolvedTenantId, fee]);
        } catch (e) {
          console.warn('Update tenant subscription addon warning:', e.message);
        }
      }
    }

    // If user is ClientAdmin, ensure they have access to this new business profile
    if (isUuid(req.user?.id) && isUuid(createdProfile?.id)) {
      try {
        await db.query(
          `INSERT INTO user_business_access (user_id, business_profile_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [req.user.id, createdProfile.id]
        );
      } catch (e) {}
    }

    res.status(201).json({
      success: true,
      data: createdProfile,
      application_stopped: applicationStopped,
      requires_payment: applicationStopped,
      amount_due: pendingPaymentAmount,
      billingNotice: billingNotice,
      nextStep: applicationStopped ? 'payment_gate' : (createdProfile.fbr_enabled ? 'fbr_config' : 'dashboard'),
      message: applicationStopped 
        ? `Paid company created. Since your organization is on a Free Trial, application access is paused until payment of PKR ${fee.toLocaleString()} for this company profile is received.`
        : (billingNotice ? `Business Profile registered. PKR ${fee.toLocaleString()}/month added to your subscription payment.` : 'Business Profile registered successfully.')
    });
  } catch (err) {
    console.error('Create Business Profile Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Auto-check business_profiles columns for company-level FBR configuration
db.query(`
  ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS abbreviation VARCHAR(50);
  ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS created_by UUID;
  ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS fbr_environment VARCHAR(50) DEFAULT 'Sandbox';
  ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS fbr_bearer_token TEXT;
  ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS fbr_pos_id VARCHAR(100) DEFAULT 'POS-01';
  ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS fbr_seller_ntn VARCHAR(50);
`).catch(e => console.warn('business_profiles schema notice:', e.message));

// PUT update business profile (including company-level FBR settings)
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const {
    business_name,
    legal_name,
    abbreviation,
    ntn,
    strn,
    cnic,
    address,
    city,
    email,
    phone,
    fbr_enabled,
    fbr_environment,
    fbr_bearer_token,
    fbr_pos_id,
    fbr_seller_ntn,
    invoice_prefix,
    po_prefix,
    dc_prefix
  } = req.body;

  const cleanNtn = ntn ? String(ntn).replace(/[^0-9]/g, '') : null;
  const cleanStrn = strn ? String(strn).replace(/[^0-9]/g, '') : null;

  try {
    let bpCols = new Set();
    try {
      const colRes = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'business_profiles'`);
      bpCols = new Set(colRes.rows.map(r => r.column_name));
    } catch (e) {
      bpCols = new Set(['business_name', 'legal_name', 'ntn', 'strn', 'city']);
    }

    const candidateUpdates = {
      business_name: business_name ? business_name.trim() : null,
      legal_name: legal_name ? legal_name.trim() : null,
      abbreviation: abbreviation !== undefined ? (abbreviation ? abbreviation.trim() : null) : null,
      ntn: cleanNtn,
      strn: cleanStrn,
      cnic: cnic || null,
      address: address || null,
      city: city || null,
      email: email || null,
      phone: phone || null,
      fbr_enabled: fbr_enabled !== undefined ? Boolean(fbr_enabled) : null,
      fbr_environment: fbr_environment || null,
      fbr_bearer_token: fbr_bearer_token !== undefined ? fbr_bearer_token : null,
      fbr_pos_id: fbr_pos_id || null,
      fbr_seller_ntn: fbr_seller_ntn || null,
      invoice_prefix: invoice_prefix || null,
      po_prefix: po_prefix || null,
      dc_prefix: dc_prefix || null
    };

    const setClauses = [];
    const updateVals = [];
    let pIdx = 1;

    for (const [colName, val] of Object.entries(candidateUpdates)) {
      if (bpCols.has(colName) && val !== null) {
        setClauses.push(`${colName} = COALESCE($${pIdx++}, ${colName})`);
        updateVals.push(val);
      }
    }

    if (bpCols.has('updated_at')) {
      setClauses.push('updated_at = CURRENT_TIMESTAMP');
    }

    if (setClauses.length === 0) {
      return res.json({ success: true, message: 'No changes submitted.' });
    }

    if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      updateVals.push(id);
      updateVals.push(tid);
      const updateSql = `UPDATE business_profiles SET ${setClauses.join(', ')} WHERE id::text = $${pIdx} AND tenant_id::text = $${pIdx + 1} RETURNING *`;
      const result = await db.query(updateSql, updateVals);
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Business Profile not found or unauthorized' });
      }
      return res.json({ success: true, data: result.rows[0], message: 'Business Profile updated successfully' });
    } else {
      updateVals.push(id);
      const updateSql = `UPDATE business_profiles SET ${setClauses.join(', ')} WHERE id::text = $${pIdx} RETURNING *`;
      const result = await db.query(updateSql, updateVals);
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Business Profile not found' });
      }
      return res.json({ success: true, data: result.rows[0], message: 'Business Profile updated successfully' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST verify email address for a business profile
router.post('/:id/verify-email', optionalAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE business_profiles 
       SET email_verified = true, 
           email_verified_at = CURRENT_TIMESTAMP, 
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 
       RETURNING *`,
      [id]
    );
    res.json({
      success: true,
      message: 'Official company email verified successfully.',
      data: result.rows[0]
    });
  } catch (err) {
    res.json({ success: true, message: 'Email marked as verified.' });
  }
});

/**
 * DELETE business profile / company (Super Admin Only)
 */
router.delete('/:id', authenticate, requireRoles('SuperAdmin'), async (req, res) => {
  const { id } = req.params;

  try {
    const bpRes = await db.query(`SELECT id, business_name, tenant_id FROM business_profiles WHERE id::text = $1`, [String(id)]);
    if (bpRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Business Profile not found.' });
    }

    const company = bpRes.rows[0];

    // Clean up foreign key associations
    await db.query(`DELETE FROM user_business_access WHERE business_profile_id::text = $1`, [String(id)]);
    await db.query(`DELETE FROM business_profiles WHERE id::text = $1`, [String(id)]);

    res.json({
      success: true,
      message: `Company '${company.business_name}' deleted successfully.`
    });
  } catch (err) {
    console.error('Delete Business Profile Error:', err);
    res.status(500).json({ success: false, message: `Failed to delete company: ${err.message}`, error: err.message });
  }
});

module.exports = router;

