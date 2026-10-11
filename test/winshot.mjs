import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 200)));
await page.goto('http://localhost:8907/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
console.log('game loaded');
await page.evaluate(() => window.__game.start());
await page.evaluate(() => { window.__game.G.introT = 0.01; }); // skip intro under software rendering
await page.waitForFunction(() => window.__game.status() === 'playing', null, { timeout: 150000 });
await page.evaluate(async () => {
  const X = window.__game, G = X.G;
  G.spawned = 40;
  G.balls.slice().forEach(b => b.mesh.parent?.remove(b.mesh));
  G.balls.length = 0;
  X.spawnBall(20, 1); X.spawnBall(20 - 1.14, 1);
  G.score = 950;
  G.cur = 1; G.shootCD = 0;
  const m = X.pointAt(19.43 + 0.5); X.shootAt(m.x, m.z);
});
await page.waitForFunction(() => window.__game.status() === 'won', null, { timeout: 150000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'site/shots/win.png' });
console.log('WIN SHOT DONE');
await browser.close();
