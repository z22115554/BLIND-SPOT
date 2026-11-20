// =============================================================================
// props — CCTV 頻道場景共用的程式化模型：隧道斷面、轎車、油罐車、煙霧與火焰粒子、標誌
// 所有靜態幾何依材質合併（mergeGeometries），每個頻道只有少數 draw call。
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, clamp } from '../../core/util.js';
import * as TX from './feedTextures.js';

export const mergeList = (list) => {
  const geos = list.filter(Boolean).map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of geos) { if (!g.attributes.uv) { g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); } }
  return mergeGeometries(geos, false);
};
export const boxG = (w, h, d, x = 0, y = 0, z = 0, ry = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
};
export const std = (o) => new THREE.MeshStandardMaterial(o);
export const mesh = (geo, mat, parent) => { const m = new THREE.Mesh(geo, mat); if (parent) parent.add(m); return m; };

// ---------------------------------------------------------------------------
// 隧道斷面：路面 x ∈ [-4.2, 4.2]、兩側步道 1.0 m、垂直牆到 3.2 m、橢圓拱頂到 6.5 m
// ---------------------------------------------------------------------------
export const TUNNEL = { road: 4.2, wall: 5.2, wallTop: 3.2, crown: 6.5, curb: 0.25 };

/** 把 XY 斷面沿 Z 擠出（zA > zB，往 -Z）。u = 斷面弧長 × uScale，v = z × vScale */
export function profileExtrude(points, zA, zB, { uScale = 1, vScale = 1, segs = 6 } = {}) {
  const pos = [], uv = [], idx = [];
  const arc = [0];
  for (let i = 1; i < points.length; i++) arc.push(arc[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const cols = points.length;
  for (let s = 0; s <= segs; s++) {
    const z = zA + (zB - zA) * (s / segs);
    for (let i = 0; i < cols; i++) {
      pos.push(points[i][0], points[i][1], z);
      uv.push(arc[i] * uScale, z * vScale);
    }
  }
  for (let s = 0; s < segs; s++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = s * cols + i, b = a + 1, c = a + cols, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function archPoints(side, n = 14) {
  // side: -1 左半、+1 右半；由牆頂到拱頂
  const pts = [];
  const { wall, wallTop, crown } = TUNNEL;
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * (Math.PI / 2);
    pts.push([side * wall * Math.cos(th), wallTop + (crown - wallTop) * Math.sin(th)]);
  }
  return side < 0 ? pts : pts.reverse();
}

/**
 * 建立隧道殼體。
 * opts: length, zStart（鏡頭後方一點）, lamp: (i, side) => 0..1 亮度（0 = 壞掉/關閉）,
 *       rightGap: [zA, zB]（右牆缺口：緊急停車彎）, fans, cabinets
 * 回傳 { group, mats, lamps: [{x,y,z,on}] }
 */
export function buildTunnel({ length = 140, zStart = 6, lamp = () => 1, lampEvery = 6, lampFrom = null, rightGap = null, fans = true, cabinets = true, seed = 1 } = {}) {
  const group = new THREE.Group();
  const zA = zStart, zB = zStart - length;
  const { road, wall, wallTop, crown, curb } = TUNNEL;
  const mats = {
    tiles: std({ map: TX.rep(TX.tunnelTiles(), 1, 1), roughness: 0.42, metalness: 0.0, side: THREE.DoubleSide }),
    arch: std({ map: TX.rep(TX.archConcrete(), 1, 1), roughness: 0.95, side: THREE.DoubleSide }),
    road: std({ map: TX.rep(TX.roadAsphalt(), 1, length / 12), roughness: 0.82 }),
    curb: std({ map: TX.rep(TX.archConcrete(), 1, 1), color: 0xb5b2aa, roughness: 0.9 }),
    lampOn: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.2, 1.0) }),
    lampOff: std({ color: 0x2a2a2a, roughness: 0.6, metalness: 0.4 }),
    metal: std({ color: 0x3b3d40, roughness: 0.55, metalness: 0.6 }),
    redLamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 0.12, 0.08) }),
    greenLamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.15, 1.2, 0.45) }),
    cabinet: std({ color: 0xa8241c, roughness: 0.5, metalness: 0.2 }),
  };
  mats.tiles.map.repeat.set(1 / 1.6, 1 / 1.6);
  mats.arch.map.repeat.set(1 / 4, 1 / 4);

  // 牆（磁磚）——右牆可有缺口
  const wallPts = (side) => [[side * wall, curb], [side * wall, wallTop]];
  const tileUV = { uScale: 1, vScale: 1, segs: 4 };
  const walls = [profileExtrude(wallPts(-1), zA, zB, tileUV)];
  const gapRanges = rightGap ? [[zA, rightGap[0]], [rightGap[1], zB]] : [[zA, zB]];
  for (const [a, b] of gapRanges) walls.push(profileExtrude(wallPts(1).slice().reverse(), a, b, tileUV));
  mesh(mergeList(walls), mats.tiles, group);
  // 拱頂
  const archG = [profileExtrude(archPoints(-1), zA, zB, { uScale: 1, vScale: 1, segs: 6 })];
  for (const [a, b] of gapRanges) archG.push(profileExtrude(archPoints(1), a, b, { uScale: 1, vScale: 1, segs: 6 }));
  if (rightGap) {
    // 缺口上方的拱頂（從較高處開始，讓停車彎頂板接上）
    const pts = archPoints(1).filter((p) => p[1] >= 4.4);
    archG.push(profileExtrude(pts, rightGap[0], rightGap[1], { segs: 3 }));
  }
  mesh(mergeList(archG), mats.arch, group);
  // 路面
  const rg = new THREE.PlaneGeometry(road * 2, length);
  rg.rotateX(-Math.PI / 2);
  rg.translate(0, 0, (zA + zB) / 2);
  mesh(rg, mats.road, group);
  // 步道（左全長；右邊遇缺口分段）
  const curbs = [boxG(wall - road, curb, length, -(road + wall) / 2, curb / 2, (zA + zB) / 2)];
  for (const [a, b] of gapRanges) curbs.push(boxG(wall - road, curb, a - b, (road + wall) / 2, curb / 2, (a + b) / 2));
  mesh(mergeList(curbs), mats.curb, group);

  // 照明燈具（兩側拱腳，沿 z 每 lampEvery 公尺）
  const on = [], off = [], lamps = [];
  const th = 0.42;
  const lx = wall * Math.cos(th) - 0.08, ly = wallTop + (crown - wallTop) * Math.sin(th) - 0.06;
  let i = 0;
  for (let z = lampFrom ?? zA - 2; z > zB + 1; z -= lampEvery, i++) {
    for (const side of [-1, 1]) {
      const lv = lamp(i, side, z);
      const g = boxG(0.26, 0.1, 1.2, side * lx, ly, z);
      (lv > 0 ? on : off).push(g);
      lamps.push({ x: side * lx, y: ly - 0.1, z, on: lv });
    }
  }
  if (on.length) mesh(mergeList(on), mats.lampOn, group);
  if (off.length) mesh(mergeList(off), mats.lampOff, group);
  // 燈具外殼與電纜架
  const misc = [];
  misc.push(boxG(0.36, 0.06, length, -(wall - 0.25), 3.05, (zA + zB) / 2));
  misc.push(boxG(0.36, 0.06, length, wall - 0.25, 3.05, (zA + zB) / 2));
  if (fans) {
    for (let z = zA - 24; z > zB + 8; z -= 48) {
      for (const x of [-1.3, 1.3]) {
        const f = new THREE.CylinderGeometry(0.55, 0.55, 3.2, 14, 1, false);
        f.rotateX(Math.PI / 2); f.translate(x, crown - 0.9, z);
        misc.push(f);
        misc.push(boxG(0.1, 0.4, 0.1, x, crown - 0.3, z - 1.0), boxG(0.1, 0.4, 0.1, x, crown - 0.3, z + 1.0));
      }
    }
  }
  mesh(mergeList(misc), mats.metal, group);
  // 消防栓箱（紅色指示燈）與避難方向燈
  if (cabinets) {
    const cab = [], red = [], green = [];
    for (let z = zA - 14; z > zB + 4; z -= 50) {
      if (rightGap && z < rightGap[0] + 2 && z > rightGap[1] - 2) continue;
      cab.push(boxG(0.18, 0.9, 0.7, wall - 0.09, 1.0, z));
      red.push(boxG(0.06, 0.08, 0.16, wall - 0.2, 1.62, z));
    }
    for (let z = zA - 8; z > zB + 2; z -= 25) green.push(boxG(0.04, 0.12, 0.34, -wall + 0.03, 0.75, z));
    if (cab.length) mesh(mergeList(cab), mats.cabinet, group);
    if (red.length) mesh(mergeList(red), mats.redLamp, group);
    if (green.length) mesh(mergeList(green), mats.greenLamp, group);
  }
  return { group, mats, lamps };
}

