/**
 * Integration Test for Autopilot Timezone Bug
 * 
 * This test calls the actual getNextOptimalPostingTime function
 * to see if the bug manifests in the full integration.
 */

import moment from 'moment-timezone';

// Mock the database before importing the service
const mockQuery = async (query, params) => {
  // Return empty results for all queries (no conflicts)
  return { rows: [] };
};

// Create a mock pool
const mockPool = {
  query: mockQuery
};

// Mock the database module
global.pool = mockPool;

// Mock the database import
const originalImport = await import('module');
const Module = originalImport.default;
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  if (id === '../../config/database.js' || id.endsWith('config/database.js')) {
    return { default: mockPool };
  }
  return originalRequire.apply(this, arguments);
};

// Now import the service
const autopilotService = await import('../autopilotService.js');
const { getNextOptimalPostingTime } = autopilotService;

describe('Integration: Autopilot Timezone Bug', () => {
  test('IST (UTC+5:30) - Should schedule at 8:00 AM IST when custom hour is 8', async () => {
    const config = {
      timezone: 'Asia/Kolkata', // IST = UTC+5:30
      use_optimal_times: false,
      custom_posting_hours: [8],
      posts_per_day: 1
    };

    const strategyId = 'test-strategy-123';
    
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
