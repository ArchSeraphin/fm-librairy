# syntax=docker/dockerfile:1.6

# Stage 1 — deps
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# devDep `eslint-plugin-local: link:eslint-rules` requires the symlink target to exist before install
COPY eslint-rules ./eslint-rules
RUN corepack enable && corepack prepare pnpm@9 --activate \
 && pnpm install --frozen-lockfile

# Stage 2 — build
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN corepack enable && corepack prepare pnpm@9 --activate \
 && pnpm prisma generate \
 && pnpm build

# Stage 3 — runtime
FROM node:22-alpine AS runner
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
