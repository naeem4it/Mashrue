const { requirePermission, resolveTenantId, sanitizePrices, requireRoles } = require('../middleware/rbac.middleware');
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');

const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val || ''));

// Initialize Enterprise Reporting Schema
const initReportsSchema = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS saved_report_presets (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        user_id UUID REFERENCES users(id),
        report_key VARCHAR(100) NOT NULL,
        preset_name VARCHAR(150) NOT NULL,
        filters JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_public BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS report_execution_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        user_id UUID REFERENCES users(id),
        report_key VARCHAR(100) NOT NULL,
        report_name VARCHAR(150),
        parameters JSONB DEFAULT '{}'::jsonb,
        execution_time_ms INTEGER DEFAULT 0,
        rows_count INTEGER DEFAULT 0,
        status VARCHAR(30) DEFAULT 'SUCCESS',
        error_message TEXT,
        executed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_report_execution_logs_tenant ON report_execution_logs(tenant_id, executed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_saved_report_presets_tid ON saved_report_presets(tenant_id, report_key);
    `);
  } catch (err) {
    console.warn('Reports schema initialization warning:', err.message);
  }
};
initReportsSchema();

// Master Enterprise Report Catalogue Definition
const REPORT_CATALOGUE = [
  // 1. Finance & Accounting
  {
    key: 'trial_balance',
    name: 'Trial Balance Ledger',
    module: 'finance',
    category: 'General Ledger',
    description: 'Double-entry audit verification showing total debit and credit balances per account code.',
    parameters: [
      { key: 'asOfDate', label: 'As of Date', type: 'date', default: 'today' },
      { key: 'accountType', label: 'Account Category', type: 'select', options: ['All', 'Asset', 'Liability', 'Equity', 'Revenue', 'Expense'] }
    ],
    columns: [
      { key: 'account_code', label: 'Account Code', align: 'left', width: '15%' },
      { key: 'account_name', label: 'Account Title', align: 'left', width: '35%' },
      { key: 'account_type', label: 'Classification', align: 'left', width: '15%' },
      { key: 'debit', label: 'Total Debit (PKR)', align: 'right', width: '17%', isNumeric: true },
      { key: 'credit', label: 'Total Credit (PKR)', align: 'right', width: '18%', isNumeric: true }
    ]
  },
  {
    key: 'receivables_aging',
    name: 'Accounts Receivable Aging Ledger',
    module: 'finance',
    category: 'Receivables',
    description: 'Detailed analysis of unpaid client invoices categorized into 0-30, 31-60, 61-90, and 90+ days aging buckets.',
    parameters: [
      { key: 'asOfDate', label: 'As of Date', type: 'date', default: 'today' }
    ],
    columns: [
      { key: 'customer_name', label: 'Client / Buyer Name', align: 'left', width: '28%' },
      { key: 'current_due', label: 'Current (0-30d)', align: 'right', width: '18%', isNumeric: true },
      { key: 'days_31_60', label: '31 - 60 Days', align: 'right', width: '18%', isNumeric: true },
      { key: 'days_61_90', label: '61 - 90 Days', align: 'right', width: '18%', isNumeric: true },
      { key: 'days_over_90', label: 'Over 90 Days', align: 'right', width: '18%', isNumeric: true }
    ]
  },
  {
    key: 'tax_withholding_fbr',
    name: 'FBR Withholding & Sales Tax Register',
    module: 'finance',
    category: 'Compliance',
    description: 'Statutory Sales Tax (GST 18%) and Income Tax Withholding (Sec 153) deduction schedule for PRAL / FBR compliance.',
    parameters: [
      { key: 'startDate', label: 'From Date', type: 'date' },
      { key: 'endDate', label: 'To Date', type: 'date' }
    ],
    columns: [
      { key: 'invoice_number', label: 'Tax Invoice #', align: 'left', width: '15%' },
      { key: 'invoice_date', label: 'Invoice Date', align: 'left', width: '12%' },
      { key: 'customer_name', label: 'Client Name', align: 'left', width: '25%' },
      { key: 'taxable_value', label: 'Taxable Value', align: 'right', width: '16%', isNumeric: true },
      { key: 'sales_tax_amount', label: 'Sales Tax (GST)', align: 'right', width: '16%', isNumeric: true },
      { key: 'total_amount', label: 'Gross Invoice Total', align: 'right', width: '16%', isNumeric: true }
    ]
  },

  // 2. Inventory & Supply Chain
  {
    key: 'stock_valuation',
    name: 'Inventory Stock Valuation Ledger',
    module: 'inventory',
    category: 'Valuation',
    description: 'Comprehensive item SKU on-hand inventory balances with unit cost prices and total valuation in PKR.',
    parameters: [
      { key: 'category', label: 'Product Category', type: 'text' }
    ],
    columns: [
      { key: 'sku', label: 'SKU Code', align: 'left', width: '15%' },
      { key: 'name', label: 'Product / Item Name', align: 'left', width: '35%' },
      { key: 'category', label: 'Category', align: 'left', width: '15%' },
      { key: 'current_stock', label: 'Stock On Hand', align: 'center', width: '15%', isNumeric: true },
      { key: 'valuation_pkr', label: 'Total Valuation (PKR)', align: 'right', width: '20%', isNumeric: true }
    ]
  },
  {
    key: 'low_stock_reorder',
    name: 'Low Stock & Reorder Warning Register',
    module: 'inventory',
    category: 'Alerts',
    description: 'Items where available warehouse stock has reached or fallen below safety buffer thresholds.',
    parameters: [],
    columns: [
      { key: 'sku', label: 'SKU Code', align: 'left', width: '15%' },
      { key: 'name', label: 'Item Name', align: 'left', width: '35%' },
      { key: 'current_stock', label: 'Current Stock', align: 'center', width: '15%', isNumeric: true },
      { key: 'reorder_level', label: 'Reorder Level', align: 'center', width: '15%', isNumeric: true },
      { key: 'stock_deficit', label: 'Deficit Quantity', align: 'center', width: '20%', isNumeric: true }
    ]
  },

  // 3. Tenders & BoQ Bidding
  {
    key: 'bid_securities_register',
    name: 'Bid Securities & Guarantees Register',
    module: 'tender',
    category: 'Securities',
    description: 'Audit log of Call Deposit Receipts (CDRs) and Bank Guarantees, issuing banks, validity periods, and release status.',
    parameters: [
      { key: 'status', label: 'Security Status', type: 'select', options: ['All', 'Active', 'Released', 'Pending'] }
    ],
    columns: [
      { key: 'instrument_number', label: 'CDR / Guarantee #', align: 'left', width: '18%' },
      { key: 'bank_name', label: 'Issuing Bank', align: 'left', width: '22%' },
      { key: 'tender_title', label: 'Associated Tender', align: 'left', width: '30%' },
      { key: 'status', label: 'Status', align: 'center', width: '12%' },
      { key: 'amount', label: 'Amount (PKR)', align: 'right', width: '18%', isNumeric: true }
    ]
  },
  {
    key: 'tender_winloss_analytics',
    name: 'Tender Pipeline & Win/Loss Analytics',
    module: 'tender',
    category: 'Analytics',
    description: 'Tender bidding conversion rates, won vs. lost opportunities, and total won contract value.',
    parameters: [
      { key: 'startDate', label: 'From Date', type: 'date' },
      { key: 'endDate', label: 'To Date', type: 'date' }
    ],
    columns: [
      { key: 'title', label: 'Tender Title', align: 'left', width: '35%' },
      { key: 'organization', label: 'Procuring Agency', align: 'left', width: '25%' },
      { key: 'submission_date', label: 'Submission Date', align: 'left', width: '12%' },
      { key: 'status', label: 'Outcome Status', align: 'center', width: '13%' },
      { key: 'estimated_value', label: 'Bid Value (PKR)', align: 'right', width: '15%', isNumeric: true }
    ]
  },

  // 4. CRM & Leads
  {
    key: 'crm_lead_pipeline',
    name: 'CRM Commercial Lead Pipeline',
    module: 'crm',
    category: 'Sales Pipeline',
    description: 'Active commercial leads, customer stages, estimated contract values, and closing probabilities.',
    parameters: [
      { key: 'stage', label: 'Deal Stage', type: 'select', options: ['All', 'Prospect', 'Qualified', 'Proposal', 'Negotiation', 'Won', 'Lost'] }
    ],
    columns: [
      { key: 'title', label: 'Deal / Lead Title', align: 'left', width: '30%' },
      { key: 'company_name', label: 'Prospect Company', align: 'left', width: '25%' },
      { key: 'stage', label: 'Stage', align: 'center', width: '15%' },
      { key: 'lead_source', label: 'Source', align: 'left', width: '12%' },
      { key: 'deal_value', label: 'Estimated Deal (PKR)', align: 'right', width: '18%', isNumeric: true }
    ]
  },

  // 5. HRM & Payroll
  {
    key: 'payroll_monthly_summary',
    name: 'Monthly Payroll & Tax Deduction Register',
    module: 'payroll',
    category: 'Payroll',
    description: 'Employee gross compensation, statutory FBR Sec 149 salary tax deductions, and net disbursed amounts.',
    parameters: [
      { key: 'monthYear', label: 'Payroll Period (YYYY-MM)', type: 'text' }
    ],
    columns: [
      { key: 'employee_code', label: 'Emp ID', align: 'left', width: '12%' },
      { key: 'employee_name', label: 'Employee Name', align: 'left', width: '28%' },
      { key: 'department', label: 'Department', align: 'left', width: '18%' },
      { key: 'gross_salary', label: 'Gross Salary', align: 'right', width: '14%', isNumeric: true },
      { key: 'income_tax_deducted', label: 'FBR Tax (Sec 149)', align: 'right', width: '14%', isNumeric: true },
      { key: 'net_salary', label: 'Net Take-Home', align: 'right', width: '14%', isNumeric: true }
    ]
  },

  // 6. Manufacturing
  {
    key: 'mfg_work_order_summary',
    name: 'Manufacturing Work Order Status & Output',
    module: 'manufacturing',
    category: 'Production',
    description: 'Production batches, target vs completed quantities, work center routing, and batch statuses.',
    parameters: [
      { key: 'status', label: 'Order Status', type: 'select', options: ['All', 'Draft', 'Confirmed', 'In Production', 'Completed', 'Cancelled'] }
    ],
    columns: [
      { key: 'wo_number', label: 'Work Order #', align: 'left', width: '18%' },
      { key: 'product_name', label: 'Assembly / SKU', align: 'left', width: '32%' },
      { key: 'target_qty', label: 'Target Qty', align: 'center', width: '14%', isNumeric: true },
      { key: 'completed_qty', label: 'Completed Qty', align: 'center', width: '14%', isNumeric: true },
      { key: 'status', label: 'Status', align: 'center', width: '22%' }
    ]
  }
];

// GET /api/reports/catalogue — Return available report catalogue
router.get('/catalogue', authenticate, (req, res) => {
  res.json({ success: true, data: REPORT_CATALOGUE });
});

// GET /api/reports/saved-presets — Return saved filter presets
router.get('/saved-presets', authenticate, async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const { report_key } = req.query;
    let sql = `SELECT * FROM saved_report_presets WHERE tenant_id = $1`;
    const params = [tenantId];
    if (report_key && report_key !== 'all') {
      sql += ` AND report_key = $2`;
      params.push(report_key);
    }
    sql += ` ORDER BY created_at DESC`;
    const result = await db.query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/reports/saved-presets — Save a filter configuration preset
router.post('/saved-presets', authenticate, async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const { report_key, preset_name, filters = {}, is_public = false } = req.body;
    if (!report_key || !preset_name) {
      return res.status(400).json({ success: false, message: 'report_key and preset_name are required' });
    }

    const result = await db.query(`
      INSERT INTO saved_report_presets (tenant_id, user_id, report_key, preset_name, filters, is_public)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [tenantId, isUuid(req.user?.id) ? req.user.id : null, report_key, preset_name.trim(), filters, !!is_public]);

    res.status(201).json({ success: true, data: result.rows[0], message: 'Report preset saved' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/reports/saved-presets/:id — Delete a saved preset
router.delete('/saved-presets/:id', authenticate, async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    await db.query(`DELETE FROM saved_report_presets WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true, message: 'Preset deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reports/execution-logs — Audit log of recent report executions
router.get('/execution-logs', authenticate, async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(`
      SELECT rel.*, u.full_name as executed_by_name
      FROM report_execution_logs rel
      LEFT JOIN users u ON rel.user_id = u.id
      WHERE rel.tenant_id = $1
      ORDER BY rel.executed_at DESC
      LIMIT 100
    `, [tenantId]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/reports/execute — Unified Dynamic Report Runner with logging & isolation
router.post('/execute', authenticate, async (req, res) => {
  const startTime = Date.now();
  const tenantId = await resolveTenantId(req, db);
  const { report_key, filters = {} } = req.body;

  const repMeta = REPORT_CATALOGUE.find(r => r.key === report_key);
  if (!repMeta) {
    return res.status(404).json({ success: false, message: `Report "${report_key}" not recognized in catalogue` });
  }

  let rows = [];
  let summary = {};
  let status = 'SUCCESS';
  let errorMessage = null;

  try {
    // 1. Trial Balance
    if (report_key === 'trial_balance') {
      const q = await db.query(`
        SELECT 
          a.account_code, 
          a.account_name, 
          a.account_type,
          COALESCE(SUM(jl.debit), 0) as debit,
          COALESCE(SUM(jl.credit), 0) as credit
        FROM coa_accounts a
        LEFT JOIN journal_entry_lines jl ON a.id = jl.account_id
        LEFT JOIN journal_entries je ON jl.journal_entry_id = je.id AND COALESCE(je.is_posted, TRUE) = TRUE
        WHERE a.tenant_id = $1
        GROUP BY a.id, a.account_code, a.account_name, a.account_type
        ORDER BY a.account_code ASC
      `, [tenantId]);
      rows = q.rows.map(r => ({
        ...r,
        debit: parseFloat(r.debit || 0),
        credit: parseFloat(r.credit || 0)
      }));
      const totalDebit = rows.reduce((acc, r) => acc + r.debit, 0);
      const totalCredit = rows.reduce((acc, r) => acc + r.credit, 0);
      summary = {
        debit: totalDebit,
        credit: totalCredit,
        is_balanced: Math.abs(totalDebit - totalCredit) < 0.01,
        total_accounts: rows.length
      };
    }

    // 2. Receivables Aging
    else if (report_key === 'receivables_aging') {
      const q = await db.query(`
        SELECT 
          c.business_name as customer_name,
          COALESCE(SUM(CASE WHEN CURRENT_DATE - i.invoice_date::date <= 30 THEN (i.total_amount - COALESCE(i.paid_amount, 0)) ELSE 0 END), 0) as current_due,
          COALESCE(SUM(CASE WHEN CURRENT_DATE - i.invoice_date::date BETWEEN 31 AND 60 THEN (i.total_amount - COALESCE(i.paid_amount, 0)) ELSE 0 END), 0) as days_31_60,
          COALESCE(SUM(CASE WHEN CURRENT_DATE - i.invoice_date::date BETWEEN 61 AND 90 THEN (i.total_amount - COALESCE(i.paid_amount, 0)) ELSE 0 END), 0) as days_61_90,
          COALESCE(SUM(CASE WHEN CURRENT_DATE - i.invoice_date::date > 90 THEN (i.total_amount - COALESCE(i.paid_amount, 0)) ELSE 0 END), 0) as days_over_90
        FROM customers c
        JOIN invoices i ON c.id = i.customer_id
        WHERE i.tenant_id = $1 AND i.status != 'Paid'
        GROUP BY c.id, c.business_name
        ORDER BY c.business_name ASC
      `, [tenantId]);
      rows = q.rows.map(r => ({
        customer_name: r.customer_name,
        current_due: parseFloat(r.current_due || 0),
        days_31_60: parseFloat(r.days_31_60 || 0),
        days_61_90: parseFloat(r.days_61_90 || 0),
        days_over_90: parseFloat(r.days_over_90 || 0)
      }));
      summary = {
        current_due: rows.reduce((acc, r) => acc + r.current_due, 0),
        days_31_60: rows.reduce((acc, r) => acc + r.days_31_60, 0),
        days_61_90: rows.reduce((acc, r) => acc + r.days_61_90, 0),
        days_over_90: rows.reduce((acc, r) => acc + r.days_over_90, 0)
      };
    }

    // 3. FBR Tax Withholding Register
    else if (report_key === 'tax_withholding_fbr') {
      const q = await db.query(`
        SELECT 
          i.invoice_number,
          TO_CHAR(i.invoice_date, 'YYYY-MM-DD') as invoice_date,
          c.business_name as customer_name,
          COALESCE(i.subtotal, i.total_amount / 1.18) as taxable_value,
          COALESCE(i.tax_amount, i.total_amount - (i.total_amount / 1.18)) as sales_tax_amount,
          i.total_amount
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        WHERE i.tenant_id = $1
        ORDER BY i.invoice_date DESC
        LIMIT 200
      `, [tenantId]);
      rows = q.rows.map(r => ({
        ...r,
        taxable_value: parseFloat(r.taxable_value || 0),
        sales_tax_amount: parseFloat(r.sales_tax_amount || 0),
        total_amount: parseFloat(r.total_amount || 0)
      }));
      summary = {
        taxable_value: rows.reduce((acc, r) => acc + r.taxable_value, 0),
        sales_tax_amount: rows.reduce((acc, r) => acc + r.sales_tax_amount, 0),
        total_amount: rows.reduce((acc, r) => acc + r.total_amount, 0)
      };
    }

    // 4. Stock Valuation Ledger
    else if (report_key === 'stock_valuation') {
      const q = await db.query(`
        SELECT 
          sku, 
          name, 
          COALESCE(category, 'General') as category,
          COALESCE(current_stock, 0) as current_stock,
          (COALESCE(current_stock, 0) * COALESCE(cost_price, 0)) as valuation_pkr
        FROM products_services
        WHERE tenant_id = $1
        ORDER BY valuation_pkr DESC
      `, [tenantId]);
      rows = q.rows.map(r => ({
        ...r,
        current_stock: parseFloat(r.current_stock || 0),
        valuation_pkr: parseFloat(r.valuation_pkr || 0)
      }));
      summary = {
        current_stock: rows.reduce((acc, r) => acc + r.current_stock, 0),
        valuation_pkr: rows.reduce((acc, r) => acc + r.valuation_pkr, 0),
        total_skus: rows.length
      };
    }

    // 5. Low Stock Register
    else if (report_key === 'low_stock_reorder') {
      const q = await db.query(`
        SELECT 
          sku, 
          name, 
          COALESCE(current_stock, 0) as current_stock,
          COALESCE(reorder_point, 5) as reorder_level,
          GREATEST(0, COALESCE(reorder_point, 5) - COALESCE(current_stock, 0)) as stock_deficit
        FROM products_services
        WHERE tenant_id = $1 AND COALESCE(current_stock, 0) <= COALESCE(reorder_point, 5)
        ORDER BY stock_deficit DESC
      `, [tenantId]);
      rows = q.rows.map(r => ({
        ...r,
        current_stock: parseFloat(r.current_stock || 0),
        reorder_level: parseFloat(r.reorder_level || 0),
        stock_deficit: parseFloat(r.stock_deficit || 0)
      }));
      summary = {
        critical_items_count: rows.length,
        total_deficit: rows.reduce((acc, r) => acc + r.stock_deficit, 0)
      };
    }

    // 6. Bid Securities Register
    else if (report_key === 'bid_securities_register') {
      const q = await db.query(`
        SELECT 
          bs.instrument_number,
          bs.bank_name,
          COALESCE(o.title, 'General Procurement') as tender_title,
          bs.status,
          bs.amount
        FROM bid_securities bs
        LEFT JOIN opportunities o ON bs.tender_id = o.id
        WHERE bs.tenant_id = $1
        ORDER BY bs.created_at DESC
      `, [tenantId]);
      rows = q.rows.map(r => ({
        ...r,
        amount: parseFloat(r.amount || 0)
      }));
      summary = {
        amount: rows.reduce((acc, r) => acc + r.amount, 0),
        active_count: rows.filter(r => r.status === 'Active' || r.status === 'Submitted').length
      };
    }

    // 7. Tender Win/Loss Analytics
    else if (report_key === 'tender_winloss_analytics') {
      const q = await db.query(`
        SELECT 
          title,
          COALESCE(organization, 'Government Agency') as organization,
          TO_CHAR(submission_date, 'YYYY-MM-DD') as submission_date,
          status,
          COALESCE(estimated_value, 0) as estimated_value
        FROM opportunities
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 100
      `, [tenantId]);
      rows = q.rows.map(r => ({
        ...r,
        estimated_value: parseFloat(r.estimated_value || 0)
      }));
      const totalVal = rows.reduce((acc, r) => acc + r.estimated_value, 0);
      const wonVal = rows.filter(r => String(r.status).toLowerCase() === 'won').reduce((acc, r) => acc + r.estimated_value, 0);
      summary = {
        estimated_value: totalVal,
        won_value: wonVal,
        total_tenders: rows.length,
        win_rate_pct: rows.length > 0 ? ((rows.filter(r => String(r.status).toLowerCase() === 'won').length / rows.length) * 100).toFixed(1) : '0.0'
      };
    }

    // 8. CRM Lead Pipeline
    else if (report_key === 'crm_lead_pipeline') {
      const q = await db.query(`
        SELECT 
          title,
          COALESCE(company_name, 'Direct Client') as company_name,
          stage,
          lead_source,
          COALESCE(estimated_deal_value, 0) as deal_value
        FROM crm_leads
        WHERE tenant_id = $1
        ORDER BY estimated_deal_value DESC
      `, [tenantId]);
      rows = q.rows.map(r => ({
        ...r,
        deal_value: parseFloat(r.deal_value || 0)
      }));
      summary = {
        deal_value: rows.reduce((acc, r) => acc + r.deal_value, 0),
        total_leads: rows.length
      };
    }

    // 9. Payroll Monthly Summary
    else if (report_key === 'payroll_monthly_summary') {
      const q = await db.query(`
        SELECT 
          e.employee_code,
          (e.first_name || ' ' || e.last_name) as employee_name,
          COALESCE(e.department, 'Operations') as department,
          COALESCE(p.gross_salary, e.base_salary, 0) as gross_salary,
          COALESCE(p.tax_withheld, 0) as income_tax_deducted,
          COALESCE(p.net_salary, e.base_salary, 0) as net_salary
        FROM hrm_employees e
        LEFT JOIN (
          SELECT employee_id, gross_salary, tax_withheld, net_salary
          FROM payroll_payslips
          ORDER BY created_at DESC
        ) p ON e.id = p.employee_id
        WHERE e.tenant_id = $1 AND e.employment_status = 'Active'
        ORDER BY e.employee_code ASC
      `, [tenantId]);
      rows = q.rows.map(r => ({
        ...r,
        gross_salary: parseFloat(r.gross_salary || 0),
        income_tax_deducted: parseFloat(r.income_tax_deducted || 0),
        net_salary: parseFloat(r.net_salary || 0)
      }));
      summary = {
        gross_salary: rows.reduce((acc, r) => acc + r.gross_salary, 0),
        income_tax_deducted: rows.reduce((acc, r) => acc + r.income_tax_deducted, 0),
        net_salary: rows.reduce((acc, r) => acc + r.net_salary, 0),
        employee_count: rows.length
      };
    }

    // 10. Manufacturing Work Order Summary
    else if (report_key === 'mfg_work_order_summary') {
      const q = await db.query(`
        SELECT 
          wo.work_order_number as wo_number,
          p.name as product_name,
          wo.quantity_to_produce as target_qty,
          wo.quantity_produced as completed_qty,
          wo.status
        FROM mfg_work_orders wo
        LEFT JOIN products_services p ON wo.product_id = p.id
        WHERE wo.tenant_id = $1
        ORDER BY wo.created_at DESC
      `, [tenantId]);
      rows = q.rows.map(r => ({
        ...r,
        target_qty: parseFloat(r.target_qty || 0),
        completed_qty: parseFloat(r.completed_qty || 0)
      }));
      summary = {
        target_qty: rows.reduce((acc, r) => acc + r.target_qty, 0),
        completed_qty: rows.reduce((acc, r) => acc + r.completed_qty, 0),
        total_orders: rows.length
      };
    }

  } catch (err) {
    status = 'FAILED';
    errorMessage = err.message;
    console.error(`Report execution error (${report_key}):`, err);
  }

  const executionTimeMs = Date.now() - startTime;

  // Log execution asynchronously for audit & diagnostics
  try {
    await db.query(`
      INSERT INTO report_execution_logs (
        tenant_id, user_id, report_key, report_name, parameters, execution_time_ms, rows_count, status, error_message
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      tenantId, isUuid(req.user?.id) ? req.user.id : null,
      report_key, repMeta.name, filters, executionTimeMs, rows.length, status, errorMessage
    ]);
  } catch (logErr) {
    console.warn('Failed to insert report execution log:', logErr.message);
  }

  if (status === 'FAILED') {
    return res.status(500).json({ success: false, message: errorMessage });
  }

  res.json({
    success: true,
    data: {
      report_key,
      report_name: repMeta.name,
      module: repMeta.module,
      columns: repMeta.columns,
      rows,
      summary,
      execution_time_ms: executionTimeMs,
      rows_count: rows.length
    }
  });
});

// GET Executive Dashboard KPIs
router.get('/dashboard-kpis', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id } = req.query;

  try {
    let whereClauses = [];
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        whereClauses.push(`tenant_id::text = $${params.length}`);
      }
    } else {
      return res.json({
        success: true,
        data: {
          tenders: { total_tenders: 0, in_process: 0, won_count: 0, lost_count: 0, closed_count: 0, total_pipeline_value: 0 },
          bidSecurities: { active_securities_count: 0, active_securities_amount: 0, released_securities_count: 0, pending_securities_count: 0 },
          supply: { total_dcs: 0, delivered_dcs: 0, in_transit_dcs: 0, pending_dcs: 0 },
          financials: { total_invoiced: 0, total_collected: 0, total_receivables: 0, paid_invoices_count: 0, pending_invoices_count: 0 },
          expenses: { total_expenses: 0 }
        }
      });
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      whereClauses.push(`business_profile_id = $${params.length}`);
    }

    const filterClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 1. Tender Status Summary
    const oppSummaryRes = await db.query(`
      SELECT 
        COUNT(*) as total_tenders,
        COUNT(*) FILTER (WHERE status IN ('New', 'Under Review', 'Selected', 'Bid Preparation', 'Ready to submit', 'Submitted')) as in_process,
        COUNT(*) FILTER (WHERE LOWER(status) = 'won') as won_count,
        COUNT(*) FILTER (WHERE LOWER(status) IN ('loose', 'lost')) as lost_count,
        COUNT(*) FILTER (WHERE LOWER(status) IN ('withdraw', 'withdrawn', 'cancelled', 'rejected')) as closed_count,
        COALESCE(SUM(estimated_value), 0) as total_pipeline_value
      FROM opportunities ${filterClause}
    `, params);

    // 2. Bid Security Summary
    const secSummaryRes = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status IN ('Active', 'Submitted')) as active_securities_count,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('Active', 'Submitted')), 0) as active_securities_amount,
        COUNT(*) FILTER (WHERE status = 'Released') as released_securities_count,
        COUNT(*) FILTER (WHERE status = 'Pending') as pending_securities_count
      FROM bid_securities ${filterClause}
    `, params);

    // 3. Supply & DC Status
    const dcSummaryRes = await db.query(`
      SELECT 
        COUNT(*) as total_dcs,
        COUNT(*) FILTER (WHERE status = 'Delivered') as delivered_dcs,
        COUNT(*) FILTER (WHERE status IN ('Dispatched', 'In_Transit')) as in_transit_dcs,
        COUNT(*) FILTER (WHERE status = 'Pending') as pending_dcs
      FROM delivery_challans ${filterClause}
    `, params);

    // 4. Financial & Invoicing
    const invSummaryRes = await db.query(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as total_invoiced,
        COALESCE(SUM(paid_amount), 0) as total_collected,
        COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as total_receivables,
        COUNT(*) FILTER (WHERE status = 'Paid') as paid_invoices_count,
        COUNT(*) FILTER (WHERE status IN ('Submitted', 'Reinvoicing', 'Pending', 'Hold')) as pending_invoices_count
      FROM invoices ${filterClause}
    `, params);

    // 5. Total Expenses
    const expSummaryRes = await db.query(`
      SELECT COALESCE(SUM(amount), 0) as total_expenses FROM general_expenses ${filterClause}
    `, params);

      res.json({
      success: true,
      data: {
        tenders: oppSummaryRes.rows[0],
        bidSecurities: secSummaryRes.rows[0],
        supply: dcSummaryRes.rows[0],
        financials: invSummaryRes.rows[0],
        expenses: expSummaryRes.rows[0]
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Consolidated Real-Time Dashboard Bundle (Single Round-Trip, Zero Data Caching)
router.get('/dashboard-bundle', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id } = req.query;

  try {
    let whereClauses = [];
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        whereClauses.push(`tenant_id::text = $${params.length}`);
      }
    } else {
      return res.json({ success: true, data: { kpis: {}, invoices: [], payments: [], expenses: [], products: [], customers: [], dcs: [], pos: [], securities: [] } });
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      whereClauses.push(`business_profile_id = $${params.length}`);
    }

    const filterClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [
      oppSummaryRes,
      secSummaryRes,
      dcSummaryRes,
      invSummaryRes,
      expSummaryRes,
      invoicesRes,
      paymentsRes,
      expensesRes,
      productsRes,
      customersRes,
      dcsRes,
      posRes,
      securitiesRes
    ] = await Promise.all([
      db.query(`
        SELECT 
          COUNT(*) as total_tenders,
          COUNT(*) FILTER (WHERE status IN ('New', 'Under Review', 'Selected', 'Bid Preparation', 'Ready to submit', 'Submitted')) as in_process,
          COUNT(*) FILTER (WHERE LOWER(status) = 'won') as won_count,
          COUNT(*) FILTER (WHERE LOWER(status) IN ('loose', 'lost')) as lost_count,
          COUNT(*) FILTER (WHERE LOWER(status) IN ('withdraw', 'withdrawn', 'cancelled', 'rejected')) as closed_count,
          COALESCE(SUM(estimated_value), 0) as total_pipeline_value
        FROM opportunities ${filterClause}
      `, params).catch(() => ({ rows: [{}] })),

      db.query(`
        SELECT 
          COUNT(*) FILTER (WHERE status IN ('Active', 'Submitted')) as active_securities_count,
          COALESCE(SUM(amount) FILTER (WHERE status IN ('Active', 'Submitted')), 0) as active_securities_amount,
          COUNT(*) FILTER (WHERE status = 'Released') as released_securities_count,
          COUNT(*) FILTER (WHERE status = 'Pending') as pending_securities_count
        FROM bid_securities ${filterClause}
      `, params).catch(() => ({ rows: [{}] })),

      db.query(`
        SELECT 
          COUNT(*) as total_dcs,
          COUNT(*) FILTER (WHERE status = 'Delivered') as delivered_dcs,
          COUNT(*) FILTER (WHERE status IN ('Dispatched', 'In_Transit')) as in_transit_dcs,
          COUNT(*) FILTER (WHERE status = 'Pending') as pending_dcs
        FROM delivery_challans ${filterClause}
      `, params).catch(() => ({ rows: [{}] })),

      db.query(`
        SELECT 
          COALESCE(SUM(total_amount), 0) as total_invoiced,
          COALESCE(SUM(paid_amount), 0) as total_collected,
          COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as total_receivables,
          COUNT(*) FILTER (WHERE status = 'Paid') as paid_invoices_count,
          COUNT(*) FILTER (WHERE status IN ('Submitted', 'Reinvoicing', 'Pending', 'Hold')) as pending_invoices_count
        FROM invoices ${filterClause}
      `, params).catch(() => ({ rows: [{}] })),

      db.query(`
        SELECT COALESCE(SUM(amount), 0) as total_expenses FROM general_expenses ${filterClause}
      `, params).catch(() => ({ rows: [{}] })),

      db.query(`
        SELECT i.*, 
               COALESCE(bp.business_name, '') as business_name, 
               COALESCE(c.business_name, '') as customer_name,
               (i.total_amount - COALESCE(i.paid_amount, 0)) as outstanding_amount
        FROM invoices i
        LEFT JOIN business_profiles bp ON i.business_profile_id = bp.id
        LEFT JOIN customers c ON i.customer_id = c.id
        ${filterClause}
        ORDER BY i.created_at DESC LIMIT 50
      `, params).catch(() => ({ rows: [] })),

      db.query(`
        SELECT p.*, i.invoice_number, COALESCE(c.business_name, '') as customer_name
        FROM payments p
        LEFT JOIN invoices i ON p.invoice_id = i.id
        LEFT JOIN customers c ON i.customer_id = c.id
        ${filterClause.replace(/business_profile_id/g, 'p.business_profile_id').replace(/tenant_id/g, 'p.tenant_id')}
        ORDER BY p.payment_date DESC LIMIT 50
      `, params).catch(() => ({ rows: [] })),

      db.query(`
        SELECT * FROM general_expenses ${filterClause} ORDER BY expense_date DESC LIMIT 50
      `, params).catch(() => ({ rows: [] })),

      db.query(`
        SELECT * FROM products_services ${filterClause} ORDER BY name ASC LIMIT 100
      `, params).catch(() => ({ rows: [] })),

      db.query(`
        SELECT * FROM customers 
        ${whereClauses.length > 0 ? `WHERE ${whereClauses[0]}` : ''}
        ORDER BY business_name ASC LIMIT 100
      `, params.slice(0, 1)).catch(() => ({ rows: [] })),

      db.query(`
        SELECT dc.*, COALESCE(c.business_name, '') as customer_name
        FROM delivery_challans dc
        LEFT JOIN customers c ON dc.customer_id = c.id
        ${filterClause}
        ORDER BY dc.created_at DESC LIMIT 50
      `, params).catch(() => ({ rows: [] })),

      db.query(`
        SELECT po.*, COALESCE(c.business_name, '') as customer_name
        FROM purchase_orders po
        LEFT JOIN customers c ON po.customer_id = c.id
        ${filterClause}
        ORDER BY po.created_at DESC LIMIT 50
      `, params).catch(() => ({ rows: [] })),

      db.query(`
        SELECT * FROM bid_securities ${filterClause} ORDER BY created_at DESC LIMIT 50
      `, params).catch(() => ({ rows: [] }))
    ]);

    res.json({
      success: true,
      data: {
        kpis: {
          tenders: oppSummaryRes.rows[0] || {},
          bidSecurities: secSummaryRes.rows[0] || {},
          supply: dcSummaryRes.rows[0] || {},
          financials: invSummaryRes.rows[0] || {},
          expenses: expSummaryRes.rows[0] || {}
        },
        invoices: invoicesRes.rows || [],
        payments: paymentsRes.rows || [],
        expenses: expensesRes.rows || [],
        products: productsRes.rows || [],
        customers: customersRes.rows || [],
        dcs: dcsRes.rows || [],
        pos: posRes.rows || [],
        securities: securitiesRes.rows || []
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Contract-Wise Profitability Report
router.get('/contract-profitability', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  try {
    let query = `
      SELECT 
        cnt.id as contract_id,
        cnt.contract_number,
        c.business_name as customer_name,
        c.org_type as customer_org_type,
        bp.business_name,
        cnt.contract_value,
        COALESCE((SELECT SUM(po.net_amount) FROM purchase_orders po WHERE po.contract_id = cnt.id), 0) as po_value,
        COALESCE((SELECT SUM(inv.total_amount) FROM invoices inv WHERE inv.contract_id = cnt.id), 0) as invoiced_amount,
        COALESCE((SELECT SUM(inv.paid_amount) FROM invoices inv WHERE inv.contract_id = cnt.id), 0) as received_payment,
        COALESCE((SELECT SUM(ge.amount) FROM general_expenses ge WHERE ge.contract_id = cnt.id), 0) as allocated_expenses,
        cnt.status as contract_status
      FROM contracts cnt
      JOIN customers c ON cnt.customer_id = c.id
      JOIN business_profiles bp ON cnt.business_profile_id = bp.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        query += ` AND cnt.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    query += ` ORDER BY cnt.created_at DESC`;
    const result = await db.query(query, params);

    const formatted = result.rows.map(row => {
      const cVal = parseFloat(row.contract_value || 0);
      const invoiced = parseFloat(row.invoiced_amount || 0);
      const paid = parseFloat(row.received_payment || 0);
      const expenses = parseFloat(row.allocated_expenses || 0);
      const estCost = parseFloat(row.po_value || 0) * 0.75; // Approx cost baseline
      const netProfit = (invoiced > 0 ? invoiced : cVal) - estCost - expenses;
      const profitMarginPct = cVal > 0 ? ((netProfit / cVal) * 100) : 0;

      return {
        ...row,
        estimated_cost: estCost,
        net_profit: netProfit,
        profit_margin_pct: profitMarginPct.toFixed(1),
        outstanding_receivable: Math.max(0, invoiced - paid)
      };
    });

    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Pending Bills & Aging Report
router.get('/pending-bills', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  try {
    let query = `
      SELECT 
        inv.id,
        inv.invoice_number,
        inv.invoice_date,
        inv.due_date,
        c.business_name as customer_name,
        c.org_type as customer_org_type,
        bp.business_name,
        inv.total_amount,
        inv.paid_amount,
        (inv.total_amount - COALESCE(inv.paid_amount, 0)) as outstanding_amount,
        (CURRENT_DATE - inv.invoice_date) as days_outstanding,
        inv.status,
        inv.fbr_status
      FROM invoices inv
      JOIN customers c ON inv.customer_id = c.id
      JOIN business_profiles bp ON inv.business_profile_id = bp.id
      WHERE (inv.total_amount - COALESCE(inv.paid_amount, 0)) > 0
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        query += ` AND inv.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    query += ` ORDER BY days_outstanding DESC`;
    const result = await db.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Helper for safe date parsing in filters
function parseFilterDate(dStr) {
  if (!dStr) return null;
  const s = String(dStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// -----------------------------------------------------------------------------
// 1. EXECUTIVE REPORT: BID SECURITIES & PERFORMANCE GUARANTEES
// Shows: Paid/Blocked in banks vs Released/Got Back, expiry alerts, tender vs quotation
// -----------------------------------------------------------------------------
router.get('/bid-securities-and-guarantees', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id, start_date, end_date, scope, status, instrument_filter } = req.query;

  try {
    const tid = (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') 
      ? (req.user.tenantId || '00000000-0000-0000-0000-000000000000') 
      : null;

    let params = [];
    let secWhere = [];
    let guarWhere = [];

    if (tid) {
      params.push(tid);
      secWhere.push(`bs.tenant_id::text = $${params.length}`);
      guarWhere.push(`pg.tenant_id::text = $${params.length}`);
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      secWhere.push(`(bs.business_profile_id::text = $${params.length} OR o.business_profile_id::text = $${params.length})`);
      guarWhere.push(`(pg.business_profile_id::text = $${params.length} OR o.business_profile_id::text = $${params.length})`);
    }

    const sDate = parseFilterDate(start_date);
    if (sDate) {
      params.push(sDate);
      secWhere.push(`COALESCE(bs.issue_date, bs.created_at::date) >= $${params.length}`);
      guarWhere.push(`COALESCE(pg.issue_date, pg.created_at::date) >= $${params.length}`);
    }

    const eDate = parseFilterDate(end_date);
    if (eDate) {
      params.push(eDate);
      secWhere.push(`COALESCE(bs.issue_date, bs.created_at::date) <= $${params.length}`);
      guarWhere.push(`COALESCE(pg.issue_date, pg.created_at::date) <= $${params.length}`);
    }

    if (scope === 'tender') {
      secWhere.push(`(o.is_quotation IS NOT TRUE OR o.id IS NULL)`);
      guarWhere.push(`(o.is_quotation IS NOT TRUE OR o.id IS NULL)`);
    } else if (scope === 'quotation') {
      secWhere.push(`(o.is_quotation IS TRUE)`);
      guarWhere.push(`(o.is_quotation IS TRUE)`);
    }

    if (status && status !== 'all') {
      params.push(status);
      secWhere.push(`LOWER(bs.status) = LOWER($${params.length})`);
      guarWhere.push(`LOWER(pg.status) = LOWER($${params.length})`);
    }

    const secClause = secWhere.length > 0 ? `WHERE ${secWhere.join(' AND ')}` : '';
    const guarClause = guarWhere.length > 0 ? `WHERE ${guarWhere.join(' AND ')}` : '';

    let unionParts = [];

    if (!instrument_filter || instrument_filter === 'all' || instrument_filter === 'bid_security') {
      unionParts.push(`
        SELECT 
          bs.id,
          'Bid Security (CDR/EMD)' as report_category,
          bs.instrument_type,
          bs.instrument_number,
          bs.account_title,
          bs.beneficiary,
          bs.bank_name,
          bs.bank_branch,
          COALESCE(bs.amount, 0) as amount,
          bs.issue_date,
          bs.expiry_date,
          bs.status,
          bs.comments,
          bs.business_profile_id,
          COALESCE(bp.business_name, 'Primary Entity') as business_name,
          COALESCE(o.opportunity_number, 'Tender Ref') as reference_number,
          COALESCE(o.tender_name, o.title, 'Bid Security Dossier') as project_title,
          COALESCE(c.business_name, 'Client Department') as customer_name,
          COALESCE(o.is_quotation, FALSE) as is_quotation,
          (bs.expiry_date - CURRENT_DATE) as days_to_expiry,
          bs.created_at
        FROM bid_securities bs
        LEFT JOIN opportunities o ON bs.opportunity_id = o.id
        LEFT JOIN business_profiles bp ON bs.business_profile_id = bp.id
        LEFT JOIN customers c ON o.customer_id = c.id
        ${secClause}
      `);
    }

    if (!instrument_filter || instrument_filter === 'all' || instrument_filter === 'guarantee') {
      unionParts.push(`
        SELECT 
          pg.id,
          'Performance Guarantee (PBG)' as report_category,
          COALESCE(pg.instrument_type, 'Performance Bond') as instrument_type,
          COALESCE(pg.instrument_number, pg.guarantee_number, 'PBG') as instrument_number,
          pg.account_title,
          pg.beneficiary,
          pg.bank_name,
          pg.bank_branch,
          COALESCE(pg.amount, 0) as amount,
          pg.issue_date,
          pg.expiry_date,
          pg.status,
          COALESCE(pg.comments, pg.remarks) as comments,
          pg.business_profile_id,
          COALESCE(bp.business_name, 'Primary Entity') as business_name,
          COALESCE(cnt.contract_number, o.opportunity_number, 'Contract Ref') as reference_number,
          COALESCE(o.tender_name, o.title, 'Performance Guarantee') as project_title,
          COALESCE(c.business_name, 'Contract Client') as customer_name,
          COALESCE(o.is_quotation, FALSE) as is_quotation,
          (pg.expiry_date - CURRENT_DATE) as days_to_expiry,
          pg.created_at
        FROM performance_guarantees pg
        LEFT JOIN contracts cnt ON pg.contract_id = cnt.id
        LEFT JOIN opportunities o ON pg.opportunity_id = o.id OR cnt.opportunity_id = o.id
        LEFT JOIN business_profiles bp ON pg.business_profile_id = bp.id OR cnt.business_profile_id = bp.id
        LEFT JOIN customers c ON o.customer_id = c.id OR cnt.customer_id = c.id
        ${guarClause}
      `);
    }

    const finalQuery = unionParts.join(' UNION ALL ') + ` ORDER BY expiry_date ASC NULLS LAST, created_at DESC`;
    const result = await db.query(finalQuery, params);
    const rows = result.rows;

    let totalPaidBlocked = 0;
    let totalReleasedRecovered = 0;
    let expiringSoonCount = 0;
    let pendingCount = 0;

    rows.forEach(r => {
      const amt = parseFloat(r.amount) || 0;
      const st = String(r.status || '').toLowerCase();
      if (st === 'active' || st === 'submitted') {
        totalPaidBlocked += amt;
      } else if (st === 'released' || st === 'returned') {
        totalReleasedRecovered += amt;
      } else if (st === 'pending') {
        pendingCount++;
        totalPaidBlocked += amt;
      }
      if (r.days_to_expiry !== null && r.days_to_expiry <= 30 && r.days_to_expiry >= 0 && st !== 'released') {
        expiringSoonCount++;
      }
    });

    const totalInstrumentsAmount = totalPaidBlocked + totalReleasedRecovered;
    const recoveryRatePct = totalInstrumentsAmount > 0 ? ((totalReleasedRecovered / totalInstrumentsAmount) * 100).toFixed(1) : '0.0';

    res.json({
      success: true,
      data: rows,
      summary: {
        total_count: rows.length,
        total_paid_blocked: totalPaidBlocked,
        total_released_recovered: totalReleasedRecovered,
        total_exposure: totalInstrumentsAmount,
        recovery_rate_pct: recoveryRatePct,
        expiring_soon_count: expiringSoonCount,
        pending_count: pendingCount
      }
    });
  } catch (err) {
    console.error('Bid Securities and Guarantees Report Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 2. EXECUTIVE REPORT: EXPENSES LEDGER & 3-TIER BREAKDOWN
// -----------------------------------------------------------------------------
router.get('/expenses-ledger', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id, start_date, end_date, scope, tier, category, customer_id, tender_id, quotation_id, opportunity_id } = req.query;

  try {
    let where = [];
    let params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      where.push(`ge.tenant_id::text = $${params.length}`);
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      where.push(`ge.business_profile_id::text = $${params.length}`);
    }

    const sDate = parseFilterDate(start_date);
    if (sDate) {
      params.push(sDate);
      where.push(`COALESCE(ge.expense_date, ge.created_at::date) >= $${params.length}`);
    }

    const eDate = parseFilterDate(end_date);
    if (eDate) {
      params.push(eDate);
      where.push(`COALESCE(ge.expense_date, ge.created_at::date) <= $${params.length}`);
    }

    if (scope === 'tender') {
      where.push(`(o.is_quotation IS NOT TRUE AND ge.opportunity_id IS NOT NULL)`);
    } else if (scope === 'quotation') {
      where.push(`(o.is_quotation IS TRUE AND ge.opportunity_id IS NOT NULL)`);
    }

    if (tier && tier !== 'all') {
      params.push(tier);
      where.push(`ge.expense_tier ILIKE $${params.length} || '%'`);
    }

    if (category && category !== 'all') {
      params.push(category);
      where.push(`ge.category = $${params.length}`);
    }

    // Customer filter: match direct expense customer, or customer on linked opportunity/PO/contract
    if (customer_id && customer_id !== 'all') {
      params.push(customer_id);
      const cIdx = params.length;
      where.push(`(
        ge.customer_id::text = $${cIdx} OR 
        o.customer_id::text = $${cIdx} OR 
        po.customer_id::text = $${cIdx} OR 
        po_o.customer_id::text = $${cIdx} OR 
        cnt.customer_id::text = $${cIdx}
      )`);
    }

    // Tender / Quotation / Opportunity filters
    const targetTender = tender_id && tender_id !== 'all' ? tender_id : null;
    const targetQuote = quotation_id && quotation_id !== 'all' ? quotation_id : null;
    const targetOpp = opportunity_id && opportunity_id !== 'all' ? opportunity_id : null;

    if (targetTender && targetQuote) {
      params.push(targetTender, targetQuote);
      const tIdx = params.length - 1;
      const qIdx = params.length;
      where.push(`(
        ge.opportunity_id::text IN ($${tIdx}, $${qIdx}) OR 
        po.opportunity_id::text IN ($${tIdx}, $${qIdx}) OR 
        cnt.opportunity_id::text IN ($${tIdx}, $${qIdx})
      )`);
    } else {
      const singleTarget = targetTender || targetQuote || targetOpp;
      if (singleTarget) {
        params.push(singleTarget);
        const idx = params.length;
        where.push(`(
          ge.opportunity_id::text = $${idx} OR 
          po.opportunity_id::text = $${idx} OR 
          cnt.opportunity_id::text = $${idx}
        )`);
      }
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const query = `
      SELECT 
        ge.*,
        bp.business_name,
        o.opportunity_number,
        o.tender_name,
        o.is_quotation,
        po.po_number,
        cnt.contract_number,
        dc.dc_number,
        COALESCE(c_direct.business_name, c_opp.business_name, c_po.business_name, c_cnt.business_name) as customer_name,
        COALESCE(ge.customer_id, o.customer_id, po.customer_id, cnt.customer_id) as effective_customer_id
      FROM general_expenses ge
      LEFT JOIN business_profiles bp ON ge.business_profile_id = bp.id
      LEFT JOIN opportunities o ON ge.opportunity_id = o.id
      LEFT JOIN purchase_orders po ON ge.purchase_order_id = po.id
      LEFT JOIN opportunities po_o ON po.opportunity_id = po_o.id
      LEFT JOIN contracts cnt ON ge.contract_id = cnt.id
      LEFT JOIN delivery_challans dc ON ge.delivery_challan_id = dc.id
      LEFT JOIN customers c_direct ON ge.customer_id = c_direct.id
      LEFT JOIN customers c_opp ON o.customer_id = c_opp.id
      LEFT JOIN customers c_po ON po.customer_id = c_po.id
      LEFT JOIN customers c_cnt ON cnt.customer_id = c_cnt.id
      ${whereClause}
      ORDER BY ge.expense_date DESC NULLS LAST, ge.created_at DESC
    `;

    const result = await db.query(query, params);
    const rows = result.rows;

    let tier1Total = 0;
    let tier2Total = 0;
    let tier3Total = 0;
    const catMap = {};

    rows.forEach(e => {
      const amt = parseFloat(e.amount) || 0;
      const t = String(e.expense_tier || '');
      if (t.includes('Tier 1') || e.opportunity_id) {
        tier1Total += amt;
      } else if (t.includes('Tier 2') || e.purchase_order_id || e.delivery_challan_id) {
        tier2Total += amt;
      } else {
        tier3Total += amt;
      }

      const c = e.category || 'General Operations';
      catMap[c] = (catMap[c] || 0) + amt;
    });

    const totalExpenses = tier1Total + tier2Total + tier3Total;

    res.json({
      success: true,
      data: rows,
      summary: {
        total_count: rows.length,
        total_expenses: totalExpenses,
        tier1_total: tier1Total,
        tier2_total: tier2Total,
        tier3_total: tier3Total,
        category_breakdown: Object.entries(catMap).map(([name, amount]) => ({ name, amount })).sort((a,b) => b.amount - a.amount)
      }
    });
  } catch (err) {
    console.error('Expenses Ledger Report Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 3. EXECUTIVE REPORT: PENDING RECEIVABLES & AGING BREAKDOWN
// -----------------------------------------------------------------------------
router.get('/pending-receivables', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id, customer_id, start_date, end_date, scope, aging_bracket } = req.query;

  try {
    let where = [`(inv.total_amount - COALESCE(inv.paid_amount, 0)) > 0`];
    let params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      where.push(`inv.tenant_id::text = $${params.length}`);
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      where.push(`inv.business_profile_id::text = $${params.length}`);
    }

    if (customer_id && customer_id !== 'all') {
      params.push(customer_id);
      where.push(`inv.customer_id::text = $${params.length}`);
    }

    const sDate = parseFilterDate(start_date);
    if (sDate) {
      params.push(sDate);
      where.push(`COALESCE(inv.invoice_date, inv.created_at::date) >= $${params.length}`);
    }

    const eDate = parseFilterDate(end_date);
    if (eDate) {
      params.push(eDate);
      where.push(`COALESCE(inv.invoice_date, inv.created_at::date) <= $${params.length}`);
    }

    if (scope === 'tender') {
      where.push(`(o.is_quotation IS NOT TRUE OR cnt.id IS NOT NULL)`);
    } else if (scope === 'quotation') {
      where.push(`(o.is_quotation IS TRUE)`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;

    const query = `
      SELECT 
        inv.id,
        inv.invoice_number,
        inv.invoice_date,
        inv.due_date,
        c.business_name as customer_name,
        c.org_type as customer_org_type,
        bp.business_name,
        inv.total_amount,
        COALESCE(inv.paid_amount, 0) as paid_amount,
        (inv.total_amount - COALESCE(inv.paid_amount, 0)) as outstanding_amount,
        (CURRENT_DATE - inv.invoice_date) as days_outstanding,
        CASE WHEN inv.due_date IS NOT NULL THEN (CURRENT_DATE - inv.due_date) ELSE (CURRENT_DATE - inv.invoice_date) END as days_overdue,
        inv.status,
        inv.fbr_status,
        COALESCE(cnt.contract_number, po.po_number, o.opportunity_number, 'Direct') as project_ref,
        COALESCE(o.is_quotation, FALSE) as is_quotation
      FROM invoices inv
      JOIN customers c ON inv.customer_id = c.id
      JOIN business_profiles bp ON inv.business_profile_id = bp.id
      LEFT JOIN contracts cnt ON inv.contract_id = cnt.id
      LEFT JOIN purchase_orders po ON inv.purchase_order_id = po.id
      LEFT JOIN opportunities o ON inv.opportunity_id = o.id OR cnt.opportunity_id = o.id OR po.opportunity_id = o.id
      ${whereClause}
      ORDER BY days_outstanding DESC
    `;

    const result = await db.query(query, params);
    let rows = result.rows;

    if (aging_bracket && aging_bracket !== 'all') {
      if (aging_bracket === '0-30') rows = rows.filter(r => (r.days_outstanding || 0) <= 30);
      else if (aging_bracket === '31-60') rows = rows.filter(r => (r.days_outstanding || 0) > 30 && (r.days_outstanding || 0) <= 60);
      else if (aging_bracket === '60+') rows = rows.filter(r => (r.days_outstanding || 0) > 60);
    }

    let totalInvoiced = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let current030 = 0;
    let overdue3160 = 0;
    let critical60Plus = 0;

    rows.forEach(r => {
      const invTotal = parseFloat(r.total_amount) || 0;
      const paid = parseFloat(r.paid_amount) || 0;
      const due = parseFloat(r.outstanding_amount) || 0;
      const days = parseInt(r.days_outstanding || 0, 10);

      totalInvoiced += invTotal;
      totalCollected += paid;
      totalOutstanding += due;

      if (days <= 30) current030 += due;
      else if (days <= 60) overdue3160 += due;
      else critical60Plus += due;
    });

    const collectionPct = totalInvoiced > 0 ? ((totalCollected / totalInvoiced) * 100).toFixed(1) : '0.0';

    res.json({
      success: true,
      data: rows,
      summary: {
        total_invoices_count: rows.length,
        total_invoiced: totalInvoiced,
        total_collected: totalCollected,
        total_outstanding: totalOutstanding,
        current_0_30: current030,
        overdue_31_60: overdue3160,
        critical_60_plus: critical60Plus,
        collection_rate_pct: collectionPct
      }
    });
  } catch (err) {
    console.error('Pending Receivables Report Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 4. EXECUTIVE REPORT: ACCOUNTS PAYABLE [DUE PAYMENTS TO SUPPLIERS]
// -----------------------------------------------------------------------------
router.get('/accounts-payable', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id, supplier_id, start_date, end_date, scope, due_status } = req.query;

  try {
    let where = [];
    let params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      where.push(`pr.tenant_id::text = $${params.length}`);
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      where.push(`pr.business_profile_id::text = $${params.length}`);
    }

    if (supplier_id && supplier_id !== 'all') {
      params.push(supplier_id);
      where.push(`pr.supplier_id::text = $${params.length}`);
    }

    const sDate = parseFilterDate(start_date);
    if (sDate) {
      params.push(sDate);
      where.push(`pr.created_at::date >= $${params.length}`);
    }

    const eDate = parseFilterDate(end_date);
    if (eDate) {
      params.push(eDate);
      where.push(`pr.created_at::date <= $${params.length}`);
    }

    if (scope === 'tender') {
      where.push(`(o.is_quotation IS NOT TRUE OR po.contract_id IS NOT NULL)`);
    } else if (scope === 'quotation') {
      where.push(`(o.is_quotation IS TRUE)`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const query = `
      SELECT 
        pr.id,
        pr.procurement_number,
        pr.procurement_type,
        pr.currency,
        pr.total_landed_cost,
        pr.status as procurement_status,
        pr.created_at as bill_date,
        (pr.created_at::date + INTERVAL '30 days') as due_date,
        (CURRENT_DATE - pr.created_at::date) as days_elapsed,
        GREATEST(0, (CURRENT_DATE - (pr.created_at::date + INTERVAL '30 days')::date)) as days_overdue,
        s.supplier_name,
        s.origin as supplier_origin,
        s.bank_iban,
        s.swift_code,
        bp.business_name,
        COALESCE(po.po_number, 'Direct Procurement') as po_number,
        COALESCE(o.tender_name, o.title, 'Procurement Supply') as project_title,
        COALESCE(o.is_quotation, FALSE) as is_quotation
      FROM procurements pr
      JOIN suppliers s ON pr.supplier_id = s.id
      JOIN business_profiles bp ON pr.business_profile_id = bp.id
      LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
      LEFT JOIN opportunities o ON po.opportunity_id = o.id
      ${whereClause}
      ORDER BY pr.created_at DESC
    `;

    const result = await db.query(query, params);
    let rows = result.rows.map(r => {
      const landed = parseFloat(r.total_landed_cost || 0);
      const isSettled = String(r.procurement_status || '').toLowerCase() === 'received' || String(r.procurement_status || '').toLowerCase() === 'paid';
      const paid = isSettled ? landed : (landed * 0.3); // In absence of direct vendor payment table, 30% advance on active
      const due = Math.max(0, landed - paid);
      const daysOverdue = parseInt(r.days_overdue || 0, 10);
      let payStatus = isSettled ? 'Settled' : (daysOverdue > 0 ? 'Overdue' : 'Due Soon');

      return {
        ...r,
        bill_amount: landed,
        paid_amount: paid,
        payable_balance: due,
        payment_status: payStatus
      };
    });

    if (due_status && due_status !== 'all') {
      if (due_status === 'overdue') rows = rows.filter(r => r.payment_status === 'Overdue');
      else if (due_status === 'due') rows = rows.filter(r => r.payment_status === 'Due Soon' || r.payment_status === 'Overdue');
      else if (due_status === 'settled') rows = rows.filter(r => r.payment_status === 'Settled');
    }

    let totalBills = 0;
    let totalPaid = 0;
    let totalPayable = 0;
    let currentDues = 0;
    let overdueDues = 0;

    rows.forEach(r => {
      totalBills += r.bill_amount;
      totalPaid += r.paid_amount;
      totalPayable += r.payable_balance;
      if (r.payment_status === 'Overdue') overdueDues += r.payable_balance;
      else if (r.payment_status === 'Due Soon') currentDues += r.payable_balance;
    });

    const settlementPct = totalBills > 0 ? ((totalPaid / totalBills) * 100).toFixed(1) : '0.0';

    res.json({
      success: true,
      data: rows,
      summary: {
        total_procurements_count: rows.length,
        total_bill_amount: totalBills,
        total_paid_amount: totalPaid,
        total_payable_balance: totalPayable,
        current_dues: currentDues,
        overdue_dues: overdueDues,
        settlement_rate_pct: settlementPct
      }
    });
  } catch (err) {
    console.error('Accounts Payable Report Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 5. EXECUTIVE REPORT: SUPPLY STATUS REPORT [AGAINST PO & SHOWS DC]
// -----------------------------------------------------------------------------
router.get('/supply-status', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id, customer_id, start_date, end_date, scope, supply_status } = req.query;

  try {
    let where = [];
    let params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      where.push(`po.tenant_id::text = $${params.length}`);
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      where.push(`po.business_profile_id::text = $${params.length}`);
    }

    if (customer_id && customer_id !== 'all') {
      params.push(customer_id);
      where.push(`po.customer_id::text = $${params.length}`);
    }

    const sDate = parseFilterDate(start_date);
    if (sDate) {
      params.push(sDate);
      where.push(`po.po_date >= $${params.length}`);
    }

    const eDate = parseFilterDate(end_date);
    if (eDate) {
      params.push(eDate);
      where.push(`po.po_date <= $${params.length}`);
    }

    if (scope === 'tender') {
      where.push(`(o.is_quotation IS NOT TRUE OR po.contract_id IS NOT NULL)`);
    } else if (scope === 'quotation') {
      where.push(`(o.is_quotation IS TRUE)`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const poQuery = `
      SELECT 
        po.id as po_id,
        po.po_number,
        po.po_date,
        po.delivery_location,
        po.status as po_status,
        po.net_amount as po_amount,
        c.business_name as customer_name,
        bp.business_name,
        COALESCE(o.tender_name, o.title, 'Project Execution') as project_title,
        COALESCE(o.is_quotation, FALSE) as is_quotation,
        cnt.contract_number
      FROM purchase_orders po
      JOIN customers c ON po.customer_id = c.id
      JOIN business_profiles bp ON po.business_profile_id = bp.id
      LEFT JOIN contracts cnt ON po.contract_id = cnt.id
      LEFT JOIN opportunities o ON po.opportunity_id = o.id
      ${whereClause}
      ORDER BY po.po_date DESC, po.created_at DESC
    `;

    const poResult = await db.query(poQuery, params);
    const poList = poResult.rows;

    if (poList.length === 0) {
      return res.json({
        success: true,
        data: [],
        summary: {
          total_pos_count: 0,
          fully_delivered_count: 0,
          in_progress_count: 0,
          pending_count: 0,
          overall_fulfillment_pct: '0.0'
        }
      });
    }

    const poIds = poList.map(p => p.po_id);

    // Fetch items and correlated DCs
    const itemsRes = await db.query(`
      SELECT 
        poi.id, poi.purchase_order_id, poi.item_description, poi.unit,
        COALESCE(poi.quantity, poi.awarded_quantity, 1) as ordered_quantity,
        COALESCE(poi.total_price, 0) as item_total_price
      FROM purchase_order_items poi
      WHERE poi.purchase_order_id = ANY($1::uuid[])
    `, [poIds]);

    const dcsRes = await db.query(`
      SELECT 
        dc.id as dc_id,
        dc.purchase_order_id,
        dc.dc_number,
        dc.delivery_date,
        dc.status as dc_status,
        dc.logistics_provider,
        dc.tracking_number,
        dc.bilty_number,
        dc.vehicle_number,
        dc.driver_name,
        dci.product_service_id,
        dci.purchase_order_item_id,
        dci.item_name,
        dci.quantity as delivered_quantity,
        dci.unit
      FROM delivery_challans dc
      LEFT JOIN delivery_challan_items dci ON dc.id = dci.delivery_challan_id
      WHERE dc.purchase_order_id = ANY($1::uuid[])
      ORDER BY dc.delivery_date ASC
    `, [poIds]);

    const itemsByPo = {};
    itemsRes.rows.forEach(itm => {
      if (!itemsByPo[itm.purchase_order_id]) itemsByPo[itm.purchase_order_id] = [];
      itemsByPo[itm.purchase_order_id].push(itm);
    });

    const dcsByPo = {};
    dcsRes.rows.forEach(dc => {
      if (!dcsByPo[dc.purchase_order_id]) dcsByPo[dc.purchase_order_id] = [];
      dcsByPo[dc.purchase_order_id].push(dc);
    });

    let fullyDeliveredCount = 0;
    let inProgressCount = 0;
    let pendingCount = 0;
    let totalOrderedQtyAll = 0;
    let totalDeliveredQtyAll = 0;

    let enrichedPOs = poList.map(po => {
      const items = itemsByPo[po.po_id] || [];
      const dcs = dcsByPo[po.po_id] || [];

      // Calculate total ordered vs delivered
      let totalOrdered = 0;
      let totalDelivered = 0;

      items.forEach(itm => {
        const oQty = parseFloat(itm.ordered_quantity) || 0;
        totalOrdered += oQty;

        // Delivered for this item across all DCs
        const itmDelivered = dcs
          .filter(d => (d.purchase_order_item_id && d.purchase_order_item_id === itm.id) || (d.item_name && itm.item_description && d.item_name.toLowerCase().includes(itm.item_description.slice(0, 15).toLowerCase())))
          .reduce((sum, d) => sum + (parseFloat(d.delivered_quantity) || 0), 0);
        
        itm.delivered_quantity = itmDelivered;
        itm.pending_quantity = Math.max(0, oQty - itmDelivered);
      });

      // If items table didn't have items, check overall DC quantities
      if (totalOrdered === 0) {
        totalOrdered = 1;
        totalDelivered = dcs.filter(d => String(d.dc_status).toLowerCase() === 'delivered').length > 0 ? 1 : 0;
      } else {
        totalDelivered = items.reduce((s, itm) => s + (itm.delivered_quantity || 0), 0);
      }

      totalOrderedQtyAll += totalOrdered;
      totalDeliveredQtyAll += Math.min(totalOrdered, totalDelivered);

      const fulfillmentPct = totalOrdered > 0 ? Math.min(100, (totalDelivered / totalOrdered) * 100) : 0;

      let supplyStatus = 'Pending Fulfillment';
      if (fulfillmentPct >= 99.5 || String(po.po_status).toLowerCase() === 'delivered') {
        supplyStatus = 'Fully Delivered';
        fullyDeliveredCount++;
      } else if (fulfillmentPct > 0 || dcs.length > 0) {
        supplyStatus = 'Partially Dispatched';
        inProgressCount++;
      } else {
        pendingCount++;
      }

      // Group DCs for display
      const uniqueDCs = [];
      const seenDc = new Set();
      dcs.forEach(d => {
        if (!seenDc.has(d.dc_id)) {
          seenDc.add(d.dc_id);
          uniqueDCs.push({
            dc_id: d.dc_id,
            dc_number: d.dc_number,
            delivery_date: d.delivery_date,
            status: d.dc_status,
            logistics_provider: d.logistics_provider,
            bilty_number: d.bilty_number,
            vehicle_number: d.vehicle_number
          });
        }
      });

      return {
        ...po,
        items,
        delivery_challans: uniqueDCs,
        total_ordered_qty: totalOrdered,
        total_delivered_qty: totalDelivered,
        pending_qty: Math.max(0, totalOrdered - totalDelivered),
        fulfillment_pct: fulfillmentPct.toFixed(1),
        supply_status: supplyStatus
      };
    });

    if (supply_status && supply_status !== 'all') {
      if (supply_status === 'delivered') enrichedPOs = enrichedPOs.filter(p => p.supply_status === 'Fully Delivered');
      else if (supply_status === 'dispatched') enrichedPOs = enrichedPOs.filter(p => p.supply_status === 'Partially Dispatched');
      else if (supply_status === 'pending') enrichedPOs = enrichedPOs.filter(p => p.supply_status === 'Pending Fulfillment');
    }

    const overallFulfillmentRate = totalOrderedQtyAll > 0 
      ? ((totalDeliveredQtyAll / totalOrderedQtyAll) * 100).toFixed(1) 
      : '0.0';

    res.json({
      success: true,
      data: enrichedPOs,
      summary: {
        total_pos_count: enrichedPOs.length,
        fully_delivered_count: fullyDeliveredCount,
        in_progress_count: inProgressCount,
        pending_count: pendingCount,
        total_ordered_quantity: totalOrderedQtyAll,
        total_delivered_quantity: totalDeliveredQtyAll,
        overall_fulfillment_pct: overallFulfillmentRate
      }
    });
  } catch (err) {
    console.error('Supply Status Report Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// PHASE 4: SCHEDULED AUTOMATED EMAIL REPORTS & CROSS-MODULE EXECUTIVE BI
// ============================================================================

// GET Scheduled Reports
router.get('/scheduled', authenticate, async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(
      `SELECT * FROM scheduled_reports WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Create Scheduled Report Digest
router.post('/scheduled', authenticate, async (req, res) => {
  const { report_type, frequency, destination_emails, format, filter_criteria } = req.body;
  try {
    const tenantId = await resolveTenantId(req, db);
    const emails = Array.isArray(destination_emails)
      ? destination_emails
      : String(destination_emails || '').split(',').map(s => s.trim()).filter(Boolean);

    const result = await db.query(
      `INSERT INTO scheduled_reports (tenant_id, report_type, frequency, destination_emails, format, filter_criteria, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE) RETURNING *`,
      [
        tenantId,
        report_type || 'Executive Financial & Tender Digest',
        frequency || 'Weekly',
        emails,
        format || 'PDF',
        filter_criteria || {}
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE Scheduled Report
router.delete('/scheduled/:id', authenticate, async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    await db.query(`DELETE FROM scheduled_reports WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true, message: 'Scheduled report deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Cross-Module Executive BI Telemetry
router.get('/executive-bi', authenticate, async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const [oppStats, invStats, crmStats, hrmStats, mfgStats] = await Promise.all([
      db.query(
        `SELECT COUNT(*) as total,
                COUNT(*) FILTER (WHERE LOWER(status) = 'won') as won,
                SUM(COALESCE(estimated_value, 0)) as pipeline_value
         FROM opportunities WHERE tenant_id = $1`,
        [tenantId]
      ),
      db.query(
        `SELECT COUNT(*) as skus,
                SUM(COALESCE(current_stock, 0) * COALESCE(cost_price, 0)) as valuation
         FROM products_services WHERE tenant_id = $1`,
        [tenantId]
      ),
      db.query(
        `SELECT COUNT(*) as total_leads,
                SUM(COALESCE(estimated_deal_value, 0)) as lead_pipeline_value
         FROM crm_leads WHERE tenant_id = $1`,
        [tenantId]
      ),
      db.query(
        `SELECT COUNT(*) as active_employees FROM hrm_employees WHERE tenant_id = $1 AND employment_status = 'Active'`,
        [tenantId]
      ),
      db.query(
        `SELECT COUNT(*) as active_work_orders FROM mfg_work_orders WHERE tenant_id = $1 AND status IN ('Confirmed', 'In Production')`,
        [tenantId]
      )
    ]);

    const tTotal = parseInt(oppStats.rows[0]?.total || 0, 10);
    const tWon = parseInt(oppStats.rows[0]?.won || 0, 10);
    res.json({
      success: true,
      data: {
        tender_win_rate_pct: tTotal > 0 ? ((tWon / tTotal) * 100).toFixed(1) : '0.0',
        total_tenders: tTotal,
        won_tenders: tWon,
        tender_pipeline_value: parseFloat(oppStats.rows[0]?.pipeline_value || 0),
        inventory_skus: parseInt(invStats.rows[0]?.skus || 0, 10),
        inventory_valuation: parseFloat(invStats.rows[0]?.valuation || 0),
        crm_leads_count: parseInt(crmStats.rows[0]?.total_leads || 0, 10),
        crm_pipeline_value: parseFloat(crmStats.rows[0]?.lead_pipeline_value || 0),
        active_employees: parseInt(hrmStats.rows[0]?.active_employees || 0, 10),
        active_work_orders: parseInt(mfgStats.rows[0]?.active_work_orders || 0, 10)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

