/**
 * ============================================================================
 * MASHRUE ENTERPRISE CORE HRM ENGINE (services/hrmService.js)
 * ============================================================================
 * Handles:
 *  - Employee Master Lifecycle (Onboard -> Edit -> Offboard/Terminate -> Rehire)
 *  - Departments, Designations & Org Hierarchy
 *  - Attendance Tracking & Monthly Hours / Overtime Summary
 *  - Stateful Leave Management (Pending -> Approved / Rejected / Cancelled)
 *    with Overlap Validation & Leave Balance Quotas
 *  - Optional Non-Blocking Sync to mod_payroll when licensed
 *  - Immutable Audit Logging
 * ============================================================================
 */

const db = require('../config/db');

function round2(n) {
  const v = Number(n || 0);
  return isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;
}

class HrmService {
  async logAudit(client, { tenantId, entityType, entityId, action, userId = null, userName = 'HR Admin', details = {} }) {
    const qClient = client || db;
    await qClient.query(
      `INSERT INTO hrm_audit_logs (tenant_id, entity_type, entity_id, action, user_id, user_name, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [tenantId, entityType, String(entityId), action, userId, userName || 'HR Admin', JSON.stringify(details)]
    );
  }

  async ensureDefaultPolicies(client, tenantId) {
    const qClient = client || db;
    const check = await qClient.query(`SELECT id FROM hrm_leave_policies WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
    if (check.rows.length === 0) {
      const defaults = [
        ['Annual', 14, true, true, 30],
        ['Casual', 10, true, false, 5],
        ['Medical', 10, true, false, 15],
        ['Unpaid', 60, false, false, 60]
      ];
      for (const [lt, quota, paid, cf, maxC] of defaults) {
        await qClient.query(
          `INSERT INTO hrm_leave_policies (tenant_id, leave_type, annual_quota, is_paid, carry_forward, max_consecutive_days)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (tenant_id, leave_type) DO NOTHING`,
          [tenantId, lt, quota, paid, cf, maxC]
        );
      }
    }
  }

  async initializeEmployeeBalances(client, tenantId, employeeId, year = null) {
    const qClient = client || db;
    const yr = parseInt(year || new Date().getFullYear(), 10);
    await this.ensureDefaultPolicies(qClient, tenantId);
    const policies = await qClient.query(`SELECT * FROM hrm_leave_policies WHERE tenant_id = $1 AND is_active = TRUE`, [tenantId]);
    for (const p of policies.rows) {
      await qClient.query(
        `INSERT INTO hrm_leave_balances (tenant_id, employee_id, leave_year, leave_type, allocated_days, used_days)
         VALUES ($1,$2,$3,$4,$5,0) ON CONFLICT (employee_id, leave_year, leave_type) DO NOTHING`,
        [tenantId, employeeId, yr, p.leave_type, p.annual_quota]
      );
    }
  }

  async getDashboard(tenantId) {
    await this.ensureDefaultPolicies(null, tenantId);
    const todayStr = new Date().toISOString().slice(0, 10);
    const [empRes, todayAttRes, pendLvRes, deptRes] = await Promise.all([
      db.query(
        `SELECT COUNT(*) FILTER (WHERE employment_status = 'Active') as active_count,
                COUNT(*) FILTER (WHERE employment_status = 'Terminated') as terminated_count,
                COALESCE(SUM(gross_salary) FILTER (WHERE employment_status = 'Active'), 0) as active_payroll
         FROM hrm_employees WHERE tenant_id = $1`,
        [tenantId]
      ),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE status = 'Present') as present_today,
                COUNT(*) FILTER (WHERE status = 'Absent') as absent_today,
                COUNT(*) FILTER (WHERE status = 'On Leave') as on_leave_today
         FROM hrm_attendance WHERE tenant_id = $1 AND attendance_date = $2::date`,
        [tenantId, todayStr]
      ),
      db.query(`SELECT COUNT(*) as pending_leaves FROM hrm_leave_applications WHERE tenant_id = $1 AND status = 'Pending'`, [tenantId]),
      db.query(`SELECT COUNT(*) as depts FROM hrm_departments WHERE tenant_id = $1 AND COALESCE(is_active, TRUE) = TRUE`, [tenantId])
    ]);

    return {
      active_employees: parseInt(empRes.rows[0]?.active_count || 0, 10),
      terminated_employees: parseInt(empRes.rows[0]?.terminated_count || 0, 10),
      monthly_gross_commitment: round2(empRes.rows[0]?.active_payroll || 0),
      present_today: parseInt(todayAttRes.rows[0]?.present_today || 0, 10),
      absent_today: parseInt(todayAttRes.rows[0]?.absent_today || 0, 10),
      on_leave_today: parseInt(todayAttRes.rows[0]?.on_leave_today || 0, 10),
      pending_leaves: parseInt(pendLvRes.rows[0]?.pending_leaves || 0, 10),
      active_departments: parseInt(deptRes.rows[0]?.depts || 0, 10)
    };
  }

  async createEmployee(client, tenantId, data, { userId = null, userName = 'HR Admin' } = {}) {
    const qClient = client || db;
    if (!data.first_name || !data.cnic) {
      throw new Error('First Name and CNIC are mandatory.');
    }
    const empCode = data.employee_code || `EMP-${Date.now().toString().slice(-4)}`;
    const basic = parseFloat(data.basic_salary || 0);
    const gross = parseFloat(data.gross_salary || 0);
    const hra = parseFloat(data.house_rent_allowance !== undefined ? data.house_rent_allowance : Math.round(basic * 0.30));
    const med = parseFloat(data.medical_allowance !== undefined ? data.medical_allowance : Math.round(basic * 0.10));
    const conv = parseFloat(data.conveyance_allowance !== undefined ? data.conveyance_allowance : 0);
    const other = parseFloat(data.other_allowances || 0);
    const finalGross = gross > 0 ? gross : (basic + hra + med + conv + other);

    const empRes = await qClient.query(
      `INSERT INTO hrm_employees (
        tenant_id, business_profile_id, user_id, employee_code, first_name, last_name, cnic,
        gender, date_of_birth, department_id, designation_id, department_name, designation_name,
        employment_type, joining_date, official_email, personal_phone, current_address,
        bank_name, bank_account_title, bank_iban, basic_salary, gross_salary, filer_status,
        manager_id, shift_hours, employment_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,'Active')
      RETURNING *`,
      [
        tenantId,
        data.business_profile_id || null,
        data.user_id || null,
        empCode,
        data.first_name.trim(),
        (data.last_name || '').trim(),
        data.cnic.trim(),
        data.gender || 'Male',
        data.date_of_birth || null,
        data.department_id || null,
        data.designation_id || null,
        data.department_name || 'Operations',
        data.designation_name || 'Staff',
        data.employment_type || 'Permanent',
        data.joining_date || new Date().toISOString().slice(0, 10),
        data.official_email || '',
        data.personal_phone || '',
        data.current_address || '',
        data.bank_name || '',
        data.bank_account_title || `${data.first_name} ${data.last_name || ''}`.trim(),
        data.bank_iban || '',
        basic,
        finalGross,
        data.filer_status || 'Filer',
        data.manager_id || null,
        parseFloat(data.shift_hours || 8.0),
      ]
    );
    const emp = empRes.rows[0];

    await qClient.query(
      `INSERT INTO payroll_salary_structures (
        tenant_id, employee_id, basic_salary, house_rent_allowance,
        medical_allowance, conveyance_allowance, other_allowances, gross_salary, eobi_enabled, income_tax_auto
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,TRUE)
      ON CONFLICT (employee_id) DO UPDATE SET
        basic_salary = EXCLUDED.basic_salary,
        house_rent_allowance = EXCLUDED.house_rent_allowance,
        medical_allowance = EXCLUDED.medical_allowance,
        conveyance_allowance = EXCLUDED.conveyance_allowance,
        other_allowances = EXCLUDED.other_allowances,
        gross_salary = EXCLUDED.gross_salary`,
      [tenantId, emp.id, basic, hra, med, conv, other, finalGross]
    );

    // Bi-directional unified Employee sync to payroll_employee_profiles
    await qClient.query(
      `INSERT INTO payroll_employee_profiles (
        tenant_id, hrm_employee_id, user_id, employee_code, full_name, email, phone,
        national_tax_id, department, designation, hire_date, basic_salary,
        house_rent_allowance, medical_allowance, conveyance_allowance, other_allowances,
        bank_name, bank_iban, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'Active')
      ON CONFLICT (tenant_id, employee_code) DO UPDATE SET
        hrm_employee_id = EXCLUDED.hrm_employee_id,
        full_name = EXCLUDED.full_name,
        basic_salary = EXCLUDED.basic_salary,
        house_rent_allowance = EXCLUDED.house_rent_allowance,
        medical_allowance = EXCLUDED.medical_allowance,
        conveyance_allowance = EXCLUDED.conveyance_allowance,
        other_allowances = EXCLUDED.other_allowances,
        bank_name = COALESCE(EXCLUDED.bank_name, payroll_employee_profiles.bank_name),
        bank_iban = COALESCE(EXCLUDED.bank_iban, payroll_employee_profiles.bank_iban),
        updated_at = NOW()`,
      [
        tenantId, emp.id, data.user_id || null, empCode,
        `${data.first_name} ${data.last_name || ''}`.trim(),
        data.official_email || null, data.personal_phone || null, data.cnic.trim(),
        data.department_name || 'Operations', data.designation_name || 'Staff',
        data.joining_date || new Date().toISOString().slice(0, 10),
        basic, hra, med, conv, other,
        data.bank_name || null, data.bank_iban || null
      ]
    ).catch(() => {});

    await this.initializeEmployeeBalances(qClient, tenantId, emp.id);
    await this.logAudit(qClient, {
      tenantId, entityType: 'employee', entityId: emp.id, action: 'ONBOARDED',
      userId, userName, details: { employee_code: empCode, gross_salary: finalGross }
    });

    return { ...emp, gross_salary: finalGross };
  }

  async updateEmployee(client, tenantId, empId, data, { userId = null, userName = 'HR Admin' } = {}) {
    const qClient = client || db;
    const existing = await qClient.query(`SELECT * FROM hrm_employees WHERE id = $1 AND tenant_id = $2`, [empId, tenantId]);
    if (existing.rows.length === 0) throw new Error('Employee record not found.');
    const cur = existing.rows[0];

    const firstName = data.first_name !== undefined ? String(data.first_name).trim() : cur.first_name;
    const lastName = data.last_name !== undefined ? String(data.last_name).trim() : cur.last_name;
    const cnic = data.cnic !== undefined ? String(data.cnic).trim() : cur.cnic;
    const deptName = data.department_name !== undefined ? data.department_name : cur.department_name;
    const desigName = data.designation_name !== undefined ? data.designation_name : cur.designation_name;
    const basic = data.basic_salary !== undefined ? parseFloat(data.basic_salary) : parseFloat(cur.basic_salary || 0);
    const gross = data.gross_salary !== undefined ? parseFloat(data.gross_salary) : parseFloat(cur.gross_salary || 0);

    const upd = await qClient.query(
      `UPDATE hrm_employees
       SET first_name = $1, last_name = $2, cnic = $3,
           department_id = COALESCE($4, department_id),
           designation_id = COALESCE($5, designation_id),
           department_name = $6, designation_name = $7,
           employment_type = COALESCE($8, employment_type),
           official_email = COALESCE($9, official_email),
           personal_phone = COALESCE($10, personal_phone),
           bank_name = COALESCE($11, bank_name),
           bank_account_title = COALESCE($12, bank_account_title),
           bank_iban = COALESCE($13, bank_iban),
           basic_salary = $14, gross_salary = $15,
           employment_status = COALESCE($16, employment_status),
           shift_hours = COALESCE($17, shift_hours),
           updated_at = NOW()
       WHERE id = $18 AND tenant_id = $19 RETURNING *`,
      [
        firstName, lastName, cnic,
        data.department_id || null, data.designation_id || null,
        deptName, desigName,
        data.employment_type || null, data.official_email || null, data.personal_phone || null,
        data.bank_name || null, data.bank_account_title || null, data.bank_iban || null,
        basic, gross, data.employment_status || null,
        data.shift_hours !== undefined ? parseFloat(data.shift_hours) : null,
        empId, tenantId
      ]
    );

    await qClient.query(
      `INSERT INTO payroll_salary_structures (
        tenant_id, employee_id, basic_salary, gross_salary
      ) VALUES ($1,$2,$3,$4)
      ON CONFLICT (employee_id) DO UPDATE SET
        basic_salary = EXCLUDED.basic_salary,
        gross_salary = EXCLUDED.gross_salary`,
      [tenantId, empId, basic, gross]
    );

    // Optional sync to Payroll Profile if table exists & linked
    await qClient.query(
      `UPDATE payroll_employee_profiles
       SET full_name = $1, basic_salary = $2, bank_name = COALESCE($3, bank_name), bank_iban = COALESCE($4, bank_iban), updated_at = NOW()
       WHERE tenant_id = $5 AND hrm_employee_id = $6`,
      [`${firstName} ${lastName || ''}`.trim(), basic, data.bank_name || null, data.bank_iban || null, tenantId, empId]
    ).catch(() => {});

    await this.logAudit(qClient, {
      tenantId, entityType: 'employee', entityId: empId, action: 'UPDATED',
      userId, userName, details: { first_name: firstName, gross_salary: gross }
    });

    return upd.rows[0];
  }

  async terminateEmployee(client, tenantId, empId, { termination_date = null, termination_reason = 'Resignation' } = {}, { userId = null, userName = 'HR Admin' } = {}) {
    const qClient = client || db;
    const termDate = termination_date || new Date().toISOString().slice(0, 10);
    const upd = await qClient.query(
      `UPDATE hrm_employees
       SET employment_status = 'Terminated', termination_date = $1::date, termination_reason = $2, updated_at = NOW()
       WHERE id = $3 AND tenant_id = $4 RETURNING *`,
      [termDate, termination_reason, empId, tenantId]
    );
    if (upd.rows.length === 0) throw new Error('Employee not found.');

    // Sync termination date cleanly if Payroll module table is present (for proration & final settlement)
    await qClient.query(
      `UPDATE payroll_employee_profiles
       SET termination_date = $1::date, status = 'Terminated', updated_at = NOW()
       WHERE tenant_id = $2 AND hrm_employee_id = $3`,
      [termDate, tenantId, empId]
    ).catch(() => {});

    await this.logAudit(qClient, {
      tenantId, entityType: 'employee', entityId: empId, action: 'TERMINATED',
      userId, userName, details: { termination_date: termDate, termination_reason }
    });

    return upd.rows[0];
  }

  async submitLeaveRequest(client, tenantId, data, { userId = null, userName = 'Employee' } = {}) {
    const qClient = client || db;
    const { employee_id, leave_type = 'Casual', start_date, end_date, total_days, reason = '' } = data;
    if (!employee_id || !start_date || !end_date) {
      throw new Error('Employee, start date, and end date are required.');
    }
    const sDate = new Date(start_date).toISOString().slice(0, 10);
    const eDate = new Date(end_date).toISOString().slice(0, 10);
    if (eDate < sDate) throw new Error('End date cannot be earlier than start date.');

    const empRes = await qClient.query(`SELECT id, first_name, employment_status FROM hrm_employees WHERE id = $1 AND tenant_id = $2`, [employee_id, tenantId]);
    if (empRes.rows.length === 0) throw new Error('Employee not found in this tenant.');
    if (empRes.rows[0].employment_status === 'Terminated') {
      throw new Error('Cannot submit leave request for a Terminated employee.');
    }

    // Overlap check against existing Pending or Approved leaves
    const overlap = await qClient.query(
      `SELECT id, start_date, end_date, status FROM hrm_leave_applications
       WHERE tenant_id = $1 AND employee_id = $2 AND status IN ('Pending', 'Approved')
         AND start_date <= $3::date AND end_date >= $4::date LIMIT 1`,
      [tenantId, employee_id, eDate, sDate]
    );
    if (overlap.rows.length > 0) {
      throw new Error(`Overlapping ${overlap.rows[0].status} leave exists for the selected dates.`);
    }

    const days = parseFloat(total_days || Math.max(1, Math.round((new Date(eDate) - new Date(sDate)) / 86400000) + 1));
    const yr = new Date(sDate).getUTCFullYear();
    await this.initializeEmployeeBalances(qClient, tenantId, employee_id, yr);

    // Validate balance if paid leave quota exists
    const balRes = await qClient.query(
      `SELECT * FROM hrm_leave_balances WHERE employee_id = $1 AND leave_year = $2 AND leave_type = $3`,
      [employee_id, yr, leave_type]
    );
    if (balRes.rows.length > 0 && leave_type !== 'Unpaid') {
      const remaining = parseFloat(balRes.rows[0].allocated_days) - parseFloat(balRes.rows[0].used_days);
      if (days > remaining) {
        throw new Error(`Insufficient ${leave_type} leave balance (${remaining} days remaining, requested ${days}).`);
      }
    }

    const reqStatus = (data.status === 'Pending' || data.status === 'Approved') ? data.status : 'Pending';
    const ins = await qClient.query(
      `INSERT INTO hrm_leave_applications
       (tenant_id, employee_id, leave_type, start_date, end_date, total_days, reason, status, approved_by, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [tenantId, employee_id, leave_type, sDate, eDate, days, reason, reqStatus, reqStatus === 'Approved' ? userId : null, reqStatus === 'Approved' ? new Date() : null]
    );

    if (reqStatus === 'Approved') {
      await qClient.query(
        `UPDATE hrm_leave_balances SET used_days = used_days + $1, updated_at = NOW()
         WHERE employee_id = $2 AND leave_year = $3 AND leave_type = $4`,
        [days, employee_id, yr, leave_type]
      );
    }

    await this.logAudit(qClient, {
      tenantId, entityType: 'leave_application', entityId: ins.rows[0].id, action: `SUBMITTED_${reqStatus.toUpperCase()}`,
      userId, userName, details: { employee_id, leave_type, days }
    });

    return ins.rows[0];
  }

  async updateLeaveStatus(client, tenantId, leaveId, { status, rejection_reason = '' }, { userId = null, userName = 'HR Manager' } = {}) {
    const qClient = client || db;
    const validTarget = ['Approved', 'Rejected', 'Cancelled'];
    if (!validTarget.includes(status)) throw new Error('Invalid leave status transition.');

    const curRes = await qClient.query(`SELECT * FROM hrm_leave_applications WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [leaveId, tenantId]);
    if (curRes.rows.length === 0) throw new Error('Leave application not found.');
    const cur = curRes.rows[0];
    if (cur.status === status) return cur;

    const yr = new Date(cur.start_date).getUTCFullYear();
    await this.initializeEmployeeBalances(qClient, tenantId, cur.employee_id, yr);

    if (status === 'Approved' && cur.status !== 'Approved') {
      if (cur.leave_type !== 'Unpaid') {
        const balRes = await qClient.query(
          `SELECT allocated_days, used_days FROM hrm_leave_balances WHERE employee_id = $1 AND leave_year = $2 AND leave_type = $3`,
          [cur.employee_id, yr, cur.leave_type]
        );
        if (balRes.rows.length > 0) {
          const rem = parseFloat(balRes.rows[0].allocated_days) - parseFloat(balRes.rows[0].used_days);
          if (parseFloat(cur.total_days) > rem) {
            throw new Error(`Insufficient ${cur.leave_type} leave balance (${rem} remaining).`);
          }
        }
      }
      await qClient.query(
        `UPDATE hrm_leave_balances SET used_days = used_days + $1, updated_at = NOW()
         WHERE employee_id = $2 AND leave_year = $3 AND leave_type = $4`,
        [cur.total_days, cur.employee_id, yr, cur.leave_type]
      );
    } else if (cur.status === 'Approved' && (status === 'Rejected' || status === 'Cancelled')) {
      await qClient.query(
        `UPDATE hrm_leave_balances SET used_days = GREATEST(0, used_days - $1), updated_at = NOW()
         WHERE employee_id = $2 AND leave_year = $3 AND leave_type = $4`,
        [cur.total_days, cur.employee_id, yr, cur.leave_type]
      );
    }

    const upd = await qClient.query(
      `UPDATE hrm_leave_applications
       SET status = $1::varchar,
           approved_by = CASE WHEN $1::varchar = 'Approved' THEN $2::uuid ELSE approved_by END,
           approved_at = CASE WHEN $1::varchar = 'Approved' THEN NOW() ELSE approved_at END,
           rejection_reason = CASE WHEN $1::varchar IN ('Rejected','Cancelled') THEN $3::text ELSE rejection_reason END,
           updated_at = NOW()
       WHERE id = $4 AND tenant_id = $5 RETURNING *`,
      [status, userId, rejection_reason || '', leaveId, tenantId]
    );

    await this.logAudit(qClient, {
      tenantId, entityType: 'leave_application', entityId: leaveId, action: `STATUS_${status.toUpperCase()}`,
      userId, userName, details: { prev_status: cur.status, new_status: status, days: cur.total_days }
    });

    return upd.rows[0];
  }
}

module.exports = new HrmService();
