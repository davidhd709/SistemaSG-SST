# Prompt maestro para Codex - Sistema SG-SST

Quiero que trabajes como arquitecto de software y desarrollador full stack senior sobre un proyecto nuevo llamado **Sistema SG-SST**. El objetivo es construir una PWA simple para el colaborador, pero con trazabilidad, control de acceso, versionado y auditoría fuertes en el backend.

## 1. Contexto del proyecto

La aplicación controla el proceso que debe cumplir un colaborador antes de iniciar una labor operativa. El flujo principal es:

**Documento + PIN -> validar ARL -> confirmar charla de seguridad -> diligenciar formulario -> firmar -> enviar -> revisión de coordinadora -> aprobar/rechazar -> mostrar autorización para iniciar labores.**

Los formularios pueden servir como soporte interno o legal. Por eso un registro enviado y firmado no debe sobrescribirse, los formularios deben tener versiones y las acciones sensibles deben quedar auditadas.

## 2. Roles

Implementa RBAC más permisos por acción. Los roles iniciales son:

1. **COLLABORATOR / Colaborador**
   - Ingresar con documento + PIN.
   - Ver su estado de ARL.
   - Confirmar charla del día.
   - Diligenciar formularios asignados.
   - Firmar y enviar.
   - Consultar el estado de aprobación.

2. **COORDINATOR / Coordinadora**
   - Crear perfiles de colaboradores.
   - Consultar colaboradores.
   - Revisar formularios enviados.
   - Aprobar o rechazar.
   - Registrar observaciones.
   - Descargar PDF final.

3. **LEGAL**
   - Consultar colaboradores.
   - Consultar estado de ARL.
   - Consultar formularios, envíos e historial.
   - No debe modificar registros operativos salvo que se agregue un permiso explícito.

4. **ARL_MANAGER / Gestor de ARL**
   - Crear y actualizar afiliaciones.
   - Registrar fecha de inicio y fin.
   - Adjuntar certificado/soporte.
   - Consultar afiliaciones vigentes, próximas a vencer y vencidas.

5. **ADMIN**
   - Administrar usuarios, roles y permisos.
   - Restablecer accesos.
   - Crear y versionar formularios.
   - Administrar parámetros.
   - Consultar auditoría.

No confíes solo en el rol del frontend. Toda autorización debe validarse en el backend.

## 3. Stack obligatorio

Usa esta base salvo que exista una incompatibilidad técnica demostrable:

### Frontend

- Angular + TypeScript.
- Standalone components.
- Angular Material.
- Reactive Forms.
- PWA con Angular Service Worker para instalación y caché básica.
- Diseño mobile-first.
- Signature Pad o Canvas HTML5 para la firma.

### Backend

- NestJS + TypeScript.
- API REST.
- Swagger/OpenAPI.
- class-validator/class-transformer o validación equivalente compatible con NestJS.
- Helmet, rate limiting y configuración segura de CORS.

### Datos

- PostgreSQL 18.x.
- Prisma ORM compatible con PostgreSQL 18.
- Migraciones versionadas.

### Procesos/archivos

- Redis + BullMQ para tareas como generación de PDF y notificaciones cuando sea útil.
- Puppeteer + Chromium para PDF.
- Cloudflare R2 como almacenamiento de objetos mediante API compatible con S3.
- Implementa una interfaz `StorageService` para poder cambiar R2 por otro proveedor en el futuro.

### Infraestructura

- Docker y Docker Compose.
- Nginx para producción.
- HTTPS mediante Certbot/Let's Encrypt en documentación de despliegue.
- Ubuntu VPS como destino de producción.

Usa la versión LTS/estable disponible en el entorno. No actualices dependencias mayores de forma automática si el repositorio ya tiene versiones definidas.

## 4. Reglas de negocio obligatorias

1. Un colaborador con ARL vencida **NO** puede continuar al formulario ni ser autorizado.
2. ARL debe manejar:
   - VIGENTE
   - PROXIMA_A_VENCER
   - VENCIDA
