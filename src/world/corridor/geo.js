// =============================================================================
// Corridor 幾何工具：世界座標 UV 的方塊、管線/彎頭、依材質＋區段合併的 Batch。
// 所有產生的 BufferGeometry 皆為 indexed，屬性 position / normal / uv（＋可選 color），
// 讓 mergeGeometries 可以直接合併。
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();

// ---- 低階四邊形累加器 ---------------------------------------------------------
export class GeoBuilder {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; }
  /** a,b,c,d 逆時針（從法線那一側看）。 */
  quad(a, b, c, d, n, ua, ub, uc, ud) {
    const i = this.pos.length / 3;
    this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    for (let k = 0; k < 4; k++) this.nrm.push(n[0], n[1], n[2]);
    this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1], ud[0], ud[1]);
    this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  get empty() { return this.idx.length === 0; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

/**
 * 軸對齊方塊，UV 為「世界座標公尺」平面投影（牆面 u 沿水平、v = y），
 * 相鄰牆段的貼圖因此無縫銜接。faces 為要產生的面（'px nx py ny pz nz'）。
 * s = UV 縮放（預設 1：一單位 = 1 m，由材質 repeat 控制實際尺度）。
 */
export function box(x0, x1, y0, y1, z0, z1, { faces = 'px nx py ny pz nz', s = 1, local = false } = {}) {
  const b = new GeoBuilder();
  const f = new Set(faces.split(/\s+/));
  // local：UV 以方塊自身尺寸 0..1（面板、門片等「整張貼一次」）
  const U = (v, lo, hi) => (local ? (v - lo) / (hi - lo || 1) : v * s);
  if (f.has('pz')) b.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1],
    [U(x0, x0, x1), U(y0, y0, y1)], [U(x1, x0, x1), U(y0, y0, y1)], [U(x1, x0, x1), U(y1, y0, y1)], [U(x0, x0, x1), U(y1, y0, y1)]);
  if (f.has('nz')) b.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1],
    local ? [0, 0] : [-x1 * s, y0 * s], local ? [1, 0] : [-x0 * s, y0 * s], local ? [1, 1] : [-x0 * s, y1 * s], local ? [0, 1] : [-x1 * s, y1 * s]);
  if (f.has('px')) b.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0],
    local ? [0, 0] : [-z1 * s, y0 * s], local ? [1, 0] : [-z0 * s, y0 * s], local ? [1, 1] : [-z0 * s, y1 * s], local ? [0, 1] : [-z1 * s, y1 * s]);
  if (f.has('nx')) b.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0],
    local ? [0, 0] : [z0 * s, y0 * s], local ? [1, 0] : [z1 * s, y0 * s], local ? [1, 1] : [z1 * s, y1 * s], local ? [0, 1] : [z0 * s, y1 * s]);
  if (f.has('py')) b.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0],
    local ? [0, 0] : [x0 * s, -z1 * s], local ? [1, 0] : [x1 * s, -z1 * s], local ? [1, 1] : [x1 * s, -z0 * s], local ? [0, 1] : [x0 * s, -z0 * s]);
  if (f.has('ny')) b.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0],
    local ? [0, 0] : [x0 * s, z0 * s], local ? [1, 0] : [x1 * s, z0 * s], local ? [1, 1] : [x1 * s, z1 * s], local ? [0, 1] : [x0 * s, z1 * s]);
  return b.build();
}

/** 以中心＋尺寸建立方塊（世界 UV）。 */
export function boxC(cx, cy, cz, w, h, d, opts) {
  return box(cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, cz - d / 2, cz + d / 2, opts);
}

/** 平面四邊形（任意朝向），UV 0..1。p0 左下、p1 右下、p2 右上、p3 左上（從正面看）。 */
export function quadGeo(p0, p1, p2, p3) {
  const b = new GeoBuilder();
  const a = new THREE.Vector3(...p0), bb = new THREE.Vector3(...p1), c = new THREE.Vector3(...p2);
  const n = bb.clone().sub(a).cross(c.clone().sub(a)).normalize();
  b.quad(p0, p1, p2, p3, [n.x, n.y, n.z], [0, 0], [1, 0], [1, 1], [0, 1]);
  return b.build();
}

// ---- 管線 -------------------------------------------------------------------
/** 由 a 到 b 的圓管（側面），UV：u 繞圓周、v 沿管長（每 vLen 公尺一格）。 */
export function tube(a, b, r, { segs = 12, vLen = 2, caps = false } = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const dir = B.clone().sub(A); const L = dir.length(); dir.normalize();
  const g = new THREE.CylinderGeometry(r, r, L, segs, 1, !caps);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (L / vLen));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  _m.compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
  g.applyMatrix4(_m);
  return g;
}

/** 90° 彎頭：起點 S、起始方向 d0、結束方向 d1（皆單位向量且互相垂直）、彎曲半徑 R、管半徑 r。回傳 { geo, end }。 */
export function elbow(S, d0, d1, R, r, { segs = 12, tubular = 8, vLen = 2 } = {}) {
  const s = new THREE.Vector3(...S), D0 = new THREE.Vector3(...d0).normalize(), D1 = new THREE.Vector3(...d1).normalize();
  const C = s.clone().addScaledVector(D1, R);
  const a = D1.clone().negate(), b = D0.clone(), c = a.clone().cross(b);
  const g = new THREE.TorusGeometry(R, r, segs, tubular, Math.PI / 2);
  // 交換 UV：u 繞管周、v 沿弧長
  const uv = g.attributes.uv; const arcL = R * Math.PI / 2;
  for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u * arcL / vLen); }
  _m.makeBasis(a, b, c).setPosition(C);
  g.applyMatrix4(_m);
  const end = C.clone().addScaledVector(D0, R);
  return { geo: g, end: [end.x, end.y, end.z] };
}

