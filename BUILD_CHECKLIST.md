# SuiteGenie — Twitter Automation Build Checklist

---

## 🔵 PHASE 1 — Strategy Builder Intelligence ✅ COMPLETE

### 1.1 OAuth Callback Fix
- [x] Add `bio` column to `twitter_auth` table (migration `20260302_add_bio_website_to_twitter_auth.sql`)
- [x] Add `website_url` column to `twitter_auth` table (migration)
- [x] Update OAuth callback in `server/routes/twitter.js` to fetch and store bio + website_url at connection time

### 1.2 Profile Analysis Service
- [x] Create `tweet-genie/server/services/profileAnalysisService.js`
- [x] Job 1 — DB check for existing tweets (`tweets` table)
- [x] Job 1 — Twitter API v2 fallback fetch (last 100 tweets) when DB is empty
- [x] Job 2 — Data quality assessor (high/medium/low confidence logic)
- [x] Job 2 — Tweet normaliser (maps Twitter API shape and DB shape to one consistent format)
- [x] Job 3 — Gemini analysis with structured prompt (returns niche, audience, tone, topics, best times, mistakes, gaps)
- [x] Job 4 — Gemini trending topics fetch with Google Search grounding enabled

### 1.3 Strategy Service Updates
- [x] Add `initWithAnalysis(strategyId, userId)` entry point in `strategyService.js`
- [x] Pre-filled confirmation flow — Step 1 Niche
- [x] Pre-filled confirmation flow — Step 2 Audience
- [x] Pre-filled confirmation flow — Step 3 Tone
- [x] Manual step — Step 4 Goals (Gemini cannot infer intent)
- [x] Pre-filled confirmation flow — Step 5 Topics (Gemini inference + trending topics merged)
- [x] Pre-filled confirmation flow — Step 6 Posting frequency (from tweet history patterns)
- [x] Store analysis results in strategy `metadata` column as `analysis_cache`
- [x] Keep existing 7-step manual chat as fallback (do not remove)

### 1.4 Optional Reference Accounts
- [x] UI — 2 optional handle input fields after confirmation steps
- [x] Twitter API fetch for reference public timelines using Bearer token
- [x] Gemini analysis of reference accounts (winning angles, content gaps)
- [x] Merge reference findings into strategy metadata

### 1.5 New API Routes
- [x] `POST /api/strategy/init-analysis` — triggers analysis jobs
- [x] `POST /api/strategy/apply-analysis` — saves confirmed results
- [x] `POST /api/strategy/reference-analysis` — optional reference accounts

### 1.6 Frontend — Strategy Builder UI
- [x] Entry screen — "Analyse my account" vs "Set up manually" options
- [x] Loading screen with live progress text (each job ticks green as it completes)
- [x] Confirmation chat UI — pre-filled answers with Yes/Edit options
- [x] Reference account input screen (2 optional fields)
- [x] Connect confirmed strategy to existing Prompts tab output

### 1.7 Recommended Posting Times
- [x] Surface `best_days` and `best_hours` from analysis in scheduling UI
- [x] Store recommended slots in strategy metadata
- [x] Pre-select next recommended slot in composer by default instead of blank time picker

---

## 🟡 PHASE 2 — Weekly Content Generation + Review Queue ✅ COMPLETE
> Estimated: 1.5 weeks after Phase 1

### 2.1 Database
- [x] Create `content_review_queue` table migration (`20260302_create_content_review_queue.sql`)

### 2.2 Weekly Generation Trigger
- [x] New cron job — runs every Monday morning (`weeklyContentWorker.js` via QStash)
- [x] Loops through all users with active strategies
- [x] Fetches fresh trending topics from Gemini for each user's niche (with Google Search grounding)
- [x] Generates 5-7 tweets per user using strategy context + trending topics
- [x] Inserts generated tweets into `content_review_queue`

### 2.3 Review Queue UI
- [x] New page — "This week's content" showing pending queue (`ContentReview.jsx`)
- [x] Each tweet shows: content, suggested posting time, reason it was generated
- [x] Actions per tweet: Approve / Edit / Reject
- [x] Approve → calls `POST /api/content-review/:id/schedule` with suggested time automatically
- [x] Batch approve all button (`/batch-approve` + `/batch-schedule`)

### 2.4 Auto Generation from Strategy (Gap 1)
- [x] "Generate my week's content" button on Strategy Builder completion (`StrategyOverview.jsx`)
- [x] Triggers batch generation using strategy prompts without opening composer
- [x] Output goes directly into review queue

---

## 🟠 PHASE 3 — Content Calendar View (Gap 4) ✅ COMPLETE
> Implemented as part of Scheduling page (calendar + list hybrid)

