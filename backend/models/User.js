const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, default: 'user', enum: ['user', 'admin'] },

  // Store Google Home Toggle State
  googleHomeEnabled: { type: Boolean, default: true },

  homeTitle: { type: String, default: 'My Home' },

  // Store token version for global logout
  tokenVersion: { type: Number, default: 0 },

  isGoogleLinked: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);