#!/bin/bash
# Cliente Babylon para la version de PC: los mismos cambios de BarrioMU que la
# web y, ademas, sin la descarga inicial de graficos (ya vienen en el disco).
# Uso, desde la raiz del repo: bash desktop/preparar-cliente.sh <carpeta del cliente>
set -euo pipefail
C="$1"
bash babylon/personalizar-cliente.sh "$C"
python3 - "$C" <<'EOF'
import sys
p = sys.argv[1] + "/versions/shared/ui/components/auto_download/plan.ts"
s = open(p, encoding="utf-8").read()
old = "  return doneBuild !== build;\n"
new = "  // BarrioMU PC: los graficos ya estan en el disco, no hay nada que descargar.\n  return false;\n"
if s.count(old) != 1:
    sys.exit("preparar-cliente: no se encontro la descarga inicial en " + p)
open(p, "w", encoding="utf-8").write(s.replace(old, new))
print("preparar-cliente: sin descarga inicial ok")
EOF
