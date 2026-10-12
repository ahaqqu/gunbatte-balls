/* ============================================================
   POWERS — pluggable power-seed registry (mechanics layer).
   The core engine never hardcodes bomb/stop/frenzy: each level
   declares `powersAvailable: [...]` and the registry resolves
   handlers. New levels add powers by registering a new entry —
   same marble/particle assets, new behavior.

   Delivery model: power seeds spawn as pickups on the grass. The
   Jalak companion fetches them on click/tap, then holds one power
   at a time. Bomb is aimed with right-click on the chain, stop and
   frenzy fire from the held-power button (or E).
   ============================================================ */

export const POWER_DEFS = {
  bomb: { letter: 'B', bg: '#2b2d42', name: 'BOOMSEED' },
  stop: { letter: 'H', bg: '#4361ee', name: 'HOLDSEED' },
  frenzy: { letter: 'F', bg: '#ff9e00', name: 'FRENZYSEED' },
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

function stopHandler(ctx, pos) {
  // HOLDSEED: the Jalak grows huge, flies to the chain head and holds the
  // marbles in place. step() freezes the march while G.holdT > 0 (the Jalak
  // visual itself is driven by game.js from holdT).
  const { G, sfx, shockwave, burst, showBanner, floater } = ctx;
  if (G.holdT > 0) return;
  G.holdT = ctx.mechanics?.holdDur ?? 6;
  sfx('hold');
  shockwave(pos, 0x4cc9f0, 5);
  burst(pos, 1, 16, 7);
  showBanner('HOLDSEED!', 'the Jalak holds the march…');
  floater('+HOLD', pos, true);
}

function frenzyHandler(ctx, pos) {
  // FRENZYSEED: the Jalak goes wild and plucks K random marbles across the
  // whole chain (never a neat consecutive blast like the bomb). step()
  // processes G.frenzyQ one ball per beat and drives the Jalak swoops.
  const { G, sfx, showBanner, floater } = ctx;
  if (G.frenzyQ.length || !G.balls.length) return;
  const m = ctx.mechanics || {};
  const lo = m.frenzyMin ?? 4, hi = m.frenzyMax ?? 8;
  const k = Math.min(G.balls.length, lo + ((Math.random() * (hi - lo + 1)) | 0));
  const pool = G.balls.slice();
  for (let i = 0; i < k && pool.length; i++) {
    const j = (Math.random() * pool.length) | 0;
    G.frenzyQ.push(pool.splice(j, 1)[0]);
  }
  G.frenzyT = 0;
  sfx('frenzy');
  showBanner('FRENZY!', 'the Jalak goes wild!');
  floater('+FRENZY', pos, true);
}

registerPower('bomb', bombHandler);
registerPower('stop', stopHandler);
registerPower('frenzy', frenzyHandler);

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
