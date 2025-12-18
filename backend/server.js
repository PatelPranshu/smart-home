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
app.use(cors());
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
});

// Listen for updates FROM the ESP32 (Manual switch presses)
// 2. Handle Messages
mqttClient.on('message', async (topic, message) => {
  const parts = topic.split('/');
  const deviceId = parts[1];
  const type = parts[2]; // 'update' or 'sync'

  // CASE A: User flipped physical switch -> Update DB
 // CASE A: User flipped physical switch -> Update DB
  if (type === 'update') {
    const data = JSON.parse(message.toString());
    
    // Prepare Update Object
    let updateFields = { "switches.$.state": data.state };
    
    if (data.state) {
        // If turning ON, save the current time
        updateFields["switches.$.lastOnTime"] = new Date();
    } else {
        // If turning OFF, clear the times
        updateFields["switches.$.lastOnTime"] = null;
        updateFields["switches.$.timerExpiresAt"] = null;
    }

    await Device.updateOne(
      { deviceId: deviceId, "switches.id": data.switchId },
      { $set: updateFields }
    );
    console.log(`Update: ${deviceId} switch ${data.switchId} -> ${data.state}`);
  }

  // CASE B: Device Rebooted -> Restore State from DB
  else if (type === 'sync') {
    console.log(`Device ${deviceId} rebooted. Restoring state...`);
    
    // Find device in DB
    const device = await Device.findOne({ deviceId });
    if (device) {
      // Loop through ALL switches and send their saved state back to the device
      device.switches.forEach(sw => {
        const payload = JSON.stringify({ switchId: sw.id, state: sw.state });
        mqttClient.publish(`devices/${deviceId}/command`, payload);
      });
    }
  }
});

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

// --- DEVICE API ---

// Middleware to verify Token
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

// Get User's Devices
app.get('/api/devices', auth, async (req, res) => {
  // In a real app, you would auto-provision. 
  // Here we assume a device is already pre-seeded in DB with owner=req.user.id
  // For MVP, we will fetch ALL devices for the logged-in user
  const devices = await Device.find({ owner: req.user.id });
  res.json(devices);
});

// Toggle Switch
app.post('/api/control', auth, async (req, res) => {
  const { deviceId, switchId, state } = req.body;
  
  // 1. Verify ownership
  const device = await Device.findOne({ deviceId, owner: req.user.id });
  if (!device) return res.status(404).json({ error: "Device not found" });

  // 2. Publish to MQTT
  const payload = JSON.stringify({ switchId, state });
  mqttClient.publish(`devices/${deviceId}/command`, payload);

  // 3. Update DB with Timestamps
  let updateFields = { "switches.$.state": state };
  
  if (state) {
      updateFields["switches.$.lastOnTime"] = new Date();
  } else {
      updateFields["switches.$.lastOnTime"] = null;
      updateFields["switches.$.timerExpiresAt"] = null; // Clear timer if manually turned off
  }

  await Device.updateOne(
    { deviceId: deviceId, "switches.id": switchId },
    { $set: updateFields }
  );

  res.json({ status: 'sent', state });
});

// --- NEW FEATURES ---

// 1. EDIT DEVICE (Name & Icon)
app.post('/api/edit', auth, async (req, res) => {
  const { deviceId, switchId, newName, newType } = req.body;
  
  await Device.updateOne(
    { deviceId: deviceId, "switches.id": switchId },
    { $set: { 
        "switches.$.name": newName,
        "switches.$.type": newType
      } 
    }
  );
  res.json({ status: 'updated' });
});

// 2. TIMER (Auto Turn Off)
// Note: In a real production app, use 'Agenda' or 'Bull' queues. 
// For MVP, setTimeout is fine (but timers die if server restarts).
let activeTimers = {}; // Store timers in memory

app.post('/api/timer', auth, async (req, res) => {
  const { deviceId, switchId, minutes } = req.body;
  const timerKey = `${deviceId}-${switchId}`;
  
  // Clear old memory timer
  if (activeTimers[timerKey]) clearTimeout(activeTimers[timerKey]);

  // Calculate Expiry Time
  const expiryDate = new Date(Date.now() + minutes * 60000);

  // Update DB immediately so frontend sees the countdown
  await Device.updateOne(
    { deviceId: deviceId, "switches.id": switchId },
    { $set: { "switches.$.timerExpiresAt": expiryDate } }
  );

  // Schedule the actual turn-off
  activeTimers[timerKey] = setTimeout(async () => {
    console.log(`Timer expired! Turning off ${deviceId} switch ${switchId}`);
    
    const offPayload = JSON.stringify({ switchId, state: false });
    mqttClient.publish(`devices/${deviceId}/command`, offPayload);
    
    // Clear timestamps in DB
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


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));