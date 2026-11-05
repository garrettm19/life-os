# Features

What the app does and the terms it uses. The rules behind them are in [decisions/](decisions/README.md), and the stored shapes are in [DATA_MODEL.md](DATA_MODEL.md). The domain tests in `src/domain/__tests__` hold the full behavior, edge cases included.

## The idea

Long-term goals are served by **programs** (strength training, a study plan, a morning routine). A program holds **routines**, each with its own schedule and way of recording. Each day, the routines that are due become **objectives** on Today. Done, Skip and Undo record what actually happened, and Progress reads those records back so the plan can be adjusted.

The app favors a few meaningful objectives over many checkboxes, keeps missing data missing (a blank is never zero), and treats rest days as part of the plan.

## Screens

Four tabs, each answering one question:

| Tab      | Question              | What it shows                                                                                                         |
| -------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Today    | What do I need to do? | A summary card (yesterday, the last seven days, how close today is to cleared), then one list in the order of the day |
| Week     | When?                 | A read-only Monday to Sunday agenda, with each day's done count and projected workouts                                |
| Programs | What am I following?  | Every program and routine, where objectives are created, edited and paused                                            |
| Progress | Am I improving?       | One time range for every chart, key figures, line and column charts of recorded values, and a weekly review           |

Settings opens from the header. Trading opens as a page above the tabs.

## Objective types

| Type                  | Completing it records                                  |
| --------------------- | ------------------------------------------------------ |
| Simple habit          | Done or Skip                                           |
| Alternating habit     | Done or Skip on the day's variant (A, B, A, B by date) |
| Timed session         | Done or Skip on a block placed on the clock            |
| Strength workout      | Working sets in a workout session                      |
| Timed circuit         | One session when an interval run reaches its end       |
| Study session         | One tap, or a timed session of stages                  |
| Body weight           | One measurement per date                               |
| Money review          | Three balances (cash, savings, debt)                   |
| Duration activity     | Activity type and actual minutes                       |
| Rule-adherence review | Checkpoints and any broken rule                        |
| Trading review        | Eight PASS or FAIL items and any hard violation        |

A record and the Done it earns are saved together, so neither exists without the other.

## Scheduling

- **Weekdays and repeats.** `onItsDays` in `src/domain/repeat.ts` is the one due-day rule: the date's weekday is one of the routine's weekdays, in one of its repeat weeks (weekly, or every 2 to 12 weeks). No default weekday is invented.
- **Rotations.** A program can rotate its workouts with rest weekdays. The next workout is derived from the latest completed one, never stored. Only the actual day gets its workout; later days show a projection. Skip on a rotation workout rests the program for the day, and the workout moves to the next training day.
- **Companions.** A routine can follow certain workouts (a stretch after leg day) and is due wherever they are.
- **Bundled steps.** A routine can appear as a step inside a session of its program. Day Cleared counts the steps, not the parent.
- **Optional objectives** are encouraged but never required.
- **Timed sessions.** A checklist item never holds a time. A timed session has a duration, a preferred start and an optional window. **Generate day** places sessions between the day's start and bedtime, around work hours and meetings. One that cannot be placed says why. **Replan** moves flexible blocks into free slots from now on.
- **Moving workouts.** A planned workout and the later ones in its program can move forward a day, with a preview. The move applies completely or not at all, and can be reversed exactly.
- **The order of the day.** One ordering rule (`dayListOrder` in `src/domain/day-order.ts`) sorts Today and the large widget. Changing the order rewrites no history.
- **Browsing.** Opening a past date creates nothing, and routine edits apply to today and later only ([ADR 4](decisions/0004-history-is-never-rewritten.md)).

## Day Cleared and streaks

A day is **cleared** when at least one required objective is done, every other required objective that is not skipped is done, and no due timed session is unplaced. A day where every required objective was skipped stays open. One function decides it everywhere ([ADR 3](decisions/0003-one-rule-for-day-cleared.md)).

| Outcome      | When                                                              |
| ------------ | ----------------------------------------------------------------- |
| Cleared      | The rule above holds                                              |
| Protected    | Not cleared, and the day has an explicit excuse (illness, travel) |
| Nothing due  | The day is saved, but nothing required was due                    |
| Not recorded | A past date that was never opened                                 |
| Open         | Something is due and the day is not cleared                       |

- **Day Clear streak.** A cleared day adds one, a protected day holds the run, and Nothing due and Not recorded change nothing. An open day that can no longer be finished ends the run.
- **Study streak.** Stricter and separate: a scheduled study day that was skipped or left open ends it. It is judged from the schedule the plan recorded for that date, never from today's settings.
- **Trading clean-session streak.** Counted from reviewed sessions only, never from profit.
- **Morning anchor.** One plain checklist routine can carry an "Up by" time. Progress shows how often it was ticked on time over the last seven mornings. The app never tracks or infers sleep.
- **Celebration.** One short celebration plays when a save on Today clears the day. There are no points, badges or leaderboards.