3. El estado de ARL se calcula a partir de las fechas. El umbral de “próxima a vencer” debe ser configurable; usa 30 días como valor inicial.
4. Si el colaborador responde que **NO** recibió la charla de seguridad, no puede avanzar.
5. Un formulario enviado y firmado es inmutable.
6. Si se necesita una corrección, crea un nuevo intento relacionado con el anterior. Nunca edites silenciosamente el envío firmado.
7. Modificar un formulario crea una nueva `form_version`.
8. Los envíos históricos siempre deben apuntar a la versión exacta que se diligenció.
9. Aprobaciones y rechazos deben guardar usuario, fecha/hora y observación/motivo cuando corresponda.
10. Descargas de documentos sensibles deben generar auditoría.
11. Un usuario normal no puede editar ni eliminar eventos de auditoría.
12. No implementes eliminación física de documentos históricos por defecto. Usa estados/soft delete donde corresponda y deja la política de retención configurable.

## 5. Autenticación y seguridad

### Colaborador

- Ingreso por `documentNumber + PIN`.
- Nunca permitir acceso usando solo la cédula/documento.
- PIN almacenado con Argon2id, nunca en texto plano.

### Usuarios administrativos

- Correo + contraseña.
- Contraseña con Argon2id.
- Deja preparada la arquitectura para MFA/TOTP, aunque puede quedar fuera del MVP si complica la primera fase.

### Tokens

- JWT de acceso de corta duración.
- Refresh token seguro, rotado y revocable.
- Preferir refresh token en cookie `HttpOnly`, `Secure` y `SameSite` apropiado para el despliegue.
- No guardar refresh tokens en texto plano en la base de datos; guarda hash o identificador seguro.
- No uses `localStorage` para conservar credenciales sensibles de larga duración.

### Controles adicionales

- Rate limiting por IP/usuario en login.
- Bloqueo temporal después de varios intentos fallidos.
- Validar DTOs en backend.
- Validar permisos en backend con Guards/decorators.
- Validar MIME real, extensión y tamaño de archivos.
- Agregar `correlationId` por request para trazabilidad.
- Usar fechas del servidor en UTC y mostrar hora local en frontend.

## 6. Modelo de datos inicial

Diseña el esquema Prisma. Usa UUID para entidades principales salvo que exista una razón clara para no hacerlo.

Como mínimo contempla:

### Acceso

- `User`
- `Role`
- `Permission`
- `UserRole`
- `RolePermission`
- `RefreshSession`

### Colaboradores

- `Collaborator`
  - id
  - documentType
  - documentNumber unique
  - firstName
  - lastName
  - email opcional
  - phone opcional
  - jobTitle opcional
  - crew/team opcional
  - active
  - createdBy
  - createdAt
  - updatedAt

No mezcles obligatoriamente `User` y `Collaborator`. Un colaborador debe poder tener perfil operativo y un mecanismo de acceso propio.

### ARL

- `ArlAffiliation`
  - collaboratorId
  - providerName
  - startDate
  - endDate
  - createdBy
  - createdAt
  - updatedBy
  - updatedAt
- `ArlDocument`
  - affiliationId
  - fileId

No guardes manualmente un estado que pueda quedar desactualizado; calcula VIGENTE/PROXIMA_A_VENCER/VENCIDA en el servicio con base en fechas y configuración.

### Formularios

- `Form`
  - id
  - code
  - name
  - description
  - status
  - currentVersionId opcional
- `FormVersion`
  - id
  - formId
  - versionNumber
  - schemaJson JSONB
  - publishedAt
  - createdBy
  - changeReason
  - active

`schemaJson` debe permitir tipos de campo como:

- text
- textarea
- yes_no
- select
- multi_select
- number
- date
- photo/file si se habilita

Incluye en el schema: id estable del campo, label, required, options, validations y order.

### Envíos

- `FormSubmission`
  - id
  - collaboratorId
  - formVersionId
  - status
  - answersJson JSONB
  - safetyTalkConfirmed
  - safetyTalkConfirmedAt
  - arlSnapshotJson JSONB
  - submittedAt
  - previousSubmissionId opcional para correcciones
  - createdAt

El `arlSnapshotJson` debe conservar el estado y fechas de ARL existentes al momento del envío.

### Firma

- `Signature`
  - id
  - submissionId unique
  - fileId
  - sha256
  - signedAt
  - ip
  - userAgent

No guardes la imagen base64 en PostgreSQL. Convierte la firma a archivo y almacénala mediante `StorageService`.

