// =============================================================================
// 電閘室（電氣室）：總開關面板（南牆）＋大拉桿、配電櫃、牆掛分電盤、
// 東牆鐵架（掛外套、雨鞋、紙箱、備用燈管）、開著的鐵門、橡膠絕緣墊。
// =============================================================================
import * as THREE from 'three';
import { box, boxC, tube, xform, Batch } from './geo.js';
import * as TX from './tex.js';

const PI = Math.PI;
/** 總開關拉桿角度（繞本地 X 軸）：OFF 朝前下方、ON 朝前上方。 */
export const LEVER_OFF = 0.5, LEVER_ON = -0.5;

export function buildSwitchRoom(ctx, root, mats, d) {
  const T = ctx.textures;
  const S = d.S;
  const out = { obstacles: [], gauges: [], leds: {} };
  const B = new Batch({ chunk: 100, origin: 0 });
  const col = (h) => new THREE.Color(h);

  // ---------------------------------------------------------------------------
  // 1. 總開關面板（objects.breaker）：本地 +Z 為正面，群組轉 π 讓正面朝 -Z
  // ---------------------------------------------------------------------------
  const panelTex = T.createPanelGraphic('breaker');
  const lay = panelTex?.userData?.layout || {};
  const aspect = panelTex?.userData?.aspect || 0.75;
  const PH = 0.9, PW = PH * aspect, PD = 0.17;
  const breaker = new THREE.Group(); breaker.name = 'breaker';
  breaker.position.set(S.breaker.x, S.breaker.y, S.maxZ - PD);
  breaker.rotation.y = PI;
  root.add(breaker);
  const enclosure = new THREE.Mesh(box(-PW / 2 - 0.03, PW / 2 + 0.03, -PH / 2 - 0.03, PH / 2 + 0.03, 0, PD, { faces: 'pz px nx py ny', local: false }), mats.cabinet);
  enclosure.position.z = -PD; enclosure.castShadow = true; enclosure.receiveShadow = true;
  breaker.add(enclosure);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshStandardMaterial({ map: panelTex, roughness: 0.6, metalness: 0.25 }));
  face.position.z = 0.003; face.receiveShadow = true; breaker.add(face);
  // 門縫與鉸鏈
  const trim = new THREE.Mesh(box(-PW / 2 - 0.03, -PW / 2 - 0.015, -PH / 2, PH / 2, 0, 0.012), mats.metalDark); breaker.add(trim);
  for (const hy of [-PH * 0.35, PH * 0.35]) {
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.08, 10), mats.steel);
    h.position.set(-PW / 2 - 0.03, hy, 0.008); breaker.add(h);
  }
  // 拉桿：樞軸在面板後方，臂伸出槽口，T 字紅色握把
  const lv = lay.lever || { u: 0.5, vTop: 0.522, vBottom: 0.234 };
  const slotY = ((lv.vTop + lv.vBottom) / 2 - 0.5) * PH, slotX = (lv.u - 0.5) * PW;
  const lever = new THREE.Group(); lever.name = 'breakerLever';
  lever.position.set(slotX, slotY, -0.06);
  const armMat = mats.steel;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.02, 0.22), armMat);
  arm.position.z = 0.11; arm.castShadow = true; lever.add(arm);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 16), mats.metalDark);
  hub.rotation.z = PI / 2; lever.add(hub);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.15, 18), mats.gripRed);
  grip.rotation.z = PI / 2; grip.position.z = 0.22; grip.castShadow = true; lever.add(grip);
  for (const s of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), mats.gripRed);
    cap.position.set(s * 0.075, 0, 0.22); cap.scale.set(0.5, 1, 1); lever.add(cap);
  }
  lever.rotation.x = LEVER_OFF;                // 下＝OFF（跳脫）
  breaker.add(lever);
  // 槽口背後的黑色縫（拉桿穿過處）
  const slotDark = new THREE.Mesh(new THREE.PlaneGeometry(0.03, Math.abs(lv.vTop - lv.vBottom) * PH), mats.black);
  slotDark.position.set(slotX, slotY, 0.0035); breaker.add(slotDark);
  // 狀態燈（依貼圖版面；'供電' 綠 / '跳脫' 琥珀）
  const leds = lay.leds || [{ u: 0.854, v: 0.484, r: 0.025, label: '供電', color: [70, 200, 90] }, { u: 0.854, v: 0.344, r: 0.025, label: '跳脫', color: [235, 150, 40] }];
  for (const l of leds) {
    const c = new THREE.Color(l.color[0] / 255, l.color[1] / 255, l.color[2] / 255);
    const m = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.25), roughness: 0.25, emissive: c, emissiveIntensity: 0 });
    const lens = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.008, (l.r || 0.025) * PW * 0.85), 14, 8, 0, PI * 2, 0, PI / 2), m);
    lens.rotation.x = PI / 2; lens.position.set((l.u - 0.5) * PW, (l.v - 0.5) * PH, 0.004);
    breaker.add(lens);
    if (/供電|power/i.test(l.label)) out.leds.power = m; else out.leds.trip = m;
  }
  out.breaker = breaker; out.lever = lever;
  out.obstacles.push({ minX: S.breaker.x - PW / 2 - 0.08, maxX: S.breaker.x + PW / 2 + 0.08, minZ: S.maxZ - PD - 0.3, maxZ: S.maxZ });
  // 面板上方的警告牌、頂部導線管、兩側小斷路器箱、地上絕緣墊
  addPlane(root, T.createSign('高壓危險', { sub: '操作前確認無人作業', style: 'warning', w: 512, h: 160 }), [S.breaker.x, 2.12, S.maxZ - 0.004], 0.56, 0.175, [0, PI, 0]);
  for (const ox of [-0.18, 0, 0.18]) B.add(mats.pipe, tube([S.breaker.x + ox, S.breaker.y + PH / 2 + 0.03, S.maxZ - 0.06], [S.breaker.x + ox, S.height, S.maxZ - 0.06], 0.018, { segs: 8 }), { color: col(0x707571) });
  for (const [bx, lab] of [[S.breaker.x - 0.95, 'MCB-B2-1'], [S.breaker.x + 0.95, 'MCB-B2-3']]) {
    B.add(mats.cabinet, box(bx - 0.2, bx + 0.2, 1.1, 1.6, S.maxZ - 0.14, S.maxZ, { faces: 'nz px nx py ny' }));
    B.add(mats.metalDark, box(bx - 0.03, bx + 0.03, 1.28, 1.42, S.maxZ - 0.17, S.maxZ - 0.14));
    B.add(mats.pipe, tube([bx, 1.6, S.maxZ - 0.06], [bx, S.height, S.maxZ - 0.06], 0.018, { segs: 8 }), { color: col(0x707571) });
    addPlane(root, T.createLabel(lab, { w: 256, h: 64, bg: '#e9e4d2', fg: '#1c1c1c', size: 30 }), [bx, 1.54, S.maxZ - 0.141], 0.18, 0.045, [0, PI, 0]);
  }
  out.obstacles.push({ minX: S.breaker.x - 1.2, maxX: S.breaker.x + 1.2, minZ: S.maxZ - 0.2, maxZ: S.maxZ });
  {
    const mat = T.material('rubberMat', { repeat: [1, 1], color: 0x7a7a7a });
    const m = new THREE.Mesh(box(S.breaker.x - 0.7, S.breaker.x + 0.7, 0, 0.012, S.maxZ - 1.05, S.maxZ - 0.22, { faces: 'py px nx pz nz' }), mat);
    m.receiveShadow = true; root.add(m);
  }

  // ---------------------------------------------------------------------------
  // 2. 西牆配電櫃 ×3（儀表、指示燈、百葉、銘牌）
  // ---------------------------------------------------------------------------
  const cx0 = S.minX, cDepth = 0.55, cH = 2.05;
  const doorMat = T.material('metalPanel', { repeat: [1, 1] });
  const gaugeTex = [TX.gaugeTexture('V', 500), TX.gaugeTexture('A', 400), TX.gaugeTexture('V', 500)];
  const labels = ['隧道中段 動力', '隧道中段 照明', '監控 / 通訊'];
  const zStart = 8.75;
  for (let i = 0; i < 3; i++) {
    const zc = zStart + 0.4 + i * 0.82, z0 = zc - 0.4, z1 = zc + 0.4;
    B.add(mats.cabinet, box(cx0, cx0 + cDepth, 0.08, cH, z0, z1, { faces: 'px py pz nz' }));
    B.add(mats.black, box(cx0, cx0 + cDepth - 0.03, 0, 0.08, z0 + 0.02, z1 - 0.02, { faces: 'px pz nz' }));
    const door = new THREE.Mesh(box(cx0 + cDepth, cx0 + cDepth + 0.012, 0.12, cH - 0.04, z0 + 0.025, z1 - 0.025, { faces: 'px', local: true }), doorMat);
    door.receiveShadow = true; root.add(door);
    // 百葉
    for (let k = 0; k < 6; k++) B.add(mats.metalDark, box(cx0 + cDepth + 0.012, cx0 + cDepth + 0.03, 0.25 + k * 0.045, 0.27 + k * 0.045, z0 + 0.12, z1 - 0.12, { faces: 'px py' }));
    // 把手
    B.add(mats.steel, box(cx0 + cDepth + 0.012, cx0 + cDepth + 0.045, 0.95, 1.18, z1 - 0.1, z1 - 0.08));
    // 儀表
    const gx = cx0 + cDepth + 0.012, gy = 1.62;
    B.add(mats.metalDark, tube([gx, gy, zc - 0.12], [gx + 0.014, gy, zc - 0.12], 0.086, { segs: 28 }));
    const bz = new THREE.TorusGeometry(0.083, 0.006, 6, 28); xform(bz, { pos: [gx + 0.014, gy, zc - 0.12], rot: [0, PI / 2, 0] }); B.add(mats.metalDark, bz);
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.08, 32), new THREE.MeshStandardMaterial({ map: gaugeTex[i], roughness: 0.4 }));
    dial.position.set(gx + 0.004, gy, zc - 0.12); dial.rotation.y = PI / 2; root.add(dial);
    const needle = new THREE.Mesh(new THREE.BoxGeometry(0.0028, 0.066, 0.0012), mats.needle);
    needle.geometry.translate(0, 0.026, 0);
    const pivot = new THREE.Group(); pivot.position.set(gx + 0.007, gy, zc - 0.12); pivot.rotation.y = PI / 2;
    pivot.add(needle); root.add(pivot);
    const cover = new THREE.Mesh(new THREE.CircleGeometry(0.08, 32), mats.cabinetGlass);
    cover.position.set(gx + 0.011, gy, zc - 0.12); cover.rotation.y = PI / 2; cover.renderOrder = 1; root.add(cover);
    out.gauges.push({ pivot, value: 0, target: 0, max: 0.62 + i * 0.06 });
    // 指示燈（不亮）
    for (let k = 0; k < 2; k++) {
      const lm = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 8, 0, PI * 2, 0, PI / 2), k ? mats.lampRed : mats.lampGreenLit);
      lm.rotation.z = -PI / 2; lm.position.set(gx + 0.002, gy - 0.14, zc + 0.05 + k * 0.08); root.add(lm);
    }
    addPlane(root, T.createLabel(labels[i], { w: 256, h: 64, bg: '#e9e4d2', fg: '#1c1c1c', size: 26 }), [gx + 0.004, gy + 0.2, zc], 0.24, 0.06, [0, PI / 2, 0]);
    // 櫃頂導線管
    B.add(mats.pipe, tube([cx0 + 0.2, cH, zc], [cx0 + 0.2, S.height, zc], 0.025, { segs: 8 }), { color: col(0x707571) });
  }
  addPlane(root, T.createSign('有電危險', { sub: '維修時須斷電掛牌', style: 'warning', w: 512, h: 160 }), [cx0 + cDepth + 0.015, 0.68, zStart + 0.4 + 0.82], 0.3, 0.094, [0, PI / 2, 0]);
  out.obstacles.push({ minX: cx0, maxX: cx0 + cDepth + 0.05, minZ: zStart - 0.02, maxZ: zStart + 0.82 * 3 + 0.02 });

  // ---------------------------------------------------------------------------
  // 3. 北牆（門的兩側）：牆掛分電盤、滅火器、開著的鐵門
  // ---------------------------------------------------------------------------
  const nz = S.minZ;
  B.add(mats.cabinet, box(37.05, 37.65, 1.0, 1.8, nz, nz + 0.18, { faces: 'pz px nx py ny' }));
  B.add(mats.metalDark, box(37.08, 37.62, 1.03, 1.77, nz + 0.18, nz + 0.186, { faces: 'pz' }));
  for (const ox of [-0.18, 0, 0.18]) B.add(mats.pipe, tube([37.35 + ox, 1.8, nz + 0.08], [37.35 + ox, S.height, nz + 0.08], 0.016, { segs: 8 }), { color: col(0x707571) });
  addPlane(root, T.createLabel('分電盤 DB-B2', { w: 256, h: 64, bg: '#e9e4d2', fg: '#1c1c1c', size: 30 }), [37.35, 1.68, nz + 0.188], 0.2, 0.05, [0, 0, 0]);
  out.obstacles.push({ minX: 37.0, maxX: 37.7, minZ: nz, maxZ: nz + 0.22 });
  // 滅火器
  {
    const x = 41.62, z = nz + 0.2;
    B.add(mats.red, tube([x, 0.02, z], [x, 0.5, z], 0.075, { segs: 18 }));
    const top = new THREE.SphereGeometry(0.075, 18, 8, 0, PI * 2, 0, PI / 2); xform(top, { pos: [x, 0.5, z] }); B.add(mats.red, top);
    B.add(mats.steel, tube([x, 0.57, z], [x, 0.63, z], 0.016, { segs: 10, caps: true }));
    B.add(mats.black, tube([x, 0.0, z], [x, 0.02, z], 0.078, { segs: 18, caps: true }));
    out.obstacles.push({ minX: x - 0.12, maxX: x + 0.12, minZ: nz, maxZ: z + 0.12 });
  }
  // 開著的鐵門（鉸鏈在門洞東側，向室內開約 100°）
  {
    const hx = d.srDoor.x1, W = d.srDoor.x1 - d.srDoor.x0 - 0.02, Hd = d.srDoor.h - 0.02;
    const g = new THREE.Group(); g.position.set(hx - 0.02, 0, nz + 0.03); g.rotation.y = PI / 2 + 0.17;
    const leaf = new THREE.Mesh(box(-W, 0, 0.01, Hd, -0.025, 0.025, { faces: 'px nx py pz nz' }), mats.door);
    leaf.castShadow = true; leaf.receiveShadow = true; g.add(leaf);
    const hd = new THREE.Mesh(box(-W + 0.06, -W + 0.08, 0.96, 1.06, 0.025, 0.05), mats.steel); g.add(hd);
    const hd2 = new THREE.Mesh(box(-W + 0.06, -W + 0.08, 0.96, 1.06, -0.05, -0.025), mats.steel); g.add(hd2);
    // 門內面（打開後朝向室內西側）上的標示
    const s1 = planeMesh(T.createSign('電閘室', { sub: '閒人勿進', style: 'plate', w: 512, h: 160 }), 0.38, 0.12);
    s1.position.set(-W / 2, 1.55, 0.027); g.add(s1);
    const s2 = planeMesh(T.createSign('高壓危險', { sub: '非工作人員禁止進入', style: 'warning', w: 512, h: 160 }), 0.38, 0.12);
    s2.position.set(-W / 2, 1.55, -0.027); s2.rotation.y = PI; g.add(s2);
    root.add(g);
    // 障礙物（門扇在世界中的包圍盒）
    g.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(leaf);
    out.obstacles.push({ minX: bb.min.x - 0.02, maxX: bb.max.x + 0.02, minZ: bb.min.z - 0.02, maxZ: bb.max.z + 0.02 });
  }

  // ---------------------------------------------------------------------------
  // 4. 東牆鐵架（外套掛在前緣的 S 鉤上）
  // ---------------------------------------------------------------------------
  const rk = S.coatRack;
  const rx0 = S.maxX - 0.55, rx1 = S.maxX - 0.03, rz0 = rk.z - 0.6, rz1 = rk.z + 0.6, rH = 1.86;
  const rackMat = mats.rack;
  for (const [x, z] of [[rx0, rz0], [rx0, rz1], [rx1, rz0], [rx1, rz1]]) B.add(rackMat, boxC(x, rH / 2, z, 0.035, rH, 0.035));
  const shelves = [0.12, 0.62, 1.12, 1.62];
  for (const y of shelves) {
    B.add(mats.shelf, box(rx0, rx1, y - 0.012, y + 0.012, rz0, rz1));
    B.add(rackMat, box(rx0 - 0.02, rx0 + 0.015, y - 0.04, y + 0.012, rz0, rz1, { faces: 'nx py ny' }));
  }
  B.add(rackMat, box(rx0 - 0.02, rx0 + 0.015, rH - 0.05, rH, rz0, rz1));             // 前緣頂樑（掛鉤處）
  // 側面交叉斜撐
  for (const z of [rz0, rz1]) for (const [ya, yb] of [[0.12, 1.12], [1.12, 0.12], [0.62, 1.62], [1.62, 0.62]]) {
    B.add(mats.pipe, tube([rx0 + 0.02, ya, z], [rx1 - 0.02, yb, z], 0.005, { segs: 4 }), { color: col(0x4a5560) });
  }
  // S 鉤
  {
    const hk = new THREE.TorusGeometry(0.022, 0.0035, 6, 14, PI * 1.4); xform(hk, { pos: [rx0 - 0.04, rH - 0.05, rk.z], rot: [0, PI / 2, PI * 0.7] });
    B.add(mats.steel, hk);
    const hk2 = new THREE.TorusGeometry(0.018, 0.0035, 6, 14, PI * 1.3); xform(hk2, { pos: [rx0 - 0.07, rH - 0.1, rk.z], rot: [0, PI / 2, -PI * 0.3] });
    B.add(mats.steel, hk2);
  }
  // 架上物品
  // 雨鞋一雙（底層）
  for (const zz of [rk.z - 0.32, rk.z - 0.12]) {
    const bx = rx0 + 0.22, by = shelves[0] + 0.012;
    B.add(mats.boot, tube([bx + 0.05, by, zz], [bx + 0.05, by + 0.34, zz], 0.058, { segs: 16, caps: true }));
    B.add(mats.boot, boxC(bx - 0.03, by + 0.05, zz, 0.2, 0.1, 0.11));
    B.add(mats.bootSole, boxC(bx - 0.03, by + 0.01, zz, 0.22, 0.02, 0.12));
    B.add(mats.reflectWhite, tube([bx + 0.05, by + 0.28, zz], [bx + 0.05, by + 0.31, zz], 0.059, { segs: 16 }));
  }
  // 紙箱
  const cardMat = new THREE.MeshStandardMaterial({ map: TX.cardboardTexture(), roughness: 0.95 });
  B.add(cardMat, box(rx0 + 0.04, rx0 + 0.42, shelves[0] + 0.012, shelves[0] + 0.3, rk.z + 0.18, rk.z + 0.55, { local: true }));
  B.add(cardMat, box(rx0 + 0.06, rx0 + 0.44, shelves[2] + 0.012, shelves[2] + 0.22, rk.z - 0.5, rk.z - 0.12, { local: true }));
  // 盤繞的繩索
  for (let k = 0; k < 5; k++) {
    const t = new THREE.TorusGeometry(0.15, 0.016, 6, 24); xform(t, { pos: [rx0 + 0.27, shelves[1] + 0.03 + k * 0.026, rk.z - 0.3], rot: [PI / 2, 0, 0] });
    B.add(mats.rope, t);
  }
  // 工具箱
  B.add(mats.red, box(rx0 + 0.06, rx0 + 0.46, shelves[1] + 0.012, shelves[1] + 0.2, rk.z + 0.15, rk.z + 0.37));
  B.add(mats.black, box(rx0 + 0.24, rx0 + 0.28, shelves[1] + 0.2, shelves[1] + 0.24, rk.z + 0.18, rk.z + 0.34));
  // 備用燈管
  for (let k = 0; k < 5; k++) B.add(mats.tubeGlass, tube([rx0 + 0.1 + k * 0.03, shelves[3] + 0.027, rz0 + 0.03], [rx0 + 0.1 + k * 0.03, shelves[3] + 0.027, rz1 - 0.03], 0.013, { segs: 8, caps: true }));
  // 摺疊帆布
  B.add(mats.tarp, box(rx0 + 0.05, rx0 + 0.45, shelves[2] + 0.012, shelves[2] + 0.12, rk.z + 0.1, rk.z + 0.5));
  out.coatHook = new THREE.Vector3(rx0 - 0.07, rH - 0.12, rk.z);
  out.obstacles.push({ minX: rx0 - 0.3, maxX: S.maxX, minZ: rz0 - 0.03, maxZ: rz1 + 0.03 });

  // ---------------------------------------------------------------------------
  // 5. 天花：橫越的電纜架
  // ---------------------------------------------------------------------------
  const ty = S.height - 0.22;
  B.add(mats.tray, box(S.minX, S.maxX, ty, ty + 0.07, S.maxZ - 0.75, S.maxZ - 0.742));
  B.add(mats.tray, box(S.minX, S.maxX, ty, ty + 0.07, S.maxZ - 0.458, S.maxZ - 0.45));
  for (let x = S.minX + 0.15; x < S.maxX; x += 0.3) B.add(mats.tray, box(x - 0.012, x + 0.012, ty, ty + 0.012, S.maxZ - 0.75, S.maxZ - 0.45, { faces: 'py px nx ny' }));
  for (const x of [37.2, 39.2, 41.2]) B.add(mats.pipe, tube([x, ty + 0.07, S.maxZ - 0.6], [x, S.height, S.maxZ - 0.6], 0.006, { segs: 6 }), { color: col(0x4a4d4b) });
  for (const [k, r] of [[0, 0.018], [1, 0.013], [2, 0.02]]) {
    B.add(mats.cable, tube([S.minX, ty + 0.013 + r, S.maxZ - 0.7 + k * 0.09], [S.maxX, ty + 0.013 + r, S.maxZ - 0.7 + k * 0.09], r, { segs: 6 }));
  }

  out.meshes = B.build(root);
  return out;
}

function planeMesh(tex, w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.receiveShadow = true;
  return m;
}
function addPlane(root, tex, pos, w, h, rot) {
  const m = planeMesh(tex, w, h);
  m.position.set(...pos); m.rotation.set(...rot);
  root.add(m);
  return m;
}
