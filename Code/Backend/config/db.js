const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'mashrueDB',
  user: process.env.DATABASE_USERNAME || process.env.DB_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || process.env.DB_PASSWORD || 'root',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client', err);
});

// Helper for running queries
const query = (text, params) => pool.query(text, params);

module.exports = {
  pool,
  query,
};
