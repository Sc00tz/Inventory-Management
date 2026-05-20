FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
# npm ci installs exact versions from the lockfile for reproducible builds
RUN npm ci

COPY . .
RUN npm run build

# ── Production image ───────────────────────────────────────────────────────────
FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY --from=builder /app/dist ./dist

EXPOSE 4000
CMD ["node", "server.js"]
