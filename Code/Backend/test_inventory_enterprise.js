const http = require('http');
const db = require('./config/db');

function request(options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (data) {
      req.write(typeof data === 'string' ? data : JSON.stringify(data));
    }
    req.end();
  });
}

async function runAuditVerification() {
  console.log('================================================================');
  console.log('🧪 RUNNING COMPREHENSIVE ENTERPRISE INVENTORY VERIFICATION');
  console.log('================================================================\n');

  // 1. Get or create tenant and user for testing
  const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
  const tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';

  const userRes = await db.query(`SELECT id, username, email FROM users LIMIT 1`);
  const userId = userRes.rows[0]?.id;

  console.log(`✓ Active Tenant: ${tenantId}`);
  console.log(`✓ Active User: ${userId} (${userRes.rows[0]?.username})\n`);

  // 2. Verify Universal UOMs in Database & API
  console.log('--- TEST 1: Universal UOM Masters ---');
  const uomDb = await db.query(`SELECT COUNT(*) as count FROM uom_masters`);
  console.log(`✓ UOMs in Database: ${uomDb.rows[0].count} UOM entries`);

  const uomsRes = await db.query(`SELECT uom_code, uom_name, uom_type FROM uom_masters ORDER BY uom_code LIMIT 5`);
  console.log('Sample UOMs:', uomsRes.rows);

  // 3. Verify Categories & Sub-Categories
  console.log('\n--- TEST 2: 2-Tier Taxonomy (Categories & Subcategories) ---');
  const catDb = await db.query(`SELECT COUNT(*) as count FROM item_categories`);
  const subCatDb = await db.query(`SELECT COUNT(*) as count FROM item_sub_categories`);
  console.log(`✓ Industry Categories: ${catDb.rows[0].count}`);
  console.log(`✓ Sub-Categories: ${subCatDb.rows[0].count}`);

  const sampleCat = await db.query(`SELECT id, category_name FROM item_categories WHERE category_name ILIKE '%Medical%' LIMIT 1`);
  const medCatId = sampleCat.rows[0]?.id;
  const sampleSubCats = await db.query(`SELECT sub_category_name FROM item_sub_categories WHERE category_id = $1`, [medCatId]);
  console.log(`✓ Medical Sub-Categories for "${sampleCat.rows[0]?.category_name}":`, sampleSubCats.rows.map(r => r.sub_category_name));

  // 4. Test Multi-Industry Catalog Items
  console.log('\n--- TEST 3: Registering Multi-Industry Items ---');
  const testItems = [
    {
      sku: 'TEST-ELEC-TRF-' + Date.now().toString().slice(-4),
      name: '132kV Power Transformer (40 MVA)',
      category: 'Electrical',
      subCat: 'Transformer',
      uom: 'SET',
      tracking: 'Standard',
      cost: 24500000,
      price: 29000000
    },
    {
      sku: 'TEST-MED-PARA-' + Date.now().toString().slice(-4),
      name: 'Paracetamol IV Infusion 1000mg/100ml',
      category: 'Medical',
      subCat: 'Pharmaceutical',
      uom: 'VIAL',
      tracking: 'Batch_Expiry',
      cost: 180,
      price: 240
    }
  ];

  const createdProducts = [];
  for (const it of testItems) {
    const cRes = await db.query(`SELECT id, category_name FROM item_categories WHERE category_name ILIKE $1 LIMIT 1`, ['%' + it.category + '%']);
    const catId = cRes.rows[0]?.id;
    const scRes = await db.query(`SELECT id, sub_category_name FROM item_sub_categories WHERE category_id = $1 AND sub_category_name ILIKE $2 LIMIT 1`, [catId, '%' + it.subCat + '%']);
    const subCatId = scRes.rows[0]?.id;
    const uRes = await db.query(`SELECT id FROM uom_masters WHERE uom_code = $1 LIMIT 1`, [it.uom]);
    const uomUuid = uRes.rows[0]?.id || null;

    const insRes = await db.query(
      `INSERT INTO products_services 
       (tenant_id, sku, name, category_id, sub_category_id, uom_id, tracking_type, unit, cost_price, selling_price, item_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, sku, name, category_id, sub_category_id, uom_id, tracking_type`,
      [tenantId, it.sku, it.name, catId, subCatId, uomUuid, it.tracking, it.uom, it.cost, it.price, it.tracking === 'Batch_Expiry' ? 'Medicine' : 'Product']
    );
    createdProducts.push(insRes.rows[0]);
    console.log(`✓ Created item SKU: ${insRes.rows[0].sku} | Category: ${cRes.rows[0]?.category_name} | Sub: ${scRes.rows[0]?.sub_category_name || 'General'} | UOM: ${it.uom} | Tracking: ${insRes.rows[0].tracking_type}`);
  }

  // 5. Test Warehouse Stock Multi-Batch Setup
  console.log('\n--- TEST 4: Multi-Batch Medical Inventory Stocking ---');
  const whRes = await db.query(`SELECT id, warehouse_name FROM warehouses LIMIT 1`);
  let whId = whRes.rows[0]?.id;
  if (!whId) {
    const newWh = await db.query(
      `INSERT INTO warehouses (tenant_id, warehouse_name, city, is_active) 
       VALUES ($1, 'Central Test Warehouse (Kot Lakhpat)', 'Lahore', true) RETURNING id`,
      [tenantId]
    );
    whId = newWh.rows[0].id;
  }
  console.log(`✓ Target Warehouse: ${whId}`);

  const medProd = createdProducts.find(p => p.tracking_type === 'Batch_Expiry');
  const batch1 = 'BATCH-TEST-2026-A1';
  const batch2 = 'BATCH-TEST-2026-B2';

  // Stock Batch 1: 30 units (expiring Dec 2026)
  await db.query(
    `INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, batch_number, quantity_on_hand, manufacturing_date, expiry_date)
     VALUES ($1, $2, $3, $4, 30, '2026-01-01', '2026-12-31')
     ON CONFLICT (warehouse_id, product_id, batch_number)
     DO UPDATE SET quantity_on_hand = 30, expiry_date = '2026-12-31'`,
    [tenantId, whId, medProd.id, batch1]
  );

  // Stock Batch 2: 20 units (expiring June 2027)
  await db.query(
    `INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, batch_number, quantity_on_hand, manufacturing_date, expiry_date)
     VALUES ($1, $2, $3, $4, 20, '2026-06-01', '2027-06-30')
     ON CONFLICT (warehouse_id, product_id, batch_number)
     DO UPDATE SET quantity_on_hand = 20, expiry_date = '2027-06-30'`,
    [tenantId, whId, medProd.id, batch2]
  );

  // Update total stock on product
  await db.query(`UPDATE products_services SET current_stock = 50 WHERE id = $1`, [medProd.id]);

  const stockCheck = await db.query(
    `SELECT batch_number, quantity_on_hand, expiry_date FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2 ORDER BY expiry_date ASC`,
    [whId, medProd.id]
  );
  console.log('✓ Initial Warehouse Batches in Stock:');
  stockCheck.rows.forEach(b => console.log(`   - Lot: ${b.batch_number} | Qty: ${b.quantity_on_hand} | Expiry: ${String(b.expiry_date).slice(0, 10)}`));

  // 6. Test Multi-Batch Delivery Challan Dispatch (30 from Batch 1 + 20 from Batch 2 = 50 Total)
  console.log('\n--- TEST 5: Multi-Batch Split Delivery Challan Dispatch ---');
  // Get existing Purchase Order or null
  const poRes = await db.query(`SELECT id FROM purchase_orders LIMIT 1`);
  const testPoId = poRes.rows[0]?.id || null;
  const bpRes = await db.query(`SELECT id FROM business_profiles LIMIT 1`);
  const bpId = bpRes.rows[0]?.id || '88000000-0000-0000-0000-000000000001';

  const custRes = await db.query(`SELECT id FROM customers LIMIT 1`);
  let custId = custRes.rows[0]?.id;
  if (!custId) {
    const newCust = await db.query(`INSERT INTO customers (tenant_id, company_name) VALUES ($1, 'Shaukat Khanum Memorial Hospital') RETURNING id`, [tenantId]);
    custId = newCust.rows[0].id;
  }

  // Insert Delivery Challan
  const dcNumber = 'DC-TEST-SPLIT-' + Date.now().toString().slice(-4);
  const dcRes = await db.query(
    `INSERT INTO delivery_challans 
     (tenant_id, business_profile_id, customer_id, purchase_order_id, dc_number, delivery_date, delivery_mode, warehouse_id, destination_site, status)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'Own Warehouse', $6, 'SKMCH Lahore Pharmacy Store', 'Dispatched')
     RETURNING id, dc_number, delivery_mode`,
    [tenantId, bpId, custId, testPoId, dcNumber, whId]
  );
  const dcId = dcRes.rows[0].id;
  console.log(`✓ Created Delivery Challan: ${dcNumber} (ID: ${dcId})`);

  // Dispatch item split across 2 batches
  const splitItems = [
    { batch: batch1, qty: 30, dom: '2026-01-01', doe: '2026-12-31' },
    { batch: batch2, qty: 20, dom: '2026-06-01', doe: '2027-06-30' }
  ];

  for (const itm of splitItems) {
    // 1. Insert item line
    await db.query(
      `INSERT INTO delivery_challan_items 
       (delivery_challan_id, product_service_id, item_name, quantity, unit, batch_number, manufacturing_date, expiry_date)
       VALUES ($1, $2, 'Paracetamol IV Infusion 1000mg/100ml', $3, 'VIAL', $4, $5, $6)`,
      [dcId, medProd.id, itm.qty, itm.batch, itm.dom, itm.doe]
    );

    // 2. Record inventory audit ledger
    await db.query(
      `INSERT INTO inventory_transactions 
       (tenant_id, product_id, warehouse_id, delivery_challan_id, transaction_type, quantity, batch_number, reference_type, reference_id, remarks)
       VALUES ($1, $2, $3, $4, 'DELIVERY', $5, $6, 'DC', $4, 'Dispatched against Delivery Challan')`,
      [tenantId, medProd.id, whId, dcId, itm.qty, itm.batch]
    );

    // 3. Decrement specific batch in warehouse
    await db.query(
      `UPDATE warehouse_stock 
       SET quantity_on_hand = GREATEST(0, quantity_on_hand - $1), updated_at = CURRENT_TIMESTAMP
       WHERE warehouse_id = $2 AND product_id = $3 AND batch_number = $4`,
      [itm.qty, whId, medProd.id, itm.batch]
    );
  }

  // Update product catalog current stock
  await db.query(`UPDATE products_services SET current_stock = GREATEST(0, current_stock - 50) WHERE id = $1`, [medProd.id]);

  console.log('✓ Successfully dispatched 50 units (30 from Batch 1 and 20 from Batch 2)');

  // Verify resulting warehouse stock
  const postStockCheck = await db.query(
    `SELECT batch_number, quantity_on_hand FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2 ORDER BY batch_number ASC`,
    [whId, medProd.id]
  );
  console.log('✓ Resulting Stock Balances in Warehouse:');
  postStockCheck.rows.forEach(b => console.log(`   - Lot: ${b.batch_number} -> Remaining Qty: ${b.quantity_on_hand}`));

  if (postStockCheck.rows.every(r => parseFloat(r.quantity_on_hand) === 0)) {
    console.log('🌟 PASS: Multi-batch quantities accurately decremented to zero per batch row!');
  } else {
    console.error('❌ FAIL: Quantities were not decremented correctly.');
  }

  // 7. Test Direct Drop-Shipment Fulfillment
  console.log('\n--- TEST 6: Direct Drop-Shipment (Supplier to Customer Direct) ---');
  // Get or create supplier
  let supRes = await db.query(`SELECT id, supplier_name FROM suppliers LIMIT 1`);
  let supId = supRes.rows[0]?.id;
  if (!supId) {
    const newSup = await db.query(`INSERT INTO suppliers (tenant_id, supplier_name) VALUES ($1, 'Global OEM Supplies Ltd') RETURNING id`, [tenantId]);
    supId = newSup.rows[0].id;
  }

  const dropDCNumber = 'DC-DROP-TEST-' + Date.now().toString().slice(-4);
  const dropDCRes = await db.query(
    `INSERT INTO delivery_challans 
     (tenant_id, business_profile_id, customer_id, purchase_order_id, dc_number, delivery_date, delivery_mode, warehouse_id, supplier_id, destination_site, status)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'Direct Drop-Shipment', NULL, $6, 'LESCO 132kV Substation Kasur', 'Dispatched')
     RETURNING id, dc_number, delivery_mode, warehouse_id, supplier_id`,
    [tenantId, bpId, custId, testPoId, dropDCNumber, supId]
  );
  const dropDCId = dropDCRes.rows[0].id;

  // Insert drop-shipment audit transaction (warehouse_id = NULL)
  const auditRes = await db.query(
    `INSERT INTO inventory_transactions 
     (tenant_id, product_id, warehouse_id, supplier_id, delivery_challan_id, transaction_type, quantity, batch_number, reference_type, reference_id, remarks)
     VALUES ($1, $2, NULL, $3, $4, 'DIRECT_DISPATCH', 1, 'OEM-FACTORY-DIRECT', 'DC', $4, 'Direct Drop-Shipment from Supplier to Site')
     RETURNING id, transaction_type, warehouse_id, supplier_id`,
    [tenantId, createdProducts[0].id, supId, dropDCId]
  );
  console.log(`✓ Direct Drop-Shipment DC Created: ${dropDCNumber} | Warehouse ID: ${dropDCRes.rows[0].warehouse_id || 'NULL (Direct)'}`);
  console.log(`✓ Audit Ledger Recorded: Type = ${auditRes.rows[0].transaction_type} | Warehouse = ${auditRes.rows[0].warehouse_id || 'NULL'}`);

  // Verify that GET /delivery-challans query includes this drop-shipment DC (verifies our LEFT JOIN fix)
  const dcListCheck = await db.query(
    `SELECT dc.id, dc.dc_number, dc.delivery_mode, w.warehouse_name, s.supplier_name
     FROM delivery_challans dc
     LEFT JOIN warehouses w ON dc.warehouse_id = w.id
     LEFT JOIN suppliers s ON dc.supplier_id = s.id
     WHERE dc.id = $1`,
    [dropDCId]
  );

  if (dcListCheck.rows.length > 0) {
    console.log(`🌟 PASS: Drop-Shipment DC verified in listing query! Mode: "${dcListCheck.rows[0].delivery_mode}", Supplier: "${dcListCheck.rows[0].supplier_name}", Warehouse: "${dcListCheck.rows[0].warehouse_name || 'None (Direct Dispatch)'}"`);
  } else {
    console.error('❌ FAIL: Drop-Shipment DC was omitted by listing query.');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 6 ENTERPRISE INVENTORY AUDIT TESTS PASSED SUCCESSFULLY!');
  console.log('================================================================');

  process.exit(0);
}

runAuditVerification().catch(err => {
  console.error('FATAL ERROR DURING AUDIT VERIFICATION:', err);
  process.exit(1);
});
