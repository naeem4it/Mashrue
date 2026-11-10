/**
 * Mashrue Enterprise BMS — Modular ERP Suite Controller (10-Module Architecture)
 * Implements Frontend Views, Modals, Calculators, Cross-Module Workflows & API Client for:
 *  - Module 1 Additions: Tender Document Checklists & Competitor Bid Intelligence
 *  - Module 2: PPRA & EPADS Tender Notification Radar (mod_notifications -> view: 'tender-radar')
 *  - Module 3 Additions: Inter-Warehouse Stock Transfers & Reconciliation Audits (mod_inventory -> view: 'stock-transfers')
 *  - Module 5: Customer Resource Management - CRM Pipeline & Activities (mod_crm -> view: 'crm')
 *  - Module 6: Financial Accounting, COA & Double-Entry General Ledger (mod_finance -> view: 'accounting')
 *  - Module 7: Core HRM, Employee Directory, Attendance & Leaves (mod_hrm -> view: 'hrm')
 *  - Module 8: Payroll, Pakistan FBR Section 149 Slabs, EOBI & Payslips (mod_payroll -> view: 'payroll')
 *  - Module 9: Manufacturing ERP - Bill of Materials (BOM) & Work Orders (mod_manufacturing -> view: 'manufacturing')
 *  - Module 10: Mashrue TaxGuard - FBR, PRA/SRB, WHT CPR Ledger & Annex-C Return Generator (mod_tax_compliance -> view: 'tax-compliance')
 */

