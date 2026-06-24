// --- ROUTE: Activity Log (Admin Only) ---
router.get('/logs', isAdmin, async (req, res) => {
  try {
    const [logs] = await pool.query(`
      SELECT * FROM activity_logs 
      ORDER BY created_at DESC 
      LIMIT 100
    `);
    res.render('logs', { logs, userEmail: req.session.email });
  } catch (err) {
    console.error(err);
    res.send("Error loading logs.");
  }
});