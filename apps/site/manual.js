// The instruction manual: how to bring a Fatline of your own to life. One file, no dependencies.
// fatline.ink loads it as /manual.js; every node's client (apps/opinions) bundles it at build time, so a node never
// asks fatline.ink for it. The links point at fatline.ink and GitHub because that is where the docs live.
//
// The commands below must say what README.md, apps/site/docs/index.md and apps/site/skill.md say.
// infra/test/manual.test.mjs checks that they do: change those first, then this.
//
//   import { mountManual } from './manual.js';
//   const manual = mountManual(element, { lang: 'en', dock: false, openUrl });
//   manual.open({ scroll: true });  manual.close();  manual.setLang('es');

export const AGENT_PROMPT = 'Help me run a Fatline: https://fatline.ink/skill.md';
export const INSTALL = 'curl -fsSL https://fatline.ink/install.sh | sh';
export const JOIN_CHECK = 'curl -fsSL https://fatline.ink/join.sh | bash -s -- --check';

// By hand: the five steps, each with its commands. Notes are per language, below.
export const BY_HAND = [
  { key: 'cli', cmds: ['git clone https://github.com/jpfraneto/fatline', 'cd fatline && npm install -g .'] },
  { key: 'compute', cmds: ['fatline compute --quote', 'fatline compute'] },
  { key: 'node', cmds: ['fatline node snapchain', 'fatline node hypersnap'] },
  { key: 'client', cmds: ['fatline client'] },
  { key: 'identity', cmds: ['fatline egg'] },
];

export const LINKS = {
  docs: 'https://fatline.ink/docs/',
  tutorial: 'https://fatline.ink/docs/tutorial.html',
  skill: 'https://fatline.ink/skill.md',
  source: 'https://github.com/jpfraneto/fatline',
  install: 'https://github.com/jpfraneto/fatline/blob/main/apps/site/install.sh',
  join: 'https://fatline.ink/docs/#bring-your-node',
};

