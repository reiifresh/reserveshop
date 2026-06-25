// scripts/cleanupLogs.js
const pool = require('../db/database');
require('dotenv').config();

const RETENTION_DAYS = process.env.LOG_RETENTION_DAYS || 30;

async function cleanOldLogs() {
  try {
    console.log(`🧹 Cleaning activity logs older than ${RETENTION_DAYS} days...`);
    
    const [result] = await pool.query(
      `DELETE FROM activity_logs 
       WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [RETENTION_DAYS]
    );

    console.log(`✅ Deleted ${result.affectedRows} log entries.`);
    process.exit(0);
  } catch (err) {
    console.error("❌ Error cleaning logs:", err.message);
    process.exit(1);
  }
}

cleanOldLogs();