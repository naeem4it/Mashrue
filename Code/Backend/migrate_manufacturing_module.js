/**
 * ============================================================================
 * MASHRUE MANUFACTURING MODULE — DATABASE MIGRATION (migrate_manufacturing_module.js)
 * ============================================================================
 * Reuses and extends existing masters:
 *   products_services, uom_masters, warehouses, warehouse_stock,
 *   inventory_transactions, mfg_boms, mfg_bom_items, mfg_work_orders
 *
 * Adds enterprise manufacturing tables:
 *   - mfg_settings, mfg_work_centres, mfg_uom_conversions
 *   - mfg_work_order_materials, mfg_material_movements, mfg_scrap_logs
 *   - mfg_posting_events
 * ============================================================================
 */

const db = require('./config/db');

async function migrateManufacturingModule() {
  console.log('================================================================');
  console.log('🏭 RUNNING MASHRUE MANUFACTURING MODULE DATABASE MIGRATION');
  console.log('================================================================');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // 1. Extend products_services with Manufacturing classification
    console.log('1. Extending products_services for Manufacturing...');
    await client.query(`
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS is_raw_material BOOLEAN DEFAULT TRUE;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS is_finished_good BOOLEAN DEFAULT TRUE;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS is_sub_assembly BOOLEAN DEFAULT FALSE;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS mfg_lead_time_days INT DEFAULT 1;
    `);

    // 2. Extend mfg_boms and mfg_bom_items (Versioning, Multi-level, Yield, Status)
    console.log('2. Extending mfg_boms and mfg_bom_items...');
    await client.query(`
      ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'Active';
      ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS expected_yield_pct NUMERIC(6, 2) DEFAULT 100.00;
      ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE;
      ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
      ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS parent_bom_id UUID REFERENCES mfg_boms(id) ON DELETE SET NULL;
      ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE mfg_boms ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      ALTER TABLE mfg_bom_items ADD COLUMN IF NOT EXISTS uom_id UUID REFERENCES uom_masters(id) ON DELETE SET NULL;
      ALTER TABLE mfg_bom_items ADD COLUMN IF NOT EXISTS unit_code VARCHAR(30) DEFAULT 'PCS';
      ALTER TABLE mfg_bom_items ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(18, 6) DEFAULT 1.000000;
      ALTER TABLE mfg_bom_items ADD COLUMN IF NOT EXISTS child_bom_id UUID REFERENCES mfg_boms(id) ON DELETE SET NULL;
      ALTER TABLE mfg_bom_items ADD COLUMN IF NOT EXISTS notes TEXT;
    `);

    // 3. Create Work Centres & Settings & UOM Conversions
    console.log('3. Creating mfg_settings, mfg_work_centres, mfg_uom_conversions...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS mfg_work_centres (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        centre_code VARCHAR(50) NOT NULL,
        centre_name VARCHAR(150) NOT NULL,
        location VARCHAR(150),
        hourly_labor_rate NUMERIC(14, 4) DEFAULT 0.0000,
        hourly_overhead_rate NUMERIC(14, 4) DEFAULT 0.0000,
        capacity_hours_per_day NUMERIC(6, 2) DEFAULT 8.00,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, centre_code)
      );

      CREATE TABLE IF NOT EXISTS mfg_settings (
        tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        wo_prefix VARCHAR(20) DEFAULT 'WO',
        wo_next_seq INT DEFAULT 1001,
        bom_prefix VARCHAR(20) DEFAULT 'BOM',
        bom_next_seq INT DEFAULT 1001,
        default_raw_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
        default_fg_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
        default_scrap_allowance_pct NUMERIC(6, 2) DEFAULT 0.00,
        require_wo_approval BOOLEAN DEFAULT FALSE,
        auto_reserve_on_release BOOLEAN DEFAULT TRUE,
        block_if_insufficient_material BOOLEAN DEFAULT TRUE,
        enable_finance_posting BOOLEAN DEFAULT TRUE,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS mfg_uom_conversions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
        from_unit VARCHAR(30) NOT NULL,
        to_unit VARCHAR(30) NOT NULL,
        conversion_factor NUMERIC(18, 6) NOT NULL,
        is_system BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_mfg_uom_conv
        ON mfg_uom_conversions (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), UPPER(from_unit), UPPER(to_unit));
    `);

    // 4. Extend mfg_work_orders
    console.log('4. Extending mfg_work_orders...');
    await client.query(`
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS work_centre_id UUID REFERENCES mfg_work_centres(id) ON DELETE SET NULL;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS responsible_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS planned_hours NUMERIC(10, 2) DEFAULT 0.00;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS actual_hours NUMERIC(10, 2) DEFAULT 0.00;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS rework_quantity NUMERIC(14, 4) DEFAULT 0.0000;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS scrap_cost NUMERIC(18, 4) DEFAULT 0.0000;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS planned_material_cost NUMERIC(18, 4) DEFAULT 0.0000;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS planned_labor_cost NUMERIC(18, 4) DEFAULT 0.0000;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS planned_overhead_cost NUMERIC(18, 4) DEFAULT 0.0000;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS released_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS gl_posted BOOLEAN DEFAULT FALSE;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS journal_entry_id UUID;
      ALTER TABLE mfg_work_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
    `);

    // 5. Work Order Materials, Production Material Movements, Scrap Logs & Posting Events
    console.log('5. Creating mfg_work_order_materials, mfg_material_movements, mfg_scrap_logs, mfg_posting_events...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS mfg_work_order_materials (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        work_order_id UUID NOT NULL REFERENCES mfg_work_orders(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE RESTRICT,
        unit_code VARCHAR(30) DEFAULT 'PCS',
        conversion_factor NUMERIC(18, 6) DEFAULT 1.000000,
        planned_quantity NUMERIC(18, 4) NOT NULL DEFAULT 0,
        reserved_quantity NUMERIC(18, 4) DEFAULT 0,
        issued_quantity NUMERIC(18, 4) DEFAULT 0,
        returned_quantity NUMERIC(18, 4) DEFAULT 0,
        scrap_quantity NUMERIC(18, 4) DEFAULT 0,
        unit_cost NUMERIC(18, 4) DEFAULT 0,
        planned_cost NUMERIC(18, 4) DEFAULT 0,
        actual_cost NUMERIC(18, 4) DEFAULT 0,
        stock_reservation_id UUID,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_mfg_wom_wo ON mfg_work_order_materials (work_order_id);

      CREATE TABLE IF NOT EXISTS mfg_material_movements (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        work_order_id UUID NOT NULL REFERENCES mfg_work_orders(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE RESTRICT,
        warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
        movement_type VARCHAR(40) NOT NULL,
        quantity NUMERIC(18, 4) NOT NULL,
        unit_code VARCHAR(30) DEFAULT 'PCS',
        base_quantity NUMERIC(18, 4) NOT NULL,
        unit_cost NUMERIC(18, 4) DEFAULT 0,
        total_cost NUMERIC(18, 4) DEFAULT 0,
        batch_number VARCHAR(100) DEFAULT 'STANDARD',
        inventory_transaction_id UUID,
        idempotency_key VARCHAR(200),
        remarks TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_mfg_mov_idemp
        ON mfg_material_movements (tenant_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_mfg_mov_wo ON mfg_material_movements (work_order_id);

      CREATE TABLE IF NOT EXISTS mfg_scrap_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        work_order_id UUID NOT NULL REFERENCES mfg_work_orders(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE RESTRICT,
        warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
        quantity NUMERIC(18, 4) NOT NULL,
        unit_cost NUMERIC(18, 4) DEFAULT 0,
        cost_impact NUMERIC(18, 4) DEFAULT 0,
        scrap_reason TEXT,
        is_reworkable BOOLEAN DEFAULT FALSE,
        recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS mfg_posting_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        work_order_id UUID REFERENCES mfg_work_orders(id) ON DELETE CASCADE,
        event_type VARCHAR(60) NOT NULL,
        idempotency_key VARCHAR(200) NOT NULL,
        status VARCHAR(30) DEFAULT 'Processed',
        finance_journal_id UUID,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, event_type, idempotency_key)
      );
    `);

    // 6. Seed System UOM Conversions & Defaults for Existing Tenants
    console.log('6. Seeding system UOM conversions and default tenant settings...');
    const sysConvs = [
      ['G', 'KG', 0.001],
      ['KG', 'G', 1000.0],
      ['MG', 'G', 0.001],
      ['G', 'MG', 1000.0],
      ['TON', 'KG', 1000.0],
      ['KG', 'TON', 0.001],
      ['ML', 'L', 0.001],
      ['L', 'ML', 1000.0],
      ['CM', 'M', 0.01],
      ['M', 'CM', 100.0],
      ['MM', 'M', 0.001],
      ['M', 'MM', 1000.0],
      ['DOZEN', 'PCS', 12.0],
      ['PCS', 'DOZEN', 0.083333]
    ];
    for (const [fromU, toU, factor] of sysConvs) {
      await client.query(`
        INSERT INTO mfg_uom_conversions (tenant_id, from_unit, to_unit, conversion_factor, is_system)
        VALUES (NULL, $1, $2, $3, TRUE)
        ON CONFLICT DO NOTHING
      `, [fromU, toU, factor]);
    }

    const tenantsRes = await client.query(`SELECT id FROM tenants`);
    for (const t of tenantsRes.rows) {
      await client.query(`
        INSERT INTO mfg_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING;
      `, [t.id]);

      await client.query(`
        INSERT INTO mfg_work_centres (tenant_id, centre_code, centre_name, location, hourly_labor_rate, hourly_overhead_rate)
        VALUES ($1, 'WC-MAIN', 'Main Production & Assembly Line', 'Factory Floor 1', 1500, 800)
        ON CONFLICT (tenant_id, centre_code) DO NOTHING;
      `, [t.id]);
    }

    await client.query('COMMIT');
    console.log('✅ MASHRUE MANUFACTURING MODULE MIGRATION COMPLETED SUCCESSFULLY!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Manufacturing Migration Error:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = migrateManufacturingModule;

if (require.main === module) {
  migrateManufacturingModule()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

