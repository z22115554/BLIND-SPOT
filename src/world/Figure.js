// =============================================================================
// Figure — CAM-03 監視畫面中的人影（程式化人形，只存在於監視器的獨立場景裡）
// -----------------------------------------------------------------------------
// 座標：CAM-03 場景的局部座標（原點 = 防爆門門面，廊道往 -Z 延伸）。模型面向 +Z 建立，腳底為原點。
// 兩種外觀：
//   LD：帶兜帽的反光雨衣（兜帽裡是一片黑），長外套、反光條在紅外線補光下發亮；沒有頭盔/面罩/斧頭。
//   HD：隧道特種消防救援隊員：反光條制服、頭盔、融化變形的面罩（滴垂的焦黑塑膠）、空氣呼吸器、破門斧。
// 靜態姿勢 setPose(index)：沒有任何待機動作（盲區規則：被看著的時候不得有任何變化）。
// HD 動作（setAction(true)）：在防爆門前筋疲力竭地劈門：緩慢舉斧（約 1.2 秒）→ 揮下 → 擊中（onAxeHit）
//   → 反彈 → 喘息停頓；週期約 2.2–3 秒。雙手握柄以兩段式 IK 求解。
// =============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { turnoutFabric, raincoatFabric, shadowBlob, helmetPaint } from './feeds/feedTextures.js';
import { rng, clamp, lerp, ease } from '../core/util.js';

// ---- LD 推進路徑（index 0 最遠、面壁；7 = 防爆門前）--------------------------------
//   face: 'away' 背對鏡頭（面向廊道盡頭牆）| 'side' 側身 | 'camera' 面向鏡頭（防爆門）
export const FIGURE_WAYPOINTS = [
  { x: 0.16, z: -15.55, face: 'away', yawOff: 0.05, pose: 'wall' },
  { x: -0.14, z: -12.7, face: 'away', yawOff: -0.07, pose: 'wall2' },
  { x: 0.3, z: -10.0, face: 'side', yawOff: 0.0, pose: 'side' },
  { x: -0.24, z: -7.6, face: 'camera', yawOff: 0.14, pose: 'bowed' },
  { x: 0.18, z: -5.6, face: 'camera', yawOff: -0.1, pose: 'bowed2' },
  { x: -0.1, z: -3.9, face: 'camera', yawOff: 0.06, pose: 'reach' },
  { x: 0.1, z: -2.65, face: 'camera', yawOff: 0.0, pose: 'lift' },
  { x: 0.02, z: -1.32, face: 'camera', yawOff: 0.0, pose: 'door' },
];
/** HD：他其實一直就在門口 */
export const HD_SPOT = { x: 0.04, z: -1.55 };

const JOINTS = ['hips', 'spine', 'chest', 'neck', 'head',
  'lShoulder', 'lElbow', 'lWrist', 'rShoulder', 'rElbow', 'rWrist',
  'lHip', 'lKnee', 'lAnkle', 'rHip', 'rKnee', 'rAnkle'];

const BASE = {
  hips: [0, 0, 0], spine: [0.02, 0, 0], chest: [0, 0, 0], neck: [0.06, 0, 0], head: [0.04, 0, 0],
  lShoulder: [0.03, 0, 0.13], lElbow: [-0.12, 0, 0], lWrist: [0, 0, 0.05],
  rShoulder: [0.03, 0, -0.13], rElbow: [-0.12, 0, 0], rWrist: [0, 0, -0.05],
  lHip: [0, 0, 0.03], lKnee: [0.02, 0, 0], lAnkle: [-0.02, 0, -0.03],
  rHip: [0, 0, -0.03], rKnee: [0.02, 0, 0], rAnkle: [-0.02, 0, 0.03],
};
const P = (o = {}, body = {}) => ({ joints: { ...BASE, ...o }, body: { y: 0, ...body } });

