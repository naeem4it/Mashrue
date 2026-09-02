const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');

// ============================================================================
// CUSTOMERS (Mandatory: Customer Name and Organization Type)
// ============================================================================

router.get('/customers', optionalAuth, async (req, res) => {
  try {
    let queryText = `
      SELECT c.*, 
             COALESCE(t.organization_name, 'Default Org') as tenant_name,
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
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
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
  const { business_name, org_type, department_name, ntn, strn, contact_person, email, phone, address, city } = req.body;
  
  if (!business_name || !org_type) {
    return res.status(400).json({
      success: false,
      message: 'Validation Error: Customer Name and Organization Type are mandatory.'
    });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    // Strict duplicate customer check
    const dupCheck = await db.query(
      `SELECT id FROM customers WHERE LOWER(business_name) = LOWER($1) AND tenant_id = $2`,
      [business_name.trim(), tenantId]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Duplicate Error: A customer named "${business_name.trim()}" is already registered in your organization.`
      });
    }

    const result = await db.query(
      `INSERT INTO customers 
       (tenant_id, business_name, org_type, department_name, ntn, strn, contact_person, email, phone, address, city)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
       RETURNING *`,
      [
        tenantId,
        business_name.trim(),
        org_type || 'Government',
        department_name || null,
        ntn || null,
        strn || null,
        contact_person || null,
        email || null,
        phone || null,
        address || null,
        city || 'Lahore'
      ]
    );
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
             COALESCE(t.organization_name, 'Default Org') as tenant_name,
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
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
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
  const { supplier_name, origin, country, city, address, ntn, strn, contact_person, email, phone, rating, payment_terms } = req.body;
  
  if (!supplier_name) {
    return res.status(400).json({ success: false, message: 'Supplier Name is mandatory' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    // Strict duplicate supplier check
    const dupCheck = await db.query(
      `SELECT id FROM suppliers WHERE LOWER(supplier_name) = LOWER($1) AND tenant_id = $2`,
      [supplier_name.trim(), tenantId]
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
        tenantId,
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
             COALESCE(t.organization_name, 'Default Org') as tenant_name,
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
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
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
  const { item_type, sku, name, specifications, description, unit, cost_price, selling_price, tax_category, current_stock, reorder_level, default_supplier_id } = req.body;
  
  if (!name) {
    return res.status(400).json({ success: false, message: 'Product/Item name is mandatory' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const effectiveSku = (sku || `SKU-${Date.now().toString().slice(-6)}`).trim();

    // Strict duplicate product check
    const dupCheck = await db.query(
      `SELECT id FROM products_services 
       WHERE (LOWER(sku) = LOWER($1) OR (LOWER(name) = LOWER($2) AND LOWER(COALESCE(description, '')) = LOWER($3))) 
         AND tenant_id = $4`,
      [effectiveSku, name.trim(), (description || '').trim(), tenantId]
    );
    if (dupCheck.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: `Duplicate Error: Item SKU "${effectiveSku}" or Product Name already exists in catalog.`
      });
    }

    let result;
    try {
      result = await db.query(
        `INSERT INTO products_services 
         (tenant_id, item_type, sku, name, specifications, description, unit, cost_price, selling_price, tax_category, current_stock, reorder_level, default_supplier_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
         RETURNING *`,
        [
          tenantId,
          item_type || 'Product',
          effectiveSku,
          name.trim(),
          specifications ? specifications.trim() : null,
          description || '',
          unit || 'PCS',
          parseFloat(cost_price || 0),
          parseFloat(selling_price || 0),
          tax_category || 'Standard 18%',
          parseFloat(current_stock || 0),
          parseFloat(reorder_level || 5),
          default_supplier_id || null
        ]
      );
    } catch (insErr) {
      result = await db.query(
        `INSERT INTO products_services 
         (tenant_id, item_type, sku, name, description, unit, cost_price, selling_price, tax_category, current_stock, reorder_level, default_supplier_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
         RETURNING *`,
        [
          tenantId,
          item_type || 'Product',
          effectiveSku,
          name.trim(),
          description || (specifications ? `${specifications}` : ''),
          unit || 'PCS',
          parseFloat(cost_price || 0),
          parseFloat(selling_price || 0),
          tax_category || 'Standard 18%',
          parseFloat(current_stock || 0),
          parseFloat(reorder_level || 5),
          default_supplier_id || null
        ]
      );
    }

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
    let result;
    try {
      result = await db.query(
        `UPDATE products_services
         SET sku = COALESCE($1, sku),
             name = COALESCE($2, name),
             specifications = COALESCE($3, specifications),
             description = COALESCE($4, description),
             item_type = COALESCE($5, item_type),
             unit = COALESCE($6, unit),
             cost_price = COALESCE($7, cost_price),
             selling_price = COALESCE($8, selling_price),
             tax_category = COALESCE($9, tax_category),
             current_stock = COALESCE($10, current_stock),
             reorder_level = COALESCE($11, reorder_level),
             default_supplier_id = $12,
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $13
         RETURNING *`,
        [
          sku ? sku.trim() : null,
          name ? name.trim() : null,
          specifications !== undefined ? specifications : null,
          description !== undefined ? description : null,
          item_type || null,
          unit || null,
          cost_price !== undefined ? parseFloat(cost_price) : null,
          selling_price !== undefined ? parseFloat(selling_price) : null,
          tax_category || null,
          current_stock !== undefined ? parseFloat(current_stock) : null,
          reorder_level !== undefined ? parseFloat(reorder_level) : null,
          default_supplier_id || null,
          String(id)
        ]
      );
    } catch (colErr) {
      result = await db.query(
        `UPDATE products_services
         SET sku = COALESCE($1, sku),
             name = COALESCE($2, name),
             description = COALESCE($3, description),
             item_type = COALESCE($4, item_type),
             unit = COALESCE($5, unit),
             cost_price = COALESCE($6, cost_price),
             selling_price = COALESCE($7, selling_price),
             tax_category = COALESCE($8, tax_category),
             current_stock = COALESCE($9, current_stock),
             reorder_level = COALESCE($10, reorder_level),
             default_supplier_id = $11,
             updated_at = CURRENT_TIMESTAMP
         WHERE id::text = $12
         RETURNING *`,
        [
          sku ? sku.trim() : null,
          name ? name.trim() : null,
          description !== undefined ? description : null,
          item_type || null,
          unit || null,
          cost_price !== undefined ? parseFloat(cost_price) : null,
          selling_price !== undefined ? parseFloat(selling_price) : null,
          tax_category || null,
          current_stock !== undefined ? parseFloat(current_stock) : null,
          reorder_level !== undefined ? parseFloat(reorder_level) : null,
          default_supplier_id || null,
          String(id)
        ]
      );
    }

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
  const { business_name, org_type, department_name, ntn, strn, contact_person, email, phone, address, city, status, notes } = req.body;
  try {
    const result = await db.query(
      `UPDATE customers
       SET business_name = COALESCE($1, business_name),
           org_type = COALESCE($2, org_type),
           department_name = COALESCE($3, department_name),
           ntn = COALESCE($4, ntn),
           strn = COALESCE($5, strn),
           contact_person = COALESCE($6, contact_person),
           email = COALESCE($7, email),
           phone = COALESCE($8, phone),
           address = COALESCE($9, address),
           city = COALESCE($10, city),
           status = COALESCE($11, status),
           notes = COALESCE($12, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id::text = $13
       RETURNING *`,
      [
        business_name ? business_name.trim() : null,
        org_type || null,
        department_name || null,
        ntn || null,
        strn || null,
        contact_person || null,
        email || null,
        phone || null,
        address || null,
        city || null,
        status || null,
        notes || null,
        String(id)
      ]
    );
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
