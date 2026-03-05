# Cross-Post Truncation Contract (2026-03-06)

## Purpose
Document the expected payload contract for external platform services (Meta Genie, LinkedIn Genie) that call Tweet Genie's internal cross-post endpoint.

## Endpoint
- `POST /api/internal/twitter/cross-post`

## X Limits Enforced by Tweet Genie
- Single post mode:
  - max `280` characters
  - over-limit requests return:
    - `400`
    - `code: "X_POST_TOO_LONG"`
- Thread mode:
  - requires non-empty `threadParts`
  - each thread part is normalized to X-safe length (280)

## Required Caller Behavior
Upstream callers must ensure payload compatibility before calling Tweet Genie:
- If source mode is `single` and content is > 280, convert to thread payload.
- If source mode is `thread`, ensure valid non-empty `threadParts`.
- Keep `content` aligned with first thread part when sending thread mode.

## Why This Matters
This avoids:
- rejected cross-posts (`X_POST_TOO_LONG`)
- mismatched history metadata
- divergent behavior between integration sources

## Current Integrations
- LinkedIn Genie path already conforms.
- Meta Genie path updated on 2026-03-06 to conform and auto-split long single content into thread mode.
