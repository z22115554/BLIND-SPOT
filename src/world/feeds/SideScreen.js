// =============================================================================
// SideScreen — 主控室左右兩台系統監視器（磷光終端機）
//   setStatus({ title, lines, tone })：只有內容改變時才重畫 Canvas；
//   tone：normal 綠 / warn 琥珀 / alert 紅（顏色在 shader 中平滑過渡）。
// =============================================================================
import * as THREE from 'three';
import { makeCanvas, FONTS } from '../../gfx/canvasUtil.js';
import { createTerminalMaterial } from '../../gfx/shaders/CRTShader.js';
import { damp } from '../../core/util.js';

export const TONES = {
  normal: new THREE.Color(0.30, 1.0, 0.52),
  warn: new THREE.Color(1.0, 0.62, 0.16),
  alert: new THREE.Color(1.0, 0.22, 0.14),
};

export class SideScreen {
  constructor(side, { w = 512, h = 384 } = {}) {
    this.side = side;
    this.w = w; this.h = h;
    const { canvas, g } = makeCanvas(w, h);
    this.canvas = canvas; this.g = g;
    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.material = createTerminalMaterial(this.texture, { texel: [1 / w, 1 / h] });
    this.state = { title: '', lines: [], tone: 'normal' };
    this._key = '';
    this._clock = '';
    this.on = 0;
    this.toneColor = this.material.uniforms.uTone.value;
  }

  setStatus({ title = '', lines = [], tone = 'normal' } = {}) {
    this.state = { title: String(title ?? ''), lines: (lines || []).map((l) => String(l)), tone: TONES[tone] ? tone : 'normal' };
    this._redraw();
  }

  setClock(text) {
    if (text === this._clock) return;
    this._clock = text;
    this._redraw();
  }

  _redraw() {
    const key = JSON.stringify([this.state, this._clock]);
    if (key === this._key) return;
    this._key = key;
    const { g, w, h } = this;
    const { title, lines } = this.state;
    g.clearRect(0, 0, w, h);
    const mx = 34, top = 30;
    // 標題列（反白：實心色塊，字挖空）
    const barH = 42;
    g.fillStyle = 'rgba(255,255,255,0.72)';
    g.fillRect(mx - 8, top, w - (mx - 8) * 2, barH);
    g.save();
    g.globalCompositeOperation = 'destination-out';
    g.textBaseline = 'middle';
    let size = 24;
    g.font = `bold ${size}px ${FONTS.mono}`;
    const clockW = this._clock ? 90 : 0;
    while (g.measureText(title).width > w - mx * 2 - clockW - 10 && size > 11) { size--; g.font = `bold ${size}px ${FONTS.mono}`; }
    g.fillStyle = '#000';
    g.fillText(title, mx, top + barH / 2 + 1);
    if (this._clock) {
      g.font = `bold 22px ${FONTS.mono}`;
      g.textAlign = 'right';
      g.fillText(this._clock, w - mx, top + barH / 2 + 1);
      g.textAlign = 'left';
    }
    g.restore();
    // 內文
    const y0 = top + barH + 22;
    const avail = h - y0 - 30;
    const lh = Math.min(38, avail / Math.max(1, lines.length));
    const fs = Math.min(23, Math.floor(lh * 0.66));
    g.textBaseline = 'middle';
    g.fillStyle = '#fff';
    let lastEnd = { x: mx, y: y0 };
    lines.forEach((line, i) => {
      let s = fs;
      g.font = `${s}px ${FONTS.mono}`;
      while (g.measureText(line).width > w - mx * 2 - 22 && s > 10) { s--; g.font = `${s}px ${FONTS.mono}`; }
      const y = y0 + i * lh + lh / 2;
      g.fillText(line, mx, y);
      lastEnd = { x: mx + g.measureText(line).width, y, s };
    });
    this.texture.needsUpdate = true;
    // 游標（最後一行之後的方塊；由 shader 緩慢呼吸）
    const cs = lastEnd.s || fs;
    const cx0 = lines.length ? lastEnd.x + 8 : mx;
    const cy = lines.length ? lastEnd.y : y0 + lh / 2;
    const cw = cs * 0.55, ch = cs * 0.9;
    this.material.uniforms.uCursor.value.set(cx0 / w, 1 - (cy + ch / 2) / h, (cx0 + cw) / w, 1 - (cy - ch / 2) / h);
  }

  /** on: 0/1 目標；平滑淡入淡出（≥ 0.5 秒） */
  update(dt, t, { on = 1, reduceFlicker = false, brightness = 1 } = {}) {
    this.on = damp(this.on, on, 4.5, dt);
    const u = this.material.uniforms;
    u.uOn.value = this.on;
    u.uTime.value = t;
    u.uReduceFlicker.value = reduceFlicker ? 1 : 0;
    u.uBrightness.value = brightness;
    const target = TONES[this.state.tone] || TONES.normal;
    const k = 1 - Math.exp(-5 * dt);
    this.toneColor.r += (target.r - this.toneColor.r) * k;
    this.toneColor.g += (target.g - this.toneColor.g) * k;
    this.toneColor.b += (target.b - this.toneColor.b) * k;
  }
}
