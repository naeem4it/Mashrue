/**
 * ============================================================================
 * MODULE 2: TENDER NOTIFICATION & PPRA / EPADS RADAR ENGINE
 * ============================================================================
 * Dedicated standalone route controller for:
 *  - Public Tender Scrapes Feed (Federal PPRA, Punjab PPRA, Sindh SPPRA, KPPRA, BPPRA, EPADS)
 *  - Live / Scheduled Portal Sync & Keyword Alert Rule Matcher
 *  - 1-Click "Import to My Bids" into Opportunities + Mandatory PPRA Checklist
 *  - Tenant Keyword Alert Subscriptions (Email / WhatsApp / In-App)
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireModuleLicense, resolveTenantId } = require('../middleware/rbac.middleware');

// GET Scraped Public Tenders Feed
router.get('/', authenticate, requireModuleLicense('mod_tender_radar'), async (req, res) => {
  const { portal_source, province, category, search, min_value } = req.query;
  try {
    let queryText = `SELECT * FROM public_tender_scrapes WHERE 1=1`;
    const params = [];

    if (portal_source && portal_source !== 'all') {
      params.push(portal_source);
      queryText += ` AND portal_source = $${params.length}`;
    }
    if (province && province !== 'all') {
      params.push(province);
      queryText += ` AND province = $${params.length}`;
    }
    if (category && category !== 'all') {
      params.push(category);
      queryText += ` AND category ILIKE $${params.length}`;
    }
    if (min_value && parseFloat(min_value) > 0) {
      params.push(parseFloat(min_value));
      queryText += ` AND COALESCE(estimated_cost, 0) >= $${params.length}`;
    }
    if (search && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      queryText += ` AND (title ILIKE $${params.length} OR organization_name ILIKE $${params.length} OR tender_ref_number ILIKE $${params.length} OR category ILIKE $${params.length})`;
    }

    queryText += ` ORDER BY closing_date ASC, scraped_at DESC LIMIT 250`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Add / Ingest Scraped Tender Notice
router.post('/', authenticate, requireModuleLicense('mod_tender_radar'), async (req, res) => {
  const {
    portal_source, tender_ref_number, title, organization_name, city,
    province, publication_date, closing_date, estimated_cost, category,
    tender_notice_url, document_download_url, raw_html_snippet
  } = req.body;

  if (!tender_ref_number || !title || !organization_name) {
    return res.status(400).json({ success: false, message: 'Tender Reference, Title, and Organization Name are required.' });
  }

  try {
    const result = await db.query(
      `INSERT INTO public_tender_scrapes
       (portal_source, tender_ref_number, title, organization_name, city, province, publication_date, closing_date, estimated_cost, category, tender_notice_url, document_download_url, raw_html_snippet)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (portal_source, tender_ref_number)
       DO UPDATE SET
         title = EXCLUDED.title,
         closing_date = EXCLUDED.closing_date,
         estimated_cost = EXCLUDED.estimated_cost,
         scraped_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        portal_source || 'Federal PPRA',
        tender_ref_number,
        title,
        organization_name,
        city || 'Islamabad',
        province || 'Federal',
        publication_date || new Date().toISOString().slice(0, 10),
        closing_date || new Date(Date.now() + 14 * 86400000).toISOString(),
        parseFloat(estimated_cost || 0),
        category || 'General Procurement',
        tender_notice_url || '',
        document_download_url || '',
        raw_html_snippet || ''
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Trigger Portal Sync & Match Active Tenant Alert Rules
router.post('/crawl', authenticate, requireModuleLicense('mod_tender_radar'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const rulesRes = await db.query(
      `SELECT * FROM tenant_tender_alert_rules WHERE tenant_id = $1 AND is_active = TRUE`,
      [tenantId]
    );
    const tendersRes = await db.query(
      `SELECT * FROM public_tender_scrapes WHERE closing_date >= CURRENT_DATE ORDER BY scraped_at DESC LIMIT 100`
    );

    let matchedCount = 0;
    for (const rule of rulesRes.rows) {
      const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];
      const minVal = parseFloat(rule.min_estimated_value || 0);

      for (const tender of tendersRes.rows) {
        if (parseFloat(tender.estimated_cost || 0) < minVal) continue;

        const haystack = `${tender.title} ${tender.organization_name} ${tender.category} ${tender.tender_ref_number}`.toLowerCase();
        const isMatch = keywords.length === 0 || keywords.some(kw => haystack.includes(String(kw).toLowerCase().trim()));

        if (isMatch) {
          const existing = await db.query(
            `SELECT id FROM tender_alert_dispatches WHERE tenant_id = $1 AND rule_id = $2 AND public_tender_id = $3 LIMIT 1`,
            [tenantId, rule.id, tender.id]
          );
          if (existing.rows.length === 0) {
            const channels = Array.isArray(rule.notification_channels) && rule.notification_channels.length > 0
              ? rule.notification_channels
              : ['InApp'];
            await db.query(
              `INSERT INTO tender_alert_dispatches (tenant_id, rule_id, public_tender_id, channel, status)
               VALUES ($1, $2, $3, $4, 'Sent')`,
              [tenantId, rule.id, tender.id, channels.join(', ')]
            );
            matchedCount++;
          }
        }
      }
    }

    res.json({
      success: true,
      matched_alerts: matchedCount,
      total_active_tenders: tendersRes.rows.length,
      message: `PPRA / EPADS Radar sync completed. ${matchedCount} new keyword alert match(es) logged.`
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST 1-Click "Import to My Bids" -> Creates Opportunity + Mandatory PPRA Checklist
router.post('/:id/import', authenticate, requireModuleLicense('mod_tender_radar'), async (req, res) => {
  const { business_profile_id } = req.body;
  try {
    const tenantId = await resolveTenantId(req, db);
    const scrapeRes = await db.query(`SELECT * FROM public_tender_scrapes WHERE id = $1`, [req.params.id]);
    if (scrapeRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Scraped tender notice not found' });
    }
    const sc = scrapeRes.rows[0];

    let bpId = business_profile_id;
    if (!bpId) {
      const bpRes = await db.query(`SELECT id FROM business_profiles WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`, [tenantId]);
      bpId = bpRes.rows[0]?.id || null;
    }

    // Find or create procuring agency in customers
    let customerId = null;
    const custCheck = await db.query(
      `SELECT id FROM customers WHERE tenant_id = $1 AND LOWER(business_name) = LOWER($2) LIMIT 1`,
      [tenantId, sc.organization_name]
    );
    if (custCheck.rows.length > 0) {
      customerId = custCheck.rows[0].id;
    } else {
      const newCust = await db.query(
        `INSERT INTO customers (tenant_id, business_profile_id, business_name, org_type, city, address)
         VALUES ($1, $2, $3, 'Government', $4, $5) RETURNING id`,
        [tenantId, bpId, sc.organization_name, sc.city || 'Islamabad', `${sc.organization_name}, ${sc.city || ''}`]
      );
      customerId = newCust.rows[0]?.id || null;
    }

    const oppNumber = `TND-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
    const closingDateStr = sc.closing_date ? new Date(sc.closing_date).toISOString().slice(0, 10) : null;

    const oppInsert = await db.query(
      `INSERT INTO opportunities
       (tenant_id, business_profile_id, opportunity_number, external_tender_number, tender_name, title, tender_source, tender_type, description, customer_id, department, publication_date, closing_date, opening_date, estimated_value, currency, location, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Public Tender',$8,$9,$10,$11,$12,$13,$14,'PKR',$15,'New')
       RETURNING *`,
      [
        tenantId,
        bpId,
        oppNumber,
        sc.tender_ref_number,
        sc.title,
        sc.title,
        sc.portal_source.includes('EPADS') ? 'EPADS' : 'PPRA',
        `Imported from ${sc.portal_source} Radar (Ref: ${sc.tender_ref_number}) - Category: ${sc.category || 'General'}`,
        customerId,
        sc.organization_name,
        sc.publication_date,
        closingDateStr,
        closingDateStr,
        parseFloat(sc.estimated_cost || 0),
        `${sc.city || ''}, ${sc.province || ''}`
      ]
    );

    const newOpp = oppInsert.rows[0];

    const defaultChecklist = [
      { title: 'Technical Bid Proposal & Compliance Sheet', cat: 'Technical Bid' },
      { title: 'Financial Bid / Priced BoQ Form', cat: 'Financial Bid' },
      { title: '2% Earnest Money / Bid Security (CDR Copy)', cat: 'CDR Copy' },
      { title: 'Active Taxpayer List (ATL) Certificate (FBR / Provincial)', cat: 'Eligibility Profile' },
      { title: 'Non-Blacklisting Affidavit on Stamp Paper', cat: 'Prequalification' }
    ];
    for (const item of defaultChecklist) {
      await db.query(
        `INSERT INTO tender_documents (tenant_id, opportunity_id, document_title, document_category, checklist_status, is_mandatory)
         VALUES ($1, $2, $3, $4, 'Pending', TRUE)`,
        [tenantId, newOpp.id, item.title, item.cat]
      );
    }

    res.status(201).json({
      success: true,
      message: `Tender "${sc.tender_ref_number}" imported into your active bidding pipeline (${oppNumber}) with mandatory PPRA checklist.`,
      data: newOpp
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Tenant Tender Alert Rules
router.get('/alerts', authenticate, requireModuleLicense('mod_tender_radar'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(
      `SELECT * FROM tenant_tender_alert_rules WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST Create Tenant Tender Alert Rule
router.post('/alerts', authenticate, requireModuleLicense('mod_tender_radar'), async (req, res) => {
  const { rule_name, keywords, excluded_keywords, target_provinces, min_estimated_value, notification_channels, whatsapp_number, recipient_emails } = req.body;
  try {
    const tenantId = await resolveTenantId(req, db);
    const kwArr = Array.isArray(keywords) ? keywords : String(keywords || '').split(',').map(s => s.trim()).filter(Boolean);
    const exArr = Array.isArray(excluded_keywords) ? excluded_keywords : String(excluded_keywords || '').split(',').map(s => s.trim()).filter(Boolean);
    const provArr = Array.isArray(target_provinces) ? target_provinces : String(target_provinces || 'Federal,Punjab,Sindh').split(',').map(s => s.trim()).filter(Boolean);
    const chanArr = Array.isArray(notification_channels) ? notification_channels : ['Email', 'WhatsApp'];
    const emailArr = Array.isArray(recipient_emails) ? recipient_emails : String(recipient_emails || '').split(',').map(s => s.trim()).filter(Boolean);

    const result = await db.query(
      `INSERT INTO tenant_tender_alert_rules
       (tenant_id, rule_name, keywords, excluded_keywords, target_provinces, min_estimated_value, notification_channels, whatsapp_number, recipient_emails)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tenantId, rule_name || 'Daily PPRA Keyword Alert', kwArr, exArr, provArr, parseFloat(min_estimated_value || 0), chanArr, whatsapp_number || '', emailArr]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE Alert Rule
router.delete('/alerts/:id', authenticate, requireModuleLicense('mod_tender_radar'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    await db.query(`DELETE FROM tenant_tender_alert_rules WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true, message: 'Alert rule deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET Alert Dispatch Log
router.get('/dispatches', authenticate, requireModuleLicense('mod_tender_radar'), async (req, res) => {
  try {
    const tenantId = await resolveTenantId(req, db);
    const result = await db.query(
      `SELECT d.*, r.rule_name, p.tender_ref_number, p.title as tender_title, p.organization_name, p.portal_source
       FROM tender_alert_dispatches d
       LEFT JOIN tenant_tender_alert_rules r ON d.rule_id = r.id
       LEFT JOIN public_tender_scrapes p ON d.public_tender_id = p.id
       WHERE d.tenant_id = $1
       ORDER BY d.dispatched_at DESC LIMIT 100`,
      [tenantId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

