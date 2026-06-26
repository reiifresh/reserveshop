const express = require('express');
const router = express.Router();
const pool = require('../db/database');

const logActivity = require('../helpers/activityLogger');
const { isAuthenticated, isAdmin, isHR } = require('../helpers/authMiddleware');

// --- HELPER: Middleware to protect routes ---



// --- ROUTE: List all Contacts (WITH SEARCH) ---
router.get('/contacts', isAuthenticated, async (req, res) => {
  const search = req.query.search || '';
  let contacts = [];

  try {
    if (search.trim() !== '') {
      const searchTerm = `%${search.trim()}%`;
      const [rows] = await pool.query(`
        SELECT * FROM contacts 
        WHERE name LIKE ? 
           OR email LIKE ? 
           OR company LIKE ?
        ORDER BY created_at DESC
      `, [searchTerm, searchTerm, searchTerm]);
      contacts = rows;
    } else {
      const [rows] = await pool.query(`SELECT * FROM contacts ORDER BY created_at DESC`);
      contacts = rows;
    }

    res.render('contacts/index', { 
      contacts: contacts, 
      search: search.trim(),
      userEmail: req.session.email 
    });
  } catch (err) {
    console.error(err);
    res.send("Error loading contacts.");
  }
});

// --- ROUTE: Show Add Contact Form ---
router.get('/contacts/add', isAuthenticated, (req, res) => {
  res.render('contacts/add', { error: null, userEmail: req.session.email });
});

// --- ROUTE: Handle Add Contact ---
router.post('/contacts/add', isAuthenticated, async (req, res) => {
  const { name, email, phone, company, notes } = req.body;

  if (!name || name.trim() === '') {
    return res.render('contacts/add', { error: 'Name is required.', userEmail: req.session.email });
  }

  try {
    await pool.query(`
      INSERT INTO contacts (name, email, phone, company, notes) 
      VALUES (?, ?, ?, ?, ?)
    `, [name.trim(), email || null, phone || null, company || null, notes || null]);

    await logActivity(req.session.userId, req.session.email, 'CONTACT_CREATED', `Contact "${name}" created`, req);

    res.redirect('/contacts');
  } catch (err) {
    console.error(err);
    res.render('contacts/add', { error: 'Database error. Try again.', userEmail: req.session.email });
  }
});

// --- ROUTE: Show Edit Contact Form ---
router.get('/contacts/edit/:id', isAuthenticated, isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await pool.query(`SELECT * FROM contacts WHERE id = ?`, [id]);
    if (rows.length === 0) {
      return res.redirect('/contacts');
    }
    res.render('contacts/edit', { contact: rows[0], error: null, userEmail: req.session.email });
  } catch (err) {
    console.error(err);
    res.redirect('/contacts');
  }
});

// --- ROUTE: Handle Edit Contact ---
router.post('/contacts/edit/:id', isAuthenticated, isAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, email, phone, company, notes } = req.body;

  if (!name || name.trim() === '') {
    return res.render('contacts/edit', { 
      contact: { id, name, email, phone, company, notes }, 
      error: 'Name is required.', 
      userEmail: req.session.email 
    });
  }

  try {
    await pool.query(`
      UPDATE contacts SET name = ?, email = ?, phone = ?, company = ?, notes = ? WHERE id = ?
    `, [name.trim(), email || null, phone || null, company || null, notes || null, id]);


    await logActivity(req.session.userId, req.session.email, 'CONTACT_UPDATED', `Contact "${name}" updated`, req);

    res.redirect('/contacts');
  } catch (err) {
    console.error(err);
    res.redirect('/contacts');
  }
});

// --- ROUTE: Handle Delete Contact ---
router.get('/contacts/delete/:id', isAuthenticated, isAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query(`DELETE FROM contacts WHERE id = ?`, [id]);

    await logActivity(req.session.userId, req.session.email, 'CONTACT_DELETED', `Contact ID ${id} deleted`, req);
    
    res.redirect('/contacts');
  } catch (err) {
    console.error(err);
    res.redirect('/contacts');
  }
});

module.exports = router;