// ---------------------------------------------------------------------------
// 轎車（車頭朝 -Z）。駕駛座在左側（台灣左駕），doorOpen 為開門角度（弧度）。
// crushed 0..1：車頭壓扁、車頂塌陷；burnt：燒焦、無玻璃。
// ---------------------------------------------------------------------------
function deform(geo, { seed = 1, crush = 0, roofDent = 0, jitter = 0 } = {}) {
  const r = rng(seed);
  const pos = geo.attributes.position;
  const ph = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (crush > 0 && x > 0.7) {
      const k = (x - 0.7);
      x = 0.7 + k * (1 - crush * 0.55);
      y -= crush * k * 0.18 * (1 + Math.sin(z * 5 + ph[0]) * 0.5);
      z += crush * Math.sin(y * 9 + ph[1]) * 0.05;
    }
    if (roofDent > 0 && y > 1.1) y -= roofDent * (1 - Math.abs(x + 0.3) / 1.6) * 0.25;
    if (jitter > 0) {
      x += Math.sin(y * 13 + z * 7 + ph[0]) * jitter;
      y += Math.sin(x * 11 + z * 5 + ph[1]) * jitter;
      z += Math.sin(x * 9 + y * 15 + ph[2]) * jitter;
    }
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildSedan({ paint = 0xe9e9e4, doorOpen = 0, crushed = 0, burnt = false, interiorLight = 0, seed = 1, mats: shared = null } = {}) {
  const car = new THREE.Group();
  const inner = new THREE.Group();
  inner.rotation.y = Math.PI / 2;   // 斷面 x（車長）→ 世界 -Z
  car.add(inner);
  const W = 1.78;
  const body = std({ color: burnt ? 0xffffff : paint, map: burnt ? TX.charredPaint(160 + seed) : null, roughness: burnt ? 0.95 : 0.32, metalness: burnt ? 0.1 : 0.35 });
  const glass = std({ color: 0x07090b, roughness: 0.08, metalness: 0.6 });
  const dark = std({ color: 0x0c0c0c, roughness: 0.85 });
  const rubber = std({ color: 0x111111, roughness: 0.9 });
  const rim = std({ color: burnt ? 0x2a2420 : 0x8a8c8e, roughness: 0.5, metalness: 0.7 });

  const s = new THREE.Shape();
  s.moveTo(2.28, 0.3);
  s.lineTo(2.34, 0.52); s.lineTo(2.25, 0.7); s.lineTo(1.1, 0.87);
  s.lineTo(-1.5, 0.93); s.lineTo(-2.18, 0.91); s.lineTo(-2.31, 0.64); s.lineTo(-2.27, 0.3);
  s.lineTo(-1.82, 0.27);
  s.absarc(-1.38, 0.3, 0.42, Math.PI, 0, true);
  s.lineTo(0.94, 0.25);
  s.absarc(1.38, 0.3, 0.42, Math.PI, 0, true);
  s.lineTo(2.28, 0.3);
  const ext = { depth: W - 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 8 };
  const bodyG = new THREE.ExtrudeGeometry(s, ext);
  bodyG.translate(0, 0, -(W - 0.1) / 2);
  const gh = new THREE.Shape();
  gh.moveTo(1.12, 0.86); gh.lineTo(0.28, 1.37); gh.lineTo(-0.82, 1.39); gh.lineTo(-1.52, 0.92); gh.lineTo(1.12, 0.86);
  const ghG = new THREE.ExtrudeGeometry(gh, { depth: W - 0.32, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
  ghG.translate(0, 0, -(W - 0.32) / 2);
  const roofG = boxG(1.12, 0.035, W - 0.3, -0.27, 1.41, 0);
  const pillars = [boxG(0.09, 0.47, W - 0.26, -0.36, 1.14, 0)];
  if (crushed > 0 || burnt) {
    deform(bodyG, { seed, crush: crushed, jitter: burnt ? 0.012 : 0.006 });
    deform(ghG, { seed: seed + 1, crush: crushed, roofDent: crushed, jitter: 0.01 });
    deform(roofG, { seed: seed + 2, crush: crushed, roofDent: crushed });
  }
  mesh(mergeList([bodyG, roofG, ...pillars]), body, inner);
  mesh(ghG, burnt ? dark : glass, inner);
  // 輪胎
  const wheels = [], rims = [];
  for (const x of [-1.38, 1.38]) {
    for (const zz of [-1, 1]) {
      const t = new THREE.CylinderGeometry(0.32, 0.32, 0.22, 16);
      t.rotateX(Math.PI / 2); t.translate(x, burnt ? 0.24 : 0.32, zz * (W / 2 - 0.12));
      wheels.push(t);
      const rg = new THREE.CylinderGeometry(0.19, 0.19, 0.03, 12);
      rg.rotateX(Math.PI / 2); rg.translate(x, burnt ? 0.24 : 0.32, zz * (W / 2 - 0.0));
      rims.push(rg);
    }
  }
  if (!burnt) mesh(mergeList(wheels), rubber, inner);
  mesh(mergeList(rims), rim, inner);
  // 車燈
  if (!burnt) {
    const hl = std({ color: 0xd8d8d0, emissive: 0x111111, roughness: 0.2 });
    const tl = std({ color: 0x4a0606, emissive: 0x050000, roughness: 0.3 });
    mesh(mergeList([boxG(0.06, 0.1, 0.38, 2.3, 0.62, 0.6), boxG(0.06, 0.1, 0.38, 2.3, 0.62, -0.6)]), hl, inner);
    mesh(mergeList([boxG(0.05, 0.1, 0.34, -2.3, 0.72, 0.62), boxG(0.05, 0.1, 0.34, -2.3, 0.72, -0.62)]), tl, inner);
    mesh(boxG(0.04, 0.12, 0.5, -2.31, 0.5, 0), dark, inner); // 車牌位置
  }
  // 駕駛座車門（左側 = 斷面 -z）
  if (doorOpen > 0) {
    // 門洞（車身側面的黑色凹陷）＋座椅
    mesh(boxG(1.2, 0.56, 0.02, 0.32, 0.6, -W / 2 - 0.035), dark, inner);
    const seatM = std({ color: 0x3a3632, roughness: 0.9 });
    mesh(mergeList([boxG(0.5, 0.14, 0.5, 0.0, 0.52, -0.42), boxG(0.12, 0.6, 0.48, -0.28, 0.86, -0.42, 0)]), seatM, inner);
    mesh(mergeList([new THREE.TorusGeometry(0.17, 0.025, 6, 16).rotateY(Math.PI / 2).rotateZ(-0.5).translate(0.5, 0.98, -0.42)]), dark, inner);
    const hinge = new THREE.Group();
    hinge.position.set(0.95, 0, -W / 2 - 0.02);
    hinge.rotation.y = -doorOpen;
    inner.add(hinge);
    const doorPanel = boxG(1.25, 0.6, 0.055, -0.625, 0.61, 0);
    const frame = [boxG(1.18, 0.035, 0.04, -0.62, 1.31, 0.02), boxG(0.035, 0.42, 0.04, -1.2, 1.1, 0.02), boxG(0.04, 0.42, 0.04, -0.06, 1.1, 0.02)];
    mesh(mergeList([doorPanel, ...frame]), body, hinge);
    mesh(boxG(1.1, 0.38, 0.012, -0.62, 1.1, 0.02), glass, hinge);
    mesh(boxG(1.15, 0.5, 0.01, -0.62, 0.61, 0.033), std({ color: 0x2b2826, roughness: 0.9 }), hinge); // 門內飾板
    if (interiorLight > 0) {
      const dome = new THREE.PointLight(0xffe2b0, interiorLight, 0, 2);
      dome.position.set(-0.1, 1.28, 0);
      inner.add(dome);
      mesh(boxG(0.16, 0.02, 0.1, -0.1, 1.36, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.3, 1.0) }), inner);
    }
  }
  return car;
}

// ---------------------------------------------------------------------------
// 翻覆的油罐車（罐體＋底盤側翻＋分離的車頭），燒焦材質
// ---------------------------------------------------------------------------
export function buildTanker({ seed = 3 } = {}) {
  const g = new THREE.Group();
  const tankMat = std({ map: TX.charredPaint(171), color: 0xbcb6ae, roughness: 0.75, metalness: 0.4 });
  const tankPaint = std({ color: 0x8f9296, roughness: 0.45, metalness: 0.65 });
  const chassisM = std({ color: 0x151515, roughness: 0.8, metalness: 0.5 });
  const rubber = std({ color: 0x0d0d0d, roughness: 0.95 });
  const L = 10, R = 1.22;
  // 罐體（軸沿 x）：側翻 → 底盤朝向 +z
  const tank = new THREE.CylinderGeometry(R, R, L, 22, 4, true);
  tank.rotateZ(Math.PI / 2);
  const capA = new THREE.SphereGeometry(R, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2); capA.scale(1, 0.35, 1); capA.rotateZ(-Math.PI / 2); capA.translate(L / 2, 0, 0);
  const capB = new THREE.SphereGeometry(R, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2); capB.scale(1, 0.35, 1); capB.rotateZ(Math.PI / 2); capB.translate(-L / 2, 0, 0);
  deform(tank, { seed, jitter: 0.03 });
  const tm = mesh(mergeList([tank, capA, capB]), tankMat, g);
  tm.position.y = R;
  // 下半部仍保留原本的銀色漆（上半燒黑）——以第二層略小的半圓筒表現
  const lower = new THREE.CylinderGeometry(R * 1.005, R * 1.005, L * 0.92, 22, 1, true, Math.PI * 0.6, Math.PI * 0.8);
  lower.rotateZ(Math.PI / 2);
  mesh(lower, tankPaint, g).position.y = R;
  // 底盤與輪軸（側翻後朝 +z 伸出）
  const ch = [boxG(L * 0.95, 0.3, 0.25, 0, R, R + 0.15), boxG(L * 0.95, 0.25, 0.2, 0, R + 0.55, R + 0.12)];
  for (const x of [-3.6, -2.4, 2.6]) ch.push(boxG(0.18, 0.18, 1.6, x, R + 0.3, R + 0.75));
  mesh(mergeList(ch), chassisM, g);
  const wh = [];
  for (const x of [-3.6, -2.4, 2.6]) {
    for (const yy of [R - 0.65, R + 1.25]) {
      const w = new THREE.CylinderGeometry(0.5, 0.5, 0.42, 14);
      w.translate(x, yy, R + 0.5);
      wh.push(w);
    }
  }
  mesh(mergeList(wh), rubber, g);
  // 破裂口（暗）
  const hole = new THREE.CircleGeometry(0.55, 10);
  deform(hole, { seed: 9, jitter: 0.08 });
  const hm = mesh(hole, new THREE.MeshBasicMaterial({ color: 0x050302 }), g);
  hm.position.set(-1.2, R + 0.4, -R - 0.02);
  hm.rotation.y = Math.PI;
  // 危險物品標示
  const plac = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.55), std({ map: TX.signTexture('易燃液體', { style: 'red', w: 256, h: 96, size: 50 }), roughness: 0.6 }));
  plac.position.set(2.6, R + 0.35, -R - 0.03);
  plac.rotation.y = Math.PI;
  plac.rotation.z = 0.08;
  g.add(plac);
  return g;
}

