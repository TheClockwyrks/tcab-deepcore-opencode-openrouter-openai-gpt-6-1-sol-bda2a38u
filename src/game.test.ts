/// <reference types="node" />
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import {
  createEngine,
  ConstantClock,
  SequenceClock,
  type Engine,
  type Game,
} from "@clockwyrks/simple-2d";
import {
  game,
  BACKGROUND,
  type DeepcoreState,
  type DeepcoreDebugApi,
} from "./game";
import * as C from "./constants";
import { bandAt, buildings } from "./world";
import { STEP } from "./simulation";
import { draft } from "./state";
import { assetPath } from "./asset-path";

type TestEngine = Engine<DeepcoreState, DeepcoreDebugApi>;
const engines: TestEngine[] = [];
const diskCache = new Map<string, Uint8Array>();
const imageCache = new Map<string, unknown>();
const storage = new Map<string, string>();
let engine: TestEngine;
let target: EventTarget;

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string) => {
    const path = url.replace(/\?.*$/, "");
    let data = diskCache.get(path);
    if (!data) {
      data = await readFile(new URL(`../${path}`, import.meta.url));
      diskCache.set(path, data);
    }
    return new Response(data as BodyInit);
  });
  vi.stubGlobal("createImageBitmap", async (blob: Blob) => {
    const buf = await blob.arrayBuffer(),
      key = Array.from(new Uint8Array(buf)).join(",");
    if (!imageCache.has(key))
      imageCache.set(key, await loadImage(Buffer.from(buf)));
    return imageCache.get(key);
  });
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
});
async function fixture(clock = new ConstantClock(1000 / 60)) {
  const canvas = createCanvas(C.STAGE_W, C.STAGE_H),
    events = new EventTarget();
  const nodeGame: Game<DeepcoreState, DeepcoreDebugApi> = {
    ...game,
    // Node has no Web Audio decoder. Validate the shipped RIFF assets through
    // the engine loader, then register silent test voices on its real audio bus.
    initialize: (api) =>
      game.initialize({
        ...api,
        audio: {
          ...api.audio,
          load: async (name, path) => {
            const bytes = new Uint8Array(
              await (await api.assets.load(path)).arrayBuffer(),
            );
            expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("RIFF");
            api.audio.define(name, { freq: 440, durationMs: 1, gain: 0 });
          },
        },
      }),
  };
  const e = createEngine({
    canvas: canvas as unknown as HTMLCanvasElement,
    width: C.STAGE_W,
    height: C.STAGE_H,
    background: BACKGROUND,
    game: nodeGame,
    clock,
    surface: {
      cssWidth: () => C.STAGE_W,
      cssHeight: () => C.STAGE_H,
      dpr: () => 1,
      events: () => events,
    },
  });
  await e.initialize();
  engines.push(e);
  return { e, events };
}
beforeEach(async () => {
  storage.clear();
  const f = await fixture();
  engine = f.e;
  target = f.events;
});
afterEach(() => {
  for (const e of engines) e.destroy();
  engines.length = 0;
});
const pose = (fn: (s: DeepcoreState) => DeepcoreState) =>
  engine.apply((s) => fn(s as DeepcoreState));
const snap = () => engine.debug.snapshot(engine.state);
function key(code: string, down = true, events = target) {
  const event = new Event(down ? "keydown" : "keyup");
  Object.assign(event, { code, repeat: false });
  events.dispatchEvent(event);
}
async function tap(code: string) {
  key(code);
  await engine.advance(1);
  key(code, false);
}
function live(empty = true) {
  pose((s) => engine.debug.setScreen(s, "in-mine"));
  if (empty) pose((s) => engine.debug.clearMine(s));
}
function place(col: number, row: number) {
  pose((s) =>
    engine.debug.setMinerPosition(
      s,
      col * C.TILE + (C.TILE - C.MINER_W) / 2,
      row * C.TILE - C.MINER_H,
    ),
  );
}

