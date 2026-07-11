const express = require('express');
const router = express.Router();
const pool = require('../db/database');
const { isHR } = require('../helpers/authMiddleware');

// ─── PAYROLL PAGE ───
router.get('/payroll', isHR, async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentDate = new Date();
    const selectedMonth = month ? parseInt(month) : currentDate.getMonth() + 1;
    const selectedYear = year ? parseInt(year) : currentDate.getFullYear();

    const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
    const endDate = new Date(selectedYear, selectedMonth, 0);
    const endDateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

    // ─── DYNAMIC WHERE CLAUSE ───
    let whereClause = 'WHERE u.deleted_at IS NULL';
    if (req.session.role === 'hr_manager') {
      whereClause += ` AND u.role != 'admin'`;
    }

    // ─── FETCH STAFF ───
    const query = `
      SELECT 
        u.id,
        u.full_name,
        u.email,
        u.pay_type,
        u.hourly_rate,
        u.monthly_salary,
        COALESCE(SUM(a.hours_worked), 0) AS total_hours,
        COALESCE(SUM(CASE WHEN lr.leave_type = 'unpaid' AND lr.status = 'approved' THEN lr.days_requested * 8 ELSE 0 END), 0) AS unpaid_leave_hours
      FROM users u
      LEFT JOIN attendance a ON u.id = a.staff_id 
        AND a.date BETWEEN ? AND ?
      LEFT JOIN leave_requests lr ON u.id = lr.staff_id 
        AND lr.status = 'approved'
        AND lr.leave_type = 'unpaid'
        AND lr.start_date <= ?
        AND lr.end_date >= ?
      ${whereClause}
      GROUP BY u.id
    `;

    const [staff] = await pool.query(query, [startDate, endDateStr, endDateStr, startDate]);

    // ─── CALCULATE PAYROLL ───
    let payroll = await Promise.all(staff.map(async (employee) => {
      let grossPay = 0;
      let netHours = 0;
      let totalHours = parseFloat(employee.total_hours) || 0;
      let unpaidHours = parseFloat(employee.unpaid_leave_hours) || 0;
      let rate = 0; // 👈 DEFINED ONCE

      if (employee.pay_type === 'salary') {
        // ─── SALARY EMPLOYEE ───
        const [workDaysResult] = await pool.query(`
          SELECT COUNT(*) as working_days 
          FROM work_days 
          WHERE staff_id = ? 
            AND work_date BETWEEN ? AND ? 
            AND is_work_day = 1
        `, [employee.id, startDate, endDateStr]);

        const workingDays = workDaysResult[0]?.working_days || 20;
        const monthlySalary = parseFloat(employee.monthly_salary) || 0;
        const dailyRate = monthlySalary / workingDays;
        const deduction = (unpaidHours / 8) * dailyRate;

        grossPay = monthlySalary - deduction;
        netHours = totalHours;
        rate = monthlySalary;

      } else {
        // ─── HOURLY EMPLOYEE ───
        const hourlyRate = parseFloat(employee.hourly_rate) || 0;
        netHours = Math.max(0, totalHours - unpaidHours);
        grossPay = netHours * hourlyRate;
        rate = hourlyRate;
      }

      return {
        ...employee,
        totalHours,
        unpaidHours,
        netHours,
        grossPay,
        rate
      };
    }));

    // ─── TOTALS ───
    const totalPayroll = payroll.reduce((sum, emp) => sum + emp.grossPay, 0);
    const totalHours = payroll.reduce((sum, emp) => sum + emp.totalHours, 0);

    res.render('payroll/index', {
      user: req.session,
      userEmail: req.session.email,
      payroll: payroll,
      totalPayroll: totalPayroll,
      totalHours: totalHours,
      month: selectedMonth,
      year: selectedYear,
      monthName: new Date(selectedYear, selectedMonth - 1).toLocaleString('en-US', { month: 'long' }),
      message: req.session.message || null
    });
    req.session.message = null;

  } catch (err) {
    console.error("❌ Payroll error:", err);
    res.send("Error loading payroll page.");
  }
});

// ─── EXPORT PAYROLL TO CSV ───
router.get('/payroll/export', isHR, async (req, res) => {
  try {
    const { month, year } = req.query;
    const selectedMonth = month ? parseInt(month) : new Date().getMonth() + 1;
    const selectedYear = year ? parseInt(year) : new Date().getFullYear();

    const startDate = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`;
    const endDate = new Date(selectedYear, selectedMonth, 0);
    const endDateStr = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

    const [staff] = await pool.query(`
      SELECT 
        u.full_name,
        u.email,
        u.hourly_rate,
        COALESCE(SUM(a.hours_worked), 0) AS total_hours,
        COALESCE(SUM(CASE WHEN lr.leave_type = 'unpaid' AND lr.status = 'approved' THEN lr.days_requested * 8 ELSE 0 END), 0) AS unpaid_leave_hours
      FROM users u
      LEFT JOIN attendance a ON u.id = a.staff_id 
        AND a.date BETWEEN ? AND ?
      LEFT JOIN leave_requests lr ON u.id = lr.staff_id 
        AND lr.status = 'approved'
        AND lr.leave_type = 'unpaid'
        AND lr.start_date <= ?
        AND lr.end_date >= ?
      WHERE u.deleted_at IS NULL AND u.role NOT IN ('admin', 'hr_manager')
      GROUP BY u.id
    `, [startDate, endDateStr, endDateStr, startDate]);

    let csv = 'Staff,Email,Rate (₱),Total Hours,Unpaid Leave Hours,Net Hours,Gross Pay (₱)\n';

    staff.forEach(emp => {
      const rate = parseFloat(emp.hourly_rate) || 0;
      const totalHours = parseFloat(emp.total_hours) || 0;
      const unpaidHours = parseFloat(emp.unpaid_leave_hours) || 0;
      const netHours = Math.max(0, totalHours - unpaidHours);
      const grossPay = netHours * rate;

      csv += `"${emp.full_name || 'N/A'}","${emp.email}","${rate.toFixed(2)}","${totalHours.toFixed(2)}","${unpaidHours.toFixed(2)}","${netHours.toFixed(2)}","${grossPay.toFixed(2)}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=payroll_${selectedYear}_${String(selectedMonth).padStart(2, '0')}.csv`);
    res.send(csv);

  } catch (err) {
    console.error("❌ Payroll export error:", err);
    req.session.message = '❌ Failed to export payroll.';
    res.redirect('/payroll');
  }
});

module.exports = router;