Streaks and progress moments are derived from records on every read, so Undo and edits to past days recalculate them.

## Progress

Charts plot recorded values only: no interpolation, no invented points and no scores. Each chart has a plain sentence above it ("95% of required objectives done in the last 4 weeks"), can be read by pressing and dragging, and has a list view for VoiceOver. A weekly review records one deliberate adjustment, or a choice to change nothing.

## Trading

A rules-based session checklist for a trader who wants to keep a written process. It never connects to a broker or reads a market, and every figure is the trader's own report.

The built-in rules (shown on **Rules & GEX**, from `src/domain/trading-rules.ts`) describe one higher-timeframe method, and the cockpit's typed checks follow them. The terms, as the app uses them:

- **HTF and LTF:** the higher and lower timeframe. The HTF candle sets the direction; the LTF only chooses the entry.
- **Daily candle:** the futures trading day, which opens at 6:00 PM New York time. A session belongs to its candle, never to the phone's date (`src/domain/market-clock.ts`).
- **GEX:** options gamma-exposure levels, which the trader reads from an outside source. The app stores no levels: it knows the two lock windows when a reading is valid (6:00 PM to 12:30 AM and 9:30 AM to 4:00 PM New York time) and records which one a plan was made under.
- **CISD:** a change in the state of delivery, a structure shift used to confirm an entry. A single wick or tap never confirms one.

**My Trading Strategy** is the trader's own method as text, started from five generic prompts. It is reference text, not rules the cockpit enforces; the one link is that Setup B cannot complete until its retake rule is written there.

- **Preparation**, before the session: the higher-timeframe bias, a one-line reason, a target and an invalidation price.
- **Your limits**, set outside the session: the instrument's point value and tick, a fixed dollar risk per trade, a thesis budget, a daily loss limit, a contract limit and a cooldown length. Position size is computed from the fixed risk and the structural stop.
- **The live screen** shows one status from `tradeStatus` ([ADR 10](decisions/0010-trading-status-table.md)): a wait, a restriction, a cooldown, a stop or "setup checks complete". It never says a trade is approved. **I FEEL RUSHED** starts a cooldown at any time.
- **At most two attempts per thesis** (two unless the trading profile sets one). A new thesis never resets losses, cooldowns or stops.
- **Practice only** until live trading is turned on in Your limits. A restore always turns it off again.
- **Review** after the session: eight PASS or FAIL items. A session is clean only with all eight and no hard violation.

These restrictions are app-level and tamper-evident, not a broker lockout. The broker's own daily loss limit and position limits are the controls that can stop an order.

## Widgets

- **Today** (small and medium): the current or next public timed objective, or the next open public objective on the list. Day Cleared status appears only if turned on in Settings, and a restore turns it off. On the Lock Screen (inline, rectangular and circular) it shows only the morning anchor's "Up by" time.
- **Today list** (large): up to seven public, required objectives in the order of the day. On iOS 17 or later a one-tap objective can be ticked there, and the app records it on the next open.

What each widget may show is in [DATA_PRIVACY.md](DATA_PRIVACY.md#home-screen-widgets).

## Data on the device

- **Backup and restore.** A versioned JSON file of the whole state, saved through the share sheet. Restore validates the file and previews, in counts and labels, what it would replace before anything changes.
- **Analysis export.** A CSV or JSON file of chosen categories and dates. It cannot be restored.
- **Setup import.** A `life-os-setup-v1` file merges programs and routines into the device, previewed from a dry run. It never touches recorded history.
- **Backup reminder.** One quiet line on Today when a backup is due, never a notification.
- **Study reminders** are the only notifications: local, opt-in and never naming a private objective.

## The demo

**Explore demo**, on the empty Today, loads six weeks of a fictional person's records: twelve goals, a strength rotation with companions, a timed circuit, study, a weigh-in, a weekly money review and paused trading practice. The data is built on the device by `src/domain/demo.ts` through the same functions the app uses when someone taps Done, so it is deterministic for a date. Every screen carries the tag "DEMO · fictional person and records".

To leave it, **Start tracking** keeps the demo's programs as your own and clears its history. Settings → Reset this device's plan returns to the empty app.

## Not built

- Sync, accounts, a backend, analytics or an AI service ([ADR 1](decisions/0001-local-first-no-backend.md)).
- External calendars, HealthKit, bank or broker connections, and market data.
- Android ([ADR 2](decisions/0002-ios-only-web-for-tests.md)).
- Sleep tracking, mood scores or trends, and engagement mechanics beyond the three streaks. A life-log entry can carry an optional self-rated mood and energy, but nothing charts or scores them.
