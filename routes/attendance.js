const express = require('express');
const router = express.Router();
const pool = require('../db/database');
const { isAuthenticated, isAdmin, isHR } = require('../helpers/authMiddleware');

// --- HELPER: Check if user is logged in ---
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/login');
}

// --- HELPER: Check if user is admin ---
function isAdmin(req, res, next) {
  if (req.session.userId && req.session.role === 'admin') {
    return next();
  }
  res.status(403).render('error', {
    message: 'You do not have admin privileges to access this page.',
    user: req.session
  });
}

// --- ROUTE: Staff Dashboard (Attendance View) ---
router.get('/attendance', isAuthenticated, async (req, res) => {
  try {
    const staffId = req.session.userId;
    const isAdmin = req.session.role === 'admin';

    const [today] = await pool.query(
      `SELECT * FROM attendance 
       WHERE staff_id = ? AND date = CURDATE()`,
      [staffId]
    );

    const [history] = await pool.query(
      `SELECT * FROM attendance 
       WHERE staff_id = ? 
       ORDER BY date DESC 
       LIMIT 7`,
      [staffId]
    );

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

    // 👇 Get the message from session, then clear it
    const message = req.session.message || null;
    req.session.message = null;

    res.render('attendance/index', {
      today: today[0] || null,
      history: history,
      clockedInStaff: clockedInStaff,
      isAdmin: isAdmin,
      userEmail: req.session.email,
      user: req.session,
      message: message  // 👈 PASS THE MESSAGE
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

    const [existing] = await pool.query(
      `SELECT * FROM attendance WHERE staff_id = ? AND date = CURDATE()`,
      [staffId]
    );

    if (existing.length > 0) {
      req.session.message = '⚠️ You already clocked in today!';
      return res.redirect('/attendance');
    }

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

    const [record] = await pool.query(
      `SELECT * FROM attendance WHERE staff_id = ? AND date = CURDATE() AND check_out IS NULL`,
      [staffId]
    );

    if (record.length === 0) {
      req.session.message = '⚠️ You haven\'t clocked in today!';
      return res.redirect('/attendance');
    }

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


// ─── STAFF: Undo Clock-Out (within 5 minutes) ───
router.post('/attendance/undo', isAuthenticated, async (req, res) => {
  try {
    const staffId = req.session.userId;

    // Get today's record (must have check_out set)
    const [record] = await pool.query(
      `SELECT id, check_out, created_at FROM attendance 
       WHERE staff_id = ? AND date = CURDATE() AND check_out IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [staffId]
    );

    if (record.length === 0) {
      req.session.message = '⚠️ No clock-out record found to undo.';
      return res.redirect('/attendance');
    }

    const checkOutTime = new Date(record[0].check_out);
    const now = new Date();
    const diffMinutes = (now - checkOutTime) / 60000;

    if (diffMinutes > 5) {
      req.session.message = '⚠️ Cannot undo clock-out after 5 minutes. Please contact admin.';
      return res.redirect('/attendance');
    }

    // Remove check_out and hours_worked
    await pool.query(
      `UPDATE attendance 
       SET check_out = NULL, hours_worked = NULL 
       WHERE id = ?`,
      [record[0].id]
    );

    req.session.message = '✅ Clock-out undone! You can clock out again later.';
    res.redirect('/attendance');
  } catch (err) {
    console.error("❌ Undo error:", err);
    req.session.message = '❌ Failed to undo clock-out.';
    res.redirect('/attendance');
  }
});


// ─── ADMIN: View All Attendance Records ───
router.get('/attendance/admin', isHR, async (req, res) => {
  try {
    const [records] = await pool.query(`
      SELECT a.*, u.email, u.full_name 
      FROM attendance a
      JOIN users u ON a.staff_id = u.id
      ORDER BY a.date DESC, a.created_at DESC
      LIMIT 100
    `);

    res.render('attendance/admin', {
      user: req.session,
      userEmail: req.session.email,
      records: records,
      message: req.session.message || null
    });
    req.session.message = null;
  } catch (err) {
    console.error("❌ Admin attendance error:", err);
    res.send("Error loading admin attendance.");
  }
});

// ─── ADMIN: Update Attendance Record ───
router.post('/attendance/admin/update/:id', isHR, async (req, res) => {
  try {
    const { id } = req.params;
    const { check_in, check_out, hours_worked } = req.body;

    await pool.query(
      `UPDATE attendance 
       SET check_in = ?, check_out = ?, hours_worked = ?
       WHERE id = ?`,
      [check_in || null, check_out || null, hours_worked || null, id]
    );

    req.session.message = '✅ Attendance record updated!';
    res.redirect('/attendance/admin');
  } catch (err) {
    console.error("❌ Update error:", err);
    req.session.message = '❌ Failed to update record.';
    res.redirect('/attendance/admin');
  }
});

module.exports = router;