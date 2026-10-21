# SG-SST — Línea Base de Calidad y Entorno (Fase 0 / F0.1)

> **Documento histórico.** Describe el estado observado el 15 y 16 de octubre de 2026. No representa el estado actual; consulte [`02_REGISTRO_HALLAZGOS.md`](./02_REGISTRO_HALLAZGOS.md) y [`04_PLAN_ACCION.md`](./04_PLAN_ACCION.md) para el seguimiento vigente.

## 1. Información General de Ejecución y Estado del Repositorio

- **Fecha de ejecución original (Fase 0):** 15 de octubre de 2026.
- **Fecha de actualización y alineación (Fase F0.1):** 16 de octubre de 2026.
- **Rama de trabajo actual:** `docs/sgsst-f0-1-audit-alignment`.
- **Estado de la rama `main`:**
  - **Commit HEAD actual de `main`:** `b8fdbb0f13aa5e4ecfb29faf503427c2212c1ef5` (`Merge pull request #1 from davidhd709/chore/sgsst-phase0-baseline-ci`, que integró el commit documental `78bbf3a`).
  - **Último commit de código funcional auditado:** `27f604a751d30843da2f94b564c0ed70321e5d45` (`"(feat): modificaciones en Dockerfile y Docker-compose"`). No se han producido cambios en el código funcional de `backend/`, `frontend/` ni `infra/` entre `27f604a` y `b8fdbb0`.
- **Estado del Pull Request #1:** Fusionado en `main`.
- **Protección de la rama `main`:** **No activada.** Se constató que el repositorio en GitHub carece de reglas de protección de rama (`branch protection rules`) activas sobre `main`, lo que permitió fusionar el PR #1 a pesar de que el workflow de GitHub Actions se encontraba en estado fallido.

---

## 2. Herramientas y Versiones Verificadas

| Herramienta / Tecnología | Versión detectada                              | Estado / Requisito                                    | Método de verificación                      |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------------- | ------------------------------------------- |
| **Node.js**              | `v22.23.2`                                     | Compatible (`engines: >=22.0.0`)                      | Ejecución (`node -v`)                       |
| **pnpm**                 | `11.23.0`                                      | Compatible (`packageManager: pnpm@11.23.0`)           | Ejecución (`pnpm.cmd -v`)                   |
| **npm**                  | `10.9.8`                                       | Compatible (`engines: >=10.0.0`)                      | Ejecución (`npm.cmd -v`)                    |
| **Docker Engine**        | `29.7.2 (build a7dcaa6)`                       | Operativo                                             | Ejecución (`docker --version`)              |
| **Docker Compose**       | `v5.4.0`                                       | Operativo                                             | Ejecución (`docker compose version`)        |
| **NestJS (Backend)**     | `11.0.1`                                       | Operativo                                             | Compilación y pruebas ejecutadas            |
| **Angular (Frontend)**   | `20.2.0`                                       | Operativo                                             | Compilación y pruebas ejecutadas            |
| **Prisma ORM**           | `6.16.2` ( paquete ) / `6.19.3` (CLI resuelto) | Operativo                                             | Ejecución (`prisma validate` / `generate`)  |
| **PostgreSQL (Imagen)**  | `postgres:18-alpine`                           | Declarado en `docker-compose.yml`                     | Revisión estática de configuración          |
| **Redis (Imagen)**       | `redis:8-alpine`                               | Declarado en `docker-compose.yml` (sin uso en código) | Revisión estática de configuración y código |
| **Nginx (Imagen)**       | `nginx:1.29-alpine`                            | Declarado en `frontend/Dockerfile`                    | Revisión estática de configuración          |

---

## 3. Revisión de Arquitectura y Configuración (Revisión Estática)

### 3.1 Estructura del Monorepo

El proyecto está estructurado como un monorepo gestionado por `pnpm workspaces`:

- `backend/`: Paquete `@sg-sst/api` (NestJS 11, Prisma ORM, Express 5, `pdf-lib`).
- `frontend/`: Paquete `@sg-sst/web` (Angular 20 Standalone Components, Angular Material, PWA Service Worker).
- `infra/nginx/`: Configuración de Nginx (`web.conf`) como servidor estático SPA/PWA y proxy inverso hacia `/api/`.
- `storage/` y `backend/storage/`: Directorios locales generados por `LocalStorageAdapter` dependiendo del directorio de trabajo (`process.cwd()`) desde el cual se inicie el backend.
- `backend/pdf-templates/`: Plantilla oficial inmutable `HSE-FO-016/v00` (`template.pdf` y `mapping.json`).

### 3.2 Backend y Estado Real de Servicios