describe("expedition controls and engine integration", () => {
  it("loads all authored assets and exposes the complete inert debug surface", () => {
    const s = snap();
    expect(s.version).toBe(C.DEEPCORE_DEBUG_VERSION);
    expect(s.screen).toBe("title");
    expect(s.elapsedSeconds).toBe(0);
    expect(s.miner.fuel).toBe(C.FUEL_TIERS[0]);
    expect(
      Object.keys(engine.state.resources.images).length,
    ).toBeGreaterThanOrEqual(100);
    expect(Object.keys(engine.state.resources.systems)).toHaveLength(12);
    expect(engine.diagnostics().every((d) => !d.error)).toBe(true);
    expect(engine.debug.buildings(engine.state)).toEqual(buildings);
  });
  it("navigates keyboard menus, back selection, pause and mute through engine actions", async () => {
    await tap("Enter");
    expect(snap().screen).toBe("mode-select");
    await tap("ArrowDown");
    await tap("Enter");
    expect(snap().mode).toBe("hardcore");
    expect(snap().screen).toBe("size-select");
    await tap("Escape");
    expect(snap().menuIndex).toBe(1);
    await tap("Enter");
    await tap("ArrowDown");
    await tap("Enter");
    expect(snap().screen).toBe("in-mine");
    expect(snap().worldSize).toBe("standard");
    await tap("KeyP");
    expect(snap().screen).toBe("paused");
    const time = snap().elapsedSeconds;
    await engine.advance(30);
    expect(snap().elapsedSeconds).toBe(time);
    await tap("Escape");
    expect(snap().screen).toBe("in-mine");
    await tap("KeyM");
    expect(snap().muted).toBe(true);
  });
  it("requires matching pointer edges, with touch using the same menu regions", async () => {
    const send = (type: string, x: number, y: number) => {
      const e = new Event(type);
      Object.assign(e, {
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
      });
      target.dispatchEvent(e);
    };
    const r = engine.debug.menuItemRect(engine.state, 0)!;
    send("pointerdown", r.x + 10, r.y + 10);
    send("pointerup", 0, 0);
    await engine.advance(1);
    expect(snap().screen).toBe("title");
    send("pointerdown", r.x + 10, r.y + 10);
    send("pointerup", r.x + 10, r.y + 10);
    await engine.advance(1);
    expect(snap().screen).toBe("mode-select");
  });
});

