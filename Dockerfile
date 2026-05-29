# ── Stage 1: Build React client ───────────────────────────────────────────────
FROM node:20-alpine AS client-builder
WORKDIR /app

# Copy workspace manifests first for better layer caching
COPY package.json package-lock.json* ./
COPY client/package.json ./client/
COPY server/package.json ./server/

RUN npm ci --workspace=client

COPY client/ ./client/

ARG VITE_API_URL=http://localhost:3001
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build --workspace=client

# ── Stage 2: Production server ────────────────────────────────────────────────
FROM node:20-alpine AS production
WORKDIR /app

# Security: run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S skillforge -u 1001

# Copy workspace manifests
COPY package.json package-lock.json* ./
COPY server/package.json ./server/

# Install production deps only
RUN npm ci --workspace=server --omit=dev && npm cache clean --force

# Copy server source
COPY server/ ./server/

# Copy built client into server's static directory
COPY --from=client-builder /app/client/dist ./client/dist

# Copy knowledge bank
COPY server/knowledge/ ./server/knowledge/

ENV NODE_ENV=production
ENV PORT=3001

# Create data directory for file-based fallback
RUN mkdir -p /app/server/data && chown -R skillforge:nodejs /app

USER skillforge

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -q --spider http://localhost:3001/api/health || exit 1

CMD ["node", "server/index.js"]
