import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { AppState, UIState } from '@/controllers/interface/uiState';
import { useIsMobile } from '@/controllers/interface/mobile';
import { resetCamera, zoomCamera } from '@/controllers/camera';
import { addNotification } from '@/modules/chat/notify';
import { RangeRing, showCombatRing } from '../mobile_controls/combatPad';

/**
 * BarrioMU para PC (mouse y teclado): lo del celular que tambien sirve en la computadora.
 *
 * - El circulo rojo de alcance alrededor del personaje mientras pelea (el mismo del celular).
 * - Teclas de camara: - / + (o RePag / AvPag, o el teclado numerico) alejan y acercan,
 *   Z la centra, Alt+Enter o F11 ponen pantalla completa. Ctrl+rueda sigue funcionando.
 * En el celular no se muestra nada de esto: ahi esta el HUD tactil.
 */

const ZOOM_OUT = new Set(['Minus', 'NumpadSubtract', 'PageDown']);
const ZOOM_IN = new Set(['Equal', 'NumpadAdd', 'PageUp']);
const CENTER = 'KeyZ';

/** No robar teclas mientras se escribe (chat, buscadores, ventanas con texto). */
function typing(target: EventTarget | null): boolean {
  const el = (target instanceof HTMLElement ? target : null) ?? (document.activeElement as HTMLElement | null);
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

let hinted = false;

function onKey(ev: KeyboardEvent): void {
  if (ev.repeat && !ZOOM_OUT.has(ev.code) && !ZOOM_IN.has(ev.code)) return;
  if (AppState.uiState !== UIState.World || typing(ev.target)) return;
  if (ev.altKey && (ev.code === 'Enter' || ev.code === 'NumpadEnter')) {
    ev.preventDefault();
    toggleFullscreen();
    return;
  }
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
  if (ZOOM_OUT.has(ev.code)) zoomCamera(1);
  else if (ZOOM_IN.has(ev.code)) zoomCamera(-1);
  else if (ev.code === CENTER && !ev.shiftKey) resetCamera();
  else return;
  ev.preventDefault();
}

export const BarrioPc = observer(() => {
  const mobile = useIsMobile();
  const inWorld = AppState.uiState === UIState.World;

  useEffect(() => {
    if (mobile) return;
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobile]);

  useEffect(() => {
    if (mobile || !inWorld || hinted) return;
    hinted = true;
    showCombatRing();
    addNotification('BarrioMU: - y + alejan y acercan la cámara, Z la centra, Alt+Enter o F11 pantalla completa.');
  }, [mobile, inWorld]);

  if (mobile || !inWorld) return null;
  return <RangeRing />;
});
