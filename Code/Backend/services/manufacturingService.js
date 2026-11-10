/**
 * ============================================================================
 * MASHRUE ENTERPRISE MANUFACTURING ENGINE (services/manufacturingService.js)
 * ============================================================================
 * Handles:
 *  - Manufacturing Settings, Work Centres & Product Classifications
 *  - UOM Conversion Validation & Resolution
 *  - Multi-Level BOM Management, Versioning & Circular Dependency Detection
 *  - MRP Explosion, Material Availability & Concurrent Safe Reservations
 *  - Production Work Order Lifecycle (Draft -> Approve -> Release -> Execute -> Close/Cancel)
 *  - Material Issue, Additional Consumption, Return of Unused Material, Scrap & Rework
 *  - Partial & Final Finished Goods Receipt with Weighted Average Costing
 *  - Non-blocking, Idempotent Finance COGM Integration (works standalone without Finance/Tender)
 *  - Comprehensive Manufacturing Reports
 * ============================================================================
 */

const db = require('../config/db');
const inventoryValuationService = require('./inventoryValuationService');
const financeService = require('./financeService');

function round2(n) {
  const v = Number(n || 0);
  return isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}

function round4(n) {
  const v = Number(n || 0);
  return isFinite(v) ? Math.round((v + Number.EPSILON) * 10000) / 10000 : 0;
}

class ManufacturingService {
  /**
   * Fetch or initialize tenant manufacturing settings
   */
  async getSettings(client, tenantId) {
    const qClient = client || db;
    let res = await qClient.query(`SELECT * FROM mfg_settings WHERE tenant_id = $1`, [tenantId]);
    if (res.rows.length === 0) {
      res = await qClient.query(
        `INSERT INTO mfg_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO UPDATE SET updated_at = NOW() RETURNING *`,
        [tenantId]
      );
    }
    return res.rows[0];
  }

  /**
   * Generate sequential document numbers (WO / BOM)
   */
  async getNextNumber(client, tenantId, type = 'wo') {
    const qClient = client || db;
    await this.getSettings(qClient, tenantId);
    const colPrefix = type === 'bom' ? 'bom_prefix' : 'wo_prefix';
    const colSeq = type === 'bom' ? 'bom_next_seq' : 'wo_next_seq';
    const defPrefix = type === 'bom' ? 'BOM' : 'WO';

    const r = await qClient.query(
      `UPDATE mfg_settings SET ${colSeq} = COALESCE(${colSeq}, 1001) + 1 WHERE tenant_id = $1
       RETURNING ${colPrefix} as prefix, (${colSeq} - 1) as seq`,
      [tenantId]
    );
    const prefix = r.rows[0]?.prefix || defPrefix;
    const seq = r.rows[0]?.seq || Math.floor(1000 + Math.random() * 9000);
    return `${prefix}-${new Date().getFullYear()}-${seq}`;
  }

  /**
   * Resolve UOM conversion factor from `fromUnit` to `toUnit` (stock unit)
   */
  async resolveConversionFactor(client, tenantId, fromUnit, toUnit) {
    const u1 = String(fromUnit || '').trim().toUpperCase();
    const u2 = String(toUnit || '').trim().toUpperCase();
    if (!u1 || !u2 || u1 === u2) return 1.0;

    const qClient = client || db;
    const r = await qClient.query(
      `SELECT conversion_factor FROM mfg_uom_conversions
       WHERE (tenant_id = $1 OR tenant_id IS NULL)
         AND UPPER(from_unit) = $2 AND UPPER(to_unit) = $3
       ORDER BY tenant_id NULLS LAST LIMIT 1`,
      [tenantId, u1, u2]
    );
    if (r.rows.length > 0) {
      return parseFloat(r.rows[0].conversion_factor);
    }
    throw new Error(`Invalid or unsupported unit conversion from "${u1}" to "${u2}". Configure a UOM conversion rule first.`);
  }

  /**
   * Validate BOM for Circular Dependencies (DFS Cycle Detection across Multi-Level BOMs)
   */
  async assertNoCircularBom(client, tenantId, finishedProductId, components = [], currentBomId = null) {
    const qClient = client || db;
    if (!finishedProductId) throw new Error('Finished product is required.');

    // Direct self-reference check
    for (const c of components) {
      if (String(c.raw_material_product_id) === String(finishedProductId)) {
        throw new Error('Circular BOM Dependency: Finished product cannot contain itself as a raw material component.');
      }
    }

    // Recursive traversal of sub-assembly child BOMs
    const visited = new Set([String(finishedProductId)]);
    const queue = components.map(c => ({ productId: String(c.raw_material_product_id), childBomId: c.child_bom_id || null }));

    while (queue.length > 0) {
      const node = queue.shift();
      if (!node.productId) continue;

      let childBomRes;
      if (node.childBomId) {
        childBomRes = await qClient.query(
          `SELECT id, finished_product_id FROM mfg_boms WHERE id = $1 AND tenant_id = $2`,
          [node.childBomId, tenantId]
        );
      } else {
        childBomRes = await qClient.query(
          `SELECT id, finished_product_id FROM mfg_boms
           WHERE tenant_id = $1 AND finished_product_id = $2 AND status = 'Active' AND is_archived = FALSE
           ORDER BY is_default DESC, bom_version DESC LIMIT 1`,
          [tenantId, node.productId]
        );
      }

      if (childBomRes.rows.length > 0) {
        const subBom = childBomRes.rows[0];
        if (currentBomId && String(subBom.id) === String(currentBomId)) {
          throw new Error('Circular BOM Dependency: Sub-assembly BOM loops back to the parent BOM.');
        }

        const subItems = await qClient.query(
          `SELECT raw_material_product_id, child_bom_id FROM mfg_bom_items WHERE bom_id = $1`,
          [subBom.id]
        );
        for (const si of subItems.rows) {
          const cid = String(si.raw_material_product_id);
          if (cid === String(finishedProductId) || visited.has(cid)) {
            throw new Error(`Circular BOM Dependency detected: Component chain loops back to product ID ${finishedProductId}.`);
          }
          queue.push({ productId: cid, childBomId: si.child_bom_id });
        }
      }
    }
  }

