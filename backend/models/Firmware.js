const mongoose = require('mongoose');

const FirmwareSchema = new mongoose.Schema({
    version: { type: String, required: true },
    githubUrl: { type: String, required: true },
    localFilename: { type: String, default: null },
    scheduledAt: { type: Date, required: true },
    releasedAt: { type: Date, default: null },
    status: {
        type: String,
        default: 'scheduled',
        enum: ['scheduled', 'downloading', 'active', 'rolled_back', 'failed']
    },
    targetType: {
        type: String,
        default: 'all',
        enum: ['all', 'specific']
    },
    targetDevices: [{ type: String }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
});

// Index for the scheduler query (find pending releases efficiently)
FirmwareSchema.index({ status: 1, scheduledAt: 1 });

module.exports = mongoose.model('Firmware', FirmwareSchema);
