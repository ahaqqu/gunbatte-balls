# Architecture — mechanics / assets / environment

`game.js` is the **composition root** (renderer, main loop, input, HUD).
All reusable logic lives in `src/`:

```
src/
  assets.js       → reusable toy-diorama visual factories (NO game state, NO level data)
  materials.js    → felt/wood/glass material presets + PMREM environment (procedural Perlin)
  lighting.js     → warm key + hemisphere fill, 4096² PCF-soft shadows (quality-tiered)
  post.js         → EffectComposer: RenderPass → SSAO → UnrealBloom → Bokeh DOF → ACES
  vfx.js          → StarBurst (InstancedMesh stars) + ComicText (HDR pop sprites)
  mechanics.js    → marble-chain rules, parameterized by LevelDef (NO art, NO scene building)
  powers.js       → pluggable power-seed registry (new powers = new entry, same assets)
  levels.js       → declarative island + ruleset per level (NO art, NO engine code)
  environment.js  → level-driven scene helpers (curve, perches, scatter guard)
game.js           → wires the above: scene + loop + input + HUD + window.__game
```

## Visual pipeline (diorama pass)

- **Renderer** (`game.js`): antialias, high-performance, ACES exposure 1.2,
  SRGB output, `PCFSoftShadowMap`, physical lights. PerspectiveCamera FOV 27
  isometric-ish elevation (~54°), fit so ≥40 world units are visible.
- **Post** (`src/post.js`): hand-rolled passes (no three/examples addons).
  Order is fixed: SSAO (depth contact AO) → UnrealBloom (threshold 1.0,
  strength 1.5) → Bokeh DOF (aperture 0.0001, focus on the tarsier) →
  OutputPass (three.js built-in ACES + sRGB via MeshBasicMaterial).
  `composer.setFocus(dist)` is driven from `tick()`.
- **Materials** (`src/materials.js`): `feltMat` / `feltNoise` (Perlin canvas,
  repeat 50×50) for clay props; `woodMat` for the serpentine track;
  `glassShellMat` + `marbleCoreMat` for refractive marbles (transmission 1.0,
  ior 1.5, thickness 2.0); `buildEnvironment(renderer)` PMREM for reflections.
- **Lighting** (`src/lighting.js`): key `#ffebb5` @ 3.0 + Hemisphere
  `#a1d8ff`/`#5e9e3e` @ 1.0. Shadow map 4096² on GPU, 1024² on software GL.
- **VFX** (`src/vfx.js`): `StarBurst` InstancedMesh star particles (HDR ×3.2
  tint so bloom catches them) fired from `burst()`; `ComicText` sprites for
  COMBO/BOOM pops from `floater()`. Both updated every `tick()`.
- **Quality tier** (`game.js` `QUALITY`): software renderers (SwiftShader /
  llvmpipe, used by headless tests) drop SSAO and shrink shadows so game time
  stays real-time. `?hq=1` forces the full look for screenshots.
- **Performance**: BokehPass removed (isometric angle sells the diorama).
  SSAO runs at half-res with 8 taps. Environment uses `MeshStandardMaterial`
  (flatShading); `MeshPhysicalMaterial` is reserved for the tarsier + glass
  marbles. Grass/flowers/trees/rocks are `InstancedMesh`. Shadows max 2048
  tightly bound to the island. Pixel ratio clamped to 2.

## Rules

- **Assets** (`src/assets.js`): `toy`, `toyGlow`, `sculpt`, `roundRockGeo`,
  `R`, `canvasTex`, `marbleMat`, `makeBallMesh`, `makeOrb`, `letterSprite`,
  `makeGroundBlob`, texture painters. Pure factories — safe to reuse from any
  level. `game.js` imports `toy/toyGlow/sculpt/roundRockGeo/R/makeBallMesh`
  from here (no local duplicates).
- **Mechanics** (`src/mechanics.js`): `baseSpeedFor`, `randColor`, `dealColor`,
  `sanitizeHeld`, `randPower`, `spawnBall`, `popCheck`, `insertShot`,
  `triggerPower` (via `src/powers.js`). Every tunable number
  (`rollback`, `magnetSpeed`, `joinGap`, `dangerThreshold`, `slowFactor`,
  `reverseFactor`, `finalStandBrake`, `shootCooldown`, `projectileSpeed`,
  `bombRadius/Max`, `slowDur/revDur`, `spawnPowerEvery`) is read from
  `level.mechanics` / `level.powersAvailable` — never hardcoded.
  `game.js` keeps thin wrappers (`spawnBall`, `popCheck`, …) with identical
  signatures so `test/smoke.mjs` and the `window.__game` API are unchanged.
  Eagle kills live in `game.js` (`eagleDown`, hitbox `EAGLE_HIT_R`): every
  3rd kill triggers the ULTIMATE REWIND — the march drifts backward
  (`G.rewindT`, `ultimateRollback` over `ultimateRewindDur`, tail clamped
  at the portal, pops suspended while reversing).
  Eagles are a flock (`eagles[]`, cap 3 chill / 5 normal / 10 spicy via
  `eagleMax*` + `eagleSpawnEvery`): stoops rip a marble off the chain into
  the bird's talons, and `checkWin` requires zero carriers — stolen balls
  come back only as smashed loot on the kill (`destroyed++`).
- **Powers** (`src/powers.js`): `POWER_DEFS` + `registerPower(type, fn)` +
  `triggerPower(ctx, type, pos)`. The engine validates against
  `level.powersAvailable`; unknown/disallowed powers return `false` with no
  state change. Handlers receive durations/radii from `ctx.mechanics`.
- **Environment** (`src/levels.js` + `src/environment.js`): each level is data
  (`pathPts2D`, `perches`, `house/shrine/torch/pinwheels`, `clearances`,
  `totalBalls/colorsN`, `powersAvailable`, `mechanics`, `scatter`, `fence`,
  banners). `buildCurve` / `perchVectors` / `createNearPathChecker` build the
  playable scene from that data using shared assets. Prop meshes are still
  constructed inline in `game.js` but read **exclusively** from the active
  `LEVEL` — no hardcoded island coordinates remain.

## Add a new island (same toys, new rules)

1. Add a `LevelDef` in `src/levels.js` (copy `samalona`, change path/perches/
   clearances/powers/mechanics). Example: `sunsetCove` mirrors the road,
   swaps `rev → star`, and tweaks `rollback 1.2→2.0`, `magnet 5→6.5`,
   `danger 0.72→0.68`.
2. Register it in `LEVELS`. No asset or engine change needed.
3. (Optional new power): add meta to `POWER_DEFS` + `registerPower('mine', fn)`
   in `src/powers.js`, then list it in the level's `powersAvailable`.
4. Verify: `node --check game.js`, `node ./test/smoke.mjs`,
   `node ./test/levels.mjs` (boots every island, shoots, triggers each
   allowed power, rejects unknown powers, asserts zero page errors).

Switch islands at runtime via `?level=<id>` (menu buttons or
`window.__game.switchLevel(id)`). Default is `samalona`, so existing links,
tests, and the trailer (`?attract=1`) are unaffected.