### Aprobaciones

- `Approval`
  - id
  - submissionId
  - decision APPROVED / REJECTED
  - decidedBy
  - decidedAt
  - reason opcional

### Archivos

- `FileObject`
  - id
  - storageProvider
  - bucket
  - objectKey
  - originalName
  - mimeType
  - sizeBytes
  - sha256
  - createdBy
  - createdAt

El bucket debe ser privado. Descarga a través del backend o URL firmada con expiración corta y permiso verificado.

### Auditoría

- `AuditEvent`
  - id
  - actorUserId opcional
  - actorCollaboratorId opcional
  - action
  - entityType
  - entityId
  - beforeJson opcional
  - afterJson opcional
  - reason opcional
  - evidenceFileId opcional
  - ip opcional
  - userAgent opcional
  - correlationId
  - createdAt

La aplicación no debe exponer endpoints de update/delete para `AuditEvent`.

### Solicitudes de cambio sensibles

- `ChangeRequest`
  - id
  - type
  - requestedByName/userId
  - authorizedByName/userId opcional
  - reason
  - evidenceFileId opcional
  - status
  - createdAt
  - resolvedAt opcional

Úsalo como soporte de acciones como crear usuarios, cambiar roles o modificar formularios cuando el flujo lo requiera.

### Configuración

- `SystemSetting`
  - key
  - valueJson

Crea como mínimo `arl_expiring_days = 30`.

## 7. Estados

Define enums consistentes.

### Form

- DRAFT
- PUBLISHED
- INACTIVE

### Submission

- DRAFT
- PENDING_APPROVAL
- APPROVED
- REJECTED

### Collaborator

- ACTIVE
- INACTIVE

El estado de ARL es calculado, no persistido como verdad absoluta.

## 8. Flujo frontend del colaborador

La experiencia debe ser muy simple y mobile-first.

1. Pantalla de ingreso:
   - Documento.
   - PIN.
   - Botón grande “Ingresar”.
2. Bienvenida:
   - “Bienvenido, {nombre}”.
   - Estado visible de ARL.
3. Si ARL vencida:
   - Mensaje claro.
   - Bloquear avance.
4. Si ARL vigente/próxima a vencer:
   - Pregunta: “¿Recibiste la charla de seguridad de hoy?”
   - Sí / No.
5. Si No:
   - Bloqueo con instrucción clara.
6. Si Sí:
   - Cargar formulario asignado/publicado.
7. Renderizar formulario a partir de `schemaJson` usando Reactive Forms.
8. Validar obligatorios.
9. Pantalla de firma.
10. Vista de resumen antes del envío.
11. Enviar.
12. Mostrar estado “Pendiente de aprobación”.
13. Permitir refrescar/consultar hasta que aparezca “Autorizado para iniciar labores” o “Rechazado”.

No dependas solo de colores para los estados. Usa texto e iconos accesibles.

## 9. Panel de coordinadora

Crear:

- Dashboard con conteos de pendientes, aprobados, rechazados y bloqueados por ARL.
- Lista de colaboradores.
- Lista/bandeja de envíos pendientes.
- Detalle del envío con:
  - colaborador
  - ARL snapshot
  - formulario y versión
  - respuestas
  - firma
  - archivos
  - timestamps
- Botones Aprobar / Rechazar.
- Rechazo requiere motivo.
- Descarga de PDF final.

Registrar auditoría de aprobación, rechazo y descarga.

## 10. Panel Legal

Solo lectura por defecto:

- Buscar por documento/nombre.
- Ver ARL actual y vigencias históricas.
- Ver envíos y estados.
- Abrir/descargar documentos si tiene permiso.
- Ver historial relacionado con el colaborador.

## 11. Panel Gestor ARL

- Listado de colaboradores.
- Filtros: vigente, próxima a vencer, vencida.
- Crear/actualizar afiliación.
- Adjuntar soporte.
- Mostrar fecha inicio/fin.
- Registrar auditoría antes/después.

## 12. Panel Administrador

- CRUD controlado de usuarios administrativos.
- Roles y permisos.
- Restablecer acceso con `forcePasswordChange` o mecanismo equivalente.
- Crear formularios.
- Crear nueva versión de formulario.
- Publicar/desactivar versiones.
- Consultar auditoría con filtros.
- Configuración de `arl_expiring_days`.

