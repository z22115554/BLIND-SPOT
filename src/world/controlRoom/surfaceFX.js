// =============================================================================
// 主控室表面效果（onBeforeCompile 注入，所有主控室材質共用同一組 uniform）
//   uDirt  0..1  腐化：表面整體變髒、偏黃褐（斑駁，依噪音分佈）
//   uBurnt 0..1  焦黑：由防爆門向外、由天花板往下、依噪音逐片「剝落」成 charred 貼圖（三平面投影），
//                燃燒前緣帶餘燼色；焦黑面上的龜裂透出暗橘色餘燼光（緩慢起伏 ≤ 12%、週期 ≥ 1.6 秒）；
//                粗糙度→1、金屬度→0、原本的自發光熄滅。
//   煙層（uLayerY / uLayerK / uLayerCol）：終幕濃煙先貼著天花板分層、再往下沉（smoke layer banking down）。
//                以「視線穿過煙層的長度」計算消光（1 - e^-kL），所以天花板與高處先被吞沒，低處的焦黑仍看得見。
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
    /** 焦黑的起點（防爆門）：越遠越晚燒到 */
    uBurnOrigin: { value: new THREE.Vector3(-4, 1.6, -0.2) },
    /** 龜裂餘燼光強度（線性 HDR）與起伏量（光敏感模式 0） */
    uEmberGlow: { value: 0 },
    uEmberWobble: { value: 0.12 },
    uSfxTime: { value: 0 },
    /** 煙層：下緣高度（公尺）、每公尺消光係數（0 = 無煙層）、被室內光照亮的煙色（線性） */
    uLayerY: { value: 3.2 },
    uLayerK: { value: 0 },
    uLayerCol: { value: new THREE.Color(0, 0, 0) },
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
uniform vec3 uBurnOrigin;
uniform float uEmberGlow;
uniform float uEmberWobble;
uniform float uSfxTime;
uniform float uLayerY;
uniform float uLayerK;
uniform vec3 uLayerCol;
varying vec3 vSfxPos;
varying vec3 vSfxNrm;
`;
const FRAG_COLOR = /* glsl */`
float sfxBurn = 0.0;
float sfxEdge = 0.0;
float sfxCrack = 0.0;
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
    // 由防爆門往房內蔓延（距離項）＋由上往下（高度項）＋斑駁（噪音項）
    float dN = clamp( distance( vSfxPos, uBurnOrigin ) / 9.0, 0.0, 1.0 );
    float thr = 0.30 * nLo + 0.14 * nHi + 0.16 * ( 1.0 - h ) + 0.45 * dN;
    sfxBurn = smoothstep( thr - 0.03, thr + 0.03, uBurnt * 1.12 );
    // 燃燒前緣：比剝落過渡帶更窄的一條暗橘線
    float e0 = smoothstep( thr - 0.008, thr + 0.008, uBurnt * 1.12 );
    sfxEdge = clamp( e0 * ( 1.0 - e0 ) * 4.0, 0.0, 1.0 ) * ( 0.6 + 0.8 * nHi );
    // 透出餘燼光的地方：焦黑貼圖中的褐色龜裂＋低頻噪音等高線形成的較寬裂脈（只在「還熱」的區域）
    vec3 vA = vec3( texture2D( uBurnNoise, vSfxPos.zy * 0.45 + 0.13 ).r, texture2D( uBurnNoise, vSfxPos.xz * 0.45 + 0.37 ).r, texture2D( uBurnNoise, vSfxPos.xy * 0.45 + 0.71 ).r );
    float nV = dot( vA, bn );
    float vein = 1.0 - smoothstep( 0.002, 0.011, abs( nV - 0.5 ) );
    // 裂脈斷成一段一段（高頻噪音遮罩），只有「還熱」的區域會亮
    float seg = smoothstep( 0.42, 0.62, texture2D( uBurnNoise, ( vSfxPos.xz + vSfxPos.zy ) * 1.7 + 0.5 ).r );
    float hot = smoothstep( 0.6, 0.85, nLo ) * smoothstep( 0.35, 0.6, nHi ) * seg;
    float crk = smoothstep( 0.025, 0.07, charC.r - charC.b * 1.6 );
    sfxCrack = clamp( max( crk * 0.6, vein * hot ), 0.0, 1.0 ) * sfxBurn;
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
if ( uEmberGlow > 0.0001 && sfxCrack > 0.001 ) {
  // 緩慢、低振幅的起伏（週期 1.9–3.4 秒，依位置錯開；光敏感模式下 uEmberWobble = 0）
  float ph = texture2D( uBurnNoise, vSfxPos.xz * 0.37 + vSfxPos.yy * 0.21 ).r * 6.2831853;
  float wob = 1.0 + uEmberWobble * ( 0.6 * sin( uSfxTime * 3.3 + ph ) + 0.4 * sin( uSfxTime * 1.85 + ph * 1.7 ) );
  totalEmissiveRadiance += vec3( 1.0, 0.26, 0.045 ) * ( uEmberGlow * sfxCrack * wob );
}
`;
const FRAG_LAYER = /* glsl */`
if ( uLayerK > 0.0001 ) {
  // 煙層：計算視線（相機 → 表面）在 y ∈ [煙層下緣, 天花板] 之間的長度；下緣隨時間緩慢起伏
  vec3 sfxP = vSfxPos;
  float wav = ( texture2D( uBurnNoise, sfxP.xz * 0.21 + vec2( uSfxTime * 0.017, -uSfxTime * 0.011 ) ).r - 0.5 ) * 0.5;
  float lo = min( sfxP.y, cameraPosition.y ), hi = max( sfxP.y, cameraPosition.y );
  float span = hi - lo;
  float segL = length( sfxP - cameraPosition );
  float tau = 0.0;
  for ( int i = 0; i < 2; i++ ) {
    // 兩層：主煙層＋下緣 0.35 m 較稀的過渡帶
    float ly = uLayerY + wav - float( i ) * 0.35;
    float w = i == 0 ? 0.72 : 0.28;
    float inside = max( 0.0, min( hi, 3.05 ) - max( lo, ly ) );
    float frac = span > 0.02 ? inside / span : step( ly, 0.5 * ( lo + hi ) );
    tau += w * frac * segL;
  }
  float sfxA = 1.0 - exp( -uLayerK * tau );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, uLayerCol, sfxA );
}
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
    shader.uniforms.uBurnOrigin = U.uBurnOrigin;
    shader.uniforms.uEmberGlow = U.uEmberGlow;
    shader.uniforms.uEmberWobble = U.uEmberWobble;
    shader.uniforms.uSfxTime = U.uSfxTime;
    shader.uniforms.uLayerY = U.uLayerY;
    shader.uniforms.uLayerK = U.uLayerK;
    shader.uniforms.uLayerCol = U.uLayerCol;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <fog_vertex>', `#include <fog_vertex>\n${VERT_BODY}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG_COLOR}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_ROUGH}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>\n${FRAG_METAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`)
      .replace('#include <fog_fragment>', `${FRAG_LAYER}\n#include <fog_fragment>`);
  };
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|crSfx2`;
  mat.needsUpdate = true;
  return mat;
}
