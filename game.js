import * as THREE from 'three';
import {
  BALL_R as LV_BALL_R, SPACING as LV_SPACING,
  DIFFS as LV_DIFFS, PALETTE as LV_PALETTE, PALETTE_CSS as LV_PALETTE_CSS,
  getLevel, activeLevelId, listLevels,
} from './src/levels.js';
import { POWER_DEFS } from './src/powers.js';
import {
  createState, getActiveColors, randColor as mechRandColor,
  dealColor as mechDealColor, sanitizeHeld as mechSanitize,
  randPower as mechRandPower, baseSpeedFor,
  pointAt as mechPointAt, tangentAt as mechTangentAt,
  spawnBall as mechSpawnBall, popCheck as mechPopCheck,
  insertShot as mechInsertShot, triggerPower as mechTrigger,
} from './src/mechanics.js';
import { makeBallMesh as assetsMakeBallMesh, toy, toyGlow, sculpt, roundRockGeo, R, buildJalak, buildEagle, buildTreasure, TREASURE_LID_OPEN, makeGroundBlob } from './src/assets.js';
import { buildCurve, perchVectors, createNearPathChecker } from './src/environment.js';

/* ============================================================
   GUNBATTE BALLS — Koholint Island  (demo v2, AAA pass)
   Toy-diorama marble shooter: power seeds, streaks, danger mode,
   living island, procedural music. One level, launch-ready demo.
   "Ganbatte" = do your best!
   Architecture:
     - src/assets.js     → reusable toy/ marble/ texture factories
     - src/mechanics.js  → Zuma chain rules (level-parameterized)
     - src/powers.js     → pluggable power-seed registry
     - src/levels.js     → declarative island + ruleset per level
     - src/environment.js→ scene builder (same assets, any level)
   game.js is the composition root: renderer + loop + input + HUD.
   ============================================================ */

/* Active island (?level=id, defaults to koholint). All rules + layout
   below derive from this single LevelDef — new islands reuse assets. */
const LEVEL = getLevel(activeLevelId());
const BALL_R = LV_BALL_R, SPACING = LV_SPACING;
const TOTAL_BALLS = LEVEL.totalBalls, COLORS_N = LEVEL.colorsN;
const DIFFS = LV_DIFFS;
const PALETTE = LV_PALETTE;
const PALETTE_CSS = LV_PALETTE_CSS;
const POWERS = POWER_DEFS;
const PERCHES = perchVectors(LEVEL);
const SHOOTER_POS = PERCHES[0]; // legacy anchor; the live muzzle origin is tarsius.position
const LEAP_DUR = LEVEL.mechanics.leapDur;
const baseSpeed = () => baseSpeedFor(G, LEVEL, DIFFS);

/* ==================== AUDIO (all procedural) ==================== */
let AC = null, master = null, noiseBuf = null;
function audio() {
  if (AC) return true;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = G.muted ? 0 : 1;
    master.connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate * 0.5, AC.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  } catch { return false; }
}
function tone(f0, f1, dur, type = 'sine', vol = 0.12, when = 0) {
  if (!AC || G.muted) return;
  const t = AC.currentTime + when;
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(Math.max(30, f0), t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.03);
}
function noise(dur = 0.4, vol = 0.25, freq = 800, when = 0) {
  if (!AC || G.muted) return;
  const t = AC.currentTime + when;
  const s = AC.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
  const g = AC.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.03);
}
function sfx(kind) {
  if (G.sim || G.muted || !audio()) return;
  if (AC.state === 'suspended') AC.resume();
  const N = { C5: 72, D5: 74, E5: 76, G5: 79, A5: 81, C6: 84 };
  const mf = m => 440 * Math.pow(2, (m - 69) / 12);
  switch (kind) {
    case 'shoot': tone(700, 220, 0.12, 'square', 0.07); break;
    case 'pop': tone(520, 940, 0.14, 'sine', 0.12); tone(780, 1400, 0.1, 'sine', 0.06, 0.03); break;
    case 'big': tone(300, 1200, 0.28, 'sawtooth', 0.09); noise(0.2, 0.1, 2000); break;
    case 'bomb': noise(0.5, 0.3, 500); tone(140, 32, 0.5, 'sawtooth', 0.2); break;
    case 'power': [76, 79, 81, 84].forEach((m, i) => tone(mf(m), mf(m), 0.12, 'triangle', 0.1, i * 0.06)); break;
    case 'swap': tone(600, 800, 0.07, 'sine', 0.07); break;
    case 'warn': tone(70, 55, 0.25, 'sine', 0.22); tone(70, 55, 0.25, 'sine', 0.22, 0.3); break;
    case 'heart': tone(65, 50, 0.16, 'sine', 0.2); tone(60, 48, 0.14, 'sine', 0.16, 0.18); break;
    case 'win': [72, 76, 79, 84, 88].forEach((m, i) => tone(mf(m), mf(m), 0.22, 'triangle', 0.12, i * 0.11)); break;
    case 'lose': [67, 64, 60, 55].forEach((m, i) => tone(mf(m), mf(m) * 0.97, 0.3, 'sawtooth', 0.08, i * 0.18)); break;
    case 'click': tone(880, 880, 0.05, 'square', 0.05); break;
    case 'leap': tone(280, 760, 0.18, 'sine', 0.1); tone(560, 990, 0.12, 'sine', 0.06, 0.08); break;
    case 'grab': tone(900, 1400, 0.1, 'triangle', 0.1); tone(1200, 1700, 0.08, 'sine', 0.07, 0.06); break;
    case 'hold': tone(220, 440, 0.3, 'triangle', 0.12); tone(330, 660, 0.3, 'sine', 0.08, 0.1); break;
    case 'frenzy': [88, 92, 95, 100].forEach((m, i) => tone(mf(m), mf(m) * 1.02, 0.1, 'sawtooth', 0.08, i * 0.05)); break;
    case 'screech': tone(2400, 900, 0.35, 'sawtooth', 0.09); tone(1800, 700, 0.3, 'square', 0.05, 0.05); break;
  }
}
/* tiny island BGM: plucked pentatonic loop + bass */
const Music = {
  on: false, step: 0, nextT: 0,
  mel: [72,76,79,76, 81,79,76,74, 72,76,79,81, 79,76,74,72,
        72,76,79,76, 81,84,81,79, 76,79,76,74, 72,0,76,0],
  roots: [36, 43, 45, 41],
  start() { if (!audio()) return; this.on = true; this.step = 0; this.nextT = AC.currentTime + 0.1; },
  tick() {
    if (!this.on || !AC || G.muted || AC.state !== 'running') return;
    if (G.status !== 'playing' && G.status !== 'intro') return;
    const mf = m => 440 * Math.pow(2, (m - 69) / 12);
    while (this.nextT < AC.currentTime + 0.35) {
      const dt = Math.max(0, this.nextT - AC.currentTime);
      const m = this.mel[this.step % 32];
      if (m) {
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = 'triangle'; o.frequency.value = mf(m);
        g.gain.setValueAtTime(0.045, AC.currentTime + dt);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dt + 0.19);
        o.connect(g); g.connect(master); o.start(AC.currentTime + dt); o.stop(AC.currentTime + dt + 0.22);
      }
      if (this.step % 4 === 0) {
        const r = this.roots[((this.step / 4) | 0) % 4];
        const o = AC.createOscillator(), g = AC.createGain();
        o.type = 'sine'; o.frequency.value = mf(r);
        g.gain.setValueAtTime(0.055, AC.currentTime + dt);
        g.gain.exponentialRampToValueAtTime(0.001, AC.currentTime + dt + 0.3);
        o.connect(g); g.connect(master); o.start(AC.currentTime + dt); o.stop(AC.currentTime + dt + 0.32);
      }
      this.nextT += 0.21; this.step++;
    }
  },
};

/* ==================== RENDERER / SCENE (sharp toy-box diorama, no blur) ====================
   Direct forward rendering: no EffectComposer, no depth-of-field, no tilt-shift.
   The full circular island renders 100% sharp front-to-back every frame. */
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ef);
scene.fog = new THREE.Fog(0x9fd8ef, 60, 140);

/* Top-down miniature tabletop: OrthographicCamera looking down at ~52deg. */
const FRUSTUM = 40;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
function updateOrthoCamera() {
  const aspect = innerWidth / Math.max(1, innerHeight);
  // Portrait phones are narrow: keep the island's width fitted by expanding
  // the vertical frustum instead of cropping the sides.
  const fit = aspect >= 1 ? FRUSTUM : FRUSTUM / Math.max(0.5, aspect);
  camera.left = (-fit * aspect) / 2; camera.right = (fit * aspect) / 2;
  camera.top = fit / 2; camera.bottom = -fit / 2;
  camera.updateProjectionMatrix();
}
updateOrthoCamera();
camera.position.set(0, 26, 20);
camera.lookAt(0, 0, 1.0);

/* Warm golden-hour sun + clean bright ambient + soft blue-green sky fill:
   crisp top-face glints, shadows soft blue-green, never heavy gray. */
scene.add(new THREE.AmbientLight(0xdfeaff, 0.55));
scene.add(new THREE.HemisphereLight(0xa1d8ff, 0x5e9e3e, 0.85));
const sun = new THREE.DirectionalLight(0xffc87a, 3.1);
sun.position.set(10, 20, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -34; sun.shadow.camera.right = 34;
sun.shadow.camera.top = 34; sun.shadow.camera.bottom = -34;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 70;
sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.03;
sun.shadow.radius = 5;
scene.add(sun);
scene.add(sun.target); sun.target.position.set(0, 0, 0);

/* ---------------- Toy helpers (canonical in src/assets.js) ----------------
   toy / toyGlow / sculpt / roundRockGeo / R are shared asset factories:
   imported above so every level reuses the exact same toy look. */
/* Glassy toy-marble faces: hand-painted swirl + icon per color (equirect canvas).
   Red = heart, Blue = water spiral, Green = leaf, Yellow = star. */
function paintBallFace(x, s, kind) {
  const base = ['#e63946', '#4361ee', '#2dc653', '#ffc700'][kind];
  const light = ['#ff8fa3', '#9db9ff', '#8bf0a4', '#ffe89a'][kind];
  const deep = ['#9d0208', '#1e3fae', '#1a7a37', '#c98a00'][kind];
  x.fillStyle = base; x.fillRect(0, 0, s, s);
  x.lineCap = 'round';
  x.globalAlpha = 0.5; x.strokeStyle = light; x.lineWidth = 13;
  x.beginPath(); x.arc(s * 0.27, s * 0.59, s * 0.24, 0.6, 2.8); x.stroke();
  x.beginPath(); x.arc(s * 0.74, s * 0.47, s * 0.21, 2.6, 5.2); x.stroke();
  x.globalAlpha = 0.35; x.strokeStyle = deep; x.lineWidth = 9;
  x.beginPath(); x.arc(s * 0.5, s * 0.5, s * 0.37, 3.6, 5.6); x.stroke();
  x.globalAlpha = 1;
  x.fillStyle = '#ffffff'; x.strokeStyle = '#ffffff';
  if (kind === 0) { // heart
    x.save(); x.translate(s * 0.5, s * 0.33); x.scale(1.5, 1.5);
    x.beginPath(); x.moveTo(0, 12);
    x.bezierCurveTo(-24, -6, -13, -26, 0, -13);
    x.bezierCurveTo(13, -26, 24, -6, 0, 12); x.fill(); x.restore();
  } else if (kind === 1) { // water spiral
    x.lineWidth = 10; x.beginPath();
    for (let a = 0; a < 19; a++) {
      const r = 3 + a * 1.9, px = s * 0.5 + Math.cos(a * 0.55) * r, py = s * 0.33 + Math.sin(a * 0.55) * r;
      a ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.stroke();
  } else if (kind === 2) { // leaf
    x.save(); x.translate(s * 0.5, s * 0.33); x.rotate(0.5);
    x.beginPath(); x.moveTo(0, -26);
    x.quadraticCurveTo(24, -6, 0, 26); x.quadraticCurveTo(-24, -6, 0, -26); x.fill();
    x.restore();
    x.strokeStyle = '#1a7a37'; x.lineWidth = 5; x.globalAlpha = 0.8;
    x.beginPath(); x.moveTo(s * 0.47, s * 0.24); x.lineTo(s * 0.53, s * 0.42); x.stroke();
    x.globalAlpha = 1;
  } else { // star
    x.save(); x.translate(s * 0.5, s * 0.33); x.fillStyle = '#ff9e00';
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 11 : 26, a = -Math.PI / 2 + (i * Math.PI) / 5;
      i ? x.lineTo(Math.cos(a) * r, Math.sin(a) * r) : x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    x.closePath(); x.fill(); x.restore();
  }
  speckle(x, s, 130, ['#ffffff'], 0.25, 0.5, 0.8, 1.8);
}
const ballFaceTex = [0, 1, 2, 3].map(k =>
  canvasTex(256, (x, s) => paintBallFace(x, s, k)));
function marbleMat(color) {
  const idx = Math.max(0, PALETTE.indexOf(color));
  return new THREE.MeshPhysicalMaterial({ flatShading: false,
    color: 0xffffff, map: ballFaceTex[idx],
    roughness: 0.05, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.03,
    transmission: 0.55, thickness: 0.8, ior: 1.45,
    specularIntensity: 1.0, emissive: color, emissiveIntensity: 0.35,
  });
}
/* Hand-sculpted wobble lives in src/assets.js (sculpt) — see import above. */
/* Softly rounded hand-sculpted rock lives in src/assets.js (roundRockGeo). */

/* ---------------- Procedural toy textures (canvas: zero assets, stays sharp) ----------------
   R (random helper) is the shared asset factory from src/assets.js. */
function canvasTex(size, painter, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  painter(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function speckle(x, s, n, cols, aMin, aMax, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    x.globalAlpha = R(aMin, aMax);
    x.fillStyle = cols[(Math.random() * cols.length) | 0];
    const r = R(rMin, rMax);
    x.beginPath(); x.arc(R(0, s), R(0, s), r, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
}
/* Vibrant warm yellow-green grass: saturated base with sunny blotches + speckle. */
const grassTex = canvasTex(256, (x, s) => {
  x.fillStyle = '#7ad54a'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 34; i++) {
    x.globalAlpha = R(0.10, 0.22);
    x.fillStyle = ['#68bd3a', '#93e75f', '#76cc42', '#8fe063'][(Math.random() * 4) | 0];
    x.beginPath(); x.ellipse(R(0, s), R(0, s), R(12, 42), R(10, 30), R(0, 3), 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  speckle(x, s, 2200, ['#5cab35', '#a4ec7c', '#66c23f', '#b8f493'], 0.15, 0.4, 0.6, 1.8);
}, 9, 9);
/* Worn sand path: warm sand with grain + tiny pebbles. */
const sandTex = canvasTex(256, (x, s) => {
  x.fillStyle = '#e9c37c'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 26; i++) {
    x.globalAlpha = R(0.08, 0.18);
    x.fillStyle = ['#d9ad6b', '#f4dca4', '#dfb76f'][(Math.random() * 3) | 0];
    x.beginPath(); x.ellipse(R(0, s), R(0, s), R(10, 34), R(8, 22), R(0, 3), 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  speckle(x, s, 1500, ['#c99e63', '#f7e3ae', '#d4a86a'], 0.2, 0.45, 0.6, 1.7);
}, 18, 2);
/* Bright cyan water: vivid base with light streaks + sparse glints. */
const waterTex = canvasTex(256, (x, s) => {
  x.fillStyle = '#1fc8ee'; x.fillRect(0, 0, s, s);
  for (let i = 0; i < 30; i++) {
    x.globalAlpha = R(0.10, 0.24);
    x.fillStyle = ['#8ef1ff', '#0e98cc', '#5fe6ff'][(Math.random() * 3) | 0];
    x.beginPath(); x.ellipse(R(0, s), R(0, s), R(14, 46), R(6, 16), R(-0.5, 0.5), 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  speckle(x, s, 380, ['#d8faff', '#a5f0ff'], 0.12, 0.3, 0.6, 1.4);
}, 9, 9);
/* Felt / sculpted-clay micro-relief for bumpMaps (linear, tileable). */
function noiseBump(size, rx, ry, contrast = 26) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#808080'; x.fillRect(0, 0, size, size);
  for (let i = 0; i < 60; i++) {
    const v = 128 + ((Math.random() - 0.5) * 2 * contrast) | 0;
    x.globalAlpha = R(0.2, 0.5);
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.beginPath(); x.ellipse(R(0, size), R(0, size), R(6, 26), R(5, 20), R(0, 3), 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  for (let i = 0; i < 3200; i++) {
    const v = 128 + ((Math.random() - 0.5) * 2 * 46) | 0;
    x.globalAlpha = R(0.25, 0.55);
    x.fillStyle = `rgb(${v},${v},${v})`;
    x.fillRect(R(0, size), R(0, size), R(1, 2.4), R(1, 2.4));
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  return t;
}
const grassBump = noiseBump(256, 9, 9);
const sandBump = noiseBump(256, 18, 2);
/* Soft round AO blob (-alphaMap decal, unlit look via Standard black). */
const blobTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
/* Natural grounding: soft AO disc under chunky props (complements real shadows). */
function groundBlob(x, z, r, opacity = 0.26, squashZ = 1) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24),
    new THREE.MeshStandardMaterial({
      color: 0x14301c, transparent: true, opacity,
      roughness: 1, metalness: 0, alphaMap: blobTex, depthWrite: false,
    }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.665, z);
  m.scale.set(r, r * squashZ, 1);
  m.renderOrder = 1;
  scene.add(m);
  return m;
}

/* ---------------- Post-processing: EffectComposer (toy macro look) ----------------
   RenderPass -> UnrealBloomPass (very subtle: strength 0.22 + high 0.85
   threshold, so only sunny plastic highlights glow) -> TiltShiftPass
   (gentle vertical blur confined to the extreme top/bottom edges for the
   macro-photography miniature illusion; center + HUD stay tack-sharp)
   -> OutputPass (sRGB encode). */
const _fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const _fsGeo = new THREE.PlaneGeometry(2, 2);
function _fsMat(frag, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: frag,
  });
}
class RenderPass {
  constructor(sc, cm) { this.scene = sc; this.camera = cm; }
  render(r, read) { r.setRenderTarget(read); r.render(this.scene, this.camera); }
}
class UnrealBloomPass {
  constructor(strength = 0.22, threshold = 0.85) {
    this.strength = strength; this.threshold = threshold;
    this.brightMat = _fsMat(
      'uniform sampler2D tSrc; uniform float uThr; varying vec2 vUv;' +
      'void main(){ vec4 c = texture2D(tSrc, vUv); float l = dot(c.rgb, vec3(0.299,0.587,0.114));' +
      ' float k = smoothstep(uThr, uThr+0.2, l); gl_FragColor = vec4(c.rgb*k, 1.0); }',
      { tSrc: { value: null }, uThr: { value: threshold } });
    this.blurMat = _fsMat(
      'uniform sampler2D tSrc; uniform vec2 uDir; uniform vec2 uRes; varying vec2 vUv;' +
      'void main(){ vec2 px = uDir / uRes;' +
      ' vec3 c = texture2D(tSrc, vUv).rgb*0.227;' +
      ' c += texture2D(tSrc, vUv+px*1.384).rgb*0.316; c += texture2D(tSrc, vUv-px*1.384).rgb*0.316;' +
      ' c += texture2D(tSrc, vUv+px*3.230).rgb*0.0703; c += texture2D(tSrc, vUv-px*3.230).rgb*0.0703;' +
      ' gl_FragColor = vec4(c, 1.0); }',
      { tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) }, uRes: { value: new THREE.Vector2(1, 1) } });
    const mk = (s) => { const m = new THREE.Mesh(_fsGeo, s); const sc = new THREE.Scene(); sc.add(m); return sc; };
    this.brightScene = mk(this.brightMat); this.blurScene = mk(this.blurMat);
  }
  render(r, read, tmpA, tmpB) {
    const sz = r.getSize(new THREE.Vector2());
    this.brightMat.uniforms.tSrc.value = read.texture;
    r.setRenderTarget(tmpA); r.render(this.brightScene, _fsCam);
    this.blurMat.uniforms.tSrc.value = tmpA.texture;
    this.blurMat.uniforms.uRes.value.set(Math.max(1, sz.x / 2), Math.max(1, sz.y / 2));
    this.blurMat.uniforms.uDir.value.set(1, 0);
    r.setRenderTarget(tmpB); r.render(this.blurScene, _fsCam);
    this.blurMat.uniforms.tSrc.value = tmpB.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1);
    r.setRenderTarget(tmpA); r.render(this.blurScene, _fsCam);
    this.bloomTex = tmpA.texture;
  }
}
class TiltShiftPass {
  // Macro-photography miniature illusion: only the extreme top/bottom edges
  // soften (gentle vertical blur); the playfield center stays tack-sharp.
  // HUD is DOM above the canvas, so it is never blurred.
  constructor() {
    this.mat = _fsMat(
      'uniform sampler2D tDiffuse; uniform sampler2D tBloom; uniform vec2 uRes; uniform float uBloom;' +
      'varying vec2 vUv;' +
      'vec3 sampleAll(vec2 uv){ return texture2D(tDiffuse, uv).rgb + texture2D(tBloom, uv).rgb * uBloom; }' +
      'void main(){ vec3 sharp = sampleAll(vUv);' +
      ' float d = abs(vUv.y - 0.5); float amt = smoothstep(0.36, 0.5, d);' +
      ' vec2 px = 1.0 / uRes;' +
      ' vec3 b = sharp * 0.36;' +
      ' b += sampleAll(vUv + vec2(0., 1.6) * px) * 0.16;' +
      ' b += sampleAll(vUv - vec2(0., 1.6) * px) * 0.16;' +
      ' b += sampleAll(vUv + vec2(0., 3.6) * px) * 0.16;' +
      ' b += sampleAll(vUv - vec2(0., 3.6) * px) * 0.16;' +
      ' gl_FragColor = vec4(mix(sharp, b, amt * 0.75), 1.0); }',
      { tDiffuse: { value: null }, tBloom: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
        uBloom: { value: 0.22 } });
    this.mesh = new THREE.Mesh(_fsGeo, this.mat);
    this.fsScene = new THREE.Scene(); this.fsScene.add(this.mesh);
  }
  render(r, read, write, bloomTex) {
    this.mat.uniforms.tDiffuse.value = read.texture;
    this.mat.uniforms.tBloom.value = bloomTex;
    const sz = r.getSize(new THREE.Vector2());
    this.mat.uniforms.uRes.value.set(sz.x, sz.y);
    r.setRenderTarget(write); r.render(this.fsScene, _fsCam);
  }
}
class OutputPass {
  constructor() {
    // neutralResolve: sRGB encode only (tilt-shift already composited the bloom)
    this.mat = _fsMat(
      'uniform sampler2D tSrc; varying vec2 vUv;' +
      'void main(){ vec3 col = texture2D(tSrc, vUv).rgb;' +
      ' col = max(col, vec3(0.0));' +
      ' float lum = dot(col, vec3(0.299,0.587,0.114)); col = mix(vec3(lum), col, 1.05);' +
      ' vec3 a = col * 12.92; vec3 b = 1.055 * pow(col, vec3(1.0/2.4)) - 0.055;' +
      ' vec3 srgb = mix(a, b, step(vec3(0.0031308), col));' +
      ' gl_FragColor = vec4(srgb, 1.0); }',
      { tSrc: { value: null } });
    this.mesh = new THREE.Mesh(_fsGeo, this.mat);
    this.fsScene = new THREE.Scene(); this.fsScene.add(this.mesh);
  }
  render(r, read) {
    this.mat.uniforms.tSrc.value = read.texture;
    r.setRenderTarget(null); r.render(this.fsScene, _fsCam);
  }
}
class EffectComposer {
  constructor(r) {
    this.renderer = r;
    this.renderPass = null; this.bloomPass = null;
    this.tiltPass = null;
    this.outputPass = null;
    this.enabled = true; this._ok = true;
    try {
      const sz = r.getSize(new THREE.Vector2());
      const mk = (w, h, depth) => {
        const rt = new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), {
          minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: true, stencilBuffer: false,
        });
        if (depth) { rt.depthTexture = new THREE.DepthTexture(Math.max(2, w | 0), Math.max(2, h | 0)); rt.depthTexture.type = THREE.UnsignedIntType; }
        return rt;
      };
      this.rtScene = mk(sz.x, sz.y, true);
      this.rtTilt = mk(sz.x, sz.y, false);
      this.rtBloomA = mk(Math.max(2, sz.x / 2), Math.max(2, sz.y / 2), false);
      this.rtBloomB = mk(Math.max(2, sz.x / 2), Math.max(2, sz.y / 2), false);
    } catch (e) { this._ok = false; }
  }
  addPass(p) {
    if (p instanceof RenderPass) this.renderPass = p;
    else if (p instanceof UnrealBloomPass) this.bloomPass = p;
    else if (p instanceof TiltShiftPass) this.tiltPass = p;
    else if (p instanceof OutputPass) this.outputPass = p;
    return this;
  }
  setSize(w, h) {
    const rSet = (rt, ww, hh) => {
      rt.setSize(Math.max(2, ww | 0), Math.max(2, hh | 0));
      if (rt.depthTexture) { rt.depthTexture.image.width = Math.max(2, ww | 0); rt.depthTexture.image.height = Math.max(2, hh | 0); }
    };
    if (this.rtScene) rSet(this.rtScene, w, h);
    if (this.rtTilt) rSet(this.rtTilt, w, h);
    if (this.rtBloomA) rSet(this.rtBloomA, w / 2, h / 2);
    if (this.rtBloomB) rSet(this.rtBloomB, w / 2, h / 2);
  }
  render() {
    if (!this.enabled || !this._ok || !this.renderPass) { this.renderer.setRenderTarget(null); this.renderer.render(scene, camera); return; }
    try {
      this.renderPass.render(this.renderer, this.rtScene);
      let bloomTex = null;
      if (this.bloomPass) { this.bloomPass.render(this.renderer, this.rtScene, this.rtBloomA, this.rtBloomB); bloomTex = this.bloomPass.bloomTex; }
      if (this.tiltPass) this.tiltPass.render(this.renderer, this.rtScene, this.rtTilt, bloomTex || this.rtBloomA.texture);
      if (this.outputPass) this.outputPass.render(this.renderer, this.rtTilt);
      else { this.renderer.setRenderTarget(null); this.renderer.render(scene, camera); }
    } catch (e) { this.enabled = false; this.renderer.setRenderTarget(null); this.renderer.render(scene, camera); }
  }
}
let composer = null;
try {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(0.22, 0.85));
  composer.addPass(new TiltShiftPass());
  composer.addPass(new OutputPass());
} catch (e) { composer = null; }


/* ---- gradient sky dome + sun disc ---- */
{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {},
    vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vP;
      void main(){ float h=normalize(vP).y;
        vec3 zen=vec3(0.24,0.5,0.85), mid=vec3(0.56,0.83,0.94), hor=vec3(0.92,0.97,0.93);
        vec3 c = h>0.25 ? mix(mid,zen,smoothstep(0.25,0.9,h)) : mix(hor,mid,smoothstep(-0.08,0.25,h));
        gl_FragColor=vec4(c,1.0); }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(170, 24, 16), skyMat));
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(7, 32),
    new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: 0xfff6c9, emissive: 0xfff6c9, emissiveIntensity: 0.85, fog: false }));
  sunDisc.position.set(-55, 42, -120); sunDisc.lookAt(0, 10, 0);
  scene.add(sunDisc);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(13, 32),
    new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: 0xfff6c9, emissive: 0xfff6c9, emissiveIntensity: 0.85, transparent: true, opacity: 0.35, fog: false }));
  glow.position.copy(sunDisc.position).add(new THREE.Vector3(0, 0, -0.5)); glow.lookAt(0, 10, 0);
  scene.add(glow);
}

