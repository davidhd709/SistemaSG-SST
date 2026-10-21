# SG-SST — Plan de Correcciones Priorizado

> **Documento histórico.** Conserva la secuencia propuesta al iniciar la auditoría. El estado ejecutado y los commits de evidencia se registran en [`04_PLAN_ACCION.md`](./04_PLAN_ACCION.md).

## 1. Visión General y Criterios de Priorización

El presente plan organiza la resolución de los 23 hallazgos oficiales de auditoría (**AUD-001 a AUD-023**) y los 9 hallazgos técnicos complementarios (**TEC-001 a TEC-009**) en **6 fases secuenciales**, priorizando la integridad probatoria del documento legal HSE-FO-016, la viabilidad operativa del motor PDF en contenedores Docker y la seguridad del sistema antes de proceder con refactorizaciones o mejoras de estilo.

---

## 2. Fases de Ejecución

### Fase 1: Integridad de Datos y Firmas del PDF

**Objetivo:** Garantizar que el documento PDF generado (HSE-FO-016) refleje única y exclusivamente datos verificados por el servidor y firmas autenticadas desde el almacenamiento seguro, impidiendo cualquier inyección desde `answersJson`.

- **Hallazgos incluidos:**
  - **AUD-001 (P1):** Manipulación de datos y posible inserción de firmas no autorizadas en el PDF.
  - **AUD-003 (P1):** Posible desfase horario en fechas y horas del permiso y del PDF.
- **Acciones técnicas:**
  1. En `backend/src/pdf/pdf.service.ts`, sobrescribir incondicionalmente los campos de cuadrilla (`cedula`, `nombre`, `cargo`) con los registros de base de datos de `submission.members`, eliminando el operador `answers[...] || ...`.
  2. En `backend/src/pdf/field-renderer.ts`, eliminar el fallback que decodifica cadenas `data:image/` o base64 directamente desde `data.answers[key]` en campos de tipo `SIGNATURE`. Toda firma debe provenir exclusivamente del arreglo `data.signatures` cargado desde `StorageService`.
  3. Fijar explícitamente `timeZone: 'America/Bogota'` al formatear timestamps (`startedAt`, `closedAt`) y tratar `workDate` (`@db.Date`) en UTC o mediante `businessDay` para evitar desplazamientos al día anterior.
- **Dependencias:** Aprobación de la Fase F0.1 por el orquestador.
- **Condiciones de aceptación:**
  - Ningún valor enviado en `answersJson` puede alterar nombres, cédulas, cargos ni inyectar firmas en el PDF resultante.
  - Pruebas unitarias en `pdf.service.spec.ts` que verifiquen el rechazo/ignorado de firmas base64 inyectadas en `answersJson` y la exactitud de fechas en frontera horaria (19:00–23:59 hora Colombia).

---

### Fase 2: Correcta Generación del PDF en Docker

**Objetivo:** Asegurar que el contenedor `api` disponga de las plantillas oficiales del formulario HSE-FO-016 y de un proceso de inicialización funcional.

- **Hallazgos incluidos:**
  - **TEC-001 (P1):** Omisión de plantillas PDF en runtime de Docker (`backend/Dockerfile`).
  - **AUD-006 (P1):** Seed inicial defectuoso en Docker.
- **Acciones técnicas:**
  1. Incorporar `COPY --from=build /workspace/backend/pdf-templates ./pdf-templates` en la etapa de ejecución de `backend/Dockerfile`.
  2. Hacer tolerante la carga de `.env` en `backend/prisma/seed.ts` cuando las variables ya están inyectadas por el entorno del contenedor y asegurar que el comando de seed pueda ejecutarse en la imagen compilada sin depender de `ts-node` ausente en producción.
- **Dependencias:** Fase 1 completada.
- **Condiciones de aceptación:**
  - La imagen construida con `backend/Dockerfile` contiene `/app/backend/pdf-templates/HSE-FO-016/v00/template.pdf` y `mapping.json`.
  - La generación del PDF y la ejecución del seed finalizan sin errores dentro del contenedor Docker.

