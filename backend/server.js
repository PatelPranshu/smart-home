require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mqtt = require('mqtt');
const cors = require('cors');
const User = require('./models/User');
const Device = require('./models/Device');
const History = require('./models/History');

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
    // ... (keep your existing time logic here) ...

    // 1. Update Device State
    await Device.updateOne(
      { deviceId: deviceId, "switches.id": data.switchId },
      { $set: updateFields }
    );

    // 2. CREATE HISTORY LOG (New)
    try {
        const device = await Device.findOne({ deviceId });
        if(device) {
            const sw = device.switches.find(s => s.id === data.switchId);
            await History.create({
                owner: device.owner,
                deviceId: deviceId,
                switchName: sw ? sw.name : `Switch ${data.switchId}`,
                action: data.state ? "Turned ON (Physical)" : "Turned OFF (Physical)",
                timestamp: new Date()
            });
        }
    } catch(err) { console.error("Log Error"); }
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
    const status = message.toString().trim();
    const isOnline = status === 'online';
    
    // 1. Check current status in DB
    const device = await Device.findOne({ deviceId });

    // 2. Only Log & Update if the status is DIFFERENT (reduces spam)
    if (device && device.isOnline !== isOnline) {
        console.log(`Device ${deviceId} is now ${status}`);
        
        await Device.updateOne(
            { deviceId: deviceId },
            { $set: { isOnline: isOnline } }
        );
    }
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

// ... inside app.post('/api/control') ...
  await Device.updateOne(
    { deviceId: deviceId, "switches.id": switchId },
    { $set: updateFields }
  );

  // LOG HISTORY (New)
  const sw = device.switches.find(s => s.id === switchId);
  await History.create({
      owner: req.user.id,
      deviceId: deviceId,
      switchName: sw ? sw.name : `Switch ${switchId}`,
      action: state ? "Turned ON (App)" : "Turned OFF (App)"
  });

  res.json({ status: 'sent', state });;
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

  // --- 1. TURN ON IMMEDIATELY ---
  
  const onPayload = JSON.stringify({ switchId, state: true });
  mqttClient.publish(`devices/${deviceId}/command`, onPayload);

  await Device.updateOne(
    { deviceId: deviceId, "switches.id": switchId },
    { $set: { 
        "switches.$.state": true,
        "switches.$.lastOnTime": new Date(),
        "switches.$.timerExpiresAt": expiryDate 
      } 
    }
  );

  // --- 2. LOG "TURNED ON" HISTORY (NEW) ---
  try {
      const device = await Device.findOne({ deviceId });
      if(device) {
          const sw = device.switches.find(s => s.id === switchId);
          await History.create({
              owner: req.user.id,
              deviceId: deviceId,
              switchName: sw ? sw.name : `Switch ${switchId}`,
              action: `Turned ON (Timer ${minutes}m)`, // Log the duration too!
              timestamp: new Date()
          });
      }
  } catch(err) { console.error("Timer Start Log Error", err); }
  // ----------------------------------------

  activeTimers[timerKey] = setTimeout(async () => {
    console.log(`Timer expired! Turning off ${deviceId} switch ${switchId}`);
    
    // Turn OFF Logic
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

    // Log "Turned OFF" History
    try {
        const device = await Device.findOne({ deviceId });
        if(device) {
            const sw = device.switches.find(s => s.id === switchId);
            await History.create({
                owner: device.owner, 
                deviceId: deviceId,
                switchName: sw ? sw.name : `Switch ${switchId}`,
                action: "Turned OFF (Timer)",
                timestamp: new Date()
            });
        }
    } catch(err) { console.error("Timer End Log Error", err); }
    
    delete activeTimers[timerKey];
  }, minutes * 60 * 1000);

  res.json({ status: 'timer_set', minutes });
});

// Wi-Fi Config Update

app.post('/api/wifi-config', auth, async (req, res) => {
  const { deviceId, ssid, pass } = req.body;

  // 1. Verify Device Ownership (Security Check)
  // We check if the device belongs to the user logged in (req.user.id)
  const device = await Device.findOne({ deviceId, owner: req.user.id });
  
  if (!device) {
      return res.status(404).json({ error: "Device not found or access denied" });
  }

  // 2. Publish to MQTT
  const payload = JSON.stringify({ ssid, pass });
  mqttClient.publish(`devices/${deviceId}/wifi`, payload);

  console.log(`Sending new Wi-Fi creds to ${deviceId}`);
  res.json({ status: 'sent' });
});


// ... (Previous imports and DB connection) ...

// --- NEW VERIFICATION APIs ---

// A. Verify User Password (For Wi-Fi Access)
app.post('/api/verify-password', auth, async (req, res) => {
    const { password } = req.body;
    try {
        const user = await User.findById(req.user.id);
        if (!user) return res.status(404).json({ error: "User not found" });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(400).json({ error: "Incorrect password" });

        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: "Verification failed" });
    }
});

// B. Verify ESP32 Kit Code (For Account Password Change)
app.post('/api/verify-code', auth, async (req, res) => {
    const { code } = req.body;
    try {
        // Check if ANY device owned by this user has this secret code
        // Note: You must ensure your Device model has a "secretCode" field in DB
        const device = await Device.findOne({ owner: req.user.id, secretCode: code });
        
        if (!device) return res.status(400).json({ error: "Invalid Kit Code" });

        res.json({ status: 'ok' });
    } catch (err) {
        res.status(500).json({ error: "Verification failed" });
    }
});

// Get 24-Hour History
app.get('/api/history', auth, async (req, res) => {
  try {
    // Fetch logs for this user, sorted by newest first
    const logs = await History.find({ owner: req.user.id }).sort({ timestamp: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

// ... (Rest of your existing server.js code: /api/devices, /api/control, etc.) ...
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => { // Listen on all interfaces
    console.log(`🚀 Backend server running at http://localhost:${PORT}`);
});