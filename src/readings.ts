import * as C from "./constants";
import {
  type ReadState,
  minerCell,
  depth,
  maxFuel,
  maxHull,
  slots,
  slotCap,
  loadKg,
  jetpack,
} from "./state";
import { tileAt, grounded } from "./world";

export function scanner(s: ReadState) {
  const none = {
    locked: false,
    target: null,
    dirX: 0,
    dirY: 0,
    distanceTiles: null,
  };
  const range = C.SCANNER_TIERS[s.tiers.scanner - 1];
  if (range === null) return none;
  const p = minerCell(s);
  let target: C.MaterialId | null = null,
    distance = Infinity,
    dx = 0,
    dy = 0;
  for (let i = 0; i < s.tiles.length; i++) {
    const tile = s.tiles[i];
    if (!tile.material || s.satchel[tile.material] > 0) continue;
    const x = (i % C.WORLD_COLS) - p.col,
      y = Math.floor(i / C.WORLD_COLS) - p.row,
      d = Math.hypot(x, y);
    if (d < distance) {
      target = tile.material;
      distance = d;
      dx = x;
      dy = y;
    }
  }
  if (!target || distance > range) return none;
  return {
    locked: true,
    target,
    dirX: dx / (distance || 1),
    dirY: dy / (distance || 1),
    distanceTiles: distance,
  };
}
export function snapshot(s: ReadState) {
  const p = minerCell(s),
    d = s.miner.drilling;
  const t = d ? tileAt(s, d.col, d.row) : null;
  return {
    version: C.DEEPCORE_DEBUG_VERSION,
    screen: s.screen,
    panel: s.panel,
    mode: s.mode,
    worldSize: s.worldSize,
    coreRow: s.coreRow,
    menuIndex: s.menuIndex,
    muted: s.muted,
    simTime: s.simTime,
    elapsedSeconds: s.elapsedSeconds,
    hasSave: s.hasSave,
    credits: s.credits,
    creditsEarned: s.creditsEarned,
    depthMeters: depth(s),
    deepestDepthMeters: s.deepestDepthMeters,
    coreTimer: s.coreTimer,
    coreGround: s.coreGround ? { ...s.coreGround } : null,
    camera: { ...s.camera },
    miner: {
      ...s.miner,
      ...p,
      grounded: grounded(s),
      maxFuel: maxFuel(s),
      maxHull: maxHull(s),
      overloaded: loadKg(s) >= jetpack(s).liftLimitKg,
      drilling: d
        ? {
            ...d,
            progress:
              t?.health !== null && t?.maxHealth
                ? 1 - t!.health! / t.maxHealth
                : 0,
          }
        : null,
    },
    cargo: {
      slotsUsed: slots(s),
      slotCap: slotCap(s),
      loadKg: loadKg(s),
      liftLimitKg: jetpack(s).liftLimitKg,
      ore: Object.fromEntries(
        Object.entries(s.ore).filter(([, n]) => n && n > 0),
      ),
    },
    satchel: { ...s.satchel },
    tiers: { ...s.tiers },
    items: { ...s.items },
    nextTeleportHeight: s.nextTeleportHeight,
    nextTeleportSpeed: s.nextTeleportSpeed,
    rocket: {
      installed: C.ROCKET_COMPONENT_IDS.slice(0, s.rocketInstalled),
      nextComponent: C.ROCKET_COMPONENT_IDS[s.rocketInstalled] ?? null,
    },
    scanner: scanner(s),
    notice: s.notice
      ? { hazard: s.notice.hazard, shown: s.notice.age >= C.NOTICE_DELAY }
      : null,
    noticesFired: { ...s.noticesFired },
    summary: s.summary ? { ...s.summary } : null,
  };
}
