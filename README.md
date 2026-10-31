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
| http://localhost:8080 | Panel de admin de OpenMU (solo en la tablet) | puerto 8080 |

## Manejo diario (Termux normal, `~ $`)

```bash
bash ~/barriomu.sh prender     # prende todo y el vigilante
bash ~/barriomu.sh apagar      # apaga todo
bash ~/barriomu.sh estado      # que esta prendido
bash ~/barriomu.sh logs        # lo que va pasando
bash ~/barriomu.sh arranque    # prender solo al encender la tablet (Termux:Boot)
bash ~/barriomu.sh reset-db    # BORRA la base y crea barrio01..barrio10
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

## Archivos

| Archivo | Para que |
|---|---|
| `babylon/barriomu.sh` | Prender, apagar y vigilar todo |
| `babylon/iniciar-cliente.sh` | Arranca proxy, pagina y registro (lo usa barriomu.sh) |
| `babylon/servir.ts` | Servidor web minimo de la pagina y el registro |
| `babylon/diagnostico.sh` | Prueba OpenMU, proxy y Cloudflare por separado |
| `babylon/branding/` | Logo, iconos y lista de servidores |
| `openmu-barrio/` | Cambios de BarrioMU sobre OpenMU |
