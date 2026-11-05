# Changelog

All notable changes to Life OS are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). The saved data format (state, SQLite schema and backup) is versioned separately; see [docs/DATA_MODEL.md](docs/DATA_MODEL.md).

## Unreleased

## 1.4.0 - 2026-11-04

### Changed

- The source is licensed under the MIT License.
- The demo's fictional person has generic goals (running a 10K, learning guitar, saving for a trip) and a weekday career step. It still shows every kind of objective, record and chart.
- The Progress card for career objectives is titled Career, and the fold under History and details is Study calendar and career.
- My Trading Strategy starts from a five-step template to rewrite in your own words. A strategy already edited keeps its wording.
- Trading wording is neutral: a lost account set pauses live trading for 30 days, and live trading can be turned on for one live account you already trade. The rules and saved data are unchanged.
- A new study plan starts with the stages Learn and implement, Algorithm-recognition practice and Review mistakes, and no links until you add one.
- The counts in Your limits take digits only, as the number pad types.
- Start tracking, on the demo, is a button under the DEMO tag.
- Settings → About shows the version and where your data lives, without a health note.
- The documentation is a shorter set: a README with screenshots of the demo, an architecture overview with a guide to where to start reading, the data model, design decision records, a testing guide, the known limitations and a demo walk-through.

### Fixed

- Each new goal gets a unique id, so two goals added in quick succession no longer fail with a storage error.
- The analysis CSV also writes text that starts with a tab or a carriage return with a leading apostrophe, so a spreadsheet never reads it as a formula.

## 1.3.0 - 2026-11-02

### Changed

- A new look that follows the iPhone's light or dark appearance: warm paper with white cards in light, warm charcoal in dark, one accent for what is next and one green for what is done.
- The system's own type: SF Pro for text and SF Pro Rounded for numbers, in sentence case. Larger Text and Bold Text come from the system, and no fonts are bundled.
- Capsule buttons, round checks that fill when ticked, a floating tab bar, and a real switch for every on/off setting.
- Today opens with a greeting and a card that leads with what went well: yesterday cleared and the current run, or the days cleared in the last week. It never leads with a broken run or a zero.
- The day's objectives sit in one card; the next thing to do is highlighted, and a done row stays in place, dimmed.
- The Day Cleared celebration rolls the streak up from yesterday's number and lists what was achieved. Reduce Motion shows it at once.
- Progress leads with how far you have come, and each tile shows its change against the previous weeks.
- Week shows its shape at a glance, with a column per day that fills as the day is cleared.
- Settings is shorter and grouped, with Back up and Restore as two cards and the last backup time beside them.
- The trading cockpit's status band is a solid color with a symbol, and its reason and next step always wrap instead of being cut off.
- The widgets match the app in light and dark. What each widget shows, and keeps private, is unchanged.

## 1.2.0 - 2026-10-31

### Added

- Progress replaces Review as the fourth tab. One range control (4 weeks, 12 weeks or a year) drives key figures with their change and one chart card per question: consistency, body weight, strength, study, cardio, career, money, trading and habits. A card appears only for what you track.
- Charts can be read by dragging across them, with VoiceOver, or as a list.
- A morning anchor: give one checklist routine an Up by time. Each morning is judged against the time in force that day, Progress gets a Mornings card, and the time can show on the Lock Screen widgets.
- Restore my backup on the first screen of a new phone, and a notice after any restore listing what a backup cannot bring back.
- Start tracking turns the demo into your own plan and clears its fictional history.
- The order of the day: one order for Today's list and the Large list widget, editable from Programs or Today.
- The trading cockpit: a preparation screen before the session and a live screen with one shared entry status, two attempts per thesis, cooldowns, session caps and stops that nothing in the app lifts early. An unknown loss is never counted as zero.
- Live trading is off until it is turned on in Your limits, and the number of copied accounts grows only after clean live sessions.
- A round Lock Screen widget, and widgets that render in light, dark, tinted and StandBy modes.

### Changed

- Skip excuses an objective for the day. It never counts as done, but it leaves the day's count; a day with everything skipped and nothing done is not cleared.
- Skip on a rotation workout is Rest today: the workout moves to the next training day and the day can still be cleared.
- A workout rotation no longer needs workout plans.
- Today is one list in the order of the day, with study and trading as rows in place and a shorter header, so more of the list fits on the first screen.
- A tick shows at once that it is saving and re-renders only its row, so Today stays quick as history grows.
- Trading sessions are saved with the rest of the data and in backups (data version 5). Sessions kept by earlier versions move in once, and version 1 to 4 backups still restore.
- A restore leaves live trading off, as it does the widget's Day Cleared status.
- Only a row's circle ticks on the list widget, so an accidental tick is harder.
- Backup files are named by date and time.

### Fixed

- A study day done while study is optional counts as kept in the study streak.
- The circuit timer's countdown always shows the whole time on a narrow screen.
- A sheet left open across midnight saves to the day it was opened on.
- Re-importing a setup keeps routines added in the app, and today's planned occurrences follow a routine the import changed.
- Opening a sheet no longer puts focus on a full-screen dismiss control.
- Habits and Cardio no longer count a skipped day, or the weeks before an activity was planned, as misses.
- The web export clears its build cache, so Settings always shows the current version.
- A failed save says plainly that the change was not made.

## 1.1.0 - 2026-10-17

### Added

- Repeat a routine every 2 to 4 weeks. A missed occurrence never shifts the pattern.
- A weekly backup reminder on Today and the last backup time in Settings.
- The bias board for trading.
- The Large Today list widget, ticked from the Home Screen and recorded when the app opens.
- The Day Cleared celebration, the last seven days and progress moments, all read from records.
- An app icon, a splash screen and the app version in Settings.

### Changed

- Today is a checklist first; the week, focus, tomorrow and planning fold into More for today.
- Saving validates only the days that changed, and the streak walks stored days only.

### Fixed

- A past day can no longer be regenerated or replanned from Today, so recorded history and the streak stay as they were.
- Widget publishes run one at a time, so a tick from the widget is never applied twice.
- A checklist item never holds a calendar slot.
- A form hint no longer crashes the native app.

### Removed

- Unused Expo packages and the template's leftover screens and Android configuration.

### Security

- `shell-quote` 1.12.0.

## 1.0.0 - 2026-10-15

The first release: Today, Week, Programs, Review and Settings; checklist and timed routines with Done, Skip and Undo; Day Cleared and its streak with Protected days; workouts with rotations, circuits with an interval timer, study plans with reminders, money reviews, weekly weight, a life log, trading discipline records, the 90-day focus and the weekly review; setup import, a fictional demo, versioned backup and restore, analysis exports, and the small and medium Today widget.
