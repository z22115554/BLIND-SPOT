// =============================================================================
// 主控室殼體：地板、牆（雙色油漆＋吸音板帶＋踢腳板＋腰線）、輕鋼架天花板（T-bar）、
// 天花板夾層、出風口、灑水頭、偵煙器、電纜架、管線、防爆門外的漆黑短廊（BLAST_STUB）、
// 以及腐化貼花（水漬/煙燻/焦痕）的配置。
// =============================================================================
import * as THREE from 'three';
import { T, subtractRects, noRaycast, ringQuad } from './kit.js';
import { scuffTexture } from './localTextures.js';

// 牆面定義：內側平面座標 p、朝內法線方向 n、沿牆座標軸 u
const WALLS = {
  north: { axis: 'z', p: -3.5, n: 1, u: 'x' },
  south: { axis: 'z', p: 3.5, n: -1, u: 'x' },
  west: { axis: 'x', p: -4, n: 1, u: 'z' },
  east: { axis: 'x', p: 4, n: -1, u: 'z' },
};
const THICK = { north: 0.25, south: 0.25, west: 0.45, east: 0.2 };

/** 牆面區塊：u0..u1、v0..v1（高度），沿朝內法線 d0..d1（以內牆面為 0，負值 = 牆內）。 */
export function wallSlab(B, key, wall, u0, u1, v0, v1, d0, d1, o = {}) {
  const W = WALLS[wall];
  const a0 = W.p + W.n * d0, a1 = W.p + W.n * d1;
  const amin = Math.min(a0, a1), amax = Math.max(a0, a1);
  if (W.axis === 'z') return B.box(key, u1 - u0, v1 - v0, amax - amin, (u0 + u1) / 2, (v0 + v1) / 2, (amin + amax) / 2, {}, o);
  return B.box(key, amax - amin, v1 - v0, u1 - u0, (amin + amax) / 2, (v0 + v1) / 2, (u0 + u1) / 2, {}, o);
}

/** 牆面上（貼著內牆面、距離 d）的平面矩陣：u、v 為牆面座標。平面法線朝房內。 */
export function wallMatrix(wall, u, v, d = 0.002, rz = 0) {
  const W = WALLS[wall];
  if (wall === 'north') return T({ x: u, y: v, z: W.p + d, rz });
  if (wall === 'south') return T({ x: u, y: v, z: W.p - d, ry: Math.PI, rz });
  if (wall === 'west') return T({ x: W.p + d, y: v, z: u, ry: Math.PI / 2, rz });
  return T({ x: W.p - d, y: v, z: u, ry: -Math.PI / 2, rz });
}

