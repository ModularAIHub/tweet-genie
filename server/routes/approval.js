// approval.js
// Routes for tweet approval workflow
import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { ApprovalController } from '../controllers/approvalController.js';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get pending approvals for teams where user is owner/admin
router.get('/pending', ApprovalController.getPendingApprovals);

// Approve a specific tweet
router.post('/:tweetId/approve', ApprovalController.approveTweet);

// Reject a specific tweet
router.post('/:tweetId/reject', ApprovalController.rejectTweet);

// Bulk approve multiple tweets
router.post('/bulk-approve', ApprovalController.bulkApprove);

export default router;
