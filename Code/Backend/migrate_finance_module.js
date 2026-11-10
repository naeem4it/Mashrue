/**
 * ============================================================================
 * MASHRUE FINANCIAL MANAGEMENT MODULE — DATABASE MIGRATION (migrate_finance_module.js)
 * ============================================================================
 * Preserves and extends existing tables:
 *   coa_accounts, journal_entries, journal_entry_lines,
 *   invoices, payments, general_expenses, customers, suppliers
 *
 * Adds enterprise-grade standalone & modular financial accounting tables:
 *   - finance_company_settings, fiscal_years, accounting_periods
 *   - finance_currencies, finance_exchange_rates, finance_tax_codes
 *   - invoice_items, ar_credit_notes, ar_credit_note_lines, ar_receipt_allocations
 *   - supplier_bills, supplier_bill_lines, ap_credit_notes, supplier_payments, ap_payment_allocations
 *   - bank_cash_accounts, bank_cash_transfers, bank_reconciliations, bank_statement_lines
 *   - expense_budgets, fixed_assets, fixed_asset_depreciation_logs
 *   - finance_audit_logs, finance_posting_events
 * ============================================================================
 */

const db = require('./config/db');

async function migrateFinanceModule() {
  console.log('================================================================');
  console.log('🏦 RUNNING MASHRUE FINANCIAL MANAGEMENT MODULE MIGRATION');
  console.log('================================================================');

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // ------------------------------------------------------------------------
    // 1. EXTEND EXISTING CORE ACCOUNTING & SUBLEDGER TABLES
    // ------------------------------------------------------------------------
    console.log('1. Extending coa_accounts, journal_entries, journal_entry_lines...');
    await client.query(`
      ALTER TABLE coa_accounts ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE coa_accounts ADD COLUMN IF NOT EXISTS normal_balance VARCHAR(10);
      ALTER TABLE coa_accounts ADD COLUMN IF NOT EXISTS tax_code_id UUID;
      ALTER TABLE coa_accounts ADD COLUMN IF NOT EXISTS is_system BOOLEAN DEFAULT FALSE;
      ALTER TABLE coa_accounts ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'Posted';
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS fiscal_period_id UUID;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'PKR';
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 6) DEFAULT 1.000000;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversal_of_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversed_by_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN DEFAULT FALSE;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(200);
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS source_module VARCHAR(50) DEFAULT 'finance';
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_je_tenant_idempotency
        ON journal_entries (tenant_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_je_tenant_date_status ON journal_entries (tenant_id, entry_date DESC, status);

      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS department VARCHAR(100);
      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS cost_center VARCHAR(100);
      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS dimension_tag VARCHAR(100);
      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS reference_code VARCHAR(100);
      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS tax_code_id UUID;
      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'PKR';
      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS foreign_debit NUMERIC(18, 4) DEFAULT 0.0000;
      ALTER TABLE journal_entry_lines ADD COLUMN IF NOT EXISTS foreign_credit NUMERIC(18, 4) DEFAULT 0.0000;
    `);

    console.log('2. Extending invoices, payments, general_expenses...');
    await client.query(`
      ALTER TABLE invoices ALTER COLUMN business_profile_id DROP NOT NULL;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'PKR';
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 6) DEFAULT 1.000000;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(18, 4) DEFAULT 0.0000;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100) DEFAULT 'Net 30';
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS tax_code_id UUID;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS notes TEXT;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS void_reason TEXT;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS credited_amount NUMERIC(18, 4) DEFAULT 0.0000;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gl_posted BOOLEAN DEFAULT FALSE;
      ALTER TABLE invoices ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL;

      CREATE TABLE IF NOT EXISTS invoice_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        quantity NUMERIC(18, 4) NOT NULL DEFAULT 1,
        unit VARCHAR(50) DEFAULT 'PCS',
        unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0,
        discount_amount NUMERIC(18, 4) DEFAULT 0,
        tax_code_id UUID,
        tax_rate NUMERIC(6, 2) DEFAULT 0,
        tax_amount NUMERIC(18, 4) DEFAULT 0,
        line_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
        revenue_account_id UUID REFERENCES coa_accounts(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_invoice_items_inv ON invoice_items (invoice_id);

      ALTER TABLE payments ALTER COLUMN invoice_id DROP NOT NULL;
      ALTER TABLE payments ALTER COLUMN business_profile_id DROP NOT NULL;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'PKR';
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 6) DEFAULT 1.000000;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS bank_account_id UUID;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS unapplied_amount NUMERIC(18, 4) DEFAULT 0.0000;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_advance BOOLEAN DEFAULT FALSE;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_refund BOOLEAN DEFAULT FALSE;
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'Posted';
      ALTER TABLE payments ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL;

      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'Approved';
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS tax_code_id UUID;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(18, 4) DEFAULT 0.0000;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS bank_account_id UUID;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS coa_account_id UUID REFERENCES coa_accounts(id) ON DELETE SET NULL;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT FALSE;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS recurrence_frequency VARCHAR(30);
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS next_recurrence_date DATE;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS reimbursement_employee_id UUID;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS is_advance_settlement BOOLEAN DEFAULT FALSE;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL;
    `);

    // ------------------------------------------------------------------------
    // 2. COMPANY ACCOUNTING CONFIGURATION, PERIODS & MULTI-CURRENCY
    // ------------------------------------------------------------------------
    console.log('3. Creating finance_company_settings, fiscal_years, accounting_periods, currencies...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS finance_company_settings (
        tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        base_currency VARCHAR(10) DEFAULT 'PKR',
        multi_currency_enabled BOOLEAN DEFAULT FALSE,
        fiscal_year_start_month INT DEFAULT 7,
        fiscal_year_start_day INT DEFAULT 1,
        journal_prefix VARCHAR(20) DEFAULT 'JV',
        journal_next_seq INT DEFAULT 1001,
        invoice_prefix VARCHAR(20) DEFAULT 'INV',
        invoice_next_seq INT DEFAULT 1001,
        bill_prefix VARCHAR(20) DEFAULT 'BILL',
        bill_next_seq INT DEFAULT 1001,
        credit_note_prefix VARCHAR(20) DEFAULT 'CN',
        credit_note_next_seq INT DEFAULT 1001,
        require_journal_approval BOOLEAN DEFAULT FALSE,
        journal_approval_threshold NUMERIC(18, 4) DEFAULT 500000.0000,
        allow_backdated_postings BOOLEAN DEFAULT TRUE,
        enforce_period_locking BOOLEAN DEFAULT TRUE,
        tax_rounding_rule VARCHAR(20) DEFAULT 'HALF_UP',
        default_ar_account_code VARCHAR(30) DEFAULT '1200',
        default_ap_account_code VARCHAR(30) DEFAULT '2001',
        default_revenue_account_code VARCHAR(30) DEFAULT '4001',
        default_expense_account_code VARCHAR(30) DEFAULT '5300',
        default_tax_payable_code VARCHAR(30) DEFAULT '2100',
        default_tax_receivable_code VARCHAR(30) DEFAULT '1450',
        enable_tender_integration BOOLEAN DEFAULT TRUE,
        enable_inventory_integration BOOLEAN DEFAULT TRUE,
        enable_crm_integration BOOLEAN DEFAULT TRUE,
        enable_payroll_integration BOOLEAN DEFAULT TRUE,
        enable_mfg_integration BOOLEAN DEFAULT TRUE,
        opening_balances_locked BOOLEAN DEFAULT FALSE,
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS fiscal_years (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        year_name VARCHAR(100) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        is_closed BOOLEAN DEFAULT FALSE,
        closed_at TIMESTAMP WITH TIME ZONE,
        closed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, year_name)
      );

      CREATE TABLE IF NOT EXISTS accounting_periods (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        fiscal_year_id UUID NOT NULL REFERENCES fiscal_years(id) ON DELETE CASCADE,
        period_number INT NOT NULL,
        period_name VARCHAR(100) NOT NULL,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        status VARCHAR(30) DEFAULT 'Open',
        locked_by UUID REFERENCES users(id) ON DELETE SET NULL,
        locked_at TIMESTAMP WITH TIME ZONE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, start_date, end_date)
      );
      CREATE INDEX IF NOT EXISTS idx_acc_periods_tenant_dates ON accounting_periods (tenant_id, start_date, end_date);

      CREATE TABLE IF NOT EXISTS finance_currencies (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        currency_code VARCHAR(10) NOT NULL,
        currency_name VARCHAR(100) NOT NULL,
        symbol VARCHAR(10) DEFAULT 'PKR',
        decimal_places INT DEFAULT 2,
        is_base BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, currency_code)
      );

      CREATE TABLE IF NOT EXISTS finance_exchange_rates (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        from_currency VARCHAR(10) NOT NULL,
        to_currency VARCHAR(10) NOT NULL DEFAULT 'PKR',
        exchange_rate NUMERIC(18, 6) NOT NULL,
        effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
        source VARCHAR(100) DEFAULT 'Manual / SBP',
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_fx_rates_lookup ON finance_exchange_rates (tenant_id, from_currency, effective_date DESC);

      CREATE TABLE IF NOT EXISTS finance_tax_codes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        code VARCHAR(50) NOT NULL,
        name VARCHAR(150) NOT NULL,
        tax_category VARCHAR(30) NOT NULL DEFAULT 'Sales',
        rate_pct NUMERIC(8, 4) NOT NULL DEFAULT 0.0000,
        is_inclusive BOOLEAN DEFAULT FALSE,
        is_exempt BOOLEAN DEFAULT FALSE,
        rounding_rule VARCHAR(20) DEFAULT 'HALF_UP',
        tax_account_id UUID REFERENCES coa_accounts(id) ON DELETE SET NULL,
        effective_from DATE DEFAULT CURRENT_DATE,
        effective_to DATE,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, code)
      );
    `);

    // ------------------------------------------------------------------------
    // 3. ACCOUNTS RECEIVABLE: CREDIT NOTES & RECEIPT ALLOCATIONS
    // ------------------------------------------------------------------------
    console.log('4. Creating AR credit notes and receipt allocations...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS ar_credit_notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
        credit_note_number VARCHAR(100) NOT NULL,
        credit_date DATE NOT NULL DEFAULT CURRENT_DATE,
        currency VARCHAR(10) DEFAULT 'PKR',
        exchange_rate NUMERIC(18, 6) DEFAULT 1.000000,
        subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(18, 4) DEFAULT 0,
        total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
        applied_amount NUMERIC(18, 4) DEFAULT 0,
        reason TEXT,
        status VARCHAR(30) DEFAULT 'Posted',
        journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, credit_note_number)
      );

      CREATE TABLE IF NOT EXISTS ar_credit_note_lines (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        credit_note_id UUID NOT NULL REFERENCES ar_credit_notes(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity NUMERIC(18, 4) DEFAULT 1,
        unit_price NUMERIC(18, 4) DEFAULT 0,
        tax_rate NUMERIC(6, 2) DEFAULT 0,
        tax_amount NUMERIC(18, 4) DEFAULT 0,
        line_total NUMERIC(18, 4) NOT NULL DEFAULT 0,
        account_id UUID REFERENCES coa_accounts(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS ar_receipt_allocations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
        invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        allocated_amount NUMERIC(18, 4) NOT NULL,
        allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_ar_alloc_pay ON ar_receipt_allocations (payment_id);
      CREATE INDEX IF NOT EXISTS idx_ar_alloc_inv ON ar_receipt_allocations (invoice_id);
    `);

    // ------------------------------------------------------------------------
    // 4. ACCOUNTS PAYABLE: SUPPLIER BILLS, CREDIT NOTES & VENDOR PAYMENTS
    // ------------------------------------------------------------------------
    console.log('5. Creating AP supplier bills, credit notes, payments & allocations...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS supplier_bills (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        procurement_id UUID REFERENCES procurements(id) ON DELETE SET NULL,
        grn_id UUID REFERENCES goods_receipt_notes(id) ON DELETE SET NULL,
        bill_number VARCHAR(100) NOT NULL,
        vendor_invoice_number VARCHAR(100),
        bill_date DATE NOT NULL DEFAULT CURRENT_DATE,
        due_date DATE NOT NULL DEFAULT (CURRENT_DATE + INTERVAL '30 days'),
        currency VARCHAR(10) DEFAULT 'PKR',
        exchange_rate NUMERIC(18, 6) DEFAULT 1.000000,
        subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
        discount_amount NUMERIC(18, 4) DEFAULT 0,
        tax_code_id UUID,
        tax_amount NUMERIC(18, 4) DEFAULT 0,
        total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
        paid_amount NUMERIC(18, 4) DEFAULT 0,
        credited_amount NUMERIC(18, 4) DEFAULT 0,
        status VARCHAR(30) DEFAULT 'Approved',
        approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
        approved_at TIMESTAMP WITH TIME ZONE,
        voided_at TIMESTAMP WITH TIME ZONE,
        void_reason TEXT,
        notes TEXT,
        attachments JSONB DEFAULT '[]'::jsonb,
        gl_posted BOOLEAN DEFAULT FALSE,
        journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, bill_number)
      );
      CREATE INDEX IF NOT EXISTS idx_sup_bills_tenant ON supplier_bills (tenant_id, supplier_id, status);

      CREATE TABLE IF NOT EXISTS supplier_bill_lines (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        bill_id UUID NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
        product_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
        expense_account_id UUID REFERENCES coa_accounts(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        quantity NUMERIC(18, 4) DEFAULT 1,
        unit_cost NUMERIC(18, 4) DEFAULT 0,
        tax_code_id UUID,
        tax_rate NUMERIC(6, 2) DEFAULT 0,
        tax_amount NUMERIC(18, 4) DEFAULT 0,
        line_total NUMERIC(18, 4) NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS ap_credit_notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        bill_id UUID REFERENCES supplier_bills(id) ON DELETE SET NULL,
        credit_note_number VARCHAR(100) NOT NULL,
        credit_date DATE NOT NULL DEFAULT CURRENT_DATE,
        subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0,
        tax_amount NUMERIC(18, 4) DEFAULT 0,
        total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
        reason TEXT,
        status VARCHAR(30) DEFAULT 'Posted',
        journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, credit_note_number)
      );

      CREATE TABLE IF NOT EXISTS supplier_payments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
        bank_account_id UUID,
        payment_number VARCHAR(100) NOT NULL,
        payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
        payment_method VARCHAR(50) DEFAULT 'Bank Transfer',
        reference_number VARCHAR(100),
        currency VARCHAR(10) DEFAULT 'PKR',
        exchange_rate NUMERIC(18, 6) DEFAULT 1.000000,
        gross_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
        wht_deducted NUMERIC(18, 4) DEFAULT 0,
        net_paid_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
        unapplied_amount NUMERIC(18, 4) DEFAULT 0,
        is_advance BOOLEAN DEFAULT FALSE,
        notes TEXT,
        status VARCHAR(30) DEFAULT 'Posted',
        journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, payment_number)
      );

      CREATE TABLE IF NOT EXISTS ap_payment_allocations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        supplier_payment_id UUID NOT NULL REFERENCES supplier_payments(id) ON DELETE CASCADE,
        bill_id UUID NOT NULL REFERENCES supplier_bills(id) ON DELETE CASCADE,
        allocated_amount NUMERIC(18, 4) NOT NULL,
        allocation_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ------------------------------------------------------------------------
    // 5. CASH & BANK ACCOUNTS, TRANSFERS & RECONCILIATION
    // ------------------------------------------------------------------------
    console.log('6. Creating bank_cash_accounts, transfers, and bank reconciliations...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS bank_cash_accounts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        account_name VARCHAR(150) NOT NULL,
        account_type VARCHAR(30) NOT NULL DEFAULT 'Bank',
        bank_name VARCHAR(150),
        account_number VARCHAR(100),
        iban VARCHAR(100),
        branch_code VARCHAR(50),
        currency VARCHAR(10) DEFAULT 'PKR',
        coa_account_id UUID REFERENCES coa_accounts(id) ON DELETE RESTRICT,
        opening_balance NUMERIC(18, 4) DEFAULT 0.0000,
        current_balance NUMERIC(18, 4) DEFAULT 0.0000,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bank_cash_transfers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        transfer_number VARCHAR(100) NOT NULL,
        transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
        from_account_id UUID NOT NULL REFERENCES bank_cash_accounts(id) ON DELETE RESTRICT,
        to_account_id UUID NOT NULL REFERENCES bank_cash_accounts(id) ON DELETE RESTRICT,
        amount NUMERIC(18, 4) NOT NULL,
        reference_number VARCHAR(100),
        notes TEXT,
        journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, transfer_number)
      );

      CREATE TABLE IF NOT EXISTS bank_reconciliations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        bank_account_id UUID NOT NULL REFERENCES bank_cash_accounts(id) ON DELETE CASCADE,
        statement_start_date DATE NOT NULL,
        statement_end_date DATE NOT NULL,
        opening_statement_balance NUMERIC(18, 4) DEFAULT 0,
        closing_statement_balance NUMERIC(18, 4) NOT NULL,
        book_balance NUMERIC(18, 4) DEFAULT 0,
        reconciled_difference NUMERIC(18, 4) DEFAULT 0,
        status VARCHAR(30) DEFAULT 'In Progress',
        reconciled_by UUID REFERENCES users(id) ON DELETE SET NULL,
        reconciled_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bank_statement_lines (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        reconciliation_id UUID NOT NULL REFERENCES bank_reconciliations(id) ON DELETE CASCADE,
        transaction_date DATE NOT NULL,
        description TEXT,
        reference_number VARCHAR(100),
        debit_withdrawal NUMERIC(18, 4) DEFAULT 0,
        credit_deposit NUMERIC(18, 4) DEFAULT 0,
        matched_journal_line_id UUID REFERENCES journal_entry_lines(id) ON DELETE SET NULL,
        is_matched BOOLEAN DEFAULT FALSE,
        discrepancy_note TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ------------------------------------------------------------------------
    // 6. EXPENSE BUDGETS & FIXED ASSETS REGISTER
    // ------------------------------------------------------------------------
    console.log('7. Creating expense_budgets, fixed_assets & depreciation logs...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS expense_budgets (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        fiscal_year_id UUID REFERENCES fiscal_years(id) ON DELETE CASCADE,
        coa_account_id UUID REFERENCES coa_accounts(id) ON DELETE CASCADE,
        category_name VARCHAR(150),
        period_month INT,
        budget_amount NUMERIC(18, 4) NOT NULL DEFAULT 0,
        notes TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS fixed_assets (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        asset_code VARCHAR(100) NOT NULL,
        asset_name VARCHAR(255) NOT NULL,
        category VARCHAR(100) NOT NULL DEFAULT 'Plant & Machinery',
        acquisition_date DATE NOT NULL DEFAULT CURRENT_DATE,
        acquisition_cost NUMERIC(18, 4) NOT NULL,
        salvage_value NUMERIC(18, 4) DEFAULT 0.0000,
        useful_life_years NUMERIC(6, 2) NOT NULL DEFAULT 5.00,
        depreciation_method VARCHAR(50) NOT NULL DEFAULT 'Straight-Line',
        annual_depreciation_rate NUMERIC(6, 2) DEFAULT 20.00,
        accumulated_depreciation NUMERIC(18, 4) DEFAULT 0.0000,
        net_book_value NUMERIC(18, 4) NOT NULL,
        asset_coa_id UUID REFERENCES coa_accounts(id) ON DELETE SET NULL,
        accum_dep_coa_id UUID REFERENCES coa_accounts(id) ON DELETE SET NULL,
        dep_expense_coa_id UUID REFERENCES coa_accounts(id) ON DELETE SET NULL,
        last_depreciation_date DATE,
        status VARCHAR(30) DEFAULT 'Active',
        disposal_date DATE,
        disposal_proceeds NUMERIC(18, 4),
        disposal_gain_loss NUMERIC(18, 4),
        location VARCHAR(150),
        serial_number VARCHAR(100),
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, asset_code)
      );

      CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        asset_id UUID NOT NULL REFERENCES fixed_assets(id) ON DELETE CASCADE,
        period_year INT NOT NULL,
        period_month INT NOT NULL,
        depreciation_amount NUMERIC(18, 4) NOT NULL,
        accumulated_after NUMERIC(18, 4) NOT NULL,
        nbv_after NUMERIC(18, 4) NOT NULL,
        journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
        posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
        posted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(asset_id, period_year, period_month)
      );
    `);

    // ------------------------------------------------------------------------
    // 7. AUDIT TRAIL & IDEMPOTENT ACCOUNTING POSTING EVENTS
    // ------------------------------------------------------------------------
    console.log('8. Creating finance_audit_logs and finance_posting_events...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS finance_audit_logs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        entity_type VARCHAR(80) NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        action VARCHAR(50) NOT NULL,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        user_name VARCHAR(150),
        before_state JSONB,
        after_state JSONB,
        ip_address VARCHAR(100),
        remarks TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_fin_audit_tenant ON finance_audit_logs (tenant_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS finance_posting_events (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        source_module VARCHAR(50) NOT NULL,
        event_type VARCHAR(80) NOT NULL,
        source_id VARCHAR(100) NOT NULL,
        source_number VARCHAR(100),
        journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
        status VARCHAR(30) DEFAULT 'Posted',
        error_message TEXT,
        payload JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, event_type, source_id)
      );
      CREATE INDEX IF NOT EXISTS idx_fin_events_tenant ON finance_posting_events (tenant_id, created_at DESC);
    `);

    // ------------------------------------------------------------------------
    // 8. SEED DEFAULTS FOR EXISTING TENANTS
    // ------------------------------------------------------------------------
    console.log('9. Seeding default Finance config, Fiscal Year, Periods, Currencies & Tax Codes...');
    const tenantsRes = await client.query(`SELECT id FROM tenants`);
    const curYear = new Date().getFullYear();
    const fyStartYear = new Date().getMonth() >= 6 ? curYear : curYear - 1;
    const fyStart = `${fyStartYear}-07-01`;
    const fyEnd = `${fyStartYear + 1}-06-30`;
    const fyName = `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;

    for (const t of tenantsRes.rows) {
      const tid = t.id;

      await client.query(`
        INSERT INTO finance_company_settings (tenant_id)
        VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING;
      `, [tid]);

      // Seed Currencies
      const currencies = [
        ['PKR', 'Pakistani Rupee', 'Rs', true],
        ['USD', 'US Dollar', '$', false],
        ['EUR', 'Euro', '€', false],
        ['GBP', 'British Pound', '£', false],
        ['AED', 'UAE Dirham', 'AED', false]
      ];
      for (const [code, name, sym, isBase] of currencies) {
        await client.query(`
          INSERT INTO finance_currencies (tenant_id, currency_code, currency_name, symbol, is_base, is_active)
          VALUES ($1, $2, $3, $4, $5, TRUE)
          ON CONFLICT (tenant_id, currency_code) DO NOTHING
        `, [tid, code, name, sym, isBase]);
      }

      // Ensure essential COA heads exist (including Accumulated Depreciation & Depreciation Expense)
      const extraCoa = [
        ['1001', 'Cash in Hand (Petty Cash)', 'Asset', 'Current Asset', true],
        ['1010', 'Bank Current Account (PKR)', 'Asset', 'Current Asset', true],
        ['1200', 'Accounts Receivable (Trade Debtors)', 'Asset', 'Current Asset', false],
        ['1300', 'Inventory Asset (Warehouse Stock)', 'Asset', 'Current Asset', false],
        ['1400', 'Advance Income Tax / WHT Receivable', 'Asset', 'Current Asset', false],
        ['1450', 'Withholding Tax (WHT) Receivable', 'Asset', 'Current Asset', false],
        ['1500', 'Fixed Assets — Property, Plant & Equipment', 'Asset', 'Fixed Asset', false],
        ['1590', 'Accumulated Depreciation — Fixed Assets', 'Asset', 'Contra Asset', false],
        ['2001', 'Accounts Payable (Trade Creditors)', 'Liability', 'Current Liability', false],
        ['2100', 'Output Sales Tax Payable', 'Liability', 'Current Liability', false],
        ['2150', 'Input Sales Tax Adjustable / Credit', 'Asset', 'Current Asset', false],
        ['2200', 'Salaries & Payroll Payable', 'Liability', 'Current Liability', false],
        ['2250', 'Withholding Tax Payable (Deductions)', 'Liability', 'Current Liability', false],
        ['3001', 'Owner Capital / Share Equity', 'Equity', 'Equity', false],
        ['3200', 'Retained Earnings', 'Equity', 'Equity', false],
        ['4001', 'Operating Sales Revenue', 'Revenue', 'Operating Revenue', false],
        ['4200', 'Other Income & Asset Disposal Gain', 'Revenue', 'Other Income', false],
        ['5001', 'Cost of Goods Sold (COGS)', 'Expense', 'Direct Cost', false],
        ['5100', 'Salaries & Wages Expense', 'Expense', 'Operating Expense', false],
        ['5200', 'Project & Tender Execution Expense', 'Expense', 'Direct Expense', false],
        ['5300', 'General & Administrative Expense', 'Expense', 'Operating Expense', false],
        ['5500', 'Depreciation Expense', 'Expense', 'Non-Cash Expense', false]
      ];
      for (const [code, name, type, sub, isRec] of extraCoa) {
        await client.query(`
          INSERT INTO coa_accounts (tenant_id, account_code, account_name, account_type, account_sub_type, is_reconcilable, is_system)
          VALUES ($1, $2, $3, $4, $5, $6, TRUE)
          ON CONFLICT (tenant_id, account_code) DO NOTHING
        `, [tid, code, name, type, sub, isRec]);
      }

      // Seed default Fiscal Year & 12 Periods if none exist
      const fyCheck = await client.query(`SELECT id FROM fiscal_years WHERE tenant_id = $1 LIMIT 1`, [tid]);
      if (fyCheck.rows.length === 0) {
        const fyIns = await client.query(`
          INSERT INTO fiscal_years (tenant_id, year_name, start_date, end_date, is_closed)
          VALUES ($1, $2, $3, $4, FALSE) RETURNING id
        `, [tid, fyName, fyStart, fyEnd]);
        const fyId = fyIns.rows[0].id;

        for (let m = 0; m < 12; m++) {
          const pDate = new Date(Date.UTC(fyStartYear, 6 + m, 1));
          const pEnd = new Date(Date.UTC(fyStartYear, 6 + m + 1, 0));
          const pName = pDate.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
          await client.query(`
            INSERT INTO accounting_periods (tenant_id, fiscal_year_id, period_number, period_name, start_date, end_date, status)
            VALUES ($1, $2, $3, $4, $5, $6, 'Open')
            ON CONFLICT (tenant_id, start_date, end_date) DO NOTHING
          `, [tid, fyId, m + 1, pName, pDate.toISOString().slice(0, 10), pEnd.toISOString().slice(0, 10)]);
        }
      }

      // Seed default Tax Codes (fully editable/configurable)
      const taxAccountRes = await client.query(`SELECT id, account_code FROM coa_accounts WHERE tenant_id = $1 AND account_code IN ('2100', '2150', '2250')`, [tid]);
      const tMap = {};
      taxAccountRes.rows.forEach(r => { tMap[r.account_code] = r.id; });

      const defaultTaxes = [
        ['GST-18', 'Standard Sales Tax (18%)', 'Sales', 18.00, false, false, tMap['2100'] || null],
        ['PRA-16', 'Provincial Services Tax (16%)', 'Sales', 16.00, false, false, tMap['2100'] || null],
        ['INPUT-18', 'Input Purchase Sales Tax (18%)', 'Purchase', 18.00, false, false, tMap['2150'] || null],
        ['EXEMPT-0', 'Tax Exempt / Zero-Rated (0%)', 'Both', 0.00, false, true, null],
        ['WHT-4.5', 'Withholding Tax Services/Goods (4.5%)', 'Withholding', 4.50, false, false, tMap['2250'] || null]
      ];
      for (const [code, name, cat, rate, incl, ex, accId] of defaultTaxes) {
        await client.query(`
          INSERT INTO finance_tax_codes (tenant_id, code, name, tax_category, rate_pct, is_inclusive, is_exempt, tax_account_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (tenant_id, code) DO NOTHING
        `, [tid, code, name, cat, rate, incl, ex, accId]);
      }

      // Seed default Cash & Bank accounts linked to COA 1001 & 1010 if none exist
      const bankCheck = await client.query(`SELECT id FROM bank_cash_accounts WHERE tenant_id = $1 LIMIT 1`, [tid]);
      if (bankCheck.rows.length === 0) {
        const cbCoa = await client.query(`SELECT id, account_code FROM coa_accounts WHERE tenant_id = $1 AND account_code IN ('1001', '1010')`, [tid]);
        const cbMap = {};
        cbCoa.rows.forEach(r => { cbMap[r.account_code] = r.id; });
        if (cbMap['1001']) {
          await client.query(`
            INSERT INTO bank_cash_accounts (tenant_id, account_name, account_type, currency, coa_account_id, opening_balance, current_balance)
            VALUES ($1, 'Main Petty Cash Drawer', 'Cash', 'PKR', $2, 0, 0)
          `, [tid, cbMap['1001']]);
        }
        if (cbMap['1010']) {
          await client.query(`
            INSERT INTO bank_cash_accounts (tenant_id, account_name, account_type, bank_name, currency, coa_account_id, opening_balance, current_balance)
            VALUES ($1, 'Primary Corporate Bank Account', 'Bank', 'Corporate Bank', 'PKR', $2, 0, 0)
          `, [tid, cbMap['1010']]);
        }
      }
    }

    await client.query('COMMIT');
    console.log('✅ MASHRUE FINANCIAL MANAGEMENT MODULE MIGRATION COMPLETED SUCCESSFULLY!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Finance Migration Error:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = migrateFinanceModule;

if (require.main === module) {
  migrateFinanceModule()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
