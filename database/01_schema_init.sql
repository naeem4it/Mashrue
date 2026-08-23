-- ============================================================================
-- Mashrue (mashrue.com) - Enterprise Business Management System
-- Database Initialization & Auto-Migration Script
-- Target DB: mashrueDB (PostgreSQL 16+)
-- ============================================================================

-- Enable required core extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- 1. TENANTS & MULTI-BUSINESS PROFILES
-- Business Rule: User can configure up to 2 companies free. 3rd+ has charges.
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(255) NOT NULL,
    subdomain VARCHAR(100) UNIQUE NOT NULL,
    subscription_plan VARCHAR(50) DEFAULT 'Standard', -- Standard, Pro, Enterprise
    max_users INT DEFAULT 10,
    free_business_profile_limit INT DEFAULT 2,        -- Max 2 companies free
    additional_profile_monthly_fee NUMERIC(10, 2) DEFAULT 2500.00,
    free_employee_limit INT DEFAULT 2,                -- Max 2 employees free
    additional_employee_monthly_fee NUMERIC(10, 2) DEFAULT 1500.00,
    status VARCHAR(20) DEFAULT 'Active',             -- Active, Suspended, Cancelled
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration for existing tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS free_business_profile_limit INT DEFAULT 2;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS additional_profile_monthly_fee NUMERIC(10, 2) DEFAULT 2500.00;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS free_employee_limit INT DEFAULT 2;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS additional_employee_monthly_fee NUMERIC(10, 2) DEFAULT 1500.00;

CREATE TABLE IF NOT EXISTS business_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_name VARCHAR(255) NOT NULL, -- e.g., "ABC Pvt Ltd"
    legal_name VARCHAR(255) NOT NULL,
    ntn VARCHAR(50),                     -- National Tax Number
    strn VARCHAR(50),                    -- Sales Tax Registration Number
    cnic VARCHAR(20),
    address TEXT,
    province VARCHAR(100),
    city VARCHAR(100),
    contact_person VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(150),
    abbreviation VARCHAR(50),            -- Company Abbreviation / Short Code (e.g. CGL, ABC)
    invoice_prefix VARCHAR(10) DEFAULT 'INV',
    quotation_prefix VARCHAR(10) DEFAULT 'QTN',
    dc_prefix VARCHAR(10) DEFAULT 'DC',
    po_prefix VARCHAR(10) DEFAULT 'PO',
    logo_url TEXT,
    bank_details JSONB,                  -- Bank name, IBAN, Account #
    fbr_enabled BOOLEAN DEFAULT FALSE,   -- Configurable FBR integration setting
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration for existing business_profiles table
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS abbreviation VARCHAR(50);
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS dc_prefix VARCHAR(10) DEFAULT 'DC';
ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS po_prefix VARCHAR(10) DEFAULT 'PO';

-- ============================================================================
-- 2. USERS, ROLES & PERMISSIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    username VARCHAR(100) UNIQUE,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(150) NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(50) NOT NULL, -- SuperAdmin, LimitedSuperAdmin, ClientAdmin, ClientEmployee
    status VARCHAR(20) DEFAULT 'Active', -- Active, Inactive, Suspended
    must_change_password BOOLEAN DEFAULT FALSE,
    can_see_bidding_prices BOOLEAN DEFAULT TRUE,
    permissions JSONB DEFAULT '{}'::jsonb, -- Granular menu rights { "opportunities": { "view": true, "add": true, "edit": false } }
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration for existing users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_see_bidding_prices BOOLEAN DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissions JSONB DEFAULT '{}'::jsonb;
ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS user_business_access (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
    granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, business_profile_id)
);

-- ============================================================================
-- 3. CUSTOMERS, SUPPLIERS & PRODUCTS CATALOG
-- ============================================================================

