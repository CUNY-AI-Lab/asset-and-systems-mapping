# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY package.railway.json ./package.json
COPY pnpm-lock.railway.yaml ./pnpm-lock.yaml
COPY pnpm-workspace.railway.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
COPY shared ./shared
COPY server ./server
RUN VITE_ACCOUNT_WORKSPACE=false pnpm build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.16.0 --activate
COPY package.railway.json ./package.json
COPY pnpm-lock.railway.yaml ./pnpm-lock.yaml
COPY pnpm-workspace.railway.yaml ./pnpm-workspace.yaml
RUN pnpm install --prod --frozen-lockfile
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/src/domain.js ./src/domain.js
USER node
EXPOSE 4177
CMD ["pnpm", "start"]
