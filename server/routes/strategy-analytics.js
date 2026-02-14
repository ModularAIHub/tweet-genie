// Strategy Analytics Routes for Strategy Builder
import express from 'express';
import * as analyticsService from '../services/analyticsService.js';
import pool from '../config/database.js';

const router = express.Router();

/**
 * GET /api/strategy-analytics/:strategyId/dashboard
 * Get analytics dashboard for a strategy
 */
router.get('/:strategyId/dashboard', async (req, res) => {
  try {
    const { strategyId } = req.params;
    const days = parseInt(req.query.days) || 30;
    
    // Verify strategy belongs to user
    const { rows } = await pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const dashboard = await analyticsService.getAnalyticsDashboard(strategyId, days);
    
    res.json({
      success: true,
      data: dashboard
    });
  } catch (error) {
    console.error('Error fetching analytics dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

/**
 * GET /api/strategy-analytics/:strategyId/insights
 * Get content performance insights
 */
router.get('/:strategyId/insights', async (req, res) => {
  try {
    const { strategyId } = req.params;
    
    // Verify strategy belongs to user
    const { rows } = await pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const insights = await analyticsService.getContentInsights(strategyId);
    
    res.json({
      success: true,
      data: insights
    });
  } catch (error) {
    console.error('Error fetching content insights:', error);
    res.status(500).json({ error: 'Failed to fetch insights' });
  }
});

/**
 * GET /api/strategy-analytics/:strategyId/optimal-times
 * Get recommended posting times
 */
router.get('/:strategyId/optimal-times', async (req, res) => {
  try {
    const { strategyId } = req.params;
    
    // Verify strategy belongs to user
    const { rows } = await pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const times = await analyticsService.getRecommendedPostingTimes(strategyId);
    
    res.json({
      success: true,
      data: times
    });
  } catch (error) {
    console.error('Error fetching optimal posting times:', error);
    res.status(500).json({ error: 'Failed to fetch optimal times' });
  }
});

/**
 * POST /api/strategy-analytics/:strategyId/calculate
 * Trigger analytics calculation for a period
 */
router.post('/:strategyId/calculate', async (req, res) => {
  try {
    const { strategyId } = req.params;
    const { startDate, endDate } = req.body;
    
    // Verify strategy belongs to user
    const { rows } = await pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    
    const analytics = await analyticsService.generateStrategyAnalytics(strategyId, start, end);
    await analyticsService.calculateOptimalPostingTimes(strategyId);
    
    res.json({
      success: true,
      message: 'Analytics calculated successfully',
      data: analytics
    });
  } catch (error) {
    console.error('Error calculating analytics:', error);
    res.status(500).json({ error: 'Failed to calculate analytics' });
  }
});

export default router;