/** 管線的法蘭/束帶：在 p 處、沿 dir 方向的短圓柱（含端蓋）。 */
export function ring(p, dir, r, len, segs = 14) {
  const d = new THREE.Vector3(...dir).normalize();
  const a = new THREE.Vector3(...p).addScaledVector(d, -len / 2), b = new THREE.Vector3(...p).addScaledVector(d, len / 2);
  return tube([a.x, a.y, a.z], [b.x, b.y, b.z], r, { segs, caps: true, vLen: 0.5 });
}

/** 一般幾何以矩陣變換後回傳（方便鏈式）。 */
export function xform(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  _m.compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale));
  geo.applyMatrix4(_m);
  return geo;
}

// ---- 合併 -------------------------------------------------------------------
/** 讓幾何具備統一屬性集合（indexed、position/normal/uv[/color]）。 */
export function normalizeGeo(g, color = null) {
  if (!g.index) {
    const n = g.attributes.position.count; const idx = new Array(n); for (let i = 0; i < n; i++) idx[i] = i;
    g.setIndex(idx);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (color) {
    const n = g.attributes.position.count; const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
    g.setAttribute('color', new THREE.Float32BufferAttribute(arr, 3));
  } else if (g.attributes.color) g.deleteAttribute('color');
  g.clearGroups();
  return g;
}

/**
 * 依「材質 × 區段」收集幾何後合併成少量網格。chunk = 沿 X 的區段長度（讓遠處區段可被視錐剔除）。
 * add(mat, geo, { color, cast, receive, chunked })
 */
export class Batch {
  constructor({ chunk = 12, origin = 4 } = {}) { this.entries = new Map(); this.chunk = chunk; this.origin = origin; }
  add(mat, geo, { color = null, cast = true, receive = true, chunked = true, tag = '' } = {}) {
    if (!geo) return;
    // 「色調別名」材質：合併進共用的 vertexColors 材質，以頂點色保留原本的顏色
    if (mat.userData && mat.userData.tintOf) { if (!color) color = mat.color; mat = mat.userData.tintOf; }
    const col = mat.vertexColors ? (color ? (color.isColor ? color : new THREE.Color(color)) : new THREE.Color(1, 1, 1)) : null;
    normalizeGeo(geo, col);
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
    // 電閘室與轉角（z > 2.8）獨立成一區
    const ci = !chunked ? 'all' : (cz > 2.9 ? 'leg' : String(Math.floor((cx - this.origin) / this.chunk)));
    const key = `${mat.uuid}|${cast ? 1 : 0}${receive ? 1 : 0}|${tag}|${ci}`;
    let e = this.entries.get(key);
    if (!e) { e = { mat, cast, receive, geos: [], name: `${mat.name || 'mat'}:${ci}` }; this.entries.set(key, e); }
    e.geos.push(geo);
  }
  build(parent, { renderOrder = 0 } = {}) {
    const meshes = [];
    for (const e of this.entries.values()) {
      const merged = e.geos.length === 1 ? e.geos[0] : mergeGeometries(e.geos, false);
      if (!merged) { console.warn('[corridor] merge failed', e.name); continue; }
      if (e.geos.length > 1) for (const g of e.geos) g.dispose();
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, e.mat);
      m.name = e.name; m.castShadow = e.cast; m.receiveShadow = e.receive; m.renderOrder = renderOrder;
      m.matrixAutoUpdate = false; m.updateMatrix();
      parent.add(m); meshes.push(m);
    }
    this.entries.clear();
    return meshes;
  }
}

/** 由函式 (u,v) → 位置 建立參數曲面（u 0..1 × v 0..1），UV 直接 = (u,v)。法線事後計算。 */
export function paramSurface(fn, nu, nv, { uvFn = null, flip = false } = {}) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, v = j / nv;
      fn(u, v, _v); pos.push(_v.x, _v.y, _v.z);
      if (uvFn) { const t = uvFn(u, v); uv.push(t[0], t[1]); } else uv.push(u, v);
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * row + i, b = a + 1, c = a + row + 1, d = a + row;
    if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 漸細的彎管（袖子、纜線）：沿曲線 curve，半徑 radiusFn(t)，截面可壓扁 flat（0..1）。 */
export function taperTube(curve, { segs = 24, radial = 12, radiusFn = () => 0.05, flat = 1, flatAxis = null, closeEnd = false } = {}) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], uv = [], idx = [];
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  const fa = flatAxis ? new THREE.Vector3(...flatAxis).normalize() : null;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; curve.getPointAt(t, P);
    const r = radiusFn(t);
    let nrm = frames.normals[i], bin = frames.binormals[i];
    if (fa) { // 讓壓扁方向固定在某個世界軸附近
      const tan = frames.tangents[i];
      bin = fa.clone().sub(tan.clone().multiplyScalar(fa.dot(tan))).normalize();
      nrm = bin.clone().cross(tan).normalize();
    }
    for (let k = 0; k <= radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a) * flat;
      N.set(0, 0, 0).addScaledVector(nrm, c).addScaledVector(bin, s);
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r);
      uv.push(k / radial, 1 - t);
    }
  }
  const row = radial + 1;
  for (let i = 0; i < segs; i++) for (let k = 0; k < radial; k++) {
    const a = i * row + k, b = a + row, c = b + 1, d = a + 1;
    idx.push(a, b, d, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 決定性雜訊（給變形用）。 */
export function hash(x, y = 0, z = 0) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