  /**
   * Create or Version a Multi-Level BOM with UOM validation & Cost Estimate
   */
  async createBom(client, tenantId, {
    bom_code = null,
    bom_name = null,
    finished_product_id,
    output_quantity = 1,
    expected_yield_pct = 100,
    labor_cost_estimate = 0,
    overhead_cost_estimate = 0,
    components = [],
    status = 'Active',
    parent_bom_id = null,
    bom_version = 1,
    is_default = true,
    notes = '',
    userId = null
  }) {
    const qClient = client || db;
    if (!finished_product_id) throw new Error('Finished Good product is required.');
    if (!Array.isArray(components) || components.length === 0) throw new Error('At least one component material is required.');

    // Validate circular dependency
    await this.assertNoCircularBom(qClient, tenantId, finished_product_id, components);

    const outQty = Math.max(0.0001, parseFloat(output_quantity || 1));
    const yieldPct = Math.min(100, Math.max(1, parseFloat(expected_yield_pct || 100)));
    const labor = round4(labor_cost_estimate || 0);
    const overhead = round4(overhead_cost_estimate || 0);

    // Resolve products & validate UOM conversions
    let totalMatCost = 0;
    const processedItems = [];

    for (const c of components) {
      if (!c.raw_material_product_id) continue;
      const pRes = await qClient.query(
        `SELECT id, name, sku, unit, cost_price FROM products_services WHERE id = $1 AND tenant_id = $2`,
        [c.raw_material_product_id, tenantId]
      );
      if (pRes.rows.length === 0) throw new Error(`Component product not found: ${c.raw_material_product_id}`);
      const prod = pRes.rows[0];

      const stockUnit = (prod.unit || 'PCS').toUpperCase();
      const compUnit = (c.unit_code || stockUnit).toUpperCase();
      const convFactor = await this.resolveConversionFactor(qClient, tenantId, compUnit, stockUnit);

      const reqQty = parseFloat(c.required_quantity || 0);
      if (reqQty <= 0) throw new Error(`Component "${prod.name}" required quantity must be greater than zero.`);
      const scrapPct = Math.max(0, parseFloat(c.scrap_allowance_pct || 0));

      // Effective stock units needed per BOM output batch
      const baseReqQty = reqQty * convFactor * (1 + scrapPct / 100);
      const uCost = c.unit_cost !== undefined ? parseFloat(c.unit_cost) : parseFloat(prod.cost_price || 0);
      const lineCost = round4(baseReqQty * uCost);
      totalMatCost = round4(totalMatCost + lineCost);

      processedItems.push({
        raw_material_product_id: prod.id,
        required_quantity: reqQty,
        unit_code: compUnit,
        conversion_factor: convFactor,
        scrap_allowance_pct: scrapPct,
        unit_cost: uCost,
        total_cost: lineCost,
        child_bom_id: c.child_bom_id || null,
        notes: c.notes || ''
      });
    }

    const effectiveOutQty = outQty * (yieldPct / 100);
    const totalBatchCost = round4(totalMatCost + labor + overhead);
    const unitCostEstimate = effectiveOutQty > 0 ? round4(totalBatchCost / effectiveOutQty) : totalBatchCost;
    const code = bom_code || await this.getNextNumber(qClient, tenantId, 'bom');

    // If marking default & Active, clear previous defaults for this finished product
    if (is_default && status === 'Active') {
      await qClient.query(
        `UPDATE mfg_boms SET is_default = FALSE WHERE tenant_id = $1 AND finished_product_id = $2`,
        [tenantId, finished_product_id]
      );
    }

    const bomRes = await qClient.query(
      `INSERT INTO mfg_boms (
        tenant_id, bom_code, bom_name, finished_product_id, bom_version, parent_bom_id,
        output_quantity, expected_yield_pct, labor_cost_estimate, overhead_cost_estimate,
        material_cost_estimate, total_estimated_unit_cost, status, is_default, is_active, notes,
        approved_by, approved_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [
        tenantId, code, bom_name || code, finished_product_id, bom_version, parent_bom_id,
        outQty, yieldPct, labor, overhead, totalMatCost, unitCostEstimate, status,
        Boolean(is_default), status === 'Active', notes,
        status === 'Active' ? userId : null, status === 'Active' ? new Date() : null
      ]
    );
    const bom = bomRes.rows[0];

    for (const pi of processedItems) {
      await qClient.query(
        `INSERT INTO mfg_bom_items (
          bom_id, raw_material_product_id, required_quantity, unit_code, conversion_factor,
          scrap_allowance_pct, unit_cost, total_cost, child_bom_id, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [bom.id, pi.raw_material_product_id, pi.required_quantity, pi.unit_code, pi.conversion_factor, pi.scrap_allowance_pct, pi.unit_cost, pi.total_cost, pi.child_bom_id, pi.notes]
      );
    }

    return { bom, items: processedItems };
  }

  /**
   * Create New BOM Version from an Existing BOM
   */
  async createBomVersion(client, tenantId, sourceBomId, overrides = {}, userId = null) {
    const qClient = client || db;
    const srcRes = await qClient.query(`SELECT * FROM mfg_boms WHERE id = $1 AND tenant_id = $2`, [sourceBomId, tenantId]);
    if (srcRes.rows.length === 0) throw new Error('Source BOM not found.');
    const src = srcRes.rows[0];

    const srcItemsRes = await qClient.query(`SELECT * FROM mfg_bom_items WHERE bom_id = $1`, [src.id]);
    const verRes = await qClient.query(
      `SELECT COALESCE(MAX(bom_version), 1) + 1 as next_ver FROM mfg_boms WHERE tenant_id = $1 AND finished_product_id = $2`,
      [tenantId, src.finished_product_id]
    );
    const nextVer = parseInt(verRes.rows[0].next_ver || 2, 10);
    const baseCode = src.bom_code.replace(/-V\d+$/i, '');

    return this.createBom(qClient, tenantId, {
      bom_code: overrides.bom_code || `${baseCode}-V${nextVer}`,
      bom_name: overrides.bom_name || `${src.bom_name} (v${nextVer})`,
      finished_product_id: src.finished_product_id,
      output_quantity: overrides.output_quantity ?? src.output_quantity,
      expected_yield_pct: overrides.expected_yield_pct ?? src.expected_yield_pct,
      labor_cost_estimate: overrides.labor_cost_estimate ?? src.labor_cost_estimate,
      overhead_cost_estimate: overrides.overhead_cost_estimate ?? src.overhead_cost_estimate,
      components: overrides.components || srcItemsRes.rows,
      status: overrides.status || 'Active',
      parent_bom_id: src.id,
      bom_version: nextVer,
      is_default: overrides.is_default !== undefined ? overrides.is_default : true,
      notes: overrides.notes || `Version ${nextVer} cloned from ${src.bom_code}`,
      userId
    });
  }

