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
    # Camara libre del celular: con el modo encendido (el boton de la camara
    # del HUD pone window.barrioCameraOn), un dedo que arrastra gira e inclina
    # y dos dedos pellizcan para acercar o alejar por niveles. Sin arrastre la
    # pantalla sigue tocando como siempre (un toque corto camina, como antes).
    (
        "src/controllers/camera/index.ts",
        """  installMouseLook(
    canvas,
    () => isActive() && canMouseLook(),
    (dx, dy) => applyLook(dx, dy, MOUSE_LOOK_DEG_PER_PX, MOUSE_LOOK_DEG_PER_PX)
  );
""",
        """  installMouseLook(
    canvas,
    () => isActive() && canMouseLook(),
    (dx, dy) => applyLook(dx, dy, MOUSE_LOOK_DEG_PER_PX, MOUSE_LOOK_DEG_PER_PX)
  );

  // BarrioMU: camara libre con los dedos. El boton del HUD enciende y apaga
  // window.barrioCameraOn; mientras arrastra marca window.barrioCameraDrag,
  // que el paseo por toque consulta para no caminar mientras se gira.
  const TOUCH_ROTATE_DEG_PER_PX = 0.35;
  const TOUCH_PITCH_DEG_PER_PX = 0.3;
  const TOUCH_PX_PER_LEVEL = 40;
  const TOUCH_DRAG_START_PX = 10;
  let camId: number | null = null;
  let camX = 0;
  let camY = 0;
  let camPinch = 0;
  let camPinchLevel = 0;
  const camPts = new Map<number, { x: number; y: number }>();
  const camOn = () => (globalThis as any).barrioCameraOn === true;

  const camDown = (ev: PointerEvent) => {
    if (!camOn() || !isActive() || !GameOptions.cameraControl) return;
    camPts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    (globalThis as any).barrioCameraDrag = false;
    if (camPts.size === 1) {
      camId = ev.pointerId;
      camX = ev.clientX;
      camY = ev.clientY;
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch {
        // Sin captura igual llegan los movimientos de la misma lienza.
      }
    } else if (camPts.size === 2) {
      const [a, b] = [...camPts.values()];
      camPinch = Math.hypot(a.x - b.x, a.y - b.y);
      camPinchLevel = level;
      camId = null;
    }
  };

  const camMove = (ev: PointerEvent) => {
    if (!camOn() || !camPts.has(ev.pointerId)) return;
    camPts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (camId === null && camPts.size > 1) {
      if (camPinch > 0) {
        const [a, b] = [...camPts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        level = Math.max(
          0,
          Math.min(MAX_CAMERA_LEVEL, Math.round(camPinchLevel + (camPinch - d) / TOUCH_PX_PER_LEVEL))
        );
      }
      (globalThis as any).barrioCameraDrag = true;
    } else if (ev.pointerId === camId) {
      const dx = ev.clientX - camX;
      const dy = ev.clientY - camY;
      if ((globalThis as any).barrioCameraDrag || Math.abs(dx) + Math.abs(dy) > TOUCH_DRAG_START_PX) {
        (globalThis as any).barrioCameraDrag = true;
        applyLook(dx, dy, TOUCH_ROTATE_DEG_PER_PX, TOUCH_PITCH_DEG_PER_PX);
        camX = ev.clientX;
        camY = ev.clientY;
      }
    }
  };

  const camUp = (ev: PointerEvent) => {
    if (!camPts.has(ev.pointerId)) return;
    camPts.delete(ev.pointerId);
    camPinch = 0;
    if (camPts.size <= 1) camId = null;
    if (camPts.size === 0) {
      // Soltados los dedos: un toque corto camina como siempre; el giro que
      // arrastro deja la marca un momento mas para no caminar al soltar.
      window.setTimeout(() => {
        (globalThis as any).barrioCameraDrag = false;
      }, 180);
    }
  };

  canvas.addEventListener('pointerdown', camDown);
  canvas.addEventListener('pointermove', camMove);
  canvas.addEventListener('pointerup', camUp);
  canvas.addEventListener('pointercancel', camUp);

""",
    ),
    # Mientras se gira la camara con los dedos el hero no camina (el paseo por
    # toque consulta window.barrioCameraDrag arriba).
    (
        "src/ecs/systems/playerControllerSystem.ts",
        """    if (!playerEntity) return;

    // Dead until the server respawns us (Hero->Dead in the original): no""",
        """    if (!playerEntity) return;

    // BarrioMU: girando la camara con el dedo (modo camara) el hero no camina.
    if ((globalThis as any).barrioCameraOn && (globalThis as any).barrioCameraDrag) return;

    // Dead until the server respawns us (Hero->Dead in the original): no""",
    ),
    # Las auras arriba al CENTRO en el celular (a la izquierda tapaban el juego).
    (
        "versions/shared/ui/hud/buff_bar/index.tsx",
        """className="buff-bar"
      style={{ left: BAR_X * scale, top: BAR_Y * scale, transform: `scale(${scale})` }}
""",
        """className="buff-bar"
      style={
        // BarrioMU: en el celular la fila de auras vive centrada arriba.
        typeof document !== 'undefined' && document.documentElement.classList.contains('mu-mobile')
          ? { left: '50%', top: BAR_Y * scale, transform: `translateX(-50%) scale(${scale})` }
          : { left: BAR_X * scale, top: BAR_Y * scale, transform: `scale(${scale})` }
      }
""",
    ),
    # El log del chat en el celular empieza corto, con espacio reservado: que no
    # crezca sobre el mapa. El boton de tamano del chat lo agranda igual.
    (
        "src/modules/social/social.ts",
        """  chatLogLines = CHAT_SHOWING_LINES;
""",
        """  // BarrioMU: en el celular el log arranca corto para reservar sitio (el
  // boton de tamano del chat lo agranda igual).
  chatLogLines =
    typeof document !== 'undefined' && document.documentElement.classList.contains('mu-mobile')
      ? 6
      : CHAT_SHOWING_LINES;
""",
    ),
    # La caja de escribir del chat, un poco mas arriba en el celular (no pegada
    # al borde de la barra).
    (
        "versions/shared/ui/hud/chat/index.tsx",
        """        transform: `scale(${scale})`,
        transformOrigin: '0 100%',
""",
        """        // BarrioMU: en el celular la caja del chat sube un poco y se
        // corre del borde izquierdo (1 cm).
        left: mobile ? 40 : undefined,
        transform: `scale(${scale})${mobile ? ` translateY(${(-26 / scale).toFixed(2)}px)` : ''}`,
        transformOrigin: '0 100%',
""",
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
    # BarrioMU: el ayudante compacto, dos botoncitos de una letra que caben en
    # la linea superior del celular junto a camara y chat (B = activar/detener,
    # A = ajustar). La posicion la manda barrio.less.
    (
        "versions/shared/ui/hud/mu_helper_buttons/index.tsx",
        "        width={108}\n        height={29}\n        frames={{ up: 0, active: 1, down: 2 }}\n        label={t(MuHelper.active ? 'muHelperButtons.stop' : 'muHelperButtons.start')}\n        labelStyle={{ fontWeight: 'bold', fontSize: 11, color: MuHelper.active ? '#7CFC7C' : '#FFD700' }}",
        "        width={34}\n        height={29}\n        frames={{ up: 0, active: 1, down: 2 }}\n        label={'B'}\n        labelStyle={{ fontWeight: 'bold', fontSize: 12, color: MuHelper.active ? '#7CFC7C' : '#FFD700' }}",
    ),
    (
        "versions/shared/ui/hud/mu_helper_buttons/index.tsx",
        "        width={108}\n        height={29}\n        frames={{ up: 0, active: 1, down: 2 }}\n        label={t('muHelperButtons.settings')}\n        labelStyle={{ fontWeight: 'bold', fontSize: 11 }}",
        "        width={34}\n        height={29}\n        frames={{ up: 0, active: 1, down: 2 }}\n        label={'A'}\n        labelStyle={{ fontWeight: 'bold', fontSize: 12 }}",
    ),
    # La correa Q/W/E/R sale del celular: ese espacio lo usan los cuadros del
    # menu (barrio.less). Las teclas siguen sirviendo y las pociones de la
    # columna izquierda tambien.
    (
        "versions/shared/ui/hud/bottom_bar/index.tsx",
        """  return (
    <>
      {HOTKEY_KEYS.slice(0, slots).map((key, i) => (
        <ConsumableItem key={key} index={i} hotKey={key} />
      ))}
    </>
  );
};
""",
        """  // BarrioMU: en el celular los cuatro huecos Q/W/E/R salen; ese espacio de
  // la barra lo ocupan los cuadros del menu. Las teclas y las pociones de la
  // columna izquierda siguen funcionando igual.
  if (
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('mu-mobile')
  ) {
    return null;
  }
  return (
    <>
      {HOTKEY_KEYS.slice(0, slots).map((key, i) => (
        <ConsumableItem key={key} index={i} hotKey={key} />
      ))}
    </>
  );
};
""",
    ),
    # BarrioMU: el menu del click secundario (trueque, party, susurro...) se
    # despliega tambien dejando presionado 0.7 segundos el NOMBRE de otro
    # jugador sobre el mapa (los globos de nombre son DOM; barrio.less da el
    # toque a la linea del nombre).
    (
        "versions/shared/ui/hud/name_tags/index.tsx",
        "import { Social } from '@/modules/social/social';\nimport { guildMarkDataUrl, isEmptyGuildMark } from '@/core/guildMark';",
        "import { Social } from '@/modules/social/social';\nimport { Commands } from '@/modules/chat/commands';\nimport { guildMarkDataUrl, isEmptyGuildMark } from '@/core/guildMark';",
    ),
    (
        "versions/shared/ui/hud/name_tags/index.tsx",
        "type Slot = TagSlot<TagEntity, HTMLDivElement>;",
        """// BarrioMU: el menu del click secundario (trueque, party, susurro...) con la
// presion larga (0.7 s) sobre el nombre de otro jugador en el mapa. El dedo
// que se mueve mas de 48px o que levanta antes cancela; Commands.openQuickOn
// rechaza al heroe, los NPC y los que quedan fuera del alcance.
let barrioPressToken = 0;

const barrioArmLongPress = (entity: Entity, el: HTMLElement) => {
  el.addEventListener('pointerdown', (ev: PointerEvent) => {
    const token = ++barrioPressToken;
    const startX = ev.clientX;
    const startY = ev.clientY;
    const timer = window.setTimeout(() => {
      if (token === barrioPressToken) {
        if (!Commands.openQuickOn(entity, startX, startY)) return;
        // BarrioMU: ademas del cierre del propio menu, cada toque NUEVO de
        // pantalla fuera del cuadrito lo cierra (captura en el descendente:
        // llega antes que cualquier otra capa).
        const closer = (outside: PointerEvent) => {
          const hit = outside.target as HTMLElement | null;
          if (hit && hit.closest && hit.closest('.quick-command-window')) return;
          Commands.closeQuick();
          window.removeEventListener('pointerdown', closer, true);
        };
        window.addEventListener('pointerdown', closer, true);
      }
    }, 700);
    const cleanup = () => {
      if (token !== barrioPressToken) return;
      barrioPressToken++;
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (dx * dx + dy * dy > 2304) cleanup();
    };
    const onEnd = () => cleanup();
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  });
};

type Slot = TagSlot<TagEntity, HTMLDivElement>;""",
    ),
    (
        "versions/shared/ui/hud/name_tags/index.tsx",
        """      elSlots.set(el, slot);
      observer?.observe(el, BORDER_BOX);
    },
    []
  );""",
        """      elSlots.set(el, slot);
      observer?.observe(el, BORDER_BOX);
      // BarrioMU: presion larga sobre el nombre = menu del click secundario.
      barrioArmLongPress(entity, el);
    },
    []
  );""",
    ),
    (
        "versions/shared/ui/hud/name_tags/index.tsx",
        """          className={`line${line.bold ? ' bold' : ''}${
            state.blink && line.isName ? ' blink' : ''
          }`}""",
        """          className={`line${line.bold ? ' bold' : ''}${line.isName ? ' barrio-name' : ''}${
            state.blink && line.isName ? ' blink' : ''
          }`}""",
    ),
    # BarrioMU: el boton de "Restablecer camara" compacto (una letra R) para
    # que quepa en la linea superior del celular, de primero a la IZQUIERDA de
    # la camara (la posicion la manda barrio.less; solo se ve si la vista
    # salio del encuadre de apertura).
    (
        "versions/shared/ui/hud/camera_reset/index.tsx",
        "    <div\n      style={{\n        position: 'absolute',\n        top: TOP,\n",
        "    <div\n      className=\"barrio-camera-reset\"\n      style={{\n        position: 'absolute',\n        top: TOP,\n",
    ),
    (
        "versions/shared/ui/hud/camera_reset/index.tsx",
        "        width={108}\n        height={29}\n        frames={{ up: 0, active: 1, down: 2 }}\n        label={t('camera.reset')}\n        labelStyle={{ fontWeight: 'bold', fontSize: 11 }}",
        "        width={34}\n        height={29}\n        frames={{ up: 0, active: 1, down: 2 }}\n        label={'R'}\n        labelStyle={{ fontWeight: 'bold', fontSize: 12 }}",
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

    # El Sabio del Barrio (IA): el NPC 522 se llama asi en el juego...
    (
        "src/controllers/assets/mu/npcNameFile.ts",
        "export function localisedNpcName(type: number): string | undefined {\n  return names.get().get(type);\n}",
        "export function localisedNpcName(type: number): string | undefined {\n"
        "  // BarrioMU: el NPC 522 (Adviser Jerinteu) es el Sabio del Barrio en Lorencia.\n"
        "  if (type === 522) return 'Sabio del Barrio';\n"
        "  return names.get().get(type);\n}",
    ),
    # ...al hablarle saluda por susurro y ese saludo abre el chat dirigido al Sabio
    # (el texto es BarrioSabioPlugIn.Greeting, del servidor)...
    (
        "src/modules/chat/net.ts",
        "      if (!Social.whisperTarget) Social.setWhisperTarget(sender);\n",
        "      // BarrioMU: el saludo del NPC Sabio abre el chat dirigido a el.\n"
        "      if (sender === 'Sabio' && message.startsWith('Hola pana, soy el Sabio del Barrio')) {\n"
        "        Social.setWhisperTarget('Sabio');\n"
        "        Social.openChatInput();\n"
        "        return;\n"
        "      }\n"
        "      if (!Social.whisperTarget) Social.setWhisperTarget(sender);\n",
    ),
    # ...y lo que se le susurra al Sabio se manda como pregunta /ia (no existe un jugador Sabio).
    (
        "src/modules/social/social.ts",
        "    if (!text.trim()) return false;\n",
        "    if (!text.trim()) return false;\n"
        "    // BarrioMU: un susurro al Sabio del Barrio es una pregunta a la IA del servidor (/ia).\n"
        "    if (this.whisperEnabled && !text.startsWith('/') && this.whisperTarget.trim().toLowerCase() === 'sabio') {\n"
        "      const question = clipChatText(rawText.replace(/[\\r\\n]/g, ''), MAX_CHAT_LENGTH - 4);\n"
        "      this.addChatLine(Hero.name, question, ChatLineType.Whisper);\n"
        "      return this.sendChat(`/ia ${question}`);\n"
        "    }\n",
    ),

    # ...y tocar al Sabio abre el chat dirigido a el, sin preguntarle al servidor: en OpenMU el
    # NPC 522 es Jerint (entrada al Imperial Guardian) y su ventana tapa el saludo del servidor.
    # Solo en Lorencia (mapa 0); en el evento Jerint sigue siendo Jerint.
    (
        "src/ecs/systems/npcTalkSystem.ts",
        "      if (events.useNpc(npc)) return;\n",
        "      if (events.useNpc(npc)) return;\n"
        "      // BarrioMU: el Sabio del Barrio (IA) abre el chat con el susurro al Sabio.\n"
        "      if (npc.npcType === 522 && world.mapIndex === 0) {\n"
        "        Social.addChatLine('Sabio', 'Hola pana, soy el Sabio del Barrio. Escribe tu pregunta y te respondo.', ChatLineType.Whisper);\n"
        "        Social.setWhisperTarget('Sabio');\n"
        "        Social.openChatInput();\n"
        "        return;\n"
        "      }\n",
    ),
    (
        "src/ecs/systems/npcTalkSystem.ts",
        "import { Merchant } from '../../modules/npc_shop';\n",
        "import { Merchant } from '../../modules/npc_shop';\n"
        "import { Social } from '../../modules/social/social';\n"
        "import { ChatLineType } from '../../modules/chat/chat';\n",
    ),

    # Las mascotas del Sabio llevan el nombre de su etapa. Solo cambia el texto:
    # el item, su ranura y sus bonus (EXP en el Panda, ataque en el Dragón) siguen
    # siendo los del juego.
    (
        "src/i18n/itemNames.ts",
        "  '13/0': 'Ángel Guardián',\n",
        "  // BarrioMU: mascotas del Sabio (el nombre del chat dice lo mismo).\n"
        "  '13/0': 'Sabio',\n"
        "  '13/65': 'Sabio Espíritu',\n"
        "  '13/80': 'Sabio Panda',\n"
        "  '13/64': 'Sabio Dragón',\n",
    ),

    # Descripción del Sabio en el tooltip del ítem (comandos, niveles y beneficios).
    (
        "versions/shared/ui/components/item_tooltip/index.tsx",
        " * item's fields and the hero's stats.\n */\nexport const ItemTooltip = observer(\n",
        " * item's fields and the hero's stats.\n */\n"
        "function sabioLines(item: Item): TooltipLine[] {\n"
        "  if (item.group !== 13) return [];\n"
        "  const names: Record<number, string> = { 0: 'Sabio', 65: 'Sabio Espíritu', 80: 'Sabio Panda', 64: 'Sabio Dragón' };\n"
        "  const stageNum: Record<number, number> = { 0: 1, 65: 2, 80: 3, 64: 4 };\n"
        "  const current = stageNum[item.num];\n"
        "  if (!current) return [];\n"
        "  const L: TooltipLine[] = [];\n"
        "  const add = (text: string, color: TooltipLine['color'] = 'white', bold = false, blank = false) =>\n"
        "    L.push({ text, color, bold, blank });\n"
        "  add('', 'white', false, true);\n"
        "  add('Compañero Sabio (IA de BarrioMU)', 'yellow', true);\n"
        "  add(`Etapa actual: ${current}/4 - ${names[item.num]}`, 'blue', true);\n"
        "  add('Comandos:', 'white', true);\n"
        "  add(' /ia tu pregunta  (hablar con el Sabio)', 'gold', false);\n"
        "  add(' /mascota  (ver etapa y progreso)', 'gold', false);\n"
        "  add('Debes tener al Sabio contigo y activo.', 'gray', false);\n"
        "  add('', 'white', false, true);\n"
        "  add('Niveles y evolución:', 'white', true);\n"
        "  const levels = [\n"
        "    { n: 1, name: 'Sabio', req: 'Inicio', bonus: 'Acompaña y habla en el mapa.' },\n"
        "    { n: 2, name: 'Sabio Espíritu', req: '1 reset o 2 h activo', bonus: 'Sigue a tu lado.' },\n"
        "    { n: 3, name: 'Sabio Panda', req: '2 resets o 4 h activo', bonus: '+50% EXP.' },\n"
        "    { n: 4, name: 'Sabio Dragón', req: '3 resets o 8 h activo', bonus: '+40% ataque (máx.).' },\n"
        "  ];\n"
        "  for (const lv of levels) {\n"
        "    const mark = lv.n === current ? '>' : ' ';\n"
        "    const c: TooltipLine['color'] = lv.n === current ? 'green' : lv.n < current ? 'gray' : 'blue';\n"
        "    add(`${mark} ${lv.n}/4 ${lv.name}: ${lv.req}`, c, lv.n === current);\n"
        "    add(`    ${lv.bonus}`, c, false);\n"
        "  }\n"
        "  add('', 'white', false, true);\n"
        "  add('Puedes llevar otra mascota en la ranura de mascota.', 'white', false);\n"
        "  add('No se tira, vende, comercia ni va al baúl.', 'gray', false);\n"
        "  add('El progreso exacto se ve con /mascota.', 'gray', false);\n"
        "  return L;\n"
        "}\n\n"
        "export const ItemTooltip = observer(\n",
    ),
    (
        "versions/shared/ui/components/item_tooltip/index.tsx",
        "      if (pet !== undefined && petSlot >= 0) all.push(...petLines(pet, petSlot));\n      return all;\n",
        "      if (pet !== undefined && petSlot >= 0) all.push(...petLines(pet, petSlot));\n"
        "      all.push(...sabioLines(item));\n"
        "      return all;\n",
    ),


    # BarrioMU: toque largo en inventario para ver la ficha del ítem.
    (
        "versions/shared/ui/windows/inventory/index.tsx",
        "  const [hover, setHover] = useState<HoverInfo | null>(null);\n  // The equipment squares sit outside the grid but keep their tooltip.\n  useHoverRelease(hover !== null, !!Bag.pendingItemMove, setHover, gridRef, '.equipment-slot');",
        "  const [hover, setHover] = useState<HoverInfo | null>(null);\n  const longPress = useRef<{ timer: number; moved: boolean; slot: number; item: Item; x: number; y: number } | null>(null);\n  const suppressPickRef = useRef(false);\n  const clearLongPress = () => {\n    const lp = longPress.current;\n    if (lp) { window.clearTimeout(lp.timer); longPress.current = null; }\n  };\n  // The equipment squares sit outside the grid but keep their tooltip.\n  useHoverRelease(hover !== null, !!Bag.pendingItemMove, setHover, gridRef, '.equipment-slot');",
    ),
    (
        "versions/shared/ui/windows/inventory/index.tsx",
        "  const onGridPointerDown = (event: React.PointerEvent) => {\n    if (event.button !== 0) return;\n\n    if (picked && pickedSize) {",
        "  const onGridPointerDown = (event: React.PointerEvent) => {\n    if (event.button !== 0) return;\n\n    // BarrioMU: toque largo muestra la ficha del \u00edtem (sin agarrarlo).\n    const isTouch = event.pointerType === 'touch' || event.pointerType === 'pen';\n    if (isTouch && !picked && !Merchant.repairMode) {\n      const sq = squareAt(event.clientX, event.clientY);\n      const ent = sq >= 0 ? squares[sq] : null;\n      if (ent) {\n        clearLongPress();\n        suppressPickRef.current = false;\n        setHover({ item: ent.item, slot: ent.slot, x: event.clientX, y: event.clientY });\n        longPress.current = {\n          timer: window.setTimeout(() => {\n            suppressPickRef.current = true;\n            if (longPress.current) longPress.current.moved = true;\n          }, 450),\n          moved: false, slot: ent.slot, item: ent.item, x: event.clientX, y: event.clientY,\n        };\n        return;\n      }\n    }\n\n    if (picked && pickedSize) {",
    ),
    (
        "versions/shared/ui/windows/inventory/index.tsx",
        "        onPointerMove={event => {\n          // State only moves when the hovered *item* changes, not per event.\n          const square = squareAt(event.clientX, event.clientY);\n          const entry = square >= 0 ? squares[square] : null;\n          setHover(current => {\n            if (!entry) return current === null ? current : null;\n            if (current && current.item === entry.item) return current;\n            return { item: entry.item, slot: entry.slot, x: event.clientX, y: event.clientY };\n          });\n        }}\n        onPointerLeave={() => setHover(null)}",
        "        onPointerMove={event => {\n          // BarrioMU: si se mueve mucho, cancela el toque largo informativo.\n          const lp = longPress.current;\n          if (lp) {\n            const dx = event.clientX - lp.x, dy = event.clientY - lp.y;\n            if (dx * dx + dy * dy > 64) {\n              clearLongPress();\n              setHover(null);\n            }\n          }\n          // State only moves when the hovered *item* changes, not per event.\n          const square = squareAt(event.clientX, event.clientY);\n          const entry = square >= 0 ? squares[square] : null;\n          setHover(current => {\n            if (!entry) return current === null ? current : null;\n            if (current && current.item === entry.item) return current;\n            return { item: entry.item, slot: entry.slot, x: event.clientX, y: event.clientY };\n          });\n        }}\n        onPointerUp={() => {\n          const lp = longPress.current;\n          if (lp) {\n            const suppress = suppressPickRef.current;\n            clearLongPress();\n            if (!suppress) {\n              // toque corto: agarrar \u00edtem\n              if (!Bag.pickedItem) Bag.pickInventoryItem(lp.slot);\n              setHover(null);\n            }\n            // toque largo: mantener ficha visible un momento\n            if (suppress) window.setTimeout(() => setHover(null), 1200);\n            suppressPickRef.current = false;\n          }\n        }}\n        onPointerCancel={() => { clearLongPress(); suppressPickRef.current = false; }}\n        onPointerLeave={() => { clearLongPress(); setHover(null); }}",
    ),


    # BarrioMU: renderizar el compañero Sabio (espacio propio) junto a la mascota de ranura.
    (
        "src/ecs/systems/petSystem.ts",
        "import { Vector3 } from '../../controllers/render/babylon/exports';\nimport { DARK_HORSE, DARK_RAVEN, PET_GROUP } from '@versions/shared/items/petItems';\nimport {\n  FENRIR_ACTION_RUN,\n  FENRIR_ACTION_SKILL,\n  FENRIR_ACTION_WALK,\n  MOUNT_ACTION_MOVE,\n  MOUNT_ACTION_STAND,\n  fenrirMountAction,\n  fenrirShine,\n  petFactoryFor,\n  petSpec,\n  type PetFollow,\n  type PetSpec,\n} from '@/controllers/pets';\nimport { createAngleDeg, turnAngle } from '../../core/turnAngle';\nimport { inChaosCastle } from '../../controllers/actors/locomotion';\nimport { othersShedFully } from '../../controllers/render/loadShed';\nimport { effects } from '../../controllers/fx';\nimport {\n  boneLocalPos,\n  bonePos,\n  delay,\n  entityGone,\n  entityPos,\n  fxNow,\n  inWindow,\n} from '../../controllers/fx/core';\nimport { FOOT_THUNDER_FRAMES, MODEL, RGBS, TEX } from '../../controllers/fx/recipes';\nimport { Drops } from '../../modules/drops';\nimport { PlayerAction } from '@versions/shared/objects/enum';\nimport { RIDER_FLY_WORLDS } from '../../controllers/combat/recipes';\nimport { playUiSound } from '../../controllers/sound/ui';\nimport { playSfx } from '../../controllers/sound/listener';\nimport type { Entity, ISystemFactory, Item } from '../world';\nimport { teleportMountAlpha } from './teleportSystem';\nimport { petShown } from './othersShown';\n\n/**\n * `Mounts[]` and world pets: angel, horns, raven, followers, horse, Fenrir\n * (GOBoid.cpp:66-680, CSPetSystem.cpp:291-610, w_BasePet.cpp). See ecs/readme.md.\n */\n\nconst MU_UNIT = 1 / 100;\nconst TICKS_PER_SECOND = 25;\n\n/** `TurnAngle2(o->Angle[2], Angle, 20.f)` - 20\u00b0 per tick (GOBoid.cpp:636). */\nconst TURN_DEGREES_PER_TICK = 20;\n\n/** The `rand_fps_check(32)` re-roll interval, in ticks. */\nconst REROLL_TICKS = 32;\n\n/** Height band the angel is nudged back into, in MU units (GOBoid.cpp:656-657). */\nconst ANGEL_MIN_HEIGHT = 100;\nconst ANGEL_MAX_HEIGHT = 200;\nconst ANGEL_HEIGHT_NUDGE = 1.5;\n/** Ours, not the original's - see `updateAngel`. The raven's is 640. */\nconst ANGEL_SNAP_DISTANCE = 640;\n\n/** `o->Velocity` - the PlaySpeed each pet's clip runs at. */\nconst ANGEL_PLAY_SPEED = 0.5;\nconst MOUNT_PLAY_SPEED = 0.34;\n\n/** The Dark Horse's Earthshake clip, `SetAction(o, 3)` at `Velocity 0.34`. */\nconst DARK_HORSE_ACTION_SKILL = 3;\n/** Bone 9's blur tip, 60 cm out along the bone. */\nconst HORSE_BLUR_TIP = new Vector3(0.6, 0, 0);\nconst HORSE_BLUR_ROOT = new Vector3(0, 0, 0);\n/** Seconds a horse blur samples at most; it stops with action 3. */\nconst HORSE_BLUR_MAX = 8;\n/** The Dinorant's breath clips under a Fire Breath (GOBoid.cpp:559-564). */\nconst MOUNT_ACTION_BREATH = 6;\nconst MOUNT_ACTION_BREATH_FLY = 7;\n/** `CSPetSystem::PlayAnimation`: the raven's clips run at 0.4. */\nconst RAVEN_PLAY_SPEED = 0.4;\n\n/** Raven heights over the owner, in MU units (CSPetSystem.cpp:450-470). */\nconst RAVEN_HEIGHT = 250;\nconst RAVEN_HEIGHT_HORSE = 350;\nconst RAVEN_HEIGHT_NUDGE = 1.5;\n/** `Position[2] += 300` when the raven is created. */\nconst RAVEN_SPAWN_HEIGHT = 300;\n/** `Distance > 409600` (640 units) - the far failsafe that snaps it home. */\nconst RAVEN_SNAP_DISTANCE = 640;\n\n/** DarkSpirit.bmd clips: 0 glide, 1 flap, 2 perch, 3 attack. */\nconst RAVEN_ACTION_FLY = 0;\nconst RAVEN_ACTION_FLYING = 1;\nconst RAVEN_ACTION_STAND = 2;\n\n/**\n * Follower pets (w_PetActionCollecter.h:9-10). `CIRCLE_STAND_RADIAN` is the\n * circle the collectors walk around their owner, `SEARCH_LENGTH * 3` how far\n * one may be from him before it is put back on him, and `ORBIT_MS` the\n * `fmod(tick, 4000)` that carries it once round. The hover pair has a snap\n * distance of its own: `FlyRange * FlyRange * FlyRange * FlyRange` against a\n * squared distance, which is 2500 units.\n */\nconst CIRCLE_STAND = 50;\nconst SEARCH_LENGTH = 300;\nconst SNAP_HOME = SEARCH_LENGTH * 3;\nconst HOVER_SNAP = 50 * 50;\nconst ORBIT_MS = 4000;\n/** The one clip any of the six ever plays - `Model()` never sets another. */\nconst FOLLOWER_ACTION = 0;\n\n/** What a follower is walking towards this frame, and how it closes on it. */\ntype Chase = {\n  x: number;\n  z: number;\n  stopAt: number;\n  turn: number;\n  speedScale: number;\n};\n\n/**\n * `FindZen` and the three states after it (w_PetActionCollecter.cpp:55-215).\n * `SEARCH_LENGTH` is both how far from its owner a pet looks for a drop and\n * how far it will follow one; `GET_RADIUS` the circle it walks around the\n * drop while it is there, once every two seconds rather than four.\n */\nconst GET_MS = 2000;\n/** `(20.0f >= Distance) ? 0` - how close it gets before it reaches down. */\nconst GET_STOP = 20;\n/** `logf(Distance) * 2.5f` - its pace on an errand, faster than its stroll. */\nconst ERRAND_SPEED = 2.5;\n/** `TurnAngle2(..., 20.f)` going out, `10.f` while it reaches down. */\nconst ERRAND_TURN = 20;\nconst GET_TURN = 10;\n/** `CompTimeControl(3000, \u2026)`: the patience of the Get and Return states. */\nconst ERRAND_PATIENCE = 3;\n/** `CompTimeControl(1000, m_dwSendDelayTime)`: the gap between asks. */\nconst PICKUP_GAP = 1;\n\n/** The perch beside the owner's shoulder, in world units (see header). */\nconst RAVEN_PERCH_UP = 1.4;\nconst RAVEN_PERCH_SIDE = 0.25;\n/** `o->Angle[2] -= 120` while perched. */\nconst RAVEN_PERCH_YAW = -120 * (Math.PI / 180);\n\n/** CSPetSystem.cpp:602-603: 1/6000 per 25 fps tick, drawn as an exponential wait. */\nconst RAVEN_SHOUT_MEAN_SECONDS = 6000 / TICKS_PER_SECOND;\nconst nextRavenShout = () => -Math.log(1 - Math.random()) * RAVEN_SHOUT_MEAN_SECONDS;\n\n/**\n * Fenrir glow cadence. The original re-creates its sprites and lightning\n * every render frame and spawns two bolts each time (ZzzObject.cpp:855-899);\n * at 25 Hz that is ~8 bolts alive at once. Stepping at 14 Hz with two bolts\n * a step keeps the crackle continuous at a third of the spawns.\n */\nconst FENRIR_GLOW_TICK = 0.07;\nconst FENRIR_BOLTS_PER_TICK = 2;\n/** Eye and jaw anchors: `TransformPosition(BoneTransform[11 / 13], \u2026)`. */\nconst FENRIR_HEAD_BONE = 11;\nconst FENRIR_JAW_BONE = 13;\nconst FENRIR_SKILL_BONE = 14;\nconst FENRIR_EYE_LOCALS = [\n  new Vector3(0.5, 0.02, 0.11),\n  new Vector3(0.5, 0.02, -0.11),\n];\nconst FENRIR_JAW_LOCAL = new Vector3(0.4, 0.15, 0);\nconst FENRIR_EYE_RGB = [0.9, 0.2, 0.1] as const;\nconst FENRIR_JAW_RGB = [1.0, 0.3, 0.2] as const;\n/** `CreateSprite(\u2026, 1.5f)` then `1.0f` on the same point. */\nconst FENRIR_JAW_SIZES = [1.05, 0.7] as const;\n\n/**\n * Where one body bolt lands, as `rand() % 30` rolls it (ZzzEffect.cpp:4264-4306).\n * Seven rolls in thirty pin it to a bone, two kill it outright, and the\n * remaining twenty leave it at the wolf's own position - scattered wide in x\n * and lifted 110 units - which is what makes the arcs read as a cloud around\n * the body rather than a string of beads on the skeleton.\n */\nconst DEAD_ROLL = -1;\nconst FENRIR_BOLT_BONES: readonly (number | null)[] = [\n  null,\n  10,\n  10,\n  14,\n  2,\n  2,\n  50,\n  51,\n  53,\n  DEAD_ROLL,\n  DEAD_ROLL,\n];\n/** The four paws `TransformPosition` anchors the footprints to. */\nconst FENRIR_PAW_BONES = [22, 28, 36, 44] as const;\nconst FENRIR_FRONT_PAWS = [22, 28] as const;\nconst FENRIR_BACK_PAWS = [36, 44] as const;\n/** `RenderTerrainAlphaBitmap(\u2026, 0.6f, 0.6f, \u2026)`: the splash is 0.6 tiles across. */\nconst FOOT_THUNDER_TILES = 0.6;\n/** `m_iAnimation++` every 200 ms while `Alpha` falls 0.05 a tick. */\nconst FOOT_THUNDER_FRAME_SECONDS = 0.2;\nconst FOOT_THUNDER_FRAMES_SHOWN = 4;\n/**\n * Which channels `Move_MODEL_FENRIR_FOOT_THUNDER` drains, per variant\n * subtype (MoveHandlers.cpp:6786-6805). The splash is born white and loses\n * these at 0.05 a tick, so it burns down into the wolf's own colour.\n */\nconst FOOT_THUNDER_DRAIN: Readonly<Record<number, readonly [number, number, number]>> = {\n  1: [0, 1, 1],\n  2: [1, 1, 0],\n  3: [1, 0, 1],\n  4: [0, 0, 1],\n};\n\nconst DEG = Math.PI / 180;\n\nconst rand = (n: number) => Math.floor(Math.random() * n);\n\nfunction sameItem(a: Item | null, b: Item | null): boolean {\n  if (a === b) return true;\n  if (!a || !b) return false;\n  return a.group === b.group && a.num === b.num;\n}\n\n/** What an owner currently has an actor for in one slot, and where. */\ntype Spawned = { item: Item; map: number };\n\n/**\n * A slot has to be rebuilt when the item changed, and when its actor was left\n * behind on another map: `unloadMap` sweeps the actors of the map just left,\n * and one spawned in the gap before the hero is moved sits on his old tile.\n */\nfunction stale(current: Spawned | undefined, item: Item | null, map: number) {\n  if (!sameItem(current?.item ?? null, item)) return true;\n  return current !== undefined && current.map !== map;\n}\n\nfunction ravenOf(item: Item | null | undefined): Item | null {\n  return item && item.group === PET_GROUP && item.num === DARK_RAVEN\n    ? item\n    : null;\n}\n\nexport const PetSystem: ISystemFactory = world => {\n  const owners = world.with('charAppearance', 'transform', 'visibility');\n  const actors = world.with('petActor', 'transform');\n  /** `Items[]`: what a collector pet looks through for a pile of zen. */\n  const drops = world.with('droppedItem', 'transform');\n\n  /** The pet each owner currently has an actor for, per slot. */\n  const spawned = new Map<Entity, Spawned>();\n  const spawnedRaven = new Map<Entity, Spawned>();\n  /** Dark Horses whose action-3 blur is running. */\n  const horseBlurs = new WeakSet<Entity>();\n\n  function despawn(owner: Entity, raven: boolean) {\n    (raven ? spawnedRaven : spawned).delete(owner);\n\n    for (const actor of [...actors.entities]) {\n      if (actor.petActor.owner !== owner) continue;\n      if ((actor.petActor.kind === 'raven') !== raven) continue;\n      world.remove(actor);\n      actor.modelObject?.dispose();\n    }\n  }\n\n  owners.onEntityRemoved.subscribe(owner => {\n    despawn(owner, false);\n    despawn(owner, true);\n  });\n\n  // A warp removes every entity of the map just left (`unloadMap`), the pet\n  // actors among them. Without this the slot still reads as filled on the new\n  // map and the pet only comes back on a re-equip.\n  actors.onEntityRemoved.subscribe(actor => {\n    glowClocks.delete(actor);\n    ravenShoutIn.delete(actor);\n    const state = actor.petActor;\n    (state.kind === 'raven' ? spawnedRaven : spawned).delete(state.owner);\n  });\n\n  function spawn(owner: Entity, item: Item, spec: PetSpec) {\n    const pos = owner.transform!.pos;\n    const offset = owner.transform!.posOffset;\n    const map = owner.worldIndex ?? world.mapIndex;\n\n    // CreateMountSub seeds the angel a couple of tiles away and above its\n    // owner; a mount starts exactly on him (GOBoid.cpp:114-125). The raven\n    // starts 300 units straight up (CSPetSystem.cpp:299).\n    const angel = spec.kind === 'angel';\n    const raven = spec.kind === 'raven';\n    const follower = spec.kind === 'follower';\n\n    world.add({\n      worldIndex: map,\n      transform: {\n        pos: new Vector3(\n          pos.x + (angel ? (rand(512) - 256) * MU_UNIT : 0),\n          pos.y +\n            (angel ? (rand(128) + 128) * MU_UNIT : 0) +\n            (raven ? RAVEN_SPAWN_HEIGHT * MU_UNIT : 0),\n          pos.z +\n            (angel ? (rand(512) - 256) * MU_UNIT : 0) +\n            (spec.spawnOffset ?? 0) * MU_UNIT * (owner.transform!.scale ?? 1)\n        ),\n        rot: new Vector3(0, owner.transform!.rot.y, 0),\n        scale: spec.scale,\n        // The owner half-tile render offset, not a fixed one: the character\n        // select line-up stands its characters on exact coordinates with no\n        // offset, and a mount keeping its own put the rider off the saddle.\n        posOffset: offset ? new Vector3(offset.x, offset.y, offset.z) : undefined,\n      },\n      modelFactory: petFactoryFor(spec),\n      visibility: { state: 'hidden', lastChecked: 0 },\n      petActor: {\n        owner,\n        kind: angel\n          ? 'angel'\n          : raven\n            ? 'raven'\n            : follower\n              ? 'follower'\n              : 'mount',\n        yaw: owner.transform!.rot.y,\n        dir: { x: 0, y: 0, z: 0 },\n        reroll: 0,\n        flyRange: (spec.flyRange ?? 0) * MU_UNIT,\n        drop: spec.mountDrop ?? 0,\n        standAction: spec.standAction ?? MOUNT_ACTION_STAND,\n        moveAction: spec.moveAction ?? MOUNT_ACTION_MOVE,\n        fenrirThunder: spec.thunder,\n        fenrirFoot: spec.footSubType,\n        fenrirSpec: spec.shineMesh === undefined ? undefined : spec,\n        follow: spec.follow,\n        followSpeed: spec.playSpeed,\n        pulseSeconds: spec.pulseSeconds,\n        clock: 0,\n      },\n    });\n\n    (raven ? spawnedRaven : spawned).set(owner, { item, map });\n  }\n\n  function updateAngel(actor: Entity, dt: number) {\n    const state = actor.petActor!;\n    const pos = actor.transform!.pos;\n    const target = state.owner.transform?.pos;\n    if (!target) return;\n\n    const ticks = dt * TICKS_PER_SECOND;\n\n    const dx = target.x - pos.x;\n    const dz = target.z - pos.z;\n    const distance2 = dx * dx + dz * dz;\n\n    // Not the original's - the angel is the one pet GOBoid gives no failsafe,\n    // because over there it is created with its owner already standing where\n    // he belongs. Here the hero holds a placeholder tile for the second or\n    // so a map takes to load, and an angel seeded on it was left a hundred\n    // tiles out, flying home at walking pace while its owner stood pet-less.\n    const snap = ANGEL_SNAP_DISTANCE * MU_UNIT;\n    if (distance2 > snap * snap) {\n      pos.x = target.x;\n      pos.z = target.z;\n      pos.y = target.y + ANGEL_MIN_HEIGHT * MU_UNIT;\n      return;\n    }\n\n    const far = distance2 >= state.flyRange * state.flyRange;\n\n    if (far) {\n      const heading = createAngleDeg(pos.x, pos.z, target.x, target.z) * DEG;\n      state.yaw = turnAngle(\n        state.yaw,\n        heading,\n        TURN_DEGREES_PER_TICK * DEG * ticks\n      );\n    }\n\n    // rand_fps_check(32): a fresh heading and speed roughly every 32 ticks.\n    state.reroll -= ticks;\n    if (state.reroll <= 0) {\n      state.reroll = REROLL_TICKS;\n\n      // Forward is -Y in the original's object space, so the speed is negative.\n      const speed = far ? -(rand(64) + 128) * 0.1 : -(rand(64) + 16) * 0.1;\n\n      if (!far) state.yaw = rand(360) * DEG;\n\n      state.dir.y = speed;\n      state.dir.z = (rand(64) - 32) * 0.1;\n    }\n\n    // Height band, applied to the direction rather than to the position.\n    const height = (pos.y - target.y) / MU_UNIT;\n    if (height < ANGEL_MIN_HEIGHT) state.dir.z += ANGEL_HEIGHT_NUDGE * ticks;\n    if (height > ANGEL_MAX_HEIGHT) state.dir.z -= ANGEL_HEIGHT_NUDGE * ticks;\n\n    // VectorRotate((0, speed, dz), AngleMatrix(0, 0, yaw)) with a negative\n    // speed points along the facing direction.\n    const step = state.dir.y * MU_UNIT * ticks;\n    pos.x += -Math.sin(state.yaw) * step;\n    pos.z += Math.cos(state.yaw) * step;\n    pos.y += state.dir.z * MU_UNIT * ticks;\n    // o->Position[2] += rand() % 16 - 8: a flutter on top of the drift.\n    pos.y += (rand(16) - 8) * MU_UNIT * ticks;\n\n    actor.transform!.rot.y = state.yaw;\n\n    actor.modelObject?.setAnimationSpeed(ANGEL_PLAY_SPEED);\n    actor.modelObject?.playAction(MOUNT_ACTION_STAND, true);\n  }\n\n  /**\n   * `CSPetDarkSpirit::MovePet`, PET_FLY / PET_FLYING (CSPetSystem.cpp:420-505):\n   * the same boid drift as the angel, but 250 units over the owner (350 when\n   * he rides a Dark Horse), dashing home once it drifts past FlyRange. The\n   * original steers height through the pitch angle; the angel's direction\n   * nudge stands in for it.\n   */\n  function updateRaven(actor: Entity, dt: number) {\n    const state = actor.petActor!;\n    const pos = actor.transform!.pos;\n    const owner = state.owner;\n    const target = owner.transform?.pos;\n    if (!target) return;\n\n    const ticks = dt * TICKS_PER_SECOND;\n\n    const dx = target.x - pos.x;\n    const dz = target.z - pos.z;\n    const distance2 = dx * dx + dz * dz;\n    const far = distance2 >= state.flyRange * state.flyRange;\n\n    // The far failsafe (:598-608): way off or far below, snap back home.\n    const snap = RAVEN_SNAP_DISTANCE * MU_UNIT;\n    if (distance2 > snap * snap || pos.y < target.y - 2) {\n      pos.x = target.x;\n      pos.z = target.z;\n      pos.y = target.y + RAVEN_SPAWN_HEIGHT * MU_UNIT;\n    }\n\n    if (far) {\n      // TurnAngle2(..., RangeFloat(0,14) + 5): 5..19 degrees per tick.\n      const heading = createAngleDeg(pos.x, pos.z, target.x, target.z) * DEG;\n      state.yaw = turnAngle(state.yaw, heading, (rand(15) + 5) * DEG * ticks);\n    }\n\n    state.reroll -= ticks;\n    if (state.reroll <= 0) {\n      state.reroll = REROLL_TICKS;\n\n      // Far: a dash back (128..191); near: a lazy circle (32..39) on a\n      // rerolled heading. Speeds are negative - forward is -Y (see the angel).\n      const speed = far ? -(rand(64) + 128) * 0.1 : -(rand(8) + 32) * 0.1;\n      if (!far) state.yaw += rand(60) * DEG;\n\n      state.dir.y = (speed + state.dir.y) / 2;\n      state.dir.z = (rand(64) - 32) * 0.1;\n    }\n\n    const ridesHorse =\n      owner.charAppearance?.pet?.group === PET_GROUP &&\n      owner.charAppearance.pet.num === DARK_HORSE;\n    const wanted = ridesHorse ? RAVEN_HEIGHT_HORSE : RAVEN_HEIGHT;\n    const height = (pos.y - target.y) / MU_UNIT;\n    if (height < wanted) state.dir.z += RAVEN_HEIGHT_NUDGE * ticks;\n    if (height > wanted + 100) state.dir.z -= RAVEN_HEIGHT_NUDGE * ticks;\n\n    const step = state.dir.y * MU_UNIT * ticks;\n    pos.x += -Math.sin(state.yaw) * step;\n    pos.z += Math.cos(state.yaw) * step;\n    pos.y += state.dir.z * MU_UNIT * ticks;\n\n    actor.transform!.rot.y = state.yaw;\n\n    actor.modelObject?.setAnimationSpeed(RAVEN_PLAY_SPEED);\n    // `Direction[1] < -12` flips PET_FLY (glide) into PET_FLYING (flap).\n    actor.modelObject?.playAction(\n      state.dir.y < -12 ? RAVEN_ACTION_FLYING : RAVEN_ACTION_FLY,\n      true\n    );\n  }\n\n  /** Seconds until each raven's next shout. */\n  const ravenShoutIn = new Map<Entity, number>();\n\n  function ravenShout(actor: Entity, dt: number) {\n    const left = (ravenShoutIn.get(actor) ?? nextRavenShout()) - dt;\n    if (left > 0) {\n      ravenShoutIn.set(actor, left);\n      return;\n    }\n    ravenShoutIn.set(actor, nextRavenShout());\n    playSfx('Sound/DSpirit_Shout', actor.transform!.pos, { bus: 'combat', channels: 1 });\n  }\n\n  /** PET_STAND (:556-562): perched beside the shoulder, facing 120\u00b0 off. */\n  function perchRaven(actor: Entity) {\n    const state = actor.petActor!;\n    const target = state.owner.transform?.pos;\n    if (!target) return;\n\n    const yaw = state.owner.transform!.rot.y;\n    const pos = actor.transform!.pos;\n    pos.x = target.x + Math.cos(yaw) * RAVEN_PERCH_SIDE;\n    pos.z = target.z + Math.sin(yaw) * RAVEN_PERCH_SIDE;\n    pos.y = target.y + RAVEN_PERCH_UP;\n\n    state.yaw = yaw + RAVEN_PERCH_YAW;\n    actor.transform!.rot.y = state.yaw;\n\n    actor.modelObject?.setAnimationSpeed(RAVEN_PLAY_SPEED);\n    actor.modelObject?.playAction(RAVEN_ACTION_STAND, true);\n  }\n\n  /**\n   * A follower pet: `PetObject::UpdateMove` through whichever `PetAction` its\n   * `Data/Local/pet.bmd` record names (w_PetActionStand / _Demon / _Collecter\n   * / _Collecter_Add / _Unicorn). The three motions are described on\n   * `PetFollow`; what they share is this step - stand off the owner at a\n   * fixed height, turn towards a target point, and crawl towards it at a\n   * speed that is the log of how far away it is.\n   *\n   * None of them has a safe-zone branch and none of them plays more than its\n   * clip 0: `Model()` returns false for every one of the six, so `SetAction`\n   * is never called and `CurrentAction` stays where `Create` left it.\n   */\n  /**\n   * `FindZen` (w_PetActionCollecter.cpp:297-330): the first zen pile lying\n   * within `SEARCH_LENGTH` of the *owner* - not of the pet. The original\n   * walks its whole `Items[]` array and takes the last match; taking the\n   * first is the same pile in every case that matters and stops the walk\n   * early.\n   */\n  function findZen(owner: Entity): Entity | null {\n    const at = owner.transform?.pos;\n    if (!at) return null;\n\n    const reach = SEARCH_LENGTH * MU_UNIT;\n    for (const drop of drops) {\n      if (!drop.droppedItem.isMoney) continue;\n      if (drop.netId === undefined || drop.objOutOfScope) continue;\n      if (drop.worldIndex !== world.mapIndex) continue;\n\n      const dx = drop.transform.pos.x - at.x;\n      const dz = drop.transform.pos.z - at.z;\n      if (dx * dx + dz * dz < reach * reach) return drop;\n    }\n\n    return null;\n  }\n\n  /** Still on the ground, still in scope, still on this map. */\n  function dropAlive(drop: Entity | null): drop is Entity {\n    return (\n      !!drop &&\n      !!drop.droppedItem &&\n      !!drop.transform &&\n      drop.netId !== undefined &&\n      !drop.objOutOfScope &&\n      drop.worldIndex === world.mapIndex &&\n      world.has(drop)\n    );\n  }\n\n  /**\n   * `PetActionCollecter::Move`'s state machine, which decides only *what* the\n   * pet is walking towards: the four states hand back a target and the speed\n   * to close on it, and the step itself is the same one the standing pet\n   * takes. Returns null while the pet has no errand.\n   */\n  function errand(\n    actor: Entity,\n    state: NonNullable<Entity['petActor']>,\n    follow: PetFollow,\n    owner: Entity,\n    circleX: number,\n    circleZ: number,\n    dt: number\n  ): Chase | null {\n    const collect = (state.collect ??= {\n      state: 'stand',\n      target: null,\n      x: 0,\n      z: 0,\n      since: 0,\n      sent: 0,\n    });\n\n    collect.since += dt;\n    collect.sent += dt;\n\n    if (collect.state === 'stand') {\n      const found = findZen(owner);\n      if (!found) return null;\n      collect.target = found;\n      collect.x = found.transform!.pos.x;\n      collect.z = found.transform!.pos.z;\n      collect.state = 'move';\n      collect.since = 0;\n    }\n\n    const pos = actor.transform!.pos;\n    const away = Math.hypot(\n      (collect.x - pos.x) / MU_UNIT,\n      (collect.z - pos.z) / MU_UNIT\n    );\n\n    switch (collect.state) {\n      case 'move': {\n        if (!dropAlive(collect.target)) {\n          collect.state = 'return';\n          collect.since = 0;\n          break;\n        }\n        // Circling the pile as it comes in, twice as fast as it circles its\n        // owner (`m_fRadWidthGet`).\n        const phase =\n          (((state.clock ?? 0) % GET_MS) / GET_MS) * Math.PI * 2;\n        const x = collect.x + Math.sin(phase) * CIRCLE_STAND * MU_UNIT;\n        const z = collect.z + Math.cos(phase) * CIRCLE_STAND * MU_UNIT;\n\n        // `0 == Speed`: the distance that decides is to the point on the\n        // circle it is chasing, not to the pile in the middle of it.\n        const reach = Math.hypot((x - pos.x) / MU_UNIT, (z - pos.z) / MU_UNIT);\n        if (reach <= GET_STOP) {\n          collect.state = 'get';\n          collect.since = 0;\n          collect.sent = PICKUP_GAP;\n          break;\n        }\n\n        return {\n          x,\n          z,\n          stopAt: GET_STOP,\n          turn: ERRAND_TURN,\n          speedScale: ERRAND_SPEED,\n        };\n      }\n      case 'get': {\n        const gone =\n          !dropAlive(collect.target) ||\n          away > SEARCH_LENGTH ||\n          collect.since > ERRAND_PATIENCE;\n        if (gone) {\n          collect.target = null;\n          collect.state = 'return';\n          collect.since = 0;\n          // `PlayBuffer(SOUND_DROP_GOLD01)` on the way home. The original\n          // plays it every frame of the state; once is what it meant.\n          if (owner.localPlayer) playUiSound('dropMoney');\n          break;\n        }\n\n        // Only the hero's own pet asks for the pile: the others are somebody\n        // else's client's business (`&Hero->Object == obj->Owner`).\n        if (owner.localPlayer && collect.sent >= PICKUP_GAP) {\n          collect.sent = 0;\n          if (!world.pickupTarget) {\n            Drops.pickupItemRequest(collect.target!.netId!);\n          }\n        }\n\n        return {\n          x: collect.x,\n          z: collect.z,\n          stopAt: 0,\n          turn: GET_TURN,\n          speedScale: ERRAND_SPEED,\n        };\n      }\n      case 'return':\n        break;\n    }\n\n    // Back to the circle it walks around its owner, at the errand's pace.\n    // It is home once it is inside `FlyRange` of that point, or once its\n    // patience runs out wherever it has got to.\n    const home = Math.hypot(\n      (circleX - pos.x) / MU_UNIT,\n      (circleZ - pos.z) / MU_UNIT\n    );\n    if (home <= follow.flyRange || collect.since > ERRAND_PATIENCE) {\n      collect.state = 'stand';\n      collect.since = 0;\n      return null;\n    }\n\n    return {\n      x: circleX,\n      z: circleZ,\n      stopAt: follow.flyRange,\n      turn: ERRAND_TURN,\n      speedScale: ERRAND_SPEED,\n    };\n  }\n\n  function updateFollower(actor: Entity, dt: number) {\n    const state = actor.petActor!;\n    const follow = state.follow;\n    const owner = state.owner.transform;\n    if (!follow || !owner) return;\n\n    const ticks = dt * TICKS_PER_SECOND;\n    const clock = (state.clock = (state.clock ?? 0) + dt * 1000);\n    const pos = actor.transform!.pos;\n\n    // `obj->Position[2] = obj->Owner->Position[2] + n`, the one axis the pet\n    // never steers for itself.\n    pos.y =\n      owner.pos.y +\n      follow.hover * MU_UNIT * (follow.hoverScaled ? owner.scale : 1);\n\n    // The point that circles the owner once every four seconds: what an\n    // orbiting pet chases, and where any of the four ground-level ones is\n    // put back down when it falls too far behind.\n    const phase = ((clock % ORBIT_MS) / ORBIT_MS) * Math.PI * 2;\n    const circleX = owner.pos.x + Math.sin(phase) * CIRCLE_STAND * MU_UNIT;\n    const circleZ = owner.pos.z + Math.cos(phase) * CIRCLE_STAND * MU_UNIT;\n\n    const orbit = follow.motion === 'orbit';\n    const hover = follow.motion === 'hover';\n\n    // An errand overrides where the pet is headed, how close it gets and how\n    // fast it turns; everything below is the same step either way.\n    const chase = follow.collects\n      ? errand(actor, state, follow, state.owner, circleX, circleZ, dt)\n      : null;\n\n    const targetX = chase?.x ?? (orbit ? circleX : owner.pos.x);\n    const targetZ = chase?.z ?? (orbit ? circleZ : owner.pos.z);\n    const stopAt = chase?.stopAt ?? follow.stopAt;\n    const turn = chase?.turn ?? follow.turn;\n    const speedScale = chase?.speedScale ?? follow.speedScale;\n\n    // Left too far behind - a warp, or a long stretch out of scope.\n    const homeX = (pos.x - owner.pos.x) / MU_UNIT;\n    const homeZ = (pos.z - owner.pos.z) / MU_UNIT;\n    const home2 = homeX * homeX + homeZ * homeZ;\n    if (home2 > (hover ? HOVER_SNAP * HOVER_SNAP : SNAP_HOME * SNAP_HOME)) {\n      // The hover pair lands on the owner; the rest on the circle, which is\n      // what keeps a pet that aims at his own tile from sitting inside him.\n      pos.x = hover ? owner.pos.x : circleX;\n      pos.z = hover ? owner.pos.z : circleZ;\n      state.yaw = owner.rot.y;\n    }\n\n    const dx = (targetX - pos.x) / MU_UNIT;\n    const dz = (targetZ - pos.z) / MU_UNIT;\n    // The hover pair never takes the root of it - see `PetFollow`.\n    const distance2 = dx * dx + dz * dz;\n    const distance = hover ? distance2 : Math.sqrt(distance2);\n\n    // `if (80.0f >= FlyRange)`: true for every one of them, so the orbit and\n    // trail pets turn on every tick and only the hover pair holds a heading\n    // until it is a stop radius out.\n    if (!hover || distance2 >= stopAt) {\n      const heading = createAngleDeg(pos.x, pos.z, targetX, targetZ) * DEG;\n      state.yaw = turnAngle(state.yaw, heading, turn * DEG * ticks);\n    }\n\n    // The original applies the direction it worked out last frame and only\n    // then computes this frame's - keep the order, it is what lets a pet\n    // overshoot its target by a step and turn back.\n    const step = state.dir.y * MU_UNIT * ticks;\n    pos.x += -Math.sin(state.yaw) * step;\n    pos.z += Math.cos(state.yaw) * step;\n    actor.transform!.rot.y = state.yaw;\n\n    const speed =\n      stopAt >= distance\n        ? 0\n        : Math.log(distance) * speedScale + (follow.speedBias ?? 0);\n    // Forward is -Y in the original's object space.\n    state.dir.y = -speed;\n\n    // `PetActionDemon::Model`: the body light breathes over ten seconds.\n    if (state.pulseSeconds !== undefined) {\n      const period = state.pulseSeconds * 1000;\n      actor.modelObject?.SelfLight.setAll(\n        Math.sin((Math.PI * (clock % period)) / period)\n      );\n    }\n\n    const play = state.followSpeed ?? 1;\n    const factor =\n      speed === 0 ? (follow.idleSpeed ?? 1) : (follow.moveSpeed ?? 1);\n    actor.modelObject?.setAnimationSpeed(play * factor);\n    actor.modelObject?.playAction(FOLLOWER_ACTION, true);\n  }\n\n  /** Per-actor clock for the Fenrir glow spawns. */\n  const glowClocks = new Map<Entity, number>();\n\n  const tmpGlow = new Vector3();\n  const tmpFoot = new Vector3();\n\n  /**\n   * One body bolt: `CreateEffect(MODEL_FENRIR_THUNDER, o->Position, \u2026, 0, o)`\n   * plus the `BITMAP_LIGHT` sprite the original hangs on every one of them\n   * (ZzzEffect.cpp:4249-4312). The flash lasts about a sixth of a second -\n   * alpha 0.7 up to 1 and back down at 0.3 a tick (MoveHandlers.cpp:6645-6675).\n   */\n  function spawnFenrirBolt(\n    actor: Entity,\n    colour: readonly [number, number, number]\n  ) {\n    const scene = world.scene;\n    if (!scene) return;\n\n    const roll = FENRIR_BOLT_BONES[rand(30)] ?? null;\n    if (roll === DEAD_ROLL) return;\n\n    let scale = 0.3 + Math.random() * 0.2;\n\n    if (roll === null) {\n      // The wolf's own position, thrown wide and lifted: \u00b1120 / \u00b15 / +110.\n      entityPos(actor, 0, tmpGlow);\n      tmpGlow.x += (rand(240) - 120) * MU_UNIT;\n      tmpGlow.z += (rand(10) - 5) * MU_UNIT;\n      tmpGlow.y += 110 * MU_UNIT;\n      scale += 0.1;\n    } else {\n      bonePos(actor, roll, tmpGlow, 0.6);\n      scale -= 0.2;\n    }\n\n    effects.spawn('model', scene, tmpGlow, {\n      model: MODEL.lightningType,\n      colour,\n      seconds: 0.18,\n      scale: Math.max(0.1, scale),\n      yaw: Math.random() * Math.PI * 2,\n      alpha: 0.9,\n      fadeIn: 0.25,\n      fadeTail: 0.7,\n    });\n\n    // `CreateSprite(BITMAP_LIGHT, o->Position, 2.0f, Light \u2212 0.3)`: the halo\n    // that makes a bolt read as light rather than as a lit wireframe.\n    effects.spawn('sprite', scene, tmpGlow, {\n      texture: TEX.flare,\n      colour: [\n        Math.max(0, colour[0] - 0.3),\n        Math.max(0, colour[1] - 0.3),\n        Math.max(0, colour[2] - 0.3),\n      ],\n      size: 0.7,\n      seconds: 0.18,\n      fadeTail: 0.7,\n    });\n  }\n\n  /**\n   * The splash one paw leaves: `RenderTerrainAlphaBitmap(BITMAP_FENRIR_FOOT_\n   * THUNDER1 + (m_iAnimation % 5), \u2026)`, a frame every 200 ms while the object\n   * fades and its light drains to the variant's colour (ZzzEffect.cpp:9058,\n   * MoveHandlers.cpp:6780-6810). Four frames is where the alpha reaches zero.\n   */\n  function spawnFootThunder(at: Vector3, subType: number) {\n    const drain = FOOT_THUNDER_DRAIN[subType] ?? [0, 0, 0];\n    const x = at.x;\n    const z = at.z;\n\n    for (let i = 0; i < FOOT_THUNDER_FRAMES_SHOWN; i++) {\n      const fade = 1 - i / FOOT_THUNDER_FRAMES_SHOWN;\n      // The art is a JPG with a black ground, so it is drawn additive and\n      // the fading alpha rides the colour rather than a blend factor.\n      const colour: [number, number, number] = [\n        fade * (1 - drain[0] * (1 - fade)),\n        fade * (1 - drain[1] * (1 - fade)),\n        fade * (1 - drain[2] * (1 - fade)),\n      ];\n      const draw = () => {\n        const live = world.scene;\n        if (!live) return;\n        tmpFoot.set(x, 0, z);\n        effects.spawn('ring', live, tmpFoot, {\n          texture: FOOT_THUNDER_FRAMES[i],\n          colour,\n          scale: FOOT_THUNDER_TILES,\n          seconds: FOOT_THUNDER_FRAME_SECONDS,\n          fadeTail: 0.25,\n        });\n      };\n      if (i === 0) draw();\n      else delay(i * FOOT_THUNDER_FRAME_SECONDS, draw);\n    }\n  }\n\n  /**\n   * `MODEL_FENRIR_FOOT_THUNDER` (ZzzObject.cpp:900-940): lightning under the\n   * paws on the frames they touch down - all four across the first keys of\n   * the walk, the front and back pairs apart on the run.\n   */\n  function updateFootThunder(actor: Entity) {\n    const state = actor.petActor!;\n    const model = actor.modelObject;\n    if (!model?.gltf || state.fenrirFoot === undefined) return;\n\n    const action = model.CurrentAction;\n    const frame = model.actionFrame();\n    const prev = state.fenrirFrame ?? -1;\n    state.fenrirFrame = frame;\n\n    let paws: readonly number[] | null = null;\n\n    if (action === FENRIR_ACTION_WALK) {\n      if (inWindow(prev, frame, 0, 1.5)) paws = FENRIR_PAW_BONES;\n    } else if (action === FENRIR_ACTION_RUN) {\n      if (inWindow(prev, frame, 1, 1.4)) paws = FENRIR_FRONT_PAWS;\n      else if (inWindow(prev, frame, 4.8, 5.2)) paws = FENRIR_BACK_PAWS;\n    }\n\n    if (!paws) return;\n\n    for (const bone of paws) {\n      bonePos(actor, bone, tmpGlow, 0);\n      spawnFootThunder(tmpGlow, state.fenrirFoot);\n    }\n  }\n\n  /**\n   * The per-frame eye / jaw sprites and the variant-coloured body lightning\n   * of the original's Fenrir render branch (ZzzObject.cpp:793-940), as\n   * periodic effect spawns. Not called in a safe zone - the mount is faded\n   * out there and the original skips the branch with it.\n   */\n  function updateFenrirGlow(actor: Entity, dt: number) {\n    const state = actor.petActor!;\n\n    // Read every frame: a footfall window is a fifth of a clip and the glow\n    // tick would step straight over it.\n    updateFootThunder(actor);\n\n    const clock = (glowClocks.get(actor) ?? 0) + dt;\n    if (clock < FENRIR_GLOW_TICK) {\n      glowClocks.set(actor, clock);\n      return;\n    }\n    glowClocks.set(actor, clock % FENRIR_GLOW_TICK);\n\n    const scene = world.scene;\n    if (!scene || !actor.modelObject?.gltf) return;\n\n    // `sinf(WorldTime * 0.002f) * 0.2f` on a clock in milliseconds: the eyes\n    // breathe rather than sitting on one red.\n    const lum = Math.sin(fxNow() * 2) * 0.2;\n\n    for (const local of FENRIR_EYE_LOCALS) {\n      boneLocalPos(actor, FENRIR_HEAD_BONE, local, tmpGlow);\n      effects.spawn('sprite', scene, tmpGlow, {\n        texture: TEX.flare,\n        colour: [\n          FENRIR_EYE_RGB[0] + lum,\n          FENRIR_EYE_RGB[1] + lum * 0.5,\n          FENRIR_EYE_RGB[2] + lum * 0.5,\n        ],\n        size: 0.35 + lum * 0.07,\n        seconds: 0.16,\n        fadeTail: 0.6,\n      });\n    }\n\n    // Two cards on the jaw, a small one inside a big one.\n    boneLocalPos(actor, FENRIR_JAW_BONE, FENRIR_JAW_LOCAL, tmpGlow);\n    for (const size of FENRIR_JAW_SIZES) {\n      effects.spawn('sprite', scene, tmpGlow, {\n        texture: TEX.flare,\n        colour: FENRIR_JAW_RGB,\n        size,\n        seconds: 0.16,\n        fadeTail: 0.6,\n      });\n    }\n\n    if (!othersShedFully(state.owner, performance.now())) {\n      for (let i = 0; i < FENRIR_BOLTS_PER_TICK; i++) spawnFenrirBolt(actor, state.fenrirThunder!);\n    }\n\n    // The skill clip: the body pass is drawn a second time and a red chip\n    // flies off the jaw (ZzzObject.cpp:812-840). The shine object is the one\n    // the material binds every frame, so raising it is that second pass; it\n    // is re-read here rather than at spawn so the Item effects option takes\n    // hold the moment it is changed.\n    const casting = actor.modelObject.CurrentAction === FENRIR_ACTION_SKILL;\n    if (state.fenrirSpec) {\n      fenrirShine(actor.modelObject, state.fenrirSpec, casting);\n    }\n\n    if (casting) {\n      tmpFoot.set(\n        (rand(10) - 10) * 0.5 * MU_UNIT,\n        0,\n        (rand(40) - 20) * 0.5 * MU_UNIT\n      );\n      boneLocalPos(actor, FENRIR_SKILL_BONE, tmpFoot, tmpGlow);\n      effects.spawn('sprite', scene, tmpGlow, {\n        texture: TEX.spark3,\n        colour: [1, 0, 0],\n        size: 0.7 + lum * 0.05,\n        seconds: 0.3,\n        rise: 0.6,\n        fadeTail: 0.5,\n      });\n    }\n  }\n\n  function updateMount(actor: Entity, dt: number, inSafeZone: boolean) {\n    const state = actor.petActor!;\n    const target = state.owner.transform?.pos;\n    if (!target) return;\n\n    const pos = actor.transform!.pos;\n    pos.x = target.x;\n    pos.y = target.y - state.drop;\n    pos.z = target.z;\n    actor.transform!.rot.y = state.owner.transform!.rot.y;\n\n    // Faded out in town: pinned, but no clip and no Fenrir glow behind it.\n    if (inSafeZone) return;\n\n    // A Fenrir mirrors its rider's clip family instead of the stand/move\n    // pair, at the per-clip velocities of MoveMount.\n    if (state.fenrirThunder) {\n      const rider = state.owner.modelObject?.CurrentAction ?? -1;\n      const mirrored = fenrirMountAction(rider);\n      actor.modelObject?.setAnimationSpeed(mirrored.playSpeed);\n      actor.modelObject?.playAction(mirrored.action, true);\n      updateFenrirGlow(actor, dt);\n      return;\n    }\n\n    // The Dark Horse rears on its action 3 under Earthshake (GOBoid.cpp:337-341).\n    const pet = state.owner.charAppearance?.pet;\n    if (\n      pet?.group === PET_GROUP &&\n      pet.num === DARK_HORSE &&\n      state.owner.modelObject?.CurrentAction === PlayerAction.PLAYER_ATTACK_DARKHORSE\n    ) {\n      actor.modelObject?.setAnimationSpeed(MOUNT_PLAY_SPEED);\n      actor.modelObject?.playAction(DARK_HORSE_ACTION_SKILL, true);\n      if (actor.modelObject?.CurrentAction === DARK_HORSE_ACTION_SKILL && !horseBlurs.has(actor)) {\n        horseBlurs.add(actor);\n        // The white blur from (60, 0, 0) to bone 9, every frame of action 3 (GOBoid.cpp:452-461).\n        effects.spawn('blur', world.scene, HORSE_BLUR_ROOT, {\n          follow: out => boneLocalPos(actor, 9, HORSE_BLUR_TIP, out),\n          base: out => boneLocalPos(actor, 9, HORSE_BLUR_ROOT, out),\n          texture: TEX.blur,\n          colour: RGBS.white,\n          seconds: HORSE_BLUR_MAX,\n          until: () => {\n            const on = !entityGone(actor) && actor.modelObject?.CurrentAction === DARK_HORSE_ACTION_SKILL;\n            if (!on) horseBlurs.delete(actor);\n            return !on;\n          },\n        });\n      }\n      return;\n    }\n\n    const velocity = state.owner.movement?.velocity;\n    const moving = !!velocity && (velocity.x !== 0 || velocity.y !== 0);\n\n    actor.modelObject?.setAnimationSpeed(MOUNT_PLAY_SPEED);\n\n    // Fire Breath: the mount breathes with its rider, clip 7 in the fly worlds and 6 elsewhere\n    // (GOBoid.cpp:559-564). SetAction skips a clip the model lacks, so the Uniria stays as it is.\n    const rider = state.owner.modelObject?.CurrentAction;\n    if (rider === PlayerAction.PLAYER_SKILL_RIDER || rider === PlayerAction.PLAYER_SKILL_RIDER_FLY) {\n      const breath = RIDER_FLY_WORLDS.has(world.mapIndex) ? MOUNT_ACTION_BREATH_FLY : MOUNT_ACTION_BREATH;\n      if (actor.modelObject?.gltf?.animationGroups[breath]) {\n        actor.modelObject.playAction(breath, true);\n        return;\n      }\n    }\n    actor.modelObject?.playAction(\n      moving ? state.moveAction : state.standAction,\n      true\n    );\n  }\n\n  return {\n    update: dt => {\n      const chaosCastle = inChaosCastle(world.mapIndex);\n\n      for (const owner of owners) {\n        const map = owner.worldIndex ?? world.mapIndex;\n        const wanted = chaosCastle ? null : owner.charAppearance.pet;\n        const spec = petSpec(wanted);\n        // The Imp is not a world object - PlayerObject.Pet carries it.\n        const wantsActor = spec && spec.kind !== 'imp' && petShown(owner, spec.kind) ? wanted : null;\n\n        if (stale(spawned.get(owner), wantsActor, map)) {\n          despawn(owner, false);\n          if (wantsActor && spec) spawn(owner, wantsActor, spec);\n        }\n\n        // The raven rides inventory slot 1 (the shield hand, `rightHand`\n        // here), beside whatever the pet slot holds.\n        const raven = chaosCastle || !petShown(owner, 'raven')\n          ? null\n          : ravenOf(owner.charAppearance.rightHand);\n        if (stale(spawnedRaven.get(owner), raven, map)) {\n          despawn(owner, true);\n          const ravenSpec = petSpec(raven);\n          if (raven && ravenSpec) spawn(owner, raven, ravenSpec);\n        }\n      }\n\n      for (const actor of actors) {\n        const state = actor.petActor;\n\n        const inSafeZone =\n          state.owner.attributeSystem?.isAboveZero('inSafeZone') ?? false;\n\n        // The raven stays visible in town: it perches instead of fading.\n        if (state.kind === 'raven') {\n          actor.modelObject?.setAlpha(1);\n          if (inSafeZone) perchRaven(actor);\n          else updateRaven(actor, dt);\n          ravenShout(actor, dt);\n          continue;\n        }\n\n        // The angel has no safe-zone branch of its own: it keeps flying, and\n        // in town too. Freezing it there left the actor a town behind, with\n        // nothing but a re-equip to bring it home.\n        if (state.kind === 'angel') {\n          actor.modelObject?.setAlpha(1);\n          updateAngel(actor, dt);\n          continue;\n        }\n\n        // Nor has a follower: `PetObject` has no safe-zone branch either, so\n        // the Panda keeps circling its owner in town.\n        if (state.kind === 'follower') {\n          actor.modelObject?.setAlpha(1);\n          updateFollower(actor, dt);\n          continue;\n        }\n\n        // A mount is faded out instead (o->Alpha = 0), but stays pinned to its\n        // rider so it is already in place the moment he steps out of town.\n        // And with the rider through a teleport (GOBoid.cpp:189-197).\n        actor.modelObject?.setFadeAlpha(inSafeZone ? 0 : teleportMountAlpha(state.owner));\n        updateMount(actor, dt, inSafeZone);\n      }\n    },\n  };\n};\n",
        "import { Vector3 } from '../../controllers/render/babylon/exports';\nimport { DARK_HORSE, DARK_RAVEN, PET_GROUP } from '@versions/shared/items/petItems';\nimport {\n  FENRIR_ACTION_RUN,\n  FENRIR_ACTION_SKILL,\n  FENRIR_ACTION_WALK,\n  MOUNT_ACTION_MOVE,\n  MOUNT_ACTION_STAND,\n  fenrirMountAction,\n  fenrirShine,\n  petFactoryFor,\n  petSpec,\n  type PetFollow,\n  type PetSpec,\n} from '@/controllers/pets';\nimport { createAngleDeg, turnAngle } from '../../core/turnAngle';\nimport { inChaosCastle } from '../../controllers/actors/locomotion';\nimport { othersShedFully } from '../../controllers/render/loadShed';\nimport { effects } from '../../controllers/fx';\nimport {\n  boneLocalPos,\n  bonePos,\n  delay,\n  entityGone,\n  entityPos,\n  fxNow,\n  inWindow,\n} from '../../controllers/fx/core';\nimport { FOOT_THUNDER_FRAMES, MODEL, RGBS, TEX } from '../../controllers/fx/recipes';\nimport { Drops } from '../../modules/drops';\nimport { PlayerAction } from '@versions/shared/objects/enum';\nimport { Hero } from '../../modules/hero';\nimport { InventoryConstants } from '../../core/inventoryConstants';\nimport { RIDER_FLY_WORLDS } from '../../controllers/combat/recipes';\nimport { playUiSound } from '../../controllers/sound/ui';\nimport { playSfx } from '../../controllers/sound/listener';\nimport type { Entity, ISystemFactory, Item } from '../world';\nimport { teleportMountAlpha } from './teleportSystem';\nimport { petShown } from './othersShown';\n\n/**\n * `Mounts[]` and world pets: angel, horns, raven, followers, horse, Fenrir\n * (GOBoid.cpp:66-680, CSPetSystem.cpp:291-610, w_BasePet.cpp). See ecs/readme.md.\n */\n\nconst MU_UNIT = 1 / 100;\nconst TICKS_PER_SECOND = 25;\n\n/** `TurnAngle2(o->Angle[2], Angle, 20.f)` - 20\u00b0 per tick (GOBoid.cpp:636). */\nconst TURN_DEGREES_PER_TICK = 20;\n\n/** The `rand_fps_check(32)` re-roll interval, in ticks. */\nconst REROLL_TICKS = 32;\n\n/** Height band the angel is nudged back into, in MU units (GOBoid.cpp:656-657). */\nconst ANGEL_MIN_HEIGHT = 100;\nconst ANGEL_MAX_HEIGHT = 200;\nconst ANGEL_HEIGHT_NUDGE = 1.5;\n/** Ours, not the original's - see `updateAngel`. The raven's is 640. */\nconst ANGEL_SNAP_DISTANCE = 640;\n\n/** `o->Velocity` - the PlaySpeed each pet's clip runs at. */\nconst ANGEL_PLAY_SPEED = 0.5;\nconst MOUNT_PLAY_SPEED = 0.34;\n\n/** The Dark Horse's Earthshake clip, `SetAction(o, 3)` at `Velocity 0.34`. */\nconst DARK_HORSE_ACTION_SKILL = 3;\n/** Bone 9's blur tip, 60 cm out along the bone. */\nconst HORSE_BLUR_TIP = new Vector3(0.6, 0, 0);\nconst HORSE_BLUR_ROOT = new Vector3(0, 0, 0);\n/** Seconds a horse blur samples at most; it stops with action 3. */\nconst HORSE_BLUR_MAX = 8;\n/** The Dinorant's breath clips under a Fire Breath (GOBoid.cpp:559-564). */\nconst MOUNT_ACTION_BREATH = 6;\nconst MOUNT_ACTION_BREATH_FLY = 7;\n/** `CSPetSystem::PlayAnimation`: the raven's clips run at 0.4. */\nconst RAVEN_PLAY_SPEED = 0.4;\n\n/** Raven heights over the owner, in MU units (CSPetSystem.cpp:450-470). */\nconst RAVEN_HEIGHT = 250;\nconst RAVEN_HEIGHT_HORSE = 350;\nconst RAVEN_HEIGHT_NUDGE = 1.5;\n/** `Position[2] += 300` when the raven is created. */\nconst RAVEN_SPAWN_HEIGHT = 300;\n/** `Distance > 409600` (640 units) - the far failsafe that snaps it home. */\nconst RAVEN_SNAP_DISTANCE = 640;\n\n/** DarkSpirit.bmd clips: 0 glide, 1 flap, 2 perch, 3 attack. */\nconst RAVEN_ACTION_FLY = 0;\nconst RAVEN_ACTION_FLYING = 1;\nconst RAVEN_ACTION_STAND = 2;\n\n/**\n * Follower pets (w_PetActionCollecter.h:9-10). `CIRCLE_STAND_RADIAN` is the\n * circle the collectors walk around their owner, `SEARCH_LENGTH * 3` how far\n * one may be from him before it is put back on him, and `ORBIT_MS` the\n * `fmod(tick, 4000)` that carries it once round. The hover pair has a snap\n * distance of its own: `FlyRange * FlyRange * FlyRange * FlyRange` against a\n * squared distance, which is 2500 units.\n */\nconst CIRCLE_STAND = 50;\nconst SEARCH_LENGTH = 300;\nconst SNAP_HOME = SEARCH_LENGTH * 3;\nconst HOVER_SNAP = 50 * 50;\nconst ORBIT_MS = 4000;\n/** The one clip any of the six ever plays - `Model()` never sets another. */\nconst FOLLOWER_ACTION = 0;\n\n/** What a follower is walking towards this frame, and how it closes on it. */\ntype Chase = {\n  x: number;\n  z: number;\n  stopAt: number;\n  turn: number;\n  speedScale: number;\n};\n\n/**\n * `FindZen` and the three states after it (w_PetActionCollecter.cpp:55-215).\n * `SEARCH_LENGTH` is both how far from its owner a pet looks for a drop and\n * how far it will follow one; `GET_RADIUS` the circle it walks around the\n * drop while it is there, once every two seconds rather than four.\n */\nconst GET_MS = 2000;\n/** `(20.0f >= Distance) ? 0` - how close it gets before it reaches down. */\nconst GET_STOP = 20;\n/** `logf(Distance) * 2.5f` - its pace on an errand, faster than its stroll. */\nconst ERRAND_SPEED = 2.5;\n/** `TurnAngle2(..., 20.f)` going out, `10.f` while it reaches down. */\nconst ERRAND_TURN = 20;\nconst GET_TURN = 10;\n/** `CompTimeControl(3000, \u2026)`: the patience of the Get and Return states. */\nconst ERRAND_PATIENCE = 3;\n/** `CompTimeControl(1000, m_dwSendDelayTime)`: the gap between asks. */\nconst PICKUP_GAP = 1;\n\n/** The perch beside the owner's shoulder, in world units (see header). */\nconst RAVEN_PERCH_UP = 1.4;\nconst RAVEN_PERCH_SIDE = 0.25;\n/** `o->Angle[2] -= 120` while perched. */\nconst RAVEN_PERCH_YAW = -120 * (Math.PI / 180);\n\n/** CSPetSystem.cpp:602-603: 1/6000 per 25 fps tick, drawn as an exponential wait. */\nconst RAVEN_SHOUT_MEAN_SECONDS = 6000 / TICKS_PER_SECOND;\nconst nextRavenShout = () => -Math.log(1 - Math.random()) * RAVEN_SHOUT_MEAN_SECONDS;\n\n/**\n * Fenrir glow cadence. The original re-creates its sprites and lightning\n * every render frame and spawns two bolts each time (ZzzObject.cpp:855-899);\n * at 25 Hz that is ~8 bolts alive at once. Stepping at 14 Hz with two bolts\n * a step keeps the crackle continuous at a third of the spawns.\n */\nconst FENRIR_GLOW_TICK = 0.07;\nconst FENRIR_BOLTS_PER_TICK = 2;\n/** Eye and jaw anchors: `TransformPosition(BoneTransform[11 / 13], \u2026)`. */\nconst FENRIR_HEAD_BONE = 11;\nconst FENRIR_JAW_BONE = 13;\nconst FENRIR_SKILL_BONE = 14;\nconst FENRIR_EYE_LOCALS = [\n  new Vector3(0.5, 0.02, 0.11),\n  new Vector3(0.5, 0.02, -0.11),\n];\nconst FENRIR_JAW_LOCAL = new Vector3(0.4, 0.15, 0);\nconst FENRIR_EYE_RGB = [0.9, 0.2, 0.1] as const;\nconst FENRIR_JAW_RGB = [1.0, 0.3, 0.2] as const;\n/** `CreateSprite(\u2026, 1.5f)` then `1.0f` on the same point. */\nconst FENRIR_JAW_SIZES = [1.05, 0.7] as const;\n\n/**\n * Where one body bolt lands, as `rand() % 30` rolls it (ZzzEffect.cpp:4264-4306).\n * Seven rolls in thirty pin it to a bone, two kill it outright, and the\n * remaining twenty leave it at the wolf's own position - scattered wide in x\n * and lifted 110 units - which is what makes the arcs read as a cloud around\n * the body rather than a string of beads on the skeleton.\n */\nconst DEAD_ROLL = -1;\nconst FENRIR_BOLT_BONES: readonly (number | null)[] = [\n  null,\n  10,\n  10,\n  14,\n  2,\n  2,\n  50,\n  51,\n  53,\n  DEAD_ROLL,\n  DEAD_ROLL,\n];\n/** The four paws `TransformPosition` anchors the footprints to. */\nconst FENRIR_PAW_BONES = [22, 28, 36, 44] as const;\nconst FENRIR_FRONT_PAWS = [22, 28] as const;\nconst FENRIR_BACK_PAWS = [36, 44] as const;\n/** `RenderTerrainAlphaBitmap(\u2026, 0.6f, 0.6f, \u2026)`: the splash is 0.6 tiles across. */\nconst FOOT_THUNDER_TILES = 0.6;\n/** `m_iAnimation++` every 200 ms while `Alpha` falls 0.05 a tick. */\nconst FOOT_THUNDER_FRAME_SECONDS = 0.2;\nconst FOOT_THUNDER_FRAMES_SHOWN = 4;\n/**\n * Which channels `Move_MODEL_FENRIR_FOOT_THUNDER` drains, per variant\n * subtype (MoveHandlers.cpp:6786-6805). The splash is born white and loses\n * these at 0.05 a tick, so it burns down into the wolf's own colour.\n */\nconst FOOT_THUNDER_DRAIN: Readonly<Record<number, readonly [number, number, number]>> = {\n  1: [0, 1, 1],\n  2: [1, 1, 0],\n  3: [1, 0, 1],\n  4: [0, 0, 1],\n};\n\nconst DEG = Math.PI / 180;\n\nconst rand = (n: number) => Math.floor(Math.random() * n);\n\nfunction sameItem(a: Item | null, b: Item | null): boolean {\n  if (a === b) return true;\n  if (!a || !b) return false;\n  return a.group === b.group && a.num === b.num;\n}\n\n/** What an owner currently has an actor for in one slot, and where. */\ntype Spawned = { item: Item; map: number };\n\n/**\n * A slot has to be rebuilt when the item changed, and when its actor was left\n * behind on another map: `unloadMap` sweeps the actors of the map just left,\n * and one spawned in the gap before the hero is moved sits on his old tile.\n */\nfunction stale(current: Spawned | undefined, item: Item | null, map: number) {\n  if (!sameItem(current?.item ?? null, item)) return true;\n  return current !== undefined && current.map !== map;\n}\n\nfunction ravenOf(item: Item | null | undefined): Item | null {\n  return item && item.group === PET_GROUP && item.num === DARK_RAVEN\n    ? item\n    : null;\n}\n\nexport const PetSystem: ISystemFactory = world => {\n  const owners = world.with('charAppearance', 'transform', 'visibility');\n  const actors = world.with('petActor', 'transform');\n  /** `Items[]`: what a collector pet looks through for a pile of zen. */\n  const drops = world.with('droppedItem', 'transform');\n\n  /** The pet each owner currently has an actor for, per slot. */\n  const spawned = new Map<Entity, Spawned>();\n  const spawnedRaven = new Map<Entity, Spawned>();\n  const spawnedSabio = new Map<Entity, Spawned>();\n  const SABIO_NUMS = new Set([0, 65, 80, 64]);\n  /** Dark Horses whose action-3 blur is running. */\n  const horseBlurs = new WeakSet<Entity>();\n\n  function despawn(owner: Entity, raven: boolean) {\n    (raven ? spawnedRaven : spawned).delete(owner);\n\n    for (const actor of [...actors.entities]) {\n      if (actor.petActor.owner !== owner) continue;\n      if ((actor.petActor.kind === 'raven') !== raven) continue;\n      if ((actor.petActor as any).sabio) continue;\n      world.remove(actor);\n      actor.modelObject?.dispose();\n    }\n  }\n\n  function despawnSabio(owner: Entity) {\n    spawnedSabio.delete(owner);\n    for (const actor of [...actors.entities]) {\n      if (actor.petActor.owner !== owner) continue;\n      if ((actor.petActor as any).sabio) {\n        world.remove(actor);\n        actor.modelObject?.dispose();\n      }\n    }\n  }\n\n  owners.onEntityRemoved.subscribe(owner => {\n    despawn(owner, false);\n    despawn(owner, true);\n    despawnSabio(owner);\n  });\n\n  // A warp removes every entity of the map just left (`unloadMap`), the pet\n  // actors among them. Without this the slot still reads as filled on the new\n  // map and the pet only comes back on a re-equip.\n  actors.onEntityRemoved.subscribe(actor => {\n    glowClocks.delete(actor);\n    ravenShoutIn.delete(actor);\n    const state = actor.petActor;\n    if ((state as any).sabio) spawnedSabio.delete(state.owner);\n    else (state.kind === 'raven' ? spawnedRaven : spawned).delete(state.owner);\n  });\n\n  function spawn(owner: Entity, item: Item, spec: PetSpec, asSabio = false) {\n    const pos = owner.transform!.pos;\n    const offset = owner.transform!.posOffset;\n    const map = owner.worldIndex ?? world.mapIndex;\n\n    // CreateMountSub seeds the angel a couple of tiles away and above its\n    // owner; a mount starts exactly on him (GOBoid.cpp:114-125). The raven\n    // starts 300 units straight up (CSPetSystem.cpp:299).\n    const angel = spec.kind === 'angel';\n    const raven = spec.kind === 'raven';\n    const follower = spec.kind === 'follower';\n\n    world.add({\n      worldIndex: map,\n      transform: {\n        pos: new Vector3(\n          pos.x + (angel ? (rand(512) - 256) * MU_UNIT : 0),\n          pos.y +\n            (angel ? (rand(128) + 128) * MU_UNIT : 0) +\n            (raven ? RAVEN_SPAWN_HEIGHT * MU_UNIT : 0),\n          pos.z +\n            (angel ? (rand(512) - 256) * MU_UNIT : 0) +\n            (spec.spawnOffset ?? 0) * MU_UNIT * (owner.transform!.scale ?? 1)\n        ),\n        rot: new Vector3(0, owner.transform!.rot.y, 0),\n        scale: spec.scale,\n        // The owner half-tile render offset, not a fixed one: the character\n        // select line-up stands its characters on exact coordinates with no\n        // offset, and a mount keeping its own put the rider off the saddle.\n        posOffset: offset ? new Vector3(offset.x, offset.y, offset.z) : undefined,\n      },\n      modelFactory: petFactoryFor(spec),\n      visibility: { state: 'hidden', lastChecked: 0 },\n      petActor: Object.assign({\n        owner,\n        kind: angel\n          ? 'angel'\n          : raven\n            ? 'raven'\n            : follower\n              ? 'follower'\n              : 'mount',\n        yaw: owner.transform!.rot.y,\n        dir: { x: 0, y: 0, z: 0 },\n        reroll: 0,\n        flyRange: (spec.flyRange ?? 0) * MU_UNIT,\n        drop: spec.mountDrop ?? 0,\n        standAction: spec.standAction ?? MOUNT_ACTION_STAND,\n        moveAction: spec.moveAction ?? MOUNT_ACTION_MOVE,\n        fenrirThunder: spec.thunder,\n        fenrirFoot: spec.footSubType,\n        fenrirSpec: spec.shineMesh === undefined ? undefined : spec,\n        follow: spec.follow,\n        followSpeed: spec.playSpeed,\n        pulseSeconds: spec.pulseSeconds,\n        clock: 0,\n      }, asSabio ? { sabio: true } : {}),\n    });\n\n    (asSabio ? spawnedSabio : raven ? spawnedRaven : spawned).set(owner, { item, map });\n  }\n\n  function updateAngel(actor: Entity, dt: number) {\n    const state = actor.petActor!;\n    const pos = actor.transform!.pos;\n    const target = state.owner.transform?.pos;\n    if (!target) return;\n\n    const ticks = dt * TICKS_PER_SECOND;\n\n    const dx = target.x - pos.x;\n    const dz = target.z - pos.z;\n    const distance2 = dx * dx + dz * dz;\n\n    // Not the original's - the angel is the one pet GOBoid gives no failsafe,\n    // because over there it is created with its owner already standing where\n    // he belongs. Here the hero holds a placeholder tile for the second or\n    // so a map takes to load, and an angel seeded on it was left a hundred\n    // tiles out, flying home at walking pace while its owner stood pet-less.\n    const snap = ANGEL_SNAP_DISTANCE * MU_UNIT;\n    if (distance2 > snap * snap) {\n      pos.x = target.x;\n      pos.z = target.z;\n      pos.y = target.y + ANGEL_MIN_HEIGHT * MU_UNIT;\n      return;\n    }\n\n    const far = distance2 >= state.flyRange * state.flyRange;\n\n    if (far) {\n      const heading = createAngleDeg(pos.x, pos.z, target.x, target.z) * DEG;\n      state.yaw = turnAngle(\n        state.yaw,\n        heading,\n        TURN_DEGREES_PER_TICK * DEG * ticks\n      );\n    }\n\n    // rand_fps_check(32): a fresh heading and speed roughly every 32 ticks.\n    state.reroll -= ticks;\n    if (state.reroll <= 0) {\n      state.reroll = REROLL_TICKS;\n\n      // Forward is -Y in the original's object space, so the speed is negative.\n      const speed = far ? -(rand(64) + 128) * 0.1 : -(rand(64) + 16) * 0.1;\n\n      if (!far) state.yaw = rand(360) * DEG;\n\n      state.dir.y = speed;\n      state.dir.z = (rand(64) - 32) * 0.1;\n    }\n\n    // Height band, applied to the direction rather than to the position.\n    const height = (pos.y - target.y) / MU_UNIT;\n    if (height < ANGEL_MIN_HEIGHT) state.dir.z += ANGEL_HEIGHT_NUDGE * ticks;\n    if (height > ANGEL_MAX_HEIGHT) state.dir.z -= ANGEL_HEIGHT_NUDGE * ticks;\n\n    // VectorRotate((0, speed, dz), AngleMatrix(0, 0, yaw)) with a negative\n    // speed points along the facing direction.\n    const step = state.dir.y * MU_UNIT * ticks;\n    pos.x += -Math.sin(state.yaw) * step;\n    pos.z += Math.cos(state.yaw) * step;\n    pos.y += state.dir.z * MU_UNIT * ticks;\n    // o->Position[2] += rand() % 16 - 8: a flutter on top of the drift.\n    pos.y += (rand(16) - 8) * MU_UNIT * ticks;\n\n    actor.transform!.rot.y = state.yaw;\n\n    actor.modelObject?.setAnimationSpeed(ANGEL_PLAY_SPEED);\n    actor.modelObject?.playAction(MOUNT_ACTION_STAND, true);\n  }\n\n  /**\n   * `CSPetDarkSpirit::MovePet`, PET_FLY / PET_FLYING (CSPetSystem.cpp:420-505):\n   * the same boid drift as the angel, but 250 units over the owner (350 when\n   * he rides a Dark Horse), dashing home once it drifts past FlyRange. The\n   * original steers height through the pitch angle; the angel's direction\n   * nudge stands in for it.\n   */\n  function updateRaven(actor: Entity, dt: number) {\n    const state = actor.petActor!;\n    const pos = actor.transform!.pos;\n    const owner = state.owner;\n    const target = owner.transform?.pos;\n    if (!target) return;\n\n    const ticks = dt * TICKS_PER_SECOND;\n\n    const dx = target.x - pos.x;\n    const dz = target.z - pos.z;\n    const distance2 = dx * dx + dz * dz;\n    const far = distance2 >= state.flyRange * state.flyRange;\n\n    // The far failsafe (:598-608): way off or far below, snap back home.\n    const snap = RAVEN_SNAP_DISTANCE * MU_UNIT;\n    if (distance2 > snap * snap || pos.y < target.y - 2) {\n      pos.x = target.x;\n      pos.z = target.z;\n      pos.y = target.y + RAVEN_SPAWN_HEIGHT * MU_UNIT;\n    }\n\n    if (far) {\n      // TurnAngle2(..., RangeFloat(0,14) + 5): 5..19 degrees per tick.\n      const heading = createAngleDeg(pos.x, pos.z, target.x, target.z) * DEG;\n      state.yaw = turnAngle(state.yaw, heading, (rand(15) + 5) * DEG * ticks);\n    }\n\n    state.reroll -= ticks;\n    if (state.reroll <= 0) {\n      state.reroll = REROLL_TICKS;\n\n      // Far: a dash back (128..191); near: a lazy circle (32..39) on a\n      // rerolled heading. Speeds are negative - forward is -Y (see the angel).\n      const speed = far ? -(rand(64) + 128) * 0.1 : -(rand(8) + 32) * 0.1;\n      if (!far) state.yaw += rand(60) * DEG;\n\n      state.dir.y = (speed + state.dir.y) / 2;\n      state.dir.z = (rand(64) - 32) * 0.1;\n    }\n\n    const ridesHorse =\n      owner.charAppearance?.pet?.group === PET_GROUP &&\n      owner.charAppearance.pet.num === DARK_HORSE;\n    const wanted = ridesHorse ? RAVEN_HEIGHT_HORSE : RAVEN_HEIGHT;\n    const height = (pos.y - target.y) / MU_UNIT;\n    if (height < wanted) state.dir.z += RAVEN_HEIGHT_NUDGE * ticks;\n    if (height > wanted + 100) state.dir.z -= RAVEN_HEIGHT_NUDGE * ticks;\n\n    const step = state.dir.y * MU_UNIT * ticks;\n    pos.x += -Math.sin(state.yaw) * step;\n    pos.z += Math.cos(state.yaw) * step;\n    pos.y += state.dir.z * MU_UNIT * ticks;\n\n    actor.transform!.rot.y = state.yaw;\n\n    actor.modelObject?.setAnimationSpeed(RAVEN_PLAY_SPEED);\n    // `Direction[1] < -12` flips PET_FLY (glide) into PET_FLYING (flap).\n    actor.modelObject?.playAction(\n      state.dir.y < -12 ? RAVEN_ACTION_FLYING : RAVEN_ACTION_FLY,\n      true\n    );\n  }\n\n  /** Seconds until each raven's next shout. */\n  const ravenShoutIn = new Map<Entity, number>();\n\n  function ravenShout(actor: Entity, dt: number) {\n    const left = (ravenShoutIn.get(actor) ?? nextRavenShout()) - dt;\n    if (left > 0) {\n      ravenShoutIn.set(actor, left);\n      return;\n    }\n    ravenShoutIn.set(actor, nextRavenShout());\n    playSfx('Sound/DSpirit_Shout', actor.transform!.pos, { bus: 'combat', channels: 1 });\n  }\n\n  /** PET_STAND (:556-562): perched beside the shoulder, facing 120\u00b0 off. */\n  function perchRaven(actor: Entity) {\n    const state = actor.petActor!;\n    const target = state.owner.transform?.pos;\n    if (!target) return;\n\n    const yaw = state.owner.transform!.rot.y;\n    const pos = actor.transform!.pos;\n    pos.x = target.x + Math.cos(yaw) * RAVEN_PERCH_SIDE;\n    pos.z = target.z + Math.sin(yaw) * RAVEN_PERCH_SIDE;\n    pos.y = target.y + RAVEN_PERCH_UP;\n\n    state.yaw = yaw + RAVEN_PERCH_YAW;\n    actor.transform!.rot.y = state.yaw;\n\n    actor.modelObject?.setAnimationSpeed(RAVEN_PLAY_SPEED);\n    actor.modelObject?.playAction(RAVEN_ACTION_STAND, true);\n  }\n\n  /**\n   * A follower pet: `PetObject::UpdateMove` through whichever `PetAction` its\n   * `Data/Local/pet.bmd` record names (w_PetActionStand / _Demon / _Collecter\n   * / _Collecter_Add / _Unicorn). The three motions are described on\n   * `PetFollow`; what they share is this step - stand off the owner at a\n   * fixed height, turn towards a target point, and crawl towards it at a\n   * speed that is the log of how far away it is.\n   *\n   * None of them has a safe-zone branch and none of them plays more than its\n   * clip 0: `Model()` returns false for every one of the six, so `SetAction`\n   * is never called and `CurrentAction` stays where `Create` left it.\n   */\n  /**\n   * `FindZen` (w_PetActionCollecter.cpp:297-330): the first zen pile lying\n   * within `SEARCH_LENGTH` of the *owner* - not of the pet. The original\n   * walks its whole `Items[]` array and takes the last match; taking the\n   * first is the same pile in every case that matters and stops the walk\n   * early.\n   */\n  function findZen(owner: Entity): Entity | null {\n    const at = owner.transform?.pos;\n    if (!at) return null;\n\n    const reach = SEARCH_LENGTH * MU_UNIT;\n    for (const drop of drops) {\n      if (!drop.droppedItem.isMoney) continue;\n      if (drop.netId === undefined || drop.objOutOfScope) continue;\n      if (drop.worldIndex !== world.mapIndex) continue;\n\n      const dx = drop.transform.pos.x - at.x;\n      const dz = drop.transform.pos.z - at.z;\n      if (dx * dx + dz * dz < reach * reach) return drop;\n    }\n\n    return null;\n  }\n\n  /** Still on the ground, still in scope, still on this map. */\n  function dropAlive(drop: Entity | null): drop is Entity {\n    return (\n      !!drop &&\n      !!drop.droppedItem &&\n      !!drop.transform &&\n      drop.netId !== undefined &&\n      !drop.objOutOfScope &&\n      drop.worldIndex === world.mapIndex &&\n      world.has(drop)\n    );\n  }\n\n  /**\n   * `PetActionCollecter::Move`'s state machine, which decides only *what* the\n   * pet is walking towards: the four states hand back a target and the speed\n   * to close on it, and the step itself is the same one the standing pet\n   * takes. Returns null while the pet has no errand.\n   */\n  function errand(\n    actor: Entity,\n    state: NonNullable<Entity['petActor']>,\n    follow: PetFollow,\n    owner: Entity,\n    circleX: number,\n    circleZ: number,\n    dt: number\n  ): Chase | null {\n    const collect = (state.collect ??= {\n      state: 'stand',\n      target: null,\n      x: 0,\n      z: 0,\n      since: 0,\n      sent: 0,\n    });\n\n    collect.since += dt;\n    collect.sent += dt;\n\n    if (collect.state === 'stand') {\n      const found = findZen(owner);\n      if (!found) return null;\n      collect.target = found;\n      collect.x = found.transform!.pos.x;\n      collect.z = found.transform!.pos.z;\n      collect.state = 'move';\n      collect.since = 0;\n    }\n\n    const pos = actor.transform!.pos;\n    const away = Math.hypot(\n      (collect.x - pos.x) / MU_UNIT,\n      (collect.z - pos.z) / MU_UNIT\n    );\n\n    switch (collect.state) {\n      case 'move': {\n        if (!dropAlive(collect.target)) {\n          collect.state = 'return';\n          collect.since = 0;\n          break;\n        }\n        // Circling the pile as it comes in, twice as fast as it circles its\n        // owner (`m_fRadWidthGet`).\n        const phase =\n          (((state.clock ?? 0) % GET_MS) / GET_MS) * Math.PI * 2;\n        const x = collect.x + Math.sin(phase) * CIRCLE_STAND * MU_UNIT;\n        const z = collect.z + Math.cos(phase) * CIRCLE_STAND * MU_UNIT;\n\n        // `0 == Speed`: the distance that decides is to the point on the\n        // circle it is chasing, not to the pile in the middle of it.\n        const reach = Math.hypot((x - pos.x) / MU_UNIT, (z - pos.z) / MU_UNIT);\n        if (reach <= GET_STOP) {\n          collect.state = 'get';\n          collect.since = 0;\n          collect.sent = PICKUP_GAP;\n          break;\n        }\n\n        return {\n          x,\n          z,\n          stopAt: GET_STOP,\n          turn: ERRAND_TURN,\n          speedScale: ERRAND_SPEED,\n        };\n      }\n      case 'get': {\n        const gone =\n          !dropAlive(collect.target) ||\n          away > SEARCH_LENGTH ||\n          collect.since > ERRAND_PATIENCE;\n        if (gone) {\n          collect.target = null;\n          collect.state = 'return';\n          collect.since = 0;\n          // `PlayBuffer(SOUND_DROP_GOLD01)` on the way home. The original\n          // plays it every frame of the state; once is what it meant.\n          if (owner.localPlayer) playUiSound('dropMoney');\n          break;\n        }\n\n        // Only the hero's own pet asks for the pile: the others are somebody\n        // else's client's business (`&Hero->Object == obj->Owner`).\n        if (owner.localPlayer && collect.sent >= PICKUP_GAP) {\n          collect.sent = 0;\n          if (!world.pickupTarget) {\n            Drops.pickupItemRequest(collect.target!.netId!);\n          }\n        }\n\n        return {\n          x: collect.x,\n          z: collect.z,\n          stopAt: 0,\n          turn: GET_TURN,\n          speedScale: ERRAND_SPEED,\n        };\n      }\n      case 'return':\n        break;\n    }\n\n    // Back to the circle it walks around its owner, at the errand's pace.\n    // It is home once it is inside `FlyRange` of that point, or once its\n    // patience runs out wherever it has got to.\n    const home = Math.hypot(\n      (circleX - pos.x) / MU_UNIT,\n      (circleZ - pos.z) / MU_UNIT\n    );\n    if (home <= follow.flyRange || collect.since > ERRAND_PATIENCE) {\n      collect.state = 'stand';\n      collect.since = 0;\n      return null;\n    }\n\n    return {\n      x: circleX,\n      z: circleZ,\n      stopAt: follow.flyRange,\n      turn: ERRAND_TURN,\n      speedScale: ERRAND_SPEED,\n    };\n  }\n\n  function updateFollower(actor: Entity, dt: number) {\n    const state = actor.petActor!;\n    const follow = state.follow;\n    const owner = state.owner.transform;\n    if (!follow || !owner) return;\n\n    const ticks = dt * TICKS_PER_SECOND;\n    const clock = (state.clock = (state.clock ?? 0) + dt * 1000);\n    const pos = actor.transform!.pos;\n\n    // `obj->Position[2] = obj->Owner->Position[2] + n`, the one axis the pet\n    // never steers for itself.\n    pos.y =\n      owner.pos.y +\n      follow.hover * MU_UNIT * (follow.hoverScaled ? owner.scale : 1);\n\n    // The point that circles the owner once every four seconds: what an\n    // orbiting pet chases, and where any of the four ground-level ones is\n    // put back down when it falls too far behind.\n    const phase = ((clock % ORBIT_MS) / ORBIT_MS) * Math.PI * 2;\n    const circleX = owner.pos.x + Math.sin(phase) * CIRCLE_STAND * MU_UNIT;\n    const circleZ = owner.pos.z + Math.cos(phase) * CIRCLE_STAND * MU_UNIT;\n\n    const orbit = follow.motion === 'orbit';\n    const hover = follow.motion === 'hover';\n\n    // An errand overrides where the pet is headed, how close it gets and how\n    // fast it turns; everything below is the same step either way.\n    const chase = follow.collects\n      ? errand(actor, state, follow, state.owner, circleX, circleZ, dt)\n      : null;\n\n    const targetX = chase?.x ?? (orbit ? circleX : owner.pos.x);\n    const targetZ = chase?.z ?? (orbit ? circleZ : owner.pos.z);\n    const stopAt = chase?.stopAt ?? follow.stopAt;\n    const turn = chase?.turn ?? follow.turn;\n    const speedScale = chase?.speedScale ?? follow.speedScale;\n\n    // Left too far behind - a warp, or a long stretch out of scope.\n    const homeX = (pos.x - owner.pos.x) / MU_UNIT;\n    const homeZ = (pos.z - owner.pos.z) / MU_UNIT;\n    const home2 = homeX * homeX + homeZ * homeZ;\n    if (home2 > (hover ? HOVER_SNAP * HOVER_SNAP : SNAP_HOME * SNAP_HOME)) {\n      // The hover pair lands on the owner; the rest on the circle, which is\n      // what keeps a pet that aims at his own tile from sitting inside him.\n      pos.x = hover ? owner.pos.x : circleX;\n      pos.z = hover ? owner.pos.z : circleZ;\n      state.yaw = owner.rot.y;\n    }\n\n    const dx = (targetX - pos.x) / MU_UNIT;\n    const dz = (targetZ - pos.z) / MU_UNIT;\n    // The hover pair never takes the root of it - see `PetFollow`.\n    const distance2 = dx * dx + dz * dz;\n    const distance = hover ? distance2 : Math.sqrt(distance2);\n\n    // `if (80.0f >= FlyRange)`: true for every one of them, so the orbit and\n    // trail pets turn on every tick and only the hover pair holds a heading\n    // until it is a stop radius out.\n    if (!hover || distance2 >= stopAt) {\n      const heading = createAngleDeg(pos.x, pos.z, targetX, targetZ) * DEG;\n      state.yaw = turnAngle(state.yaw, heading, turn * DEG * ticks);\n    }\n\n    // The original applies the direction it worked out last frame and only\n    // then computes this frame's - keep the order, it is what lets a pet\n    // overshoot its target by a step and turn back.\n    const step = state.dir.y * MU_UNIT * ticks;\n    pos.x += -Math.sin(state.yaw) * step;\n    pos.z += Math.cos(state.yaw) * step;\n    actor.transform!.rot.y = state.yaw;\n\n    const speed =\n      stopAt >= distance\n        ? 0\n        : Math.log(distance) * speedScale + (follow.speedBias ?? 0);\n    // Forward is -Y in the original's object space.\n    state.dir.y = -speed;\n\n    // `PetActionDemon::Model`: the body light breathes over ten seconds.\n    if (state.pulseSeconds !== undefined) {\n      const period = state.pulseSeconds * 1000;\n      actor.modelObject?.SelfLight.setAll(\n        Math.sin((Math.PI * (clock % period)) / period)\n      );\n    }\n\n    const play = state.followSpeed ?? 1;\n    const factor =\n      speed === 0 ? (follow.idleSpeed ?? 1) : (follow.moveSpeed ?? 1);\n    actor.modelObject?.setAnimationSpeed(play * factor);\n    actor.modelObject?.playAction(FOLLOWER_ACTION, true);\n  }\n\n  /** Per-actor clock for the Fenrir glow spawns. */\n  const glowClocks = new Map<Entity, number>();\n\n  const tmpGlow = new Vector3();\n  const tmpFoot = new Vector3();\n\n  /**\n   * One body bolt: `CreateEffect(MODEL_FENRIR_THUNDER, o->Position, \u2026, 0, o)`\n   * plus the `BITMAP_LIGHT` sprite the original hangs on every one of them\n   * (ZzzEffect.cpp:4249-4312). The flash lasts about a sixth of a second -\n   * alpha 0.7 up to 1 and back down at 0.3 a tick (MoveHandlers.cpp:6645-6675).\n   */\n  function spawnFenrirBolt(\n    actor: Entity,\n    colour: readonly [number, number, number]\n  ) {\n    const scene = world.scene;\n    if (!scene) return;\n\n    const roll = FENRIR_BOLT_BONES[rand(30)] ?? null;\n    if (roll === DEAD_ROLL) return;\n\n    let scale = 0.3 + Math.random() * 0.2;\n\n    if (roll === null) {\n      // The wolf's own position, thrown wide and lifted: \u00b1120 / \u00b15 / +110.\n      entityPos(actor, 0, tmpGlow);\n      tmpGlow.x += (rand(240) - 120) * MU_UNIT;\n      tmpGlow.z += (rand(10) - 5) * MU_UNIT;\n      tmpGlow.y += 110 * MU_UNIT;\n      scale += 0.1;\n    } else {\n      bonePos(actor, roll, tmpGlow, 0.6);\n      scale -= 0.2;\n    }\n\n    effects.spawn('model', scene, tmpGlow, {\n      model: MODEL.lightningType,\n      colour,\n      seconds: 0.18,\n      scale: Math.max(0.1, scale),\n      yaw: Math.random() * Math.PI * 2,\n      alpha: 0.9,\n      fadeIn: 0.25,\n      fadeTail: 0.7,\n    });\n\n    // `CreateSprite(BITMAP_LIGHT, o->Position, 2.0f, Light \u2212 0.3)`: the halo\n    // that makes a bolt read as light rather than as a lit wireframe.\n    effects.spawn('sprite', scene, tmpGlow, {\n      texture: TEX.flare,\n      colour: [\n        Math.max(0, colour[0] - 0.3),\n        Math.max(0, colour[1] - 0.3),\n        Math.max(0, colour[2] - 0.3),\n      ],\n      size: 0.7,\n      seconds: 0.18,\n      fadeTail: 0.7,\n    });\n  }\n\n  /**\n   * The splash one paw leaves: `RenderTerrainAlphaBitmap(BITMAP_FENRIR_FOOT_\n   * THUNDER1 + (m_iAnimation % 5), \u2026)`, a frame every 200 ms while the object\n   * fades and its light drains to the variant's colour (ZzzEffect.cpp:9058,\n   * MoveHandlers.cpp:6780-6810). Four frames is where the alpha reaches zero.\n   */\n  function spawnFootThunder(at: Vector3, subType: number) {\n    const drain = FOOT_THUNDER_DRAIN[subType] ?? [0, 0, 0];\n    const x = at.x;\n    const z = at.z;\n\n    for (let i = 0; i < FOOT_THUNDER_FRAMES_SHOWN; i++) {\n      const fade = 1 - i / FOOT_THUNDER_FRAMES_SHOWN;\n      // The art is a JPG with a black ground, so it is drawn additive and\n      // the fading alpha rides the colour rather than a blend factor.\n      const colour: [number, number, number] = [\n        fade * (1 - drain[0] * (1 - fade)),\n        fade * (1 - drain[1] * (1 - fade)),\n        fade * (1 - drain[2] * (1 - fade)),\n      ];\n      const draw = () => {\n        const live = world.scene;\n        if (!live) return;\n        tmpFoot.set(x, 0, z);\n        effects.spawn('ring', live, tmpFoot, {\n          texture: FOOT_THUNDER_FRAMES[i],\n          colour,\n          scale: FOOT_THUNDER_TILES,\n          seconds: FOOT_THUNDER_FRAME_SECONDS,\n          fadeTail: 0.25,\n        });\n      };\n      if (i === 0) draw();\n      else delay(i * FOOT_THUNDER_FRAME_SECONDS, draw);\n    }\n  }\n\n  /**\n   * `MODEL_FENRIR_FOOT_THUNDER` (ZzzObject.cpp:900-940): lightning under the\n   * paws on the frames they touch down - all four across the first keys of\n   * the walk, the front and back pairs apart on the run.\n   */\n  function updateFootThunder(actor: Entity) {\n    const state = actor.petActor!;\n    const model = actor.modelObject;\n    if (!model?.gltf || state.fenrirFoot === undefined) return;\n\n    const action = model.CurrentAction;\n    const frame = model.actionFrame();\n    const prev = state.fenrirFrame ?? -1;\n    state.fenrirFrame = frame;\n\n    let paws: readonly number[] | null = null;\n\n    if (action === FENRIR_ACTION_WALK) {\n      if (inWindow(prev, frame, 0, 1.5)) paws = FENRIR_PAW_BONES;\n    } else if (action === FENRIR_ACTION_RUN) {\n      if (inWindow(prev, frame, 1, 1.4)) paws = FENRIR_FRONT_PAWS;\n      else if (inWindow(prev, frame, 4.8, 5.2)) paws = FENRIR_BACK_PAWS;\n    }\n\n    if (!paws) return;\n\n    for (const bone of paws) {\n      bonePos(actor, bone, tmpGlow, 0);\n      spawnFootThunder(tmpGlow, state.fenrirFoot);\n    }\n  }\n\n  /**\n   * The per-frame eye / jaw sprites and the variant-coloured body lightning\n   * of the original's Fenrir render branch (ZzzObject.cpp:793-940), as\n   * periodic effect spawns. Not called in a safe zone - the mount is faded\n   * out there and the original skips the branch with it.\n   */\n  function updateFenrirGlow(actor: Entity, dt: number) {\n    const state = actor.petActor!;\n\n    // Read every frame: a footfall window is a fifth of a clip and the glow\n    // tick would step straight over it.\n    updateFootThunder(actor);\n\n    const clock = (glowClocks.get(actor) ?? 0) + dt;\n    if (clock < FENRIR_GLOW_TICK) {\n      glowClocks.set(actor, clock);\n      return;\n    }\n    glowClocks.set(actor, clock % FENRIR_GLOW_TICK);\n\n    const scene = world.scene;\n    if (!scene || !actor.modelObject?.gltf) return;\n\n    // `sinf(WorldTime * 0.002f) * 0.2f` on a clock in milliseconds: the eyes\n    // breathe rather than sitting on one red.\n    const lum = Math.sin(fxNow() * 2) * 0.2;\n\n    for (const local of FENRIR_EYE_LOCALS) {\n      boneLocalPos(actor, FENRIR_HEAD_BONE, local, tmpGlow);\n      effects.spawn('sprite', scene, tmpGlow, {\n        texture: TEX.flare,\n        colour: [\n          FENRIR_EYE_RGB[0] + lum,\n          FENRIR_EYE_RGB[1] + lum * 0.5,\n          FENRIR_EYE_RGB[2] + lum * 0.5,\n        ],\n        size: 0.35 + lum * 0.07,\n        seconds: 0.16,\n        fadeTail: 0.6,\n      });\n    }\n\n    // Two cards on the jaw, a small one inside a big one.\n    boneLocalPos(actor, FENRIR_JAW_BONE, FENRIR_JAW_LOCAL, tmpGlow);\n    for (const size of FENRIR_JAW_SIZES) {\n      effects.spawn('sprite', scene, tmpGlow, {\n        texture: TEX.flare,\n        colour: FENRIR_JAW_RGB,\n        size,\n        seconds: 0.16,\n        fadeTail: 0.6,\n      });\n    }\n\n    if (!othersShedFully(state.owner, performance.now())) {\n      for (let i = 0; i < FENRIR_BOLTS_PER_TICK; i++) spawnFenrirBolt(actor, state.fenrirThunder!);\n    }\n\n    // The skill clip: the body pass is drawn a second time and a red chip\n    // flies off the jaw (ZzzObject.cpp:812-840). The shine object is the one\n    // the material binds every frame, so raising it is that second pass; it\n    // is re-read here rather than at spawn so the Item effects option takes\n    // hold the moment it is changed.\n    const casting = actor.modelObject.CurrentAction === FENRIR_ACTION_SKILL;\n    if (state.fenrirSpec) {\n      fenrirShine(actor.modelObject, state.fenrirSpec, casting);\n    }\n\n    if (casting) {\n      tmpFoot.set(\n        (rand(10) - 10) * 0.5 * MU_UNIT,\n        0,\n        (rand(40) - 20) * 0.5 * MU_UNIT\n      );\n      boneLocalPos(actor, FENRIR_SKILL_BONE, tmpFoot, tmpGlow);\n      effects.spawn('sprite', scene, tmpGlow, {\n        texture: TEX.spark3,\n        colour: [1, 0, 0],\n        size: 0.7 + lum * 0.05,\n        seconds: 0.3,\n        rise: 0.6,\n        fadeTail: 0.5,\n      });\n    }\n  }\n\n  function updateMount(actor: Entity, dt: number, inSafeZone: boolean) {\n    const state = actor.petActor!;\n    const target = state.owner.transform?.pos;\n    if (!target) return;\n\n    const pos = actor.transform!.pos;\n    pos.x = target.x;\n    pos.y = target.y - state.drop;\n    pos.z = target.z;\n    actor.transform!.rot.y = state.owner.transform!.rot.y;\n\n    // Faded out in town: pinned, but no clip and no Fenrir glow behind it.\n    if (inSafeZone) return;\n\n    // A Fenrir mirrors its rider's clip family instead of the stand/move\n    // pair, at the per-clip velocities of MoveMount.\n    if (state.fenrirThunder) {\n      const rider = state.owner.modelObject?.CurrentAction ?? -1;\n      const mirrored = fenrirMountAction(rider);\n      actor.modelObject?.setAnimationSpeed(mirrored.playSpeed);\n      actor.modelObject?.playAction(mirrored.action, true);\n      updateFenrirGlow(actor, dt);\n      return;\n    }\n\n    // The Dark Horse rears on its action 3 under Earthshake (GOBoid.cpp:337-341).\n    const pet = state.owner.charAppearance?.pet;\n    if (\n      pet?.group === PET_GROUP &&\n      pet.num === DARK_HORSE &&\n      state.owner.modelObject?.CurrentAction === PlayerAction.PLAYER_ATTACK_DARKHORSE\n    ) {\n      actor.modelObject?.setAnimationSpeed(MOUNT_PLAY_SPEED);\n      actor.modelObject?.playAction(DARK_HORSE_ACTION_SKILL, true);\n      if (actor.modelObject?.CurrentAction === DARK_HORSE_ACTION_SKILL && !horseBlurs.has(actor)) {\n        horseBlurs.add(actor);\n        // The white blur from (60, 0, 0) to bone 9, every frame of action 3 (GOBoid.cpp:452-461).\n        effects.spawn('blur', world.scene, HORSE_BLUR_ROOT, {\n          follow: out => boneLocalPos(actor, 9, HORSE_BLUR_TIP, out),\n          base: out => boneLocalPos(actor, 9, HORSE_BLUR_ROOT, out),\n          texture: TEX.blur,\n          colour: RGBS.white,\n          seconds: HORSE_BLUR_MAX,\n          until: () => {\n            const on = !entityGone(actor) && actor.modelObject?.CurrentAction === DARK_HORSE_ACTION_SKILL;\n            if (!on) horseBlurs.delete(actor);\n            return !on;\n          },\n        });\n      }\n      return;\n    }\n\n    const velocity = state.owner.movement?.velocity;\n    const moving = !!velocity && (velocity.x !== 0 || velocity.y !== 0);\n\n    actor.modelObject?.setAnimationSpeed(MOUNT_PLAY_SPEED);\n\n    // Fire Breath: the mount breathes with its rider, clip 7 in the fly worlds and 6 elsewhere\n    // (GOBoid.cpp:559-564). SetAction skips a clip the model lacks, so the Uniria stays as it is.\n    const rider = state.owner.modelObject?.CurrentAction;\n    if (rider === PlayerAction.PLAYER_SKILL_RIDER || rider === PlayerAction.PLAYER_SKILL_RIDER_FLY) {\n      const breath = RIDER_FLY_WORLDS.has(world.mapIndex) ? MOUNT_ACTION_BREATH_FLY : MOUNT_ACTION_BREATH;\n      if (actor.modelObject?.gltf?.animationGroups[breath]) {\n        actor.modelObject.playAction(breath, true);\n        return;\n      }\n    }\n    actor.modelObject?.playAction(\n      moving ? state.moveAction : state.standAction,\n      true\n    );\n  }\n\n  return {\n    update: dt => {\n      const chaosCastle = inChaosCastle(world.mapIndex);\n\n      for (const owner of owners) {\n        const map = owner.worldIndex ?? world.mapIndex;\n        const wanted = chaosCastle ? null : owner.charAppearance.pet;\n        const spec = petSpec(wanted);\n        // The Imp is not a world object - PlayerObject.Pet carries it.\n        const wantsActor = spec && spec.kind !== 'imp' && petShown(owner, spec.kind) ? wanted : null;\n\n        if (stale(spawned.get(owner), wantsActor, map)) {\n          despawn(owner, false);\n          if (wantsActor && spec) spawn(owner, wantsActor, spec);\n        }\n\n        // The raven rides inventory slot 1 (the shield hand, `rightHand`\n        // here), beside whatever the pet slot holds.\n        const raven = chaosCastle || !petShown(owner, 'raven')\n          ? null\n          : ravenOf(owner.charAppearance.rightHand);\n        if (stale(spawnedRaven.get(owner), raven, map)) {\n          despawn(owner, true);\n          const ravenSpec = petSpec(raven);\n          if (raven && ravenSpec) spawn(owner, raven, ravenSpec);\n        }\n\n        // BarrioMU: el Sabio acompa\u00f1a en su propio espacio (inventario) y se ve activo,\n        // incluso si la ranura de mascota lleva otra mascota/montura.\n        const sabioItem = !chaosCastle && owner.localPlayer\n          ? (Hero.items.find((it, idx) =>\n              !!it && idx !== InventoryConstants.PetSlot &&\n              it.group === 13 && SABIO_NUMS.has(it.num)) ?? null)\n          : null;\n        const sabioSpec = sabioItem ? petSpec(sabioItem) : null;\n        const wantsSabio = sabioItem && sabioSpec && sabioSpec.kind !== 'imp' ? sabioItem : null;\n        if (stale(spawnedSabio.get(owner), wantsSabio, map)) {\n          despawnSabio(owner);\n          if (wantsSabio && sabioSpec) spawn(owner, wantsSabio, sabioSpec, true);\n        }\n      }\n\n      for (const actor of actors) {\n        const state = actor.petActor;\n\n        const inSafeZone =\n          state.owner.attributeSystem?.isAboveZero('inSafeZone') ?? false;\n\n        // The raven stays visible in town: it perches instead of fading.\n        if (state.kind === 'raven') {\n          actor.modelObject?.setAlpha(1);\n          if (inSafeZone) perchRaven(actor);\n          else updateRaven(actor, dt);\n          ravenShout(actor, dt);\n          continue;\n        }\n\n        // The angel has no safe-zone branch of its own: it keeps flying, and\n        // in town too. Freezing it there left the actor a town behind, with\n        // nothing but a re-equip to bring it home.\n        if (state.kind === 'angel') {\n          actor.modelObject?.setAlpha(1);\n          updateAngel(actor, dt);\n          continue;\n        }\n\n        // Nor has a follower: `PetObject` has no safe-zone branch either, so\n        // the Panda keeps circling its owner in town.\n        if (state.kind === 'follower') {\n          actor.modelObject?.setAlpha(1);\n          updateFollower(actor, dt);\n          continue;\n        }\n\n        // A mount is faded out instead (o->Alpha = 0), but stays pinned to its\n        // rider so it is already in place the moment he steps out of town.\n        // And with the rider through a teleport (GOBoid.cpp:189-197).\n        actor.modelObject?.setFadeAlpha(inSafeZone ? 0 : teleportMountAlpha(state.owner));\n        updateMount(actor, dt, inSafeZone);\n      }\n    },\n  };\n};\n",
    ),

    # BarrioMU: etiqueta visual del espacio del Sabio en el inventario.
    (
        "versions/shared/ui/windows/inventory/index.tsx",
        "        <GridSquares\n          columns={COLUMNS}\n          rows={ROWS}\n          used={used}\n          hovered=\"\"\n          squareClass=\"inventory-square\"\n        />",
        "        <GridSquares\n          columns={COLUMNS}\n          rows={ROWS}\n          used={used}\n          hovered=\"\"\n          squareClass=\"inventory-square\"\n        />\n        <div className=\"sabio-space-label\">Sabio</div>",
    ),

    # BarrioMU: estilo de la etiqueta del espacio del Sabio.
    (
        "versions/shared/ui/windows/inventory/style.less",
        "// `CNewUIMyInventory` draws every piece at an absolute coordinate inside the\n// window, so the layout here is absolute positioning too - the component\n// supplies the original's numbers and this file only says how a piece behaves.\n.inventory {\n  font-size: 11px;\n\n  .window-title {\n    position: absolute;\n    left: 0;\n    right: 0;\n    text-align: center;\n    font-weight: bold;\n    text-shadow: 1px 1px 0 #000;\n  }\n\n  .head-close {\n    position: absolute;\n    cursor: pointer;\n  }\n\n  .equipment-slot {\n    position: absolute;\n    cursor: pointer;\n    pointer-events: auto;\n\n    // The silhouette the original always draws under the socket.\n    .equipment-slot-back {\n      position: absolute;\n      inset: 0;\n    }\n\n    .equipment-slot-item {\n      position: absolute;\n      inset: 0;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n\n      .item-icon {\n        max-width: 100%;\n        max-height: 100%;\n        pointer-events: none;\n        user-select: none;\n      }\n    }\n\n    // `glColor4f(0.9f, 0.1f, 0.1f, 0.4f)` over a socket the held item cannot\n    // go into (`NewUIMyInventory.cpp:1294`); the green is ours, marking the one\n    // it can.\n    &.can-equip::after,\n    &.blocked::after {\n      content: '';\n      position: absolute;\n      left: 1px;\n      top: 0;\n      right: 3px;\n      bottom: 4px;\n    }\n\n    &.can-equip::after {\n      background-color: #33cc3366;\n    }\n\n    &.blocked::after {\n      background-color: #e61a1a66;\n    }\n  }\n\n  // The squares are laid out by absolute position rather than by a CSS grid:\n  // the pixel maths that decides where a carried item lands is ported straight\n  // from `CNewUIInventoryCtrl`, and it assumes a gapless pitch of exactly one\n  // square. A `gap` would silently put every calculation half a cell out.\n  .inventory-items {\n    position: absolute;\n\n    // Blocked while a move is in flight to the server, so a second request\n    // cannot race the first.\n    &.busy {\n      pointer-events: none;\n      opacity: 0.6;\n    }\n  }\n\n  // 21x21 art on a 20px pitch, so each socket overlaps its neighbour by a\n  // pixel - which is how the original's grid gets a single shared edge.\n  .inventory-square {\n    position: absolute;\n\n    // `m_pdwItemCheckBox[i] > 1` tints every square an item covers, not just\n    // the one it is anchored to (`NewUIInventoryCtrl.cpp:891-934`), with\n    // `glColor4f(0.3f, 0.5f, 0.5f, 0.6f)`.\n    &.used::after {\n      content: '';\n      position: absolute;\n      left: 0;\n      top: 0;\n      width: 20px;\n      height: 20px;\n      background-color: #4d808099;\n    }\n  }\n\n  .inventory-item {\n    position: absolute;\n    // The squares underneath are the click targets; hit-testing is done from\n    // pixel coordinates, so the icons must not intercept anything.\n    pointer-events: none;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n\n    .item-icon {\n      max-width: 100%;\n      max-height: 100%;\n      user-select: none;\n    }\n  }\n\n  // The green/red rectangle the original draws under a carried item to show\n  // whether it would fit (`NewUIInventoryCtrl.cpp:1019-1033`).\n  .drop-target {\n    position: absolute;\n    pointer-events: none;\n    background-color: #33cc3366;\n\n    &.warning {\n      background-color: #ff333366;\n    }\n  }\n\n  // `ConvertGold` - the amount, in the well the money sprite paints.\n  .inventory-money {\n    position: absolute;\n    font-weight: bold;\n    text-shadow: 1px 1px 0 #000;\n  }\n\n  // REPAIR_MODE_ON: the squares under worn items answer to the hammer\n  // cursor; a faint tint says the window is in that mode.\n  &.repair-mode .inventory-items,\n  &.repair-mode .equipment-slot {\n    cursor: inherit;\n  }\n\n  &.repair-mode .inventory-square.used::after {\n    background-color: #b3803399;\n  }\n\n  .window-button {\n    position: absolute;\n\n    // `ChangeToolTipText` on every one of these buttons; the original renders\n    // it below the cursor, this hangs it under the button.\n    .button-tooltip {\n      display: none;\n      position: absolute;\n      top: 100%;\n      left: 50%;\n      transform: translateX(-50%);\n      margin-top: 2px;\n      padding: 1px 4px;\n      background-color: #000000cc;\n      border: 1px solid #6a6a6a;\n      color: #fff;\n      font-size: 10px;\n      white-space: nowrap;\n      pointer-events: none;\n    }\n\n    &:hover .button-tooltip {\n      display: block;\n    }\n  }\n\n}\n\n// The carried item is portalled onto the body - see the note at its JSX - so\n// its rule cannot live inside `.inventory`.\n.inventory-picked-item {\n  position: fixed;\n  pointer-events: none;\n  z-index: 1000;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  image-rendering: pixelated;\n\n  .item-icon {\n    max-width: 100%;\n    max-height: 100%;\n  }\n}\n",
        "// `CNewUIMyInventory` draws every piece at an absolute coordinate inside the\n// window, so the layout here is absolute positioning too - the component\n// supplies the original's numbers and this file only says how a piece behaves.\n.inventory {\n  font-size: 11px;\n\n  .window-title {\n    position: absolute;\n    left: 0;\n    right: 0;\n    text-align: center;\n    font-weight: bold;\n    text-shadow: 1px 1px 0 #000;\n  }\n\n  .head-close {\n    position: absolute;\n    cursor: pointer;\n  }\n\n  .equipment-slot {\n    position: absolute;\n    cursor: pointer;\n    pointer-events: auto;\n\n    // The silhouette the original always draws under the socket.\n    .equipment-slot-back {\n      position: absolute;\n      inset: 0;\n    }\n\n    .equipment-slot-item {\n      position: absolute;\n      inset: 0;\n      display: flex;\n      align-items: center;\n      justify-content: center;\n\n      .item-icon {\n        max-width: 100%;\n        max-height: 100%;\n        pointer-events: none;\n        user-select: none;\n      }\n    }\n\n    // `glColor4f(0.9f, 0.1f, 0.1f, 0.4f)` over a socket the held item cannot\n    // go into (`NewUIMyInventory.cpp:1294`); the green is ours, marking the one\n    // it can.\n    &.can-equip::after,\n    &.blocked::after {\n      content: '';\n      position: absolute;\n      left: 1px;\n      top: 0;\n      right: 3px;\n      bottom: 4px;\n    }\n\n    &.can-equip::after {\n      background-color: #33cc3366;\n    }\n\n    &.blocked::after {\n      background-color: #e61a1a66;\n    }\n  }\n\n  // The squares are laid out by absolute position rather than by a CSS grid:\n  // the pixel maths that decides where a carried item lands is ported straight\n  // from `CNewUIInventoryCtrl`, and it assumes a gapless pitch of exactly one\n  // square. A `gap` would silently put every calculation half a cell out.\n  .inventory-items {\n    position: absolute;\n\n    // Blocked while a move is in flight to the server, so a second request\n    // cannot race the first.\n    &.busy {\n      pointer-events: none;\n      opacity: 0.6;\n    }\n  }\n\n  // 21x21 art on a 20px pitch, so each socket overlaps its neighbour by a\n  // pixel - which is how the original's grid gets a single shared edge.\n  .inventory-square {\n    position: absolute;\n\n    // `m_pdwItemCheckBox[i] > 1` tints every square an item covers, not just\n    // the one it is anchored to (`NewUIInventoryCtrl.cpp:891-934`), with\n    // `glColor4f(0.3f, 0.5f, 0.5f, 0.6f)`.\n    &.used::after {\n      content: '';\n      position: absolute;\n      left: 0;\n      top: 0;\n      width: 20px;\n      height: 20px;\n      background-color: #4d808099;\n    }\n  }\n\n  .inventory-item {\n    position: absolute;\n    // The squares underneath are the click targets; hit-testing is done from\n    // pixel coordinates, so the icons must not intercept anything.\n    pointer-events: none;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n\n    .item-icon {\n      max-width: 100%;\n      max-height: 100%;\n      user-select: none;\n    }\n  }\n\n  // The green/red rectangle the original draws under a carried item to show\n  // whether it would fit (`NewUIInventoryCtrl.cpp:1019-1033`).\n  .drop-target {\n    position: absolute;\n    pointer-events: none;\n    background-color: #33cc3366;\n\n    &.warning {\n      background-color: #ff333366;\n    }\n  }\n\n  // `ConvertGold` - the amount, in the well the money sprite paints.\n  .inventory-money {\n    position: absolute;\n    font-weight: bold;\n    text-shadow: 1px 1px 0 #000;\n  }\n\n  // REPAIR_MODE_ON: the squares under worn items answer to the hammer\n  // cursor; a faint tint says the window is in that mode.\n  &.repair-mode .inventory-items,\n  &.repair-mode .equipment-slot {\n    cursor: inherit;\n  }\n\n  &.repair-mode .inventory-square.used::after {\n    background-color: #b3803399;\n  }\n\n  .window-button {\n    position: absolute;\n\n    // `ChangeToolTipText` on every one of these buttons; the original renders\n    // it below the cursor, this hangs it under the button.\n    .button-tooltip {\n      display: none;\n      position: absolute;\n      top: 100%;\n      left: 50%;\n      transform: translateX(-50%);\n      margin-top: 2px;\n      padding: 1px 4px;\n      background-color: #000000cc;\n      border: 1px solid #6a6a6a;\n      color: #fff;\n      font-size: 10px;\n      white-space: nowrap;\n      pointer-events: none;\n    }\n\n    &:hover .button-tooltip {\n      display: block;\n    }\n  }\n\n}\n\n// The carried item is portalled onto the body - see the note at its JSX - so\n// its rule cannot live inside `.inventory`.\n.inventory-picked-item {\n  position: fixed;\n  pointer-events: none;\n  z-index: 1000;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  image-rendering: pixelated;\n\n  .item-icon {\n    max-width: 100%;\n    max-height: 100%;\n  }\n}\n\n  .sabio-space-label {\n    position: absolute;\n    left: 0;\n    top: -12px;\n    font-size: 9px;\n    line-height: 10px;\n    color: #ffd35a;\n    text-shadow: 1px 1px 0 #000;\n    pointer-events: none;\n    z-index: 3;\n  }\n",
    ),

    # BarrioMU: el Sabio se equipa en su propio espacio, no en la ranura de mascota.
    (
        "src/controllers/item_rules/equipSlots.ts",
        "import type { Item } from '../../ecs/world';\nimport { InventoryConstants } from '../../core/inventoryConstants';\nimport { itemDef } from './itemStats';\n\n/**\n * Which worn slot an item belongs to. `ItemSlot` in the item files names one\n * slot per item; the two pairs the original lets an item fall through to are\n * the hands (a weapon may go to the off hand) and the fingers.\n *\n * The one table: the inventory's drop guard, its right-click auto-equip and\n * the compare tooltip all read this and nothing else.\n */\nexport function equipSlots(item: Item): number[] {\n  const slot = itemDef(item.group, item.num)?.slot ?? -1;\n  if (slot < 0) return [];\n\n  if (slot === InventoryConstants.LeftHandSlot) {\n    return [slot, InventoryConstants.RightHandSlot];\n  }\n  if (slot === InventoryConstants.Ring1Slot) {\n    return [slot, InventoryConstants.Ring2Slot];\n  }\n\n  return [slot];\n}\n\n/** True when dropping `item` onto `slot` equips it. */\nexport function isEquipable(slot: number, item: Item): boolean {\n  return equipSlots(item).includes(slot);\n}\n\n/** The free slot the item would land in, -1 when it has none. */\nexport function equipDestination(\n  item: Item,\n  worn: readonly (Item | null)[]\n): number {\n  for (const slot of equipSlots(item)) {\n    if (!worn[slot]) return slot;\n  }\n  return -1;\n}",
        "import type { Item } from '../../ecs/world';\nimport { InventoryConstants } from '../../core/inventoryConstants';\nimport { itemDef } from './itemStats';\n\n/** Espacio propio del Sabio (primer slot del inventario/bag). */\nexport const SABIO_SPACE_SLOT = InventoryConstants.LastEquippableItemSlotIndex + 1;\n\nexport function isSabioItem(item: Item): boolean {\n  return item.group === 13 && (item.num === 0 || item.num === 65 || item.num === 80 || item.num === 64);\n}\n\n/**\n * Which worn slot an item belongs to. `ItemSlot` in the item files names one\n * slot per item; the two pairs the original lets an item fall through to are\n * the hands (a weapon may go to the off hand) and the fingers.\n *\n * The one table: the inventory's drop guard, its right-click auto-equip and\n * the compare tooltip all read this and nothing else.\n */\nexport function equipSlots(item: Item): number[] {\n  // BarrioMU: el Sabio va a su propio espacio, no a la ranura de mascota.\n  if (isSabioItem(item)) return [SABIO_SPACE_SLOT];\n\n  const slot = itemDef(item.group, item.num)?.slot ?? -1;\n  if (slot < 0) return [];\n\n  if (slot === InventoryConstants.LeftHandSlot) {\n    return [slot, InventoryConstants.RightHandSlot];\n  }\n  if (slot === InventoryConstants.Ring1Slot) {\n    return [slot, InventoryConstants.Ring2Slot];\n  }\n\n  return [slot];\n}\n\n/** True when dropping `item` onto `slot` equips it. */\nexport function isEquipable(slot: number, item: Item): boolean {\n  // BarrioMU: el Sabio nunca en la ranura de mascota (queda libre para otra mascota).\n  if (isSabioItem(item) && slot === InventoryConstants.PetSlot) return false;\n  return equipSlots(item).includes(slot);\n}\n\n/** The free slot the item would land in, -1 when it has none. */\nexport function equipDestination(\n  item: Item,\n  worn: readonly (Item | null)[]\n): number {\n  for (const slot of equipSlots(item)) {\n    if (!worn[slot]) return slot;\n  }\n  return -1;\n}",
    ),


    # BarrioMU: marcador visual del espacio del Sabio (slot 12).
    (
        "versions/shared/ui/windows/inventory/index.tsx",
        "        <GridSquares\n          columns={COLUMNS}\n          rows={ROWS}\n          used={used}\n          hovered=\"\"\n          squareClass=\"inventory-square\"\n        />\n        <div className=\"sabio-space-label\">Sabio</div>",
        "        <GridSquares\n          columns={COLUMNS}\n          rows={ROWS}\n          used={used}\n          hovered=\"\"\n          squareClass=\"inventory-square\"\n        />\n        <div className=\"sabio-space-slot\" title=\"Espacio del Sabio\" />\n        <div className=\"sabio-space-label\">Espacio Sabio</div>",
    ),

    # BarrioMU: doble clic para equipar Sabio en su espacio.
    (
        "versions/shared/ui/windows/inventory/index.tsx",
        "        onPointerLeave={() => { clearLongPress(); setHover(null); }}",
        "        onPointerLeave={() => { clearLongPress(); setHover(null); }}\n        onDoubleClick={event => {\n          const sq = squareAt(event.clientX, event.clientY);\n          const ent = sq >= 0 ? squares[sq] : null;\n          if (!ent || Bag.pickedItem) return;\n          const it = ent.item;\n          const isSabio = it.group === 13 && (it.num === 0 || it.num === 65 || it.num === 80 || it.num === 64);\n          if (!isSabio) return;\n          const sabioSlot = FIRST_SLOT; // slot 12\n          if (ent.slot === sabioSlot) return;\n          if (playerData.items[sabioSlot]) return;\n          Bag.pickInventoryItem(ent.slot);\n          Bag.placePickedItem(sabioSlot);\n        }}",
    ),

    # BarrioMU: estilo destacado del espacio del Sabio.
    (
        "versions/shared/ui/windows/inventory/style.less",
        "  .sabio-space-label {\n    position: absolute;\n    left: 0;\n    top: -12px;\n    font-size: 9px;\n    line-height: 10px;\n    color: #ffd35a;\n    text-shadow: 1px 1px 0 #000;\n    pointer-events: none;\n    z-index: 3;\n  }\n",
        "  .sabio-space-label {\n    position: absolute;\n    left: -2px;\n    top: -13px;\n    font-size: 9px;\n    line-height: 10px;\n    color: #ffd35a;\n    text-shadow: 1px 1px 0 #000;\n    pointer-events: none;\n    z-index: 3;\n    white-space: nowrap;\n  }\n\n  .sabio-space-slot {\n    position: absolute;\n    left: -1px;\n    top: -1px;\n    width: 22px;\n    height: 22px;\n    box-sizing: border-box;\n    border: 1px solid #ffd35a;\n    box-shadow: 0 0 4px #ffcc44aa, inset 0 0 4px #00000066;\n    background-color: #3a2a0055;\n    pointer-events: none;\n    z-index: 2;\n  }\n",
    ),

]

for path, old, new in PATCHES:
    file = root / path
    text = file.read_text(encoding="utf-8")
    if text.count(old) != 1:
        sys.exit(f"patch-client: no se encontro una sola vez el texto en {path}: {old!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")
    print(f"patch-client: {path} ok")
