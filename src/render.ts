import type { RenderApi } from "@clockwyrks/simple-2d";
import { ParticleCanvasPlayer } from "@clockwyrks/particle-runtime/canvas";
import type { ParticleSystem } from "@clockwyrks/particle-runtime";
import * as C from "./constants";
import {
  type ReadState,
  type Rect,
  type Effect,
  maxFuel,
  maxHull,
  slots,
  slotCap,
  loadKg,
  jetpack,
  depth,
  clamp,
} from "./state";
import { buildings, nearbyBuilding, tileAt, bandAt } from "./world";
import { scanner } from "./readings";
import { controls, menuItems, menuItemRect } from "./interface";

const P = {
  bg: "#0b1720",
  panel: "#112530",
  raised: "#1b333e",
  line: "#34505a",
  text: "#e3e7d5",
  muted: "#8ea6aa",
  gold: "#edbc6d",
  mint: "#8bdbbf",
  red: "#ef947b",
};
const MONO = '"Courier New", monospace';
const SANS = '"Trebuchet MS", sans-serif';
type Context = CanvasRenderingContext2D;
// Derived rendering cache only: authoritative effect ages and seeds live in the
// state. Rewinding or rendering to a new context reconstructs the same system.
// Incremental playback avoids re-simulating an effect's whole history per draw.
const particleCache = new WeakMap<
  Context,
  Map<string, { player: ParticleCanvasPlayer; age: number }>
