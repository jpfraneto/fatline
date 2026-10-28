# Your app on MENLO

Edit app.json and run menloapp deploy from your app's repository.
Name, subtitle, description, icon and screenshots appear on your public page.
Shared links get a card with the app icon, title, description and MENLO URL.
Set ogImage to a PNG/JPEG path such as menloapp/share.png for custom share artwork
(1200 x 630 recommended), or leave it null to use the automatic card.
website and tokenAddress are optional. An ERC-20 token uses CAIP-19:
eip155:CHAIN_ID/erc20:0x followed by the token's 40 hex address characters.
MENLO fills githubRepo and menloLink automatically when you deploy.

Use real PNG/JPEG images inside menloapp/ (up to three screenshots, 10 MiB each).
A preview is an MP4 of up to 50 MiB. These files are public and committed.
Deploy can generate a preview with Codex in a fresh iPhone Simulator.
Use --record to regenerate it, or --no-preview to skip generation.

Only the metadata and captures created by this deploy are committed automatically.
Commit your own app changes before deploying. Keep node_modules/ ignored if
menloapp is installed as a project dependency.
