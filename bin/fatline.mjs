#!/usr/bin/env node
// `fatline` on your PATH. Two ways to get it:
//   npm install -g fatlines        from npm
//   npm install -g .               inside a clone of github.com/jpfraneto/fatline (links that clone)
// It runs fatline in your copy of the repository, so `fatline compute` = `fatline compute`.
// Which copy: the clone this file lives in; else $FATLINE_DIR; else ~/fatline, downloaded with git on first use.
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'https://github.com/jpfraneto/fatline';
const isCopy = (d) => existsSync(join(d, 'fatline')) && existsSync(join(d, 'infra', 'setup.mjs'));
const here = dirname(dirname(realpathSync(fileURLToPath(import.meta.url))));
let dir = isCopy(here) ? here : (process.env.FATLINE_DIR ?? join(homedir(), 'fatline'));

if (!isCopy(dir)) {
  if (existsSync(dir)) {
    console.error(`${dir} exists but is not a copy of Fatline. Move it, or point to another folder: FATLINE_DIR=~/somewhere fatline ${process.argv.slice(2).join(' ')}`);
    process.exit(1);
  }
  console.log(`First run: downloading Fatline (open source, MIT) from ${REPO}\n  into ${dir}`);
  if (spawnSync('git', ['clone', '--quiet', REPO, dir], { stdio: 'inherit' }).status !== 0) {
    console.error('Could not download it. Is git installed? (macOS: xcode-select --install)');
    process.exit(1);
  }
}

const r = spawnSync(join(dir, 'fatline'), process.argv.slice(2), { stdio: 'inherit' });
process.exit(r.status ?? 1);
