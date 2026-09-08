const { requirePermission, resolveTenantId, sanitizePrices, requireRoles } = require('../middleware/rbac.middleware');
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');

// GET all bid securities optionally filtered by opportunity_id or status
router.get('/', authenticate, requirePermission('bid_securities', 'view'), async (req, res) => {
  const { opportunity_id, business_profile_id, status } = req.query;

  try {
    let queryText = `
      SELECT bs.*, 
             o.opportunity_number, o.tender_name, o.title as tender_title, o.tender_source,
             bp.business_name,
             c.business_name as customer_name
      FROM bid_securities bs
      LEFT JOIN opportunities o ON bs.opportunity_id = o.id
      LEFT JOIN business_profiles bp ON bs.business_profile_id = bp.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE 1=1
    `;
    const params = [];

    // Tenant Isolation
    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND bs.tenant_id::text = $${params.length}`;

        if (req.user.role === 'ClientEmployee' && req.user.assignedBusinessProfiles && req.user.assignedBusinessProfiles.length > 0) {
          params.push(req.user.assignedBusinessProfiles);
          queryText += ` AND bs.business_profile_id = ANY($${params.length}::uuid[])`;
        }
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    if (opportunity_id) {
      params.push(String(opportunity_id));
      queryText += ` AND bs.opportunity_id::text = $${params.length}`;
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(String(business_profile_id));
      queryText += ` AND (bs.business_profile_id::text = $${params.length} OR o.business_profile_id::text = $${params.length})`;
    }

    if (status && status !== 'all') {
      params.push(status);
      queryText += ` AND LOWER(bs.status) = LOWER($${params.length})`;
    }

    queryText += ` ORDER BY bs.expiry_date ASC, bs.created_at DESC`;

    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper for safe date parsing
function parseSafeDateInput(dStr) {
  if (!dStr) return null;
  if (dStr instanceof Date) return dStr;
  const str = String(dStr).trim();
  if (str.includes('/')) {
    const parts = str.split('/');
    if (parts.length === 3) {
      // DD/MM/YYYY
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
  return str;
}

// POST create new Bid Security
// Mandatory: 1. Account Title, 2. Beneficiary, 3. Instrument Type, 4. Instrument Number, 5. Amount, 6. Expiry Date
router.post('/', authenticate, requirePermission('bid_securities', 'add'), async (req, res) => {
  const {
    business_profile_id,
    opportunity_id,
    bid_id,
    account_title,
    beneficiary,
    instrument_type,
    instrument_number,
    amount,
    issue_date,
    expiry_date,
    bank_name,
    bank_branch,
    comments
  } = req.body;

  // Validate 6 mandatory fields
  if (!account_title || !beneficiary || !instrument_type || !instrument_number || !amount || !expiry_date) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error: Account Title, Beneficiary, Instrument Type (PO/CDR), Instrument Number, Amount, and Expiry Date are all mandatory.'
    });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    // Verify opportunity and resolve business_profile_id safely
    let targetBizProfileId = business_profile_id;
    if (!targetBizProfileId && opportunity_id) {
      try {
        const oppRes = await db.query(`SELECT business_profile_id, tenant_id FROM opportunities WHERE id::text = $1`, [String(opportunity_id)]);
        if (oppRes.rows.length > 0) {
          targetBizProfileId = oppRes.rows[0]?.business_profile_id;
          if ((!tenantId || tenantId === 'a0000000-0000-0000-0000-000000000001') && oppRes.rows[0]?.tenant_id) {
            tenantId = oppRes.rows[0].tenant_id;
          }
        }
      } catch (e) {}
    }

    let cleanOppId = null;
    if (opportunity_id) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(opportunity_id).trim());
      if (isUuid) {
        cleanOppId = String(opportunity_id).trim();
      } else {
        console.warn('[BID SECURITY CREATE WARNING]: Invalid non-UUID opportunity_id received:', opportunity_id);
        return res.status(400).json({
          success: false,
          message: `Invalid opportunity ID format: "${opportunity_id}". Must be a valid PostgreSQL UUID.`
        });
      }
    }

    // If still null, find the first business profile for this tenant
    if (!targetBizProfileId) {
      try {
        const bpRes = await db.query(`SELECT id FROM business_profiles WHERE tenant_id::text = $1 ORDER BY created_at ASC LIMIT 1`, [String(tenantId)]);
        targetBizProfileId = bpRes.rows[0]?.id;
      } catch (e) {}
    }

    // Enforce dynamic Bid Security / CDR quota leverage according to subscription
    if (req.user?.role !== 'SuperAdmin') {
      try {
        const tenantRow = await db.query(`SELECT subscription_plan, bid_security_limit, status FROM tenants WHERE id = $1`, [tenantId]);
        if (tenantRow.rows.length > 0) {
          const tnt = tenantRow.rows[0];
          if (tnt.status === 'Suspended') {
            return res.status(403).json({ success: false, message: 'Your organization workspace is suspended due to pending subscription payment.' });
          }
          const bsLimit = tnt.bid_security_limit;
          const isUnlimited = (bsLimit === 'unlimited' || bsLimit === -1 || bsLimit === null || bsLimit === 'Unlimited' || tnt.subscription_plan === 'Advance' || tnt.subscription_plan === 'Enterprise');
          if (!isUnlimited) {
            const maxAllowed = parseInt(bsLimit, 10) || 10;
            const countRes = await db.query(`SELECT COUNT(*) FROM bid_securities WHERE tenant_id = $1`, [tenantId]);
            const currentCount = parseInt(countRes.rows[0]?.count || 0, 10);
            if (currentCount >= maxAllowed) {
              return res.status(402).json({
                success: false,
                quotaExceeded: true,
                message: `Bid Security Quota Reached: Your organization subscription package allows ${maxAllowed} Bid Securities / CDRs (${currentCount} registered). Please upgrade your subscription plan or contact administrator.`
              });
            }
          }
        }
      } catch (quotaErr) {
        console.warn('Bid security quota check warning:', quotaErr.message);
      }
    }

    // If still null, fallback to any available business profile in the system
    if (!targetBizProfileId) {
      try {
        const anyBp = await db.query(`SELECT id FROM business_profiles ORDER BY created_at ASC LIMIT 1`);
        targetBizProfileId = anyBp.rows[0]?.id;
      } catch (e) {}
    }

    const cleanIssueDate = parseSafeDateInput(issue_date) || new Date();
    // In Pakistani banking, CDRs are valid for 90 or 120 days. Ensure not-null constraint is satisfied.
    const cleanExpiryDate = parseSafeDateInput(expiry_date) || new Date(cleanIssueDate.getTime() + 90 * 86400000);

    const result = await db.query(
      `INSERT INTO bid_securities 
       (tenant_id, business_profile_id, opportunity_id, bid_id, account_title, beneficiary, instrument_type, instrument_number, amount, issue_date, expiry_date, bank_name, bank_branch, status, comments)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        tenantId,
        targetBizProfileId,
        cleanOppId,
        bid_id || null,
        account_title,
        beneficiary,
        instrument_type,
        instrument_number,
        parseFloat(amount),
        cleanIssueDate,
        cleanExpiryDate,
        bank_name || null,
        bank_branch || null,
        'Active',
        comments || null
      ]
    );

    // Also update tender status to 'Ready to submit' if tender was in New / Selected / Under Review / Bid Preparation
    if (cleanOppId) {
      try {
        await db.query(
          `UPDATE opportunities 
           SET status = 'Ready to submit', updated_at = CURRENT_TIMESTAMP 
           WHERE id::text = $1 AND status IN ('New', 'Selected', 'Under Review', 'Bid Preparation', 'Under Evaluation')`,
          [String(cleanOppId)]
        );
      } catch (e) {}
    }

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Bid Security attached successfully. Tender is now Ready to Submit.'
    });
  } catch (err) {
    console.error('[BID SECURITY CREATE ERROR]:', err);
    res.status(500).json({ success: false, error: err.message, message: `Database error saving bid security: ${err.message}` });
  }
});