describe("generation, resizing and read-only poses", () => {
  it.each(C.WORLD_SIZES)(
    "generates %s with band densities, clustered lava and reachable prizes",
    (size) => {
      pose((s) => engine.debug.setWorldSize(s, size));
      pose((s) => engine.debug.generateMine(s));
      const s = engine.state;
      expect(s.coreRow).toBe(
        Math.round(C.STANDARD_ROWS * C.WORLD_SIZE_SCALE[size]),
      );
      for (const material of C.MATERIALS)
        expect(s.tiles.filter((t) => t.material === material)).toHaveLength(1);
      for (let b = 0; b < 4; b++) {
        const tiles = s.tiles.filter(
          (t) => t.band === C.BANDS[b] && t.kind !== "bedrock",
        );
        const share = (kind: C.TileKind) =>
          tiles.filter((t) => t.kind === kind).length / tiles.length;
        expect(share("ore")).toBeGreaterThan(
          C.ORE_DENSITY * (1 - C.DENSITY_TOLERANCE),
        );
        expect(share("ore")).toBeLessThan(
          C.ORE_DENSITY * (1 + C.DENSITY_TOLERANCE),
        );
        if (!b) expect(share("gas") + share("stone") + share("lava")).toBe(0);
        if (b < 2) expect(share("lava")).toBe(0);
      }
      const queue = [{ col: C.CAVE_MOUTH_COL, row: 1 }],
        visited = new Set<number>();
      for (let head = 0; head < queue.length; head++) {
        const { col, row } = queue[head],
          idx = row * C.WORLD_COLS + col;
        if (
          visited.has(idx) ||
          col < 1 ||
          col > C.PLAYABLE_COL_MAX ||
          row < 1 ||
          row > s.coreRow ||
          ["stone", "lava", "bedrock"].includes(
            engine.debug.tileAt(s, col, row).kind,
          )
        )
          continue;
        visited.add(idx);
        queue.push(
          { col: col + 1, row },
          { col: col - 1, row },
          { col, row: row + 1 },
          { col, row: row - 1 },
        );
      }
      expect(visited.has(s.coreRow * C.WORLD_COLS + C.CORE_COL)).toBe(true);
      s.tiles.forEach((t, i) => {
        if (t.material) expect(visited.has(i)).toBe(true);
      });
      expect(engine.debug.tileAt(s, 4, 3).ore).toBeNull();
    },
  );
  it("retains cell bands and health through resize, opening the old Core row", () => {
    pose((s) => engine.debug.setOreTile(s, 5, 200, "roselite"));
    pose((s) => engine.debug.setTileHealth(s, 5, 200, 2));
    const original = engine.state;
    pose((s) => engine.debug.setWorldSize(s, "marathon"));
    expect(engine.debug.tileAt(engine.state, 5, 200)).toEqual(
      engine.debug.tileAt(original, 5, 200),
    );
    expect(
      engine.debug.tileAt(engine.state, C.CORE_COL, C.STANDARD_ROWS).kind,
    ).toBe("tunnel");
    expect(engine.debug.tileAt(engine.state, C.CORE_COL, 1000).kind).toBe(
      "core",
    );
    pose((s) => engine.debug.setWorldSize(s, "quick"));
    expect(engine.debug.tileAt(engine.state, 5, 500).band).toBeNull();
    pose((s) => engine.debug.setTile(s, 0, 10, "stone"));
    pose((s) => engine.debug.setTile(s, 15, 250, "stone"));
    pose((s) => engine.debug.clearMine(s));
    expect(engine.debug.tileAt(engine.state, 0, 10).kind).toBe("stone");
    expect(engine.debug.tileAt(engine.state, 15, 250).kind).toBe("stone");
    expect(engine.debug.tileAt(engine.state, 5, 200).kind).toBe("tunnel");
    expect(engine.debug.tileAt(engine.state, 5, 200).band).toBe("rockbed");
  });
  it("rejects invalid domains and reconciles derived values without advancing or mutating", () => {
    const original = engine.state;
    const n = engine.debug.setCargo(original, "aurite", 8);
    expect(original.ore.aurite).toBeUndefined();
    expect(engine.debug.snapshot(n).miner.overloaded).toBe(true);
    expect(engine.debug.reconcile(n)).toEqual(n);
    expect(engine.debug.snapshot(n).simTime).toBe(0);
    expect(() => engine.debug.setTier(n, "scanner", 5)).toThrow();
    expect(() => engine.debug.setTile(n, 32, 1, "rock")).toThrow();
    expect(() => engine.debug.setCoreTimer(n, 1)).toThrow();
    expect(() => engine.debug.setTileHealth(n, 1, 1, 0)).toThrow();
    expect(() => engine.debug.setNextTeleportHeight(n, 9)).toThrow();
  });
});

