const pool = require('../db/database');

// ─── Check if user is logged in ───
function isAuthenticated(req, res, next) {
  if (req.session.userId) {
    return next();
  }
  res.redirect('/login');
}

// ─── Check if user is Admin ───
function isAdmin(req, res, next) {
  if (req.session.userId && req.session.role === 'admin') {
    return next();
  }
  res.status(403).render('error', {
    message: 'You do not have admin privileges to access this page.',
    user: req.session
  });
}

// ─── Check if user is Admin OR HR Manager ───
function isHR(req, res, next) {
  if (req.session.userId && (req.session.role === 'admin' || req.session.role === 'hr_manager')) {
    return next();
  }
  res.status(403).render('error', {
    message: 'You do not have HR privileges to access this page.',
    user: req.session
  });
}

// ─── Check if user is Staff (basic access) ───
function isStaff(req, res, next) {
  if (req.session.userId && req.session.role === 'staff') {
    return next();
  }
  res.status(403).render('error', {
    message: 'You do not have staff privileges to access this page.',
    user: req.session
  });
}

module.exports = { isAuthenticated, isAdmin, isHR, isStaff };