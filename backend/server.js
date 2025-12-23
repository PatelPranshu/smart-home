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
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('express-mongo-sanitize');
const { body, validationResult } = require('express-validator');
const morgan = require('morgan');
const { smarthome } = require('actions-on-google');


const app = express();

// 0. LOGGING
app.use(morgan('common'));

// 1. TRUST PROXY (Required for Render + Rate Limit)
app.set('trust proxy', 1); 

// --- CORS CONFIGURATION (UPDATED FOR GOOGLE HOME) ---
// We set 'origin: true' to allow requests from the Google Home App WebView
// which often uses dynamic or opaque origins during the linking process.
app.use(cors({
  origin: true, 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-access-token', 'x-admin-secret', 'Authorization'],
  credentials: true
}));

// 2. SECURITY HEADERS
app.use(helmet());

// 3. GLOBAL LIMITER
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 100, 
  message: "Too many requests from this IP, please try again later."
});
app.use(globalLimiter);

// 4. STRICT LIMITER FOR LOGIN
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, 
  max: 20, // Increased slightly for testing purposes
  message: "Too many login attempts. Account locked for 1 hour."
});
app.use('/api/login', authLimiter);
app.use('/api/admin/login', authLimiter);

app.use(express.json());

// --- FIX START: Patch for Express 5.0 Read-Only Query ---
app.use((req, res, next) => {
  Object.defineProperty(req, 'query', {
    value: req.query,
    writable: true,
    configurable: true
  });
  next();
});
// --- FIX END ---

app.use(mongoSanitize());

// 1. Database Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB Connected'))
  .catch(err => console.error(err));

// Enable parsing form data for the login page
app.use(express.urlencoded({ extended: true }));


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

    // 2. CREATE HISTORY LOG
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
  // 1. Try finding the token in the standard "Authorization" header (Google uses this)
  let token = req.headers['authorization'];
  
  if (token && token.startsWith('Bearer ')) {
      // Remove "Bearer " prefix to get just the token string
      token = token.slice(7, token.length);
  } 
  // 2. If not found, try the custom header (Your App uses this)
  else if (req.headers['x-access-token']) {
      token = req.headers['x-access-token'];
  }

  // 3. If no token found in either place, reject
  if (!token) {
      console.log("Auth Failed: No token provided");
      return res.status(401).send("Access Denied");
  }

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (err) {
    console.log("Auth Failed: Invalid Token");
    res.status(400).send("Invalid Token");
  }
};


// --- AUTH API ---

// Register
app.post('/api/register', [
    // 1. Validation Rules
    body('email').isEmail().normalizeEmail().withMessage('Invalid Email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 chars long')
], async (req, res) => {
    // 2. Check for Errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    // 3. Proceed
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
  
  res.json({ token, role: user.role }); 
});

