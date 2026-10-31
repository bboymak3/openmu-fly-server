#!/data/data/com.termux/files/usr/bin/bash
# BarrioMU: prende, apaga y revisa todo con un solo comando.
# Se usa en Termux normal (~ $), NO dentro de Ubuntu.
#
#   bash ~/barriomu.sh prender     PostgreSQL, OpenMU, cliente y tunel
#   bash ~/barriomu.sh apagar      apaga todo
#   bash ~/barriomu.sh estado      que esta prendido y que no
#   bash ~/barriomu.sh logs        muestra lo que va pasando (CTRL+C para salir)
#   bash ~/barriomu.sh reset-db    BORRA la base de datos y la crea de nuevo
#   bash ~/barriomu.sh arranque    prende BarrioMU solo al encender la tablet
#                                  (necesita la app Termux:Boot)
#
# Al prender tambien arranca un vigilante que cada 5 minutos revisa que todo
# siga prendido y vuelve a prender lo que se haya caido.

PGDATA="$PREFIX/var/lib/postgresql"
LOGS="$HOME/barriomu-logs"
TOKEN="$HOME/.barriomu-token"
WATCHDOG_PID="$LOGS/vigilante.pid"
mkdir -p "$LOGS"

command -v pgrep >/dev/null || pkg install -y procps >/dev/null

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

wait_port() {
  local port=$1 name=$2 secs=${3:-180}
  printf '   esperando %s' "$name"
  for ((i = 0; i < secs; i += 3)); do
    if port_open "$port"; then echo " listo"; return 0; fi
    printf '.'; sleep 3
  done
  echo " NO RESPONDE (revisa: bash ~/barriomu.sh logs)"
  return 1
}

# Corre un comando dentro de Ubuntu, en segundo plano, con su log.
in_ubuntu() {
  local log=$1 cmd=$2
  nohup proot-distro login ubuntu -- bash -c "$cmd" </dev/null >"$LOGS/$log" 2>&1 &
}

start_openmu() {
  in_ubuntu openmu.log "cd ~/openmu && exec ./iniciar.sh -autostart -deamon -resolveIP:loopback $1"
}

prender() {
  termux-wake-lock 2>/dev/null

  echo "1) PostgreSQL"
  if pg_ctl -D "$PGDATA" status >/dev/null 2>&1; then echo "   ya estaba prendido"
  else pg_ctl -D "$PGDATA" -l "$PGDATA/log.txt" -w start >/dev/null && echo "   prendido"; fi

  echo "2) OpenMU"
  if pgrep -f MUnique.OpenMU.Startup >/dev/null; then echo "   ya estaba prendido"
  else start_openmu ""; wait_port 44405 OpenMU 600; fi

  echo "3) Cliente BarrioMU (pagina, proxy y registro)"
  if pgrep -f proxy/main.ts >/dev/null; then echo "   ya estaba prendido"
  else in_ubuntu cliente.log "cd ~/babylon && exec ./iniciar-cliente.sh"; wait_port 3000 proxy 120; fi

  echo "4) Tunel de Cloudflare"
  if pgrep -f "cloudflared tunnel run" >/dev/null; then echo "   ya estaba prendido"
  else
    nohup cloudflared tunnel run --token "$(cat "$TOKEN")" </dev/null >"$LOGS/tunel.log" 2>&1 &
    echo "   prendido"
  fi

  [ -n "$VIGILANTE" ] || start_watchdog

  echo
  echo "Listo: https://mu.makeseo.app"
}

watchdog_running() { [ -f "$WATCHDOG_PID" ] && kill -0 "$(cat "$WATCHDOG_PID")" 2>/dev/null; }

start_watchdog() {
  watchdog_running && return
  nohup bash "$0" vigilar </dev/null >>"$LOGS/vigilante.log" 2>&1 &
  echo $! >"$WATCHDOG_PID"
  echo "5) Vigilante prendido (revisa cada 5 minutos)"
}

stop_watchdog() {
  watchdog_running && kill "$(cat "$WATCHDOG_PID")" 2>/dev/null
  rm -f "$WATCHDOG_PID"
}

vigilar() {
  while true; do
    sleep 300
    echo "--- $(date '+%F %T') revisando"
    VIGILANTE=1 prender
  done
}

arranque() {
  mkdir -p "$HOME/.termux/boot"
  cat >"$HOME/.termux/boot/barriomu" <<'BOOT'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
sleep 30
bash ~/barriomu.sh prender >>~/barriomu-logs/arranque.log 2>&1
BOOT
  chmod +x "$HOME/.termux/boot/barriomu"
  echo "Listo: BarrioMU se prendera solo al encender la tablet."
  echo "Recuerda: instala la app Termux:Boot (F-Droid) y abrela una vez."
}

apagar() {
  echo "Apagando..."
  stop_watchdog
  pkill -f "cloudflared tunnel run"
  pkill -f proxy/main.ts; pkill -f register/server/main.ts; pkill -f mu-servir
  if pgrep -f MUnique.OpenMU.Startup >/dev/null; then
    pkill -TERM -f MUnique.OpenMU.Startup
    for ((i = 0; i < 30; i++)); do pgrep -f MUnique.OpenMU.Startup >/dev/null || break; sleep 1; done
    pkill -KILL -f MUnique.OpenMU.Startup 2>/dev/null
  fi
  pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1
  termux-wake-unlock 2>/dev/null
  echo "Todo apagado."
}

estado() {
  show() { if port_open "$1"; then echo "  [OK]  $2"; else echo "  [--]  $2"; fi; }
  show 5432 "PostgreSQL        (5432)"
  show 44405 "OpenMU            (44405)"
  show 8080 "Panel de admin    (8080)"
  show 3000 "Proxy del juego   (3000)"
  show 8081 "Pagina del juego  (8081)"
  show 8082 "Pagina registro   (8082)"
  if pgrep -f "cloudflared tunnel run" >/dev/null; then echo "  [OK]  Tunel Cloudflare"
  else echo "  [--]  Tunel Cloudflare"; fi
  if watchdog_running; then echo "  [OK]  Vigilante"; else echo "  [--]  Vigilante"; fi
}

reset_db() {
  echo "ATENCION: esto BORRA todas las cuentas, personajes y ajustes del panel,"
  echo "y crea de nuevo la base con barrio01..barrio10."
  read -r -p "Escribe SI para continuar: " ok
  [ "$ok" = "SI" ] || { echo "Cancelado."; return 1; }
  stop_watchdog
  pkill -f proxy/main.ts; pkill -f register/server/main.ts; pkill -f mu-servir
  pkill -TERM -f MUnique.OpenMU.Startup; sleep 5; pkill -KILL -f MUnique.OpenMU.Startup 2>/dev/null
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || pg_ctl -D "$PGDATA" -l "$PGDATA/log.txt" -w start >/dev/null
  echo "Creando la base de datos (en la tablet tarda varios minutos)..."
  start_openmu "-reinit"
  wait_port 44405 OpenMU 1200 && prender
}

case "$1" in
  prender) prender ;;
  apagar) apagar ;;
  estado) estado ;;
  logs) tail -n 30 -f "$LOGS"/*.log ;;
  reset-db) reset_db ;;
  arranque) arranque ;;
  vigilar) vigilar ;;
  *) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