-- Customers Table
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_code VARCHAR(100),
    business_name VARCHAR(255) NOT NULL,
    customer_type VARCHAR(100) NOT NULL DEFAULT 'Government Department', -- Government Department, Government Agency, MNC, Private Company, Open-Market Customer
    department_name VARCHAR(150),
    ntn VARCHAR(50),
    strn VARCHAR(50),
    contact_person VARCHAR(100),
    email VARCHAR(150),
    phone VARCHAR(50),
    address TEXT,
    city VARCHAR(100) DEFAULT 'Lahore',
    province VARCHAR(100) DEFAULT 'Punjab',
    country VARCHAR(100) DEFAULT 'Pakistan',
    delivery_address TEXT,
    payment_terms VARCHAR(100) DEFAULT 'Net 30',
    credit_limit NUMERIC(18, 2) DEFAULT 0.00,
    bank_name VARCHAR(150),
    bank_account_title VARCHAR(150),
    bank_iban VARCHAR(100),
    status VARCHAR(20) DEFAULT 'Active', -- Active, Inactive
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration for existing customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_code VARCHAR(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type VARCHAR(100) DEFAULT 'Government Department';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS department_name VARCHAR(150);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS province VARCHAR(100) DEFAULT 'Punjab';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'Pakistan';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS payment_terms VARCHAR(100) DEFAULT 'Net 30';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS credit_limit NUMERIC(18, 2) DEFAULT 0.00;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_name VARCHAR(150);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_account_title VARCHAR(150);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_iban VARCHAR(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT;

-- Suppliers Table (Local & International)
CREATE TABLE IF NOT EXISTS suppliers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    supplier_code VARCHAR(100),
    supplier_name VARCHAR(255) NOT NULL,
    supplier_type VARCHAR(50) NOT NULL DEFAULT 'Local Supplier', -- Local Supplier, International Supplier
    origin VARCHAR(50) NOT NULL DEFAULT 'Local',
    country VARCHAR(100) DEFAULT 'Pakistan',
    origin_port_city VARCHAR(150), -- e.g. Jebel Ali, Shanghai, Hamburg, Karachi Port
    currency VARCHAR(10) DEFAULT 'PKR', -- PKR, USD, EUR, AED, GBP, CNY
    incoterms VARCHAR(50) DEFAULT 'FOB', -- FOB, CIF, CFR, Ex-Works, DDP, CIP
    city VARCHAR(100),
    address TEXT,
    ntn VARCHAR(50),
    strn VARCHAR(50),
    contact_person VARCHAR(100),
    email VARCHAR(150),
    phone VARCHAR(50),
    bank_name VARCHAR(150),
    bank_account_title VARCHAR(150),
    bank_iban VARCHAR(100),
    bank_swift VARCHAR(50),
    rating INT DEFAULT 5,
    payment_terms TEXT DEFAULT 'Net 30',
    product_categories TEXT,
    status VARCHAR(20) DEFAULT 'Active', -- Active, Inactive
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration for existing suppliers table
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_code VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS supplier_type VARCHAR(50) DEFAULT 'Local Supplier';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS origin VARCHAR(50) DEFAULT 'Local';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'Pakistan';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS origin_port_city VARCHAR(150);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'PKR';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS incoterms VARCHAR(50) DEFAULT 'FOB';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_name VARCHAR(150);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_account_title VARCHAR(150);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_iban VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_swift VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS product_categories TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'Active';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS notes TEXT;

-- Products & Services
CREATE TABLE IF NOT EXISTS products_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    item_type VARCHAR(20) NOT NULL DEFAULT 'Product',
    sku VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    unit VARCHAR(50) DEFAULT 'PCS',
    country_of_origin VARCHAR(100) DEFAULT 'Pakistan',
    hs_code VARCHAR(50),
    currency VARCHAR(10) DEFAULT 'PKR',
    cost_price_foreign NUMERIC(18, 4) DEFAULT 0.0000,
    cost_price NUMERIC(18, 4) DEFAULT 0.0000,
    selling_price NUMERIC(18, 4) DEFAULT 0.0000,
    tax_category VARCHAR(50) DEFAULT 'Standard',
    current_stock NUMERIC(14, 4) DEFAULT 0.0000,
    reorder_level NUMERIC(14, 4) DEFAULT 10.0000,
    default_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration for existing products_services table
ALTER TABLE products_services ADD COLUMN IF NOT EXISTS country_of_origin VARCHAR(100) DEFAULT 'Pakistan';
ALTER TABLE products_services ADD COLUMN IF NOT EXISTS hs_code VARCHAR(50);
ALTER TABLE products_services ADD COLUMN IF NOT EXISTS currency VARCHAR(10) DEFAULT 'PKR';
ALTER TABLE products_services ADD COLUMN IF NOT EXISTS cost_price_foreign NUMERIC(18, 4) DEFAULT 0.0000;
ALTER TABLE products_services ADD COLUMN IF NOT EXISTS current_stock NUMERIC(14, 4) DEFAULT 0.0000;
ALTER TABLE products_services ADD COLUMN IF NOT EXISTS reorder_level NUMERIC(14, 4) DEFAULT 10.0000;
ALTER TABLE products_services ADD COLUMN IF NOT EXISTS default_supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

-- ============================================================================
-- 4. TENDERS, DIRECT SALES & SELECTION WORKFLOW
-- ============================================================================

CREATE TABLE IF NOT EXISTS opportunities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
    opportunity_number VARCHAR(100) NOT NULL,
    external_tender_number VARCHAR(100),
    tender_name VARCHAR(255) NOT NULL DEFAULT 'Tender Project',
    title VARCHAR(255) NOT NULL,
    tender_source VARCHAR(50) NOT NULL DEFAULT 'PPRA',
    tender_type VARCHAR(50) DEFAULT 'Public Tender',
    description TEXT,
    customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
    department VARCHAR(150),
    publication_date DATE,
    closing_date TIMESTAMP WITH TIME ZONE NOT NULL,
    submission_deadline TIMESTAMP WITH TIME ZONE,
    opening_date TIMESTAMP WITH TIME ZONE,
    estimated_value NUMERIC(18, 4) DEFAULT 0.0000,
    currency VARCHAR(10) DEFAULT 'PKR',
    location VARCHAR(150),
    selection_status VARCHAR(50) DEFAULT 'Pending',
    selection_reason TEXT,
    selection_date TIMESTAMP WITH TIME ZONE,
    selected_by UUID REFERENCES users(id),
    status VARCHAR(50) DEFAULT 'New',
    bid_decision VARCHAR(20) DEFAULT 'Pending',
    bid_decision_reason TEXT,
    bid_decision_by UUID REFERENCES users(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_tenant_opp_number UNIQUE(tenant_id, opportunity_number)
);

-- Migration for existing opportunities table
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS tender_name VARCHAR(255);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS tender_source VARCHAR(50) DEFAULT 'PPRA';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS department VARCHAR(150);
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS submission_deadline TIMESTAMP WITH TIME ZONE;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS opening_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS selection_status VARCHAR(50) DEFAULT 'Pending';
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS selection_reason TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS selection_date TIMESTAMP WITH TIME ZONE;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS selected_by UUID REFERENCES users(id);

CREATE TABLE IF NOT EXISTS tender_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    product_service_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
    item_name VARCHAR(255) NOT NULL,
    item_description TEXT,
    quantity NUMERIC(14, 4) NOT NULL DEFAULT 1.0000,
    unit VARCHAR(50) DEFAULT 'PCS',
    estimated_unit_price NUMERIC(18, 4) DEFAULT 0.0000,
    estimated_total_price NUMERIC(18, 4) DEFAULT 0.0000,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS opportunity_requirements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    requirement_type VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    is_mandatory BOOLEAN DEFAULT TRUE,
    compliance_status VARCHAR(50) DEFAULT 'Compliant',
    override_reason TEXT,
    override_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 5. BIDDING ENGINE & BID COSTING SHEET
-- ============================================================================

CREATE TABLE IF NOT EXISTS bids (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id) ON DELETE RESTRICT,
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    bid_number VARCHAR(100) NOT NULL,
    version INT DEFAULT 1,
    bid_date DATE DEFAULT CURRENT_DATE,
    valid_until DATE,
    currency VARCHAR(10) DEFAULT 'PKR',
    supplier_cost_total NUMERIC(18, 4) DEFAULT 0.0000,
    logistics_cost_total NUMERIC(18, 4) DEFAULT 0.0000,
    labor_cost_total NUMERIC(18, 4) DEFAULT 0.0000,
    overhead_cost_total NUMERIC(18, 4) DEFAULT 0.0000,
    tender_expense_total NUMERIC(18, 4) DEFAULT 0.0000,
    desired_markup_pct NUMERIC(8, 4) DEFAULT 20.0000,
    desired_profit_amount NUMERIC(18, 4) DEFAULT 0.0000,
    bid_price_subtotal NUMERIC(18, 4) DEFAULT 0.0000,
    tax_amount NUMERIC(18, 4) DEFAULT 0.0000,
    final_bid_price NUMERIC(18, 4) DEFAULT 0.0000,
    gross_margin_pct NUMERIC(8, 4) DEFAULT 0.0000,
    delivery_terms TEXT,
    payment_terms TEXT,
    approval_status VARCHAR(50) DEFAULT 'Draft',
    submission_status VARCHAR(50) DEFAULT 'Not Submitted',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bid_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    product_service_id UUID REFERENCES products_services(id),
    item_description TEXT NOT NULL,
    quantity NUMERIC(14, 4) NOT NULL DEFAULT 1.0000,
    unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    total_cost NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    markup_pct NUMERIC(8, 4) DEFAULT 20.0000,
    unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    total_price NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    tax_rate NUMERIC(8, 4) DEFAULT 0.0000
);

CREATE TABLE IF NOT EXISTS supplier_quotations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
    quotation_number VARCHAR(100),
    quotation_date DATE,
    valid_until DATE,
    total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    is_selected BOOLEAN DEFAULT FALSE,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 6. BID SECURITY MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS bid_securities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id),
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    bid_id UUID REFERENCES bids(id) ON DELETE SET NULL,
    account_title VARCHAR(255) NOT NULL,
    beneficiary VARCHAR(255) NOT NULL,
    instrument_type VARCHAR(50) NOT NULL,
    instrument_number VARCHAR(100) NOT NULL,
    amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    issue_date DATE DEFAULT CURRENT_DATE,
    expiry_date DATE NOT NULL,
    bank_name VARCHAR(150),
    bank_branch VARCHAR(150),
    status VARCHAR(50) DEFAULT 'Active',
    release_date DATE,
    release_reference VARCHAR(150),
    comments TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 7. BID SUBMISSION, EVALUATIONS & AWARD LETTERS
