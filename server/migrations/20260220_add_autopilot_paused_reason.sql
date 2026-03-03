-- Add paused_reason column to autopilot_config
-- Tracks why autopilot generation was paused (prompts_exhausted, insufficient_credits)
-- Created: 2026-02-20

ALTER TABLE autopilot_config
  ADD COLUMN IF NOT EXISTS paused_reason TEXT DEFAULT NULL;

COMMENT ON COLUMN autopilot_config.paused_reason IS 'Why autopilot paused: prompts_exhausted | insufficient_credits | NULL = running normally';
