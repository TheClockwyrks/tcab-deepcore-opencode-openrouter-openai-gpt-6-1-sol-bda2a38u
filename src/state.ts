import type { DeepReadonly } from "ts-essentials";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import * as C from "./constants";

export interface Cell {
  kind: C.TileKind;
  band: C.BandName | null;
  ore: C.OreId | null;
  material: C.MaterialId | null;
  health: number | null;
  maxHealth: number | null;
}
export interface Point {
  col: number;
  row: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Effect {
  name: string;
  x: number;
  y: number;
  age: number;
  seed: number;
  scale: number;
  tint?: string;
}
export interface Resources {
  images: Record<string, ImageBitmap>;
  systems: Record<string, ParticleSystem>;
}
export interface DeepcoreState {
  resources: Resources;
  screen: C.ScreenName;
  panel: C.PanelId | null;
  mode: C.Mode;
  worldSize: C.WorldSize;
  coreRow: number;
  menuIndex: number;
  muted: boolean;
  simTime: number;
  elapsedSeconds: number;
  hasSave: boolean;
  credits: number;
  creditsEarned: number;
  deepestDepthMeters: number;
  coreTimer: number | null;
  coreGround: Point | null;
  camera: { x: number; y: number; lead: number };
  miner: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    facing: C.Facing;
    state: C.MinerState;
    travel: boolean;
    drill: boolean;
    fuel: number;
    hull: number;
    drilling: (Point & { dir: "down" | "left" | "right" }) | null;
  };
  tiles: Cell[];
  ore: Partial<Record<C.OreId, number>>;
  satchel: { resonite: number; cryenite: number; coreSample: boolean };
  tiers: Record<C.TrackName, number>;
  items: Record<C.ItemId, number>;
  nextTeleportHeight: number | null;
  nextTeleportSpeed: number | null;
  rocketInstalled: number;
  notice: { hazard: C.NoticeHazard; age: number } | null;
  noticesFired: Record<C.NoticeHazard, boolean>;
  summary: {
    deepestDepthMeters: number;
    creditsEarned: number;
    elapsedSeconds: number;
    mode: C.Mode;
    componentsInstalled: number;
    deathCause: C.DeathCause | null;
  } | null;
  accumulator: number;
  drillClock: number;
  hurt: number;
  animTime: number;
  shake: number;
  effects: Effect[];
  effectClock: number;
  eventSequence: number;
  pendingCues: C.CueName[];
  note: string;
  noteTime: number;
  pressedRegions: Record<number, string>;
  panelIndex: number;
  launchTime: number | null;
  lastAlarm: number;
}
export type ReadState = DeepReadonly<DeepcoreState>;
export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
export const maxFuel = (s: ReadState) => C.FUEL_TIERS[s.tiers.fuel - 1];
export const maxHull = (s: ReadState) => C.HULL_TIERS[s.tiers.hull - 1];
export const jetpack = (s: ReadState) => C.JETPACK_TIERS[s.tiers.jetpack - 1];
export const slotCap = (s: ReadState) => C.CARGO_TIERS[s.tiers.cargo - 1];
export const slots = (s: ReadState) =>
  Object.values(s.ore).reduce((a, n) => a + (n ?? 0), 0);
export const loadKg = (s: ReadState) =>
  C.MINERALS.reduce((a, m) => a + (s.ore[m.id] ?? 0) * m.weightKg, 0);
export const depth = (s: ReadState) =>
  Math.max(
    0,
    ((s.miner.y + C.MINER_H - C.SURFACE_Y) / C.TILE) * C.METERS_PER_ROW,
  );
export const minerCell = (s: ReadState): Point => ({
  col: Math.floor((s.miner.x + C.MINER_W / 2) / C.TILE),
  row: Math.max(0, Math.floor((s.miner.y + C.MINER_H / 2) / C.TILE)),
});
export const minable = (kind: C.TileKind) =>
  ["rock", "ore", "material", "gas", "lava"].includes(kind);

/** Copy every mutable branch once, sharing immutable asset handles and cells. */
export function draft(s: ReadState): DeepcoreState {
  return {
    ...s,
    resources: s.resources as Resources,
    tiles: [...s.tiles],
    miner: {
      ...s.miner,
      drilling: s.miner.drilling ? { ...s.miner.drilling } : null,
    },
    ore: { ...s.ore },
    satchel: { ...s.satchel },
    tiers: { ...s.tiers },
    items: { ...s.items },
    camera: { ...s.camera },
    notice: s.notice ? { ...s.notice } : null,
    noticesFired: { ...s.noticesFired },
    summary: s.summary ? { ...s.summary } : null,
    coreGround: s.coreGround ? { ...s.coreGround } : null,
    effects: s.effects.map((e) => ({ ...e })),
    pendingCues: [...s.pendingCues],
    pressedRegions: { ...s.pressedRegions },
  };
}

export function emptyState(
  resources: Resources = { images: {}, systems: {} },
): DeepcoreState {
  return {
    resources,
    screen: "title",
    panel: null,
    mode: "standard",
    worldSize: "standard",
    coreRow: C.STANDARD_ROWS,
    menuIndex: 0,
    muted: false,
    simTime: 0,
    elapsedSeconds: 0,
    hasSave: false,
    credits: 0,
    creditsEarned: 0,
    deepestDepthMeters: 0,
    coreTimer: null,
    coreGround: null,
    camera: { x: 0, y: -296, lead: 0 },
    miner: {
      x: C.SPAWN_COL * C.TILE + (C.TILE - C.MINER_W) / 2,
      y: C.SURFACE_Y - C.MINER_H,
      vx: 0,
      vy: 0,
      facing: "east",
      state: "idle",
      travel: true,
      drill: true,
      fuel: C.FUEL_TIERS[0],
      hull: C.HULL_TIERS[0],
      drilling: null,
    },
    tiles: [],
    ore: {},
    satchel: { resonite: 0, cryenite: 0, coreSample: false },
    tiers: Object.fromEntries(C.TRACKS.map((t) => [t, 1])) as Record<
      C.TrackName,
      number
    >,
    items: Object.fromEntries(C.ITEM_IDS.map((t) => [t, 0])) as Record<
      C.ItemId,
      number
    >,
    nextTeleportHeight: null,
    nextTeleportSpeed: null,
    rocketInstalled: 0,
    notice: null,
    noticesFired: { gas: false, lava: false },
    summary: null,
    accumulator: 0,
    drillClock: 0,
    hurt: 0,
    animTime: 0,
    shake: 0,
    effects: [],
    effectClock: 0,
    eventSequence: 0,
    pendingCues: [],
    note: "",
    noteTime: 0,
    pressedRegions: {},
    panelIndex: 0,
    launchTime: null,
    lastAlarm: 0,
  };
}

export function note(s: DeepcoreState, text: string) {
  s.note = text;
  s.noteTime = 4;
}
export function effect(
  s: DeepcoreState,
  name: string,
  x: number,
  y: number,
  scale = 1,
  tint?: string,
) {
  s.effects.push({
    name,
    x,
    y,
    age: 0,
    seed: ++s.eventSequence * 733,
    scale,
    tint,
  });
}
export function cue(s: DeepcoreState, name: C.CueName) {
  s.pendingCues.push(name);
}
