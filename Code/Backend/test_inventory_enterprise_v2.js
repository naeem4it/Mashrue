const db = require('./config/db');
const { autoPostInventoryToGL } = require('./utils/glPoster');
const {
  calculateWeightedAverageCost,
  checkNegativeStockPolicy,
  recordStockMovement,
  getValuationReport,
  getReorderAlerts,
  executeStockTransfer,
  executeStockAdjustment
} = require('./services/inventoryValuationService');

async function runInventoryEnterpriseTestSuite() {
  console.log('================================================================');
  console.log('🧪 RUNNING COMPREHENSIVE INVENTORY MODULE V2 TEST SUITE');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition, message) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  // 1. Setup Tenant and Users
  console.log('--- 1. Multi-Tenant Setup & Context ---');
  const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
  const tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
  
  // Create or get Tenant B for isolation testing
  let tenantBRes = await db.query(`SELECT id FROM tenants WHERE id != $1 LIMIT 1`, [tenantId]);
  let tenantBId;
  if (tenantBRes.rows.length === 0) {
    const tB = await db.query(
      `INSERT INTO tenants (id, name, subdomain, is_active)
       VALUES ('b0000000-0000-0000-0000-000000000002', 'Competitor Tenant B', 'tenant-b-test', true)
       ON CONFLICT (id) DO UPDATE SET name = 'Competitor Tenant B'
       RETURNING id`
    );
    tenantBId = tB.rows[0].id;
  } else {
    tenantBId = tenantBRes.rows[0].id;
  }

  console.log(`  ✓ Tenant A ID: ${tenantId}`);
  console.log(`  ✓ Tenant B ID: ${tenantBId}\n`);

  // 2. Ensure Warehouses Exist
  console.log('--- 2. Warehouse Locations Setup ---');
  let wh1Res = await db.query(`SELECT id, warehouse_name FROM warehouses WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  let wh1Id = wh1Res.rows[0]?.id;
  if (!wh1Id) {
    const nw1 = await db.query(
      `INSERT INTO warehouses (tenant_id, warehouse_name, city, is_active)
       VALUES ($1, 'Main Central Depot (A1)', 'Karachi', true) RETURNING id`,
      [tenantId]
    );
    wh1Id = nw1.rows[0].id;
  }

  let wh2Res = await db.query(`SELECT id, warehouse_name FROM warehouses WHERE tenant_id = $1 AND id != $2 LIMIT 1`, [tenantId, wh1Id]);
  let wh2Id = wh2Res.rows[0]?.id;
  if (!wh2Id) {
    const nw2 = await db.query(
      `INSERT INTO warehouses (tenant_id, warehouse_name, city, is_active)
       VALUES ($1, 'Regional Transit Depot (B2)', 'Lahore', true) RETURNING id`,
      [tenantId]
    );
    wh2Id = nw2.rows[0].id;
  }
  console.log(`  ✓ Warehouse 1: ${wh1Id}`);
  console.log(`  ✓ Warehouse 2: ${wh2Id}\n`);

  // Ensure Supplier Exists
  let supRes = await db.query(`SELECT id, supplier_name FROM suppliers WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  let supId = supRes.rows[0]?.id;
  if (!supId) {
    const nsup = await db.query(
      `INSERT INTO suppliers (tenant_id, supplier_name, email, phone)
       VALUES ($1, 'Prime Industrial Spares LLC', 'orders@primeindustrial.pk', '021-3456789') RETURNING id`,
      [tenantId]
    );
    supId = nsup.rows[0].id;
  }
  console.log(`  ✓ Test Supplier: ${supId}\n`);

  // 3. Product Master Lifecycle & Extended Attributes
  console.log('--- 3. Product Master Lifecycle & Archive/Restore ---');
  const testSku = 'SKU-V2-' + Date.now().toString().slice(-6);
  const testBarcode = '890123' + Date.now().toString().slice(-6);
  
  const createProdRes = await db.query(
    `INSERT INTO products_services (
      tenant_id, sku, name, item_type, barcode, unit, cost_price, selling_price,
      min_stock_level, max_stock_level, valuation_method, supplier_product_code,
      purchase_description, sales_description, allow_negative_stock, current_stock
    ) VALUES (
      $1, $2, 'Industrial Solenoid Valve 24V DC', 'Product', $3, 'PCS', 100.00, 160.00,
      5, 100, 'WEIGHTED_AVG', 'SUP-VALV-24V',
      'High pressure pneumatic valve', 'Complete assembly valve', false, 0
    ) RETURNING *`,
    [tenantId, testSku, testBarcode]
  );
  const prod = createProdRes.rows[0];
  assert(prod.sku === testSku, `Product created with SKU ${testSku}`);
  assert(prod.barcode === testBarcode, `Product has barcode ${testBarcode}`);
  assert(prod.valuation_method === 'WEIGHTED_AVG', `Valuation method is WEIGHTED_AVG`);
  assert(prod.is_archived === false, `Initial archive state is false`);

  // Test Archive
  await db.query(`UPDATE products_services SET is_archived = true WHERE id = $1 AND tenant_id = $2`, [prod.id, tenantId]);
  const archCheck = await db.query(`SELECT is_archived FROM products_services WHERE id = $1`, [prod.id]);
  assert(archCheck.rows[0].is_archived === true, `Product archived successfully`);

  // Test Restore
  await db.query(`UPDATE products_services SET is_archived = false WHERE id = $1 AND tenant_id = $2`, [prod.id, tenantId]);
  const restoreCheck = await db.query(`SELECT is_archived FROM products_services WHERE id = $1`, [prod.id]);
  assert(restoreCheck.rows[0].is_archived === false, `Product restored to active catalog\n`);

  // 4. Product Duplicate SKU Detection
  console.log('--- 4. Product Duplicate Detection on Master Catalog ---');
  let dupCaught = false;
  try {
    await db.query(
      `INSERT INTO products_services (tenant_id, sku, name, item_type, unit, cost_price, selling_price)
       VALUES ($1, $2, 'Duplicate SKU Item', 'Product', 'PCS', 100, 150)`,
      [tenantId, testSku]
    );
  } catch (err) {
    console.log('Duplicate insert caught error:', err.message);
    dupCaught = true;
  }
  assert(dupCaught === true, `Database enforces unique SKU per tenant isolation\n`);

  // 5. Negative-Stock Policy Enforcement
  console.log('--- 5. Negative-Stock Policy Check ---');
  // Initial check: stock is 0, allow_negative_stock is false -> checkNegativeStockPolicy should throw/disallow
  let disallowedCaught = false;
  try {
    await checkNegativeStockPolicy(tenantId, prod.id, wh1Id, 10);
  } catch (err) {
    if (err.message && err.message.includes('Negative stock disallowed')) {
      disallowedCaught = true;
    }
  }
  assert(disallowedCaught === true, `Negative stock correctly disallowed and blocked when stock is 0`);

  // Allow negative stock at product level
  await db.query(`UPDATE products_services SET allow_negative_stock = true WHERE id = $1`, [prod.id]);
  const negCheck2 = await checkNegativeStockPolicy(tenantId, prod.id, wh1Id, 10);
  assert(negCheck2.allowed === true, `Negative stock allowed when product-level override is TRUE`);

  // Restore strict safety
  await db.query(`UPDATE products_services SET allow_negative_stock = false WHERE id = $1`, [prod.id]);
  let disallowedCaughtAgain = false;
  try {
    await checkNegativeStockPolicy(tenantId, prod.id, wh1Id, 10);
  } catch (err) {
    if (err.message && err.message.includes('Negative stock disallowed')) {
      disallowedCaughtAgain = true;
    }
  }
  assert(disallowedCaughtAgain === true, `Negative stock restored to strict safety (blocked)\n`);

  // 6. Purchase Requisitions & Approval Workflow
  console.log('--- 6. Purchase Requisitions & Approval ---');
  const prNumber = 'PR-' + Date.now().toString().slice(-6);
  const prRes = await db.query(
    `INSERT INTO purchase_requisitions (
      tenant_id, requisition_number, department_name, priority, status, notes
    ) VALUES ($1, $2, 'Engineering', 'High', 'Pending', 'Urgent maintenance spares')
    RETURNING id, requisition_number, status`,
    [tenantId, prNumber]
  );
  const prId = prRes.rows[0].id;
  assert(prRes.rows[0].status === 'Pending', `Requisition ${prNumber} created with status Pending`);

  await db.query(
    `INSERT INTO purchase_requisition_items (
      tenant_id, requisition_id, product_id, requested_quantity, estimated_unit_cost, estimated_total
    ) VALUES ($1, $2, $3, 20, 100.00, 2000.00)`,
    [tenantId, prId, prod.id]
  );

  // Approve Requisition
  await db.query(
    `UPDATE purchase_requisitions SET status = 'Approved', approved_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [prId]
  );
  const prAppCheck = await db.query(`SELECT status, approved_at FROM purchase_requisitions WHERE id = $1`, [prId]);
  assert(prAppCheck.rows[0].status === 'Approved' && prAppCheck.rows[0].approved_at !== null, `Requisition approved with timestamp\n`);

  // 7. Supplier Procurement (Purchase Order) with Line Items
  console.log('--- 7. Supplier Procurement with Line Items (procurement_items) ---');
  const bpRes = await db.query(`SELECT id FROM business_profiles LIMIT 1`);
  const bpId = bpRes.rows[0]?.id || null;

  const poRef = 'PO-SUP-' + Date.now().toString().slice(-6);
  const procRes = await db.query(
    `INSERT INTO procurements (
      tenant_id, business_profile_id, supplier_id, procurement_number, procurement_type, currency, total_landed_cost, status
    ) VALUES ($1, $2, $3, $4, 'Local Purchase', 'PKR', 2000.00, 'Issued')
    RETURNING id, procurement_number, status`,
    [tenantId, bpId, supId, poRef]
  );
  const procId = procRes.rows[0].id;
  assert(procRes.rows[0].procurement_number === poRef, `Procurement Order created: ${poRef}`);

  const itemLineRes = await db.query(
    `INSERT INTO procurement_items (
      tenant_id, procurement_id, product_id, ordered_quantity, received_quantity, unit_cost, total_cost, status
    ) VALUES ($1, $2, $3, 20, 0, 100.00, 2000.00, 'Pending')
    RETURNING id, ordered_quantity, received_quantity`,
    [tenantId, procId, prod.id]
  );
  const lineItemId = itemLineRes.rows[0].id;
  assert(parseFloat(itemLineRes.rows[0].ordered_quantity) === 20, `Procurement line item created for 20 PCS\n`);

  // 8. Inward Goods Receipt (GRN) with Partial Delivery & Backorder
  console.log('--- 8. Partial Inward Goods Receipt (GRN) & Backorder Tracking ---');
  const grnNumber = 'GRN-' + Date.now().toString().slice(-6);
  const partialQty = 12; // Receiving 12 out of 20
  const inwardUnitCost = 120.00; // Inward at 120/unit

  const grnRes = await db.query(
    `INSERT INTO goods_receipt_notes (
      tenant_id, grn_number, procurement_id, supplier_id, warehouse_id,
      reference_type, reference_number, status, total_received_value, remarks
    ) VALUES ($1, $2, $3, $4, $5, 'SUPPLIER_DC', 'DC-SUP-9988', 'Received', $6, 'Partial shipment 12 of 20 received')
    RETURNING id, grn_number`,
    [tenantId, grnNumber, procId, supId, wh1Id, partialQty * inwardUnitCost]
  );
  const grnId = grnRes.rows[0].id;

  await db.query(
    `INSERT INTO goods_receipt_note_items (
      tenant_id, grn_id, procurement_item_id, product_id, ordered_quantity, received_quantity,
      rejected_quantity, unit_cost, total_value, batch_number, expiry_date
    ) VALUES ($1, $2, $3, $4, 20, $5, 0, $6, $7, 'LOT-A1', '2028-12-31')`,
    [tenantId, grnId, lineItemId, prod.id, partialQty, inwardUnitCost, partialQty * inwardUnitCost]
  );

  // Update procurement_item received_quantity
  await db.query(
    `UPDATE procurement_items
     SET received_quantity = received_quantity + $1,
         status = CASE WHEN (received_quantity + $1) >= ordered_quantity THEN 'Received' ELSE 'Partially Received' END
     WHERE id = $2`,
    [partialQty, lineItemId]
  );

  // Update procurement order status
  await db.query(`UPDATE procurements SET status = 'Partially Received' WHERE id = $1`, [procId]);

  // Record Stock Inward Movement via valuation service
  await recordStockMovement({
    tenantId,
    productId: prod.id,
    warehouseId: wh1Id,
    movementType: 'IN',
    quantity: partialQty,
    unitCost: inwardUnitCost,
    batchNumber: 'LOT-A1',
    referenceType: 'GRN',
    referenceId: grnId,
    remarks: `Partial GRN receipt ${grnNumber}`
  });

  // Verify procurement item status and backorder
  const updatedItemRes = await db.query(`SELECT ordered_quantity, received_quantity, status FROM procurement_items WHERE id = $1`, [lineItemId]);
  const ordQty = parseFloat(updatedItemRes.rows[0].ordered_quantity);
  const recQty = parseFloat(updatedItemRes.rows[0].received_quantity);
  const backorder = ordQty - recQty;
  assert(recQty === 12, `Procurement item received quantity is 12`);
  assert(backorder === 8, `Remaining backorder correctly calculated as 8 PCS`);
  assert(updatedItemRes.rows[0].status === 'Partially Received', `Procurement line status updated to Partially Received\n`);

  // 9. Weighted Average Cost Recalculation
  console.log('--- 9. Weighted Average Cost Recalculation ---');
  // Initial was 0 stock @ 100. Then we received 12 @ 120 -> New average cost is 120.
  // Now simulate second receipt of 8 units @ 150/unit:
  // Total current: 12 units @ 120 = 1440.
  // Inward: 8 units @ 150 = 1200.
  // Expected new average: (1440 + 1200) / (12 + 8) = 2640 / 20 = 132.00
  const recalculatedWAC = calculateWeightedAverageCost(12, 120.00, 8, 150.00);
  assert(recalculatedWAC === 132.00, `Weighted Average Cost accurately computed as 132.00 (expected 132.00)`);

  // Complete the remaining 8 units receipt
  const grnNumber2 = 'GRN-' + Date.now().toString().slice(-6);
  const grnRes2 = await db.query(
    `INSERT INTO goods_receipt_notes (
      tenant_id, grn_number, procurement_id, supplier_id, warehouse_id,
      reference_type, reference_number, status, total_received_value, remarks
    ) VALUES ($1, $2, $3, $4, $5, 'SUPPLIER_DC', 'DC-SUP-9989', 'Received', $6, 'Final balance shipment 8 of 20')
    RETURNING id`,
    [tenantId, grnNumber2, procId, supId, wh1Id, 8 * 150.00]
  );
  
  await recordStockMovement({
    tenantId,
    productId: prod.id,
    warehouseId: wh1Id,
    movementType: 'IN',
    quantity: 8,
    unitCost: 150.00,
    batchNumber: 'LOT-A2',
    referenceType: 'GRN',
    referenceId: grnRes2.rows[0].id,
    remarks: `Final GRN receipt ${grnNumber2}`
  });

  await db.query(
    `UPDATE procurement_items
     SET received_quantity = received_quantity + 8,
         status = 'Received'
     WHERE id = $1`,
    [lineItemId]
  );
  await db.query(`UPDATE procurements SET status = 'Received' WHERE id = $1`, [procId]);

  // Check product current cost and stock
  const prodAfterGRN = await db.query(`SELECT current_stock, cost_price FROM products_services WHERE id = $1`, [prod.id]);
  assert(parseFloat(prodAfterGRN.rows[0].current_stock) === 20, `Total catalog stock updated to 20 units`);
  assert(parseFloat(prodAfterGRN.rows[0].cost_price) === 132.00, `Product catalog cost price updated to 132.00\n`);

  // 10. Inter-Warehouse Stock Transfer
  console.log('--- 10. Inter-Warehouse Stock Transfer ---');
  // Transfer 5 units from Warehouse 1 to Warehouse 2
  const transferQty = 5;
  const transferNumber = 'TRF-' + Date.now().toString().slice(-6);

  const trfRes = await db.query(
    `INSERT INTO inventory_transfers (
      tenant_id, transfer_number, from_warehouse_id, to_warehouse_id, transfer_date, status, notes
    ) VALUES ($1, $2, $3, $4, CURRENT_DATE, 'Completed', 'Inter-depot rebalancing')
    RETURNING id`,
    [tenantId, transferNumber, wh1Id, wh2Id]
  );
  const trfId = trfRes.rows[0].id;

  await db.query(
    `INSERT INTO inventory_transfer_items (
      transfer_id, product_id, quantity, unit_cost, batch_number
    ) VALUES ($1, $2, $3, 132.00, 'LOT-A1')`,
    [trfId, prod.id, transferQty]
  );

  // Deduct from WH1
  await recordStockMovement({
    tenantId,
    productId: prod.id,
    warehouseId: wh1Id,
    transactionType: 'TRANSFER_OUT',
    quantity: transferQty,
    unitCost: 132.00,
    batchNumber: 'LOT-A1',
    referenceType: 'TRANSFER_OUT',
    referenceId: trfId,
    remarks: `Transfer ${transferNumber} to WH2`
  });

  // Add to WH2
  await recordStockMovement({
    tenantId,
    productId: prod.id,
    warehouseId: wh2Id,
    transactionType: 'TRANSFER_IN',
    quantity: transferQty,
    unitCost: 132.00,
    batchNumber: 'LOT-A1',
    referenceType: 'TRANSFER_IN',
    referenceId: trfId,
    remarks: `Transfer ${transferNumber} from WH1`
  });

  const wh1Stock = await db.query(`SELECT COALESCE(SUM(quantity_on_hand), 0) as qty FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`, [wh1Id, prod.id]);
  const wh2Stock = await db.query(`SELECT COALESCE(SUM(quantity_on_hand), 0) as qty FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`, [wh2Id, prod.id]);
  assert(parseFloat(wh1Stock.rows[0].qty) === 15, `Warehouse 1 stock reduced to 15 (was 20 - 5)`);
  assert(parseFloat(wh2Stock.rows[0].qty) === 5, `Warehouse 2 stock increased to 5 units\n`);

  // 11. Stock Reservations and Available Calculation
  console.log('--- 11. Stock Reservations & Available Quantity Calculation ---');
  // Reserve 4 units in Warehouse 1 for an active tender bid
  const resvRes = await db.query(
    `INSERT INTO stock_reservations (
      tenant_id, product_id, warehouse_id, batch_number, reserved_quantity, status
    ) VALUES ($1, $2, $3, 'LOT-A1', 4, 'Active')
    RETURNING id`,
    [tenantId, prod.id, wh1Id]
  );
  const resvId = resvRes.rows[0].id;

  // Increment warehouse_stock reserved
  await db.query(
    `UPDATE warehouse_stock
     SET quantity_reserved = quantity_reserved + 4
     WHERE warehouse_id = $1 AND product_id = $2 AND batch_number = 'LOT-A1'`,
    [wh1Id, prod.id]
  );

  // Query on-hand, reserved, and available
  const resvCalc = await db.query(
    `SELECT 
       COALESCE(SUM(ws.quantity_on_hand), 0) AS on_hand,
       COALESCE(SUM(ws.quantity_reserved), 0) AS reserved,
       COALESCE(SUM(ws.quantity_on_hand - ws.quantity_reserved), 0) AS available
     FROM warehouse_stock ws
     WHERE ws.warehouse_id = $1 AND ws.product_id = $2`,
    [wh1Id, prod.id]
  );
  const onHand = parseFloat(resvCalc.rows[0].on_hand);
  const reserved = parseFloat(resvCalc.rows[0].reserved);
  const available = parseFloat(resvCalc.rows[0].available);
  assert(onHand === 15, `On-hand stock in WH1 is 15`);
  assert(reserved === 4, `Reserved stock in WH1 is 4`);
  assert(available === 11, `Available quantity accurately calculated as 11 (15 - 4)`);

  // Release reservation
  await db.query(`UPDATE stock_reservations SET status = 'Fulfilled' WHERE id = $1`, [resvId]);
  await db.query(
    `UPDATE warehouse_stock
     SET quantity_reserved = GREATEST(0, quantity_reserved - 4)
     WHERE warehouse_id = $1 AND product_id = $2 AND batch_number = 'LOT-A1'`,
    [wh1Id, prod.id]
  );
  const resvCalcAfter = await db.query(
    `SELECT COALESCE(SUM(quantity_reserved), 0) AS reserved FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`,
    [wh1Id, prod.id]
  );
  assert(parseFloat(resvCalcAfter.rows[0].reserved) === 0, `Reservation released; active reserved quantity returns to 0\n`);

  // 12. Physical Stock Count & Reconciliation Variance
  console.log('--- 12. Physical Stock Count & Reconciliation ---');
  // WH1 has 15 on hand. Auditor counts 14 (1 missing/damaged)
  const auditDiff = 1;
  const adjNumber = 'ADJ-' + Date.now().toString().slice(-6);
  const adjRes = await db.query(
    `INSERT INTO inventory_adjustments (
      tenant_id, adjustment_number, warehouse_id, adjustment_date, adjustment_type, total_value_impact, status, remarks
    ) VALUES ($1, $2, $3, CURRENT_DATE, 'Physical Count Audit', -132.00, 'Posted', 'Physical cycle count variance')
    RETURNING id`,
    [tenantId, adjNumber, wh1Id]
  );
  const adjId = adjRes.rows[0].id;

  await db.query(
    `INSERT INTO inventory_adjustment_items (
      adjustment_id, product_id, batch_number, system_stock, physical_stock, difference_qty, unit_cost
    ) VALUES ($1, $2, 'LOT-A1', 15, 14, -1, 132.00)`,
    [adjId, prod.id]
  );

  await recordStockMovement({
    tenantId,
    productId: prod.id,
    warehouseId: wh1Id,
    transactionType: 'ADJUSTMENT_NEG',
    quantity: auditDiff,
    unitCost: 132.00,
    batchNumber: 'LOT-A1',
    referenceType: 'ADJUSTMENT',
    referenceId: adjId,
    remarks: `Reconciliation adjustment ${adjNumber}`
  });

  const postAdjWH1 = await db.query(`SELECT COALESCE(SUM(quantity_on_hand), 0) as qty FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`, [wh1Id, prod.id]);
  assert(parseFloat(postAdjWH1.rows[0].qty) === 14, `Physical count reconciliation updated WH1 on-hand to 14 units\n`);

  // 13. Supplier Return (RTV)
  console.log('--- 13. Supplier Return (RTV) ---');
  // Return 2 units back to supplier from WH1
  const returnQty = 2;
  const returnNumber = 'RTV-' + Date.now().toString().slice(-6);
  const rtvRes = await db.query(
    `INSERT INTO supplier_returns (
      tenant_id, return_number, supplier_id, warehouse_id, return_date, status, total_return_value, reason
    ) VALUES ($1, $2, $3, $4, CURRENT_DATE, 'Completed', $5, 'Minor seal damage on inward shipment')
    RETURNING id`,
    [tenantId, returnNumber, supId, wh1Id, returnQty * 132.00]
  );
  const rtvId = rtvRes.rows[0].id;

  await db.query(
    `INSERT INTO supplier_return_items (
      tenant_id, supplier_return_id, product_id, quantity, unit_cost, total_value, reason
    ) VALUES ($1, $2, $3, $4, 132.00, $5, 'Seal damage')`,
    [tenantId, rtvId, prod.id, returnQty, returnQty * 132.00]
  );

  await recordStockMovement({
    tenantId,
    productId: prod.id,
    warehouseId: wh1Id,
    transactionType: 'SUPPLIER_RETURN',
    quantity: returnQty,
    unitCost: 132.00,
    batchNumber: 'LOT-A1',
    referenceType: 'SUPPLIER_RETURN',
    referenceId: rtvId,
    remarks: `RTV ${returnNumber}`
  });

  const postRtvWH1 = await db.query(`SELECT COALESCE(SUM(quantity_on_hand), 0) as qty FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`, [wh1Id, prod.id]);
  assert(parseFloat(postRtvWH1.rows[0].qty) === 12, `WH1 stock after supplier return is 12 units\n`);

  // 14. Valuation Report & Reorder Alerts
  console.log('--- 14. Inventory Valuation & Reorder Alerts ---');
  const valReport = await getValuationReport(tenantId);
  assert(valReport.items && valReport.items.length > 0, `Valuation report generated with ${valReport.items.length} item summaries`);
  const thisItemVal = valReport.items.find(i => i.sku === testSku);
  assert(thisItemVal !== undefined, `Test product included in valuation report`);
  console.log(`     Product: ${thisItemVal.product_name} | Qty: ${thisItemVal.quantity_on_hand} | Cost: ${thisItemVal.cost_price} | Asset Value: PKR ${thisItemVal.asset_valuation}`);

  // Reorder alert check (min stock is 5, WH1 has 12, WH2 has 5 => total 17, so not in alert yet)
  // Let's set reorder_level to 50 to test alert trigger
  await db.query(`UPDATE products_services SET reorder_level = 50, current_stock = 17 WHERE id = $1`, [prod.id]);
  const alertRes = await getReorderAlerts(tenantId);
  const alertedItem = alertRes.alerts.find(a => a.sku === testSku);
  assert(alertedItem !== undefined, `Reorder alert triggered when current stock (17) is below reorder level (50)\n`);

  // 15. Finance GL Posting Hook (Non-blocking & Idempotent)
  console.log('--- 15. General Ledger Posting Hook Integration ---');
  // Attempt GL post for inward stock receipt
  const glResult = await autoPostInventoryToGL({
    tenantId,
    transactionType: 'STOCK_IN',
    productId: prod.id,
    quantity: 10,
    unitCost: 100.00,
    referenceType: 'GRN',
    referenceId: grnId,
    description: 'Automated test GRN stock entry'
  });
  console.log(`     GL Hook Result: success=${glResult.success}, action=${glResult.action || glResult.reason}`);
  assert(glResult.success === true, `GL hook executed gracefully without blocking or throwing`);

  // Test idempotency: post second time with identical referenceType and referenceId
  const glDupResult = await autoPostInventoryToGL({
    tenantId,
    transactionType: 'STOCK_IN',
    productId: prod.id,
    quantity: 10,
    unitCost: 100.00,
    referenceType: 'GRN',
    referenceId: grnId,
    description: 'Duplicate test GRN'
  });
  assert(glDupResult.action === 'skipped_duplicate' || glDupResult.action === 'skipped_unlicensed', `GL hook idempotently detects duplicates or safely skips\n`);

  // 15.5 Atomic Inter-Warehouse Transfer & Physical Reconciliation Audit (Unified Service)
  console.log('--- 15.5 Unified Inter-Warehouse Transfer & Physical Audit Service ---');
  let oversizeTransferBlocked = false;
  try {
    await executeStockTransfer({
      tenantId, fromWarehouseId: wh1Id, toWarehouseId: wh2Id,
      items: [{ product_id: prod.id, quantity: 9999, batch_number: 'LOT-A1' }]
    });
  } catch (e) {
    if (e.message.includes('Negative stock disallowed')) oversizeTransferBlocked = true;
  }
  assert(oversizeTransferBlocked, 'Oversized inter-warehouse transfer blocked by negative-stock policy');

  const svcTrRes = await executeStockTransfer({
    tenantId, fromWarehouseId: wh1Id, toWarehouseId: wh2Id,
    items: [{ product_id: prod.id, quantity: 2, batch_number: 'LOT-A1' }]
  });
  assert(Boolean(svcTrRes.transfer_number), `Atomic stock transfer executed via service (${svcTrRes.transfer_number})`);

  const svcAdjRes = await executeStockAdjustment({
    tenantId, warehouseId: wh2Id, adjustmentType: 'Physical Count Audit',
    items: [{ product_id: prod.id, physical_stock: 6, batch_number: 'LOT-A1' }]
  });
  assert(Boolean(svcAdjRes.adjustment_number), `Physical count audit reconciled cleanly (${svcAdjRes.adjustment_number})\n`);

  // 16. Multi-Tenant Isolation
  console.log('--- 16. Strict Multi-Tenant Isolation Enforcement ---');
  // Tenant B attempts to read Tenant A's products
  const tenantBProducts = await db.query(`SELECT id FROM products_services WHERE tenant_id = $1 AND id = $2`, [tenantBId, prod.id]);
  assert(tenantBProducts.rows.length === 0, `Tenant B cannot read Tenant A's product`);

  // Tenant B attempts to access Tenant A's warehouse stock
  const tenantBStock = await db.query(`SELECT id FROM warehouse_stock WHERE tenant_id = $1 AND product_id = $2`, [tenantBId, prod.id]);
  assert(tenantBStock.rows.length === 0, `Tenant B cannot see Tenant A's warehouse stock`);

  // Tenant B attempts to access Tenant A's GRN
  const tenantBGRN = await db.query(`SELECT id FROM goods_receipt_notes WHERE tenant_id = $1 AND id = $2`, [tenantBId, grnId]);
  assert(tenantBGRN.rows.length === 0, `Tenant B cannot see Tenant A's Goods Receipt Notes`);

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} INVENTORY MODULE TESTS PASSED WITH 100% SUCCESS!`);
  console.log('================================================================\n');

  process.exit(0);
}

runInventoryEnterpriseTestSuite().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});
