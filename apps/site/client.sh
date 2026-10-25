#!/usr/bin/env bash
# Moved: run  fatline update  on your node's server. It serves your client at <surname>.fatline.ink.
set -e
[ -x /root/fatline/fatline ] || { echo "First: curl -fsSL https://fatline.ink/join.sh | sudo bash"; exit 1; }
exec /root/fatline/fatline update
