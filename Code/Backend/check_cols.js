const db = require('./config/db');

async function check() {
  const tables = ['products_services', 'warehouse_stock', 'tender_items', 'bid_items', 'inventory_transactions', 'delivery_challan_items'];
  for (const t of tables) {
    const res = await db.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1", [t]);
    console.log(t + ':', res.rows.map(r => r.column_name).join(', '));
  }
  process.exit(0);
}

check().catch(e => { console.error(e); process.exit(1); });