- **Entrypoint:** `backend/src/main.ts` configura prefijo global `/api`, `helmet`, `cookie-parser`, `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`), `HttpExceptionFilter` y Swagger (`/api/docs`).
- **Módulos:** `approvals`, `arl`, `audit`, `auth`, `collaborators`, `common`, `compliance`, `files`, `forms`, `health`, `legal`, `pdf`, `prisma`, `submissions`, `users`.
- **Estado real de Redis:** Aunque `docker-compose.yml` despliega el servicio `redis:8-alpine`, exige que esté saludable (`service_healthy`) para iniciar `api` e inyecta la variable `REDIS_URL=redis://redis:6379`, **el backend no utiliza Redis en ningún módulo**. No existe cliente Redis (`ioredis` / `redis`) en `backend/package.json` y `@nestjs/throttler` opera exclusivamente en la memoria local del proceso Node.js (hallazgo **AUD-021**).

### 3.3 Modelos de Base de Datos en Prisma (`backend/prisma/schema.prisma`)

El esquema cuenta con **22 modelos exactos** y 5 enumeraciones (`UserStatus`, `CollaboratorStatus`, `FormStatus`, `SubmissionStatus`, `ApprovalDecision`):

1. `SystemSetting` (`@@map("system_settings")`)
2. `User` (`@@map("users")`)
3. `Role` (`@@map("roles")`)
4. `Permission` (`@@map("permissions")`)
5. `UserRole` (`@@map("user_roles")`)
6. `RolePermission` (`@@map("role_permissions")`)
7. `RefreshSession` (`@@map("refresh_sessions")`)
8. `Collaborator` (`@@map("collaborators")`)
9. `ArlAffiliation` (`@@map("arl_affiliations")`)
10. `FileObject` (`@@map("file_objects")`)
11. `ArlDocument` (`@@map("arl_documents")`)
12. `Form` (`@@map("forms")`)
13. `FormVersion` (`@@map("form_versions")`)
14. `FormSubmission` (`@@map("form_submissions")`)
15. `SubmissionMember` (`@@map("submission_members")`)
16. `Approval` (`@@map("approvals")`)
17. `Signature` (`@@map("signatures")`)
18. `JobPosition` (`@@map("job_positions")`)
19. `SocialSecurityPayroll` (`@@map("social_security_payrolls")`)
20. `PayrollMembership` (`@@map("payroll_memberships")`)
21. `HeightCertificate` (`@@map("height_certificates")`)
22. `AuditEvent` (`@@map("audit_events")`)

### 3.4 Frontend

- **Arquitectura:** Angular 20 con componentes standalone (`admin`, `arl`, `auth`, `compliance`, `coordination`, `forms`, `home`, `legal`).
- **PWA:** Configurada mediante `manifest.webmanifest` y `ngsw-config.json`.

---

## 4. Diferenciación entre Pruebas Ejecutadas y Revisiones Estáticas

### 4.1 Validaciones y Pruebas Ejecutadas Realmente

| Componente   | Comando ejecutado                                | Tipo de verificación                        | Resultado                                                      | Detalle                                                                                              |
| ------------ | ------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Prisma**   | `pnpm --filter @sg-sst/api exec prisma validate` | Ejecución CLI                               | **APROBADO** (con `DATABASE_URL` mock) / **FALLIDO** (sin env) | Sin variable `DATABASE_URL` falla con `P1012`. Con URL sintáctica valida los 22 modelos sin errores. |
| **Prisma**   | `pnpm --filter @sg-sst/api run prisma:generate`  | Ejecución CLI                               | **APROBADO**                                                   | Genera `@prisma/client` correctamente.                                                               |
| **Backend**  | `pnpm --filter @sg-sst/api run build`            | Compilación (`nest build`)                  | **APROBADO**                                                   | Compilación TypeScript limpia (código 0).                                                            |
| **Backend**  | `pnpm --filter @sg-sst/api run test`             | Pruebas unitarias (`jest --runInBand`)      | **APROBADO**                                                   | 9 suites aprobadas, 80 pruebas unitarias aprobadas.                                                  |
| **Backend**  | `pnpm --filter @sg-sst/api run lint`             | Linter (`eslint`)                           | **FALLIDO**                                                    | 245 errores de `prettier/prettier` (finales de línea CRLF y formato en código histórico).            |
| **Frontend** | `pnpm --filter @sg-sst/web run build`            | Compilación (`ng build`)                    | **APROBADO**                                                   | Bundle generado en `frontend/dist/web` (490.35 kB total inicial).                                    |
| **Frontend** | `pnpm --filter @sg-sst/web run lint`             | Linter (`eslint`)                           | **APROBADO**                                                   | 0 errores y 0 advertencias.                                                                          |
| **Frontend** | `pnpm --filter @sg-sst/web run test`             | Pruebas unitarias (`ng test --watch=false`) | **APROBADO**                                                   | 1 suite aprobada, 1 prueba unitaria aprobada (`AppComponent`).                                       |
| **Global**   | `pnpm run format:check`                          | Formato (`prettier --check`)                | **FALLIDO**                                                    | 24 archivos históricos del repositorio presentan diferencias de formato con Prettier.                |
| **Docker**   | `docker compose config`                          | Validación sintáctica Compose               | **APROBADO**                                                   | Resuelve la configuración de servicios, redes y volúmenes.                                           |