-- ============================================================================

CREATE TABLE IF NOT EXISTS bid_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    submission_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    submission_method VARCHAR(50) NOT NULL,
    portal_url TEXT,
    submission_reference VARCHAR(150),
    submitted_by UUID REFERENCES users(id),
    remarks TEXT
);

CREATE TABLE IF NOT EXISTS bid_evaluations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
    evaluation_status VARCHAR(50) NOT NULL,
    technical_score NUMERIC(5, 2),
    financial_score NUMERIC(5, 2),
    total_score NUMERIC(5, 2),
    ranking INT,
    award_amount NUMERIC(18, 4),
    loss_reason VARCHAR(100),
    competitor_name VARCHAR(150),
    competitor_bid_amount NUMERIC(18, 4),
    our_bid_amount NUMERIC(18, 4),
    variance_amount NUMERIC(18, 4),
    disqualification_stage VARCHAR(100),
    grievance_filed BOOLEAN DEFAULT FALSE,
    grievance_tracking_number VARCHAR(100),
    grievance_status VARCHAR(50),
    evaluation_date DATE DEFAULT CURRENT_DATE,
    remarks TEXT
);

-- Migration for existing bid_evaluations table
ALTER TABLE bid_evaluations ADD COLUMN IF NOT EXISTS competitor_name VARCHAR(150);
ALTER TABLE bid_evaluations ADD COLUMN IF NOT EXISTS competitor_bid_amount NUMERIC(18, 4);
ALTER TABLE bid_evaluations ADD COLUMN IF NOT EXISTS our_bid_amount NUMERIC(18, 4);
ALTER TABLE bid_evaluations ADD COLUMN IF NOT EXISTS variance_amount NUMERIC(18, 4);
ALTER TABLE bid_evaluations ADD COLUMN IF NOT EXISTS disqualification_stage VARCHAR(100);
ALTER TABLE bid_evaluations ADD COLUMN IF NOT EXISTS grievance_filed BOOLEAN DEFAULT FALSE;
ALTER TABLE bid_evaluations ADD COLUMN IF NOT EXISTS grievance_tracking_number VARCHAR(100);
ALTER TABLE bid_evaluations ADD COLUMN IF NOT EXISTS grievance_status VARCHAR(50);

