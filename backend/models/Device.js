const mongoose = require('mongoose');

const SwitchSchema = new mongoose.Schema({
  id: Number,
  name: String,
  state: Boolean,
  type: { type: String, default: 'light' },
  inverted: { type: Boolean, default: false },
  lastOnTime: { type: Date, default: null },
  timerExpiresAt: { type: Date, default: null },
  speed: { type: Number, default: 0, min: 0, max: 4 }  // Fan speed: 0=off, 1=Low, 2=Med, 3=High, 4=Turbo
}, { _id: false });

const DeviceSchema = new mongoose.Schema({
  deviceId: { type: String, required: true, unique: true },


  secretCode: { type: String, required: true },

  // MQTT password 
  secret: { type: String, default: "mqtt_password_placeholder" },

  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  isOnline: { type: Boolean, default: false },

  //sensor fields
  temperature: { type: Number, default: 0 },
  humidity: { type: Number, default: 0 },


  switches: [SwitchSchema]
});

module.exports = mongoose.model('Device', DeviceSchema);