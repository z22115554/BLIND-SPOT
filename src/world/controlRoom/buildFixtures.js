// =============================================================================
// 牆面/天花板設備：日光燈具、緊急紅燈箱、LED 電子鐘、隧道配置圖、文件架、值班白板、
// 防爆門（重型框架、收納門袋、氣壓閥手輪、鎖栓、狀態燈）、緊急對講機、通風控制面板（轉速表、拉桿）、
// 緊急手電筒箱、側門（推桿、鐵絲網玻璃窗、電磁鎖）、檔案櫃、咖啡台與公佈欄、置物櫃、機櫃、滅火器。
// =============================================================================
import * as THREE from 'three';
import { T, Batcher, frameGeom, hitbox, noRaycast } from './kit.js';
import { UVS } from './materials.js';
import * as LT from './localTextures.js';
import { SingleLed } from './leds.js';
import { wallMatrix } from './buildShell.js';

export function buildFixtures(room) {
  buildLights(room);
  buildNorthWall(room);
  buildBlastDoor(room);
  buildIntercom(room);
  buildVentPanel(room);
  buildFlashlightBox(room);
  buildSideDoor(room);
  buildFurniture(room);
}

/** 貼在牆上的平面（標誌/圖面），法線朝房內。 */
function wallPlane(room, wall, u, v, w, h, mat, d = 0.004) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.applyMatrix4(wallMatrix(wall, u, v, d));
  room.group.add(noRaycast(m));
  return m;
}

// ---------------------------------------------------------------------------
// 日光燈具（吸頂式：開放式燈箱＋兩支燈管＋半透明稜鏡擴散板）與緊急紅燈箱
// ---------------------------------------------------------------------------
function buildLights(room) {
  const { L, mats, group } = room;
  const B = room.sb;
  const H = L.height;
  const prism = LT.prismTexture();
  room.tubeMats = [];
  room.diffuserMats = [];
  const endBands = new Batcher();
  L.fluorescents.forEach((f, i) => {
    B.with(T({ x: f.x, y: H, z: f.z }), () => {
      B.box('whiteEnamel', 1.26, 0.006, 0.3, 0, -0.003, 0);
      B.box('whiteEnamel', 1.26, 0.075, 0.006, 0, -0.0375, 0.147);
      B.box('whiteEnamel', 1.26, 0.075, 0.006, 0, -0.0375, -0.147);
      B.box('whiteEnamel', 0.006, 0.075, 0.3, 0.627, -0.0375, 0);
      B.box('whiteEnamel', 0.006, 0.075, 0.3, -0.627, -0.0375, 0);
      for (const sx of [-1, 1]) for (const z of [-0.06, 0.06]) B.box('greyPlastic', 0.025, 0.03, 0.03, sx * 0.598, -0.032, z);
      B.box('darkMetal', 0.9, 0.012, 0.05, 0, -0.012, 0); // 安定器
    });
    const tubes = [];
    for (const [k, z] of [[0, -0.06], [1, 0.06]]) {
      const m = mats.make({ color: 0xeef0ee, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.35 }, 'cr:tube');
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.17, 14, 1), m);
      tube.rotation.z = Math.PI / 2;
      tube.position.set(f.x, H - 0.035, f.z + z);
      group.add(noRaycast(tube));
      tubes.push(m);
      for (const sx of [-1, 1]) endBands.cyl('band', 0.0134, 0.0134, 0.06, f.x + sx * 0.555, H - 0.035, f.z + z, { rz: Math.PI / 2 }, 14);
    }
    room.tubeMats.push(tubes);
    const dm = mats.make({ map: prism, color: 0xf2f5f4, transparent: true, opacity: 0.6, roughness: 0.55, emissive: 0xffffff, emissiveIntensity: 0, depthWrite: false }, 'cr:diffuser');
    const diff = new THREE.Mesh(new THREE.BoxGeometry(1.244, 0.004, 0.284), dm);
    // 稜鏡紋路的重複
    diff.geometry.attributes.uv.array.forEach((v, idx, arr) => { arr[idx] = v * (idx % 2 === 0 ? 24 : 6); });
    diff.position.set(f.x, H - 0.072, f.z);
    group.add(noRaycast(diff));
    room.diffuserMats.push(dm);
  });
  // 燈管兩端發黑（腐化時浮現）
  room.tubeEndMat = new THREE.MeshStandardMaterial({ color: 0x1a1612, transparent: true, opacity: 0, roughness: 0.6, depthWrite: false });
  endBands.build({ band: room.tubeEndMat }, group, { name: 'tubeEnds' });

  // 緊急紅燈箱（壁掛支架＋向下前方的半圓柱紅色燈罩）
  room.emergLensMat = mats.make({ color: 0x4a0604, emissive: 0xff0a02, emissiveIntensity: 0, roughness: 0.25, transparent: true, opacity: 0.92 }, 'cr:emergLens');
  const thetaC = Math.atan2(-0.6, 0.8);
  const lensG = new THREE.CylinderGeometry(0.046, 0.046, 0.25, 18, 1, false, thetaC - Math.PI / 2, Math.PI);
  lensG.rotateZ(Math.PI / 2);
  L.emergencyLights.forEach((e) => {
    const faceZ = e.z < 0 ? 1 : -1; // 朝房內
    const wallZ = e.z < 0 ? L.minZ : L.maxZ;
    const ry = faceZ > 0 ? 0 : Math.PI;
    B.with(T({ x: e.x, y: e.y, z: e.z, ry }), () => {
      const back = (wallZ - e.z) * faceZ; // 牆在區域 -Z 方向 back 處
      B.box('panelGrey', 0.3, 0.13, 0.12, 0, 0.02, 0);
      B.box('darkMetal', 0.32, 0.015, 0.14, 0, 0.09, 0);
      for (const sx of [-0.1, 0.1]) B.box('darkMetal', 0.02, 0.02, -back - 0.012, sx, 0.05, (back + 0.012) / 2);
      B.box('panelGrey', 0.36, 0.2, 0.012, 0, 0.04, back + 0.006);
      B.box('chrome', 0.06, 0.025, 0.004, 0.1, 0.05, 0.062); // 測試鈕
    });
    const lens = new THREE.Mesh(lensG, room.emergLensMat);
    lens.position.set(e.x, e.y - 0.04, e.z + faceZ * 0.035);
    lens.rotation.y = ry;
    group.add(noRaycast(lens));
  });
}

