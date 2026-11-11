# Manual de BarrioMU

Guía en español para manejar, actualizar y arreglar BarrioMU sin ayuda.
Está escrita para seguirla **paso a paso, un comando a la vez**.

> Regla de oro: los comandos se pegan **uno por uno**. Espera a que termine cada
> uno (vuelve a salir el `$`) antes de pegar el siguiente.

---

## Índice

1. [Cómo está armado](#1-cómo-está-armado)
2. [Direcciones y puertos](#2-direcciones-y-puertos)
3. [Entrar a la tablet (Termius / Tailscale)](#3-entrar-a-la-tablet)
4. [Manejo diario: barriomu.sh](#4-manejo-diario-barriomush)
5. [Actualizar la tablet](#5-actualizar-la-tablet)
6. [Funciones del juego](#6-funciones-del-juego)
7. [Cuentas y administración](#7-cuentas-y-administración)
8. [La landing y el panel Mi cuenta](#8-la-landing-y-el-panel-mi-cuenta)
9. [Cloudflare: túnel, caché y Pages](#9-cloudflare-túnel-caché-y-pages)
10. [Versión para PC (.exe)](#10-versión-para-pc-exe)
11. [Respaldos (copias de seguridad)](#11-respaldos)
12. [Problemas comunes y soluciones](#12-problemas-comunes-y-soluciones)
13. [Para hacer cambios en el código](#13-para-hacer-cambios-en-el-código)
14. [Seguridad](#14-seguridad)

---

## 1. Cómo está armado

```
Jugadores (celular / navegador)        Jugadores (PC con BarrioMU-Setup.exe)
            │                                        │
            └──────────────┬─────────────────────────┘
                           ▼
                Cloudflare (internet)
   - mu.makeseo.app (juego web, con caché de gráficos)
   - mu-ws.makeseo.app (conexión del juego)
   - mu-registro / mu-api
                           │  Túnel "barriomu" (sin abrir puertos)
                           ▼
                   TABLET ANDROID (Termux)
   ┌──────────────────────────────────────────────────────────┐
   │ PostgreSQL (base de datos)            ← Termux normal    │
   │ cloudflared (túnel)                   ← Termux normal    │
   │ Ubuntu (proot-distro):                                   │
   │   ~/openmu   → OpenMU (servidor del juego)               │
   │   ~/babylon  → proxy, página del juego, registro y API   │
   └──────────────────────────────────────────────────────────┘
```

- **Servidor del juego:** OpenMU (Season 6 Episodio 3), compilado por GitHub para la tablet.
- **Cliente:** OpenMu Client Babylon (se juega en el navegador). Versión **lite** para el celular
  y versión **completa** para PC.
- **Base de datos:** PostgreSQL en Termux (usuario `postgres`, base `openmu`).
- **Internet:** Cloudflare Tunnel. No hace falta IP pública ni abrir puertos del router.
- **Todo el código** está en GitHub: `bboymak3/openmu-fly-server`. GitHub compila solo cada versión
  y la deja en **Releases**.

---

## 2. Direcciones y puertos

| Dirección | Qué es | Puerto en la tablet |
|---|---|---|
| https://barriomu.makeseo.app | Landing (Cloudflare Pages) | – |
| https://mu.makeseo.app | El juego (celular / navegador) | 8081 |
| wss://mu-ws.makeseo.app | Conexión del juego (proxy) | 3000 |
| https://mu-registro.makeseo.app | Crear cuenta | 8082 |
| https://mu-api.makeseo.app | API de la landing y del panel | 3400 |
| http://localhost:8080 | Panel de admin de OpenMU (solo en la tablet) | 8080 |

Puertos internos de OpenMU: Connect Server **44405**, MIJAGUA **45901/45902**,
ALTOBARINAS **45903/45904**. Registro interno **3100**, presencia del proxy **3001**.

**Servidores del juego:**

| Servidor | PvP | Drop |
|---|---|---|
| MIJAGUA | Sí | Normal |
| ALTOBARINAS | No | Doble |

---

## 3. Entrar a la tablet

### En la misma red (WiFi de la casa)
1. En la tablet, Termux debe tener `sshd` prendido (se prende con `sshd`).
2. En **Termius**: host = IP de la tablet en la casa (ej. `192.168.20.x`), puerto **8022**,
   usuario **u0_a208**.

### Desde cualquier lugar: Tailscale (gratis)
1. Instala **Tailscale** en la tablet y en tu teléfono, con **la misma cuenta**.
2. En la tablet, anota la IP que empieza con **100.** (no cambia nunca).
3. En Android de la tablet: **Batería → Tailscale → Sin restricciones**.
4. En Termius cambia el host por esa IP **100.x.x.x** (puerto 8022, mismo usuario).

> Android permite **una sola VPN a la vez**. Si usas otra VPN en el teléfono, apágala para usar Tailscale.

---

## 4. Manejo diario: barriomu.sh

Se usa en **Termux normal** (`~ $`), **no** dentro de Ubuntu.

| Comando | Qué hace |
|---|---|
| `bash ~/barriomu.sh prender` | Prende PostgreSQL, OpenMU, cliente, túnel y el vigilante |
| `bash ~/barriomu.sh apagar` | Apaga todo |
| `bash ~/barriomu.sh estado` | Muestra qué está prendido (`[OK]`) y qué no |
| `bash ~/barriomu.sh logs` | Muestra lo que va pasando (salir con **CTRL+C**) |
| `bash ~/barriomu.sh arranque` | Prende BarrioMU solo al encender la tablet (necesita **Termux:Boot**) |
| `bash ~/barriomu.sh panel on` | Prende el panel de admin (reinicia OpenMU) |
| `bash ~/barriomu.sh panel off` | Lo apaga para ahorrar memoria (reinicia OpenMU) |
| `bash ~/barriomu.sh resets` | Activa o reaplica la configuración de resets (reinicia OpenMU) |
| `bash ~/barriomu.sh gm CUENTA` | Hace GM una cuenta, para entrar al panel admin (con la cuenta fuera del juego) |
| `bash ~/barriomu.sh cloudflare` | Guarda en la tablet el token de Cloudflare del panel admin |
| `bash ~/barriomu.sh npcs` | Lista los NPCs de las ciudades en la base y cuántos NPCs/monstruos están apagados |
| `bash ~/barriomu.sh npcs activar` | Vuelve a prender todos los NPCs y monstruos apagados (reinicia OpenMU) |
| `bash ~/barriomu.sh mapas` | Solo mira: monstruos de cada mapa, los de Lorencia, los portales entre mapas y los destinos de /move (dice cuáles están rotos o llevan a un mapa apagado) |
| `bash ~/barriomu.sh spot` | Lorencia con el **triple** de monstruos en todas las salidas de la ciudad (norte, este, sur y oeste: Bull Fighter, Hound, Budge Dragon, Spider, Elite Bull Fighter, Lich, Gigante, Esqueleto) y el **spot del sur** (x 140-170, y 185-215: 25 Gigantes, 25 Esqueletos, 20 Lich). Repone las zonas que falten, no duplica. Unos 940 monstruos. Reinicia OpenMU |
| `bash ~/barriomu.sh spot 1` / `spot 2` | Lo mismo con la cantidad normal (unos 360) o el doble |
| `bash ~/barriomu.sh spot quitar` | Quita solo el spot del sur. Reinicia OpenMU |
| `bash ~/barriomu.sh joyas` | Muestra con qué porcentaje caen Bless, Soul, Chaos, Life y Creation y en cuántos mapas |
| `bash ~/barriomu.sh joyas 1` | Las hace caer con 1% por monstruo (o el número que pongas, hasta 10) en todos los mapas. ALTOBARINAS y el buff de Fortuna lo duplican. Reinicia OpenMU |
| `bash ~/barriomu.sh reset-db` | ⚠️ **BORRA TODA LA BASE** y la crea de nuevo (pide escribir `SI`) |

- El **vigilante** revisa cada 5 minutos y vuelve a prender lo que se haya caído.
- Los registros (logs) están en `~/barriomu-logs/`.

### El vigilante de afuera (GitHub Actions)

Cada hora (minuto 17) GitHub entra al juego por `mu.makeseo.app` como un jugador:
elige BarrioMU, inicia sesión con la cuenta del vigilante, entra con su personaje,
cuenta los NPCs de alrededor, camina un poco y se va (`scripts/vigilante.js`,
`.github/workflows/vigilante.yml`).

- Si algo falla abre un **issue** "🔴 BarrioMU con problemas" que te llega a la app
  de GitHub. Mientras siga fallando solo pone al día ese issue (no suena cada hora).
  Cuando vuelve a funcionar comenta "✅ Volvió a funcionar" y lo cierra.
- Las capturas de cada paso quedan en la ejecución (Actions → Vigilante de BarrioMU → artefacto `vigilante-capturas`).
- Necesita dos secretos del repo (Settings → Secrets and variables → Actions):
  `VIGIA_USUARIO` y `VIGIA_CLAVE`, de una cuenta solo para el vigilante con **un personaje**
  (que no sea GM). La clave nunca se escribe en el código.
- Para probarlo a mano: Actions → Vigilante de BarrioMU → Run workflow.

Para bajar la última versión del script:

```bash
wget -O ~/barriomu.sh https://raw.githubusercontent.com/bboymak3/openmu-fly-server/main/babylon/barriomu.sh
```

---

## 5. Actualizar la tablet

Cuando haya cambios (nuevas funciones, arreglos), primero espera a que GitHub termine de compilar
(se ve en la pestaña **Actions** del repo; suele tardar de 5 a 20 minutos). Luego, uno por uno:

**1. Apagar**
```bash
bash ~/barriomu.sh apagar
```

**2. Actualizar OpenMU** (el servidor del juego). Debe terminar diciendo `OPENMU OK`:
```bash
proot-distro login ubuntu -- bash -c 'cd ~ && wget -O openmu.zip https://github.com/bboymak3/openmu-fly-server/releases/download/openmu-arm64/openmu-linux-arm64.zip && unzip -oq openmu.zip -d openmu && echo OPENMU OK'
```

**3. Actualizar el cliente** (página del juego, proxy, registro y API):
```bash
proot-distro login ubuntu -- bash -c 'cd ~ && wget -O instalar-babylon.sh https://github.com/bboymak3/openmu-fly-server/releases/download/babylon-arm64/instalar-babylon.sh && bash instalar-babylon.sh'
```

**Actualización corta del cliente (unos 30 MB en vez de 2 GB)**: cuando solo cambió el código
(lo normal), en lugar del paso 3:
```bash
proot-distro login ubuntu -- bash -c 'cd ~ && wget -O actualizar-babylon.sh https://github.com/bboymak3/openmu-fly-server/releases/download/babylon-arm64/actualizar-babylon.sh && bash actualizar-babylon.sh'
```
Baja solo el código (juego, proxy, registro y API) y deja los gráficos que ya tienes. Si los
gráficos cambiaron, o si la tablet todavía no tiene la marca `~/babylon/DATA_VERSION` (la trae la
instalación completa a partir de esta versión), lo avisa y hay que usar el paso 3 completo.

**4. Prender**
```bash
bash ~/barriomu.sh prender
```

**5. Revisar**
```bash
bash ~/barriomu.sh estado
```

Notas:
- Actualizar **no borra** personajes ni cuentas: la base de datos queda igual.
- Los archivos de `~/openmu/data/` (premio diario, Master Reset, buffs) **se conservan** porque
  el zip se descomprime encima (`unzip -o`).
- Si solo cambió el servidor, basta con el paso 2; si solo cambió el cliente, el paso 3.
- Después de actualizar el **cliente**, borra la caché de Cloudflare (ver [sección 9](#caché-de-gráficos)).

---

## 6. Funciones del juego

### En el celular

- **Nombres**: el nombre de cada jugador (y el tuyo) se ve siempre encima de la cabeza, con
  su guild; sobre tu personaje hay una barra de vida (y sobre los de tu party).
- **Descripción de un ítem**: mantén el dedo sobre el ítem (inventario, equipo, baúl, tienda,
  trade): sale su descripción arriba del dedo y, si arrastras, va mostrando la de cada ítem.
  Al soltar no se agarra nada y la descripción se queda hasta que vuelvas a tocar la pantalla.
  Un **toque rápido** agarra el ítem como siempre.
- Con el inventario, el baúl, una tienda o un trade abiertos se esconde la rueda de combate.
- **Salir a otra app** (WhatsApp): el proxy manda pings para que la conexión aguante y espera
  4 minutos antes de darla por muerta. Si igual se corta, al volver el juego reconecta solo:
  no gasta intentos mientras estás fuera, reintenta si la sesión vieja sigue abierta (OpenMU la
  cierra) y vuelve a prender el MU Helper (server.json del proxy, `babylon/iniciar-cliente.sh`).

### Set gratis para personajes nuevos

Cada personaje que se crea recibe en la bolsa el set más básico de su clase, +0
(plugin `BarrioStarterSetPlugIn`). No va puesto porque pide un poco más de fuerza que
la de un personaje recién creado: se lo pone a los pocos niveles.

| Clase | Set |
|---|---|
| Dark Wizard | Pad |
| Dark Knight, Dark Lord | Leather |
| Fairy Elf | Vine |
| Magic Gladiator | Leather sin casco |
| Summoner | Mistery |
| Rage Fighter | Leather sin guantes |

Solo para personajes nuevos: los que ya existen no lo reciben.

### Cuentas de prueba
`barrio01` a `barrio10` (clave igual al usuario). Cada una con un personaje nivel 400 de tercera
clase, set +15 y alas de tercera. Se crean al hacer `reset-db`.

### Premio diario
5.000.000 de zen por cuenta, la primera vez que entra cada día (el día cambia a medianoche UTC-4).
Se guarda en `~/openmu/data/premio-diario.json`.

### Resets
- Se activan con `bash ~/barriomu.sh resets`.
- Nivel **400**, sin límite, estadísticas a cero, nivel después del reset **1**.
- Cuesta **1.000.000 de zen × número de reset** y da **1.500 puntos × número de reset**.
- En el juego: `/reset`, o el NPC **Leo** en Lorencia, o el botón Reset del panel **Mi cuenta**.
- Para cambiar los números: edita `RESET_CONFIG` en `babylon/barriomu.sh`, sube el cambio y
  vuelve a correr `bash ~/barriomu.sh resets` en la tablet.

### Master Reset
- Requisito: **50 resets** y nivel **400**.
- En el juego: escribe `/masterreset`. También desde el panel **Mi cuenta** (botón ⭐).
- Los resets vuelven a 0, el nivel y las estadísticas al inicio, y recibes **10.000 puntos × Master Reset**.
- Desde entonces **cada reset da 10.000 puntos extra por cada Master Reset** (ej.: con 1 MR, el
  reset 1 da 1.500 + 10.000 = 11.500).
- En el ranking, el Master Reset va primero (columna **MR**).
- Se guarda en `~/openmu/data/master-reset.json` (por id de personaje).

### El Sabio del Barrio (IA, comando /ia)
En el juego hay dos formas:
- **El NPC "Sabio del Barrio"** en Lorencia, al lado del herrero Hanzo, hacia la salida (cerca de 119, 141): al hacerle
  clic saluda y **se abre el chat dirigido al Sabio**; se escribe la pregunta normal, sin `/ia`
  (el cliente la manda como `/ia`). Mientras el susurro siga apuntando al Sabio, cada mensaje
  es otra pregunta; para hablar con otros, se cambia el destinatario del susurro.
- **`/ia` y una pregunta** (ej. `/ia cuanto me falta para el reset?`), desde cualquier mapa.

Preguntas de hasta 56 letras (el chat de MU deja 60). Contesta por
**susurro** del "Sabio" en 1 a 5 segundos, con los datos reales del personaje (nivel, resets, zen,
puntos, monedas, mapa), los precios reales de la tienda y lo que hay en La Plaza.

- **No puede dar ni cambiar nada**: no tiene ninguna herramienta; solo conversa.
- Quién pregunta lo pone el servidor de juego (BarrioSabioPlugIn.cs), no el jugador.
- El modelo es Llama 3.3 de **Cloudflare Workers AI**; la tablet lo llama con un token.
- **Configurar** (una vez, en Termux): `bash ~/barriomu.sh ia`. Pide el **ID de la cuenta** de
  Cloudflare y un **token con permiso "Workers AI"** (Cloudflare → Mi perfil → Tokens de API →
  Crear token → plantilla "Workers AI"). Prueba que la IA conteste.
- Panel admin → **🧙 El Sabio del Barrio**: prender/apagar, preguntas por jugador al día (20 por
  defecto) y las últimas conversaciones.
- Archivos: `~/.barriomu-ia` (cuenta y token, dentro de Ubuntu), `~/openmu/data/sabio-secreto.txt`
  (secreto entre OpenMU y la API). Tablas: `barrio.sabio_uso`, `barrio.sabio_log`.

### El Sabio por WhatsApp (bot en la tablet)
El WhatsApp del servidor corre **en la tablet** (sin Railway ni Evolution): `babylon/whatsapp/bot.ts`
(librería Baileys, como WhatsApp Web sin pantalla). Le pasa cada mensaje privado a la API
(`/whatsapp`, solo desde la tablet, con el secreto del Sabio) y manda la respuesta.

- **Vincular el número del bot** (una vez; usa un número aparte, no el personal: WhatsApp puede
  bloquear números de bots): `bash ~/barriomu.sh whatsapp`. Pide el número del bot y muestra un
  **código**; en el teléfono del bot: *WhatsApp → Dispositivos vinculados → Vincular un dispositivo →
  Vincular con número de teléfono* y se escribe el código. Después se prende solo con `prender`.
  `bash ~/barriomu.sh whatsapp desvincular` lo suelta.
- **Cada jugador vincula su WhatsApp**: Mi cuenta → **📱 WhatsApp** → *Generar código* (vale 15
  minutos) y le escribe al bot `vincular 123456`. Un número maneja una sola cuenta;
  `desvincular` lo suelta. Con `whatsappBot` en `web/config.js` (número del bot, sin +), Mi cuenta
  abre WhatsApp con el mensaje ya escrito.
- **Conversar y consultar** con los datos reales de la cuenta y sus personajes. Comparte el
  límite diario del Sabio. 5 códigos equivocados por hora como máximo.
- **Acciones (Fase B): reset y repartir puntos.** Se piden hablando ("hazle reset a barrio02",
  "ponle 500 a fuerza a barrio02") o con comando directo (`reset barrio02`,
  `puntos barrio02 fuerza 500 agilidad 100`). El bot pregunta y se hace solo si el jugador
  responde **sí** en 2 minutos (**no** cancela). Se hace con las mismas reglas de Mi cuenta: la
  cuenta **fuera del juego**, nivel y zen del reset, puntos libres. Nada más: la IA no puede dar ni
  cambiar otra cosa (si lo intenta, no se hace). Queda en el registro del Sabio como `[accion]`.
- Sesión del bot: `~/barriomu-wa/auth` (dentro de Ubuntu). Tablas: `barrio.wa_link`, `barrio.wa_code`.

### Teclas en la computadora (web en PC y programa de Windows)
| Tecla | Qué hace |
|---|---|
| `-` / `+` (o RePág / AvPág, o `-` `+` del teclado numérico) | Alejar / acercar la cámara (también Ctrl+rueda) |
| `Z` | Centrar la cámara |
| `Alt+Enter` o `F11` | Pantalla completa |

Mientras el personaje pelea se ve el **círculo rojo de alcance** alrededor, igual que en el celular.
No funcionan mientras se escribe en el chat. Código: `babylon/pc/`.

### NPCs de buff (Lorencia, frente a la fuente)
| NPC (nombre en el cliente) | Buff | Duración | Uso |
|---|---|---|---|
| **Guerrero** (David) | +20% de daño para todos, +20% de magia extra para magos y summoner | 30 min | Gratis, cuando quieras |
| **Fortuna** (Delgado) | Doble EXP y doble drop (en ALTOBARINAS el drop queda x4) | 45 min | Una vez cada 3 horas por personaje |

- Los iconos salen en la barra de buffs con el tiempo que queda.
- Si el jugador se desconecta, al volver el buff sigue con el tiempo restante
  (`~/openmu/data/buffs-npc.json`).
- Encima de los NPCs el cliente muestra su nombre original (David y Delgado).

### Cámara (ver más mapa)
- **PC:** **Ctrl + rueda del mouse**: hacia atrás aleja la cámara, hacia adelante la acerca.
  Va desde primera persona hasta más del doble de la distancia normal.
- **Celular:** botones **−** (alejar) y **+** (acercar), a la derecha del de pantalla completa.
- Necesita la opción **Control de cámara** encendida (Opciones del juego; viene encendida).
- Más lejos = más cosas en pantalla: en celulares sencillos puede dar algo de lag.

### Eventos
Blood Castle, Devil Square y Chaos Castle, cada 4 horas (horario por defecto de OpenMU).
Los ganadores salen solos en la landing ("Últimos ganadores").

---

## 7. Cuentas y administración

### Panel de admin de OpenMU
1. `bash ~/barriomu.sh panel on`
2. En el navegador **de la tablet**: http://localhost:8080
3. Al terminar: `bash ~/barriomu.sh panel off` (ahorra memoria).

Desde el panel se puede: ver jugadores conectados, editar cuentas y personajes, cambiar la
configuración de los servidores (por ejemplo PvP en ALTOBARINAS) y los horarios de los eventos.

### Panel admin web: https://barriomu.makeseo.app/admin.html
Estadísticas y botón para borrar la caché, desde el celular o la PC. **Solo entran cuentas GM.**

Qué muestra:
- Jugadores conectados ahora (por servidor), cuentas y personajes (total, hoy, 7 días), cuentas baneadas.
- Gráficos de cuentas y personajes nuevos por día (14 días).
- Visitas a la landing y entradas al juego **por país** (últimas 24 horas, de Cloudflare).
- Cuánto de los gráficos salió de la caché de Cloudflare y cuánto de la tablet.
- Descargas del instalador de PC (de GitHub) y el top 5 del servidor.
- Botón **🧹 Borrar caché del juego**. Si Cloudflare no deja borrar solo el juego, aparece un segundo
  botón para borrar la caché de todo makeseo.app (no rompe nada).

Configurarlo (una sola vez):
1. **Cuenta GM:** con la cuenta fuera del juego, en Termux: `bash ~/barriomu.sh gm TUCUENTA`.
   Ojo: en el juego también queda como GM (comandos de GM y fuera de los rankings); mejor usar una
   cuenta solo para administrar.
2. **Token de Cloudflare:** dash.cloudflare.com → tu perfil → **Mi perfil → Tokens de API → Crear token
   → Crear token personalizado**. Permisos: **Zona · Zona · Leer**, **Zona · Analytics · Leer** y
   **Zona · Purgar caché · Purgar**. Recursos de zona: **Incluir · Zona específica · makeseo.app**.
3. En Termux: `bash ~/barriomu.sh cloudflare` y pega el token (no se ve mientras lo pegas).
   Se guarda solo en la tablet (`~/.barriomu-cloudflare` dentro de Ubuntu). **No lo compartas.**
4. Abre el panel y entra con la cuenta GM.

Sin el token, el panel igual muestra las estadísticas del juego; solo faltan las visitas y el botón de caché.

### Crear cuentas
- Los jugadores las crean en https://mu-registro.makeseo.app (usuario de 4 a 10 letras o números,
  clave de 4 a 10 caracteres, sin correo).
- También se pueden crear desde el panel de admin.

### Cuenta de GM (administrador del juego)
En el panel de admin, edita la cuenta y cambia su estado a **GameMaster**. Las cuentas GM no
salen en los rankings.

---

## 8. La landing y el panel Mi cuenta

### Landing: https://barriomu.makeseo.app
Carpeta `web/` del repo. Es HTML, CSS y JS, sin compilar. Secciones: portada con botones
(Jugar, Crear cuenta, Descargar para PC), **Empieza en 3 pasos**, **Dos formas de jugar**
(teléfono y PC), **Versión para computadora** (paso a paso), estado del servidor, eventos y
últimos ganadores, rankings (Nivel, PvP, Guilds), **Invita y gana**, **Tienda y monedas**
(cómo se ganan puntos, WCoinC y WCoinP), **La Plaza**, noticias y reglas. Los botones de Tienda
y La Plaza llevan a `cuenta.html#tienda` y `cuenta.html#mercado` (salta a la sección al entrar).
- **Tienda en línea** (`tienda.html`, botón "🛒 Visita nuestra tienda en línea" en la portada y en el menú):
  se ve sin iniciar sesión. Muestra lo que está a la venta (API pública `GET /tienda`) y cada
  "Comprar" lleva a Mi cuenta. Si la tablet no responde, muestra los precios de referencia.
- Los HTML piden `styles.css`, `config.js` y el código con `?v=FECHA`: al cambiar el código o los
  estilos, **subir ese número en los 4 HTML** para que ningún navegador mezcle versiones viejas.

| Para cambiar… | Edita |
|---|---|
| Links (jugar, registro, descarga de PC, Discord, WhatsApp) | `web/config.js` |
| Tarjetas de características y reglas | `web/config.js` |
| Noticias | `web/news.json` |
| Textos y secciones | `web/index.html` |
| Colores y diseño | `web/styles.css` |

- Se publica **sola** en Cloudflare Pages cada vez que hay un cambio en la rama `main`.
- Configuración de Pages: **Root directory vacío**, **Build command vacío**,
  **Build output directory `web`**.
- Para mostrar el botón de Discord o WhatsApp, pon el link en `discord` / `whatsapp` de `web/config.js`.

### Panel Mi cuenta (`web/cuenta.html`)
El jugador entra con la cuenta del juego y puede: repartir puntos (Add Points), quitar el PK,
desbloquear el personaje (lo manda a su ciudad), Reset, Master Reset y cambiar la clave.
- Solo funciona con la cuenta **desconectada del juego** (y 1 minuto después de salir).
- Tiene límite de intentos de login por IP y por cuenta.
- Lo atiende la API de la tablet (`babylon/api/`, puerto 3400) por `mu-api.makeseo.app`.

---

## 9. Cloudflare: túnel, caché y Pages

### Tienda de puntos

Código: `openmu-barrio/BarrioPointsPlugIn.cs` (puntos y NPC), `babylon/api/tienda.ts` (API),
la sección `#tienda` de Mi cuenta y la de `web/admin.html`.

- **Los puntos** son los Goblin Points de la cuenta. Se ganan al matar los monstruos dorados de
  las invasiones (Golden Budge Dragon, Goblin, Soldier, Titan, Lizard King, Vepar, Tantallos,
  Wheel, Golden Dragon), Red Dragon, White Wizard y los jefes (Phoenix of Darkness de Icarus,
  Kundun y sus ilusiones de Kalima, Erohim, Balgass, Nightmare y las manos de Maya, Selupan).
  Cuenta el que mata, o el dueño de la invocación que mató. El juego avisa: "+5 puntos…".
- **Cuántos da cada uno**: `~/openmu/data/puntos.json` (número de monstruo: puntos). OpenMU lo
  crea con los valores por defecto y lo vuelve a leer solo cuando cambia; se edita desde el
  **panel admin → Puntos por monstruo**.
- **NPC Cambista** (Golden Archer) en Lorencia, x 142 y 124, al lado de Guerrero y Fortuna: al
  hablarle dice cuántos puntos tienes y dónde cambiarlos.
- **Tienda** en **Mi cuenta → Tienda de puntos**: se compra fuera del juego y lo comprado llega
  al **baúl**, al primer hueco donde quepa (si no cabe, no cobra). Viene con Bless (10), Soul (10)
  y Chaos (15) a la venta, y apagados (para prender desde el panel): alas de 1ra de cada clase
  (300) y armas básicas +15 (200).
- **Panel admin → Tienda de puntos**: prender o apagar cada item, precio y máximo por compra;
  agregar items (grupo / número / nivel); quitar; dar o quitar puntos a una cuenta (fuera del
  juego); quién tiene más puntos y los últimos movimientos.
- El catálogo está en `barrio.points_shop` y los movimientos en `barrio.points_log`.
- **Monedas**: además de los puntos, cada cuenta tiene **WCoinC** (la da el admin desde el panel →
  "Dar o quitar monedas"; un item de la tienda puede costar puntos o WCoinC) y **WCoinP** (la moneda
  para comerciar entre jugadores en la Plaza). En Mi cuenta → Tienda el jugador cambia WCoinC por
  WCoinP, fuera del juego. Todo queda en `barrio.points_log`.
- **Cambio**: WCoinC → WCoinP a la tasa del admin (por defecto **1 WCoinC = 2 WCoinP**), solo en ese
  sentido. Panel admin → **Economía**.

> La Plaza muestra la **imagen** de cada item (la sirve el juego, `https://mu.makeseo.app/items/`)
> y al tocar "Ver características" abre su ficha: tipo, nivel, durabilidad, skill, suerte, opción
> adicional, opciones excelentes y ancient. El nombre publicado es solo el nombre y su +nivel.

### Cash Shop (con WCoinC)
La tienda que traía el cliente, recreada en la web: **https://barriomu.makeseo.app/cashshop.html**
(botón "💎 Cash Shop" en la portada, en el menú y en Mi cuenta).

- Tres categorías: **Alas** (Elf, Heaven, Satan, Cape of Lord), **Items de misión** (Scroll of
  Emperor, Broken Sword, Tear of Elf, Soul Shard of Wizard, Devil's Eye/Key +1, Symbol of Kundun +1)
  y el **Cofre sorpresa**: una pieza de armadura al azar. Común 70% (+0 a +4), raro 23,5% (+5 a +9),
  épico 6% (excelente +3 a +9, 1-2 opciones), legendario 0,5% (excelente +10 a +12, 2-3 opciones).
- Se paga con **WCoinC**. Cada item tiene un **límite por día y por cuenta** (alas 1, misión 5 o 10,
  cofre 12). El jugador entra con su usuario y clave en la misma página y compra directo.
- Hay que estar **fuera del juego** y con espacio en el baúl. Lo comprado llega al **baúl**.
- Panel admin → **💎 Cash Shop**: prender/apagar cada item, precio y límite diario, y las últimas
  compras (con lo que salió de cada cofre).
- Tablas: `barrio.cash_shop` (catálogo), `barrio.cash_daily` (compras del día), `barrio.cash_log`.

### La Plaza (comercio entre jugadores, con WCoinP)

Código: `babylon/api/mercado.ts` y la sección `#mercado` de Mi cuenta ("La Plaza").

- **Vender**: el jugador elige un item de su baúl y le pone precio en WCoinP. El item sale del baúl a un
  baúl de custodia del servidor (`barrio.settings` → `market_escrow`) y conserva todo: nivel, opciones,
  excelentes, ancient. Máximo 20 a la venta por cuenta.
- **Comprar**: otro jugador paga en WCoinP y el item llega a su baúl (primer hueco libre).
- **Impuesto**: el vendedor recibe el precio menos el **impuesto** (por defecto **25%**, Panel admin →
  Economía); el impuesto sale del juego. El vendedor cobra en **Mis ventas → Cobrar**.
- **Retirar**: si nadie lo compró, vuelve a su baúl.
- Se puede revender lo comprado en la tienda (paga el impuesto).
- Todo fuera del juego. Las publicaciones están en `barrio.market_listing`.
- **Panel admin → Economía**: tasa WCoinC→WCoinP, impuesto, cuántos items hay a la venta, ventas, WCoinP
  movidos, impuestos cobrados y últimas ventas.

- **Puntos por tiempo jugado y comandos /add…**: `bash ~/barriomu.sh extras` prende el plugin de
  OpenMU `GoblinPointsForPlayTimePlugIn` (5 puntos cada hora, desde nivel 50) y los comandos
  `/addstr`, `/addagi`, `/addvit`, `/addene`, `/addcmd`; también `/openware` (abre el baúl en cualquier
  lugar), `/resetstats` (vuelve a repartir los puntos por 1.000.000 de zen) y los anuncios del servidor
  cada 20 minutos. `bash ~/barriomu.sh extras estado` lo muestra.
- Catálogo inicial a la venta: Bless 10, Soul 10, Chaos 15, Life 25, Creation 30, alas de 1ra 300 y
  de 2da 800. Cargados y apagados: Guardian, Harmony, Gemstone, Loch's Feather, Feather y Flame of
  Condor, Guardian Angel, Imp, Uniria, Dinorant, Fenrir y armas básicas +15.

### Referidos (Invita y gana)

Código: `babylon/api/referidos.ts` (API), `web/cuenta.html` / `cuenta.js` (Mi cuenta) y la
sección `#referidos` de la landing. Los datos van en el esquema `barrio` de la base de OpenMU
(tablas `referral_code`, `referral` y `referral_claim`); la API las crea sola la primera vez.

- **Link**: cada cuenta tiene un código de 6 letras y su link `https://barriomu.makeseo.app/?ref=CODIGO`.
  Está arriba de todo en **Mi cuenta**, con botones para copiar, WhatsApp y compartir.
- **Invitado**: si llega con el link, la página lo recuerda; al entrar a Mi cuenta la invitación
  se activa sola. También puede escribir el código. Solo cuentas de **menos de 30 días** que
  todavía no llegaron a nivel 200, y una sola vez.
- **Meta**: cuenta cuando un personaje del invitado llega a **nivel 200** (o hace un reset).
- **Topes**: máximo **10 invitados por mes** por jugador (los demás cuentan el mes siguiente) y
  **8 cuentas invitadas por casa** (misma conexión; la IP se guarda cifrada).
- **Premios** (para pedirlos: fuera del juego y con el **baúl vacío**; llegan al baúl):

| Amigos en nivel 200 | Premio |
|---|---|
| 1 | 5 Bless + 5 Soul |
| 3 | 10 Chaos + 10.000.000 de zen |
| 5 | Alas de 1ra de la clase que elija (Heaven, Satan, Elf, Curse, Cape of Lord, Cape of Fighter) |
| 10 | Alas de 3ra de la clase que elija (Eternal, Storm, Illusion, Ruin, Emperor, Dimension, Overrule) |
| El invitado, al llegar a nivel 200 | 3 Bless + 3 Soul + 5.000.000 de zen |

- **Ranking**: "Reclutadores del mes" y "De todos los tiempos" en la landing, con el nombre del
  mejor personaje de cada cuenta (nunca el usuario). El premio del primero del mes lo da el staff a mano.
- Para cambiar premios o reglas: los números están arriba de `babylon/api/referidos.ts`
  (`GOAL_LEVEL`, `MONTH_LIMIT`, `HOUSE_LIMIT`, `NEW_ACCOUNT_DAYS`, `MILESTONES`, `WELCOME`).
- Ver quién invitó a quién (Termux normal):
  `psql -U postgres -d openmu -c 'select * from barrio.referral order by linked_at desc limit 30'`

### Túnel "barriomu"
El token del túnel está guardado en la tablet en `~/.barriomu-token`. **Nunca lo compartas.**
Rutas del túnel (Cloudflare Zero Trust → Networks → Tunnels → barriomu → Public hostnames):

| Hostname | Servicio |
|---|---|
| mu.makeseo.app | http://localhost:8081 |
| mu-ws.makeseo.app | http://localhost:3000 |
| mu-registro.makeseo.app | http://localhost:8082 |
| mu-api.makeseo.app | http://localhost:3400 |

### Caché de gráficos
Para que los gráficos del celular salgan de Cloudflare y no del internet de la casa.

**Regla** (makeseo.app → Caching → Cache Rules), nombre `BarrioMU graficos`:
- Expresión personalizada:
  ```
  (http.host in {"mu.makeseo.app" "mu-registro.makeseo.app"} and not starts_with(http.request.uri.path, "/api/"))
  ```
- Elegibilidad: **Elegible para caché**.
- Edge TTL: **Usar el encabezado Cache-Control si está presente, omitir caché si no**.
- ⚠️ Nunca uses "Todas las solicitudes entrantes": afectaría a todo makeseo.app.

**Tiered Cache:** Caching → Tiered Cache → **Smart Tiered Caching Topology** (activado).

**Cómo funciona:** el primer jugador de cada zona hace que Cloudflare guarde los archivos;
los demás los reciben de Cloudflare. Gráficos y música se guardan 30 días; `index.html`,
`sw.js`, la lista de servidores y los índices se revisan siempre (lo decide `babylon/servir.ts`).

**Comprobar** (en Termius, dos veces):
```bash
curl -sI https://mu.makeseo.app/game-assets/Music/victory.ogg | grep -i cf-cache
```
Primero `MISS`, después `HIT` = funciona. Si dice `BYPASS` o `DYNAMIC`, revisa la regla.

**Después de actualizar el cliente:** en el **panel admin** (admin.html) toca **🧹 Borrar caché del juego**.
O a mano: Caching → Configuration → **Custom Purge** → Hostname `mu.makeseo.app`; si no está esa
opción, **Purge Everything** (no rompe nada).

---

## 10. Versión para PC (.exe)

- Instalador para **Windows 10/11 de 64 bits**, con los **gráficos completos** adentro (~660 MB).
- Descarga: https://github.com/bboymak3/openmu-fly-server/releases/download/barriomu-pc/BarrioMU-Setup.exe
- Se baja desde **GitHub**, no desde la tablet. Entra al mismo servidor que la versión web.
- Windows avisa "Windows protegió su PC" porque no tiene firma de pago: **Más información →
  Ejecutar de todas formas**.
- **F11** pone pantalla completa. **F5** recarga. **F12** abre la consola de errores.
- Si no conecta: el programa guarda un registro en **`%APPDATA%\BarrioMU\barriomu.log`**
  (pega esa dirección en la barra del Explorador de archivos). Ahí salen los errores de conexión.

### Actualización automática
- Al abrir, revisa si hay versión nueva en GitHub (`latest.yml` del Release `barriomu-pc`).
- Baja **solo las partes que cambiaron** y se instala al cerrar el juego (o al tocar "Reiniciar ahora").
- Cada compilación es una versión nueva (1.0.N). Se guardan los 3 últimos instaladores.

### Cuándo hay que hacer un .exe nuevo
- **No hace falta** para cambios del servidor: plugins, NPCs, resets, eventos, panel, API, landing.
- **Sí hace falta** para cambios del cliente: logo, botones, textos del juego, versión de Babylon.
  GitHub lo compila solo (workflow `build-pc.yml`) y a los jugadores les llega por la actualización
  automática.

---

## 11. Respaldos

Haz una copia de la base de datos **antes de cualquier cambio grande** y de vez en cuando.

### Copiar la base de datos (con PostgreSQL prendido, en Termux normal)
```bash
pg_dump -U postgres openmu | gzip > ~/respaldo-openmu-$(date +%F).sql.gz
```

### Copiar los datos de los plugins (premio diario, Master Reset, buffs)
```bash
proot-distro login ubuntu -- bash -c 'cd ~/openmu && tar -czf - data' > ~/respaldo-data-$(date +%F).tar.gz
```

### Llevar los respaldos fuera de la tablet
```bash
termux-setup-storage
cp ~/respaldo-* ~/storage/downloads/
```
Así quedan en la carpeta **Descargas** de la tablet; de ahí súbelos a Google Drive o pásalos a otro equipo.

### Restaurar la base de datos (⚠️ reemplaza todo lo actual)
```bash
bash ~/barriomu.sh apagar
pg_ctl -D $PREFIX/var/lib/postgresql -l $PREFIX/var/lib/postgresql/log.txt -w start
dropdb -U postgres openmu
createdb -U postgres openmu
gunzip -c ~/respaldo-openmu-AAAA-MM-DD.sql.gz | psql -U postgres openmu
bash ~/barriomu.sh prender
```
(Cambia `AAAA-MM-DD` por la fecha del archivo.)

---

## 12. Problemas comunes y soluciones

| Problema | Qué hacer |
|---|---|
| La página del juego no abre | `bash ~/barriomu.sh estado`; si algo no está en `[OK]`, `bash ~/barriomu.sh prender` |
| El juego dice "Sin respuesta" / no carga los servidores | Correr el diagnóstico (abajo) y revisar las rutas del túnel |
| Cambió la IP de la tablet | Solo afecta a Termius en la casa; usa Tailscale (IP 100.x fija) |
| Un jugador quedó trabado en un lugar | Panel **Mi cuenta → Desbloquear**, o desde el panel de admin |
| La tablet está lenta | `bash ~/barriomu.sh panel off`; cierra otras apps; reinicia con apagar / prender |
| Después de un corte de luz no prende solo | Instala **Termux:Boot** y corre `bash ~/barriomu.sh arranque` una vez |
| La landing no muestra los cambios | Cloudflare Pages → Implementaciones: debe haber una de **Producción** (rama main) en **success** |
| El instalador de PC no actualiza | El jugador puede descargar el instalador de nuevo e instalar encima (no pierde nada) |
| No hay NPCs (tiendas, baúl, eventos) | `bash ~/barriomu.sh npcs`; si hay apagados, `bash ~/barriomu.sh npcs activar`. Las tiendas y el baúl de las 4 ciudades los crea igual el plugin de NPCs de las ciudades |
| Sin espacio en la tablet | Borra respaldos viejos y `~/openmu.zip`, `~/instalar-babylon.sh` |

### Diagnóstico de la conexión
```bash
proot-distro login ubuntu -- bash -c 'wget -qO ~/diagnostico.sh https://raw.githubusercontent.com/bboymak3/openmu-fly-server/main/babylon/diagnostico.sh && bash ~/diagnostico.sh'
```
Prueba por separado: OpenMU directo, el proxy local y la conexión por Cloudflare. El primer tramo
que falle es donde está el problema.

### Ver qué está pasando
```bash
bash ~/barriomu.sh logs
```
(CTRL+C para salir.) Los archivos están en `~/barriomu-logs/`: `openmu.log`, `cliente.log`, `tunel.log`, etc.

---

## 13. Para hacer cambios en el código

| Quiero cambiar… | Dónde | Qué se recompila |
|---|---|---|
| Plugins del servidor (premio, Master Reset, NPCs) | `openmu-barrio/*.cs` | OpenMU (`build-arm64.yml`) |
| Doble drop, bono de reset | `openmu-barrio/*.patch` | OpenMU |
| Cuentas de prueba | `openmu-barrio/TestAccountsInitialization.cs`, `BarrioAccount.cs` | OpenMU |
| Logo, iconos, lista de servidores | `babylon/branding/` | Cliente web y PC |
| Botones del celular, textos del cliente | `babylon/mobile/`, `babylon/patch-client.py`, `babylon/personalizar-cliente.sh` | Cliente web y PC |
| API (rankings, panel) | `babylon/api/` | Cliente web |
| Caché de Cloudflare | `babylon/servir.ts` | Cliente web |
| Script de la tablet | `babylon/barriomu.sh` | Nada (se baja con wget) |
| Landing | `web/` | Nada (Cloudflare Pages la publica sola) |
| Versión de PC | `desktop/` | Instalador de PC (`build-pc.yml`) |

- Las versiones de OpenMU y del cliente Babylon están **fijas** en los workflows
  (`OPENMU_COMMIT` y `BABYLON_COMMIT`), para que un cambio de esos proyectos no rompa BarrioMU.
  Para subir de versión: cambia el commit, deja que GitHub compile y revisa que los parches apliquen.
- Cada compilación publica en **Releases**: `openmu-arm64`, `babylon-arm64` y `barriomu-pc`.

---

## 14. Seguridad

### Que no se dupliquen items ni monedas

- Todo lo que cambia una cuenta desde la web (tienda, Plaza, referidos, cambio de monedas, Add Points,
  resets, dar monedas desde el admin) se hace **con la cuenta fuera del juego**: se revisa antes de
  empezar y **otra vez justo antes de guardar**; si entró al juego en el medio, se deshace todo
  (`offlineTransaction` en `babylon/api/panel.ts`). Además hay que esperar un minuto después de salir,
  para que OpenMU termine de guardar.
- Cada operación es una transacción con la fila bloqueada: dos clics, dos pestañas o dos celulares a la
  vez no compran, cobran ni venden dos veces.
- En la Plaza el item a la venta sale del baúl a un baúl de custodia: no puede estar en dos lados.
- Todo queda anotado: `barrio.points_log` (monedas y compras), `barrio.market_listing` (Plaza) y
  `barrio.admin_log` (lo que hace cada admin; se ve abajo de todo en el panel admin).

### El panel admin

- Las claves se guardan con **bcrypt** (como OpenMU), que para claves es más seguro que SHA-256: es lento
  a propósito y lleva sal, así que no sirve para adivinar claves por fuerza bruta.
- Solo entran cuentas **GM**; tras 5 intentos fallidos por cuenta o 10 por IP se bloquea 15 minutos.
- La sesión es un token al azar de 256 bits que vive solo en la memoria de la tablet y vence a las 2 horas.
- La página manda cabeceras de seguridad (`web/_headers`): no se puede meter en un iframe, solo carga
  scripts propios y solo habla con la API.

### Recomendado: Cloudflare Zero Trust para el panel (gratis hasta 50 personas)

Agrega un segundo candado: antes de ver el panel, Cloudflare pide **un código que llega a tu correo**.
1. En Cloudflare: **Zero Trust → Access → Applications → Add an application → Self-hosted**.
2. Nombre `Panel BarrioMU`, dominio `barriomu.makeseo.app`, ruta `admin.html` (y otra ruta `admin`).
3. Política: **Allow**, regla **Emails** = tu correo. Método de entrada: **One-time PIN**.
4. Guardar. Desde ese momento, abrir el panel pide el código del correo y después el usuario GM.
Si alguien consigue la clave GM, igual no entra sin tu correo.



- **Nunca compartas** el token del túnel (`~/.barriomu-token`), el token de Cloudflare del panel admin
  (`~/.barriomu-cloudflare`), contraseñas de SSH ni la clave de la base de datos.
- Las cuentas de prueba `barrio01`…`barrio10` tienen la clave igual al usuario: cámbiales la clave
  o bórralas antes de abrir el servidor al público.
- El panel de admin (8080) solo se abre en la tablet; no lo pongas en el túnel.
- Haz respaldos (sección 11) antes de `reset-db` o de cambios grandes.
