const mongoose = require('mongoose');

const ActivitySchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    icon: {
        type: String,
        default: 'bx-info-circle'
    },
    color: {
        type: String,
        default: 'var(--text-color)'
    },
    title: {
        type: String,
        required: true
    },
    sub: {
        type: String,
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('Activity', ActivitySchema);
