const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { optionalAuth } = require('../middleware/auth.middleware');

// GET all purchase orders
router.get('/', optionalAuth, async (req, res) => {
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
router.get('/:id', optionalAuth, async (req, res) => {
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

// POST create new Purchase Order
router.post('/', optionalAuth, async (req, res) => {
  const {
    business_profile_id,
    contract_id,
    opportunity_id,
    customer_id,
    po_number,
    po_date,
    delivery_deadline,
    payment_terms,
    total_amount,
    tax_amount,
    items
  } = req.body;

  if (!po_number || !customer_id) {
    return res.status(400).json({ success: false, message: 'PO Number and Customer are mandatory' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const sub = parseFloat(total_amount || 0);
    const tax = parseFloat(tax_amount || 0);
    const net = sub + tax;

    const result = await db.query(
      `INSERT INTO purchase_orders 
       (tenant_id, business_profile_id, contract_id, opportunity_id, customer_id, po_number, po_date, delivery_deadline, payment_terms, total_amount, tax_amount, net_amount, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        tenantId,
        business_profile_id,
        contract_id || null,
        opportunity_id || null,
        customer_id,
        po_number,
        po_date || new Date(),
        delivery_deadline || null,
        payment_terms || 'Net 30 against DC',
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
        await db.query(
          `INSERT INTO purchase_order_items (purchase_order_id, product_service_id, item_description, quantity, unit_price, tax_rate, total_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            createdPO.id,
            itm.product_service_id || null,
            itm.item_description || 'PO Item',
            parseFloat(itm.quantity || 1),
            parseFloat(itm.unit_price || 0),
            parseFloat(itm.tax_rate || 0),
            parseFloat(itm.total_price || (parseFloat(itm.quantity || 1) * parseFloat(itm.unit_price || 0)))
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update Purchase Order
router.put('/:id', async (req, res) => {
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
