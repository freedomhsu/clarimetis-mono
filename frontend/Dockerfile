# ── Development stage ─────────────────────────────────────────────────────────
# Use Debian-based image (glibc) so @next/swc native bindings load on linux/arm64
FROM node:22 AS dev

WORKDIR /app

# Install production dependencies only — Playwright and other dev tools
# are not needed inside the Docker container.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit || npm install --omit=dev --no-audit || npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["npm", "run", "dev"]

# ── Production build stage ────────────────────────────────────────────────────
FROM node:22 AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --no-audit || npm install --no-audit || npm install

# NEXT_PUBLIC_* vars are baked into the bundle at build time.
# Pass them via --build-arg in CI/CD (or docker build locally).
# Note: NEXT_PUBLIC_API_URL is intentionally omitted — the browser now routes all
# API calls through the Next.js proxy (/api/proxy) instead of the backend directly.
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
ARG NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
ARG NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
ARG NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

ENV NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_CLERK_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_SIGN_IN_URL
ENV NEXT_PUBLIC_CLERK_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_SIGN_UP_URL
ENV NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=$NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL
ENV NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=$NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL
ENV NODE_ENV=production

RUN npm run build

# ── Production runtime stage ──────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser  --system --uid 1001 nextjs

COPY --from=builder /app/public                    ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static     ./.next/static

# BACKEND_URL is injected at runtime by Cloud Run (not baked into image).
# Provide a safe default for local standalone runs.
ENV BACKEND_URL=http://localhost:8000

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
