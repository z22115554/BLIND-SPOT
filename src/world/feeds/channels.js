// =============================================================================
// channels — CAM-01..04 四個獨立的小場景（各自的攝影機、燈光、霧），每個都有 LD / HD 兩種佈置
//   shared：兩種佈置共用的建築（隧道殼體、廊道）
//   ld / hd：只在該佈置顯示的物件與燈光
// 所有 HD 火光只做緩慢起伏（≤ 15%、週期 ≥ 0.6 秒），沒有任何快速閃爍。
// =============================================================================
import * as THREE from 'three';
import * as TX from './feedTextures.js';
import {
  buildTunnel, buildSedan, buildTanker, buildTruckCab, SmokeField, FireCluster, slowWave, glow, plane,
  tapeRibbon, cone, mesh, mergeList, boxG, std, TUNNEL,
} from './props.js';
import { Figure, FIGURE_WAYPOINTS } from '../Figure.js';
import { rng, clamp } from '../../core/util.js';

const C = (r, g, b) => new THREE.Color(r, g, b);

export class FeedChannel {
  constructor(n, { fov = 70, near = 0.05, far = 320 } = {}) {
    this.n = n;
    this.scene = new THREE.Scene();
    this.scene.name = `CAM-0${n}`;
    this.camera = new THREE.PerspectiveCamera(fov, 4 / 3, near, far);
    this.scene.add(this.camera);
    this.shared = new THREE.Group(); this.shared.name = 'shared';
    this.ld = new THREE.Group(); this.ld.name = 'LD';
    this.hd = new THREE.Group(); this.hd.name = 'HD';
    this.scene.add(this.shared, this.ld, this.hd);
    this.fogs = { LD: new THREE.FogExp2(0x404040, 0.03), HD: new THREE.FogExp2(0x101010, 0.03) };
    this.bg = { LD: new THREE.Color(0x202020), HD: new THREE.Color(0x080808) };
    /** CRT shader 的曝光（亮度增益） */
    this.exposure = { LD: 1, HD: 1 };
    /** 主控室螢幕光（screenLight）的顏色與強度預設 */
    this.light = { LD: { color: C(0.72, 0.82, 1.0), intensity: 0.5 }, HD: { color: C(0.9, 0.85, 0.8), intensity: 0.5 } };
    this.variant = '';
  }
  aim(pos, target) {
    this.camera.position.set(pos[0], pos[1], pos[2]);
    this.camera.lookAt(target[0], target[1], target[2]);
    this.camera.updateMatrixWorld(true);
  }
  setVariant(v) {
    if (v !== 'LD' && v !== 'HD') return;
    if (v === this.variant) return;
    this.variant = v;
    this.ld.visible = v === 'LD';
    this.hd.visible = v === 'HD';
    this.scene.fog = this.fogs[v];
    this.scene.background = this.bg[v];
    this.onVariant(v);
  }
  onVariant() {}
  update() {}
  /** 寫入 out.color / out.intensity（目前佈置的螢幕光） */
  screenLight(t, out, reduceFlicker) {
    const p = this.light[this.variant] || this.light.LD;
    out.color.copy(p.color); out.intensity = p.intensity;
  }
}

/** 把霧色與背景同步（背景 = 霧色，讓遠方自然融入霧中） */
function fogBg(ch, v, color, density) {
  ch.fogs[v] = new THREE.FogExp2(color, density);
  ch.bg[v] = new THREE.Color(color);
}

