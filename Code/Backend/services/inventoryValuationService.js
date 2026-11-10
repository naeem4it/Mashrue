/**
 * ============================================================================
 * MASHRUE INVENTORY VALUATION & STOCK ENGINE (inventoryValuationService.js)
 * ============================================================================
 * Handles:
 *  - Weighted Average Costing (AVCO) & FIFO batch tracking
 *  - Configurable negative-stock policy enforcement
 *  - Unified stock movements with complete audit trail
 *  - Asset valuation reporting & reorder alerts
 *  - Non-blocking, fault-tolerant GL auto-posting hook
 * ============================================================================
 */

const db = require('../config/db');
const { autoPostInventoryToGL } = require('../utils/glPoster');

class InventoryValuationService {
  constructor() {
    this.calculateWeightedAverageCost = this.calculateWeightedAverageCost.bind(this);
    this.checkNegativeStockPolicy = this.checkNegativeStockPolicy.bind(this);
    this.recordStockMovement = this.recordStockMovement.bind(this);
    this.getValuationReport = this.getValuationReport.bind(this);
    this.getReorderAlerts = this.getReorderAlerts.bind(this);
    this.executeStockTransfer = this.executeStockTransfer.bind(this);
    this.executeStockAdjustment = this.executeStockAdjustment.bind(this);
  }

  /**
   * Calculate new weighted average cost
   * @param {number} currentQty 
   * @param {number} currentAvgCost 
   * @param {number} incomingQty 
   * @param {number} incomingUnitCost 
   * @returns {number}
   */
  calculateWeightedAverageCost(currentQty, currentAvgCost, incomingQty, incomingUnitCost) {
    const curQ = Math.max(0, parseFloat(currentQty || 0));
    const curC = Math.max(0, parseFloat(currentAvgCost || 0));
    const incQ = Math.max(0, parseFloat(incomingQty || 0));
    const incC = Math.max(0, parseFloat(incomingUnitCost || 0));

    if (curQ + incQ <= 0) return incC || curC;
    if (curQ === 0) return incC;
    if (incQ === 0) return curC;

    const totalValue = (curQ * curC) + (incQ * incC);
    const totalQty = curQ + incQ;
    return Number((totalValue / totalQty).toFixed(4));
  }

  /**
   * Validate negative stock policy
   * Polymorphic signature:
   * (client, tenantId, productId, warehouseId, deductQty) OR (tenantId, productId, warehouseId, deductQty)
   */
  async checkNegativeStockPolicy(arg1, arg2, arg3, arg4, arg5) {
    let poolClient;
    let tenantId, productId, warehouseId, deductQty;

    if (arg1 && typeof arg1.query === 'function') {
      poolClient = arg1;
      tenantId = arg2;
      productId = arg3;
      warehouseId = arg4;
      deductQty = arg5;
    } else {
      poolClient = db;
      tenantId = arg1;
      productId = arg2;
      warehouseId = arg3;
      deductQty = arg4;
    }

    // 1. Fetch tenant setting
    const tenantSettingRes = await poolClient.query(
      `SELECT allow_negative_stock FROM tenant_inventory_settings WHERE tenant_id = $1`,
      [tenantId]
    );
    const tenantAllowNegative = tenantSettingRes.rows[0]?.allow_negative_stock === true;

    // 2. Fetch product setting
    const prodRes = await poolClient.query(
      `SELECT allow_negative_stock, current_stock, name, sku FROM products_services WHERE id = $1 AND tenant_id = $2`,
      [productId, tenantId]
    );
    if (prodRes.rows.length === 0) {
      throw new Error(`Product not found: ${productId}`);
    }
    const product = prodRes.rows[0];
    const productAllowNegative = product.allow_negative_stock === true;

    // If either product or tenant allows, negative stock is permitted
    if (tenantAllowNegative || productAllowNegative) {
      return { allowed: true };
    }

    // 3. Query warehouse stock
    const whStockRes = await poolClient.query(
      `SELECT COALESCE(SUM(quantity_on_hand), 0) as total_on_hand,
              COALESCE(SUM(quantity_reserved), 0) as total_reserved
       FROM warehouse_stock
       WHERE tenant_id = $1 AND product_id = $2 AND warehouse_id = $3`,
      [tenantId, productId, warehouseId]
    );

    const onHand = parseFloat(whStockRes.rows[0]?.total_on_hand || 0);
    const required = parseFloat(deductQty || 0);

    if (onHand - required < -0.0001) {
      throw new Error(`Negative stock disallowed for "${product.name}" [SKU: ${product.sku}]. Available on-hand in warehouse is ${onHand}, attempting to deduct ${required}.`);
    }

    return { allowed: true, onHand };
  }

