# Estado de BarrioMU — 16/11/2026

**El juego está terminado y en producción.** Este documento es la foto técnica del
proyecto: qué corre, dónde, y el mapa completo de APIs y endpoints. El manual de uso está
en `docs/MANUAL.md`; la presentación del servidor, en `README.md`.

| Dato | Valor |
|---|---|
| Rama | `main` |
| Último commit revisado | `27bac4f` — *Merge PR #83: botón del bot de Telegram* (14/11/2026) |
| Cliente Babylon fijado | `26c0921c1bed65b1aab4762022f24021a5318130` |
| Release cliente tablet | `babylon-arm64` (14/11/2026 14:08) |
| Release servidor | `openmu-arm64` (11/11/2026 22:53) |
| Release PC | `barriomu-pc` (14/11/2026 05:29) |

## 1. Dónde vive cada cosa

| URL | Qué sirve | Origen |
|---|---|---|
| `https://mu.makeseo.app` | cliente de juego (web y app del celular) | `mu-servir` (8081) + túnel |
| `https://mu.makeseo.app/api/*` | registro de cuentas | `register/server` (8082) |
| `https://mu-registro.makeseo.app` | registro de cuentas (directo) | `register/server` (8082) |
| `https://mu-ws.makeseo.app` | WebSocket del juego (versión PC) | proxy (3001) |
| `https://mu-api.makeseo.app` | **API de la landing, Mi cuenta y admin** | `babylon/api/main.ts` (3400) |
| `https://barriomu.makeseo.app` | landing, Mi cuenta, tienda, cash shop, La Plaza, admin, bot | Cloudflare Pages (`web/`) |
| `https://github.com/bboymak3/openmu-fly-server/releases` | binarios y actualizador | GitHub Actions |

Todo detrás de **Cloudflare Tunnel** (sin puertos abiertos ni IP pública) y con caché de
Cloudflare para los gráficos. Acceso remoto a la tablet: SSH (puerto 8022) con Termius y
Tailscale.

## 2. Servicios en la tablet

| Servicio | Puerto | Nota |
|---|---|---|
| PostgreSQL | 5432 | base `openmu` |
| OpenMU (game servers) | 45901/45902 MIJAGUA (PvP) · 45903/45904 ALTOBARINAS (sin PvP, doble drop) | C# .NET, binario `openmu-arm64` |
| Proxy (presencia + WS) | 3001 | `GET /presence/<cuenta>` dice si el jugador está conectado |
| API | 3400 | solo `127.0.0.1`; el túnel la publica como `mu-api.makeseo.app` |
| Página del juego | 8081 | cliente compilado (`mu-servir`) |
| Página de registro | 8082 | |
| Bot de WhatsApp (Baileys) | — | **apagado** |
| Vigilante interno | — | revisa cada 5 min y vuelve a prender lo caído |

Control: `bash ~/barriomu.sh` (`prender`, `apagar`, `estado`, `logs`, `memoria`,
`limpiar`, `optimizar`, `vigilar`, `arranque`, `reset-db`…). Ver `docs/MANUAL.md` §4.

## 3. API — `babylon/api/` (3400, publicado en `mu-api.makeseo.app`)

CORS solo para `https://barriomu.makeseo.app`. Las rutas públicas se cachean 20–60 s.
Las respuestas de error vuelven como `{ "error": "..." }` con 4xx/5xx.

### 3.1 Públicas (GET, sin login)

| Endpoint | Devuelve |
|---|---|
| `/status` | jugadores conectados, servidores, estado general |
| `/rankings/level?limit=1..100` | top por nivel (con Master Reset) |
| `/rankings/pvp?limit=` | top PvP |
| `/rankings/guilds?limit=` | top de guilds |
| `/events` | Blood Castle, Devil Square, Chaos Castle: activo y próximas 3 horas |
| `/events/winners?limit=≤30` | últimos ganadores |

### 3.2 Panel del jugador (Mi cuenta) — `Authorization: Bearer <token>`

Sesión de 2 h deslizante, contraseña **bcrypt de la cuenta del juego**; 429 tras varios
intentos fallidos (15 min).

