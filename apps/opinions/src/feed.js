// Voices (long-form, onchain) and My people (casts from the chosen network, without noise).
import { parseAbi } from 'viem';
import { $, api, el, label, short, showSource, state, store, t, timeAgo, wallet } from './lib.js';

const voicesAbi = parseAbi(['function say(string text, uint256 parentId, uint256 fid) returns (uint256)']);
const MAX_BYTES = 16_384;

function author(item, users) {
  const user = item.fid ? users[item.fid] : null;
  const name = user?.username ? `@${user.username}` : item.fid ? `fid ${item.fid}` : short(item.author);
  return el('span', { class: 'author' },
    user?.pfp ? el('img', { src: user.pfp, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' }) : el('span', { class: 'dot' }),
    el('strong', {}, user?.displayName || name),
    user?.displayName ? el('span', { class: 'muted' }, name) : null);
}

function card(item, users, { inThread = false } = {}) {
  const isVoice = item.kind === 'voice';
  const meta = el('div', { class: 'meta' },
    author(item, users),
    el('span', { class: 'muted' }, ' · ', timeAgo(item.timestamp)),
    el('span', { class: `kind ${item.kind}` }, isVoice ? t('voice') : t('cast', label(item.network))));
  const notes = [];
  if (isVoice && item.claimedFid && !item.verified) notes.push(el('p', { class: 'warn' }, t('claims', item.claimedFid, label(state.network))));
  const actions = el('div', { class: 'actions' },
    isVoice && !inThread ? el('a', { href: `#/voice/${item.id}` }, t('reply')) : null,
    !isVoice ? el('a', { href: `https://farcaster.xyz/~/conversations/${item.id}`, target: '_blank', rel: 'noopener' }, t('open')) : null);
  return el('article', { class: `item ${item.kind}` }, meta, el('div', { class: 'text' }, item.text), ...notes, actions);
}

function composer({ parentId = 0, onSent }) {
  const text = el('textarea', { rows: parentId ? 3 : 5, placeholder: t(parentId ? 'replyPlaceholder' : 'composePlaceholder') });
  const count = el('span', { class: 'count' }, `0 / ${MAX_BYTES}`);
  const fid = el('input', { type: 'number', min: 1, inputmode: 'numeric', placeholder: t('fidLabel'), value: store.get('myFid', '') });
  const status = el('p', { class: 'status', role: 'status' });
  const button = el('button', { type: 'submit' }, t('say'));
  text.addEventListener('input', () => {
    const n = new TextEncoder().encode(text.value).length;
    count.textContent = `${n} / ${MAX_BYTES}`;
    count.classList.toggle('over', n > MAX_BYTES);
  });
  return el('form', {
    class: 'composer',
    onsubmit: async (e) => {
      e.preventDefault();
      const body = text.value.trim();
      if (!body || new TextEncoder().encode(body).length > MAX_BYTES) return;
      button.disabled = true;
      status.textContent = t('sending');
      try {
        const { client, reader, account } = await wallet(state.config.voices.chainId);
        store.set('myFid', fid.value);
        const hash = await client.writeContract({
          account, address: state.config.voices.address, abi: voicesAbi, functionName: 'say',
          args: [body, BigInt(parentId), BigInt(fid.value || 0)],
        });
        await reader.waitForTransactionReceipt({ hash });
        text.value = '';
        status.textContent = t('sent');
        setTimeout(onSent, 6000);
      } catch (err) {
        status.textContent = err.shortMessage ?? err.message;
      } finally {
        button.disabled = false;
      }
    },
  }, text, el('div', { class: 'row' }, fid, count, button), status);
}

export async function feedPage({ fids = null, header = [], route }) {
  const main = $('#main');
  const list = el('div', { class: 'list' });
  const more = el('button', { class: 'more', type: 'button', hidden: true }, t('more'));
  const top = [...header];
  if (!fids) top.push(state.config.voices.address ? composer({ onSent: route }) : el('p', { class: 'muted' }, t('voicesOff')));
  main.replaceChildren(...top, list, more);

  let before;
  const load = async () => {
    more.disabled = true;
    try {
      const page = await api('/api/feed', { network: state.network, fids: fids?.join(','), before, limit: 20 });
      showSource(page.source);
      if (!page.items.length && !before) list.append(el('p', { class: 'muted empty' }, t('empty')));
      list.append(...page.items.map((i) => card(i, page.users)));
      before = page.next;
      more.hidden = !page.next;
    } catch (err) {
      list.append(el('p', { class: 'warn' }, err.message.includes('No reachable') ? t('noNode', label(state.network)) : err.message));
      showSource(null);
    } finally {
      more.disabled = false;
    }
  };
  more.onclick = load;
  await load();
}

export async function voicePage(id) {
  const main = $('#main');
  main.replaceChildren(el('p', { class: 'muted' }, '…'));
  const data = await api(`/api/voices/${id}`, { network: state.network });
  showSource(data.source);
  main.replaceChildren(...[
    el('a', { href: '#/voices', class: 'back' }, t('back')),
    card(data.voice, data.users, { inThread: true }),
    data.voice.retracted ? el('p', { class: 'muted' }, t('retracted')) : null,
    el('h2', {}, t('replies')),
    el('div', { class: 'list replies' }, ...(data.replies.length ? data.replies.map((r) => card(r, data.users, { inThread: true })) : [el('p', { class: 'muted' }, t('empty'))])),
    composer({ parentId: Number(id), onSent: () => voicePage(id) }),
  ].filter(Boolean));
}

export function peoplePage({ route }) {
  const main = $('#main');
  const input = el('input', { placeholder: t('addPlaceholder'), autocapitalize: 'off', autocomplete: 'off' });
  const status = el('p', { class: 'status' });
  const chips = el('div', { class: 'chips' }, ...state.people.map((p) => el('span', { class: 'chip' }, `@${p.username ?? p.fid}`,
    el('button', { type: 'button', 'aria-label': t('remove'), onclick: () => { state.people = state.people.filter((x) => x.fid !== p.fid); store.set('people', state.people); route(); } }, '×'))));
  const form = el('form', {
    class: 'add',
    onsubmit: async (e) => {
      e.preventDefault();
      try {
        const user = await api('/api/user', { network: state.network, q: input.value.trim() });
        if (!state.people.some((p) => p.fid === user.fid)) state.people.push({ fid: user.fid, username: user.username });
        store.set('people', state.people);
        route();
      } catch {
        status.textContent = t('notFound');
      }
    },
  }, input, el('button', { type: 'submit' }, t('add')));
  const header = [el('p', { class: 'muted' }, t('peopleHelp')), form, status, chips];
  if (!state.people.length) return main.replaceChildren(...header);
  return feedPage({ fids: state.people.map((p) => p.fid), header, route });
}