---

### Fase 3: Estados de Cumplimiento y Capacidad de Cuadrillas

**Objetivo:** Alinear los estados de certificación mostrados en el PDF con la evidencia real de cumplimiento (`complianceJson`), estandarizar la capacidad de integrantes entre DTO, formulario y plantilla PDF, y eliminar reglas atadas a texto libre.

- **Hallazgos incluidos:**
  - **AUD-002 (P1):** Estados de certificación incorrectos en el PDF.
  - **TEC-008 (P1):** Diferencia entre los 20 integrantes admitidos y las cinco filas individuales del PDF.
  - **AUD-017 (P2):** Reglas dependientes del texto del cargo (`esOficialElectrico`).
- **Acciones técnicas:**
  1. Extraer en `pdf.service.ts` los estados de certificado de alturas y seguridad social de cada integrante directamente desde `member.complianceJson` (registrado al momento del envío) en lugar de valores fijos `'Vigente'` / `'Verificada'` o de `answersJson`.
  2. Alinear el límite de integrantes de cuadrilla entre `SubmitFormDto`, el frontend y la capacidad real de representación de la plantilla `HSE-FO-016` (o habilitar el renderizado completo de todos los miembros sin truncamiento silencioso a 5 filas).
  3. Vincular la validación de liderazgo y exigencia de PIN al catálogo `JobPosition` (`canLead`) en lugar de comparar subcadenas de texto libre en `jobTitle`.
- **Dependencias:** Fase 1 y Fase 2 completadas.
- **Condiciones de aceptación:**
  - El PDF refleja fielmente el estado almacenado en `member.complianceJson` para cada integrante.
  - No existe pérdida silenciosa de integrantes entre la validación del DTO y el PDF generado.
  - Pruebas unitarias actualizadas para `PdfService`, `SubmissionsService` y `CollaboratorsService`.

---

### Fase 4: Recuperación de Documentos y Consistencia de Almacenamiento

**Objetivo:** Permitir la regeneración controlada del PDF cuando falle la generación inicial y unificar la configuración de almacenamiento local y en la nube (Cloudflare R2).

- **Hallazgos incluidos:**
  - **AUD-005 (P1):** PDF sin mecanismo de regeneración.
  - **TEC-005 (P2):** Ambigüedad en la ruta raíz de almacenamiento local (`storage`).
  - **TEC-009 (P2):** Variables R2 no transmitidas al contenedor API en `docker-compose.yml`.
- **Acciones técnicas:**
  1. Exponer un mecanismo/endpoint protegido para regenerar el PDF final de envíos en estado `CLOSED` o `REJECTED` cuyo `finalPdfFileId` sea `null` (o bajo solicitud autorizada con trazabilidad en `AuditEvent`).
  2. Parametrizar el directorio de almacenamiento local mediante variable `STORAGE_DIR` / resolución determinista independiente del directorio de trabajo (`process.cwd()`).
  3. Propagar las variables `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` y `R2_ENDPOINT` al servicio `api` en `docker-compose.yml`.
- **Dependencias:** Fase 1, Fase 2 y Fase 3 completadas.
- **Condiciones de aceptación:**
  - Un permiso cerrado o rechazado sin PDF puede generar su documento final sin alterar los sellos de tiempo de la jornada.
  - El almacenamiento local resuelve siempre a una única ruta consistente y R2 es configurable desde Docker Compose.

---

### Fase 5: Seguridad, Autenticación y Sesiones

**Objetivo:** Fortalecer la seguridad perimetral detrás de Nginx, el ciclo de vida de sesiones/contraseñas y la trazabilidad de auditoría.

