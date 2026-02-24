import { getTwitterPostingPreferences } from '../utils/twitterPostingPreferences.js';
import { TeamCreditService } from '../services/teamCreditService.js';

// Usage: node simulateAiCreditEstimate.mjs [userId] [teamId|null] [isThread]
// Example: node simulateAiCreditEstimate.mjs 385cf442-c3d4-4f63-b62f-8c04257271e4 null false

const argv = process.argv.slice(2);
const userId = argv[0] || '385cf442-c3d4-4f63-b62f-8c04257271e4';
const rawTeamId = argv[1] || null;
const teamId = rawTeamId && rawTeamId !== 'null' ? rawTeamId : null;
const isThread = String(argv[2] || 'false').toLowerCase() === 'true';

(async () => {
  try {
    console.log('Simulating AI credit estimation for:');
    console.log({ userId, teamId, isThread });

    const prefs = await getTwitterPostingPreferences({ userId, accountId: teamId, isTeamAccount: Boolean(teamId) });
    console.log('Posting preferences:', prefs);

    let estimatedThreadCount = 1;
    let estimatedCreditsNeeded = estimatedThreadCount * 1.2;

    if (!isThread && prefs && prefs.x_long_post_enabled) {
      estimatedCreditsNeeded = 5;
    }

    console.log('Estimated credits needed:', estimatedCreditsNeeded);

    const creditCheck = await TeamCreditService.checkCredits(userId, teamId, estimatedCreditsNeeded);
    console.log('Credit availability:', creditCheck);

    process.exit(0);
  } catch (err) {
    console.error('Simulation error:', err?.message || err);
    process.exit(2);
  }
})();