CREATE TABLE IF NOT EXISTS award_letters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    bid_id UUID REFERENCES bids(id) ON DELETE SET NULL,
    award_number VARCHAR(100) NOT NULL,
    award_date DATE DEFAULT CURRENT_DATE,
    award_amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    acceptance_deadline DATE,
    status VARCHAR(50) DEFAULT 'Pending',
    rejection_reason TEXT,
    document_url TEXT,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS award_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    award_letter_id UUID NOT NULL REFERENCES award_letters(id) ON DELETE CASCADE,
    product_service_id UUID REFERENCES products_services(id),
    item_name VARCHAR(255) NOT NULL,
    item_description TEXT,
    tender_quantity NUMERIC(14, 4) DEFAULT 1.0000,
    bid_quantity NUMERIC(14, 4) DEFAULT 1.0000,
    awarded_quantity NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    unit VARCHAR(50) DEFAULT 'PCS',
    awarded_unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    awarded_total_price NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    is_awarded BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 8. CONTRACTS & PERFORMANCE GUARANTEES
-- ============================================================================

CREATE TABLE IF NOT EXISTS contracts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id),
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    bid_id UUID REFERENCES bids(id) ON DELETE SET NULL,
    award_letter_id UUID REFERENCES award_letters(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    contract_number VARCHAR(100) NOT NULL,
    start_date DATE DEFAULT CURRENT_DATE,
    end_date DATE,
    contract_value NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    payment_terms TEXT,
    delivery_terms TEXT,
    status VARCHAR(50) DEFAULT 'Active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS performance_guarantees (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    contract_id UUID REFERENCES contracts(id) ON DELETE CASCADE,
    award_letter_id UUID REFERENCES award_letters(id) ON DELETE CASCADE,
    guarantee_number VARCHAR(100) NOT NULL,
    bank_name VARCHAR(150) NOT NULL,
    amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    issue_date DATE DEFAULT CURRENT_DATE,
    expiry_date DATE NOT NULL,
    status VARCHAR(50) DEFAULT 'Active',
    release_date DATE,
    document_url TEXT,
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 9. PURCHASE ORDERS (MULTI-PO ARCHITECTURE)
-- ============================================================================

CREATE TABLE IF NOT EXISTS purchase_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id),
    award_letter_id UUID REFERENCES award_letters(id) ON DELETE SET NULL,
    contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    po_number VARCHAR(100) NOT NULL,
    po_date DATE DEFAULT CURRENT_DATE,
    delivery_deadline DATE,
    delivery_location TEXT,
    department_name VARCHAR(150),
    payment_terms TEXT,
    total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    tax_amount NUMERIC(18, 4) DEFAULT 0.0000,
    net_amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    status VARCHAR(50) DEFAULT 'Issued',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration for existing purchase_orders table
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS award_letter_id UUID REFERENCES award_letters(id) ON DELETE SET NULL;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS delivery_location TEXT;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS department_name VARCHAR(150);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    award_item_id UUID REFERENCES award_items(id) ON DELETE SET NULL,
    product_service_id UUID REFERENCES products_services(id),
    item_description TEXT NOT NULL,
    unit VARCHAR(50) DEFAULT 'PCS',
    awarded_quantity NUMERIC(14, 4) DEFAULT 0.0000,
    quantity NUMERIC(14, 4) NOT NULL DEFAULT 1.0000,
    unit_price NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    tax_rate NUMERIC(8, 4) DEFAULT 0.0000,
    total_price NUMERIC(18, 4) NOT NULL DEFAULT 0.0000
);