export const TEXT = {
  en: {
    title: 'Instruction manual',
    sub: 'Run a Fatline of your own',
    cover: 'You are looking at a living Fatline. Bring one to life yourself.',
    phone: 'Setting up happens on a computer or a server, not on a phone. Here you can explore Fatline, approve wallet payments and sign in with the Farcaster app. Copy the first line and send it to your computer.',
    agentK: 'For your agent',
    agentWhere: 'Paste it into Claude Code, Codex or another coding agent that can run commands.',
    agentWhat: 'It walks you through setting up your own node and client, asks before spending any money, and keeps you in control.',
    desk: 'Open a terminal (on a Mac: ⌘ Space, then Terminal), start your agent, paste.',
    share: 'Share',
    copy: 'Copy', copied: 'Copied', selected: 'Selected: copy it', copiedSay: 'Copied to the clipboard.',
    guidedK: 'Guided install',
    guided: 'In a terminal on macOS or Linux. It puts Fatline in `~/fatline`, then goes one step at a time: what it does, what it costs, how long it takes. Go, skip or stop.',
    readFirst: 'Read the script first',
    handK: 'Everything by hand',
    handSub: 'Five steps, the same commands the guide runs.',
    before: 'You need git, ssh and Node.js 22.12+ on macOS or Linux. To rent a server: a wallet you already use, with about 12 USDC on Base.',
    steps: {
      cli: ['Get the Fatline CLI', 'Puts the `fatline` command on your PATH. `fatline help` lists everything.'],
      compute: ['Set up compute', 'The quote is free and signs nothing. Then a server by the day, in USDC on Base, about 11 USDC a day, approved in your own wallet (a QR code or your browser). It stops by itself when its paid days end; `fatline compute renew --days N` adds days.', [
        'Or:',
        'your own Hetzner account, by card, about $2.60 a day: `fatline compute hetzner`. It bills by the hour until `fatline compute hetzner down`.',
        'a server you already have: `fatline compute vps root@<ip>`',
        'this computer, with Docker and ~700 GB free: `fatline node snapchain --local`',
      ]],
      node: ['Run Snapchain or Hypersnap', 'Pick one. A full copy of Farcaster streams onto your server (a ~400 GB snapshot): it answers in about an hour and a half, then catches up over a few more. Snapchain is run by Farcaster; Hypersnap is a community fork that keeps full history.'],
      client: ['Open your client', 'It serves `http://localhost:8787`, reading from your node, and always says which node that is.'],
      identity: ['Connect your identity, when you want to', 'To post, press Cast in your client: it gives the client its own key for your account (not a new account), approved in the Farcaster app or with one signature from the wallet that owns it. No seed phrase, ever. Then `fatline egg` lays an egg your node keeps warm: three warm days and it hatches into one of the 777 Fatliners.'],
    },
    alreadyK: 'Already run a node?',
    already: 'On its server. This only looks: version, sync, and what joining would change.',
    alreadyLink: 'Bring it in',
    careK: 'Before you begin',
    care: [
      'A node costs real money: rented, about 11 USDC a day. Nothing is paid until you approve it in your own wallet.',
      'Never paste a key or a recovery phrase into a chat. Fatline never asks for one.',
      'Each step has been run on its own. A fresh run, start to finish, by a stranger is still untested.',
    ],
    links: { docs: 'Docs', tutorial: 'Tutorial', skill: 'The skill', source: 'Source' },
  },
  es: {
    title: 'Manual de instrucciones',
    sub: 'Corre tu propio Fatline',
    cover: 'Estás mirando un Fatline vivo. Dale vida a uno tú mismo.',
    phone: 'La instalación se hace en un computador o un servidor, no en un teléfono. Aquí puedes explorar Fatline, aprobar pagos de tu billetera y entrar con la app de Farcaster. Copia la primera línea y mándala a tu computador.',
    agentK: 'Para tu agente',
    agentWhere: 'Pégala en Claude Code, Codex u otro agente de código que pueda ejecutar comandos.',
    agentWhat: 'Te guía para montar tu propio nodo y tu cliente, pregunta antes de gastar dinero y te deja a ti el control.',
    desk: 'Abre una terminal (en un Mac: ⌘ Espacio, luego Terminal), inicia tu agente y pega.',
    share: 'Compartir',
    copy: 'Copiar', copied: 'Copiado', selected: 'Seleccionado: cópialo', copiedSay: 'Copiado al portapapeles.',
    guidedK: 'Instalación guiada',
    guided: 'En una terminal de macOS o Linux. Deja Fatline en `~/fatline` y avanza paso a paso: qué hace, cuánto cuesta, cuánto tarda. Sigues, saltas o paras.',
    readFirst: 'Lee el script antes',
    handK: 'Todo a mano',
    handSub: 'Cinco pasos, los mismos comandos que corre la guía.',
    before: 'Necesitas git, ssh y Node.js 22.12+ en macOS o Linux. Para arrendar un servidor: una billetera que ya uses, con unos 12 USDC en Base.',
    steps: {
      cli: ['Consigue el CLI de Fatline', 'Deja el comando `fatline` en tu PATH. `fatline help` lo lista todo.'],
      compute: ['Prepara el servidor', 'La cotización es gratis y no firma nada. Después, un servidor por día, en USDC en Base, unos 11 USDC al día, aprobado en tu propia billetera (un código QR o tu navegador). Se apaga solo cuando terminan los días pagados; `fatline compute renew --days N` suma días.', [
        'O:',
        'tu propia cuenta de Hetzner, con tarjeta, unos $2,60 al día: `fatline compute hetzner`. Cobra por hora hasta `fatline compute hetzner down`.',
        'un servidor que ya tengas: `fatline compute vps root@<ip>`',
        'este computador, con Docker y ~700 GB libres: `fatline node snapchain --local`',
      ]],
      node: ['Corre Snapchain o Hypersnap', 'Elige uno. Una copia completa de Farcaster llega a tu servidor (una instantánea de ~400 GB): responde en cerca de hora y media y se pone al día en unas horas más. Snapchain lo corre Farcaster; Hypersnap es un fork comunitario que guarda toda la historia.'],
      client: ['Abre tu cliente', 'Sirve `http://localhost:8787`, leyendo desde tu nodo, y siempre dice cuál nodo es.'],
      identity: ['Conecta tu identidad, cuando quieras', 'Para publicar, toca Cast en tu cliente: le da al cliente su propia llave para tu cuenta (no es una cuenta nueva), aprobada en la app de Farcaster o con una firma de la billetera dueña de la cuenta. Nunca una frase semilla. Después, `fatline egg` pone un huevo que tu nodo mantiene tibio: tres días tibios y nace uno de los 777 Fatliners.'],
    },
    alreadyK: '¿Ya corres un nodo?',
    already: 'En su servidor. Esto solo mira: versión, sincronía y lo que cambiaría al unirse.',
    alreadyLink: 'Súmalo',
    careK: 'Antes de empezar',
    care: [
      'Un nodo cuesta dinero de verdad: arrendado, unos 11 USDC al día. Nada se paga hasta que lo apruebas en tu propia billetera.',
      'Nunca pegues una llave ni una frase de recuperación en un chat. Fatline nunca te la pide.',
      'Cada paso se ha corrido por separado. Una corrida completa, de principio a fin, por alguien de fuera, aún no se ha probado.',
    ],
    links: { docs: 'Docs', tutorial: 'Tutorial', skill: 'La skill', source: 'Código' },
  },
};

