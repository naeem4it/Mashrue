-- ============================================================================
-- Mashrue (mashrue.com) - Enterprise Business Management System
-- Seed Data Script with Full Lifecycle Transactions
-- Target DB: mashrueDB
-- ============================================================================

-- 1. Tenants (Standard Tenant with 2 Free Companies limit)
INSERT INTO tenants (id, company_name, subdomain, subscription_plan, max_users, free_business_profile_limit, additional_profile_monthly_fee)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Alpha Group Enterprises PK',
    'alphagroup',
    'Standard',
    15,
    2,
    2500.00
) ON CONFLICT (id) DO UPDATE SET
    free_business_profile_limit = EXCLUDED.free_business_profile_limit,
    additional_profile_monthly_fee = EXCLUDED.additional_profile_monthly_fee;

-- 2. Business Profiles (2 Free Companies + 1 Configured Extra Profile)
INSERT INTO business_profiles (id, tenant_id, business_name, legal_name, ntn, strn, city, email, invoice_prefix, po_prefix, dc_prefix, fbr_enabled)
VALUES 
(
    'b0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Alpha Engineering Pvt Ltd',
    'Alpha Engineering Private Limited',
    '492019-1',
    'STRN-492019',
    'Lahore',
    'info@alphaeng.pk',
    'INV-AE',
    'PO-AE',
    'DC-AE',
    TRUE
),
(
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'Alpha Technologies & Supplies',
    'Alpha Technologies Partnership',
    '883920-4',
    'STRN-883920',
    'Karachi',
    'sales@alphatech.pk',
    'INV-AT',
    'PO-AT',
    'DC-AT',
    TRUE
),
(
    'b0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'Prime Power Trading Co.',
    'Prime Power Trading Limited',
    '119280-7',
    'STRN-119280',
    'Islamabad',
    'contact@primepower.pk',
    'INV-PP',
    'PO-PP',
    'DC-PP',
    FALSE
) ON CONFLICT (id) DO NOTHING;

-- 3. Users (SuperAdmin, ClientAdmin, and ClientEmployees)
INSERT INTO users (id, tenant_id, username, full_name, email, password_hash, role, must_change_password, can_see_bidding_prices, permissions)
VALUES 
(
    'e0000000-0000-0000-0000-000000000000',
    NULL,
    'naeem4it',
    'Muhammad Naeem Khan (Super Admin)',
    'naeem@mashrue.com',
    '$2a$10$yF1k2sM9bA6yS870hN0V9uLzq5tZ9iYkG7WdD8V8SgH7QpL2.Y9eO', -- Password123!
    'SuperAdmin',
    FALSE,
    TRUE,
    '{}'::jsonb
),
(
    'e0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'alphaclient',
    'Alpha Client Administrator',
    'admin@alphagroup.pk',
    '$2a$10$yF1k2sM9bA6yS870hN0V9uLzq5tZ9iYkG7WdD8V8SgH7QpL2.Y9eO', -- Password123!
    'ClientAdmin',
    FALSE,
    TRUE,
    '{}'::jsonb
),
(
    'e0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'tariq_ops',
    'Tariq Javed (Operations)',
    'tariq@alphagroup.pk',
    '$2a$10$yF1k2sM9bA6yS870hN0V9uLzq5tZ9iYkG7WdD8V8SgH7QpL2.Y9eO', -- Password123!
    'ClientEmployee',
    FALSE,
    FALSE, -- Masked prices
    '{"opportunities": {"view": true, "add": true, "edit": true}, "inventory": {"view": true, "add": true, "edit": false}, "delivery-challans": {"view": true, "add": true, "edit": false}}'::jsonb
) ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    role = EXCLUDED.role,
    must_change_password = EXCLUDED.must_change_password,
    can_see_bidding_prices = EXCLUDED.can_see_bidding_prices,
    permissions = EXCLUDED.permissions;

-- 4. Customers (with Mandatory Organization Types)
INSERT INTO customers (id, tenant_id, business_name, org_type, department_name, ntn, strn, contact_person, email, phone, city)
VALUES 
(
    'c0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Water & Power Development Authority (WAPDA)',
    'Government',
    'Hydro Power Generation Wing',
    '901029-4',
    'STRN-901029',
    'Engr. Khalid Mansoor',
    'procurement@wapda.gov.pk',
    '042-99202211',
    'Lahore'
),
(
    'c0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'Sui Northern Gas Pipelines Ltd (SNGPL)',
    'Semi-Government',
    'Transmission & Distribution Procurement',
    '771029-8',
    'STRN-771029',
    'Amjad Ali',
    'tenders@sngpl.com.pk',
    '042-99201423',
    'Lahore'
),
(
    'c0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'Engro Fertilizers Limited',
    'MNC',
    'Plant Operations & Instrumentation',
    '551029-2',
    'STRN-551029',
    'Farhan Akhtar',
    'supplychain@engro.com',
    '021-35297810',
    'Karachi'
) ON CONFLICT (id) DO NOTHING;

