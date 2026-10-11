import * as THREE from 'three';

/* ============================================================
   ASSETS — reusable toy-diorama visual factories (no game state,
   no level data). Every level environment reuses these builders,
   so a new island / new powers never needs new art code.
   ============================================================ */

export function R(a, b) { return a + Math.random() * (b - a); }

export function canvasTex(size, painter, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  painter(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function speckle(x, s, n, cols, aMin, aMax, rMin, rMax) {
  for (let i = 0; i < n; i++) {
    x.globalAlpha = R(aMin, aMax);
    x.fillStyle = cols[(Math.random() * cols.length) | 0];
    const r = R(rMin, rMax);
    x.beginPath(); x.arc(R(0, s), R(0, s), r, 0, 7); x.fill();
  }
  x.globalAlpha = 1;
}

/* Hand-sculpted wobble: jitter vertices with position-hashed offsets so
   duplicated polyhedron verts stay welded (no cracks). */
export function sculpt(geo, amt = 0.07) {
  const pos = geo.attributes.position;
  const seen = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = pos.getX(i).toFixed(3) + ',' + pos.getY(i).toFixed(3) + ',' + pos.getZ(i).toFixed(3);
    let d = seen.get(k);
    if (!d) {
      d = [(Math.random() - 0.5) * 2 * amt, (Math.random() - 0.5) * 2 * amt, (Math.random() - 0.5) * 2 * amt];
      seen.set(k, d);
    }
    pos.setXYZ(i, pos.getX(i) + d[0], pos.getY(i) + d[1], pos.getZ(i) + d[2]);
  }
  geo.computeVertexNormals();
  return geo;
}

export function roundRockGeo(r) { return sculpt(new THREE.IcosahedronGeometry(r, 1), 0.08); }

/* Toy helpers: tactile premium painted wood / matte plastic.
   Solid objects use Standard/Physical only (no Basic). */
export function toy(color, o = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, roughness: 0.2, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.1,
    ...o, flatShading: true,
  });
}

export function toyGlow(color, o = {}) {
  return new THREE.MeshPhysicalMaterial({
    color, emissive: color, emissiveIntensity: 0.7,
    roughness: 0.2, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1,
    ...o, flatShading: true,
  });
}

/* ---------- procedural textures (zero assets, stay sharp) ---------- */
export function makeGrassTex() {
  return canvasTex(256, (x, s) => {
    x.fillStyle = '#7ad54a'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 34; i++) {
      x.globalAlpha = R(0.10, 0.22);
      x.fillStyle = ['#68bd3a', '#93e75f', '#76cc42', '#8fe063'][(Math.random() * 4) | 0];
      x.beginPath(); x.ellipse(R(0, s), R(0, s), R(12, 42), R(10, 30), R(0, 3), 0, 7); x.fill();
    }
    x.globalAlpha = 1;
    speckle(x, s, 2200, ['#5cab35', '#a4ec7c', '#66c23f', '#b8f493'], 0.15, 0.4, 0.6, 1.8);
  }, 9, 9);
}

export function makeSandTex() {
  return canvasTex(256, (x, s) => {
    x.fillStyle = '#e9c37c'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 26; i++) {
      x.globalAlpha = R(0.08, 0.18);
      x.fillStyle = ['#d9ad6b', '#f4dca4', '#dfb76f'][(Math.random() * 3) | 0];
      x.beginPath(); x.ellipse(R(0, s), R(0, s), R(10, 34), R(8, 22), R(0, 3), 0, 7); x.fill();
    }
    x.globalAlpha = 1;
    speckle(x, s, 1500, ['#c99e63', '#f7e3ae', '#d4a86a'], 0.2, 0.45, 0.6, 1.7);
  }, 18, 2);
}

export function makeWaterTex() {
  return canvasTex(256, (x, s) => {
    x.fillStyle = '#1fc8ee'; x.fillRect(0, 0, s, s);
    for (let i = 0; i < 30; i++) {
      x.globalAlpha = R(0.10, 0.24);
      x.fillStyle = ['#8ef1ff', '#0e98cc', '#5fe6ff'][(Math.random() * 3) | 0];
      x.beginPath(); x.ellipse(R(0, s), R(0, s), R(14, 46), R(6, 16), R(-0.5, 0.5), 0, 7); x.fill();
    }
    x.globalAlpha = 1;
    speckle(x, s, 380, ['#d8faff', '#a5f0ff'], 0.12, 0.3, 0.6, 1.4);
  }, 9, 9);
}

