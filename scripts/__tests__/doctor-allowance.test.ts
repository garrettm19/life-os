import { describe, expect, it } from '@jest/globals';

// The Expo Doctor exception accepts exactly one known error and nothing else.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { evaluate, ICON } = require('../doctor-allowance.cjs') as {
  evaluate: (run: {
    output: string;
    exitCode: number | null;
    iosIcon: unknown;
    iconIsDirectory: boolean;
  }) => { ok: boolean; reason: string };
  ICON: string;
};

const report = (failed: number, body: string) => `Running 21 checks on your project...
${21 - failed}/21 checks passed. ${failed} checks failed. Possible issues detected:
Use the --verbose flag to see more details about passed checks.
${body}
${failed} check failed, indicating possible issues with the project.
`;

const ICON_CHECK = `
✖ Check Expo config (app.json/ app.config.js) schema
Errors validating asset fields in /home/runner/work/personal-os/personal-os/app.json:
 Field: ios.icon - cannot access file at './assets/app.icon'.
Advice:
Resolve schema errors in your app config. Learn more: https://docs.expo.dev/workflow/configuration/
`;

const ok = { iosIcon: ICON, iconIsDirectory: true };

describe('the temporary Expo Doctor exception', () => {
  it('passes a clean Doctor run', () => {
    expect(evaluate({ output: '21/21 checks passed.', exitCode: 0, ...ok }).ok).toBe(true);
  });

  it('accepts only the known ios.icon directory error, with the directory present', () => {
    expect(evaluate({ output: report(1, ICON_CHECK), exitCode: 1, ...ok })).toMatchObject({
      ok: true,
    });
    // The same with terminal colors and Windows line endings.
    const colored = report(1, ICON_CHECK)
      .replace('✖', '\u001b[31m✖\u001b[39m')
      .replace(/\n/g, '\r\n');
    expect(evaluate({ output: colored, exitCode: 1, ...ok }).ok).toBe(true);
  });

  it('still blocks CI for an unrelated failed check', () => {
    const other = `
✖ Check that packages match versions required by installed Expo SDK
Advice:
Use 'npx expo install --check' to review and upgrade your dependencies.
`;
    expect(evaluate({ output: report(1, other), exitCode: 1, ...ok }).ok).toBe(false);
    expect(evaluate({ output: report(2, ICON_CHECK + other), exitCode: 1, ...ok }).ok).toBe(false);
  });

  it('still blocks CI for any other error inside the config check', () => {
    const extra = ICON_CHECK.replace(
      " Field: ios.icon - cannot access file at './assets/app.icon'.",
      " Field: ios.icon - cannot access file at './assets/app.icon'.\n Field: icon - image should be square, but the file at './assets/images/icon.png' has dimensions 1024x900.",
    );
    expect(evaluate({ output: report(1, extra), exitCode: 1, ...ok }).ok).toBe(false);
    const different = ICON_CHECK.replace('ios.icon', 'android.icon');
    expect(evaluate({ output: report(1, different), exitCode: 1, ...ok }).ok).toBe(false);
  });

  it('blocks CI when the .icon directory is missing or ios.icon points elsewhere', () => {
    const output = report(1, ICON_CHECK);
    expect(evaluate({ output, exitCode: 1, iosIcon: ICON, iconIsDirectory: false }).ok).toBe(false);
    expect(
      evaluate({ output, exitCode: 1, iosIcon: './assets/other.icon', iconIsDirectory: true }).ok,
    ).toBe(false);
  });

  it('blocks CI when Doctor crashes or its output cannot be read', () => {
    expect(evaluate({ output: '', exitCode: null, ...ok }).ok).toBe(false);
    expect(evaluate({ output: 'npm ERR! network', exitCode: 1, ...ok }).ok).toBe(false);
  });
});
