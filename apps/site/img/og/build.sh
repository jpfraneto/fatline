#!/bin/bash
# Renders og.html into og.jpg (1200x630, the link-preview image). Needs Google Chrome and ffmpeg.
cd "$(dirname "$0")"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --window-size=1200,630 --force-device-scale-factor=1 --virtual-time-budget=8000 \
  --screenshot="$PWD/og.png" "file://$PWD/og.html" 2>/dev/null
ffmpeg -v error -y -i og.png -q:v 3 og.jpg && rm og.png && ls -l og.jpg