// Update User Password/Email
app.post('/api/user-update', auth, async (req, res) => {
  const { email, password } = req.body;
  
  try {
      let updates = {};
      if (email) updates.email = email;
      if (password) {
        updates.password = await bcrypt.hash(password, 10);
      }
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

// Claim a New Device
app.post('/api/claim-device', auth, async (req, res) => {
    const { deviceId, secretCode } = req.body;
    const userId = req.user.id;

    try {
        const device = await Device.findOne({ deviceId: deviceId });
        if (!device) {
            return res.status(404).json({ error: "Device ID not found in system." });
        }
        if (device.secretCode !== secretCode) {
            return res.status(403).json({ error: "Invalid Secret Code." });
        }
        if (device.owner) {
            return res.status(400).json({ error: "This device is already registered to another user." });
        }

        device.owner = userId;
        device.switches.forEach(sw => sw.state = false); 
        await device.save();

        console.log(`User ${userId} claimed device ${deviceId}`);
        res.json({ status: 'success', message: 'Device successfully added to your account.' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server Error during claiming." });
    }
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

  // --- 2. LOG "TURNED ON" HISTORY ---
  try {
      const device = await Device.findOne({ deviceId });
      if(device) {
          const sw = device.switches.find(s => s.id === switchId);
          await History.create({
              owner: req.user.id,
              deviceId: deviceId,
              switchName: sw ? sw.name : `Switch ${switchId}`,
              action: `Turned ON (Timer ${minutes}m)`, 
              timestamp: new Date()
          });
      }
  } catch(err) { console.error("Timer Start Log Error", err); }

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

  const device = await Device.findOne({ deviceId, owner: req.user.id });
  if (!device) {
      return res.status(404).json({ error: "Device not found or access denied" });
  }

  const payload = JSON.stringify({ ssid, pass });
  mqttClient.publish(`devices/${deviceId}/wifi`, payload);

  console.log(`Sending new Wi-Fi creds to ${deviceId}`);
  res.json({ status: 'sent' });
});


// --- NEW VERIFICATION APIs ---

// A. Verify User Password
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

// B. Verify ESP32 Kit Code
app.post('/api/verify-code', auth, async (req, res) => {
    const { code } = req.body;
    try {
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
    const logs = await History.find({ owner: req.user.id }).sort({ timestamp: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
});


// ==========================================
// NEW ADMIN MIDDLEWARE (Role Based)
// ==========================================
const verifyAdmin = async (req, res, next) => {
    try {
        const user = await User.findById(req.user.id);
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: "Access Denied: Admins Only." });
        }
        next();
    } catch (err) {
        res.status(500).json({ error: "Server Error Checking Admin" });
    }
};

// 1. Get Dashboard Stats
app.get('/api/admin/stats', auth, verifyAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalDevices = await Device.countDocuments();
        const onlineDevices = await Device.countDocuments({ isOnline: true });
        const unownedDevices = await Device.countDocuments({ owner: null });
        res.json({ totalUsers, totalDevices, onlineDevices, unownedDevices });
    } catch (err) { res.status(500).json({ error: "Stats failed" }); }
});

// 2. List All Devices
app.get('/api/admin/devices', auth, verifyAdmin, async (req, res) => {
    try {
        const devices = await Device.find().populate('owner', 'email').sort({ _id: -1 });
        res.json(devices);
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

// 3. Create New Device
app.post('/api/admin/create', auth, verifyAdmin, async (req, res) => {
    const { deviceId, secretCode } = req.body;
    
    try {
        const existing = await Device.findOne({ deviceId });
        if (existing) return res.status(400).json({ error: "Device ID already exists!" });

        const defaultSwitches = Array.from({ length: 8 }, (_, i) => ({
            id: i, name: `Switch ${i + 1}`, state: false, type: 'light'
        }));

        const newDevice = await Device.create({
            deviceId,
            secretCode,
            owner: null,
            switches: defaultSwitches
        });
        res.json({ status: 'created', device: newDevice });
    } catch (err) { res.status(500).json({ error: "Creation failed" }); }
});

// 4. Delete Device
app.delete('/api/admin/device/:id', auth, verifyAdmin, async (req, res) => {
    try {
        await Device.findOneAndDelete({ deviceId: req.params.id });
        res.json({ status: 'deleted' });
    } catch (err) { res.status(500).json({ error: "Delete failed" }); }
});

// 5. List Users
app.get('/api/admin/users', auth, verifyAdmin, async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json(users);
    } catch (err) { res.status(500).json({ error: "Users failed" }); }
});


// ==========================================
// GOOGLE ASSISTANT INTEGRATION
// ==========================================

// Initialize Smart Home SDK
// Note: While this initialization is here, your implementation below manually handles intents
// which is perfectly valid and often simpler for custom logic.
const appSmartHome = smarthome({
  jwt: process.env.SMART_HOME_KEY_JSON ? JSON.parse(process.env.SMART_HOME_KEY_JSON) : require('./smart-home-key.json')
});

// 1. OAUTH: Authorization Page
app.get('/auth', (req, res) => {
    // console.log("Google Auth Request:", req.query); // Debug
    const { redirect_uri, state } = req.query;

    if (!redirect_uri || !state) {
        return res.send("Error: Missing 'redirect_uri'. Please start from the Google Home App.");
    }

    // Serve a simple HTML login page
    res.send(`
    <html>
      <body style="font-family: sans-serif; text-align: center; padding-top: 50px;">
        <h2>Link Smart Home</h2>
        <form action="/login-link" method="post">
          <input type="hidden" name="redirect_uri" value="${redirect_uri}" />
          <input type="hidden" name="state" value="${state}" />
          <input type="email" name="email" placeholder="Email" required style="padding: 10px; margin: 5px;"/><br/>
          <input type="password" name="password" placeholder="Password" required style="padding: 10px; margin: 5px;"/><br/>
          <button type="submit" style="padding: 10px 20px; background: #3b82f6; color: white; border: none; margin-top: 10px;">Link Account</button>
        </form>
      </body>
    </html>
    `);
});

// 2. OAUTH: Handle Login Form Submission
app.post('/login-link', async (req, res) => {
    // console.log("Login Attempt Body:", req.body); // Debug
    const { email, password, redirect_uri, state } = req.body;
    
    if (!redirect_uri || redirect_uri === "undefined") {
        return res.send("Error: Return address lost. Please go back to Google Home App.");
    }

    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.send("Invalid credentials. Please go back and try again.");
    }

    const authCode = Buffer.from(user._id.toString()).toString('base64');
    
    // Redirect back to Google with the auth code
    // console.log(`Redirecting to: ${redirect_uri}`); // Debug
    res.redirect(`${redirect_uri}?code=${authCode}&state=${state}`);
});

// 3. OAUTH: Token Exchange
app.post('/token', async (req, res) => {
    const { code, grant_type, refresh_token } = req.body;
    let userId;
    
    if (grant_type === 'authorization_code') {
        userId = Buffer.from(code, 'base64').toString('ascii'); 
    } else if (grant_type === 'refresh_token') {
        userId = refresh_token;
    }

    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET);

    res.json({
        token_type: "Bearer",
        access_token: token,
        refresh_token: userId,
        expires_in: 3600 
    });
});

// 4. SMART HOME FULFILLMENT (The Brain)
// Voice -> Google -> This API -> DB & MQTT -> ESP32
app.post('/api/smarthome', auth, async (req, res) => {
    const body = req.body;
    const userId = req.user.id; 
    const requestId = body.requestId;
    const intent = body.inputs[0].intent;

    console.log(`Google Request: ${intent}`);

    // --- A. SYNC: Google asks "What devices does this user have?" ---
    if (intent === 'action.devices.SYNC') {
        const devices = await Device.find({ owner: userId });
        
        const payloadDevices = [];
        devices.forEach(device => {
            device.switches.forEach(sw => {
                let type = 'action.devices.types.SWITCH';
                if (sw.type === 'light') type = 'action.devices.types.LIGHT';
                if (sw.type === 'fan') type = 'action.devices.types.FAN';
                if (sw.type === 'ac') type = 'action.devices.types.AC_UNIT';
                if (sw.type === 'outlet') type = 'action.devices.types.OUTLET';

                payloadDevices.push({
                    id: `${device.deviceId}-${sw.id}`, 
                    type: type,
                    traits: [ 'action.devices.traits.OnOff' ],
                    name: { name: sw.name },
                    willReportState: false, // Set to true if you implement Report State
                    deviceInfo: {
                        manufacturer: 'Smart Home DIY',
                        model: 'ESP32'
                    }
                });
            });
        });

        return res.json({
            requestId: requestId,
            payload: {
                agentUserId: userId,
                devices: payloadDevices
            }
        });
    }

    // --- B. QUERY: Google asks "Is the light on?" ---
    if (intent === 'action.devices.QUERY') {
        const requestedDevices = body.inputs[0].payload.devices;
        const deviceStatus = {};

        for (const d of requestedDevices) {
            const parts = d.id.split('-'); 
            const deviceId = parts[0];
            const switchId = parseInt(parts[1]);

            const dbDevice = await Device.findOne({ deviceId, owner: userId });
            
            if (dbDevice) {
                const sw = dbDevice.switches.find(s => s.id === switchId);
                deviceStatus[d.id] = {
                    on: sw ? sw.state : false,
                    online: dbDevice.isOnline
                };
            } else {
                deviceStatus[d.id] = { online: false };
            }
        }

        return res.json({
            requestId: requestId,
            payload: { devices: deviceStatus }
        });
    }

    // --- C. EXECUTE: Google says "Turn on the light" ---
    if (intent === 'action.devices.EXECUTE') {
        const commands = body.inputs[0].payload.commands;
        const results = [];

        for (const command of commands) {
            for (const device of command.devices) {
                for (const execution of command.execution) {
                    if (execution.command === 'action.devices.commands.OnOff') {
                        const parts = device.id.split('-');
                        const deviceId = parts[0];
                        const switchId = parseInt(parts[1]);
                        const newState = execution.params.on;

                        // 1. Send Command to ESP32 via MQTT (Server -> ESP32)
                        const mqttPayload = JSON.stringify({ switchId, state: newState });
                        mqttClient.publish(`devices/${deviceId}/command`, mqttPayload);

                        // 2. Update Database
                        await Device.updateOne(
                           { deviceId: deviceId, "switches.id": switchId },
                           { $set: { "switches.$.state": newState } }
                        );
                        
                        results.push({
                            ids: [device.id],
                            status: "SUCCESS",
                            states: {
                                on: newState,
                                online: true
                            }
                        });
                    }
                }
            }
        }

        return res.json({
            requestId: requestId,
            payload: { commands: results }
        });
    }
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`🚀 Backend server running at http://localhost:${PORT}`);
});
