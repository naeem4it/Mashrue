-- ============================================================================
-- Mashrue Enterprise BMS - Production Workflow & Inventory Upgrade Script
-- Script Name: 03_production_workflow_upgrade.sql
-- Target DB: mashrueDB (PostgreSQL 14+)
-- Classification: Safe Idempotent Production Migration
-- Safe execution: Preserves 100% of existing rows and table structures.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. DYNAMIC WORKFLOW GATES (CUSTOMER & OPPORTUNITY CHECKLISTS)
-- ----------------------------------------------------------------------------

-- Add workflow gates configuration to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS workflow_gates JSONB DEFAULT '{
  "requires_bid_security": true,
  "requires_performance_guarantee": true,
  "requires_stamp_duty": true,
  "requires_dtl_inspection": false,
  "requires_fbr_e_invoice": true,
  "requires_diary_tracking": true
}'::jsonb;

-- Add workflow gates configuration to opportunities table
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS workflow_gates JSONB DEFAULT '{
  "requires_bid_security": true,
  "requires_performance_guarantee": true,
  "requires_stamp_duty": true,
  "requires_dtl_inspection": false,
  "requires_fbr_e_invoice": true,
  "requires_diary_tracking": true
}'::jsonb;

-- ----------------------------------------------------------------------------
-- 2. COMPREHENSIVE INVENTORY MANAGEMENT SUBSYSTEM
-- ----------------------------------------------------------------------------

