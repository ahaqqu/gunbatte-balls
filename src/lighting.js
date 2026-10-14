import * as THREE from 'three';

/* ============================================================
   LIGHTING — high-resolution key + soft natural fill, isolated so
   game.js only wires the result. Matches the macro-diorama spec:
     Key  : warm DirectionalLight #fff4e0 @ 1.5, steep overhead,
            2048² PCF-soft shadows tightly bound to the island,
            bias tweaked to kill acne on clay/felt surfaces.
     Fill : HemisphereLight sky #a1d8ff / ground #5e9e3e @ 0.5 so
            shadow sides pick up sky bounce instead of going black.
   Returns { key, fill } for tests / runtime tweaks.
   ============================================================ */

/* Half-extent of the island (radius 26 + rim) — shadow camera is bound
   strictly to the diorama so the full 4096 map spends texels only on
   the playfield, not empty ocean. */
const SHADOW_EXTENT = 27;

export function setupLighting(scene, { shadowSize = 2048 } = {}) {
  const key = new THREE.DirectionalLight(0xfff4e0, 1.5);
  key.position.set(12, 34, 14); // steep overhead angle, slightly raking
  key.castShadow = true;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = key.shadow.camera;
  sc.left = -SHADOW_EXTENT; sc.right = SHADOW_EXTENT;
  sc.top = SHADOW_EXTENT; sc.bottom = -SHADOW_EXTENT;
  sc.near = 4; sc.far = 90;
  sc.updateProjectionMatrix();
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 3;
  scene.add(key);
  scene.add(key.target);
  key.target.position.set(0, 0, 0);

  // Slightly dimmer sky bounce so the warm key can actually shape the clay
  const fill = new THREE.HemisphereLight(0xa1d8ff, 0x5e9e3e, 0.5);
  scene.add(fill);

  return { key, fill };
}
