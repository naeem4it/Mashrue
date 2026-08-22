const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { optionalAuth } = require('../middleware/auth.middleware');

// GET Executive Dashboard KPIs
router.get('/dashboard-kpis', optionalAuth, async (req, res) => {
  const { business_profile_id } = req.query;

  try {
    let whereClauses = [];
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        whereClauses.push(`tenant_id::text = $${params.length}`);
      }
    } else {
      return res.json({
        success: true,
        data: {
          tenders: { total_tenders: 0, in_process: 0, won_count: 0, lost_count: 0, closed_count: 0, total_pipeline_value: 0 },
          bidSecurities: { active_securities_count: 0, active_securities_amount: 0, released_securities_count: 0, pending_securities_count: 0 },
          supply: { total_dcs: 0, delivered_dcs: 0, in_transit_dcs: 0, pending_dcs: 0 },
          financials: { total_invoiced: 0, total_collected: 0, total_receivables: 0, paid_invoices_count: 0, pending_invoices_count: 0 },
          expenses: { total_expenses: 0 }
        }
      });
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      whereClauses.push(`business_profile_id = $${params.length}`);
    }

    const filterClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 1. Tender Status Summary
    const oppSummaryRes = await db.query(`
      SELECT 
        COUNT(*) as total_tenders,
        COUNT(*) FILTER (WHERE status IN ('New', 'Under Review', 'Selected', 'Bid Preparation', 'Ready to submit', 'Submitted')) as in_process,
        COUNT(*) FILTER (WHERE LOWER(status) = 'won') as won_count,
        COUNT(*) FILTER (WHERE LOWER(status) IN ('loose', 'lost')) as lost_count,
        COUNT(*) FILTER (WHERE LOWER(status) IN ('withdraw', 'withdrawn', 'cancelled', 'rejected')) as closed_count,
        COALESCE(SUM(estimated_value), 0) as total_pipeline_value
      FROM opportunities ${filterClause}
    `, params);

    // 2. Bid Security Summary
    const secSummaryRes = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'Active') as active_securities_count,
        COALESCE(SUM(amount) FILTER (WHERE status = 'Active'), 0) as active_securities_amount,
        COUNT(*) FILTER (WHERE status = 'Released') as released_securities_count,
        COUNT(*) FILTER (WHERE status = 'Pending') as pending_securities_count
      FROM bid_securities ${filterClause}
    `, params);

    // 3. Supply & DC Status
    const dcSummaryRes = await db.query(`
      SELECT 
        COUNT(*) as total_dcs,
        COUNT(*) FILTER (WHERE status = 'Delivered') as delivered_dcs,
        COUNT(*) FILTER (WHERE status IN ('Dispatched', 'In_Transit')) as in_transit_dcs,
        COUNT(*) FILTER (WHERE status = 'Pending') as pending_dcs
      FROM delivery_challans ${filterClause}
    `, params);

    // 4. Financial & Invoicing
    const invSummaryRes = await db.query(`
      SELECT 
        COALESCE(SUM(total_amount), 0) as total_invoiced,
        COALESCE(SUM(paid_amount), 0) as total_collected,
        COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as total_receivables,
        COUNT(*) FILTER (WHERE status = 'Paid') as paid_invoices_count,
        COUNT(*) FILTER (WHERE status IN ('Submitted', 'Reinvoicing', 'Pending', 'Hold')) as pending_invoices_count
      FROM invoices ${filterClause}
    `, params);

    // 5. Total Expenses
    const expSummaryRes = await db.query(`
      SELECT COALESCE(SUM(amount), 0) as total_expenses FROM general_expenses ${filterClause}
    `, params);

    res.json({
      success: true,
      data: {
        tenders: oppSummaryRes.rows[0],
        bidSecurities: secSummaryRes.rows[0],
        supply: dcSummaryRes.rows[0],
        financials: invSummaryRes.rows[0],
        expenses: expSummaryRes.rows[0]
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Contract-Wise Profitability Report
router.get('/contract-profitability', optionalAuth, async (req, res) => {
  try {
    let query = `
      SELECT 
        cnt.id as contract_id,
        cnt.contract_number,
        c.business_name as customer_name,
        c.org_type as customer_org_type,
        bp.business_name,
        cnt.contract_value,
        COALESCE((SELECT SUM(po.net_amount) FROM purchase_orders po WHERE po.contract_id = cnt.id), 0) as po_value,
        COALESCE((SELECT SUM(inv.total_amount) FROM invoices inv WHERE inv.contract_id = cnt.id), 0) as invoiced_amount,
        COALESCE((SELECT SUM(inv.paid_amount) FROM invoices inv WHERE inv.contract_id = cnt.id), 0) as received_payment,
        COALESCE((SELECT SUM(ge.amount) FROM general_expenses ge WHERE ge.contract_id = cnt.id), 0) as allocated_expenses,
        cnt.status as contract_status
      FROM contracts cnt
      JOIN customers c ON cnt.customer_id = c.id
      JOIN business_profiles bp ON cnt.business_profile_id = bp.id
      WHERE 1=1
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        query += ` AND cnt.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    query += ` ORDER BY cnt.created_at DESC`;
    const result = await db.query(query, params);

    const formatted = result.rows.map(row => {
      const cVal = parseFloat(row.contract_value || 0);
      const invoiced = parseFloat(row.invoiced_amount || 0);
      const paid = parseFloat(row.received_payment || 0);
      const expenses = parseFloat(row.allocated_expenses || 0);
      const estCost = parseFloat(row.po_value || 0) * 0.75; // Approx cost baseline
      const netProfit = (invoiced > 0 ? invoiced : cVal) - estCost - expenses;
      const profitMarginPct = cVal > 0 ? ((netProfit / cVal) * 100) : 0;

      return {
        ...row,
        estimated_cost: estCost,
        net_profit: netProfit,
        profit_margin_pct: profitMarginPct.toFixed(1),
        outstanding_receivable: Math.max(0, invoiced - paid)
      };
    });

    res.json({ success: true, data: formatted });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Pending Bills & Aging Report
router.get('/pending-bills', optionalAuth, async (req, res) => {
  try {
    let query = `
      SELECT 
        inv.id,
        inv.invoice_number,
        inv.invoice_date,
        inv.due_date,
        c.business_name as customer_name,
        c.org_type as customer_org_type,
        bp.business_name,
        inv.total_amount,
        inv.paid_amount,
        (inv.total_amount - COALESCE(inv.paid_amount, 0)) as outstanding_amount,
        (CURRENT_DATE - inv.invoice_date) as days_outstanding,
        inv.status,
        inv.fbr_status
      FROM invoices inv
      JOIN customers c ON inv.customer_id = c.id
      JOIN business_profiles bp ON inv.business_profile_id = bp.id
      WHERE (inv.total_amount - COALESCE(inv.paid_amount, 0)) > 0
    `;
    const params = [];

    if (req.user) {
      if (req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
        const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
        params.push(tid);
        query += ` AND inv.tenant_id::text = $${params.length}`;
      }
    } else {
      return res.json({ success: true, data: [] });
    }

    query += ` ORDER BY days_outstanding DESC`;
    const result = await db.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