  /**
   * Multi-Level BOM Explosion & Shortage Checker
   */
  async explodeBomRequirements(client, tenantId, bomId, targetQty = 1, warehouseId = null, depth = 0) {
    if (depth > 8) throw new Error('Maximum BOM nesting depth exceeded.');
    const qClient = client || db;

    const bomRes = await qClient.query(`SELECT * FROM mfg_boms WHERE id = $1 AND tenant_id = $2`, [bomId, tenantId]);
    if (bomRes.rows.length === 0) throw new Error('BOM not found.');
    const bom = bomRes.rows[0];

    const outQty = Math.max(0.0001, parseFloat(bom.output_quantity || 1));
    const yieldPct = Math.max(1, parseFloat(bom.expected_yield_pct || 100));
    const scaleFactor = (targetQty / outQty) * (100 / yieldPct);

    const itemsRes = await qClient.query(
      `SELECT bi.*, p.name as item_name, p.sku, p.unit as stock_unit, p.cost_price, p.is_sub_assembly,
              COALESCE((
                SELECT SUM(GREATEST(0, ws.quantity_on_hand - COALESCE(ws.quantity_reserved, 0)))
                FROM warehouse_stock ws
                WHERE ws.product_id = p.id AND ws.tenant_id = $2
                  ${warehouseId ? 'AND ws.warehouse_id = $3' : ''}
              ), COALESCE(p.current_stock, 0)) as available_stock
       FROM mfg_bom_items bi
       JOIN products_services p ON bi.raw_material_product_id = p.id
       WHERE bi.bom_id = $1`,
      warehouseId ? [bom.id, tenantId, warehouseId] : [bom.id, tenantId]
    );

    const leafMap = new Map();

    for (const itm of itemsRes.rows) {
      const baseReq = parseFloat(itm.required_quantity || 0);
      const conv = parseFloat(itm.conversion_factor || 1);
      const scrap = parseFloat(itm.scrap_allowance_pct || 0);
      const requiredStockUnits = round4(baseReq * conv * (1 + scrap / 100) * scaleFactor);

      // Check if this component is a sub-assembly with a child BOM
      let subBomId = itm.child_bom_id;
      if (!subBomId && itm.is_sub_assembly) {
        const subCheck = await qClient.query(
          `SELECT id FROM mfg_boms WHERE tenant_id = $1 AND finished_product_id = $2 AND status = 'Active' AND is_archived = FALSE ORDER BY is_default DESC, bom_version DESC LIMIT 1`,
          [tenantId, itm.raw_material_product_id]
        );
        if (subCheck.rows.length > 0) subBomId = subCheck.rows[0].id;
      }

      if (subBomId) {
        const subExploded = await this.explodeBomRequirements(qClient, tenantId, subBomId, requiredStockUnits, warehouseId, depth + 1);
        for (const subComp of subExploded.components) {
          this._mergeRequirement(leafMap, subComp);
        }
      } else {
        const avail = parseFloat(itm.available_stock || 0);
        this._mergeRequirement(leafMap, {
          product_id: itm.raw_material_product_id,
          sku: itm.sku,
          item_name: itm.item_name,
          stock_unit: itm.stock_unit || 'PCS',
          unit_code: itm.unit_code || itm.stock_unit || 'PCS',
          conversion_factor: conv,
          required_quantity: requiredStockUnits,
          available_stock: avail,
          unit_cost: parseFloat(itm.unit_cost || itm.cost_price || 0)
        });
      }
    }

    const components = Array.from(leafMap.values()).map(c => {
      const shortage = Math.max(0, round4(c.required_quantity - c.available_stock));
      return {
        ...c,
        shortage_qty: shortage,
        status: shortage > 0 ? 'Shortage' : 'Sufficient',
        estimated_cost: round2(c.required_quantity * c.unit_cost)
      };
    });

    return {
      bom_id: bom.id,
      bom_code: bom.bom_code,
      bom_version: bom.bom_version,
      target_quantity: targetQty,
      can_start_production: components.every(c => c.shortage_qty === 0),
      components
    };
  }

  _mergeRequirement(map, comp) {
    const key = String(comp.product_id);
    if (map.has(key)) {
      const cur = map.get(key);
      cur.required_quantity = round4(cur.required_quantity + comp.required_quantity);
    } else {
      map.set(key, { ...comp });
    }
  }

