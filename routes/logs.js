const express = require('express');
const router = express.Router();
const pool = require('../db/database');

// --- HELPER: Admin Only Middleware ---
function isAdmin(req, res, next) {
  if (req.session.userId && req.session.role === 'admin') {
    return next();
  }
  res.status(403).send("❌ Access Denied. Admins only.");
}

// --- ROUTE: Activity Log (Admin Only) ---
router.get('/logs', isAdmin, async (req, res) => {
  try {
    const [logs] = await pool.query(`
      SELECT * FROM activity_logs 
      ORDER BY created_at DESC 
      LIMIT 100
    `);
    res.render('logs', { logs: logs, userEmail: req.session.email });
  } catch (err) {
    console.error("❌ Error loading logs:", err);
    res.send("Error loading activity logs.");
  }
});

module.exports = router;