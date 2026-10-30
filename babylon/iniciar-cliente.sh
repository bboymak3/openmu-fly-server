#!/bin/bash
# Inicia BarrioMU en la tablet:
#   - proxy del juego         puerto 3000
#   - servicio de registro    puerto 3100 (solo dentro de la tablet)
#   - pagina del juego        puerto 8081
#   - pagina de registro      puerto 8082
# OpenMU y PostgreSQL tienen que estar corriendo en la misma tablet.
cd "$(dirname "$0")"
BASE="$PWD"
mkdir -p "$BASE/data"

export TRACK_DB_PATH="${TRACK_DB_PATH:-memory}"
export LOG_PACKETS="${LOG_PACKETS:-off}"

# El proxy exige puerto exacto para direcciones internas: Connect Servers,
# Game Servers y chat de OpenMU, en loopback.
if [ -z "$ALLOW_TARGETS" ]; then
  for h in 127.0.0.1 127.127.127.127; do
    for p in 44405 44406 45901 45902 45903 45904 45905 45906 45980; do
      ALLOW_TARGETS="$ALLOW_TARGETS,$h:$p"
    done
  done
  ALLOW_TARGETS="${ALLOW_TARGETS#,}"
fi
export ALLOW_TARGETS

PIDS=()
trap 'kill "${PIDS[@]}" 2>/dev/null' EXIT

(cd proxy && exec ./bun proxy/main.ts) &
PIDS+=($!)

if [ -d register ]; then
  (cd proxy && RATE_DB_PATH="$BASE/data/signups.sqlite" \
    CORS_ORIGIN="${CORS_ORIGIN:-https://mu.makeseo.app}" \
    exec ./bun register/server/main.ts) &
  PIDS+=($!)

  ROOT="$BASE/register" FALLBACK_ROOT="$BASE/client" PORT=8082 \
    API_TARGET=http://127.0.0.1:3100 ./mu-servir &
  PIDS+=($!)
fi

echo "En el celular abre: http://IP-DE-LA-TABLET:8081"
ROOT="$BASE/client" PORT="${PORT:-8081}" API_TARGET=http://127.0.0.1:3100 ./mu-servir