/* ---- animated toy water: rich texture + foam ring + bubble dots ---- */
let waterMesh, waterBase;
const foamBubbles = [];
{
  const g = new THREE.PlaneGeometry(190, 190, 46, 46);
  waterMesh = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial({ flatShading: true,
    color: 0xffffff, map: waterTex, roughness: 0.2, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.1,
  }));
  waterMesh.rotation.x = -Math.PI / 2; waterMesh.position.y = -1.65;
  waterMesh.receiveShadow = true;
  scene.add(waterMesh);
  waterBase = g.attributes.position.array.slice();
  const foamMat = new THREE.MeshPhysicalMaterial({ flatShading: true,
    color: 0xffffff, roughness: 0.2, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.1,
  });
  const foam1 = new THREE.Mesh(new THREE.TorusGeometry(26.4, 0.55, 12, 88), foamMat);
  foam1.rotation.x = Math.PI / 2; foam1.position.y = -1.35; foam1.name = 'foam1';
  scene.add(foam1);
  const foam2 = new THREE.Mesh(new THREE.TorusGeometry(28.1, 0.32, 10, 88),
    new THREE.MeshPhysicalMaterial({ flatShading: true,
      color: 0xffffff, transparent: true, opacity: 0.6, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1,
    }));
  foam2.rotation.x = Math.PI / 2; foam2.position.y = -1.45; foam2.name = 'foam2';
  scene.add(foam2);
/* Streaky foam alpha texture: bright white surf with soft gaps (scrolls like surf). */
const foamTex = (() => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 256, 64);
  for (let i = 0; i < 46; i++) {
    x.globalAlpha = R(0.35, 0.9);
    x.fillStyle = '#ffffff';
    x.beginPath(); x.ellipse(R(0, 256), R(8, 56), R(10, 30), R(4, 12), R(-0.3, 0.3), 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  for (let i = 0; i < 260; i++) {
    x.globalAlpha = R(0.4, 0.95);
    x.fillStyle = '#ffffff';
    x.beginPath(); x.arc(R(0, 256), R(0, 64), R(0.8, 2.4), 0, 7); x.fill();
  }
  x.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 1);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
})();
const foamCollarMat = new THREE.MeshPhysicalMaterial({ flatShading: true,
  color: 0xffffff, map: foamTex, roughness: 0.2, metalness: 0.0,
  clearcoat: 1.0, clearcoatRoughness: 0.1,
  transparent: true, opacity: 0.95, side: THREE.DoubleSide,
});
{
  // solid foam collar hugging the island exactly at the waterline (r≈12.3 @ y=-1.65)
  const collar = new THREE.Mesh(
    new THREE.CylinderGeometry(23.45, 22.9, 0.62, 80, 1, true), foamCollarMat);
  collar.position.y = -1.5; collar.name = 'foamCollar';
  scene.add(collar);
}
  // tiny white foam bubbles scattered around the circular island border
  const bubMat = new THREE.MeshPhysicalMaterial({ flatShading: true,
    color: 0xffffff, roughness: 0.2, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.1,
  });
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + R(-0.08, 0.08);
    const rr = 26.4 + R(-0.5, 0.9);
    const b = new THREE.Mesh(new THREE.SphereGeometry(R(0.1, 0.2), 10, 8), bubMat);
    b.position.set(Math.cos(a) * rr, -1.32, Math.sin(a) * rr);
    b.scale.y = 0.6;
    b.userData = { a, rr, ph: R(0, 6.28), y0: -1.32 };
    foamBubbles.push(b); scene.add(b);
  }
}

/* ---- island diorama base (open-ended side: no z-fighting) ---- */
const island = new THREE.Group(); scene.add(island);
{
  const side = new THREE.Mesh(
    new THREE.CylinderGeometry(26, 22, 3.2, 64, 1, true),
    new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x9c6b3c, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, side: THREE.DoubleSide })
  );
  side.position.y = -1.02; side.receiveShadow = true; side.castShadow = true;
  island.add(side);
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(26, 26, 0.5, 64),
    new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xffffff, map: grassTex, bumpMap: grassBump, bumpScale: 0.15, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1})
  );
  top.position.y = 0.35; top.receiveShadow = true;
  island.add(top);
  const patchMat = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x66c142, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const patchMat2 = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x9cec7c, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  [[-6,-4,3.2],[6,-4.5,2.6],[-3,6.5,2.8],[7,5.5,2.2],[0,-5.5,2.0],[-10,3,2.0],[11,0,1.8],
   [-13,9,2.8],[13,-9,3.0],[-15,-6,2.4],[15,11,2.6],[0,13,2.4],[-8,-13,2.6],
   [-19,4,2.6],[19,-3,2.8],[-6,17,2.4],[4,-18,2.6]]
    .forEach(([x, z, r], i) => {
      const p = new THREE.Mesh(new THREE.CircleGeometry(r, 24), i % 2 ? patchMat2 : patchMat);
      p.rotation.x = -Math.PI / 2; p.position.set(x, 0.64, z); p.receiveShadow = true;
      island.add(p);
    });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(25.35, 0.7, 12, 96),
    new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xf2dfa8, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.35; rim.receiveShadow = true;
  island.add(rim);
}

/* ---- marble path (from the active LevelDef — same builder, any island) ---- */
const pathPts2D = LEVEL.pathPts2D;
const { curve, curveLen } = buildCurve(LEVEL);
{
  // worn inset border: darker sand rim peeking under the road edges
  const tube0 = new THREE.TubeGeometry(curve, 220, 1.14, 12, false);
  tube0.scale(1, 0.3, 1); tube0.computeVertexNormals();
  const border = new THREE.Mesh(tube0, new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xc49a63, map: sandTex, bumpMap: sandBump, bumpScale: 0.12, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  border.position.y = 0.1; border.receiveShadow = true;
  scene.add(border);
  const tube = new THREE.TubeGeometry(curve, 220, 1.0, 12, false);
  tube.scale(1, 0.35, 1); tube.computeVertexNormals();
  const road = new THREE.Mesh(tube, new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xffffff, map: sandTex, bumpMap: sandBump, bumpScale: 0.12, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  road.position.y = 0.15; road.receiveShadow = true;
  scene.add(road);
  const tube2 = new THREE.TubeGeometry(curve, 220, 0.62, 12, false);
  tube2.scale(1, 0.35, 1); tube2.computeVertexNormals();
  const inner = new THREE.Mesh(tube2, new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xf7e2ac, map: sandTex, bumpMap: sandBump, bumpScale: 0.12, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  inner.position.y = 0.42; inner.receiveShadow = true;
  scene.add(inner);
  const start = curve.getPointAt(0);
  const portal = new THREE.Group();
  const rockMat = new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0x7d8597, roughness: 0.2, });
  const m1 = new THREE.Mesh(roundRockGeo(1.6), rockMat);
  m1.position.set(-0.9, 1.0, 0); m1.castShadow = true;
  const m2 = new THREE.Mesh(roundRockGeo(1.6), rockMat);
  m2.position.set(0.9, 1.0, 0); m2.castShadow = true;
  const mtop = new THREE.Mesh(roundRockGeo(1.7), rockMat);
  mtop.position.set(0, 2.2, 0); mtop.castShadow = true;
  const hole = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24),
    new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: 0x14101f , emissive: 0x14101f, emissiveIntensity: 0.85}));
  hole.position.set(0, 0.9, 0.9);
  portal.add(m1, m2, mtop, hole);
  portal.position.copy(start).add(new THREE.Vector3(...LEVEL.portalOffset));
  { // face the exit hole along the starting tangent so marbles pour onto the road
    const st = curve.getTangentAt(0);
    portal.rotation.y = Math.atan2(st.x, st.z);
  }
  scene.add(portal);
  groundBlob(start.x - 0.6, start.z, 2.3, 0.28);
}

/* ---- skull cave (glowing eyes, teeth, smoke) ---- */
const skullPos = curve.getPointAt(1);
let skullEyeMat, skullMouth, skullCave = null, skullMound = null;
{
  const g = new THREE.Group();
  const stone = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x8d99ae, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const bone = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xf8f3df, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  // chunky organic mound: squashed boulder + side bumps (no sharp cone)
  const mound = new THREE.Mesh(sculpt(new THREE.IcosahedronGeometry(3.1, 2), 0.12), stone);
  mound.position.y = 1.6; mound.scale.set(1, 0.78, 0.95);
  mound.castShadow = true; mound.receiveShadow = true;
  g.add(mound);
  [[-2.4, 1.0, 0.4, 1.3], [2.4, 0.9, -0.3, 1.45], [0.2, 1.2, -2.3, 1.2]].forEach(([bx, by, bz, br]) => {
    const bump = new THREE.Mesh(sculpt(new THREE.IcosahedronGeometry(br, 1), 0.08), stone);
    bump.position.set(bx, by, bz); bump.castShadow = true; bump.receiveShadow = true;
    g.add(bump);
  });
  // moss blobs + draping moss beard over the crown
  const mossM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x6fae5a, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  [[-1.4, 2.9, 1.5, 0.55], [1.6, 2.5, 1.3, 0.45], [0.4, 3.4, -0.6, 0.6], [-0.9, 3.8, 0.4, 0.5], [1.2, 3.6, -0.2, 0.42]].forEach(([bx, by, bz, br]) => {
    const mo = new THREE.Mesh(new THREE.SphereGeometry(br, 12, 10), mossM);
    mo.position.set(bx, by, bz); mo.scale.y = 0.45;
    g.add(mo);
  });
  // creeping vines spilling over the top with leaf dots
  const vineM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x3d8b4f, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const vineLeafM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x5cc46a, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  [[-1.8, 0.6], [-0.7, 1.4], [0.5, 1.1], [1.7, 0.2], [2.5, -0.6]].forEach(([vx, vz], vi) => {
    const top = new THREE.Vector3(vx, 4.1 - (vi % 2) * 0.3, vz);
    const mid = new THREE.Vector3(vx * 1.25, 2.5, vz + 1.1);
    const end = new THREE.Vector3(vx * 1.1, 1.0 + (vi % 3) * 0.3, vz + 2.1);
    const vc = new THREE.CatmullRomCurve3([top, mid, end]);
    const vine = new THREE.Mesh(new THREE.TubeGeometry(vc, 20, 0.07, 6), vineM);
    vine.castShadow = true;
    g.add(vine);
    [0.3, 0.55, 0.8].forEach((tt, li) => {
      const p = vc.getPointAt(tt);
      const lf = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), vineLeafM);
      lf.position.copy(p); lf.scale.set(1.3, 0.5, 0.7);
      lf.rotation.z = (li - 1) * 0.7;
      g.add(lf);
    });
  });
  skullMouth = new THREE.Mesh(new THREE.CircleGeometry(1.25, 24),
    new THREE.MeshPhysicalMaterial({ flatShading: true, roughness: 0.2, metalness: 0.0, color: 0x0d0a1a, emissive: 0x0d0a1a, emissiveIntensity: 0.7, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  skullMouth.position.set(0, 1.0, 2.78);
  g.add(skullMouth);
  // chunky stone lips around the cave mouth
  const lips = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.3, 12, 28), stone);
  lips.position.set(0, 1.0, 2.72); lips.castShadow = true;
  g.add(lips);
  // big hand-sculpted upper fangs + chunky lower teeth
  [-0.85, 0.85].forEach(tx => {
    const fang = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 4, 10), bone);
    fang.position.set(tx, 1.75, 2.75); fang.castShadow = true;
    g.add(fang);
  });
  [-0.3, 0.3].forEach(tx => {
    const tooth = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.18, 4, 10), bone);
    tooth.position.set(tx, 0.35, 2.8); tooth.castShadow = true;
    g.add(tooth);
  });
  const skull = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 16),
    new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xf8f3df, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  skull.position.set(0, 3.6, 1.4); skull.scale.set(1, 0.9, 0.8); skull.castShadow = true;
  g.add(skull);
  // heavy brow ridges + chunky jaw for a toy-monster read
  [-0.48, 0.48].forEach(bx => {
    const brow = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 12), stone);
    brow.position.set(bx, 4.05, 1.85); brow.scale.set(1.1, 0.6, 0.8); brow.castShadow = true;
    g.add(brow);
  });
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), bone);
  jaw.position.set(0, 0.15, 2.2); jaw.scale.set(1.15, 0.55, 0.9); jaw.castShadow = true;
  g.add(jaw);
  skullEyeMat = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x3a0d0d, emissive: 0xff2200, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  [-0.45, 0.45].forEach(x => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skullEyeMat);
    e.position.set(x, 3.7, 2.15); g.add(e);
  });
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshPhysicalMaterial({ flatShading: true, roughness: 0.2, metalness: 0.0, color: 0x1a1a2e, emissive: 0x1a1a2e, emissiveIntensity: 0.7, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  nose.position.set(0, 3.35, 2.25); nose.scale.set(1, 1.2, 0.6); g.add(nose);
  g.position.copy(skullPos).add(new THREE.Vector3(...LEVEL.skullOffset));
  { // mouth + eyes face back down the road so the skull greets its dinner
    const prev = curve.getPointAt(0.985);
    g.lookAt(prev.x, g.position.y, prev.z);
  }
  scene.add(g);
  skullCave = g; skullMound = mound;
  groundBlob(skullPos.x + LEVEL.skullOffset[0], skullPos.z + LEVEL.skullOffset[2], 3.4, 0.3);
}
const smokes = [];
{
  const sm = new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: 0x555566, emissive: 0x555566, emissiveIntensity: 0.85, transparent: true, opacity: 0.35 });
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.3, 14, 10), sm.clone());
    s.position.copy(skullPos).add(new THREE.Vector3(0.4 + Math.random(), 4.5 + i * 0.7, 0.5));
    s.userData.t = Math.random() * 3;
    smokes.push(s); scene.add(s);
  }
}

