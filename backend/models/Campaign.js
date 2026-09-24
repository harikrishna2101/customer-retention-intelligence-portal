const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema({
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    name:    { type: String, required: true },
    trigger: { type: String, required: true },   // e.g. 'Risk Score > 75%'
    status:  { type: String, enum: ['active', 'paused', 'draft'], default: 'draft' },
    nodes:   { type: Array, default: [] },        // The visual builder node graph
    success_rate: { type: String, default: '—' }, // e.g. '48%'
}, { timestamps: true });

CampaignSchema.index({ createdBy: 1, createdAt: -1 });

module.exports = mongoose.model('Campaign', CampaignSchema);
