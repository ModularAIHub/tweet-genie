# Scheduling Timezone Fix (2026-03-05)

## Problem reported
- User-selected schedule date/time was not posting at the intended local time.
- Requirement: timezone should be auto-detected, with an option for manual user selection.

## Root cause
- `Joi` validation was coercing `scheduled_for` into a `Date` too early, which can shift local `datetime-local` input before route-level timezone parsing.
  - `server/middleware/validation.js:111`
  - `server/middleware/validation.js:126`
- Some requests could arrive without explicit body timezone; backend needed a reliable fallback from client/browser timezone.
  - `server/routes/scheduling.js:232`
  - `server/routes/scheduling.js:238`

## Fix implemented

### 1) Stop timezone-unsafe validation coercion
- Changed scheduling schemas to validate `scheduled_for` as string (not `Joi.date()`), so parsing is handled once in route logic with explicit timezone.
  - `server/middleware/validation.js:111`
  - `server/middleware/validation.js:126`

### 2) Add backend timezone resolver with auto-fallback
- Added `resolveSchedulingTimezone(req, timezoneInput)`:
  - Uses body `timezone` if provided.
  - Else uses headers `x-user-timezone`, `x-timezone`, `x-time-zone`.
  - Else falls back to `UTC`.
  - `server/routes/scheduling.js:232`
  - `server/routes/scheduling.js:238`
- Applied resolver in all scheduling write paths:
  - Bulk schedule: `server/routes/scheduling.js:1262`, `server/routes/scheduling.js:1267`
  - Single schedule: `server/routes/scheduling.js:1493`, `server/routes/scheduling.js:1515`
  - Reschedule: `server/routes/scheduling.js:2133`, `server/routes/scheduling.js:2136`, `server/routes/scheduling.js:2139`

### 3) Keep single authoritative UTC conversion
- Existing timezone-aware parser remains the canonical conversion point:
  - `server/routes/scheduling.js:798`
- Confirmed both schedule and reschedule paths use it:
  - `server/routes/scheduling.js:1567`
  - `server/routes/scheduling.js:2147`

### 4) Auto-send browser timezone from client
- Added client request interceptor timezone header:
  - `client/src/utils/api.js:145`
  - `client/src/utils/api.js:166`

### 5) Add manual timezone input in schedule modal
- Added timezone input + suggestions + validation + detected default:
  - `client/src/components/TweetComposer/TweetActions.jsx:12`
  - `client/src/components/TweetComposer/TweetActions.jsx:25`
  - `client/src/components/TweetComposer/TweetActions.jsx:105`
  - `client/src/components/TweetComposer/TweetActions.jsx:201`
  - `client/src/components/TweetComposer/TweetActions.jsx:213`
  - `client/src/components/TweetComposer/TweetActions.jsx:246`
  - `client/src/components/TweetComposer/TweetActions.jsx:253`

### 6) Ensure payload always includes resolved timezone
- Scheduling submit now uses normalized `resolvedTimezone` fallback.
  - `client/src/hooks/useTweetComposer.js:1071`
  - `client/src/hooks/useTweetComposer.js:1092`
  - `client/src/hooks/useTweetComposer.js:1181`
  - `client/src/hooks/useTweetComposer.js:1223`

## Verification run
- Syntax checks:
  - `node --check server/routes/scheduling.js`
  - `node --check server/middleware/validation.js`
  - `node --check client/src/utils/api.js`
  - `node --check client/src/hooks/useTweetComposer.js`
- Frontend build:
  - `npm --prefix "tweet-genie/client" run build`
  - Result: success.

## Outcome
- Scheduling now auto-detects timezone from browser and sends it automatically.
- User can also manually choose/override timezone in the schedule modal.
- Backend normalizes timezone and converts schedule time to UTC in a single controlled path, preventing double-shift and local-time drift.
