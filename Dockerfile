# syntax=docker/dockerfile:1

# ---- build: front (vite) + server bundle (esbuild) ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:server

# ---- runtime: node only, no node_modules (the server bundle includes zod) ----
FROM node:20-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
# server reads public/city.json and public/assets/index.json; data/ holds the LLM and 3D model caches
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/dist-server ./dist-server
COPY --from=build --chown=node:node /app/public/city.json ./public/city.json
COPY --from=build --chown=node:node /app/public/assets/index.json ./public/assets/index.json
RUN mkdir -p data && chown node:node data
USER node
VOLUME ["/app/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist-server/main.mjs"]
