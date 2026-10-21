#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 ]]; then
  echo "Uso: STORAGE_BACKEND=local|r2 $0 DIRECTORIO_DESTINO" >&2
  exit 2
fi

destination=$(realpath -m -- "$1")
mkdir -p -- "$destination"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup="$destination/sgsst-$stamp"
temporary=$(mktemp -d "$destination/.sgsst-$stamp.XXXXXX")
trap 'rm -rf -- "$temporary"' EXIT
mkdir -p "$temporary/files"

# Las credenciales de PostgreSQL permanecen dentro del contenedor.
docker compose exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$temporary/database.dump"
test -s "$temporary/database.dump"

case "${STORAGE_BACKEND:-local}" in
  local)
    docker compose cp api:/app/backend/storage/. "$temporary/files"
    ;;
  r2)
    : "${R2_ENDPOINT:?Configure R2_ENDPOINT}"
    : "${R2_BUCKET:?Configure R2_BUCKET}"
    : "${R2_ACCESS_KEY_ID:?Configure R2_ACCESS_KEY_ID}"
    : "${R2_SECRET_ACCESS_KEY:?Configure R2_SECRET_ACCESS_KEY}"
    command -v aws >/dev/null || { echo 'Se requiere AWS CLI para respaldar R2.' >&2; exit 1; }
    export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
    aws --endpoint-url "$R2_ENDPOINT" s3 sync "s3://$R2_BUCKET/" "$temporary/files/" --no-progress
    ;;
  *)
    echo 'STORAGE_BACKEND debe ser local o r2.' >&2
    exit 2
    ;;
esac

printf 'created_utc=%s\nstorage_backend=%s\n' "$stamp" "${STORAGE_BACKEND:-local}" > "$temporary/metadata.txt"
(cd "$temporary" && find database.dump files -type f -exec sha256sum {} +) > "$temporary/SHA256SUMS"
test ! -e "$backup" || { echo "Ya existe $backup" >&2; exit 1; }
mv -- "$temporary" "$backup"
trap - EXIT
echo "$backup"
