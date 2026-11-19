// =============================================================================
// 主控室表面效果（onBeforeCompile 注入，所有主控室材質共用同一組 uniform）
//   uDirt  0..1  腐化：表面整體變髒、偏黃褐（斑駁，依噪音分佈）
//   uBurnt 0..1  焦黑：由上往下、依噪音逐片「剝落」成 charred 貼圖（三平面投影），
//                邊界帶一點極暗的餘燼色；粗糙度→1、金屬度→0、自發光熄滅。
// =============================================================================
import * as THREE from 'three';
import { makeCanvas, canvasTexture, fillNoise } from '../../gfx/canvasUtil.js';

export function createSurfaceUniforms(ctx) {
  // 低頻灰階噪音（資料貼圖，非 sRGB）
  const { canvas, g } = makeCanvas(128, 128);
  fillNoise(g, 128, 128, { seed: 917, scale: 4, octaves: 4, c0: [0, 0, 0], c1: [255, 255, 255], contrast: 1.6 });
  const noise = canvasTexture(canvas, { color: false });
  let charred = null;
  try { charred = ctx.textures?.get?.('charred') ?? null; } catch (e) { charred = null; }
  if (!charred) charred = noise;
  return {
    uBurnt: { value: 0 },
    uDirt: { value: 0 },
    uEmber: { value: 0 },
    uCharMap: { value: charred },
    uBurnNoise: { value: noise },
  };
}

const VERT_HEAD = /* glsl */`
varying vec3 vSfxPos;
varying vec3 vSfxNrm;
`;
const VERT_BODY = /* glsl */`
{
  vec4 sfxW = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    sfxW = instanceMatrix * sfxW;
  #endif
  sfxW = modelMatrix * sfxW;
  vSfxPos = sfxW.xyz;
  vSfxNrm = normalize( mat3( modelMatrix ) * objectNormal );
}
`;
const FRAG_HEAD = /* glsl */`
uniform float uBurnt;
uniform float uDirt;
uniform float uEmber;
uniform sampler2D uCharMap;
uniform sampler2D uBurnNoise;
varying vec3 vSfxPos;
varying vec3 vSfxNrm;
`;
const FRAG_COLOR = /* glsl */`
float sfxBurn = 0.0;
float sfxEdge = 0.0;
{
  float nLo = texture2D( uBurnNoise, vSfxPos.xz * 0.11 + vSfxPos.yy * 0.05 + vec2( 0.31, 0.17 ) ).r;
  float nHi = texture2D( uBurnNoise, vSfxPos.zy * 0.43 + vSfxPos.xx * 0.21 ).r;
  // 腐化：斑駁的黃褐髒污
  if ( uDirt > 0.001 ) {
    float d = clamp( uDirt * ( 0.55 + 0.9 * nLo ) - 0.08, 0.0, 1.0 );
    diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 0.70, 0.64, 0.55 ), d * 0.75 );
  }
  if ( uBurnt > 0.001 ) {
    vec3 bn = abs( normalize( vSfxNrm ) );
    bn = bn * bn * bn * bn; bn /= ( bn.x + bn.y + bn.z + 1e-5 );
    vec3 cA = texture2D( uCharMap, vSfxPos.zy * 0.62 ).rgb;
    vec3 cB = texture2D( uCharMap, vSfxPos.xz * 0.62 ).rgb;
    vec3 cC = texture2D( uCharMap, vSfxPos.xy * 0.62 ).rgb;
    vec3 charC = cA * bn.x + cB * bn.y + cC * bn.z;
    float h = clamp( vSfxPos.y / 3.0, 0.0, 1.0 );
    float thr = 0.55 * nLo + 0.25 * nHi + 0.32 * ( 1.0 - h );
    sfxBurn = smoothstep( thr - 0.035, thr + 0.035, uBurnt * 1.18 );
    sfxEdge = clamp( sfxBurn * ( 1.0 - sfxBurn ) * 4.0, 0.0, 1.0 );
    diffuseColor.rgb = mix( diffuseColor.rgb, max( charC * vec3( 1.6, 1.5, 1.4 ), vec3( 0.06, 0.054, 0.048 ) ), sfxBurn );
  }
}
`;
const FRAG_ROUGH = /* glsl */`
roughnessFactor = mix( roughnessFactor, 0.97, sfxBurn );
`;
const FRAG_METAL = /* glsl */`
metalnessFactor = mix( metalnessFactor, 0.0, sfxBurn );
`;
const FRAG_EMISSIVE = /* glsl */`
totalEmissiveRadiance = totalEmissiveRadiance * ( 1.0 - sfxBurn ) + vec3( 0.55, 0.13, 0.02 ) * sfxEdge * uEmber;
`;

/** 為 MeshStandardMaterial 注入腐化/焦黑效果。可安全重複呼叫。 */
export function patchSurface(mat, U) {
  if (!mat || mat.userData.sfxPatched) return mat;
  if (!(mat.isMeshStandardMaterial)) return mat;
  mat.userData.sfxPatched = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uBurnt = U.uBurnt;
    shader.uniforms.uDirt = U.uDirt;
    shader.uniforms.uEmber = U.uEmber;
    shader.uniforms.uCharMap = U.uCharMap;
    shader.uniforms.uBurnNoise = U.uBurnNoise;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAG_METAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|crSfx1`;
  mat.needsUpdate = true;
  return mat;
}
