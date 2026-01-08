const express = require('express');
const router = express.Router();
const googleController = require('../controllers/googleController');
const { auth } = require('../middleware/auth');

// OAuth Endpoints
router.get('/auth', googleController.authPage);
router.post('/login-link', googleController.loginLink);
router.post('/token', googleController.tokenExchange);

// fulfillment Endpoint
router.post('/api/smarthome', auth, googleController.fulfillment);

module.exports = router;