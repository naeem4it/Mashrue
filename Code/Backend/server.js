const express = require('express');
const cors = require('cors');
require('dotenv').config();

const db = require('./config/db');
const { autoSeedSuperAdmin } = require('./services/autoSeedSuperAdmin');
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

const path = require('path');

const app = express();
const PORT = process.env.PORT || 3033;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-user-role']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
const frontendDir = path.join(__dirname, '../Frontend');
app.use(express.static(frontendDir));

// Healthcheck & DB status endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbCheck = await db.query('SELECT NOW() as db_time');
    res.json({
      status: 'Online',
      app: 'Mashrue Enterprise Business Management Backend',
      version: '2.0.0',
      database: 'Connected (mashrueDB)',
      serverTime: new Date().toISOString(),
      dbTime: dbCheck.rows[0].db_time
    });
  } catch (err) {
    res.json({
      status: 'Online (Standalone Mode)',
      app: 'Mashrue Enterprise Business Management Backend',
      version: '2.0.0',
      database: 'Mock / Fallback active',
      error: err.message
    });
  }
});

// Mount All Core Lifecycle Routes
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

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Error:', err);
  res.status(500).json({ success: false, message: 'Internal Server Error', error: err.message });
});

// Start Server
app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`🚀 Mashrue Enterprise Business Management Server running on port ${PORT}`);
  console.log(`🌐 Application UI: http://localhost:${PORT}`);
  console.log(`🇵🇰 FBR PRAL Digital Invoicing: Mode = ${process.env.FBR_ENVIRONMENT || 'Sandbox'}`);
  console.log(`=======================================================`);

  // Ensure primary Super Admin account is auto-seeded on deployment
  await autoSeedSuperAdmin();
});