  /**
   * Unified stock movement recording
   */
  async recordStockMovement({
    tenantId,
    productId,
    warehouseId,
    transactionType, // 'STOCK_IN', 'STOCK_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT_POS', 'ADJUSTMENT_NEG', 'SUPPLIER_RETURN', 'RESERVATION'
    movementType,
    quantity,
    unitCost = 0,
    batchNumber = 'STANDARD',
    expiryDate = null,
    manufacturingDate = null,
    storageLocation = null,
    referenceType = 'MANUAL',
    referenceId = null,
    referenceNumber = null,
    supplierId = null,
    customerId = null,
    deliveryChallanId = null,
    remarks = null,
    userId = null,
    client = null
  }) {
    let effectiveType = transactionType || movementType || 'STOCK_IN';
    if (effectiveType === 'IN') effectiveType = 'STOCK_IN';
    if (effectiveType === 'OUT') effectiveType = 'STOCK_OUT';
    if (effectiveType === 'ADJUSTMENT') effectiveType = parseFloat(quantity || 0) >= 0 ? 'ADJUSTMENT_POS' : 'ADJUSTMENT_NEG';

    const isOutward = ['STOCK_OUT', 'TRANSFER_OUT', 'ADJUSTMENT_NEG', 'SUPPLIER_RETURN'].includes(effectiveType);
    const isInward = ['STOCK_IN', 'TRANSFER_IN', 'ADJUSTMENT_POS'].includes(effectiveType);
    const qty = Math.abs(parseFloat(quantity || 0));
    const cost = parseFloat(unitCost || 0);
    let batch = (batchNumber || 'STANDARD').trim();

    const poolClient = client || db;

    // Check negative stock policy on outward movements
    if (isOutward) {
      await this.checkNegativeStockPolicy(poolClient, tenantId, productId, warehouseId, qty);

      // FIFO batch resolution if 'STANDARD' is not stocked
      if (batch === 'STANDARD') {
        const stdCheck = await poolClient.query(
          `SELECT quantity_on_hand FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2 AND batch_number = 'STANDARD'`,
          [warehouseId, productId]
        );
        if (!stdCheck.rows.length || parseFloat(stdCheck.rows[0].quantity_on_hand || 0) < qty) {
          const fifoRes = await poolClient.query(
            `SELECT batch_number FROM warehouse_stock 
             WHERE warehouse_id = $1 AND product_id = $2 AND quantity_on_hand > 0 
             ORDER BY expiry_date ASC NULLS LAST, created_at ASC LIMIT 1`,
            [warehouseId, productId]
          );
          if (fifoRes.rows.length > 0) {
            batch = fifoRes.rows[0].batch_number;
          }
        }
      }
    }

    // 1. Insert into inventory_transactions
    const txRes = await poolClient.query(
      `INSERT INTO inventory_transactions (
        tenant_id, product_id, warehouse_id, transaction_type, quantity, unit_cost,
        batch_number, expiry_date, manufacturing_date, storage_location,
        reference_type, reference_id, reference_number, supplier_id, customer_id,
        delivery_challan_id, remarks, created_by, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, NOW())
      RETURNING *`,
      [
        tenantId, productId, warehouseId, effectiveType, qty, cost,
        batch, expiryDate, manufacturingDate, storageLocation,
        referenceType, referenceId, referenceNumber, supplierId, customerId,
        deliveryChallanId, remarks, userId
      ]
    );
    const tx = txRes.rows[0];

    // 2. Upsert warehouse_stock
    const delta = isOutward ? -qty : (isInward ? qty : 0);

    if (delta !== 0) {
      await poolClient.query(
        `INSERT INTO warehouse_stock (
          tenant_id, warehouse_id, product_id, batch_number, quantity_on_hand,
          quantity_reserved, storage_location, manufacturing_date, expiry_date
        ) VALUES ($1, $2, $3, $4, GREATEST(0, $5), 0, $6, $7, $8)
        ON CONFLICT (warehouse_id, product_id, batch_number)
        DO UPDATE SET
          quantity_on_hand = warehouse_stock.quantity_on_hand + $5,
          storage_location = COALESCE($6, warehouse_stock.storage_location),
          manufacturing_date = COALESCE($7, warehouse_stock.manufacturing_date),
          expiry_date = COALESCE($8, warehouse_stock.expiry_date),
          updated_at = NOW()`,
        [tenantId, warehouseId, productId, batch, delta, storageLocation, manufacturingDate, expiryDate]
      );

      // 3. Update products_services (current_stock and weighted average cost if inward)
      const currentProdRes = await poolClient.query(
        `SELECT current_stock, cost_price, valuation_method FROM products_services WHERE id = $1 AND tenant_id = $2`,
        [productId, tenantId]
      );
      if (currentProdRes.rows.length > 0) {
        const prod = currentProdRes.rows[0];
        let newAvgCost = parseFloat(prod.cost_price || 0);

        if (isInward && cost > 0) {
          newAvgCost = this.calculateWeightedAverageCost(prod.current_stock, prod.cost_price, qty, cost);
        }

        await poolClient.query(
          `UPDATE products_services
           SET current_stock = current_stock + $1,
               cost_price = $2,
               updated_at = NOW()
           WHERE id = $3 AND tenant_id = $4`,
          [delta, newAvgCost, productId, tenantId]
        );
      }
    }

    // 4. Non-blocking idempotent GL auto-posting hook
    try {
      if (typeof autoPostInventoryToGL === 'function') {
        await autoPostInventoryToGL({
          tenantId,
          transactionType,
          referenceType,
          referenceId: referenceId || tx.id,
          referenceNumber,
          productId,
          warehouseId,
          quantity: qty,
          unitCost: cost,
          totalAmount: Number((qty * cost).toFixed(4)),
          date: new Date().toISOString().slice(0, 10),
          narration: remarks || `${transactionType} of ${qty} units (${referenceNumber || ''})`,
          userId
        });
      }
    } catch (glErr) {
      console.warn('[GL Auto-Post Inventory Note]: Non-blocking GL posting skipped:', glErr.message);
    }

    return tx;
  }

