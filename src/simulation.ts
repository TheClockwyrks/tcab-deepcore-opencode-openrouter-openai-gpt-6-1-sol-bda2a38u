import * as C from "./constants";
import {
  type DeepcoreState,
  type ReadState,
  clamp,
  depth,
  jetpack,
  loadKg,
  effect,
  cue,
  minable,
} from "./state";
import { tileAt, put, grounded, camera } from "./world";
import {
  breakCell,
  checkDeath,
  damage,
  extract,
  finish,
  radiator,
  tickCore,
} from "./rules";
import { BAND_CHIPS } from "./palette";

export interface Held {
  left: number;
  right: number;
  down: number;
  up: number;
}
export const STEP = 1 / 120;

function solid(s: ReadState, col: number, row: number, ignoreCut = false) {
  if (
    ignoreCut &&
    s.miner.drilling?.dir === "down" &&
    s.miner.drilling.col === col &&
    s.miner.drilling.row === row
  )
    return false;
  return tileAt(s, col, row).kind !== "tunnel";
}
function move(s: DeepcoreState, dt: number) {
  const m = s.miner;
  const nx = clamp(m.x + m.vx * dt, C.TILE, C.WORLD_W - C.TILE - C.MINER_W);
  const top = Math.floor((m.y + 0.1) / C.TILE),
    bottom = Math.floor((m.y + C.MINER_H - 0.1) / C.TILE);
  let x = nx;
  const side = Math.floor((nx + (m.vx > 0 ? C.MINER_W : 0)) / C.TILE);
  for (let row = top; row <= bottom; row++)
    if (solid(s, side, row, true)) {
      if (m.vx > 0) x = Math.min(x, side * C.TILE - C.MINER_W);
      else if (m.vx < 0) x = Math.max(x, (side + 1) * C.TILE);
    }
  m.x = x;
  if (m.drilling?.dir === "down") return;
  let ny = m.y + m.vy * dt;
  const row = Math.floor((ny + (m.vy >= 0 ? C.MINER_H : 0)) / C.TILE);
  const left = Math.floor((m.x + 0.1) / C.TILE),
    right = Math.floor((m.x + C.MINER_W - 0.1) / C.TILE);
  for (let col = left; col <= right; col++)
    if (solid(s, col, row)) {
      if (m.vy > 0) {
        ny = Math.min(ny, row * C.TILE - C.MINER_H);
        if (m.vy > C.IMPACT_SAFE_SPEED) {
          const hit = (m.vy - C.IMPACT_SAFE_SPEED) * C.IMPACT_DAMAGE_RATE;
          effect(s, "impact-dust", m.x + C.MINER_W / 2, ny + C.MINER_H);
          cue(s, C.CUES.impact);
          s.shake = Math.min(1.5, 0.25 + hit / 100);
          damage(s, hit);
        }
      } else if (m.vy < 0) ny = Math.max(ny, (row + 1) * C.TILE);
      m.vy = 0;
    }
  m.y = ny;
}

