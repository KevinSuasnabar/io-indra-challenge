FROM node:20-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY card-issuer/package.json card-issuer/package.json

RUN npm ci --workspace=card-issuer --include-workspace-root

COPY card-issuer card-issuer
RUN npm run build --workspace=card-issuer \
  && npm prune --omit=dev --workspace=card-issuer

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/card-issuer/package.json ./card-issuer/package.json
COPY --from=build --chown=app:app /app/card-issuer/dist ./card-issuer/dist

RUN mkdir -p /app/card-issuer/data && chown app:app /app/card-issuer/data

USER app
WORKDIR /app/card-issuer
CMD ["node", "dist/index.js"]