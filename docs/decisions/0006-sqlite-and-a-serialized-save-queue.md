# 6. SQLite with a serialized save queue

Status: accepted

## Context

Every tap that changes data must be stored before the UI acknowledges it, and two quick taps must not race. History grows by a day at a time, so saving the whole state on every tap would get slower each month.

## Decision

- Every write goes through one function, `change(operation)` in `src/state/app-state.tsx`. Changes run one at a time, and each receives the latest committed state.
- An operation is a pure domain function that returns the next `State` or throws an error the screen can show.
- `saveState` writes in one exclusive SQLite transaction. Each record list has its own table of JSON payloads keyed by id or date. Only rows whose content changed are written. Days and trading sessions whose content matches the last saved copy are not validated again; everything else is. Rows are compared by their serialized content, not by object identity.
- The provider swaps in the new state only after the save succeeds. A failed save keeps the previous state and shows the error.
- A record and the status it completes (a finished workout and its Done) are saved in the same change.
- Reset, restore, Explore demo and Start tracking all go through one function, `replaceAllState`.

## Consequences

- There is no half-written state and no lost tap. A failed load is shown with Retry and is never reset automatically.
- However long the history, a save validates and writes only the days and sessions that changed. Every row is still serialized to compare it, so that part of a save's cost grows with history ([known limitations](../KNOWN_LIMITATIONS.md#data-and-storage)).
- Storage tests run the production SQL on Node's built-in SQLite, so the save path is tested without a phone.
