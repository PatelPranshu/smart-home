const mongoose = require('mongoose');

const SwitchSchema = new mongoose.Schema({
  id: Number,
  name: String,
  state: Boolean,
  type: { type: String, default: 'light' },
  lastOnTime: { type: Date, default: null },
  timerExpiresAt: { type: Date, default: null }
}, { _id: false });

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },
  

  secretCode: { type: String, required: true }, 

  // MQTT password 
  secret: { type: String, default: "mqtt_password_placeholder" }, 

  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, 
  
  isOnline: { type: Boolean, default: false },
  
  switches: [SwitchSchema]
});

module.exports = mongoose.model('Device', DeviceSchema);