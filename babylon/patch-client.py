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
    # Sin boton "Iniciar": apenas termina de cargar entra solo al login de
    # BarrioMU (server.json con directLogin, junto a la pagina).
    (
        "versions/shared/ui/pages/preloader/index.tsx",
        "  // Enter enters from the grid or the search box.",
        "  // BarrioMU: no Start press, straight on to the login once loaded.\n"
        "  useEffect(() => {\n"
        "    if (phase === 'ready' && DirectLogin.on) start();\n"
        "  }, [phase]);\n"
        "\n"
        "  // Enter enters from the grid or the search box.",
    ),
]

for path, old, new in PATCHES:
    file = root / path
    text = file.read_text(encoding="utf-8")
    if text.count(old) != 1:
        sys.exit(f"patch-client: no se encontro una sola vez el texto en {path}: {old!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")
    print(f"patch-client: {path} ok")
