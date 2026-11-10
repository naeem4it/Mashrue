const db = require('./config/db');

/**
 * Non-Destructive, Additive-Only Modular ERP Schema Migration & Seeder
 * Covers all 10 Core Modules of Mashrue Enterprise BMS:
 *  0. Modular Licensing & Legacy Grandfathering (tenant_modules)
 *  1. Tender Module Standalone Additions (tender_documents, tender_competitor_bids)
 *  2. Tender Notification Radar (public_tender_scrapes, tenant_tender_alert_rules, tender_alert_dispatches)
 *  3. Inventory Enterprise Additions (inventory_transfers, inventory_transfer_items, inventory_adjustments, inventory_adjustment_items)
 *  4. Reporting & Templates Additions (scheduled_reports)
 *  5. Customer Resource Management - CRM (crm_leads, crm_activities)
 *  6. Financial Accounting & Double-Entry GL (coa_accounts, journal_entries, journal_entry_lines)
 *  7. Core HRM (hrm_departments, hrm_designations, hrm_employees, hrm_attendance, hrm_leave_applications)
 *  8. Payroll & Pakistan Section 149 Tax (payroll_salary_structures, payroll_runs, payroll_payslips)
 *  9. Manufacturing ERP (mfg_boms, mfg_bom_items, mfg_work_orders)
 * 10. Taxation & Regulatory Compliance - TaxGuard (tax_jurisdictions, tax_withholding_rules, tax_withholding_deductions, tax_monthly_returns)
 */