Para acciones sensibles admite/solicita `changeRequestId` o campos de autorización cuando corresponda.

## 13. PDF final

Genera el PDF en el backend con Puppeteer.

Debe mostrar:

- Nombre y documento del colaborador.
- Fecha/hora.
- Código y nombre del formulario.
- Número de versión.
- Respuestas.
- Confirmación de charla.
- Estado/fechas de ARL al momento del envío.
- Firma manuscrita.
- Decisión de coordinadora.
- Nombre/usuario de quien aprobó o rechazó.
- Fecha/hora de decisión.
- Identificador del registro.
- SHA-256 del PDF o un código verificable asociado.

Flujo recomendado:

1. Envío queda inmutable.
2. Coordinadora decide.
3. Crear trabajo BullMQ `generate-final-pdf`.
4. Generar PDF.
5. Calcular SHA-256.
6. Subir a R2.
7. Guardar `FileObject`.
8. Registrar auditoría.

Si BullMQ/Redis complica demasiado el arranque, diseña la interfaz del job y permite ejecución síncrona temporal solo durante desarrollo, pero deja la implementación preparada para BullMQ antes de producción.

## 14. Auditoría

Centraliza la creación de auditorías en un `AuditService` y, cuando ayude, un interceptor/decorator para evitar duplicación.

Audita como mínimo:

- login exitoso/fallido relevante
- creación/desactivación de usuario
- cambio de rol/permisos
- creación de colaborador
- actualización de ARL
- carga/reemplazo de soporte ARL
- creación/publicación de formulario
- creación de nueva versión
- envío de formulario
- firma
- aprobación
- rechazo
- generación de PDF
- descarga de PDF/evidencia
- cambios de configuración

Para updates guarda `beforeJson` y `afterJson` sanitizados. Nunca incluyas contraseñas, hashes de credenciales, refresh tokens, secretos ni contenido sensible innecesario en auditoría.

## 15. Almacenamiento R2

Implementa `StorageService` con al menos:

- `putObject`
- `getObject` o `getSignedDownloadUrl`
- `deleteObject` solo para objetos temporales/no históricos y protegido por permisos
- `headObject`

Usa el SDK S3 compatible. Variables de entorno:

- R2_ACCOUNT_ID
- R2_ACCESS_KEY_ID
- R2_SECRET_ACCESS_KEY
- R2_BUCKET
- R2_ENDPOINT

No hagas público el bucket.

En desarrollo, si R2 no está configurado, implementa un `LocalStorageAdapter` detrás de la misma interfaz para que el proyecto funcione sin credenciales externas. Documenta que producción debe usar R2 u otro storage privado.

## 16. Estructura del repositorio

Si el repositorio está vacío, organiza de forma clara, por ejemplo:

```text
sg-sst/
  apps/
    web/        # Angular
    api/        # NestJS
  infra/
    nginx/
  docker-compose.yml
  .env.example
  README.md
```

Puedes usar workspace/monorepo si aporta valor, pero evita introducir herramientas complejas sin necesidad. Prioriza que sea mantenible por un equipo pequeño.

En NestJS separa módulos:

```text
auth
users
roles
permissions
collaborators
arl
forms
submissions
signatures
approvals
files
audit
change-requests
settings
notifications
health
```

En Angular separa por features/roles y usa lazy loading.

## 17. Docker Compose de desarrollo

Debe permitir levantar como mínimo:

- postgres
- redis
- api
- web, si es práctico; si el frontend se ejecuta localmente con `ng serve`, documentarlo claramente.

Incluye healthchecks donde sea útil.

No incluyas secretos reales en el repositorio.

## 18. Pruebas mínimas

Crea pruebas para las reglas críticas.

Backend:

- ARL vencida bloquea proceso.
- ARL próxima a vencer se calcula correctamente.
- Usuario sin permiso recibe 403.
- Form submission enviado no puede editarse.
- Nueva versión no modifica envíos anteriores.
- Rechazo requiere motivo.
- Auditoría se crea en acciones críticas.
- Rutas de auditoría no permiten update/delete.

Frontend:

