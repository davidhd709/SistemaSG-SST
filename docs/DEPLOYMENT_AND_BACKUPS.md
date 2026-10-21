# Despliegue y backups

## Flujo local → GitHub → VPS

```
local ──push/merge──▶ main ──CI SG-SST (lint, build, tests)──▶ Deploy SG-SST
                                                                  │ build + push a GHCR
                                                                  │   ghcr.io/davidhd709/sistemasg-sst-{api,web}:<sha>
                                                                  ▼ SSH al VPS
                                                     scripts/deploy.sh <sha>
                                                     pull → backup → up → healthcheck
                                                                  └─ si falla: vuelve al tag anterior
```

- Solo se despliega `main` y solo si el CI pasó. Las ramas `fix/**`, `feat/**`, etc. corren el CI, pero no despliegan.
- Cada versión es una imagen inmutable etiquetada con el SHA completo del commit. El VPS no compila y solo descarga.
- La llave de GitHub Actions está limitada en el VPS a [`infra/vps/ssh-despliegue.sh`](../infra/vps/ssh-despliegue.sh). Solo acepta `login-ghcr`, `logout-ghcr` y `desplegar <sha>`: no abre terminal ni copia archivos. Por eso los Compose y los scripts del VPS los actualiza un administrador (ver _Actualizar archivos del VPS_).
- `.github/workflows/deploy.yml` solo se activa por `workflow_run` cuando el archivo existe en `main`.

### Servidor de producción

| Dato        | Valor                                                               |
| ----------- | ------------------------------------------------------------------- |
| VPS         | `opainn-vps` (167.86.110.8), Ubuntu 24.04, compartido con SIVUP     |
| Dominio     | `sst.opainn.com` → registro A hacia 167.86.110.8                    |
| Usuario     | `henry` (grupo `docker`)                                            |
| Directorio  | `/opt/sgsst` (Compose project `sgsst`)                              |
| Proxy HTTPS | Nginx del host + Certbot → `127.0.0.1:8080`                         |
| Sitio Nginx | [`infra/vps/sst.opainn.com.conf`](../infra/vps/sst.opainn.com.conf) |
| Firewall    | UFW: solo 22, 80 y 443                                              |

SIVUP usa `127.0.0.1:8081` y su propio proyecto Compose. Los dos sistemas no comparten base de datos, volúmenes ni puertos.

### Preparación del VPS (una sola vez)

Requisitos: Docker Engine con Compose 2.24 o superior y `curl`.

1. Con `sudo`, cree el directorio y el sitio Nginx. Emita el certificado cuando el DNS ya resuelva:
   ```bash
   sudo install -d -o henry -g henry -m 750 /opt/sgsst
   sudo cp sst.opainn.com.conf /etc/nginx/sites-available/sst.opainn.com
   sudo ln -s /etc/nginx/sites-available/sst.opainn.com /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d sst.opainn.com
   ```
2. Copie los archivos de despliegue (ver _Actualizar archivos del VPS_).
3. Cree `/opt/sgsst/.env` desde `.env.example` con `chmod 600`. Genere los secretos en el propio VPS con `openssl rand -base64 48`. `SAFETY_TALK_JWT_SECRET` debe ser distinto de las dos claves JWT. Defina además:
   ```
   NODE_ENV=production
   API_CORS_ORIGIN=https://sst.opainn.com
   COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
   ```
4. Genere una llave exclusiva para GitHub Actions: `ssh-keygen -t ed25519 -C github-actions-sgsst -N '' -f sgsst_deploy`. Añádala a `~henry/.ssh/authorized_keys` limitada al comando forzado:
   ```
   command="/opt/sgsst/bin/ssh-despliegue.sh",restrict ssh-ed25519 AAAA... github-actions-sgsst
   ```

GHCR es privado. El workflow inicia sesión en el VPS con el token temporal del job y la cierra al terminar, así que no queda ningún PAT en el servidor.

### Actualizar archivos del VPS

Cuando cambien `docker-compose*.yml`, `scripts/*.sh` o `infra/vps/ssh-despliegue.sh`, un administrador los copia antes de desplegar desde un equipo con acceso de administrador:

