// =============================================================================
// 控制台與桌上物品：斜面儀表翼板（LED 列、撥桿開關、旋鈕、標籤）、主 CRT（漸縮背殼、內凹螢幕）、
// 兩台側邊 CRT、鍵盤、CAM 切換斜面按鈕座、緊急解鎖鈕（翻蓋、警示框、呼吸光環）、電話、
// 文件夾、筆筒、紙疊、馬克杯（Lathe）、便利貼（CRT 外殼上／終幕桌上）與筆、辦公椅。
// =============================================================================
import * as THREE from 'three';
import { T, Batcher, profileX, taperBox, frameGeom, hitbox, noRaycast } from './kit.js';
import { UVS } from './materials.js';
import * as LT from './localTextures.js';
import { SingleLed } from './leds.js';

const WING = { z0: -2.78, y0: 0.815, z1: -2.95, y1: 1.0 };
const WING_LEN = Math.hypot(WING.y1 - WING.y0, WING.z1 - WING.z0);
const WING_RX = Math.atan2(WING.y1 - WING.y0, WING.z0 - WING.z1); // 法線傾角（繞 X）
const CAMS = { zf: -2.335, yf: 0.797, zb: -2.405, yb: 0.848 };
const CAM_RX = Math.atan2(CAMS.yb - CAMS.yf, CAMS.zf - CAMS.zb);

/** 斜面上 s∈[0,1]（由前下往後上）、沿法線 h 處的位置與旋轉。 */
function wingAt(x, s, h = 0) {
  const ny = Math.cos(WING_RX), nz = Math.sin(WING_RX);
  return { x, y: WING.y0 + (WING.y1 - WING.y0) * s + ny * h, z: WING.z0 + (WING.z1 - WING.z0) * s + nz * h, rx: WING_RX };
}
function camAt(x, s, h = 0) {
  const ny = Math.cos(CAM_RX), nz = Math.sin(CAM_RX);
  return { x, y: CAMS.yf + (CAMS.yb - CAMS.yf) * s + ny * h, z: CAMS.zf + (CAMS.zb - CAMS.zf) * s + nz * h, rx: CAM_RX };
}

