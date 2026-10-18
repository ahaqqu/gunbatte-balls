import { chromium } from 'playwright';
// Multi-island regression: every registered level must boot, shoot, run its
// power mix (registry), reject unknown powers, and stay error-free.
// Usage: node test/levels.mjs
const browser = await chromium.launch();
const levels = ['samalona', 'sunset-cove'];
let failed = 0;
for (const id of levels) {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://localhost:8907/index.html?level=${id}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  await page.evaluate(() => window.__game.start());
  await page.waitForFunction(() => window.__game.status() === 'playing', null, { timeout: 90000 });
  await page.waitForTimeout(1200);
  const boot = await page.evaluate(() => ({
    levelId: window.__game.levelId, balls: window.__game.ballCount(),
    spawned: window.__game.G.spawned, perches: window.__game.PERCHES.length,
    powers: window.__game.LEVEL.powersAvailable,
  }));
  const okBoot = boot.levelId === id && boot.balls === 10 && boot.spawned === 10 && boot.perches === 4;
  await page.evaluate(() => { const X = window.__game, p = X.pointAt(12); X.shootAt(p.x, p.z); });
  await page.waitForTimeout(400);
  const shot = await page.evaluate(() => ({ shots: window.__game.G.shots }));
  const pw = await page.evaluate(() => {
    const X = window.__game, out = {};
    for (const t of X.LEVEL.powersAvailable) {
      const before = X.G.powersUsed;
      X.triggerPower(t, X.pointAt(10));
      out[t] = X.G.powersUsed - before;
    }
    return { out, bad: X.triggerPower('__nope__', X.pointAt(10)) };
  });
  const okPw = Object.values(pw.out).every(v => v === 1) && pw.bad === false;
  const ok = okBoot && shot.shots >= 1 && okPw && errors.length === 0;
  console.log(`${id}: ${ok ? 'PASS' : 'FAIL'} boot=${JSON.stringify(boot)} shot=${JSON.stringify(shot)} powers=${JSON.stringify(pw)} errors=${JSON.stringify(errors.slice(0, 3))}`);
  if (!ok) failed++;
  await page.close();
}
await browser.close();
if (failed) { console.error(`LEVELS FAIL: ${failed}/${levels.length}`); process.exit(1); }
console.log(`LEVELS PASS: ${levels.length}/${levels.length}`);
