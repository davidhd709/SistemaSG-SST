FROM node:22-alpine AS build
WORKDIR /workspace
COPY package.json ./
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN corepack enable && pnpm install --frozen-lockfile
COPY backend backend
RUN pnpm --filter @sg-sst/api run prisma:generate && pnpm --filter @sg-sst/api run build

FROM node:22-alpine
WORKDIR /app/backend
ENV NODE_ENV=production
# pnpm resuelve cada paquete mediante enlaces relativos desde backend/node_modules
# hacia el almacén .pnpm de la raíz, así que ambos árboles deben conservar su
# posición original dentro de la imagen.
COPY --from=build /workspace/node_modules /app/node_modules
COPY --from=build /workspace/backend/node_modules /app/backend/node_modules
COPY --from=build /workspace/backend/dist ./dist
COPY --from=build /workspace/backend/prisma ./prisma
COPY --from=build /workspace/backend/package.json ./package.json
EXPOSE 3000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main"]
