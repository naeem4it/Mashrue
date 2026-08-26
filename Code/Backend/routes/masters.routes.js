const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');

// ============================================================================
// CUSTOMERS (Mandatory: Customer Name and Organization Type)
// ============================================================================

router.get('/customers', optionalAuth, async (req, res) => {
  try {
    let queryText = `SELECT * FROM customers WHERE 1=1`;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    queryText += ` ORDER BY business_name ASC`;
    const result = await db.query(queryText, params);
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
    let queryText = `SELECT * FROM suppliers WHERE 1=1`;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    queryText += ` ORDER BY rating DESC, supplier_name ASC`;
    const result = await db.query(queryText, params);
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
      SELECT p.*, s.supplier_name, s.origin as supplier_origin
      FROM products_services p
      LEFT JOIN suppliers s ON p.default_supplier_id = s.id
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
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/products', optionalAuth, async (req, res) => {
  const { item_type, sku, name, description, unit, cost_price, selling_price, tax_category, current_stock, reorder_level, default_supplier_id } = req.body;
  
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

    const result = await db.query(
      `INSERT INTO products_services 
       (tenant_id, item_type, sku, name, description, unit, cost_price, selling_price, tax_category, current_stock, reorder_level, default_supplier_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) 
       RETURNING *`,
      [
        tenantId,
        item_type || 'Product',
        effectiveSku,
        name.trim(),
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
    res.status(201).json({ success: true, data: result.rows[0], message: 'Item added to Product Catalog successfully' });
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
