# Contributing

How a change is made and checked, and the rules every change keeps. What the app does is in the [README](README.md) and [docs/](docs/).

## Setup

Node 24.19 or a later 24.x (`.nvmrc` pins 24.19.0) and npm, with the committed lockfile:

```sh
npm ci
npm run web                          # browser preview
npx playwright install chromium      # once, for the browser tests
```

To use a local Chrome instead, set `PLAYWRIGHT_CHROMIUM_PATH` (and extra flags as a JSON array in `PLAYWRIGHT_CHROMIUM_ARGS`). Every script is listed under [Scripts](#scripts).

## Checks

| Change                       | Run                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Every change                 | `npm run verify` (typecheck, lint, unit and SQLite tests, format check)        |
| UI or native-facing code     | `npm run export:ios`, `npm run export:web`, then `npm run test:web`            |
| Dependencies                 | `npm run deps:check`, `npm run doctor`                                         |
| Native configuration         | The dependency checks and `npx expo config --type introspect`                  |
| Date, time or schedule logic | `TZ=Pacific/Kiritimati npm run test:ci`, `TZ=America/New_York npm run test:ci` |

`test:web` runs against the last web export in `dist/`, so export first. What each check proves, and what still needs a device, is in [docs/TESTING.md](docs/TESTING.md). CI runs every check except the config introspection on every pull request and push to `main` ([`ci.yml`](.github/workflows/ci.yml)).

On Windows, set `TZ` in PowerShell (`$env:TZ='Pacific/Kiritimati'`), and keep LF line endings (`.gitattributes`) or `format:check` fails. A stale `.expo/types/router.d.ts` can break `typecheck`; delete `.expo/`.

## Scripts

| Script               | What it does                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm start`          | Start the Expo dev server; Expo Go is [not supported](README.md#on-an-iphone)                                                                                                           |
| `npm run web`        | Start the dev server for the browser preview                                                                                                                                            |
| `npm run ios`        | Start the dev server and open it in Expo Go on the iOS Simulator (macOS), which is [not supported](README.md#on-an-iphone); `npx expo run:ios` is the local native build, untested here |
| `npm run verify`     | Typecheck, lint, unit and SQLite tests, and the format check                                                                                                                            |
| `npm test`           | Jest (`test:watch` in watch mode, `test:ci` as CI runs it)                                                                                                                              |
| `npm run lint`       | ESLint; any warning fails                                                                                                                                                               |
| `npm run typecheck`  | TypeScript, no emit                                                                                                                                                                     |
| `npm run format`     | Prettier, writing changes (`format:check` only checks)                                                                                                                                  |
| `npm run export:ios` | Export the iOS JavaScript bundle to `dist-ios/`                                                                                                                                         |
| `npm run export:web` | Export the static browser build to `dist/`                                                                                                                                              |
| `npm run test:web`   | Playwright browser tests against `dist/`                                                                                                                                                |
| `npm run deps:check` | Check package versions against the Expo SDK                                                                                                                                             |
| `npm run doctor`     | Expo Doctor, with one documented exception                                                                                                                                              |

`node scripts/serve-preview.mjs` serves the last web export at `http://127.0.0.1:8087`, the address the browser tests use.

## Branches, commits and pull requests

- `main` is always releasable. Every change reaches it through a pull request, squash-merged once CI is green.
- Branches are short-lived and named `<type>/<topic>` (`feat`, `fix`, `docs`, `chore`, `test`, `refactor`), for example `fix/widget-sync`.
- One coherent change per branch: no unrelated refactor, new dependency or SDK upgrade rides along.
- Commits and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/), with a body that says why.
- A bug fix comes with a test that fails without it. No test is weakened or skipped to make a change pass.
- User-visible changes go under Unreleased in [CHANGELOG.md](CHANGELOG.md).
- A change to a rule in [docs/decisions/](docs/decisions/README.md) updates or adds a record in the same pull request.

## Rules every change keeps

- **One rule, one function.** Business rules live once in `src/domain`, deterministic and tested without rendering. Day Cleared and the streaks use `dayOutcome` and `dayProgress` and nothing else.
- **History is never rewritten.** Routine edits reconcile today and later only.
- **Formats are versioned.** A change to the state, SQLite schema or backup format needs a version step and an upgrade path ([DATA_MODEL.md](docs/DATA_MODEL.md#upgrades)). Persisted identifiers (`life-os-v1`, `life-os-backup`, `life-os-setup-v1`, `LifeOS-backup-*.json`) are never renamed.
- **Widgets stay private.** Nothing private reaches a widget, and a `'widget'` function uses nothing from module scope.
- **Trading writes go through `putTradingSession`**, and every trading screen reads `tradeStatus`.
- **Dependencies** follow [ADR 9](docs/decisions/0009-dependency-policy.md): add one only when the stack cannot reasonably solve the problem, install Expo packages with `npx expo install`, and never upgrade a major as part of other work.
- **Synthetic data only** in code, tests, fixtures, screenshots, issues and pull requests. Never commit `.env` files, credentials, backups, setup files, exports or databases ([DATA_PRIVACY.md](docs/DATA_PRIVACY.md#the-repository)).

## Releases

Versions follow [Semantic Versioning](https://semver.org/), separately from the data format versions. A release sets `version` in `package.json` and `expo.version` in `app.json` together (a test checks they match), moves the Unreleased entries in the changelog under the new version, and is tagged `vX.Y.Z` on `main` once CI is green. iPhone builds come from EAS (`eas.json` has `preview` and `production` profiles).
