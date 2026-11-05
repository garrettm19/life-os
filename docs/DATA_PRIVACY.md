# Data privacy

Life OS holds personal information: body weight, money summaries, workouts, private notes and trading discipline records. Privacy is part of the architecture: the data stays on the device ([ADR 1](decisions/0001-local-first-no-backend.md)), and the few places where it can leave are controlled in code. [SECURITY.md](../SECURITY.md) covers reporting a problem.

## Principles

- Collect less. When it is unclear whether a piece of personal information is needed, it is not collected.
- Data leaves the device only in a file the user exports, holding only what that file is documented to contain.
- The plan, what happened, measurements, observations and calculations stay distinct. An inference never becomes a user-entered fact.
- Health, money and trading routines are recorded as entered. They are not advice, and the app never changes them on its own.

## Private objectives

A routine or a single occurrence can be marked private. Routines that record weight or money, rule reviews and the trading routine start private. A private title or count never reaches the Home Screen, the Lock Screen or a notification, and stays out of an analysis export unless explicitly included.

## On the device

- **iPhone:** SQLite (`life-os.db`) in the app sandbox, protected at rest by the passcode and iOS data protection. It is not an encrypted vault.
- **Browser preview:** one `localStorage` document, in that browser only.
- **Device-only slots:** a circuit or study session in progress, and, on a phone that ran a build before data version 5, the trading sessions that build kept (copied into the saved data once and also left in place). The device-only copies are not in a backup.
- **Widget timelines:** unencrypted in the App Group container, replaced on each publish and never transmitted.
- **Reset** clears the saved plan, history and any session in progress after a confirmation. Trading sessions kept by a build before data version 5, already copied into the saved data, stay in device storage. Deleting the app deletes everything not exported.
- **Permissions:** notifications only, requested when a study reminder is switched on. No microphone, no push entitlement and no background mode.

## Home Screen widgets

Anyone holding the unlocked phone can read the Home Screen, and anyone who sees the phone can read the Lock Screen, so the widgets publish as little as possible ([ADR 7](decisions/0007-widget-privacy.md)).

- No widget shows steps, notes, programs, goals, history, private titles, private counts, streaks, any recorded figure, or any trading status, plan or price.
- No widget shows a done or remaining count. If a public surface ever does, it must use the non-private subset (`dayProgress` with `publicOnly`), so a hidden objective cannot leak through a denominator.
- Titles, times and statuses are marked `privacySensitive`, so iOS can redact them where it hides sensitive widget content.
- **Today** (small and medium): the current or next public timed objective and the one after it; with none left on the clock, the next open public objective from the list.
- **Lock Screen:** only the morning anchor's "Up by" time, never its title. Adding the accessory is the choice to show that one time.
- **Day Cleared** on the Today widget is an explicit opt-in, off by default. It reflects private objectives too, so it says something coarse about the day, never which objective remains. It belongs to the installation: backups never carry it, and a restore leaves it off.
- **Today list** (large): up to seven public, required objectives with their times and done state. A tick there waits in the widget's timeline until the app records it.

Unit tests check that published timelines contain no weights, amounts, sets, exercise names, log text or ratings.

## Notifications

Study reminders are local notifications held by iOS. A private study objective is never named ("Your study objective is on today's plan."), and no notification includes a recorded figure or any trading content. The backup reminder is a line on Today, never a notification.

## Files

- **Backup:** an unencrypted JSON file with the complete saved state, saved wherever the user chooses. It never carries the widget opt-in, the live trading switch or the last backup time. The restore preview shows counts and labels, never values.
- **Analysis export:** only the categories and dates the user selects, after a preview. Sensitive categories (the life log, rule reviews) and private routines are off by default and warn when included. Trading sessions, the focus, weekly reviews and skill checkpoints are not exported.
- **Setup file:** a personal configuration that reaches the app only through the local import, with a preview and confirmation. Real setup files stay out of the repository.

## External services

Life OS sends nothing anywhere: no server, analytics, cloud sync, calendar, push service, broker, market data or AI service. Fonts are the system's and sounds are bundled. A link added to a routine (HTTPS only) opens in the browser only when tapped. The only way data reaches another tool is an export the user makes and shares.

## The repository

- Code, tests, fixtures, screenshots and issues use synthetic data or the fictional demo only. A fixture is never a modified real record.
- Never committed: `.env` files, credentials, signing material, real setup files, backups, analysis exports and databases. The synthetic version-3 database and backup used by the upgrade tests are the only data files. `private/`, `local-data/` and `docs/private/` are Git-ignored.
- No personal data goes into logs, crash reports, source code or example screenshots, and the error screen never shows error text, which could contain plan details.
- No privileged secret ships in the client. `EXPO_PUBLIC_*` variables hold only values that are safe for anyone to see.
