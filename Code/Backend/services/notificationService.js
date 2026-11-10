/**
 * Mashrue Enterprise BMS — Universal Modular Notification Engine
 * Architected for Tenders & PPRA/EPADS with cross-module support for
 * CRM, Inventory, Finance, HRM, and Payroll.
 *
 * Capabilities:
 *  - Event trigger matching against tenant-configured notification rules
 *  - Dynamic token interpolation ({{tender_number}}, {{title}}, {{closing_date}}, etc.)
 *  - In-app notification delivery to user inboxes with unread telemetry
 *  - Email delivery via Resend / Custom SMTP
 *  - SMS & WhatsApp gateway dispatch via configured providers
 *  - Persistent scheduled background jobs with idempotency keys
 *  - Revalidation of tender deadlines & status before dispatch (cancelling on award/loss/cancellation)
 *  - Automatic recalculation when deadlines are updated
 *  - Exponential backoff retry policies & dead-letter queue
 *  - Quiet hours evaluation in business timezone (Asia/Karachi)
 *  - Rate-limited test-send capabilities
 */

const db = require('../config/db');
const { sendEmail } = require('./emailService');
const axios = require('axios');

class NotificationService {
  constructor() {
    this._schedulerInterval = null;
    this._testSendRateLimits = new Map(); // userId -> [timestamps]
  }

  // ==========================================================================
  // 1. EVENT TRIGGER & RULE MATCHING
  // ==========================================================================
  async triggerEvent({ tenantId, module = 'tenders', eventTrigger, entityType, entityId, data = {}, client = null }) {
    if (!tenantId || !eventTrigger) return;

    try {
      // Find active rules for this tenant and event trigger
      const rulesRes = await (client || db).query(`
        SELECT * FROM notification_rules
        WHERE tenant_id = $1
          AND module = $2
          AND event_trigger = $3
          AND is_active = TRUE
          AND is_archived = FALSE
      `, [tenantId, module, eventTrigger]);

      const rules = rulesRes.rows || [];
      if (rules.length === 0) return { matched_rules: 0 };

      const results = [];
      for (const rule of rules) {
        // Immediate events: tender_created, tender_status_changed, tender_awarded, tender_lost, task_assigned
        if (eventTrigger !== 'deadline_approaching' && eventTrigger !== 'submission_due') {
          const dispatchRes = await this.dispatchRuleImmediate(tenantId, rule, entityType, entityId, data, null, client);
          results.push(dispatchRes);
        } else {
          // Deadline events: schedule background job
          const scheduleRes = await this.scheduleDeadlineJob(tenantId, rule, entityType, entityId, data, client);
          results.push(scheduleRes);
        }
      }

      return { matched_rules: rules.length, results };
    } catch (err) {
      console.error(`[NotificationService] Error triggering ${eventTrigger}:`, err.message);
      return { error: err.message };
    }
  }

  // ==========================================================================
  // 2. DEADLINE EVENTS & PERSISTENT BACKGROUND SCHEDULING
  // ==========================================================================
  async scheduleDeadlineJob(tenantId, rule, entityType, entityId, data, client = null) {
    const rawDeadline = data.submission_deadline || data.closing_date;
    if (!rawDeadline) return { scheduled: false, reason: 'No deadline provided' };

    const deadline = new Date(rawDeadline);
    if (isNaN(deadline.getTime())) return { scheduled: false, reason: 'Invalid deadline date' };

    const leadHours = parseInt(rule.lead_time_hours || 24, 10);
    const scheduledFor = new Date(deadline.getTime() - leadHours * 3600 * 1000);

    // If scheduled time has already passed and deadline is expired, do not schedule
    if (scheduledFor < new Date() && deadline < new Date()) {
      return { scheduled: false, reason: 'Deadline has already expired' };
    }

    const triggerTime = scheduledFor < new Date() ? new Date(Date.now() + 5000) : scheduledFor;
    const idempotencyKey = `${rule.id}_${entityId}_${rule.event_trigger}_${leadHours}h_${deadline.toISOString().split('T')[0]}`;

    try {
      const jobRes = await (client || db).query(`
        INSERT INTO notification_scheduled_jobs (
          tenant_id, rule_id, entity_type, entity_id, idempotency_key,
          scheduled_for, target_deadline, status, payload
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
        ON CONFLICT (idempotency_key) DO UPDATE
        SET scheduled_for = EXCLUDED.scheduled_for,
            target_deadline = EXCLUDED.target_deadline,
            payload = EXCLUDED.payload,
            updated_at = CURRENT_TIMESTAMP
        WHERE notification_scheduled_jobs.status IN ('pending', 'retrying')
        RETURNING *
      `, [
        tenantId, rule.id, entityType, entityId, idempotencyKey,
        triggerTime, deadline, JSON.stringify(data)
      ]);

      return { scheduled: true, job: jobRes.rows[0] };
    } catch (err) {
      console.error('[NotificationService] Schedule job error:', err.message);
      return { scheduled: false, error: err.message };
    }
  }