// LD 靜態姿勢
const LD_POSES = {
  wall: P({ spine: [0.03, 0, 0], neck: [0.14, 0, 0], head: [0.12, 0, 0.07] }),
  wall2: P({ spine: [0.04, 0, 0.02], neck: [0.2, 0, 0], head: [0.2, 0.0, -0.14],
    lShoulder: [-0.04, 0, 0.12], rShoulder: [0.04, 0, -0.1] }),
  side: P({ spine: [0.06, 0, 0], neck: [0.26, 0.12, 0], head: [0.22, 0.22, 0.05],
    lShoulder: [0.06, 0, 0.12], rShoulder: [-0.06, 0, -0.12], lHip: [0.04, 0, 0.03], rHip: [-0.04, 0, -0.03] }),
  bowed: P({ spine: [0.05, 0, 0], chest: [0.1, 0, 0], neck: [0.36, 0, 0], head: [0.36, 0, 0.06],
    lShoulder: [-0.04, 0, 0.11], rShoulder: [-0.04, 0, -0.11], lElbow: [-0.04, 0, 0], rElbow: [-0.04, 0, 0] }),
  bowed2: P({ spine: [0.06, 0, -0.03], chest: [0.12, 0, 0], neck: [0.4, 0, 0], head: [0.34, 0, -0.2],
    lShoulder: [0.0, 0, 0.15], rShoulder: [-0.06, 0, -0.08], lElbow: [-0.03, 0, 0], rElbow: [-0.05, 0, 0] }),
  reach: P({ spine: [0.05, 0, 0], chest: [0.1, 0, 0], neck: [0.34, 0, 0], head: [0.3, 0, 0.08],
    lShoulder: [-0.03, 0, 0.12], rShoulder: [-0.55, 0, -0.14], rElbow: [-0.32, 0, 0], rWrist: [-0.15, 0, 0] }),
  lift: P({ spine: [0.02, 0, 0], chest: [0.04, 0, 0], neck: [0.06, 0, 0], head: [-0.16, 0, 0.07],
    lShoulder: [-0.02, 0, 0.12], rShoulder: [-0.38, 0, -0.12], rElbow: [-0.24, 0, 0], rWrist: [-0.1, 0, 0] }),
  door: P({ spine: [0.14, 0, 0], chest: [0.1, 0, 0], neck: [0.34, 0, 0], head: [0.3, 0, 0.1],
    lShoulder: [-0.02, 0, 0.12], rShoulder: [-1.52, 0, -0.1], rElbow: [-0.06, 0, 0], rWrist: [-1.25, 0, 0],
    lHip: [-0.06, 0, 0.03], lKnee: [0.1, 0, 0] }),
};

// HD 劈門動作的關鍵影格（root 局部座標：面向 +Z = 防爆門）
//   axe.g = 握柄末端，axe.dir = 握柄 → 斧頭方向；grip 為雙手在握柄上的位置（沿 dir 的距離）
const K = (joints, body, axe, poleR, poleL) => ({ joints: { ...BASE, ...joints }, body: { y: 0, ...body }, axe, poleR, poleL });
const HD_KEYS = {
  rest: K({ spine: [0.22, 0, 0], chest: [0.12, 0, 0], neck: [0.1, 0, 0], head: [-0.02, 0, 0.06],
    lHip: [-0.12, 0, 0.04], lKnee: [0.2, 0, 0], lAnkle: [-0.08, 0, -0.03], rHip: [-0.06, 0, -0.04], rKnee: [0.14, 0, 0], rAnkle: [-0.08, 0, 0.03] },
  { y: -0.03 }, { g: [-0.03, 1.0, 0.34], dir: [0.07, -0.96, 0.27], grips: [0.0, 0.12] }, [-0.7, 0.8, -0.1], [0.7, 0.8, -0.1]),
  raised: K({ spine: [-0.1, 0.1, 0], chest: [-0.12, 0.16, 0], neck: [0.08, -0.05, 0], head: [-0.02, 0, 0],
    lHip: [0.02, 0, 0.04], lKnee: [0.06, 0, 0], rHip: [0.06, 0, -0.06], rKnee: [0.04, 0, 0] },
  { y: 0.0 }, { g: [-0.1, 1.78, -0.02], dir: [0.16, 0.5, -0.85], grips: [0.04, 0.2] }, [-0.8, 1.4, 0.3], [0.8, 1.3, 0.3]),
  impact: K({ spine: [0.34, -0.05, 0], chest: [0.2, -0.08, 0], neck: [0.12, 0, 0], head: [0.08, 0, 0],
    lHip: [-0.3, 0, 0.04], lKnee: [0.36, 0, 0], lAnkle: [-0.1, 0, 0], rHip: [-0.08, 0, -0.04], rKnee: [0.22, 0, 0], rAnkle: [-0.1, 0, 0] },
  { y: -0.07 }, { g: [0.0, 1.08, 0.62], dir: [0.0, 0.04, 1.0], grips: [0.03, 0.15] }, [-0.6, 0.6, 0.2], [0.6, 0.6, 0.2]),
  recoil: K({ spine: [0.26, -0.03, 0], chest: [0.12, -0.04, 0], neck: [0.16, 0, 0], head: [0.1, 0, 0],
    lHip: [-0.24, 0, 0.04], lKnee: [0.3, 0, 0], lAnkle: [-0.08, 0, 0], rHip: [-0.06, 0, -0.04], rKnee: [0.18, 0, 0], rAnkle: [-0.08, 0, 0] },
  { y: -0.05 }, { g: [-0.02, 1.14, 0.5], dir: [0.02, 0.42, 0.9], grips: [0.03, 0.16] }, [-0.65, 0.7, 0.1], [0.65, 0.7, 0.1]),
  // 停頓時偶爾抬頭望向鏡頭上方（防爆門上的監視器）——緩慢、短暫
  look: K({ spine: [0.14, 0, 0], chest: [0.02, 0, 0], neck: [-0.12, 0, 0], head: [-0.42, 0, 0.05],
    lHip: [-0.1, 0, 0.04], lKnee: [0.16, 0, 0], lAnkle: [-0.06, 0, -0.03], rHip: [-0.05, 0, -0.04], rKnee: [0.12, 0, 0], rAnkle: [-0.06, 0, 0.03] },
  { y: -0.02 }, { g: [-0.03, 1.02, 0.33], dir: [0.07, -0.96, 0.27], grips: [0.0, 0.12] }, [-0.7, 0.8, -0.1], [0.7, 0.8, -0.1]),
};