const ROMAN = ['I', 'II', 'III', 'IV'];
// The Farcaster arch, as on fatline.ink's LAUNCH button.
const ARCH = '<svg viewBox="128.889 155.556 751.111 688.889" aria-hidden="true" focusable="false"><path fill="currentColor" d="M257.778 155.556h484.444v688.889h-71.111V528.889h-.697c-7.86-87.212-81.156-155.556-170.414-155.556s-162.554 68.344-170.414 155.556h-.697v315.556h-71.111z"/><path fill="currentColor" d="M128.889 253.333l28.889 97.778h24.444v395.556c-12.273 0-22.222 9.949-22.222 22.222v26.667h-4.444c-12.273 0-22.223 9.949-22.223 22.222v26.667h248.889v-26.667c0-12.273-9.949-22.222-22.222-22.222h-4.444v-26.667c0-12.273-9.95-22.222-22.223-22.222h-26.666V253.333zM675.556 746.667c-12.273 0-22.223 9.949-22.223 22.222v26.667h-4.444c-12.273 0-22.222 9.949-22.222 22.222v26.667h248.889v-26.667c0-12.273-9.95-22.222-22.223-22.222h-4.444v-26.667c0-12.273-9.949-22.222-22.222-22.222V351.111h24.444L880 253.333H702.222v493.334z"/></svg>';
const CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// The docked layout (a column beside the client) starts at this width. apps/opinions/src/style.css uses the same.
const CSS = `
.flm { --flm-ink: var(--text, var(--ink, #f3eadb)); --flm-muted: var(--muted, rgba(243, 234, 219, .64));
  --flm-line: var(--line, rgba(243, 234, 219, .14)); --flm-accent: var(--accent, #edba54); --flm-gold: var(--gold, #edba54);
  --flm-on-accent: var(--accent-ink, #15100a); --flm-ok: var(--ok, #66b8a8);
  --flm-mono: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace); --flm-radius: var(--veil, 20px 8px 20px 8px);
  --flm-back: cubic-bezier(.34, 1.45, .64, 1);
  container: flm / inline-size; position: relative; text-align: left; color: var(--flm-ink); font-size: 15px; line-height: 1.5;
  border-radius: var(--flm-radius); border: .7px solid color-mix(in srgb, var(--flm-gold) 30%, transparent);
  background: linear-gradient(165deg, color-mix(in srgb, var(--flm-accent) 10%, transparent), transparent 46%), rgba(12, 10, 28, .42);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, .05), 0 14px 44px rgba(0, 0, 0, .28);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }
.flm *, .flm *::before { box-sizing: border-box; }
.flm button { font: inherit; color: inherit; }
.flm a { color: var(--flm-ink); text-decoration-color: color-mix(in srgb, var(--flm-accent) 70%, transparent); text-underline-offset: 3px; }
.flm-head { display: flex; flex-wrap: wrap; align-items: stretch; }
.flm-toggle { flex: 1 1 100%; min-width: 0; display: flex; align-items: center; gap: 12px; min-height: 50px; margin: 0; padding: 10px 12px 10px 14px;
  background: none; border: 0; border-radius: inherit; cursor: pointer; text-align: left; -webkit-tap-highlight-color: transparent; }
.flm-toggle:focus-visible, .flm-copy:focus-visible, .flm-more:focus-visible, .flm-share:focus-visible, .flm a:focus-visible {
  outline: 2px solid var(--flm-accent); outline-offset: 2px; }
.flm-toggle:focus-visible { outline-offset: -3px; }
.flm-glyph { position: relative; width: 22px; height: 20px; flex: none; color: var(--flm-gold); display: grid; place-items: center;
  filter: drop-shadow(0 0 6px color-mix(in srgb, var(--flm-gold) 65%, transparent)); }
.flm-glyph svg { width: 100%; height: 100%; }
.flm-glyph::after { content: ""; position: absolute; inset: -6px; border-radius: 50%; border: .7px solid color-mix(in srgb, var(--flm-gold) 35%, transparent);
  opacity: 0; transform: scale(.6); }
.flm[data-moving] .flm-glyph::after { animation: flm-ring .9s ease-out; }
.flm-titles { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.flm-title { font-weight: 600; font-size: 11.5px; line-height: 1.2; letter-spacing: .26em; text-transform: uppercase; white-space: nowrap; }
.flm-sub { min-width: 0; font-size: 13.5px; color: var(--flm-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.flm-cover { display: none; }
.flm-chev { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border-radius: 50%; color: var(--flm-muted);
  border: .7px solid var(--flm-line); transition: transform .6s var(--flm-back), color .3s, border-color .3s; }
.flm-chev svg { width: 14px; height: 14px; }
.flm-toggle:hover > .flm-chev { color: var(--flm-ink); border-color: color-mix(in srgb, var(--flm-gold) 50%, transparent); }
.flm[data-open] .flm-toggle > .flm-chev { transform: rotate(180deg); color: var(--flm-gold); }
.flm-quick { display: none; flex: 1 1 100%; margin: 0 14px 14px; }
.flm-quick > .flm-cmd { flex: 1; }
.flm[data-open] .flm-quick { display: none !important; }

.flm-body[hidden] { display: none; }
.flm[data-moving] .flm-body, .flm-hand[data-moving] { overflow: hidden; }
.flm-inner { display: grid; gap: 14px; margin: 0 14px; padding: 14px 0 16px; border-top: .7px solid var(--flm-line); }
.flm-rise { opacity: 0; transform: translateY(10px); transition: opacity .3s ease, transform .75s var(--flm-back); transition-delay: calc(var(--i, 0) * 60ms); }
.flm[data-open] .flm-rise { opacity: 1; transform: none; }
.flm:not([data-open]) .flm-rise { transition-duration: .12s; transition-delay: 0s; }
.flm p { margin: 0; }
.flm-phone, .flm-desk { display: none; color: var(--flm-muted); font-size: 13.5px; }
.flm-phone { padding: 10px 12px; border-radius: 12px 5px 12px 5px; background: rgba(255, 255, 255, .04); border: .7px dashed var(--flm-line); }
@media (hover: none) and (pointer: coarse) { .flm-phone { display: block; } }
@media (hover: hover) and (pointer: fine) { .flm-desk { display: block; } }
.flm-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
.flm-step { display: grid; gap: 10px; padding: 14px; border-radius: 16px 6px 16px 6px; border: .7px solid var(--flm-line); background: rgba(255, 255, 255, .03); }
.flm-primary { border-color: color-mix(in srgb, var(--flm-gold) 50%, transparent);
  background: radial-gradient(130% 120% at 0% 0%, color-mix(in srgb, var(--flm-gold) 16%, transparent), transparent 62%), rgba(255, 255, 255, .045);
  box-shadow: 0 0 46px color-mix(in srgb, var(--flm-gold) 10%, transparent); }
.flm-k { display: flex; align-items: baseline; gap: 10px; font: 500 10.5px/1.2 var(--flm-mono); letter-spacing: .22em; text-transform: uppercase; color: var(--flm-gold); }
.flm-k b { font-weight: 600; min-width: 1.6em; }
.flm-note { color: var(--flm-muted); font-size: 13.5px; }
.flm-what { font-size: 15px; }
.flm-cmd { display: flex; align-items: stretch; min-width: 0; border-radius: 12px 5px 12px 5px; overflow: hidden;
  border: .7px solid var(--flm-line); background: rgba(0, 0, 0, .38); }
.flm-cmd code { flex: 1; min-width: 0; margin: 0; padding: 10px 12px; background: none; border: 0; color: var(--flm-ink);
  font: 500 12.5px/1.5 var(--flm-mono); overflow-wrap: anywhere; word-break: normal; -webkit-user-select: all; user-select: all; }
.flm-w { white-space: nowrap; }
.flm-ic { font: 500 .9em var(--flm-mono); color: var(--flm-ink); overflow-wrap: anywhere; }
.flm-alts { margin: 0; padding: 0; list-style: none; display: grid; gap: 6px; font-size: 13.5px; color: var(--flm-muted); }
.flm-hand .flm-alts li { padding-left: 14px; counter-increment: none; }
.flm-hand .flm-alts li::before { content: "–"; width: auto; height: auto; background: none; box-shadow: none; color: var(--flm-gold); font: inherit; display: inline; top: 0; }
.flm-hand .flm-alts li::after { display: none !important; }
.flm-cmd code::before { content: "› "; color: var(--flm-accent); }
.flm-big code { font-size: 14px; padding: 13px 14px; }
.flm-copy { flex: none; min-width: 74px; min-height: 44px; padding: 0 14px; border: 0; border-left: .7px solid var(--flm-line); cursor: pointer;
  background: rgba(255, 255, 255, .06); font-size: 13.5px; font-weight: 600; transition: background-color .25s, color .25s; }
.flm-copy:hover { background: rgba(255, 255, 255, .12); }
.flm-big .flm-copy, .flm-quick .flm-copy { min-width: 86px; border-left: 0; background: var(--flm-accent); color: var(--flm-on-accent); }
.flm-big .flm-copy:hover, .flm-quick .flm-copy:hover { filter: brightness(1.08); }
.flm-copy[data-done] { background: var(--flm-ok) !important; color: #0b0b0b !important; animation: flm-pop .55s var(--flm-back); }
.flm-copy[data-done="selected"] { background: rgba(255, 255, 255, .16) !important; color: var(--flm-ink) !important; }
.flm-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.flm-share { min-height: 40px; padding: 0 16px; border-radius: 999px; border: .7px solid var(--flm-line); background: none; cursor: pointer; font-size: 14px; }
.flm-more { width: 100%; display: flex; align-items: center; gap: 10px; min-height: 44px; margin: -4px 0; padding: 4px 0; border: 0; background: none; cursor: pointer; text-align: left; }
.flm-more .flm-k { flex: 1; }
.flm-more .flm-chev { width: 26px; height: 26px; }
.flm-more[aria-expanded="true"] .flm-chev { transform: rotate(180deg); color: var(--flm-gold); }
.flm-hand[hidden] { display: none; }
.flm-hand > div { display: grid; gap: 14px; padding-top: 6px; }
.flm-hand ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 16px; counter-reset: flm; }
.flm-hand li { position: relative; display: grid; gap: 8px; padding-left: 34px; counter-increment: flm; }
.flm-hand li::before { content: counter(flm); position: absolute; left: 0; top: -1px; width: 23px; height: 23px; display: grid; place-items: center; border-radius: 50%;
  font: 600 11.5px var(--flm-mono); color: var(--flm-on-accent); background: var(--flm-accent); box-shadow: 0 0 14px color-mix(in srgb, var(--flm-accent) 45%, transparent); }
.flm-hand li:not(:last-child)::after { content: ""; position: absolute; left: 11px; top: 28px; bottom: -12px; width: .7px; background: var(--flm-line); }
.flm-hand h4 { margin: 0; font-size: 15.5px; font-weight: 600; line-height: 1.3; }
.flm-hand .flm-cmd code { font-size: 12px; padding: 8px 10px; }
.flm-hand .flm-copy { min-height: 40px; min-width: 64px; font-size: 12.5px; }
.flm-or { margin: -2px 0; font: 500 10.5px var(--flm-mono); letter-spacing: .2em; text-transform: uppercase; color: var(--flm-muted); }
.flm-already { display: grid; gap: 8px; padding-top: 12px; border-top: .7px solid var(--flm-line); }
.flm-care { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; font-size: 13.5px; color: var(--flm-muted); }
.flm-care li { position: relative; padding-left: 18px; }
.flm-care li::before { content: "◇"; position: absolute; left: 0; color: var(--flm-gold); font-size: 11px; top: 2px; }
.flm-care-k { margin-bottom: 2px !important; font: 500 10.5px var(--flm-mono); letter-spacing: .22em; text-transform: uppercase; color: var(--flm-muted); }
.flm-links { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 14px; }
.flm-links a { display: inline-flex; align-items: center; min-height: 32px; }
.flm-live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Room for more: the first instruction is on the cover, so copying it takes one click. */
@container flm (max-width: 420px) { .flm-sub { display: none; } }
@container flm (min-width: 540px) {
  .flm-toggle { padding: 14px 16px 12px 18px; }
  .flm-quick { display: flex; margin: 0 18px 16px; }
  .flm-inner { margin: 0 18px; }
  .flm-big code { font-size: 15px; }
}
@media (min-width: 1000px) {
  .flm[data-dock] .flm-toggle { position: relative; flex-direction: column; align-items: flex-start; gap: 12px; padding: 22px 20px 14px; }
  .flm[data-dock] .flm-glyph { width: 32px; height: 29px; }
  .flm[data-dock] .flm-titles { flex-direction: column; gap: 8px; }
  .flm[data-dock] .flm-sub { display: none; }
  .flm[data-dock] .flm-cover { display: block; font-size: 18px; line-height: 1.35; color: var(--flm-ink); }
  .flm[data-dock] .flm-toggle > .flm-chev { position: absolute; top: 18px; right: 16px; }
  .flm[data-dock] .flm-big code { font-size: 13px; }
  .flm[data-dock] .flm-quick { display: flex; margin: 0 16px 16px; }
  .flm[data-dock] .flm-quick code { font-size: 12.5px; }
}
@keyframes flm-pop { 0% { transform: scale(.92); } 100% { transform: scale(1); } }
@keyframes flm-ring { 0% { opacity: .9; transform: scale(.6); } 100% { opacity: 0; transform: scale(1.7); } }
@media (prefers-reduced-motion: reduce) {
  .flm *, .flm *::before, .flm *::after { transition: none !important; animation: none !important; }
  .flm-rise { opacity: 1; transform: none; }
}
`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A command, set so a line breaks between its words, or after a slash inside an address: never inside a word.
const words = (text) => text.split(' ').map((w) => (w.includes('/')
  ? esc(w).replace(/([^/])\/(?=[^/])/g, '$1/<wbr>') : `<span class="flm-w">${esc(w)}</span>`)).join(' ');