/* ---- Wind Fish egg shrine (hidden on the beach — a tiny homage) ---- */
{
  const shrine = new THREE.Group();
  const nest = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.28, 10, 18),
    new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0x8d99ae, roughness: 0.2, }));
  nest.rotation.x = Math.PI / 2; nest.position.y = 0.25; nest.castShadow = true;
  shrine.add(nest);
  const egg = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12),
    new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0xfdf6e3, roughness: 0.2, }));
  egg.scale.set(1, 1.3, 1); egg.position.y = 0.65; egg.castShadow = true;
  shrine.add(egg);
  const spotM = new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0x9d4edd, roughness: 0.2, });
  [[0.2, 0.7, 0.3], [-0.25, 0.55, 0.28], [0, 0.9, -0.3]].forEach(([ox, oy, oz]) => {
    const d = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), spotM);
    d.position.set(ox, oy, oz); shrine.add(d);
  });
  shrine.position.set(LEVEL.shrine.x, 0.6, LEVEL.shrine.z);
  shrine.rotation.y = LEVEL.shrine.rotY;
  scene.add(shrine);
  groundBlob(LEVEL.shrine.x, LEVEL.shrine.z, 1.1, 0.24);
}

/* ---- toy decorations ---- */
function chibiTree(x, z, s = 1) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.28 * s, 0.36 * s, 1.0 * s, 16),
    new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0x7f4f24, roughness: 0.2, }));
  trunk.position.y = 0.5 * s; trunk.castShadow = true;
  g.add(trunk);
  const greens = [0x37b24d, 0x4cc96f, 0x6fdc73];
  [[0, 1.5, 0, 0.95], [-0.4, 1.15, 0.15, 0.6], [0.42, 1.2, -0.1, 0.62]].forEach(([ox, oy, oz, r], i) => {
    // lower-poly hand-sculpted canopy blobs (faceted felt, not perfect spheres)
    const f = new THREE.Mesh(sculpt(new THREE.IcosahedronGeometry(r * s, 1), 0.09 * s),
      new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: greens[i % 3], roughness: 0.2, }));
    f.position.set(ox * s, oy * s, oz * s); f.castShadow = true;
    g.add(f);
  });
  g.position.set(x, 0.5, z);
  g.rotation.y = Math.random() * 6;
  g.userData.treeTop = true;
  scene.add(g);
  groundBlob(x, z, 1.25 * s, 0.26);
}
function rock(x, z, s = 1) {
  const m = new THREE.Mesh(roundRockGeo(0.5 * s),
    new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0xadb5bd, roughness: 0.2, }));
  m.position.set(x, 0.75, z); m.castShadow = true; m.rotation.set(Math.random(), Math.random() * 3, 0);
  scene.add(m);
  groundBlob(x, z, 0.85 * s, 0.24);
}
function flower(x, z, c) {
  const g = new THREE.Group();
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 10),
    new THREE.MeshPhysicalMaterial({ flatShading: true, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0x2d6a4f }));
  stem.position.y = 0.25; g.add(stem);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8),
    new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: c, roughness: 0.2, }));
  head.position.y = 0.55; head.castShadow = true;
  head.name = 'bloom';
  g.add(head);
  g.position.set(x, 0.55, z); scene.add(g);
}
/* Scattered 3D grass: tiny 2-3 triangle blade clusters (single-sided tris). */
const bladeGeo = (() => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(
    [-0.09, 0, 0, 0.09, 0, 0, 0, 0.5, 0.03], 3));
  geo.computeVertexNormals();
  return geo;
})();
const bladeMats = [0x3a9e4f, 0x46b457, 0x2f8f43].map(c =>
  new THREE.MeshPhysicalMaterial({ flatShading: true, color: c, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, side: THREE.DoubleSide }));
function grassTuft(x, z) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(bladeGeo, bladeMats[(Math.random() * 3) | 0]);
    b.position.set((i - 1) * 0.11, 0, (Math.random() - 0.5) * 0.1);
    b.rotation.y = R(0, Math.PI);
    b.rotation.x = R(-0.12, 0.12);
    const s = R(0.8, 1.25); b.scale.set(s, s, s);
    g.add(b);
  }
  g.position.set(x, 0.6, z);
  g.rotation.y = R(0, 6.28);
  scene.add(g);
}
const pinwheels = [];
function pinwheel(x, z, c) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 12),
    new THREE.MeshPhysicalMaterial({ flatShading: true, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0x8a5a33 }));
  pole.position.y = 0.8; pole.castShadow = true; g.add(pole);
  const hub = new THREE.Group(); hub.position.y = 1.65;
  const paddleGeo = new THREE.SphereGeometry(0.3, 12, 10);
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(paddleGeo,
      new THREE.MeshPhysicalMaterial({ flatShading: true, color: i % 2 ? 0xffffff : c, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
    blade.scale.set(1, 0.68, 0.14);
    blade.position.set(Math.cos(i * Math.PI / 2) * 0.3, Math.sin(i * Math.PI / 2) * 0.3, 0);
    blade.rotation.z = i * Math.PI / 2 + 0.5;
    blade.castShadow = true;
    hub.add(blade);
  }
  g.add(hub); pinwheels.push(hub);
  g.position.set(x, 0.55, z); g.rotation.y = 0.6;
  scene.add(g);
  groundBlob(x, z, 0.7, 0.22);
}
/* Scatter guard: path + clearings, from the active LevelDef via
   src/environment.js (same helper every island uses). */
const nearPath = createNearPathChecker(LEVEL, curve, SHOOTER_POS);
/* ---- perch trees: climbable pines the tarsius clings to and leaps between ----
   Each gets a glow ring (active perch pulses green) + a generous invisible
   hit-cylinder so tapping the tree (mouse or touch) orders a leap. */
const perchRings = [], perchHit = [];
{
  // Tall climbable pine: thick trunk the tarsius hugs + high canopy that
  // crowns well above his straw hat (he reads as clinging, not standing).
  const trunkM = new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0x7f4f24, roughness: 0.2 });
  const canopyCols = [0x37b24d, 0x4cc96f, 0x6fdc73];
  function perchTree(x, z) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.0, 6.4, 16), trunkM);
    trunk.position.y = 3.2; trunk.castShadow = true; trunk.receiveShadow = true;
    g.add(trunk);
    // rounded crown-friendly trunk top (no flat stovepipe disc)
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.75, 16, 12), trunkM);
    cap.position.y = 6.4; cap.scale.y = 0.55; cap.castShadow = true;
    g.add(cap);
    // knobbly bark bumps spiralling up the trunk
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, b = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), trunkM);
      b.position.set(Math.cos(a) * 0.9, 0.9 + i * 0.65, Math.sin(a) * 0.9);
      b.scale.set(1, 0.7, 1); g.add(b);
    }
    // high compact umbrella canopy, lifted well clear of the straw hat and
    // pulled to the back so the south face where he clings stays open
    [[0, 7.6, -1.5, 1.0], [-1.35, 6.9, -1.3, 0.9], [1.4, 7.0, -1.35, 0.95], [0.1, 6.5, -2.1, 0.8]].forEach(([ox, oy, oz, r], i) => {
      const f = new THREE.Mesh(sculpt(new THREE.IcosahedronGeometry(r, 1), 0.12),
        new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: canopyCols[i % 3], roughness: 0.2 }));
      f.position.set(ox, oy, oz); f.castShadow = true;
      g.add(f);
    });
    // hanging vines with leaf tufts (tarsier playground dressing)
    const vineM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x2f9e44, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 });
    [[1.0, 0.3], [-1.0, -0.35]].forEach(([vx, vz], vi) => {
      const v = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.8 - vi * 0.3, 8), vineM);
      v.position.set(vx, 4.7, vz); g.add(v);
      const tuft = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), vineM);
      tuft.position.set(vx, 3.75 - vi * 0.3, vz); tuft.scale.set(1.2, 0.8, 1.2); tuft.castShadow = true;
      g.add(tuft);
    });
    g.position.set(x, 0.5, z);
    g.rotation.y = Math.random() * 6;
    g.rotation.x = -0.07; // faint organic lean so no two perches match
    scene.add(g);
    groundBlob(x, z, 1.7, 0.26);
  }
  const hitM = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  PERCHES.forEach((p, i) => {
    perchTree(p.x, p.z);
    const ringM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xffe8a3,
      emissive: 0xffe8a3, emissiveIntensity: 0.25, roughness: 0.2, metalness: 0.0,
      clearcoat: 1.0, clearcoatRoughness: 0.1 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.16, 10, 32), ringM);
    ring.rotation.x = Math.PI / 2; ring.position.set(p.x, 0.75, p.z);
    scene.add(ring); perchRings.push(ring);
    const hit = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.0, 7.5, 8), hitM);
    hit.position.set(p.x, 3.2, p.z); hit.userData.perch = i;
    scene.add(hit); perchHit.push(hit);
  });
}
{
  let placed = 0, guard = 0;
  while (placed < LEVEL.scatter.trees && guard++ < 900) {
    const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 21;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.95;
    if (nearPath(x, z)) continue;
    chibiTree(x, z, 0.8 + Math.random() * 0.7); placed++;
  }
  for (let i = 0; i < LEVEL.scatter.rocks; i++) {
    const a = Math.random() * 6.28, r = 4 + Math.random() * 18;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (nearPath(x, z, 1.4)) continue;
    rock(x, z, 0.7 + Math.random() * 0.9);
  }
  const fc = [0xff5d8f, 0xffca3a, 0xff595e, 0xffffff, 0xc77dff];
  for (let i = 0; i < LEVEL.scatter.flowers; i++) {
    const a = Math.random() * 6.28, r = 2.5 + Math.random() * 21;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (nearPath(x, z, 1.2)) continue;
    flower(x, z, fc[i % fc.length]);
  }
  for (let i = 0; i < LEVEL.scatter.grass; i++) {
    const a = Math.random() * 6.28, r = 2 + Math.random() * 22;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (nearPath(x, z, 1.0)) continue;
    grassTuft(x, z);
  }
  // chunky storybook house: rounded walls, timber corners, fat pyramid roof
  const house = new THREE.Group();
  const wallM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xfff3d6, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const woodM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x7c5233, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const roofM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xd62828, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const roofDark = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xa81f1f, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const roundedBoxGeo = (w, h, d, r) => {
    const s = new THREE.Shape();
    const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
    s.moveTo(x0 + r, y0);
    s.lineTo(x1 - r, y0); s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false);
    s.lineTo(x1, y1 - r); s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
    s.lineTo(x0 + r, y1); s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false);
    s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
    const bv = Math.min(r * 0.5, 0.1);
    const geo = new THREE.ExtrudeGeometry(s, { depth: d - bv * 2, bevelEnabled: true, bevelThickness: bv, bevelSize: bv, bevelSegments: 2, curveSegments: 8 });
    geo.translate(0, 0, -(d - bv * 2) / 2);
    return geo;
  };
  const base = new THREE.Mesh(roundedBoxGeo(2.6, 1.6, 2.2, 0.28), wallM);
  base.position.y = 0.8; base.castShadow = true; base.receiveShadow = true; house.add(base);
  // chunky corner timber posts with round caps
  [[-1.2, -1.0], [1.2, -1.0], [-1.2, 1.0], [1.2, 1.0]].forEach(([px, pz]) => {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 1.6, 12), woodM);
    post.position.set(px, 0.8, pz); post.castShadow = true; house.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), woodM);
    cap.position.set(px, 1.62, pz); cap.castShadow = true; house.add(cap);
  });
  // fat pyramid roof with eave slab + ridge beams + finial knob
  const eave = new THREE.Mesh(new THREE.CylinderGeometry(2.05, 2.15, 0.28, 4, 1), roofDark);
  eave.position.y = 1.72; eave.rotation.y = Math.PI / 4; eave.castShadow = true; house.add(eave);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.0, 1.35, 4, 1), roofM);
  roof.position.y = 2.5; roof.rotation.y = Math.PI / 4; roof.castShadow = true; house.add(roof);
  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), roofDark);
  finial.position.y = 3.25; finial.castShadow = true; house.add(finial);
  // rounded capsule door + round glowing window with timber ring
  const door = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.42, 4, 12),
    new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x6c584c, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  door.position.set(-0.45, 0.62, 1.08); door.scale.z = 0.4; house.add(door);
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8),
    new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xffd166, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  knob.position.set(-0.25, 0.62, 1.2); house.add(knob);
  const winRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.09, 10, 20), woodM);
  winRing.position.set(0.75, 1.05, 1.1); house.add(winRing);
  const winGlow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20),
    new THREE.MeshPhysicalMaterial({ flatShading: true, roughness: 0.2, metalness: 0.0, color: 0xffd166, emissive: 0xffd166, emissiveIntensity: 0.7, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  winGlow.position.set(0.75, 1.05, 1.11); house.add(winGlow);
  // round stone chimney with cap
  const chim = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 1.0, 14),
    new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x9aa0a8, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  chim.position.set(-0.85, 2.35, -0.35); chim.castShadow = true; house.add(chim);
  const chimCap = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), roofDark);
  chimCap.position.set(-0.85, 2.9, -0.35); chimCap.scale.y = 0.6; house.add(chimCap);
  house.position.set(LEVEL.house.x, 0.5, LEVEL.house.z); house.rotation.y = LEVEL.house.rotY;
  scene.add(house);
  groundBlob(LEVEL.house.x, LEVEL.house.z, 2.5, 0.28);
  // torch with round teardrop flame (no sharp cones)
  const torch = new THREE.Group();
  const tpole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 1.8, 14),
    new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x5c3a1e, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  tpole.position.y = 0.9; tpole.castShadow = true; torch.add(tpole);
  const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.13, 0.22, 12),
    new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x3d2b1c, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  cup.position.y = 1.85; torch.add(cup);
  const flame = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12),
    new THREE.MeshPhysicalMaterial({ flatShading: true, roughness: 0.2, metalness: 0.0, color: 0xff7b00, emissive: 0xff7b00, emissiveIntensity: 0.9, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  flame.position.y = 2.15; flame.scale.set(1, 1.5, 1); flame.name = 'flame'; torch.add(flame);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10),
    new THREE.MeshPhysicalMaterial({ flatShading: true, roughness: 0.2, metalness: 0.0, color: 0xffe66d, emissive: 0xffe66d, emissiveIntensity: 1.0, clearcoat: 1.0, clearcoatRoughness: 0.1}));
  core.position.y = 2.1; torch.add(core);
  const tl = new THREE.PointLight(0xff9d3c, 6, 11, 1.6);
  tl.position.y = 2.3; tl.name = 'torchlight'; torch.add(tl);
  torch.position.set(LEVEL.torch.x, 0.5, LEVEL.torch.z);
  scene.add(torch);
  groundBlob(LEVEL.torch.x, LEVEL.torch.z, 0.9, 0.25);
  // crafted trail fencing: chunky posts + sagging rope rails beside the track
  {
    const postM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x7c5233, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 });
    const ropeM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xd9b382, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 });
    const postGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.95, 8);
    const knobGeo = new THREE.SphereGeometry(0.12, 10, 8);
    // [tStart, tEnd, side] stretches of path to fence (offset clear of rolling balls)
    LEVEL.fence.forEach(([t0, t1, side]) => {
      const tops = [];
      const n = Math.max(3, Math.round(((t1 - t0) * curveLen) / 1.6));
      for (let k = 0; k <= n; k++) {
        const t = t0 + ((t1 - t0) * k) / n;
        const p = curve.getPointAt(t);
        const tan = curve.getTangentAt(t);
        const nx = -tan.z, nz = tan.x;
        const fx = p.x + nx * side * 1.75, fz = p.z + nz * side * 1.75;
        const post = new THREE.Mesh(postGeo, postM);
        post.position.set(fx, 1.05, fz);
        post.rotation.y = R(0, 3);
        post.castShadow = true;
        scene.add(post);
        const knob = new THREE.Mesh(knobGeo, postM);
        knob.position.set(fx, 1.55, fz); knob.castShadow = true;
        scene.add(knob);
        tops.push(new THREE.Vector3(fx, 1.38, fz));
      }
      // rope rail with a gentle sag between posts
      const ropePts = [];
      tops.forEach((v, i) => {
        ropePts.push(v);
        if (i < tops.length - 1) {
          const mid = v.clone().add(tops[i + 1]).multiplyScalar(0.5);
          mid.y -= 0.12;
          ropePts.push(mid);
        }
      });
      const ropeCurve = new THREE.CatmullRomCurve3(ropePts);
      const rope = new THREE.Mesh(new THREE.TubeGeometry(ropeCurve, 40, 0.045, 6), ropeM);
      rope.castShadow = true;
      scene.add(rope);
    });
  }
  LEVEL.pinwheels.forEach(([px, pz, pc]) => pinwheel(px, pz, pc));
}
/* clouds anchored at frame edges (parallax puffs, never cover play) */
const clouds = [];
{
  const cm = new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0xffffff, roughness: 0.2, });
  const spots = [[-23, 11, 0], [23, 11.5, 1], [-22, 12, -12], [22, 12.5, -13]];
  spots.forEach(([cx, cy, cz], i) => {
    const g = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.9 + ((i + j) % 3) * 0.35, 12, 10), cm);
      s.position.set(j * 1.1 - 1.5, ((i * 7 + j * 3) % 5) * 0.12, ((i + j) % 3) * 0.3);
      s.scale.y = 0.7; g.add(s);
    }
    g.position.set(cx, cy, cz);
    clouds.push({ g, y0: cy, ph: i * 1.7 });
    scene.add(g);
  });
}
/* butterflies */
const butterflies = [];
{
  const cols = [0xff9e00, 0xc77dff, 0x90e0ef];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const wm = new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: cols[i], emissive: cols[i], emissiveIntensity: 0.85, side: THREE.DoubleSide });
    const wgL = new THREE.PlaneGeometry(0.35, 0.28); wgL.translate(0.17, 0, 0);
    const wgR = new THREE.PlaneGeometry(0.35, 0.28); wgR.translate(-0.17, 0, 0);
    const L = new THREE.Mesh(wgL, wm), R = new THREE.Mesh(wgR, wm);
    g.add(L, R);
    g.position.set((Math.random() - 0.5) * 10, 2.5, (Math.random() - 0.5) * 8);
    butterflies.push({ g, L, R, ph: Math.random() * 9, cx: g.position.x, cz: g.position.z });
    scene.add(g);
  }
}

