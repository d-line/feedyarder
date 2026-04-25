# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN npm ci

FROM deps AS build-all
WORKDIR /app
COPY . .
RUN npm run build

FROM node:24-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build-all /app/package.json /app/package-lock.json /app/
COPY --from=build-all /app/node_modules /app/node_modules
COPY --from=build-all /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build-all /app/apps/api/dist /app/apps/api/dist
COPY --from=build-all /app/packages/db/package.json /app/packages/db/package.json
COPY --from=build-all /app/packages/db/dist /app/packages/db/dist
COPY --from=build-all /app/packages/db/migrations /app/packages/db/migrations
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]

FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build-all /app/package.json /app/package-lock.json /app/
COPY --from=build-all /app/node_modules /app/node_modules
COPY --from=build-all /app/apps/worker/package.json /app/apps/worker/package.json
COPY --from=build-all /app/apps/worker/dist /app/apps/worker/dist
CMD ["node", "apps/worker/dist/index.js"]

FROM deps AS build-web
WORKDIR /app
ARG VITE_API_BASE_URL=http://localhost:3001
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY . .
RUN npm run build -w @feedyarder/web

FROM nginx:1.27-alpine AS web
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-web /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
