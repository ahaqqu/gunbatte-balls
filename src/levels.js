/* ============================================================
   LEVELS — declarative environment + ruleset per island (no art,
   no engine code here). A new level = a new data object below +
   one registry entry. It reuses:
     - assets  (src/assets.js: textures, marbles, prop builders)
     - mechanics (src/mechanics.js: chain/pops/spawner, parameterized
       by level.mechanics + level.powersAvailable)
   ============================================================ */

export const DIFFS = { chill: 0.68, normal: 1.0, spicy: 1.28 };
export const PALETTE = [0xe63946, 0x4361ee, 0x2dc653, 0xffc700];
export const PALETTE_CSS = ['#e63946', '#4361ee', '#2dc653', '#ffc700'];
export const BALL_R = 0.72;
export const SPACING = 1.5;

const KOHOLINT_PATH = [
  [-18.5, -15], [-9, -15.5], [0, -15], [9, -15.5], [18.5, -15],
  [20, -11],
  [18.5, -7], [9, -6.5], [0, -7], [-9, -6.5], [-18.5, -7],
  [-20.5, -3],
  [-18.5, 1], [-9, 1.5], [0, 1], [9, 1.5], [16, 1],
  [20, 5],
  [18.5, 9], [9, 9.5], [0, 9], [-9, 9.5], [-14, 10.5],
  [-16, 13], [-14.5, 15],
];

export const koholint = {
  id: 'koholint',
  name: 'Koholint Island',
  levelNo: 1,
  bannerMain: 'LEVEL 1',
  bannerSub: 'Koholint Island — defend the Skull Cave!',
  totalBalls: 40,
  colorsN: 4,
  pathPts2D: KOHOLINT_PATH,
  curveTension: 0.35,
  perches: [[0, -3], [-13.5, 5.5], [20, -3], [-5, 13]],
  skullOffset: [0.4, 0, 0.5],
  portalOffset: [-0.6, 0, 0],
  house: { x: 4, z: 5, rotY: 0.4 },
  shrine: { x: 21.5, z: -0.5, rotY: -0.5 },
  torch: { x: -1.8, z: 7.4 },
  pinwheels: [[6.5, -5.3, 0xe63946], [-8.5, 6.8, 0x4361ee]],
  clearances: {
    skull: { x: -14.5, z: 15, r2: 14 },
    portal: { x: -18.5, z: -15, r2: 9 },
    shrine: { x: 21.5, z: -0.5, r2: 4 },
    house: { x: 4, z: 5, r2: 10 },
    perchR2: 12,
    starR2: 25,
    pathD: 1.9,
  },
  powersAvailable: ['bomb', 'stop', 'frenzy'],
  pickupInterval: 16,
  pickupMax: 3,
  pickupExpiry: 30,
  initialBalls: 10,
  initialHeadS: 14,
  mechanics: {
    rollback: 1.2,
    magnetSpeed: 5.0,
    joinGap: 1.6,        // × SPACING: gap that counts as "just assembled"
    dangerThreshold: 0.72,
    slowFactor: 0.45,
    reverseFactor: -0.85,
    finalStandBrake: 0.85,
    shootCooldown: 0.22,
    leapDur: 0.5,
    projectileSpeed: 26,
    bombRadius: 5.5,
    bombMax: 12,
    holdDur: 6,          // HOLDSEED freeze (Jalak holds the head)
    frenzyMin: 4,        // FRENZYSEED random plucks per trigger
    frenzyMax: 8,
    eagleStoopEvery: 18, // Elang Jawa mischief cadence (s, ±40%)
    eagleGoneDur: 22,    // how long a shot eagle stays away (s, ±20%)
    eagleSpawnEvery: 20, // fresh eagle joins the flock (s, ±20%)
    eagleMaxChill: 3,    // max concurrent eagles by difficulty
    eagleMax: 5,         // normal
    eagleMaxSpicy: 10,   // spicy sky full of thieves
  },
  scatter: { trees: 32, rocks: 20, flowers: 54, grass: 120 },
  fence: [[0.10, 0.30, 1], [0.36, 0.52, -1], [0.62, 0.80, 1]],
};

/* Example 2nd environment: same assets + same engine, different level
   data, different power mix (adds STARDUST), slightly gentler chain
   (bigger rollback, lazier magnet, earlier danger). Proves the
   architecture without touching the default level. */
export const sunsetCove = {
  ...koholint,
  id: 'sunset-cove',
  name: 'Sunset Cove',
  levelNo: 2,
  bannerMain: 'LEVEL 2',
  bannerSub: 'Sunset Cove — same toys, new shoreline!',
  // Mirror the road north↔south so the beach run becomes the north run.
  pathPts2D: KOHOLINT_PATH.map(([x, z]) => [-x, -z]),
  perches: [[0, 3], [13.5, -5.5], [-20, 3], [5, -13]],
  skullOffset: [0.4, 0, 0.5],
  portalOffset: [-0.6, 0, 0],
  house: { x: -4, z: -5, rotY: -0.4 },
  shrine: { x: -21.5, z: 0.5, rotY: 0.5 },
  torch: { x: 1.8, z: -7.4 },
  pinwheels: [[-6.5, 5.3, 0xe63946], [8.5, -6.8, 0x4361ee]],
  clearances: {
    skull: { x: 14.5, z: -15, r2: 14 },
    portal: { x: 18.5, z: 15, r2: 9 },
    shrine: { x: -21.5, z: 0.5, r2: 4 },
    house: { x: -4, z: -5, r2: 10 },
    perchR2: 12,
    starR2: 25,
    pathD: 1.9,
  },
  powersAvailable: ['bomb', 'stop', 'frenzy'],
  mechanics: {
    ...koholint.mechanics,
    rollback: 2.0,
    magnetSpeed: 6.5,
    dangerThreshold: 0.68,
    holdDur: 5,
    frenzyMin: 5,
    frenzyMax: 9,
    pickupInterval: 14,
    eagleStoopEvery: 15,
  },
};

export const LEVELS = { koholint, 'sunset-cove': sunsetCove };
export const DEFAULT_LEVEL_ID = 'koholint';

export function getLevel(id) {
  return LEVELS[id] || LEVELS[DEFAULT_LEVEL_ID];
}

export function listLevels() { return Object.values(LEVELS); }

/* ?level=sunset-cove support ( Falls back to default ). */
export function activeLevelId() {
  try {
    const id = new URLSearchParams(location.search).get('level');
    if (id && LEVELS[id]) return id;
  } catch { /* ignore */ }
  return DEFAULT_LEVEL_ID;
}
