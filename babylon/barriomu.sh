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
#   bash ~/barriomu.sh gm CUENTA   hace GM una cuenta (para el panel admin; con la cuenta fuera del juego)
#   bash ~/barriomu.sh cloudflare  guarda el token de Cloudflare del panel admin
#   bash ~/barriomu.sh npcs        lista los NPCs de las ciudades y cuantos estan apagados
#   bash ~/barriomu.sh npcs activar  vuelve a prender todos los NPCs y monstruos (reinicia OpenMU)
#   bash ~/barriomu.sh mapas       monstruos de Lorencia, portales y /move: que sirve y que esta roto
#   bash ~/barriomu.sh spot        repone los monstruos de Lorencia que falten y pone el spot
#                                  de las afueras (reinicia OpenMU)
#   bash ~/barriomu.sh spot quitar quita el spot de las afueras (reinicia OpenMU)
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

# El panel admin (barriomu.makeseo.app/admin.html) solo deja entrar cuentas GM.
# Ojo: en el juego la cuenta tambien queda como GM (comandos de GM y fuera de
# los rankings). Mejor usar una cuenta solo para administrar.
gm() {
  local cuenta=$1
  if ! [[ "$cuenta" =~ ^[A-Za-z0-9]{4,10}$ ]]; then
    echo "Uso: bash ~/barriomu.sh gm NOMBRE_DE_CUENTA   (de 4 a 10 letras o numeros)"; return 1
  fi
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || { echo "PostgreSQL esta apagado: bash ~/barriomu.sh prender"; return 1; }
  local n
  n=$(psql -U postgres -d openmu -tAq -c "UPDATE data.\"Account\" SET \"State\" = 2 WHERE lower(\"LoginName\") = lower('$cuenta') RETURNING 1" | grep -cx 1)
  if [ "$n" = 1 ]; then
    echo "Listo: la cuenta $cuenta ahora es GM. Si estaba dentro del juego, sal y vuelve a entrar."
  else
    echo "No existe la cuenta $cuenta."; return 1
  fi
}

# El token de Cloudflare del panel admin se guarda dentro de Ubuntu, donde corre
# la API (~/.barriomu-cloudflare). Nunca se manda a ningun lado: la API lo usa
# para leer las visitas y borrar la cache.
cloudflare() {
  echo "Pega el token de Cloudflare del panel admin y dale Enter (no se ve mientras lo pegas):"
  local token
  read -rs token; echo
  token=$(printf '%s' "$token" | tr -d '[:space:]')
  if ! [[ "$token" =~ ^[A-Za-z0-9_-]{20,}$ ]]; then
    echo "Eso no parece un token de Cloudflare. No se guardo nada."; return 1
  fi
  # Se escribe desde dentro de Ubuntu (por la entrada, no como argumento), asi
  # no depende de donde guarde proot-distro la carpeta de Ubuntu.
  printf '%s\n' "$token" | proot-distro login ubuntu -- bash -c 'umask 077; cat > ~/.barriomu-cloudflare' \
    || { echo "No se pudo guardar."; return 1; }
  echo "Listo: token guardado. El panel admin ya puede ver las visitas y borrar la cache."
}

# Diagnostico: los NPCs (no monstruos) de Lorencia, Devias, Noria y Elbeland en la
# base, con su posicion y si estan activos, y cuantos monstruos/NPCs estan apagados
# ("activacion de contenido" del panel de OpenMU). Un NPC apagado no aparece en
# ninguna parte, tampoco dentro de los eventos.
#   npcs           solo mira
#   npcs activar   los prende todos y reinicia OpenMU
npcs() {
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || { echo "PostgreSQL esta apagado: bash ~/barriomu.sh prender"; return 1; }
  if [ "$1" = activar ]; then
    local n
    n=$(psql -U postgres -d openmu -tAq -c 'UPDATE config."MonsterDefinition" SET "IsActive" = true WHERE NOT "IsActive" RETURNING 1' | grep -cx 1)
    echo "Listo: $n monstruos/NPCs estaban apagados y se prendieron."
    echo "Reiniciando OpenMU para que los cree (los jugadores se desconectan un momento)..."
    stop_watchdog
    stop_openmu
    start_openmu ""
    wait_port 44405 OpenMU 600
    start_watchdog
    echo "Listo. Entra a Lorencia y revisa."
    return 0
  fi
  psql -U postgres -d openmu -P pager=off <<'SQL'
SELECT g."Number" AS mapa, m."Number" AS npc, m."Designation" AS nombre,
       s."X1" AS x, s."Y1" AS y, m."IsActive" AS activo,
       CASE WHEN m."MerchantStoreId" IS NOT NULL THEN 'tienda' ELSE '' END AS tienda
FROM config."MonsterSpawnArea" s
JOIN config."MonsterDefinition" m ON m."Id" = s."MonsterDefinitionId"
JOIN config."GameMapDefinition" g ON g."Id" = s."GameMapId"
WHERE g."Number" IN (0, 2, 3, 51) AND m."ObjectKind" <> 0
ORDER BY g."Number", m."Number";
SELECT count(*) FILTER (WHERE NOT "IsActive" AND "ObjectKind" <> 0) AS "NPCs apagados",
       count(*) FILTER (WHERE NOT "IsActive" AND "ObjectKind" = 0) AS "monstruos apagados",
       count(*) AS "total en la base"
FROM config."MonsterDefinition";
SQL
  echo "Mapas: 0 Lorencia, 2 Devias, 3 Noria, 51 Elbeland. activo = f quiere decir apagado."
  echo "Si hay NPCs apagados, prendelos con: bash ~/barriomu.sh npcs activar"
}

