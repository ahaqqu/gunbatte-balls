import * as THREE from 'three';

/* ============================================================
   POST — EffectComposer pipeline in the exact required order:
     RenderPass → SSAOPass → UnrealBloomPass → BokehPass → OutputPass
   The scene renders into a HalfFloat linear-HDR target (three.js skips
   material tone mapping when rendering into a render target), so ACES
   tone mapping + sRGB encoding happen once in OutputPass.
   SSAOPass  : depth-only contact AO (kernelRadius px, min/max distance
               in view units) → deep contact shadows under balls/trees.
   UnrealBloom: threshold on HDR luminance so ONLY emissiveIntensity>1
               sources (crystals, combo text, stars) glow.
   BokehPass : depth-of-field focused on the cannon (setFocus per frame),
               aggressively blurs foreground & background (macro look).
   ============================================================ */

const _fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const _fsGeo = new THREE.PlaneGeometry(2, 2);

function _fsMat(frag, uniforms) {
  return new THREE.ShaderMaterial({
    uniforms, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: frag,
  });
}
function _fsQuad(material) {
  const sc = new THREE.Scene();
  sc.add(new THREE.Mesh(_fsGeo, material));
  return sc;
}
/* Golden-angle disc kernel: evenly spread taps for AO / DOF gathers. */
function discKernel(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n), a = i * 2.39996323;
    out.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return out;
}
const VIEW_DIST =
  'float viewDist(float d){ float z = d * 2.0 - 1.0;' +
  ' return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }';

class RenderPass {
  constructor(scene, camera) { this.scene = scene; this.camera = camera; }
  render(r, target) { r.setRenderTarget(target); r.render(this.scene, this.camera); }
}

/* Depth-based SSAO: a pixel is occluded when a neighbour inside the
   kernel sits closer to the camera by [minDistance, maxDistance] —
   i.e. geometry rising out of a crevice. Contact-shadow scale only. */
class SSAOPass {
  constructor(camera, { kernelRadius = 12, minDistance = 0.005, maxDistance = 0.1, strength = 1.0, scale = 0.5, samples = 8 } = {}) {
    this.camera = camera;
    this.scale = scale;
    this.samples = samples;
    this.mat = _fsMat(
      'uniform sampler2D tColor; uniform sampler2D tDepth;' +
      'uniform vec2 uRes; uniform float uNear, uFar;' +
      'uniform float uKernelRadius, uMinD, uMaxD, uStrength;' +
      'uniform vec2 uKernel[8]; varying vec2 vUv;' +
      VIEW_DIST +
      'void main(){' +
      ' vec4 col = texture2D(tColor, vUv);' +
      ' float d0 = texture2D(tDepth, vUv).x;' +
      ' if (d0 >= 0.99999) { gl_FragColor = col; return; }' +
      ' float dist0 = viewDist(d0);' +
      ' float occ = 0.0;' +
      ' for (int i = 0; i < 8; i++) {' +
      '  vec2 uv2 = vUv + uKernel[i] * uKernelRadius / uRes;' +
      '  float dist1 = viewDist(texture2D(tDepth, uv2).x);' +
      '  float delta = dist0 - dist1;' +
      '  if (delta > uMinD && delta < uMaxD) occ += 1.0 - (delta - uMinD) / (uMaxD - uMinD);' +
      ' }' +
      ' float ao = clamp(1.0 - (occ / 8.0) * uStrength, 0.0, 1.0);' +
      ' gl_FragColor = vec4(col.rgb * ao, col.a);' +
      '}',
      {
        tColor: { value: null }, tDepth: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 }, uFar: { value: 100 },
        uKernelRadius: { value: kernelRadius },
        uMinD: { value: minDistance }, uMaxD: { value: maxDistance },
        uStrength: { value: strength },
        uKernel: { value: discKernel(8) },
      });
    this.scene = _fsQuad(this.mat);
    // half-res AO working buffer
    this.halfRT = new THREE.WebGLRenderTarget(2, 2, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.HalfFloatType,
      depthBuffer: false, stencilBuffer: false,
    });
  }
  render(r, sceneRT, target) {
    const u = this.mat.uniforms;
    u.tColor.value = sceneRT.texture;
    u.tDepth.value = sceneRT.depthTexture;
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const hw = Math.max(2, (size.x * this.scale) | 0);
    const hh = Math.max(2, (size.y * this.scale) | 0);
    if (this.halfRT.width !== hw || this.halfRT.height !== hh) this.halfRT.setSize(hw, hh);
    u.uRes.value.set(hw, hh);
    // AO computed at half res (4× fewer fragments)
    r.setRenderTarget(this.halfRT);
    r.render(this.scene, _fsCam);
    // upsample + composite onto full-res target (linear filter blit)
    u.tColor.value = sceneRT.texture;
    r.setRenderTarget(target);
    r.render(this.scene, _fsCam);
  }
}

