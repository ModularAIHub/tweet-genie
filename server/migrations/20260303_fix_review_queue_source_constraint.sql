-- Phase 4+6 fix: Expand content_review_queue source CHECK constraint
-- to allow autopilot and repurpose sources.
-- Created: 2026-03-03

-- Drop the old restrictive source CHECK constraint
ALTER TABLE content_review_queue DROP CONSTRAINT IF EXISTS content_review_queue_source_check;

-- Re-create with all valid source values
ALTER TABLE content_review_queue
  ADD CONSTRAINT content_review_queue_source_check
  CHECK (source IN (
    'weekly_generation',
    'manual_generation',
    'strategy_completion',
    'autopilot',
    'repurpose_linkedin',
    'repurpose_thread',
    'repurpose_alternative'
  ));
