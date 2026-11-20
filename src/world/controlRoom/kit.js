// =============================================================================
// ControlRoom 建模工具：幾何批次合併、世界座標 UV、常用形體、平滑過渡器
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/** 由 {x,y,z,rx,ry,rz,sx,sy,sz} 組成矩陣（旋轉順序 YXZ：先 yaw 再 pitch 再 roll）。 */
export function T({ x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'YXZ' } = {}) {
  _e.set(rx, ry, rz, order);
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

/**
 * 依面法線的主軸做盒狀投影，重新產生 UV（1 個貼圖週期 = scale 公尺）。
 * geometry 必須是 non-indexed，且已經在最終座標系中。
 */
export function worldUV(geom, scale = 1, offset = [0, 0]) {
  const pos = geom.attributes.position;
  const n = pos.count;
  const uv = new Float32Array(n * 2);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3(), nn = new THREE.Vector3();
  const inv = 1 / scale;
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
    ab.subVectors(b, a); ac.subVectors(c, a); nn.crossVectors(ab, ac);
    const ax = Math.abs(nn.x), ay = Math.abs(nn.y), az = Math.abs(nn.z);
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      let u, w;
      if (ax >= ay && ax >= az) { u = nn.x > 0 ? -v.z : v.z; w = v.y; }
      else if (ay >= az) { u = v.x; w = nn.y > 0 ? -v.z : v.z; }
      else { u = nn.z > 0 ? v.x : -v.x; w = v.y; }
      uv[(i + k) * 2] = u * inv + offset[0];
      uv[(i + k) * 2 + 1] = w * inv + offset[1];
    }
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geom;
}

