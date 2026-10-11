# Architecture — mechanics / assets / environment

`game.js` is the **composition root** (renderer, main loop, input, HUD).
All reusable logic lives in `src/`:

```
src/
  assets.js       → reusable toy-diorama visual factories (NO game state, NO level data)
  mechanics.js    → Zuma chain rules, parameterized by LevelDef (NO art, NO scene building)
  powers.js       → pluggable power-seed registry (new powers = new entry, same assets)
  levels.js       → declarative island + ruleset per level (NO art, NO engine code)
  environment.js  → level-driven scene helpers (curve, perches, scatter guard)
game.js           → wires the above: scene + loop + input + HUD + window.__game
```

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

1. Add a `LevelDef` in `src/levels.js` (copy `koholint`, change path/perches/
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
`window.__game.switchLevel(id)`). Default is `koholint`, so existing links,
tests, and the trailer (`?attract=1`) are unaffected.
