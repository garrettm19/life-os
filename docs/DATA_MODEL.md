# Data model

The saved data is one `State` object (`src/domain/model.ts`), validated and upgraded by `decodeState` (`src/domain/data.ts`) and the record validators in `records.ts`, `direction-records.ts` and `trading-live-model.ts`. How it is loaded and saved is in [ARCHITECTURE.md](ARCHITECTURE.md#data-flow).

## Current versions

| Item            | Version | Identifier                                                                 | Defined in                           |
| --------------- | ------- | -------------------------------------------------------------------------- | ------------------------------------ |
| App state       | 5       | `State.version`                                                            | `src/domain/model.ts`, `data.ts`     |
| SQLite schema   | 5       | `PRAGMA user_version` of `life-os.db`                                      | `src/data/storage.ts`                |
| Backup format   | 5       | `format: "life-os-backup"`, files named `LifeOS-backup-<date>-<time>.json` | `src/domain/backup.ts`               |
| Setup file      | 1       | `format: "life-os-setup-v1"`                                               | `parseSetup` in `src/domain/data.ts` |
| Analysis export | 1       | `format: "life-os-analysis-export"`, files `LifeOS-analysis-<date>`        | `src/domain/export.ts`               |
| Browser storage | —       | `localStorage` key `life-os-v1`, holding a version-5 state                 | `src/data/storage.web.ts`            |

The three main versions are separate and happen to coincide today ([ADR 5](decisions/0005-stepwise-versioned-formats.md)). Persisted identifiers keep their names across versions.

## Principles

- The plan (goals, programs, routines, each day's occurrences) is kept apart from what happened (statuses, actual times and records), from measurements and from self-reported observations. Nothing stored is inferred.
- A plan change never rewrites history ([ADR 4](decisions/0004-history-is-never-rewritten.md)).
- Derived values are computed on every read and never stored: Day Cleared, every streak, rotation progress, progress moments, the trading status and the restore preview.
- Every record has a stable ID and is validated on save, load, restore and import. Malformed data fails before anything is replaced.
- Missing is not zero: an unreported value is `null`, and nothing is interpolated.
- Dates are local calendar dates (`YYYY-MM-DD`), never truncated from UTC. Timestamps are ISO strings.

## Where integrity is enforced

| Guarantee                                                                                                | Code                                                                                                     | Tests                                                             |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Every way data enters is validated: load, each save, restore, setup import and Start tracking            | `decodeState` in `src/domain/data.ts`                                                                    | `src/domain/__tests__/records.test.ts`, `integrity.test.ts`       |
| A save is all or nothing, and a failed one forces a full rewrite next time                               | `saveState` in `src/data/storage.ts`                                                                     | `src/data/__tests__/storage.test.ts`, `data-safety.test.ts`       |
| A change is shown only after it is saved, one change at a time                                           | `change` in `src/state/app-state.tsx`                                                                    | `src/state/__tests__/app-state.test.ts`                           |
| Older data upgrades step by step; newer or half-new data is refused                                      | `upgrade` in `data.ts`, the migration in `db()` in `storage.ts`, `parseBackup` in `src/domain/backup.ts` | `src/data/__tests__/migration.test.ts`, `version-3-build.test.ts` |
| Replacing everything (restore, reset, demo, Start tracking) never revives a paused run from the old data | `replaceAllState` in `src/state/session-store.ts`                                                        | `src/state/__tests__/session-store.test.ts`                       |
| A backup never carries installation choices                                                              | `withoutInstallationChoices` in `backup.ts`                                                              | `src/domain/__tests__/backup.test.ts`                             |

## State

| Field                                                                                  | Contents                                                                                                                                    |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`, `source`                                                                    | `5`, and `empty`, `demo` or `personal`                                                                                                      |
| `goals`, `programs`                                                                    | The catalog, with routines inside programs                                                                                                  |
| `settings`                                                                             | The planning day, work commitments and device preferences                                                                                   |
| `days`                                                                                 | Recorded days by local date                                                                                                                 |
| `notes`                                                                                | Setup notes to review, shown in Settings                                                                                                    |
| `measurements`, `lifeLog`, `workoutTemplates`, `workoutSessions`, `moneyReviews`       | Personal records                                                                                                                            |
| `intervalRoutines`, `intervalSessions`, `activitySessions`, `ruleBooks`, `ruleReviews` | Circuits, activities, study sessions and rule reviews                                                                                       |
| `focuses`, `weeklyReviews`, `skillCheckpoints`                                         | Direction records                                                                                                                           |
| `tradingSessions`                                                                      | One trading session per daily candle, keyed by its date                                                                                     |
| `tradingSessionsUnreadable`, `tradingSessionsImported` (optional)                      | Sessions from earlier builds that could not be read, and whether the one-time move from device storage has run ([below](#trading-sessions)) |

### Goals, programs and routines

- A `Goal` has a title and its success criteria as written. Goals and programs link many-to-many.
- A `Program` has a title, a group, its `goalIds`, its `routines` and an optional `rotation` (the workout order, rest weekdays and starting workout). The next workout is derived from the latest completed one.
- A `Routine` keeps its ID through every edit. Its main fields: `title`, `duration` and `weekdays` (null when unknown), `preferredStart` and an optional window, `enabled`, `fixed`, `steps`, `bundledInto` (null unless bundled), and the optional `checklist`, `private`, `optional`, `capture` (`weight`, `money`, `activity` or `rules`), `follows` (companions), `alternate`, `repeat` (`{ everyWeeks, anchor }`), `study` (stages, reminders, and an append-only schedule), `dayOrder` and `anchor` (the morning "Up by" times, append-only).
- A routine has at most one of a workout plan, a timed circuit or a study plan.

### Days and occurrences

A `Day` is one recorded local date: its `blocks` (occurrences), `revisions` of earlier plans, and the optional `protection` (`{ reason, at }`), `dueTimed` (the timed routines due that date, recorded while it was today or later), `moved` (occurrences a shift moved away) and `rotation` (a rest or train override).

A `Block` has an `id`, `routineId` and `programId` (null for a manual block), `title`, `start` and `duration`, `fixed`, `status` (`planned`, `done` or `skipped`), `actualAt`, `steps`, and optional `bundledSteps` with their own statuses. A generated occurrence's ID is `<date>:routine:<routineId>`.

- Done, Skip and Undo update a block in place. Plan changes save the previous blocks as a revision with a time and reason.
- Opening Today, Generate day and Replan write only today and later. A past date with no saved `Day` reads as Not recorded.

### Records

Every record has a stable `id`; most have a local `date`, an ISO `at`, and an `occurrenceId` when it completed an objective (one record per occurrence). Lists are capped and text fields have length limits.

- **Personal:** body weight in whole grams with the value and unit as entered; life-log entries with optional self-reported energy and mood; workout plans and sessions (exercises keep a stable ID across plans, so their history is one); money reviews with cash, savings and debt in integer minor units.
- **Circuits, activities and reviews:** circuit definitions and completed runs; activity sessions, including timed study sessions with their stages; rulebooks and rule reviews, including the trading process and its PASS or FAIL reviews.
- **Direction:** a 90-day focus (at most one active), weekly reviews (one per Monday) and skill checkpoints.

### Trading sessions

`State.tradingSessions` holds one record per daily candle, keyed by the candle date (the session that opens at 6:00 PM New York time the evening before). The phone's own date never picks the record, so a session reads the same in every time zone.

A session holds the plan (bias, reason, target, invalidation), the `lock` written when it starts (practice or live, and the limits as they stood), the theses with their append-only status log, setup readings, attempts (entry, structural stop, contracts per account, planned risk, outcome and any reported loss), cooldowns, a session stop and a short log. Every list is appended to and never rewritten, and the status is always derived (`tradeStatus`), never stored. Older sessions recorded under an earlier cockpit keep their fields and still decode and review as they were.

Builds before version 5 kept sessions in device-only storage. On the first load of version-5 data they are moved into the state once (`importDeviceSessions`). A record that cannot be read is kept verbatim in `tradingSessionsUnreadable` and reported as a load failure, never overwritten.

## Device-only storage

These keys are never part of `State`, SQLite or a backup. They live in `expo-sqlite/kv-store` on iPhone and `localStorage` in the browser, and are validated when read.

| Key                                      | Contents                                                      |
| ---------------------------------------- | ------------------------------------------------------------- |
| `life-os-active-circuit:<occurrence ID>` | The circuit in progress; it reads back paused                 |
| `life-os-active-study:<occurrence ID>`   | The study session in progress, with a wall-clock anchor       |
| `life-os-trading-session:<date>`         | A session from a build before version 5, read once to move it |

Widget timelines live in the App Group container. Their published fields are listed in [DATA_PRIVACY.md](DATA_PRIVACY.md#home-screen-widgets).

## SQLite tables

Each table is a primary key and a validated JSON `payload`. `metadata` holds one row with the version, source, settings and notes. `days` and `trading_sessions` are keyed by date, and every other table by record `id`.

| Schema | Adds                                                                                        |
| ------ | ------------------------------------------------------------------------------------------- |
| 1      | `metadata`, `programs`, `goals`, `days`                                                     |
| 2      | `measurements`, `life_log`, `workout_templates`, `workout_sessions`, `money_reviews`        |
| 3      | `interval_routines`, `interval_sessions`, `activity_sessions`, `rule_books`, `rule_reviews` |
| 4      | `focuses`, `weekly_reviews`, `skill_checkpoints`                                            |
| 5      | `trading_sessions` (18 tables in all)                                                       |

## Files

- **Backup** (`life-os-backup`): `{ format, version, createdAt, state }`, at most 20 MB. It leaves out the widget's Day Cleared opt-in, the live trading switch and the last backup time, so a restore leaves the first two off. Restore accepts formats 1 to 5 and upgrades them; export always writes the current one. A restore replaces the whole state after a preview and confirmation; nothing is merged.
- **Setup** (`life-os-setup-v1`, at most 2 MB): goals and programs, and optionally settings, workout plans, circuits and rulebooks. It is previewed from a dry run, then merged by ID. Recorded history is never touched, choices made in the app are kept, and it never turns live trading on.
- **Analysis export** (`life-os-analysis-export`, version 1): CSV or JSON, one value per row (category, date, item, field, value, unit, note), for the categories and dates chosen. It cannot be restored.

## Upgrades

- State, schema and backup each upgrade one step at a time (1 → 2 → 3 → 4 → 5). Each step adds its new lists empty and changes nothing else.
- SQLite migration runs in one exclusive transaction; a failure leaves the previous version untouched. A newer `user_version` is refused.
- Data that claims an older version while carrying a newer version's lists is refused, so newer data is never half-read.
- A new top-level list or field needs a version step. A new optional field inside a record does not, as long as records without it stay valid.
- An upgrade is one-way: once a newer build opens the data, an older build refuses it.

| Version | Added                                                                              |
| ------- | ---------------------------------------------------------------------------------- |
| 1       | Goals, programs, settings, days and notes                                          |
| 2       | Body weight, life log, workout plans and sessions, money reviews                   |
| 3       | Circuits, activity sessions, rulebooks and rule reviews                            |
| 4       | Focus, weekly reviews, skill checkpoints                                           |
| 5       | Trading sessions moved from device-only storage into the state, SQLite and backups |
