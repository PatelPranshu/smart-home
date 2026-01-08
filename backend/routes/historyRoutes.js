const express = require('express');
const router = express.Router();
const historyController = require('../controllers/historyController');
const { auth } = require('../middleware/auth');

// GET /api/history - Fetch logs for the logged-in user
router.get('/history', auth, historyController.getHistory);

module.exports = router;