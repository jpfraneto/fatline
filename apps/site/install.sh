#!/bin/sh
# Fatline installer:  curl -fsSL https://fatline.ink/install.sh | sh
#
# What it does, in order (read it before you run it; it is short):
#   1. checks for git and Node.js 22.12+ (it never installs them for you; it says how)
#   2. downloads Fatline from github.com/jpfraneto/fatline into ~/fatline (or updates it there)
#   3. starts ./fatline setup, which asks before every step and never spends money without you typing "create"
#
# Settings: FATLINE_DIR=/somewhere/else   FATLINE_NO_SETUP=1 (download only)
# Source: https://github.com/jpfraneto/fatline/blob/main/apps/site/install.sh  ·  MIT
set -eu

REPO="https://github.com/jpfraneto/fatline"
DIR="${FATLINE_DIR:-$HOME/fatline}"

say() { printf '%s\n' "$*"; }
stop() { say ""; say "  $*"; exit 1; }

say ""
say "  FATLINE · your own Farcaster node and client"
say ""

command -v git >/dev/null 2>&1 || stop "git is missing. macOS: xcode-select --install   ·   Debian/Ubuntu: sudo apt install git"
command -v node >/dev/null 2>&1 || stop "Node.js 22.12 or newer is missing. Get it from https://nodejs.org (or: brew install node), then run this line again."
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)' \
  || stop "Node.js $(node -v) is too old. Install 22.12 or newer from https://nodejs.org, then run this line again."

if [ -d "$DIR/.git" ]; then
  say "  Updating $DIR"
  git -C "$DIR" pull --ff-only --quiet || say "  (could not update: local changes? keeping your copy as it is)"
elif [ -e "$DIR" ]; then
  stop "$DIR exists and is not a Fatline copy. Move it, or choose another folder: FATLINE_DIR=~/somewhere sh install.sh"
else
  say "  Downloading Fatline into $DIR"
  git clone --quiet "$REPO" "$DIR"
fi
say "  Version: $(git -C "$DIR" log -1 --format='%h, %cs')"
say ""

if [ "${FATLINE_NO_SETUP:-}" = 1 ]; then
  say "  Downloaded. Start when you're ready:  cd $DIR && ./fatline setup"
  exit 0
fi

# Piped from curl, our stdin is the script itself; the setup asks questions, so it reads from the terminal.
if [ -r /dev/tty ] && { : < /dev/tty; } 2>/dev/null; then
  cd "$DIR" && exec ./fatline setup < /dev/tty
fi
say "  No terminal to ask questions in (an agent or a script?). Next:"
say "    cd $DIR && ./fatline setup --plan      # every step and its command"
say "  Agents: follow https://fatline.ink/skill.md"
