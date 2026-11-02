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
| `bash ~/barriomu.sh reset-db` | ⚠️ **BORRA TODA LA BASE** y la crea de nuevo (pide escribir `SI`) |

- El **vigilante** revisa cada 5 minutos y vuelve a prender lo que se haya caído.
- Los registros (logs) están en `~/barriomu-logs/`.

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
últimos ganadores, rankings (Nivel, PvP, Guilds), noticias y reglas.

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
proot-distro login ubuntu -- bash -c 'cd ~/openmu && tar -czf ~/respaldo-data.tar.gz data' && cp $PREFIX/var/lib/proot-distro/installed-rootfs/ubuntu/root/respaldo-data.tar.gz ~/respaldo-data-$(date +%F).tar.gz
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

- **Nunca compartas** el token del túnel (`~/.barriomu-token`), el token de Cloudflare del panel admin
  (`~/.barriomu-cloudflare`), contraseñas de SSH ni la clave de la base de datos.
- Las cuentas de prueba `barrio01`…`barrio10` tienen la clave igual al usuario: cámbiales la clave
  o bórralas antes de abrir el servidor al público.
- El panel de admin (8080) solo se abre en la tablet; no lo pongas en el túnel.
- Haz respaldos (sección 11) antes de `reset-db` o de cambios grandes.
