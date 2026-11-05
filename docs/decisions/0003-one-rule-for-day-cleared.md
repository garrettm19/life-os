# 3. One stored rule for Day Cleared

Status: accepted

## Context

Day Cleared is the app's finish line for a day. Today's board, the Day Clear streak and its history, the widget's optional status, the celebration, Week and Progress all need to know whether a day was cleared. In an early version Today and the streak computed it separately and disagreed on edge cases.

## Decision

- `dayProgress` and `dayOutcome` in `src/domain/objectives.ts` are the only definition. Every surface calls them, and nothing computes "cleared" a second way.
- A day is cleared when every required objective that is not skipped is done and no due timed session is still unplaced.
- **Skip** is never completion credit, but it excuses the objective for that day: it leaves the count. A day where every required objective was skipped and nothing required was done is not cleared.
- **Protected** holds the streak without adding to it. A past day that was never opened is **Not recorded** and is neutral: it neither breaks nor extends the streak.
- A bundled parent is a container: its steps count, not the parent.
- Streaks (current and best) are derived from dated records on every read and never stored as counters, so Undo and past edits recalculate them.
- The game layer is closed: Day Clear progress and streak, the study streak, the trading clean-session streak and one Day Cleared celebration. There are no points, badges or leaderboards.

## Consequences

- Today, the streak and the widget agree by construction, and the rule has one set of tests.
- Changing what "cleared" means is a single, reviewable change. Because outcomes are derived, a rule change re-reads history without rewriting any record.
- A private objective still counts in the app's own total. The widget's day status is therefore an explicit opt-in (see [ADR 7](0007-widget-privacy.md)).
