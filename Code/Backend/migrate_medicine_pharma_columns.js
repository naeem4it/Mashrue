const db = require('./config/db');

async function migrate() {
  console.log('Migrating Brand Name, Batch #, DOM, DOE, and Medicine item type columns...');

  const queries = [
    // 1. products_services (Item & SKU Catalog)
    `ALTER TABLE products_services ADD COLUMN IF NOT EXISTS brand_name VARCHAR(150);`,
    `ALTER TABLE products_services ADD COLUMN IF NOT EXISTS manufacturing_date DATE;`,
    `ALTER TABLE products_services ADD COLUMN IF NOT EXISTS expiry_date DATE;`,
    `ALTER TABLE products_services ADD COLUMN IF NOT EXISTS batch_number VARCHAR(100);`,
    `ALTER TABLE products_services ADD COLUMN IF NOT EXISTS item_type VARCHAR(100) DEFAULT 'General Goods';`,

    // 2. warehouse_stock (Warehouse stock balances)
    `ALTER TABLE warehouse_stock ADD COLUMN IF NOT EXISTS manufacturing_date DATE;`,
    `ALTER TABLE warehouse_stock ADD COLUMN IF NOT EXISTS expiry_date DATE;`,

    // 3. inventory_transactions (Audited movement ledger)
    `ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS manufacturing_date DATE;`,
    `ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS brand_name VARCHAR(150);`,

    // 4. tender_items (Tenders & Quotations scope items)
    `ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS brand_name VARCHAR(150);`,
    `ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS manufacturing_date DATE;`,
    `ALTER TABLE tender_items ADD COLUMN IF NOT EXISTS expiry_date DATE;`,

    // 5. bid_items (Costing & Margin Calculator line items)
    `ALTER TABLE bid_items ADD COLUMN IF NOT EXISTS brand_name VARCHAR(150);`,
    `ALTER TABLE bid_items ADD COLUMN IF NOT EXISTS manufacturing_date DATE;`,
    `ALTER TABLE bid_items ADD COLUMN IF NOT EXISTS expiry_date DATE;`,

    // 6. delivery_challan_items (Delivery Challan dispatches)
    `ALTER TABLE delivery_challan_items ADD COLUMN IF NOT EXISTS brand_name VARCHAR(150);`,
    `ALTER TABLE delivery_challan_items ADD COLUMN IF NOT EXISTS manufacturing_date DATE;`,
    `ALTER TABLE delivery_challan_items ADD COLUMN IF NOT EXISTS expiry_date DATE;`,

    // 7. Update sample pharmaceutical / medical items to have brand_name and item_type = 'Medicine'
    `UPDATE products_services SET item_type = 'Medicine', brand_name = 'SurgiMed' WHERE name ILIKE '%Suture%' OR name ILIKE '%Cannula%' OR name ILIKE '%Syringe%' OR name ILIKE '%Gauze%';`,
    `UPDATE products_services SET brand_name = 'Siemens Energy' WHERE name ILIKE '%Transformer%';`,
    `UPDATE products_services SET brand_name = 'Cameron / Schlumberger' WHERE name ILIKE '%Valve%';`,
    `UPDATE products_services SET brand_name = 'ABB / Hitachi' WHERE name ILIKE '%Relay%';`
  ];

  for (const q of queries) {
    await db.query(q);
  }

  console.log('✓ Successfully migrated Brand Name, Batch #, DOM, DOE columns across all item tables.');
  process.exit(0);
}

migrate().catch(e => {
  console.error('Migration error:', e);
  process.exit(1);
});