| Endpoint | Qué hace |
|---|---|
| `POST /auth/login` | `{account, password}` → `{token}` |
| `POST /auth/logout` | cierra la sesión |
| `GET /me` | cuenta, personajes, monedas, stats |
| `POST /me/add-points` | repartir puntos |
| `POST /me/pk-clear` | limpiar PK |
| `POST /me/unstuck` | sacar personaje de un mapa donde quedó atascado |
| `POST /me/reset` | reset |
| `POST /me/master-reset` | Master Reset |
| `POST /me/password` | cambiar clave |

> Todo cambio se hace con la cuenta **desconectada** (`offlineTransaction`): OpenMU
> escribe desde memoria al salir y pisaría lo hecho por la API. Antes se consulta
> `http://127.0.0.1:3001/presence/<cuenta>`.

### 3.3 Tienda de puntos (Goblin Points)

| Endpoint | Qué hace |
|---|---|
| `GET /tienda` | catálogo prendido (`barrio.points_shop`) |
| `GET /me/tienda` | catálogo + puntos del jugador |
| `POST /me/tienda/comprar` | compra → ítem al baúl |
| `POST /me/monedas/convertir` | WCoinC → WCoinP (tasa en `barrio.settings`) |

### 3.4 Cash Shop (WCoinC)

| Endpoint | Qué hace |
|---|---|
| `GET /cashshop` | 3 líneas: alas, ítems de misión, cofre sorpresa |
| `GET /me/cashshop` | catálogo + WCoinC |
| `POST /me/cashshop/comprar` | compra (límite diario por cuenta: `barrio.cash_daily`) |

### 3.5 La Plaza (mercado entre jugadores, WCoinP)

| Endpoint | Qué hace |
|---|---|
| `GET /me/mercado` | publicaciones + mis ventas |
| `POST /me/mercado/vender` | publica un ítem del baúl (pasa a baúl de custodia) |
| `POST /me/mercado/comprar` | compra (ítem a mi baúl) |
| `POST /me/mercado/retirar` | retira lo no vendido |
| `POST /me/mercado/cobrar` | cobra lo vendido, menos impuesto (25% por defecto) |

### 3.6 Referidos

| Endpoint | Qué hace |
|---|---|
| `GET /me/referidos` | código, link, invitados, progreso |
| `POST /me/referidos/codigo` | aplicar un código |
| `POST /me/referidos/reclamar` | reclamar premio |
| `GET /referidos/ranking` | ranking de invitadores |
| `GET /referidos/codigo?codigo=…` | validar un código |

Reglas: cuenta nueva (< `NEW_ACCOUNT_DAYS = 30` días) y sin personaje en la meta; el
invitado cuenta al llegar a **nivel 200** o al hacer un reset; máx. **10** invitados por
mes; máx. **8** cuentas por casa/IP.

### 3.7 WhatsApp de la cuenta (inactivo hoy)

| Endpoint | Qué hace |
|---|---|
| `GET /me/whatsapp` | estado de vinculación |
| `POST /me/whatsapp/codigo` | genera código de 6 dígitos (15 min) |
| `POST /me/whatsapp/desvincular` | suelta el número |

### 3.8 Panel de admin (solo cuentas GM, sesión por cookie)

`web/admin.html` en `barriomu.makeseo.app`. Login bcrypt contra la cuenta OpenMU con
estado GameMaster / GameMasterInvisible; 429 tras varios intentos; auditoría en
`barrio.admin_log`.

| Endpoint | Qué hace |
|---|---|
| `POST /admin/login` · `POST /admin/logout` | sesión (2 h) |
| `GET /admin/stats` | jugadores, cuentas y personajes nuevos, top resets, visitas por país (Cloudflare), descargas del instalador (GitHub) |
| `POST /admin/purge` | borra la caché de Cloudflare del juego |
| `GET /admin/tienda` · `POST /admin/tienda/guardar|agregar|quitar` | catálogo de la tienda de puntos |
| `GET /admin/cashshop` · `POST /admin/cashshop/guardar` | catálogo del cash shop |
| `GET /admin/sabio` · `POST /admin/sabio/guardar` | IA: prendida, cupo, período |
| `POST /admin/puntos/monstruos` | puntos por monstruo (`data/puntos.json`) |
| `POST /admin/puntos/dar` | dar/quitar puntos o WCoin a una cuenta |
| `GET /admin/economia` · `POST /admin/economia/guardar` | tasa WCoinC→WCoinP e impuesto |
| `GET /admin/registro` | auditoría |

