import { useRef, useState } from 'react';
import { BarrioJoystick } from '@/controllers/interface/barrioJoystick';

/**
 * BarrioMU: walk with the thumb, bottom left. While held past the dead zone
 * it writes a direction into `BarrioJoystick`, which the W/A/S/D walk of
 * `playerControllerSystem` follows (camera-relative, on the tile grid). Let go
 * and the hero stops at the next tile, like letting go of the keys.
 */

/** Pixels the knob may travel from the centre. */
const REACH = 44;
/** Below this share of `REACH` the stick counts as centred. */
const DEAD_ZONE = 0.25;

export const Joystick = () => {
  const base = useRef<HTMLDivElement>(null);
  const pointer = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const stop = () => {
    pointer.current = null;
    BarrioJoystick.active = false;
    BarrioJoystick.forward = 0;
    BarrioJoystick.strafe = 0;
    setKnob({ x: 0, y: 0 });
  };

  const steer = (clientX: number, clientY: number) => {
    const box = base.current?.getBoundingClientRect();
    if (!box) return;
    let dx = clientX - (box.left + box.width / 2);
    let dy = clientY - (box.top + box.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > REACH) {
      dx = (dx / length) * REACH;
      dy = (dy / length) * REACH;
    }
    setKnob({ x: dx, y: dy });
    const strength = Math.min(1, length / REACH);
    BarrioJoystick.active = strength > DEAD_ZONE;
    BarrioJoystick.strafe = dx / REACH;
    BarrioJoystick.forward = -dy / REACH;
  };

  return (
    <div
      ref={base}
      className="barrio-joystick"
      onPointerDown={e => {
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        pointer.current = e.pointerId;
        steer(e.clientX, e.clientY);
      }}
      onPointerMove={e => {
        if (pointer.current !== e.pointerId) return;
        e.stopPropagation();
        steer(e.clientX, e.clientY);
      }}
      onPointerUp={e => {
        e.stopPropagation();
        stop();
      }}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="barrio-joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
};
