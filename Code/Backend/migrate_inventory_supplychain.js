const db = require('./config/db');

async function migrateInventoryAndSupplyChain() {
  try {
    console.log('Starting inventory and supply chain migration...');

    await db.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      CREATE TABLE IF NOT EXISTS warehouse_stock (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
        batch_number VARCHAR(100) DEFAULT 'STANDARD',
        quantity_on_hand NUMERIC(18, 4) DEFAULT 0,
        quantity_reserved NUMERIC(18, 4) DEFAULT 0,
        reorder_level NUMERIC(18, 4) DEFAULT 10,
        storage_location VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(warehouse_id, product_id, batch_number)
      );

      CREATE TABLE IF NOT EXISTS stock_reservations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
        purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
        product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
        warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        batch_number VARCHAR(100) DEFAULT 'STANDARD',
        reserved_quantity NUMERIC(18, 4) DEFAULT 0,
        status VARCHAR(50) DEFAULT 'Active',
        reserved_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
      ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS batch_number VARCHAR(100);
      ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS stock_at_time_of_tender NUMERIC(18, 4) DEFAULT 0;
      ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS stock_reserved BOOLEAN DEFAULT FALSE;
      ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(18, 4) DEFAULT 0;
      ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS item_size VARCHAR(100);

      ALTER TABLE bid_items ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL;
      ALTER TABLE bid_items ADD COLUMN IF NOT EXISTS item_name VARCHAR(255);
      ALTER TABLE bid_items ADD COLUMN IF NOT EXISTS unit VARCHAR(50) DEFAULT 'PCS';
      ALTER TABLE bid_items ADD COLUMN IF NOT EXISTS batch_number VARCHAR(100);
      ALTER TABLE bid_items ADD COLUMN IF NOT EXISTS stock_on_hand NUMERIC(18, 4) DEFAULT 0;

      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS expiry_date DATE;
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS reference_number VARCHAR(100);
      ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS storage_location VARCHAR(100);

      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS batch_number VARCHAR(100);
      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS expiry_date DATE;
      ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS warehouse_code VARCHAR(50);
    `);

    // Sync current product stock into primary warehouse so warehouse_stock has live data
    await db.query(`
      INSERT INTO warehouse_stock (tenant_id, warehouse_id, product_id, batch_number, quantity_on_hand, quantity_reserved)
      SELECT p.tenant_id, 
             COALESCE(w.id, (SELECT id FROM warehouses ORDER BY created_at ASC LIMIT 1)),
             p.id, 
             'LOT-PRIMARY', 
             COALESCE(p.current_stock, 0), 
             0
      FROM products_services p
      LEFT JOIN LATERAL (
        SELECT id FROM warehouses 
        WHERE tenant_id = p.tenant_id 
        ORDER BY created_at ASC LIMIT 1
      ) w ON true
      WHERE COALESCE(p.current_stock, 0) > 0
        AND COALESCE(w.id, (SELECT id FROM warehouses ORDER BY created_at ASC LIMIT 1)) IS NOT NULL
      ON CONFLICT (warehouse_id, product_id, batch_number) DO UPDATE
      SET quantity_on_hand = EXCLUDED.quantity_on_hand;
    `);

    console.log('✅ Inventory, warehouse_stock, tender_items, and bid_items migrated & synced successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrateInventoryAndSupplyChain();
