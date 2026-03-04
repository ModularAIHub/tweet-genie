import moment from 'moment-timezone';

console.log('\n=== Testing moment-timezone behavior ===\n');

// Test IST timezone
const userTz = 'Asia/Kolkata'; // IST = UTC+5:30
const hour = 8;

console.log(`Target: ${hour}:00 AM in ${userTz}`);
console.log(`Expected UTC: 2:30 AM UTC (8:00 AM IST - 5:30 = 2:30 AM UTC)\n`);

// Method 1: Current implementation
const nowMoment = moment.tz(userTz);
console.log(`Current time in ${userTz}: ${nowMoment.format('YYYY-MM-DD HH:mm:ss Z')}`);

const baseMoment = nowMoment.clone().add(1, 'days'); // Tomorrow
console.log(`Base moment (tomorrow): ${baseMoment.format('YYYY-MM-DD HH:mm:ss Z')}`);

const slotTime = baseMoment.clone().startOf('day').hour(hour).minute(0).second(0).millisecond(0).toDate();
console.log(`\nMethod 1 (current implementation):`);
console.log(`  Result in IST: ${moment(slotTime).tz(userTz).format('YYYY-MM-DD HH:mm:ss Z')}`);
console.log(`  Result in UTC: ${moment(slotTime).utc().format('YYYY-MM-DD HH:mm:ss Z')}`);
console.log(`  ISO String: ${slotTime.toISOString()}`);
console.log(`  Hour in IST: ${moment(slotTime).tz(userTz).hour()}`);
console.log(`  Minute in IST: ${moment(slotTime).tz(userTz).minute()}`);

// Check if it's exactly 8:00 AM IST
const resultHour = moment(slotTime).tz(userTz).hour();
const resultMinute = moment(slotTime).tz(userTz).minute();
console.log(`  ✓ Correct: ${resultHour === 8 && resultMinute === 0 ? 'YES' : 'NO'}`);

// Now test with current time to see if there's a timing issue
console.log(`\n=== Testing with actual current time ===`);
const now = moment.tz(userTz);
console.log(`Now: ${now.format('YYYY-MM-DD HH:mm:ss Z')}`);

// Try to create a slot for today at hour 8
const todaySlot = now.clone().startOf('day').hour(8).minute(0).second(0).millisecond(0).toDate();
console.log(`Today at 8 AM IST:`);
console.log(`  In IST: ${moment(todaySlot).tz(userTz).format('YYYY-MM-DD HH:mm:ss Z')}`);
console.log(`  In UTC: ${moment(todaySlot).utc().format('YYYY-MM-DD HH:mm:ss Z')}`);
console.log(`  ISO: ${todaySlot.toISOString()}`);