describe("fixed-step movement and drilling", () => {
  it("lands exact hits, preserves partial damage, and banks ore once", async () => {
    live();
    place(4, 10);
    pose((s) => engine.debug.setOreTile(s, 4, 10, "ferron"));
    pose((s) => engine.debug.setTile(s, 4, 11, "rock"));
    pose((s) => engine.debug.setMinerTravel(s, false));
    key("KeyS");
    await engine.advance(15);
    expect(engine.debug.tileAt(engine.state, 4, 10).health).toBe(2);
    expect(snap().miner.fuel).toBeCloseTo(
      100 - 2 * C.DRILL_HIT_FUEL - 0.25 * C.LIFE_SUPPORT_BURN,
    );
    key("KeyS", false);
    await engine.advance(2);
    expect(engine.debug.tileAt(engine.state, 4, 10).health).toBe(2);
    key("KeyS");
    await engine.advance(15);
    key("KeyS", false);
    expect(engine.debug.tileAt(engine.state, 4, 10).kind).toBe("tunnel");
    expect(snap().cargo.ore).toEqual({ ferron: 1 });
    expect(snap().miner.state).toBe("fall");
  });
  it("sinks continuously, only cuts side walls at the edge, and never drills up", async () => {
    live();
    place(4, 5);
    pose((s) => engine.debug.setTile(s, 4, 5, "rock"));
    pose((s) => engine.debug.setTile(s, 4, 6, "rock"));
    key("KeyS");
    await engine.advance(6);
    expect(snap().miner.y).toBeGreaterThan(5 * C.TILE - C.MINER_H);
    expect(snap().miner.y).toBeLessThan(6 * C.TILE - C.MINER_H);
    await engine.advance(24);
    key("KeyS", false);
    expect(engine.debug.tileAt(engine.state, 4, 5).kind).toBe("tunnel");
    pose((s) => engine.debug.setTile(s, 5, 5, "rock"));
    key("KeyD");
    await engine.advance(1);
    expect(engine.debug.tileAt(engine.state, 5, 5).health).toBe(4);
    await engine.advance(40);
    key("KeyD", false);
    expect(engine.debug.tileAt(engine.state, 5, 5).kind).toBe("tunnel");
    pose((s) => engine.debug.setTile(s, 4, 4, "rock"));
    key("KeyW");
    await engine.advance(20);
    key("KeyW", false);
    expect(engine.debug.tileAt(engine.state, 4, 4).health).toBe(4);
  });
  it("applies freefall impact, weight-scaled thrust, overload and an unbounded sky", async () => {
    live();
    place(4, 1);
    pose((s) => engine.debug.setTile(s, 4, 1, "rock"));
    key("KeyW");
    await engine.advance(60);
    key("KeyW", false);
    expect(snap().miner.y).toBeLessThan(-300);
    expect(snap().camera.y).toBeLessThan(-300);
    await engine.advance(120);
    expect(snap().miner.grounded).toBe(true);
    pose((s) => engine.debug.setCargo(s, "aurite", 4));
    key("KeyW");
    await engine.advance(30);
    key("KeyW", false);
    expect(snap().miner.y).toBe(C.SURFACE_Y - C.MINER_H);
    pose((s) => engine.debug.clearCargo(s));
    pose((s) => engine.debug.setHull(s, 100));
    place(4, 1);
    pose((s) => engine.debug.setMinerPosition(s, 4 * C.TILE + 12, -1000));
    pose((s) => engine.debug.setMinerVelocity(s, 0, C.FALL_TERMINAL_EMPTY));
    await engine.advance(90);
    expect(snap().miner.hull).toBeCloseTo(75, 0);
  });
  it("gates travel and drilling independently without stopping life support", async () => {
    live();
    place(4, 10);
    pose((s) => engine.debug.setTile(s, 4, 10, "rock"));
    pose((s) => engine.debug.setMinerTravel(s, false));
    pose((s) => engine.debug.setMinerVelocity(s, 17, 39));
    const pos = snap().miner;
    key("KeyS");
    await engine.advance(15);
    key("KeyS", false);
    expect(snap().miner.x).toBe(pos.x);
    expect(snap().miner.y).toBe(pos.y);
    expect(snap().miner.vy).toBe(39);
    expect(engine.debug.tileAt(engine.state, 4, 10).health).toBe(2);
    pose((s) => engine.debug.setMinerDrill(s, false));
    key("KeyS");
    await engine.advance(30);
    key("KeyS", false);
    expect(engine.debug.tileAt(engine.state, 4, 10).health).toBe(2);
  });
  it("is frame-partition invariant under a different engine clock", async () => {
    live();
    place(4, 1);
    key("KeyW");
    await engine.advance(60);
    key("KeyW", false);
    const a = snap();
    pose((s) => engine.debug.reset(s));
    live();
    place(4, 1);
    engine.setClock(new SequenceClock([5, 10, 15, 20]));
    key("KeyW");
    await engine.advance(80);
    key("KeyW", false);
    const b = snap();
    expect(a.miner.y).toBeCloseTo(b.miner.y, 8);
    expect(a.miner.fuel).toBeCloseTo(b.miner.fuel, 8);
    expect(a.camera.lead).toBeCloseTo(b.camera.lead, 8);
  });
});