const ModularERP = {
  // ==========================================================================
  // 0. UNIVERSAL API & HYBRID LOCAL FALLBACK CLIENT
  // ==========================================================================
  async request(endpoint, method = 'GET', body = null, fallbackKey = null) {
    try {
      const opts = {
        method,
        headers: typeof API !== 'undefined' && API.getHeaders ? API.getHeaders() : { 'Content-Type': 'application/json' }
      };
      if (body && (method === 'POST' || method === 'PUT')) {
        opts.body = JSON.stringify(body);
      }
      const base = typeof API_BASE !== 'undefined' ? API_BASE : '/api';
      const res = await fetch(`${base}/erp${endpoint}`, opts);
      const json = await res.json();
      if (json && json.success) {
        if (fallbackKey && method === 'GET' && Array.isArray(json.data) && typeof State !== 'undefined') {
          json.data.forEach(item => {
            if (item && item.id) State.saveTenantEntity(fallbackKey, item);
          });
        }
        return json;
      }
      throw new Error(json?.message || 'API request failed');
    } catch (err) {
      console.warn(`[ModularERP Hybrid Fallback] ${method} ${endpoint}:`, err.message);
      if (fallbackKey && typeof State !== 'undefined') {
        if (method === 'GET') {
          return { success: true, data: State.getTenantEntityList(fallbackKey) || [] };
        }
        if (method === 'POST' && body) {
          const newItem = {
            id: body.id || ('erp-' + Date.now() + '-' + Math.floor(Math.random() * 1000)),
            tenant_id: State.currentUser?.tenant?.id || State.currentUser?.tenant_id || 't1',
            created_at: new Date().toISOString(),
            ...body
          };
          State.saveTenantEntity(fallbackKey, newItem);
          return { success: true, data: newItem, message: 'Saved locally.' };
        }
      }
      return { success: false, message: err.message, data: [] };
    }
  },

  calculatePakSalaryTaxLocal(monthlyGross) {
    const gross = Math.max(0, parseFloat(monthlyGross || 0));
    const annualTaxable = gross * 12;
    let annualTax = 0;
    let slabLabel = '0% (Up to PKR 600,000/yr)';

    if (annualTaxable <= 600000) {
      annualTax = 0;
      slabLabel = 'Slab 1: 0% Exempt (Up to PKR 600k/yr)';
    } else if (annualTaxable <= 1200000) {
      annualTax = (annualTaxable - 600000) * 0.05;
      slabLabel = 'Slab 2: 5% of amount exceeding PKR 600k';
    } else if (annualTaxable <= 2200000) {
      annualTax = 30000 + (annualTaxable - 1200000) * 0.15;
      slabLabel = 'Slab 3: PKR 30k + 15% exceeding PKR 1.2M';
    } else if (annualTaxable <= 3200000) {
      annualTax = 180000 + (annualTaxable - 2200000) * 0.25;
      slabLabel = 'Slab 4: PKR 180k + 25% exceeding PKR 2.2M';
    } else if (annualTaxable <= 4100000) {
      annualTax = 430000 + (annualTaxable - 3200000) * 0.30;
      slabLabel = 'Slab 5: PKR 430k + 30% exceeding PKR 3.2M';
    } else {
      annualTax = 700000 + (annualTaxable - 4100000) * 0.35;
      slabLabel = 'Slab 6: PKR 700k + 35% exceeding PKR 4.1M';
    }

    const monthlyTax = Math.round(annualTax / 12);
    const eobiEmp = gross > 0 ? 370 : 0;
    const netSalary = Math.max(0, gross - monthlyTax - eobiEmp);

    return {
      monthly_gross: gross,
      annual_taxable: annualTaxable,
      annual_tax: Math.round(annualTax),
      monthly_tax: monthlyTax,
      eobi_emp: eobiEmp,
      net_salary: netSalary,
      slab_label: slabLabel
    };
  },

  // ==========================================================================
  // 1. MODULE 2: TENDER NOTIFICATION & ALERT MANAGEMENT ('tender-radar')
  // ==========================================================================
  _notifActiveTab: 'inbox',
  _notifInboxFilter: { is_read: 'all', priority: 'all' },
  _notifRulesFilter: { event_trigger: 'all', is_active: 'all' },
  _notifLogsFilter: { status: 'all', channel: 'all' },
  _cachedNotifInbox: [],
  _cachedNotifRules: [],
  _cachedNotifJobs: [],
  _cachedNotifLogs: [],
  _cachedNotifProviders: [],
  _cachedScrapes: [],

  switchNotifTab(tab) {
    this._notifActiveTab = tab;
    const viewMap = {
      'inbox': 'tender-radar',
      'scrapes': 'radar-feed',
      'rules': 'radar-rules',
      'jobs': 'radar-jobs',
      'logs': 'radar-logs',
      'providers': 'radar-providers'
    };
    const nextView = viewMap[tab] || 'tender-radar';
    if (typeof switchView === 'function' && typeof State !== 'undefined' && State.activeView !== nextView) {
      switchView(nextView);
    } else if (typeof renderActiveView === 'function') {
      renderActiveView();
    }
  },

  async pollUnreadNotificationBadge() {
    try {
      if (typeof API !== 'undefined' && API.getUnreadNotificationCount) {
        const res = await API.getUnreadNotificationCount();
        const badge = document.getElementById('header-notif-badge');
        if (badge && res && res.success) {
          const count = parseInt(res.unread_count || 0, 10);
          if (count > 0) {
            badge.innerText = count > 99 ? '99+' : count;
            badge.style.display = 'inline-block';
          } else {
            badge.style.display = 'none';
          }
        }
      }
    } catch (e) {}
  },

  async toggleNotificationFlyout(e) {
    if (e) e.stopPropagation();
    const flyout = document.getElementById('header-notif-flyout');
    if (!flyout) return;

    if (flyout.style.display === 'block') {
      flyout.style.display = 'none';
      return;
    }

    flyout.style.display = 'block';
    const listEl = document.getElementById('header-notif-list');
    if (listEl) listEl.innerHTML = '<div style="padding:20px; text-align:center; color:#64748b; font-size:0.8rem;">Loading notifications...</div>';

    try {
      const res = await (typeof API !== 'undefined' && API.getNotificationInbox ? API.getNotificationInbox({ limit: 10 }) : this.request('/notifications/inbox?limit=10'));
      const items = res?.data || [];
      if (items.length === 0) {
        if (listEl) listEl.innerHTML = '<div style="padding:24px; text-align:center; color:#94a3b8; font-size:0.8rem;">✓ All caught up! No notifications.</div>';
      } else {
        if (listEl) {
          listEl.innerHTML = items.map(n => `
            <div style="padding:10px 14px; border-bottom:1px solid #f1f5f9; background:${n.is_read ? '#ffffff' : '#f8fafc'}; display:flex; gap:10px; align-items:flex-start;">
              <span style="font-size:1.1rem; line-height:1;">${n.priority === 'urgent' ? '🚨' : (n.priority === 'high' ? '⏰' : '🔔')}</span>
              <div style="flex:1;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                  <span style="font-weight:${n.is_read ? '600' : '800'}; font-size:0.82rem; color:#0f172a;">${escapeHtml(n.title)}</span>
                  <span style="font-size:0.68rem; color:#94a3b8;">${formatDateDDMMYYYY(n.created_at)}</span>
                </div>
                <div style="font-size:0.75rem; color:#475569; margin:2px 0 4px; line-height:1.3;">${escapeHtml(n.message)}</div>
                <div style="display:flex; gap:8px; align-items:center;">
                  ${n.action_url ? `<a href="javascript:void(0)" onclick="ModularERP.closeNotificationFlyout(); switchView('opportunities');" style="font-size:0.72rem; color:#0284c7; font-weight:700; text-decoration:none;">View Tender ➔</a>` : ''}
                  ${!n.is_read ? `<button type="button" style="background:none; border:none; color:#64748b; font-size:0.7rem; cursor:pointer; padding:0;" onclick="ModularERP.markNotificationRead('${n.id}')">Mark read</button>` : ''}
                </div>
              </div>
            </div>
          `).join('');
        }
      }
    } catch (err) {
      if (listEl) listEl.innerHTML = '<div style="padding:18px; text-align:center; color:#ef4444; font-size:0.78rem;">Failed to load notifications</div>';
    }
  },

  closeNotificationFlyout() {
    const flyout = document.getElementById('header-notif-flyout');
    if (flyout) flyout.style.display = 'none';
  },

  async markNotificationRead(id) {
    if (typeof API !== 'undefined' && API.markNotificationRead) {
      await API.markNotificationRead(id);
    } else {
      await this.request('/notifications/inbox/' + id + '/read', 'PUT');
    }
    this.pollUnreadNotificationBadge();
    if (this._notifActiveTab === 'inbox') {
      renderActiveView();
    }
  },

  async markAllNotificationsRead() {
    if (typeof API !== 'undefined' && API.markAllNotificationsRead) {
      await API.markAllNotificationsRead();
    } else {
      await this.request('/notifications/inbox/read-all', 'PUT');
    }
    this.pollUnreadNotificationBadge();
    showToast('✓ All notifications marked as read', 'success');
    this.closeNotificationFlyout();
    if (this._notifActiveTab === 'inbox') {
      renderActiveView();
    }
  },

  async renderTenderRadarHTML() {
    // Parallel fetch from notification engine & radar endpoints
    const [inboxRes, rulesRes, jobsRes, logsRes, provRes, scrapesRes] = await Promise.all([
      typeof API !== 'undefined' && API.getNotificationInbox ? API.getNotificationInbox().catch(() => ({ success: true, data: [] })) : this.request('/notifications/inbox', 'GET', null, 'erp_notif_inbox'),
      typeof API !== 'undefined' && API.getNotificationRules ? API.getNotificationRules().catch(() => ({ success: true, data: [] })) : this.request('/notifications/rules', 'GET', null, 'erp_notif_rules'),
      typeof API !== 'undefined' && API.getNotificationJobs ? API.getNotificationJobs().catch(() => ({ success: true, data: [] })) : this.request('/notifications/jobs', 'GET', null, 'erp_notif_jobs'),
      typeof API !== 'undefined' && API.getNotificationLogs ? API.getNotificationLogs().catch(() => ({ success: true, data: [] })) : this.request('/notifications/logs', 'GET', null, 'erp_notif_logs'),
      typeof API !== 'undefined' && API.getNotificationProviders ? API.getNotificationProviders().catch(() => ({ success: true, data: [] })) : this.request('/notifications/providers', 'GET', null, 'erp_notif_providers'),
      this.request('/tender-radar/scrapes', 'GET', null, 'erp_tender_scrapes')
    ]);

    const inbox = inboxRes?.data || [];
    const rules = rulesRes?.data || [];
    const jobs = jobsRes?.data || [];
    const logs = logsRes?.data || [];
    const providers = provRes?.data || [];
    const scrapes = scrapesRes?.data || [];

    this._cachedNotifInbox = inbox;
    this._cachedNotifRules = rules;
    this._cachedNotifJobs = jobs;
    this._cachedNotifLogs = logs;
    this._cachedNotifProviders = providers;
    this._cachedScrapes = scrapes;

    const unreadCount = inbox.filter(n => !n.is_read).length;
    const activeRulesCount = rules.filter(r => r.is_active && !r.is_archived).length;
    const pendingJobsCount = jobs.filter(j => j.status === 'pending').length;
    const failedLogsCount = logs.filter(l => l.status === 'failed').length;

    // Trigger header badge sync
    setTimeout(() => this.pollUnreadNotificationBadge(), 100);

    const currentTab = this._notifActiveTab || 'inbox';

    return `
      <!-- Top Metrics Strip -->
      <div class="kpi-grid" style="margin-bottom: 16px;">
        <div class="kpi-card" style="cursor:pointer;" onclick="ModularERP.switchNotifTab('inbox')">
          <div class="kpi-label">📬 Unread Tender Alerts</div>
          <div class="kpi-value" style="color:#0284c7;">${unreadCount} Alerts</div>
          <div class="kpi-trend ${unreadCount > 0 ? 'negative' : 'positive'}">${unreadCount > 0 ? unreadCount + ' require attention' : '✓ All caught up'}</div>
        </div>
        <div class="kpi-card" style="cursor:pointer;" onclick="ModularERP.switchNotifTab('rules')">
          <div class="kpi-label">⚙️ Active Notification Rules</div>
          <div class="kpi-value" style="color:#059669;">${activeRulesCount} Rules</div>
          <div class="kpi-trend positive">Covering Creation, Deadlines & Awards</div>
        </div>
        <div class="kpi-card" style="cursor:pointer;" onclick="ModularERP.switchNotifTab('jobs')">
          <div class="kpi-label">⏱️ Pending Scheduled Jobs</div>
          <div class="kpi-value" style="color:#7c3aed;">${pendingJobsCount} Jobs</div>
          <div class="kpi-trend">Tender deadline countdown telemetry</div>
        </div>
        <div class="kpi-card" style="cursor:pointer;" onclick="ModularERP.switchNotifTab('logs')">
          <div class="kpi-label">📜 Dispatches & Logs</div>
          <div class="kpi-value" style="color:#0f172a;">${logs.length} Sent</div>
          <div class="kpi-trend ${failedLogsCount > 0 ? 'negative' : 'positive'}">${failedLogsCount > 0 ? failedLogsCount + ' failed dispatches' : '✓ 100% Delivery Success'}</div>
        </div>
        <div class="kpi-card" style="cursor:pointer;" onclick="ModularERP.switchNotifTab('scrapes')">
          <div class="kpi-label">📡 PPRA / EPADS Feed</div>
          <div class="kpi-value" style="color:#d97706;">${scrapes.length} Notices</div>
          <div class="kpi-trend">Live Pakistan Procurement Scraper</div>
        </div>
      </div>

      <!-- Active Screen Content (Navigated via Sidebar) -->
      ${this.renderNotifTabContent(currentTab, { inbox, rules, jobs, logs, providers, scrapes })}
    `;
  },

  renderNotifTabContent(tab, data) {
    const { inbox, rules, jobs, logs, providers, scrapes } = data;

    // 1. INBOX & ALERTS TAB
    if (tab === 'inbox') {
      return `
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800;">📬 Notification Inbox & Real-Time Alerts</h3>
              <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Direct alerts for tender intakes, approaching submission dates, and contract awards</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="secondary-btn" onclick="ModularERP.markAllNotificationsRead()">✓ Mark All as Read</button>
              <button class="primary-btn" onclick="ModularERP.openTestSendModal()">✉️ Test Send</button>
            </div>
          </div>
          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Priority & Event</th>
                    <th>Alert Title</th>
                    <th>Message Details</th>
                    <th>Timestamp</th>
                    <th>Status</th>
                    <th style="text-align:center;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${inbox.length === 0 ? `
                    <tr><td colspan="6" style="text-align:center; padding:28px; color:#64748b;">✓ Your notification inbox is clear. No active alerts.</td></tr>
                  ` : inbox.map(n => `
                    <tr style="background:${n.is_read ? '#ffffff' : '#f8fafc'};">
                      <td>
                        <span class="badge" style="background:${n.priority === 'urgent' ? '#fee2e2' : (n.priority === 'high' ? '#fef3c7' : '#e0f2fe')}; color:${n.priority === 'urgent' ? '#dc2626' : (n.priority === 'high' ? '#d97706' : '#0369a1')}; font-weight:700;">
                          ${n.priority === 'urgent' ? '🚨 URGENT' : (n.priority === 'high' ? '⏰ HIGH' : 'NORMAL')}
                        </span>
                        <div style="font-size:0.72rem; color:#64748b; margin-top:2px;">${escapeHtml(n.event_type || 'tender_event')}</div>
                      </td>
                      <td>
                        <div style="font-weight:${n.is_read ? '600' : '800'}; color:#0f172a; font-size:0.88rem;">${escapeHtml(n.title)}</div>
                      </td>
                      <td>
                        <div style="font-size:0.8rem; color:#334155; line-height:1.4;">${escapeHtml(n.message)}</div>
                      </td>
                      <td>
                        <div style="font-size:0.78rem; color:#64748b;">${formatDateDDMMYYYY(n.created_at)}</div>
                      </td>
                      <td>
                        ${n.is_read ? '<span class="badge" style="background:#f1f5f9; color:#475569;">Read</span>' : '<span class="badge" style="background:#dcfce7; color:#166534; font-weight:700;">Unread</span>'}
                      </td>
                      <td style="text-align:center;">
                        <div style="display:flex; gap:6px; justify-content:center;">
                          ${n.action_url ? `
                            <button class="primary-btn" style="padding:3px 8px; font-size:0.72rem;" onclick="switchView('opportunities')">
                              Open Tender ➔
                            </button>
                          ` : ''}
                          ${!n.is_read ? `
                            <button class="secondary-btn" style="padding:3px 6px; font-size:0.72rem;" onclick="ModularERP.markNotificationRead('${n.id}')">
                              ✓ Read
                            </button>
                          ` : ''}
                          <button class="delete-btn" style="padding:3px 6px; font-size:0.72rem; color:#ef4444;" onclick="ModularERP.deleteNotificationItem('${n.id}')" title="Delete">🗑️</button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    // 2. NOTIFICATION RULES ENGINE TAB
    if (tab === 'rules') {
      return `
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800;">⚙️ Notification Rules Engine</h3>
              <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Configure triggers, lead times, recipient distribution lists, quiet hours and delivery channels</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="secondary-btn" onclick="ModularERP.openTestSendModal()">✉️ Test Send</button>
              <button class="primary-btn" onclick="ModularERP.openNotificationRuleModal()">+ New Notification Rule</button>
            </div>
          </div>
          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Rule Name</th>
                    <th>Trigger Event</th>
                    <th>Lead Time & Recurrence</th>
                    <th>Channels</th>
                    <th>Recipient Target</th>
                    <th>Status</th>
                    <th style="text-align:center;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${rules.length === 0 ? `
                    <tr><td colspan="7" style="text-align:center; padding:28px; color:#64748b;">No notification rules configured. Click <strong>+ New Notification Rule</strong> to automate your tender alerts.</td></tr>
                  ` : rules.map(r => `
                    <tr ${r.is_archived ? 'style="opacity:0.6; background:#f8fafc;"' : ''}>
                      <td>
                        <div style="font-weight:700; color:#0f172a;">${escapeHtml(r.rule_name)}</div>
                        <div style="font-size:0.72rem; color:#64748b;">Module: ${escapeHtml(r.module || 'tenders')}</div>
                      </td>
                      <td>
                        <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">${escapeHtml(r.event_trigger)}</span>
                      </td>
                      <td>
                        <div style="font-size:0.8rem; font-weight:600;">${r.lead_time_hours}h Before</div>
                        <div style="font-size:0.72rem; color:#64748b;">Recurrence: ${escapeHtml(r.recurrence || 'once')}</div>
                      </td>
                      <td>
                        <div style="display:flex; gap:4px; flex-wrap:wrap;">
                          ${(r.channels || ['in_app']).map(ch => `
                            <span class="badge" style="background:#f1f5f9; color:#334155; font-size:0.7rem;">${escapeHtml(ch)}</span>
                          `).join('')}
                        </div>
                      </td>
                      <td>
                        <div style="font-size:0.8rem; font-weight:600;">${escapeHtml(r.recipient_type)}</div>
                      </td>
                      <td>
                        ${r.is_archived ? '<span class="badge" style="background:#e2e8f0; color:#475569;">Archived</span>' :
                          (r.is_active ? '<span class="badge" style="background:#dcfce7; color:#166534; font-weight:700;">Active</span>' :
                          '<span class="badge" style="background:#fee2e2; color:#991b1b;">Disabled</span>')}
                      </td>
                      <td style="text-align:center;">
                        <div style="display:flex; gap:4px; justify-content:center; flex-wrap:wrap;">
                          <button class="edit-btn" style="padding:3px 6px; font-size:0.72rem;" onclick="ModularERP.openNotificationRuleModal('${r.id}')" title="Edit Rule">✏️</button>
                          <button class="secondary-btn" style="padding:3px 6px; font-size:0.72rem;" onclick="ModularERP.duplicateNotificationRule('${r.id}')" title="Duplicate Rule">📋</button>
                          ${r.is_archived ? `
                            <button class="secondary-btn" style="padding:3px 6px; font-size:0.72rem;" onclick="ModularERP.restoreNotificationRule('${r.id}')" title="Restore Rule">♻️</button>
                          ` : `
                            <button class="delete-btn" style="padding:3px 6px; font-size:0.72rem; color:#ef4444;" onclick="ModularERP.archiveNotificationRule('${r.id}')" title="Archive Rule">📁</button>
                          `}
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    // 3. SCHEDULED DEADLINES & JOBS TAB
    if (tab === 'jobs') {
      return `
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800;">⏱️ Scheduled Tender Deadline Telemetry & Background Jobs</h3>
              <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Persistent queue of upcoming deadline notifications, automatically adjusted on deadline update</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="primary-btn" onclick="ModularERP.processJobsNow()">⚡ Process Pending Jobs Now</button>
            </div>
          </div>
          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Job ID & Target Entity</th>
                    <th>Linked Rule</th>
                    <th>Target Deadline</th>
                    <th>Scheduled Execution Time</th>
                    <th>Status</th>
                    <th>Retries</th>
                    <th style="text-align:center;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${jobs.length === 0 ? `
                    <tr><td colspan="7" style="text-align:center; padding:28px; color:#64748b;">No pending scheduled jobs. New tender creation will automatically register deadline monitors.</td></tr>
                  ` : jobs.map(j => `
                    <tr>
                      <td>
                        <div style="font-weight:700; font-family:monospace; color:#0284c7;">${escapeHtml(j.id.slice(0, 8))}...</div>
                        <div style="font-size:0.72rem; color:#64748b;">${escapeHtml(j.entity_type)} (${escapeHtml(j.entity_id.slice(0, 8))}...)</div>
                      </td>
                      <td>
                        <div style="font-weight:600;">${escapeHtml(j.rule_name || 'Tender Deadline Rule')}</div>
                        <div style="font-size:0.72rem; color:#64748b;">Trigger: ${escapeHtml(j.event_trigger || 'deadline_approaching')}</div>
                      </td>
                      <td>
                        <div style="font-weight:700; color:#0f172a;">${j.target_deadline ? formatDateDDMMYYYY(j.target_deadline) : 'N/A'}</div>
                      </td>
                      <td>
                        <div style="font-weight:700; color:#7c3aed;">${j.scheduled_for ? formatDateDDMMYYYY(j.scheduled_for) : 'ASAP'}</div>
                      </td>
                      <td>
                        <span class="badge ${j.status === 'completed' ? 'badge-won' : (j.status === 'pending' ? 'badge-info' : 'badge-hold')}">
                          ${escapeHtml(j.status)}
                        </span>
                        ${j.last_error ? `<div style="font-size:0.7rem; color:#dc2626; max-width:180px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(j.last_error)}</div>` : ''}
                      </td>
                      <td>
                        <span style="font-family:monospace; font-weight:700;">${j.retry_count || 0} / ${j.max_retries || 3}</span>
                      </td>
                      <td style="text-align:center;">
                        ${j.status === 'pending' ? `
                          <button class="delete-btn" style="padding:3px 8px; font-size:0.72rem; color:#ef4444;" onclick="ModularERP.cancelScheduledJob('${j.id}')">Cancel</button>
                        ` : '—'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    // 4. DELIVERY LOGS & RETRIES TAB
    if (tab === 'logs') {
      return `
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800;">📜 Notification Delivery Audit Logs</h3>
              <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Complete audit trail with provider acceptance, quiet hours compliance, and 1-click retry</p>
            </div>
          </div>
          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Channel</th>
                    <th>Recipient</th>
                    <th>Subject / Content</th>
                    <th>Status</th>
                    <th>Provider / Diagnostics</th>
                    <th style="text-align:center;">Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${logs.length === 0 ? `
                    <tr><td colspan="7" style="text-align:center; padding:28px; color:#64748b;">No delivery logs recorded yet.</td></tr>
                  ` : logs.map(l => `
                    <tr>
                      <td>
                        <div style="font-size:0.78rem; color:#64748b;">${formatDateDDMMYYYY(l.sent_at)}</div>
                      </td>
                      <td>
                        <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">${escapeHtml(l.channel)}</span>
                      </td>
                      <td>
                        <div style="font-weight:600; font-size:0.8rem;">${escapeHtml(l.recipient)}</div>
                      </td>
                      <td>
                        <div style="font-weight:700; color:#0f172a; font-size:0.82rem;">${escapeHtml(l.subject)}</div>
                        <div style="font-size:0.72rem; color:#64748b; max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(l.content)}</div>
                      </td>
                      <td>
                        <span class="badge ${l.status === 'delivered' || l.status === 'accepted' ? 'badge-won' : (l.status === 'failed' ? 'badge-hold' : 'badge-info')}">
                          ${escapeHtml(l.status)}
                        </span>
                      </td>
                      <td>
                        <div style="font-size:0.72rem; color:#475569;">Provider: ${escapeHtml(l.provider || 'internal')}</div>
                        ${l.error_message ? `<div style="font-size:0.7rem; color:#dc2626; max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(l.error_message)}">❌ ${escapeHtml(l.error_message)}</div>` : ''}
                      </td>
                      <td style="text-align:center;">
                        ${l.status === 'failed' && l.channel !== 'in_app' ? `
                          <button class="primary-btn" style="padding:2px 8px; font-size:0.72rem;" onclick="ModularERP.retryDeliveryLog('${l.id}')">🔄 Retry</button>
                        ` : '—'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    // 5. PROVIDER SETTINGS & GATEWAY TAB
    if (tab === 'providers') {
      return `
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800;">🔌 Notification Gateway & Provider Settings</h3>
              <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Enterprise credentials for Resend, Custom SMTP, SMS gateways and WhatsApp integrations</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="primary-btn" onclick="ModularERP.openProviderConfigModal()">+ Add / Update Provider</button>
            </div>
          </div>

          <div class="card-body">
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px; margin-bottom:18px;">
              <div style="font-weight:700; color:#0f172a; margin-bottom:4px;">🔒 Server-Side Credential Protection</div>
              <div style="font-size:0.8rem; color:#475569;">
                All API keys, SMTP passwords, and auth tokens are stored encrypted and processed strictly server-side. Sensitive keys are masked in API responses and never logged or exposed in client-side code.
              </div>
            </div>

            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
              <!-- Email Service -->
              <div style="background:white; border:1px solid #e2e8f0; border-top:4px solid #0284c7; border-radius:8px; padding:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                  <span style="font-weight:800; font-size:0.95rem; color:#0f172a;">📧 Email Gateway</span>
                  <span class="badge" style="background:#dcfce7; color:#166534; font-weight:700;">Active</span>
                </div>
                <div style="font-size:0.8rem; color:#475569; margin-bottom:8px;">
                  Platform Resend.com HTTPS REST Engine (Zero port blocking) with Automatic Sandbox Fallback.
                </div>
                <button class="secondary-btn" style="padding:4px 10px; font-size:0.75rem;" onclick="ModularERP.openTestSendModal('email')">Test Email Dispatch</button>
              </div>

              <!-- SMS Gateway -->
              <div style="background:white; border:1px solid #e2e8f0; border-top:4px solid #059669; border-radius:8px; padding:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                  <span style="font-weight:800; font-size:0.95rem; color:#0f172a;">📱 SMS Gateway</span>
                  <span class="badge" style="background:#f1f5f9; color:#475569;">Custom Webhook / Twilio</span>
                </div>
                <div style="font-size:0.8rem; color:#475569; margin-bottom:8px;">
                  Connect local Pakistani SMS API (BrandSMS, Zong, Telenor) or Twilio to dispatch immediate SMS alerts.
                </div>
                <button class="secondary-btn" style="padding:4px 10px; font-size:0.75rem;" onclick="ModularERP.openProviderConfigModal('sms')">Configure SMS Provider</button>
              </div>

              <!-- WhatsApp Gateway -->
              <div style="background:white; border:1px solid #e2e8f0; border-top:4px solid #25d366; border-radius:8px; padding:14px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                  <span style="font-weight:800; font-size:0.95rem; color:#0f172a;">💬 WhatsApp Business</span>
                  <span class="badge" style="background:#f1f5f9; color:#475569;">Meta / Webhook</span>
                </div>
                <div style="font-size:0.8rem; color:#475569; margin-bottom:8px;">
                  Automate tender opening and submission reminders via WhatsApp Cloud API or webhook gateway.
                </div>
                <button class="secondary-btn" style="padding:4px 10px; font-size:0.75rem;" onclick="ModularERP.openProviderConfigModal('whatsapp')">Configure WhatsApp</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 6. PPRA & EPADS FEED TAB (PRESERVED)
    if (tab === 'scrapes') {
      return `
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800;">📡 Live PPRA & EPADS Government Tender Notices</h3>
              <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Daily automated feed across Federal PPRA, Punjab, Sindh, KP & Balochistan portals</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="primary-btn" onclick="ModularERP.openAddScrapedTenderModal()">+ Manually Ingest Notice</button>
            </div>
          </div>
          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table" id="table-tender-radar">
                <thead>
                  <tr>
                    <th>Ref Number & Portal</th>
                    <th>Tender Title & Scope</th>
                    <th>Procuring Agency</th>
                    <th>Location</th>
                    <th>Closing Date</th>
                    <th style="text-align:right;">Estimated Value</th>
                    <th style="text-align:center;">1-Click Pipeline Action</th>
                  </tr>
                </thead>
                <tbody>
                  ${scrapes.length === 0 ? `
                    <tr><td colspan="7" style="text-align:center; padding:24px; color:#64748b;">No scraped tender notices found.</td></tr>
                  ` : scrapes.map(s => `
                    <tr>
                      <td>
                        <div style="font-weight:700; font-family:monospace; color:#0284c7;">${escapeHtml(s.tender_ref_number)}</div>
                        <span class="badge" style="background:#e0f2fe; color:#0369a1; font-size:0.7rem;">${escapeHtml(s.portal_source)}</span>
                      </td>
                      <td>
                        <div style="font-weight:700; color:#0f172a; max-width:320px;">${escapeHtml(s.title)}</div>
                        <div style="font-size:0.74rem; color:#64748b;">Category: ${escapeHtml(s.category || 'General Goods')}</div>
                      </td>
                      <td>
                        <div style="font-weight:600;">${escapeHtml(s.organization_name)}</div>
                      </td>
                      <td>
                        <div>${escapeHtml(s.city || 'Islamabad')}</div>
                        <div style="font-size:0.72rem; color:#64748b;">${escapeHtml(s.province || 'Federal')}</div>
                      </td>
                      <td>
                        <div style="font-weight:700; color:#dc2626;">${formatDateDDMMYYYY(s.closing_date)}</div>
                      </td>
                      <td style="text-align:right; font-family:monospace; font-weight:700;">
                        ${formatCurrency(s.estimated_cost)}
                        <div style="font-size:0.7rem; color:#64748b;">Sec: ${s.bid_security_pct || 2}%</div>
                      </td>
                      <td style="text-align:center;">
                        <button class="primary-btn" style="padding:4px 10px; font-size:0.75rem;" onclick="ModularERP.importScrapeToTenderPipeline('${s.id}')" title="1-Click Import into Active Bidding Pipeline">
                          📥 Import to Bidding
                        </button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    return '';
  },

  // ==========================================================================
  // MODALS & ACTIONS (RULES, TEST-SEND, PROVIDERS)
  // ==========================================================================
  openNotificationRuleModal(ruleId = null) {
    const rules = this._cachedNotifRules || [];
    const r = rules.find(item => String(item.id) === String(ruleId)) || {};

    this.showDynamicModal(ruleId ? '✏️ Edit Notification Rule' : '➕ Create New Notification Rule', `
      <form onsubmit="event.preventDefault(); ModularERP.submitNotificationRuleForm('${ruleId || ''}');">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Rule Name *</label>
            <input type="text" class="form-input" id="notif-rule-name" required value="${escapeHtml(r.rule_name || '')}" placeholder="e.g. 48-Hour Tender Submission Reminder">
          </div>
          <div class="form-group">
            <label class="form-label">Event Trigger *</label>
            <select class="form-select" id="notif-rule-trigger" required>
              <option value="deadline_approaching" ${r.event_trigger === 'deadline_approaching' ? 'selected' : ''}>⏰ Approaching Submission Deadline</option>
              <option value="submission_due" ${r.event_trigger === 'submission_due' ? 'selected' : ''}>🚨 Submission Due Today</option>
              <option value="tender_created" ${r.event_trigger === 'tender_created' ? 'selected' : ''}>📑 New Tender Opportunity Registered</option>
              <option value="tender_status_changed" ${r.event_trigger === 'tender_status_changed' ? 'selected' : ''}>🔄 Tender Status / Workflow Gate Changed</option>
              <option value="tender_awarded" ${r.event_trigger === 'tender_awarded' ? 'selected' : ''}>🏆 Tender Won & Awarded</option>
              <option value="tender_lost" ${r.event_trigger === 'tender_lost' ? 'selected' : ''}>📉 Tender Concluded (Lost)</option>
              <option value="task_assigned" ${r.event_trigger === 'task_assigned' ? 'selected' : ''}>📌 Task or Checklist Assigned</option>
            </select>
          </div>
        </div>

        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Lead Time (Hours before Deadline)</label>
            <input type="number" class="form-input" id="notif-rule-lead" value="${r.lead_time_hours || 24}" min="1">
          </div>
          <div class="form-group">
            <label class="form-label">Recurrence</label>
            <select class="form-select" id="notif-rule-recur">
              <option value="once" ${r.recurrence === 'once' ? 'selected' : ''}>Once</option>
              <option value="daily" ${r.recurrence === 'daily' ? 'selected' : ''}>Daily until deadline</option>
              <option value="every_12h" ${r.recurrence === 'every_12h' ? 'selected' : ''}>Every 12 Hours</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Recipient Target</label>
            <select class="form-select" id="notif-rule-target">
              <option value="assigned_user" ${r.recipient_type === 'assigned_user' ? 'selected' : ''}>Assigned Tender Owner / Manager</option>
              <option value="role" ${r.recipient_type === 'role' ? 'selected' : ''}>Organization Admins</option>
              <option value="distribution_list" ${r.recipient_type === 'distribution_list' ? 'selected' : ''}>Custom Email/Phone List</option>
            </select>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Delivery Channels</label>
          <div style="display:flex; gap:16px; margin-top:4px;">
            <label style="font-size:0.83rem; font-weight:600;"><input type="checkbox" id="notif-ch-inapp" checked> 📬 In-App Inbox</label>
            <label style="font-size:0.83rem; font-weight:600;"><input type="checkbox" id="notif-ch-email" ${(r.channels || []).includes('email') ? 'checked' : ''}> 📧 Email</label>
            <label style="font-size:0.83rem; font-weight:600;"><input type="checkbox" id="notif-ch-sms" ${(r.channels || []).includes('sms') ? 'checked' : ''}> 📱 SMS</label>
            <label style="font-size:0.83rem; font-weight:600;"><input type="checkbox" id="notif-ch-wa" ${(r.channels || []).includes('whatsapp') ? 'checked' : ''}> 💬 WhatsApp</label>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Recipient Emails / Phones (Optional Distribution List)</label>
          <input type="text" class="form-input" id="notif-rule-recipients" value="${escapeHtml((r.recipient_emails || []).join(', '))}" placeholder="e.g. tenders@company.pk, 0300-1234567">
        </div>

        <div class="form-group">
          <label class="form-label">Custom Message Subject Template</label>
          <input type="text" class="form-input" id="notif-rule-title-tpl" value="${escapeHtml(r.message_template_title || '')}" placeholder="e.g. ⏰ Tender {{tender_number}} Due in 48h">
        </div>

        <div class="form-group">
          <label class="form-label">Custom Message Body Template</label>
          <textarea class="form-textarea" id="notif-rule-body-tpl" rows="2" placeholder="e.g. Attention: {{title}} closes on {{submission_deadline}}. Please finalize your quotation.">${escapeHtml(r.message_template_body || '')}</textarea>
          <div style="font-size:0.74rem; color:#64748b; margin-top:4px;">Tokens: <code>{{tender_number}}, {{title}}, {{closing_date}}, {{submission_deadline}}, {{organization}}, {{status}}</code></div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label style="font-size:0.83rem; font-weight:700;"><input type="checkbox" id="notif-rule-quiet" ${r.quiet_hours_enabled ? 'checked' : ''}> Enable Quiet Hours</label>
            <div style="font-size:0.74rem; color:#64748b;">Do not dispatch SMS/WhatsApp between 22:00 and 08:00 (Asia/Karachi)</div>
          </div>
        </div>

        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save Rule</button>
        </div>
      </form>
    `);
  },

  async submitNotificationRuleForm(ruleId) {
    const channels = [];
    if (document.getElementById('notif-ch-inapp')?.checked) channels.push('in_app');
    if (document.getElementById('notif-ch-email')?.checked) channels.push('email');
    if (document.getElementById('notif-ch-sms')?.checked) channels.push('sms');
    if (document.getElementById('notif-ch-wa')?.checked) channels.push('whatsapp');

    const rawRecipients = (document.getElementById('notif-rule-recipients')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const emails = rawRecipients.filter(r => r.includes('@'));
    const phones = rawRecipients.filter(r => !r.includes('@'));

    const payload = {
      rule_name: document.getElementById('notif-rule-name')?.value,
      event_trigger: document.getElementById('notif-rule-trigger')?.value,
      lead_time_hours: parseInt(document.getElementById('notif-rule-lead')?.value || 24, 10),
      recurrence: document.getElementById('notif-rule-recur')?.value,
      recipient_type: document.getElementById('notif-rule-target')?.value,
      channels,
      recipient_emails: emails,
      recipient_phones: phones,
      message_template_title: document.getElementById('notif-rule-title-tpl')?.value,
      message_template_body: document.getElementById('notif-rule-body-tpl')?.value,
      quiet_hours_enabled: !!document.getElementById('notif-rule-quiet')?.checked,
      is_active: true
    };

    let res;
    if (ruleId) {
      res = typeof API !== 'undefined' && API.updateNotificationRule ? await API.updateNotificationRule(ruleId, payload) : await this.request('/notifications/rules/' + ruleId, 'PUT', payload);
    } else {
      res = typeof API !== 'undefined' && API.createNotificationRule ? await API.createNotificationRule(payload) : await this.request('/notifications/rules', 'POST', payload);
    }

    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast(ruleId ? '✓ Notification rule updated!' : '✓ New notification rule created!', 'success');
      this.switchNotifTab('rules');
    } else {
      showToast(res?.message || 'Failed to save rule', 'error');
    }
  },

  async duplicateNotificationRule(id) {
    let res;
    if (typeof API !== 'undefined' && API.duplicateNotificationRule) {
      res = await API.duplicateNotificationRule(id);
    } else {
      res = await this.request('/notifications/rules/' + id + '/duplicate', 'POST');
    }
    if (res && res.success) {
      showToast('✓ Rule duplicated as draft', 'success');
      this.switchNotifTab('rules');
    }
  },

  async archiveNotificationRule(id) {
    if (!confirm('Are you sure you want to archive this notification rule?')) return;
    let res;
    if (typeof API !== 'undefined' && API.archiveNotificationRule) {
      res = await API.archiveNotificationRule(id);
    } else {
      res = await this.request('/notifications/rules/' + id + '/archive', 'PUT');
    }
    if (res && res.success) {
      showToast('✓ Rule archived', 'success');
      this.switchNotifTab('rules');
    }
  },

  async restoreNotificationRule(id) {
    let res;
    if (typeof API !== 'undefined' && API.restoreNotificationRule) {
      res = await API.restoreNotificationRule(id);
    } else {
      res = await this.request('/notifications/rules/' + id + '/restore', 'PUT');
    }
    if (res && res.success) {
      showToast('✓ Rule restored', 'success');
      this.switchNotifTab('rules');
    }
  },

  async deleteNotificationItem(id) {
    if (typeof API !== 'undefined' && API.deleteNotification) {
      await API.deleteNotification(id);
    } else {
      await this.request('/notifications/inbox/' + id, 'DELETE');
    }
    showToast('Notification deleted', 'info');
    this.pollUnreadNotificationBadge();
    this.switchNotifTab('inbox');
  },

  async processJobsNow() {
    showToast('Processing scheduled background jobs...', 'info');
    let res;
    if (typeof API !== 'undefined' && API.processNotificationJobsNow) {
      res = await API.processNotificationJobsNow();
    } else {
      res = await this.request('/notifications/jobs/process-now', 'POST');
    }
    if (res && res.success) {
      showToast(`✓ Processed: ${res.result?.processed || 0} jobs (${res.result?.completed || 0} completed)`, 'success');
      this.switchNotifTab('jobs');
    }
  },

  async cancelScheduledJob(id) {
    if (!confirm('Are you sure you want to cancel this scheduled notification job?')) return;
    let res;
    if (typeof API !== 'undefined' && API.cancelNotificationJob) {
      res = await API.cancelNotificationJob(id);
    } else {
      res = await this.request('/notifications/jobs/' + id + '/cancel', 'POST');
    }
    if (res && res.success) {
      showToast('Job cancelled', 'info');
      this.switchNotifTab('jobs');
    }
  },

  async retryDeliveryLog(id) {
    showToast('Retrying notification dispatch...', 'info');
    let res;
    if (typeof API !== 'undefined' && API.retryNotificationLog) {
      res = await API.retryNotificationLog(id);
    } else {
      res = await this.request('/notifications/logs/' + id + '/retry', 'POST');
    }
    if (res && res.success) {
      showToast('✓ Notification re-dispatched successfully!', 'success');
      this.switchNotifTab('logs');
    } else {
      showToast('Retry failed: ' + (res?.result?.error || res?.message || 'Provider error'), 'error');
    }
  },

  openTestSendModal(channel = 'email') {
    this.showDynamicModal('✉️ Notification Diagnostic Test Send', `
      <form onsubmit="event.preventDefault(); ModularERP.submitTestSend();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Delivery Channel *</label>
            <select class="form-select" id="notif-test-ch" required>
              <option value="in_app">📬 In-App Inbox</option>
              <option value="email" ${channel === 'email' ? 'selected' : ''}>📧 Email</option>
              <option value="sms" ${channel === 'sms' ? 'selected' : ''}>📱 SMS</option>
              <option value="whatsapp" ${channel === 'whatsapp' ? 'selected' : ''}>💬 WhatsApp</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Recipient *</label>
            <input type="text" class="form-input" id="notif-test-recip" required placeholder="Email or Phone (e.g. user@mashrue.com / 0300-1234567)">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Subject</label>
          <input type="text" class="form-input" id="notif-test-subj" value="[Diagnostic Test] Tender Notification Engine">
        </div>
        <div class="form-group">
          <label class="form-label">Content</label>
          <textarea class="form-textarea" id="notif-test-content" rows="3">This is an operational test dispatch from Mashrue Tender Notification Engine.</textarea>
        </div>
        <div class="modal-footer" style="padding-top:10px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">🚀 Dispatch Test Notification</button>
        </div>
      </form>
    `);
  },

  async submitTestSend() {
    const payload = {
      channel: document.getElementById('notif-test-ch')?.value,
      recipient: document.getElementById('notif-test-recip')?.value,
      subject: document.getElementById('notif-test-subj')?.value,
      content: document.getElementById('notif-test-content')?.value
    };

    let res;
    if (typeof API !== 'undefined' && API.testSendNotification) {
      res = await API.testSendNotification(payload);
    } else {
      res = await this.request('/notifications/test-send', 'POST', payload);
    }

    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ ' + res.message, 'success');
      this.switchNotifTab('logs');
    } else {
      showToast(res?.message || 'Test send failed', 'error');
    }
  },

  openProviderConfigModal(channel = 'sms') {
    this.showDynamicModal('🔌 Configure Gateway Provider', `
      <form onsubmit="event.preventDefault(); ModularERP.submitProviderConfig();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Channel *</label>
            <select class="form-select" id="notif-prov-ch" required>
              <option value="sms" ${channel === 'sms' ? 'selected' : ''}>📱 SMS Gateway</option>
              <option value="whatsapp" ${channel === 'whatsapp' ? 'selected' : ''}>💬 WhatsApp Business</option>
              <option value="email">📧 Custom SMTP Email</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Provider Name *</label>
            <select class="form-select" id="notif-prov-name" required>
              <option value="custom_webhook">Custom Webhook / REST Gateway</option>
              <option value="twilio">Twilio Cloud API</option>
              <option value="smtp">Standard SMTP Server</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Gateway Webhook / API URL</label>
          <input type="url" class="form-input" id="notif-prov-url" placeholder="https://api.sms-provider.com/v1/send">
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">API Key / Token (Server-side Encrypted)</label>
            <input type="password" class="form-input" id="notif-prov-key" placeholder="••••••••••••••••">
          </div>
          <div class="form-group">
            <label class="form-label">Sender ID / From Number</label>
            <input type="text" class="form-input" id="notif-prov-from" placeholder="e.g. MASHRUE or +14155552671">
          </div>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save Gateway Credentials</button>
        </div>
      </form>
    `);
  },

  async submitProviderConfig() {
    const payload = {
      channel: document.getElementById('notif-prov-ch')?.value,
      provider_name: document.getElementById('notif-prov-name')?.value,
      is_enabled: true,
      config: {
        webhookUrl: document.getElementById('notif-prov-url')?.value,
        apiKey: document.getElementById('notif-prov-key')?.value,
        senderId: document.getElementById('notif-prov-from')?.value
      }
    };

    let res;
    if (typeof API !== 'undefined' && API.saveNotificationProvider) {
      res = await API.saveNotificationProvider(payload);
    } else {
      res = await this.request('/notifications/providers', 'POST', payload);
    }

    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Provider configuration saved securely!', 'success');
      this.switchNotifTab('providers');
    } else {
      showToast(res?.message || 'Failed to save provider', 'error');
    }
  },

  // PRESERVED SCRAPE IMPORT METHODS
  async importScrapeToTenderPipeline(scrapeId) {
    const res = await this.request(`/tender-radar/import/${scrapeId}`, 'POST', { business_profile_id: State.currentBusinessProfile?.id });
    if (res && res.success) {
      showToast(res.message || 'Scraped Tender imported to your Active Bidding Pipeline!', 'success');
      switchView('opportunities');
    } else {
      showToast(res?.message || 'Import failed.', 'error');
    }
  },

  openAddScrapedTenderModal() {
    this.showDynamicModal('📡 Ingest Public Tender Notice', `
      <form onsubmit="event.preventDefault(); ModularERP.submitScrapedTenderForm();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Tender Reference # *</label>
            <input type="text" class="form-input" id="erp-scr-ref" required placeholder="e.g. PPRA-PUNJAB-2026-9021">
          </div>
          <div class="form-group">
            <label class="form-label">Procurement Portal Source</label>
            <select class="form-select" id="erp-scr-source">
              <option value="Federal PPRA">Federal PPRA</option>
              <option value="Punjab PPRA">Punjab PPRA</option>
              <option value="Sindh PPRA">Sindh PPRA</option>
              <option value="KP PPRA">KP PPRA</option>
              <option value="EPADS">EPADS (Electronic Procurement)</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Tender Title / Scope *</label>
          <input type="text" class="form-input" id="erp-scr-title" required placeholder="e.g. Supply and Installation of 500kVA Transformers">
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Procuring Agency *</label>
            <input type="text" class="form-input" id="erp-scr-org" required placeholder="e.g. WAPDA / IESCO">
          </div>
          <div class="form-group">
            <label class="form-label">City</label>
            <input type="text" class="form-input" id="erp-scr-city" value="Islamabad">
          </div>
          <div class="form-group">
            <label class="form-label">Province</label>
            <select class="form-select" id="erp-scr-prov">
              <option value="Federal">Federal</option>
              <option value="Punjab">Punjab</option>
              <option value="Sindh">Sindh</option>
              <option value="KP">KP</option>
              <option value="Balochistan">Balochistan</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Closing Date *</label>
            <input type="date" class="form-input" id="erp-scr-closing" required value="${new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label class="form-label">Estimated Value (PKR)</label>
            <input type="number" class="form-input" id="erp-scr-val" value="15000000">
          </div>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Ingest Notice</button>
        </div>
      </form>
    `);
  },

  async submitScrapedTenderForm() {
    const payload = {
      tender_ref_number: document.getElementById('erp-scr-ref')?.value,
      portal_source: document.getElementById('erp-scr-source')?.value,
      title: document.getElementById('erp-scr-title')?.value,
      organization_name: document.getElementById('erp-scr-org')?.value,
      city: document.getElementById('erp-scr-city')?.value,
      province: document.getElementById('erp-scr-prov')?.value,
      closing_date: document.getElementById('erp-scr-closing')?.value,
      estimated_cost: parseFloat(document.getElementById('erp-scr-val')?.value || 0)
    };
    const res = await this.request('/tender-radar/scrapes', 'POST', payload, 'erp_tender_scrapes');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Tender notice ingested!', 'success');
      this.switchNotifTab('scrapes');
    }
  },

  // ==========================================================================
  // 2. MODULE 3 ADDITIONS: INTER-WAREHOUSE TRANSFERS & STOCK RECONCILIATION ('stock-transfers')
  // ==========================================================================
  async renderStockTransfersHTML() {
    const [trRes, adjRes, whList, prodList] = await Promise.all([
      this.request('/inventory-transfers', 'GET', null, 'erp_stock_transfers'),
      this.request('/inventory-adjustments', 'GET', null, 'erp_stock_adjustments'),
      API.getWarehouses(),
      API.getProducts()
    ]);

    this._cachedWarehouses = whList || [];
    this._cachedProducts = prodList || [];
    const transfers = trRes.data || [];
    const adjustments = adjRes.data || [];

    return `
      <div class="kpi-grid" style="margin-bottom: 18px;">
        <div class="kpi-card">
          <div class="kpi-label">🔄 Inter-Warehouse Transfers</div>
          <div class="kpi-value" style="color:#0284c7;">${transfers.length} Orders</div>
          <div class="kpi-trend positive">Real-time dual warehouse ledger sync</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">📋 Physical Stock Audits</div>
          <div class="kpi-value" style="color:#059669;">${adjustments.length} Audits</div>
          <div class="kpi-trend">System vs Physical stock reconciliation</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">🏬 Active Warehouses</div>
          <div class="kpi-value" style="color:#0f172a;">${this._cachedWarehouses.length} Locations</div>
          <div class="kpi-trend">Multi-location batch tracking</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">📦 Registered SKUs</div>
          <div class="kpi-value" style="color:#7c3aed;">${this._cachedProducts.length} Items</div>
          <div class="kpi-trend">Universal SKU & UOM catalog</div>
        </div>
      </div>

      <!-- Inter-Warehouse Stock Transfers -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:800;">🚚 Inter-Warehouse Stock Transfer Orders</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Move inventory between regional stores/warehouses with automatic OUT/IN ledger posting</p>
          </div>
          <button class="primary-btn" onclick="ModularERP.openStockTransferModal()">➕ New Stock Transfer Order</button>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-stock-transfers">
              <thead>
                <tr>
                  <th>Transfer #</th>
                  <th>Date</th>
                  <th>Source Warehouse (OUT)</th>
                  <th>Destination Warehouse (IN)</th>
                  <th>Items Transferred</th>
                  <th>Vehicle & Driver</th>
                  <th>Status</th>
                  <th style="text-align:center;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${transfers.length === 0 ? `
                  <tr><td colspan="8" style="text-align:center; padding:22px; color:#64748b;">No inter-warehouse stock transfers recorded yet. Click <strong>+ New Stock Transfer Order</strong> to move stock between warehouses.</td></tr>
                ` : transfers.map(t => `
                  <tr>
                    <td style="font-weight:700; font-family:monospace; color:#0284c7;">${escapeHtml(t.transfer_number)}</td>
                    <td>${formatDateDDMMYYYY(t.transfer_date)}</td>
                    <td style="font-weight:600; color:#dc2626;">📤 ${escapeHtml(t.from_warehouse_name || 'Source Store')}</td>
                    <td style="font-weight:600; color:#059669;">📥 ${escapeHtml(t.to_warehouse_name || 'Destination Store')}</td>
                    <td>
                      ${Array.isArray(t.items) && t.items.length > 0
        ? t.items.map(i => `<div><strong>${escapeHtml(i.product_name || 'SKU')}</strong>: ${i.quantity} (Batch: ${escapeHtml(i.batch_number || 'STANDARD')})</div>`).join('')
        : `<span style="color:#64748b;">${escapeHtml(t.notes || 'Standard Transfer')}</span>`}
                    </td>
                    <td>${escapeHtml(t.vehicle_number || '—')} ${t.driver_name ? `(${escapeHtml(t.driver_name)})` : ''}</td>
                    <td><span class="badge badge-won">${escapeHtml(t.status || 'Completed')}</span></td>
                    <td style="text-align:center;">
                      <button class="secondary-btn" style="padding:4px 9px; font-size:0.75rem;" onclick='if(window.TemplatesEngine && TemplatesEngine.printStockTransferNote){ TemplatesEngine.printStockTransferNote(${JSON.stringify(t).replace(/'/g, "&#39;")}); } else { window.print(); }' title="Print Official Inter-Warehouse Stock Transfer Note (STN)">
                        🖨️ STN
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Physical Stock Reconciliation & Adjustments -->
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:800;">🔍 Physical Count Audits & Stock Reconciliation</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Reconcile physical warehouse shelf counts against system stock and log variance adjustments</p>
          </div>
          <button class="secondary-btn" style="border-color:#059669; color:#059669; font-weight:700;" onclick="ModularERP.openStockAdjustmentModal()">📋 + Post Physical Stock Audit</button>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-stock-adjustments">
              <thead>
                <tr>
                  <th>Audit Ref #</th>
                  <th>Date</th>
                  <th>Warehouse</th>
                  <th>Audit Type</th>
                  <th>Reconciled SKU & Variance</th>
                  <th style="text-align:right;">Value Impact</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${adjustments.length === 0 ? `
                  <tr><td colspan="7" style="text-align:center; padding:22px; color:#64748b;">No stock reconciliation audits recorded yet.</td></tr>
                ` : adjustments.map(a => `
                  <tr>
                    <td style="font-weight:700; font-family:monospace;">${escapeHtml(a.adjustment_number)}</td>
                    <td>${formatDateDDMMYYYY(a.adjustment_date)}</td>
                    <td style="font-weight:600;">🏬 ${escapeHtml(a.warehouse_name || 'Main Warehouse')}</td>
                    <td><span class="badge" style="background:#f1f5f9; color:#334155;">${escapeHtml(a.adjustment_type)}</span></td>
                    <td>
                      ${Array.isArray(a.items) && a.items.length > 0
            ? a.items.map(i => `<div><strong>${escapeHtml(i.product_name || 'Item')}</strong>: System ${i.system_stock} → Physical <strong>${i.physical_stock}</strong> (${Number(i.difference_qty) >= 0 ? '+' : ''}${i.difference_qty})</div>`).join('')
            : escapeHtml(a.remarks || '—')}
                    </td>
                    <td style="text-align:right; font-family:monospace; font-weight:700; color:${parseFloat(a.total_value_impact || 0) >= 0 ? '#059669' : '#dc2626'};">
                      ${formatCurrency(a.total_value_impact || 0)}
                    </td>
                    <td><span class="badge badge-won">${escapeHtml(a.status || 'Posted')}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  openStockTransferModal() {
    const whOpts = (this._cachedWarehouses || []).map(w => `<option value="${w.id}">${escapeHtml(w.warehouse_name || w.name || 'Warehouse')}</option>`).join('');
    const prodOpts = (this._cachedProducts || []).map(p => `<option value="${p.id}" data-cost="${p.cost_price || p.unit_price || 0}">${escapeHtml(p.name)} (${escapeHtml(p.sku || p.sku_code || 'SKU')})</option>`).join('');

    this.showDynamicModal('🚚 Create Inter-Warehouse Stock Transfer Order', `
      <form onsubmit="event.preventDefault(); ModularERP.submitStockTransferForm();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Source Warehouse (Dispatch OUT) *</label>
            <select class="form-select" id="erp-tr-from" required>${whOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Destination Warehouse (Receive IN) *</label>
            <select class="form-select" id="erp-tr-to" required>${whOpts}</select>
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Product / SKU *</label>
            <select class="form-select" id="erp-tr-prod" required>${prodOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Transfer Quantity *</label>
            <input type="number" class="form-input" id="erp-tr-qty" required min="1" value="10">
          </div>
          <div class="form-group">
            <label class="form-label">Batch / Lot #</label>
            <input type="text" class="form-input" id="erp-tr-batch" value="STANDARD">
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Transfer Date *</label>
            <input type="date" class="form-input" id="erp-tr-date" required value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label class="form-label">Vehicle #</label>
            <input type="text" class="form-input" id="erp-tr-vehicle" placeholder="e.g. LEB-2026">
          </div>
          <div class="form-group">
            <label class="form-label">Driver Name</label>
            <input type="text" class="form-input" id="erp-tr-driver" placeholder="e.g. Muhammad Aslam">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Transfer Notes</label>
          <input type="text" class="form-input" id="erp-tr-notes" placeholder="e.g. Stock replenishment for Lahore regional project">
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">🚚 Execute Stock Transfer</button>
        </div>
      </form>
    `);
  },

  async submitStockTransferForm() {
    const fromId = document.getElementById('erp-tr-from')?.value;
    const toId = document.getElementById('erp-tr-to')?.value;
    if (fromId === toId) {
      showToast('Source and Destination warehouses must be different.', 'warning');
      return;
    }
    const prodEl = document.getElementById('erp-tr-prod');
    const prodId = prodEl?.value;
    const selectedCost = parseFloat(prodEl?.options[prodEl.selectedIndex]?.dataset?.cost || 0);
    const qty = parseFloat(document.getElementById('erp-tr-qty')?.value || 0);
    const batch = document.getElementById('erp-tr-batch')?.value || 'STANDARD';
    const payload = {
      from_warehouse_id: fromId,
      to_warehouse_id: toId,
      transfer_date: normalizeDateToISO(document.getElementById('erp-tr-date')?.value),
      vehicle_number: document.getElementById('erp-tr-vehicle')?.value,
      driver_name: document.getElementById('erp-tr-driver')?.value,
      notes: document.getElementById('erp-tr-notes')?.value,
      items: [{ product_id: prodId, quantity: qty, batch_number: batch, unit_cost: selectedCost }]
    };
    const res = await this.request('/inventory-transfers', 'POST', payload, 'erp_stock_transfers');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast(res.message || 'Stock transfer completed!', 'success');
      renderActiveView();
    }
  },

  openStockAdjustmentModal() {
    const whOpts = (this._cachedWarehouses || []).map(w => `<option value="${w.id}">${escapeHtml(w.warehouse_name || w.name || 'Warehouse')}</option>`).join('');
    const prodOpts = (this._cachedProducts || []).map(p => `<option value="${p.id}" data-stock="${p.current_stock || p.stock_quantity || 0}" data-cost="${p.cost_price || p.unit_price || 0}">${escapeHtml(p.name)} (Current: ${p.current_stock || p.stock_quantity || 0})</option>`).join('');

    this.showDynamicModal('📋 Post Physical Stock Count & Reconciliation Audit', `
      <form onsubmit="event.preventDefault(); ModularERP.submitStockAdjustmentForm();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Warehouse Location *</label>
            <select class="form-select" id="erp-adj-wh" required>${whOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Reconciliation Reason *</label>
            <select class="form-select" id="erp-adj-type" required>
              <option value="Physical Count Audit">Physical Count Audit</option>
              <option value="Opening Stock Balance">Opening Stock Balance</option>
              <option value="Damaged / Defective Write-off">Damaged / Defective Write-off</option>
              <option value="Expired Batch Write-off">Expired Batch Write-off</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Select Product / SKU *</label>
          <select class="form-select" id="erp-adj-prod" required>${prodOpts}</select>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">System Stock Qty</label>
            <input type="number" class="form-input" id="erp-adj-sys" value="0" step="any">
          </div>
          <div class="form-group">
            <label class="form-label">Physical Counted Qty *</label>
            <input type="number" class="form-input" id="erp-adj-phys" required value="25" step="any">
          </div>
          <div class="form-group">
            <label class="form-label">Unit Cost (PKR)</label>
            <input type="number" class="form-input" id="erp-adj-cost" value="1500" step="any">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Audit Remarks</label>
          <input type="text" class="form-input" id="erp-adj-remarks" placeholder="e.g. Verified during monthly physical shelf audit">
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn" style="background:#059669;">✓ Reconcile & Post Audit</button>
        </div>
      </form>
    `);
  },

  async submitStockAdjustmentForm() {
    const payload = {
      warehouse_id: document.getElementById('erp-adj-wh')?.value,
      adjustment_type: document.getElementById('erp-adj-type')?.value,
      product_id: document.getElementById('erp-adj-prod')?.value,
      system_stock: parseFloat(document.getElementById('erp-adj-sys')?.value || 0),
      physical_stock: parseFloat(document.getElementById('erp-adj-phys')?.value || 0),
      unit_cost: parseFloat(document.getElementById('erp-adj-cost')?.value || 0),
      remarks: document.getElementById('erp-adj-remarks')?.value
    };
    const res = await this.request('/inventory-adjustments', 'POST', payload, 'erp_stock_adjustments');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast(res.message || 'Stock reconciliation posted!', 'success');
      renderActiveView();
    }
  },

  // ==========================================================================
  // 3. MODULE 5: CUSTOMER RESOURCE MANAGEMENT - CRM ('crm')
  // ==========================================================================
  _crmActiveTab: 'dashboard',
  _crmCustomerFilter: { stage: 'all', classification: 'all', search: '' },
  _crmLeadFilter: { stage: 'all', priority: 'all', search: '' },
  _crmOpportunityFilter: { stage: 'all', search: '' },
  _crmActivityFilter: { status: 'all', type: 'all' },
  _crmCaseFilter: { status: 'all', priority: 'all' },
  _cachedCrmCustomers: [],
  _cachedLeads: [],
  _cachedOpportunities: [],
  _cachedActivities: [],
  _cachedCases: [],

  switchCrmTab(tab) {
    this._crmActiveTab = tab;
    const viewMap = {
      'dashboard': 'crm',
      'customers': 'customers',
      'leads': 'crm-leads',
      'opportunities': 'crm-deals',
      'activities': 'crm-activities',
      'cases': 'crm-cases'
    };
    const nextView = viewMap[tab] || 'crm';
    if (typeof switchView === 'function' && typeof State !== 'undefined' && State.activeView !== nextView) {
      switchView(nextView);
    } else if (typeof renderActiveView === 'function') {
      renderActiveView();
    }
  },

  async renderCrmHTML() {
    const [custRes, leadsRes, oppRes, actRes, casesRes] = await Promise.all([
      typeof API !== 'undefined' && API.getCrmCustomers ? API.getCrmCustomers().catch(() => ({ success: true, data: [] })) : this.request('/crm/customers', 'GET', null, 'erp_crm_customers'),
      typeof API !== 'undefined' && API.getCrmLeads ? API.getCrmLeads().catch(() => ({ success: true, data: [] })) : this.request('/crm/leads', 'GET', null, 'erp_crm_leads'),
      typeof API !== 'undefined' && API.getCrmOpportunities ? API.getCrmOpportunities().catch(() => ({ success: true, data: [] })) : this.request('/crm/opportunities', 'GET', null, 'erp_crm_opportunities'),
      typeof API !== 'undefined' && API.getCrmActivities ? API.getCrmActivities().catch(() => ({ success: true, data: [] })) : this.request('/crm/activities', 'GET', null, 'erp_crm_activities'),
      typeof API !== 'undefined' && API.getCrmCases ? API.getCrmCases().catch(() => ({ success: true, data: [] })) : this.request('/crm/cases', 'GET', null, 'erp_crm_cases')
    ]);

    const customers = custRes?.data || [];
    const leads = leadsRes?.data || [];
    const opportunities = oppRes?.data || [];
    const activities = actRes?.data || [];
    const cases = casesRes?.data || [];

    this._cachedCrmCustomers = customers;
    this._cachedLeads = leads;
    this._cachedOpportunities = opportunities;
    this._cachedActivities = activities;
    this._cachedCases = cases;

    const prospectsCount = customers.filter(c => c.is_prospect).length;
    const activeClientsCount = customers.filter(c => !c.is_prospect && c.lifecycle_stage !== 'archived').length;
    const totalPipelineVal = opportunities.reduce((s, o) => s + parseFloat(o.expected_value || 0), 0);
    const weightedPipelineVal = opportunities.reduce((s, o) => s + (parseFloat(o.expected_value || 0) * (parseFloat(o.win_probability || 30) / 100)), 0);
    const wonOpps = opportunities.filter(o => o.stage === 'Won').length;
    const winRate = opportunities.length > 0 ? Math.round((wonOpps / opportunities.length) * 100) : 0;

    const now = new Date();
    const overdueActivities = activities.filter(a => a.status !== 'Completed' && a.due_date && new Date(a.due_date) < now).length;
    const openCases = cases.filter(c => c.status !== 'Closed' && c.status !== 'Resolved').length;
    const breachedCases = cases.filter(c => c.sla_breached || (c.status !== 'Closed' && c.sla_due_date && new Date(c.sla_due_date) < now)).length;

    const currentTab = this._crmActiveTab || 'dashboard';

    return `
      <!-- CRM Top KPI Strip -->
      <div class="kpi-grid" style="margin-bottom: 16px;">
        <div class="kpi-card" style="cursor:pointer;" onclick="ModularERP.switchCrmTab('customers')">
          <div class="kpi-label">👥 Customers & Prospects</div>
          <div class="kpi-value" style="color:#0284c7;">${customers.length} Accounts</div>
          <div class="kpi-trend positive">${activeClientsCount} Active Clients • ${prospectsCount} Prospects</div>
        </div>
        <div class="kpi-card" style="cursor:pointer;" onclick="ModularERP.switchCrmTab('opportunities')">
          <div class="kpi-label">💼 Pipeline Value (Deals)</div>
          <div class="kpi-value" style="color:#0f172a;">${formatCurrency(totalPipelineVal)}</div>
          <div class="kpi-trend">${opportunities.length} Commercial Opportunities</div>
        </div>
        <div class="kpi-card" style="cursor:pointer;" onclick="ModularERP.switchCrmTab('opportunities')">
          <div class="kpi-label">🎯 Weighted Revenue Forecast</div>
          <div class="kpi-value" style="color:#059669;">${formatCurrency(weightedPipelineVal)}</div>
          <div class="kpi-trend positive">Win Rate: ${winRate}% (${wonOpps} Won)</div>
        </div>
        <div class="kpi-card" style="cursor:pointer;" onclick="ModularERP.switchCrmTab('activities')">
          <div class="kpi-label">⏰ Follow-ups & Activities</div>
          <div class="kpi-value" style="color:#7c3aed;">${activities.length} Logs</div>
          <div class="kpi-trend ${overdueActivities > 0 ? 'negative' : 'positive'}">${overdueActivities > 0 ? overdueActivities + ' Overdue Follow-ups!' : '✓ All Follow-ups on Track'}</div>
        </div>
        <div class="kpi-card" style="cursor:pointer;" onclick="ModularERP.switchCrmTab('cases')">
          <div class="kpi-label">🎫 Support Cases & SLA</div>
          <div class="kpi-value" style="color:${breachedCases > 0 ? '#dc2626' : '#d97706'};">${openCases} Open</div>
          <div class="kpi-trend ${breachedCases > 0 ? 'negative' : 'positive'}">${breachedCases > 0 ? '⚠️ ' + breachedCases + ' SLA Breached!' : '✓ 100% SLA Compliant'}</div>
        </div>
      </div>

      <!-- Active CRM Screen Content (Navigated via Sidebar) -->
      ${this.renderCrmTabContent(currentTab, { customers, leads, opportunities, activities, cases, totalPipelineVal, weightedPipelineVal })}
    `;
  },

  renderCrmTabContent(tab, data) {
    const { customers, leads, opportunities, activities, cases, totalPipelineVal, weightedPipelineVal } = data;

    // 1. DASHBOARD OVERVIEW
    if (tab === 'dashboard') {
      const stages = ['Discovery', 'Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];
      const urgentCases = cases.filter(c => c.status !== 'Closed' && (c.priority === 'Urgent' || c.priority === 'High' || c.sla_breached));
      const overdueTasks = activities.filter(a => a.status !== 'Completed' && a.due_date && new Date(a.due_date) < new Date());

      return `
        <!-- Quick Action Bar -->
        <div class="card" style="margin-bottom:18px; background:linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);">
          <div class="card-body" style="padding:14px 18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <div style="font-weight:800; font-size:1rem; color:#0f172a;">⚡ CRM Quick Actions</div>
              <div style="font-size:0.78rem; color:#64748b;">Rapidly capture contacts, deals, customer issues or scan for duplicate accounts</div>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="primary-btn" style="padding:6px 12px; font-size:0.82rem;" onclick="ModularERP.openCrmCustomerModal()">+ New Customer / Prospect</button>
              <button class="primary-btn" style="padding:6px 12px; font-size:0.82rem; background:#0284c7;" onclick="ModularERP.openCrmLeadModal()">+ New Sales Lead</button>
              <button class="primary-btn" style="padding:6px 12px; font-size:0.82rem; background:#059669;" onclick="ModularERP.openCrmOpportunityModal()">+ New Commercial Deal</button>
              <button class="secondary-btn" style="padding:6px 12px; font-size:0.82rem;" onclick="ModularERP.openCrmActivityModal()">📞 Log Call / Task</button>
              <button class="secondary-btn" style="padding:6px 12px; font-size:0.82rem;" onclick="ModularERP.openCrmCaseModal()">🎫 Open Support Case</button>
              <button class="secondary-btn" style="padding:6px 12px; font-size:0.82rem; border-color:#d97706; color:#b45309;" onclick="ModularERP.openCrmDuplicateDetectionModal()">🔍 Scan Duplicates</button>
            </div>
          </div>
        </div>

        <!-- Deal Pipeline Stage Distribution -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-bottom:20px;">
          ${stages.map(stg => {
            const stgOpps = opportunities.filter(o => (o.stage || 'Discovery') === stg);
            const stgVal = stgOpps.reduce((s, o) => s + parseFloat(o.expected_value || 0), 0);
            const color = stg === 'Won' ? '#059669' : (stg === 'Lost' ? '#94a3b8' : (stg === 'Negotiation' ? '#7c3aed' : '#0284c7'));
            return `
              <div style="background:white; border:1px solid #e2e8f0; border-top:4px solid ${color}; border-radius:10px; padding:12px 14px; cursor:pointer;" onclick="ModularERP.switchCrmTab('opportunities')">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                  <span style="font-weight:700; font-size:0.82rem; color:#1e293b;">${stg}</span>
                  <span class="badge" style="background:#f1f5f9; color:#0f172a; font-weight:800;">${stgOpps.length}</span>
                </div>
                <div style="font-size:0.95rem; font-weight:800; color:${color}; font-family:monospace;">${formatCurrency(stgVal)}</div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Urgent Attention Split Row -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap:16px; margin-bottom:20px;">
          <!-- Left: Urgent Support Cases & SLA Alerts -->
          <div class="card">
            <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
              <h3 style="margin:0; font-size:0.95rem; font-weight:800; color:#dc2626;">🚨 Priority Support Cases & SLA Breaches (${urgentCases.length})</h3>
              <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="ModularERP.switchCrmTab('cases')">View All Cases</button>
            </div>
            <div class="card-body" style="padding:0;">
              <div class="table-responsive">
                <table class="data-table">
                  <thead>
                    <tr><th>Ticket #</th><th>Customer</th><th>Subject</th><th>Priority</th><th>SLA Due</th></tr>
                  </thead>
                  <tbody>
                    ${urgentCases.length === 0 ? `
                      <tr><td colspan="5" style="text-align:center; padding:18px; color:#64748b;">✓ No urgent or breached support cases. Excellent!</td></tr>
                    ` : urgentCases.slice(0, 5).map(c => `
                      <tr style="cursor:pointer;" onclick="ModularERP.openCrmCaseDetailModal('${c.id}')">
                        <td style="font-weight:700; font-family:monospace; color:#0284c7;">${escapeHtml(c.ticket_number)}</td>
                        <td style="font-weight:600;">${escapeHtml(c.customer_name || 'General Client')}</td>
                        <td>${escapeHtml(c.subject)}</td>
                        <td><span class="badge" style="background:#fee2e2; color:#991b1b; font-weight:700;">${escapeHtml(c.priority)}</span></td>
                        <td>
                          ${c.sla_breached ? '<span class="badge" style="background:#dc2626; color:white;">⚠️ Breached</span>' : (c.sla_due_date ? formatDateDDMMYYYY(c.sla_due_date) : 'N/A')}
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Right: Overdue Follow-ups & Reminders -->
          <div class="card">
            <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
              <h3 style="margin:0; font-size:0.95rem; font-weight:800; color:#d97706;">⏰ Action Items & Overdue Follow-ups (${overdueTasks.length})</h3>
              <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="ModularERP.switchCrmTab('activities')">View All Tasks</button>
            </div>
            <div class="card-body" style="padding:0;">
              <div class="table-responsive">
                <table class="data-table">
                  <thead>
                    <tr><th>Due Date</th><th>Type</th><th>Account</th><th>Subject</th><th>Action</th></tr>
                  </thead>
                  <tbody>
                    ${overdueTasks.length === 0 ? `
                      <tr><td colspan="5" style="text-align:center; padding:18px; color:#64748b;">✓ No overdue follow-ups. All interactions are current!</td></tr>
                    ` : overdueTasks.slice(0, 5).map(a => `
                      <tr>
                        <td style="color:#dc2626; font-weight:700;">${formatDateDDMMYYYY(a.due_date)}</td>
                        <td><span class="badge" style="background:#f1f5f9;">${escapeHtml(a.activity_type)}</span></td>
                        <td style="font-weight:600;">${escapeHtml(a.lead_company_name || a.customer_name || 'Prospect')}</td>
                        <td>${escapeHtml(a.subject)}</td>
                        <td>
                          <button class="primary-btn" style="padding:2px 8px; font-size:0.72rem; background:#059669;" onclick="ModularERP.toggleActivityStatus('${a.id}', 'Pending')">✓ Complete</button>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 2. CUSTOMERS & PROSPECTS DIRECTORY TAB
    if (tab === 'customers') {
      const stageFilter = this._crmCustomerFilter?.stage || 'all';
      const classFilter = this._crmCustomerFilter?.classification || 'all';
      const search = (this._crmCustomerFilter?.search || '').toLowerCase();

      let filtered = customers.filter(c => {
        if (stageFilter === 'prospect' && !c.is_prospect) return false;
        if (stageFilter === 'active' && (c.is_prospect || c.is_archived)) return false;
        if (stageFilter === 'archived' && !c.is_archived) return false;
        if (stageFilter === 'dormant' && c.lifecycle_stage !== 'dormant') return false;

        if (classFilter !== 'all' && (c.classification || 'Standard') !== classFilter) return false;

        if (search) {
          const matchName = (c.name || '').toLowerCase().includes(search);
          const matchPhone = (c.phone || '').toLowerCase().includes(search);
          const matchEmail = (c.email || '').toLowerCase().includes(search);
          const matchNtn = (c.ntn || '').toLowerCase().includes(search);
          const matchCity = (c.city || '').toLowerCase().includes(search);
          if (!matchName && !matchPhone && !matchEmail && !matchNtn && !matchCity) return false;
        }
        return true;
      });

      return `
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800;">👥 Master Customer & Prospect Directory</h3>
              <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Unified corporate & individual accounts with duplicate prevention, cross-module ledger, and 360° commercial profile</p>
            </div>
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button class="secondary-btn" style="border-color:#d97706; color:#b45309;" onclick="ModularERP.openCrmDuplicateDetectionModal()">🔍 Scan Duplicates</button>
              <button class="secondary-btn" onclick="ModularERP.openCrmImportModal()">📥 Import CSV/JSON</button>
              <button class="secondary-btn" onclick="ModularERP.exportCrmCustomersCSV()">📤 Export CSV</button>
              <button class="primary-btn" onclick="ModularERP.openCrmCustomerModal()">+ New Customer / Prospect</button>
            </div>
          </div>

          <!-- Search & Filter Controls -->
          <div style="background:#f8fafc; border-bottom:1px solid #e2e8f0; padding:12px 18px; display:flex; gap:12px; flex-wrap:wrap; align-items:center;">
            <div style="flex:1; min-width:220px;">
              <input type="text" class="form-input" placeholder="🔍 Search by company, contact, NTN, phone or city..." value="${escapeHtml(this._crmCustomerFilter?.search || '')}" oninput="ModularERP._crmCustomerFilter.search = this.value; ModularERP.switchCrmTab('customers');">
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <span style="font-size:0.8rem; font-weight:700; color:#475569;">Lifecycle:</span>
              <select class="form-select" style="font-size:0.8rem; padding:4px 8px; width:auto;" onchange="ModularERP._crmCustomerFilter.stage = this.value; ModularERP.switchCrmTab('customers');">
                <option value="all" ${stageFilter === 'all' ? 'selected' : ''}>All Accounts (${customers.length})</option>
                <option value="active" ${stageFilter === 'active' ? 'selected' : ''}>Active Clients</option>
                <option value="prospect" ${stageFilter === 'prospect' ? 'selected' : ''}>Prospects / Inquiries</option>
                <option value="dormant" ${stageFilter === 'dormant' ? 'selected' : ''}>Dormant</option>
                <option value="archived" ${stageFilter === 'archived' ? 'selected' : ''}>Archived</option>
              </select>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <span style="font-size:0.8rem; font-weight:700; color:#475569;">Classification:</span>
              <select class="form-select" style="font-size:0.8rem; padding:4px 8px; width:auto;" onchange="ModularERP._crmCustomerFilter.classification = this.value; ModularERP.switchCrmTab('customers');">
                <option value="all" ${classFilter === 'all' ? 'selected' : ''}>All Classifications</option>
                <option value="Key Account" ${classFilter === 'Key Account' ? 'selected' : ''}>Key Account</option>
                <option value="Enterprise" ${classFilter === 'Enterprise' ? 'selected' : ''}>Enterprise</option>
                <option value="SMB" ${classFilter === 'SMB' ? 'selected' : ''}>SMB</option>
                <option value="Government" ${classFilter === 'Government' ? 'selected' : ''}>Government / Public</option>
                <option value="Standard" ${classFilter === 'Standard' ? 'selected' : ''}>Standard</option>
              </select>
            </div>
          </div>

          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table" id="table-crm-customers">
                <thead>
                  <tr>
                    <th>Account & Code</th>
                    <th>Classification & Type</th>
                    <th>Industry & Territory</th>
                    <th>Contact Details</th>
                    <th>Lifecycle Stage</th>
                    <th style="text-align:center;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.length === 0 ? `
                    <tr><td colspan="6" style="text-align:center; padding:24px; color:#64748b;">No customer accounts matching current filters. Click <strong>+ New Customer / Prospect</strong> to register one.</td></tr>
                  ` : filtered.map(c => `
                    <tr ${c.is_archived ? 'style="opacity:0.6; background:#f8fafc;"' : ''}>
                      <td>
                        <div style="font-weight:700; color:#0f172a; font-size:0.9rem;">
                          ${c.is_prospect ? '🎯' : '🏢'} ${escapeHtml(c.name)}
                        </div>
                        <div style="font-size:0.73rem; color:#64748b; font-family:monospace;">
                          ${c.customer_code ? escapeHtml(c.customer_code) + ' • ' : ''}NTN: ${escapeHtml(c.ntn || '—')}
                        </div>
                      </td>
                      <td>
                        <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">${escapeHtml(c.classification || 'Standard')}</span>
                        <div style="font-size:0.72rem; color:#64748b; margin-top:2px;">${escapeHtml(c.customer_type || 'Business')}</div>
                      </td>
                      <td>
                        <div style="font-size:0.8rem; font-weight:600; color:#1e293b;">${escapeHtml(c.industry || 'General Commerce')}</div>
                        <div style="font-size:0.72rem; color:#64748b;">📍 ${escapeHtml(c.territory || c.city || 'Pakistan')}</div>
                      </td>
                      <td>
                        <div style="font-size:0.8rem; font-weight:600;">${escapeHtml(c.contact_person || c.phone || '—')}</div>
                        <div style="font-size:0.72rem; color:#64748b;">${escapeHtml(c.email || c.phone || '')}</div>
                      </td>
                      <td>
                        ${c.is_archived ? '<span class="badge" style="background:#e2e8f0; color:#475569;">Archived</span>' :
                          (c.is_prospect ? '<span class="badge" style="background:#fef3c7; color:#92400e;">Prospect</span>' :
                          '<span class="badge" style="background:#dcfce7; color:#166534;">Active Client</span>')}
                      </td>
                      <td style="text-align:center;">
                        <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
                          <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem; background:#ecfdf5; color:#047857; border-color:#a7f3d0;" onclick="ModularERP.openCustomer360Modal('${c.id}', '${escapeHtml(c.name)}')" title="View 360° Commercial Profile">
                            🔍 360° Profile
                          </button>
                          <button class="secondary-btn" style="padding:4px 6px; font-size:0.75rem;" onclick="openNewQuotationModal()" title="Draft Commercial Quote">
                            💬 Quote
                          </button>
                          <button class="edit-btn" style="padding:4px 6px; font-size:0.75rem;" onclick="ModularERP.openCrmCustomerModal('${c.id}')" title="Edit Customer Details">
                            ✏️
                          </button>
                          ${c.is_archived ? `
                            <button class="secondary-btn" style="padding:4px 6px; font-size:0.75rem; background:#f1f5f9;" onclick="ModularERP.archiveCrmCustomer('${c.id}', false)" title="Restore Customer">
                              ♻️ Restore
                            </button>
                          ` : `
                            <button class="delete-btn" style="padding:4px 6px; font-size:0.75rem; background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;" onclick="ModularERP.archiveCrmCustomer('${c.id}', true)" title="Archive Customer">
                              📁 Archive
                            </button>
                          `}
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    // 3. LEADS & INQUIRIES TAB
    if (tab === 'leads') {
      return `
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800;">🎯 B2B Sales & Government Inquiries</h3>
              <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Capture inquiries, set next steps, and 1-click convert into permanent Customer Master + Commercial Deal</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="secondary-btn" onclick="ModularERP.openCrmActivityModal()">📞 + Log Call / Visit</button>
              <button class="primary-btn" onclick="ModularERP.openCrmLeadModal()">➕ + New Sales Lead</button>
            </div>
          </div>
          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table" id="table-crm-leads">
                <thead>
                  <tr>
                    <th>Lead Code & Source</th>
                    <th>Company / Org</th>
                    <th>Contact Person</th>
                    <th>Priority</th>
                    <th>Pipeline Stage</th>
                    <th style="text-align:right;">Estimated Value</th>
                    <th>Next Action</th>
                    <th style="text-align:center;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${leads.length === 0 ? `
                    <tr><td colspan="8" style="text-align:center; padding:24px; color:#64748b;">No leads currently registered. Click <strong>+ New Sales Lead</strong> to add prospective deals.</td></tr>
                  ` : leads.map(l => `
                    <tr>
                      <td>
                        <div style="font-weight:700; font-family:monospace; color:#0284c7;">${escapeHtml(l.lead_code || 'LEAD')}</div>
                        <span style="font-size:0.72rem; color:#64748b;">${escapeHtml(l.lead_source || 'Direct')}</span>
                      </td>
                      <td>
                        <div style="font-weight:700; color:#0f172a;">🏢 ${escapeHtml(l.company_name)}</div>
                        <div style="font-size:0.74rem; color:#64748b;">📍 ${escapeHtml(l.city || 'Lahore')}</div>
                      </td>
                      <td>
                        <div style="font-weight:600;">${escapeHtml(l.contact_name || '—')}</div>
                        <div style="font-size:0.74rem; color:#64748b;">📱 ${escapeHtml(l.contact_phone || '')}</div>
                      </td>
                      <td>
                        <span class="badge" style="background:${l.priority === 'High' ? '#fee2e2' : (l.priority === 'Low' ? '#f1f5f9' : '#fef3c7')}; color:${l.priority === 'High' ? '#dc2626' : (l.priority === 'Low' ? '#475569' : '#d97706')}; font-weight:700;">
                          ${escapeHtml(l.priority || 'Medium')}
                        </span>
                      </td>
                      <td>
                        <select class="form-select" style="font-size:0.78rem; padding:3px 8px; width:auto; font-weight:700;" onchange="ModularERP.updateLeadStage('${l.id}', this.value)">
                          ${['New Lead', 'Contacted', 'Qualification', 'Proposal Sent', 'Won', 'Lost'].map(st => `
                            <option value="${st}" ${l.pipeline_stage === st ? 'selected' : ''}>${st}</option>
                          `).join('')}
                        </select>
                      </td>
                      <td style="text-align:right; font-family:monospace; font-weight:700;">
                        ${formatCurrency(l.estimated_deal_value || 0)}
                        <div style="font-size:0.7rem; color:#059669;">Prob: ${l.win_probability || 30}%</div>
                      </td>
                      <td>
                        <div style="font-size:0.78rem; font-weight:600;">${escapeHtml(l.next_action || 'Follow up')}</div>
                        <div style="font-size:0.7rem; color:#64748b;">${l.next_action_date ? formatDateDDMMYYYY(l.next_action_date) : ''}</div>
                      </td>
                      <td style="text-align:center;">
                        <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
                          ${l.pipeline_stage !== 'Won' ? `
                            <button class="primary-btn" style="padding:4px 10px; font-size:0.75rem; background:#059669;" onclick="ModularERP.convertLeadToCustomer('${l.id}')" title="1-Click Convert Lead to Permanent Customer Master & Opportunity">
                              🏢 Convert
                            </button>
                          ` : `
                            <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem; background:#ecfdf5; color:#047857; border-color:#a7f3d0;" onclick="ModularERP.openCustomer360Modal('${l.converted_customer_id || l.customer_id || ''}', '${escapeHtml(l.company_name)}')">
                              🔍 360° Profile
                            </button>
                          `}
                          <button class="secondary-btn" style="padding:4px 6px; font-size:0.75rem;" onclick="openNewQuotationModal()" title="Draft Quotation">
                            💬
                          </button>
                          <button class="edit-btn" style="padding:4px 6px; font-size:0.75rem;" onclick="ModularERP.openEditCrmLeadModal('${l.id}')" title="Edit Lead">
                            ✏️
                          </button>
                          <button class="delete-btn" style="padding:4px 6px; font-size:0.75rem; background:rgba(239,68,68,0.1); color:#ef4444; border:1px solid rgba(239,68,68,0.3); border-radius:4px; cursor:pointer;" onclick="ModularERP.deleteCrmLead('${l.id}', '${escapeHtml(l.company_name)}')" title="Delete Lead">
                            🗑️
                          </button>
                        </div>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    // 4. DEALS PIPELINE KANBAN TAB
    if (tab === 'opportunities') {
      const stages = ['Discovery', 'Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'];

      return `
        <div class="card" style="margin-bottom:16px;">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800;">💼 Commercial Opportunity & Deals Pipeline</h3>
              <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Visual B2B stage forecasting with probability weighting and stage transitions</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="primary-btn" onclick="ModularERP.openCrmOpportunityModal()">+ New Deal / Opportunity</button>
            </div>
          </div>
        </div>

        <!-- Kanban Board Columns -->
        <div style="display:grid; grid-template-columns: repeat(6, minmax(220px, 1fr)); gap:12px; overflow-x:auto; padding-bottom:14px;">
          ${stages.map((stg, stgIdx) => {
            const stgOpps = opportunities.filter(o => (o.stage || 'Discovery') === stg);
            const stgVal = stgOpps.reduce((s, o) => s + parseFloat(o.expected_value || 0), 0);
            const borderTopColor = stg === 'Won' ? '#059669' : (stg === 'Lost' ? '#94a3b8' : (stg === 'Negotiation' ? '#7c3aed' : '#0284c7'));

            return `
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-top:4px solid ${borderTopColor}; border-radius:8px; display:flex; flex-direction:column; min-height:450px;">
                <!-- Column Header -->
                <div style="padding:10px 12px; border-bottom:1px solid #e2e8f0; background:#ffffff; border-radius:6px 6px 0 0;">
                  <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span style="font-weight:800; font-size:0.85rem; color:#0f172a;">${stg}</span>
                    <span class="badge" style="background:#f1f5f9; font-weight:800; font-size:0.75rem;">${stgOpps.length}</span>
                  </div>
                  <div style="font-size:0.85rem; font-weight:800; color:${borderTopColor}; font-family:monospace; margin-top:2px;">
                    ${formatCurrency(stgVal)}
                  </div>
                </div>

                <!-- Column Cards Container -->
                <div style="padding:8px; display:flex; flex-direction:column; gap:8px; flex:1; overflow-y:auto; max-height:600px;">
                  ${stgOpps.length === 0 ? `
                    <div style="text-align:center; padding:24px 8px; color:#94a3b8; font-size:0.75rem; font-style:italic;">No deals in ${stg}</div>
                  ` : stgOpps.map(o => `
                    <div style="background:white; border:1px solid #e2e8f0; border-radius:6px; padding:10px; box-shadow:0 1px 2px rgba(0,0,0,0.03);">
                      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                        <span style="font-weight:700; font-size:0.84rem; color:#0f172a; line-height:1.2;">${escapeHtml(o.title)}</span>
                      </div>
                      <div style="font-size:0.75rem; color:#0284c7; font-weight:600; margin-bottom:4px;">
                        🏢 ${escapeHtml(o.customer_name || 'Prospect')}
                      </div>
                      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <span style="font-weight:800; font-family:monospace; font-size:0.88rem; color:#059669;">${formatCurrency(o.expected_value || 0)}</span>
                        <span style="font-size:0.7rem; color:#64748b; font-weight:700;">Prob: ${o.win_probability || 30}%</span>
                      </div>
                      ${o.expected_close_date ? `
                        <div style="font-size:0.7rem; color:#64748b; margin-bottom:6px;">
                          📅 Close: ${formatDateDDMMYYYY(o.expected_close_date)}
                        </div>
                      ` : ''}

                      <!-- Card Stage Movement Controls -->
                      <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px dashed #e2e8f0; padding-top:6px; margin-top:4px;">
                        <div>
                          ${stgIdx > 0 ? `
                            <button class="secondary-btn" style="padding:2px 6px; font-size:0.7rem;" onclick="ModularERP.advanceOpportunityStage('${o.id}', '${stages[stgIdx - 1]}')" title="Move back to ${stages[stgIdx - 1]}">◀</button>
                          ` : ''}
                          ${stgIdx < stages.length - 1 ? `
                            <button class="secondary-btn" style="padding:2px 6px; font-size:0.7rem;" onclick="ModularERP.advanceOpportunityStage('${o.id}', '${stages[stgIdx + 1]}')" title="Advance to ${stages[stgIdx + 1]}">▶</button>
                          ` : ''}
                        </div>
                        <div style="display:flex; gap:4px;">
                          <button class="edit-btn" style="padding:2px 5px; font-size:0.7rem;" onclick="ModularERP.openCrmOpportunityModal('${o.id}')" title="Edit Deal">✏️</button>
                          <button class="delete-btn" style="padding:2px 5px; font-size:0.7rem; color:#ef4444;" onclick="ModularERP.deleteCrmOpportunity('${o.id}', '${escapeHtml(o.title)}')" title="Delete Deal">🗑️</button>
                        </div>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // 5. ACTIVITIES & TASKS TAB
    if (tab === 'activities') {
      const actFilter = this._crmActivityFilter?.status || 'all';
      let filtered = activities.filter(a => {
        if (actFilter === 'Pending' && a.status === 'Completed') return false;
        if (actFilter === 'Completed' && a.status !== 'Completed') return false;
        return true;
      });

      return `
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800;">📅 Activities, Calls & Client Follow-up Agenda</h3>
              <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Schedule meetings, technical site visits, phone calls and log communication outcomes</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="primary-btn" onclick="ModularERP.openCrmActivityModal()">📞 + Schedule Task / Activity</button>
            </div>
          </div>

          <!-- Filter Toolbar -->
          <div style="background:#f8fafc; border-bottom:1px solid #e2e8f0; padding:10px 18px; display:flex; gap:12px; align-items:center;">
            <span style="font-size:0.8rem; font-weight:700; color:#475569;">Filter Status:</span>
            <select class="form-select" style="font-size:0.8rem; padding:4px 8px; width:auto;" onchange="ModularERP._crmActivityFilter.status = this.value; ModularERP.switchCrmTab('activities');">
              <option value="all" ${actFilter === 'all' ? 'selected' : ''}>All Logs (${activities.length})</option>
              <option value="Pending" ${actFilter === 'Pending' ? 'selected' : ''}>Pending Tasks</option>
              <option value="Completed" ${actFilter === 'Completed' ? 'selected' : ''}>Completed Activities</option>
            </select>
          </div>

          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table" id="table-crm-activities">
                <thead>
                  <tr>
                    <th>Due / Scheduled Date</th>
                    <th>Activity Type</th>
                    <th>Account / Contact</th>
                    <th>Subject & Details</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th style="text-align:center;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.length === 0 ? `
                    <tr><td colspan="7" style="text-align:center; padding:24px; color:#64748b;">No activities logged matching the filter.</td></tr>
                  ` : filtered.map(a => {
                    const isOverdue = a.status !== 'Completed' && a.due_date && new Date(a.due_date) < new Date();
                    return `
                      <tr ${isOverdue ? 'style="background:#fef2f2;"' : ''}>
                        <td>
                          <div style="font-weight:700; ${isOverdue ? 'color:#dc2626;' : 'color:#1e293b;'}">
                            ${formatDateDDMMYYYY(a.due_date || a.scheduled_at || a.created_at)}
                          </div>
                          ${isOverdue ? '<span class="badge" style="background:#dc2626; color:white; font-size:0.65rem;">OVERDUE</span>' : ''}
                        </td>
                        <td>
                          <span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">${escapeHtml(a.activity_type)}</span>
                        </td>
                        <td style="font-weight:600;">
                          ${escapeHtml(a.customer_name || a.lead_company_name || 'Prospect Client')}
                        </td>
                        <td>
                          <div style="font-weight:700; color:#0f172a;">${escapeHtml(a.subject)}</div>
                          ${a.outcome ? `<div style="font-size:0.75rem; color:#64748b; margin-top:2px;">Outcome: ${escapeHtml(a.outcome)}</div>` : ''}
                        </td>
                        <td>
                          <span class="badge" style="background:${a.priority === 'High' ? '#fee2e2' : '#f1f5f9'}; color:${a.priority === 'High' ? '#dc2626' : '#475569'};">
                            ${escapeHtml(a.priority || 'Medium')}
                          </span>
                        </td>
                        <td>
                          ${a.status === 'Completed' ?
                            '<span class="badge" style="background:#dcfce7; color:#166534; font-weight:700;">✓ Completed</span>' :
                            '<span class="badge" style="background:#fef3c7; color:#92400e; font-weight:700;">⏳ Pending</span>'}
                        </td>
                        <td style="text-align:center;">
                          <div style="display:flex; gap:6px; justify-content:center;">
                            <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="ModularERP.toggleActivityStatus('${a.id}', '${a.status || 'Pending'}')">
                              ${a.status === 'Completed' ? '↩ Reopen' : '✓ Done'}
                            </button>
                            <button class="delete-btn" style="padding:4px 6px; font-size:0.75rem; color:#ef4444;" onclick="ModularERP.deleteCrmActivity('${a.id}')" title="Delete">🗑️</button>
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    // 6. SUPPORT CASES & SLA TAB
    if (tab === 'cases') {
      const caseFilter = this._crmCaseFilter?.status || 'all';
      let filtered = cases.filter(c => {
        if (caseFilter === 'open' && (c.status === 'Closed' || c.status === 'Resolved')) return false;
        if (caseFilter === 'closed' && c.status !== 'Closed' && c.status !== 'Resolved') return false;
        return true;
      });

      return `
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h3 style="margin:0; font-size:1.05rem; font-weight:800;">🎫 Customer Support Cases & Service-Level Agreement (SLA)</h3>
              <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Manage customer complaints, billing queries, technical issues with SLA deadline monitoring</p>
            </div>
            <div style="display:flex; gap:8px;">
              <button class="primary-btn" onclick="ModularERP.openCrmCaseModal()">🎫 + Open Support Ticket</button>
            </div>
          </div>

          <!-- Filter Toolbar -->
          <div style="background:#f8fafc; border-bottom:1px solid #e2e8f0; padding:10px 18px; display:flex; gap:12px; align-items:center;">
            <span style="font-size:0.8rem; font-weight:700; color:#475569;">Filter Status:</span>
            <select class="form-select" style="font-size:0.8rem; padding:4px 8px; width:auto;" onchange="ModularERP._crmCaseFilter.status = this.value; ModularERP.switchCrmTab('cases');">
              <option value="all" ${caseFilter === 'all' ? 'selected' : ''}>All Tickets (${cases.length})</option>
              <option value="open" ${caseFilter === 'open' ? 'selected' : ''}>Open / In Progress Tickets</option>
              <option value="closed" ${caseFilter === 'closed' ? 'selected' : ''}>Resolved & Closed Tickets</option>
            </select>
          </div>

          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table" id="table-crm-cases">
                <thead>
                  <tr>
                    <th>Ticket # & Date</th>
                    <th>Customer</th>
                    <th>Category</th>
                    <th>Subject</th>
                    <th>Priority</th>
                    <th>SLA Target & Deadline</th>
                    <th>Status</th>
                    <th style="text-align:center;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered.length === 0 ? `
                    <tr><td colspan="8" style="text-align:center; padding:24px; color:#64748b;">No support cases found matching criteria.</td></tr>
                  ` : filtered.map(c => {
                    const isBreached = c.sla_breached || (c.status !== 'Closed' && c.sla_due_date && new Date(c.sla_due_date) < new Date());
                    return `
                      <tr ${isBreached ? 'style="background:#fef2f2;"' : ''}>
                        <td>
                          <div style="font-weight:700; font-family:monospace; color:#0284c7;">${escapeHtml(c.ticket_number)}</div>
                          <div style="font-size:0.72rem; color:#64748b;">${formatDateDDMMYYYY(c.created_at)}</div>
                        </td>
                        <td style="font-weight:600;">${escapeHtml(c.customer_name || 'General Client')}</td>
                        <td><span class="badge" style="background:#f1f5f9; color:#334155;">${escapeHtml(c.category)}</span></td>
                        <td>
                          <div style="font-weight:700; color:#0f172a;">${escapeHtml(c.subject)}</div>
                          ${c.description ? `<div style="font-size:0.73rem; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:260px;">${escapeHtml(c.description)}</div>` : ''}
                        </td>
                        <td>
                          <span class="badge" style="background:${c.priority === 'Urgent' ? '#fee2e2' : (c.priority === 'High' ? '#fef3c7' : '#f1f5f9')}; color:${c.priority === 'Urgent' ? '#991b1b' : (c.priority === 'High' ? '#92400e' : '#334155')}; font-weight:700;">
                            ${escapeHtml(c.priority)}
                          </span>
                        </td>
                        <td>
                          <div>${c.sla_target_hours || 48}h Target</div>
                          <div style="font-size:0.74rem; font-weight:700; ${isBreached ? 'color:#dc2626;' : 'color:#64748b;'}">
                            ${isBreached ? '⚠️ Breached: ' : ''}${c.sla_due_date ? formatDateDDMMYYYY(c.sla_due_date) : 'N/A'}
                          </div>
                        </td>
                        <td>
                          <span class="badge ${c.status === 'Resolved' || c.status === 'Closed' ? 'badge-won' : (c.status === 'In Progress' ? 'badge-info' : 'badge-hold')}">
                            ${escapeHtml(c.status)}
                          </span>
                        </td>
                        <td style="text-align:center;">
                          <div style="display:flex; gap:6px; justify-content:center;">
                            <button class="primary-btn" style="padding:4px 8px; font-size:0.75rem;" onclick="ModularERP.openCrmCaseDetailModal('${c.id}')">
                              👁️ Details / Comment
                            </button>
                            <button class="delete-btn" style="padding:4px 6px; font-size:0.75rem; color:#ef4444;" onclick="ModularERP.deleteCrmCase('${c.id}', '${escapeHtml(c.ticket_number)}')" title="Delete Ticket">🗑️</button>
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      `;
    }

    return '';
  },

  // ==========================================================================
  // CRM CUSTOMER & PROSPECT MODALS & HANDLERS
  // ==========================================================================
  openCrmCustomerModal(customerId = null) {
    const custs = this._cachedCrmCustomers || [];
    const c = custs.find(item => String(item.id) === String(customerId)) || {};

    this.showDynamicModal(customerId ? '✏️ Edit Customer Profile' : '➕ Register New Customer / Prospect', `
      <form onsubmit="event.preventDefault(); ModularERP.submitCrmCustomerForm('${customerId || ''}');">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Customer / Company Name *</label>
            <input type="text" class="form-input" id="crm-cust-name" required value="${escapeHtml(c.name || '')}" placeholder="e.g. Packages Limited">
          </div>
          <div class="form-group">
            <label class="form-label">Account Classification</label>
            <select class="form-select" id="crm-cust-class">
              ${['Key Account', 'Enterprise', 'SMB', 'Government', 'Standard'].map(opt => `
                <option value="${opt}" ${(c.classification || 'Standard') === opt ? 'selected' : ''}>${opt}</option>
              `).join('')}
            </select>
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Account Type</label>
            <select class="form-select" id="crm-cust-type">
              <option value="Business" ${c.customer_type === 'Business' ? 'selected' : ''}>Business / Corporate</option>
              <option value="Individual" ${c.customer_type === 'Individual' ? 'selected' : ''}>Individual Client</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Lifecycle Stage</label>
            <select class="form-select" id="crm-cust-stage">
              <option value="prospect" ${c.is_prospect ? 'selected' : ''}>🎯 Prospect / Lead</option>
              <option value="active_customer" ${!c.is_prospect && c.lifecycle_stage !== 'dormant' ? 'selected' : ''}>🏢 Active Customer</option>
              <option value="dormant" ${c.lifecycle_stage === 'dormant' ? 'selected' : ''}>💤 Dormant</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Industry</label>
            <input type="text" class="form-input" id="crm-cust-industry" value="${escapeHtml(c.industry || '')}" placeholder="e.g. Manufacturing, Telecom">
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Contact Person</label>
            <input type="text" class="form-input" id="crm-cust-contact" value="${escapeHtml(c.contact_person || '')}" placeholder="Full Name">
          </div>
          <div class="form-group">
            <label class="form-label">Phone / WhatsApp *</label>
            <input type="text" class="form-input" id="crm-cust-phone" required value="${escapeHtml(c.phone || '')}" placeholder="0300-1234567">
          </div>
          <div class="form-group">
            <label class="form-label">Email Address</label>
            <input type="email" class="form-input" id="crm-cust-email" value="${escapeHtml(c.email || '')}" placeholder="procurement@company.pk">
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">NTN (National Tax #)</label>
            <input type="text" class="form-input" id="crm-cust-ntn" value="${escapeHtml(c.ntn || '')}" placeholder="1234567-8">
          </div>
          <div class="form-group">
            <label class="form-label">STRN (Sales Tax #)</label>
            <input type="text" class="form-input" id="crm-cust-strn" value="${escapeHtml(c.strn || '')}" placeholder="Sales Tax Reg #">
          </div>
          <div class="form-group">
            <label class="form-label">City / Territory</label>
            <input type="text" class="form-input" id="crm-cust-city" value="${escapeHtml(c.city || 'Lahore')}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <input type="text" class="form-input" id="crm-cust-address" value="${escapeHtml(c.address || '')}" placeholder="Office/Warehouse Street Address">
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save Customer</button>
        </div>
      </form>
    `);
  },

  async submitCrmCustomerForm(customerId) {
    const isProspect = document.getElementById('crm-cust-stage')?.value === 'prospect';
    const payload = {
      name: document.getElementById('crm-cust-name')?.value,
      classification: document.getElementById('crm-cust-class')?.value,
      customer_type: document.getElementById('crm-cust-type')?.value,
      is_prospect: isProspect,
      lifecycle_stage: document.getElementById('crm-cust-stage')?.value,
      industry: document.getElementById('crm-cust-industry')?.value,
      contact_person: document.getElementById('crm-cust-contact')?.value,
      phone: document.getElementById('crm-cust-phone')?.value,
      email: document.getElementById('crm-cust-email')?.value,
      ntn: document.getElementById('crm-cust-ntn')?.value,
      strn: document.getElementById('crm-cust-strn')?.value,
      city: document.getElementById('crm-cust-city')?.value,
      address: document.getElementById('crm-cust-address')?.value
    };

    let res;
    if (customerId) {
      res = typeof API !== 'undefined' && API.updateCrmCustomer ? await API.updateCrmCustomer(customerId, payload) : await this.request('/crm/customers/' + customerId, 'PUT', payload);
    } else {
      res = typeof API !== 'undefined' && API.createCrmCustomer ? await API.createCrmCustomer(payload) : await this.request('/crm/customers', 'POST', payload);
    }

    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast(customerId ? '✓ Customer updated!' : '✓ New customer added!', 'success');
      this.switchCrmTab('customers');
    } else {
      showToast(res?.message || 'Failed to save customer', 'error');
    }
  },

  async archiveCrmCustomer(customerId, doArchive) {
    const action = doArchive ? 'archive' : 'restore';
    if (!confirm(`Are you sure you want to ${action} this customer record?`)) return;

    let res;
    if (doArchive) {
      res = typeof API !== 'undefined' && API.archiveCrmCustomer ? await API.archiveCrmCustomer(customerId) : await this.request('/crm/customers/' + customerId + '/archive', 'PUT');
    } else {
      res = typeof API !== 'undefined' && API.restoreCrmCustomer ? await API.restoreCrmCustomer(customerId) : await this.request('/crm/customers/' + customerId + '/restore', 'PUT');
    }

    if (res && res.success) {
      showToast(`✓ Customer record ${action}d successfully!`, 'success');
      this.switchCrmTab('customers');
    } else {
      showToast(res?.message || 'Action failed', 'error');
    }
  },

  // ==========================================================================
  // CRM DUPLICATE DETECTION & MERGING
  // ==========================================================================
  async openCrmDuplicateDetectionModal() {
    this.showDynamicModal('🔍 Scanning for Duplicate Customers...', '<div style="padding:20px; text-align:center;">Analyzing customer database across NTN, STRN, phone numbers, emails, and normalized legal names...</div>');

    let res;
    if (typeof API !== 'undefined' && API.detectCustomerDuplicates) {
      res = await API.detectCustomerDuplicates().catch(err => ({ success: false, message: err.message }));
    } else {
      res = await this.request('/crm/customers/detect-duplicates', 'GET');
    }

    const duplicates = res?.data || [];

    this.showDynamicModal(`🔍 Duplicate Detection Engine — ${duplicates.length} Potential Duplicates Found`, `
      <div style="margin-bottom:14px; font-size:0.83rem; color:#475569;">
        Review potential duplicate accounts identified by matching NTN, STRN, phone, email, or similar company titles. You can merge duplicate records into a single master identity while preserving all linked deals, invoices, and communication history.
      </div>

      <div class="table-responsive" style="max-height:400px; overflow-y:auto; margin-bottom:16px;">
        <table class="data-table">
          <thead>
            <tr>
              <th>Primary Account</th>
              <th>Duplicate Candidate</th>
              <th>Detection Reason</th>
              <th>Matched Value</th>
              <th style="text-align:center;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${duplicates.length === 0 ? `
              <tr><td colspan="5" style="text-align:center; padding:24px; color:#059669; font-weight:700;">
                ✓ 0 Duplicates Detected! Customer database is clean and normalized.
              </td></tr>
            ` : duplicates.map(d => `
              <tr>
                <td>
                  <div style="font-weight:700; color:#0f172a;">${escapeHtml(d.name)}</div>
                  <div style="font-size:0.72rem; color:#64748b;">${escapeHtml(d.phone || '')}</div>
                </td>
                <td>
                  <div style="font-weight:700; color:#dc2626;">${escapeHtml(d.duplicate_name)}</div>
                  <div style="font-size:0.72rem; color:#64748b;">${escapeHtml(d.duplicate_phone || '')}</div>
                </td>
                <td>
                  <span class="badge" style="background:#fee2e2; color:#991b1b; font-weight:700;">${escapeHtml(d.match_reason)}</span>
                </td>
                <td style="font-family:monospace; font-size:0.75rem;">
                  ${escapeHtml(d.matched_value || '')}
                </td>
                <td style="text-align:center;">
                  <button class="primary-btn" style="padding:4px 10px; font-size:0.75rem; background:#7c3aed;" onclick="ModularERP.openCrmMergeModal('${d.id}', '${d.duplicate_id}', '${escapeHtml(d.duplicate_name)}')">
                    🔀 Merge Into Master
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="modal-footer">
        <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Close</button>
      </div>
    `);
  },

  openCrmMergeModal(primaryId, duplicateId, duplicateName) {
    this.showDynamicModal(`🔀 Merge Customer Records into Master`, `
      <div style="padding:8px 0;">
        <div style="background:#fef3c7; border:1px solid #fde68a; border-radius:8px; padding:12px; margin-bottom:14px; font-size:0.83rem; color:#92400e;">
          ⚠️ <strong>Merge Warning:</strong> All contacts, addresses, activities, deals, tender quotations, and invoices attached to <strong>${escapeHtml(duplicateName)}</strong> will be re-linked to the primary account. The duplicate record will be archived with audit reference.
        </div>
        <p style="font-size:0.88rem; color:#1e293b; margin-bottom:14px;">
          Are you sure you want to proceed with merging this duplicate account?
        </p>
        <div class="modal-footer">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="button" class="primary-btn" style="background:#7c3aed;" onclick="ModularERP.submitCrmMerge('${primaryId}', '${duplicateId}')">Confirm & Merge Records</button>
        </div>
      </div>
    `);
  },

  async submitCrmMerge(primaryId, duplicateId) {
    let res;
    if (typeof API !== 'undefined' && API.mergeCustomers) {
      res = await API.mergeCustomers({ primary_customer_id: primaryId, duplicate_customer_id: duplicateId });
    } else {
      res = await this.request('/crm/customers/merge', 'POST', { primary_customer_id: primaryId, duplicate_customer_id: duplicateId });
    }

    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Customer records successfully merged!', 'success');
      this.switchCrmTab('customers');
    } else {
      showToast(res?.message || 'Merge failed', 'error');
    }
  },

  // ==========================================================================
  // CUSTOMER IMPORT & EXPORT
  // ==========================================================================
  openCrmImportModal() {
    this.showDynamicModal('📥 Import Customers & Prospects', `
      <form onsubmit="event.preventDefault(); ModularERP.submitCrmImport();">
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Duplicate Resolution Strategy</label>
          <select class="form-select" id="crm-import-strategy">
            <option value="skip">Skip duplicates (Safe - Preserve existing data)</option>
            <option value="update">Update existing records with new information</option>
            <option value="create_new">Always create new records</option>
          </select>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">Paste CSV or JSON Data</label>
          <textarea class="form-textarea" id="crm-import-data" rows="8" placeholder="name,phone,email,city,ntn,is_prospect
Packages Limited,042-3571234,info@packages.pk,Lahore,1234567-8,false"></textarea>
          <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">Accepted format: CSV header or JSON array with fields: <code>name, phone, email, city, ntn, classification, is_prospect</code></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">📥 Process Import</button>
        </div>
      </form>
    `);
  },

  async submitCrmImport() {
    const rawData = document.getElementById('crm-import-data')?.value?.trim();
    const strategy = document.getElementById('crm-import-strategy')?.value || 'skip';

    if (!rawData) {
      showToast('Please provide data to import.', 'warning');
      return;
    }

    let customers = [];
    try {
      if (rawData.startsWith('[') || rawData.startsWith('{')) {
        customers = JSON.parse(rawData);
        if (!Array.isArray(customers)) customers = [customers];
      } else {
        // Parse CSV
        const lines = rawData.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length < 2) throw new Error('CSV must have a header row and at least 1 data row');
        const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
        for (let i = 1; i < lines.length; i++) {
          const vals = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
          const row = {};
          headers.forEach((h, idx) => {
            row[h] = vals[idx] || '';
          });
          if (row.name) customers.push(row);
        }
      }
    } catch (err) {
      showToast('Data parsing error: ' + err.message, 'error');
      return;
    }

    let res;
    if (typeof API !== 'undefined' && API.importCrmCustomers) {
      res = await API.importCrmCustomers({ customers, duplicate_strategy: strategy });
    } else {
      res = await this.request('/crm/customers-import', 'POST', { customers, duplicate_strategy: strategy });
    }

    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast(`✓ Import complete! Added: ${res.inserted || 0}, Updated: ${res.updated || 0}, Skipped: ${res.skipped || 0}`, 'success');
      this.switchCrmTab('customers');
    } else {
      showToast(res?.message || 'Import failed', 'error');
    }
  },

  exportCrmCustomersCSV() {
    const custs = this._cachedCrmCustomers || [];
    if (custs.length === 0) {
      showToast('No customer records to export.', 'warning');
      return;
    }
    const headers = ['id', 'customer_code', 'name', 'customer_type', 'is_prospect', 'classification', 'industry', 'contact_person', 'phone', 'email', 'ntn', 'strn', 'city', 'address'];
    const rows = [headers.join(',')];
    custs.forEach(c => {
      const vals = headers.map(h => {
        let val = c[h] !== undefined && c[h] !== null ? String(c[h]) : '';
        val = val.replace(/"/g, '""');
        return `"${val}"`;
      });
      rows.push(vals.join(','));
    });

    const csvContent = '\uFEFF' + rows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `mashrue_customers_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('✓ Exported customer directory to CSV', 'success');
  },

  // ==========================================================================
  // OPPORTUNITIES / DEALS PIPELINE
  // ==========================================================================
  openCrmOpportunityModal(oppId = null) {
    const opps = this._cachedOpportunities || [];
    const o = opps.find(item => String(item.id) === String(oppId)) || {};
    const custs = this._cachedCrmCustomers || [];

    this.showDynamicModal(oppId ? '✏️ Edit Commercial Deal' : '💼 + Register Commercial Deal', `
      <form onsubmit="event.preventDefault(); ModularERP.submitCrmOpportunityForm('${oppId || ''}');">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Deal Title *</label>
            <input type="text" class="form-input" id="crm-opp-title" required value="${escapeHtml(o.title || '')}" placeholder="e.g. 500-unit Annual Supply Contract">
          </div>
          <div class="form-group">
            <label class="form-label">Customer / Client Account *</label>
            <select class="form-select" id="crm-opp-cust" required>
              ${custs.map(c => `
                <option value="${c.id}" ${String(o.customer_id) === String(c.id) ? 'selected' : ''}>${escapeHtml(c.name)}</option>
              `).join('')}
            </select>
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Deal Value (PKR) *</label>
            <input type="number" class="form-input" id="crm-opp-val" required value="${o.expected_value || 1000000}" min="0">
          </div>
          <div class="form-group">
            <label class="form-label">Pipeline Stage</label>
            <select class="form-select" id="crm-opp-stage">
              ${['Discovery', 'Qualification', 'Proposal', 'Negotiation', 'Won', 'Lost'].map(st => `
                <option value="${st}" ${(o.stage || 'Discovery') === st ? 'selected' : ''}>${st}</option>
              `).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Win Probability (%)</label>
            <input type="number" class="form-input" id="crm-opp-prob" value="${o.win_probability || 30}" min="0" max="100">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Expected Close Date</label>
            <input type="date" class="form-input" id="crm-opp-date" value="${o.expected_close_date ? o.expected_close_date.split('T')[0] : ''}">
          </div>
          <div class="form-group">
            <label class="form-label">Next Action</label>
            <input type="text" class="form-input" id="crm-opp-next" value="${escapeHtml(o.next_step || '')}" placeholder="e.g. Schedule commercial pricing review">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Deal Notes</label>
          <textarea class="form-textarea" id="crm-opp-notes" rows="2" placeholder="Specific technical requirements or terms...">${escapeHtml(o.notes || '')}</textarea>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save Deal</button>
        </div>
      </form>
    `);
  },

  async submitCrmOpportunityForm(oppId) {
    const payload = {
      title: document.getElementById('crm-opp-title')?.value,
      customer_id: document.getElementById('crm-opp-cust')?.value,
      expected_value: parseFloat(document.getElementById('crm-opp-val')?.value || 0),
      stage: document.getElementById('crm-opp-stage')?.value,
      win_probability: parseInt(document.getElementById('crm-opp-prob')?.value || 30, 10),
      expected_close_date: document.getElementById('crm-opp-date')?.value || null,
      next_step: document.getElementById('crm-opp-next')?.value,
      notes: document.getElementById('crm-opp-notes')?.value
    };

    let res;
    if (oppId) {
      res = typeof API !== 'undefined' && API.updateCrmOpportunity ? await API.updateCrmOpportunity(oppId, payload) : await this.request('/crm/opportunities/' + oppId, 'PUT', payload);
    } else {
      res = typeof API !== 'undefined' && API.createCrmOpportunity ? await API.createCrmOpportunity(payload) : await this.request('/crm/opportunities', 'POST', payload);
    }

    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast(oppId ? '✓ Deal updated!' : '✓ New deal created!', 'success');
      this.switchCrmTab('opportunities');
    } else {
      showToast(res?.message || 'Failed to save deal', 'error');
    }
  },

  async advanceOpportunityStage(oppId, newStage) {
    const probMap = { 'Discovery': 10, 'Qualification': 30, 'Proposal': 60, 'Negotiation': 80, 'Won': 100, 'Lost': 0 };
    const payload = { stage: newStage, win_probability: probMap[newStage] ?? 50 };

    let res;
    if (typeof API !== 'undefined' && API.updateCrmOpportunity) {
      res = await API.updateCrmOpportunity(oppId, payload);
    } else {
      res = await this.request('/crm/opportunities/' + oppId, 'PUT', payload);
    }

    if (res && res.success) {
      showToast(`Deal stage transitioned to "${newStage}"`, 'success');
      this.switchCrmTab('opportunities');
    }
  },

  async deleteCrmOpportunity(oppId, title) {
    if (!confirm(`Are you sure you want to delete deal "${title}"?`)) return;
    let res;
    if (typeof API !== 'undefined' && API.deleteCrmOpportunity) {
      res = await API.deleteCrmOpportunity(oppId);
    } else {
      res = await this.request('/crm/opportunities/' + oppId, 'DELETE');
    }
    if (res && res.success) {
      showToast('✓ Deal deleted', 'success');
      this.switchCrmTab('opportunities');
    }
  },

  // ==========================================================================
  // ACTIVITIES, TASKS & CALENDAR
  // ==========================================================================
  openCrmActivityModal(actId = null) {
    const custs = this._cachedCrmCustomers || [];
    const leads = this._cachedLeads || [];

    this.showDynamicModal('📞 Log Activity, Call or Schedule Task', `
      <form onsubmit="event.preventDefault(); ModularERP.submitCrmActivityForm('${actId || ''}');">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Link to Customer Master</label>
            <select class="form-select" id="crm-act-cust">
              <option value="">-- Or Select Prospective Lead Below --</option>
              ${custs.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Link to Sales Lead</label>
            <select class="form-select" id="crm-act-lead">
              <option value="">-- Optional Lead Link --</option>
              ${leads.map(l => `<option value="${l.id}">${escapeHtml(l.company_name)}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Activity Type *</label>
            <select class="form-select" id="crm-act-type" required>
              <option value="Phone Call">📞 Phone Call</option>
              <option value="In-Person Meeting">🤝 In-Person Meeting</option>
              <option value="Technical Site Visit">🏗️ Technical Site Visit</option>
              <option value="Proposal Follow-up">💬 Proposal Follow-up</option>
              <option value="Email">📧 Email</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Priority</label>
            <select class="form-select" id="crm-act-priority">
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Low">Low</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Due / Scheduled Date</label>
            <input type="date" class="form-input" id="crm-act-date" value="${new Date().toISOString().split('T')[0]}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Subject & Discussion *</label>
          <input type="text" class="form-input" id="crm-act-subject" required placeholder="e.g. Discussed technical delivery scope with Chief Engineer">
        </div>
        <div class="form-group">
          <label class="form-label">Outcome & Next Steps</label>
          <input type="text" class="form-input" id="crm-act-outcome" placeholder="e.g. Client requested revised quotation by Friday">
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save Activity Log</button>
        </div>
      </form>
    `);
  },

  async submitCrmActivityForm(actId) {
    const payload = {
      customer_id: document.getElementById('crm-act-cust')?.value || null,
      lead_id: document.getElementById('crm-act-lead')?.value || null,
      activity_type: document.getElementById('crm-act-type')?.value,
      priority: document.getElementById('crm-act-priority')?.value,
      due_date: document.getElementById('crm-act-date')?.value || null,
      subject: document.getElementById('crm-act-subject')?.value,
      outcome: document.getElementById('crm-act-outcome')?.value,
      status: 'Completed'
    };

    let res;
    if (typeof API !== 'undefined' && API.createCrmActivity) {
      res = await API.createCrmActivity(payload);
    } else {
      res = await this.request('/crm/activities', 'POST', payload);
    }

    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Activity logged successfully!', 'success');
      this.switchCrmTab('activities');
    }
  },

  async toggleActivityStatus(actId, currentStatus) {
    const newStatus = currentStatus === 'Completed' ? 'Pending' : 'Completed';
    let res;
    if (typeof API !== 'undefined' && API.updateCrmActivity) {
      res = await API.updateCrmActivity(actId, { status: newStatus });
    } else {
      res = await this.request('/crm/activities/' + actId, 'PUT', { status: newStatus });
    }
    if (res && res.success) {
      showToast(`Activity marked as ${newStatus}!`, 'success');
      this.switchCrmTab('activities');
    }
  },

  async deleteCrmActivity(actId) {
    if (!confirm('Are you sure you want to delete this activity log?')) return;
    let res;
    if (typeof API !== 'undefined' && API.deleteCrmActivity) {
      res = await API.deleteCrmActivity(actId);
    } else {
      res = await this.request('/crm/activities/' + actId, 'DELETE');
    }
    if (res && res.success) {
      showToast('✓ Activity deleted', 'success');
      this.switchCrmTab('activities');
    }
  },

  // ==========================================================================
  // SUPPORT CASES & SLA ENGINE
  // ==========================================================================
  openCrmCaseModal(caseId = null) {
    const custs = this._cachedCrmCustomers || [];

    this.showDynamicModal('🎫 + Open Customer Support Ticket', `
      <form onsubmit="event.preventDefault(); ModularERP.submitCrmCaseForm();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Client Account *</label>
            <select class="form-select" id="crm-case-cust" required>
              ${custs.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Category *</label>
            <select class="form-select" id="crm-case-cat" required>
              <option value="Technical Issue">Technical Issue</option>
              <option value="Billing Inquiry">Billing Inquiry</option>
              <option value="Delivery Delay">Delivery Delay</option>
              <option value="Contract Amendment">Contract Amendment</option>
              <option value="Product Complaint">Product Complaint</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Priority</label>
            <select class="form-select" id="crm-case-priority">
              <option value="Medium">Medium (48h SLA)</option>
              <option value="High">High (24h SLA)</option>
              <option value="Urgent">Urgent (8h SLA)</option>
              <option value="Low">Low (72h SLA)</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">SLA Target Hours</label>
            <input type="number" class="form-input" id="crm-case-sla" value="48" min="1">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Subject *</label>
          <input type="text" class="form-input" id="crm-case-subject" required placeholder="Brief summary of customer issue">
        </div>
        <div class="form-group">
          <label class="form-label">Detailed Description</label>
          <textarea class="form-textarea" id="crm-case-desc" rows="3" placeholder="Provide full context, affected orders, or incident details..."></textarea>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">🎫 Open Ticket</button>
        </div>
      </form>
    `);
  },

  async submitCrmCaseForm() {
    const payload = {
      customer_id: document.getElementById('crm-case-cust')?.value,
      category: document.getElementById('crm-case-cat')?.value,
      priority: document.getElementById('crm-case-priority')?.value,
      sla_target_hours: parseInt(document.getElementById('crm-case-sla')?.value || 48, 10),
      subject: document.getElementById('crm-case-subject')?.value,
      description: document.getElementById('crm-case-desc')?.value
    };

    let res;
    if (typeof API !== 'undefined' && API.createCrmCase) {
      res = await API.createCrmCase(payload);
    } else {
      res = await this.request('/crm/cases', 'POST', payload);
    }

    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Support ticket opened!', 'success');
      this.switchCrmTab('cases');
    } else {
      showToast(res?.message || 'Failed to open case', 'error');
    }
  },

  async openCrmCaseDetailModal(caseId) {
    const cases = this._cachedCases || [];
    const c = cases.find(item => String(item.id) === String(caseId)) || { id: caseId };

    // Fetch comments
    let comments = [];
    try {
      const res = await this.request('/crm/cases/' + caseId, 'GET');
      if (res && res.data && res.data.comments) comments = res.data.comments;
    } catch (e) {}

    const isBreached = c.sla_breached || (c.status !== 'Closed' && c.sla_due_date && new Date(c.sla_due_date) < new Date());

    this.showDynamicModal(`🎫 Support Case ${escapeHtml(c.ticket_number || 'CASE')}`, `
      <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
          <span style="font-size:1rem; font-weight:800; color:#0f172a;">${escapeHtml(c.subject || 'Case')}</span>
          <span class="badge" style="background:${isBreached ? '#dc2626' : '#0284c7'}; color:white;">
            ${isBreached ? '⚠️ SLA Breached' : '✓ SLA Active'}
          </span>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:0.8rem; color:#475569;">
          <div><strong>Customer:</strong> ${escapeHtml(c.customer_name || 'General')}</div>
          <div><strong>Category:</strong> ${escapeHtml(c.category || 'General')}</div>
          <div><strong>Priority:</strong> ${escapeHtml(c.priority || 'Medium')}</div>
          <div><strong>SLA Due Date:</strong> ${c.sla_due_date ? formatDateDDMMYYYY(c.sla_due_date) : 'N/A'}</div>
        </div>
        ${c.description ? `
          <div style="margin-top:8px; padding-top:8px; border-top:1px dashed #e2e8f0; font-size:0.82rem; color:#334155;">
            <strong>Issue Details:</strong> ${escapeHtml(c.description)}
          </div>
        ` : ''}
      </div>

      <!-- Status Update Toolbar -->
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:8px 12px;">
        <span style="font-size:0.83rem; font-weight:700;">Workflow Status:</span>
        <div style="display:flex; gap:6px;">
          ${['Open', 'In Progress', 'Resolved', 'Closed'].map(st => `
            <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem; ${c.status === st ? 'background:#0284c7; color:white; font-weight:800;' : ''}" onclick="ModularERP.updateCrmCaseStatus('${caseId}', '${st}')">
              ${st}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Comments Timeline -->
      <div style="font-weight:700; font-size:0.88rem; color:#0f172a; margin-bottom:6px;">💬 Resolution Timeline & Notes</div>
      <div style="max-height:160px; overflow-y:auto; margin-bottom:14px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px;">
        ${comments.length === 0 ? `
          <div style="color:#94a3b8; font-size:0.75rem; text-align:center; padding:10px;">No comments added yet. Add note below.</div>
        ` : comments.map(cm => `
          <div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid #e2e8f0; font-size:0.78rem;">
            <div style="display:flex; justify-content:space-between; color:#64748b; font-size:0.7rem;">
              <span>${escapeHtml(cm.author_name || 'Agent')}</span>
              <span>${formatDateDDMMYYYY(cm.created_at)}</span>
            </div>
            <div style="color:#1e293b; margin-top:2px;">${escapeHtml(cm.comment)}</div>
          </div>
        `).join('')}
      </div>

      <!-- Add Comment Form -->
      <form onsubmit="event.preventDefault(); ModularERP.submitCrmCaseComment('${caseId}');">
        <div class="form-group" style="margin-bottom:10px;">
          <input type="text" class="form-input" id="crm-comment-text" required placeholder="Add resolution note or client interaction...">
        </div>
        <div class="modal-footer" style="padding-top:8px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Close</button>
          <button type="submit" class="primary-btn">💬 Post Comment</button>
        </div>
      </form>
    `);
  },

  async updateCrmCaseStatus(caseId, newStatus) {
    let res;
    if (typeof API !== 'undefined' && API.updateCrmCase) {
      res = await API.updateCrmCase(caseId, { status: newStatus });
    } else {
      res = await this.request('/crm/cases/' + caseId, 'PUT', { status: newStatus });
    }
    if (res && res.success) {
      showToast(`Case status updated to ${newStatus}`, 'success');
      closeModal('modal-erp-dynamic');
      this.switchCrmTab('cases');
    }
  },

  async submitCrmCaseComment(caseId) {
    const comment = document.getElementById('crm-comment-text')?.value?.trim();
    if (!comment) return;

    let res;
    if (typeof API !== 'undefined' && API.addCrmCaseComment) {
      res = await API.addCrmCaseComment(caseId, { comment });
    } else {
      res = await this.request('/crm/cases/' + caseId + '/comments', 'POST', { comment });
    }

    if (res && res.success) {
      showToast('✓ Comment added to ticket', 'success');
      this.openCrmCaseDetailModal(caseId);
    }
  },

  async deleteCrmCase(caseId, ticketNo) {
    if (!confirm(`Are you sure you want to delete case ${ticketNo}?`)) return;
    let res;
    if (typeof API !== 'undefined' && API.deleteCrmCase) {
      res = await API.deleteCrmCase(caseId);
    } else {
      res = await this.request('/crm/cases/' + caseId, 'DELETE');
    }
    if (res && res.success) {
      showToast('✓ Support ticket deleted', 'success');
      this.switchCrmTab('cases');
    }
  },

  // ==========================================================================
  // COMPATIBLE LEADS HANDLERS
  // ==========================================================================
  openCrmLeadModal() {
    this.showDynamicModal('🤝 Register New B2B Sales Lead', `
      <form onsubmit="event.preventDefault(); ModularERP.submitCrmLeadForm();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Company / Organization Name *</label>
            <input type="text" class="form-input" id="erp-crm-comp" required placeholder="e.g. Packages Limited / Fauji Fertilizer">
          </div>
          <div class="form-group">
            <label class="form-label">Lead Source</label>
            <select class="form-select" id="erp-crm-source">
              <option value="PPRA Radar">PPRA Radar</option>
              <option value="Direct Visit">Direct Visit</option>
              <option value="Referral">Referral</option>
              <option value="Website / RFQ">Website / Inbound RFQ</option>
              <option value="Exhibition">Trade Exhibition</option>
            </select>
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Contact Person *</label>
            <input type="text" class="form-input" id="erp-crm-contact" required placeholder="e.g. Engr. Salman Tariq">
          </div>
          <div class="form-group">
            <label class="form-label">Phone / WhatsApp *</label>
            <input type="text" class="form-input" id="erp-crm-phone" required placeholder="0300-1234567">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="erp-crm-email" placeholder="procurement@client.pk">
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">City</label>
            <input type="text" class="form-input" id="erp-crm-city" value="Lahore">
          </div>
          <div class="form-group">
            <label class="form-label">Estimated Deal Value (PKR) *</label>
            <input type="number" class="form-input" id="erp-crm-val" required value="2500000" min="0">
          </div>
          <div class="form-group">
            <label class="form-label">Win Probability (%)</label>
            <input type="number" class="form-input" id="erp-crm-prob" value="50" min="0" max="100">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Requirement Notes</label>
          <textarea class="form-textarea" id="erp-crm-notes" rows="2" placeholder="Detail equipment or contract requirements..."></textarea>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save Lead</button>
        </div>
      </form>
    `);
  },

  async submitCrmLeadForm() {
    const payload = {
      company_name: document.getElementById('erp-crm-comp')?.value,
      lead_source: document.getElementById('erp-crm-source')?.value,
      contact_name: document.getElementById('erp-crm-contact')?.value,
      contact_phone: document.getElementById('erp-crm-phone')?.value,
      contact_email: document.getElementById('erp-crm-email')?.value,
      city: document.getElementById('erp-crm-city')?.value,
      estimated_deal_value: parseFloat(document.getElementById('erp-crm-val')?.value || 0),
      win_probability: parseInt(document.getElementById('erp-crm-prob')?.value || 50, 10),
      notes: document.getElementById('erp-crm-notes')?.value,
      pipeline_stage: 'New Lead'
    };
    const res = typeof API !== 'undefined' && API.createCrmLead ? await API.createCrmLead(payload) : await this.request('/crm/leads', 'POST', payload, 'erp_crm_leads');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ New CRM Lead added to pipeline!', 'success');
      this.switchCrmTab('leads');
    }
  },

  async updateLeadStage(id, newStage) {
    const probMap = { 'New Lead': 20, 'Contacted': 35, 'Qualification': 50, 'Proposal Sent': 75, 'Won': 100, 'Lost': 0 };
    if (typeof API !== 'undefined' && API.updateCrmLead) {
      await API.updateCrmLead(id, { pipeline_stage: newStage, win_probability: probMap[newStage] ?? 50 });
    } else {
      await this.request(`/crm/leads/${id}`, 'PUT', { pipeline_stage: newStage, win_probability: probMap[newStage] ?? 50 });
    }
    showToast(`Lead stage updated to "${newStage}"`, 'success');
    this.switchCrmTab('leads');
  },

  async convertLeadToCustomer(id) {
    let res;
    if (typeof API !== 'undefined' && API.convertCrmLead) {
      res = await API.convertCrmLead(id, {});
    } else {
      res = await this.request(`/crm/leads/${id}/convert`, 'POST');
    }
    if (res && res.success) {
      showToast(res.message || 'Lead converted to Customer Directory & Commercial Deal!', 'success');
      this.switchCrmTab('customers');
    }
  },

  // ==========================================================================
  // 4. MODULE 6: FINANCIAL ACCOUNTING, COA & DOUBLE-ENTRY GENERAL LEDGER ('accounting')
  // ==========================================================================
  async renderAccountingHTML() {
    if (window.FinanceModule && typeof FinanceModule.renderHTML === 'function') {
      return await FinanceModule.renderHTML();
    }
    const [coaRes, jvRes] = await Promise.all([
      this.request('/finance/coa', 'GET', null, 'erp_finance_coa'),
      this.request('/finance/journals', 'GET', null, 'erp_finance_journals')
    ]);

    let coa = coaRes.data || [];
    const journals = jvRes.data || [];
    this._cachedCoa = coa;

    const totalDebitAll = coa.reduce((s, a) => s + parseFloat(a.total_debit || 0), 0);
    const totalCreditAll = coa.reduce((s, a) => s + parseFloat(a.total_credit || 0), 0);

    return `
      <div class="kpi-grid" style="margin-bottom: 18px;">
        <div class="kpi-card">
          <div class="kpi-label">📒 Chart of Accounts (COA)</div>
          <div class="kpi-value" style="color:#0284c7;">${coa.length} Accounts</div>
          <div class="kpi-trend positive">Assets, Liabilities, Equity, Revenue, Expense</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">⚖️ Trial Balance Debit</div>
          <div class="kpi-value" style="color:#059669;">${formatCurrency(totalDebitAll)}</div>
          <div class="kpi-trend">Balanced Double-Entry Ledger</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">⚖️ Trial Balance Credit</div>
          <div class="kpi-value" style="color:#059669;">${formatCurrency(totalCreditAll)}</div>
          <div class="kpi-trend">${Math.abs(totalDebitAll - totalCreditAll) < 1 ? '✓ 100% In Balance' : 'Variance Detected'}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">🧾 Posted Journal Vouchers</div>
          <div class="kpi-value" style="color:#7c3aed;">${journals.length} Vouchers</div>
          <div class="kpi-trend">Auto-synced + Manual JVs</div>
        </div>
      </div>

      <!-- Chart of Accounts & Live Trial Balance -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:800;">📒 Standard Chart of Accounts (COA) & Live Trial Balance</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">IFRS / Pakistan ICAP compliant hierarchical general ledger accounts</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="secondary-btn" style="border-color:#0284c7; color:#0284c7; font-weight:700;" onclick="ModularERP.syncLedgerFromTransactions()">
              🔄 Auto-Sync Invoices, Payments & Expenses to GL
            </button>
            <button class="secondary-btn" onclick="ModularERP.openAddCoaModal()">➕ Add Account</button>
            <button class="primary-btn" onclick="ModularERP.openPostJournalModal()">📝 + Post Journal Voucher (JV)</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-coa-ledger">
              <thead>
                <tr>
                  <th>GL Code</th>
                  <th>Account Title</th>
                  <th>Classification</th>
                  <th>Sub-Type</th>
                  <th style="text-align:right;">Total Debit (PKR)</th>
                  <th style="text-align:right;">Total Credit (PKR)</th>
                  <th style="text-align:right;">Net Closing Balance</th>
                </tr>
              </thead>
              <tbody>
                ${coa.map(acc => {
      const dr = parseFloat(acc.total_debit || 0);
      const cr = parseFloat(acc.total_credit || 0);
      const isDebitNormal = (acc.account_type === 'Asset' || acc.account_type === 'Expense');
      const net = isDebitNormal ? (dr - cr) : (cr - dr);
      return `
                    <tr>
                      <td style="font-weight:800; font-family:monospace; color:#0284c7;">${escapeHtml(acc.account_code)}</td>
                      <td style="font-weight:700; color:#0f172a;">${escapeHtml(acc.account_name)}</td>
                      <td><span class="badge" style="background:#f1f5f9; color:#334155; font-weight:700;">${escapeHtml(acc.account_type)}</span></td>
                      <td style="color:#64748b; font-size:0.8rem;">${escapeHtml(acc.account_sub_type || 'Standard')}</td>
                      <td style="text-align:right; font-family:monospace; font-weight:600;">${formatCurrency(dr)}</td>
                      <td style="text-align:right; font-family:monospace; font-weight:600;">${formatCurrency(cr)}</td>
                      <td style="text-align:right; font-family:monospace; font-weight:800; color:${net >= 0 ? '#0f172a' : '#dc2626'};">
                        ${formatCurrency(Math.abs(net))} ${net >= 0 ? (isDebitNormal ? 'Dr' : 'Cr') : (isDebitNormal ? 'Cr' : 'Dr')}
                      </td>
                    </tr>
                  `;
    }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- General Journal Vouchers Table -->
      <div class="card">
        <div class="card-header">
          <h3 style="margin:0; font-size:1rem; font-weight:700;">📝 General Journal Entries (Double-Entry Voucher Register)</h3>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-journal-entries">
              <thead>
                <tr>
                  <th>Voucher #</th>
                  <th>Date</th>
                  <th>Source Type</th>
                  <th>Narration & Line Breakdown</th>
                  <th style="text-align:right;">Total Debit</th>
                  <th style="text-align:right;">Total Credit</th>
                  <th style="text-align:center;">Print</th>
                </tr>
              </thead>
              <tbody>
                ${journals.length === 0 ? `
                  <tr><td colspan="7" style="text-align:center; padding:22px; color:#64748b;">No journal entries posted yet. Click <strong>🔄 Auto-Sync Invoices, Payments & Expenses to GL</strong> or <strong>+ Post Journal Voucher</strong>.</td></tr>
                ` : journals.map(j => `
                  <tr>
                    <td style="font-weight:700; font-family:monospace; color:#0284c7;">${escapeHtml(j.entry_number)}</td>
                    <td>${formatDateDDMMYYYY(j.entry_date)}</td>
                    <td><span class="badge badge-submitted">${escapeHtml(j.reference_type || 'Manual Voucher')}</span></td>
                    <td>
                      <div style="font-weight:700; color:#0f172a; margin-bottom:4px;">${escapeHtml(j.narration)}</div>
                      ${Array.isArray(j.lines) ? j.lines.map(l => `
                        <div style="font-size:0.75rem; color:#475569; font-family:monospace;">
                          • [${escapeHtml(l.account_code || '')}] ${escapeHtml(l.account_name || '')}: ${parseFloat(l.debit || 0) > 0 ? `Dr ${formatCurrency(l.debit)}` : `Cr ${formatCurrency(l.credit)}`}
                        </div>
                      `).join('') : ''}
                    </td>
                    <td style="text-align:right; font-family:monospace; font-weight:700; color:#059669;">${formatCurrency(j.total_debit)}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:700; color:#059669;">${formatCurrency(j.total_credit)}</td>
                    <td style="text-align:center;">
                      <button class="secondary-btn" style="padding:4px 9px; font-size:0.75rem;" onclick='if(window.TemplatesEngine && TemplatesEngine.printJournalVoucher){ TemplatesEngine.printJournalVoucher(${JSON.stringify(j).replace(/'/g, "&#39;")}); } else { window.print(); }' title="Print Formal Double-Entry Journal Voucher (JV)">
                        🖨️ JV
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  async syncLedgerFromTransactions() {
    const res = await this.request('/finance/sync-ledger', 'POST', {
      business_profile_id: State.currentBusinessProfileId
    });
    if (res && res.success) {
      showToast(res.message, 'success');
      renderActiveView();
    }
  },

  openAddCoaModal() {
    this.showDynamicModal('📒 Add New Chart of Accounts (GL) Head', `
      <form onsubmit="event.preventDefault(); ModularERP.submitAddCoaForm();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">GL Account Code *</label>
            <input type="text" class="form-input" id="erp-coa-code" required placeholder="e.g. 1025">
          </div>
          <div class="form-group">
            <label class="form-label">Account Classification *</label>
            <select class="form-select" id="erp-coa-type" required>
              <option value="Asset">Asset</option>
              <option value="Liability">Liability</option>
              <option value="Equity">Equity</option>
              <option value="Revenue">Revenue</option>
              <option value="Expense">Expense</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Account Title *</label>
          <input type="text" class="form-input" id="erp-coa-name" required placeholder="e.g. Meezan Bank Retention Money Account">
        </div>
        <div class="form-group">
          <label class="form-label">Sub-Type</label>
          <input type="text" class="form-input" id="erp-coa-sub" value="Current Asset">
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save GL Account</button>
        </div>
      </form>
    `);
  },

  async submitAddCoaForm() {
    const payload = {
      account_code: document.getElementById('erp-coa-code')?.value,
      account_name: document.getElementById('erp-coa-name')?.value,
      account_type: document.getElementById('erp-coa-type')?.value,
      account_sub_type: document.getElementById('erp-coa-sub')?.value
    };
    const res = await this.request('/finance/coa', 'POST', payload, 'erp_finance_coa');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ GL Account added to Chart of Accounts!', 'success');
      renderActiveView();
    }
  },

  openPostJournalModal() {
    const coaOpts = (this._cachedCoa || []).map(a => `<option value="${a.id}">[${escapeHtml(a.account_code)}] ${escapeHtml(a.account_name)}</option>`).join('');
    this.showDynamicModal('📝 Post Balanced Double-Entry Journal Voucher (JV)', `
      <form onsubmit="event.preventDefault(); ModularERP.submitJournalForm();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Voucher Date *</label>
            <input type="date" class="form-input" id="erp-jv-date" required value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label class="form-label">Amount (PKR) *</label>
            <input type="number" class="form-input" id="erp-jv-amount" required min="1" value="100000">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Debit Account (Dr) *</label>
            <select class="form-select" id="erp-jv-dr" required>${coaOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Credit Account (Cr) *</label>
            <select class="form-select" id="erp-jv-cr" required>${coaOpts}</select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Voucher Narration / Particulars *</label>
          <input type="text" class="form-input" id="erp-jv-narr" required placeholder="e.g. Earnest money CDR issued from corporate bank account">
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">📝 Post Balanced Voucher</button>
        </div>
      </form>
    `);
  },

  async submitJournalForm() {
    const drAcc = document.getElementById('erp-jv-dr')?.value;
    const crAcc = document.getElementById('erp-jv-cr')?.value;
    const amt = parseFloat(document.getElementById('erp-jv-amount')?.value || 0);
    const narr = document.getElementById('erp-jv-narr')?.value;
    const payload = {
      entry_date: normalizeDateToISO(document.getElementById('erp-jv-date')?.value),
      reference_type: 'Manual Voucher',
      narration: narr,
      lines: [
        { account_id: drAcc, line_description: narr, debit: amt, credit: 0 },
        { account_id: crAcc, line_description: narr, debit: 0, credit: amt }
      ]
    };
    const res = await this.request('/finance/journals', 'POST', payload, 'erp_finance_journals');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast(res.message || 'Journal Voucher posted!', 'success');
      renderActiveView();
    }
  },

  // ==========================================================================
  // 5. MODULE 10: TAXATION & REGULATORY COMPLIANCE - MASHRUE TAXGUARD ('tax-compliance')
  // ==========================================================================
  async renderTaxComplianceHTML() {
    if (window.TaxComplianceModule && typeof TaxComplianceModule.renderHTML === 'function') {
      return await TaxComplianceModule.renderHTML();
    }
    const [jurRes, whtRulesRes, cprRes, retRes] = await Promise.all([
      this.request('/tax/jurisdictions', 'GET', null, 'erp_tax_jurisdictions'),
      this.request('/tax/wht-rules', 'GET', null, 'erp_tax_wht_rules'),
      this.request('/tax/cpr-deductions', 'GET', null, 'erp_tax_cprs'),
      this.request('/tax/returns', 'GET', null, 'erp_tax_returns')
    ]);

    const jurisdictions = jurRes.data || [];
    const whtRules = whtRulesRes.data || [];
    const cprs = cprRes.data || [];
    const returns = retRes.data || [];
    this._cachedReturns = returns;

    const totalWhtClaimable = cprs.reduce((s, c) => s + parseFloat(c.wht_amount || 0), 0);

    return `
      <div class="kpi-grid" style="margin-bottom: 18px;">
        <div class="kpi-card">
          <div class="kpi-label">🇵🇰 Tax Jurisdictions Active</div>
          <div class="kpi-value" style="color:#0284c7;">${jurisdictions.length || 5} Authorities</div>
          <div class="kpi-trend positive">FBR GST 18%, PRA 16%, SRB 13%, KPRA 15%</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">📜 WHT u/s 153 CPR Ledger</div>
          <div class="kpi-value" style="color:#059669;">${formatCurrency(totalWhtClaimable)}</div>
          <div class="kpi-trend">${cprs.length} Withholding CPR Certificates</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">📊 Monthly FBR Iris Returns</div>
          <div class="kpi-value" style="color:#7c3aed;">${returns.length} Filings</div>
          <div class="kpi-trend">Annex-C (Output) & Annex-A (Input)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">⚖️ Section 153 / 149 Rules</div>
          <div class="kpi-value" style="color:#d97706;">${whtRules.length || 6} Slabs</div>
          <div class="kpi-trend">Filer vs Non-Filer ATL statutory rates</div>
        </div>
      </div>

      <!-- Annex-C & Monthly Return Compiler Card -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:800;">🇵🇰 FBR Iris Monthly Sales Tax Return (Annex-C Output & Annex-A Input Compiler)</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Automatically aggregates Sales Invoices (Output Tax), Supplier POs (Input Tax) & WHT CPRs for 1-click FBR Iris filing</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="secondary-btn" onclick="ModularERP.openLogCprModal()">📜 + Log WHT CPR Certificate</button>
            <button class="primary-btn" style="background:#059669;" onclick="ModularERP.compileMonthlyTaxReturn()">⚡ Compile Current Month Annex-C & Annex-A</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-tax-returns">
              <thead>
                <tr>
                  <th>Tax Period</th>
                  <th>Jurisdiction</th>
                  <th style="text-align:right;">Taxable Sales</th>
                  <th style="text-align:right;">Output Tax (Annex-C)</th>
                  <th style="text-align:right;">Input Tax (Annex-A)</th>
                  <th style="text-align:right;">Net GST Payable</th>
                  <th style="text-align:center;">Export for Iris</th>
                </tr>
              </thead>
              <tbody>
                ${returns.length === 0 ? `
                  <tr><td colspan="7" style="text-align:center; padding:22px; color:#64748b;">No monthly returns compiled yet. Click <strong>⚡ Compile Current Month Annex-C & Annex-A</strong> to generate your FBR Iris return from live invoices.</td></tr>
                ` : returns.map((r, idx) => `
                  <tr>
                    <td style="font-weight:800; color:#0f172a;">📅 ${r.tax_month}/${r.tax_year}</td>
                    <td><span class="badge" style="background:#dcfce7; color:#166534; font-weight:700;">${escapeHtml(r.jurisdiction_code)}</span></td>
                    <td style="text-align:right; font-family:monospace;">${formatCurrency(r.total_sales_value)}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:700; color:#dc2626;">${formatCurrency(r.total_output_tax)}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:700; color:#059669;">${formatCurrency(r.total_input_tax)}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:800; color:#0284c7;">${formatCurrency(r.net_tax_payable)}</td>
                    <td style="text-align:center;">
                      <button class="secondary-btn" style="padding:4px 10px; font-size:0.75rem;" onclick="ModularERP.exportAnnexCCsv(${idx})">
                        📥 Download Annex-C CSV
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Withholding Tax (WHT u/s 153) & CPR Certificate Registry -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header">
          <h3 style="margin:0; font-size:1rem; font-weight:700;">📜 Withholding Tax (WHT u/s 153) & Bank CPR Certificate Tracker</h3>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-wht-cprs">
              <thead>
                <tr>
                  <th>CPR Number & Date</th>
                  <th>Deducting Agency / Party</th>
                  <th>Tax Section</th>
                  <th style="text-align:right;">Gross Taxable</th>
                  <th style="text-align:center;">WHT Rate</th>
                  <th style="text-align:right;">WHT Deducted (PKR)</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${cprs.length === 0 ? `
                  <tr><td colspan="7" style="text-align:center; padding:20px; color:#64748b;">No WHT CPR certificates logged yet. Click <strong>📜 + Log WHT CPR Certificate</strong> to track tax deducted at source by procuring departments.</td></tr>
                ` : cprs.map(c => `
                  <tr>
                    <td>
                      <div style="font-weight:700; font-family:monospace; color:#0284c7;">${escapeHtml(c.cpr_number)}</div>
                      <div style="font-size:0.73rem; color:#64748b;">${formatDateDDMMYYYY(c.cpr_date)}</div>
                    </td>
                    <td style="font-weight:700;">${escapeHtml(c.party_name || 'Procuring Agency')}</td>
                    <td><span class="badge" style="background:#f1f5f9; color:#334155;">${escapeHtml(c.section_code)}</span></td>
                    <td style="text-align:right; font-family:monospace;">${formatCurrency(c.taxable_amount)}</td>
                    <td style="text-align:center; font-weight:700;">${c.wht_rate}%</td>
                    <td style="text-align:right; font-family:monospace; font-weight:800; color:#059669;">${formatCurrency(c.wht_amount)}</td>
                    <td><span class="badge badge-won">${escapeHtml(c.status)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Statutory Tax Jurisdictions & Section 153 Rates Reference -->
      <div class="card">
        <div class="card-header">
          <h3 style="margin:0; font-size:1rem; font-weight:700;">⚖️ Configured Federal & Provincial Tax Jurisdictions & Section 153 WHT Rates</h3>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Code / Section</th>
                  <th>Authority / Statutory Description</th>
                  <th>Category</th>
                  <th style="text-align:center;">Standard / Filer Rate</th>
                  <th style="text-align:center;">Further / Non-Filer Rate</th>
                </tr>
              </thead>
              <tbody>
                ${jurisdictions.map(j => `
                  <tr>
                    <td style="font-weight:800; font-family:monospace; color:#0284c7;">${escapeHtml(j.jurisdiction_code)}</td>
                    <td style="font-weight:700;">${escapeHtml(j.authority_name)}</td>
                    <td>${escapeHtml(j.tax_type)}</td>
                    <td style="text-align:center; font-weight:800; color:#059669;">${j.standard_rate}%</td>
                    <td style="text-align:center; font-weight:700; color:#d97706;">+${j.further_tax_rate || 0}%</td>
                  </tr>
                `).join('')}
                ${whtRules.map(w => `
                  <tr>
                    <td style="font-weight:800; font-family:monospace; color:#7c3aed;">${escapeHtml(w.section_code)}</td>
                    <td style="font-weight:600;">${escapeHtml(w.description || w.section_code)}</td>
                    <td>Withholding Income Tax</td>
                    <td style="text-align:center; font-weight:800; color:#059669;">${w.filer_rate}% (ATL Filer)</td>
                    <td style="text-align:center; font-weight:800; color:#dc2626;">${w.non_filer_rate}% (Non-Filer)</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  async compileMonthlyTaxReturn() {
    const now = new Date();
    const res = await this.request('/tax/returns/generate', 'POST', {
      tax_month: now.getMonth() + 1,
      tax_year: now.getFullYear(),
      jurisdiction_code: 'FBR_FED',
      business_profile_id: State.currentBusinessProfileId
    }, 'erp_tax_returns');
    if (res && res.success) {
      showToast(res.message || 'Monthly Annex-C & Annex-A compiled!', 'success');
      renderActiveView();
    }
  },

  exportAnnexCCsv(idx) {
    const ret = (this._cachedReturns || [])[idx];
    if (!ret) return;
    const rows = Array.isArray(ret.annex_c_json) ? ret.annex_c_json : [];
    let csv = 'Invoice No,Invoice Date,FBR Invoice No,Buyer Name,Buyer NTN,Buyer STRN,HS Code,Tax Rate %,Value Excl Tax,Sales Tax Amount,Total Value\n';
    rows.forEach(r => {
      csv += `"${r.invoice_no || ''}","${r.invoice_date || ''}","${r.fbr_invoice_no || ''}","${r.buyer_name || ''}","${r.buyer_ntn || ''}","${r.buyer_strn || ''}","${r.hs_code || '8504.4090'}",${r.tax_rate || 18},${r.value_excl_tax || 0},${r.sales_tax_amount || 0},${r.total_value || 0}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FBR_Iris_Annex_C_${ret.tax_year}_${ret.tax_month}.csv`;
    a.click();
    showToast('✓ FBR Iris Annex-C CSV downloaded!', 'success');
  },

  openLogCprModal() {
    this.showDynamicModal('📜 Log Withholding Tax (WHT u/s 153) & CPR Certificate', `
      <form onsubmit="event.preventDefault(); ModularERP.submitLogCprForm();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Deducting Procuring Agency / Client *</label>
            <input type="text" class="form-input" id="erp-cpr-party" required placeholder="e.g. AGPR / WAPDA / NHA">
          </div>
          <div class="form-group">
            <label class="form-label">WHT Section *</label>
            <select class="form-select" id="erp-cpr-sec" required>
              <option value="153(1)(a) Goods">153(1)(a) Supply of Goods (5%)</option>
              <option value="153(1)(b) Services">153(1)(b) Services (9%)</option>
              <option value="153(1)(c) Contracts">153(1)(c) Turnkey Contracts (7.5%)</option>
              <option value="153(1)(a) Pharma/Dist">153(1)(a) Pharma / Distributor (1%)</option>
            </select>
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Taxable Gross Amount (PKR) *</label>
            <input type="number" class="form-input" id="erp-cpr-base" required value="1000000" min="1">
          </div>
          <div class="form-group">
            <label class="form-label">WHT Rate (%)</label>
            <input type="number" class="form-input" id="erp-cpr-rate" value="5" step="0.5">
          </div>
          <div class="form-group">
            <label class="form-label">FBR CPR Number *</label>
            <input type="text" class="form-input" id="erp-cpr-no" required value="CPR-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}">
          </div>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save CPR Certificate</button>
        </div>
      </form>
    `);
  },

  async submitLogCprForm() {
    const base = parseFloat(document.getElementById('erp-cpr-base')?.value || 0);
    const rate = parseFloat(document.getElementById('erp-cpr-rate')?.value || 5);
    const payload = {
      party_name: document.getElementById('erp-cpr-party')?.value,
      section_code: document.getElementById('erp-cpr-sec')?.value,
      taxable_amount: base,
      wht_rate: rate,
      wht_amount: Math.round((base * rate) / 100),
      cpr_number: document.getElementById('erp-cpr-no')?.value
    };
    const res = await this.request('/tax/cpr-deductions', 'POST', payload, 'erp_tax_cprs');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ WHT CPR Certificate recorded!', 'success');
      renderActiveView();
    }
  },

  // ==========================================================================
  // 6. MODULE 7: CORE HRM - EMPLOYEES, ATTENDANCE & LEAVES ('hrm')
  // ==========================================================================
  async renderHrmHTML() {
    if (window.HrmModule && typeof HrmModule.renderHTML === 'function') {
      return await HrmModule.renderHTML();
    }
    const [empRes, attRes, lvRes] = await Promise.all([
      this.request('/hrm/employees', 'GET', null, 'erp_hrm_employees'),
      this.request('/hrm/attendance', 'GET', null, 'erp_hrm_attendance'),
      this.request('/hrm/leaves', 'GET', null, 'erp_hrm_leaves')
    ]);

    const employees = empRes.data || [];
    const attendance = attRes.data || [];
    const leaves = lvRes.data || [];
    this._cachedEmployees = employees;

    const totalMonthlyPayroll = employees.reduce((s, e) => s + parseFloat(e.gross_salary || 0), 0);

    return `
      <div class="kpi-grid" style="margin-bottom: 18px;">
        <div class="kpi-card">
          <div class="kpi-label">👥 Active Workforce</div>
          <div class="kpi-value" style="color:#0284c7;">${employees.length} Staff</div>
          <div class="kpi-trend positive">Permanent, Contract & Project Engineers</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">💵 Monthly Gross Commitment</div>
          <div class="kpi-value" style="color:#059669;">${formatCurrency(totalMonthlyPayroll)}</div>
          <div class="kpi-trend">Synced with Payroll & Section 149 Tax</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">📅 Attendance Logs</div>
          <div class="kpi-value" style="color:#0f172a;">${attendance.length} Entries</div>
          <div class="kpi-trend">Check-in / Check-out & work hours</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">🏖️ Leave Applications</div>
          <div class="kpi-value" style="color:#7c3aed;">${leaves.length} Requests</div>
          <div class="kpi-trend">Casual, Medical & Annual Leave Desk</div>
        </div>
      </div>

      <!-- Employee Master Directory -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:800;">👥 Employee Master Registry & Salary Profiles</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">CNIC, Department, Designation, Bank IBAN & Monthly Gross Package</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="secondary-btn" style="background:#f0fdf4; color:#166534; border-color:#bbf7d0; font-weight:700;" onclick="ModularERP.markAllStaffPresentToday()" title="1-Click Mark All Active Employees Present for Today">✅ 1-Click All Present Today</button>
            <button class="secondary-btn" onclick="ModularERP.openAttendanceModal()">🕒 + Mark Attendance</button>
            <button class="secondary-btn" onclick="ModularERP.openLeaveModal()">🏖️ + Log Leave Request</button>
            <button class="primary-btn" onclick="ModularERP.openAddEmployeeModal()">➕ + Register Employee</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-hrm-employees">
              <thead>
                <tr>
                  <th>Emp Code</th>
                  <th>Full Name & CNIC</th>
                  <th>Department & Designation</th>
                  <th>Bank & IBAN</th>
                  <th style="text-align:right;">Basic Salary</th>
                  <th style="text-align:right;">Gross Salary</th>
                  <th>Status</th>
                  <th style="text-align:center;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${employees.length === 0 ? `
                  <tr><td colspan="8" style="text-align:center; padding:24px; color:#64748b;">No employees registered in HRM yet. Click <strong>+ Register Employee</strong> to onboard staff for attendance and payroll.</td></tr>
                ` : employees.map(e => `
                  <tr>
                    <td style="font-weight:800; font-family:monospace; color:#0284c7;">${escapeHtml(e.employee_code)}</td>
                    <td>
                      <div style="font-weight:700; color:#0f172a;">${escapeHtml(e.first_name)} ${escapeHtml(e.last_name || '')}</div>
                      <div style="font-size:0.74rem; color:#64748b; font-family:monospace;">🪪 CNIC: ${escapeHtml(e.cnic)}</div>
                    </td>
                    <td>
                      <div style="font-weight:600; color:#1e293b;">${escapeHtml(e.desig_display || e.designation_name || 'Engineer')}</div>
                      <div style="font-size:0.74rem; color:#64748b;">🏢 ${escapeHtml(e.dept_display || e.department_name || 'Operations')}</div>
                    </td>
                    <td>
                      <div style="font-weight:600;">${escapeHtml(e.bank_name || 'HBL')}</div>
                      <div style="font-size:0.73rem; color:#64748b; font-family:monospace;">${escapeHtml(e.bank_iban || '—')}</div>
                    </td>
                    <td style="text-align:right; font-family:monospace;">${formatCurrency(e.basic_salary || 0)}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:800; color:#059669;">${formatCurrency(e.gross_salary || 0)}</td>
                    <td><span class="badge badge-won">${escapeHtml(e.employment_status || 'Active')}</span></td>
                    <td style="text-align:center;">
                      <button class="edit-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="ModularERP.openEditEmployeeModal('${e.id}')" title="Edit Employee Profile & Salary">✏️ Edit</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Attendance & Leave Split Grid -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:18px;">
        <div class="card">
          <div class="card-header"><h3 style="margin:0; font-size:0.95rem; font-weight:700;">🕒 Recent Daily Attendance Sheet</h3></div>
          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr><th>Date</th><th>Employee</th><th>Check In / Out</th><th>Status</th></tr>
                </thead>
                <tbody>
                  ${attendance.length === 0 ? `<tr><td colspan="4" style="text-align:center; padding:16px; color:#64748b;">No attendance logs yet.</td></tr>` : attendance.slice(0, 15).map(a => `
                    <tr>
                      <td>${formatDateDDMMYYYY(a.attendance_date)}</td>
                      <td style="font-weight:700;">${escapeHtml(a.first_name || '')} ${escapeHtml(a.last_name || '')}</td>
                      <td style="font-family:monospace; font-size:0.78rem;">${escapeHtml(a.check_in_time || '09:00')} - ${escapeHtml(a.check_out_time || '17:30')}</td>
                      <td><span class="badge badge-won">${escapeHtml(a.status)}</span></td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-header"><h3 style="margin:0; font-size:0.95rem; font-weight:700;">🏖️ Leave Applications Desk</h3></div>
          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table">
                <thead>
                  <tr><th>Employee</th><th>Leave Type</th><th>Dates & Days</th><th>Status</th><th style="text-align:center;">Action</th></tr>
                </thead>
                <tbody>
                  ${leaves.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:16px; color:#64748b;">No leave applications yet.</td></tr>` : leaves.slice(0, 15).map(l => `
                    <tr>
                      <td style="font-weight:700;">${escapeHtml(l.first_name || '')} ${escapeHtml(l.last_name || '')}</td>
                      <td><span class="badge" style="background:#e0f2fe; color:#0369a1;">${escapeHtml(l.leave_type)}</span></td>
                      <td style="font-size:0.78rem;">${formatDateDDMMYYYY(l.start_date)} (${l.total_days}d)</td>
                      <td><span class="badge ${l.status === 'Approved' ? 'badge-won' : (l.status === 'Rejected' ? 'badge-withdraw' : 'badge-submitted')}">${escapeHtml(l.status || 'Pending')}</span></td>
                      <td style="text-align:center;">
                        ${l.status !== 'Approved' && l.status !== 'Rejected' ? `
                          <div style="display:flex; gap:4px; justify-content:center;">
                            <button class="primary-btn" style="padding:2px 7px; font-size:0.7rem; background:#059669;" onclick="ModularERP.updateLeaveStatus('${l.id}', 'Approved')">Approve</button>
                            <button class="delete-btn" style="padding:2px 7px; font-size:0.7rem; background:rgba(239,68,68,0.1); color:#ef4444;" onclick="ModularERP.updateLeaveStatus('${l.id}', 'Rejected')">Reject</button>
                          </div>
                        ` : `—`}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  openAddEmployeeModal() {
    this.showDynamicModal('👥 Register Employee Profile & Salary Structure', `
      <form onsubmit="event.preventDefault(); ModularERP.submitAddEmployeeForm();">
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">First Name *</label>
            <input type="text" class="form-input" id="erp-emp-fname" required placeholder="e.g. Bilal">
          </div>
          <div class="form-group">
            <label class="form-label">Last Name</label>
            <input type="text" class="form-input" id="erp-emp-lname" placeholder="e.g. Ahmed">
          </div>
          <div class="form-group">
            <label class="form-label">CNIC Number *</label>
            <input type="text" class="form-input" id="erp-emp-cnic" required placeholder="35202-1234567-1">
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Department *</label>
            <select class="form-select" id="erp-emp-dept" required>
              <option value="Commercial Bidding & Tenders Desk">Commercial Bidding & Tenders Desk</option>
              <option value="Procurement, Supply Chain & Logistics">Procurement, Supply Chain & Logistics</option>
              <option value="Finance, Accounts & FBR Compliance">Finance, Accounts & FBR Compliance</option>
              <option value="Corporate Sales & Client Relations">Corporate Sales & Client Relations</option>
              <option value="Warehouse & Production Operations">Warehouse & Production Operations</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Designation *</label>
            <input type="text" class="form-input" id="erp-emp-desig" required value="Senior Bid & Estimation Engineer">
          </div>
          <div class="form-group">
            <label class="form-label">Joining Date *</label>
            <input type="date" class="form-input" id="erp-emp-join" required value="${new Date().toISOString().split('T')[0]}">
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Monthly Gross Salary (PKR) *</label>
            <input type="number" class="form-input" id="erp-emp-gross" required value="150000" min="1">
          </div>
          <div class="form-group">
            <label class="form-label">Bank Name</label>
            <input type="text" class="form-input" id="erp-emp-bank" value="Meezan Bank">
          </div>
          <div class="form-group">
            <label class="form-label">Bank IBAN / Account #</label>
            <input type="text" class="form-input" id="erp-emp-iban" placeholder="PK36MEZN000123456789">
          </div>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save Employee Profile</button>
        </div>
      </form>
    `);
  },

  async submitAddEmployeeForm() {
    const gross = parseFloat(document.getElementById('erp-emp-gross')?.value || 0);
    const basic = Math.round(gross * 0.60);
    const payload = {
      first_name: document.getElementById('erp-emp-fname')?.value,
      last_name: document.getElementById('erp-emp-lname')?.value,
      cnic: document.getElementById('erp-emp-cnic')?.value,
      department_name: document.getElementById('erp-emp-dept')?.value,
      designation_name: document.getElementById('erp-emp-desig')?.value,
      joining_date: normalizeDateToISO(document.getElementById('erp-emp-join')?.value),
      basic_salary: basic,
      gross_salary: gross,
      bank_name: document.getElementById('erp-emp-bank')?.value,
      bank_iban: document.getElementById('erp-emp-iban')?.value
    };
    const res = await this.request('/hrm/employees', 'POST', payload, 'erp_hrm_employees');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Employee registered and linked to Payroll!', 'success');
      renderActiveView();
    }
  },

  openAttendanceModal() {
    const empOpts = (this._cachedEmployees || []).map(e => `<option value="${e.id}">${escapeHtml(e.first_name)} ${escapeHtml(e.last_name || '')} (${escapeHtml(e.employee_code)})</option>`).join('');
    this.showDynamicModal('🕒 Mark Daily Attendance', `
      <form onsubmit="event.preventDefault(); ModularERP.submitAttendanceForm();">
        <div class="form-group">
          <label class="form-label">Select Employee *</label>
          <select class="form-select" id="erp-att-emp" required>${empOpts}</select>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Date *</label>
            <input type="date" class="form-input" id="erp-att-date" required value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label class="form-label">Status *</label>
            <select class="form-select" id="erp-att-status">
              <option value="Present">Present</option>
              <option value="Late">Late</option>
              <option value="Half Day">Half Day</option>
              <option value="On Leave">On Leave</option>
              <option value="Absent">Absent</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Work Hours</label>
            <input type="number" class="form-input" id="erp-att-hrs" value="8" step="0.5">
          </div>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">✓ Save Attendance</button>
        </div>
      </form>
    `);
  },

  async submitAttendanceForm() {
    const payload = {
      employee_id: document.getElementById('erp-att-emp')?.value,
      attendance_date: normalizeDateToISO(document.getElementById('erp-att-date')?.value),
      status: document.getElementById('erp-att-status')?.value,
      work_hours: parseFloat(document.getElementById('erp-att-hrs')?.value || 8)
    };
    const res = await this.request('/hrm/attendance', 'POST', payload, 'erp_hrm_attendance');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Attendance logged!', 'success');
      renderActiveView();
    }
  },

  openLeaveModal() {
    const empOpts = (this._cachedEmployees || []).map(e => `<option value="${e.id}">${escapeHtml(e.first_name)} ${escapeHtml(e.last_name || '')}</option>`).join('');
    this.showDynamicModal('🏖️ Submit & Approve Employee Leave', `
      <form onsubmit="event.preventDefault(); ModularERP.submitLeaveForm();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Select Employee *</label>
            <select class="form-select" id="erp-lv-emp" required>${empOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Leave Type *</label>
            <select class="form-select" id="erp-lv-type">
              <option value="Casual">Casual Leave</option>
              <option value="Medical">Medical Leave</option>
              <option value="Annual">Annual Paid Leave</option>
              <option value="Unpaid">Unpaid Leave</option>
            </select>
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Start Date *</label>
            <input type="date" class="form-input" id="erp-lv-start" required value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label class="form-label">End Date *</label>
            <input type="date" class="form-input" id="erp-lv-end" required value="${new Date().toISOString().split('T')[0]}">
          </div>
          <div class="form-group">
            <label class="form-label">Total Days *</label>
            <input type="number" class="form-input" id="erp-lv-days" required value="1" min="0.5" step="0.5">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Reason</label>
          <input type="text" class="form-input" id="erp-lv-reason" placeholder="Personal / Medical reason">
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save Leave Record</button>
        </div>
      </form>
    `);
  },

  async submitLeaveForm() {
    const payload = {
      employee_id: document.getElementById('erp-lv-emp')?.value,
      leave_type: document.getElementById('erp-lv-type')?.value,
      start_date: normalizeDateToISO(document.getElementById('erp-lv-start')?.value),
      end_date: normalizeDateToISO(document.getElementById('erp-lv-end')?.value),
      total_days: parseFloat(document.getElementById('erp-lv-days')?.value || 1),
      reason: document.getElementById('erp-lv-reason')?.value,
      status: 'Approved'
    };
    const res = await this.request('/hrm/leaves', 'POST', payload, 'erp_hrm_leaves');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Leave record saved!', 'success');
      renderActiveView();
    }
  },

  // ==========================================================================
  // 7. MODULE 8: PAYROLL, PAKISTAN SECTION 149 TAX SLABS & EOBI ('payroll')
  // ==========================================================================
  async renderPayrollHTML() {
    if (window.PayrollModule && typeof PayrollModule.renderHTML === 'function') {
      return await PayrollModule.renderHTML();
    }
    const [runsRes, empRes] = await Promise.all([
      this.request('/payroll/runs', 'GET', null, 'erp_payroll_runs'),
      this.request('/hrm/employees', 'GET', null, 'erp_hrm_employees')
    ]);

    const runs = runsRes.data || [];
    const employees = empRes.data || [];
    this._cachedPayrollRuns = runs;

    const latestRun = runs[0] || null;
    const sim = this.calculatePakSalaryTaxLocal(150000);

    return `
      <div class="kpi-grid" style="margin-bottom: 18px;">
        <div class="kpi-card">
          <div class="kpi-label">💵 Processed Payroll Runs</div>
          <div class="kpi-value" style="color:#0284c7;">${runs.length} Cycles</div>
          <div class="kpi-trend positive">Auto-posts to General Ledger (COA 5100)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">👥 Active Salaried Staff</div>
          <div class="kpi-value" style="color:#0f172a;">${employees.length} Employees</div>
          <div class="kpi-trend">Synced from Module 7 (Core HRM)</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">🇵🇰 Latest Run Net Disbursed</div>
          <div class="kpi-value" style="color:#059669;">${formatCurrency(latestRun?.total_net_payable || 0)}</div>
          <div class="kpi-trend">After FBR u/s 149 WHT & EOBI</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">⚖️ Section 149 WHT Deducted</div>
          <div class="kpi-value" style="color:#dc2626;">${formatCurrency(latestRun?.total_tax_deducted || 0)}</div>
          <div class="kpi-trend">Finance Act 2025/2026 Slabs</div>
        </div>
      </div>

      <!-- Interactive FBR Section 149 Salary Tax Simulator -->
      <div class="card" style="margin-bottom: 20px; background: linear-gradient(135deg, #f8fafc 0%, #f0f9ff 100%); border:1px solid #bae6fd;">
        <div class="card-body" style="padding:16px 20px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px;">
            <div>
              <h4 style="margin:0; font-size:0.95rem; font-weight:800; color:#0f172a;">🧮 Live Pakistan FBR Section 149 Salary Tax & EOBI Calculator</h4>
              <p style="margin:2px 0 0; font-size:0.76rem; color:#475569;">Enter any monthly gross salary to preview statutory FBR progressive slab deduction & net take-home pay</p>
            </div>
            <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
              <div>
                <label style="font-size:0.72rem; font-weight:700; color:#475569; display:block;">Monthly Gross (PKR)</label>
                <input type="number" class="form-input" id="erp-sim-gross" value="150000" style="width:160px; font-weight:800;" oninput="ModularERP.updateSalaryTaxSimulator(this.value)">
              </div>
              <div id="erp-sim-output" style="display:flex; gap:16px; background:white; padding:8px 16px; border-radius:8px; border:1px solid #cbd5e1; font-size:0.82rem;">
                <div><span style="color:#64748b;">Annual Taxable:</span> <strong style="font-family:monospace;">${formatCurrency(sim.annual_taxable)}</strong></div>
                <div><span style="color:#64748b;">Monthly u/s 149 Tax:</span> <strong style="color:#dc2626; font-family:monospace;">${formatCurrency(sim.monthly_tax)}</strong></div>
                <div><span style="color:#64748b;">EOBI:</span> <strong style="font-family:monospace;">PKR ${sim.eobi_emp}</strong></div>
                <div><span style="color:#64748b;">Net Take-Home:</span> <strong style="color:#059669; font-family:monospace;">${formatCurrency(sim.net_salary)}</strong></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Monthly Payroll Runs & Payslips -->
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:800;">💵 Monthly Payroll Processing & Bank Transfer Disbursements</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">1-click payroll generation for all active HRM employees with automatic General Ledger voucher posting</p>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="secondary-btn" onclick="switchView('hrm')">👥 Manage HRM Staff</button>
            <button class="primary-btn" style="background:#059669;" onclick="ModularERP.runMonthlyPayroll()">⚡ Process Current Month Payroll</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-payroll-runs">
              <thead>
                <tr>
                  <th>Payroll Period</th>
                  <th>Employees Paid</th>
                  <th style="text-align:right;">Total Gross Payroll</th>
                  <th style="text-align:right;">Section 149 WHT</th>
                  <th style="text-align:right;">EOBI Deduction</th>
                  <th style="text-align:right;">Net Bank Disbursement</th>
                  <th style="text-align:center;">Payslips & Bank Sheet</th>
                </tr>
              </thead>
              <tbody>
                ${runs.length === 0 ? `
                  <tr><td colspan="7" style="text-align:center; padding:24px; color:#64748b;">No monthly payroll runs generated yet. Ensure you have active employees in <strong>HRM</strong>, then click <strong>⚡ Process Current Month Payroll</strong>.</td></tr>
                ` : runs.map((r, idx) => `
                  <tr>
                    <td style="font-weight:800; color:#0f172a;">📅 Month ${r.payroll_month} / ${r.payroll_year}</td>
                    <td><span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:700;">${r.total_employees} Staff</span></td>
                    <td style="text-align:right; font-family:monospace; font-weight:700;">${formatCurrency(r.total_gross)}</td>
                    <td style="text-align:right; font-family:monospace; color:#dc2626; font-weight:700;">${formatCurrency(r.total_tax_deducted)}</td>
                    <td style="text-align:right; font-family:monospace;">${formatCurrency(r.total_eobi_deducted)}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:800; color:#059669;">${formatCurrency(r.total_net_payable)}</td>
                    <td style="text-align:center;">
                      <button class="secondary-btn" style="padding:4px 10px; font-size:0.75rem;" onclick="ModularERP.viewPayslipsModal(${idx})">
                        🖨️ View Payslips & Bank CSV
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  updateSalaryTaxSimulator(val) {
    const out = document.getElementById('erp-sim-output');
    if (!out) return;
    const sim = this.calculatePakSalaryTaxLocal(val);
    out.innerHTML = `
      <div><span style="color:#64748b;">Annual Taxable:</span> <strong style="font-family:monospace;">${formatCurrency(sim.annual_taxable)}</strong></div>
      <div><span style="color:#64748b;">Monthly u/s 149 Tax:</span> <strong style="color:#dc2626; font-family:monospace;">${formatCurrency(sim.monthly_tax)}</strong></div>
      <div><span style="color:#64748b;">EOBI:</span> <strong style="font-family:monospace;">PKR ${sim.eobi_emp}</strong></div>
      <div><span style="color:#64748b;">Net Take-Home:</span> <strong style="color:#059669; font-family:monospace;">${formatCurrency(sim.net_salary)}</strong></div>
    `;
  },

  async runMonthlyPayroll() {
    const now = new Date();
    const res = await this.request('/payroll/runs', 'POST', {
      payroll_month: now.getMonth() + 1,
      payroll_year: now.getFullYear(),
      business_profile_id: State.currentBusinessProfileId
    }, 'erp_payroll_runs');
    if (res && res.success) {
      showToast(res.message || 'Monthly Payroll processed & posted to General Ledger!', 'success');
      renderActiveView();
    } else {
      showToast(res?.message || 'Please register active employees in HRM first.', 'warning');
    }
  },

  viewPayslipsModal(runIdx) {
    const run = (this._cachedPayrollRuns || [])[runIdx];
    if (!run) return;
    const slips = Array.isArray(run.payslips) ? run.payslips : [];
    const profile = State.getPrintableBusinessProfile();

    this.showDynamicModal(`🖨️ Employee Payslips & Bank Transfer Sheet (${run.payroll_month}/${run.payroll_year})`, `
      <div style="margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
        <div><strong>Issuing Entity:</strong> ${escapeHtml(profile.business_name)}</div>
        <button class="primary-btn" style="padding:5px 12px; font-size:0.78rem;" onclick="ModularERP.exportBankSalaryCsv(${runIdx})">📥 Export HBL/Meezan Bank Transfer CSV</button>
      </div>
      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Emp Code & Name</th>
              <th>Bank & IBAN</th>
              <th style="text-align:right;">Gross Pay</th>
              <th style="text-align:right;">FBR u/s 149 WHT</th>
              <th style="text-align:right;">EOBI</th>
              <th style="text-align:right;">Net Payable</th>
              <th style="text-align:center;">Print</th>
            </tr>
          </thead>
          <tbody>
            ${slips.map(s => `
              <tr>
                <td><strong>${escapeHtml(s.employee_name || 'Employee')}</strong><div style="font-size:0.72rem; color:#64748b;">${escapeHtml(s.designation || '')}</div></td>
                <td style="font-size:0.78rem; font-family:monospace;">${escapeHtml(s.bank_name || 'Bank')} - ${escapeHtml(s.bank_iban || 'IBAN')}</td>
                <td style="text-align:right; font-family:monospace;">${formatCurrency(s.gross_salary)}</td>
                <td style="text-align:right; font-family:monospace; color:#dc2626;">${formatCurrency(s.income_tax_deduction)}</td>
                <td style="text-align:right; font-family:monospace;">${formatCurrency(s.eobi_employee_deduction)}</td>
                <td style="text-align:right; font-family:monospace; font-weight:800; color:#059669;">${formatCurrency(s.net_salary)}</td>
                <td style="text-align:center;">
                  <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick='if(window.TemplatesEngine && TemplatesEngine.printPayslip){ TemplatesEngine.printPayslip(${JSON.stringify(s).replace(/'/g, "&#39;")}); } else { window.print(); }' title="Print Formal Employee Monthly Payslip">
                    🖨️ Payslip
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `);
  },

  exportBankSalaryCsv(runIdx) {
    const run = (this._cachedPayrollRuns || [])[runIdx];
    if (!run) return;
    const slips = Array.isArray(run.payslips) ? run.payslips : [];
    let csv = 'Employee Code,Employee Name,Bank Name,IBAN,Gross Salary,Income Tax u/s 149,EOBI,Net Salary Payable\n';
    slips.forEach(s => {
      csv += `"${s.employee_code || ''}","${s.employee_name || ''}","${s.bank_name || ''}","${s.bank_iban || ''}",${s.gross_salary || 0},${s.income_tax_deduction || 0},${s.eobi_employee_deduction || 0},${s.net_salary || 0}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Bank_Salary_Transfer_${run.payroll_year}_${run.payroll_month}.csv`;
    a.click();
    showToast('✓ Corporate Bank Salary Transfer CSV downloaded!', 'success');
  },

  // ==========================================================================
  // 8. MODULE 9: MANUFACTURING ERP - BOM & PRODUCTION WORK ORDERS ('manufacturing')
  // ==========================================================================
  async renderManufacturingHTML() {
    if (window.ManufacturingModule && typeof ManufacturingModule.renderHTML === 'function') {
      return await ManufacturingModule.renderHTML();
    }
    const [bomsRes, woRes, prodList, whList] = await Promise.all([
      this.request('/mfg/boms', 'GET', null, 'erp_mfg_boms'),
      this.request('/mfg/work-orders', 'GET', null, 'erp_mfg_work_orders'),
      API.getProducts(),
      API.getWarehouses()
    ]);

    const boms = bomsRes.data || [];
    const workOrders = woRes.data || [];
    this._cachedBoms = boms;
    this._cachedProducts = prodList || [];
    this._cachedWarehouses = whList || [];

    const totalCogm = workOrders.reduce((s, w) => s + parseFloat(w.total_production_cost || 0), 0);
    const completedWos = workOrders.filter(w => w.status === 'Completed').length;

    return `
      <div class="kpi-grid" style="margin-bottom: 18px;">
        <div class="kpi-card">
          <div class="kpi-label">📐 Bill of Materials (BOMs)</div>
          <div class="kpi-value" style="color:#0284c7;">${boms.length} Recipes</div>
          <div class="kpi-trend positive">Multi-component raw material costing</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">🏭 Production Work Orders</div>
          <div class="kpi-value" style="color:#0f172a;">${workOrders.length} Orders</div>
          <div class="kpi-trend">${completedWos} Completed & Received in Stock</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">💰 Total Production Cost (COGM)</div>
          <div class="kpi-value" style="color:#059669;">${formatCurrency(totalCogm)}</div>
          <div class="kpi-trend">Material + Direct Labor + Factory Overhead</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">🔄 Warehouse Auto-Flush</div>
          <div class="kpi-value" style="color:#7c3aed;">Active</div>
          <div class="kpi-trend">Auto-deducts raw SKUs & adds finished goods</div>
        </div>
      </div>

      <!-- Production Work Orders Desk -->
      <div class="card" style="margin-bottom: 20px;">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:800;">🏭 Production Work Orders & Shop Floor Execution</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Issue factory job cards against BOM recipes and receive finished goods into warehouse inventory</p>
          </div>
          <div style="display:flex; gap:8px;">
            <button class="secondary-btn" onclick="ModularERP.openAddBomModal()">📐 + Create BOM Recipe</button>
            <button class="primary-btn" onclick="ModularERP.openAddWorkOrderModal()">🏭 + Issue Production Work Order</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-mfg-work-orders">
              <thead>
                <tr>
                  <th>Work Order #</th>
                  <th>BOM Recipe & Finished Good</th>
                  <th>Target Qty</th>
                  <th>Warehouses (Raw → Finished)</th>
                  <th style="text-align:right;">Total COGM (PKR)</th>
                  <th>Status</th>
                  <th style="text-align:center;">Shop Floor Action</th>
                </tr>
              </thead>
              <tbody>
                ${workOrders.length === 0 ? `
                  <tr><td colspan="7" style="text-align:center; padding:24px; color:#64748b;">No production work orders created yet. First create a <strong>BOM Recipe</strong>, then click <strong>+ Issue Production Work Order</strong>.</td></tr>
                ` : workOrders.map(wo => `
                  <tr>
                    <td style="font-weight:800; font-family:monospace; color:#0284c7;">${escapeHtml(wo.order_number)}</td>
                    <td>
                      <div style="font-weight:700; color:#0f172a;">📦 ${escapeHtml(wo.target_product_name || 'Finished Good')}</div>
                      <div style="font-size:0.74rem; color:#64748b;">BOM: ${escapeHtml(wo.bom_code || 'Standard')}</div>
                    </td>
                    <td style="font-weight:800; font-family:monospace;">${wo.target_quantity} Units</td>
                    <td style="font-size:0.78rem;">
                      📤 Raw: ${escapeHtml(wo.raw_warehouse_name || 'Main Store')}<br>
                      📥 FG: ${escapeHtml(wo.finished_warehouse_name || 'Main Store')}
                    </td>
                    <td style="text-align:right; font-family:monospace; font-weight:700; color:#059669;">
                      ${formatCurrency(wo.total_production_cost)}
                    </td>
                    <td>
                      <span class="badge ${wo.status === 'Completed' ? 'badge-won' : 'badge-submitted'}">${escapeHtml(wo.status)}</span>
                    </td>
                    <td style="text-align:center;">
                      <div style="display:flex; gap:4px; justify-content:center; flex-wrap:wrap;">
                        <button class="secondary-btn" style="padding:4px 8px; font-size:0.75rem;" onclick='if(window.TemplatesEngine && TemplatesEngine.printWorkOrderJobCard){ TemplatesEngine.printWorkOrderJobCard(${JSON.stringify(wo).replace(/'/g, "&#39;")}); } else { window.print(); }' title="Print Factory Production Job Card / Route Sheet">
                          🖨️ Job Card
                        </button>
                        ${wo.status !== 'Completed' ? `
                          <button class="primary-btn" style="padding:4px 10px; font-size:0.75rem; background:#059669;" onclick="ModularERP.completeWorkOrder('${wo.id}', ${wo.target_quantity})">
                            ✅ Complete
                          </button>
                        ` : `<span style="font-size:0.75rem; color:#059669; font-weight:700;">✓ Received</span>`}
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Bill of Materials (BOM) Registry -->
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:1rem; font-weight:700;">📐 Bill of Materials (BOM / Recipe Master Catalog)</h3>
          <button class="secondary-btn" style="font-size:0.75rem; padding:4px 10px;" onclick="ModularERP.openAddBomModal()">+ New Recipe</button>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table" id="table-mfg-boms">
              <thead>
                <tr>
                  <th>BOM Code</th>
                  <th>Finished Product SKU</th>
                  <th>Raw Material Components</th>
                  <th style="text-align:right;">Material Cost</th>
                  <th style="text-align:right;">Labor + Overhead</th>
                  <th style="text-align:right;">Est. Unit Cost (COGM)</th>
                  <th style="text-align:center;">Action</th>
                </tr>
              </thead>
              <tbody>
                ${boms.length === 0 ? `
                  <tr><td colspan="7" style="text-align:center; padding:20px; color:#64748b;">No Bill of Materials configured yet. Click <strong>📐 + Create BOM Recipe</strong> to define assembly components and standard costing.</td></tr>
                ` : boms.map(b => `
                  <tr>
                    <td style="font-weight:800; font-family:monospace; color:#0284c7;">${escapeHtml(b.bom_code)}</td>
                    <td style="font-weight:700; color:#0f172a;">${escapeHtml(b.finished_product_name || b.bom_name || 'Finished Item')}</td>
                    <td>
                      ${Array.isArray(b.components) && b.components.length > 0
        ? b.components.map(c => `<div style="font-size:0.78rem;">• ${escapeHtml(c.raw_material_name || 'Component')}: <strong>${c.required_quantity}</strong> @ ${formatCurrency(c.unit_cost)} (Scrap: ${c.scrap_allowance_pct || 0}%)</div>`).join('')
        : '<span style="color:#64748b;">Standard Assembly</span>'}
                    </td>
                    <td style="text-align:right; font-family:monospace;">${formatCurrency(b.material_cost_estimate)}</td>
                    <td style="text-align:right; font-family:monospace;">${formatCurrency(parseFloat(b.labor_cost_estimate || 0) + parseFloat(b.overhead_cost_estimate || 0))}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:800; color:#059669;">${formatCurrency(b.total_estimated_unit_cost)}</td>
                    <td style="text-align:center;">
                      <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem; background:#f0f9ff; color:#0369a1; border-color:#bae6fd; font-weight:700;" onclick="ModularERP.openBomShortageModal('${b.id}')" title="Check Raw Material Stock Availability & Shortage">
                        🔍 Shortage Check
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  openAddBomModal() {
    const prodOpts = (this._cachedProducts || []).map(p => `<option value="${p.id}" data-cost="${p.unit_price || 1000}">${escapeHtml(p.name)} (${escapeHtml(p.sku_code || 'SKU')})</option>`).join('');
    window._bomProdOpts = prodOpts;
    this.showDynamicModal('📐 Create Bill of Materials (BOM Recipe)', `
      <form onsubmit="event.preventDefault(); ModularERP.submitAddBomForm();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">BOM Recipe Name / Code *</label>
            <input type="text" class="form-input" id="erp-bom-name" required placeholder="e.g. BOM-LV-PANEL-400A">
          </div>
          <div class="form-group">
            <label class="form-label">Finished Product SKU (Output) *</label>
            <select class="form-select" id="erp-bom-fg" required>${prodOpts}</select>
          </div>
        </div>

        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <div style="font-weight:700; font-size:0.85rem; color:#0f172a;">🔩 Raw Material Assembly Components (Multi-SKU)</div>
            <button type="button" class="secondary-btn" style="padding:2px 8px; font-size:0.75rem;" onclick="ModularERP.addBomComponentRow()">+ Add Component SKU</button>
          </div>
          <div id="erp-bom-components-container" style="display:flex; flex-direction:column; gap:8px;">
            <div class="erp-bom-row" style="display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 30px; gap:8px; align-items:center;">
              <div>
                <label style="font-size:0.7rem; color:#64748b; font-weight:600;">Raw Material SKU</label>
                <select class="form-select bom-comp-sku" required>${prodOpts}</select>
              </div>
              <div>
                <label style="font-size:0.7rem; color:#64748b; font-weight:600;">Qty / Unit</label>
                <input type="number" class="form-input bom-comp-qty" required value="1" min="0.001" step="any">
              </div>
              <div>
                <label style="font-size:0.7rem; color:#64748b; font-weight:600;">Unit Cost (PKR)</label>
                <input type="number" class="form-input bom-comp-cost" required value="25000" min="0">
              </div>
              <div>
                <label style="font-size:0.7rem; color:#64748b; font-weight:600;">Scrap %</label>
                <input type="number" class="form-input bom-comp-scrap" value="2" min="0" max="100">
              </div>
              <div style="padding-top:16px;">
                <button type="button" style="border:none; background:none; color:#94a3b8; cursor:pointer;" onclick="this.closest('.erp-bom-row').remove()">&times;</button>
              </div>
            </div>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Direct Labor Cost per Unit (PKR)</label>
            <input type="number" class="form-input" id="erp-bom-labor" value="5000" min="0">
          </div>
          <div class="form-group">
            <label class="form-label">Factory Overhead Cost per Unit (PKR)</label>
            <input type="number" class="form-input" id="erp-bom-ovh" value="3500" min="0">
          </div>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save Multi-Component BOM</button>
        </div>
      </form>
    `);
  },

  addBomComponentRow() {
    const container = document.getElementById('erp-bom-components-container');
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'erp-bom-row';
    row.style.cssText = 'display:grid; grid-template-columns: 2fr 1fr 1fr 1fr 30px; gap:8px; align-items:center;';
    row.innerHTML = `
      <div>
        <select class="form-select bom-comp-sku" required>${window._bomProdOpts || ''}</select>
      </div>
      <div>
        <input type="number" class="form-input bom-comp-qty" required value="1" min="0.001" step="any">
      </div>
      <div>
        <input type="number" class="form-input bom-comp-cost" required value="5000" min="0">
      </div>
      <div>
        <input type="number" class="form-input bom-comp-scrap" value="0" min="0" max="100">
      </div>
      <div>
        <button type="button" style="border:none; background:none; color:#ef4444; font-size:1.1rem; cursor:pointer;" onclick="this.closest('.erp-bom-row').remove()">&times;</button>
      </div>
    `;
    container.appendChild(row);
  },

  async submitAddBomForm() {
    const code = document.getElementById('erp-bom-name')?.value;
    const fgId = document.getElementById('erp-bom-fg')?.value;
    const labor = parseFloat(document.getElementById('erp-bom-labor')?.value || 0);
    const ovh = parseFloat(document.getElementById('erp-bom-ovh')?.value || 0);

    const compRows = document.querySelectorAll('.erp-bom-row');
    const components = Array.from(compRows).map(r => ({
      raw_material_product_id: r.querySelector('.bom-comp-sku')?.value,
      required_quantity: parseFloat(r.querySelector('.bom-comp-qty')?.value || 1),
      unit_cost: parseFloat(r.querySelector('.bom-comp-cost')?.value || 0),
      scrap_allowance_pct: parseFloat(r.querySelector('.bom-comp-scrap')?.value || 0)
    }));

    if (components.length === 0) {
      alert('Please include at least one raw material component SKU in this BOM.');
      return;
    }

    const payload = {
      bom_code: code,
      bom_name: code,
      finished_product_id: fgId,
      output_quantity: 1,
      labor_cost_estimate: labor,
      overhead_cost_estimate: ovh,
      components
    };
    const res = await this.request('/mfg/boms', 'POST', payload, 'erp_mfg_boms');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Multi-component Bill of Materials (BOM) saved!', 'success');
      renderActiveView();
    }
  },

  openAddWorkOrderModal() {
    const bomOpts = (this._cachedBoms || []).map(b => `<option value="${b.id}">${escapeHtml(b.bom_code)} — ${escapeHtml(b.finished_product_name || '')} (Est: ${formatCurrency(b.total_estimated_unit_cost)}/unit)</option>`).join('');
    const whOpts = (this._cachedWarehouses || []).map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');

    this.showDynamicModal('🏭 Issue Production Work Order', `
      <form onsubmit="event.preventDefault(); ModularERP.submitAddWorkOrderForm();">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Select BOM Recipe *</label>
            <select class="form-select" id="erp-wo-bom" required>${bomOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Target Production Quantity *</label>
            <input type="number" class="form-input" id="erp-wo-qty" required value="5" min="1">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Raw Materials Source Warehouse *</label>
            <select class="form-select" id="erp-wo-raw-wh" required>${whOpts}</select>
          </div>
          <div class="form-group">
            <label class="form-label">Finished Goods Receiving Warehouse *</label>
            <select class="form-select" id="erp-wo-fg-wh" required>${whOpts}</select>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Production Job Card Notes</label>
          <input type="text" class="form-input" id="erp-wo-notes" placeholder="e.g. Priority manufacturing lot for tender contract delivery">
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">🏭 Release Work Order</button>
        </div>
      </form>
    `);
  },

  async submitAddWorkOrderForm() {
    const payload = {
      bom_id: document.getElementById('erp-wo-bom')?.value,
      target_quantity: parseFloat(document.getElementById('erp-wo-qty')?.value || 1),
      raw_materials_warehouse_id: document.getElementById('erp-wo-raw-wh')?.value,
      finished_goods_warehouse_id: document.getElementById('erp-wo-fg-wh')?.value,
      notes: document.getElementById('erp-wo-notes')?.value,
      business_profile_id: State.currentBusinessProfileId
    };
    const res = await this.request('/mfg/work-orders', 'POST', payload, 'erp_mfg_work_orders');
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Production Work Order released to shop floor!', 'success');
      renderActiveView();
    }
  },

  async completeWorkOrder(woId, qty) {
    const res = await this.request(`/mfg/work-orders/${woId}/complete`, 'POST', { produced_quantity: qty });
    if (res && res.success) {
      showToast(res.message || 'Production completed and Finished Goods added to Warehouse Stock!', 'success');
      renderActiveView();
    }
  },

  // ==========================================================================
  // PHASE 1: TENDER DOCUMENT CHECKLIST & COMPETITOR POST-OPENING BIDS MODAL
  // ==========================================================================
  async openTenderIntelModal(oppId) {
    const [docsRes, compRes] = await Promise.all([
      API.getTenderDocuments(oppId),
      API.getTenderCompetitors(oppId)
    ]);
    const docs = (docsRes && docsRes.data) || [];
    const comps = (compRes && compRes.data) || [];

    this.showDynamicModal('📋 Tender PPRA Document Checklist & Competitor Bid Intelligence', `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
        <h4 style="margin:0; font-size:0.95rem; font-weight:800; color:#0f172a;">1. Mandatory PPRA Bidding Dossier Checklist (${docs.length})</h4>
        <div style="display:flex; gap:6px;">
          <button type="button" class="secondary-btn" style="font-size:0.76rem; padding:4px 10px; border-color:#7c3aed; color:#7c3aed; font-weight:700;" onclick="ModularERP.seedTenderPpraChecklist('${oppId}')">⚡ Auto-Seed 6-Point PPRA Checklist</button>
        </div>
      </div>
      <div class="table-responsive" style="margin-bottom:14px; max-height:200px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px;">
        <table class="data-table">
          <thead>
            <tr><th>Document Title</th><th>Category</th><th>Status</th><th>Action</th></tr>
          </thead>
          <tbody>
            ${docs.length === 0 ? `<tr><td colspan="4" style="text-align:center; padding:12px; color:#64748b;">No checklist items yet. Click <strong>⚡ Auto-Seed 6-Point PPRA Checklist</strong> above.</td></tr>` : docs.map(d => `
              <tr>
                <td style="font-weight:700;">${escapeHtml(d.document_title)}</td>
                <td><span class="badge" style="background:#f1f5f9; color:#334155;">${escapeHtml(d.document_category)}</span></td>
                <td>
                  <select class="form-select" style="font-size:0.75rem; padding:2px 6px; height:26px;" onchange="ModularERP.updateChecklistItemStatus('${oppId}', '${d.id}', this.value)">
                    <option value="Pending" ${d.checklist_status === 'Pending' ? 'selected' : ''}>⏳ Pending</option>
                    <option value="Ready / Verified" ${d.checklist_status === 'Ready / Verified' ? 'selected' : ''}>✅ Ready / Verified</option>
                    <option value="Submitted" ${d.checklist_status === 'Submitted' ? 'selected' : ''}>🚀 Submitted</option>
                  </select>
                </td>
                <td><button type="button" class="danger-btn" style="padding:2px 6px; font-size:0.72rem;" onclick="ModularERP.deleteChecklistItem('${oppId}', '${d.id}')">🗑️</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <form onsubmit="event.preventDefault(); ModularERP.addChecklistItem('${oppId}');" style="display:grid; grid-template-columns:2fr 1fr auto; gap:8px; margin-bottom:20px;">
        <input type="text" class="form-input" id="intel-doc-title" placeholder="Add custom document requirement (e.g. PEC License Copy)..." required>
        <select class="form-select" id="intel-doc-cat">
          <option value="Technical Bid">Technical Bid</option>
          <option value="Financial Bid">Financial Bid</option>
          <option value="CDR Copy">CDR Copy</option>
          <option value="Eligibility Profile">Eligibility Profile</option>
          <option value="Prequalification">Prequalification</option>
        </select>
        <button type="submit" class="primary-btn" style="padding:6px 12px;">+ Add Doc</button>
      </form>

      <h4 style="margin:0 0 10px 0; font-size:0.95rem; font-weight:800; color:#0f172a;">2. Competitor Post-Opening Bid Intelligence (${comps.length})</h4>
      <div class="table-responsive" style="margin-bottom:12px; max-height:180px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px;">
        <table class="data-table">
          <thead>
            <tr><th>Rank</th><th>Competitor Name</th><th>Tech Score</th><th style="text-align:right;">Quoted Financial Bid</th><th>Notes / Rejection Grounds</th></tr>
          </thead>
          <tbody>
            ${comps.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:12px; color:#64748b;">No competitor post-opening bids logged yet.</td></tr>` : comps.map(c => `
              <tr>
                <td style="font-weight:800; color:${c.ranking === 1 ? '#059669' : '#334155'};">#${c.ranking || '-'} ${c.is_winner ? '🏆' : ''}</td>
                <td style="font-weight:700;">${escapeHtml(c.competitor_name)}</td>
                <td>${parseFloat(c.technical_score || 0).toFixed(1)}%</td>
                <td style="text-align:right; font-family:monospace; font-weight:700;">${formatCurrency(c.financial_bid_amount)}</td>
                <td style="font-size:0.78rem; color:#64748b;">${escapeHtml(c.rejection_grounds || 'Qualified')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <form onsubmit="event.preventDefault(); ModularERP.addCompetitorBid('${oppId}');" style="display:grid; grid-template-columns:1.5fr 0.7fr 1fr 0.6fr auto; gap:8px;">
        <input type="text" class="form-input" id="intel-comp-name" placeholder="Competitor Firm Name *" required>
        <input type="number" class="form-input" id="intel-comp-tech" placeholder="Tech %" value="85" step="any">
        <input type="number" class="form-input" id="intel-comp-amt" placeholder="Bid Amount (PKR) *" required step="any">
        <input type="number" class="form-input" id="intel-comp-rank" placeholder="Rank" value="1" min="1">
        <button type="submit" class="primary-btn" style="padding:6px 12px;">+ Log Bid</button>
      </form>
    `);
  },

  async seedTenderPpraChecklist(oppId) {
    const res = await API.seedPpraChecklist(oppId);
    if (res && res.success) {
      showToast('✓ 6-Point Mandatory PPRA Checklist generated!', 'success');
      this.openTenderIntelModal(oppId);
    }
  },

  async addChecklistItem(oppId) {
    const title = document.getElementById('intel-doc-title')?.value;
    const cat = document.getElementById('intel-doc-cat')?.value;
    await fetch(`/api/opportunities/${oppId}/documents`, {
      method: 'POST',
      headers: API.getHeaders(),
      body: JSON.stringify({ document_title: title, document_category: cat, checklist_status: 'Pending', is_mandatory: true })
    });
    this.openTenderIntelModal(oppId);
  },

  async updateChecklistItemStatus(oppId, docId, status) {
    await fetch(`/api/opportunities/documents/${docId}`, {
      method: 'PUT',
      headers: API.getHeaders(),
      body: JSON.stringify({ checklist_status: status })
    });
    showToast(`✓ Checklist updated to ${status}`, 'success');
  },

  async deleteChecklistItem(oppId, docId) {
    await fetch(`/api/opportunities/documents/${docId}`, { method: 'DELETE', headers: API.getHeaders() });
    this.openTenderIntelModal(oppId);
  },

  async addCompetitorBid(oppId) {
    const payload = {
      competitor_name: document.getElementById('intel-comp-name')?.value,
      technical_score: parseFloat(document.getElementById('intel-comp-tech')?.value || 0),
      financial_bid_amount: parseFloat(document.getElementById('intel-comp-amt')?.value || 0),
      ranking: parseInt(document.getElementById('intel-comp-rank')?.value || 1, 10),
      is_winner: parseInt(document.getElementById('intel-comp-rank')?.value || 1, 10) === 1
    };
    await fetch(`/api/opportunities/${oppId}/competitors`, {
      method: 'POST',
      headers: API.getHeaders(),
      body: JSON.stringify(payload)
    });
    showToast('✓ Competitor bid logged!', 'success');
    this.openTenderIntelModal(oppId);
  },

  // ==========================================================================
  // PHASE 7: STATL BULK TAXPAYER VERIFIER & PHASE 9: BANK ADVICE EXPORTER
  // ==========================================================================
  async openStatlBulkVerifierModal() {
    const res = await API.runStatlBulkVerify();
    const list = (res && res.data) || [];
    this.showDynamicModal(`🔍 FBR STATL Bulk Taxpayer Status Verifier (${list.length} Parties Checked)`, `
      <div style="display:flex; gap:12px; margin-bottom:12px;">
        <div style="flex:1; background:#ecfdf5; border:1px solid #a7f3d0; padding:10px; border-radius:6px; font-weight:700; color:#065f46;">
          ✅ Active ATL Filers: ${res.active_filers || 0}
        </div>
        <div style="flex:1; background:#fef2f2; border:1px solid #fecaca; padding:10px; border-radius:6px; font-weight:700; color:#991b1b;">
          ⚠️ Non-Filers (Double WHT / +4% Further Tax): ${res.non_filers || 0}
        </div>
      </div>
      <div class="table-responsive" style="max-height:340px; overflow-y:auto;">
        <table class="data-table">
          <thead><tr><th>Party Type</th><th>Business Name</th><th>NTN</th><th>FBR STATL Status</th><th>Applicable WHT Rule</th></tr></thead>
          <tbody>
            ${list.map(p => `
              <tr>
                <td><span class="badge">${escapeHtml(p.party_type)}</span></td>
                <td style="font-weight:700;">${escapeHtml(p.business_name)}</td>
                <td style="font-family:monospace;">${escapeHtml(p.ntn)}</td>
                <td style="font-weight:700; color:${p.atl_status.includes('Active') ? '#059669' : '#dc2626'};">${escapeHtml(p.atl_status)}</td>
                <td style="font-size:0.78rem;">${escapeHtml(p.wht_tier)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `);
  },

  async exportPayrollBankAdviceCSV(runId) {
    const res = await API.getPayrollBankAdvice(runId);
    const rows = (res && res.data) || [];
    if (rows.length === 0) {
      showToast('No employee payslips found for this payroll run.', 'warning');
      return;
    }
    const headers = ['Employee_Code', 'Account_Title', 'CNIC', 'Bank_Name', 'IBAN_Account_Number', 'Gross_Salary_PKR', 'FBR_Sec149_Tax_PKR', 'Net_Transfer_Amount_PKR'];
    const csvLines = [
      headers.join(','),
      ...rows.map(r => [
        `"${r.employee_code || ''}"`,
        `"${r.bank_account_title || (r.first_name + ' ' + (r.last_name || '')).trim()}"`,
        `"${r.cnic || ''}"`,
        `"${r.bank_name || 'HBL / Corporate Bank'}"`,
        `"${r.bank_iban || ''}"`,
        r.gross_salary || 0,
        r.income_tax_deduction || 0,
        r.net_salary || 0
      ].join(','))
    ];
    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Mashrue_Bank_Salary_Transfer_Advice_${rows[0].payroll_month}_${rows[0].payroll_year}.csv`;
    a.click();
    showToast('✓ Corporate Bank Salary Transfer CSV downloaded!', 'success');
  },

  // ==========================================================================
  // SUPER ADMIN MODULE LICENSING MATRIX MODAL
  // ==========================================================================
  async openTenantModuleLicenseModal(tenantId, tenantName) {
    const res = await API.getTenantModules(tenantId);
    const rows = (res && res.data) || [];
    const activeMap = {};
    rows.forEach(r => { activeMap[r.module_key] = r.is_active !== false; });
    const catalog = (typeof State !== 'undefined' && State.MODULE_CATALOG) ? State.MODULE_CATALOG : [];

    this.showDynamicModal(`🔐 Commercial Module Licensing — ${escapeHtml(tenantName || 'Tenant')}`, `
      <p style="margin:0 0 12px; font-size:0.84rem; color:#475569;">Select which standalone commercial modules are licensed for this organization:</p>
      <form onsubmit="event.preventDefault(); ModularERP.submitTenantModuleLicenses('${tenantId}');">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; max-height:360px; overflow-y:auto; margin-bottom:14px;">
          ${catalog.map(m => {
            const checked = activeMap[m.key] !== false ? 'checked' : '';
            return `
              <label style="display:flex; align-items:flex-start; gap:8px; padding:10px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; cursor:pointer;">
                <input type="checkbox" class="erp-mod-lic-chk" value="${m.key}" ${checked} style="margin-top:3px;">
                <div>
                  <div style="font-weight:700; font-size:0.84rem; color:#0f172a;">${escapeHtml(m.name)}</div>
                  <div style="font-size:0.74rem; color:#64748b;">${escapeHtml(m.description)}</div>
                </div>
              </label>
            `;
          }).join('')}
        </div>
        <div class="modal-footer">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save Module Licenses</button>
        </div>
      </form>
    `);
  },

  async submitTenantModuleLicenses(tenantId) {
    const chks = Array.from(document.querySelectorAll('.erp-mod-lic-chk'));
    const modules = chks.map(c => ({ module_key: c.value, is_active: c.checked }));
    const res = await API.updateTenantModules(tenantId, { modules });
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Tenant module licenses updated!', 'success');
    }
  },

  // ==========================================================================
  // DYNAMIC MODULE-BASED DASHBOARD ENGINE (GAP 1)
  // ==========================================================================
  async renderModularDashboardSection(activeFilter = 'all', ctx = {}) {
    if (typeof State === 'undefined' || !State.currentUser) return '';

    const canTenders = typeof State.canUserAccessModule === 'function' ? State.canUserAccessModule('mod_tenders', 'opportunities') : true;
    const canRadar = typeof State.canUserAccessModule === 'function' ? State.canUserAccessModule('mod_notifications', 'tender-radar') : true;
    const canCrm = typeof State.canUserAccessModule === 'function' ? State.canUserAccessModule('mod_crm', 'crm') : true;
    const canInventory = typeof State.canUserAccessModule === 'function' ? State.canUserAccessModule('mod_inventory', 'inventory') : true;
    const canFinance = typeof State.canUserAccessModule === 'function' ? (State.canUserAccessModule('mod_finance', 'accounting') || State.canUserAccessModule('mod_finance', 'payments')) : true;
    const canTax = typeof State.canUserAccessModule === 'function' ? State.canUserAccessModule('mod_tax_compliance', 'tax-compliance') : true;
    const canHrm = typeof State.canUserAccessModule === 'function' ? State.canUserAccessModule('mod_hrm', 'hrm') : true;
    const canPayroll = typeof State.canUserAccessModule === 'function' ? State.canUserAccessModule('mod_payroll', 'payroll') : true;
    const canMfg = typeof State.canUserAccessModule === 'function' ? State.canUserAccessModule('mod_manufacturing', 'manufacturing') : true;

    const availableTabs = [{ key: 'all', label: '🌐 All My Permitted Modules' }];
    if (canTenders) availableTabs.push({ key: 'tenders', label: '📑 Tenders & Bidding' });
    if (canRadar) availableTabs.push({ key: 'tender_radar', label: '📡 Tender Radar' });
    if (canCrm) availableTabs.push({ key: 'crm', label: '🎯 Sales CRM' });
    if (canInventory) availableTabs.push({ key: 'inventory', label: '🏬 Warehouse & Transfers' });
    if (canFinance || canTax) availableTabs.push({ key: 'finance', label: '📒 Accounting & TaxGuard' });
    if (canHrm || canPayroll) availableTabs.push({ key: 'hrm_payroll', label: '👥 HRM & Payroll' });
    if (canMfg) availableTabs.push({ key: 'manufacturing', label: '🏭 Manufacturing ERP' });

    window.setDashboardModuleFilter = (filterKey) => {
      window._activeDashboardModuleFilter = filterKey;
      if (typeof renderActiveView === 'function') renderActiveView();
    };

    const filterBarHTML = `
      <div class="card" style="margin-bottom: 0; padding: 12px 18px; background: #f8fafc; border: 1px solid #e2e8f0;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 6px; font-size: 0.82rem; font-weight: 700; color: #475569;">
            <span>⚡ Module Filter:</span>
          </div>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            ${availableTabs.map(t => `
              <button type="button" class="tab-btn ${(activeFilter === t.key || (!activeFilter && t.key === 'all')) ? 'active' : ''}" 
                style="padding: 4px 12px; font-size: 0.78rem; font-weight: 700;"
                onclick="window.setDashboardModuleFilter('${t.key}')">
                ${t.label}
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    // Fetch live summary counts in parallel for active module views
    const shouldShowCrm = canCrm && (activeFilter === 'all' || activeFilter === 'crm');
    const shouldShowHrm = (canHrm || canPayroll) && (activeFilter === 'all' || activeFilter === 'hrm_payroll');
    const shouldShowMfg = canMfg && (activeFilter === 'all' || activeFilter === 'manufacturing');
    const shouldShowRadar = canRadar && (activeFilter === 'all' || activeFilter === 'tender_radar');

    let crmLeads = [], hrmEmps = [], mfgWos = [], radarNotices = [];
    try {
      const promises = [];
      if (shouldShowCrm) promises.push(this.request('/crm/leads', 'GET', null, 'erp_crm_leads').then(r => crmLeads = r.data || []).catch(() => {}));
      if (shouldShowHrm) promises.push(this.request('/hrm/employees', 'GET', null, 'erp_hrm_employees').then(r => hrmEmps = r.data || []).catch(() => {}));
      if (shouldShowMfg) promises.push(this.request('/mfg/work-orders', 'GET', null, 'erp_mfg_work_orders').then(r => mfgWos = r.data || []).catch(() => {}));
      if (shouldShowRadar) promises.push(this.request('/radar/notices?status=Active', 'GET', null, 'erp_radar_notices').then(r => radarNotices = r.data || []).catch(() => {}));
      await Promise.all(promises);
    } catch (e) {}

    const crmTotalPipeline = crmLeads.reduce((s, l) => s + parseFloat(l.estimated_deal_value || 0), 0);
    const crmWonCount = crmLeads.filter(l => l.pipeline_stage === 'Won').length;
    const hrmTotalGross = hrmEmps.reduce((s, e) => s + parseFloat(e.gross_salary || 0), 0);
    const mfgActiveWos = mfgWos.filter(w => w.status !== 'Completed').length;

    let moduleSpecificCardsHTML = '';

    // 1. Sales CRM Dashboard Widget
    if (shouldShowCrm) {
      moduleSpecificCardsHTML += `
        <div class="card" style="margin-bottom: 0; border-left: 4px solid #0284c7;">
          <div class="card-header" style="background:#ffffff; padding:12px 18px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.1rem;">🎯</span>
              <strong style="font-size:0.95rem; color:#0f172a;">Sales CRM &amp; Pipeline Dashboard</strong>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="ModularERP.openCrmActivityModal()">📞 + Log Call</button>
              <button class="primary-btn" style="padding:3px 10px; font-size:0.75rem;" onclick="ModularERP.openCrmLeadModal()">➕ + New Lead</button>
              <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="switchView('crm')">View Pipeline &rarr;</button>
            </div>
          </div>
          <div style="padding: 14px 18px;">
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">
              <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:8px; padding:10px 14px;">
                <div style="font-size:0.74rem; font-weight:700; color:#0369a1; text-transform:uppercase;">Active CRM Leads</div>
                <div style="font-size:1.3rem; font-weight:800; color:#0f172a; margin-top:2px;">${crmLeads.length} Leads</div>
                <div style="font-size:0.72rem; color:#64748b;">${crmWonCount} Converted to Customers</div>
              </div>
              <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:10px 14px;">
                <div style="font-size:0.74rem; font-weight:700; color:#166534; text-transform:uppercase;">Est. Deal Pipeline</div>
                <div style="font-size:1.3rem; font-weight:800; color:#059669; margin-top:2px; font-family:monospace;">${formatCurrency(crmTotalPipeline)}</div>
                <div style="font-size:0.72rem; color:#64748b;">Potential contract volume</div>
              </div>
              <div style="background:#faf5ff; border:1px solid #e9d5ff; border-radius:8px; padding:10px 14px;">
                <div style="font-size:0.74rem; font-weight:700; color:#7e22ce; text-transform:uppercase;">Conversion Rate</div>
                <div style="font-size:1.3rem; font-weight:800; color:#7c3aed; margin-top:2px;">${crmLeads.length > 0 ? Math.round((crmWonCount / crmLeads.length) * 100) : 0}%</div>
                <div style="font-size:0.72rem; color:#64748b;">Direct client win ratio</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 2. HRM & Payroll Dashboard Widget
    if (shouldShowHrm) {
      moduleSpecificCardsHTML += `
        <div class="card" style="margin-bottom: 0; border-left: 4px solid #16a34a;">
          <div class="card-header" style="background:#ffffff; padding:12px 18px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.1rem;">👥</span>
              <strong style="font-size:0.95rem; color:#0f172a;">HRM &amp; Corporate Payroll Dashboard</strong>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem; background:#f0fdf4; color:#166534; border-color:#bbf7d0; font-weight:700;" onclick="ModularERP.markAllStaffPresentToday()">✅ All Present Today</button>
              <button class="primary-btn" style="padding:3px 10px; font-size:0.75rem;" onclick="ModularERP.runMonthlyPayroll()">💳 Run Payroll</button>
              <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="switchView('hrm')">Staff Desk &rarr;</button>
            </div>
          </div>
          <div style="padding: 14px 18px;">
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px;">
                <div style="font-size:0.74rem; font-weight:700; color:#475569; text-transform:uppercase;">Active Staff</div>
                <div style="font-size:1.3rem; font-weight:800; color:#0f172a; margin-top:2px;">${hrmEmps.length} Employees</div>
                <div style="font-size:0.72rem; color:#64748b;">Registered on Master Payroll</div>
              </div>
              <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:10px 14px;">
                <div style="font-size:0.74rem; font-weight:700; color:#166534; text-transform:uppercase;">Monthly Payroll Budget</div>
                <div style="font-size:1.3rem; font-weight:800; color:#16a34a; margin-top:2px; font-family:monospace;">${formatCurrency(hrmTotalGross)}</div>
                <div style="font-size:0.72rem; color:#64748b;">Gross monthly salary bill</div>
              </div>
              <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px 14px;">
                <div style="font-size:0.74rem; font-weight:700; color:#1d4ed8; text-transform:uppercase;">Tax &amp; Compliance</div>
                <div style="font-size:1.1rem; font-weight:800; color:#1e40af; margin-top:4px;">FBR Sec 149 Active</div>
                <div style="font-size:0.72rem; color:#64748b;">Automated Tax Slab Deduction</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 3. Manufacturing ERP Dashboard Widget
    if (shouldShowMfg) {
      moduleSpecificCardsHTML += `
        <div class="card" style="margin-bottom: 0; border-left: 4px solid #7c3aed;">
          <div class="card-header" style="background:#ffffff; padding:12px 18px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.1rem;">🏭</span>
              <strong style="font-size:0.95rem; color:#0f172a;">Manufacturing ERP (BOM &amp; Work Orders)</strong>
            </div>
            <div style="display:flex; gap:6px;">
              <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="ModularERP.openAddBomModal()">📐 + New BOM</button>
              <button class="primary-btn" style="padding:3px 10px; font-size:0.75rem;" onclick="ModularERP.openAddWorkOrderModal()">🏭 + Issue Work Order</button>
              <button class="secondary-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="switchView('manufacturing')">Shop Floor &rarr;</button>
            </div>
          </div>
          <div style="padding: 14px 18px;">
            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">
              <div style="background:#faf5ff; border:1px solid #e9d5ff; border-radius:8px; padding:10px 14px;">
                <div style="font-size:0.74rem; font-weight:700; color:#7e22ce; text-transform:uppercase;">In-Progress Work Orders</div>
                <div style="font-size:1.3rem; font-weight:800; color:#0f172a; margin-top:2px;">${mfgActiveWos} Active</div>
                <div style="font-size:0.72rem; color:#64748b;">Factory production jobs</div>
              </div>
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px 14px;">
                <div style="font-size:0.74rem; font-weight:700; color:#475569; text-transform:uppercase;">Total Orders Logged</div>
                <div style="font-size:1.3rem; font-weight:800; color:#0284c7; margin-top:2px;">${mfgWos.length} Orders</div>
                <div style="font-size:0.72rem; color:#64748b;">Auto-flush raw &rarr; finished SKU</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // 4. PPRA & EPADS Tender Radar Dashboard Widget
    if (shouldShowRadar && radarNotices.length > 0) {
      moduleSpecificCardsHTML += `
        <div class="card" style="margin-bottom: 0; border-left: 4px solid #0284c7;">
          <div class="card-header" style="background:#ffffff; padding:12px 18px; display:flex; justify-content:space-between; align-items:center;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.1rem;">📡</span>
              <strong style="font-size:0.95rem; color:#0f172a;">Live PPRA &amp; EPADS Tender Radar Matches</strong>
            </div>
            <button class="primary-btn" style="padding:3px 10px; font-size:0.75rem;" onclick="switchView('tender-radar')">Open Tender Radar &rarr;</button>
          </div>
          <div style="padding: 10px 18px;">
            <div style="font-size:0.8rem; color:#64748b;">Found <strong>${radarNotices.length} active public tenders</strong> matching your commercial keywords today.</div>
          </div>
        </div>
      `;
    }

    return `
      ${filterBarHTML}
      ${moduleSpecificCardsHTML}
    `;
  },

  // ==========================================================================
  // CUSTOMER 360° COMPREHENSIVE COMMERCIAL PROFILE (CRM & FINANCE & TENDERS)
  // ==========================================================================
  async openCustomer360Modal(customerId, compName = 'Customer') {
    let profileData = null;
    if (customerId && typeof API !== 'undefined' && API.getCrmCustomer360) {
      try {
        const res = await API.getCrmCustomer360(customerId);
        if (res && res.success) profileData = res.data;
      } catch (e) {
        console.warn('360 fetch error:', e.message);
      }
    }

    const cust = profileData?.customer || { name: compName, id: customerId };
    const fin = profileData?.financial_summary || {};
    const invoices = profileData?.invoices || (window._dashInvoices || []).filter(i => String(i.customer_id) === String(customerId) || i.customer_name === compName);
    const opps = profileData?.opportunities || [];
    const contacts = profileData?.contacts || [];
    const cases = profileData?.cases || [];
    const activities = profileData?.activities || [];

    const totalBilled = fin.total_billed !== undefined ? fin.total_billed : invoices.reduce((s, i) => s + parseFloat(i.total_amount || 0), 0);
    const totalPaid = fin.total_paid !== undefined ? fin.total_paid : invoices.reduce((s, i) => s + parseFloat(i.paid_amount || 0), 0);
    const totalOutstanding = fin.outstanding_balance !== undefined ? fin.outstanding_balance : Math.max(0, totalBilled - totalPaid);

    this.showDynamicModal(`🏢 Customer 360° Profile — ${escapeHtml(cust.name || compName)}`, `
      <!-- KPI Metric Strip -->
      <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:10px; margin-bottom:14px;">
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:10px;">
          <div style="font-size:0.7rem; color:#64748b; font-weight:700;">TOTAL BILLED</div>
          <div style="font-size:1.1rem; font-weight:800; color:#0f172a; font-family:monospace;">${formatCurrency(totalBilled)}</div>
        </div>
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:10px;">
          <div style="font-size:0.7rem; color:#166534; font-weight:700;">TOTAL COLLECTED</div>
          <div style="font-size:1.1rem; font-weight:800; color:#059669; font-family:monospace;">${formatCurrency(totalPaid)}</div>
        </div>
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:8px; padding:10px;">
          <div style="font-size:0.7rem; color:#991b1b; font-weight:700;">OUTSTANDING RECEIVABLES</div>
          <div style="font-size:1.1rem; font-weight:800; color:#dc2626; font-family:monospace;">${formatCurrency(totalOutstanding)}</div>
        </div>
        <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px;">
          <div style="font-size:0.7rem; color:#1e40af; font-weight:700;">ACTIVE DEALS & CASES</div>
          <div style="font-size:1.1rem; font-weight:800; color:#2563eb; font-family:monospace;">${opps.length} Deals • ${cases.length} Cases</div>
        </div>
      </div>

      <!-- Customer Master Details Box -->
      <div style="margin-bottom:14px; font-size:0.82rem; color:#475569; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:12px;">
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:8px;">
          <div><strong>Classification:</strong> ${escapeHtml(cust.classification || 'Standard')}</div>
          <div><strong>Industry:</strong> ${escapeHtml(cust.industry || 'General')}</div>
          <div><strong>Territory:</strong> ${escapeHtml(cust.territory || cust.city || 'Pakistan')}</div>
          <div><strong>NTN / STRN:</strong> ${escapeHtml(cust.ntn || 'N/A')} / ${escapeHtml(cust.strn || 'N/A')}</div>
          <div><strong>Phone / Contact:</strong> ${escapeHtml(cust.phone || cust.contact_person || '—')}</div>
          <div><strong>Email:</strong> ${escapeHtml(cust.email || '—')}</div>
        </div>
      </div>

      <!-- Linked Deals & Invoices Split Grid -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:14px;">
        <!-- Deals -->
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px;">
          <div style="font-weight:700; font-size:0.85rem; color:#0f172a; margin-bottom:6px;">💼 Opportunities (${opps.length})</div>
          <div style="max-height:160px; overflow-y:auto;">
            ${opps.length === 0 ? '<div style="font-size:0.75rem; color:#94a3b8; padding:8px;">No commercial deals linked.</div>' : opps.map(o => `
              <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid #f1f5f9; font-size:0.76rem;">
                <span style="font-weight:600;">${escapeHtml(o.title)}</span>
                <span style="font-weight:700; color:#059669; font-family:monospace;">${formatCurrency(o.expected_value || 0)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Invoices -->
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px;">
          <div style="font-weight:700; font-size:0.85rem; color:#0f172a; margin-bottom:6px;">🧾 Sales Invoices (${invoices.length})</div>
          <div style="max-height:160px; overflow-y:auto;">
            ${invoices.length === 0 ? '<div style="font-size:0.75rem; color:#94a3b8; padding:8px;">No sales invoices linked.</div>' : invoices.map(i => `
              <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid #f1f5f9; font-size:0.76rem;">
                <span style="font-family:monospace; color:#0284c7; font-weight:700;">${escapeHtml(i.invoice_number)}</span>
                <span style="font-weight:700; font-family:monospace;">${formatCurrency(i.total_amount)}</span>
                <span class="badge ${i.status === 'Paid' ? 'badge-won' : 'badge-hold'}" style="font-size:0.65rem;">${escapeHtml(i.status)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Contacts Directory -->
      ${contacts.length > 0 ? `
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:10px; margin-bottom:14px;">
          <div style="font-weight:700; font-size:0.85rem; color:#0f172a; margin-bottom:6px;">📇 Key Decision Makers & Contacts (${contacts.length})</div>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:8px;">
            ${contacts.map(ct => `
              <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px; font-size:0.76rem;">
                <div style="font-weight:700; color:#0f172a;">${escapeHtml(ct.contact_name)} ${ct.is_primary ? '⭐' : ''}</div>
                <div style="color:#64748b;">${escapeHtml(ct.designation || 'Contact')}</div>
                <div style="color:#0284c7;">${escapeHtml(ct.phone || ct.email || '')}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="modal-footer" style="padding-top:10px;">
        <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Close</button>
        <button type="button" class="primary-btn" onclick="closeModal('modal-erp-dynamic'); openNewQuotationModal();">💬 New Quote for Client</button>
      </div>
    `);
  },

  async deleteCrmLead(leadId, leadName) {
    if (!confirm(`Are you sure you want to delete CRM Lead "${leadName}"?`)) return;
    let res;
    if (typeof API !== 'undefined' && API.deleteCrmLead) {
      res = await API.deleteCrmLead(leadId);
    } else {
      res = await this.request(`/crm/leads/${leadId}`, 'DELETE');
    }
    if (res && res.success) {
      showToast('✓ Lead deleted successfully.', 'success');
      this.switchCrmTab('leads');
    } else {
      showToast(res?.message || 'Failed to delete lead.', 'error');
    }
  },

  async openEditCrmLeadModal(leadId) {
    const leads = (this._cachedLeads || []);
    const l = leads.find(item => String(item.id) === String(leadId)) || { id: leadId };
    this.showDynamicModal(`✏️ Edit CRM Lead — ${escapeHtml(l.company_name || 'Lead')}`, `
      <form onsubmit="event.preventDefault(); ModularERP.submitEditCrmLead('${leadId}');">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Company / Organization *</label>
            <input type="text" class="form-input" id="erp-editlead-comp" required value="${escapeHtml(l.company_name || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Contact Person</label>
            <input type="text" class="form-input" id="erp-editlead-contact" value="${escapeHtml(l.contact_name || '')}">
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Phone / WhatsApp</label>
            <input type="text" class="form-input" id="erp-editlead-phone" value="${escapeHtml(l.contact_phone || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Estimated Deal Value (PKR)</label>
            <input type="number" class="form-input" id="erp-editlead-val" value="${l.estimated_deal_value || 0}">
          </div>
          <div class="form-group">
            <label class="form-label">Win Probability (%)</label>
            <input type="number" class="form-input" id="erp-editlead-prob" value="${l.win_probability || 30}" min="0" max="100">
          </div>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Update Lead</button>
        </div>
      </form>
    `);
  },

  async submitEditCrmLead(leadId) {
    const payload = {
      company_name: document.getElementById('erp-editlead-comp')?.value,
      contact_name: document.getElementById('erp-editlead-contact')?.value,
      contact_phone: document.getElementById('erp-editlead-phone')?.value,
      estimated_deal_value: parseFloat(document.getElementById('erp-editlead-val')?.value || 0),
      win_probability: parseInt(document.getElementById('erp-editlead-prob')?.value || 30, 10)
    };
    let res;
    if (typeof API !== 'undefined' && API.updateCrmLead) {
      res = await API.updateCrmLead(leadId, payload);
    } else {
      res = await this.request(`/crm/leads/${leadId}`, 'PUT', payload);
    }
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Lead updated successfully!', 'success');
      this.switchCrmTab('leads');
    }
  },

  // ==========================================================================
  // HRM 1-CLICK ALL PRESENT TODAY & EDIT EMPLOYEE (GAP 3)
  // ==========================================================================
  async markAllStaffPresentToday() {
    const emps = this._cachedEmployees || [];
    if (emps.length === 0) {
      showToast('No active employees registered yet.', 'warning');
      return;
    }
    const today = new Date().toISOString().split('T')[0];
    let logged = 0;
    for (const e of emps) {
      await this.request('/hrm/attendance', 'POST', {
        employee_id: e.id,
        attendance_date: today,
        status: 'Present',
        check_in_time: '09:00',
        check_out_time: '17:30'
      }).catch(() => {});
      logged++;
    }
    showToast(`✓ Marked all ${logged} active employees Present for today!`, 'success');
    renderActiveView();
  },

  async openEditEmployeeModal(empId) {
    const emps = this._cachedEmployees || [];
    const e = emps.find(item => String(item.id) === String(empId)) || { id: empId };
    this.showDynamicModal(`✏️ Edit Employee Profile — ${escapeHtml(e.first_name || '')} ${escapeHtml(e.last_name || '')}`, `
      <form onsubmit="event.preventDefault(); ModularERP.submitEditEmployee('${empId}');">
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">First Name *</label>
            <input type="text" class="form-input" id="erp-editemp-fname" required value="${escapeHtml(e.first_name || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Last Name</label>
            <input type="text" class="form-input" id="erp-editemp-lname" value="${escapeHtml(e.last_name || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">CNIC *</label>
            <input type="text" class="form-input" id="erp-editemp-cnic" required value="${escapeHtml(e.cnic || '')}">
          </div>
        </div>
        <div class="form-row-3">
          <div class="form-group">
            <label class="form-label">Monthly Gross Salary (PKR) *</label>
            <input type="number" class="form-input" id="erp-editemp-gross" required value="${e.gross_salary || 100000}" min="1">
          </div>
          <div class="form-group">
            <label class="form-label">Bank Name</label>
            <input type="text" class="form-input" id="erp-editemp-bank" value="${escapeHtml(e.bank_name || 'HBL')}">
          </div>
          <div class="form-group">
            <label class="form-label">Bank IBAN</label>
            <input type="text" class="form-input" id="erp-editemp-iban" value="${escapeHtml(e.bank_iban || '')}">
          </div>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">💾 Save Changes</button>
        </div>
      </form>
    `);
  },

  async submitEditEmployee(empId) {
    const gross = parseFloat(document.getElementById('erp-editemp-gross')?.value || 0);
    const basic = Math.round(gross * 0.60);
    const payload = {
      first_name: document.getElementById('erp-editemp-fname')?.value,
      last_name: document.getElementById('erp-editemp-lname')?.value,
      cnic: document.getElementById('erp-editemp-cnic')?.value,
      basic_salary: basic,
      gross_salary: gross,
      bank_name: document.getElementById('erp-editemp-bank')?.value,
      bank_iban: document.getElementById('erp-editemp-iban')?.value
    };
    const res = await this.request(`/hrm/employees/${empId}`, 'PUT', payload);
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('✓ Employee record updated!', 'success');
      renderActiveView();
    }
  },

  async updateLeaveStatus(leaveId, status) {
    const res = await this.request(`/hrm/leaves/${leaveId}/status`, 'PUT', { status });
    if (res && res.success) {
      showToast(`✓ Leave application ${status}!`, 'success');
      renderActiveView();
    }
  },

  // ==========================================================================
  // MANUFACTURING PRE-PRODUCTION SHORTAGE CALCULATOR (GAP 3)
  // ==========================================================================
  async openBomShortageModal(bomId) {
    const boms = this._cachedBoms || [];
    const bom = boms.find(b => String(b.id) === String(bomId));
    if (!bom) return;

    const prods = (this._cachedProducts || []);
    const components = Array.isArray(bom.components) ? bom.components : [];

    const rows = components.map(c => {
      const p = prods.find(item => String(item.id) === String(c.raw_material_product_id)) || {};
      const curStock = parseFloat(p.stock_quantity || 0);
      const reqPerUnit = parseFloat(c.required_quantity || 1);
      const scrap = parseFloat(c.scrap_allowance_pct || 0);
      const effectiveReq = reqPerUnit * (1 + scrap / 100);
      const maxUnitsPossible = curStock > 0 ? Math.floor(curStock / effectiveReq) : 0;
      return {
        name: c.raw_material_name || p.name || 'Component SKU',
        stock: curStock,
        reqPerUnit: effectiveReq.toFixed(2),
        maxUnits: maxUnitsPossible,
        isShort: curStock < effectiveReq
      };
    });

    const minBatchCapacity = rows.length > 0 ? Math.min(...rows.map(r => r.maxUnits)) : 0;

    this.showDynamicModal(`🔍 Pre-Production Raw Material Shortage Check — ${escapeHtml(bom.bom_code)}`, `
      <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:8px; padding:12px; margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-size:0.75rem; color:#166534; font-weight:700;">MAX READY-TO-PRODUCE BATCH CAPACITY</div>
          <div style="font-size:1.4rem; font-weight:800; color:#0f172a; margin-top:2px;">${minBatchCapacity} Units Finished Goods</div>
        </div>
        <button class="primary-btn" style="padding:5px 12px; font-size:0.78rem;" onclick="closeModal('modal-erp-dynamic'); ModularERP.openAddWorkOrderModal();">
          🏭 Issue Work Order
        </button>
      </div>

      <div class="table-responsive">
        <table class="data-table">
          <thead>
            <tr>
              <th>Raw Material Component</th>
              <th style="text-align:right;">Current Warehouse Stock</th>
              <th style="text-align:right;">Req. per FG Unit</th>
              <th style="text-align:right;">Max FG Capacity</th>
              <th>Shortage Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="font-weight:700;">${escapeHtml(r.name)}</td>
                <td style="text-align:right; font-family:monospace; font-weight:700;">${r.stock} Units</td>
                <td style="text-align:right; font-family:monospace;">${r.reqPerUnit}</td>
                <td style="text-align:right; font-family:monospace; font-weight:800;">${r.maxUnits} FG Units</td>
                <td>
                  ${r.isShort ? `
                    <span class="badge" style="background:#fef2f2; color:#dc2626; border:1px solid #fecaca; font-weight:700;">⚠️ Shortage (Zero Batch)</span>
                  ` : `
                    <span class="badge badge-won">✓ In Stock</span>
                  `}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="modal-footer" style="padding-top:12px;">
        <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Close</button>
      </div>
    `);
  },

  // ==========================================================================
  // UNIVERSAL DYNAMIC MODAL HELPER FOR MODULAR ERP
  // ==========================================================================
  showDynamicModal(title, bodyHtml) {
    let modal = document.getElementById('modal-erp-dynamic');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modal-erp-dynamic';
      modal.className = 'modal-backdrop';
      modal.innerHTML = `
        <div class="modal-card modal-lg" style="max-width: 740px;">
          <div class="modal-header" style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); color: white;">
            <h2 id="modal-erp-dynamic-title" style="font-size: 1.12rem; font-weight: 700; color: white; margin: 0;"></h2>
            <button class="modal-close-btn" style="color:white;" onclick="closeModal('modal-erp-dynamic')">&times;</button>
          </div>
          <div class="modal-body" id="modal-erp-dynamic-body" style="padding: 20px;"></div>
        </div>
      `;
      document.body.appendChild(modal);
    }
    const titleEl = document.getElementById('modal-erp-dynamic-title');
    const bodyEl = document.getElementById('modal-erp-dynamic-body');
    if (titleEl) titleEl.innerHTML = title;
    if (bodyEl) bodyEl.innerHTML = bodyHtml;
    openModal('modal-erp-dynamic');
    if (typeof initCustomDateTimePickers === 'function') initCustomDateTimePickers();
  }
};

window.ModularERP = ModularERP;

