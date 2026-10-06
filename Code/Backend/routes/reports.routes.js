const { requirePermission, resolveTenantId, sanitizePrices, requireRoles } = require('../middleware/rbac.middleware');
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');

// GET Executive Dashboard KPIs
router.get('/dashboard-kpis', authenticate, requirePermission('reports', 'view'), async (req, res) => {
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
        COUNT(*) FILTER (WHERE status IN ('Active', 'Submitted')) as active_securities_count,
        COALESCE(SUM(amount) FILTER (WHERE status IN ('Active', 'Submitted')), 0) as active_securities_amount,
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
router.get('/contract-profitability', authenticate, requirePermission('reports', 'view'), async (req, res) => {
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
router.get('/pending-bills', authenticate, requirePermission('reports', 'view'), async (req, res) => {
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

// Helper for safe date parsing in filters
function parseFilterDate(dStr) {
  if (!dStr) return null;
  const s = String(dStr).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

// -----------------------------------------------------------------------------
// 1. EXECUTIVE REPORT: BID SECURITIES & PERFORMANCE GUARANTEES
// Shows: Paid/Blocked in banks vs Released/Got Back, expiry alerts, tender vs quotation
// -----------------------------------------------------------------------------
router.get('/bid-securities-and-guarantees', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id, start_date, end_date, scope, status, instrument_filter } = req.query;

  try {
    const tid = (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') 
      ? (req.user.tenantId || '00000000-0000-0000-0000-000000000000') 
      : null;

    let params = [];
    let secWhere = [];
    let guarWhere = [];

    if (tid) {
      params.push(tid);
      secWhere.push(`bs.tenant_id::text = $${params.length}`);
      guarWhere.push(`pg.tenant_id::text = $${params.length}`);
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      secWhere.push(`(bs.business_profile_id::text = $${params.length} OR o.business_profile_id::text = $${params.length})`);
      guarWhere.push(`(pg.business_profile_id::text = $${params.length} OR o.business_profile_id::text = $${params.length})`);
    }

    const sDate = parseFilterDate(start_date);
    if (sDate) {
      params.push(sDate);
      secWhere.push(`COALESCE(bs.issue_date, bs.created_at::date) >= $${params.length}`);
      guarWhere.push(`COALESCE(pg.issue_date, pg.created_at::date) >= $${params.length}`);
    }

    const eDate = parseFilterDate(end_date);
    if (eDate) {
      params.push(eDate);
      secWhere.push(`COALESCE(bs.issue_date, bs.created_at::date) <= $${params.length}`);
      guarWhere.push(`COALESCE(pg.issue_date, pg.created_at::date) <= $${params.length}`);
    }

    if (scope === 'tender') {
      secWhere.push(`(o.is_quotation IS NOT TRUE OR o.id IS NULL)`);
      guarWhere.push(`(o.is_quotation IS NOT TRUE OR o.id IS NULL)`);
    } else if (scope === 'quotation') {
      secWhere.push(`(o.is_quotation IS TRUE)`);
      guarWhere.push(`(o.is_quotation IS TRUE)`);
    }

    if (status && status !== 'all') {
      params.push(status);
      secWhere.push(`LOWER(bs.status) = LOWER($${params.length})`);
      guarWhere.push(`LOWER(pg.status) = LOWER($${params.length})`);
    }

    const secClause = secWhere.length > 0 ? `WHERE ${secWhere.join(' AND ')}` : '';
    const guarClause = guarWhere.length > 0 ? `WHERE ${guarWhere.join(' AND ')}` : '';

    let unionParts = [];

    if (!instrument_filter || instrument_filter === 'all' || instrument_filter === 'bid_security') {
      unionParts.push(`
        SELECT 
          bs.id,
          'Bid Security (CDR/EMD)' as report_category,
          bs.instrument_type,
          bs.instrument_number,
          bs.account_title,
          bs.beneficiary,
          bs.bank_name,
          bs.bank_branch,
          COALESCE(bs.amount, 0) as amount,
          bs.issue_date,
          bs.expiry_date,
          bs.status,
          bs.comments,
          bs.business_profile_id,
          COALESCE(bp.business_name, 'Primary Entity') as business_name,
          COALESCE(o.opportunity_number, 'Tender Ref') as reference_number,
          COALESCE(o.tender_name, o.title, 'Bid Security Dossier') as project_title,
          COALESCE(c.business_name, 'Client Department') as customer_name,
          COALESCE(o.is_quotation, FALSE) as is_quotation,
          (bs.expiry_date - CURRENT_DATE) as days_to_expiry,
          bs.created_at
        FROM bid_securities bs
        LEFT JOIN opportunities o ON bs.opportunity_id = o.id
        LEFT JOIN business_profiles bp ON bs.business_profile_id = bp.id
        LEFT JOIN customers c ON o.customer_id = c.id
        ${secClause}
      `);
    }

    if (!instrument_filter || instrument_filter === 'all' || instrument_filter === 'guarantee') {
      unionParts.push(`
        SELECT 
          pg.id,
          'Performance Guarantee (PBG)' as report_category,
          COALESCE(pg.instrument_type, 'Performance Bond') as instrument_type,
          COALESCE(pg.instrument_number, pg.guarantee_number, 'PBG') as instrument_number,
          pg.account_title,
          pg.beneficiary,
          pg.bank_name,
          pg.bank_branch,
          COALESCE(pg.amount, 0) as amount,
          pg.issue_date,
          pg.expiry_date,
          pg.status,
          COALESCE(pg.comments, pg.remarks) as comments,
          pg.business_profile_id,
          COALESCE(bp.business_name, 'Primary Entity') as business_name,
          COALESCE(cnt.contract_number, o.opportunity_number, 'Contract Ref') as reference_number,
          COALESCE(o.tender_name, o.title, 'Performance Guarantee') as project_title,
          COALESCE(c.business_name, 'Contract Client') as customer_name,
          COALESCE(o.is_quotation, FALSE) as is_quotation,
          (pg.expiry_date - CURRENT_DATE) as days_to_expiry,
          pg.created_at
        FROM performance_guarantees pg
        LEFT JOIN contracts cnt ON pg.contract_id = cnt.id
        LEFT JOIN opportunities o ON pg.opportunity_id = o.id OR cnt.opportunity_id = o.id
        LEFT JOIN business_profiles bp ON pg.business_profile_id = bp.id OR cnt.business_profile_id = bp.id
        LEFT JOIN customers c ON o.customer_id = c.id OR cnt.customer_id = c.id
        ${guarClause}
      `);
    }

    const finalQuery = unionParts.join(' UNION ALL ') + ` ORDER BY expiry_date ASC NULLS LAST, created_at DESC`;
    const result = await db.query(finalQuery, params);
    const rows = result.rows;

    let totalPaidBlocked = 0;
    let totalReleasedRecovered = 0;
    let expiringSoonCount = 0;
    let pendingCount = 0;

    rows.forEach(r => {
      const amt = parseFloat(r.amount) || 0;
      const st = String(r.status || '').toLowerCase();
      if (st === 'active' || st === 'submitted') {
        totalPaidBlocked += amt;
      } else if (st === 'released' || st === 'returned') {
        totalReleasedRecovered += amt;
      } else if (st === 'pending') {
        pendingCount++;
        totalPaidBlocked += amt;
      }
      if (r.days_to_expiry !== null && r.days_to_expiry <= 30 && r.days_to_expiry >= 0 && st !== 'released') {
        expiringSoonCount++;
      }
    });

    const totalInstrumentsAmount = totalPaidBlocked + totalReleasedRecovered;
    const recoveryRatePct = totalInstrumentsAmount > 0 ? ((totalReleasedRecovered / totalInstrumentsAmount) * 100).toFixed(1) : '0.0';

    res.json({
      success: true,
      data: rows,
      summary: {
        total_count: rows.length,
        total_paid_blocked: totalPaidBlocked,
        total_released_recovered: totalReleasedRecovered,
        total_exposure: totalInstrumentsAmount,
        recovery_rate_pct: recoveryRatePct,
        expiring_soon_count: expiringSoonCount,
        pending_count: pendingCount
      }
    });
  } catch (err) {
    console.error('Bid Securities and Guarantees Report Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 2. EXECUTIVE REPORT: EXPENSES LEDGER & 3-TIER BREAKDOWN
// -----------------------------------------------------------------------------
router.get('/expenses-ledger', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id, start_date, end_date, scope, tier, category } = req.query;

  try {
    let where = [];
    let params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      where.push(`ge.tenant_id::text = $${params.length}`);
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      where.push(`ge.business_profile_id::text = $${params.length}`);
    }

    const sDate = parseFilterDate(start_date);
    if (sDate) {
      params.push(sDate);
      where.push(`COALESCE(ge.expense_date, ge.created_at::date) >= $${params.length}`);
    }

    const eDate = parseFilterDate(end_date);
    if (eDate) {
      params.push(eDate);
      where.push(`COALESCE(ge.expense_date, ge.created_at::date) <= $${params.length}`);
    }

    if (scope === 'tender') {
      where.push(`(o.is_quotation IS NOT TRUE AND ge.opportunity_id IS NOT NULL)`);
    } else if (scope === 'quotation') {
      where.push(`(o.is_quotation IS TRUE AND ge.opportunity_id IS NOT NULL)`);
    }

    if (tier && tier !== 'all') {
      params.push(tier);
      where.push(`ge.expense_tier ILIKE $${params.length} || '%'`);
    }

    if (category && category !== 'all') {
      params.push(category);
      where.push(`ge.category = $${params.length}`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const query = `
      SELECT 
        ge.*,
        bp.business_name,
        o.opportunity_number,
        o.tender_name,
        o.is_quotation,
        po.po_number,
        cnt.contract_number,
        dc.dc_number
      FROM general_expenses ge
      LEFT JOIN business_profiles bp ON ge.business_profile_id = bp.id
      LEFT JOIN opportunities o ON ge.opportunity_id = o.id
      LEFT JOIN purchase_orders po ON ge.purchase_order_id = po.id
      LEFT JOIN contracts cnt ON ge.contract_id = cnt.id
      LEFT JOIN delivery_challans dc ON ge.delivery_challan_id = dc.id
      ${whereClause}
      ORDER BY ge.expense_date DESC NULLS LAST, ge.created_at DESC
    `;

    const result = await db.query(query, params);
    const rows = result.rows;

    let tier1Total = 0;
    let tier2Total = 0;
    let tier3Total = 0;
    const catMap = {};

    rows.forEach(e => {
      const amt = parseFloat(e.amount) || 0;
      const t = String(e.expense_tier || '');
      if (t.includes('Tier 1') || e.opportunity_id) {
        tier1Total += amt;
      } else if (t.includes('Tier 2') || e.purchase_order_id || e.delivery_challan_id) {
        tier2Total += amt;
      } else {
        tier3Total += amt;
      }

      const c = e.category || 'General Operations';
      catMap[c] = (catMap[c] || 0) + amt;
    });

    const totalExpenses = tier1Total + tier2Total + tier3Total;

    res.json({
      success: true,
      data: rows,
      summary: {
        total_count: rows.length,
        total_expenses: totalExpenses,
        tier1_total: tier1Total,
        tier2_total: tier2Total,
        tier3_total: tier3Total,
        category_breakdown: Object.entries(catMap).map(([name, amount]) => ({ name, amount })).sort((a,b) => b.amount - a.amount)
      }
    });
  } catch (err) {
    console.error('Expenses Ledger Report Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 3. EXECUTIVE REPORT: PENDING RECEIVABLES & AGING BREAKDOWN
// -----------------------------------------------------------------------------
router.get('/pending-receivables', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id, customer_id, start_date, end_date, scope, aging_bracket } = req.query;

  try {
    let where = [`(inv.total_amount - COALESCE(inv.paid_amount, 0)) > 0`];
    let params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      where.push(`inv.tenant_id::text = $${params.length}`);
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      where.push(`inv.business_profile_id::text = $${params.length}`);
    }

    if (customer_id && customer_id !== 'all') {
      params.push(customer_id);
      where.push(`inv.customer_id::text = $${params.length}`);
    }

    const sDate = parseFilterDate(start_date);
    if (sDate) {
      params.push(sDate);
      where.push(`COALESCE(inv.invoice_date, inv.created_at::date) >= $${params.length}`);
    }

    const eDate = parseFilterDate(end_date);
    if (eDate) {
      params.push(eDate);
      where.push(`COALESCE(inv.invoice_date, inv.created_at::date) <= $${params.length}`);
    }

    if (scope === 'tender') {
      where.push(`(o.is_quotation IS NOT TRUE OR cnt.id IS NOT NULL)`);
    } else if (scope === 'quotation') {
      where.push(`(o.is_quotation IS TRUE)`);
    }

    const whereClause = `WHERE ${where.join(' AND ')}`;

    const query = `
      SELECT 
        inv.id,
        inv.invoice_number,
        inv.invoice_date,
        inv.due_date,
        c.business_name as customer_name,
        c.org_type as customer_org_type,
        bp.business_name,
        inv.total_amount,
        COALESCE(inv.paid_amount, 0) as paid_amount,
        (inv.total_amount - COALESCE(inv.paid_amount, 0)) as outstanding_amount,
        (CURRENT_DATE - inv.invoice_date) as days_outstanding,
        CASE WHEN inv.due_date IS NOT NULL THEN (CURRENT_DATE - inv.due_date) ELSE (CURRENT_DATE - inv.invoice_date) END as days_overdue,
        inv.status,
        inv.fbr_status,
        COALESCE(cnt.contract_number, po.po_number, o.opportunity_number, 'Direct') as project_ref,
        COALESCE(o.is_quotation, FALSE) as is_quotation
      FROM invoices inv
      JOIN customers c ON inv.customer_id = c.id
      JOIN business_profiles bp ON inv.business_profile_id = bp.id
      LEFT JOIN contracts cnt ON inv.contract_id = cnt.id
      LEFT JOIN purchase_orders po ON inv.purchase_order_id = po.id
      LEFT JOIN opportunities o ON inv.opportunity_id = o.id OR cnt.opportunity_id = o.id OR po.opportunity_id = o.id
      ${whereClause}
      ORDER BY days_outstanding DESC
    `;

    const result = await db.query(query, params);
    let rows = result.rows;

    if (aging_bracket && aging_bracket !== 'all') {
      if (aging_bracket === '0-30') rows = rows.filter(r => (r.days_outstanding || 0) <= 30);
      else if (aging_bracket === '31-60') rows = rows.filter(r => (r.days_outstanding || 0) > 30 && (r.days_outstanding || 0) <= 60);
      else if (aging_bracket === '60+') rows = rows.filter(r => (r.days_outstanding || 0) > 60);
    }

    let totalInvoiced = 0;
    let totalCollected = 0;
    let totalOutstanding = 0;
    let current030 = 0;
    let overdue3160 = 0;
    let critical60Plus = 0;

    rows.forEach(r => {
      const invTotal = parseFloat(r.total_amount) || 0;
      const paid = parseFloat(r.paid_amount) || 0;
      const due = parseFloat(r.outstanding_amount) || 0;
      const days = parseInt(r.days_outstanding || 0, 10);

      totalInvoiced += invTotal;
      totalCollected += paid;
      totalOutstanding += due;

      if (days <= 30) current030 += due;
      else if (days <= 60) overdue3160 += due;
      else critical60Plus += due;
    });

    const collectionPct = totalInvoiced > 0 ? ((totalCollected / totalInvoiced) * 100).toFixed(1) : '0.0';

    res.json({
      success: true,
      data: rows,
      summary: {
        total_invoices_count: rows.length,
        total_invoiced: totalInvoiced,
        total_collected: totalCollected,
        total_outstanding: totalOutstanding,
        current_0_30: current030,
        overdue_31_60: overdue3160,
        critical_60_plus: critical60Plus,
        collection_rate_pct: collectionPct
      }
    });
  } catch (err) {
    console.error('Pending Receivables Report Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 4. EXECUTIVE REPORT: ACCOUNTS PAYABLE [DUE PAYMENTS TO SUPPLIERS]
// -----------------------------------------------------------------------------
router.get('/accounts-payable', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id, supplier_id, start_date, end_date, scope, due_status } = req.query;

  try {
    let where = [];
    let params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      where.push(`pr.tenant_id::text = $${params.length}`);
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      where.push(`pr.business_profile_id::text = $${params.length}`);
    }

    if (supplier_id && supplier_id !== 'all') {
      params.push(supplier_id);
      where.push(`pr.supplier_id::text = $${params.length}`);
    }

    const sDate = parseFilterDate(start_date);
    if (sDate) {
      params.push(sDate);
      where.push(`pr.created_at::date >= $${params.length}`);
    }

    const eDate = parseFilterDate(end_date);
    if (eDate) {
      params.push(eDate);
      where.push(`pr.created_at::date <= $${params.length}`);
    }

    if (scope === 'tender') {
      where.push(`(o.is_quotation IS NOT TRUE OR po.contract_id IS NOT NULL)`);
    } else if (scope === 'quotation') {
      where.push(`(o.is_quotation IS TRUE)`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const query = `
      SELECT 
        pr.id,
        pr.procurement_number,
        pr.procurement_type,
        pr.currency,
        pr.total_landed_cost,
        pr.status as procurement_status,
        pr.created_at as bill_date,
        (pr.created_at::date + INTERVAL '30 days') as due_date,
        (CURRENT_DATE - pr.created_at::date) as days_elapsed,
        GREATEST(0, (CURRENT_DATE - (pr.created_at::date + INTERVAL '30 days')::date)) as days_overdue,
        s.supplier_name,
        s.origin as supplier_origin,
        s.bank_iban,
        s.swift_code,
        bp.business_name,
        COALESCE(po.po_number, 'Direct Procurement') as po_number,
        COALESCE(o.tender_name, o.title, 'Procurement Supply') as project_title,
        COALESCE(o.is_quotation, FALSE) as is_quotation
      FROM procurements pr
      JOIN suppliers s ON pr.supplier_id = s.id
      JOIN business_profiles bp ON pr.business_profile_id = bp.id
      LEFT JOIN purchase_orders po ON pr.purchase_order_id = po.id
      LEFT JOIN opportunities o ON po.opportunity_id = o.id
      ${whereClause}
      ORDER BY pr.created_at DESC
    `;

    const result = await db.query(query, params);
    let rows = result.rows.map(r => {
      const landed = parseFloat(r.total_landed_cost || 0);
      const isSettled = String(r.procurement_status || '').toLowerCase() === 'received' || String(r.procurement_status || '').toLowerCase() === 'paid';
      const paid = isSettled ? landed : (landed * 0.3); // In absence of direct vendor payment table, 30% advance on active
      const due = Math.max(0, landed - paid);
      const daysOverdue = parseInt(r.days_overdue || 0, 10);
      let payStatus = isSettled ? 'Settled' : (daysOverdue > 0 ? 'Overdue' : 'Due Soon');

      return {
        ...r,
        bill_amount: landed,
        paid_amount: paid,
        payable_balance: due,
        payment_status: payStatus
      };
    });

    if (due_status && due_status !== 'all') {
      if (due_status === 'overdue') rows = rows.filter(r => r.payment_status === 'Overdue');
      else if (due_status === 'due') rows = rows.filter(r => r.payment_status === 'Due Soon' || r.payment_status === 'Overdue');
      else if (due_status === 'settled') rows = rows.filter(r => r.payment_status === 'Settled');
    }

    let totalBills = 0;
    let totalPaid = 0;
    let totalPayable = 0;
    let currentDues = 0;
    let overdueDues = 0;

    rows.forEach(r => {
      totalBills += r.bill_amount;
      totalPaid += r.paid_amount;
      totalPayable += r.payable_balance;
      if (r.payment_status === 'Overdue') overdueDues += r.payable_balance;
      else if (r.payment_status === 'Due Soon') currentDues += r.payable_balance;
    });

    const settlementPct = totalBills > 0 ? ((totalPaid / totalBills) * 100).toFixed(1) : '0.0';

    res.json({
      success: true,
      data: rows,
      summary: {
        total_procurements_count: rows.length,
        total_bill_amount: totalBills,
        total_paid_amount: totalPaid,
        total_payable_balance: totalPayable,
        current_dues: currentDues,
        overdue_dues: overdueDues,
        settlement_rate_pct: settlementPct
      }
    });
  } catch (err) {
    console.error('Accounts Payable Report Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// -----------------------------------------------------------------------------
// 5. EXECUTIVE REPORT: SUPPLY STATUS REPORT [AGAINST PO & SHOWS DC]
// -----------------------------------------------------------------------------
router.get('/supply-status', authenticate, requirePermission('reports', 'view'), async (req, res) => {
  const { business_profile_id, customer_id, start_date, end_date, scope, supply_status } = req.query;

  try {
    let where = [];
    let params = [];

    if (req.user && req.user.role !== 'SuperAdmin' && req.user.role !== 'LimitedSuperAdmin') {
      const tid = req.user.tenantId || '00000000-0000-0000-0000-000000000000';
      params.push(tid);
      where.push(`po.tenant_id::text = $${params.length}`);
    }

    if (business_profile_id && business_profile_id !== 'all') {
      params.push(business_profile_id);
      where.push(`po.business_profile_id::text = $${params.length}`);
    }

    if (customer_id && customer_id !== 'all') {
      params.push(customer_id);
      where.push(`po.customer_id::text = $${params.length}`);
    }

    const sDate = parseFilterDate(start_date);
    if (sDate) {
      params.push(sDate);
      where.push(`po.po_date >= $${params.length}`);
    }

    const eDate = parseFilterDate(end_date);
    if (eDate) {
      params.push(eDate);
      where.push(`po.po_date <= $${params.length}`);
    }

    if (scope === 'tender') {
      where.push(`(o.is_quotation IS NOT TRUE OR po.contract_id IS NOT NULL)`);
    } else if (scope === 'quotation') {
      where.push(`(o.is_quotation IS TRUE)`);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const poQuery = `
      SELECT 
        po.id as po_id,
        po.po_number,
        po.po_date,
        po.delivery_location,
        po.status as po_status,
        po.net_amount as po_amount,
        c.business_name as customer_name,
        bp.business_name,
        COALESCE(o.tender_name, o.title, 'Project Execution') as project_title,
        COALESCE(o.is_quotation, FALSE) as is_quotation,
        cnt.contract_number
      FROM purchase_orders po
      JOIN customers c ON po.customer_id = c.id
      JOIN business_profiles bp ON po.business_profile_id = bp.id
      LEFT JOIN contracts cnt ON po.contract_id = cnt.id
      LEFT JOIN opportunities o ON po.opportunity_id = o.id
      ${whereClause}
      ORDER BY po.po_date DESC, po.created_at DESC
    `;

    const poResult = await db.query(poQuery, params);
    const poList = poResult.rows;

    if (poList.length === 0) {
      return res.json({
        success: true,
        data: [],
        summary: {
          total_pos_count: 0,
          fully_delivered_count: 0,
          in_progress_count: 0,
          pending_count: 0,
          overall_fulfillment_pct: '0.0'
        }
      });
    }

    const poIds = poList.map(p => p.po_id);

    // Fetch items and correlated DCs
    const itemsRes = await db.query(`
      SELECT 
        poi.id, poi.purchase_order_id, poi.item_description, poi.unit,
        COALESCE(poi.quantity, poi.awarded_quantity, 1) as ordered_quantity,
        COALESCE(poi.total_price, 0) as item_total_price
      FROM purchase_order_items poi
      WHERE poi.purchase_order_id = ANY($1::uuid[])
    `, [poIds]);

    const dcsRes = await db.query(`
      SELECT 
        dc.id as dc_id,
        dc.purchase_order_id,
        dc.dc_number,
        dc.delivery_date,
        dc.status as dc_status,
        dc.logistics_provider,
        dc.tracking_number,
        dc.bilty_number,
        dc.vehicle_number,
        dc.driver_name,
        dci.product_service_id,
        dci.purchase_order_item_id,
        dci.item_name,
        dci.quantity as delivered_quantity,
        dci.unit
      FROM delivery_challans dc
      LEFT JOIN delivery_challan_items dci ON dc.id = dci.delivery_challan_id
      WHERE dc.purchase_order_id = ANY($1::uuid[])
      ORDER BY dc.delivery_date ASC
    `, [poIds]);

    const itemsByPo = {};
    itemsRes.rows.forEach(itm => {
      if (!itemsByPo[itm.purchase_order_id]) itemsByPo[itm.purchase_order_id] = [];
      itemsByPo[itm.purchase_order_id].push(itm);
    });

    const dcsByPo = {};
    dcsRes.rows.forEach(dc => {
      if (!dcsByPo[dc.purchase_order_id]) dcsByPo[dc.purchase_order_id] = [];
      dcsByPo[dc.purchase_order_id].push(dc);
    });

    let fullyDeliveredCount = 0;
    let inProgressCount = 0;
    let pendingCount = 0;
    let totalOrderedQtyAll = 0;
    let totalDeliveredQtyAll = 0;

    let enrichedPOs = poList.map(po => {
      const items = itemsByPo[po.po_id] || [];
      const dcs = dcsByPo[po.po_id] || [];

      // Calculate total ordered vs delivered
      let totalOrdered = 0;
      let totalDelivered = 0;

      items.forEach(itm => {
        const oQty = parseFloat(itm.ordered_quantity) || 0;
        totalOrdered += oQty;

        // Delivered for this item across all DCs
        const itmDelivered = dcs
          .filter(d => (d.purchase_order_item_id && d.purchase_order_item_id === itm.id) || (d.item_name && itm.item_description && d.item_name.toLowerCase().includes(itm.item_description.slice(0, 15).toLowerCase())))
          .reduce((sum, d) => sum + (parseFloat(d.delivered_quantity) || 0), 0);
        
        itm.delivered_quantity = itmDelivered;
        itm.pending_quantity = Math.max(0, oQty - itmDelivered);
      });

      // If items table didn't have items, check overall DC quantities
      if (totalOrdered === 0) {
        totalOrdered = 1;
        totalDelivered = dcs.filter(d => String(d.dc_status).toLowerCase() === 'delivered').length > 0 ? 1 : 0;
      } else {
        totalDelivered = items.reduce((s, itm) => s + (itm.delivered_quantity || 0), 0);
      }

      totalOrderedQtyAll += totalOrdered;
      totalDeliveredQtyAll += Math.min(totalOrdered, totalDelivered);

      const fulfillmentPct = totalOrdered > 0 ? Math.min(100, (totalDelivered / totalOrdered) * 100) : 0;

      let supplyStatus = 'Pending Fulfillment';
      if (fulfillmentPct >= 99.5 || String(po.po_status).toLowerCase() === 'delivered') {
        supplyStatus = 'Fully Delivered';
        fullyDeliveredCount++;
      } else if (fulfillmentPct > 0 || dcs.length > 0) {
        supplyStatus = 'Partially Dispatched';
        inProgressCount++;
      } else {
        pendingCount++;
      }

      // Group DCs for display
      const uniqueDCs = [];
      const seenDc = new Set();
      dcs.forEach(d => {
        if (!seenDc.has(d.dc_id)) {
          seenDc.add(d.dc_id);
          uniqueDCs.push({
            dc_id: d.dc_id,
            dc_number: d.dc_number,
            delivery_date: d.delivery_date,
            status: d.dc_status,
            logistics_provider: d.logistics_provider,
            bilty_number: d.bilty_number,
            vehicle_number: d.vehicle_number
          });
        }
      });

      return {
        ...po,
        items,
        delivery_challans: uniqueDCs,
        total_ordered_qty: totalOrdered,
        total_delivered_qty: totalDelivered,
        pending_qty: Math.max(0, totalOrdered - totalDelivered),
        fulfillment_pct: fulfillmentPct.toFixed(1),
        supply_status: supplyStatus
      };
    });

    if (supply_status && supply_status !== 'all') {
      if (supply_status === 'delivered') enrichedPOs = enrichedPOs.filter(p => p.supply_status === 'Fully Delivered');
      else if (supply_status === 'dispatched') enrichedPOs = enrichedPOs.filter(p => p.supply_status === 'Partially Dispatched');
      else if (supply_status === 'pending') enrichedPOs = enrichedPOs.filter(p => p.supply_status === 'Pending Fulfillment');
    }

    const overallFulfillmentRate = totalOrderedQtyAll > 0 
      ? ((totalDeliveredQtyAll / totalOrderedQtyAll) * 100).toFixed(1) 
      : '0.0';

    res.json({
      success: true,
      data: enrichedPOs,
      summary: {
        total_pos_count: enrichedPOs.length,
        fully_delivered_count: fullyDeliveredCount,
        in_progress_count: inProgressCount,
        pending_count: pendingCount,
        total_ordered_quantity: totalOrderedQtyAll,
        total_delivered_quantity: totalDeliveredQtyAll,
        overall_fulfillment_pct: overallFulfillmentRate
      }
    });
  } catch (err) {
    console.error('Supply Status Report Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

