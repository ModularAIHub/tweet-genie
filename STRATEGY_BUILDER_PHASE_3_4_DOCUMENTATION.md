# Strategy Builder - Phase 3 & 4 Implementation

## Overview
This document details the implementation of **Phase 3 (Analytics Integration)** and **Phase 4 (Auto-Pilot)** for the Strategy Builder feature.

## Phase 3: Analytics Integration ✅

### Database Schema

#### 1. Enhanced `tweets` Table
Added columns to track detailed engagement metrics:
- `impressions`, `likes`, `retweets`, `replies`, `quotes`, `bookmarks`
- `url_clicks`, `profile_clicks`  
- `engagement_rate` (calculated metric)
- `analytics_fetched_at` (timestamp)
- `strategy_id` (links tweets to strategies)
- `prompt_id` (tracks which prompt generated the tweet)

#### 2. `strategy_analytics` Table
Stores aggregated insights per strategy over time periods:
- Performance metrics (posts, impressions, engagements, avg engagement rate)
- Best performing hours (array of 0-23)
- Best performing days (array of 0-6, 0=Sunday)
- Top themes/topics (JSONB)
- Metrics by category (JSONB)

#### 3. `content_insights` Table
Provides content performance recommendations:
- Content type analysis
- Themes and sentiment tracking
- Success rate compared to average
- AI-generated recommendations
- Confidence scores

#### 4. `optimal_posting_schedule` Table
Identifies best times to post based on historical data:
- Day of week (0-6)
- Hour of day (0-23)
- Average engagement rate at that time
- Post count (for confidence calculation)
- `is_recommended` flag for top slots

### Backend Services

**File:** [`server/services/analyticsService.js`](d:\suitegenie\tweet-genie\server\services\analyticsService.js)

Key Functions:
- `fetchTweetAnalytics()` - Fetch metrics from Twitter API (placeholder for integration)
- `calculateOptimalPostingTimes()` - Analyze historical data to find best posting times
- `getRecommendedPostingTimes()` - Get pre-calculated optimal times
- `generateStrategyAnalytics()` - Create comprehensive analytics for a time period
- `getContentInsights()` - Generate AI recommendations based on performance
- `getAnalyticsDashboard()` - Main dashboard data aggregator

### API Endpoints

**File:** [`server/routes/strategy-analytics.js`](d:\suitegenie\tweet-genie\server\routes\strategy-analytics.js)

```
GET  /api/strategy-analytics/:strategyId/dashboard?days=30
GET  /api/strategy-analytics/:strategyId/insights
GET  /api/strategy-analytics/:strategyId/optimal-times
POST /api/strategy-analytics/:strategyId/calculate
```

---

## Phase 4: Auto-Pilot ✅

### Database Schema

#### 1. `autopilot_config` Table
Stores autopilot settings per strategy:
- `is_enabled` - Master on/off switch
- `posts_per_day` - Target daily post count
- `generation_mode` - 'smart', 'scheduled', or 'manual'
- `use_optimal_times` - Whether to use analytics-based scheduling
- `custom_posting_hours` - Array of hours if not using optimal times
- `timezone` - User's timezone for scheduling
- `require_approval` - Whether posts need manual approval
- `auto_thread` - Auto-generate threads for certain topics
- `max_queue_size` - Maximum queued posts
- `category_rotation` - Rotate through content categories
- `avoid_repetition_days` - Don't repeat similar content within X days
- `pause_on_low_engagement` - Auto-pause if engagement drops

#### 2. Enhanced `strategy_queue` Table
Added fields to existing queue table:
- `generation_mode` - 'manual', 'auto', or 'smart'
- `category` - Content category
- `ideal_posting_time` - Recommended time from analytics
- `approval_requested_at`, `approved_by`, `approved_at`
- `rejected_at`, `rejection_reason`
- `engagement_prediction` - AI-predicted engagement score
- `priority` - 1-10 priority level
- `retry_count`, `last_retry_at` - For failed posts

#### 3. `autopilot_history` Table
Audit log of all autopilot actions:
- Action types: 'generated', 'scheduled', 'approved', 'rejected', 'posted', 'failed'
- Actor (system or user ID)
- Prompt used, category
- Success/failure tracking
- Error messages

#### 4. `content_variations` Table
A/B testing support for future enhancement:
- Multiple content variations per queue item
- Test weights for weighted distribution
- Performance tracking per variation

### Backend Services

**File:** [`server/services/autopilotService.js`](d:\suitegenie\tweet-genie\server\services\autopilotService.js)

Key Functions:
- `getAutopilotConfig()` / `updateAutopilotConfig()` - Manage settings
- `generateContentFromPrompt()` - AI content generation using prompts
- `getNextOptimalPostingTime()` - Calculate next best time to post
- `selectNextPrompt()` - Intelligent prompt rotation for diversity
- `generateAndQueueContent()` - Main generation pipeline
- `fillQueue()` - Auto-fill queue to max_queue_size
- `getQueue()` - Retrieve queued content with filters
- `approveQueuedContent()` / `rejectQueuedContent()` - Approval workflow
- `editQueuedContent()` - Manual editing of generated content

### API Endpoints

**File:** [`server/routes/autopilot.js`](d:\suitegenie\tweet-genie\server\routes\autopilot.js)

```
GET    /api/autopilot/:strategyId/config
PUT    /api/autopilot/:strategyId/config
GET    /api/autopilot/:strategyId/queue?status=pending&limit=20
POST   /api/autopilot/:strategyId/generate
POST   /api/autopilot/:strategyId/fill-queue
POST   /api/autopilot/queue/:queueId/approve
POST   /api/autopilot/queue/:queueId/reject
PUT    /api/autopilot/queue/:queueId
DELETE /api/autopilot/queue/:queueId
```

### Background Worker

**File:** [`server/workers/autopilotWorker.js`](d:\suitegenie\tweet-genie\server\workers\autopilotWorker.js)

Runs on a configurable interval (default: 1 hour):
- Finds all enabled autopilot strategies
- Calls `fillQueue()` for each to maintain queue levels
- Logs all actions for monitoring
- Handles errors gracefully per-strategy

**Environment Variables:**
- `AUTOPILOT_WORKER_INTERVAL_MS` - Interval between runs (default: 3600000 = 1 hour)
- `AUTOPILOT_DEBUG` - Enable verbose logging

---

## Integration Points

### 1. AI Service Integration
Autopilot uses the existing `aiService.js` to generate content:
```javascript
import { generateChatCompletion } from './aiService.js';
```
Uses Perplexity → Google → OpenAI fallback chain.

### 2. Credit System
Content generation will deduct credits (configured in strategy):
- 0.5 credits per chat message
- Custom rates for autopilot generation

### 3. Twitter API
Analytics will integrate with Twitter API v2 for real metrics:
- Impressions, likes, retweets, replies
- Currently has placeholder structure

### 4. Existing Queue System
Leverages the existing `strategy_queue` table created in Phase 1.

---

## Database Migrations

### Run Migrations
```bash
cd server
node run-migrations.js
```

Or manually:
```sql
-- Run in order:
\i migrations/20260214_add_analytics_integration.sql
\i migrations/20260214_add_autopilot_enhancement.sql
```

### Migration Files
1. [`20260214_add_analytics_integration.sql`](d:\suitegenie\tweet-genie\server\migrations\20260214_add_analytics_integration.sql)
2. [`20260214_add_autopilot_enhancement.sql`](d:\suitegenie\tweet-genie\server\migrations\20260214_add_autopilot_enhancement.sql)

---

## Usage Examples

### Enable Autopilot
```javascript
// Enable autopilot for a strategy
PUT /api/autopilot/:strategyId/config
{
  "is_enabled": true,
  "posts_per_day": 3,
  "use_optimal_times": true,
  "require_approval": true,
  "max_queue_size": 10
}
```

### Generate Content Manually
```javascript
// Generate 5 posts immediately
POST /api/autopilot/:strategyId/generate
{
  "count": 5
}
```

### Get Analytics Dashboard
```javascript
// Get 30-day analytics
GET /api/strategy-analytics/:strategyId/dashboard?days=30

Response:
{
  "success": true,
  "data": {
    "period": { "start": "2026-01-15", "end": "2026-02-14", "days": 30 },
    "performance": {
      "total_posts": 45,
      "total_impressions": 125000,
      "total_engagements": 3500,
      "avg_engagement_rate": 2.8
    },
    "optimalTimes": {
      "hours": [9, 12, 17],
      "days": [1, 2, 3], // Mon, Tue, Wed
      "detailed": [...]
    },
    "categoryPerformance": {
      "Tips": { "postCount": 20, "avgEngagement": 3.2 },
      "Stories": { "postCount": 15, "avgEngagement": 2.5 }
    },
    "insights": [...]
  }
}
```

### Approve Queued Content
```javascript
// Approve a post
POST /api/autopilot/queue/:queueId/approve

// Reject a post
POST /api/autopilot/queue/:queueId/reject
{
  "reason": "Off-brand tone"
}

// Edit before approving
PUT /api/autopilot/queue/:queueId
{
  "content": "Updated tweet content..."
}
```

---

## Next Steps (UI Implementation)

### Phase 3 UI: Analytics Dashboard
**Location:** `client/src/pages/StrategyBuilder/AnalyticsDashboard.jsx`

Components needed:
1. **Performance Overview Cards**
   - Total posts, impressions, engagement rate
   - Trend indicators (up/down from previous period)

2. **Optimal Posting Times Heatmap**
   - 7x24 grid showing best times to post
   - Color-coded by engagement rate
   - Confidence indicators

3. **Content Performance Insights**
   - Table/cards showing category performance
   - Recommendations with confidence scores
   - Success rate indicators

4. **Engagement Trends Chart**
   - Line chart showing engagement over time
   - Category-based filtering

### Phase 4 UI: Content Calendar & Queue Management
**Location:** `client/src/pages/StrategyBuilder/AutoPilot.jsx`

Components needed:
1. **Autopilot Settings Panel**
   - Toggle switches for all config options
   - Posts per day slider
   - Optimal times vs custom hours selector

