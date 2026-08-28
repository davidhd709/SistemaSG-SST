# Sistema SG-SST

PWA para verificar ARL, confirmar charla de seguridad, diligenciar formularios versionados, capturar firma y someter el proceso a aprobación con trazabilidad.

## Estado

La **Fase 0** está creada: monorepo npm, API NestJS, PWA Angular standalone, Prisma/PostgreSQL, Redis, Docker Compose, endpoint de salud y documentación base. Las fases de autenticación, RBAC y negocio aún no se implementan.

## Requisitos

- Node.js 22 LTS o superior y pnpm 11 (gestionado con Corepack).
- Docker Desktop con Docker Compose para ejecutar servicios locales.

## Arranque local

1. Copie `.env.example` a `.env` y cambie `POSTGRES_PASSWORD`.
2. Active pnpm e instale dependencias: `corepack enable` y `pnpm install`.
3. Inicie infraestructura: `docker compose up -d postgres redis`.
4. Genere Prisma y aplique migraciones: `pnpm db:generate` y `pnpm db:migrate`.
5. Cree los roles, permisos y administrador inicial: `pnpm --filter @sg-sst/api run seed`.
6. En terminales separadas ejecute `pnpm dev:api` y `pnpm dev:web`.

La API queda en `http://localhost:3000/api`, su healthcheck en `http://localhost:3000/api/health`, y la PWA en `http://localhost:4200`.

Para ejecutar todo en contenedores: `docker compose up --build`. La web se publica en `http://localhost:8080` y enruta `/api` hacia la API.

Después de iniciar los contenedores por primera vez, cree los roles, permisos y administrador inicial con `docker compose exec api ./node_modules/.bin/ts-node prisma/seed.ts`. Es un paso intencional: no hay credenciales administrativas predeterminadas.

## Archivos y PDF

En desarrollo, firmas y PDFs se almacenan en `storage/`, directorio que no se versiona. Si se definen `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`, la misma interfaz `StorageService` usa Cloudflare R2. El bucket debe ser privado. Las descargas pasan por la API y se auditan.

Al aprobar o rechazar un envío, el entorno de desarrollo genera el PDF de forma síncrona. La interfaz queda aislada para sustituir esa llamada por un trabajo BullMQ antes de producción.

## Validación

```text
pnpm lint
pnpm format:check
pnpm test
pnpm build
docker compose config
```

## Estructura

```text
backend        API NestJS + Prisma
frontend       PWA Angular standalone
infra/nginx    configuración de proxy de producción
docs           plan, decisiones y especificación
```

Las decisiones y fases están en [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) y [docs/DECISIONS.md](docs/DECISIONS.md).

La guía de despliegue, TLS, backups y restauración está en [docs/DEPLOYMENT_AND_BACKUPS.md](docs/DEPLOYMENT_AND_BACKUPS.md).
