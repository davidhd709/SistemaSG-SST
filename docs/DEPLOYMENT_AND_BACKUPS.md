# Despliegue y backups

## Producción en Ubuntu

1. Instale Docker Engine y el plugin Docker Compose.
2. Clone el repositorio, cree `.env` desde `.env.example` y asigne secretos largos y únicos para PostgreSQL, JWT y `SAFETY_TALK_JWT_SECRET`. La clave de la charla debe ser distinta de las claves JWT de acceso y renovación.
3. Configure el dominio en DNS y defina `API_CORS_ORIGIN` con el origen HTTPS real.
4. Para almacenamiento privado, defina todas las variables R2. Si no se definen, la API usa disco local, opción no recomendada para producción.
5. Ejecute `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build` y ejecute el seed en el primer despliegue mediante un procedimiento controlado. La API aplica las migraciones al iniciar; la migración `20260928000000_collaborator_manage_permission` concede el nuevo permiso a los roles ADMIN y ARL_MANAGER existentes. El override de producción activa la auditoría y marca la cookie de refresco como `Secure`.
6. Publique Nginx con TLS. Certbot/Let's Encrypt debe renovar el certificado automáticamente; pruebe la renovación con `certbot renew --dry-run`.

Los puertos de PostgreSQL, Redis, API y web están ligados a `127.0.0.1`; publique la web mediante un proxy HTTPS en el host. No exponga PostgreSQL, Redis ni el bucket R2 a internet. Restringa puertos con firewall y cambie las credenciales de bootstrap después de crear los usuarios reales.

La API usa `TRUST_PROXY_HOPS=2` en producción para la cadena proxy HTTPS del host → Nginx web → API. El proxy del host debe añadir la IP real a `X-Forwarded-For` y no aceptar cabeceras del cliente como fuente confiable. Si cambia el número de proxies, ajuste la variable (0, 1 o 2) antes de desplegar. Mantenga la API sin exposición pública directa.

## Backups

- Desde la raíz del repositorio, ejecute `bash scripts/backup.sh /ruta/privada/backups`. El script crea un `pg_dump` en formato custom, copia los archivos del volumen local y escribe `SHA256SUMS`. Use `STORAGE_BACKEND=r2` para copiar el bucket R2; exporte antes `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY`, e instale AWS CLI. El respaldo no borra objetos del origen.
- Restrinja el directorio de respaldo, cifre la copia antes de enviarla fuera del VPS y conserve una copia fuera del servidor. El script usa permisos privados (`umask 077`), pero no cifra por sí solo. Para una copia coherente, suspenda nuevas escrituras mientras respalda base y archivos.
- Antes de usar una copia, ejecute `bash scripts/verify-restore.sh /ruta/privada/backups/sgsst-AAAAMMDDTHHMMSSZ`. Verifica checksums y restaura el volcado en un PostgreSQL 18 temporal, sin conectarse a la base de la aplicación. El contenedor de prueba se elimina al terminar.
- Conserve copias diarias durante 30 días, semanales durante 12 semanas y mensuales conforme a la política legal aprobada.
- Los archivos R2 requieren versionado/retención según la política documental; no active borrado automático de históricos sin autorización.
- Pruebe mensualmente una restauración en un entorno aislado: base de datos, archivos y acceso a una muestra de PDFs.
- Registre responsable, fecha, resultado y duración de cada prueba de restauración.

### Restauración operativa

1. Detenga las escrituras de la aplicación, respalde el estado actual y verifique la copia elegida con `scripts/verify-restore.sh`.
2. Restaure el volcado en el PostgreSQL del entorno elegido: `docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < /ruta/backup/database.dump`. **Este comando sustituye datos del destino**; ensáyelo primero en un entorno aislado.
3. Para almacenamiento local, copie `files/` al volumen de la API con `docker compose cp /ruta/backup/files/. api:/app/backend/storage/`. Para R2, sincronice la carpeta `files/` hacia el bucket con AWS CLI y el endpoint R2, sin `--delete`.
4. Arranque la aplicación y compruebe login, un envío y la descarga de una muestra de PDFs. Conserve el registro de la prueba y del respaldo utilizado.

**Prueba aislada del 20/10/2026:** un Compose temporal con PostgreSQL 18 y un archivo de evidencia produjo un respaldo con `scripts/backup.sh`; `scripts/verify-restore.sh` verificó ambos checksums y restauró 1 tabla pública en otro PostgreSQL temporal. Los contenedores de prueba se retiraron. Queda pendiente repetir el procedimiento con una copia real del entorno de despliegue.

## Operación

La generación de PDF es síncrona solo para desarrollo. Antes de producción, migre el disparo a BullMQ/Redis y supervise errores de Chromium, capacidad de disco/R2, disponibilidad de PostgreSQL y restauraciones.
