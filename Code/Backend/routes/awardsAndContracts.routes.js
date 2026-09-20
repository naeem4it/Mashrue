const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { optionalAuth } = require('../middleware/auth.middleware');
const logger = require('../services/logger.service');

const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val || ''));

// ============================================================================
// 1. AWARD LETTERS (LOA)
// ============================================================================

router.get('/awards', optionalAuth, async (req, res) => {
  const { opportunity_id } = req.query;
  try {
    let queryText = `
      SELECT al.*, 
             o.opportunity_number, o.tender_name, o.title as opportunity_title,
             o.workflow_gates as opportunity_workflow_gates,
             o.customer_id, o.business_profile_id,
             c.business_name as customer_name,
             cnt.id as contract_id, cnt.contract_number,
             COALESCE(
               (
                 SELECT json_agg(ai.*)
                 FROM award_items ai
                 WHERE ai.award_letter_id = al.id
               ),
               '[]'::json
             ) as items
      FROM award_letters al
      JOIN opportunities o ON al.opportunity_id = o.id
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN contracts cnt ON cnt.award_letter_id = al.id
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
    logger.error('[GET /awards] Error fetching awards:', err);
    res.status(500).json({ success: false, message: err.message, error: err.message });
  }
});

router.post('/awards', optionalAuth, async (req, res) => {
  const { 
    opportunity_id, 
    bid_id, 
    award_number, 
    award_date, 
    award_amount, 
    acceptance_deadline, 
    remarks, 
    document_url, 
    items,
    stamp_duty_required,
    stamp_duty_pct,
    stamp_duty_amount,
    stamp_duty_status
  } = req.body;

  const sanitizedAwardNo = String(award_number || '').trim().slice(0, 100);
  if (!sanitizedAwardNo || !award_amount) {
    return res.status(400).json({ success: false, message: 'Award Number and Award Amount are mandatory' });
  }

  try {
    // 1. Resolve Opportunity and Tenant
    let oppTenantId = null;
    let targetOppId = opportunity_id;

    if (opportunity_id && isUuid(opportunity_id)) {
      const oppRes = await db.query(`SELECT id, tenant_id FROM opportunities WHERE id = $1`, [opportunity_id]);
      if (oppRes.rows.length > 0) {
        oppTenantId = oppRes.rows[0].tenant_id;
        targetOppId = oppRes.rows[0].id;
      }
    } else {
      const oppLookup = await db.query(
        `SELECT id, tenant_id FROM opportunities 
         WHERE (id::text = $1) OR (opportunity_number = $1) 
         LIMIT 1`,
        [String(opportunity_id || '')]
      );
      if (oppLookup.rows.length > 0) {
        oppTenantId = oppLookup.rows[0].tenant_id;
        targetOppId = oppLookup.rows[0].id;
      }
    }

    if (!targetOppId || !isUuid(targetOppId)) {
      logger.warn('[POST /awards] Invalid or missing opportunity_id:', { opportunity_id });
      return res.status(400).json({
        success: false,
        message: `Valid Opportunity ID is required to record Letter of Award (received: ${opportunity_id || 'empty'}).`
      });
    }

    // Check opportunity workflow gates for stamp duty requirement
    const oppDetailsRes = await db.query(`SELECT workflow_gates FROM opportunities WHERE id = $1`, [targetOppId]);
    let oppGates = oppDetailsRes.rows[0]?.workflow_gates;
    if (typeof oppGates === 'string') {
      try { oppGates = JSON.parse(oppGates); } catch (_) { oppGates = null; }
    }

    let isStampDutyRequired = true;
    if (oppGates && oppGates.requires_stamp_duty === false) {
      isStampDutyRequired = false;
    } else if (stamp_duty_required === false) {
      isStampDutyRequired = false;
    }

    let finalSdRequired = isStampDutyRequired;
    let finalSdPct = 0;
    let finalSdAmt = 0;
    let finalSdStatus = 'Not Required';

    if (isStampDutyRequired) {
      finalSdPct = parseFloat(stamp_duty_pct !== undefined ? stamp_duty_pct : 0.25);
      finalSdAmt = parseFloat(stamp_duty_amount !== undefined ? stamp_duty_amount : Math.round(((parseFloat(award_amount) || 0) * finalSdPct) / 100));
      finalSdStatus = stamp_duty_status || 'Unpaid';
    }

    // Determine Tenant ID (prefer oppTenantId, then req.user, then req.body, then system fallback)
    let tenantId = oppTenantId;
    if (!tenantId && req.user?.tenantId && isUuid(req.user.tenantId)) {
      tenantId = req.user.tenantId;
    }
    if (!tenantId && req.body.tenant_id && isUuid(req.body.tenant_id)) {
      tenantId = req.body.tenant_id;
    }
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    // 2. Sanitize Dates to pure YYYY-MM-DD
    let validAwardDate = new Date().toISOString().split('T')[0];
    if (award_date && typeof award_date === 'string' && award_date.trim()) {
      const str = award_date.trim();
      if (str.includes('/')) {
        const parts = str.split('/');
        if (parts.length === 3) validAwardDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      } else {
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) validAwardDate = parsed.toISOString().split('T')[0];
      }
    }

    let validDeadline = null;
    if (acceptance_deadline && typeof acceptance_deadline === 'string' && acceptance_deadline.trim()) {
      const str = acceptance_deadline.trim();
      if (str.includes('/')) {
        const parts = str.split('/');
        if (parts.length === 3) validDeadline = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      } else {
        const parsed = new Date(str);
        if (!isNaN(parsed.getTime())) validDeadline = parsed.toISOString().split('T')[0];
      }
    }

    // 3. Sanitize Bid ID
    const validBidId = (bid_id && isUuid(bid_id)) ? bid_id : null;

    logger.info('[POST /awards] Registering Award Letter:', {
      award_number: sanitizedAwardNo,
      targetOppId,
      tenantId,
      award_amount,
      isStampDutyRequired,
      finalSdAmt,
      itemsCount: Array.isArray(items) ? items.length : 0
    });

    const result = await db.query(
      `INSERT INTO award_letters 
       (tenant_id, opportunity_id, bid_id, award_number, award_date, award_amount, acceptance_deadline, status, document_url, remarks, stamp_duty_required, stamp_duty_pct, stamp_duty_amount, stamp_duty_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        tenantId,
        targetOppId,
        validBidId,
        sanitizedAwardNo,
        validAwardDate,
        parseFloat(award_amount) || 0,
        validDeadline,
        'Issued',
        document_url || null,
        remarks || null,
        finalSdRequired,
        finalSdPct,
        finalSdAmt,
        finalSdStatus
      ]
    );

    // Save item-level awards if provided
    const savedItems = [];
    if (items && Array.isArray(items) && items.length > 0) {
      for (const itm of items) {
        try {
          const validProdId = (itm.product_service_id && isUuid(itm.product_service_id)) ? itm.product_service_id : null;
          const itemRes = await db.query(
            `INSERT INTO award_items 
             (award_letter_id, product_service_id, item_name, item_description, tender_quantity, bid_quantity, awarded_quantity, unit, awarded_unit_price, awarded_total_price, is_awarded)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING *`,
            [
              result.rows[0].id,
              validProdId,
              itm.item_name || itm.item_description || 'Item Scope',
              itm.item_description || itm.item_name || '',
              parseFloat(itm.tender_quantity || itm.bid_quantity || 1),
              parseFloat(itm.bid_quantity || itm.tender_quantity || 1),
              parseFloat(itm.awarded_quantity || 0),
              itm.unit || 'PCS',
              parseFloat(itm.awarded_unit_price || 0),
              parseFloat(itm.awarded_total_price || 0),
              itm.is_awarded !== false
            ]
          );
          if (itemRes.rows && itemRes.rows[0]) {
            savedItems.push(itemRes.rows[0]);
          }
        } catch (itemErr) {
          logger.warn('[POST /awards] Could not insert award_item row:', {
            error: itemErr.message,
            item_name: itm.item_name
          });
        }
      }
    }

    // Update linked opportunity and bid to won
    if (targetOppId) {
      await db.query(
        `UPDATE opportunities SET status = 'won', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [targetOppId]
      );
      await db.query(
        `UPDATE bids SET approval_status = 'Won', submission_status = 'Submitted', updated_at = CURRENT_TIMESTAMP WHERE opportunity_id = $1`,
        [targetOppId]
      );
    }

    logger.info('[POST /awards] Award Letter registered successfully in database:', {
      award_id: result.rows[0].id,
      award_number
    });

    res.status(201).json({
      success: true,
      data: {
        ...result.rows[0],
        items: savedItems.length > 0 ? savedItems : (items || [])
      },
      message: 'Award Letter registered successfully.'
    });
  } catch (err) {
    logger.error('[POST /awards] Database failure registering award:', err);
    res.status(500).json({
      success: false,
      message: `Database error: ${err.message}`,
      error: err.message
    });
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

    let oppGates = opp?.workflow_gates;
    if (typeof oppGates === 'string') {
      try { oppGates = JSON.parse(oppGates); } catch (_) { oppGates = null; }
    }
    const isSdReq = (oppGates && oppGates.requires_stamp_duty === false) || al.stamp_duty_required === false ? false : true;
    const sdRate = isSdReq ? parseFloat(al.stamp_duty_pct || 0.25) : 0;
    const sdAmt = isSdReq ? parseFloat(al.stamp_duty_amount || Math.round((parseFloat(al.award_amount || 0) * sdRate) / 100)) : 0;

    const cntRes = await db.query(
      `INSERT INTO contracts 
       (tenant_id, business_profile_id, award_letter_id, opportunity_id, customer_id, contract_number, contract_value, start_date, end_date, status, remarks, stamp_duty_required, stamp_duty_rate_pct, stamp_duty_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
        `Generated automatically on acceptance of LOA ${al.award_number}`,
        isSdReq,
        sdRate,
        sdAmt
      ]
    );

    res.json({
      success: true,
      award: al,
      contract: cntRes.rows[0],
      message: 'Award accepted! Contract initialized. Now issue Performance Guarantee and Purchase Order.'
    });
  } catch (err) {
    logger.error('[POST /awards/:id/accept] Error accepting award:', err);
    res.status(500).json({ success: false, message: err.message, error: err.message });
  }
});

