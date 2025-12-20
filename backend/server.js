require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mqtt = require('mqtt');
const cors = require('cors');
const User = require('./models/User');
const Device = require('./models/Device');

const app = express();

// --- CORS CONFIGURATION ---
app.use(cors({
  origin: process.env.ORIGIN_URL, // Allows localhost, mobile IP, and vercel
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-access-token']
}));

app.use(express.json());

// 1. Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));

// 2. MQTT Client Setup (Connects to HiveMQ Cloud)
const mqttClient = mqtt.connect(process.env.MQTT_URL, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  protocol: 'mqtts' // Secure TLS
});

mqttClient.on('connect', () => {
  console.log('Backend connected to MQTT Broker');
  mqttClient.subscribe('devices/+/update'); // Listener for manual flips
  mqttClient.subscribe('devices/+/sync');   // Listener for reboots
  mqttClient.subscribe('devices/+/status'); // Listen for Online/Offline
});

// 3. Handle MQTT Messages
mqttClient.on('message', async (topic, message) => {
  const parts = topic.split('/');
  const deviceId = parts[1];
  const type = parts[2]; 

  // CASE A: User flipped physical switch -> Update DB
  if (type === 'update') {
    const data = JSON.parse(message.toString());
    
    let updateFields = { "switches.$.state": data.state };
    
    if (data.state) {
        updateFields["switches.$.lastOnTime"] = new Date();
    } else {
        updateFields["switches.$.lastOnTime"] = null;
        updateFields["switches.$.timerExpiresAt"] = null;
    }

    await Device.updateOne(
      { deviceId: deviceId, "switches.id": data.switchId },
      { $set: updateFields }
    );
    console.log(`Update: ${deviceId} switch ${data.switchId} -> ${data.state}`);
  }

  // CASE B: Device Rebooted -> Restore State
  else if (type === 'sync') {
    console.log(`Device ${deviceId} rebooted. Restoring state...`);
    const device = await Device.findOne({ deviceId });
    if (device) {
      device.switches.forEach(sw => {
        const payload = JSON.stringify({ switchId: sw.id, state: sw.state });
        mqttClient.publish(`devices/${deviceId}/command`, payload);
      });
    }
  }

  // CASE C: Device Status Change (Online/Offline)
  if (type === 'status') {
    const status = message.toString(); 
    const isOnline = status === 'online';
    console.log(`Device ${deviceId} is now ${status}`);
    await Device.updateOne(
        { deviceId: deviceId },
        { $set: { isOnline: isOnline } }
    );
  }
});


// --- MIDDLEWARE ---
const auth = (req, res, next) => {
  const token = req.headers['x-access-token'];
  if (!token) return res.status(401).send("Access Denied");
  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    res.status(400).send("Invalid Token");
  }
};


// --- AUTH API ---

// Register
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const user = await User.create({ email, password: hashedPassword });
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(400).json({ error: 'Email already exists' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ error: 'User not found' });
  
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid password' });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  res.json({ token });
});

// NEW: Update User Password/Email
app.post('/api/user-update', auth, async (req, res) => {
  const { email, password } = req.body;
  
  try {
      // Create update object
      let updates = {};
      if (email) updates.email = email;
      if (password) {
        updates.password = await bcrypt.hash(password, 10);
      }

      // Update the user who is currently logged in (req.user.id)
      await User.findByIdAndUpdate(req.user.id, updates);
      
      res.json({ status: 'updated' });
  } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to update user" });
  }
});


// --- DEVICE API ---

// Get User's Devices
app.get('/api/devices', auth, async (req, res) => {
  const devices = await Device.find({ owner: req.user.id });
  res.json(devices);
});

