import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Reads fatline.config.json, or the example when the person has not run `init` yet. */
export function loadConfig() {
  const explicit = process.env.FATLINE_CONFIG;
  const candidates = explicit
    ? [resolve(explicit)]
    : [join(ROOT, 'fatline.config.json'), join(ROOT, 'fatline.config.example.json')];
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error(`No config found. Tried: ${candidates.join(', ')}`);

  const config = JSON.parse(readFileSync(path, 'utf8'));
  config.path = path;
  config.port = Number(process.env.PORT ?? config.port ?? 8787);
  config.dataDir = process.env.FATLINE_DATA ?? join(ROOT, '.fatline');
  config.appDir = join(ROOT, 'apps/opinions/dist');
  if (process.env.VOICES_RPC) config.voices.rpc = process.env.VOICES_RPC;
  if (process.env.VOICES_ADDRESS) config.voices.address = process.env.VOICES_ADDRESS;
  config.launchpad ??= {};
  if (process.env.LAUNCHPAD_RPC) config.launchpad.rpc = process.env.LAUNCHPAD_RPC;
  if (process.env.LAUNCHPAD_FACTORY) config.launchpad.factory = process.env.LAUNCHPAD_FACTORY;

  if (!config.networks[config.defaultNetwork]) {
    throw new Error(`defaultNetwork "${config.defaultNetwork}" is not in networks`);
  }
  return config;
}
