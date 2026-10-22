// The launchpad: apps that pay for their own life.
import { encodeFunctionData, parseAbi, parseSignature, parseUnits } from 'viem';
import { $, api, date, duration, el, short, state, t, usdc, wallet } from './lib.js';
import { nodeStrip } from './farline.js';

const erc20 = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function nonces(address owner) view returns (uint256)',
  'function name() view returns (string)',
  'function version() view returns (string)',
]);
const factoryAbi = parseAbi([
  'struct AppParams { address owner; address keeper; uint256 billingPeriod; string uri; bytes32 salt; }',
  'function createApp(AppParams p, uint256 deposit) returns (address)',
  'function launchApp(AppParams p, bytes deployCalldata, uint256 deposit) payable returns (address, address)',
  'function launchAppWithPermit(AppParams p, bytes deployCalldata, uint256 deposit, uint256 deadline, uint8 v, bytes32 r, bytes32 s) payable returns (address, address)',
]);
const vaultAbi = parseAbi(['function deposit(uint256 amount, string note)', 'function checkIn()']);

// ------------------------------------------------------------------ paying with USDC

/**
 * Runs `call` after giving `spender` an allowance of `amount` USDC, in as few confirmations as the
 * wallet allows: one batched call (smart wallets), else approve then call.
 */
async function withUsdc({ client, reader, account }, { spender, amount, call }) {
  const token = state.config.launchpad.usdc;
  const approve = { to: token, data: encodeFunctionData({ abi: erc20, functionName: 'approve', args: [spender, amount] }) };
  const allowance = amount > 0n ? await reader.readContract({ address: token, abi: erc20, functionName: 'allowance', args: [account, spender] }) : amount;
  const calls = allowance >= amount ? [call] : [approve, call];
  if (calls.length > 1) {
    try {
      const { id } = await client.sendCalls({ account, calls, forceAtomic: true });
      const result = await client.waitForCallsStatus({ id });
      if (result.status !== 'success') throw new Error('The batched transaction failed');
      return result.receipts?.at(-1)?.transactionHash;
    } catch (err) {
      if (!/sendCalls|not supported|Unsupported|-32601|5700|does not support/i.test(`${err.message} ${err.details ?? ''}`)) throw err;
    }
    const hash = await client.sendTransaction({ account, ...approve });
    await reader.waitForTransactionReceipt({ hash });
  }
  const hash = await client.sendTransaction({ account, ...call });
  await reader.waitForTransactionReceipt({ hash });
  return hash;
}

/** Plain wallets (EOAs) can sign a USDC permit instead, so launching stays one transaction. */
async function permit({ client, reader, account, chain }, spender, amount) {
  const token = state.config.launchpad.usdc;
  const [name, version, nonce] = await Promise.all(['name', 'version'].map((fn) => reader.readContract({ address: token, abi: erc20, functionName: fn }))
    .concat(reader.readContract({ address: token, abi: erc20, functionName: 'nonces', args: [account] })));
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const signature = await client.signTypedData({
    account,
    domain: { name, version, chainId: chain.id, verifyingContract: token },
    types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
    primaryType: 'Permit',
    message: { owner: account, spender, value: amount, nonce, deadline },
  });
  const { v, r, s } = parseSignature(signature);
  return { deadline, v: Number(v), r, s };
}

// ------------------------------------------------------------------ life

function lifeOf(app) {
  const s = app.state;
  if (!s) return { text: '…', cls: '' };
  const now = Date.now();
  const funds = Number(s.balance) + Number(s.pendingFees);
  const oneDay = Number(s.ratePerSecond) * 86_400;
  if (s.alive) return { text: t('alive', duration(s.aliveUntil - now)), cls: s.aliveUntil - now < 7 * 86_400_000 ? 'low' : 'ok' };
  if (funds >= oneDay) return { text: t('waiting', duration(s.aliveUntil - now)), cls: 'low' };
  if (funds > 0) return { text: t('dying'), cls: 'low' };
  return { text: t('dead'), cls: 'dead' };
}

function lifeBar(app) {
  const s = app.state;
  const days = s ? Math.max(0, (s.aliveUntil - Date.now()) / 86_400_000) : 0;
  const pct = Math.min(100, (days / 365) * 100);
  return el('div', { class: 'lifebar', role: 'img', 'aria-label': `${Math.floor(days)} days` }, el('span', { style: `width:${pct}%` }));
}

function appCard(app) {
  const life = lifeOf(app);
  return el('a', { class: 'app-card', href: `#/coin/${state.config.launchpad.chainId}/${app.coin ?? app.vault}` },
    el('div', { class: 'app-head' },
      app.meta.image ? el('img', { src: app.meta.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'dot big' }),
      el('div', {}, el('strong', {}, app.meta.name ?? short(app.vault)), app.symbol ? el('span', { class: 'muted' }, ` $${app.symbol}`) : null,
        el('p', { class: 'muted small' }, app.meta.description ?? ''))),
    lifeBar(app),
    el('p', { class: `life-text ${life.cls}` }, life.text, app.state ? el('span', { class: 'muted' }, ` · ${usdc(app.state.balance)} USDC ${t('inVault')}`) : null));
}

