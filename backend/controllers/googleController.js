const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Device = require('../models/Device');
const History = require('../models/History');
const mqttClient = require('../config/mqtt');

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

exports.fulfillment = async (req, res) => {
    // This function will contain your large action.devices.SYNC/QUERY/EXECUTE logic
    // Reference the switch/case or if/else logic from your server.js smarthome endpoint
    // ...
};  