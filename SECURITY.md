# Security policy

Life OS keeps everything on the device: there is no account, server, analytics, cloud sync or AI service. The main risks are a lost or shared phone, an exported file kept somewhere unsafe, and private data leaking into a widget, a notification, a log or the repository.

## Reporting a problem

Report a vulnerability or a privacy leak privately through GitHub's private vulnerability reporting on this repository (the **Security** tab, then **Report a vulnerability**). Please do not open a public issue or pull request for it.

Describe the problem with made-up examples. Never include real personal data, backups, setup files, analysis exports or screenshots that show them.

## Supported versions

Only the latest release receives fixes.

## Security model

- Native storage is SQLite inside the app's sandbox, protected at rest by the device passcode and iOS data protection. It is not an encrypted vault.
- Backups and analysis exports are unencrypted files saved only where the user chooses. The app never uploads them.
- No privileged credential ships in the client. Signing and build credentials stay in EAS, and `.env` files are ignored.
- What widgets, notifications, backups and exports may contain is set in [docs/DATA_PRIVACY.md](docs/DATA_PRIVACY.md). Anything beyond that is a privacy leak.
- Trading restrictions (stops, cooldowns, attempt limits, practice only) are app-level records, not access control. Restoring an older backup or changing the phone's clock can roll them back, and nothing reaches a broker. The broker's own controls are what can actually stop an order.

## Dependencies

Expo, React and React Native move with the Expo SDK and are upgraded deliberately ([ADR 9](docs/decisions/0009-dependency-policy.md)). Most `npm audit` advisories are in development and build tooling (the Expo CLI, Metro, Jest), which runs on a developer machine and in CI, not in the app. Fixes that would need an SDK change arrive with a planned SDK upgrade, never through `npm audit fix --force`. Other packages get monthly Dependabot updates.
