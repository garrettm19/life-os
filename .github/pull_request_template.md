## What

<!-- The change, in a sentence or two. -->

## Why

<!-- The problem, issue or decision it follows. -->

## How it was tested

<!-- Each command with its result; anything skipped as "not run". -->

- [ ] `npm run verify`
- [ ] `npm run export:ios`, `npm run export:web` and `npm run test:web` (UI or native-facing changes)
- [ ] `npm run deps:check` and `npm run doctor` (dependency or native configuration changes)
- [ ] `test:ci` with `TZ=Pacific/Kiritimati` and `TZ=America/New_York` (date, time or schedule logic)
- [ ] A bug fix has a test that fails without it
- [ ] Device check needed on the next build, or not applicable

## Data and privacy

- [ ] No format change, or its version step and upgrade path are in `docs/DATA_MODEL.md`
- [ ] Synthetic data only; nothing private reaches a widget
- [ ] `CHANGELOG.md` and the docs are updated where behavior changed