describe("economy, materials, supplies and saving", () => {
  it("sells only cargo, buys partial fuel/repair and upgrades without free refills", () => {
    pose((s) => engine.debug.setCargo(s, "ferron", 3));
    pose((s) => engine.debug.setMaterial(s, "resonite", 1));
    pose((s) => engine.debug.sell(s));
    expect(snap().credits).toBe(84);
    expect(snap().satchel.resonite).toBe(1);
    pose((s) => engine.debug.setFuel(s, 40));
    pose((s) => engine.debug.fillFuel(s));
    expect(snap().credits).toBe(24);
    expect(snap().miner.fuel).toBe(100);
    pose((s) => engine.debug.setHull(s, 50));
    pose((s) => engine.debug.repairFull(s));
    expect(snap().credits).toBe(0);
    expect(snap().miner.hull).toBe(62);
    pose((s) => engine.debug.setCredits(s, 300));
    pose((s) => engine.debug.setFuel(s, 30));
    pose((s) => engine.debug.buyUpgrade(s, "fuel"));
    expect(snap().miner.fuel).toBe(105);
    expect(snap().miner.maxFuel).toBe(175);
    expect(snap().creditsEarned).toBe(84);
  });
  it("locks the scanner to needed material, collects a node and respects cargo slots", async () => {
    live();
    pose((s) => engine.debug.setMinerTravel(s, false));
    pose((s) => engine.debug.setTier(s, "scanner", 2));
    place(4, 150);
    pose((s) => engine.debug.setMaterialTile(s, 4, 150, "resonite"));
    expect(snap().scanner.locked).toBe(true);
    pose((s) => engine.debug.setTileHealth(s, 4, 150, 1));
    key("KeyS");
    await engine.advance(8);
    key("KeyS", false);
    expect(snap().satchel.resonite).toBe(1);
    expect(snap().scanner.locked).toBe(false);
    place(4, 151);
    pose((s) => engine.debug.setCargo(s, "ferron", 15));
    pose((s) => engine.debug.setOreTile(s, 4, 151, "marlite"));
    pose((s) => engine.debug.setTileHealth(s, 4, 151, 1));
    key("KeyS");
    await engine.advance(8);
    key("KeyS", false);
    expect(snap().cargo.slotsUsed).toBe(15);
    expect(snap().cargo.ore.marlite).toBeUndefined();
  });
  it("uses explosives without collecting ore or destroying protected material", () => {
    live();
    place(4, 10);
    pose((s) => engine.debug.setOreTile(s, 4, 10, "aurite"));
    pose((s) => engine.debug.setTile(s, 3, 10, "stone"));
    pose((s) => engine.debug.setMaterialTile(s, 5, 10, "cryenite"));
    pose((s) => engine.debug.setItemCount(s, "dynamite", 1));
    pose((s) => engine.debug.useItem(s, "dynamite"));
    expect(engine.debug.tileAt(engine.state, 4, 10).kind).toBe("tunnel");
    expect(engine.debug.tileAt(engine.state, 3, 10).kind).toBe("tunnel");
    expect(engine.debug.tileAt(engine.state, 5, 10).material).toBe("cryenite");
    expect(snap().cargo.slotsUsed).toBe(0);
    expect(snap().items.dynamite).toBe(0);
  });
  it("consumes posed Quantum draws once, applies supplies and retains no-op supplies", () => {
    live();
    pose((s) => engine.debug.setItemCount(s, "quantum-teleporter", 1));
    pose((s) => engine.debug.setNextTeleportHeight(s, 8));
    pose((s) => engine.debug.setNextTeleportSpeed(s, 700));
    pose((s) => engine.debug.useItem(s, "quantum-teleporter"));
    expect(snap().miner.y + C.MINER_H).toBe(C.SURFACE_Y - 8 * C.TILE);
    expect(snap().miner.vy).toBe(700);
    expect(snap().nextTeleportSpeed).toBeNull();
    pose((s) => engine.debug.setItemCount(s, "nanobots", 2));
    pose((s) => engine.debug.useItem(s, "nanobots"));
    expect(snap().items.nanobots).toBe(2);
    pose((s) => engine.debug.setHull(s, 30));
    pose((s) => engine.debug.useItem(s, "nanobots"));
    expect(snap().miner.hull).toBe(50);
    pose((s) => engine.debug.setItemCount(s, "matter-transmitter", 1));
    pose((s) => engine.debug.useItem(s, "matter-transmitter"));
    expect(snap().miner.y).toBe(C.SURFACE_Y - C.MINER_H);
    expect(snap().miner.vy).toBe(0);
    pose((s) => engine.debug.setFuel(s, 10));
    pose((s) => engine.debug.setItemCount(s, "emergency-fuel", 1));
    pose((s) => engine.debug.useItem(s, "emergency-fuel"));
    expect(snap().miner.fuel).toBe(40);
  });
  it("saves, restores, refuses live Samples, and deletes Hardcore saves on death", async () => {
    live();
    pose((s) => engine.debug.setTile(s, 4, 1, "rock"));
    pose((s) => engine.debug.setCredits(s, 321));
    pose((s) => engine.debug.setCargo(s, "marlite", 4));
    pose((s) => engine.debug.save(s));
    expect(snap().hasSave).toBe(true);
    pose((s) => engine.debug.setCredits(s, 9));
    pose((s) => engine.debug.setHull(s, 0));
    await engine.advance(1);
    expect(snap().screen).toBe("game-over");
    expect(snap().hasSave).toBe(true);
    await tap("Enter");
    expect(snap().credits).toBe(321);
    expect(snap().cargo.ore.marlite).toBe(4);
    expect(snap().miner.y).toBe(C.SURFACE_Y - C.MINER_H);
    const saved = Array.from(storage.values())[0];
    pose((s) => engine.debug.setCoreCarried(s, true));
    pose((s) => engine.debug.save(s));
    expect(Array.from(storage.values())[0]).toBe(saved);
    pose((s) => engine.debug.setMode(s, "hardcore"));
    pose((s) => engine.debug.setHull(s, 0));
    await engine.advance(1);
    expect(snap().hasSave).toBe(false);
    expect(storage.size).toBe(0);
  });
});

