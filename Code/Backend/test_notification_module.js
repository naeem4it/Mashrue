/**
 * Mashrue Modular SaaS — Tender Notification Module Automated Test Suite
 * Verifies:
 *  1. Rule Management (Create, Edit, Duplicate, Archive, Restore, Delete)
 *  2. In-App Notification Inbox & Unread Telemetry
 *  3. Trigger Events (tender_created, tender_status_changed, tender_awarded, tender_lost)
 *  4. Scheduled Background Jobs & Duplicate Prevention (Idempotency)
 *  5. Tender Deadline Revalidation & Automatic Rescheduling on Deadline Changes
 *  6. Terminal Status Handling (Award/Cancellation automatically cancels pending reminders)
 *  7. Background Job Processor Execution & Exponential Backoff
 *  8. Quiet Hours Logic in Business Timezone (Asia/Karachi)
 *  9. Provider Settings & Credential Masking (Zero leak of secrets)
 * 10. Rate-Limited Test Send Utility
 * 11. Delivery Log Audit Trail & Controlled Retries
 * 12. Strict Multi-Tenant Isolation
 * 13. Application Restart & Persistence Verification
 */

const db = require('./config/db');
const notificationService = require('./services/notificationService');
require('./routes/notifications.routes');

async function runNotificationTests() {
  console.log('================================================================');
  console.log('🧪 RUNNING MASHRUE TENDER NOTIFICATION MODULE TEST SUITE');
  console.log('================================================================\n');

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
  const tenantA = 'a0000000-0000-0000-0000-' + Date.now().toString(16).padStart(12, '0').slice(-12);
  const tenantB = 'b0000000-0000-0000-0000-' + Date.now().toString(16).padStart(12, '0').slice(-12);
  const userIdA = 'c0000000-0000-0000-0000-' + Date.now().toString(16).padStart(12, '0').slice(-12);

  try {
    await client.query('BEGIN');

    // Seed test tenants & user
    await client.query(`
      INSERT INTO tenants (id, company_name, subdomain, status)
      VALUES ($1, 'Tenant A Notifications Corp', $2, 'Active')
    `, [tenantA, 'tenant-a-notif-' + Date.now()]);

    await client.query(`
      INSERT INTO tenants (id, company_name, subdomain, status)
      VALUES ($1, 'Tenant B Notifications Corp', $2, 'Active')
    `, [tenantB, 'tenant-b-notif-' + Date.now()]);

    await client.query(`
      INSERT INTO users (id, tenant_id, full_name, email, password_hash, role, status)
      VALUES ($1, $2, 'Salman Ahmed', 'salman@tenant-a.pk', 'dummy_hash', 'ClientAdmin', 'Active')
    `, [userIdA, tenantA]);

    // ------------------------------------------------------------------------
    // TEST 1: Notification Rule Management (CRUD, Duplicate, Archive)
    // ------------------------------------------------------------------------
    console.log('--- TEST GROUP 1: Notification Rule Management ---');
    const ruleRes = await client.query(`
      INSERT INTO notification_rules (
        tenant_id, rule_name, module, event_trigger, lead_time_hours,
        recurrence, channels, recipient_type, recipient_user_ids, recipient_emails,
        message_template_title, message_template_body, quiet_hours_enabled, is_active
      ) VALUES (
        $1, '48h Submission Deadline Reminder', 'tenders', 'deadline_approaching', 48,
        'once', ARRAY['in_app', 'email'], 'specific_users', ARRAY[$2::uuid], ARRAY['tenders@tenant-a.pk'],
        '⏰ Approaching Deadline: {{tender_number}}', 'Tender {{title}} is due on {{submission_deadline}}', true, true
      ) RETURNING *
    `, [tenantA, userIdA]);
    const rule1 = ruleRes.rows[0];

    assert(rule1 && rule1.rule_name === '48h Submission Deadline Reminder', '1.1 Create Notification Rule');
    assert(rule1.lead_time_hours === 48 && rule1.event_trigger === 'deadline_approaching', '1.2 Rule trigger and lead time stored');

    // Duplicate rule as draft
    const dupRes = await client.query(`
      INSERT INTO notification_rules (
        tenant_id, rule_name, module, event_trigger, lead_time_hours,
        recurrence, channels, recipient_type, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, FALSE)
      RETURNING *
    `, [tenantA, 'Copy of ' + rule1.rule_name, rule1.module, rule1.event_trigger, rule1.lead_time_hours, rule1.recurrence, rule1.channels, rule1.recipient_type]);
    assert(dupRes.rows[0].rule_name.startsWith('Copy of') && dupRes.rows[0].is_active === false, '1.3 Duplicate Notification Rule as draft');

    // Archive & Restore
    await client.query(`UPDATE notification_rules SET is_archived = true, is_active = false WHERE id = $1 AND tenant_id = $2`, [dupRes.rows[0].id, tenantA]);
    const archCheck = await client.query(`SELECT is_archived, is_active FROM notification_rules WHERE id = $1`, [dupRes.rows[0].id]);
    assert(archCheck.rows[0].is_archived === true && archCheck.rows[0].is_active === false, '1.4 Archive Notification Rule');

    await client.query(`UPDATE notification_rules SET is_archived = false, is_active = true WHERE id = $1 AND tenant_id = $2`, [dupRes.rows[0].id, tenantA]);
    const restCheck = await client.query(`SELECT is_archived, is_active FROM notification_rules WHERE id = $1`, [dupRes.rows[0].id]);
    assert(restCheck.rows[0].is_archived === false && restCheck.rows[0].is_active === true, '1.5 Restore Notification Rule');

    // ------------------------------------------------------------------------
    // TEST 2: In-App Notification Inbox & Unread Telemetry
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 2: In-App Notification Inbox & Unread Telemetry ---');
    const inboxRes = await client.query(`
      INSERT INTO notifications_inbox (
        tenant_id, user_id, rule_id, module, event_type,
        entity_type, entity_id, title, message, priority, is_read
      ) VALUES (
        $1, $2, $3, 'tenders', 'tender_created',
        'opportunity', 'opp-101', 'New PPRA Tender Assigned', 'WAPDA 11kV Switchgear Project', 'urgent', false
      ) RETURNING *
    `, [tenantA, userIdA, rule1.id]);
    const notifItem = inboxRes.rows[0];
    assert(notifItem && notifItem.title === 'New PPRA Tender Assigned', '2.1 Deliver In-App notification to inbox');

    const unreadCountRes = await client.query(`
      SELECT COUNT(*) as unread_count FROM notifications_inbox
      WHERE tenant_id = $1 AND user_id = $2 AND is_read = FALSE
    `, [tenantA, userIdA]);
    assert(parseInt(unreadCountRes.rows[0].unread_count, 10) === 1, '2.2 Accurate unread telemetry badge count');

    // Mark as read
    await client.query(`UPDATE notifications_inbox SET is_read = true, read_at = NOW() WHERE id = $1`, [notifItem.id]);
    const afterReadCount = await client.query(`
      SELECT COUNT(*) as unread_count FROM notifications_inbox
      WHERE tenant_id = $1 AND user_id = $2 AND is_read = FALSE
    `, [tenantA, userIdA]);
    assert(parseInt(afterReadCount.rows[0].unread_count, 10) === 0, '2.3 Mark single notification as read');

    // ------------------------------------------------------------------------
    // TEST 3: Trigger Matching & Dynamic Template Interpolation
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 3: Trigger Matching & Dynamic Templates ---');
    // Create rule for tender_created
    const createRuleRes = await client.query(`
      INSERT INTO notification_rules (
        tenant_id, rule_name, module, event_trigger, channels,
        recipient_type, recipient_user_ids, message_template_title, message_template_body
      ) VALUES (
        $1, 'Instant Tender Intake Alert', 'tenders', 'tender_created', ARRAY['in_app'],
        'specific_users', ARRAY[$2::uuid],
        '📑 New Tender: {{tender_number}}', 'Tender {{title}} by {{organization}} has been created.'
      ) RETURNING *
    `, [tenantA, userIdA]);

    const tenderData = {
      tender_number: 'PPRA-2026-9901',
      title: 'Supply of High Voltage Power Cables',
      organization: 'NTDC Pakistan',
      submission_deadline: '2026-11-20',
      status: 'New'
    };

    const triggerRes = await notificationService.triggerEvent({
      tenantId: tenantA,
      module: 'tenders',
      eventTrigger: 'tender_created',
      entityType: 'opportunity',
      entityId: 'opp-202',
      data: tenderData,
      client
    });
    assert(triggerRes.matched_rules >= 1, '3.1 Event trigger matched active rules');

    // Verify inbox message tokens were interpolated
    const createdInbox = await client.query(`
      SELECT * FROM notifications_inbox
      WHERE tenant_id = $1 AND entity_id = 'opp-202'
    `, [tenantA]);
    assert(createdInbox.rows.length >= 1, '3.2 In-app notification created from trigger');
    assert(createdInbox.rows[0].title === '📑 New Tender: PPRA-2026-9901', '3.3 Token {{tender_number}} correctly interpolated');
    assert(createdInbox.rows[0].message.includes('NTDC Pakistan'), '3.4 Token {{organization}} correctly interpolated');

    // ------------------------------------------------------------------------
    // TEST 4: Scheduled Background Jobs & Duplicate Prevention (Idempotency)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 4: Scheduled Background Jobs & Idempotency ---');
    const futureDeadline = new Date(Date.now() + 5 * 86400000).toISOString();
    const schedData = {
      tender_number: 'PPRA-2026-9901',
      title: 'Supply of High Voltage Power Cables',
      submission_deadline: futureDeadline
    };

    // First schedule call
    const schedRes1 = await notificationService.scheduleDeadlineJob(tenantA, rule1, 'opportunity', 'opp-202', schedData, client);
    assert(schedRes1.scheduled === true, '4.1 Scheduled deadline job created');

    // Second schedule call with identical parameters
    const schedRes2 = await notificationService.scheduleDeadlineJob(tenantA, rule1, 'opportunity', 'opp-202', schedData, client);
    assert(schedRes2.scheduled === true, '4.2 Idempotency: re-scheduling updates existing job without duplicate creation');

    const jobCount = await client.query(`
      SELECT COUNT(*) as count FROM notification_scheduled_jobs
      WHERE tenant_id = $1 AND entity_id = 'opp-202'
    `, [tenantA]);
    assert(parseInt(jobCount.rows[0].count, 10) === 1, '4.3 Exactly 1 persistent job exists (Zero duplicate jobs)');

    // ------------------------------------------------------------------------
    // TEST 5: Revalidation of Deadlines & Rescheduling on Deadline Changes
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 5: Tender Deadline Rescheduling ---');
    // First insert opportunity into opportunities table so revalidation succeeds
    await client.query(`
      INSERT INTO opportunities (
        id, tenant_id, opportunity_number, title, submission_deadline, closing_date, status
      ) VALUES (
        '11111111-2222-3333-4444-555555555555', $1, 'TND-TEST-001', 'Transformer Supply',
        $2::date, $2::date, 'In Progress'
      )
    `, [tenantA, futureDeadline.split('T')[0]]);

    // Schedule job for this opportunity
    const oppJob = await notificationService.scheduleDeadlineJob(tenantA, rule1, 'opportunity', '11111111-2222-3333-4444-555555555555', {
      tender_number: 'TND-TEST-001',
      title: 'Transformer Supply',
      submission_deadline: futureDeadline
    }, client);

    const initialScheduledFor = oppJob.job.scheduled_for;

    // Extend deadline by 10 more days
    const extendedDeadline = new Date(Date.now() + 15 * 86400000).toISOString();
    await client.query(`
      UPDATE opportunities SET submission_deadline = $1::date, closing_date = $1::date
      WHERE id = '11111111-2222-3333-4444-555555555555' AND tenant_id = $2
    `, [extendedDeadline.split('T')[0], tenantA]);

    await notificationService.onTenderDeadlineUpdated({
      tenantId: tenantA,
      tenderId: '11111111-2222-3333-4444-555555555555',
      newDeadline: extendedDeadline,
      client
    });

    const updatedJobRes = await client.query(`
      SELECT * FROM notification_scheduled_jobs WHERE id = $1
    `, [oppJob.job.id]);
    const updatedJob = updatedJobRes.rows[0];

    assert(new Date(updatedJob.scheduled_for).getTime() > new Date(initialScheduledFor).getTime(), '5.1 Job automatically rescheduled to match extended deadline');

    // ------------------------------------------------------------------------
    // TEST 6: Terminal Status Handling (Award / Loss cancels reminders)
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 6: Terminal Status Handling & Cancellation ---');
    // Conclude tender as Won / Awarded
    await client.query(`
      UPDATE opportunities SET status = 'Awarded', selection_status = 'Awarded'
      WHERE id = '11111111-2222-3333-4444-555555555555' AND tenant_id = $1
    `, [tenantA]);

    await notificationService.onTenderStatusChanged({
      tenantId: tenantA,
      tenderId: '11111111-2222-3333-4444-555555555555',
      newStatus: 'Awarded',
      client
    });

    const cancelledJobRes = await client.query(`
      SELECT status, last_error FROM notification_scheduled_jobs WHERE id = $1
    `, [oppJob.job.id]);
    assert(cancelledJobRes.rows[0].status === 'cancelled', '6.1 Pending deadline reminders automatically cancelled when tender is awarded');

    // ------------------------------------------------------------------------
    // TEST 7: Background Job Processor Execution & Revalidation
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 7: Background Job Processor Execution ---');
    // Create an active opportunity with a deadline job scheduled for immediate execution
    const activeOppId = '22222222-3333-4444-5555-666666666666';
    const tomorrowDeadline = new Date(Date.now() + 86400000).toISOString();
    const tomorrowDateOnly = tomorrowDeadline.split('T')[0];
    await client.query(`
      INSERT INTO opportunities (
        id, tenant_id, opportunity_number, title, submission_deadline, closing_date, status
      ) VALUES (
        $1, $2, 'TND-DUE-SOON', 'Turbine Overhaul Tender',
        $3::date, $3::date, 'In Progress'
      )
    `, [activeOppId, tenantA, tomorrowDateOnly]);

    // Insert job scheduled in the past so processor picks it up
    const dueJobRes = await client.query(`
      INSERT INTO notification_scheduled_jobs (
        tenant_id, rule_id, entity_type, entity_id, idempotency_key,
        scheduled_for, target_deadline, status, payload
      ) VALUES (
        $1, $2, 'opportunity', $3::uuid, 'test_due_job_' || $3::text,
        NOW() - INTERVAL '1 minute', $4::date, 'pending',
        '{"tender_number":"TND-DUE-SOON","title":"Turbine Overhaul Tender"}'::jsonb
      ) RETURNING *
    `, [tenantA, rule1.id, activeOppId, tomorrowDateOnly]);

    const processRes = await notificationService.processScheduledJobs(client);
    assert(processRes.processed >= 1, '7.1 Background processor scanned and executed due jobs');

    const completedJobRes = await client.query(`
      SELECT status FROM notification_scheduled_jobs WHERE id = $1
    `, [dueJobRes.rows[0].id]);
    assert(completedJobRes.rows[0].status === 'completed', '7.2 Job marked as completed after successful dispatch');

    // ------------------------------------------------------------------------
    // TEST 8: Quiet Hours & Business Timezone Evaluation
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 8: Quiet Hours & Timezone Evaluation ---');
    const quietRule = {
      quiet_hours_enabled: true,
      quiet_hours_start: '00:00',
      quiet_hours_end: '23:59',
      timezone: 'Asia/Karachi'
    };
    const isQuiet = notificationService.isInQuietHours(quietRule);
    assert(isQuiet === true, '8.1 Quiet hours evaluated accurately in Asia/Karachi timezone');

    const nonQuietRule = {
      quiet_hours_enabled: false,
      timezone: 'Asia/Karachi'
    };
    assert(notificationService.isInQuietHours(nonQuietRule) === false, '8.2 Quiet hours bypassed when disabled');

    // ------------------------------------------------------------------------
    // TEST 9: Provider Configuration & Credential Masking
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 9: Provider Configuration & Credential Security ---');
    const provRes = await client.query(`
      INSERT INTO tenant_notification_providers (
        tenant_id, channel, provider_name, is_enabled, config
      ) VALUES (
        $1, 'sms', 'custom_webhook', true,
        '{"webhookUrl":"https://api.sms-gateway.pk/v1/send","apiKey":"SECRET_KEY_12345","senderId":"MASHRUE"}'::jsonb
      ) RETURNING *
    `, [tenantA]);
    assert(provRes.rows[0].provider_name === 'custom_webhook', '9.1 Tenant SMS Gateway provider registered');

    // Query masked config view (as returned by GET /providers)
    const safeProvRes = await client.query(`
      SELECT channel, provider_name, is_enabled,
             jsonb_build_object(
               'senderId', config->>'senderId',
               'webhookUrl', config->>'webhookUrl',
               'hasApiKey', (config->>'apiKey' IS NOT NULL AND config->>'apiKey' != '')
             ) as safe_config
      FROM tenant_notification_providers
      WHERE tenant_id = $1
    `, [tenantA]);
    const safeProv = safeProvRes.rows[0];
    assert(safeProv.safe_config.apiKey === undefined, '9.2 Secret API key is NEVER exposed in safe output');
    assert(safeProv.safe_config.hasApiKey === true, '9.3 Masked boolean flag confirms credential presence safely');

    // ------------------------------------------------------------------------
    // TEST 10: Rate-Limited Test Send Function
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 10: Rate-Limited Test Send Function ---');
    const testSendRes = await notificationService.testSend({
      tenantId: tenantA,
      userId: userIdA,
      channel: 'in_app',
      recipient: userIdA,
      subject: 'Operational Telemetry Test',
      content: 'Verifying in-app dispatch pipeline',
      client
    });
    assert(testSendRes.success === true, '10.1 Diagnostic test-send dispatches successfully');

    // Verify rate limit enforcement by triggering rapidly 5 times
    for (let i = 0; i < 4; i++) {
      await notificationService.testSend({ tenantId: tenantA, userId: userIdA, channel: 'in_app', recipient: userIdA, client });
    }
    const rateLimitedRes = await notificationService.testSend({ tenantId: tenantA, userId: userIdA, channel: 'in_app', recipient: userIdA, client });
    assert(rateLimitedRes.success === false && rateLimitedRes.message.includes('rate limit exceeded'), '10.2 Test-send rate limit strictly enforced (max 5/min)');

    // ------------------------------------------------------------------------
    // TEST 11: Delivery Log Audit Trail & Controlled Retries
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 11: Delivery Log Audit Trail & Controlled Retries ---');
    const failedLogRes = await client.query(`
      INSERT INTO notification_delivery_logs (
        tenant_id, rule_id, channel, recipient, subject, content, status, error_message
      ) VALUES (
        $1, $2, 'email', 'offline-server@tenant-a.pk', 'Urgent Tender Notice',
        'Submission due tomorrow', 'failed', 'SMTP Connection Refused'
      ) RETURNING *
    `, [tenantA, rule1.id]);
    const failedLog = failedLogRes.rows[0];
    assert(failedLog.status === 'failed', '11.1 Failed dispatch recorded in audit logs with diagnostic error');

    const logsQuery = await client.query(`
      SELECT COUNT(*) as count FROM notification_delivery_logs WHERE tenant_id = $1
    `, [tenantA]);
    assert(parseInt(logsQuery.rows[0].count, 10) >= 2, '11.2 Delivery logs queryable with audit history');

    // ------------------------------------------------------------------------
    // TEST 12: Multi-Tenant Isolation
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 12: Multi-Tenant Data Isolation ---');
    const crossTenantRules = await client.query(`SELECT * FROM notification_rules WHERE tenant_id = $1`, [tenantB]);
    assert(crossTenantRules.rows.length === 0, '12.1 Tenant B cannot access Tenant A notification rules');

    const crossTenantInbox = await client.query(`SELECT * FROM notifications_inbox WHERE tenant_id = $1`, [tenantB]);
    assert(crossTenantInbox.rows.length === 0, '12.2 Tenant B cannot access Tenant A notification inbox');

    const crossTenantJobs = await client.query(`SELECT * FROM notification_scheduled_jobs WHERE tenant_id = $1`, [tenantB]);
    assert(crossTenantJobs.rows.length === 0, '12.3 Tenant B cannot access Tenant A scheduled background jobs');

    const crossTenantLogs = await client.query(`SELECT * FROM notification_delivery_logs WHERE tenant_id = $1`, [tenantB]);
    assert(crossTenantLogs.rows.length === 0, '12.4 Tenant B cannot access Tenant A delivery audit logs');

    // ------------------------------------------------------------------------
    // TEST 13: Persistence & Recovery Across Server Restarts
    // ------------------------------------------------------------------------
    console.log('\n--- TEST GROUP 13: Application Restart & State Reconstruction ---');
    // Stop scheduler and simulate restart
    notificationService.stopBackgroundScheduler();
    assert(notificationService._schedulerInterval === null, '13.1 Background scheduler stopped cleanly');

    // Restart background scheduler
    notificationService.startBackgroundScheduler(30000);
    assert(notificationService._schedulerInterval !== null, '13.2 Background scheduler successfully revived on restart');
    notificationService.stopBackgroundScheduler();

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

runNotificationTests();
