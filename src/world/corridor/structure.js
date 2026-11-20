// =============================================================================
// 地下公務維修廊道（主廊道＋轉角短廊＋電閘室外殼）的靜態結構與道具。
// 靜態幾何依「材質 × 區段」合併（Batch），只剩少量 draw call；
// 需要個別控制的東西（燈罩、標誌、玻璃）各自獨立。
// =============================================================================
import * as THREE from 'three';
import { box, boxC, tube, elbow, ring, xform, Batch, paramSurface, GeoBuilder, quadGeo } from './geo.js';
import * as TX from './tex.js';

const PI = Math.PI;

/** 共用的幾何尺度（全部由 LAYOUT 推導）。 */
export function corridorDims(LAYOUT) {
  const C = LAYOUT.CORRIDOR, S = LAYOUT.SWITCH_ROOM;
  const M = C.main;
  const sd = LAYOUT.CONTROL_ROOM.sideDoor;
  const d = {
    C, S, M, leg: C.leg, H: M.height,
    x0: M.minX + 0.015,               // 西端牆面（略內縮，避免與主控室外牆 z-fight）
    x1: M.maxX,                       // 東端牆面
    zN: M.minZ, zS: M.maxZ,           // 北牆 / 南牆
    wallT: 0.25,
    ditch: { z0: C.ditch.z - C.ditch.width / 2, z1: C.ditch.z + C.ditch.width / 2, depth: 0.25, x0: M.minX + 0.4, x1: C.leg.minX - 0.1 },
    ribs: [], fixtures: [],
    door: C.fireDoor,
    side: { z0: sd.z - sd.width / 2, z1: sd.z + sd.width / 2, h: sd.height },
    srDoor: { x0: (C.leg.minX + C.leg.maxX) / 2 - 0.6, x1: (C.leg.minX + C.leg.maxX) / 2 + 0.6, h: 2.1, z: C.leg.maxZ },
  };
  for (let x = M.minX + 1.8; x < C.leg.minX; x += 4) d.ribs.push(+x.toFixed(2));          // 6, 10, … 38
  for (let x = M.minX + 3.8; x < C.leg.minX; x += 4) d.fixtures.push(+x.toFixed(2));     // 8, 12, … 36
  return d;
}

/**
 * 建立廊道結構。回傳 { fixtures:[{mesh,mat,x,z,dead,…}], obstacles:[], glass, exitSign, decals… }
 */
