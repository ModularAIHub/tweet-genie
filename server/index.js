import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import cron from 'node-cron';

// Route imports
import authRoutes from './routes/auth.js';
import twitterRoutes from './routes/twitter.js';
import tweetsRoutes from './routes/tweets.js';
import schedulingRoutes from './routes/scheduling.js';
import analyticsRoutes from './routes/analytics.js';
import creditsRoutes from './routes/credits.js';
import providersRoutes from './routes/providers.js';

// Middleware imports
import { authenticateToken } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';

// Service imports
import { scheduledTweetService } from './services/scheduledTweetService.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3002;

// Basic middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5174',
  credentials: true
}));
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

// Error handling
app.use(errorHandler);

// Schedule tweet posting job (runs every minute)
cron.schedule('* * * * *', async () => {
  try {
    await scheduledTweetService.processScheduledTweets();
  } catch (error) {
    console.error('Error processing scheduled tweets:', error);
  }
});

app.listen(PORT, () => {
  console.log(`Tweet Genie server running on port ${PORT}`);
});