export function buildConsole(room) {
  const { L, mats, group, ctx } = room;
  const B = room.sb;
  const d = L.desk;
  const top = d.topY;

  // ---- 桌面與桌體 ---------------------------------------------------------------
  // 桌面板（深灰美耐板）＋前緣黑色橡膠護條（斜切）
  B.add('consoleTop', profileX([[d.minZ, top], [d.maxZ - 0.03, top], [d.maxZ - 0.03, top - 0.045], [d.minZ, top - 0.045]], d.minX, d.maxX));
  B.add('consoleDark', profileX([[d.maxZ - 0.03, top + 0.004], [d.maxZ - 0.008, top + 0.001], [d.maxZ, top - 0.012], [d.maxZ, top - 0.036], [d.maxZ - 0.012, top - 0.048], [d.maxZ - 0.03, top - 0.048]], d.minX - 0.003, d.maxX + 0.003));
  // 側端封板
  for (const x of [d.minX + 0.012, d.maxX - 0.012]) B.box('consoleBody', 0.024, top - 0.05, d.maxZ - d.minZ - 0.06, x, (top - 0.05) / 2, (d.minZ + d.maxZ) / 2 - 0.02);
  // 左右抽屜櫃
  const ped = (x0, x1) => {
    const cx = (x0 + x1) / 2, w = x1 - x0, zf = d.maxZ - 0.045;
    B.box('consoleBody', w - 0.04, top - 0.11, d.maxZ - d.minZ - 0.1, cx, 0.06 + (top - 0.11) / 2, (d.minZ + zf) / 2);
    B.box('consoleDark', w - 0.06, 0.06, d.maxZ - d.minZ - 0.18, cx, 0.03, (d.minZ + zf) / 2 - 0.03); // 踢腳凹槽
    // 抽屜面板（微凸、留縫）＋拉手
    const fronts = [[0.57, 0.725], [0.37, 0.555], [0.075, 0.355]];
    for (const [y0, y1] of fronts) {
      B.rbox('consoleBody', w - 0.07, y1 - y0 - 0.008, 0.02, 0.004, cx, (y0 + y1) / 2, zf + 0.008);
      B.box('chrome', 0.16, 0.012, 0.012, cx, y1 - 0.035, zf + 0.026);
      B.box('chrome', 0.012, 0.012, 0.018, cx - 0.074, y1 - 0.035, zf + 0.02);
      B.box('chrome', 0.012, 0.012, 0.018, cx + 0.074, y1 - 0.035, zf + 0.02);
      B.box('consoleDark', 0.05, 0.016, 0.004, cx, y1 - 0.065, zf + 0.019); // 標籤框
    }
    // 散熱孔
    for (let k = 0; k < 6; k++) B.box('consoleDark', 0.02, 0.07, 0.004, cx - 0.17 + k * 0.03, 0.22, zf + 0.0195);
  };
  ped(d.minX, -1.72);
  ped(1.72, d.maxX);
  // 中央膝部空間：斜切前飾板＋背板
  B.add('consoleBody', profileX([[d.maxZ - 0.04, top - 0.045], [d.maxZ - 0.04, top - 0.12], [d.maxZ - 0.1, top - 0.16], [d.maxZ - 0.13, top - 0.16], [d.maxZ - 0.13, top - 0.045]], -1.72, 1.72));
  B.box('consoleBody', 3.44, top - 0.17, 0.02, 0, 0.06 + (top - 0.17) / 2, d.minZ + 0.04);
  B.box('consoleDark', 3.44, 0.06, 0.02, 0, 0.03, d.minZ + 0.06);
  // 桌下線槽與 UPS
  B.box('darkMetal', 3.2, 0.08, 0.1, 0, top - 0.11, d.minZ + 0.12);
  B.rbox('blackPlastic', 0.18, 0.4, 0.44, 0.01, -1.32, 0.2, -2.83);
  B.box('greyPlastic', 0.14, 0.05, 0.004, -1.32, 0.33, -2.608);
  room.leds.add(new THREE.Vector3(-1.37, 0.3, -2.607), new THREE.Vector3(0, 0, 1), 'green', { group: 'ups' });
  room.leds.add(new THREE.Vector3(-1.34, 0.3, -2.607), new THREE.Vector3(0, 0, 1), 'amber', { group: 'upsAlarm', blink: { period: 2.2, duty: 0.5 } });

  // ---- 儀表翼板（左右） -----------------------------------------------------------
  const wingPanel = (x0, x1) => {
    B.add('consoleBody', profileX([[d.minZ, top], [WING.z0, top], [WING.z0, WING.y0], [WING.z1, WING.y1], [d.minZ, WING.y1]], x0, x1));
    // 斜面面板（深色）
    B.add('consoleDark', new THREE.BoxGeometry(x1 - x0 - 0.04, 0.004, WING_LEN - 0.02), T(wingAt((x0 + x1) / 2, 0.5, 0.001)));
    // 頂部金屬收邊
    B.box('trim', x1 - x0, 0.01, d.minZ - WING.z1 + 0.01, (x0 + x1) / 2, WING.y1 + 0.005, (d.minZ + WING.z1) / 2);
  };
  wingPanel(-2.58, -1.42);
  wingPanel(1.42, 2.58);
  const nWing = new THREE.Vector3(0, Math.cos(WING_RX), Math.sin(WING_RX));
  const labelL = ['照明A', '照明B', '排風1', '排風2', '送風', '防爆門', '側門', '對講'];
  const labelR = ['主電', '備電', 'UPS', '號誌', 'CCTV', '廣播', '消防', '水泵'];
  const wingDetail = (x0, x1, labels, seed) => {
    const cols = 8, w = x1 - x0 - 0.12;
    const xs = Array.from({ length: cols }, (_, i) => x0 + 0.06 + (w * (i + 0.5)) / cols);
    // 撥桿開關列
    xs.forEach((x, i) => {
      B.add('chrome', new THREE.BoxGeometry(0.03, 0.004, 0.044), T(wingAt(x, 0.14, 0.003)));
      const bat = new THREE.CylinderGeometry(0.0035, 0.0045, 0.028, 8);
      bat.translate(0, 0.014, 0);
      const up = (seed + i) % 3 !== 0;
      B.add('chrome', bat, T(wingAt(x, 0.14, 0.004)).multiply(T({ rx: up ? -0.45 : 0.45 })));
    });
    // 標籤條
    const tex = LT.labelStripTexture(labels, seed);
    const lm = mats.make({ map: tex, roughness: 0.7 }, 'cr:labelStrip');
    const lg = new THREE.PlaneGeometry(x1 - x0 - 0.1, 0.03); lg.rotateX(-Math.PI / 2);
    const lmesh = new THREE.Mesh(lg, lm);
    const p = wingAt((x0 + x1) / 2, 0.31, 0.0035);
    lmesh.position.set(p.x, p.y, p.z); lmesh.rotation.set(p.rx, 0, 0);
    group.add(noRaycast(lmesh));
    // LED 三列
    const pal = ['green', 'green', 'green', 'amber', 'green', 'red', 'green', 'green', 'amber', 'green', 'green', 'green'];
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 12; k++) {
        const x = x0 + 0.08 + ((x1 - x0 - 0.16) * k) / 11;
        const pos = wingAt(x, 0.47 + r * 0.15, 0.003);
        const idx = (k * 7 + r * 5 + seed) % pal.length;
        const lit = ((k + r * 3 + seed) % 5) !== 0;
        const blink = (r === 1 && k === ((seed * 3) % 12)) ? { period: 1.6, phase: seed * 0.37, duty: 0.5 }
          : (r === 2 && k === ((seed * 5 + 4) % 12)) ? { period: 2.4, phase: seed * 0.11, duty: 0.35 } : null;
        room.leds.add(new THREE.Vector3(pos.x, pos.y, pos.z), nWing, pal[idx], { lit, blink, group: r === 0 && k < 2 ? 'ups' : 'mains' });
        B.add('consoleDark', new THREE.CylinderGeometry(0.0062, 0.0062, 0.002, 10), T(wingAt(x, 0.47 + r * 0.15, 0.0015)));
      }
    }
    // 旋鈕
    for (let k = 0; k < 3; k++) {
      const x = x1 - 0.1 - k * 0.09;
      B.add('blackPlastic', new THREE.CylinderGeometry(0.014, 0.016, 0.018, 16), T(wingAt(x, 0.92, 0.009)));
      B.add('trim', new THREE.BoxGeometry(0.002, 0.003, 0.012), T(wingAt(x, 0.92, 0.0185)).multiply(T({ z: -0.006, ry: k * 0.9 })));
    }
  };
  wingDetail(-2.58, -1.42, labelL, 1);
  wingDetail(1.42, 2.58, labelR, 4);

  // ---- 主 CRT ---------------------------------------------------------------------
  const ms = L.mainScreen;
  const crtFront = -2.513;
  // 立座
  B.box('consoleBody', 0.96, 0.16, 0.55, 0, top + 0.08, -2.805);
  B.box('consoleDark', 0.9, 0.012, 0.004, 0, top + 0.12, -2.528);
  B.box('blackPlastic', 0.6, 0.02, 0.4, 0, top + 0.17, -2.82);
  {
    const ow = 0.88, oh = 0.75, depth = 0.03, bev = 0.006;
    const fr = frameGeom(ow - 2 * bev, oh - 2 * bev, ms.w + 0.02 + 2 * bev, ms.h + 0.02 + 2 * bev, depth, { r: 0.03, ir: 0.014, bevel: bev });
    B.add('crtBezel', fr, T({ x: ms.x, y: ms.y, z: crtFront - depth - bev }));
    // 螢幕四周的暗色內框（螢幕平面略後方）
    const inner = frameGeom(ms.w + 0.06, ms.h + 0.06, ms.w - 0.004, ms.h - 0.004, 0.006, { r: 0.012, ir: 0.008 });
    B.add('crtInner', inner, T({ x: ms.x, y: ms.y, z: ms.z - 0.0075 }));
    // 前殼塊＋漸縮背殼＋後蓋
    B.add('crtHousing', new THREE.BoxGeometry(0.86, 0.73, 0.06), T({ x: ms.x, y: ms.y, z: crtFront - 0.042 - 0.03 }));
    B.add('crtHousing', taperBox(0.84, 0.71, 0.46, 0.4, 0.44, 0, -0.06), T({ x: ms.x, y: ms.y, z: crtFront - 0.102 }));
    B.add('crtHousing', new THREE.BoxGeometry(0.4, 0.34, 0.04), T({ x: ms.x, y: ms.y - 0.06, z: crtFront - 0.56 }));
    // 頂部散熱槽
    for (let k = 0; k < 9; k++) B.box('consoleDark', 0.32, 0.004, 0.012, ms.x, ms.y + 0.3465 - k * 0.0127, crtFront - 0.127 - k * 0.026, { rx: -0.455 });
    // 底部控制鈕＋電源指示
    for (let k = 0; k < 5; k++) B.rbox('greyPlastic', 0.03, 0.014, 0.012, 0.003, -0.3 + k * 0.045, ms.y - 0.31, crtFront + 0.004);
    B.add('blackPlastic', new THREE.CylinderGeometry(0.012, 0.012, 0.012, 16), T({ x: -0.36, y: ms.y - 0.31, z: crtFront + 0.004, rx: Math.PI / 2 }));
    room.leds.add(new THREE.Vector3(-0.07, ms.y - 0.31, crtFront + 0.001), new THREE.Vector3(0, 0, 1), 'green', { group: 'ups' });
    // 型號銘牌
    const plate = room.tex.label('CCTV MONITOR  MON-01', { w: 256, h: 32, bg: '#2a2a28', fg: '#b8b4a6', size: 16 });
    const pm = mats.make({ map: plate, roughness: 0.5, metalness: 0.4 }, 'cr:monPlate');
    const pmesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.025), pm);
    pmesh.position.set(ms.x, ms.y + ms.h / 2 + 0.05, crtFront + 0.0015);
    group.add(noRaycast(pmesh));
  }

  // ---- 側邊 CRT ---------------------------------------------------------------------
  for (const s of L.sideScreens) {
    const M = T({ x: s.x, y: s.y, z: s.z, ry: s.yaw });
    B.with(M, () => {
      const depth = 0.022, bev = 0.005, ow = s.w + 0.1, oh = s.h + 0.1;
      const fr = frameGeom(ow - 2 * bev, oh - 2 * bev, s.w + 0.016 + 2 * bev, s.h + 0.016 + 2 * bev, depth, { r: 0.02, ir: 0.01, bevel: bev });
      B.add('crtBezel', fr, T({ z: 0.024 - depth - bev }));
      B.add('crtInner', frameGeom(s.w + 0.05, s.h + 0.05, s.w - 0.004, s.h - 0.004, 0.005, { r: 0.01, ir: 0.006 }), T({ z: -0.007 }));
      B.add('crtHousing', new THREE.BoxGeometry(ow - 0.01, oh - 0.01, 0.05), T({ z: -0.008 - 0.025 }));
      B.add('crtHousing', taperBox(ow - 0.02, oh - 0.02, 0.26, 0.22, 0.3, 0, -0.03), T({ z: -0.058 }));
      // 底座
      const ySeat = L.desk.topY - s.y;
      B.box('consoleBody', 0.36, -ySeat - oh / 2, 0.3, 0, ySeat + (-ySeat - oh / 2) / 2, -0.17);
      B.box('blackPlastic', 0.38, 0.015, 0.32, 0, -oh / 2 - 0.0075, -0.17);
      B.rbox('greyPlastic', 0.022, 0.012, 0.01, 0.003, s.w / 2 - 0.02, -s.h / 2 - 0.03, 0.026);
    });
    const ledPos = new THREE.Vector3(s.w / 2 - 0.05, -s.h / 2 - 0.03, 0.027).applyMatrix4(M);
    room.leds.add(ledPos, new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw)), 'green', { group: 'ups', scale: 0.8 });
  }

  // ---- 鍵盤 ---------------------------------------------------------------------------
  const kbTex = LT.keyboardTexture();
  const kbMat = mats.make({ map: kbTex, roughness: 0.6 }, 'cr:keys');
  const kbG = new Batcher(UVS);
  const kb = (x, z, yaw, seed) => {
    const M = T({ x, y: top, z, ry: yaw }).multiply(T({ rx: 0.05 }));
    kbG.with(M, () => {
      kbG.rbox('crtHousing', 0.46, 0.026, 0.165, 0.008, 0, 0.014, 0);
      kbG.box('keys', 0.43, 0.012, 0.13, 0, 0.031, 0.004, {}, { uv: false });
    });
  };
  kb(-1.13, -2.42, 0.28, 1);
  kb(1.15, -2.42, -0.28, 2);
  kbG.build((k) => (k === 'keys' ? kbMat : mats.get(k)), group, { name: 'keyboards' });

  // ---- CAM 切換按鈕座 ----------------------------------------------------------------
  const cb = L.camButtons;
  B.add('consoleBody', profileX([[CAMS.zb, top], [CAMS.zf, top], [CAMS.zf, CAMS.yf], [CAMS.zb, CAMS.yb]], cb.xs[0] - 0.16, cb.xs[3] + 0.16));
  {
    const tex = room.tex.panel('camPanel');
    const pm = mats.make({ map: tex, roughness: 0.6 }, 'cr:camPanel');
    const len = Math.hypot(CAMS.yb - CAMS.yf, CAMS.zb - CAMS.zf);
    const g = new THREE.PlaneGeometry(cb.xs[3] - cb.xs[0] + 0.3, len - 0.006); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, pm);
    const p = camAt((cb.xs[0] + cb.xs[3]) / 2, 0.5, 0.0008);
    m.position.set(p.x, p.y, p.z); m.rotation.set(p.rx, 0, 0);
    group.add(noRaycast(m));
  }
  const camButtons = [];
  room.camLeds = [];
  const keyMat = mats.get('greyPlastic');
  cb.xs.forEach((x, i) => {
    const g = new THREE.BoxGeometry(0.07, 0.016, 0.042);
    const btn = new THREE.Mesh(g, keyMat);
    const p = camAt(x, (cb.z - CAMS.zf) / (CAMS.zb - CAMS.zf), 0.008);
    btn.position.set(p.x, p.y, p.z); btn.rotation.set(p.rx, 0, 0);
    btn.name = `camButton${i + 1}`;
    btn.userData.rest = btn.position.clone();
    btn.userData.normal = new THREE.Vector3(0, Math.cos(CAM_RX), Math.sin(CAM_RX));
    // 按鍵上的 CAM-0n 標籤
    const lt = room.tex.label(`CAM-0${i + 1}`, { w: 128, h: 64, bg: '#4a4d4f', fg: '#e4e2da', size: 26 });
    const lm = mats.make({ map: lt, roughness: 0.55 }, 'cr:camLabel');
    const lp = new THREE.Mesh(new THREE.PlaneGeometry(0.064, 0.036), lm);
    lp.rotation.x = -Math.PI / 2; lp.position.y = 0.0081;
    btn.add(lp);
    btn.add(hitbox(0.1, 0.05, 0.08, 0, 0.012, 0.005));
    group.add(btn);
    camButtons.push(btn);
    // 頻道指示燈（目前頻道亮綠燈）
    const led = new SingleLed({ radius: 0.0045, glowTex: room.glowTex, glowSize: 0.03 });
    const lp2 = camAt(x, 0.88, 0.001);
    led.group.position.set(lp2.x, lp2.y, lp2.z);
    led.group.rotation.set(lp2.rx - Math.PI / 2, 0, 0);
    group.add(led.group);
    room.camLeds.push(led);
  });
  room.objects.camButtons = camButtons;

  // ---- 緊急解鎖鈕（左翼） -------------------------------------------------------------
  buildUnlockButton(room);

  // ---- 電話 ---------------------------------------------------------------------------
  {
    const M = T({ x: 1.98, y: top, z: -2.5, ry: -0.22 });
    B.with(M, () => {
      B.add('blackPlastic', profileX([[-0.11, 0], [0.1, 0], [0.1, 0.035], [-0.06, 0.075], [-0.11, 0.075]], -0.11, 0.11));
      // 按鍵 4x3
      for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
        B.add('greyPlastic', new THREE.BoxGeometry(0.022, 0.008, 0.016), T({ x: 0.045 + c * 0.027, y: 0.05 - r * 0.0062, z: 0.06 - r * 0.02 - 0.03, rx: 0.24 }));
      }
      // 話筒
      B.rbox('blackPlastic', 0.055, 0.04, 0.23, 0.018, -0.055, 0.095, -0.01);
      B.rbox('blackPlastic', 0.06, 0.03, 0.06, 0.012, -0.055, 0.075, -0.115);
      B.rbox('blackPlastic', 0.06, 0.03, 0.06, 0.012, -0.055, 0.075, 0.095);
      // 捲線
      const pts = [];
      for (let k = 0; k <= 120; k++) {
        const a = k * 0.55, tt = k / 120;
        pts.push(new THREE.Vector3(-0.1 - tt * 0.05 + Math.cos(a) * 0.008, 0.012 + Math.sin(a) * 0.008, 0.11 - tt * 0.18));
      }
      B.add('blackPlastic', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 240, 0.0028, 5, false), null, { uv: 1 });
    });
    const lp = new THREE.Vector3(0.09, 0.04, 0.035).applyMatrix4(M);
    room.leds.add(lp, new THREE.Vector3(0, 0.6, 0.8).normalize(), 'red', { group: 'mains', blink: { period: 3.1, duty: 0.2, phase: 0.7 } });
  }

  // ---- 文件、筆筒、夾板 ----------------------------------------------------------------
  // 紙疊
  for (let k = 0; k < 7; k++) B.box('paper', 0.21, 0.004, 0.297, 0.66 + (k % 3) * 0.004, top + 0.002 + k * 0.004, -2.82 + (k % 2) * 0.006, { ry: 1.42 + k * 0.03 });
  // 夾板＋表單
  {
    const M = T({ x: -1.62, y: top, z: -2.47, ry: 0.18 });
    B.with(M, () => {
      B.rbox('darkMetal', 0.235, 0.006, 0.32, 0.01, 0, 0.003, 0);
      B.box('chrome', 0.1, 0.012, 0.03, 0, 0.012, -0.145);
    });
    const form = LT.formTexture();
    const fm = mats.make({ map: form, roughness: 0.9 }, 'cr:form');
    const fg = new THREE.PlaneGeometry(0.21, 0.28); fg.rotateX(-Math.PI / 2);
    const f = new THREE.Mesh(fg, fm);
    f.applyMatrix4(M); f.position.y += 0.0065; f.position.add(new THREE.Vector3(0, 0, 0.012).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.18));
    group.add(noRaycast(f));
  }
  // 筆筒
  B.add('darkMetal', new THREE.CylinderGeometry(0.035, 0.032, 0.1, 16, 1, true), T({ x: -0.62, y: top + 0.05, z: -2.66 }));
  B.add('consoleDark', new THREE.CylinderGeometry(0.032, 0.032, 0.004, 16), T({ x: -0.62, y: top + 0.003, z: -2.66 }));
  for (const [dx, dz, rx, rz, key] of [[0.01, 0.0, 0.12, -0.15, 'blackPlastic'], [-0.012, 0.008, -0.1, 0.12, 'extRed'], [0.0, -0.012, -0.2, 0.05, 'greyPlastic']]) {
    B.add(key, new THREE.CylinderGeometry(0.0045, 0.0045, 0.15, 8), T({ x: -0.62 + dx, y: top + 0.08, z: -2.66 + dz, rx, rz }));
  }

  buildMug(room);
  buildNotes(room);
  buildChair(room);
}

