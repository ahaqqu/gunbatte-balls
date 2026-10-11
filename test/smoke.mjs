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

// power: rig RED trio with bomb middle, shoot RED with lead -> pop triggers bomb
const bomb = await page.evaluate(async () => {
  const X = window.__game, G = X.G;
  G.balls.slice().forEach(b => b.mesh.parent?.remove(b.mesh));
  G.balls.length = 0; G.spawned = 40;
  X.spawnBall(20, 0); X.spawnBall(20 - 1.14, 0, 'bomb'); X.spawnBall(20 - 2.28, 0);
  X.spawnBall(20 - 3.42, 2); X.spawnBall(20 - 4.56, 2); // bystanders for bomb radius
  G.cur = 0; G.shootCD = 0;
  const p = X.pointAt(20 - 1.14 + 0.6); // lead the moving chain
  X.shootAt(p.x, p.z);
  await new Promise(r => setTimeout(r, 12000));
  const slowSlow = G.slowT;
  X.triggerPower('slow', X.pointAt(10));
  const slowSet = G.slowT;
  X.triggerPower('rev', X.pointAt(10));
  return { balls: G.balls.length, score: G.score, powersUsed: G.powersUsed, slowWas: slowSlow, slowSet, revT: G.revT };
});
console.log('BOMB:', JSON.stringify(bomb));

// win flow (bomb test may have already won the game; restart handles both)
await page.evaluate(() => document.getElementById('restart-btn').click());
await page.waitForFunction(() => window.__game.status() === 'playing', null, { timeout: 90000 });
const win = await page.evaluate(async () => {
  const X = window.__game, G = X.G;
  G.spawned = 40;
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
