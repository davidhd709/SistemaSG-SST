# SG-SST — Plan de Correcciones por Fases

## 1. Visión General del Plan

El presente plan estructura la resolución secuencial y controlada de los hallazgos identificados en la auditoría técnica (AUD-001 a AUD-023) y los hallazgos técnicos complementarios detectados en la Fase 0 (TEC-001 a TEC-007). 

El trabajo se divide en 5 fases lógicas con dependencias claras y criterios de aceptación específicos para asegurar la estabilidad, seguridad y mantenibilidad del SG-SST sin introducir regresiones funcionales ni romper el formulario HSE-FO-016.

---

## 2. Estructura de Fases

### Fase 1: Integridad Documental, Almacenamiento y Permisos
**Objetivo:** Consolidar el almacenamiento de evidencias (firmas, PDFs, certificados), resolver ambigüedades en rutas de archivos y afinar los permisos de acceso y trazabilidad documental.

- **Alcance / Tareas:**
  - Consolidar la raíz de almacenamiento local (`LocalStorageAdapter` / `StorageService`) para unificar `./storage` y `./backend/storage` mediante variable de entorno configurable `STORAGE_PATH` (TEC-005).
  - Validar descarga segura de archivos y protección de evidencias según rol y pertenencia de cuadrilla.
  - Resolver hallazgos AUD asignados a integridad documental y permisos (e.g. AUD-002, AUD-006, AUD-010).
- **Dependencias:** Ninguna (fase inicial de remediación).
- **Criterio de Cierre / Aceptación:**
  - Rutas de almacenamiento unificadas y deterministas en cualquier entorno (Docker, local o CI).
  - Pruebas unitarias de `FilesService` y permisos de descarga ejecutadas y aprobadas al 100%.

---

### Fase 2: Backend e Infraestructura (Docker, PDF y Entorno)
**Objetivo:** Asegurar que los contenedores Docker sean completamente funcionales y reproducibles, integrando las plantillas PDF oficiales y optimizando los recursos.

- **Alcance / Tareas:**
  - **Corrección TEC-001 (Crítica):** Modificar `backend/Dockerfile` para copiar `backend/pdf-templates` a la imagen final de producción (`/app/backend/pdf-templates`).
  - **Optimización TEC-006:** Limpiar dependencias residuales de Puppeteer / Chromium en el Dockerfile de backend, reduciendo la imagen en ~300 MB.
  - Revisar y verificar `docker-compose.yml` y `docker-compose.prod.yml` para garantizar variables de entorno y volúmenes consistentes.
  - Resolver hallazgos AUD asignados a Backend e Infraestructura (e.g. AUD-004, AUD-005, AUD-008, AUD-009, AUD-019, AUD-020).
- **Dependencias:** Fase 1 completada.
- **Criterio de Cierre / Aceptación:**
  - `docker compose build` compila con éxito tanto `api` como `web`.
  - La generación de PDF con `HSE-FO-016/v00` funciona dentro del contenedor Docker sin excepciones `NotFoundException`.

---

### Fase 3: Seguridad, Autenticación y Sesiones
**Objetivo:** Fortalecer el control de acceso, rotación de credenciales, protección contra fuerza bruta y rate limiting.

- **Alcance / Tareas:**
  - Consolidar rate limiting granular en endpoints de autenticación y recursos sensibles (AUD-001 y afines).
  - Auditar manejo de cookies HttpOnly, secretos JWT (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) y políticas de bloqueo por intentos fallidos.
  - Resolver hallazgos AUD de seguridad (e.g. AUD-017, AUD-018).
- **Dependencias:** Fase 1 y Fase 2 completadas.
- **Criterio de Cierre / Aceptación:**
  - Suites de `ThrottlerGuard` y `AuthService` aprobadas.
  - No exposición de tokens sensibles en respuestas o logs.

---

### Fase 4: Pruebas, Calidad y Normalización de Código
**Objetivo:** Eliminar la deuda técnica de estilo y formato, normalizar finales de línea y ampliar la cobertura de pruebas.

- **Alcance / Tareas:**
  - **Corrección TEC-002 y TEC-003:** Normalizar finales de línea LF en todos los archivos del repositorio aplicando `.gitattributes` y ejecutar `prettier --write` para resolver las 245 violaciones de ESLint en backend y los 24 archivos marcados en `format:check`.
  - Habilitar verificación estricta de linting en CI (`pnpm run lint` y `pnpm run format:check` pasando al 100% con 0 errores).
  - Diseñar e incorporar pruebas de integración básicas para flujos críticos (creación de formulario, cierre de jornada y validación ARL).
  - Resolver hallazgos AUD de calidad y pruebas (e.g. AUD-022, AUD-023).
- **Dependencias:** Fases anteriores completadas.
- **Criterio de Cierre / Aceptación:**
  - `pnpm run lint` y `pnpm run format:check` retornan código de salida 0 en monorepo completo.
  - Aumento de cobertura de pruebas unitarias y suites de integración sin degradación de rendimiento.

---

### Fase 5: Preparación para Producción y Validación Final
**Objetivo:** Puesta a punto final del sistema para despliegue productivo, validación completa de la integración continua (CI) y auditoría de cierre.

- **Alcance / Tareas:**
  - Validar pipeline de GitHub Actions (`.github/workflows/ci.yml`) con todos los pasos en verde (Prisma, lint, build, test).
  - Comprobación de auditoría de seguridad y dependencias (`pnpm audit`).
  - Actualización de documentación técnica (`README.md`, `DEPLOYMENT_AND_BACKUPS.md`, `ENTORNO_LOCAL.md`).
  - Verificación final de integridad del flujo HSE-FO-016 (diligenciamiento, charla, firmas, PDF).
- **Dependencias:** Fases 1 a 4 aprobadas por el orquestador.
- **Criterio de Cierre / Aceptación:**
  - Pipeline de CI en verde de forma autónoma.
  - Cierre y verificación del 100% de los hallazgos AUD-001 a AUD-023 y TEC-001 a TEC-007.
  - Pull request final listo para revisión de producción.
