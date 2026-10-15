import type { Game, UpdateApi } from "@clockwyrks/simple-2d";
import type { DeepcoreState, ReadState, Resources } from "./state";
import { draft, emptyState } from "./state";
import { createDebug, type DeepcoreDebugApi } from "./debug";
import * as C from "./constants";
import { readSave, useItem, jettison, checkDeath } from "./rules";
import { emptyMine, nearbyBuilding } from "./world";
import { snapshot } from "./readings";
import {
  act,
  activateBuilding,
  back,
  choose,
  controls,
  inside,
  menuItemRect,
  menuItems,
} from "./interface";
import { STEP, step } from "./simulation";
import { render } from "./render";
import { assetPath } from "./asset-path";

export type { DeepcoreState, DeepcoreDebugApi };
export const BACKGROUND = "#0b1720";

// Vite emits these committed files. The engine remains the only runtime loader.
const urls = import.meta.glob<string>("../assets/**/*.{png,json,wav}", {
  eager: true,
  query: "?url&no-inline",
  import: "default",
});

function pointer(s: DeepcoreState, api: UpdateApi) {
  for (const sample of api.input.pointerSamples()) {
    const menu = menuItems(s);
    let region: string | null = null;
    for (let i = 0; i < menu.length; i++) {
      const r = menuItemRect(s, i);
      if (r && inside(r, sample)) {
        region = `menu:${i}`;
        if (sample.type !== "up") s.menuIndex = i;
      }
    }
    if (s.screen === "in-mine") {
      const list = controls(s);
      for (let i = 0; i < list.length; i++)
        if (list[i].enabled && inside(list[i], sample)) {
          region = `control:${list[i].id}:${list[i].subject ?? ""}`;
          if (sample.type === "move" && s.panel)
            s.panelIndex = list
              .filter((c) => c.y > C.HUD_H && c.id !== "close")
              .indexOf(list[i]);
        }
      if (!s.panel && sample.type === "down") {
        const b = nearbyBuilding(s);
        if (
          b &&
          inside(
            {
              x: b.x - s.camera.x,
              y: b.y - s.camera.y + C.HUD_H,
              w: b.w,
              h: b.h,
            },
            sample,
          )
        )
          activateBuilding(s);
      }
      if (
        sample.type === "down" &&
        s.notice &&
        s.notice.age >= C.NOTICE_DELAY &&
        inside({ x: 280, y: 548, w: 720, h: 105 }, sample)
      )
        s.notice = null;
    }
    if (sample.type === "down") s.pressedRegions[sample.id] = region ?? "";
    if (sample.type === "up") {
      const down = s.pressedRegions[sample.id];
      delete s.pressedRegions[sample.id];
      if (region && region === down) {
        if (region.startsWith("menu:")) {
          s.menuIndex = Number(region.split(":")[1]);
          choose(s);
        } else {
          const [, id, subject] = region.split(":");
          act(s, id, subject || null);
        }
      }
    }
  }
}