/* ==================== TARSIUS SHOOTER (tree-clinger) ==================== */
const tarsius = new THREE.Group();
let muzzle, tarsiusBody, eyeL, eyeR, tailMesh, flashMesh, tarBlob;
{
  // (no stump: this little one clings straight to the perch trunk, tarsier-style —
  // the trunk passes just behind his belly and his pad-tipped limbs grip the bark)
  // cute mushrooms + leafy sprouts growing round the rim
  const shroomStemM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xf7ecd4,
    roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 });
  const shroomCapM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xe63946,
    roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 });
  const dotM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0xffffff,
    roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 });
  [[1.05, 0.4], [-0.95, -0.55]].forEach(([mx, mz]) => {
    const sh = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.28, 10), shroomStemM);
    stem.position.y = 0.14; stem.castShadow = true; sh.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), shroomCapM);
    cap.position.y = 0.3; cap.scale.y = 0.75; cap.castShadow = true; sh.add(cap);
    [[0.05, 0.4, 0.1], [-0.07, 0.38, -0.06], [0, 0.44, 0]].forEach(([dx, dy, dz]) => {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), dotM);
      d.position.set(dx, dy, dz); sh.add(d);
    });
    sh.position.set(mx, 0.02, mz);
    tarsius.add(sh);
  });
  const sproutM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x46b457,
    roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 });
  [[-1.0, 0.55], [0.9, -0.6]].forEach(([sx, sz], si) => {
    const sp = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.3, 8), sproutM);
    stem.position.y = 0.15; sp.add(stem);
    [-1, 1].forEach(q => {
      const lf = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), sproutM);
      lf.position.set(q * 0.1, 0.3, 0); lf.scale.set(1.3, 0.45, 0.7);
      lf.rotation.z = q * (0.5 + si * 0.2); lf.castShadow = true; sp.add(lf);
    });
    sp.position.set(sx, 0.02, sz);
    tarsius.add(sp);
  });
  // tiny glowing mushrooms + moss ringing the stump bottom
  const glowCapM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x4cc9f0,
    emissive: 0x4cc9f0, emissiveIntensity: 1.4, roughness: 0.2, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.1 });
  [[1.75, 0.5], [-1.7, -0.7], [0.4, -1.85]].forEach(([gx, gz]) => {
    const gm = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.2, 8), shroomStemM);
    stem.position.y = 0.1; gm.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), glowCapM);
    cap.position.y = 0.22; cap.scale.y = 0.7; cap.castShadow = true; gm.add(cap);
    gm.position.set(gx, 0.02, gz);
    tarsius.add(gm);
  });
  const mossBaseM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x46b457,
    roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 });
  [[1.55, 1.1, 0.28], [-1.5, 0.9, 0.24], [-0.6, 1.7, 0.3], [0.9, -1.6, 0.26], [-1.1, -1.4, 0.22]].forEach(([mx, mz, mr]) => {
    const mo = new THREE.Mesh(new THREE.SphereGeometry(mr, 10, 8), mossBaseM);
    mo.position.set(mx, 0.06, mz); mo.scale.y = 0.35;
    mo.receiveShadow = true;
    tarsius.add(mo);
  });
  // neon magical mushrooms (blue + purple glow) clustered round the roots
  [[-1.95, 0.15, 0x33ccff], [1.85, -0.9, 0xb366ff], [0.9, 1.95, 0x33ccff], [-0.7, -1.95, 0xb366ff]].forEach(([gx, gz, gc]) => {
    const gm = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.24, 8), shroomStemM);
    stem.position.y = 0.12; gm.add(stem);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10),
      new THREE.MeshPhysicalMaterial({ flatShading: true, color: gc, emissive: gc,
        emissiveIntensity: 2.0, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 }));
    cap.position.y = 0.27; cap.scale.y = 0.7; cap.castShadow = true; gm.add(cap);
    gm.position.set(gx, 0.02, gz);
    tarsius.add(gm);
  });
  // lush tiny ferns fanning out between the roots
  const fernM = new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x2f9e44, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, side: THREE.DoubleSide });
  [[1.3, 1.3], [-1.35, 1.15], [0.2, -1.9], [-1.2, -1.5]].forEach(([fx, fz]) => {
    const fern = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const bl = new THREE.Mesh(bladeGeo, fernM);
      const a = (i / 6) * Math.PI * 2;
      bl.position.set(Math.cos(a) * 0.06, 0, Math.sin(a) * 0.06);
      bl.rotation.y = -a + Math.PI / 2;
      bl.rotation.x = 0.5;
      bl.scale.setScalar(1.4);
      fern.add(bl);
    }
    fern.position.set(fx, 0.02, fz);
    tarsius.add(fern);
  });

  tarsiusBody = new THREE.Group(); tarsiusBody.position.set(0, 1.0, 0.55); tarsiusBody.scale.setScalar(1.3); tarsius.add(tarsiusBody);
  // ultra-cute stylized TARSIER: huge head, saucer eyes, spindly limbs, vinyl gloss
  const fur = new THREE.MeshPhysicalMaterial({ flatShading: false, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0xee9a2f, roughness: 0.2, });
  const bellyM = new THREE.MeshPhysicalMaterial({ flatShading: false, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0xf7e8c8, roughness: 0.2, });
  // tiny chubby body nestled in the stump hollow
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 20), fur);
  body.scale.set(1, 1.15, 0.9); body.position.y = 0.1; body.castShadow = true;
  tarsiusBody.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 18), bellyM);
  belly.position.set(0, 0.02, 0.38); belly.scale.set(0.85, 1.0, 0.55);
  tarsiusBody.add(belly);
  // oversized round head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.95, 32, 24), fur);
  head.position.set(0, 1.35, 0.1); head.castShadow = true;
  tarsiusBody.add(head);
  const facePatch = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 18), bellyM);
  facePatch.position.set(0, 1.35, 0.5); facePatch.scale.set(1.1, 0.9, 0.5);
  tarsiusBody.add(facePatch);
  // massive saucer-like glossy black eyes with bright glints (blink via scale.y)
  const eyeM = new THREE.MeshPhysicalMaterial({ flatShading: false, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05, color: 0x14100c, roughness: 0.1, });
  const glintM = new THREE.MeshPhysicalMaterial({ flatShading: false, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05, color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.1, });
  eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.34, 24, 18), eyeM);
  eyeL.position.set(-0.38, 1.55, 0.78); eyeL.scale.z = 0.7;
  const glintL = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), glintM);
  glintL.position.set(0.1, 0.12, 0.2);
  eyeL.add(glintL);
  const glintL2 = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), glintM);
  glintL2.position.set(-0.1, -0.08, 0.21);
  eyeL.add(glintL2);
  eyeR = eyeL.clone(); eyeR.position.x = 0.38;
  eyeR.children[0].position.x = -0.1;
  eyeR.children[1].position.x = 0.1;
  tarsiusBody.add(eyeL, eyeR);
  // thin dark eye-rings for extra toy expression
  const ringM = new THREE.MeshPhysicalMaterial({ flatShading: false, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0x5a3a22, roughness: 0.2, });
  [-1, 1].forEach(s => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.055, 10, 24), ringM);
    ring.position.set(s * 0.38, 1.55, 0.82);
    tarsiusBody.add(ring);
  });
  // large rounded bat-like ears sticking out sideways (bounce on fire via tick)
  const leafM = new THREE.MeshPhysicalMaterial({ flatShading: false, color: 0x2f9e44, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  [-1, 1].forEach(s => {
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 14), fur);
    ear.position.set(s * 0.95, 1.75, -0.1); ear.scale.set(1, 1.2, 0.35);
    ear.rotation.z = s * -0.3;
    ear.castShadow = true; ear.name = s < 0 ? 'earL' : 'earR';
    tarsiusBody.add(ear);
    const inner = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12),
      new THREE.MeshPhysicalMaterial({ flatShading: false, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, color: 0xe8b87d }));
    inner.position.set(s * 0.95, 1.75, 0.0); inner.scale.set(1, 1.2, 0.3);
    inner.rotation.z = s * -0.3;
    tarsiusBody.add(inner);
  });
  // tiny tropical flower tucked behind the right ear
  {
    const bloom = new THREE.Group();
    const petalM = new THREE.MeshPhysicalMaterial({ flatShading: false, color: 0xff5d8f, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 });
    const heartM = new THREE.MeshPhysicalMaterial({ flatShading: false, color: 0xffc700, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 });
    for (let i = 0; i < 5; i++) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8), petalM);
      const a = (i / 5) * Math.PI * 2;
      p.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0);
      p.scale.set(1, 1, 0.5); p.castShadow = true;
      bloom.add(p);
    }
    const heart = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), heartM);
    heart.position.z = 0.05;
    bloom.add(heart);
    bloom.position.set(1.02, 1.42, -0.28);
    bloom.rotation.y = 0.5;
    bloom.name = 'leafhat';
    tarsiusBody.add(bloom);
  }
  // tiny straw hat with a red band for the little adventurer
  const hatM = new THREE.MeshPhysicalMaterial({ flatShading: false, color: 0xe3c06a, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const bandHM = new THREE.MeshPhysicalMaterial({ flatShading: false, color: 0xe63946, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.62, 0.09, 22), hatM);
  brim.position.set(-0.06, 2.22, -0.02); brim.rotation.z = 0.14; brim.castShadow = true;
  tarsiusBody.add(brim);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), hatM);
  crown.position.set(-0.08, 2.38, -0.02); crown.scale.set(1, 0.75, 1); crown.castShadow = true;
  tarsiusBody.add(crown);
  const hatBand = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.06, 10, 22), bandHM);
  hatBand.position.set(-0.08, 2.3, -0.02); hatBand.rotation.x = Math.PI / 2 - 0.14;
  tarsiusBody.add(hatBand);
  const bandM = new THREE.MeshPhysicalMaterial({ flatShading: false, color: 0xe63946, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.13, 12, 24), bandM);
  band.position.set(0, 0.62, 0.1); band.rotation.x = 1.25; band.rotation.z = 0.2;
  band.castShadow = true;
  tarsiusBody.add(band);
  [-1, 1].forEach(q => {
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), bandM);
    tail.position.set(0.42 + q * 0.08, 0.42, -0.42); tail.scale.set(1.2, 0.5, 0.7);
    tail.rotation.z = q * 0.6; tail.castShadow = true;
    tarsiusBody.add(tail);
  });
  // tiny round snout + nose
  const snout = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), bellyM);
  snout.position.set(0, 1.02, 0.92); snout.scale.set(1.15, 0.8, 0.8);
  tarsiusBody.add(snout);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshPhysicalMaterial({ flatShading: false, roughness: 0.1, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05, color: 0x3a2a1a }));
  nose.position.set(0, 1.08, 1.04);
  tarsiusBody.add(nose);
  // chunky hollow-log cannon: bark tube + wood rim + dark bore + node rings
  const barkM = new THREE.MeshPhysicalMaterial({ flatShading: false, color: 0xcfb95c, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const paleWoodM = new THREE.MeshPhysicalMaterial({ flatShading: false, color: 0xd9a75f, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  const log = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 2.3, 20), barkM);
  log.rotation.x = Math.PI / 2; log.position.set(0, 0.55, 1.1); log.castShadow = true;
  tarsiusBody.add(log);
  const logRim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.07, 12, 22), paleWoodM);
  logRim.position.set(0, 0.55, 2.24); logRim.castShadow = true;
  tarsiusBody.add(logRim);
  const bore = new THREE.Mesh(new THREE.CircleGeometry(0.18, 20),
    new THREE.MeshPhysicalMaterial({ flatShading: false, roughness: 0.2, metalness: 0.0, color: 0x1d130c, emissive: 0x1d130c, emissiveIntensity: 0.7, clearcoat: 1.0, clearcoatRoughness: 0.1 }));
  bore.position.set(0, 0.55, 2.26);
  tarsiusBody.add(bore);
  [0.45, 1.55].forEach(bz => {
    const node = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.045, 10, 20), barkM);
    node.position.set(0, 0.55, bz); node.castShadow = true;
    tarsiusBody.add(node);
  });
  const logButt = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), barkM);
  logButt.position.set(0, 0.55, -0.08); logButt.scale.z = 0.6;
  tarsiusBody.add(logButt);
  // leaf sprig tied near the breech
  const sprigStem = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.4, 8), leafM);
  sprigStem.position.set(0.2, 0.85, 0.15); sprigStem.rotation.z = -0.6;
  tarsiusBody.add(sprigStem);
  [-1, 1].forEach(q => {
    const lf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), leafM);
    lf.position.set(0.2 + q * 0.12, 1.02, 0.15); lf.scale.set(1.3, 0.45, 0.7);
    lf.rotation.z = q * 0.55; lf.castShadow = true;
    tarsiusBody.add(lf);
  });
  // (cheeks folded into the cream face patch on this tiny face)
  muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.55, 2.25);
  tarsiusBody.add(muzzle);
  flashMesh = new THREE.Mesh(new THREE.SphereGeometry(0.35, 14, 12),
    new THREE.MeshPhysicalMaterial({ flatShading: false, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: 0xffe66d, emissive: 0xffe66d, emissiveIntensity: 0.85, transparent: true, opacity: 0 }));
  flashMesh.position.copy(muzzle.position);
  tarsiusBody.add(flashMesh);
  // long spindly limbs between two points, with suction-cup pads gripping
  const limb = (x1, y1, z1, x2, y2, z2, r, mat) => {
    const a = new THREE.Vector3(x1, y1, z1), b = new THREE.Vector3(x2, y2, z2);
    const d = b.clone().sub(a), len = d.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.85, r, len, 10), mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    m.castShadow = true;
    tarsiusBody.add(m);
    return m;
  };
  const padM = new THREE.MeshPhysicalMaterial({ flatShading: false, color: 0xf7e8c8, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1});
  // spindly arms wrapping the log cannon, finger pads pressed on the bark
  [-1, 1].forEach(s => {
    limb(s * 0.52, 0.32, 0.3, s * 0.3, 0.62, 1.2, 0.07, fur);
    [[0.17, 0.72], [0.29, 0.78], [0.39, 0.7]].forEach(([px, py]) => {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), padM);
      pad.position.set(s * px, py, 1.28);
      tarsiusBody.add(pad);
    });
  });
  // long dangly legs down the stump face, toe pads gripping the bark
  [-1, 1].forEach(s => {
    limb(s * 0.3, -0.2, 0.42, s * 0.42, -0.68, 1.5, 0.07, fur);
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), fur);
    foot.position.set(s * 0.42, -0.72, 1.52); foot.scale.set(1, 0.7, 0.6);
    foot.castShadow = true;
    tarsiusBody.add(foot);
    [-0.09, 0, 0.09].forEach(dx => {
      const toe = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), padM);
      toe.position.set(s * 0.42 + dx, -0.66, 1.62);
      tarsiusBody.add(toe);
    });
  });
  // (backpack removed: tiny tarsier travels light, flower only)
  // long thin tail wrapping playfully round the perch trunk, ending in a fur tuft
  tailMesh = new THREE.Group();
  tailMesh.position.set(0, -0.85, 0.4);
  {
    const wrap = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.15, 0.1, -0.5),
      new THREE.Vector3(0.62, 0.0, -0.4),
      new THREE.Vector3(0.7, -0.05, 0.25),
      new THREE.Vector3(0.35, -0.1, 0.6),
      new THREE.Vector3(-0.15, -0.05, 0.62),
    ]);
    const rope = new THREE.Mesh(new THREE.TubeGeometry(wrap, 40, 0.06, 8), fur);
    rope.castShadow = true;
    tailMesh.add(rope);
    const tuftAt = new THREE.Vector3(-0.15, -0.05, 0.62);
    [[0, 0, 0, 0.16], [0.12, 0.08, 0.05, 0.12], [-0.1, 0.1, -0.04, 0.11]].forEach(([dx, dy, dz, tr]) => {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(tr, 12, 10), bellyM);
      puff.position.set(tuftAt.x + dx, tuftAt.y + dy, tuftAt.z + dz);
      puff.castShadow = true;
      tailMesh.add(puff);
    });
  }
  tarsiusBody.add(tailMesh);

  tarsius.position.copy(SHOOTER_POS);
  scene.add(tarsius);
  tarBlob = groundBlob(SHOOTER_POS.x, SHOOTER_POS.z, 2.0, 0.3);
}
function makeOrb(colorIdx) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.52, 28, 20), marbleMat(PALETTE[colorIdx]));
  m.castShadow = true;
  return m;
}
const curOrb = makeOrb(0); curOrb.position.set(0, 0.55, 3.0); tarsiusBody.add(curOrb);
const nextOrb = makeOrb(1); nextOrb.scale.setScalar(0.65); nextOrb.position.set(1.9, 4.4, 1.0); scene.add(nextOrb);
const aimGeo = new THREE.BufferGeometry().setFromPoints(
  Array.from({ length: 8 }, (_, i) => new THREE.Vector3(0, 0, 3.6 + i * 0.9)));
const aimLine = new THREE.Points(aimGeo, new THREE.PointsMaterial({
  color: 0xffffff, size: 0.28, transparent: true, opacity: 0.85, sizeAttenuation: true }));
tarsiusBody.add(aimLine);

/* ==================== JALAK COMPANION + ELANG JAWA ====================
   Jalak (Bali starling): hovers by the tarsius carrying the NEXT marble
   in its talons (swap tosses it over), fetches power seeds from the
   grass on click/tap, drops bombs on right-click targets, grows huge to
   hold the chain head, and goes frenzy-plucking random marbles.
   Elang Jawa: unpredictable circling raptor flock. Shoot carriers (+50) or
   they keep stealing marbles off the march. */
