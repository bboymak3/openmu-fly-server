"""BarrioMU: cambios de texto sobre el codigo del cliente Babylon.

Uso: python3 babylon/patch-client.py client-src
Falla si algun texto no se encuentra, para que la compilacion avise.
"""

import pathlib
import sys

root = pathlib.Path(sys.argv[1])

PATCHES = [
    # Espanol por defecto: el idioma del navegador ya no se usa para elegir.
    # El jugador lo puede cambiar igual, y su eleccion queda guardada.
    (
        "src/i18n/index.ts",
        ": [...(navigator.languages ?? []), navigator.language].filter(Boolean),",
        ": ['es'],",
    ),
    # Pantalla de inicio sin las animaciones que dan lag en el celular: el mapa
    # que se recorre (con brasas y creditos), el rayo y las chispas del logo.
    (
        "versions/shared/ui/pages/preloader/index.tsx",
        "      <Backdrop />\n",
        "",
    ),
    (
        "versions/shared/ui/pages/preloader/index.tsx",
        "          <LightningLine phase={phase} />\n",
        "",
    ),
    (
        "versions/shared/ui/pages/preloader/logoLight.tsx",
        "    <Sparks />\n",
        "",
    ),
    # La llamarada que sale al abrir la lista de mundos, tambien pesada.
    (
        "versions/shared/ui/pages/preloader/index.tsx",
        "      {open && <Hellfire />}\n",
        "",
    ),
    # Antes de la lista de servidores el juego cargaba el mapa del login y
    # paseaba la camara por el como un video. Ahora usa el mismo escenario de
    # la seleccion de personajes, con la camara quieta: sin animacion y con
    # un mapa menos que cargar.
    (
        "versions/season6/ui/index.ts",
        "login: ENUM_WORLD.WD_73NEW_LOGIN_SCENE,",
        "login: ENUM_WORLD.WD_74NEW_CHARACTER_SCENE,",
    ),
    # En la lista de mundos solo BarrioMU: no se agrega el perfil
    # "Local (OpenMU)" al abrir la pagina desde la red de la casa.
    (
        "src/modules/servers/serverConfig.ts",
        "function seedsDefaultProfile(): boolean {\n",
        "function seedsDefaultProfile(): boolean {\n  return false; // BarrioMU: solo los mundos de serverlist.md\n",
    ),
]

for path, old, new in PATCHES:
    file = root / path
    text = file.read_text(encoding="utf-8")
    if text.count(old) != 1:
        sys.exit(f"patch-client: no se encontro una sola vez el texto en {path}: {old!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")
    print(f"patch-client: {path} ok")
