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
const PORT = process.env.PORT || 3000;


const app = express();
// LOGGING
app.use(morgan('common'));

// TRUST PROXY
app.set('trust proxy', 1);

//CORS HERE ---
app.use(cors({
  origin: [process.env.FRONTEND_URL,"https://oauth-redirect.googleusercontent.com"].filter(Boolean),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-access-token', 'x-admin-secret', 'Authorization'],
  credentials: true
}));

// SECURITY HEADERS
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
      styleSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", process.env.ORIGIN_URL],
      formAction: [
        "'self'", 
        process.env.ORIGIN_URL, 
        "https://oauth-redirect.googleusercontent.com"
      ],
    },  
  },
}));

// GLOBAL LIMITER
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 Minute
  max: 200,                // 200 requests
  message: "Too many requests, please slow down."
});
app.use(globalLimiter);

// STRICT LIMITER (For Passwords, Codes, and Sensitive Actions)
const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 Hour
  max: 10,                   // 10 Attempts
  message: "Too many failed attempts. Access locked for 1 hour."
});

// Apply to Login (Existing)
app.use('/api/login', authLimiter);
app.use('/api/admin/login', authLimiter);

app.use('/api/verify-password', authLimiter); // identifying wifi password
app.use('/api/verify-code', authLimiter);     // guessing kit codes
app.use('/api/claim-device', authLimiter);    // guessing device IDs

app.use(express.json());

// Patch for Express 5.0 Read-Only Query
app.use((req, res, next) => {
  Object.defineProperty(req, 'query', {
    value: req.query,
    writable: true,
    configurable: true
  });
  next();
});


app.use(mongoSanitize());

// Database Connection
const dbOptions = {
    autoIndex: true, // Maintain indexes
    maxPoolSize: 10, // Maintain up to 10 socket connections
    serverSelectionTimeoutMS: 5000, // Keep trying to connect for 5 seconds
    socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
    family: 4 // Use IPv4, skip trying IPv6
};

mongoose.connect(process.env.MONGO_URI, dbOptions)
    .then(() => console.log('✅ MongoDB Connected (Optimized)'))
    .catch(err => console.error('❌ MongoDB Connection Error:', err));

// Handle sudden disconnections
mongoose.connection.on('error', err => {
    console.error('Mongoose secondary error:', err);
});

const appSmartHome = smarthome({
  jwt: process.env.SMART_HOME_KEY_JSON ? JSON.parse(process.env.SMART_HOME_KEY_JSON) : require('./smart-home-key.json')
});

  // Enable parsing form data for the login page
app.use(express.urlencoded({ extended: true }));



// MQTT Client Setup (Connects to HiveMQ Cloud)
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
  mqttClient.subscribe('devices/+/sensor'); // Subscribe to sensor data
});