const DOWN = new THREE.Vector3(0, -1, 0);
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();

// ---- 幾何小工具 -----------------------------------------------------------------
function lathe(profile, segs = 20, scaleZ = 1) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  g.scale(1, 1, scaleZ);
  return g;
}
function radiusAt(profile, y) {
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i], [r1, y1] = profile[i + 1];
    if ((y <= y0 && y >= y1) || (y >= y0 && y <= y1)) return lerp(r0, r1, (y - y0) / (y1 - y0 || 1));
  }
  return profile[0][0];
}
/** 布料皺褶：依角度做徑向起伏，越往 hemY 越明顯 */
function addFolds(geo, { amp = 0.012, freq = 7, y0 = 0, y1 = -0.5, seed = 1 } = {}) {
  const pos = geo.attributes.position;
  const r = rng(seed);
  const ph = [r() * 6, r() * 6, r() * 6];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = clamp((y0 - y) / (y0 - y1));
    const a = Math.atan2(z, x);
    const f = Math.sin(a * freq + ph[0]) * 0.6 + Math.sin(a * (freq * 1.7) + ph[1]) * 0.3 + Math.sin(a * 3 + ph[2]) * 0.3;
    const s = 1 + f * amp * k * 8;
    pos.setX(i, x * s); pos.setZ(i, z * s);
  }
  geo.computeVertexNormals();
  return geo;
}
function ring(rTop, rBot, h, y, scaleZ = 1, segs = 20) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, segs, 1, true);
  g.translate(0, y, 0);
  g.scale(1, 1, scaleZ);
  return g;
}
function cyl(rTop, rBot, h, y, segs = 12) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, segs);
  g.translate(0, y, 0);
  return g;
}
function box(w, h, d, x = 0, y = 0, z = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}
function sphere(r, sx = 1, sy = 1, sz = 1, x = 0, y = 0, z = 0, ws = 14, hs = 10) {
  const g = new THREE.SphereGeometry(r, ws, hs);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return g;
}
const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false);

/** 融化的面罩：前半球殼往下垂、單側塌陷、表面起泡焦黑，加上垂落的熔滴與半熔進面罩的呼吸調節器 */
function meltedMask() {
  const r = rng(77);
  const shell = new THREE.SphereGeometry(0.118, 44, 30, Math.PI * 0.5 - 1.12, 2.24, 0.58, 1.6);
  const pos = shell.attributes.position;
  const colors = [];
  const amber = new THREE.Color(0x9a5c22), brown = new THREE.Color(0x3a2414), char = new THREE.Color(0x0d0907), cloud = new THREE.Color(0xa89a84);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const t = clamp((0.1 - y) / 0.17);                     // 0 上緣 → 1 下緣
    const n = Math.sin(x * 61 + 1.3) * Math.sin(y * 47 + 0.4) * 0.5 + Math.sin(x * 23 - y * 31) * 0.5;
    const n2 = Math.sin(x * 37 - 2.1) * Math.sin(y * 29 + z * 40) * 0.6 + Math.sin(x * 97 + y * 83) * 0.4;
    const bubble = Math.pow(Math.max(0, Math.sin(x * 140 + 0.7) * Math.sin(y * 120 - 0.3)), 3);   // 受熱起泡
    // 燒穿的破洞（左下）：往內凹陷
    const hx = x + 0.035, hy = y + 0.035;
    const hole = clamp(1 - Math.sqrt(hx * hx * 1.6 + hy * hy) / 0.032);
    const phi = Math.atan2(x, z);
    const lobe = Math.pow(Math.max(0, Math.sin(phi * 4.2 + 0.8)), 2) * 0.045 + Math.pow(Math.max(0, Math.sin(phi * 7.3 - 0.4)), 4) * 0.02;
    y -= t * t * (0.028 + 0.016 * n) + Math.max(0, x) * 0.3 * t + t * t * t * lobe;   // 下垂、右側整片塌陷、下緣不規則的垂流
    x *= 1 - t * 0.12;
    z *= 1 + n * 0.035 * (0.3 + t) + n2 * 0.012 + bubble * 0.05 - t * 0.06 - hole * 0.35;
    pos.setXYZ(i, x, y, z);
    c.copy(brown).lerp(amber, clamp(0.4 + n * 0.6));
    c.lerp(cloud, clamp((n2 - 0.35) * 2.5) * (1 - t) * 0.6);          // 受熱白化的霧斑
    c.lerp(char, clamp(clamp((-n2 - 0.1) * 2.2) * 0.9 + t * t * 0.45 + bubble * 0.5 + hole * 1.2));  // 焦黑、起泡處發黑
    colors.push(c.r, c.g, c.b);
  }
  shell.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  shell.computeVertexNormals();
  const parts = [shell];
  // 熔滴：上粗下細的淚滴形，長短不一，大多從塌陷的右下緣垂落
  for (let i = 0; i < 11; i++) {
    const len = 0.016 + Math.pow(r(), 1.5) * 0.07;
    const w = 0.0075 + r() * 0.0065;
    const prof = [[0.0001, 0], [w * 0.55, -len * 0.15], [w * 0.35, -len * 0.7], [w * 0.6, -len * 0.92], [0.0001, -len]];
    const d = new THREE.LatheGeometry(prof.map(([a, b]) => new THREE.Vector2(a, b)), 6);
    d.scale(1, 1, 0.75);
    const a = (r() - 0.3) * 1.7;
    const x = Math.sin(a) * 0.092, zz = Math.cos(a) * 0.08;
    const yb = -0.058 - Math.max(0, x) * 0.3 - r() * 0.012;
    d.translate(x, yb, zz);
    const k = r();
    const col = []; for (let q = 0; q < d.attributes.position.count; q++) col.push(0.1 + k * 0.22, 0.05 + k * 0.08, 0.02);
    d.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    parts.push(d);
  }
  // 呼吸調節器：半熔進面罩、歪向一側、扁平
  const reg = new THREE.CylinderGeometry(0.022, 0.03, 0.026, 9);
  reg.rotateX(Math.PI / 2 + 0.9);
  reg.rotateZ(0.6);
  reg.scale(1.3, 0.6, 0.8);
  reg.translate(0.03, -0.085, 0.085);
  const rc = []; for (let k = 0; k < reg.attributes.position.count; k++) rc.push(0.03, 0.026, 0.022);
  reg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  parts.push(reg);
  return merge(parts);
}

