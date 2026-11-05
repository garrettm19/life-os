# 4. History is never rewritten automatically

Status: accepted

## Context

Routines change: a workout moves to another weekday, a habit is paused, a session gets longer. Early on, reconciling the plan with the edited catalog also touched past days, and a stale snapshot of future obligations caused false misses. A plan change must never alter what was recorded.

## Decision

- Automatic reconciliation applies to today and later only.
- Each day stores its timed obligations (`dueTimed`) while it is today or later. A past day's snapshot is never refreshed from the current catalog, and nothing is backfilled.
- A routine edit never rewrites a completed, skipped, locked or hand-edited occurrence.
- Browsing a past date creates nothing. Week and Tomorrow compute later days on a copy and never save.
- Done, Skip and Undo update the block in place. Only plan changes (generation, edits, replanning) save a revision, and revisions are never pruned.
- Missing stays missing: a blank is "not reported", never zero.

## Consequences

- Past outcomes are stable. Streaks and progress read the same records every time.
- Explicit actions on a past date remain possible, because they are the user's choice.
- History grows. The 20 MB backup cap is not raised to hide that growth; a retention design is future work.
