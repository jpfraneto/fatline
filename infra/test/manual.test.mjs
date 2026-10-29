// The instruction manual (apps/site/manual.js) on fatline.ink and in every node's client says only what the
// canonical texts say: the agent line, the installer, and every command it shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
// A browser file with no package.json of its own: loaded as a module from its text (it imports nothing).
const { AGENT_PROMPT, INSTALL, JOIN_CHECK, BY_HAND, LINKS, TEXT } = await import(`data:text/javascript,${encodeURIComponent(read('apps/site/manual.js'))}`);

const readme = read('README.md');
const docs = read('apps/site/docs/index.md');
const skill = read('apps/site/skill.md');
const help = read('fatline');
const canon = [readme, docs, skill, help].join('\n');

test('the agent line is the one the README and the docs give', () => {
  assert.equal(AGENT_PROMPT, 'Help me run a Fatline: https://fatline.ink/skill.md');
  assert.ok(readme.includes(AGENT_PROMPT), 'README.md');
  assert.ok(docs.includes(AGENT_PROMPT), 'apps/site/docs/index.md');
});

test('the guided install is the installer line itself', () => {
  for (const [name, text] of [['README.md', readme], ['docs', docs], ['install.sh', read('apps/site/install.sh')]]) assert.ok(text.includes(INSTALL), name);
  assert.ok(docs.includes(JOIN_CHECK), 'join.sh --check is in the docs');
});

test('every command by hand is a documented one', () => {
  for (const step of BY_HAND) for (const cmd of step.cmds) assert.ok(canon.includes(cmd), `${step.key}: ${cmd}`);
  // and every `fatline …` named in the notes, in both languages (placeholders like <ip> or N cut off)
  for (const [lang, L] of Object.entries(TEXT)) {
    const notes = Object.values(L.steps).flat(2).join('\n') + L.guided + L.before;
    for (const [, cmd] of notes.matchAll(/`(fatline [^`]+)`/g)) {
      const known = cmd.split(/ (?=<|N\b)/)[0];
      assert.ok(canon.includes(known), `${lang}: ${known}`);
    }
  }
});

test('English and Spanish say the same things', () => {
  const shape = (v) => (Array.isArray(v) ? v.map(shape) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);
  assert.deepEqual(shape(TEXT.es), shape(TEXT.en));
  assert.deepEqual(Object.keys(TEXT.en.steps), BY_HAND.map((s) => s.key));
});

test('its links go to fatline.ink and the repository, and the docs anchor exists', () => {
  for (const url of Object.values(LINKS)) assert.match(url, /^https:\/\/(fatline\.ink\/|github\.com\/jpfraneto\/fatline(\/|$))/);
  assert.ok(docs.includes('id="bring-your-node"'));
  assert.ok(readme.includes('npm install -g .') && readme.includes('Node.js 22.12+'), 'prerequisites as the README gives them');
});