const jalak = buildJalak();
scene.add(jalak.group);
const heldSprite = letterSprite('B', POWERS.bomb.bg);
heldSprite.position.set(0, 1.15, 0); heldSprite.visible = false;
jalak.group.add(heldSprite);
// NEXT marble rides in the Jalak's talons (no more floating sky-orb)
jalak.refs.talon.add(nextOrb); nextOrb.position.set(0, -0.35, 0); nextOrb.scale.setScalar(0.62);
/* Elang Jawa flock: thieving raptors that stoop on the CHAIN and carry
   marbles off in their talons. A stolen ball leaves the chain entirely —
   the game cannot complete until its carrier is shot down (the ball is
   smashed on the kill: +15 & counts as destroyed). Flock cap by
   difficulty: chill 3, normal 5, spicy 10. */
const eagles = []; // {group, refs, shadow, wp, mode, t, stoopT, goneT, fleeDir, stealBall}
function eagleCap() {
  const m = LEVEL.mechanics;
  if (G.diff === 'spicy') return m.eagleMaxSpicy ?? 10;
  if (G.diff === 'chill') return m.eagleMaxChill ?? 3;
  return m.eagleMax ?? 5;
}
function pickEagleWP(e, h) {
  e.wp.set(R(-20, 20), h ?? R(6, 10), R(-16, 14));
}
function spawnEagle() {
  const built = buildEagle();
  scene.add(built.group);
  const shadow = groundBlob(0, 0, 1.6, 0.22);
  const e = {
    group: built.group, refs: built.refs, shadow,
    wp: new THREE.Vector3(10, 8, -8),
    mode: 'circle', t: 0,
    stoopT: (LEVEL.mechanics.eagleStoopEvery ?? 18) * (0.8 + Math.random() * 0.4),
    goneT: 0, fleeDir: new THREE.Vector3(1, 0, 0),
    stealBall: null, stealRef: null,
  };
  const a = Math.random() * Math.PI * 2;
  e.group.position.set(Math.cos(a) * 24, 14, Math.sin(a) * 24);
  pickEagleWP(e, 9);
  eagles.push(e);
  return e;
}
function clearEagles() {
  for (const e of eagles) {
    if (e.stealBall) e.group.remove(e.stealBall.mesh);
    scene.remove(e.group);
    scene.remove(e.shadow);
  }
  eagles.length = 0;
}
const eaglesHolding = () => eagles.filter(e => e.stealBall).length;
const pickupHit = []; // invisible tap targets, parallel to G.pickups
let bombFall = null; // { mesh, t, target } while a dropped bomb falls
jalakHome(jalak.group.position); // first eagle spawns in resetGame via spawnEagle()
function jalakHome(out) {
  return (out || new THREE.Vector3()).set(
    tarsius.position.x + 1.7, tarsius.position.y + 4.1, tarsius.position.z + 0.9);
}
function setHeldSprite() {
  // Reap stale letter badges (older builds added a fresh sprite per fetch
  // without removing it, so the Jalak visibly "still held" spent powers).
  for (const c of jalak.group.children.slice()) {
    if (c.isSprite && c !== heldSprite) {
      jalak.group.remove(c);
      if (c.material.map) c.material.map.dispose();
      c.material.dispose();
    }
  }
  if (!heldSprite.parent) jalak.group.add(heldSprite);
  heldSprite.visible = !!G.holding;
  if (G.holding && POWERS[G.holding]) {
    // swap the badge art in place — heldSprite is the ONE sprite child
    const fresh = letterSprite(POWERS[G.holding].letter, POWERS[G.holding].bg);
    if (heldSprite.material.map) heldSprite.material.map.dispose();
    heldSprite.material.map = fresh.material.map;
    heldSprite.material.needsUpdate = true;
    fresh.material.map = null;
    fresh.material.dispose();
  }
}
function groundFromClient(cx, cy) {
  mouseNDC.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(mouseNDC, camera);
  const pt = new THREE.Vector3();
  return ray.ray.intersectPlane(groundPlane, pt) ? pt : null;
}
function pickupFromClient(cx, cy) {
  mouseNDC.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(mouseNDC, camera);
  const hits = ray.intersectObjects(pickupHit, false);
  return hits.length ? G.pickups.find(p => p.hit === hits[0].object) || null : null;
}
/* Power seeds bloom as TREASURE CHESTS on the grass — box silhouette in
   wood + gold, never the path marbles' red/blue/green/yellow spheres.
   Click/tap one and the Jalak fetches it, then holds a single power. */
const PICKUP_ACCENT = { bomb: 0xff5d8f, stop: 0x4cc9f0, frenzy: 0xff9e00 };
function spawnPickup(type = null, x = null, z = null) {
  if (G.pickups.length >= (LEVEL.pickupMax ?? 3)) return null;
  const t = (type && POWERS[type]) ? type : randPower();
  let px = x, pz = z;
  if (px === null) {
    let ok = false;
    for (let k = 0; k < 24 && !ok; k++) {
      const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 19;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r * 0.95;
      if (!nearPath(cx, cz, 2.4)) { px = cx; pz = cz; ok = true; }
    }
    if (!ok) return null;
  }
  const g = new THREE.Group();
  const chest = buildTreasure(PICKUP_ACCENT[t] ?? 0xffc700);
  chest.group.position.y = 1.0; g.add(chest.group);
  const accent = PICKUP_ACCENT[t] ?? 0xffe8a3;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.09, 10, 24),
    new THREE.MeshPhysicalMaterial({ flatShading: true, color: accent, emissive: accent, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 }));
  halo.rotation.x = Math.PI / 2; halo.position.y = 1.0; g.add(halo);
  const tag = letterSprite(POWERS[t].letter, POWERS[t].bg);
  tag.position.y = 2.3; g.add(tag);
  const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 3, 8),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
  hit.position.y = 1.4; g.add(hit);
  g.position.set(px, 0.6, pz);
  scene.add(g);
  groundBlob(px, pz, 1.0, 0.2);
  const p = { type: t, x: px, z: pz, mesh: g, chest: chest.group, chestRefs: chest.refs, halo, hit, age: 0, kind: 'treasure' };
  hit.userData.pickup = p;
  G.pickups.push(p); pickupHit.push(hit);
  return p;
}
function removePickup(p) {
  const i = G.pickups.indexOf(p);
  if (i >= 0) G.pickups.splice(i, 1);
  const j = pickupHit.indexOf(p.hit);
  if (j >= 0) pickupHit.splice(j, 1);
  scene.remove(p.mesh);
}
function fetchPickup(p) {
  if (!p || G.pickups.indexOf(p) < 0) return false;
  if (G.status !== 'playing' || G.paused) return false;
  if (G.jalakMode !== 'hover') { floater('Jalak is busy…', jalak.group.position.clone()); return false; }
  if (G.holding) { floater('already carrying treasure!', jalak.group.position.clone()); return false; }
  G.jalakMode = 'fetch';
  G.jalakFrom = jalak.group.position.clone();
  G.jalakTo = new THREE.Vector3(p.x, 2.4, p.z);
  G.jalakPayload = p;
  G.jalakT = 0.55;
  sfx('click');
  return true;
}
/* Right-click (mouse) / long-press (touch) on the chain: unleash the held
   seed through the Jalak. No buttons, no keys — the gesture IS the trigger:
   - bomb: drop on the clicked spot (nearest marble within 7 units)
   - stop: click ANY marble (the Jalak still flies up and pins the head)
   - frenzy: target ANY marble (the Jalak plucks at random from there) */
function dropBombAt(pt) {
  if (G.holding !== 'bomb') return false;
  if (G.jalakMode !== 'hover' && G.jalakMode !== 'return') return false;
  if (G.status !== 'playing' || G.paused) return false;
  let best = null, bestD = 7 * 7;
  for (const b of G.balls) {
    const dx = b.mesh.position.x - pt.x, dz = b.mesh.position.z - pt.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; best = b; }
  }
  if (!best) { floater('no target…', new THREE.Vector3(pt.x, 2, pt.z)); return false; }
  G.holding = null; setHeldSprite(); updateHUD();
  G.jalakMode = 'bomb';
  G.jalakFrom = jalak.group.position.clone();
  G.jalakTo = new THREE.Vector3(best.mesh.position.x, 6.5, best.mesh.position.z);
  G.jalakPayload = best.mesh.position.clone();
  G.jalakT = 0.55;
  sfx('leap');
  return true;
}
/* HOLDSEED: the Jalak grows huge and pins the chain head. Fired by
   right-click / long-press on ANY marble (easiest target wins). */
function fireHold() {
  if (G.holding !== 'stop') return false;
  if (G.jalakMode !== 'hover' && G.jalakMode !== 'return') return false;
  if (G.status !== 'playing' || G.paused) return false;
  if (!G.balls.length) return false;
  const anchor = G.balls[0].mesh.position.clone();
  G.holding = null; setHeldSprite();
  triggerPower('stop', anchor);
  G.jalakMode = 'hold';
  updateHUD();
  return true;
}
/* FRENZYSEED: the Jalak goes wild and plucks random marbles. Fired by
   right-click / long-press on ANY marble. */
function fireFrenzy() {
  if (G.holding !== 'frenzy') return false;
  if (G.jalakMode !== 'hover' && G.jalakMode !== 'return') return false;
  if (G.status !== 'playing' || G.paused) return false;
  if (!G.balls.length) return false;
  const anchor = jalak.group.position.clone();
  G.holding = null; setHeldSprite();
  triggerPower('frenzy', anchor);
  if (G.frenzyQ.length) G.jalakMode = 'frenzy';
  updateHUD();
  return true;
}
function nearestBallTo(pt, maxD = 3.5) {
  let best = null, bestD = maxD * maxD;
  for (const b of G.balls) {
    const dx = b.mesh.position.x - pt.x, dz = b.mesh.position.z - pt.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < bestD) { bestD = d2; best = b; }
  }
  return best;
}
/* Single entry for right-click / touch-hold gestures. Returns true when a
   power actually fired. */
function useHeldPowerAt(pt) {
  if (G.status !== 'playing' || G.paused) return false;
  if (!G.holding) { floater('fetch a treasure first!', jalak.group.position.clone()); return false; }
  if (G.jalakMode !== 'hover' && G.jalakMode !== 'return') { floater('Jalak is busy…', jalak.group.position.clone()); return false; }
  if (G.holding === 'bomb') return dropBombAt(pt);
  if (G.holding === 'stop') {
    if (!G.balls.length) return false;
    // any marble on the path works — the Jalak still flies up and pins the head
    if (!nearestBallTo(pt, 3.5)) {
      floater('pick a marble!', new THREE.Vector3(pt.x, 2.2, pt.z));
      return false;
    }
    return fireHold();
  }
  if (G.holding === 'frenzy') {
    const hit = nearestBallTo(pt, 3.5);
    if (!hit) {
      floater('pick a marble!', new THREE.Vector3(pt.x, 2.2, pt.z));
      return false;
    }
    return fireFrenzy();
  }
  return false;
}
/* Eagle hit test: swept XZ segment (no tunneling past the fast stoop) plus a
   screen-space fallback, so aiming AT the bird on screen connects — the
   ground-plane aim point for a high-flying bird otherwise lands behind it
   and visual hits would never register. Either test scoring downs the bird. */
const EAGLE_HIT_R = 2.0; // matches the eagle's broad wingspan, not a point
const _ev1 = new THREE.Vector3(), _ev2 = new THREE.Vector3();
function segHitsEagle(px, pz, cx, cz, ex, ez, r) {
  const dx = cx - px, dz = cz - pz;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((ex - px) * dx + (ez - pz) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const ox = ex - (px + dx * t), oz = ez - (pz + dz * t);
  return ox * ox + oz * oz < r * r;
}
function screenHitsPos(pr, pos) {
  _ev1.copy(pos).project(camera);
  _ev2.set(pr.pos.x, 1.15, pr.pos.z).project(camera);
  const dx = _ev1.x - _ev2.x, dy = _ev1.y - _ev2.y;
  return dx * dx + dy * dy < 0.075 * 0.075;
}
/* Compat wrapper: tests probe the lead eagle through the old name. */
function screenHitsEagle(pr) {
  return eagles.length ? screenHitsPos(pr, eagles[0].group.position) : false;
}
function destroyBall(ball, pts = 15) {
  const i = G.balls.indexOf(ball);
  if (i < 0) return false;
  burst(ball.mesh.position.clone(), ball.color, 8, 7);
  scene.remove(ball.mesh); G.balls.splice(i, 1);
  G.destroyed++; G.score += pts;
  return true;
}
function featherBurst(pos) {
  if (G.sim) return;
  const cols = [0xffffff, 0x5a3a22, 0xfdfdf8];
  for (let i = 0; i < 16; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.1 + Math.random() * 0.1, 10, 8),
      new THREE.MeshPhysicalMaterial({ flatShading: true, roughness: 0.3, metalness: 0.0, clearcoat: 0.8, clearcoatRoughness: 0.2, color: cols[i % 3] }));
    m.position.copy(pos);
    const v = new THREE.Vector3((Math.random() - 0.5) * 10, Math.random() * 8 + 2, (Math.random() - 0.5) * 10);
    G.particles.push({ m, v, life: 0.8 + Math.random() * 0.4 });
    scene.add(m);
  }
}
function eagleDown(e = eagles[0]) {
  if (!e) return false;
  G.score += 50;
  G.eagleHits = (G.eagleHits || 0) + 1;
  featherBurst(e.group.position.clone());
  shockwave(new THREE.Vector3(e.group.position.x, 1.2, e.group.position.z), 0xffffff, 4);
  floater('EAGLE DOWN +50!', e.group.position.clone(), true);
  sfx('big');
  // the kill smashes whatever the bird was carrying: the stolen ball counts
  // as destroyed, so shooting carriers is how the island gets completed
  if (e.stealBall) {
    const m = e.stealBall.mesh;
    e.group.remove(m);
    burst(e.group.position.clone(), e.stealBall.color, 10, 8);
    G.destroyed++; G.score += 15;
    floater('BALL BACK +15!', e.group.position.clone(), true);
    e.stealBall = null; e.stealRef = null;
    sanitizeHeld();
    bumpScore(); updateHUD(); checkWin();
  }
  // every 3rd kill triggers the ULTIMATE — REWIND: the march drifts
  // backward over ultimateRewindDur (see step(): reversing branch).
  if (G.eagleHits % 3 === 0) {
    G.ultimates = (G.ultimates || 0) + 1;
    G.rewindT = LEVEL.mechanics.ultimateRewindDur ?? 2.2;
    const anchor = G.balls.length ? G.balls[0].mesh.position.clone()
      : new THREE.Vector3(tarsius.position.x, 1.5, tarsius.position.z);
    shockwave(anchor, 0xffc700, 6);
    shockwave(new THREE.Vector3(tarsius.position.x, 1.5, tarsius.position.z), 0xffc700, 6);
    showBanner('★ ULTIMATE: REWIND! ★', 'the march is pushed back!');
    floater('REWIND!', e.group.position.clone(), true);
    sfx('power');
    updateHUD();
  }
  e.fleeDir.set(e.group.position.x, 0, e.group.position.z);
  if (e.fleeDir.lengthSq() < 0.01) e.fleeDir.set(1, 0, 0);
  e.fleeDir.normalize();
  e.mode = 'flee';
  e.t = 0;
  e.goneT = (LEVEL.mechanics.eagleGoneDur ?? 22) * (0.8 + Math.random() * 0.4);
  bumpScore(); updateHUD();
  return true;
}
function eagleStoop(e) {
  // The mischief when nobody shoots it: stoop on the CHAIN and rip a marble
  // out of the march. The carrier keeps circling with its prize — shoot it
  // down or the island can never be completed.
  sfx('screech');
  if (!G.balls.length) { e.stoopT = 6; return; } // nothing to steal yet
  const target = G.balls[(Math.random() * G.balls.length) | 0];
  e.mode = 'stoop';
  e.t = 0;
  e.wp.set(target.mesh.position.x, 2.4, target.mesh.position.z);
  e.stealRef = target;
  showBanner('ELANG JAWA STOOPS!', 'it steals your marbles — shoot it down!');
}

/* ==================== GAME STATE ==================== */
const ballGeo = new THREE.SphereGeometry(BALL_R, 32, 24);
const ballMats = PALETTE.map(c => marbleMat(c));
const hiGeo = new THREE.SphereGeometry(0.16, 12, 10);
const hiMat = new THREE.MeshPhysicalMaterial({ flatShading: false, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.85, transparent: true, opacity: 0.85 });
const ringGeo = new THREE.TorusGeometry(0.8, 0.11, 8, 28);
const ringMat = new THREE.MeshPhysicalMaterial({ flatShading: false, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: 0xffc700, emissive: 0xffb700, emissiveIntensity: 0.9});
const wingGeo = new THREE.SphereGeometry(0.2, 12, 10);
const trailGeo = new THREE.SphereGeometry(0.2, 14, 10);
/* Shared marble kit: same assets, every level (path/projectiles/orbs). */
const kit = { ballGeo, ballMats, hiGeo, hiMat, ringGeo, ringMat, wingGeo, trailGeo };

function letterSprite(letter, bg) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = bg; x.beginPath(); x.arc(32, 32, 27, 0, 7); x.fill();
  x.lineWidth = 5; x.strokeStyle = '#fffdf4'; x.stroke();
  x.fillStyle = '#fff'; x.font = '900 32px "Trebuchet MS", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(letter, 32, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
  s.scale.set(1.1, 1.1, 1); s.renderOrder = 5;
  return s;
}
const G = {
  status: 'menu', paused: false, muted: false, diff: 'normal',
  sim: false, attract: false, attractThink: 0, attractEnd: 0,
  balls: [], projectiles: [], particles: [], rings: [],
  spawned: 0, destroyed: 0, score: 0, combo: 1, maxCombo: 1,
  streak: 0, bestStreak: 0, shots: 0, hits: 0, powersUsed: 0,
  aim: 0, time: 0, playTime: 0, introT: 0,
  perch: 0, leapT: 0, leapFrom: null, // tree-perch state + leap animation
  cur: 0, nxt: 1, shootCD: 0, blink: 0, recoil: 0, happy: 0, flash: 0,
  slowT: 0, revT: 0, shake: 0, danger: false, heartT: 0,
  holdT: 0, // HOLDSEED freeze: the Jalak holds the chain head
  rewindT: 0, // ULTIMATE rewind: the march drifts backward while > 0
  pickups: [], pickupT: 8, // power seeds waiting on the grass
  frenzyQ: [], frenzyT: 0, // FRENZYSEED random-pluck queue
  jalakMode: 'hover', jalakT: 0, jalakFrom: null, jalakTo: null, jalakPayload: null,
  holding: null, swapT: 0, // held power type + swap-toss animation timer
  eagleSpawnT: 14, eagleSteals: 0, // flock pressure: reinforcement timer + stolen count
  eagleHits: 0,
  ultimates: 0, // eagle ultimate (REWIND) trigger count
  best: 0,
};
try { G.best = +(localStorage.getItem('gunbatte-balls-best') || 0); } catch { /* private mode */ }

/* Mechanics delegates: rules live in src/mechanics.js (parameterized by
   LEVEL); these thin wrappers preserve the historic globals/tests. */
const activeColors = () => getActiveColors(G.balls, LEVEL.colorsN);
// Path spawns are always fully random over every color — runs of same-color
// balls happen by chance, never forced.
// Only the shooter's dealt balls are constrained (see dealColor).
const randColor = () => mechRandColor(LEVEL);
// The shooter only deals colors that actually exist on the path right now,
// so late-game you never get stuck holding a dead color nobody can match.
const dealColor = () => mechDealColor(G.balls, LEVEL);
// If pops wiped out a color entirely, re-deal any held ball of that color.
function sanitizeHeld() { mechSanitize(G, LEVEL); }
const randPower = () => mechRandPower(LEVEL);
const pointAt = s => mechPointAt(curve, curveLen, s);
const tangentAt = s => mechTangentAt(curve, curveLen, s);

