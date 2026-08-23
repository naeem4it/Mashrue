const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');

/**
 * GET all business profiles under active tenant
 * Strict Tenant Isolation: Only returns companies belonging to the user's tenant.
 * If user is a Client Employee with restricted company access, filters accordingly.
 */
router.get('/', optionalAuth, async (req, res) => {
  try {
    let queryText = `
      SELECT bp.*, 
             t.company_name as tenant_company_name,
             t.free_business_profile_limit,
             t.additional_profile_monthly_fee
      FROM business_profiles bp
      JOIN tenants t ON bp.tenant_id = t.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND bp.tenant_id::text = $${params.length}`;

        // If Client Employee has restricted company list
        if (req.user.role === 'ClientEmployee' && req.user.assignedBusinessProfiles && req.user.assignedBusinessProfiles.length > 0) {
          params.push(req.user.assignedBusinessProfiles);
          queryText += ` AND bp.id = ANY($${params.length}::uuid[])`;
        }
      }
    } else {
      return res.json({ success: true, data: [], meta: { totalProfiles: 0, freeLimit: 2, isWithinFreeLimit: true, extraProfilesCount: 0, monthlyExtraCharges: 0 } });
    }

    queryText += ` ORDER BY bp.created_at ASC`;

    const result = await db.query(queryText, params);
    
    const count = result.rows.length;
    const freeLimit = result.rows[0]?.free_business_profile_limit || 2;
    const additionalFee = result.rows[0]?.additional_profile_monthly_fee || 2500.00;

    res.json({
      success: true,
      data: result.rows,
      meta: {
        totalProfiles: count,
        freeLimit: freeLimit,
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
 * Business Rule: Up to 2 companies free; 3rd+ requires payment confirmation
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
    confirm_paid
  } = req.body;

  if (!business_name || !legal_name || !ntn || !strn) {
    return res.status(400).json({ success: false, message: 'Business Name, Legal Name, NTN, and STRN are mandatory' });
  }

  const cleanNtn = String(ntn).replace(/[^0-9]/g, '');
  const cleanStrn = String(strn).replace(/[^0-9]/g, '');

  try {
    let tenantId = req.user.tenantId;

    if (req.user.role === 'SuperAdmin') {
      const defaultTenant = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = req.body.tenant_id || defaultTenant.rows[0]?.id;
    }

    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'No valid tenant associated with this request.' });
    }

    const tenantRes = await db.query(`SELECT * FROM tenants WHERE id = $1`, [tenantId]);
    const tenant = tenantRes.rows[0];
    const freeLimit = tenant?.free_business_profile_limit || 2;
    const fee = tenant?.additional_profile_monthly_fee || 2500.00;

    // Count existing profiles for this tenant
    const countRes = await db.query(`SELECT COUNT(*) FROM business_profiles WHERE tenant_id = $1`, [tenantId]);
    const existingCount = parseInt(countRes.rows[0].count, 10);

    // If exceeding freeLimit companies and not confirmed, prompt for paid confirmation
    if (existingCount >= freeLimit && !confirm_paid && req.user.role !== 'SuperAdmin') {
      return res.status(402).json({
        success: false,
        requires_payment_confirmation: true,
        message: `Free company limit (${freeLimit}) reached. Creating this company will add PKR ${parseFloat(fee).toLocaleString()}/month to your subscription.`,
        currentCount: existingCount,
        freeLimit,
        additionalMonthlyFee: fee
      });
    }

    let billingNotice = null;
    if (existingCount >= freeLimit) {
      billingNotice = {
        notice: `Plan Notice: You have exceeded the ${freeLimit} free company profile limit.`,
        chargePerMonth: `PKR ${fee}/month`,
        status: 'Subscription Add-On Applied'
      };
    }

    const result = await db.query(
      `INSERT INTO business_profiles 
       (tenant_id, business_name, legal_name, abbreviation, ntn, strn, cnic, address, city, email, phone, fbr_enabled, invoice_prefix, po_prefix, dc_prefix)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        tenantId,
        business_name,
        legal_name,
        abbreviation || null,
        cleanNtn || null,
        cleanStrn || null,
        cnic || null,
        address || null,
        city || 'Lahore',
        email || null,
        phone || null,
        Boolean(fbr_enabled),
        invoice_prefix || 'INV',
        po_prefix || 'PO',
        dc_prefix || 'DC'
      ]
    );

    const createdProfile = result.rows[0];

    // If user is ClientAdmin, ensure they have access to this new business profile
    await db.query(
      `INSERT INTO user_business_access (user_id, business_profile_id)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.user.id, createdProfile.id]
    );

    res.status(201).json({
      success: true,
      data: createdProfile,
      billingNotice: billingNotice,
      nextStep: createdProfile.fbr_enabled ? 'fbr_config' : 'dashboard',
      message: 'Business Profile registered successfully'
    });
  } catch (err) {
    console.error('Create Business Profile Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update business profile
router.put('/:id', authenticate, async (req, res) => {
  const { id } = req.params;
  const { business_name, legal_name, abbreviation, ntn, strn, cnic, address, city, email, phone, fbr_enabled, invoice_prefix, po_prefix, dc_prefix } = req.body;

  const cleanNtn = ntn ? String(ntn).replace(/[^0-9]/g, '') : null;
  const cleanStrn = strn ? String(strn).replace(/[^0-9]/g, '') : null;

  try {
    let queryText = `
      UPDATE business_profiles
      SET business_name = COALESCE($1, business_name),
          legal_name = COALESCE($2, legal_name),
          abbreviation = COALESCE($3, abbreviation),
          ntn = COALESCE($4, ntn),
          strn = COALESCE($5, strn),
          cnic = COALESCE($6, cnic),
          address = COALESCE($7, address),
          city = COALESCE($8, city),
          email = COALESCE($9, email),
          phone = COALESCE($10, phone),
          fbr_enabled = COALESCE($11, fbr_enabled),
          invoice_prefix = COALESCE($12, invoice_prefix),
          po_prefix = COALESCE($13, po_prefix),
          dc_prefix = COALESCE($14, dc_prefix),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $15
    `;
    const params = [business_name, legal_name, abbreviation, cleanNtn, cleanStrn, cnic, address, city, email, phone, fbr_enabled, invoice_prefix, po_prefix, dc_prefix, id];

    if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND tenant_id::text = $${params.length}`;
    }

    queryText += ` RETURNING *`;

    const result = await db.query(queryText, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Business Profile not found or unauthorized' });
    }

    res.json({ success: true, data: result.rows[0], message: 'Business Profile updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