- [x] Calendar view in Scheduling page (week/month toggle)
- [x] Fetch all scheduled tweets via `GET /api/scheduling`
- [x] Render on weekly/monthly calendar grid (`DayCell` + `CalendarItem` components)
- [x] Drag to reschedule → calls `PUT /api/scheduling/:id` (draggable for pending items)
- [x] Show content gaps (empty days marked as "Content Gap" with amber highlight)
- [x] Show review queue items as "pending approval" on calendar (`_isReviewItem` flag)

---

## 🔴 PHASE 4 — Autopilot Mode ✅ COMPLETE
> Migration: `20260303_phase4_autopilot_mode.sql`

- [x] Autopilot toggle in settings (opt-in, off by default) — `Settings.jsx` Autopilot tab
- [x] When on — skip review queue, schedule directly after generation (`weeklyContentService.autopilotSchedule`)
- [x] Notification sent to user after auto-scheduling — logged to `autopilot_history`
- [x] 1-hour undo window per tweet after autopilot schedules it (`undo_deadline` column + `POST /undo/:id`)
- [x] Autopilot activity log — user can see everything it did (`GET /activity-log` + Settings UI)

---

## ⚫ PHASE 5 — Feedback Loop (Gap 2) ✅ COMPLETE
> Migration: `20260303_phase5_feedback_loop.sql`

### 5.1 Auto Analytics Sync
- [x] Auto-trigger analytics sync 24-48 hours after each scheduled post goes live (`scheduleDeferredSync` in `feedbackLoopService.js`)
- [x] Store engagement score per tweet normalised against user's own average (`scoreTweet`)

### 5.2 Performance Scoring
- [x] Score each tweet: above average / average / below average (`performance_score` column on `tweets`)
- [x] Tag each tweet with strategy topics it covered (`topic_tags` column)
- [x] Weekly performance summary per user stored in DB (`weekly_performance_summaries` table)

### 5.3 Strategy Auto-Update
- [x] If threads outperform singles for 3+ weeks → auto-update `best_format` in strategy
- [x] If a topic consistently underperforms → deprioritise it in next generation cycle
- [x] If posting at different time than recommended performs better → update `best_hours`
- [x] All changes logged to `strategy_auto_updates` table

### 5.4 Informed Weekly Generation
- [x] Before generating each Monday — send last week's performance to Gemini (`runWeeklyCycle` in `weeklyContentWorker.js`)
- [x] Gemini adjusts this week's content based on what worked and what didn't (`performanceContext` injected into prompt)
- [x] Show user a "why this was generated" reason based on last week's data (via `reason` field in review queue)

---

## 🟣 PHASE 6 — Repurposing (Gap 3) ✅ COMPLETE
> Migration: `20260303_fix_review_queue_source_constraint.sql` (expanded source constraint)

- [x] "Repurpose this tweet" button on best performing posts in analytics (`OverviewTab.jsx`)
- [x] Gemini converts tweet → LinkedIn post variation (`repurposeService.js`)
- [x] Gemini converts tweet → thread expansion
- [x] Gemini converts tweet → 3 alternative angle variations
- [x] Output goes to review queue for approval (3 credits, `POST /content-review/repurpose/:tweetId`)

---

## Edge Cases — Across All Phases ✅ HANDLED
- [x] No tweets at all — bio-only analysis, confidence shown as low, performance section hidden
- [x] Bio is empty — tweet content only analysis, slightly less accurate
- [x] Twitter API failure — auto-fallback to manual setup with clear message
- [x] Mixed content account — Gemini picks dominant niche, user corrects at Step 1
- [x] Reference handle is private or doesn't exist — skip silently, notify user
- [x] Autopilot posts bad content — undo window handles this, user notified immediately
- [x] Under 5 tweets — skip performance analysis entirely, niche from bio only

---

## Quick Reference — Key Files

| What | File |
|------|------|
| OAuth callback | `tweet-genie/server/routes/twitter.js` |
| Gemini + AI calls | `tweet-genie/server/services/aiService.js` |
| Strategy chat flow | `tweet-genie/server/services/strategyService.js` |
| Scheduling logic | `tweet-genie/server/routes/scheduling.js` |
| Scheduled posting cron | `tweet-genie/server/services/scheduledTweetService.js` |
| Analytics sync | `tweet-genie/server/routes/analytics.js` |
| Strategy Builder UI | `client/src/pages/StrategyBuilder/index.jsx` |
| New — Profile Analysis | `tweet-genie/server/services/profileAnalysisService.js` |

---

## Status Legend
- ✅ Phase 1 — Complete (Strategy Builder + Profile Analysis + Reference Accounts)
- ✅ Phase 2 — Complete (Weekly Content Generation + Review Queue)
- ✅ Phase 3 — Complete (Content Calendar integrated into Scheduling page)
- ✅ Phase 4 — Complete (Autopilot Mode with undo window)
- ✅ Phase 5 — Complete (Feedback Loop: scoring, summaries, auto-update, informed generation)
- ✅ Phase 6 — Complete (Repurposing: LinkedIn, thread expansion, alternative angles)
