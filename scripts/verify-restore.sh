#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Uso: $0 DIRECTORIO_BACKUP" >&2
  exit 2
fi
backup=$(realpath -- "$1")
test -s "$backup/database.dump"
test -f "$backup/SHA256SUMS"
(cd "$backup" && sha256sum -c SHA256SUMS)

# Contenedor temporal aislado; no se conecta al Compose de la aplicación.
container="sgsst-restore-check-$$"
docker run -d --rm --name "$container" \
  -e POSTGRES_USER=restore_check -e POSTGRES_PASSWORD=restore_check \
  -e POSTGRES_DB=restore_check -v "$backup:/backup:ro" postgres:18-alpine >/dev/null
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in {1..30}; do
  if docker exec "$container" pg_isready -U restore_check -d restore_check >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
test "$ready" -eq 1 || { echo 'PostgreSQL de prueba no inició.' >&2; exit 1; }

docker exec "$container" pg_restore --exit-on-error --no-owner --no-acl \
  -U restore_check -d restore_check /backup/database.dump
tables=$(docker exec "$container" psql -U restore_check -d restore_check -Atqc \
  "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
test "$tables" -gt 0 || { echo 'La restauración no produjo tablas públicas.' >&2; exit 1; }
echo "Restauración verificada: $tables tablas públicas y checksums correctos."