  // Hook called when tender deadline is updated
  async onTenderDeadlineUpdated({ tenantId, tenderId, newDeadline, client = null }) {
    if (!tenantId || !tenderId || !newDeadline) return;

    try {
      const deadline = new Date(newDeadline);
      if (isNaN(deadline.getTime())) return;

      // Find all pending scheduled jobs for this tender
      const pendingJobsRes = await (client || db).query(`
        SELECT j.*, r.lead_time_hours, r.event_trigger
        FROM notification_scheduled_jobs j
        JOIN notification_rules r ON j.rule_id = r.id
        WHERE j.tenant_id = $1
          AND j.entity_type = 'opportunity'
          AND j.entity_id = $2
          AND j.status = 'pending'
      `, [tenantId, String(tenderId)]);

      for (const job of pendingJobsRes.rows) {
        if (deadline < new Date()) {
          // Deadline moved to the past: cancel job
          await (client || db).query(`
            UPDATE notification_scheduled_jobs
            SET status = 'cancelled', last_error = 'Deadline moved to past or expired'
            WHERE id = $1
          `, [job.id]);
        } else {
          // Recalculate scheduled_for
          const leadHours = parseInt(job.lead_time_hours || 24, 10);
          const newScheduledFor = new Date(deadline.getTime() - leadHours * 3600 * 1000);
          const newTriggerTime = newScheduledFor < new Date() ? new Date(Date.now() + 5000) : newScheduledFor;

          await (client || db).query(`
            UPDATE notification_scheduled_jobs
            SET scheduled_for = $1, target_deadline = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
          `, [newTriggerTime, deadline, job.id]);
        }
      }
    } catch (err) {
      console.error('[NotificationService] onTenderDeadlineUpdated error:', err.message);
    }
  }

  // Hook called when tender status changes (e.g. Awarded, Lost, Cancelled)
  async onTenderStatusChanged({ tenantId, tenderId, newStatus, client = null }) {
    if (!tenantId || !tenderId) return;

    try {
      const terminalStatuses = ['Won', 'Lost', 'Awarded', 'Cancelled', 'Disqualified', 'Rejected', 'Closed'];
      const isTerminal = terminalStatuses.some(s => s.toLowerCase() === (newStatus || '').toLowerCase());

      if (isTerminal) {
        // Cancel all pending deadline reminder jobs
        await (client || db).query(`
          UPDATE notification_scheduled_jobs
          SET status = 'cancelled', last_error = $1
          WHERE tenant_id = $2
            AND entity_type = 'opportunity'
            AND entity_id = $3
            AND status = 'pending'
        `, [`Tender transitioned to terminal status: ${newStatus}`, tenantId, String(tenderId)]);
      }

      // Check tender records and fire event triggers
      const oppRes = await (client || db).query(`
        SELECT o.*, c.business_name as customer_name
        FROM opportunities o
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.id = $1 AND o.tenant_id = $2
      `, [tenderId, tenantId]);

      if (oppRes.rows.length > 0) {
        const tender = oppRes.rows[0];
        const data = {
          tender_number: tender.opportunity_number || tender.external_tender_number,
          title: tender.title || tender.tender_name,
          organization: tender.customer_name || tender.department || 'Procuring Agency',
          status: newStatus,
          submission_deadline: tender.submission_deadline || tender.closing_date,
          closing_date: tender.closing_date,
          estimated_value: tender.estimated_value
        };

        // Fire status change
        await this.triggerEvent({
          tenantId,
          module: 'tenders',
          eventTrigger: 'tender_status_changed',
          entityType: 'opportunity',
          entityId: String(tenderId),
          data
        });

        // Fire specific Award/Loss triggers
        if (newStatus === 'Awarded' || newStatus === 'Won') {
          await this.triggerEvent({
            tenantId,
            module: 'tenders',
            eventTrigger: 'tender_awarded',
            entityType: 'opportunity',
            entityId: String(tenderId),
            data
          });
        } else if (newStatus === 'Lost') {
          await this.triggerEvent({
            tenantId,
            module: 'tenders',
            eventTrigger: 'tender_lost',
            entityType: 'opportunity',
            entityId: String(tenderId),
            data
          });
        }
      }
    } catch (err) {
      console.error('[NotificationService] onTenderStatusChanged error:', err.message);
    }
  }

