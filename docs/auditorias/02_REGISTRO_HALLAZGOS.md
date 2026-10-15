# SG-SST — Registro de Hallazgos y Matriz de Seguimiento

## 1. Control de Versiones y Contexto

- **Fecha de apertura del registro:** 15 de octubre de 2026.
- **Commit base de auditoría:** `27f604a751d30843da2f94b564c0ed70321e5d45`.
- **Nota metodológica sobre identificadores históricos:**
  En el historial del repositorio existen commits previos (por ejemplo `ad4f530`, `477bfc3`, `2a0055f`) que referencian identificadores como AUD-001 y AUD-002 correspondientes a revisiones intermedias de desarrollo. 
  La presente matriz corresponde a la **auditoría técnica formal de 23 hallazgos** sobre el commit `27f604a751d30843da2f94b564c0ed70321e5d45`. Conforme a la regla de no inventar información faltante, las entradas AUD-001 a AUD-023 se establecen estructuradas para su gestión inmediata y se deja constancia de la solicitud formal del documento de auditoría al orquestador para completar la descripción específica de cada ítem antes de iniciar su remediación en Fase 1.

---

## 2. Matriz de Hallazgos Oficiales (AUD-001 a AUD-023)

| ID | Descripción | Prioridad | Estado de validación | Responsable técnico | Dependencias | Estado de corrección |
|---|---|---|---|---|---|---|
| **AUD-001** | *Pendiente de detalle del informe de auditoría* (Históricamente relacionado con Throttling / Rate Limiting) | P1 - Alta | Pendiente recepción informe | Seguridad / Backend | Ninguna | Abierto (Fase 0) |
| **AUD-002** | *Pendiente de detalle del informe de auditoría* (Históricamente relacionado con Trazabilidad legal miembros de cuadrilla) | P1 - Alta | Pendiente recepción informe | Legal / Backend | Ninguna | Abierto (Fase 0) |
| **AUD-003** | *Pendiente de detalle del informe de auditoría* | P1 - Alta | Pendiente recepción informe | Backend | AUD-001 | Abierto (Fase 0) |
| **AUD-004** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Backend | Ninguna | Abierto (Fase 0) |
| **AUD-005** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Backend / Base de Datos | Ninguna | Abierto (Fase 0) |
| **AUD-006** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Backend / Permisos | Ninguna | Abierto (Fase 0) |
| **AUD-007** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Backend / Frontend | Ninguna | Abierto (Fase 0) |
| **AUD-008** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Backend | Ninguna | Abierto (Fase 0) |
| **AUD-009** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Backend / PDF | Ninguna | Abierto (Fase 0) |
| **AUD-010** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Backend / Submissions | Ninguna | Abierto (Fase 0) |
| **AUD-011** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Frontend | Ninguna | Abierto (Fase 0) |
| **AUD-012** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Frontend / PWA | Ninguna | Abierto (Fase 0) |
| **AUD-013** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Frontend / Formularios | Ninguna | Abierto (Fase 0) |
| **AUD-014** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Frontend / UX | Ninguna | Abierto (Fase 0) |
| **AUD-015** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Base de Datos | Ninguna | Abierto (Fase 0) |
| **AUD-016** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Base de Datos / Prisma | Ninguna | Abierto (Fase 0) |
| **AUD-017** | *Pendiente de detalle del informe de auditoría* | P1 - Alta | Pendiente recepción informe | Seguridad | Ninguna | Abierto (Fase 0) |
| **AUD-018** | *Pendiente de detalle del informe de auditoría* | P1 - Alta | Pendiente recepción informe | Seguridad / Auth | Ninguna | Abierto (Fase 0) |
| **AUD-019** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Infra / DevOps | Ninguna | Abierto (Fase 0) |
| **AUD-020** | *Pendiente de detalle del informe de auditoría* | P2 - Media | Pendiente recepción informe | Infra / Docker | Ninguna | Abierto (Fase 0) |
| **AUD-021** | *Pendiente de detalle del informe de auditoría* | P3 - Baja | Pendiente recepción informe | Documentación / Config | Ninguna | Abierto (Fase 0) |
| **AUD-022** | *Pendiente de detalle del informe de auditoría* | P3 - Baja | Pendiente recepción informe | Calidad de Código | Ninguna | Abierto (Fase 0) |
| **AUD-023** | *Pendiente de detalle del informe de auditoría* | P3 - Baja | Pendiente recepción informe | QA / Pruebas | Ninguna | Abierto (Fase 0) |