export function buildStructure(ctx, root, mats, d) {
  const T = ctx.textures;
  const out = { fixtures: [], obstacles: [], cathodes: [], signs: [] };
  const B = new Batch({ chunk: 12, origin: 4 });
  const SB = { B, mat: mats.metalDark };
  const { H, x0, x1, zN, zS, ditch, door: fd } = d;
  const leg = d.leg, S = d.S;
  const pipeCol = {
    fire: new THREE.Color(0xc4473a), gray: new THREE.Color(0xb2b6b0), conduit: new THREE.Color(0x707571),
    water: new THREE.Color(0x8fa093), valve: new THREE.Color(0xb3281f), dark: new THREE.Color(0x4a4d4b),
  };
  const P = (g, col, o) => B.add(mats.pipe, g, { color: col, ...o });

  // ===========================================================================
  // 1. 外殼：牆、地、天花
  // ===========================================================================
  const fx0 = fd.x - fd.width / 2, fx1 = fd.x + fd.width / 2;           // 防火門洞 19.4 .. 20.6
  // 北牆（室內面 pz），門洞處切開
  B.add(mats.wall, box(x0, fx0, 0, H, zN - d.wallT, zN, { faces: 'pz' }));
  B.add(mats.wall, box(fx1, x1, 0, H, zN - d.wallT, zN, { faces: 'pz' }));
  B.add(mats.wall, box(fx0, fx1, fd.height, H, zN - d.wallT, zN, { faces: 'pz ny' }));
  // 南牆（室內面 nz），到轉角為止
  B.add(mats.wall, box(x0, leg.minX, 0, H, zS, zS + d.wallT, { faces: 'nz' }));
  // 東端牆（同時是轉角短廊東牆）
  B.add(mats.wall, box(x1, x1 + d.wallT, 0, H, zN, leg.maxZ - 0.25, { faces: 'nx' }));
  // 短廊西牆
  B.add(mats.wall, box(leg.minX - d.wallT, leg.minX, 0, H, zS, leg.maxZ - 0.25, { faces: 'px' }));
  // 西端牆（側門洞 z 1.41..2.39、高 2.09；含門洞側面）
  const sz0 = d.side.z0 + 0.01, sz1 = d.side.z1 - 0.01, sh = d.side.h - 0.01;
  B.add(mats.wall, box(4.02, x0, 0, H, zN, sz0, { faces: 'px pz' }));
  B.add(mats.wall, box(4.02, x0, 0, H, sz1, zS, { faces: 'px nz' }));
  B.add(mats.wall, box(4.02, x0, sh, H, sz0, sz1, { faces: 'px ny' }));

  // 地面：主廊道（避開排水溝）
  B.add(mats.floor, box(x0, x1, -0.1, 0, zN, ditch.z0, { faces: 'py' }));
  B.add(mats.floor, box(x0, x1, -0.1, 0, ditch.z1, zS, { faces: 'py' }));
  B.add(mats.floor, box(x0, ditch.x0, -0.1, 0, ditch.z0, ditch.z1, { faces: 'py' }));
  B.add(mats.floor, box(ditch.x1, x1, -0.1, 0, ditch.z0, ditch.z1, { faces: 'py' }));
  B.add(mats.floor, box(leg.minX, leg.maxX, -0.1, 0, zS, leg.maxZ, { faces: 'py' }));
  B.add(mats.floor, box(d.srDoor.x0, d.srDoor.x1, -0.1, 0, leg.maxZ - 0.25, leg.maxZ, { faces: 'py' }));
  // 門檻鋼板
  B.add(mats.steel, box(4.0, x0 + 0.03, 0, 0.006, sz0, sz1));
  // 天花
  B.add(mats.ceil, box(x0, x1, H, H + 0.1, zN, zS, { faces: 'ny' }));
  B.add(mats.ceil, box(leg.minX, leg.maxX, H, H + 0.1, zS, leg.maxZ - 0.25, { faces: 'ny' }));

  // 電閘室外殼（高 2.6）
  const SH = S.height;
  const dx0 = d.srDoor.x0, dx1 = d.srDoor.x1, dz = leg.maxZ;
  B.add(mats.wallSR, box(S.minX, dx0, 0, SH, dz - 0.25, dz, { faces: 'pz nz' }));
  B.add(mats.wallSR, box(dx1, S.maxX, 0, SH, dz - 0.25, dz, { faces: 'pz nz' }));
  B.add(mats.wallSR, box(dx0, dx1, d.srDoor.h, SH, dz - 0.25, dz, { faces: 'pz nz ny' }));
  B.add(mats.wallSR, box(dx0 - 0.0, dx0, 0, d.srDoor.h, dz - 0.25, dz, { faces: 'px' }));
  B.add(mats.wallSR, box(dx1, dx1, 0, d.srDoor.h, dz - 0.25, dz, { faces: 'nx' }));
  B.add(mats.wallSR, box(S.minX, S.maxX, 0, SH, S.maxZ, S.maxZ + 0.25, { faces: 'nz' }));
  B.add(mats.wallSR, box(S.minX - 0.25, S.minX, 0, SH, S.minZ, S.maxZ, { faces: 'px' }));
  B.add(mats.wallSR, box(S.maxX, S.maxX + 0.25, 0, SH, S.minZ, S.maxZ, { faces: 'nx' }));
  B.add(mats.srFloor, box(S.minX, S.maxX, -0.1, 0, S.minZ, S.maxZ, { faces: 'py' }));
  B.add(mats.ceil, box(S.minX, S.maxX, SH, SH + 0.1, S.minZ, S.maxZ, { faces: 'ny' }));
  // 踢腳（深色）
  for (const [a, b, c, e, f] of [[S.minX, S.maxX, S.maxZ - 0.012, S.maxZ, 'nz'], [S.minX, dx0, S.minZ, S.minZ + 0.012, 'pz'], [dx1, S.maxX, S.minZ, S.minZ + 0.012, 'pz']]) {
    B.add(mats.metalDark, box(a, b, 0, 0.1, c, e, { faces: `${f} py` }));
  }
  B.add(mats.metalDark, box(S.minX, S.minX + 0.012, 0, 0.1, S.minZ, S.maxZ, { faces: 'px py' }));
  B.add(mats.metalDark, box(S.maxX - 0.012, S.maxX, 0, 0.1, S.minZ, S.maxZ, { faces: 'nx py' }));

  // ===========================================================================
  // 2. 排水溝（溝槽、積水、格柵）
  // ===========================================================================
  const dz0 = ditch.z0, dz1 = ditch.z1, dd = ditch.depth;
  B.add(mats.ditch, box(ditch.x0, ditch.x1, -dd, 0, dz0, dz0 + 0.001, { faces: 'pz' }));
  B.add(mats.ditch, box(ditch.x0, ditch.x1, -dd, 0, dz1 - 0.001, dz1, { faces: 'nz' }));
  B.add(mats.ditch, box(ditch.x0, ditch.x1, -dd - 0.01, -dd, dz0, dz1, { faces: 'py' }));
  B.add(mats.ditch, box(ditch.x0, ditch.x0 + 0.001, -dd, 0, dz0, dz1, { faces: 'px' }));
  B.add(mats.ditch, box(ditch.x1 - 0.001, ditch.x1, -dd, 0, dz0, dz1, { faces: 'nx' }));
  B.add(mats.water, box(ditch.x0, ditch.x1, -dd, -0.19, dz0, dz1, { faces: 'py' }), { cast: false });
  {
    const gb = new GeoBuilder(); const gy = -0.004;
    // 格柵：u 沿 x（承載扁鋼間距）、v 橫跨溝寬
    gb.quad([ditch.x0, gy, dz1], [ditch.x1, gy, dz1], [ditch.x1, gy, dz0], [ditch.x0, gy, dz0], [0, 1, 0],
      [ditch.x0, 0], [ditch.x1, 0], [ditch.x1, dz1 - dz0], [ditch.x0, dz1 - dz0]);
    B.add(mats.grate, gb.build(), { cast: false });
  }
  // 格柵框（角鋼）與每 1 m 的接縫
  B.add(mats.metalDark, box(ditch.x0, ditch.x1, -0.03, 0.002, dz0 - 0.012, dz0 + 0.008, { faces: 'py pz' }));
  B.add(mats.metalDark, box(ditch.x0, ditch.x1, -0.03, 0.002, dz1 - 0.008, dz1 + 0.012, { faces: 'py nz' }));
  for (let x = ditch.x0 + 1; x < ditch.x1; x += 1.0) B.add(mats.metalDark, box(x - 0.008, x + 0.008, -0.03, -0.001, dz0, dz1, { faces: 'py px nx' }));

  // ===========================================================================
  // 3. 混凝土肋柱（壁柱＋天花樑）
  // ===========================================================================
  for (const xr of d.ribs) {
    const a = xr - 0.15, b = xr + 0.15;
    B.add(mats.wall, box(a, b, 0, H, zN, zN + 0.1, { faces: 'px nx pz' }));
    B.add(mats.wall, box(a, b, -dd, H, zS - 0.1, zS, { faces: 'px nx nz' }));
    B.add(mats.ceil, box(a, b, H - 0.12, H, zN + 0.1, zS - 0.1, { faces: 'px nx ny' }));
  }
  // 轉角短廊每 2.4 m 一道樑
  for (const zr of [4.4, 6.6]) B.add(mats.ceil, box(leg.minX, leg.maxX, H - 0.12, H, zr - 0.15, zr + 0.15, { faces: 'pz nz ny' }));

  // ===========================================================================
  // 4. 管線
  // ===========================================================================
  // (a) 消防主管（北側天花，r = 0.08），西端穿牆、東端彎上天花
  const fz = 1.62, fy = 2.24, fr = 0.08;
  P(tube([x0, fy, fz], [38.8, fy, fz], fr, { segs: 16, vLen: 2.2 }), pipeCol.fire);
  { const e = elbow([38.8, fy, fz], [1, 0, 0], [0, 1, 0], 0.2, fr, { segs: 16 }); P(e.geo, pipeCol.fire); P(tube(e.end, [e.end[0], H, fz], fr, { segs: 16 }), pipeCol.fire); }
  P(ring([x0 + 0.01, fy, fz], [1, 0, 0], fr + 0.035, 0.02), pipeCol.dark);
  for (let x = 7.1; x < 38; x += 6) P(ring([x, fy, fz], [1, 0, 0], fr + 0.028, 0.03, 16), pipeCol.fire);
  // 閘閥＋紅色手輪（伸向走道）
  {
    const vx = 23.6;
    P(ring([vx, fy, fz], [1, 0, 0], fr + 0.03, 0.22, 16), pipeCol.fire);
    P(ring([vx - 0.12, fy, fz], [1, 0, 0], fr + 0.04, 0.03, 16), pipeCol.dark);
    P(ring([vx + 0.12, fy, fz], [1, 0, 0], fr + 0.04, 0.03, 16), pipeCol.dark);
    P(tube([vx, fy, fz], [vx, fy, fz + 0.24], 0.036, { segs: 12 }), pipeCol.fire);
    P(tube([vx, fy, fz + 0.24], [vx, fy, fz + 0.33], 0.011, { segs: 8 }), pipeCol.dark);
    const wheel = new THREE.TorusGeometry(0.085, 0.009, 8, 28); xform(wheel, { pos: [vx, fy, fz + 0.31] });
    P(wheel, pipeCol.valve);
    for (let k = 0; k < 4; k++) {
      const a = k * PI / 2 + 0.3;
      P(tube([vx, fy, fz + 0.31], [vx + Math.cos(a) * 0.085, fy + Math.sin(a) * 0.085, fz + 0.31], 0.006, { segs: 6 }), pipeCol.valve);
    }
  }
  // (b) 灰色排水/送風管（r = 0.055）→ 轉角後往南進入電閘室
  const gz = 2.25, gy = 2.27, gr = 0.055;
  P(tube([x0, gy, gz], [39.35, gy, gz], gr, { segs: 14 }), pipeCol.gray);
  { const e = elbow([39.35, gy, gz], [1, 0, 0], [0, 0, 1], 0.2, gr, { segs: 14 }); P(e.geo, pipeCol.gray); P(tube(e.end, [e.end[0], gy, leg.maxZ - 0.25], gr, { segs: 14 }), pipeCol.gray); }
  P(ring([x0 + 0.01, gy, gz], [1, 0, 0], gr + 0.03, 0.02), pipeCol.dark);
  for (let x = 9.0; x < 38; x += 6) P(ring([x, gy, gz], [1, 0, 0], gr + 0.012, 0.05), pipeCol.gray);
  // 吊架（每道樑）：吊桿＋管箍
  const hanger = (x, y, z, r, top) => {
    P(tube([x, y + r, z], [x, top, z], 0.0055, { segs: 6 }), pipeCol.dark);
    const t = new THREE.TorusGeometry(r + 0.006, 0.0045, 6, 20); xform(t, { pos: [x, y, z], rot: [0, PI / 2, 0] }); P(t, pipeCol.dark);
  };
  for (const xr of d.ribs) { hanger(xr, fy, fz, fr, H - 0.12); hanger(xr, gy, gz, gr, H - 0.12); }
  for (const zr of [3.6, 5.5, 7.2]) {
    const t = new THREE.TorusGeometry(gr + 0.006, 0.0045, 6, 20); xform(t, { pos: [39.55, gy, zr] }); P(t, pipeCol.dark);
    P(tube([39.55, gy + gr, zr], [39.55, H, zr], 0.0055, { segs: 6 }), pipeCol.dark);
  }
  // (c) 南牆導線管（3 條，r = 0.016），貼在壁柱面前方
  const cz = zS - 0.12, cys = [1.8, 1.85, 1.9];
  for (const y of cys) {
    P(tube([x0, y, cz], [38.2, y, cz], 0.016, { segs: 8, vLen: 1 }), pipeCol.conduit);
    const e = elbow([38.2, y, cz], [1, 0, 0], [0, 1, 0], 0.06, 0.016, { segs: 8, tubular: 6 });
    P(e.geo, pipeCol.conduit); P(tube(e.end, [e.end[0], 2.03, cz], 0.016, { segs: 8 }), pipeCol.conduit);
  }
  for (let x = d.ribs[0]; x < 38.2; x += 2) {
    const onRib = Math.abs(((x - d.ribs[0]) % 4)) < 0.01;
    // 槽鋼支架（立在壁柱面或用托架伸出牆面）
    B.add(mats.metalDark, box(x - 0.02, x + 0.02, 1.75, 1.95, cz + 0.02, onRib ? zS - 0.1 : zS, { faces: 'px nx nz py ny' }));
    for (const y of cys) { const t = new THREE.TorusGeometry(0.019, 0.003, 4, 12); xform(t, { pos: [x, y, cz], rot: [0, PI / 2, 0] }); P(t, pipeCol.dark); }
  }
  // (d) 北牆低處水管（r = 0.028）：在防火門前潛入地板、門後再冒出
  const wy = 0.32, wz = zN + 0.14, wr = 0.028;
  const wA = fx0 - 0.55, wB = fx1 + 0.55;
  P(tube([x0, wy, wz], [wA - 0.12, wy, wz], wr, { segs: 10 }), pipeCol.water);
  { const e = elbow([wA - 0.12, wy, wz], [1, 0, 0], [0, -1, 0], 0.12, wr, { segs: 10 }); P(e.geo, pipeCol.water); P(tube(e.end, [e.end[0], -0.02, wz], wr, { segs: 10 }), pipeCol.water); }
  P(tube([wB, -0.02, wz], [wB, wy - 0.12, wz], wr, { segs: 10 }), pipeCol.water);
  { const e2 = elbow([wB, wy - 0.12, wz], [0, 1, 0], [1, 0, 0], 0.12, wr, { segs: 10 }); P(e2.geo, pipeCol.water); P(tube(e2.end, [x1, wy, wz], wr, { segs: 10 }), pipeCol.water); }
  P(ring([wA - 0.12 + 0.12, 0.002, wz], [0, 1, 0], wr + 0.03, 0.012), pipeCol.dark);
  P(ring([wB, 0.002, wz], [0, 1, 0], wr + 0.03, 0.012), pipeCol.dark);
  for (let x = d.ribs[0] + 2; x < x1; x += 2) {
    if (x > wA - 0.3 && x < wB + 0.3) continue;
    const onRib = d.ribs.some((r) => Math.abs(r - x) < 0.01);
    B.add(mats.metalDark, box(x - 0.015, x + 0.015, wy - 0.04, wy - wr, onRib ? zN + 0.1 : zN, wz + 0.03, { faces: 'px nx py ny pz' }));
    const t = new THREE.TorusGeometry(wr + 0.004, 0.003, 4, 14); xform(t, { pos: [x, wy, wz], rot: [0, PI / 2, 0] }); P(t, pipeCol.dark);
  }

  // ===========================================================================
  // 5. 電纜架（南牆上緣 → 轉角往南）
  // ===========================================================================
  const ty0 = 2.03, ty1 = 2.1, tz0 = zS - 0.44, tz1 = zS - 0.14;     // 2.36 .. 2.66
  const tEnd = leg.minX + 0.34;                                          // 38.74
  const rail = (a, b) => B.add(mats.tray, a, b);
  rail(box(4.6, tEnd, ty0, ty1, tz0, tz0 + 0.008));
  rail(box(4.6, leg.minX + 0.04, ty0, ty1, tz1 - 0.008, tz1));
  rail(box(leg.minX + 0.04, leg.minX + 0.048, ty0, ty1, tz1, leg.maxZ - 0.25));
  rail(box(tEnd - 0.008, tEnd, ty0, ty1, tz0, leg.maxZ - 0.25));
  for (let x = 4.75; x < tEnd - 0.1; x += 0.3) rail(box(x - 0.012, x + 0.012, ty0, ty0 + 0.012, tz0, tz1, { faces: 'py px nx ny' }));
  for (let z = tz1 + 0.15; z < leg.maxZ - 0.3; z += 0.3) rail(box(leg.minX + 0.04, tEnd, ty0, ty0 + 0.012, z - 0.012, z + 0.012, { faces: 'py pz nz ny' }));
  // 托架
  for (const xr of d.ribs) B.add(mats.metalDark, box(xr - 0.02, xr + 0.02, ty0 - 0.045, ty0, tz0 - 0.02, zS - 0.1, { faces: 'px nx ny pz' }));
  for (const zr of [3.6, 5.2, 6.8]) B.add(mats.metalDark, box(leg.minX, tEnd + 0.02, ty0 - 0.045, ty0, zr - 0.02, zr + 0.02, { faces: 'pz nz ny nx' }));
  // 纜線：沿電纜架、在轉角平順轉向南
  const cableR = [0.016, 0.011, 0.019, 0.013, 0.015];
  cableR.forEach((r, i) => {
    const off = 0.04 + i * 0.055;                  // 距電纜架內側
    const zc = tz0 + off, xc = leg.minX + 0.048 + (0.3 - off) + 0.0;
    const y = ty0 + 0.013 + r + (i % 2) * 0.006;
    const path = new THREE.CurvePath();
    const turn = xc - 0.35;
    path.add(new THREE.LineCurve3(new THREE.Vector3(4.6, y, zc), new THREE.Vector3(turn, y, zc)));
    path.add(new THREE.QuadraticBezierCurve3(new THREE.Vector3(turn, y, zc), new THREE.Vector3(xc, y, zc), new THREE.Vector3(xc, y, zc + 0.35)));
    path.add(new THREE.LineCurve3(new THREE.Vector3(xc, y, zc + 0.35), new THREE.Vector3(xc, y, leg.maxZ - 0.25)));
    const g = new THREE.TubeGeometry(path, 260, r, 6, false);
    B.add(mats.cable, g, { tag: 'cable' });
  });

  // ===========================================================================
  // 6. 日光燈具（每 4 m，固定在天花中線）
  // ===========================================================================
  const diffTex = TX.diffuserTexture(5);
  const diffGeoX = halfCylinder(1.2, 0.05);
  const deadSet = new Set([d.fixtures[2], d.fixtures[5]]);                // x = 16, 28
  const addFixture = (x, z, alongZ, y, dead, hangOpen = false) => {
    const L = 1.25, w = 0.13;
    const hx = alongZ ? w : L, hz = alongZ ? L : w;
    B.add(mats.fixture, boxC(x, y + 0.035, z, hx, 0.07, hz));
    // 吊桿
    for (const s of [-0.45, 0.45]) {
      const px = alongZ ? x : x + s, pz = alongZ ? z + s : z;
      P(tube([px, y + 0.07, pz], [px, y + 0.2, pz], 0.006, { segs: 6 }), pipeCol.dark);
    }
    const mat = new THREE.MeshStandardMaterial({
      color: 0xdedfd8, map: diffTex, roughness: 0.45, metalness: 0, side: THREE.DoubleSide,
      emissive: new THREE.Color(0xdfe9ff), emissiveIntensity: 0, emissiveMap: diffTex,
    });
    mat.name = 'fixtureDiffuser';
    const mesh = new THREE.Mesh(diffGeoX, mat);
    mesh.position.set(x, y, z);
    if (alongZ) mesh.rotation.y = PI / 2;
    if (hangOpen) {
      // 燈罩一側脫落、斜掛著，露出裡面的燈管
      mesh.geometry = diffGeoX.clone().translate(0, 0, -0.05);
      mesh.position.z = z + 0.05 * (alongZ ? 0 : 1);
      mesh.rotation.x = -0.75;
      for (const tz of [-0.025, 0.025]) {
        const tubeG = tube([x - 0.58, y + 0.012, z + tz], [x + 0.58, y + 0.012, z + tz], 0.013, { segs: 10, caps: true });
        B.add(mats.tubeGlass, tubeG, { cast: false });
        for (const ex of [x - 0.56, x + 0.56]) B.add(mats.black, ring([ex, y + 0.012, z + tz], [1, 0, 0], 0.0135, 0.03, 10), { cast: false });
      }
      // 壞掉燈管兩端的陰極微光（只有復電後、而且是穩定的暗橘色）
      const cm = new THREE.MeshBasicMaterial({ color: 0xff8a3a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      for (const ex of [x - 0.56, x + 0.56]) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 8), cm);
        s.position.set(ex, y + 0.012, z + 0.025); s.scale.set(1.6, 0.8, 0.8); root.add(s);
      }
      out.cathodes.push(cm);
    }
    mesh.castShadow = false; mesh.receiveShadow = false;
    root.add(mesh);
    out.fixtures.push({ mesh, mat, x, z, dead, zone: x > leg.minX - 0.5 || z > zS ? (z > S.minZ ? 'switch' : 'leg') : 'main' });
  };
  for (const x of d.fixtures) addFixture(x, (zN + zS) / 2, false, 2.305, deadSet.has(x), x === d.fixtures[5]);
  addFixture((leg.minX + leg.maxX) / 2, 5.5, true, 2.305, false);
  addFixture(37.9, 10.6, true, 2.405, false);
  addFixture(40.5, 10.6, true, 2.405, false);

  // ===========================================================================
  // 7. 西端：側門的廊道側門框、門牌
  // ===========================================================================
  B.add(mats.frame, box(x0, x0 + 0.025, 0, sh + 0.06, sz0 - 0.06, sz0, { faces: 'px pz nz py' }));
  B.add(mats.frame, box(x0, x0 + 0.025, 0, sh + 0.06, sz1, sz1 + 0.06, { faces: 'px pz nz py' }));
  B.add(mats.frame, box(x0, x0 + 0.025, sh, sh + 0.06, sz0 - 0.06, sz1 + 0.06, { faces: 'px py ny' }));
  // 門洞內側包框（4.02 .. x0）
  B.add(mats.frame, box(4.02, x0, 0, sh, sz0, sz0 + 0.004, { faces: 'pz' }));
  B.add(mats.frame, box(4.02, x0, 0, sh, sz1 - 0.004, sz1, { faces: 'nz' }));
  B.add(mats.frame, box(4.02, x0, sh - 0.004, sh, sz0, sz1, { faces: 'ny' }));
  addSign(root, T.createSign('中央控制室', { sub: 'CENTRAL CONTROL', style: 'plate', w: 512, h: 160 }),
    [x0 + 0.65, 1.62, zS - 0.004], 0.4, 0.125, [0, PI, 0], out, { rough: 0.45, metal: 0.6 }, SB);

  // ===========================================================================
  // 8. 防火門（北牆 x = 20）：門框、門扇（開窗）、五金、標示
  // ===========================================================================
  const fdz = zN;
  const g = fd.glass, gx0 = fd.x - g.w / 2, gx1 = fd.x + g.w / 2, gy0 = g.y - g.h / 2, gy1 = g.y + g.h / 2;
  // 門框（廊道面）
  // （框料往門洞內多蓋 3 cm，蓋住門扇與門洞內襯之間的縫，避免從縫裡看到車道）
  B.add(mats.frame, box(fx0 - 0.06, fx0 + 0.03, 0, fd.height + 0.06, fdz, fdz + 0.035, { faces: 'pz px nx py' }));
  B.add(mats.frame, box(fx1 - 0.03, fx1 + 0.06, 0, fd.height + 0.06, fdz, fdz + 0.035, { faces: 'pz px nx py' }));
  B.add(mats.frame, box(fx0 - 0.06, fx1 + 0.06, fd.height - 0.03, fd.height + 0.06, fdz, fdz + 0.035, { faces: 'pz py ny' }));
  B.add(mats.steel, box(fx0, fx1, 0, 0.012, fdz - d.wallT, fdz + 0.01, { faces: 'py pz' }));   // 門檻
  // 門洞內襯（牆厚）
  B.add(mats.frame, box(fx0, fx0 + 0.03, 0, fd.height, fdz - d.wallT, fdz, { faces: 'px' }));
  B.add(mats.frame, box(fx1 - 0.03, fx1, 0, fd.height, fdz - d.wallT, fdz, { faces: 'nx' }));
  B.add(mats.frame, box(fx0, fx1, fd.height - 0.03, fd.height, fdz - d.wallT, fdz, { faces: 'ny' }));
  // 門扇（中間挖窗）
  const lx0 = fx0 + 0.03, lx1 = fx1 - 0.03, lz0 = fdz - 0.1, lz1 = fdz - 0.045;
  const leafParts = [
    box(lx0, gx0, 0.01, fd.height - 0.03, lz0, lz1, { faces: 'pz nz nx' }),
    box(gx1, lx1, 0.01, fd.height - 0.03, lz0, lz1, { faces: 'pz nz px' }),
    box(gx0, gx1, 0.01, gy0, lz0, lz1, { faces: 'pz nz py' }),
    box(gx0, gx1, gy1, fd.height - 0.03, lz0, lz1, { faces: 'pz nz ny py' }),
  ];
  for (const p of leafParts) B.add(mats.door, p);
  B.add(mats.door, box(lx0, lx1, fd.height - 0.031, fd.height - 0.03, lz0, lz1, { faces: 'py' }));
  // 窗框壓條（兩面）
  for (const [zA, zB] of [[lz1, lz1 + 0.016], [lz0 - 0.016, lz0]]) {
    B.add(mats.frame, box(gx0 - 0.03, gx0, gy0 - 0.03, gy1 + 0.03, zA, zB));
    B.add(mats.frame, box(gx1, gx1 + 0.03, gy0 - 0.03, gy1 + 0.03, zA, zB));
    B.add(mats.frame, box(gx0, gx1, gy0 - 0.03, gy0, zA, zB));
    B.add(mats.frame, box(gx0, gx1, gy1, gy1 + 0.03, zA, zB));
  }
  // 踢板、鉸鏈、把手、閉門器
  B.add(mats.steel, box(lx0 + 0.02, lx1 - 0.02, 0.03, 0.28, lz1, lz1 + 0.003, { faces: 'pz py' }));
  for (const hy of [0.28, 1.05, 1.82]) P(tube([lx0 - 0.005, hy - 0.06, lz1 + 0.005], [lx0 - 0.005, hy + 0.06, lz1 + 0.005], 0.012, { segs: 10, caps: true }), pipeCol.dark);
  const hxd = lx1 - 0.075;
  B.add(mats.steel, tube([hxd, 1.0, lz1], [hxd, 1.0, lz1 + 0.012], 0.03, { segs: 16, caps: true }));
  B.add(mats.steel, tube([hxd, 1.0, lz1 + 0.012], [hxd, 1.0, lz1 + 0.05], 0.009, { segs: 8, caps: true }));
  B.add(mats.steel, box(hxd - 0.14, hxd + 0.01, 0.99, 1.012, lz1 + 0.042, lz1 + 0.06));
  B.add(mats.steel, tube([hxd, 0.86, lz1], [hxd, 0.86, lz1 + 0.01], 0.017, { segs: 12, caps: true }));
  B.add(mats.black, tube([hxd, 0.86, lz1 + 0.01], [hxd, 0.86, lz1 + 0.012], 0.007, { segs: 8, caps: true }));
  B.add(mats.frame, box(lx0 + 0.06, lx0 + 0.36, 1.93, 1.995, lz1, lz1 + 0.055));
  B.add(mats.frame, box(lx0 + 0.3, lx0 + 0.52, 1.985, 2.0, lz1 + 0.04, lz1 + 0.055));
  B.add(mats.frame, box(lx0 + 0.5, lx0 + 0.52, 2.0, fd.height + 0.03, lz1 + 0.035, fdz + 0.06));
  // 門扇標示牌
  addSign(root, T.createSign('防火門', { sub: '請隨時保持關閉', style: 'plate', w: 512, h: 160 }),
    [fd.x, 0.78, lz1 + 0.002], 0.3, 0.094, [0, 0, 0], out, { rough: 0.45, metal: 0.6 }, SB);
  // 夾絲強化玻璃（objects.fireDoorGlass）：幾乎透明的暗色玻璃——貼圖的 alpha 只在鐵絲網、污垢、煙燻處較高，
  // 所以手電筒只照亮鐵絲與污垢（不會變成一塊發亮的綠色磁磚），外面的車道、鈉燈與灰燼看得見。
  // 底層只有漫反射（Lambert、無鏡面）：手電筒與它的反彈補光（就在玻璃前面）不會在玻璃上打出一大團白霧；
  // 鏡面反光只由下面那層很光滑、很淡的加算光澤負責（一兩個銳利的小亮點）。
  const glassMat = new THREE.MeshLambertMaterial({
    map: TX.wiredGlassTexture(), color: 0x5a625e, transparent: true, opacity: 1,
    depthWrite: false, side: THREE.FrontSide,
  });
  glassMat.name = 'fireDoorGlass';
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(g.w, g.h), glassMat);
  glass.position.set(fd.x, g.y, (lz0 + lz1) / 2);
  glass.name = 'fireDoorGlass';
  glass.castShadow = false; glass.receiveShadow = false;
  glass.renderOrder = 2;
  root.add(glass);
  out.glass = glass;
  // 玻璃表面的鏡面光澤（加算、無漫反射）：只剩手電筒在玻璃上的柔和反光點
  const sheenMat = new THREE.MeshStandardMaterial({
    color: 0x000000, roughness: 0.035, metalness: 0.0, transparent: true, opacity: 0.05, depthWrite: false,
    blending: THREE.AdditiveBlending, envMap: mats.wetEnv || null, envMapIntensity: 0,
  });
  sheenMat.name = 'fireDoorGlassSheen';
  const sheen = new THREE.Mesh(glass.geometry, sheenMat);
  sheen.position.copy(glass.position); sheen.position.z += 0.001;
  sheen.name = 'fireDoorGlassSheen';
  sheen.castShadow = false; sheen.receiveShadow = false;
  sheen.renderOrder = 2;
  sheen.raycast = () => {};                       // 不擋互動／注視射線
  root.add(sheen);
  out.glassSheen = sheen;
  // 失效的綠色緊急出口燈（門楣上方，燈箱不亮）
  {
    const ey = fd.height + 0.16;
    B.add(mats.fixture, box(fd.x - 0.21, fd.x + 0.21, ey - 0.075, ey + 0.075, fdz, fdz + 0.07));
    const exitMat = new THREE.MeshStandardMaterial({
      map: T.createSign('緊急出口', { style: 'exit', w: 512, h: 160 }), color: 0x3c463f, roughness: 0.3, metalness: 0,
      emissive: 0x0c6e34, emissiveIntensity: 0,
    });
    const em = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.12), exitMat);
    em.position.set(fd.x, ey, fdz + 0.0705); root.add(em);
    out.exitSign = exitMat;
  }

  // ===========================================================================
  // 9. 牆面道具：消防栓箱、滅火器、配電箱、三角錐
  // ===========================================================================
  // 消防栓箱（北牆 x≈15.5）
  {
    const hx = 15.5, hw = 0.8, hy0 = 0.45, hy1 = 1.55, hz1 = zN + 0.22;
    B.add(mats.red, box(hx - hw / 2, hx + hw / 2, hy0, hy1, zN, hz1, { faces: 'px nx py ny' }));
    B.add(mats.redDark, box(hx - hw / 2 + 0.02, hx + hw / 2 - 0.02, hy0 + 0.02, hy1 - 0.02, zN, zN + 0.02, { faces: 'pz' }));
    // 門框（窗洞）
    const wx0 = hx - 0.32, wx1 = hx + 0.32, wy0 = 0.84, wy1 = 1.46;
    B.add(mats.red, box(hx - hw / 2, wx0, hy0, hy1, hz1 - 0.02, hz1 + 0.01, { faces: 'pz px nx' }));
    B.add(mats.red, box(wx1, hx + hw / 2, hy0, hy1, hz1 - 0.02, hz1 + 0.01, { faces: 'pz px nx' }));
    B.add(mats.red, box(wx0, wx1, hy0, wy0, hz1 - 0.02, hz1 + 0.01, { faces: 'pz py' }));
    B.add(mats.red, box(wx0, wx1, wy1, hy1, hz1 - 0.02, hz1 + 0.01, { faces: 'pz ny' }));
    // 內部：盤捲的水帶與瞄子
    for (let k = 0; k < 5; k++) {
      const t = new THREE.TorusGeometry(0.115 + k * 0.034, 0.017, 6, 30);
      xform(t, { pos: [hx, 1.14, zN + 0.09 + (k % 2) * 0.012] });
      B.add(mats.hose, t);
    }
    B.add(mats.steel, tube([hx, 1.14, zN + 0.03], [hx, 1.14, zN + 0.12], 0.035, { segs: 12, caps: true }));
    B.add(mats.steel, tube([hx + 0.27, 0.98, zN + 0.12], [hx + 0.27, 0.76, zN + 0.12], 0.02, { segs: 10, caps: true }));
    B.add(mats.black, tube([hx + 0.27, 0.76, zN + 0.12], [hx + 0.27, 0.66, zN + 0.12], 0.012, { segs: 8, caps: true }));
    // 頂部紅色指示燈（不亮）與警鈴
    const lamp = new THREE.SphereGeometry(0.045, 14, 8, 0, PI * 2, 0, PI / 2); xform(lamp, { pos: [hx - 0.15, hy1, zN + 0.1] });
    B.add(mats.lampRed, lamp);
    B.add(mats.red, tube([hx + 0.16, hy1, zN + 0.11], [hx + 0.16, hy1 + 0.02, zN + 0.11], 0.06, { segs: 18, caps: true }));
    B.add(mats.steel, tube([hx + 0.16, hy1 + 0.02, zN + 0.11], [hx + 0.16, hy1 + 0.05, zN + 0.11], 0.012, { segs: 8, caps: true }));
    // 玻璃
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(wx1 - wx0, wy1 - wy0), mats.cabinetGlass);
    gm.position.set(hx, (wy0 + wy1) / 2, hz1 - 0.008); gm.renderOrder = 1; root.add(gm);
    // 標示板
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.125), new THREE.MeshStandardMaterial({ map: TX.hosePlateTexture(), roughness: 0.5 }));
    plate.position.set(hx, 0.66, hz1 + 0.012); root.add(plate);
    out.obstacles.push({ minX: hx - hw / 2 - 0.02, maxX: hx + hw / 2 + 0.02, minZ: zN, maxZ: hz1 + 0.02 });
    // 滅火器（地上）
    extinguisher(B, mats, hx + 0.68, zN + 0.12);
    out.obstacles.push({ minX: hx + 0.58, maxX: hx + 0.8, minZ: zN, maxZ: zN + 0.22 });
  }
  // 接線盒／分電盤
  const jbox = (x, y0, y1, w, dep, onNorth, label, conduitTop) => {
    const z0 = onNorth ? zN : zS - dep, z1 = onNorth ? zN + dep : zS;
    B.add(mats.cabinet, box(x - w / 2, x + w / 2, y0, y1, z0, z1, { faces: onNorth ? 'pz px nx py ny' : 'nz px nx py ny' }));
    const fz2 = onNorth ? z1 : z0;
    B.add(mats.metalDark, box(x - w / 2 + 0.015, x + w / 2 - 0.015, y0 + 0.015, y1 - 0.015, Math.min(fz2, fz2 + (onNorth ? 0.006 : -0.006)), Math.max(fz2, fz2 + (onNorth ? 0.006 : -0.006)), { faces: onNorth ? 'pz' : 'nz' }));
    B.add(mats.steel, box(x + w / 2 - 0.05, x + w / 2 - 0.035, (y0 + y1) / 2 - 0.04, (y0 + y1) / 2 + 0.04, Math.min(fz2, fz2 + (onNorth ? 0.02 : -0.02)), Math.max(fz2, fz2 + (onNorth ? 0.02 : -0.02))));
    const czz = onNorth ? zN + 0.05 : zS - 0.05;
    for (const ox of conduitTop) P(tube([x + ox, y1, czz], [x + ox, H, czz], 0.016, { segs: 8 }), pipeCol.conduit);
    const lab = T.createLabel(label, { w: 256, h: 64, bg: '#e9e4d2', fg: '#1c1c1c', size: 28 });
    addSign(root, lab, [x - 0.02, y1 - 0.07, fz2 + (onNorth ? 0.0075 : -0.0075)], Math.min(0.2, w * 0.6), 0.05, [0, onNorth ? 0 : PI, 0], out, { rough: 0.6 }, SB);
    out.obstacles.push({ minX: x - w / 2 - 0.02, maxX: x + w / 2 + 0.02, minZ: onNorth ? zN : zS - dep - 0.02, maxZ: onNorth ? zN + dep + 0.02 : zS });
  };
  jbox(8.7, 1.3, 1.75, 0.4, 0.14, true, 'JB-B2-01', [0]);
  jbox(27.4, 1.25, 1.62, 0.4, 0.13, false, 'JB-B2-05', []);
  P(tube([27.4, 1.62, zS - 0.06], [27.4, 1.8, zS - 0.06], 0.016, { segs: 8 }), pipeCol.conduit);
  jbox(31.6, 1.0, 1.75, 0.6, 0.17, true, '照明分電盤 LP-B2', [-0.18, 0, 0.18]);
  addSign(root, T.createSign('有電危險', { sub: '非工作人員請勿開啟', style: 'warning', w: 512, h: 160 }),
    [31.6, 1.36, zN + 0.177], 0.3, 0.094, [0, 0, 0], out, { rough: 0.5 }, SB);
  // 三角錐（北牆 x≈34.8）
  for (const [cx, cz, n] of [[34.75, zN + 0.22, 3], [35.25, zN + 0.24, 2]]) {
    for (let k = 0; k < n; k++) cone(B, mats, cx, cz, k * 0.075);
  }
  out.obstacles.push({ minX: 34.5, maxX: 35.5, minZ: zN, maxZ: zN + 0.45 });

  // ===========================================================================
  // 10. 標示：區段編號、往電閘室箭頭
  // ===========================================================================
  const segX = [5.2, 11.2, 17.2, 23.2, 29.2, 35.2];
  segX.forEach((x, i) => addSign(root, T.createSign(`B2-0${i + 1}`, { style: 'stencil', w: 512, h: 160 }),
    [x, 1.48, zS - 0.004], 0.62, 0.194, [0, PI, 0], out, { decal: true }, SB));
  addSign(root, T.createSign('B2-07', { style: 'stencil', w: 512, h: 160 }), [x1 - 0.004, 1.48, 5.9], 0.62, 0.194, [0, -PI / 2, 0], out, { decal: true }, SB);
  for (const x of [8.0, 27.6]) {
    addSign(root, T.createSign('電閘室 →', { style: 'stencil', w: 512, h: 160 }), [x, 1.5, zN + 0.004], 0.66, 0.206, [0, 0, 0], out, { decal: true }, SB);
  }
  addSign(root, T.createSign('電閘室 →', { style: 'stencil', w: 512, h: 160 }), [x1 - 0.004, 1.5, 2.0], 0.66, 0.206, [0, -PI / 2, 0], out, { decal: true }, SB);
  addSign(root, T.createSign('電閘室', { sub: 'SWITCH ROOM B2', style: 'plate', w: 512, h: 160 }),
    [leg.minX + 0.004, 1.65, leg.maxZ - 0.8], 0.4, 0.125, [0, PI / 2, 0], out, { rough: 0.45, metal: 0.6 }, SB);
  addSign(root, T.createSign('高壓危險', { sub: '非工作人員禁止進入', style: 'warning', w: 512, h: 160 }),
    [leg.maxX - 0.004, 1.65, leg.maxZ - 0.8], 0.4, 0.125, [0, -PI / 2, 0], out, { rough: 0.5 }, SB);

  // ===========================================================================
  // 11. 潮濕：牆面水漬、天花水漬、地上積水
  // ===========================================================================
  const dampMats = [[17, 'seep'], [34, 'rising'], [51, 'seep']].map(([s, k]) => new THREE.MeshStandardMaterial({
    map: TX.dampTexture(s, k), transparent: true, depthWrite: false, roughness: 0.5, metalness: 0,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  const dampDefs = [
    // [x, yCenter, h, w, wall('n'|'s'|'e'), matIndex(0/2 = 頂部滲水, 1 = 地面返潮), zForLeg]
    [11.6, 1.95, 1.1, 2.2, 'n', 0], [15.0, 0.42, 0.84, 2.0, 's', 1], [22.9, 1.95, 1.1, 2.0, 'n', 2],
    [24.6, 0.45, 0.9, 2.6, 'n', 1], [26.4, 1.95, 1.1, 2.4, 's', 0], [32.2, 0.42, 0.84, 2.2, 's', 1],
    [36.6, 1.95, 1.1, 2.2, 'n', 2], [0, 0.45, 0.9, 1.9, 'e', 1, 4.9],
  ];
  for (const [x, yc, h, w, wall, mi, zl] of dampDefs) {
    let geo;
    if (wall === 'n') geo = quadGeo([x - w / 2, yc - h / 2, zN + 0.002], [x + w / 2, yc - h / 2, zN + 0.002], [x + w / 2, yc + h / 2, zN + 0.002], [x - w / 2, yc + h / 2, zN + 0.002]);
    else if (wall === 's') geo = quadGeo([x + w / 2, yc - h / 2, zS - 0.002], [x - w / 2, yc - h / 2, zS - 0.002], [x - w / 2, yc + h / 2, zS - 0.002], [x + w / 2, yc + h / 2, zS - 0.002]);
    else geo = quadGeo([x1 - 0.002, yc - h / 2, zl - w / 2], [x1 - 0.002, yc - h / 2, zl + w / 2], [x1 - 0.002, yc + h / 2, zl + w / 2], [x1 - 0.002, yc + h / 2, zl - w / 2]);
    B.add(dampMats[mi], geo, { cast: false, chunked: false });
  }
  const ceilStain = new THREE.MeshStandardMaterial({ map: TX.ceilingStainTexture(), transparent: true, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const puddleDefs = [[9.6, 1.95, 1.2, 0.75, 1], [16.9, 1.65, 0.7, 0.5, 2], [21.4, 2.15, 1.0, 0.62, 3], [25.8, 1.85, 1.5, 0.66, 4], [33.1, 2.05, 0.9, 0.55, 5], [39.05, 5.9, 0.75, 1.0, 6], [38.2, 11.8, 0.9, 0.7, 7]];
  const puddleMats = [1, 2, 3].map((s) => new THREE.MeshStandardMaterial({
    color: 0x1a1d20, roughness: 0.05, metalness: 0.0, transparent: true, opacity: 0.5, alphaMap: TX.puddleMask(s * 31),
    envMap: mats.wetEnv, envMapIntensity: 0,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  }));
  out.wetMats = [...puddleMats, mats.water];
  for (const [x, z, w, dpt, s] of puddleDefs) {
    const geo = quadGeo([x - w / 2, 0.002, z + dpt / 2], [x + w / 2, 0.002, z + dpt / 2], [x + w / 2, 0.002, z - dpt / 2], [x - w / 2, 0.002, z - dpt / 2]);
    B.add(puddleMats[s % 3], geo, { cast: false, chunked: false });
    if (s < 6) {
      const cs = 0.55 + (s % 3) * 0.12;
      B.add(ceilStain, quadGeo([x - cs, H - 0.002, z - cs], [x + cs, H - 0.002, z - cs], [x + cs, H - 0.002, z + cs], [x - cs, H - 0.002, z + cs]), { cast: false, chunked: false });
    }
  }
  out.puddles = puddleDefs.map(([x, z]) => ({ x, z }));

  out.meshes = B.build(root);
  return out;
}

// ---- 小工具 -----------------------------------------------------------------
/** 下半圓柱燈罩（沿 X，開口朝上）。 */
function halfCylinder(L, r) {
  const g = paramSurface((u, v, t) => {
    const a = PI * v;                      // 0..π 從北側繞到南側（經過下方）
    t.set((u - 0.5) * L, -Math.sin(a) * r * 0.8, -Math.cos(a) * r);
  }, 2, 10, { uvFn: (u, v) => [u, v] });
  return g;
}

/** 牆面貼牌（標誌、模板字）。decal = 噴漆字（透明底、不寫深度）。 */
function addSign(root, tex, pos, w, h, rot, out, { decal = false, rough = 0.8, metal = 0 } = {}, SB = null) {
  const m = new THREE.MeshStandardMaterial({
    map: tex, roughness: rough, metalness: metal, transparent: decal, depthWrite: !decal, alphaTest: decal ? 0.02 : 0,
    polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
  mesh.position.set(...pos); mesh.rotation.set(...rot);
  mesh.receiveShadow = true;
  if (!decal && SB) {
    // 銘牌有厚度：背板併入靜態合併幾何
    const g = new THREE.BoxGeometry(w + 0.006, h + 0.006, 0.004); g.translate(0, 0, -0.0025);
    mesh.updateMatrix(); g.applyMatrix4(mesh.matrix);
    SB.B.add(SB.mat, g, { cast: false });
  }
  root.add(mesh); out.signs.push(mesh);
  return mesh;
}

/** 滅火器。 */
function extinguisher(B, mats, x, z) {
  B.add(mats.red, tube([x, 0.02, z], [x, 0.5, z], 0.075, { segs: 18, caps: false }));
  const top = new THREE.SphereGeometry(0.075, 18, 8, 0, PI * 2, 0, PI / 2); xform(top, { pos: [x, 0.5, z] }); B.add(mats.red, top);
  B.add(mats.black, tube([x, 0.0, z], [x, 0.02, z], 0.078, { segs: 18, caps: true }));
  B.add(mats.steel, tube([x, 0.57, z], [x, 0.63, z], 0.016, { segs: 10, caps: true }));
  B.add(mats.black, box(x - 0.005, x + 0.07, 0.6, 0.62, z - 0.012, z + 0.012));
  B.add(mats.black, tube([x + 0.02, 0.6, z + 0.02], [x + 0.06, 0.25, z + 0.07], 0.01, { segs: 8 }));
}

/** 交通三角錐（疊放）。 */
function cone(B, mats, x, z, yOff) {
  const base = box(x - 0.18, x + 0.18, yOff, yOff + 0.03, z - 0.18, z + 0.18);
  B.add(mats.black, base);
  const c = new THREE.CylinderGeometry(0.03, 0.145, 0.62, 18, 1, true); xform(c, { pos: [x, yOff + 0.34, z] });
  B.add(mats.cone, c);
  for (const [yy, r0, r1] of [[0.36, 0.105, 0.098], [0.5, 0.074, 0.067]]) {
    const b = new THREE.CylinderGeometry(r1 + 0.002, r0 + 0.002, 0.08, 18, 1, true); xform(b, { pos: [x, yOff + yy, z] });
    B.add(mats.reflectWhite, b);
  }
}
