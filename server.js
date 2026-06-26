const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session); // 👈 This is the only place we use 'session'
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const logsRoutes = require('./routes/logs');
const pool = require('./db/database'); // 👈 MAKE SURE THIS EXISTS

const attendanceRoutes = require('./routes/attendance');

const scheduleRoutes = require('./routes/schedule');



app.set('trust proxy', true);

// Middleware to read form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session setup with MySQL store
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60000 * 60 }, // 1 hour
  store: new MySQLStore({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
  })
}));

// Make user session available to ALL views (for the navbar)
app.use((req, res, next) => {
  res.locals.user = req.session || null;
  next();
});

// Import our routes
const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contacts');
const staffRoutes = require('./routes/staff');

// Use our routes
app.use('/', authRoutes);
app.use('/', contactRoutes);
app.use('/', staffRoutes);
app.use('/', logsRoutes);

app.use('/', attendanceRoutes);

app.use('/', scheduleRoutes);

// ─── CLEANUP LOGS ENDPOINT (For cron-job.org) ───
app.get('/api/clean-logs', async (req, res) => {
  const secret = process.env.CLEANUP_SECRET || 'your-super-secret-key';
  
  // 👇 Check the secret key to prevent unauthorized access
  if (req.query.secret !== secret) {
    return res.status(401).send('🔒 Unauthorized');
  }

  try {
    const RETENTION_DAYS = process.env.LOG_RETENTION_DAYS || 30;
    const [result] = await pool.query(
      `DELETE FROM activity_logs 
       WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [RETENTION_DAYS]
    );
    res.send(`✅ Deleted ${result.affectedRows} old log entries.`);
  } catch (err) {
    console.error("❌ Cleanup error:", err);
    res.status(500).send('❌ Cleanup failed: ' + err.message);
  }
});



// Start the server
app.listen(PORT, () => {
  console.log(`🚀 CRM Server running on port ${PORT}`);
});