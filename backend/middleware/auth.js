const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verify standard JWT token
const auth = (req, res, next) => {
  let token = req.headers['authorization'];
  
  if (token && token.startsWith('Bearer ')) {
      token = token.slice(7, token.length);
  } else if (req.headers['x-access-token']) {
      token = req.headers['x-access-token'];
  }

  if (!token) {
      return res.status(401).send("Access Denied");
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).send("Invalid Token");
  }
};

// Verify if the user has admin privileges
const verifyAdmin = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: "Access Denied: Admins Only." });
        }
        next();
    } catch (err) {
        res.status(500).json({ error: "Server Error Checking Admin" });
    }
};

module.exports = { auth, verifyAdmin };