-- Migration for existing purchase_order_items table
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS award_item_id UUID REFERENCES award_items(id) ON DELETE SET NULL;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS unit VARCHAR(50) DEFAULT 'PCS';
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS awarded_quantity NUMERIC(14, 4) DEFAULT 0.0000;

-- ============================================================================
-- 10. WAREHOUSE, STOCK MANAGEMENT & PROCUREMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS warehouses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    warehouse_name VARCHAR(150) NOT NULL,
    location VARCHAR(255),
    city VARCHAR(100) DEFAULT 'Lahore',
    manager_name VARCHAR(100),
    contact_phone VARCHAR(50),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    transaction_type VARCHAR(50) NOT NULL,
    quantity NUMERIC(14, 4) NOT NULL,
    unit_cost NUMERIC(18, 4) DEFAULT 0.0000,
    batch_number VARCHAR(100),
    serial_number VARCHAR(100),
    reference_type VARCHAR(50),
    reference_id UUID,
    remarks TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS procurements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id),
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    supplier_id UUID NOT NULL REFERENCES suppliers(id),
    procurement_type VARCHAR(50) NOT NULL,
    procurement_number VARCHAR(100) NOT NULL,
    currency VARCHAR(10) DEFAULT 'PKR',
    exchange_rate NUMERIC(12, 4) DEFAULT 1.0000,
    origin_country VARCHAR(100) DEFAULT 'Pakistan',
    customs_duty NUMERIC(18, 4) DEFAULT 0.0000,
    freight_charges NUMERIC(18, 4) DEFAULT 0.0000,
    clearing_charges NUMERIC(18, 4) DEFAULT 0.0000,
    other_charges NUMERIC(18, 4) DEFAULT 0.0000,
    total_landed_cost NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    status VARCHAR(50) DEFAULT 'Ordered',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 11. SUPPLY / DELIVERY CHALLAN (DC) & LOGISTICS (DUAL-MODE & PHASED FULFILLMENT)
