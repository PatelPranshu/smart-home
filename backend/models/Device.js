const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  secret: { type: String, required: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  switches: [{
    id: Number,
    name: String,
    state: Boolean,
    type: { type: String, default: 'light' },
    lastOnTime: { type: Date, default: null },      // NEW: Tracks when it turned ON
    timerExpiresAt: { type: Date, default: null }   // NEW: Tracks when it will turn OFF
  }]
});

module.exports = mongoose.model('Device', DeviceSchema);