/* Live wiring for the mechanics engine (scene + HUD callbacks). */
function mechCtx() {
  return {
    G, level: LEVEL, curve, curveLen, scene, kit, powerDefs: POWERS,
    burst, shockwave, floater, showBanner, sfx,
    updateHUD, bumpScore, checkWin, PALETTE,
  };
}

function makeBallMesh(color, power) {
  return assetsMakeBallMesh(kit, POWERS, color, power);
}
function spawnBall(s = 0, color = randColor(), power = null) {
  mechSpawnBall(mechCtx(), s, color, power);
}

/* ---------- HUD / feedback ---------- */
const $ = id => document.getElementById(id);
function updateHUD() {
  if (G.sim) return;
  $('score').textContent = G.score;
  $('progress-bar').style.width = `${Math.min(100, (G.destroyed / TOTAL_BALLS) * 100)}%`;
  const held = eaglesHolding();
  $('progress-text').textContent = `${G.destroyed}/${TOTAL_BALLS} popped • ${G.balls.length} on island` +
    (held ? ` • ${held} stolen by eagles!` : '');
  $('cur-ball').style.background = PALETTE_CSS[G.cur];
  $('next-ball').style.background = PALETTE_CSS[G.nxt];
  curOrb.material = ballMats[G.cur]; nextOrb.material = ballMats[G.nxt];
  const cb = $('combo');
  if (G.combo >= 2 && G.status === 'playing') {
    cb.classList.remove('hidden');
    const b = cb.querySelector('b'); if (b) b.textContent = '×' + G.combo;
    else cb.innerHTML = `COMBO <b>×${G.combo}</b>`;
  } else cb.classList.add('hidden');
  $('badge-slow').classList.toggle('hidden', !(G.holdT > 0));
  if (G.holdT > 0) $('badge-slow').querySelector('.bar div').style.width = `${(G.holdT / (LEVEL.mechanics.holdDur ?? 6)) * 100}%`;
  $('danger').classList.toggle('active', G.danger && G.status === 'playing');
}
function bumpScore() {
  if (G.sim) return;
  const el = $('score');
  el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
}
function floater(text, worldPos, big = false) {
  if (G.sim) return;
  const v = worldPos.clone().project(camera);
  const el = document.createElement('div');
  el.className = 'float' + (big ? ' big' : '');
  el.textContent = text;
  el.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
  el.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  el.addEventListener('animationend', () => el.remove());
  $('floaters').appendChild(el);
  setTimeout(() => el.remove(), 1200);
}
let bannerTimer = null;
function showBanner(main, sub = '', ms = 2000) {
  if (G.sim) return;
  const b = $('banner');
  $('banner-main').textContent = main;
  $('banner-sub').textContent = sub;
  b.classList.remove('hidden', 'show'); void b.offsetWidth; b.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => b.classList.add('hidden'), ms);
}
function burst(pos, colorIdx, n = 14, spread = 8) {
  if (G.sim) return;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.12 + Math.random() * 0.12, 12, 10),
      new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: i % 3 ? PALETTE[colorIdx] : 0xffffff , emissive: i % 3 ? PALETTE[colorIdx] : 0xffffff, emissiveIntensity: 0.85}));
    m.position.copy(pos);
    const v = new THREE.Vector3((Math.random() - 0.5) * spread, Math.random() * 7 + 2, (Math.random() - 0.5) * spread);
    G.particles.push({ m, v, life: 0.7 + Math.random() * 0.4 });
    scene.add(m);
  }
}
function shockwave(pos, color = 0xffffff, max = 4) {
  if (G.sim) return;
  const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.72, 32),
    new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  m.rotation.x = -Math.PI / 2; m.position.copy(pos); m.position.y = 1.0;
  scene.add(m);
  G.rings.push({ m, t: 0, max });
}

/* ---------- powers (registry in src/powers.js; per-level allow-list) ---------- */
function triggerPower(type, pos) {
  return mechTrigger(mechCtx(), type, pos);
}

/* ---------- match / insert / shoot (rules in src/mechanics.js) ---------- */
function popCheck(startIdx) {
  return mechPopCheck(mechCtx(), startIdx);
}
function checkWin() {
  // stolen marbles count too: carriers must be shot down before the island
  // is truly clear (their loot is smashed on the kill: +15 & destroyed++)
  if (G.status === 'playing' && G.spawned >= TOTAL_BALLS && G.balls.length === 0 && !eaglesHolding()) endGame(true);
}
function shoot() {
  if (G.status !== 'playing' || G.shootCD > 0 || G.paused || G.leapT > 0) return;
  G.shootCD = LEVEL.mechanics.shootCooldown;
  const dir = new THREE.Vector3(Math.sin(G.aim), 0, Math.cos(G.aim));
  const mp = new THREE.Vector3(); muzzle.getWorldPosition(mp);
  const mesh = makeBallMesh(G.cur, null);
  mesh.position.copy(mp);
  scene.add(mesh);
  const trail = [];
  for (let i = 0; i < 4; i++) {
    const t = new THREE.Mesh(trailGeo, new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: PALETTE[G.cur], emissive: PALETTE[G.cur], emissiveIntensity: 0.85, transparent: true, opacity: 0.5 - i * 0.11 }));
    scene.add(t); trail.push(t);
  }
  G.projectiles.push({ color: G.cur, pos: mp.clone(), vel: dir.multiplyScalar(LEVEL.mechanics.projectileSpeed), mesh, core: mesh.children[0], trail, hist: [] });
  G.recoil = 1; G.flash = 0.09;
  G.shots++;
  sfx('shoot');
  G.cur = G.nxt; G.nxt = dealColor();
  updateHUD();
}
function insertShot(proj, hitIdx) {
  mechInsertShot(mechCtx(), proj, hitIdx);
}
function onMiss() {
  if (G.streak >= 3) floater('miss…', new THREE.Vector3(tarsius.position.x, 3, tarsius.position.z));
  G.streak = 0; G.combo = 1; updateHUD();
}

/* ---------- flow ---------- */
function bestSave() {
  if (G.score > G.best) {
    G.best = G.score;
    try { localStorage.setItem('gunbatte-balls-best', String(G.best)); } catch { /* ignore */ }
  }
}
function endGame(win) {
  if (G.status !== 'playing') return;
  G.status = win ? 'won' : 'lost';
  G.danger = false; updateHUD();
  bestSave();
  if (G.sim) return;
  if (G.attract) G.attractEnd = 4; // auto-restart countdown for demo mode
  const ov = $('end-overlay');
  ov.classList.remove('hidden');
  if (win) {
    const stars = 1 + (G.score >= 800 ? 1 : 0) + (G.score >= 1300 ? 1 : 0);
    $('end-title').textContent = '★ YOU WIN! ★';
    $('end-title').style.color = '#2d6a4f';
    $('end-stars').innerHTML = [1, 2, 3].map(i =>
      `<span class="${i <= stars ? '' : 'dim'}">★</span>`).join('');
    $('end-text').innerHTML = 'The island is safe! The tarsius does a happy wiggle.';
    const mm = `${(G.playTime / 60) | 0}:${String((G.playTime | 0) % 60).padStart(2, '0')}`;
    $('end-stats').innerHTML =
      `<div>SCORE<b>${G.score}</b></div><div>BEST<b>${G.best}</b></div>` +
      `<div>TIME<b>${mm}</b></div><div>MAX COMBO<b>×${G.maxCombo}</b></div>` +
      `<div>EAGLE HITS<b>${G.eagleHits || 0}</b></div><div>SEEDS<b>${G.powersUsed}</b></div>` +
      `<div>STOLEN<b>${G.eagleSteals || 0}</b></div><div>ULTIMATES<b>${G.ultimates || 0}</b></div>`;
    sfx('win');
  } else {
    $('end-title').textContent = '☠ SKULL CAVE HUNGRY…';
    $('end-title').style.color = '#9d0208';
    $('end-stars').innerHTML = '';
    $('end-text').innerHTML = `The marbles reached the skull…<br/><b>Score: ${G.score}</b> — try again, tiny guardian!`;
    $('end-stats').innerHTML =
      `<div>SCORE<b>${G.score}</b></div><div>POPPED<b>${G.destroyed}/${TOTAL_BALLS}</b></div>`;
    sfx('lose');
  }
}
function resetGame() {
  G.balls.forEach(x => scene.remove(x.mesh));
  G.projectiles.forEach(x => { scene.remove(x.mesh); x.trail.forEach(t => scene.remove(t)); });
  G.particles.forEach(x => scene.remove(x.m));
  G.rings.forEach(x => scene.remove(x.m));
  G.pickups.slice().forEach(removePickup);
  if (bombFall) { scene.remove(bombFall.mesh); bombFall = null; }
  Object.assign(G, {
    balls: [], projectiles: [], particles: [], rings: [],
    spawned: 0, destroyed: 0, score: 0, combo: 1, maxCombo: 1,
    streak: 0, bestStreak: 0, shots: 0, hits: 0, powersUsed: 0,
    playTime: 0, shootCD: 0, slowT: 0, revT: 0, shake: 0,
    danger: false, heartT: 0, paused: false, introT: 1.8,
    status: 'intro', cur: 0, nxt: 1, perch: 0, leapT: 0, leapFrom: null,
    holdT: 0, rewindT: 0, pickups: [], pickupT: 8, frenzyQ: [], frenzyT: 0,
    jalakMode: 'hover', jalakT: 0, jalakFrom: null, jalakTo: null, jalakPayload: null,
    holding: null, swapT: 0,
    eagleSpawnT: (LEVEL.mechanics.eagleSpawnEvery ?? 20) * 0.8, eagleSteals: 0,
    eagleHits: 0, ultimates: 0,
  });
  tarsius.position.copy(PERCHES[0]); tarsius.rotation.y = 0;
  tarsius.visible = true;
  jalakHome(jalak.group.position);
  jalak.group.scale.setScalar(1);
  nextOrb.visible = true; // hold-tuck never survives a reset
  setHeldSprite();
  clearEagles();
  spawnEagle();
  $('end-overlay').classList.add('hidden');
  $('pause-overlay').classList.add('hidden');
  for (let i = 0; i < LEVEL.initialBalls; i++) {
    spawnBall(LEVEL.initialHeadS - i * SPACING, randColor(), null);
  }
  G.spawned = LEVEL.initialBalls;
  // Deal the shooter's seeds from the freshly spawned path so both are live colors.
  G.cur = dealColor(); G.nxt = dealColor();
  showBanner(LEVEL.bannerMain, LEVEL.bannerSub);
  try { $('subtitle').textContent = `${LEVEL.name} • Lv ${LEVEL.levelNo}`; } catch { /* ignore */ }
  updateHUD();
}
function togglePause(force) {
  if (G.status !== 'playing' && G.status !== 'intro') return;
  const want = force !== undefined ? force : !G.paused;
  if (want === G.paused) return;
  G.paused = want;
  $('pause-overlay').classList.toggle('hidden', !want);
  sfx('click');
  if (AC) { if (want) AC.suspend(); else AC.resume(); }
}
function toggleMute() {
  G.muted = !G.muted;
  if (master) master.gain.value = G.muted ? 0 : 1;
  $('mute-btn').classList.toggle('off', G.muted);
}

/* ---------- input: mouse + touch ---------- */
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.6);
const mouseNDC = new THREE.Vector2();
function setAimFromClient(cx, cy) {
  mouseNDC.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(mouseNDC, camera);
  const pt = new THREE.Vector3();
  if (ray.ray.intersectPlane(groundPlane, pt)) {
    G.aim = Math.atan2(pt.x - tarsius.position.x, pt.z - tarsius.position.z);
  }
}
// Which perch tree (if any) sits under this screen point? Generous hit
// cylinders make tapping a tree easy on touch screens.
function perchFromClient(cx, cy) {
  mouseNDC.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(mouseNDC, camera);
  const hits = ray.intersectObjects(perchHit, false);
  return hits.length ? hits[0].object.userData.perch : -1;
}
// Tarsier leap: arc to another perch tree with a mid-air spin. Shooting is
// locked for the half-second airborne (muzzle origin is mid-flight).
function leapTo(i) {
  if (i < 0 || i >= PERCHES.length || i === G.perch || G.leapT > 0) return;
  if ((G.status !== 'playing' && G.status !== 'intro') || G.paused) return;
  G.leapFrom = tarsius.position.clone();
  G.perch = i;
  G.leapT = LEAP_DUR;
  sfx('leap');
}
function doSwap() {
  if (G.status !== 'playing' || G.paused) return;
  const t = G.cur; G.cur = G.nxt; G.nxt = t;
  G.swapT = 0.32; // the Jalak tosses the talon marble over to the cannon
  sfx('swap'); updateHUD();
}
// Touch: drag on the island to aim, release to shoot (so aiming never
// misfires). Press-and-hold (~550ms) is the gesture twin of desktop
// right-click: hold a TREE to leap there, hold a marble for Jalak power.
// Mouse: move-to-aim, click-to-shoot, right-click = leap-or-power.
let touchAimId = null;
let touchHoldTimer = 0, touchHoldFired = false, touchHoldX = 0, touchHoldY = 0;
function clearTouchHold() {
  if (touchHoldTimer) { clearTimeout(touchHoldTimer); touchHoldTimer = 0; }
}
addEventListener('pointermove', e => {
  if (e.pointerType === 'touch' || e.pointerType === 'pen') {
    if (e.pointerId !== touchAimId) return;
    // dragging cancels the long-press gesture (leap or power)
    if (touchHoldTimer && Math.hypot(e.clientX - touchHoldX, e.clientY - touchHoldY) > 14) clearTouchHold();
  }
  setAimFromClient(e.clientX, e.clientY);
});
addEventListener('pointerdown', e => {
  if (e.target.closest('button') || e.target.closest('.card') || e.target.closest('.shooter-box')) return;
  audio();
  if (e.pointerType === 'touch' || e.pointerType === 'pen') {
    // tap a bloomed seed: the Jalak fetches it (never misfires a shot)
    const pk = pickupFromClient(e.clientX, e.clientY);
    if (pk) { touchAimId = null; fetchPickup(pk); return; }
    touchAimId = e.pointerId;
    touchHoldFired = false;
    touchHoldX = e.clientX; touchHoldY = e.clientY;
    clearTouchHold();
    // long-press: tree under finger = leap there, else Jalak power dispatch
    touchHoldTimer = setTimeout(() => {
      touchHoldTimer = 0;
      if (touchAimId === null) return;
      const pi = perchFromClient(touchHoldX, touchHoldY);
      if (pi >= 0 && pi !== G.perch) {
        leapTo(pi);
        touchHoldFired = true;
        touchAimId = null;
        return;
      }
      const pt = groundFromClient(touchHoldX, touchHoldY);
      if (pt && G.holding && useHeldPowerAt(pt)) {
        touchHoldFired = true;
        touchAimId = null;
      }
    }, 550);
    setAimFromClient(e.clientX, e.clientY);
    return;
  }
  // right-click: leap to a tree, else unleash the held Jalak seed.
  // (Left-click never leaps — even on a tree it just aims + shoots.)
  if (e.button === 2) {
    const pi = perchFromClient(e.clientX, e.clientY);
    if (pi >= 0 && pi !== G.perch) { leapTo(pi); return; }
    const pt = groundFromClient(e.clientX, e.clientY);
    if (pt) useHeldPowerAt(pt);
    return;
  }
  const pk = pickupFromClient(e.clientX, e.clientY);
  if (pk) { fetchPickup(pk); return; }
  setAimFromClient(e.clientX, e.clientY);
  shoot();
});
addEventListener('pointerup', e => {
  if (e.pointerId !== touchAimId) return;
  touchAimId = null;
  clearTouchHold();
  // a fired long-press already spent the gesture: never misfire a shot after
  if (touchHoldFired) { touchHoldFired = false; return; }
  if (e.target.closest('button') || e.target.closest('.card') || e.target.closest('.shooter-box')) return;
  // tap (even on a tree) is just aim + shoot — leaping needs a hold
  setAimFromClient(e.clientX, e.clientY);
  shoot();
});
addEventListener('pointercancel', e => { if (e.pointerId === touchAimId) { touchAimId = null; touchHoldFired = false; } clearTouchHold(); });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  if (e.code === 'Space') {
    e.preventDefault();
    doSwap();
  } else if (e.code === 'Tab') {
    e.preventDefault();
    if (!G.paused) leapTo((G.perch + 1) % PERCHES.length);
  } else if (e.code.startsWith('Digit')) {
    const n = +e.code.slice(5);
    if (n >= 1 && n <= PERCHES.length) leapTo(n - 1);
  } else if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  else if (e.code === 'KeyM') toggleMute();
});
$('start-btn').onclick = () => {
  audio(); if (AC && AC.state === 'suspended') AC.resume();
  $('overlay').classList.add('hidden');
  resetGame(); Music.start();
  try { $('best-line').textContent = 'best: ' + G.best; } catch { /* ignore */ }
};
document.querySelectorAll('.diff-btn[data-diff]').forEach(btn => {
  btn.onclick = () => {
    G.diff = btn.dataset.diff;
    document.querySelectorAll('.diff-btn[data-diff]').forEach(x => x.classList.toggle('sel', x === btn));
    sfx('click');
  };
});
/* Island select: reloads on the chosen LevelDef (?level=id). Same assets
   + same engine, different environment / powers / mechanics. */
document.querySelectorAll('.diff-btn[data-level]').forEach(btn => {
  btn.onclick = () => {
    sfx('click');
    try {
      const u = new URL(location.href);
      u.searchParams.set('level', btn.dataset.level);
      location.href = u.toString();
    } catch { /* ignore */ }
  };
});
try {
  const cur = LEVEL.id;
  document.querySelectorAll('.diff-btn[data-level]').forEach(x => x.classList.toggle('sel', x.dataset.level === cur));
} catch { /* ignore */ }
$('restart-btn').onclick = () => { sfx('click'); resetGame(); };
$('restart-btn2').onclick = () => { sfx('click'); togglePause(false); resetGame(); };
$('resume-btn').onclick = () => togglePause(false);
$('pause-btn').onclick = () => togglePause();
$('swap-btn').onclick = () => { audio(); doSwap(); };
$('shooter-box').onclick = () => { audio(); doSwap(); };
$('mute-btn').onclick = () => { audio(); toggleMute(); sfx('click'); };
// Touch devices get a gesture-appropriate hint (drag/release/hold/swap button).
try {
  if (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window) {
    $('hint').innerHTML = 'Drag to aim • Release to shoot • Tap a treasure, Jalak fetches it • Hold a marble to unleash • Hold a tree to leap';
  }
} catch { /* ignore */ }
addEventListener('resize', () => {
  updateOrthoCamera();
  renderer.setSize(innerWidth, innerHeight);
  if (composer) composer.setSize(innerWidth, innerHeight);
});
try { $('best-line').textContent = 'best: ' + G.best; } catch { /* ignore */ }

/* ==================== AUTOPILOT + SIMULATOR + ATTRACT ====================
   botThink plays like a person: picks a target every `interval` seconds,
   leads the moving chain, aims with gaussian wobble, swaps when the next
   seed fits better, and snipes power seeds. Used by attract mode AND by the
   headless balance simulator (test/sim.mjs), which runs step() with no
   rendering to play whole games in seconds. */
