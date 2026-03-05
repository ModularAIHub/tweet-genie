/**
 * Integration-style test for timezone scheduling.
 * Verifies actual service logic while isolating DB with a deterministic mock.
 */

import { jest } from '@jest/globals';
import moment from 'moment-timezone';

const mockPool = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
};

await jest.unstable_mockModule('../../config/database.js', () => ({
  default: mockPool,
}));

const { getNextOptimalPostingTime } = await import('../autopilotService.js');

describe('Integration: Autopilot Timezone Bug', () => {
  test('IST (UTC+5:30) - Should schedule at 8:00 AM IST when custom hour is 8', async () => {
    const config = {
      timezone: 'Asia/Kolkata', // IST = UTC+5:30
      use_optimal_times: false,
      custom_posting_hours: [8],
      posts_per_day: 1
    };

    const strategyId = '00000000-0000-0000-0000-000000000001';
    
    try {
      const result = await getNextOptimalPostingTime(strategyId, config);
      
      console.log('Result Date:', result);
      console.log('Result in IST:', moment(result).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss Z'));
      console.log('Result in UTC:', moment(result).utc().format('YYYY-MM-DD HH:mm:ss Z'));
      
      const resultInIST = moment(result).tz('Asia/Kolkata');
      
      console.log('Hour:', resultInIST.hour());
      console.log('Minute:', resultInIST.minute());
      
      expect(resultInIST.hour()).toBe(8);
      expect(resultInIST.minute()).toBe(0);
    } catch (error) {
      console.error('Error in test:', error);
      throw error;
    }
  });
});