  // ==========================================================================
  // 3. IMMEDIATE DISPATCH EXECUTION
  // ==========================================================================
  async dispatchRuleImmediate(tenantId, rule, entityType, entityId, data, jobId = null, client = null) {
    const channels = Array.isArray(rule.channels) ? rule.channels : ['in_app'];
    const title = this.interpolateTemplate(rule.message_template_title || this.getDefaultTitle(rule.event_trigger), data);
    const body = this.interpolateTemplate(rule.message_template_body || this.getDefaultBody(rule.event_trigger), data);

    // Resolve recipients
    const recipients = await this.resolveRecipients(tenantId, rule, data, client);
    const actionUrl = `/opportunities?id=${entityId}`;
    const dispatches = [];

    // Quiet hours check
    const isQuiet = this.isInQuietHours(rule);

    for (const ch of channels) {
      if (ch === 'in_app') {
        for (const user of recipients.users) {
          const res = await this.dispatchInApp(tenantId, rule.id, user.id, rule.module, rule.event_trigger, entityType, entityId, title, body, actionUrl, client);
          dispatches.push(res);
        }
      } else if (ch === 'email') {
        if (isQuiet && rule.quiet_hours_enabled) {
          await this.logDelivery(tenantId, rule.id, jobId, 'email', recipients.emails.join(','), title, body, 'skipped_quiet_hours', null, 'Skipped due to active quiet hours');
          continue;
        }
        for (const email of recipients.emails) {
          const res = await this.dispatchEmail(tenantId, rule.id, jobId, email, title, body, client);
          dispatches.push(res);
        }
      } else if (ch === 'sms') {
        if (isQuiet && rule.quiet_hours_enabled) {
          await this.logDelivery(tenantId, rule.id, jobId, 'sms', recipients.phones.join(','), title, body, 'skipped_quiet_hours', null, 'Skipped due to active quiet hours');
          continue;
        }
        for (const phone of recipients.phones) {
          const res = await this.dispatchSms(tenantId, rule.id, jobId, phone, title, body, client);
          dispatches.push(res);
        }
      } else if (ch === 'whatsapp') {
        if (isQuiet && rule.quiet_hours_enabled) {
          await this.logDelivery(tenantId, rule.id, jobId, 'whatsapp', recipients.phones.join(','), title, body, 'skipped_quiet_hours', null, 'Skipped due to active quiet hours');
          continue;
        }
        for (const phone of recipients.phones) {
          const res = await this.dispatchWhatsApp(tenantId, rule.id, jobId, phone, title, body, client);
          dispatches.push(res);
        }
      }
    }

    return { rule_id: rule.id, rule_name: rule.rule_name, dispatches };
  }

  // ==========================================================================
  // 4. CHANNEL DISPATCHERS (IN-APP, EMAIL, SMS, WHATSAPP)
  // ==========================================================================
  async dispatchInApp(tenantId, ruleId, userId, module, eventType, entityType, entityId, title, message, actionUrl, client = null) {
    try {
      const res = await (client || db).query(`
        INSERT INTO notifications_inbox (
          tenant_id, user_id, rule_id, module, event_type,
          entity_type, entity_id, title, message, action_url, priority
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'normal')
        RETURNING *
      `, [tenantId, userId, ruleId, module, eventType, entityType, entityId, title, message, actionUrl]);

      await this.logDelivery(tenantId, ruleId, null, 'in_app', String(userId), title, message, 'delivered', { inbox_id: res.rows[0].id }, null, client);
      return { channel: 'in_app', status: 'delivered', id: res.rows[0].id };
    } catch (err) {
      await this.logDelivery(tenantId, ruleId, null, 'in_app', String(userId), title, message, 'failed', null, err.message);
      return { channel: 'in_app', status: 'failed', error: err.message };
    }
  }