const ATTRACT_SKILL = { interval: 0.5, noise: 0.02, snipe: 0.8, swap: true };
function botThink(skill = ATTRACT_SKILL) {
  if (G.status !== 'playing' || G.paused) return;
  const b = G.balls;
  // 0) companion errands: the bot plays the Jalak too — fetch ripe seeds,
  //    spend held powers through the same right-click dispatch as a human,
  //    and hunt eagles: carriers FIRST (their loot blocks completion),
  //    then harass loiterers. Eagle duty runs even on an empty chain —
  //    stolen balls only come back via a kill.
  if (G.jalakMode === 'hover' && !G.holding && G.pickups.length) fetchPickup(G.pickups[0]);
  if (b.length) {
    if (G.holding === 'bomb') useHeldPowerAt(b[0].mesh.position);
    else if (G.holding === 'stop' && (G.danger || (b[0].s / curveLen > 0.5))) useHeldPowerAt(b[0].mesh.position);
    else if (G.holding === 'frenzy' && b.length > 10) useHeldPowerAt(b[(b.length / 2) | 0].mesh.position);
  }
  const hittable = eagles.filter(e => e.group.visible && (e.mode === 'circle' || e.mode === 'stoop' || e.mode === 'climb'));
  const carriers = hittable.filter(e => e.stealBall);
  const prey = carriers.length ? carriers[(Math.random() * carriers.length) | 0]
    : (hittable.length && Math.random() < 0.45) ? hittable[(Math.random() * hittable.length) | 0] : null;
  if (prey) {
    G.aim = Math.atan2(prey.group.position.x - tarsius.position.x, prey.group.position.z - tarsius.position.z);
    tarsius.rotation.y = G.aim;
    G.shootCD = 0;
    shoot();
    return;
  }
  if (!b.length) return;
  let target = null;
  // 2) held color, closest to the skull
  if (!target) {
    let bestS = -1;
    for (const x of b) if (x.color === G.cur && x.s > bestS) bestS = x.s;
    if (bestS >= 0) target = b.find(x => x.color === G.cur && x.s === bestS);
    else if (skill.swap !== false) {
      let bs2 = -1;
      for (const x of b) if (x.color === G.nxt && x.s > bs2) bs2 = x.s;
      if (bs2 >= 0) {
        const t = G.cur; G.cur = G.nxt; G.nxt = t;
        if (!G.sim) updateHUD();
        target = b.find(x => x.color === G.cur && x.s === bs2);
      }
    }
    if (!target) {
      if (skill.patient && b[0].s / curveLen < 0.25) return; // hold fire: nothing matches yet, skull is far
      target = b[0]; // dump at the head, like an impatient human
    }
  }
  // 3) lead the moving chain + human aim wobble
  const spd = G.holdT > 0 ? 0 : baseSpeed();
  const tp = target.mesh.position;
  const dist = Math.hypot(tp.x - tarsius.position.x, tp.z - tarsius.position.z);
  const p = pointAt(target.s + THREE.MathUtils.clamp(spd * (dist / LEVEL.mechanics.projectileSpeed), -3, 6));
  const wobble = (Math.random() + Math.random() - 1) * (skill.noise ?? 0.025);
  G.aim = Math.atan2(p.x - tarsius.position.x, p.z - tarsius.position.z) + wobble;
  tarsius.rotation.y = G.aim;
  G.shootCD = 0;
  shoot();
}
function simCleanupToMenu() {
  G.balls.forEach(x => scene.remove(x.mesh));
  G.projectiles.forEach(x => { scene.remove(x.mesh); x.trail.forEach(t => scene.remove(t)); });
  G.particles.forEach(x => scene.remove(x.m));
  G.rings.forEach(x => scene.remove(x.m));
  G.pickups.slice().forEach(removePickup);
  if (bombFall) { scene.remove(bombFall.mesh); bombFall = null; }
  Object.assign(G, {
    status: 'menu', paused: false, balls: [], projectiles: [], particles: [], rings: [],
    spawned: 0, destroyed: 0, score: 0, combo: 1, maxCombo: 1, streak: 0,
    shots: 0, hits: 0, powersUsed: 0, playTime: 0, slowT: 0, revT: 0,
    danger: false, heartT: 0, shootCD: 0, sim: false,
    holdT: 0, rewindT: 0, pickups: [], pickupT: 8, frenzyQ: [], frenzyT: 0,
    jalakMode: 'hover', jalakT: 0, jalakFrom: null, jalakTo: null, jalakPayload: null,
    holding: null, swapT: 0,
    eagleSpawnT: 14, eagleSteals: 0,
    eagleHits: 0,
    ultimates: 0,
  });
  tarsius.visible = true;
  jalakHome(jalak.group.position);
  jalak.group.scale.setScalar(1);
  nextOrb.visible = true; // hold-tuck never survives a reset
  setHeldSprite();
  clearEagles();
  spawnEagle();
  $('end-overlay').classList.add('hidden');
  $('overlay').classList.remove('hidden');
  updateHUD();
}
/* Play one full game headlessly at 30 steps/sec. Returns a result summary. */
function simGame(skill, diff = 'normal', maxMin = 12) {
  G.diff = diff;
  G.sim = true;
  const wasMuted = G.muted; G.muted = true;
  $('overlay').classList.add('hidden');
  resetGame();
  const dt = 1 / 30;
  let t = 0, nextThink = 1.9, guard = 0;
  const cap = maxMin * 60;
  while ((G.status === 'intro' || G.status === 'playing') && t < cap && ++guard < 50000) {
    step(dt, dt);
    t += dt;
    if (G.status === 'playing' && t >= nextThink) {
      botThink(skill);
      nextThink = t + skill.interval * (0.7 + Math.random() * 0.6);
    }
  }
  const res = {
    win: G.status === 'won', diff, score: G.score, des: G.destroyed,
    time: Math.round(G.playTime), shots: G.shots,
    maxCombo: G.maxCombo, bestStreak: G.bestStreak, powers: G.powersUsed,
    eagle: G.eagleHits || 0, ult: G.ultimates || 0, steals: G.eagleSteals || 0,
    timeout: t >= cap,
  };
  G.muted = wasMuted;
  simCleanupToMenu();
  return res;
}
function simGames(n, skill, diff = 'normal') {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = simGame(skill, diff);
    out.push(r);
    console.log(`[sim] ${diff} game ${i + 1}/${n}: ${r.win ? 'WIN' : 'LOSE'} score=${r.score} des=${r.des} time=${r.time}s seeds=${r.powers} eagle=${r.eagle}`);
  }
  return out;
}
/* ---------- attract mode: self-playing demo for the trailer ---------- */
function startAttract() {
  G.attract = true;
  G.muted = true;
  $('mute-btn').classList.add('off');
  $('overlay').classList.add('hidden');
  $('end-overlay').classList.add('hidden');
  resetGame();
  G.attractThink = 1.2;
}

/* ==================== MAIN LOOP ==================== */
const clockLast = { t: performance.now() };
let spawnAcc = 0;
const tmpAxis = new THREE.Vector3();
function tick() {
  requestAnimationFrame(tick);
  const nowT = performance.now();
  const rawDt = Math.min((nowT - clockLast.t) / 1000, 0.05);
  clockLast.t = nowT;
  const dt = G.paused ? 0 : rawDt;
  G.time += dt;
  if (G.shootCD > 0) G.shootCD -= dt;
  Music.tick();

  /* --- ambient life (always, even in menu) --- */
  clouds.forEach(c => { c.g.position.y = c.y0 + Math.sin(G.time * 0.8 + c.ph) * 0.5; });
  const f1 = scene.getObjectByName('foam1'), f2 = scene.getObjectByName('foam2');
  if (f1) f1.scale.setScalar(1 + Math.sin(G.time * 1.4) * 0.02);
  if (f2) { const s = 1 + Math.sin(G.time * 1.4 + 2) * 0.04; f2.scale.setScalar(s); }
  const collar = scene.getObjectByName('foamCollar');
  if (collar) {
    const p = 1 + Math.sin(G.time * 1.8) * 0.012;
    collar.scale.set(p, 1, p);
    collar.position.y = -1.5 + Math.sin(G.time * 1.8 + 0.6) * 0.04;
    // surf shader feel: scroll the foam streaks + breathe the opacity
    if (collar.material.map) collar.material.map.offset.x = (G.time * 0.03) % 1;
    collar.material.opacity = 0.9 + Math.sin(G.time * 1.8) * 0.08;
  }
  // water waves + scrolling rich texture + bobbing foam bubbles
  {
    const pos = waterMesh.geometry.attributes.position;
    const arr = pos.array;
    for (let i = 0; i < pos.count; i++) {
      const x = waterBase[i * 3], y = waterBase[i * 3 + 1];
      arr[i * 3 + 2] = Math.sin(x * 0.12 + G.time * 1.6) * 0.2 + Math.cos(y * 0.15 + G.time * 1.1) * 0.18;
    }
    pos.needsUpdate = true;
    waterMesh.geometry.computeVertexNormals();
    waterTex.offset.x = (G.time * 0.008) % 1;
    waterTex.offset.y = (G.time * 0.011) % 1;
  }
  foamBubbles.forEach(b => {
    const u = b.userData;
    b.position.y = u.y0 + Math.sin(G.time * 2 + u.ph) * 0.08;
    const s = 1 + Math.sin(G.time * 2.4 + u.ph) * 0.15;
    b.scale.set(s, 0.6 * s, s);
  });
  pinwheels.forEach((h, i) => { h.rotation.z += dt * (6 + i * 2); });
  butterflies.forEach(bf => {
    const t = G.time * 0.7 + bf.ph;
    bf.g.position.set(bf.cx + Math.sin(t) * 3, 2.4 + Math.sin(t * 2.3) * 0.5, bf.cz + Math.cos(t * 0.8) * 3);
    bf.g.rotation.y = Math.atan2(Math.cos(t) * 3, -Math.sin(t * 0.8) * 2.4);
    const flap = Math.sin(G.time * 22 + bf.ph) * 0.85;
    bf.L.rotation.y = flap; bf.R.rotation.y = -flap;
  });
  // torch flicker
  {
    const fl = scene.getObjectByName('flame'), tl = scene.getObjectByName('torchlight');
    if (fl) { fl.scale.set(1 + Math.sin(G.time * 13) * 0.12, 1 + Math.sin(G.time * 17) * 0.18, 1); fl.rotation.y += dt * 3; }
    if (tl) tl.intensity = 6 + Math.sin(G.time * 13) * 1.2 + Math.sin(G.time * 31) * 0.8;
  }
  // skull smoke
  smokes.forEach(s => {
    s.userData.t += dt;
    if (s.userData.t > 3) {
      s.userData.t = 0;
      s.position.copy(skullPos).add(new THREE.Vector3(0.4 + (Math.random() - 0.5) * 1.5, 4.4, 0.5));
    }
    s.position.y += dt * 0.9;
    const k = s.userData.t / 3;
    s.scale.setScalar(0.6 + k * 1.6);
    s.material.opacity = 0.35 * (1 - k);
  });
  // living boss gate: slow breathing scale + glowing red eye flicker
  if (skullCave) {
    const br = 1 + Math.sin(G.time * 1.6) * 0.015;
    skullCave.scale.set(br, 1 + (1 - br), br);
  }
  if (skullEyeMat) {
    const target = G.danger && (G.status === 'playing')
      ? 3.0 + Math.sin(G.time * 8) * 0.8
      : 0.9 + Math.sin(G.time * 2.2) * 0.25;
    skullEyeMat.emissiveIntensity += (target - skullEyeMat.emissiveIntensity) * Math.min(1, dt * 3);
  }

  /* --- tarsius life: tree-clinger that leaps between perches --- */
  if (G.leapT > 0 && !G.paused) {
    G.leapT = Math.max(0, G.leapT - dt);
    const t = 1 - G.leapT / LEAP_DUR;
    const e = t * t * (3 - 2 * t); // smoothstep
    tarsius.position.lerpVectors(G.leapFrom, PERCHES[G.perch], e);
    tarsius.position.y = 0.6 + Math.sin(t * Math.PI) * 3.2; // hop arc
    tarsius.rotation.y += dt * 13; // mid-air spin, lands facing aim below
    tarsiusBody.scale.set(1.3 * 0.85, 1.3 * 1.3, 1.3 * 0.85); // stretched thin mid-leap
    if (G.leapT <= 0) {
      tarsius.position.copy(PERCHES[G.perch]);
      tarsius.rotation.y = G.aim;
      G.shake = Math.min(1, G.shake + 0.12); // soft landing thud
    }
  } else {
    tarsius.rotation.y = G.aim;
  }
  tarsiusBody.position.y = 1.0 + Math.sin(G.time * 3) * 0.05 - G.recoil * 0.15 + (G.happy > 0 ? Math.sin(G.happy * 12) * 0.12 : 0);
  tarsiusBody.rotation.x = -0.12 + G.recoil * 0.25; // leaned back against the trunk, face tipped to the sky-camera
  const squash = 1 + (G.happy > 0 ? Math.sin(G.happy * 12) * 0.06 : 0);
  if (G.leapT <= 0) tarsiusBody.scale.set(1.3 * (2 - squash > 0 ? 1 / Math.sqrt(squash) : 1), 1.3 * squash, 1.3);
  if (G.recoil > 0) G.recoil = Math.max(0, G.recoil - dt * 5);
  if (G.happy > 0) G.happy = Math.max(0, G.happy - dt);
  if (tailMesh) tailMesh.rotation.y = Math.sin(G.time * 2.2) * 0.35;
  const earL = tarsiusBody.getObjectByName('earL');
  const earR = tarsiusBody.getObjectByName('earR');
  // bouncy ear physics: idle sway + happy perk + springy flop when a marble fires
  const flop = G.recoil * 0.9 + (G.happy > 0 ? 0.35 : 0);
  const wob = Math.sin(G.time * 28) * G.recoil * 0.35;
  if (earL) earL.rotation.z = 0.3 + Math.sin(G.time * 1.3) * 0.06 + flop + wob;
  if (earR) earR.rotation.z = -0.3 - Math.sin(G.time * 1.3 + 1) * 0.06 - flop - wob;
  G.blink -= dt;
  if (G.blink < -0.12) G.blink = 2 + Math.random() * 3;
  eyeL.scale.y = eyeR.scale.y = G.blink < 0 ? 0.1 : 1;
  if (G.flash > 0) {
    G.flash -= dt;
    flashMesh.material.opacity = Math.max(0, G.flash / 0.09) * 0.95;
    flashMesh.scale.setScalar(1 + (0.09 - Math.max(0, G.flash)) * 8);
  } else flashMesh.material.opacity = 0;
  // loaded seed-orb riding the bamboo tip: bouncy micro-animation (local to body)
  const cb = Math.sin(G.time * 2);
  curOrb.position.y = 0.55 + cb * 0.12;
  curOrb.scale.set(1 - cb * 0.04, 1 + cb * 0.06, 1 - cb * 0.04);
  const nb = Math.sin(G.time * 2 + 1);
  // NEXT marble dangles from the Jalak's talons (local space now) —
  // tucked away while HOLDING: the 2.6× giant would otherwise park a huge
  // marble on the chain head, confusing it with path balls (NEXT stays
  // readable in the HUD shooter-box meanwhile).
  nextOrb.visible = G.jalakMode !== 'hold';
  nextOrb.position.set(0, -0.35 + nb * 0.05, 0);
  nextOrb.scale.setScalar(0.62 * (1 + nb * 0.05));
  curOrb.rotation.y += dt; nextOrb.rotation.y -= dt * 1.4;
  /* --- Jalak life: hover-bob, swap-toss dip, frantic wingbeats on errands --- */
  {
    const J = jalak.group;
    const busy = G.jalakMode !== 'hover' && G.jalakMode !== 'hold';
    const dip = G.swapT > 0 ? Math.sin((G.swapT / 0.32) * Math.PI) * 0.7 : 0;
    J.position.y += Math.sin(G.time * 4.2) * 0.008 - dip * dt * 8;
    const flap = Math.sin(G.time * (busy ? 34 : 14)) * (busy ? 0.9 : 0.45);
    jalak.refs.wingL.rotation.z = 0.25 + flap;
    jalak.refs.wingR.rotation.z = -0.25 - flap;
    J.rotation.y = tarsius.rotation.y * 0.6;
  }
  /* --- Elang Jawa life: soar, stoop and shadow (whole flock) --- */
  for (const e of eagles) {
    const E = e.group;
    if (E.visible) {
      const diving = e.mode === 'stoop' || e.mode === 'climb' || e.mode === 'flee';
      const flap = diving ? Math.sin(G.time * 20 + e.t) * 0.7 : Math.sin(G.time * 3.5 + e.t) * 0.18;
      e.refs.wingL.rotation.z = 0.12 + flap;
      e.refs.wingR.rotation.z = -0.12 - flap;
      e.shadow.position.set(E.position.x, 0.665, E.position.z);
      const shScale = THREE.MathUtils.clamp(2.3 - E.position.y * 0.09, 0.8, 2.1);
      e.shadow.scale.set(shScale, shScale, 1);
      if (e.stealBall) e.stealBall.mesh.rotation.y += dt * 3;
    }
  }
  // bloomed treasure chests bob + spin + creak until fetched or wilted
  for (const p of G.pickups) {
    p.chest.position.y = 1.0 + Math.sin(G.time * 3 + p.x) * 0.15;
    p.chest.rotation.y += dt * 2;
    p.chestRefs.lid.rotation.x = TREASURE_LID_OPEN + Math.sin(G.time * 3 + p.x) * 0.08;
    p.halo.rotation.z += dt * 1.2;
  }
  // perch rings: the active tree glows green, the rest glow faint sand
  for (let i = 0; i < perchRings.length; i++) {
    const active = i === G.perch;
    perchRings[i].material.color.setHex(active ? 0x2dc653 : 0xffe8a3);
    perchRings[i].material.emissive.setHex(active ? 0x2dc653 : 0xffe8a3);
    perchRings[i].material.emissiveIntensity = active ? 0.85 + Math.sin(G.time * 5) * 0.3 : 0.25;
  }
  if (tarBlob) tarBlob.position.set(tarsius.position.x, 0.665, tarsius.position.z);

  /* --- camera (sway + shake) --- */
  if (G.shake > 0) G.shake = Math.max(0, G.shake - rawDt * 2.2);
  const shx = (Math.random() - 0.5) * G.shake * 0.9;
  const shy = (Math.random() - 0.5) * G.shake * 0.7;
  const drift = G.attract ? Math.sin(G.time * 0.05) * 2.5 : 0; // slow cinematic pan
  camera.position.set(Math.sin(G.time * 0.08) * 1.2 + shx + drift, 26 + shy, 20);
  camera.lookAt(0, 0, 1.0);

  step(dt, rawDt);
  // attract-mode self-play + auto-restart (trailer demo)
  if (G.attract && !G.paused) {
    if (G.status === 'playing') {
      G.attractThink -= rawDt;
      if (G.attractThink <= 0) { G.attractThink = 0.5; botThink(ATTRACT_SKILL); }
    } else if (G.status === 'won' || G.status === 'lost') {
      G.attractEnd -= rawDt;
      if (G.attractEnd <= 0) { $('end-overlay').classList.add('hidden'); resetGame(); }
    } else if (G.status === 'menu') {
      startAttract();
    }
  }
  if (composer) composer.render(); else renderer.render(scene, camera);
}

