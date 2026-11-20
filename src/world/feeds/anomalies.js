// =============================================================================
// anomalies — 監視器 LD 畫面的「微事件」階段（02:00 → 02:14 監看段落；docs/pacing/spec.md §6.1–6.4、§7.1）
// -----------------------------------------------------------------------------
// 規則（spec §3.1）：
//   * 每個 LD 變化都是同一頻道 HD 真相的一小片，放在 HD 的同一座標 / 同一變換；全部加在頻道的 ld 群組裡
//     （HD 佈置自動隱藏）。
//   * 全部物件在建構時建立（之後只改 visible / opacity / color / intensity / fog 顏色與密度 /
//     map 由一張貼圖換成另一張），不新增燈光、不切換 transparent / fog / map 有無 → 不會在遊戲中重新編譯著色器。
//   * setStage(k) 冪等、絕對：每次都從頭算出第 k 階段的完整 LD 狀態（跳關、重置、除錯走同一條路）。
//   * 什麼時候可以換階段（只在盲區：該頻道沒有顯示 / 沒有被看著）由 CameraFeeds.setAnomalyStage 與
//     MonitoringState 的導演決定；這個檔案只負責「每一階段長什麼樣子」。
//
// 每個頻道得到：ch.stage、ch.maxStage、ch.meanScale（目前階段的 LD 畫面平均亮度 ÷ 第 0 階段，
// 供 CameraFeeds 的 AGC 使用）、ch.meanScales（各階段的表）、ch.setStage(k)。
// =============================================================================
import * as THREE from 'three';
import * as TX from './feedTextures.js';
import { glow, plane, mesh, mergeList, boxG, std, cone, buildTanker, buildTruckCab, silhouetteOf } from './props.js';
import { rng } from '../../core/util.js';

const C = (r, g, b) => new THREE.Color(r, g, b);

/**
 * 各頻道各階段的 LD 畫面平均亮度倍率（相對第 0 階段）。
 * 量測方式：scripts/feed-stages.mjs —— 坐姿看主 CRT（800×450）的螢幕區域平均（線性亮度），
 * 每個階段穩定 2.5 秒（AGC 結束）後取樣，扣掉 CRT 關機時的玻璃反光底值，再除以第 0 階段。
 * 下列為整合時的實測值（feed-stages.mjs --write）。CAM-02 的熱源亮斑本身有 ±8% 的緩慢明暗，量測誤差約 ±3%。
 * CAM-01 第 2 階段（霧轉為煙、洞口光被吞掉）實測 0.40，遠比原估計 0.78 暗——AGC 依此補償，切換進來仍是平順的。
 */
export const MEAN_SCALE = {
  1: [1, 1.02, 0.40],
  2: [1, 1, 0.93, 0.92, 0.83],
  3: [1, 0.92],
  4: [1, 0.97, 0.82],
};
export const MAX_STAGE = { 1: 2, 2: 4, 3: 1, 4: 2 };

// 第 1 階段開始的文字 / 號誌（防禦性讀取：script.js 的 feedSigns 由 WP-C 加入）
const signs = (SCRIPT) => ({
  vmsFog: SCRIPT?.feedSigns?.vmsFog ?? ['濃霧', '減速慢行'],
  vmsClosed: SCRIPT?.feedSigns?.vmsClosed ?? ['隧道封閉'],
});

function hideAll(list) { for (const o of list) o.visible = false; }
function rememberOpacity(list) { for (const s of list) s.userData.baseOpacity = s.material.opacity; }
function scaleOpacity(list, k) { for (const s of list) s.material.opacity = s.userData.baseOpacity * k; }

// =============================================================================
// CAM-01 北向隧道入口：門架號誌 ↓ → ✕、VMS 濃霧 → 隧道封閉；之後霧轉暗、變濃（煙），近處兩盞琥珀色路障燈
// =============================================================================
// 可讀性放大（spec §6.1 的 legibility fallback）：號誌面板與 VMS（連同門架上的外框）以中心為準放大，
// 位置不變。160×120 的 LD 取樣下，原尺寸的號誌只有約 5 px，↓ / ✕ 分不出來。
const LEGIBLE = 1.35;

