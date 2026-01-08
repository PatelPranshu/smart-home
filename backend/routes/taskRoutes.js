const express = require('express');
const router = express.Router();
const taskController = require('../controllers/taskController');
const { auth } = require('../middleware/auth');

router.get('/tasks', auth, taskController.getTasks);

router.post('/tasks', auth, taskController.createTask);

router.delete('/tasks/:id', auth, taskController.deleteTask);

router.patch('/tasks/:id/toggle', auth, taskController.toggleTask);

module.exports = router;