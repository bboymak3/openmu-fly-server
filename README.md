# BarrioMU

Servidor de MU Online Season 6 Episodio 3 que corre en una tablet Android y se
juega desde el navegador en **https://mu.makeseo.app** (celular o PC) o con el
instalador de Windows.

> 📖 **[Manual completo en español](docs/MANUAL.md)**: manejo diario, cómo actualizar,
> funciones del juego, Cloudflare, versión de PC, respaldos y solución de problemas.
>
> ⌨️ **[Todos los comandos de Termux](#comandos-de-termux)** están abajo, listos para copiar.

- **Servidor**: [OpenMU](https://github.com/MUnique/OpenMU) con PostgreSQL, dentro de
  Termux (Ubuntu con proot-distro).
- **Cliente**: [OpenMu Client Babylon](https://github.com/Ignies/OpenMu-Client-Babylon)
  con el logo y la lista de servidores de BarrioMU. Versión **lite** para el celular
  (se instala como app con el logo) y versión **completa** para PC
  (`BarrioMU-Setup.exe`, con actualización automática).
- **Internet**: Cloudflare Tunnel, sin abrir puertos ni IP pública. Los gráficos del
  celular quedan en la caché de Cloudflare (regla de caché + Tiered Cache).
- **Acceso remoto a la tablet**: Termius por SSH (puerto 8022), desde la casa o desde
  cualquier lugar con Tailscale.

## Servidores

| Servidor | PvP | Drop |
|---|---|---|
| MIJAGUA | Sí | Normal |
| ALTOBARINAS | No | Doble |

## Lo que tiene BarrioMU

**Juego**
- **Resets** (`/reset`, nivel 400, sin límite) y **Master Reset** (`/masterreset`: con 50
  resets vuelve a 0 y cada Master Reset suma 10.000 puntos a cada reset).
- **Premio diario** de 5.000.000 de zen por cuenta.
- **NPCs de buff en Lorencia**, frente a la fuente: **Guerrero** (+20% ataque y magia,
  30 min) y **Fortuna** (doble EXP y doble drop, 45 min, cada 3 horas).
- **NPCs de las ciudades** (tiendas, baúl, misiones, Chaos Machine...) en Lorencia,
  Devias, Noria y Elbeland: si faltan en la base se crean solos.
- **Lorencia llena**: el triple de monstruos en todas las salidas de la ciudad (Bull
  Fighter, Hound, Budge Dragon, Spider, Elite Bull Fighter, Lich, Gigante, Esqueleto) y
  un **spot al sur** (x 140-170, y 185-215) con 25 Gigantes, 25 Esqueletos y 20 Lich.
- **Joyas**: Bless, Soul, Chaos, Life y Creation caen con 1% por monstruo en todos los
  mapas (el doble en ALTOBARINAS o con el buff de Fortuna).
- **Set gratis**: cada personaje nuevo recibe en la bolsa el set básico de su clase
  (Pad, Leather, Vine o Mistery).
- **Tienda de puntos**: matar monstruos dorados de las invasiones y jefes (Icarus, Kalima,
  Crywolf, Kanturu, Raklion, Land of Trials) da puntos. El **Cambista** de Lorencia te dice
  cuántos tienes y en **Mi cuenta → Tienda de puntos** se cambian por Bless, Soul, Chaos y
  lo que el admin prenda (alas de 1ra y 2da, plumas, mascotas, armas +15…), que llega al
  baúl. También dan **5 puntos por cada hora jugada** (desde nivel 50).
- **Comandos de chat** para repartir puntos: `/addstr`, `/addagi`, `/addvit`, `/addene`,
  `/addcmd` seguidos de la cantidad.

**Celular** (solo en el teléfono; la PC queda igual)
- **Joystick** para caminar sin tocar el piso.
- **Rueda de combate**: botón grande que ataca al enemigo más cercano (y sigue mientras
  se mantiene), 4 habilidades en arco, ✕ para soltar el objetivo, círculo rojo de alcance
  y lista "Atacar objetivo". Las habilidades del panel se guardan por personaje.
- Botones grandes de **pociones Q/W** con la cantidad, y **✋ recoger**.
- Los botones de siempre (mover, chat, pantalla completa, zoom, menú), más chicos.
- **Nombres siempre visibles** sobre cada jugador (y su guild), y **barra de vida**
  sobre tu personaje y los de tu party.
- **Descripción de ítems con el dedo**: mantener el dedo sobre un ítem (bolsa, equipo,
  baúl, tienda, trade) muestra su descripción arriba del dedo; al soltar se queda hasta el
  próximo toque. Un toque rápido agarra el ítem. Con una ventana de ítems abierta se
  esconde la rueda de combate.
- **Salir a WhatsApp sin perder la partida**: la conexión aguanta con pings; si se corta,
  al volver el juego reconecta solo (sin pedir la clave) y vuelve a prender el MU Helper.

**Página web** (https://barriomu.makeseo.app)
- Cómo empezar, versiones para teléfono y PC con su paso a paso, estado en vivo,
  eventos y últimos ganadores, rankings (nivel con Master Reset, PvP y guilds), noticias
  y reglas.
- **Mi cuenta**: Add Points, PK Clear, desbloquear personaje, Reset, Master Reset y
  cambio de clave (con la cuenta fuera del juego).
- **Referidos (Invita y gana)**: link propio arriba de todo en Mi cuenta. Cuando un amigo
  llega a **nivel 200** ganan los dos. Con 1, 3, 5 y 10 amigos hay joyas, zen, alas de 1ra
  y alas de 3ra; el invitado gana 3 Bless + 3 Soul + 5.000.000 de zen. Se piden desde la
  web y llegan al baúl (vacío). Máximo 10 por mes y 8 cuentas por casa. Ranking de
  reclutadores del mes y de siempre.
- **Panel admin** (solo GM): tienda de puntos (qué se vende, precios, puntos por monstruo,
  dar puntos), jugadores en línea, cuentas y personajes por día, visitas
  por país y caché (Cloudflare), descargas del instalador y botón para purgar la caché.

**Vigilancia**
- **Vigilante**: cada hora GitHub entra al juego como un jugador (cuenta `VIGIA_USUARIO`),
  camina por Lorencia y, si algo falla, abre un aviso (issue) que llega a la app de GitHub.
  Cuando vuelve a funcionar, lo cierra.
- **Vigilante de la tablet**: cada 5 minutos revisa que todo siga prendido y prende lo
  que se haya caído.

## Direcciones

| Dirección | Qué es | En la tablet |
|---|---|---|
| https://mu.makeseo.app | El juego | puerto 8081 |
| wss://mu-ws.makeseo.app | Proxy del juego (y su `server.json`) | puerto 3000 |
| https://mu-registro.makeseo.app | Crear cuenta | puerto 8082 |
| https://barriomu.makeseo.app | Página web (Cloudflare Pages, carpeta `web/`) | - |
| https://mu-api.makeseo.app | API de la página | puerto 3400 |
| http://localhost:8080 | Panel de admin de OpenMU (solo en la tablet) | puerto 8080 |

---

## Comandos de Termux

Todo se escribe en **Termux normal** (`~ $`), **no** dentro de Ubuntu, salvo donde el
comando mismo entra a Ubuntu con `proot-distro login ubuntu`. Pega **uno a la vez** y
espera a que termine.

### Entrar a la tablet desde Termius
- En la casa: host = IP de la tablet en el WiFi, puerto **8022**, usuario **u0_a208**.
- Desde cualquier lugar: el mismo, pero con la IP de **Tailscale** de la tablet
  (empieza con **100.**). Tailscale debe estar prendido en la tablet y en el teléfono.
- Si Termius dice "connection refused", en la tablet abre Termux y escribe:
```bash
sshd
```

### Bajar o actualizar el script `barriomu.sh`
```bash
wget -O ~/barriomu.sh https://raw.githubusercontent.com/bboymak3/openmu-fly-server/main/babylon/barriomu.sh
```

### Manejo diario
```bash
bash ~/barriomu.sh prender        # prende todo (PostgreSQL, OpenMU, juego, túnel) y el vigilante
bash ~/barriomu.sh apagar         # apaga todo
bash ~/barriomu.sh estado         # qué está prendido y qué no
bash ~/barriomu.sh logs           # lo que va pasando (CTRL+C para salir)
bash ~/barriomu.sh arranque       # prende BarrioMU solo al encender la tablet (app Termux:Boot)
bash ~/barriomu.sh panel on       # prende el panel de admin de OpenMU (reinicia OpenMU)
bash ~/barriomu.sh panel off      # lo apaga para ahorrar memoria (reinicia OpenMU)
```

### Actualizar la tablet

Primero espera a que GitHub termine de compilar (pestaña **Actions** del repo). Siempre
empieza apagando y termina prendiendo:
```bash
bash ~/barriomu.sh apagar
```

**Servidor del juego (OpenMU)**: cuando cambian los plugins de `openmu-barrio/`. Debe
terminar diciendo `OPENMU OK`:
```bash
proot-distro login ubuntu -- bash -c 'cd ~ && wget -O openmu.zip https://github.com/bboymak3/openmu-fly-server/releases/download/openmu-arm64/openmu-linux-arm64.zip && unzip -oq openmu.zip -d openmu && echo OPENMU OK'
```

**Cliente, versión corta (lo normal, unos 100 MB)**: solo el código del juego, el
proxy, el registro y la API; deja los gráficos que ya tienes:
```bash
proot-distro login ubuntu -- bash -c 'cd ~ && wget -O actualizar-babylon.sh https://github.com/bboymak3/openmu-fly-server/releases/download/babylon-arm64/actualizar-babylon.sh && bash actualizar-babylon.sh'
```

**Cliente, versión completa (unos 2 GB)**: solo si la corta dice *"Los gráficos
cambiaron"*:
```bash
proot-distro login ubuntu -- bash -c 'cd ~ && wget -O instalar-babylon.sh https://github.com/bboymak3/openmu-fly-server/releases/download/babylon-arm64/instalar-babylon.sh && bash instalar-babylon.sh'
```

Y al final:
```bash
bash ~/barriomu.sh prender
bash ~/barriomu.sh estado
```
Después de actualizar el **cliente**: en la página, **Panel admin → purgar caché de
Cloudflare**, y en el celular cierra el juego del todo y vuelve a abrirlo. Actualizar
**no borra** cuentas ni personajes.

### Configurar el juego
```bash
bash ~/barriomu.sh resets         # activa los resets: nivel 400, sin límite (reinicia OpenMU)
bash ~/barriomu.sh resets estado  # dice si los resets están prendidos
bash ~/barriomu.sh extras         # 5 puntos de la tienda por hora jugada y /addstr /addagi /addvit /addene /addcmd (reinicia OpenMU)
bash ~/barriomu.sh extras estado  # dice si están prendidos
bash ~/barriomu.sh gm CUENTA      # hace GM una cuenta (para el panel admin); con la cuenta fuera del juego
bash ~/barriomu.sh npcs           # lista los NPCs de las ciudades y cuántos están apagados
bash ~/barriomu.sh npcs activar   # prende todos los NPCs y monstruos apagados (reinicia OpenMU)
bash ~/barriomu.sh mapas          # monstruos por mapa, portales y /move: qué sirve y qué está roto
bash ~/barriomu.sh spot           # Lorencia con el triple de monstruos + spot del sur (reinicia OpenMU)
bash ~/barriomu.sh spot 2         # el doble (si la tablet se pone lenta); spot 1 = normal
bash ~/barriomu.sh spot quitar    # quita solo el spot del sur
bash ~/barriomu.sh joyas          # muestra con qué porcentaje caen las joyas
bash ~/barriomu.sh joyas 1        # joyas al 1% por monstruo en todos los mapas (hasta 10)
bash ~/barriomu.sh cloudflare     # guarda en la tablet el token de Cloudflare del panel admin
```

### Ver los puntos por monstruo (se editan en el panel admin)
```bash
proot-distro login ubuntu -- cat ~/openmu/data/puntos.json
```

### Revisar los referidos
```bash
psql -U postgres -d openmu -c 'select * from barrio.referral order by linked_at desc limit 30'
```

### Respaldos

Haz una copia **antes de cualquier cambio grande** y por lo menos una vez por semana.
```bash
pg_dump -U postgres openmu | gzip > ~/respaldo-openmu-$(date +%F).sql.gz
proot-distro login ubuntu -- bash -c 'cd ~/openmu && tar -czf - data' > ~/respaldo-data-$(date +%F).tar.gz
```
Para sacarlos de la tablet (quedan en la carpeta **Descargas**):
```bash
termux-setup-storage
cp ~/respaldo-* ~/storage/downloads/
```
Restaurar la base (⚠️ **reemplaza todo lo actual**; cambia `AAAA-MM-DD` por la fecha):
```bash
bash ~/barriomu.sh apagar
pg_ctl -D $PREFIX/var/lib/postgresql -l $PREFIX/var/lib/postgresql/log.txt -w start
dropdb -U postgres openmu
createdb -U postgres openmu
gunzip -c ~/respaldo-openmu-AAAA-MM-DD.sql.gz | psql -U postgres openmu
bash ~/barriomu.sh prender
```

### ⚠️ Borrar todo y empezar de cero
```bash
bash ~/barriomu.sh reset-db       # BORRA cuentas y personajes; crea barrio01..barrio10 (pide escribir SI)
```

---

## Compilación (GitHub Actions)

Las compilaciones usan versiones fijas de los proyectos originales, para que un cambio
allá no rompa el servidor.

| Workflow | Qué hace | Release |
|---|---|---|
| `build-arm64.yml` | OpenMU para linux-arm64, con los cambios de `openmu-barrio/` | `openmu-arm64` |
| `build-babylon.yml` | Cliente, proxy, registro y API, con lo de `babylon/`. Publica el paquete completo (`instalar-babylon.sh`) y el corto solo con el código (`actualizar-babylon.sh`, que exige la misma huella de gráficos `DATA_VERSION`) | `babylon-arm64` |
| `build-pc.yml` | Instalador de Windows (`desktop/`) con el cliente y los gráficos completos | `barriomu-pc` |
| `vigilante.yml` | Cada hora (minuto 17) entra al juego con `scripts/vigilante.js`; abre o cierra un issue `vigilante`. Secretos `VIGIA_USUARIO` y `VIGIA_CLAVE` | - |

Cambios sobre OpenMU (`openmu-barrio/`):
- Cuentas `barrio01` a `barrio10` (clave igual al usuario), con un personaje nivel 400
  de tercera clase, set +15 y alas de tercera. Se crean con `reset-db`.
- Dos game servers: MIJAGUA (PvP) y ALTOBARINAS (sin PvP, doble drop).
- Sin límite de conexiones por IP: todos los jugadores llegan por el proxy desde 127.0.0.1.
- Premio diario (`BarrioDailyRewardPlugIn`), Master Reset (`BarrioMasterResetPlugIn`,
  `~/openmu/data/master-reset.json`), NPCs de buff (`BarrioBuffNpcsPlugIn`,
  `~/openmu/data/buffs-npc.json`), NPCs de las ciudades (`BarrioTownNpcsPlugIn`) y set
  gratis (`BarrioStarterSetPlugIn`), puntos por dorados y jefes y NPC Cambista
  (`BarrioPointsPlugIn`, `~/openmu/data/puntos.json`).

Cambios sobre el cliente (`babylon/personalizar-cliente.sh` y `babylon/patch-client.py`):
- Logo, lista de mundos (solo BarrioMU) y controles del celular (`babylon/mobile/`).
- Nombres siempre visibles, barra de vida propia, descripción de ítems con el dedo,
  panel de habilidades que no se borra al entrar.
- Reconexión: el proxy manda pings (`idleTimeout` 240 s); la reconexión espera a que la
  página vuelva a estar visible; `server.json` con `retryLoginWhenConnected` y
  `muHelperAfterReconnect` (`babylon/iniciar-cliente.sh`).
- `window.__barrio` para el vigilante.

## Archivos

| Archivo | Para qué |
|---|---|
| `docs/MANUAL.md` | Manual completo en español |
| `babylon/barriomu.sh` | Prender, apagar, vigilar y configurar todo |
| `babylon/iniciar-cliente.sh` | Arranca proxy, página, registro y API (lo usa barriomu.sh) |
| `babylon/servir.ts` | Servidor web mínimo de la página y el registro |
| `babylon/api/` | API de la página: estado, rankings, Mi cuenta (`panel.ts`), admin (`admin.ts`), referidos (`referidos.ts`), tienda de puntos (`tienda.ts`) |
| `babylon/mobile/` | Controles del celular: joystick, rueda de combate, pociones, dedo como cursor (`touchHover.ts`) |
| `babylon/personalizar-cliente.sh`, `babylon/patch-client.py` | Cambios de BarrioMU sobre el cliente (web y PC) |
| `babylon/branding/` | Logo, iconos y lista de servidores |
| `babylon/diagnostico.sh` | Prueba OpenMU, proxy y Cloudflare por separado |
| `openmu-barrio/` | Cambios de BarrioMU sobre OpenMU |
| `scripts/vigilante.js` | El vigilante: entra al juego con Playwright y revisa |
| `web/` | Página web (landing, Mi cuenta, admin); links y reglas en `web/config.js`, noticias en `web/news.json` |
| `desktop/` | Versión para PC: Electron con un servidor local de los gráficos y actualización automática |