function update(state: ReadState, api: UpdateApi, dt: number): DeepcoreState {
  const s = draft(state);
  s.simTime += dt;
  s.muted = api.audio.muted();
  const pressed = Object.fromEntries(
    C.ACTION_NAMES.map((name) => [name, api.input.pressed(name)]),
  ) as Record<C.ActionName, boolean>;
  if (pressed.mute) {
    api.audio.setMuted(!api.audio.muted());
    s.muted = api.audio.muted();
  }
  pointer(s, api);
  if (s.muted !== api.audio.muted()) api.audio.setMuted(s.muted);
  if (pressed.pause) back(s);
  if (s.screen !== "in-mine") {
    const count = menuItems(s).length;
    if (count && (pressed.up || pressed.down))
      s.menuIndex = (s.menuIndex + (pressed.down ? 1 : -1) + count) % count;
    if (pressed.activate) choose(s);
  } else if (s.launchTime === null) {
    if (pressed.inventory) act(s, "inventory", null);
    for (const [i, item] of C.ITEM_IDS.entries())
      if (pressed[`supply${i + 1}` as C.ActionName]) useItem(s, item);
    if (pressed.jettison) jettison(s);
    if (s.panel) {
      const list = controls(s).filter((c) => c.y > C.HUD_H && c.id !== "close");
      if ((pressed.up || pressed.down) && list.length)
        s.panelIndex =
          (s.panelIndex + (pressed.down ? 1 : -1) + list.length) % list.length;
      if (pressed.activate) {
        const c = list[s.panelIndex];
        if (c?.enabled) act(s, c.id, c.subject);
      }
    } else if (pressed.activate) activateBuilding(s);
  }
  if (s.screen === "in-mine") {
    checkDeath(s);
    s.accumulator += dt;
    const held = {
      left: api.input.value("left"),
      right: api.input.value("right"),
      down: api.input.value("down"),
      up: api.input.value("up"),
    };
    while (s.accumulator + 1e-10 >= STEP && s.screen === "in-mine") {
      step(s, held, STEP);
      s.accumulator -= STEP;
    }
    s.noteTime = Math.max(0, s.noteTime - dt);
  }
  if (s.screen !== "paused" && s.panel !== "inventory") {
    s.shake = Math.max(0, s.shake - dt);
    s.effects = s.effects
      .map((e) => ({ ...e, age: e.age + dt }))
      .filter((e) => e.age < 2.2)
      .slice(-36);
  }
  const live = s.screen === "in-mine" && !s.panel;
  if (live && s.miner.drilling) api.audio.loop(C.CUES.drill);
  else api.audio.stop(C.CUES.drill);
  if (live && s.miner.state === "jetpack") api.audio.loop(C.CUES.thrust);
  else api.audio.stop(C.CUES.thrust);
  api.audio.loop(C.CUES.music);
  if (
    s.screen === "in-mine" &&
    s.simTime - s.lastAlarm >
      (s.coreTimer !== null ? Math.max(0.18, s.coreTimer / 40) : 2)
  ) {
    if (s.coreTimer !== null) api.audio.play(C.CUES.alarmCore);
    else if (
      s.miner.fuel <
      C.LOW_FUEL_FRACTION * C.FUEL_TIERS[s.tiers.fuel - 1]
    )
      api.audio.play(C.CUES.alarmFuel);
    s.lastAlarm = s.simTime;
  }
  for (const c of s.pendingCues) api.audio.play(c);
  s.pendingCues = [];
  s.muted = api.audio.muted();
  return s;
}

export const game: Game<DeepcoreState, DeepcoreDebugApi> = {
  async initialize(api) {
    for (const name of C.ACTION_NAMES)
      api.input.register(name, { keys: [...C.ACTIONS[name]] });
    const resources: Resources = { images: {}, systems: {} };
    await Promise.all(
      Object.entries(urls).map(async ([key, url]) => {
        const path = key.replace("../assets/", "");
        if (path.endsWith(".png"))
          resources.images[path] = await api.assets.loadImage(assetPath(url));
        else if (path.startsWith("fx/"))
          resources.systems[path.slice(3, -5)] = JSON.parse(
            await (await api.assets.load(assetPath(url))).text(),
          );
        else if (path.endsWith(".wav"))
          await api.audio.load(path.slice(6, -4), assetPath(url));
      }),
    );
    const state = emptyState(resources);
    state.tiles = emptyMine(state.coreRow);
    state.hasSave = readSave() !== null;
    const sources: Record<string, (s: ReadState) => string> = {
      screen: (s) => `${s.screen} / ${s.panel ?? "no panel"}`,
      expedition: (s) => `${s.mode} / ${s.worldSize}`,
      position: (s) => `${s.miner.x.toFixed(1)}, ${s.miner.y.toFixed(1)}`,
      velocity: (s) => `${s.miner.vx.toFixed(1)}, ${s.miner.vy.toFixed(1)}`,
      miner: (s) =>
        `${s.miner.state} / ${s.miner.facing} / grounded ${snapshot(s).miner.grounded}`,
      fuel: (s) => `${s.miner.fuel.toFixed(2)} / ${snapshot(s).miner.maxFuel}`,
      hull: (s) => `${s.miner.hull.toFixed(2)} / ${snapshot(s).miner.maxHull}`,
      drill: (s) => JSON.stringify(snapshot(s).miner.drilling),
      credits: (s) => s.credits.toFixed(0),
      depth: (s) => `${snapshot(s).depthMeters.toFixed(1)} m`,
      cargo: (s) =>
        `${snapshot(s).cargo.slotsUsed}/${snapshot(s).cargo.slotCap} · ${snapshot(s).cargo.loadKg} kg · overload ${snapshot(s).miner.overloaded}`,
      satchel: (s) => JSON.stringify(s.satchel),
      tiers: (s) => JSON.stringify(s.tiers),
      core: (s) => (s.coreTimer === null ? "none" : s.coreTimer.toFixed(2)),
      scanner: (s) =>
        `${snapshot(s).scanner.locked} / ${snapshot(s).scanner.target ?? "none"}`,
    };
    for (const [name, source] of Object.entries(sources))
      api.diagnostics.register(name, source);
    return [state, createDebug()];
  },
  update,
  render,
};