### 4.2 Aspectos Evaluados Únicamente por Revisión Estática (No Ejecutados)

- **Construcción y arranque de contenedores Docker (`docker compose up` / `build`):** Evaluado por inspección estática de `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.yml` y `infra/nginx/web.conf`.
- **Migraciones de Prisma (`backend/prisma/migrations`):** Evaluadas por inspección estática de las 17 carpetas de migración y `migration_lock.toml` (respetando la prohibición de ejecutar migraciones o resets sobre bases de datos).
- **Flujos de integración con PostgreSQL, Cloudflare R2 y proxy Nginx:** Evaluados por inspección estática de código y configuración.
- **Pruebas E2E:** No ejecutadas por inexistencia de framework E2E en el repositorio.

---

## 5. Estado de Integración Continua (GitHub Actions)

### 5.1 Ejecución Fallida en `main` (Commit `b8fdbb0` — Run `#38803693761`)

En la versión inicial de `.github/workflows/ci.yml` (integrada en `main` mediante el PR #1), todas las verificaciones se encontraban secuencialmente dentro de un único job (`validate`). Al ejecutarse en GitHub Actions ([Run `38803693761`](https://github.com/davidhd709/SistemaSG-SST/actions/runs/38803693761)):

- El paso `Validación de formato raíz (Prettier)` (`pnpm run format:check`) **falló con código de salida 1** debido a los 24 archivos históricos sin formatear y a detalles de formato en los documentos agregados en Fase 0.
- Como consecuencia del diseño en un solo job secuencial, **GitHub Actions abortó la ejecución en ese punto (`conclusion: failure`) y dejó sin ejecutar** los pasos posteriores (`Lint de Backend`, `Lint de Frontend`, `Compilación de Backend`, `Compilación de Frontend`, `Pruebas unitarias de Backend` y `Pruebas unitarias de Frontend`).

### 5.2 Ajuste Aplicado y Resultados Reales en Fase F0.1 (Run `#38912510338`)

En la rama `docs/sgsst-f0-1-audit-alignment`:

1. Se formatearon con Prettier los archivos documentales y de workflow creados en Fase 0/F0.1 (`docs/auditorias/*.md` y `.github/workflows/ci.yml`), verificando con `prettier --check` que cumplen al 100% sin tocar archivos históricos.
2. Se reestructuró `.github/workflows/ci.yml` en **5 jobs independientes y paralelos** sin usar `continue-on-error`.
3. Resultados reales verificados en GitHub Actions ([Run `38912510338`](https://github.com/davidhd709/SistemaSG-SST/actions/runs/38912510338)):

| Job en GitHub Actions                                        | Estado      | Conclusión    | Detalle de ejecución en runner `ubuntu-latest`                                                                                   |
| ------------------------------------------------------------ | ----------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Prisma, Build y Tests Backend** (`backend-build-and-test`) | `completed` | **`success`** | `prisma validate`, `prisma:generate`, `nest build` y 80/80 pruebas unitarias aprobadas.                                          |
| **Build y Tests Frontend** (`frontend-build-and-test`)       | `completed` | **`success`** | `ng build` y 1/1 prueba unitaria en `ChromeHeadless` aprobadas.                                                                  |
| **Lint Frontend** (`frontend-lint`)                          | `completed` | **`success`** | `eslint "src/**/*.ts" --max-warnings=0` aprobado con 0 errores.                                                                  |
| **Formato Global (Prettier)** (`format-check`)               | `completed` | **`failure`** | Control estricto activo: detecta los 24 archivos históricos pendientes de formato (AUD-014 / TEC-003).                           |
| **Lint Backend** (`backend-lint`)                            | `completed` | **`failure`** | Control estricto activo: detecta las 245 violaciones `prettier/prettier` en archivos históricos del backend (AUD-014 / TEC-002). |

---

## 6. Referencia de Hallazgos

El inventario completo y clasificado de los **23 hallazgos de auditoría (AUD-001 a AUD-023)** y los **9 hallazgos técnicos (TEC-001 a TEC-009)** se encuentra documentado en [`02_REGISTRO_HALLAZGOS.md`](./02_REGISTRO_HALLAZGOS.md), y su secuencia de resolución en [`03_PLAN_CORRECCIONES.md`](./03_PLAN_CORRECCIONES.md).