// ---------------------------------------------------------------------------
// 北牆：LED 電子鐘、隧道配置圖、文件架、值班白板、置物櫃、機櫃
// ---------------------------------------------------------------------------
function buildNorthWall(room) {
  const { L, mats, group } = room;
  const B = room.sb;
  // ---- LED 電子鐘 ----
  const c = L.clock;
  const clock = new THREE.Group();
  clock.name = 'clock';
  const housing = new THREE.Mesh(new THREE.BoxGeometry(c.w + 0.06, c.h + 0.06, 0.042), mats.get('blackPlastic'));
  housing.position.set(c.x, c.y, L.minZ + 0.021);
  room.ledClock = room.tex.ledClock();
  room.clockFaceMat = new THREE.MeshBasicMaterial({ map: room.ledClock.texture, color: 0xffffff });
  room.clockFaceMat.name = 'cr:clockFace';
  const face = new THREE.Mesh(new THREE.PlaneGeometry(c.w, c.h), room.clockFaceMat);
  face.position.set(c.x, c.y, L.minZ + 0.0435);
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(c.w + 0.02, c.h + 0.02), mats.make({ color: 0x101010, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.18, depthWrite: false }, 'cr:clockGlass'));
  glass.position.set(c.x, c.y, L.minZ + 0.045);
  clock.add(housing, face, glass);
  for (const sx of [-1, 1]) {
    const scr = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.004, 8), mats.get('chrome'));
    scr.rotation.x = Math.PI / 2; scr.position.set(c.x + sx * (c.w / 2 + 0.018), c.y, L.minZ + 0.043);
    clock.add(scr);
  }
  group.add(clock);
  room.objects.clock = clock;
  // 牆面上的紅色光暈
  room.clockSpillMat = new THREE.MeshBasicMaterial({ map: LT.spillTexture([255, 30, 20]), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  wallPlane(room, 'north', c.x, c.y, 1.5, 0.75, room.clockSpillMat, 0.0015);

  // ---- 隧道配置圖 ----
  const mapTex = room.tex.tunnelMap();
  const mw = 1.44, mh = 0.9, mx = -2.32, my = 1.86;
  B.add('alu', frameGeom(mw + 0.04, mh + 0.04, mw, mh, 0.022, { r: 0.004, ir: 0.002 }), T({ x: mx, y: my, z: L.minZ }));
  B.box('consoleDark', mw, mh, 0.006, mx, my, L.minZ + 0.003);
  wallPlane(room, 'north', mx, my, mw, mh, mats.make({ map: mapTex, roughness: 0.75 }, 'cr:map'), 0.012);
  wallPlane(room, 'north', mx, my, mw, mh, mats.make({ color: 0x0a0a0a, roughness: 0.05, transparent: true, opacity: 0.12, depthWrite: false }, 'cr:mapGlass'), 0.019);

  // ---- 文件架與活頁夾 ----
  const sx0 = 1.6, sx1 = 2.72, sy = 1.22, sd = 0.27;
  B.box('cabinet', sx1 - sx0, 0.022, sd, (sx0 + sx1) / 2, sy, L.minZ + sd / 2);
  for (const x of [sx0 + 0.12, sx1 - 0.12]) B.box('darkMetal', 0.025, 0.16, 0.02, x, sy - 0.09, L.minZ + 0.012), B.box('darkMetal', 0.025, 0.02, sd - 0.03, x, sy - 0.02, L.minZ + sd / 2);
  const binders = [['設備巡檢', '#2c4a6e'], ['緊急應變', '#7a2a24'], ['通風系統', '#2f5a3a'], null, ['供電系統', '#3a3a3e'], ['監控系統', '#2c4a6e'], ['隧道規章', '#6b5a2a']];
  let bx = sx0 + 0.06;
  binders.forEach((b, i) => {
    if (!b) { bx += 0.075; return; }
    const tex = LT.spineTexture(b[0], b[1], i + 3);
    const side = mats.make({ color: new THREE.Color(b[1]).multiplyScalar(1.4), roughness: 0.6 }, 'cr:binder');
    const spine = mats.make({ map: tex, roughness: 0.6 }, 'cr:spine');
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.31, 0.25), [side, side, side, side, spine, side]);
    m.position.set(bx + 0.029, sy + 0.011 + 0.155, L.minZ + 0.14);
    m.rotation.z = i === 6 ? 0.22 : (i % 2 ? 0.01 : -0.012);
    if (i === 6) m.position.x += 0.04, m.position.y -= 0.01;
    group.add(noRaycast(m));
    bx += 0.064;
  });

  // ---- 值班白板 ----
  const wx = 2.2, wy = 1.98, ww = 1.16, wh = 0.68;
  B.add('alu', frameGeom(ww + 0.04, wh + 0.04, ww, wh, 0.02, { r: 0.006, ir: 0.002 }), T({ x: wx, y: wy, z: L.minZ }));
  wallPlane(room, 'north', wx, wy, ww, wh, mats.make({ map: LT.rosterTexture(), roughness: 0.3 }, 'cr:roster'), 0.008);
  B.box('alu', 0.62, 0.012, 0.05, wx - 0.18, wy - wh / 2 - 0.03, L.minZ + 0.03);
  B.box('alu', 0.62, 0.025, 0.006, wx - 0.18, wy - wh / 2 - 0.02, L.minZ + 0.053);
  B.cyl('blackPlastic', 0.009, 0.009, 0.13, wx - 0.3, wy - wh / 2 - 0.014, L.minZ + 0.032, { rz: Math.PI / 2 }, 8);
  B.cyl('extRed', 0.009, 0.009, 0.13, wx - 0.12, wy - wh / 2 - 0.014, L.minZ + 0.03, { rz: Math.PI / 2 + 0.05 }, 8);
  B.rbox('greyPlastic', 0.12, 0.03, 0.045, 0.005, wx + 0.05, wy - wh / 2 - 0.006, L.minZ + 0.032);

  // ---- 西北角置物櫃 ----
  const lx = -3.7, lz = -3.21, lh = 1.85;
  B.box('cabinet', 0.5, lh, 0.5, lx, lh / 2, lz);
  for (const sx of [-1, 1]) {
    B.rbox('cabinet', 0.235, lh - 0.06, 0.02, 0.004, lx + sx * 0.122, lh / 2, lz + 0.256);
    B.box('chrome', 0.014, 0.12, 0.02, lx + sx * 0.03, 1.0, lz + 0.275);
    for (let k = 0; k < 5; k++) B.box('consoleDark', 0.12, 0.008, 0.004, lx + sx * 0.122, lh - 0.12 - k * 0.022, lz + 0.267);
  }
  B.box('cardboard', 0.38, 0.22, 0.32, lx + 0.02, lh + 0.11, lz + 0.02, { ry: 0.08 });
  B.box('paper', 0.3, 0.004, 0.24, lx + 0.03, lh + 0.222, lz + 0.03, { ry: 0.2 });

  // ---- 東北角 19 吋機櫃 ----
  const rx0 = 3.37, rz = -3.17, rh = 2.0;
  B.box('darkMetal', 0.6, rh, 0.6, rx0 + 0.3, rh / 2, rz);
  const rackFace = new THREE.Mesh(new THREE.PlaneGeometry(0.5, rh - 0.12), mats.get('rack'));
  rackFace.position.set(rx0 - 0.002, rh / 2, rz); rackFace.rotation.y = -Math.PI / 2;
  group.add(noRaycast(rackFace));
  for (const dz of [-0.27, 0.27]) B.box('chrome', 0.02, rh - 0.1, 0.02, rx0 - 0.01, rh / 2, rz + dz);
  for (let k = 0; k < 34; k++) {
    const y = 0.15 + ((k * 0.613) % 1) * (rh - 0.3);
    const z = rz - 0.2 + ((k * 0.377) % 1) * 0.4;
    const col = k % 7 === 0 ? 'amber' : k % 11 === 0 ? 'blue' : 'green';
    const blink = k % 5 === 0 ? { period: 1.1 + (k % 3) * 0.6, phase: k * 0.31, duty: 0.55 } : null;
    room.leds.add(new THREE.Vector3(rx0 - 0.006, y, z), new THREE.Vector3(-1, 0, 0), col, { blink, scale: 0.75 });
  }
}

