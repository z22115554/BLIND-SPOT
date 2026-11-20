// =============================================================================
// OSD — 監視器畫面的疊字（透明 CanvasTexture，只有文字改變時才重畫）
// 兩張畫布輪替（cur / prev），讓切換頻道或模式時舊字能與新字交叉淡化。
//   左上：CAM-0n 地點　右上：REC（圓點由 CRT shader 畫）＋時間戳 HH:MM:SS　左下：狀態標籤
//   STATIC：中央 SCRIPT.status.noSignal　BOOT：中央 SCRIPT.status.bandwidth
// =============================================================================
import * as THREE from 'three';
import { makeCanvas, fitText, FONTS } from '../../gfx/canvasUtil.js';

export class OSD {
  constructor(w = 640, h = 480) {
    this.w = w; this.h = h;
    this.layers = [0, 1].map(() => {
      const { canvas, g } = makeCanvas(w, h);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      return { canvas, g, texture, key: '' };
    });
    this.cur = 0;
    // REC 圓點位置（OSD uv，原點左下）
    this.rec = { u: 0, v: 0, r: 0 };
  }
  get texture() { return this.layers[this.cur].texture; }
  get prevTexture() { return this.layers[1 - this.cur].texture; }
  /** 交換：目前內容變成 prev（交叉淡化用），新內容畫在另一張上 */
  swap() { this.cur = 1 - this.cur; this.layers[this.cur].key = ''; }

  /**
   * state: { kind: 'feed'|'static'|'boot'|'none', hd, camId, place, label, time, center }
   * 回傳 true 表示有重畫。
   */
  draw(state) {
    const L = this.layers[this.cur];
    const key = JSON.stringify(state);
    if (key === L.key) return false;
    L.key = key;
    const { g } = L;
    const W = this.w, H = this.h;
    g.clearRect(0, 0, W, H);
    g.textBaseline = 'alphabetic';
    const mx = 46, my = 52;
    const shadowText = (text, x, y, { size = 24, font = FONTS.mono, color = '#f4f4f0', align = 'left', weight = 'bold', maxW = 9999 } = {}) => {
      g.save();
      g.font = `${weight} ${size}px ${font}`;
      let s = size;
      while (g.measureText(text).width > maxW && s > 9) { s -= 1; g.font = `${weight} ${s}px ${font}`; }
      g.textAlign = align;
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.78)';
      g.lineWidth = Math.max(3, s * 0.2);
      g.strokeText(text, x, y);
      g.fillStyle = color;
      g.fillText(text, x, y);
      g.restore();
      return s;
    };

    if (state.kind === 'feed') {
      // 左上：CAM id ＋ 地點
      g.font = `bold 25px ${FONTS.mono}`;
      shadowText(state.camId, mx, my, { size: 25 });
      const idW = g.measureText(state.camId).width;
      shadowText(state.place, mx + idW + 14, my, { size: 22, font: FONTS.ui, maxW: W * 0.5 });
      // 右上：REC ＋ 時間戳
      shadowText('REC', W - mx, my, { size: 22, align: 'right' });
      g.font = `bold 22px ${FONTS.mono}`;
      const recW = g.measureText('REC').width;
      const dotX = W - mx - recW - 15, dotY = my - 8;
      this.rec = { u: dotX / W, v: 1 - dotY / H, r: 7.5 / H };
      shadowText(state.time, W - mx, my + 30, { size: 21, align: 'right', weight: '' });
      // 左下：狀態標籤
      const labelColor = state.hd ? (state.warn ? '#ffc27a' : '#f2f2ea') : '#f2f2ea';
      shadowText(state.label, mx, H - my + 14, { size: 19, font: FONTS.ui, maxW: W - mx * 2, color: labelColor, weight: '' });
    } else if (state.kind === 'static') {
      shadowText(state.camId, mx, my, { size: 25 });
      // 中央：NO SIGNAL 方框
      const boxW = W * 0.62, boxH = 64;
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillRect((W - boxW) / 2, H / 2 - boxH / 2, boxW, boxH);
      g.strokeStyle = 'rgba(240,240,236,0.8)'; g.lineWidth = 2;
      g.strokeRect((W - boxW) / 2 + 4, H / 2 - boxH / 2 + 4, boxW - 8, boxH - 8);
      g.textBaseline = 'middle';
      fitText(g, state.center, W / 2, H / 2 + 1, boxW - 30, { size: 24, font: FONTS.ui, color: '#f0f0ea', align: 'center', weight: 'bold' });
      g.textBaseline = 'alphabetic';
      this.rec = { u: 0, v: 0, r: 0 };
    } else if (state.kind === 'boot') {
      const boxW = W * 0.78, boxH = 92;
      g.textBaseline = 'middle';
      fitText(g, state.center, W / 2, H / 2 - 8, boxW, { size: 25, font: FONTS.ui, color: '#eef6ff', align: 'center', weight: 'bold' });
      g.fillStyle = 'rgba(238,246,255,0.75)';
      g.fillRect(W / 2 - boxW / 2, H / 2 + 26, boxW, 2);
      g.textBaseline = 'alphabetic';
      this.rec = { u: 0, v: 0, r: 0 };
    } else {
      this.rec = { u: 0, v: 0, r: 0 };
    }
    L.texture.needsUpdate = true;
    return true;
  }
}
