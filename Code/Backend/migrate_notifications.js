/**
 * Mashrue Notification Module Database Schema Migration
 * Creates tables for Notification Rules, In-App Inbox, Scheduled Background Jobs,
 * Delivery Logs, Provider Configurations, and User Preferences.
 */

const db = require('./config/db');

async function migrateNotifications() {
  console.log('⚡ Running Notifications Module Schema Migration...');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Notification Rules
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        rule_name VARCHAR(255) NOT NULL,
        module VARCHAR(50) NOT NULL DEFAULT 'tenders',
        event_trigger VARCHAR(100) NOT NULL,
        lead_time_hours INTEGER DEFAULT 24,
        recurrence VARCHAR(50) DEFAULT 'once',
        channels TEXT[] DEFAULT ARRAY['in_app'],
        recipient_type VARCHAR(50) DEFAULT 'assigned_user',
        recipient_roles TEXT[] DEFAULT ARRAY['admin'],
        recipient_user_ids UUID[],
        recipient_emails TEXT[],
        recipient_phones TEXT[],
        message_template_title TEXT,
        message_template_body TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        is_archived BOOLEAN DEFAULT FALSE,
        quiet_hours_enabled BOOLEAN DEFAULT FALSE,
        quiet_hours_start VARCHAR(10) DEFAULT '22:00',
        quiet_hours_end VARCHAR(10) DEFAULT '08:00',
        timezone VARCHAR(50) DEFAULT 'Asia/Karachi',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_notif_rules_tid ON notification_rules(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_notif_rules_active ON notification_rules(tenant_id, is_active, is_archived);
      CREATE INDEX IF NOT EXISTS idx_notif_rules_trigger ON notification_rules(tenant_id, event_trigger);
    `);

    // 2. In-App Notification Inbox
    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications_inbox (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        rule_id UUID REFERENCES notification_rules(id) ON DELETE SET NULL,
        module VARCHAR(50) NOT NULL DEFAULT 'tenders',
        event_type VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50) NOT NULL,
        entity_id VARCHAR(100),
        title VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        action_url VARCHAR(255),
        priority VARCHAR(20) DEFAULT 'normal',
        is_read BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_notif_inbox_user ON notifications_inbox(tenant_id, user_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_notif_inbox_created ON notifications_inbox(tenant_id, created_at DESC);
    `);

    // 3. Scheduled Background Jobs
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_scheduled_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        rule_id UUID REFERENCES notification_rules(id) ON DELETE CASCADE,
        entity_type VARCHAR(50) NOT NULL,
        entity_id VARCHAR(100) NOT NULL,
        idempotency_key VARCHAR(255) UNIQUE NOT NULL,
        scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
        target_deadline TIMESTAMP WITH TIME ZONE,
        status VARCHAR(50) DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        last_attempt_at TIMESTAMP WITH TIME ZONE,
        last_error TEXT,
        payload JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_notif_jobs_pending ON notification_scheduled_jobs(status, scheduled_for);
      CREATE INDEX IF NOT EXISTS idx_notif_jobs_entity ON notification_scheduled_jobs(tenant_id, entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS idx_notif_jobs_idem ON notification_scheduled_jobs(idempotency_key);
    `);

    // 4. Delivery Logs
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_delivery_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        rule_id UUID REFERENCES notification_rules(id) ON DELETE SET NULL,
        job_id UUID REFERENCES notification_scheduled_jobs(id) ON DELETE SET NULL,
        channel VARCHAR(50) NOT NULL,
        recipient VARCHAR(255) NOT NULL,
        subject VARCHAR(255),
        content TEXT,
        provider VARCHAR(50) DEFAULT 'internal',
        status VARCHAR(50) NOT NULL,
        provider_response JSONB,
        error_message TEXT,
        retry_count INTEGER DEFAULT 0,
        sent_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_notif_logs_tid ON notification_delivery_logs(tenant_id, sent_at DESC);
      CREATE INDEX IF NOT EXISTS idx_notif_logs_status ON notification_delivery_logs(tenant_id, status);
    `);

    // 5. Tenant Notification Providers
    await client.query(`
      CREATE TABLE IF NOT EXISTS tenant_notification_providers (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        channel VARCHAR(50) NOT NULL,
        provider_name VARCHAR(50) NOT NULL,
        is_enabled BOOLEAN DEFAULT FALSE,
        is_default BOOLEAN DEFAULT TRUE,
        config JSONB NOT NULL DEFAULT '{}'::jsonb,
        rate_limit_per_minute INTEGER DEFAULT 60,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, channel, provider_name)
      );
      CREATE INDEX IF NOT EXISTS idx_notif_providers ON tenant_notification_providers(tenant_id, channel, is_enabled);
    `);

    // 6. User Preferences
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_notification_preferences (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        email_notifications BOOLEAN DEFAULT TRUE,
        sms_notifications BOOLEAN DEFAULT FALSE,
        whatsapp_notifications BOOLEAN DEFAULT FALSE,
        in_app_notifications BOOLEAN DEFAULT TRUE,
        quiet_hours_enabled BOOLEAN DEFAULT FALSE,
        quiet_hours_start VARCHAR(10) DEFAULT '22:00',
        quiet_hours_end VARCHAR(10) DEFAULT '08:00',
        timezone VARCHAR(50) DEFAULT 'Asia/Karachi',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (tenant_id, user_id)
      );
    `);

    await client.query('COMMIT');
    console.log('✓ Notifications Module Schema Migration successfully executed.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Notifications Schema Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrateNotifications().then(() => process.exit(0)).catch(() => process.exit(1));
}

module.exports = { migrateNotifications };

