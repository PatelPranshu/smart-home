const History = require('../models/History');

exports.getHistory = async (req, res) => {
    try {
        const logs = await History.find({ owner: req.user.id }).sort({ timestamp: -1 });
        
        // Map the database fields to the format app.js expects
        const formattedLogs = logs.map(log => ({
            ...log._doc,
            action: `${log.state ? 'Turned ON' : 'Turned OFF'} (${log.source})`
        }));
        
        res.json(formattedLogs);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch history" });
    }
};