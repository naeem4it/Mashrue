const express = require('express');
const router = express.Router();
const db = require('../config/db');
const FBRService = require('../services/fbrService');
const { optionalAuth } = require('../middleware/auth.middleware');

// GET all invoices
router.get('/', optionalAuth, async (req, res) => {
  const { business_profile_id, status, fbr_status } = req.query;

  try {
    let queryText = `
      SELECT i.*, 
             bp.business_name, 
             c.business_name as customer_name,
             c.org_type as customer_org_type,
             dc.dc_number,
             po.po_number,
             o.title as opportunity_title,
             (i.total_amount - COALESCE(i.paid_amount, 0)) as outstanding_amount
      FROM invoices i
      JOIN business_profiles bp ON i.business_profile_id = bp.id
      JOIN customers c ON i.customer_id = c.id
      LEFT JOIN delivery_challans dc ON i.delivery_challan_id = dc.id
      LEFT JOIN purchase_orders po ON i.purchase_order_id = po.id
      LEFT JOIN opportunities o ON i.opportunity_id = o.id
      WHERE 1=1
    `;
    const params = [];

    // Tenant Isolation
    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        queryText += ` AND i.tenant_id::text = $${params.length}`;

        if (req.user.role === 'ClientEmployee' && req.user.assignedBusinessProfiles && req.user.assignedBusinessProfiles.length > 0) {
          params.push(req.user.assignedBusinessProfiles);
          queryText += ` AND i.business_profile_id = ANY($${params.length}::uuid[])`;
        }
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      queryText += ` AND i.business_profile_id = $${params.length}`;
    }

    if (status && status !== 'all') {
      params.push(status);
      queryText += ` AND LOWER(i.status) = LOWER($${params.length})`;
    }

    if (fbr_status && fbr_status !== 'all') {
      params.push(fbr_status);
      queryText += ` AND i.fbr_status = $${params.length}`;
    }

    queryText += ` ORDER BY i.invoice_date DESC, i.created_at DESC`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET single invoice with payments and FBR submissions
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    let queryText = `SELECT i.*, bp.business_name, bp.legal_name, bp.ntn as bp_ntn, bp.strn as bp_strn,
              c.business_name as customer_name, c.ntn as customer_ntn, c.strn as customer_strn,
              dc.dc_number, po.po_number,
              (i.total_amount - COALESCE(i.paid_amount, 0)) as outstanding_amount
       FROM invoices i
       JOIN business_profiles bp ON i.business_profile_id = bp.id
       JOIN customers c ON i.customer_id = c.id
       LEFT JOIN delivery_challans dc ON i.delivery_challan_id = dc.id
       LEFT JOIN purchase_orders po ON i.purchase_order_id = po.id
       WHERE i.id = $1`;
    const params = [req.params.id];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      queryText += ` AND i.tenant_id::text = $${params.length}`;
    }

    const invRes = await db.query(queryText, params);

    if (invRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found' });
    }

    const paymentsRes = await db.query(
      `SELECT * FROM payments WHERE invoice_id = $1 ORDER BY payment_date DESC`,
      [req.params.id]
    );

    const subsRes = await db.query(
      `SELECT * FROM fbr_submissions WHERE invoice_id = $1 ORDER BY submitted_at DESC`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...invRes.rows[0],
        payments: paymentsRes.rows,
        fbrSubmissions: subsRes.rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST create invoice
// Workflow: Generated post Delivery Challan (DC)
// Statuses: submitted, reinvoicing, pending, hold, paid, Draft, Cancelled
router.post('/', optionalAuth, async (req, res) => {
  const {
    business_profile_id,
    delivery_challan_id,
    purchase_order_id,
    contract_id,
    opportunity_id,
    customer_id,
    invoice_number,
    invoice_date,
    due_date,
    subtotal,
    tax_amount,
    status,
    fbr_integration_required
  } = req.body;

  if (!customer_id) {
    return res.status(400).json({ success: false, message: 'Customer is mandatory for invoicing' });
  }

  try {
    let tenantId = req.user?.tenantId;
    if (!tenantId) {
      const tenantRes = await db.query(`SELECT id FROM tenants LIMIT 1`);
      tenantId = tenantRes.rows[0]?.id || 'a0000000-0000-0000-0000-000000000001';
    }

    const invNum = invoice_number || `INV-${Date.now().toString().slice(-6)}`;
    const fbrRequired = Boolean(fbr_integration_required);
    const initialFbrStatus = fbrRequired ? 'Pending' : 'FBR Skipped';
    const initialStatus = status || 'Submitted'; // Default submitted

    const sub = parseFloat(subtotal || 0);
    const tax = parseFloat(tax_amount || 0);
    const total = sub + tax;

    const insertRes = await db.query(
      `INSERT INTO invoices 
       (tenant_id, business_profile_id, delivery_challan_id, purchase_order_id, contract_id, opportunity_id, customer_id, invoice_number, invoice_date, due_date, subtotal, tax_amount, total_amount, paid_amount, fbr_integration_required, fbr_status, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       RETURNING *`,
      [
        tenantId,
        business_profile_id,
        delivery_challan_id || null,
        purchase_order_id || null,
        contract_id || null,
        opportunity_id || null,
        customer_id,
        invNum,
        invoice_date || new Date(),
        due_date || new Date(Date.now() + 30 * 86400000),
        sub,
        tax,
        total,
        0.00,
        fbrRequired,
        initialFbrStatus,
        initialStatus
      ]
    );

    const createdInvoice = insertRes.rows[0];

    // Trigger FBR if requested
    if (fbrRequired) {
      try {
        const fbrResult = await FBRService.submitToFBR(createdInvoice.id);
        return res.status(201).json({
          success: true,
          data: {
            ...createdInvoice,
            fbr_status: fbrResult.status,
            fbr_invoice_number: fbrResult.fbrInvoiceNumber,
            fbr_qr_code: fbrResult.qrCodeBase64
          },
          message: 'Invoice created and successfully fiscalized with PRAL FBR Gateway.'
        });
      } catch (fbrErr) {
        console.warn('FBR submission warning:', fbrErr.message);
      }
    }

    res.status(201).json({ success: true, data: createdInvoice, message: 'Invoice generated successfully.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update Invoice Status (Submitted, Reinvoicing, Pending, Hold, Paid)
router.put('/:id/status', async (req, res) => {
  const { status, remarks } = req.body;

  try {
    const result = await db.query(
      `UPDATE invoices SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );

    res.json({ success: true, data: result.rows[0], message: `Invoice status updated to ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT update Invoice details
router.put('/:id', async (req, res) => {
  const { invoice_number, invoice_date, due_date, total_amount, status, payment_terms, notes } = req.body;
  try {
    const result = await db.query(
      `UPDATE invoices
       SET invoice_number = COALESCE($1, invoice_number),
           invoice_date = COALESCE($2, invoice_date),
           due_date = COALESCE($3, due_date),
           total_amount = COALESCE($4, total_amount),
           status = COALESCE($5, status),
           payment_terms = COALESCE($6, payment_terms),
           notes = COALESCE($7, notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $8
       RETURNING *`,
      [
        invoice_number || null,
        invoice_date || null,
        due_date || null,
        total_amount !== undefined ? parseFloat(total_amount) : null,
        status || null,
        payment_terms || null,
        notes || null,
        req.params.id
      ]
    );
    res.json({ success: true, data: result.rows[0], message: 'Invoice updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
