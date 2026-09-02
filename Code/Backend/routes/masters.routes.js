const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');

// ============================================================================
// CUSTOMERS (Mandatory: Customer Name and Organization Type)
// ============================================================================

const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(val || ''));

router.get('/customers', optionalAuth, async (req, res) => {
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

router.post('/customers', optionalAuth, async (req, res) => {
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

router.get('/suppliers', optionalAuth, async (req, res) => {
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

router.post('/suppliers', optionalAuth, async (req, res) => {
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
// PRODUCTS & SKU CATALOG (Item auto-population source)
// ============================================================================

router.get('/products', optionalAuth, async (req, res) => {
  try {
    let queryText = `
      SELECT p.*, s.supplier_name, s.origin as supplier_origin,
             COALESCE(t.company_name, 'Default Org') as tenant_name,
             u.full_name as client_admin_name,
             u.username as client_admin_username
      FROM products_services p
      LEFT JOIN suppliers s ON p.default_supplier_id = s.id
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

router.post('/products', optionalAuth, async (req, res) => {
  const { item_type, sku, name, specifications, description, unit, cost_price, selling_price, tax_category, current_stock, reorder_level, default_supplier_id, tenant_id } = req.body;
  
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

    const candidateFields = {
      tenant_id: resolvedTenantId,
      item_type: item_type || 'Product',
      sku: effectiveSku,
      name: name.trim(),
      specifications: specifications ? specifications.trim() : null,
      description: description ? description.trim() : (specifications ? specifications.trim() : ''),
      unit: unit || 'PCS',
      cost_price: parseFloat(cost_price || 0),
      selling_price: parseFloat(selling_price || 0),
      tax_category: tax_category || 'Standard 18%',
      current_stock: parseFloat(current_stock || 0),
      reorder_level: parseFloat(reorder_level || 5),
      default_supplier_id: isUuid(default_supplier_id) ? default_supplier_id : null
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
    res.status(201).json({ success: true, data: result.rows[0], message: 'Item added to Product Catalog successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update existing product / item
router.put('/products/:id', optionalAuth, async (req, res) => {
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
    default_supplier_id
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
      specifications: specifications !== undefined ? specifications : null,
      description: description !== undefined ? description : null,
      item_type: item_type || null,
      unit: unit || null,
      cost_price: cost_price !== undefined ? parseFloat(cost_price) : null,
      selling_price: selling_price !== undefined ? parseFloat(selling_price) : null,
      tax_category: tax_category || null,
      current_stock: current_stock !== undefined ? parseFloat(current_stock) : null,
      reorder_level: reorder_level !== undefined ? parseFloat(reorder_level) : null,
      default_supplier_id: default_supplier_id || null
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
router.delete('/products/:id', optionalAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(`DELETE FROM products_services WHERE id::text = $1`, [String(id)]);
    res.json({ success: true, message: 'Item deleted from catalog successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update supplier
router.put('/suppliers/:id', optionalAuth, async (req, res) => {
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
router.delete('/suppliers/:id', optionalAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(`DELETE FROM suppliers WHERE id::text = $1`, [String(id)]);
    res.json({ success: true, message: 'Supplier deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update customer
router.put('/customers/:id', optionalAuth, async (req, res) => {
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
router.delete('/customers/:id', optionalAuth, async (req, res) => {
  const { id } = req.params;
  try {
    await db.query(`DELETE FROM customers WHERE id::text = $1`, [String(id)]);
    res.json({ success: true, message: 'Customer deleted successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Seed Initial Catalog helper
router.post('/products/seed-default', optionalAuth, async (req, res) => {
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
