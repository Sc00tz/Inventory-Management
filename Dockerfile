FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
# npm install (not ci) resolves platform-specific optional deps at build time.
# Vite 8's rolldown toolchain pulls a wasm/@emnapi subtree that a lockfile
# generated off-Linux never fully resolves, which breaks `npm ci` on Alpine.
RUN npm install

COPY . .
RUN npm run build

# ── Production image ───────────────────────────────────────────────────────────
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./
COPY --from=builder /app/dist ./dist

EXPOSE 4000
CMD ["node", "server.js"]
