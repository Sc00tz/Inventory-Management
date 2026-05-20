FROM node:24-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
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