// ---------------------------------------------------------------------------
// 防爆門（西牆）
// ---------------------------------------------------------------------------
function buildBlastDoor(room) {
  const { L, mats, group } = room;
  const B = room.sb;
  const bd = L.blastDoor;
  const z0 = bd.z - bd.width / 2, z1 = bd.z + bd.width / 2; // 門洞
  const W = L.minX; // -4
  const pocket0 = z1 + 0.07, pocket1 = z1 + 0.07 + bd.slide + 0.26;
  room.blastPocket = { z0: pocket0, z1: pocket1 };
  // 門框（北側立柱、門楣、吊軌）
  B.box('frameSteel', 0.26, 2.6, 0.27, W + 0.13, 1.3, z0 - 0.155);
  B.box('frameSteel', 0.26, 0.24, pocket0 - (z0 - 0.29), W + 0.13, 2.48, (pocket0 + z0 - 0.29) / 2);
  B.box('darkMetal', 0.16, 0.02, pocket1 - z0 + 0.05, W + 0.11, 2.35, (pocket1 + z0 - 0.05) / 2);
  B.box('hazard', 0.004, 2.25, 0.2, W + 0.262, 1.18, z0 - 0.155);
  // 立柱與門楣上的鉚釘
  const rivet = new THREE.SphereGeometry(0.008, 6, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let y = 0.15; y < 2.5; y += 0.22) for (const dz of [-0.255, -0.045]) B.add('frameSteel', rivet, T({ x: W + 0.26, y, z: z0 + dz, rz: -Math.PI / 2 }));
  // 門袋外殼（突出牆面，容納滑入的門板與手輪）
  const cx0 = W, cx1 = W + 0.46;
  B.box('frameSteel', 0.04, 2.6, pocket1 - pocket0, cx1 - 0.02, 1.3, (pocket0 + pocket1) / 2);
  B.box('frameSteel', cx1 - cx0, 0.04, pocket1 - pocket0, (cx0 + cx1) / 2, 2.6, (pocket0 + pocket1) / 2);
  B.box('frameSteel', cx1 - cx0, 2.6, 0.03, (cx0 + cx1) / 2, 1.3, pocket1 - 0.015);
  B.box('frameSteel', 0.06, 2.6, 0.035, cx1 - 0.03, 1.3, pocket0 + 0.0175); // 前緣
  B.box('darkMetal', cx1 - cx0 - 0.04, 0.01, pocket1 - pocket0, (cx0 + cx1) / 2 - 0.02, 0.005, (pocket0 + pocket1) / 2);
  for (const y of [0.75, 1.95]) B.box('frameSteel', 0.022, 0.07, pocket1 - pocket0 - 0.1, cx1 + 0.011, y, (pocket0 + pocket1) / 2);
  B.box('hazard', 0.004, 2.4, 0.16, cx1 + 0.002, 1.25, pocket0 + 0.1);
  for (let y = 0.12; y < 2.55; y += 0.24) for (const z of [pocket0 + 0.22, pocket1 - 0.06]) B.add('frameSteel', rivet, T({ x: cx1, y, z, rz: -Math.PI / 2 }));
  // 警示銘牌
  const warn = room.tex.sign('氣壓閥門', { sub: '開啟時保持淨空', style: 'warning', w: 512, h: 160 });
  const wm = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.156), mats.make({ map: warn, roughness: 0.5 }, 'cr:warnPlate'));
  wm.position.set(cx1 + 0.003, 1.5, (pocket0 + pocket1) / 2 + 0.1); wm.rotation.y = Math.PI / 2;
  group.add(noRaycast(wm));
  // 門楣上的標示
  const sign = room.tex.sign('防爆門', { sub: '公務維修廊道 B區', style: 'warning', w: 512, h: 160 });
  const sm = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.2), mats.make({ map: sign, roughness: 0.5 }, 'cr:doorSign'));
  sm.position.set(W + 0.262, 2.48, bd.z - 0.15); sm.rotation.y = Math.PI / 2;
  group.add(noRaycast(sm));

  // ---- 可動門板 ----
  const door = new THREE.Group();
  door.name = 'blastDoor';
  const db = new Batcher(UVS);
  const fx = W + 0.22; // 門板室內面 x
  const dz0 = z0 - 0.02, dz1 = z1 + 0.05;
  db.box('steelDoor', 0.2, 2.33, dz1 - dz0, fx - 0.1, 0.01 + 2.33 / 2, (dz0 + dz1) / 2);
  db.box('rubber', 0.2, 2.3, 0.008, fx - 0.1, 1.18, dz0 - 0.004);
  // 周邊扁鋼
  db.box('frameSteel', 0.014, 0.06, dz1 - dz0, fx + 0.007, 2.3, (dz0 + dz1) / 2);
  db.box('frameSteel', 0.014, 0.06, dz1 - dz0, fx + 0.007, 0.05, (dz0 + dz1) / 2);
  db.box('frameSteel', 0.014, 2.19, 0.06, fx + 0.007, 1.175, dz0 + 0.04);
  db.box('frameSteel', 0.014, 2.19, 0.06, fx + 0.007, 1.175, dz1 - 0.04);
  for (const y of [0.62, 1.86]) db.box('frameSteel', 0.026, 0.07, dz1 - dz0 - 0.12, fx + 0.013, y, (dz0 + dz1) / 2);
  db.box('hazard', 0.004, 0.22, dz1 - dz0 - 0.14, fx + 0.002, 0.2, (dz0 + dz1) / 2);
  for (let z = dz0 + 0.1; z < dz1 - 0.05; z += 0.14) for (const y of [0.05, 2.3]) db.add('frameSteel', rivet, T({ x: fx + 0.014, y, z, rz: -Math.PI / 2 }));
  for (let y = 0.2; y < 2.2; y += 0.14) for (const z of [dz0 + 0.04, dz1 - 0.04]) db.add('frameSteel', rivet, T({ x: fx + 0.014, y, z, rz: -Math.PI / 2 }));
  // 手輪底座法蘭
  const wy = 1.22, wz = bd.z + 0.02;
  db.cyl('darkMetal', 0.1, 0.1, 0.016, fx + 0.008, wy, wz, { rz: Math.PI / 2 }, 28);
  // 鎖栓導座
  for (const y of [wy - 0.2, wy + 0.2]) for (const z of [wz - 0.42, z0 + 0.12]) db.box('frameSteel', 0.05, 0.07, 0.05, fx + 0.025, y, z);
  // 壓力錶
  db.cyl('chrome', 0.058, 0.058, 0.03, fx + 0.015, 1.5, z1 - 0.28, { rz: Math.PI / 2 }, 24);
  db.build((k) => mats.get(k), door, { name: 'blastDoor' });
  const gm = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), mats.make({ map: room.dialTex, roughness: 0.4 }, 'cr:doorGauge'));
  gm.position.set(fx + 0.031, 1.5, z1 - 0.28); gm.rotation.y = Math.PI / 2;
  door.add(noRaycast(gm));
  const gn = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.04, 0.003), mats.get('blackPlastic'));
  gn.geometry.translate(0, 0.016, 0);
  gn.position.set(fx + 0.033, 1.5, z1 - 0.28); gn.rotation.set(0, Math.PI / 2, -0.5, 'YXZ');
  door.add(noRaycast(gn));
  // 門上噴漆編號
  const sten = room.tex.sign('B-01', { style: 'stencil', w: 512, h: 160 });
  const st = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.144), mats.make({ map: sten, transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }, 'cr:stencil'));
  st.position.set(fx + 0.0015, 1.62, z1 - 0.38); st.rotation.y = Math.PI / 2;
  door.add(noRaycast(st));
  // 手輪
  const wheel = new THREE.Group();
  wheel.position.set(fx + 0.095, wy, wz);
  const wb = new Batcher(UVS);
  const torus = new THREE.TorusGeometry(0.19, 0.016, 10, 40); torus.rotateY(Math.PI / 2);
  wb.add('paintedRed', torus);
  for (const a of [0, Math.PI / 2]) wb.box('darkMetal', 0.012, 0.38, 0.026, -0.004, 0, 0, { rx: a });
  wb.cyl('darkMetal', 0.045, 0.05, 0.1, -0.045, 0, 0, { rz: Math.PI / 2 }, 20);
  wb.cyl('chrome', 0.022, 0.022, 0.02, 0.012, 0, 0, { rz: Math.PI / 2 }, 16);
  wb.cyl('blackPlastic', 0.012, 0.012, 0.05, 0.025, 0.19, 0, { rz: Math.PI / 2 }, 10);
  wb.build((k) => mats.get(k), wheel, { name: 'wheel' });
  door.add(wheel);
  // 鎖栓（解鎖時往 +Z 縮回）
  const bolts = new THREE.Group();
  const bb = new Batcher(UVS);
  for (const y of [wy - 0.2, wy + 0.2]) {
    bb.cyl('chrome', 0.018, 0.018, wz - (z0 - 0.07), fx + 0.025, y, (wz + z0 - 0.07) / 2, { rx: Math.PI / 2 }, 12);
  }
  bb.build((k) => mats.get(k), bolts, { name: 'bolts' });
  door.add(bolts);
  group.add(door);
  room.objects.blastDoor = door;
  // 狀態燈（門框上）
  const lampHouse = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.03, 18), mats.get('darkMetal'));
  lampHouse.rotation.z = Math.PI / 2; lampHouse.position.set(W + 0.275, 2.48, z0 - 0.15);
  group.add(lampHouse);
  const lamp = new SingleLed({ radius: 0.024, glowTex: room.glowTex, glowSize: 0.16 });
  lamp.group.position.set(W + 0.29, 2.48, z0 - 0.15); lamp.group.rotation.y = Math.PI / 2;
  group.add(lamp.group);
  room.parts.blast = { door, wheel, bolts, lamp };
}