  /**
   * Generate comprehensive Inventory Valuation Report
   */
  async getValuationReport(tenantId, warehouseId = null, client = null) {
    const poolClient = client || db;
    let query = `
      SELECT p.id as product_id,
             p.sku,
             p.name as product_name,
             p.unit,
             p.cost_price,
             p.selling_price,
             p.reorder_level,
             p.min_stock_level,
             p.max_stock_level,
             p.valuation_method,
             c.category_name,
             w.id as warehouse_id,
             w.warehouse_name,
             ws.batch_number,
             ws.storage_location,
             ws.expiry_date,
             ws.quantity_on_hand,
             ws.quantity_reserved,
             (ws.quantity_on_hand - ws.quantity_reserved) as quantity_available,
             ROUND(ws.quantity_on_hand * p.cost_price, 2) as asset_valuation,
             ROUND(ws.quantity_on_hand * p.selling_price, 2) as retail_potential_value
      FROM warehouse_stock ws
      JOIN products_services p ON ws.product_id = p.id
      JOIN warehouses w ON ws.warehouse_id = w.id
      LEFT JOIN item_categories c ON p.category_id = c.id
      WHERE ws.tenant_id = $1 AND p.is_archived = FALSE
    `;
    const params = [tenantId];

    if (warehouseId && warehouseId !== 'all') {
      params.push(warehouseId);
      query += ` AND ws.warehouse_id = $${params.length}`;
    }

    query += ` ORDER BY p.name ASC, ws.batch_number ASC`;

    const res = await poolClient.query(query, params);
    const rows = res.rows || [];

    const totalOnHand = rows.reduce((acc, r) => acc + parseFloat(r.quantity_on_hand || 0), 0);
    const totalReserved = rows.reduce((acc, r) => acc + parseFloat(r.quantity_reserved || 0), 0);
    const totalAvailable = rows.reduce((acc, r) => acc + parseFloat(r.quantity_available || 0), 0);
    const totalValuation = rows.reduce((acc, r) => acc + parseFloat(r.asset_valuation || 0), 0);
    const totalRetail = rows.reduce((acc, r) => acc + parseFloat(r.retail_potential_value || 0), 0);

    return {
      success: true,
      summary: {
        total_items_tracked: rows.length,
        total_on_hand: totalOnHand,
        total_reserved: totalReserved,
        total_available: totalAvailable,
        total_asset_valuation: totalValuation,
        total_retail_potential: totalRetail
      },
      items: rows
    };
  }