/** 車頭（扭曲的駕駛艙） */
export function buildTruckCab({ seed = 5 } = {}) {
  const g = new THREE.Group();
  const m = std({ map: TX.charredPaint(181), color: 0xd0c8c0, roughness: 0.85, metalness: 0.3 });
  const cab = boxG(2.3, 2.4, 2.3, 0, 1.55, 0);
  deform(cab, { seed, jitter: 0.06 });
  const nose = boxG(0.9, 1.2, 2.2, 1.55, 1.0, 0);
  deform(nose, { seed: seed + 1, jitter: 0.05 });
  mesh(mergeList([cab, nose]), m, g);
  mesh(boxG(0.05, 0.8, 1.9, 1.17, 2.15, 0), std({ color: 0x050505, roughness: 0.4 }), g);
  const w = [];
  for (const x of [-0.4, 1.6]) for (const z of [-1.0, 1.0]) { const t = new THREE.CylinderGeometry(0.5, 0.5, 0.36, 14); t.rotateX(Math.PI / 2); t.translate(x, 0.5, z); w.push(t); }
  mesh(mergeList(w), std({ color: 0x0d0d0d, roughness: 0.95 }), g);
  return g;
}

// ---------------------------------------------------------------------------
// 粒子：緩慢飄移的煙（Sprite），在生成/消失處淡入淡出，避免任何突然出現
// ---------------------------------------------------------------------------
export class SmokeField {
  /**
   * box: {min:[x,y,z], max:[x,y,z]}，vel: [x,y,z] m/s，size: [min,max]，color，opacity
   */
  constructor({ count = 20, box, vel = [0, 0.1, 0.3], size = [3, 6], color = 0x222222, opacity = 0.6, seed = 1, blending = THREE.NormalBlending, fog = true, spin = 0.05, texSeed = 101 } = {}) {
    this.group = new THREE.Group();
    this.box = box; this.vel = vel; this.opacity = opacity;
    this.items = [];
    const r = rng(seed);
    this.r = r;
    const tex = TX.smokeSprite(texSeed);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity: 0, depthWrite: false, blending, fog });
      const s = new THREE.Sprite(mat);
      const it = { s, life: r(), speed: 0.8 + r() * 0.4, size: size[0] + r() * (size[1] - size[0]), rot: r() * 6.28, spin: (r() - 0.5) * spin, p0: this._spawn() };
      s.material.rotation = it.rot;
      this.items.push(it);
      this.group.add(s);
    }
    this.baseColor = new THREE.Color(color);
  }
  _spawn() {
    const { min, max } = this.box, r = this.r;
    return [min[0] + r() * (max[0] - min[0]), min[1] + r() * (max[1] - min[1]), min[2] + r() * (max[2] - min[2])];
  }
  /** 依「生命週期」放置：p = p0 + vel × life × span；兩端淡出 */
  update(dt, t, { tint = null, opacity = 1 } = {}) {
    const span = 22;
    for (const it of this.items) {
      it.life += (dt / span) * it.speed;
      if (it.life >= 1) { it.life -= 1; it.p0 = this._spawn(); }
      const L = it.life * span;
      it.s.position.set(it.p0[0] + this.vel[0] * L, it.p0[1] + this.vel[1] * L, it.p0[2] + this.vel[2] * L);
      const sc = it.size * (0.7 + it.life * 0.6);
      it.s.scale.set(sc, sc, 1);
      it.s.material.rotation = it.rot + it.spin * L;
      const fade = clamp(it.life / 0.18) * clamp((1 - it.life) / 0.25);
      it.s.material.opacity = this.opacity * opacity * fade;
      if (tint) it.s.material.color.copy(tint);
    }
  }
}

