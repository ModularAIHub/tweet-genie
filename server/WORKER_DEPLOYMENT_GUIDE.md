# Tweet Genie Worker Deployment Guide

## Overview

The Tweet Genie worker is a separate Node.js process that handles:
1. **Scheduled Tweet Execution** - Publishes tweets at their scheduled times
2. **Autopilot Queue Filling** - Generates content for enabled autopilot strategies

## Worker Architecture

```
worker.js
├── dbScheduledTweetWorker (from ./workers/dbScheduledTweetWorker.js)
│   └── Polls database every minute for tweets ready to publish
│
└── autopilotWorker (from ./workers/autopilotWorker.js)
    └── Fills content queues for enabled strategies every hour
```

## Deployment Options

### Option 1: Separate Render Service (Recommended)

1. Create a new Web Service on Render
2. Configure:
   - **Name**: `tweet-genie-worker`
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node worker.js`
   - **Working Directory**: `tweet-genie/server`
3. Add environment variables (same as main server)
4. Deploy

**Pros**: Isolated, can scale independently, won't affect main API
**Cons**: Additional cost (but can use free tier with UptimeRobot ping)

### Option 2: Same Server as Background Process

1. Use a process manager like PM2:
   ```bash
   npm install -g pm2
   pm2 start tweet-genie/server/worker.js --name tweet-worker
   pm2 save
   pm2 startup
   ```

**Pros**: No additional cost, simpler deployment
**Cons**: Shares resources with main API, harder to monitor

### Option 3: Serverless Cron (Not Recommended)

Using Vercel Cron or similar for scheduled tasks.

**Pros**: No always-on process needed
**Cons**: 
- Cold starts cause delays
- Not suitable for minute-by-minute polling
- May miss scheduled times

## Environment Variables Required

The worker needs the same environment variables as the main server:

```env
DATABASE_URL=postgresql://...
TWITTER_API_KEY=...
TWITTER_API_SECRET=...
TWITTER_BEARER_TOKEN=...
OPENAI_API_KEY=...
GOOGLE_AI_API_KEY=...
PERPLEXITY_API_KEY=...
# ... other API keys
```

## Health Check

The worker exposes a health endpoint on port 3099 (or `PORT` env var):

```bash
curl http://your-worker-url:3099
# Response: {"ok":true,"service":"tweet-genie-worker","ts":1234567890}
```

### Keep-Alive for Free Tier

If using Render's free tier, set up UptimeRobot to ping the health endpoint every 5 minutes to prevent the service from sleeping.

## Monitoring

### Check if Worker is Running

```bash
# On server
ps aux | grep worker.js

# Or with PM2
pm2 list
pm2 logs tweet-worker
```

### Check Worker Logs

```bash
# PM2
pm2 logs tweet-worker --lines 100

# Render
# View logs in Render dashboard

# Direct
tail -f /path/to/worker.log
```

### Database Queries to Monitor Worker Activity

```sql
-- Check recent scheduled tweet executions
SELECT id, content, scheduled_for, status, updated_at
FROM scheduled_tweets
WHERE status IN ('completed', 'failed')
ORDER BY updated_at DESC
LIMIT 20;

-- Check autopilot queue filling activity
SELECT strategy_id, COUNT(*) as queued_count, MAX(created_at) as last_generated
FROM content_review_queue
WHERE source = 'autopilot'
  AND status IN ('pending', 'approved')
GROUP BY strategy_id;
```

## Troubleshooting

### Worker Not Starting

1. Check environment variables are set
2. Check database connection:
   ```bash
   node -e "import pg from 'pg'; const pool = new pg.Pool({connectionString: process.env.DATABASE_URL}); pool.query('SELECT NOW()').then(r => console.log('DB OK:', r.rows[0])).catch(e => console.error('DB Error:', e));"
   ```
3. Check for port conflicts (port 3099)

### Posts Not Publishing

1. Verify worker is running (check health endpoint)
2. Check worker logs for errors
3. Verify Twitter API credentials are valid
4. Check scheduled_tweets table for posts stuck in "pending"
5. Manually trigger worker:
   ```bash
   node tweet-genie/server/worker.js
   ```

### Autopilot Not Generating Content

1. Check autopilot_config table - is `is_enabled = true`?
2. Check for credit issues - does user have credits?
3. Check for prompt exhaustion - are there available prompts?
4. Check worker logs for autopilot errors
5. Check autopilot_history table for recent activity

## Performance Tuning

### Scheduled Tweet Worker

Default: Polls every 60 seconds

To adjust, modify `dbScheduledTweetWorker.js`:
```javascript
const POLL_INTERVAL = 60000; // milliseconds
```

### Autopilot Worker

Default: Runs every hour, generates up to 6 posts per run

To adjust, modify `autopilotService.js`:
```javascript
const AUTOPILOT_BATCH_SIZE = 6; // posts per run
```

## Scaling Considerations

### High Volume (>1000 scheduled tweets/day)

1. Use separate worker service
2. Consider multiple worker instances with leader election
3. Add Redis for distributed locking
4. Increase poll frequency for scheduled tweets

### Many Autopilot Strategies (>50 active)

1. Increase `AUTOPILOT_BATCH_SIZE`
2. Run autopilot worker more frequently
3. Consider strategy-specific workers

## Security

- Worker uses same database credentials as main server
- No HTTP authentication required (uses DB directly)
- Ensure DATABASE_URL is secure and not exposed
- Worker should run in same VPC/network as database for security

## Backup Strategy

If worker goes down:
1. Scheduled tweets will queue up
2. When worker restarts, it will catch up
3. Posts more than 2 hours past scheduled time are marked as "expired"
4. Autopilot queues will fill when worker restarts

## Cost Optimization

### Free Tier Strategy (Render)

1. Deploy worker as separate free web service
2. Set up UptimeRobot to ping every 5 minutes
3. Worker stays awake and processes tweets
4. Cost: $0/month

### Paid Strategy

1. Use Render's paid tier for always-on worker
2. Or use dedicated server (DigitalOcean, AWS EC2)
3. Cost: ~$7-25/month depending on provider

## Deployment Checklist

- [ ] Worker code deployed
- [ ] Environment variables configured
- [ ] Database connection verified
- [ ] Health endpoint responding
- [ ] UptimeRobot ping configured (if free tier)
- [ ] Logs accessible
- [ ] Test scheduled tweet publishes successfully
- [ ] Test autopilot generates content
- [ ] Monitor for 24 hours to ensure stability

## Support

For issues:
1. Check worker logs first
2. Verify database connectivity
3. Check API credentials
4. Review AUTOPILOT_FIXES_SUMMARY.md for recent changes
