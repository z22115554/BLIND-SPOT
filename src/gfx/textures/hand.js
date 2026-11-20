// =============================================================================
// 「同一隻手」：便利貼與燒焦日誌最後一頁共用的原子筆手寫字。
// 以 canvasUtil.handwriting（逐字抖動，確定性）畫在透明墨水層，再經同一套墨水處理：
//   低頻位移扭曲（讓筆畫像手抖寫出來的）、筆畫略為收細、原子筆墨色濃淡不均。
// 便利貼的寫字動畫只重畫前 N 個字；抖動與扭曲都是位置的確定函數，所以字形不會跳動。
// =============================================================================
import { handwriting, FONTS } from '../canvasUtil.js';
import { rng, clamp, mkCanvas, field, grain, TAU, smooth, offsetField } from './core.js';

/** 手寫筆跡的固定設定（便利貼與日誌共用 → 筆跡一模一樣） */
export const HAND = { color: '#1b2a6b', rgb: [20, 38, 122], font: FONTS.hand, slant: -0.04, seed: 1207 };

/**
 * 原子筆墨水處理器（每個畫布尺寸建一次，扭曲場固定 → 確定性）。
 * 1) 只處理有墨水的範圍；2) 十字形侵蝕讓筆畫收細成原子筆粗細；3) 低頻＋中頻位移讓筆畫像手抖寫出來；
 * 4) 墨色濃淡與偶爾的斷墨。
 */
export class InkProcessor {
  constructor(W, H, { seed = 4242, cellPx = 22 } = {}) {
    this.W = W; this.H = H;
    const cells = Math.max(2, Math.round(W / cellPx));
    this.dx = field(W, H, { cells, octaves: 3, gain: 0.45, seed }, 2);
    this.dy = offsetField(this.dx, W, H, (W * 0.37) | 0, (H * 0.61) | 0);
    this.dens = field(W, H, { cells: Math.max(2, Math.round(W / 9)), octaves: 2, seed: seed + 2 }, 2);
    this.gr = grain(W, H, seed + 3);
    this.tmp = mkCanvas(W, H);
  }
  /** src：透明底的墨水層 canvas；把處理後的墨水疊到 dst。amp = 扭曲幅度（px），erode = 收細程度 0..1 */
  apply(src, dst, { amp = 1.6, erode = 0.7, rgb = HAND.rgb } = {}) {
    const { W, H } = this;
    const s = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W * 4;
      for (let x = 0; x < W; x++) if (s[row + x * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return;
    const pad = Math.ceil(amp) + 3;
    x0 = Math.max(1, x0 - pad); y0 = Math.max(1, y0 - pad); x1 = Math.min(W - 2, x1 + pad); y1 = Math.min(H - 2, y1 + pad);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    // 侵蝕（收細）後的 alpha
    const A = new Float32Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const p = ((y + y0) * W + (x + x0)) * 4 + 3;
      const a = s[p];
      if (!a) continue;
      const e = Math.min(a, s[p - 4], s[p + 4], s[p - W * 4], s[p + W * 4]);
      A[y * bw + x] = (a + (e - a) * erode) / 255;
    }
    const out = this.tmp.g.createImageData(bw, bh); const o = out.data;
    const { dx, dy, dens, gr } = this;
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = (y + y0) * W + (x + x0);
      const sx = x + (dx[i] - 0.5) * 2 * amp, sy = y + (dy[i] - 0.5) * 2 * amp;
      const fx = Math.floor(sx), fy = Math.floor(sy);
      if (fx < 0 || fy < 0 || fx >= bw - 1 || fy >= bh - 1) continue;
      const tx = sx - fx, ty = sy - fy, q0 = fy * bw + fx;
      const a = (A[q0] * (1 - tx) + A[q0 + 1] * tx) * (1 - ty) + (A[q0 + bw] * (1 - tx) + A[q0 + bw + 1] * tx) * ty;
      if (a < 0.01) continue;
      let al = a * 1.12 * (0.82 + 0.26 * dens[i]) - (gr[i] < 0.035 ? 0.22 : 0);
      al = al < 0 ? 0 : al > 1 ? 1 : al;
      const q = (y * bw + x) * 4;
      o[q] = rgb[0]; o[q + 1] = rgb[1]; o[q + 2] = rgb[2]; o[q + 3] = al * 255;
    }
    this.tmp.g.clearRect(x0, y0, bw, bh);
    this.tmp.g.putImageData(out, x0, y0);
    dst.drawImage(this.tmp.canvas, x0, y0, bw, bh, x0, y0, bw, bh);
  }
}

