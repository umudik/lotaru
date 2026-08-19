FROM node:26-bookworm-slim AS task-module
WORKDIR /repo/apps/task-bridge/apps/backend
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY apps/task-bridge/apps/backend/package.json apps/task-bridge/apps/backend/package-lock.json ./
RUN npm ci
COPY apps/task-bridge/apps/backend ./
RUN npm run build

FROM node:26-bookworm-slim AS build
WORKDIR /repo/apps/cloud-platform
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY apps/cloud-platform/package.json apps/cloud-platform/package-lock.json ./
COPY apps/cloud-platform/packages ./packages
RUN npm ci
COPY --from=task-module /repo/apps/task-bridge/apps/backend/dist /repo/apps/task-bridge/apps/backend/dist
RUN npm run build:web
RUN npx tsc -p packages/server/tsconfig.json

FROM node:26-bookworm-slim
WORKDIR /app/apps/cloud-platform
ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data
ENV PUBLIC_URL=http://localhost:11222
ENV DATABASE_PATH=/data/tasks/bridge.db
ENV SCRIPT_DATA_DIR=/data/script
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo/apps/cloud-platform/package.json ./
COPY --from=build /repo/apps/cloud-platform/node_modules /app/node_modules
COPY --from=build /repo/apps/cloud-platform/packages/server/dist ./packages/server/dist
COPY --from=build /repo/apps/cloud-platform/packages/web/dist ./packages/web/dist
COPY --from=task-module /repo/apps/task-bridge/apps/backend/dist /app/apps/task-bridge/apps/backend/dist
RUN mkdir -p /data/tasks /data/script
VOLUME ["/data"]
EXPOSE 8080
CMD ["npm", "run", "start"]
