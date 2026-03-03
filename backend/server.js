const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
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
const { google } = require('googleapis');
const PORT = process.env.PORT || 3000;


const app = express();
// LOGGING
app.use(morgan('common'));

// TRUST PROXY
app.set('trust proxy', 1);

//CORS HERE ---
app.use(cors({
    origin: [process.env.FRONTEND_URL, process.env.ORIGIN_URL, "https://oauth-redirect.googleusercontent.com"].filter(Boolean),
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

// Google Home Graph — uses googleapis directly (actions-on-google reportState is deprecated)
// Parses service account credentials from env var once at startup
const serviceAccountKey = process.env.SMART_HOME_KEY_JSON ? JSON.parse(process.env.SMART_HOME_KEY_JSON) : null;

// Cache the GoogleAuth client — reuse across all reportState calls instead of creating a new one each time
let _cachedHomegraph = null;
function getHomegraphClient() {
    if (!_cachedHomegraph && serviceAccountKey) {
        const auth = new google.auth.GoogleAuth({
            credentials: serviceAccountKey,
            scopes: ['https://www.googleapis.com/auth/homegraph']
        });
        _cachedHomegraph = google.homegraph({ version: 'v1', auth });
    }
    return _cachedHomegraph;
}

/**
 * Reports device state to Google Home Graph.
 * @param {string} agentUserId  - The user's MongoDB _id as a string
 * @param {object} states       - Map of { "deviceId-switchId": { on: bool, online: bool } }
 */
async function reportStateToGoogle(agentUserId, states) {
    const homegraph = getHomegraphClient();
    if (!homegraph) {
        console.warn('reportStateToGoogle: No service account key configured, skipping.');
        return;
    }
    await homegraph.devices.reportStateAndNotification({
        requestBody: {
            agentUserId,
            requestId: Math.random().toString(),
            payload: { devices: { states } }
        }
    });
}

/**
 * Asks Google to re-sync all devices for a user.
 * Call this after a device is added, removed, or renamed so the Google Home
 * app updates its device list without the user needing to say "sync my devices".
 * @param {string} agentUserId - The user's MongoDB _id as a string
 */
async function requestSyncToGoogle(agentUserId) {
    const homegraph = getHomegraphClient();
    if (!homegraph) {
        console.warn('requestSyncToGoogle: No service account key configured, skipping.');
        return;
    }
    try {
        await homegraph.devices.requestSync({
            requestBody: { agentUserId: agentUserId.toString() }
        });
        console.log(`[SYNC] Requested Google sync for user ${agentUserId}`);
    } catch (e) {
        console.warn('[SYNC] requestSync failed (non-fatal):', e.message);
    }
}

// Enable parsing form data for the login page
app.use(express.urlencoded({ extended: true }));



// MQTT Client Setup (Connects to HiveMQ Cloud)
const mqttClient = mqtt.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    protocol: 'mqtts' // Secure TLS
});

mqttClient.on('connect', () => {
    console.log('Backend connected to MQTT Broker (Failover Group)');
    // Using '$share/backend/' prefix tells HiveMQ to balance messages between servers
    mqttClient.subscribe('$share/backend/devices/+/update');
    mqttClient.subscribe('$share/backend/devices/+/sync');
    mqttClient.subscribe('$share/backend/devices/+/status');
    mqttClient.subscribe('$share/backend/devices/+/sensor');
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
                            await reportStateToGoogle(
                                device.owner._id.toString(),
                                { [`${deviceId}-${data.switchId}`]: { on: userIntentState, online: device.isOnline || true } }
                            );
                        } catch (error) {
                            const status = error?.response?.status || error?.status;
                            if (status === 404) {
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
            const status = message.toString().trim();
            const isOnline = status === 'online';

            const device = await Device.findOne({ deviceId }).lean();

            if (device && device.isOnline !== isOnline) {
                console.log(`Device ${deviceId} is now ${status}`);

                await Device.updateOne(
                    { deviceId: deviceId },
                    { $set: { isOnline: isOnline } }
                );

                if (device.owner) {
                    // Fetch user to see if they are linked before calling Google
                    const ownerRecord = await User.findById(device.owner).lean();
                    if (ownerRecord && ownerRecord.isGoogleLinked === true) {
                        let statesPayload = {};
                        device.switches.forEach(sw => {
                            statesPayload[`${deviceId}-${sw.id}`] = { online: isOnline };
                        });

                        reportStateToGoogle(device.owner.toString(), statesPayload)
                            .catch(e => {
                                const status = e?.response?.status || e?.status;
                                if (status === 404) {
                                    User.findByIdAndUpdate(device.owner, { isGoogleLinked: false }).catch(() => { });
                                }
                            });
                    }
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
const auth = async (req, res, next) => {
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

        // Fetch user to verify tokenVersion
        const user = await User.findById(verified.id);
        if (!user) {
            return res.status(401).send("User not found");
        }

        // Only enforce tokenVersion for app tokens.
        // Google Home access tokens are signed without tokenVersion — skipping the check
        // for those prevents Google Home from permanently breaking after a "Logout All Devices".
        if (verified.tokenVersion !== undefined) {
            if (user.tokenVersion !== verified.tokenVersion) {
                console.log("Auth Failed: Token version mismatch (logged out from all devices)");
                return res.status(401).send("Session expired. Please log in again.");
            }
        }

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

    // BUG 1 FIX: Added expiresIn so tokens are not valid forever
    const token = jwt.sign({ id: user._id, tokenVersion: user.tokenVersion || 0 }, process.env.JWT_SECRET, { expiresIn: '7d' });

    // Send the role back to the frontend 
    res.json({ token, role: user.role });
});

// Logout All Devices
app.post('/api/logout-all', auth, async (req, res) => {
    try {
        // Increment token version to invalidate all current tokens
        await User.findByIdAndUpdate(req.user.id, { $inc: { tokenVersion: 1 } });
        res.json({ status: 'ok', message: 'Logged out from all devices' });
    } catch (err) {
        console.error('Logout All Error:', err);
        res.status(500).json({ error: 'Server Error' });
    }
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
// BUG 6 FIX: Wrapped in try/catch so a DB error doesn't hang the request
app.get('/api/devices', auth, async (req, res) => {
    try {
        // .lean() makes this query much faster for production
        const devices = await Device.find({ owner: req.user.id }).lean();
        res.json(devices);
    } catch (err) {
        res.status(500).json({ error: "Failed to fetch devices" });
    }
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

        // Tell Google to refresh its device list so the new device appears immediately
        requestSyncToGoogle(userId).catch(() => { });

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

        // Tell Google to refresh its device list so the removed device disappears
        requestSyncToGoogle(req.user.id).catch(() => { });

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
        const device = await Device.findOne({ deviceId, owner: req.user.id }).lean();
        if (!device) return res.status(404).json({ error: "Device not found" });

        const sw = device.switches.find(s => s.id === switchId);

        // Guard against undefined switch before reading sw.inverted
        if (!sw) return res.status(404).json({ error: "Switch not found" });

        // INVERSION LOGIC: If inverted, send the opposite signal to the relay
        const hardwareSignal = sw.inverted ? !state : state;
        mqttClient.publish(`devices/${deviceId}/command`, JSON.stringify({ switchId, state: hardwareSignal }));

        // ✅ Respond to client immediately — MQTT command is already sent
        res.json({ status: 'sent', state });

        // Background Tasks: DB update + history + Google report (all run after response)
        (async () => {
            try {
                // Task A: Update Database
                let updateFields = { "switches.$.state": state };
                if (state) {
                    updateFields["switches.$.lastOnTime"] = new Date();
                } else {
                    updateFields["switches.$.lastOnTime"] = null;
                    updateFields["switches.$.timerExpiresAt"] = null;
                    if (sw.type === 'fan') updateFields["switches.$.speed"] = 0;
                }
                await Device.updateOne(
                    { deviceId: deviceId, "switches.id": switchId },
                    { $set: updateFields }
                );

                // Task B: Log History
                await History.create({
                    owner: req.user.id,
                    deviceId: deviceId,
                    switchName: sw.name || `Switch ${switchId}`,
                    action: state ? "Turned ON (App)" : "Turned OFF (App)"
                });

                // Task C: Report to Google
                try {
                    const user = await User.findById(req.user.id).lean();
                    if (user && user.isGoogleLinked === true) {
                        await reportStateToGoogle(
                            req.user.id,
                            { [`${deviceId}-${switchId}`]: { on: state, online: true } }
                        );
                    }
                } catch (error) {
                    const status = error?.response?.status || error?.status;
                    if (status === 404) {
                        await User.findByIdAndUpdate(req.user.id, { isGoogleLinked: false });
                    }
                }
            } catch (bgErr) {
                console.error("Background Task Error:", bgErr);
            }
        })();

    } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(500).json({ error: "Server Error" });
    }
});

// Fan Speed Control
app.post('/api/fan-speed', auth, [
    body('deviceId').isString().trim().escape(),
    body('switchId').isInt(),
    body('speed').isInt({ min: 1, max: 4 })
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid Input' });

    const { deviceId, switchId, speed } = req.body;

    try {
        const device = await Device.findOne({ deviceId, owner: req.user.id });
        if (!device) return res.status(404).json({ error: 'Device not found' });

        const sw = device.switches.find(s => s.id === switchId);
        if (!sw) return res.status(404).json({ error: 'Switch not found' });
        if (sw.type !== 'fan') return res.status(400).json({ error: 'Speed control is only for fan type switches' });

        // Publish MQTT — ESP32 firmware handles the relay pattern for each speed
        mqttClient.publish(`devices/${deviceId}/fan-speed`, JSON.stringify({ switchId, speed }));

        // Update DB: set speed, ensure state=true, set lastOnTime if not set
        const updateFields = {
            "switches.$.speed": speed,
            "switches.$.state": true  // Setting speed implicitly turns fan on
        };
        if (!sw.lastOnTime) updateFields["switches.$.lastOnTime"] = new Date();

        await Device.updateOne(
            { deviceId, "switches.id": switchId },
            { $set: updateFields }
        );

        // Respond immediately
        res.json({ status: 'sent', speed });

        // Background: report new state to Google
        (async () => {
            try {
                const user = await User.findById(req.user.id).lean();
                if (user && user.isGoogleLinked === true) {
                    const speedNames = ['', 'Low', 'Medium', 'High', 'Turbo'];
                    await reportStateToGoogle(req.user.id, {
                        [`${deviceId}-${switchId}`]: {
                            on: true,
                            online: true,
                            currentFanSpeedSetting: speedNames[speed]
                        }
                    });
                }
            } catch (e) {
                const status = e?.response?.status || e?.status;
                if (status === 404) await User.findByIdAndUpdate(req.user.id, { isGoogleLinked: false });
            }
        })();

    } catch (err) {
        console.error(err);
        if (!res.headersSent) res.status(500).json({ error: 'Server Error' });
    }
});
// Edit Device (Name & Icon)
app.post('/api/edit', auth, [
    body('deviceId').isString().trim(),
    body('switchId').isInt(),
    body('newName').isString().trim().escape().isLength({ max: 30 }),
    body('newType').isString().isIn(['light', 'fan', 'ac', 'outlet', 'wifi', 'other', 'water', 'laundry'])
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

        // Tell Google to refresh so renamed devices appear with their new name
        requestSyncToGoogle(req.user.id).catch(() => { });
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
            {
                $set: {
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
                {
                    $set: {
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
                        await reportStateToGoogle(
                            deviceAtExpiry.owner.toString(),
                            { [`${deviceId}-${switchId}`]: { on: false, online: true } }
                        );
                    } catch (error) {
                        // Self-Healing for Timers
                        const status = error?.response?.status || error?.status;
                        if (status === 404) {
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


// [NEW] Cancel Timer Endpoint
app.post('/api/timer/cancel', auth, async (req, res) => {
    const { deviceId, switchId } = req.body;
    const timerKey = `${deviceId}-${switchId}`;

    try {
        // 1. Stop the Node.js Timeout
        if (activeTimers[timerKey]) {
            clearTimeout(activeTimers[timerKey]);
            delete activeTimers[timerKey];
        }

        // BUG 11 FIX: Turn off the physical switch when timer is cancelled,
        // not just clear the DB field. Previously the switch stayed ON.
        const device = await Device.findOne({ deviceId, owner: req.user.id });
        if (device) {
            const sw = device.switches.find(s => s.id === switchId);
            // Apply inversion logic for the OFF signal
            const endSignal = (sw && sw.inverted) ? true : false;
            mqttClient.publish(`devices/${deviceId}/command`, JSON.stringify({ switchId, state: endSignal }));
        }

        // 2. Update DB: set state OFF, clear timer fields
        await Device.updateOne(
            { deviceId: deviceId, "switches.id": switchId },
            { $set: { "switches.$.state": false, "switches.$.lastOnTime": null, "switches.$.timerExpiresAt": null } }
        );

        res.json({ status: 'timer_cancelled' });

    } catch (err) {
        console.error("Timer Cancel Error:", err);
        res.status(500).json({ error: "Server Error" });
    }
});


// Wi-Fi Config Update

// BUG 7 FIX: Wrapped in try/catch so a DB error doesn't hang the request
app.post('/api/wifi-config', auth, async (req, res) => {
    const { deviceId, ssid, pass } = req.body;
    try {
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
    } catch (err) {
        console.error("Wi-Fi config error:", err);
        res.status(500).json({ error: "Server Error" });
    }
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
app.post('/api/admin/create', auth, verifyAdmin, [
    // SECURITY: Validate format to prevent garbage/injection being written to DB
    body('deviceId')
        .isString().trim()
        .isLength({ min: 1, max: 64 })
        .matches(/^[a-zA-Z0-9_-]+$/).withMessage('Device ID may only contain letters, numbers, hyphens, or underscores'),
    body('secretCode')
        .isString().trim()
        .isLength({ min: 4, max: 32 }).withMessage('Secret code must be 4-32 characters'),
    body('channels')
        .optional().isInt({ min: 1, max: 9 }).toInt()
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

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

    // BUG 9 FIX: Encode user-controlled values before injecting into HTML to prevent XSS
    const safeRedirectUri = redirect_uri.replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const safeState = state.replace(/"/g, '&quot;').replace(/</g, '&lt;');

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Link Blinkdrop</title>
      <style>
        body {
          margin: 0;
          padding: 0;
          background-color: #f8f9fa;
          font-family: 'Roboto', Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          color: #202124;
        }
        .card {
          background: #ffffff;
          border-radius: 8px;
          border: 1px solid #dadce0;
          padding: 40px 40px 36px;
          width: 100%;
          max-width: 450px;
          box-sizing: border-box;
          text-align: center;
        }
        .card h2 {
          margin: 0 0 10px;
          font-weight: 400;
          font-size: 24px;
        }
        .card p.subtitle {
          margin: 0 0 32px;
          font-size: 16px;
          color: #202124;
        }
        form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .input-group {
          text-align: left;
          position: relative;
        }
        .input-group input {
          width: 100%;
          padding: 13px 15px;
          border: 1px solid #dadce0;
          border-radius: 4px;
          font-size: 16px;
          box-sizing: border-box;
          transition: border-color 0.2s;
        }
        .input-group input:focus {
          outline: none;
          border: 2px solid #1a73e8;
          padding: 12px 14px; /* Adjust padding to prevent layout shift */
        }
        .form-actions {
          margin-top: 24px;
          display: flex;
          justify-content: flex-end;
        }
        button {
          background-color: #1a73e8;
          color: #ffffff;
          border: none;
          border-radius: 4px;
          padding: 10px 24px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.2s, box-shadow 0.2s;
        }
        button:hover {
          background-color: #1b66c9;
          box-shadow: 0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15);
        }
        .disclaimer {
          margin-top: 36px;
          font-size: 14px;
          color: #5f6368;
          line-height: 1.5;
          text-align: left;
        }
      </style>
    </head>
    <body>
      <div class="card">
        <h2>Blinkdrop Login</h2>
        <p class="subtitle">Use your Blinkdrop account</p>
        <form action="/login-link" method="post">
          <input type="hidden" name="redirect_uri" value="\${safeRedirectUri}" />
          <input type="hidden" name="state" value="\${safeState}" />
          
          <div class="input-group">
            <input type="email" name="email" placeholder="Email" required autocomplete="email" />
          </div>
          
          <div class="input-group">
            <input type="password" name="password" placeholder="Password" required autocomplete="current-password" />
          </div>
          
          <div class="form-actions">
            <button type="submit">Link Account</button>
          </div>
        </form>
        <div class="disclaimer">
          By signing in, you are authorizing Google to access your devices and control them through the Google Home app and Google Assistant.
        </div>
      </div>
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

    // BUG 9 FIX: Validate redirect_uri to prevent open redirect attacks.
    // Only Google's official OAuth redirect domain is allowed.
    const ALLOWED_REDIRECT_PREFIX = "https://oauth-redirect.googleusercontent.com";
    if (!redirect_uri.startsWith(ALLOWED_REDIRECT_PREFIX)) {
        return res.status(400).send("Error: Invalid redirect URI. This endpoint only accepts Google OAuth redirects.");
    }

    // Check credentials
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.send("Invalid credentials. Please go back and try again.");
    }

    // SECURITY FIX (Issue 5): Sign auth code as a short-lived JWT instead of plain base64(userId).
    // Plain base64 is trivially decodable — anyone with a MongoDB _id could forge a code.
    const authCode = jwt.sign(
        { uid: user._id.toString() },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }   // Code valid for 5 minutes only
    );

    // Redirect back to Google
    console.log(`Redirecting to: ${redirect_uri}`);
    res.redirect(`${redirect_uri}?code=${encodeURIComponent(authCode)}&state=${state}`);
});

// OAUTH: Token Exchange
// Google swaps the "auth code" for an "access token"
app.post('/token', async (req, res) => {
    const { code, grant_type, refresh_token } = req.body;
    let userId;

    // BUG 10 FIX: Validate grant_type before proceeding
    // If getting a new token
    if (grant_type === 'authorization_code') {
        // SECURITY FIX (Issue 5): Verify the signed JWT auth code instead of decoding plain base64
        try {
            const decoded = jwt.verify(code, process.env.JWT_SECRET);
            userId = decoded.uid;
        } catch (e) {
            // Google requires exactly this error string to handle expired/invalid codes correctly
            return res.status(400).json({ error: 'invalid_grant' });
        }
    }
    // If refreshing an old token
    else if (grant_type === 'refresh_token') {
        // SECURITY FIX (Issue 6): Verify that the refresh token is a signed JWT (not raw userId)
        try {
            const decoded = jwt.verify(refresh_token, process.env.JWT_SECRET);
            userId = decoded.uid;
        } catch (e) {
            // Google requires exactly this error string to trigger a re-auth flow
            return res.status(400).json({ error: 'invalid_grant' });
        }
    } else {
        return res.status(400).json({ error: 'Invalid grant_type' });
    }

    // BUG 10 FIX: Guard against undefined userId before writing to DB or signing JWT
    if (!userId) {
        return res.status(400).json({ error: 'Invalid token request: missing user identifier' });
    }

    await User.findByIdAndUpdate(userId, { isGoogleLinked: true });

    // BUG 1 FIX: Added expiresIn so Google tokens are not valid forever
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // SECURITY FIX (Issue 6): Refresh token is now a signed JWT with 30-day expiry (not raw userId)
    const signedRefreshToken = jwt.sign({ uid: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({
        token_type: "Bearer",
        access_token: token,
        refresh_token: signedRefreshToken,
        expires_in: 3600 // 1 hour
    });
});

// SMART HOME FULFILLMENT (The Brain)
// This receives commands like "Turn on the light"
app.post('/api/smarthome', auth, async (req, res) => {
    const body = req.body;
    const userId = req.user.id; // Extracted from the JWT token
    const requestId = body.requestId;

    // BUG 2 FIX: Guard against missing or malformed inputs array to prevent crash
    if (!body.inputs || !body.inputs[0]) {
        return res.status(400).json({ error: "Bad Request: missing inputs" });
    }

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

        // Google Home only supports 3 device types in this system: light, fan, outlet.
        // Any other type the user selected (wifi, ac, water, laundry, other) is reported
        // to Google Home as an OUTLET so it behaves correctly without errors.
        // The app still stores and displays the original user-chosen type.
        const typeMap = {
            'light': { type: 'action.devices.types.LIGHT', attributes: {} },
            'fan': { type: 'action.devices.types.FAN', attributes: { reversible: false } },
            'outlet': { type: 'action.devices.types.OUTLET', attributes: {} },
            // All non-standard types fall back to OUTLET for Google Home compatibility
            'ac': { type: 'action.devices.types.OUTLET', attributes: {} },
            'wifi': { type: 'action.devices.types.OUTLET', attributes: {} },
            'water': { type: 'action.devices.types.OUTLET', attributes: {} },
            'laundry': { type: 'action.devices.types.OUTLET', attributes: {} },
            'other': { type: 'action.devices.types.OUTLET', attributes: {} },
        };

        const payloadDevices = [];
        devices.forEach(device => {
            device.switches.forEach(sw => {
                const mapping = typeMap[sw.type] || typeMap['other'];

                const isFan = sw.type === 'fan';
                const fanSpeedAttribute = isFan ? {
                    availableFanSpeeds: {
                        speeds: [
                            { speed_name: 'Low', speed_values: [{ speed_synonym: ['low', '1'], lang: 'en' }] },
                            { speed_name: 'Medium', speed_values: [{ speed_synonym: ['medium', '2', 'mid'], lang: 'en' }] },
                            { speed_name: 'High', speed_values: [{ speed_synonym: ['high', '3'], lang: 'en' }] },
                            { speed_name: 'Turbo', speed_values: [{ speed_synonym: ['turbo', '4', 'max'], lang: 'en' }] }
                        ],
                        ordered: true
                    },
                    reversible: false
                } : mapping.attributes;

                payloadDevices.push({
                    id: `${device.deviceId}-${sw.id}`,
                    type: mapping.type,
                    traits: isFan
                        ? ['action.devices.traits.OnOff', 'action.devices.traits.FanSpeed']
                        : ['action.devices.traits.OnOff'],
                    name: { name: sw.name },
                    willReportState: true,
                    attributes: fanSpeedAttribute,
                    deviceInfo: {
                        manufacturer: 'SmartHubPranshu',
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
                const state = {
                    status: 'SUCCESS',
                    on: sw ? sw.state : false,
                    online: dbDevice.isOnline
                };
                // Include fan speed in QUERY response
                if (sw && sw.type === 'fan') {
                    const speedNames = ['', 'Low', 'Medium', 'High', 'Turbo'];
                    // Use the stored speed index directly; fall back to 'Low' only when the value is
                    // out-of-range (not when speed is legitimately 0 / fan is off).
                    state.currentFanSpeedSetting = speedNames[sw.speed] || 'Low';
                }
                deviceStatus[d.id] = state;
            } else {
                deviceStatus[d.id] = { status: 'ERROR', errorCode: 'deviceNotFound', online: false };
            }
        }

        return res.json({
            requestId: requestId,
            payload: { devices: deviceStatus }
        });
    }

    // EXECUTE: Google says "Turn on the light"
    if (intent === 'action.devices.EXECUTE') {
        // SECURITY FIX (Issue 4): Wrap in try/catch to prevent unhandled rejection hanging the response
        try {
            const commands = body.inputs[0].payload.commands;

            // 1. Identify all unique device IDs involved in this request
            const allDeviceIds = commands.flatMap(c => c.devices.map(d => d.id.split('-')[0]));
            const uniqueIds = [...new Set(allDeviceIds)];

            // 2. Fetch all devices once and create a map
            const devices = await Device.find({ deviceId: { $in: uniqueIds }, owner: userId }).lean();
            const deviceMap = Object.fromEntries(devices.map(d => [d.deviceId, d]));

            // --- Build results and collect background work in parallel ---
            // We resolve the intended state immediately from the request params and respond
            // to Google right away. DB writes, history logs, and reportStateToGoogle all
            // happen in a single fire-and-forget background task so Google is never waiting
            // for a DB round-trip.
            const commandResults = [];
            const backgroundJobs = []; // Collect all DB/reporting work

            for (const command of commands) {
                for (const device of command.devices) {
                    const [deviceId, switchIdStr] = device.id.split('-');
                    const switchId = parseInt(switchIdStr);
                    const dbDevice = deviceMap[deviceId];

                    if (!dbDevice) {
                        commandResults.push({ ids: [device.id], status: "OFFLINE" });
                        continue;
                    }

                    for (const execution of command.execution) {

                        // --- OnOff ---
                        if (execution.command === 'action.devices.commands.OnOff') {
                            const newState = execution.params.on;
                            const sw = dbDevice.switches.find(s => s.id === switchId);

                            // ✅ Publish MQTT immediately — hardware reacts now
                            const hardwareSignal = (sw && sw.inverted) ? !newState : newState;
                            mqttClient.publish(`devices/${deviceId}/command`, JSON.stringify({ switchId, state: hardwareSignal }));

                            // ✅ Build the SUCCESS response right away — no DB wait
                            commandResults.push({
                                ids: [device.id],
                                status: "SUCCESS",
                                states: { on: newState, online: true }
                            });

                            // Queue DB update + history + reportState for background
                            backgroundJobs.push(async () => {
                                let updateFields = { "switches.$.state": newState };
                                if (newState) {
                                    updateFields["switches.$.lastOnTime"] = new Date();
                                } else {
                                    updateFields["switches.$.lastOnTime"] = null;
                                    updateFields["switches.$.timerExpiresAt"] = null;
                                    if (sw && sw.type === 'fan') updateFields["switches.$.speed"] = 0;
                                }
                                await Device.updateOne(
                                    { deviceId, "switches.id": switchId },
                                    { $set: updateFields }
                                );
                                reportStateToGoogle(userId, {
                                    [`${deviceId}-${switchId}`]: { on: newState, online: true }
                                }).catch(e => console.error('[EXECUTE] reportState OnOff error:', e.message));
                                History.create({
                                    owner: userId, deviceId,
                                    switchName: sw ? sw.name : `Switch ${switchId}`,
                                    action: newState ? "Turned ON (Google)" : "Turned OFF (Google)"
                                }).catch(e => console.error("History Error", e));
                            });
                        }

                        // --- SetFanSpeed ---
                        else if (execution.command === 'action.devices.commands.SetFanSpeed') {
                            const speedName = execution.params.fanSpeed;
                            const speedMap = { 'Low': 1, 'Medium': 2, 'High': 3, 'Turbo': 4 };
                            const speed = speedMap[speedName] || 1;
                            const sw = dbDevice.switches.find(s => s.id === switchId);

                            // ✅ Publish MQTT immediately
                            mqttClient.publish(`devices/${deviceId}/fan-speed`, JSON.stringify({ switchId, speed }));

                            // ✅ Build the SUCCESS response right away — no DB wait
                            commandResults.push({
                                ids: [device.id],
                                status: "SUCCESS",
                                states: { on: true, online: true, currentFanSpeedSetting: speedName }
                            });

                            // Queue DB update + history + reportState for background
                            backgroundJobs.push(async () => {
                                await Device.updateOne(
                                    { deviceId, "switches.id": switchId },
                                    { $set: { "switches.$.speed": speed, "switches.$.state": true } }
                                );
                                reportStateToGoogle(userId, {
                                    [`${deviceId}-${switchId}`]: { on: true, online: true, currentFanSpeedSetting: speedName }
                                }).catch(e => console.error('[EXECUTE] reportState SetFanSpeed error:', e.message));
                                History.create({
                                    owner: userId, deviceId,
                                    switchName: sw ? sw.name : `Switch ${switchId}`,
                                    action: `Set fan to ${speedName} (Google)`
                                }).catch(e => console.error("History Error", e));
                            });
                        }
                    }
                }
            }

            // ✅ Respond to Google immediately — hardware already reacted via MQTT
            res.json({
                requestId: requestId,
                payload: { commands: commandResults.filter(Boolean) }
            });

            // Run all background DB/reporting jobs after the response is sent
            Promise.all(backgroundJobs.map(job => job())).catch(e =>
                console.error('[EXECUTE BG ERROR]', e.message)
            );
        } catch (err) {
            console.error('[EXECUTE ERROR]', err.message);
            return res.status(500).json({ requestId, payload: { errorCode: 'hardError' } });
        }
    }
});

// ── Health check ──
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Backend server running at http://localhost:${PORT}`);
});