# Reinicia solo OpenMU (los jugadores se desconectan un momento).
reiniciar_openmu() {
  echo "Reiniciando OpenMU (los jugadores se desconectan un momento)..."
  stop_watchdog
  stop_openmu
  start_openmu ""
  wait_port 44405 OpenMU 600
  start_watchdog
}

# Solo mira: monstruos de las ciudades, portales (puertas entre mapas) y /move.
mapas() {
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || { echo "PostgreSQL esta apagado: bash ~/barriomu.sh prender"; return 1; }
  psql -U postgres -d openmu -P pager=off <<'SQL'
\echo '== Monstruos por mapa (zonas, cuantos, cuantos apagados) =='
SELECT g."Number" AS mapa, g."IsActive" AS mapa_activo,
       count(s."Id") AS zonas,
       coalesce(sum(s."Quantity"), 0) AS monstruos,
       coalesce(sum(s."Quantity") FILTER (WHERE NOT s.activo), 0) AS apagados
FROM config."GameMapDefinition" g
LEFT JOIN (
  SELECT a."Id", a."GameMapId", a."Quantity", m."IsActive" AS activo
  FROM config."MonsterSpawnArea" a
  JOIN config."MonsterDefinition" m ON m."Id" = a."MonsterDefinitionId"
  WHERE m."ObjectKind" = 0 AND a."SpawnTrigger" = 0
) s ON s."GameMapId" = g."Id"
WHERE g."Number" IN (0, 2, 3, 4, 7, 8, 10, 33, 51, 56, 57)
GROUP BY g."Number", g."IsActive" ORDER BY g."Number";
\echo '== Monstruos de Lorencia =='
SELECT m."Number" AS num, m."Designation" AS monstruo, s."Quantity" AS cuantos,
       s."X1" || '-' || s."X2" AS x, s."Y1" || '-' || s."Y2" AS y, m."IsActive" AS activo,
       CASE WHEN s."Id"::text LIKE 'ba000000-%' THEN 'BarrioMU' ELSE '' END AS origen
FROM config."MonsterSpawnArea" s
JOIN config."MonsterDefinition" m ON m."Id" = s."MonsterDefinitionId"
JOIN config."GameMapDefinition" g ON g."Id" = s."GameMapId"
WHERE g."Number" = 0 AND m."ObjectKind" = 0 ORDER BY m."Number";
\echo '== Portales (puertas entre mapas) =='
SELECT g."Number" AS desde_mapa, count(e.*) AS portales,
       count(*) FILTER (WHERE x."Id" IS NULL OR d."Id" IS NULL) AS rotos,
       count(*) FILTER (WHERE d."IsActive" = false) AS a_mapa_apagado,
       string_agg(DISTINCT d."Number"::text, ',') AS llevan_a
FROM config."EnterGate" e
JOIN config."GameMapDefinition" g ON g."Id" = e."GameMapDefinitionId"
LEFT JOIN config."ExitGate" x ON x."Id" = e."TargetGateId"
LEFT JOIN config."GameMapDefinition" d ON d."Id" = x."MapId"
GROUP BY g."Number" ORDER BY g."Number";
\echo '== /move (mapa M) =='
SELECT w."Index" AS n, w."Name" AS destino, w."LevelRequirement" AS nivel, w."Costs" AS zen,
       d."Number" AS mapa,
       CASE WHEN x."Id" IS NULL OR d."Id" IS NULL THEN 'ROTO'
            WHEN NOT d."IsActive" THEN 'MAPA APAGADO' ELSE 'ok' END AS estado
FROM config."WarpInfo" w
LEFT JOIN config."ExitGate" x ON x."Id" = w."GateId"
LEFT JOIN config."GameMapDefinition" d ON d."Id" = x."MapId"
ORDER BY w."Index";
SQL
  echo "Mapas: 0 Lorencia, 2 Devias, 3 Noria, 4 Losttower, 7 Atlans, 8 Tarkan, 10 Icarus, 33 Aida, 51 Elbeland, 56 Swamp, 57 Raklion."
  echo "rotos o ROTO = el portal no lleva a ningun lado. Para el spot: bash ~/barriomu.sh spot"
}

