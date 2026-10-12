import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
await page.goto('http://localhost:8907/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
console.log('menu title visible:', await page.isVisible('#start-btn'));

await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
await page.evaluate(() => window.__game.start());
await page.waitForFunction(() => window.__game.status() === 'playing', null, { timeout: 150000 });
await page.waitForTimeout(1500);
const s1 = await page.evaluate(() => ({
  status: window.__game.status(), balls: window.__game.ballCount(),
  spawned: window.__game.G.spawned, powers: window.__game.G.balls.filter(b => b.power).length,
}));
console.log('START:', JSON.stringify(s1));

// shoot via real click at head ball
await page.evaluate(() => {
  const b = window.__game.G.balls[0].mesh.position;
  window.__t = { x: b.x, z: b.z };
});
await page.mouse.move(640, 250);
await page.mouse.click(640, 250);
await page.waitForTimeout(400);
console.log('SHOOT:', await page.evaluate(() => JSON.stringify({
  proj: window.__game.G.projectiles.length, shots: window.__game.G.shots,
})));

// pause / resume (while playing normally)
await page.keyboard.press('KeyP');
await page.waitForTimeout(300);
const paused = await page.evaluate(() => window.__game.status());
await page.evaluate(() => document.getElementById('resume-btn').click());
await page.waitForTimeout(300);
const resumed = await page.evaluate(() => window.__game.status());
console.log('PAUSE:', JSON.stringify({ paused, resumed }));

// leap is right-click / hold on a tree now: real right-click on perch 1
// must leap there, while left-click on the same tree just shoots.
const treeScr = await page.evaluate(() => {
  const X = window.__game;
  const p = X.PERCHES[1];
  const v = X.jalak.position.clone();
  v.set(p.x, 3.2, p.z);
  v.project(X.camera);
  return { x: (v.x * 0.5 + 0.5) * 640, y: (-v.y * 0.5 + 0.5) * 400 };
});
await page.mouse.move(treeScr.x, treeScr.y);
await page.mouse.click(treeScr.x, treeScr.y, { button: 'right' });
await page.waitForTimeout(400);
const leapRight = await page.evaluate(() => ({ perch: window.__game.G.perch }));
// left-click the same tree AFTER the leap lands (shots are locked mid-air):
// no leap, just aim + shoot.
await page.waitForFunction(() => window.__game.G.leapT <= 0, null, { timeout: 30000 });
const shots0 = await page.evaluate(() => window.__game.G.shots);
await page.mouse.click(treeScr.x, treeScr.y);
await page.waitForTimeout(400);
const leapLeft = await page.evaluate((s0) => ({
  perch: window.__game.G.perch, shots: window.__game.G.shots - s0,
}), shots0);
console.log('LEAP:', JSON.stringify({ right: leapRight, left: leapLeft }));

// powers: full Jalak loop — fetch a bloomed seed, then unleash it via the
// same right-click / hold dispatch players use (bomb / stop / frenzy all
// fire on ANY marble). No buttons, no keys.
const pw = async (fn) => page.evaluate(fn);
await pw(() => { window.__p = window.__game.spawnPickup('frenzy', 5, 5); });
const treasureRes = await pw(() => {
  const p = window.__p;
  let boxes = 0, spheres = 0, gem = null;
  p.chest.traverse(o => {
    if (o.geometry?.type === 'BoxGeometry') boxes++;
    if (o.geometry?.type === 'SphereGeometry') spheres++;
    if (o.geometry?.type === 'OctahedronGeometry') gem = o.material.emissive.getHex();
  });
  return {
    kind: p.kind, boxes, spheres, gem: gem?.toString(16),
    halo: p.halo.material.emissive.getHex().toString(16),
  };
});
console.log('TREASURE:', JSON.stringify(treasureRes));
await pw(() => window.__game.fetchPickup(window.__p));
await page.waitForFunction(() => window.__game.holding() === 'frenzy', null, { timeout: 30000 });
await pw(() => {
  const X = window.__game;
  const mid = X.G.balls[(X.G.balls.length / 2) | 0].mesh.position;
  X.useHeldPowerAt({ x: mid.x, z: mid.z });
});
await page.waitForFunction(() => window.__game.G.frenzyQ.length === 0, null, { timeout: 30000 });
await page.waitForTimeout(800);
const frenzyRes = await pw(() => ({ balls: window.__game.ballCount(), destroyed: window.__game.G.destroyed, score: window.__game.G.score, powers: window.__game.G.powersUsed, mode: window.__game.G.jalakMode }));
console.log('FRENZY:', JSON.stringify(frenzyRes));
await pw(() => { window.__p2 = window.__game.spawnPickup('stop', -5, -5); });
await page.waitForFunction(() => window.__game.G.jalakMode === 'hover', null, { timeout: 30000 });
await pw(() => window.__game.fetchPickup(window.__p2));
await page.waitForFunction(() => window.__game.holding() === 'stop', null, { timeout: 30000 });
await pw(() => {
  const X = window.__game;
  // stop fires on ANY marble (tail here) — the Jalak still pins the head
  const tail = X.G.balls[X.G.balls.length - 1].mesh.position;
  const ok = X.useHeldPowerAt({ x: tail.x, z: tail.z });
  window.__stopOk = ok;
});
const holdRes = await pw(() => {
  const X = window.__game, G = X.G;
  return { fired: window.__stopOk, holdSet: +G.holdT.toFixed(2), mode: G.jalakMode, talonHidden: !X.nextOrb.visible };
});
const sh0 = await pw(() => window.__game.G.balls.length ? window.__game.G.balls[0].s : -1);
await page.waitForTimeout(1200);
const sh1 = await pw(() => window.__game.G.balls.length ? window.__game.G.balls[0].s : -1);
holdRes.frozen = sh0 >= 0 && Math.abs(sh1 - sh0) < 0.001;
await pw(() => { window.__game.G.holdT = 0.2; });
await page.waitForFunction(() => window.__game.G.jalakMode === 'hover', null, { timeout: 15000 });
await page.waitForTimeout(500); // let a frame run: the tuck flag flips in tick
holdRes.released = 'hover';
holdRes.talonBack = await pw(() => window.__game.nextOrb.visible);
console.log('HOLD:', JSON.stringify(holdRes));
await pw(() => { window.__p3 = window.__game.spawnPickup('bomb', 0, -8); });
await page.waitForFunction(() => window.__game.G.jalakMode === 'hover', null, { timeout: 30000 });
await pw(() => window.__game.fetchPickup(window.__p3));
await page.waitForFunction(() => window.__game.holding() === 'bomb', null, { timeout: 30000 });
await pw(() => {
  const X = window.__game;
  const head = X.G.balls.length ? X.G.balls[0].mesh.position : X.pointAt(20);
  X.useHeldPowerAt({ x: head.x, z: head.z });
});
await page.waitForFunction(() => window.__game.G.jalakMode === 'hover' && window.__game.G.powersUsed >= 3, null, { timeout: 90000 });
const bombRes = await pw(() => ({ balls: window.__game.ballCount(), score: window.__game.G.score, powers: window.__game.G.powersUsed }));
console.log('BOMB:', JSON.stringify(bombRes));
const eagleRes = await pw(() => {
  const X = window.__game, G = X.G;
  const sc0 = G.score;
  X.eagleDown(X.eagles[0]);
  return { mode: X.eagles[0].mode, plus: G.score - sc0, hits: G.eagleHits, visible: X.eagles[0].group.visible, flock: X.eagles.length };
});
console.log('EAGLE:', JSON.stringify(eagleRes));

// eagle projectile kill: clear the sky, then aim AT the bird sprite on
// screen exactly like a human (the old endpoint-only ground test missed
// these; the projectile's screen path now scores via the fallback).
// Proves visual hits register, and the eaten-projectile double-splice is gone.
await pw(() => {
  const X = window.__game, G = X.G;
  G.balls.slice().forEach(b => b.mesh.parent?.remove(b.mesh));
  G.balls.length = 0; G.spawned = 40;
  const e = X.eagles[0];
  e.mode = 'circle'; e.group.visible = true;
  e.group.position.set(6, 8, -4);
  window.__eh0 = G.eagleHits;
});
let eagleKill = null;
for (let i = 0; i < 5; i++) {
  const scr = await pw(() => {
    const X = window.__game;
    const v = X.eagles[0].group.position.clone().project(X.camera);
    return { x: (v.x * 0.5 + 0.5) * 640, y: (-v.y * 0.5 + 0.5) * 400 };
  });
  await page.mouse.move(scr.x, scr.y);
  await page.mouse.click(scr.x, scr.y);
  await page.waitForTimeout(2600);
  eagleKill = await pw(() => ({ hits: window.__game.G.eagleHits - window.__eh0, mode: window.__game.eagles[0].mode }));
  if (eagleKill.hits > 0) break;
}
console.log('EAGLE-SHOT:', JSON.stringify(eagleKill));

// eagle ball-steal: force a stoop, the bird must rip a marble off the chain
// and carry it (game cannot complete while carriers hold balls).
await pw(() => {
  const X = window.__game, G = X.G;
  // drain live projectiles: no friendly fire on the pinned bird mid-rig
  G.projectiles.slice().forEach(pr => {
    X.scene.remove(pr.mesh); pr.trail.forEach(t => X.scene.remove(t));
  });
  G.projectiles.length = 0;
  G.balls.slice().forEach(b => b.mesh.parent?.remove(b.mesh));
  G.balls.length = 0; G.spawned = 40;
  for (let i = 0; i < 6; i++) X.spawnBall(20 - i * 1.14, i % 3);
  const e = X.eagles[0];
  e.mode = 'circle'; e.t = 0; e.goneT = 0;
  e.group.visible = true; e.shadow.visible = true;
  e.stealBall = null; e.stealRef = null;
  e.group.position.set(6, 8, -4); // pin nearby: bounds the stoop dive
  e.wp.set(0, 8, -8);
  X.eagles.forEach(x => { if (!x.stealBall) x.stoopT = 0.01; });
  window.__b0 = G.balls.length;
});
try {
  await page.waitForFunction(() => window.__game.eaglesHolding() > 0, null, { timeout: 90000 });
} catch (err) {
  const dbg = await pw(() => ({
    status: window.__game.status(), balls: window.__game.ballCount(),
    flock: window.__game.eagles.map(e => ({
      mode: e.mode, stoopT: +e.stoopT.toFixed(2),
      pos: e.group.position.toArray().map(v => +v.toFixed(1)).join(','),
      steal: !!e.stealBall, vis: e.group.visible,
    })),
  }));
  console.log('EAGLE-STEAL-DBG:', JSON.stringify(dbg));
  throw err;
}
const stealRes = await pw(() => ({
  before: window.__b0, chain: window.__game.ballCount(),
  holding: window.__game.eaglesHolding(), steals: window.__game.G.eagleSteals,
  color: window.__game.eagles.find(e => e.stealBall)?.stealBall.color,
}));
console.log('EAGLE-STEAL:', JSON.stringify(stealRes));
// shooting the carrier smashes the loot back (destroyed++) and frees the win
await pw(() => {
  const X = window.__game;
  const d0 = X.G.destroyed;
  window.__d1 = d0;
  X.eagleDown(X.eagles.find(e => e.stealBall));
});
const lootRes = await pw(() => ({
  holding: window.__game.eaglesHolding(), recovered: window.__game.G.destroyed - window.__d1,
}));
console.log('EAGLE-LOOT:', JSON.stringify(lootRes));

// flock cap: spicy allows 10 concurrent, normal 5 — spawner must respect it
const capRes = await pw(() => {
  const X = window.__game, G = X.G;
  while (X.eagles.length < 10) X.spawnEagle();
  G.diff = 'spicy'; G.eagleSpawnT = 0.01;
  return { flock: X.eagles.length, cap: X.eagleCap() };
});
await page.waitForTimeout(1500);
const capRes2 = await pw(() => {
  const X = window.__game, G = X.G;
  const spicyFlock = X.eagles.length;
  G.diff = 'normal';
  X.clearEagles();
  while (X.eagles.length < 5) X.spawnEagle();
  G.eagleSpawnT = 0.01;
  return { spicyFlock, normalFlock: X.eagles.length, cap: X.eagleCap() };
});
await page.waitForTimeout(1500);
capRes2.normalAfter = await pw(() => window.__game.eagles.length);
console.log('EAGLE-CAP:', JSON.stringify({ ...capRes, ...capRes2 }));

// ultimate REWIND: every 3rd eagle kill starts a slow backward drift
// (no teleport: mid-read barely moved, final ≈ ultimateRollback).
// Rig: stoops frozen, fresh chain, record/fire atomic, then await the drift.
const ultRes = await pw(() => {
  const X = window.__game, G = X.G;
  X.eagles.forEach(e => { e.stoopT = 9999; });
  G.balls.slice().forEach(b => b.mesh.parent?.remove(b.mesh));
  G.balls.length = 0; G.spawned = 40;
  for (let i = 0; i < 5; i++) X.spawnBall(30 - i * 1.14, i % 3);
  const out = { s0: G.balls[0].s, u0: G.ultimates || 0, n0: G.balls.length };
  for (let i = 0; i < 3 && (G.ultimates || 0) === out.u0; i++) X.eagleDown(X.eagles[0]);
  out.mid = G.balls[0].s;
  out.rewinding = G.rewindT > 0;
  window.__ult = out;
  return { hits: G.eagleHits, ults: G.ultimates };
});
await page.waitForFunction(() => window.__game.G.rewindT <= 0, null, { timeout: 90000 });
const ultEnd = await pw(() => ({
  pushed: +((window.__ult.s0 - window.__game.G.balls[0].s).toFixed(2)),
  midPushed: +((window.__ult.s0 - window.__ult.mid).toFixed(2)),
  chainKept: window.__game.G.balls.length === window.__ult.n0,
}));
console.log('ULTIMATE-REWIND:', JSON.stringify({ ...ultRes, ...ultEnd }));
// normal-shot pop still keeps streak/combo (double-splice regression guard)
await pw(() => {
  const X = window.__game, G = X.G;
  X.eagles.forEach(e => { e.mode = 'gone'; e.goneT = 9999; e.group.visible = false; e.shadow.visible = false; });
  G.balls.slice().forEach(b => b.mesh.parent?.remove(b.mesh));
  G.balls.length = 0; G.spawned = 40;
  X.spawnBall(20, 0); X.spawnBall(20 - 1.14, 0); // RED pair, nothing more
  G.cur = 0; G.nxt = 2; G.shootCD = 0; // loaded RED: completes the trio
  const d0 = G.destroyed;
  window.__d0 = d0;
  const m = X.pointAt(20 - 0.57); X.shootAt(m.x, m.z);
});
await page.waitForTimeout(9000);
const popRes = await pw(() => ({
  popped: window.__game.G.destroyed - window.__d0,
  streak: window.__game.G.streak, combo: window.__game.G.combo,
  balls: window.__game.ballCount(),
}));
console.log('POP-CHECK:', JSON.stringify(popRes));

// win flow (bomb test may have already won the game; restart handles both)
await page.evaluate(() => document.getElementById('restart-btn').click());
await page.waitForFunction(() => window.__game.status() === 'playing', null, { timeout: 90000 });
const win = await page.evaluate(async () => {
  const X = window.__game, G = X.G;
  G.spawned = 40;
  X.eagles.forEach(e => { e.mode = 'gone'; e.goneT = 9999; e.group.visible = false; e.shadow.visible = false; });
  G.balls.slice().forEach(b => b.mesh.parent?.remove(b.mesh));
  G.balls.length = 0;
  X.spawnBall(20, 1); X.spawnBall(20 - 1.14, 1);
  G.cur = 1; G.shootCD = 0;
  const m = X.pointAt(19.43); X.shootAt(m.x, m.z);
  await new Promise(r => setTimeout(r, 12000));
  return { status: G.status, score: G.score, stars: document.getElementById('end-stars').textContent };
});
console.log('WIN:', JSON.stringify(win));

// lose flow
await page.evaluate(() => document.getElementById('restart-btn').click());
await page.waitForFunction(() => window.__game.status() === 'playing', null, { timeout: 90000 });
const loseRig = await page.evaluate(async () => {
  const X = window.__game, G = X.G;
  if (!G.balls.length) X.spawnBall(10, 1);
  G.balls.sort((a, b) => b.s - a.s);
  G.balls[0].s = X.curveLen - 1.3;
  return { status: G.status };
});
await page.waitForFunction(() => window.__game.status() === 'lost', null, { timeout: 60000 });
const lose = await page.evaluate(() => ({ status: window.__game.status() }));
console.log('LOSE:', JSON.stringify(lose));
console.log('ERRORS:', JSON.stringify(errors.slice(0, 8)));
await browser.close();
