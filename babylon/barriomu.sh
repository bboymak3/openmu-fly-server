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
#   bash ~/barriomu.sh panel on    prende el panel de admin (reinicia OpenMU)
#   bash ~/barriomu.sh panel off   lo apaga para ahorrar memoria (reinicia OpenMU)
#   bash ~/barriomu.sh resets      activa los resets de BarrioMU (reinicia OpenMU)
#
# Al prender tambien arranca un vigilante que cada 5 minutos revisa que todo
# siga prendido y vuelve a prender lo que se haya caido.

PGDATA="$PREFIX/var/lib/postgresql"
LOGS="$HOME/barriomu-logs"
TOKEN="$HOME/.barriomu-token"
WATCHDOG_PID="$LOGS/vigilante.pid"
PANEL_STATE="$LOGS/panel"

# Memoria de .NET para OpenMU: limite de 1.5 GB (antes 7 GB) y modo ahorro,
# que devuelve memoria al sistema mas seguido.
DOTNET_MEM="DOTNET_GCHeapHardLimit=0x60000000 DOTNET_GCConserveMemory=5"
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

# El panel de admin es lo que mas memoria usa despues del juego: va apagado
# salvo que se pida con 'panel on'.
panel_arg() { [ "$(cat "$PANEL_STATE" 2>/dev/null)" = on ] || echo "-adminpanel:disabled"; }

start_openmu() {
  in_ubuntu openmu.log "cd ~/openmu && $DOTNET_MEM exec ./iniciar.sh -autostart -deamon -resolveIP:loopback $(panel_arg) $1"
}

stop_openmu() {
  pgrep -f MUnique.OpenMU.Startup >/dev/null || return 0
  pkill -TERM -f MUnique.OpenMU.Startup
  for ((i = 0; i < 30; i++)); do pgrep -f MUnique.OpenMU.Startup >/dev/null || return 0; sleep 1; done
  pkill -KILL -f MUnique.OpenMU.Startup 2>/dev/null
}

panel() {
  case "$1" in
    on | off) echo "$1" >"$PANEL_STATE" ;;
    *) echo "Uso: bash ~/barriomu.sh panel on|off"; return 1 ;;
  esac
  stop_watchdog
  echo "Reiniciando OpenMU con el panel $1 (los jugadores se desconectan un momento)..."
  stop_openmu
  start_openmu ""
  wait_port 44405 OpenMU 600
  [ "$1" = on ] && wait_port 8080 "panel de admin" 300 && echo "Panel en http://localhost:8080"
  start_watchdog
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

# Reset de OpenMU (ResetFeaturePlugIn): nivel 400, sin limite, stats a cero,
# 1.500 puntos x reset, 1.000.000 de zen x reset, vuelve a nivel 1.
RESET_PLUGIN="6a9d585d-79d7-4674-b6ea-7e87392fa501"
RESET_CONFIG='{"RequiredLevel":400,"ResetLimit":null,"LevelAfterReset":1,"RequiredMoney":1000000,"MultiplyRequiredMoneyByResetCount":true,"ResetStats":true,"PointsPerReset":1500,"MultiplyPointsByResetCount":true,"ReplacePointsPerReset":true,"MoveHome":true,"LogOut":true}'

resets() {
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || { echo "PostgreSQL esta apagado: bash ~/barriomu.sh prender"; return 1; }
  echo "Activando resets..."
  psql -U postgres -d openmu -v ON_ERROR_STOP=1 -q <<SQL || { echo "No se pudo activar."; return 1; }
UPDATE config."PlugInConfiguration"
   SET "IsActive" = true,
       "CustomConfiguration" = (coalesce(nullif("CustomConfiguration", ''), '{}')::jsonb || '$RESET_CONFIG'::jsonb)::text
 WHERE "TypeId" = '$RESET_PLUGIN';
INSERT INTO config."PlugInConfiguration" ("Id", "GameConfigurationId", "TypeId", "IsActive", "CustomConfiguration")
SELECT gen_random_uuid(), (SELECT "Id" FROM config."GameConfiguration" LIMIT 1), '$RESET_PLUGIN', true, '$RESET_CONFIG'
 WHERE NOT EXISTS (SELECT 1 FROM config."PlugInConfiguration" WHERE "TypeId" = '$RESET_PLUGIN');
SQL
  echo "Listo. Reiniciando OpenMU para que lo lea (los jugadores se desconectan un momento)..."
  stop_watchdog
  stop_openmu
  start_openmu ""
  wait_port 44405 OpenMU 600
  start_watchdog
  echo "Resets activos: en el juego escribe /reset (nivel 400)."
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
  pkill -f proxy/main.ts; pkill -f register/server/main.ts; pkill -f api/main.ts; pkill -f mu-servir
  stop_openmu
  pg_ctl -D "$PGDATA" -w stop >/dev/null 2>&1
  termux-wake-unlock 2>/dev/null
  echo "Todo apagado."
}

estado() {
  show() { if port_open "$1"; then echo "  [OK]  $2"; else echo "  [--]  $2"; fi; }
  show 5432 "PostgreSQL        (5432)"
  show 44405 "OpenMU            (44405)"
  if [ -z "$(panel_arg)" ]; then show 8080 "Panel de admin    (8080)"
  else echo "  [..]  Panel de admin    (apagado: bash ~/barriomu.sh panel on)"; fi
  show 3000 "Proxy del juego   (3000)"
  show 8081 "Pagina del juego  (8081)"
  show 8082 "Pagina registro   (8082)"
  show 3400 "API de la landing (3400)"
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
  pkill -f proxy/main.ts; pkill -f register/server/main.ts; pkill -f api/main.ts; pkill -f mu-servir
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
  panel) panel "$2" ;;
  resets) resets ;;
  vigilar) vigilar ;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
