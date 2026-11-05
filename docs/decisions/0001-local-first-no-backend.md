# 1. Local-first, with no backend

Status: accepted

## Context

The app records personal material: routines, workouts, body weight, money summaries and trading discipline. Planning a day, recording what happened and reading progress back are all deterministic and fit on one phone. A server would add an account, hosting, a privacy policy for data in transit and at rest, and a second copy of the data to keep consistent.

## Decision

- All data lives on the device: SQLite on iPhone, `localStorage` in the browser preview.
- There is no backend, account, analytics, cloud sync, external calendar or AI service.
- Data leaves the device only in a file the user exports (a backup or an analysis export), through the share sheet.
- No privileged credential ships in the client. `EXPO_PUBLIC_*` variables hold only values that are safe to disclose.
- A remote service is added only for a concrete need the device cannot meet, and it never holds the canonical data.

## Consequences

- The user owns backups. The app makes them explicit: a versioned JSON file, a restore preview, and a quiet reminder on Today when one is due.
- There is no sync between devices. Moving to a new phone means a backup and a restore.
- Privacy rules can be enforced in code at a few exits (widgets, notifications, files) instead of across a network boundary. See [DATA_PRIVACY.md](../DATA_PRIVACY.md).
- Every feature has to work offline, and so does every test.
