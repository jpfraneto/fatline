#!/usr/bin/env node
// Send images to the Fatline Telegram chat as one album, with a caption per image.
//
//   node infra/telegram-photos.mjs "<intro text>" <image> "<caption>" [<image> "<caption>" ...]
//
// Secrets: ~/.fatline-telegram-token, ~/.fatline-telegram-chat, optional ~/.fatline-telegram-thread (never printed).
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const secret = (name) => readFileSync(join(homedir(), name), 'utf8').trim();
const [intro, ...pairs] = process.argv.slice(2);
if (!intro || !pairs.length || pairs.length % 2) throw new Error('usage: telegram-photos.mjs "<intro>" <image> "<caption>" ...');
if (pairs.length > 20) throw new Error('at most 10 images per album');

const api = (method) => `https://api.telegram.org/bot${secret('.fatline-telegram-token')}/${method}`;
const thread = existsSync(join(homedir(), '.fatline-telegram-thread')) ? Number(secret('.fatline-telegram-thread')) : null;
const base = { chat_id: secret('.fatline-telegram-chat'), ...(thread ? { message_thread_id: thread } : {}) };

async function call(method, body) {
  const res = await fetch(api(method), body instanceof FormData ? { method: 'POST', body } : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}

await call('sendMessage', { ...base, text: intro });
const form = new FormData();
for (const [k, v] of Object.entries(base)) form.append(k, String(v));
const media = [];
for (let i = 0; i < pairs.length; i += 2) {
  const [path, caption] = [pairs[i], pairs[i + 1]];
  const name = `p${i / 2}`;
  form.append(name, new Blob([readFileSync(path)], { type: 'image/png' }), basename(path));
  media.push({ type: 'photo', media: `attach://${name}`, caption });
}
form.append('media', JSON.stringify(media));
await call('sendMediaGroup', form);
console.log(`sent ${media.length} image(s)`);
