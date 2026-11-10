/**
 * ============================================================================
 * MASHRUE ENTERPRISE CORE HRM FRONTEND (Frontend/js/hrm.js)
 * ============================================================================
 * Multi-tab HR suite for:
 *  - Employee Directory, Onboarding, Editing & Offboarding
 *  - Attendance Sheet & 1-Click All-Present Check-In
 *  - Pending -> Approved / Rejected Leave Desk & Quota Balances
 *  - Leave Policies, Departments, Designations & Holiday Calendar
 *  - HR Audit Log
 * ============================================================================
 */

const HrmModule = {
  _tab: 'employees',
  _cache: { kpis: {}, employees: [], attendance: [], leaves: [], balances: [], meta: {}, logs: [] },

  async api(path, method = 'GET', body = null) {
    try {
      const base = typeof API_BASE !== 'undefined' ? API_BASE : '/api';
      const opts = {
        method,
        headers: typeof API !== 'undefined' && API.getHeaders ? API.getHeaders() : { 'Content-Type': 'application/json' }
      };
      if (body && (method === 'POST' || method === 'PUT')) opts.body = JSON.stringify(body);
      const r = await fetch(`${base}/hrm${path}`, opts);
      return await r.json();
    } catch (e) {
      return { success: false, message: e.message, data: [] };
    }
  },

  switchTab(t) {
    this._tab = t;
    const viewMap = {
      'employees': 'hrm',
      'attendance': 'hrm-attendance',
      'leaves': 'hrm-leaves',
      'policies': 'hrm-policies',
      'audit': 'hrm-audit'
    };
    const nextView = viewMap[t] || 'hrm';
    if (typeof switchView === 'function' && typeof State !== 'undefined' && State.activeView !== nextView) {
      switchView(nextView);
    } else if (typeof renderActiveView === 'function') {
      renderActiveView();
    }
  },

  async renderHTML() {
    const curYear = new Date().getFullYear();
    const [kpiRes, empRes, attRes, lvRes, balRes, metaRes, logRes] = await Promise.all([
      this.api('/dashboard'),
      this.api('/employees'),
      this.api('/attendance'),
      this.api('/leaves'),
      this.api(`/leave-balances?year=${curYear}`),
      this.api('/meta'),
      this._tab === 'audit' ? this.api('/audit-logs') : Promise.resolve({ data: [] })
    ]);

    const kpis = kpiRes.data || {};
    const employees = empRes.data || [];
    const attendance = attRes.data || [];
    const leaves = lvRes.data || [];
    const balances = balRes.data || [];
    const meta = metaRes.data || {};
    const logs = logRes.data || [];
    this._cache = { kpis, employees, attendance, leaves, balances, meta, logs };

    const tabBtn = (id, label) => `
      <button class="secondary-btn" style="border:none; border-bottom:3px solid ${this._tab === id ? '#0284c7' : 'transparent'}; border-radius:0; font-weight:700; color:${this._tab === id ? '#0284c7' : '#64748b'}; background:transparent; padding:8px 14px;" onclick="HrmModule.switchTab('${id}')">${label}</button>
    `;

    return `
      <div class="kpi-grid" style="margin-bottom:16px;">
        <div class="kpi-card">
          <div class="kpi-label">Active Workforce</div>
          <div class="kpi-value" style="color:#0284c7;">${kpis.active_employees || employees.filter(e => e.employment_status !== 'Terminated').length}</div>
          <div class="kpi-trend positive">${kpis.active_departments || 0} Departments</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Monthly Gross Commitment</div>
          <div class="kpi-value" style="color:#059669;">${formatCurrency(kpis.monthly_gross_commitment || 0)}</div>
          <div class="kpi-trend">Active Staff Base</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Present Today</div>
          <div class="kpi-value" style="color:#0f172a;">${kpis.present_today || 0}</div>
          <div class="kpi-trend">${kpis.on_leave_today || 0} On Leave</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Pending Leave Approvals</div>
          <div class="kpi-value" style="color:#d97706;">${kpis.pending_leaves || 0}</div>
          <div class="kpi-trend">Requires HR Action</div>
        </div>
      </div>

      ${this.renderTab()}
    `;
  },

  renderTab() {
    if (this._tab === 'attendance') return this.renderAttendanceTab();
    if (this._tab === 'leaves') return this.renderLeavesTab();
    if (this._tab === 'policies') return this.renderPoliciesTab();
    if (this._tab === 'audit') return this.renderAuditTab();
    return this.renderEmployeesTab();
  },

  renderEmployeesTab() {
    const employees = this._cache.employees || [];
    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <h3 style="margin:0; font-size:1.05rem; font-weight:800;">Employee Master Directory</h3>
            <p style="margin:2px 0 0; font-size:0.78rem; color:#64748b;">Employee onboarding, salary packages, edits & offboarding</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="secondary-btn" onclick="HrmModule.markAllPresentToday()">1-Click All Present Today</button>
            <button class="primary-btn" onclick="HrmModule.openEmployeeModal()">+ Register Employee</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Code</th><th>Employee & CNIC</th><th>Dept / Designation</th>
                  <th style="text-align:right;">Gross Salary</th><th>Status</th><th style="text-align:center;">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${employees.length === 0 ? `<tr><td colspan="6" style="text-align:center; padding:22px; color:#64748b;">No employees registered yet.</td></tr>` : employees.map(e => `
                  <tr>
                    <td style="font-family:monospace; font-weight:700; color:#0284c7;">${escapeHtml(e.employee_code)}</td>
                    <td>
                      <div style="font-weight:700;">${escapeHtml(e.first_name)} ${escapeHtml(e.last_name || '')}</div>
                      <div style="font-size:0.73rem; color:#64748b;">CNIC: ${escapeHtml(e.cnic || '—')}</div>
                    </td>
                    <td>
                      <div style="font-weight:600;">${escapeHtml(e.desig_display || e.designation_name || 'Staff')}</div>
                      <div style="font-size:0.73rem; color:#64748b;">${escapeHtml(e.dept_display || e.department_name || 'Operations')}</div>
                    </td>
                    <td style="text-align:right; font-family:monospace; font-weight:700; color:#059669;">${formatCurrency(e.gross_salary || 0)}</td>
                    <td><span class="badge ${e.employment_status === 'Terminated' ? 'badge-withdraw' : 'badge-won'}">${escapeHtml(e.employment_status || 'Active')}</span></td>
                    <td style="text-align:center;">
                      <button class="edit-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="HrmModule.openEmployeeModal('${e.id}')">Edit</button>
                      ${e.employment_status !== 'Terminated' ? `<button class="delete-btn" style="padding:3px 8px; font-size:0.75rem;" onclick="HrmModule.terminateEmployee('${e.id}')">Offboard</button>` : ''}
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

  renderAttendanceTab() {
    const attendance = this._cache.attendance || [];
    return `
      <div class="card">
        <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 style="margin:0; font-size:1.05rem; font-weight:800;">Daily Attendance Matrix</h3>
          <div style="display:flex; gap:8px;">
            <button class="secondary-btn" onclick="HrmModule.markAllPresentToday()">Mark All Present Today</button>
            <button class="primary-btn" onclick="HrmModule.openAttendanceModal()">+ Log Attendance</button>
          </div>
        </div>
        <div class="card-body" style="padding:0;">
          <div class="table-responsive">
            <table class="data-table">
              <thead><tr><th>Date</th><th>Employee</th><th>Hours</th><th>Check In / Out</th><th>Status</th></tr></thead>
              <tbody>
                ${attendance.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:20px; color:#64748b;">No attendance logs recorded yet.</td></tr>` : attendance.slice(0, 100).map(a => `
                  <tr>
                    <td>${formatDateDDMMYYYY(a.attendance_date)}</td>
                    <td style="font-weight:700;">${escapeHtml(a.first_name || '')} ${escapeHtml(a.last_name || '')} <span style="color:#64748b; font-size:0.75rem;">(${escapeHtml(a.employee_code || '')})</span></td>
                    <td style="font-family:monospace;">${parseFloat(a.work_hours || 8).toFixed(1)}h</td>
                    <td style="font-family:monospace; font-size:0.78rem;">${escapeHtml(a.check_in_time || '09:00')} - ${escapeHtml(a.check_out_time || '17:30')}</td>
                    <td><span class="badge ${a.status === 'Absent' ? 'badge-withdraw' : 'badge-won'}">${escapeHtml(a.status)}</span></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  renderLeavesTab() {
    const leaves = this._cache.leaves || [];
    const balances = this._cache.balances || [];
    return `
      <div style="display:grid; grid-template-columns: 1.4fr 1fr; gap:16px;">
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; font-size:1rem; font-weight:800;">Leave Applications Queue</h3>
            <button class="primary-btn" onclick="HrmModule.openLeaveModal()">+ Submit Leave Request</button>
          </div>
          <div class="card-body" style="padding:0;">
            <div class="table-responsive">
              <table class="data-table">
                <thead><tr><th>Employee</th><th>Type</th><th>Dates (Days)</th><th>Status</th><th style="text-align:center;">Action</th></tr></thead>
                <tbody>
                  ${leaves.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:20px; color:#64748b;">No leave applications.</td></tr>` : leaves.map(l => `
                    <tr>
                      <td style="font-weight:700;">${escapeHtml(l.first_name || '')} ${escapeHtml(l.last_name || '')}</td>
                      <td><span class="badge" style="background:#e0f2fe; color:#0369a1;">${escapeHtml(l.leave_type)}</span></td>
                      <td style="font-size:0.78rem;">${formatDateDDMMYYYY(l.start_date)} - ${formatDateDDMMYYYY(l.end_date)} (${l.total_days}d)</td>
                      <td><span class="badge ${l.status === 'Approved' ? 'badge-won' : (l.status === 'Rejected' || l.status === 'Cancelled' ? 'badge-withdraw' : 'badge-submitted')}">${escapeHtml(l.status || 'Pending')}</span></td>
                      <td style="text-align:center;">
                        ${l.status === 'Pending' ? `
                          <button class="primary-btn" style="padding:2px 7px; font-size:0.72rem; background:#059669;" onclick="HrmModule.updateLeaveStatus('${l.id}','Approved')">Approve</button>
                          <button class="delete-btn" style="padding:2px 7px; font-size:0.72rem;" onclick="HrmModule.updateLeaveStatus('${l.id}','Rejected')">Reject</button>
                        ` : '—'}
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header"><h3 style="margin:0; font-size:1rem; font-weight:800;">Employee Leave Quotas (${new Date().getFullYear()})</h3></div>
          <div class="card-body" style="padding:0; max-height:420px; overflow-y:auto;">
            <table class="data-table">
              <thead><tr><th>Employee</th><th>Type</th><th style="text-align:right;">Used / Alloc</th><th style="text-align:right;">Rem</th></tr></thead>
              <tbody>
                ${balances.length === 0 ? `<tr><td colspan="4" style="text-align:center; padding:20px; color:#64748b;">Quotas initialized per leave policy.</td></tr>` : balances.map(b => `
                  <tr>
                    <td style="font-weight:600; font-size:0.8rem;">${escapeHtml(b.first_name || '')} (${escapeHtml(b.employee_code || '')})</td>
                    <td>${escapeHtml(b.leave_type)}</td>
                    <td style="text-align:right; font-family:monospace;">${b.used_days} / ${b.allocated_days}</td>
                    <td style="text-align:right; font-family:monospace; font-weight:700; color:#059669;">${b.remaining_days}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  renderPoliciesTab() {
    const policies = (this._cache.meta && this._cache.meta.leave_policies) || [];
    const holidays = (this._cache.meta && this._cache.meta.holidays) || [];
    return `
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
        <div class="card">
          <div class="card-header"><h3 style="margin:0; font-size:1rem; font-weight:800;">Leave Policies & Annual Quotas</h3></div>
          <div class="card-body" style="padding:0;">
            <table class="data-table">
              <thead><tr><th>Leave Type</th><th>Paid</th><th>Annual Quota (Days)</th></tr></thead>
              <tbody>
                ${policies.map(p => `
                  <tr>
                    <td style="font-weight:700;">${escapeHtml(p.leave_type)}</td>
                    <td>${p.is_paid ? 'Yes (Paid)' : 'No (Unpaid)'}</td>
                    <td style="font-family:monospace; font-weight:700;">${p.annual_quota} days/yr</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        <div class="card">
          <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; font-size:1rem; font-weight:800;">Public Holidays Calendar</h3>
            <button class="primary-btn" onclick="HrmModule.openHolidayModal()">+ Add Holiday</button>
          </div>
          <div class="card-body" style="padding:0;">
            <table class="data-table">
              <thead><tr><th>Date</th><th>Holiday</th><th>Type</th></tr></thead>
              <tbody>
                ${holidays.length === 0 ? `<tr><td colspan="3" style="text-align:center; padding:18px; color:#64748b;">No holidays scheduled yet.</td></tr>` : holidays.map(h => `
                  <tr>
                    <td>${formatDateDDMMYYYY(h.holiday_date)}</td>
                    <td style="font-weight:700;">${escapeHtml(h.holiday_name)}</td>
                    <td>${escapeHtml(h.holiday_type)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  renderAuditTab() {
    const logs = this._cache.logs || [];
    return `
      <div class="card">
        <div class="card-header"><h3 style="margin:0; font-size:1rem; font-weight:800;">HRM Lifecycle Audit Trail</h3></div>
        <div class="card-body" style="padding:0;">
          <table class="data-table">
            <thead><tr><th>Timestamp</th><th>Entity</th><th>Action</th><th>By</th><th>Details</th></tr></thead>
            <tbody>
              ${logs.length === 0 ? `<tr><td colspan="5" style="text-align:center; padding:20px; color:#64748b;">No HR audit logs recorded yet.</td></tr>` : logs.map(l => `
                <tr>
                  <td style="font-size:0.78rem;">${new Date(l.created_at).toLocaleString()}</td>
                  <td>${escapeHtml(l.entity_type)}</td>
                  <td><span class="badge">${escapeHtml(l.action)}</span></td>
                  <td>${escapeHtml(l.user_name || 'System')}</td>
                  <td style="font-family:monospace; font-size:0.75rem;">${escapeHtml(JSON.stringify(l.details || {}))}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  openEmployeeModal(empId = null) {
    const e = empId ? (this._cache.employees || []).find(x => String(x.id) === String(empId)) || {} : {};
    ModularERP.showDynamicModal(empId ? `Edit Employee (${escapeHtml(e.employee_code || '')})` : 'Register Employee', `
      <form onsubmit="event.preventDefault(); HrmModule.saveEmployee('${empId || ''}');">
        <div class="form-row-3">
          <div class="form-group"><label class="form-label">First Name *</label><input type="text" class="form-input" id="hrm-emp-fname" required value="${escapeHtml(e.first_name || '')}"></div>
          <div class="form-group"><label class="form-label">Last Name</label><input type="text" class="form-input" id="hrm-emp-lname" value="${escapeHtml(e.last_name || '')}"></div>
          <div class="form-group"><label class="form-label">CNIC *</label><input type="text" class="form-input" id="hrm-emp-cnic" required value="${escapeHtml(e.cnic || '')}"></div>
        </div>
        <div class="form-row-3">
          <div class="form-group"><label class="form-label">Department</label><input type="text" class="form-input" id="hrm-emp-dept" value="${escapeHtml(e.dept_display || e.department_name || 'Operations')}"></div>
          <div class="form-group"><label class="form-label">Designation</label><input type="text" class="form-input" id="hrm-emp-desig" value="${escapeHtml(e.desig_display || e.designation_name || 'Executive')}"></div>
          <div class="form-group"><label class="form-label">Monthly Gross Salary *</label><input type="number" class="form-input" id="hrm-emp-gross" required value="${e.gross_salary || 100000}" min="1"></div>
        </div>
        <div class="form-row-3">
          <div class="form-group"><label class="form-label">Bank Name</label><input type="text" class="form-input" id="hrm-emp-bank" value="${escapeHtml(e.bank_name || '')}"></div>
          <div class="form-group"><label class="form-label">Bank IBAN</label><input type="text" class="form-input" id="hrm-emp-iban" value="${escapeHtml(e.bank_iban || '')}"></div>
          <div class="form-group"><label class="form-label">Shift Hours/Day</label><input type="number" step="0.5" class="form-input" id="hrm-emp-shift" value="${e.shift_hours || 8}"></div>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">Save Employee</button>
        </div>
      </form>
    `);
  },

  async saveEmployee(empId) {
    const gross = parseFloat(document.getElementById('hrm-emp-gross')?.value || 0);
    const payload = {
      first_name: document.getElementById('hrm-emp-fname')?.value,
      last_name: document.getElementById('hrm-emp-lname')?.value,
      cnic: document.getElementById('hrm-emp-cnic')?.value,
      department_name: document.getElementById('hrm-emp-dept')?.value,
      designation_name: document.getElementById('hrm-emp-desig')?.value,
      basic_salary: Math.round(gross * 0.6),
      gross_salary: gross,
      bank_name: document.getElementById('hrm-emp-bank')?.value,
      bank_iban: document.getElementById('hrm-emp-iban')?.value,
      shift_hours: parseFloat(document.getElementById('hrm-emp-shift')?.value || 8)
    };
    const res = await this.api(empId ? `/employees/${empId}` : '/employees', empId ? 'PUT' : 'POST', payload);
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast(res.message || 'Employee saved.', 'success');
      renderActiveView();
    } else {
      showToast(res.message || 'Failed to save employee.', 'error');
    }
  },

  async terminateEmployee(empId) {
    const reason = prompt('Enter separation / termination reason:', 'Resignation');
    if (reason === null) return;
    const res = await this.api(`/employees/${empId}/terminate`, 'POST', { termination_reason: reason });
    if (res && res.success) {
      showToast('Employee offboarded.', 'success');
      renderActiveView();
    } else {
      showToast(res.message || 'Failed.', 'error');
    }
  },

  async markAllPresentToday() {
    const res = await this.api('/attendance/mark-all-present', 'POST', {});
    if (res && res.success) {
      showToast(res.message || 'Marked all present!', 'success');
      renderActiveView();
    }
  },

  openAttendanceModal() {
    const opts = (this._cache.employees || []).filter(e => e.employment_status !== 'Terminated')
      .map(e => `<option value="${e.id}">${escapeHtml(e.first_name)} ${escapeHtml(e.last_name || '')} (${escapeHtml(e.employee_code)})</option>`).join('');
    ModularERP.showDynamicModal('Log Daily Attendance', `
      <form onsubmit="event.preventDefault(); HrmModule.submitAttendance();">
        <div class="form-group"><label class="form-label">Employee *</label><select class="form-select" id="hrm-att-emp" required>${opts}</select></div>
        <div class="form-row-3">
          <div class="form-group"><label class="form-label">Date</label><input type="date" class="form-input" id="hrm-att-date" required value="${new Date().toISOString().split('T')[0]}"></div>
          <div class="form-group"><label class="form-label">Status</label><select class="form-select" id="hrm-att-status"><option value="Present">Present</option><option value="Late">Late</option><option value="Half Day">Half Day</option><option value="On Leave">On Leave</option><option value="Absent">Absent</option></select></div>
          <div class="form-group"><label class="form-label">Hours</label><input type="number" step="0.5" class="form-input" id="hrm-att-hrs" value="8"></div>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">Save Attendance</button>
        </div>
      </form>
    `);
  },

  async submitAttendance() {
    const res = await this.api('/attendance', 'POST', {
      employee_id: document.getElementById('hrm-att-emp')?.value,
      attendance_date: document.getElementById('hrm-att-date')?.value,
      status: document.getElementById('hrm-att-status')?.value,
      work_hours: parseFloat(document.getElementById('hrm-att-hrs')?.value || 8)
    });
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('Attendance logged.', 'success');
      renderActiveView();
    } else {
      showToast(res.message || 'Error logging attendance.', 'error');
    }
  },

  openLeaveModal() {
    const opts = (this._cache.employees || []).filter(e => e.employment_status !== 'Terminated')
      .map(e => `<option value="${e.id}">${escapeHtml(e.first_name)} ${escapeHtml(e.last_name || '')}</option>`).join('');
    ModularERP.showDynamicModal('Submit Leave Application', `
      <form onsubmit="event.preventDefault(); HrmModule.submitLeave();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Employee *</label><select class="form-select" id="hrm-lv-emp" required>${opts}</select></div>
          <div class="form-group"><label class="form-label">Leave Type</label><select class="form-select" id="hrm-lv-type"><option value="Casual">Casual</option><option value="Annual">Annual</option><option value="Medical">Medical</option><option value="Unpaid">Unpaid</option></select></div>
        </div>
        <div class="form-row-3">
          <div class="form-group"><label class="form-label">Start Date</label><input type="date" class="form-input" id="hrm-lv-start" required value="${new Date().toISOString().split('T')[0]}"></div>
          <div class="form-group"><label class="form-label">End Date</label><input type="date" class="form-input" id="hrm-lv-end" required value="${new Date().toISOString().split('T')[0]}"></div>
          <div class="form-group"><label class="form-label">Days</label><input type="number" step="0.5" min="0.5" class="form-input" id="hrm-lv-days" required value="1"></div>
        </div>
        <div class="form-group"><label class="form-label">Reason</label><input type="text" class="form-input" id="hrm-lv-reason"></div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">Submit (Pending Approval)</button>
        </div>
      </form>
    `);
  },

  async submitLeave() {
    const res = await this.api('/leaves', 'POST', {
      employee_id: document.getElementById('hrm-lv-emp')?.value,
      leave_type: document.getElementById('hrm-lv-type')?.value,
      start_date: document.getElementById('hrm-lv-start')?.value,
      end_date: document.getElementById('hrm-lv-end')?.value,
      total_days: parseFloat(document.getElementById('hrm-lv-days')?.value || 1),
      reason: document.getElementById('hrm-lv-reason')?.value,
      status: 'Pending'
    });
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast(res.message || 'Leave submitted for approval.', 'success');
      renderActiveView();
    } else {
      showToast(res.message || 'Leave request failed.', 'error');
    }
  },

  async updateLeaveStatus(leaveId, status) {
    const res = await this.api(`/leaves/${leaveId}/status`, 'PUT', { status });
    if (res && res.success) {
      showToast(res.message || `Leave ${status}.`, 'success');
      renderActiveView();
    } else {
      showToast(res.message || 'Update failed.', 'error');
    }
  },

  openHolidayModal() {
    ModularERP.showDynamicModal('Add Public Holiday', `
      <form onsubmit="event.preventDefault(); HrmModule.saveHoliday();">
        <div class="form-row">
          <div class="form-group"><label class="form-label">Date *</label><input type="date" class="form-input" id="hrm-hol-date" required></div>
          <div class="form-group"><label class="form-label">Name *</label><input type="text" class="form-input" id="hrm-hol-name" required placeholder="e.g. Pakistan Day"></div>
        </div>
        <div class="modal-footer" style="padding-top:12px;">
          <button type="button" class="secondary-btn" onclick="closeModal('modal-erp-dynamic')">Cancel</button>
          <button type="submit" class="primary-btn">Save Holiday</button>
        </div>
      </form>
    `);
  },

  async saveHoliday() {
    const res = await this.api('/holidays', 'POST', {
      holiday_date: document.getElementById('hrm-hol-date')?.value,
      holiday_name: document.getElementById('hrm-hol-name')?.value
    });
    if (res && res.success) {
      closeModal('modal-erp-dynamic');
      showToast('Holiday saved.', 'success');
      renderActiveView();
    }
  }
};

window.HrmModule = HrmModule;

