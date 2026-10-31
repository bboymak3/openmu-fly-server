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
]

for path, old, new in PATCHES:
    file = root / path
    text = file.read_text(encoding="utf-8")
    if text.count(old) != 1:
        sys.exit(f"patch-client: no se encontro una sola vez el texto en {path}: {old!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")
    print(f"patch-client: {path} ok")
