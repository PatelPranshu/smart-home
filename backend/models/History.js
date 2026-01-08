const mongoose = require('mongoose');

const HistorySchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Links to the user
  deviceId: String,
  switchName: String,
  action: String, // e.g., "Turned ON", "Turned OFF"
  timestamp: { type: Date, default: Date.now }
});

// AUTOMATIC DELETE AFTER 24 HOURS
HistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('History', HistorySchema);