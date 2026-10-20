# SG-SST — Plan de Acción de la Auditoría Técnica (20/10/2026)

## 1. Contexto

- **Fecha:** 20 de octubre de 2026.
- **Commit auditado:** `70ba16d` (rama `fix/sgsst-aud0011-final-integration`).
- **Rama de ejecución:** `fix/sgsst-etapa1-pdf-operacion`.
- **Base:** registro previo [`02_REGISTRO_HALLAZGOS.md`](./02_REGISTRO_HALLAZGOS.md) (AUD-001..023, TEC-001..009), verificado contra el código actual, más los hallazgos nuevos AUD-024..033 y la ambigüedad REQ-001.

### Validaciones ejecutadas en la auditoría

| Comando                              | Resultado                                       |
| ------------------------------------ | ----------------------------------------------- |
| `pnpm --filter @sg-sst/api run test` | 96/96 pruebas aprobadas                         |
| `pnpm --filter @sg-sst/api run lint` | 224 errores (220 `prettier/prettier`, 4 reales) |
| `pnpm run format:check`              | 21 archivos sin formato                         |
| Frontend build / test                | No ejecutado; se toma el CI previo (1 prueba)   |
| Contenedores, TLS, R2, producción    | No revisados (fuera del alcance disponible)     |

## 2. Correcciones al registro previo

| ID      | Estado verificado     | Detalle                                                                                                     |
| ------- | --------------------- | ----------------------------------------------------------------------------------------------------------- |
| AUD-001 | Corregido             | El PDF solo usa campos editables permitidos y firmas cargadas desde la base de datos.                       |
| AUD-002 | Parcial               | Ya no se inventa "Vigente", pero las columnas quedan vacías; `complianceJson` no se usa.                    |
| AUD-003 | Abierto               | En un contenedor UTC las horas del PDF salen +5 h. La prueba existente reproduce el mismo cálculo sin zona. |
| AUD-012 | Abierto, más amplio   | No existe endpoint para que un usuario cambie su propia contraseña.                                         |
| AUD-013 | Parcial               | 96 pruebas, concentradas en PDF; sin pruebas de Auth, Users, Approvals, Collaborators ni Compliance.        |
| AUD-019 | Parcial               | La inactivación se aplica en cada petición; el cambio de PIN no revoca sesiones.                            |
| AUD-020 | Inexacto              | `charla-01..03` sí se usan; sobran `charla-04..08` (~21 MB).                                                |
| TEC-001 | Abierto, elevado a P0 | Sin `pdf-templates` en la imagen, el 100 % de los PDF falla en Docker.                                      |
| TEC-004 | Resuelto en CI        | El workflow inyecta `DATABASE_URL`.                                                                         |
| TEC-005 | Abierto, más amplio   | `TemplateRegistry` también depende de `process.cwd()`.                                                      |

El resto de hallazgos AUD/TEC permanece abierto tal como está registrado.

## 3. Hallazgos nuevos

| ID      | Prioridad | Área                | Problema                                                                                                                        |
| ------- | --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| AUD-024 | P1        | Backend / PDF       | Fallos al cargar o incrustar firmas, o al renderizar campos, se registran en log y el PDF incompleto se guarda como definitivo. |
| AUD-025 | P1        | Backend / Operación | Una jornada iniciada solo la cierra un integrante con sesión; si el oficial no puede cerrarla, la cuadrilla queda bloqueada.    |
| AUD-026 | P2        | Datos               | El seed reescribe `schemaJson` de la versión 4 publicada, contra lo establecido en `DECISIONS.md`.                              |
| AUD-027 | P2        | Backend             | La pantalla ARL y el dashboard usan la afiliación con fin más lejano; el control de acceso usa la que cubre hoy.                |
| AUD-028 | P2        | Trazabilidad        | `templateVersion` nunca se persiste y la versión de plantilla cae en silencio a la predeterminada.                              |
| AUD-029 | P2        | Seguridad           | Quien tiene `collaborators:manage` puede fijar el PIN de un oficial y actuar como él; el cambio de PIN no queda auditado.       |
| AUD-030 | P3        | API                 | Parámetros `:id` sin validación UUID ni mapeo de errores Prisma: respuestas 500 en lugar de 400/404.                            |
| AUD-031 | P3        | API                 | El archivo documental (`custody`) se trunca en 500 registros sin paginación.                                                    |
| AUD-032 | P3        | Backend             | Las notas de cierre no llegan al PDF y el PDF de cierre se atribuye al coordinador que aprobó.                                  |
| AUD-033 | P3        | API / Formularios   | La API de formularios no admite campos `auto` ni rechaza IDs reservados.                                                        |

