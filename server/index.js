import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
// import cron from 'node-cron';

// Route imports
import authRoutes from './routes/auth.js';
import twitterRoutes from './routes/twitter.js';
import tweetsRoutes from './routes/tweets.js';
import schedulingRoutes from './routes/scheduling.js';
import analyticsRoutes from './routes/analytics.js';
import creditsRoutes from './routes/credits.js';
import providersRoutes from './routes/providers.js';
import aiRoutes from './routes/ai.js';
import imageGenerationRoutes from './routes/imageGeneration.js';

// Middleware imports
import { authenticateToken } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';

// Service imports
// import { scheduledTweetService } from './services/scheduledTweetService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// Basic middleware
app.use(helmet());

// CORS configuration with both production and development origins
const allowedOrigins = [
  'https://suitegenie.in',
  'https://api.suitegenie.in',
  'https://tweet.suitegenie.in'
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

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', service: 'Tweet Genie' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/twitter', authenticateToken, twitterRoutes);
app.use('/api/tweets', authenticateToken, tweetsRoutes);
app.use('/api/scheduling', authenticateToken, schedulingRoutes);
app.use('/api/analytics', authenticateToken, analyticsRoutes);
app.use('/api/credits', authenticateToken, creditsRoutes);
app.use('/api/providers', authenticateToken, providersRoutes);
app.use('/api/ai', authenticateToken, aiRoutes);
app.use('/api/image-generation', authenticateToken, imageGenerationRoutes);
app.use('/imageGeneration', authenticateToken, imageGenerationRoutes);

// Error handling
app.use(errorHandler);


// Start BullMQ worker for scheduled tweets
import './workers/scheduledTweetWorker.js';

app.listen(PORT, () => {
  console.log(`Tweet Genie server running on port ${PORT}`);
});