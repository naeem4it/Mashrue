const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');
const { requirePermission, resolveTenantId, sanitizePrices } = require('../middleware/rbac.middleware');

// Auto-migration for quotation enhancements
(async () => {
  try {
    await db.query(`
      ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS is_quotation BOOLEAN DEFAULT FALSE;
      ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS quotation_category VARCHAR(50) DEFAULT 'Private Commercial';
      ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS quotation_validity_days INTEGER DEFAULT 30;
      ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS delivery_lead_time VARCHAR(100);
      ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100);
      ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS rfq_reference VARCHAR(100);
    `);
  } catch (err) {
    console.warn('Opportunities quotation schema migration note:', err.message);
  }
})();

// GET all opportunities (Tenders and Direct Sales) - Tenant Isolated & Price Protected
router.get('/', authenticate, requirePermission('opportunities', 'view'), async (req, res) => {
  const { business_profile_id, status, tender_source, tender_type, scope } = req.query;

  try {
    let queryText = `
      SELECT o.*, 
             bp.business_name as business_name, 
             c.business_name as customer_name,
             c.org_type as customer_org_type,
             COALESCE(t.company_name, 'Default Org') as tenant_name,
             u.full_name as client_admin_name,
             u.username as client_admin_username,
             (SELECT COUNT(*) FROM tender_items ti WHERE ti.opportunity_id = o.id) as item_count,
             (SELECT COUNT(*) FROM bid_securities bs WHERE bs.opportunity_id = o.id AND bs.status IN ('Active', 'Submitted')) as active_bid_securities_count,
             (SELECT COUNT(*) FROM opportunity_requirements r WHERE r.opportunity_id = o.id) as req_count
      FROM opportunities o
      LEFT JOIN business_profiles bp ON o.business_profile_id = bp.id
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN tenants t ON o.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT full_name, username FROM users 
        WHERE tenant_id = o.tenant_id AND role IN ('ClientAdmin', 'CompanyAdmin')
        ORDER BY created_at ASC LIMIT 1
      ) u ON true
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

    if (scope === 'quotations') {
      queryText += ` AND (o.tender_type = 'Direct Sales / Quotation' OR o.is_quotation = TRUE OR UPPER(o.tender_source) = 'DIRECT SALES' OR UPPER(o.tender_source) = 'GOVT QUOTATION')`;
    } else if (scope === 'tenders') {
      queryText += ` AND (o.tender_type != 'Direct Sales / Quotation' OR o.tender_type IS NULL) AND (o.is_quotation IS NOT TRUE) AND (UPPER(COALESCE(o.tender_source, '')) NOT IN ('DIRECT SALES', 'GOVT QUOTATION'))`;
    }

    queryText += ` ORDER BY COALESCE(o.opening_date, o.closing_date, o.created_at::date) DESC, o.created_at DESC`;

    const result = await db.query(queryText, params);
    const canSeePrices = req.user ? req.user.canSeeBiddingPrices : true;
    const sanitizedData = sanitizePrices(result.rows, canSeePrices);

    res.json({ success: true, data: sanitizedData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single opportunity by ID with items, requirements, and linked bid security
router.get('/:id', authenticate, requirePermission('opportunities', 'view'), async (req, res) => {
  const userRole = req.user?.role || req.headers['x-user-role'] || 'ClientAdmin';

  try {
    let queryText = `SELECT o.*, 
              COALESCE(bp.business_name, (SELECT bp2.business_name FROM business_profiles bp2 WHERE bp2.tenant_id = o.tenant_id ORDER BY bp2.created_at ASC LIMIT 1), t.company_name, 'Mashrue Enterprise') as business_name,
              COALESCE(bp.legal_name, (SELECT bp2.legal_name FROM business_profiles bp2 WHERE bp2.tenant_id = o.tenant_id ORDER BY bp2.created_at ASC LIMIT 1), t.company_name) as business_legal_name,
              COALESCE(bp.ntn, (SELECT bp2.ntn FROM business_profiles bp2 WHERE bp2.tenant_id = o.tenant_id ORDER BY bp2.created_at ASC LIMIT 1), '') as business_ntn,
              COALESCE(bp.strn, (SELECT bp2.strn FROM business_profiles bp2 WHERE bp2.tenant_id = o.tenant_id ORDER BY bp2.created_at ASC LIMIT 1), '') as business_strn,
              COALESCE(bp.address, (SELECT bp2.address FROM business_profiles bp2 WHERE bp2.tenant_id = o.tenant_id ORDER BY bp2.created_at ASC LIMIT 1), '') as business_address,
              COALESCE(bp.phone, (SELECT bp2.phone FROM business_profiles bp2 WHERE bp2.tenant_id = o.tenant_id ORDER BY bp2.created_at ASC LIMIT 1), '') as business_phone,
              COALESCE(bp.email, (SELECT bp2.email FROM business_profiles bp2 WHERE bp2.tenant_id = o.tenant_id ORDER BY bp2.created_at ASC LIMIT 1), '') as business_email,
              COALESCE(bp.logo_url, (SELECT bp2.logo_url FROM business_profiles bp2 WHERE bp2.tenant_id = o.tenant_id ORDER BY bp2.created_at ASC LIMIT 1), '') as business_logo_url,
              t.company_name as tenant_company_name,
              c.business_name as customer_name, 
              c.org_type as customer_org_type, 
              c.ntn as customer_ntn
       FROM opportunities o
       LEFT JOIN business_profiles bp ON o.business_profile_id = bp.id
       LEFT JOIN tenants t ON o.tenant_id = t.id
       LEFT JOIN customers c ON o.customer_id = c.id
       WHERE o.id::text = $1`;
    const params = [String(req.params.id)];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND o.tenant_id::text = $${params.length}`;
    }

    const oppRes = await db.query(queryText, params);

    if (oppRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Opportunity/Tender not found' });
    }

    // Fetch Tender Items with linked Warehouse and Product Stock
    const itemsRes = await db.query(
      `SELECT ti.*, 
              p.sku, p.current_stock, p.cost_price as standard_cost_price,
              p.item_type as product_item_type, p.brand_name as product_brand_name,
              w.warehouse_name, w.city as warehouse_city,
              ws.quantity_on_hand as warehouse_stock_on_hand,
              (COALESCE(ws.quantity_on_hand, 0) - COALESCE(ws.quantity_reserved, 0)) as warehouse_stock_available
       FROM tender_items ti
       LEFT JOIN products_services p ON ti.product_service_id = p.id
       LEFT JOIN warehouses w ON ti.warehouse_id = w.id
       LEFT JOIN warehouse_stock ws ON (ti.warehouse_id = ws.warehouse_id AND ti.product_service_id = ws.product_id)
       WHERE ti.opportunity_id::text = $1 
       ORDER BY ti.created_at ASC`,
      [String(req.params.id)]
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
      `SELECT * FROM bid_securities WHERE opportunity_id::text = $1 ORDER BY created_at DESC`,
      [String(req.params.id)]
    );

    // Fetch Requirements
    const reqRes = await db.query(
      `SELECT * FROM opportunity_requirements WHERE opportunity_id::text = $1 ORDER BY created_at ASC`,
      [String(req.params.id)]
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
router.post('/', authenticate, requirePermission('opportunities', 'add'), async (req, res) => {
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
    workflow_gates,
    items,
    is_quotation,
    quotation_category,
    quotation_validity_days,
    delivery_lead_time,
    payment_terms,
    rfq_reference
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

    const isQuote = !!(is_quotation || tender_type === 'Direct Sales / Quotation' || tender_source === 'DIRECT SALES' || tender_source === 'GOVT QUOTATION');
    const oppNumber = opportunity_number || (isQuote 
      ? `QTN-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}` 
      : `TND-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`);
    const nameStr = tender_name || title;
    const titleStr = title || tender_name;

    console.log('[OPPORTUNITY CREATE REQUEST]:', {
      user: req.user?.email || 'unauthenticated',
      tenantId,
      opportunity_number: oppNumber,
      tender_name: nameStr,
      isQuote,
      closing_date
    });
    // Enforce dynamic tender quota leverage according to subscription
    if (req.user?.role !== 'SuperAdmin' && !isQuote) {
      try {
        const tenantRow = await db.query(`SELECT subscription_plan, tender_limit, status FROM tenants WHERE id = $1`, [tenantId]);
        if (tenantRow.rows.length > 0) {
          const tnt = tenantRow.rows[0];
          if (tnt.status === 'Suspended') {
            return res.status(403).json({ success: false, message: 'Your organization workspace is suspended due to pending subscription payment.' });
          }
          const tLimit = tnt.tender_limit;
          const isUnlimited = (tLimit === 'unlimited' || tLimit === -1 || tLimit === null || tLimit === 'Unlimited' || tnt.subscription_plan === 'Advance' || tnt.subscription_plan === 'Enterprise');
          if (!isUnlimited) {
            const maxAllowed = parseInt(tLimit, 10) || 5;
            const countRes = await db.query(`SELECT COUNT(*) FROM opportunities WHERE tenant_id = $1 AND (is_quotation IS NOT TRUE)`, [tenantId]);
            const currentCount = parseInt(countRes.rows[0]?.count || 0, 10);
            if (currentCount >= maxAllowed) {
              return res.status(402).json({
                success: false,
                quotaExceeded: true,
                message: `Tender Quota Reached: Your organization subscription package allows ${maxAllowed} commercial tenders (${currentCount} created). Please upgrade your subscription plan or contact administrator.`
              });
            }
          }
        }
      } catch (quotaErr) {
        console.warn('Tender quota check warning:', quotaErr.message);
      }
    }

    // Strict duplicate check
    const dupCheck = await db.query(
      `SELECT id FROM opportunities 
       WHERE (LOWER(tender_name) = LOWER($1) OR (external_tender_number IS NOT NULL AND LOWER(external_tender_number) = LOWER($2))) 
         AND tenant_id = $3`,
      [nameStr.trim(), (external_tender_number || rfq_reference || '').trim(), tenantId]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Duplicate Error: A record named "${nameStr.trim()}" or reference number already exists in your organization.`
      });
    }

    // Resolve workflow gates from tender payload or standard default
    let gates = workflow_gates;
    if (!gates) {
      gates = {
        requires_bid_security: !isQuote,
        requires_performance_guarantee: !isQuote,
        requires_stamp_duty: !isQuote,
        requires_dtl_inspection: false,
        requires_fbr_e_invoice: true,
        requires_diary_tracking: !isQuote
      };
    }

    const safeClosing = parseSafeDate(closing_date) || new Date(Date.now() + 20 * 86400000);
    const safeSubmission = parseSafeDate(submission_deadline) || safeClosing;
    const safeOpening = parseSafeDate(opening_date);

    const result = await db.query(
      `INSERT INTO opportunities 
       (tenant_id, business_profile_id, opportunity_number, external_tender_number, tender_name, title, tender_source, tender_type, description, customer_id, department, publication_date, closing_date, submission_deadline, opening_date, estimated_value, currency, location, status, selection_status, workflow_gates, is_quotation, quotation_category, quotation_validity_days, delivery_lead_time, payment_terms, rfq_reference)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
       RETURNING *`,
      [
        tenantId,
        business_profile_id,
        oppNumber,
        external_tender_number || rfq_reference || null,
        nameStr,
        titleStr,
        tender_source || (isQuote ? 'DIRECT SALES' : 'PPRA'),
        tender_type || (isQuote ? 'Direct Sales / Quotation' : 'Public Tender'),
        description || '',
        customer_id || null,
        department || null,
        publication_date || new Date(),
        safeClosing,
        safeSubmission,
        safeOpening,
        parseFloat(estimated_value || 0),
        currency || 'PKR',
        location || 'Pakistan',
        'New',
        'Pending',
        JSON.stringify(gates),
        isQuote,
        quotation_category || (tender_source === 'GOVT QUOTATION' ? 'Government Departmental' : 'Private Commercial'),
        parseInt(quotation_validity_days || 30, 10),
        delivery_lead_time || '10-15 Working Days',
        payment_terms || '30 Days Net',
        rfq_reference || external_tender_number || null
      ]
    );

    const createdOpp = result.rows[0];

    // Insert Items if provided (Auto-population)
    if (items && Array.isArray(items) && items.length > 0) {
      for (const itm of items) {
        const prodId = itm.product_service_id || null;
        const whId = itm.warehouse_id || null;
        const itemQty = parseFloat(itm.quantity || 1);
        const unitCost = parseFloat(itm.unit_cost || 0);
        const estUnitPrice = parseFloat(itm.estimated_unit_price || 0);
        const estTotalPrice = estUnitPrice * itemQty;
        const isReserved = !!itm.stock_reserved;
        const batchNo = itm.batch_number || null;
        const brandName = itm.brand_name || null;
        const dom = parseSafeDate(itm.manufacturing_date || itm.dom);
        const doe = parseSafeDate(itm.expiry_date || itm.doe);
        const stockAtTender = parseFloat(itm.stock_at_time_of_tender || 0);

        try {
          await db.query(
            `INSERT INTO tender_items 
             (opportunity_id, product_service_id, warehouse_id, item_name, item_description, quantity, unit, estimated_unit_price, estimated_total_price, item_size, item_variant, batch_number, stock_at_time_of_tender, stock_reserved, unit_cost, brand_name, manufacturing_date, expiry_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
            [
              createdOpp.id,
              prodId,
              whId,
              itm.item_name || 'Generic Item',
              itm.item_description || '',
              itemQty,
              itm.unit || 'PCS',
              estUnitPrice,
              estTotalPrice,
              itm.item_size || itm.size || null,
              itm.item_variant || itm.variant || null,
              batchNo,
              stockAtTender,
              isReserved,
              unitCost,
              brandName,
              dom,
              doe
            ]
          );

          // If reservation requested and warehouse selected, register stock reservation
          if (isReserved && prodId && whId) {
            await db.query(
              `INSERT INTO stock_reservations 
               (tenant_id, opportunity_id, product_id, warehouse_id, batch_number, reserved_quantity, status, reserved_by)
               VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7)`,
              [tenantId, createdOpp.id, prodId, whId, batchNo || 'LOT-PRIMARY', itemQty, req.user?.id || null]
            );

            await db.query(
              `INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, batch_number, quantity_on_hand, quantity_reserved)
               VALUES ($1, $2, $3, $4, 0, $5)
               ON CONFLICT (warehouse_id, product_id, batch_number)
               DO UPDATE SET quantity_reserved = warehouse_stock.quantity_reserved + $5, updated_at = CURRENT_TIMESTAMP`,
              [tenantId, whId, prodId, batchNo || 'LOT-PRIMARY', itemQty]
            );
          }
        } catch (colErr) {
          await db.query(
            `INSERT INTO tender_items 
             (opportunity_id, product_service_id, item_name, item_description, quantity, unit, estimated_unit_price, estimated_total_price, item_size)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              createdOpp.id,
              prodId,
              itm.item_name || 'Generic Item',
              itm.item_description || '',
              itemQty,
              itm.unit || 'PCS',
              estUnitPrice,
              estTotalPrice,
              itm.item_size || itm.size || null
            ]
          );
        }
      }
    }

    res.status(201).json({
      success: true,
      data: createdOpp,
      message: 'Tender/Opportunity registered successfully. Proceed to Bid Security & Selection.'
    });
  } catch (err) {
    console.error('[OPPORTUNITY CREATE ERROR]:', err);
    res.status(500).json({ success: false, error: err.message, message: `Database error saving tender: ${err.message}` });
  }
});

// POST Tender Selection Decision (Select / Reject)
router.post('/:id/select', authenticate, requirePermission('opportunities', 'edit'), async (req, res) => {
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
router.post('/:id/items', authenticate, requirePermission('opportunities', 'edit'), async (req, res) => {
  const { product_service_id, item_name, item_description, quantity, unit, estimated_unit_price, brand_name, batch_number, manufacturing_date, expiry_date, dom, doe } = req.body;

  try {
    const qty = parseFloat(quantity || 1);
    const unitPrice = parseFloat(estimated_unit_price || 0);
    const totalPrice = qty * unitPrice;
    const safeDom = parseSafeDate(manufacturing_date || dom);
    const safeDoe = parseSafeDate(expiry_date || doe);

    const result = await db.query(
      `INSERT INTO tender_items 
       (opportunity_id, product_service_id, item_name, item_description, quantity, unit, estimated_unit_price, estimated_total_price, brand_name, batch_number, manufacturing_date, expiry_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [req.params.id, product_service_id || null, item_name, item_description || '', qty, unit || 'PCS', unitPrice, totalPrice, brand_name || null, batch_number || null, safeDom, safeDoe]
    );

    res.status(201).json({ success: true, data: result.rows[0], message: 'Item added to tender' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

function parseSafeDate(dStr) {
  if (!dStr || dStr === 'N/A' || dStr === 'null' || dStr === 'undefined') return null;
  if (dStr instanceof Date) {
    if (isNaN(dStr.getTime())) return null;
    return dStr.toISOString().split('T')[0];
  }
  const str = String(dStr).trim();
  if (str.includes('/')) {
    const parts = str.split(/[\s,]+/)[0].split('/');
    if (parts.length === 3) {
      // DD/MM/YYYY -> YYYY-MM-DD
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
  const parsed = new Date(dStr);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0];
}

// PUT update opportunity / tender / quotation details
router.put('/:id', optionalAuth, async (req, res) => {
  const {
    tender_name,
    title,
    tender_source,
    tender_type,
    external_tender_number,
    business_profile_id,
    currency,
    customer_id,
    department,
    closing_date,
    submission_deadline,
    opening_date,
    estimated_value,
    status,
    description,
    workflow_gates,
    items
  } = req.body;

  try {
    const safeClosing = parseSafeDate(closing_date);
    const safeSubmission = parseSafeDate(submission_deadline) || safeClosing;
    const safeOpening = parseSafeDate(opening_date);

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
           workflow_gates = COALESCE($14::jsonb, workflow_gates),
           business_profile_id = COALESCE($15, business_profile_id),
           currency = COALESCE($16, currency),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $17
    `;
    const params = [
      tender_name || null,
      title || tender_name || null,
      tender_source || null,
      tender_type || null,
      external_tender_number || null,
      customer_id || null,
      department || null,
      safeClosing || null,
      safeSubmission || null,
      safeOpening || null,
      estimated_value !== undefined ? parseFloat(estimated_value) : null,
      status || null,
      description || null,
      workflow_gates ? (typeof workflow_gates === 'object' ? JSON.stringify(workflow_gates) : workflow_gates) : null,
      business_profile_id || null,
      currency || null,
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

    // Synchronize tender items if passed
    if (items && Array.isArray(items)) {
      try {
        // Release previous reservations for this opportunity first before re-syncing
        const oldRes = await db.query(`SELECT * FROM stock_reservations WHERE opportunity_id = $1 AND status = 'Active'`, [req.params.id]);
        for (const r of oldRes.rows) {
          await db.query(
            `UPDATE warehouse_stock 
             SET quantity_reserved = GREATEST(0, quantity_reserved - $1), updated_at = CURRENT_TIMESTAMP
             WHERE warehouse_id = $2 AND product_id = $3 AND batch_number = $4`,
            [parseFloat(r.reserved_quantity), r.warehouse_id, r.product_id, r.batch_number]
          );
        }
        await db.query(`DELETE FROM stock_reservations WHERE opportunity_id = $1`, [req.params.id]);
        await db.query(`DELETE FROM tender_items WHERE opportunity_id = $1`, [req.params.id]);

        const oppTenantId = result.rows[0]?.tenant_id || req.user?.tenantId || 'a0000000-0000-0000-0000-000000000001';

        for (const itm of items) {
          const prodId = itm.product_service_id || null;
          const whId = itm.warehouse_id || null;
          const itemQty = parseFloat(itm.quantity || 1);
          const unitCost = parseFloat(itm.unit_cost || 0);
          const estUnitPrice = parseFloat(itm.estimated_unit_price || 0);
          const estTotalPrice = estUnitPrice * itemQty;
          const isReserved = !!itm.stock_reserved;
          const batchNo = itm.batch_number || null;
          const brandName = itm.brand_name || null;
          const dom = parseSafeDate(itm.manufacturing_date || itm.dom);
          const doe = parseSafeDate(itm.expiry_date || itm.doe);
          const stockAtTender = parseFloat(itm.stock_at_time_of_tender || 0);

          try {
            await db.query(
              `INSERT INTO tender_items 
               (opportunity_id, product_service_id, warehouse_id, item_name, item_description, quantity, unit, estimated_unit_price, estimated_total_price, item_size, item_variant, batch_number, stock_at_time_of_tender, stock_reserved, unit_cost, brand_name, manufacturing_date, expiry_date)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
              [
                req.params.id,
                prodId,
                whId,
                itm.item_name || itm.item_description || 'Scope Item',
                itm.item_description || itm.item_name || '',
                itemQty,
                itm.unit || 'PCS',
                estUnitPrice,
                estTotalPrice,
                itm.item_size || itm.size || null,
                itm.item_variant || itm.variant || null,
                batchNo,
                stockAtTender,
                isReserved,
                unitCost,
                brandName,
                dom,
                doe
              ]
            );

            // If reservation requested and warehouse selected, register stock reservation
            if (isReserved && prodId && whId) {
              await db.query(
                `INSERT INTO stock_reservations 
                 (tenant_id, opportunity_id, product_id, warehouse_id, batch_number, reserved_quantity, status, reserved_by)
                 VALUES ($1, $2, $3, $4, $5, $6, 'Active', $7)`,
                [oppTenantId, req.params.id, prodId, whId, batchNo || 'LOT-PRIMARY', itemQty, req.user?.id || null]
              );

              await db.query(
                `INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, batch_number, quantity_on_hand, quantity_reserved)
                 VALUES ($1, $2, $3, $4, 0, $5)
                 ON CONFLICT (warehouse_id, product_id, batch_number)
                 DO UPDATE SET quantity_reserved = warehouse_stock.quantity_reserved + $5, updated_at = CURRENT_TIMESTAMP`,
                [oppTenantId, whId, prodId, batchNo || 'LOT-PRIMARY', itemQty]
              );
            }
          } catch (colErr) {
            await db.query(
              `INSERT INTO tender_items 
               (opportunity_id, product_service_id, item_name, item_description, quantity, unit, estimated_unit_price, estimated_total_price, item_size)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                req.params.id,
                prodId,
                itm.item_name || itm.item_description || 'Scope Item',
                itm.item_description || itm.item_name || '',
                itemQty,
                itm.unit || 'PCS',
                estUnitPrice,
                estTotalPrice,
                itm.item_size || itm.size || null
              ]
            );
          }
        }
      } catch (itemErr) {
        console.warn('Error synchronizing tender items on update:', itemErr.message);
      }
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: 'Tender record and scope items updated successfully'
    });
  } catch (err) {
    console.error('[OPPORTUNITY UPDATE ERROR]:', err);
    res.status(500).json({ success: false, error: err.message, message: `Database error updating tender: ${err.message}` });
  }
});

// DELETE opportunity / tender (Admin / Super Admin)
router.delete('/:id', optionalAuth, async (req, res) => {
  const { id } = req.params;
  try {
    let queryText = `DELETE FROM opportunities WHERE id::text = $1`;
    const params = [String(id)];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND tenant_id::text = $2`;
    }

    // Clean up associated items, bid securities, requirements
    try {
      await db.query(`DELETE FROM tender_items WHERE opportunity_id::text = $1`, [String(id)]);
      await db.query(`DELETE FROM opportunity_requirements WHERE opportunity_id::text = $1`, [String(id)]);
    } catch (e) {}

    await db.query(queryText, params);
    res.json({ success: true, message: 'Tender record deleted successfully.' });
  } catch (err) {
    console.error('[OPPORTUNITY DELETE ERROR]:', err);
    res.status(500).json({ success: false, error: err.message, message: `Database error deleting tender: ${err.message}` });
  }
});

module.exports = router;