/** 正規化幾何：non-indexed、只保留 position/normal/uv、清除群組。 */
export function normalizeGeom(src, matrix = null) {
  let g = src.index ? src.toNonIndexed() : src.clone();
  if (matrix) g.applyMatrix4(matrix);
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  g.clearGroups();
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

/**
 * 批次合併器：add(key, geometry, matrix, {uv}) → build(mats, parent) 產生每個材質一個 Mesh。
 * 支援矩陣堆疊：push(matrix) / pop()，讓子組件可以在區域座標建模。
 */
export class Batcher {
  constructor(uvDefaults = {}) {
    this.lists = new Map();
    this.stack = [new THREE.Matrix4()];
    this.uvDefaults = uvDefaults;
  }
  get top() { return this.stack[this.stack.length - 1]; }
  push(m) { this.stack.push(this.top.clone().multiply(m)); return this; }
  pop() { if (this.stack.length > 1) this.stack.pop(); return this; }
  /** 在區域座標系中執行 fn。 */
  with(m, fn) { this.push(m); try { fn(); } finally { this.pop(); } }
  /**
   * @param {string} key 材質鍵
   * @param {THREE.BufferGeometry} geom
   * @param {THREE.Matrix4|object} [m] 區域矩陣（或 T() 參數）
   * @param {{uv?: number|false}} [o] uv: 數字 = 世界 UV 尺度（公尺/週期）；false = 保留原始 UV
   */
  add(key, geom, m = null, { uv } = {}) {
    const local = m ? (m.isMatrix4 ? m : T(m)) : null;
    const full = local ? this.top.clone().multiply(local) : this.top.clone();
    const g = normalizeGeom(geom, full);
    const scale = uv === undefined ? this.uvDefaults[key] : uv;
    if (scale !== false && scale !== undefined && scale !== null) worldUV(g, scale);
    else if (!g.attributes.uv) worldUV(g, 1);
    if (!this.lists.has(key)) this.lists.set(key, []);
    this.lists.get(key).push(g);
    return g;
  }
  /** 方塊（中心座標）。 */
  box(key, w, h, d, x = 0, y = 0, z = 0, r = {}, o = {}) {
    return this.add(key, new THREE.BoxGeometry(w, h, d), { x, y, z, ...r }, o);
  }
  /** 圓角方塊。 */
  rbox(key, w, h, d, radius, x = 0, y = 0, z = 0, r = {}, o = {}) {
    return this.add(key, new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2) * 0.999), { x, y, z, ...r }, o);
  }
  /** 圓柱（預設 Y 軸）。 */
  cyl(key, rt, rb, h, x = 0, y = 0, z = 0, r = {}, seg = 16, o = {}) {
    return this.add(key, new THREE.CylinderGeometry(rt, rb, h, seg, 1), { x, y, z, ...r }, o);
  }
  build(mats, parent, { name = '' } = {}) {
    const meshes = {};
    for (const [key, list] of this.lists) {
      if (!list.length) continue;
      const mat = typeof mats === 'function' ? mats(key) : mats[key];
      if (!mat) { console.warn('[ControlRoom] missing material', key); continue; }
      const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
      if (!merged) { console.warn('[ControlRoom] merge failed', key); continue; }
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = `${name}${name ? ':' : ''}${key}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      meshes[key] = mesh;
    }
    this.lists.clear();
    return meshes;
  }
}

/** 由 (z,y) 剖面沿 X 擠出 [x0,x1]（剖面點以 [z, y] 給定，自動處理繞序）。 */
export function profileX(points, x0, x1) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(-z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, steps: 1 });
  g.rotateY(Math.PI / 2);
  g.translate(x0, 0, 0);
  return g;
}

/** 由 (x,y) 剖面沿 Z 擠出 [z0,z1]。 */
export function profileZ(points, z0, z1) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false, steps: 1 });
  g.translate(0, 0, z0);
  return g;
}

/** 前後尺寸不同的方塊（CRT 漸縮背殼）：前面 z=0（w0×h0，中心 y0），後面 z=-d（w1×h1，中心 y1）。 */
export function taperBox(w0, h0, w1, h1, d, y0 = 0, y1 = 0) {
  const f = [[-w0 / 2, y0 - h0 / 2, 0], [w0 / 2, y0 - h0 / 2, 0], [w0 / 2, y0 + h0 / 2, 0], [-w0 / 2, y0 + h0 / 2, 0]];
  const b = [[-w1 / 2, y1 - h1 / 2, -d], [w1 / 2, y1 - h1 / 2, -d], [w1 / 2, y1 + h1 / 2, -d], [-w1 / 2, y1 + h1 / 2, -d]];
  const quads = [
    [f[0], f[1], f[2], f[3]],           // 前
    [b[1], b[0], b[3], b[2]],           // 後
    [b[0], f[0], f[3], b[3]],           // 左
    [f[1], b[1], b[2], f[2]],           // 右
    [f[3], f[2], b[2], b[3]],           // 上
    [b[0], b[1], f[1], f[0]],           // 下
  ];
  const pos = [];
  for (const [a, b2, c, d2] of quads) pos.push(...a, ...b2, ...c, ...a, ...c, ...d2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** 圓角矩形外框（含開孔）沿 +Z 擠出，深度 depth，可帶倒角。 */
export function frameGeom(ow, oh, iw, ih, depth, { r = 0.02, ir = 0.012, bevel = 0, ioy = 0 } = {}) {
  const rr = (s, w, h, rad, oy = 0) => {
    const x = -w / 2, y = -h / 2 + oy;
    s.moveTo(x + rad, y);
    s.lineTo(x + w - rad, y); s.quadraticCurveTo(x + w, y, x + w, y + rad);
    s.lineTo(x + w, y + h - rad); s.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    s.lineTo(x + rad, y + h); s.quadraticCurveTo(x, y + h, x, y + h - rad);
    s.lineTo(x, y + rad); s.quadraticCurveTo(x, y, x + rad, y);
    return s;
  };
  const shape = rr(new THREE.Shape(), ow, oh, r);
  const hole = rr(new THREE.Path(), iw, ih, ir, ioy);
  shape.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
  });
  return g;
}

/** 平面四邊形，UV 指定為貼圖中的子矩形 [u0,v0,u1,v1]（decal 用）。 */
export function quad(w, h, rect = [0, 0, 1, 1], segX = 1, segY = 1) {
  const g = new THREE.PlaneGeometry(w, h, segX, segY);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, rect[0] + (rect[2] - rect[0]) * uv.getX(i), rect[1] + (rect[3] - rect[1]) * uv.getY(i));
  }
  return g;
}

/** 矩形環（外 ow×oh、中央挖空 iw×ih），UV 0..1 對應外框（環狀貼花：不蓋住出風口/燈具）。 */
export function ringQuad(ow, oh, iw, ih) {
  const s = new THREE.Shape();
  s.moveTo(-ow / 2, -oh / 2); s.lineTo(ow / 2, -oh / 2); s.lineTo(ow / 2, oh / 2); s.lineTo(-ow / 2, oh / 2); s.lineTo(-ow / 2, -oh / 2);
  const h = new THREE.Path();
  h.moveTo(-iw / 2, -ih / 2); h.lineTo(-iw / 2, ih / 2); h.lineTo(iw / 2, ih / 2); h.lineTo(iw / 2, -ih / 2); h.lineTo(-iw / 2, -ih / 2);
  s.holes.push(h);
  const g = new THREE.ShapeGeometry(s);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / ow + 0.5, p.getY(i) / oh + 0.5);
  return g;
}

/** 不可見、可被射線命中的碰撞盒（Interaction / Gaze 依 userData.hitbox 處理）。 */
const HITBOX_MAT = new THREE.MeshBasicMaterial({ visible: false });
export function hitbox(w, h, d, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HITBOX_MAT);
  m.position.set(x, y, z);
  m.userData.hitbox = true;
  m.name = 'hitbox';
  return m;
}

/** 讓物件不參與射線檢測（裝飾、粒子、疊層）。 */
export const noRaycast = (o) => { o.traverse((c) => { c.raycast = () => {}; }); return o; };

/** 以遊戲時間計算的平滑過渡值（smoothstep 緩動）；任何時間重複 set 都會由「目前值」接續。 */
export class Fader {
  constructor(v = 0) { this.v = v; this.from = v; this.to = v; this.t0 = 0; this.dur = 0; this.done = true; }
  set(target, dur, now) {
    this.from = this.v; this.to = target; this.t0 = now; this.dur = Math.max(0, dur || 0);
    this.done = false;
    if (this.dur <= 0) { this.v = target; this.done = true; }
    return this;
  }
  snap(v) { this.v = this.from = this.to = v; this.done = true; return this; }
  update(now) {
    if (this.done) return this.v;
    const k = this.dur <= 0 ? 1 : Math.min(1, Math.max(0, (now - this.t0) / this.dur));
    const e = k * k * (3 - 2 * k);
    this.v = this.from + (this.to - this.from) * e;
    if (k >= 1) { this.v = this.to; this.done = true; }
    return this.v;
  }
}

/** 一維平滑插值關鍵格：keys = [[t, v], ...]（t 遞增），以餘弦插值。 */
export function keyCurve(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) {
      const [t0, v0] = keys[i - 1];
      const k = (t - t0) / Math.max(1e-6, t1 - t0);
      const e = 0.5 - 0.5 * Math.cos(Math.PI * k);
      return v0 + (v1 - v0) * e;
    }
  }
  return keys[keys.length - 1][1];
}

/** 矩形減去多個洞（同平面 2D，回傳不重疊矩形）。r = [u0,v0,u1,v1] */
export function subtractRects(rect, holes) {
  let parts = [rect];
  for (const h of holes) {
    const next = [];
    for (const p of parts) {
      const [a0, b0, a1, b1] = p;
      const [h0, k0, h1, k1] = h;
      if (h1 <= a0 || h0 >= a1 || k1 <= b0 || k0 >= b1) { next.push(p); continue; }
      const cu0 = Math.max(a0, h0), cu1 = Math.min(a1, h1);
      const cv0 = Math.max(b0, k0), cv1 = Math.min(b1, k1);
      if (cu0 > a0) next.push([a0, b0, cu0, b1]);
      if (cu1 < a1) next.push([cu1, b0, a1, b1]);
      if (cv0 > b0) next.push([cu0, b0, cu1, cv0]);
      if (cv1 < b1) next.push([cu0, cv1, cu1, b1]);
    }
    parts = next;
  }
  return parts.filter((p) => p[2] - p[0] > 1e-4 && p[3] - p[1] > 1e-4);
}