  async dispatchEmail(tenantId, ruleId, jobId, toEmail, subject, content, client = null) {
    try {
      // Check if tenant has custom email provider
      const providerRes = await (client || db).query(`
        SELECT * FROM tenant_notification_providers
        WHERE tenant_id = $1 AND channel = 'email' AND is_enabled = TRUE
        LIMIT 1
      `, [tenantId]);

      let emailRes;
      if (providerRes.rows.length > 0 && providerRes.rows[0].config?.apiKey) {
        // Use custom tenant Resend API key or custom SMTP
        const cfg = providerRes.rows[0].config;
        emailRes = await sendEmail({
          to: toEmail,
          subject,
          html: `<div style="font-family:sans-serif; color:#1e293b; padding:20px;"><h2>${subject}</h2><p style="white-space:pre-wrap;">${content}</p></div>`,
          text: content,
          from: cfg.fromEmail ? `${cfg.fromName || 'Mashrue'} <${cfg.fromEmail}>` : undefined
        });
      } else {
        // Universal platform sender
        emailRes = await sendEmail({
          to: toEmail,
          subject,
          html: `<div style="font-family:sans-serif; color:#1e293b; padding:20px; border-radius:8px; border:1px solid #e2e8f0;"><h2 style="color:#0284c7;">${subject}</h2><p style="white-space:pre-wrap; line-height:1.5;">${content}</p><hr style="border:none; border-top:1px solid #e2e8f0; margin-top:20px;"/><p style="font-size:12px; color:#64748b;">Delivered by Mashrue Tender Telemetry & Notification Engine</p></div>`,
          text: content
        });
      }

      if (emailRes && emailRes.success) {
        await this.logDelivery(tenantId, ruleId, jobId, 'email', toEmail, subject, content, 'delivered', { provider: emailRes.provider, messageId: emailRes.messageId });
        return { channel: 'email', status: 'delivered', to: toEmail };
      } else {
        const errorMsg = emailRes?.error || 'Email dispatch rejected by provider';
        await this.logDelivery(tenantId, ruleId, jobId, 'email', toEmail, subject, content, 'failed', null, errorMsg);
        return { channel: 'email', status: 'failed', to: toEmail, error: errorMsg };
      }
    } catch (err) {
      await this.logDelivery(tenantId, ruleId, jobId, 'email', toEmail, subject, content, 'failed', null, err.message);
      return { channel: 'email', status: 'failed', to: toEmail, error: err.message };
    }
  }

  async dispatchSms(tenantId, ruleId, jobId, phone, subject, content, client = null) {
    try {
      const providerRes = await (client || db).query(`
        SELECT * FROM tenant_notification_providers
        WHERE tenant_id = $1 AND channel = 'sms' AND is_enabled = TRUE
        LIMIT 1
      `, [tenantId]);

      if (providerRes.rows.length === 0) {
        const errorMsg = 'No active SMS provider configured for tenant. Configure credentials in Provider Settings.';
        await this.logDelivery(tenantId, ruleId, jobId, 'sms', phone, subject, content, 'failed', null, errorMsg);
        return { channel: 'sms', status: 'failed', error: errorMsg };
      }

      const prov = providerRes.rows[0];
      const cfg = prov.config || {};

      if (prov.provider_name === 'custom_webhook' && cfg.webhookUrl) {
        const resp = await axios.post(cfg.webhookUrl, {
          to: phone,
          message: `${subject}\n\n${content}`,
          sender: cfg.senderId || 'Mashrue'
        }, { timeout: 8000, headers: cfg.headers || {} });

        if (resp.status >= 200 && resp.status < 300) {
          await this.logDelivery(tenantId, ruleId, jobId, 'sms', phone, subject, content, 'accepted', { status: resp.status, data: resp.data }, null);
          return { channel: 'sms', status: 'accepted', phone };
        } else {
          throw new Error(`SMS Webhook returned HTTP ${resp.status}`);
        }
      } else {
        const errorMsg = `Provider ${prov.provider_name} credentials incomplete.`;
        await this.logDelivery(tenantId, ruleId, jobId, 'sms', phone, subject, content, 'failed', null, errorMsg);
        return { channel: 'sms', status: 'failed', error: errorMsg };
      }
    } catch (err) {
      await this.logDelivery(tenantId, ruleId, jobId, 'sms', phone, subject, content, 'failed', null, err.message);
      return { channel: 'sms', status: 'failed', error: err.message };
    }
  }