-- 5. Suppliers (with Origin: Local / International)
INSERT INTO suppliers (id, tenant_id, supplier_name, origin, country, city, ntn, contact_person, email, phone, rating, payment_terms)
VALUES 
(
    'd0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Siemens Pakistan Engineering Co.',
    'Local',
    'Pakistan',
    'Karachi',
    '071192-3',
    'Tariq Mehmood',
    'tariq.mehmood@siemens.com',
    '021-32574911',
    5,
    'Net 30'
),
(
    'd0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'Schneider Electric FZE (Import)',
    'International',
    'United Arab Emirates',
    'Dubai',
    'NTN-IMP-9920',
    'Ahmed Al-Mansoor',
    'middleeast-sales@se.com',
    '+971-4-8829100',
    5,
    'LC at Sight / CAD'
),
(
    'd0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'Millat Equipment Spares Co.',
    'Local',
    'Pakistan',
    'Lahore',
    '339201-9',
    'Zubair Hassan',
    'zubair@millatequip.pk',
    '042-37911421',
    4,
    'Advance 20%, Balance on DC'
) ON CONFLICT (id) DO NOTHING;

-- 6. Products Catalog with Stock Levels
INSERT INTO products_services (id, tenant_id, item_type, sku, name, description, unit, cost_price, selling_price, current_stock, reorder_level, default_supplier_id)
VALUES 
(
    '11000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Product',
    'SKU-TRF-132KV',
    '132kV Step-Down Transformer 25MVA',
    'High-voltage power transformer with ONAN cooling and OLTC controller',
    'Units',
    12000000.00,
    14500000.00,
    3.00,
    1.00,
    'd0000000-0000-0000-0000-000000000001'
),
(
    '11000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'Product',
    'SKU-VLV-HP600',
    '600-Class High Pressure Gas Ball Valve 12-inch',
    'Forged steel high pressure gas pipeline ball valve with API 6D certification',
    'PCS',
    450000.00,
    620000.00,
    18.00,
    5.00,
    'd0000000-0000-0000-0000-000000000002'
),
(
    '11000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'Product',
    'SKU-REL-MICOM',
    'Digital Numerical Distance Protection Relay',
    'Microprocessor based grid protection relay with IEC 61850 protocol',
    'PCS',
    280000.00,
    395000.00,
    25.00,
    8.00,
    'd0000000-0000-0000-0000-000000000002'
) ON CONFLICT (id) DO NOTHING;

-- 7. Warehouses
INSERT INTO warehouses (id, tenant_id, warehouse_name, location, city, manager_name, contact_phone)
VALUES 
(
    '22000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Central Warehouse - Kot Lakhpat',
    'Plot 45-B Industrial Estate, Kot Lakhpat',
    'Lahore',
    'M. Bilal Rafiq',
    '0300-4491029'
),
(
    '22000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'Port Qasim Logistics Facility',
    'Warehouse Row 12, Port Qasim Area',
    'Karachi',
    'Farhan Siddiqui',
    '0321-9920194'
) ON CONFLICT (id) DO NOTHING;

-- 8. Opportunities (Tenders & Direct Quotations)
INSERT INTO opportunities (
    id, tenant_id, business_profile_id, opportunity_number, external_tender_number,
    tender_name, title, tender_source, tender_type, customer_id, department,
    publication_date, closing_date, submission_deadline, opening_date, estimated_value,
    selection_status, status, bid_decision
) VALUES 
(
    'f0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'TND-2026-8812',
    'WAPDA-PROC-2026-09',
    'Substation 132kV Expansion Project',
    'Supply & Commissioning of 132kV Substation Equipment & Transformers',
    'PPRA',
    'Public Tender',
    'c0000000-0000-0000-0000-000000000001',
    'Grid System Operations (GSO)',
    '2026-08-01',
    '2026-08-25 14:00:00+05',
    '2026-08-25 11:00:00+05',
    '2026-08-25 11:30:00+05',
    14500000.00,
    'Selected',
    'won',
    'Bid'
),
(
    'f0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000002',
    'TND-2026-9041',
    'SNGPL-ENG-772',
    'Transmission Line Emergency Valve Spares',
    'High Pressure 600-Class Gas Valve Replacement Lot',
    'DGP',
    'Limited Tender',
    'c0000000-0000-0000-0000-000000000002',
    'Engineering & Procurement Wing',
    '2026-08-05',
    '2026-08-29 15:00:00+05',
    '2026-08-29 12:00:00+05',
    '2026-08-29 12:30:00+05',
    8200000.00,
    'Selected',
    'Submitted',
    'Bid'
),
(
    'f0000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'QTN-2026-105',
    'ENGRO-DIR-441',
    'Direct Corporate Supply - Engro Fertilizers',
    'Numerical Protection Relays Direct Supply Order',
    'DIRECT SALES',
    'Direct Sales / Quotation',
    'c0000000-0000-0000-0000-000000000003',
    'Plant Operations & Instrumentation',
    '2026-08-10',
    '2026-09-10 17:00:00+05',
    '2026-09-10 17:00:00+05',
    NULL,
    3950000.00,
    'Selected',
    'Ready to submit',
    'Bid'
) ON CONFLICT (id) DO NOTHING;