# Repone los monstruos originales de Lorencia que falten (los de OpenMU) y pone
# el spot de las afueras. Las filas que crea tienen id ba000000-... (se pueden quitar).
spot() {
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || { echo "PostgreSQL esta apagado: bash ~/barriomu.sh prender"; return 1; }
  if [ "$1" = quitar ]; then
    psql -U postgres -d openmu -tAq -c "DELETE FROM config.\"MonsterSpawnArea\" WHERE \"Id\"::text LIKE 'ba000000-0000-4000-8000-0000000002%'"
    echo "Spot quitado."
    reiniciar_openmu
    return 0
  fi
  local salida
  salida=$(psql -U postgres -d openmu -tAq -v ON_ERROR_STOP=1 <<'SQL'
UPDATE config."GameMapDefinition" SET "IsActive" = true WHERE "Number" = 0 AND NOT "IsActive";
WITH lorencia AS (SELECT "Id" FROM config."GameMapDefinition" WHERE "Number" = 0 LIMIT 1),
-- id, monstruo, x1, x2, y1, y2, cuantos
originales(id, num, x1, x2, y1, y2, q) AS (VALUES
  ('ba000000-0000-4000-8000-000000000100'::uuid, 0, 135, 240, 20, 88, 45),
  ('ba000000-0000-4000-8000-000000000101'::uuid, 3, 180, 226, 90, 244, 45),
  ('ba000000-0000-4000-8000-000000000102'::uuid, 2, 180, 226, 90, 244, 40),
  ('ba000000-0000-4000-8000-000000000103'::uuid, 2, 135, 240, 20, 88, 20),
  ('ba000000-0000-4000-8000-000000000104'::uuid, 6, 95, 175, 168, 244, 20),
  ('ba000000-0000-4000-8000-000000000105'::uuid, 14, 95, 175, 168, 244, 15),
  ('ba000000-0000-4000-8000-000000000106'::uuid, 1, 8, 94, 11, 244, 45),
  ('ba000000-0000-4000-8000-000000000107'::uuid, 4, 8, 94, 11, 244, 45),
  ('ba000000-0000-4000-8000-000000000108'::uuid, 7, 8, 60, 11, 80, 15)
),
-- El spot de BarrioMU, al sur de la ciudad, saliendo por abajo.
spot(id, num, x1, x2, y1, y2, q) AS (VALUES
  ('ba000000-0000-4000-8000-000000000200'::uuid, 7, 140, 170, 185, 215, 25),
  ('ba000000-0000-4000-8000-000000000201'::uuid, 14, 140, 170, 185, 215, 25),
  ('ba000000-0000-4000-8000-000000000202'::uuid, 6, 140, 170, 185, 215, 20)
),
faltan AS (
  SELECT o.* FROM originales o
  WHERE NOT EXISTS (
    SELECT 1 FROM config."MonsterSpawnArea" s
    JOIN config."MonsterDefinition" m ON m."Id" = s."MonsterDefinitionId"
    WHERE s."GameMapId" = (SELECT "Id" FROM lorencia) AND m."Number" = o.num
      AND s."Id"::text NOT LIKE 'ba000000-0000-4000-8000-0000000002%')
),
todo AS (SELECT * FROM faltan UNION ALL SELECT * FROM spot),
nuevos AS (
  INSERT INTO config."MonsterSpawnArea"
    ("Id", "GameMapId", "MonsterDefinitionId", "X1", "X2", "Y1", "Y2", "Quantity", "Direction", "SpawnTrigger", "WaveNumber")
  SELECT t.id, (SELECT "Id" FROM lorencia), m."Id", t.x1, t.x2, t.y1, t.y2, t.q, 0, 0, 0
  FROM todo t JOIN config."MonsterDefinition" m ON m."Number" = t.num
  ON CONFLICT ("Id") DO NOTHING
  RETURNING "Id"
)
SELECT count(*) FILTER (WHERE "Id"::text LIKE '%0001__') || ' ' ||
       count(*) FILTER (WHERE "Id"::text LIKE '%0002__') FROM nuevos;
UPDATE config."MonsterDefinition" m SET "IsActive" = true
WHERE NOT m."IsActive" AND m."Number" IN (0, 1, 2, 3, 4, 6, 7, 14) AND m."ObjectKind" = 0;
SQL
) || { echo "No se pudo (revisa el mensaje de arriba)."; return 1; }
  set -- $(echo "$salida" | grep -E '^[0-9]+ [0-9]+$' | tail -1)
  echo "Monstruos originales de Lorencia repuestos: ${1:-0} zonas (0 = ya estaban)."
  echo "Spot de las afueras: ${2:-0} zonas nuevas (0 = ya estaba)."
  echo "Spot: al sur de Lorencia, x 140-170, y 185-215: 25 Gigantes, 25 Esqueletos, 20 Lich."
  reiniciar_openmu
  echo "Listo. Entra a Lorencia y sal por el sur de la ciudad."
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
  gm) gm "$2" ;;
  cloudflare) cloudflare ;;
  npcs) npcs "$2" ;;
  mapas) mapas ;;
  spot) spot "$2" ;;
  vigilar) vigilar ;;
  *) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