export function buildShell(room) {
  const { L, BS, mats, group } = room;
  const B = room.sb; // static batcher
  const H = L.height;

  // ---- 地板 -------------------------------------------------------------------
  const floor = new THREE.PlaneGeometry(L.maxX - L.minX, L.maxZ - L.minZ);
  floor.rotateX(-Math.PI / 2);
  B.add('floor', floor, T({ x: (L.minX + L.maxX) / 2, z: (L.minZ + L.maxZ) / 2 }));
  // 椅子下的防靜電橡膠墊
  B.rbox('chairMat', 1.5, 0.008, 1.25, 0.004, L.chair.x, 0.004, L.chair.z + 0.05);
  // 椅輪磨痕（靜態貼花）
  {
    const m = mats.make({ map: scuffTexture(), transparent: true, depthWrite: false, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, 'cr:scuff');
    const g = new THREE.PlaneGeometry(1.4, 1.2); g.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(g, m); mesh.position.set(L.chair.x, 0.0085, L.chair.z + 0.05);
    group.add(noRaycast(mesh));
  }
  // 防爆門前的黃黑警示框（地面標線）
  {
    const x0 = -3.985, x1 = -3.2, z0 = -1.42, z1 = 0.84, w = 0.1, y = 0.0012;
    const strip = (cx, cz, sx, sz) => { const g = new THREE.PlaneGeometry(sx, sz); g.rotateX(-Math.PI / 2); B.add('hazard', g, T({ x: cx, y, z: cz })); };
    strip((x0 + x1) / 2, z0 + w / 2, x1 - x0, w);
    strip((x0 + x1) / 2, z1 - w / 2, x1 - x0, w);
    strip(x1 - w / 2, (z0 + z1) / 2, w, z1 - z0 - 2 * w);
  }

  // ---- 牆體 -------------------------------------------------------------------
  const bd = L.blastDoor, sd = L.sideDoor;
  const holes = {
    north: [], south: [],
    west: [[bd.z - bd.width / 2, 0, bd.z + bd.width / 2, bd.height]],
    east: [[sd.hingeZ, 0, sd.hingeZ + sd.width, sd.height]],
  };
  const span = (w) => (WALLS[w].u === 'x' ? [L.minX - THICK.west, L.maxX + THICK.east] : [L.minZ - THICK.north, L.maxZ + THICK.south]);
  const RAIL = 1.02;
  for (const w of Object.keys(WALLS)) {
    const [u0, u1] = span(w);
    for (const [v0, v1, key] of [[0, RAIL, 'wallLower'], [RAIL, H, 'wallUpper']]) {
      for (const r of subtractRects([u0, v0, u1, v1], holes[w])) wallSlab(B, key, w, r[0], r[2], r[1], r[3], -THICK[w], 0);
    }
  }
  // 東牆外側（廊道端牆，面向 +X）用清水混凝土
  for (const r of subtractRects([L.minZ, 0, L.maxZ, H], holes.east)) {
    B.box('concrete', 0.012, r[3] - r[1], r[2] - r[0], L.maxX + THICK.east - 0.006, (r[1] + r[3]) / 2, (r[0] + r[2]) / 2);
  }

  // 踢腳板與腰線（金屬）
  const frameHoles = {
    north: [], south: [],
    west: [[bd.z - bd.width / 2 - 0.3, 0, bd.z + bd.width / 2 + 2.25, H]],
    east: [[sd.hingeZ - 0.09, 0, sd.hingeZ + sd.width + 0.09, H]],
  };
  for (const w of Object.keys(WALLS)) {
    const [u0, u1] = WALLS[w].u === 'x' ? [L.minX, L.maxX] : [L.minZ, L.maxZ];
    for (const r of subtractRects([u0, 0, u1, 0.1], frameHoles[w])) wallSlab(B, 'skirting', w, r[0], r[2], 0, 0.1, 0, 0.012);
    for (const r of subtractRects([u0, RAIL - 0.02, u1, RAIL + 0.02], frameHoles[w])) wallSlab(B, 'trim', w, r[0], r[2], RAIL - 0.02, RAIL + 0.02, 0, 0.016);
  }
  // 吸音板帶（布面板，1.2 m 模組，彼此留縫）
  const AV0 = 1.12, AV1 = 2.04;
  const acoustic = {
    south: [[-3.88, -2.7], [-2.68, -1.5], [-1.48, -0.3], [-0.28, 0.9], [2.5, 3.3], [3.32, 3.88]],
    west: [[-2.9, -1.8], [2.84, 3.44]],
    east: [[-2.78, -1.88], [-1.32, -0.18], [-0.16, 0.5], [2.6, 3.44]],
  };
  for (const [w, list] of Object.entries(acoustic)) {
    for (const [a, b] of list) {
      wallSlab(B, 'acoustic', w, a + 0.006, b - 0.006, AV0, AV1, 0.004, 0.034);
      // 鋁收邊（上下）
      wallSlab(B, 'alu', w, a, b, AV0 - 0.008, AV0, 0, 0.036);
      wallSlab(B, 'alu', w, a, b, AV1, AV1 + 0.008, 0, 0.036);
    }
  }

  // ---- 防爆門洞內襯（鋼板）與門檻 ------------------------------------------------
  {
    const z0 = bd.z - bd.width / 2, z1 = bd.z + bd.width / 2, x0 = L.minX - THICK.west, x1 = L.minX;
    B.box('frameSteel', x1 - x0, 0.012, z1 - z0, (x0 + x1) / 2, 0.006, bd.z);              // 門檻
    B.box('frameSteel', x1 - x0, bd.height, 0.01, (x0 + x1) / 2, bd.height / 2, z0 + 0.005);  // 北側內襯
    B.box('frameSteel', x1 - x0, bd.height, 0.01, (x0 + x1) / 2, bd.height / 2, z1 - 0.005);  // 南側內襯
    B.box('frameSteel', x1 - x0, 0.01, z1 - z0, (x0 + x1) / 2, bd.height - 0.005, bd.z);     // 上緣
  }
  // ---- 側門洞內襯 -------------------------------------------------------------
  {
    const z0 = sd.hingeZ, z1 = sd.hingeZ + sd.width, x0 = L.maxX, x1 = L.maxX + THICK.east;
    B.box('frameSteel', x1 - x0, 0.01, z1 - z0, (x0 + x1) / 2, 0.005, (z0 + z1) / 2);
    B.box('frameSteel', x1 - x0, sd.height, 0.012, (x0 + x1) / 2, sd.height / 2, z0 + 0.006);
    B.box('frameSteel', x1 - x0, sd.height, 0.012, (x0 + x1) / 2, sd.height / 2, z1 - 0.006);
    B.box('frameSteel', x1 - x0, 0.012, z1 - z0, (x0 + x1) / 2, sd.height - 0.006, (z0 + z1) / 2);
  }

  buildCeiling(room);
  buildServices(room);
  buildBlastStub(room);
  placeDecals(room);
}

// ---------------------------------------------------------------------------
// 輕鋼架天花板
// ---------------------------------------------------------------------------
function buildCeiling(room) {
  const { L, mats, group } = room;
  const B = room.sb;
  const H = L.height;
  const G = 0.6;
  const special = room.ceilingSpecial; // [{ix, iz, kind}]
  const isSpecial = (ix, iz) => special.some((s) => s.ix === ix && s.iz === iz);
  const xs = [], zs = [];
  for (let x = Math.ceil(L.minX / G) * G; x < L.maxX - 1e-6; x += G) xs.push(+x.toFixed(4));
  for (let z = Math.ceil(L.minZ / G) * G; z < L.maxZ - 1e-6; z += G) zs.push(+z.toFixed(4));
  const xb = [L.minX, ...xs.filter((x) => x > L.minX + 1e-6), L.maxX];
  const zb = [L.minZ, ...zs.filter((z) => z > L.minZ + 1e-6), L.maxZ];
  room.ceilingGrid = { xb, zb };
  for (let i = 0; i < xb.length - 1; i++) {
    for (let j = 0; j < zb.length - 1; j++) {
      const x0 = xb[i], x1 = xb[i + 1], z0 = zb[j], z1 = zb[j + 1];
      if (isSpecial(i, j)) continue;
      const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
      g.rotateX(Math.PI / 2);
      B.add('ceiling', g, T({ x: (x0 + x1) / 2, y: H, z: (z0 + z1) / 2 }));
    }
  }
  // T-bar 主副龍骨
  for (const x of xb.slice(1, -1)) B.box('tbar', 0.024, 0.014, L.maxZ - L.minZ, x, H - 0.007, 0);
  for (const z of zb.slice(1, -1)) B.box('tbar', L.maxX - L.minX, 0.0135, 0.024, 0, H - 0.0068, z);
  // 牆邊收邊角料
  B.box('tbar', L.maxX - L.minX, 0.014, 0.022, 0, H - 0.007, L.minZ + 0.011);
  B.box('tbar', L.maxX - L.minX, 0.014, 0.022, 0, H - 0.007, L.maxZ - 0.011);
  B.box('tbar', 0.022, 0.014, L.maxZ - L.minZ, L.minX + 0.011, H - 0.007, 0);
  B.box('tbar', 0.022, 0.014, L.maxZ - L.minZ, L.maxX - 0.011, H - 0.007, 0);

  // 特殊天花板片（焦黑時下垂/脫落；出風口那片由 services 處理）
  room.ceilingTiles = [];
  for (const s of special) {
    if (s.kind === 'vent') continue;
    const x0 = xb[s.ix], x1 = xb[s.ix + 1], z0 = zb[s.iz], z1 = zb[s.iz + 1];
    const w = x1 - x0, d = z1 - z0;
    // 以一側邊為鉸鏈
    const pivot = new THREE.Group();
    const hingeX = s.hinge === 'x0' ? x0 : s.hinge === 'x1' ? x1 : (x0 + x1) / 2;
    const hingeZ = s.hinge === 'z0' ? z0 : s.hinge === 'z1' ? z1 : (z0 + z1) / 2;
    pivot.position.set(hingeX, H - 0.004, hingeZ);
    const mat = s.kind === 'missing' ? mats.make({ map: mats.get('ceiling').map, roughness: 0.95, transparent: true, opacity: 1 }, 'cr:tileFade') : mats.get('ceiling');
    const g = new THREE.BoxGeometry(w - 0.004, 0.012, d - 0.004);
    // 世界 UV（與其他片一致）
    const uv = g.attributes.uv;
    const pos = g.attributes.position;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, ((x0 + x1) / 2 + pos.getX(k)) / 1.2, -((z0 + z1) / 2 + pos.getZ(k)) / 1.2);
    const tile = new THREE.Mesh(g, mat);
    tile.position.set((x0 + x1) / 2 - hingeX, 0.002, (z0 + z1) / 2 - hingeZ);
    pivot.add(tile);
    group.add(noRaycast(pivot));
    room.ceilingTiles.push({ pivot, tile, mat, ...s, axis: s.hinge.startsWith('x') ? 'z' : 'x', sign: s.hinge.endsWith('0') ? -1 : 1 });
  }

  // 天花板夾層（從缺口望進去只看得到漆黑的管道與樓板）
  const plenum = new THREE.Mesh(new THREE.BoxGeometry(L.maxX - L.minX, 0.7, L.maxZ - L.minZ), mats.get('plenum'));
  plenum.position.set(0, H + 0.35, 0);
  group.add(noRaycast(plenum));
  const P = room.sb;
  P.box('darkMetal', 7.6, 0.34, 0.5, 0, H + 0.42, 0.3);           // 主風管
  P.box('darkMetal', 0.5, 0.34, 6.4, -2.2, H + 0.42, 0.2);
  P.box('darkMetal', 0.12, 0.14, 7.0, 1.2, H + 0.6, 0);            // 型鋼
  P.box('darkMetal', 0.12, 0.14, 7.0, -0.6, H + 0.6, 0);
  P.cyl('cable', 0.02, 0.02, 7.6, 0, H + 0.2, -1.6, { rz: Math.PI / 2 }, 8);
  P.cyl('cable', 0.015, 0.015, 7.6, 0, H + 0.18, -1.66, { rz: Math.PI / 2 }, 8);
}