  /**
   * Low-Stock & Reorder Alerts
   */
  async getReorderAlerts(tenantId, client = null) {
    const poolClient = client || db;
    const res = await poolClient.query(`
      SELECT p.id as product_id,
             p.sku,
             p.name,
             p.unit,
             p.cost_price,
             p.current_stock,
             p.reorder_level,
             p.min_stock_level,
             p.max_stock_level,
             s.id as supplier_id,
             s.supplier_name,
             c.category_name,
             GREATEST(0, (COALESCE(p.max_stock_level, 100) - p.current_stock)) as suggested_order_qty,
             CASE
               WHEN p.current_stock <= 0 THEN 'OUT_OF_STOCK'
               WHEN p.current_stock <= p.min_stock_level THEN 'CRITICAL'
               WHEN p.current_stock <= p.reorder_level THEN 'REORDER_NOW'
               ELSE 'NORMAL'
             END as stock_status
      FROM products_services p
      LEFT JOIN suppliers s ON p.default_supplier_id = s.id
      LEFT JOIN item_categories c ON p.category_id = c.id
      WHERE p.tenant_id = $1
        AND p.is_archived = FALSE
        AND p.current_stock <= COALESCE(p.reorder_level, 10)
      ORDER BY p.current_stock ASC
    `, [tenantId]);

    return {
      success: true,
      count: res.rows.length,
      alerts: res.rows
    };
  }

