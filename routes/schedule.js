const express = require('express');
const router = express.Router();
const pool = require('../db/database');
const { isAuthenticated, isAdmin, isHR } = require('../helpers/authMiddleware');

const logActivity = require('../helpers/activityLogger');




// ─── STAFF: View / Select Schedule ───
router.get('/schedule', isAuthenticated, async (req, res) => {
  try {
    const staffId = req.session.userId;
    const currentMonth = new Date();
    currentMonth.setDate(1);
    const monthYear = currentMonth.toISOString().slice(0, 10);

    // Check if staff already has a pending/approved request for this month
    const [existing] = await pool.query(
      `SELECT * FROM schedule_requests 
       WHERE staff_id = ? AND month_year = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [staffId, monthYear]
    );

    const currentRequest = existing[0] || null;

    res.render('schedule/index', {
      user: req.session,
      userEmail: req.session.email,
      currentRequest: currentRequest,
      monthYear: monthYear,
      message: req.session.message || null
    });
    req.session.message = null;
  } catch (err) {
    console.error("❌ Schedule error:", err);
    res.send("Error loading schedule page.");
  }
});

// ─── STAFF: Submit Schedule Request ───
router.post('/schedule/request', isAuthenticated, async (req, res) => {
  try {
    const staffId = req.session.userId;
    const { schedule_type, reason } = req.body;
    const monthYear = new Date();
    monthYear.setDate(1);
    const monthYearStr = monthYear.toISOString().slice(0, 10);

    // Check if they already have a pending request
    const [existing] = await pool.query(
      `SELECT * FROM schedule_requests 
       WHERE staff_id = ? AND month_year = ? AND status IN ('pending', 'approved')`,
      [staffId, monthYearStr]
    );

    if (existing.length > 0) {
      req.session.message = '⚠️ You already have a pending or approved request for this month.';
      return res.redirect('/schedule');
    }

    await pool.query(
      `INSERT INTO schedule_requests (staff_id, schedule_type, month_year, reason, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [staffId, schedule_type, monthYearStr, reason || null]
    );

    req.session.message = '✅ Schedule request submitted! Waiting for admin approval.';
    res.redirect('/schedule');
  } catch (err) {
    console.error("❌ Schedule request error:", err);
    req.session.message = '❌ Failed to submit request. Try again.';
    res.redirect('/schedule');
  }
});


// ─── ADMIN: View Pending Requests ───
router.get('/schedule/admin', isHR, async (req, res) => {
  try {
    const [requests] = await pool.query(`
      SELECT sr.*, u.email, u.full_name 
      FROM schedule_requests sr
      JOIN users u ON sr.staff_id = u.id
      WHERE sr.status = 'pending'
      ORDER BY sr.created_at DESC
    `);

    const [approved] = await pool.query(`
      SELECT sr.*, u.email, u.full_name 
      FROM schedule_requests sr
      JOIN users u ON sr.staff_id = u.id
      WHERE sr.status = 'approved'
      ORDER BY sr.created_at DESC
      LIMIT 20
    `);

    res.render('schedule/admin', {
      user: req.session,
      userEmail: req.session.email,
      pendingRequests: requests,
      approvedRequests: approved,
      message: req.session.message || null
    });
    req.session.message = null;
  } catch (err) {
    console.error("❌ Admin schedule error:", err);
    res.send("Error loading admin schedule page.");
  }
});



// ─── ADMIN/HR: Approve/Reject Schedule Request ───
router.post('/schedule/admin/action', isHR, async (req, res) => {
  try {
    const { request_id, action } = req.body;
    const adminId = req.session.userId;
    const adminRole = req.session.role;

    const [requestRows] = await pool.query(
      `SELECT * FROM schedule_requests WHERE id = ?`,
      [request_id]
    );
    const request = requestRows[0];

    if (!request) {
      req.session.message = '❌ Request not found.';
      return res.redirect('/schedule/admin');
    }

    // ─── SELF-APPROVAL CHECK (ADD THIS) ───
    if (request.staff_id === adminId) {
      req.session.message = '⚠️ You cannot approve your own schedule request.';
      return res.redirect('/schedule/admin');
    }

    // ─── HR REQUESTS: ONLY ADMIN CAN APPROVE ───
    const [requesterRows] = await pool.query(
      `SELECT role FROM users WHERE id = ?`,
      [request.staff_id]
    );
    const requesterRole = requesterRows[0]?.role;

    if (requesterRole === 'hr_manager' && adminRole !== 'admin') {
      req.session.message = '⚠️ Only Admin can approve HR schedule requests.';
      return res.redirect('/schedule/admin');
    }

    // ─── APPROVE LOGIC ───
    if (action === 'approve') {
      await pool.query(
        `UPDATE schedule_requests 
         SET status = 'approved', approved_by = ?, approved_at = NOW()
         WHERE id = ?`,
        [adminId, request_id]
      );

      // Generate work days for the month
      await generateWorkDays(request.staff_id, request.schedule_type, request.month_year);

      await logActivity(
        req.session.userId,
        req.session.email,
        'SCHEDULE_APPROVED',
        `Approved ${request.schedule_type} schedule for ${request.staff_id}`,
        req
      );

      req.session.message = `✅ Schedule request approved.`;
    }

    // ─── REJECT LOGIC ───
    else if (action === 'reject') {
      await pool.query(
        `UPDATE schedule_requests SET status = 'rejected', approved_by = ? WHERE id = ?`,
        [adminId, request_id]
      );

      await logActivity(
        req.session.userId,
        req.session.email,
        'SCHEDULE_REJECTED',
        `Rejected schedule request for ${request.staff_id}`,
        req
      );

      req.session.message = `❌ Schedule request rejected.`;
    }

    res.redirect('/schedule/admin');

    } catch (err) {
    console.error("❌ Admin schedule action error:", err);
    console.error("❌ Full error details:", {
      message: err.message,
      sql: err.sql,
      code: err.code
    });
    req.session.message = '❌ Failed to process action.';
    res.redirect('/schedule/admin');
  }
});

// ─── HELPER: Generate Work Days ───
async function generateWorkDays(staffId, scheduleType, monthYear) {
  const startDate = new Date(monthYear);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + 1);
  endDate.setDate(0); // Last day of month

  // Delete existing work days for this month
  await pool.query(
    `DELETE FROM work_days WHERE staff_id = ? AND work_date >= ? AND work_date <= ?`,
    [staffId, startDate, endDate]
  );

  const workDays = [];
  const currentDate = new Date(startDate);
  let dayCounter = 0;

  while (currentDate <= endDate) {
    let isWorkDay = false;

    if (scheduleType === '4_day_week') {
      // Mon-Thu = Work, Fri-Sun = Rest
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek >= 1 && dayOfWeek <= 4) {
        isWorkDay = true;
      }
    } else if (scheduleType === '3_on_1_off') {
      // 3 work, 1 rest, repeat
      if (dayCounter % 4 !== 3) {
        isWorkDay = true;
      }
      dayCounter++;
    } else if (scheduleType === 'flexi') {
      // Flexi: all days are work days (staff manages their own hours)
      isWorkDay = true;
    }

    workDays.push({
      staff_id: staffId,
      work_date: new Date(currentDate),
      is_work_day: isWorkDay,
      schedule_type: scheduleType
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }

  // Insert work days
  if (workDays.length > 0) {
    const values = workDays.map(wd =>
      `(${wd.staff_id}, '${wd.work_date.toISOString().slice(0, 10)}', ${wd.is_work_day ? 1 : 0}, '${wd.schedule_type}')`
    ).join(',');

    await pool.query(
      `INSERT INTO work_days (staff_id, work_date, is_work_day, schedule_type) VALUES ${values}`
    );
  }

  return true;
}

module.exports = router;