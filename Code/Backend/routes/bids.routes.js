const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { optionalAuth } = require('../middleware/auth.middleware');

// GET all bids
router.get('/', optionalAuth, async (req, res) => {
  const { opportunity_id, business_profile_id } = req.query;
  try {
    let queryText = `
      SELECT b.*, 
             o.opportunity_number, o.tender_name, o.title as opportunity_title, o.status as opportunity_status,
             bp.business_name,
             (SELECT COUNT(*) FROM bid_securities bs WHERE bs.opportunity_id = b.opportunity_id AND bs.status IN ('Active', 'Submitted')) as active_sec_count
      FROM bids b
      JOIN opportunities o ON b.opportunity_id = o.id
      JOIN business_profiles bp ON b.business_profile_id = bp.id
      WHERE 1=1
    `;
    const params = [];

    // Tenant Isolation
    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND b.tenant_id::text = $${params.length}`;

        if (req.user.role === 'ClientEmployee' && req.user.assignedBusinessProfiles && req.user.assignedBusinessProfiles.length > 0) {
          params.push(req.user.assignedBusinessProfiles);
          queryText += ` AND b.business_profile_id = ANY($${params.length}::uuid[])`;
        }
      }
    } else {
      // If unauthenticated non-demo request, return empty to prevent data leakage
      return res.json({ success: true, data: [] });
    }

    if (opportunity_id) {
      params.push(opportunity_id);
      queryText += ` AND b.opportunity_id = $${params.length}`;
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      queryText += ` AND b.business_profile_id = $${params.length}`;
    }

    queryText += ` ORDER BY b.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single bid with items and supplier quotes
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    let queryText = `SELECT b.*, o.title as opportunity_title, o.tender_name, o.opportunity_number, o.status as opportunity_status, bp.business_name
       FROM bids b
       JOIN opportunities o ON b.opportunity_id = o.id
       JOIN business_profiles bp ON b.business_profile_id = bp.id
       WHERE b.id = $1`;
    const params = [req.params.id];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND b.tenant_id::text = $${params.length}`;
    }

    const bidRes = await db.query(queryText, params);

    if (bidRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }

    const itemsRes = await db.query(`SELECT * FROM bid_items WHERE bid_id = $1`, [req.params.id]);
    const quotesRes = await db.query(
      `SELECT sq.*, s.supplier_name 
       FROM supplier_quotations sq
       JOIN suppliers s ON sq.supplier_id = s.id
       WHERE sq.bid_id = $1`,
      [req.params.id]
    );
    const secRes = await db.query(
      `SELECT * FROM bid_securities WHERE opportunity_id = $1`,
      [bidRes.rows[0].opportunity_id]
    );

    res.json({
      success: true,
      data: {
        ...bidRes.rows[0],
        items: itemsRes.rows,
        supplierQuotes: quotesRes.rows,
        bidSecurities: secRes.rows,
        hasBidSecurity: secRes.rows.length > 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST save or update costing sheet
router.post('/save-costing', optionalAuth, async (req, res) => {
  const {
    opportunity_id,
    business_profile_id,
    bid_number,
    supplier_cost_total,
    logistics_cost_total,
    labor_cost_total,
    overhead_cost_total,
    tender_expense_total,
    desired_markup_pct,
    items
  } = req.body;

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const cSupplier = parseFloat(supplier_cost_total || 0);
    const cLogistics = parseFloat(logistics_cost_total || 0);
    const cLabor = parseFloat(labor_cost_total || 0);
    const cOverhead = parseFloat(overhead_cost_total || 0);
    const cExpenses = parseFloat(tender_expense_total || 0);
    const markupPct = parseFloat(desired_markup_pct || 20);

    const totalCost = cSupplier + cLogistics + cLabor + cOverhead + cExpenses;
    const profitAmount = (totalCost * markupPct) / 100;
    const finalPrice = totalCost + profitAmount;
    const grossMarginPct = finalPrice > 0 ? ((profitAmount / finalPrice) * 100) : 0;

    const bidNum = bid_number || `BID-${Date.now().toString().slice(-6)}`;

    const bidRes = await db.query(
      `INSERT INTO bids 
       (tenant_id, business_profile_id, opportunity_id, bid_number, supplier_cost_total, logistics_cost_total, labor_cost_total, overhead_cost_total, tender_expense_total, desired_markup_pct, desired_profit_amount, final_bid_price, gross_margin_pct, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        tenantId,
        business_profile_id,
        opportunity_id,
        bidNum,
        cSupplier,
        cLogistics,
        cLabor,
        cOverhead,
        cExpenses,
        markupPct,
        profitAmount,
        finalPrice,
        grossMarginPct.toFixed(2),
        'Pending Review'
      ]
    );

    const newBid = bidRes.rows[0];

    // Insert items if provided
    if (items && Array.isArray(items)) {
      for (const itm of items) {
        await db.query(
          `INSERT INTO bid_items (bid_id, item_description, quantity, unit_cost, total_cost, markup_pct, unit_price, total_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            newBid.id,
            itm.item_description || 'Bid Item',
            parseFloat(itm.quantity || 1),
            parseFloat(itm.unit_cost || 0),
            parseFloat(itm.total_cost || 0),
            parseFloat(itm.markup_pct || markupPct),
            parseFloat(itm.unit_price || 0),
            parseFloat(itm.total_price || 0)
          ]
        );
      }
    }

    res.status(201).json({ success: true, data: newBid, message: 'Costing Sheet calculated and saved' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST submit bid
// Handles both bid.id and opportunity.id
router.post('/:id/submit', optionalAuth, async (req, res) => {
  const { submission_method, submission_reference, portal_url, remarks } = req.body;

  try {
    let bidRes = await db.query(`SELECT * FROM bids WHERE id = $1`, [req.params.id]);
    let bid = bidRes.rows[0];
    let oppId = bid ? bid.opportunity_id : req.params.id;

    if (!bid) {
      bidRes = await db.query(`SELECT * FROM bids WHERE opportunity_id = $1`, [req.params.id]);
      bid = bidRes.rows[0];
    }

    // If still no bid, create one from the opportunity
    if (!bid) {
      const oppRes = await db.query(`SELECT * FROM opportunities WHERE id = $1`, [oppId]);
      if (oppRes.rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Tender / Opportunity not found' });
      }
      const opp = oppRes.rows[0];
      let tenantId = req.user?.tenantId || opp.tenant_id;
      if (!tenantId) {
        const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
        tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
      }
      const estVal = parseFloat(opp.estimated_value || 0);
      const insertBidRes = await db.query(
        `INSERT INTO bids 
         (tenant_id, business_profile_id, opportunity_id, bid_number, supplier_cost_total, desired_markup_pct, final_bid_price, gross_margin_pct, approval_status, submission_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          tenantId,
          opp.business_profile_id,
          opp.id,
          `BID-${opp.opportunity_number || Date.now().toString().slice(-6)}`,
          estVal,
          20,
          estVal,
          20.00,
          'Submitted',
          'Submitted'
        ]
      );
      bid = insertBidRes.rows[0];
    } else {
      await db.query(
        `UPDATE bids SET submission_status = 'Submitted', approval_status = CASE WHEN approval_status = 'Approved' THEN 'Approved' WHEN approval_status = 'Rejected' THEN 'Rejected' ELSE 'Submitted' END, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [bid.id]
      );
    }

    // Update Opportunity status to Submitted
    await db.query(
      `UPDATE opportunities SET status = 'Submitted', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [oppId]
    );

    // Record submission metadata
    try {
      await db.query(
        `INSERT INTO bid_submissions (bid_id, submission_method, portal_url, submission_reference, remarks)
         VALUES ($1, $2, $3, $4, $5)`,
        [bid.id, submission_method || 'Online Portal', portal_url || null, submission_reference || `SUB-${Date.now().toString().slice(-6)}`, remarks || null]
      );
    } catch (subErr) {
      console.warn('Bid submission log notice:', subErr.message);
    }

    res.json({
      success: true,
      data: bid,
      message: 'Bid successfully submitted and forwarded for Bid Governance Approval.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST approve bid
router.post('/:id/approve', optionalAuth, async (req, res) => {
  const { comments } = req.body;
  try {
    let bidRes = await db.query(`SELECT * FROM bids WHERE id = $1`, [req.params.id]);
    if (bidRes.rows.length === 0) {
      bidRes = await db.query(`SELECT * FROM bids WHERE opportunity_id = $1`, [req.params.id]);
    }
    if (bidRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }
    const bid = bidRes.rows[0];
    await db.query(
      `UPDATE bids SET approval_status = 'Approved', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [bid.id]
    );
    res.json({ success: true, message: 'Bid authorized and approved successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST reject bid
router.post('/:id/reject', optionalAuth, async (req, res) => {
  const { reason, comments } = req.body;
  try {
    let bidRes = await db.query(`SELECT * FROM bids WHERE id = $1`, [req.params.id]);
    if (bidRes.rows.length === 0) {
      bidRes = await db.query(`SELECT * FROM bids WHERE opportunity_id = $1`, [req.params.id]);
    }
    if (bidRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }
    const bid = bidRes.rows[0];
    await db.query(
      `UPDATE bids SET approval_status = 'Rejected', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [bid.id]
    );
    res.json({ success: true, message: 'Bid marked as rejected.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST update approval status
router.post('/:id/status', optionalAuth, async (req, res) => {
  const { status, approval_status } = req.body;
  const newStatus = approval_status || status || 'Submitted';
  try {
    let bidRes = await db.query(`SELECT * FROM bids WHERE id = $1`, [req.params.id]);
    if (bidRes.rows.length === 0) {
      bidRes = await db.query(`SELECT * FROM bids WHERE opportunity_id = $1`, [req.params.id]);
    }
    if (bidRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }
    const bid = bidRes.rows[0];
    await db.query(
      `UPDATE bids SET approval_status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [newStatus, bid.id]
    );
    res.json({ success: true, message: `Approval status updated to ${newStatus}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST evaluate bid: Won / Loose / Withdraw
// Workflow:
// Won -> Prompts Award Letter
// Loose / Withdraw -> Prompts Bid Security Release & File Closure
router.post('/:id/evaluate', async (req, res) => {
  const { evaluation_status, loss_reason, technical_score, financial_score, remarks } = req.body; // 'won', 'loose', 'withdraw'

  try {
    const bidRes = await db.query(`SELECT * FROM bids WHERE id = $1`, [req.params.id]);
    if (bidRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Bid not found' });
    }
    const bid = bidRes.rows[0];

    const evalStatusLower = evaluation_status.toLowerCase();
    let oppNextStatus = 'won';
    if (evalStatusLower === 'loose' || evalStatusLower === 'lost') {
      oppNextStatus = 'loose';
    } else if (evalStatusLower === 'withdraw' || evalStatusLower === 'withdrawn') {
      oppNextStatus = 'withdraw';
    } else {
      oppNextStatus = 'won';
    }

    // Record Evaluation
    await db.query(
      `INSERT INTO bid_evaluations 
       (bid_id, evaluation_status, technical_score, financial_score, loss_reason, remarks)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.params.id,
        oppNextStatus,
        technical_score ? parseFloat(technical_score) : null,
        financial_score ? parseFloat(financial_score) : null,
        loss_reason || null,
        remarks || null
      ]
    );

    // Update Opportunity status
    await db.query(
      `UPDATE opportunities SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [oppNextStatus, bid.opportunity_id]
    );

    let nextActionPrompt = '';
    if (oppNextStatus === 'won') {
      nextActionPrompt = 'Bid Won! Please enter the Award Letter (LOA) and configure the Performance Guarantee.';
    } else {
      nextActionPrompt = 'Bid marked as ' + oppNextStatus.toUpperCase() + '. Please proceed to release the Bid Security instrument and close the file.';
    }

    res.json({
      success: true,
      status: oppNextStatus,
      message: nextActionPrompt,
      opportunityId: bid.opportunity_id
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
