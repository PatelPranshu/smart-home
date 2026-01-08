const mongoose = require('mongoose');

const HistorySchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId: { type: String, required: true },
  switchId: Number, 
  switchName: String,
  state: Boolean,      // true for ON, false for OFF
  source: { 
    type: String, 
    enum: ['physical', 'app', 'google', 'timer'], // Limits to specific sources
    default: 'app' 
  },
  timestamp: { type: Date, default: Date.now }
});

// TTL Index stays the same for 24h cleanup
HistorySchema.index({ timestamp: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('History', HistorySchema);