```bash
scp docker-compose.yml docker-compose.prod.yml opainn:/opt/sgsst/
ssh opainn 'mkdir -p /opt/sgsst/scripts /opt/sgsst/bin'
scp scripts/deploy.sh scripts/backup.sh scripts/verify-restore.sh opainn:/opt/sgsst/scripts/
scp infra/vps/ssh-despliegue.sh opainn:/opt/sgsst/bin/
ssh opainn 'chmod 750 /opt/sgsst/bin/ssh-despliegue.sh /opt/sgsst/scripts/*.sh'
```

### Configuración en GitHub (una sola vez)

En _Settings → Environments_ cree el entorno `production`. Puede exigir aprobación manual con _Required reviewers_. Dentro de ese entorno añada:

| Tipo     | Nombre            | Valor                                                                  |
| -------- | ----------------- | ---------------------------------------------------------------------- |
| Secret   | `VPS_HOST`        | `167.86.110.8`                                                         |
| Secret   | `VPS_USER`        | `henry`                                                                |
| Secret   | `VPS_SSH_KEY`     | Contenido de la clave privada `sgsst_deploy`                           |
| Secret   | `VPS_KNOWN_HOSTS` | Salida de `ssh-keyscan 167.86.110.8`, verificada contra la huella real |
| Variable | `VPS_PORT`        | Opcional, por defecto `22`                                             |

Después de copiarla a GitHub, borre la clave privada local.

### Primer despliegue

1. Haga merge a `main`. Al terminar el CI, _Deploy SG-SST_ construye, publica y despliega.
2. Ejecute el seed una sola vez en el VPS, con credenciales de bootstrap temporales:
   ```bash
   cd /opt/sgsst
   docker compose run --rm -e BOOTSTRAP_ADMIN_EMAIL=... -e BOOTSTRAP_ADMIN_PASSWORD=... api node dist-seed/seed.js
   ```
   La API aplica las migraciones al iniciar. El seed sincroniza los permisos vigentes con los roles iniciales. Cambie las credenciales de bootstrap después de crear los usuarios reales.
3. Compruebe `https://sst.opainn.com/api/health` y haga login.

### Actualizaciones y rollback

- **Actualizar:** haga merge a `main`. `scripts/deploy.sh` descarga las imágenes nuevas. Si ya había una versión corriendo, ejecuta `scripts/backup.sh` en `$BACKUP_DIR` (por defecto `~/sgsst-backups`). Luego levanta los servicios y espera a que `/api/health` responda en `127.0.0.1:8080`.
- **Rollback automático:** si el healthcheck falla, el script vuelve al `IMAGE_TAG` anterior y el job termina en rojo.
- **Rollback manual:** en _Actions → Deploy SG-SST → Run workflow_ indique en `image_tag` el SHA completo de una versión anterior (`cat /opt/sgsst/.env | grep IMAGE_TAG` muestra la actual). También puede ejecutar `bash scripts/deploy.sh <sha>` en `/opt/sgsst`.
- **Migraciones:** el rollback cambia las imágenes, pero no revierte las migraciones aplicadas. Si la versión anterior no es compatible con el esquema nuevo, restaure el respaldo creado justo antes del despliegue (ver _Restauración operativa_). Prefiera migraciones aditivas.
- **Logs:** use `docker compose logs -f api` desde `/opt/sgsst`. Los logs de los contenedores rotan a 5 × 10 MB por servicio.
- **Imágenes antiguas:** las imágenes etiquetadas se acumulan en el VPS. Revise de vez en cuando `docker image ls ghcr.io/davidhd709/*` y borre las que ya no necesite para rollback.

Los puertos de PostgreSQL, API y web están ligados a `127.0.0.1`. Publique la web mediante el proxy HTTPS del host. No exponga PostgreSQL ni el bucket R2 a internet. Por ahora los archivos se guardan en el volumen `api_storage` del VPS. Por eso los respaldos deben copiarse fuera del servidor.

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

La generación de PDF es síncrona y usa `pdf-lib`; no requiere Chromium, Redis ni una cola. Supervise fallos de generación, capacidad de disco/R2, disponibilidad de PostgreSQL y restauraciones. Si un envío `CLOSED` o `REJECTED` queda sin archivo, Coordinación puede regenerarlo mediante `POST /api/coordination/submissions/:id/generate-pdf` y la acción queda auditada.