### 3.9 Internas (solo loopback + secreto compartido)

Responden **404** si la petición trae `cf-connecting-ip` (o sea, si viene por el túnel) o
si el secreto no coincide. Secreto: `~/openmu/data/sabio-secreto.txt`.

| Endpoint | Quién lo llama | Para qué |
|---|---|---|
| `POST /sabio` | `BarrioSabioPlugIn.cs` (comando `/ia`) | pregunta del jugador → Workers AI (Llama 3.3) |
| `POST /aviso` | `BarrioAvisosPlugIn.cs` | eventos del juego → avisos por Telegram |
| `POST /wa-chat` | `BarrioAvisosPlugIn.cs` | susurro dentro del juego a un jugador (`@Nombre mensaje`, respuesta con `/wa`) |
| `POST /whatsapp` | `babylon/whatsapp/bot.mjs` | mensaje entrante del bot de WhatsApp |
| `POST /evolution` | webhook de Evolution API | **sin uso** (Railway eliminado) |

## 4. Bots

| Canal | Estado | Detalle |
|---|---|---|
| **Telegram** `@Barriomubot` | **activo** | token en `~/.barriomu-telegram` (dentro de Ubuntu); `startTelegram()` hace long-poll `getUpdates`. Avisos, alertas de eventos, resumen diario y `/wa` salen **solo** por aquí |
| WhatsApp (bot en la tablet) | apagado | `babylon/whatsapp/bot.mjs` (Baileys). Regla: **nunca escribe primero** (`canWriteFirst`); los envíos masivos hicieron que WhatsApp bloqueara el número |
| WhatsApp (Evolution API en Railway) | **eliminado** | el proyecto `barriomu-whatsapp` se borró por seguridad; `barriomu.sh evolution` quedaría para el futuro |

Comandos del bot (Telegram y, si se reactiva, WhatsApp): `estado`, `top`, `mi puesto`,
`eventos`, `avisar <evento|todos>` / `no avisar`, `resumen si|no`, `@Nombre mensaje`,
`vincular 123456` / `desvincular`, `reset <personaje>`, `puntos <personaje> <stat> <n>`
(con confirmación "si" en 2 min), y `admin …` para cuentas GM.

## 5. Plugins del juego (`openmu-barrio/`)

| Archivo | Qué hace |
|---|---|
| `BarrioPointsPlugIn.cs` | puntos (Goblin Points) por monstruos dorados y jefes; tabla en `data/puntos.json` |
| `BarrioOnlineNpcPlugIn.cs` | NPC "Premio" en Lorencia: +3 puntos cada 20 min conectado |
| `BarrioDailyRewardPlugIn.cs` | 5.000.000 de zen por cuenta, una vez al día |
| `BarrioMasterResetPlugIn.cs` | comando `/masterreset` |
| `BarrioBuffNpcsPlugIn.cs` | NPCs Guerrero (+20% ataque/magia 30 min) y Fortuna (doble EXP/drop 45 min, cada 3 h) |
| `BarrioStarterSetPlugIn.cs` | set básico gratis a cada personaje nuevo |
| `BarrioTownNpcsPlugIn.cs` | repone NPCs de tiendas/baúl/misiones en Lorencia, Devias, Noria, Elbeland |
| `BarrioSpotsPlugIn.cs` | spots de farmeo (`/guardarspot`) y viaje del personaje a un spot por el bot |
| `BarrioSabioPlugIn.cs` | comando `/ia`: manda la pregunta a la API con el secreto |
| `BarrioAvisosPlugIn.cs` | cuenta a la API lo que pasa (subidas de nivel, resets, muertes farmeando, susurros) |
| `BarrioOfflineRespawnPolicy.cs` | que un personaje en `/offlevel` siga farmeando después de morir |
| `BarrioStore.cs` | almacén JSON de los plugins (`data/<nombre>.json`) |
| `BarrioTownNpcs`/`BarrioAccount`/`TestAccountsInitialization` | datos de arranque y cuentas de prueba |