// 緩慢起伏（≤ 振幅，週期 ≥ 0.6 秒）：多個慢正弦相加
export function slowWave(t, seed = 0, amp = 0.1) {
  return amp * (0.5 * Math.sin(t * 2.9 + seed) + 0.3 * Math.sin(t * 1.7 + seed * 2.3) + 0.2 * Math.sin(t * 4.3 + seed * 0.7));
}

/** 火焰群：數個加法混合的火焰 Sprite，以慢速正弦改變高度/寬度（無快速閃爍） */
export class FireCluster {
  constructor({ count = 6, spread = [1.5, 0.6], height = [1.2, 2.2], pos = [0, 0, 0], seed = 1, intensity = 1.6 } = {}) {
    this.group = new THREE.Group();
    this.group.position.set(pos[0], pos[1], pos[2]);
    const r = rng(seed);
    this.items = [];
    const texs = [TX.flameSprite(111), TX.flameSprite(112), TX.flameSprite(113)];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: texs[i % 3], color: new THREE.Color(intensity, intensity * 0.92, intensity * 0.85), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
      const s = new THREE.Sprite(mat);
      s.center.set(0.5, 0.02);
      const h = height[0] + r() * (height[1] - height[0]);
      const it = { s, h, w: h * (0.45 + r() * 0.2), x: (r() - 0.5) * spread[0], z: (r() - 0.5) * spread[1], ph: r() * 10, f: 0.9 + r() * 0.8 };
      s.position.set(it.x, 0, it.z);
      this.items.push(it);
      this.group.add(s);
    }
  }
  update(dt, t, calm = 1) {
    for (const it of this.items) {
      const k = 1 + slowWave(t * it.f, it.ph, 0.16 * calm);
      it.s.scale.set(it.w * (1 + slowWave(t * 0.8, it.ph + 3, 0.06 * calm)), it.h * k, 1);
      it.s.position.x = it.x + Math.sin(t * 0.7 + it.ph) * 0.06;
    }
  }
}

