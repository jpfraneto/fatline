// Posting to Farcaster or Hypersnap with this client's own app key.
// The key lives on the machine running the indexer; the browser only asks it to sign.
// Every action shows its real state: sending, then confirmed (read back from the node) or pending.
import { visitorKey, visitorSend } from './visitor.js';
import { api, chosenNode, el, state, store, t } from './lib.js';

const CAST_MAX_BYTES = 1024; // over 320 bytes it goes out as a long cast

export async function loadMe() {
  try { state.me = await api('/api/me'); } catch { state.me = { fid: null, canWrite: false }; }
  // Not this server's owner, but signed in here with a key of your own (visitor.js): you cast as yourself.
  const mine = visitorKey();
  if (!state.me.canWrite && mine) state.me = { fid: mine.fid, canWrite: true, visitor: true, publicKey: mine.publicKey };
  return state.me;
}

const canPost = () => Boolean(state.me?.fid && state.me?.canWrite);

/** A cast (or other action) as whoever is signed in here: the owner's key with its token, or a visitor's browser key. */
export const castAs = (path, body, network) => send(path, body, network);

/** POST with the write token when this client runs on a server (see Settings). */
async function send(path, body, network = state.network) {
  if (state.me?.visitor) return visitorSend(path, { ...body, network, node: chosenNode(network) });
  const token = store.get('writeToken', '');
  const res = await fetch(new URL(path, location.origin), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ ...body, network, node: chosenNode(network) }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out;
}

function report(status, result) {
  status.textContent = (result.state === 'confirmed' ? t('confirmed', result.node) : t('pending'))
    + (result.via ? ` Sent through ${result.via.label ?? result.via.node}${result.via.own ? '' : ' (not yours)'}: ${result.via.because}.` : '')
    + (result.syncing ? ` Your node ${result.syncing.because}.` : '');
  status.classList.remove('confirmed', 'pending');
  status.classList.add(result.state);
}

/** Explains how to post when this client can't yet. */
export function postHint() {
  if (canPost()) return null;
  return el('p', { class: 'muted hint' }, state.me?.fid ? t('needToken') : t('needKey'));
}

/** `network`: where the cast is published. A function, so a selector next to the composer can change it. */
export function castComposer({ parent = null, onDone, network = () => state.network } = {}) {
  if (!canPost()) return postHint();
  const text = el('textarea', { rows: parent ? 2 : 3, maxlength: 1000, placeholder: t(parent ? 'replyPlaceholder' : 'castPlaceholder') });
  const count = el('span', { class: 'count' }, `0 / ${CAST_MAX_BYTES}`);
  const status = el('p', { class: 'status', role: 'status' });
  const button = el('button', { type: 'submit' }, t(parent ? 'reply' : 'castButton'));
  const size = () => new TextEncoder().encode(text.value.trim()).length;
  text.addEventListener('input', () => {
    count.textContent = `${size()} / ${CAST_MAX_BYTES}`;
    count.classList.toggle('over', size() > CAST_MAX_BYTES);
  });
  return el('form', {
    class: 'composer cast-composer',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!size()) return;
      if (size() > CAST_MAX_BYTES) { status.textContent = t('castTooLong'); return; }
      button.disabled = true;
      status.textContent = t('signing');
      try {
        const result = await send('/api/cast', { text: text.value, parent }, network());
        report(status, result);
        text.value = '';
        count.textContent = `0 / ${CAST_MAX_BYTES}`;
        onDone?.(result);
      } catch (err) {
        status.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    },
  }, el('p', { class: 'muted as' }, t('postingAs', state.me.fid)), text, el('div', { class: 'row' }, count, button), status);
}

/** A button that sends one action and then shows whether the node has it. */
function actionButton(label, doneLabel, path, body, status) {
  const button = el('button', { type: 'button', class: 'link' }, label);
  button.onclick = async () => {
    button.disabled = true;
    status.textContent = t('signing');
    try {
      const result = await send(path, body);
      report(status, result);
      button.textContent = doneLabel;
    } catch (err) {
      status.textContent = err.message;
      button.disabled = false;
    }
  };
  return button;
}

/** Reply, like, recast and (for your own casts) delete, under a cast. */
export function castActions(item, { onReplied } = {}) {
  if (item.kind !== 'cast' || !canPost()) return [];
  const status = el('span', { class: 'status inline', role: 'status' });
  const target = { fid: item.fid, hash: item.id };
  const replyBox = el('div', { class: 'reply-box', hidden: true });
  const reply = el('button', { type: 'button', class: 'link' }, t('reply'));
  reply.onclick = () => {
    if (!replyBox.firstChild) replyBox.append(castComposer({ parent: target, onDone: onReplied }));
    replyBox.hidden = !replyBox.hidden;
  };
  const mine = Number(item.fid) === Number(state.me.fid);
  return [
    reply,
    actionButton(t('like'), t('liked'), '/api/react', { kind: 'like', ...target }, status),
    actionButton(t('recast'), t('recasted'), '/api/react', { kind: 'recast', ...target }, status),
    mine ? actionButton(t('delete'), t('deleted'), '/api/cast/delete', { hash: item.id }, status) : null,
    status,
    replyBox,
  ];
}

/** Follow or unfollow someone on the chosen network. */
export function followButton(fid) {
  if (!canPost() || Number(fid) === Number(state.me.fid)) return null;
  const status = el('span', { class: 'status inline', role: 'status' });
  let following = false;
  const button = el('button', { type: 'button', class: 'link' }, t('follow'));
  button.onclick = async () => {
    button.disabled = true;
    status.textContent = t('signing');
    try {
      const result = await send('/api/follow', { fid, remove: following });
      following = !following;
      button.textContent = following ? t('unfollow') : t('follow');
      report(status, result);
    } catch (err) {
      status.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  };
  return el('span', { class: 'follow' }, button, status);
}