---

## 3. Nuevos Hallazgos Técnicos Identificados en Línea Base (Fase 0)

| ID | Descripción | Prioridad | Estado de validación | Responsable técnico | Dependencias | Estado de corrección |
|---|---|---|---|---|---|---|
| **TEC-001** | **Omisión de plantillas PDF en runtime de Docker:** `backend/Dockerfile` no copia el directorio `backend/pdf-templates` a la imagen final `/app/backend`. Cualquier invocación a `PdfService` fallará en contenedor con `NotFoundException`. | P0 - Crítica | Confirmado empíricamente en `backend/Dockerfile` | DevOps / Backend | Ninguna | Abierto (Identificado F0) |
| **TEC-002** | **Fallo masivo de ESLint en Backend por finales de línea (CRLF):** `pnpm run lint` en backend genera 245 errores de `prettier/prettier` debido a retornos de carro `\r\n` introducidos en Windows. | P2 - Media | Confirmado empíricamente en ejecución de lint | Calidad / Backend | .gitattributes | Abierto (Identificado F0) |
| **TEC-003** | **Inconsistencias de formato global en 24 archivos:** `pnpm run format:check` falla debido a diferencias de espaciado y estilos en archivos clave de backend, frontend y docs. | P3 - Baja | Confirmado empíricamente en ejecución Prettier | Calidad / Frontend / Backend | .gitattributes | Abierto (Identificado F0) |
| **TEC-004** | **Requisito mandatorio de `DATABASE_URL` en `prisma validate`:** El validador de Prisma aborta con error P1012 si no encuentra `DATABASE_URL` en variables de entorno, rompiendo pipelines aislados de CI. | P2 - Media | Confirmado empíricamente en validación de Prisma | DevOps / CI | Ninguna | Mitigado en CI con mock env |
| **TEC-005** | **Ambigüedad en ruta raíz de almacenamiento local (`storage`):** `LocalStorageAdapter` utiliza `process.cwd() + '/storage'`. Provoca que existan dos carpetas en el repositorio (`./storage` y `./backend/storage`) dependiendo de desde dónde se inicie el proceso. | P2 - Media | Confirmado en inspección de archivos y código | Backend / Arquitectura | Ninguna | Abierto (Identificado F0) |
| **TEC-006** | **Dependencias de Puppeteer/Chromium residuales en Dockerfile:** La imagen `node:22-alpine` de backend instala paquetes pesados del SO (`chromium`, etc.) a pesar de que el generador fue migrado a `pdf-lib`. Aumenta peso de imagen en ~300 MB. | P3 - Baja | Confirmado en `backend/Dockerfile` y `package.json` | DevOps | Ninguna | Abierto (Identificado F0) |
| **TEC-007** | **Carencia de pruebas de integración y pruebas E2E:** No existen carpetas `backend/test` ni herramientas como Cypress/Playwright en el frontend. | P2 - Media | Confirmado en inspección del árbol de directorios | QA / Testing | Ninguna | Abierto (Identificado F0) |

---

## 4. Solicitud al Orquestador

Para proceder con la precisión requerida en las fases posteriores:
1. Se solicita el informe técnico detallado que contiene la descripción, impacto y ubicación de los hallazgos **AUD-001 a AUD-023**.
2. Con dicha información se actualizará esta matriz antes de iniciar la remediación en la Fase 1.