// POST /awards/:id/decision -> Updates LOA decision/status & stamp duty
router.post('/awards/:id/decision', optionalAuth, async (req, res) => {
  const { 
    decision, 
    status, 
    stamp_duty_status, 
    stamp_duty_challan_no, 
    stamp_duty_paid_date, 
    stamp_duty_amount, 
    stamp_duty_bank, 
    remarks 
  } = req.body;

  try {
    const finalDecision = decision || status || null;
    const finalSdStatus = stamp_duty_status || (stamp_duty_challan_no ? 'Paid' : null);
    const finalPaidDate = stamp_duty_paid_date ? parseSafePBGDate(stamp_duty_paid_date) : null;
    const finalAmount = stamp_duty_amount ? parseFloat(String(stamp_duty_amount).replace(/,/g, '')) : null;

    const alRes = await db.query(`SELECT * FROM award_letters WHERE id = $1`, [req.params.id]);
    if (alRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Award Letter not found' });
    }

    const result = await db.query(
      `UPDATE award_letters 
       SET status = COALESCE($1, status),
           stamp_duty_status = COALESCE($2, stamp_duty_status),
           stamp_duty_challan_no = COALESCE($3, stamp_duty_challan_no),
           stamp_duty_paid_date = COALESCE($4, stamp_duty_paid_date),
           stamp_duty_amount = COALESCE($5, stamp_duty_amount),
           stamp_duty_bank = COALESCE($6, stamp_duty_bank),
           remarks = COALESCE($7, remarks),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [
        finalDecision,
        finalSdStatus,
        stamp_duty_challan_no || null,
        finalPaidDate,
        finalAmount,
        stamp_duty_bank || null,
        remarks || null,
        req.params.id
      ]
    );

    const updatedAward = result.rows[0];

    // Sync to linked contracts if exists
    if (finalSdStatus) {
      await db.query(
        `UPDATE contracts 
         SET stamp_duty_status = $1,
             stamp_duty_challan_no = COALESCE($2, stamp_duty_challan_no),
             stamp_duty_paid_date = COALESCE($3, stamp_duty_paid_date),
             stamp_duty_amount = COALESCE($4, stamp_duty_amount),
             stamp_duty_bank = COALESCE($5, stamp_duty_bank)
         WHERE award_letter_id = $6`,
        [
          finalSdStatus,
          stamp_duty_challan_no || null,
          finalPaidDate,
          finalAmount,
          stamp_duty_bank || null,
          req.params.id
        ]
      );
    }

    logger.info(`[POST /awards/:id/decision] Award ${req.params.id} updated:`, {
      status: updatedAward.status,
      stamp_duty_status: updatedAward.stamp_duty_status,
      stamp_duty_challan_no: updatedAward.stamp_duty_challan_no
    });

    res.json({
      success: true,
      data: updatedAward,
      message: `Award Letter updated successfully (Status: ${updatedAward.status}, Stamp Duty: ${updatedAward.stamp_duty_status}).`
    });
  } catch (err) {
    logger.error('[POST /awards/:id/decision] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /awards/:id/stamp-duty -> Dedicated endpoint for recording stamp duty on LOA
router.post('/awards/:id/stamp-duty', optionalAuth, async (req, res) => {
  const { 
    stamp_duty_challan_no, 
    stamp_duty_amount, 
    stamp_duty_paid_date, 
    stamp_duty_bank, 
    stamp_duty_rate_pct, 
    stamp_duty_status 
  } = req.body;

  try {
    const challanNo = (stamp_duty_challan_no || '').trim();
    if (!challanNo) {
      return res.status(400).json({ success: false, message: 'Challan number is required.' });
    }

    const safePaidDate = parseSafePBGDate(stamp_duty_paid_date) || new Date().toISOString().split('T')[0];
    const finalAmount = stamp_duty_amount ? parseFloat(String(stamp_duty_amount).replace(/,/g, '')) : 0;
    const finalStatus = stamp_duty_status || 'Paid';

    const result = await db.query(
      `UPDATE award_letters 
       SET stamp_duty_status = $1,
           stamp_duty_challan_no = $2,
           stamp_duty_paid_date = $3,
           stamp_duty_amount = $4,
           stamp_duty_bank = COALESCE($5, stamp_duty_bank),
           stamp_duty_pct = COALESCE($6, stamp_duty_pct),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING *`,
      [
        finalStatus,
        challanNo,
        safePaidDate,
        finalAmount,
        stamp_duty_bank || null,
        stamp_duty_rate_pct ? parseFloat(stamp_duty_rate_pct) : null,
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Award Letter not found' });
    }

    // Also sync to linked contract if exists
    await db.query(
      `UPDATE contracts 
       SET stamp_duty_status = $1,
           stamp_duty_challan_no = $2,
           stamp_duty_paid_date = $3,
           stamp_duty_amount = $4,
           stamp_duty_bank = COALESCE($5, stamp_duty_bank)
       WHERE award_letter_id = $6`,
      [
        finalStatus,
        challanNo,
        safePaidDate,
        finalAmount,
        stamp_duty_bank || null,
        req.params.id
      ]
    );

    logger.info(`[POST /awards/:id/stamp-duty] Recorded stamp duty for award ${req.params.id}:`, {
      challan: challanNo,
      amount: finalAmount,
      status: finalStatus
    });

    res.json({
      success: true,
      data: result.rows[0],
      message: `Stamp Duty Challan #${challanNo} recorded as Paid in database.`
    });
  } catch (err) {
    logger.error('[POST /awards/:id/stamp-duty] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/awards/:id/stamp-duty', optionalAuth, async (req, res) => {
  // Alias to POST handler
  req.url = `/awards/${req.params.id}/stamp-duty`;
  return router.handle(req, res);
});

// ============================================================================
// 2. PERFORMANCE GUARANTEES
// ============================================================================

router.get('/guarantees', optionalAuth, async (req, res) => {
  try {
    let queryText = `
      SELECT pg.*, 
             COALESCE(pg.instrument_number, pg.guarantee_number) as instrument_number,
             COALESCE(pg.guarantee_number, pg.instrument_number) as guarantee_number,
             COALESCE(pg.comments, pg.remarks) as comments,
             COALESCE(pg.remarks, pg.comments) as remarks,
             COALESCE(pg.instrument_image_url, pg.document_url) as instrument_image_url,
             c.contract_number, c.contract_value,
             al.award_number,
             o.opportunity_number, o.tender_name,
             COALESCE(cust.business_name, cust2.business_name, cust3.business_name) as customer_name
      FROM performance_guarantees pg
      LEFT JOIN contracts c ON pg.contract_id = c.id
      LEFT JOIN award_letters al ON pg.award_letter_id = al.id
      LEFT JOIN opportunities o ON pg.opportunity_id = o.id OR al.opportunity_id = o.id OR c.opportunity_id = o.id
      LEFT JOIN customers cust ON c.customer_id = cust.id
      LEFT JOIN customers cust2 ON o.customer_id = cust2.id
      LEFT JOIN customers cust3 ON al.customer_id = cust3.id
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

// Helper for safe pure YYYY-MM-DD date parsing
function parseSafePBGDate(dStr) {
  if (!dStr) return null;
  if (dStr instanceof Date) {
    if (isNaN(dStr.getTime())) return null;
    return dStr.toISOString().split('T')[0];
  }
  const str = String(dStr).trim();
  if (str.includes('/')) {
    const parts = str.split(/[\s,]+/)[0].split('/');
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }
  if (str.includes('-')) {
    const parts = str.split(/[\s,T]+/)[0].split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
      } else if (parts[2].length === 4) {
        return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
      }
    }
  }
  return str.split('T')[0].split(' ')[0];
}

router.post('/guarantees', optionalAuth, async (req, res) => {
  const { 
    business_profile_id,
    opportunity_id,
    contract_id, 
    award_letter_id, 
    account_title,
    beneficiary,
    instrument_type,
    instrument_number,
    guarantee_number, 
    amount, 
    issue_date, 
    expiry_date, 
    bank_name, 
    bank_branch,
    comments,
    remarks,
    instrument_image_url,
    document_url
  } = req.body;

  const finalInstNo = (instrument_number || guarantee_number || '').trim();
  const finalInstType = (instrument_type || 'BG').trim();
  const finalAccountTitle = (account_title || '').trim();
  const finalBeneficiary = (beneficiary || '').trim();
  const finalComments = comments || remarks || null;
  const finalDocUrl = instrument_image_url || document_url || null;

  // Validate the exact 6 mandatory fields identical to Bid Security
  if (!finalAccountTitle || !finalBeneficiary || !finalInstType || !finalInstNo || !amount || !expiry_date) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error: Account Title, Beneficiary, Instrument Type, Instrument Number, Amount, and Expiry Date are all mandatory.'
    });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const finalBankName = (bank_name || bank_branch || 'Bank Guarantee').trim();
    const finalBankBranch = (bank_branch || bank_name || null);
    const safeExpiry = parseSafePBGDate(expiry_date);
    const safeIssue = parseSafePBGDate(issue_date) || new Date().toISOString().split('T')[0];

    let cleanContractId = (contract_id && isUuid(contract_id)) ? contract_id : null;
    let cleanAwardId = (award_letter_id && isUuid(award_letter_id)) ? award_letter_id : null;
    let cleanOppId = (opportunity_id && isUuid(opportunity_id)) ? opportunity_id : null;
    let cleanBizId = (business_profile_id && isUuid(business_profile_id)) ? business_profile_id : null;

    // 1. Verify and resolve cleanContractId against contracts table
    if (cleanContractId) {
      const cCheck = await db.query('SELECT id, award_letter_id, opportunity_id, business_profile_id FROM contracts WHERE id = $1', [cleanContractId]);
      if (cCheck.rows.length === 0) {
        if (!cleanAwardId) {
          const aCheck = await db.query('SELECT id, opportunity_id FROM award_letters WHERE id = $1', [cleanContractId]);
          if (aCheck.rows.length > 0) {
            cleanAwardId = cleanContractId;
            cleanOppId = cleanOppId || aCheck.rows[0].opportunity_id;
          }
        }
        cleanContractId = null;
      } else {
        cleanAwardId = cleanAwardId || cCheck.rows[0].award_letter_id;
        cleanOppId = cleanOppId || cCheck.rows[0].opportunity_id;
        cleanBizId = cleanBizId || cCheck.rows[0].business_profile_id;
      }
    }

    // 2. Verify and resolve cleanAwardId against award_letters table
    if (cleanAwardId) {
      const aCheck = await db.query('SELECT id, opportunity_id FROM award_letters WHERE id = $1', [cleanAwardId]);
      if (aCheck.rows.length === 0) {
        cleanAwardId = null;
      } else {
        cleanOppId = cleanOppId || aCheck.rows[0].opportunity_id;
        if (!cleanContractId) {
          const cCheck = await db.query('SELECT id, business_profile_id FROM contracts WHERE award_letter_id = $1 LIMIT 1', [cleanAwardId]);
          if (cCheck.rows.length > 0) {
            cleanContractId = cCheck.rows[0].id;
            cleanBizId = cleanBizId || cCheck.rows[0].business_profile_id;
          }
        }
      }
    }

    // 3. Verify and resolve cleanOppId against opportunities table
    if (cleanOppId) {
      const oCheck = await db.query('SELECT id, business_profile_id FROM opportunities WHERE id = $1', [cleanOppId]);
      if (oCheck.rows.length === 0) {
        cleanOppId = null;
      } else {
        cleanBizId = cleanBizId || oCheck.rows[0].business_profile_id;
      }
    }

    // 4. Verify cleanBizId against business_profiles table
    if (cleanBizId) {
      const bCheck = await db.query('SELECT id FROM business_profiles WHERE id = $1', [cleanBizId]);
      if (bCheck.rows.length === 0) {
        cleanBizId = null;
      }
    }

    const result = await db.query(
      `INSERT INTO performance_guarantees 
       (tenant_id, business_profile_id, opportunity_id, contract_id, award_letter_id, account_title, beneficiary, instrument_type, instrument_number, guarantee_number, bank_name, bank_branch, amount, issue_date, expiry_date, status, comments, remarks, instrument_image_url, document_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING *`,
      [
        tenantId,
        cleanBizId,
        cleanOppId,
        cleanContractId,
        cleanAwardId,
        finalAccountTitle,
        finalBeneficiary,
        finalInstType,
        finalInstNo,
        finalInstNo,
        finalBankName,
        finalBankBranch,
        parseFloat(String(amount).replace(/,/g, '')) || 0,
        safeIssue,
        safeExpiry,
        'Active',
        finalComments,
        finalComments,
        finalDocUrl,
        finalDocUrl
      ]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Performance Guarantee registered successfully in database.'
    });
  } catch (err) {
    console.error('[POST /api/guarantees Error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/guarantees/:id', optionalAuth, async (req, res) => {
  const {
    account_title,
    beneficiary,
    instrument_type,
    instrument_number,
    guarantee_number,
    amount,
    issue_date,
    expiry_date,
    bank_name,
    bank_branch,
    comments,
    remarks,
    instrument_image_url,
    document_url,
    status
  } = req.body;

  try {
    const finalInstNo = (instrument_number || guarantee_number || '').trim();
    const finalComments = comments || remarks || null;
    const finalDocUrl = instrument_image_url || document_url || null;
    const safeExpiry = parseSafePBGDate(expiry_date);
    const safeIssue = parseSafePBGDate(issue_date);

    const result = await db.query(
      `UPDATE performance_guarantees 
       SET account_title = COALESCE($1, account_title),
           beneficiary = COALESCE($2, beneficiary),
           instrument_type = COALESCE($3, instrument_type),
           instrument_number = COALESCE($4, instrument_number),
           guarantee_number = COALESCE($4, guarantee_number),
           amount = COALESCE($5, amount),
           expiry_date = COALESCE($6, expiry_date),
           issue_date = COALESCE($7, issue_date),
           bank_name = COALESCE($8, bank_name),
           bank_branch = COALESCE($9, bank_branch),
           comments = COALESCE($10, comments),
           remarks = COALESCE($10, remarks),
           instrument_image_url = COALESCE($11, instrument_image_url),
           document_url = COALESCE($11, document_url),
           status = COALESCE($12, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $13
       RETURNING *`,
      [
        account_title || null,
        beneficiary || null,
        instrument_type || null,
        finalInstNo || null,
        amount ? parseFloat(amount) : null,
        safeExpiry,
        safeIssue,
        bank_name || null,
        bank_branch || null,
        finalComments,
        finalDocUrl,
        status || null,
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Performance Guarantee not found' });
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Performance Guarantee updated successfully.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/guarantees/:id/release', optionalAuth, async (req, res) => {
  const { release_date, release_reference, remarks, comments } = req.body;

  try {
    const safeReleaseDate = parseSafePBGDate(release_date) || new Date().toISOString().split('T')[0];
    const finalRemarks = remarks || comments || 'Released on Contract Completion';
    const finalRef = release_reference || null;

    const result = await db.query(
      `UPDATE performance_guarantees 
       SET status = 'Released', 
           release_date = $1, 
           release_reference = $2,
           remarks = COALESCE(remarks, '') || ' | ' || $3,
           comments = COALESCE(comments, '') || ' | ' || $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [safeReleaseDate, finalRef, finalRemarks, req.params.id]
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

router.post('/contracts', optionalAuth, async (req, res) => {
  const {
    opportunity_id,
    award_letter_id,
    customer_id,
    contract_number,
    contract_value,
    start_date,
    end_date,
    status,
    remarks,
    stamp_duty_required,
    stamp_duty_rate_pct,
    stamp_duty_amount
  } = req.body;

  try {
    let targetOpp = null;
    let targetOppId = (opportunity_id && isUuid(opportunity_id)) ? opportunity_id : null;
    if (targetOppId) {
      const oppRes = await db.query(`SELECT * FROM opportunities WHERE id = $1`, [targetOppId]);
      targetOpp = oppRes.rows[0] || null;
    }

    let tenantId = targetOpp?.tenant_id || (req.user?.tenantId && isUuid(req.user.tenantId) ? req.user.tenantId : null);
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    let businessProfileId = targetOpp?.business_profile_id;
    if (!businessProfileId || !isUuid(businessProfileId)) {
      const bpRes = await db.query(`SELECT id FROM business_profiles WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
      businessProfileId = bpRes.rows[0]?.id;
    }
    if (!businessProfileId) {
      const bpAny = await db.query(`SELECT id FROM business_profiles LIMIT 1`);
      businessProfileId = bpAny.rows[0]?.id || 'b0000000-0000-0000-0000-000000000001';
    }

    let targetCustId = (customer_id && isUuid(customer_id)) ? customer_id : targetOpp?.customer_id;
    if (!targetCustId || !isUuid(targetCustId)) {
      const custRes = await db.query(`SELECT id FROM customers WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
      targetCustId = custRes.rows[0]?.id;
    }
    if (!targetCustId) {
      const custAny = await db.query(`SELECT id FROM customers LIMIT 1`);
      targetCustId = custAny.rows[0]?.id || 'c0000000-0000-0000-0000-000000000001';
    }

    const cNumber = String(contract_number || `CNT-${Date.now().toString().slice(-6)}`).trim().slice(0, 100);
    const sDate = start_date && !isNaN(new Date(start_date).getTime()) ? new Date(start_date) : new Date();
    const eDate = end_date && !isNaN(new Date(end_date).getTime()) ? new Date(end_date) : new Date(Date.now() + 365 * 86400000);
    const validAlId = (award_letter_id && isUuid(award_letter_id)) ? award_letter_id : null;

    // Check stamp duty requirement from request, opportunity workflow gates, or award letter
    let reqStampDuty = true;
    if (stamp_duty_required === false) {
      reqStampDuty = false;
    } else if (targetOpp?.workflow_gates) {
      let og = targetOpp.workflow_gates;
      if (typeof og === 'string') {
        try { og = JSON.parse(og); } catch (_) { og = null; }
      }
      if (og && og.requires_stamp_duty === false) reqStampDuty = false;
    } else if (validAlId) {
      const alRow = await db.query(`SELECT stamp_duty_required FROM award_letters WHERE id = $1`, [validAlId]);
      if (alRow.rows[0]?.stamp_duty_required === false) reqStampDuty = false;
    }

    const cSdRate = reqStampDuty ? parseFloat(stamp_duty_rate_pct !== undefined ? stamp_duty_rate_pct : 0.25) : 0;
    const cSdAmt = reqStampDuty ? parseFloat(stamp_duty_amount !== undefined ? stamp_duty_amount : Math.round(((parseFloat(contract_value) || 0) * cSdRate) / 100)) : 0;

    logger.info('[POST /contracts] Registering Contract:', {
      contract_number: cNumber,
      tenantId,
      businessProfileId,
      targetCustId,
      validAlId,
      reqStampDuty,
      cSdAmt
    });

    const result = await db.query(
      `INSERT INTO contracts 
       (tenant_id, business_profile_id, award_letter_id, opportunity_id, customer_id, contract_number, contract_value, start_date, end_date, status, remarks, stamp_duty_required, stamp_duty_rate_pct, stamp_duty_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING *`,
      [
        tenantId,
        businessProfileId,
        validAlId,
        targetOppId,
        targetCustId,
        cNumber,
        parseFloat(contract_value || 0),
        sDate,
        eDate,
        status || 'Active',
        remarks || 'Initialized upon LOA recording',
        reqStampDuty,
        cSdRate,
        cSdAmt
      ]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Contract registered successfully.'
    });
  } catch (err) {
    logger.error('[POST /contracts] Error registering contract:', err);
    res.status(500).json({ success: false, message: `Contract error: ${err.message}`, error: err.message });
  }
});

// PUT update Award Letter
router.put('/awards/:id', optionalAuth, async (req, res) => {
  const { id } = req.params;
  const { award_number, award_amount, award_date, acceptance_deadline, status, remarks } = req.body;

  if (!isUuid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid Award ID format.' });
  }

  try {
    const sanitizedAwardNo = award_number ? String(award_number).trim().slice(0, 100) : null;
    let validAwardDate = null;
    if (award_date && typeof award_date === 'string' && award_date.trim()) {
      const p = new Date(award_date);
      if (!isNaN(p.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(award_date.trim())) {
        validAwardDate = award_date.trim().slice(0, 10);
      }
    }

    let validDeadline = null;
    if (acceptance_deadline && typeof acceptance_deadline === 'string' && acceptance_deadline.trim()) {
      const p = new Date(acceptance_deadline);
      if (!isNaN(p.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(acceptance_deadline.trim())) {
        validDeadline = acceptance_deadline.trim().slice(0, 10);
      }
    }

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
        sanitizedAwardNo,
        award_amount !== undefined && award_amount !== '' ? parseFloat(award_amount) : null,
        validAwardDate,
        validDeadline,
        status || null,
        remarks !== undefined ? remarks : null,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Award Letter not found.' });
    }

    logger.info('[PUT /awards/:id] Award updated successfully:', { id, status: result.rows[0].status });
    res.json({ success: true, data: result.rows[0], message: 'Award Letter updated successfully.' });
  } catch (err) {
    logger.error('[PUT /awards/:id] Database error:', err);
    res.status(500).json({ success: false, message: `Database error: ${err.message}`, error: err.message });
  }
});

// POST mark award decision (Accepted / Rejected / Pending)
router.post('/awards/:id/decision', optionalAuth, async (req, res) => {
  const { id } = req.params;
  const { decision, reason, remarks, acceptance_date } = req.body;

  if (!isUuid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid Award ID format.' });
  }

  const validDecisions = ['Accepted', 'Rejected', 'Pending'];
  if (!decision || !validDecisions.includes(decision)) {
    return res.status(400).json({ success: false, message: `Invalid decision. Allowed: ${validDecisions.join(', ')}` });
  }

  try {
    let acceptDate = null;
    if (decision === 'Accepted') {
      acceptDate = acceptance_date && /^\d{4}-\d{2}-\d{2}/.test(String(acceptance_date))
        ? acceptance_date
        : new Date().toISOString().slice(0, 10);
    }

    const result = await db.query(
      `UPDATE award_letters
       SET status = $1::varchar,
           acceptance_date = COALESCE($2::date, acceptance_date),
           rejection_reason = CASE WHEN $1::varchar = 'Rejected' THEN COALESCE($3::text, rejection_reason) ELSE rejection_reason END,
           remarks = CASE WHEN $4::text IS NOT NULL THEN COALESCE(remarks, '') || ' | ' || $4::text ELSE remarks END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $5::uuid
       RETURNING *`,
      [
        decision,
        acceptDate,
        reason || null,
        remarks || null,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Award Letter not found.' });
    }

    const updatedAward = result.rows[0];

    // If accepted, also auto-initialize contract if not yet created
    if (decision === 'Accepted' && updatedAward.opportunity_id) {
      const existingCnt = await db.query(`SELECT id FROM contracts WHERE award_letter_id = $1 LIMIT 1`, [id]);
      if (existingCnt.rows.length === 0) {
        const oppRes = await db.query(`SELECT * FROM opportunities WHERE id = $1`, [updatedAward.opportunity_id]);
        const opp = oppRes.rows[0];
        if (opp) {
          let oppGates = opp.workflow_gates;
          if (typeof oppGates === 'string') {
            try { oppGates = JSON.parse(oppGates); } catch (_) { oppGates = null; }
          }
          const isSdReq = (oppGates && oppGates.requires_stamp_duty === false) || updatedAward.stamp_duty_required === false ? false : true;
          const sdRate = isSdReq ? parseFloat(updatedAward.stamp_duty_pct || 0.25) : 0;
          const sdAmt = isSdReq ? parseFloat(updatedAward.stamp_duty_amount || Math.round((parseFloat(updatedAward.award_amount || 0) * sdRate) / 100)) : 0;

          const cNumber = `CNT-${updatedAward.award_number.replace(/^LOA-/, '')}`;
          await db.query(
            `INSERT INTO contracts 
             (tenant_id, business_profile_id, award_letter_id, opportunity_id, customer_id, contract_number, contract_value, start_date, end_date, status, remarks, stamp_duty_required, stamp_duty_rate_pct, stamp_duty_amount)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year', 'Active', 'Auto-generated on LOA acceptance', $8, $9, $10)`,
            [
              updatedAward.tenant_id,
              opp.business_profile_id,
              updatedAward.id,
              opp.id,
              opp.customer_id,
              cNumber,
              updatedAward.award_amount,
              isSdReq,
              sdRate,
              sdAmt
            ]
          );
        }
      }
    }

    logger.info('[POST /awards/:id/decision] Award decision recorded:', { id, decision });
    res.json({ success: true, data: updatedAward, message: `Award Letter marked as ${decision}.` });
  } catch (err) {
    logger.error('[POST /awards/:id/decision] Error updating award decision:', err);
    res.status(500).json({ success: false, message: `Database error: ${err.message}`, error: err.message });
  }
});

// ============================================================================
// 4. GRIEVANCE REDRESSAL (PPRA RULE 48)
// ============================================================================

// GET all grievance cases
router.get('/grievances', optionalAuth, async (req, res) => {
  const { opportunity_id, status } = req.query;
  try {
    let queryText = `
      SELECT g.*, 
             o.opportunity_number, o.tender_name, o.title as opportunity_title,
             c.business_name as customer_name
      FROM grievance_cases g
      JOIN opportunities o ON g.opportunity_id = o.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND g.tenant_id::text = $${params.length}`;
    }

    if (opportunity_id) {
      params.push(opportunity_id);
      queryText += ` AND g.opportunity_id = $${params.length}`;
    }

    if (status) {
      params.push(status);
      queryText += ` AND g.status = $${params.length}`;
    }

    queryText += ` ORDER BY g.filing_date DESC, g.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST file a new Grievance (PPRA Rule 48)
router.post('/grievances', optionalAuth, async (req, res) => {
  const {
    opportunity_id,
    bid_id,
    procuring_agency_officer,
    committee_name,
    hearing_date,
    grievance_grounds,
    relief_sought
  } = req.body;

  if (!opportunity_id || !grievance_grounds) {
    return res.status(400).json({ success: false, message: 'Tender ID and Grievance Grounds are mandatory' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const caseNum = `GRV-${Date.now().toString().slice(-6)}`;

    const result = await db.query(
      `INSERT INTO grievance_cases 
       (tenant_id, opportunity_id, bid_id, case_tracking_number, filing_date, procuring_agency_officer, committee_name, hearing_date, grievance_grounds, relief_sought, status, created_by)
       VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $8, $9, 'Under Review', $10)
       RETURNING *`,
      [
        tenantId,
        opportunity_id,
        bid_id || null,
        caseNum,
        procuring_agency_officer || 'Chairman Grievance Redressal Committee',
        committee_name || 'PPRA / Departmental Redressal Committee',
        hearing_date || null,
        grievance_grounds,
        relief_sought || 'Annulment of Disqualification & Acceptance of Bid',
        req.user?.id || null
      ]
    );

    // Update opportunity status to In Grievance
    await db.query(`UPDATE opportunities SET status = 'In Grievance', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [opportunity_id]);

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: `Grievance Case #${caseNum} filed successfully under PPRA Rule 48.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT Update Grievance Decision
router.put('/grievances/:id', optionalAuth, async (req, res) => {
  const { status, decision_date, decision_summary, decision_doc_url, hearing_date } = req.body;
  try {
    const result = await db.query(
      `UPDATE grievance_cases 
       SET status = COALESCE($1, status),
           decision_date = COALESCE($2, decision_date),
           decision_summary = COALESCE($3, decision_summary),
           decision_doc_url = COALESCE($4, decision_doc_url),
           hearing_date = COALESCE($5, hearing_date),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [status || null, decision_date || null, decision_summary || null, decision_doc_url || null, hearing_date || null, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Grievance case not found' });
    }

    const gCase = result.rows[0];
    if (status === 'Accepted') {
      // If accepted, transition opportunity to Ready for Award
      await db.query(`UPDATE opportunities SET status = 'won', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [gCase.opportunity_id]);
    } else if (status === 'Rejected') {
      // If rejected, mark as closed/lost to prompt CDR release
      await db.query(`UPDATE opportunities SET status = 'loose', updated_at = CURRENT_TIMESTAMP WHERE id = $1`, [gCase.opportunity_id]);
    }

    res.json({
      success: true,
      data: gCase,
      message: `Grievance case decision updated to ${status}`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 5. STAMP DUTY LOGGING ON CONTRACTS
// ============================================================================

router.post('/contracts/:id/stamp-duty', optionalAuth, async (req, res) => {
  const { stamp_duty_challan_no, stamp_duty_amount, stamp_duty_paid_date, stamp_duty_rate_pct, stamp_duty_doc_url } = req.body;
  try {
    const result = await db.query(
      `UPDATE contracts 
       SET stamp_duty_challan_no = $1,
           stamp_duty_amount = $2,
           stamp_duty_paid_date = $3,
           stamp_duty_rate_pct = COALESCE($4, stamp_duty_rate_pct),
           stamp_duty_doc_url = COALESCE($5, stamp_duty_doc_url)
       WHERE id = $6
       RETURNING *`,
      [
        stamp_duty_challan_no,
        parseFloat(stamp_duty_amount || 0),
        stamp_duty_paid_date || new Date(),
        stamp_duty_rate_pct ? parseFloat(stamp_duty_rate_pct) : 0.25,
        stamp_duty_doc_url || null,
        req.params.id
      ]
    );

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Provincial e-Stamp Duty Challan verified and recorded successfully.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 6. PAST PERFORMANCE PORTFOLIO EXPORT
// ============================================================================

router.get('/portfolio', optionalAuth, async (req, res) => {
  try {
    let queryText = `SELECT * FROM v_past_performance_portfolio WHERE 1=1`;
    const params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND tenant_id::text = $${params.length}`;
    }

    queryText += ` ORDER BY start_date DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
