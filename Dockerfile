# syntax=docker/dockerfile:1.6

# Stage 1 — deps
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
# Workspace files: pnpm-lock.yaml is shared, pnpm-workspace.yaml lists `worker/`,
# and worker/package.json must exist for the workspace resolver. We `--filter app`
# so only the Next.js app's deps are installed (worker stays out of this image).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY worker/package.json ./worker/
# devDep `eslint-plugin-local: link:eslint-rules` requires the symlink target to exist before install
COPY eslint-rules ./eslint-rules
RUN corepack enable && corepack prepare pnpm@9 --activate \
 && pnpm install --frozen-lockfile --filter app...

# Stage 2 — build
FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Placeholder env values consumed only by `next build` page-data collection.
# Real values are injected at runtime by docker-compose / Coolify and are NOT
# baked into the final runtime image (the `runner` stage has its own ENV).
# Validators in src/lib/env.ts require min 16/32 chars; placeholders below
# satisfy the schema without leaking anything sensitive.
ENV APP_URL=http://localhost:3000 \
    DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder \
    REDIS_URL=redis://localhost:6379 \
    MEILI_HOST=http://localhost:7700 \
    MEILI_MASTER_KEY=buildplaceholder1234567890abcdef \
    SESSION_SECRET=00000000000000000000000000000000000000000000000000000000000000000 \
    CRYPTO_MASTER_KEY=11111111111111111111111111111111111111111111111111111111111111111 \
    IP_HASH_SALT=buildplaceholder1234 \
    UA_HASH_SALT=buildplaceholder1234 \
    EMAIL_LOG_SALT=buildplaceholderbuildplaceholder12 \
    EMAIL_FROM=noreply@build.local \
    EMAIL_TRANSPORT=smtp \
    SMTP_HOST=localhost
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9 --activate \
 && pnpm prisma generate \
 && pnpm build

# Stage 3 — runtime
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs \
 && apk add --no-cache curl \
 # npm CLI ships picomatch@4.0.3 (CVE-2026-33671 ReDoS) and is never invoked
 # at runtime (we use `node server.js`). Removing it eliminates the CVE and
 # ~30 MB of unused surface area.
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
# Prisma client + engine are already traced into .next/standalone/node_modules
# by Next.js standalone output (pnpm symlinks resolved at trace time), so no
# explicit COPY of node_modules/.prisma or node_modules/@prisma/client needed.

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3000/api/health || exit 1

CMD ["node", "server.js"]
