const db = require('./config/db');

async function migrateInventoryModule() {
  console.log('================================================================');
  console.log('🚀 RUNNING MASHRUE INVENTORY MODULE DATABASE MIGRATION');
  console.log('================================================================');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Extensions
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // 2. Enhance products_services with master fields
    console.log('1. Enhancing products_services table...');
    await client.query(`
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'Active';
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS min_stock_level NUMERIC(18, 4) DEFAULT 0;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS max_stock_level NUMERIC(18, 4) DEFAULT 1000;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS valuation_method VARCHAR(30) DEFAULT 'WEIGHTED_AVG';
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS purchase_description TEXT;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS sales_description TEXT;
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS supplier_product_code VARCHAR(100);
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS allow_negative_stock BOOLEAN DEFAULT FALSE;

      CREATE INDEX IF NOT EXISTS idx_products_tenant_archived ON products_services (tenant_id, is_archived);
      CREATE INDEX IF NOT EXISTS idx_products_barcode ON products_services (tenant_id, barcode);
      CREATE INDEX IF NOT EXISTS idx_products_sku ON products_services (tenant_id, sku);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_products_tenant_sku ON products_services (tenant_id, sku) WHERE is_archived = false AND sku IS NOT NULL;
    `);

    // 3. Tenant Inventory Settings
    console.log('2. Creating tenant_inventory_settings table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_inventory_settings (
        tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        default_valuation_method VARCHAR(30) DEFAULT 'WEIGHTED_AVG',
        allow_negative_stock BOOLEAN DEFAULT FALSE,
        auto_post_gl BOOLEAN DEFAULT TRUE,
        low_stock_threshold_percent NUMERIC(5, 2) DEFAULT 20.0,
        default_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Procurement Items (Line items for Supplier POs & Procurements)
    console.log('3. Creating procurement_items table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS procurement_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        procurement_id UUID NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE RESTRICT,
        ordered_quantity NUMERIC(18, 4) NOT NULL,
        received_quantity NUMERIC(18, 4) DEFAULT 0,
        unit_cost NUMERIC(18, 4) NOT NULL,
        tax_percent NUMERIC(5, 2) DEFAULT 0,
        total_cost NUMERIC(18, 4) NOT NULL,
        specifications TEXT,
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_proc_items_proc ON procurement_items (procurement_id);
      CREATE INDEX IF NOT EXISTS idx_proc_items_prod ON procurement_items (product_id);
    `);

    // 5. Purchase Requisitions & Items
    console.log('4. Creating purchase_requisitions and purchase_requisition_items tables...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_requisitions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        requisition_number VARCHAR(100) NOT NULL,
        requisition_date DATE NOT NULL DEFAULT CURRENT_DATE,
        required_by_date DATE,
        department_name VARCHAR(150),
        requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(50) DEFAULT 'Pending',
        priority VARCHAR(30) DEFAULT 'Medium',
        opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
        notes TEXT,
        approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
        approved_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, requisition_number)
      );
      CREATE INDEX IF NOT EXISTS idx_requisitions_tenant ON purchase_requisitions (tenant_id, status);

      CREATE TABLE IF NOT EXISTS purchase_requisition_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        requisition_id UUID NOT NULL REFERENCES purchase_requisitions(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE RESTRICT,
        requested_quantity NUMERIC(18, 4) NOT NULL,
        estimated_unit_cost NUMERIC(18, 4) DEFAULT 0,
        estimated_total NUMERIC(18, 4) DEFAULT 0,
        specifications TEXT,
        status VARCHAR(50) DEFAULT 'Pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_req_items_req ON purchase_requisition_items (requisition_id);
    `);

    // 6. Goods Receipt Notes (GRN Master & Items)
    console.log('5. Creating goods_receipt_notes and goods_receipt_note_items tables...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS goods_receipt_notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        grn_number VARCHAR(100) NOT NULL,
        grn_date DATE NOT NULL DEFAULT CURRENT_DATE,
        warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
        supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
        procurement_id UUID REFERENCES procurements(id) ON DELETE SET NULL,
        opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
        reference_type VARCHAR(50) DEFAULT 'SUPPLIER_PO',
        reference_number VARCHAR(100),
        received_by UUID REFERENCES users(id) ON DELETE SET NULL,
        total_received_value NUMERIC(18, 4) DEFAULT 0,
        remarks TEXT,
        status VARCHAR(50) DEFAULT 'Completed',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, grn_number)
      );
      CREATE INDEX IF NOT EXISTS idx_grn_tenant ON goods_receipt_notes (tenant_id, grn_date DESC);

      CREATE TABLE IF NOT EXISTS goods_receipt_note_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        grn_id UUID NOT NULL REFERENCES goods_receipt_notes(id) ON DELETE CASCADE,
        procurement_item_id UUID REFERENCES procurement_items(id) ON DELETE SET NULL,
        product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE RESTRICT,
        ordered_quantity NUMERIC(18, 4) DEFAULT 0,
        received_quantity NUMERIC(18, 4) NOT NULL,
        rejected_quantity NUMERIC(18, 4) DEFAULT 0,
        unit_cost NUMERIC(18, 4) NOT NULL,
        total_value NUMERIC(18, 4) NOT NULL,
        batch_number VARCHAR(100) DEFAULT 'STANDARD',
        storage_location VARCHAR(100),
        manufacturing_date DATE,
        expiry_date DATE,
        remarks TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_grn_items_grn ON goods_receipt_note_items (grn_id);
    `);

    // 7. Supplier Returns (RTV Master & Items)
    console.log('6. Creating supplier_returns and supplier_return_items tables...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS supplier_returns (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        return_number VARCHAR(100) NOT NULL,
        return_date DATE NOT NULL DEFAULT CURRENT_DATE,
        warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE RESTRICT,
        supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        procurement_id UUID REFERENCES procurements(id) ON DELETE SET NULL,
        grn_id UUID REFERENCES goods_receipt_notes(id) ON DELETE SET NULL,
        reason TEXT,
        total_return_value NUMERIC(18, 4) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Completed',
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, return_number)
      );
      CREATE INDEX IF NOT EXISTS idx_rtv_tenant ON supplier_returns (tenant_id, return_date DESC);

      CREATE TABLE IF NOT EXISTS supplier_return_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        supplier_return_id UUID NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE RESTRICT,
        quantity NUMERIC(18, 4) NOT NULL,
        unit_cost NUMERIC(18, 4) NOT NULL,
        total_value NUMERIC(18, 4) NOT NULL,
        batch_number VARCHAR(100) DEFAULT 'STANDARD',
        reason TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_rtv_items_rtv ON supplier_return_items (supplier_return_id);
    `);

    // 8. Seed default inventory settings for existing tenants
    console.log('7. Seeding tenant_inventory_settings for existing tenants...');
    await client.query(`
      INSERT INTO tenant_inventory_settings (tenant_id, default_valuation_method, allow_negative_stock, auto_post_gl)
      SELECT id, 'WEIGHTED_AVG', FALSE, TRUE FROM tenants
      ON CONFLICT (tenant_id) DO NOTHING;
    `);

    await client.query('COMMIT');
    console.log('✅ Inventory Module Migration completed successfully!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Inventory Module Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrateInventoryModule()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = migrateInventoryModule;
