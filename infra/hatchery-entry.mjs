// The container's entry: make this server's attester key on the first start (in /data, mode 600), then serve.
// Copied into the image as indexer/src/hatchery-entry.mjs, next to hatchery-run.mjs.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const data = process.env.FATLINE_DATA ?? '/data';
const run = (args) => spawnSync(process.execPath, ['--experimental-sqlite', '--no-warnings=ExperimentalWarning', 'src/hatchery-run.mjs', ...args], { stdio: 'inherit' });
if (!existsSync(join(data, 'attester.key'))) {
  const made = run(['init']);
  if (made.status !== 0) {
    console.error(`Could not write the attester key in ${data}. Is the folder mounted and writable by uid 1000? (chown 1000:1000 on the host)`);
    process.exit(1);
  }
}
console.log(`Fatline hatchery, commit ${process.env.FATLINE_COMMIT ?? 'unknown'}.`);
const served = run([]);
process.exit(served.status ?? 1);