describe("hazards and the escape rocket", () => {
  it("resolves gas damage, a delayed notice and a decaying render-only shake", async () => {
    live();
    place(4, 150);
    pose((s) => engine.debug.setMinerTravel(s, false));
    pose((s) => engine.debug.setTier(s, "hull", 5));
    pose((s) => engine.debug.setHull(s, 450));
    pose((s) => engine.debug.setTile(s, 4, 150, "gas"));
    pose((s) => engine.debug.setTileHealth(s, 4, 150, 1));
    key("KeyS");
    await engine.advance(8);
    key("KeyS", false);
    expect(snap().miner.hull).toBeLessThan(450);
    expect(snap().notice?.shown).toBe(false);
    expect(engine.state.shake).toBeGreaterThan(0);
    engine.setClock(new ConstantClock(100));
    await engine.advance(17);
    expect(snap().notice?.shown).toBe(true);
    await engine.advance(17);
    expect(engine.state.shake).toBe(0);
    pose((s) => engine.debug.dismissNotice(s));
    expect(snap().notice).toBeNull();
  });
  it("reduces lava burn with radiator, and kills an empty hull even in inventory", async () => {
    live();
    place(4, 300);
    pose((s) => engine.debug.setMinerTravel(s, false));
    pose((s) => engine.debug.setTier(s, "hull", 5));
    pose((s) => engine.debug.setHull(s, 450));
    pose((s) => engine.debug.setTier(s, "radiator", 5));
    pose((s) => engine.debug.setTile(s, 4, 300, "lava"));
    pose((s) => engine.debug.setTileHealth(s, 4, 300, 1));
    key("KeyS");
    await engine.advance(8);
    key("KeyS", false);
    expect(snap().miner.hull).toBeCloseTo(
      450 - C.LAVA_DRILL_DEEPSTONE * 0.2,
      0,
    );
    pose((s) => engine.debug.setPanel(s, "inventory"));
    pose((s) => engine.debug.setHull(s, 0));
    await engine.advance(1);
    expect(snap().screen).toBe("game-over");
  });
  it("ticks a carried Sample in inventory, freezes it on pause, and detonates it", async () => {
    live();
    pose((s) => engine.debug.setCoreCarried(s, true));
    pose((s) => engine.debug.setPanel(s, "inventory"));
    await engine.advance(60);
    expect(snap().coreTimer).toBeCloseTo(C.CORE_TIMER - 1);
    pose((s) => engine.debug.setScreen(s, "paused"));
    await engine.advance(60);
    expect(snap().coreTimer).toBeCloseTo(C.CORE_TIMER - 1);
    pose((s) => engine.debug.setScreen(s, "in-mine"));
    pose((s) => engine.debug.setCoreTimer(s, 0.1));
    await engine.advance(10);
    expect(snap().summary?.deathCause).toBe("core-detonation");
    expect(snap().coreTimer).toBeNull();
  });
  it("extracts an inexhaustible Sample and survives a far-away jettisoned detonation", async () => {
    live();
    place(C.CORE_COL, 500);
    key("KeyS");
    await engine.advance(8);
    key("KeyS", false);
    expect(Number.isFinite(snap().miner.y)).toBe(true);
    expect(snap().satchel.coreSample).toBe(true);
    expect(engine.debug.tileAt(engine.state, C.CORE_COL, 500).kind).toBe(
      "core",
    );
    pose((s) => engine.debug.jettison(s));
    pose((s) => engine.debug.setCoreTimer(s, 0.1));
    place(4, 1);
    await engine.advance(10);
    expect(snap().screen).toBe("in-mine");
    expect(snap().coreTimer).toBeNull();
  });
  it("fabricates in order, consumes materials, stabilizes the Sample and launches", async () => {
    live();
    pose((s) => engine.debug.setCredits(s, C.ROCKET_TOTAL_CREDITS));
    pose((s) => engine.debug.setMaterial(s, "resonite", 1));
    pose((s) => engine.debug.setMaterial(s, "cryenite", 1));
    pose((s) => engine.debug.setCoreCarried(s, true));
    for (let i = 0; i < C.ROCKET_COMPONENTS.length; i++)
      pose((s) => engine.debug.fabricate(s));
    expect(snap().credits).toBe(0);
    expect(snap().rocket.installed).toHaveLength(5);
    expect(snap().coreTimer).toBeNull();
    expect(snap().satchel.resonite).toBe(0);
    pose((s) => engine.debug.launch(s));
    engine.setClock(new ConstantClock(100));
    await engine.advance(31);
    expect(snap().screen).toBe("victory");
    expect(snap().summary?.deathCause).toBeNull();
  });
  it("ends the expedition when life support exhausts fuel, keeping installed components", async () => {
    live();
    place(4, 10);
    pose((s) => engine.debug.setMinerTravel(s, false));
    pose((s) => engine.debug.setFuel(s, 0.01));
    pose((s) => engine.debug.setRocketInstalled(s, 3));
    await engine.advance(3);
    expect(snap().summary?.deathCause).toBe("fuel-out");
    expect(snap().rocket.installed).toHaveLength(3);
  });
});

