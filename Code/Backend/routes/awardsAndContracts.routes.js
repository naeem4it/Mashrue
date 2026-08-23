const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { optionalAuth } = require('../middleware/auth.middleware');

// ============================================================================
// 1. AWARD LETTERS (LOA)
// ============================================================================

router.get('/awards', optionalAuth, async (req, res) => {
  const { opportunity_id } = req.query;
  try {
    let queryText = `
      SELECT al.*, 
             o.opportunity_number, o.tender_name, o.title as opportunity_title,
             c.business_name as customer_name
      FROM award_letters al
      JOIN opportunities o ON al.opportunity_id = o.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE 1=1
    `;
    const params = [];

    // Tenant Isolation
    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND al.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    if (opportunity_id) {
      params.push(opportunity_id);
      queryText += ` AND al.opportunity_id = $${params.length}`;
    }
    queryText += ` ORDER BY al.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/awards', optionalAuth, async (req, res) => {
  const { opportunity_id, bid_id, award_number, award_date, award_amount, acceptance_deadline, remarks, document_url } = req.body;

  if (!award_number || !award_amount) {
    return res.status(400).json({ success: false, message: 'Award Number and Award Amount are mandatory' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const result = await db.query(
      `INSERT INTO award_letters 
       (tenant_id, opportunity_id, bid_id, award_number, award_date, award_amount, acceptance_deadline, status, document_url, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        tenantId,
        opportunity_id,
        bid_id || null,
        award_number,
        award_date || new Date(),
        parseFloat(award_amount),
        acceptance_deadline || null,
        'Issued',
        document_url || null,
        remarks || null
      ]
    );

    // Update linked opportunity and bid to won
    if (opportunity_id) {
      await db.query(
        `UPDATE opportunities SET status = 'won', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [opportunity_id]
      );
      await db.query(
        `UPDATE bids SET approval_status = 'Won', submission_status = 'Submitted', updated_at = CURRENT_TIMESTAMP WHERE opportunity_id = $1`,
        [opportunity_id]
      );
    }

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Award Letter registered successfully.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST accept award letter -> Auto-generates Contract
router.post('/awards/:id/accept', optionalAuth, async (req, res) => {
  const { acceptance_date, start_date, end_date, remarks } = req.body;

  try {
    const alRes = await db.query(`SELECT * FROM award_letters WHERE id = $1`, [req.params.id]);
    if (alRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Award Letter not found' });
    }
    const al = alRes.rows[0];

    const oppRes = await db.query(`SELECT * FROM opportunities WHERE id = $1`, [al.opportunity_id]);
    const opp = oppRes.rows[0];

    // Update Award Letter to Accepted
    await db.query(
      `UPDATE award_letters SET status = 'Accepted', acceptance_date = $1, remarks = COALESCE(remarks, '') || ' | ' || $2 WHERE id = $3`,
      [acceptance_date || new Date(), remarks || 'Accepted by Vendor', req.params.id]
    );

    // Auto-create Contract
    const contractNumber = `CNT-${Date.now().toString().slice(-6)}`;
    const sDate = start_date || new Date();
    const eDate = end_date || new Date(Date.now() + 365 * 86400000);

    const cntRes = await db.query(
      `INSERT INTO contracts 
       (tenant_id, business_profile_id, award_letter_id, opportunity_id, customer_id, contract_number, contract_value, start_date, end_date, status, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        al.tenant_id,
        opp.business_profile_id,
        al.id,
        opp.id,
        opp.customer_id,
        contractNumber,
        al.award_amount,
        sDate,
        eDate,
        'Active',
        `Generated automatically on acceptance of LOA ${al.award_number}`
      ]
    );

    res.json({
      success: true,
      award: al,
      contract: cntRes.rows[0],
      message: 'Award accepted! Contract initialized. Now issue Performance Guarantee and Purchase Order.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 2. PERFORMANCE GUARANTEES
// ============================================================================

router.get('/guarantees', optionalAuth, async (req, res) => {
  try {
    let queryText = `
      SELECT pg.*, 
             c.contract_number, c.contract_value,
             al.award_number,
             cust.business_name as customer_name
      FROM performance_guarantees pg
      JOIN contracts c ON pg.contract_id = c.id
      LEFT JOIN award_letters al ON pg.award_letter_id = al.id
      LEFT JOIN customers cust ON c.customer_id = cust.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND pg.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    queryText += ` ORDER BY pg.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/guarantees', optionalAuth, async (req, res) => {
  const { contract_id, award_letter_id, guarantee_number, bank_name, amount, issue_date, expiry_date, remarks } = req.body;

  if (!guarantee_number || !bank_name || !amount || !expiry_date) {
    return res.status(400).json({
      success: false,
      message: 'Guarantee Number, Bank Name, Amount, and Expiry Date are mandatory.'
    });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const result = await db.query(
      `INSERT INTO performance_guarantees 
       (tenant_id, contract_id, award_letter_id, guarantee_number, bank_name, amount, issue_date, expiry_date, status, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        tenantId,
        contract_id,
        award_letter_id || null,
        guarantee_number,
        bank_name,
        parseFloat(amount),
        issue_date || new Date(),
        expiry_date,
        'Active',
        remarks || null
      ]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Performance Guarantee registered successfully.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/guarantees/:id/release', optionalAuth, async (req, res) => {
  const { release_date, remarks } = req.body;

  try {
    const result = await db.query(
      `UPDATE performance_guarantees 
       SET status = 'Released', release_date = $1, remarks = COALESCE(remarks, '') || ' | ' || $2
       WHERE id = $3
       RETURNING *`,
      [release_date || new Date(), remarks || 'Released on Contract Completion', req.params.id]
    );

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Performance Guarantee successfully released.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 3. CONTRACTS
// ============================================================================

router.get('/contracts', optionalAuth, async (req, res) => {
  try {
    let queryText = `
      SELECT cnt.*, 
             c.business_name as customer_name,
             bp.business_name,
             (SELECT COUNT(*) FROM purchase_orders po WHERE po.contract_id = cnt.id) as po_count,
             (SELECT COUNT(*) FROM performance_guarantees pg WHERE pg.contract_id = cnt.id AND pg.status = 'Active') as active_guarantees_count
      FROM contracts cnt
      JOIN customers c ON cnt.customer_id = c.id
      JOIN business_profiles bp ON cnt.business_profile_id = bp.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND cnt.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    queryText += ` ORDER BY cnt.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update Award Letter
router.put('/awards/:id', async (req, res) => {
  const { award_number, award_amount, award_date, acceptance_deadline, status, remarks } = req.body;
  try {
    const result = await db.query(
      `UPDATE award_letters
       SET award_number = COALESCE($1, award_number),
           award_amount = COALESCE($2, award_amount),
           award_date = COALESCE($3, award_date),
           acceptance_deadline = COALESCE($4, acceptance_deadline),
           status = COALESCE($5, status),
           remarks = COALESCE($6, remarks),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING *`,
      [
        award_number || null,
        award_amount !== undefined ? parseFloat(award_amount) : null,
        award_date || null,
        acceptance_deadline || null,
        status || null,
        remarks || null,
        req.params.id
      ]
    );
    res.json({ success: true, data: result.rows[0], message: 'Award Letter updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update Performance Guarantee
router.put('/guarantees/:id', async (req, res) => {
  const { guarantee_number, bank_name, amount, expiry_date, status, remarks } = req.body;
  try {
    const result = await db.query(
      `UPDATE performance_guarantees
       SET guarantee_number = COALESCE($1, guarantee_number),
           bank_name = COALESCE($2, bank_name),
           amount = COALESCE($3, amount),
           expiry_date = COALESCE($4, expiry_date),
           status = COALESCE($5, status),
           remarks = COALESCE($6, remarks),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING *`,
      [
        guarantee_number || null,
        bank_name || null,
        amount !== undefined ? parseFloat(amount) : null,
        expiry_date || null,
        status || null,
        remarks || null,
        req.params.id
      ]
    );
    res.json({ success: true, data: result.rows[0], message: 'Performance Guarantee updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
