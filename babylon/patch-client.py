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
    # Zoom de la camara para los botones del celular (en la PC es Ctrl+rueda):
    # los mismos pasos que la rueda, hasta 2900 (el normal es 1200).
    (
        "src/controllers/camera/index.ts",
        "function syncMoved(): void {\n",
        "/** BarrioMU: alejar (+1) o acercar (-1) la camara, como Ctrl+rueda. */\n"
        "export function zoomCamera(step: number): void {\n"
        "  if (!GameOptions.cameraControl) return;\n"
        "  level = Math.max(0, Math.min(MAX_CAMERA_LEVEL, level + step));\n"
        "}\n\n"
        "function syncMoved(): void {\n",
    ),
    # ---- HUD de celular de BarrioMU (babylon/mobile/barrio.less y compania) ----
    # Botones chicos: el menu de arriba y la columna de la izquierda.
    (
        "versions/shared/ui/hud/mobile_controls/consts.ts",
        "export const MENU_SCALE = 1.4;",
        "export const MENU_SCALE = 1.05;\n\n/** BarrioMU: the small buttons of the left column (move, chat, full screen, zoom). */\nexport const SMALL_SCALE = 1.15;",
    ),
    (
        "versions/shared/ui/hud/mobile_controls/moveButton.tsx",
        "import { SLOT_SCALE, SKILLBOX_SPRITE, SKILLBOX_USE_SPRITE, BOX_WIDTH, BOX_HEIGHT } from './consts';",
        "import { SMALL_SCALE, SKILLBOX_SPRITE, SKILLBOX_USE_SPRITE, BOX_WIDTH, BOX_HEIGHT } from './consts';",
    ),
    (
        "versions/shared/ui/hud/mobile_controls/moveButton.tsx",
        "          scale={SLOT_SCALE}\n",
        "          scale={SMALL_SCALE}\n",
    ),
    (
        "versions/shared/ui/hud/mobile_controls/moveButton.tsx",
        "const GLYPH = 34;",
        "const GLYPH = 26;",
    ),
    # 4 habilidades en el arco (eran 3).
    (
        "src/modules/options/mobileSkillSlots.ts",
        "export const MOBILE_SKILL_SLOTS = 3;",
        "export const MOBILE_SKILL_SLOTS = 4;",
    ),
    # Al lanzar una habilidad tambien se ve el circulo de alcance.
    (
        "versions/shared/ui/hud/mobile_controls/skillPad.tsx",
        "import { MobileButton, ScaledFrame } from './mobileButton';\n",
        "import { MobileButton, ScaledFrame } from './mobileButton';\nimport { showCombatRing } from './combatPad';\n",
    ),
    (
        "versions/shared/ui/hud/mobile_controls/skillPad.tsx",
        "function castSkill(number: number): void {\n",
        "function castSkill(number: number): void {\n  showCombatRing();\n",
    ),
    # El joystick camina igual que W/A/S/D (aunque esa opcion este apagada).
    (
        "src/ecs/systems/playerControllerSystem.ts",
        "import { pickGround } from '../../controllers/terrain/terrainPick';\n",
        "import { pickGround } from '../../controllers/terrain/terrainPick';\nimport { BarrioJoystick } from '../../controllers/interface/barrioJoystick';\n",
    ),
    (
        "src/ecs/systems/playerControllerSystem.ts",
        "      if (keys.has(WALK_KEYS.left)) strafe--;\n    }\n",
        "      if (keys.has(WALK_KEYS.left)) strafe--;\n    }\n\n"
        "    // BarrioMU: the phone joystick steers the same walk.\n"
        "    if (\n"
        "      BarrioJoystick.active &&\n"
        "      playerEntity &&\n"
        "      camera &&\n"
        "      !playerEntity.dying &&\n"
        "      AppState.uiState === UIState.World\n"
        "    ) {\n"
        "      forward = BarrioJoystick.forward;\n"
        "      strafe = BarrioJoystick.strafe;\n"
        "    }\n",
    ),
    # Los botones del MU Helper con nombre, para moverlos en el celular (barrio.less).
    (
        "versions/shared/ui/hud/mu_helper_buttons/index.tsx",
        "    <div\n      style={{\n        position: 'absolute',\n        top,\n",
        "    <div\n      className=\"mu-helper-buttons\"\n      style={{\n        position: 'absolute',\n        top,\n",
    ),
    # El vigilante (scripts/vigilante.js) lee la pantalla actual y elige el personaje.
    (
        "src/app/boot.tsx",
        "(window as any).__modules = { Hero, Session, Bag, Merchant };\n",
        "(window as any).__modules = { Hero, Session, Bag, Merchant };\n"
        "(window as any).__barrio = { AppState, UIState, CharSelect };\n",
    ),
    (
        "src/app/boot.tsx",
        "import { Session } from '../modules/session';\n",
        "import { Session } from '../modules/session';\nimport { CharSelect } from '../modules/character_select';\n",
    ),
    # Los nombres de los jugadores (y el propio) siempre arriba, no solo con el mouse encima.
    (
        "src/ecs/systems/nameTagSystem.ts",
        "      if (hovered && isBalloonTarget(world, hovered)) showName(hovered);\n",
        "      if (hovered && isBalloonTarget(world, hovered)) showName(hovered);\n\n"
        "      // BarrioMU: every player in view keeps its name up, the hero's too.\n"
        "      for (const entity of named.entities) {\n"
        "        if (\n"
        "          entity.playerAnimation &&\n"
        "          entity.objectNameInWorld &&\n"
        "          !entity.dying &&\n"
        "          !entity.objOutOfScope &&\n"
        "          (entity.worldIndex === undefined || entity.worldIndex === world.mapIndex)\n"
        "        ) {\n"
        "          showName(entity);\n"
        "        }\n"
        "      }\n",
    ),
    # La barra de vida sobre la cabeza tambien para el propio personaje, con o sin party.
    (
        "versions/shared/ui/hud/party_bars/index.tsx",
        "  if (!Social.inParty) return null;\n",
        "",
    ),
    (
        "versions/shared/ui/hud/party_bars/index.tsx",
        "  return (\n    <div className=\"party-bars\">\n",
        "  // BarrioMU: the hero's own bar, always.\n"
        "  if (heroName) steps.set(heroName, Math.max(0, Math.min(STEPS, Math.ceil(Hero.hpPercent * STEPS))));\n\n"
        "  return (\n    <div className=\"party-bars\">\n",
    ),
    # En el celular la descripcion del item sale arriba del dedo (el dedo tapa lo de abajo).
    (
        "versions/shared/ui/components/item_tooltip/placement.ts",
        "): Placement {\n  let left = x - width / 2;\n  let top = y + BELOW_CURSOR;\n",
        "): Placement {\n"
        "  // BarrioMU: on a phone the finger is the cursor and covers what is under it.\n"
        "  if (typeof document !== 'undefined' && document.documentElement.classList.contains('mu-mobile')) {\n"
        "    const FINGER = 48;\n"
        "    let fl = x - width / 2;\n"
        "    let ft = y - FINGER - height;\n"
        "    if (ft < MARGIN) ft = y + FINGER;\n"
        "    if (ft + height > viewport.height - MARGIN) ft = viewport.height - MARGIN - height;\n"
        "    if (ft < MARGIN) ft = MARGIN;\n"
        "    if (fl + width > viewport.width - MARGIN) fl = viewport.width - MARGIN - width;\n"
        "    if (fl < MARGIN) fl = MARGIN;\n"
        "    return { left: Math.round(fl), top: Math.round(ft) };\n"
        "  }\n"
        "  let left = x - width / 2;\n  let top = y + BELOW_CURSOR;\n",
    ),

    # Salir un rato a otra app (WhatsApp) no debe tumbar la partida:
    # el proxy manda pings (el navegador los contesta aunque la pagina este en segundo plano)
    # y espera 4 minutos antes de dar la conexion por muerta.
    (
        "proxy/main.ts",
        "  websocket: {\n    sendPings: false,\n",
        "  websocket: {\n    // BarrioMU: pings keep a phone's socket alive while the player is in another app.\n"
        "    sendPings: true,\n    idleTimeout: 240,\n",
    ),
    # La reconexion automatica no gasta intentos mientras el juego esta en segundo plano:
    # espera a que el jugador vuelva y reconecta en ese momento.
    (
        "src/modules/session/sessionResume.ts",
        "  private schedule(): void {\n",
        "  private waitingForPage = false;\n\n"
        "  private schedule(): void {\n"
        "    // BarrioMU: a phone pauses the network of a page in the background; dialing then only\n"
        "    // spends the attempts. Wait for the player to come back, then dial at once.\n"
        "    if (typeof document !== 'undefined' && document.hidden) {\n"
        "      runInAction(() => {\n"
        "        if (this.step === 'idle') this.step = 'connecting';\n"
        "      });\n"
        "      if (this.waitingForPage) return;\n"
        "      this.waitingForPage = true;\n"
        "      const onVisible = () => {\n"
        "        if (document.hidden) return;\n"
        "        document.removeEventListener('visibilitychange', onVisible);\n"
        "        this.waitingForPage = false;\n"
        "        if (this.active) this.schedule();\n"
        "      };\n"
        "      document.addEventListener('visibilitychange', onVisible);\n"
        "      return;\n"
        "    }\n",
    ),

    # Las habilidades del panel del celular no se borran al entrar: antes se "limpiaban" contra
    # la lista de habilidades cuando todavia no habia llegado (vacia) y se perdian todas.
    (
        "versions/shared/ui/hud/mobile_controls/skillPad.tsx",
        "  useEffect(() => {\n    MobileSkillSlots.prune(learned.map(s => s.number));\n  }, [learned]);\n",
        "  useEffect(() => {\n"
        "    // BarrioMU: only against a skill list that has arrived; an empty one wiped the pad on every login.\n"
        "    if (learned.length) MobileSkillSlots.prune(learned.map(s => s.number));\n"
        "  }, [learned]);\n",
    ),

]

for path, old, new in PATCHES:
    file = root / path
    text = file.read_text(encoding="utf-8")
    if text.count(old) != 1:
        sys.exit(f"patch-client: no se encontro una sola vez el texto en {path}: {old!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")
    print(f"patch-client: {path} ok")
