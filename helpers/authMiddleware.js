// helpers/authMiddleware.js
function isAdmin(req, res, next) {
  if (req.session.userId && req.session.role === 'admin') {
    return next();
  }
  res.status(403).render('error', {
    message: 'You do not have admin privileges to access this page.',
    user: req.session
  });
}

module.exports = { isAdmin };