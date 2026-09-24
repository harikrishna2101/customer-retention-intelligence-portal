const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema({
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    customerID: { type: String, required: true },

    // ── ML Predictions ──
    risk_score:    { type: Number, default: null },
    risk_level:    { type: String, enum: ['Safe', 'Warning', 'High Risk', 'New'], default: 'New' },
    prev_risk_score: { type: Number, default: null }, // for proactive alert tracking
    xai_reason1:   { type: String, default: '' },
    xai_reason2:   { type: String, default: '' },

    // ── Intelligence Fields ──
    clv:           { type: Number, default: null },  // Customer Lifetime Value (USD)
    health_score:  { type: Number, default: null },  // 0-100 composite
    renewalDate:   { type: Date, default: null },    // Contract renewal date

    // ── Retention Workflow Stage ──
    crm_stage: { type: String, enum: ['highrisk', 'contacted', 'negotiating', 'saved', 'churned', null], default: null },

    // ── A/B Campaign Tracking ──
    ab_variant:       { type: String, enum: ['A', 'B', null], default: null },
    campaign_sent_at: { type: Date, default: null },
    campaign_outcome: { type: String, enum: ['retained', 'churned', 'pending', null], default: null },

    // Retention CRM action history
    actionHistory: [{
        type: { type: String, enum: ['note', 'stage', 'email', 'ticket', 'campaign', 'billing'], default: 'note' },
        text: { type: String, required: true },
        stage: { type: String, default: null },
        createdAt: { type: Date, default: Date.now }
    }],

    // Generic metadata vault
    metadata: {
        type: Map,
        of: mongoose.Schema.Types.Mixed,
        default: {}
    }
}, { timestamps: true });

// High-Performance Compound Indexes
CustomerSchema.index({ uploadedBy: 1, risk_level: 1 });
CustomerSchema.index({ uploadedBy: 1, risk_score: -1 });
CustomerSchema.index({ uploadedBy: 1, renewalDate: 1 });
CustomerSchema.index({ uploadedBy: 1, health_score: 1 });

module.exports = mongoose.model('Customer', CustomerSchema);