// =============================================================================
// CAM-01 北向隧道入口
// =============================================================================
export class Cam01 extends FeedChannel {
  constructor() {
    super(1);
    const tun = buildTunnel({ length: 160, zStart: 8, lampEvery: 6, lampFrom: -5.5, lamp: () => 1, seed: 1 });
    this.tunnel = tun;
    this.shared.add(tun.group);
    this.aim([-3.5, 5.0, 2.5], [0.6, -3.2, -40]);

    // ---- LD：濃霧，能見度幾乎為零；遠方洞口的微光與近處標線 ----
    fogBg(this, 'LD', 0x6a6e72, 0.095);
    const ld = this.ld;
    ld.add(new THREE.HemisphereLight(0xc8ccd0, 0x3a3a3a, 0.9));
    for (const [z, I] of [[-2, 40], [-13, 45], [-25, 40]]) {
      const p = new THREE.PointLight(0xfff0d8, I, 0, 2);
      p.position.set(0.0, 4.0, z); ld.add(p);
    }
    for (const L of tun.lamps) if (L.z > -40) ld.add(glow(C(1.0, 0.95, 0.82), [2.6, 1.5], [L.x * 0.97, L.y - 0.05, L.z], { opacity: 0.55 }));
    // 洞口的光（霧中的散射光，不受霧影響地淡淡存在）
    ld.add(glow(C(0.95, 0.9, 0.78), [46, 26], [1.0, 3.0, -95], { opacity: 0.3, fog: false }));
    ld.add(glow(C(1.0, 0.95, 0.85), [16, 10], [1.0, 3.0, -95], { opacity: 0.18, fog: false }));
    this.exposure.LD = 0.72;
    this.light.LD = { color: C(0.75, 0.84, 1.0), intensity: 0.55 };

    // ---- HD：黑灰濃煙全面阻斷；封閉柵欄、恆亮的琥珀警示燈、紅色叉號車道號誌 ----
    fogBg(this, 'HD', 0x1d1c1b, 0.13);
    const hd = this.hd;
    hd.add(new THREE.HemisphereLight(0x6a6560, 0x141210, 0.28));
    const em = new THREE.PointLight(0xdfe8ff, 3.2, 0, 2); em.position.set(-4.6, 2.6, -1.0); hd.add(em);
    // 柵欄（紅白斜紋 A 字型拒馬）
    const stripeC = document.createElement('canvas'); stripeC.width = 256; stripeC.height = 32;
    { const g = stripeC.getContext('2d'); g.fillStyle = '#e8e4da'; g.fillRect(0, 0, 256, 32); g.fillStyle = '#b8231a';
      for (let x = -32; x < 256; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 0); g.lineTo(x + 32, 0); g.lineTo(x + 16, 32); g.closePath(); g.fill(); } }
    const stripeT = new THREE.CanvasTexture(stripeC); stripeT.colorSpace = THREE.SRGBColorSpace; stripeT.wrapS = THREE.RepeatWrapping;
    const boardM = std({ map: stripeT, roughness: 0.6 });
    const legM = std({ color: 0x2a2a2a, roughness: 0.7 });
    const amberM = new THREE.MeshBasicMaterial({ color: C(2.6, 1.3, 0.25) });
    for (const x of [-2.4, 1.6]) {
      const b = new THREE.Group();
      const board = mesh(new THREE.BoxGeometry(2.6, 0.3, 0.04), boardM, b); board.position.y = 0.95;
      stripeT.repeat.set(3, 1);
      const board2 = mesh(new THREE.BoxGeometry(2.6, 0.22, 0.04), boardM, b); board2.position.y = 0.45;
      mesh(mergeList([boxG(0.06, 1.1, 0.06, -1.15, 0.55, 0.12), boxG(0.06, 1.1, 0.06, 1.15, 0.55, 0.12), boxG(0.06, 1.1, 0.06, -1.15, 0.55, -0.12), boxG(0.06, 1.1, 0.06, 1.15, 0.55, -0.12)]), legM, b);
      const lampG = new THREE.SphereGeometry(0.09, 12, 8); lampG.translate(0, 1.2, 0);
      mesh(lampG, amberM, b);
      b.add(glow(C(1.0, 0.55, 0.12), [1.6, 1.6], [0, 1.2, 0.05], { opacity: 0.9 }));
      b.position.set(x, 0, -6.6 - (x > 0 ? 0.5 : 0));
      b.rotation.y = x > 0 ? -0.08 : 0.06;
      hd.add(b);
    }
    this.amber = new THREE.PointLight(0xffa040, 7, 0, 2);
    this.amber.position.set(-0.4, 1.6, -6.2); hd.add(this.amber);
    const coneM = std({ color: 0xd9531e, roughness: 0.6 }), stripeM = std({ color: 0xe8e8e0, roughness: 0.4, emissive: 0x222222 });
    for (let i = 0; i < 6; i++) { const c = cone(coneM, stripeM); c.position.set(-3.6 + i * 1.45, 0, -4.6 - i * 0.2); c.rotation.y = i; hd.add(c); }
    // 門架：車道管制號誌（紅叉）＋可變資訊標誌「隧道封閉」
    const gantryM = std({ color: 0x2c2e30, roughness: 0.6, metalness: 0.5 });
    mesh(mergeList([boxG(9.6, 0.25, 0.3, 0, 5.1, -10), boxG(0.25, 1.3, 0.25, -4.6, 4.45, -10), boxG(0.25, 1.3, 0.25, 4.6, 4.45, -10)]), gantryM, hd);
    const xTex = TX.laneSignalTexture('x');
    for (const x of [-1.9, 1.9]) {
      mesh(boxG(0.9, 0.9, 0.3, x, 4.45, -10), gantryM, hd);
      hd.add(plane(0.78, 0.78, xTex, { pos: [x, 4.45, -9.84], basic: true, color: C(1.8, 1.8, 1.8) }));
      hd.add(glow(C(1.0, 0.18, 0.1), [2.2, 2.2], [x, 4.45, -9.7], { opacity: 0.55 }));
    }
    mesh(boxG(3.0, 0.9, 0.25, 0, 5.75, -10.05), gantryM, hd);
    hd.add(plane(2.8, 0.7, TX.vmsTexture(['隧道封閉']), { pos: [0, 5.75, -9.91], basic: true, color: C(1.7, 1.7, 1.7) }));
    const redL = new THREE.PointLight(0xff3020, 2.2, 0, 2); redL.position.set(0, 4.3, -9.2); hd.add(redL);
    // 濃煙（緩慢朝鏡頭湧來）
    this.smoke = new SmokeField({ count: 36, box: { min: [-6, 0.0, -26], max: [6, 6.2, -13.5] }, vel: [0.0, 0.03, 0.3], size: [6, 11], color: 0x37332f, opacity: 1.0, seed: 11 });
    hd.add(this.smoke.group);
    this.smoke2 = new SmokeField({ count: 14, box: { min: [-5, 3.8, -20], max: [5, 6.4, -4] }, vel: [0.0, 0.0, 0.35], size: [4, 7], color: 0x2a2826, opacity: 0.65, seed: 12 });
    hd.add(this.smoke2.group);
    this.exposure.HD = 1.3;
    this.light.HD = { color: C(0.85, 0.6, 0.35), intensity: 0.42 };
  }
  onVariant(v) {
    // HD：隧道照明多數因火災斷電（燈具只剩微弱殘光）
    this.tunnel.mats.lampOn.color.copy(v === 'HD' ? C(0.12, 0.1, 0.08) : C(1.6, 1.45, 1.15));
  }
  update(dt, t, env) {
    if (this.variant !== 'HD') return;
    this.smoke.update(dt, t); this.smoke2.update(dt, t);
    // 琥珀燈恆亮（只有極慢的 ±4% 呼吸）
    this.amber.intensity = 9 * (1 + slowWave(t * 0.4, 1, 0.04));
  }
}