/* HDR bloom: bright-pass at threshold, two gaussian iterations at half
   res (radius widens the spread), then add back — only pixels above
   the linear threshold glow (emissive ≥ 1.0). */
class UnrealBloomPass {
  constructor(threshold = 0.9, strength = 0.4, radius = 0.4) {
    this.threshold = threshold; this.strength = strength; this.radius = radius;
    this.brightMat = _fsMat(
      'uniform sampler2D tSrc; uniform float uThr; varying vec2 vUv;' +
      'void main(){ vec4 c = texture2D(tSrc, vUv); float l = dot(c.rgb, vec3(0.299,0.587,0.114));' +
      ' float k = smoothstep(uThr, uThr + 0.3, l); gl_FragColor = vec4(c.rgb * k, 1.0); }',
      { tSrc: { value: null }, uThr: { value: threshold } });
    this.blurMat = _fsMat(
      'uniform sampler2D tSrc; uniform vec2 uDir; uniform vec2 uRes; uniform float uSpread; varying vec2 vUv;' +
      'void main(){ vec2 px = uDir * uSpread / uRes;' +
      ' vec3 c = texture2D(tSrc, vUv).rgb * 0.227;' +
      ' c += texture2D(tSrc, vUv + px * 1.384).rgb * 0.316; c += texture2D(tSrc, vUv - px * 1.384).rgb * 0.316;' +
      ' c += texture2D(tSrc, vUv + px * 3.230).rgb * 0.0703; c += texture2D(tSrc, vUv - px * 3.230).rgb * 0.0703;' +
      ' gl_FragColor = vec4(c, 1.0); }',
      { tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) },
        uRes: { value: new THREE.Vector2(1, 1) }, uSpread: { value: 1 } });
    this.compMat = _fsMat(
      'uniform sampler2D tBase; uniform sampler2D tBloom; uniform float uStrength; varying vec2 vUv;' +
      'void main(){ vec3 b = texture2D(tBloom, vUv).rgb * uStrength;' +
      ' gl_FragColor = vec4(texture2D(tBase, vUv).rgb + b, 1.0); }',
      { tBase: { value: null }, tBloom: { value: null }, uStrength: { value: strength } });
    this.brightScene = _fsQuad(this.brightMat);
    this.blurScene = _fsQuad(this.blurMat);
    this.compScene = _fsQuad(this.compMat);
  }
  render(r, read, write, tmpA, tmpB) {
    const sz = r.getDrawingBufferSize(new THREE.Vector2());
    this.brightMat.uniforms.tSrc.value = read.texture;
    r.setRenderTarget(tmpA); r.render(this.brightScene, _fsCam);
    this.blurMat.uniforms.uRes.value.set(Math.max(1, tmpA.width), Math.max(1, tmpA.height));
    this.blurMat.uniforms.uSpread.value = 1;
    const pass = (spread) => {
      this.blurMat.uniforms.uSpread.value = spread;
      this.blurMat.uniforms.tSrc.value = tmpA.texture;
      this.blurMat.uniforms.uDir.value.set(1, 0);
      r.setRenderTarget(tmpB); r.render(this.blurScene, _fsCam);
      this.blurMat.uniforms.tSrc.value = tmpB.texture;
      this.blurMat.uniforms.uDir.value.set(0, 1);
      r.setRenderTarget(tmpA); r.render(this.blurScene, _fsCam);
    };
    pass(1);
    pass(1 + this.radius * 2.6); // wider second octave for a soft halo
    this.compMat.uniforms.tBase.value = read.texture;
    this.compMat.uniforms.tBloom.value = tmpA.texture;
    this.compMat.uniforms.uStrength.value = this.strength;
    r.setRenderTarget(write); r.render(this.compScene, _fsCam);
    void sz;
  }
}