// ---------------------------------------------------------------------------
function buildUnlockButton(room) {
  const { L, mats, group } = room;
  const u = L.unlockButton;
  const top = L.desk.topY;
  const root = new THREE.Group();
  root.name = 'unlockButton';
  root.position.set(u.x, top, u.z);
  // 警示底板（面板圖：黃黑斜紋＋「防爆門 緊急解鎖」）
  const plateTex = room.tex.panel('unlock');
  const plateMat = mats.make({ map: plateTex, roughness: 0.55, metalness: 0.2 }, 'cr:unlockPlate');
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.008, 0.19), [mats.get('hazard'), mats.get('hazard'), plateMat, mats.get('hazard'), mats.get('hazard'), mats.get('hazard')]);
  plate.position.y = 0.004;
  root.add(plate);
  // 底座環
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.016, 24), mats.get('darkMetal'));
  collar.position.y = 0.016;
  root.add(collar);
  // 發光環（呼吸紅光）
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.042, 0.062, 40), ringMat);
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.0085;
  root.add(noRaycast(ring));
  // 蘑菇頭
  const btn = new THREE.Group();
  btn.position.y = 0.024;
  const capMat = mats.make({ color: 0xb01810, roughness: 0.35, emissive: 0xff1a08, emissiveIntensity: 0 }, 'cr:unlockCap');
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.016, 16), mats.get('extRed'));
  stem.position.y = 0.006;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.036, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  cap.scale.set(1, 0.48, 1); cap.position.y = 0.013;
  const capRim = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.006, 24), capMat);
  capRim.position.y = 0.011;
  btn.add(stem, capRim, cap);
  root.add(btn);
  // 透明翻蓋（後緣鉸鏈）
  const coverPivot = new THREE.Group();
  coverPivot.position.set(0, 0.008, -0.075);
  const coverMat = mats.make({ color: 0xd8e4e8, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.28, depthWrite: false }, 'cr:cover');
  const cg = new Batcher();
  cg.box('c', 0.13, 0.003, 0.135, 0, 0.062, 0.0725);
  cg.box('c', 0.003, 0.06, 0.135, -0.0635, 0.032, 0.0725);
  cg.box('c', 0.003, 0.06, 0.135, 0.0635, 0.032, 0.0725);
  cg.box('c', 0.13, 0.06, 0.003, 0, 0.032, 0.139);
  cg.box('c', 0.13, 0.06, 0.003, 0, 0.032, 0.006);
  cg.build({ c: coverMat }, coverPivot);
  const hingeM = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 10), mats.get('chrome'));
  hingeM.rotation.z = Math.PI / 2; hingeM.position.set(0, 0.004, -0.075);
  root.add(coverPivot, hingeM);
  root.add(hitbox(0.2, 0.1, 0.2, 0, 0.04, 0));
  group.add(root);
  // 紅色小點光源（呼吸）
  const light = new THREE.PointLight(0xff2010, 0, 1.6, 2);
  light.position.set(u.x, top + 0.14, u.z + 0.05);
  group.add(light);
  room.objects.unlockButton = root;
  room.parts.unlock = { root, btn, coverPivot, ringMat, capMat, light };
}

