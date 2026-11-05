// Runs the full Expo Doctor and applies the one temporary, documented exception in
// `doctor-allowance.cjs`. Doctor's own output is shown unchanged; the decision follows it.

const { spawnSync } = require('node:child_process');
const { existsSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { evaluate, ICON } = require('./doctor-allowance.cjs');

const root = join(__dirname, '..');
// Doctor reads the output of npm commands it runs itself; `npm run -s doctor` would pass a silent
// log level down to them and make three unrelated checks fail falsely.
const env = { ...process.env };
delete env.npm_config_loglevel;
const run = spawnSync('npx', ['expo-doctor'], {
  cwd: root,
  encoding: 'utf8',
  env,
  shell: process.platform === 'win32',
});
const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
process.stdout.write(output);

const app = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'));
const icon = join(root, ICON);
const iconIsDirectory =
  existsSync(icon) && statSync(icon).isDirectory() && existsSync(join(icon, 'icon.json'));

const result = evaluate({
  output,
  exitCode: run.error ? null : run.status,
  iosIcon: app.expo?.ios?.icon,
  iconIsDirectory,
});
console.log(`\n${result.ok ? 'PASS' : 'FAIL'}: ${result.reason}`);
process.exit(result.ok ? 0 : 1);
