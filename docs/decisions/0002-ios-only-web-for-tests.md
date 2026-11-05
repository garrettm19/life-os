# 2. iOS is the only native target; the web build is for previews and tests

Status: accepted

## Context

The app is used on one iPhone. Its Home Screen and Lock Screen widgets exist only on iOS. Supporting Android would double the device checks for features nobody would use there. At the same time, there is no Mac in the build loop: iOS builds run on EAS, so a fast local loop needs something other than a simulator.

## Decision

- iOS is the only native target. There is no Android configuration.
- The Expo web build (`output: "static"`) serves two purposes: a browser preview of the app, and the target of the Playwright browser tests.
- Native adapters have `.web.ts` siblings: `localStorage` instead of SQLite, a download instead of the share sheet, no notifications. Widgets go the other way: the code is in `*.ios.tsx`, and the plain `.tsx` file is a no-op.

## Consequences

- Browser tests run on every pull request and catch layout, flow and accessibility-name regressions quickly.
- They never prove iPhone behavior. VoiceOver, Dynamic Type, safe areas, the keyboard, native SQLite, the share sheet, notifications and widgets need a device check. [TESTING.md](../TESTING.md) lists what each gate proves and what stays manual.
- Static prerendering means `/` renders before saved data loads. Anything that depends on saved data shows a fixed value until the app is ready, or hydration mismatches.
