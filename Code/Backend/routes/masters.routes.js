const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { requirePermission, resolveTenantId } = require('../middleware/rbac.middleware');

// ============================================================================
// CUSTOMERS (Mandatory: Customer Name and Organization Type)
// ============================================================================

const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val || ''));

router.get('/customers', authenticate, requirePermission('customers', 'view'), async (req, res) => {
  try {
    let queryText = `
      SELECT c.*, 
             COALESCE(t.company_name, 'Default Org') as tenant_name,
             u.full_name as client_admin_name,
             u.username as client_admin_username
      FROM customers c
      LEFT JOIN tenants t ON c.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT full_name, username FROM users 
        WHERE tenant_id = c.tenant_id AND role IN ('ClientAdmin', 'CompanyAdmin')
        ORDER BY created_at ASC LIMIT 1
      ) u ON true
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = isUuid(req.user.tenantId) ? req.user.tenantId : '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND c.tenant_id::text = $${params.length}`;
      } else if (req.query.tenant_id && req.query.tenant_id !== 'all' && isUuid(req.query.tenant_id)) {
        params.push(req.query.tenant_id);
        queryText += ` AND c.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    queryText += ` ORDER BY c.business_name ASC`;
    let result;
    try {
      result = await db.query(queryText, params);
    } catch (joinErr) {
      result = await db.query(`SELECT * FROM customers WHERE 1=1 ORDER BY business_name ASC`);
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/customers', authenticate, requirePermission('customers', 'add'), async (req, res) => {
  const {
    customer_code,
    business_name,
    customer_type,
    org_type,
    department_name,
    ntn,
    strn,
    contact_person,
    email,
    phone,
    address,
    city,
    province,
    country,
    delivery_address,
    payment_terms,
    credit_limit,
    status,
    bank_name,
    bank_iban,
    notes,
    workflow_gates,
    tenant_id
  } = req.body;
  
  if (!business_name || !business_name.trim()) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error: Customer / Organization Name is mandatory.'
    });
  }

  try {
    let resolvedTenantId = resolveTenantId(req);
    if (req.user.role === 'SuperAdmin' && isUuid(tenant_id)) {
      resolvedTenantId = tenant_id;
    }
    if (!resolvedTenantId) {
      resolvedTenantId = req.user?.tenantId || 'a0000000-0000-0000-0000-000000000001';
    }

    // Strict duplicate customer check within tenant
    const dupCheck = await db.query(
      `SELECT id FROM customers WHERE LOWER(TRIM(business_name)) = LOWER(TRIM($1)) AND tenant_id = $2`,
      [business_name.trim(), resolvedTenantId]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Duplicate Error: A customer named "${business_name.trim()}" is already registered in your organization.`
      });
    }

    const cCode = customer_code || ('CUST-' + Math.floor(1000 + Math.random() * 9000));
    const cType = customer_type || org_type || 'Government Department';
    const cOrgType = org_type || customer_type || 'Government Department';
    const cCity = city || 'Lahore';
    const cProvince = province || 'Punjab';
    const cCountry = country || 'Pakistan';
    const cTerms = payment_terms || 'Net 30';
    const cLimit = parseFloat(credit_limit || 0) || 0;
    const cStatus = status || 'Active';
    const cGates = workflow_gates ? (typeof workflow_gates === 'object' ? JSON.stringify(workflow_gates) : workflow_gates) : null;

    // Dynamically query available columns on customers to avoid any column missing crash
    let cols = new Set();
    try {
      const colRes = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'customers'`);
      cols = new Set(colRes.rows.map(r => r.column_name));
    } catch (colErr) {
      cols = new Set(['tenant_id', 'customer_code', 'business_name', 'customer_type', 'city', 'country']);
    }

    const candidateFields = {
      tenant_id: resolvedTenantId,
      customer_code: cCode,
      business_name: business_name.trim(),
      customer_type: cType,
      org_type: cOrgType,
      department_name: department_name || null,
      ntn: ntn || null,
      strn: strn || null,
      contact_person: contact_person || null,
      email: email || null,
      phone: phone || null,
      address: address || null,
      city: cCity,
      province: cProvince,
      country: cCountry,
      delivery_address: delivery_address || null,
      payment_terms: cTerms,
      credit_limit: cLimit,
      status: cStatus,
      bank_name: bank_name || null,
      bank_iban: bank_iban || null,
      notes: notes || null,
      workflow_gates: cGates
    };

    const insertCols = [];
    const insertVals = [];
    const insertPlaceholders = [];
    let pIdx = 1;

    for (const [colName, val] of Object.entries(candidateFields)) {
      if (cols.has(colName)) {
        insertCols.push(colName);
        insertVals.push(val);
        insertPlaceholders.push(`$${pIdx++}`);
      }
    }

    const insertSql = `INSERT INTO customers (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')}) RETURNING *`;
    const result = await db.query(insertSql, insertVals);
    res.status(201).json({ success: true, data: result.rows[0], message: 'Customer registered successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// SUPPLIERS (Fields: Supplier Name, Origin Local/International, Rating)
// ============================================================================

router.get('/suppliers', authenticate, requirePermission('suppliers', 'view'), async (req, res) => {
  try {
    let queryText = `
      SELECT s.*,
             COALESCE(t.company_name, 'Default Org') as tenant_name,
             u.full_name as client_admin_name,
             u.username as client_admin_username
      FROM suppliers s
      LEFT JOIN tenants t ON s.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT full_name, username FROM users 
        WHERE tenant_id = s.tenant_id AND role IN ('ClientAdmin', 'CompanyAdmin')
        ORDER BY created_at ASC LIMIT 1
      ) u ON true
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = isUuid(req.user.tenantId) ? req.user.tenantId : '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND s.tenant_id::text = $${params.length}`;
      } else if (req.query.tenant_id && req.query.tenant_id !== 'all' && isUuid(req.query.tenant_id)) {
        params.push(req.query.tenant_id);
        queryText += ` AND s.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    queryText += ` ORDER BY s.rating DESC, s.supplier_name ASC`;
    let result;
    try {
      result = await db.query(queryText, params);
    } catch (joinErr) {
      result = await db.query(`SELECT * FROM suppliers WHERE 1=1 ORDER BY rating DESC, supplier_name ASC`);
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/suppliers', authenticate, requirePermission('suppliers', 'add'), async (req, res) => {
  const { supplier_name, origin, country, city, address, ntn, strn, contact_person, email, phone, rating, payment_terms, tenant_id } = req.body;
  
  if (!supplier_name) {
    return res.status(400).json({ success: false, message: 'Supplier Name is mandatory' });
  }

  try {
    let resolvedTenantId = null;
    if (isUuid(tenant_id)) {
      resolvedTenantId = tenant_id;
    }
    if (!resolvedTenantId && isUuid(req.user?.tenantId)) {
      resolvedTenantId = req.user.tenantId;
    }
    const headerTid = req.headers['x-tenant-id'];
    if (!resolvedTenantId && isUuid(headerTid)) {
      resolvedTenantId = headerTid;
    }
    if (!resolvedTenantId) {
      try {
        const tenantRes = await db.query(`SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`);
        if (tenantRes.rows.length > 0) {
          resolvedTenantId = tenantRes.rows[0].id;
        }
      } catch (e) {}
    }
    if (!resolvedTenantId) {
      resolvedTenantId = 'a0000000-0000-0000-0000-000000000001';
    }

    // Strict duplicate supplier check
    const dupCheck = await db.query(
      `SELECT id FROM suppliers WHERE LOWER(TRIM(supplier_name)) = LOWER(TRIM($1)) AND tenant_id = $2`,
      [supplier_name.trim(), resolvedTenantId]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Duplicate Error: A supplier named "${supplier_name.trim()}" is already registered in your organization.`
      });
    }

    const result = await db.query(
      `INSERT INTO suppliers 
       (tenant_id, supplier_name, origin, country, city, address, ntn, strn, contact_person, email, phone, rating, payment_terms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
       RETURNING *`,
      [
        resolvedTenantId,
        supplier_name.trim(),
        origin || 'Local',
        country || 'Pakistan',
        city || 'Lahore',
        address || null,
        ntn || null,
        strn || null,
        contact_person || null,
        email || null,
        phone || null,
        parseInt(rating || 5, 10),
        payment_terms || 'Net 30'
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0], message: 'Supplier registered successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
function parseSafeDate(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().split('T')[0];
  const s = String(d).trim();
  if (!s || s === 'N/A' || s === 'DD/MM/YYYY' || s === 'undefined' || s === 'null') return null;
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

router.get('/products', authenticate, requirePermission('inventory', 'view'), async (req, res) => {
  try {
    const { category_id, sub_category_id, industry_type } = req.query;
    let queryText = `
      SELECT p.*, s.supplier_name, s.origin as supplier_origin,
             COALESCE(t.company_name, 'Default Org') as tenant_name,
             u.full_name as client_admin_name,
             u.username as client_admin_username,
             c.category_name, c.category_code, c.industry_type,
             sc.sub_category_name, sc.sub_category_code,
             uom.uom_code, uom.uom_name, uom.allow_decimal
      FROM products_services p
      LEFT JOIN suppliers s ON p.default_supplier_id = s.id
      LEFT JOIN item_categories c ON p.category_id = c.id
      LEFT JOIN item_sub_categories sc ON p.sub_category_id = sc.id
      LEFT JOIN uom_masters uom ON p.uom_id = uom.id
      LEFT JOIN tenants t ON p.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT full_name, username FROM users 
        WHERE tenant_id = p.tenant_id AND role IN ('ClientAdmin', 'CompanyAdmin')
        ORDER BY created_at ASC LIMIT 1
      ) u ON true
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = isUuid(req.user.tenantId) ? req.user.tenantId : '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND p.tenant_id::text = $${params.length}`;
      } else if (req.query.tenant_id && req.query.tenant_id !== 'all' && isUuid(req.query.tenant_id)) {
        params.push(req.query.tenant_id);
        queryText += ` AND p.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    if (category_id && isUuid(category_id)) {
      params.push(category_id);
      queryText += ` AND p.category_id::text = $${params.length}`;
    }

    if (sub_category_id && isUuid(sub_category_id)) {
      params.push(sub_category_id);
      queryText += ` AND p.sub_category_id::text = $${params.length}`;
    }

    if (industry_type && industry_type !== 'all') {
      params.push(industry_type);
      queryText += ` AND c.industry_type = $${params.length}`;
    }

    queryText += ` ORDER BY p.name ASC`;
    let result;
    try {
      result = await db.query(queryText, params);
    } catch (joinErr) {
      result = await db.query(
        `SELECT p.*, s.supplier_name, s.origin as supplier_origin
         FROM products_services p
         LEFT JOIN suppliers s ON p.default_supplier_id = s.id
         ORDER BY p.name ASC`
      );
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/products', authenticate, requirePermission('inventory', 'add'), async (req, res) => {
  const { item_type, sku, name, specifications, description, unit, cost_price, selling_price, tax_category, current_stock, reorder_level, default_supplier_id, tenant_id, sizes, variants } = req.body;
  
  if (!name) {
    return res.status(400).json({ success: false, message: 'Product/Item name is mandatory' });
  }

  try {
    let resolvedTenantId = null;
    if (isUuid(tenant_id)) {
      resolvedTenantId = tenant_id;
    }
    if (!resolvedTenantId && isUuid(req.user?.tenantId)) {
      resolvedTenantId = req.user.tenantId;
    }
    const headerTid = req.headers['x-tenant-id'];
    if (!resolvedTenantId && isUuid(headerTid)) {
      resolvedTenantId = headerTid;
    }
    if (!resolvedTenantId) {
      try {
        const tenantRes = await db.query(`SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`);
        if (tenantRes.rows.length > 0) {
          resolvedTenantId = tenantRes.rows[0].id;
        }
      } catch (e) {}
    }
    if (!resolvedTenantId) {
      resolvedTenantId = 'a0000000-0000-0000-0000-000000000001';
    }

    const effectiveSku = (sku || `SKU-${Date.now().toString().slice(-6)}`).trim();

    // Strict duplicate product check
    const dupCheck = await db.query(
      `SELECT id FROM products_services 
       WHERE (LOWER(sku) = LOWER($1) OR (LOWER(name) = LOWER($2) AND LOWER(COALESCE(description, '')) = LOWER($3))) 
         AND tenant_id = $4`,
      [effectiveSku, name.trim(), (description || '').trim(), resolvedTenantId]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Duplicate Error: Item SKU "${effectiveSku}" or Product Name already exists in catalog.`
      });
    }

    let prodCols = new Set();
    try {
      const colRes = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'products_services'`);
      prodCols = new Set(colRes.rows.map(r => r.column_name));
    } catch (e) {
      prodCols = new Set(['tenant_id', 'sku', 'name', 'unit', 'cost_price', 'selling_price', 'current_stock']);
    }

    const parsedSizes = Array.isArray(sizes) 
      ? JSON.stringify(sizes) 
      : (typeof sizes === 'string' && sizes.trim().startsWith('[') ? sizes : JSON.stringify(sizes ? [sizes] : []));
    const parsedVariants = Array.isArray(variants) 
      ? JSON.stringify(variants) 
      : (typeof variants === 'string' && variants.trim().startsWith('[') ? variants : JSON.stringify(variants ? [variants] : []));

    let resolvedUomId = null;
    if (isUuid(req.body.uom_id)) {
      resolvedUomId = req.body.uom_id;
    } else if (req.body.uom_id || unit) {
      const uCode = (req.body.uom_id || unit || 'PCS').toUpperCase().trim();
      const uRow = await db.query(`SELECT id FROM uom_masters WHERE uom_code = $1 LIMIT 1`, [uCode]);
      resolvedUomId = uRow.rows[0]?.id || null;
    }

    const candidateFields = {
      tenant_id: resolvedTenantId,
      item_type: item_type || 'Product',
      sku: effectiveSku,
      name: name.trim(),
      brand_name: req.body.brand_name ? req.body.brand_name.trim() : null,
      batch_number: req.body.batch_number ? req.body.batch_number.trim() : null,
      manufacturing_date: parseSafeDate(req.body.manufacturing_date),
      expiry_date: parseSafeDate(req.body.expiry_date),
      specifications: specifications ? specifications.trim() : null,
      description: description ? description.trim() : (specifications ? specifications.trim() : ''),
      unit: unit || 'PCS',
      cost_price: parseFloat(cost_price || 0),
      selling_price: parseFloat(selling_price || 0),
      tax_category: tax_category || 'Standard 18%',
      current_stock: parseFloat(current_stock || 0),
      reorder_level: parseFloat(reorder_level || 5),
      default_supplier_id: isUuid(default_supplier_id) ? default_supplier_id : null,
      category_id: isUuid(req.body.category_id) ? req.body.category_id : null,
      sub_category_id: isUuid(req.body.sub_category_id) ? req.body.sub_category_id : null,
      uom_id: resolvedUomId,
      tracking_type: req.body.tracking_type || 'Standard',
      sizes: parsedSizes,
      variants: parsedVariants
    };

    const insertCols = [];
    const insertVals = [];
    const insertPlaceholders = [];
    let pIdx = 1;

    for (const [colName, val] of Object.entries(candidateFields)) {
      if (prodCols.has(colName)) {
        insertCols.push(colName);
        insertVals.push(val);
        insertPlaceholders.push(`$${pIdx++}`);
      }
    }

    const insertSql = `INSERT INTO products_services (${insertCols.join(', ')}) VALUES (${insertPlaceholders.join(', ')}) RETURNING *`;
    const result = await db.query(insertSql, insertVals);
    const createdProduct = result.rows[0];

    // Automatically initialize item in Warehouse Stock so it immediately shows in the warehouse!
    try {
      let targetWhId = isUuid(req.body.warehouse_id) ? req.body.warehouse_id : null;
      if (!targetWhId) {
        const whRes = await db.query(
          `SELECT id FROM warehouses WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
          [resolvedTenantId]
        );
        if (whRes.rows.length > 0) {
          targetWhId = whRes.rows[0].id;
        }
      }

      if (targetWhId) {
        const initialQty = parseFloat(candidateFields.current_stock || 0);
        const initBatch = (candidateFields.batch_number || 'LOT-PRIMARY').trim();
        const initCost = parseFloat(candidateFields.cost_price || 0);

        await db.query(
          `INSERT INTO warehouse_stock 
           (tenant_id, warehouse_id, product_id, batch_number, quantity_on_hand, quantity_reserved, brand_name, manufacturing_date, expiry_date, storage_location)
           VALUES ($1, $2, $3, $4, $5, 0, $6, $7::date, $8::date, $9)
           ON CONFLICT (warehouse_id, product_id, batch_number)
           DO UPDATE SET 
             quantity_on_hand = warehouse_stock.quantity_on_hand + $5,
             brand_name = COALESCE($6, warehouse_stock.brand_name),
             manufacturing_date = COALESCE($7::date, warehouse_stock.manufacturing_date),
             expiry_date = COALESCE($8::date, warehouse_stock.expiry_date),
             updated_at = CURRENT_TIMESTAMP`,
          [
            resolvedTenantId,
            targetWhId,
            createdProduct.id,
            initBatch,
            initialQty,
            candidateFields.brand_name || null,
            candidateFields.manufacturing_date || null,
            candidateFields.expiry_date || null,
            req.body.storage_location || null
          ]
        );

        if (initialQty > 0) {
          await db.query(
            `INSERT INTO inventory_transactions
             (tenant_id, product_id, warehouse_id, transaction_type, quantity, unit_cost, batch_number, expiry_date, manufacturing_date, reference_type, reference_number, storage_location, remarks, created_by)
             VALUES ($1, $2, $3, 'STOCK_IN', $4, $5, $6, $7::date, $8::date, 'OPENING_STOCK', $9, $10, 'Opening Stock Balance on Item Registration', $11)`,
            [
              resolvedTenantId,
              createdProduct.id,
              targetWhId,
              initialQty,
              initCost,
              initBatch,
              candidateFields.expiry_date || null,
              candidateFields.manufacturing_date || null,
              `OPN-${Date.now().toString().slice(-6)}`,
              req.body.storage_location || null,
              req.user?.id || null
            ]
          );
        }
      }
    } catch (whErr) {
      console.warn('Auto warehouse_stock init non-critical error:', whErr.message);
    }

    res.status(201).json({ success: true, data: createdProduct, message: 'Item added to Product Catalog and Warehouse Stock successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update existing product / item
router.put('/products/:id', authenticate, requirePermission('inventory', 'edit'), async (req, res) => {
  const { id } = req.params;
  const {
    sku,
    name,
    specifications,
    description,
    item_type,
    unit,
    cost_price,
    selling_price,
    tax_category,
    current_stock,
    reorder_level,
    default_supplier_id,
    sizes,
    variants
  } = req.body;

  if (!name && !sku) {
    return res.status(400).json({ success: false, message: 'Item Name or SKU is required for update.' });
  }

  try {
    let prodCols = new Set();
    try {
      const colRes = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'products_services'`);
      prodCols = new Set(colRes.rows.map(r => r.column_name));
    } catch (e) {
      prodCols = new Set(['sku', 'name', 'unit', 'cost_price', 'selling_price', 'current_stock']);
    }

    const candidateUpdates = {
      sku: sku ? sku.trim() : null,
      name: name ? name.trim() : null,
      brand_name: req.body.brand_name !== undefined ? (req.body.brand_name ? req.body.brand_name.trim() : null) : null,
      batch_number: req.body.batch_number !== undefined ? (req.body.batch_number ? req.body.batch_number.trim() : null) : null,
      manufacturing_date: req.body.manufacturing_date !== undefined ? parseSafeDate(req.body.manufacturing_date) : null,
      expiry_date: req.body.expiry_date !== undefined ? parseSafeDate(req.body.expiry_date) : null,
      specifications: specifications !== undefined ? specifications : null,
      description: description !== undefined ? description : null,
      item_type: item_type || null,
      unit: unit || null,
      cost_price: cost_price !== undefined ? parseFloat(cost_price) : null,
      selling_price: selling_price !== undefined ? parseFloat(selling_price) : null,
      tax_category: tax_category || null,
      current_stock: current_stock !== undefined ? parseFloat(current_stock) : null,
      reorder_level: reorder_level !== undefined ? parseFloat(reorder_level) : null,
      default_supplier_id: default_supplier_id || null,
      category_id: req.body.category_id !== undefined ? (isUuid(req.body.category_id) ? req.body.category_id : null) : null,
      sub_category_id: req.body.sub_category_id !== undefined ? (isUuid(req.body.sub_category_id) ? req.body.sub_category_id : null) : null,
      uom_id: req.body.uom_id !== undefined ? (isUuid(req.body.uom_id) ? req.body.uom_id : null) : null,
      tracking_type: req.body.tracking_type !== undefined ? req.body.tracking_type : null,
      sizes: sizes !== undefined ? (Array.isArray(sizes) ? JSON.stringify(sizes) : sizes) : null,
      variants: variants !== undefined ? (Array.isArray(variants) ? JSON.stringify(variants) : variants) : null
    };

    const setClauses = [];
    const updateVals = [];
    let pIdx = 1;

    for (const [colName, val] of Object.entries(candidateUpdates)) {
      if (prodCols.has(colName) && val !== null) {
        setClauses.push(`${colName} = COALESCE($${pIdx++}, ${colName})`);
        updateVals.push(val);
      }
    }

    if (prodCols.has('updated_at')) {
      setClauses.push('updated_at = CURRENT_TIMESTAMP');
    }

    if (setClauses.length === 0) {
      return res.json({ success: true, message: 'No fields to update.' });
    }

    updateVals.push(String(id));
    const updateSql = `UPDATE products_services SET ${setClauses.join(', ')} WHERE id::text = $${pIdx} RETURNING *`;
    const result = await db.query(updateSql, updateVals);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Item not found in catalog.' });
    }

    res.json({
      success: true,
      message: 'Product/Item updated successfully.',
      data: result.rows[0]
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE product / item
router.delete('/products/:id', authenticate, requirePermission('inventory', 'delete'), async (req, res) => {
  const { id } = req.params;
  try {
    const targetTid = resolveTenantId(req);
    if (req.user.role === 'SuperAdmin') {
      await db.query(`DELETE FROM products_services WHERE id::text = $1`, [String(id)]);
    } else {
      const delCheck = await db.query(`DELETE FROM products_services WHERE id::text = $1 AND tenant_id::text = $2`, [String(id), String(targetTid)]);
      if (delCheck.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'Item not found or unauthorized.' });
      }
    }
    res.json({ success: true, message: 'Item deleted from catalog successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// UNITS OF MEASURE (UOM) MASTER
// ============================================================================

router.get('/uoms', authenticate, async (req, res) => {
  try {
    const tid = resolveTenantId(req) || req.user?.tenantId;
    let result;
    if (tid && isUuid(tid)) {
      result = await db.query(
        `SELECT DISTINCT ON (uom_code) * FROM uom_masters 
         WHERE (tenant_id = $1 OR tenant_id IS NULL) AND is_active = TRUE 
         ORDER BY uom_code ASC, (tenant_id IS NOT NULL) DESC`,
        [tid]
      );
    } else {
      result = await db.query(
        `SELECT DISTINCT ON (uom_code) * FROM uom_masters 
         WHERE is_active = TRUE 
         ORDER BY uom_code ASC, (tenant_id IS NOT NULL) DESC`
      );
    }
    if (!result.rows || result.rows.length === 0) {
      result = await db.query(`SELECT * FROM uom_masters WHERE is_active = TRUE ORDER BY uom_code ASC`);
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/uoms', authenticate, requirePermission('inventory', 'add'), async (req, res) => {
  const { uom_code, uom_name, uom_type, allow_decimal } = req.body;
  if (!uom_code || !uom_name) {
    return res.status(400).json({ success: false, message: 'UOM Code and UOM Name are required.' });
  }
  try {
    const tid = resolveTenantId(req) || req.user?.tenantId;
    const cleanTid = isUuid(tid) ? tid : null;
    const cleanCode = String(uom_code).toUpperCase().trim();
    const cleanName = String(uom_name).trim();

    let result;
    if (cleanTid) {
      result = await db.query(
        `INSERT INTO uom_masters (tenant_id, uom_code, uom_name, uom_type, allow_decimal)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tenant_id, uom_code) DO UPDATE
         SET uom_name = EXCLUDED.uom_name, uom_type = EXCLUDED.uom_type, allow_decimal = EXCLUDED.allow_decimal, is_active = TRUE
         RETURNING *`,
        [cleanTid, cleanCode, cleanName, uom_type || 'Quantity', !!allow_decimal]
      );
    } else {
      result = await db.query(
        `INSERT INTO uom_masters (tenant_id, uom_code, uom_name, uom_type, allow_decimal)
         VALUES (NULL, $1, $2, $3, $4)
         ON CONFLICT (uom_code) WHERE tenant_id IS NULL DO UPDATE
         SET uom_name = EXCLUDED.uom_name, uom_type = EXCLUDED.uom_type, allow_decimal = EXCLUDED.allow_decimal, is_active = TRUE
         RETURNING *`,
        [cleanCode, cleanName, uom_type || 'Quantity', !!allow_decimal]
      );
    }
    res.status(201).json({ success: true, data: result.rows[0], message: 'Unit of Measure created successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/uoms/:id', authenticate, requirePermission('inventory', 'edit'), async (req, res) => {
  const { id } = req.params;
  const { uom_name, uom_type, allow_decimal, is_active } = req.body;
  try {
    const result = await db.query(
      `UPDATE uom_masters
       SET uom_name = COALESCE($1, uom_name),
           uom_type = COALESCE($2, uom_type),
           allow_decimal = COALESCE($3, allow_decimal),
           is_active = COALESCE($4, is_active)
       WHERE id = $5 RETURNING *`,
      [uom_name || null, uom_type || null, allow_decimal !== undefined ? !!allow_decimal : null, is_active !== undefined ? !!is_active : null, id]
    );
    res.json({ success: true, data: result.rows[0], message: 'Unit of Measure updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// ITEM CATEGORIES & SUB-CATEGORIES
// ============================================================================

router.get('/categories', authenticate, async (req, res) => {
  try {
    const tid = resolveTenantId(req) || req.user?.tenantId;
    let result;
    if (tid && isUuid(tid)) {
      result = await db.query(
        `SELECT DISTINCT ON (c.category_name) c.*, 
                (SELECT COUNT(*) FROM item_sub_categories sc WHERE sc.category_id = c.id AND sc.is_active = TRUE) as sub_category_count,
                (SELECT COUNT(*) FROM products_services p WHERE p.category_id = c.id) as product_count
         FROM item_categories c
         WHERE (c.tenant_id = $1 OR c.tenant_id IS NULL) AND c.is_active = TRUE
         ORDER BY c.category_name ASC, (c.tenant_id IS NOT NULL) DESC`,
        [tid]
      );
    } else {
      result = await db.query(
        `SELECT DISTINCT ON (c.category_name) c.*, 
                (SELECT COUNT(*) FROM item_sub_categories sc WHERE sc.category_id = c.id AND sc.is_active = TRUE) as sub_category_count,
                (SELECT COUNT(*) FROM products_services p WHERE p.category_id = c.id) as product_count
         FROM item_categories c
         WHERE c.is_active = TRUE
         ORDER BY c.category_name ASC, (c.tenant_id IS NOT NULL) DESC`
      );
    }
    if (!result.rows || result.rows.length === 0) {
      result = await db.query(`SELECT * FROM item_categories WHERE is_active = TRUE ORDER BY category_name ASC`);
    }
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/categories', authenticate, requirePermission('inventory', 'add'), async (req, res) => {
  const { category_code, category_name, industry_type, description, requires_batch_tracking, requires_expiry_tracking, requires_serial_tracking } = req.body;
  if (!category_name) {
    return res.status(400).json({ success: false, message: 'Category Name is required.' });
  }
  try {
    const tid = resolveTenantId(req) || req.user?.tenantId;
    const cleanTid = isUuid(tid) ? tid : null;
    const cCode = (category_code || ('CAT-' + Date.now().toString().slice(-4))).toUpperCase().trim();
    let result;
    if (cleanTid) {
      result = await db.query(
        `INSERT INTO item_categories 
         (tenant_id, category_code, category_name, industry_type, description, requires_batch_tracking, requires_expiry_tracking, requires_serial_tracking)
         VALUES ($1, $2, TRIM($3), $4, $5, $6, $7, $8)
         ON CONFLICT (tenant_id, category_name) DO UPDATE
         SET category_code = EXCLUDED.category_code,
             industry_type = EXCLUDED.industry_type,
             description = EXCLUDED.description,
             requires_batch_tracking = EXCLUDED.requires_batch_tracking,
             requires_expiry_tracking = EXCLUDED.requires_expiry_tracking,
             requires_serial_tracking = EXCLUDED.requires_serial_tracking,
             is_active = TRUE
         RETURNING *`,
        [cleanTid, cCode, category_name, industry_type || 'General Goods', description || null, !!requires_batch_tracking, !!requires_expiry_tracking, !!requires_serial_tracking]
      );
    } else {
      result = await db.query(
        `INSERT INTO item_categories 
         (tenant_id, category_code, category_name, industry_type, description, requires_batch_tracking, requires_expiry_tracking, requires_serial_tracking)
         VALUES (NULL, $1, TRIM($2), $3, $4, $5, $6, $7)
         ON CONFLICT (category_name) WHERE tenant_id IS NULL DO UPDATE
         SET category_code = EXCLUDED.category_code,
             industry_type = EXCLUDED.industry_type,
             description = EXCLUDED.description,
             requires_batch_tracking = EXCLUDED.requires_batch_tracking,
             requires_expiry_tracking = EXCLUDED.requires_expiry_tracking,
             requires_serial_tracking = EXCLUDED.requires_serial_tracking,
             is_active = TRUE
         RETURNING *`,
        [cCode, category_name, industry_type || 'General Goods', description || null, !!requires_batch_tracking, !!requires_expiry_tracking, !!requires_serial_tracking]
      );
    }
    res.status(201).json({ success: true, data: result.rows[0], message: 'Item Category created successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/categories/:id', authenticate, requirePermission('inventory', 'edit'), async (req, res) => {
  const { id } = req.params;
  const { category_name, industry_type, description, requires_batch_tracking, requires_expiry_tracking, requires_serial_tracking, is_active } = req.body;
  try {
    const result = await db.query(
      `UPDATE item_categories
       SET category_name = COALESCE($1, category_name),
           industry_type = COALESCE($2, industry_type),
           description = COALESCE($3, description),
           requires_batch_tracking = COALESCE($4, requires_batch_tracking),
           requires_expiry_tracking = COALESCE($5, requires_expiry_tracking),
           requires_serial_tracking = COALESCE($6, requires_serial_tracking),
           is_active = COALESCE($7, is_active)
       WHERE id = $8 RETURNING *`,
      [
        category_name || null,
        industry_type || null,
        description !== undefined ? description : null,
        requires_batch_tracking !== undefined ? !!requires_batch_tracking : null,
        requires_expiry_tracking !== undefined ? !!requires_expiry_tracking : null,
        requires_serial_tracking !== undefined ? !!requires_serial_tracking : null,
        is_active !== undefined ? !!is_active : null,
        id
      ]
    );
    res.json({ success: true, data: result.rows[0], message: 'Item Category updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/sub-categories', authenticate, async (req, res) => {
  const { category_id } = req.query;
  try {
    const tid = resolveTenantId(req) || req.user?.tenantId;
    let queryText = `
      SELECT sc.*, c.category_name, c.industry_type,
             (SELECT COUNT(*) FROM products_services p WHERE p.sub_category_id = sc.id) as product_count
      FROM item_sub_categories sc
      JOIN item_categories c ON sc.category_id = c.id
      WHERE (sc.tenant_id = $1 OR sc.tenant_id IS NULL) AND sc.is_active = TRUE
    `;
    const params = [tid];
    if (category_id && isUuid(category_id)) {
      params.push(category_id);
      queryText += ` AND sc.category_id = $${params.length}`;
    }
    queryText += ` ORDER BY sc.sub_category_name ASC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/sub-categories', authenticate, requirePermission('inventory', 'add'), async (req, res) => {
  const { category_id, sub_category_code, sub_category_name, description } = req.body;
  if (!category_id || !sub_category_name) {
    return res.status(400).json({ success: false, message: 'Category ID and Sub-Category Name are required.' });
  }
  try {
    const tid = resolveTenantId(req) || req.user?.tenantId;
    const sCode = (sub_category_code || ('SUB-' + Date.now().toString().slice(-4))).toUpperCase().trim();
    const result = await db.query(
      `INSERT INTO item_sub_categories (tenant_id, category_id, sub_category_code, sub_category_name, description)
       VALUES ($1, $2, $3, TRIM($4), $5)
       ON CONFLICT (tenant_id, category_id, sub_category_name) DO UPDATE
       SET sub_category_code = EXCLUDED.sub_category_code, description = EXCLUDED.description, is_active = TRUE
       RETURNING *`,
      [tid, category_id, sCode, sub_category_name, description || null]
    );
    res.status(201).json({ success: true, data: result.rows[0], message: 'Item Sub-Category created successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put('/sub-categories/:id', authenticate, requirePermission('inventory', 'edit'), async (req, res) => {
  const { id } = req.params;
  const { sub_category_name, description, is_active } = req.body;
  try {
    const result = await db.query(
      `UPDATE item_sub_categories
       SET sub_category_name = COALESCE($1, sub_category_name),
           description = COALESCE($2, description),
           is_active = COALESCE($3, is_active)
       WHERE id = $4 RETURNING *`,
      [sub_category_name || null, description !== undefined ? description : null, is_active !== undefined ? !!is_active : null, id]
    );
    res.json({ success: true, data: result.rows[0], message: 'Item Sub-Category updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update supplier
router.put('/suppliers/:id', authenticate, requirePermission('suppliers', 'edit'), async (req, res) => {
  const { id } = req.params;
  const { supplier_name, origin, country, origin_port_city, city, address, ntn, strn, contact_person, email, phone, rating, payment_terms, status, notes } = req.body;
  try {
    const result = await db.query(
      `UPDATE suppliers
       SET supplier_name = COALESCE($1, supplier_name),
           origin = COALESCE($2, origin),
           country = COALESCE($3, country),
           city = COALESCE($4, city),
           address = COALESCE($5, address),
           ntn = COALESCE($6, ntn),
           strn = COALESCE($7, strn),
           contact_person = COALESCE($8, contact_person),
           email = COALESCE($9, email),
           phone = COALESCE($10, phone),
           rating = COALESCE($11, rating),
           payment_terms = COALESCE($12, payment_terms),
           status = COALESCE($13, status),
           notes = COALESCE($14, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id::text = $15
       RETURNING *`,
      [
        supplier_name ? supplier_name.trim() : null,
        origin || null,
        country || null,
        origin_port_city || city || null,
        address || null,
        ntn || null,
        strn || null,
        contact_person || null,
        email || null,
        phone || null,
        rating !== undefined ? parseInt(rating, 10) : null,
        payment_terms || null,
        status || null,
        notes || null,
        String(id)
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Supplier not found.' });
    }
    res.json({ success: true, message: 'Supplier updated successfully.', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE supplier
router.delete('/suppliers/:id', authenticate, requirePermission('suppliers', 'delete'), async (req, res) => {
  const { id } = req.params;
  try {
    const targetTid = resolveTenantId(req);
    if (req.user.role === 'SuperAdmin') {
      await db.query(`DELETE FROM suppliers WHERE id::text = $1`, [String(id)]);
    } else {
      const delCheck = await db.query(`DELETE FROM suppliers WHERE id::text = $1 AND tenant_id::text = $2`, [String(id), String(targetTid)]);
      if (delCheck.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'Supplier not found or unauthorized.' });
      }
    }
    res.json({ success: true, message: 'Supplier deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update customer
router.put('/customers/:id', authenticate, requirePermission('customers', 'edit'), async (req, res) => {
  const { id } = req.params;
  const {
    customer_code,
    business_name,
    customer_type,
    org_type,
    department_name,
    ntn,
    strn,
    contact_person,
    email,
    phone,
    address,
    city,
    province,
    country,
    delivery_address,
    payment_terms,
    credit_limit,
    status,
    bank_name,
    bank_iban,
    notes,
    workflow_gates
  } = req.body;

  try {
    const cGates = workflow_gates ? (typeof workflow_gates === 'object' ? JSON.stringify(workflow_gates) : workflow_gates) : null;

    let cols = new Set();
    try {
      const colRes = await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'customers'`);
      cols = new Set(colRes.rows.map(r => r.column_name));
    } catch (colErr) {
      cols = new Set(['tenant_id', 'customer_code', 'business_name', 'customer_type', 'city', 'country']);
    }

    const candidateUpdates = {
      customer_code: customer_code || null,
      business_name: business_name ? business_name.trim() : null,
      customer_type: customer_type || org_type || null,
      org_type: org_type || customer_type || null,
      department_name: department_name || null,
      ntn: ntn || null,
      strn: strn || null,
      contact_person: contact_person || null,
      email: email || null,
      phone: phone || null,
      address: address || null,
      city: city || null,
      province: province || null,
      country: country || null,
      delivery_address: delivery_address || null,
      payment_terms: payment_terms || null,
      credit_limit: credit_limit !== undefined && credit_limit !== null ? parseFloat(credit_limit) : null,
      status: status || null,
      bank_name: bank_name || null,
      bank_iban: bank_iban || null,
      notes: notes || null,
      workflow_gates: cGates
    };

    const setClauses = [];
    const updateVals = [];
    let pIdx = 1;

    for (const [colName, val] of Object.entries(candidateUpdates)) {
      if (cols.has(colName)) {
        setClauses.push(`${colName} = COALESCE($${pIdx++}, ${colName})`);
        updateVals.push(val);
      }
    }

    if (cols.has('updated_at')) {
      setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
    }

    if (setClauses.length === 0) {
      return res.json({ success: true, message: 'No changes provided.' });
    }

    updateVals.push(String(id));
    const updateSql = `UPDATE customers SET ${setClauses.join(', ')} WHERE id::text = $${pIdx} RETURNING *`;
    const result = await db.query(updateSql, updateVals);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }
    res.json({ success: true, message: 'Customer updated successfully.', data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE customer
router.delete('/customers/:id', authenticate, requirePermission('customers', 'delete'), async (req, res) => {
  const { id } = req.params;
  try {
    const targetTid = resolveTenantId(req);
    if (req.user.role === 'SuperAdmin') {
      await db.query(`DELETE FROM customers WHERE id::text = $1`, [String(id)]);
    } else {
      const delCheck = await db.query(`DELETE FROM customers WHERE id::text = $1 AND tenant_id::text = $2`, [String(id), String(targetTid)]);
      if (delCheck.rowCount === 0) {
        return res.status(404).json({ success: false, message: 'Customer not found or unauthorized.' });
      }
    }
    res.json({ success: true, message: 'Customer deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Seed Initial Catalog helper
router.post('/products/seed-default', authenticate, requirePermission('inventory', 'add'), async (req, res) => {
  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const defaultItems = [
      { name: 'Latex Surgical Examination Gloves (Size 7)', sku: 'GLV-LTX-7', unit: 'BOX (100 PCS)', cost: 1250, price: 1750, tax: 'Exempt / 18%' },
      { name: 'Latex Surgical Examination Gloves (Size 8)', sku: 'GLV-LTX-8', unit: 'BOX (100 PCS)', cost: 1250, price: 1750, tax: 'Exempt / 18%' },
      { name: 'Nitrile Heavy-Duty Chemical Gloves (Large)', sku: 'GLV-NIT-L', unit: 'PAIRS', cost: 450, price: 680, tax: 'Standard 18%' },
      { name: 'Industrial Janitorial Floor Cleaner Concentrate', sku: 'JAN-FLR-20L', unit: 'CANE (20 LTR)', cost: 4800, price: 6500, tax: 'Standard 18%' },
      { name: 'Digital Multimeter Cat III 1000V Auto-Ranging', sku: 'MTR-CAT3-DGT', unit: 'PCS', cost: 18500, price: 26000, tax: 'Standard 18%' },
      { name: 'Industrial Submersible Drainage Pump 15HP', sku: 'PMP-IND-15HP', unit: 'SET', cost: 320000, price: 425000, tax: 'Standard 18%' }
    ];

    for (const item of defaultItems) {
      await db.query(
        `INSERT INTO products_services (tenant_id, sku, name, unit, cost_price, selling_price, tax_category, current_stock)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 50)
         ON CONFLICT (sku) DO NOTHING`,
        [tenantId, item.sku, item.name, item.unit, item.cost, item.price, item.tax]
      );
    }

    res.json({ success: true, message: 'Default items seeded successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