-- 9. Auto-Populated Tender Items
INSERT INTO tender_items (id, opportunity_id, product_service_id, item_name, item_description, quantity, unit, estimated_unit_price, estimated_total_price)
VALUES 
(
    '33000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    '11000000-0000-0000-0000-000000000001',
    '132kV Step-Down Transformer 25MVA',
    'High-voltage power transformer with ONAN cooling and OLTC controller',
    1.00,
    'Units',
    14500000.00,
    14500000.00
),
(
    '33000000-0000-0000-0000-000000000002',
    'f0000000-0000-0000-0000-000000000002',
    '11000000-0000-0000-0000-000000000002',
    '600-Class High Pressure Gas Ball Valve 12-inch',
    'Forged steel high pressure gas pipeline ball valve with API 6D certification',
    12.00,
    'PCS',
    620000.00,
    7440000.00
) ON CONFLICT (id) DO NOTHING;

-- 10. Mandatory Bid Securities
INSERT INTO bid_securities (
    id, tenant_id, business_profile_id, opportunity_id, account_title, beneficiary,
    instrument_type, instrument_number, amount, issue_date, expiry_date, bank_name, status, comments
) VALUES 
(
    '44000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'Alpha Engineering Pvt Ltd',
    'Chairman WAPDA Lahore',
    'CDR',
    'CDR-HBL-992019',
    290000.00,
    '2026-08-04',
    '2026-11-25',
    'Habib Bank Limited (HBL) Corporate Branch Lahore',
    'Active',
    '2% Earnest Money Bid Security as per Tender Clause 14.1'
),
(
    '44000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000002',
    'f0000000-0000-0000-0000-000000000002',
    'Alpha Technologies & Supplies',
    'Managing Director SNGPL Lahore',
    'PO',
    'PO-MCB-771029',
    164000.00,
    '2026-08-08',
    '2026-11-30',
    'MCB Bank Limited Mall Road Lahore',
    'Active',
    'Pay Order for SNGPL Valve Bid Security'
) ON CONFLICT (id) DO NOTHING;

-- 11. Bids & Costing
INSERT INTO bids (
    id, tenant_id, business_profile_id, opportunity_id, bid_number,
    supplier_cost_total, logistics_cost_total, labor_cost_total, overhead_cost_total,
    tender_expense_total, desired_markup_pct, desired_profit_amount, final_bid_price, gross_margin_pct, approval_status
) VALUES 
(
    'b0000000-0000-0000-0000-000000000099',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'BID-AE-2026-001',
    10000000.00,
    800000.00,
    700000.00,
    500000.00,
    290000.00,
    18.50,
    2273650.00,
    14563650.00,
    15.61,
    'Management Approved'
) ON CONFLICT (id) DO NOTHING;

-- 12. Award Letters (Won Flow)
INSERT INTO award_letters (
    id, tenant_id, opportunity_id, bid_id, award_number, award_date, award_amount,
    acceptance_deadline, status, remarks
) VALUES 
(
    '55000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000099',
    'LOA-WAPDA-2026-781',
    '2026-08-12',
    14500000.00,
    '2026-08-22',
    'Accepted',
    'Letter of Award accepted by Management'
) ON CONFLICT (id) DO NOTHING;

-- 13. Contracts & Performance Guarantees
INSERT INTO contracts (
    id, tenant_id, business_profile_id, opportunity_id, bid_id, award_letter_id,
    customer_id, contract_number, start_date, end_date, contract_value, payment_terms, delivery_terms, status
) VALUES 
(
    '66000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000099',
    '55000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'CNT-WAPDA-2026-08',
    '2026-08-15',
    '2026-12-31',
    14500000.00,
    '30% Advance, 50% on Delivery Challan, 20% on Testing & Commissioning',
    'DDP WAPDA Substation Site Lahore',
    'Active'
) ON CONFLICT (id) DO NOTHING;

INSERT INTO performance_guarantees (
    id, tenant_id, contract_id, award_letter_id, guarantee_number, bank_name,
    amount, issue_date, expiry_date, status, remarks
) VALUES 
(
    '77000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    '66000000-0000-0000-0000-000000000001',
    '55000000-0000-0000-0000-000000000001',
    'PBG-MEEZAN-5519',
    'Meezan Bank Ltd Corporate Branch Gulberg Lahore',
    1450000.00,
    '2026-08-14',
    '2027-02-28',
    'Active',
    '10% Performance Bond issued for WAPDA Transformer Supply'
) ON CONFLICT (id) DO NOTHING;

