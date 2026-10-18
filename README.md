# ◉ GUNBATTE BALLS — Pulau Samalona

**Ganbatte — do your best!** A **toy-diorama marble shooter**.
Guide a big-eyed **tarsius** guardian clinging
to its perch tree, leap between **4 trees** for better angles, blast
seed-shots, match **3+** to pop, and stop 40 marbles from reaching the **Skull Cave**.
Free demo — one level, three difficulties, runs in the browser.

**Play:** `http://localhost:8907/index.html` · **Trailer & download:** `http://localhost:8907/site/index.html`

## Features

- Marble-chain gameplay: serpentine road, magnet catch-up, combos, streak bonuses
- **Power seeds** — Boomseed (area blast), Chillseed (slow-mo), Rewindseed (reverse time)
- Three difficulties (**Chill / Normal / Spicy**), balanced so humans can win *and* lose
- Danger mode (glowing skull, heartbeat, red vignette), difficulty ramp, 1–3 star rating
- Living diorama: animated faceted water, butterflies, pinwheels, torchlight, skull smoke,
  hidden spotted egg shrine, sharp toy-box look (no blur: full-island clarity)
- Fully **procedural chiptune** (WebAudio, zero audio files) + full SFX set
- Pause, mute, best-score persistence, announcements, floating score text, screen shake
- **Attract mode**: `index.html?attract=1` runs a self-playing demo (used by the site trailer)

## Run locally

```bash
npm install          # installs Playwright (test browser) only; game needs no build
npm start            # serve at http://localhost:8907
```

Then open http://localhost:8907/ to play, or http://localhost:8907/site/ for the trailer page.
No build step — Three.js is vendored in `vendor/` (MIT licensed, see `vendor/` header).

> Note: the game uses ES modules, so it must be **served over HTTP** (or hosted on itch.io /
> GitHub Pages / Netlify) — opening `index.html` straight from disk won't work in Chrome.

## Controls

| Input | Action |
|---|---|
| Mouse / touch-drag | aim the guardian |
| Click / release | shoot seed-shot |
| Click a glowing tree / Tab / 1–4 | leap between perch trees |
| Right-click / Space | swap current & next seed |
| P / Esc | pause · M mute |

## Verify (automated QA)

```bash
npm test              # full Playwright smoke: boot, shoot, powers, pause, win, lose
node test/sim.mjs     # balance check: human-like bots play full games fast (win/lose rates)
node test/shots.mjs   # recapture marketing screenshots into site/shots/
node test/winshot.mjs # recapture the victory screenshot
```

## Download / deploy

Ship the whole folder as a static site (itch.io, GitHub Pages, Netlify, any static host).
Entry points: `/index.html` (game), `/site/index.html` (trailer + download).
`site/gunbatte-balls-v1.zip` is the offline bundle (game only, no test files).

## Credits

Original indie demo. Match-3 marble-shooter gameplay with chain pops and power seeds.
Built with Three.js + WebAudio. Ganbatte!
