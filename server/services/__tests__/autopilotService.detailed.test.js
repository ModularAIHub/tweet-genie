/**
 * Detailed Investigation of Timezone Bug
 * 
 * This test investigates the exact behavior of the createSlotDate function
 * to understand if and when the bug manifests.
 */

import moment from 'moment-timezone';

/**
 * Replicate the current implementation
 */
function createSlotDate_current(baseMoment, hour) {
  return baseMoment.clone().startOf('day').hour(hour).minute(0).second(0).millisecond(0).toDate();
}

describe('Detailed Timezone Investigation', () => {
  test('Investigate IST timezone behavior in detail', () => {
    const userTz = 'Asia/Kolkata'; // IST = UTC+5:30
    const hour = 8;
    
    // Create a base moment in IST
    const baseMoment = moment.tz(userTz);
    console.log('\n=== IST Timezone Investigation ===');
    console.log('Base moment:', baseMoment.format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('Base moment timezone:', baseMoment.tz());
    
    // Step by step transformation
    const step1 = baseMoment.clone();
    console.log('\nStep 1 - clone():', step1.format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('Timezone:', step1.tz());
    
    const step2 = step1.startOf('day');
    console.log('\nStep 2 - startOf(day):', step2.format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('Timezone:', step2.tz());
    
    const step3 = step2.hour(hour);
    console.log('\nStep 3 - hour(8):', step3.format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('Timezone:', step3.tz());
    
    const step4 = step3.minute(0);
    console.log('\nStep 4 - minute(0):', step4.format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('Timezone:', step4.tz());
    
    const step5 = step4.second(0).millisecond(0);
    console.log('\nStep 5 - second(0).millisecond(0):', step5.format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('Timezone:', step5.tz());
    
    const finalDate = step5.toDate();
    console.log('\nStep 6 - toDate():', finalDate);
    console.log('Date in IST:', moment(finalDate).tz(userTz).format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('Date in UTC:', moment(finalDate).utc().format('YYYY-MM-DD HH:mm:ss Z'));
    
    // Check the result
    const resultInIST = moment(finalDate).tz(userTz);
    console.log('\n=== Final Result ===');
    console.log('Hour:', resultInIST.hour());
    console.log('Minute:', resultInIST.minute());
    console.log('Expected: 8:00');
    console.log('Match:', resultInIST.hour() === 8 && resultInIST.minute() === 0);
  });

  test('Compare with alternative implementation', () => {
    const userTz = 'Asia/Kolkata';
    const hour = 8;
    
    const baseMoment = moment.tz(userTz);
    
    console.log('\n=== Comparing Implementations ===');
    
    // Current implementation
    const current = createSlotDate_current(baseMoment, hour);
    console.log('\nCurrent implementation:');
    console.log('IST:', moment(current).tz(userTz).format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('UTC:', moment(current).utc().format('YYYY-MM-DD HH:mm:ss Z'));
    
    // Alternative 1: Using moment.tz with array
    const year = baseMoment.year();
    const month = baseMoment.month();
    const date = baseMoment.date();
    const alt1 = moment.tz([year, month, date, hour, 0, 0, 0], userTz).toDate();
    console.log('\nAlternative 1 (moment.tz with array):');
    console.log('IST:', moment(alt1).tz(userTz).format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('UTC:', moment(alt1).utc().format('YYYY-MM-DD HH:mm:ss Z'));
    
    // Alternative 2: Using format and parse
    const alt2 = moment.tz(baseMoment.format('YYYY-MM-DD'), userTz)
      .hour(hour)
      .minute(0)
      .second(0)
      .millisecond(0)
      .toDate();
    console.log('\nAlternative 2 (format and parse):');
    console.log('IST:', moment(alt2).tz(userTz).format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('UTC:', moment(alt2).utc().format('YYYY-MM-DD HH:mm:ss Z'));
    
    // Check if they're all the same
    console.log('\n=== Comparison ===');
    console.log('Current === Alt1:', current.getTime() === alt1.getTime());
    console.log('Current === Alt2:', current.getTime() === alt2.getTime());
    console.log('Alt1 === Alt2:', alt1.getTime() === alt2.getTime());
  });

  test('Test with specific date that might trigger DST issues', () => {
    const userTz = 'Asia/Kolkata';
    const hour = 8;
    
    // IST doesn't have DST, but let's test with a specific date anyway
    const specificDate = moment.tz('2024-03-15', userTz);
    
    console.log('\n=== Testing with Specific Date ===');
    console.log('Test date:', specificDate.format('YYYY-MM-DD'));
    
    const result = createSlotDate_current(specificDate, hour);
    const resultInIST = moment(result).tz(userTz);
    
    console.log('Result in IST:', resultInIST.format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('Result in UTC:', moment(result).utc().format('YYYY-MM-DD HH:mm:ss Z'));
    console.log('Hour:', resultInIST.hour());
    console.log('Minute:', resultInIST.minute());
  });
});
