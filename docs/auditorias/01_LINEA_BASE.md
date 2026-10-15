# SG-SST — Línea Base de Calidad y Entorno (Fase 0)

## 1. Información General de Ejecución

- **Fecha de ejecución:** 15 de octubre de 2026.
- **Rama de análisis y trabajo:** `chore/sgsst-phase0-baseline-ci` (originada desde `main`).
- **Commit analizado (HEAD):** `27f604a751d30843da2f94b564c0ed70321e5d45`
- **Mensaje del commit de referencia:** `"(feat): modificaciones en Dockerfile y Docker-compose"`
- **Comparación con referencia de auditoría:** El commit actual de `main` coincide de forma exacta con el commit de referencia auditado (`27f604a751d30843da2f94b564c0ed70321e5d45`). No existen commits posteriores en la rama remota `origin/main`.
- **Estado del árbol de trabajo al inicio:** Limpio (`working tree clean`), sin cambios sin confirmar.

---

## 2. Herramientas y Versiones Verificadas

| Herramienta / Tecnología | Versión detectada | Estado / Requisito | Observaciones |
|---|---|---|---|
| **Node.js** | `v22.23.2` | Compatible (Engines: `>=22.0.0`) | Entorno Windows host |
| **pnpm** | `11.23.0` | Compatible (Package manager lockfile) | Ejecución mediante `pnpm.cmd` por política de scripts de PowerShell |
| **npm** | `10.9.8` | Compatible (Engines: `>=10.0.0`) | Gestor auxiliar disponible |
| **Docker Engine** | `29.7.2 (build a7dcaa6)` | Operativo | Daemon local disponible |
| **Docker Compose** | `v5.4.0` | Operativo | Sintaxis validada con `docker compose config` |
| **NestJS (Backend)** | `11.0.1` | Operativo | Compilación y tests unitarios verificados |
| **Angular (Frontend)** | `20.2.0` | Operativo | Compilación PWA y tests unitarios verificados |
| **Prisma ORM** | `6.16.2` (Runtime) / `6.19.3` (CLI) | Operativo | Schema válido; 17 migraciones inspeccionadas |
| **PostgreSQL (Imagen)** | `postgres:18-alpine` | Especificado en Compose | Base de datos relacional principal |
| **Redis (Imagen)** | `redis:8-alpine` | Especificado en Compose | Rate limiting y cache |
| **Nginx (Imagen)** | `nginx:1.29-alpine` | Especificado en Dockerfile frontend | Proxy inverso y servidor estático SPA/PWA |

---

## 3. Revisión de Arquitectura y Configuración

### 3.1 Estructura del Monorepo
El proyecto está configurado como un monorepo gestionado por `pnpm workspaces`:
- `backend`: Paquete `@sg-sst/api` (NestJS 11 + Prisma 6 + Express 5).
- `frontend`: Paquete `@sg-sst/web` (Angular 20 Standalone Components + Angular Material + PWA Service Worker).
- `infra/nginx`: Configuración de proxy inverso Nginx (`web.conf`) con compresión gzip, cabeceras de seguridad y proxy pass hacia `/api/`.
- `storage`: Directorio para almacenamiento de archivos en modo local (`private-permits`).
- `backend/storage`: Directorio auxiliar de evidencias en backend (`signatures`, `pdf`, `arl`, etc.).
- `backend/pdf-templates`: Plantillas inmutables oficiales para formularios (versión `HSE-FO-016/v00` con `template.pdf` y `mapping.json`).

### 3.2 Backend
- **Entrypoint:** `backend/src/main.ts` con prefijo global `/api`, `helmet`, `cookie-parser`, `ValidationPipe` estricto y filtro global de excepciones (`HttpExceptionFilter`).
- **Módulos:** Separación por dominios de negocio: `approvals`, `arl`, `audit`, `auth`, `collaborators`, `common`, `compliance`, `files`, `forms`, `health`, `legal`, `pdf`, `prisma`, `submissions`, `users`.
- **Autenticación:** Híbrida:
  - Usuarios administrativos (`User`): email/contraseña hasheada con Argon2id, tokens JWT de acceso (15 min) y refresh tokens rotativos en cookie HttpOnly (7 días).
  - Colaboradores de campo (`Collaborator`): cédula y PIN de seguridad (oficial eléctrico) o verificación ARL/cédula, sesión de 12 horas.