/** 破門斧：握柄沿 +Y（0 = 握柄末端 → 0.9 = 斧頭），刃口朝 +Z */
function axeGeometry() {
  const handle = cyl(0.016, 0.019, 0.86, 0.43, 8);
  const grip = cyl(0.021, 0.021, 0.24, 0.12, 8);
  const shape = new THREE.Shape();
  shape.moveTo(0.015, 0.05); shape.lineTo(0.1, 0.072);
  shape.quadraticCurveTo(0.16, 0.0, 0.1, -0.072);
  shape.lineTo(0.015, -0.05); shape.lineTo(0.015, 0.05);
  const blade = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
  blade.translate(0, 0, -0.007);
  blade.rotateY(-Math.PI / 2);
  blade.translate(0, 0.86, 0);
  const pick = new THREE.ConeGeometry(0.016, 0.13, 8);
  pick.rotateX(-Math.PI / 2);
  pick.translate(0, 0.86, -0.08);
  const collar = box(0.034, 0.09, 0.05, 0, 0.86, 0);
  return { handle: merge([handle]), grip: merge([grip]), head: merge([blade, pick, collar]) };
}

// =============================================================================
export class Figure {
  /**
   * @param {object} opts
   *   faceTarget: THREE.Vector3（CAM-03 鏡頭位置；面向鏡頭的姿勢會轉向它，紅外線反光強度依距離計算）
   */
  constructor({ faceTarget = new THREE.Vector3(0.25, 2.55, -0.18) } = {}) {
    this.faceTarget = faceTarget.clone();
    this.group = new THREE.Group();
    this.group.name = 'figure';
    this.root = new THREE.Group();
    this.group.add(this.root);
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.j = {};
    this.look = 'LD';
    this.index = 0;
    this.action = false;
    this.onAxeHit = null;
    this._actT = 0;
    this._phase = -1;
    this._cycle = 0;
    this._actBlend = 0;      // 0 = 靜止休息姿勢、1 = 完全進入劈砍循環
    this._pose = null;
    this._rand = rng(2024);
    this._buildMaterials();
    this._buildRig();
    this._buildBody();
    this.setLook('LD');
    this.setPose(0);
  }

  // ---------------------------------------------------------------------------
  _buildMaterials() {
    const fab = turnoutFabric(), rain = raincoatFabric();
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.mats = {
      LD: {
        coat: std({ map: rain, color: 0x98937f, roughness: 0.36, metalness: 0.0, side: THREE.DoubleSide }),
        trousers: std({ color: 0x47443d, roughness: 0.75 }),
        strip: std({ color: 0xe8e6da, emissive: 0xffffff, emissiveIntensity: 0.3, roughness: 0.35 }),
        glove: std({ color: 0x23201c, roughness: 0.7 }),
        boot: std({ color: 0x141414, roughness: 0.45 }),
      },
      HD: {
        coat: std({ map: fab, color: 0xffffff, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide }),
        trousers: std({ map: fab, color: 0xd8d0c0, roughness: 0.92 }),
        strip: std({ color: 0xcfcab0, emissive: 0xfff0c8, emissiveIntensity: 0.16, roughness: 0.4, metalness: 0.2 }),
        glove: std({ color: 0x2b1f16, roughness: 0.8 }),
        boot: std({ color: 0x101010, roughness: 0.5 }),
      },
      hood: null,
      void: new THREE.MeshBasicMaterial({ color: 0x000000, fog: true }),
      helmet: std({ map: helmetPaint(), color: 0xffffff, roughness: 0.5, metalness: 0.05 }),
      helmetSoot: std({ color: 0x1d1a16, roughness: 0.8 }),
      mask: std({ vertexColors: true, roughness: 0.1, metalness: 0.0 }),
      nomex: std({ color: 0x24221f, roughness: 0.95 }),
      scba: std({ color: 0x22211f, roughness: 0.55, metalness: 0.3 }),
      axeHandle: std({ color: 0x9e8526, roughness: 0.55 }),
      axeGrip: std({ color: 0x111111, roughness: 0.8 }),
      axeHead: std({ color: 0x5a1b14, roughness: 0.4, metalness: 0.6 }),
      shadow: new THREE.MeshBasicMaterial({ map: shadowBlob(), transparent: true, depthWrite: false, opacity: 0.85, toneMapped: false }),
    };
  }

