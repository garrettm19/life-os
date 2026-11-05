// Temporary, narrowly scoped Expo Doctor exception.
//
// Expo SDK 57 supports an Icon Composer `.icon` directory for `ios.icon`, and its published config
// schema says so, but Expo Doctor 1.21.4 tries to read that directory as a file and reports
// "ios.icon - cannot access file at './assets/app.icon'". This decides whether a Doctor run passes:
// it does when Doctor passes, or when its only failure is exactly that one error and the `.icon`
// directory really exists. Any other failed check, any other error (even inside the same check) or
// output it cannot read fails. Remove this file and `scripts/doctor.cjs` (and point `npm run doctor`
// back to `npx expo-doctor`) once Expo Doctor accepts `.icon` directories.

const ICON = './assets/app.icon';
const SCHEMA_CHECK = 'Check Expo config (app.json/ app.config.js) schema';
const ICON_ERROR = `Field: ios.icon - cannot access file at '${ICON}'.`;

/** Strips terminal color codes so the output reads the same in a terminal and in CI. */
function plain(text) {
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * @param {{ output: string, exitCode: number | null, iosIcon: unknown, iconIsDirectory: boolean }} run
 * @returns {{ ok: boolean, reason: string }}
 */
function evaluate({ output, exitCode, iosIcon, iconIsDirectory }) {
  if (exitCode === 0) return { ok: true, reason: 'Expo Doctor passed.' };
  const lines = plain(output)
    .split(/\r?\n/)
    .map((l) => l.trim());
  const summary = lines
    .map((l) => l.match(/^(\d+)\/(\d+) checks passed\. (\d+) checks? failed/))
    .find(Boolean);
  if (!summary)
    return { ok: false, reason: 'Expo Doctor failed and its summary could not be read.' };
  if (Number(summary[3]) !== 1)
    return { ok: false, reason: `Expo Doctor reported ${summary[3]} failed checks.` };
  const failed = lines.filter((l) => /^[✖✗×] /.test(l)).map((l) => l.slice(2).trim());
  if (failed.length !== 1 || failed[0] !== SCHEMA_CHECK)
    return { ok: false, reason: `Expo Doctor failed a different check: ${failed.join('; ')}` };
  const start = lines.findIndex((l) => /^[✖✗×] /.test(l));
  const end = lines.findIndex((l, i) => i > start && l === 'Advice:');
  if (end < 0) return { ok: false, reason: 'The failed check could not be read.' };
  const errors = lines.slice(start + 1, end).filter((l) => l.length > 0);
  const expected =
    errors.length === 2 &&
    /^Errors? validating asset fields in .*app\.json:$/.test(errors[0]) &&
    errors[1] === ICON_ERROR;
  if (!expected)
    return { ok: false, reason: `The config check reported other errors: ${errors.join(' | ')}` };
  if (iosIcon !== ICON)
    return { ok: false, reason: `ios.icon is ${JSON.stringify(iosIcon)}, not ${ICON}.` };
  if (!iconIsDirectory)
    return { ok: false, reason: `${ICON} is not an Icon Composer directory with an icon.json.` };
  return {
    ok: true,
    reason:
      'Expo Doctor passed except the known ios.icon directory error (temporary exception; see scripts/doctor-allowance.cjs).',
  };
}

module.exports = { evaluate, ICON, ICON_ERROR, SCHEMA_CHECK };
