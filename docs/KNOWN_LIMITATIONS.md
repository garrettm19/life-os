# Known limitations

The constraints and open issues of the current version, in one place. Each item is a fact about the code or the way it is checked. Nothing here is planned work presented as done; possible next steps are listed at the end.

## Verification

- **iPhone behavior is checked by hand only.** The automated gates run on Linux: unit tests in Node and browser tests against the web build in Chromium ([TESTING.md](TESTING.md)). There is no native end-to-end runner and no iOS simulator in CI. Fonts, Dynamic Type, safe areas, the keyboard, VoiceOver, haptics, native SQLite, the share sheet, the document picker, notifications, audio and widgets are covered only by the [device checklist](TESTING.md#device-checks), and the repository keeps no record of device runs.
- **Expo Go is not a supported way to run the app, and it has not been tested.** The widgets, their App Group and the widget extension need a native build of this project, and the widget layouts also load `@expo/ui` when the app starts. The supported ways to run the app are the web preview and a native build.
- **Local native builds are untested.** iPhone builds come from EAS. `npx expo run:ios` on a Mac is the standard Expo path but has not been exercised for this project.
- **iOS only.** There is no Android configuration ([ADR 2](decisions/0002-ios-only-web-for-tests.md)).

## Data and storage

- **No sync and no second device.** All data stays on one device ([ADR 1](decisions/0001-local-first-no-backend.md)). Moving to a new phone means a backup and a restore, and a restore replaces the whole state after a preview; nothing is merged.
- **Backups are unencrypted JSON** saved wherever the user chooses. SQLite on the phone relies on the app sandbox and iOS data protection, not app-level encryption.
- **The 20 MB backup cap has no retention design.** History grows by design ([ADR 4](decisions/0004-history-is-never-rewritten.md)). Nothing warns before a backup nears the cap; export then refuses with an explanation and changes nothing.
- **Unreadable saved data leaves the app on Retry.** A load that fails overwrites nothing, but restore and Reset are out of reach until the data reads again.
- **Upgrades are one-way.** Once a newer build opens the data, an older build refuses it ([ADR 5](decisions/0005-stepwise-versioned-formats.md)).
- **Each save serializes every row.** Unchanged rows are not written, and unchanged days and trading sessions are not validated again, but each save still turns every row into JSON to compare it with the last saved copy and validates every other record, so the CPU cost of a save grows with history. It has not been measured on a phone.
- **Settings keys named for one schedule.** The work commitments are stored as `scrumStart`, `thursdayMeetingStart` and `eveningWorkMinutes`. Renaming them needs a state version step, so they keep their names.

## Platform behavior

- **Widget refresh is up to iOS.** iOS sets each widget's reload budget, so no refresh time is guaranteed. A tick on the large widget is recorded only when the app next opens.
- **The study reminder repeats.** The daily study reminder also arrives on a day already studied, because iOS cannot skip one occurrence of a repeating notification.

## Trading

- **Restrictions are self-reported and app-level.** Stops, cooldowns, attempt limits and practice only are records in the app, not access control. Restoring an older backup, editing data outside the app or moving the phone's clock can roll them back, and nothing reaches a broker. The broker's own limits are the controls that can stop an order ([ADR 10](decisions/0010-trading-status-table.md)).
- **No market-holiday calendar.** The market clock knows New York time and the daily candle, but not exchange holidays or early closes; a holiday needs a planned day away.

## Code

- **Large modules.** `trading-live.ts`, `cockpit.tsx`, `progress.ts` and `trading.ts` are 1,500 to 1,800 lines each. The Today and Programs screens (`src/app/index.tsx`, `src/app/programs.tsx`) are about 1,200 lines and hold their sheet state in many `useState` hooks.
- **A flat `src/ui`.** About 95 components, sheets and helpers sit in one folder, mostly with inline style objects.
- **Single-user shortcuts in planning.** Travel time (`gymTravel`) is added only to the program with ID `gym` (`planner.ts`, `sequence.ts`), a routine can have a Thursday-only start (`thursdayStart`), and `replanDay` recognizes the blocks it must not move by the text their reason starts with rather than a typed code.
- **Import cycles in the domain.** `data.ts` imports the trading-session validator, and modules reached from it (`trading.ts`, `workouts.ts`, `rotation.ts`, `intervals.ts`) import `withDay` back from `data.ts`. A development build prints these as require-cycle warnings when the app starts.
- **Hand-written decoders.** Validation is explicit code rather than a schema ([ADR 8](decisions/0008-no-state-chart-or-schema-library.md)), so a new field means editing its validator by hand.

## Possible next steps

Not started:

- A recovery path from unreadable data: offer restore from a backup file on the error screen.
- Splitting the large screens into sheet components and hooks, and the large domain modules by concern.
- Grouping `src/ui` by feature.
- A retention design before history nears the backup cap.
- Running the CI checks as parallel jobs.
- Renaming the schedule-specific settings keys with a state version step.
- Typed reason codes for blocks and travel time per program instead of by program ID.
- Moving `withDay` out of `data.ts` so the domain has no import cycles.
