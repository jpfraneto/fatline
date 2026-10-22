import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/index.mjs';
import { ARCHETYPES, history } from '../src/sources/synthetic.mjs';
import { rowsToHistory } from '../src/sources/archive.mjs';

test('the public Atlas holds no message hashes, channel ids, partner FIDs or exact features', () => {
  const h = history(ARCHETYPES.find((p) => p.id === 'syn-talker'));
  const pub = JSON.stringify(generate(h).atlas);
  for (const m of h.messages.slice(0, 50)) {
    assert.ok(!pub.includes(m.hash.slice(2, 22)), 'message hash leaked');
    if (m.channel) assert.ok(!pub.includes(m.channel.slice(2, 22)), 'channel leaked');
    if (m.parentFid) assert.ok(!pub.includes(`"${m.parentFid}"`) && !pub.includes(`:${m.parentFid},`), 'partner leaked');
  }
  assert.ok(!('features' in generate(h).atlas));
  assert.ok('features' in generate(h, { view: 'owner' }).atlas);
});

test('archive rows → history: merged only, replies detected, text reduced to a length, channels hashed', () => {
  const H = (n) => '0x' + String(n).padStart(40, '0');
  const rows = [
    { network: 'farcaster', dedup_key: H(1), msg_type: 'MESSAGE_TYPE_CAST_ADD', protocol_ts: 1000, status: 'merged',
      body: JSON.stringify({ text: 'secret words', parentUrl: 'https://warpcast.com/~/channel/art', embeds: ['https://i.imgur.com/x.png', 'https://example.com'], mentions: [5] }) },
    { network: 'farcaster', dedup_key: H(2), msg_type: 'MESSAGE_TYPE_CAST_ADD', protocol_ts: 2000, status: 'displaced', body: JSON.stringify({ text: 'deleted' }) },
    { network: 'farcaster', dedup_key: H(3), msg_type: 'MESSAGE_TYPE_CAST_ADD', protocol_ts: 3000, status: 'merged', body: JSON.stringify({ text: 'hi', parent: { fid: 77, hash: H(9) } }) },
    { network: 'farcaster', dedup_key: H(4), msg_type: 'MESSAGE_TYPE_REACTION_ADD', protocol_ts: 4000, status: 'merged', body: JSON.stringify({ kind: 'reaction', target: { fid: 8 } }) },
    { network: 'farcaster', dedup_key: H(5), msg_type: 'MESSAGE_TYPE_CAST_ADD', protocol_ts: 5000, status: 'merged', body: JSON.stringify({ truncated: true, bytes: 70000 }) },
    { network: 'farcaster', dedup_key: H(6), msg_type: 'MESSAGE_TYPE_CAST_REMOVE', protocol_ts: 6000, status: 'merged', body: null },
  ];
  const h = rowsToHistory(18350, rows, { snapshotAt: 10_000 });
  assert.equal(h.messages.length, 4);
  const [cast, reply, reaction] = h.messages;
  assert.equal(cast.kind, 'cast'); assert.equal(cast.media, 1); assert.equal(cast.embeds, 2); assert.equal(cast.textLen, 12);
  assert.match(cast.channel, /^0x[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(h).includes('secret'), 'text must not leave the reader');
  assert.equal(reply.kind, 'reply'); assert.equal(reply.parentFid, 77);
  assert.equal(reaction.kind, 'reaction'); assert.equal(reaction.targetFid, 8);
  assert.doesNotThrow(() => generate(h));
});