  _buildRig() {
    const j = this.j;
    const G = (name, parent, x, y, z) => { const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g); j[name] = g; return g; };
    G('hips', this.body, 0, 0.95, 0);
    G('spine', j.hips, 0, 0.1, 0);
    G('chest', j.spine, 0, 0.26, 0);
    G('neck', j.chest, 0, 0.17, 0.005);
    G('head', j.neck, 0, 0.1, 0.01);
    for (const [s, k] of [['l', 1], ['r', -1]]) {
      G(`${s}Shoulder`, j.chest, 0.2 * k, 0.115, -0.005);
      G(`${s}Elbow`, j[`${s}Shoulder`], 0, -0.29, 0);
      G(`${s}Wrist`, j[`${s}Elbow`], 0, -0.26, 0);
      G(`${s}Hip`, j.hips, 0.1 * k, -0.04, 0);
      G(`${s}Knee`, j[`${s}Hip`], 0, -0.43, 0);
      G(`${s}Ankle`, j[`${s}Knee`], 0, -0.4, 0);
    }
  }

  _part(slot, geo, parent, { only = null, shadow = false } = {}) {
    const m = new THREE.Mesh(geo, this._slotMaterial(slot));
    m.userData.slot = slot;
    if (only) m.userData.only = only;
    parent.add(m);
    (this._meshes ||= []).push(m);
    return m;
  }
  _slotMaterial(slot) {
    const lk = this.mats[this.look] || this.mats.LD;
    return lk[slot] || this.mats[slot];
  }

  _buildBody() {
    const j = this.j;
    // ---- 外套：下襬（hips）、軀幹下半（spine）、胸肩（chest） ----
    const skirtP = [[0.19, 0.13], [0.2, 0.02], [0.215, -0.12], [0.24, -0.28], [0.268, -0.42], [0.285, -0.5]];
    const skirt = addFolds(lathe(skirtP, 28, 0.8), { amp: 0.0035, freq: 6, y0: 0.0, y1: -0.5, seed: 3 });
    this._part('coat', skirt, j.hips);
    const lowP = [[0.196, -0.12], [0.205, 0.0], [0.218, 0.14], [0.226, 0.3]];
    this._part('coat', lathe(lowP, 24, 0.72), j.spine);
    const upP = [[0.224, -0.1], [0.23, 0.02], [0.222, 0.1], [0.19, 0.145], [0.12, 0.17], [0.078, 0.2], [0.075, 0.25]];
    this._part('coat', lathe(upP, 24, 0.72), j.chest);
    // 反光條：下襬兩道、腰一道、胸一道
    const sk = (y) => radiusAt(skirtP, y) * 1.03;
    this._part('strip', merge([
      ring(sk(-0.36), sk(-0.41), 0.05, -0.385, 0.8, 28),
      ring(sk(-0.44), sk(-0.48), 0.035, -0.46, 0.8, 28),
    ]), j.hips);
    this._part('strip', ring(radiusAt(lowP, 0.1) * 1.03, radiusAt(lowP, 0.05) * 1.03, 0.045, 0.075, 0.72, 24), j.spine);
    this._part('strip', ring(radiusAt(upP, 0.0) * 1.03, radiusAt(upP, -0.05) * 1.03, 0.045, -0.025, 0.72, 24), j.chest);
    // 骨盆（褲子）
    this._part('trousers', sphere(0.17, 1, 0.7, 0.78, 0, -0.02, 0), j.hips);

    // ---- 手臂 ----
    for (const s of ['l', 'r']) {
      const sh = j[`${s}Shoulder`], el = j[`${s}Elbow`], wr = j[`${s}Wrist`];
      this._part('coat', merge([sphere(0.074, 1, 0.9, 0.95, 0, -0.01, 0), cyl(0.068, 0.059, 0.29, -0.145)]), sh);
      this._part('strip', ring(0.066, 0.064, 0.04, -0.205, 1, 14), sh);
      this._part('coat', merge([sphere(0.06, 1, 1, 1, 0, 0, 0, 10, 8), cyl(0.059, 0.053, 0.25, -0.125), ring(0.064, 0.064, 0.04, -0.235, 1, 12)]), el);
      this._part('strip', ring(0.0585, 0.0565, 0.035, -0.12, 1, 14), el);
      const k = s === 'l' ? 1 : -1;
      this._part('glove', merge([box(0.082, 0.1, 0.045, 0, -0.06, 0.006), box(0.028, 0.06, 0.03, 0.04 * k, -0.035, 0.022), cyl(0.052, 0.05, 0.05, -0.0, 10)]), wr);
    }

    // ---- 腿 ----
    for (const s of ['l', 'r']) {
      const hp = j[`${s}Hip`], kn = j[`${s}Knee`], an = j[`${s}Ankle`];
      this._part('trousers', merge([cyl(0.088, 0.074, 0.44, -0.215), sphere(0.074, 1, 1, 1, 0, -0.43, 0, 10, 8)]), hp);
      this._part('trousers', cyl(0.073, 0.066, 0.3, -0.15), kn);
      this._part('strip', merge([ring(0.0755, 0.074, 0.045, -0.13, 1, 14), ring(0.0725, 0.071, 0.035, -0.21, 1, 14)]), kn);
      this._part('boot', merge([
        cyl(0.07, 0.066, 0.2, 0.06, 12),
        box(0.118, 0.11, 0.25, 0, -0.035, 0.05),
        sphere(0.06, 1, 0.8, 1.1, 0, -0.04, 0.155, 10, 8),
        box(0.126, 0.026, 0.29, 0, -0.08, 0.055),
      ]), an);
    }

    // ---- 頭頸 ----
    const head = j.head;
    // LD：兜帽（前方開口裡是一片黑）
    const hoodShell = new THREE.SphereGeometry(0.142, 22, 16, 0, Math.PI * 2, 0.0, Math.PI * 0.74);
    hoodShell.scale(1, 1.06, 1.1);
    hoodShell.translate(0, 0.012, -0.008);
    // 兜帽前緣微微突出（帽簷），開口在臉部
    const brimH = new THREE.TorusGeometry(0.1, 0.017, 6, 20, Math.PI * 1.25);
    brimH.rotateZ(-Math.PI * 0.125);
    brimH.scale(0.95, 1.05, 1);
    brimH.translate(0, 0.004, 0.116);
    const hoodCape = lathe([[0.075, 0.0], [0.1, -0.05], [0.15, -0.1], [0.2, -0.13]], 20, 0.8);
    hoodCape.translate(0, 0.2, 0);
    // 兜帽後方垂下的尖角
    const peak = new THREE.ConeGeometry(0.1, 0.2, 14);
    peak.rotateX(-Math.PI / 2 - 0.9);
    peak.scale(1, 1, 0.85);
    peak.translate(0, 0.02, -0.15);
    this._part('coat', merge([hoodShell, brimH, peak]), head, { only: 'LD' });
    this._part('coat', hoodCape, j.chest, { only: 'LD' });
    // 臉的位置：一片黑（貼在兜帽前面的球面片）
    const voidG = new THREE.SphereGeometry(0.1435, 16, 12, Math.PI * 0.5 - 0.7, 1.4, 0.95, 1.25);
    voidG.scale(1, 1.06, 1.1);
    voidG.translate(0, 0.012, -0.008);
    this._part('void', voidG, head, { only: 'LD' });

    // HD：防火頭套、頭盔、融化面罩
    this._part('nomex', merge([sphere(0.106, 0.94, 1.05, 1.02, 0, 0, 0), cyl(0.062, 0.07, 0.12, -0.08)]), head, { only: 'HD' });
    const dome = new THREE.SphereGeometry(0.14, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.52);
    dome.scale(1, 0.9, 1.13);
    dome.translate(0, 0.045, -0.012);
    const brim = lathe([[0.136, 0.0], [0.146, -0.008], [0.152, -0.016]], 24, 1.12);
    brim.translate(0, 0.045, -0.014);
    this._part('helmet', merge([dome, brim]), head, { only: 'HD' });
    this._part('strip', ring(0.142, 0.143, 0.02, 0.088, 1.13, 24), head, { only: 'HD' });
    const curtain = new THREE.CylinderGeometry(0.138, 0.165, 0.14, 16, 1, true, Math.PI - 1.5, 3.0);
    curtain.translate(0, -0.045, -0.012);
    this._part('helmetSoot', curtain, head, { only: 'HD' }).material.side = THREE.DoubleSide;
    const mask = meltedMask();
    mask.translate(0, -0.016, 0.03);
    this._part('mask', mask, head, { only: 'HD' });

    // HD：空氣呼吸器（背架＋氣瓶）
    this._part('scba', merge([
      box(0.25, 0.46, 0.035, 0, -0.08, -0.18),
      cyl(0.083, 0.083, 0.5, 0, 16).rotateX(0).translate(0, -0.06, -0.265),
      sphere(0.083, 1, 0.6, 1, 0, 0.19, -0.265, 12, 8),
      cyl(0.02, 0.02, 0.06, -0.33).translate(0, 0, -0.265),
      box(0.05, 0.36, 0.02, 0.1, -0.02, 0.165), box(0.05, 0.36, 0.02, -0.1, -0.02, 0.165),
    ]), j.chest, { only: 'HD' });
    this._part('strip', ring(0.087, 0.087, 0.035, -0.18, 1, 16).translate(0, 0, -0.265), j.chest, { only: 'HD' });

    // HD：破門斧（掛在 root 上，以握柄末端與方向擺放）
    const ax = axeGeometry();
    this.axe = new THREE.Group();
    this.axe.name = 'axe';
    this.root.add(this.axe);
    this._part('axeHandle', ax.handle, this.axe, { only: 'HD' });
    this._part('axeGrip', ax.grip, this.axe, { only: 'HD' });
    this._part('axeHead', ax.head, this.axe, { only: 'HD' });

    // 腳下的接觸陰影
    const sh = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.85), this.mats.shadow);
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.006;
    sh.renderOrder = 1;
    this.root.add(sh);
    this.contactShadow = sh;
  }

  // ---------------------------------------------------------------------------
  /** 'LD' | 'HD' */
  setLook(look) {
    this.look = look === 'HD' ? 'HD' : 'LD';
    for (const m of this._meshes) {
      m.material = this._slotMaterial(m.userData.slot);
      if (m.userData.only) m.visible = m.userData.only === this.look;
    }
    this.axe.visible = this.look === 'HD';
    if (this.look === 'HD') {
      this.root.position.set(HD_SPOT.x, 0, HD_SPOT.z);
      this.root.rotation.set(0, 0, 0);
      this._applyHD(0, true);
    } else {
      this.setPose(this.index);
    }
  }

  /** LD 靜態姿勢（0..7）。沒有任何待機動作。 */
  setPose(index) {
    this.index = clamp(Math.round(index), 0, FIGURE_WAYPOINTS.length - 1);
    if (this.look !== 'LD') return;
    const w = FIGURE_WAYPOINTS[this.index];
    let yaw;
    if (w.face === 'away') yaw = Math.PI;
    else if (w.face === 'side') yaw = -Math.PI / 2;
    else yaw = Math.atan2(this.faceTarget.x - w.x, this.faceTarget.z - w.z);
    yaw += w.yawOff || 0;
    this.root.position.set(w.x, 0, w.z);
    this.root.rotation.set(0, yaw, 0);
    this._applyPose(LD_POSES[w.pose] || LD_POSES.wall);
    this.root.updateMatrixWorld(true);
    // 紅外線補光下的反光條亮度（逆向反射：光源就在鏡頭旁，越近越亮）
    const d = Math.hypot(w.x - this.faceTarget.x, 1.2 - this.faceTarget.y, w.z - this.faceTarget.z);
    this.mats.LD.strip.emissiveIntensity = clamp(4.0 / d, 0.26, 0.8);
  }

  /** 除錯：直接擺出 HD 關鍵影格（'rest' | 'raised' | 'impact' | 'recoil' | 'look'） */
  showKey(name) {
    const k = HD_KEYS[name];
    if (!k || this.look !== 'HD') return;
    this.action = false; this._actBlend = 0;
    this._applyPose(k);
    this._placeAxeAndArms(k);
  }

  setAction(on) {
    on = !!on;
    if (on && !this.action) { this._phase = -1; this._actT = 0; }
    this.action = on;
  }

  _applyPose(p) {
    const J = p.joints;
    for (const name of JOINTS) {
      const r = J[name] || BASE[name];
      this.j[name].rotation.set(r[0], r[1], r[2]);
    }
    this.body.position.y = p.body?.y || 0;
  }

  // ---- HD 動作 ------------------------------------------------------------------
  _lerpKey(a, b, k) {
    const joints = {};
    for (const n of JOINTS) {
      const x = a.joints[n], y = b.joints[n];
      joints[n] = [lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)];
    }
    const L3 = (p, q) => [lerp(p[0], q[0], k), lerp(p[1], q[1], k), lerp(p[2], q[2], k)];
    return {
      joints,
      body: { y: lerp(a.body.y, b.body.y, k) },
      axe: { g: L3(a.axe.g, b.axe.g), dir: L3(a.axe.dir, b.axe.dir), grips: [lerp(a.axe.grips[0], b.axe.grips[0], k), lerp(a.axe.grips[1], b.axe.grips[1], k)] },
      poleR: L3(a.poleR, b.poleR), poleL: L3(a.poleL, b.poleL),
    };
  }

  /** 每幀（只有 HD 外觀才會動；LD 外觀永遠靜止）。 */
  update(dt, t) {
    if (this.look !== 'HD') return;
    this._applyHD(dt, false, t);
  }

  _applyHD(dt, instant = false, t = 0) {
    const R = this._rand;
    let key;
    if (!this.action) {
      // 靜止：倚著斧頭喘息
      this._actBlend = instant ? 0 : Math.max(0, this._actBlend - dt / 0.9);
      key = HD_KEYS.rest;
      if (this._actBlend > 0 && this._last) key = this._lerpKey(HD_KEYS.rest, this._last, ease.inOut(this._actBlend));
    } else {
      this._actBlend = Math.min(1, this._actBlend + dt / 0.9);
      this._actT += dt;
      // 階段：0 舉起（約 1.2 秒）→ 1 停頓 → 2 揮下 → 3 擊中後反彈 → 4 喘息停頓；一輪約 2.2–3 秒
      if (this._phase < 0) { this._phase = 0; this._actT = 0; this._pauseDur = 0.45 + R() * 0.6; this._look = false; this._fromKey = HD_KEYS.rest; }
      const durs = [1.2, 0.12, 0.2, 0.32, this._pauseDur];
      while (this._actT >= durs[this._phase]) {
        this._actT -= durs[this._phase];
        this._phase++;
        if (this._phase === 3) { try { this.onAxeHit?.(); } catch (e) { console.error('[figure] onAxeHit', e); } }
        if (this._phase > 4) {
          this._phase = 0; this._cycle++;
          this._fromKey = this._look ? HD_KEYS.look : HD_KEYS.rest;   // 下一輪從上一輪結束的姿勢開始（無跳格）
          // 停頓時抬頭望向鏡頭：剛開始（玩家第一次看到 HD 畫面的那十幾秒）隔一輪就抬一次頭，之後每三輪一次
          this._look = this._cycle < 7 ? this._cycle % 2 === 1 : this._cycle % 3 === 2;
          this._pauseDur = this._look ? 0.95 + R() * 0.15 : 0.4 + R() * 0.65;
          durs[4] = this._pauseDur;
        }
      }
      const k = clamp(this._actT / durs[this._phase]);
      const restKey = this._look ? HD_KEYS.look : HD_KEYS.rest;
      switch (this._phase) {
        case 0: key = this._lerpKey(this._fromKey || HD_KEYS.rest, HD_KEYS.raised, ease.inOut(k)); break;
        case 1: key = HD_KEYS.raised; break;
        case 2: key = this._lerpKey(HD_KEYS.raised, HD_KEYS.impact, k * k * k); break;
        case 3: key = this._lerpKey(HD_KEYS.impact, HD_KEYS.recoil, ease.out(k)); break;
        default: key = this._lerpKey(HD_KEYS.recoil, restKey, ease.inOut(Math.min(1, k * 1.6))); break;
      }
      this._last = key;
      if (this._actBlend < 1) key = this._lerpKey(HD_KEYS.rest, key, ease.inOut(this._actBlend));
    }
    // 喘息：胸口與肩膀緩慢起伏（約 1.5 秒一次；只在 HD 外觀）
    const br = Math.sin(t * (Math.PI * 2 / 1.5));
    const joints = { ...key.joints };
    joints.chest = [joints.chest[0] - br * 0.025, joints.chest[1], joints.chest[2]];
    joints.neck = [joints.neck[0] + br * 0.02, joints.neck[1], joints.neck[2]];
    this._applyPose({ joints, body: key.body });
    this._placeAxeAndArms(key);
  }

  _placeAxeAndArms(key) {
    const g = _v1.fromArray(key.axe.g);
    const dir = _v2.fromArray(key.axe.dir).normalize();
    const edge = _v3.set(1, 0, 0).cross(dir).normalize();      // 刃口朝揮動方向
    const side = _v4.crossVectors(dir, edge).normalize();
    _m.makeBasis(side, dir, edge);
    this.axe.position.copy(g);
    this.axe.quaternion.setFromRotationMatrix(_m);
    this.root.updateMatrixWorld(true);
    const gR = _v5.copy(g).addScaledVector(dir, key.axe.grips[0] + 0.05);
    const gL = _v6.copy(g).addScaledVector(dir, key.axe.grips[1] + 0.05);
    this._solveArm('r', gR, key.poleR);
    this._solveArm('l', gL, key.poleL);
  }

  /** 兩段式 IK：targetLocal / pole 皆為 root 局部座標 */
  _solveArm(s, targetLocal, pole) {
    const sh = this.j[`${s}Shoulder`], el = this.j[`${s}Elbow`], wr = this.j[`${s}Wrist`];
    sh.parent.updateMatrixWorld(true);
    const S = sh.getWorldPosition(new THREE.Vector3());
    const T = this.root.localToWorld(targetLocal.clone());
    const Pp = this.root.localToWorld(new THREE.Vector3().fromArray(pole));
    const a = 0.29, b = 0.26 + 0.055;
    const toT = T.clone().sub(S);
    const d = clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
    const dir = toT.normalize();
    const pv = Pp.sub(S);
    pv.addScaledVector(dir, -pv.dot(dir));
    if (pv.lengthSq() < 1e-8) pv.set(0, -1, 0);
    pv.normalize();
    const x = (a * a - b * b + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, a * a - x * x));
    const E = S.clone().addScaledVector(dir, x).addScaledVector(pv, h);
    const Tc = S.clone().addScaledVector(dir, d);
    sh.parent.getWorldQuaternion(_q1).invert();
    const u = E.clone().sub(S).normalize().applyQuaternion(_q1);
    sh.quaternion.setFromUnitVectors(DOWN, u);
    sh.updateMatrixWorld(true);
    sh.getWorldQuaternion(_q2).invert();
    const w = Tc.sub(E).normalize().applyQuaternion(_q2);
    el.quaternion.setFromUnitVectors(DOWN, w);
    wr.rotation.set(0, 0, 0);
  }
}