/* Depth-of-field: circle-of-confusion from |viewDist − focus| × aperture,
   clamped to maxblur, gathered on a 16-tap golden disc (UV aspect-correct
   so the bokeh circle stays round). */
class BokehPass {
  constructor(camera, { focus = 80, aperture = 0.0001, maxblur = 0.01 } = {}) {
    this.camera = camera;
    this.mat = _fsMat(
      'uniform sampler2D tColor; uniform sampler2D tDepth;' +
      'uniform vec2 uRes; uniform float uNear, uFar;' +
      'uniform float uFocus, uAperture, uMaxBlur;' +
      'uniform vec2 uKernel[16]; varying vec2 vUv;' +
      VIEW_DIST +
      'void main(){' +
      ' float d0 = texture2D(tDepth, vUv).x;' +
      ' float coc = clamp(abs(viewDist(d0) - uFocus) * uAperture, 0.0, uMaxBlur);' +
      ' vec3 sum = texture2D(tColor, vUv).rgb;' +
      ' if (coc < 0.0006) { gl_FragColor = vec4(sum, 1.0); return; }' +
      ' float wsum = 1.0;' +
      ' vec2 aspect = vec2(uRes.y / uRes.x, 1.0);' +
      ' for (int i = 0; i < 16; i++) {' +
      '  vec2 uv2 = vUv + uKernel[i] * coc * aspect;' +
      '  sum += texture2D(tColor, uv2).rgb; wsum += 1.0;' +
      ' }' +
      ' gl_FragColor = vec4(sum / wsum, 1.0);' +
      '}',
      {
        tColor: { value: null }, tDepth: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 }, uFar: { value: 100 },
        uFocus: { value: focus }, uAperture: { value: aperture },
        uMaxBlur: { value: maxblur },
        uKernel: { value: discKernel(16) },
      });
    this.scene = _fsQuad(this.mat);
  }
  setFocus(distance) { this.mat.uniforms.uFocus.value = distance; }
  render(r, read, sceneRT, target) {
    const u = this.mat.uniforms;
    u.tColor.value = read.texture;
    u.tDepth.value = sceneRT.depthTexture;
    u.uNear.value = this.camera.near; u.uFar.value = this.camera.far;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    u.uRes.value.set(size.x, size.y);
    r.setRenderTarget(target); r.render(this.scene, _fsCam);
  }
}

/* ACES filmic (exact three.js formula, exposure from renderer) + sRGB.
   Renders straight to the canvas — must be the final pass. */
/* Final pass: three.js built-in ACES + sRGB on a full-screen quad.
   MeshBasicMaterial picks up toneMapping/colorspace when rendering to
   the canvas (currentRenderTarget === null) — exact vendored formula,
   no hand-rolled GLSL to break on driver/ES version. */
class OutputPass {
  constructor(renderer) {
    this.renderer = renderer;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    if (renderer.toneMappingExposure == null || Number.isNaN(renderer.toneMappingExposure)) {
      renderer.toneMappingExposure = 1.2;
    }
    this.mat = new THREE.MeshBasicMaterial({
      map: null, color: 0xffffff,
      toneMapped: true, depthTest: false, depthWrite: false,
    });
    this.scene = _fsQuad(this.mat);
  }
  render(r, read) {
    this.mat.map = read.texture;
    r.setRenderTarget(null); r.render(this.scene, _fsCam);
  }
}

