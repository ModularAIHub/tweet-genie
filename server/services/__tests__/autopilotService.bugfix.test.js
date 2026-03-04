/**
 * Bug Condition Exploration Test for Autopilot Timezone Fix
 * 
 * **Validates: Requirements 1.1, 1.2, 2.1, 2.2, 2.3**
 * 
 * This test explores the bug condition where timezones with non-zero minute offsets
 * (e.g., IST = UTC+5:30, NPT = UTC+5:45, ACST = UTC+9:30) were hypothesized to cause 
 * incorrect scheduling.
 * 
 * **FINDING**: The current implementation is working correctly. The bug does NOT exist.
 * 
 * **ANALYSIS**: 
 * - The current code `baseMoment.clone().startOf('day').hour(hour).minute(0).second(0).millisecond(0).toDate()`
 *   correctly produces 8:00 AM IST (2:30 AM UTC) when given hour=8 and IST timezone
 * - All timezone manipulations preserve the timezone context correctly
 * - The moment-timezone library handles non-zero minute offsets correctly in this implementation
 * 
 * **CONCLUSION**: Either the bug was already fixed, or the root cause hypothesis was incorrect.
 * The user should verify if there's a specific scenario or user report that demonstrates the bug.
 */

import fc from 'fast-check';
import moment from 'moment-timezone';

/**
 * Test the createSlotDate logic directly by replicating it here
 * This is the CURRENT implementation (which appears to be working correctly)
 */
function createSlotDate_current(baseMoment, hour) {
  return baseMoment.clone().startOf('day').hour(hour).minute(0).second(0).millisecond(0).toDate();
}

/**
 * Helper to check if a Date object represents the correct hour in a timezone
 */
function checkTimeInTimezone(date, timezone, expectedHour) {
  const momentInTz = moment(date).tz(timezone);
  return {
    hour: momentInTz.hour(),
    minute: momentInTz.minute(),
    second: momentInTz.second(),
    formatted: momentInTz.format('YYYY-MM-DD HH:mm:ss Z'),
    utcFormatted: moment(date).utc().format('YYYY-MM-DD HH:mm:ss Z')
  };
}

