import * as C from "./constants";
import { type ReadState, type DeepcoreState, maxFuel, maxHull } from "./state";
import { buildings, cell, tileAt, put, clearMine, generate } from "./world";
import { snapshot } from "./readings";
import { menuItemRect, controlRect, menuItems, act } from "./interface";
import * as R from "./rules";

function valid(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RangeError(`Deepcore: ${message}`);
}
const number = (v: number, min = 0, max = Infinity) =>
  valid(Number.isFinite(v) && v >= min && v <= max, "number outside domain");
const integer = (v: number, min = 0, max = Infinity) => {
  number(v, min, max);
  valid(Number.isInteger(v), "expected integer");
};
function member<T extends string>(value: T, values: readonly T[]) {
  valid(values.includes(value), "unknown identifier");
}
function coordinate(s: ReadState, col: number, row: number) {
  integer(col, 0, C.WORLD_COLS - 1);
  integer(row, 1, s.coreRow);
}
type Mutator = (s: DeepcoreState) => void;
const change = (s: ReadState, fn: Mutator) => R.transition(s, fn);
const ore = (o: C.OreId) =>
  member(
    o,
    C.MINERALS.map((m) => m.id),
  );

export function createDebug() {
  return {
    version: C.DEEPCORE_DEBUG_VERSION,
    snapshot,
    tileAt: (s: ReadState, col: number, row: number) => {
      integer(col, -Infinity);
      integer(row, -Infinity);
      return { ...tileAt(s, col, row) };
    },
    findTile: (s: ReadState, kind: C.TileKind) => {
      member(kind, C.TILE_KINDS);
      let found: { col: number; row: number } | null = null,
        best = Infinity;
      for (let i = C.WORLD_COLS; i < s.tiles.length; i++)
        if (s.tiles[i].kind === kind) {
          const col = i % C.WORLD_COLS,
            row = Math.floor(i / C.WORLD_COLS),
            d = Math.hypot(
              (col + 0.5) * C.TILE - s.miner.x - C.MINER_W / 2,
              (row + 0.5) * C.TILE - s.miner.y - C.MINER_H / 2,
            );
          if (d < best) {
            best = d;
            found = { col, row };
          }
        }
      return found;
    },
    buildings: (_s: ReadState) => buildings.map((b) => ({ ...b })),
    menuItemRect,
    controlRect,
    reset: R.reset,
    reconcile: (s: ReadState) => change(s, () => {}),
    generateMine: (s: ReadState) => change(s, generate),
    clearMine: (s: ReadState) => change(s, clearMine),
    clearCargo: (s: ReadState) =>
      change(s, (n) => {
        n.ore = {};
      }),
    clearItems: (s: ReadState) =>
      change(s, (n) => {
        for (const it of C.ITEM_IDS) n.items[it] = 0;
      }),
    setTile: (s: ReadState, col: number, row: number, kind: C.TileKind) => {
      coordinate(s, col, row);
      member(
        kind,
        C.TILE_KINDS.filter((k) => k !== "ore" && k !== "material"),
      );
      return change(s, (n) =>
        put(n, col, row, cell(kind, tileAt(n, col, row).band)),
      );
    },
    setOreTile: (s: ReadState, col: number, row: number, id: C.OreId) => {
      coordinate(s, col, row);
      ore(id);
      return change(s, (n) =>
        put(n, col, row, {
          ...cell("ore", tileAt(n, col, row).band ?? "coreshell"),
          ore: id,
        }),
      );
    },
    setMaterialTile: (
      s: ReadState,
      col: number,
      row: number,
      material: C.MaterialId,
    ) => {
      coordinate(s, col, row);
      member(material, C.MATERIALS);
      return change(s, (n) =>
        put(n, col, row, {
          ...cell("material", tileAt(n, col, row).band ?? "coreshell"),
          material,
        }),
      );
    },
    setTileHealth: (s: ReadState, col: number, row: number, health: number) => {
      coordinate(s, col, row);
      const t = tileAt(s, col, row);
      valid(
        t.health !== null && health > 0 && health <= t.maxHealth!,
        "invalid minable health",
      );
      return change(s, (n) => put(n, col, row, { ...t, health }));
    },
    placeCoreSample: (s: ReadState, col: number, row: number) => {
      coordinate(s, col, row);
      valid(
        tileAt(s, col, row).kind === "tunnel" && s.coreTimer === null,
        "Sample requires open cell and no live Sample",
      );
      return change(s, (n) => {
        n.coreGround = { col, row };
        n.coreTimer = C.CORE_TIMER;
      });
    },
    setMinerPosition: (s: ReadState, x: number, y: number) => {
      number(x, -Infinity);
      number(y, -Infinity);
      return change(s, (n) => {
        n.miner.x = x;
        n.miner.y = y;
      });
    },
    setMinerVelocity: (s: ReadState, vx: number, vy: number) => {
      number(vx, -Infinity);
      number(vy, -Infinity);
      return change(s, (n) => {
        n.miner.vx = vx;
        n.miner.vy = vy;
      });
    },
    setFacing: (s: ReadState, facing: C.Facing) => {
      member(facing, C.FACINGS);
      return change(s, (n) => {
        n.miner.facing = facing;
      });
    },
    setFuel: (s: ReadState, value: number) => {
      number(value);
      return change(s, (n) => {
        n.miner.fuel = value;
      });
    },
    setHull: (s: ReadState, value: number) => {
      number(value);
      return change(s, (n) => {
        n.miner.hull = value;
      });
    },
    setMinerTravel: (s: ReadState, enabled: boolean) => {
      valid(typeof enabled === "boolean", "expected boolean");
      return change(s, (n) => {
        n.miner.travel = enabled;
      });
    },
    setMinerDrill: (s: ReadState, enabled: boolean) => {
      valid(typeof enabled === "boolean", "expected boolean");
      return change(s, (n) => {
        n.miner.drill = enabled;
      });
    },
    setScreen: (s: ReadState, screen: C.ScreenName) => {
      member(screen, C.SCREENS);
      return change(s, (n) => {
        n.screen = screen;
      });
    },
    setPanel: (s: ReadState, panel: C.PanelId | null) => {
      if (panel !== null) member(panel, C.PANELS);
      return change(s, (n) => {
        n.panel = panel;
      });
    },
    setMenuIndex: (s: ReadState, index: number) => {
      integer(index, 0, menuItems(s).length - 1);
      return change(s, (n) => {
        n.menuIndex = index;
      });
    },
    setMode: (s: ReadState, mode: C.Mode) => {
      member(mode, C.MODES);
      return change(s, (n) => {
        n.mode = mode;
      });
    },
    setWorldSize: (s: ReadState, size: C.WorldSize) => {
      member(size, C.WORLD_SIZES);
      return change(s, (n) => R.resize(n, size));
    },
    setCredits: (s: ReadState, value: number) => {
      number(value);
      return change(s, (n) => {
        n.credits = value;
      });
    },
    setTier: (s: ReadState, track: C.TrackName, tier: number) => {
      member(track, C.TRACKS);
      integer(tier, 1, C.MAX_TIER[track]);
      return change(s, (n) => {
        n.tiers[track] = tier;
        n.miner.fuel = Math.min(n.miner.fuel, maxFuel(n));
        n.miner.hull = Math.min(n.miner.hull, maxHull(n));
      });
    },
    setCargo: (s: ReadState, id: C.OreId, count: number) => {
      ore(id);
      integer(count);
      return change(s, (n) => {
        if (count) n.ore[id] = count;
        else delete n.ore[id];
      });
    },
    setMaterial: (s: ReadState, material: C.MaterialId, count: number) => {
      member(material, C.MATERIALS);
      integer(count);
      return change(s, (n) => {
        n.satchel[material] = count;
      });
    },
    setCoreCarried: (s: ReadState, carried: boolean) => {
      valid(typeof carried === "boolean", "expected boolean");
      if (carried) valid(s.coreTimer === null, "Sample already live");
      return change(s, (n) => {
        n.satchel.coreSample = carried;
        if (carried) n.coreTimer = C.CORE_TIMER;
        else if (!n.coreGround) n.coreTimer = null;
      });
    },
    setCoreTimer: (s: ReadState, seconds: number) => {
      number(seconds);
      valid(
        seconds > 0 && s.coreTimer !== null,
        "requires live Sample and positive time",
      );
      return change(s, (n) => {
        n.coreTimer = seconds;
      });
    },
    setItemCount: (s: ReadState, item: C.ItemId, count: number) => {
      member(item, C.ITEM_IDS);
      integer(count);
      return change(s, (n) => {
        n.items[item] = count;
      });
    },
    setRocketInstalled: (s: ReadState, count: number) => {
      integer(count, 0, C.ROCKET_COMPONENTS.length);
      return change(s, (n) => {
        n.rocketInstalled = count;
      });
    },
    setNoticeFired: (s: ReadState, hazard: C.NoticeHazard, fired: boolean) => {
      member(hazard, C.NOTICE_HAZARDS);
      valid(typeof fired === "boolean", "expected boolean");
      return change(s, (n) => {
        n.noticesFired[hazard] = fired;
      });
    },
    setCameraLead: (s: ReadState, lead: number) => {
      number(lead, -C.CAM_LEAD_MAX, C.CAM_LEAD_MAX);
      return change(s, (n) => {
        n.camera.lead = lead;
      });
    },
    setElapsed: (s: ReadState, seconds: number) => {
      number(seconds);
      return change(s, (n) => {
        n.elapsedSeconds = seconds;
      });
    },
    clearSave: (s: ReadState) => change(s, R.clearSave),
    setNextTeleportHeight: (s: ReadState, tiles: number | null) => {
      if (tiles !== null)
        number(tiles, C.TELEPORT_HEIGHT_TILES_MIN, C.TELEPORT_HEIGHT_TILES_MAX);
      return change(s, (n) => {
        n.nextTeleportHeight = tiles;
      });
    },
    setNextTeleportSpeed: (s: ReadState, speed: number | null) => {
      if (speed !== null)
        number(speed, C.TELEPORT_SPEED_MIN, C.TELEPORT_SPEED_MAX);
      return change(s, (n) => {
        n.nextTeleportSpeed = speed;
      });
    },
    dropOre: (s: ReadState, id: C.OreId) => {
      ore(id);
      return change(s, (n) => act(n, "drop-ore", id));
    },
    sell: (s: ReadState) => change(s, R.sell),
    buyFuel: (s: ReadState) =>
      change(s, (n) => R.buyResource(n, "fuel", false)),
    fillFuel: (s: ReadState) =>
      change(s, (n) => R.buyResource(n, "fuel", true)),
    buyRepair: (s: ReadState) =>
      change(s, (n) => R.buyResource(n, "hull", false)),
    repairFull: (s: ReadState) =>
      change(s, (n) => R.buyResource(n, "hull", true)),
    buyUpgrade: (s: ReadState, track: C.TrackName) => {
      member(track, C.TRACKS);
      return change(s, (n) => R.buyUpgrade(n, track));
    },
    buyItem: (s: ReadState, item: C.ItemId) => {
      member(item, C.ITEM_IDS);
      return change(s, (n) => R.buyItem(n, item));
    },
    useItem: (s: ReadState, item: C.ItemId) => {
      member(item, C.ITEM_IDS);
      return change(s, (n) => R.useItem(n, item));
    },
    jettison: (s: ReadState) => change(s, R.jettison),
    fabricate: (s: ReadState) => change(s, R.fabricate),
    launch: (s: ReadState) => change(s, R.launch),
    save: (s: ReadState) => change(s, R.save),
    dismissNotice: (s: ReadState) =>
      change(s, (n) => {
        n.notice = null;
      }),
  };
}
export type DeepcoreDebugApi = ReturnType<typeof createDebug>;