function install01(ch, SCRIPT) {
  const ld = ch.ld;
  const { vmsFog, vmsClosed } = signs(SCRIPT);
  const L = LEGIBLE;
  // 門架（HD 門架的複製；正常受霧影響 → 霧中一道暗影）
  const gantryM = std({ color: 0x2c2e30, roughness: 0.6, metalness: 0.5 });
  mesh(mergeList([
    boxG(9.6, 0.25, 0.3, 0, 5.1, -10), boxG(0.25, 1.3, 0.25, -4.6, 4.45, -10), boxG(0.25, 1.3, 0.25, 4.6, 4.45, -10),
    boxG(0.9 * L, 0.9 * L, 0.3, -1.9, 4.45, -10), boxG(0.9 * L, 0.9 * L, 0.3, 1.9, 4.45, -10), boxG(3.0 * L, 0.9 * L, 0.25, 0, 5.75, -10.05),
  ]), gantryM, ld);
  // 車道管制號誌面板（LED 發光體穿透霧：fog = false；兩面共用一個材質）
  const arrowT = TX.laneSignalTexture('arrow'), xT = TX.laneSignalTexture('x');
  const sigA = plane(0.78 * L, 0.78 * L, arrowT, { pos: [-1.9, 4.45, -9.84], basic: true, color: C(1.8, 1.8, 1.8) });
  const sigMat = sigA.material;
  sigMat.fog = false;
  const sigB = new THREE.Mesh(sigA.geometry, sigMat);
  sigB.position.set(1.9, 4.45, -9.84);
  ld.add(sigA, sigB);
  const halos = [-1.9, 1.9].map((x) => glow(C(0.5, 1.0, 0.6), [1.8 * L, 1.8 * L], [x, 4.45, -9.7], { opacity: 0.45, fog: false }));
  ld.add(...halos);
  // 可變資訊標誌
  const fogT = TX.vmsTexture(vmsFog), closedT = TX.vmsTexture(vmsClosed);
  const vms = plane(2.8 * L, 0.7 * L, fogT, { pos: [0, 5.75, -9.91], basic: true, color: C(1.7, 1.7, 1.7) });
  vms.material.fog = false;
  ld.add(vms);
  // HD 路障琥珀燈的位置（第 2 階段：霧中兩團低而近的琥珀光）
  const barricade = [[-2.4, 1.2, -6.6], [1.6, 1.2, -7.1]].map((p) => glow(C(1, 0.62, 0.2), [1.6, 1.6], p, { opacity: 0.6 }));
  ld.add(...barricade);
  hideAll(barricade);

  rememberOpacity(ch.ldLampGlows);
  rememberOpacity(ch.ldPortalGlows);
  const fogC0 = ch.fogs.LD.color.clone(), dens0 = ch.fogs.LD.density, bg0 = ch.bg.LD.clone();
  const green = C(0.5, 1.0, 0.6), red = C(1, 0.25, 0.15);
  ch.anomaly = { sigMat, vms, halos, barricade, gantryM };

  return (k) => {
    sigMat.map = k >= 1 ? xT : arrowT;
    vms.material.map = k >= 1 ? closedT : fogT;
    for (const h of halos) { h.material.color.copy(k >= 1 ? red : green); h.material.opacity = k >= 1 ? 0.35 : 0.45; }
    for (const b of barricade) b.visible = k >= 2;
    if (k >= 2) {
      ch.fogs.LD.color.setHex(0x4e4d4b); ch.fogs.LD.density = 0.12; ch.bg.LD.setHex(0x4e4d4b);
    } else {
      ch.fogs.LD.color.copy(fogC0); ch.fogs.LD.density = dens0; ch.bg.LD.copy(bg0);
    }
    scaleOpacity(ch.ldPortalGlows, k >= 2 ? 0.35 : 1);
    scaleOpacity(ch.ldLampGlows, k >= 2 ? 0.6 : 1);
  };
}

