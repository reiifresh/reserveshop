const pool = require('../db/database');

async function logActivity(userId, userEmail, action, details = null, req = null) {
  try {
    const ipAddress = req ? req.ip || req.connection?.remoteAddress || null : null;
    const userAgent = req ? req.headers['user-agent'] || null : null;

    await pool.query(
      `INSERT INTO activity_logs (user_id, user_email, action, details, ip_address, user_agent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, userEmail, action, details, ipAddress, userAgent]
    );
  } catch (err) {
    console.error("❌ Failed to log activity:", err.message);
  }
}

module.exports = logActivity;