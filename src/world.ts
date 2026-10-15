import * as C from "./constants";
import {
  type Cell,
  type DeepcoreState,
  type ReadState,
  type Point,
  clamp,
  minable,
} from "./state";

export const fraction = (row: number, coreRow: number) =>
  (row - 1) / (coreRow - 1);
export const bandAt = (row: number, coreRow: number) =>
  C.BANDS[Math.min(3, Math.max(0, Math.floor(4 * fraction(row, coreRow))))];
export function cell(kind: C.TileKind, band: C.BandName | null): Cell {
  const health = minable(kind) && band ? C.BAND_HEALTH[band] : null;
  return { kind, band, ore: null, material: null, health, maxHealth: health };
}
const outside = cell("bedrock", null);
export function tileAt(s: ReadState, col: number, row: number): Cell {
  if (col < 0 || col >= C.WORLD_COLS || row > s.coreRow) return outside;
  if (row <= 0) return cell("tunnel", null);
  return (s.tiles[row * C.WORLD_COLS + col] as Cell) ?? outside;
}
export function put(s: DeepcoreState, col: number, row: number, value: Cell) {
  s.tiles[row * C.WORLD_COLS + col] = value;
}
export function emptyMine(coreRow: number): Cell[] {
  return Array.from({ length: (coreRow + 1) * C.WORLD_COLS }, (_, i) => {
    const row = Math.floor(i / C.WORLD_COLS),
      col = i % C.WORLD_COLS;
    if (!row) return cell("tunnel", null);
    if (row === coreRow)
      return cell(col === C.CORE_COL ? "core" : "bedrock", null);
    return cell(
      col === 0 || col === C.WORLD_COLS - 1 ? "bedrock" : "tunnel",
      bandAt(row, coreRow),
    );
  });
}
/** Empty playable terrain without rewriting the border, chamber or cell bands. */
export function clearMine(s: DeepcoreState) {
  for (let row = 1; row < s.coreRow; row++) {
    for (let col = C.PLAYABLE_COL_MIN; col <= C.PLAYABLE_COL_MAX; col++) {
      put(s, col, row, cell("tunnel", tileAt(s, col, row).band));
    }
  }
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickOre(f: number): C.OreId {
  const weights = C.MINERALS.map(
    (m) => m.pick * Math.max(0, 1 - Math.abs(f - m.peak) / m.spread),
  );
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return C.MINERALS[i].id;
  }
  return C.ORE_IDS[0];
}
export function generate(s: DeepcoreState) {
  s.tiles = emptyMine(s.coreRow);
  const nodes: (Point & { material: C.MaterialId })[] = C.MATERIALS.map(
    (material, i) => ({
      material,
      col:
        C.PLAYABLE_COL_MIN +
        Math.floor(
          Math.random() * (C.PLAYABLE_COL_MAX - C.PLAYABLE_COL_MIN + 1),
        ),
      row: Math.floor(s.coreRow * ((i + 1) / 4 + 0.03 + Math.random() * 0.19)),
    }),
  );
  // A reserved diggable spine and connectors guarantee all three prizes are reachable.
  const protectedCell = (col: number, row: number) =>
    col === C.CAVE_MOUTH_COL ||
    (row === s.coreRow - 1 && col >= C.CORE_COL && col <= C.CAVE_MOUTH_COL) ||
    nodes.some(
      (n) =>
        row === n.row &&
        col >= Math.min(n.col, C.CAVE_MOUTH_COL) &&
        col <= Math.max(n.col, C.CAVE_MOUTH_COL),
    );
  for (let b = 0; b < C.BANDS.length; b++) {
    const candidates: Point[] = [];
    for (let row = 1; row < s.coreRow; row++)
      if (bandAt(row, s.coreRow) === C.BANDS[b]) {
        for (let col = C.PLAYABLE_COL_MIN; col <= C.PLAYABLE_COL_MAX; col++) {
          put(s, col, row, cell("rock", C.BANDS[b]));
          if (!protectedCell(col, row)) candidates.push({ col, row });
        }
      }
    shuffle(candidates);
    const total = Math.round(candidates.length / (1 - 1 / 30));
    const avgF = (b + 0.5) / 4;
    const stone = b
      ? Math.round(
          total *
            (C.STONE_DENSITY_MIN +
              ((C.STONE_DENSITY_MAX - C.STONE_DENSITY_MIN) * (avgF - 0.25)) /
                0.75),
        )
      : 0;
    const gas = b
      ? Math.round(
          total *
            (C.GAS_DENSITY_MIN +
              ((C.GAS_DENSITY_MAX - C.GAS_DENSITY_MIN) * (avgF - 0.25)) / 0.75),
        )
      : 0;
    const lava =
      b >= 2
        ? Math.round(
            total *
              (C.LAVA_DENSITY_MIN +
                ((C.LAVA_DENSITY_MAX - C.LAVA_DENSITY_MIN) * (avgF - 0.5)) /
                  0.5),
          )
        : 0;
    // Growing small polyominoes creates lava pools, rather than isolated hot pixels.
    let made = 0;
    for (const seed of candidates) {
      if (made >= lava) break;
      const frontier = [seed];
      let pool = 0;
      while (frontier.length && pool < 7 && made < lava) {
        const p = frontier.shift()!;
        if (
          p.col < 1 ||
          p.col > C.PLAYABLE_COL_MAX ||
          p.row < 1 ||
          p.row >= s.coreRow ||
          protectedCell(p.col, p.row) ||
          bandAt(p.row, s.coreRow) !== C.BANDS[b] ||
          tileAt(s, p.col, p.row).kind !== "rock"
        )
          continue;
        put(s, p.col, p.row, cell("lava", C.BANDS[b]));
        made++;
        pool++;
        frontier.push(
          ...shuffle([
            { col: p.col + 1, row: p.row },
            { col: p.col - 1, row: p.row },
            { col: p.col, row: p.row + 1 },
          ]),
        );
      }
    }
    let stones = 0,
      gases = 0;
    for (const p of candidates) {
      if (tileAt(s, p.col, p.row).kind !== "rock") continue;
      if (stones < stone) {
        put(s, p.col, p.row, cell("stone", C.BANDS[b]));
        stones++;
      } else if (gases < gas) {
        put(s, p.col, p.row, cell("gas", C.BANDS[b]));
        gases++;
      }
    }
    const oreCells: Point[] = [];
    for (let row = C.ORE_MIN_ROW; row < s.coreRow; row++)
      if (bandAt(row, s.coreRow) === C.BANDS[b])
        for (let col = C.PLAYABLE_COL_MIN; col <= C.PLAYABLE_COL_MAX; col++)
          if (tileAt(s, col, row).kind === "rock") oreCells.push({ col, row });
    shuffle(oreCells);
    for (const p of oreCells.slice(0, Math.round(total * C.ORE_DENSITY))) {
      put(s, p.col, p.row, {
        ...cell("ore", C.BANDS[b]),
        ore: pickOre(fraction(p.row, s.coreRow)),
      });
    }
  }
  for (const n of nodes)
    put(s, n.col, n.row, {
      ...cell("material", bandAt(n.row, s.coreRow)),
      material: n.material,
    });
  put(s, C.CAVE_MOUTH_COL, 1, cell("tunnel", "topsoil"));
}

