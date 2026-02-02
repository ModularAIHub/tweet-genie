// approvalController.js
// Controller for tweet approval workflow (Editor role requires approval)
import pool from '../config/database.js';
import { scheduledTweetQueue } from '../services/queueService.js';

export const ApprovalController = {
  // Get pending scheduled tweets awaiting approval
  async getPendingApprovals(req, res) {
    try {
      const userId = req.user.id;
      
      // Check if user is owner or admin of any team
      const { rows: teams } = await pool.query(`
        SELECT tm.team_id, tm.role, t.name as team_name
        FROM team_members tm
        JOIN teams t ON t.id = tm.team_id
        WHERE tm.user_id = $1 AND tm.role IN ('owner', 'admin')
      `, [userId]);
      
      if (teams.length === 0) {
        return res.status(403).json({ error: 'Only owners and admins can view pending approvals' });
      }
      
      const teamIds = teams.map(t => t.team_id);
      
      // Get all pending scheduled tweets for these teams
      const { rows: pendingTweets } = await pool.query(`
        SELECT 
          st.id,
          st.content,
          st.scheduled_for,
          st.approval_requested_at,
          st.team_id,
          st.thread_tweets,
          u.email as requested_by_email,
          u.name as requested_by_name,
          teams.name as team_name
        FROM scheduled_tweets st
        JOIN users u ON u.id = st.user_id
        JOIN teams ON teams.id = st.team_id
        WHERE st.approval_status = 'pending_approval'
        AND st.team_id = ANY($1)
        ORDER BY st.approval_requested_at DESC
      `, [teamIds]);
      
      res.json({
        success: true,
        pendingTweets,
        teams
      });
      
    } catch (error) {
      console.error('❌ Get pending approvals error:', error);
      res.status(500).json({ error: 'Failed to fetch pending approvals', message: error.message });
    }
  },

  // Approve a scheduled tweet
  async approveTweet(req, res) {
    try {
      const userId = req.user.id;
      const { tweetId } = req.params;
      
      // Get scheduled tweet and check team
      const { rows: tweets } = await pool.query(`
        SELECT st.*, tm.role
        FROM scheduled_tweets st
        JOIN team_members tm ON tm.team_id = st.team_id AND tm.user_id = $1
        WHERE st.id = $2 AND st.approval_status = 'pending_approval'
      `, [userId, tweetId]);
      
      if (tweets.length === 0) {
        return res.status(404).json({ error: 'Tweet not found or already processed' });
      }
      
      const tweet = tweets[0];
      
      // Only owner and admin can approve
      if (tweet.role !== 'owner' && tweet.role !== 'admin') {
        return res.status(403).json({ error: 'Only owners and admins can approve tweets' });
      }
      
      // Approve the tweet
      await pool.query(`
        UPDATE scheduled_tweets 
        SET approval_status = 'approved',
            approved_by = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [userId, tweetId]);
      
      // Add to BullMQ queue with delay
      const delay = Math.max(0, new Date(tweet.scheduled_for).getTime() - Date.now());
      await scheduledTweetQueue.add(
        'scheduled-tweet',
        { scheduledTweetId: tweetId },
        { delay }
      );
      
      res.json({
        success: true,
        message: 'Tweet approved and scheduled successfully',
        tweetId
      });
      
    } catch (error) {
      console.error('❌ Approve tweet error:', error);
      res.status(500).json({ error: 'Failed to approve tweet', message: error.message });
    }
  },

  // Reject a scheduled tweet
  async rejectTweet(req, res) {
    try {
      const userId = req.user.id;
      const { tweetId } = req.params;
      const { reason } = req.body;
      
      // Get scheduled tweet and check team
      const { rows: tweets } = await pool.query(`
        SELECT st.*, tm.role
        FROM scheduled_tweets st
        JOIN team_members tm ON tm.team_id = st.team_id AND tm.user_id = $1
        WHERE st.id = $2 AND st.approval_status = 'pending_approval'
      `, [userId, tweetId]);
      
      if (tweets.length === 0) {
        return res.status(404).json({ error: 'Tweet not found or already processed' });
      }
      
      const tweet = tweets[0];
      
      // Only owner and admin can reject
      if (tweet.role !== 'owner' && tweet.role !== 'admin') {
        return res.status(403).json({ error: 'Only owners and admins can reject tweets' });
      }
      
      // Reject the tweet (set to rejected status and cancelled)
      await pool.query(`
        UPDATE scheduled_tweets 
        SET approval_status = 'rejected',
            status = 'cancelled',
            approved_by = $1,
            rejection_reason = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `, [userId, reason || 'No reason provided', tweetId]);
      
      res.json({
        success: true,
        message: 'Tweet rejected and cancelled',
        tweetId
      });
      
    } catch (error) {
      console.error('❌ Reject tweet error:', error);
      res.status(500).json({ error: 'Failed to reject tweet', message: error.message });
    }
  },

  // Bulk approve multiple scheduled tweets
  async bulkApprove(req, res) {
    try {
      const userId = req.user.id;
      const { tweetIds } = req.body;
      
      if (!Array.isArray(tweetIds) || tweetIds.length === 0) {
        return res.status(400).json({ error: 'Invalid tweet IDs' });
      }
      
      // Get tweets to approve and check permissions
      const { rows: tweetsToApprove } = await pool.query(`
        SELECT st.id, st.scheduled_for
        FROM scheduled_tweets st
        JOIN team_members tm ON st.team_id = tm.team_id
        WHERE st.id = ANY($1)
        AND tm.user_id = $2
        AND tm.role IN ('owner', 'admin')
        AND st.approval_status = 'pending_approval'
      `, [tweetIds, userId]);
      
      if (tweetsToApprove.length === 0) {
        return res.status(403).json({ error: 'No tweets found or insufficient permissions' });
      }
      
      // Approve all tweets
      await pool.query(`
        UPDATE scheduled_tweets st
        SET approval_status = 'approved',
            approved_by = $1,
            updated_at = CURRENT_TIMESTAMP
        FROM team_members tm
        WHERE st.id = ANY($2)
        AND st.team_id = tm.team_id
        AND tm.user_id = $1
        AND tm.role IN ('owner', 'admin')
        AND st.approval_status = 'pending_approval'
      `, [userId, tweetIds]);
      
      // Add all approved tweets to queue
      for (const tweet of tweetsToApprove) {
        const delay = Math.max(0, new Date(tweet.scheduled_for).getTime() - Date.now());
        await scheduledTweetQueue.add(
          'scheduled-tweet',
          { scheduledTweetId: tweet.id },
          { delay }
        );
      }
      
      res.json({
        success: true,
        message: `Approved and scheduled ${tweetsToApprove.length} tweets`,
        approvedCount: tweetsToApprove.length
      });
      
    } catch (error) {
      console.error('❌ Bulk approve error:', error);
      res.status(500).json({ error: 'Failed to bulk approve', message: error.message });
    }
  }
};
