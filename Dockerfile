# One image for every Chainwork process: contracts tooling (forge, cast), the TypeScript services,
# the agents and the dashboard. docker-compose.yml picks the command per service.
FROM ghcr.io/foundry-rs/foundry:stable AS foundry

FROM node:22-bookworm-slim
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends git ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=foundry /usr/local/bin/forge /usr/local/bin/cast /usr/local/bin/anvil /usr/local/bin/
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# Dependencies first, for layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/types/package.json packages/types/
COPY packages/sdk/package.json packages/sdk/
COPY services/checks/package.json services/checks/
COPY services/kit/package.json services/kit/
COPY services/facilitator/package.json services/facilitator/
COPY services/indexer/package.json services/indexer/
COPY services/watcher/package.json services/watcher/
COPY services/evaluator/package.json services/evaluator/
COPY services/worker-kit/package.json services/worker-kit/
COPY apps/agents/package.json apps/agents/
COPY apps/dashboard/package.json apps/dashboard/
RUN pnpm install --frozen-lockfile

COPY . .
# Compile once at build time (downloads solc 0.8.28), so containers start offline.
RUN forge build --sizes >/dev/null

ENV NETWORK=local NODE_ENV=production
CMD ["pnpm", "-s", "-F", "agents", "start", "all"]
