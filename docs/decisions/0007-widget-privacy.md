# 7. Widgets publish as little as possible

Status: accepted

## Context

Anyone holding the unlocked phone can read the Home Screen, and anyone who sees the phone can read the Lock Screen. The widgets run in a separate extension that cannot read the app's database.

## Decision

- The app publishes widget timelines into the shared App Group after each save and when it opens or returns to the foreground. Each timeline ends with a midnight entry that asks to open the app, so a widget never shows yesterday's plan. The widgets render only those props and never touch SQLite.
- Private titles, private counts, steps, notes, streaks, recorded figures and any trading status never reach a widget, in any state or size.
- The Today widget shows Day Cleared only after an explicit opt-in in Settings. The status is derived from every objective, private ones included, so it is off by default. It belongs to the installation: backups never carry it, and a restore leaves it off.
- The Lock Screen accessory shows only the morning "Up by" time and nothing else.
- The large Today list widget can tick a one-tap objective. The tick waits in the widget's timeline, and the app records it as Done at the tap time on its next open, only if the objective is still planned, public and one-tap.
- Widget layouts carry the `'widget'` directive and are serialized alone into the extension, so they use nothing from module scope.

## Consequences

- Unit tests check that published timelines contain no private data and evaluate the serialized layouts with stub components.
- iOS decides when widgets redraw. No refresh time is promised, and widget rendering is checked on a device.