function cut(s: DeepcoreState, held: Held, dt: number, wasGrounded: boolean) {
  const m = s.miner;
  const dir = held.down
    ? "down"
    : held.left
      ? "left"
      : held.right
        ? "right"
        : null;
  if (
    !dir ||
    held.up ||
    !m.drill ||
    m.fuel < C.DRILL_HIT_FUEL ||
    !wasGrounded
  ) {
    if (m.drilling?.dir === "down" && m.travel)
      m.y = Math.min(m.y, m.drilling.row * C.TILE - C.MINER_H);
    m.drilling = null;
    s.drillClock = 0;
    return;
  }
  let target = m.drilling?.dir === dir ? m.drilling : null;
  if (!target) {
    const col =
      dir === "down"
        ? Math.floor((m.x + C.MINER_W / 2) / C.TILE)
        : Math.floor(
            (dir === "left" ? m.x - 0.5 : m.x + C.MINER_W + 0.5) / C.TILE,
          );
    const row =
      dir === "down"
        ? Math.floor((m.y + C.MINER_H + 0.5) / C.TILE)
        : Math.floor((m.y + C.MINER_H / 2) / C.TILE);
    if (dir !== "down") {
      const edge =
        dir === "left" ? (col + 1) * C.TILE : col * C.TILE - C.MINER_W;
      if (Math.abs(m.x - edge) > 0.6) {
        m.drilling = null;
        s.drillClock = 0;
        return;
      }
    }
    const t = tileAt(s, col, row);
    if (!(
      minable(t.kind) ||
      (dir === "down" && t.kind === "core" && s.coreTimer === null)
    )) {
      m.drilling = null;
      s.drillClock = 0;
      return;
    }
    target = { col, row, dir };
    s.drillClock = 0;
  }
  m.drilling = { ...target };
  s.drillClock += dt;
  while (
    s.drillClock + 1e-9 >= C.DRILL_HIT_INTERVAL &&
    m.fuel >= C.DRILL_HIT_FUEL
  ) {
    s.drillClock -= C.DRILL_HIT_INTERVAL;
    m.fuel -= C.DRILL_HIT_FUEL;
    const t = tileAt(s, target.col, target.row);
    if (t.kind === "core") {
      extract(s);
      m.drilling = null;
      s.drillClock = 0;
      break;
    }
    const health = t.health! - C.DRILL_DAMAGE_TIERS[s.tiers.drill - 1];
    if (health <= 0) {
      const next = tileAt(s, target.col, target.row + 1);
      if (
        dir === "down" &&
        m.travel &&
        next.kind !== "tunnel" &&
        next.kind !== "lava"
      ) {
        m.y = (target.row + 1) * C.TILE - C.MINER_H;
        m.vy = 0;
      }
      breakCell(s, target);
      m.drilling = null;
      s.drillClock = 0;
      break;
    }
    put(s, target.col, target.row, { ...t, health });
  }
  if (m.drilling?.dir === "down" && m.travel) {
    const t = tileAt(s, target.col, target.row),
      next = tileAt(s, target.col, target.row + 1);
    if (
      t.health !== null &&
      t.maxHealth !== null &&
      next.kind !== "tunnel" &&
      next.kind !== "lava"
    ) {
      const power = C.DRILL_DAMAGE_TIERS[s.tiers.drill - 1];
      const progress = clamp(
        1 -
          t.health! / t.maxHealth! +
          ((s.drillClock / C.DRILL_HIT_INTERVAL) * power) / t.maxHealth!,
        0,
        1,
      );
      m.y = target.row * C.TILE - C.MINER_H + progress * C.TILE;
      m.vy = 0;
    }
  }
}

function lavaContact(s: DeepcoreState, dt: number) {
  const m = s.miner;
  for (
    let row = Math.floor((m.y - 0.1) / C.TILE);
    row <= Math.floor((m.y + C.MINER_H + 0.1) / C.TILE);
    row++
  )
    for (
      let col = Math.floor((m.x - 0.1) / C.TILE);
      col <= Math.floor((m.x + C.MINER_W + 0.1) / C.TILE);
      col++
    ) {
      if (
        tileAt(s, col, row).kind === "lava" &&
        !(m.drilling?.col === col && m.drilling.row === row)
      ) {
        damage(s, C.LAVA_CONTACT_DPS * dt * radiator(s), "lava");
        if (s.effectClock >= 0.12) {
          effect(s, "lava-embers", m.x + C.MINER_W / 2, m.y + C.MINER_H);
          cue(s, C.CUES.lavaSizzle);
        }
        return;
      }
    }
}

function animate(s: DeepcoreState, held: Held) {
  const m = s.miner;
  const state: C.MinerState = m.drilling
    ? m.drilling.dir === "down"
      ? "drill-down"
      : "drill-side"
    : s.hurt > 0
      ? "hurt"
      : m.fuel <= 0 && depth(s) > 0
        ? "fuel-out"
        : held.up && m.fuel > 0
          ? "jetpack"
          : !grounded(s)
            ? "fall"
            : held.left || held.right
              ? "walk"
              : "idle";
  if (state !== m.state) {
    m.state = state;
    s.animTime = 0;
  }
}