-- Real-time Warehouse Stock & Batch Tracker table
CREATE TABLE IF NOT EXISTS warehouse_stock (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
    batch_number VARCHAR(100) DEFAULT 'STANDARD',
    expiry_date DATE,
    shelf_location VARCHAR(100),
    quantity_on_hand NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    quantity_reserved NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    quantity_available NUMERIC(14, 4) GENERATED ALWAYS AS (quantity_on_hand - quantity_reserved) STORED,
    average_unit_cost NUMERIC(18, 4) DEFAULT 0.0000,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_wh_product_batch UNIQUE (warehouse_id, product_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_wh_stock_tenant ON warehouse_stock(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wh_stock_wh ON warehouse_stock(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_wh_stock_product ON warehouse_stock(product_id);

-- Stock Reservation Engine Table
CREATE TABLE IF NOT EXISTS stock_reservations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
    batch_number VARCHAR(100) DEFAULT 'STANDARD',
    reserved_quantity NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    status VARCHAR(50) DEFAULT 'Active', -- 'Active', 'Fulfilled', 'Cancelled'
    reserved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_stock_res_po ON stock_reservations(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_stock_res_opp ON stock_reservations(opportunity_id);

-- Goods Receipt Notes (GRN) & DTL / Quality Inspection Table
CREATE TABLE IF NOT EXISTS grn_inspections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
    delivery_challan_id UUID REFERENCES delivery_challans(id) ON DELETE SET NULL,
    purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
    supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
    warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
    grn_number VARCHAR(100) NOT NULL,
    inspection_date DATE DEFAULT CURRENT_DATE,
    inspector_name VARCHAR(150),
    total_received_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    accepted_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    rejected_qty NUMERIC(14, 4) NOT NULL DEFAULT 0.0000,
    dtl_required BOOLEAN DEFAULT FALSE,
    dtl_sample_code VARCHAR(100),
    dtl_report_number VARCHAR(100),
    dtl_report_date DATE,
    dtl_status VARCHAR(50) DEFAULT 'Pending', -- 'Pending', 'Cleared', 'Failed', 'N/A'
    dtl_remarks TEXT,
    inspection_status VARCHAR(50) DEFAULT 'Inspection Passed', -- 'Inspection Passed', 'Inspection Failed', 'Awaiting DTL'
    remarks TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_grn_dc ON grn_inspections(delivery_challan_id);
CREATE INDEX IF NOT EXISTS idx_grn_po ON grn_inspections(purchase_order_id);

-- ----------------------------------------------------------------------------
-- 3. PPRA GRIEVANCE REDRESSAL SUBSYSTEM (RULE 48)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS grievance_cases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    bid_id UUID REFERENCES bids(id) ON DELETE SET NULL,
    case_tracking_number VARCHAR(100) NOT NULL,
    filing_date DATE DEFAULT CURRENT_DATE,
    procuring_agency_officer VARCHAR(150),
    committee_name VARCHAR(150) DEFAULT 'Redressal Grievance Committee',
    hearing_date DATE,
    grievance_grounds TEXT NOT NULL,
    relief_sought TEXT,
    status VARCHAR(50) DEFAULT 'Under Review', -- 'Under Review', 'Hearing Scheduled', 'Accepted', 'Rejected', 'Appealed to Appellate'
    decision_date DATE,
    decision_summary TEXT,
    decision_doc_url TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_grievance_opp ON grievance_cases(opportunity_id);

-- ----------------------------------------------------------------------------
-- 4. BID SECURITY ENHANCEMENTS (RECOVERY LETTERS & DIARY TRACKING)
-- ----------------------------------------------------------------------------

ALTER TABLE bid_securities ADD COLUMN IF NOT EXISTS department_diary_number VARCHAR(100);
ALTER TABLE bid_securities ADD COLUMN IF NOT EXISTS recovery_letter_date DATE;
ALTER TABLE bid_securities ADD COLUMN IF NOT EXISTS recovery_letter_ref VARCHAR(150);
ALTER TABLE bid_securities ADD COLUMN IF NOT EXISTS return_acknowledgement_by VARCHAR(150);
ALTER TABLE bid_securities ADD COLUMN IF NOT EXISTS linked_pbg_id UUID REFERENCES performance_guarantees(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 5. STAMP DUTY & CONTRACT FORMALIZATION
-- ----------------------------------------------------------------------------

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_required BOOLEAN DEFAULT TRUE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_rate_pct NUMERIC(5, 4) DEFAULT 0.2500;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_challan_no VARCHAR(100);
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_amount NUMERIC(18, 4) DEFAULT 0.0000;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_paid_date DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS stamp_duty_doc_url TEXT;

ALTER TABLE award_letters ADD COLUMN IF NOT EXISTS stamp_duty_challan_no VARCHAR(100);
ALTER TABLE award_letters ADD COLUMN IF NOT EXISTS stamp_duty_paid_date DATE;

-- ----------------------------------------------------------------------------
-- 6. INVOICE DEPARTMENT DIARY & DISPATCH REGISTRY
-- ----------------------------------------------------------------------------

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS submission_diary_no VARCHAR(100);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS submission_diary_date DATE;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dealing_officer_name VARCHAR(150);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS department_section VARCHAR(150);
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS dtl_clearance_ref VARCHAR(100);

-- ----------------------------------------------------------------------------
-- 7. PAYMENT REALIZATION & SECTION 153 WHT DEDUCTION ENGINE
-- ----------------------------------------------------------------------------

ALTER TABLE payments ADD COLUMN IF NOT EXISTS gross_invoice_amount NUMERIC(18, 4) DEFAULT 0.0000;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS income_tax_wht_pct NUMERIC(5, 2) DEFAULT 0.00;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS income_tax_wht_amount NUMERIC(18, 4) DEFAULT 0.0000;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS sales_tax_wht_amount NUMERIC(18, 4) DEFAULT 0.0000;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS ld_penalties_amount NUMERIC(18, 4) DEFAULT 0.0000;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS other_deductions_amount NUMERIC(18, 4) DEFAULT 0.0000;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS net_received_amount NUMERIC(18, 4) DEFAULT 0.0000;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS deduction_certificate_no VARCHAR(100);

-- ----------------------------------------------------------------------------
-- 8. PAST PERFORMANCE PORTFOLIO REPORTING VIEW
-- ----------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_past_performance_portfolio AS
SELECT 
    c.id as contract_id,
    c.tenant_id,
    c.business_profile_id,
    bp.business_name as executing_company,
    c.contract_number,
    c.contract_value,
    cust.business_name as client_name,
    cust.customer_type as client_type,
    cust.department_name,
    o.opportunity_number,
    o.title as project_title,
    o.tender_source,
    c.start_date,
    c.end_date,
    c.status as contract_status,
    COALESCE((SELECT SUM(total_amount) FROM invoices inv WHERE inv.contract_id = c.id), 0.00) as total_invoiced,
    COALESCE((SELECT SUM(amount) FROM payments p JOIN invoices inv ON p.invoice_id = inv.id WHERE inv.contract_id = c.id), 0.00) as total_collected,
    (SELECT COUNT(*) FROM delivery_challans dc WHERE dc.purchase_order_id IN (SELECT id FROM purchase_orders po WHERE po.contract_id = c.id)) as total_deliveries_count
FROM contracts c
JOIN business_profiles bp ON c.business_profile_id = bp.id
JOIN customers cust ON c.customer_id = cust.id
LEFT JOIN opportunities o ON c.opportunity_id = o.id;

COMMIT;