// ---------------------------------------------------------------------------
// 天花板/牆面設備：出風口、灑水頭、偵煙器、電纜架、導線管
// ---------------------------------------------------------------------------
function buildServices(room) {
  const { L, group } = room;
  const B = room.sb;
  const H = L.height;
  const { xb, zb } = room.ceilingGrid;
  // 出風口（四向方形擴散器）
  const vent = room.ceilingSpecial.find((s) => s.kind === 'vent');
  if (vent) {
    const x0 = xb[vent.ix], x1 = xb[vent.ix + 1], z0 = zb[vent.iz], z1 = zb[vent.iz + 1];
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, S = Math.min(x1 - x0, z1 - z0);
    room.ventGrillePos = new THREE.Vector3(cx, H, cz);
    // 頸部（暗）
    B.box('darkMetal', S - 0.08, 0.004, S - 0.08, cx, H + 0.28, cz);
    for (const [dx, dz, w, d] of [[0, -(S - 0.08) / 2, S - 0.08, 0.004], [0, (S - 0.08) / 2, S - 0.08, 0.004], [-(S - 0.08) / 2, 0, 0.004, S - 0.08], [(S - 0.08) / 2, 0, 0.004, S - 0.08]]) {
      B.box('darkMetal', w, 0.28, d, cx + dx, H + 0.14, cz + dz);
    }
    // 外框與同心葉片（白色烤漆）
    const ring = (size, y, slope, wdt) => {
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        const g = new THREE.BoxGeometry(size, 0.004, wdt);
        g.rotateX(slope);
        g.translate(0, 0, size / 2 - wdt / 2);
        g.rotateY(a);
        B.add('whiteEnamel', g, T({ x: cx, y, z: cz }));
      }
    };
    ring(S, H - 0.006, 0, 0.06);
    ring(S - 0.13, H + 0.01, -0.6, 0.06);
    ring(S - 0.25, H + 0.03, -0.6, 0.06);
    ring(S - 0.37, H + 0.05, -0.6, 0.06);
    B.box('whiteEnamel', 0.13, 0.004, 0.13, cx, H + 0.03, cz);
  }
  // 灑水頭
  for (const [x, z] of [[-2.1, -0.3], [2.1, 0.9], [-2.1, 2.1], [2.7, 2.7], [0.9, -2.7], [-3.3, -1.5]]) {
    B.cyl('chrome', 0.022, 0.022, 0.006, x, H - 0.003, z, {}, 12);
    B.cyl('brass', 0.006, 0.008, 0.035, x, H - 0.02, z, {}, 8);
    B.cyl('brass', 0.016, 0.016, 0.002, x, H - 0.04, z, {}, 10);
  }
  // 偵煙器
  room.smokeDetectorPos = new THREE.Vector3(-1.5, H - 0.048, 0.9);
  B.cyl('whiteEnamel', 0.065, 0.06, 0.035, -1.5, H - 0.018, 0.9, {}, 20);
  B.cyl('whiteEnamel', 0.03, 0.04, 0.012, -1.5, H - 0.041, 0.9, {}, 16);
  // 偵煙器的待機指示燈：每 4 秒緩慢亮一下（電池供電）
  room.leds.add(new THREE.Vector3(-1.5 + 0.045, H - 0.036, 0.9), new THREE.Vector3(0, -1, 0), 'red', { group: 'ups', blink: { period: 4.2, duty: 0.12, phase: 1.3 }, scale: 0.7 });

  // 北牆電纜架（梯式）
  const tray = (x0, x1, y, z0, z1, alongX = true) => {
    if (alongX) {
      const len = x1 - x0, cx = (x0 + x1) / 2;
      B.box('frameSteel', len, 0.06, 0.004, cx, y + 0.03, z0);
      B.box('frameSteel', len, 0.06, 0.004, cx, y + 0.03, z1);
      B.box('frameSteel', len, 0.008, 0.012, cx, y + 0.004, z0 + 0.006);
      B.box('frameSteel', len, 0.008, 0.012, cx, y + 0.004, z1 - 0.006);
      for (let x = x0 + 0.1; x < x1; x += 0.25) B.box('frameSteel', 0.02, 0.008, z1 - z0, x, y + 0.004, (z0 + z1) / 2);
      for (let x = x0 + 0.3; x < x1; x += 1.2) {
        B.box('frameSteel', 0.03, 0.006, Math.abs(z1 - z0) + 0.06, x, y - 0.003, (z0 + z1) / 2); // 托架
      }
    } else {
      const len = z1 - z0, cz = (z0 + z1) / 2;
      B.box('frameSteel', 0.004, 0.06, len, x0, y + 0.03, cz);
      B.box('frameSteel', 0.004, 0.06, len, x1, y + 0.03, cz);
      B.box('frameSteel', 0.012, 0.008, len, x0 + 0.006, y + 0.004, cz);
      B.box('frameSteel', 0.012, 0.008, len, x1 - 0.006, y + 0.004, cz);
      for (let z = z0 + 0.1; z < z1; z += 0.25) B.box('frameSteel', x1 - x0, 0.008, 0.02, (x0 + x1) / 2, y + 0.004, z);
      for (let z = z0 + 0.3; z < z1; z += 1.2) B.box('frameSteel', Math.abs(x1 - x0) + 0.06, 0.006, 0.03, (x0 + x1) / 2, y - 0.003, z);
    }
  };
  const TY = 2.66;
  tray(L.minX + 0.05, L.maxX - 0.05, TY, L.minZ + 0.06, L.minZ + 0.3, true);
  tray(L.maxX - 0.3, L.maxX - 0.06, TY, L.minZ + 0.32, 1.15, false);
  // 托架壁掛三角
  for (let x = L.minX + 0.35; x < L.maxX; x += 1.2) B.box('frameSteel', 0.03, 0.12, 0.26, x, TY - 0.06, L.minZ + 0.13, { rx: 0 });
  // 架上電纜束
  const cab = [[0.012, 'cable', -0.04], [0.016, 'cable', 0.0], [0.01, 'cableGrey', 0.04], [0.014, 'cable', 0.075], [0.009, 'cableGrey', -0.08], [0.011, 'cable', 0.1]];
  for (const [r, key, off] of cab) {
    B.cyl(key, r, r, L.maxX - L.minX - 0.2, 0, TY + 0.008 + r, L.minZ + 0.18 + off, { rz: Math.PI / 2 }, 8);
    B.cyl(key, r, r, 1.15 - L.minZ - 0.5, L.maxX - 0.18 + off, TY + 0.008 + r, (L.minZ + 0.5 + 1.15) / 2, { rx: Math.PI / 2 }, 8);
  }
  // 由電纜架垂下到控制台後方的線束（沿北牆）
  const drop = (x, z, key, r, yEnd = 0.95) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, TY + 0.03, L.minZ + 0.18), new THREE.Vector3(x + 0.03, TY - 0.2, L.minZ + 0.06),
      new THREE.Vector3(x + 0.01, 1.6, L.minZ + 0.05), new THREE.Vector3(x - 0.02, yEnd + 0.12, L.minZ + 0.07),
      new THREE.Vector3(x - 0.02, yEnd, z),
    ]);
    B.add(key, new THREE.TubeGeometry(curve, 24, r, 6, false), null, { uv: 1 });
  };
  for (const [x, key, r] of [[-1.25, 'cable', 0.014], [-1.2, 'cableGrey', 0.01], [-0.3, 'cable', 0.016], [-0.26, 'cable', 0.012], [0.28, 'cableGrey', 0.011], [1.22, 'cable', 0.015], [1.27, 'cable', 0.01], [2.1, 'cableGrey', 0.012]]) {
    drop(x, -3.12, key, r);
  }
  // 西牆：對講機導線管（天花板 → 對講機）＋接線盒
  const ic = L.intercom;
  B.cyl('pipe', 0.011, 0.011, H - (ic.y + 0.2), L.minX + 0.03, (H + ic.y + 0.2) / 2, ic.z + 0.06, {}, 8);
  B.box('panelGrey', 0.05, 0.1, 0.1, L.minX + 0.025, 2.45, ic.z + 0.06);
  // 東牆：通風面板導線管、電磁鎖導線管
  const vp = L.ventPanel;
  B.cyl('pipe', 0.013, 0.013, TY - (vp.y + 0.26), L.maxX - 0.03, (TY + vp.y + 0.26) / 2, vp.z + 0.12, {}, 8);
  B.cyl('pipe', 0.013, 0.013, TY - (vp.y + 0.26), L.maxX - 0.03, (TY + vp.y + 0.26) / 2, vp.z - 0.12, {}, 8);
  const sd = L.sideDoor;
  B.cyl('pipe', 0.01, 0.01, (sd.hingeZ + sd.width - 0.1) - 1.15, L.maxX - 0.03, TY - 0.03, ((sd.hingeZ + sd.width - 0.1) + 1.15) / 2, { rx: Math.PI / 2 }, 8);
  B.cyl('pipe', 0.01, 0.01, TY - 0.03 - (sd.height + 0.13), L.maxX - 0.03, (TY - 0.03 + sd.height + 0.13) / 2, sd.hingeZ + sd.width - 0.1, {}, 8);
}