  /**
   * Create Production Work Order with Material Plan Snapshot
   */
  async createWorkOrder(client, tenantId, payload) {
    const qClient = client || db;
    const settings = await this.getSettings(qClient, tenantId);
    const {
      bom_id, target_quantity, raw_materials_warehouse_id, finished_goods_warehouse_id,
      work_centre_id, responsible_user_id, planned_hours = 0, start_date, due_date,
      status = null, notes = '', opportunity_id = null, business_profile_id = null
    } = payload;

    const bomRes = await qClient.query(`SELECT * FROM mfg_boms WHERE id = $1 AND tenant_id = $2`, [bom_id, tenantId]);
    if (bomRes.rows.length === 0) throw new Error('BOM not found.');
    const bom = bomRes.rows[0];
    if (bom.status === 'Archived' || bom.is_archived) throw new Error('Cannot create Work Order from an Archived BOM.');

    const qty = Math.max(0.0001, parseFloat(target_quantity || 1));
    const rawWh = raw_materials_warehouse_id || settings.default_raw_warehouse_id || null;
    const fgWh = finished_goods_warehouse_id || settings.default_fg_warehouse_id || rawWh || null;

    // Explode BOM requirements
    const exploded = await this.explodeBomRequirements(qClient, tenantId, bom.id, qty, rawWh);
    const plannedMatCost = round4(exploded.components.reduce((s, c) => s + c.estimated_cost, 0));

    let wcLab = parseFloat(bom.labor_cost_estimate || 0) * (qty / Math.max(1, parseFloat(bom.output_quantity || 1)));
    let wcOvh = parseFloat(bom.overhead_cost_estimate || 0) * (qty / Math.max(1, parseFloat(bom.output_quantity || 1)));

    if (work_centre_id && planned_hours > 0) {
      const wcRes = await qClient.query(`SELECT hourly_labor_rate, hourly_overhead_rate FROM mfg_work_centres WHERE id = $1 AND tenant_id = $2`, [work_centre_id, tenantId]);
      if (wcRes.rows.length > 0) {
        wcLab = round4(parseFloat(wcRes.rows[0].hourly_labor_rate || 0) * parseFloat(planned_hours));
        wcOvh = round4(parseFloat(wcRes.rows[0].hourly_overhead_rate || 0) * parseFloat(planned_hours));
      }
    }

    const totalPlannedCost = round4(plannedMatCost + wcLab + wcOvh);
    const initialStatus = status || (settings.require_wo_approval ? 'Draft' : 'Approved');
    const orderNo = payload.order_number || await this.getNextNumber(qClient, tenantId, 'wo');

    const woRes = await qClient.query(
      `INSERT INTO mfg_work_orders (
        tenant_id, business_profile_id, order_number, bom_id, target_product_id, target_quantity,
        raw_materials_warehouse_id, finished_goods_warehouse_id, work_centre_id, responsible_user_id,
        planned_hours, start_date, due_date, status, opportunity_id,
        planned_material_cost, planned_labor_cost, planned_overhead_cost,
        actual_material_cost, actual_labor_cost, actual_overhead_cost, total_production_cost, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,0,$17,$18,$19,$20) RETURNING *`,
      [
        tenantId, business_profile_id, orderNo, bom.id, bom.finished_product_id, qty,
        rawWh, fgWh, work_centre_id || null, responsible_user_id || null, parseFloat(planned_hours || 0),
        start_date || new Date().toISOString().slice(0, 10),
        due_date || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        initialStatus, opportunity_id,
        plannedMatCost, round4(wcLab), round4(wcOvh), totalPlannedCost, notes
      ]
    );
    const wo = woRes.rows[0];

    for (const c of exploded.components) {
      await qClient.query(
        `INSERT INTO mfg_work_order_materials (
          tenant_id, work_order_id, product_id, unit_code, conversion_factor,
          planned_quantity, unit_cost, planned_cost
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId, wo.id, c.product_id, c.stock_unit, 1.0, c.required_quantity, c.unit_cost, c.estimated_cost]
      );
    }

    return { work_order: wo, planned_materials: exploded.components };
  }

  /**
   * Release Work Order & Perform Concurrent-Safe Material Reservations
   */
  async releaseWorkOrder(client, tenantId, woId, userId = null) {
    const qClient = client || db;
    const settings = await this.getSettings(qClient, tenantId);
    const woRes = await qClient.query(`SELECT * FROM mfg_work_orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [woId, tenantId]);
    if (woRes.rows.length === 0) throw new Error('Work Order not found.');
    const wo = woRes.rows[0];

    if (['Cancelled', 'Closed', 'Completed'].includes(wo.status)) {
      throw new Error(`Cannot release Work Order in status "${wo.status}".`);
    }

    const matsRes = await qClient.query(`SELECT * FROM mfg_work_order_materials WHERE work_order_id = $1`, [wo.id]);
    const rawWh = wo.raw_materials_warehouse_id || settings.default_raw_warehouse_id;

    if (settings.auto_reserve_on_release !== false && rawWh) {
      for (const m of matsRes.rows) {
        const needed = round4(parseFloat(m.planned_quantity) - parseFloat(m.reserved_quantity || 0) - parseFloat(m.issued_quantity || 0));
        if (needed <= 0) continue;

        // Lock warehouse_stock rows FOR UPDATE to prevent concurrent double-reservation race conditions!
        const stockRows = await qClient.query(
          `SELECT id, batch_number, quantity_on_hand, COALESCE(quantity_reserved, 0) as quantity_reserved
           FROM warehouse_stock
           WHERE tenant_id = $1 AND warehouse_id = $2 AND product_id = $3 AND (quantity_on_hand - COALESCE(quantity_reserved, 0)) > 0
           ORDER BY expiry_date ASC NULLS LAST, created_at ASC
           FOR UPDATE`,
          [tenantId, rawWh, m.product_id]
        );

        const totalAvailable = stockRows.rows.reduce((s, r) => s + (parseFloat(r.quantity_on_hand) - parseFloat(r.quantity_reserved)), 0);
        if (totalAvailable < needed && settings.block_if_insufficient_material !== false) {
          const pInfo = await qClient.query(`SELECT name, sku FROM products_services WHERE id = $1`, [m.product_id]);
          throw new Error(`Insufficient available material stock for "${pInfo.rows[0]?.name || m.product_id}" [${pInfo.rows[0]?.sku || ''}]. Required: ${needed}, Available (after reservations): ${round4(totalAvailable)}.`);
        }

        let remainingToReserve = Math.min(needed, totalAvailable);
        let reservedThisLine = 0;

        for (const lot of stockRows.rows) {
          if (remainingToReserve <= 0) break;
          const lotAvail = parseFloat(lot.quantity_on_hand) - parseFloat(lot.quantity_reserved);
          const take = Math.min(remainingToReserve, lotAvail);
          if (take <= 0) continue;

          await qClient.query(
            `UPDATE warehouse_stock SET quantity_reserved = COALESCE(quantity_reserved, 0) + $1, updated_at = NOW() WHERE id = $2`,
            [take, lot.id]
          );
          await qClient.query(
            `INSERT INTO stock_reservations (tenant_id, product_id, warehouse_id, batch_number, reserved_quantity, status, reserved_by)
             VALUES ($1,$2,$3,$4,$5,'Active',$6)`,
            [tenantId, m.product_id, rawWh, lot.batch_number, take, userId]
          );

          reservedThisLine = round4(reservedThisLine + take);
          remainingToReserve = round4(remainingToReserve - take);
        }

        await qClient.query(
          `UPDATE mfg_work_order_materials SET reserved_quantity = COALESCE(reserved_quantity, 0) + $1, updated_at = NOW() WHERE id = $2`,
          [reservedThisLine, m.id]
        );
      }
    }

    const upd = await qClient.query(
      `UPDATE mfg_work_orders SET status = 'Released', released_at = COALESCE(released_at, NOW()), updated_at = NOW() WHERE id = $1 RETURNING *`,
      [wo.id]
    );
    return upd.rows[0];
  }

  /**
   * Release any unconsumed reservations for a Work Order (used on Cancellation/Closure)
   */
  async releaseOrderReservations(client, tenantId, woId) {
    const qClient = client || db;
    const woRes = await qClient.query(`SELECT raw_materials_warehouse_id FROM mfg_work_orders WHERE id = $1 AND tenant_id = $2`, [woId, tenantId]);
    if (woRes.rows.length === 0) return;
    const rawWh = woRes.rows[0].raw_materials_warehouse_id;
    const mats = await qClient.query(`SELECT * FROM mfg_work_order_materials WHERE work_order_id = $1 AND reserved_quantity > 0`, [woId]);

    for (const m of mats.rows) {
      const resQty = parseFloat(m.reserved_quantity || 0);
      if (rawWh && resQty > 0) {
        // Deduct from warehouse_stock.quantity_reserved safely
        const lots = await qClient.query(
          `SELECT id, quantity_reserved FROM warehouse_stock WHERE tenant_id = $1 AND warehouse_id = $2 AND product_id = $3 AND quantity_reserved > 0 FOR UPDATE`,
          [tenantId, rawWh, m.product_id]
        );
        let rem = resQty;
        for (const lot of lots.rows) {
          if (rem <= 0) break;
          const rel = Math.min(rem, parseFloat(lot.quantity_reserved));
          await qClient.query(`UPDATE warehouse_stock SET quantity_reserved = GREATEST(0, quantity_reserved - $1) WHERE id = $2`, [rel, lot.id]);
          rem = round4(rem - rel);
        }
      }
      await qClient.query(`UPDATE mfg_work_order_materials SET reserved_quantity = 0, updated_at = NOW() WHERE id = $1`, [m.id]);
    }
  }

  /**
   * Issue Raw Material to Production (Consumes Stock & Releases Reservation)
   */
  async issueMaterial(client, tenantId, woId, {
    productId, warehouseId = null, quantity, unitCode = null, movementType = 'ISSUE',
    batchNumber = 'STANDARD', idempotencyKey = null, remarks = '', userId = null
  }) {
    const qClient = client || db;

    // Duplicate protection
    if (idempotencyKey) {
      const dup = await qClient.query(
        `SELECT * FROM mfg_material_movements WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`,
        [tenantId, idempotencyKey]
      );
      if (dup.rows.length > 0) return { duplicate: true, movement: dup.rows[0] };
    }

    const woRes = await qClient.query(`SELECT * FROM mfg_work_orders WHERE id = $1 AND tenant_id = $2`, [woId, tenantId]);
    if (woRes.rows.length === 0) throw new Error('Work Order not found.');
    const wo = woRes.rows[0];
    if (['Cancelled', 'Closed'].includes(wo.status)) throw new Error(`Cannot issue materials to a "${wo.status}" Work Order.`);

    const targetWh = warehouseId || wo.raw_materials_warehouse_id;
    if (!targetWh) throw new Error('Raw Materials Warehouse is required for material issue.');

    const prodRes = await qClient.query(`SELECT id, name, unit, cost_price FROM products_services WHERE id = $1 AND tenant_id = $2`, [productId, tenantId]);
    if (prodRes.rows.length === 0) throw new Error('Material SKU not found.');
    const prod = prodRes.rows[0];

    const conv = await this.resolveConversionFactor(qClient, tenantId, unitCode || prod.unit, prod.unit);
    const baseQty = round4(parseFloat(quantity || 0) * conv);
    if (baseQty <= 0) throw new Error('Issue quantity must be greater than zero.');

    const uCost = parseFloat(prod.cost_price || 0);
    const totalCost = round4(baseQty * uCost);

    // Deduct stock via unified Inventory Engine (respects negative-stock policy + FIFO lot resolution)
    const invTx = await inventoryValuationService.recordStockMovement({
      tenantId,
      productId,
      warehouseId: targetWh,
      transactionType: 'STOCK_OUT',
      quantity: baseQty,
      unitCost: uCost,
      batchNumber,
      referenceType: 'WORK_ORDER_ISSUE',
      referenceId: wo.id,
      referenceNumber: wo.order_number,
      remarks: remarks || `Issued to Work Order ${wo.order_number}`,
      userId,
      client: qClient
    });

    // Release matching reservation if any
    const matLine = await qClient.query(
      `SELECT * FROM mfg_work_order_materials WHERE work_order_id = $1 AND product_id = $2 LIMIT 1`,
      [wo.id, productId]
    );
    if (matLine.rows.length > 0) {
      const m = matLine.rows[0];
      const relQty = Math.min(baseQty, parseFloat(m.reserved_quantity || 0));
      if (relQty > 0) {
        await qClient.query(
          `UPDATE warehouse_stock SET quantity_reserved = GREATEST(0, quantity_reserved - $1) WHERE tenant_id = $2 AND warehouse_id = $3 AND product_id = $4 AND quantity_reserved > 0`,
          [relQty, tenantId, targetWh, productId]
        );
      }
      await qClient.query(
        `UPDATE mfg_work_order_materials
         SET issued_quantity = COALESCE(issued_quantity, 0) + $1,
             reserved_quantity = GREATEST(0, COALESCE(reserved_quantity, 0) - $2),
             actual_cost = COALESCE(actual_cost, 0) + $3,
             updated_at = NOW()
         WHERE id = $4`,
        [baseQty, relQty, totalCost, m.id]
      );
    } else {
      // Additional unbudgeted material consumption line
      await qClient.query(
        `INSERT INTO mfg_work_order_materials (tenant_id, work_order_id, product_id, unit_code, planned_quantity, issued_quantity, unit_cost, planned_cost, actual_cost)
         VALUES ($1,$2,$3,$4,0,$5,$6,0,$7)`,
        [tenantId, wo.id, productId, prod.unit || 'PCS', baseQty, uCost, totalCost]
      );
    }

    const movRes = await qClient.query(
      `INSERT INTO mfg_material_movements (
        tenant_id, work_order_id, product_id, warehouse_id, movement_type, quantity, unit_code,
        base_quantity, unit_cost, total_cost, batch_number, inventory_transaction_id, idempotency_key, remarks, created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [tenantId, wo.id, productId, targetWh, movementType, parseFloat(quantity), unitCode || prod.unit || 'PCS', baseQty, uCost, totalCost, batchNumber, invTx.id, idempotencyKey, remarks, userId]
    );

    await qClient.query(
      `UPDATE mfg_work_orders
       SET actual_material_cost = COALESCE(actual_material_cost, 0) + $1,
           total_production_cost = COALESCE(actual_material_cost, 0) + $1 + COALESCE(actual_labor_cost, 0) + COALESCE(actual_overhead_cost, 0) + COALESCE(scrap_cost, 0),
           status = CASE WHEN status IN ('Approved', 'Released') THEN 'In Production' ELSE status END,
           updated_at = NOW()
       WHERE id = $2`,
      [totalCost, wo.id]
    );

    return { duplicate: false, movement: movRes.rows[0] };
  }

  /**
   * Return Unused Material back to Warehouse
   */
  async returnMaterial(client, tenantId, woId, {
    productId, warehouseId = null, quantity, unitCode = null, idempotencyKey = null, remarks = '', userId = null
  }) {
    const qClient = client || db;
    if (idempotencyKey) {
      const dup = await qClient.query(`SELECT * FROM mfg_material_movements WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`, [tenantId, idempotencyKey]);
      if (dup.rows.length > 0) return { duplicate: true, movement: dup.rows[0] };
    }

    const woRes = await qClient.query(`SELECT * FROM mfg_work_orders WHERE id = $1 AND tenant_id = $2`, [woId, tenantId]);
    if (woRes.rows.length === 0) throw new Error('Work Order not found.');
    const wo = woRes.rows[0];
    const targetWh = warehouseId || wo.raw_materials_warehouse_id;
    if (!targetWh) throw new Error('Target warehouse is required for material return.');

    const prodRes = await qClient.query(`SELECT id, name, unit, cost_price FROM products_services WHERE id = $1 AND tenant_id = $2`, [productId, tenantId]);
    const prod = prodRes.rows[0];
    const conv = await this.resolveConversionFactor(qClient, tenantId, unitCode || prod.unit, prod.unit);
    const baseQty = round4(parseFloat(quantity || 0) * conv);
    if (baseQty <= 0) throw new Error('Return quantity must be positive.');

    const matLine = await qClient.query(`SELECT * FROM mfg_work_order_materials WHERE work_order_id = $1 AND product_id = $2 LIMIT 1`, [wo.id, productId]);
    if (matLine.rows.length > 0) {
      const netIssued = round4(parseFloat(matLine.rows[0].issued_quantity || 0) - parseFloat(matLine.rows[0].returned_quantity || 0));
      if (baseQty > netIssued + 0.0001) {
        throw new Error(`Cannot return ${baseQty} ${prod.unit}; only ${netIssued} net units were issued to this Work Order.`);
      }
    }

    const uCost = parseFloat(matLine.rows[0]?.unit_cost || prod.cost_price || 0);
    const creditCost = round4(baseQty * uCost);

    const invTx = await inventoryValuationService.recordStockMovement({
      tenantId,
      productId,
      warehouseId: targetWh,
      transactionType: 'STOCK_IN',
      quantity: baseQty,
      unitCost: uCost,
      referenceType: 'WORK_ORDER_RETURN',
      referenceId: wo.id,
      referenceNumber: wo.order_number,
      remarks: remarks || `Unused material returned from Work Order ${wo.order_number}`,
      userId,
      client: qClient
    });

    if (matLine.rows.length > 0) {
      await qClient.query(
        `UPDATE mfg_work_order_materials
         SET returned_quantity = COALESCE(returned_quantity, 0) + $1,
             actual_cost = GREATEST(0, COALESCE(actual_cost, 0) - $2),
             updated_at = NOW()
         WHERE id = $3`,
        [baseQty, creditCost, matLine.rows[0].id]
      );
    }

    const movRes = await qClient.query(
      `INSERT INTO mfg_material_movements (
        tenant_id, work_order_id, product_id, warehouse_id, movement_type, quantity, unit_code,
        base_quantity, unit_cost, total_cost, inventory_transaction_id, idempotency_key, remarks, created_by
      ) VALUES ($1,$2,$3,$4,'RETURN',$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [tenantId, wo.id, productId, targetWh, parseFloat(quantity), unitCode || prod.unit || 'PCS', baseQty, uCost, creditCost, invTx.id, idempotencyKey, remarks, userId]
    );

    await qClient.query(
      `UPDATE mfg_work_orders
       SET actual_material_cost = GREATEST(0, COALESCE(actual_material_cost, 0) - $1),
           total_production_cost = GREATEST(0, COALESCE(actual_material_cost, 0) - $1 + COALESCE(actual_labor_cost, 0) + COALESCE(actual_overhead_cost, 0) + COALESCE(scrap_cost, 0)),
           updated_at = NOW()
       WHERE id = $2`,
      [creditCost, wo.id]
    );

    return { duplicate: false, movement: movRes.rows[0] };
  }

  /**
   * Log Production Scrap / Wastage / Rework
   */
  async recordScrap(client, tenantId, woId, { productId, warehouseId = null, quantity, scrapReason = 'Process wastage', isReworkable = false, userId = null }) {
    const qClient = client || db;
    const woRes = await qClient.query(`SELECT * FROM mfg_work_orders WHERE id = $1 AND tenant_id = $2`, [woId, tenantId]);
    if (woRes.rows.length === 0) throw new Error('Work Order not found.');
    const wo = woRes.rows[0];
    const qty = round4(quantity || 0);
    if (qty <= 0) throw new Error('Scrap quantity must be positive.');

    const prodRes = await qClient.query(`SELECT cost_price FROM products_services WHERE id = $1`, [productId || wo.target_product_id]);
    const uCost = parseFloat(prodRes.rows[0]?.cost_price || 0);
    const costImpact = round4(qty * uCost);

    const sRes = await qClient.query(
      `INSERT INTO mfg_scrap_logs (tenant_id, work_order_id, product_id, warehouse_id, quantity, unit_cost, cost_impact, scrap_reason, is_reworkable, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [tenantId, wo.id, productId || wo.target_product_id, warehouseId || wo.raw_materials_warehouse_id, qty, uCost, costImpact, scrapReason, Boolean(isReworkable), userId]
    );

    await qClient.query(
      `UPDATE mfg_work_orders
       SET scrap_cost = COALESCE(scrap_cost, 0) + $1,
           rework_quantity = COALESCE(rework_quantity, 0) + $2,
           total_production_cost = COALESCE(actual_material_cost, 0) + COALESCE(actual_labor_cost, 0) + COALESCE(actual_overhead_cost, 0) + COALESCE(scrap_cost, 0) + $1,
           updated_at = NOW()
       WHERE id = $3`,
      [costImpact, isReworkable ? qty : 0, wo.id]
    );

    return sRes.rows[0];
  }

  /**
   * Partial or Full Finished-Goods Receipt & Optional Idempotent Finance Integration
   */
  async receiveFinishedGoods(client, tenantId, woId, {
    producedQty, rejectedQty = 0, reworkQty = 0, warehouseId = null,
    actualHours = 0, actualLaborCost = null, actualOverheadCost = null,
    isFinal = false, idempotencyKey = null, remarks = '', userId = null
  }) {
    const qClient = client || db;
    const settings = await this.getSettings(qClient, tenantId);

    const effKey = idempotencyKey || `FG_${woId}_${Date.now()}`;
    const dup = await qClient.query(
      `SELECT * FROM mfg_posting_events WHERE tenant_id = $1 AND event_type = 'FG_RECEIPT' AND idempotency_key = $2 LIMIT 1`,
      [tenantId, effKey]
    );
    if (dup.rows.length > 0) {
      return { duplicate: true, event: dup.rows[0] };
    }

    const woRes = await qClient.query(`SELECT * FROM mfg_work_orders WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [woId, tenantId]);
    if (woRes.rows.length === 0) throw new Error('Work Order not found.');
    const wo = woRes.rows[0];

    if (['Cancelled', 'Closed'].includes(wo.status)) {
      throw new Error(`Cannot receive finished goods on a "${wo.status}" Work Order.`);
    }

    const goodQty = round4(producedQty || 0);
    const rejQty = round4(rejectedQty || 0);
    const rewQty = round4(reworkQty || 0);
    if (goodQty <= 0 && rejQty <= 0) throw new Error('Produced or rejected quantity must be greater than zero.');

    const targetWh = warehouseId || wo.finished_goods_warehouse_id || settings.default_fg_warehouse_id;
    if (!targetWh) throw new Error('Finished Goods Warehouse is required.');

    // Auto-issue unissued BOM materials proportionally if user didn't pre-issue manually (backflush support)
    const matsRes = await qClient.query(`SELECT * FROM mfg_work_order_materials WHERE work_order_id = $1`, [wo.id]);
    const ratio = goodQty / Math.max(0.0001, parseFloat(wo.target_quantity || 1));
    let batchMatCost = 0;

    for (const m of matsRes.rows) {
      const targetForRun = round4(parseFloat(m.planned_quantity) * ratio);
      const netIssuedSoFar = round4(parseFloat(m.issued_quantity || 0) - parseFloat(m.returned_quantity || 0));
      // Only backflush difference if nothing was manually issued yet
      if (netIssuedSoFar === 0 && targetForRun > 0 && wo.raw_materials_warehouse_id) {
        const resIss = await this.issueMaterial(qClient, tenantId, wo.id, {
          productId: m.product_id,
          warehouseId: wo.raw_materials_warehouse_id,
          quantity: targetForRun,
          movementType: 'AUTO_BACKFLUSH',
          idempotencyKey: `BF_${effKey}_${m.product_id}`,
          remarks: `Auto-backflush for ${wo.order_number} FG receipt`,
          userId
        });
        batchMatCost = round4(batchMatCost + parseFloat(resIss.movement?.total_cost || 0));
      }
    }

    // Refresh WO to get latest actual material cost
    const refreshedWo = (await qClient.query(`SELECT * FROM mfg_work_orders WHERE id = $1`, [wo.id])).rows[0];
    const totalMatCost = parseFloat(refreshedWo.actual_material_cost || 0);
    const labCost = actualLaborCost !== null ? round4(actualLaborCost) : parseFloat(refreshedWo.actual_labor_cost || 0);
    const ovhCost = actualOverheadCost !== null ? round4(actualOverheadCost) : parseFloat(refreshedWo.actual_overhead_cost || 0);
    const scrapCost = parseFloat(refreshedWo.scrap_cost || 0);
    const totalCogm = round4(totalMatCost + labCost + ovhCost + scrapCost);

    const newTotalProduced = round4(parseFloat(wo.produced_quantity || 0) + goodQty);
    const newTotalRejected = round4(parseFloat(wo.rejected_quantity || 0) + rejQty);
    const newTotalRework = round4(parseFloat(wo.rework_quantity || 0) + rewQty);
    const newTotalHours = round2(parseFloat(wo.actual_hours || 0) + parseFloat(actualHours || 0));

    const unitCostFg = newTotalProduced > 0 ? round4(totalCogm / newTotalProduced) : 0;

    let invTx = null;
    if (goodQty > 0) {
      invTx = await inventoryValuationService.recordStockMovement({
        tenantId,
        productId: wo.target_product_id,
        warehouseId: targetWh,
        transactionType: 'STOCK_IN',
        quantity: goodQty,
        unitCost: unitCostFg,
        batchNumber: wo.order_number,
        referenceType: 'PRODUCTION_RECEIPT',
        referenceId: wo.id,
        referenceNumber: wo.order_number,
        remarks: remarks || `FG output from ${wo.order_number}`,
        userId,
        client: qClient
      });

      await qClient.query(
        `INSERT INTO mfg_material_movements (
          tenant_id, work_order_id, product_id, warehouse_id, movement_type, quantity, unit_code,
          base_quantity, unit_cost, total_cost, batch_number, inventory_transaction_id, idempotency_key, remarks, created_by
        ) VALUES ($1,$2,$3,$4,'FG_RECEIPT',$5,'PCS',$5,$6,$7,$8,$9,$10,$11,$12)`,
        [tenantId, wo.id, wo.target_product_id, targetWh, goodQty, unitCostFg, round4(goodQty * unitCostFg), wo.order_number, invTx.id, `FG_MOV_${effKey}`, remarks, userId]
      );
    }

    const isCompleteNow = isFinal || newTotalProduced >= parseFloat(wo.target_quantity || 0);
    const nextStatus = isCompleteNow ? 'Completed' : 'Partially Completed';

    const completedDate = isCompleteNow ? new Date().toISOString().slice(0, 10) : (wo.completed_date || null);
    const updWo = await qClient.query(
      `UPDATE mfg_work_orders
       SET produced_quantity = $1, rejected_quantity = $2, rework_quantity = $3,
           actual_hours = $4, actual_labor_cost = $5, actual_overhead_cost = $6,
           total_production_cost = $7, status = $8, completed_date = $9,
           updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [newTotalProduced, newTotalRejected, newTotalRework, newTotalHours, labCost, ovhCost, totalCogm, nextStatus, completedDate, wo.id]
    );

    // Optional Idempotent Finance GL Posting (Graceful skip if Finance is absent/disabled!)
    let financeResult = { status: 'skipped_disabled', message: 'Finance posting disabled or module unavailable.' };
    const receiptCostValue = round2(goodQty * unitCostFg);

    if (settings.enable_finance_posting !== false && receiptCostValue > 0) {
      try {
        const coa = await financeService.ensureCoaMap(qClient, tenantId);
        const ev = await financeService.postAccountingEvent(qClient, {
          tenantId,
          sourceModule: 'manufacturing',
          eventType: 'MFG_COMPLETION',
          sourceId: effKey,
          sourceNumber: wo.order_number,
          date: new Date().toISOString().slice(0, 10),
          narration: `Production FG Receipt ${wo.order_number} (Qty: ${goodQty})`,
          lines: [
            { account_id: coa['1300'], debit: receiptCostValue, credit: 0, line_description: `Finished Goods Capitalized - ${wo.order_number}` },
            { account_id: coa['5001'], debit: 0, credit: receiptCostValue, line_description: `Manufacturing Cost Absorbed - ${wo.order_number}` }
          ],
          userId
        });

        if (ev.action === 'posted') {
          financeResult = { status: 'posted', journal_id: ev.journal?.id };
          await qClient.query(`UPDATE mfg_work_orders SET gl_posted = TRUE, journal_entry_id = $1 WHERE id = $2`, [ev.journal?.id || null, wo.id]);
        } else {
          financeResult = { status: ev.action || 'skipped', message: 'Finance module not licensed or manufacturing integration disabled.' };
        }
      } catch (finErr) {
        financeResult = { status: 'skipped_error', message: finErr.message };
      }
    }

    const postEv = await qClient.query(
      `INSERT INTO mfg_posting_events (tenant_id, work_order_id, event_type, idempotency_key, status, finance_journal_id, notes)
       VALUES ($1,$2,'FG_RECEIPT',$3,'Processed',$4,$5) RETURNING *`,
      [tenantId, wo.id, effKey, financeResult.journal_id || null, financeResult.message || 'FG received']
    );

    return {
      duplicate: false,
      work_order: updWo.rows[0],
      produced_now: goodQty,
      unit_cost: unitCostFg,
      finance: financeResult,
      event: postEv.rows[0]
    };
  }

  /**
   * Manufacturing Reports Suite
   */
  async getReports(tenantId) {
    const [statusRes, varianceRes, scrapRes, outputRes] = await Promise.all([
      db.query(
        `SELECT status, COUNT(*) as order_count, COALESCE(SUM(target_quantity),0) as total_planned_qty, COALESCE(SUM(produced_quantity),0) as total_produced_qty, COALESCE(SUM(total_production_cost),0) as total_cost
         FROM mfg_work_orders WHERE tenant_id = $1 GROUP BY status`,
        [tenantId]
      ),
      db.query(
        `SELECT wo.order_number, p.name as product_name, wo.target_quantity, wo.produced_quantity,
                wo.planned_material_cost, wo.actual_material_cost,
                (wo.actual_material_cost - wo.planned_material_cost) as material_variance,
                wo.planned_labor_cost, wo.actual_labor_cost,
                wo.planned_overhead_cost, wo.actual_overhead_cost,
                wo.scrap_cost, wo.total_production_cost, wo.status
         FROM mfg_work_orders wo
         LEFT JOIN products_services p ON wo.target_product_id = p.id
         WHERE wo.tenant_id = $1 ORDER BY wo.created_at DESC LIMIT 100`,
        [tenantId]
      ),
      db.query(
        `SELECT sl.*, wo.order_number, p.name as product_name, p.sku
         FROM mfg_scrap_logs sl
         JOIN mfg_work_orders wo ON sl.work_order_id = wo.id
         LEFT JOIN products_services p ON sl.product_id = p.id
         WHERE sl.tenant_id = $1 ORDER BY sl.recorded_at DESC LIMIT 100`,
        [tenantId]
      ),
      db.query(
        `SELECT mm.*, wo.order_number, p.name as product_name, w.warehouse_name
         FROM mfg_material_movements mm
         JOIN mfg_work_orders wo ON mm.work_order_id = wo.id
         LEFT JOIN products_services p ON mm.product_id = p.id
         LEFT JOIN warehouses w ON mm.warehouse_id = w.id
         WHERE mm.tenant_id = $1 AND mm.movement_type = 'FG_RECEIPT'
         ORDER BY mm.created_at DESC LIMIT 100`,
        [tenantId]
      )
    ]);

    return {
      production_status_summary: statusRes.rows,
      planned_vs_actual_costing: varianceRes.rows,
      scrap_and_wastage_log: scrapRes.rows,
      finished_goods_output_history: outputRes.rows
    };
  }
}

module.exports = new ManufacturingService();