// ---------------------------------------------------------------------------
// 緊急對講機（西牆，朝 +X）
// ---------------------------------------------------------------------------
function buildIntercom(room) {
  const { L, mats, group } = room;
  const ic = L.intercom;
  const root = new THREE.Group();
  root.name = 'intercom';
  root.position.set(ic.x, ic.y, ic.z);
  root.rotation.y = Math.PI / 2;
  const b = new Batcher(UVS);
  b.rbox('panelGrey', 0.26, 0.36, 0.05, 0.008, 0, 0, -0.005);
  for (const [x, y] of [[-0.11, 0.16], [0.11, 0.16], [-0.11, -0.16], [0.11, -0.16]]) b.cyl('chrome', 0.006, 0.006, 0.004, x, y, 0.021, { rx: Math.PI / 2 }, 8);
  b.build((k) => mats.get(k), root, { name: 'intercom' });
  // 面板圖（紅色頂帶、「緊急對講」、喇叭格柵、通話燈座、通話鍵凹座、標籤）：3D 零件全部依它的 layout 對位
  const FW = 0.24, FH = 0.34, FZ = 0.0205;
  const tex = room.tex.panel('intercom');
  const lay = tex.userData?.layout || {};
  const at = (o, dz = 0) => new THREE.Vector3((o.u - 0.5) * FW, (o.v - 0.5) * FH, FZ + dz);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(FW, FH), mats.make({ map: tex, roughness: 0.55, transparent: false }, 'cr:intercomFace'));
  face.position.z = FZ;
  root.add(face);
  // 喇叭格柵外圈：一圈微微凸起的鍍鉻環，只框住印好的格柵（不蓋住任何字）
  const sp = lay.speaker || { u: 0.5, v: 1 - 218 / 544, r: 84 / 384, rim: 93 / 384 };
  const rim = new THREE.Mesh(new THREE.TorusGeometry(sp.rim * FW, 0.0021, 8, 56), mats.get('chrome'));
  rim.position.copy(at(sp, 0.0008));
  root.add(noRaycast(rim));
  // 通話鍵（嵌在印好的凹座裡）＋凹座內的發光環
  const bt = lay.button || { u: 262 / 384, v: 1 - 372 / 544, r: 40 / 384, well: 42 / 384 };
  const btnR = bt.r * FW * 0.86;
  const wellR = (bt.well ?? bt.r) * FW;
  const btn = new THREE.Mesh(new THREE.CylinderGeometry(btnR, btnR, 0.012, 28), mats.get('greyPlastic'));
  btn.rotation.x = Math.PI / 2; btn.position.copy(at(bt, 0.006));
  root.add(btn);
  room.intercomRingMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry((btnR + wellR) / 2, Math.max(0.0012, (wellR - btnR) * 0.42), 8, 40), room.intercomRingMat);
  ring.position.copy(at(bt, 0.0012));
  root.add(noRaycast(ring));
  // 通話燈：唯一的通話指示燈，坐在印好的（未點亮）燈座上
  const ld = lay.led || { u: 104 / 384, v: 1 - 372 / 544, r: 12 / 384 };
  const led = new SingleLed({ radius: ld.r * FW * 0.82, glowTex: room.glowTex, glowSize: 0.05 });
  led.group.position.copy(at(ld, 0.0004));
  root.add(led.group);
  root.add(hitbox(0.3, 0.42, 0.08, 0, 0, 0.02));
  group.add(root);
  room.objects.intercom = root;
  room.parts.intercom = { led, ring, btn };
}

