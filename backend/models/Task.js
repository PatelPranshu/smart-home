const mongoose = require('mongoose');

const TaskSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId: { type: String, required: true },
  switchId: { type: Number, required: true },
  switchName: { type: String }, 
  onTime: { type: String, required: true },  // Format "HH:mm"
  offTime: { type: String, required: true }, // Format "HH:mm"
  days: [{ type: Number }],                  // 0 (Sun) to 6 (Sat)
  isEnabled: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

// Indexes for high-performance scheduling queries
TaskSchema.index({ onTime: 1, isEnabled: 1 });
TaskSchema.index({ offTime: 1, isEnabled: 1 });

module.exports = mongoose.model('Task', TaskSchema);