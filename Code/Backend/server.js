const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

process.on('uncaughtException', (err) => {
  console.error('CRITICAL Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('CRITICAL Unhandled Rejection at:', promise, 'reason:', reason);
});

// Optional Security & Performance modules (with graceful fallbacks)
let helmet;
let compression;
let rateLimit;
try { helmet = require('helmet'); } catch (e) { helmet = null; }
try { compression = require('compression'); } catch (e) { compression = null; }
try { rateLimit = require('express-rate-limit'); } catch (e) { rateLimit = null; }

const db = require('./config/db');
const { autoSeedSuperAdmin } = require('./services/autoSeedSuperAdmin');

// Core API Route Handlers
const authRoutes = require('./routes/auth.routes');
const businessProfilesRoutes = require('./routes/businessProfiles.routes');
const opportunitiesRoutes = require('./routes/opportunities.routes');
const bidsRoutes = require('./routes/bids.routes');
const bidSecuritiesRoutes = require('./routes/bidSecurities.routes');
const awardsAndContractsRoutes = require('./routes/awardsAndContracts.routes');
const purchaseOrdersRoutes = require('./routes/purchaseOrders.routes');
const inventoryAndLogisticsRoutes = require('./routes/inventoryAndLogistics.routes');
const invoicesRoutes = require('./routes/invoices.routes');
const paymentsRoutes = require('./routes/payments.routes');
const mastersRoutes = require('./routes/masters.routes');
const expensesRoutes = require('./routes/expenses.routes');
const reportsRoutes = require('./routes/reports.routes');
const fbrRoutes = require('./routes/fbr.routes');
const usersRoutes = require('./routes/users.routes');

const app = express();
const PORT = process.env.PORT || 3033;
const isProd = process.env.NODE_ENV === 'production';

// 1. Trust Reverse Proxy (Nginx on Hetzner Ubuntu)
app.set('trust proxy', 1);

// 2. HTTP Security Headers (Helmet)
if (helmet) {
  app.use(helmet({
    contentSecurityPolicy: false, // Managed at Nginx edge or relaxed for internal SPA assets
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
  }));
}

// 3. Gzip Compression for Dynamic Responses
if (compression) {
  app.use(compression());
}

// 4. Production-Ready CORS Whitelist
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://mashrue.com,https://www.mashrue.com,http://localhost:3033,http://localhost:3000,http://127.0.0.1:3033,http://localhost:5500,http://127.0.0.1:5500,http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests or any localhost/127.0.0.1 dev origin
    if (!origin || !isProd || origin.includes('localhost') || origin.includes('127.0.0.1') || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS Error: Origin ${origin} is not allowed by production policy.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tenant-id', 'x-user-role', 'x-user-id', 'x-username']
}));

// 5. Request Body & URL Encoding Limits
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// 6. Rate Limiting for Authentication (Brute Force Protection)
if (rateLimit) {
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // 50 attempts per window per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many login attempts from this IP. Please try again after 15 minutes.' }
  });
  app.use('/api/auth/login', authLimiter);
}

// 7. Serve Static Frontend Files (Direct fallback if not served by Nginx)
const frontendDir = path.join(__dirname, '../Frontend');
app.use(express.static(frontendDir, {
  maxAge: isProd ? '1d' : '1h',
  etag: true,
  lastModified: true
}));

// 8. Health Check Endpoints (Nginx / Uptime Monitoring / Load Balancer)
const handleHealthCheck = async (req, res) => {
  try {
    const start = Date.now();
    const dbCheck = await db.query('SELECT NOW() as db_time');
    const latency = Date.now() - start;

    res.status(200).json({
      status: 'ok',
      service: 'mashrue-backend',
      environment: process.env.NODE_ENV || 'production',
      version: '2.0.0',
      uptime_seconds: Math.floor(process.uptime()),
      database: {
        status: 'connected',
        latency_ms: latency,
        timestamp: dbCheck.rows[0].db_time
      },
      fbr_mode: process.env.FBR_ENVIRONMENT || 'Sandbox',
      server_time: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      status: 'degraded',
      service: 'mashrue-backend',
      environment: process.env.NODE_ENV || 'production',
      version: '2.0.0',
      uptime_seconds: Math.floor(process.uptime()),
      database: {
        status: 'disconnected',
        error: isProd ? 'Database connectivity issue' : err.message
      },
      server_time: new Date().toISOString()
    });
  }
};