/** One render-free fixed step. All rates, timers and collisions live here. */
export function step(s: DeepcoreState, held: Held, dt: number) {
  s.elapsedSeconds += dt;
  if (s.panel !== "inventory") {
    s.animTime += dt;
    s.hurt = Math.max(0, s.hurt - dt);
  }
  s.effectClock += dt;
  if (s.launchTime !== null) {
    s.launchTime += dt;
    if (s.effectClock >= 0.12)
      effect(
        s,
        "launch-exhaust",
        1800,
        C.SURFACE_Y - s.launchTime * s.launchTime * 100,
        1.8,
      );
    if (s.launchTime >= 3) finish(s, null);
    camera(s, dt);
    return;
  }
  checkDeath(s);
  if (s.screen !== "in-mine") return;
  tickCore(s, dt);
  if (s.screen !== "in-mine") return;
  if (s.panel !== "inventory") {
    const input = s.panel ? { left: 0, right: 0, up: 0, down: 0 } : held;
    const m = s.miner;
    const ground = grounded(s);
    if (input.left || input.right) m.facing = input.left ? "west" : "east";
    const thrust = input.up > 0 && m.fuel > 0;
    const load = loadKg(s) / jetpack(s).liftLimitKg;
    if (m.travel) {
      m.vx =
        input.right || input.left || s.hurt <= 0
          ? (input.right - input.left) * C.WALK_SPEED
          : m.vx * Math.exp(-6 * dt);
      if (thrust) {
        m.vy = Math.max(
          -jetpack(s).emptyClimb *
            (1 - (1 - C.CLIMB_CAP_FLOOR) * Math.min(1, load)),
          m.vy - jetpack(s).emptyAccel * Math.max(0, 1 - load) * dt,
        );
      } else if (!m.drilling)
        m.vy = Math.min(
          C.FALL_TERMINAL_EMPTY +
            (C.FALL_TERMINAL_LOADED - C.FALL_TERMINAL_EMPTY) *
              Math.min(1, load),
          m.vy + C.GRAVITY * dt,
        );
    }
    if (thrust) {
      const burn =
        C.THRUST_BURN_MAX +
        (C.THRUST_BURN_MIN - C.THRUST_BURN_MAX) *
          Math.min(1, Math.max(0, -m.vy) / C.CRUISE_SPEED);
      m.fuel -= burn * C.THRUST_BURN_SIZE_MULT[s.worldSize] * dt;
    }
    if ((input.left || input.right) && !ground) m.fuel -= C.AIR_BURN * dt;
    // Walk to the wall first; a grounded side cut begins only at that edge.
    if (m.travel) move(s, dt);
    cut(s, input, dt, ground || grounded(s));
    if (depth(s) > 0) m.fuel -= C.LIFE_SUPPORT_BURN * dt;
    m.fuel = Math.max(0, m.fuel);
    lavaContact(s, dt);
    animate(s, input);
    if (s.effectClock >= 0.12) {
      if (m.drilling)
        effect(
          s,
          "drill-debris",
          m.drilling.dir === "down"
            ? m.x + C.MINER_W / 2
            : m.x + (m.facing === "east" ? C.MINER_W : 0),
          m.y + (m.drilling.dir === "down" ? C.MINER_H : C.MINER_H * 0.65),
          1,
          BAND_CHIPS[
            tileAt(s, m.drilling.col, m.drilling.row).band ?? "coreshell"
          ],
        );
      if (thrust) effect(s, "jetpack-exhaust", m.x + 10, m.y + C.MINER_H - 10);
    }
    s.deepestDepthMeters = Math.max(s.deepestDepthMeters, depth(s));
    checkDeath(s);
  }
  if (s.effectClock >= 0.12) s.effectClock = 0;
  if (s.notice) {
    s.notice.age += dt;
    if (s.notice.age > C.NOTICE_DELAY + C.NOTICE_FADE) s.notice = null;
  }
  camera(s, dt);
}