// Toggle Switch
app.post('/api/control', auth, async (req, res) => {
  const { deviceId, switchId, state } = req.body;
  
  const device = await Device.findOne({ deviceId, owner: req.user.id });
  if (!device) return res.status(404).json({ error: "Device not found" });

  const payload = JSON.stringify({ switchId, state });
  mqttClient.publish(`devices/${deviceId}/command`, payload);

  let updateFields = { "switches.$.state": state };
  if (state) {
      updateFields["switches.$.lastOnTime"] = new Date();
  } else {
      updateFields["switches.$.lastOnTime"] = null;
      updateFields["switches.$.timerExpiresAt"] = null; 
  }

  await Device.updateOne(
    { deviceId: deviceId, "switches.id": switchId },
    { $set: updateFields }
  );

  res.json({ status: 'sent', state });
});

// Edit Device (Name & Icon)
app.post('/api/edit', auth, async (req, res) => {
  const { deviceId, switchId, newName, newType } = req.body;
  await Device.updateOne(
    { deviceId: deviceId, "switches.id": switchId },
    { $set: { "switches.$.name": newName, "switches.$.type": newType } }
  );
  res.json({ status: 'updated' });
});

// Timer (Auto Turn Off)
let activeTimers = {}; 

app.post('/api/timer', auth, async (req, res) => {
  const { deviceId, switchId, minutes } = req.body;
  const timerKey = `${deviceId}-${switchId}`;
  
  if (activeTimers[timerKey]) clearTimeout(activeTimers[timerKey]);

  const expiryDate = new Date(Date.now() + minutes * 60000);

  await Device.updateOne(
    { deviceId: deviceId, "switches.id": switchId },
    { $set: { "switches.$.timerExpiresAt": expiryDate } }
  );

  activeTimers[timerKey] = setTimeout(async () => {
    console.log(`Timer expired! Turning off ${deviceId} switch ${switchId}`);
    
    const offPayload = JSON.stringify({ switchId, state: false });
    mqttClient.publish(`devices/${deviceId}/command`, offPayload);
    
    await Device.updateOne(
      { deviceId: deviceId, "switches.id": switchId },
      { $set: { 
          "switches.$.state": false,
          "switches.$.lastOnTime": null,
          "switches.$.timerExpiresAt": null
        } 
      }
    );
    delete activeTimers[timerKey];
  }, minutes * 60 * 1000);

  res.json({ status: 'timer_set', minutes });
});

// Wi-Fi Config Update
app.post('/api/wifi-config', auth, async (req, res) => {
  const { deviceId, ssid, pass } = req.body;

  const device = await Device.findOne({ deviceId, owner: req.user.id });
  if (!device) return res.status(404).json({ error: "Device not found" });

  const payload = JSON.stringify({ ssid, pass });
  mqttClient.publish(`devices/${deviceId}/wifi`, payload);

  console.log(`Sending new Wi-Fi creds to ${deviceId}`);
  res.json({ status: 'sent' });
});


// ==========================================
// GOOGLE ASSISTANT INTEGRATION
// ==========================================

// 1. OAUTH2 AUTHORIZATION ENDPOINT (Displayed in Browser)
app.get('/auth', (req, res) => {
    // In a real app, show a login form here. 
    // For simplicity, we auto-redirect assuming the user is "admin".
    const redirectUri = req.query.redirect_uri;
    const state = req.query.state;
    // Redirect back to Google with a dummy code
    res.redirect(`${redirectUri}?code=my_secret_auth_code&state=${state}`);
});

// 2. OAUTH2 TOKEN ENDPOINT (Called by Google Backend)
app.post('/token', (req, res) => {
    // Return a valid JWT (using your existing JWT logic)
    // Here we hardcode a token for simplicity, or generate a real one
    const token = jwt.sign({ id: "google_user" }, process.env.JWT_SECRET);
    
    res.json({
        token_type: "Bearer",
        access_token: token,
        refresh_token: token,
        expires_in: 3600
    });
});

