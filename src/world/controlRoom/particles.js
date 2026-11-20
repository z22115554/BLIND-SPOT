// =============================================================================
// 粒子：濃煙（從防爆門湧入 → 沿天花板翻滾 → 由上而下填滿房間）與咖啡蒸氣。
// 全部為 Sprite（NormalBlending、depthWrite false、不參與射線檢測）。
// =============================================================================
import * as THREE from 'three';
import { rng, clamp, damp, smoothstep, lerp } from '../../core/util.js';

const _v = new THREE.Vector3();

export class SmokeSystem {
  constructor(room, { count = 88 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'smoke';
    room.group.add(this.group);
    const tex = room.tex.get('smoke');
    const L = room.L, bd = L.blastDoor;
    const r = rng(4242);
    this.parts = [];
    for (let i = 0; i < count; i++) {
      const frac = i / count;
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0 });
      mat.name = 'cr:smoke';
      const sp = new THREE.Sprite(mat);
      sp.raycast = () => {};
      sp.visible = false;
      sp.renderOrder = 2;
      this.group.add(sp);
      const start = new THREE.Vector3(L.minX - 0.3 + r() * 0.25, 0.35 + r() * 1.85, bd.z - bd.width * 0.42 + r() * bd.width * 0.84);
      // 早期的煙先貼著天花板往房內翻滾，越後面的越低、越遠，最後填滿整個房間
      const reach = 1.6 + 6.0 * Math.pow(frac, 0.7);
      // 目標點離牆、地板留一點距離，減少精靈面片與幾何相交產生的硬邊
      const target = new THREE.Vector3(
        clamp(L.minX + 0.6 + r() * reach, L.minX + 0.6, L.maxX - 0.6),
        clamp(2.7 - Math.pow(frac, 0.85) * 2.1 + (r() - 0.5) * 0.3, 0.6, 2.75),
        lerp(L.minZ + 0.6, L.maxZ - 0.6, r()),
      );
      const mid = new THREE.Vector3(lerp(start.x, target.x, 0.32) + 0.4, 2.72 - r() * 0.15, lerp(start.z, target.z, 0.3));
      this.parts.push({
        sp, mat, th: frac * 0.9, born: -1, a: 0,
        start, mid, target,
        travel: Math.max(2.2, (start.distanceTo(mid) + mid.distanceTo(target)) / (0.85 + r() * 0.5)),
        size0: 0.35 + r() * 0.3, size1: 1.5 + r() * 1.3 + frac * 0.6,
        rot0: r() * Math.PI * 2, rotV: (r() - 0.5) * 0.16,
        op: 0.38 + r() * 0.3, shade: 0.7 + r() * 0.55, wob: r() * 100,
      });
    }
    this.tint = new THREE.Color();
  }
  /** level 0..1（平滑後）；tint = 依室內光線算出的煙色。 */
  update(dt, t, level, tint) {
    for (const p of this.parts) {
      const active = level > p.th + 0.003;
      if (active && p.born < 0) p.born = t;
      p.a = damp(p.a, active ? 1 : 0, active ? 0.9 : 1.4, dt);
      if (p.born < 0) { if (p.sp.visible) p.sp.visible = false; continue; }
      if (!active && p.a < 0.004) { p.born = -1; p.sp.visible = false; continue; }
      const age = t - p.born;
      const k = clamp(age / p.travel);
      const e = 1 - (1 - k) * (1 - k);
      // 二次貝茲曲線：門口 → 天花板 → 目標
      const u = 1 - e;
      _v.set(0, 0, 0)
        .addScaledVector(p.start, u * u)
        .addScaledVector(p.mid, 2 * u * e)
        .addScaledVector(p.target, e * e);
      const w = smoothstep(0.2, 1, k);
      _v.x += Math.sin(t * 0.13 + p.wob) * 0.28 * w;
      _v.y += Math.sin(t * 0.09 + p.wob * 2.1) * 0.1 * w;
      _v.z += Math.cos(t * 0.11 + p.wob) * 0.28 * w;
      p.sp.position.copy(_v);
      const size = lerp(p.size0, p.size1, smoothstep(0, 1, Math.min(1, k * 1.25)));
      p.sp.scale.set(size, size, 1);
      p.mat.rotation = p.rot0 + p.rotV * age;
      const fadeIn = smoothstep(0, 1.4, age);
      p.mat.opacity = p.op * fadeIn * p.a;
      p.mat.color.copy(tint).multiplyScalar(p.shade);
      p.sp.visible = p.mat.opacity > 0.003;
    }
  }
  reset() {
    for (const p of this.parts) { p.born = -1; p.a = 0; p.sp.visible = false; p.mat.opacity = 0; }
  }
}

export class SteamSystem {
  constructor(room, origin, { count = 6 } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'steam';
    room.group.add(this.group);
    const tex = room.tex.get('smoke');
    this.origin = origin.clone();
    this.k = 0;
    this.parts = [];
    const r = rng(77);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, color: 0xd9d5cd, transparent: true, depthWrite: false, opacity: 0 });
      mat.name = 'cr:steam';
      const sp = new THREE.Sprite(mat);
      sp.raycast = () => {};
      sp.visible = false;
      this.group.add(sp);
      this.parts.push({ sp, mat, period: 3.6 + r() * 1.6, off: r(), wob: r() * 10, rot: r() * 6 });
    }
  }
  update(dt, t, on, brightness = 1) {
    this.k = damp(this.k, on ? 1 : 0, 1.2, dt);
    for (const p of this.parts) {
      if (this.k < 0.003) { p.sp.visible = false; continue; }
      const ph = ((t / p.period + p.off) % 1 + 1) % 1;
      const y = this.origin.y + 0.004 + ph * 0.19;
      const drift = ph * ph;
      p.sp.position.set(
        this.origin.x + Math.sin(ph * 4 + p.wob) * 0.012 * (0.4 + ph) + drift * 0.03,
        y,
        this.origin.z + Math.cos(ph * 3 + p.wob) * 0.01 * (0.4 + ph),
      );
      const s = 0.035 + ph * 0.11;
      p.sp.scale.set(s, s * 1.3, 1);
      p.mat.rotation = p.rot + ph * 0.8;
      p.mat.opacity = Math.pow(Math.sin(ph * Math.PI), 1.6) * 0.085 * this.k * brightness;
      p.sp.visible = p.mat.opacity > 0.002;
    }
  }
}
