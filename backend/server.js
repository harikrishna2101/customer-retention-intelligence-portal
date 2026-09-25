// ─────────────────────────────────────────────
// MUST BE FIRST LINE — loads all .env variables
// ─────────────────────────────────────────────
require('dotenv').config();

// Initialize CRON Recalibrations
require('./cron');

const express = require('express');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const http = require('http');
const { Server } = require('socket.io');
const { doubleCsrf } = require('csrf-csrf');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const contactRoutes = require('./routes/contact');
const dataRoutes = require('./routes/data');
const growRoutes = require('./routes/grow');

const app = express();
const PORT = process.env.PORT || 5000;
const server = http.createServer(app);
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5000,http://127.0.0.1:5000')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (origin.includes('onrender.com')) return true;
  return allowedOrigins.includes(origin);
}

// ─────────────────────────────────────────────
// WebSockets Setup
// ─────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      if (isAllowedOrigin(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
  }
});
app.set('io', io);

// ─────────────────────────────────────────────
// Rate Limiter Setup
// ─────────────────────────────────────────────
app.set('trust proxy', 1); // Trust the first proxy (Render)
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 mins
    max: 20, // 20 requests
    message: { success: false, message: "Too many authentication requests, please try again." }
});

const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  getSecret: () => process.env.CSRF_SECRET || process.env.JWT_SECRET,
  getSessionIdentifier: (req) => req.cookies['crip-token'] || 'anonymous',
  cookieName: isProduction ? '__Host-crip.csrf-token' : 'crip.csrf-token',
  cookieOptions: {
    sameSite: 'lax',
    path: '/',
    secure: isProduction,
    httpOnly: true
  },
  getCsrfTokenFromRequest: (req) => req.headers['x-csrf-token']
});

// ─────────────────────────────────────────────
// CSRF Setup
// ─────────────────────────────────────────────
// CSRF disabled for local demo — generateToken API changed in csrf-csrf v4
// Production requests with side effects are protected by double-submit CSRF.

// ─────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(mongoSanitize());

// CSRF token endpoint
app.get('/api/csrf-token', (req, res) => {
    return res.json({ csrfToken: generateCsrfToken(req, res) });
});

// CORS — allow both localhost and 127.0.0.1 on any Live Server port
app.use(cors({
  origin: function (origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Serve static frontend files (HTML, CSS, JS) from the root directory
app.use(express.static(path.join(__dirname, '..')));

// ─────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/verify-otp', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/contact', contactRoutes);

// Apply CSRF protection only to authenticated endpoints
if (isProduction) {
  app.use(doubleCsrfProtection);
}

app.use('/api/data', dataRoutes);
app.use('/api/grow', growRoutes);

// ─────────────────────────────────────────────
// Catch-all: serve frontend for any unknown route
// ─────────────────────────────────────────────
app.get('*', (req, res) => {
  res.status(404).sendFile(path.join(__dirname, '..', '404.html'));
});

// ─────────────────────────────────────────────
// Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN' || err.message === 'invalid csrf token') {
    return res.status(403).json({ success: false, message: 'Invalid CSRF token. Please refresh the page and try again.' });
  }
  next(err);
});

// ─────────────────────────────────────────────
// MongoDB Connection → then Start Server
// ─────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log('[DB] MongoDB connected successfully.');
    server.listen(PORT, () => {
      console.log(`[SERVER] CRIP Enterprise Interface Live on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[DB] MongoDB connection FAILED:', err.message);
    process.exit(1); // Stop the server if DB fails — don't run with broken state
  });