### Ambigüedad de requerimiento

**REQ-001 — Certificado de alturas solo para "Oficial eléctrico".** `compliance.service.ts` marca `NO_APLICA` a los demás cargos. La regla no está documentada y contradice el comentario del modelo `HeightCertificate`. Requiere confirmación de SST/Legal frente a la normativa colombiana de trabajo en alturas (Res. 4272/2021). Si se confirma como incorrecta, pasa a P1. **No se modifica hasta tener la decisión.**

## 4. Plan por etapas

### Etapa 1 — Riesgos críticos (bloqueantes de producción)

Orden de ejecución:

| Paso | ID              | Acción                                                                                                              | Criterio de aceptación                                                                                        |
| ---- | --------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1    | TEC-001         | Copiar `pdf-templates` a la imagen y resolver la ruta de plantillas sin depender de `process.cwd()`.                | La imagen contiene `pdf-templates/HSE-FO-016/v00`; la ruta se resuelve igual desde la raíz o desde `backend`. |
| 2    | AUD-003         | Formatear fecha y horas del PDF en `America/Bogota`.                                                                | Prueba con hora UTC conocida produce la hora de Colombia, independiente de la zona del proceso.               |
| 3    | TEC-008/AUD-002 | Limitar la cuadrilla a 5 integrantes (decisión del 20/10/2026) y mostrar sus estados reales desde `complianceJson`. | Ningún integrante se pierde en el PDF; los estados coinciden con la evidencia del envío.                      |
| 4    | AUD-024         | Abortar la generación si falta una firma esperada o falla su incrustación.                                          | No se persiste un PDF sin todas las firmas; el error queda registrado.                                        |
| 5    | AUD-005         | Endpoint protegido y auditado para generar el PDF faltante de envíos cerrados o rechazados.                         | Un envío sin PDF puede generarlo sin alterar sus sellos de tiempo; queda `AuditEvent`.                        |
| 6    | AUD-025         | Cierre administrativo de jornadas con motivo obligatorio, permiso dedicado y auditoría.                             | Coordinación puede cerrar una jornada atascada; la cuadrilla queda liberada.                                  |
| 7    | AUD-004         | Configurar `trust proxy` para que throttling y auditoría usen la IP real.                                           | `request.ip` refleja `X-Forwarded-For` del proxy de confianza.                                                |
| 8    | AUD-007         | Script de respaldo de PostgreSQL y almacenamiento, y procedimiento de restauración verificable.                     | Script versionado y documentado; prueba de restauración registrada.                                           |
| —    | REQ-001         | Confirmar la regla con SST/Legal.                                                                                   | Decisión documentada en `DECISIONS.md`.                                                                       |

**Dependencias:** los pasos 2–4 deben estar listos antes del paso 5, para no regenerar documentos con los mismos defectos. Antes de regenerar PDFs históricos en un entorno real, hacer backup (paso 8).

### Etapa 2 — Estabilidad y seguridad

