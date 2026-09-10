const { requirePermission, resolveTenantId, sanitizePrices, requireRoles } = require('../middleware/rbac.middleware');
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');

// Standard 30 Master Expense Categories across 3 Tiers
const DEFAULT_EXPENSE_CATEGORIES = [
  // Tier 1: Tender & Quotation Pre-Bid Direct Expenses
  { tier: 'Tier 1 - Tender Direct', name: 'Tender / Bidding Document Fee', description: 'Procurement authority tender document purchases, bidding dossier download fees, RFP fees' },
  { tier: 'Tier 1 - Tender Direct', name: 'Lab Sample Testing & Certification', description: 'Third-party testing laboratory fees (PCSIR, CE, ISO, Dielectric, SGS, Bureau Veritas)' },
  { tier: 'Tier 1 - Tender Direct', name: 'Sample Procurement & Fabrication', description: 'Purchasing, custom tooling, sample batch fabrication, or prototyping for technical bidding' },
  { tier: 'Tier 1 - Tender Direct', name: 'Site Pre-Bid Survey / Inspection & Fuel', description: 'Engineer pre-bid field survey, ground inspection travel, vehicle fuel, site reconnaissance' },
  { tier: 'Tier 1 - Tender Direct', name: 'Bid Security Guarantee Bank Processing Fee', description: 'CDR / Bank Guarantee issuance commissions, bank service charges, stamp papers for securities' },
  { tier: 'Tier 1 - Tender Direct', name: 'Courier & Dispatch Charges for Bids', description: 'Urgent secured bidding dossier dispatch (TCS, DHL, Leopard courier) to client opening office' },
  { tier: 'Tier 1 - Tender Direct', name: 'Technical Consultant / Specialist Fee', description: 'Third-party technical consultant, structural engineer, or subject matter specialist drafting fees' },
  { tier: 'Tier 1 - Tender Direct', name: 'Client Pre-Bid Meeting Refreshments & Travel', description: 'Intercity travel, flight/train, lodging, and refreshments for pre-bid conference attendance' },
  { tier: 'Tier 1 - Tender Direct', name: 'Other Pre-Bid Direct Expense', description: 'Miscellaneous tender-specific direct out-of-pocket costs prior to bid opening' },

  // Tier 2: PO & Delivery Execution Logistics Costs
  { tier: 'Tier 2 - PO Execution', name: 'Hired Freight / Trailer Transport', description: 'Long-haul freight truck, container transport, flatbed trailer hire for cargo transport' },
  { tier: 'Tier 2 - PO Execution', name: '3PL Logistics & Courier (TCS / Leopard / M&P)', description: 'Parcel delivery, express cargo services, dispatch of delivery challans and invoices' },
  { tier: 'Tier 2 - PO Execution', name: 'Loading & Unloading Labor', description: 'Coolie/labor charges for warehouse loading, site offloading, crane/forklift equipment hire' },
  { tier: 'Tier 2 - PO Execution', name: 'Port Customs Clearance & Handling Charges', description: 'Seaport/dryport customs clearing agent commissions, wharfage, terminal handling, demurrage' },
  { tier: 'Tier 2 - PO Execution', name: 'Transit Insurance & Security', description: 'Marine/transit cargo insurance policy premiums, armed security escort for high-value cargo' },
  { tier: 'Tier 2 - PO Execution', name: 'Warehouse Storage & Material Handling', description: 'Temporary transit storage depot fees, pallet racking, staging warehouse rental' },
  { tier: 'Tier 2 - PO Execution', name: 'Packaging & Palletization Supplies', description: 'Wooden pallets, heat-shrink wrap, bubble wrap, corrugated master cartons, strapping bands' },
  { tier: 'Tier 2 - PO Execution', name: 'Site Installation & Field Assembly Labor', description: 'Technician on-site deployment, civil work fitting, commissioning, field labor charges' },
  { tier: 'Tier 2 - PO Execution', name: 'QC Third-Party Inspection at Delivery', description: 'Third-party pre-dispatch inspection (PDI), factory acceptance testing (FAT) inspector fees' },
  { tier: 'Tier 2 - PO Execution', name: 'Other Execution & Logistics Expense', description: 'Specialized delivery, route survey, toll taxes, weighbridge receipts, octroi charges' },

  // Tier 3: General Business & Administrative Overheads
  { tier: 'Tier 3 - General Overheads', name: 'Head Office Rent', description: 'Head office, regional branch, or executive commercial premises rental leases' },
  { tier: 'Tier 3 - General Overheads', name: 'Office Utilities (Electricity, Gas, Water)', description: 'Monthly commercial utility charges (WAPDA, LESCO, KE, SNGPL, Water board)' },
  { tier: 'Tier 3 - General Overheads', name: 'Staff Salaries & Wages', description: 'Permanent and contracted team monthly payroll, bonuses, and employee allowances' },
  { tier: 'Tier 3 - General Overheads', name: 'Office Internet & Telephone', description: 'High-speed fiber internet connection, landlines, cellular corporate SIM bundles' },
  { tier: 'Tier 3 - General Overheads', name: 'Stationery & Printing Supplies', description: 'Letterheads, envelopes, toner cartridges, photocopies, heavy-duty binder files' },
  { tier: 'Tier 3 - General Overheads', name: 'Company Vehicle Fuel & Routine Maintenance', description: 'Fleet fuel cards, engine oil changes, tires, vehicle fitness inspections, motor tuning' },
  { tier: 'Tier 3 - General Overheads', name: 'Bank Charges & Account Maintenance', description: 'Corporate bank account monthly maintenance fees, cheque book fees, wire transfer commissions' },
  { tier: 'Tier 3 - General Overheads', name: 'Legal & Tax Advisory Fees', description: 'Corporate tax consultant retainer, SECP compliance advocate, legal opinion fees' },
  { tier: 'Tier 3 - General Overheads', name: 'Software & ERP Subscriptions', description: 'Cloud hosting, accounting software, domain renewals, productivity licenses' },
  { tier: 'Tier 3 - General Overheads', name: 'Office Refreshments & Hospitality', description: 'Kitchen supplies, staff tea/coffee, guest hospitality, water dispenser bottles' },
  { tier: 'Tier 3 - General Overheads', name: 'Miscellaneous General Expense', description: 'General sundry expenses, office cleaning supplies, small repair and maintenance' }
];

