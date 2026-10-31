// Runs the unit tests under several time zones, so calendar maths is checked
// across clock changes in both hemispheres.
import { spawnSync } from 'node:child_process';

const zones = ['Europe/Berlin', 'America/New_York', 'Australia/Sydney', 'UTC'];
let failed = false;
for (const zone of zones) {
  console.log(`\n=== TZ=${zone}`);
  const run = spawnSync('npx', ['vitest', 'run', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, TZ: zone },
  });
  if (run.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
