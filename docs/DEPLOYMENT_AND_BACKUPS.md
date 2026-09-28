# Despliegue y backups

## Producción en Ubuntu

1. Instale Docker Engine y el plugin Docker Compose.
2. Clone el repositorio, cree `.env` desde `.env.example` y asigne secretos largos y únicos para PostgreSQL y JWT.
3. Configure el dominio en DNS y defina `API_CORS_ORIGIN` con el origen HTTPS real.
4. Para almacenamiento privado, defina todas las variables R2. Si no se definen, la API usa disco local, opción no recomendada para producción.
5. Ejecute `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` y ejecute el seed en el primer despliegue mediante un procedimiento controlado. La API aplica las migraciones al iniciar; la migración `20260928000000_collaborator_manage_permission` concede el nuevo permiso a los roles ADMIN y ARL_MANAGER existentes. El override de producción activa la auditoría y marca la cookie de refresco como `Secure`.
6. Publique Nginx con TLS. Certbot/Let's Encrypt debe renovar el certificado automáticamente; pruebe la renovación con `certbot renew --dry-run`.

Los puertos de PostgreSQL, Redis, API y web están ligados a `127.0.0.1`; publique la web mediante un proxy HTTPS en el host. No exponga PostgreSQL, Redis ni el bucket R2 a internet. Restringa puertos con firewall y cambie las credenciales de bootstrap después de crear los usuarios reales.

## Backups

- Realice `pg_dump` cifrado diariamente y conserve una copia fuera del VPS.
- Conserve copias diarias durante 30 días, semanales durante 12 semanas y mensuales conforme a la política legal aprobada.
- Los archivos R2 requieren versionado/retención según la política documental; no active borrado automático de históricos sin autorización.
- Pruebe mensualmente una restauración en un entorno aislado: base de datos, archivos y acceso a una muestra de PDFs.
- Registre responsable, fecha, resultado y duración de cada prueba de restauración.

## Operación

La generación de PDF es síncrona solo para desarrollo. Antes de producción, migre el disparo a BullMQ/Redis y supervise errores de Chromium, capacidad de disco/R2, disponibilidad de PostgreSQL y restauraciones.
