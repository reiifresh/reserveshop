const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const pool = require('../db/database');


const axios = require('axios'); // 👈 Make sure this is at the top of the file
const logActivity = require('../helpers/activityLogger');

// --- HELPER: Middleware to protect routes ---
function isAuthenticated(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/login');
}

// --- HELPER: Send email via Ethereal (fake SMTP) ---
// --- HELPER: Send Password Reset Email via Brevo API ---
async function sendResetEmail(email, token) {
  const resetLink = `https://${process.env.APP_URL || 'localhost:3000'}/reset-password/${token}`;

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

// --- ROUTE: Handle Login ---
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await pool.query(`SELECT * FROM users WHERE email = ?`, [email]);
    const user = rows[0];

    if (!user) return res.render('login', { error: 'Invalid email or password.' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.render('login', { error: 'Invalid email or password.' });

    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = user.role; // 👈 Store the role
    req.session.fullName = user.full_name || 'User'; // 👈 ADD THIS

    await logActivity(user.id, user.email, 'LOGIN', null, req);
    
    res.redirect('/dashboard');

  } catch (err) {
    console.error(err);
    res.render('login', { error: 'Database error.' });
  }
});

// --- ROUTE: Dashboard (Protected) ---
router.get('/dashboard', isAuthenticated, (req, res) => {
  res.render('dashboard', { userEmail: req.session.email || 'Admin' });
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

// --- ROUTE: Handle Forgot Password (Sends Email) ---
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  try {
    const [rows] = await pool.query(`SELECT * FROM users WHERE email = ?`, [email]);
    const user = rows[0];

    if (!user) {
      return res.render('forgot', { message: null, error: 'No account with that email.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 3600000;

    await pool.query(`UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?`, 
      [token, expiry, user.id]);

    await logActivity(user.id, user.email, 'PASSWORD_RESET', 'Reset requested', req);


    // 👇 THIS IS THE IMPORTANT PART
    await sendResetEmail(email, token);

    res.render('forgot', {
      message: '✅ Password reset link sent! Check your email inbox (and spam folder).',
      error: null
    });

  } catch (err) {
    console.error(err);
    res.render('forgot', { message: null, error: 'Something went wrong. Please try again.' });
  }
});

// --- ROUTE: Reset Password Page (Click the link) ---
router.get('/reset-password/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const [rows] = await pool.query(`SELECT * FROM users WHERE reset_token = ?`, [token]);
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

    // 6. Update the session so the navbar updates immediately
    req.session.email = newEmail;

    // 7. Show success message
    res.render('profile', { 
      userEmail: newEmail, 
      error: null, 
      success: '✅ Email updated successfully!' 

      await logActivity(req.session.userId, req.session.email, 'EMAIL_UPDATED', `Changed to ${newEmail}`, req);

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

    // 6. Show success message
    res.render('profile', { 
      userEmail: req.session.email, 
      error: null, 
      success: '✅ Password updated successfully! You can continue using the app.' 

      await logActivity(req.session.userId, req.session.email, 'PASSWORD_UPDATED', 'Password changed', req);

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