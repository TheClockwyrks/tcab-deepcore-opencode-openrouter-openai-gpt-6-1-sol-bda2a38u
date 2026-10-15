import * as C from "./constants";
import {
  type DeepcoreState,
  type ReadState,
  type Point,
  draft,
  emptyState,
  maxFuel,
  maxHull,
  minerCell,
  slots,
  slotCap,
  note,
  cue,
  effect,
  clamp,
} from "./state";
import {
  cell,
  tileAt,
  put,
  generate,
  emptyMine,
  fraction,
  camera,
} from "./world";
import { MINERAL_GLOW } from "./palette";

const SAVE_KEY = "deepcore.expedition.v1";
export function readSave(): DeepcoreState | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (
      typeof data !== "object" ||
      data === null ||
      !("coreRow" in data) ||
      !("tiles" in data)
    )
      return null;
    const saved = data as DeepcoreState;
    if (
      !C.WORLD_SIZES.includes(saved.worldSize) ||
      !Array.isArray(saved.tiles) ||
      saved.tiles.length !== (saved.coreRow + 1) * C.WORLD_COLS
    )
      return null;
    return saved;
  } catch {
    return null;
  }
}
export function clearSave(s: DeepcoreState) {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* Storage is optional. */
  }
  s.hasSave = false;
}
export function save(s: DeepcoreState) {
  if (s.coreTimer !== null) {
    note(s, "Unstable Sample detected. Stabilize or jettison before saving.");
    return;
  }
  try {
    const payload = {
      worldSize: s.worldSize,
      coreRow: s.coreRow,
      mode: s.mode,
      tiles: s.tiles,
      credits: s.credits,
      tiers: s.tiers,
      rocketInstalled: s.rocketInstalled,
      items: s.items,
      ore: s.ore,
      satchel: s.satchel,
      fuel: s.miner.fuel,
      hull: s.miner.hull,
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    s.hasSave = true;
    note(s, "Expedition saved. Your way home is banked.");
    cue(s, C.CUES.fabricate);
  } catch {
    note(s, "Save storage unavailable. This expedition can still continue.");
  }
}
export function restore(s: DeepcoreState) {
  const data = readSave();
  if (!data) {
    s.hasSave = false;
    note(s, "No saved expedition found.");
    return;
  }
  const next = emptyState(s.resources);
  Object.assign(next, {
    worldSize: data.worldSize,
    coreRow: data.coreRow,
    mode: data.mode,
    tiles: data.tiles,
    credits: data.credits,
    tiers: data.tiers,
    rocketInstalled: data.rocketInstalled,
    items: data.items,
    ore: data.ore,
    satchel: data.satchel,
  });
  const raw = data as unknown as { fuel: number; hull: number };
  next.miner.fuel = raw.fuel;
  next.miner.hull = raw.hull;
  next.screen = "in-mine";
  next.hasSave = true;
  next.muted = s.muted;
  next.simTime = s.simTime;
  Object.assign(s, next);
  camera(s, 0);
  note(s, "Save restored. Welcome back, prospector.");
}
export function start(s: DeepcoreState) {
  const next = emptyState(s.resources);
  next.mode = s.mode;
  next.worldSize = s.worldSize;
  next.coreRow = Math.round(C.STANDARD_ROWS * C.WORLD_SIZE_SCALE[s.worldSize]);
  next.muted = s.muted;
  next.simTime = s.simTime;
  next.screen = "in-mine";
  clearSave(next);
  generate(next);
  camera(next, 0);
  Object.assign(s, next);
  note(s, "Hold S / ↓ to drill. W / ↑ fires your jetpack. Bring the ore home.");
}
export function finish(s: DeepcoreState, cause: C.DeathCause | null) {
  if (s.summary) return;
  s.summary = {
    deepestDepthMeters: s.deepestDepthMeters,
    creditsEarned: s.creditsEarned,
    elapsedSeconds: s.elapsedSeconds,
    mode: s.mode,
    componentsInstalled: s.rocketInstalled,
    deathCause: cause,
  };
  s.screen = cause ? "game-over" : "victory";
  s.panel = null;
  s.menuIndex = 0;
  s.coreTimer = null;
  s.coreGround = null;
  s.satchel.coreSample = false;
  s.miner.drilling = null;
  if (cause) {
    effect(
      s,
      "death-burst",
      s.miner.x + C.MINER_W / 2,
      s.miner.y + C.MINER_H / 2,
    );
    cue(s, C.CUES.death);
  }
  if (!cause || s.mode === "hardcore") clearSave(s);
}
export function checkDeath(s: DeepcoreState) {
  if (s.screen !== "in-mine" || s.launchTime !== null) return;
  if (s.miner.hull <= 0) {
    s.miner.hull = 0;
    finish(s, "hull-destroyed");
  } else if (s.miner.fuel <= 0 && s.miner.y + C.MINER_H > C.SURFACE_Y + 0.1) {
    s.miner.fuel = 0;
    s.miner.state = "fuel-out";
    finish(s, "fuel-out");
  }
}
export function damage(
  s: DeepcoreState,
  amount: number,
  hazard?: C.NoticeHazard,
) {
  if (amount <= 0) return;
  s.miner.hull = Math.max(0, s.miner.hull - amount);
  s.hurt = C.HURT_TIME;
  if (hazard && !s.noticesFired[hazard]) {
    s.noticesFired[hazard] = true;
    s.notice = { hazard, age: 0 };
  }
  checkDeath(s);
}
export function gas(s: DeepcoreState, col: number, row: number) {
  const x = (col + 0.5) * C.TILE,
    y = (row + 0.5) * C.TILE;
  effect(s, "gas-explosion", x, y, 1.5);
  cue(s, C.CUES.gasExplosion);
  s.shake = 1;
  const dx = s.miner.x + C.MINER_W / 2 - x,
    dy = s.miner.y + C.MINER_H / 2 - y,
    dist = Math.hypot(dx, dy);
  if (dist <= C.GAS_BLAST_TILES * C.TILE) {
    const amount =
      C.GAS_DAMAGE_MIN +
      ((C.GAS_DAMAGE_MAX - C.GAS_DAMAGE_MIN) *
        Math.max(0, fraction(row, s.coreRow) - 0.25)) /
        0.75;
    if (s.miner.travel) {
      s.miner.vx = (dx / (dist || 1)) * C.GAS_KNOCKBACK;
      s.miner.vy = (dy / (dist || 1)) * C.GAS_KNOCKBACK;
    }
    damage(s, amount, "gas");
  }
}
export function breakCell(s: DeepcoreState, p: Point, collect = true) {
  const t = tileAt(s, p.col, p.row);
  put(s, p.col, p.row, cell("tunnel", t.band));
  const x = (p.col + 0.5) * C.TILE,
    y = (p.row + 0.5) * C.TILE;
  if (t.kind === "gas") gas(s, p.col, p.row);
  if (!collect) return;
  if (t.ore) {
    if (slots(s) < slotCap(s)) {
      s.ore[t.ore] = (s.ore[t.ore] ?? 0) + 1;
      effect(s, "ore-sparkle", x, y, 1, MINERAL_GLOW[t.ore]);
      cue(s, C.CUES.orePickup);
      note(
        s,
        `+ ${C.MINERALS.find((m) => m.id === t.ore)!.name} · ${slots(s)} / ${slotCap(s)} cargo`,
      );
    } else note(s, "Cargo full. Ore left behind — sell or drop some cargo.");
  }
  if (t.material) {
    s.satchel[t.material]++;
    effect(s, "material-shimmer", x, y);
    cue(s, C.CUES.materialChime);
    note(s, `${t.material.toUpperCase()} secured in material satchel.`);
  }
  if (t.kind === "lava") {
    const amount =
      (t.band === "coreshell"
        ? C.LAVA_DRILL_CORESHELL
        : C.LAVA_DRILL_DEEPSTONE) *
      (1 - C.RADIATOR_TIERS[s.tiers.radiator - 1]);
    effect(s, "lava-embers", x, y);
    cue(s, C.CUES.lavaSizzle);
    damage(s, amount, "lava");
  }
}
export function extract(s: DeepcoreState) {
  if (s.coreTimer !== null) {
    note(s, "Only one Core Sample can be live.");
    return;
  }
  s.satchel.coreSample = true;
  s.coreTimer = C.CORE_TIMER;
  effect(s, "core-extract", s.miner.x + C.MINER_W / 2, s.miner.y + C.MINER_H);
  cue(s, C.CUES.materialChime);
  note(s, "CORE SAMPLE UNSTABLE. 90 seconds to install the Ignition Core.");
}
export function tickCore(s: DeepcoreState, dt: number) {
  if (s.coreTimer === null) return;
  s.coreTimer -= dt;
  if (s.coreTimer > 0) return;
  const p = s.coreGround;
  const x = p ? (p.col + 0.5) * C.TILE : s.miner.x + C.MINER_W / 2,
    y = p ? (p.row + 0.5) * C.TILE : s.miner.y + C.MINER_H / 2;
  const lethal =
    s.satchel.coreSample ||
    Math.hypot(s.miner.x + C.MINER_W / 2 - x, s.miner.y + C.MINER_H / 2 - y) <=
      C.CORE_BLAST_TILES * C.TILE;
  s.coreTimer = null;
  s.coreGround = null;
  s.satchel.coreSample = false;
  s.shake = 2.5;
  effect(s, "core-detonation", x, y, 3);
  cue(s, C.CUES.gasExplosion);
  if (lethal) finish(s, "core-detonation");
  else note(s, "Core Sample lost. The Core remains — another run is possible.");
}
export function sell(s: DeepcoreState) {
  const total = C.MINERALS.reduce(
    (n, m) => n + (s.ore[m.id] ?? 0) * m.value,
    0,
  );
  if (!total) {
    note(s, "Cargo bay is empty. Bring back a haul.");
    return;
  }
  s.credits += total;
  s.creditsEarned += total;
  s.ore = {};
  cue(s, C.CUES.fabricate);
  note(s, `Haul sold · +${total.toLocaleString()} Credits`);
}
export function buyResource(
  s: DeepcoreState,
  kind: "fuel" | "hull",
  full: boolean,
) {
  const price = kind === "fuel" ? C.FUEL_PRICE : C.REPAIR_PRICE;
  const missing = Math.max(
    0,
    (kind === "fuel" ? maxFuel(s) : maxHull(s)) - s.miner[kind],
  );
  const increment =
    kind === "fuel" ? C.FUEL_BUY_INCREMENT : C.REPAIR_BUY_INCREMENT;
  const amount = Math.min(
    missing,
    full ? missing : increment,
    s.credits / price,
  );
  if (amount <= 0) {
    note(s, missing <= 0 ? "Already at full capacity." : "Not enough Credits.");
    return;
  }
  s.credits -= amount * price;
  s.miner[kind] += amount;
  cue(s, C.CUES.fabricate);
  note(
    s,
    `${kind === "fuel" ? "Fuel replenished" : "Hull repaired"} · +${amount.toFixed(0)}`,
  );
}
export function buyUpgrade(s: DeepcoreState, track: C.TrackName) {
  const tier = s.tiers[track];
  if (tier >= C.MAX_TIER[track]) {
    note(s, "Track fully upgraded.");
    return;
  }
  const price = C.UPGRADE_PRICES[tier - 1];
  if (s.credits < price) {
    note(s, "Not enough Credits.");
    return;
  }
  const fuel = maxFuel(s),
    hull = maxHull(s);
  s.credits -= price;
  s.tiers[track]++;
  if (track === "fuel") s.miner.fuel += maxFuel(s) - fuel;
  if (track === "hull") s.miner.hull += maxHull(s) - hull;
  cue(s, C.CUES.fabricate);
  note(s, `${track.toUpperCase()} upgraded to tier ${tier + 1}.`);
}
export function buyItem(s: DeepcoreState, item: C.ItemId) {
  const data = C.ITEMS.find((i) => i.id === item)!;
  if (s.credits < data.price) {
    note(s, "Not enough Credits.");
    return;
  }
  s.credits -= data.price;
  s.items[item]++;
  cue(s, C.CUES.fabricate);
  note(s, `${data.name} added to field supplies.`);
}
export function useItem(s: DeepcoreState, item: C.ItemId) {
  if (!s.items[item]) {
    note(s, "No supply of this type held.");
    return;
  }
  if (
    (item === "nanobots" && s.miner.hull >= maxHull(s)) ||
    (item === "emergency-fuel" && s.miner.fuel >= maxFuel(s))
  ) {
    note(s, "Already full. Supply retained.");
    return;
  }
  if (item === "dynamite" || item === "plastic-explosives") {
    const p = minerCell(s),
      r = item === "dynamite" ? C.DYNAMITE_RADIUS : C.PLASTIC_EXPLOSIVES_RADIUS;
    const targets: Point[] = [];
    for (
      let row = Math.max(1, p.row - r);
      row <= Math.min(s.coreRow, p.row + r);
      row++
    )
      for (
        let col = Math.max(0, p.col - r);
        col <= Math.min(C.WORLD_COLS - 1, p.col + r);
        col++
      )
        if (
          ["rock", "ore", "gas", "lava", "stone"].includes(
            tileAt(s, col, row).kind,
          )
        )
          targets.push({ col, row });
    if (!targets.length) {
      note(s, "Nothing in blast range. Supply retained.");
      return;
    }
    s.items[item]--;
    effect(
      s,
      "gas-explosion",
      s.miner.x + C.MINER_W / 2,
      s.miner.y + C.MINER_H / 2,
      r,
    );
    cue(s, C.CUES.gasExplosion);
    s.shake = 1;
    for (const t of targets) breakCell(s, t, false);
  } else {
    s.items[item]--;
    if (item === "nanobots")
      s.miner.hull = Math.min(maxHull(s), s.miner.hull + C.NANOBOT_HULL);
    if (item === "emergency-fuel")
      s.miner.fuel = Math.min(maxFuel(s), s.miner.fuel + C.EMERGENCY_FUEL);
    if (item === "quantum-teleporter" || item === "matter-transmitter") {
      const height =
        item === "quantum-teleporter"
          ? (s.nextTeleportHeight ??
            C.TELEPORT_HEIGHT_TILES_MIN +
              Math.random() *
                (C.TELEPORT_HEIGHT_TILES_MAX - C.TELEPORT_HEIGHT_TILES_MIN))
          : 0;
      const speed =
        item === "quantum-teleporter"
          ? (s.nextTeleportSpeed ??
            C.TELEPORT_SPEED_MIN +
              Math.random() * (C.TELEPORT_SPEED_MAX - C.TELEPORT_SPEED_MIN))
          : 0;
      s.miner.x = C.SPAWN_COL * C.TILE + (C.TILE - C.MINER_W) / 2;
      s.miner.y = C.SURFACE_Y - C.MINER_H - height * C.TILE;
      s.miner.vx = 0;
      s.miner.vy = speed;
      s.miner.drilling = null;
      s.drillClock = 0;
      if (item === "quantum-teleporter") {
        s.nextTeleportHeight = null;
        s.nextTeleportSpeed = null;
      }
      effect(
        s,
        "core-extract",
        s.miner.x + C.MINER_W / 2,
        s.miner.y + C.MINER_H / 2,
      );
    } else
      effect(
        s,
        "material-shimmer",
        s.miner.x + C.MINER_W / 2,
        s.miner.y + C.MINER_H / 2,
      );
    cue(s, C.CUES.fabricate);
  }
  note(s, `${C.ITEMS.find((i) => i.id === item)!.name} used.`);
  checkDeath(s);
}
export function jettison(s: DeepcoreState) {
  if (!s.satchel.coreSample) {
    note(s, "No Core Sample carried.");
    return;
  }
  s.satchel.coreSample = false;
  s.coreGround = minerCell(s);
  note(s, "Sample jettisoned. Clear three tiles before detonation.");
}
export function canFabricate(s: ReadState): boolean {
  const next = C.ROCKET_COMPONENTS[s.rocketInstalled];
  return (
    !!next &&
    s.credits >= next.credits &&
    (!next.material ||
      (next.material === "core-sample"
        ? s.satchel.coreSample
        : s.satchel[next.material] > 0))
  );
}
export function fabricate(s: DeepcoreState) {
  if (!canFabricate(s)) {
    note(s, "Component requires more Credits or its exotic material.");
    return;
  }
  const next = C.ROCKET_COMPONENTS[s.rocketInstalled];
  s.credits -= next.credits;
  if (next.material === "core-sample") {
    s.satchel.coreSample = false;
    s.coreTimer = null;
  } else if (next.material) s.satchel[next.material]--;
  s.rocketInstalled++;
  cue(s, C.CUES.fabricate);
  note(
    s,
    `${next.name} installed · ${s.rocketInstalled} / ${C.ROCKET_COMPONENTS.length}`,
  );
}
export function launch(s: DeepcoreState) {
  if (s.rocketInstalled < C.ROCKET_COMPONENTS.length || s.launchTime !== null) {
    note(s, "Complete all five components before launch.");
    return;
  }
  s.launchTime = 0;
  s.panel = null;
  cue(s, C.CUES.launch);
  effect(s, "launch-exhaust", 1800, C.SURFACE_Y, 1.8);
}
export function reset(s: ReadState): DeepcoreState {
  const next = emptyState(s.resources as DeepcoreState["resources"]);
  next.muted = s.muted;
  next.hasSave = s.hasSave;
  next.tiles = emptyMine(next.coreRow);
  return next;
}
export function resize(s: DeepcoreState, size: C.WorldSize) {
  const old = s.coreRow;
  s.worldSize = size;
  s.coreRow = Math.round(C.STANDARD_ROWS * C.WORLD_SIZE_SCALE[size]);
  const tiles = emptyMine(s.coreRow);
  for (let row = 1; row < Math.min(old, s.coreRow); row++)
    for (let col = 0; col < C.WORLD_COLS; col++)
      tiles[row * C.WORLD_COLS + col] = s.tiles[row * C.WORLD_COLS + col];
  s.tiles = tiles;
}
export function transition(
  s: ReadState,
  fn: (next: DeepcoreState) => void,
): DeepcoreState {
  const next = draft(s);
  fn(next);
  return next;
}
export const radiator = (s: ReadState) =>
  clamp(1 - C.RADIATOR_TIERS[s.tiers.radiator - 1], 0, 1);
