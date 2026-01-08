const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/limiter');

router.post('/register', [
    body('email').isEmail().normalizeEmail().withMessage('Invalid Email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 chars long')
], authController.register);

router.post('/login', authLimiter, [
    body('email').isEmail().normalizeEmail(),
    body('password').not().isEmpty()
], authController.login);

router.get('/user/profile', auth, authController.getProfile);
router.get('/user/google-status', auth, authController.getGoogleStatus);
router.post('/user/google-status', auth, authController.updateGoogleStatus);

router.post('/user-update', auth, [
    body('email').optional().isEmail().normalizeEmail(),
    body('homeTitle').optional().isString().trim().escape().isLength({ max: 50 }),
    body('password').optional().isLength({ min: 6 })
], authController.updateProfile);

module.exports = router;