- **Hallazgos incluidos:**
  - **AUD-004 (P1):** IP del cliente y throttling detrás de Nginx (`trust proxy`).
  - **AUD-008 (P2):** Cabeceras de seguridad en bloques `location` de Nginx.
  - **AUD-009 (P2):** Swagger público en entornos productivos.
  - **AUD-010 (P2):** Auditoría opcional de eventos (`AuditService`).
  - **AUD-011 (P2):** Concurrencia en rotación de sesiones (`refresh_token`).
  - **AUD-012 (P2):** Cambio obligatorio de contraseña sin aplicación (`forcePasswordChange`).
  - **AUD-018 (P3):** Protección del último administrador activo.
  - **AUD-019 (P3):** Sesiones activas después del cambio de PIN o inactivación de colaborador.
  - **AUD-022 (P3):** Secreto reutilizado para la charla (`JWT_REFRESH_SECRET`).
- **Acciones técnicas:**
  1. Configurar `trust proxy` en `backend/src/main.ts` y restringir Swagger (`/api/docs`) fuera de producción.
  2. Mantener las cabeceras de seguridad HTTP en todos los bloques `location` de `infra/nginx/web.conf`.
  3. Asegurar rotación atómica de `RefreshSession` (`updateMany` con filtro `revokedAt: null`), revocación de sesiones al cambiar PIN/estado de colaborador, aplicación de `forcePasswordChange`, bloqueo de desactivación del último `ADMIN` y secreto dedicado para el token de charla.
  4. Unificar el registro de eventos de auditoría críticos.
- **Dependencias:** Fases 1 a 4 completadas.
- **Condiciones de aceptación:**
  - `ThrottlerGuard` y los registros de auditoría identifican la IP real del cliente detrás del proxy.
  - Las cabeceras `X-Content-Type-Options`, `X-Frame-Options` y `Referrer-Policy` están presentes en todas las respuestas de Nginx (incluyendo `/`, assets y manifest).
  - Pruebas unitarias de regresión para rotación concurrente, revocación por cambio de PIN, `forcePasswordChange` y protección del último administrador.

---

### Fase 6: Pruebas, Infraestructura y Preparación para Producción

**Objetivo:** Saneamiento de calidad de código, optimización de imágenes Docker, implementación de backups verificables, ampliación de cobertura de pruebas y actualización documental.

- **Hallazgos incluidos:**
  - **AUD-007 (P1):** Backups sin implementación verificada.
  - **AUD-013 (P2) / TEC-007 (P2):** Cobertura insuficiente de pruebas y carencia de pruebas de integración/E2E.
  - **AUD-014 (P2) / TEC-002 (P2) / TEC-003 (P2) / TEC-004 (P2):** CI, errores de formato Prettier y finales de línea CRLF.
  - **AUD-015 (P2) / TEC-006 (P2):** Optimización de Dockerfiles, eliminación de Chromium residual y ejecución con usuario sin privilegios (`USER node`).
  - **AUD-016 (P2):** Refactorización modular de componentes Angular extensos.
  - **AUD-020 (P3):** Limpieza de videos MP4 publicados sin uso en el bundle.
  - **AUD-021 (P3):** Definición o retiro del servicio Redis sin uso.
  - **AUD-023 (P3):** Actualización integral de la documentación técnica.
- **Acciones técnicas:**
  1. Implementar scripts automatizados de respaldo y verificación de restauración de PostgreSQL y almacenamiento.
  2. Optimizar `backend/Dockerfile` y `frontend/Dockerfile` (usuario no root, limpieza de dependencias Chromium y devDependencies).
  3. Normalizar el formato de los archivos pendientes con Prettier/ESLint en un commit dedicado exclusivamente a estilo, dejando todos los jobs de CI en verde.
  4. Ampliar las suites de pruebas unitarias e integración en backend y frontend, retirar assets innecesarios y actualizar `README.md` y `docs/`.
- **Dependencias:** Fases 1 a 5 completadas.
- **Condiciones de aceptación:**
  - Todos los jobs del workflow `.github/workflows/ci.yml` (`format-and-lint`, `backend-build-and-test`, `frontend-build-and-test`) finalizan en estado `SUCCESS` (código 0).
  - Contenedores ejecutando con usuario no privilegiado y procedimiento de backup probado.