// Handle MQTT Messages
mqttClient.on('message', async (topic, message) => {
    // [CRITICAL] Global try-catch to prevent server crashes on bad data
    try {
        const parts = topic.split('/');
        
        // Safety Check: Ensure topic format is correct (devices/ID/type)
        if (parts.length < 3) return;

        const deviceId = parts[1];
        const type = parts[2]; 

        // -------------------------------------------------
        // 1. User flipped physical switch -> Update DB
        // -------------------------------------------------
        if (type === 'update') {
            const data = JSON.parse(message.toString());
            
            // Use .lean() for faster lookup as we only need read-only inversion config here
            const device = await Device.findOne({ deviceId }).populate('owner', 'isGoogleLinked').lean();

            if (!device) return;

            const sw = device.switches.find(s => s.id === data.switchId);
            if (!sw) return;

            // INVERSION LOGIC: Calculate the logical state the user sees in the app
            const userIntentState = sw.inverted ? !data.state : data.state;

            // Prepare single DB Update
            let updateFields = { "switches.$.state": userIntentState };
            if (userIntentState) {
                updateFields["switches.$.lastOnTime"] = new Date();
            } else {
                updateFields["switches.$.lastOnTime"] = null;
                updateFields["switches.$.timerExpiresAt"] = null;
            }

            // Update Database State immediately
            await Device.updateOne(
                { deviceId: deviceId, "switches.id": data.switchId },
                { $set: updateFields }
            );

            // BACKGROUND TASKS: Run History and Google reporting without 'await' 
            // to keep the MQTT processing loop fast.
            (async () => {
                try {
                    // Log to History
                    if (!device.owner) return;      
                    await History.create({
                        owner: device.owner._id,
                        deviceId: deviceId,
                        switchName: sw.name || `Switch ${data.switchId}`,
                        action: userIntentState ? "Turned ON (Physical)" : "Turned OFF (Physical)",
                        timestamp: new Date()
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
                            // If Google says 404, the user has unlinked their account.
                            if (error.status === 404 || (error.response && error.response.status === 404)) {
                                console.warn(`⚠️ User ${device.owner._id} unlinked from Google. Disabling auto-reporting.`);
                                await User.findByIdAndUpdate(device.owner._id, { isGoogleLinked: false });
                            } else {
                                console.error("MQTT Google Report Error:", error.message);
                            }
                        }
                    }
                } catch (bgErr) {
                    console.error(`[BG TASK ERROR] ${deviceId}:`, bgErr.message);
                }
            })();
        }

        // -------------------------------------------------
        // 2. Device Rebooted -> Restore State
        // -------------------------------------------------
        else if (type === 'sync') {
            console.log(`Device ${deviceId} rebooted. Restoring state...`);
            const device = await Device.findOne({ deviceId }).lean();
            if (device) {
                device.switches.forEach(sw => {
                    // APPLY INVERSION: Send correct hardware signal based on stored user intent
                    const hardwareSignal = sw.inverted ? !sw.state : sw.state;
                    const payload = JSON.stringify({ switchId: sw.id, state: hardwareSignal });
                    mqttClient.publish(`devices/${deviceId}/command`, payload);
                });
            }
        }

        // -------------------------------------------------
        // 3. Device Status Change (Online/Offline)
        // -------------------------------------------------
        else if (type === 'status') {
            const status = message.toString().trim().toLowerCase();
            const isOnline = (status === 'online');
            
            // Always update DB to ensure consistency
            const device = await Device.findOneAndUpdate(
                { deviceId: deviceId },
                { $set: { isOnline: isOnline } },
                { new: true }
            ).lean();

            if (device && device.owner) {
                const ownerRecord = await User.findById(device.owner).lean();
                if (ownerRecord && ownerRecord.isGoogleLinked) {
                    let statesPayload = {};
                    device.switches.forEach(sw => {
                        statesPayload[`${deviceId}-${sw.id}`] = { 
                            online: isOnline,
                            on: isOnline ? sw.state : false // Ensure 'on' is false if offline
                        };
                    });

                    appSmartHome.reportState({
                        agentUserId: device.owner.toString(),
                        requestId: Date.now().toString(),
                        payload: { devices: { states: statesPayload } }
                    }).catch(e => console.error("Status Report Error:", e.message));
                }
            }
        }

        // -------------------------------------------------
        // 4. Handle Sensor Data (Temp/Hum)
        // -------------------------------------------------
        else if (type === 'sensor') {
            const data = JSON.parse(message.toString());
            await Device.updateOne(
                { deviceId: deviceId },
                { $set: { temperature: data.temp, humidity: data.hum } }
            );
        }

    } catch (err) {
        console.error(`[MQTT ERROR] Failed to process message on topic ${topic}:`, err.message);
    }
});




