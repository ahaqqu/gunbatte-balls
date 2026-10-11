import { chromium } from 'playwright';
// Balance check: human-like bots play FULL games headlessly (step() with no
// rendering, ~30 sim-steps/sec). Proves the game is winnable AND losable.
// Usage: node test/sim.mjs [games-per-config]
const N = Math.max(1, +(process.argv[2] || 6));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
const errors = [];
page.on('console', m => {
  if (m.text().startsWith('[sim]')) console.log(m.text());
  else if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', e => errors.push(String(e).slice(0, 200)));
await page.goto('http://localhost:8907/index.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game?.simGames, null, { timeout: 60000 });

// PATIENT: decent human — holds fire when nothing matches, swaps, snipes seeds
const patient = { interval: 0.55, noise: 0.025, snipe: 0.7, swap: true, patient: true };
// CASUAL: normal mouse-click human — ~1 shot/sec, average aim, half the seeds
const casual = { interval: 0.9, noise: 0.035, snipe: 0.5, swap: true, patient: true };
// HUMAN: average clicker — fires at the head even with the wrong color
const human = { interval: 0.55, noise: 0.025, snipe: 0.7, swap: true };
// SLOPPY: slow clicks, big wobble, never swaps, ignores seeds
const sloppy = { interval: 1.1, noise: 0.06, snipe: 0.0, swap: false };

async function run(label, skill, diff) {
  const res = await page.evaluate(([n, s, d]) => window.__game.simGames(n, s, d), [N, skill, diff]);
  const wins = res.filter(r => r.win).length;
  const avg = k => Math.round(res.reduce((a, r) => a + r[k], 0) / res.length);
  console.log(`${label} [${diff}]: ${wins}/${res.length} wins | avg score ${avg('score')} | avg time ${avg('time')}s | avg acc ${avg('acc')}%`);
  return { label, diff, wins, n: res.length };
}
await run('PATIENT', patient, 'chill');
await run('PATIENT', patient, 'normal');
await run('PATIENT', patient, 'spicy');
await run('CASUAL ', casual, 'chill');
await run('CASUAL ', casual, 'normal');
await run('HUMAN  ', human, 'normal');
await run('SLOPPY ', sloppy, 'normal');
console.log('ERRORS:', JSON.stringify(errors.slice(0, 8)));
await browser.close();
