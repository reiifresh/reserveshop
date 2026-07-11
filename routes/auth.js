const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const pool = require('../db/database');

const { isAuthenticated, isAdmin } = require('../helpers/authMiddleware');


const axios = require('axios'); // 👈 Make sure this is at the top of the file
const logActivity = require('../helpers/activityLogger');

// --- HELPER: Middleware to protect routes ---


// --- HELPER: Send email via Ethereal (fake SMTP) ---
async function sendResetEmail(email, token) {
  const resetLink = `https://${process.env.APP_URL || 'localhost:3000'}/reset-password/${token}`;

  console.log("🔍 Sending password reset email to:", email);

  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: {
          email: process.env.EMAIL_FROM || 'noreply@crm.com',
          name: 'CRM Admin'
        },
        to: [{ email: email }],
        subject: "Password Reset Request",
        htmlContent: `
          <h3>Password Reset Request</h3>
          <p>You requested a password reset. Click the link below to set a new password:</p>
          <p><a href="${resetLink}">${resetLink}</a></p>
          <p>This link expires in 1 hour.</p>
          <p>If you didn't request this, please ignore this email.</p>
        `
      },
      {
        headers: {
          'api-key': process.env.BREVO_API_KEY,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    console.log("📧 Password reset email sent to:", email);
    return true;
  } catch (error) {
    console.error("❌ Password reset email error:", error.response?.data || error.message);
    console.error("❌ Full error:", error);
    return false;
  }
}

// --- ROUTE: Homepage (Redirect to login or dashboard) ---
router.get('/', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/dashboard'); // If logged in, go to dashboard
  }
  res.redirect('/login'); // If not logged in, go to login
});



// --- ROUTE: Login Page ---
router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/dashboard');
  res.render('login', { error: null });
});


// ─── ROUTE: Handle Login ───
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.query(
      `SELECT * FROM users WHERE email = ? AND deleted_at IS NULL`,
      [email]
    );
    const user = rows[0];

    if (!user) {
      // ─── LOG FAILED LOGIN (USER NOT FOUND) ───
      await logActivity(
        null,
        email,
        'LOGIN_FAILED',
        `Failed login attempt for ${email} (user not found)`,
        req
      );
      return res.render('login', { error: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      // ─── LOG FAILED LOGIN (WRONG PASSWORD) ───
      await logActivity(
        user.id,
        email,
        'LOGIN_FAILED',
        `Failed login attempt for ${email} (wrong password)`,
        req
      );
      return res.render('login', { error: 'Invalid email or password.' });
    }

    // ─── SET SESSION ───
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = user.role;
    req.session.full_name = user.full_name || user.email || 'User';

    // ─── LOG SUCCESSFUL LOGIN ───
    await logActivity(
      user.id,
      user.email,
      'LOGIN',
      'User logged in successfully',
      req
    );

    res.redirect('/dashboard');
  } catch (err) {
    console.error("❌ Login error:", err);
    res.render('login', { error: 'Database error.' });
  }
});

// ─── Undertime Staff Report ───
router.get('/undertime', isAdmin, async (req, res) => {
  try {
    const [hoursBalance] = await pool.query(`
      SELECT 
        u.id,
        u.full_name,
        u.email,
        COALESCE(SUM(a.hours_worked), 0) as actual_hours,
        40 as target_hours,
        40 - COALESCE(SUM(a.hours_worked), 0) as hours_lacking
      FROM users u
      LEFT JOIN attendance a ON u.id = a.staff_id 
        AND a.date BETWEEN DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AND CURDATE()
      WHERE u.deleted_at IS NULL 
        AND u.role != 'admin'
        AND u.role != 'hr_manager'
      GROUP BY u.id
      HAVING hours_lacking > 2
      ORDER BY hours_lacking DESC
    `);

    res.render('undertime', {
      user: req.session,
      hoursBalance: hoursBalance
    });
  } catch (err) {
    console.error("❌ Undertime error:", err);
    res.send("Error loading undertime report.");
  }
});

