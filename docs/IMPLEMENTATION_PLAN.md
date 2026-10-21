# Plan de implementación

## Estado de validación — 21 de octubre de 2026

- [x] Instalar dependencias reproducibles con el lockfile y generar Prisma Client.
- [x] Ejecutar formato y lint de API y frontend.
- [x] Compilar API y frontend.
- [x] Ejecutar las pruebas unitarias de la API.
- [x] Configurar en CI las pruebas del frontend con ChromeHeadless.
- [ ] Aplicar las migraciones contra PostgreSQL y repetir las pruebas operativas en el entorno de despliegue. El daemon de Docker no está disponible en la consola de validación actual.

## Fase 0 — Base técnica

- [x] Crear monorepo pnpm con `backend`, `frontend` e `infra`.
- [x] Configurar NestJS con validación global, Helmet, CORS, rate limiting, Swagger y healthcheck.
- [x] Configurar Angular standalone, rutas iniciales y Service Worker/PWA.
- [x] Configurar Prisma con PostgreSQL y Docker Compose.
- [x] Agregar `.env.example`, Dockerfiles y documentación reproducible.
- [x] Crear migración inicial de Prisma (`system_settings`).
- [x] Validar el build del frontend con Node.js 22 LTS y ejecutar sus pruebas en CI.
- [ ] Levantar y comprobar los servicios de Docker Compose.

## Fase 1 — Acceso y RBAC

- [x] Modelo Prisma y migraciones de usuarios, colaboradores, roles, permisos, sesiones y auditoría.
- [x] Autenticación administrativa y de colaborador con Argon2id y bloqueo temporal.
- [x] Access JWT, refresh opaco rotado y revocable en cookie HttpOnly.
- [x] Guards por autenticación y permiso, roles/permissions iniciales y creación controlada de usuarios/colaboradores.
- [x] Auditoría de logins y creaciones sensibles, con correlation ID por request.
- [x] Pantallas iniciales de acceso para colaborador y administración, con tokens de acceso solo en memoria.
- [ ] Aplicar y validar las migraciones y los flujos de autenticación/RBAC contra PostgreSQL real.
- [ ] Crear y ejecutar pruebas E2E de inicio de sesión, renovación y revocación de sesión.

## Fase 2 — ARL

- [x] Historial de afiliaciones, metadatos de soportes y migración Prisma.
- [x] Cálculo `VIGENTE` / `PROXIMA_A_VENCER` / `VENCIDA` desde fechas y `arl_expiring_days`.
- [x] API protegida para consulta, filtros, creación y actualización auditada.
- [x] Pruebas unitarias de cálculo y regla de vencimiento.
- [x] Carga de soportes ARL con validación de archivo, persistencia de evidencia y auditoría.
- [ ] Validar la carga y descarga de soportes con el almacenamiento configurado para el entorno de despliegue.

## Fase 3 — Formularios versionados

- [x] Modelo y migración de formularios/versiones con referencia a una versión publicada exacta.
- [x] Digitalizar y publicar como formulario inicial el permiso de trabajo en altura HSE-FO-016, versión 00.
- [x] API de creación de formularios, nuevas versiones y publicación con auditoría y permisos.
- [x] Renderizador Angular basado en Reactive Forms para los tipos del esquema.
- [ ] Probar en navegador el renderizado, las validaciones y el versionamiento con Node.js 22 LTS.

## Fase 4 — Flujo del colaborador

- [x] Consulta de flujo y bloqueo en backend cuando ARL no está vigente.
- [x] Confirmación obligatoria de charla, validación de respuestas y firma PNG.
- [x] Envío firmado inmutable, snapshot ARL, estado `PENDING_APPROVAL` y auditoría.
- [x] Persistencia temporal de firma como archivo, sin base64 en PostgreSQL.
- [x] Integrar la experiencia guiada de charla, formulario, firma y confirmación en el frontend.
- [ ] Ejecutar una prueba E2E completa del flujo, incluidos los bloqueos por ARL y la firma.

## Fase 5 — Coordinación

- [x] Bandeja, métricas y detalle de envíos pendientes para Coordinación.
- [x] Aprobación/rechazo atómico, motivo obligatorio de rechazo y auditoría de decisión.
- [x] Actualización de estado visible para el colaborador (`PENDING_APPROVAL`, `APPROVED`, `REJECTED`).
- [x] Generación de PDF al rechazo o al cierre de una jornada aprobada, implementada en la Fase 6.
- [ ] Validar en E2E la aprobación, el rechazo y la actualización visible para el colaborador.

## Fase 6 — Archivos y PDF

- [x] `StorageService` con adaptadores local y R2, seleccionados por configuración.
- [x] Firmas persistidas como archivos mediante el adaptador, con metadatos y SHA-256.
- [x] Generación síncrona con `pdf-lib` sobre una plantilla oficial versionada, con identificador verificable y hash almacenado.
- [x] Descarga protegida y auditada de archivos.
- [x] Imagen Docker de API con las plantillas y mappings requeridos por el generador de PDF, sin dependencia de navegador.
- [ ] Probar la generación y descarga de PDF en el contenedor Docker, incluida la configuración R2 si se utilizará en producción.

## Fase 7 — Legal, hardening y despliegue

- [x] Consultas de Legal solo lectura por colaborador, ARL, envíos, firmas y PDFs.
- [x] Auditoría consultable sin endpoints de actualización/eliminación.
- [x] Carga de soportes ARL con validación de archivo y auditoría de evidencia.
- [x] Respuestas de errores sanitizadas con `correlationId`.
- [x] Prueba unitaria de permisos y documentación de despliegue, backups y restauración.
- [ ] Implementar y ejecutar el conjunto de pruebas E2E para los roles de colaborador, coordinación y legal.
- [ ] Ejecutar migraciones, pruebas de backup/restauración y validación de seguridad en un entorno similar a producción.
- [ ] Configurar variables y credenciales productivas: PostgreSQL, almacenamiento R2, CORS y secretos JWT; verificar las cookies seguras del override productivo.

## Pendientes prioritarios antes de despliegue

1. Habilitar Docker y validar PostgreSQL, migraciones y el arranque combinado de Compose.
2. Implementar las pruebas E2E de los flujos críticos.
3. Probar dentro de Docker la generación y descarga de PDF con el almacenamiento elegido para producción.
4. Realizar una prueba de despliegue, backup y restauración con una copia representativa antes de producción.