  async dispatchWhatsApp(tenantId, ruleId, jobId, phone, subject, content, client = null) {
    try {
      const providerRes = await (client || db).query(`
        SELECT * FROM tenant_notification_providers
        WHERE tenant_id = $1 AND channel = 'whatsapp' AND is_enabled = TRUE
        LIMIT 1
      `, [tenantId]);

      if (providerRes.rows.length === 0) {
        const errorMsg = 'No active WhatsApp provider configured for tenant. Configure credentials in Provider Settings.';
        await this.logDelivery(tenantId, ruleId, jobId, 'whatsapp', phone, subject, content, 'failed', null, errorMsg);
        return { channel: 'whatsapp', status: 'failed', error: errorMsg };
      }

      const prov = providerRes.rows[0];
      const cfg = prov.config || {};

      if (prov.provider_name === 'custom_webhook' && cfg.webhookUrl) {
        const resp = await axios.post(cfg.webhookUrl, {
          recipient: phone,
          text: `*${subject}*\n\n${content}`
        }, { timeout: 8000, headers: cfg.headers || {} });

        if (resp.status >= 200 && resp.status < 300) {
          await this.logDelivery(tenantId, ruleId, jobId, 'whatsapp', phone, subject, content, 'accepted', { status: resp.status, data: resp.data }, null);
          return { channel: 'whatsapp', status: 'accepted', phone };
        } else {
          throw new Error(`WhatsApp Webhook returned HTTP ${resp.status}`);
        }
      } else {
        const errorMsg = `WhatsApp provider ${prov.provider_name} credentials incomplete.`;
        await this.logDelivery(tenantId, ruleId, jobId, 'whatsapp', phone, subject, content, 'failed', null, errorMsg);
        return { channel: 'whatsapp', status: 'failed', error: errorMsg };
      }
    } catch (err) {
      await this.logDelivery(tenantId, ruleId, jobId, 'whatsapp', phone, subject, content, 'failed', null, err.message);
      return { channel: 'whatsapp', status: 'failed', error: err.message };
    }
  }