describe('Bug Condition Exploration: Timezone with Non-Zero Minute Offsets', () => {
  /**
   * Property 1: Fault Condition - Correct Hour Scheduling for Non-Zero Minute Offset Timezones
   * 
   * For timezones with non-zero minute offsets (IST, NPT, ACST), the scheduled time
   * should be at exactly the specified hour and 0 minutes in the user's timezone.
   * 
   * **Scoped PBT Approach**: Test concrete cases with IST, NPT, ACST timezones
   * and various hours.
   * 
   * **RESULT**: All tests PASS - the current implementation is working correctly.
   * 
   * NOTE: We test the createSlotDate logic directly by replicating it here
   */
  describe('Property 1: Correct Hour Scheduling for Non-Zero Minute Offset Timezones', () => {
    
    test('IST (UTC+5:30) - 8 AM schedules at 8:00 AM IST (PASSING - bug does not exist)', () => {
      const userTz = 'Asia/Kolkata'; // IST = UTC+5:30
      const hour = 8;
      
      // Create a base moment in the user's timezone (today)
      const baseMoment = moment.tz(userTz);
      
      // Execute the current createSlotDate logic
      const result = createSlotDate_current(baseMoment, hour);
      
      // Debug: Log the actual times
      const timeInfo = checkTimeInTimezone(result, userTz, hour);
      console.log('IST Test - Expected: 8:00 AM IST, Got:', timeInfo);
      
      // Verify: The scheduled time should be exactly 8:00 AM in IST
      const resultInIST = moment(result).tz(userTz);
      
      expect(resultInIST.hour()).toBe(8);
      expect(resultInIST.minute()).toBe(0);
      expect(resultInIST.second()).toBe(0);
    });

    test('NPT (UTC+5:45) - 10 AM schedules at 10:00 AM NPT (PASSING - bug does not exist)', () => {
      const userTz = 'Asia/Kathmandu'; // NPT = UTC+5:45
      const hour = 10;
      
      // Create a base moment in the user's timezone (today)
      const baseMoment = moment.tz(userTz);
      
      // Execute the current createSlotDate logic
      const result = createSlotDate_current(baseMoment, hour);
      
      // Verify: The scheduled time should be exactly 10:00 AM in NPT
      const resultInNPT = moment(result).tz(userTz);
      
      expect(resultInNPT.hour()).toBe(10);
      expect(resultInNPT.minute()).toBe(0);
      expect(resultInNPT.second()).toBe(0);
    });

    test('ACST (UTC+9:30) - 5 PM schedules at 5:00 PM ACST (PASSING - bug does not exist)', () => {
      const userTz = 'Australia/Adelaide'; // ACST = UTC+9:30
      const hour = 17;
      
      // Create a base moment in the user's timezone (today)
      const baseMoment = moment.tz(userTz);
      
      // Execute the current createSlotDate logic
      const result = createSlotDate_current(baseMoment, hour);
      
      // Verify: The scheduled time should be exactly 5:00 PM in ACST
      const resultInACST = moment(result).tz(userTz);
      
      expect(resultInACST.hour()).toBe(17);
      expect(resultInACST.minute()).toBe(0);
      expect(resultInACST.second()).toBe(0);
    });

    test('Property-based: Multiple hours in IST all schedule at correct hour:00 (PASSING)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 23 }), // Generate random hours 0-23
          (hour) => {
            const userTz = 'Asia/Kolkata'; // IST = UTC+5:30
            
            // Create a base moment in the user's timezone (today)
            const baseMoment = moment.tz(userTz);
            
            // Execute the current createSlotDate logic
            const result = createSlotDate_current(baseMoment, hour);
            
            // Verify: The scheduled time should be exactly at the specified hour in IST
            const resultInIST = moment(result).tz(userTz);
            
            // The hour should match exactly
            expect(resultInIST.hour()).toBe(hour);
            // Minutes should be 0
            expect(resultInIST.minute()).toBe(0);
            // Seconds should be 0
            expect(resultInIST.second()).toBe(0);
          }
        ),
        { numRuns: 24 } // Test all 24 hours
      );
    });

    test('Property-based: Multiple timezones with non-zero minute offsets (PASSING)', () => {
      // Timezones with non-zero minute offsets
      const timezonesWithMinuteOffsets = [
        { tz: 'Asia/Kolkata', name: 'IST', offset: '+5:30' },
        { tz: 'Asia/Kathmandu', name: 'NPT', offset: '+5:45' },
        { tz: 'Australia/Adelaide', name: 'ACST', offset: '+9:30' },
        { tz: 'Asia/Yangon', name: 'MMT', offset: '+6:30' },
        { tz: 'Australia/Darwin', name: 'ACST', offset: '+9:30' }
      ];

      fc.assert(
        fc.property(
          fc.constantFrom(...timezonesWithMinuteOffsets),
          fc.integer({ min: 0, max: 23 }),
          (timezoneInfo, hour) => {
            // Create a base moment in the user's timezone (today)
            const baseMoment = moment.tz(timezoneInfo.tz);
            
            // Execute the current createSlotDate logic
            const result = createSlotDate_current(baseMoment, hour);
            
            // Verify: The scheduled time should be exactly at the specified hour
            const resultInTz = moment(result).tz(timezoneInfo.tz);
            
            // The hour should match exactly
            expect(resultInTz.hour()).toBe(hour);
            // Minutes should be 0
            expect(resultInTz.minute()).toBe(0);
            // Seconds should be 0
            expect(resultInTz.second()).toBe(0);
          }
        ),
        { numRuns: 50 } // Test 50 random combinations
      );
    });
  });
});
