const pool = require('../db/database');
const axios = require('axios'); // 👈 ADD THIS

// Helper: Get country code from IP address
async function getCountryFromIP(ip) {
  // Skip private/internal IPs
  if (!ip || ip.startsWith('10.') || ip.startsWith('172.') || ip.startsWith('192.168.') || ip === '::1' || ip === '127.0.0.1') {
    return null;
  }

  try {
    const response = await axios.get(`http://ip-api.com/json/${ip}?fields=status,countryCode`, {
      timeout: 3000 // 3 second timeout to avoid hanging
    });
    
    if (response.data && response.data.status === 'success') {
      return response.data.countryCode;
    }
    return null;
  } catch (err) {
    console.error("❌ Failed to fetch country for IP:", ip, err.message);
    return null;
  }
}

async function logActivity(userId, userEmail, action, details = null, req = null) {
  try {
    const ipAddress = req ? req.ip || req.connection?.remoteAddress || null : null;
    const userAgent = req ? req.headers['user-agent'] || null : null;

    // Get country code from IP
    let countryCode = null;
    if (ipAddress) {
      countryCode = await getCountryFromIP(ipAddress);
    }

    await pool.query(
      `INSERT INTO activity_logs (user_id, user_email, action, details, ip_address, user_agent, country_code)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, userEmail, action, details, ipAddress, userAgent, countryCode]
    );
  } catch (err) {
    console.error("❌ Failed to log activity:", err.message);
  }
}

module.exports = logActivity;