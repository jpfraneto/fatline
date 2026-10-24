#!/bin/bash
# Renders each og*.html here into its .jpg (1200x630 link-preview images). Needs Google Chrome and ffmpeg.
cd "$(dirname "$0")"
for page in og*.html; do
  name="${page%.html}"
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
    --window-size=1200,630 --force-device-scale-factor=1 --virtual-time-budget=8000 \
    --screenshot="$PWD/$name.png" "file://$PWD/$page" 2>/dev/null
  ffmpeg -v error -y -i "$name.png" -q:v 3 "$name.jpg" && rm "$name.png" && ls -l "$name.jpg"
done
