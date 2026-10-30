#!/bin/bash
# Inicia el cliente Babylon en la tablet: el proxy (puerto 3000) y la pagina web (puerto 8081).
# OpenMU tiene que estar corriendo en la misma tablet.
cd "$(dirname "$0")"

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

(cd proxy && exec ./bun proxy/main.ts) &
PROXY_PID=$!
trap 'kill $PROXY_PID 2>/dev/null' EXIT

echo "En el celular abre: http://IP-DE-LA-TABLET:8081"
ROOT="$PWD/client" PORT="${PORT:-8081}" ./mu-servir