// =============================================================================
// CAM-02 主車道中段
// =============================================================================
export class Cam02 extends FeedChannel {
  constructor() {
    super(2);
    const tun = buildTunnel({ length: 140, zStart: 8, lampEvery: 6, lampFrom: -6.5, lamp: (i, side) => (i > 1 && (i * 7 + (side > 0 ? 3 : 0)) % 5 < 2 ? 0 : 1), seed: 2 });
    this.tunnel = tun;
    this.shared.add(tun.group);
    this.aim([-3.4, 5.1, 1.0], [0.9, -3.4, -34]);
    // 路面的煞車痕（兩種佈置都有）
    const skidC = document.createElement('canvas'); skidC.width = 64; skidC.height = 512;
    { const g = skidC.getContext('2d'); const r = rng(5);
      for (const x of [14, 46]) { for (let y = 0; y < 512; y += 2) { const a = 0.35 + 0.35 * Math.sin(y * 0.02 + x) * r(); g.fillStyle = `rgba(5,5,5,${a})`; g.fillRect(x - 5 + Math.sin(y * 0.011) * 4, y, 10, 2); } } }
    const skidT = new THREE.CanvasTexture(skidC); skidT.colorSpace = THREE.SRGBColorSpace;
    for (const [x, z, ry] of [[-1.6, -20, 0.08], [1.9, -24, -0.12]]) {
      const p = plane(1.8, 14, skidT, { pos: [x, 0.012, z], rot: [-Math.PI / 2, 0, ry], decal: true, roughness: 0.9 });
      this.shared.add(p);
    }

    // ---- LD：昏暗車道，遠處一團模糊的熱源亮斑 ----
    fogBg(this, 'LD', 0x34383b, 0.024);
    const ld = this.ld;
    ld.add(new THREE.HemisphereLight(0xb8bcc0, 0x303030, 0.35));
    for (const [z, I] of [[-4, 34], [-20, 26], [-38, 20]]) {
      const p = new THREE.PointLight(0xffefd6, I, 0, 2); p.position.set(0.5, 4.0, z); ld.add(p);
    }
    for (const L of tun.lamps) if (L.on > 0 && L.z > -70) ld.add(glow(C(1.0, 0.95, 0.85), [1.8, 1.0], [L.x * 0.97, L.y - 0.05, L.z], { opacity: 0.4 }));
    this.blob = glow(C(1.0, 0.92, 0.8), [26, 14], [1.2, 1.6, -60], { opacity: 0.85, fog: false });
    this.blobCore = glow(C(1.0, 0.95, 0.88), [8, 4.4], [1.0, 1.1, -60], { opacity: 0.8, fog: false });
    ld.add(this.blob, this.blobCore);
    this.exposure.LD = 1.4;
    this.light.LD = { color: C(0.72, 0.82, 1.0), intensity: 0.45 };

    // ---- HD：燃燒中的多車追撞殘骸＋翻覆油罐車 ----
    fogBg(this, 'HD', 0x24170e, 0.021);
    const hd = this.hd;
    hd.add(new THREE.HemisphereLight(0x5a4030, 0x100a06, 0.3));
    const W = new THREE.Group(); hd.add(W);
    const tanker = buildTanker({ seed: 3 }); tanker.position.set(0.6, 0, -27.5); tanker.rotation.y = 0.52; W.add(tanker);
    const cab = buildTruckCab({ seed: 4 }); cab.position.set(-3.2, 0, -34.5); cab.rotation.set(0, 1.25, 0.06); W.add(cab);
    const cars = [
      { p: [-2.0, 0, -12.5], r: [0, 0.95, 0], o: { burnt: true, crushed: 0.6, seed: 21 } },
      { p: [2.1, 0.9, -16.5], r: [0.05, 0.3, Math.PI / 2], o: { burnt: true, crushed: 0.3, seed: 22 } },
      { p: [-0.5, 0, -20.5], r: [0, -0.42, 0], o: { burnt: true, crushed: 0.95, seed: 23 } },
      { p: [2.6, 0, -9.0], r: [0, 0.22, 0.0], o: { paint: 0x6b1010, crushed: 0.75, seed: 24 } },
    ];
    for (const c of cars) { const car = buildSedan(c.o); car.position.set(...c.p); car.rotation.set(...c.r); W.add(car); }
    // 殘骸碎片
    const deb = [], r = rng(9);
    for (let i = 0; i < 46; i++) deb.push(boxG(0.1 + r() * 0.5, 0.03 + r() * 0.1, 0.1 + r() * 0.4, (r() - 0.5) * 7.5, 0.04, -5 - r() * 26, r() * 3));
    mesh(mergeList(deb), std({ color: 0x1c1a18, roughness: 0.9, metalness: 0.3 }), W);
    for (const [x, z, s] of [[0.3, -23, 9], [-2.4, -13, 5], [2.4, -18, 6]]) W.add(plane(s, s * 0.8, TX.debrisDecal(151 + x * 10), { pos: [x, 0.015, z], rot: [-Math.PI / 2, 0, x], decal: true }));
    // 燃燒的油池
    const pool = plane(10, 7, TX.fuelFire(), { pos: [0.5, 0.03, -23.0], rot: [-Math.PI / 2, 0, 0.3], basic: true, decal: true, color: C(2.2, 1.3, 0.6) });
    pool.material.blending = THREE.AdditiveBlending;
    W.add(pool);
    this.fires = [
      new FireCluster({ count: 9, spread: [6.5, 3.0], height: [1.4, 3.2], pos: [0.5, 0, -22.5], seed: 31, intensity: 1.5 }),
      new FireCluster({ count: 8, spread: [4.5, 1.2], height: [2.8, 5.0], pos: [-0.2, 1.4, -26.8], seed: 32, intensity: 1.6 }),
      new FireCluster({ count: 4, spread: [1.5, 1.0], height: [0.9, 1.9], pos: [-0.7, 0.5, -20.2], seed: 33, intensity: 1.4 }),
      new FireCluster({ count: 3, spread: [1.0, 1.0], height: [0.6, 1.3], pos: [-1.9, 0.6, -12.6], seed: 34, intensity: 1.2 }),
    ];
    for (const f of this.fires) W.add(f.group);
    W.add(glow(C(1.0, 0.45, 0.12), [18, 10], [0.3, 2.4, -24], { opacity: 0.55 }));
    this.fireLights = [
      { l: new THREE.PointLight(0xff7a2a, 170, 0, 2), base: 170, seed: 1 },
      { l: new THREE.PointLight(0xff8a3a, 120, 0, 2), base: 120, seed: 2.7 },
      { l: new THREE.PointLight(0xff6a20, 26, 0, 2), base: 26, seed: 4.1 },
    ];
    this.fireLights[0].l.position.set(0.3, 2.0, -21.5);
    this.fireLights[1].l.position.set(-0.4, 3.6, -26.5);
    this.fireLights[2].l.position.set(-1.9, 1.5, -11.5);
    for (const f of this.fireLights) hd.add(f.l);
    // 濃煙：火場升起、沿拱頂朝鏡頭方向擴散
    this.plume = new SmokeField({ count: 18, box: { min: [-2.5, 1.8, -29], max: [2.5, 4.0, -20] }, vel: [0, 0.16, 0.12], size: [3.5, 6.5], color: 0x6a3a1c, opacity: 0.6, seed: 41 });
    this.ceilingSmoke = new SmokeField({ count: 32, box: { min: [-5, 3.9, -36], max: [5, 6.5, -4] }, vel: [0, 0.0, 0.5], size: [6, 11], color: 0x2c1f16, opacity: 1.0, seed: 42 });
    hd.add(this.plume.group, this.ceilingSmoke.group);
    // 緩慢上升的火星
    this.embers = [];
    const er = rng(51);
    for (let i = 0; i < 18; i++) {
      const s = glow(C(1.0, 0.6, 0.2), [0.12, 0.12], [0, 0, 0], { opacity: 0.9 });
      const e = { s, x: (er() - 0.5) * 6, z: -20 - er() * 8, ph: er(), sp: 0.12 + er() * 0.1 };
      this.embers.push(e); hd.add(s);
    }
    this.exposure.HD = 1.0;
    this.light.HD = { color: C(1.0, 0.55, 0.26), intensity: 0.62 };
    this._wave = 0;
  }
  onVariant(v) {
    this.tunnel.mats.lampOn.color.copy(v === 'HD' ? C(0.06, 0.05, 0.04) : C(1.4, 1.3, 1.05));
  }
  update(dt, t, env) {
    const calm = env?.reduceFlicker ? 0.5 : 1;
    if (this.variant === 'LD') {
      // 熱源亮斑：極慢的明暗（週期約 4 秒、±8%）
      const k = 1 + Math.sin(t * 1.55) * 0.08 * calm;
      this.blob.material.opacity = 0.85 * k;
      this.blobCore.material.opacity = 0.8 * (2 - k);
      return;
    }
    if (this.variant !== 'HD') return;
    for (const f of this.fires) f.update(dt, t, calm);
    this._wave = slowWave(t * 0.9, 0.3, 0.11 * calm);
    for (const f of this.fireLights) f.l.intensity = f.base * (1 + slowWave(t * 0.9, f.seed, 0.11 * calm));
    this.plume.update(dt, t); this.ceilingSmoke.update(dt, t);
    for (const e of this.embers) {
      const life = (t * e.sp + e.ph) % 1;
      e.s.position.set(e.x + Math.sin(t * 0.5 + e.ph * 9) * 0.6, 0.6 + life * 5.5, e.z + life * 2.5);
      e.s.material.opacity = 0.9 * clamp(life / 0.15) * clamp((1 - life) / 0.4);
    }
  }
  screenLight(t, out, reduceFlicker) {
    super.screenLight(t, out);
    if (this.variant === 'HD') out.intensity *= 1 + this._wave * 0.8;
  }
}

