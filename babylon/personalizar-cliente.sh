#!/bin/bash
# Cambios de BarrioMU sobre el cliente Babylon (logo, nombre, lista de
# servidores, botones del celular, espanol...). Lo usan los workflows de la
# version web (build-babylon.yml) y de la version para PC (build-pc.yml).
# Uso, desde la raiz del repo: bash babylon/personalizar-cliente.sh <carpeta del cliente>
set -euo pipefail
B=babylon/branding
C="$1"
P=$C/versions/shared/ui/pages/preloader
# Nombres nuevos para que los navegadores no usen el logo viejo guardado.
cp $B/logo.webp $C/public/ui/world_select/barriomu-logo.webp
cp $B/logo_glow.webp $C/public/ui/world_select/barriomu-glow.webp
sed -i 's#/ui/world_select/logo.webp#/ui/world_select/barriomu-logo.webp#; s#/ui/world_select/logo_glow.webp#/ui/world_select/barriomu-glow.webp#' $P/logoLight.tsx $P/directLoad.tsx
# El logo al 100%: sin las capas de luz que se mezclan encima.
printf '\n.ws-logo-glow, .ws-logo-bloom, .ws-logo-surge { display: none; }\n' >> $P/style.less
cp $B/icon-192.png $B/icon-512.png $B/icon-maskable-512.png $B/apple-touch-icon.png $C/public/icons/
cp $B/banner.webp $B/serverlist.md $C/public/
sed -i 's/OpenMUCB/BarrioMU/g' $C/index.html $C/public/manifest.webmanifest $C/src/modules/servers/pageTitle.ts $C/register/index.html
sed -i 's/JS implementation of MU Online/BarrioMU - MU Online en el navegador/' $C/index.html
sed -i 's/alt="OpenMU Babylon"/alt="BarrioMU"/' $P/logoLight.tsx
grep -c BarrioMU $C/index.html $C/public/manifest.webmanifest $C/src/modules/servers/pageTitle.ts $C/register/index.html
grep -c barriomu-logo $P/logoLight.tsx $P/directLoad.tsx
# Boton de chat en el celular (no hay tecla Enter), debajo del de Move.
M=$C/versions/shared/ui/hud/mobile_controls
# Y uno de pantalla completa (no hay F11), debajo del de chat.
cp babylon/mobile/chatButton.tsx babylon/mobile/fullscreenButton.tsx $M/
cat babylon/mobile/chatButton.less >> $M/style.less
sed -i "s#^import { MoveButton } from './moveButton';#&\nimport { ChatButton } from './chatButton';\nimport { FullscreenButton } from './fullscreenButton';#; s#<MoveButton />#&\n      <ChatButton />\n      <FullscreenButton />#" $M/index.tsx
grep -c ChatButton $M/index.tsx
grep -c FullscreenButton $M/index.tsx
# Otros cambios de texto (espanol por defecto, ...)
python3 babylon/patch-client.py $C
