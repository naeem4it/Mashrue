/**
 * Mashrue Enterprise BMS — Modular Notification Module Routes
 * Implements:
 *  - In-app Notification Inbox & Unread Counter
 *  - Notification Rules Management (Create, Edit, Duplicate, Archive, Restore)
 *  - Background Scheduled Jobs Monitoring & Operational Trigger
 *  - Delivery Logs, Failure Diagnosis & Controlled Retries
 *  - Notification Providers Configuration (SMTP, SMS, WhatsApp)
 *  - Rate-limited Test-Send Diagnostic Utility
 *  - User Notification Preferences & Quiet Hours
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');
const { requirePermission, requireModuleLicense } = require('../middleware/rbac.middleware');
const notificationService = require('../services/notificationService');

// Helper to extract effective tenant id
async function getTenantId(req) {
  if (req.user?.tenantId) return req.user.tenantId;
  if (req.user?.tenant_id) return req.user.tenant_id;
  const res = await db.query('SELECT id FROM tenants LIMIT 1');
  return res.rows[0]?.id;
}

// ============================================================================
// 1. INBOX & UNREAD COUNTER
// ============================================================================
router.get('/inbox', authenticate, async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const userId = req.user.id;
    const { is_read, priority, module, limit = 50, offset = 0 } = req.query;

    const params = [tenantId, userId];
    let sql = `
      SELECT * FROM notifications_inbox
      WHERE tenant_id = $1 AND (user_id = $2 OR user_id IS NULL)
    `;

    if (is_read === 'true') {
      sql += ` AND is_read = TRUE`;
    } else if (is_read === 'false') {
      sql += ` AND is_read = FALSE`;
    }

    if (priority && priority !== 'all') {
      params.push(priority);
      sql += ` AND priority = $${params.length}`;
    }

    if (module && module !== 'all') {
      params.push(module);
      sql += ` AND module = $${params.length}`;
    }

    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await db.query(sql, params);

    // Total unread count
    const unreadRes = await db.query(`
      SELECT COUNT(*) as unread_count
      FROM notifications_inbox
      WHERE tenant_id = $1 AND (user_id = $2 OR user_id IS NULL) AND is_read = FALSE
    `, [tenantId, userId]);

    res.json({
      success: true,
      data: result.rows,
      unread_count: parseInt(unreadRes.rows[0]?.unread_count || 0, 10)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/unread-count', authenticate, async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const userId = req.user.id;
    const unreadRes = await db.query(`
      SELECT COUNT(*) as unread_count
      FROM notifications_inbox
      WHERE tenant_id = $1 AND (user_id = $2 OR user_id IS NULL) AND is_read = FALSE
    `, [tenantId, userId]);

    res.json({
      success: true,
      unread_count: parseInt(unreadRes.rows[0]?.unread_count || 0, 10)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/inbox/:id/read', authenticate, async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const userId = req.user.id;
    await db.query(`
      UPDATE notifications_inbox
      SET is_read = TRUE, read_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND (user_id = $3 OR user_id IS NULL)
    `, [req.params.id, tenantId, userId]);

    res.json({ success: true, message: 'Notification marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/inbox/read-all', authenticate, async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const userId = req.user.id;
    await db.query(`
      UPDATE notifications_inbox
      SET is_read = TRUE, read_at = NOW()
      WHERE tenant_id = $1 AND (user_id = $2 OR user_id IS NULL) AND is_read = FALSE
    `, [tenantId, userId]);

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/inbox/:id', authenticate, async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const userId = req.user.id;
    await db.query(`
      DELETE FROM notifications_inbox
      WHERE id = $1 AND tenant_id = $2 AND (user_id = $3 OR user_id IS NULL)
    `, [req.params.id, tenantId, userId]);

    res.json({ success: true, message: 'Notification removed from inbox' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 2. NOTIFICATION RULES MANAGEMENT
// ============================================================================
router.get('/rules', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const { module, event_trigger, is_active, is_archived } = req.query;

    const params = [tenantId];
    let sql = `SELECT * FROM notification_rules WHERE tenant_id = $1`;

    if (module && module !== 'all') {
      params.push(module);
      sql += ` AND module = $${params.length}`;
    }

    if (event_trigger && event_trigger !== 'all') {
      params.push(event_trigger);
      sql += ` AND event_trigger = $${params.length}`;
    }

    if (is_active !== undefined) {
      params.push(is_active === 'true');
      sql += ` AND is_active = $${params.length}`;
    }

    if (is_archived === 'true') {
      sql += ` AND is_archived = TRUE`;
    } else {
      sql += ` AND is_archived = FALSE`;
    }

    sql += ` ORDER BY created_at DESC`;
    const result = await db.query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/rules', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const {
      rule_name, module = 'tenders', event_trigger, lead_time_hours = 24,
      recurrence = 'once', channels = ['in_app'], recipient_type = 'assigned_user',
      recipient_roles = ['admin'], recipient_user_ids = [], recipient_emails = [],
      recipient_phones = [], message_template_title, message_template_body,
      quiet_hours_enabled = false, quiet_hours_start = '22:00', quiet_hours_end = '08:00',
      timezone = 'Asia/Karachi', is_active = true
    } = req.body;

    if (!rule_name || !event_trigger) {
      return res.status(400).json({ success: false, message: 'Rule Name and Event Trigger are required' });
    }

    const result = await db.query(`
      INSERT INTO notification_rules (
        tenant_id, rule_name, module, event_trigger, lead_time_hours,
        recurrence, channels, recipient_type, recipient_roles, recipient_user_ids,
        recipient_emails, recipient_phones, message_template_title, message_template_body,
        quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *
    `, [
      tenantId, rule_name.trim(), module, event_trigger, parseInt(lead_time_hours, 10),
      recurrence, channels, recipient_type, recipient_roles, recipient_user_ids.length ? recipient_user_ids : null,
      recipient_emails, recipient_phones, message_template_title, message_template_body,
      !!quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone, !!is_active
    ]);

    res.status(201).json({ success: true, data: result.rows[0], message: 'Notification rule created successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/rules/:id', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const {
      rule_name, event_trigger, lead_time_hours, recurrence,
      channels, recipient_type, recipient_roles, recipient_user_ids,
      recipient_emails, recipient_phones, message_template_title,
      message_template_body, quiet_hours_enabled, quiet_hours_start,
      quiet_hours_end, timezone, is_active
    } = req.body;

    const result = await db.query(`
      UPDATE notification_rules
      SET rule_name = COALESCE($1, rule_name),
          event_trigger = COALESCE($2, event_trigger),
          lead_time_hours = COALESCE($3, lead_time_hours),
          recurrence = COALESCE($4, recurrence),
          channels = COALESCE($5, channels),
          recipient_type = COALESCE($6, recipient_type),
          recipient_roles = COALESCE($7, recipient_roles),
          recipient_user_ids = COALESCE($8, recipient_user_ids),
          recipient_emails = COALESCE($9, recipient_emails),
          recipient_phones = COALESCE($10, recipient_phones),
          message_template_title = COALESCE($11, message_template_title),
          message_template_body = COALESCE($12, message_template_body),
          quiet_hours_enabled = COALESCE($13, quiet_hours_enabled),
          quiet_hours_start = COALESCE($14, quiet_hours_start),
          quiet_hours_end = COALESCE($15, quiet_hours_end),
          timezone = COALESCE($16, timezone),
          is_active = COALESCE($17, is_active),
          updated_at = NOW()
      WHERE id = $18 AND tenant_id = $19
      RETURNING *
    `, [
      rule_name, event_trigger, lead_time_hours, recurrence, channels,
      recipient_type, recipient_roles, recipient_user_ids, recipient_emails, recipient_phones,
      message_template_title, message_template_body, quiet_hours_enabled, quiet_hours_start,
      quiet_hours_end, timezone, is_active, req.params.id, tenantId
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Notification rule not found' });
    }

    res.json({ success: true, data: result.rows[0], message: 'Notification rule updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/rules/:id/duplicate', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const ruleRes = await db.query(`SELECT * FROM notification_rules WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    if (ruleRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Rule not found' });
    }

    const r = ruleRes.rows[0];
    const newName = `Copy of ${r.rule_name}`;

    const dupRes = await db.query(`
      INSERT INTO notification_rules (
        tenant_id, rule_name, module, event_trigger, lead_time_hours,
        recurrence, channels, recipient_type, recipient_roles, recipient_user_ids,
        recipient_emails, recipient_phones, message_template_title, message_template_body,
        quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone, is_active
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,FALSE)
      RETURNING *
    `, [
      tenantId, newName, r.module, r.event_trigger, r.lead_time_hours,
      r.recurrence, r.channels, r.recipient_type, r.recipient_roles, r.recipient_user_ids,
      r.recipient_emails, r.recipient_phones, r.message_template_title, r.message_template_body,
      r.quiet_hours_enabled, r.quiet_hours_start, r.quiet_hours_end, r.timezone
    ]);

    res.status(201).json({ success: true, data: dupRes.rows[0], message: 'Notification rule duplicated as draft' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/rules/:id/archive', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    await db.query(`
      UPDATE notification_rules
      SET is_archived = TRUE, is_active = FALSE, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
    `, [req.params.id, tenantId]);
    res.json({ success: true, message: 'Notification rule archived' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/rules/:id/restore', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    await db.query(`
      UPDATE notification_rules
      SET is_archived = FALSE, is_active = TRUE, updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
    `, [req.params.id, tenantId]);
    res.json({ success: true, message: 'Notification rule restored' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/rules/:id', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    await db.query(`DELETE FROM notification_rules WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true, message: 'Notification rule deleted permanently' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 3. SCHEDULED BACKGROUND JOBS MONITORING
// ============================================================================
router.get('/jobs', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const { status, limit = 50 } = req.query;

    const params = [tenantId];
    let sql = `
      SELECT j.*, r.rule_name, r.event_trigger, r.channels
      FROM notification_scheduled_jobs j
      LEFT JOIN notification_rules r ON j.rule_id = r.id
      WHERE j.tenant_id = $1
    `;

    if (status && status !== 'all') {
      params.push(status);
      sql += ` AND j.status = $${params.length}`;
    }

    sql += ` ORDER BY j.scheduled_for DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit, 10));

    const result = await db.query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/jobs/:id/cancel', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    await db.query(`
      UPDATE notification_scheduled_jobs
      SET status = 'cancelled', last_error = 'Manually cancelled by user', updated_at = NOW()
      WHERE id = $1 AND tenant_id = $2
    `, [req.params.id, tenantId]);

    res.json({ success: true, message: 'Scheduled job cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/jobs/process-now', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const result = await notificationService.processScheduledJobs();
    res.json({ success: true, message: 'Scheduled jobs processor executed', result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 4. DELIVERY LOGS & CONTROLLED RETRY
// ============================================================================
router.get('/logs', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const { status, channel, limit = 50, offset = 0 } = req.query;

    const params = [tenantId];
    let sql = `
      SELECT l.*, r.rule_name
      FROM notification_delivery_logs l
      LEFT JOIN notification_rules r ON l.rule_id = r.id
      WHERE l.tenant_id = $1
    `;

    if (status && status !== 'all') {
      params.push(status);
      sql += ` AND l.status = $${params.length}`;
    }

    if (channel && channel !== 'all') {
      params.push(channel);
      sql += ` AND l.channel = $${params.length}`;
    }

    sql += ` ORDER BY l.sent_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    const result = await db.query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/logs/:id/retry', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const logRes = await db.query(`SELECT * FROM notification_delivery_logs WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    if (logRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Delivery log not found' });
    }

    const log = logRes.rows[0];
    let dispatchRes;

    if (log.channel === 'email') {
      dispatchRes = await notificationService.dispatchEmail(tenantId, log.rule_id, log.job_id, log.recipient, log.subject, log.content);
    } else if (log.channel === 'sms') {
      dispatchRes = await notificationService.dispatchSms(tenantId, log.rule_id, log.job_id, log.recipient, log.subject, log.content);
    } else if (log.channel === 'whatsapp') {
      dispatchRes = await notificationService.dispatchWhatsApp(tenantId, log.rule_id, log.job_id, log.recipient, log.subject, log.content);
    } else {
      return res.status(400).json({ success: false, message: 'Cannot retry in-app logs' });
    }

    res.json({ success: dispatchRes.status === 'delivered' || dispatchRes.status === 'accepted', result: dispatchRes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 5. NOTIFICATION PROVIDERS (CREDENTIAL SECURITY)
// ============================================================================
router.get('/providers', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const result = await db.query(`
      SELECT id, channel, provider_name, is_enabled, is_default, rate_limit_per_minute,
             created_at, updated_at,
             -- Return masked config so credentials never leak into frontend or browser console
             jsonb_build_object(
               'senderEmail', config->>'senderEmail',
               'senderName', config->>'senderName',
               'host', config->>'host',
               'port', config->>'port',
               'fromNumber', config->>'fromNumber',
               'hasApiKey', (config->>'apiKey' IS NOT NULL AND config->>'apiKey' != ''),
               'hasPassword', (config->>'authPass' IS NOT NULL AND config->>'authPass' != ''),
               'webhookUrl', config->>'webhookUrl'
             ) as safe_config
      FROM tenant_notification_providers
      WHERE tenant_id = $1
    `, [tenantId]);

    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/providers', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const { channel, provider_name, is_enabled = true, config = {}, rate_limit_per_minute = 60 } = req.body;

    if (!channel || !provider_name) {
      return res.status(400).json({ success: false, message: 'Channel and Provider Name are required' });
    }

    const result = await db.query(`
      INSERT INTO tenant_notification_providers (
        tenant_id, channel, provider_name, is_enabled, config, rate_limit_per_minute
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (tenant_id, channel, provider_name) DO UPDATE
      SET is_enabled = EXCLUDED.is_enabled,
          config = notification_providers_merge(tenant_notification_providers.config, EXCLUDED.config),
          rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
          updated_at = NOW()
      RETURNING id, channel, provider_name, is_enabled, rate_limit_per_minute
    `, [tenantId, channel, provider_name, !!is_enabled, JSON.stringify(config), parseInt(rate_limit_per_minute, 10)]).catch(async () => {
      // Fallback if merge function doesn't exist
      return await db.query(`
        INSERT INTO tenant_notification_providers (
          tenant_id, channel, provider_name, is_enabled, config, rate_limit_per_minute
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (tenant_id, channel, provider_name) DO UPDATE
        SET is_enabled = EXCLUDED.is_enabled,
            config = EXCLUDED.config,
            rate_limit_per_minute = EXCLUDED.rate_limit_per_minute,
            updated_at = NOW()
        RETURNING id, channel, provider_name, is_enabled, rate_limit_per_minute
      `, [tenantId, channel, provider_name, !!is_enabled, JSON.stringify(config), parseInt(rate_limit_per_minute, 10)]);
    });

    res.json({ success: true, data: result.rows[0], message: 'Provider settings saved securely' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete('/providers/:id', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    await db.query(`DELETE FROM tenant_notification_providers WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true, message: 'Provider settings removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 6. TEST-SEND FUNCTION (RATE LIMITED)
// ============================================================================
router.post('/test-send', authenticate, requireModuleLicense('mod_notifications'), async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const userId = req.user.id;
    const { channel, recipient, subject, content } = req.body;

    if (!channel || !recipient) {
      return res.status(400).json({ success: false, message: 'Channel and recipient are required' });
    }

    const testRes = await notificationService.testSend({
      tenantId,
      userId,
      channel,
      recipient,
      subject: subject || 'Test Notification Alert',
      content: content || 'This is a test notification from the Mashrue Tender Notification Engine.'
    });

    if (!testRes.success) {
      return res.status(400).json({ success: false, message: testRes.message, details: testRes.details });
    }

    res.json({ success: true, message: testRes.message, details: testRes.details });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ============================================================================
// 7. USER NOTIFICATION PREFERENCES & QUIET HOURS
// ============================================================================
router.get('/preferences', authenticate, async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const userId = req.user.id;

    const result = await db.query(`
      SELECT * FROM user_notification_preferences
      WHERE tenant_id = $1 AND user_id = $2
    `, [tenantId, userId]);

    if (result.rows.length === 0) {
      // Default preferences
      return res.json({
        success: true,
        data: {
          email_notifications: true,
          sms_notifications: false,
          whatsapp_notifications: false,
          in_app_notifications: true,
          quiet_hours_enabled: false,
          quiet_hours_start: '22:00',
          quiet_hours_end: '08:00',
          timezone: 'Asia/Karachi'
        }
      });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/preferences', authenticate, async (req, res) => {
  try {
    const tenantId = await getTenantId(req);
    const userId = req.user.id;
    const {
      email_notifications = true, sms_notifications = false,
      whatsapp_notifications = false, in_app_notifications = true,
      quiet_hours_enabled = false, quiet_hours_start = '22:00',
      quiet_hours_end = '08:00', timezone = 'Asia/Karachi'
    } = req.body;

    const result = await db.query(`
      INSERT INTO user_notification_preferences (
        tenant_id, user_id, email_notifications, sms_notifications,
        whatsapp_notifications, in_app_notifications, quiet_hours_enabled,
        quiet_hours_start, quiet_hours_end, timezone
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (tenant_id, user_id) DO UPDATE
      SET email_notifications = EXCLUDED.email_notifications,
          sms_notifications = EXCLUDED.sms_notifications,
          whatsapp_notifications = EXCLUDED.whatsapp_notifications,
          in_app_notifications = EXCLUDED.in_app_notifications,
          quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
          quiet_hours_start = EXCLUDED.quiet_hours_start,
          quiet_hours_end = EXCLUDED.quiet_hours_end,
          timezone = EXCLUDED.timezone,
          updated_at = NOW()
      RETURNING *
    `, [
      tenantId, userId, !!email_notifications, !!sms_notifications,
      !!whatsapp_notifications, !!in_app_notifications, !!quiet_hours_enabled,
      quiet_hours_start, quiet_hours_end, timezone
    ]);

    res.json({ success: true, data: result.rows[0], message: 'Preferences updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;

