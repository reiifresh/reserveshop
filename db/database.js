const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Create the connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 👇 Set timezone on every connection
pool.on('connection', (connection) => {
  connection.query(`SET time_zone = '+08:00'`);
});



// Function to initialize the users table
async function initDB() {
  try {
    const connection = await pool.getConnection();
    
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'staff',
        reset_token VARCHAR(255) NULL,
        reset_token_expiry BIGINT NULL
      )
    `);
    console.log("✅ Users table ready in MySQL.");

        // --- CREATE CONTACTS TABLE ---
    await connection.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NULL,
        phone VARCHAR(50) NULL,
        company VARCHAR(255) NULL,
        notes TEXT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("✅ Contacts table ready in MySQL.");


    // Inside initDB() function, after the contacts table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS activity_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        user_email VARCHAR(255),
        action VARCHAR(50) NOT NULL,
        details TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (action),
        INDEX (created_at)
      )
    `);
    console.log("✅ Activity logs table ready.");
    

    // --- INSERT A SAMPLE CONTACT SO YOU HAVE SOMETHING TO SEE ---
    const [contactRows] = await connection.query(`SELECT * FROM contacts LIMIT 1`);
    if (contactRows.length === 0) {
      await connection.query(`
        INSERT INTO contacts (name, email, phone, company, notes) 
        VALUES (?, ?, ?, ?, ?)
      `, ['John Doe', 'john@example.com', '+1 (555) 123-4567', 'Acme Corp', 'Interested in the premium plan.']);
      console.log("✅ Sample contact added: John Doe");
    }

    // Check if default admin exists
    const [rows] = await connection.query(`SELECT * FROM users WHERE email = 'admin@crm.com'`);
    if (rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await connection.query(`INSERT INTO users (email, password, role) VALUES (?, ?, ?)`, ['admin@crm.com', hashedPassword, 'admin']);
    }

    connection.release();
  } catch (err) {
    console.error("❌ MySQL Connection Error:", err.message);
    console.log("💡 Make sure MySQL is running in XAMPP and your .env credentials are correct.");
  }
}

initDB();

module.exports = pool;