const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Device = require('../models/Device');
const History = require('../models/History');
const mqttClient = require('../config/mqtt');
const appSmartHome = require('../config/smartHome');

exports.authPage = (req, res) => {
    const { redirect_uri, state } = req.query;
    if (!redirect_uri || !state) return res.send("Error: Missing parameters.");
    res.send(`
        <form action="/login-link" method="post">
            <input type="hidden" name="redirect_uri" value="${redirect_uri}" />
            <input type="hidden" name="state" value="${state}" />
            <input type="email" name="email" placeholder="Email" required /><br/>
            <input type="password" name="password" placeholder="Password" required /><br/>
            <button type="submit">Link Account</button>
        </form>
    `);
};

exports.loginLink = async (req, res) => {
    const { email, password, redirect_uri, state } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
        return res.send("Invalid credentials.");
    }
    const authCode = Buffer.from(user._id.toString()).toString('base64');
    res.redirect(`${redirect_uri}?code=${authCode}&state=${state}`);
};

exports.tokenExchange = async (req, res) => {
    const { code, grant_type, refresh_token } = req.body;
    let userId = grant_type === 'authorization_code' 
        ? Buffer.from(code, 'base64').toString('ascii') 
        : refresh_token;

    await User.findByIdAndUpdate(userId, { isGoogleLinked: true });
    const token = jwt.sign({ id: userId }, process.env.JWT_SECRET);

    res.json({
        token_type: "Bearer",
        access_token: token,
        refresh_token: userId,
        expires_in: 3600
    });
};

// 1. SYNC: Tell Google what devices the user has
appSmartHome.onSync(async (body,取出) => {
    const userId = body.agentUserId;
    const devices = await Device.find({ owner: userId }).lean();

    const googleDevices = [];
    devices.forEach(device => {
        device.switches.forEach(sw => {
            googleDevices.push({
                id: `${device.deviceId}-${sw.id}`, // Unique ID for each switch
                type: sw.type === 'fan' ? 'action.devices.types.FAN' : 'action.devices.types.LIGHT',
                traits: ['action.devices.traits.OnOff'],
                name: { name: sw.name || `Switch ${sw.id}` },
                willReportState: true,
                deviceInfo: { manufacturer: 'SmartHub', model: 'ESP32-v1' }
            });
        });
    });

    return {
        requestId: body.requestId,
        payload: {
            agentUserId: userId,
            devices: googleDevices
        }
    };
});

// 2. QUERY: Tell Google the current state of devices
appSmartHome.onQuery(async (body) => {
    const { devices } = body.inputs[0].payload;
    const deviceStates = {};

    for (const googleDevice of devices) {
        const [deviceId, switchId] = googleDevice.id.split('-');
        const device = await Device.findOne({ deviceId }).lean();
        
        if (device) {
            const sw = device.switches.find(s => s.id == switchId);
            deviceStates[googleDevice.id] = {
                online: device.isOnline,
                on: sw ? sw.state : false
            };
        }
    }

    return {
        requestId: body.requestId,
        payload: { devices: deviceStates }
    };
});

// 3. EXECUTE: Handle the actual On/Off commands
appSmartHome.onExecute(async (body) => {
    const userId = body.agentUserId;
    const { commands } = body.inputs[0].payload;
    const results = [];

    for (const command of commands) {
        for (const googleDevice of command.devices) {
            const [deviceId, switchId] = googleDevice.id.split('-');
            const { on } = command.execution[0].params;

            // 1. Find device and switch settings
            const device = await Device.findOne({ deviceId });
            if (!device) continue;
            
            const sw = device.switches.find(s => s.id == switchId);
            if (!sw) continue;

            // 2. Calculate the signal to send to hardware (respecting inversion)
            const hardwareSignal = sw.inverted ? !on : on;

            // 3. Publish to MQTT to trigger physical change
            mqttClient.publish(`devices/${deviceId}/command`, JSON.stringify({
                switchId: parseInt(switchId),
                state: hardwareSignal
            }));

            // 4. Update Database state
            await Device.updateOne(
                { deviceId, "switches.id": parseInt(switchId) },
                { $set: { "switches.$.state": on } }
            );

            // 5. Log to History
            await History.create({
                owner: userId,
                deviceId: deviceId,
                switchId: parseInt(switchId),
                switchName: sw.name,
                state: on,
                source: 'google'
            });

            results.push({
                ids: [googleDevice.id],
                status: 'SUCCESS',
                states: { on: on, online: true }
            });
        }
    }

    return {
        requestId: body.requestId,
        payload: { commands: results }
    };
});

// The fulfillment export now simply passes the request to the appSmartHome instance
exports.fulfillment = appSmartHome;