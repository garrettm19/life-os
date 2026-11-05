# 9. Dependency policy

Status: accepted

## Context

Every package is code to update, audit and check on a device, and native modules can add permissions and App Store disclosures. Expo SDK upgrades move React Native, React and many packages together.

## Decision

- Add a package only when the current stack cannot reasonably solve the problem, and say why in the pull request. It must support the current Expo SDK, be maintained, and not duplicate Expo or React Native.
- Install Expo-managed packages with `npx expo install`, and use npm with the committed lockfile.
- Never upgrade Expo, React, React Native or any other major version as part of other work. An SDK upgrade is its own change.
- Dependabot opens monthly npm and GitHub Actions updates and skips the SDK set and npm majors.
- `npm run doctor` runs the full Expo Doctor through `scripts/doctor.cjs`. It allows exactly one known error: the Doctor version in use cannot read an Icon Composer `.icon` directory, which SDK 57 supports. Any other failure fails the check. The exception is tested and is removed once Doctor accepts the directory.

## Consequences

- No analytics SDK, state framework, chart library or backend client is in the bundle.
- The only permission the app asks for is notifications, and only when a study reminder is switched on.
- `npm run deps:check` and `npm run doctor` run in CI on every pull request.