  // ==========================================================================
  // 5. BACKGROUND JOB PROCESSOR (WITH REVALIDATION & EXPONENTIAL BACKOFF)
  // ==========================================================================
  async processScheduledJobs(client = null) {
    try {
      const now = new Date();
      // Select pending or retrying jobs due for execution
      const jobsRes = await (client || db).query(`
        SELECT j.*, r.rule_name, r.channels, r.message_template_title,
               r.message_template_body, r.quiet_hours_enabled, r.quiet_hours_start,
               r.quiet_hours_end, r.timezone, r.recipient_type, r.recipient_roles,
               r.recipient_user_ids, r.recipient_emails, r.recipient_phones,
               r.module, r.event_trigger
        FROM notification_scheduled_jobs j
        JOIN notification_rules r ON j.rule_id = r.id
        WHERE j.status IN ('pending', 'retrying')
          AND j.scheduled_for <= $1
          AND r.is_active = TRUE
          AND r.is_archived = FALSE
        ORDER BY j.scheduled_for ASC
        LIMIT 25
      `, [now]);

      const jobs = jobsRes.rows || [];
      if (jobs.length === 0) return { processed: 0 };

      let completedCount = 0;
      let cancelledCount = 0;

      for (const job of jobs) {
        // Mark job processing
        await (client || db).query(`UPDATE notification_scheduled_jobs SET status = 'processing', last_attempt_at = NOW() WHERE id = $1`, [job.id]);

        // CRITICAL: Revalidate deadline & record status before dispatch
        if (job.entity_type === 'opportunity') {
          const oppCheck = await (client || db).query(`
            SELECT id, status, selection_status, closing_date, submission_deadline,
                   title, tender_name, opportunity_number
            FROM opportunities
            WHERE id = $1 AND tenant_id = $2
          `, [job.entity_id, job.tenant_id]);

          if (oppCheck.rows.length === 0) {
            await (client || db).query(`UPDATE notification_scheduled_jobs SET status = 'cancelled', last_error = 'Tender record no longer exists' WHERE id = $1`, [job.id]);
            cancelledCount++;
            continue;
          }

          const opp = oppCheck.rows[0];
          const terminalStatuses = ['Won', 'Lost', 'Awarded', 'Cancelled', 'Disqualified', 'Rejected', 'Closed'];
          if (terminalStatuses.some(s => s.toLowerCase() === (opp.status || '').toLowerCase() || s.toLowerCase() === (opp.selection_status || '').toLowerCase())) {
            await (client || db).query(`UPDATE notification_scheduled_jobs SET status = 'cancelled', last_error = 'Tender already concluded/cancelled' WHERE id = $1`, [job.id]);
            cancelledCount++;
            continue;
          }

          // Check if deadline was changed
          const formatLocalDate = (d) => {
            if (!d) return '';
            if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
            const dt = new Date(d);
            return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
          };

          const activeDeadline = new Date(opp.submission_deadline || opp.closing_date);
          const targetDeadline = new Date(job.target_deadline);
          const activeDateStr = formatLocalDate(opp.submission_deadline || opp.closing_date);
          const targetDateStr = formatLocalDate(job.target_deadline);

          const isDeadlineChanged = activeDateStr && targetDateStr && activeDateStr !== targetDateStr;

          if (isDeadlineChanged) {
            if (activeDeadline < new Date()) {
              await (client || db).query(`UPDATE notification_scheduled_jobs SET status = 'cancelled', last_error = 'Tender deadline changed and already expired' WHERE id = $1`, [job.id]);
              cancelledCount++;
              continue;
            } else {
              // Reschedule job according to new deadline
              const leadHours = parseInt(job.lead_time_hours || 24, 10);
              const newScheduled = new Date(activeDeadline.getTime() - leadHours * 3600 * 1000);
              await (client || db).query(`
                UPDATE notification_scheduled_jobs
                SET status = 'pending', scheduled_for = $1, target_deadline = $2, last_error = 'Rescheduled due to deadline update'
                WHERE id = $3
              `, [newScheduled, activeDeadline, job.id]);
              continue;
            }
          }
        }

        // Execute dispatch
        try {
          const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : (job.payload || {});
          await this.dispatchRuleImmediate(job.tenant_id, job, job.entity_type, job.entity_id, payload, job.id);

          await (client || db).query(`
            UPDATE notification_scheduled_jobs
            SET status = 'completed', updated_at = NOW(), last_error = NULL
            WHERE id = $1
          `, [job.id]);
          completedCount++;
        } catch (dispatchErr) {
          console.error(`[NotificationService] Error executing job ${job.id}:`, dispatchErr.message);
          const retryCount = (job.retry_count || 0) + 1;
          const maxRetries = job.max_retries || 3;

          if (retryCount >= maxRetries) {
            await (client || db).query(`
              UPDATE notification_scheduled_jobs
              SET status = 'dead_letter', retry_count = $1, last_error = $2, updated_at = NOW()
              WHERE id = $3
            `, [retryCount, dispatchErr.message, job.id]);
          } else {
            // Exponential backoff: 2^retry * 60 seconds
            const backoffSeconds = Math.pow(2, retryCount) * 60;
            const nextAttempt = new Date(Date.now() + backoffSeconds * 1000);
            await (client || db).query(`
              UPDATE notification_scheduled_jobs
              SET status = 'retrying', retry_count = $1, scheduled_for = $2, last_error = $3, updated_at = NOW()
              WHERE id = $4
            `, [retryCount, nextAttempt, dispatchErr.message, job.id]);
          }
        }
      }

      return { processed: jobs.length, completed: completedCount, cancelled: cancelledCount };
    } catch (err) {
      console.error('[NotificationService] processScheduledJobs exception:', err.message);
      return { error: err.message };
    }
  }

