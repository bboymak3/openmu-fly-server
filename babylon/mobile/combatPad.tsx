import { useEffect, useRef, useState } from 'react';
import { Ecs } from '@/ecs/current';
import type { Entity, World } from '@/ecs/world';
import { canAttackPlayer, isAttackableEntity, isAttackablePlayer } from '@/ecs/systems/attackSystem';
import { autoGetItem } from '@/ecs/systems/itemPickupSystem';
import { addNotification } from '@/modules/chat/notify';
import { Matrix, Vector3 } from '@/controllers/render/babylon/exports';

/**
 * BarrioMU: the combat wheel of the phone HUD, around the skill pad.
 *
 * - The attack button holds the nearest enemy inside `COMBAT_RANGE` as
 *   `world.attackTarget`: the very seam a tap on a monster writes, so
 *   `AttackSystem` does the walk into reach and the swings. Held down, it
 *   picks the next one as soon as the current one is gone.
 * - ✕ lets go of the target. ✋ picks up what lies around (the Space key).
 * - The target list shows who is in reach; a tap holds that one.
 * - The red ring on the ground shows the reach while fighting.
 * Nothing here decides a combat rule: the attack system and the server do.
 */

/** Reach in tiles: the ring, the attack button's search and the target list. */
export const COMBAT_RANGE = 6;
/** How long the ring stays after a press on the wheel, in ms. */
const RING_MS = 4000;
/** While the attack button is held: how often it looks for the next enemy, in ms. */
const HOLD_REPEAT_MS = 300;

let ringUntil = 0;

/** Show the reach ring for a few seconds (the skill pad calls it too). */
export function showCombatRing(): void {
  ringUntil = performance.now() + RING_MS;
}

type Candidate = { entity: Entity; distance: number; player: boolean };

/**
 * What can be attacked within reach, nearest first. Monsters always; other
 * players only when `players` asks: all attackable ones for the list (a
 * deliberate tap), only the hostile ones (PK, duel) for the attack button.
 */
function enemiesInReach(world: World, players: 'none' | 'hostile' | 'all'): Candidate[] {
  const hero = world.playerEntity;
  if (!hero || hero.dying) return [];
  const hx = hero.transform.pos.x;
  const hz = hero.transform.pos.z;
  const found: Candidate[] = [];
  for (const entity of world.netObjsQuery.entities) {
    if (entity.localPlayer || entity.dying || !entity.transform) continue;
    if (entity.worldIndex !== undefined && entity.worldIndex !== world.mapIndex) continue;
    const distance = Math.hypot(entity.transform.pos.x - hx, entity.transform.pos.z - hz);
    if (distance > COMBAT_RANGE) continue;
    if (isAttackableEntity(world, entity)) {
      found.push({ entity, distance, player: false });
    } else if (
      players !== 'none' &&
      (players === 'all' ? isAttackablePlayer(world, entity) : canAttackPlayer(world, entity, false))
    ) {
      found.push({ entity, distance, player: true });
    }
  }
  return found.sort((a, b) => a.distance - b.distance);
}

function stillAttackable(world: World, entity: Entity | null): boolean {
  return (
    !!entity &&
    !entity.dying &&
    entity.worldIndex === world.mapIndex &&
    (isAttackableEntity(world, entity) || isAttackablePlayer(world, entity))
  );
}

/** Hold `entity` as the target, the way a tap on it does. */
function hold(world: World, entity: Entity): void {
  world.attackTarget = entity;
  world.pickupTarget = null;
  world.talkTarget = null;
  showCombatRing();
}

/** The attack button's press: keep a live target, or take the nearest enemy. */
function attackNearest(notify: boolean): void {
  const world = Ecs.world;
  if (!world?.playerEntity) return;
  showCombatRing();
  if (stillAttackable(world, world.attackTarget)) return;
  const next = enemiesInReach(world, 'hostile')[0];
  if (next) hold(world, next.entity);
  else if (notify) addNotification('No hay enemigos cerca', 'info');
}

const AttackButton = () => {
  const [pressed, setPressed] = useState(false);
  const repeat = useRef(0);

  const release = () => {
    window.clearInterval(repeat.current);
    repeat.current = 0;
    setPressed(false);
  };

  useEffect(() => release, []);

  return (
    <div
      className={`barrio-attack${pressed ? ' is-pressed' : ''}`}
      title="Atacar"
      onPointerDown={e => {
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        setPressed(true);
        attackNearest(true);
        window.clearInterval(repeat.current);
        repeat.current = window.setInterval(() => attackNearest(false), HOLD_REPEAT_MS);
      }}
      onPointerUp={e => {
        e.stopPropagation();
        release();
      }}
      onPointerCancel={release}
      onContextMenu={e => e.preventDefault()}
    >
      <span className="barrio-attack-glyph">👊</span>
    </div>
  );
};