// =============================================================================
// CAM-03 公務維修廊道 B區（攝影機在防爆門上方，原點 = 防爆門門面，廊道往 -Z）
// =============================================================================
export const CORR = { halfW: 0.95, h: 2.75, end: -16.3, opening: [-14.55, -16.15] };

export class Cam03 extends FeedChannel {
  constructor() {
    // 垂直 66°（4:3 下約等於水平 82°，走廊監視器的廣角），俯角約 22.5°
    super(3, { fov: 66, near: 0.05, far: 60 });
    const { halfW, h, end } = CORR;
    const camPos = [0.28, 2.52, -0.2];
    this.aim(camPos, [0.02, 0.0, -6.3]);
    this.figure = new Figure({ faceTarget: new THREE.Vector3(...camPos) });
    this.scene.add(this.figure.group);
    this._buildCorridor();

    // ---- LD：紅外線補光（鏡頭旁）＋盡頭一盞昏暗的燈 ----
    fogBg(this, 'LD', 0x1b1d20, 0.028);
    const ld = this.ld;
    ld.add(new THREE.HemisphereLight(0x8c9298, 0x1a1a1a, 0.06));
    // 紅外線補光：一道集中照向廊道中段的主光束＋一道很弱的廣角補光（近處牆面只有微光）
    const ir = new THREE.SpotLight(0xf2f6ff, 36, 0, 0.4, 0.6, 2);
    ir.position.set(camPos[0], camPos[1] - 0.06, camPos[2] - 0.05);
    ir.target.position.set(0.0, 0.9, -10.5);
    const irFill = new THREE.SpotLight(0xf2f6ff, 3.2, 0, 0.95, 0.9, 2);
    irFill.position.copy(ir.position);
    irFill.target.position.set(0.0, -1.0, -5.0);
    ld.add(ir, ir.target, irFill, irFill.target);
    this.ir = ir;
    const far = new THREE.PointLight(0xffe6c0, 1.4, 0, 2);
    far.position.set(0.32, 2.5, end + 0.3);
    ld.add(far);
    // 盡頭的地面/牆腳反光（在人影身後 → 剪影）
    const farFill = new THREE.PointLight(0xffe6c0, 1.6, 0, 2);
    farFill.position.set(0.0, 0.6, end + 0.3);
    ld.add(farFill);
    this.farLamp = far;
    ld.add(glow(C(1.0, 0.92, 0.75), [0.8, 0.6], [0.32, 2.52, end + 0.12], { opacity: 0.7 }));
    this.exposure.LD = 3.0;
    this.light.LD = { color: C(0.72, 0.82, 1.0), intensity: 0.5 };
    // 人影投在地上的長影（盡頭燈在他身後時）
    this.longShadow = plane(0.75, 3, TX.longShadow(), { decal: true, basic: true, color: 0xffffff, opacity: 0.85 });
    this.longShadow.material.color.set(0xffffff);
    this.longShadow.rotation.x = -Math.PI / 2;
    this.longShadow.renderOrder = 2;
    this.ld.add(this.longShadow);

    // ---- HD：濃煙、盡頭轉角竄出的火光、門上方的燈照著劈門的消防員 ----
    fogBg(this, 'HD', 0x1f150e, 0.05);
    const hd = this.hd;
    hd.add(new THREE.HemisphereLight(0x5a4434, 0x0c0806, 0.16));
    this.doorLamp = new THREE.PointLight(0xffd8a8, 3.6, 0, 2);
    this.doorLamp.position.set(-0.1, 2.62, -0.32);
    hd.add(this.doorLamp);
    this.fireLight = new THREE.PointLight(0xff6a22, 34, 0, 2);
    this.fireLight.position.set(-1.7, 1.0, -15.3);
    this.fireLight2 = new THREE.PointLight(0xff8a3a, 9, 0, 2);
    this.fireLight2.position.set(-0.55, 2.0, -14.6);
    hd.add(this.fireLight, this.fireLight2);
    this.fire = new FireCluster({ count: 7, spread: [0.7, 1.3], height: [0.7, 1.8], pos: [-0.95, 0, -15.3], seed: 61, intensity: 1.5 });
    hd.add(this.fire.group);
    hd.add(glow(C(1.0, 0.45, 0.14), [3.4, 2.8], [-0.7, 1.1, -15.2], { opacity: 0.55, fog: false }));
    this.smoke = new SmokeField({ count: 28, box: { min: [-0.9, 1.5, -16], max: [0.9, 2.7, -3] }, vel: [0, -0.005, 0.34], size: [1.8, 3.4], color: 0x3a3029, opacity: 0.75, seed: 71 });
    this.smokeLow = new SmokeField({ count: 10, box: { min: [-0.9, 0.3, -16], max: [0.9, 1.6, -9] }, vel: [0.0, 0.02, 0.18], size: [1.4, 2.6], color: 0x4a2c18, opacity: 0.38, seed: 72 });
    hd.add(this.smoke.group, this.smokeLow.group);
    this._buildHDDressing();
    this.exposure.HD = 1.15;
    this.light.HD = { color: C(1.0, 0.68, 0.42), intensity: 0.5 };
    this._wave = 0;
    this.setFigurePose(0);
  }

