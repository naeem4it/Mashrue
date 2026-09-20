const { requirePermission, resolveTenantId, sanitizePrices, requireRoles } = require('../middleware/rbac.middleware');
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');
const logger = require('../services/logger.service');

// ============================================================================
// 1. WAREHOUSES & CURRENT STOCK
// ============================================================================

router.get('/warehouses', authenticate, requirePermission('inventory', 'view'), async (req, res) => {
  try {
    let queryText = `
      SELECT w.*, 
             (SELECT COUNT(*) FROM inventory_transactions it WHERE it.warehouse_id = w.id) as total_tx_count
      FROM warehouses w
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND w.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    queryText += ` ORDER BY w.warehouse_name ASC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/warehouses', authenticate, requirePermission('inventory', 'add'), async (req, res) => {
  const { warehouse_name, location, city, manager_name, contact_phone } = req.body;

  if (!warehouse_name) {
    return res.status(400).json({ success: false, message: 'Warehouse Name is mandatory' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const result = await db.query(
      `INSERT INTO warehouses (tenant_id, warehouse_name, location, city, manager_name, contact_phone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, warehouse_name, location || null, city || 'Lahore', manager_name || null, contact_phone || null]
    );

    res.status(201).json({ success: true, data: result.rows[0], message: 'Warehouse created successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/inventory/transactions', authenticate, requirePermission('inventory', 'view'), async (req, res) => {
  const { product_id, warehouse_id } = req.query;

  try {
    let queryText = `
      SELECT it.*, 
             p.name as product_name, p.sku, p.unit,
             w.warehouse_name
      FROM inventory_transactions it
      JOIN products_services p ON it.product_id = p.id
      JOIN warehouses w ON it.warehouse_id = w.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND it.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    if (product_id) {
      params.push(product_id);
      queryText += ` AND it.product_id = $${params.length}`;
    }

    if (warehouse_id) {
      params.push(warehouse_id);
      queryText += ` AND it.warehouse_id = $${params.length}`;
    }

    queryText += ` ORDER BY it.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Record Stock Movement (Stock In / Stock Out / Adjustment / Transfer)
router.post('/inventory/transaction', authenticate, requirePermission('inventory', 'add'), async (req, res) => {
  const { product_id, warehouse_id, transaction_type, quantity, unit_cost, batch_number, serial_number, reference_type, remarks } = req.body;

  if (!product_id || !warehouse_id || !transaction_type || !quantity) {
    return res.status(400).json({ success: false, message: 'Product, Warehouse, Transaction Type, and Quantity are mandatory' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const qty = parseFloat(quantity);
    const cost = parseFloat(unit_cost || 0);

    const txRes = await db.query(
      `INSERT INTO inventory_transactions 
       (tenant_id, product_id, warehouse_id, transaction_type, quantity, unit_cost, batch_number, serial_number, reference_type, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [tenantId, product_id, warehouse_id, transaction_type, qty, cost, batch_number || null, serial_number || null, reference_type || 'MANUAL', remarks || null]
    );

    // Update current stock in product master
    const isIncrement = ['PURCHASE_RECEIPT', 'STOCK_IN', 'RETURN'].includes(transaction_type);
    const delta = isIncrement ? qty : -qty;

    await db.query(
      `UPDATE products_services 
       SET current_stock = GREATEST(0, current_stock + $1) 
       WHERE id = $2`,
      [delta, product_id]
    );

    res.status(201).json({
      success: true,
      data: txRes.rows[0],
      message: `Stock ${transaction_type} of ${qty} recorded successfully.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 2. PROCUREMENTS (LOCAL & IMPORT)
// ============================================================================

router.get('/procurements', authenticate, requirePermission('inventory', 'view'), async (req, res) => {
  try {
    let queryText = `
      SELECT pr.*, 
             s.supplier_name, s.origin as supplier_origin,
             po.po_number,
             bp.business_name
      FROM procurements pr
      JOIN suppliers s ON pr.supplier_id = s.id
      JOIN business_profiles bp ON pr.business_profile_id = bp.id
      LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND pr.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    queryText += ` ORDER BY pr.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/procurements', authenticate, requirePermission('inventory', 'add'), async (req, res) => {
  const {
    business_profile_id,
    purchase_order_id,
    supplier_id,
    procurement_type, // 'Local' or 'Import'
    procurement_number,
    currency,
    exchange_rate,
    origin_country,
    customs_duty,
    freight_charges,
    clearing_charges,
    other_charges,
    base_purchase_price
  } = req.body;

  if (!supplier_id || !procurement_type) {
    return res.status(400).json({ success: false, message: 'Supplier and Procurement Type are mandatory' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const base = parseFloat(base_purchase_price || 0);
    const exRate = parseFloat(exchange_rate || 1);
    const duty = parseFloat(customs_duty || 0);
    const freight = parseFloat(freight_charges || 0);
    const clearing = parseFloat(clearing_charges || 0);
    const other = parseFloat(other_charges || 0);

    const landedCost = (base * exRate) + duty + freight + clearing + other;

    const result = await db.query(
      `INSERT INTO procurements 
       (tenant_id, business_profile_id, purchase_order_id, supplier_id, procurement_type, procurement_number, currency, exchange_rate, origin_country, customs_duty, freight_charges, clearing_charges, other_charges, total_landed_cost, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        tenantId,
        business_profile_id,
        purchase_order_id || null,
        supplier_id,
        procurement_type,
        procurement_number || `PROC-${Date.now().toString().slice(-6)}`,
        currency || (procurement_type === 'Import' ? 'USD' : 'PKR'),
        exRate,
        origin_country || (procurement_type === 'Import' ? 'UAE' : 'Pakistan'),
        duty,
        freight,
        clearing,
        other,
        landedCost,
        'Ordered'
      ]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: `${procurement_type} Procurement logged. Landed cost: PKR ${landedCost.toLocaleString()}`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 3. SUPPLY & DELIVERY CHALLAN (DC) & LOGISTICS
// Business Rule: PO is strictly required for Delivery Challan!
// ============================================================================

router.get('/delivery-challans', authenticate, requirePermission('delivery_challans', 'view'), async (req, res) => {
  const { purchase_order_id, business_profile_id } = req.query;

  try {
    let queryText = `
      SELECT dc.*, 
             po.po_number, po.net_amount as po_amount,
             c.business_name as customer_name,
             w.warehouse_name,
             bp.business_name,
             (SELECT COUNT(*) FROM delivery_challan_items dci WHERE dci.delivery_challan_id = dc.id) as item_count,
             (SELECT COUNT(*) FROM invoices inv WHERE inv.delivery_challan_id = dc.id) as invoice_count
      FROM delivery_challans dc
      JOIN purchase_orders po ON dc.purchase_order_id = po.id
      JOIN customers c ON dc.customer_id = c.id
      JOIN warehouses w ON dc.warehouse_id = w.id
      JOIN business_profiles bp ON dc.business_profile_id = bp.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND dc.tenant_id::text = $${params.length}`;

        if (req.user.role === 'ClientEmployee' && req.user.assignedBusinessProfiles && req.user.assignedBusinessProfiles.length > 0) {
          params.push(req.user.assignedBusinessProfiles);
          queryText += ` AND dc.business_profile_id = ANY($${params.length}::uuid[])`;
        }
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    if (purchase_order_id) {
      params.push(purchase_order_id);
      queryText += ` AND dc.purchase_order_id = $${params.length}`;
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      queryText += ` AND dc.business_profile_id = $${params.length}`;
    }

    queryText += ` ORDER BY dc.delivery_date DESC, dc.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create Delivery Challan
// Enforce Rule: PO required for DC!
const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val || ''));

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

router.post('/delivery-challans', authenticate, requirePermission('delivery_challans', 'add'), async (req, res) => {
  const {
    business_profile_id,
    purchase_order_id,
    warehouse_id,
    dc_number,
    delivery_date,
    delivery_mode, // 'Own Warehouse' or 'Direct Drop-Shipment'
    delivery_method, // 'Hired Delivery' or '3PL' or '3PL Heavy Logistics'
    logistics_provider,
    tracking_number,
    bilty_number,
    vehicle_number,
    driver_name,
    driver_contact,
    freight_cost_contractor,
    customs_handling_cost,
    delivery_cost,
    origin_location,
    destination_site,
    supplier_id,
    remarks,
    items
  } = req.body;

  // Validation: PO is mandatory
  if (!purchase_order_id) {
    return res.status(400).json({
      success: false,
      message: 'Business Rule Violation: A valid Purchase Order (PO) is required before issuing a Delivery Challan.'
    });
  }

  try {
    let poRes;
    if (isUuid(purchase_order_id)) {
      poRes = await db.query(`SELECT * FROM purchase_orders WHERE id = $1`, [purchase_order_id]);
    }
    if (!poRes || poRes.rows.length === 0) {
      poRes = await db.query(`SELECT * FROM purchase_orders WHERE po_number = $1`, [purchase_order_id]);
    }

    if (!poRes || poRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Purchase Order not found in database.' });
    }
    const po = poRes.rows[0];

    const tenantId = po.tenant_id || req.user?.tenantId || '87ed30e8-80df-46fb-b99f-ecf73fe13d04';
    const cleanBizId = (business_profile_id && isUuid(business_profile_id)) ? business_profile_id : (po.business_profile_id || null);
    const cleanCustId = po.customer_id;
    const finalDeliveryMode = delivery_mode || (warehouse_id ? 'Own Warehouse' : 'Direct Drop-Shipment');

    // Safe Warehouse ID resolution
    let cleanWarehouseId = (warehouse_id && isUuid(warehouse_id)) ? warehouse_id : null;
    if (cleanWarehouseId) {
      const wCheck = await db.query(`SELECT id FROM warehouses WHERE id = $1`, [cleanWarehouseId]);
      if (wCheck.rows.length === 0) cleanWarehouseId = null;
    }

    // If fulfillment is from Own Warehouse and warehouse was not provided or invalid, resolve fallback warehouse
    if (finalDeliveryMode === 'Own Warehouse' && !cleanWarehouseId) {
      const wRes = await db.query(`SELECT id FROM warehouses WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`, [tenantId]);
      if (wRes.rows.length > 0) {
        cleanWarehouseId = wRes.rows[0].id;
      } else {
        const wGlobal = await db.query(`SELECT id FROM warehouses ORDER BY created_at ASC LIMIT 1`);
        if (wGlobal.rows.length > 0) {
          cleanWarehouseId = wGlobal.rows[0].id;
        } else {
          const wNew = await db.query(
            `INSERT INTO warehouses (tenant_id, warehouse_name, location, city)
             VALUES ($1, 'Main Warehouse', 'Central Facility', 'Lahore') RETURNING id`,
            [tenantId]
          );
          cleanWarehouseId = wNew.rows[0].id;
        }
      }
    }

    const cleanSupplierId = (supplier_id && isUuid(supplier_id)) ? supplier_id : null;
    const dcNum = (dc_number || '').trim() || `DC-${Date.now().toString().slice(-6)}`;
    const safeDeliveryDate = parseSafeDate(delivery_date) || new Date().toISOString().split('T')[0];
    const finalFreight = parseFloat(freight_cost_contractor || 0);
    const finalCustoms = parseFloat(customs_handling_cost || 0);
    const finalTotalCost = delivery_cost ? parseFloat(delivery_cost) : (finalFreight + finalCustoms);

    const result = await db.query(
      `INSERT INTO delivery_challans 
       (tenant_id, business_profile_id, purchase_order_id, customer_id, warehouse_id, dc_number, delivery_date, delivery_method, logistics_provider, tracking_number, driver_contact, delivery_cost, status, remarks, delivery_mode, supplier_id, origin_location, destination_site, bilty_number, vehicle_number, driver_name, freight_cost_contractor, customs_handling_cost)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
       RETURNING *`,
      [
        tenantId,
        cleanBizId,
        po.id,
        cleanCustId,
        cleanWarehouseId,
        dcNum,
        safeDeliveryDate,
        delivery_method || 'Hired Delivery',
        logistics_provider || null,
        tracking_number || bilty_number || null,
        driver_contact || null,
        finalTotalCost,
        'Dispatched',
        remarks || null,
        finalDeliveryMode,
        cleanSupplierId,
        origin_location || null,
        destination_site || po.delivery_location || null,
        bilty_number || tracking_number || null,
        vehicle_number || null,
        driver_name || null,
        finalFreight,
        finalCustoms
      ]
    );

    const createdDC = result.rows[0];

    // Insert DC items & deduct stock via inventory transaction
    if (items && Array.isArray(items)) {
      for (const itm of items) {
        const cleanProdId = (itm.product_service_id && isUuid(itm.product_service_id)) ? itm.product_service_id : null;
        const cleanPoiId = (itm.purchase_order_item_id && isUuid(itm.purchase_order_item_id)) ? itm.purchase_order_item_id : null;
        const finalQty = parseFloat(itm.quantity || 1);
        const finalOrderedQty = parseFloat(itm.ordered_quantity || finalQty);

        await db.query(
          `INSERT INTO delivery_challan_items 
           (delivery_challan_id, product_service_id, purchase_order_item_id, item_name, quantity, unit, ordered_quantity, batch_number, serial_number)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            createdDC.id,
            cleanProdId,
            cleanPoiId,
            itm.item_name || 'Item Specification',
            finalQty,
            itm.unit || 'PCS',
            finalOrderedQty,
            itm.batch_number || null,
            itm.serial_number || null
          ]
        );

        if (cleanProdId && cleanWarehouseId) {
          const prodCheck = await db.query(`SELECT id FROM products_services WHERE id = $1`, [cleanProdId]);
          if (prodCheck.rows.length > 0) {
            await db.query(
              `INSERT INTO inventory_transactions 
               (tenant_id, product_id, warehouse_id, transaction_type, quantity, batch_number, serial_number, reference_type, reference_id, remarks)
               VALUES ($1, $2, $3, 'DELIVERY', $4, $5, $6, 'DC', $7, 'Dispatched against Delivery Challan')`,
              [tenantId, cleanProdId, cleanWarehouseId, finalQty, itm.batch_number || null, itm.serial_number || null, createdDC.id]
            );

            await db.query(
              `UPDATE products_services SET current_stock = GREATEST(0, current_stock - $1) WHERE id = $2`,
              [finalQty, cleanProdId]
            );
          }
        }
      }
    }

    if (logger && logger.info) {
      logger.info(`[POST /delivery-challans] DC ${dcNum} created successfully (ID: ${createdDC.id})`);
    }
    if (!res.headersSent) {
      res.status(201).json({
        success: true,
        data: createdDC,
        message: 'Delivery Challan created and stock deducted. Proceed to Invoicing & Billing.'
      });
    }
  } catch (err) {
    if (logger && logger.error) {
      try { logger.error('[POST /delivery-challans Error]:', err); } catch (_) {}
    }
    console.error('[POST /delivery-challans Error]:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message, error: err.message });
    }
  }
});

// PUT update Delivery Challan status (Delivered, In_Transit, Proof of Delivery)
router.put('/delivery-challans/:id/status', async (req, res) => {
  const { status, proof_of_delivery_url, remarks } = req.body;

  try {
    const result = await db.query(
      `UPDATE delivery_challans 
       SET status = $1, proof_of_delivery_url = COALESCE($2, proof_of_delivery_url), remarks = COALESCE($3, remarks)
       WHERE id = $4
       RETURNING *`,
      [status, proof_of_delivery_url || null, remarks || null, req.params.id]
    );

    res.json({ success: true, data: result.rows[0], message: `Delivery Challan marked as ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update full Delivery Challan details
router.put('/delivery-challans/:id', async (req, res) => {
  const { dc_number, delivery_date, delivery_method, logistics_provider, tracking_number, driver_name, driver_contact, delivery_cost, status, remarks } = req.body;
  try {
    const result = await db.query(
      `UPDATE delivery_challans
       SET dc_number = COALESCE($1, dc_number),
           delivery_date = COALESCE($2, delivery_date),
           delivery_method = COALESCE($3, delivery_method),
           logistics_provider = COALESCE($4, logistics_provider),
           tracking_number = COALESCE($5, tracking_number),
           driver_name = COALESCE($6, driver_name),
           driver_contact = COALESCE($7, driver_contact),
           delivery_cost = COALESCE($8, delivery_cost),
           status = COALESCE($9, status),
           remarks = COALESCE($10, remarks),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $11
       RETURNING *`,
      [
        dc_number || null,
        delivery_date || null,
        delivery_method || null,
        logistics_provider || null,
        tracking_number || null,
        driver_name || null,
        driver_contact || null,
        delivery_cost !== undefined ? parseFloat(delivery_cost) : null,
        status || null,
        remarks || null,
        req.params.id
      ]
    );
    res.json({ success: true, data: result.rows[0], message: 'Delivery Challan updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update Warehouse
router.put('/warehouses/:id', async (req, res) => {
  const { warehouse_name, warehouse_code, location, city, manager_name, contact_phone } = req.body;
  try {
    const result = await db.query(
      `UPDATE warehouses
       SET warehouse_name = COALESCE($1, warehouse_name),
           warehouse_code = COALESCE($2, warehouse_code),
           location = COALESCE($3, location),
           city = COALESCE($4, city),
           manager_name = COALESCE($5, manager_name),
           contact_phone = COALESCE($6, contact_phone)
       WHERE id = $7
       RETURNING *`,
      [warehouse_name || null, warehouse_code || null, location || null, city || null, manager_name || null, contact_phone || null, req.params.id]
    );
    res.json({ success: true, data: result.rows[0], message: 'Warehouse updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update Procurement
router.put('/procurements/:id', async (req, res) => {
  const { procurement_number, supplier_id, origin_country, total_landed_cost, currency, status, remarks } = req.body;
  try {
    const result = await db.query(
      `UPDATE procurements
       SET procurement_number = COALESCE($1, procurement_number),
           supplier_id = COALESCE($2, supplier_id),
           origin_country = COALESCE($3, origin_country),
           total_landed_cost = COALESCE($4, total_landed_cost),
           currency = COALESCE($5, currency),
           status = COALESCE($6, status),
           remarks = COALESCE($7, remarks),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [
        procurement_number || null,
        supplier_id || null,
        origin_country || null,
        total_landed_cost !== undefined ? parseFloat(total_landed_cost) : null,
        currency || null,
        status || null,
        remarks || null,
        req.params.id
      ]
    );
    res.json({ success: true, data: result.rows[0], message: 'Procurement updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 4. ADVANCED INVENTORY: WAREHOUSE STOCK BALANCES, RESERVATIONS & GRN/DTL
// ============================================================================

// GET Warehouse Stock Balances with Reservations & Batches
router.get('/warehouse-stock', optionalAuth, async (req, res) => {
  const { warehouse_id, product_id } = req.query;
  try {
    let queryText = `
      SELECT ws.*, 
             p.name as product_name, p.sku, p.unit, p.reorder_level,
             w.warehouse_name, w.city as warehouse_city
      FROM warehouse_stock ws
      JOIN products_services p ON ws.product_id = p.id
      JOIN warehouses w ON ws.warehouse_id = w.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND ws.tenant_id::text = $${params.length}`;
    }

    if (warehouse_id) {
      params.push(warehouse_id);
      queryText += ` AND ws.warehouse_id = $${params.length}`;
    }

    if (product_id) {
      params.push(product_id);
      queryText += ` AND ws.product_id = $${params.length}`;
    }

    queryText += ` ORDER BY w.warehouse_name ASC, p.name ASC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Stock Reservations
router.get('/reservations', optionalAuth, async (req, res) => {
  const { purchase_order_id, opportunity_id, product_id } = req.query;
  try {
    let queryText = `
      SELECT sr.*, 
             p.name as product_name, p.sku, p.unit,
             w.warehouse_name,
             po.po_number,
             o.opportunity_number, o.title as opportunity_title
      FROM stock_reservations sr
      JOIN products_services p ON sr.product_id = p.id
      JOIN warehouses w ON sr.warehouse_id = w.id
      LEFT JOIN purchase_orders po ON sr.purchase_order_id = po.id
      LEFT JOIN opportunities o ON sr.opportunity_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND sr.tenant_id::text = $${params.length}`;
    }

    if (purchase_order_id) {
      params.push(purchase_order_id);
      queryText += ` AND sr.purchase_order_id = $${params.length}`;
    }

    if (opportunity_id) {
      params.push(opportunity_id);
      queryText += ` AND sr.opportunity_id = $${params.length}`;
    }

    queryText += ` ORDER BY sr.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Create Stock Reservation
router.post('/reserve', optionalAuth, async (req, res) => {
  const { opportunity_id, purchase_order_id, product_id, warehouse_id, batch_number, reserved_quantity } = req.body;

  if (!product_id || !warehouse_id || !reserved_quantity) {
    return res.status(400).json({ success: false, message: 'Product, Warehouse and Reserved Quantity are required' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const qty = parseFloat(reserved_quantity);
    const batch = batch_number || 'STANDARD';

    const insertRes = await db.query(
      `INSERT INTO stock_reservations 
       (tenant_id, opportunity_id, purchase_order_id, product_id, warehouse_id, batch_number, reserved_quantity, status, reserved_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Active', $8)
       RETURNING *`,
      [tenantId, opportunity_id || null, purchase_order_id || null, product_id, warehouse_id, batch, qty, req.user?.id || null]
    );

    // Update warehouse_stock reservation balance
    await db.query(
      `INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, batch_number, quantity_on_hand, quantity_reserved)
       VALUES ($1, $2, $3, $4, $5, $5)
       ON CONFLICT (warehouse_id, product_id, batch_number)
       DO UPDATE SET quantity_reserved = warehouse_stock.quantity_reserved + $5, updated_at = CURRENT_TIMESTAMP`,
      [tenantId, warehouse_id, product_id, batch, qty]
    );

    res.status(201).json({
      success: true,
      data: insertRes.rows[0],
      message: `Stock reservation of ${qty} reserved successfully against Order.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Release / Cancel Stock Reservation
router.post('/release-reservation', optionalAuth, async (req, res) => {
  const { reservation_id, reason } = req.body;
  if (!reservation_id) {
    return res.status(400).json({ success: false, message: 'Reservation ID is required' });
  }

  try {
    const resRow = await db.query(`SELECT * FROM stock_reservations WHERE id = $1`, [reservation_id]);
    if (resRow.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }
    const r = resRow.rows[0];

    await db.query(
      `UPDATE stock_reservations SET status = 'Cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [reservation_id]
    );

    await db.query(
      `UPDATE warehouse_stock 
       SET quantity_reserved = GREATEST(0, quantity_reserved - $1), updated_at = CURRENT_TIMESTAMP
       WHERE warehouse_id = $2 AND product_id = $3 AND batch_number = $4`,
      [parseFloat(r.reserved_quantity), r.warehouse_id, r.product_id, r.batch_number]
    );

    res.json({ success: true, message: 'Stock reservation released successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET GRN & Inspection Records
router.get('/grn', optionalAuth, async (req, res) => {
  const { delivery_challan_id, purchase_order_id, dtl_status } = req.query;
  try {
    let queryText = `
      SELECT grn.*, 
             dc.dc_number,
             po.po_number,
             s.supplier_name,
             w.warehouse_name
      FROM grn_inspections grn
      LEFT JOIN delivery_challans dc ON grn.delivery_challan_id = dc.id
      LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
      LEFT JOIN suppliers s ON grn.supplier_id = s.id
      LEFT JOIN warehouses w ON grn.warehouse_id = w.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND grn.tenant_id::text = $${params.length}`;
    }

    if (delivery_challan_id) {
      params.push(delivery_challan_id);
      queryText += ` AND grn.delivery_challan_id = $${params.length}`;
    }

    if (dtl_status) {
      params.push(dtl_status);
      queryText += ` AND grn.dtl_status = $${params.length}`;
    }

    queryText += ` ORDER BY grn.inspection_date DESC, grn.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Create GRN & Inspection Record
router.post('/grn', optionalAuth, async (req, res) => {
  const {
    delivery_challan_id,
    purchase_order_id,
    supplier_id,
    warehouse_id,
    grn_number,
    inspection_date,
    inspector_name,
    total_received_qty,
    accepted_qty,
    rejected_qty,
    dtl_required,
    dtl_sample_code,
    dtl_report_number,
    dtl_status,
    remarks
  } = req.body;

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const grnNo = grn_number || `GRN-${Date.now().toString().slice(-6)}`;
    const inspStatus = dtl_required && dtl_status === 'Pending' ? 'Awaiting DTL' : (parseFloat(rejected_qty || 0) > 0 ? 'Partial Acceptance' : 'Inspection Passed');

    const result = await db.query(
      `INSERT INTO grn_inspections 
       (tenant_id, delivery_challan_id, purchase_order_id, supplier_id, warehouse_id, grn_number, inspection_date, inspector_name, total_received_qty, accepted_qty, rejected_qty, dtl_required, dtl_sample_code, dtl_report_number, dtl_status, inspection_status, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        tenantId,
        delivery_challan_id || null,
        purchase_order_id || null,
        supplier_id || null,
        warehouse_id || null,
        grnNo,
        inspection_date || new Date(),
        inspector_name || 'Inspection Officer',
        parseFloat(total_received_qty || 0),
        parseFloat(accepted_qty || total_received_qty || 0),
        parseFloat(rejected_qty || 0),
        !!dtl_required,
        dtl_sample_code || null,
        dtl_report_number || null,
        dtl_status || (dtl_required ? 'Pending' : 'N/A'),
        inspStatus,
        remarks || null
      ]
    );

    // If DC linked, update DC status to GRN Received
    if (delivery_challan_id) {
      await db.query(
        `UPDATE delivery_challans SET grn_number = $1, grn_date = $2, status = 'GRN Received' WHERE id = $3`,
        [grnNo, inspection_date || new Date(), delivery_challan_id]
      );
    }

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: 'Goods Receipt Note & Inspection logged successfully'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT Update DTL Clearance on GRN
router.put('/grn/:id/dtl-clearance', optionalAuth, async (req, res) => {
  const { dtl_report_number, dtl_report_date, dtl_status, dtl_remarks } = req.body;
  try {
    const nextInspStatus = dtl_status === 'Cleared' ? 'Inspection Passed' : 'Inspection Failed';
    const result = await db.query(
      `UPDATE grn_inspections 
       SET dtl_report_number = COALESCE($1, dtl_report_number),
           dtl_report_date = COALESCE($2, dtl_report_date, CURRENT_DATE),
           dtl_status = COALESCE($3, dtl_status),
           dtl_remarks = COALESCE($4, dtl_remarks),
           inspection_status = $5
       WHERE id = $6
       RETURNING *`,
      [dtl_report_number || null, dtl_report_date || null, dtl_status || 'Cleared', dtl_remarks || null, nextInspStatus, req.params.id]
    );

    res.json({
      success: true,
      data: result.rows[0],
      message: `DTL Lab Clearance status updated to ${dtl_status}`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
