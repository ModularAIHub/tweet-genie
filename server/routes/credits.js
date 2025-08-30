import express from 'express';
import { creditService } from '../services/creditService.js';

const router = express.Router();

// Get credit balance and usage
router.get('/balance', async (req, res) => {
  try {
    const userId = req.user.id;
    
    const balance = await creditService.getBalance(userId);
    
    res.json({
      balance: balance.available,
      total_earned: balance.total_earned,
      total_used: balance.total_used,
      last_updated: balance.last_updated
    });

  } catch (error) {
    console.error('Get credit balance error:', error);
    res.status(500).json({ error: 'Failed to fetch credit balance' });
  }
});

// Get credit usage history
router.get('/history', async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 20, type } = req.query;

    const history = await creditService.getUsageHistory(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      type
    });

    res.json(history);

  } catch (error) {
    console.error('Get credit history error:', error);
    res.status(500).json({ error: 'Failed to fetch credit history' });
  }
});

// Get credit pricing/costs
router.get('/pricing', async (req, res) => {
  try {
    const pricing = {
      tweet_post: 1,
      tweet_with_media: 2,
      ai_generation: 2,
      thread_post: 1, // per tweet in thread
      scheduling: 0, // free
      analytics_sync: 0 // free
    };

    res.json({ pricing });

  } catch (error) {
    console.error('Get pricing error:', error);
    res.status(500).json({ error: 'Failed to fetch pricing information' });
  }
});

export default router;