// ---------------------------------------------------------------------------
// 通風控制面板（東牆，朝 -X）
// 3D 轉速表指針/玻璃/鍍鉻外圈、三顆狀態燈（運轉/異常/停止）與拉桿，全部依面板圖的 layout 對位：
// 印好的 RPM 錶盤（0–18 ×100，-135°..+135°）就是唯一的錶盤；拉桿從印好的拉桿槽伸出，上 = 運轉、下 = 重啟。
// ---------------------------------------------------------------------------
function buildVentPanel(room) {
  const { L, mats, group } = room;
  const vp = L.ventPanel;
  const root = new THREE.Group();
  root.name = 'ventPanel';
  root.position.set(vp.x, vp.y, vp.z);
  root.rotation.y = -Math.PI / 2;
  const FW = 0.385, FH = 0.485, FZ = 0.0305;
  const tex = room.tex.panel('vent');
  const lay = tex.userData?.layout || {};
  const at = (u, v, dz = 0) => new THREE.Vector3((u - 0.5) * FW, (v - 0.5) * FH, FZ + dz);
  const b = new Batcher(UVS);
  b.rbox('panelGrey', 0.4, 0.5, 0.06, 0.008, 0, 0, 0);
  for (const [x, y] of [[-0.18, 0.23], [0.18, 0.23], [-0.18, -0.23], [0.18, -0.23]]) b.cyl('chrome', 0.007, 0.007, 0.004, x, y, 0.031, { rx: Math.PI / 2 }, 8);
  b.build((k) => mats.get(k), root, { name: 'ventPanel' });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(FW, FH), mats.make({ map: tex, roughness: 0.55 }, 'cr:ventFace'));
  face.position.z = FZ;
  root.add(face);
  // 轉速表：鍍鉻外圈（壓在印好的錶框上）、指針、軸蓋、玻璃
  const gg = lay.gauge || { u: 0.5, v: 1 - 250 / 640, r: 118 / 512 };
  const gc = at(gg.u, gg.v);
  const gR = gg.r * FW;                         // 錶面半徑（m）
  const bezel = new THREE.Mesh(new THREE.TorusGeometry(gR * 1.07, 0.0045, 10, 56), mats.get('chrome'));
  bezel.position.set(gc.x, gc.y, FZ + 0.003);
  root.add(noRaycast(bezel));
  const needle = new THREE.Group();
  needle.position.set(gc.x, gc.y, FZ + 0.004);
  const nLen = gR * 0.86;
  const nm = new THREE.Mesh(new THREE.BoxGeometry(0.0032, nLen, 0.0012), mats.make({ color: 0xb01a10, roughness: 0.4, emissive: 0x200000 }, 'cr:needle'));
  nm.position.y = nLen / 2 - 0.008;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.004, 14), mats.get('blackPlastic'));
  cap.rotation.x = Math.PI / 2; cap.position.z = 0.001;
  needle.add(nm, cap);
  root.add(noRaycast(needle));
  const glass = new THREE.Mesh(new THREE.CircleGeometry(gR * 1.04, 48), mats.make({ color: 0x111111, roughness: 0.05, transparent: true, opacity: 0.13, depthWrite: false }, 'cr:dialGlass'));
  glass.position.set(gc.x, gc.y, FZ + 0.0075);
  root.add(noRaycast(glass));
  // 狀態燈：運轉（綠）／異常（琥珀）／停止（紅），各自坐在印好的（未點亮）燈座上
  const ledLay = lay.leds || [{ u: 150 / 512, v: 1 - 462 / 640, r: 13 / 512 }, { u: 0.5, v: 1 - 462 / 640, r: 13 / 512 }, { u: 362 / 512, v: 1 - 462 / 640, r: 13 / 512 }];
  const mk = (o) => {
    const l = new SingleLed({ radius: o.r * FW * 0.8, glowTex: room.glowTex, glowSize: 0.055 });
    l.group.position.copy(at(o.u, o.v, 0.0004));
    root.add(l.group);
    return l;
  };
  const leds = { run: mk(ledLay[0]), fault: mk(ledLay[1]), stop: mk(ledLay[2]) };
  // 拉桿：軸在面板後方、從印好的拉桿槽中央伸出；繞水平軸轉動，桿頭在槽的上端（運轉）與下端（重啟）之間移動，
  // 拉下時也不會超出面板下緣
  const lv = lay.lever || { u: 0.5, vTop: 1 - 516 / 640, vBottom: 1 - 568 / 640 };
  const ly0 = (lv.vTop - 0.5) * FH, ly1 = (lv.vBottom - 0.5) * FH;
  const lever = new THREE.Group();
  lever.name = 'ventLever';
  lever.position.set((lv.u - 0.5) * FW, (ly0 + ly1) / 2, FZ - 0.012);
  const ARM = 0.06;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0065, ARM, 12), mats.get('chrome'));
  arm.position.y = ARM / 2;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0125, 16, 12), mats.get('extRed'));
  knob.position.y = ARM;
  lever.add(arm, knob, hitbox(0.06, 0.1, 0.06, 0, ARM * 0.6, 0));
  lever.rotation.x = room.LEVER_UP;
  root.add(lever);
  group.add(root);
  room.objects.ventPanel = root;
  room.objects.ventLever = lever;
  room.parts.vent = { needle, led: leds.fault, leds, lever, gaugeMax: gg.max || 1800 };
}

