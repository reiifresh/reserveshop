const express = require('express');
const router = express.Router();
const pool = require('../db/database');
const { isAuthenticated, isAdmin, isHR } = require('../helpers/authMiddleware');

// ─── STAFF: View Leave Page ───
router.get('/leave', isAuthenticated, async (req, res) => {
  // ... same as before
});

// ─── STAFF: Submit Leave Request ───
router.post('/leave/request', isAuthenticated, async (req, res) => {
  // ... same as before
});

// ─── STAFF: Cancel Pending Request ───
router.post('/leave/cancel/:id', isAuthenticated, async (req, res) => {
  // ... same as before
});

// ─── ADMIN/HR: View Leave Management ───
router.get('/leave/admin', isHR, async (req, res) => {
  // ... same as before
});

// ─── ADMIN/HR: Approve/Reject Leave Request ───
router.post('/leave/admin/action', isHR, async (req, res) => {
  // ... same as before
});

// ─── ADMIN ONLY: Allocate Leave Balance ───
router.post('/leave/admin/allocate', isAdmin, async (req, res) => {
  // ... same as before
});

module.exports = router;