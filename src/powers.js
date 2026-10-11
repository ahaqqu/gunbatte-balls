/* ============================================================
   POWERS — pluggable power-seed registry (mechanics layer).
   The core engine never hardcodes bomb/slow/rev: each level
   declares `powersAvailable: [...]` and the registry resolves
   handlers. New levels add powers by registering a new entry —
   same marble/particle assets, new behavior.
   ============================================================ */

export const POWER_DEFS = {
  bomb: { letter: 'B', bg: '#2b2d42', name: 'BOOMSEED' },
  slow: { letter: 'S', bg: '#4361ee', name: 'CHILLSEED' },
  rev: { letter: 'R', bg: '#9d4edd', name: 'REWINDSEED' },
  // Example 4th power for future levels (same assets, new behavior):
  // STARDUST: bonus score + brief breathing room (small rollback).
  star: { letter: '*', bg: '#ff9e00', name: 'STARDUST' },
};

const handlers = {};

/* ctx = { G, scene, burst, shockwave, floater, showBanner, sfx,
           sanitizeHeld, bumpScore, updateHUD, checkWin }.
   Each handler mutates G + spawns feedback via ctx callbacks. */
export function registerPower(type, fn) { handlers[type] = fn; }

export function getPowerHandler(type) { return handlers[type] || null; }

export function powerNames() { return Object.keys(POWER_DEFS); }

function bombHandler(ctx, pos) {
  const { G, burst, shockwave, sfx, floater } = ctx;
  const radius = ctx.mechanics?.bombRadius ?? 5.5;
  const max = ctx.mechanics?.bombMax ?? 12;
  burst(pos, 0, 26, 12); burst(pos, 3, 18, 12);
  shockwave(pos, 0xff9e00, 5);
  G.shake = Math.min(1.4, G.shake + 1.0);
  sfx('bomb');
  floater('BOOM!', pos, true);
  const victims = G.balls.filter(b => b.mesh.position.distanceTo(pos) < radius).slice(0, max);
  victims.forEach(v => {
    const i = G.balls.indexOf(v);
    if (i >= 0) {
      burst(v.mesh.position, v.color, 8, 7);
      ctx.removeBall(v);
      G.destroyed++; G.score += 15;
    }
  });
  G.score += 10;
}

function slowHandler(ctx, pos) {
  const { G, sfx, shockwave, burst, showBanner, floater } = ctx;
  G.slowT = ctx.mechanics?.slowDur ?? 8; sfx('power');
  shockwave(pos, 0x4cc9f0, 4);
  burst(pos, 1, 16, 7);
  showBanner('CHILLSEED!', 'the march slows…');
  floater('+SLOW', pos, true);
}

function revHandler(ctx, pos) {
  const { G, sfx, shockwave, burst, showBanner, floater } = ctx;
  G.revT = ctx.mechanics?.revDur ?? 6; sfx('power');
  shockwave(pos, 0xf72585, 4);
  burst(pos, 2, 16, 7);
  showBanner('REWINDSEED!', 'time rolls back…');
  floater('+REWIND', pos, true);
}

function starHandler(ctx, pos) {
  // STARDUST: flat bonus + gentle chain rollback (breathing room).
  // Reuses burst/shockwave/floater assets — no new art needed.
  const { G, sfx, shockwave, burst, floater } = ctx;
  const rollback = ctx.mechanics?.rollback ?? 1.2;
  burst(pos, 3, 20, 9);
  shockwave(pos, 0xffc700, 4);
  sfx('power');
  G.score += 40;
  floater('+40 ★', pos, true);
  if (G.balls.length) {
    for (const x of G.balls) x.s -= rollback * 0.5;
    const tail = G.balls[G.balls.length - 1].s;
    if (tail < 0) for (const x of G.balls) x.s -= tail;
  }
}

registerPower('bomb', bombHandler);
registerPower('slow', slowHandler);
registerPower('rev', revHandler);
registerPower('star', starHandler);

/* Level-aware trigger: validates against the level's allow-list,
   runs the handler, then runs shared post-steps. Returns false for
   unknown/unallowed powers (no crash, no state change). */
export function triggerPower(ctx, type, pos) {
  const allowed = ctx.level?.powersAvailable || Object.keys(POWER_DEFS);
  if (!allowed.includes(type)) return false;
  const fn = getPowerHandler(type);
  if (!fn) return false;
  ctx.G.powersUsed++;
  fn(ctx, pos);
  ctx.sanitizeHeld();
  ctx.bumpScore(); ctx.updateHUD(); ctx.checkWin();
  return true;
}
