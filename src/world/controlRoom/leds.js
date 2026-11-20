// =============================================================================
// 指示燈庫：一個 InstancedMesh 畫出所有「一般」小 LED（控制台、機櫃、設備），
// 每顆 LED 屬於一個供電群組（mains 市電 / ups 不斷電），可選擇緩慢閃爍（週期 ≥ 1 秒）。
// =============================================================================
import * as THREE from 'three';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();
const OFF = new THREE.Color(0.045, 0.038, 0.035);

export const LED_COLORS = {
  green: new THREE.Color(0.12, 1.6, 0.3),
  red: new THREE.Color(1.9, 0.1, 0.06),
  amber: new THREE.Color(1.8, 0.75, 0.08),
  white: new THREE.Color(1.3, 1.4, 1.5),
  blue: new THREE.Color(0.2, 0.45, 1.8),
};

export class LedBank {
  constructor(max = 256, radius = 0.0042) {
    this.max = max;
    const g = new THREE.CylinderGeometry(radius, radius * 1.05, 0.004, 10, 1);
    g.translate(0, 0.002, 0);
    this.mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mat.name = 'cr:leds';
    this.mesh = new THREE.InstancedMesh(g, this.mat, max);
    this.mesh.name = 'leds';
    this.mesh.count = 0;
    this.mesh.raycast = () => {};
    this.items = [];
  }
  /** pos、normal 為群組座標；color = LED_COLORS 鍵或 THREE.Color；blink = { period, phase, duty }。 */
  add(pos, normal, color = 'green', { group = 'mains', blink = null, lit = true, scale = 1 } = {}) {
    if (this.items.length >= this.max) return -1;
    const i = this.items.length;
    _q.setFromUnitVectors(_up, normal.clone().normalize());
    _m.compose(pos, _q, new THREE.Vector3(scale, scale, scale));
    this.mesh.setMatrixAt(i, _m);
    const col = typeof color === 'string' ? LED_COLORS[color] : color;
    this.items.push({ col: col.clone(), group, blink, lit });
    this.mesh.setColorAt(i, OFF);
    this.mesh.count = this.items.length;
    return i;
  }
  /** power: { mains: 0..1, ups: 0..1 }；dim：整體亮度乘數（焦黑）。 */
  update(t, power, dim, reduceFlicker) {
    const n = this.items.length;
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      let k = it.lit ? (power[it.group] ?? 1) : 0;
      if (k > 0 && it.blink) {
        if (reduceFlicker) k *= 0.85;
        else {
          const { period, phase = 0, duty = 0.5 } = it.blink;
          const ph = (((t + phase) / period) % 1 + 1) % 1;
          // 柔和方波（邊緣 0.12 秒）
          const edge = 0.12 / period;
          let v;
          if (ph < duty) v = Math.min(1, ph / edge, (duty - ph) / edge);
          else v = 0;
          k *= Math.max(0, Math.min(1, v));
        }
      }
      k *= dim;
      _c.copy(OFF).lerp(it.col, k);
      this.mesh.setColorAt(i, _c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

/** 單顆可控 LED（獨立材質；含一個很淡的加法光暈精靈）。 */
export class SingleLed {
  constructor({ radius = 0.007, dome = true, glowTex = null, glowSize = 0.05 } = {}) {
    this.group = new THREE.Group();
    const g = dome ? new THREE.SphereGeometry(radius, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2) : new THREE.CylinderGeometry(radius, radius, 0.004, 12);
    if (dome) g.rotateX(Math.PI / 2); // 圓頂朝 +Z
    else g.rotateX(Math.PI / 2);
    this.mat = new THREE.MeshBasicMaterial({ color: OFF.clone() });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.group.add(this.mesh);
    this.glow = null;
    if (glowTex) {
      const sm = new THREE.SpriteMaterial({ map: glowTex, color: 0x000000, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
      this.glow = new THREE.Sprite(sm);
      this.glow.scale.setScalar(glowSize);
      this.glow.position.z = radius * 0.6;
      this.group.add(this.glow);
    }
    this.group.traverse((o) => { o.raycast = () => {}; });
    this.k = 0;
    this.col = new THREE.Color(0, 0, 0);
  }
  /** color = LED 全亮色（可 > 1 的 HDR 值），k = 0..1 亮度。 */
  set(color, k, glowK = 0.35) {
    _c.copy(color).multiplyScalar(Math.max(0, Math.min(1.2, k)));
    this.setColor(_c, glowK);
  }
  /** 直接指定發光色（已含亮度）。 */
  setColor(col, glowK = 0.35) {
    this.mat.color.copy(OFF).add(col);
    if (this.glow) {
      const m = Math.max(col.r, col.g, col.b);
      this.glow.material.color.copy(col).multiplyScalar(glowK * 0.35);
      this.glow.visible = m > 0.02;
    }
  }
}