/** 字串依手寫字寬（與 handwriting() 相同的 advance 規則）斷行 */
export function wrapHand(text, maxW, size) {
  const lines = []; let cur = ''; let w = 0;
  for (const ch of text) {
    const adv = size * (/[0-9A-Za-z，。、！？：；]/.test(ch) ? 0.62 : 0.98);
    const punct = /[，。、！？：；…）」』]/.test(ch);
    if (w + adv > maxW && cur && !punct) { lines.push(cur); cur = ''; w = 0; }
    cur += ch; w += adv;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 「正」字記號（每 5 劃一個字），筆劃順序：上橫、中豎、中短橫、左短豎、下橫 */
const ZHENG = [
  [[0.08, 0.1], [0.92, 0.13]],
  [[0.5, 0.13], [0.5, 0.9]],
  [[0.5, 0.5], [0.84, 0.48]],
  [[0.22, 0.44], [0.22, 0.9]],
  [[0.02, 0.92], [0.98, 0.9]],
];
export function drawTallies(g, n, { right = 492, bottom = 494, cell = 30, perRow = 4, maxStrokes = 60, rgb = HAND.rgb } = {}) {
  const count = Math.min(n | 0, maxStrokes);
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k < count; k++) {
    const group = Math.floor(k / 5), st = k % 5;
    const row = Math.floor(group / perRow), col = group % perRow;
    const ox = right - (perRow - col) * cell * 1.08, oy = bottom - (row + 1) * cell * 1.12;
    const r = rng(9001 + k * 13);
    const [[ax, ay], [bx, by]] = ZHENG[st];
    const j = () => (r() - 0.5) * 0.08;
    const x0 = ox + (ax + j()) * cell, y0 = oy + (ay + j()) * cell, x1 = ox + (bx + j()) * cell, y1 = oy + (by + j()) * cell;
    const mx = (x0 + x1) / 2 + (r() - 0.5) * cell * 0.05, my = (y0 + y1) / 2 + (r() - 0.5) * cell * 0.05;
    g.strokeStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${0.82 + r() * 0.18})`;
    g.lineWidth = cell * 0.085;
    g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); g.stroke();
  }
  g.restore();
}

// -----------------------------------------------------------------------------
// 便利貼紙張（只畫一次）
// -----------------------------------------------------------------------------
function stickyPaper(W, H) {
  const { canvas, g } = mkCanvas(W, H);
  const mott = field(W, H, { cells: 4, octaves: 4, seed: 301 }, 4);
  const fib = field(W, H, { cells: 48, cellsY: 160, octaves: 2, seed: 302 }, 2);
  const gr = grain(W, H, 303);
  const img = g.createImageData(W, H); const d = img.data;
  const strip = 0.17 * H;
  for (let y = 0; y < H; y++) {
    const t = y / H;
    for (let x = 0; x < W; x++) {
      const i = y * W + x, p = i * 4;
      let r = 252 - 7 * t, gg = 231 - 16 * t, b = 112 - 22 * t;
      const k = (0.97 + 0.045 * mott[i]) * (0.985 + 0.03 * fib[i]) + (gr[i] - 0.5) * 0.025;
      // 背膠帶：平貼、略亮；下方紙張微微翹起 → 往下漸暗
      const lift = smooth(strip, H, y);
      const kk = k * (1 - 0.07 * lift * lift) * (y < strip ? 1.012 : 1);
      // 右下角捲翹陰影
      const cd = (W - x) + (H - y);
      const curl = smooth(120, 0, cd) * 0.1;
      // 紙張邊緣
      const de = Math.min(x, W - 1 - x, H - 1 - y, y + 6);
      const edge = smooth(3, 0, de) * 0.12;
      r *= kk * (1 - curl - edge); gg *= kk * (1 - curl * 1.1 - edge); b *= kk * (1 - curl * 1.2 - edge);
      d[p] = r; d[p + 1] = gg; d[p + 2] = b; d[p + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // 背膠帶的折線（極淡）
  const lg = g.createLinearGradient(0, strip - 2, 0, strip + 10);
  lg.addColorStop(0, 'rgba(120,96,20,0.0)'); lg.addColorStop(0.25, 'rgba(120,96,20,0.07)'); lg.addColorStop(1, 'rgba(120,96,20,0)');
  g.fillStyle = lg; g.fillRect(0, strip - 2, W, 12);
  // 右下角捲翹的亮邊
  g.strokeStyle = 'rgba(255,250,200,0.35)'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(W - 64, H - 1); g.quadraticCurveTo(W - 30, H - 26, W - 1, H - 70); g.stroke();
  // 淡淡的指紋油漬
  const rnd = rng(304);
  for (let i = 0; i < 2; i++) {
    const x = 60 + rnd() * (W - 120), y = H * 0.75 + rnd() * H * 0.15;
    const rg = g.createRadialGradient(x, y, 0, x, y, 26);
    rg.addColorStop(0, 'rgba(150,120,30,0.06)'); rg.addColorStop(1, 'rgba(150,120,30,0)');
    g.fillStyle = rg; g.beginPath(); g.ellipse(x, y, 26, 18, rnd() * TAU, 0, TAU); g.fill();
  }
  return canvas;
}

/**
 * 便利貼（動態）。回傳物件含 redraw 狀態；canvasTexture 由呼叫者建立後傳入 onUpdate。
 */
export function makeStickyNote(SCRIPT, { progress = 1, tallies = 0 } = {}) {
  const W = 512, H = 512;
  const lines = SCRIPT?.stickyNote?.lines ?? [String(SCRIPT?.stickyNote?.text ?? '')];
  const total = lines.reduce((n, l) => n + [...l].length, 0);
  const size = 44, x0 = 40, y0 = 150;
  const paper = stickyPaper(W, H);
  const { canvas, g } = mkCanvas(W, H);
  const ink = mkCanvas(W, H);
  const proc = new InkProcessor(W, H, { seed: 4242, cellPx: 22 });
  const state = { chars: -1, tallies: -1, pen: { x: x0, y: y0 } };
  const draw = (chars, tal) => {
    if (chars === state.chars && tal === state.tallies) return false;
    state.chars = chars; state.tallies = tal;
    g.drawImage(paper, 0, 0);
    ink.g.clearRect(0, 0, W, H);
    state.pen = handwriting(ink.g, lines, x0, y0, { size, seed: HAND.seed, chars, color: HAND.color, font: HAND.font, slant: HAND.slant, jitter: 1 });
    drawTallies(ink.g, tal);
    proc.apply(ink.canvas, g, { amp: 1.9, erode: 0.7 });
    return true;
  };
  return {
    canvas, W, H, total, lines,
    /** 最後一行（SCRIPT.stickyNote.lastSentence）開始處的進度值 */
    lastLineStart: total ? (total - [...(lines[lines.length - 1] ?? '')].length) / total : 1,
    draw,
    setProgress(p) { return draw(Math.max(0, Math.min(total, Math.floor(clamp(p) * total + 1e-6))), Math.max(0, state.tallies)); },
    setTallies(n) { return draw(Math.max(0, state.chars), Math.max(0, n | 0)); },
    penPosition() {
      // 筆尖：最後一個字之後、約在字身中段
      const px = state.pen.x - size * 0.08, py = state.pen.y - size * 0.32;
      return { u: px / W, v: 1 - py / H };
    },
    init() { draw(Math.floor(clamp(progress) * total + 1e-6), tallies | 0); },
  };
}

/** 只把「同一隻手」的字畫進墨水層（不處理），可多次呼叫後再一次 apply。回傳筆尖位置。 */
export function inkLines(layer, lines, x, y, { size = 30, seed = HAND.seed, jitter = 1 } = {}) {
  return handwriting(layer.g, lines, x, y, { size, seed, color: HAND.color, font: HAND.font, slant: HAND.slant, jitter });
}

/** 在任意畫布上寫「同一隻手」的字（畫進墨水層後立即處理）。回傳筆尖位置。 */
export function writeHand(g, proc, lines, x, y, { size = 30, seed = HAND.seed, jitter = 1, amp = null, ink = null } = {}) {
  const layer = ink || mkCanvas(proc.W, proc.H);
  layer.g.clearRect(0, 0, proc.W, proc.H);
  const pen = inkLines(layer, lines, x, y, { size, seed, jitter });
  proc.apply(layer.canvas, g, { amp: amp ?? 1.9 * (size / 44) * Math.max(1, jitter * 0.8), erode: 0.7 * Math.min(1, size / 40) });
  return pen;
}
