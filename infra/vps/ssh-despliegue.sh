#!/usr/bin/env bash
# Comando forzado de la llave SSH de GitHub Actions en ~/.ssh/authorized_keys:
#   command="/opt/sgsst/bin/ssh-despliegue.sh",restrict ssh-ed25519 AAAA... github-actions-sgsst
# Con esa llave solo se pueden ejecutar estas órdenes: sin terminal, sin reenvío
# de puertos y sin copiar archivos. La llave no puede modificar este script, los
# Compose ni scripts/deploy.sh; esos los actualiza un administrador.
set -euo pipefail

DIR=/opt/sgsst
read -r -a ARGS <<< "${SSH_ORIGINAL_COMMAND:-}"

case "${ARGS[0]:-}" in
  login-ghcr)
    # El token llega por la entrada estándar y es el temporal del job de GitHub.
    [[ ${#ARGS[@]} -eq 2 && "${ARGS[1]}" =~ ^[A-Za-z0-9-]{1,39}$ ]] || { echo "Uso: login-ghcr <usuario>" >&2; exit 64; }
    docker login ghcr.io -u "${ARGS[1]}" --password-stdin
    ;;
  logout-ghcr)
    docker logout ghcr.io
    ;;
  desplegar)
    [[ ${#ARGS[@]} -eq 2 && "${ARGS[1]}" =~ ^[0-9a-f]{40}$ ]] || { echo "Uso: desplegar <sha del commit>" >&2; exit 64; }
    exec bash "$DIR/scripts/deploy.sh" "${ARGS[1]}"
    ;;
  *)
    echo "Orden no permitida para esta llave" >&2
    exit 64
    ;;
esac
