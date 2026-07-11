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

    // ─── SELF-APPROVAL CHECK ───
    if (request.staff_id === adminId) {
      req.session.message = '⚠️ You cannot approve your own leave request.';
      return res.redirect('/leave/admin');
    }

    // ─── HR REQUESTS: ONLY ADMIN CAN APPROVE ───
    const [requesterRows] = await pool.query(
      `SELECT role FROM users WHERE id = ?`,
      [request.staff_id]
    );
    const requesterRole = requesterRows[0]?.role;

    if (requesterRole === 'hr_manager' && adminRole !== 'admin') {
      req.session.message = '⚠️ Only Admin can approve HR leave requests.';
      return res.redirect('/leave/admin');
    }

    // ─── APPROVE LOGIC ───
    if (action === 'approve') {
      // Update request status
      await pool.query(
        `UPDATE leave_requests 
         SET status = 'approved', approved_by = ?, approved_at = NOW()
         WHERE id = ?`,
        [adminId, request_id]
      );

      // Deduct from leave balance
      const currentYear = new Date().getFullYear();
      await pool.query(
        `UPDATE leave_balances 
         SET used_days = used_days + ?,
             remaining_days = remaining_days - ?
         WHERE staff_id = ? AND leave_type = ? AND year = ?`,
        [request.days_requested, request.days_requested, request.staff_id, request.leave_type, currentYear]
      );

      // Log activity
      await logActivity(
        req.session.userId,
        req.session.email,
        'LEAVE_APPROVED',
        `Approved ${request.leave_type} leave for ${request.days_requested} days (${request.start_date} - ${request.end_date})`,
        req
      );

      req.session.message = `✅ Approved ${request.leave_type} leave for ${request.days_requested} days.`;
    }

    // ─── REJECT LOGIC ───
    else if (action === 'reject') {
      await pool.query(
        `UPDATE leave_requests SET status = 'rejected', approved_by = ? WHERE id = ?`,
        [adminId, request_id]
      );

      await logActivity(
        req.session.userId,
        req.session.email,
        'LEAVE_REJECTED',
        `Rejected ${request.leave_type} leave request for ${request.days_requested} days`,
        req
      );

      req.session.message = `❌ Rejected leave request.`;
    }

    res.redirect('/leave/admin');
  } catch (err) {
    console.error("❌ Admin action error:", err);
    req.session.message = '❌ Failed to process action.';
    res.redirect('/leave/admin');
  }
});

// ─── ADMIN/HR: Allocate Leave Credits (View Page) ───
router.get('/leave/allocate', isHR, async (req, res) => {
  try {
    // Get all active staff (excluding admin)
    const [staff] = await pool.query(
      `SELECT id, full_name, email FROM users 
       WHERE role != 'admin' AND deleted_at IS NULL 
       ORDER BY full_name`
    );

    res.render('leave/allocate', {
      user: req.session,
      userEmail: req.session.email,
      staff: staff,
      message: req.session.message || null
    });
    req.session.message = null;
  } catch (err) {
    console.error("❌ Allocate page error:", err);
    res.send("Error loading allocate page.");
  }
});

// ─── ADMIN/HR: Allocate Leave Credits (Submit) ───
router.post('/leave/allocate', isHR, async (req, res) => {
  try {
    console.log("🔍 Allocation request received:", req.body);
    const { staff_id, leave_type, days, year } = req.body;

    // ─── REQUIRED FIELDS CHECK ───
    if (!staff_id || !leave_type || !days || !year) {
      req.session.message = '⚠️ All fields are required.';
      return res.redirect('/leave/allocate');
    }

    // ─── SELF-ALLOCATION CHECK ───
    if (parseInt(staff_id) === req.session.userId) {
      req.session.message = '⚠️ You cannot allocate leave credits to yourself.';
      return res.redirect('/leave/allocate');
    }

    // ─── MAX CAP CHECK ───
    const MAX_DAYS = 30;
    if (days > MAX_DAYS) {
      req.session.message = `⚠️ You cannot allocate more than ${MAX_DAYS} days.`;
      return res.redirect('/leave/allocate');
    }

    // ─── HR REQUESTS: ONLY ADMIN CAN ALLOCATE TO HR ───
    const [targetUserRows] = await pool.query(
      `SELECT role FROM users WHERE id = ?`,
      [staff_id]
    );
    const targetRole = targetUserRows[0]?.role;

    if (targetRole === 'hr_manager' && req.session.role !== 'admin') {
      req.session.message = '⚠️ Only Admin can allocate leave to HR staff.';
      return res.redirect('/leave/allocate');
    }

    // ─── CHECK EXISTING BALANCE ───
    console.log("🔍 Checking existing balance...");
    const [existing] = await pool.query(
      `SELECT * FROM leave_balances 
       WHERE staff_id = ? AND leave_type = ? AND year = ?`,
      [staff_id, leave_type, year]
    );
    console.log("✅ Existing balance check done. Found:", existing.length);

    // ─── UPDATE OR INSERT ───
    if (existing.length > 0) {
      console.log("🔍 Updating existing balance...");
      await pool.query(
        `UPDATE leave_balances 
         SET total_days = ?, remaining_days = total_days - used_days
         WHERE staff_id = ? AND leave_type = ? AND year = ?`,
        [days, staff_id, leave_type, year]
      );
      console.log("✅ Balance updated");
    } else {
      console.log("🔍 Inserting new balance...");
      await pool.query(
        `INSERT INTO leave_balances (staff_id, leave_type, total_days, remaining_days, year)
         VALUES (?, ?, ?, ?, ?)`,
        [staff_id, leave_type, days, days, year]
      );
      console.log("✅ Balance inserted");
    }

    // ─── LOG ACTIVITY (SAFE VERSION) ───
    try {
      console.log("🔍 Attempting to log activity...");
      await logActivity(
        req.session.userId,
        req.session.email,
        'LEAVE_ALLOCATED',
        `Allocated ${days} ${leave_type} days to staff ID ${staff_id}`,
        req
      );
      console.log("✅ Activity logged successfully");
    } catch (logErr) {
      console.error("❌ Failed to log activity:", logErr.message);
      // Continue anyway — the allocation still succeeded
    }

    req.session.message = `✅ Allocated ${days} ${leave_type} days.`;
    console.log("✅ Allocation complete, redirecting...");
    res.redirect('/leave/allocate');

  } catch (err) {
    console.error("❌ Allocate error:", err);
    console.error("❌ Error stack:", err.stack);
    req.session.message = '❌ Failed to allocate leave.';
    res.redirect('/leave/allocate');
  }
});

module.exports = router;