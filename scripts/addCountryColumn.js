const pool = require('../db/database');

async function addColumn() {
  try {
    // Check if column exists
    const [columns] = await pool.query(`SHOW COLUMNS FROM activity_logs LIKE 'country_code'`);
    
    if (columns.length === 0) {
      await pool.query(`ALTER TABLE activity_logs ADD COLUMN country_code VARCHAR(2) NULL`);
      console.log("✅ country_code column added!");
    } else {
      console.log("✅ country_code column already exists!");
    }
    
    process.exit(0);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
}

addColumn();