>();
function text(
  ctx: Context,
  value: string,
  x: number,
  y: number,
  size = 16,
  color = P.text,
  font = SANS,
  weight = "normal",
) {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.fillText(value, x, y);
}
function box(
  ctx: Context,
  r: Rect,
  fill = P.panel,
  stroke = P.line,
  radius = 8,
) {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
function image(
  ctx: Context,
  s: ReadState,
  path: string,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const img = s.resources.images[path];
  if (img) ctx.drawImage(img as ImageBitmap, x, y, w, h);
}
function line(
  ctx: Context,
  x: number,
  y: number,
  xx: number,
  yy: number,
  color = P.line,
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(xx, yy);
  ctx.stroke();
}
function pill(
  ctx: Context,
  label: string,
  x: number,
  y: number,
  color = P.gold,
) {
  box(
    ctx,
    { x, y: y - 15, w: label.length * 7.6 + 22, h: 24 },
    "#142b35",
    color,
    3,
  );
  text(ctx, label, x + 11, y + 1, 12, color, MONO);
}
function sprite(
  ctx: Context,
  s: ReadState,
  state: C.MinerState,
  x: number,
  y: number,
  size = C.MINER_SPRITE,
  west = false,
  time = s.animTime,
) {
  const frames = state === "walk" ? 8 : 4;
  const frame =
    state === "hurt"
      ? Math.min(frames - 1, Math.floor(time * C.ANIM_FPS))
      : Math.floor(time * C.ANIM_FPS) % frames;
  ctx.save();
  ctx.translate(x + (west ? size : 0), y);
  if (west) ctx.scale(-1, 1);
  image(
    ctx,
    s,
    `miner/${state}/frame${String(frame).padStart(2, "0")}.png`,
    0,
    0,
    size,
    size,
  );
  ctx.restore();
}
function particles(ctx: Context, s: ReadState, e: Effect) {
  const system = s.resources.systems[e.name];
  if (!system) return;
  ctx.save();
  ctx.translate(e.x - 128 * e.scale, e.y - 128 * e.scale);
  // The canvas binding fits its field to the backing canvas. Cancel that fit
  // locally, retaining the engine's stage transform and world camera.
  ctx.scale(
    (256 / ctx.canvas.width) * e.scale,
    (256 / ctx.canvas.height) * e.scale,
  );
  let cache = particleCache.get(ctx);
  if (!cache) {
    cache = new Map();
    particleCache.set(ctx, cache);
  }
  const key = `${e.name}:${e.seed}`;
  let entry = cache.get(key);
  const age = Math.max(0.001, e.age);
  if (!entry || entry.age > age) {
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = 0;
    const authored = system as ParticleSystem;
    const tinted = e.tint
      ? {
          ...authored,
          emitters: authored.emitters.map((em) => ({
            ...em,
            particle: {
              ...em.particle,
              colorGradient: [
                { color: e.tint!, at: 0 },
                { color: "#768493", at: 1 },
              ],
            },
          })),
        }
      : authored;
    const player = new ParticleCanvasPlayer(tinted, ctx, {
      seed: e.seed,
      clear: false,
      pixelRadius: 4,
      composite:
        e.name.includes("dust") || e.name === "gas-seep"
          ? "source-over"
          : "lighter",
    });
    ctx.globalAlpha = alpha;
    entry = { player, age: 0 };
    cache.set(key, entry);
    if (cache.size > 256) cache.delete(cache.keys().next().value!);
  }
  entry.player.simulator.step((age - entry.age) * 1000);
  entry.age = age;
  entry.player.update(0);
  ctx.restore();
}
function rock(
  ctx: Context,
  s: ReadState,
  col: number,
  row: number,
  x: number,
  y: number,
) {
  const t = tileAt(s, col, row),
    band = t.band ?? bandAt(row, s.coreRow);
  image(
    ctx,
    s,
    `tiles/${band}-${Math.abs(col * 17 + row * 7) % C.TILE_VARIANTS}.png`,
    x,
    y,
    C.TILE,
    C.TILE,
  );
}
function interior(
  ctx: Context,
  s: ReadState,
  col: number,
  row: number,
  x: number,
  y: number,
  lava: boolean,
) {
  const kind = lava ? "lava" : "tunnel";
  const same = (dx: number, dy: number) =>
    tileAt(s, col + dx, row + dy).kind === kind || (!lava && row + dy <= 0);
  const left = same(-1, 0),
    right = same(1, 0),
    up = same(0, -1),
    down = same(0, 1);
  ctx.save();
  ctx.beginPath();
  const x0 = x + (left ? 0 : 7),
    y0 = y + (up ? 0 : 7),
    x1 = x + 80 - (right ? 0 : 7),
    y1 = y + 80 - (down ? 0 : 7);
  ctx.roundRect(x0, y0, x1 - x0, y1 - y0, [
    !left && !up ? 13 : 0,
    !right && !up ? 13 : 0,
    !right && !down ? 13 : 0,
    !left && !down ? 13 : 0,
  ]);
  for (const [dx, dy, open] of [
    [-1, -1, left && up],
    [1, -1, right && up],
    [-1, 1, left && down],
    [1, 1, right && down],
  ] as const) {
    if (open && !same(dx, dy)) {
      const cx = x + (dx === 1 ? 80 : 0),
        cy = y + (dy === 1 ? 80 : 0);
      ctx.moveTo(cx + 13, cy);
      ctx.arc(cx, cy, 13, 0, Math.PI * 2);
    }
  }
  ctx.clip("evenodd");
  if (lava) {
    const f = Math.floor(s.elapsedSeconds * 6) % 4;
    image(
      ctx,
      s,
      `hazards/lava/frame${String(f).padStart(2, "0")}.png`,
      x,
      y,
      C.TILE,
      C.TILE,
    );
  } else image(ctx, s, "tiles/tunnel.png", x, y, C.TILE, C.TILE);
  ctx.restore();
}
function world(ctx: Context, s: ReadState) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, C.HUD_H, C.VIEW_W, C.VIEW_H);
  ctx.clip();
  const shake =
    s.shake > 0
      ? Math.sin(s.elapsedSeconds * 117) * Math.min(13, s.shake * 9)
      : 0;
  ctx.translate(
    -s.camera.x + shake,
    C.HUD_H -
      s.camera.y +
      Math.cos(s.elapsedSeconds * 139) * Math.min(9, s.shake * 6),
  );
  image(
    ctx,
    s,
    "surface/sky.png",
    s.camera.x * 0.8,
    s.camera.y - 80,
    1280,
    720,
  );
  const first = Math.max(0, Math.floor(s.camera.x / C.TILE)),
    last = Math.min(
      C.WORLD_COLS - 1,
      Math.ceil((s.camera.x + C.VIEW_W) / C.TILE),
    );
  const top = Math.max(1, Math.floor(s.camera.y / C.TILE)),
    bottom = Math.min(s.coreRow, Math.ceil((s.camera.y + C.VIEW_H) / C.TILE));
  for (let row = top; row <= bottom; row++)
    for (let col = first; col <= last; col++) {
      const t = tileAt(s, col, row),
        x = col * C.TILE,
        y = row * C.TILE;
      if (t.kind === "bedrock")
        image(ctx, s, "tiles/bedrock.png", x, y, C.TILE, C.TILE);
      else {
        rock(ctx, s, col, row, x, y);
        if (t.kind === "tunnel" || t.kind === "lava")
          interior(ctx, s, col, row, x, y, t.kind === "lava");
        if (t.kind === "stone")
          image(
            ctx,
            s,
            `tiles/stone-${(col + row) % 2}.png`,
            x,
            y,
            C.TILE,
            C.TILE,
          );
        if (t.ore) image(ctx, s, `ore/${t.ore}.png`, x, y, C.TILE, C.TILE);
        if (t.material)
          image(ctx, s, `materials/${t.material}.png`, x, y, C.TILE, C.TILE);
        if (t.kind === "core")
          image(ctx, s, "materials/core.png", x, y, C.TILE, C.TILE);
        if (t.health !== null && t.health < t.maxHealth!) {
          const f = clamp(
            Math.floor((1 - t.health / t.maxHealth!) * C.CRACK_FRAMES),
            0,
            C.CRACK_FRAMES - 1,
          );
          image(
            ctx,
            s,
            `tiles/crack/frame${String(f).padStart(2, "0")}.png`,
            x,
            y,
            C.TILE,
            C.TILE,
          );
        }
        if (t.kind === "gas")
          particles(ctx, s, {
            name: "gas-seep",
            x: x + 40,
            y: y + 40,
            age:
              (s.elapsedSeconds + ((col * 17 + row) % 20) / 10) %
              C.GAS_SEEP_PERIOD,
            seed: row * 32 + col,
            scale: 1,
          });
      }
      ctx.strokeStyle = "#0a15231f";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, C.TILE, C.TILE);
    }
  if (s.camera.y < C.SURFACE_Y) {
    // The first earth row remains visible beneath the thin scrapped camp lip.
    for (let col = first; col <= last; col++) {
      if (col === C.CAVE_MOUTH_COL) continue;
      image(ctx, s, "surface/ground.png", col * C.TILE, C.SURFACE_Y, 80, 9);
    }
    for (const b of buildings) {
      if (b.id === "launch-pad") {
        image(
          ctx,
          s,
          `rocket/stage${s.rocketInstalled}.png`,
          b.x,
          b.y - 40 - (s.launchTime ?? 0) ** 2 * 100,
          b.w,
          300,
        );
        image(
          ctx,
          s,
          "surface/launch-pad.png",
          b.x,
          C.SURFACE_Y - 180,
          b.w,
          180,
        );
      } else image(ctx, s, `surface/${b.id}.png`, b.x, b.y, b.w, b.h);
      text(
        ctx,
        b.id.replace(/-/g, " ").toUpperCase(),
        b.x + b.w / 2 - b.id.length * 3.7,
        b.y - 14,
        12,
        P.muted,
        MONO,
      );
      line(ctx, b.x + 90, b.y - 5, b.x + 150, b.y - 5, "#48616a");
    }
    image(
      ctx,
      s,
      "surface/cave-mouth.png",
      C.CAVE_MOUTH_COL * C.TILE - 40,
      C.SURFACE_Y - 105,
      160,
      110,
    );
    text(
      ctx,
      "↓  MINE ACCESS",
      C.CAVE_MOUTH_COL * C.TILE - 25,
      C.SURFACE_Y - 120,
      12,
      P.gold,
      MONO,
    );
  }
  for (const e of s.effects)
    if (
      e.x + 256 * e.scale > s.camera.x &&
      e.x - 256 * e.scale < s.camera.x + C.VIEW_W &&
      e.y + 256 * e.scale > s.camera.y &&
      e.y - 256 * e.scale < s.camera.y + C.VIEW_H
    )
      particles(ctx, s, e);
  if (s.coreGround) {
    const x = s.coreGround.col * C.TILE,
      y = s.coreGround.row * C.TILE;
    image(ctx, s, "materials/core-sample.png", x + 15, y + 15, 50, 50);
    pill(ctx, `${Math.ceil(s.coreTimer ?? 0)}s`, x + 10, y - 4, P.red);
  }
  if (s.launchTime === null) {
    const x = s.miner.x - (C.MINER_SPRITE - C.MINER_W) / 2,
      y = s.miner.y + C.MINER_H - C.MINER_SPRITE;
    const glow = ctx.createRadialGradient(
      x + 45,
      y + 25,
      8,
      x + 45,
      y + 25,
      130,
    );
    glow.addColorStop(0, "#f7d79b14");
    glow.addColorStop(1, "#f7d79b00");
    ctx.fillStyle = glow;
    ctx.fillRect(x - 100, y - 100, 300, 300);
    sprite(
      ctx,
      s,
      s.miner.state,
      x,
      y,
      C.MINER_SPRITE,
      s.miner.facing === "west",
    );
  }
  ctx.restore();
  const vignette = ctx.createRadialGradient(640, 360, 200, 640, 360, 760);
  vignette.addColorStop(0, "#07131a00");
  vignette.addColorStop(1, "#07131a88");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, C.HUD_H, C.STAGE_W, C.VIEW_H);
}
function gauge(
  ctx: Context,
  s: ReadState,
  icon: string,
  label: string,
  value: number,
  max: number,
  x: number,
  w: number,
  color: string,
) {
  image(ctx, s, `icons/${icon}.png`, x, 16, 24, 24);
  text(ctx, label, x + 32, 20, 10, P.muted, MONO);
  text(
    ctx,
    `${Math.ceil(value)} / ${max}`,
    x + 32,
    37,
    15,
    color,
    MONO,
    "bold",
  );
  ctx.fillStyle = "#213843";
  ctx.fillRect(x + 32, 44, w - 42, 3);
  ctx.fillStyle = color;
  ctx.fillRect(x + 32, 44, (w - 42) * clamp(value / max, 0, 1), 3);
}
function hud(ctx: Context, s: ReadState) {
  ctx.fillStyle = "#0d202b";
  ctx.fillRect(0, 0, C.STAGE_W, C.HUD_H);
  line(ctx, 0, C.HUD_H, 1280, C.HUD_H, "#46606a");
  gauge(
    ctx,
    s,
    "fuel",
    "FUEL",
    s.miner.fuel,
    maxFuel(s),
    20,
    174,
    s.miner.fuel < maxFuel(s) * C.LOW_FUEL_FRACTION ? P.red : P.gold,
  );
  gauge(
    ctx,
    s,
    "hull",
    "HULL",
    s.miner.hull,
    maxHull(s),
    205,
    164,
    s.miner.hull < maxHull(s) * C.LOW_HULL_FRACTION ? P.red : P.mint,
  );
  image(ctx, s, "icons/cargo.png", 390, 16, 24, 24);
  text(ctx, "CARGO", 422, 20, 10, P.muted, MONO);
  const overloaded = loadKg(s) >= jetpack(s).liftLimitKg;
  text(
    ctx,
    overloaded ? C.OVERLOAD : `${slots(s)} / ${slotCap(s)}  ·  ${loadKg(s)} kg`,
    422,
    39,
    14,
    overloaded || slots(s) >= slotCap(s) ? P.red : P.text,
    MONO,
  );
  image(ctx, s, "icons/credits.png", 613, 16, 24, 24);
  text(ctx, "CREDITS", 645, 20, 10, P.muted, MONO);
  text(
    ctx,
    s.credits.toLocaleString(undefined, { maximumFractionDigits: 0 }),
    645,
    39,
    16,
    P.gold,
    MONO,
    "bold",
  );
  image(ctx, s, "icons/depth.png", 768, 16, 24, 24);
  text(ctx, "DEPTH", 800, 20, 10, P.muted, MONO);
  text(
    ctx,
    `${Math.floor(depth(s)).toLocaleString()} m`,
    800,
    39,
    16,
    P.text,
    MONO,
    "bold",
  );
  for (const [i, material] of C.MATERIALS.entries()) {
    ctx.globalAlpha = s.satchel[material] ? 1 : 0.3;
    image(ctx, s, `icons/${material}.png`, 924 + i * 58, 15, 24, 24);
    ctx.globalAlpha = 1;
    text(
      ctx,
      s.satchel[material] ? "✓" : "—",
      950 + i * 58,
      34,
      12,
      s.satchel[material] ? P.mint : P.muted,
      MONO,
    );
  }
  for (const c of controls(s).filter((c) =>
    ["inventory", "pause", "mute"].includes(c.id),
  ))
    button(ctx, c, c.label, false, c.enabled);
}
function button(
  ctx: Context,
  r: Rect,
  label: string,
  active = false,
  enabled = true,
) {
  active = active && enabled;
  box(
    ctx,
    r,
    active ? "#e7ba70" : enabled ? "#1e3742" : "#182b35",
    active ? "#ffe0a1" : enabled ? "#4a6570" : "#2b414b",
    4,
  );
  text(
    ctx,
    label,
    r.x + 16,
    r.y + r.h / 2 + 5,
    Math.min(15, r.h * 0.37),
    active ? "#152935" : enabled ? P.text : "#627d85",
    MONO,
    active ? "bold" : "normal",
  );
  if (active) {
    text(ctx, "↗", r.x + r.w - 35, r.y + r.h / 2 + 6, 19, "#243b45", SANS);
  }
}
function overlay(ctx: Context) {
  ctx.fillStyle = "#061119c9";
  ctx.fillRect(0, C.HUD_H, C.STAGE_W, C.VIEW_H);
}
function titleScene(ctx: Context, s: ReadState) {
  image(ctx, s, "surface/sky.png", 0, 0, 1280, 720);
  // An illustrated, asset-built cutaway introduces the exact visual language of play.
  for (let row = 0; row < 5; row++)
    for (let col = 0; col < 9; col++) {
      const x = 560 + col * 80,
        y = 354 + row * 80;
      image(
        ctx,
        s,
        `tiles/${row < 2 ? "topsoil" : "rockbed"}-${(col + row) % 3}.png`,
        x,
        y,
        80,
        80,
      );
      if (
        (col === 3 && row < 3) ||
        (row === 2 && col >= 3 && col < 7) ||
        (col === 6 && row >= 2)
      ) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x + 5, y + 3, 70, 77, 12);
        ctx.clip();
        image(ctx, s, "tiles/tunnel.png", x, y, 80, 80);
        ctx.restore();
      } else if ((col * 7 + row * 3) % 5 === 0)
        image(
          ctx,
          s,
          `ore/${["ferron", "marlite", "cuprite", "argenite"][row % 4]}.png`,
          x,
          y,
          80,
          80,
        );
    }
  for (const [id, x, y, w, h] of [
    ["upgrade-shop", 595, 180, 240, 180],
    ["fuel-depot", 856, 180, 240, 180],
  ] as const)
    image(ctx, s, `surface/${id}.png`, x, y, w, h);
  image(ctx, s, "rocket/stage4.png", 1080, 70, 240, 300);
  sprite(ctx, s, "drill-down", 800, 437, 100, false, s.simTime);
  particles(ctx, s, {
    name: "drill-debris",
    x: 851,
    y: 530,
    age: s.simTime % 0.55,
    seed: 12,
    scale: 1,
  });
  const shade = ctx.createLinearGradient(0, 0, 1280, 0);
  shade.addColorStop(0, "#0b1923");
  shade.addColorStop(0.4, "#0b1923f5");
  shade.addColorStop(0.65, "#0b19234d");
  shade.addColorStop(1, "#0b192300");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 1280, 720);
  const bottom = ctx.createLinearGradient(0, 510, 0, 720);
  bottom.addColorStop(0, "#0b172000");
  bottom.addColorStop(1, "#0b1720ee");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, 510, 1280, 210);
  pill(ctx, "A LONE PROSPECTOR. A DEAD WORLD.", 78, 96, P.mint);
  text(ctx, C.TITLE_TEXT, 70, 214, 88, P.text, SANS, "bold");
  text(ctx, "THE ONLY WAY OUT IS DOWN.", 78, 254, 17, P.gold, MONO, "bold");
  text(ctx, "Dig deep. Carry too much. Make it home.", 78, 308, 19, "#b2c1bd");
  text(
    ctx,
    "Build your escape from what lies beneath.",
    78,
    337,
    19,
    "#b2c1bd",
  );
  line(ctx, 78, 365, 439, 365);
  text(ctx, "01 / EXPEDITION CONTROL", 78, 386, 10, P.muted, MONO);
  text(ctx, "OUTPOST 07", 682, 133, 11, P.muted, MONO);
  line(ctx, 682, 142, 770, 142);
  pill(ctx, "DEPTH IS CHEAP. HEIGHT IS EXPENSIVE.", 790, 654, P.gold);
  text(ctx, "WASD / ARROWS   ·   ENTER TO SELECT", 78, 673, 11, P.muted, MONO);
  text(ctx, "ORIGINAL TRANSMISSION  /  DEEPCORE", 78, 695, 9, "#5b7984", MONO);
}
const help = [
  [
    "01  DIG & RETURN",
    "A / D or ← / → walks and cuts walls. S / ↓ drills down.",
    "W / ↑ / SPACE fires the jetpack. You can never drill up.",
  ],
  [
    "02  EVERY HAUL IS A BET",
    "Ore fills cargo slots; its weight slows the climb and burns more fuel.",
    "At the lift limit you cannot ascend. I opens cargo; drop ore to shed weight.",
  ],
  [
    "03  BUILD A WAY OFF THIS ROCK",
    "E / ENTER opens a camp building. Sell ore, buy fuel, repair and upgrade.",
    "Find Resonite and Cryenite with a scanner. Fabricate five rocket components.",
  ],
  [
    "04  THE MINE IS THE ADVERSARY",
    "Watch for gas wisps, lava and long falls. Upgrade hull and radiator.",
    "The Core Sample lasts 90 seconds. Bring it to the pad — or J to jettison.",
  ],
  [
    "05  BANK YOUR PROGRESS",
    "Only the Save Pad saves. Standard can restore a save after death.",
    "Hardcore deletes it. 1–6 uses supplies; P / ESC pauses; M toggles audio.",
  ],
];
function menus(ctx: Context, s: ReadState) {
  if (s.screen === "title") titleScene(ctx, s);
  else {
    overlay(ctx);
    box(
      ctx,
      { x: 210, y: 95, w: 860, h: s.screen === "how-to-play" ? 580 : 555 },
      "#10242fed",
      "#3e5c65",
      12,
    );
    pill(ctx, "DEEPCORE / EXPEDITION CONTROL", 248, 135, P.mint);
    const headings: Partial<Record<C.ScreenName, string>> = {
      "mode-select": "Choose your stakes.",
      "size-select": "How far will you go?",
      paused: "Catch your breath.",
      victory: "You made it off the rock.",
      "game-over": "The mine keeps its secrets.",
      "how-to-play": "A field guide to survival.",
    };
    text(ctx, headings[s.screen] ?? "", 248, 197, 36, P.text, SANS, "bold");
    const subtitle =
      s.screen === "mode-select"
        ? "One expedition. Two ways to face the end."
        : s.screen === "size-select"
          ? "The same danger. A different distance home."
          : s.screen === "paused"
            ? "The expedition is paused. Your fuel, hull and Sample are safe."
            : s.screen === "victory"
              ? "From a stranded prospector to a signal in the stars."
              : s.screen === "game-over"
                ? `SIGNAL LOST / ${s.summary?.deathCause?.replace(/-/g, " ").toUpperCase() ?? "EXPEDITION ENDED"}`
                : "";
    text(
      ctx,
      subtitle,
      248,
      232,
      16,
      s.screen === "game-over" ? P.red : P.muted,
    );
    if (s.screen === "how-to-play") {
      help.forEach(([title, a, b], i) => {
        const y = 241 + i * 71;
        text(ctx, title, 248, y, 12, P.gold, MONO, "bold");
        text(ctx, a, 248, y + 22, 14, P.text);
        text(ctx, b, 248, y + 41, 14, P.muted);
      });
    }
    if (s.summary) {
      text(
        ctx,
        `${Math.floor(s.summary.deepestDepthMeters).toLocaleString()} m DEEPEST   /   ${s.summary.creditsEarned.toLocaleString()} Cr EARNED`,
        330,
        270,
        13,
        P.gold,
        MONO,
      );
      text(
        ctx,
        `${Math.floor(s.summary.elapsedSeconds / 60)}m ${Math.floor(s.summary.elapsedSeconds % 60)}s   ·   ${s.mode.toUpperCase()}   ·   ${s.rocketInstalled}/5 COMPONENTS`,
        330,
        502,
        13,
        P.muted,
        MONO,
      );
    }
  }
  menuItems(s).forEach((item, i) => {
    const r = menuItemRect(s, i)!;
    button(ctx, r, item, s.menuIndex === i);
    if (s.screen === "mode-select" && i < 2)
      text(
        ctx,
        i === 0
          ? "Restore your last save after death."
          : "Death deletes the save. One chance.",
        r.x + 185,
        r.y + 36,
        13,
        s.menuIndex === i ? "#344b50" : P.muted,
      );
    if (s.screen === "size-select" && i < 3)
      text(
        ctx,
        `${Math.round(C.STANDARD_ROWS * C.WORLD_SIZE_SCALE[C.WORLD_SIZES[i]]) * C.METERS_PER_ROW} m to the Core`,
        r.x + 260,
        r.y + 36,
        14,
        s.menuIndex === i ? "#344b50" : P.muted,
        MONO,
      );
  });
}
function upgradeEffect(s: ReadState, t: C.TrackName): string {
  const n = Math.min(C.MAX_TIER[t], s.tiers[t] + 1) - 1;
  switch (t) {
    case "fuel":
      return `${C.FUEL_TIERS[n]} fuel capacity`;
    case "drill":
      return `Power rating ${n + 1} · faster cuts`;
    case "cargo":
      return `${C.CARGO_TIERS[n]} ore slots`;
    case "hull":
      return `${C.HULL_TIERS[n]} maximum hull`;
    case "jetpack":
      return `${C.JETPACK_TIERS[n].liftLimitKg.toLocaleString()} kg lift · ${C.JETPACK_TIERS[n].emptyClimb} climb`;
    case "radiator":
      return `${Math.round(C.RADIATOR_TIERS[n] * 100)}% less lava damage`;
    case "scanner":
      return `${C.SCANNER_TIERS[n]} tile material detection`;
  }
}
function cargoRows(ctx: Context, s: ReadState, inventory: boolean) {
  const held = C.MINERALS.filter((m) => (s.ore[m.id] ?? 0) > 0);
  if (!held.length) {
    text(
      ctx,
      "EMPTY BAY. UNTAPPED POSSIBILITIES.",
      inventory ? 250 : 270,
      285,
      13,
      P.muted,
      MONO,
    );
  }
  held.forEach((m, i) => {
    const y = (inventory ? 255 : 231) + i * (inventory ? 26 : 26);
    image(ctx, s, `ore/${m.id}.png`, 240, y - 19, 24, 24);
    text(ctx, m.name, 275, y, 14, P.text);
    text(ctx, `${s.ore[m.id]} × ${m.weightKg} kg`, 410, y, 12, P.muted, MONO);
    if (!inventory)
      text(ctx, `${(s.ore[m.id] ?? 0) * m.value} Cr`, 750, y, 14, P.gold, MONO);
  });
}
function panel(ctx: Context, s: ReadState) {
  if (!s.panel) return;
  overlay(ctx);
  box(ctx, { x: 180, y: 96, w: 920, h: 550 }, "#112630f7", "#58717a", 10);
  const titles: Record<C.PanelId, string> = {
    "fuel-depot": "Fuel & field repairs",
    "ore-market": "Turn rock into possibility.",
    "upgrade-shop": "Build a better way down.",
    "supply-depot": "A little insurance.",
    "launch-pad": "Your ticket off this rock.",
    inventory: "Everything you carry.",
  };
  text(
    ctx,
    s.panel.replace(/-/g, " ").toUpperCase(),
    230,
    129,
    11,
    P.mint,
    MONO,
    "bold",
  );
  text(ctx, titles[s.panel], 230, 173, 32, P.text, SANS, "bold");
  line(ctx, 230, 190, 1050, 190);
  switch (s.panel) {
    case "fuel-depot":
      image(ctx, s, "icons/fuel.png", 265, 234, 44, 44);
      text(
        ctx,
        `${Math.ceil(s.miner.fuel)} / ${maxFuel(s)}`,
        330,
        267,
        30,
        P.gold,
        MONO,
        "bold",
      );
      text(ctx, `${C.FUEL_PRICE} Credit per fuel unit`, 260, 301, 15, P.muted);
      image(ctx, s, "icons/hull.png", 725, 234, 44, 44);
      text(
        ctx,
        `${Math.ceil(s.miner.hull)} / ${maxHull(s)}`,
        790,
        267,
        30,
        P.mint,
        MONO,
        "bold",
      );
      text(
        ctx,
        `${C.REPAIR_PRICE} Credits per hull point`,
        720,
        301,
        15,
        P.muted,
      );
      line(ctx, 640, 220, 640, 490);
      text(
        ctx,
        "Nothing refills for free. Leave enough for the climb.",
        260,
        517,
        15,
        P.muted,
      );
      break;
    case "ore-market": {
      cargoRows(ctx, s, false);
      const total = C.MINERALS.reduce(
        (n, m) => n + (s.ore[m.id] ?? 0) * m.value,
        0,
      );
      text(
        ctx,
        `${slots(s)} SLOTS  /  ${loadKg(s)} kg`,
        260,
        584,
        14,
        P.muted,
        MONO,
      );
      text(
        ctx,
        `HAUL VALUE   ${total.toLocaleString()} Cr`,
        665,
        529,
        20,
        P.gold,
        MONO,
        "bold",
      );
      break;
    }
    case "upgrade-shop":
      C.TRACKS.forEach((t, i) => {
        const y = 232 + i * 55;
        text(ctx, t.toUpperCase(), 240, y, 15, P.text, MONO, "bold");
        text(ctx, `${s.tiers[t]} / ${C.MAX_TIER[t]}`, 390, y, 14, P.gold, MONO);
        text(ctx, upgradeEffect(s, t), 480, y, 15, P.muted);
        line(ctx, 240, y + 19, 1030, y + 19, "#28434e");
      });
      break;
    case "supply-depot": {
      const descriptions = [
        "Clear a 3 × 3 block. Hidden gas still detonates.",
        "Clear a 5 × 5 block, including unbreakable stone.",
        "Return above camp. The landing is a gamble.",
        "Return safely to camp. No fall, no impact.",
        "Restore 20 hull in the field.",
        "Restore 30 fuel in the field.",
      ];
      C.ITEMS.forEach((it, i) => {
        const y = 233 + i * 65;
        pill(ctx, String(i + 1), 236, y, P.gold);
        text(ctx, it.name, 280, y - 3, 17, P.text, SANS, "bold");
        text(ctx, descriptions[i], 280, y + 19, 13, P.muted);
        text(ctx, `HELD ${s.items[it.id]}`, 755, y + 3, 11, P.mint, MONO);
      });
      break;
    }
    case "launch-pad":
      image(ctx, s, `rocket/stage${s.rocketInstalled}.png`, 240, 240, 240, 300);
      C.ROCKET_COMPONENTS.forEach((c, i) => {
        const y = 238 + i * 54;
        text(
          ctx,
          i < s.rocketInstalled ? "✓" : String(i + 1).padStart(2, "0"),
          570,
          y,
          18,
          i < s.rocketInstalled ? P.mint : P.gold,
          MONO,
        );
        text(
          ctx,
          c.name,
          610,
          y,
          18,
          i < s.rocketInstalled ? P.mint : P.text,
          SANS,
          "bold",
        );
        text(
          ctx,
          `${c.credits.toLocaleString()} Cr${c.material ? ` + ${c.material}` : ""}`,
          610,
          y + 21,
          13,
          P.muted,
          MONO,
        );
      });
      break;
    case "inventory":
      text(
        ctx,
        `${slots(s)} / ${slotCap(s)} SLOTS · ${loadKg(s)} / ${jetpack(s).liftLimitKg.toLocaleString()} kg LIFT`,
        240,
        222,
        13,
        loadKg(s) >= jetpack(s).liftLimitKg ? P.red : P.gold,
        MONO,
      );
      cargoRows(ctx, s, true);
      line(ctx, 690, 213, 690, 606);
      text(ctx, "FIELD SUPPLIES", 727, 218, 11, P.mint, MONO);
      C.ITEMS.forEach((it, i) => {
        text(
          ctx,
          `${i + 1}  ${it.name.length > 20 ? it.name.slice(0, 19) + "…" : it.name}`,
          727,
          261 + i * 43,
          13,
          s.items[it.id] ? P.text : P.muted,
        );
        text(ctx, `×${s.items[it.id]}`, 890, 261 + i * 43, 12, P.gold, MONO);
      });
      text(
        ctx,
        `RESONITE  ${s.satchel.resonite}   CRYENITE  ${s.satchel.cryenite}`,
        727,
        529,
        12,
        P.mint,
        MONO,
      );
      if (!s.satchel.coreSample)
        text(ctx, "Materials have no cargo weight.", 727, 570, 13, P.muted);
      break;
  }
  const panelControls = controls(s).filter((c) => c.y > C.HUD_H);
  panelControls.forEach((c) =>
    button(
      ctx,
      c,
      c.label,
      c.id !== "close" &&
        panelControls.filter((c) => c.id !== "close").indexOf(c) ===
          s.panelIndex,
      c.enabled,
    ),
  );
  text(
    ctx,
    `${s.credits.toLocaleString(undefined, { maximumFractionDigits: 0 })} Cr AVAILABLE`,
    230,
    625,
    12,
    P.gold,
    MONO,
  );
  text(
    ctx,
    "↑ ↓ SELECT   ENTER CONFIRM   ESC CLOSE",
    690,
    625,
    11,
    P.muted,
    MONO,
  );
}
function worldInterface(ctx: Context, s: ReadState) {
  const d = depth(s),
    b =
      d <= 0
        ? "SURFACE OUTPOST"
        : (
            tileAt(
              s,
              Math.floor((s.miner.x + C.MINER_W / 2) / C.TILE),
              Math.max(1, Math.floor((s.miner.y + C.MINER_H / 2) / C.TILE)),
            ).band ?? "coreshell"
          ).toUpperCase();
  pill(ctx, b, 24, 88, P.mint);
  text(
    ctx,
    `ESCAPE ROCKET  ${s.rocketInstalled} / 5`,
    24,
    119,
    11,
    P.muted,
    MONO,
  );
  if (d === 0)
    text(ctx, "Make a living. Build a way home.", 24, 140, 13, P.muted);
  const scan = scanner(s);
  if (scan.locked) {
    box(ctx, { x: 958, y: 78, w: 298, h: 65 }, "#112936dd", "#47746c", 5);
    const angle = Math.atan2(scan.dirY, scan.dirX);
    ctx.save();
    ctx.translate(987, 110);
    ctx.rotate(angle);
    text(ctx, "➤", -10, 7, 25, P.mint);
    ctx.restore();
    text(
      ctx,
      `${scan.target?.toUpperCase()} LOCK`,
      1016,
      103,
      12,
      P.mint,
      MONO,
    );
    text(
      ctx,
      `${scan.distanceTiles?.toFixed(1)} tiles`,
      1016,
      125,
      15,
      P.text,
      MONO,
    );
  }
  if (s.satchel.coreSample) {
    box(ctx, { x: 435, y: 77, w: 410, h: 72 }, "#3b2928ed", "#dd9964", 5);
    image(ctx, s, "icons/core-sample.png", 455, 99, 30, 30);
    text(
      ctx,
      `CORE UNSTABLE  ${Math.ceil(s.coreTimer ?? 0)}s`,
      502,
      110,
      22,
      P.gold,
      MONO,
      "bold",
    );
    text(ctx, "REACH THE PAD  /  J TO JETTISON", 502, 131, 10, P.red, MONO);
  }
  const nearby = nearbyBuilding(s);
  if (nearby && !s.panel) {
    const x = clamp(nearby.x + nearby.w / 2 - s.camera.x - 130, 20, 1000),
      y = nearby.y - s.camera.y + C.HUD_H - 65;
    button(
      ctx,
      { x, y, w: 260, h: 38 },
      `E  ${nearby.id === "save-pad" ? "SAVE EXPEDITION" : "OPEN " + nearby.id.replace(/-/g, " ").toUpperCase()}`,
      false,
      true,
    );
  }
  if (s.notice && s.notice.age >= C.NOTICE_DELAY && !s.panel) {
    const gas = s.notice.hazard === "gas";
    box(ctx, { x: 280, y: 548, w: 720, h: 105 }, "#17313bef", "#7e6c51", 8);
    text(
      ctx,
      gas ? "VOLATILE GAS / WATCH THE WISPS" : "MOLTEN ROCK / MIND THE HEAT",
      305,
      579,
      14,
      P.gold,
      MONO,
      "bold",
    );
    text(
      ctx,
      gas
        ? "Faint gas wisps reveal hidden pockets. Deep blasts hit harder."
        : "Touching lava burns hull. Drilling through it costs a larger burst.",
      305,
      607,
      15,
      P.text,
    );
    text(
      ctx,
      gas
        ? "Upgrade your hull before descending. Click to dismiss."
        : "Upgrade the radiator or route around the pool. Click to dismiss.",
      305,
      631,
      13,
      P.muted,
    );
  }
  ctx.fillStyle = "#0b1c26dd";
  ctx.fillRect(0, 678, 1280, 42);
  line(ctx, 0, 678, 1280, 678, "#2d4651");
  text(ctx, "A D  MOVE / CUT", 25, 704, 11, P.muted, MONO);
  text(ctx, "S ↓  DRILL", 215, 704, 11, P.gold, MONO);
  text(ctx, "W ↑ SPACE  JETPACK", 365, 704, 11, P.mint, MONO);
  text(ctx, "E  INTERACT", 602, 704, 11, P.muted, MONO);
  text(ctx, "I  CARGO", 772, 704, 11, P.muted, MONO);
  text(ctx, "1—6  SUPPLIES", 920, 704, 11, P.muted, MONO);
  text(
    ctx,
    `${s.mode.toUpperCase()} / ${s.worldSize.toUpperCase()}`,
    1090,
    704,
    10,
    "#647f89",
    MONO,
  );
}
export function render(s: ReadState, api: RenderApi) {
  const ctx = api.ctx;
  ctx.imageSmoothingEnabled = false;
  if (s.screen === "title") menus(ctx, s);
  else {
    world(ctx, s);
    hud(ctx, s);
    if (s.screen === "in-mine") {
      worldInterface(ctx, s);
      panel(ctx, s);
    } else menus(ctx, s);
  }
  if (s.noteTime > 0 && s.screen === "in-mine") {
    const w = Math.min(1050, Math.max(420, s.note.length * 7.2 + 40));
    box(
      ctx,
      { x: (1280 - w) / 2, y: 638, w, h: 31 },
      "#102832ef",
      "#42606a",
      4,
    );
    text(ctx, s.note, (1280 - w) / 2 + 18, 659, 12, P.text, MONO);
  }
}
