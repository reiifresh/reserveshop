const express = require('express');
const router = express.Router();
const pool = require('../db/database');
const { isAuthenticated, isAdmin, isHR } = require('../helpers/authMiddleware');
const logActivity = require('../helpers/activityLogger');

// ─── STAFF: View Leave Page ───
router.get('/leave', isAuthenticated, async (req, res) => {
  console.log("🔍 Leave page requested");  // 👈 ADD THIS
  try {
    const staffId = req.session.userId;
    const currentYear = new Date().getFullYear();

    // Get leave balances
    const [balances] = await pool.query(
      `SELECT * FROM leave_balances 
       WHERE staff_id = ? AND year = ?`,
      [staffId, currentYear]
    );

    // Get leave history (last 10 requests)
    const [history] = await pool.query(
      `SELECT * FROM leave_requests 
       WHERE staff_id = ? 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [staffId]
    );

    res.render('leave/index', {
      user: req.session,
      userEmail: req.session.email,
      balances: balances,
      history: history,
      message: req.session.message || null
    });
    req.session.message = null;
  } catch (err) {
    console.error("❌ Leave error:", err);
    res.send("Error loading leave page.");
  }
});

// ─── STAFF: Submit Leave Request ───
router.post('/leave/request', isAuthenticated, async (req, res) => {
  try {
    const staffId = req.session.userId;
    const { leave_type, start_date, end_date, reason } = req.body;

    // Calculate days requested
    const start = new Date(start_date);
    const end = new Date(end_date);
    const daysRequested = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    // Check balance
    const currentYear = new Date().getFullYear();
    const [balanceRows] = await pool.query(
      `SELECT remaining_days FROM leave_balances 
       WHERE staff_id = ? AND leave_type = ? AND year = ?`,
      [staffId, leave_type, currentYear]
    );

    if (balanceRows.length === 0 || balanceRows[0].remaining_days < daysRequested) {
      req.session.message = '❌ Insufficient leave balance.';
      return res.redirect('/leave');
    }

    // Check for overlapping requests
    const [overlap] = await pool.query(
      `SELECT * FROM leave_requests 
       WHERE staff_id = ? 
         AND status IN ('pending', 'approved')
         AND (
           (start_date <= ? AND end_date >= ?) OR
           (start_date <= ? AND end_date >= ?) OR
           (start_date >= ? AND end_date <= ?)
         )`,
      [staffId, end_date, start_date, end_date, start_date, start_date, end_date]
    );

    if (overlap.length > 0) {
      req.session.message = '⚠️ You already have a leave request for these dates.';
      return res.redirect('/leave');
    }

    // Insert request
    await pool.query(
      `INSERT INTO leave_requests 
       (staff_id, leave_type, start_date, end_date, days_requested, reason, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [staffId, leave_type, start_date, end_date, daysRequested, reason || null]
    );

    // Log activity
    await logActivity(
      req.session.userId,
      req.session.email,
      'LEAVE_REQUESTED',
      `${leave_type} leave requested for ${daysRequested} days (${start_date} - ${end_date})`,
      req
    );

    req.session.message = '✅ Leave request submitted! Waiting for admin approval.';
    res.redirect('/leave');
  } catch (err) {
    console.error("❌ Leave request error:", err);
    req.session.message = '❌ Failed to submit request. Try again.';
    res.redirect('/leave');
  }
});

// ─── STAFF: Cancel Pending Request ───
router.post('/leave/cancel/:id', isAuthenticated, async (req, res) => {
  try {
    const staffId = req.session.userId;
    const { id } = req.params;

    await pool.query(
      `UPDATE leave_requests 
       SET status = 'cancelled' 
       WHERE id = ? AND staff_id = ? AND status = 'pending'`,
      [id, staffId]
    );

    req.session.message = '✅ Leave request cancelled.';
    res.redirect('/leave');
  } catch (err) {
    console.error("❌ Cancel error:", err);
    req.session.message = '❌ Failed to cancel request.';
    res.redirect('/leave');
  }
});

// ─── ADMIN/HR: View Leave Management ───
router.get('/leave/admin', isHR, async (req, res) => {
  try {
    console.log("🔍 Fetching leave admin data...");

    const [pending] = await pool.query(`
      SELECT lr.*, u.full_name, u.email   
      FROM leave_requests lr
      JOIN users u ON lr.staff_id = u.id
      WHERE lr.status = 'pending' AND u.deleted_at IS NULL
      ORDER BY lr.created_at ASC
    `);

    console.log("✅ Pending requests fetched:", pending.length);

    const [approved] = await pool.query(`
      SELECT lr.*, u.full_name, u.email 
      FROM leave_requests lr
      JOIN users u ON lr.staff_id = u.id
      WHERE lr.status IN ('approved', 'rejected') AND u.deleted_at IS NULL
      ORDER BY lr.updated_at DESC
      LIMIT 20
    `);

    console.log("✅ Approved requests fetched:", approved.length);

    res.render('leave/admin', {
      user: req.session,
      userEmail: req.session.email,
      pending: pending,
      approved: approved,
      message: req.session.message || null
    });
    req.session.message = null;
  } catch (err) {
    console.error("❌ Admin leave error:", err);
    console.error("❌ SQL Error Details:", {
      message: err.message,
      sql: err.sql,
      code: err.code
    });
    res.send("Error loading leave management: " + err.message);
  }
});


// ─── ADMIN/HR: Approve/Reject Leave Request ───
router.post('/leave/admin/action', isHR, async (req, res) => {
  try {
    const { request_id, action } = req.body;
    const adminId = req.session.userId;
    const adminRole = req.session.role;

    const [requestRows] = await pool.query(
      `SELECT * FROM leave_requests WHERE id = ?`,
      [request_id]
    );
    const request = requestRows[0];

    if (!request) {
      req.session.message = '❌ Request not found.';
      return res.redirect('/leave/admin');
    }

    // 👇 SELF-APPROVAL CHECK: Nobody can approve their own leave
    if (request.staff_id === adminId) {
      req.session.message = '⚠️ You cannot approve your own leave request.';
      return res.redirect('/leave/admin');
    }

    // 👇 HR REQUESTS: ONLY ADMIN CAN APPROVE
    const [requesterRows] = await pool.query(
      `SELECT role FROM users WHERE id = ?`,
      [request.staff_id]
    );
    const requesterRole = requesterRows[0]?.role;

    if (requesterRole === 'hr_manager' && adminRole !== 'admin') {
      req.session.message = '⚠️ Only Admin can approve HR leave requests.';
      return res.redirect('/leave/admin');
    }

    // ✅ Admin requests: HR CAN approve (no restriction needed)
    // Staff requests: HR or Admin can approve

    // ... rest of the approve/reject logic
  } catch (err) {
    console.error("❌ Admin action error:", err);
    req.session.message = '❌ Failed to process action.';
    res.redirect('/leave/admin');
  }
});

// ─── ADMIN ONLY: Allocate Leave Balance ───
router.post('/leave/admin/allocate', isAdmin, async (req, res) => {
  try {
    const { staff_id, leave_type, total_days, year } = req.body;

    // Check if balance exists
    const [existing] = await pool.query(
      `SELECT * FROM leave_balances 
       WHERE staff_id = ? AND leave_type = ? AND year = ?`,
      [staff_id, leave_type, year]
    );

    if (existing.length > 0) {
      // Update
      await pool.query(
        `UPDATE leave_balances 
         SET total_days = ?, remaining_days = total_days - used_days
         WHERE staff_id = ? AND leave_type = ? AND year = ?`,
        [total_days, staff_id, leave_type, year]
      );
    } else {
      // Insert
      await pool.query(
        `INSERT INTO leave_balances (staff_id, leave_type, total_days, remaining_days, year)
         VALUES (?, ?, ?, ?, ?)`,
        [staff_id, leave_type, total_days, total_days, year]
      );
    }

    req.session.message = '✅ Leave balance updated!';
    res.redirect('/leave/admin');
  } catch (err) {
    console.error("❌ Allocate error:", err);
    req.session.message = '❌ Failed to update balance.';
    res.redirect('/leave/admin');
  }
});

module.exports = router;