-- ============================================================================

CREATE TABLE IF NOT EXISTS delivery_challans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id),
    purchase_order_id UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    customer_id UUID NOT NULL REFERENCES customers(id),
    delivery_mode VARCHAR(50) DEFAULT 'Own Warehouse', -- 'Own Warehouse' or 'Direct Drop-Shipment'
    warehouse_id UUID REFERENCES warehouses(id),
    supplier_id UUID REFERENCES suppliers(id), -- For Direct Drop-Shipment from Supplier/Port
    origin_location TEXT,
    destination_site TEXT,
    dc_number VARCHAR(100) NOT NULL,
    delivery_date DATE DEFAULT CURRENT_DATE,
    delivery_method VARCHAR(50) DEFAULT 'Hired Delivery',
    logistics_provider VARCHAR(150),
    tracking_number VARCHAR(100),
    bilty_number VARCHAR(100),
    vehicle_number VARCHAR(100),
    driver_name VARCHAR(100),
    driver_contact VARCHAR(100),
    freight_cost_contractor NUMERIC(18, 4) DEFAULT 0.0000, -- Freight borne/paid by Contractor (Deducted from profit)
    customs_handling_cost NUMERIC(18, 4) DEFAULT 0.0000,   -- Port/clearing charges borne by Contractor
    delivery_cost NUMERIC(18, 4) DEFAULT 0.0000,          -- Total Logistics Cost
    proof_of_delivery_url TEXT,
    grn_number VARCHAR(100),
    grn_date DATE,
    status VARCHAR(50) DEFAULT 'Dispatched', -- 'Dispatched', 'In Transit', 'Delivered', 'GRN Received'
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration for existing delivery_challans table
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS delivery_mode VARCHAR(50) DEFAULT 'Own Warehouse';
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS origin_location TEXT;
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS destination_site TEXT;
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS bilty_number VARCHAR(100);
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(100);
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS driver_name VARCHAR(100);
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS freight_cost_contractor NUMERIC(18, 4) DEFAULT 0.0000;
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS customs_handling_cost NUMERIC(18, 4) DEFAULT 0.0000;
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS grn_number VARCHAR(100);
ALTER TABLE delivery_challans ADD COLUMN IF NOT EXISTS grn_date DATE;

CREATE TABLE IF NOT EXISTS delivery_challan_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    delivery_challan_id UUID NOT NULL REFERENCES delivery_challans(id) ON DELETE CASCADE,
    purchase_order_item_id UUID REFERENCES purchase_order_items(id),
    product_service_id UUID REFERENCES products_services(id),
    item_name VARCHAR(255),
    unit VARCHAR(50) DEFAULT 'PCS',
    ordered_quantity NUMERIC(14, 4) DEFAULT 0.0000,
    quantity NUMERIC(14, 4) NOT NULL DEFAULT 1.0000,
    batch_number VARCHAR(100),
    serial_number VARCHAR(100)
);

-- Migration for existing delivery_challan_items table
ALTER TABLE delivery_challan_items ADD COLUMN IF NOT EXISTS purchase_order_item_id UUID REFERENCES purchase_order_items(id);
ALTER TABLE delivery_challan_items ADD COLUMN IF NOT EXISTS item_name VARCHAR(255);
ALTER TABLE delivery_challan_items ADD COLUMN IF NOT EXISTS unit VARCHAR(50) DEFAULT 'PCS';
ALTER TABLE delivery_challan_items ADD COLUMN IF NOT EXISTS ordered_quantity NUMERIC(14, 4) DEFAULT 0.0000;

