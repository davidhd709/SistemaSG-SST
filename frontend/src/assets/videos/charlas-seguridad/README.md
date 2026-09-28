# Charlas de seguridad

Guarda aquí los videos que debe ver el colaborador antes de iniciar labores.

Usa formato MP4 y estos nombres:

- `charla-01.mp4`
- `charla-02.mp4`
- `charla-03.mp4`

La aplicación selecciona uno al azar en cada inicio del flujo. Para agregar o reemplazar videos, actualiza su ruta en `CHARLAS_DE_SEGURIDAD` (`src/app/features/forms/work-at-height-form.component.ts`), los identificadores permitidos (`backend/src/submissions/dto/safety-talk-challenge.dto.ts`) y la duración mínima y SHA-256 del archivo (`backend/src/submissions/submissions.service.ts`). No sustituyas una charla existente sin conservar la versión anterior si ya hay permisos que la citan.
