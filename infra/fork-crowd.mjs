// Dev only: N fresh wallets each sign a free check-in for an app, through the API, like the browser.
//   node infra/fork-crowd.mjs <vault> [n]
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const API = process.env.INDEXER_URL ?? 'http://localhost:8787';
const [vault, n = '25'] = process.argv.slice(2);
const app = await (await fetch(`${API}/api/apps/${vault}`)).json();
const day = app.state.today.day;
let queued = 0;
for (let i = 0; i < Number(n); i++) {
  const person = privateKeyToAccount(generatePrivateKey());
  const signature = await person.signTypedData({
    domain: { name: 'Fatline App', version: '1', chainId: 8453, verifyingContract: app.vault },
    types: { CheckIn: [{ name: 'day', type: 'uint256' }] }, primaryType: 'CheckIn', message: { day: BigInt(day) },
  });
  const res = await fetch(`${API}/api/apps/${app.vault}/checkin`, { method: 'POST', body: JSON.stringify({ person: person.address, day, signature }) });
  if (res.ok) queued++;
  else console.log('rejected:', (await res.json()).error);
}
// A forged one: signed by someone else. The server must refuse it.
const liar = privateKeyToAccount(generatePrivateKey());
const victim = privateKeyToAccount(generatePrivateKey()).address;
const forged = await liar.signTypedData({ domain: { name: 'Fatline App', version: '1', chainId: 8453, verifyingContract: app.vault }, types: { CheckIn: [{ name: 'day', type: 'uint256' }] }, primaryType: 'CheckIn', message: { day: BigInt(day) } });
const bad = await fetch(`${API}/api/apps/${app.vault}/checkin`, { method: 'POST', body: JSON.stringify({ person: victim, day, signature: forged }) });
console.log(`${queued} people checked in (free signatures). Forged check-in: HTTP ${bad.status} ${(await bad.json()).error ?? ''}`);