// =============================================================================
// CAM-02 主車道中段：拱頂下的黑煙帶 → 遠處燈具熄滅＋熱源裡的油罐車 / 車頭剪影 → 煙帶往鏡頭推進
// =============================================================================
function install02(ch) {
  const ld = ch.ld;
  // 煙帶：14 個深色煙霧 Sprite（z −72 … −7，每 5 m 一個），renderOrder 5 → 畫在加法光暈之後、把它們壓暗。
  // 不受霧影響（fog = false，建構時設定、之後不切換）：受霧的深色煙在 40–70 m 外會被霧色完全取代，
  // 在 LD 畫面上看不出任何變化；黑煙本來就比霧暗。要夠濃、夠寬（蓋到兩側拱腳的燈列），才能讀成
  // 「遠處拱頂下多了一層黑」（spec 的 0.55 / 6–9 m / 受霧 在 160×120 下看不出來）。
  const r = rng(141);
  const tex = TX.smokeSprite(141);
  const mats = [0, 1, 2].map((i) => {
    const m = new THREE.SpriteMaterial({ map: tex, color: 0x101112, transparent: true, opacity: 0.75, depthWrite: false, fog: false });
    m.rotation = i * 2.1;
    return m;
  });
  const smoke = [];
  for (let i = 0; i < 14; i++) {
    const z = -72 + 5 * i;
    const s = new THREE.Sprite(mats[i % 3]);
    s.scale.set(9 + r() * 4, 3.2 + r(), 1);
    // 左、中、右輪替（兩側蓋住拱腳的燈列，中間蓋住拱頂下的熱源亮斑上緣）
    s.position.set(((i % 3) - 1) * 3.2 + (r() - 0.5), 4.5 + r() * 0.8, z);
    s.renderOrder = 5;
    s.userData.z = z;
    smoke.push(s);
    ld.add(s);
  }
  hideAll(smoke);
  // 遠處（z < −40）亮著的燈具：整個包住燈具的暗色外殼（燈具本身的材質不動）
  const shellG = [];
  for (const L of ch.tunnel.lamps) if (L.on > 0 && L.z < -40) shellG.push(boxG(0.3, 0.13, 1.24, L.x, L.y + 0.1, L.z));
  const shells = shellG.length ? mesh(mergeList(shellG), std({ color: 0x1c1c1b, roughness: 0.8 }), ld) : null;
  if (shells) shells.visible = false;
  // 剪影：HD 的翻覆油罐車與車頭，完全相同的位置與變換
  const tanker = silhouetteOf(buildTanker({ seed: 3 }));
  tanker.position.set(0.6, 0, -27.5); tanker.rotation.y = 0.52;
  const cab = silhouetteOf(buildTruckCab({ seed: 4 }));
  cab.position.set(-3.2, 0, -34.5); cab.rotation.set(0, 1.25, 0.06);
  ld.add(tanker, cab);
  const sil = [tanker, cab];
  hideAll(sil);

  const farGlows = ch.ldLampGlows.filter((s) => s.position.z < -40);
  const I2 = ch.ldLights[2].intensity;
  ch.anomaly = { smoke, shells, sil };

  return (k) => {
    const zMax = k >= 4 ? -4 : k >= 3 ? -16 : k >= 1 ? -40 : -Infinity;
    for (const s of smoke) s.visible = s.userData.z <= zMax;
    if (shells) shells.visible = k >= 2;
    for (const s of sil) s.visible = k >= 2;
    for (const g of farGlows) g.visible = k < 2;
    ch.ldLights[2].intensity = k >= 2 ? 8 : I2;
    // 第 1 階段起，煙帶也壓暗一點熱源亮斑（整合時：只有煙帶的話，在 CRT 尺寸下 s0 → s1 幾乎看不出來）
    ch.blobGain = k >= 4 ? 0.6 : k >= 3 ? 0.75 : k >= 1 ? 0.86 : 1;
  };
}