// ---------------------------------------------------------------------------
// 緊急手電筒箱（東牆，朝 -X）
// ---------------------------------------------------------------------------
function buildFlashlightBox(room) {
  const { L, mats, group } = room;
  const fb = L.flashlightBox;
  const root = new THREE.Group();
  root.name = 'flashlightBox';
  root.position.set(fb.x, fb.y, fb.z);
  root.rotation.y = -Math.PI / 2;
  const b = new Batcher(UVS);
  const inner = 'consoleDark';
  b.box('paintedRed', 0.25, 0.34, 0.006, 0, 0, -0.037);
  b.box(inner, 0.236, 0.326, 0.002, 0, 0, -0.033);
  for (const sx of [-1, 1]) b.box('paintedRed', 0.006, 0.34, 0.14, sx * 0.122, 0, 0.03);
  for (const sy of [-1, 1]) b.box('paintedRed', 0.25, 0.006, 0.14, 0, sy * 0.167, 0.03);
  b.box('paintedRed', 0.25, 0.08, 0.008, 0, 0.13, 0.098);
  b.box('paintedRed', 0.25, 0.035, 0.008, 0, -0.152, 0.098);
  // 充電座＋夾具
  b.box('blackPlastic', 0.2, 0.025, 0.06, 0, -0.095, 0.01);
  b.box('blackPlastic', 0.04, 0.05, 0.03, 0.06, -0.07, -0.005);
  b.box('blackPlastic', 0.04, 0.05, 0.03, -0.06, -0.07, -0.005);
  b.build((k) => mats.get(k), root, { name: 'flashlightBox' });
  // 標示牌帶一點蓄光（停電時在黑暗中仍隱約可見）
  const flTex = room.tex.panel('flashlightBox');
  const head = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.072), mats.make({ map: flTex, emissiveMap: flTex, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.5 }, 'cr:flFace'));
  head.position.set(0, 0.13, 0.1025);
  root.add(head);
  // 手電筒（橫放在夾具上）
  const fl = new THREE.Group();
  fl.name = 'flashlight';
  const flb = new Batcher(UVS);
  flb.cyl('yellow', 0.02, 0.02, 0.15, 0.015, 0, 0, { rz: Math.PI / 2 }, 16);
  flb.cyl('blackPlastic', 0.03, 0.022, 0.05, -0.085, 0, 0, { rz: Math.PI / 2 }, 18);
  flb.cyl('blackPlastic', 0.0205, 0.0205, 0.025, 0.1, 0, 0, { rz: Math.PI / 2 }, 16);
  flb.box('rubber', 0.03, 0.006, 0.014, 0.0, 0.02, 0);
  flb.cyl('chrome', 0.031, 0.031, 0.006, -0.11, 0, 0, { rz: Math.PI / 2 }, 18);
  flb.build((k) => (k === 'yellow' ? room.mats.make({ color: 0xc89b1c, roughness: 0.45 }, 'cr:flYellow') : mats.get(k)), fl, { name: 'flashlight' });
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 20), mats.make({ color: 0xcfd8dc, roughness: 0.05, metalness: 0.6 }, 'cr:flLens'));
  lens.position.x = -0.1135; lens.rotation.y = -Math.PI / 2;
  fl.add(lens);
  fl.position.set(0, -0.045, 0.02);
  root.add(fl);
  // 充電指示燈（不斷電）
  const led = new SingleLed({ radius: 0.005, glowTex: room.glowTex, glowSize: 0.035 });
  led.group.position.set(0.075, -0.095, 0.041);
  root.add(led.group);
  root.add(hitbox(0.27, 0.36, 0.16, 0, 0, 0.03));
  group.add(root);
  room.objects.flashlightBox = root;
  room.parts.flashlight = { fl, led };
}

// ---------------------------------------------------------------------------
// 側門（東牆；鉸鏈 z = hingeZ，向外 +X 開）
// ---------------------------------------------------------------------------
/**
 * 側門門扇 UV：整片門扇（寬 w、高 h；門扇區域座標 z ∈ [0,w]、y ∈ [0,h]）只貼一次 steelDoorSide。
 * 室內側（法線 -X，面向 +X 看時 +Z 在右）u 沿 +Z；廊道側（+X）u 沿 -Z，兩面的字/紋理都不會左右顛倒。
 */
