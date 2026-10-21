# Decisiones técnicas

## 2026-08-24 — Arquitectura inicial

- Se usa un monorepo pnpm con dos workspaces para mantener frontend y backend independientes, sin introducir una herramienta de monorepo adicional.
- Node.js 22 LTS es el requisito mínimo para las imágenes y herramientas de desarrollo.
- PostgreSQL 18 se ejecuta en Docker Compose para desarrollo. Redis no forma parte de la arquitectura actual.
- La PWA es **online-first**: el Service Worker facilita instalación y caché de recursos, pero los envíos oficiales requieren conexión con la API.
- La API se expone bajo el prefijo `/api`; Nginx enruta esa ruta al backend en el despliegue contenedorizado.
- El modelo Prisma comenzó con `SystemSetting`; las migraciones posteriores incorporaron usuarios, colaboradores, cargos, ARL, seguridad social, formularios, envíos, archivos, firmas, aprobaciones, sesiones y auditoría.

## 2026-08-24 — Cálculo de vigencia ARL

- El estado se evalúa a partir de la afiliación con fecha de fin más reciente del colaborador; no se persiste en la base de datos.
- Las fechas de ARL son días calendario UTC. La fecha de finalización sigue siendo válida durante todo el día.
- Una afiliación aún no iniciada se trata como `VENCIDA` para el flujo operativo, por lo que bloquea el avance hasta que entre en vigencia.

## 2026-08-24 — Primer formato digital

- El único formulario cargado inicialmente es `HSE-FO-016` — Permiso de trabajo en altura, basado en el Excel suministrado, fecha 30/09/2022 y versión 00.
- Se registra como `FormVersion` 1. Cualquier ajuste posterior debe crear otra versión; no se modifica este esquema publicado.

## 2026-08-24 — Firma del flujo inicial

- La firma manuscrita se transmite como PNG para validación, pero se convierte inmediatamente en archivo local y se registra mediante `FileObject` y `Signature`; no se guarda base64 en PostgreSQL.
- El adaptador local permite ejecutar desarrollo sin servicios externos. `StorageService` selecciona R2 cuando recibe todas sus credenciales y conserva el adaptador local como fallback.

## 2026-08-24 — Decisiones de Coordinación

- La decisión se permite una sola vez y únicamente desde `PENDING_APPROVAL`; el envío y su firma no se modifican al aprobar o rechazar.
- Un rechazo exige motivo. Una aprobación puede conservar una observación opcional.

## 2026-08-24 — Archivos y PDF

- Los archivos se almacenan detrás de `StorageService`: local para desarrollo y R2 solo cuando se configuran sus credenciales.
- El PDF se genera de forma síncrona con `pdf-lib`, superponiendo los datos autorizados sobre una plantilla oficial versionada. Un rechazo genera el documento de inmediato; una aprobación lo genera cuando la jornada se cierra. El proceso no usa Chromium, Redis ni BullMQ.