app.get('/health', handleHealthCheck);
app.get('/api/health', handleHealthCheck);

// 9. Mount All Modular REST API Endpoints
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/business-profiles', businessProfilesRoutes);
app.use('/api/masters', mastersRoutes);
app.use('/api/opportunities', opportunitiesRoutes);
app.use('/api/bids', bidsRoutes);
app.use('/api/bid-securities', bidSecuritiesRoutes);
app.use('/api', awardsAndContractsRoutes); // /api/awards, /api/guarantees, /api/contracts
app.use('/api/purchase-orders', purchaseOrdersRoutes);
app.use('/api', inventoryAndLogisticsRoutes); // /api/warehouses, /api/inventory, /api/procurements, /api/delivery-challans
app.use('/api/invoices', invoicesRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/fbr', fbrRoutes);

// 9.5 Dedicated Public Page Routes (/plans, /contact)
app.get('/plans', (req, res) => res.sendFile(path.join(frontendDir, 'plans.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(frontendDir, 'contact.html')));

// 10. SPA Routing Fallback (for direct browser hits when served by Node)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: `API route ${req.path} not found.` });
  }
  res.sendFile(path.join(frontendDir, 'index.html'));
});

// 11. Production Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err.message, isProd ? '' : err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: isProd ? 'An internal server error occurred. Please contact system support.' : err.message,
    ...(isProd ? {} : { stack: err.stack })
  });
});

// 12. Server Startup & SuperAdmin Seeding
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`=======================================================`);
  console.log(`🚀 Mashrue Enterprise BMS Server running in ${isProd ? 'PRODUCTION' : 'DEVELOPMENT'} mode`);
  console.log(`🌐 Listening on: http://0.0.0.0:${PORT}`);
  console.log(`🇵🇰 FBR PRAL Digital Invoicing: Mode = ${process.env.FBR_ENVIRONMENT || 'Sandbox'}`);
  console.log(`=======================================================`);

  // Ensure primary Super Admin account is auto-seeded on deployment
  try {
    await autoSeedSuperAdmin();
  } catch (seedErr) {
    console.error('SuperAdmin auto-seed error:', seedErr.message);
  }

  // Auto-migrate schema additions safely on startup
  try {
    await db.query(`
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type VARCHAR(100) DEFAULT 'Government Department';
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS org_type VARCHAR(100) DEFAULT 'Government Department';
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS workflow_gates JSONB DEFAULT '{"requires_bid_security":true,"requires_performance_guarantee":true,"requires_stamp_duty":true,"requires_dtl_inspection":false,"requires_fbr_e_invoice":true,"requires_diary_tracking":true}'::jsonb;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS abbreviation VARCHAR(50);
      ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);

      ALTER TABLE products_services ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS free_business_profile_limit INT DEFAULT 2;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS additional_profile_monthly_fee NUMERIC(10,2) DEFAULT 4500.00;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pending_paid_company_payment BOOLEAN DEFAULT FALSE;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS pending_paid_company_amount NUMERIC(10,2) DEFAULT 0.00;
      ALTER TABLE tenants ADD COLUMN IF NOT EXISTS paid_companies_count INT DEFAULT 0;
      UPDATE tenants SET additional_profile_monthly_fee = 4500.00 WHERE additional_profile_monthly_fee = 2500.00 OR additional_profile_monthly_fee IS NULL;

      CREATE TABLE IF NOT EXISTS tenant_subscription_payments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        amount NUMERIC(10, 2) NOT NULL,
        payment_type VARCHAR(50) DEFAULT 'company_addon',
        payment_method VARCHAR(50) DEFAULT 'Bank Transfer',
        reference_number VARCHAR(100),
        status VARCHAR(30) DEFAULT 'Verified',
        payment_date DATE DEFAULT CURRENT_DATE,
        remarks TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✓ Database schema verified and updated (customers, business_profiles, products_services, tenants, subscription_payments).');
  } catch (schemaErr) {
    console.warn('Schema auto-migration warning:', schemaErr.message);
  }
});
