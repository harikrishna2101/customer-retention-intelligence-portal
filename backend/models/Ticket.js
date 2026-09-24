const mongoose = require('mongoose');

const TicketSchema = new mongoose.Schema({
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Customer',
        default: null
    },
    customerID: { type: String, default: '' },
    customerName: { type: String, required: true },
    category: {
        type: String,
        enum: ['Billing', 'Technical', 'Service Quality', 'Account Access', 'Other'],
        default: 'Other'
    },
    priority: {
        type: String,
        enum: ['High', 'Medium', 'Low'],
        default: 'Medium'
    },
    status: {
        type: String,
        enum: ['Open', 'In Progress', 'Resolved', 'Closed'],
        default: 'Open'
    },
    description: { type: String, default: '' },
    riskScore: { type: Number, default: 0 }
}, { timestamps: true });

TicketSchema.index({ createdBy: 1, status: 1, updatedAt: -1 });
TicketSchema.index({ createdBy: 1, customerID: 1 });

module.exports = mongoose.model('Ticket', TicketSchema);