/** 加法混合的柔光 Sprite（燈具光暈、霧中的光） */
export function glow(color, scale, pos, { opacity = 1, fog = true } = {}) {
  const m = new THREE.SpriteMaterial({ map: TX.glowSprite(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity, fog });
  const s = new THREE.Sprite(m);
  s.scale.set(scale[0], scale[1] ?? scale[0], 1);
  s.position.set(pos[0], pos[1], pos[2]);
  return s;
}

/** 帶貼圖的平面（標誌、貼花）；decal = true 時透明、不寫深度 */
export function plane(w, h, map, { pos = [0, 0, 0], rot = [0, 0, 0], emissive = 0, decal = false, color = 0xffffff, roughness = 0.7, basic = false, opacity = 1 } = {}) {
  const mat = basic
    ? new THREE.MeshBasicMaterial({ map, color, transparent: decal || opacity < 1, opacity, depthWrite: !decal })
    : std({ map, color, roughness, transparent: decal, depthWrite: !decal, emissive: emissive ? 0xffffff : 0x000000, emissiveMap: emissive ? map : null, emissiveIntensity: emissive, polygonOffset: decal, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.rotation.set(rot[0], rot[1], rot[2]);
  return m;
}

/** 下垂的封鎖線（沿 a→b 的懸鏈線帶狀網格） */
export function tapeRibbon(a, b, { sag = 0.25, width = 0.07, segs = 16, map = null, twist = 0.2, seed = 1 } = {}) {
  const pos = [], uv = [], idx = [];
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const r = rng(seed);
  const tw = (r() - 0.5) * twist;
  for (let i = 0; i <= segs; i++) {
    const k = i / segs;
    const p = A.clone().lerp(B, k);
    p.y -= sag * 4 * k * (1 - k);
    const ang = tw * Math.sin(k * Math.PI);
    const dy = Math.cos(ang) * width / 2, dz = Math.sin(ang) * width / 2;
    pos.push(p.x, p.y + dy, p.z + dz, p.x, p.y - dy, p.z - dz);
    uv.push(k * len / 2.2, 1, k * len / 2.2, 0);
  }
  for (let i = 0; i < segs; i++) { const q = i * 2; idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const tex = map;
  return new THREE.Mesh(g, std({ map: tex, roughness: 0.6, side: THREE.DoubleSide }));
}

/** 交通錐 */
export function cone(mat, stripe) {
  const g = new THREE.Group();
  mesh(new THREE.ConeGeometry(0.17, 0.7, 12).translate(0, 0.35, 0), mat, g);
  mesh(new THREE.CylinderGeometry(0.105, 0.135, 0.12, 12, 1, true).translate(0, 0.38, 0), stripe, g);
  mesh(boxG(0.4, 0.04, 0.4, 0, 0.02, 0), mat, g);
  return g;
}
