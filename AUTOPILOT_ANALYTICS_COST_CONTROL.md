# Autopilot + Analytics Cost Control (Temporary)

Date: 2026-03-05

## Current Mode

The system is configured for manual-only analytics and autopilot is admin-disabled to prevent unexpected X API spend.

## Backend Env (tweet-genie server)

```env
ANALYTICS_AUTO_SYNC_ENABLED=false
START_ANALYTICS_WORKER=false

DB_SCHEDULED_TOKEN_PREFLIGHT_ENABLED=false

START_AUTOPILOT_WORKER=false
ENABLE_AUTOPILOT_CRON=false
ENABLE_WEEKLY_CONTENT_CRON=false

# Keep scheduler ON only if you still want scheduled tweets to auto-post:
# ENABLE_SCHEDULER_CRON=true
# START_DB_SCHEDULER_WORKER=true
```

## Frontend Env (tweet-genie client)

```env
VITE_ANALYTICS_CLIENT_AUTO_SYNC_ENABLED=false
VITE_ANALYTICS_AUTO_REFRESH_MS=0
VITE_ANALYTICS_SYNC_STATUS_REFRESH_MS=0
```

## Cron/QStash State

- Pause `/api/analytics/cron`
- Pause `/api/cron/autopilot`
- Pause `/api/cron/weekly-content` (while automation is paused)
- Keep `/api/cron/scheduler` only if scheduled posting should continue

## Guardrails Added

- Scheduled posting prefers OAuth1 and falls back to OAuth2 only if needed.
- Analytics cron tick no-ops unless `ANALYTICS_AUTO_SYNC_ENABLED=true`.
- Scheduler token preflight is opt-in only (`DB_SCHEDULED_TOKEN_PREFLIGHT_ENABLED=true` required).
- `PUT /api/autopilot/:strategyId/config` blocks enabling autopilot and returns:
  - `Autopilot mode currently turned off. Contact admin for it.`
- Worker process startup respects env flags instead of always starting autopilot/scheduler.

## Re-enable Later (Full Automation)

1. Set:
   - `ANALYTICS_AUTO_SYNC_ENABLED=true`
   - `START_ANALYTICS_WORKER=true`
   - `VITE_ANALYTICS_CLIENT_AUTO_SYNC_ENABLED=true`
2. Re-enable autopilot:
   - `START_AUTOPILOT_WORKER=true`
   - `ENABLE_AUTOPILOT_CRON=true`
   - remove/relax server guard in `server/routes/autopilot.js`
3. Re-enable weekly automation:
   - `ENABLE_WEEKLY_CONTENT_CRON=true`
4. Optionally re-enable token preflight:
   - `DB_SCHEDULED_TOKEN_PREFLIGHT_ENABLED=true`
5. Unpause cron/QStash jobs.
