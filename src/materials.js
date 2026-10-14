import * as THREE from 'three';

/* ============================================================
   MATERIALS — tactile generation, isolated from game state.
     Felt  : programmatic periodic Perlin noise painted onto a hidden
             canvas → CanvasTexture (RepeatWrapping, repeat 50×50) used
             as bumpMap on MeshPhysicalMaterial with roughness 0.95,
             metalness 0, clearcoat 0 — fuzzy felt / sculpted clay.
     Wood  : MeshStandardMaterial roughness 0.6, warm wood color +
             streaky woodgrain noise bump (track, cannon, timber).
     Glass : solid-glass marble shell — transmission 1.0, ior 1.5,
             thickness 2.0, roughness 0.05, clearcoat 1.0, per-color
             attenuation so the colored core reads through refraction.
     Env   : procedural gradient-sky PMREM so glass & plastic pick up
             real environment reflections without an HDRI file.
   ============================================================ */

/* ---------- periodic Perlin noise (seamless when tiled) ---------- */
const PERM = (() => {
  const p = new Uint8Array(512);
  const src = new Uint8Array(256);
  for (let i = 0; i < 256; i++) src[i] = i;
  let seed = 1337;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = src[i]; src[i] = src[j]; src[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = src[i & 255];
  return p;
})();
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
/* Periodic 2D Perlin: lattice wraps at `period` so the texture tiles. */
function perlin(x, y, period) {
  const px = Math.floor(x), py = Math.floor(y);
  const fx = x - px, fy = y - py;
  const wx = ((px % period) + period) % period;
  const wy = ((py % period) + period) % period;
  const wx1 = (wx + 1) % period, wy1 = (wy + 1) % period;
  const dot = (ix, iy, dx, dy) => {
    const g = GRAD[PERM[(PERM[ix & 255] + iy) & 255] & 7];
    return g[0] * dx + g[1] * dy;
  };
  const n00 = dot(wx, wy, fx, fy);
  const n10 = dot(wx1, wy, fx - 1, fy);
  const n01 = dot(wx, wy1, fx, fy - 1);
  const n11 = dot(wx1, wy1, fx - 1, fy - 1);
  const u = fade(fx), v = fade(fy);
  return (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
}
function fbm(x, y, period) {
  let sum = 0, amp = 0.5, p = period;
  for (let o = 0; o < 4; o++) {
    sum += perlin(x * (1 << o), y * (1 << o), p) * amp;
    amp *= 0.5; p = period * (1 << o);
    void p;
  }
  return sum;
}

/* Paint fBm grayscale onto a hidden canvas — the felt micro-relief. */
function noiseCanvas(size, cells, contrast) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const img = x.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const n = fbm((i / size) * cells, (j / size) * cells, cells);
      const v = Math.max(0, Math.min(255, 128 + n * contrast * 128));
      const k = (j * size + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  return c;
}

/* Shared felt bump: repeat(50, 50) as specified — one texture instance
   feeds every felt material (grass, trees, tarsier, props). */
export const feltNoise = (() => {
  const t = new THREE.CanvasTexture(noiseCanvas(256, 16, 0.85));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(50, 50);
  t.anisotropy = 4;
  return t;
})();

/* Felt / clay preset: matte, fuzzy, zero gloss. */
export function feltMat(color, o = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, flatShading: true,
    roughness: 0.95, metalness: 0.0, clearcoat: 0.0,
    bumpMap: feltNoise, bumpScale: 0.35,
    ...o,
  });
}

/* ---------- woodgrain (warm timber: streaks along U) ---------- */
const woodCanvas = (() => {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.fillStyle = '#8a5a30'; x.fillRect(0, 0, size, size);
  // long grain streaks
  for (let i = 0; i < 90; i++) {
    x.globalAlpha = 0.10 + Math.random() * 0.18;
    x.fillStyle = ['#6e431f', '#a06a38', '#59351a', '#b87f45'][(Math.random() * 4) | 0];
    const y = Math.random() * size;
    x.beginPath();
    x.ellipse(Math.random() * size, y, 30 + Math.random() * 90, 1.5 + Math.random() * 2.5, 0, 0, 7);
    x.fill();
  }
  // fine noise (height for the bump)
  for (let i = 0; i < 5000; i++) {
    x.globalAlpha = 0.12 + Math.random() * 0.2;
    x.fillStyle = Math.random() < 0.5 ? '#4d2f16' : '#c08a50';
    x.fillRect(Math.random() * size, Math.random() * size, 1.5, 1);
  }
  x.globalAlpha = 1;
  return c;
})();

/* Woodgrain bump texture — cloned per repeat setup (cheap, shared pixels). */
export function woodBump(rx = 6, ry = 1) {
  const t = new THREE.CanvasTexture(woodCanvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  t.anisotropy = 4;
  return t;
}

/* Track / timber: warm wood, roughness 0.6, woodgrain bump. */
export function woodMat(o = {}) {
  return new THREE.MeshStandardMaterial({
    color: 0xb07a42, roughness: 0.6, metalness: 0.0,
    bumpMap: woodBump(6, 1), bumpScale: 0.25,
    ...o,
  });
}

/* ---------- solid glass marble shell (hint spec verbatim) ---------- */
const shellGeo = new THREE.SphereGeometry(1, 32, 24);
export function glassShellMat(attenuation) {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 1.0, ior: 1.5, thickness: 2.0,
    roughness: 0.05, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.03,
    attenuationColor: attenuation, attenuationDistance: 1.4,
    specularIntensity: 1.0, envMapIntensity: 1.2,
    side: THREE.FrontSide,
  });
}
export function shellGeometryFor(radius) { return shellGeo.clone().scale(radius, radius, radius); }

/* Colored patterned core INSIDE the glass (readability through refraction). */
export function marbleCoreMat(faceTex, emissive) {
  return new THREE.MeshPhysicalMaterial({
    flatShading: false,
    color: 0xffffff, map: faceTex,
    roughness: 0.35, metalness: 0.0,
    clearcoat: 0.6, clearcoatRoughness: 0.15,
    emissive, emissiveIntensity: 0.4,
  });
}

/* ---------- procedural environment (glass needs reflections) ---------- */
export function buildEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  // gradient sky/ground dome
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0.0, '#7ec8ff');   // zenith
  g.addColorStop(0.45, '#cfeaff');  // sky
  g.addColorStop(0.5, '#fff2d0');   // warm horizon (matches key light)
  g.addColorStop(0.55, '#8fbf6a');  // ground bounce
  g.addColorStop(1.0, '#3f7a35');
  x.fillStyle = g; x.fillRect(0, 0, 64, 128);
  const skyTex = new THREE.CanvasTexture(c);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
  );
  env.add(dome);
  // warm softbox "sun" card + cool sky card for crisp glass glints
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(30, 30),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5.4, 4.2), side: THREE.DoubleSide }));
  sun.position.set(12, 34, 14); sun.lookAt(0, 0, 0);
  env.add(sun);
  const cool = new THREE.Mesh(new THREE.PlaneGeometry(40, 20),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.8, 2.4), side: THREE.DoubleSide }));
  cool.position.set(-20, 10, -25); cool.lookAt(0, 0, 0);
  env.add(cool);
  const tex = pmrem.fromScene(env, 0.04).texture;
  pmrem.dispose();
  skyTex.dispose();
  dome.geometry.dispose(); dome.material.dispose();
  sun.geometry.dispose(); sun.material.dispose();
  cool.geometry.dispose(); cool.material.dispose();
  return tex;
}