// ---------------------------------------------------------------------------
function buildMug(room) {
  const { L, mats, group, ctx } = room;
  const c = L.coffee;
  const root = new THREE.Group();
  root.name = 'coffee';
  root.position.set(c.x, c.y, c.z);
  // 杯身：外壁＋杯緣＋內壁（同一條剖面線）
  const R = 0.041, Hm = 0.098, t = 0.004;
  const prof = [
    [0.0, 0.0], [R - 0.006, 0.0], [R - 0.002, 0.003], [R, 0.01], [R + 0.0015, Hm * 0.5], [R + 0.002, Hm - 0.002],
    [R + 0.0005, Hm], [R - t + 0.0005, Hm], [R - t, Hm - 0.003], [R - t - 0.001, 0.012], [R - t - 0.004, t + 0.002], [0.0, t + 0.002],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.LatheGeometry(prof, 40);
  const mugMat = mats.make({ color: 0xe9e4d8, roughness: 0.3, metalness: 0 }, 'cr:mug');
  const mug = new THREE.Mesh(body, mugMat);
  root.add(mug);
  // 杯身藍色細帶
  const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.0019, R + 0.0016, 0.012, 40, 1, true), mats.make({ color: 0x27466e, roughness: 0.35 }, 'cr:mugBand'));
  band.position.y = Hm - 0.022;
  root.add(band);
  // 把手（部分圓環）
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.0062, 10, 20, Math.PI * 1.15), mugMat);
  handle.rotation.z = -Math.PI * 0.575; handle.position.set(R + 0.004, Hm * 0.52, 0);
  root.add(handle);
  // 裂紋疊層（乾涸階段）
  const crackMat = mats.make({ map: LT.mugCrackTexture(), transparent: true, depthWrite: false, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }, 'cr:mugCrack');
  const crack = new THREE.Mesh(new THREE.LatheGeometry(prof.slice(2, 7), 40), crackMat);
  crack.scale.set(1.012, 1, 1.012); crack.visible = false;
  root.add(noRaycast(crack));
  // 液面
  const tex = [0, 1, 2].map((n) => room.tex.coffee(n));
  const liqMat = mats.make({ map: tex[0], roughness: 0.12, metalness: 0.0, color: 0xffffff }, 'cr:coffee');
  const liquid = new THREE.Mesh(new THREE.CircleGeometry(R - t - 0.0008, 32), liqMat);
  liquid.rotation.x = -Math.PI / 2; liquid.position.y = Hm * 0.82;
  root.add(liquid);
  root.add(hitbox(0.14, 0.14, 0.14, 0.01, 0.06, 0));
  group.add(root);
  // 桌面咖啡漬（階段 1/2）
  const ringMats = [LT.ringStainTexture(5, false), LT.ringStainTexture(8, true)].map((tx) => mats.make({ map: tx, transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }, 'cr:ring'));
  const ringG = new THREE.PlaneGeometry(0.12, 0.12); ringG.rotateX(-Math.PI / 2);
  const rings = ringMats.map((m, i) => {
    const r = new THREE.Mesh(ringG, m);
    r.position.set(c.x - 0.075 + i * 0.02, c.y + 0.0012, c.z + 0.035 + i * 0.04);
    r.rotation.y = i * 1.3; r.visible = false;
    group.add(noRaycast(r));
    return r;
  });
  room.objects.coffee = root;
  room.parts.mug = { root, mugMat, crack, liquid, liqMat, tex, rings, height: Hm };
}

