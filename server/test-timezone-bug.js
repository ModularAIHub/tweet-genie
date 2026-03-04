#!/usr/bin/env node
/**
 * Test to reproduce the timezone bug
 */

import moment from 'moment-timezone';

const userTz = 'Asia/Kolkata'; // IST = UTC+5:30
const customHours = [8, 12, 18];

console.log('\n=== Testing createSlotDate function ===\n');

function createSlotDate(baseMoment, hour) {
  // Clone the moment, set to start of day, then set the hour and minute to 0
  return baseMoment.clone().startOf('day').hour(hour).minute(0).second(0).millisecond(0).toDate();
}

const nowMoment = moment.tz(userTz);
console.log(`Current time in ${userTz}: ${nowMoment.format('YYYY-MM-DD HH:mm:ss Z')}`);
console.log(`Current time in UTC: ${nowMoment.clone().utc().format('YYYY-MM-DD HH:mm:ss Z')}`);

console.log('\n--- Testing each configured hour ---\n');

for (const hour of customHours) {
  const checkMoment = nowMoment.clone();
  const slotTime = createSlotDate(checkMoment, hour);
  
  // Convert back to moment to display
  const slotMomentInUserTz = moment(slotTime).tz(userTz);
  const slotMomentInUTC = moment(slotTime).utc();
  
  console.log(`Hour ${hour}:`);
  console.log(`  In ${userTz}: ${slotMomentInUserTz.format('YYYY-MM-DD HH:mm:ss Z')}`);
  console.log(`  In UTC: ${slotMomentInUTC.format('YYYY-MM-DD HH:mm:ss Z')}`);
  console.log(`  ISO String: ${slotTime.toISOString()}`);
  console.log(`  JavaScript Date: ${slotTime}`);
  
  // Verify the hour is correct
  const extractedHourInUserTz = slotMomentInUserTz.hour();
  const extractedMinuteInUserTz = slotMomentInUserTz.minute();
  
  if (extractedHourInUserTz === hour && extractedMinuteInUserTz === 0) {
    console.log(`  ✅ CORRECT: Hour is ${hour}:00 in user timezone`);
  } else {
    console.log(`  ❌ WRONG: Expected ${hour}:00, got ${extractedHourInUserTz}:${extractedMinuteInUserTz}`);
  }
  console.log('');
}

console.log('\n=== Testing PostgreSQL EXTRACT behavior ===\n');

// Simulate what PostgreSQL does
for (const hour of customHours) {
  const checkMoment = nowMoment.clone();
  const slotTime = createSlotDate(checkMoment, hour);
  
  // PostgreSQL stores TIMESTAMPTZ in UTC internally
  // When you do EXTRACT(HOUR FROM suggested_time AT TIME ZONE 'Asia/Kolkata')
  // it converts the UTC time to IST and extracts the hour
  
  const slotMomentInUTC = moment(slotTime).utc();
  const slotMomentInUserTz = slotMomentInUTC.clone().tz(userTz);
  
  const extractedHour = slotMomentInUserTz.hour();
  const extractedMinute = slotMomentInUserTz.minute();
  
  console.log(`Configured hour ${hour}:`);
  console.log(`  Stored in DB (UTC): ${slotMomentInUTC.format('YYYY-MM-DD HH:mm:ss')}`);
  console.log(`  EXTRACT(HOUR ... AT TIME ZONE '${userTz}'): ${extractedHour}`);
  console.log(`  EXTRACT(MINUTE ... AT TIME ZONE '${userTz}'): ${extractedMinute}`);
  
  if (extractedHour === hour && extractedMinute === 0) {
    console.log(`  ✅ PostgreSQL will extract correct hour: ${hour}:00`);
  } else {
    console.log(`  ❌ PostgreSQL will extract wrong hour: ${extractedHour}:${extractedMinute}`);
  }
  console.log('');
}
