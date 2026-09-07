FROM node:20-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY card-processor/package.json card-processor/package.json

RUN npm ci --workspace=card-processor --include-workspace-root

COPY card-processor card-processor
RUN npm run build --workspace=card-processor \
  && npm prune --omit=dev --workspace=card-processor

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/card-processor/package.json ./card-processor/package.json
COPY --from=build --chown=app:app /app/card-processor/dist ./card-processor/dist

RUN mkdir -p /app/card-processor/data && chown app:app /app/card-processor/data

USER app
WORKDIR /app/card-processor
CMD ["node", "dist/index.js"]