// ---------------------------------------------------------------------------
function curlPlane(size, curl = 0.006, seg = 6) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / size + 0.5; // 0 = 下緣
    const x = p.getX(i) / size + 0.5;
    const k = Math.max(0, (0.4 - y) / 0.4);
    p.setZ(i, curl * k * k * (0.6 + 0.4 * x));
  }
  g.computeVertexNormals();
  return g;
}

function buildNotes(room) {
  const { L, mats, group, ctx } = room;
  // 主 CRT 外殼上的便利貼
  const sn = L.stickyNote;
  room.stickyNoteTex = room.tex.stickyNote();
  // alphaTest：若便利貼貼圖帶透明邊（陰影/捲角），透明處直接裁掉，不需排序
  const noteMat = mats.make({ map: room.stickyNoteTex.texture, roughness: 0.88, side: THREE.DoubleSide, alphaTest: 0.35 }, 'cr:sticky');
  const note = new THREE.Mesh(curlPlane(sn.size, 0.007), noteMat);
  note.position.set(sn.x, sn.y, sn.z);
  note.rotation.z = sn.rotZ;
  note.name = 'stickyNote';
  note.add(hitbox(sn.size + 0.03, sn.size + 0.03, 0.02, 0, 0, 0));
  group.add(note);
  room.objects.stickyNote = note;

  // 終幕：平放桌上的便利貼（為避開 CAM 按鈕座，往玩家方向偏移 4.5 cm）
  const en = L.endingNote;
  room.endingNoteTex = room.tex.stickyNote();
  const eMat = mats.make({ map: room.endingNoteTex.texture, roughness: 0.88, side: THREE.DoubleSide, alphaTest: 0.35, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, 'cr:endingNote');
  const eg = curlPlane(en.size, 0.004);
  const enote = new THREE.Mesh(eg, eMat);
  enote.rotation.set(-Math.PI / 2, 0, 0.09, 'YXZ');
  enote.position.set(en.x, en.y, en.z + room.endingNoteOffsetZ);
  enote.name = 'endingNote';
  enote.visible = false;
  group.add(enote);
  room.objects.endingNote = enote;

  // 筆（筆尖在群組原點，筆身朝右後上方傾斜，像被右手握著）
  const pen = new THREE.Group();
  pen.name = 'pen';
  const body = new THREE.Group();
  const bodyMat = mats.make({ color: 0x1d2a52, roughness: 0.35, metalness: 0.2 }, 'cr:pen');
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.0042, 0.016, 12), mats.get('chrome'));
  tip.rotation.x = Math.PI; tip.position.y = 0.008;
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0046, 0.0044, 0.11, 12), bodyMat);
  barrel.position.y = 0.016 + 0.055;
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.0052, 0.0048, 0.03, 12), mats.get('rubber'));
  grip.position.y = 0.016 + 0.017;
  const capEnd = new THREE.Mesh(new THREE.CylinderGeometry(0.0047, 0.0047, 0.022, 12), mats.get('chrome'));
  capEnd.position.y = 0.016 + 0.11 + 0.008;
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.0022, 0.045, 0.0016), mats.get('chrome'));
  clip.position.set(0, 0.016 + 0.1, 0.0055);
  body.add(tip, barrel, grip, capEnd, clip);
  // 傾斜：朝 +X（右）與 +Z（玩家）方向倒，與桌面約 52°
  body.rotation.set(0.42, 0, -0.62, 'YXZ');
  pen.add(body);
  pen.visible = false;
  pen.position.set(en.x, en.y + 0.001, en.z + room.endingNoteOffsetZ);
  group.add(noRaycast(pen));
  room.objects.pen = pen;
}

