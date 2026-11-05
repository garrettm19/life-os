import { spawnSync } from 'node:child_process';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
for (const script of ['typecheck', 'lint', 'test:ci', 'format:check']) {
  const result = spawnSync(npm, ['run', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