-- 14. Customer Purchase Orders
INSERT INTO purchase_orders (
    id, tenant_id, business_profile_id, contract_id, opportunity_id,
    customer_id, po_number, po_date, delivery_deadline, payment_terms,
    total_amount, tax_amount, net_amount, status
) VALUES 
(
    '88000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    '66000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'PO-WAPDA-2026-9901',
    '2026-08-16',
    '2026-10-15',
    'Payment against verified Delivery Challan',
    14500000.00,
    2610000.00,
    17110000.00,
    'Issued'
) ON CONFLICT (id) DO NOTHING;

-- 15. Delivery Challans (PO Required)
INSERT INTO delivery_challans (
    id, tenant_id, business_profile_id, purchase_order_id, customer_id,
    warehouse_id, dc_number, delivery_date, delivery_method, logistics_provider,
    tracking_number, driver_contact, delivery_cost, status, remarks
) VALUES 
(
    '99000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    '88000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    '22000000-0000-0000-0000-000000000001',
    'DC-AE-2026-0081',
    '2026-08-17',
    '3PL',
    'TCS Heavy Freight Logistics',
    'TCS-LHR-882910',
    'Akram Gujjar (0301-5529102)',
    85000.00,
    'Delivered',
    'Transformer successfully offloaded at WAPDA Substation Site'
) ON CONFLICT (id) DO NOTHING;

-- 16. Invoices (Generated Post-DC)
INSERT INTO invoices (
    id, tenant_id, business_profile_id, delivery_challan_id, purchase_order_id,
    contract_id, opportunity_id, customer_id, invoice_number, invoice_date, due_date,
    subtotal, tax_amount, total_amount, paid_amount, status,
    fbr_integration_required, fbr_status, fbr_invoice_number
) VALUES 
(
    'aa000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    '99000000-0000-0000-0000-000000000001',
    '88000000-0000-0000-0000-000000000001',
    '66000000-0000-0000-0000-000000000001',
    'f0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'INV-AE-2026-0041',
    '2026-08-17',
    '2026-09-17',
    14500000.00,
    2610000.00,
    17110000.00,
    10000000.00,
    'Submitted',
    TRUE,
    'FBR Validated',
    'FBR-PRAL-2026-PK-9910294'
) ON CONFLICT (id) DO NOTHING;

-- 17. Payments Received (Check Details)
INSERT INTO payments (
    id, tenant_id, business_profile_id, invoice_id, payment_number, payment_date,
    payment_method, amount, check_no, check_from, bank_account, deposited_in_bank, reference_number, notes
) VALUES 
(
    'ab000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'aa000000-0000-0000-0000-000000000001',
    'PAY-2026-0012',
    '2026-08-17',
    'Cheque',
    10000000.00,
    'CHQ-NBP-0049281',
    'Water & Power Development Authority (WAPDA)',
    'HBL A/C 0192-881920-01',
    'Habib Bank Limited Main Branch Lahore',
    'WAPDA-VCHR-8820',
    'Part payment against Delivery Challan DC-AE-2026-0081 verified receipt'
) ON CONFLICT (id) DO NOTHING;

-- 18. General Company Expenses (13 Standard Categories)
INSERT INTO general_expenses (
    id, tenant_id, business_profile_id, expense_type, expense_name, category, amount, expense_date, paid_to,
    payment_mode, opportunity_id, contract_id, department, remarks
) VALUES 
(
    'ac000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'Tender Expense',
    'Proposal Submission Courier Charges',
    'Courier & Logistics',
    18500.00,
    '2026-08-04',
    'TCS Express',
    'Cash',
    'f0000000-0000-0000-0000-000000000001',
    NULL,
    'Operations',
    'Urgent submission of technical proposal envelopes to WAPDA Head Office'
),
(
    'ac000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'Tender Expense',
    'Transformer Oil Sample Lab Testing',
    'Samples',
    45000.00,
    '2026-08-06',
    'Testing Labs PK',
    'Online',
    'f0000000-0000-0000-0000-000000000001',
    NULL,
    'Quality Assurance',
    'Transformer oil sample dielectric breakdown test report'
),
(
    'ac000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'b0000000-0000-0000-0000-000000000001',
    'General Expense',
    'Generator Diesel & Crane Fuel',
    'Fuel',
    32000.00,
    '2026-08-10',
    'PSO Station',
    'Company Card',
    NULL,
    '66000000-0000-0000-0000-000000000001',
    'Logistics',
    'Site inspection visits and crane generator fuel'
) ON CONFLICT (id) DO NOTHING;