  // ==========================================================================
  // 6. HELPER METHODS (RECIPIENTS, TEMPLATES, QUIET HOURS, LOGGING)
  // ==========================================================================
  async resolveRecipients(tenantId, rule, data, client = null) {
    const recipients = {
      users: [],
      emails: [],
      phones: []
    };

    if (rule.recipient_emails && Array.isArray(rule.recipient_emails)) {
      recipients.emails.push(...rule.recipient_emails.filter(Boolean));
    }
    if (rule.recipient_phones && Array.isArray(rule.recipient_phones)) {
      recipients.phones.push(...rule.recipient_phones.filter(Boolean));
    }

    if (rule.recipient_type === 'specific_users' && Array.isArray(rule.recipient_user_ids)) {
      const uRes = await (client || db).query(`
        SELECT id, full_name, email, phone FROM users
        WHERE id = ANY($1::uuid[]) AND tenant_id = $2 AND status = 'Active'
      `, [rule.recipient_user_ids, tenantId]);
      recipients.users.push(...uRes.rows);
      uRes.rows.forEach(u => {
        if (u.email) recipients.emails.push(u.email);
        if (u.phone) recipients.phones.push(u.phone);
      });
    } else if (rule.recipient_type === 'role' && Array.isArray(rule.recipient_roles)) {
      const rRes = await (client || db).query(`
        SELECT id, full_name, email, phone FROM users
        WHERE role = ANY($1::varchar[]) AND tenant_id = $2 AND status = 'Active'
      `, [rule.recipient_roles, tenantId]);
      recipients.users.push(...rRes.rows);
      rRes.rows.forEach(u => {
        if (u.email) recipients.emails.push(u.email);
        if (u.phone) recipients.phones.push(u.phone);
      });
    } else {
      // Default: assigned user or tenant admins
      if (data.assigned_to) {
        const uRes = await (client || db).query(`SELECT id, full_name, email, phone FROM users WHERE id = $1 AND tenant_id = $2`, [data.assigned_to, tenantId]);
        if (uRes.rows.length > 0) {
          recipients.users.push(uRes.rows[0]);
          if (uRes.rows[0].email) recipients.emails.push(uRes.rows[0].email);
          if (uRes.rows[0].phone) recipients.phones.push(uRes.rows[0].phone);
        }
      }
      if (recipients.users.length === 0) {
        const adminRes = await (client || db).query(`
          SELECT id, full_name, email, phone FROM users
          WHERE (role IN ('ClientAdmin', 'SuperAdmin') OR is_primary_admin = TRUE)
            AND tenant_id = $1 AND status = 'Active'
        `, [tenantId]);
        recipients.users.push(...adminRes.rows);
        adminRes.rows.forEach(u => {
          if (u.email) recipients.emails.push(u.email);
          if (u.phone) recipients.phones.push(u.phone);
        });
      }
    }

    // Deduplicate
    recipients.emails = [...new Set(recipients.emails)];
    recipients.phones = [...new Set(recipients.phones)];
    const uniqueUserMap = new Map();
    recipients.users.forEach(u => uniqueUserMap.set(String(u.id), u));
    recipients.users = Array.from(uniqueUserMap.values());

    return recipients;
  }