/** A plain round touch button (✕, ✋). */
const RoundButton = ({ className, title, glyph, onTap }: { className: string; title: string; glyph: string; onTap: () => void }) => {
  const [pressed, setPressed] = useState(false);
  return (
    <div
      className={`barrio-round ${className}${pressed ? ' is-pressed' : ''}`}
      title={title}
      onPointerDown={e => {
        e.stopPropagation();
        setPressed(true);
      }}
      onPointerUp={e => {
        e.stopPropagation();
        setPressed(false);
        onTap();
      }}
      onPointerCancel={() => setPressed(false)}
      onContextMenu={e => e.preventDefault()}
    >
      {glyph}
    </div>
  );
};

function letGo(): void {
  const world = Ecs.world;
  if (!world) return;
  world.attackTarget = null;
  world.castRequest = null;
  world.pickupTarget = null;
}

function pickUp(): void {
  const world = Ecs.world;
  if (!world?.playerEntity) return;
  if (!autoGetItem(world)) addNotification('No hay nada para recoger cerca', 'info');
}

/** Who is in reach, to tap one; polled a few times a second, not per frame. */
const TargetList = () => {
  const [rows, setRows] = useState<{ key: number; name: string; player: boolean; held: boolean }[]>([]);
  const entities = useRef<Entity[]>([]);

  useEffect(() => {
    const poll = () => {
      const world = Ecs.world;
      const list = world ? enemiesInReach(world, 'all').slice(0, 4) : [];
      entities.current = list.map(c => c.entity);
      const next = list.map((c, i) => ({
        key: i,
        name: (c.entity.objectNameInWorld ?? '').trim() || '¿?',
        player: c.player,
        held: c.entity === world?.attackTarget,
      }));
      setRows(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    };
    poll();
    const timer = window.setInterval(poll, 400);
    return () => window.clearInterval(timer);
  }, []);

  if (!rows.length) return null;

  return (
    <div className="barrio-targets">
      <div className="barrio-targets-title">Atacar objetivo</div>
      {rows.map((row, i) => (
        <div
          key={row.key}
          className={`barrio-target${row.held ? ' is-held' : ''}`}
          onPointerDown={e => e.stopPropagation()}
          onPointerUp={e => {
            e.stopPropagation();
            const world = Ecs.world;
            const entity = entities.current[i];
            if (world && entity) hold(world, entity);
          }}
        >
          {i + 1}. {row.player ? '⚔ ' : ''}
          {row.name}
        </div>
      ))}
    </div>
  );
};

/**
 * The reach on the ground: a circle around the hero projected onto the screen,
 * the way `CalculateScreenPositionSystem` places name tags. Drawn while a target
 * is held or for a moment after a press on the wheel.
 */
export const RangeRing = () => {
  const path = useRef<SVGPathElement>(null);

  useEffect(() => {
    let frame = 0;
    const point = Vector3.Zero();
    const screen = Vector3.Zero();
    const viewProjection = Matrix.Identity();
    const identity = Matrix.Identity();
    const STEPS = 40;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const el = path.current;
      if (!el) return;
      const world = Ecs.world;
      const hero = world?.playerEntity;
      const camera = world?.scene.activeCamera;
      const fighting = !!world && stillAttackable(world, world.attackTarget);
      if (!world || !hero || hero.dying || !camera || (!fighting && performance.now() > ringUntil)) {
        if (el.getAttribute('d')) el.setAttribute('d', '');
        return;
      }
      const engine = world.scene.getEngine();
      const canvas = engine.getRenderingCanvas();
      const svg = el.ownerSVGElement;
      if (!canvas || !svg) return;
      const renderW = engine.getRenderWidth();
      const renderH = engine.getRenderHeight();
      const viewport = camera.viewport.toGlobal(renderW, renderH);
      camera.getViewMatrix().multiplyToRef(camera.getProjectionMatrix(), viewProjection);
      const canvasBox = canvas.getBoundingClientRect();
      const svgBox = svg.getBoundingClientRect();
      const ratioX = renderW / (canvas.clientWidth || renderW);
      const ratioY = renderH / (canvas.clientHeight || renderH);
      const parent = world.mapParent.position;
      const pos = hero.transform.pos;

      let d = '';
      for (let i = 0; i <= STEPS; i++) {
        const a = (i / STEPS) * Math.PI * 2;
        point.set(
          pos.x + Math.cos(a) * COMBAT_RANGE + parent.x,
          pos.y + parent.y,
          pos.z + Math.sin(a) * COMBAT_RANGE + parent.z,
        );
        Vector3.ProjectToRef(point, identity, viewProjection, viewport, screen);
        if (screen.z < 0 || screen.z > 1) continue;
        const x = canvasBox.left - svgBox.left + screen.x / ratioX;
        const y = canvasBox.top - svgBox.top + screen.y / ratioY;
        d += `${d ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
      }
      el.setAttribute('d', d ? d + 'Z' : '');
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg className="barrio-range-ring" aria-hidden="true">
      <path ref={path} />
    </svg>
  );
};

/** The ring and the target list sit under the buttons; the buttons around the skill pad. */
export const CombatPad = () => (
  <>
    <RangeRing />
    <TargetList />
    <div className="barrio-combat">
      <AttackButton />
      <RoundButton className="barrio-cancel" title="Soltar objetivo" glyph="✕" onTap={letGo} />
      <RoundButton className="barrio-pickup" title="Recoger" glyph="✋" onTap={pickUp} />
    </div>
  </>
);
