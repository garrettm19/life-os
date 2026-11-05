# 5. Separate, stepwise format versions

Status: accepted

## Context

The app keeps three persisted shapes: the in-memory `State`, the SQLite schema, and the backup file. They evolve at different times, and a phone may open data written by any earlier build, or receive a backup from a newer one.

## Decision

- The state version, the SQLite `user_version` and the backup format version are separate numbers (currently all 5).
- Each upgrades one step at a time from every earlier version (1 → 2 → 3 → 4 → 5), in one exclusive transaction that leaves existing rows untouched.
- A newer database or file is refused, never guessed at. Data that claims an older version but carries a newer version's lists is refused too.
- A new top-level list needs a version step. A new optional field inside an existing record does not, as long as records without it stay valid.
- Persisted identifiers (`life-os-v1`, `life-os-backup`, `life-os-setup-v1`, `LifeOS-backup-*.json`, the bundle identifier and the App Group) are never renamed.

## Consequences

- Any older backup still restores, and the upgrade path is tested against a real version-3 database and backup kept as fixtures.
- Upgrades are one-way: once a newer build opens the data, an older build refuses it. The [device checks](../TESTING.md#device-checks) say to export a backup before installing a build.
- The format history is documented in [DATA_MODEL.md](../DATA_MODEL.md).
