#!/usr/bin/env bash
# Despliega en el VPS una versión ya publicada en GHCR y vuelve a la anterior si
# el healthcheck falla. Lo invoca .github/workflows/deploy.yml por SSH; también
# sirve a mano desde el directorio de la aplicación: bash scripts/deploy.sh TAG
set -euo pipefail

if [[ $# -ne 1 || ! $1 =~ ^[A-Za-z0-9_.-]+$ ]]; then
  echo "Uso: $0 IMAGE_TAG" >&2
  exit 2
fi
tag=$1
cd "$(dirname "$0")/.."

test -f .env || { echo 'Falta .env en el directorio de la aplicación.' >&2; exit 1; }
grep -q '^COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml' .env || {
  echo 'Defina COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml en .env' >&2
  exit 1
}

health_url="http://127.0.0.1:8080/api/health"

set_tag() {
  if grep -q '^IMAGE_TAG=' .env; then
    sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$1/" .env
  else
    printf '\nIMAGE_TAG=%s\n' "$1" >> .env
  fi
}

# La API aplica migraciones al arrancar, así que puede tardar más que un reinicio.
healthy() {
  for _ in $(seq 1 40); do
    curl -fsS -o /dev/null "$health_url" && return 0
    sleep 3
  done
  return 1
}

previous=$(sed -n 's/^IMAGE_TAG=//p' .env)

# Se descarga antes de tocar nada: si el pull falla, la versión actual sigue en pie.
IMAGE_TAG="$tag" docker compose pull api web

# Respaldo previo a las migraciones; en el primer despliegue no hay nada que respaldar.
if [[ -n $previous ]] && [[ -n $(docker compose ps -q --status running postgres) ]]; then
  bash scripts/backup.sh "${BACKUP_DIR:-$HOME/sgsst-backups}"
fi

set_tag "$tag"
docker compose up -d --no-build --remove-orphans

if healthy; then
  echo "Desplegado $tag (anterior: ${previous:-ninguno})"
  docker image prune -f >/dev/null
  exit 0
fi

echo "El healthcheck falló con $tag." >&2
docker compose logs --tail=100 api >&2 || true

if [[ -z $previous || $previous == "$tag" ]]; then
  echo 'No hay versión anterior a la que volver.' >&2
  exit 1
fi

# Las migraciones ya aplicadas no se revierten: si la versión anterior no arranca
# con el esquema nuevo, restaure el respaldo recién creado (DEPLOYMENT_AND_BACKUPS.md).
echo "Volviendo a $previous..." >&2
set_tag "$previous"
docker compose up -d --no-build --remove-orphans
if healthy; then
  echo "Rollback a $previous completado." >&2
else
  echo "El rollback a $previous también falló: revise logs y el respaldo previo." >&2
fi
exit 1
