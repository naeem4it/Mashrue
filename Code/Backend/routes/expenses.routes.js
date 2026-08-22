const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { optionalAuth } = require('../middleware/auth.middleware');

// Standard Company Expense Categories (13 Categories)
const EXPENSE_CATEGORIES = [
  'Samples',
  'Courier & Logistics',
  'Gifting',
  'Other Direct Costs',
  'Taxes & Duties',
  'Salaries',
  'Fuel',
  'Maintenance',
  'Overheads',
  'Utility Bills',
  'Warehouse Rent',
  'Refreshments',
  'Administrative Expenses'
];

// Ensure columns exist on database
(async () => {
  try {
    await db.query(`ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS expense_type VARCHAR(50) DEFAULT 'General Expense'`);
    await db.query(`ALTER TABLE general_expenses ADD COLUMN IF NOT EXISTS expense_name VARCHAR(255)`);
  } catch (err) {
    // Ignore schema check error if db offline
  }
})();

// GET all expenses
router.get('/', optionalAuth, async (req, res) => {
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
router.post('/', optionalAuth, async (req, res) => {
  const {
    business_profile_id,
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
       (tenant_id, business_profile_id, expense_type, expense_name, category, amount, expense_date, paid_to, payment_mode, opportunity_id, contract_id, purchase_order_id, department, receipt_url, remarks)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [
        tenantId,
        business_profile_id || null,
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
router.put('/:id', async (req, res) => {
  const { expense_type, expense_name, category, amount, expense_date, paid_to, payment_mode, remarks } = req.body;
  try {
    const result = await db.query(
      `UPDATE general_expenses
       SET expense_type = COALESCE($1, expense_type),
           expense_name = COALESCE($2, expense_name),
           category = COALESCE($3, category),
           amount = COALESCE($4, amount),
           expense_date = COALESCE($5, expense_date),
           paid_to = COALESCE($6, paid_to),
           payment_mode = COALESCE($7, payment_mode),
           remarks = COALESCE($8, remarks)
       WHERE id = $9
       RETURNING *`,
      [
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