Tablas propias: `barrio.settings`, `points_shop`, `points_log`, `cash_shop`, `cash_daily`,
`cash_log`, `market_listing`, `referral`, `referral_code`, `referral_claim`, `wa_link`,
`wa_code`, `wa_alert`, `wa_snapshot`, `wa_snapshot_acc`, `sabio_uso`, `sabio_cupo`,
`sabio_log`, `admin_log`.

## 6. Cliente y HUD de celular

Cliente Babylon parcheado (upstream fijo en `BABYLON_COMMIT`). El parche vive en
`babylon/patch-client.py`; las piezas móviles en `babylon/mobile/`; el branding y los
copiados en `babylon/personalizar-cliente.sh`. Todo lo de celular va bajo `.mu-mobile`.

Estado actual del HUD móvil: joystick; rueda de combate (ataque grande, 3 habilidades, ✕,
✋ recoger, círculo de alcance, lista "Atacar objetivo"); pociones Q/W grandes; cámara con
arrastre y pellizco (sin pan, sin botones de zoom); pantalla completa automática; botón
`R` para centrar cámara; chat y ayuda `B`/`A` en la línea superior; timers arriba a la
derecha; barra inferior **recortada** (sin franja de Q/W/E/R ni la del final); grupo del
puño pegado al borde inferior derecho; nombres siempre visibles con **presión larga 0.7 s**
para el menú de jugador (trueque, party, susurro) y cierre al tocar fuera; descripción de
ítems manteniendo el dedo.

Versión PC: mismo cliente con gráficos completos (Electron, puerto fijo 47801,
auto-update desde el release `barriomu-pc`), más teclas de cámara y círculo de alcance.

## 7. Seguridad

- Sin puertos abiertos: todo por Cloudflare Tunnel. `web/_headers` fija CSP, `nosniff`,
  `X-Frame-Options: DENY` y `Permissions-Policy` sin cámara/micrófono/geolocalización.
- `/admin/*` solo se abre con una cuenta GM y contraseña (bcrypt + bloqueo temporal).
  Recomendado: ponerle **Cloudflare Zero Trust / Access** delante.
- Endpoints internos: solo loopback, rechazan el túnel y exigen secreto compartido.
- Tokens (nunca en el repo): GitHub en `~/.config/barriomu/gh_token` (este entorno);
  Cloudflare admin en la tablet (`CF_TOKEN_FILE`); Workers AI en `~/.barriomu-ia`;
  secreto del Sabio en `~/openmu/data/sabio-secreto.txt`; Telegram en
  `~/.barriomu-telegram`.
- El bot de WhatsApp no escribe primero para no ser bloqueado.

## 8. Pendientes / ideas (nada de esto está implementado)

1. **Voz por proximidad** (estilo "proximity voice chat") en el cliente web: WebRTC +
   audio por distancia con las posiciones que ya entrega el servidor. Señalización con
   Cloudflare Workers + Durable Objects; para **más de 15 voces** hace falta un **SFU**
   (Cloudflare Realtime o LiveKit/mediasoup). Plan por fases F1–F4; el servidor del juego
   no procesa audio. GitHub Actions solo compilaría el cliente.
2. **Globalprov2 (`globalprov2.pages.dev`)**: asignar automáticamente a los técnicos las
   órdenes que llegan de "órdenes-expresas", con un switch para elegir entre automático
   (técnico GLOBAL) y manual. Falta un token de Cloudflare válido para inspeccionarlo.
3. **Inventario de dominios de Cloudflare** (todos los proyectos: dominios propios +
   `*.pages.dev` + `*.workers.dev`). El token `cfat_…` que se probó el 16/11 respondió
   *Invalid access token* (9109): hay que crear uno con permisos de lectura.
