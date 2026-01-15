const mqtt = require('mqtt');
const Device = require('../models/Device');
const User = require('../models/User');
const History = require('../models/History');
const appSmartHome = require('./smartHome');

// MQTT Client Setup (Connects to HiveMQ Cloud)
const mqttClient = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    protocol: 'mqtts' // Secure TLS
});

// --- ADD THIS BLOCK ---
let ioInstance; 
mqttClient.attachIO = (io) => { ioInstance = io; };
// ----------------------

mqttClient.on('connect', () => {
    console.log('Backend connected to MQTT Broker');
    mqttClient.subscribe('devices/+/update'); // Listener for manual flips
    mqttClient.subscribe('devices/+/sync');   // Listener for reboots
    mqttClient.subscribe('devices/+/status'); // Listen for Online/Offline
    mqttClient.subscribe('devices/+/sensor'); // Subscribe to sensor data
});

// Handle MQTT Messages
mqttClient.on('message', async (topic, message) => {
    try {
        const parts = topic.split('/');
        if (parts.length < 3) return;

        const deviceId = parts[1];
        const type = parts[2];

        // 1. User flipped physical switch -> Update DB
        if (type === 'update') {
            const data = JSON.parse(message.toString());
            const device = await Device.findOne({ deviceId }).populate('owner', 'isGoogleLinked').lean();

            if (!device) return;

            const sw = device.switches.find(s => s.id === data.switchId);
            if (!sw) return;

            // INVERSION LOGIC: Calculate logical state
            const userIntentState = sw.inverted ? !data.state : data.state;

            let updateFields = { "switches.$.state": userIntentState };
            if (userIntentState) {
                updateFields["switches.$.lastOnTime"] = new Date();
            } else {
                updateFields["switches.$.lastOnTime"] = null;
                updateFields["switches.$.timerExpiresAt"] = null;
            }

            await Device.updateOne(
                { deviceId: deviceId, "switches.id": data.switchId },
                { $set: updateFields }
            );

            if (ioInstance) ioInstance.emit('deviceUpdate', { deviceId, switchId: data.switchId, state: userIntentState });

            // BACKGROUND TASKS
            (async () => {
                try {
                    if (!device.owner) return;
                    await History.create({
                        owner: device.owner._id,
                        deviceId: deviceId,
                        switchId: data.switchId,
                        switchName: sw.name || `Switch ${data.switchId}`,
                        state: userIntentState,
                        source: 'physical'
                    });

                    // REPORT STATE TO GOOGLE
                    if (device.owner.isGoogleLinked === true) {
                        try {
                            await appSmartHome.reportState({
                                agentUserId: device.owner._id.toString(),
                                requestId: Math.random().toString(),
                                payload: {
                                    devices: {
                                        states: {
                                            [`${deviceId}-${data.switchId}`]: {
                                                on: userIntentState,
                                                online: device.isOnline || true
                                            }
                                        }
                                    }
                                }
                            });
                        } catch (error) {
                            if (error.status === 404 || (error.response && error.response.status === 404)) {
                                console.warn(`⚠️ User ${device.owner._id} unlinked from Google.`);
                                await User.findByIdAndUpdate(device.owner._id, { isGoogleLinked: false });
                            }
                        }
                    }
                } catch (bgErr) {
                    console.error(`[BG TASK ERROR] ${deviceId}:`, bgErr.message);
                }
            })();
        }

        // 2. Device Rebooted -> Restore State
        else if (type === 'sync') {
            const device = await Device.findOne({ deviceId }).lean();
            if (device) {
                device.switches.forEach(sw => {
                    const hardwareSignal = sw.inverted ? !sw.state : sw.state;
                    mqttClient.publish(`devices/${deviceId}/command`, JSON.stringify({ switchId: sw.id, state: hardwareSignal }));
                });
            }
        }

        // 3. Device Status Change
        else if (type === 'status') {
            const status = message.toString().trim().toLowerCase();
            const isOnline = (status === 'online');
            
            const device = await Device.findOneAndUpdate(
                { deviceId: deviceId },
                { $set: { isOnline: isOnline } },
                { new: true }
            ).lean();

            // --- ADD THIS: Push status change to Frontend ---
            if (ioInstance) ioInstance.emit('deviceUpdate', { deviceId });

            if (device && device.owner) {
                const ownerRecord = await User.findById(device.owner).lean();
                if (ownerRecord && ownerRecord.isGoogleLinked === true) {
                    let statesPayload = {};
                    device.switches.forEach(sw => {
                        statesPayload[`${deviceId}-${sw.id}`] = { 
                            online: isOnline,
                            on: isOnline ? sw.state : false 
                        };
                    });

                    appSmartHome.reportState({
                        agentUserId: device.owner.toString(),
                        requestId: Date.now().toString(),
                        payload: { devices: { states: statesPayload } }
                    }).catch(e => console.error("Google Status Report Error:", e.message));
                }
            }
        }

        // 4. Handle Sensor Data
        else if (type === 'sensor') {
            const data = JSON.parse(message.toString());
            await Device.updateOne(
                { deviceId: deviceId },
                { $set: { temperature: data.temp, humidity: data.hum } }
            );

            // --- ADD THIS: Push sensor change to Frontend ---
            if (ioInstance) ioInstance.emit('deviceUpdate', { deviceId });
        }

    } catch (err) {
        console.error(`[MQTT ERROR] topic ${topic}:`, err.message);
    }
});

module.exports = mqttClient;