// ---------------------------------------------------------------------------
// 防爆門外：漆黑短廊（只用不受光的暗色材質＋由門口往內遞減的頂點色，保證永遠漆黑；不可能出現任何人影）
// ---------------------------------------------------------------------------
function buildBlastStub(room) {
  const { BS, L, mats, group } = room;
  const x1 = L.minX - 0.45; // 牆外側
  const geoms = [];
  const box = (w, h, d, x, y, z, flip = true) => {
    const g = new THREE.BoxGeometry(w, h, d, Math.max(1, Math.round(w / 0.5)), 1, Math.max(1, Math.round(d / 0.5)));
    g.translate(x, y, z);
    geoms.push(g);
  };
  const W = BS.maxZ - BS.minZ, Hh = BS.height, cz = (BS.minZ + BS.maxZ) / 2;
  const len = x1 - BS.minX;
  const cx = (BS.minX + x1) / 2;
  box(len, 0.1, W, cx, -0.05, cz);                        // 地板
  box(len, 0.1, W, cx, Hh + 0.05, cz);                    // 天花板
  const sx0 = BS.minX + 0.4, sx1 = BS.minX + 1.5;        // 北側轉角開口
  box(sx0 - BS.minX, Hh, 0.1, (BS.minX + sx0) / 2, Hh / 2, BS.minZ - 0.05);
  box(x1 - sx1, Hh, 0.1, (sx1 + x1) / 2, Hh / 2, BS.minZ - 0.05);   // 北牆
  box(len, Hh, 0.1, cx, Hh / 2, BS.maxZ + 0.05);          // 南牆
  box(0.1, Hh, W, BS.minX - 0.05, Hh / 2, cz);            // 盡頭
  // 側口：盡頭往北轉
  box(1.1, 0.1, 1.8, BS.minX + 0.95, -0.05, BS.minZ - 0.9);
  box(1.1, 0.1, 1.8, BS.minX + 0.95, Hh + 0.05, BS.minZ - 0.9);
  box(0.1, Hh, 1.8, BS.minX + 0.35, Hh / 2, BS.minZ - 0.9);
  box(0.1, Hh, 1.8, BS.minX + 1.55, Hh / 2, BS.minZ - 0.9);
  box(1.2, Hh, 0.1, BS.minX + 0.95, Hh / 2, BS.minZ - 1.85);
  // 管線
  const pipe = new THREE.CylinderGeometry(0.06, 0.06, len, 10, 1); pipe.rotateZ(Math.PI / 2); pipe.translate(cx, Hh - 0.18, BS.maxZ - 0.18); geoms.push(pipe);
  const pipe2 = new THREE.CylinderGeometry(0.03, 0.03, len, 8, 1); pipe2.rotateZ(Math.PI / 2); pipe2.translate(cx, Hh - 0.12, BS.maxZ - 0.36); geoms.push(pipe2);
  const merged = [];
  for (const g of geoms) {
    const n = g.index ? g.toNonIndexed() : g;
    for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name);
    merged.push(n);
  }
  // 手動合併 + 依距離門口的遞減頂點色（只有門口附近極微弱地帶到一點室內光）
  let total = 0; for (const g of merged) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of merged) {
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++, o++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      pos.set([x, y, z], o * 3); nor.set([n.getX(i), n.getY(i), n.getZ(i)], o * 3);
      const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
      uv.set(ax > 0.5 ? [z / 2, y / 2] : ay > 0.5 ? [x / 2, z / 2] : [x / 2, y / 2], o * 2);
      const d = Math.max(0, x1 - x); // 距門口深度
      const k = Math.exp(-d * 1.15) * (0.75 + 0.25 * (1 - y / Hh));
      col.set([k, k, k], o * 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  let map = null;
  try { map = room.ctx.textures.get('concreteDark'); } catch (e) { map = null; }
  const mat = new THREE.MeshBasicMaterial({ map, vertexColors: true, color: 0x000000 });
  mat.name = 'cr:stub';
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'blastStub';
  group.add(mesh);
  room.stubMat = mat;
  // 門洞外側牆面（從短廊看回來的牆面，也用暗材質）
}

// ---------------------------------------------------------------------------
// 腐化貼花配置（不同門檻：每次回來都更糟）
// ---------------------------------------------------------------------------
function placeDecals(room) {
  const { L } = room;
  const D = (tex, tier, w, h, m, g = null) => room.addDecal(tex, tier, w, h, m, g);
  const H = L.height;
  const ceil = (x, z, rz = 0, dy = 0.004) => T({ x, y: H - dy, z, rx: Math.PI / 2, rz });
  const floorM = (x, z, rz = 0) => T({ x, y: 0.0016, z, rx: -Math.PI / 2, rz });
  const bd = L.blastDoor;

  // 水漬：牆角、天花板邊緣
  D('waterStain', 0, 1.1, 1.0, wallMatrix('north', -3.45, 2.5, 0.003));
  D('waterStain', 0, 1.3, 1.1, ceil(-3.3, 2.85, 0.6));
  D('waterStain', 0, 0.9, 0.8, wallMatrix('east', -2.35, 2.62, 0.003, 0.3));
  D('waterStain', 1, 1.5, 1.3, wallMatrix('south', 2.9, 2.4, 0.003, Math.PI));
  D('waterStain', 1, 1.0, 1.2, wallMatrix('west', -2.4, 2.4, 0.003, -0.4));
  D('waterStain', 1, 0.95, 0.95, ceil(1.2, 1.05, 2.1));
  D('waterStain', 1, 0.7, 1.6, wallMatrix('north', 3.62, 2.05, 0.003));
  D('waterStain', 2, 1.3, 1.3, wallMatrix('north', 1.45, 2.42, 0.003, 1.2));
  D('waterStain', 2, 1.5, 1.4, ceil(-2.0, -2.6, 4.0));
  D('waterStain', 2, 1.0, 1.0, wallMatrix('east', 3.05, 2.5, 0.003, 2.2));
  D('waterStain', 2, 0.9, 0.7, wallMatrix('west', 3.25, 0.5, 0.003));
  D('waterStain', 2, 1.6, 1.6, ceil(2.6, -2.9, 1.0));
  D('waterStain', 3, 2.0, 1.7, ceil(-1.15, 0.4, 0.4));
  D('waterStain', 3, 0.9, 2.9, wallMatrix('south', -3.62, 1.5, 0.003));
  D('waterStain', 3, 1.0, 2.6, wallMatrix('north', -3.7, 1.35, 0.0035));
  D('waterStain', 3, 1.3, 0.9, floorM(-3.3, 2.4, 0.5));
  D('waterStain', 3, 1.7, 1.2, ceil(1.4, 2.6, 2.6));

  // 煙燻：出風口周圍、防爆門上方、燈具周圍
  const vg = room.ventGrillePos || new THREE.Vector3(0.3, H, 0.3);
  D('soot', 1, 1.9, 1.9, ceil(vg.x, vg.z, 0, 0.005), ringQuad(1.9, 1.9, 0.62, 0.62));
  D('soot', 1, 2.3, 0.75, wallMatrix('west', bd.z, 2.66, 0.004));
  D('soot', 2, 1.5, 2.4, ceil(-3.35, bd.z, 1.57, 0.005));
  for (const f of L.fluorescents) D('soot', 2, 1.9, 0.85, ceil(f.x, f.z, 0, 0.006), ringQuad(1.9, 0.85, 1.27, 0.31));
  D('soot', 2, 0.9, 0.8, wallMatrix('north', 0, 2.55, 0.0045));
  D('soot', 3, 3.2, 0.9, wallMatrix('north', 0.2, 2.62, 0.005));
  D('soot', 3, 2.7, 2.7, ceil(vg.x, vg.z, Math.PI / 2, 0.007), ringQuad(2.7, 2.7, 0.62, 0.62));
  D('soot', 3, 1.6, 0.9, wallMatrix('east', -0.6, 2.62, 0.004));
  D('soot', 3, 1.4, 0.8, wallMatrix('south', -0.4, 2.65, 0.004));

  // 焦痕：CRT 外殼、控制台
  const ms = L.mainScreen;
  D('scorch', 1, 0.22, 0.06, T({ x: ms.x - 0.27, y: ms.y + 0.345, z: -2.5115, rz: 0.06 }));
  D('scorch', 1, 0.5, 0.07, T({ x: -1.1, y: 0.698, z: -2.2375 }));
  D('scorch', 2, 0.42, 0.32, T({ x: -2.3, y: 0.7812, z: -2.6, rx: -Math.PI / 2, rz: 0.8 }));
  D('scorch', 2, 0.5, 0.62, wallMatrix('west', L.intercom.z, L.intercom.y + 0.05, 0.004));
  D('scorch', 2, 0.06, 0.3, T({ x: ms.x + 0.405, y: ms.y + 0.08, z: -2.5115 }));
  for (const s of L.sideScreens) {
    const m = T({ x: s.x, y: s.y, z: s.z, ry: s.yaw }).multiply(T({ x: -s.w / 2 + 0.04, y: s.h / 2 + 0.028, z: 0.0255, rz: 0.08 }));
    D('scorch', 2, 0.13, 0.04, m);
  }
  D('scorch', 3, 0.8, 0.07, T({ x: 0.4, y: 0.698, z: -2.2375 }));
  D('scorch', 3, 1.1, 1.7, floorM(-3.45, bd.z, 1.57));
  D('scorch', 3, 0.5, 0.35, T({ x: 1.62, y: 0.7812, z: -2.6, rx: -Math.PI / 2, rz: 2.0 }));
  D('scorch', 3, 0.34, 0.07, T({ x: ms.x + 0.1, y: ms.y + 0.345, z: -2.5113, rz: Math.PI }));
}