it("keeps update inputs unchanged, including cells and nested holdings", async () => {
  live();
  place(4, 10);
  pose((s) => engine.debug.setTile(s, 4, 10, "rock"));
  pose((s) => engine.debug.setMinerTravel(s, false));
  const before = draft(engine.state),
    old = engine.state;
  key("KeyS");
  await engine.advance(15);
  key("KeyS", false);
  expect(old).toEqual(before);
  expect(bandAt(126, C.STANDARD_ROWS)).toBe("rockbed");
  expect(STEP).toBeGreaterThan(0);
});

it("drives every camp panel through its actual pointer controls", async () => {
  live();
  pose((s) => engine.debug.setTile(s, C.SPAWN_COL, 1, "rock"));
  pose((s) => engine.debug.setFuel(s, 25));
  pose((s) => engine.debug.setCredits(s, 1000));
  const click = async (id: string, subject: string | null = null) => {
    const r = engine.debug.controlRect(engine.state, id, subject)!;
    expect(r).not.toBeNull();
    for (const type of ["pointerdown", "pointerup"]) {
      const event = new Event(type);
      Object.assign(event, {
        clientX: r.x + r.w / 2,
        clientY: r.y + r.h / 2,
        pointerId: 7,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerdown" ? 1 : 0,
      });
      target.dispatchEvent(event);
    }
    await engine.advance(1);
  };
  await tap("KeyE");
  expect(snap().panel).toBe("fuel-depot");
  await click("buy-fuel");
  expect(snap().miner.fuel).toBe(50);
  await click("fill-fuel");
  expect(snap().miner.fuel).toBe(100);
  pose((s) => engine.debug.setPanel(s, "upgrade-shop"));
  await click("buy-upgrade", "fuel");
  expect(snap().tiers.fuel).toBe(2);
  pose((s) => engine.debug.setPanel(s, "supply-depot"));
  await click("buy-item", "dynamite");
  expect(snap().items.dynamite).toBe(1);
  await click("buy-item", "matter-transmitter");
  expect(snap().items["matter-transmitter"]).toBe(0);
  pose((s) => engine.debug.setCargo(s, "ferron", 3));
  pose((s) => engine.debug.setPanel(s, "inventory"));
  await click("drop-ore", "ferron");
  expect(snap().cargo.ore.ferron).toBe(2);
  pose((s) => engine.debug.setPanel(s, "ore-market"));
  await click("sell");
  expect(snap().cargo.slotsUsed).toBe(0);
  expect(snap().creditsEarned).toBe(56);
  pose((s) => engine.debug.setPanel(s, "launch-pad"));
  expect(
    engine.debug.controlRect(engine.state, "fabricate", null),
  ).not.toBeNull();
  await click("fabricate");
  expect(snap().rocket.installed).toHaveLength(0);
  await tap("Escape");
  await click("inventory");
  expect(snap().panel).toBe("inventory");
  await click("mute");
  expect(snap().muted).toBe(true);
});

it("hands the engine relative asset paths in development and nested production builds", () => {
  expect(assetPath("/assets/miner/idle/frame00.png")).toBe(
    "miner/idle/frame00.png",
  );
  expect(assetPath("./assets/frame00-hash.png")).toBe("frame00-hash.png");
  expect(
    assetPath("https://example.test/games/deepcore/assets/sky-hash.png"),
  ).toBe("sky-hash.png");
  expect(
    assetPath(
      "https://example.test/assets/games/deepcore/assets/music-hash.wav",
    ),
  ).toBe("music-hash.wav");
});
