const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const deviceController = require('../controllers/deviceController');
const { auth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/limiter');

// 1. Fetching Devices
router.get('/devices', auth, deviceController.getDevices);

// 2. Claiming/Adding Device (Required by settings page)
router.post('/claim-device', auth, authLimiter, deviceController.claimDevice);

// 3. Device Control & Timer
router.post('/control', auth, [
    body('deviceId').isString().trim().escape(),
    body('switchId').isInt(),
    body('state').isBoolean()
], deviceController.controlDevice);

router.post('/timer', auth, deviceController.setTimer);

// 4. Settings & Management
// routes/deviceRoutes.js

router.post('/edit', auth, [
    body('deviceId').isString().trim(),
    body('switchId').isInt(),
    // Set the limit to 20 characters here
    body('newName')
        .isString()
        .trim()
        .isLength({ min: 2, max: 20 })
        .withMessage('Name must be between 2 and 20 characters')
        .escape(),
    body('newType').isString().isIn(['light', 'fan', 'ac', 'outlet', 'wifi', 'socket', 'water', 'laundry'])
], deviceController.editDevice);
router.post('/remove-device', auth, deviceController.removeDevice);
router.post('/wifi-config', auth, deviceController.updateWifi);

// 5. Verifications
router.post('/verify-password', auth, authLimiter, [
    // Remove body('email') because we already know who the user is from the JWT!
    body('password').not().isEmpty().withMessage('Password is required')
], (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }
    next();
}, deviceController.verifyPassword);
router.post('/verify-code', auth, authLimiter, deviceController.verifyCode);

module.exports = router;