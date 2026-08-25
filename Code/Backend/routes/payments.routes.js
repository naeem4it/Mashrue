const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { optionalAuth } = require('../middleware/auth.middleware');

// GET all payments
router.get('/', optionalAuth, async (req, res) => {
  const { invoice_id, business_profile_id } = req.query;

  try {
    let queryText = `
      SELECT p.*, 
             i.invoice_number, i.total_amount as invoice_total, i.paid_amount as invoice_paid,
             (i.total_amount - i.paid_amount) as invoice_outstanding,
             c.business_name as customer_name,
             bp.business_name
      FROM payments p
      JOIN invoices i ON p.invoice_id = i.id
      JOIN customers c ON i.customer_id = c.id
      JOIN business_profiles bp ON p.business_profile_id = bp.id
      WHERE 1=1
    `;
    const params = [];

    // Tenant Isolation
    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND p.tenant_id::text = $${params.length}`;

        if (req.user.role === 'ClientEmployee' && req.user.assignedBusinessProfiles && req.user.assignedBusinessProfiles.length > 0) {
          params.push(req.user.assignedBusinessProfiles);
          queryText += ` AND p.business_profile_id = ANY($${params.length}::uuid[])`;
        }
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    if (invoice_id) {
      params.push(invoice_id);
      queryText += ` AND p.invoice_id = $${params.length}`;
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      queryText += ` AND p.business_profile_id = $${params.length}`;
    }

    queryText += ` ORDER BY p.payment_date DESC, p.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST record payment received
// Fields: check_no, check_from, invoice_number (or invoice_id), amount, payment_date, bank_account
router.post('/', optionalAuth, async (req, res) => {
  const {
    invoice_id,
    invoice_number,
    business_profile_id,
    payment_number,
    payment_date,
    payment_method, // 'Cheque', 'Bank Transfer', 'Online', 'Cash'
    amount,
    check_no,
    check_from,
    bank_account,
    deposited_in_bank,
    reference_number,
    gross_invoice_amount,
    income_tax_wht_pct,
    income_tax_wht_amount,
    sales_tax_wht_amount,
    ld_penalties_amount,
    other_deductions_amount,
    net_received_amount,
    deduction_certificate_no,
    notes
  } = req.body;

  if (!amount && !net_received_amount && !gross_invoice_amount) {
    return res.status(400).json({ success: false, message: 'Invoice and Payment Amount are mandatory.' });
  }

  try {
    // Resolve Invoice
    let targetInvoiceId = invoice_id;
    if (!targetInvoiceId && invoice_number) {
      const invFind = await db.query(`SELECT id, business_profile_id, total_amount, paid_amount FROM invoices WHERE invoice_number = $1`, [invoice_number]);
      if (invFind.rows.length === 0) {
        return res.status(404).json({ success: false, message: `Invoice #${invoice_number} not found` });
      }
      targetInvoiceId = invFind.rows[0].id;
    }

    const invRes = await db.query(`SELECT * FROM invoices WHERE id = $1`, [targetInvoiceId]);
    if (invRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice record not found' });
    }
    const inv = invRes.rows[0];

    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const gross = parseFloat(gross_invoice_amount || amount || 0);
    const itWht = parseFloat(income_tax_wht_amount || 0);
    const stWht = parseFloat(sales_tax_wht_amount || 0);
    const ld = parseFloat(ld_penalties_amount || 0);
    const other = parseFloat(other_deductions_amount || 0);
    const net = parseFloat(net_received_amount || (gross - itWht - stWht - ld - other) || amount || 0);
    const payAmount = net; // Net deposited into bank

    const payNum = payment_number || `PAY-${Date.now().toString().slice(-6)}`;

    // Insert Payment Record
    const result = await db.query(
      `INSERT INTO payments 
       (tenant_id, business_profile_id, invoice_id, payment_number, payment_date, payment_method, amount, check_no, check_from, bank_account, deposited_in_bank, reference_number, gross_invoice_amount, income_tax_wht_pct, income_tax_wht_amount, sales_tax_wht_amount, ld_penalties_amount, other_deductions_amount, net_received_amount, deduction_certificate_no, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
       RETURNING *`,
      [
        tenantId,
        business_profile_id || inv.business_profile_id,
        targetInvoiceId,
        payNum,
        payment_date || new Date(),
        payment_method || 'Cheque',
        payAmount,
        check_no || null,
        check_from || null,
        bank_account || null,
        deposited_in_bank || null,
        reference_number || null,
        gross,
        parseFloat(income_tax_wht_pct || 0),
        itWht,
        stWht,
        ld,
        other,
        net,
        deduction_certificate_no || null,
        notes || null
      ]
    );

    // Update Invoice Paid Amount (Full gross settled amount credited)
    const settledAmount = gross > 0 ? gross : payAmount;
    const newPaidAmount = parseFloat(inv.paid_amount || 0) + settledAmount;
    const isFullyPaid = newPaidAmount >= (parseFloat(inv.total_amount || 0) - 1.0); // 1 PKR tolerance for rounding
    const nextStatus = isFullyPaid ? 'Paid' : 'Submitted';

    await db.query(
      `UPDATE invoices 
       SET paid_amount = $1, status = $2 
       WHERE id = $3`,
      [newPaidAmount, nextStatus, targetInvoiceId]
    );

    res.status(201).json({
      success: true,
      data: result.rows[0],
      invoice: {
        id: targetInvoiceId,
        invoice_number: inv.invoice_number,
        total_amount: inv.total_amount,
        paid_amount: newPaidAmount,
        outstanding: Math.max(0, parseFloat(inv.total_amount) - newPaidAmount),
        status: nextStatus
      },
      message: `Payment of PKR ${payAmount.toLocaleString()} recorded successfully.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update Payment record
router.put('/:id', async (req, res) => {
  const { payment_date, payment_method, amount, check_no, check_from, bank_account, deposited_in_bank, reference_number, notes } = req.body;
  try {
    const result = await db.query(
      `UPDATE payments
       SET payment_date = COALESCE($1, payment_date),
           payment_method = COALESCE($2, payment_method),
           amount = COALESCE($3, amount),
           check_no = COALESCE($4, check_no),
           check_from = COALESCE($5, check_from),
           bank_account = COALESCE($6, bank_account),
           deposited_in_bank = COALESCE($7, deposited_in_bank),
           reference_number = COALESCE($8, reference_number),
           notes = COALESCE($9, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
      [
        payment_date || null,
        payment_method || null,
        amount !== undefined ? parseFloat(amount) : null,
        check_no || null,
        check_from || null,
        bank_account || null,
        deposited_in_bank || null,
        reference_number || null,
        notes || null,
        req.params.id
      ]
    );
    res.json({ success: true, data: result.rows[0], message: 'Payment record updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
