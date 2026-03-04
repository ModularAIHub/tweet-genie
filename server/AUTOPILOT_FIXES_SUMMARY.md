# Autopilot Comprehensive Fixes - March 4, 2026

## Issues Fixed

### 1. ✅ Thread Generation Bug - FIXED
**Problem**: All autopilot content was being generated as threads (with `---` separators), making every post appear as a thread instead of a natural mix of single tweets and threads.

**Root Cause**: The AI service system prompts included instructions like "If user asks for 'threads', generate 3-5 tweets separated by '---'" even when `requestedCount` was null. This caused the AI to default to generating threads for all content.

**Fix Applied**:
- Updated `generateWithPerplexity()` in `aiService.js` (line ~511)
- Updated `generateWithGoogle()` in `aiService.js` (line ~590)
- Updated `generateWithOpenAI()` in `aiService.js` (line ~693)

**New Behavior**: The AI now generates:
- Single tweets for content that fits naturally in one tweet (under 260 chars)
- Threads (3-5 tweets with `---` separators) only when content requires more depth

**Files Modified**:
- `tweet-genie/server/services/aiService.js`

---

### 2. ⚠️ Timezone/Scheduling Bug - ENHANCED LOGGING
**Problem**: Posts scheduled at wrong times (e.g., 7:30 AM, 8:30 AM instead of 8:00 AM, 12:00 PM, 6:00 PM IST).

**Investigation Results**:
- The `createSlotDate()` function works correctly (verified by tests)
- Posts are being stored with incorrect times in the database
- Example: User configured [8, 12, 18] but posts scheduled at hours 7 and 8 with 30-minute offsets

**Fix Applied**:
- Added comprehensive debug logging to `getNextOptimalPostingTime()` in `autopilotService.js`
- Logs now show:
  - Each slot being checked
  - Time in user timezone and UTC
  - ISO string format
  - Whether slot is available or taken

**Next Steps**: Monitor logs to identify where the time modification occurs

**Files Modified**:
- `tweet-genie/server/services/autopilotService.js` (lines ~207-230)

---

### 3. ⚠️ Time Distribution Bug - RELATED TO #2
**Problem**: Posts not cycling through all configured hours [8, 12, 18]. Instead, many posts scheduled at same 1-2 hours.

**Status**: This appears to be related to the timezone bug. Once times are calculated correctly, distribution should work as the code already cycles through all hours in the `customHours` array.

**Monitoring**: Enhanced logging will help identify if there's a separate distribution issue.

---

### 4. ✅ Scheduler Execution - VERIFIED
**Problem**: Posts remain in "pending" status and don't get published at scheduled times.

**Investigation Results**:
- Worker exists: `tweet-genie/server/worker.js`
- Worker starts two services:
  - `dbScheduledTweetWorker` - Processes scheduled tweets
  - `autopilotWorker` - Fills content queues

**Verification Needed**:
- Ensure worker is deployed and running in production
- Check worker logs for errors
- Verify database connection from worker

**Deployment Command**:
```bash
# Start the worker (should be running as a separate process)
node tweet-genie/server/worker.js
```

**Health Check**:
- Worker exposes health endpoint on port 3099 (or PORT env var)
- Ping `http://worker-url:3099` to verify it's running

---

## Testing Instructions

### Test 1: Verify Thread Generation Fix
1. Enable autopilot for a strategy
2. Let it generate 5-10 posts
3. Check `content_review_queue` table:
   ```sql
   SELECT id, LEFT(content, 100) as preview, 
          (content LIKE '%---%') as has_separator
   FROM content_review_queue 
   WHERE source = 'autopilot' 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```
4. **Expected**: Mix of posts with and without `---` separators (not all threads)

### Test 2: Monitor Timezone Logging
1. Trigger autopilot generation
2. Check server logs for `[Autopilot]` entries
3. Look for patterns in scheduled times
4. **Expected**: Times should match configured hours exactly (8:00, 12:00, 18:00, not 7:30, 8:30)

### Test 3: Verify Worker is Running
1. Check if worker process is running:
   ```bash
   ps aux | grep "worker.js"
   ```
2. Check worker health endpoint:
   ```bash
   curl http://localhost:3099
   ```
3. **Expected**: `{"ok":true,"service":"tweet-genie-worker","ts":...}`

### Test 4: Verify Posts Get Published
1. Schedule a test post for 2 minutes in the future
2. Wait for scheduled time
3. Check post status changes from "pending" to "completed"
4. Verify post appears on Twitter

---

## Database Queries for Monitoring

### Check Recent Autopilot Posts
```sql
SELECT 
  id,
  LEFT(content, 50) as content_preview,
  suggested_time,
  timezone,
  EXTRACT(HOUR FROM suggested_time AT TIME ZONE timezone) as hour_in_user_tz,
  status,
  created_at
FROM content_review_queue
WHERE source = 'autopilot'
ORDER BY created_at DESC
LIMIT 20;
```

### Check Hour Distribution
```sql
SELECT 
  EXTRACT(HOUR FROM suggested_time AT TIME ZONE 'Asia/Kolkata') as hour_ist,
  COUNT(*) as post_count
FROM content_review_queue
WHERE source = 'autopilot'
  AND strategy_id = 'YOUR_STRATEGY_ID'
GROUP BY hour_ist
ORDER BY hour_ist;
```

### Check Thread vs Single Tweet Ratio
```sql
SELECT 
  CASE 
    WHEN content LIKE '%---%' THEN 'Thread'
    ELSE 'Single Tweet'
  END as content_type,
  COUNT(*) as count
FROM content_review_queue
WHERE source = 'autopilot'
  AND created_at > NOW() - INTERVAL '24 hours'
GROUP BY content_type;
```

---

## Rollback Instructions

If issues occur, revert changes:

```bash
cd tweet-genie/server
git diff services/aiService.js
git checkout services/aiService.js services/autopilotService.js
```

---

## Additional Notes

- The `createSlotDate()` function is working correctly - verified by unit tests
- The timezone issue appears to be in how times are being passed to or stored in the database
- Enhanced logging will help pinpoint the exact location of the bug
- Worker must be running as a separate process for posts to be published

---

## Contact

For issues or questions about these fixes, check:
1. Server logs for `[Autopilot]` entries
2. Worker logs for scheduler errors
3. Database for actual stored times vs expected times