- Login colaborador.
- Bloqueo visual ARL vencida.
- No permite continuar con charla = No.
- Render de campos dinámicos.
- Validación de obligatorios.
- Firma requerida antes de enviar.

Agrega E2E para el flujo principal cuando la base esté estable.

## 19. Calidad y seguridad de código

- TypeScript strict donde sea viable.
- ESLint/Prettier.
- Manejo centralizado de errores.
- Respuestas de API consistentes.
- No expongas stack traces en producción.
- Índices de base de datos para documentNumber, status, endDate, formId/version, submission status y createdAt según consultas.
- Transacciones para operaciones que deban ser atómicas, especialmente envío, aprobación y auditoría relacionada.
- No uses datos de ejemplo inseguros como credenciales por defecto en producción.

## 20. Costos y servicios externos

La arquitectura debe poder funcionar en la primera etapa pagando principalmente dominio + VPS.

No agregues servicios de pago obligatorios si existe una alternativa local/self-hosted adecuada.

- PostgreSQL en VPS.
- Redis en VPS.
- Nginx en VPS.
- Certbot/Let's Encrypt.
- R2 para documentos cuando esté configurado; local adapter en desarrollo.
- Email, WhatsApp y SMS deben quedar desacoplados y opcionales.
- No implementar proveedor de firma digital certificada sin un requisito explícito del área Legal.

## 21. Método de trabajo que debes seguir

Antes de escribir código:

1. Inspecciona el repositorio completo.
2. No borres ni reemplaces trabajo existente sin necesidad.
3. Identifica herramientas/versiones ya configuradas.
4. Escribe un plan corto de implementación en `docs/IMPLEMENTATION_PLAN.md` con fases, dependencias y decisiones.
5. Crea/actualiza `README.md` con instrucciones reproducibles.

Después implementa por fases y valida cada una antes de seguir:

### Fase 0 - Base técnica

- estructura
- Angular
- NestJS
- Prisma/PostgreSQL
- Redis
- Docker
- env example
- health endpoint

### Fase 1 - Acceso y RBAC

- auth
- users
- roles
- permissions
- collaborator access
- audit base

### Fase 2 - ARL

- modelo
- API
- reglas de vigencia
- vistas de gestor/legal

### Fase 3 - Formularios versionados

- forms
- versions
- schemaJson
- renderer frontend

### Fase 4 - Flujo colaborador

- login
- ARL
- charla
- formulario
- firma
- envío

### Fase 5 - Coordinadora

- pendientes
- revisar
- aprobar/rechazar
- estados

### Fase 6 - Archivos/PDF

- StorageService
- local adapter
- R2 adapter
- PDF
- SHA-256
- descarga auditada

### Fase 7 - Legal, reportes y hardening

- consultas
- filtros
- seguridad
- pruebas
- backups/documentación de producción

Al terminar cada fase:

- ejecuta lint
- compila/build
- ejecuta pruebas
- corrige errores antes de continuar
- actualiza el plan con lo completado

No dejes errores conocidos ocultos.

## 22. Primer objetivo concreto

Empieza ahora por **inspeccionar el repositorio y ejecutar la Fase 0**. Si el repositorio está vacío, crea la estructura base. Después avanza con la Fase 1 si la Fase 0 compila y sus servicios principales levantan correctamente.

No construyas una interfaz visual enorme antes de que el modelo de datos, autenticación, permisos y reglas críticas estén funcionando.

## 23. Resultado esperado

Quiero terminar con un proyecto que pueda:

- ejecutarse localmente de forma reproducible;
- desplegarse en un VPS Ubuntu(post-mvp);
- autenticar correctamente cada rol;
- impedir acciones no autorizadas desde el backend;
- bloquear colaboradores con ARL vencida;
- manejar formularios dinámicos y versionados;
- capturar firma;
- conservar envíos inmutables;
- aprobar/rechazar desde coordinación;
- generar PDF final;
- almacenar archivos de forma privada;
- mantener una auditoría clara y consultable.

Si detectas una decisión de negocio no definida que no impida avanzar, usa una opción segura y documenta la suposición en `docs/DECISIONS.md`. Solo detén el desarrollo si falta un dato verdaderamente indispensable o existe riesgo de pérdida de datos/trabajo existente.