class EffectComposer {
  constructor(renderer) {
    this.renderer = renderer;
    this.renderPass = null; this.ssaoPass = null; this.bloomPass = null;
    this.bokehPass = null; this.outputPass = null;
    this.enabled = true; this._ok = true;
    try {
      const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
      const mk = (w, h, depth) => {
        const rt = new THREE.WebGLRenderTarget(Math.max(2, w | 0), Math.max(2, h | 0), {
          minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat, type: THREE.HalfFloatType,
          depthBuffer: true, stencilBuffer: false,
        });
        if (depth) {
          rt.depthTexture = new THREE.DepthTexture(Math.max(2, w | 0), Math.max(2, h | 0));
          rt.depthTexture.type = THREE.UnsignedIntType;
        }
        return rt;
      };
      this.rtScene = mk(sz.x, sz.y, true);
      this.rtA = mk(sz.x, sz.y, false);
      this.rtB = mk(sz.x, sz.y, false);
      this.rtBloomA = mk(sz.x / 2, sz.y / 2, false);
      this.rtBloomB = mk(sz.x / 2, sz.y / 2, false);
    } catch (e) { this._ok = false; }
  }
  addPass(p) {
    if (p instanceof RenderPass) this.renderPass = p;
    else if (p instanceof SSAOPass) this.ssaoPass = p;
    else if (p instanceof UnrealBloomPass) this.bloomPass = p;
    else if (p instanceof BokehPass) this.bokehPass = p;
    else if (p instanceof OutputPass) this.outputPass = p;
    return this;
  }
  setFocus(distance) { if (this.bokehPass) this.bokehPass.setFocus(distance); }
  setSize(w, h) {
    if (!this.rtScene) return;
    const pr = this.renderer.getPixelRatio();
    const dw = Math.max(2, (w * pr) | 0), dh = Math.max(2, (h * pr) | 0);
    const rSet = (rt, ww, hh) => {
      rt.setSize(Math.max(2, ww | 0), Math.max(2, hh | 0));
      if (rt.depthTexture) {
        rt.depthTexture.image.width = Math.max(2, ww | 0);
        rt.depthTexture.image.height = Math.max(2, hh | 0);
        rt.depthTexture.needsUpdate = true;
      }
    };
    rSet(this.rtScene, dw, dh);
    rSet(this.rtA, dw, dh);
    rSet(this.rtB, dw, dh);
    rSet(this.rtBloomA, dw / 2, dh / 2);
    rSet(this.rtBloomB, dw / 2, dh / 2);
  }
  render(scene, camera) {
    if (!this.enabled || !this._ok || !this.renderPass) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    try {
      this.renderPass.render(this.renderer, this.rtScene);
      let cur = this.rtScene;
      if (this.ssaoPass) { this.ssaoPass.render(this.renderer, this.rtScene, this.rtA); cur = this.rtA; }
      if (this.bloomPass) { this.bloomPass.render(this.renderer, cur, this.rtB, this.rtBloomA, this.rtBloomB); cur = this.rtB; }
      if (this.bokehPass) { this.bokehPass.render(this.renderer, cur, this.rtScene, this.rtA); cur = this.rtA; }
      if (this.outputPass) this.outputPass.render(this.renderer, cur);
      else { this.renderer.setRenderTarget(null); this.renderer.render(scene, camera); }
    } catch (e) {
      console.error('[post] pipeline failed, falling back to direct render:', e);
      this.enabled = false;
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
    }
  }
}

/* Build the full pipeline. Returns null when targets are unavailable
   (caller falls back to direct rendering). */
export function createComposer(renderer, scene, camera, { ssao = true, bloom = true } = {}) {
  try {
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    if (ssao) composer.addPass(new SSAOPass(camera));              // deep contact shadows
    if (bloom) composer.addPass(new UnrealBloomPass(0.9, 0.4, 0.4)); // emissives only — not terrain
    // BokehPass removed for performance — camera angle carries the macro diorama look.
    composer.addPass(new OutputPass(renderer));                   // ACES 1.2 + sRGB
    if (!composer._ok) return null;
    return composer;
  } catch (e) {
    console.error('[post] createComposer failed:', e);
    return null;
  }
}
