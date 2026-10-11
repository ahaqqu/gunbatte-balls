import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:8907/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'site/shots/menu.png' });
await page.evaluate(() => document.getElementById('start-btn').click());
await page.evaluate(() => { window.__game.G.introT = 0.01; }); // skip intro under software rendering
await page.waitForFunction(() => window.__game.status() === 'playing', null, { timeout: 120000 });
// rig a handsome mid-game chain
await page.evaluate(() => {
  const X = window.__game, G = X.G;
  G.balls.slice().forEach(b => b.mesh.parent?.remove(b.mesh));
  G.balls.length = 0; G.spawned = 40;
  const cols = [0, 0, 1, 1, 2, 2, 3, 3, 0, 1, 1, 2, 3, 3, 0, 2];
  cols.forEach((c, i) => X.spawnBall(24 - i * 1.14, c, i === 6 ? 'slow' : (i === 11 ? 'rev' : null)));
  G.cur = 2; G.nxt = 0;
  const m = X.pointAt(24 - 5 * 1.14 + 0.5);
  X.shootAt(m.x, m.z);
});
await page.waitForTimeout(1200);
await page.screenshot({ path: 'site/shots/gameplay.png' });
// danger drama: push head near skull, pop a burst for fireworks
await page.evaluate(() => {
  const X = window.__game, G = X.G;
  G.balls.sort((a, b) => b.s - a.s);
  const head = G.balls[0];
  head.s = X.curveLen * 0.8;
});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'site/shots/danger.png' });
// win card
await page.evaluate(async () => {
  const X = window.__game, G = X.G;
  document.getElementById('restart-btn')?.click();
  if (window.__game.status() === 'playing' || window.__game.status() === 'intro') {
    // fresh run already in progress; force quick win below
  }
});
await page.evaluate(() => { window.__game.G.introT = 0.01; }); // skip intro under software rendering
await page.waitForFunction(() => ['playing', 'won'].includes(window.__game.status()), null, { timeout: 120000 });
await page.evaluate(async () => {
  const X = window.__game, G = X.G;
  if (G.status !== 'playing') return;
  G.spawned = 40;
  G.balls.slice().forEach(b => b.mesh.parent?.remove(b.mesh));
  G.balls.length = 0;
  X.spawnBall(20, 1); X.spawnBall(20 - 1.14, 1);
  G.score = 950; // showcase 2-star win
  G.cur = 1; G.shootCD = 0;
  const m = X.pointAt(19.43 + 0.5); X.shootAt(m.x, m.z);
  await new Promise(r => setTimeout(r, 14000));
});
await page.waitForFunction(() => window.__game.status() === 'won', null, { timeout: 150000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'site/shots/win.png' });
console.log('SHOTS DONE');
await browser.close();
