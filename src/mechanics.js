import * as THREE from 'three';
import { SPACING } from './levels.js';
import { makeBallMesh } from './assets.js';
import { triggerPower as triggerPowerReg } from './powers.js';

/* ============================================================
   MECHANICS — Zuma chain rules, parameterized by level (no art,
   no scene building). Same engine runs every island; per-level
   tweaks live in level.mechanics + level.powersAvailable.
   ctx = live wiring from game.js:
     { G, level, curve, curveLen, scene, kit, powerDefs,
       burst, shockwave, floater, showBanner, sfx,
       updateHUD, bumpScore, checkWin, removeBallMesh,
       PALETTE, tarsiusPos? }
   ============================================================ */

export function createState() {
  return {
    status: 'menu', paused: false, muted: false, diff: 'normal',
    sim: false, attract: false, attractThink: 0, attractEnd: 0,
    balls: [], projectiles: [], particles: [], rings: [],
    spawned: 0, destroyed: 0, score: 0, combo: 1, maxCombo: 1,
    streak: 0, bestStreak: 0, shots: 0, hits: 0, powersUsed: 0,
    aim: 0, time: 0, playTime: 0, introT: 0,
    perch: 0, leapT: 0, leapFrom: null,
    cur: 0, nxt: 1, shootCD: 0, blink: 0, recoil: 0, happy: 0, flash: 0,
    slowT: 0, revT: 0, shake: 0, danger: false, heartT: 0,
    best: 0,
  };
}

export function getActiveColors(balls, colorsN) {
  const set = new Set();
  for (const b of balls) set.add(b.color);
  return set.size ? [...set] : [...Array(colorsN).keys()];
}

/* Path spawns stay fully random over the level's palette — runs of
   same-color balls happen by chance, never forced. */
export function randColor(level) {
  return (Math.random() * level.colorsN) | 0;
}

/* Shooter deals only colors live on the path right now. */
export function dealColor(balls, level) {
  const act = getActiveColors(balls, level.colorsN);
  return act[(Math.random() * act.length) | 0];
}

export function sanitizeHeld(G, level) {
  if (!G.balls.length) return;
  const act = getActiveColors(G.balls, level.colorsN);
  if (!act.includes(G.cur)) G.cur = act[(Math.random() * act.length) | 0];
  if (!act.includes(G.nxt)) G.nxt = act[(Math.random() * act.length) | 0];
}

export function randPower(level) {
  const pool = level.powersAvailable?.length ? level.powersAvailable : ['bomb', 'slow', 'rev'];
  return pool[(Math.random() * pool.length) | 0];
}

export function baseSpeedFor(G, level, diffs) {
  const m = level.mechanics;
  return (0.95 + 0.4 * (G.spawned / level.totalBalls)) * (diffs[G.diff] || 1) * (m.baseSpeedMul || 1);
}

export function pointAt(curve, curveLen, s) {
  return curve.getPointAt(THREE.MathUtils.clamp(s / curveLen, 0, 1));
}

export function tangentAt(curve, curveLen, s) {
  return curve.getTangentAt(THREE.MathUtils.clamp(s / curveLen, 0, 1));
}

export function spawnBall(ctx, s = 0, color = null, power = null) {
  const { G, level, scene, kit, powerDefs, curve, curveLen } = ctx;
  const c = color ?? randColor(level);
  const mesh = makeBallMesh(kit, powerDefs, c, power);
  const p = pointAt(curve, curveLen, s);
  mesh.position.copy(p); mesh.position.y = 1.15;
  scene.add(mesh);
  G.balls.push({ s, color: c, power, mesh, core: mesh.children[0] });
  G.balls.sort((a, b) => b.s - a.s);
}

/* Shared power context adapter (powers.js stays scene-free). */
function powerCtx(ctx) {
  return {
    G: ctx.G,
    level: ctx.level,
    mechanics: ctx.level.mechanics,
    scene: ctx.scene,
    burst: ctx.burst,
    shockwave: ctx.shockwave,
    floater: ctx.floater,
    showBanner: ctx.showBanner,
    sfx: ctx.sfx,
    sanitizeHeld: () => sanitizeHeld(ctx.G, ctx.level),
    bumpScore: ctx.bumpScore,
    updateHUD: ctx.updateHUD,
    checkWin: ctx.checkWin,
    removeBall: (v) => {
      const i = ctx.G.balls.indexOf(v);
      if (i >= 0) { ctx.scene.remove(v.mesh); ctx.G.balls.splice(i, 1); }
    },
  };
}