  interpolateTemplate(template, data = {}) {
    if (!template) return '';
    return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
      if (data[key] !== undefined && data[key] !== null) {
        return String(data[key]);
      }
      return match;
    });
  }

  getDefaultTitle(trigger) {
    switch (trigger) {
      case 'tender_created': return '📑 New Tender Registered: {{tender_number}}';
      case 'tender_status_changed': return '🔄 Tender Status Updated: {{tender_number}} is now {{status}}';
      case 'deadline_approaching': return '⏰ Approaching Tender Deadline: {{tender_number}}';
      case 'submission_due': return '🚨 Submission Due Today: {{tender_number}}';
      case 'tender_awarded': return '🏆 Tender Won & Awarded: {{tender_number}}';
      case 'tender_lost': return '📉 Tender Concluded (Lost): {{tender_number}}';
      case 'radar_scrape_matched': return '📡 PPRA Radar Match: {{tender_number}}';
      default: return 'Notification Alert: {{tender_number}}';
    }
  }

  getDefaultBody(trigger) {
    switch (trigger) {
      case 'tender_created':
        return 'A new tender opportunity "{{title}}" has been registered for {{organization}}.\nClosing Date: {{closing_date}}';
      case 'tender_status_changed':
        return 'Tender "{{title}}" ({{tender_number}}) has changed status to {{status}}. Please review workflow requirements.';
      case 'deadline_approaching':
        return 'Warning: Submission deadline for "{{title}}" is approaching on {{submission_deadline}}. Ensure BoQ costing, quotations, and CDR instruments are ready.';
      case 'submission_due':
        return 'Urgent: Tender "{{title}}" is due for formal submission today ({{submission_deadline}}).';
      case 'tender_awarded':
        return 'Congratulations! Tender "{{title}}" ({{tender_number}}) has been awarded. Proceed to contract execution and PO generation.';
      case 'tender_lost':
        return 'Tender "{{title}}" has concluded as lost. Review competitor intelligence and evaluation grounds.';
      default:
        return 'Tender notification update regarding {{tender_number}}: {{title}}';
    }
  }

  isInQuietHours(rule) {
    if (!rule.quiet_hours_enabled) return false;
    const tz = rule.timezone || 'Asia/Karachi';
    const nowStr = new Date().toLocaleTimeString('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit' });
    const start = rule.quiet_hours_start || '22:00';
    const end = rule.quiet_hours_end || '08:00';

    if (start <= end) {
      return nowStr >= start && nowStr < end;
    } else {
      // Overnight (e.g. 22:00 to 08:00)
      return nowStr >= start || nowStr < end;
    }
  }

  async logDelivery(tenantId, ruleId, jobId, channel, recipient, subject, content, status, providerResponse = null, errorMessage = null, client = null) {
    try {
      await (client || db).query(`
        INSERT INTO notification_delivery_logs (
          tenant_id, rule_id, job_id, channel, recipient,
          subject, content, status, provider_response, error_message
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        tenantId, ruleId, jobId, channel, recipient || 'Unknown',
        subject || '', content || '', status,
        providerResponse ? JSON.stringify(providerResponse) : null,
        errorMessage || null
      ]);
    } catch (err) {
      console.error('[NotificationService] Failed to write delivery log:', err.message);
    }
  }

  // ==========================================================================
  // 7. TEST-SEND CAPABILITY WITH RATE LIMITING
  // ==========================================================================
  async testSend({ tenantId, userId, channel, recipient, subject, content, client = null }) {
    // Rate limit: max 5 sends per minute per user
    const now = Date.now();
    const userLimitKey = `${tenantId}_${userId}`;
    const timestamps = (this._testSendRateLimits.get(userLimitKey) || []).filter(t => now - t < 60000);

    if (timestamps.length >= 5) {
      return { success: false, message: 'Test send rate limit exceeded. Please wait 1 minute before testing again.' };
    }
    timestamps.push(now);
    this._testSendRateLimits.set(userLimitKey, timestamps);

    const testSubject = `[TEST] ${subject || 'Mashrue Notification Test'}`;
    const testContent = `[Test Notification Mode]\n\n${content || 'This is a test notification from Mashrue.'}`;

    if (channel === 'in_app') {
      const res = await this.dispatchInApp(tenantId, null, userId, 'tenders', 'test_event', 'test', 'test-0', testSubject, testContent, '/', client);
      return { success: res.status === 'delivered', message: 'Test in-app notification delivered to inbox', details: res };
    } else if (channel === 'email') {
      const res = await this.dispatchEmail(tenantId, null, null, recipient, testSubject, testContent, client);
      return { success: res.status === 'delivered', message: res.status === 'delivered' ? `Test email delivered to ${recipient}` : res.error, details: res };
    } else if (channel === 'sms') {
      const res = await this.dispatchSms(tenantId, null, null, recipient, testSubject, testContent, client);
      return { success: res.status === 'accepted', message: res.status === 'accepted' ? `Test SMS dispatched to ${recipient}` : res.error, details: res };
    } else if (channel === 'whatsapp') {
      const res = await this.dispatchWhatsApp(tenantId, null, null, recipient, testSubject, testContent, client);
      return { success: res.status === 'accepted', message: res.status === 'accepted' ? `Test WhatsApp dispatched to ${recipient}` : res.error, details: res };
    }

    return { success: false, message: 'Unsupported channel' };
  }

  // ==========================================================================
  // 8. BACKGROUND DAEMON SCHEDULER INITIALIZATION
  // ==========================================================================
  startBackgroundScheduler(intervalMs = 30000) {
    if (this._schedulerInterval) clearInterval(this._schedulerInterval);
    console.log(`⏱️ [NotificationService] Background Deadline Scheduler started (Interval: ${intervalMs / 1000}s)`);

    // Run first check after 3 seconds
    setTimeout(() => {
      this.processScheduledJobs().catch(e => console.error('[NotificationService] Scheduler error:', e.message));
    }, 3000);

    this._schedulerInterval = setInterval(() => {
      this.processScheduledJobs().catch(e => console.error('[NotificationService] Scheduler error:', e.message));
    }, intervalMs);
  }

  stopBackgroundScheduler() {
    if (this._schedulerInterval) {
      clearInterval(this._schedulerInterval);
      this._schedulerInterval = null;
    }
  }
}

const notificationServiceInstance = new NotificationService();
module.exports = notificationServiceInstance;
