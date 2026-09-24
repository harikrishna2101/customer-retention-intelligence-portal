const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { sendOTP } = require('../utils/mailer');

// Safety check — never fall back to a weak hardcoded secret
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('[AUTH] CRITICAL ERROR: JWT_SECRET is not set in .env. Halting server to prevent insecure sessions.');
  process.exit(1);
}
const SECRET = JWT_SECRET;
const OTP_LOCKOUT_ATTEMPTS = 5;
const OTP_TTL_MS = 10 * 60 * 1000;

function isOtpWindowActive(user) {
  return user.otpExpires && user.otpExpires > Date.now();
}

function resetOtpAttemptsIfWindowExpired(user) {
  if (!isOtpWindowActive(user)) {
    user.otpAttempts = 0;
  }
}

// ─────────────────────────────────────────────
// POST /api/auth/register
// ─────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, organization, industry } = req.body;

    if (!name || !email || !password || !organization || !industry) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'An account with this email already exists.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      organization,
      industry
    });

    await newUser.save();
    console.log(`[AUTH] New user registered: ${normalizedEmail}`);
    res.status(201).json({ success: true, message: 'Account created successfully! Please log in.' });

  } catch (err) {
    console.error('[AUTH] Register error:', err.message);
    res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/login — Verifies password, then sends OTP
// ─────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: 'Invalid email or password.' });
    }

    // Check if user is currently locked out from too many failed OTP attempts
    if (user.otpAttempts >= OTP_LOCKOUT_ATTEMPTS && isOtpWindowActive(user)) {
      const minutesLeft = Math.ceil((user.otpExpires - Date.now()) / 60000);
      return res.status(429).json({ success: false, message: `Account temporarily locked due to too many failed OTP attempts. Please try again in ${minutesLeft} minutes.` });
    }

    // Generate 6-digit OTP
    resetOtpAttemptsIfWindowExpired(user);
    const otp = crypto.randomInt(100000, 1000000).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + OTP_TTL_MS;
    await user.save();

    const emailSent = await sendOTP(normalizedEmail, otp);
    if (!emailSent) {
      console.log(`[AUTH] Failed to send OTP email to ${normalizedEmail}`);
    }

    res.status(200).json({ success: true, message: 'OTP sent to your email.' });

  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/verify-otp
