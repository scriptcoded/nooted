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
  PORT=3000 \
  XDG_CACHE_HOME=/tmp/.cache

# Chromium (headless shell) and its system libraries and fonts, so the server can draw captures as images for agents.
# Installed as root into a shared path the node user can read, before the app is copied so code-only changes keep this
# layer cached. PLAYWRIGHT_VERSION must match the server's playwright-core; the build checks it below.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ARG PLAYWRIGHT_VERSION=1.64.1
RUN npx --yes playwright-core@$PLAYWRIGHT_VERSION install --with-deps chromium-headless-shell \
  && rm -rf /var/lib/apt/lists/* /root/.npm \
  && chmod -R a+rX /ms-playwright

COPY --from=build /app /app
# Fail the build if the server's playwright-core moved on without PLAYWRIGHT_VERSION.
RUN installed=$(node -p "require('/app/apps/server/node_modules/playwright-core/package.json').version") \
  && [ "$installed" = "$PLAYWRIGHT_VERSION" ] || { echo "playwright-core is $installed, PLAYWRIGHT_VERSION is $PLAYWRIGHT_VERSION" >&2; exit 1; }
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 3000

# Set late so a new revision does not invalidate the Chromium layer.
ARG REVISION
ARG VERSION
ARG SOURCE
LABEL org.opencontainers.image.revision=$REVISION \
  org.opencontainers.image.version=$VERSION \
  org.opencontainers.image.source=$SOURCE

# The slim image has no curl or wget; Kubernetes ignores this and uses its own probes.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

USER node
WORKDIR /app/apps/server
CMD ["node", "src/index.ts"]
