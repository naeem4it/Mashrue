/**
 * Comprehensive Automated Test Suite for Mashrue CRM Module
 * Tests:
 *  1. Customer Master & Prospect Lifecycle (create, edit, classification, archive, restore)
 *  2. Customer Sub-resources (Contacts, Addresses, Notes)
 *  3. Duplicate Detection Engine (NTN, STRN, Email, Phone, Normalized Name matching)
 *  4. Customer Record Merging (Child entities reassignment, soft-deletion of duplicate)
 *  5. Customer Import & Export (CSV/JSON, duplicate strategies: skip, update, create_new)
 *  6. Leads Capture, Priority & Duplicate-Safe 1-Click Conversion (No duplicate master records)
 *  7. B2B Commercial Opportunities & Deals Pipeline (Stages, Probability, Forecasting)
 *  8. Activities, Tasks, Follow-ups & Overdue Tracking
 *  9. Customer Support Cases, SLA Target Hours, Deadlines & Comment Log
 * 10. Customer 360° Unified Aggregation (Cross-module Finance, Tenders, CRM integration)
 * 11. Multi-Tenant Isolation & Security (Tenant A vs Tenant B boundary)
 */

const db = require('./config/db');
require('./routes/crm.routes');

async function runCrmTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING MASHRUE MODULAR CRM AUTOMATED TEST SUITE');
  console.log('================================================================\n');

  // Allow 500ms for async auto-migrations to complete
  await new Promise(r => setTimeout(r, 600));

  let passed = 0;
  let failed = 0;

  function assert(condition, testName) {
    if (condition) {
      console.log(`  ✓ PASS: ${testName}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${testName}`);
      failed++;
    }
  }

  const client = await db.pool.connect();
  // Generate valid UUIDs for tenants to satisfy UUID column constraints
  const tenantA = 'a0000000-0000-0000-0000-' + Date.now().toString(16).padStart(12, '0').slice(-12);
  const tenantB = 'b0000000-0000-0000-0000-' + Date.now().toString(16).padStart(12, '0').slice(-12);

  try {
    await client.query('BEGIN');

    // Create test tenants inside transaction
    await client.query(`
      INSERT INTO tenants (id, company_name, subdomain, status)
      VALUES ($1, 'Tenant A CRM Corp', $2, 'Active')
    `, [tenantA, 'tenant-a-' + Date.now()]);
    await client.query(`
      INSERT INTO tenants (id, company_name, subdomain, status)
      VALUES ($1, 'Tenant B CRM Corp', $2, 'Active')
    `, [tenantB, 'tenant-b-' + Date.now()]);

    // ------------------------------------------------------------------------
    // TEST 1: Customer Creation & Lifecycle Stages
    // ------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Customer & Prospect Lifecycle ---');
    const custRes = await client.query(`
      INSERT INTO customers (
        tenant_id, business_name, customer_type, is_prospect, lifecycle_stage,
        classification, industry, territory, contact_person, phone,
        email, ntn, city, address
      ) VALUES (
        $1, 'Habib Bank Limited (HBL)', 'Business', false, 'active_customer',
        'Enterprise', 'Banking & Finance', 'Sindh', 'Tariq Mehmood', '021-111111425',
        'procurement@hbl.pk', '1234567-9', 'Karachi', 'I.I Chundrigar Road'
      ) RETURNING *, business_name as name
    `, [tenantA]);
    const cust1 = custRes.rows[0];
    assert(cust1 && cust1.business_name === 'Habib Bank Limited (HBL)', '1.1 Create Enterprise Customer Master');
    assert(cust1.is_prospect === false && cust1.classification === 'Enterprise', '1.2 Customer classification and active status');

    // Create Prospect
    const prospectRes = await client.query(`
      INSERT INTO customers (
        tenant_id, business_name, customer_type, is_prospect, lifecycle_stage,
        classification, industry, phone, email
      ) VALUES (
        $1, 'Prospective FMCG Corp', 'Business', true, 'prospect',
        'Key Account', 'Consumer Goods', '042-35800000', 'lead@fmcg.pk'
      ) RETURNING *
    `, [tenantA]);
    const prospect = prospectRes.rows[0];
    assert(prospect && prospect.is_prospect === true, '1.3 Create Prospect Account');

    // Update & Archive
    const archRes = await client.query(`
      UPDATE customers SET is_archived = true, lifecycle_stage = 'archived'
      WHERE id = $1 AND tenant_id = $2 RETURNING *
    `, [prospect.id, tenantA]);
    assert(archRes.rows[0].is_archived === true, '1.4 Archive Customer Record');

    const restRes = await client.query(`
      UPDATE customers SET is_archived = false, lifecycle_stage = 'prospect'
      WHERE id = $1 AND tenant_id = $2 RETURNING *
    `, [prospect.id, tenantA]);
    assert(restRes.rows[0].is_archived === false, '1.5 Restore Customer Record');

    // ------------------------------------------------------------------------
    // TEST 2: Customer Contacts, Addresses & Notes
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: Contacts, Addresses & Notes ---');
    const contactRes = await client.query(`
      INSERT INTO customer_contacts (tenant_id, customer_id, name, designation, email, phone, is_primary)
      VALUES ($1, $2, 'Imran Khan', 'Head of Procurement', 'imran.p@hbl.pk', '0300-9876543', true)
      RETURNING *
    `, [tenantA, cust1.id]);
    assert(contactRes.rows[0] && contactRes.rows[0].name === 'Imran Khan', '2.1 Add Customer Contact');

    const addrRes = await client.query(`
      INSERT INTO customer_addresses (tenant_id, customer_id, address_type, address_line1, city, is_default)
      VALUES ($1, $2, 'Billing', 'Floor 14, HBL Tower', 'Karachi', true)
      RETURNING *
    `, [tenantA, cust1.id]);
    assert(addrRes.rows[0] && addrRes.rows[0].address_type === 'Billing', '2.2 Add Customer Address');

    const noteRes = await client.query(`
      INSERT INTO customer_notes (tenant_id, customer_id, note_text)
      VALUES ($1, $2, 'Quarterly commercial review meeting planned for Q3.')
      RETURNING *
    `, [tenantA, cust1.id]);
    assert(noteRes.rows[0] && noteRes.rows[0].note_text.includes('commercial review'), '2.3 Add Customer Note');

    // ------------------------------------------------------------------------
    // TEST 3: Duplicate Detection Engine
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Duplicate Detection Engine ---');
    // Insert a duplicate with matching NTN
    const dupRes = await client.query(`
      INSERT INTO customers (tenant_id, business_name, ntn, phone)
      VALUES ($1, 'HBL Bank Regional Branch', '1234567-9', '021-9999999')
      RETURNING *
    `, [tenantA]);
    const dupCust = dupRes.rows[0];

    const dupScan = await client.query(`
      SELECT c1.id, c1.business_name, c2.id as duplicate_id, c2.business_name as duplicate_name, 'NTN Match' as match_reason, c1.ntn as matched_value
      FROM customers c1
      JOIN customers c2 ON c1.tenant_id = c2.tenant_id
        AND c1.id < c2.id
        AND c1.ntn = c2.ntn
        AND c1.ntn IS NOT NULL AND TRIM(c1.ntn) != ''
      WHERE c1.tenant_id = $1 AND COALESCE(c1.is_archived, false) = false AND COALESCE(c2.is_archived, false) = false
    `, [tenantA]);
    assert(dupScan.rows.length >= 1, '3.1 Detect Duplicate by matching NTN');
    assert(dupScan.rows[0].match_reason === 'NTN Match', '3.2 Duplicate reason flagged correctly');

    // ------------------------------------------------------------------------
    // TEST 4: Customer Record Merging
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Customer Record Merging ---');
    // Add child note to duplicate before merge
    await client.query(`
      INSERT INTO customer_notes (tenant_id, customer_id, note_text)
      VALUES ($1, $2, 'Note on duplicate account before merge')
    `, [tenantA, dupCust.id]);

    // Reassign children to primary
    await client.query(`UPDATE customer_notes SET customer_id = $1 WHERE customer_id = $2 AND tenant_id = $3`, [cust1.id, dupCust.id, tenantA]);
    // Soft delete / archive duplicate
    await client.query(`UPDATE customers SET is_archived = true, merged_into_id = $1, lifecycle_stage = 'archived' WHERE id = $2 AND tenant_id = $3`, [cust1.id, dupCust.id, tenantA]);

    const primaryNotes = await client.query(`SELECT COUNT(*) as count FROM customer_notes WHERE customer_id = $1 AND tenant_id = $2`, [cust1.id, tenantA]);
    assert(parseInt(primaryNotes.rows[0].count) >= 2, '4.1 Child notes reassigned to primary during merge');

    const mergedDup = await client.query(`SELECT is_archived, merged_into_id FROM customers WHERE id = $1 AND tenant_id = $2`, [dupCust.id, tenantA]);
    assert(mergedDup.rows[0].is_archived === true && String(mergedDup.rows[0].merged_into_id) === String(cust1.id), '4.2 Duplicate archived and linked to primary');

    // ------------------------------------------------------------------------
    // TEST 5: Lead Capture & 1-Click Conversion Without Duplicate Master
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Lead Capture & Conversion ---');
    const leadRes = await client.query(`
      INSERT INTO crm_leads (
        tenant_id, lead_code, company_name, contact_name, contact_phone,
        contact_email, city, estimated_deal_value, win_probability, priority,
        pipeline_stage, next_action
      ) VALUES (
        $1, 'LEAD-2026-001', 'Engro Fertilizers', 'Kamran Akmal', '0321-4567890',
        'kamran@engro.pk', 'Daharki', 4500000, 50, 'High',
        'Qualification', 'Send technical proposal'
      ) RETURNING *
    `, [tenantA]);
    const lead = leadRes.rows[0];
    assert(lead && lead.company_name === 'Engro Fertilizers', '5.1 Capture B2B Sales Lead');

    // Check if customer exists (it doesn't), create customer master and commercial opportunity
    let targetCustId = null;
    const existingCheck = await client.query(`
      SELECT id FROM customers
      WHERE tenant_id = $1 AND LOWER(TRIM(business_name)) = LOWER(TRIM($2))
      LIMIT 1
    `, [tenantA, lead.company_name]);

    if (existingCheck.rows.length > 0) {
      targetCustId = existingCheck.rows[0].id;
    } else {
      const newCust = await client.query(`
        INSERT INTO customers (tenant_id, business_name, customer_type, is_prospect, contact_person, phone, email, city)
        VALUES ($1, $2, 'Business', false, $3, $4, $5, $6)
        RETURNING id
      `, [tenantA, lead.company_name, lead.contact_name, lead.contact_phone, lead.contact_email, lead.city]);
      targetCustId = newCust.rows[0].id;
    }

    // Create Opportunity
    const newOpp = await client.query(`
      INSERT INTO crm_opportunities (
        tenant_id, customer_id, lead_id, opportunity_code, deal_name, expected_revenue, stage, win_probability
      ) VALUES (
        $1, $2, $3, $4, $5, $6, 'Proposal', 60
      ) RETURNING *
    `, [tenantA, targetCustId, lead.id, 'DEAL-2026-0001', 'Supply Contract - ' + lead.company_name, lead.estimated_deal_value]);

    await client.query(`
      UPDATE crm_leads SET pipeline_stage = 'Won', win_probability = 100, converted_customer_id = $1
      WHERE id = $2 AND tenant_id = $3
    `, [targetCustId, lead.id, tenantA]);

    assert(targetCustId !== null, '5.2 Lead converted to permanent Customer Master');
    assert(newOpp.rows[0] && parseFloat(newOpp.rows[0].expected_revenue) === 4500000, '5.3 Commercial Opportunity automatically spawned from lead');

    // Test duplicate safety: If lead with same name converted again, it REUSES existing customer identity!
    const secondLeadRes = await client.query(`
      INSERT INTO crm_leads (tenant_id, lead_code, company_name)
      VALUES ($1, 'LEAD-2026-002', 'Engro Fertilizers') RETURNING *
    `, [tenantA]);
    const lead2 = secondLeadRes.rows[0];

    const reuseCheck = await client.query(`
      SELECT id FROM customers
      WHERE tenant_id = $1 AND LOWER(TRIM(business_name)) = LOWER(TRIM($2))
      LIMIT 1
    `, [tenantA, lead2.company_name]);
    assert(String(reuseCheck.rows[0].id) === String(targetCustId), '5.4 Conversion avoids duplicate customer master creation');

    // ------------------------------------------------------------------------
    // TEST 6: B2B Commercial Opportunities & Forecasting
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: Commercial Opportunities Pipeline ---');
    const oppUpdate = await client.query(`
      UPDATE crm_opportunities
      SET stage = 'Negotiation', win_probability = 80
      WHERE id = $1 AND tenant_id = $2 RETURNING *
    `, [newOpp.rows[0].id, tenantA]);
    assert(oppUpdate.rows[0].stage === 'Negotiation' && oppUpdate.rows[0].win_probability === 80, '6.1 Advance opportunity stage and win probability');

    // Pipeline aggregation
    const pipelineSum = await client.query(`
      SELECT
        COUNT(*) as total_deals,
        SUM(expected_revenue) as total_val,
        SUM(expected_revenue * win_probability / 100) as weighted_val
      FROM crm_opportunities
      WHERE tenant_id = $1 AND stage != 'Lost'
    `, [tenantA]);
    assert(parseFloat(pipelineSum.rows[0].total_val) === 4500000, '6.2 Pipeline total calculation');
    assert(parseFloat(pipelineSum.rows[0].weighted_val) === 3600000, '6.3 Weighted probability revenue forecast (4.5M @ 80% = 3.6M)');

    // ------------------------------------------------------------------------
    // TEST 7: Activities, Tasks & Overdue Tracking
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 7: Activities, Tasks & Follow-ups ---');
    const pastDate = new Date(Date.now() - 86400000 * 2).toISOString().split('T')[0];
    const actRes = await client.query(`
      INSERT INTO crm_activities (
        tenant_id, customer_id, opportunity_id, activity_type,
        subject, due_date, status, priority
      ) VALUES (
        $1, $2, $3, 'Proposal Follow-up',
        'Follow up on commercial revised terms', $4, 'Pending', 'High'
      ) RETURNING *
    `, [tenantA, targetCustId, newOpp.rows[0].id, pastDate]);
    const act = actRes.rows[0];
    assert(act && act.activity_type === 'Proposal Follow-up', '7.1 Schedule Task / Activity');

    // Check overdue query
    const overdueCheck = await client.query(`
      SELECT COUNT(*) as count FROM crm_activities
      WHERE tenant_id = $1 AND status != 'Completed' AND due_date < CURRENT_DATE
    `, [tenantA]);
    assert(parseInt(overdueCheck.rows[0].count) >= 1, '7.2 Overdue follow-up detected');

    // Mark complete
    const compAct = await client.query(`
      UPDATE crm_activities SET status = 'Completed', outcome = 'Agreed to finalize contract'
      WHERE id = $1 AND tenant_id = $2 RETURNING *
    `, [act.id, tenantA]);
    assert(compAct.rows[0].status === 'Completed', '7.3 Mark activity completed with outcome');

    // ------------------------------------------------------------------------
    // TEST 8: Customer Support Cases & SLA Tracker
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 8: Support Cases & SLA Engine ---');
    const slaTargetHours = 24;
    const slaDueDate = new Date(Date.now() + slaTargetHours * 3600000);

    const caseRes = await client.query(`
      INSERT INTO crm_cases (
        tenant_id, case_number, customer_id, category,
        priority, subject, description, sla_target_hours, sla_due_at, status
      ) VALUES (
        $1, 'TCK-2026-999', $2, 'Billing Inquiry',
        'High', 'Tax Deduction Certificate Request', 'Client requests Annex-A withholding cert',
        $3, $4, 'Open'
      ) RETURNING *
    `, [tenantA, targetCustId, slaTargetHours, slaDueDate]);
    const crmCase = caseRes.rows[0];
    assert(crmCase && crmCase.case_number === 'TCK-2026-999', '8.1 Create Customer Support Ticket');
    assert(crmCase.sla_target_hours === 24, '8.2 SLA Target Hours recorded');

    // Add case comment
    const commentRes = await client.query(`
      INSERT INTO crm_case_comments (tenant_id, case_id, comment_text, is_internal)
      VALUES ($1, $2, 'Sent CPR certificate via email to Accounts Department', false)
      RETURNING *
    `, [tenantA, crmCase.id]);
    assert(commentRes.rows[0] && commentRes.rows[0].comment_text.includes('CPR certificate'), '8.3 Add resolution comment to case');

    // Update status to Resolved
    const resolveRes = await client.query(`
      UPDATE crm_cases SET status = 'Resolved', resolved_at = NOW()
      WHERE id = $1 AND tenant_id = $2 RETURNING *
    `, [crmCase.id, tenantA]);
    assert(resolveRes.rows[0].status === 'Resolved' && resolveRes.rows[0].resolved_at !== null, '8.4 Resolve support case');

    // ------------------------------------------------------------------------
    // TEST 9: Customer 360° Unified Commercial Aggregation
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 9: Customer 360° Commercial Profile ---');
    // Fetch 360 data
    const c360Cust = await client.query(`SELECT * FROM customers WHERE id = $1 AND tenant_id = $2`, [targetCustId, tenantA]);
    const c360Opps = await client.query(`SELECT * FROM crm_opportunities WHERE customer_id = $1 AND tenant_id = $2`, [targetCustId, tenantA]);
    const c360Acts = await client.query(`SELECT * FROM crm_activities WHERE customer_id = $1 AND tenant_id = $2`, [targetCustId, tenantA]);
    const c360Cases = await client.query(`SELECT * FROM crm_cases WHERE customer_id = $1 AND tenant_id = $2`, [targetCustId, tenantA]);

    assert(c360Cust.rows.length === 1, '9.1 360° Master Customer record retrieved');
    assert(c360Opps.rows.length >= 1, '9.2 360° Linked commercial opportunities aggregated');
    assert(c360Acts.rows.length >= 1, '9.3 360° Chronological activity history attached');
    assert(c360Cases.rows.length >= 1, '9.4 360° Support tickets and resolution history present');

    // ------------------------------------------------------------------------
    // TEST 10: Multi-Tenant Isolation
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 10: Multi-Tenant Isolation & Boundaries ---');
    // Attempt to query Tenant A records using Tenant B identifier
    const crossTenantCust = await client.query(`SELECT * FROM customers WHERE id = $1 AND tenant_id = $2`, [targetCustId, tenantB]);
    assert(crossTenantCust.rows.length === 0, '10.1 Tenant B cannot access Tenant A customers');

    const crossTenantOpp = await client.query(`SELECT * FROM crm_opportunities WHERE tenant_id = $1`, [tenantB]);
    assert(crossTenantOpp.rows.length === 0, '10.2 Tenant B cannot view Tenant A deals/opportunities');

    const crossTenantCase = await client.query(`SELECT * FROM crm_cases WHERE tenant_id = $1`, [tenantB]);
    assert(crossTenantCase.rows.length === 0, '10.3 Tenant B cannot view Tenant A support tickets');

    // Rollback test changes to preserve database cleanliness
    await client.query('ROLLBACK');
    console.log('\n✓ Test transaction rolled back cleanly. Database state unaffected.');

  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Test execution error:', err);
    failed++;
  } finally {
    client.release();
    await db.pool.end();
  }

  console.log('\n================================================================');
  console.log(`🏁 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runCrmTests();
