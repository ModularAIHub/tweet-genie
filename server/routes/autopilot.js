// Auto-Pilot Routes for Strategy Builder
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import * as autopilotService from '../services/autopilotService.js';

const router = express.Router();

/**
 * GET /api/strategy/autopilot/:strategyId/config
 * Get autopilot configuration
 */
router.get('/:strategyId/config', authenticateToken, async (req, res) => {
  try {
    const { strategyId } = req.params;
    
    // Verify strategy belongs to user
    const { rows } = await req.app.locals.pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const config = await autopilotService.getAutopilotConfig(strategyId);
    
    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    console.error('Error fetching autopilot config:', error);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

/**
 * PUT /api/strategy/autopilot/:strategyId/config
 * Update autopilot configuration
 */
router.put('/:strategyId/config', authenticateToken, async (req, res) => {
  try {
    const { strategyId } = req.params;
    const updates = req.body;
    
    // Verify strategy belongs to user
    const { rows } = await req.app.locals.pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const config = await autopilotService.updateAutopilotConfig(strategyId, updates);
    
    // If autopilot was just enabled, fill the queue
    if (updates.is_enabled === true) {
      autopilotService.fillQueue(strategyId).catch(err => {
        console.error('Error filling queue after enabling autopilot:', err);
      });
    }
    
    res.json({
      success: true,
      message: 'Configuration updated successfully',
      data: config
    });
  } catch (error) {
    console.error('Error updating autopilot config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * GET /api/strategy/autopilot/:strategyId/queue
 * Get content queue
 */
router.get('/:strategyId/queue', authenticateToken, async (req, res) => {
  try {
    const { strategyId } = req.params;
    const { status, limit } = req.query;
    
    // Verify strategy belongs to user
    const { rows } = await req.app.locals.pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const filters = {};
    if (status) filters.status = status;
    if (limit) filters.limit = parseInt(limit);
    
    const queue = await autopilotService.getQueue(strategyId, filters);
    
    res.json({
      success: true,
      data: queue
    });
  } catch (error) {
    console.error('Error fetching queue:', error);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

/**
 * POST /api/strategy/autopilot/:strategyId/generate
 * Generate new content and add to queue
 */
router.post('/:strategyId/generate', authenticateToken, async (req, res) => {
  try {
    const { strategyId } = req.params;
    const { promptId, scheduledFor, count } = req.body;
    
    // Verify strategy belongs to user
    const { rows } = await req.app.locals.pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const generated = [];
    const generateCount = count || 1;
    
    for (let i = 0; i < generateCount; i++) {
      try {
        const queued = await autopilotService.generateAndQueueContent(strategyId, {
          promptId,
          scheduledFor,
          generationMode: 'manual'
        });
        generated.push(queued);
      } catch (error) {
        console.error(`Error generating content ${i + 1}/${generateCount}:`, error);
      }
    }
    
    res.json({
      success: true,
      message: `Generated ${generated.length} content item(s)`,
      data: generated
    });
  } catch (error) {
    console.error('Error generating content:', error);
    res.status(500).json({ error: 'Failed to generate content' });
  }
});

/**
 * POST /api/strategy/autopilot/:strategyId/fill-queue
 * Fill queue to max capacity
 */
router.post('/:strategyId/fill-queue', authenticateToken, async (req, res) => {
  try {
    const { strategyId } = req.params;
    
    // Verify strategy belongs to user
    const { rows } = await req.app.locals.pool.query(
      'SELECT user_id FROM user_strategies WHERE id = $1',
      [strategyId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Strategy not found' });
    }
    
    const generated = await autopilotService.fillQueue(strategyId);
    
    res.json({
      success: true,
      message: `Queue filled with ${generated.length} new posts`,
      data: generated
    });
  } catch (error) {
    console.error('Error filling queue:', error);
    res.status(500).json({ error: 'Failed to fill queue' });
  }
});

/**
 * POST /api/strategy/autopilot/queue/:queueId/approve
 * Approve queued content
 */
router.post('/queue/:queueId/approve', authenticateToken, async (req, res) => {
  try {
    const { queueId } = req.params;
    
    // Verify queue item belongs to user's strategy
    const { rows } = await req.app.locals.pool.query(
      `SELECT us.user_id 
       FROM strategy_queue sq
       JOIN user_strategies us ON sq.strategy_id = us.id
       WHERE sq.id = $1`,
      [queueId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    
    const updated = await autopilotService.approveQueuedContent(queueId, req.user.userId);
    
    res.json({
      success: true,
      message: 'Content approved',
      data: updated
    });
  } catch (error) {
    console.error('Error approving content:', error);
    res.status(500).json({ error: 'Failed to approve content' });
  }
});

/**
 * POST /api/strategy/autopilot/queue/:queueId/reject
 * Reject queued content
 */
router.post('/queue/:queueId/reject', authenticateToken, async (req, res) => {
  try {
    const { queueId } = req.params;
    const { reason } = req.body;
    
    // Verify queue item belongs to user's strategy
    const { rows } = await req.app.locals.pool.query(
      `SELECT us.user_id 
       FROM strategy_queue sq
       JOIN user_strategies us ON sq.strategy_id = us.id
       WHERE sq.id = $1`,
      [queueId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    
    const updated = await autopilotService.rejectQueuedContent(queueId, req.user.userId, reason);
    
    res.json({
      success: true,
      message: 'Content rejected',
      data: updated
    });
  } catch (error) {
    console.error('Error rejecting content:', error);
    res.status(500).json({ error: 'Failed to reject content' });
  }
});

/**
 * PUT /api/strategy/autopilot/queue/:queueId
 * Edit queued content
 */
router.put('/queue/:queueId', authenticateToken, async (req, res) => {
  try {
    const { queueId } = req.params;
    const { content } = req.body;
    
    if (!content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // Verify queue item belongs to user's strategy
    const { rows } = await req.app.locals.pool.query(
      `SELECT us.user_id 
       FROM strategy_queue sq
       JOIN user_strategies us ON sq.strategy_id = us.id
       WHERE sq.id = $1`,
      [queueId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    
    const updated = await autopilotService.editQueuedContent(queueId, content);
    
    res.json({
      success: true,
      message: 'Content updated',
      data: updated
    });
  } catch (error) {
    console.error('Error editing content:', error);
    res.status(500).json({ error: 'Failed to edit content' });
  }
});

/**
 * DELETE /api/strategy/autopilot/queue/:queueId
 * Delete queued content
 */
router.delete('/queue/:queueId', authenticateToken, async (req, res) => {
  try {
    const { queueId } = req.params;
    
    // Verify queue item belongs to user's strategy
    const { rows } = await req.app.locals.pool.query(
      `SELECT us.user_id 
       FROM strategy_queue sq
       JOIN user_strategies us ON sq.strategy_id = us.id
       WHERE sq.id = $1`,
      [queueId]
    );
    
    if (rows.length === 0 || rows[0].user_id !== req.user.userId) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    
    await req.app.locals.pool.query(
      'DELETE FROM strategy_queue WHERE id = $1',
      [queueId]
    );
    
    res.json({
      success: true,
      message: 'Content deleted'
    });
  } catch (error) {
    console.error('Error deleting content:', error);
    res.status(500).json({ error: 'Failed to delete content' });
  }
});

export default router;