export function grounded(s: ReadState): boolean {
  if (s.miner.drilling?.dir === "down") return true;
  const feet = s.miner.y + C.MINER_H;
  const row = Math.floor((feet + 0.5) / C.TILE);
  if (Math.abs(feet - row * C.TILE) > 1) return false;
  return [s.miner.x + 1, s.miner.x + C.MINER_W - 1].some(
    (x) => tileAt(s, Math.floor(x / C.TILE), row).kind !== "tunnel",
  );
}
export const buildings = C.BUILDINGS.map((id, i) => ({
  id,
  x: [115, 435, 755, 1010, 1325, 1680][i],
  y: C.SURFACE_Y - [180, 180, 180, 180, 180, 260][i],
  w: 240,
  h: [180, 180, 180, 180, 180, 260][i],
}));
export function nearbyBuilding(s: ReadState) {
  if (s.miner.y + C.MINER_H > C.SURFACE_Y + 1) return null;
  const x = s.miner.x + C.MINER_W / 2;
  return buildings.find((b) => x >= b.x - 15 && x <= b.x + b.w + 15) ?? null;
}
export function camera(s: DeepcoreState, dt: number) {
  const vy = s.miner.vy;
  const target =
    Math.abs(vy) <= C.CAM_STILL_SPEED ? 0 : Math.sign(vy) * C.CAM_LEAD_MAX;
  let left = dt;
  const rate = C.CAM_LEAD_MAX / C.CAM_LEAD_RAMP;
  if (s.camera.lead * target < 0) {
    const used = Math.min(
      left,
      Math.abs(s.camera.lead) / (rate * C.CAM_UNWIND_MULT),
    );
    s.camera.lead -= Math.sign(s.camera.lead) * used * rate * C.CAM_UNWIND_MULT;
    left -= used;
  }
  const diff = target - s.camera.lead;
  s.camera.lead +=
    Math.sign(diff) *
    Math.min(
      Math.abs(diff),
      left * rate * (target === 0 ? C.CAM_UNWIND_MULT : 1),
    );
  s.camera.x = clamp(
    s.miner.x + C.MINER_W / 2 - C.VIEW_W / 2,
    0,
    C.WORLD_W - C.VIEW_W,
  );
  s.camera.y = Math.min(
    s.miner.y + C.MINER_H / 2 - C.VIEW_H / 2 + s.camera.lead,
    (s.coreRow + 1) * C.TILE - C.VIEW_H,
  );
}
