const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const pool = require('../db/database');
const { isAuthenticated, isAdmin, isHR } = require('../helpers/authMiddleware');

const axios = require('axios'); // 👈 Add this at the top of the file

const logActivity = require('../helpers/activityLogger');

// --- HELPER: Admin Only Middleware ---


// --- HELPER: Send Welcome Email with Temporary Password ---
// --- HELPER: Send Welcome Email with Temporary Password ---
// --- HELPER: Send Welcome Email with Brevo API ---
async function sendWelcomeEmail(email, tempPassword, role = 'staff') {
  const loginLink = `https://${process.env.APP_URL || 'localhost:3000'}/login`;

  const roleDisplay = role === 'hr_manager' ? 'HR Manager' : 'Staff';
  
  try {
    const response = await axios.post(
      'https://api.brevo.com/v3/smtp/email',
      {
        sender: { 
          email: process.env.EMAIL_FROM || 'noreply@crm.com',
          name: 'CRM Admin'
        },
        to: [{ email: email }],
        subject: `Welcome to the CRM! Your ${roleDisplay} Account`, // 👈 DYNAMIC SUBJECT
        htmlContent: `
          <h3>Welcome to the team! 🎉</h3>
          <p>Your <strong>${roleDisplay}</strong> account has been created. Here are your login credentials:</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>
          <p><a href="${loginLink}">Click here to log in</a></p>
          <p>⚠️ Please change your password immediately after logging in.</p>
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
    
    console.log("📧 Email sent to:", email);
    return true;
  } catch (error) {
    console.error("❌ Email error:", error.response?.data || error.message);
    return false;
  }
}


// ─── ADMIN/HR: View Staff List (Read-only) ───
router.get('/staff', isHR, async (req, res) => {
  try {
    const [rows] = await pool.query(`SELECT id, email, full_name, role, created_at FROM users WHERE id != ?`, [req.session.userId]);
    res.render('staff/index', { staff: rows, userEmail: req.session.email, user: req.session });
  } catch (err) {
    console.error(err);
    res.send("Error loading staff.");
  }
});

// --- ROUTE: Show Add Staff Form (Admin Only) ---
router.get('/staff/add', isAdmin, (req, res) => {
  res.render('staff/add', { error: null, success: null, userEmail: req.session.email });
});

// --- ROUTE: Handle Add Staff (Admin Only) ---
// --- ROUTE: Handle Add Staff (Admin Only) ---
router.post('/staff/add', isAdmin, async (req, res) => {
  const { email, fullName, role } = req.body;

  if (!fullName || fullName.trim() === '') {
    return res.render('staff/add', { 
      error: 'Full name is required.', 
      success: null, 
      userEmail: req.session.email 
    });
  }

  if (!email || email.trim() === '') {
    return res.render('staff/add', { 
      error: 'Email is required.', 
      success: null, 
      userEmail: req.session.email 
    });
  }

  try {
    const [existing] = await pool.query(`SELECT id FROM users WHERE email = ?`, [email.trim()]);
    if (existing.length > 0) {
      return res.render('staff/add', { 
        error: 'This email is already registered.', 
        success: null, 
        userEmail: req.session.email 
      });
    }

    const tempPassword = crypto.randomBytes(4).toString('hex');
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // 👇 ROLE IS NOW INCLUDED
    await pool.query(
      `INSERT INTO users (email, password, role, full_name) VALUES (?, ?, ?, ?)`,
      [email.trim(), hashedPassword, role || 'staff', fullName.trim()]
    );

    await sendWelcomeEmail(email.trim(), tempPassword, role || 'staff');

    res.render('staff/add', { 
      error: null, 
      success: `✅ ${role || 'Staff'} account created for ${email.trim()}. A welcome email has been sent.`, 
      userEmail: req.session.email 
    });

  } catch (err) {
    console.error(err);
    res.render('staff/add', { 
      error: 'Database error. Try again.', 
      success: null, 
      userEmail: req.session.email 
    });
  }
});

// --- ROUTE: Delete Staff (Admin Only) ---
router.get('/staff/delete/:id', isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // Prevent admin from deleting themselves
    if (parseInt(id) === req.session.userId) {
      return res.status(403).render('error', {
        message: 'You cannot delete your own account.',
        user: req.session
      });
    }
    
    await pool.query(`DELETE FROM users WHERE id = ?`, [id]);

    await logActivity(req.session.userId, req.session.email, 'STAFF_DELETED', `Staff ID ${id} deleted`, req);

    res.redirect('/staff');
  } catch (err) {
    console.error(err);
    res.redirect('/staff');
  }
});

module.exports = router;