  _buildCorridor() {
    const { halfW, h, end, opening } = CORR;
    const S = this.shared;
    const len = 0.6 - end;
    const zc = (0.6 + end) / 2;
    const wallTex = TX.rep(TX.corridorConcrete(), len / 3, 1);
    const wallM = std({ map: wallTex, color: 0xa4a4a0, roughness: 0.9 });
    const dadoM = std({ map: TX.rep(TX.paintedDado(), len / 2.5, 1), roughness: 0.55 });
    const floorM = std({ map: TX.rep(TX.corridorFloor(), 1, len / 2.2), roughnessMap: TX.rep(TX.wetRoughness(), 1, len / 4), roughness: 1.0, metalness: 0.0 });
    const ceilM = std({ map: TX.rep(TX.archConcrete(), 1, len / 3), color: 0x8a8a88, roughness: 0.95 });
    // 地板與天花板
    const fl = new THREE.PlaneGeometry(halfW * 2, len); fl.rotateX(-Math.PI / 2); fl.translate(0, 0, zc);
    mesh(fl, floorM, S);
    const ce = new THREE.PlaneGeometry(halfW * 2, len); ce.rotateX(Math.PI / 2); ce.translate(0, h, zc);
    mesh(ce, ceilM, S);
    // 牆：上半混凝土、下半油漆（左牆在盡頭有一個往左轉的開口）
    const dadoH = 1.1;
    const wallPiece = (x, z0, z1, y0, y1, faceRight) => {
      const g = new THREE.PlaneGeometry(Math.abs(z1 - z0), y1 - y0);
      g.rotateY(faceRight ? Math.PI / 2 : -Math.PI / 2);
      g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
      return g;
    };
    const upper = [wallPiece(-halfW, 0.6, opening[0], dadoH, h, true), wallPiece(halfW, 0.6, end, dadoH, h, false),
      wallPiece(-halfW, opening[1], end, dadoH, h, true), wallPiece(-halfW, opening[0], opening[1], 2.25, h, true)];
    const lower = [wallPiece(-halfW, 0.6, opening[0], 0, dadoH, true), wallPiece(halfW, 0.6, end, 0, dadoH, false),
      wallPiece(-halfW, opening[1], end, 0, dadoH, true)];
    mesh(mergeList(upper), wallM, S);
    mesh(mergeList(lower), dadoM, S);
    // 盡頭牆
    const ew = new THREE.PlaneGeometry(halfW * 2, h); ew.translate(0, h / 2, end);
    mesh(ew, std({ map: TX.rep(TX.corridorConcrete(), 0.7, 1), roughness: 0.9 }), S);
    const ewd = new THREE.PlaneGeometry(halfW * 2, dadoH); ewd.translate(0, dadoH / 2, end + 0.005);
    mesh(ewd, std({ map: TX.rep(TX.paintedDado(), 0.8, 1), roughness: 0.55 }), S);
    // 轉角後的側通道（漆黑）
    const side = [];
    const sf = new THREE.PlaneGeometry(3, opening[0] - opening[1]); sf.rotateX(-Math.PI / 2); sf.translate(-halfW - 1.5, 0, (opening[0] + opening[1]) / 2); side.push(sf);
    const sc = new THREE.PlaneGeometry(3, opening[0] - opening[1]); sc.rotateX(Math.PI / 2); sc.translate(-halfW - 1.5, 2.25, (opening[0] + opening[1]) / 2); side.push(sc);
    side.push(wallPiece(-halfW - 1.5, opening[0], opening[0] - 0.001, 0, 2.25, true));
    const sw1 = new THREE.PlaneGeometry(3, 2.25); sw1.translate(-halfW - 1.5, 1.125, opening[1]); side.push(sw1);
    const sw2 = new THREE.PlaneGeometry(3, 2.25); sw2.rotateY(Math.PI); sw2.translate(-halfW - 1.5, 1.125, opening[0]); side.push(sw2);
    mesh(mergeList(side), std({ map: TX.rep(TX.corridorConcrete(), 1, 1), color: 0x777777, roughness: 0.9, side: THREE.DoubleSide }), S);

    // 管線（左上牆）、托架
    const pipeM = std({ map: TX.paintedMetal(81, [60, 66, 62], [104, 112, 104]), roughness: 0.55, metalness: 0.5 });
    const pipes = [];
    for (const [x, y, r] of [[-halfW + 0.12, 2.42, 0.07], [-halfW + 0.1, 2.22, 0.05], [-halfW + 0.09, 2.06, 0.035]]) {
      const p = new THREE.CylinderGeometry(r, r, len, 12); p.rotateX(Math.PI / 2); p.translate(x, y, zc); pipes.push(p);
    }
    for (let z = -0.8; z > end; z -= 2.2) {
      pipes.push(boxG(0.22, 0.04, 0.05, -halfW + 0.11, 2.52, z), boxG(0.03, 0.6, 0.05, -halfW + 0.02, 2.24, z));
      // 法蘭
      const fl2 = new THREE.CylinderGeometry(0.095, 0.095, 0.05, 12); fl2.rotateX(Math.PI / 2); fl2.translate(-halfW + 0.12, 2.42, z - 1.1); pipes.push(fl2);
    }
    mesh(mergeList(pipes), pipeM, S);
    // 電纜架（右上）＋電纜
    const trayM = std({ color: 0x55585a, roughness: 0.6, metalness: 0.6 });
    const tlen = -1.3 - end, tzc = (-1.3 + end) / 2;
    const tray = [boxG(0.36, 0.02, tlen, halfW - 0.22, 2.5, tzc), boxG(0.02, 0.08, tlen, halfW - 0.4, 2.53, tzc), boxG(0.02, 0.08, tlen, halfW - 0.04, 2.53, tzc)];
    for (let z = -2.6; z > end; z -= 1.8) tray.push(boxG(0.02, 0.24, 0.03, halfW - 0.22, 2.63, z));
    mesh(mergeList(tray), trayM, S);
    const cab = [];
    for (const [x, r] of [[halfW - 0.3, 0.025], [halfW - 0.22, 0.03], [halfW - 0.13, 0.022]]) { const c = new THREE.CylinderGeometry(r, r, tlen, 8); c.rotateX(Math.PI / 2); c.translate(x, 2.54, tzc); cab.push(c); }
    mesh(mergeList(cab), std({ color: 0x151515, roughness: 0.7 }), S);
    // 天花板的艙壁燈（都沒亮）
    const lampOff = [];
    for (let z = -2.8; z > end + 1; z -= 4) lampOff.push(boxG(0.32, 0.08, 0.18, 0, h - 0.04, z));
    mesh(mergeList(lampOff), std({ color: 0x1c1c1b, roughness: 0.35, metalness: 0.5 }), S);
    // 盡頭的燈具（亮著的那一盞）
    this.farLampMat = new THREE.MeshBasicMaterial({ color: C(1.5, 1.35, 1.05) });
    mesh(boxG(0.3, 0.14, 0.1, 0.32, 2.52, end + 0.06), this.farLampMat, S);
    mesh(mergeList([boxG(0.34, 0.02, 0.12, 0.32, 2.6, end + 0.06), boxG(0.34, 0.02, 0.12, 0.32, 2.44, end + 0.06)]), trayM, S);
    // 排水溝（右側）
    const grate = document.createElement('canvas'); grate.width = 32; grate.height = 64;
    { const g = grate.getContext('2d'); g.fillStyle = '#050505'; g.fillRect(0, 0, 32, 64); g.fillStyle = '#555'; for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 32, 3); g.fillRect(0, 0, 3, 64); g.fillRect(29, 0, 3, 64); }
    const grT = new THREE.CanvasTexture(grate); grT.colorSpace = THREE.SRGBColorSpace; grT.wrapT = THREE.RepeatWrapping; grT.repeat.set(1, len / 0.5);
    const gr = new THREE.PlaneGeometry(0.22, len); gr.rotateX(-Math.PI / 2); gr.translate(halfW - 0.13, 0.006, zc);
    mesh(gr, std({ map: grT, roughness: 0.5, metalness: 0.5 }), S);
    // 消防栓箱（右牆）＋紅燈、側門（右牆）
    const cabM = std({ color: 0x9c2219, roughness: 0.45, metalness: 0.2 });
    mesh(boxG(0.12, 0.78, 0.62, halfW - 0.06, 1.05, -6.6), cabM, S);
    mesh(boxG(0.05, 0.07, 0.12, halfW - 0.03, 1.56, -6.6), new THREE.MeshBasicMaterial({ color: C(1.6, 0.1, 0.06) }), S);
    S.add(plane(0.5, 0.16, TX.signTexture('消防栓', { style: 'red', w: 256, h: 80, size: 48 }), { pos: [halfW - 0.005, 1.72, -6.6], rot: [0, -Math.PI / 2, 0] }));
    const doorM = std({ map: TX.paintedMetal(85, [70, 78, 82], [110, 118, 120]), roughness: 0.5, metalness: 0.5 });
    mesh(boxG(0.06, 2.05, 0.95, halfW - 0.02, 1.025, -11.2), doorM, S);
    mesh(mergeList([boxG(0.08, 2.15, 0.06, halfW - 0.03, 1.07, -10.7), boxG(0.08, 2.15, 0.06, halfW - 0.03, 1.07, -11.7), boxG(0.08, 0.06, 1.05, halfW - 0.03, 2.12, -11.2)]), trayM, S);
    mesh(boxG(0.06, 0.04, 0.16, halfW - 0.08, 1.0, -10.85), trayM, S);
    S.add(plane(0.36, 0.12, TX.signTexture('電纜室', { style: 'plate', w: 192, h: 64, size: 40 }), { pos: [halfW - 0.06, 1.62, -11.2], rot: [0, -Math.PI / 2, 0] }));
    // 牆面噴漆標示
    S.add(plane(1.1, 0.45, TX.stencilTexture('B區', { w: 256, h: 104, size: 92 }), { pos: [-halfW + 0.004, 1.75, -3.3], rot: [0, Math.PI / 2, 0], decal: true, roughness: 0.8 }));
    S.add(plane(1.6, 0.24, TX.stencilTexture('公務維修廊道', { w: 512, h: 80, size: 64 }), { pos: [halfW - 0.004, 1.82, -4.2], rot: [0, -Math.PI / 2, 0], decal: true, roughness: 0.8 }));
    S.add(plane(0.6, 0.22, TX.stencilTexture('B-07', { w: 256, h: 96, size: 80 }), { pos: [halfW - 0.004, 1.85, -13.2], rot: [0, -Math.PI / 2, 0], decal: true, roughness: 0.8 }));
    // 盡頭轉角上方的避難方向燈（綠）
    S.add(plane(0.42, 0.16, TX.exitSignTexture(), { pos: [-halfW + 0.03, 2.42, (opening[0] + opening[1]) / 2], rot: [0, Math.PI / 2, 0], basic: true, color: C(1.3, 1.3, 1.3) }));
    S.add(glow(C(0.3, 1.0, 0.5), [0.9, 0.5], [-halfW + 0.1, 2.42, (opening[0] + opening[1]) / 2], { opacity: 0.45 }));
  }

  _buildHDDressing() {
    const hd = this.hd;
    const { halfW, end, opening } = CORR;
    // 盡頭牆與轉角的煙燻焦痕
    hd.add(plane(2.0, 2.7, TX.sootPlume(121), { pos: [0, 1.4, end + 0.012], decal: true, roughness: 1 }));
    hd.add(plane(2.8, 2.6, TX.sootPlume(122), { pos: [-halfW + 0.01, 1.35, opening[0] + 0.9], rot: [0, Math.PI / 2, 0], decal: true, roughness: 1 }));
    hd.add(plane(3.0, 2.6, TX.sootPlume(123), { pos: [halfW - 0.01, 1.4, -14.4], rot: [0, -Math.PI / 2, 0], decal: true, roughness: 1 }));
    const ceil = plane(1.9, 7, TX.sootPlume(124), { pos: [0, 2.74, -12], rot: [Math.PI / 2, 0, 0], decal: true, roughness: 1 });
    hd.add(ceil);
    // 掉落的電纜架、碎片
    const fallen = mesh(mergeList([boxG(0.36, 0.02, 2.2, 0, 0, 0), boxG(0.02, 0.08, 2.2, -0.17, 0.03, 0), boxG(0.02, 0.08, 2.2, 0.17, 0.03, 0)]), std({ color: 0x3a3c3e, roughness: 0.6, metalness: 0.6 }), hd);
    fallen.position.set(0.35, 0.7, -9.3); fallen.rotation.set(0.42, 0.2, 0.15);
    const deb = [], r = rng(81);
    for (let i = 0; i < 22; i++) deb.push(boxG(0.04 + r() * 0.18, 0.02 + r() * 0.04, 0.04 + r() * 0.16, (r() - 0.5) * 1.5, 0.02, -3 - r() * 12, r() * 3));
    mesh(mergeList(deb), std({ color: 0x1a1816, roughness: 0.9 }), hd);
    hd.add(plane(1.6, 1.4, TX.debrisDecal(152), { pos: [-0.2, 0.012, -12.5], rot: [-Math.PI / 2, 0, 0.4], decal: true }));
    // 消防水帶：從轉角沿地面拖到門前
    const pts = [[-1.6, -15.2], [-0.7, -14.4], [-0.1, -12.6], [0.45, -10.5], [0.2, -8.2], [-0.35, -6.0], [-0.1, -3.9], [0.3, -2.3], [0.15, -1.3], [-0.25, -0.9]]
      .map(([x, z]) => new THREE.Vector3(x, 0.03, z));
    const curve = new THREE.CatmullRomCurve3(pts);
    const hose = new THREE.TubeGeometry(curve, 90, 0.035, 6, false);
    hose.scale(1, 0.55, 1);
    mesh(hose, std({ color: 0x7a5a40, roughness: 0.8 }), hd);
  }

  /** LD 姿勢＋長影 */
  setFigurePose(i) {
    this.figure.setPose(i);
    const w = FIGURE_WAYPOINTS[this.figure.index];
    const lamp = this.farLamp.position;
    const dx = w.x - lamp.x, dz = w.z - lamp.z;
    const d = Math.hypot(dx, dz);
    const op = clamp(1.6 / (d * d + 0.4), 0, 0.75);
    const L = clamp(1.75 * d / Math.max(0.25, lamp.y - 1.75), 0.8, 6.5);
    this.longShadow.visible = op > 0.03;
    this.longShadow.material.opacity = op;
    this.longShadow.scale.set(1, L / 3, 1);
    const ux = dx / (d || 1), uz = dz / (d || 1);
    this.longShadow.rotation.set(-Math.PI / 2, 0, Math.atan2(-ux, -uz));
    this.longShadow.position.set(w.x + ux * L / 2, 0.01, w.z + uz * L / 2);
  }

  onVariant(v) {
    this.figure.setLook(v);
    this.farLampMat.color.copy(v === 'HD' ? C(0.25, 0.12, 0.05) : C(1.5, 1.35, 1.05));
  }

  update(dt, t, env) {
    if (this.variant !== 'HD') return;
    const calm = env?.reduceFlicker ? 0.5 : 1;
    this.fire.update(dt, t, calm);
    this._wave = slowWave(t * 0.85, 1.3, 0.12 * calm);
    this.fireLight.intensity = 34 * (1 + this._wave);
    this.fireLight2.intensity = 9 * (1 + slowWave(t * 0.85, 2.9, 0.1 * calm));
    this.smoke.update(dt, t); this.smokeLow.update(dt, t);
  }
  screenLight(t, out) {
    super.screenLight(t, out);
    if (this.variant === 'HD') out.intensity *= 1 + this._wave * 0.5;
  }
}

