const Device = require('../models/Device');
const User = require('../models/User');

exports.getStats = async (req, res) => {
    try {
        const stats = {
            totalUsers: await User.countDocuments(),
            totalDevices: await Device.countDocuments(),
            onlineDevices: await Device.countDocuments({ isOnline: true }),
            unownedDevices: await Device.countDocuments({ owner: null })
        };
        res.json(stats);
    } catch (err) { res.status(500).json({ error: "Stats failed" }); }
};

exports.getAllDevices = async (req, res) => {
    const devices = await Device.find().populate('owner', 'email').sort({ _id: -1 });
    res.json(devices);
};

exports.createDevice = async (req, res) => {
    const { deviceId, secretCode, channels } = req.body;
    const numSwitches = channels || 9;
    try {
        const existing = await Device.findOne({ deviceId });
        if (existing) return res.status(400).json({ error: "Device ID exists!" });

        const defaultSwitches = Array.from({ length: numSwitches }, (_, i) => ({
            id: i, name: `Switch ${i + 1}`, state: false, type: 'light'
        }));

        const newDevice = await Device.create({ deviceId, secretCode, switches: defaultSwitches });
        res.json({ status: 'created', device: newDevice });
    } catch (err) { res.status(500).json({ error: "Creation failed" }); }
};

exports.deleteDevice = async (req, res) => {
    await Device.findOneAndDelete({ deviceId: req.params.id });
    res.json({ status: 'deleted' });
};

exports.getAllUsers = async (req, res) => {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    res.json(users);
};

exports.unlinkUser = async (req, res) => {
    const { deviceId } = req.body;
    await Device.updateOne({ deviceId }, { $set: { owner: null } });
    res.json({ status: 'unlinked' });
};

exports.invertLogic = async (req, res) => {
    const { deviceId, switchId, inverted } = req.body;
    await Device.updateOne(
        { deviceId, "switches.id": switchId },
        { $set: { "switches.$.inverted": inverted } }
    );
    res.json({ status: 'updated' });
};

// Admin: Update Device Channels (Resize)
exports.updateChannels = async (req, res) => {
    const { deviceId, channels } = req.body;
    const num = parseInt(channels);

    try {
        const device = await Device.findOne({ deviceId });
        if (!device) return res.status(404).json({ error: "Device not found" });

        const currentLen = device.switches.length;

        if (num > currentLen) {
            // EXPAND: Add new switches
            for (let i = currentLen; i < num; i++) {
                device.switches.push({
                    id: i,
                    name: `Switch ${i + 1}`,
                    state: false,
                    type: 'light'
                });
            }
        } else if (num < currentLen) {
            // SHRINK: Remove switches (Truncate array)
            device.switches = device.switches.slice(0, num);
        }

        await device.save();
        res.json({ status: 'updated', count: device.switches.length });
    } catch (err) { 
        console.error("Channel update error:", err);
        res.status(500).json({ error: "Update failed" }); 
    }
};