const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { optionalAuth } = require('../middleware/auth.middleware');

// GET all bid securities optionally filtered by opportunity_id or status
router.get('/', optionalAuth, async (req, res) => {
  const { opportunity_id, business_profile_id, status } = req.query;

  try {
    let queryText = `
      SELECT bs.*, 
             o.opportunity_number, o.tender_name, o.title as tender_title, o.tender_source,
             bp.business_name,
             c.business_name as customer_name
      FROM bid_securities bs
      JOIN opportunities o ON bs.opportunity_id = o.id
      JOIN business_profiles bp ON bs.business_profile_id = bp.id
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
      params.push(opportunity_id);
      queryText += ` AND bs.opportunity_id = $${params.length}`;
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      queryText += ` AND bs.business_profile_id = $${params.length}`;
    }

    if (status && status !== 'all') {
      params.push(status);
      queryText += ` AND bs.status = $${params.length}`;
    }

    queryText += ` ORDER BY bs.expiry_date ASC, bs.created_at DESC`;

    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create new Bid Security
// Mandatory: 1. Account Title, 2. Beneficiary, 3. Instrument Type, 4. Instrument Number, 5. Amount, 6. Expiry Date
router.post('/', optionalAuth, async (req, res) => {
  const {
    opportunity_id,
    business_profile_id,
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

    // Verify opportunity
    let targetBizProfileId = business_profile_id;
    if (!targetBizProfileId) {
      const oppRes = await db.query(`SELECT business_profile_id FROM opportunities WHERE id = $1`, [opportunity_id]);
      targetBizProfileId = oppRes.rows[0]?.business_profile_id;
    }

    const result = await db.query(
      `INSERT INTO bid_securities 
       (tenant_id, business_profile_id, opportunity_id, bid_id, account_title, beneficiary, instrument_type, instrument_number, amount, issue_date, expiry_date, bank_name, bank_branch, status, comments)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        tenantId,
        targetBizProfileId,
        opportunity_id,
        bid_id || null,
        account_title,
        beneficiary,
        instrument_type,
        instrument_number,
        parseFloat(amount),
        issue_date || new Date(),
        expiry_date,
        bank_name || null,
        bank_branch || null,
        'Active',
        comments || null
      ]
    );

    // Also update tender status to 'Ready to submit' if tender was in Bid Preparation / Selected
    await db.query(
      `UPDATE opportunities 
       SET status = 'Ready to submit', updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND status IN ('New', 'Selected', 'Under Review', 'Bid Preparation')`,
      [opportunity_id]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Bid Security attached successfully. Tender is now Ready to Submit.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST release Bid Security (for won after PG/contract, or for lost/withdraw/rejected)
router.post('/:id/release', async (req, res) => {
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
router.put('/:id', async (req, res) => {
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
           comments = COALESCE($10, comments),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $11
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

module.exports = router;
