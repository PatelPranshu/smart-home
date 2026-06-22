const mongoose = require('mongoose');

const SessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  refreshTokenHash: {
    type: String,
    required: true
  },
  deviceInfo: {
    type: String,
    default: 'Unknown'
  },
  deviceName: {
    type: String,
    default: 'Unknown Device'
  },
  location: {
    type: String,
    default: 'Unknown Location'
  },
  isPersistent: {
    type: Boolean,
    default: false
  },
  isPrimary: {
    type: Boolean,
    default: false
  },
  ipAddress: {
    type: String,
    default: 'Unknown'
  },
  expiresAt: {
    type: Date,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastActive: {
    type: Date,
    default: Date.now
  }
});

// TTL index — MongoDB automatically deletes documents when expiresAt is reached
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Session', SessionSchema);
