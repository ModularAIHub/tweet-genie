import express from 'express';
import { authenticateToken } from '../middleware/auth.js';
import { getTeamSocialAccounts, getTeamAccountCredentials, disconnectTeamTwitterAccount } from '../controllers/proTeamController.js';

const router = express.Router();

// Get team social accounts (Twitter accounts with OAuth credentials)
router.get('/social-accounts', authenticateToken, getTeamSocialAccounts);

// Get team account credentials info
router.get('/accounts/:accountId/credentials', authenticateToken, getTeamAccountCredentials);

// Disconnect a team Twitter account
router.delete('/social-accounts/:accountId', authenticateToken, disconnectTeamTwitterAccount);

export default router;