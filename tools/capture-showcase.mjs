/* global document, window, KeyboardEvent */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { URL } from "node:url";
import process from "node:process";
import console from "node:console";

// Run against `npm run dev`. This is a capture driver, never part of the game.
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.goto(process.env.BASE_URL ?? "http://localhost:5173");
await page.waitForTimeout(800);
await mkdir(new URL("../showcase", import.meta.url), { recursive: true });

await page.evaluate(async () => {
  const { game, BACKGROUND } = await import("/src/game.ts");
  const { createEngine, ConstantClock } =
    await import("/node_modules/@clockwyrks/simple-2d/dist/index.js");
  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;display:block";
  document.body.append(canvas);
  const engine = createEngine({
    canvas,
    width: 1280,
    height: 720,
    background: BACKGROUND,
    game,
    clock: new ConstantClock(40),
  });
  await engine.initialize();
  window.captureEngine = engine;
  const d = engine.debug;
  const pose = (method, ...args) => engine.apply((s) => d[method](s, ...args));
  pose("generateMine");
  pose("setScreen", "in-mine");
  pose("setWorldSize", "standard");
  for (const [track, tier] of [
    ["fuel", 3],
    ["drill", 3],
    ["hull", 4],
    ["jetpack", 3],
    ["cargo", 3],
    ["scanner", 3],
  ])
    pose("setTier", track, tier);
  pose("setFuel", 275);
  pose("setHull", 320);
  pose("setCredits", 1840);
  pose("setRocketInstalled", 2);
  pose("setCargo", "argenite", 4);
  pose("setCargo", "cuprite", 3);
  for (let row = 150; row <= 160; row++) pose("setTile", 16, row, "tunnel");
  for (let col = 12; col <= 20; col++) pose("setTile", col, 160, "tunnel");
  for (let row = 161; row <= 169; row++)
    pose("setOreTile", 16, row, row % 2 ? "argenite" : "cuprite");
  pose("setMaterialTile", 20, 165, "resonite");
  pose("setOreTile", 14, 162, "verdite");
  pose("setMinerPosition", 16 * 80 + 12, 161 * 80 - 72);
  pose("setMinerVelocity", 0, 0);
  await engine.advance(1);
  engine.startRecording();
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyS" }));
  await engine.advance(75);
  document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyS" }));
});
await page.screenshot({
  path: new URL("../showcase/rockbed.png", import.meta.url).pathname,
});
const recording = await page.evaluate(async () => {
  const engine = window.captureEngine;
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" }));
  await engine.advance(75);
  document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW" }));
  return engine.stopRecording();
});
await writeFile(
  new URL("../showcase/haul.json.gz", import.meta.url),
  gzipSync(JSON.stringify(recording)),
);

await page.evaluate(async () => {
  const e = window.captureEngine,
    d = e.debug;
  const pose = (method, ...args) => e.apply((s) => d[method](s, ...args));
  pose("setMinerPosition", 1070, 8);
  pose("setMinerVelocity", 0, 0);
  pose("setFuel", 185);
  pose("setHull", 286);
  pose("setPanel", null);
  await e.advance(1);
});
await page.screenshot({
  path: new URL("../showcase/outpost.png", import.meta.url).pathname,
});

await page.evaluate(async () => {
  const e = window.captureEngine,
    d = e.debug;
  const pose = (method, ...args) => e.apply((s) => d[method](s, ...args));
  for (let row = 488; row < 500; row++) pose("setTile", 16, row, "tunnel");
  for (let col = 12; col <= 21; col++) pose("setTile", col, 498, "tunnel");
  for (const [col, row] of [
    [12, 496],
    [13, 496],
    [12, 497],
    [20, 494],
    [21, 494],
    [20, 495],
    [21, 495],
  ])
    pose("setTile", col, row, "lava");
  pose("setOreTile", 18, 497, "aurite");
  pose("setOreTile", 15, 495, "adamite");
  pose("setMinerPosition", 16 * 80 + 12, 500 * 80 - 72);
  pose("setMinerVelocity", 0, 0);
  pose("setRocketInstalled", 4);
  pose("setCredits", 5000);
  pose("setFuel", 240);
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyS" }));
  await e.advance(5);
  document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyS" }));
  await e.advance(1);
});
await page.screenshot({
  path: new URL("../showcase/core.png", import.meta.url).pathname,
});
console.log(
  `Captured ${recording.frames.length} replay frames; browser errors: ${errors.length}`,
);
await browser.close();
if (errors.length) throw new Error(errors.join("\n"));