// =============================================================================
// CAM-04 4號緊急停車彎
// =============================================================================
export class Cam04 extends FeedChannel {
  constructor() {
    super(4);
    const bayZ = [-10, -30], bayX = 8.4, bayH = 4.4;
    const tun = buildTunnel({ length: 100, zStart: 8, lampEvery: 6, lampFrom: -7.5, lamp: (i, side) => (side > 0 && i % 4 === 2 ? 0 : 1), rightGap: bayZ, fans: false, seed: 4 });
    this.tunnel = tun;
    this.shared.add(tun.group);
    this.aim([-1.6, 4.7, -9.2], [6.2, 0.2, -19.0]);
    this._buildBay(bayZ, bayX, bayH);

    // ---- LD：停車彎裡一輛熄火的白色轎車，駕駛座車門開著 ----
    fogBg(this, 'LD', 0x45494c, 0.03);
    const ld = this.ld;
    ld.add(new THREE.HemisphereLight(0xc0c4c8, 0x303030, 0.4));
    this.car = buildSedan({ paint: 0xf0f0ec, doorOpen: 0.95, interiorLight: 0.35, seed: 7 });
    this.car.position.set(6.7, 0, -17.2);
    this.car.rotation.y = 0.03;
    ld.add(this.car);
    ld.add(plane(2.4, 5.2, TX.shadowBlob(), { pos: [6.7, 0.012, -17.2], rot: [-Math.PI / 2, 0, 0], decal: true, basic: true, opacity: 0.8 }));
    for (const [x, z, I] of [[7.3, -15.5, 24], [7.3, -24.5, 18], [0, -4, 26], [0, -26, 26]]) {
      const p = new THREE.PointLight(0xfff1dc, I, 0, 2); p.position.set(x, x > 5 ? 4.15 : 5.6, z); ld.add(p);
    }
    for (const L of tun.lamps) if (L.on > 0 && L.z > -45) ld.add(glow(C(1.0, 0.95, 0.85), [1.6, 0.9], [L.x * 0.97, L.y - 0.05, L.z], { opacity: 0.3 }));
    this.exposure.LD = 1.1;
    this.light.LD = { color: C(0.74, 0.84, 1.0), intensity: 0.5 };

    // ---- HD：沒有車。褪色的封鎖線、焦黑牆面、殘骸 ----
    fogBg(this, 'HD', 0x2a2724, 0.034);
    const hd = this.hd;
    hd.add(new THREE.HemisphereLight(0x8a8580, 0x1a1816, 0.22));
    const bl = new THREE.PointLight(0xe8eef8, 30, 0, 2); bl.position.set(7.3, 4.15, -24.5); hd.add(bl);
    const bl2 = new THREE.PointLight(0xe8eef8, 16, 0, 2); bl2.position.set(7.0, 4.0, -15.5); hd.add(bl2);
    const tl = new THREE.PointLight(0xffe0c0, 12, 0, 2); tl.position.set(0, 5.6, -8); hd.add(tl);
    // 封鎖線：交通錐之間
    const coneM = std({ color: 0xc8521e, roughness: 0.65 }), stripeM = std({ color: 0xd8d8d0, roughness: 0.45 });
    const posts = [[4.75, -11.2], [5.05, -16.6], [5.1, -22.4], [4.8, -28.6]];
    posts.forEach(([x, z], i) => { const c = cone(coneM, stripeM); c.position.set(x, 0, z); c.rotation.y = i * 1.3; if (i === 2) c.rotation.z = 0.0; hd.add(c); });
    const tapeT = TX.policeTape();
    for (let i = 0; i < posts.length - 1; i++) {
      const [x0, z0] = posts[i], [x1, z1] = posts[i + 1];
      hd.add(tapeRibbon([x0, 0.66, z0], [x1, 0.66, z1], { sag: 0.18 + i * 0.05, width: 0.13, map: tapeT, seed: i + 1 }));
      if (i !== 1) hd.add(tapeRibbon([x0, 0.62, z0], [x1, 0.62, z1], { sag: 0.42 + i * 0.08, width: 0.12, map: tapeT, seed: i + 21, twist: 0.6 }));
    }
    hd.add(tapeRibbon([4.75, 0.66, -11.2], [5.2, 1.3, -10.1], { sag: 0.05, width: 0.075, map: tapeT, seed: 9 }));
    // 一段斷掉垂落的封鎖線
    hd.add(tapeRibbon([4.8, 0.66, -28.6], [5.6, 0.04, -29.6], { sag: 0.05, width: 0.075, map: tapeT, seed: 10 }));
    // 焦黑煙燻痕跡（停車彎內牆、頂板、斜牆）
    hd.add(plane(9.5, bayH, TX.sootPlume(131), { pos: [bayX - 0.012, bayH / 2, -20], rot: [0, -Math.PI / 2, 0], decal: true, roughness: 1 }));
    hd.add(plane(7.5, bayH, TX.sootPlume(132), { pos: [bayX - 0.014, bayH / 2 + 0.1, -15.2], rot: [0, -Math.PI / 2, 0], decal: true, roughness: 1 }));
    hd.add(plane(6.5, bayH, TX.sootPlume(135), { pos: [bayX - 0.016, bayH / 2, -19.6], rot: [0, -Math.PI / 2, 0], decal: true, roughness: 1 }));
    hd.add(plane(5.0, bayH * 0.9, TX.sootPlume(136), { pos: [bayX - 0.018, bayH * 0.45, -23.8], rot: [0, -Math.PI / 2, 0], decal: true, roughness: 1 }));
    hd.add(plane(4.2, 14, TX.sootPlume(133), { pos: [6.6, bayH - 0.012, -20], rot: [Math.PI / 2, 0, Math.PI / 2], decal: true, roughness: 1 }));
    hd.add(plane(8, 4, TX.sootPlume(134), { pos: [3.6, 5.6, -20], rot: [Math.PI / 2 - 0.6, 0, Math.PI / 2], decal: true, roughness: 1 }));
    // 地面：灰燼、碎片、積水、倒地的滅火器
    for (const [x, z, s, sd] of [[6.6, -19, 5.5, 153], [7.4, -23.5, 3.5, 154], [6.0, -15.5, 3, 155]]) hd.add(plane(s, s * 0.9, TX.debrisDecal(sd), { pos: [x, 0.016, z], rot: [-Math.PI / 2, 0, x + z], decal: true }));
    const deb = [], r = rng(91);
    for (let i = 0; i < 30; i++) deb.push(boxG(0.05 + r() * 0.3, 0.02 + r() * 0.06, 0.05 + r() * 0.25, 5.2 + r() * 3, 0.03, -12 - r() * 16, r() * 3));
    mesh(mergeList(deb), std({ color: 0x191714, roughness: 0.9, metalness: 0.2 }), hd);
    const puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 20), std({ color: 0x050505, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.55, depthWrite: false }));
    puddle.rotation.x = -Math.PI / 2; puddle.scale.set(1.6, 0.9, 1); puddle.position.set(6.2, 0.018, -21.5); hd.add(puddle);
    const ext = mesh(mergeList([new THREE.CylinderGeometry(0.09, 0.09, 0.5, 12), new THREE.CylinderGeometry(0.03, 0.03, 0.08, 8).translate(0, 0.29, 0)]), std({ color: 0x8e1d14, roughness: 0.4, metalness: 0.3 }), hd);
    ext.rotation.set(Math.PI / 2, 0, 0.7); ext.position.set(7.6, 0.09, -17.2);
    // 輕煙霾
    this.haze = new SmokeField({ count: 16, box: { min: [2, 0.8, -32], max: [8, 4.4, -12] }, vel: [-0.05, 0.02, 0.12], size: [3, 6], color: 0x6a6460, opacity: 0.3, seed: 95 });
    hd.add(this.haze.group);
    this.exposure.HD = 1.25;
    this.light.HD = { color: C(0.74, 0.76, 0.8), intensity: 0.42 };
  }

  _buildBay(bayZ, bayX, bayH) {
    const S = this.shared;
    const { wall, curb } = TUNNEL;
    const [z0, z1] = bayZ;
    const taper = 3;
    const tilesM = std({ map: TX.rep(TX.tunnelTiles(), 1, 1), roughness: 0.42, side: THREE.DoubleSide });
    tilesM.map.repeat.set(1 / 1.6, 1 / 1.6);
    const wallQuad = (ax, az, bx, bz, y0, y1) => {
      const g = new THREE.BufferGeometry();
      const L = Math.hypot(bx - ax, bz - az);
      g.setAttribute('position', new THREE.Float32BufferAttribute([ax, y0, az, bx, y0, bz, ax, y1, az, bx, y1, bz], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, y0, L, y0, 0, y1, L, y1], 2));
      g.setIndex([0, 1, 2, 1, 3, 2]);
      g.computeVertexNormals();
      return g;
    };
    const walls = [
      wallQuad(wall, z0, bayX, z0 - taper, 0, bayH),
      wallQuad(bayX, z0 - taper, bayX, z1 + taper, 0, bayH),
      wallQuad(bayX, z1 + taper, wall, z1, 0, bayH),
    ];
    mesh(mergeList(walls), tilesM, S);
    // 停車彎地面（混凝土，白色邊線）
    const floorC = document.createElement('canvas'); floorC.width = 256; floorC.height = 512;
    { const g = floorC.getContext('2d'); g.fillStyle = '#4a4a48'; g.fillRect(0, 0, 256, 512);
      const r = rng(4); for (let i = 0; i < 3000; i++) { const v = 50 + r() * 50; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(r() * 256, r() * 512, 2, 2); }
      g.strokeStyle = 'rgba(220,218,205,0.85)'; g.lineWidth = 8; g.strokeRect(14, 14, 228, 484);
      g.strokeStyle = 'rgba(210,180,60,0.7)'; g.lineWidth = 6;
      for (let y = -256; y < 512; y += 40) { g.beginPath(); g.moveTo(18, y + 220); g.lineTo(238, y); g.stroke(); }
      g.fillStyle = '#4a4a48'; g.fillRect(30, 60, 196, 392);
      g.fillStyle = 'rgba(220,218,205,0.6)'; g.font = 'bold 120px sans-serif'; g.textAlign = 'center'; g.fillText('4', 128, 300); }
    const floorT = new THREE.CanvasTexture(floorC); floorT.colorSpace = THREE.SRGBColorSpace;
    const fg = new THREE.PlaneGeometry(bayX - wall + 1.0, z0 - z1 - 0.5);
    fg.rotateX(-Math.PI / 2); fg.translate((bayX + wall - 1.0) / 2, 0.005, (z0 + z1) / 2);
    mesh(fg, std({ map: floorT, roughness: 0.85 }), S);
    // 頂板
    const cg = new THREE.PlaneGeometry(bayX - wall + 0.7, z0 - z1); cg.rotateX(Math.PI / 2); cg.translate((bayX + wall - 0.7) / 2, bayH, (z0 + z1) / 2);
    mesh(cg, std({ map: TX.rep(TX.archConcrete(), 2, 4), roughness: 0.95 }), S);
    // 停車彎頂板燈
    const lampOnM = new THREE.MeshBasicMaterial({ color: C(1.6, 1.5, 1.3) });
    this.bayLamps = mesh(mergeList([boxG(0.5, 0.08, 1.4, 7.3, bayH - 0.05, -15.5), boxG(0.5, 0.08, 1.4, 7.3, bayH - 0.05, -24.5)]), lampOnM, S);
    this.bayLampMat = lampOnM;
    // 告示：緊急停車彎 4、緊急電話箱、消防栓箱
    S.add(plane(2.4, 0.8, TX.signTexture('緊急停車彎', { style: 'blue', w: 384, h: 128, size: 64 }), { pos: [bayX - 0.02, 3.5, -17.2], rot: [0, -Math.PI / 2, 0], emissive: 0.25, roughness: 0.5 }));
    S.add(plane(0.8, 0.8, TX.signTexture('4', { style: 'blue', w: 128, h: 128, size: 100 }), { pos: [bayX - 0.02, 3.5, -15.4], rot: [0, -Math.PI / 2, 0], emissive: 0.25, roughness: 0.5 }));
    const sosM = std({ color: 0xd06a1c, roughness: 0.5, metalness: 0.2 });
    mesh(boxG(0.3, 1.2, 0.8, bayX - 0.15, 1.1, -21.8), sosM, S);
    S.add(plane(0.72, 0.26, TX.signTexture('緊急電話', { style: 'orange', w: 256, h: 92, size: 52 }), { pos: [bayX - 0.31, 1.45, -21.8], rot: [0, -Math.PI / 2, 0], emissive: 0.15 }));
    mesh(boxG(0.08, 0.1, 0.22, bayX - 0.08, 1.95, -21.8), new THREE.MeshBasicMaterial({ color: C(1.6, 1.4, 1.0) }), S);
    mesh(boxG(0.2, 0.9, 0.7, bayX - 0.1, 1.0, -24.4), std({ color: 0xa8241c, roughness: 0.5 }), S);
    S.add(plane(0.6, 0.2, TX.signTexture('消防栓', { style: 'red', w: 256, h: 84, size: 50 }), { pos: [bayX - 0.21, 1.62, -24.4], rot: [0, -Math.PI / 2, 0] }));
    mesh(boxG(0.06, 0.08, 0.16, bayX - 0.14, 1.53, -24.4), new THREE.MeshBasicMaterial({ color: C(1.6, 0.1, 0.06) }), S);
  }
  onVariant(v) {
    this.tunnel.mats.lampOn.color.copy(v === 'HD' ? C(0.5, 0.45, 0.38) : C(1.5, 1.38, 1.1));
    this.bayLampMat.color.copy(v === 'HD' ? C(0.9, 0.95, 1.0) : C(1.6, 1.5, 1.3));
  }
  update(dt, t) {
    if (this.variant === 'HD') this.haze.update(dt, t);
  }
}

export function createChannels() {
  return { 1: new Cam01(), 2: new Cam02(), 3: new Cam03(), 4: new Cam04() };
}
