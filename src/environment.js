import * as THREE from 'three';

/* ============================================================
   ENVIRONMENT — level-driven scene helpers (no art, no rules).
   Art factories live in src/assets.js; rules in src/mechanics.js +
   src/powers.js; data in src/levels.js. game.js (composition root)
   calls these helpers so every island shares one code path.

   Staged migration: curve / perches / scatter-guard are live here.
   Prop meshes (island/water/path/portal/skull/house/…) are still
   built inline in game.js but already read exclusively from the
   active LevelDef — moving them onto asset-factory calls here is
   the documented next step (no behavior change when it lands).
   ============================================================ */

export function buildCurve(level) {
  const curve = new THREE.CatmullRomCurve3(
    level.pathPts2D.map(([x, z]) => new THREE.Vector3(x, 0.6, z)),
    false, 'catmullrom', level.curveTension ?? 0.35);
  return { curve, curveLen: curve.getLength() };
}

export function perchVectors(level) {
  return level.perches.map(([x, z]) => new THREE.Vector3(x, 0.6, z));
}

/* Level-aware scatter guard: path + star + perches + named clearings.
   Same signature as the historic nearPath(x, z, d) helper. */
export function createNearPathChecker(level, curve, homePerch) {
  const c = level.clearances;
  const perchPts = level.perches;
  return function nearPath(x, z, d = c.pathD) {
    for (let i = 0; i <= 40; i++) {
      const p = curve.getPointAt(i / 40);
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < d * d) return true;
    }
    if ((x - homePerch.x) ** 2 + (z - homePerch.z) ** 2 < c.starR2) return true;
    for (const [px, pz] of perchPts) if ((x - px) ** 2 + (z - pz) ** 2 < c.perchR2) return true;
    if ((x - c.skull.x) ** 2 + (z - c.skull.z) ** 2 < c.skull.r2) return true;
    if ((x - c.portal.x) ** 2 + (z - c.portal.z) ** 2 < c.portal.r2) return true;
    if ((x - c.shrine.x) ** 2 + (z - c.shrine.z) ** 2 < c.shrine.r2) return true;
    if ((x - c.house.x) ** 2 + (z - c.house.z) ** 2 < c.house.r2) return true;
    return false;
  };
}