// ─── ROUTE: Dashboard (Protected) ───
router.get('/dashboard', isAuthenticated, async (req, res) => {
  try {
    const staffId = req.session.userId;
    const isAdmin = req.session.role === 'admin';

    // ─── Total Contacts ───
    const [contactCount] = await pool.query(`SELECT COUNT(*) as count FROM contacts`);
    const totalContacts = contactCount[0].count;

    // ─── Total Staff (active only) ───
    const [staffCount] = await pool.query(
      `SELECT COUNT(*) as count FROM users WHERE id != ? AND deleted_at IS NULL`,
      [req.session.userId]  // 👈 NO SEMICOLON HERE — just closing )
    );
    const totalStaff = staffCount[0].count;

    const [hoursBalance] = await pool.query(`
      SELECT 
        u.id,
        u.full_name,
        u.email,
        COALESCE(SUM(a.hours_worked), 0) as actual_hours,
        40 as target_hours,
        40 - COALESCE(SUM(a.hours_worked), 0) as hours_lacking
      FROM users u
      LEFT JOIN attendance a ON u.id = a.staff_id 
        AND a.date BETWEEN DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY) AND CURDATE()
      WHERE u.deleted_at IS NULL 
        AND u.role != 'admin'
        AND u.role != 'hr_manager'
      GROUP BY u.id
      HAVING hours_lacking > 2
      ORDER BY hours_lacking DESC
    `);

   
    // ─── Pending Schedule & Leave Requests ───
    let pendingSchedule = 0;
    let pendingLeave = 0;

    // Show pending requests for Admin AND HR
    if (req.session.role === 'admin' || req.session.role === 'hr_manager') {
      const [schedulePending] = await pool.query(
        `SELECT COUNT(*) as count FROM schedule_requests WHERE status = 'pending'`
      );
      pendingSchedule = schedulePending[0].count || 0;

      const [leavePending] = await pool.query(
        `SELECT COUNT(*) as count FROM leave_requests WHERE status = 'pending'`
      );
      pendingLeave = leavePending[0].count || 0;
    }
    const totalPending = pendingSchedule + pendingLeave;

    // ─── Today's Attendance (for logged-in user) ───
    const [todayAttendance] = await pool.query(
      `SELECT * FROM attendance WHERE staff_id = ? AND date = CURDATE()`,
      [staffId]
    );
    const today = todayAttendance[0] || null;

    // ─── Staff Clocked In (admin only) ───
    let clockedInStaff = [];
    if (isAdmin || req.session.role === 'hr_manager') {
      const [staff] = await pool.query(`
        SELECT u.id, u.email, u.full_name, a.check_in 
        FROM attendance a
        JOIN users u ON a.staff_id = u.id
        WHERE a.date = CURDATE() AND a.check_out IS NULL AND u.deleted_at IS NULL
      `);
      clockedInStaff = staff;
    }

    // ─── Weekly Summary (for logged-in user) ───
    const [weeklySummary] = await pool.query(`
      SELECT 
        DAYNAME(date) as day_name,
        date,
        check_in,
        check_out,
        hours_worked
      FROM attendance 
      WHERE staff_id = ? 
        AND date >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      ORDER BY date ASC
    `, [staffId]);

    // ─── Recent Activity (last 5 actions) ───
    const [recentActivity] = await pool.query(`
      SELECT * FROM activity_logs 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    // ─── Flash Message ───
    const message = req.session.message || null;
    req.session.message = null;

    res.render('dashboard', {
      user: req.session,
      userEmail: req.session.email,
      fullName: req.session.full_name || req.session.email || 'Admin',
      totalContacts: totalContacts,
      totalStaff: totalStaff,
      today: today,
      pendingSchedule: pendingSchedule,
      pendingLeave: pendingLeave,
      pendingRequests: totalPending,
      clockedInStaff: clockedInStaff,
      weeklySummary: weeklySummary,
      recentActivity: recentActivity,
      isAdmin: isAdmin,
      hoursBalance: hoursBalance,
      message: message
    });
  } catch (err) {
    console.error("❌ Dashboard error:", err);
    res.render('dashboard', {
      user: req.session,
      userEmail: req.session.email,
      fullName: 'Admin',
      totalContacts: 0,
      totalStaff: 0,
      today: null,
      pendingSchedule: 0,
      pendingLeave: 0,
      pendingRequests: 0,
      clockedInStaff: [],
      weeklySummary: [],
      recentActivity: [],
      isAdmin: false,
      message: null
    });
  }
});



// --- ROUTE: Logout ---
router.get('/logout', async (req, res) => {
  if (req.session.userId) {
    await logActivity(req.session.userId, req.session.email, 'LOGOUT', null, req);
  }
  req.session.destroy(() => res.redirect('/login'));
});

// --- ROUTE: Forgot Password Page ---
router.get('/forgot-password', (req, res) => {
  res.render('forgot', { message: null, error: null });
});

// ─── ROUTE: Handle Forgot Password (Sends Email) ───
router.post('/forgot-password', async (req, res) => {
  console.log("🔍 Forgot password request received for:", req.body.email);
  const { email } = req.body;

  try {
    // 👇 FIXED: Only active users can reset password
    const [rows] = await pool.query(
      `SELECT * FROM users WHERE email = ? AND deleted_at IS NULL`,
      [email]
    );
    const user = rows[0];

    if (!user) {
      return res.render('forgot', { message: null, error: 'No account with that email.' });
    }

    // Generate a secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 3600000; // 1 hour from now

    // Save token to database
    await pool.query(
      `UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?`,
      [token, expiry, user.id]
    );

    // Send the email (using Brevo API)
    await sendResetEmail(email, token);

    // Log activity
    await logActivity(
      user.id,
      user.email,
      'PASSWORD_RESET',
      'Password reset requested',
      req
    );

    res.render('forgot', {
      message: '✅ Reset link sent! Check your email inbox (and spam folder).',
      error: null
    });

  } catch (err) {
    console.error("❌ Forgot password error:", err);
    res.render('forgot', { message: null, error: 'Something went wrong. Please try again.' });
  }
});





// --- ROUTE: Reset Password Page (Click the link) ---
router.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const [rows] = await pool.query(`SELECT * FROM users WHERE reset_token = ? AND deleted_at IS NULL`, [token]);
    const user = rows[0];

    if (!user || Date.now() > user.reset_token_expiry) {
      return res.render('reset', { token: null, error: 'Invalid or expired token.', message: null });
    }

    res.render('reset', { token: token, error: null, message: null });

  } catch (err) {
    res.render('reset', { token: null, error: 'Database error.', message: null });
  }
});

// --- ROUTE: Handle Password Update ---
router.post('/reset-password/:token', async (req, res) => {
  const { token } = req.params;
  const { newPassword, confirmPassword } = req.body;

  if (newPassword !== confirmPassword) {
    return res.render('reset', { token, error: 'Passwords do not match.', message: null });
  }
  if (newPassword.length < 6) {
    return res.render('reset', { token, error: 'Password must be at least 6 characters.', message: null });
  }

  try {
    const [rows] = await pool.query(`SELECT * FROM users WHERE reset_token = ?`, [token]);
    const user = rows[0];

    if (!user || Date.now() > user.reset_token_expiry) {
      return res.render('reset', { token: null, error: 'Invalid or expired token.', message: null });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await pool.query(`UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?`, 
      [hashedPassword, user.id]);

    res.render('reset', { 
      token: null, 
      error: null, 
      message: '✅ Password successfully reset! Go to <a href="/login">Login</a>' 
    });

  } catch (err) {
    console.error(err);
    res.render('reset', { token, error: 'Database error.', message: null });
  }
});

// --- ROUTE: Show Profile Settings Page ---
router.get('/profile', isAuthenticated, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT email FROM users WHERE id = ?`, [req.session.userId]);
    const user = rows[0];
    res.render('profile', { 
      userEmail: user.email, 
      error: null, 
      success: null 
    });
  } catch (err) {
    console.error(err);
    res.redirect('/dashboard');
  }
});