- **Rate Limiting:** Implementado globalmente con `@nestjs/throttler` (ThrottlerGuard) y límites específicos en `/auth/admin/login`, `/auth/collaborator/login`, `/auth/refresh`.

### 3.3 Frontend
- **Arquitectura:** Angular 20 basado en componentes independientes (Standalone) con `provideRouter`, PWA activada (`@angular/service-worker`), estilos globales centralizados en `styles.css`.
- **Módulos funcionales (`features`):** `admin`, `arl`, `auth`, `compliance`, `coordination`, `forms` (formulario de alturas HSE-FO-016), `home`, `legal`.
- **PWA:** Manifest `manifest.webmanifest`, configuración de cache `ngsw-config.json`.

### 3.4 Persistencia y Base de Datos (Prisma)
- **Motor:** PostgreSQL (`schema.prisma` con proveedor `postgresql`).
- **Modelos clave:** `User`, `Role`, `Permission`, `Collaborator`, `ArlAffiliation`, `SocialSecurityPayroll`, `HeightCertificate`, `FormDefinition`, `FormSubmission`, `SubmissionCrewMember`, `Approval`, `FileObject`, `AuditEvent`, `SystemSetting`.
- **Migraciones:** 17 carpetas de migración consecutivas en `backend/prisma/migrations`, con `migration_lock.toml` fijado a PostgreSQL.

### 3.5 Infraestructura y Docker
- `docker-compose.yml`: Define 4 servicios (`postgres`, `redis`, `api`, `web`), redes y volúmenes (`postgres_data`, `redis_data`, `api_storage`).
- `docker-compose.prod.yml`: Extensión de entorno productivo (`NODE_ENV=production`, `AUDIT_ENABLED=true`).
- `backend/Dockerfile`: Multi-stage build (`node:22-alpine`).
- `frontend/Dockerfile`: Multi-stage build (`node:22-alpine` -> `nginx:1.29-alpine`).

---

## 4. Comandos Oficiales Ejecutados y Resultados

| Componente | Comando oficial ejecutado | Resultado | Estado | Detalle |
|---|---|---|---|---|
| **Prisma** | `pnpm --filter @sg-sst/api exec prisma validate` | Éxito (con env mock) | APROBADO | El esquema es 100% válido sintáctica y relacionalmente. Requiere `DATABASE_URL` para ejecutar la validación. |
| **Prisma** | `pnpm --filter @sg-sst/api run prisma:generate` | Éxito | APROBADO | Cliente Prisma generado en 409 ms. |
| **Backend** | `pnpm --filter @sg-sst/api run build` | Éxito (`nest build`) | APROBADO | Compilación TypeScript limpia sin errores de tipos. |
| **Backend** | `pnpm --filter @sg-sst/api run test` | Éxito (`jest --runInBand`) | APROBADO | 9 suites pasadas, 80 pruebas unitarias aprobadas (33.5 s). |
| **Backend** | `pnpm --filter @sg-sst/api run lint` | Fallo (245 errores) | FALLIDO | Errores de ESLint/Prettier por retornos de carro CRLF (`\r\n`) y saltos de línea pendientes de normalización. |
| **Frontend** | `pnpm --filter @sg-sst/web run build` | Éxito (`ng build`) | APROBADO | Generación de bundles JS/CSS completa (490 kB initial total). |
| **Frontend** | `pnpm --filter @sg-sst/web run lint` | Éxito (`eslint "src/**/*.ts"`) | APROBADO | 0 errores, 0 advertencias en código TypeScript frontend. |
| **Frontend** | `pnpm --filter @sg-sst/web run test` | Éxito (`ng test --watch=false`) | APROBADO | 1 suite, 1 prueba aprobada en Chrome local (`AppComponent`). |
| **Global** | `pnpm run format:check` | Fallo (24 archivos) | FALLIDO | 24 archivos presentan diferencias con el estándar de Prettier. |
| **Docker** | `docker compose config` | Éxito | APROBADO | Especificación Compose válida para producción y desarrollo. |

---

## 5. Resumen de Pruebas

