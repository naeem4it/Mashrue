/**
 * ============================================================================
 * MASHRUE MANUFACTURING MODULE — ENTERPRISE REST CONTROLLER
 * Mounted at: /api/manufacturing and /api/erp/mfg-suite
 * Module License: 'mod_manufacturing'
 * Operates 100% independently without Tender or Finance (integrates when enabled)
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireModuleLicense, requirePermission, resolveTenantId } = require('../middleware/rbac.middleware');
const manufacturingService = require('../services/manufacturingService');

const mfgAuth = [authenticate, requireModuleLicense('mod_manufacturing')];

// ============================================================================
// 1. DASHBOARD & STANDALONE STATUS
// ============================================================================
router.get('/dashboard', ...mfgAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const settings = await manufacturingService.getSettings(null, tid);

    // Check if Finance module is licensed for informational status
    const tRes = await db.query(`SELECT subscription_plan, active_modules FROM tenants WHERE id = $1`, [tid]);
    const plan = tRes.rows[0]?.subscription_plan || 'Advance';
    const mods = tRes.rows[0]?.active_modules || [];
    const financeAvailable = plan !== 'Custom' || (Array.isArray(mods) && (mods.includes('mod_finance') || mods.includes('mod_accounting')));

    const [bomCnt, woStats, recentWo, scrapRes] = await Promise.all([
      db.query(`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'Active' AND is_archived = FALSE) as active_count FROM mfg_boms WHERE tenant_id = $1`, [tid]),
      db.query(`SELECT status, COUNT(*) as cnt, COALESCE(SUM(total_production_cost), 0) as cogm, COALESCE(SUM(produced_quantity), 0) as produced FROM mfg_work_orders WHERE tenant_id = $1 GROUP BY status`, [tid]),
      db.query(
        `SELECT wo.*, p.name as product_name, p.sku, wc.centre_name
         FROM mfg_work_orders wo
         LEFT JOIN products_services p ON wo.target_product_id = p.id
         LEFT JOIN mfg_work_centres wc ON wo.work_centre_id = wc.id
         WHERE wo.tenant_id = $1 ORDER BY wo.created_at DESC LIMIT 10`,
        [tid]
      ),
      db.query(`SELECT COALESCE(SUM(cost_impact), 0) as total_scrap_cost FROM mfg_scrap_logs WHERE tenant_id = $1`, [tid])
    ]);

    let activeOrders = 0, completedOrders = 0, totalCogm = 0, totalUnitsProduced = 0;
    woStats.rows.forEach(r => {
      const c = parseInt(r.cnt || 0, 10);
      totalCogm += parseFloat(r.cogm || 0);
      totalUnitsProduced += parseFloat(r.produced || 0);
      if (['Approved', 'Released', 'In Production', 'Partially Completed', 'Paused'].includes(r.status)) activeOrders += c;
      if (['Completed', 'Closed'].includes(r.status)) completedOrders += c;
    });

    res.json({
      success: true,
      data: {
        settings,
        finance_posting_available: financeAvailable && settings.enable_finance_posting !== false,
        kpis: {
          active_boms: parseInt(bomCnt.rows[0]?.active_count || 0, 10),
          total_boms: parseInt(bomCnt.rows[0]?.total || 0, 10),
          active_work_orders: activeOrders,
          completed_work_orders: completedOrders,
          total_units_produced: totalUnitsProduced,
          total_cogm: totalCogm,
          total_scrap_cost: parseFloat(scrapRes.rows[0]?.total_scrap_cost || 0)
        },
        status_breakdown: woStats.rows,
        recent_work_orders: recentWo.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 2. CONFIGURATION, WORK CENTRES & UOM CONVERSIONS
// ============================================================================
router.get('/settings', ...mfgAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await manufacturingService.getSettings(null, tid);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/settings', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    await manufacturingService.getSettings(null, tid);
    const allowed = [
      'wo_prefix', 'bom_prefix', 'default_raw_warehouse_id', 'default_fg_warehouse_id',
      'default_scrap_allowance_pct', 'require_wo_approval', 'auto_reserve_on_release',
      'block_if_insufficient_material', 'enable_finance_posting'
    ];
    const sets = [];
    const params = [tid, req.user?.id || null];
    for (const k of allowed) {
      if (req.body[k] !== undefined) {
        params.push(req.body[k] === '' ? null : req.body[k]);
        sets.push(`${k} = $${params.length}`);
      }
    }
    if (sets.length === 0) return res.json({ success: true, data: await manufacturingService.getSettings(null, tid) });
    sets.push(`updated_by = $2`, `updated_at = NOW()`);
    const upd = await db.query(`UPDATE mfg_settings SET ${sets.join(', ')} WHERE tenant_id = $1 RETURNING *`, params);
    res.json({ success: true, data: upd.rows[0], message: 'Manufacturing settings updated.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/work-centres', ...mfgAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(`SELECT * FROM mfg_work_centres WHERE tenant_id = $1 ORDER BY centre_code ASC`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/work-centres', ...mfgAuth, requirePermission('manufacturing', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { centre_code, centre_name, location, hourly_labor_rate = 0, hourly_overhead_rate = 0, capacity_hours_per_day = 8 } = req.body;
    if (!centre_code || !centre_name) return res.status(400).json({ success: false, message: 'Work Centre Code and Name are required.' });
    const r = await db.query(
      `INSERT INTO mfg_work_centres (tenant_id, centre_code, centre_name, location, hourly_labor_rate, hourly_overhead_rate, capacity_hours_per_day)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (tenant_id, centre_code) DO UPDATE
       SET centre_name = EXCLUDED.centre_name, location = EXCLUDED.location, hourly_labor_rate = EXCLUDED.hourly_labor_rate, hourly_overhead_rate = EXCLUDED.hourly_overhead_rate
       RETURNING *`,
      [tid, centre_code.trim().toUpperCase(), centre_name.trim(), location || '', parseFloat(hourly_labor_rate), parseFloat(hourly_overhead_rate), parseFloat(capacity_hours_per_day)]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/uom-conversions', ...mfgAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(`SELECT * FROM mfg_uom_conversions WHERE tenant_id = $1 OR tenant_id IS NULL ORDER BY from_unit ASC`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/uom-conversions', ...mfgAuth, requirePermission('manufacturing', 'add'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { from_unit, to_unit, conversion_factor } = req.body;
    if (!from_unit || !to_unit || !conversion_factor) return res.status(400).json({ success: false, message: 'From unit, To unit, and factor are required.' });
    const r = await db.query(
      `INSERT INTO mfg_uom_conversions (tenant_id, from_unit, to_unit, conversion_factor, is_system)
       VALUES ($1,$2,$3,$4,FALSE) RETURNING *`,
      [tid, from_unit.trim().toUpperCase(), to_unit.trim().toUpperCase(), parseFloat(conversion_factor)]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.put('/products/:id/classification', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { is_raw_material, is_finished_good, is_sub_assembly, mfg_lead_time_days } = req.body;
    const r = await db.query(
      `UPDATE products_services
       SET is_raw_material = COALESCE($1, is_raw_material),
           is_finished_good = COALESCE($2, is_finished_good),
           is_sub_assembly = COALESCE($3, is_sub_assembly),
           mfg_lead_time_days = COALESCE($4, mfg_lead_time_days),
           updated_at = NOW()
       WHERE id = $5 AND tenant_id = $6 RETURNING *`,
      [is_raw_material, is_finished_good, is_sub_assembly, mfg_lead_time_days, req.params.id, tid]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 3. BILLS OF MATERIALS (BOMs, Versioning, Circular Checks, MRP Explosion)
// ============================================================================
router.get('/boms', ...mfgAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { status, include_archived } = req.query;
    const params = [tid];
    let where = `b.tenant_id = $1`;
    if (include_archived !== 'true') where += ` AND COALESCE(b.is_archived, FALSE) = FALSE`;
    if (status && status !== 'all') { params.push(status); where += ` AND b.status = $${params.length}`; }

    const result = await db.query(
      `SELECT b.*,
              p.name as finished_product_name, p.sku as finished_product_sku, p.unit as finished_product_unit,
              COALESCE((
                SELECT json_agg(json_build_object(
                  'id', bi.id,
                  'raw_material_product_id', bi.raw_material_product_id,
                  'raw_material_name', rp.name,
                  'raw_material_sku', rp.sku,
                  'stock_unit', rp.unit,
                  'unit_code', COALESCE(bi.unit_code, rp.unit),
                  'conversion_factor', COALESCE(bi.conversion_factor, 1),
                  'available_stock', rp.current_stock,
                  'required_quantity', bi.required_quantity,
                  'scrap_allowance_pct', bi.scrap_allowance_pct,
                  'unit_cost', bi.unit_cost,
                  'total_cost', bi.total_cost,
                  'child_bom_id', bi.child_bom_id
                ))
                FROM mfg_bom_items bi
                LEFT JOIN products_services rp ON bi.raw_material_product_id = rp.id
                WHERE bi.bom_id = b.id
              ), '[]'::json) as items
       FROM mfg_boms b
       LEFT JOIN products_services p ON b.finished_product_id = p.id
       WHERE ${where}
       ORDER BY b.created_at DESC`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/boms', ...mfgAuth, requirePermission('manufacturing', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const components = req.body.items || req.body.components || [];
    const created = await manufacturingService.createBom(client, tid, {
      ...req.body,
      components,
      userId: req.user?.id || null
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: created.bom, items: created.items, message: `BOM ${created.bom.bom_code} created.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/boms/:id/new-version', ...mfgAuth, requirePermission('manufacturing', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const created = await manufacturingService.createBomVersion(client, tid, req.params.id, req.body, req.user?.id || null);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: created.bom, message: `BOM Version v${created.bom.bom_version} (${created.bom.bom_code}) created.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/boms/:id/status', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { status } = req.body;
    if (!['Draft', 'Active', 'Archived'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid BOM status.' });
    const upd = await db.query(
      `UPDATE mfg_boms
       SET status = $1, is_active = ($1 = 'Active'), is_archived = ($1 = 'Archived'), updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 RETURNING *`,
      [status, req.params.id, tid]
    );
    res.json({ success: true, data: upd.rows[0], message: `BOM marked as ${status}.` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/boms/:id/shortage-check', ...mfgAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const qty = parseFloat(req.query.qty || 1);
    const whId = req.query.warehouse_id || null;
    const data = await manufacturingService.explodeBomRequirements(null, tid, req.params.id, qty, whId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 4. PRODUCTION WORK ORDERS LIFECYCLE & SHOP-FLOOR EXECUTION
// ============================================================================
router.get('/work-orders', ...mfgAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const { status, search } = req.query;
    const params = [tid];
    let where = `wo.tenant_id = $1`;
    if (status && status !== 'all') { params.push(status); where += ` AND wo.status = $${params.length}`; }
    if (search) { params.push(`%${search.trim()}%`); where += ` AND (wo.order_number ILIKE $${params.length} OR p.name ILIKE $${params.length})`; }

    const result = await db.query(
      `SELECT wo.*,
              b.bom_code, b.bom_name, b.bom_version,
              p.name as product_name, p.sku, p.unit as product_unit,
              rw.warehouse_name as raw_warehouse_name,
              fw.warehouse_name as finished_warehouse_name,
              wc.centre_name as work_centre_name,
              u.full_name as responsible_user_name
       FROM mfg_work_orders wo
       LEFT JOIN mfg_boms b ON wo.bom_id = b.id
       LEFT JOIN products_services p ON wo.target_product_id = p.id
       LEFT JOIN warehouses rw ON wo.raw_materials_warehouse_id = rw.id
       LEFT JOIN warehouses fw ON wo.finished_goods_warehouse_id = fw.id
       LEFT JOIN mfg_work_centres wc ON wo.work_centre_id = wc.id
       LEFT JOIN users u ON wo.responsible_user_id = u.id
       WHERE ${where}
       ORDER BY wo.created_at DESC`,
      params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/work-orders/:id', ...mfgAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const woRes = await db.query(
      `SELECT wo.*, b.bom_code, b.bom_version, p.name as product_name, p.sku,
              rw.warehouse_name as raw_warehouse_name, fw.warehouse_name as finished_warehouse_name, wc.centre_name
       FROM mfg_work_orders wo
       LEFT JOIN mfg_boms b ON wo.bom_id = b.id
       LEFT JOIN products_services p ON wo.target_product_id = p.id
       LEFT JOIN warehouses rw ON wo.raw_materials_warehouse_id = rw.id
       LEFT JOIN warehouses fw ON wo.finished_goods_warehouse_id = fw.id
       LEFT JOIN mfg_work_centres wc ON wo.work_centre_id = wc.id
       WHERE wo.id = $1 AND wo.tenant_id = $2`,
      [req.params.id, tid]
    );
    if (woRes.rows.length === 0) return res.status(404).json({ success: false, message: 'Work Order not found.' });

    const [mats, movs, scraps, events] = await Promise.all([
      db.query(
        `SELECT wm.*, p.name as product_name, p.sku, p.current_stock
         FROM mfg_work_order_materials wm
         JOIN products_services p ON wm.product_id = p.id
         WHERE wm.work_order_id = $1`,
        [req.params.id]
      ),
      db.query(
        `SELECT mm.*, p.name as product_name, p.sku, w.warehouse_name
         FROM mfg_material_movements mm
         JOIN products_services p ON mm.product_id = p.id
         LEFT JOIN warehouses w ON mm.warehouse_id = w.id
         WHERE mm.work_order_id = $1 ORDER BY mm.created_at DESC`,
        [req.params.id]
      ),
      db.query(
        `SELECT sl.*, p.name as product_name, p.sku
         FROM mfg_scrap_logs sl
         JOIN products_services p ON sl.product_id = p.id
         WHERE sl.work_order_id = $1 ORDER BY sl.recorded_at DESC`,
        [req.params.id]
      ),
      db.query(`SELECT * FROM mfg_posting_events WHERE work_order_id = $1 ORDER BY created_at DESC`, [req.params.id])
    ]);

    res.json({
      success: true,
      data: {
        work_order: woRes.rows[0],
        materials: mats.rows,
        movements: movs.rows,
        scrap_logs: scraps.rows,
        posting_events: events.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/work-orders', ...mfgAuth, requirePermission('manufacturing', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const created = await manufacturingService.createWorkOrder(client, tid, req.body);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: created.work_order, planned_materials: created.planned_materials, message: `Work Order ${created.work_order.order_number} created.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/work-orders/:id/approve', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `UPDATE mfg_work_orders SET status = 'Approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND status = 'Draft' RETURNING *`,
      [req.user?.id || null, req.params.id, tid]
    );
    if (r.rows.length === 0) return res.status(400).json({ success: false, message: 'Work order must be in Draft status to approve.' });
    res.json({ success: true, data: r.rows[0], message: 'Work Order approved.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/work-orders/:id/release', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const released = await manufacturingService.releaseWorkOrder(client, tid, req.params.id, req.user?.id || null);
    await client.query('COMMIT');
    res.json({ success: true, data: released, message: `Work Order ${released.order_number} released and materials reserved.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/work-orders/:id/pause', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `UPDATE mfg_work_orders SET status = 'Paused', paused_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status IN ('Released', 'In Production', 'Partially Completed') RETURNING *`,
      [req.params.id, tid]
    );
    res.json({ success: true, data: r.rows[0], message: 'Work Order paused.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/work-orders/:id/resume', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `UPDATE mfg_work_orders SET status = 'In Production', updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2 AND status = 'Paused' RETURNING *`,
      [req.params.id, tid]
    );
    res.json({ success: true, data: r.rows[0], message: 'Work Order resumed.' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/work-orders/:id/issue-material', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const result = await manufacturingService.issueMaterial(client, tid, req.params.id, {
      productId: req.body.product_id,
      warehouseId: req.body.warehouse_id,
      quantity: req.body.quantity,
      unitCode: req.body.unit_code,
      movementType: req.body.movement_type || 'ISSUE',
      batchNumber: req.body.batch_number || 'STANDARD',
      idempotencyKey: req.body.idempotency_key || null,
      remarks: req.body.remarks || '',
      userId: req.user?.id || null
    });
    await client.query('COMMIT');
    res.json({ success: true, data: result, message: result.duplicate ? 'Duplicate issue safely skipped.' : 'Material issued to production.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/work-orders/:id/return-material', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const result = await manufacturingService.returnMaterial(client, tid, req.params.id, {
      productId: req.body.product_id,
      warehouseId: req.body.warehouse_id,
      quantity: req.body.quantity,
      unitCode: req.body.unit_code,
      idempotencyKey: req.body.idempotency_key || null,
      remarks: req.body.remarks || '',
      userId: req.user?.id || null
    });
    await client.query('COMMIT');
    res.json({ success: true, data: result, message: 'Unused material returned to warehouse stock.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/work-orders/:id/scrap', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const scrap = await manufacturingService.recordScrap(client, tid, req.params.id, {
      productId: req.body.product_id,
      warehouseId: req.body.warehouse_id,
      quantity: req.body.quantity,
      scrapReason: req.body.scrap_reason,
      isReworkable: req.body.is_reworkable,
      userId: req.user?.id || null
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: scrap, message: 'Scrap / wastage recorded.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/work-orders/:id/receive', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const result = await manufacturingService.receiveFinishedGoods(client, tid, req.params.id, {
      producedQty: req.body.produced_quantity,
      rejectedQty: req.body.rejected_quantity || 0,
      reworkQty: req.body.rework_quantity || 0,
      warehouseId: req.body.warehouse_id,
      actualHours: req.body.actual_hours || 0,
      actualLaborCost: req.body.actual_labor_cost !== undefined ? parseFloat(req.body.actual_labor_cost) : null,
      actualOverheadCost: req.body.actual_overhead_cost !== undefined ? parseFloat(req.body.actual_overhead_cost) : null,
      isFinal: Boolean(req.body.is_final),
      idempotencyKey: req.body.idempotency_key || null,
      remarks: req.body.remarks || '',
      userId: req.user?.id || null
    });
    await client.query('COMMIT');
    res.json({ success: true, data: result, message: result.duplicate ? 'Duplicate receipt safely skipped.' : `Received ${result.produced_now} finished goods into stock.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/work-orders/:id/cancel', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const woRes = await client.query(`SELECT * FROM mfg_work_orders WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
    if (woRes.rows.length === 0) throw new Error('Work Order not found.');
    const wo = woRes.rows[0];
    if (['Completed', 'Closed'].includes(wo.status)) throw new Error('Completed or Closed orders cannot be cancelled.');

    await manufacturingService.releaseOrderReservations(client, tid, wo.id);
    const upd = await client.query(
      `UPDATE mfg_work_orders SET status = 'Cancelled', cancelled_at = NOW(), cancel_reason = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [req.body.reason || 'Cancelled by planner', wo.id]
    );
    await client.query('COMMIT');
    res.json({ success: true, data: upd.rows[0], message: `Work Order ${wo.order_number} cancelled and reservations released.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/work-orders/:id/close', ...mfgAuth, requirePermission('manufacturing', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    await manufacturingService.releaseOrderReservations(client, tid, req.params.id);
    const upd = await client.query(
      `UPDATE mfg_work_orders SET status = 'Closed', closed_at = NOW(), updated_at = NOW() WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tid]
    );
    await client.query('COMMIT');
    res.json({ success: true, data: upd.rows[0], message: 'Work Order closed cleanly.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// Legacy status update endpoint (preserved for backward compatibility)
router.put('/work-orders/:id/status', ...mfgAuth, async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const { status, produced_quantity } = req.body;
    if (status === 'Completed') {
      const woRes = await client.query(`SELECT target_quantity, produced_quantity FROM mfg_work_orders WHERE id = $1 AND tenant_id = $2`, [req.params.id, tid]);
      if (woRes.rows.length === 0) throw new Error('Work Order not found.');
      const remaining = Math.max(0, parseFloat(woRes.rows[0].target_quantity) - parseFloat(woRes.rows[0].produced_quantity || 0));
      const qtyToReceive = produced_quantity !== undefined ? parseFloat(produced_quantity) : remaining;
      const result = await manufacturingService.receiveFinishedGoods(client, tid, req.params.id, {
        producedQty: qtyToReceive > 0 ? qtyToReceive : parseFloat(woRes.rows[0].target_quantity),
        isFinal: true,
        idempotencyKey: `LEGACY_COMPLETE_${req.params.id}`,
        userId: req.user?.id || null
      });
      await client.query('COMMIT');
      return res.json({ success: true, data: result.work_order, message: 'Work Order completed.' });
    }
    const upd = await client.query(`UPDATE mfg_work_orders SET status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3 RETURNING *`, [status, req.params.id, tid]);
    await client.query('COMMIT');
    res.json({ success: true, data: upd.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ============================================================================
// 5. MANUFACTURING REPORTS & MRP AGGREGATION
// ============================================================================
router.get('/reports', ...mfgAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const data = await manufacturingService.getReports(tid);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/mrp-shortages', ...mfgAuth, async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `SELECT p.id as product_id, p.sku, p.name as product_name, p.unit,
              COALESCE(p.current_stock, 0) as current_stock,
              SUM(GREATEST(0, wm.planned_quantity - COALESCE(wm.issued_quantity, 0))) as total_required_open
       FROM mfg_work_order_materials wm
       JOIN mfg_work_orders wo ON wm.work_order_id = wo.id
       JOIN products_services p ON wm.product_id = p.id
       WHERE wo.tenant_id = $1 AND wo.status IN ('Draft', 'Approved', 'Released', 'In Production', 'Partially Completed')
       GROUP BY p.id, p.sku, p.name, p.unit, p.current_stock`,
      [tid]
    );
    const items = r.rows.map(x => {
      const reqQty = parseFloat(x.total_required_open || 0);
      const cur = parseFloat(x.current_stock || 0);
      return { ...x, total_required_open: reqQty, current_stock: cur, shortage: Math.max(0, reqQty - cur) };
    });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
