# Testing

Two kinds of evidence count, and they are kept apart. The automated gates prove the domain rules, storage, bundling and browser behavior on every change. Device checks prove what only an iPhone can show. Tests, fixtures and screenshots use synthetic data or the fictional demo only.

## Automated gates

| Command                                    | Evidence for                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `npm run verify`                           | Types, lint (no warnings), unit and SQLite tests, and formatting             |
| `TZ=… npm run test:ci`                     | The unit suite in a far-east and a daylight-saving [time zone](#time-zones)  |
| `npm run export:ios`, `npm run export:web` | The iOS (Hermes) bundle and the static web build compile                     |
| `npm run test:web`                         | Browser behavior and the [layout gate](#layout-gate), against the web export |
| `npm run deps:check`, `npm run doctor`     | Dependencies match Expo SDK 57 and pass Expo Doctor                          |
| `npx expo config --type introspect`        | The App Group is the only entitlement, with no push and no background mode   |

CI runs all of them except the introspection on every pull request and push to `main` ([`ci.yml`](../.github/workflows/ci.yml)).

### Running one test

```sh
npx jest src/domain/__tests__/objectives.test.ts      # one unit test file
npx jest -t "skipped"                                 # unit tests whose name matches
npm run export:web && npx playwright test e2e/day-cleared.spec.ts   # one browser spec
```

Where the central behaviors are tested:

| Behavior                                            | Unit tests                                                                                                         | Browser tests                                                      |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Day Cleared, Skip as an excuse, the streak          | `src/domain/__tests__/objectives.test.ts`, `scale.test.ts`                                                         | `e2e/day-cleared.spec.ts`, `e2e/today-skip.spec.ts`                |
| The change queue: one at a time, saved before shown | `src/state/__tests__/app-state.test.ts`                                                                            | `e2e/tick-feedback.spec.ts`                                        |
| Incremental saves, rollback, malformed rows         | `src/data/__tests__/storage.test.ts`, `data-safety.test.ts`                                                        | –                                                                  |
| Upgrades from earlier versions                      | `src/data/__tests__/migration.test.ts`, `version-3-build.test.ts`, `src/domain/__tests__/version-3-backup.test.ts` | –                                                                  |
| Backup, restore and the restore preview             | `src/domain/__tests__/backup.test.ts`, `restore-preview.test.ts`                                                   | `e2e/backup-restore.spec.ts`, `e2e/restore-preview.spec.ts`        |
| Scheduling: repeats, rotations, Generate day        | `src/domain/__tests__/repeat.test.ts`, `rotation.test.ts`, `planner.test.ts`                                       | `e2e/repeat.spec.ts`, `e2e/rotation.spec.ts`, `e2e/blocks.spec.ts` |
| Widget timelines and privacy                        | `src/domain/__tests__/widget.test.ts`, `widget-list.test.ts`, `src/widget/__tests__`                               | –                                                                  |
| The demo                                            | `src/domain/__tests__/demo.test.ts`                                                                                | `e2e/demo.spec.ts`, `e2e/start-tracking.spec.ts`                   |

### Unit tests

Unit tests sit in `__tests__` folders beside the code, mostly in `src/domain`. They cover:

- Day Cleared and the streaks through the one stored rule, reconciliation of today and later only, rotations, repeats, setup import, backups and the restore preview, reminder planning, and the demo for every weekday.
- Storage against real SQLite: `node:sqlite` behind a stand-in for `expo-sqlite`, running the production SQL. Migrations from every earlier version, incremental saves, rollback, refusal of malformed rows, and the 20 MB backup cap.
- A database and backup written by a version-3 build (`src/data/__tests__/fixtures/`), which must upgrade to the current version unchanged.
- The widget layouts as the extension receives them (serialized, with stub components), in every state, size and mode, and the props they publish, checked for private data.
- Every row of the trading status table, true and false, with its missing-data behavior.
- WCAG contrast for every text and mark color in both appearances (`src/ui/__tests__/theme.test.ts`).

### Time zones

The app works in local calendar dates, so the unit suite runs in three zones. UTC is the runner's default. `Pacific/Kiritimati` (UTC+14) catches code and tests that build "now" from UTC instants. `America/New_York` runs the daylight-saving tests (the 25-hour day, the repeated 1 AM hour), which skip themselves in other zones.

Tests build dates with local constructors (`new Date(2026, 10, 9, 9)`), and browser tests pin the clock (`seed(page, state, { clock })` in `e2e/support/storage.ts`) or derive dates from today, so no test depends on a date staying in the future. `TZ` only counts when it is set at process start; setting `process.env.TZ` inside a Jest test does nothing.

### Layout gate

`e2e/layout.spec.ts` opens every main screen with a crowded synthetic month at 320, 375, 390 and 430 pt wide, and reads each screen one screenful at a time while scrolling. A screen fails when the page scrolls sideways, when its main action is not on the first screen, or when the probe (`e2e/support/layout-probe.ts`) reports:

- **overflow:** text outside the screen;
- **clipped:** text cut off by a fixed-size box without an ellipsis;
- **overlap:** text or controls on top of each other by more than 3 pt;
- **target:** a control smaller than 44 × 44 pt (calendar days: 44 pt tall, at least 32 pt wide).

Other specs run the same probe over Progress with three months of history, every kind of Today row at doubled text size, and the full-screen circuit timer in every state. There are no pixel baselines.

The optional sweep `e2e/screenshots.spec.ts` captures every screen and sheet at each width into the Git-ignored `screenshots/` folder, with the probe's findings:

```sh
npm run export:web
SCREENSHOT_DIR=screenshots/run npx playwright test e2e/screenshots.spec.ts
```

`SCREENSHOT_WIDTHS=375` and `SCREENSHOT_ONLY=progress,today` narrow a run.

### What browser tests cannot prove

React Native Web is not iOS. A browser pass never proves fonts, Dynamic Type, safe areas, the keyboard, VoiceOver focus order and announcements, long press and haptics, native SQLite, the share sheet and the document picker, notifications, audio, widget rendering and refresh, or speed on the phone.

## Device checks

There is no automated native gate: iOS builds come from EAS, and native behavior is checked by hand on a preview build on an iPhone. A change needs a device check when it touches any of the areas above.

Before installing a build, export a backup and keep a copy off the phone. Install over the existing app; never install an older build over a newer one, because a data upgrade is one-way.

Checklist for a release candidate, in light and dark:

1. The app opens on existing data after the upgrade, and a backup exported before it restores with an accurate preview.
2. Today: tick, Skip and Undo; the count, Day Cleared, the celebration and the streak agree.
3. A rotation workout: log sets, finish, Undo reopens the session; Skip moves it to the next training day.
4. Generate day and Replan place timed sessions around work hours; an unplaceable one says why.
5. Programs: add, edit and pause a routine; past days are unchanged.
6. The circuit timer runs with the screen on, survives backgrounding, and cues mix with music.
7. A study session keeps time in the background; its reminder arrives and names no private objective.
8. Widgets: small, medium, large and Lock Screen show the right item; a tick on the large widget is recorded on the next open; nothing private appears.
9. The Day Cleared widget status appears only when turned on, and a restore turns it off.
10. Trading: preparation, practice session, I FEEL RUSHED cooldown and review; live trading stays off after a restore.
11. VoiceOver reads every row, check and chart list; Dynamic Type at the largest sizes keeps every main action reachable.
12. Export a backup and an analysis file through the share sheet; Reset returns to the empty app.

## Known limitations

What the app and its checks cannot do yet, including everything that is verified only by hand on a device, is in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).
