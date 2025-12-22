const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  secret: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isOnline: { type: Boolean, default: false }, // <--- NEW FIELD
  secretCode: { type: String, default: '123456' },
  switches: [{
    id: Number,
    name: String,
    state: Boolean,
    type: { type: String, default: 'light' },
    lastOnTime: { type: Date, default: null },
    timerExpiresAt: { type: Date, default: null }
  }]
});

module.exports = mongoose.model('Device', DeviceSchema);