function doorUV(g, w, h) {
  const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / w, y = pos.getY(i) / h;
    uv.setXY(i, nrm.getX(i) > 0.5 ? 1 - z : z, y);
  }
  uv.needsUpdate = true;
  return g;
}
function buildSideDoor(room) {
  const { L, mats, group } = room;
  const B = room.sb;
  const sd = L.sideDoor;
  const E = L.maxX; // 4
  const z0 = sd.hingeZ, z1 = sd.hingeZ + sd.width;
  // 室內側門框
  B.box('frameSteel', 0.03, sd.height + 0.07, 0.07, E - 0.015, (sd.height + 0.07) / 2, z0 - 0.035);
  B.box('frameSteel', 0.03, sd.height + 0.07, 0.07, E - 0.015, (sd.height + 0.07) / 2, z1 + 0.035);
  B.box('frameSteel', 0.03, 0.07, z1 - z0 + 0.14, E - 0.015, sd.height + 0.035, (z0 + z1) / 2);
  // 門檔
  B.box('frameSteel', 0.025, sd.height, 0.025, E + 0.1075, sd.height / 2, z1 - 0.0125);
  B.box('frameSteel', 0.025, 0.025, z1 - z0, E + 0.1075, sd.height - 0.0125, (z0 + z1) / 2);
  // 電磁鎖（門楣下）
  B.box('panelGrey', 0.06, 0.06, 0.36, E + 0.08, sd.height - 0.055, z1 - 0.22);
  const maglockLed = new SingleLed({ radius: 0.0055, glowTex: room.glowTex, glowSize: 0.05 });
  maglockLed.group.position.set(E + 0.049, sd.height - 0.055, z1 - 0.08); maglockLed.group.rotation.y = -Math.PI / 2;
  group.add(maglockLed.group);

  // ---- 門扇 ----
  const pivot = new THREE.Group();
  pivot.name = 'sideDoor';
  pivot.position.set(E + 0.17, 0, z0);
  const b = new Batcher(UVS);
  const t = 0.05, wz0 = 0.4, wz1 = 0.62, wy0 = 1.3, wy1 = 1.8;
  const slab = (za, zb, ya, yb) => doorUV(b.box('sideDoor', t, yb - ya, zb - za, -t / 2, (ya + yb) / 2, (za + zb) / 2), sd.width, sd.height);
  slab(0.006, 0.994, 0.006, wy0);
  slab(0.006, 0.994, wy1, sd.height - 0.006);
  slab(0.006, wz0, wy0, wy1);
  slab(wz1, 0.994, wy0, wy1);
  // 窗框膠條
  for (const [w, h, y, z] of [[wz1 - wz0 + 0.03, 0.015, wy0 - 0.0075, (wz0 + wz1) / 2], [wz1 - wz0 + 0.03, 0.015, wy1 + 0.0075, (wz0 + wz1) / 2], [0.015, wy1 - wy0, (wy0 + wy1) / 2, wz0 - 0.0075], [0.015, wy1 - wy0, (wy0 + wy1) / 2, wz1 + 0.0075]]) {
    b.box('rubber', 0.056, h, w, -t / 2, y, z);
  }
  // 推桿
  b.box('darkMetal', 0.04, 0.085, 0.8, -t - 0.02, 1.0, 0.5);
  b.box('chrome', 0.022, 0.06, 0.6, -t - 0.051, 1.0, 0.56);
  b.box('darkMetal', 0.05, 0.12, 0.1, -t - 0.025, 1.0, 0.08);
  // 踢腳板
  b.box('alu', 0.004, 0.24, 0.94, -t - 0.002, 0.13, 0.5);
  // 外側拉手、鉸鏈、電磁鎖吸板
  b.box('chrome', 0.04, 0.2, 0.025, 0.02, 1.0, 0.9);
  for (const y of [0.3, 1.05, 1.8]) b.cyl('chrome', 0.012, 0.012, 0.11, 0.004, y, 0.0, {}, 10);
  b.box('darkMetal', 0.012, 0.045, 0.26, -t - 0.006, sd.height - 0.055, 0.78);
  b.build((k) => mats.get(k), pivot, { name: 'sideDoor' });
  // 鐵絲網玻璃
  const glassMat = mats.make({ color: 0x9fb0a8, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }, 'cr:wireGlass');
  const wireMat = mats.make({ map: LT.wireGlassTexture(), color: 0x444844, transparent: true, alphaTest: 0.4, roughness: 0.5, metalness: 0.6, side: THREE.DoubleSide }, 'cr:wire');
  const gw = wz1 - wz0, gh = wy1 - wy0;
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), glassMat);
  glass.rotation.y = Math.PI / 2; glass.position.set(-t / 2, (wy0 + wy1) / 2, (wz0 + wz1) / 2);
  const wg = new THREE.PlaneGeometry(gw, gh);
  wg.attributes.uv.array.forEach((v, i, arr) => { arr[i] = v * (i % 2 === 0 ? gw / 0.025 / 4 : gh / 0.025 / 4); });
  const wire = new THREE.Mesh(wg, wireMat);
  wire.rotation.y = Math.PI / 2; wire.position.set(-t / 2 + 0.001, (wy0 + wy1) / 2, (wz0 + wz1) / 2);
  pivot.add(glass, wire);
  // 門上銘牌
  const plate = room.tex.sign('地下公務維修廊道', { style: 'plate', w: 512, h: 120 });
  const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.08), mats.make({ map: plate, roughness: 0.45, metalness: 0.4 }, 'cr:doorPlate'));
  pm.rotation.y = -Math.PI / 2; pm.position.set(-t - 0.001, 1.92, 0.51);
  pivot.add(noRaycast(pm));
  group.add(pivot);
  room.objects.sideDoor = pivot;
  // 緊急出口燈（電池供電）
  const exitTex = room.tex.sign('緊急出口', { style: 'exit', w: 512, h: 200 });
  room.exitMat = mats.make({ map: exitTex, emissiveMap: exitTex, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 }, 'cr:exit');
  B.box('whiteEnamel', 0.05, 0.16, 0.4, E - 0.025, sd.height + 0.2, (z0 + z1) / 2);
  const ex = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.14), room.exitMat);
  ex.rotation.y = -Math.PI / 2; ex.position.set(E - 0.0505, sd.height + 0.2, (z0 + z1) / 2);
  group.add(noRaycast(ex));
  // 牆面噴漆指引
  const sten = room.tex.sign('地下公務維修廊道', { sub: '電閘室 →', style: 'stencil', w: 512, h: 160 });
  wallPlane(room, 'east', 0.3, 2.32, 0.84, 0.26, mats.make({ map: sten, transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }, 'cr:wallStencil'), 0.003);
  room.parts.side = { pivot, maglockLed };
}

