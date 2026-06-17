const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const pool = require('../db/database');

// --- HELPER: Admin Only Middleware ---
function isAdmin(req, res, next) {
  if (req.session.userId && req.session.role === 'admin') {
    return next();
  }
  res.status(403).send("❌ Access Denied. Admins only.");
}

// --- HELPER: Send Welcome Email with Temporary Password ---
// --- HELPER: Send Welcome Email with Temporary Password ---
async function sendWelcomeEmail(email, tempPassword) {
  let transporter = nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false, // TLS
    auth: {
      user: process.env.BREVO_SMTP_USER, // Your SMTP login (e.g., af1510001@smtp-brevo.com)
      pass: process.env.BREVO_SMTP_PASSWORD // Your SMTP key
    }
  });

  let loginLink = `https://${process.env.APP_URL || 'localhost:3000'}/login`;
  
  let info = await transporter.sendMail({
    from: `"CRM Admin" <${process.env.EMAIL_FROM || 'noreply@crm.com'}>`,
    to: email,
    subject: "Welcome to the CRM! Your Staff Account",
    html: `
      <h3>Welcome to the team! 🎉</h3>
      <p>Your staff account has been created. Here are your login credentials:</p>
      <p><strong>Email:</strong> ${email}</p>
      <p><strong>Temporary Password:</strong> <code>${tempPassword}</code></p>
      <p><a href="${loginLink}">Click here to log in</a></p>
      <p>⚠️ Please change your password immediately after logging in.</p>
    `,
  });

  console.log("📧 Email sent to:", email);
  return true;
}

  console.log("📧 Email sent to:", email);
  return true;
}

// --- ROUTE: List All Staff (Admin Only) ---
router.get('/staff', isAdmin, async (req, res) => {
  try {
    console.log("🔍 Fetching staff list..."); // 👈 ADD THIS LINE

    // Get all users EXCEPT the currently logged-in admin
    const [rows] = await pool.query(`SELECT id, email, full_name, role, created_at FROM users WHERE id != ?`, [req.session.userId]);


    console.log("✅ Staff fetched:", rows.length, "records found"); // 👈 ADD THIS LINE

     res.render('staff/index', { staff: rows, userEmail: req.session.email });



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
router.post('/staff/add', isAdmin, async (req, res) => {
  // 1. Get the fullName from the form
  const { email, fullName } = req.body;

  // 2. Validation (check if name is empty)
  if (!fullName || fullName.trim() === '') {
    return res.render('staff/add', { error: 'Full name is required.', success: null, userEmail: req.session.email });
  }

  try {
    // 1. Check if email already exists
    const [existing] = await pool.query(`SELECT id FROM users WHERE email = ?`, [email.trim()]);
    if (existing.length > 0) {
      return res.render('staff/add', { error: 'This email is already registered.', success: null, userEmail: req.session.email });
    }

    // 2. Generate a random temporary password (8 characters)
    const tempPassword = crypto.randomBytes(4).toString('hex'); // e.g., "a1b2c3d4"
    const hashedPassword = await bcrypt.hash(tempPassword, 10);

    // 3. Insert into database (add full_name)
    await pool.query(`INSERT INTO users (email, password, role, full_name) VALUES (?, ?, ?, ?)`, 
      [email.trim(), hashedPassword, 'staff', fullName.trim()]);

    // 4. Send the welcome email with the temp password
    await sendWelcomeEmail(email.trim(), tempPassword);

    res.render('staff/add', { 
      error: null, 
      success: `✅ Staff account created for ${email.trim()}. A welcome email has been sent. Check the terminal for the preview link.`, 
      userEmail: req.session.email 
    });

  } catch (err) {
    console.error(err);
    res.render('staff/add', { error: 'Database error. Try again.', success: null, userEmail: req.session.email });
  }
});

// --- ROUTE: Delete Staff (Admin Only) ---
router.get('/staff/delete/:id', isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    // Prevent admin from deleting themselves
    if (parseInt(id) === req.session.userId) {
      return res.send("❌ You cannot delete your own account.");
    }

    await pool.query(`DELETE FROM users WHERE id = ?`, [id]);
    res.redirect('/staff');
  } catch (err) {
    console.error(err);
    res.redirect('/staff');
  }
});

module.exports = router;