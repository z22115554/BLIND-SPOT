// =============================================================================
// Corridor 的自訂著色器：灰燼粒子、手電筒光柱中的浮塵、穿窗光束、道路反光標記。
// 全部輸出線性色彩；包含 tonemapping/colorspace chunk（在 composer 的 render target 上是 no-op，
// 直接畫到畫面上時才作用），以及 three 的 fog chunk。
// =============================================================================
import * as THREE from 'three';

const PARTICLE_VERT = /* glsl */`
uniform float uTime;
uniform float uScale;
uniform float uSize;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform float uFollow;          // 1 = 粒子盒跟著相機（浮塵）
uniform vec3 uCamPos;
uniform vec3 uCamDir;
uniform float uFlash;           // 手電筒強度 0..1
uniform float uFlashCos;
uniform vec3 uHL0; uniform vec3 uHL1;
uniform vec3 uHLDir0; uniform vec3 uHLDir1;
uniform float uHLI0; uniform float uHLI1;
uniform vec3 uSodiumPos; uniform float uSodium;
uniform vec3 uAmbient;
uniform float uFall;
attribute vec4 aSeed;           // x 相位, y 落速, z 尺寸, w 自轉
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
#include <fog_pars_vertex>
void main() {
  vec3 p = position;
  float t = uTime;
  if (uFollow > 0.5) {
    vec3 rel = p + vec3(sin(t * 0.07 + aSeed.x * 6.28) * 0.3, -t * aSeed.y * uFall, cos(t * 0.05 + aSeed.x * 3.1) * 0.3);
    vec3 origin = uCamPos - uBoxSize * 0.5;
    p = origin + mod(rel - origin, uBoxSize);
  } else {
    p.y = uBoxMin.y + mod(p.y - uBoxMin.y - t * aSeed.y * uFall, uBoxSize.y);
    p.x += sin(t * 0.37 + aSeed.x * 6.283) * 0.22 + sin(t * 0.13 + aSeed.x * 17.0) * 0.35;
    p.z += cos(t * 0.29 + aSeed.x * 9.1) * 0.16;
  }
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(uSize * aSeed.z * uScale / max(0.05, -mvPosition.z), 0.0, 64.0);
  vec3 wp = (modelMatrix * vec4(p, 1.0)).xyz;
  vec3 col = uAmbient;
  // 手電筒錐
  vec3 dc = wp - uCamPos; float dl = max(0.05, length(dc));
  float cf = smoothstep(uFlashCos, uFlashCos + 0.06, dot(dc / dl, uCamDir));
  col += vec3(1.0, 0.96, 0.88) * uFlash * cf * 3.2 / (0.6 + dl * dl);
  // 車燈
  vec3 d0 = wp - uHL0; float l0 = max(0.1, length(d0));
  col += vec3(1.0, 0.94, 0.82) * uHLI0 * smoothstep(0.55, 0.9, dot(d0 / l0, uHLDir0)) / (1.0 + l0 * l0);
  vec3 d1 = wp - uHL1; float l1 = max(0.1, length(d1));
  col += vec3(1.0, 0.94, 0.82) * uHLI1 * smoothstep(0.55, 0.9, dot(d1 / l1, uHLDir1)) / (1.0 + l1 * l1);
  // 遠處的鈉燈（橘）
  vec3 ds = wp - uSodiumPos;
  col += vec3(1.0, 0.55, 0.18) * uSodium / (1.0 + dot(ds, ds) * 0.08);
  vColor = col;
  float fy = (p.y - uBoxMin.y) / uBoxSize.y;
  vAlpha = uFollow > 0.5 ? smoothstep(0.0, 0.35, dl) * smoothstep(uBoxSize.x * 0.5, uBoxSize.x * 0.3, dl) : smoothstep(0.0, 0.06, fy) * smoothstep(1.0, 0.92, fy);
  vSpin = aSeed.w * t + aSeed.x * 6.283;
  #include <fog_vertex>
}`;