/* ---------- Jalak + Elang Jawa brains (game-time: sim-safe) ---------- */
function moveEagleToward(e, target, speed, dt) {
  const grp = e.group;
  const d = target.clone().sub(grp.position);
  const dist = d.length();
  if (dist > 0.001) {
    grp.position.addScaledVector(d.normalize(), Math.min(dist, speed * dt));
    const yaw = Math.atan2(d.x, d.z);
    let dy = yaw - grp.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    grp.rotation.y += dy * Math.min(1, dt * 4);
    grp.rotation.z = THREE.MathUtils.clamp(-dy * 1.5, -0.5, 0.5);
  }
  grp.position.y += Math.sin(G.time * 3.1 + e.t) * dt * 0.8;
}
function stepPickups(dt) {
  for (let i = G.pickups.length - 1; i >= 0; i--) {
    const p = G.pickups[i];
    p.age += dt;
    if (p.age > (LEVEL.pickupExpiry ?? 30)) removePickup(p);
  }
  G.pickupT -= dt;
  if (G.pickupT <= 0) {
    G.pickupT = (LEVEL.pickupInterval ?? 16) * (0.8 + Math.random() * 0.5);
    if (G.pickups.length < (LEVEL.pickupMax ?? 3)) {
      const p = spawnPickup();
      if (p && !G.sim) floater(POWERS[p.type].name + ' bloomed!', new THREE.Vector3(p.x, 2.5, p.z));
    }
  }
}
const _jv = new THREE.Vector3();
function stepJalak(dt) {
  if (G.swapT > 0) G.swapT -= dt;
  const J = jalak.group;
  const smooth = t => t * t * (3 - 2 * t);
  // falling bomb from a drop run
  if (bombFall) {
    bombFall.t -= dt;
    bombFall.mesh.position.y -= dt * 14;
    if (bombFall.t <= 0) {
      const at = bombFall.target;
      scene.remove(bombFall.mesh); bombFall = null;
      triggerPower('bomb', at);
    }
  }
  if (G.jalakMode === 'hover') {
    J.position.lerp(jalakHome(_jv), Math.min(1, dt * 3));
    const s = J.scale.x + (1 - J.scale.x) * Math.min(1, dt * 4);
    J.scale.setScalar(s);
  } else if (G.jalakMode === 'fetch' || G.jalakMode === 'return' || G.jalakMode === 'bomb') {
    G.jalakT -= dt;
    const t = THREE.MathUtils.clamp(1 - G.jalakT / 0.55, 0, 1);
    J.position.lerpVectors(G.jalakFrom, G.jalakTo, smooth(t));
    J.position.y += Math.sin(t * Math.PI) * 2.2;
    if (G.jalakT <= 0) {
      if (G.jalakMode === 'fetch') {
        const p = G.jalakPayload;
        if (p && G.pickups.indexOf(p) >= 0) {
          G.holding = p.type;
          removePickup(p);
          setHeldSprite(); updateHUD();
          sfx('grab');
          if (!G.sim) floater('+' + POWERS[p.type].name, J.position.clone(), true);
        } else if (!G.sim) floater('gone…', J.position.clone());
        G.jalakPayload = null;
        G.jalakMode = 'return';
        G.jalakFrom = J.position.clone();
        G.jalakTo = jalakHome();
        G.jalakT = 0.55;
      } else if (G.jalakMode === 'bomb') {
        const at = G.jalakPayload ? G.jalakPayload.clone() : J.position.clone();
        const bm = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12),
          new THREE.MeshPhysicalMaterial({ flatShading: true, color: 0x2b2d42, emissive: 0xff9e00, emissiveIntensity: 1.2, roughness: 0.25, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1 }));
        bm.position.copy(J.position);
        scene.add(bm);
        bombFall = { mesh: bm, t: 0.3, target: new THREE.Vector3(at.x, 1.15, at.z) };
        G.jalakPayload = null;
        G.jalakMode = 'return';
        G.jalakFrom = J.position.clone();
        G.jalakTo = jalakHome();
        G.jalakT = 0.55;
      } else {
        G.jalakMode = 'hover';
      }
    }
  } else if (G.jalakMode === 'hold') {
    if (G.holdT <= 0 || !G.balls.length) { G.jalakMode = 'hover'; }
    else {
      const s = J.scale.x + (2.6 - J.scale.x) * Math.min(1, dt * 4);
      J.scale.setScalar(s);
      const head = G.balls[0].mesh.position;
      _jv.set(head.x, head.y + 2.4, head.z + 0.8);
      J.position.lerp(_jv, Math.min(1, dt * 5));
    }
  } else if (G.jalakMode === 'frenzy') {
    if (!G.frenzyQ.length) {
      updateHUD(); checkWin();
      G.jalakMode = 'return';
      G.jalakFrom = J.position.clone();
      G.jalakTo = jalakHome();
      G.jalakT = 0.5;
    } else {
      const prey = G.frenzyQ[0];
      if (G.balls.indexOf(prey) < 0) { G.frenzyQ.shift(); }
      else {
        _jv.copy(prey.mesh.position); _jv.y += 0.9;
        J.position.lerp(_jv, Math.min(1, dt * 10));
        G.frenzyT -= dt;
        if (G.frenzyT <= 0 && J.position.distanceTo(prey.mesh.position) < 1.6) {
          G.frenzyQ.shift();
          destroyBall(prey, 15);
          sfx('pop');
          G.frenzyT = 0.16;
          updateHUD();
        }
      }
    }
  }
}
function stepEagle(dt) {
  const m = LEVEL.mechanics;
  // reinforcements: fresh birds join until the flock hits the difficulty cap
  if (G.status === 'playing' && !G.paused) {
    G.eagleSpawnT -= dt;
    if (G.eagleSpawnT <= 0) {
      G.eagleSpawnT = (m.eagleSpawnEvery ?? 20) * (0.8 + Math.random() * 0.4);
      if (eagles.length < eagleCap()) spawnEagle();
    }
  }
  for (const e of eagles) {
    const E = e.group;
    if (e.mode === 'gone') {
      if (G.status === 'playing' && !G.paused) {
        e.goneT -= dt;
        if (e.goneT <= 0) {
          const a = Math.random() * Math.PI * 2;
          E.position.set(Math.cos(a) * 24, 14, Math.sin(a) * 24);
          E.visible = true; e.shadow.visible = true;
          e.mode = 'circle';
          e.stoopT = (m.eagleStoopEvery ?? 18) * (0.8 + Math.random() * 0.4);
          pickEagleWP(e, 9);
        }
      }
      continue;
    }
    if ((G.status !== 'playing' && G.status !== 'intro') || G.paused) continue;
    if (e.mode === 'circle') {
      moveEagleToward(e, e.wp, (5 + Math.sin(G.time * 0.7 + e.t) * 2) * (e.stealBall ? 0.85 : 1), dt);
      if (E.position.distanceTo(e.wp) < 1.5 || Math.random() < dt * 0.4) pickEagleWP(e);
      // carriers keep circling with their prize; only empty claws stoop again
      if (G.status === 'playing' && !e.stealBall) {
        e.stoopT -= dt;
        if (e.stoopT <= 0) {
          e.stoopT = (m.eagleStoopEvery ?? 18) * (0.6 + Math.random() * 0.8);
          eagleStoop(e);
        }
      }
    } else if (e.mode === 'stoop') {
      moveEagleToward(e, e.wp, 17, dt);
      if (E.position.distanceTo(e.wp) < 1.3) {
        // grab the marked marble (or any survivor if the chain shifted)
        let prey = (e.stealRef && G.balls.includes(e.stealRef)) ? e.stealRef
          : G.balls.length ? G.balls[(Math.random() * G.balls.length) | 0] : null;
        e.stealRef = null;
        if (prey) {
          const bi = G.balls.indexOf(prey);
          if (bi >= 0) G.balls.splice(bi, 1);
          scene.remove(prey.mesh);
          e.group.add(prey.mesh);
          prey.mesh.position.set(0, -1.0, 0.3);
          prey.mesh.rotation.set(0, 0, 0);
          e.stealBall = { color: prey.color, mesh: prey.mesh };
          G.eagleSteals = (G.eagleSteals || 0) + 1;
          floater('BALL STOLEN!', new THREE.Vector3(e.wp.x, 3, e.wp.z), true);
          sfx('warn');
          sanitizeHeld();
          updateHUD(); checkWin();
        }
        e.mode = 'climb';
        pickEagleWP(e, 11);
      }
    } else if (e.mode === 'climb') {
      moveEagleToward(e, e.wp, 12, dt);
      if (E.position.distanceTo(e.wp) < 1.5) e.mode = 'circle';
    } else if (e.mode === 'flee') {
      e.t += dt;
      E.position.addScaledVector(e.fleeDir, 22 * dt);
      E.position.y += 6 * dt;
      if (e.t > 1.1) { E.visible = false; e.shadow.visible = false; e.mode = 'gone'; }
    }
  }
}

/* Pure game logic, shared by the live loop and the fast headless simulator:
   chain, spawner, projectiles, powers, particles. No rendering, no DOM in sim. */
function step(dt, rawDt) {
  if ((G.status === 'playing' || G.status === 'intro') && !G.paused) {
    if (G.status === 'intro') {
      G.introT -= dt;
      if (G.introT <= 0) { G.status = 'playing'; showBanner('GO!', 'match 3 or more!'); }
    } else {
      G.playTime += dt;
      if (G.holdT > 0) {
        G.holdT -= dt;
        if (G.holdT <= 0) { G.holdT = 0; if (G.jalakMode === 'hold') G.jalakMode = 'hover'; }
      }
      if (G.rewindT > 0) G.rewindT = Math.max(0, G.rewindT - dt);
      const m = LEVEL.mechanics;
      const frozen = G.holdT > 0; // Jalak holds the head: the march stops cold
      const reversing = G.rewindT > 0; // ULTIMATE rewind: slow backward drift
      const rewindSpeed = (m.ultimateRollback ?? 14) / (m.ultimateRewindDur ?? 2.2);
      const spd = frozen ? 0 : reversing ? -rewindSpeed : baseSpeed()
        * (G.danger ? m.finalStandBrake : 1); // skull toys with its food: final-stand brake

      // spawner: plain marbles only — power seeds bloom on the grass now
      if (!frozen && G.spawned < TOTAL_BALLS) {
        spawnAcc += dt;
        const tail = G.balls[G.balls.length - 1];
        const gapOk = !tail || tail.s > SPACING * 1.1;
        if (spawnAcc > (SPACING / Math.max(0.4, baseSpeed())) * 1.35 && gapOk) {
          spawnAcc = 0;
          spawnBall(0, randColor(), null);
          G.spawned++;
          updateHUD();
        }
      }
      // chain movement (frozen solid while the Jalak holds the head)
      if (!frozen) {
      const b = G.balls;
      if (b.length) {
        const joins = [];
        const joinGap = SPACING * m.joinGap;
        b[0].s += spd * dt;
        if (b[0].s < 0) b[0].s = 0; // rewind never pushes past the portal
        for (let i = 1; i < b.length; i++) {
          const dist = b[i - 1].s - b[i].s;
          if (reversing) {
            // whole chain backs up, keep spacing
            b[i].s += spd * dt;
            if (b[i - 1].s - b[i].s < SPACING * 0.9) b[i].s = b[i - 1].s - SPACING * 0.9;
          } else if (dist > SPACING + 0.06) {
            b[i].s += Math.min(m.magnetSpeed * dt, dist - SPACING); // magnet catch-up
            // two segments just assembled into one group: a 3+ run may be complete
            if (dist > joinGap && (b[i - 1].s - b[i].s) <= joinGap) joins.push(b[i]);
          } else {
            b[i].s += spd * dt;
            if (b[i - 1].s - b[i].s < SPACING) b[i].s = b[i - 1].s - SPACING;
          }
          if (b[i].s < 0) b[i].s = 0;
        }
        b.forEach(x => {
          const p = pointAt(x.s);
          x.mesh.position.set(p.x, 1.15, p.z);
          // rolling
          tmpAxis.copy(tangentAt(x.s));
          const ax = new THREE.Vector3(-tmpAxis.z, 0, tmpAxis.x).normalize();
          x.core.rotateOnWorldAxis(ax, (spd * dt) / BALL_R);
        });
        // Zuma-style chaining: freshly assembled segments may complete a 3+ run
        // (object refs re-resolved since pops splice the array; each pop also
        // nudges the chain back, so combos buy the player real room).
        if (!reversing) {
          for (const ball of joins) {
            const idx = b.indexOf(ball);
            if (idx >= 0) popCheck(idx);
            if (!b.length) break;
          }
        }
        if (!b.length) { updateHUD(); }
        else {
          const headR = b[0].s / curveLen;
          const wasDanger = G.danger;
          G.danger = headR > LEVEL.mechanics.dangerThreshold;
          if (G.danger && !wasDanger) {
            showBanner('THE SKULL STIRS!', 'hurry, little guardian!');
            sfx('warn');
          }
          if (G.danger) {
            G.heartT -= dt;
            if (G.heartT <= 0) { G.heartT = 1.6; sfx('heart'); }
          }
          if (!reversing && b[0].s >= curveLen - 1.2) endGame(false);
          updateHUD();
        }
      }
      }
      // projectiles
      for (let i = G.projectiles.length - 1; i >= 0; i--) {
        const pr = G.projectiles[i];
        const prevX = pr.pos.x, prevZ = pr.pos.z;
        pr.pos.addScaledVector(pr.vel, dt);
        pr.mesh.position.set(pr.pos.x, 1.15, pr.pos.z);
        pr.core.rotation.y += dt * 9;
        pr.hist.unshift(pr.pos.clone());
        if (pr.hist.length > 9) pr.hist.pop();
        pr.trail.forEach((t, k) => {
          const h = pr.hist[Math.min(pr.hist.length - 1, k * 2 + 1)];
          if (h) { t.position.set(h.x, 1.15, h.z); t.visible = true; }
          else t.visible = false;
        });
        let dead = Math.abs(pr.pos.x) > 20 || Math.abs(pr.pos.z) > 20;
        let handled = false; // hit branches splice immediately; only bare
        // out-of-bounds deaths fall through to the miss handler below
        // the Elang Jawa flock raids the island: clip one mid-flight (+50).
        // Swept XZ segment (no tunneling past the fast stoop) + a
        // screen-space fallback so aiming AT the bird connects.
        // Carriers drop their stolen marble smashed (+15) — required to finish.
        if (!dead) {
          for (const e of eagles) {
            if (!e.group.visible || (e.mode !== 'circle' && e.mode !== 'stoop' && e.mode !== 'climb')) continue;
            const ex = e.group.position.x, ez = e.group.position.z;
            if (segHitsEagle(prevX, prevZ, pr.pos.x, pr.pos.z, ex, ez, EAGLE_HIT_R) || screenHitsPos(pr, e.group.position)) {
              scene.remove(pr.mesh); pr.trail.forEach(t => scene.remove(t));
              G.projectiles.splice(i, 1);
              eagleDown(e);
              dead = true; handled = true;
              break;
            }
          }
        }
        if (!dead) {
          // nearest-ball wins (fairer hits when crossing a moving chain)
          let bestJ = -1, bestD = Infinity;
          for (let j = 0; j < G.balls.length; j++) {
            const bp = G.balls[j].mesh.position;
            const dx = pr.pos.x - bp.x, dz = pr.pos.z - bp.z;
            const d2 = dx * dx + dz * dz;
            if (d2 < bestD) { bestD = d2; bestJ = j; }
          }
          if (bestJ >= 0 && bestD < (BALL_R * 2 - 0.06) ** 2) {
            const j = bestJ;
            scene.remove(pr.mesh); pr.trail.forEach(t => scene.remove(t));
            G.projectiles.splice(i, 1);
            insertShot(pr, j);
            dead = true; handled = true;
          }
        }
        if (handled) { /* hit: already spliced, streak/combo kept */ }
        else if (dead) {
          scene.remove(pr.mesh); pr.trail.forEach(t => scene.remove(t));
          G.projectiles.splice(i, 1);
          onMiss();
        }
      }
      // companions + pickups (game-time, so sim + attract stay consistent)
      stepPickups(dt);
      stepJalak(dt);
      stepEagle(dt);
    }
    // particles + rings always animate (even intro)
    for (let i = G.particles.length - 1; i >= 0; i--) {
      const p = G.particles[i];
      p.life -= dt; p.v.y -= 14 * dt;
      p.m.position.addScaledVector(p.v, dt);
      p.m.scale.setScalar(Math.max(0.01, p.life * 1.5));
      if (p.life <= 0) { scene.remove(p.m); G.particles.splice(i, 1); }
    }
    for (let i = G.rings.length - 1; i >= 0; i--) {
      const r = G.rings[i];
      r.t += dt * 2.2;
      r.m.scale.setScalar(1 + r.t * r.max);
      r.m.material.opacity = 0.9 * (1 - r.t);
      if (r.t >= 1) { scene.remove(r.m); G.rings.splice(i, 1); }
    }
  }
}
updateHUD();
tick();

/* ---------- hooks for automated verification ---------- */
window.__game = {
  G, curveLen, PALETTE_CSS, ballMats, spawnBall, pointAt, triggerPower, composer, toy, toyGlow, marbleMat,
  scene, camera, TOTAL_BALLS, DIFFS, ATTRACT_SKILL, botThink, simGame, simGames,
  LEVEL, LEVELS: listLevels(), levelId: LEVEL.id,
  switchLevel: (id) => {
    try {
      const u = new URL(location.href);
      u.searchParams.set('level', id);
      location.href = u.toString();
    } catch { /* ignore */ }
  },
  start: () => { $('overlay').classList.add('hidden'); resetGame(); Music.start(); },
  shootAt: (x, z) => {
    G.aim = Math.atan2(x - tarsius.position.x, z - tarsius.position.z);
    tarsius.rotation.y = G.aim;
    G.shootCD = 0; shoot();
  },
  leapTo, PERCHES,
  jalak: jalak.group, nextOrb,
  get eagle() { return eagles.length ? eagles[0].group : null; },
  eagles, eaglesHolding, eagleCap, spawnEagle, clearEagles,
  pickups: () => G.pickups.map(p => p.type),
  holding: () => G.holding,
  spawnPickup, fetchPickup, dropBombAt, fireHold, fireFrenzy, useHeldPowerAt, eagleDown, eagleStoop,
  segHitsEagle, screenHitsEagle, screenHitsPos, EAGLE_HIT_R,
  ballCount: () => G.balls.length,
  score: () => G.score,
  status: () => G.paused ? 'paused' : G.status,
};
try { $('subtitle').textContent = `${LEVEL.name} • Lv ${LEVEL.levelNo}`; } catch { /* ignore */ }
try {
  // Menu seed legend mirrors this island's power mix (same icons, per-level set).
  const legend = document.querySelector('.seeds-legend');
  const story = document.querySelector('#overlay .story');
  if (story) story.innerHTML = `A tiny <b>tarsius</b> guards a toy-box <b>${LEVEL.name}</b>.<br/>Marble spirits roll toward the <b>Skull Cave</b> — and <b>elang</b> steal them away…<br/>shoot the thieves down! Match <b>3+</b> to pop!`;  if (legend) {
    legend.innerHTML = LEVEL.powersAvailable.map(t => {
      const d = POWERS[t]; if (!d) return '';
      const blurb = 'right-click / hold any marble';
      return `<div><span class="seed ${t}">${d.letter}</span><b>${d.name[0] + d.name.slice(1).toLowerCase()}</b><i>${blurb}</i></div>`;
    }).join('');
  }
} catch { /* ignore */ }
/* ---------- attract mode via ?attract=1 (self-playing trailer demo) ---------- */
try {
  if (new URLSearchParams(location.search).has('attract')) startAttract();
} catch { /* ignore */ }