// --- MIDDLEWARE ---
const auth = (req, res, next) => {
  // Try finding the token in the standard "Authorization" header (Google uses this)
  let token = req.headers['authorization'];
  
  if (token && token.startsWith('Bearer ')) {
      // Remove "Bearer " prefix to get just the token string
      token = token.slice(7, token.length);
  } 
  // If not found, try the custom header (Your App uses this)
  else if (req.headers['x-access-token']) {
      token = req.headers['x-access-token'];
  }

  // If no token found in either place, reject
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


const verifyAdmin = async (req, res, next) => {
    try {
        // req.user.id comes from the previous 'auth' middleware
        // fetch the user from DB to ensure the role is current
        const user = await User.findById(req.user.id);

        // Check if user exists and has role 'admin'
        if (!user || user.role !== 'admin') {
            return res.status(403).json({ error: "Access Denied: Admins Only." });
        }

        // Allowed
        next();
    } catch (err) {
        res.status(500).json({ error: "Server Error Checking Admin" });
    }
};
// Admin: Toggle Logic Inversion for a Switch
app.post('/api/admin/device/invert-logic', auth, verifyAdmin, async (req, res) => {
    const { deviceId, switchId, inverted } = req.body; // inverted is true/false
    try {
        await Device.updateOne(
            { deviceId: deviceId, "switches.id": switchId },
            { $set: { "switches.$.inverted": inverted } }
        );
        res.json({ status: 'updated', message: `Logic Inversion set to ${inverted}` });
    } catch (err) { res.status(500).json({ error: "Update failed" }); }
});

// --- AUTH API ---

// Register
app.post('/api/register', [
    // Validation Rules
    body('email').isEmail().normalizeEmail().withMessage('Invalid Email'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 chars long')
], async (req, res) => {
    // Check for Errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    // Proceed (Your existing code)
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
app.post('/api/login', [
    // Validate Email
    body('email').isEmail().normalizeEmail().withMessage('Invalid Email'),
    // Validate Password (ensure it's not empty)
    body('password').not().isEmpty().trim().escape().withMessage('Password is required')
], async (req, res) => {
    // Check for errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(400).json({ error: 'User not found' });
  
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid password' });

  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
  
  // Send the role back to the frontend 
  res.json({ token, role: user.role }); 
});


// Get User Settings (Profile & Preferences)
app.get('/api/user/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.json({ 
            email: user.email, 
            role: user.role, 
            homeTitle: user.homeTitle || "My Home" 
        });
    } catch (err) { res.status(500).json({ error: "Failed to fetch profile" }); }
});


// Update User Password/Email
app.post('/api/user-update', auth, [
    body('email').optional().isEmail().normalizeEmail(),
    body('homeTitle').optional().isString().trim().escape().isLength({ max: 50 }),
    body('password').optional().isLength({ min: 6 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { email, password, homeTitle } = req.body;
    try {
        let updates = {};
        if (email) updates.email = email;
        if (homeTitle) updates.homeTitle = homeTitle;
        if (password) updates.password = await bcrypt.hash(password, 10);

        await User.findByIdAndUpdate(req.user.id, updates);
        res.json({ status: 'updated' });
    } catch (err) {
        res.status(500).json({ error: "Failed to update user" });
    }
});



// Google Home Toggle APIs ---

// Get current status
app.get('/api/user/google-status', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.json({ 
            enabled: user.googleHomeEnabled,
            isLinked: user.isGoogleLinked 
        });
    } catch (err) { res.status(500).json({ error: "Error" }); }
});

// Update status
app.post('/api/user/google-status', auth, async (req, res) => {
    const { enabled } = req.body;
    try {
        await User.findByIdAndUpdate(req.user.id, { googleHomeEnabled: enabled });
        res.json({ status: 'updated', enabled });
    } catch (err) { res.status(500).json({ error: "Update failed" }); }
});

// --- DEVICE API ---

// Get User's Devices
app.get('/api/devices', auth, async (req, res) => {
  // .lean() makes this query much faster for production
  const devices = await Device.find({ owner: req.user.id }).lean();
  res.json(devices);
});