// --- ROUTE: Handle Email Update ---
router.post('/profile', isAuthenticated, async (req, res) => {
  const { currentPassword, newEmail, confirmEmail } = req.body;

  // 1. Basic validation
  if (!currentPassword || !newEmail || !confirmEmail) {
    return res.render('profile', { 
      userEmail: req.session.email, 
      error: 'All fields are required.', 
      success: null 
    });
  }

  if (newEmail !== confirmEmail) {
    return res.render('profile', { 
      userEmail: req.session.email, 
      error: 'New email addresses do not match.', 
      success: null 
    });
  }

  // 2. Check if new email is already taken by SOMEONE ELSE
  try {
    const [existingUser] = await pool.query(`SELECT id FROM users WHERE email = ? AND id != ?`, 
      [newEmail, req.session.userId]);
    
    if (existingUser.length > 0) {
      return res.render('profile', { 
        userEmail: req.session.email, 
        error: 'This email is already in use by another account.', 
        success: null 
      });
    }

    // 3. Get the current user's hashed password from the database
    const [rows] = await pool.query(`SELECT password FROM users WHERE id = ?`, [req.session.userId]);
    const user = rows[0];

    // 4. Verify the entered current password matches the database
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.render('profile', { 
        userEmail: req.session.email, 
        error: 'Current password is incorrect.', 
        success: null 
      });
    }

    // 5. ALL CHECKS PASSED! Update the email in the database
    await pool.query(`UPDATE users SET email = ? WHERE id = ?`, [newEmail, req.session.userId]);


    await logActivity(req.session.userId, req.session.email, 'EMAIL_UPDATED', `Changed to ${newEmail}`, req);

    // 6. Update the session so the navbar updates immediately
    req.session.email = newEmail;




    // 7. Show success message
    res.render('profile', { 
      userEmail: newEmail, 
      error: null, 
      success: '✅ Email updated successfully!' 

      

    });

  } catch (err) {
    console.error(err);
    res.render('profile', { 
      userEmail: req.session.email, 
      error: 'Database error. Please try again.', 
      success: null 
    });
  }
});



