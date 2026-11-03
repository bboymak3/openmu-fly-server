/**
 * BarrioMU: the direction the on-screen joystick is held at (mobile_controls/joystick.tsx).
 * `playerControllerSystem` reads it in its W/A/S/D walk (patched by babylon/patch-client.py),
 * so the joystick walks the tile grid exactly like the keys: same requests, same stop.
 * `forward` is up on the screen (the way the camera looks), `strafe` is right; both -1..1.
 */
export const BarrioJoystick = {
  active: false,
  forward: 0,
  strafe: 0,
};
