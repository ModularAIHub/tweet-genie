import express from 'express';
import { getTeamSocialAccounts } from '../controllers/proTeamController.js';

const router = express.Router();

// Real implementation for /social-accounts
router.get('/social-accounts', getTeamSocialAccounts);

export default router;
