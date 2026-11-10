/**
 * ============================================================================
 * MASHRUE CORE HUMAN RESOURCE MANAGEMENT (HRM) CONTROLLER
 * Mounted at: /api/hrm (and aliased via /api/erp/hrm)
 * Module License: 'mod_hrm' — Works 100% Standalone; optional sync to Payroll
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate } = require('../middleware/auth.middleware');
const { requireModuleLicense, requirePermission, resolveTenantId } = require('../middleware/rbac.middleware');
const hrmService = require('../services/hrmService');

const hrmAuth = [authenticate, requireModuleLicense('mod_hrm')];

router.get('/dashboard', ...hrmAuth, requirePermission('hrm', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const kpis = await hrmService.getDashboard(tid);
    res.json({ success: true, data: kpis });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/meta', ...hrmAuth, requirePermission('hrm', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    await hrmService.ensureDefaultPolicies(null, tid);
    const [depts, desigs, policies, holidays] = await Promise.all([
      db.query(`SELECT * FROM hrm_departments WHERE tenant_id = $1 ORDER BY department_name ASC`, [tid]),
      db.query(`SELECT * FROM hrm_designations WHERE tenant_id = $1 ORDER BY designation_name ASC`, [tid]),
      db.query(`SELECT * FROM hrm_leave_policies WHERE tenant_id = $1 ORDER BY leave_type ASC`, [tid]),
      db.query(`SELECT * FROM hrm_holidays WHERE tenant_id = $1 ORDER BY holiday_date ASC`, [tid])
    ]);
    res.json({ success: true, data: { departments: depts.rows, designations: desigs.rows, leave_policies: policies.rows, holidays: holidays.rows } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/departments', ...hrmAuth, requirePermission('hrm', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(`SELECT * FROM hrm_departments WHERE tenant_id = $1 ORDER BY department_name ASC`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/departments', ...hrmAuth, requirePermission('hrm', 'add'), async (req, res) => {
  const { department_name, department_code } = req.body;
  if (!department_name) return res.status(400).json({ success: false, message: 'Department name is required.' });
  try {
    const tid = await resolveTenantId(req, db);
    const result = await db.query(
      `INSERT INTO hrm_departments (tenant_id, department_name, department_code) VALUES ($1,$2,$3) RETURNING *`,
      [tid, department_name.trim(), department_code || 'DEPT']
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/designations', ...hrmAuth, requirePermission('hrm', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(`SELECT * FROM hrm_designations WHERE tenant_id = $1 ORDER BY designation_name ASC`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/designations', ...hrmAuth, requirePermission('hrm', 'add'), async (req, res) => {
  const { designation_name, grade_level } = req.body;
  if (!designation_name) return res.status(400).json({ success: false, message: 'Designation name is required.' });
  try {
    const tid = await resolveTenantId(req, db);
    const result = await db.query(
      `INSERT INTO hrm_designations (tenant_id, designation_name, grade_level) VALUES ($1,$2,$3) RETURNING *`,
      [tid, designation_name.trim(), grade_level || 'G-1']
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Employees CRUD & Offboarding
router.get('/employees', ...hrmAuth, requirePermission('hrm', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const result = await db.query(
      `SELECT e.*,
              COALESCE(d.department_name, e.department_name, 'Operations') as dept_display,
              COALESCE(dg.designation_name, e.designation_name, 'Staff') as desig_display,
              dg.grade_level,
              s.basic_salary as s_basic, s.house_rent_allowance, s.medical_allowance,
              s.conveyance_allowance, s.other_allowances, COALESCE(s.gross_salary, e.gross_salary) as gross_salary, s.eobi_enabled
       FROM hrm_employees e
       LEFT JOIN hrm_departments d ON e.department_id = d.id
       LEFT JOIN hrm_designations dg ON e.designation_id = dg.id
       LEFT JOIN payroll_salary_structures s ON s.employee_id = e.id
       WHERE e.tenant_id = $1
       ORDER BY e.employee_code ASC, e.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/employees', ...hrmAuth, requirePermission('hrm', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const emp = await hrmService.createEmployee(client, tid, req.body, {
      userId: req.user?.id || null,
      userName: req.user?.full_name || req.user?.username || 'HR Admin'
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: emp, message: `Employee ${emp.employee_code} enrolled.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.put('/employees/:id', ...hrmAuth, requirePermission('hrm', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const emp = await hrmService.updateEmployee(client, tid, req.params.id, req.body, {
      userId: req.user?.id || null,
      userName: req.user?.full_name || req.user?.username || 'HR Admin'
    });
    await client.query('COMMIT');
    res.json({ success: true, data: emp, message: 'Employee profile updated.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.post('/employees/:id/terminate', ...hrmAuth, requirePermission('hrm', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const emp = await hrmService.terminateEmployee(client, tid, req.params.id, req.body, {
      userId: req.user?.id || null,
      userName: req.user?.full_name || req.user?.username || 'HR Admin'
    });
    await client.query('COMMIT');
    res.json({ success: true, data: emp, message: 'Employee offboarded/terminated cleanly.' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// Attendance Logs & Bulk Check-In
router.get('/attendance', ...hrmAuth, requirePermission('hrm', 'view'), async (req, res) => {
  const { attendance_date, month, year, employee_id } = req.query;
  try {
    const tid = await resolveTenantId(req, db);
    let queryText = `
      SELECT a.*, e.employee_code, e.first_name, e.last_name,
             COALESCE(d.department_name, e.department_name, 'Operations') as department_name,
             e.designation_name
      FROM hrm_attendance a
      JOIN hrm_employees e ON a.employee_id = e.id
      LEFT JOIN hrm_departments d ON e.department_id = d.id
      WHERE a.tenant_id = $1
    `;
    const params = [tid];
    if (attendance_date) {
      params.push(attendance_date);
      queryText += ` AND a.attendance_date = $${params.length}`;
    } else if (month && year) {
      params.push(parseInt(month, 10), parseInt(year, 10));
      queryText += ` AND EXTRACT(MONTH FROM a.attendance_date) = $${params.length - 1} AND EXTRACT(YEAR FROM a.attendance_date) = $${params.length}`;
    }
    if (employee_id) {
      params.push(employee_id);
      queryText += ` AND a.employee_id = $${params.length}`;
    }
    queryText += ` ORDER BY a.attendance_date DESC, e.employee_code ASC LIMIT 500`;
    const result = await db.query(queryText, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/attendance', ...hrmAuth, requirePermission('hrm', 'add'), async (req, res) => {
  const { employee_id, attendance_date, check_in_time, check_out_time, status, work_hours, remarks } = req.body;
  if (!employee_id) return res.status(400).json({ success: false, message: 'Employee is required.' });
  try {
    const tid = await resolveTenantId(req, db);
    const result = await db.query(
      `INSERT INTO hrm_attendance
       (tenant_id, employee_id, attendance_date, check_in_time, check_out_time, status, work_hours, remarks)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (employee_id, attendance_date)
       DO UPDATE SET
         check_in_time = EXCLUDED.check_in_time,
         check_out_time = EXCLUDED.check_out_time,
         status = EXCLUDED.status,
         work_hours = EXCLUDED.work_hours,
         remarks = EXCLUDED.remarks
       RETURNING *`,
      [
        tid, employee_id,
        attendance_date || new Date().toISOString().slice(0, 10),
        check_in_time || '09:00', check_out_time || '17:30',
        status || 'Present', parseFloat(work_hours !== undefined ? work_hours : 8.0), remarks || ''
      ]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/attendance/mark-all-present', ...hrmAuth, requirePermission('hrm', 'add'), async (req, res) => {
  const { attendance_date } = req.body;
  try {
    const tid = await resolveTenantId(req, db);
    const dateStr = attendance_date || new Date().toISOString().slice(0, 10);
    const emps = await db.query(`SELECT id, COALESCE(shift_hours, 8.0) as hrs FROM hrm_employees WHERE tenant_id = $1 AND employment_status = 'Active'`, [tid]);
    let count = 0;
    for (const emp of emps.rows) {
      await db.query(
        `INSERT INTO hrm_attendance (tenant_id, employee_id, attendance_date, check_in_time, check_out_time, status, work_hours, remarks)
         VALUES ($1,$2,$3,'09:00','17:30','Present',$4,'Bulk Daily Check-In')
         ON CONFLICT (employee_id, attendance_date) DO NOTHING`,
        [tid, emp.id, dateStr, emp.hrs]
      );
      count++;
    }
    res.json({ success: true, marked_count: count, message: `Marked ${count} active employee(s) present for ${dateStr}.` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// Leave Applications, Balances & Policies
router.get('/leaves', ...hrmAuth, requirePermission('hrm', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const result = await db.query(
      `SELECT l.*, e.employee_code, e.first_name, e.last_name, e.designation_name
       FROM hrm_leave_applications l
       JOIN hrm_employees e ON l.employee_id = e.id
       WHERE l.tenant_id = $1
       ORDER BY l.created_at DESC`,
      [tid]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/leaves', ...hrmAuth, requirePermission('hrm', 'add'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const lv = await hrmService.submitLeaveRequest(client, tid, req.body, {
      userId: req.user?.id || null,
      userName: req.user?.full_name || req.user?.username || 'Employee'
    });
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: lv, message: `Leave application submitted (${lv.status}).` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.put('/leaves/:id/status', ...hrmAuth, requirePermission('hrm', 'edit'), async (req, res) => {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const tid = await resolveTenantId(req, db);
    const lv = await hrmService.updateLeaveStatus(client, tid, req.params.id, req.body, {
      userId: req.user?.id || null,
      userName: req.user?.full_name || req.user?.username || 'HR Manager'
    });
    await client.query('COMMIT');
    res.json({ success: true, data: lv, message: `Leave status updated to ${lv.status}.` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(400).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

router.get('/leave-balances', ...hrmAuth, requirePermission('hrm', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const yr = parseInt(req.query.year || new Date().getFullYear(), 10);
    const r = await db.query(
      `SELECT lb.*, e.employee_code, e.first_name, e.last_name, (lb.allocated_days - lb.used_days) as remaining_days
       FROM hrm_leave_balances lb
       JOIN hrm_employees e ON lb.employee_id = e.id
       WHERE lb.tenant_id = $1 AND lb.leave_year = $2
       ORDER BY e.employee_code ASC, lb.leave_type ASC`,
      [tid, yr]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/leave-policies', ...hrmAuth, requirePermission('hrm', 'edit'), async (req, res) => {
  const { leave_type, annual_quota, is_paid, carry_forward } = req.body;
  if (!leave_type) return res.status(400).json({ success: false, message: 'leave_type required' });
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `INSERT INTO hrm_leave_policies (tenant_id, leave_type, annual_quota, is_paid, carry_forward)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, leave_type) DO UPDATE SET
         annual_quota = EXCLUDED.annual_quota,
         is_paid = EXCLUDED.is_paid,
         carry_forward = EXCLUDED.carry_forward
       RETURNING *`,
      [tid, leave_type, parseFloat(annual_quota || 14), is_paid !== false, Boolean(carry_forward)]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/holidays', ...hrmAuth, requirePermission('hrm', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(`SELECT * FROM hrm_holidays WHERE tenant_id = $1 ORDER BY holiday_date ASC`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/holidays', ...hrmAuth, requirePermission('hrm', 'add'), async (req, res) => {
  const { holiday_date, holiday_name, holiday_type } = req.body;
  if (!holiday_date || !holiday_name) return res.status(400).json({ success: false, message: 'Holiday date & name required.' });
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(
      `INSERT INTO hrm_holidays (tenant_id, holiday_date, holiday_name, holiday_type)
       VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, holiday_date) DO UPDATE SET holiday_name = EXCLUDED.holiday_name RETURNING *`,
      [tid, holiday_date, holiday_name, holiday_type || 'Public Holiday']
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/audit-logs', ...hrmAuth, requirePermission('hrm', 'view'), async (req, res) => {
  try {
    const tid = await resolveTenantId(req, db);
    const r = await db.query(`SELECT * FROM hrm_audit_logs WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200`, [tid]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
