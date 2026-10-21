# Entorno local — procedimiento verificado

El procedimiento se verificó inicialmente el 24 de agosto de 2026 sobre Fedora 44,
Node.js 24.15.0, pnpm 11.23.0, Docker 29.7.2 y PostgreSQL 18.4. Los comandos y
el flujo se contrastaron con el repositorio actual el 21 de octubre de 2026.

## Requisitos

| Herramienta      | Versión usada  | Nota                                            |
| ---------------- | -------------- | ----------------------------------------------- |
| Node.js          | 24.15.0        | El README pide 22 LTS; 24 funciona sin cambios. |
| pnpm             | 11.23.0        | Vía `corepack enable`.                          |
| Docker + Compose | 29.7.2 / 5.4.0 | Para PostgreSQL.                                |
| Chrome/Chromium  | cualquiera     | Solo para las pruebas Karma del frontend.       |

## Arranque

```bash
corepack enable
cp .env.example .env          # complete POSTGRES_PASSWORD, DATABASE_URL y los secretos JWT
pnpm install

docker compose up -d postgres

pnpm db:generate
cd backend && node --env-file=../.env ./node_modules/prisma/build/index.js migrate deploy && cd -
pnpm --filter @sg-sst/api run seed

pnpm dev:api    # http://localhost:3000/api
pnpm dev:web    # http://localhost:4200
```

`DATABASE_URL` debe apuntar al Postgres del compose (`localhost:5432`), no a una base
gestionada remota: `migrate` y `seed` escriben en la base a la que apunte esa variable.

## Migraciones locales

`pnpm db:migrate` ejecuta `migrate dev` y se usa al desarrollar una migración. Para levantar
un entorno desde las migraciones versionadas, use `migrate deploy`, como en el bloque anterior.
Edite `.env` antes de crear el volumen de PostgreSQL: el contenedor fija su contraseña durante
la primera inicialización. Cambiar `POSTGRES_PASSWORD` después no modifica el volumen existente.

## Pruebas del frontend

`ng test` usa Karma y necesita un navegador. En Linux hay que indicarle cuál:

```bash
cd frontend
CHROME_BIN=$(command -v google-chrome || command -v chromium) \
  ./node_modules/.bin/ng test --watch=false --browsers=ChromeHeadless
```

El script `pnpm --filter @sg-sst/web run test` no acepta argumentos adicionales
(`ng test` rechaza el `--` que inserta pnpm), por lo que conviene invocar el binario directo.

## Estado de la cadena de validación

| Comando                              | Resultado               |
| ------------------------------------ | ----------------------- |
| `pnpm lint`                          | pasa                    |
| `pnpm format:check`                  | pasa                    |
| `pnpm --filter @sg-sst/api run test` | pasa                    |
| `ng test` (web)                      | pasa con ChromeHeadless |
| `pnpm build`                         | API y web compilan      |
| `docker compose config`              | válido                  |

## Flujo verificado de punta a punta

1. Login administrativo → token con 900 s de vigencia.
2. Creación de colaborador con PIN Argon2id.
3. Alta de afiliación ARL → estado `VIGENTE` calculado desde fechas.
4. Login de colaborador con documento + PIN.
5. Consulta de flujo → `canContinue: true`.
6. Envío del formulario HSE-FO-016 con firma PNG → `PENDING_APPROVAL`.
7. Aprobación desde Coordinación → permiso disponible para registrar inicio.
8. Cierre por un integrante de la cuadrilla → PDF completado con `pdf-lib` sobre la plantilla oficial y anexo de cierre.
9. Descarga auditada del PDF. Un rechazo genera su PDF al registrar la decisión.
10. Bloqueo confirmado: un colaborador con ARL vencida recibe 403 al intentar enviar.
11. Inmutabilidad confirmada: un envío ya decidido devuelve 409.

## Servicios y credenciales de desarrollo

| Servicio    | URL                              |
| ----------- | -------------------------------- |
| API         | http://localhost:3000/api        |
| Healthcheck | http://localhost:3000/api/health |
| Swagger     | http://localhost:3000/api/docs   |
| PWA         | http://localhost:4200            |
| PostgreSQL  | localhost:5432                   |

El administrador inicial sale de `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD`.