// POST release Bid Security (for won after PG/contract, or for lost/withdraw/rejected)
router.post('/:id/release', authenticate, requirePermission('bid_securities', 'edit'), async (req, res) => {
  const { release_date, release_reference, comments } = req.body;

  try {
    const result = await db.query(
      `UPDATE bid_securities 
       SET status = 'Released', 
           release_date = $1, 
           release_reference = $2, 
           comments = COALESCE(comments, '') || ' | ' || $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [release_date || new Date(), release_reference || 'Handover Letter', comments || 'Released to client file', req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bid Security record not found' });
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Bid Security has been successfully marked as RELEASED.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update Bid Security details
router.put('/:id', authenticate, requirePermission('bid_securities', 'edit'), async (req, res) => {
  const {
    account_title,
    beneficiary,
    instrument_type,
    instrument_number,
    amount,
    expiry_date,
    bank_name,
    bank_branch,
    status,
    department_diary_number,
    recovery_letter_date,
    recovery_letter_ref,
    comments
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE bid_securities
       SET account_title = COALESCE($1, account_title),
           beneficiary = COALESCE($2, beneficiary),
           instrument_type = COALESCE($3, instrument_type),
           instrument_number = COALESCE($4, instrument_number),
           amount = COALESCE($5, amount),
           expiry_date = COALESCE($6, expiry_date),
           bank_name = COALESCE($7, bank_name),
           bank_branch = COALESCE($8, bank_branch),
           status = COALESCE($9, status),
           department_diary_number = COALESCE($10, department_diary_number),
           recovery_letter_date = COALESCE($11, recovery_letter_date),
           recovery_letter_ref = COALESCE($12, recovery_letter_ref),
           comments = COALESCE($13, comments),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $14
       RETURNING *`,
      [
        account_title || null,
        beneficiary || null,
        instrument_type || null,
        instrument_number || null,
        amount !== undefined ? parseFloat(amount) : null,
        expiry_date || null,
        bank_name || null,
        bank_branch || null,
        status || null,
        department_diary_number || null,
        recovery_letter_date || null,
        recovery_letter_ref || null,
        comments || null,
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bid Security record not found' });
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Bid Security updated successfully'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET generate official CDR refund / return request letter
router.get('/:id/recovery-letter', authenticate, requirePermission('bid_securities', 'view'), async (req, res) => {
  try {
    const result = await db.query(
      `SELECT bs.*, 
              o.opportunity_number, o.tender_name, o.title as tender_title, o.tender_source, o.status as tender_status,
              bp.business_name, bp.legal_name, bp.address as bp_address, bp.ntn as bp_ntn,
              c.business_name as procuring_agency, c.department_name
       FROM bid_securities bs
       JOIN opportunities o ON bs.opportunity_id = o.id
       JOIN business_profiles bp ON bs.business_profile_id = bp.id
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE bs.id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bid Security record not found' });
    }

    const row = result.rows[0];
    const letterRef = `REF/${row.business_name.substring(0, 3).toUpperCase()}/CDR-RET/${Date.now().toString().slice(-5)}`;
    
    // Automatically update recovery letter metadata
    await db.query(
      `UPDATE bid_securities SET recovery_letter_date = CURRENT_DATE, recovery_letter_ref = $1 WHERE id = $2`,
      [letterRef, req.params.id]
    );

    res.json({
      success: true,
      data: {
        letterReference: letterRef,
        date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }),
        recipient: {
          title: 'The Purchase / Procurement Officer',
          department: row.department_name || row.procuring_agency || 'Procuring Authority',
          organization: row.procuring_agency || 'Government Department'
        },
        sender: {
          companyName: row.legal_name || row.business_name,
          address: row.bp_address || 'Pakistan',
          ntn: row.bp_ntn
        },
        subject: `APPLICATION FOR RELEASE / RETURN OF EARNEST MONEY (BID SECURITY) - TENDER NO: ${row.opportunity_number}`,
        tenderDetails: {
          tenderNumber: row.opportunity_number,
          tenderName: row.tender_name || row.tender_title,
          instrumentType: row.instrument_type,
          instrumentNumber: row.instrument_number,
          bankName: row.bank_name,
          amountPKR: row.amount,
          issueDate: row.issue_date,
          expiryDate: row.expiry_date,
          diaryReference: row.department_diary_number || 'Under Department Diary'
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
