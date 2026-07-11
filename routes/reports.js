const express = require('express');
const router = express.Router();
const pool = require('../db/database');
const { isHR } = require('../helpers/authMiddleware');

// ─── REPORTS DASHBOARD ───
router.get('/reports', isHR, async (req, res) => {
  try {
    res.render('reports/index', {
      user: req.session,
      userEmail: req.session.email,
      message: req.session.message || null
    });
    req.session.message = null;
  } catch (err) {
    console.error("❌ Reports error:", err);
    res.send("Error loading reports page.");
  }
});

// ─── EXPORT ATTENDANCE REPORT ───
router.get('/reports/attendance', isHR, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    let dateFilter = '';
    const params = [];

    if (start_date && end_date) {
      dateFilter = 'WHERE a.date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    const query = `
      SELECT 
        u.full_name,
        u.email,
        a.date,
        a.check_in,
        a.check_out,
        a.hours_worked,
        a.status
      FROM attendance a
      JOIN users u ON a.staff_id = u.id
      ${dateFilter}
      ORDER BY a.date DESC
      LIMIT 1000
    `;

    const [rows] = await pool.query(query, params);

    let csv = 'Staff,Email,Date,Check In,Check Out,Hours,Status\n';

    rows.forEach(row => {
      csv += `"${row.full_name || 'N/A'}","${row.email}","${row.date}","${row.check_in || '-'}","${row.check_out || '-'}","${row.hours_worked || 0}","${row.status || 'present'}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=attendance_report_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csv);

  } catch (err) {
    console.error("❌ Export attendance error:", err);
    req.session.message = '❌ Failed to export attendance.';
    res.redirect('/reports');
  }
});

// ─── EXPORT LEAVE REPORT ───
router.get('/reports/leave', isHR, async (req, res) => {
  try {
    const query = `
      SELECT 
        u.full_name,
        u.email,
        lb.leave_type,
        lb.total_days,
        lb.used_days,
        lb.remaining_days,
        lb.year
      FROM leave_balances lb
      JOIN users u ON lb.staff_id = u.id
      WHERE u.deleted_at IS NULL
      ORDER BY u.full_name, lb.leave_type
    `;

    const [rows] = await pool.query(query);

    let csv = 'Staff,Email,Leave Type,Total Days,Used Days,Remaining Days,Year\n';

    rows.forEach(row => {
      csv += `"${row.full_name || 'N/A'}","${row.email}","${row.leave_type}","${row.total_days}","${row.used_days}","${row.remaining_days}","${row.year}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=leave_report_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csv);

  } catch (err) {
    console.error("❌ Export leave error:", err);
    req.session.message = '❌ Failed to export leave.';
    res.redirect('/reports');
  }
});

// ─── EXPORT ACTIVITY LOG ───
router.get('/reports/activity', isHR, async (req, res) => {
  try {
    const { days } = req.query;
    let limit = days ? parseInt(days) : 30;

    const [rows] = await pool.query(`
      SELECT 
        user_email,
        action,
        details,
        ip_address,
        country_code,
        created_at
      FROM activity_logs
      ORDER BY created_at DESC
      LIMIT ?
    `, [limit]);

    let csv = 'User,Action,Details,IP,Country,Timestamp\n';

    rows.forEach(row => {
      csv += `"${row.user_email || 'Unknown'}","${row.action}","${(row.details || '').replace(/,/g, ';')}","${row.ip_address || ''}","${row.country_code || ''}","${row.created_at}"\n`;
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=activity_report_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(csv);

  } catch (err) {
    console.error("❌ Export activity error:", err);
    req.session.message = '❌ Failed to export activity logs.';
    res.redirect('/reports');
  }
});

module.exports = router;