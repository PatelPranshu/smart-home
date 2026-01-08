const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const User = require('../models/User');

exports.register = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { email, password } = req.body;
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ email, password: hashedPassword });
        res.json({ status: 'ok' });
    } catch (err) {
        res.status(400).json({ error: 'Email already exists' });
    }
};

exports.login = async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'User not found' });
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ error: 'Invalid password' });

    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET);
    res.json({ token, role: user.role }); 
};

exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.json({ 
            email: user.email, 
            role: user.role, 
            homeTitle: user.homeTitle || "My Home" 
        });
    } catch (err) { res.status(500).json({ error: "Failed to fetch profile" }); }
};

exports.updateProfile = async (req, res) => {
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
    } catch (err) { res.status(500).json({ error: "Failed to update user" }); }
};

exports.getGoogleStatus = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        res.json({ enabled: user.googleHomeEnabled, isLinked: user.isGoogleLinked });
    } catch (err) { res.status(500).json({ error: "Error fetching status" }); }
};

exports.updateGoogleStatus = async (req, res) => {
    const { enabled } = req.body;
    try {
        await User.findByIdAndUpdate(req.user.id, { googleHomeEnabled: enabled });
        res.json({ status: 'updated' });
    } catch (err) { res.status(500).json({ error: "Update failed" }); }
};