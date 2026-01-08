const Task = require('../models/Task');

exports.getTasks = async (req, res) => {
    const tasks = await Task.find({ owner: req.user.id }).sort({ createdAt: -1 });
    res.json(tasks);
};

exports.createTask = async (req, res) => {
    const { deviceId, switchId, switchName, onTime, offTime, days } = req.body;
    try {
        const task = await Task.create({
            owner: req.user.id,
            deviceId, switchId, switchName, onTime, offTime, days
        });
        res.json({ status: 'created', task });
    } catch (err) { res.status(500).json({ error: "Failed to create task" }); }
};

exports.deleteTask = async (req, res) => {
    await Task.findOneAndDelete({ _id: req.params.id, owner: req.user.id });
    res.json({ status: 'deleted' });
};

exports.toggleTask = async (req, res) => {
    const { isEnabled } = req.body;
    await Task.findOneAndUpdate({ _id: req.params.id, owner: req.user.id }, { isEnabled });
    res.json({ status: 'updated' });
};