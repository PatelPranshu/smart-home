const rateLimit = require('express-rate-limit');

// General rate limiter for all API requests
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 Minute
  max: 200,                
  message: "Too many requests, please slow down."
});

// Strict limiter for sensitive actions like login and device claiming
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 Hour
  max: 10,                   
  message: "Too many failed attempts. Access locked for 1 hour."
});

module.exports = { globalLimiter, authLimiter };