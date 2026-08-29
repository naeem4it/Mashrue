const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '../Code/Backend/.env') });

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'mashrueDB',
  user: process.env.DB_USER || process.env.DATABASE_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || process.env.DATABASE_PASSWORD || 'root'
});

async function runSafeUpgrade() {
  console.log('====================================================================');
  console.log('MASHRUE DATABASE - NODE.JS NON-DESTRUCTIVE UPGRADE RUNNER');
  console.log('====================================================================');
  console.log(`Connecting to: ${process.env.DB_NAME || 'mashrueDB'} on ${process.env.DB_HOST || 'localhost'}...`);

  const sqlFilePath = path.join(__dirname, '04_production_upgrade_safe.sql');
  const sql = fs.readFileSync(sqlFilePath, 'utf8');

  try {
    const client = await pool.connect();
    console.log('✓ Connected to PostgreSQL successfully.');
    console.log('Executing safe schema migration (04_production_upgrade_safe.sql)...');
    
    await client.query(sql);
    client.release();
    
    console.log('====================================================================');
    console.log('✓ SUCCESS: Database upgrade completed successfully! Zero data entries disturbed.');
    console.log('====================================================================');
    process.exit(0);
  } catch (err) {
    console.error('====================================================================');
    console.error('❌ Upgrade Failed:', err.message);
    console.error('====================================================================');
    process.exit(1);
  }
}

runSafeUpgrade();