  /**
   * Atomic Inter-Warehouse Stock Transfer (Enforces Negative-Stock Policy & AVCO)
   */
  async executeStockTransfer({
    tenantId,
    fromWarehouseId,
    toWarehouseId,
    transferDate = null,
    transferNumber = null,
    driverName = '',
    vehicleNumber = '',
    notes = '',
    items = [],
    userId = null,
    client = null
  }) {
    if (!fromWarehouseId || !toWarehouseId || String(fromWarehouseId) === String(toWarehouseId)) {
      throw new Error('Distinct Source and Destination warehouses are required.');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('At least one product item is required for stock transfer.');
    }

    const poolClient = client || await db.pool.connect();
    const ownConn = !client;
    try {
      if (ownConn) await poolClient.query('BEGIN');

      const trNo = transferNumber || `TRF-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const tDate = transferDate || new Date().toISOString().slice(0, 10);

      const trRes = await poolClient.query(
        `INSERT INTO inventory_transfers (
          tenant_id, transfer_number, from_warehouse_id, to_warehouse_id,
          transfer_date, status, driver_name, vehicle_number, notes, created_by
        ) VALUES ($1,$2,$3,$4,$5,'Completed',$6,$7,$8,$9) RETURNING *`,
        [tenantId, trNo, fromWarehouseId, toWarehouseId, tDate, driverName || '', vehicleNumber || '', notes || '', userId]
      );
      const transfer = trRes.rows[0];

      for (const item of items) {
        const qty = parseFloat(item.quantity || 0);
        if (!item.product_id || qty <= 0) continue;

        const prodRes = await poolClient.query(
          `SELECT cost_price FROM products_services WHERE id = $1 AND tenant_id = $2`,
          [item.product_id, tenantId]
        );
        if (prodRes.rows.length === 0) throw new Error(`Product ${item.product_id} not found.`);
        const effectiveCost = parseFloat(item.unit_cost || 0) > 0
          ? parseFloat(item.unit_cost)
          : parseFloat(prodRes.rows[0].cost_price || 0);
        const batch = (item.batch_number || 'STANDARD').trim();

        await poolClient.query(
          `INSERT INTO inventory_transfer_items (transfer_id, product_id, quantity, unit_cost, batch_number)
           VALUES ($1,$2,$3,$4,$5)`,
          [transfer.id, item.product_id, qty, effectiveCost, batch]
        );

        await this.recordStockMovement({
          tenantId,
          productId: item.product_id,
          warehouseId: fromWarehouseId,
          transactionType: 'TRANSFER_OUT',
          quantity: qty,
          unitCost: effectiveCost,
          batchNumber: batch,
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer.id,
          referenceNumber: trNo,
          remarks: `Stock Transfer OUT (${trNo})`,
          userId,
          client: poolClient
        });

        await this.recordStockMovement({
          tenantId,
          productId: item.product_id,
          warehouseId: toWarehouseId,
          transactionType: 'TRANSFER_IN',
          quantity: qty,
          unitCost: effectiveCost,
          batchNumber: batch,
          referenceType: 'STOCK_TRANSFER',
          referenceId: transfer.id,
          referenceNumber: trNo,
          remarks: `Stock Transfer IN (${trNo})`,
          userId,
          client: poolClient
        });
      }

      if (ownConn) await poolClient.query('COMMIT');
      return transfer;
    } catch (err) {
      if (ownConn) await poolClient.query('ROLLBACK');
      throw err;
    } finally {
      if (ownConn) poolClient.release();
    }
  }

  /**
   * Physical Stock Count Reconciliation & Variance Adjustment
   */
  async executeStockAdjustment({
    tenantId,
    warehouseId,
    adjustmentDate = null,
    adjustmentNumber = null,
    adjustmentType = 'Physical Count Audit',
    remarks = '',
    items = [],
    userId = null,
    client = null
  }) {
    if (!warehouseId) throw new Error('Warehouse is required for physical stock reconciliation.');
    if (!Array.isArray(items) || items.length === 0) throw new Error('At least one item is required for reconciliation.');

    const poolClient = client || await db.pool.connect();
    const ownConn = !client;
    try {
      if (ownConn) await poolClient.query('BEGIN');

      const adjNo = adjustmentNumber || `ADJ-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const aDate = adjustmentDate || new Date().toISOString().slice(0, 10);

      let totalValueImpact = 0;
      const prepared = [];

      for (const itm of items) {
        if (!itm.product_id) continue;
        const batch = (itm.batch_number || 'STANDARD').trim();
        const phyQty = parseFloat(itm.physical_stock || 0);
        if (phyQty < 0) throw new Error('Physical stock count cannot be negative.');

        const wsRes = await poolClient.query(
          `SELECT COALESCE(SUM(quantity_on_hand), 0) as sys_qty
           FROM warehouse_stock
           WHERE tenant_id = $1 AND warehouse_id = $2 AND product_id = $3 AND batch_number = $4`,
          [tenantId, warehouseId, itm.product_id, batch]
        );
        const sysQty = itm.system_stock !== undefined && itm.use_explicit_system
          ? parseFloat(itm.system_stock)
          : parseFloat(wsRes.rows[0]?.sys_qty || 0);

        const prodRes = await poolClient.query(`SELECT cost_price FROM products_services WHERE id = $1 AND tenant_id = $2`, [itm.product_id, tenantId]);
        if (prodRes.rows.length === 0) throw new Error(`Product ${itm.product_id} not found.`);
        const uCost = parseFloat(itm.unit_cost || 0) > 0 ? parseFloat(itm.unit_cost) : parseFloat(prodRes.rows[0].cost_price || 0);
        const diffQty = phyQty - sysQty;
        totalValueImpact += diffQty * uCost;
        prepared.push({ product_id: itm.product_id, batch, sysQty, phyQty, diffQty, uCost });
      }

      const hdrRes = await poolClient.query(
        `INSERT INTO inventory_adjustments (
          tenant_id, warehouse_id, adjustment_number, adjustment_date,
          adjustment_type, total_value_impact, status, remarks, approved_by
        ) VALUES ($1,$2,$3,$4,$5,$6,'Posted',$7,$8) RETURNING *`,
        [tenantId, warehouseId, adjNo, aDate, adjustmentType, totalValueImpact, remarks || '', userId]
      );
      const adj = hdrRes.rows[0];

      for (const line of prepared) {
        await poolClient.query(
          `INSERT INTO inventory_adjustment_items (
            adjustment_id, product_id, system_stock, physical_stock, difference_qty, unit_cost, batch_number
          ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [adj.id, line.product_id, line.sysQty, line.phyQty, line.diffQty, line.uCost, line.batch]
        );

        if (line.diffQty !== 0) {
          await this.recordStockMovement({
            tenantId,
            productId: line.product_id,
            warehouseId,
            transactionType: line.diffQty > 0 ? 'ADJUSTMENT_POS' : 'ADJUSTMENT_NEG',
            quantity: Math.abs(line.diffQty),
            unitCost: line.uCost,
            batchNumber: line.batch,
            referenceType: 'STOCK_AUDIT',
            referenceId: adj.id,
            referenceNumber: adjNo,
            remarks: `Stock Audit Reconciliation (${adjustmentType}): System ${line.sysQty} -> Physical ${line.phyQty}`,
            userId,
            client: poolClient
          });
        }
      }

      if (ownConn) await poolClient.query('COMMIT');
      return adj;
    } catch (err) {
      if (ownConn) await poolClient.query('ROLLBACK');
      throw err;
    } finally {
      if (ownConn) poolClient.release();
    }
  }
}

const inventoryValuationService = new InventoryValuationService();
module.exports = inventoryValuationService;