- **Pruebas ejecutadas y aprobadas:**
  - 80 pruebas unitarias de backend:
    - `src/pdf/pdf.service.spec.ts` (pruebas de renderizado de campos, firmas, tablas y validación de plantillas).
    - `src/auth/permissions.guard.spec.ts` (evaluación de permisos basados en roles).
    - `src/auth/throttler.spec.ts` (rate limiting y throttling en endpoints).
    - `src/submissions/submissions.service.spec.ts` (creación, validación, charla de seguridad y flujo de permisos).
    - `src/legal/legal.service.spec.ts` (trazabilidad legal y membresía histórica de cuadrillas).
    - `src/files/files.service.spec.ts` (control de acceso y descarga segura de archivos).
    - `src/health/health.service.spec.ts` (chequeo de estado de servicios).
    - `src/common/business-date.spec.ts` (cálculo de fechas y jornadas laborales en zona horaria de negocio).
    - `src/arl/arl-status.spec.ts` (cálculo de vigencias de cobertura ARL).
  - 1 prueba unitaria de frontend (`src/app/app.component.spec.ts`).

- **Pruebas no ejecutadas / Impedimentos:**
  - **Pruebas de integración contra base de datos viva:** No se ejecutaron migraciones dev (`prisma migrate dev`) ni resets de base de datos para no violar las reglas 4 y 6 (integridad de datos existentes en ambientes locales).
  - **Pruebas E2E:** No existen herramientas de pruebas end-to-end (Cypress, Playwright o Selenium) instaladas ni configuradas en el repositorio.
  - **Pruebas de frontend en CI Linux sin Chrome:** El script actual de Angular (`ng test`) intenta abrir Chrome con interfaz gráfica por defecto. Se parametriza en el flujo de CI como headless (`--browsers=ChromeHeadless`).

---

## 6. Errores y Hallazgos Críticos Identificados

1. **TEC-001 — Omisión de plantillas PDF en contenedor Docker (`backend/Dockerfile`):**
   El archivo `backend/Dockerfile` en su etapa final de ejecución (`FROM node:22-alpine`) copia `dist`, `prisma` y `package.json`, pero **no copia `backend/pdf-templates`**. Dado que `TemplateRegistry` busca las plantillas en `resolve(process.cwd(), 'pdf-templates')`, cualquier intento de generar un PDF en contenedor Docker fallará con `NotFoundException`.
2. **TEC-002 — Inconsistencia de finales de línea (CRLF) y fallos de ESLint en Backend:**
   El comando `pnpm --filter @sg-sst/api run lint` falla con 245 violaciones de la regla `prettier/prettier` debido a que varios archivos fueron guardados con terminaciones CRLF (`\r\n`) en Windows, mientras que la regla exige LF. No se realizaron cambios masivos de formateo para respetar la regla obligatoria de no alterar archivos fuera del alcance.
3. **TEC-003 — Desalineación de formato global (`format:check`):**
   El chequeo global de Prettier reporta 24 archivos desalineados. Requiere una normalización controlada en la fase correspondiente mediante `.gitattributes` y `prettier --write`.
4. **TEC-004 — Dependencia de `DATABASE_URL` en validación de Prisma:**
   `prisma validate` falla con el error `P1012: Environment variable not found: DATABASE_URL` si la variable no está expuesta en el entorno, impidiendo validaciones en pipelines aislados sin archivo `.env`. El CI debe proveer una cadena dummy para su validación sintáctica.
5. **TEC-005 — Ambigüedad en la ruta raíz de almacenamiento local (`LocalStorageAdapter`):**
   `LocalStorageAdapter` utiliza `resolve(process.cwd(), 'storage')`. Si el backend es arrancado desde la raíz del monorepo (`.`), los archivos se guardan en `./storage`; si es arrancado desde `./backend`, se guardan en `./backend/storage`. De hecho, ambas carpetas existen en el proyecto conteniendo archivos.
6. **TEC-006 — Dependencias residuales de Puppeteer/Chromium en imagen Docker:**
   A pesar de que el motor de PDF fue migrado a `pdf-lib` (puro JavaScript) y Puppeteer ya no figura en las dependencias de producción del backend, `backend/Dockerfile` aún instala paquetes pesados del sistema operativo (`chromium`, `nss`, `freetype`, `harfbuzz`) y variables como `PUPPETEER_EXECUTABLE_PATH`, engrosando la imagen innecesariamente en ~300 MB.
7. **TEC-007 — Ausencia de pruebas de integración y E2E:**
   No existe directorio `backend/test` ni cobertura de integración real con base de datos, ni pruebas de interacción visual en frontend.