const PARTICLE_FRAG = /* glsl */`
uniform sampler2D map;
uniform float uOpacity;
uniform float uUseMap;
varying vec3 vColor;
varying float vAlpha;
varying float vSpin;
#include <fog_pars_fragment>
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float c = cos(vSpin), s = sin(vSpin);
  uv = mat2(c, -s, s, c) * uv;
  float a;
  vec3 tint = vec3(1.0);
  if (uUseMap > 0.5) {
    vec2 tuv = uv * 1.25 + 0.5;
    if (tuv.x < 0.0 || tuv.y < 0.0 || tuv.x > 1.0 || tuv.y > 1.0) discard;
    vec4 tx = texture2D(map, tuv);
    a = tx.a; tint = tx.rgb;
  } else {
    a = smoothstep(0.5, 0.1, length(uv));
  }
  a *= vAlpha * uOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor * tint, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** 粒子材質（灰燼 / 浮塵共用）。 */
export function particleMaterial({ map = null, follow = false, size = 0.03, ambient = 0x000000, fall = 1, opacity = 1, blending = THREE.NormalBlending } = {}) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uTime: { value: 0 }, uScale: { value: 400 }, uSize: { value: size },
    uBoxMin: { value: new THREE.Vector3() }, uBoxSize: { value: new THREE.Vector3(1, 1, 1) },
    uFollow: { value: follow ? 1 : 0 }, uCamPos: { value: new THREE.Vector3() }, uCamDir: { value: new THREE.Vector3(0, 0, -1) },
    uFlash: { value: 0 }, uFlashCos: { value: Math.cos(0.42) },
    uHL0: { value: new THREE.Vector3() }, uHL1: { value: new THREE.Vector3() },
    uHLDir0: { value: new THREE.Vector3(1, 0, 0) }, uHLDir1: { value: new THREE.Vector3(1, 0, 0) },
    uHLI0: { value: 0 }, uHLI1: { value: 0 },
    uSodiumPos: { value: new THREE.Vector3() }, uSodium: { value: 0 },
    uAmbient: { value: new THREE.Color(ambient) }, uFall: { value: fall },
    uOpacity: { value: opacity }, uUseMap: { value: map ? 1 : 0 }, map: { value: map },
  }]);
  uniforms.map.value = map;
  const m = new THREE.ShaderMaterial({
    uniforms, vertexShader: PARTICLE_VERT, fragmentShader: PARTICLE_FRAG,
    transparent: true, depthWrite: false, fog: true, blending,
  });
  m.name = follow ? 'dustMotes' : 'ash';
  return m;
}

const BEAM_VERT = /* glsl */`
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying float vDepth;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vDepth = -mvPosition.z;
  vN = normalize(normalMatrix * normal);
  vView = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const BEAM_FRAG = /* glsl */`
uniform float uI;
uniform vec3 uColor;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying float vDepth;
#include <fog_pars_fragment>
void main() {
  float near = smoothstep(0.35, 1.4, vDepth);         // 貼近相機的那一片淡出，避免整片平平的亮霧
  float across = exp(-pow((vUv.x - 0.5) * 3.4, 2.0));
  float along = smoothstep(0.0, 0.06, vUv.y) * pow(1.0 - vUv.y, 1.4);
  float facing = pow(abs(dot(normalize(vN), normalize(vView))), 1.2);
  float a = uI * across * along * facing * near;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float ff = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float ff = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    a *= 1.0 - ff * 0.85;
  #endif
  gl_FragColor = vec4(uColor * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** 穿過玻璃的光束（加算、柔邊、面向相機時才明顯）。 */
export function beamMaterial(color = 0xfff0dc) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uI: { value: 0 }, uColor: { value: new THREE.Color(color) } }]),
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: true,
  });
}

const REFL_VERT = /* glsl */`
uniform vec3 uHL0; uniform vec3 uHL1;
uniform float uHLI0; uniform float uHLI1;
varying float vGlow;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 d0 = uHL0 - wp.xyz; vec3 d1 = uHL1 - wp.xyz;
  vGlow = uHLI0 / (1.0 + dot(d0, d0)) + uHLI1 / (1.0 + dot(d1, d1));
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const REFL_FRAG = /* glsl */`
uniform vec3 uColor;
uniform vec3 uBase;
varying float vGlow;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(uBase + uColor * vGlow, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** 道路反光標記（貓眼／牆面反光片）：依車燈距離自發光。 */
export function reflectorMaterial(color = 0xffd27a) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uHL0: { value: new THREE.Vector3(0, -100, 0) }, uHL1: { value: new THREE.Vector3(0, -100, 0) },
      uHLI0: { value: 0 }, uHLI1: { value: 0 },
      uColor: { value: new THREE.Color(color) }, uBase: { value: new THREE.Color(0x030302) },
    }]),
    vertexShader: REFL_VERT, fragmentShader: REFL_FRAG, fog: true,
  });
}