2. **Content Queue List**
   - Cards showing queued posts
   - Approve/Reject/Edit buttons
   - Scheduled time display
   - Category badges

3. **Calendar View**
   - Full calendar with scheduled posts
   - Drag-and-drop rescheduling
   - Color-coded by status (pending/approved/posted)

4. **Generation Controls**
   - "Fill Queue" button
   - Manual generation with prompt selector
   - Bulk approve/reject actions

---

## Testing

### Test Analytics Generation
```bash
# Calculate analytics for a strategy
curl -X POST http://localhost:3002/api/strategy-analytics/:strategyId/calculate \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"startDate": "2026-01-15", "endDate": "2026-02-14"}'
```

### Test Autopilot Queue
```bash
# Fill queue for a strategy
curl -X POST http://localhost:3002/api/autopilot/:strategyId/fill-queue \
  -H "Authorization: Bearer $TOKEN"

# Get queue
curl http://localhost:3002/api/autopilot/:strategyId/queue?status=pending \
  -H "Authorization: Bearer $TOKEN"
```

---

## Performance Considerations

1. **Analytics Calculation**
   - Run periodically (e.g., daily) via cron job
   - Cache results in `strategy_analytics` table
   - Avoid real-time calculation on every request

2. **Autopilot Worker**
   - Runs every 1 hour by default
   - Processes strategies sequentially to avoid rate limits
   - Small delays between generations (1s) to avoid overwhelming AI API

3. **Queue Size**
   - Default max: 10 posts per strategy
   - Prevents excessive unused content
   - Ensures freshness of generated posts

---

## Environment Variables

Add to `.env`:
```bash
# Autopilot Worker
AUTOPILOT_WORKER_INTERVAL_MS=3600000  # 1 hour
AUTOPILOT_DEBUG=true

# Analytics
ANALYTICS_DEBUG=true
```

---

## Implementation Status

### ✅ Completed (Backend)
- [x] Phase 3 database schema
- [x] Phase 4 database schema
- [x] Analytics service with all functions
- [x] Autopilot service with queue management
- [x] Strategy analytics API routes
- [x] Autopilot API routes
- [x] Background worker for autopilot
- [x] Worker integration in index.js
- [x] Database migrations

### 🔄 Pending (Frontend)
- [ ] Analytics dashboard UI
- [ ] Optimal posting times heatmap
- [ ] Content insights display
- [ ] Autopilot settings panel
- [ ] Content queue management UI
- [ ] Content calendar view
- [ ] Approval workflow UI

### 📝 Future Enhancements
- [ ] Twitter API v2 integration for real analytics
- [ ] A/B testing with content variations
- [ ] ML-based engagement prediction
- [ ] Smart category rotation algorithm
- [ ] Thread auto-generation
- [ ] Sentiment analysis for insights

---

## Credits & Costs

### Autopilot Content Generation
- Uses existing AI service (Perplexity → Google → OpenAI)
- Credit deduction per generation (to be configured)
- Recommended: 10 credits per auto-generated post

### Analytics Calculation
- No credits consumed (internal DB queries)
- Twitter API may have rate limits for metrics fetching

---

## Support & Troubleshooting

### Common Issues

**Issue:** Autopilot not generating content
- Check worker status: `getAutopilotWorkerStatus()`
- Verify strategy has `is_enabled: true` in `autopilot_config`
- Check strategy has available prompts in `strategy_prompts`
- Review logs for errors

**Issue:** No optimal posting times
- Need at least 3 posts at a given hour to calculate
- Data must be from last 30 days with `engagement_rate > 0`
- Run analytics calculation manually first

**Issue:** Queue always empty
- Check `max_queue_size` setting
- Verify prompt availability
- Check credit balance for generation
- Review autopilot worker logs

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      Strategy Builder                            │
├─────────────────────────────────────────────────────────────────┤
│  Phase 1: Chat Flow (✅)  │  Phase 2: Prompts & Library (✅)   │
├───────────────────────────┼─────────────────────────────────────┤
│  Phase 3: Analytics (✅)  │  Phase 4: Auto-Pilot (✅)           │
│  • Performance Insights   │  • Auto Content Generation           │
│  • Optimal Post Times     │  • Intelligent Scheduling            │
│  • Content Recommendations│  • Approval Workflow                 │
│  • Engagement Tracking    │  • Queue Management                  │
└───────────────────────────┴─────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    ↓               ↓               ↓
            ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
            │   Analytics  │ │  Autopilot  │ │  Background  │
            │   Service    │ │   Service   │ │    Worker    │
            └──────────────┘ └─────────────┘ └──────────────┘
                    │               │               │
                    └───────────────┼───────────────┘
                                    ↓
                    ┌───────────────────────────────┐
                    │      PostgreSQL Database      │
                    │  • strategy_analytics         │
                    │  • optimal_posting_schedule   │
                    │  • content_insights           │
                    │  • autopilot_config           │
                    │  • strategy_queue             │
                    │  • autopilot_history          │
                    └───────────────────────────────┘
```

---

**Last Updated:** February 14, 2026  
**Version:** 1.0.0  
**Status:** Backend Implementation Complete ✅
