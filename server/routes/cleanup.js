// cleanup.js
// Routes for cleaning up Twitter data when users/teams are deleted

import express from 'express';
import { cleanupController } from '../controllers/cleanupController.js';

const router = express.Router();

// Clean up user's Twitter data
router.post('/user', cleanupController.cleanupUserData);

// Clean up team's Twitter data
router.post('/team', cleanupController.cleanupTeamData);

// Clean up member's Twitter data when leaving/removed from team
router.post('/member', cleanupController.cleanupMemberData);

export default router;
