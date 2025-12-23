const mongoose = require('mongoose');

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  
  // This is the code on the STICKER
  secretCode: { type: String, required: true }, 

  // If you aren't using individual MQTT passwords yet, make this optional or remove "required"
  secret: { type: String, default: "mqtt_password_placeholder" }, 

  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Default is NULL (Unsold)
  
  isOnline: { type: Boolean, default: false },
  
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