export function triggerPower(ctx, type, pos) {
  return triggerPowerReg(powerCtx(ctx), type, pos);
}

export function popCheck(ctx, startIdx) {
  const { G, level, scene } = ctx;
  const m = level.mechanics;
  const joinGap = SPACING * (m.joinGap ?? 1.6);
  const b = G.balls;
  if (!b[startIdx]) return false;
  const c = b[startIdx].color;
  let lo = startIdx, hi = startIdx;
  while (lo - 1 >= 0 && b[lo - 1].color === c && (b[lo - 1].s - b[lo].s) < joinGap) lo--;
  while (hi + 1 < b.length && b[hi + 1].color === c && (b[hi].s - b[hi + 1].s) < joinGap) hi++;
  const n = hi - lo + 1;
  if (n >= 3) {
    const mid = b[lo].mesh.position.clone();
    const removed = b.slice(lo, hi + 1);
    for (let i = hi; i >= lo; i--) { scene.remove(b[i].mesh); b.splice(i, 1); }
    ctx.burst(mid, c, n >= 4 ? 24 : 14, n >= 4 ? 11 : 8);
    if (n >= 4) { ctx.shockwave(mid, ctx.PALETTE[c], 3.5); G.shake = Math.min(1, G.shake + 0.35); }
    const gained = n * 10 * G.combo;
    G.score += gained; G.destroyed += n;
    // Zuma-style breather: nudge the whole chain back (level-tunable).
    if (b.length) {
      for (const x of b) x.s -= m.rollback;
      const tail = b[b.length - 1].s;
      if (tail < 0) for (const x of b) x.s -= tail;
    }
    ctx.floater(`+${gained}`, mid, n >= 4);
    if (G.combo >= 2) ctx.floater(`COMBO ×${G.combo}`, mid.clone().add(new THREE.Vector3(0, 1, 0)));
    G.combo++; G.maxCombo = Math.max(G.maxCombo, G.combo);
    G.happy = 0.7;
    ctx.sfx(n >= 4 ? 'big' : 'pop');
    removed.forEach(r => { if (r.power) triggerPower(ctx, r.power, r.mesh.position); });
    sanitizeHeld(G, level);
    ctx.bumpScore(); ctx.updateHUD(); ctx.checkWin();
    return true;
  }
  return false;
}

export function insertShot(ctx, proj, hitIdx) {
  const { G, level, scene, kit, powerDefs, curve, curveLen } = ctx;
  const b = G.balls;
  const hit = b[hitIdx];
  if (hit.power) {
    const hp = hit.mesh.position.clone(), pw = hit.power;
    ctx.burst(hp, hit.color, 10, 7);
    scene.remove(hit.mesh); b.splice(hitIdx, 1);
    G.destroyed++; G.score += 5;
    ctx.floater('+5', hp);
    triggerPower(ctx, pw, hp);
    G.hits++; G.streak++; G.bestStreak = Math.max(G.bestStreak, G.streak);
    return;
  }
  const tangent = tangentAt(curve, curveLen, hit.s);
  const toHit = proj.pos.clone().sub(hit.mesh.position);
  const ahead = toHit.dot(tangent) > 0;
  const idx = ahead ? hitIdx : hitIdx + 1;
  let ns;
  if (idx === 0) ns = b[0].s + SPACING;
  else if (idx >= b.length) ns = b[b.length - 1].s - SPACING;
  else ns = (b[idx - 1].s + b[idx].s) / 2;
  const mesh = makeBallMesh(kit, powerDefs, proj.color, null);
  const p = pointAt(curve, curveLen, ns);
  mesh.position.copy(p); mesh.position.y = 1.15;
  scene.add(mesh);
  b.splice(idx, 0, { s: ns, color: proj.color, power: null, mesh, core: mesh.children[0] });
  for (let i = idx + 1; i < b.length; i++) {
    const want = b[i - 1].s - SPACING;
    if (b[i].s > want) b[i].s = want;
  }
  G.hits++; G.streak++; G.bestStreak = Math.max(G.bestStreak, G.streak);
  if (G.streak > 0 && G.streak % 5 === 0) {
    G.score += G.streak * 5;
    ctx.floater(`STREAK ×${G.streak}!`, mesh.position.clone(), true);
    ctx.sfx('power');
  }
  ctx.updateHUD();
  if (!popCheck(ctx, idx)) { G.combo = 1; ctx.updateHUD(); }
}
