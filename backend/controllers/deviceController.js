const { validationResult } = require('express-validator');
const bcrypt = require('bcryptjs');
const Device = require('../models/Device');
const User = require('../models/User');
const History = require('../models/History');
const mqttClient = require('../config/mqtt'); // Import your shared MQTT client
const { smarthome } = require('actions-on-google'); // If needed for reporting

let activeTimers = {}; 

exports.getDevices = async (req, res) => {
    try {
        // Ensure req.user exists (set by auth middleware)
        if (!req.user || !req.user.id) {
            return res.status(401).json({ error: "Unauthorized" });
        }
        const devices = await Device.find({ owner: req.user.id }).lean();
        res.json(devices);
    } catch (err) {
        console.error("Fetch Devices Error:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
};

exports.claimDevice = async (req, res) => {
    const { deviceId, secretCode } = req.body;
    try {
        const device = await Device.findOne({ deviceId });
        if (!device) return res.status(404).json({ error: "Device ID not found." });
        if (device.secretCode !== secretCode) return res.status(403).json({ error: "Invalid Secret Code." });
        if (device.owner) return res.status(400).json({ error: "Already registered." });

        device.owner = req.user.id;
        device.switches.forEach(sw => sw.state = false); 
        await device.save();
        res.json({ status: 'success' });
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
};

exports.controlDevice = async (req, res) => {
    const { deviceId, switchId, state } = req.body;
    try {
        const device = await Device.findOne({ deviceId, owner: req.user.id });
        if (!device) return res.status(404).json({ error: "Device not found" });

        const sw = device.switches.find(s => s.id === switchId);
        const hardwareSignal = sw.inverted ? !state : state;
        mqttClient.publish(`devices/${deviceId}/command`, JSON.stringify({ switchId, state: hardwareSignal }));

        let updateFields = { "switches.$.state": state };
        state ? (updateFields["switches.$.lastOnTime"] = new Date()) : (updateFields["switches.$.lastOnTime"] = null);

        await Device.updateOne({ deviceId, "switches.id": switchId }, { $set: updateFields });
       
        // Emit Socket Update
        const io = req.app.get('socketio');
        io.emit('deviceUpdate', { deviceId, switchId, state });
        res.json({ status: 'sent', state });

        // Background Task: Log History
        History.create({
            owner: req.user.id,
            deviceId,
            switchId,
            switchName: sw ? sw.name : `Switch ${switchId}`,
            state: state,
            source: 'app'
        }).catch(e => console.error("History error", e));
    } catch (err) { res.status(500).json({ error: "Server Error" }); }
};

exports.setTimer = async (req, res) => {
    const { deviceId, switchId, minutes } = req.body;
    const timerKey = `${deviceId}-${switchId}`;
    if (activeTimers[timerKey]) clearTimeout(activeTimers[timerKey]);

    try {
        const device = await Device.findOne({ deviceId, owner: req.user.id });
        if (!device) return res.status(404).json({ error: "Device not found" });

        const sw = device.switches.find(s => s.id === switchId);
        if (!sw) return res.status(404).json({ error: "Switch not found" });

        const expiryDate = new Date(Date.now() + minutes * 60000);

        // 1. Send MQTT Turn ON
        const startSignal = sw.inverted ? false : true; 
        mqttClient.publish(`devices/${deviceId}/command`, JSON.stringify({ switchId, state: startSignal }));

        // 2. Update Database State
        await Device.updateOne({ deviceId, "switches.id": switchId }, { 
            $set: { 
                "switches.$.state": true, 
                "switches.$.timerExpiresAt": expiryDate,
                "switches.$.lastOnTime": new Date() 
            } 
        });

        // 3. Log "Timer Started" History
        await History.create({
            owner: req.user.id,
            deviceId,
            switchId,
            switchName: sw.name || `Switch ${switchId}`,
            state: true,
            source: 'timer'
        });

        // 4. Start Countdown
        activeTimers[timerKey] = setTimeout(async () => {
            try {
                const dev = await Device.findOne({ deviceId });
                const s = dev ? dev.switches.find(i => i.id === switchId) : null;
                
                if (dev && s) {
                    // Send MQTT Turn OFF
                    mqttClient.publish(`devices/${deviceId}/command`, JSON.stringify({ 
                        switchId, 
                        state: s.inverted ? true : false 
                    }));

                    // Update DB state
                    await Device.updateOne({ deviceId, "switches.id": switchId }, { 
                        $set: { "switches.$.state": false, "switches.$.timerExpiresAt": null } 
                    });

                    // Log "Timer Expired" History
                    await History.create({
                        owner: dev.owner,
                        deviceId,
                        switchId,
                        switchName: s.name || `Switch ${switchId}`,
                        state: false,
                        source: 'timer'
                    });
                }

                // [ADD THIS] Push update to frontend when timer expires
                const io = req.app.get('socketio'); //
                if (io) io.emit('deviceUpdate', { deviceId, switchId, state: false }); //

                
            } catch (timerErr) {
                console.error("Timer Expiration Error:", timerErr);
            }
            delete activeTimers[timerKey];
        }, minutes * 60000);

        res.json({ status: 'timer_set', minutes });
    } catch (err) { 
        console.error("Timer Error:", err);
        res.status(500).json({ error: "Timer error" }); 
    }
};

exports.updateWifi = async (req, res) => {
    const { deviceId, ssid, pass } = req.body;
    const device = await Device.findOne({ deviceId, owner: req.user.id });
    if (!device) return res.status(404).json({ error: "Access denied" });

    mqttClient.publish(`devices/${deviceId}/wifi`, JSON.stringify({ ssid, pass }));
    res.json({ status: 'sent' });
};

exports.verifyPassword = async (req, res) => {
    const { password } = req.body;
    try {
        // Find user by the ID stored in the JWT token
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "User not found" });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(400).json({ error: "Incorrect password" });
        }

        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: "Verification failed" });
    }
};

exports.verifyCode = async (req, res) => {
    const { code } = req.body;
    const device = await Device.findOne({ owner: req.user.id, secretCode: code });
    device ? res.json({ status: 'ok' }) : res.status(400).json({ error: "Invalid Kit Code" });
};

// Edit Device Name and Type
exports.editDevice = async (req, res) => {
    const { deviceId, switchId, newName, newType } = req.body;
    try {
        const result = await Device.updateOne(
            { deviceId, owner: req.user.id, "switches.id": switchId },
            { $set: { "switches.$.name": newName, "switches.$.type": newType } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: "Device not found" });
        res.json({ status: 'updated' });
    } catch (err) { res.status(500).json({ error: "Update failed" }); }
};

// Remove Device Ownership
exports.removeDevice = async (req, res) => {
    const { deviceId } = req.body;
    try {
        const result = await Device.updateOne(
            { deviceId, owner: req.user.id },
            { $set: { owner: null } }
        );
        if (result.matchedCount === 0) return res.status(404).json({ error: "Device not found" });
        res.json({ status: 'removed' });
    } catch (err) { res.status(500).json({ error: "Removal failed" }); }
};