// ---------------------------------------------------------------------------
function buildChair(room) {
  const { L, mats, group } = room;
  const root = new THREE.Group();
  root.name = 'chair';
  root.position.set(L.chair.x, 0, L.chair.z + 0.02);
  root.rotation.y = 0.09;
  const b = new Batcher(UVS);
  // 五爪腳＋輪子
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + 0.3;
    const g = new THREE.BoxGeometry(0.04, 0.03, 0.31);
    g.translate(0, 0, 0.155);
    b.add('blackPlastic', g, T({ y: 0.085, ry: a, rx: 0.12 }));
    const tx = Math.sin(a) * 0.3, tz = Math.cos(a) * 0.3;
    b.add('blackPlastic', new THREE.CylinderGeometry(0.008, 0.008, 0.04, 6), T({ x: tx, y: 0.06, z: tz }));
    b.add('rubber', new THREE.CylinderGeometry(0.026, 0.026, 0.022, 14), T({ x: tx, y: 0.028, z: tz + 0.012, rz: Math.PI / 2, ry: a }));
  }
  b.cyl('blackPlastic', 0.05, 0.06, 0.05, 0, 0.1, 0, {}, 16);
  b.cyl('chrome', 0.022, 0.022, 0.22, 0, 0.2, 0, {}, 14);
  b.cyl('blackPlastic', 0.03, 0.03, 0.14, 0, 0.36, 0, {}, 14);
  b.box('darkMetal', 0.2, 0.04, 0.22, 0, 0.42, 0);
  b.box('darkMetal', 0.12, 0.01, 0.02, 0.12, 0.42, 0.06, { ry: 0.3 }); // 調整桿
  // 座墊
  b.rbox('blackPlastic', 0.48, 0.03, 0.46, 0.012, 0, 0.445, 0);
  b.rbox('fabric', 0.5, 0.075, 0.48, 0.03, 0, 0.495, 0);
  // 背靠（後傾）
  b.box('darkMetal', 0.06, 0.32, 0.025, 0, 0.6, 0.26, { rx: 0.1 });
  b.with(T({ y: 0.86, z: 0.29, rx: 0.14 }), () => {
    b.rbox('blackPlastic', 0.45, 0.5, 0.03, 0.03, 0, 0, 0.022);
    b.rbox('fabric', 0.46, 0.52, 0.06, 0.028, 0, 0, -0.01);
  });
  // 扶手
  for (const sx of [-1, 1]) {
    b.box('blackPlastic', 0.03, 0.2, 0.05, sx * 0.265, 0.56, 0.05);
    b.box('darkMetal', 0.03, 0.02, 0.12, sx * 0.265, 0.46, 0.05);
    b.rbox('rubber', 0.065, 0.028, 0.25, 0.012, sx * 0.265, 0.672, 0.02);
  }
  b.build((k) => mats.get(k), root, { name: 'chair' });
  group.add(root);
  room.objects.chair = root;
}
