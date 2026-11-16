# BarrioMU — notas para agentes

**El juego está TERMINADO y en producción.** No es un proyecto en construcción: hay un
servidor MU Online (OpenMU) vivo en una tablet Android, un cliente web, una landing con
panel de jugador y panel de admin, bots (Telegram activo), torneos de puntos y mercado.

Revisado: **16/11/2026**, rama `main` en `27bac4f`.

## Leer en este orden

1. `README.md` — qué es BarrioMU y todo lo que tiene (juego, celular, web).
2. `docs/MANUAL.md` — manual completo: comandos de Termux, actualizar, respaldos,
   solución de problemas, Cloudflare, versión PC.
3. `docs/ESTADO-BARRIOMU.md` — estado técnico: servicios, puertos y **mapa completo de
   APIs y endpoints**.

## Reglas de oro

1. **No reiniciar, apagar ni tocar la base por cambios de cliente.** Los cambios de HUD /
   web son archivos estáticos: se publican y el jugador recarga.
2. **No editar el cliente Babylon a mano.** Se parchea desde `babylon/`:
   `patch-client.py`, `personalizar-cliente.sh`, `mobile/*`, `branding/*`.
   El upstream está **fijado** en `build-babylon.yml`:
   `BABYLON_COMMIT=26c0921c1bed65b1aab4762022f24021a5318130`.
   Antes de cambiar un parche, verificarlo contra ese commit exacto.
3. **Todo cambio de HUD va sin romper lo de antes**: capas `z-index`, `.mu-mobile`, y
   nunca quitar funciones de PC (teclado, mouse).
4. Comandos que reinician OpenMU (`barriomu.sh spot`, `monstruos`, `npcs`, `panel`,
   `resets`, `gm`, `joyas`, `arena`, `extras`) se avisan al dueño y se ejecutan cuando
   él pueda; no en medio de una partida.
5. **Secreto no va al repo.** Tokens y claves viven en la tablet o en este entorno, nunca
   en un commit.
6. **No revocar el token de GitHub**: es lo que permite subir cambios desde aquí
   (`git push` y `curl` se caen en este entorno; se usa la API Git Data).
7. **WhatsApp está retirado** (instancia de Railway eliminada por seguridad). El canal
   activo es **Telegram** (`@Barriomubot`). No reactivar WhatsApp sin pedido explícito.
8. Respuestas al dueño: **español corto y concreto**, un bloque de comandos por paso; él
   ejecuta en la tablet.

## Cómo se publica (desde este entorno)

```bash
# token (no está en el repo)
cat ~/.config/barriomu/gh_token

# subir archivos por la API (blob -> tree -> commit -> ref)
python3 ~/.config/barriomu/push.py "mensaje del commit" archivo1 archivo2 ...
```

Compilar no se pide a mano: cada push dispara workflows según la ruta.

| Workflow | Se dispara con | Publica |
|---|---|---|
| `build-babylon.yml` | `babylon/**` | `babylon-arm64` (cliente + proxy + registro + API para la tablet) |
| `build-arm64.yml` | `openmu-barrio/**` | `openmu-arm64` (OpenMU + plugins) |
| `build-pc.yml` | `desktop/**`, `patch-client.py`, `personalizar-cliente.sh` | `barriomu-pc` (`BarrioMU-Setup.exe` con auto-update) |
| `vigilante.yml` | cada hora (`cron 17 * * * *`) | nada: entra al juego como jugador y falla si algo está roto |

Documentación y web (`web/**`, `docs/**`, `AGENTS.md`) **no** recompilan nada.

## Actualización en la tablet (3 pasos, para el dueño)

```bash
bash ~/barriomu.sh apagar
proot-distro login ubuntu -- bash -c 'cd ~ && wget -O actualizar-babylon.sh https://github.com/bboymak3/openmu-fly-server/releases/download/babylon-arm64/actualizar-babylon.sh && bash actualizar-babylon.sh'
bash ~/barriomu.sh prender
```

## Direcciones

- Juego: <https://mu.makeseo.app> · Landing/Mi cuenta/admin: <https://barriomu.makeseo.app>
- API: <https://mu-api.makeseo.app> · Registro: <https://mu-registro.makeseo.app>
- Repo: <https://github.com/bboymak3/openmu-fly-server>
- Bot: <https://t.me/Barriomubot>

## Antes de dar algo por bueno

1. `python3 -c "import ast; ast.parse(open('babylon/patch-client.py').read())"`.
2. Verificar que cada ancla de `patch-client.py` existe en el commit fijado del cliente.
3. Esperar los dos builds (PC + ARM64) y confirmar el release `babylon-arm64` con
   `actualizar-babylon.sh` actualizado.
4. Pedirle al dueño una captura; él es el único que puede probar en la tablet.
