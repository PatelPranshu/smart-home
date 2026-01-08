const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { auth, verifyAdmin } = require('../middleware/auth');

router.get('/admin/stats', auth, verifyAdmin, adminController.getStats);

router.get('/admin/devices', auth, verifyAdmin, adminController.getAllDevices);

router.post('/admin/create', auth, verifyAdmin, adminController.createDevice);

router.delete('/admin/device/:id', auth, verifyAdmin, adminController.deleteDevice);

router.get('/admin/users', auth, verifyAdmin, adminController.getAllUsers);

router.post('/admin/unlink', auth, verifyAdmin, adminController.unlinkUser);

router.post('/admin/device/invert-logic', auth, verifyAdmin, adminController.invertLogic);

router.post('/admin/device/channels', auth, verifyAdmin, adminController.updateChannels);

module.exports = router;