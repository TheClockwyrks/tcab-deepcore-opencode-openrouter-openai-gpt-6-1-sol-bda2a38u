import * as C from "./constants";
import {
  type ReadState,
  type DeepcoreState,
  type Rect,
  slots,
  maxFuel,
  maxHull,
  note,
} from "./state";
import { nearbyBuilding } from "./world";
import * as R from "./rules";

export function menuItems(s: ReadState): readonly string[] {
  switch (s.screen) {
    case "title":
      return s.hasSave ? C.TITLE_ITEMS : C.TITLE_ITEMS.slice(1);
    case "mode-select":
      return C.MODE_ITEMS;
    case "size-select":
      return C.SIZE_ITEMS;
    case "how-to-play":
      return C.HOW_TO_PLAY_ITEMS;
    case "paused":
      return C.PAUSE_ITEMS;
    case "victory":
      return C.VICTORY_ITEMS;
    case "game-over":
      return s.mode === "standard" && s.hasSave
        ? C.GAME_OVER_SAVE_ITEMS
        : C.GAME_OVER_ITEMS;
    default:
      return [];
  }
}
export function menuItemRect(s: ReadState, index: number): Rect | null {
  if (index < 0 || index >= menuItems(s).length) return null;
  if (s.screen === "title")
    return { x: 76, y: 395 + index * 64, w: 365, h: 52 };
  if (s.screen === "how-to-play") return { x: 230, y: 615, w: 820, h: 48 };
  return { x: 330, y: 300 + index * 76, w: 620, h: 62 };
}
export interface Control extends Rect {
  id: string;
  subject: string | null;
  label: string;
  enabled: boolean;
}
export function controls(s: ReadState): Control[] {
  const all: Control[] = [];
  const add = (
    id: string,
    subject: string | null,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    enabled = true,
  ) => all.push({ id, subject, label, x, y, w, h, enabled });
  if (s.screen !== "in-mine") return all;
  add("inventory", null, "I · CARGO", 1080, 10, 90, 36);
  add("pause", null, "Ⅱ", 1178, 10, 36, 36);
  add("mute", null, s.muted ? "×♪" : "♪", 1222, 10, 40, 36);
  if (s.notice && s.notice.age >= C.NOTICE_DELAY && !s.panel)
    add("dismiss-notice", null, "DISMISS", 280, 548, 720, 105);
  if (s.panel) add("close", null, "ESC  ×", 1000, 108, 88, 40);
  switch (s.panel) {
    case "fuel-depot":
      add(
        "buy-fuel",
        null,
        `+ ${C.FUEL_BUY_INCREMENT} FUEL`,
        260,
        330,
        300,
        50,
        s.miner.fuel < maxFuel(s) && s.credits > 0,
      );
      add(
        "fill-fuel",
        null,
        "FILL TANK",
        260,
        397,
        300,
        50,
        s.miner.fuel < maxFuel(s) && s.credits > 0,
      );
      add(
        "buy-repair",
        null,
        `+ ${C.REPAIR_BUY_INCREMENT} HULL`,
        720,
        330,
        300,
        50,
        s.miner.hull < maxHull(s) && s.credits > 0,
      );
      add(
        "repair-full",
        null,
        "FULL REPAIR",
        720,
        397,
        300,
        50,
        s.miner.hull < maxHull(s) && s.credits > 0,
      );
      break;
    case "ore-market":
      add("sell", null, C.SELL, 770, 548, 260, 54, slots(s) > 0);
      break;
    case "upgrade-shop":
      C.TRACKS.forEach((t, i) =>
        add(
          "buy-upgrade",
          t,
          s.tiers[t] >= C.MAX_TIER[t]
            ? "MAXED"
            : `${C.UPGRADE_PRICES[s.tiers[t] - 1].toLocaleString()} Cr  →`,
          853,
          205 + i * 55,
          174,
          40,
          s.tiers[t] < C.MAX_TIER[t] &&
            s.credits >= C.UPGRADE_PRICES[s.tiers[t] - 1],
        ),
      );
      break;
    case "supply-depot":
      C.ITEMS.forEach((it, i) =>
        add(
          "buy-item",
          it.id,
          `${it.price.toLocaleString()} Cr  +`,
          853,
          210 + i * 65,
          174,
          45,
          s.credits >= it.price,
        ),
      );
      break;
    case "launch-pad":
      add(
        s.rocketInstalled === C.ROCKET_COMPONENTS.length
          ? "launch"
          : "fabricate",
        null,
        s.rocketInstalled === C.ROCKET_COMPONENTS.length
          ? C.LAUNCH
          : C.FABRICATE,
        730,
        550,
        300,
        54,
        s.rocketInstalled === C.ROCKET_COMPONENTS.length || R.canFabricate(s),
      );
      break;
    case "inventory": {
      C.MINERALS.filter((m) => (s.ore[m.id] ?? 0) > 0).forEach((m, i) =>
        add("drop-ore", m.id, "DROP  −1", 555, 242 + i * 26, 100, 23),
      );
      C.ITEMS.forEach((it, i) => {
        if (s.items[it.id])
          add("use-item", it.id, C.USE, 944, 240 + i * 43, 80, 30);
      });
      if (s.satchel.coreSample)
        add("jettison", null, C.JETTISON, 727, 552, 296, 44);
      break;
    }
  }
  return all;
}
export function controlRect(
  s: ReadState,
  id: string,
  subject: string | null,
): Rect | null {
  const c = controls(s).find((c) => c.id === id && c.subject === subject);
  return c ? { x: c.x, y: c.y, w: c.w, h: c.h } : null;
}
export function act(s: DeepcoreState, id: string, subject: string | null) {
  switch (id) {
    case "close":
      s.panel = null;
      break;
    case "inventory":
      s.panel = s.panel === "inventory" ? null : "inventory";
      s.panelIndex = 0;
      break;
    case "pause":
      s.screen = "paused";
      s.menuIndex = 0;
      break;
    case "mute":
      s.muted = !s.muted;
      break;
    case "dismiss-notice":
      s.notice = null;
      break;
    case "drop-ore": {
      const ore = subject as C.OreId;
      if (s.ore[ore]) {
        s.ore[ore]!--;
        if (!s.ore[ore]) delete s.ore[ore];
        note(s, "One ore unit discarded.");
      }
      break;
    }
    case "sell":
      R.sell(s);
      break;
    case "buy-fuel":
      R.buyResource(s, "fuel", false);
      break;
    case "fill-fuel":
      R.buyResource(s, "fuel", true);
      break;
    case "buy-repair":
      R.buyResource(s, "hull", false);
      break;
    case "repair-full":
      R.buyResource(s, "hull", true);
      break;
    case "buy-upgrade":
      R.buyUpgrade(s, subject as C.TrackName);
      break;
    case "buy-item":
      R.buyItem(s, subject as C.ItemId);
      break;
    case "use-item":
      R.useItem(s, subject as C.ItemId);
      break;
    case "jettison":
      R.jettison(s);
      break;
    case "fabricate":
      R.fabricate(s);
      break;
    case "launch":
      R.launch(s);
      break;
  }
}
export function activateBuilding(s: DeepcoreState) {
  const building = nearbyBuilding(s);
  if (!building) return;
  if (building.id === "save-pad") R.save(s);
  else {
    s.panel = building.id;
    s.panelIndex = 0;
  }
}
function goTitle(s: DeepcoreState, how = false) {
  s.screen = "title";
  s.panel = null;
  s.menuIndex = menuItems(s).indexOf(how ? "HOW TO PLAY" : "NEW EXPEDITION");
}
export function back(s: DeepcoreState) {
  switch (s.screen) {
    case "in-mine":
      if (s.panel) s.panel = null;
      else {
        s.screen = "paused";
        s.menuIndex = 0;
      }
      break;
    case "paused":
      s.screen = "in-mine";
      s.menuIndex = 0;
      break;
    case "size-select":
      s.screen = "mode-select";
      s.menuIndex = C.MODES.indexOf(s.mode);
      break;
    case "how-to-play":
      goTitle(s, true);
      break;
    case "mode-select":
      goTitle(s);
      break;
  }
}
export function choose(s: DeepcoreState) {
  const item = menuItems(s)[s.menuIndex];
  switch (item) {
    case "CONTINUE":
    case "CONTINUE FROM SAVE":
      R.restore(s);
      break;
    case "NEW EXPEDITION":
      s.screen = "mode-select";
      s.menuIndex = 0;
      break;
    case "HOW TO PLAY":
      s.screen = "how-to-play";
      s.menuIndex = 0;
      break;
    case "STANDARD":
    case "HARDCORE":
      if (s.screen === "mode-select") {
        s.mode = item === "STANDARD" ? "standard" : "hardcore";
        s.screen = "size-select";
        s.menuIndex = 0;
      } else {
        s.worldSize = "standard";
        R.start(s);
      }
      break;
    case "QUICK":
      s.worldSize = "quick";
      R.start(s);
      break;
    case "MARATHON":
      s.worldSize = "marathon";
      R.start(s);
      break;
    case "BACK":
      back(s);
      break;
    case "RESUME":
      s.screen = "in-mine";
      s.menuIndex = 0;
      break;
    case "RESTART":
    case "PLAY AGAIN":
      R.start(s);
      break;
    case "QUIT TO MENU":
    case "MENU":
      goTitle(s);
      break;
  }
}
export const inside = (r: Rect, p: { x: number; y: number }) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