// =============================================================================
// CAM-03 公務維修廊道：地上一道濕黑的拖痕（沿 HD 消防水帶的路徑，只在人影推進時延長）；T2：廊道起霾
// =============================================================================
function buildTrail(path, { width = 0.14, y = 0.006, samples = 160, eye = null, lamp = null, roughness = 0.15, opacity = 0.75 } = {}) {
  const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, y, z)));
  const pts = curve.getSpacedPoints(samples);               // 轉角 → 門（z 遞增）
  const r = rng(303);
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const len = Math.hypot(tx, tz) || 1; tx /= len; tz /= len;
    // 寬度有些許不規則（不是一條等寬的管子）
    const w = width * (0.75 + 0.35 * r() + 0.15 * Math.sin(i * 0.37)) / 2;
    L.push([pts[i].x - tz * w, pts[i].z + tx * w]);
    R.push([pts[i].x + tz * w, pts[i].z - tx * w]);
  }
  const pos = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [l0, r0, l1, r1] = [L[i], R[i], L[i + 1], R[i + 1]];
    // 繞行方向朝上（俯視逆時針）：(l0, l1, r0)、(r0, l1, r1)
    pos.push(l0[0], y, l0[1], l1[0], y, l1[1], r0[0], y, r0[1]);
    pos.push(r0[0], y, r0[1], l1[0], y, l1[1], r1[0], y, r1[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // 法線：在近乎全黑的地板上，一條黑色濕痕完全看不見——濕地面讀得出來，是因為它像鏡子一樣反射遠處的燈。
  // eye + lamp：法線取「鏡頭方向與盡頭燈方向的半向量」，光滑表面就把盡頭那盞燈反射進鏡頭，
  // 在畫面上讀成一道從他身後延伸到廊道盡頭、濕亮的拖痕（整合時在 CRT 尺寸下比較過：朝上 / 朝鏡頭都看不見）。
  // 只有 eye：法線偏向鏡頭（反射鏡頭旁的紅外線補光）。都沒有：朝上。
  const nrm = new Float32Array(pos.length);
  const n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    if (eye) a.set(eye.x - pos[i], eye.y - pos[i + 1], eye.z - pos[i + 2]).normalize();
    if (eye && lamp) n.copy(a).add(b.set(lamp.x - pos[i], lamp.y - pos[i + 1], lamp.z - pos[i + 2]).normalize()).normalize();
    else if (eye) n.copy(a);
    else n.set(0, 1, 0);
    nrm[i] = n.x; nrm[i + 1] = n.y; nrm[i + 2] = n.z;
  }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const mat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness, metalness: 0, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(g, mat);
  m.name = 'trail';
  const zs = pts.map((p) => p.z);
  return {
    mesh: m,
    zs,
    /** 拖痕延伸到 zTarget（含）為止；null = 隱藏。不重建幾何，只改 drawRange。 */
    reach(zTarget) {
      if (zTarget == null) { m.visible = false; g.setDrawRange(0, 0); this.count = 0; return; }
      let n = 0;
      while (n < zs.length && zs[n] <= zTarget) n++;
      const segs = Math.max(0, n - 1);
      g.setDrawRange(0, 6 * segs);
      m.visible = segs > 0;
      this.count = n;
    },
    count: 0,
  };
}

function install03(ch) {
  const ld = ch.ld;
  const trail = buildTrail(ch.hosePath, { width: 0.3, opacity: 0.85, roughness: 0.3, eye: ch.camera.position.clone(), lamp: ch.farLamp.position.clone() });
  ld.add(trail.mesh);
  ch.trail = trail;
  ch._trailIndex = null;
  ch.setFigurePose(ch.figure.index, ch.figure.sub);   // 依目前人影位置設定拖痕（index < 2 → 隱藏）

  // T2：廊道起霾（m3a）
  const r = rng(313);
  const tex = TX.smokeSprite(101);
  const hazeM = new THREE.SpriteMaterial({ map: tex, color: 0x3a3a3a, transparent: true, opacity: 0.22, depthWrite: false, fog: true });
  const haze = [];
  for (let i = 0; i < 6; i++) {
    const s = new THREE.Sprite(hazeM);
    const sc = 1.6 + r() * 0.8;
    s.scale.set(sc, sc * (0.7 + r() * 0.3), 1);
    s.position.set((r() - 0.5) * 1.0, 2.3 + r() * 0.3, -14 + i * 2);
    haze.push(s);
    ld.add(s);
  }
  hideAll(haze);
  const I0 = ch.farLamp.intensity, F0 = ch.farFill.intensity, G0 = ch.farGlow.material.opacity;
  ch.anomaly = { trail, haze };

  return (k) => {
    for (const s of haze) s.visible = k >= 1;
    ch.farLamp.intensity = k >= 1 ? 0.9 : I0;
    ch.farFill.intensity = k >= 1 ? 1.05 : F0;
    ch.farGlow.material.opacity = k >= 1 ? 0.45 : G0;
  };
}