// ---------------------------------------------------------------------------
// 檔案櫃、咖啡台、公佈欄、滅火器
// ---------------------------------------------------------------------------
function buildFurniture(room) {
  const { L, mats, group } = room;
  const B = room.sb;
  const S = L.maxZ;
  // 檔案櫃 x3（南牆）
  [-2.76, -2.24, -1.72].forEach((x, ci) => {
    const fz = S - 0.62;
    B.box('cabinet', 0.5, 1.32, 0.6, x, 0.66, S - 0.3);
    for (let k = 0; k < 4; k++) {
      const y = 0.18 + k * 0.32;
      const out = ci === 1 && k === 2 ? 0.07 : 0;
      B.rbox('cabinet', 0.47, 0.3, 0.02, 0.004, x, y, fz - 0.01 - out);
      if (out) {
        B.box('cabinet', 0.004, 0.24, out, x - 0.22, y, fz - out / 2);
        B.box('cabinet', 0.004, 0.24, out, x + 0.22, y, fz - out / 2);
        B.box('paper', 0.4, 0.2, out - 0.01, x, y + 0.03, fz - out / 2);
      }
      B.box('chrome', 0.14, 0.022, 0.025, x, y + 0.06, fz - 0.03 - out);
      B.box('chrome', 0.085, 0.045, 0.006, x, y + 0.11, fz - 0.023 - out);
      B.box('paper', 0.075, 0.035, 0.004, x, y + 0.11, fz - 0.024 - out);
    }
  });
  // 櫃頂雜物：檔案盒、乾枯盆栽、收音機
  B.box('cardboard', 0.32, 0.26, 0.38, -2.78, 1.32 + 0.13, S - 0.3, { ry: 0.12 });
  B.box('cardboard', 0.33, 0.012, 0.39, -2.78, 1.32 + 0.265, S - 0.3, { ry: 0.12 });
  B.box('paper', 0.08, 0.05, 0.002, -2.78 + 0.02, 1.32 + 0.16, S - 0.3 - 0.197, { ry: 0.12 });
  B.cyl('extRed', 0.08, 0.06, 0.13, -1.72, 1.32 + 0.065, S - 0.32, {}, 16);
  B.cyl('consoleDark', 0.075, 0.075, 0.004, -1.72, 1.32 + 0.12, S - 0.32, {}, 16);
  for (let k = 0; k < 7; k++) {
    const a = k * 0.9;
    B.cyl('cork', 0.003, 0.002, 0.28 + (k % 3) * 0.07, -1.72 + Math.cos(a) * 0.02, 1.32 + 0.24, S - 0.32 + Math.sin(a) * 0.02, { rx: Math.sin(a) * 0.35, rz: Math.cos(a) * 0.35 }, 5);
  }
  B.rbox('blackPlastic', 0.26, 0.13, 0.09, 0.01, -2.26, 1.32 + 0.065, S - 0.33, { ry: -0.15 });
  B.cyl('chrome', 0.003, 0.003, 0.3, -2.17, 1.32 + 0.25, S - 0.33, { rz: 0.4 }, 5);

  // 咖啡台
  const cx = 1.55, cw = 1.4, cd = 0.55;
  B.box('cabinet', cw, 0.86, cd, cx, 0.43, S - cd / 2);
  B.box('consoleTop', cw + 0.04, 0.035, cd + 0.03, cx, 0.8775, S - cd / 2 - 0.015);
  for (const dx of [-0.35, 0.35]) {
    B.rbox('cabinet', cw / 2 - 0.03, 0.78, 0.02, 0.004, cx + dx, 0.43, S - cd - 0.008);
    B.box('chrome', 0.012, 0.12, 0.02, cx + dx + (dx < 0 ? 0.28 : -0.28), 0.68, S - cd - 0.025);
  }
  // 咖啡機
  const mx = 1.2, mz = S - 0.25, ty = 0.895;
  B.rbox('blackPlastic', 0.22, 0.04, 0.26, 0.008, mx, ty + 0.02, mz);
  B.rbox('blackPlastic', 0.22, 0.38, 0.1, 0.01, mx, ty + 0.19, mz + 0.08);
  B.rbox('blackPlastic', 0.22, 0.07, 0.24, 0.01, mx, ty + 0.38, mz + 0.01);
  B.cyl('darkMetal', 0.07, 0.07, 0.006, mx, ty + 0.043, mz - 0.03, {}, 24);
  const carafeMat = mats.make({ color: 0x8a6a4a, roughness: 0.05, transparent: true, opacity: 0.35, depthWrite: false }, 'cr:carafe');
  const carafe = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.068, 0.13, 20, 1, true), carafeMat);
  carafe.position.set(mx, ty + 0.112, mz - 0.03);
  group.add(noRaycast(carafe));
  B.cyl('blackPlastic', 0.062, 0.062, 0.02, mx, ty + 0.18, mz - 0.03, {}, 20);
  B.box('blackPlastic', 0.02, 0.09, 0.03, mx + 0.08, ty + 0.11, mz - 0.03);
  room.leds.add(new THREE.Vector3(mx + 0.07, ty + 0.03, mz - 0.131), new THREE.Vector3(0, 0, -1), 'red', { group: 'mains' });
  // 糖罐、紙杯
  B.cyl('alu', 0.05, 0.05, 0.12, 1.55, ty + 0.06, S - 0.22, {}, 18);
  B.cyl('paper', 0.04, 0.03, 0.18, 1.78, ty + 0.09, S - 0.2, {}, 14);
  B.cyl('ceramic', 0.04, 0.036, 0.09, 1.95, ty + 0.045, S - 0.3, {}, 18);
  // 公佈欄
  const bw = 1.3, bh = 0.72, by = 1.68;
  B.add('alu', frameGeom(bw + 0.04, bh + 0.04, bw, bh, 0.02, { r: 0.004, ir: 0.002 }), T({ x: cx, y: by, z: S, ry: Math.PI }));
  wallPlane(room, 'south', cx, by, bw, bh, mats.get('cork'), 0.01);

  // 滅火器（東牆，側門南邊）
  const ex = L.maxX - 0.12, ez = 3.05;
  B.cyl('extRed', 0.075, 0.075, 0.46, ex, 0.55, ez, {}, 24);
  B.add('extRed', new THREE.SphereGeometry(0.075, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), T({ x: ex, y: 0.78, z: ez }));
  B.cyl('extRed', 0.072, 0.075, 0.03, ex, 0.335, ez, {}, 24);
  B.cyl('darkMetal', 0.022, 0.026, 0.06, ex, 0.88, ez, {}, 12);
  B.box('chrome', 0.03, 0.012, 0.12, ex, 0.93, ez - 0.04, { rx: 0.25 });
  B.box('chrome', 0.03, 0.012, 0.11, ex, 0.9, ez - 0.035, { rx: 0.05 });
  B.add('blackPlastic', new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(ex, 0.88, ez + 0.02), new THREE.Vector3(ex - 0.03, 0.82, ez + 0.09), new THREE.Vector3(ex - 0.06, 0.55, ez + 0.08), new THREE.Vector3(ex - 0.07, 0.4, ez + 0.05),
  ]), 20, 0.009, 6, false), null, { uv: 1 });
  B.box('darkMetal', 0.04, 0.05, 0.17, L.maxX - 0.02, 0.7, ez);
  B.box('darkMetal', 0.12, 0.03, 0.17, ex + 0.04, 0.64, ez, { rz: 0 });
  const exSign = room.tex.sign('滅火器', { style: 'plate', w: 256, h: 96 });
  wallPlane(room, 'east', ez, 2.22, 0.26, 0.098, mats.make({ map: exSign, roughness: 0.5 }, 'cr:exSign'), 0.004);
}
