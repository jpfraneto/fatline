#!/bin/sh
# Fatline installer:  curl -fsSL https://fatline.ink/install.sh | sh
#
# What it does, in order (read it before you run it; it is short):
#   1. checks for git and Node.js 22.12+; if one is missing it shows the install command and asks before running it
#      (Debian/Ubuntu: apt and NodeSource's Node 22; macOS: Homebrew). Without a terminal it only says how.
#   2. downloads Fatline from github.com/jpfraneto/fatline into ~/fatline (or updates it there)
#   3. puts the `fatline` command on your PATH (npm install -g, linked to that folder: git pull updates it)
#   4. starts fatline setup, which asks before every step and never spends money without you typing "create"
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

# Asks a yes/no question on the terminal (we may be piped from curl). No terminal: no.
yes_to() {
  [ -r /dev/tty ] && { : < /dev/tty; } 2>/dev/null || return 1
  printf '  %s [y/N] ' "$1" > /dev/tty; read -r ans < /dev/tty
  case "$ans" in y|Y|yes) return 0 ;; *) return 1 ;; esac
}
SUDO=""; [ "$(id -u)" = 0 ] || SUDO="sudo"
node_ok() { command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=12)?0:1)'; }
# What would install a missing tool here, as one line to show and (after a yes) run.
how() {
  if command -v apt-get >/dev/null 2>&1; then
    case "$1" in
      git) echo "$SUDO apt-get update && $SUDO apt-get install -y -qq git" ;;
      node) echo "curl -fsSL https://deb.nodesource.com/setup_22.x | $SUDO bash - && $SUDO apt-get install -y -qq nodejs" ;;
    esac
  elif [ "$(uname -s)" = Darwin ] && command -v brew >/dev/null 2>&1; then
    case "$1" in git) echo "brew install git" ;; node) echo "brew install node" ;; esac
  fi
}
need() { # need <git|node> <what it is>
  line=$(how "$1")
  [ -n "$line" ] || stop "$2 is missing. Install it (git: https://git-scm.com · Node.js 22.12+: https://nodejs.org), then run this line again."
  say "  $2 is missing. It can be installed with:"
  say "    $line"
  yes_to "Install it now?" || stop "Not installed. Run that line yourself (or ask your agent to), then run this line again."
  sh -c "$line" || stop "That didn't finish. Read the lines above, then run this line again."
}
command -v git >/dev/null 2>&1 || need git "git"
node_ok || need node "Node.js 22.12 or newer$(command -v node >/dev/null 2>&1 && printf ' (you have %s)' "$(node -v)")"
node_ok || stop "Node.js is still missing or older than 22.12 (open a new terminal if it was just installed), then run this line again."

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
if npm install -g "$DIR" --no-audit --no-fund --loglevel=error >/dev/null 2>&1 && command -v fatline >/dev/null 2>&1; then
  say "  The fatline command is ready: run it from anywhere."
else
  say "  Could not put fatline on your PATH (npm install -g needs permission here). Use it from the folder: cd $DIR && ./fatline"
fi
say ""

if [ "${FATLINE_NO_SETUP:-}" = 1 ]; then
  say "  Downloaded. Start when you're ready:  fatline setup"
  exit 0
fi

# Piped from curl, our stdin is the script itself; the setup asks questions, so it reads from the terminal.
if [ -r /dev/tty ] && { : < /dev/tty; } 2>/dev/null; then
  cd "$DIR" && exec ./fatline setup < /dev/tty
fi
say "  No terminal to ask questions in (an agent or a script?). Next:"
say "    fatline setup --plan      # every step and its command"
say "  Agents: follow https://fatline.ink/skill.md"
