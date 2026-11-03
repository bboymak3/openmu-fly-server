import { Bag } from '@/modules/inventory';
import { isMobileDevice } from '@/controllers/interface/mobile';

/**
 * BarrioMU: on a phone the finger works as the mouse over items.
 *
 * - Hold a finger on an item (inventory, gear, vault, shop, trade...): its
 *   description shows, and follows the finger from item to item, like the
 *   cursor does on a PC. Letting go after a hold picks nothing up, and the
 *   description stays up until the next touch anywhere on the screen.
 * - A quick tap still picks the item up, exactly like before.
 * - With an item in the hand, touches pass straight through (to drop it).
 *
 * It works from outside the windows: the touch is held back from the window
 * and replayed as mouse events (`pointerover` / `pointermove` / `pointerdown`),
 * the ones the item grids already answer with their tooltip and their pick.
 */

/** Item areas the finger hovers: every item grid, the inventory sheet and the gear slots. */
const ITEM_AREAS = '.mu-item-grid, .inventory-items, .equipment-slot';
/** A touch shorter than this, that did not wander, is a tap: it picks the item up. */
const TAP_MS = 280;
const TAP_SLOP = 10;

type Touch = { id: number; x: number; y: number; at: number; target: Element; moved: boolean; long: boolean };

let touch: Touch | null = null;
let hovered: Element | null = null;
let longTimer = 0;
/** A description left up after a hold, until the next touch. */
let sticky = false;

function mouseEvent(type: string, x: number, y: number, extra: PointerEventInit = {}): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 0,
    ...extra,
  });
}

/** What is under the finger, looking through the item descriptions (they may sit there). */
function underFinger(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (!el.closest('[class*="item-tooltip"]')) return el;
  }
  return null;
}

/** The pointer is now at (x, y): enter / leave and move, the way a mouse would. */
function hoverAt(x: number, y: number): void {
  const el = underFinger(x, y);
  if (el !== hovered) {
    hovered?.dispatchEvent(mouseEvent('pointerout', x, y, { relatedTarget: el }));
    el?.dispatchEvent(mouseEvent('pointerover', x, y, { relatedTarget: hovered }));
    hovered = el;
  }
  el?.dispatchEvent(mouseEvent('pointermove', x, y));
}

/** The mouse left: every tooltip goes (useHoverRelease drops on a move elsewhere). */
function hoverOut(): void {
  if (hovered) hovered.dispatchEvent(mouseEvent('pointerout', -1, -1, { relatedTarget: document.body }));
  hovered = null;
  document.body.dispatchEvent(mouseEvent('pointermove', -1, -1));
}

function stop(event: Event): void {
  event.stopPropagation();
  event.preventDefault();
}

function onDown(event: PointerEvent): void {
  if (event.pointerType !== 'touch' || !event.isPrimary || touch) return;
  if (sticky) {
    sticky = false;
    hoverOut();
  }
  const target = event.target instanceof Element ? event.target.closest(ITEM_AREAS) : null;
  if (!target || Bag.pickedItem) return;
  stop(event);
  (event.target as Element).releasePointerCapture?.(event.pointerId);
  touch = { id: event.pointerId, x: event.clientX, y: event.clientY, at: performance.now(), target, moved: false, long: false };
  window.clearTimeout(longTimer);
  longTimer = window.setTimeout(() => {
    if (touch) touch.long = true;
  }, TAP_MS);
  hoverAt(event.clientX, event.clientY);
}

function onMove(event: PointerEvent): void {
  if (!touch || event.pointerId !== touch.id) return;
  stop(event);
  if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > TAP_SLOP) touch.moved = true;
  hoverAt(event.clientX, event.clientY);
}

function onUp(event: PointerEvent): void {
  if (!touch || event.pointerId !== touch.id) return;
  stop(event);
  const t = touch;
  touch = null;
  window.clearTimeout(longTimer);
  const tap = !t.long && !t.moved && performance.now() - t.at < TAP_MS;
  if (tap) {
    // The pick the touch would have made: a left press where it started.
    const el = underFinger(t.x, t.y) ?? t.target;
    el.dispatchEvent(mouseEvent('pointerdown', t.x, t.y, { buttons: 1 }));
    el.dispatchEvent(mouseEvent('pointerup', t.x, t.y));
    hoverOut();
    return;
  }
  // After a hold the description stays where it is, to be read: the next touch takes it away.
  sticky = !!hovered;
}

function onCancel(event: PointerEvent): void {
  if (!touch || event.pointerId !== touch.id) return;
  touch = null;
  window.clearTimeout(longTimer);
  hoverOut();
}

/**
 * The finger's own enter / leave (a touch enters on press and leaves on release) would
 * drop the description the replayed mouse is keeping up: over the item areas they are ours.
 */
function onTouchOverOut(event: PointerEvent): void {
  if (event.pointerType !== 'touch') return;
  const target = event.target instanceof Element ? event.target.closest(ITEM_AREAS) : null;
  if (target || touch || sticky) event.stopPropagation();
}

/** A long press must not open the browser menu nor "use" the item under the finger. */
function onContextMenu(event: Event): void {
  const target = event.target instanceof Element ? event.target.closest(ITEM_AREAS) : null;
  if (target && (touch || performance.now() - lastTouchEnd < 600)) stop(event);
}

let lastTouchEnd = 0;

if (typeof window !== 'undefined' && isMobileDevice()) {
  window.addEventListener('pointerdown', onDown, { capture: true });
  window.addEventListener('pointermove', onMove, { capture: true });
  window.addEventListener('pointerup', e => {
    if (e.pointerType === 'touch') lastTouchEnd = performance.now();
    onUp(e);
  }, { capture: true });
  window.addEventListener('pointercancel', onCancel, { capture: true });
  window.addEventListener('contextmenu', onContextMenu, { capture: true });
  for (const type of ['pointerover', 'pointerout', 'pointerenter', 'pointerleave']) {
    window.addEventListener(type, onTouchOverOut as EventListener, { capture: true });
  }
}

export {};
