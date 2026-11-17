# Estado de BarrioMU — 17/11/2026 (voz por proximidad F1/F2 + TURN de Cloudflare)

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

### 3.10 Voz por proximidad (WebRTC entre navegadores)

| Endpoint | Para qué |
|---|---|
| `POST /voice/ticket` | el navegador manda el `nonce` de su sesión de juego y el nombre del personaje; se pregunta al proxy (`GET http://127.0.0.1:3001/ticket/<nonce>`) qué cuenta inició sesión y se comprueba en la base que ese personaje sea de esa cuenta; devuelve un ticket firmado (HMAC, vale 5 min) |
| `GET /voice/ice` | servidores STUN/TURN que usa el navegador. Primero pide **credenciales temporales del TURN de Cloudflare** (llave en `~/openmu/data/cf-voz.json`, valen 24 h y se cachean 12 h); si no hay llave o Cloudflare falla, usa `~/openmu/data/voz-ice.json` y, si tampoco está, STUN de Google. Así se agrega o cambia un TURN **sin recompilar el cliente** |
| `GET /voice/estado` | diagnóstico público de solo lectura: de dónde salen los ICE (`cloudflare`/`archivo`/`stun`, con `error` si falló), quiénes están en la sala (nombre, hace cuánto, mensajes) y tickets de los últimos 5 min con el motivo de cada rechazo. Con esto se sabe si el enlace va por `relay` (TURN) o directo |
| `WS /voice?ticket=…` | señalización: quién está conectado, y reenvío de ofertas/respuestas/ICE entre dos jugadores. **El audio no pasa por aquí**: va directo de un navegador al otro |

- Secreto propio de la voz: `~/openmu/data/voz-secreto.txt` (se crea solo, permisos 600).
- TURN: llave `barriomu` de Cloudflare en `~/openmu/data/cf-voz.json`
  (`{"keyId":"…","token":"…"}`, permisos 600). Es TURN gestionado, sin nada instalado;
  entra en los **1 TB gratis al mes** (la voz gasta ~10 MB por hora de escucha). Si la
  llave se filtra o se rota, se cambia el archivo y se reinicia la API: no toca el cliente.
  Sin TURN, dos redes cerradas (datos del celular contra wifi) no logran audio aunque la
  señal diga `ok`.
- **El micrófono exige `https://`**: `mu.makeseo.app` sin `https` carga en claro y Chrome
  bloquea el micrófono. En Cloudflare, `makeseo.app` → SSL/TLS → Edge Certificates →
  **Always Use HTTPS = On** (así escribir el dominio sin `https://` redirige solo).
- Una sola sala. Un socket por personaje: si se reconecta, el anterior se cierra.
- Freno por socket: 150 mensajes cada 10 s; los mensajes de más de 24 KB se descartan.
- El cliente (`babylon/mobile/voiceChat.tsx`) solo abre conexión con los jugadores que el
  juego tiene **dibujados al lado** (máximo 6, los más cercanos) y el volumen baja con la
  distancia (se oye hasta 18 tiles, la conexión se mantiene hasta 26). Así una zona con
  15+ personas no satura la tablet: cada cliente habla con sus vecinos, no con todos.
- El ticket exige una sesión de juego viva: sin estar dentro del juego no hay voz.
- Mientras la voz está prendida, debajo del botón se ve una línea de diagnóstico
  (`señal ok · cerca N · audio M · KBk · estado`): identidad (`cerca 0`), red
  (`falla`/`tic`), enlace mudo (`audio 1` con `0k` que no sube) o audio real (`k` sube al
  hablar). El PTT es **mantener** el botón (o **B**); un toque corto apaga la voz.
- La reproducción de los demás va por un `<audio>` oculto y el volumen por distancia es
  `el.volume` (no AudioContext: en Android el contexto puede quedar suspendido y el enlace
  queda mudo aunque diga `ok`).
- También está en la **PC**: `babylon/pc/index.tsx` monta el mismo botón arriba al centro
  (estilos en `babylon/pc/voice.less`); se habla manteniendo el botón o la tecla **B**
  (la **K** abre la lista de habilidades y la **V** el inventario, por eso no se usan).
- La `Permissions-Policy` de `web/_headers` (landing) sigue sin micrófono; la página del
  juego (`servir.ts`) no manda esa cabecera, así que ahí el micrófono sí está permitido.

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
| `BarrioStarterSetPlugIn.cs` | set básico en la bolsa y **alas básicas puestas** a cada personaje nuevo |
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
`R` para centrar cámara; chat y ayuda `B`/`A` en la línea superior; botón de **voz**
(🎙: un toque prende, mantener habla, otro toque corto apaga; muestra cuántos se oyen);
timers arriba a la derecha; barra inferior **recortada** (sin franja de Q/W/E/R ni la del final); grupo del
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
- La voz no abre puertos nuevos: la señalización entra por el mismo túnel (`/voice`) y el
  audio va directo entre navegadores. Sin ticket firmado (y sin sesión de juego viva) el
  WebSocket responde 401.

## 8. Pendientes / ideas (nada de esto está implementado)

1. **Voz por proximidad**: **F1 y F2 hechos** (señalización en la tablet, ticket con el
   `nonce` de sesión, botón PTT en el HUD móvil —con la tecla `K` equivalente para quien
   use teclado—; audio P2P con volumen por distancia). Falta montar el mismo botón en la
   versión PC/Electron, y F3/F4: **TURN** propio para redes con NAT difícil
   (Cloudflare Realtime o coturn) y un **SFU** solo si algún día hay más de ~15 personas
   hablando a la vez en la misma zona. El servidor del juego no procesa audio.
2. **Globalprov2 (`globalprov2.pages.dev`)**: asignar automáticamente a los técnicos las
   órdenes que llegan de "órdenes-expresas", con un switch para elegir entre automático
   (técnico GLOBAL) y manual. Falta un token de Cloudflare válido para inspeccionarlo.
3. **Inventario de dominios de Cloudflare** (todos los proyectos: dominios propios +
   `*.pages.dev` + `*.workers.dev`). El token `cfat_…` que se probó el 16/11 respondió
   *Invalid access token* (9109): hay que crear uno con permisos de lectura.
