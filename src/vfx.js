import * as THREE from 'three';

/* ============================================================
   VFX — cinematic pop effects for the diorama:
     StarBurst : ONE THREE.InstancedMesh of extruded stars. Each burst
                 grabs free instances; the RAF loop updates every dummy
                 matrix + per-instance color (opacity fades to black,
                 additive blending reads as fading glow) with simple
                 physics (radial velocity + gravity + spin).
     ComicText : emissive pop labels ("BOOM!", "COMBO ×3", "+120")
                 drawn to a canvas sprite with emissiveIntensity ≥ 2.5
                 so UnrealBloom catches them; floats up and fades.
   ============================================================ */

/* 5-point star, gently extruded so it catches light while tumbling. */
function starGeometry() {
  const shape = new THREE.Shape();
  const R = 1, r = 0.45, N = 5;
  for (let i = 0; i < N * 2; i++) {
    const rad = i % 2 === 0 ? R : r;
    const a = (i / (N * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: 0.28, bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 1,
  });
  g.center();
  return g;
}

const _d = new THREE.Object3D();
const _c = new THREE.Color();

export class StarBurst {
  constructor(scene, count = 192) {
    this.count = count;
    const geo = starGeometry();
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 1,
      blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    // per-instance particle state
    this.p = Array.from({ length: count }, () => ({
      alive: false, life: 0, maxLife: 1,
      pos: new THREE.Vector3(), vel: new THREE.Vector3(),
      rot: new THREE.Euler(), spin: new THREE.Vector3(),
      scale: 1, tint: new THREE.Color(1, 1, 1),
    }));
    // hide all instances initially
    for (let i = 0; i < count; i++) {
      _d.position.set(0, -9999, 0); _d.scale.setScalar(0.0001);
      _d.updateMatrix(); this.mesh.setMatrixAt(i, _d.matrix);
      this.mesh.setColorAt(i, _c.setRGB(0, 0, 0));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
    this._cursor = 0;
  }
  /* Launch a radial star burst. tint: THREE.Color-ready value. */
  burst(origin, tint = 0xffc700, n = 14, speed = 9) {
    _c.set(tint);
    // HDR boost so stars cross the bloom threshold (emissive ≥ 2.5)
    const cr = _c.r * 3.2, cg = _c.g * 3.2, cb = _c.b * 3.2;
    for (let k = 0; k < n; k++) {
      const i = this._cursor; this._cursor = (this._cursor + 1) % this.count;
      const s = this.p[i];
      s.alive = true;
      s.life = s.maxLife = 0.55 + Math.random() * 0.45;
      s.pos.copy(origin);
      const a = Math.random() * Math.PI * 2;
      const up = Math.random() * 0.9 + 0.25;
      const sp = speed * (0.55 + Math.random() * 0.75);
      s.vel.set(Math.cos(a) * sp, up * sp, Math.sin(a) * sp);
      s.rot.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      s.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      s.scale = 0.42 + Math.random() * 0.5;
      s.tint.setRGB(cr, cg, cb);
    }
  }
  update(dt) {
    if (dt <= 0) return;
    let any = false;
    for (let i = 0; i < this.count; i++) {
      const s = this.p[i];
      if (!s.alive) continue;
      any = true;
      s.life -= dt;
      if (s.life <= 0) {
        s.alive = false;
        _d.position.set(0, -9999, 0); _d.scale.setScalar(0.0001);
        _d.updateMatrix(); this.mesh.setMatrixAt(i, _d.matrix);
        this.mesh.setColorAt(i, _c.setRGB(0, 0, 0));
        continue;
      }
      // physics: gravity arc + drag
      s.vel.y -= 16 * dt;
      s.vel.multiplyScalar(1 - 1.6 * dt);
      s.pos.addScaledVector(s.vel, dt);
      s.rot.x += s.spin.x * dt; s.rot.y += s.spin.y * dt; s.rot.z += s.spin.z * dt;
      const t = s.life / s.maxLife;               // 1 → 0
      const pop = t > 0.85 ? (1 - t) / 0.15 : t < 0.3 ? t / 0.3 : 1; // punch in, shrink out
      _d.position.copy(s.pos);
      _d.rotation.copy(s.rot);
      _d.scale.setScalar(s.scale * (0.35 + 0.65 * pop));
      _d.updateMatrix();
      this.mesh.setMatrixAt(i, _d.matrix);
      const fade = t < 0.3 ? t / 0.3 : 1;         // fade glow at end of life
      this.mesh.setColorAt(i, _c.setRGB(s.tint.r * fade, s.tint.g * fade, s.tint.b * fade));
    }
    if (any) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

/* ---------------- glowing comic pop text ---------------- */
function textCanvas(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 192;
  const x = c.getContext('2d');
  x.font = '900 118px "Trebuchet MS", "Arial Black", sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineJoin = 'round';
  // heavy dark outline + warm inner stroke for the comic read
  x.strokeStyle = '#3a1d05'; x.lineWidth = 26;
  x.strokeText(text, 256, 100);
  x.strokeStyle = color; x.lineWidth = 13;
  x.strokeText(text, 256, 100);
  x.fillStyle = '#fffbe8';
  x.fillText(text, 256, 100);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export class ComicText {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this._cache = new Map();
  }
  _tex(text, color) {
    const k = text + '|' + color;
    if (!this._cache.has(k)) this._cache.set(k, textCanvas(text, color));
    return this._cache.get(k);
  }
  pop(text, worldPos, { color = '#ffc700', size = 4.6, life = 1.15, rise = 2.6 } = {}) {
    const mat = new THREE.SpriteMaterial({
      map: this._tex(text, color),
      transparent: true, depthTest: true, depthWrite: false,
      // HDR tint ≥ 2.5 → bloom threshold catches it
      color: new THREE.Color(2.6, 2.6, 2.6),
      toneMapped: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.copy(worldPos);
    sp.position.y += 1.2;
    sp.scale.set(size, size * 0.375, 1);
    sp.renderOrder = 30;
    this.scene.add(sp);
    this.items.push({ sp, t: 0, life, y0: sp.position.y, rise, size });
    return sp;
  }
  update(dt) {
    if (dt <= 0 || !this.items.length) return;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const k = it.t / it.life;
      if (k >= 1) {
        this.scene.remove(it.sp);
        it.sp.material.dispose();
        this.items.splice(i, 1);
        continue;
      }
      it.sp.position.y = it.y0 + it.rise * (1 - Math.pow(1 - k, 2));
      const punch = k < 0.18 ? 0.5 + (k / 0.18) * 0.62 : 1.12 - 0.12 * ((k - 0.18) / 0.82);
      it.sp.scale.set(it.size * punch, it.size * 0.375 * punch, 1);
      const fade = k > 0.62 ? 1 - (k - 0.62) / 0.38 : 1;
      it.sp.material.opacity = fade;
      const glow = 2.6 * (0.6 + 0.4 * fade);
      it.sp.material.color.setRGB(glow, glow, glow);
    }
  }
}
