// =============================================================================
// 粒子：濃煙（從防爆門湧入 → 沿天花板翻滾 → 由上而下填滿房間；單一 draw call）與咖啡蒸氣（Sprite）。
// 全部 NormalBlending、depthWrite false、不參與射線檢測。
// =============================================================================
import * as THREE from 'three';
import { rng, clamp, damp, smoothstep, lerp } from '../../core/util.js';

const _v = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _fwd = new THREE.Vector3();

// -----------------------------------------------------------------------------
// 濃煙：單一 draw call（InstancedBufferGeometry + 自訂 ShaderMaterial，頂點著色器內轉成面向相機的方片）。
// 行為（真實火場煙流）：熱煙從防爆門開口的上半部湧入 → 浮升到天花板 → 沿天花板向房內擴散（ceiling jet）
// → 隨著煙層變厚，新的煙團停留得越來越低（banking down）。整片煙層本身由 surfaceFX 的煙層消光負責；
// 粒子負責翻滾的體積感與流動。
// 外觀：煙色由 ControlRoom 依室內光計算（暖灰、沾到紅/橘色的終幕燈光），粒子以假法線「上亮下暗」＋
// 濃處自遮蔽呈現體積；靠近房間牆面/地板/天花板時淡出（解析式 soft particle，無硬邊）；靠近相機時淡出；
// 霧化量有上限（不會整個變成霧色而消失）。每幀依視深由遠到近排序（NormalBlending）。
// -----------------------------------------------------------------------------
const SMOKE_VERT = /* glsl */`
attribute vec3 iPos;
attribute vec4 iData;   // x 尺寸(m)、y 旋轉、z 不透明度、w 明暗
varying vec2 vUv;
varying vec2 vUv2;
varying vec2 vQ;
varying vec3 vWorld;
varying float vDepth;
varying float vAlpha;
varying float vShade;
void main() {
  vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
  vec3 up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
  vec2 q = position.xy;
  vec3 w = iPos + ( right * q.x + up * q.y ) * iData.x;
  vWorld = w;
  vec4 mv = viewMatrix * vec4( w, 1.0 );
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
  float c = cos( iData.y ), s = sin( iData.y );
  vUv = vec2( c * q.x - s * q.y, s * q.x + c * q.y ) + 0.5;
  float a2 = -1.63 * iData.y + 2.1;
  float c2 = cos( a2 ), s2 = sin( a2 );
  vUv2 = vec2( c2 * q.x - s2 * q.y, s2 * q.x + c2 * q.y ) * 0.78 + 0.5;
  vQ = q * 2.0;
  vAlpha = iData.z;
  vShade = iData.w;
}
`;
const SMOKE_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uLitTop;
uniform vec3 uLitLow;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uFogMax;
uniform vec3 uRoomMin;
uniform vec3 uRoomMax;
uniform vec3 uDoor;      // x：門洞 z0、y：門洞 z1、z：門洞高
uniform vec2 uCrisp;     // 煙團輪廓的銳利度（alpha smoothstep 範圍）
uniform float uOutK;     // 門外短廊的煙亮度（沒有火光時很暗；終幕火光時被映亮）
varying vec2 vUv;
varying vec2 vUv2;
varying vec2 vQ;
varying vec3 vWorld;
varying float vDepth;
varying float vAlpha;
varying float vShade;
void main() {
  float a1 = texture2D( uMap, vUv ).a;
  float a2 = texture2D( uMap, vUv2 ).a;
  float a = smoothstep( uCrisp.x, uCrisp.y, a1 * ( 0.55 + 0.9 * a2 ) );
  // 與房間各面接觸處淡出（解析式 soft particle）；門洞處不算牆
  vec3 d0 = vWorld - uRoomMin, d1 = uRoomMax - vWorld;
  bool inDoor = vWorld.z > uDoor.x && vWorld.z < uDoor.y && vWorld.y < uDoor.z;
  float dx = inDoor ? d1.x : min( d0.x, d1.x );
  float dw = min( min( dx, min( d0.z, d1.z ) ), min( d0.y, d1.y ) );
  a *= smoothstep( 0.0, 0.5, dw );
  // 靠近相機淡出（避免大片面貼臉、穿過鏡頭）
  a *= smoothstep( 0.3, 1.3, vDepth );
  a *= vAlpha;
  if ( a < 0.002 ) discard;
  // 假體積光：球面法線，世界上方（天花板燈）較亮，下方較暗；濃處自遮蔽
  float r2 = min( dot( vQ, vQ ), 1.0 );
  vec3 n = normalize( vec3( vQ, sqrt( 1.0 - r2 ) + 0.35 ) );
  vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float top = clamp( dot( n, upV ) * 0.55 + 0.5, 0.0, 1.0 );
  float self = mix( 1.0, 0.6, clamp( a1 * a2 * 1.5, 0.0, 1.0 ) );
  vec3 col = mix( uLitLow, uLitTop, top ) * vShade * self;
  // 門外的短廊：沒有室內光（終幕時只有火光映照）；進到房間才被室內光照亮
  col *= mix( uOutK, 1.0, smoothstep( uRoomMin.x - 0.7, uRoomMin.x + 0.6, vWorld.x ) );
  float f =1.0 - exp( -uFogDensity * uFogDensity * vDepth * vDepth );
  col = mix( col, uFogColor, min( f, uFogMax ) );
  gl_FragColor = vec4( col, a );
}
`;

export class SmokeSystem {
  constructor(room, { count = 52 } = {}) {
    const L = room.L, bd = L.blastDoor;
    this.L = L;
    this.count = count;
    this.door = { x: L.minX, z0: bd.z - bd.width / 2, z1: bd.z + bd.width / 2, h: bd.height };
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iData', this.aData);
    geo.instanceCount = 0;
    this.uniforms = {
      uMap: { value: room.tex.get('smoke') },
      uLitTop: { value: new THREE.Color(0.1, 0.08, 0.06) },
      uLitLow: { value: new THREE.Color(0.04, 0.03, 0.025) },
      uFogColor: { value: new THREE.Color(0, 0, 0) },
      uFogDensity: { value: 0 },
      uFogMax: { value: 0.55 },
      uRoomMin: { value: new THREE.Vector3(L.minX, 0, L.minZ) },
      uRoomMax: { value: new THREE.Vector3(L.maxX, L.height, L.maxZ) },
      uDoor: { value: new THREE.Vector3(this.door.z0, this.door.z1, this.door.h) },
      uCrisp: { value: new THREE.Vector2(0.06, 0.8) },
      uOutK: { value: 0.18 },
    };
    /** 可調外觀：生成率（個/秒）、初始/最終尺寸（m）、不透明度 */
    this.look = { rate: 5.2, size0: 0.55, size1: 1.8, op: 0.6 };
    this.mat = new THREE.ShaderMaterial({
      name: 'cr:smoke', uniforms: this.uniforms, vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'smoke';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
    this.group = this.mesh;
    room.group.add(this.mesh);
    this.geo = geo;
    this.rand = rng(4242);
    this.parts = [];
    for (let i = 0; i < count; i++) {
      this.parts.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), spread: new THREE.Vector2(), age: 0, life: 1, depth: 0, alpha: 0 });
    }
    this._spawnAcc = 0;
    this._order = [];
    this.visibleCount = 0;
  }

  _spawn(p, o) {
    const r = this.rand, D = this.door;
    // 門洞已開啟的範圍（門往 +Z 滑開，所以開口從 z0 往 +Z 長出來）
    const zOpen = D.z0 + Math.max(0.12, o.doorOpen * (D.z1 - D.z0));
    const top = D.h - 0.08;
    p.alive = true;
    p.age = 0;
    // 熱煙從開口上半部湧出（中性面以上），少部分從較低處
    p.pos.set(D.x - 0.35 - r() * 0.4, top - Math.pow(r(), 1.6) * 1.25, lerp(D.z0 + 0.1, zOpen - 0.08, r()));
    p.vel.set(0.9 + r() * 0.8, 0.12 + r() * 0.3, (r() - 0.5) * 0.35);
    p.life = 8 + r() * 6;
    const L2 = this.look;
    p.size0 = L2.size0 * (0.8 + r() * 0.4);
    p.size1 = L2.size1 * (0.75 + r() * 0.5);
    p.rot = r() * Math.PI * 2;
    p.rotV = (r() - 0.5) * 0.22;
    p.op = L2.op * (0.8 + r() * 0.4);
    p.shade = 0.78 + r() * 0.38;
    p.seed = r() * 100;
    // 最後停留的高度：在目前煙層（天花板 ~ 煙層下緣）之間
    p.yT = lerp(Math.max(o.layerY - 0.15, 0.45), 2.72, Math.pow(r(), 0.7));
    // 沿天花板擴散的方向：大致往房內（+X），左右散開
    const ang = (r() - 0.5) * 2.4;
    p.spread.set(Math.cos(ang), Math.sin(ang));
    p.speed = 0.35 + r() * 0.35;
  }

  /**
   * @param {number} dt
   * @param {number} t
   * @param {object} o { level 0..1, flowing, doorOpen 0..1, layerY, litTop, litLow, fogColor, fogDensity, camera }
   */
  update(dt, t, o) {
    const level = o.level;
    const L = this.L;
    // 生成：門開著、濃煙還在增加時持續湧入
    const flow = o.doorOpen > 0.01 && o.flowing ? clamp(0.35 + level * 20) : 0;
    this._spawnAcc = Math.min(this._spawnAcc + dt * this.look.rate * flow, 3);
    const fadeK = clamp(level * 3);   // 煙散去時整體淡出
    const cam = o.camera;
    if (cam) { cam.getWorldPosition(_cam); cam.getWorldDirection(_fwd); } else { _cam.set(0, 1.6, 0); _fwd.set(0, 0, -1); }
    const order = this._order; order.length = 0;
    for (const p of this.parts) {
      if (!p.alive) {
        if (this._spawnAcc >= 1) { this._spawnAcc -= 1; this._spawn(p, o); } else continue;
      }
      p.age += dt;
      if (p.age > p.life) {
        if (flow > 0 && this._spawnAcc >= 1) { this._spawnAcc -= 1; this._spawn(p, o); } else if (flow <= 0 || p.age > p.life + 4) { p.alive = false; continue; }
      }
      const k = p.age;
      // 水平：初速衰減 → 沿天花板以重力流速度擴散，越擴散越慢
      const drag = Math.exp(-0.9 * dt);
      p.vel.x *= drag; p.vel.z *= drag;
      const sp = p.speed * Math.exp(-k / 7) * smoothstep(0.4, 2.2, k);
      p.vel.x += p.spread.x * sp * dt * 1.2;
      p.vel.z += p.spread.y * sp * dt * 1.2;
      // 垂直：浮升到目標高度附近後停住（彈簧＋阻尼）；煙層下沉時跟著往下
      const yT = Math.min(p.yT, Math.max(p.yT - 0.6, o.layerY + (p.yT - o.layerY) * 0.4));
      p.vel.y += ((yT - p.pos.y) * 0.9 - p.vel.y * 1.6) * dt;
      // 翻滾（低頻偽紊流）
      const s = p.seed;
      p.vel.x += Math.sin(t * 0.31 + s + p.pos.z * 1.3) * 0.11 * dt;
      p.vel.z += Math.cos(t * 0.27 + s * 1.7 + p.pos.x * 1.1) * 0.11 * dt;
      p.vel.y += Math.sin(t * 0.43 + s * 2.3 + p.pos.x * 0.9) * 0.05 * dt;
      p.pos.addScaledVector(p.vel, dt);
      // 柔性邊界（房間內；門洞外的短廊允許）
      const inDoor = p.pos.z > this.door.z0 && p.pos.z < this.door.z1;
      const minX = inDoor ? L.minX - 1.2 : L.minX + 0.45;
      if (p.pos.x < minX) p.vel.x += (minX - p.pos.x) * 2.5 * dt;
      if (p.pos.x > L.maxX - 0.6) p.vel.x -= (p.pos.x - (L.maxX - 0.6)) * 2.5 * dt;
      if (p.pos.z < L.minZ + 0.6) p.vel.z += (L.minZ + 0.6 - p.pos.z) * 2.5 * dt;
      if (p.pos.z > L.maxZ - 0.6) p.vel.z -= (p.pos.z - (L.maxZ - 0.6)) * 2.5 * dt;
      if (p.pos.y > L.height - 0.35) p.vel.y -= (p.pos.y - (L.height - 0.35)) * 3 * dt;
      // 外觀
      const grow = smoothstep(0, 1, Math.min(1, k / 3.2));
      p.size = lerp(p.size0, p.size1, grow) * (1 + 0.04 * Math.sin(t * 0.5 + s));
      p.angle = p.rot + p.rotV * k;
      const life = smoothstep(0, 0.8, k) * (1 - smoothstep(p.life - 2.2, p.life + 2, k));
      p.alpha = p.op * life * fadeK * (o.alphaMul ?? 1);
      if (p.alpha < 0.002) continue;
      _v.copy(p.pos).sub(_cam);
      p.depth = _v.dot(_fwd);
      if (p.depth < -p.size) continue;   // 在相機後方
      order.push(p);
    }
    // 由遠到近排序（NormalBlending）
    order.sort((a, b) => b.depth - a.depth);
    const P = this.aPos.array, D = this.aData.array;
    for (let i = 0; i < order.length; i++) {
      const p = order[i];
      P[i * 3] = p.pos.x; P[i * 3 + 1] = p.pos.y; P[i * 3 + 2] = p.pos.z;
      D[i * 4] = p.size; D[i * 4 + 1] = p.angle; D[i * 4 + 2] = p.alpha; D[i * 4 + 3] = p.shade;
    }
    this.geo.instanceCount = order.length;
    this.visibleCount = order.length;
    if (order.length) { this.aPos.needsUpdate = true; this.aData.needsUpdate = true; }
    this.mesh.visible = order.length > 0;
    const U = this.uniforms;
    U.uLitTop.value.copy(o.litTop);
    U.uLitLow.value.copy(o.litLow);
    U.uFogColor.value.copy(o.fogColor);
    U.uFogDensity.value = o.fogDensity;
    U.uOutK.value = o.outK ?? 0.18;
  }

  reset() {
    for (const p of this.parts) p.alive = false;
    this._spawnAcc = 0;
    this.geo.instanceCount = 0;
    this.visibleCount = 0;
    this.mesh.visible = false;
  }
}

export class SteamSystem {
  constructor(room, origin, { count = 6 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'steam';
    room.group.add(this.group);
    const tex = room.tex.get('smoke');
    this.origin = origin.clone();
    this.k = 0;
    this.parts = [];
    const r = rng(77);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0xd9d5cd, transparent: true, depthWrite: false, opacity: 0 });
      mat.name = 'cr:steam';
      const sp = new THREE.Sprite(mat);
      sp.raycast = () => {};
      sp.visible = false;
      this.group.add(sp);
      this.parts.push({ sp, mat, period: 3.6 + r() * 1.6, off: r(), wob: r() * 10, rot: r() * 6 });
    }
  }
  update(dt, t, on, brightness = 1) {
    this.k = damp(this.k, on ? 1 : 0, 1.2, dt);
    for (const p of this.parts) {
      if (this.k < 0.003) { p.sp.visible = false; continue; }
      const ph = ((t / p.period + p.off) % 1 + 1) % 1;
      const y = this.origin.y + 0.004 + ph * 0.23;
      const drift = ph * ph;
      p.sp.position.set(
        this.origin.x + Math.sin(ph * 4 + p.wob) * 0.012 * (0.4 + ph) + drift * 0.03,
        y,
        this.origin.z + Math.cos(ph * 3 + p.wob) * 0.01 * (0.4 + ph),
      );
      const s = 0.035 + ph * 0.13;
      p.sp.scale.set(s, s * 1.3, 1);
      p.mat.rotation = p.rot + ph * 0.8;
      p.mat.opacity = Math.pow(Math.sin(ph * Math.PI), 1.6) * 0.15 * this.k * brightness;
      p.sp.visible = p.mat.opacity > 0.002;
    }
  }
}
