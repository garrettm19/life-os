# Demo guide

A three-to-five-minute walk through Life OS for a technical conversation. It runs in the browser preview with the built-in demo, a fictional person's six weeks, so it needs no phone and shows no real data. Each step names the engineering idea it illustrates and where that idea lives in the code.

## Before you start

1. Install and start the browser preview (Node 24.19 or a later 24.x, per `.nvmrc` and the `engines` range, and npm):

   ```sh
   npm ci
   npm run web
   ```

   Open the URL Expo prints. To show the exact build the browser tests run against instead, use `npm run export:web` and `node scripts/serve-preview.mjs`, then open `http://127.0.0.1:8087`.

2. Use a phone-sized window, for example the browser's device mode at 390 pt wide.
3. Start from the empty app: a private window, or Settings → Reset this device's plan if the demo was loaded before.
4. Optional: have `src/domain/objectives.ts` and `src/state/app-state.tsx` open in an editor for the last step.

A native build on an iPhone can show the same steps, plus the widgets and haptics, but nothing below depends on it.

## The walk-through

| Time | Do                                                                                                                               | What it shows                                                                                                                                                                                                                                       | Where                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 0:00 | On the empty Today, tap **Explore demo**.                                                                                        | The demo replaces the empty state in one change and is labeled "DEMO · fictional person and records" on every screen. It is generated on the device through the same domain functions a tap uses, so it is deterministic for a date and ends today. | `src/domain/demo.ts`, `replaceAllState` in `src/state/session-store.ts`                                         |
| 0:30 | Tap the check on **Morning**. The count goes from 0/6 to 1/6.                                                                    | Every write is one pure operation, queued and saved before the screen shows it; the check fills only after the save.                                                                                                                                | `change` in `src/state/app-state.tsx`                                                                           |
| 0:50 | Tap **Skip** on the strength workout (**Chest / Triceps / Shoulders B**). The count becomes 1/4.                                 | Skip is not credit, but it excuses the objective for the day. Skipping a rotation workout rests the program: the workout moves to the next training day, and the routines that follow it leave today too.                                           | `dayProgress` in `src/domain/objectives.ts`, `skipObjective` in `src/domain/rotation.ts`                        |
| 1:20 | Tick **Mobility**, **Career step** and **Coding practice**.                                                                      | The day is cleared: the celebration shows the streak going up from 1 to 2. Day Cleared and the streak come from one rule, and the streak is derived from stored days on every read, never kept as a counter.                                        | `dayOutcome`, `dayClearRuns` in `src/domain/objectives.ts`; [ADR 3](decisions/0003-one-rule-for-day-cleared.md) |
| 2:00 | Close the celebration and reload the page. Today still reads "All 4 done".                                                       | The change was saved, not just rendered. On load the whole state is validated and upgraded by one decoder. The browser keeps one `localStorage` document; the phone uses SQLite.                                                                    | `decodeState` in `src/domain/data.ts`, `src/data/storage.web.ts`, `src/data/storage.ts`                         |
| 2:20 | Open **Week**. Monday reads "4 of 4 · Cleared"; Tuesday shows the moved workout as "projected".                                  | Later days are computed on a copy and never saved, so looking ahead or back never creates or rewrites a record.                                                                                                                                     | `src/domain/week-agenda.ts`, `src/domain/preview.ts`; [ADR 4](decisions/0004-history-is-never-rewritten.md)     |
| 2:45 | Open **Programs**, then **Workout rotation** under Strength.                                                                     | The rotation's order and rest days, and the next days it implies. The next workout is derived from the last one completed, so a rest day, a missed day or an Undo can never put the sequence out of step.                                           | `nextWorkout` in `src/domain/rotation.ts`                                                                       |
| 3:10 | Open **Progress**. The Day Clear streak reads 2 days.                                                                            | The same rule, read back over time. Charts plot recorded values only; a gap stays a gap.                                                                                                                                                            | `src/domain/progress.ts`, `src/ui/line-chart.tsx`                                                               |
| 3:30 | Settings → **Backup and restore** → **Export backup**. The browser downloads `LifeOS-backup-<date>-<time>.json`.                 | A versioned JSON file of the whole state, validated as it is written. The widget's Day Cleared opt-in, the live trading switch and the time of the last backup are left out.                                                                        | `encodeBackup` in `src/domain/backup.ts`                                                                        |
| 3:50 | Back on Today, **Undo** Career step (3/4). Then Settings → Backup and restore → **Choose backup to restore**, and pick the file. | The file is parsed and validated before anything changes, and the preview compares it with the device by record: "planned days: 1 replaced by the backup's version". It shows counts and labels, never values. Closing it changes nothing.          | `parseBackup` in `backup.ts`, `restorePreview` in `src/domain/restore-preview.ts`                               |
| 4:20 | Tap **Restore and replace saved data**, then open Today. It reads "All 4 done" again.                                            | Restore replaces the whole state through the same single writer as every other change; nothing is merged.                                                                                                                                           | `replaceAllState` in `src/state/session-store.ts`                                                               |
| 4:40 | Optional: show `dayProgress` and `dayOutcome`, or `change`, in the editor.                                                       | The code behind the last four minutes is short and has no framework imports in the domain layer.                                                                                                                                                    | [ARCHITECTURE.md](ARCHITECTURE.md#where-to-start-reading)                                                       |

To end, Settings → Reset this device's plan returns to the empty app.

## What to say about the limits

- This is the browser preview, not the phone. Widgets, haptics, notifications, VoiceOver, Dynamic Type and native SQLite are not shown, and the browser tests do not prove them; they are checked by hand on a device.
- The demo is fictional and generated for today's date. The top of Progress shows the fictional person's money and weight figures.
- Everything stays on one device: no sync, no account, and backups are unencrypted files the user keeps.
- If saved data ever cannot be read, the app overwrites nothing but offers only Retry.
- The trading feature is a self-reported checklist; it never connects to a broker.

The full list is in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## How this guide was checked

Every step was walked with Playwright against `npm run export:web`, in Chromium at 390 × 844 pt, with the clock set to Monday, November 9, 2026, 9:00. The counts, labels and outcomes above are what that run showed. On another day:

- The objectives due and the counts depend on the weekday. The demo's strength program rests on Wednesday and Sunday, so on those days there is no workout to skip; skip any other objective to show the same rule.
- The demo ends on the current date, so the dates on Week, Progress and the backup file name differ.
- `npm run web` (the development server) behaves the same for these steps; it was not used for the check.
