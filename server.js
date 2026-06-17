const express = require('express');
const session = require('express-session');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

// Middleware to read form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Session setup (keeps you logged in)
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60000 * 60 } // 1 hour
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

// Import our auth routes
const authRoutes = require('./routes/auth');

const contactRoutes = require('./routes/contacts');  // 👈 ADD THIS LINE
const staffRoutes = require('./routes/staff'); // 👈 ADD THIS LINE

app.use('/', authRoutes);
app.use('/', contactRoutes); // 👈 ADD THIS LINE
app.use('/', staffRoutes); // 👈 ADD THIS LINE

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 CRM Server running at http://localhost:${PORT}`);
});