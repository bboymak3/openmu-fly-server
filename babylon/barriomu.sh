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
#   bash ~/barriomu.sh resets estado  dice si los resets estan prendidos
#   bash ~/barriomu.sh extras      prende puntos por hora, /addstr..., /openware, /resetstats y anuncios (reinicia OpenMU)
#   bash ~/barriomu.sh gm CUENTA   hace GM una cuenta (para el panel admin; con la cuenta fuera del juego)
#   bash ~/barriomu.sh cloudflare  guarda el token de Cloudflare del panel admin
#   bash ~/barriomu.sh ia          configura El Sabio del Barrio (/ia): ID de cuenta y token de Workers AI
#   bash ~/barriomu.sh whatsapp    vincula el WhatsApp del bot (el Sabio por WhatsApp); 'whatsapp desvincular' lo suelta
#   bash ~/barriomu.sh whatsapp pausar   el bot no contesta (sigue vinculado); 'whatsapp reanudar' vuelve
#   bash ~/barriomu.sh npcs        lista los NPCs de las ciudades y cuantos estan apagados
#   bash ~/barriomu.sh npcs activar  vuelve a prender todos los NPCs y monstruos (reinicia OpenMU)
#   bash ~/barriomu.sh mapas       monstruos de Lorencia, portales y /move: que sirve y que esta roto
#   bash ~/barriomu.sh spot        Lorencia con el TRIPLE de monstruos en todas las salidas
#                                  y el spot del sur (reinicia OpenMU); spot 1 = normal, spot 2 = doble
#   bash ~/barriomu.sh spot quitar quita el spot de las afueras (reinicia OpenMU)
#   bash ~/barriomu.sh joyas       muestra como caen Bless, Soul, Chaos, Life y Creation
#   bash ~/barriomu.sh joyas 1     las hace caer con 1% por monstruo en todos los mapas (reinicia OpenMU)
#   bash ~/barriomu.sh arena       las 8 jaulas de la Arena con 10 monstruos cada una y sus spots de
#                                  farmeo (Jaula 1..8, para WhatsApp); arena 20 = 20 por jaula (reinicia OpenMU)
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
  if [ "$1" = estado ]; then
    psql -U postgres -d openmu -P pager=off -c "SELECT \"IsActive\" AS activo, \"CustomConfiguration\" AS configuracion FROM config.\"PlugInConfiguration\" WHERE \"TypeId\" = '$RESET_PLUGIN'"
    echo "activo = t: los resets estan prendidos. Sin filas o activo = f: bash ~/barriomu.sh resets"
    grep -h "ResetFeature\|Reset" "$LOGS"/openmu*.log 2>/dev/null | tail -5
    return 0
  fi
  echo "Activando resets..."
  # OpenMU se apaga ANTES de escribir: asi no puede pisar la configuracion al cerrarse.
  stop_watchdog
  stop_openmu
  psql -U postgres -d openmu -v ON_ERROR_STOP=1 -q <<SQL || { echo "No se pudo activar."; start_openmu ""; start_watchdog; return 1; }
UPDATE config."PlugInConfiguration"
   SET "IsActive" = true,
       "CustomConfiguration" = (coalesce(nullif("CustomConfiguration", ''), '{}')::jsonb || '$RESET_CONFIG'::jsonb)::text
 WHERE "TypeId" = '$RESET_PLUGIN';
INSERT INTO config."PlugInConfiguration" ("Id", "GameConfigurationId", "TypeId", "IsActive", "CustomConfiguration")
SELECT gen_random_uuid(), (SELECT "Id" FROM config."GameConfiguration" LIMIT 1), '$RESET_PLUGIN', true, '$RESET_CONFIG'
 WHERE NOT EXISTS (SELECT 1 FROM config."PlugInConfiguration" WHERE "TypeId" = '$RESET_PLUGIN');
SQL
  echo "Listo. Prendiendo OpenMU para que lo lea..."
  start_openmu ""
  wait_port 44405 OpenMU 600
  start_watchdog
  local activo
  activo=$(psql -U postgres -d openmu -tAq -c "SELECT \"IsActive\" FROM config.\"PlugInConfiguration\" WHERE \"TypeId\" = '$RESET_PLUGIN'")
  if [ "$activo" = t ]; then
    echo "Resets activos: en el juego escribe /reset (nivel 400 y 1.000.000 de zen por cada reset)."
  else
    echo "OJO: OpenMU dejo los resets apagados. Manda foto de: bash ~/barriomu.sh resets estado"
  fi
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