export async function appsPage() {
  const main = $('#main');
  const top = el('div', { class: 'row spread' }, el('h2', { class: 'flush' }, t('tabApps')),
    state.config.launchpad ? el('a', { class: 'button', href: '#/launch' }, t('launch')) : null);
  const strip = nodeStrip();
  if (!state.config.launchpad) return main.replaceChildren(strip, top, el('p', { class: 'muted' }, t('launchpadOff')));
  main.replaceChildren(strip, top, el('p', { class: 'muted' }, '…'));
  const apps = await api('/api/apps');
  main.replaceChildren(strip, top, apps.length ? el('div', { class: 'apps' }, ...apps.map(appCard)) : el('p', { class: 'muted empty' }, t('noApps')));
}

// ------------------------------------------------------------------ one app

function youtubeEmbed(url) {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

export function experience(meta) {
  const x = meta.experience;
  if (!x?.url || !/^https:\/\//.test(x.url)) return null;
  if (x.type === 'app') return el('iframe', { class: 'exp', src: x.url, sandbox: 'allow-scripts allow-forms allow-popups', loading: 'lazy', title: meta.name ?? 'app' });
  if (x.type === 'video') {
    const yt = youtubeEmbed(x.url);
    return yt ? el('iframe', { class: 'exp', src: yt, allow: 'encrypted-media; picture-in-picture', allowfullscreen: true, title: meta.name ?? 'video' })
      : el('video', { class: 'exp', src: x.url, controls: true, playsinline: true });
  }
  if (x.type === 'image') return el('img', { class: 'exp', src: x.url, alt: meta.name ?? '', referrerpolicy: 'no-referrer' });
  return el('a', { class: 'exp link', href: x.url, target: '_blank', rel: 'noopener' }, x.url.replace(/^https:\/\//, ''), ' ↗');
}

export function feedForm(app, onDone) {
  const amount = el('input', { type: 'number', min: '0.01', step: '0.01', value: '5', inputmode: 'decimal', 'aria-label': t('feedAmount') });
  const status = el('p', { class: 'status', role: 'status' });
  const button = el('button', { type: 'submit' }, t('feed'));
  return el('form', {
    class: 'row feed',
    onsubmit: async (e) => {
      e.preventDefault();
      button.disabled = true;
      status.textContent = t('signing');
      try {
        const w = await wallet(state.config.launchpad.chainId);
        const units = parseUnits(amount.value, 6);
        await withUsdc(w, { spender: app.vault, amount: units, call: { to: app.vault, data: encodeFunctionData({ abi: vaultAbi, functionName: 'deposit', args: [units, ''] }) } });
        status.textContent = t('fed');
        setTimeout(onDone, 2500);
      } catch (err) {
        status.textContent = err.shortMessage ?? err.message;
      } finally {
        button.disabled = false;
      }
    },
  }, amount, el('span', { class: 'muted' }, 'USDC'), button, status);
}

// ------------------------------------------------------------------ daily users, onchain

export function presence(app, onDone) {
  const s = app.state;
  const max = Math.max(1, ...s.week.map((d) => d.users));
  const status = el('p', { class: 'status', role: 'status' });
  const here = async (direct) => {
    status.textContent = t('signing');
    try {
      const w = await wallet(state.config.launchpad.chainId);
      if (direct) {
        const hash = await w.client.writeContract({ account: w.account, address: app.vault, abi: vaultAbi, functionName: 'checkIn' });
        await w.reader.waitForTransactionReceipt({ hash });
        status.textContent = t('countedNow');
      } else {
        const day = s.today.day;
        const signature = await w.client.signTypedData({
          account: w.account,
          domain: { name: 'Infinicaster App', version: '1', chainId: w.chain.id, verifyingContract: app.vault },
          types: { CheckIn: [{ name: 'day', type: 'uint256' }] },
          primaryType: 'CheckIn', message: { day: BigInt(day) },
        });
        const r = await api(`/api/apps/${app.vault}/checkin`, {}, { person: w.account, day, signature });
        status.textContent = r.status === 'counted' ? t('alreadyCounted') : t('queuedCheckIn');
      }
      setTimeout(onDone, 2500);
    } catch (err) {
      status.textContent = err.shortMessage ?? err.message;
    }
  };
  return el('section', { class: 'presence' },
    el('p', { class: 'life-text big' }, t('hereToday', s.today.users + s.today.queued)),
    el('p', { class: 'muted small' }, t('yesterday', s.dau), s.today.queued ? ` · ${t('queued', s.today.queued)}` : ''),
    el('div', { class: 'week', role: 'img', 'aria-label': s.week.map((d) => `${d.date}: ${d.users}`).join(', ') },
      ...s.week.map((d, i) => el('div', { class: `bar${i === 6 ? ' today' : ''}`, title: `${d.date}: ${d.users}` },
        el('span', { style: `height:${Math.max(4, (d.users / max) * 100)}%` }), el('small', {}, String(d.users))))),
    el('div', { class: 'row' },
      el('button', { type: 'button', onclick: () => here(false) }, t('imHere')),
      el('button', { type: 'button', class: 'quiet', onclick: () => here(true) }, t('imHereTx'))),
    status,
    el('p', { class: 'muted small' }, t('presenceExplain'), Number(s.minCoinToCount) > 0 ? ` ${t('holdersOnly')}` : ''));
}

// ------------------------------------------------------------------ launch

export function launchPage() {
  const main = $('#main');
  if (!state.config.launchpad) return main.replaceChildren(el('p', { class: 'muted' }, t('launchpadOff')));
  const field = (key, input) => el('label', { class: 'field' }, el('span', {}, t(key)), input);
  const f = {
    name: el('input', { required: true, maxlength: 60 }),
    symbol: el('input', { required: true, maxlength: 12, autocapitalize: 'characters' }),
    description: el('textarea', { rows: 3, maxlength: 500 }),
    image: el('input', { type: 'url', placeholder: 'https://' }),
    expType: el('select', {}, ...Object.entries(t('expTypes')).map(([k, v]) => el('option', { value: k }, v))),
    expUrl: el('input', { type: 'url', placeholder: 'https://' }),
    coin: el('input', { type: 'checkbox', checked: true }),
    deposit: el('input', { type: 'number', min: '0', step: '0.01', value: '20', inputmode: 'decimal' }),
    owner: el('input', { placeholder: '0x… (default: you)' }),
    keeper: el('input', { placeholder: '0x… (default: you)' }),
    billing: el('input', { type: 'number', min: '1', max: '31', value: '30' }),
    node: el('input', { type: 'url', placeholder: 'http://1.2.3.4:3381' }),
  };
  const symbolField = field('symbol', f.symbol);
  f.coin.addEventListener('change', () => { symbolField.hidden = !f.coin.checked; f.symbol.required = f.coin.checked; });
  const status = el('p', { class: 'status', role: 'status' });
  const button = el('button', { type: 'submit' }, t('launchButton'));

  const form = el('form', {
    class: 'launch',
    onsubmit: async (e) => {
      e.preventDefault();
      button.disabled = true;
      try {
        const w = await wallet(state.config.launchpad.chainId);
        status.textContent = t('preparing');
        const prep = await api('/api/launch/prepare', {}, {
          creator: w.account, owner: f.owner.value.trim() || w.account, keeper: f.keeper.value.trim() || w.account,
          name: f.name.value.trim(), symbol: f.symbol.value.trim().toUpperCase(), description: f.description.value.trim(),
          image: f.image.value.trim(), experience: f.expUrl.value.trim() ? { type: f.expType.value, url: f.expUrl.value.trim() } : null,
          coin: f.coin.checked, billingDays: Number(f.billing.value) || 30, node: f.node.value.trim() || null,
        });
        const params = { ...prep.params, billingPeriod: BigInt(prep.params.billingPeriod) };
        const deposit = parseUnits(f.deposit.value || '0', 6);
        status.textContent = t('signing');
        const call = f.coin.checked
          ? { to: prep.factory, value: BigInt(prep.value ?? 0), data: encodeFunctionData({ abi: factoryAbi, functionName: 'launchApp', args: [params, prep.deployCalldata, deposit] }) }
          : { to: prep.factory, data: encodeFunctionData({ abi: factoryAbi, functionName: 'createApp', args: [params, deposit] }) };

        let done = false;
        if (f.coin.checked && deposit > 0n) {
          // Plain wallets: permit signature + one transaction. Smart wallets fall through to a batch.
          const code = await w.reader.getCode({ address: w.account });
          if (!code || code === '0x') {
            const p = await permit(w, prep.factory, deposit);
            const hash = await w.client.writeContract({ account: w.account, address: prep.factory, abi: factoryAbi, functionName: 'launchAppWithPermit', args: [params, prep.deployCalldata, deposit, p.deadline, p.v, p.r, p.s], value: BigInt(prep.value ?? 0) });
            await w.reader.waitForTransactionReceipt({ hash });
            done = true;
          }
        }
        if (!done) await withUsdc(w, { spender: prep.factory, amount: deposit, call });
        status.textContent = t('born');
        setTimeout(() => { location.hash = `#/app/${prep.vault}`; }, 3000);
      } catch (err) {
        status.textContent = err.shortMessage ?? err.message;
      } finally {
        button.disabled = false;
      }
    },
  },
  field('name', f.name), symbolField, field('description', f.description), field('image', f.image),
  el('div', { class: 'row' }, field('expType', f.expType), field('expUrl', f.expUrl)),
  el('label', { class: 'check' }, f.coin, el('span', {}, t('withCoin'))),
  field('deposit', f.deposit),
  el('details', {}, el('summary', {}, t('advanced')), field('ownerLabel', f.owner), field('keeperLabel', f.keeper), field('billing', f.billing), field('nodeLabel', f.node)),
  el('p', { class: 'muted small' }, t('oneTx')),
  button, status);
  main.replaceChildren(el('a', { href: '#/', class: 'back' }, t('back')), el('h1', { class: 'app-title' }, t('launch')), form);
}