1. Commit dedicado exclusivamente a Prettier/ESLint y activación de protección de rama en `main` (AUD-014, TEC-002, TEC-003). Debe ir antes de cualquier refactorización.
2. AUD-006 (seed en Docker), AUD-009 (Swagger), AUD-011 (rotación atómica de sesiones), AUD-012 (cambio de contraseña), AUD-019 + AUD-029 (PIN), AUD-022 (secreto de la charla).
3. AUD-026 (inmutabilidad de versiones), AUD-027 (estado ARL), AUD-028 (versión de plantilla).
4. Pruebas críticas: rotación concurrente de refresh, cierre y expiración de jornadas, decisión de Coordinación, autorización de descargas.

### Etapa 3 — Mantenibilidad

Con pruebas previas: AUD-017 (regla de cargo en `JobPosition.canLead`), AUD-016 (componentes Angular), AUD-015 + TEC-006 (Dockerfiles), TEC-005, decisión sobre Redis (AUD-021), AUD-033.

### Etapa 4 — Mejoras

AUD-030, AUD-031, AUD-032, AUD-008 + CSP, AUD-023, AUD-020 (retirar `charla-04..08`), TEC-009 y actualización del registro de hallazgos.

## 5. Quick wins

- `COPY` de `pdf-templates` en el Dockerfile (TEC-001).
- `timeZone: 'America/Bogota'` en el formateo del PDF (AUD-003).
- `trust proxy` en `main.ts` (AUD-004).
- Swagger solo fuera de producción (AUD-009).
- Variables `R2_*` en el servicio `api` de Compose (TEC-009).
- Carga condicional de `.env` en el seed (AUD-006).
- Retirar `charla-04..08` (AUD-020).
- Protección de rama en `main`.

## 6. Seguimiento de la Etapa 1

| Paso | ID              | Estado              | Commit / Nota                                                                                                                                                                                                                           |
| ---- | --------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | TEC-001         | Hecho `29be2a4`     | `COPY pdf-templates` en Dockerfile; ruta relativa al módulo; `.dockerignore` con `**/node_modules` (la imagen no compilaba). Verificado: la plantilla resuelve dentro del contenedor.                                                   |
| 2    | AUD-003         | Hecho `987ee27`     | Fecha en UTC (DATE) y horas en `America/Bogota`. Pruebas con `TZ` UTC, Bogotá y Tokio; fallan con el código anterior.                                                                                                                   |
| 3    | TEC-008/AUD-002 | Hecho `df30bf9`     | Límite `MAX_CREW_SIZE = 5` en DTO y formulario; el PDF falla si la cuadrilla supera las filas de la plantilla, en vez de recortarla. Estados de alturas y seguridad social desde `complianceJson` (`Sin registro` si no hay evidencia). |
| 4    | AUD-024         | Hecho `4d57612`     | Firma ausente, ilegible o no incrustable y errores de renderizado abortan antes de guardar el PDF. Pruebas comprueban que no se crea archivo ni vínculo en base de datos.                                                               |
| 5    | AUD-005         | Hecho `6454dae`     | `POST /coordination/submissions/:id/generate-pdf` requiere `submissions:review`, acepta `CLOSED` o `REJECTED` sin PDF y reutiliza la generación con `AuditEvent`; no altera horas ni decisión.                                          |
| 6    | AUD-025         | Hecho `f39b469`     | `POST /coordination/submissions/:id/admin-close` requiere `submissions:close-admin` y motivo. Cierra una jornada iniciada, audita al usuario y libera la cuadrilla. El control está en la pantalla de Coordinación.                     |
| 7    | AUD-004         | Hecho `3380ef4`     | `TRUST_PROXY_HOPS` configura 1 salto en desarrollo y 2 en producción (proxy HTTPS → web → API). Prueba de Express verifica `request.ip` con `X-Forwarded-For` y rechaza saltos inválidos.                                               |
| 8    | AUD-007         | Hecho (este commit) | Scripts para respaldar PostgreSQL y archivos locales o R2, y verificar restauración aislada. Prueba del 20/10/2026: checksums correctos y 1 tabla restaurada con Compose temporal. Falta ensayo con datos reales de despliegue.         |
| —    | REQ-001         | Pendiente           | Decisión SST                                                                                                                                                                                                                            |