# El Sabio del Barrio (/ia en el juego): guarda en la tablet el ID de la cuenta de
# Cloudflare y el token de Workers AI (~/.barriomu-ia, dentro de Ubuntu), crea el
# secreto que comparten OpenMU y la API (~/openmu/data/sabio-secreto.txt) y prueba
# que la IA conteste. El token no se ve mientras se pega.
ia() {
  echo "ID de tu cuenta de Cloudflare (32 letras y numeros; esta en la portada del panel de Cloudflare, a la derecha):"
  local cuenta token
  read -r cuenta
  cuenta=$(printf '%s' "$cuenta" | tr -d '[:space:]')
  if ! [[ "$cuenta" =~ ^[0-9a-fA-F]{32}$ ]]; then
    echo "Eso no parece un ID de cuenta de Cloudflare. No se guardo nada."; return 1
  fi
  echo "Pega el token de Workers AI y dale Enter (no se ve mientras lo pegas):"
  read -rs token; echo
  token=$(printf '%s' "$token" | tr -d '[:space:]')
  if ! [[ "$token" =~ ^[A-Za-z0-9_-]{20,}$ ]]; then
    echo "Eso no parece un token de Cloudflare. No se guardo nada."; return 1
  fi
  printf '%s\n%s\n' "$cuenta" "$token" | proot-distro login ubuntu -- bash -c 'umask 077; cat > ~/.barriomu-ia' \
    || { echo "No se pudo guardar."; return 1; }
  local secreto
  secreto=$(head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)
  printf '%s\n' "$secreto" | proot-distro login ubuntu -- bash -c \
    'mkdir -p ~/openmu/data; if [ -s ~/openmu/data/sabio-secreto.txt ]; then cat >/dev/null; else umask 077; cat > ~/openmu/data/sabio-secreto.txt; fi' \
    || { echo "No se pudo crear el secreto."; return 1; }
  echo "Probando la IA..."
  # La prueba la hace el mismo Bun de la API, leyendo el token del archivo dentro de Ubuntu
  # (no va en la linea de comandos y no depende de curl).
  local prueba
  prueba=$(proot-distro login ubuntu -- bash -c 'cd ~ && ~/babylon/proxy/bun -e "
      const fs = require(\"fs\");
      const [a, t] = fs.readFileSync(process.env.HOME + \"/.barriomu-ia\", \"utf8\").split(/\\r?\\n/).map(l => l.trim());
      const r = await fetch(\"https://api.cloudflare.com/client/v4/accounts/\" + a + \"/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast\", {
        method: \"POST\", headers: { Authorization: \"Bearer \" + t, \"Content-Type\": \"application/json\" },
        body: JSON.stringify({ messages: [{ role: \"user\", content: \"Saluda en 5 palabras\" }], max_tokens: 30 }),
        signal: AbortSignal.timeout(40000) });
      const d = await r.json().catch(() => ({}));
      console.log(d.success ? \"IA-OK \" + d.result.response : \"IA-ERROR \" + r.status + \" \" + JSON.stringify(d.errors ?? []));
    "' 2>&1)
  echo "$prueba" | tail -n 2
  if echo "$prueba" | grep -q 'IA-OK'; then
    echo "Listo: el Sabio del Barrio ya puede hablar. En el juego: /ia y tu pregunta."
    echo "Si OpenMU estaba prendido, no hace falta reiniciar."
  else
    echo "Se guardo, pero la IA no contesto. Revisa que el token tenga el permiso 'Workers AI' y que el ID de cuenta sea el correcto."
    return 1
  fi
}

# WhatsApp del servidor (el Sabio por WhatsApp), en la tablet: vincula el numero del bot
# con un codigo (WhatsApp > Dispositivos vinculados > Vincular con numero de telefono).
# Usa un numero aparte, no el personal: WhatsApp puede bloquear numeros de bots.
whatsapp() {
  if [ "$1" = pausar ] || [ "$1" = reanudar ]; then
    pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || { echo "PostgreSQL esta apagado: bash ~/barriomu.sh prender"; return 1; }
    local v=1; [ "$1" = pausar ] && v=0
    psql -U postgres -d openmu -q -c "CREATE SCHEMA IF NOT EXISTS barrio; CREATE TABLE IF NOT EXISTS barrio.settings (key text primary key, value text not null); INSERT INTO barrio.settings (key, value) VALUES ('wa_on', '$v') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value" \
      && if [ "$v" = 0 ]; then echo "Listo: el bot de WhatsApp quedo en PAUSA (sigue conectado, no contesta). Para volver: bash ~/barriomu.sh whatsapp reanudar"
         else echo "Listo: el bot de WhatsApp vuelve a contestar."; fi
    return
  fi
  if [ "$1" = desvincular ]; then
    pkill -f whatsapp/bot
    proot-distro login ubuntu -- bash -c 'rm -rf ~/barriomu-wa/auth' && echo "Listo: el bot quedo desvinculado de la tablet."
    echo "En el telefono del bot: WhatsApp > Dispositivos vinculados > cierra la sesion de BarrioMU (Ubuntu/Chrome)."
    return
  fi
  echo "Numero del WhatsApp del BOT, con codigo de pais y solo numeros (ej: 584121234567):"
  local numero
  read -r numero
  numero=$(printf '%s' "$numero" | tr -cd '0-9')
  if ! [[ "$numero" =~ ^[0-9]{10,15}$ ]]; then
    echo "Ese numero no parece valido. No se hizo nada."; return 1
  fi
  pkill -f whatsapp/bot
  # Siempre desde cero: una sesion a medio guardar no vuelve a entrar (error 428).
  proot-distro login ubuntu -- bash -c 'rm -rf ~/barriomu-wa/auth'
  echo "Antes de seguir: en el telefono del bot, WhatsApp > Dispositivos vinculados: si hay un"
  echo "'Ubuntu' o 'Chrome' viejo de BarrioMU, tocalo y cierra su sesion."
  echo "Pidiendo el codigo a WhatsApp (tarda unos segundos)..."
  proot-distro login ubuntu -- bash -c "cd ~/babylon/proxy && whatsapp/node whatsapp/bot.mjs --vincular $numero" \
    || { echo "No se pudo vincular. Intenta de nuevo."; return 1; }
  echo "Prendiendo el bot..."
  pkill -f proxy/main.ts; pkill -f register/server/main.ts; pkill -f api/main.ts; pkill -f mu-servir
  sleep 2
  in_ubuntu cliente.log "cd ~/babylon && exec ./iniciar-cliente.sh"; wait_port 3000 proxy 120
  echo "Listo: escribele al numero del bot desde tu WhatsApp para probar."
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

# Lorencia llena: las zonas de monstruos de OpenMU alrededor de la ciudad (todas las
# salidas: norte, este, sur y oeste) con N veces sus monstruos (por defecto 3), y el
# spot del sur. Repone las zonas que falten. Las filas que crea tienen id ba000000-...
#   spot        triple de monstruos + spot
#   spot 1|2|3  normal, doble o triple (el spot queda igual)
#   spot quitar quita solo el spot del sur
spot() {
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || { echo "PostgreSQL esta apagado: bash ~/barriomu.sh prender"; return 1; }
  if [ "$1" = quitar ]; then
    psql -U postgres -d openmu -tAq -c "DELETE FROM config.\"MonsterSpawnArea\" WHERE \"Id\"::text LIKE 'ba000000-0000-4000-8000-0000000002%'"
    echo "Spot quitado."
    reiniciar_openmu
    return 0
  fi
  local veces=${1:-3}
  case "$veces" in 1|2|3) ;; *) echo "Usa: bash ~/barriomu.sh spot 1 (normal), 2 (doble) o 3 (triple)"; return 1 ;; esac
  local salida
  salida=$(psql -U postgres -d openmu -tAq -v ON_ERROR_STOP=1 -v veces="$veces" <<'SQL'
UPDATE config."GameMapDefinition" SET "IsActive" = true WHERE "Number" = 0 AND NOT "IsActive";
CREATE TEMP TABLE lorencia AS SELECT "Id" FROM config."GameMapDefinition" WHERE "Number" = 0 LIMIT 1;
-- Las zonas de OpenMU (Version075): id BarrioMU, monstruo, x1, x2, y1, y2, cuantos.
CREATE TEMP TABLE originales(id uuid, num int, x1 int, x2 int, y1 int, y2 int, q int);
INSERT INTO originales VALUES
  ('ba000000-0000-4000-8000-000000000100', 0, 135, 240, 20, 88, 45),   -- Bull Fighter, norte
  ('ba000000-0000-4000-8000-000000000101', 3, 180, 226, 90, 244, 45),  -- Spider, este
  ('ba000000-0000-4000-8000-000000000102', 2, 180, 226, 90, 244, 40),  -- Budge Dragon, este
  ('ba000000-0000-4000-8000-000000000103', 2, 135, 240, 20, 88, 20),   -- Budge Dragon, norte
  ('ba000000-0000-4000-8000-000000000104', 6, 95, 175, 168, 244, 20),  -- Lich, sur
  ('ba000000-0000-4000-8000-000000000105', 14, 95, 175, 168, 244, 15), -- Skeleton, sur
  ('ba000000-0000-4000-8000-000000000106', 1, 8, 94, 11, 244, 45),     -- Hound, oeste
  ('ba000000-0000-4000-8000-000000000107', 4, 8, 94, 11, 244, 45),     -- Elite Bull Fighter, oeste
  ('ba000000-0000-4000-8000-000000000108', 7, 8, 60, 11, 80, 15);      -- Giant, noroeste
-- La zona que ya esta en la base (la de OpenMU o la que puso BarrioMU antes).
CREATE TEMP TABLE hay AS
SELECT DISTINCT ON (o.id) o.id AS original, s."Id" AS fila
FROM originales o
JOIN config."MonsterDefinition" m ON m."Number" = o.num AND m."ObjectKind" = 0
JOIN config."MonsterSpawnArea" s ON s."MonsterDefinitionId" = m."Id" AND s."GameMapId" = (SELECT "Id" FROM lorencia)
 AND s."X1" = o.x1 AND s."X2" = o.x2 AND s."Y1" = o.y1 AND s."Y2" = o.y2 AND s."SpawnTrigger" = 0
ORDER BY o.id, (s."Id" = o.id) DESC;
UPDATE config."MonsterSpawnArea" s SET "Quantity" = o.q * :veces
FROM hay h JOIN originales o ON o.id = h.original WHERE s."Id" = h.fila;
INSERT INTO config."MonsterSpawnArea"
  ("Id", "GameMapId", "MonsterDefinitionId", "X1", "X2", "Y1", "Y2", "Quantity", "Direction", "SpawnTrigger", "WaveNumber")
SELECT o.id, (SELECT "Id" FROM lorencia), m."Id", o.x1, o.x2, o.y1, o.y2, o.q * :veces, 0, 0, 0
FROM originales o JOIN config."MonsterDefinition" m ON m."Number" = o.num AND m."ObjectKind" = 0
WHERE o.id NOT IN (SELECT original FROM hay)
ON CONFLICT ("Id") DO UPDATE SET "Quantity" = EXCLUDED."Quantity";
-- El spot del sur, saliendo por abajo de la ciudad.
INSERT INTO config."MonsterSpawnArea"
  ("Id", "GameMapId", "MonsterDefinitionId", "X1", "X2", "Y1", "Y2", "Quantity", "Direction", "SpawnTrigger", "WaveNumber")
SELECT t.id, (SELECT "Id" FROM lorencia), m."Id", 140, 170, 185, 215, t.q, 0, 0, 0
FROM (VALUES ('ba000000-0000-4000-8000-000000000200'::uuid, 7, 25),
             ('ba000000-0000-4000-8000-000000000201'::uuid, 14, 25),
             ('ba000000-0000-4000-8000-000000000202'::uuid, 6, 20)) AS t(id, num, q)
JOIN config."MonsterDefinition" m ON m."Number" = t.num AND m."ObjectKind" = 0
ON CONFLICT ("Id") DO NOTHING;
UPDATE config."MonsterDefinition" SET "IsActive" = true
WHERE NOT "IsActive" AND "ObjectKind" = 0 AND "Number" IN (0, 1, 2, 3, 4, 6, 7, 14);
SELECT 'repuestas ' || (SELECT count(*) FROM originales WHERE id NOT IN (SELECT original FROM hay));
SELECT 'total ' || coalesce(sum(s."Quantity"), 0) FROM config."MonsterSpawnArea" s
JOIN config."MonsterDefinition" m ON m."Id" = s."MonsterDefinitionId"
WHERE s."GameMapId" = (SELECT "Id" FROM lorencia) AND m."ObjectKind" = 0 AND s."SpawnTrigger" = 0;
SQL
) || { echo "No se pudo (revisa el mensaje de arriba)."; return 1; }
  local nombre="la cantidad normal"
  [ "$veces" = 2 ] && nombre="el doble"
  [ "$veces" = 3 ] && nombre="el triple"
  echo "Zonas de Lorencia que faltaban y se repusieron: $(echo "$salida" | sed -n 's/^repuestas //p')"
  echo "Lorencia con $nombre de monstruos en todas las salidas (norte, este, sur y oeste):"
  echo "  Bull Fighter, Hound, Budge Dragon (dragon bebe), Spider (arana), Elite Bull Fighter, Lich, Gigante, Esqueleto."
  echo "Spot del sur (x 140-170, y 185-215): 25 Gigantes, 25 Esqueletos, 20 Lich."
  echo "Monstruos en Lorencia en total: $(echo "$salida" | sed -n 's/^total //p')"
  reiniciar_openmu
  echo "Listo. Entra a Lorencia y sal por cualquier lado de la ciudad."
}

# Las 8 jaulas de entrenamiento de la Arena (mapa 6), de menos a mas dificiles desde
# la llegada. Pone N monstruos por jaula (por defecto 10, repartidos entre sus tipos),
# quita los otros monstruos de la Arena (no los NPC) y guarda cada jaula como spot de
# farmeo (Jaula 1..8 en ~/openmu/data/spots.json) para moverse por WhatsApp.
arena() {
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || { echo "PostgreSQL esta apagado: bash ~/barriomu.sh prender"; return 1; }
  local n=${1:-10}
  if ! [[ "$n" =~ ^[0-9]+$ ]] || [ "$n" -lt 2 ] || [ "$n" -gt 40 ]; then
    echo "Pon cuantos monstruos por jaula, entre 2 y 40. Por ejemplo: bash ~/barriomu.sh arena 10"; return 1
  fi
  local salida
  salida=$(psql -U postgres -d openmu -tAq -v ON_ERROR_STOP=1 -v n="$n" <<'SQL'
UPDATE config."GameMapDefinition" SET "IsActive" = true WHERE "Number" = 6 AND NOT "IsActive";
CREATE TEMP TABLE arena AS SELECT "Id" FROM config."GameMapDefinition" WHERE "Number" = 6 LIMIT 1;
-- jaula, monstruo, orden dentro de la jaula, tipos en la jaula, x1, y1, x2, y2
CREATE TEMP TABLE jaulas(j int, num int, i int, k int, x1 int, y1 int, x2 int, y2 int);
INSERT INTO jaulas VALUES
  (1, 19, 0, 3, 78, 94, 89, 105), (1, 20, 1, 3, 78, 94, 89, 105), (1, 5, 2, 3, 78, 94, 89, 105),
  (2, 9, 0, 3, 79, 78, 90, 89), (2, 47, 1, 3, 79, 78, 90, 89), (2, 10, 2, 3, 79, 78, 90, 89),
  (3, 52, 0, 3, 79, 62, 90, 73), (3, 48, 1, 3, 79, 62, 90, 73), (3, 62, 2, 3, 79, 62, 90, 73),
  (4, 60, 0, 3, 79, 34, 90, 45), (4, 57, 1, 3, 79, 34, 90, 45), (4, 61, 2, 3, 79, 34, 90, 45),
  (5, 353, 0, 3, 80, 18, 91, 29), (5, 355, 1, 3, 80, 18, 91, 29), (5, 356, 2, 3, 80, 18, 91, 29),
  (6, 350, 0, 3, 88, 2, 99, 13), (6, 455, 1, 3, 88, 2, 99, 13), (6, 573, 2, 3, 88, 2, 99, 13),
  (7, 574, 0, 3, 27, 108, 38, 119), (7, 489, 1, 3, 27, 108, 38, 119), (7, 490, 2, 3, 27, 108, 38, 119),
  (8, 456, 0, 2, 11, 108, 22, 119), (8, 457, 1, 2, 11, 108, 22, 119);
-- Fuera los monstruos que tenga la Arena (los del editor de mapas o de antes); los NPC se quedan.
DELETE FROM config."MonsterSpawnArea" s USING config."MonsterDefinition" m
WHERE s."MonsterDefinitionId" = m."Id" AND m."ObjectKind" = 0 AND s."GameMapId" = (SELECT "Id" FROM arena);
INSERT INTO config."MonsterSpawnArea"
  ("Id", "GameMapId", "MonsterDefinitionId", "X1", "X2", "Y1", "Y2", "Quantity", "Direction", "SpawnTrigger", "WaveNumber")
SELECT ('ba000000-0000-4000-8000-0000000004' || lpad((j * 10 + i)::text, 2, '0'))::uuid,
       (SELECT "Id" FROM arena), m."Id", x1, x2, y1, y2,
       :n / k + CASE WHEN i < :n % k THEN 1 ELSE 0 END, 0, 0, 0
FROM jaulas JOIN config."MonsterDefinition" m ON m."Number" = jaulas.num AND m."ObjectKind" = 0;
UPDATE config."MonsterDefinition" SET "IsActive" = true
WHERE NOT "IsActive" AND "ObjectKind" = 0 AND "Number" IN (SELECT num FROM jaulas);
SELECT 'total ' || coalesce(sum(s."Quantity"), 0) FROM config."MonsterSpawnArea" s
JOIN config."MonsterDefinition" m ON m."Id" = s."MonsterDefinitionId"
WHERE s."GameMapId" = (SELECT "Id" FROM arena) AND m."ObjectKind" = 0;
SELECT 'jaulas ' || count(DISTINCT j) FROM jaulas JOIN config."MonsterDefinition" m ON m."Number" = jaulas.num AND m."ObjectKind" = 0;
SQL
) || { echo "No se pudo (revisa el mensaje de arriba)."; return 1; }
  # Los spots: el centro de cada jaula. Si ya hay un spot "Jaula N" se actualiza, los demas quedan.
  proot-distro login ubuntu -- bash -c 'mkdir -p ~/openmu/data && cat > ~/openmu/data/.jaulas.js && ~/babylon/proxy/bun ~/openmu/data/.jaulas.js; r=$?; rm -f ~/openmu/data/.jaulas.js; exit $r' <<'JS' || { echo "Los monstruos quedaron, pero no se pudieron guardar los spots."; return 1; }
const fs = require("fs");
const file = process.env.HOME + "/openmu/data/spots.json";
let spots = [];
try { spots = JSON.parse(fs.readFileSync(file, "utf8")).spots ?? []; } catch {}
const centros = [[83, 99], [84, 83], [84, 67], [84, 39], [85, 23], [93, 7], [32, 113], [16, 113]];
centros.forEach(([x, y], i) => {
  const nombre = "Jaula " + (i + 1);
  const viejo = spots.find(s => s.nombre.toLowerCase() === nombre.toLowerCase());
  const id = viejo ? viejo.id : spots.reduce((m, s) => Math.max(m, s.id), 0) + 1;
  spots = spots.filter(s => s !== viejo);
  spots.push({ id, nombre, mapa: 6, mapaNombre: "Arena", x, y, nivel: viejo ? viejo.nivel : 0 });
});
spots.sort((a, b) => a.id - b.id);
fs.writeFileSync(file + ".tmp", JSON.stringify({ spots }));
fs.renameSync(file + ".tmp", file);
console.log("spots " + spots.length);
JS
  echo "Arena: $(echo "$salida" | sed -n 's/^jaulas //p') jaulas con $n monstruos cada una ($(echo "$salida" | sed -n 's/^total //p') en total)."
  echo "Spots de farmeo guardados: Jaula 1 (la mas facil, junto a la llegada) hasta Jaula 8 (la mas dificil)."
  echo "En el juego: /spots. Por WhatsApp: spots y mover N."
  reiniciar_openmu
  echo "Listo."
}

# Joyas que caen de los monstruos: Bless (14,13), Soul (14,14), Chaos (12,15),
# Life (14,16) y Creation (14,22). OpenMU trae un grupo con 0.1% por monstruo.
joyas() {
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || { echo "PostgreSQL esta apagado: bash ~/barriomu.sh prender"; return 1; }
  if [ -n "$1" ]; then
    local pct=${1/,/.}
    if ! awk -v p="$pct" 'BEGIN { exit !(p + 0 > 0 && p + 0 <= 10) }'; then
      echo "Pon un porcentaje entre 0.01 y 10, por ejemplo: bash ~/barriomu.sh joyas 1"
      return 1
    fi
    psql -U postgres -d openmu -q -v ON_ERROR_STOP=1 -v pct="$pct" <<'SQL' || { echo "No se pudo."; return 1; }
-- El grupo de joyas de OpenMU, o el de BarrioMU si no hay ninguno.
INSERT INTO config."DropItemGroup" ("Id", "Chance", "Description", "GameConfigurationId", "ItemType")
SELECT 'ba000000-0000-4000-8000-000000000300', :pct / 100.0, 'BarrioMU: joyas', (SELECT "Id" FROM config."GameConfiguration" LIMIT 1), 3
WHERE NOT EXISTS (SELECT 1 FROM config."DropItemGroup" WHERE "Description" ILIKE '%jewel%' OR "Id" = 'ba000000-0000-4000-8000-000000000300');
CREATE TEMP TABLE grupo AS
SELECT "Id" FROM config."DropItemGroup"
WHERE "Description" ILIKE '%jewel%' OR "Id" = 'ba000000-0000-4000-8000-000000000300';
UPDATE config."DropItemGroup" SET "Chance" = :pct / 100.0 WHERE "Id" IN (SELECT "Id" FROM grupo);
INSERT INTO config."DropItemGroupItemDefinition" ("DropItemGroupId", "ItemDefinitionId")
SELECT g."Id", i."Id" FROM grupo g
CROSS JOIN config."ItemDefinition" i
WHERE (i."Group", i."Number") IN ((14, 13), (14, 14), (12, 15), (14, 16), (14, 22))
  AND NOT EXISTS (SELECT 1 FROM config."DropItemGroupItemDefinition" x WHERE x."DropItemGroupId" = g."Id" AND x."ItemDefinitionId" = i."Id");
INSERT INTO config."GameMapDefinitionDropItemGroup" ("GameMapDefinitionId", "DropItemGroupId")
SELECT m."Id", g."Id" FROM grupo g CROSS JOIN config."GameMapDefinition" m
WHERE NOT EXISTS (SELECT 1 FROM config."GameMapDefinitionDropItemGroup" x WHERE x."GameMapDefinitionId" = m."Id" AND x."DropItemGroupId" = g."Id");
SQL
    echo "Listo: las joyas caen con $pct% por monstruo en todos los mapas (ALTOBARINAS y Fortuna lo duplican)."
    reiniciar_openmu
    return 0
  fi
  psql -U postgres -d openmu -P pager=off <<'SQL'
\echo '== Grupos de joyas =='
SELECT g."Description" AS grupo, round((g."Chance" * 100)::numeric, 3) || '%' AS por_monstruo,
       (SELECT string_agg(i."Name", ', ') FROM config."DropItemGroupItemDefinition" x
          JOIN config."ItemDefinition" i ON i."Id" = x."ItemDefinitionId" WHERE x."DropItemGroupId" = g."Id") AS joyas,
       (SELECT count(*) FROM config."GameMapDefinitionDropItemGroup" x WHERE x."DropItemGroupId" = g."Id") || ' de ' ||
       (SELECT count(*) FROM config."GameMapDefinition") AS mapas
FROM config."DropItemGroup" g
WHERE g."Description" ILIKE '%jewel%' OR g."Id" = 'ba000000-0000-4000-8000-000000000300';
SQL
  echo "Para subirlas, por ejemplo a 1% por monstruo: bash ~/barriomu.sh joyas 1"
}

# Sistemas de OpenMU que vienen apagados y BarrioMU usa:
#   - Goblin Points por tiempo jugado (los puntos de la tienda): 5 cada hora, desde nivel 50
#   - /addstr /addagi /addvit /addene /addcmd: repartir puntos desde el chat
# OpenMU se apaga antes de escribir, como en `resets`.
PLAYTIME_PLUGIN="29a6d015-a94b-4f96-a638-6134ddc9ed0c"
PLAYTIME_CONFIG='{"Interval":"01:00:00","Points":5,"MinimumLevel":50,"IncludeOfflineLeveling":false}'
ADDSTAT_PLUGINS="21b15d95-ba2f-40a3-ab7d-8bd886faeae5 43156a52-03ee-42c0-88bf-ca9665dc8e1e 370ce86c-e382-4e0f-93f4-ad75fa079129 a597b6e7-9395-4cf4-8439-a1d60134b63e efe421fb-be79-4656-af39-d22a105d1455"
#   - /openware: abre el baul desde cualquier lugar (ahi llegan la tienda y los referidos)
OPENWARE_PLUGIN="62027b6b-d8e7-4ddb-a16b-7070d1bc4a56"
#   - Reset de estadisticas: /resetstats, 1.000.000 de zen
STATRESET_PLUGIN="0f1e2d3c-4b5a-6978-8c7d-6e5f4a3b2c1d"
STATRESET_CMD_PLUGIN="a1b2c3d4-e5f6-7890-abcd-ef1234567891"
STATRESET_CONFIG='{"RequiredLevel":1,"RequiredMoney":1000000,"ChatCommandEnabled":true,"MoveHome":true,"LogOut":true}'
#   - Anuncios del servidor cada 20 minutos
ANNOUNCE_PLUGIN="2d6c9e4a-7b3e-4f8c-9e1d-8a4b6f0c2e7d"
ANNOUNCE_CONFIG='{"Interval":"00:20:00","Messages":[{"Text":"Puntos por monstruos dorados y jefes: cambialos en barriomu.makeseo.app > Mi cuenta > Tienda"},{"Text":"Invita a tus panas con tu link de Mi cuenta: cuando lleguen a nivel 200 ganan los dos"},{"Text":"Buffs gratis en Lorencia: habla con Guerrero y Fortuna. El Cambista te dice tus puntos"},{"Text":"Escribe /openware para abrir tu baul en cualquier lugar"},{"Text":"Reparte puntos con /addstr /addagi /addvit /addene /addcmd y la cantidad"}]}'


plugin_on() {
  local id=$1 config=${2:-} setcfg=""
  [ -n "$config" ] && setcfg=", \"CustomConfiguration\" = '$config'"
  psql -U postgres -d openmu -v ON_ERROR_STOP=1 -q <<SQL
UPDATE config."PlugInConfiguration" SET "IsActive" = true $setcfg
 WHERE "TypeId" = '$id';
INSERT INTO config."PlugInConfiguration" ("Id", "GameConfigurationId", "TypeId", "IsActive", "CustomConfiguration")
SELECT gen_random_uuid(), (SELECT "Id" FROM config."GameConfiguration" LIMIT 1), '$id', true, NULLIF('$config', '')
 WHERE NOT EXISTS (SELECT 1 FROM config."PlugInConfiguration" WHERE "TypeId" = '$id');
SQL
}

extras() {
  pg_ctl -D "$PGDATA" status >/dev/null 2>&1 || { echo "PostgreSQL esta apagado: bash ~/barriomu.sh prender"; return 1; }
  if [ "$1" = estado ]; then
    psql -U postgres -d openmu -P pager=off -c "SELECT \"TypeId\" AS plugin, \"IsActive\" AS activo, \"CustomConfiguration\" AS config FROM config.\"PlugInConfiguration\" WHERE \"TypeId\" IN ('$PLAYTIME_PLUGIN', $(printf "'%s'," $ADDSTAT_PLUGINS $OPENWARE_PLUGIN $STATRESET_PLUGIN $STATRESET_CMD_PLUGIN $ANNOUNCE_PLUGIN | sed 's/,$//'))"
    return 0
  fi
  echo "Prendiendo los extras de OpenMU..."
  stop_watchdog
  stop_openmu
  plugin_on "$PLAYTIME_PLUGIN" "$PLAYTIME_CONFIG" || { echo "No se pudo."; start_openmu ""; start_watchdog; return 1; }
  for id in $ADDSTAT_PLUGINS $OPENWARE_PLUGIN $STATRESET_CMD_PLUGIN; do plugin_on "$id" || true; done
  plugin_on "$STATRESET_PLUGIN" "$STATRESET_CONFIG" || true
  plugin_on "$ANNOUNCE_PLUGIN" "$ANNOUNCE_CONFIG" || true
  echo "Listo. Prendiendo OpenMU..."
  start_openmu ""
  wait_port 44405 OpenMU 600
  start_watchdog
  echo "Activos:"
  echo "  - 5 puntos de la tienda por cada hora jugada (desde nivel 50)"
  echo "  - /addstr /addagi /addvit /addene /addcmd CANTIDAD para repartir puntos desde el chat"
  echo "  - /openware abre el baul en cualquier lugar"
  echo "  - /resetstats vuelve a repartir los puntos (1.000.000 de zen)"
  echo "  - anuncios del servidor cada 20 minutos"
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
  pkill -f proxy/main.ts; pkill -f register/server/main.ts; pkill -f api/main.ts; pkill -f mu-servir; pkill -f whatsapp/bot
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
  if pgrep -f whatsapp/bot >/dev/null; then echo "  [OK]  WhatsApp del bot"
  else echo "  [..]  WhatsApp del bot  (sin vincular: bash ~/barriomu.sh whatsapp)"; fi
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
  resets) resets "$2" ;;
  gm) gm "$2" ;;
  cloudflare) cloudflare ;;
  ia) ia ;;
  whatsapp) whatsapp "$2" ;;
  npcs) npcs "$2" ;;
  mapas) mapas ;;
  spot) spot "$2" ;;
  joyas) joyas "$2" ;;
  arena) arena "$2" ;;
  extras) extras "$2" ;;
  vigilar) vigilar ;;
  *) sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
