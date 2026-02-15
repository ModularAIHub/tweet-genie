import express from 'express';
import { creditService } from '../services/creditService.js';
import { TeamCreditService } from '../services/teamCreditService.js';

const router = express.Router();

// Get credit balance and usage
router.get('/balance', async (req, res) => {
  try {
    const userId = req.user.id;
    const requestTeamId = req.headers['x-team-id'] || null;
    const { credits, source } = await TeamCreditService.getCredits(userId, requestTeamId);
    const balance = Number.parseFloat(credits || 0);
    
    res.json({
      balance,
      creditsRemaining: balance,
      source,
      scope: source === 'team' ? 'team' : 'personal',
      teamId: source === 'team' ? requestTeamId : null,
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

// Refund credits (for failed operations)
router.post('/refund', async (req, res) => {
  try {
    const userId = req.user.id;
    const { amount, reason, transaction_type } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid refund amount' });
    }

    if (!reason) {
      return res.status(400).json({ error: 'Refund reason is required' });
    }

    // Get JWT token for platform API call
    let userToken = req.cookies?.accessToken;
    if (!userToken) {
      const authHeader = req.headers['authorization'];
      userToken = authHeader && authHeader.split(' ')[1];
    }

    const result = await creditService.refundCredits(userId, transaction_type || 'refund', amount, userToken);

    res.json({
      success: true,
      refunded_amount: amount,
      new_balance: result.new_balance,
      transaction_id: result.transaction_id
    });

  } catch (error) {
    console.error('Refund credits error:', error);
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

export default router;