// ─────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: 'Email and OTP are required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user || !user.otp || !user.otpExpires) {
      return res.status(400).json({ success: false, message: 'No OTP found. Please request a new one.' });
    }

    if (user.otpAttempts >= OTP_LOCKOUT_ATTEMPTS) {
      return res.status(429).json({ success: false, message: 'Too many failed attempts. Please request a new OTP.' });
    }

    if (user.otpExpires < Date.now()) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (user.otp !== otp.trim()) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      await user.save();
      return res.status(400).json({ success: false, message: `Invalid OTP. ${OTP_LOCKOUT_ATTEMPTS - user.otpAttempts} attempts remaining.` });
    }

    // OTP is valid — clear it and issue JWT
    user.otp = undefined;
    user.otpExpires = undefined;
    user.otpAttempts = 0;
    await user.save();

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      SECRET,
      { expiresIn: '1d' }
    );

    res.cookie('crip-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000 // 1 day
    });

    console.log(`[AUTH] User logged in: ${normalizedEmail}`);
    res.status(200).json({
      success: true,
      message: 'Login successful.',
      user: { name: user.name, email: user.email }
    });

  } catch (err) {
    console.error('[AUTH] Verify OTP error:', err.message);
    res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/forgot-password
// ─────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });

    // Always return success to prevent email enumeration attacks
    if (!user) {
      return res.status(200).json({ success: true, message: 'If that email is registered, an OTP has been sent.' });
    }

    // Check if user is currently locked out from too many failed OTP attempts
    if (user.otpAttempts >= OTP_LOCKOUT_ATTEMPTS && isOtpWindowActive(user)) {
      // Don't leak the exact lockout time for security on forgot-password, just return standard message or a generic error
      return res.status(429).json({ success: false, message: 'Too many attempts. Please try again later.' });
    }

    resetOtpAttemptsIfWindowExpired(user);
    const otp = crypto.randomInt(100000, 1000000).toString();
    user.otp = otp;
    user.otpExpires = Date.now() + OTP_TTL_MS;
    await user.save();

    const emailSent = await sendOTP(normalizedEmail, otp);
    if (!emailSent) {
      console.log(`[AUTH] Failed to send forgot-password OTP email to ${normalizedEmail}`);
    }

    res.status(200).json({ success: true, message: 'If that email is registered, an OTP has been sent.' });

  } catch (err) {
    console.error('[AUTH] Forgot password error:', err.message);
    res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/reset-password
// ─────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: 'All fields are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const user = await User.findOne({ email: normalizedEmail });
    if (!user || !user.otp || !user.otpExpires) {
      return res.status(400).json({ success: false, message: 'No OTP found. Please request a new one.' });
    }

    if (user.otpAttempts >= OTP_LOCKOUT_ATTEMPTS) {
      return res.status(429).json({ success: false, message: 'Too many failed attempts. Please request a new OTP.' });
    }

    if (user.otpExpires < Date.now()) {
      return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (user.otp !== otp.trim()) {
      user.otpAttempts = (user.otpAttempts || 0) + 1;
      await user.save();
      return res.status(400).json({ success: false, message: `Invalid OTP. ${OTP_LOCKOUT_ATTEMPTS - user.otpAttempts} attempts remaining.` });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    user.otp = undefined;
    user.otpExpires = undefined;
    user.otpAttempts = 0;
    await user.save();

    console.log(`[AUTH] Password reset successful for: ${normalizedEmail}`);
    res.status(200).json({ success: true, message: 'Password reset successfully. Please log in.' });

  } catch (err) {
    console.error('[AUTH] Reset password error:', err.message);
    res.status(500).json({ success: false, message: 'Server error. Please try again later.' });
  }
});

// ─────────────────────────────────────────────
// GET /api/auth/me — full user profile
// ─────────────────────────────────────────────
router.get('/me', async (req, res) => {
  const token = req.cookies['crip-token'];
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, SECRET);
    const user = await User.findById(decoded.userId).select('-password -otp -otpExpires -otpAttempts');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.status(200).json({
      success: true,
      name: user.name,
      email: user.email,
      organization: user.organization,
      industry: user.industry
    });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
});

// ─────────────────────────────────────────────
// PUT /api/auth/profile — update profile
// ─────────────────────────────────────────────
router.put('/profile', async (req, res) => {
  const token = req.cookies['crip-token'];
  if (!token) return res.status(401).json({ success: false, message: 'Unauthorized' });

  try {
    const decoded = jwt.verify(token, SECRET);
    const { name, organization, industry } = req.body;

    const user = await User.findById(decoded.userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (name) user.name = name;
    if (organization) user.organization = organization;
    if (industry) user.industry = industry;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        name: user.name,
        email: user.email,
        organization: user.organization,
        industry: user.industry
      }
    });
  } catch (err) {
    console.error('[AUTH] Profile update error:', err);
    res.status(500).json({ success: false, message: 'Server error while updating profile.' });
  }
});

// ─────────────────────────────────────────────
// GET /api/auth/verify-session
// ─────────────────────────────────────────────
router.get('/verify-session', (req, res) => {
  const token = req.cookies['crip-token'];

  if (!token) {
    return res.status(401).json({ success: false, message: 'No session found. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, SECRET);
    res.status(200).json({ success: true, user: decoded });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Session expired. Please log in again.' });
  }
});

// ─────────────────────────────────────────────
// POST /api/auth/logout
// ─────────────────────────────────────────────
router.post('/logout', (req, res) => {
  res.clearCookie('crip-token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  });
  res.status(200).json({ success: true, message: 'Logged out successfully.' });
});

module.exports = router;
