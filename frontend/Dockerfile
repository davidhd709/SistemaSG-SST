FROM node:22-alpine AS build
WORKDIR /workspace
COPY package.json ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN corepack enable && pnpm install --frozen-lockfile
COPY frontend frontend
ARG WEB_API_BASE_URL=/api
ENV WEB_API_BASE_URL=$WEB_API_BASE_URL
RUN pnpm --filter @sg-sst/web run build

FROM nginx:1.29-alpine
COPY infra/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/frontend/dist/web/browser /usr/share/nginx/html
EXPOSE 80