// 3. SMART HOME FULFILLMENT (The Brain)
app.post('/smarthome', async (req, res) => {
    const body = req.body;
    const intent = body.inputs[0].intent;
    const requestId = body.requestId;

    console.log("Google Intent:", intent);

    try {
        // --- A. SYNC: Google asks "What devices do you have?" ---
        if (intent === 'action.devices.SYNC') {
            const devices = await Device.find({}); // Get all devices
            const googleDevices = [];

            devices.forEach(d => {
                d.switches.forEach(sw => {
                    // Map your types to Google Types
                    let gType = 'action.devices.types.SWITCH';
                    if (sw.type === 'light') gType = 'action.devices.types.LIGHT';
                    if (sw.type === 'fan') gType = 'action.devices.types.FAN';
                    if (sw.type === 'ac') gType = 'action.devices.types.THERMOSTAT';
                    if (sw.type === 'socket') gType = 'action.devices.types.OUTLET';

                    googleDevices.push({
                        id: `${d.deviceId}-${sw.id}`, // Unique ID: esp32_001-0
                        type: gType,
                        traits: [
                            'action.devices.traits.OnOff' // Basic On/Off capability
                        ],
                        name: {
                            name: sw.name // "Living Room Light"
                        },
                        willReportState: true,
                        deviceInfo: {
                            manufacturer: 'DIY Smart Home',
                            model: 'ESP32 Relay'
                        }
                    });
                });
            });

            res.json({
                requestId: requestId,
                payload: {
                    agentUserId: "user_123", // Static ID for now
                    devices: googleDevices
                }
            });
        }

        // --- B. QUERY: Google asks "Is the light on?" ---
        else if (intent === 'action.devices.QUERY') {
            const payloadDevices = {};
            const requestedDevices = body.inputs[0].payload.devices;

            // We have to loop because Google might ask for multiple devices at once
            for (const reqDev of requestedDevices) {
                const parts = reqDev.id.split('-'); // Split esp32_001-0
                const deviceId = parts[0];
                const switchId = parseInt(parts[1]);

                const device = await Device.findOne({ deviceId: deviceId });
                
                if (device) {
                    const sw = device.switches.find(s => s.id === switchId);
                    payloadDevices[reqDev.id] = {
                        on: sw ? sw.state : false,
                        online: device.isOnline
                    };
                } else {
                    payloadDevices[reqDev.id] = { online: false };
                }
            }

            res.json({
                requestId: requestId,
                payload: { devices: payloadDevices }
            });
        }

        // --- C. EXECUTE: Google says "Turn on the light" ---
        else if (intent === 'action.devices.EXECUTE') {
            const commands = body.inputs[0].payload.commands;
            const responseCommands = [];

            for (const cmd of commands) {
                const devices = cmd.devices;
                const execution = cmd.execution[0]; // e.g., { command: 'action.devices.commands.OnOff', params: { on: true } }

                if (execution.command === 'action.devices.commands.OnOff') {
                    const newState = execution.params.on;

                    for (const dev of devices) {
                        const parts = dev.id.split('-');
                        const deviceId = parts[0];
                        const switchId = parseInt(parts[1]);

                        // 1. Send to MQTT
                        const mqttPayload = JSON.stringify({ switchId, state: newState });
                        mqttClient.publish(`devices/${deviceId}/command`, mqttPayload);

                        // 2. Update DB
                        let updateFields = { "switches.$.state": newState };
                        if(newState) updateFields["switches.$.lastOnTime"] = new Date();
                        else updateFields["switches.$.lastOnTime"] = null;

                        await Device.updateOne(
                            { deviceId: deviceId, "switches.id": switchId },
                            { $set: updateFields }
                        );
                    }

                    responseCommands.push({
                        ids: devices.map(d => d.id),
                        status: "SUCCESS",
                        states: { on: newState, online: true }
                    });
                }
            }

            res.json({
                requestId: requestId,
                payload: { commands: responseCommands }
            });
        }

    } catch (error) {
        console.error(error);
        res.status(500).send("Error");
    }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => { // Listen on all interfaces
    console.log(`🚀 Backend server running at http://localhost:${PORT}`);
});