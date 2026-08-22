const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');
const { requirePermission, sanitizePrices } = require('../middleware/rbac.middleware');

// GET all opportunities (Tenders and Direct Sales) - Tenant Isolated & Price Protected
router.get('/', optionalAuth, async (req, res) => {
  const { business_profile_id, status, tender_source, tender_type } = req.query;

  try {
    let queryText = `
      SELECT o.*, 
             bp.business_name as business_name, 
             c.business_name as customer_name,
             c.org_type as customer_org_type,
             (SELECT COUNT(*) FROM tender_items ti WHERE ti.opportunity_id = o.id) as item_count,
             (SELECT COUNT(*) FROM bid_securities bs WHERE bs.opportunity_id = o.id AND bs.status IN ('Active', 'Submitted')) as active_bid_securities_count,
             (SELECT COUNT(*) FROM opportunity_requirements r WHERE r.opportunity_id = o.id) as req_count
      FROM opportunities o
      LEFT JOIN business_profiles bp ON o.business_profile_id = bp.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE 1=1
    `;
    const params = [];

    // Tenant Isolation
    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND o.tenant_id::text = $${params.length}`;

        // If employee has specific assigned companies
        if (req.user.role === 'ClientEmployee' && req.user.assignedBusinessProfiles && req.user.assignedBusinessProfiles.length > 0) {
          params.push(req.user.assignedBusinessProfiles);
          queryText += ` AND o.business_profile_id = ANY($${params.length}::uuid[])`;
        }
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      queryText += ` AND o.business_profile_id = $${params.length}`;
    }

    if (status && status !== 'all') {
      params.push(status);
      queryText += ` AND LOWER(o.status) = LOWER($${params.length})`;
    }

    if (tender_source && tender_source !== 'all') {
      params.push(tender_source);
      queryText += ` AND UPPER(o.tender_source) = UPPER($${params.length})`;
    }

    if (tender_type && tender_type !== 'all') {
      params.push(tender_type);
      queryText += ` AND o.tender_type = $${params.length}`;
    }

    queryText += ` ORDER BY o.closing_date ASC, o.created_at DESC`;

    const result = await db.query(queryText, params);
    const canSeePrices = req.user ? req.user.canSeeBiddingPrices : true;
    const sanitizedData = sanitizePrices(result.rows, canSeePrices);

    res.json({ success: true, data: sanitizedData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single opportunity by ID with items, requirements, and linked bid security
router.get('/:id', optionalAuth, async (req, res) => {
  const userRole = req.user?.role || req.headers['x-user-role'] || 'ClientAdmin';

  try {
    let queryText = `SELECT o.*, 
              bp.business_name, 
              c.business_name as customer_name, 
              c.org_type as customer_org_type, 
              c.ntn as customer_ntn
       FROM opportunities o
       LEFT JOIN business_profiles bp ON o.business_profile_id = bp.id
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id = $1`;
    const params = [req.params.id];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND o.tenant_id::text = $${params.length}`;
    }

    const oppRes = await db.query(queryText, params);

    if (oppRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Opportunity/Tender not found' });
    }

    // Fetch Tender Items
    const itemsRes = await db.query(
      `SELECT ti.*, p.sku, p.current_stock
       FROM tender_items ti
       LEFT JOIN products_services p ON ti.product_service_id = p.id
       WHERE ti.opportunity_id = $1 
       ORDER BY ti.created_at ASC`,
      [req.params.id]
    );

    // Filter pricing if not CompanyAdmin or SuperAdmin
    const isAdmin = ['SuperAdmin', 'CompanyAdmin'].includes(userRole);
    const sanitizedItems = itemsRes.rows.map(item => {
      if (!isAdmin) {
        return {
          ...item,
          estimated_unit_price: null,
          estimated_total_price: null,
          _price_restricted: true
        };
      }
      return item;
    });

    // Fetch Bid Securities
    const secRes = await db.query(
      `SELECT * FROM bid_securities WHERE opportunity_id = $1 ORDER BY created_at DESC`,
      [req.params.id]
    );

    // Fetch Requirements
    const reqRes = await db.query(
      `SELECT * FROM opportunity_requirements WHERE opportunity_id = $1 ORDER BY created_at ASC`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...oppRes.rows[0],
        items: sanitizedItems,
        bidSecurities: secRes.rows,
        hasActiveBidSecurity: secRes.rows.some(s => ['Active', 'Submitted'].includes(s.status)),
        requirements: reqRes.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create new opportunity / tender / direct sales quotation
router.post('/', optionalAuth, async (req, res) => {
  const {
    business_profile_id,
    opportunity_number,
    external_tender_number,
    tender_name,
    title,
    tender_source,
    tender_type,
    description,
    customer_id,
    department,
    publication_date,
    closing_date,
    submission_deadline,
    opening_date,
    estimated_value,
    currency,
    location,
    items
  } = req.body;

  if (!tender_name && !title) {
    return res.status(400).json({ success: false, message: 'Tender Name/Title is mandatory' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const oppNumber = opportunity_number || (tender_source === 'DIRECT SALES' ? `QTN-${Date.now().toString().slice(-6)}` : `TND-${Date.now().toString().slice(-6)}`);
    const nameStr = tender_name || title;
    const titleStr = title || tender_name;

    const result = await db.query(
      `INSERT INTO opportunities 
       (tenant_id, business_profile_id, opportunity_number, external_tender_number, tender_name, title, tender_source, tender_type, description, customer_id, department, publication_date, closing_date, submission_deadline, opening_date, estimated_value, currency, location, status, selection_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING *`,
      [
        tenantId,
        business_profile_id,
        oppNumber,
        external_tender_number || null,
        nameStr,
        titleStr,
        tender_source || 'PPRA',
        tender_type || (tender_source === 'DIRECT SALES' ? 'Direct Sales / Quotation' : 'Public Tender'),
        description || '',
        customer_id || null,
        department || null,
        publication_date || new Date(),
        closing_date || new Date(Date.now() + 20 * 86400000),
        submission_deadline || closing_date || new Date(Date.now() + 20 * 86400000),
        opening_date || null,
        parseFloat(estimated_value || 0),
        currency || 'PKR',
        location || 'Pakistan',
        'New',
        'Pending'
      ]
    );

    const createdOpp = result.rows[0];

    // Insert Items if provided (Auto-population)
    if (items && Array.isArray(items) && items.length > 0) {
      for (const itm of items) {
        await db.query(
          `INSERT INTO tender_items 
           (opportunity_id, product_service_id, item_name, item_description, quantity, unit, estimated_unit_price, estimated_total_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            createdOpp.id,
            itm.product_service_id || null,
            itm.item_name || 'Generic Item',
            itm.item_description || '',
            parseFloat(itm.quantity || 1),
            itm.unit || 'PCS',
            parseFloat(itm.estimated_unit_price || 0),
            parseFloat(itm.estimated_unit_price || 0) * parseFloat(itm.quantity || 1)
          ]
        );
      }
    }

    res.status(201).json({
      success: true,
      data: createdOpp,
      message: 'Tender/Opportunity registered successfully. Proceed to Bid Security & Selection.'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Tender Selection Decision (Select / Reject)
router.post('/:id/select', async (req, res) => {
  const { selection_status, selection_reason, remarks } = req.body; // 'Selected' or 'Rejected'

  try {
    const isSelected = selection_status === 'Selected';
    const nextStatus = isSelected ? 'Selected' : 'Rejected';

    const result = await db.query(
      `UPDATE opportunities 
       SET selection_status = $1, 
           selection_reason = $2, 
           selection_date = CURRENT_TIMESTAMP, 
           status = $3,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING *`,
      [selection_status, selection_reason || remarks || '', nextStatus, req.params.id]
    );

    res.json({
      success: true,
      data: result.rows[0],
      message: isSelected ? 'Tender selected for Bid Preparation' : 'Tender rejected and closed'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Add or update Tender Items
router.post('/:id/items', async (req, res) => {
  const { product_service_id, item_name, item_description, quantity, unit, estimated_unit_price } = req.body;

  try {
    const qty = parseFloat(quantity || 1);
    const unitPrice = parseFloat(estimated_unit_price || 0);
    const totalPrice = qty * unitPrice;

    const result = await db.query(
      `INSERT INTO tender_items 
       (opportunity_id, product_service_id, item_name, item_description, quantity, unit, estimated_unit_price, estimated_total_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.params.id, product_service_id || null, item_name, item_description || '', qty, unit || 'PCS', unitPrice, totalPrice]
    );

    res.status(201).json({ success: true, data: result.rows[0], message: 'Item added to tender' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update opportunity / tender / quotation details
router.put('/:id', optionalAuth, async (req, res) => {
  const {
    tender_name,
    title,
    tender_source,
    tender_type,
    external_tender_number,
    customer_id,
    department,
    closing_date,
    submission_deadline,
    opening_date,
    estimated_value,
    status,
    description
  } = req.body;

  try {
    let queryText = `
      UPDATE opportunities
       SET tender_name = COALESCE($1, tender_name),
           title = COALESCE($2, title, tender_name),
           tender_source = COALESCE($3, tender_source),
           tender_type = COALESCE($4, tender_type),
           external_tender_number = COALESCE($5, external_tender_number),
           customer_id = COALESCE($6, customer_id),
           department = COALESCE($7, department),
           closing_date = COALESCE($8, closing_date),
           submission_deadline = COALESCE($9, submission_deadline, closing_date),
           opening_date = COALESCE($10, opening_date),
           estimated_value = COALESCE($11, estimated_value),
           status = COALESCE($12, status),
           description = COALESCE($13, description),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $14
    `;
    const params = [
      tender_name || null,
      title || tender_name || null,
      tender_source || null,
      tender_type || null,
      external_tender_number || null,
      customer_id || null,
      department || null,
      closing_date || null,
      submission_deadline || null,
      opening_date || null,
      estimated_value !== undefined ? parseFloat(estimated_value) : null,
      status || null,
      description || null,
      req.params.id
    ];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND tenant_id::text = $${params.length}`;
    }

    queryText += ` RETURNING *`;

    const result = await db.query(queryText, params);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Tender / Opportunity not found or unauthorized' });
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Tender record updated successfully'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
