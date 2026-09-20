const { requirePermission, resolveTenantId, sanitizePrices, requireRoles } = require('../middleware/rbac.middleware');
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');

// GET all purchase orders
router.get('/', authenticate, requirePermission('purchase_orders', 'view'), async (req, res) => {
  const { business_profile_id, customer_id, status } = req.query;

  try {
    let queryText = `
      SELECT po.*, 
             c.business_name as customer_name,
             bp.business_name,
             cnt.contract_number,
             (SELECT COUNT(*) FROM delivery_challans dc WHERE dc.purchase_order_id = po.id) as dc_count,
             (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id) as item_count
      FROM purchase_orders po
      JOIN customers c ON po.customer_id = c.id
      JOIN business_profiles bp ON po.business_profile_id = bp.id
      LEFT JOIN contracts cnt ON po.contract_id = cnt.id
      WHERE 1=1
    `;
    const params = [];

    // Tenant Isolation
    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND po.tenant_id::text = $${params.length}`;

        if (req.user.role === 'ClientEmployee' && req.user.assignedBusinessProfiles && req.user.assignedBusinessProfiles.length > 0) {
          params.push(req.user.assignedBusinessProfiles);
          queryText += ` AND po.business_profile_id = ANY($${params.length}::uuid[])`;
        }
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      queryText += ` AND po.business_profile_id = $${params.length}`;
    }

    if (customer_id) {
      params.push(customer_id);
      queryText += ` AND po.customer_id = $${params.length}`;
    }

    if (status && status !== 'all') {
      params.push(status);
      queryText += ` AND po.status = $${params.length}`;
    }

    queryText += ` ORDER BY po.po_date DESC, po.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single PO with items
router.get('/:id', authenticate, requirePermission('purchase_orders', 'view'), async (req, res) => {
  try {
    let queryText = `SELECT po.*, c.business_name as customer_name, c.ntn as customer_ntn, bp.business_name
       FROM purchase_orders po
       JOIN customers c ON po.customer_id = c.id
       JOIN business_profiles bp ON po.business_profile_id = bp.id
       WHERE po.id = $1`;
    const params = [req.params.id];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND po.tenant_id::text = $${params.length}`;
    }

    const poRes = await db.query(queryText, params);

    if (poRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    }

    const itemsRes = await db.query(
      `SELECT poi.*, p.name as product_name, p.sku
       FROM purchase_order_items poi
       LEFT JOIN products_services p ON poi.product_service_id = p.id
       WHERE poi.purchase_order_id = $1`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...poRes.rows[0],
        items: itemsRes.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const isUuid = (str) => typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

function parseSafeDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().split('T')[0];
  const s = String(d).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const parts = s.split(/[\/\-\.]/);
  if (parts.length === 3) {
    if (parts[2].length === 4) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
  }
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt.toISOString().split('T')[0];
}

// POST create new Purchase Order
router.post('/', authenticate, async (req, res) => {
  const {
    business_profile_id,
    award_letter_id,
    contract_id,
    opportunity_id,
    customer_id,
    customer_name,
    po_number,
    po_date,
    delivery_deadline,
    delivery_location,
    department_name,
    payment_terms,
    total_amount,
    tax_amount,
    items
  } = req.body;

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId || !isUuid(tenantId)) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    let finalPoNo = (po_number || '').trim();
    if (!finalPoNo) {
      finalPoNo = `PO-${Date.now().toString().slice(-4)}`;
    }

    let finalCustId = isUuid(customer_id) ? customer_id : null;
    let finalBizId = isUuid(business_profile_id) ? business_profile_id : null;
    let finalOppId = isUuid(opportunity_id) ? opportunity_id : null;
    let finalAwardId = isUuid(award_letter_id) ? award_letter_id : null;
    let finalContractId = isUuid(contract_id) ? contract_id : null;

    // Resolve linkages from Award Letter if available
    if (finalAwardId && (!finalCustId || !finalBizId || !finalOppId || !finalContractId)) {
      const awRes = await db.query(
        `SELECT al.opportunity_id, o.customer_id, o.business_profile_id, cnt.id as contract_id
         FROM award_letters al 
         JOIN opportunities o ON al.opportunity_id = o.id 
         LEFT JOIN contracts cnt ON cnt.award_letter_id = al.id
         WHERE al.id = $1`,
        [finalAwardId]
      );
      if (awRes.rows.length > 0) {
        if (!finalCustId) finalCustId = awRes.rows[0].customer_id;
        if (!finalBizId) finalBizId = awRes.rows[0].business_profile_id;
        if (!finalOppId) finalOppId = awRes.rows[0].opportunity_id;
        if (!finalContractId && awRes.rows[0].contract_id) finalContractId = awRes.rows[0].contract_id;
      }
    }

    // Resolve linkages from Opportunity if available
    if (finalOppId && (!finalCustId || !finalBizId)) {
      const oppRes = await db.query(
        `SELECT customer_id, business_profile_id FROM opportunities WHERE id = $1`,
        [finalOppId]
      );
      if (oppRes.rows.length > 0) {
        if (!finalCustId) finalCustId = oppRes.rows[0].customer_id;
        if (!finalBizId) finalBizId = oppRes.rows[0].business_profile_id;
      }
    }

    // Fallback Customer by customer_name if still unassigned
    if (!finalCustId && customer_name && typeof customer_name === 'string' && customer_name.trim()) {
      const custRes = await db.query(
        `SELECT id FROM customers WHERE business_name ILIKE $1 LIMIT 1`,
        [`%${customer_name.trim()}%`]
      );
      if (custRes.rows.length > 0) {
        finalCustId = custRes.rows[0].id;
      }
    }

    // Fallback Customer to tenant's first customer
    if (!finalCustId) {
      const cFallback = await db.query(`SELECT id FROM customers WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
      finalCustId = cFallback.rows[0]?.id;
    }

    // Fallback Business Profile to tenant's first profile
    if (!finalBizId) {
      const bpRes = await db.query(`SELECT id FROM business_profiles WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
      finalBizId = bpRes.rows[0]?.id;
    }

    if (!finalCustId) {
      return res.status(400).json({ success: false, message: 'A valid Customer is required to issue a Purchase Order.' });
    }

    if (!finalBizId) {
      return res.status(400).json({ success: false, message: 'A valid Business Profile is required to issue a Purchase Order.' });
    }

    const sub = parseFloat(total_amount || 0);
    const tax = parseFloat(tax_amount || 0);
    const net = sub + tax;
    const safePoDate = parseSafeDate(po_date) || new Date().toISOString().split('T')[0];
    const safeDeadline = parseSafeDate(delivery_deadline);

    const result = await db.query(
      `INSERT INTO purchase_orders 
       (tenant_id, business_profile_id, award_letter_id, contract_id, opportunity_id, customer_id, po_number, po_date, delivery_deadline, delivery_location, department_name, payment_terms, total_amount, tax_amount, net_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        tenantId,
        finalBizId,
        finalAwardId,
        finalContractId,
        finalOppId,
        finalCustId,
        finalPoNo,
        safePoDate,
        safeDeadline,
        delivery_location || null,
        department_name || null,
        payment_terms || '90% Delivery + 10% PBG Release',
        sub,
        tax,
        net,
        'Issued'
      ]
    );

    const createdPO = result.rows[0];

    // Insert line items
    if (items && Array.isArray(items)) {
      for (const itm of items) {
        const safeAwardItemId = isUuid(itm.award_item_id) ? itm.award_item_id : null;
        const safeProdId = isUuid(itm.product_service_id) ? itm.product_service_id : null;
        const qty = parseFloat(itm.quantity || 1);
        const rate = parseFloat(itm.unit_price || 0);
        const taxRate = parseFloat(itm.tax_rate || 0);
        const total = parseFloat(itm.total_price || (qty * rate));

        await db.query(
          `INSERT INTO purchase_order_items (purchase_order_id, award_item_id, product_service_id, item_description, unit, awarded_quantity, quantity, unit_price, tax_rate, total_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            createdPO.id,
            safeAwardItemId,
            safeProdId,
            itm.item_description || itm.item_name || 'PO Item',
            itm.unit || 'PCS',
            parseFloat(itm.awarded_quantity || qty),
            qty,
            rate,
            taxRate,
            total
          ]
        );
      }
    }

    res.status(201).json({
      success: true,
      data: createdPO,
      message: 'Purchase Order issued successfully. You can now generate Delivery Challans (DC).'
    });
  } catch (err) {
    console.error('[POST /purchase-orders] Error:', err);
    res.status(500).json({ success: false, error: err.message, message: `Database error: ${err.message}` });
  }
});

// PUT update Purchase Order
router.put('/:id', authenticate, requirePermission('purchase_orders', 'edit'), async (req, res) => {
  const { po_number, po_date, delivery_deadline, payment_terms, total_amount, tax_amount, net_amount, status } = req.body;
  try {
    const sub = total_amount !== undefined ? parseFloat(total_amount) : null;
    const tax = tax_amount !== undefined ? parseFloat(tax_amount) : 0;
    const net = net_amount !== undefined ? parseFloat(net_amount) : (sub !== null ? sub + tax : null);

    const result = await db.query(
      `UPDATE purchase_orders
       SET po_number = COALESCE($1, po_number),
           po_date = COALESCE($2, po_date),
           delivery_deadline = COALESCE($3, delivery_deadline),
           payment_terms = COALESCE($4, payment_terms),
           total_amount = COALESCE($5, total_amount),
           tax_amount = COALESCE($6, tax_amount),
           net_amount = COALESCE($7, net_amount),
           status = COALESCE($8, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $9
       RETURNING *`,
      [
        po_number || null,
        po_date || null,
        delivery_deadline || null,
        payment_terms || null,
        sub,
        tax,
        net,
        status || null,
        req.params.id
      ]
    );

    res.json({ success: true, data: result.rows[0], message: 'Purchase Order updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