// Ensure columns & tables exist on database and seed initial categories
(async () => {
  try {
    await db.query(`
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS expense_type VARCHAR(50) DEFAULT 'General Expense';
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS expense_name VARCHAR(255);
      ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS expense_tier VARCHAR(50) DEFAULT 'Tier 1 - Tender Direct';

      CREATE TABLE IF NOT EXISTS expense_categories (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
          tier VARCHAR(100) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          code VARCHAR(50),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_unique 
        ON expense_categories (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), tier, name);
    `);

    // Check count and seed default categories if empty
    const countRes = await db.query(`SELECT COUNT(*) FROM expense_categories`);
    if (parseInt(countRes.rows[0].count, 10) === 0) {
      for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
        await db.query(`
          INSERT INTO expense_categories (tier, name, description, is_active)
          VALUES ($1, $2, $3, TRUE)
          ON CONFLICT DO NOTHING
        `, [cat.tier, cat.name, cat.description]);
      }
    }
  } catch (err) {
    console.warn('Expense schema init note:', err.message);
  }
})();

// ============================================================================
// DYNAMIC EXPENSE CATEGORIES ENDPOINTS
// ============================================================================

// GET /api/expenses/categories
router.get('/categories', optionalAuth, async (req, res) => {
  const { tier } = req.query;
  try {
    let queryText = `
      SELECT id, tenant_id, tier, name, description, code, is_active, created_at
      FROM expense_categories
      WHERE is_active = TRUE
    `;
    const params = [];

    // Tenant Isolation: include system-level categories (tenant_id IS NULL) + user's tenant
    if (req.user && req.user.role !== 'SuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND (tenant_id IS NULL OR tenant_id::text = $${params.length})`;
    }

    if (tier && tier !== 'all') {
      params.push(tier);
      queryText += ` AND tier = $${params.length}`;
    }

    queryText += ` ORDER BY tier ASC, name ASC`;
    let result = await db.query(queryText, params);

    // Fallback seed check if no records
    if (result.rows.length === 0 && (!tier || tier === 'all')) {
      for (const cat of DEFAULT_EXPENSE_CATEGORIES) {
        await db.query(`
          INSERT INTO expense_categories (tier, name, description, is_active)
          VALUES ($1, $2, $3, TRUE)
          ON CONFLICT DO NOTHING
        `, [cat.tier, cat.name, cat.description]);
      }
      result = await db.query(queryText, params);
    }

    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message, data: DEFAULT_EXPENSE_CATEGORIES });
  }
});