// Claim a New Device (The "Sticker" Logic)
app.post('/api/claim-device', auth, async (req, res) => {
    const { deviceId, secretCode } = req.body;
    const userId = req.user.id;

    try {
        // 1. Find the device
        // We look for a device that matches the ID and the Secret Code (Sticker)
        const device = await Device.findOne({ deviceId: deviceId });

        // 2. Security Checks
        if (!device) {
            return res.status(404).json({ error: "Device ID not found in system." });
        }

        // Check if the secret code from the sticker matches the database
        if (device.secretCode !== secretCode) {
            return res.status(403).json({ error: "Invalid Secret Code." });
        }

        // Check if the device is already owned by someone else
        if (device.owner) {
            return res.status(400).json({ error: "This device is already registered to another user." });
        }

        // Claim Success!
        device.owner = userId;

        // Reset switches to default state upon new ownership
        device.switches.forEach(sw => sw.state = false); 
        
        await device.save();

        console.log(`User ${userId} claimed device ${deviceId}`);
        res.json({ status: 'success', message: 'Device successfully added to your account.' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server Error during claiming." });
    }
});
// Remove/Unclaim a Device (User Action)
app.post('/api/remove-device', auth, async (req, res) => {
    const { deviceId } = req.body;
    try {
        // Find device owned by this user
        const device = await Device.findOne({ deviceId: deviceId, owner: req.user.id });
        
        if (!device) {
            return res.status(404).json({ error: "Device not found or not owned by you." });
        }

        // Remove ownership
        device.owner = null;
        
        // Reset switch states for safety
        device.switches.forEach(sw => sw.state = false);
        
        await device.save();

        console.log(`User ${req.user.id} removed device ${deviceId}`);
        res.json({ status: 'removed' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Server Error" });
    }
});

// Toggle Switch
app.post('/api/control', auth, [
    body('deviceId').isString().trim().escape(),
    body('switchId').isInt(),
    body('state').isBoolean()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid Input' });

    const { deviceId, switchId, state } = req.body;

    try {
        const device = await Device.findOne({ deviceId, owner: req.user.id });
        if (!device) return res.status(404).json({ error: "Device not found" });

        // MQTT Publish
        const sw = device.switches.find(s => s.id === switchId);

        // INVERSION LOGIC: If inverted, send the opposite signal to the relay
        const hardwareSignal = sw.inverted ? !state : state;
        const payload = JSON.stringify({ switchId, state: hardwareSignal });

mqttClient.publish(`devices/${deviceId}/command`, payload);

        // Update Database
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

        // SPEED UPDATE: Respond to user NOW
        res.json({ status: 'sent', state });

        // Background Tasks (Runs AFTER response is sent)
        (async () => {
            try {
                // Task A: Log History
                const sw = device.switches.find(s => s.id === switchId);
                await History.create({
                    owner: req.user.id,
                    deviceId: deviceId,
                    switchName: sw ? sw.name : `Switch ${switchId}`,
                    action: state ? "Turned ON (App)" : "Turned OFF (App)"
                });

                // Report to Google (The Slow Part)
                try {
                    // Only attempt if we think they are linked
                    const user = await User.findById(req.user.id).lean();
                    if (user && user.isGoogleLinked === true) {
                        await appSmartHome.reportState({
                            agentUserId: req.user.id,
                            requestId: Math.random().toString(),
                            payload: {
                                devices: {
                                    states: {
                                        [`${deviceId}-${switchId}`]: {
                                            on: state,
                                            online: true
                                        }
                                    }
                                }
                            }
                        });
                    }
                } catch (error) {
                    if (error.status === 404 || (error.response && error.response.status === 404)) {
                        await User.findByIdAndUpdate(req.user.id, { isGoogleLinked: false });
                    }
                }
            } catch (bgErr) {
                console.error("Background Task Error:", bgErr);
            }
        })();

    } catch (err) {
        console.error(err);
        // Only send error if we haven't responded yet
        if (!res.headersSent) res.status(500).json({ error: "Server Error" });
    }
});

// Edit Device (Name & Icon)
app.post('/api/edit', auth, [
    body('deviceId').isString().trim(),
    body('switchId').isInt(),
    body('newName').isString().trim().escape().isLength({ max: 30 }),
    body('newType').isString().isIn(['light', 'fan', 'ac', 'outlet', 'wifi', 'socket', 'water', 'laundry'])
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: "Invalid input" });

    const { deviceId, switchId, newName, newType } = req.body;
    try {
        // ADDED owner: req.user.id for security
        const result = await Device.updateOne(
            { deviceId: deviceId, owner: req.user.id, "switches.id": switchId },
            { $set: { "switches.$.name": newName, "switches.$.type": newType } }
        );

        if (result.matchedCount === 0) return res.status(404).json({ error: "Device not found or access denied" });
        res.json({ status: 'updated' });
    } catch (err) { res.status(500).json({ error: "Update failed" }); }
});


// Timer (Auto Turn Off)
let activeTimers = {}; 

app.post('/api/timer', auth, async (req, res) => {
  const { deviceId, switchId, minutes } = req.body;
  const timerKey = `${deviceId}-${switchId}`;
  
  // Clear existing timer if one is already running for this switch
  if (activeTimers[timerKey]) clearTimeout(activeTimers[timerKey]);

  try {
    // 1. Fetch device to check inversion settings
    const device = await Device.findOne({ deviceId, owner: req.user.id });
    if (!device) return res.status(404).json({ error: "Device not found" });
    
    const sw = device.switches.find(s => s.id === switchId);
    if (!sw) return res.status(404).json({ error: "Switch not found" });

    const expiryDate = new Date(Date.now() + minutes * 60000);

    // 2. TURN ON IMMEDIATELY (Apply Inversion Logic)
    // If inverted, logical ON = hardware false (0)
    const startSignal = sw.inverted ? false : true; 
    const onPayload = JSON.stringify({ switchId, state: startSignal });
    mqttClient.publish(`devices/${deviceId}/command`, onPayload);

    // 3. Update Database with logical ON state
    await Device.updateOne(
      { deviceId: deviceId, "switches.id": switchId },
      { $set: { 
          "switches.$.state": true,
          "switches.$.lastOnTime": new Date(),
          "switches.$.timerExpiresAt": expiryDate 
        } 
      }
    );

    // 4. Log "TURNED ON" History
    await History.create({
        owner: req.user.id,
        deviceId: deviceId,
        switchName: sw.name || `Switch ${switchId}`,
        action: `Turned ON (Timer ${minutes}m)`,
        timestamp: new Date()
    });

    // 5. Start the countdown
    activeTimers[timerKey] = setTimeout(async () => {
      console.log(`Timer expired! Turning off ${deviceId} switch ${switchId}`);
      
      // Re-fetch to get current inversion status in case it changed during the timer
      const deviceAtExpiry = await Device.findOne({ deviceId });
      const swAtExpiry = deviceAtExpiry ? deviceAtExpiry.switches.find(s => s.id === switchId) : null;
      
      // 6. Turn OFF Logic (Apply Inversion Logic)
      // If inverted, logical OFF = hardware true (1)
      const endSignal = (swAtExpiry && swAtExpiry.inverted) ? true : false;
      const offPayload = JSON.stringify({ switchId, state: endSignal });
      mqttClient.publish(`devices/${deviceId}/command`, offPayload);
      
      // 7. Update Database with logical OFF state
      await Device.updateOne(
        { deviceId: deviceId, "switches.id": switchId },
        { $set: { 
            "switches.$.state": false,
            "switches.$.lastOnTime": null,
            "switches.$.timerExpiresAt": null
          } 
        }
      );

      // 8. Log "Turned OFF" History
      if (deviceAtExpiry) {
          await History.create({
              owner: deviceAtExpiry.owner, 
              deviceId: deviceId,
              switchName: swAtExpiry ? swAtExpiry.name : `Switch ${switchId}`,
              action: "Turned OFF (Timer)",
              timestamp: new Date()
          });
      }
      if (deviceAtExpiry && deviceAtExpiry.owner) {
        const ownerRecord = await User.findById(deviceAtExpiry.owner).lean();
        if (ownerRecord && ownerRecord.isGoogleLinked === true) {
            try {
                await appSmartHome.reportState({
                    agentUserId: deviceAtExpiry.owner.toString(),
                    requestId: Math.random().toString(),
                    payload: {
                        devices: {
                            states: {
                                [`${deviceId}-${switchId}`]: {
                                    on: false,
                                    online: true
                                }
                            }
                        }
                    }
                });
            } catch (error) {
                // Self-Healing for Timers
                if (error.status === 404 || (error.response && error.response.status === 404)) {
                    console.warn(`⚠️ User ${deviceAtExpiry.owner} unlinked from Google during timer. Disabling reporting.`);
                    await User.findByIdAndUpdate(deviceAtExpiry.owner, { isGoogleLinked: false });
                }
            }
        }
    }
      
      delete activeTimers[timerKey];
    }, minutes * 60 * 1000);

    res.json({ status: 'timer_set', minutes });

  } catch (err) {
    console.error("Timer Error:", err);
    res.status(500).json({ error: "Server Error" });
  }
});

// Wi-Fi Config Update

app.post('/api/wifi-config', auth, async (req, res) => {
  const { deviceId, ssid, pass } = req.body;

  // Verify Device Ownership (Security Check)
  // We check if the device belongs to the user logged in (req.user.id)
  const device = await Device.findOne({ deviceId, owner: req.user.id });
  
  if (!device) {
      return res.status(404).json({ error: "Device not found or access denied" });
  }

  // Publish to MQTT
  const payload = JSON.stringify({ ssid, pass });
  mqttClient.publish(`devices/${deviceId}/wifi`, payload);

  console.log(`Sending new Wi-Fi creds to ${deviceId}`);
  res.json({ status: 'sent' });
});



        // VERIFICATION APIs

// Verify User Password (For Wi-Fi Access)
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

// Verify ESP32 Kit Code (For Account Password Change)
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




// NEW ADMIN MIDDLEWARE (Role Based)

// Get Dashboard Stats
app.get('/api/admin/stats', auth, verifyAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalDevices = await Device.countDocuments();
        const onlineDevices = await Device.countDocuments({ isOnline: true });
        const unownedDevices = await Device.countDocuments({ owner: null });

        res.json({ totalUsers, totalDevices, onlineDevices, unownedDevices });
    } catch (err) { res.status(500).json({ error: "Stats failed" }); }
});