async function runModularErpMigration(closeOnFinish = false) {
  console.log('🚀 Starting Non-Destructive Modular ERP Database Migration (10 Modules)...');

  try {
    await db.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`);

    // =========================================================================
    // 0. MODULAR LICENSING LAYER (tenant_modules)
    // =========================================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS tenant_modules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        module_key VARCHAR(50) NOT NULL,
        is_active BOOLEAN DEFAULT TRUE,
        plan_tier VARCHAR(50) DEFAULT 'Enterprise',
        billing_cycle VARCHAR(20) DEFAULT 'Monthly',
        monthly_fee NUMERIC(10, 2) DEFAULT 0.00,
        expires_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, module_key)
      );
    `);

    // Grandfather all existing tenants into all core & enterprise modules
    await db.query(`
      INSERT INTO tenant_modules (tenant_id, module_key, is_active, plan_tier)
      SELECT t.id, m.key, TRUE, 'Enterprise'
      FROM tenants t
      CROSS JOIN (
        VALUES 
          ('mod_tenders'),
          ('mod_quotations'),
          ('mod_bid_security'),
          ('mod_costing_eval'),
          ('mod_supply_dc'),
          ('mod_inventory'),
          ('mod_fbr_invoicing'),
          ('mod_finance_kpi'),
          ('mod_templates'),
          ('mod_notifications'),
          ('mod_crm'),
          ('mod_finance'),
          ('mod_tax_compliance'),
          ('mod_hrm'),
          ('mod_payroll'),
          ('mod_manufacturing')
      ) AS m(key)
      ON CONFLICT (tenant_id, module_key) DO NOTHING;
    `);

    // =========================================================================
    // 1. MODULE 1: TENDER MODULE ADDITIONS (Documents & Competitor Intelligence)
    // =========================================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS tender_documents (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
        document_title VARCHAR(255) NOT NULL,
        document_category VARCHAR(100) NOT NULL DEFAULT 'Technical Bid',
        checklist_status VARCHAR(50) DEFAULT 'Verified',
        file_url TEXT,
        file_size_kb INT DEFAULT 0,
        notes TEXT,
        uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tender_competitor_bids (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
        competitor_name VARCHAR(255) NOT NULL,
        quoted_brand VARCHAR(150),
        technical_score NUMERIC(6, 2),
        financial_bid_amount NUMERIC(18, 4) DEFAULT 0.0000,
        ranking INT DEFAULT 1,
        is_winner BOOLEAN DEFAULT FALSE,
        rejection_grounds TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =========================================================================
    // 2. MODULE 2: TENDER NOTIFICATION RADAR (PPRA / EPADS Scraper & Alerts)
    // =========================================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS public_tender_scrapes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        portal_source VARCHAR(50) NOT NULL,
        tender_ref_number VARCHAR(100) NOT NULL,
        title TEXT NOT NULL,
        organization_name VARCHAR(255) NOT NULL,
        city VARCHAR(100) DEFAULT 'Islamabad',
        province VARCHAR(100) DEFAULT 'Federal',
        publication_date DATE DEFAULT CURRENT_DATE,
        closing_date DATE NOT NULL,
        estimated_cost NUMERIC(18, 2) DEFAULT 0.00,
        bid_security_pct NUMERIC(5, 2) DEFAULT 2.00,
        category VARCHAR(150) DEFAULT 'General Procurement',
        tender_notice_url TEXT,
        document_download_url TEXT,
        raw_html_snippet TEXT,
        scraped_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_portal_tender_ref UNIQUE(portal_source, tender_ref_number)
      );

      CREATE TABLE IF NOT EXISTS tenant_tender_alert_rules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        rule_name VARCHAR(150) NOT NULL,
        keywords TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        excluded_keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
        target_provinces TEXT[] DEFAULT ARRAY['Federal', 'Punjab', 'Sindh', 'KP', 'Balochistan'],
        min_estimated_value NUMERIC(18, 2) DEFAULT 0,
        notification_channels TEXT[] DEFAULT ARRAY['Email', 'InApp'],
        whatsapp_number VARCHAR(30),
        recipient_emails TEXT[] DEFAULT ARRAY[]::TEXT[],
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tender_alert_dispatches (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        rule_id UUID REFERENCES tenant_tender_alert_rules(id) ON DELETE SET NULL,
        public_tender_id UUID NOT NULL REFERENCES public_tender_scrapes(id) ON DELETE CASCADE,
        channel VARCHAR(30) NOT NULL DEFAULT 'Email',
        status VARCHAR(30) DEFAULT 'Sent',
        dispatched_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed sample public tenders for Pakistan PPRA / EPADS Radar
    const sampleScrapes = [
      {
        portal: 'Federal PPRA',
        ref: 'PPRA-FED-2026-8841',
        title: 'Supply, Installation & Commissioning of 11kV Switchgear Panels and 500kVA Distribution Transformers',
        org: 'WAPDA / IESCO Islamabad',
        city: 'Islamabad',
        province: 'Federal',
        cost: 42500000,
        sec: 2.0,
        cat: 'Electrical & Power Equipment',
        daysOut: 14
      },
      {
        portal: 'EPADS',
        ref: 'EPADS-PJB-2026-3910',
        title: 'Procurement of Enterprise Rack Servers, Layer-3 Core Switches & SAN Storage for Data Center Upgrade',
        org: 'Punjab Information Technology Board (PITB)',
        city: 'Lahore',
        province: 'Punjab',
        cost: 28900000,
        sec: 2.0,
        cat: 'Information Technology & Telecom',
        daysOut: 10
      },
      {
        portal: 'Punjab PPRA',
        ref: 'PPRA-LHR-2026-5521',
        title: 'Annual Rate Contract for Surgical Consumables, Diagnostic Reagents & ICU Patient Monitors',
        org: 'Specialized Healthcare & Medical Education Dept Punjab',
        city: 'Lahore',
        province: 'Punjab',
        cost: 64000000,
        sec: 2.0,
        cat: 'Medical Devices & Health Supplies',
        daysOut: 18
      },
      {
        portal: 'Sindh PPRA',
        ref: 'SPPRA-KHI-2026-1194',
        title: 'Rehabilitation of Water Filtration Plant, DI Pipes, Sluice Valves & Solar Pumping Station',
        org: 'Karachi Water & Sewerage Corporation (KWSC)',
        city: 'Karachi',
        province: 'Sindh',
        cost: 51200000,
        sec: 2.5,
        cat: 'Civil, Mechanical & Construction',
        daysOut: 21
      },
      {
        portal: 'KPPRA',
        ref: 'KPPRA-PEW-2026-7732',
        title: 'Supply of 150kW On-Grid Bifacial Solar PV System with Lithium Battery Backup for DHQ Hospitals',
        org: 'Directorate General Health Services KP',
        city: 'Peshawar',
        province: 'KP',
        cost: 34800000,
        sec: 2.0,
        cat: 'Electrical & Power Equipment',
        daysOut: 12
      },
      {
        portal: 'Federal PPRA',
        ref: 'NHA-FED-2026-9902',
        title: 'Procurement of Highway Safety Barriers, Thermoplastic Road Marking Paint & Solar Road Studs',
        org: 'National Highway Authority (NHA)',
        city: 'Islamabad',
        province: 'Federal',
        cost: 19500000,
        sec: 2.0,
        cat: 'Civil, Mechanical & Construction',
        daysOut: 9
      }
    ];

    for (const s of sampleScrapes) {
      await db.query(`
        INSERT INTO public_tender_scrapes (
          portal_source, tender_ref_number, title, organization_name, city, province,
          publication_date, closing_date, estimated_cost, bid_security_pct, category, tender_notice_url
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE + ($7 || ' days')::interval, $8, $9, $10, 'https://ppra.org.pk'
        )
        ON CONFLICT (portal_source, tender_ref_number) DO NOTHING;
      `, [s.portal, s.ref, s.title, s.org, s.city, s.province, s.daysOut, s.cost, s.sec, s.cat]);
    }

    // =========================================================================
    // 3. MODULE 3: INVENTORY MODULE ADDITIONS (Transfers & Reconciliation)
    // =========================================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS inventory_transfers (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        transfer_number VARCHAR(100) NOT NULL,
        from_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        to_warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        transfer_date DATE DEFAULT CURRENT_DATE,
        status VARCHAR(50) DEFAULT 'Completed',
        driver_name VARCHAR(100),
        vehicle_number VARCHAR(100),
        notes TEXT,
        created_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_transfer_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        transfer_id UUID NOT NULL REFERENCES inventory_transfers(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
        quantity NUMERIC(14, 4) NOT NULL,
        unit_cost NUMERIC(18, 4) DEFAULT 0.0000,
        batch_number VARCHAR(100) DEFAULT 'STANDARD'
      );

      CREATE TABLE IF NOT EXISTS inventory_adjustments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
        adjustment_number VARCHAR(100) NOT NULL,
        adjustment_date DATE DEFAULT CURRENT_DATE,
        adjustment_type VARCHAR(50) NOT NULL DEFAULT 'Physical Count Audit',
        total_value_impact NUMERIC(18, 4) DEFAULT 0.0000,
        status VARCHAR(30) DEFAULT 'Posted',
        remarks TEXT,
        approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS inventory_adjustment_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        adjustment_id UUID NOT NULL REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
        product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
        system_stock NUMERIC(14, 4) NOT NULL DEFAULT 0,
        physical_stock NUMERIC(14, 4) NOT NULL DEFAULT 0,
        difference_qty NUMERIC(14, 4) NOT NULL DEFAULT 0,
        unit_cost NUMERIC(18, 4) NOT NULL DEFAULT 0,
        batch_number VARCHAR(100) DEFAULT 'STANDARD'
      );
    `);

    // =========================================================================
    // 4. MODULE 4: REPORTING + TEMPLATES ADDITIONS (Scheduled Reports)
    // =========================================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS scheduled_reports (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        report_type VARCHAR(100) NOT NULL,
        frequency VARCHAR(30) NOT NULL DEFAULT 'Weekly',
        destination_emails TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
        format VARCHAR(20) DEFAULT 'PDF',
        filter_criteria JSONB DEFAULT '{}'::jsonb,
        is_active BOOLEAN DEFAULT TRUE,
        last_run_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =========================================================================
    // 5. MODULE 5: CUSTOMER RESOURCE MANAGEMENT (CRM)
    // =========================================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS crm_leads (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        lead_code VARCHAR(100) NOT NULL,
        lead_source VARCHAR(100) DEFAULT 'PPRA Radar',
        company_name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(150),
        contact_email VARCHAR(150),
        contact_phone VARCHAR(50),
        department VARCHAR(150),
        city VARCHAR(100) DEFAULT 'Lahore',
        pipeline_stage VARCHAR(50) DEFAULT 'New Lead',
        win_probability INT DEFAULT 25,
        estimated_deal_value NUMERIC(18, 4) DEFAULT 0.0000,
        converted_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
        assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
        status VARCHAR(30) DEFAULT 'Active',
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS crm_activities (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        lead_id UUID REFERENCES crm_leads(id) ON DELETE CASCADE,
        customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
        activity_type VARCHAR(50) NOT NULL DEFAULT 'Phone Call',
        subject VARCHAR(255) NOT NULL,
        scheduled_at DATE DEFAULT CURRENT_DATE,
        completed_at TIMESTAMP WITH TIME ZONE,
        status VARCHAR(30) DEFAULT 'Completed',
        outcome TEXT,
        conducted_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =========================================================================
    // 6. MODULE 6: FINANCIAL ACCOUNTING & DOUBLE-ENTRY GENERAL LEDGER
    // =========================================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS coa_accounts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        account_code VARCHAR(50) NOT NULL,
        account_name VARCHAR(255) NOT NULL,
        account_type VARCHAR(50) NOT NULL,
        account_sub_type VARCHAR(100),
        parent_account_id UUID REFERENCES coa_accounts(id) ON DELETE SET NULL,
        currency VARCHAR(10) DEFAULT 'PKR',
        opening_balance NUMERIC(18, 4) DEFAULT 0.0000,
        is_reconcilable BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, account_code)
      );

      CREATE TABLE IF NOT EXISTS journal_entries (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        entry_number VARCHAR(100) NOT NULL,
        entry_date DATE DEFAULT CURRENT_DATE,
        reference_type VARCHAR(50) DEFAULT 'Manual Voucher',
        reference_id UUID,
        narration TEXT NOT NULL,
        total_debit NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        total_credit NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        is_posted BOOLEAN DEFAULT TRUE,
        posted_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS journal_entry_lines (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_id UUID NOT NULL REFERENCES coa_accounts(id) ON DELETE CASCADE,
        line_description TEXT,
        debit NUMERIC(18, 4) DEFAULT 0.0000,
        credit NUMERIC(18, 4) DEFAULT 0.0000,
        party_type VARCHAR(50),
        party_id UUID
      );
    `);

    // =========================================================================
    // 7. MODULE 7: HRM (CORE HUMAN RESOURCE MANAGEMENT)
    // =========================================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS hrm_departments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        department_name VARCHAR(150) NOT NULL,
        department_code VARCHAR(50),
        head_of_department UUID,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, department_name)
      );

      CREATE TABLE IF NOT EXISTS hrm_designations (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        designation_name VARCHAR(150) NOT NULL,
        grade_level VARCHAR(50) DEFAULT 'G-1',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, designation_name)
      );

      CREATE TABLE IF NOT EXISTS hrm_employees (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        employee_code VARCHAR(100) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100),
        cnic VARCHAR(25) NOT NULL,
        gender VARCHAR(20) DEFAULT 'Male',
        date_of_birth DATE,
        department_id UUID REFERENCES hrm_departments(id) ON DELETE SET NULL,
        designation_id UUID REFERENCES hrm_designations(id) ON DELETE SET NULL,
        department_name VARCHAR(150),
        designation_name VARCHAR(150),
        employment_type VARCHAR(50) DEFAULT 'Permanent',
        joining_date DATE DEFAULT CURRENT_DATE,
        confirmation_date DATE,
        official_email VARCHAR(150),
        personal_phone VARCHAR(50),
        emergency_contact VARCHAR(100),
        emergency_phone VARCHAR(50),
        current_address TEXT,
        bank_name VARCHAR(150),
        bank_account_title VARCHAR(150),
        bank_iban VARCHAR(100),
        basic_salary NUMERIC(14, 2) DEFAULT 0.00,
        gross_salary NUMERIC(14, 2) DEFAULT 0.00,
        filer_status VARCHAR(30) DEFAULT 'Filer',
        employment_status VARCHAR(50) DEFAULT 'Active',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, employee_code)
      );

      CREATE TABLE IF NOT EXISTS hrm_attendance (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        employee_id UUID NOT NULL REFERENCES hrm_employees(id) ON DELETE CASCADE,
        attendance_date DATE NOT NULL DEFAULT CURRENT_DATE,
        check_in_time VARCHAR(20) DEFAULT '09:00',
        check_out_time VARCHAR(20) DEFAULT '17:30',
        status VARCHAR(30) DEFAULT 'Present',
        work_hours NUMERIC(5, 2) DEFAULT 8.00,
        remarks TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, attendance_date)
      );

      CREATE TABLE IF NOT EXISTS hrm_leave_applications (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        employee_id UUID NOT NULL REFERENCES hrm_employees(id) ON DELETE CASCADE,
        leave_type VARCHAR(50) NOT NULL DEFAULT 'Casual',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        total_days NUMERIC(4, 1) NOT NULL DEFAULT 1.0,
        reason TEXT,
        status VARCHAR(30) DEFAULT 'Approved',
        approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =========================================================================
    // 8. MODULE 8: PAYROLL MODULE (Pakistan Section 149 Slabs, EOBI & Payslips)
    // =========================================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS payroll_salary_structures (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        employee_id UUID UNIQUE NOT NULL REFERENCES hrm_employees(id) ON DELETE CASCADE,
        basic_salary NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        house_rent_allowance NUMERIC(14, 2) DEFAULT 0.00,
        medical_allowance NUMERIC(14, 2) DEFAULT 0.00,
        conveyance_allowance NUMERIC(14, 2) DEFAULT 0.00,
        other_allowances NUMERIC(14, 2) DEFAULT 0.00,
        gross_salary NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        eobi_enabled BOOLEAN DEFAULT TRUE,
        pessi_enabled BOOLEAN DEFAULT FALSE,
        income_tax_auto BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payroll_runs (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        payroll_month INT NOT NULL,
        payroll_year INT NOT NULL,
        total_employees INT NOT NULL DEFAULT 0,
        total_gross NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        total_tax_deducted NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        total_eobi_deducted NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        total_deductions NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        total_net_payable NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        status VARCHAR(30) DEFAULT 'Approved',
        journal_entry_id UUID REFERENCES journal_entries(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS payroll_payslips (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        payroll_run_id UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
        employee_id UUID NOT NULL REFERENCES hrm_employees(id) ON DELETE CASCADE,
        basic_salary NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        total_allowances NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        gross_salary NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        income_tax_deduction NUMERIC(14, 2) DEFAULT 0.00,
        eobi_employee_deduction NUMERIC(14, 2) DEFAULT 0.00,
        eobi_employer_contribution NUMERIC(14, 2) DEFAULT 0.00,
        loan_deduction NUMERIC(14, 2) DEFAULT 0.00,
        unpaid_leave_deduction NUMERIC(14, 2) DEFAULT 0.00,
        total_deductions NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        net_salary NUMERIC(14, 2) NOT NULL DEFAULT 0.00,
        payment_method VARCHAR(50) DEFAULT 'Bank Transfer',
        is_paid BOOLEAN DEFAULT TRUE,
        paid_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =========================================================================
    // 9. MODULE 9: MANUFACTURING MODULE (BOM & Production Work Orders)
    // =========================================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS mfg_boms (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        bom_code VARCHAR(100) NOT NULL,
        bom_name VARCHAR(255),
        finished_product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
        bom_version INT DEFAULT 1,
        output_quantity NUMERIC(14, 4) NOT NULL DEFAULT 1.0000,
        output_uom_id UUID REFERENCES uom_masters(id) ON DELETE SET NULL,
        labor_cost_estimate NUMERIC(18, 4) DEFAULT 0.0000,
        overhead_cost_estimate NUMERIC(18, 4) DEFAULT 0.0000,
        material_cost_estimate NUMERIC(18, 4) DEFAULT 0.0000,
        total_estimated_unit_cost NUMERIC(18, 4) DEFAULT 0.0000,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, bom_code)
      );

      CREATE TABLE IF NOT EXISTS mfg_bom_items (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        bom_id UUID NOT NULL REFERENCES mfg_boms(id) ON DELETE CASCADE,
        raw_material_product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
        required_quantity NUMERIC(14, 4) NOT NULL DEFAULT 1.0000,
        uom_id UUID REFERENCES uom_masters(id) ON DELETE SET NULL,
        scrap_allowance_pct NUMERIC(6, 2) DEFAULT 0.00,
        unit_cost NUMERIC(18, 4) DEFAULT 0.0000,
        total_cost NUMERIC(18, 4) DEFAULT 0.0000
      );

      CREATE TABLE IF NOT EXISTS mfg_work_orders (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        order_number VARCHAR(100) NOT NULL,
        bom_id UUID NOT NULL REFERENCES mfg_boms(id) ON DELETE CASCADE,
        target_product_id UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
        target_quantity NUMERIC(14, 4) NOT NULL DEFAULT 1.0000,
        produced_quantity NUMERIC(14, 4) DEFAULT 0.0000,
        rejected_quantity NUMERIC(14, 4) DEFAULT 0.0000,
        raw_materials_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
        finished_goods_warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
        start_date DATE DEFAULT CURRENT_DATE,
        due_date DATE,
        completed_date DATE,
        status VARCHAR(50) DEFAULT 'In Production',
        opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
        purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
        actual_material_cost NUMERIC(18, 4) DEFAULT 0.0000,
        actual_labor_cost NUMERIC(18, 4) DEFAULT 0.0000,
        actual_overhead_cost NUMERIC(18, 4) DEFAULT 0.0000,
        total_production_cost NUMERIC(18, 4) DEFAULT 0.0000,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =========================================================================
    // 10. MODULE 10: TAXATION & REGULATORY COMPLIANCE (Mashrue TaxGuard)
    // =========================================================================
    await db.query(`
      CREATE TABLE IF NOT EXISTS tax_jurisdictions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        jurisdiction_code VARCHAR(30) NOT NULL,
        authority_name VARCHAR(150) NOT NULL,
        tax_type VARCHAR(50) NOT NULL,
        standard_rate NUMERIC(6, 2) NOT NULL DEFAULT 18.00,
        further_tax_rate NUMERIC(6, 2) DEFAULT 4.00,
        reduced_rate NUMERIC(6, 2) DEFAULT 0.00,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, jurisdiction_code, tax_type)
      );

      CREATE TABLE IF NOT EXISTS tax_withholding_rules (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        section_code VARCHAR(50) NOT NULL,
        filer_rate NUMERIC(6, 2) NOT NULL,
        non_filer_rate NUMERIC(6, 2) NOT NULL,
        threshold_amount NUMERIC(18, 2) DEFAULT 75000.00,
        description TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, section_code)
      );

      CREATE TABLE IF NOT EXISTS tax_withholding_deductions (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        transaction_type VARCHAR(80) NOT NULL DEFAULT 'Deducted by Client on Our Invoice',
        party_name VARCHAR(255),
        party_ntn VARCHAR(50),
        invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
        payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
        vendor_expense_id UUID REFERENCES general_expenses(id) ON DELETE SET NULL,
        section_code VARCHAR(50) NOT NULL DEFAULT '153(1)(a) Goods',
        taxable_amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        wht_rate NUMERIC(6, 2) NOT NULL DEFAULT 5.00,
        wht_amount NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        cpr_number VARCHAR(100),
        cpr_date DATE DEFAULT CURRENT_DATE,
        cpr_certificate_url TEXT,
        status VARCHAR(40) DEFAULT 'Verified / CPR Attached',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tax_monthly_returns (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        business_profile_id UUID REFERENCES business_profiles(id) ON DELETE SET NULL,
        tax_month INT NOT NULL,
        tax_year INT NOT NULL,
        jurisdiction_code VARCHAR(30) DEFAULT 'FBR_FED',
        total_sales_value NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        total_output_tax NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        total_purchases_value NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        total_input_tax NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        total_wht_adjustable NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        net_tax_payable NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
        annex_c_json JSONB DEFAULT '[]'::jsonb,
        annex_a_json JSONB DEFAULT '[]'::jsonb,
        filing_status VARCHAR(30) DEFAULT 'Draft',
        iris_acknowledgement_number VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // =========================================================================
    // SEED STANDARD PAKISTAN COA, TAX JURISDICTIONS, WHT RULES & DEPARTMENTS PER TENANT
    // =========================================================================
    const tenantsRes = await db.query(`SELECT id FROM tenants`);

    const defaultCoa = [
      { code: '1001', name: 'Cash in Hand / Petty Cash', type: 'Asset', sub: 'Current Asset' },
      { code: '1010', name: 'Corporate Bank Accounts (HBL / Meezan / MCB)', type: 'Asset', sub: 'Bank & Cash', rec: true },
      { code: '1200', name: 'Accounts Receivable (Trade & Govt Clients)', type: 'Asset', sub: 'Current Asset' },
      { code: '1250', name: 'Bid Security / CDR Earnest Money Deposits', type: 'Asset', sub: 'Current Asset', rec: true },
      { code: '1300', name: 'Merchandise & Warehouse Inventory Asset', type: 'Asset', sub: 'Inventory' },
      { code: '1400', name: 'Advance Income Tax Deducted at Source (u/s 153 WHT)', type: 'Asset', sub: 'Tax Asset' },
      { code: '1450', name: 'Sales Tax Input Credit (Annex-A Adjustable)', type: 'Asset', sub: 'Tax Asset' },
      { code: '2001', name: 'Accounts Payable (Suppliers & Vendors)', type: 'Liability', sub: 'Current Liability' },
      { code: '2100', name: 'FBR / Provincial Sales Tax Output Payable (Annex-C)', type: 'Liability', sub: 'Tax Liability' },
      { code: '2150', name: 'Withholding Tax Payable to FBR (u/s 149 & 153)', type: 'Liability', sub: 'Tax Liability' },
      { code: '2200', name: 'Accrued Salaries, EOBI & PESSI Payable', type: 'Liability', sub: 'Current Liability' },
      { code: '3001', name: 'Owner / Share Capital Account', type: 'Equity', sub: 'Equity' },
      { code: '3100', name: 'Retained Earnings & Reserves', type: 'Equity', sub: 'Equity' },
      { code: '4001', name: 'Public Procurement & Tender Contract Revenue', type: 'Revenue', sub: 'Operating Revenue' },
      { code: '4010', name: 'Direct Commercial Quotations & Sales Revenue', type: 'Revenue', sub: 'Operating Revenue' },
      { code: '5001', name: 'Cost of Goods Sold (COGS) & Procurement Cost', type: 'Expense', sub: 'Direct Cost' },
      { code: '5100', name: 'Staff Salaries, Allowances & Benefits', type: 'Expense', sub: 'Operating Expense' },
      { code: '5200', name: 'Tender Fee, CDR Charges, e-Stamp Duty & DTL Testing', type: 'Expense', sub: 'Bidding Direct Cost' },
      { code: '5300', name: 'Freight, Bilty, Delivery & Customs Clearing', type: 'Expense', sub: 'Logistics Cost' },
      { code: '5400', name: 'General Office Rent, Utilities & Admin Overheads', type: 'Expense', sub: 'Operating Expense' }
    ];

    const defaultJurisdictions = [
      { code: 'FBR_FED', auth: 'Federal Board of Revenue (FBR Pakistan)', type: 'Sales Tax on Goods (GST)', std: 18.00, further: 4.00 },
      { code: 'PRA_PUNJAB', auth: 'Punjab Revenue Authority (PRA)', type: 'Sales Tax on Services', std: 16.00, further: 0.00 },
      { code: 'SRB_SINDH', auth: 'Sindh Revenue Board (SRB)', type: 'Sales Tax on Services', std: 13.00, further: 0.00 },
      { code: 'KPRA_KP', auth: 'Khyber Pakhtunkhwa Revenue Authority (KPRA)', type: 'Sales Tax on Services', std: 15.00, further: 0.00 },
      { code: 'BRA_BALOCHISTAN', auth: 'Balochistan Revenue Authority (BRA)', type: 'Sales Tax on Services', std: 15.00, further: 0.00 }
    ];

    const defaultWhtRules = [
      { code: '153(1)(a) Goods', filer: 5.00, nonFiler: 10.00, thresh: 75000, desc: 'Supply of General Goods & Equipment u/s 153(1)(a)' },
      { code: '153(1)(a) Pharma/Dist', filer: 1.00, nonFiler: 2.00, thresh: 75000, desc: 'Fast Moving Consumer Goods, Pharma & Fertilizer Distributors' },
      { code: '153(1)(b) Services', filer: 9.00, nonFiler: 18.00, thresh: 30000, desc: 'Rendering or Providing of Services u/s 153(1)(b)' },
      { code: '153(1)(b) IT Services', filer: 4.00, nonFiler: 8.00, thresh: 30000, desc: 'IT & ITeS Enabled Technical Services' },
      { code: '153(1)(c) Contracts', filer: 7.50, nonFiler: 15.00, thresh: 0, desc: 'Execution of Civil/EPC Turnkey Contracts u/s 153(1)(c)' },
      { code: '149 Salary Slabs', filer: 0.00, nonFiler: 0.00, thresh: 600000, desc: 'Progressive Annual Salary Income Tax Slabs (Finance Act 2026)' }
    ];

    const defaultDepartments = [
      { code: 'DEPT-TND', name: 'Commercial Bidding & Tenders Desk' },
      { code: 'DEPT-SCM', name: 'Procurement, Supply Chain & Logistics' },
      { code: 'DEPT-FIN', name: 'Finance, Accounts & FBR Compliance' },
      { code: 'DEPT-SLS', name: 'Corporate Sales & Client Relations (CRM)' },
      { code: 'DEPT-OPS', name: 'Warehouse, Quality & Production Operations' }
    ];

    const defaultDesignations = [
      { name: 'Chief Executive Officer (CEO)', grade: 'G-Exec' },
      { name: 'Head of Tenders & Commercial Bidding', grade: 'G-1' },
      { name: 'Procurement & Supply Chain Manager', grade: 'G-2' },
      { name: 'Senior Accounts & Tax Officer', grade: 'G-2' },
      { name: 'Bid Estimation & BoQ Engineer', grade: 'G-3' },
      { name: 'Warehouse & Logistics Supervisor', grade: 'G-4' }
    ];

    for (const t of tenantsRes.rows) {
      const tid = t.id;

      for (const acc of defaultCoa) {
        await db.query(`
          INSERT INTO coa_accounts (tenant_id, account_code, account_name, account_type, account_sub_type, is_reconcilable)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (tenant_id, account_code) DO NOTHING;
        `, [tid, acc.code, acc.name, acc.type, acc.sub, !!acc.rec]);
      }

      for (const jur of defaultJurisdictions) {
        await db.query(`
          INSERT INTO tax_jurisdictions (tenant_id, jurisdiction_code, authority_name, tax_type, standard_rate, further_tax_rate)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (tenant_id, jurisdiction_code, tax_type) DO NOTHING;
        `, [tid, jur.code, jur.auth, jur.type, jur.std, jur.further]);
      }

      for (const wht of defaultWhtRules) {
        await db.query(`
          INSERT INTO tax_withholding_rules (tenant_id, section_code, filer_rate, non_filer_rate, threshold_amount, description)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (tenant_id, section_code) DO NOTHING;
        `, [tid, wht.code, wht.filer, wht.nonFiler, wht.thresh, wht.desc]);
      }

      for (const dept of defaultDepartments) {
        await db.query(`
          INSERT INTO hrm_departments (tenant_id, department_code, department_name)
          VALUES ($1, $2, $3)
          ON CONFLICT (tenant_id, department_name) DO NOTHING;
        `, [tid, dept.code, dept.name]);
      }

      for (const desig of defaultDesignations) {
        await db.query(`
          INSERT INTO hrm_designations (tenant_id, designation_name, grade_level)
          VALUES ($1, $2, $3)
          ON CONFLICT (tenant_id, designation_name) DO NOTHING;
        `, [tid, desig.name, desig.grade]);
      }
    }

    // Performance Indexes
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_modules_tid ON tenant_modules (tenant_id, module_key);
      CREATE INDEX IF NOT EXISTS idx_public_scrapes_closing ON public_tender_scrapes (closing_date DESC);
      CREATE INDEX IF NOT EXISTS idx_crm_leads_tid ON crm_leads (tenant_id, pipeline_stage);
      CREATE INDEX IF NOT EXISTS idx_coa_accounts_tid ON coa_accounts (tenant_id, account_type);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_tid ON journal_entries (tenant_id, entry_date DESC);
      CREATE INDEX IF NOT EXISTS idx_hrm_employees_tid ON hrm_employees (tenant_id, employment_status);
      CREATE INDEX IF NOT EXISTS idx_payroll_runs_tid ON payroll_runs (tenant_id, payroll_year DESC, payroll_month DESC);
      CREATE INDEX IF NOT EXISTS idx_mfg_work_orders_tid ON mfg_work_orders (tenant_id, status);
      CREATE INDEX IF NOT EXISTS idx_tax_wht_deductions_tid ON tax_withholding_deductions (tenant_id, cpr_date DESC);
    `);

    console.log('✅ Modular ERP 10-Module Schema & Seed Data verified and ready!');
    if (closeOnFinish) process.exit(0);
  } catch (err) {
    console.error('⚠️ Modular ERP Migration Warning:', err.message);
    if (closeOnFinish) process.exit(1);
  }
}

if (require.main === module) {
  runModularErpMigration(true);
}

module.exports = { runModularErpMigration };

