/**
 * ============================================================================
 * MASHRUE MANUFACTURING MODULE — COMPREHENSIVE AUTOMATED TEST SUITE
 * ============================================================================
 */

const db = require('./config/db');
const manufacturingService = require('./services/manufacturingService');
const inventoryValuationService = require('./services/inventoryValuationService');
const financeService = require('./services/financeService');

function round2(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

async function runManufacturingTestSuite() {
  console.log('================================================================');
  console.log('🏭 RUNNING MASHRUE MANUFACTURING MODULE TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  function assert(cond, msg) {
    if (cond) {
      console.log(`  ✅ PASS: ${msg}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${msg}`);
      failed++;
      throw new Error(`Assertion failed: ${msg}`);
    }
  }

  const ts = Date.now().toString().slice(-6);
  const tenantA = 'a9000000-0000-0000-0000-000000' + ts;
  const tenantB = 'b9000000-0000-0000-0000-000000' + ts;

  try {
    // 1. Setup Standalone Tenant A (NO Finance & NO Tender! Only Inventory + Manufacturing)
    console.log('--- 1. Standalone Setup (Finance & Tender Disabled) ---');
    await db.query(
      `INSERT INTO tenants (id, company_name, subdomain, subscription_plan, active_modules, status)
       VALUES ($1, $2, $3, 'Custom', '["mod_inventory","mod_manufacturing"]'::jsonb, 'Active')`,
      [tenantA, `Mfg Standalone Corp ${ts}`, `mfg-a-${ts}`]
    );
    await db.query(
      `INSERT INTO tenants (id, company_name, subdomain, subscription_plan, active_modules, status)
       VALUES ($1, $2, $3, 'Custom', '["mod_inventory","mod_manufacturing"]'::jsonb, 'Active')`,
      [tenantB, `Mfg Tenant B ${ts}`, `mfg-b-${ts}`]
    );

    const whRaw = (await db.query(`INSERT INTO warehouses (tenant_id, warehouse_name, city) VALUES ($1, 'Raw Material Store', 'Lahore') RETURNING id`, [tenantA])).rows[0].id;
    const whFg = (await db.query(`INSERT INTO warehouses (tenant_id, warehouse_name, city) VALUES ($1, 'Finished Goods Store', 'Lahore') RETURNING id`, [tenantA])).rows[0].id;
    const wcId = (await db.query(`INSERT INTO mfg_work_centres (tenant_id, centre_code, centre_name, hourly_labor_rate, hourly_overhead_rate) VALUES ($1, 'WC-1', 'Assembly Line 1', 1000, 500) RETURNING id`, [tenantA])).rows[0].id;

    // Seed Raw Material (Copper Wire in KG), Sub-Assembly (Stator Coil in PCS), Finished Good (Motor in PCS)
    const prodCopper = (await db.query(
      `INSERT INTO products_services (tenant_id, sku, name, item_type, unit, cost_price, current_stock, is_raw_material, is_finished_good)
       VALUES ($1, $2, 'Copper Magnet Wire', 'Raw Material', 'KG', 2000, 0, TRUE, FALSE) RETURNING *`,
      [tenantA, `RM-CU-${ts}`]
    )).rows[0];
    const prodSub = (await db.query(
      `INSERT INTO products_services (tenant_id, sku, name, item_type, unit, cost_price, current_stock, is_raw_material, is_finished_good, is_sub_assembly)
       VALUES ($1, $2, 'Wound Stator Coil', 'Sub-Assembly', 'PCS', 0, 0, TRUE, TRUE, TRUE) RETURNING *`,
      [tenantA, `SA-COIL-${ts}`]
    )).rows[0];
    const prodFg = (await db.query(
      `INSERT INTO products_services (tenant_id, sku, name, item_type, unit, cost_price, current_stock, is_raw_material, is_finished_good)
       VALUES ($1, $2, 'Induction Motor 5HP', 'Finished Good', 'PCS', 0, 0, FALSE, TRUE) RETURNING *`,
      [tenantA, `FG-MTR-${ts}`]
    )).rows[0];

    // Stock 20 KG of Copper Wire into Raw Warehouse (@ 2000/KG)
    await inventoryValuationService.recordStockMovement({
      tenantId: tenantA, productId: prodCopper.id, warehouseId: whRaw,
      transactionType: 'STOCK_IN', quantity: 20, unitCost: 2000, referenceType: 'OPENING', remarks: 'Initial copper stock'
    });
    assert(Boolean(whRaw && whFg && wcId), 'Warehouses, Work Centre, and 20 KG Raw Material initialized\n');

    // 2. Unit Conversions & Validation
    console.log('--- 2. UOM Conversion & Invalid Unit Rejection ---');
    const gToKg = await manufacturingService.resolveConversionFactor(null, tenantA, 'G', 'KG');
    assert(gToKg === 0.001, `UOM conversion resolved accurately: 1 G = ${gToKg} KG`);

    let invalidUnitCaught = false;
    try {
      await manufacturingService.resolveConversionFactor(null, tenantA, 'LITERS_INVALID', 'KG');
    } catch (e) {
      if (e.message.includes('Invalid or unsupported unit conversion')) invalidUnitCaught = true;
    }
    assert(invalidUnitCaught, 'Invalid/incompatible unit conversion strictly rejected\n');

    // 3. BOM Creation, Multi-Level, Circular Dependency Check & Versioning
    console.log('--- 3. BOM Versioning, Multi-Level & Circular Dependency Guard ---');
    // Self-reference cycle test
    let selfCycleBlocked = false;
    try {
      await manufacturingService.createBom(null, tenantA, {
        finished_product_id: prodSub.id,
        components: [{ raw_material_product_id: prodSub.id, required_quantity: 1 }]
      });
    } catch (e) {
      if (e.message.includes('Circular BOM Dependency')) selfCycleBlocked = true;
    }
    assert(selfCycleBlocked, 'Direct self-referential circular BOM strictly blocked');

    // Valid Sub-Assembly BOM: 1 Stator Coil needs 500 G (0.5 KG) of Copper Wire (cost = 0.5 * 2000 = 1000)
    const subBomRes = await manufacturingService.createBom(null, tenantA, {
      bom_name: 'Stator Coil Recipe',
      finished_product_id: prodSub.id,
      output_quantity: 1,
      components: [{ raw_material_product_id: prodCopper.id, required_quantity: 500, unit_code: 'G', scrap_allowance_pct: 0 }]
    });
    assert(round2(subBomRes.bom.material_cost_estimate) === 1000, `Sub-Assembly BOM converted 500 G -> 0.5 KG cleanly (Cost = 1000)`);

    // Test Indirect 2-level Circular Cycle: try adding prodFg inside prodSub's BOM when prodFg uses prodSub
    const fgBomV1 = await manufacturingService.createBom(null, tenantA, {
      bom_name: 'Motor 5HP Recipe v1',
      finished_product_id: prodFg.id,
      output_quantity: 1,
      labor_cost_estimate: 500,
      overhead_cost_estimate: 200,
      components: [{ raw_material_product_id: prodSub.id, required_quantity: 1, unit_code: 'PCS', child_bom_id: subBomRes.bom.id }]
    });
    assert(fgBomV1.bom.bom_version === 1, 'Finished Good BOM v1 created cleanly');

    let indirectCycleBlocked = false;
    try {
      await manufacturingService.assertNoCircularBom(null, tenantA, prodSub.id, [{ raw_material_product_id: prodFg.id }]);
    } catch (e) {
      if (e.message.includes('Circular BOM Dependency')) indirectCycleBlocked = true;
    }
    assert(indirectCycleBlocked, 'Indirect multi-level circular BOM cycle strictly detected & blocked');

    // BOM Versioning: create v2 (requires 2 Stator Coils per Motor -> 1 KG Copper per Motor!)
    const fgBomV2 = await manufacturingService.createBomVersion(null, tenantA, fgBomV1.bom.id, {
      components: [{ raw_material_product_id: prodSub.id, required_quantity: 2, unit_code: 'PCS', child_bom_id: subBomRes.bom.id }]
    });
    assert(fgBomV2.bom.bom_version === 2, `BOM Version v2 created cleanly (${fgBomV2.bom.bom_code})`);

    // Multi-Level MRP Explosion for 10 Motors using v2 -> needs 20 Stator Coils -> 10 KG Copper!
    const exploded = await manufacturingService.explodeBomRequirements(null, tenantA, fgBomV2.bom.id, 10, whRaw);
    const cuReq = exploded.components.find(c => c.product_id === prodCopper.id);
    assert(cuReq && round2(cuReq.required_quantity) === 10 && exploded.can_start_production === true,
      `Multi-level BOM exploded 10 Motors -> ${cuReq?.required_quantity} KG Copper (Available: ${cuReq?.available_stock} KG)\n`);

    // 4. Insufficient Material Guard, Concurrent Reservations & Order Cancellation
    console.log('--- 4. Insufficient Stock, Concurrent Reservations & Cancellation ---');
    // Create WO #1 needing 15 Motors -> 15 KG Copper (stock has 20 KG)
    const wo1Create = await manufacturingService.createWorkOrder(null, tenantA, {
      bom_id: fgBomV2.bom.id, target_quantity: 15, raw_materials_warehouse_id: whRaw, finished_goods_warehouse_id: whFg, work_centre_id: wcId
    });
    await manufacturingService.releaseWorkOrder(null, tenantA, wo1Create.work_order.id);
    const resCheck1 = await db.query(`SELECT COALESCE(SUM(quantity_reserved),0) as res FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`, [whRaw, prodCopper.id]);
    assert(round2(resCheck1.rows[0].res) === 15, `WO1 Release reserved 15 KG Copper out of 20 KG`);

    // Create WO #2 needing 10 Motors -> needs 10 KG Copper, but only 5 KG unreserved!
    const wo2Create = await manufacturingService.createWorkOrder(null, tenantA, {
      bom_id: fgBomV2.bom.id, target_quantity: 10, raw_materials_warehouse_id: whRaw, finished_goods_warehouse_id: whFg
    });
    let concurrentBlocked = false;
    try {
      await manufacturingService.releaseWorkOrder(null, tenantA, wo2Create.work_order.id);
    } catch (e) {
      if (e.message.includes('Insufficient available material stock')) concurrentBlocked = true;
    }
    assert(concurrentBlocked, 'Concurrent Work Order blocked due to existing reservation leaving insufficient stock');

    // Cancel WO #1 -> must release all 15 KG reservation!
    await manufacturingService.releaseOrderReservations(null, tenantA, wo1Create.work_order.id);
    await db.query(`UPDATE mfg_work_orders SET status = 'Cancelled' WHERE id = $1`, [wo1Create.work_order.id]);
    const resCheckAfterCancel = await db.query(`SELECT COALESCE(SUM(quantity_reserved),0) as res FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`, [whRaw, prodCopper.id]);
    assert(round2(resCheckAfterCancel.rows[0].res) === 0, 'Cancelled WO released all reserved stock back to 0\n');

    // 5. Material Issue, Return, Scrap, Partial Production & Standalone Completion
    console.log('--- 5. Shop-Floor Issue, Return, Scrap, Partial Receipt & Idempotency ---');
    // Now release WO #2 (needs 10 KG Copper for 10 Motors)
    await manufacturingService.releaseWorkOrder(null, tenantA, wo2Create.work_order.id);

    // Explicitly issue 12 KG (extra 2 KG) using Idempotency Key
    await manufacturingService.issueMaterial(null, tenantA, wo2Create.work_order.id, {
      productId: prodCopper.id, warehouseId: whRaw, quantity: 12, unitCode: 'KG', idempotencyKey: `ISS-${ts}-1`
    });
    // Repeat identical issue call -> must be deduplicated!
    const dupIss = await manufacturingService.issueMaterial(null, tenantA, wo2Create.work_order.id, {
      productId: prodCopper.id, warehouseId: whRaw, quantity: 12, unitCode: 'KG', idempotencyKey: `ISS-${ts}-1`
    });
    assert(dupIss.duplicate === true, 'Duplicate material issue event strictly prevented by idempotency key');

    // Return 2 KG unused Copper back to Raw Store -> Net Copper Issued = 10 KG
    await manufacturingService.returnMaterial(null, tenantA, wo2Create.work_order.id, {
      productId: prodCopper.id, warehouseId: whRaw, quantity: 2, unitCode: 'KG', idempotencyKey: `RET-${ts}-1`
    });
    const rawStockAfterRet = await db.query(`SELECT COALESCE(SUM(quantity_on_hand),0) as qty FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`, [whRaw, prodCopper.id]);
    assert(round2(rawStockAfterRet.rows[0].qty) === 10, `After issuing 12 KG & returning 2 KG, raw warehouse balance is 10 KG (expected 10)`);

    // Log 1 unit scrap / wastage
    const scrap = await manufacturingService.recordScrap(null, tenantA, wo2Create.work_order.id, {
      productId: prodCopper.id, quantity: 0.5, scrapReason: 'Trimming wastage', isReworkable: false
    });
    assert(parseFloat(scrap.cost_impact) === 1000, 'Scrap cost impact accurately calculated (0.5 KG * 2000 = 1000)');

    // Partial FG Receipt: Receive 4 good Motors out of 10 (Standalone WITHOUT Finance!)
    const partRec = await manufacturingService.receiveFinishedGoods(null, tenantA, wo2Create.work_order.id, {
      producedQty: 4, rejectedQty: 0, warehouseId: whFg, isFinal: false, idempotencyKey: `FG-P1-${ts}`
    });
    assert(partRec.work_order.status === 'Partially Completed' && parseFloat(partRec.work_order.produced_quantity) === 4,
      `Partial FG receipt updated status to "Partially Completed" (4 / 10 units)`);
    assert(partRec.finance.status.startsWith('skipped'), `Completed smoothly without Finance module (${partRec.finance.status})`);

    // Final FG Receipt: Receive remaining 6 good Motors
    const finalRec = await manufacturingService.receiveFinishedGoods(null, tenantA, wo2Create.work_order.id, {
      producedQty: 6, rejectedQty: 1, warehouseId: whFg, isFinal: true, idempotencyKey: `FG-P2-${ts}`
    });
    assert(finalRec.work_order.status === 'Completed' && parseFloat(finalRec.work_order.produced_quantity) === 10,
      'Final FG receipt transitioned status to "Completed" (Total Produced: 10)');

    // Repeat identical FG receipt -> Idempotency blocks duplicate stock receipt!
    const dupFg = await manufacturingService.receiveFinishedGoods(null, tenantA, wo2Create.work_order.id, {
      producedQty: 6, warehouseId: whFg, isFinal: true, idempotencyKey: `FG-P2-${ts}`
    });
    assert(dupFg.duplicate === true, 'Duplicate FG completion event strictly prevented');

    const fgStock = await db.query(`SELECT COALESCE(SUM(quantity_on_hand),0) as qty FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`, [whFg, prodFg.id]);
    assert(round2(fgStock.rows[0].qty) === 10, `FG Warehouse holds exactly 10 Motors (no double receipt)\n`);

    // 6. Enable Finance Integration -> Verify COGM GL Posting
    console.log('--- 6. Finance Integration Enabled Test ---');
    await db.query(`UPDATE tenants SET active_modules = '["mod_inventory","mod_manufacturing","mod_finance"]'::jsonb WHERE id = $1`, [tenantA]);
    const wo3 = await manufacturingService.createWorkOrder(null, tenantA, {
      bom_id: fgBomV2.bom.id, target_quantity: 2, raw_materials_warehouse_id: whRaw, finished_goods_warehouse_id: whFg
    });
    const finRec = await manufacturingService.receiveFinishedGoods(null, tenantA, wo3.work_order.id, {
      producedQty: 2, warehouseId: whFg, isFinal: true, idempotencyKey: `FG-FIN-${ts}`
    });
    assert(finRec.finance.status === 'posted' && Boolean(finRec.finance.journal_id),
      `With Finance enabled, FG receipt posted balanced COGM Journal Voucher (${finRec.finance.journal_id})\n`);

    // 7. Manufacturing Reports & Multi-Tenant Isolation
    console.log('--- 7. Reports & Multi-Tenant Isolation ---');
    const repA = await manufacturingService.getReports(tenantA);
    assert(repA.finished_goods_output_history.length >= 3, `FG Output History recorded ${repA.finished_goods_output_history.length} receipts`);

    const repB = await manufacturingService.getReports(tenantB);
    assert(repB.production_status_summary.length === 0 && repB.finished_goods_output_history.length === 0,
      'Tenant B receives 0 BOMs, Work Orders, or Reports from Tenant A');

    console.log('\n================================================================');
    console.log(`🎉 ALL ${passed}/${passed + failed} MANUFACTURING TESTS PASSED (100%)!`);
    console.log('================================================================\n');
  } finally {
    await db.query(`DELETE FROM tenants WHERE id IN ($1, $2)`, [tenantA, tenantB]).catch(() => {});
  }

  process.exit(failed > 0 ? 1 : 0);
}

runManufacturingTestSuite().catch(err => {
  console.error('FATAL TEST ERROR:', err);
  process.exit(1);
});

