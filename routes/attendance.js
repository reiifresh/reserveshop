const express = require('express');
const router = express.Router();
const pool = require('../db/database');

// --- HELPER: Check if user is logged in ---
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/login');
}

// --- ROUTE: Staff Dashboard (Attendance View) ---
router.get('/attendance', isAuthenticated, async (req, res) => {
  try {
    const staffId = req.session.userId;
    const isAdmin = req.session.role === 'admin';

    // Get today's attendance for the logged-in staff
    const [today] = await pool.query(
      `SELECT * FROM attendance 
       WHERE staff_id = ? AND date = CURDATE()`,
      [staffId]
    );

    // Get attendance history (last 7 days)
    const [history] = await pool.query(
      `SELECT * FROM attendance 
       WHERE staff_id = ? 
       ORDER BY date DESC 
       LIMIT 7`,
      [staffId]
    );

    // If admin, get all staff currently clocked in
    let clockedInStaff = [];
    if (isAdmin) {
      const [staff] = await pool.query(`
        SELECT u.id, u.email, u.full_name, a.check_in, a.date 
        FROM attendance a
        JOIN users u ON a.staff_id = u.id
        WHERE a.date = CURDATE() AND a.check_out IS NULL
      `);
      clockedInStaff = staff;
    }

    res.render('attendance/index', {
      today: today[0] || null,
      history: history,
      clockedInStaff: clockedInStaff,
      isAdmin: isAdmin,
      userEmail: req.session.email,
      user: req.session
    });
  } catch (err) {
    console.error("❌ Attendance error:", err);
    res.send("Error loading attendance page.");
  }
});

// --- ROUTE: Check In ---
router.post('/attendance/check-in', isAuthenticated, async (req, res) => {
  try {
    const staffId = req.session.userId;

    // Check if already clocked in today
    const [existing] = await pool.query(
      `SELECT * FROM attendance WHERE staff_id = ? AND date = CURDATE()`,
      [staffId]
    );

    if (existing.length > 0) {
      req.session.message = '⚠️ You already clocked in today!';
      return res.redirect('/attendance');
    }

    // Insert new attendance record
    await pool.query(
      `INSERT INTO attendance (staff_id, date, check_in) 
       VALUES (?, CURDATE(), CURTIME())`,
      [staffId]
    );

    req.session.message = '✅ Clocked in successfully!';
    res.redirect('/attendance');
  } catch (err) {
    console.error("❌ Check-in error:", err);
    req.session.message = '❌ Failed to clock in. Try again.';
    res.redirect('/attendance');
  }
});

// --- ROUTE: Check Out ---
router.post('/attendance/check-out', isAuthenticated, async (req, res) => {
  try {
    const staffId = req.session.userId;

    // Get today's attendance record
    const [record] = await pool.query(
      `SELECT * FROM attendance WHERE staff_id = ? AND date = CURDATE() AND check_out IS NULL`,
      [staffId]
    );

    if (record.length === 0) {
      req.session.message = '⚠️ You haven\'t clocked in today!';
      return res.redirect('/attendance');
    }

    // Update check-out time and calculate hours worked
    await pool.query(
      `UPDATE attendance 
       SET check_out = CURTIME(),
           hours_worked = TIMESTAMPDIFF(HOUR, check_in, CURTIME())
       WHERE id = ?`,
      [record[0].id]
    );

    req.session.message = '✅ Clocked out successfully!';
    res.redirect('/attendance');
  } catch (err) {
    console.error("❌ Check-out error:", err);
    req.session.message = '❌ Failed to clock out. Try again.';
    res.redirect('/attendance');
  }
});

module.exports = router;