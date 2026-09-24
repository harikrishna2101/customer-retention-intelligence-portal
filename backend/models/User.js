const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  email:        { type: String, required: true, unique: true },
  password:     { type: String, required: true },
  organization: { type: String, required: true },
  industry:     { type: String, required: true },
  otp:          { type: String },
  otpExpires:   { type: Date },
  otpAttempts:  { type: Number, default: 0 },

  // Role-based access control
  role: { type: String, enum: ['admin', 'viewer'], default: 'admin' },

  // Onboarding
  onboardingCompleted: { type: Boolean, default: false },

  // Proactive alert threshold (default: alert if any customer crosses 80%)
  alertThreshold: { type: Number, default: 80 }
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);

