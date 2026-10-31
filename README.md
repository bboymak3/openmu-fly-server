# BarrioMU

Servidor de MU Online Season 6 Episodio 3 que corre en una tablet Android y se
juega desde el navegador en **https://mu.makeseo.app**.

- Servidor: [OpenMU](https://github.com/MUnique/OpenMU) con PostgreSQL, dentro de
  Termux (Ubuntu con proot-distro).
- Cliente: [OpenMu Client Babylon](https://github.com/Ignies/OpenMu-Client-Babylon)
  con el logo y la lista de servidores de BarrioMU.
- Internet: Cloudflare Tunnel, sin abrir puertos ni IP publica.

## Servidores

| Servidor | PvP | Drop |
|---|---|---|
| MIJAGUA | Si | Normal |
| ALTOBARINAS | No | Doble |

## Direcciones

| Direccion | Que es | En la tablet |
|---|---|---|
| https://mu.makeseo.app | El juego | puerto 8081 |
| wss://mu-ws.makeseo.app | Proxy del juego | puerto 3000 |
| https://mu-registro.makeseo.app | Crear cuenta | puerto 8082 |
| https://barriomu.makeseo.app | Landing (Cloudflare Pages) | - |
| https://mu-api.makeseo.app | API de la landing | puerto 3400 |
| http://localhost:8080 | Panel de admin de OpenMU (solo en la tablet) | puerto 8080 |

## Landing (https://barriomu.makeseo.app)

Pagina informativa en `web/`: estado en vivo, eventos, rankings de nivel y PvP,
noticias y reglas. Es estatica (HTML, CSS y JS sin compilar) y lee la API de la
tablet en `https://mu-api.makeseo.app` (`babylon/api/main.ts`, puerto 3400).

- **Cloudflare Pages**: conectar este repo, rama `main`, sin comando de
  compilacion, carpeta de salida `web`. Dominio propio `barriomu.makeseo.app`.
- **Tunel**: ruta `mu-api.makeseo.app` -> `http://localhost:3400`.
- Links, caracteristicas y reglas: `web/config.js`. Noticias: `web/news.json`.
- **Mi cuenta** (`web/cuenta.html`, `babylon/api/panel.ts`): login con la cuenta
  del juego, Add Points, PK Clear, desbloquear personaje y cambio de clave.
  Solo con la cuenta desconectada (lo confirma el proxy) y un minuto despues
  de salir del juego. Limite de intentos de login por IP y por cuenta.
  Con los resets activos tambien tiene el boton Reset (mismas reglas que
  /reset en el juego).

## Manejo diario (Termux normal, `~ $`)

```bash
bash ~/barriomu.sh prender     # prende todo y el vigilante
bash ~/barriomu.sh apagar      # apaga todo
bash ~/barriomu.sh estado      # que esta prendido
bash ~/barriomu.sh logs        # lo que va pasando
bash ~/barriomu.sh arranque    # prender solo al encender la tablet (Termux:Boot)
bash ~/barriomu.sh reset-db    # BORRA la base y crea barrio01..barrio10
bash ~/barriomu.sh panel on|off # panel de admin bajo demanda
bash ~/barriomu.sh resets      # activa los resets (nivel 400, sin limite)
```

El script se descarga con:

```bash
wget -O ~/barriomu.sh https://raw.githubusercontent.com/bboymak3/openmu-fly-server/main/babylon/barriomu.sh
```

## Compilacion (GitHub Actions)

Las dos compilaciones usan versiones fijas, para que un cambio en los proyectos
originales no rompa el servidor.

| Workflow | Que compila | Release |
|---|---|---|
| `build-arm64.yml` | OpenMU para linux-arm64, con los cambios de `openmu-barrio/` | `openmu-arm64` |
| `build-babylon.yml` | Cliente, proxy y registro, con el logo de `babylon/branding/` | `babylon-arm64` |

Cambios sobre OpenMU (`openmu-barrio/`):

- Cuentas `barrio01` a `barrio10` (clave igual al usuario), cada una con un
  personaje nivel 400 de tercera clase, set +15 y alas de tercera. Se crean al
  hacer `reset-db`.
- Dos game servers: MIJAGUA (PvP) y ALTOBARINAS (sin PvP, doble drop).
- Sin limite de conexiones por IP en el Connect Server: todos los jugadores
  llegan por el proxy desde 127.0.0.1.
- Premio diario de 5.000.000 de zen por cuenta.
- Master Reset (`/masterreset` o el panel): con 50 resets y nivel 400 vuelve a
  0 resets; cada Master Reset suma 10.000 puntos a cada reset. Se guarda en
  `~/openmu/data/master-reset.json` (la API lo lee para el ranking).
- NPCs en Lorencia, frente a la fuente: Guerrero (David, +20% ataque y magia, 30 min)
  y Fortuna (Delgado, doble EXP y doble drop, 45 min, cada 3 horas). Lo que queda de los
  buffs se guarda en `~/openmu/data/buffs-npc.json`.
- Últimos ganadores de Blood Castle, Devil Square y Chaos Castle en la landing:
  la API los lee de `data."MiniGameRankingEntry"`, donde OpenMU ya los guarda.

## Archivos

| Archivo | Para que |
|---|---|
| `babylon/barriomu.sh` | Prender, apagar y vigilar todo |
| `babylon/iniciar-cliente.sh` | Arranca proxy, pagina y registro (lo usa barriomu.sh) |
| `babylon/servir.ts` | Servidor web minimo de la pagina y el registro |
| `babylon/diagnostico.sh` | Prueba OpenMU, proxy y Cloudflare por separado |
| `babylon/branding/` | Logo, iconos y lista de servidores |
| `openmu-barrio/` | Cambios de BarrioMU sobre OpenMU |