// POST /api/expenses/categories
router.post('/categories', authenticate, requirePermission('expenses', 'add'), async (req, res) => {
  const { tier, name, description, code } = req.body;
  if (!name || !tier) {
    return res.status(400).json({ success: false, message: 'Category Name and Tier are mandatory' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || null;
    }

    const result = await db.query(`
      INSERT INTO expense_categories (tenant_id, tier, name, description, code, is_active)
      VALUES ($1, $2, $3, $4, $5, TRUE)
      ON CONFLICT DO NOTHING
      RETURNING *
    `, [tenantId, tier, name.trim(), description || null, code || null]);

    if (result.rows.length === 0) {
      // Category already exists
      const existing = await db.query(`SELECT * FROM expense_categories WHERE tier = $1 AND name = $2 LIMIT 1`, [tier, name.trim()]);
      return res.json({ success: true, data: existing.rows[0], message: 'Expense category already exists' });
    }

    res.status(201).json({ success: true, data: result.rows[0], message: 'Expense category created successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /api/expenses/categories/:id
router.put('/categories/:id', authenticate, requirePermission('expenses', 'edit'), async (req, res) => {
  const { tier, name, description, is_active } = req.body;
  try {
    const result = await db.query(`
      UPDATE expense_categories
      SET tier = COALESCE($1, tier),
          name = COALESCE($2, name),
          description = COALESCE($3, description),
          is_active = COALESCE($4, is_active)
      WHERE id = $5
      RETURNING *
    `, [tier || null, name ? name.trim() : null, description !== undefined ? description : null, is_active !== undefined ? is_active : null, req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Expense category not found' });
    }
    res.json({ success: true, data: result.rows[0], message: 'Expense category updated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/expenses/categories/:id
router.delete('/categories/:id', authenticate, requirePermission('expenses', 'delete'), async (req, res) => {
  try {
    await db.query(`UPDATE expense_categories SET is_active = FALSE WHERE id = $1`, [req.params.id]);
    res.json({ success: true, message: 'Expense category deactivated.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET all expenses
router.get('/', authenticate, requirePermission('expenses', 'view'), async (req, res) => {
  const { opportunity_id, contract_id, category, business_profile_id, expense_type } = req.query;

  try {
    let queryText = `
      SELECT ge.*, 
             o.opportunity_number, o.tender_name, o.title as opportunity_title, o.tender_type, o.tender_source,
             cnt.contract_number,
             bp.business_name
      FROM general_expenses ge
      LEFT JOIN opportunities o ON ge.opportunity_id = o.id
      LEFT JOIN contracts cnt ON ge.contract_id = cnt.id
      LEFT JOIN business_profiles bp ON ge.business_profile_id = bp.id
      WHERE 1=1
    `;
    const params = [];

    // Tenant Isolation
    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND ge.tenant_id::text = $${params.length}`;

        if (req.user.role === 'ClientEmployee' && req.user.assignedBusinessProfiles && req.user.assignedBusinessProfiles.length > 0) {
          params.push(req.user.assignedBusinessProfiles);
          queryText += ` AND ge.business_profile_id = ANY($${params.length}::uuid[])`;
        }
      }
    } else {
      return res.json({ success: true, data: [], expense_names: [], categories: EXPENSE_CATEGORIES });
    }

    if (opportunity_id) {
      params.push(opportunity_id);
      queryText += ` AND ge.opportunity_id = $${params.length}`;
    }

    if (contract_id) {
      params.push(contract_id);
      queryText += ` AND ge.contract_id = $${params.length}`;
    }

    if (category && category !== 'all') {
      params.push(category);
      queryText += ` AND ge.category = $${params.length}`;
    }

    if (expense_type && expense_type !== 'all') {
      params.push(expense_type);
      queryText += ` AND ge.expense_type = $${params.length}`;
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      queryText += ` AND ge.business_profile_id = $${params.length}`;
    }

    queryText += ` ORDER BY ge.expense_date DESC, ge.created_at DESC`;
    const result = await db.query(queryText, params);

    // Fetch distinct previously added expense names for autocomplete
    let expenseNames = [];
    try {
      let nameQuery = `SELECT DISTINCT expense_name FROM general_expenses WHERE expense_name IS NOT NULL AND expense_name != ''`;
      const nameParams = [];
      if (req.user && req.user.role !== 'SuperAdmin') {
        nameParams.push(req.user.tenantId || '00000000-0000-0000-0000-000000000000');
        nameQuery += ` AND tenant_id = $${nameParams.length}`;
      }
      nameQuery += ` ORDER BY expense_name ASC`;
      const namesRes = await db.query(nameQuery, nameParams);
      expenseNames = namesRes.rows.map(r => r.expense_name);
    } catch (e) {
      expenseNames = [];
    }

    res.json({
      success: true,
      data: result.rows,
      expense_names: expenseNames,
      categories: EXPENSE_CATEGORIES
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST record new Expense (General / Tender / Quotation / Contract)
router.post('/', authenticate, requirePermission('expenses', 'add'), async (req, res) => {
  const {
    business_profile_id,
    expense_tier,
    expense_type,
    expense_name,
    category,
    amount,
    expense_date,
    paid_to,
    payment_mode,
    opportunity_id,
    contract_id,
    purchase_order_id,
    department,
    receipt_url,
    remarks
  } = req.body;

  if (!category || !amount) {
    return res.status(400).json({ success: false, message: 'Expense Category and Amount are mandatory' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const result = await db.query(
      `INSERT INTO general_expenses 
       (tenant_id, business_profile_id, expense_tier, expense_type, expense_name, category, amount, expense_date, paid_to, payment_mode, opportunity_id, contract_id, purchase_order_id, department, receipt_url, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        tenantId,
        business_profile_id || null,
        expense_tier || 'Tier 3 - General Overheads',
        expense_type || 'General Expense',
        expense_name || null,
        category,
        parseFloat(amount),
        expense_date || new Date(),
        paid_to || null,
        payment_mode || 'Cash',
        opportunity_id || null,
        contract_id || null,
        purchase_order_id || null,
        department || null,
        receipt_url || null,
        remarks || null
      ]
    );

    // If opportunity_id is present, also update tender_expenses total in bids
    if (opportunity_id) {
      await db.query(
        `UPDATE bids 
         SET tender_expense_total = (SELECT COALESCE(SUM(amount), 0) FROM general_expenses WHERE opportunity_id = $1)
         WHERE opportunity_id = $1`,
        [opportunity_id]
      );
    }

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: `Expense of PKR ${parseFloat(amount).toLocaleString()} logged under ${category}.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update Expense details
router.put('/:id', authenticate, requirePermission('expenses', 'edit'), async (req, res) => {
  const { expense_tier, expense_type, expense_name, category, amount, expense_date, paid_to, payment_mode, remarks } = req.body;
  try {
    const result = await db.query(
      `UPDATE general_expenses
       SET expense_tier = COALESCE($1, expense_tier),
           expense_type = COALESCE($2, expense_type),
           expense_name = COALESCE($3, expense_name),
           category = COALESCE($4, category),
           amount = COALESCE($5, amount),
           expense_date = COALESCE($6, expense_date),
           paid_to = COALESCE($7, paid_to),
           payment_mode = COALESCE($8, payment_mode),
           remarks = COALESCE($9, remarks)
       WHERE id = $10
       RETURNING *`,
      [
        expense_tier || null,
        expense_type || null,
        expense_name || null,
        category || null,
        amount !== undefined ? parseFloat(amount) : null,
        expense_date || null,
        paid_to || null,
        payment_mode || null,
        remarks || null,
        req.params.id
      ]
    );
    res.json({ success: true, data: result.rows[0], message: 'Expense record updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
