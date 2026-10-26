# The Fatline hatchery, alone, in a container. For people who already run a node and want to add it to Fatline
# without giving anything root on their server. Build from the repository root:
#   docker build -f infra/hatchery.Dockerfile -t fatline-hatchery .
# Run it with infra/hatchery.compose.yml: non-root, read-only filesystem, no capabilities, one data folder, one port.
#
# What is inside: Node.js (pinned by digest), the indexer's code and its locked dependencies, the Fatliners code
# that reads an egg's DNA, and the one deployment file. No shell scripts, no git, no package manager at runtime.
# Source: https://github.com/jpfraneto/fatline/blob/main/infra/hatchery.Dockerfile · MIT
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS deps
WORKDIR /app/indexer
COPY indexer/package.json indexer/package-lock.json ./
# Exactly the versions in the lockfile, without running any package's install scripts.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force

FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d
# npm, npx, corepack and yarn are not needed to run: remove them, so the image has less to misuse.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn* \
      /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
WORKDIR /app
COPY --from=deps /app/indexer/node_modules indexer/node_modules
COPY indexer/package.json indexer/
COPY indexer/src indexer/src
COPY fatliners/package.json fatliners/
COPY fatliners/src fatliners/src
COPY fatliners/calibration fatliners/calibration
COPY smart-contracts/deployments/base.json smart-contracts/deployments/base.json
COPY fatline.config.example.json LICENSE ./
COPY infra/hatchery-entry.mjs indexer/src/hatchery-entry.mjs

ARG FATLINE_COMMIT=unknown
LABEL org.opencontainers.image.title="fatline-hatchery" \
      org.opencontainers.image.description="Keeps Fatline eggs warm next to your Snapchain or Hypersnap node" \
      org.opencontainers.image.source="https://github.com/jpfraneto/fatline" \
      org.opencontainers.image.revision="$FATLINE_COMMIT" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    FATLINE_DATA=/data \
    FATLINE_COMMIT=$FATLINE_COMMIT \
    HATCHERY_FARCASTER_NODE=http://host.docker.internal:3381 \
    HATCHERY_HYPERSNAP_NODE=http://host.docker.internal:4381
# The node image's own unprivileged user (uid 1000). /data is the only place it writes.
USER node
VOLUME /data
EXPOSE 8791
WORKDIR /app/indexer
ENTRYPOINT ["node", "--experimental-sqlite", "--no-warnings=ExperimentalWarning", "src/hatchery-entry.mjs"]