// List All Devices (With Owner Info)
app.get('/api/admin/devices', auth, verifyAdmin, async (req, res) => {
    try {
        // Populate 'owner' to get the user's email
        const devices = await Device.find().populate('owner', 'email').sort({ _id: -1 });
        res.json(devices);
    } catch (err) { res.status(500).json({ error: "Fetch failed" }); }
});

// Create New Device (The Factory Process)
// Create New Device (Factory Process)
app.post('/api/admin/create', auth, verifyAdmin, async (req, res) => {
    // [UPDATED] Accept channels from body (Default to 9 if not provided)
    const { deviceId, secretCode, channels } = req.body;
    const numSwitches = channels || 9; // Default max
    
    try {
        const existing = await Device.findOne({ deviceId });
        if (existing) return res.status(400).json({ error: "Device ID already exists!" });

        // [UPDATED] Create dynamic number of switches
        const defaultSwitches = Array.from({ length: numSwitches }, (_, i) => ({
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

// Delete Device (Cleanup)
app.delete('/api/admin/device/:id', auth, verifyAdmin, async (req, res) => {
    try {
        await Device.findOneAndDelete({ deviceId: req.params.id });
        res.json({ status: 'deleted' });
    } catch (err) { res.status(500).json({ error: "Delete failed" }); }
});

// List Users
app.get('/api/admin/users', auth, verifyAdmin, async (req, res) => {
    try {
        const users = await User.find().select('-password').sort({ createdAt: -1 });
        res.json(users);
    } catch (err) { res.status(500).json({ error: "Users failed" }); }
});

// Admin: Unlink User (Remove owner but keep device)
app.post('/api/admin/unlink', auth, verifyAdmin, async (req, res) => {
    const { deviceId } = req.body;
    try {
        const device = await Device.findOne({ deviceId });
        if (!device) return res.status(404).json({ error: "Device not found" });

        device.owner = null;
        // Reset switches for safety
        device.switches.forEach(sw => sw.state = false);
        await device.save();

        res.json({ status: 'unlinked' });
    } catch (err) { res.status(500).json({ error: "Unlink failed" }); }
});
// Admin: Update Device Channels (Resize)
app.post('/api/admin/device/channels', auth, verifyAdmin, async (req, res) => {
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
    } catch (err) { res.status(500).json({ error: "Update failed" }); }
});

// GOOGLE ASSISTANT INTEGRATION


// Google opens this URL in a popup on your phone to ask for login.
// OAUTH: Authorization Page
app.get('/auth', (req, res) => {
    // Debug Log: Check if Google sent the parameters
    console.log("Only Google should access this. Query Params:", req.query);

    const { redirect_uri, state } = req.query;

    if (!redirect_uri || !state) {
        return res.send("Error: Missing 'redirect_uri'. Do not open this page manually. Please start from the Google Home App.");
    }

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

// OAUTH: Handle Login Form Submission
app.post('/login-link', async (req, res) => {
    // Debug Log: Check what the form sent back
    console.log("Login Attempt Body:", req.body);

    const { email, password, redirect_uri, state } = req.body;
    
    // SAFETY CHECK: If redirect_uri is missing, stop here.
    if (!redirect_uri || redirect_uri === "undefined") {
        return res.send("Error: Return address lost. Please go back to Google Home App and try again.");
    }

    // Check credentials
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.send("Invalid credentials. Please go back and try again.");
    }

    const authCode = Buffer.from(user._id.toString()).toString('base64');
    
    // Redirect back to Google
    console.log(`Redirecting to: ${redirect_uri}`);
    res.redirect(`${redirect_uri}?code=${authCode}&state=${state}`);
});

// OAUTH: Token Exchange
// Google swaps the "auth code" for an "access token"
app.post('/token', async (req, res) => {
    const { code, grant_type, refresh_token } = req.body;
    let userId;
    
    // If getting a new token
    if (grant_type === 'authorization_code') {
        userId = Buffer.from(code, 'base64').toString('ascii'); // Decode User ID
    } 
    // If refreshing an old token
    else if (grant_type === 'refresh_token') {
        userId = refresh_token;
    }

    await User.findByIdAndUpdate(userId, { isGoogleLinked: true });

    // Create a standard JWT for Google to use in future requests
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET);

    res.json({
        token_type: "Bearer",
        access_token: token,
        refresh_token: userId,
        expires_in: 3600 // 1 hour
    });
});

// SMART HOME FULFILLMENT (The Brain)
// This receives commands like "Turn on the light"
app.post('/api/smarthome', auth, async (req, res) => {
    const body = req.body;
    const userId = req.user.id; // Extracted from the JWT token
    const requestId = body.requestId;
    const intent = body.inputs[0].intent;

    // Handle Disconnect ---
    if (intent === 'action.devices.DISCONNECT') {
        await User.findByIdAndUpdate(userId, { isGoogleLinked: false });
        return res.json({});
    }

    // Self-Healing (If they are sending commands, they are linked)
    await User.findByIdAndUpdate(userId, { isGoogleLinked: true });


    console.log(`Google Request: ${intent}`);

 //CHECK TOGGLE STATUS ---
    const user = await User.findById(userId);
    
    // If user has disabled Google Home, we force devices to appear OFFLINE
    if (!user || user.googleHomeEnabled === false) {
        
        // QUERY INTENT (Status Check) -> Report "Offline"
        if (intent === 'action.devices.QUERY') {
            const requestedDevices = body.inputs[0].payload.devices;
            const deviceStatus = {};
            requestedDevices.forEach(d => {
                deviceStatus[d.id] = { online: false }; // Force Offline
            });
            return res.json({
                requestId: requestId,
                payload: { devices: deviceStatus }
            });
        }

        // EXECUTE INTENT (Turn On/Off) -> Block it
        if (intent === 'action.devices.EXECUTE') {
             return res.json({
                requestId: requestId,
                payload: {
                    errorCode: "deviceOffline" // Tell Google device is unreachable
                }
            });
        }

        // Note: We allow SYNC to proceed so devices don't disappear from the Google Home App,
        // they just stop working (Offline).
    }

    // SYNC: Google asks "What devices does this user have?" 
    if (intent === 'action.devices.SYNC') {
        const devices = await Device.find({ owner: userId }).lean();
        
        const payloadDevices = [];
        devices.forEach(device => {
            device.switches.forEach(sw => {
                // Determine Google Device Type and Traits
                    let type = 'action.devices.types.SWITCH';
                    let traits = ['action.devices.traits.OnOff'];
                    let attributes = {};

                    if (sw.type === 'light') type = 'action.devices.types.LIGHT';
                    if (sw.type === 'fan') {
                        type = 'action.devices.types.FAN';
                        traits.push('action.devices.traits.FanSpeed'); // Mandatory for Fans
                        attributes = {
                            availableFanSpeeds: {
                                speeds: [
                                    { speed_name: 'Low', speed_values: [{ speed_synonym: ['low', '1'], lang: 'en' }] },
                                    { speed_name: 'High', speed_values: [{ speed_synonym: ['high', '2'], lang: 'en' }] }
                                ],
                                ordered: true
                            },
                            reversible: false
                        };
                    }
                    if (sw.type === 'ac') type = 'action.devices.types.AC_UNIT';
                    if (sw.type === 'outlet') type = 'action.devices.types.OUTLET';

                    payloadDevices.push({
                        id: `${device.deviceId}-${sw.id}`,
                        type: type,
                        traits: traits,
                        attributes: attributes, // Added attributes for FanSpeed
                        name: { name: sw.name },
                        willReportState: true,
                        deviceInfo: { manufacturer: 'SmartHubPranshu', model: 'ESP32' }
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

    // QUERY: Google asks "Is the light on?" 
    if (intent === 'action.devices.QUERY') {
    const requestedDevices = body.inputs[0].payload.devices;
    const deviceStatus = {};

    // Group switches by deviceId to minimize DB hits
    const uniqueDeviceIds = [...new Set(requestedDevices.map(d => d.id.split('-')[0]))];
    
    // Fetch all relevant devices in one go
    const devices = await Device.find({ deviceId: { $in: uniqueDeviceIds }, owner: userId }).lean();
    const deviceMap = Object.fromEntries(devices.map(d => [d.deviceId, d]));

    for (const d of requestedDevices) {
        const [deviceId, switchIdStr] = d.id.split('-');
        const switchId = parseInt(switchIdStr);
        const dbDevice = deviceMap[deviceId];

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

    // EXECUTE: Google says "Turn on the light"
if (intent === 'action.devices.EXECUTE') {
    const commands = body.inputs[0].payload.commands;
    
    // 1. Identify all unique device IDs involved in this request
    const allDeviceIds = commands.flatMap(c => c.devices.map(d => d.id.split('-')[0]));
    const uniqueIds = [...new Set(allDeviceIds)];

    // 2. Fetch all devices once and create a map
    const devices = await Device.find({ deviceId: { $in: uniqueIds }, owner: userId }).lean();
    const deviceMap = Object.fromEntries(devices.map(d => [d.deviceId, d]));

    const commandResults = await Promise.all(commands.map(async (command) => {
        return await Promise.all(command.devices.map(async (device) => {
            const [deviceId, switchIdStr] = device.id.split('-');
            const switchId = parseInt(switchIdStr);
            const dbDevice = deviceMap[deviceId];

            if (!dbDevice) return { ids: [device.id], status: "OFFLINE" };

            return await Promise.all(command.execution.map(async (execution) => {
                if (execution.command === 'action.devices.commands.OnOff') {
                    const newState = execution.params.on;
                    const sw = dbDevice.switches.find(s => s.id === switchId);
                    
                    const hardwareSignal = (sw && sw.inverted) ? !newState : newState;
                    mqttClient.publish(`devices/${deviceId}/command`, JSON.stringify({ switchId, state: hardwareSignal }));

                    // Prepare update fields to include timestamp
                    let updateFields = { "switches.$.state": newState };
                    if (newState) {
                        updateFields["switches.$.lastOnTime"] = new Date();
                    } else {
                        updateFields["switches.$.lastOnTime"] = null;
                        updateFields["switches.$.timerExpiresAt"] = null;
                    }

                    await Device.updateOne(
                        { deviceId, "switches.id": switchId },
                        { $set: updateFields } // Now updates both state and timestamp
                    );

                    // Log History in background
                    History.create({
                        owner: userId,
                        deviceId: deviceId,
                        switchName: sw ? sw.name : `Switch ${switchId}`,
                        action: newState ? "Turned ON (Google)" : "Turned OFF (Google)"
                    }).catch(e => console.error("History Error", e));

                    return {
                        ids: [device.id],
                        status: "SUCCESS",
                        states: { 
                            on: newState, 
                            online: dbDevice.isOnline // Use actual status from DB
                        }
                    };
                }
            }));
        }));
    }));

    return res.json({
        requestId: requestId,
        payload: { commands: commandResults.flat(2) }
    });
}
});

// Start Server
app.listen(PORT, '0.0.0.0', () => { 
    console.log(`🚀 Backend server running at http://localhost:${PORT}`);
});