// --- ROUTE: Handle Password Update ---
router.post('/profile/password', isAuthenticated, async (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;

  // 1. Basic validation
  if (!currentPassword || !newPassword || !confirmPassword) {
    return res.render('profile', { 
      userEmail: req.session.email, 
      error: 'All password fields are required.', 
      success: null 
    });
  }

  if (newPassword !== confirmPassword) {
    return res.render('profile', { 
      userEmail: req.session.email, 
      error: 'New passwords do not match.', 
      success: null 
    });
  }

  if (newPassword.length < 6) {
    return res.render('profile', { 
      userEmail: req.session.email, 
      error: 'New password must be at least 6 characters.', 
      success: null 
    });
  }

  try {
    // 2. Get the current user's hashed password from the database
    const [rows] = await pool.query(`SELECT password FROM users WHERE id = ?`, [req.session.userId]);
    const user = rows[0];

    // 3. Verify the entered current password matches the database
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.render('profile', { 
        userEmail: req.session.email, 
        error: 'Current password is incorrect.', 
        success: null 
      });
    }

    // 4. Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 5. Update the database
    await pool.query(`UPDATE users SET password = ? WHERE id = ?`, [hashedPassword, req.session.userId]);

    await logActivity(req.session.userId, req.session.email, 'PASSWORD_UPDATED', 'Password changed', req);

    // 6. Show success message
    res.render('profile', { 
      userEmail: req.session.email, 
      error: null, 
      success: '✅ Password updated successfully! You can continue using the app.' 

      

    });

  } catch (err) {
    console.error(err);
    res.render('profile', { 
      userEmail: req.session.email, 
      error: 'Database error. Please try again.', 
      success: null 
    });
  }
});

module.exports = router;