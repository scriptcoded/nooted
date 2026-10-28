# syntax=docker/dockerfile:1

FROM node:26-bookworm-slim AS base
# node:26 images no longer bundle corepack; install it, then pnpm is pinned by the root packageManager field.
RUN npm install -g corepack && corepack enable
WORKDIR /app

# Install dependencies first so source edits don't invalidate the install layer.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/sdk/package.json packages/sdk/
RUN pnpm install --frozen-lockfile

COPY . .
# The SDK must be built before web: apps/web imports @nooted/sdk source, which needs
# src/loader/code.generated.ts. The SDK's dist/ (served by the server) is built here too.
RUN pnpm --filter @nooted/sdk build \
  && pnpm --filter @nooted/web build \
  && pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production \
  DATA_DIR=/data \
  WEB_DIST_DIR=/app/apps/web/dist \
  SDK_DIST_DIR=/app/packages/sdk/dist \
  PORT=3000

COPY --from=build /app /app
# Chromium (headless shell) and its system libraries and fonts, so the server can draw captures as images for agents.
# Installed as root into a shared path the node user can read; playwright-core is the version pinned by the server.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN node apps/server/node_modules/playwright-core/cli.js install --with-deps chromium-headless-shell \
  && rm -rf /var/lib/apt/lists/* \
  && chmod -R a+rX /ms-playwright
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 3000

USER node
WORKDIR /app/apps/server
CMD ["node", "src/index.ts"]