-- ============================================================================
-- 12. INVOICES, BILLING & PAKISTAN FBR PRAL INTEGRATION
-- ============================================================================

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id),
    delivery_challan_id UUID REFERENCES delivery_challans(id) ON DELETE SET NULL,
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    invoice_number VARCHAR(100) NOT NULL,
    invoice_date DATE DEFAULT CURRENT_DATE,
    due_date DATE,
    subtotal NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    tax_amount NUMERIC(18, 4) DEFAULT 0.0000,
    total_amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    paid_amount NUMERIC(18, 4) DEFAULT 0.0000,
    status VARCHAR(50) DEFAULT 'Submitted',
    fbr_integration_required BOOLEAN DEFAULT FALSE,
    fbr_status VARCHAR(50) DEFAULT 'FBR Skipped',
    fbr_invoice_number VARCHAR(100),
    fbr_qr_code TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_tenant_invoice_number UNIQUE(tenant_id, invoice_number)
);

-- Migration for existing invoices table
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS delivery_challan_id UUID REFERENCES delivery_challans(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS fbr_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    business_profile_id UUID UNIQUE NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
    environment VARCHAR(20) DEFAULT 'Sandbox',
    api_base_url TEXT DEFAULT 'https://gw.fbr.gov.pk/importer/v1/',
    pos_id VARCHAR(100),
    bearer_token_encrypted TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fbr_submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    request_reference VARCHAR(150),
    fbr_invoice_number VARCHAR(100),
    fbr_reference_number VARCHAR(100),
    response_code VARCHAR(50),
    response_message TEXT,
    status VARCHAR(50) NOT NULL,
    submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 13. PAYMENT RECEIVED MANAGEMENT
-- ============================================================================

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    payment_number VARCHAR(100) NOT NULL,
    payment_date DATE DEFAULT CURRENT_DATE,
    payment_method VARCHAR(50) DEFAULT 'Cheque',
    amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    check_no VARCHAR(100),
    check_from VARCHAR(255),
    bank_account VARCHAR(100),
    deposited_in_bank VARCHAR(150),
    reference_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration for existing payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS check_no VARCHAR(100);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS check_from VARCHAR(255);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS bank_account VARCHAR(100);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deposited_in_bank VARCHAR(150);

-- ============================================================================
-- 14. EXPENSES MANAGEMENT (13 STANDARD COMPANY CATEGORIES)
-- ============================================================================

CREATE TABLE IF NOT EXISTS general_expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_profile_id UUID NOT NULL REFERENCES business_profiles(id),
    expense_type VARCHAR(50) DEFAULT 'General Expense',
    expense_name VARCHAR(255),
    category VARCHAR(100) NOT NULL,
    amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    expense_date DATE DEFAULT CURRENT_DATE,
    paid_to VARCHAR(255),
    payment_mode VARCHAR(50) DEFAULT 'Cash',
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    contract_id UUID REFERENCES contracts(id) ON DELETE SET NULL,
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    delivery_challan_id UUID REFERENCES delivery_challans(id) ON DELETE SET NULL,
    department VARCHAR(100),
    receipt_url TEXT,
    remarks TEXT,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Migration for existing general_expenses table
ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS expense_type VARCHAR(50) DEFAULT 'General Expense';
ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS expense_name VARCHAR(255);
ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS expense_tier VARCHAR(50) DEFAULT 'Tier 1 - Tender Direct';
ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS quotation_id UUID;

CREATE TABLE IF NOT EXISTS tender_expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    expense_type VARCHAR(50) NOT NULL,
    amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    vendor_name VARCHAR(150),
    receipt_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================================
-- 15. AUDIT TRAIL
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL,
    old_values JSONB,
    new_values JSONB,
    ip_address VARCHAR(45),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_business_profiles_tenant ON business_profiles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant ON suppliers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_products_tenant ON products_services(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_tenant ON opportunities(tenant_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_business ON opportunities(business_profile_id);
CREATE INDEX IF NOT EXISTS idx_tender_items_opp ON tender_items(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_bids_tenant_business ON bids(tenant_id, business_profile_id);
CREATE INDEX IF NOT EXISTS idx_bid_securities_opp ON bid_securities(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant ON purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_delivery_challans_po ON delivery_challans(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_business ON invoices(tenant_id, business_profile_id);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_general_expenses_tenant ON general_expenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, timestamp);