// Prose with `commands` in it.
const prose = (text) => esc(text).replace(/`([^`]+)`/g, '<code class="flm-ic">$1</code>');
const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// A damped spring, sampled at 60 frames a second: the heights for one unfolding (or folding).
function springFrames(from, to, { stiffness = 230, damping = 20 } = {}) {
  const out = [from];
  let x = from, v = 0;
  for (let i = 0; i < 240; i++) {
    v += (-stiffness * (x - to) - damping * v) / 60;
    x += v / 60;
    out.push(Math.max(0, x));
    if (Math.abs(v) < 20 && Math.abs(x - to) < 1) break; // settled: under a pixel, barely moving
  }
  out.push(to);
  return out;
}

// Folds a region open or shut with a spring on its height, from the height it has now (0 when hidden; mid-way
// when the last fold is still running). host gets data-moving while it runs.
function fold(region, host, opening, done) {
  const from = region.hidden ? 0 : region.getBoundingClientRect().height;
  region.getAnimations?.().forEach((a) => a.cancel());
  region.style.height = '';
  region.hidden = false;
  const to = opening ? region.getBoundingClientRect().height : 0;
  const finish = () => { host.removeAttribute('data-moving'); if (!opening) region.hidden = true; done?.(); };
  if (reduced() || !region.animate) return finish();
  host.setAttribute('data-moving', '');
  const frames = springFrames(from, to, opening ? {} : { stiffness: 620, damping: 52 }); // shutting: quicker, no bounce
  const anim = region.animate(frames.map((h) => ({ height: `${h}px` })), { duration: frames.length * (1000 / 60), easing: 'linear' });
  anim.onfinish = finish;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* below */ }
  try { // older webviews (some in-app browsers) still allow this
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(ta); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy'); ta.remove();
    if (ok) return true;
  } catch { /* below */ }
  return false;
}

let styled = false;
let uid = 0;

/** Draws the manual into `target`. Returns { open, close, toggle, setLang, element }. */
export function mountManual(target, { lang = 'en', dock = false, openUrl = null } = {}) {
  if (!styled) {
    const style = document.createElement('style');
    style.dataset.fatlineManual = '';
    style.textContent = CSS;
    document.head.append(style);
    styled = true;
  }
  const id = `flm-${++uid}`;
  const root = document.createElement('section');
  root.className = 'flm';
  if (dock) root.dataset.dock = '';
  target.replaceChildren(root);
  let isOpen = false;
  let handOpen = false;
  let L = TEXT[lang] ?? TEXT.en;
  const timers = new WeakMap();

  const cmd = (text, { big = false } = {}) =>
    `<div class="flm-cmd${big ? ' flm-big' : ''}"><code>${words(text)}</code><button type="button" class="flm-copy" data-copy="${esc(text)}">${esc(L.copy)}</button></div>`;
  const link = (key, text) => `<a href="${esc(LINKS[key])}" target="_blank" rel="noopener">${esc(text)}</a>`;
  const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

  function render() {
    const hand = BY_HAND.map((s) => {
      const [title, note, alts] = L.steps[s.key];
      const cmds = s.key === 'node'
        ? `${cmd(s.cmds[0])}<p class="flm-or">${lang === 'es' ? 'o' : 'or'}</p>${cmd(s.cmds[1])}`
        : s.cmds.map((c) => cmd(c)).join('');
      const more = alts ? `<p class="flm-note">${esc(alts[0])}</p><ul class="flm-alts">${alts.slice(1).map((a) => `<li>${prose(a)}</li>`).join('')}</ul>` : '';
      return `<li><h4>${esc(title)}</h4>${cmds}<p class="flm-note">${prose(note)}</p>${more}</li>`;
    }).join('');
    root.setAttribute('aria-label', L.title);
    root.innerHTML = `
      <div class="flm-head">
        <button type="button" class="flm-toggle" id="${id}-t" aria-expanded="${isOpen}" aria-controls="${id}-b">
          <span class="flm-glyph">${ARCH}</span>
          <span class="flm-titles"><span class="flm-title">${esc(L.title)}</span><span class="flm-sub">${esc(L.sub)}</span><span class="flm-cover">${esc(L.cover)}</span></span>
          <span class="flm-chev">${CHEVRON}</span>
        </button>
        <div class="flm-quick">${cmd(AGENT_PROMPT)}</div>
      </div>
      <div class="flm-body" id="${id}-b" role="region" aria-labelledby="${id}-t"${isOpen ? '' : ' hidden'}>
        <div class="flm-inner">
          <p class="flm-phone flm-rise" style="--i:0">${esc(L.phone)}</p>
          <ol class="flm-steps">
            <li class="flm-step flm-primary flm-rise" style="--i:1">
              <p class="flm-k"><b>${ROMAN[0]}</b>${esc(L.agentK)}</p>
              ${cmd(AGENT_PROMPT, { big: true })}
              <p class="flm-what">${esc(L.agentWhere)} ${esc(L.agentWhat)}</p>
              <p class="flm-desk">${esc(L.desk)}</p>
              ${canShare() ? `<div class="flm-row"><button type="button" class="flm-share">${esc(L.share)}</button></div>` : ''}
            </li>
            <li class="flm-step flm-rise" style="--i:2">
              <p class="flm-k"><b>${ROMAN[1]}</b>${esc(L.guidedK)}</p>
              ${cmd(INSTALL)}
              <p class="flm-note">${prose(L.guided)} ${link('install', L.readFirst)}.</p>
            </li>
            <li class="flm-step flm-rise" style="--i:3">
              <button type="button" class="flm-more" id="${id}-h" aria-expanded="${handOpen}" aria-controls="${id}-hb">
                <span class="flm-k"><b>${ROMAN[2]}</b>${esc(L.handK)}</span><span class="flm-chev">${CHEVRON}</span>
              </button>
              <p class="flm-note">${esc(L.handSub)}</p>
              <div class="flm-hand" id="${id}-hb" role="region" aria-labelledby="${id}-h"${handOpen ? '' : ' hidden'}><div>
                <p class="flm-note">${prose(L.before)}</p>
                <ol>${hand}</ol>
                <div class="flm-already">
                  <p class="flm-k"><b>·</b>${esc(L.alreadyK)}</p>
                  ${cmd(JOIN_CHECK)}
                  <p class="flm-note">${esc(L.already)} ${link('join', L.alreadyLink)}.</p>
                </div>
              </div></div>
            </li>
          </ol>
          <div class="flm-rise" style="--i:4">
            <p class="flm-care-k">${esc(L.careK)}</p>
            <ul class="flm-care">${L.care.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          </div>
          <p class="flm-links flm-rise" style="--i:5">${Object.entries(L.links).map(([k, v]) => link(k, v)).join('')}</p>
        </div>
      </div>
      <p class="flm-live" aria-live="polite"></p>`;
    if (isOpen) root.dataset.open = ''; else delete root.dataset.open;
  }

  const toggleBtn = () => root.querySelector('.flm-toggle');
  const body = () => root.querySelector('.flm-body');

  function setOpen(next, { scroll = false, focus = false } = {}) {
    if (next === isOpen) {
      if (next && scroll) root.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      if (focus) toggleBtn().focus({ preventScroll: true });
      return;
    }
    isOpen = next;
    toggleBtn().setAttribute('aria-expanded', String(next));
    const region = body();
    if (next) {
      fold(region, root, true); // un-hides it at its old height, then springs open
      void region.offsetHeight; // the contents start below and transparent, then rise
      root.dataset.open = '';
      if (scroll) root.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
    } else {
      delete root.dataset.open;
      if (region.contains(document.activeElement)) toggleBtn().focus({ preventScroll: true });
      fold(region, root, false);
    }
    if (focus) toggleBtn().focus({ preventScroll: true });
  }

  async function copy(btn) {
    const text = btn.dataset.copy;
    const ok = await copyText(text);
    clearTimeout(timers.get(btn));
    if (ok) {
      btn.dataset.done = 'copied'; btn.textContent = L.copied;
      root.querySelector('.flm-live').textContent = L.copiedSay;
    } else { // no clipboard here: select the text, so a long press or ⌘C takes it
      const code = btn.previousElementSibling;
      const range = document.createRange(); range.selectNodeContents(code);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      btn.dataset.done = 'selected'; btn.textContent = L.selected;
    }
    timers.set(btn, setTimeout(() => { delete btn.dataset.done; btn.textContent = L.copy; root.querySelector('.flm-live').textContent = ''; }, 1800));
  }

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button, a');
    if (!t || !root.contains(t)) return;
    if (t.classList.contains('flm-toggle')) return setOpen(!isOpen);
    if (t.classList.contains('flm-copy')) return copy(t);
    if (t.classList.contains('flm-share')) {
      navigator.share({ text: AGENT_PROMPT }).catch(() => {});
      return;
    }
    if (t.classList.contains('flm-more')) {
      handOpen = !handOpen;
      t.setAttribute('aria-expanded', String(handOpen));
      fold(root.querySelector('.flm-hand'), root.querySelector('.flm-hand'), handOpen);
      return;
    }
    // Inside a Farcaster app, links open through the app (openUrl), not inside this page.
    if (t.tagName === 'A' && openUrl) { e.preventDefault(); openUrl(t.href); }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) { e.stopPropagation(); setOpen(false, { focus: true }); }
  });

  render();
  return {
    element: root,
    open: (o) => setOpen(true, o),
    close: (o) => setOpen(false, o),
    toggle: () => setOpen(!isOpen),
    get isOpen() { return isOpen; },
    setLang(next) {
      if (next === lang || !TEXT[next]) return;
      lang = next; L = TEXT[next];
      render();
    },
  };
}
