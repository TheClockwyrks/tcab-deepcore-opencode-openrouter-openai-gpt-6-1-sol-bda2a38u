# Deepcore

**Depth is cheap. Height is expensive.**

A complete browser dig-and-build game. A stranded prospector mines a dead world,
sells ore at a derelict outpost, upgrades a pressure suit and jetpack, and builds
a five-component escape rocket. Cargo has weight: a valuable haul can become a
load your jetpack cannot lift. The deepest prize starts a ninety-second race home.

## Run

Requires Node.js 22.12+ (or a current Node.js LTS) and npm.

```sh
npm ci
npm run dev
```

Open the URL Vite prints. There is no backend or account. Audio unlocks on your
first key or pointer interaction. The single save slot uses browser local storage;
if storage is unavailable, the rest of the game still works.

## Production

```sh
npm run build
npm run preview
```

Serve `dist/` from any static host, including under a subdirectory. All graphics,
effects and audio are shipped locally with relative URLs. **Building only bundles
committed assets.** It does not require the asset-authoring tools.

## Controls

| Input | Action |
| --- | --- |
| A / D or ← / → | Walk; drill a wall when grounded and flush against it |
| S or ↓ | Drill down while grounded |
| W / ↑ / Space | Jetpack thrust |
| E / Enter | Interact with a camp building; confirm a menu or panel control |
| I | Cargo, materials and field supplies |
| J | Jettison an unstable Core Sample |
| 1–6 | Dynamite, Plastic Explosives, Quantum Teleporter, Matter Transmitter, Nanobots, Emergency Fuel |
| Escape / P | Close a panel, pause, resume, or go back |
| M | Mute / unmute |
| Backtick | Engine diagnostics |

Use ↑ / ↓ and Enter in menus and panels. Every menu, panel and status-bar control
also accepts a mouse, pen or touch. Movement uses the keyboard.

## An expedition

Choose Standard or Hardcore, then Quick, Standard or Marathon. Cut down, collect
ore and fly back through the tunnels you made; the drill never cuts upward. Sell
at the Ore Market and pay for fuel and repairs at the Fuel Depot. Nothing refills
automatically. Improve seven upgrade tracks, buy field supplies and follow your
scanner to Resonite and Cryenite. Install the rocket’s five components in order.

The Core is inexhaustible, but each extracted Sample destabilizes after 90 seconds.
Install the Ignition Core before it detonates, or jettison it and get clear. Only
the pause menu freezes its timer. Inventory holds the miner still while that timer
continues.

Only the Save Pad saves. A Standard death lets you restore your last save. A
Hardcore death deletes the slot. Starting a fresh expedition abandons an existing
save; victory consumes it.

## Development & verification

```sh
npm run typecheck
npm run lint
npm run format
npm test
```

The 27 tests use a real `@napi-rs/canvas` canvas and scripted engine clocks.
They cover generation and reachability, immutable poses, drilling and collisions,
load and lift, frame-partition invariance, purchases, saves, supplies, hazards,
Core timers, pointer navigation and the full rocket progression. Coverage reports
are written to `coverage/`.

### Source layout

- `src/game.ts`: engine registration, asset loading and frame orchestration.
- `src/state.ts`, `world.ts`, `simulation.ts`: authoritative value state, terrain,
  camera, and a render-free 120 Hz simulation.
- `src/rules.ts`: economy, hazards, supplies, rocket and persistence.
- `src/debug.ts`, `readings.ts`: validated automation poses and pure snapshots,
  returned exclusively through the engine’s debug handle.
- `src/interface.ts`, `render.ts`: shared hit geometry and canvas presentation.
- `assets/`: original generated artwork, animation frames, particle systems and
  sounds. All are loaded through the Simple 2D engine.
- `showcase/`: player-facing description, screenshots and a recorded live replay.

### Original assets

`tools/generate_assets.py` is the one-time authoring source. It uses `draw` for
textured band rock, mineral veins, gems, camp buildings and rocket stages;
`draw-sheet` for the eight prospector cycles, cracks and lava; `particle-2d` for
twelve live systems; `sfx-synth` and `sfx-sample` for effects; and `music` with the
synthwave bank for the lonely industrial score. Generated PNG, JSON, WAV and MIDI
files are checked into `assets/`. Running this optional authoring script requires
those tools; ordinary development and production builds do not.

With the development server running, `node tools/capture-showcase.mjs` captures the
showcase using project-local Playwright and the engine recorder. The capture
driver poses scenarios through the same debug surface the tests use, and records
actual drilling and thrusting with engine actions.
