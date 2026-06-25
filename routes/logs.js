const express = require('express');
const router = express.Router();
const pool = require('../db/database');

function isAdmin(req, res, next) {
  if (req.session.userId && req.session.role === 'admin') {
    return next();
  }
  res.status(403).send("❌ Access Denied. Admins only.");
}

// --- ROUTE: Activity Log (Admin Only) with Filters ---
router.get('/logs', isAdmin, async (req, res) => {
  try {
    // Get filter parameters from URL
    const { user, action, days } = req.query;

    let sqlQuery = `
      SELECT * FROM activity_logs 
      WHERE 1=1
    `;
    const params = [];

    // Filter by user (email)
    if (user && user.trim() !== '') {
      sqlQuery += ` AND user_email = ?`;
      params.push(user.trim());
    }

    // Filter by action
    if (action && action !== 'ALL') {
      sqlQuery += ` AND action = ?`;
      params.push(action);
    }

    // Filter by days (e.g., last 7 days)
    if (days && !isNaN(days) && days > 0) {
      sqlQuery += ` AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`;
      params.push(parseInt(days));
    }

    sqlQuery += ` ORDER BY created_at DESC LIMIT 200`;

    const [logs] = await pool.query(sqlQuery, params);

    // Get all unique users and actions for filter dropdowns
    const [users] = await pool.query(`SELECT DISTINCT user_email FROM activity_logs WHERE user_email IS NOT NULL ORDER BY user_email`);
    const [actions] = await pool.query(`SELECT DISTINCT action FROM activity_logs ORDER BY action`);

    // Pass filter values back to the view so they stay selected
    res.render('logs', {
      logs: logs,
      userEmail: req.session.email,
      filterUser: user || '',
      filterAction: action || 'ALL',
      filterDays: days || '',
      users: users,
      actions: actions
    });

  } catch (err) {
    console.error("❌ Error loading logs:", err);
    res.send("Error loading activity logs.");
  }
});

module.exports = router;