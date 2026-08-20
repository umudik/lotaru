FROM node:26-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:26-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV LOTARU_MCP_HTTP=1
ENV LOTARU_MCP_HOST=0.0.0.0
ENV LOTARU_MCP_PORT=18766
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EXPOSE 18766
CMD ["node", "dist/index.js", "--http"]