export function noiseBump(size, rx, ry, contrast = 26) {
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

export function makeBlobTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function makeFoamTex() {
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
}

/* Glassy toy-marble faces: hand-painted swirl + icon per color.
   Red = heart, Blue = water spiral, Green = leaf, Yellow = star. */
export function paintBallFace(x, s, kind) {
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
  if (kind === 0) {
    x.save(); x.translate(s * 0.5, s * 0.33); x.scale(1.5, 1.5);
    x.beginPath(); x.moveTo(0, 12);
    x.bezierCurveTo(-24, -6, -13, -26, 0, -13);
    x.bezierCurveTo(13, -26, 24, -6, 0, 12); x.fill(); x.restore();
  } else if (kind === 1) {
    x.lineWidth = 10; x.beginPath();
    for (let a = 0; a < 19; a++) {
      const r = 3 + a * 1.9, px = s * 0.5 + Math.cos(a * 0.55) * r, py = s * 0.33 + Math.sin(a * 0.55) * r;
      a ? x.lineTo(px, py) : x.moveTo(px, py);
    }
    x.stroke();
  } else if (kind === 2) {
    x.save(); x.translate(s * 0.5, s * 0.33); x.rotate(0.5);
    x.beginPath(); x.moveTo(0, -26);
    x.quadraticCurveTo(24, -6, 0, 26); x.quadraticCurveTo(-24, -6, 0, -26); x.fill();
    x.restore();
    x.strokeStyle = '#1a7a37'; x.lineWidth = 5; x.globalAlpha = 0.8;
    x.beginPath(); x.moveTo(s * 0.47, s * 0.24); x.lineTo(s * 0.53, s * 0.42); x.stroke();
    x.globalAlpha = 1;
  } else {
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

export function makeBallFaceTex() {
  return [0, 1, 2, 3].map(k => canvasTex(256, (x, s) => paintBallFace(x, s, k)));
}

export function marbleMat(color, ballFaceTex, palette) {
  const idx = Math.max(0, palette.indexOf(color));
  return new THREE.MeshPhysicalMaterial({
    flatShading: false,
    color: 0xffffff, map: ballFaceTex[idx],
    roughness: 0.05, metalness: 0.0,
    clearcoat: 1.0, clearcoatRoughness: 0.03,
    transmission: 0.55, thickness: 0.8, ior: 1.45,
    specularIntensity: 1.0, emissive: color, emissiveIntensity: 0.35,
  });
}

/* Soft AO decal: returns the mesh (caller adds to scene). Shared
   blobTex keeps every grounding disc cheap. */
export function makeGroundBlob(scene, blobTex, x, z, r, opacity = 0.26, squashZ = 1) {
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

export function letterSprite(letter, bg) {
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

/* Shared marble kit: one geometry + one material per color, reused by
   every level (path balls, projectiles, orbs). Built once per scene. */
export function createMarbleKit(palette, ballFaceTex) {
  const ballGeo = new THREE.SphereGeometry(0.72, 32, 24);
  const ballMats = palette.map(c => marbleMat(c, ballFaceTex, palette));
  const hiGeo = new THREE.SphereGeometry(0.16, 12, 10);
  const hiMat = new THREE.MeshPhysicalMaterial({ flatShading: false, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.85, transparent: true, opacity: 0.85 });
  const ringGeo = new THREE.TorusGeometry(0.8, 0.11, 8, 28);
  const ringMat = new THREE.MeshPhysicalMaterial({ flatShading: false, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.1, roughness: 0.2, color: 0xffc700, emissive: 0xffb700, emissiveIntensity: 0.9 });
  const wingGeo = new THREE.SphereGeometry(0.2, 12, 10);
  const trailGeo = new THREE.SphereGeometry(0.2, 14, 10);
  return { ballGeo, ballMats, hiGeo, hiMat, ringGeo, ringMat, wingGeo, trailGeo };
}

export function makeBallMesh(kit, powerDefs, color, power) {
  const mesh = new THREE.Group();
  const core = new THREE.Mesh(kit.ballGeo, kit.ballMats[color]);
  core.castShadow = true;
  const hi = new THREE.Mesh(kit.hiGeo, kit.hiMat);
  hi.position.set(-0.23, 0.26, 0.46);
  mesh.add(core, hi);
  if (power) {
    const r = new THREE.Mesh(kit.ringGeo, kit.ringMat);
    r.rotation.x = Math.PI / 2.3;
    mesh.add(r);
    [-1, 1].forEach(s => {
      const wing = new THREE.Mesh(kit.wingGeo, kit.ringMat);
      wing.position.set(s * 0.8, 0.12, 0);
      wing.scale.set(1.3, 0.45, 0.6);
      wing.rotation.z = s * 0.45;
      mesh.add(wing);
    });
    const def = powerDefs[power];
    if (def) mesh.add(letterSprite(def.letter, def.bg));
  }
  return mesh;
}

export function makeOrb(kit, colorIdx) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.52, 28, 20), kit.ballMats[colorIdx]);
  m.castShadow = true;
  return m;
}
