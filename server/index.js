import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
// import cron from 'node-cron';

// Route imports
import authRoutes from './routes/auth.js';
import secureAuthRoutes from './routes/secure-auth.js';
import ssoRoutes from './routes/sso.js';
import twitterRoutes from './routes/twitter.js';
import tweetsRoutes from './routes/tweets.js';
import schedulingRoutes from './routes/scheduling.js';
import analyticsRoutes from './routes/analytics.js';
import creditsRoutes from './routes/credits.js';
import providersRoutes from './routes/providers.js';
import aiRoutes from './routes/ai.js';
import imageGenerationRoutes from './routes/imageGeneration.js';
import teamRoutes from './routes/team.js';

// Middleware imports
import { authenticateToken } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';

// Service imports
// import { scheduledTweetService } from './services/scheduledTweetService.js';

dotenv.config();

import proTeamRoutes from './routes/proTeam.js';
const app = express();
const PORT = process.env.PORT || 3002;

// Basic middleware with CSP configuration for development
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "http://localhost:*", "https://api.twitter.com", "https://upload.twitter.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      fontSrc: ["'self'", "https:", "data:"],
    },
  },
}));

// CORS configuration with both production and development origins
const allowedOrigins = [
  'https://suitegenie.in',
  'https://tweet.suitegenie.in',
  'https://api.suitegenie.in',
  'https://tweetapi.suitegenie.in',
];

// Add development origins if in development mode
if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
  allowedOrigins.push(
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
    'http://localhost:3002'
  );
}

console.log('📍 Allowed CORS origins:', allowedOrigins);
console.log('🌍 NODE_ENV:', process.env.NODE_ENV);

// Simplified CORS for development
if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
  console.log('� Development mode - allowing all localhost origins');
  app.use(cors({
    origin: true, // Allow all origins in development
    credentials: true
  }));
app.use('/api/pro-team', authenticateToken, proTeamRoutes);
} else {
  app.use(cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);
      
      console.log('🔍 Production - checking origin:', origin);
      
      if (allowedOrigins.indexOf(origin) !== -1) {
        console.log('✅ Origin allowed:', origin);
        return callback(null, true);
      } else {
        console.log('❌ CORS blocked origin:', origin);
        return callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
    exposedHeaders: ['Set-Cookie']
  }));
}
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'Tweet Genie' });
});

// CSRF token endpoint (for frontend compatibility)
app.get('/api/csrf-token', (req, res) => {
  res.json({ 
    csrfToken: 'dummy-csrf-token',
    message: 'CSRF protection not implemented in Tweet Genie' 
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/auth', secureAuthRoutes);
app.use('/', ssoRoutes); // SSO routes at root level

// Twitter routes with conditional authentication
app.use('/api/twitter', (req, res, next) => {
  // Public OAuth endpoints that don't need authentication
  const publicEndpoints = [
    '/team-connect',
    '/team-connect-oauth1', 
    '/callback',
    '/connect',
    '/connect-oauth1',
    '/test-team-accounts'
  ];
  
  // Check if this is a public endpoint
  const isPublicEndpoint = publicEndpoints.some(endpoint => req.path === endpoint);
  
  if (isPublicEndpoint) {
    // Skip authentication for public OAuth endpoints
    console.log(`🔓 Public endpoint accessed: ${req.path}`);
    next();
  } else {
    // Apply authentication for all other endpoints
    console.log(`🔐 Protected endpoint accessed: ${req.path}`);
    authenticateToken(req, res, next);
  }
}, twitterRoutes);
app.use('/api/tweets', authenticateToken, tweetsRoutes);
app.use('/api/scheduling', authenticateToken, schedulingRoutes);
app.use('/api/analytics', authenticateToken, analyticsRoutes);
app.use('/api/credits', authenticateToken, creditsRoutes);
app.use('/api/providers', authenticateToken, providersRoutes);
app.use('/api/ai', authenticateToken, aiRoutes);
app.use('/api/image-generation', authenticateToken, imageGenerationRoutes);
app.use('/imageGeneration', authenticateToken, imageGenerationRoutes);
app.use('/api/team', authenticateToken, teamRoutes);

// Error handling
app.use((err, req, res, next) => {
  // Add CORS headers even on errors
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  // Delegate to the original error handler
  errorHandler(err, req, res, next);
});


// Start BullMQ worker for scheduled tweets
import './workers/scheduledTweetWorker.js';

app.listen(PORT, () => {
  console.log(`Tweet Genie server running on port ${PORT}`);
});