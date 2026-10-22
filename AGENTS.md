# Fatline: instructions for any agent (or person) working here

Start here, whatever tool you use:

1. [STORY.md](STORY.md): how we got here, every decision and why, and what was measured.
2. [MASTER-PROMPT.md](MASTER-PROMPT.md): the plan, the judges' checklist for Balaji's prize (deadline 2026-10-24 14:47:30 UTC), the workstreams in order, and what is done and not done.
3. [README.md](README.md): how to run it, plus an honest "tested / not tested" list.

**The current state and the very next step are in MASTER-PROMPT.md → "Where we are" (Resume here).** Then pick the first unfinished workstream in the master prompt, say which one, build it, test it, and update those three files.

## Commands

- `./fatline help` lists everything.
- `./fatline test` runs every test: Foundry contracts, indexer, infra. Run it before saying something works.
- Launchpad on a fork with fake money: `./fatline contracts fork`, then `./fatline up`. See the README.
- Posting: `./fatline identity`, then `./fatline up`.
- Full node on Hetzner (hourly, card): `./fatline compute hetzner --quote`, then `./fatline compute hetzner`, `… status`, `… down`. On AgentMetal (daily, USDC): `./fatline compute --provider agentmetal --days 1 --disk 700 --node`.

## Rules

- **Secrets:** seed phrases and private keys only go through hidden prompts or environment variables. Never into a chat with an agent, logs, files in the repository, screenshots or video.
- **Real money and real posts need the owner's explicit yes, every time.** That covers renting, paying, deploying, and casting from a real account. Forks, fake nodes and test networks are fine.
- **Never invent** results, testers, vouches or numbers. If it wasn't run, say "untested".
- **Open and the user's choice:** Farcaster and Hypersnap are equals. The node in use is always labeled. No hidden fallback to a hosted API.
- **Keep it plain:** short sentences, and nothing that only looks done. A new version of an app is a new app.
- The owner is budget-constrained: prefer the cheapest and shortest rentals.
