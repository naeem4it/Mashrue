/**
 * ============================================================================
 * MODULE 5: CUSTOMER RELATIONSHIP MANAGEMENT (CRM) ENGINE
 * ============================================================================
 * Comprehensive B2B CRM Suite:
 *  - Customer & Prospect Directory (Multi-contact, addresses, lifecycle, duplicate detection & merging)
 *  - Lead Intake & Kanban Sales Pipeline (crm_leads)
 *  - Opportunity & Deal Tracking with Probability & Close Dates (crm_opportunities)
 *  - Activity Timeline, Task Scheduling, Call Logs & Calendar (crm_activities)
 *  - Customer Service Tickets, Complaints & SLA Targets (crm_cases)
 *  - Customer 360° Unified Multi-Module Profile
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireModuleLicense, resolveTenantId } = require('../middleware/rbac.middleware');

const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val || ''));

// Auto-migrate CRM Schema extensions on startup
const initCrmSchema = async () => {
  try {
    await db.query(`
      -- 1. Extend Customers table with CRM fields
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_prospect BOOLEAN DEFAULT FALSE;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS lifecycle_stage VARCHAR(50) DEFAULT 'active_customer';
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS classification VARCHAR(50) DEFAULT 'Standard';
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS industry VARCHAR(100);
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS territory VARCHAR(100);
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS lead_source VARCHAR(100);
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS assigned_owner_id UUID REFERENCES users(id);
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[];
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS custom_fields JSONB DEFAULT '{}'::jsonb;
      ALTER TABLE customers ADD COLUMN IF NOT EXISTS merged_into_id UUID;

      -- 2. Customer Contacts
      CREATE TABLE IF NOT EXISTS customer_contacts (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        designation VARCHAR(100),
        department VARCHAR(100),
        email VARCHAR(150),
        phone VARCHAR(50),
        mobile VARCHAR(50),
        is_primary BOOLEAN DEFAULT FALSE,
        communication_preference VARCHAR(50) DEFAULT 'email',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_customer_contacts_cid ON customer_contacts(customer_id);

      -- 3. Customer Addresses
      CREATE TABLE IF NOT EXISTS customer_addresses (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        address_type VARCHAR(50) DEFAULT 'Billing',
        address_line1 TEXT NOT NULL,
        city VARCHAR(100),
        state_province VARCHAR(100),
        postal_code VARCHAR(20),
        country VARCHAR(100) DEFAULT 'Pakistan',
        is_default BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_customer_addresses_cid ON customer_addresses(customer_id);

      -- 4. Customer Notes
      CREATE TABLE IF NOT EXISTS customer_notes (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        note_text TEXT NOT NULL,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_customer_notes_cid ON customer_notes(customer_id);

      -- 5. Extend CRM Leads table
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'Medium';
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS next_action VARCHAR(255);
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS next_action_date DATE;
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS expected_close_date DATE;
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS lost_reason TEXT;
      ALTER TABLE crm_leads ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[];

      -- 6. CRM Opportunities (Qualified B2B Deals)
      CREATE TABLE IF NOT EXISTS crm_opportunities (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        lead_id UUID REFERENCES crm_leads(id) ON DELETE SET NULL,
        opportunity_code VARCHAR(50) NOT NULL,
        deal_name VARCHAR(200) NOT NULL,
        stage VARCHAR(50) DEFAULT 'Discovery', -- 'Discovery', 'Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'
        expected_revenue NUMERIC(15, 2) DEFAULT 0,
        win_probability INTEGER DEFAULT 30,
        expected_close_date DATE,
        next_step VARCHAR(255),
        lead_source VARCHAR(100),
        priority VARCHAR(20) DEFAULT 'Medium',
        lost_reason TEXT,
        assigned_to UUID REFERENCES users(id),
        tags TEXT[] DEFAULT '{}'::text[],
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_crm_opps_cid ON crm_opportunities(customer_id);

      -- 7. Extend CRM Activities table
      ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS opportunity_id UUID;
      ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS case_id UUID;
      ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'Medium';
      ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS due_date TIMESTAMP WITH TIME ZONE;
      ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS communication_channel VARCHAR(50) DEFAULT 'Phone';
      ALTER TABLE crm_activities ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

      -- 8. Customer Support Cases / Helpdesk
      CREATE TABLE IF NOT EXISTS crm_cases (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        case_number VARCHAR(50) NOT NULL,
        subject VARCHAR(200) NOT NULL,
        category VARCHAR(100) DEFAULT 'Technical Support',
        priority VARCHAR(20) DEFAULT 'Medium',
        status VARCHAR(30) DEFAULT 'Open',
        assigned_to UUID REFERENCES users(id),
        sla_target_hours INTEGER DEFAULT 24,
        sla_due_at TIMESTAMP WITH TIME ZONE,
        resolved_at TIMESTAMP WITH TIME ZONE,
        resolution_summary TEXT,
        customer_satisfaction_rating INTEGER,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_crm_cases_cid ON crm_cases(customer_id);

      -- 9. Case Comments
      CREATE TABLE IF NOT EXISTS crm_case_comments (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id UUID NOT NULL,
        case_id UUID NOT NULL REFERENCES crm_cases(id) ON DELETE CASCADE,
        author_id UUID REFERENCES users(id),
        comment_text TEXT NOT NULL,
        is_internal BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_crm_case_comments ON crm_case_comments(case_id);
    `);
  } catch (err) {
    console.warn('CRM Schema init warning:', err.message);
  }
};
initCrmSchema();

// ============================================================================
// 1. CUSTOMERS & PROSPECTS DIRECTORY
// ============================================================================

// GET Customers / Prospects list
router.get('/customers', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const { lifecycle_stage, classification, industry, territory, is_archived, search, limit = 100, offset = 0 } = req.query;

    let queryText = `
      SELECT c.*, c.business_name as name,
             u.full_name as assigned_owner_name,
             (SELECT COUNT(*) FROM customer_contacts cc WHERE cc.customer_id = c.id) as contacts_count,
             (SELECT COUNT(*) FROM crm_opportunities co WHERE co.customer_id = c.id) as deals_count,
             (SELECT COUNT(*) FROM crm_cases cs WHERE cs.customer_id = c.id AND cs.status != 'Closed') as open_cases_count
      FROM customers c
      LEFT JOIN users u ON c.assigned_owner_id = u.id
      WHERE c.tenant_id = $1
    `;
    const params = [tenantId];

    if (lifecycle_stage && lifecycle_stage !== 'all') {
      params.push(lifecycle_stage);
      queryText += ` AND c.lifecycle_stage = $${params.length}`;
    }

    if (classification && classification !== 'all') {
      params.push(classification);
      queryText += ` AND c.classification = $${params.length}`;
    }

    if (industry && industry !== 'all') {
      params.push(industry);
      queryText += ` AND c.industry = $${params.length}`;
    }

    if (territory && territory !== 'all') {
      params.push(territory);
      queryText += ` AND c.territory = $${params.length}`;
    }

    if (is_archived === 'true') {
      queryText += ` AND COALESCE(c.is_archived, FALSE) = TRUE`;
    } else {
      queryText += ` AND COALESCE(c.is_archived, FALSE) = FALSE`;
    }

    if (search && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      queryText += ` AND (c.business_name ILIKE $${params.length} OR c.email ILIKE $${params.length} OR c.phone ILIKE $${params.length} OR c.ntn ILIKE $${params.length} OR c.city ILIKE $${params.length})`;
    }

    queryText += ` ORDER BY c.business_name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Single Customer Profile with Contacts, Addresses & Notes
router.get('/customers/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const { id } = req.params;

    const [custRes, contactsRes, addrRes, notesRes] = await Promise.all([
      db.query(`SELECT c.*, u.full_name as assigned_owner_name FROM customers c LEFT JOIN users u ON c.assigned_owner_id = u.id WHERE c.id = $1 AND c.tenant_id = $2`, [id, tenantId]),
      db.query(`SELECT * FROM customer_contacts WHERE customer_id = $1 AND tenant_id = $2 ORDER BY is_primary DESC, created_at ASC`, [id, tenantId]),
      db.query(`SELECT * FROM customer_addresses WHERE customer_id = $1 AND tenant_id = $2 ORDER BY is_default DESC, created_at ASC`, [id, tenantId]),
      db.query(`SELECT cn.*, u.full_name as author_name FROM customer_notes cn LEFT JOIN users u ON cn.created_by = u.id WHERE cn.customer_id = $1 AND cn.tenant_id = $2 ORDER BY cn.created_at DESC`, [id, tenantId])
    ]);

    if (custRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    res.json({
      success: true,
      data: {
        ...custRes.rows[0],
        contacts: contactsRes.rows,
        addresses: addrRes.rows,
        notes: notesRes.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Create Customer / Prospect
router.post('/customers', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const business_name = (req.body.business_name || req.body.name || '').trim();
  const {
    customer_type = 'Business', org_type = 'Private', ntn, strn,
    contact_person, email, phone, address, city = 'Lahore', province = 'Punjab',
    lifecycle_stage = 'active_customer', classification = 'Standard', industry, territory,
    lead_source = 'Direct', credit_limit = 0, payment_terms = '30 Days Net', notes,
    contacts = [], addresses = [], is_prospect
  } = req.body;

  if (!business_name) {
    return res.status(400).json({ success: false, message: 'Business / Customer Name is required.' });
  }

  try {
    const tenantId = await resolveTenantId(req, db);
    const customerCode = `CUST-${Date.now().toString().slice(-6)}`;
    const isProspectVal = is_prospect !== undefined ? !!is_prospect : (lifecycle_stage === 'prospect');

    const insertRes = await db.query(`
      INSERT INTO customers (
        tenant_id, customer_code, business_name, customer_type, org_type, ntn, strn,
        contact_person, email, phone, address, city, province, country,
        lifecycle_stage, classification, industry, territory, lead_source,
        credit_limit, payment_terms, notes, assigned_owner_id, status, is_prospect
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Pakistan',$14,$15,$16,$17,$18,$19,$20,$21,$22,'Active',$23)
      RETURNING *, business_name as name
    `, [
      tenantId, customerCode, business_name, customer_type, org_type,
      ntn || null, strn || null, contact_person || null, email || null, phone || null,
      address || null, city, province,
      lifecycle_stage, classification, industry || null, territory || null, lead_source,
      parseFloat(credit_limit || 0), payment_terms, notes || '', req.user?.id || null, isProspectVal
    ]);

    const createdCustomer = insertRes.rows[0];

    // Insert contacts if provided
    if (Array.isArray(contacts) && contacts.length > 0) {
      for (const c of contacts) {
        if (c.name) {
          await db.query(`
            INSERT INTO customer_contacts (tenant_id, customer_id, name, designation, department, email, phone, is_primary)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          `, [tenantId, createdCustomer.id, c.name, c.designation || '', c.department || '', c.email || '', c.phone || '', !!c.is_primary]);
        }
      }
    }

    res.status(201).json({ success: true, data: createdCustomer, message: 'Customer profile created successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT Update Customer
router.put('/customers/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { id } = req.params;
  const {
    business_name, customer_type, org_type, ntn, strn, contact_person, email, phone,
    address, city, province, lifecycle_stage, classification, industry, territory,
    lead_source, credit_limit, payment_terms, notes, status
  } = req.body;

  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(`
      UPDATE customers SET
        business_name = COALESCE($1, business_name),
        customer_type = COALESCE($2, customer_type),
        org_type = COALESCE($3, org_type),
        ntn = COALESCE($4, ntn),
        strn = COALESCE($5, strn),
        contact_person = COALESCE($6, contact_person),
        email = COALESCE($7, email),
        phone = COALESCE($8, phone),
        address = COALESCE($9, address),
        city = COALESCE($10, city),
        province = COALESCE($11, province),
        lifecycle_stage = COALESCE($12, lifecycle_stage),
        classification = COALESCE($13, classification),
        industry = COALESCE($14, industry),
        territory = COALESCE($15, territory),
        lead_source = COALESCE($16, lead_source),
        credit_limit = COALESCE($17, credit_limit),
        payment_terms = COALESCE($18, payment_terms),
        notes = COALESCE($19, notes),
        status = COALESCE($20, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $21 AND tenant_id = $22
      RETURNING *
    `, [
      business_name ? business_name.trim() : null, customer_type, org_type,
      ntn, strn, contact_person, email, phone, address, city, province,
      lifecycle_stage, classification, industry, territory, lead_source,
      credit_limit ? parseFloat(credit_limit) : null, payment_terms, notes, status,
      id, tenantId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    res.json({ success: true, data: result.rows[0], message: 'Customer profile updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Archive Customer
router.post('/customers/:id/archive', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(
      `UPDATE customers SET is_archived = TRUE, status = 'Archived', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, message: 'Customer archived' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Restore Customer
router.post('/customers/:id/restore', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(
      `UPDATE customers SET is_archived = FALSE, status = 'Active', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, tenantId]
    );
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, message: 'Customer restored to Active' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Detect Duplicates in Customer Master
router.post('/customers/detect-duplicates', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const { business_name, email, phone, ntn } = req.body;

    let queryText = `
      SELECT id, business_name, email, phone, ntn, city, lifecycle_stage
      FROM customers
      WHERE tenant_id = $1 AND COALESCE(is_archived, FALSE) = FALSE AND (
    `;
    const conditions = [];
    const params = [tenantId];

    if (ntn && ntn.trim()) {
      params.push(ntn.trim());
      conditions.push(`ntn = $${params.length}`);
    }
    if (email && email.trim()) {
      params.push(email.trim().toLowerCase());
      conditions.push(`LOWER(email) = $${params.length}`);
    }
    if (phone && phone.trim()) {
      params.push(`%${phone.trim().slice(-7)}%`);
      conditions.push(`phone LIKE $${params.length}`);
    }
    if (business_name && business_name.trim()) {
      params.push(`%${business_name.trim().toLowerCase()}%`);
      conditions.push(`LOWER(business_name) LIKE $${params.length}`);
    }

    if (conditions.length === 0) {
      return res.json({ success: true, duplicates: [] });
    }

    queryText += conditions.join(' OR ') + `) LIMIT 10`;
    const result = await db.query(queryText, params);
    res.json({ success: true, duplicates: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Merge Duplicate Customer Records
router.post('/customers/merge', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { source_customer_id, target_customer_id } = req.body;
  if (!source_customer_id || !target_customer_id || source_customer_id === target_customer_id) {
    return res.status(400).json({ success: false, message: 'Valid and distinct source and target customer IDs required' });
  }

  try {
    const tenantId = await resolveTenantId(req, db);

    // Verify both belong to current tenant
    const check = await db.query(
      `SELECT id, business_name FROM customers WHERE id IN ($1, $2) AND tenant_id = $3`,
      [source_customer_id, target_customer_id, tenantId]
    );
    if (check.rows.length !== 2) {
      return res.status(404).json({ success: false, message: 'Source or target customer not found in this organization' });
    }

    // Reassign contacts, addresses, notes, leads, opportunities, activities, cases, invoices
    await db.query(`UPDATE customer_contacts SET customer_id = $1 WHERE customer_id = $2 AND tenant_id = $3`, [target_customer_id, source_customer_id, tenantId]);
    await db.query(`UPDATE customer_addresses SET customer_id = $1 WHERE customer_id = $2 AND tenant_id = $3`, [target_customer_id, source_customer_id, tenantId]);
    await db.query(`UPDATE customer_notes SET customer_id = $1 WHERE customer_id = $2 AND tenant_id = $3`, [target_customer_id, source_customer_id, tenantId]);
    await db.query(`UPDATE crm_leads SET converted_customer_id = $1 WHERE converted_customer_id = $2 AND tenant_id = $3`, [target_customer_id, source_customer_id, tenantId]);
    await db.query(`UPDATE crm_opportunities SET customer_id = $1 WHERE customer_id = $2 AND tenant_id = $3`, [target_customer_id, source_customer_id, tenantId]);
    await db.query(`UPDATE crm_activities SET customer_id = $1 WHERE customer_id = $2 AND tenant_id = $3`, [target_customer_id, source_customer_id, tenantId]);
    await db.query(`UPDATE crm_cases SET customer_id = $1 WHERE customer_id = $2 AND tenant_id = $3`, [target_customer_id, source_customer_id, tenantId]);
    await db.query(`UPDATE invoices SET customer_id = $1 WHERE customer_id = $2 AND tenant_id = $3`, [target_customer_id, source_customer_id, tenantId]);
    await db.query(`UPDATE opportunities SET customer_id = $1 WHERE customer_id = $2 AND tenant_id = $3`, [target_customer_id, source_customer_id, tenantId]);

    // Soft delete/archive the source record with merge pointer
    await db.query(`
      UPDATE customers 
      SET merged_into_id = $1, is_archived = TRUE, status = 'Merged', notes = COALESCE(notes, '') || ' [Merged into ' || $1 || ' on ' || CURRENT_DATE || ']'
      WHERE id = $2 AND tenant_id = $3
    `, [target_customer_id, source_customer_id, tenantId]);

    res.json({ success: true, message: 'Customer records merged successfully. All related opportunities, invoices, and interactions reassigned.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Export Customers to CSV / JSON
router.get('/customers-export', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(`
      SELECT customer_code, business_name, customer_type, org_type, ntn, strn,
             contact_person, email, phone, city, province, lifecycle_stage,
             classification, industry, credit_limit, payment_terms, status
      FROM customers
      WHERE tenant_id = $1 AND COALESCE(is_archived, FALSE) = FALSE
      ORDER BY business_name ASC
    `, [tenantId]);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Import Customers with Duplicate Strategy
router.post('/customers-import', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { customers = [], duplicate_strategy = 'skip' } = req.body; // 'skip', 'update', 'create_new'
  if (!Array.isArray(customers) || customers.length === 0) {
    return res.status(400).json({ success: false, message: 'No customer records provided for import' });
  }

  try {
    const tenantId = await resolveTenantId(req, db);
    let importedCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;

    for (const c of customers) {
      if (!c.business_name || !c.business_name.trim()) continue;

      // Check existing duplicate by NTN or exact Name
      const existing = await db.query(`
        SELECT id FROM customers 
        WHERE tenant_id = $1 AND (LOWER(business_name) = LOWER($2) OR (ntn IS NOT NULL AND ntn = $3))
        LIMIT 1
      `, [tenantId, c.business_name.trim(), c.ntn || '']);

      if (existing.rows.length > 0) {
        if (duplicate_strategy === 'skip') {
          skippedCount++;
          continue;
        } else if (duplicate_strategy === 'update') {
          await db.query(`
            UPDATE customers SET
              email = COALESCE($1, email),
              phone = COALESCE($2, phone),
              contact_person = COALESCE($3, contact_person),
              city = COALESCE($4, city),
              industry = COALESCE($5, industry),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
          `, [c.email || null, c.phone || null, c.contact_person || null, c.city || null, c.industry || null, existing.rows[0].id]);
          updatedCount++;
          continue;
        }
      }

      // Create new
      const code = `CUST-${Date.now().toString().slice(-6)}-${importedCount + 1}`;
      await db.query(`
        INSERT INTO customers (
          tenant_id, customer_code, business_name, customer_type, org_type, ntn, strn,
          contact_person, email, phone, city, province, lifecycle_stage, classification, industry, status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'Active')
      `, [
        tenantId, code, c.business_name.trim(), c.customer_type || 'Business', c.org_type || 'Private',
        c.ntn || null, c.strn || null, c.contact_person || null, c.email || null, c.phone || null,
        c.city || 'Lahore', c.province || 'Punjab', c.lifecycle_stage || 'active_customer',
        c.classification || 'Standard', c.industry || null
      ]);
      importedCount++;
    }

    res.json({
      success: true,
      message: `Import complete: ${importedCount} created, ${updatedCount} updated, ${skippedCount} skipped.`,
      stats: { imported: importedCount, updated: updatedCount, skipped: skippedCount }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 2. CUSTOMER CONTACTS, ADDRESSES & NOTES SUB-RESOURCES
// ============================================================================

// POST Add Contact
router.post('/customers/:id/contacts', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { name, designation, department, email, phone, mobile, is_primary, communication_preference } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Contact name is required' });
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(`
      INSERT INTO customer_contacts (tenant_id, customer_id, name, designation, department, email, phone, mobile, is_primary, communication_preference)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *
    `, [tenantId, req.params.id, name, designation || '', department || '', email || '', phone || '', mobile || '', !!is_primary, communication_preference || 'email']);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE Contact
router.delete('/contacts/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    await db.query(`DELETE FROM customer_contacts WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true, message: 'Contact removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Add Note
router.post('/customers/:id/notes', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { note_text } = req.body;
  if (!note_text) return res.status(400).json({ success: false, message: 'Note text is required' });
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(`
      INSERT INTO customer_notes (tenant_id, customer_id, note_text, created_by)
      VALUES ($1, $2, $3, $4) RETURNING *
    `, [tenantId, req.params.id, note_text, req.user?.id || null]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 3. LEADS & INQUIRIES
// ============================================================================

// GET CRM Leads
router.get('/leads', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { pipeline_stage, lead_source, search } = req.query;
  try {
    const tenantId = await resolveTenantId(req, db);
    let queryText = `SELECT l.*, u.full_name as assigned_to_name FROM crm_leads l LEFT JOIN users u ON l.assigned_to = u.id WHERE l.tenant_id = $1`;
    const params = [tenantId];

    if (pipeline_stage && pipeline_stage !== 'all') {
      params.push(pipeline_stage);
      queryText += ` AND l.pipeline_stage = $${params.length}`;
    }
    if (lead_source && lead_source !== 'all') {
      params.push(lead_source);
      queryText += ` AND l.lead_source = $${params.length}`;
    }
    if (search && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      queryText += ` AND (l.company_name ILIKE $${params.length} OR l.contact_name ILIKE $${params.length} OR l.lead_code ILIKE $${params.length})`;
    }

    queryText += ` ORDER BY l.updated_at DESC, l.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Create CRM Lead
router.post('/leads', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const {
    business_profile_id, lead_source, company_name, contact_name,
    contact_email, contact_phone, department, city, pipeline_stage,
    estimated_deal_value, win_probability, priority, next_action, next_action_date,
    expected_close_date, notes
  } = req.body;

  if (!company_name) {
    return res.status(400).json({ success: false, message: 'Company / Organization Name is required.' });
  }

  try {
    const tenantId = await resolveTenantId(req, db);
    const leadCode = `LD-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    const result = await db.query(
      `INSERT INTO crm_leads
       (tenant_id, business_profile_id, lead_code, lead_source, company_name, contact_name, contact_email, contact_phone, department, city, pipeline_stage, estimated_deal_value, win_probability, priority, next_action, next_action_date, expected_close_date, assigned_to, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [
        tenantId,
        business_profile_id || null,
        leadCode,
        lead_source || 'Direct Visit',
        company_name,
        contact_name || '',
        contact_email || '',
        contact_phone || '',
        department || '',
        city || 'Lahore',
        pipeline_stage || 'New Lead',
        parseFloat(estimated_deal_value || 0),
        parseInt(win_probability || 25, 10),
        priority || 'Medium',
        next_action || null,
        next_action_date || null,
        expected_close_date || null,
        req.user?.id || null,
        notes || ''
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT Update CRM Lead Stage / Details
router.put('/leads/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { pipeline_stage, estimated_deal_value, win_probability, notes, contact_name, contact_phone, contact_email, priority, next_action, next_action_date, lost_reason, status } = req.body;
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(
      `UPDATE crm_leads
       SET pipeline_stage = COALESCE($1, pipeline_stage),
           estimated_deal_value = COALESCE($2, estimated_deal_value),
           win_probability = COALESCE($3, win_probability),
           notes = COALESCE($4, notes),
           contact_name = COALESCE($5, contact_name),
           contact_phone = COALESCE($6, contact_phone),
           contact_email = COALESCE($7, contact_email),
           priority = COALESCE($8, priority),
           next_action = COALESCE($9, next_action),
           next_action_date = COALESCE($10, next_action_date),
           lost_reason = COALESCE($11, lost_reason),
           status = COALESCE($12, status),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $13 AND tenant_id = $14 RETURNING *`,
      [pipeline_stage, estimated_deal_value, win_probability, notes, contact_name, contact_phone, contact_email, priority, next_action, next_action_date, lost_reason, status, req.params.id, tenantId]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE CRM Lead
router.delete('/leads/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    await db.query(`DELETE FROM crm_leads WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true, message: 'CRM Lead deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST 1-Click Convert CRM Lead into Master Customer & Opportunity
router.post('/leads/:id/convert', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { create_opportunity } = req.body;
  try {
    const tenantId = await resolveTenantId(req, db);
    const leadRes = await db.query(`SELECT * FROM crm_leads WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    if (leadRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'CRM Lead not found' });
    }
    const lead = leadRes.rows[0];

    let bpId = lead.business_profile_id;
    if (!bpId) {
      const bpRes = await db.query(`SELECT id FROM business_profiles WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`, [tenantId]);
      bpId = bpRes.rows[0]?.id || null;
    }

    // Check if customer already exists to avoid duplicate master records!
    let existingCust = await db.query(
      `SELECT id, business_name FROM customers WHERE tenant_id = $1 AND LOWER(business_name) = LOWER($2) LIMIT 1`,
      [tenantId, lead.company_name.trim()]
    );

    let customerId = existingCust.rows[0]?.id;
    let newCustomer = existingCust.rows[0];

    if (!customerId) {
      const customerCode = `CUST-${Date.now().toString().slice(-6)}`;
      const custInsert = await db.query(
        `INSERT INTO customers
         (tenant_id, business_profile_id, customer_code, business_name, org_type, contact_person, phone, email, city, address, lifecycle_stage, status)
         VALUES ($1,$2,$3,$4,'Private',$5,$6,$7,$8,$9,'active_customer','Active') RETURNING *`,
        [tenantId, bpId, customerCode, lead.company_name.trim(), lead.contact_name || '', lead.contact_phone || '', lead.contact_email || '', lead.city || 'Lahore', `${lead.department || ''} ${lead.city || ''}`.trim()]
      );
      newCustomer = custInsert.rows[0];
      customerId = newCustomer.id;
    }

    // Create Opportunity
    let newOpportunity = null;
    if (create_opportunity !== false) {
      const oppCode = `DEAL-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
      const oppRes = await db.query(
        `INSERT INTO crm_opportunities
         (tenant_id, customer_id, lead_id, opportunity_code, deal_name, stage, expected_revenue, win_probability, lead_source, assigned_to)
         VALUES ($1,$2,$3,$4,$5,'Proposal',$6,$7,$8,$9) RETURNING *`,
        [tenantId, customerId, lead.id, oppCode, `Commercial Deal - ${lead.company_name}`, parseFloat(lead.estimated_deal_value || 0), parseInt(lead.win_probability || 50, 10), lead.lead_source || 'Direct', req.user?.id || null]
      );
      newOpportunity = oppRes.rows[0];
    }

    // Update Lead state
    await db.query(
      `UPDATE crm_leads SET pipeline_stage = 'Won', converted_customer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [customerId, lead.id]
    );

    res.json({
      success: true,
      message: `Lead "${lead.company_name}" successfully converted!`,
      data: { customer: newCustomer, opportunity: newOpportunity }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 4. OPPORTUNITIES & DEALS (KANBAN PIPELINE)
// ============================================================================

// GET CRM Opportunities
router.get('/opportunities', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { stage, priority, search } = req.query;
  try {
    const tenantId = await resolveTenantId(req, db);
    let queryText = `
      SELECT o.*, o.deal_name as title, o.expected_revenue as expected_value,
             c.business_name as customer_name, c.city as customer_city, u.full_name as assigned_to_name
      FROM crm_opportunities o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u ON o.assigned_to = u.id
      WHERE o.tenant_id = $1
    `;
    const params = [tenantId];

    if (stage && stage !== 'all') {
      params.push(stage);
      queryText += ` AND o.stage = $${params.length}`;
    }
    if (priority && priority !== 'all') {
      params.push(priority);
      queryText += ` AND o.priority = $${params.length}`;
    }
    if (search && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      queryText += ` AND (o.deal_name ILIKE $${params.length} OR o.opportunity_code ILIKE $${params.length} OR c.business_name ILIKE $${params.length})`;
    }

    queryText += ` ORDER BY o.updated_at DESC, o.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Create Opportunity
router.post('/opportunities', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const deal_name = (req.body.deal_name || req.body.title || '').trim();
  const expected_revenue = parseFloat(req.body.expected_revenue || req.body.expected_value || 0);
  const {
    customer_id, stage = 'Discovery', win_probability = 30,
    expected_close_date, next_step, priority = 'Medium', lead_source = 'Direct', notes
  } = req.body;

  if (!customer_id || !deal_name) {
    return res.status(400).json({ success: false, message: 'Customer and Deal Name are required.' });
  }

  try {
    const tenantId = await resolveTenantId(req, db);
    const oppCode = `DEAL-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;

    const result = await db.query(`
      INSERT INTO crm_opportunities (
        tenant_id, customer_id, opportunity_code, deal_name, stage,
        expected_revenue, win_probability, expected_close_date, next_step,
        priority, lead_source, assigned_to, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *, deal_name as title, expected_revenue as expected_value
    `, [
      tenantId, customer_id, oppCode, deal_name, stage,
      expected_revenue, parseInt(win_probability || 30, 10),
      expected_close_date || null, next_step || null, priority, lead_source,
      req.user?.id || null, notes || ''
    ]);

    res.status(201).json({ success: true, data: result.rows[0], message: 'Opportunity created successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT Update Opportunity Stage / Details
router.put('/opportunities/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { stage, expected_revenue, win_probability, expected_close_date, next_step, priority, lost_reason, notes } = req.body;
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(`
      UPDATE crm_opportunities SET
        stage = COALESCE($1, stage),
        expected_revenue = COALESCE($2, expected_revenue),
        win_probability = COALESCE($3, win_probability),
        expected_close_date = COALESCE($4, expected_close_date),
        next_step = COALESCE($5, next_step),
        priority = COALESCE($6, priority),
        lost_reason = COALESCE($7, lost_reason),
        notes = COALESCE($8, notes),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9 AND tenant_id = $10
      RETURNING *
    `, [stage, expected_revenue ? parseFloat(expected_revenue) : null, win_probability ? parseInt(win_probability, 10) : null, expected_close_date, next_step, priority, lost_reason, notes, req.params.id, tenantId]);

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Opportunity not found' });
    res.json({ success: true, data: result.rows[0], message: 'Opportunity updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE Opportunity
router.delete('/opportunities/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    await db.query(`DELETE FROM crm_opportunities WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true, message: 'Opportunity deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 5. ACTIVITIES, CALLS & CALENDAR
// ============================================================================

// GET CRM Activities
router.get('/activities', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { activity_type, status } = req.query;
  try {
    const tenantId = await resolveTenantId(req, db);
    let queryText = `
      SELECT a.*, l.company_name as lead_company, c.business_name as customer_name, u.full_name as conducted_by_name
      FROM crm_activities a
      LEFT JOIN crm_leads l ON a.lead_id = l.id
      LEFT JOIN customers c ON a.customer_id = c.id
      LEFT JOIN users u ON a.conducted_by = u.id
      WHERE a.tenant_id = $1
    `;
    const params = [tenantId];

    if (activity_type && activity_type !== 'all') {
      params.push(activity_type);
      queryText += ` AND a.activity_type = $${params.length}`;
    }
    if (status && status !== 'all') {
      params.push(status);
      queryText += ` AND a.status = $${params.length}`;
    }

    queryText += ` ORDER BY COALESCE(a.due_date, a.scheduled_at, a.created_at) DESC LIMIT 200`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Log Activity / Call / Task
router.post('/activities', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { lead_id, customer_id, opportunity_id, activity_type = 'Phone Call', subject = 'Follow-up Discussion', scheduled_at, due_date, priority = 'Medium', status = 'Completed', outcome = '' } = req.body;
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(
      `INSERT INTO crm_activities
       (tenant_id, lead_id, customer_id, opportunity_id, activity_type, subject, scheduled_at, due_date, priority, status, outcome, conducted_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        tenantId, lead_id || null, customer_id || null, opportunity_id || null,
        activity_type, subject, scheduled_at || new Date().toISOString(),
        due_date || null, priority, status, outcome, req.user?.id || null
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT Update Activity Status
router.put('/activities/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { status, outcome, completed_at } = req.body;
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(`
      UPDATE crm_activities SET
        status = COALESCE($1, status),
        outcome = COALESCE($2, outcome),
        completed_at = $3
      WHERE id = $4 AND tenant_id = $5
      RETURNING *
    `, [status, outcome, status === 'Completed' ? new Date().toISOString() : null, req.params.id, tenantId]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Activity not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE Activity
router.delete('/activities/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    await db.query(`DELETE FROM crm_activities WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true, message: 'Activity removed' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 6. CUSTOMER SERVICE, TICKETS & SLA RETENTION
// ============================================================================

// GET Cases / Tickets
router.get('/cases', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { status, priority, category } = req.query;
  try {
    const tenantId = await resolveTenantId(req, db);
    let queryText = `
      SELECT cs.*, cs.case_number as ticket_number, cs.sla_due_at as sla_due_date,
             c.business_name as customer_name, u.full_name as assigned_to_name,
             (SELECT COUNT(*) FROM crm_case_comments cc WHERE cc.case_id = cs.id) as comments_count
      FROM crm_cases cs
      JOIN customers c ON cs.customer_id = c.id
      LEFT JOIN users u ON cs.assigned_to = u.id
      WHERE cs.tenant_id = $1
    `;
    const params = [tenantId];

    if (status && status !== 'all') {
      params.push(status);
      queryText += ` AND cs.status = $${params.length}`;
    }
    if (priority && priority !== 'all') {
      params.push(priority);
      queryText += ` AND cs.priority = $${params.length}`;
    }
    if (category && category !== 'all') {
      params.push(category);
      queryText += ` AND cs.category = $${params.length}`;
    }

    queryText += ` ORDER BY cs.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Create Support Case
router.post('/cases', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { customer_id, subject, category = 'Technical Support', priority = 'Medium', description, sla_target_hours = 24 } = req.body;
  if (!customer_id || !subject) {
    return res.status(400).json({ success: false, message: 'Customer and Subject are required.' });
  }
  try {
    const tenantId = await resolveTenantId(req, db);
    const caseNumber = `CASE-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    const slaDueAt = new Date(Date.now() + parseInt(sla_target_hours, 10) * 3600 * 1000).toISOString();

    const result = await db.query(`
      INSERT INTO crm_cases (
        tenant_id, customer_id, case_number, subject, category, priority, status,
        assigned_to, sla_target_hours, sla_due_at, description
      ) VALUES ($1,$2,$3,$4,$5,$6,'Open',$7,$8,$9,$10) RETURNING *
    `, [tenantId, customer_id, caseNumber, subject.trim(), category, priority, req.user?.id || null, sla_target_hours, slaDueAt, description || '']);

    res.status(201).json({ success: true, data: result.rows[0], message: 'Support case created' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT Update Case Status / Resolution
router.put('/cases/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const { status, resolution_summary, customer_satisfaction_rating, priority } = req.body;
  try {
    const tenantId = await resolveTenantId(req, db);
    const resolvedAt = (status === 'Resolved' || status === 'Closed') ? new Date().toISOString() : null;

    const result = await db.query(`
      UPDATE crm_cases SET
        status = COALESCE($1, status),
        resolution_summary = COALESCE($2, resolution_summary),
        customer_satisfaction_rating = COALESCE($3, customer_satisfaction_rating),
        priority = COALESCE($4, priority),
        resolved_at = COALESCE($5, resolved_at),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6 AND tenant_id = $7
      RETURNING *
    `, [status, resolution_summary, customer_satisfaction_rating ? parseInt(customer_satisfaction_rating, 10) : null, priority, resolvedAt, req.params.id, tenantId]);

    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Case not found' });
    res.json({ success: true, data: result.rows[0], message: 'Support case updated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Add Case Comment
router.post('/cases/:id/comments', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  const comment_text = req.body.comment_text || req.body.comment;
  const { is_internal = false } = req.body;
  if (!comment_text) return res.status(400).json({ success: false, message: 'Comment text is required' });
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(`
      INSERT INTO crm_case_comments (tenant_id, case_id, author_id, comment_text, is_internal)
      VALUES ($1, $2, $3, $4, $5) RETURNING *, comment_text as comment
    `, [tenantId, req.params.id, req.user?.id || null, comment_text, !!is_internal]);
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE Case
router.delete('/cases/:id', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    await db.query(`DELETE FROM crm_cases WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true, message: 'Support case deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// 7. CUSTOMER 360° UNIFIED CROSS-MODULE PROFILE
// ============================================================================

router.get('/customer-360/:customerId', authenticate, requireModuleLicense('mod_crm'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const custId = req.params.customerId;

    const [custRes, contactsRes, oppsRes, dealsRes, invRes, dcsRes, actRes, casesRes] = await Promise.all([
      db.query(`SELECT c.*, u.full_name as assigned_owner_name FROM customers c LEFT JOIN users u ON c.assigned_owner_id = u.id WHERE c.id = $1 AND c.tenant_id = $2`, [custId, tenantId]),
      db.query(`SELECT * FROM customer_contacts WHERE customer_id = $1 AND tenant_id = $2 ORDER BY is_primary DESC`, [custId, tenantId]),
      db.query(`SELECT id, opportunity_number, tender_name, status, estimated_value, is_quotation, created_at FROM opportunities WHERE customer_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 50`, [custId, tenantId]),
      db.query(`SELECT * FROM crm_opportunities WHERE customer_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 50`, [custId, tenantId]),
      db.query(`SELECT id, invoice_number, invoice_date, total_amount, paid_amount, status FROM invoices WHERE customer_id = $1 AND tenant_id = $2 ORDER BY invoice_date DESC LIMIT 50`, [custId, tenantId]),
      db.query(`SELECT id, challan_number, challan_date, status FROM delivery_challans WHERE customer_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 50`, [custId, tenantId]),
      db.query(`SELECT * FROM crm_activities WHERE customer_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 50`, [custId, tenantId]),
      db.query(`SELECT * FROM crm_cases WHERE customer_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 50`, [custId, tenantId])
    ]);

    if (custRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }

    const invoices = invRes.rows;
    const totalBilled = invoices.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0);
    const totalPaid = invoices.reduce((s, i) => s + parseFloat(i.paid_amount || 0), 0);

    res.json({
      success: true,
      data: {
        customer: custRes.rows[0],
        contacts: contactsRes.rows,
        opportunities: oppsRes.rows,
        deals: dealsRes.rows,
        invoices,
        delivery_challans: dcsRes.rows,
        activities: actRes.rows,
        cases: casesRes.rows,
        financial_summary: {
          total_billed: totalBilled,
          total_paid: totalPaid,
          outstanding_balance: Math.max(0, totalBilled - totalPaid)
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;