// =============================================================================
// CAM-04 4號緊急停車彎：車門關上、車頂燈熄滅 → 停車彎牆上的煙燻焦痕＋三個交通錐（HD 的位置）
// =============================================================================
function install04(ch) {
  const ld = ch.ld;
  const parts = ch.car.userData.parts || {};
  const { hinge, dome, domeLampMat } = parts;
  // 車頂燈的柔光（第 0 階段的基準畫面的一部分：讓「燈熄了」在 LD 下讀得出來）
  ch.car.updateMatrixWorld(true);
  const domePos = dome ? dome.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(6.7, 1.28, -17.2);
  const domeGlow = glow(C(1, 0.9, 0.7), [2.0, 1.2], [domePos.x, domePos.y, domePos.z], { opacity: 0.65 });
  // 燈在車廂裡：不做深度測試，光暈透過車窗 / 車頂淡淡浮在車上（否則整個被不透明的車窗擋住）。
  // 白色車頂上加法光暈看不出來，所以比 spec 的 1.3×0.8 大一些：光暈的邊緣落在深色車窗與門洞上。
  domeGlow.material.depthTest = false;
  domeGlow.renderOrder = 3;
  ld.add(domeGlow);
  // 焦痕（HD 的兩片，同位置）
  const soot = [
    plane(9.5, 4.4, TX.sootPlume(131), { pos: [8.388, 2.2, -20], rot: [0, -Math.PI / 2, 0], decal: true, roughness: 1 }),
    plane(7.5, 4.4, TX.sootPlume(132), { pos: [8.386, 2.3, -15.2], rot: [0, -Math.PI / 2, 0], decal: true, roughness: 1 }),
  ];
  ld.add(...soot);
  // 交通錐（HD 封鎖線的前三根柱位）
  // 反光環帶微微自發光（回歸反射；黑白畫面裡橘色錐身很暗，環帶讓它讀得出是交通錐）
  const coneM = std({ color: 0xc8521e, roughness: 0.65 }), stripeM = std({ color: 0xd8d8d0, roughness: 0.45, emissive: 0x2a2a2a });
  const cones = [[4.75, -11.2], [5.05, -16.6], [5.1, -22.4]].map(([x, z], i) => {
    const c = cone(coneM, stripeM); c.position.set(x, 0, z); c.rotation.y = i * 1.3; ld.add(c); return c;
  });
  hideAll(soot); hideAll(cones);
  const hinge0 = hinge ? hinge.rotation.y : 0;
  const dome0 = dome ? dome.intensity : 0;
  const lamp0 = domeLampMat ? domeLampMat.color.clone() : null;
  const lampOff = C(0.05, 0.05, 0.05);
  ch.anomaly = { domeGlow, soot, cones };

  return (k) => {
    if (hinge) hinge.rotation.y = k >= 1 ? -0.02 : hinge0;
    if (dome) dome.intensity = k >= 1 ? 0 : dome0;       // 只改強度（燈光數量不變）
    if (domeLampMat) domeLampMat.color.copy(k >= 1 ? lampOff : lamp0);
    domeGlow.visible = k < 1;
    for (const s of soot) s.visible = k >= 2;
    for (const c of cones) c.visible = k >= 2;
  };
}

/** 建立四個頻道的 LD 微事件物件與 setStage；由 createChannels(SCRIPT) 呼叫（CameraFeeds 預編譯之前）。 */
export function installAnomalies(chs, SCRIPT) {
  const builders = { 1: (c) => install01(c, SCRIPT), 2: install02, 3: install03, 4: install04 };
  for (const n of [1, 2, 3, 4]) {
    const ch = chs[n];
    if (!ch) continue;
    try {
      ch._stageFn = builders[n](ch);
      ch.maxStage = MAX_STAGE[n];
      ch.meanScales = MEAN_SCALE[n];
    } catch (e) {
      console.error(`[feeds] anomalies CAM-0${n}`, e);
      ch._stageFn = null; ch.maxStage = 0; ch.meanScales = [1];
    }
    ch.setStage(0);
  }
  return chs;
}
