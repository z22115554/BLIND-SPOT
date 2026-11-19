// =============================================================================
// Corridor 專用的程式化貼圖（廊道局部細節：水漬、積水、夾絲玻璃、車燈眩光、
// 外套布料、焦痕、儀表盤、消防栓箱面板……）。共用貼圖一律走 ctx.textures。
// 全部以 canvasUtil 繪製、確定性（固定 seed）。
// =============================================================================
import * as THREE from 'three';
import { makeCanvas, canvasTexture, fillNoise, speckle, stain, streaks, fitText, FONTS, makeNoise, fbm } from '../../gfx/canvasUtil.js';
import { rng } from '../../core/util.js';

const TAU = Math.PI * 2;

/**
 * 牆面潮濕水漬（RGBA，寬幅）。刻意做成「橫向攤開」的形狀，避免任何像人形的輪廓。
 * kind 'seep'：天花板接縫滲水，上緣一整條濕帶＋長短不一往下流的水痕。
 * kind 'rising'：地面返潮，下半部濕、上緣是不規則的白華潮線。
 */
export function dampTexture(seed = 1, kind = 'seep') {
  const w = 512, h = 256;
  const { canvas, g } = makeCanvas(w, h);
  const r = rng(seed);
  const noise = makeNoise(seed + 3, 64);
  if (kind === 'seep') {
    const band = g.createLinearGradient(0, 0, 0, h * 0.35);
    band.addColorStop(0, 'rgba(18,22,18,0.55)'); band.addColorStop(1, 'rgba(18,22,18,0)');
    g.fillStyle = band; g.fillRect(0, 0, w, h * 0.35);
    for (let i = 0; i < 9; i++) stain(g, w * (0.08 + r() * 0.84), h * (0.04 + r() * 0.12), 18 + r() * 34, { seed: seed + 10 + i, color: [16, 20, 16], alpha: 0.4, blobs: 8, soft: 0.8 });
    streaks(g, w * 0.04, w * 0.96, h * 0.08, h * 0.9, { seed: seed + 4, count: 70, color: [18, 22, 18], alpha: 0.34, width: [1.5, 5] });
    streaks(g, w * 0.1, w * 0.9, h * 0.1, h * 0.7, { seed: seed + 5, count: 26, color: [78, 56, 30], alpha: 0.2, width: [1, 3] });
    speckle(g, w, h * 0.3, { seed: seed + 6, count: 160, color: 'rgba(214,210,196,0.14)', min: 0.6, max: 2.2 });
  } else {
    const img0 = g.createImageData(w, h); const d0 = img0.data;
    for (let x = 0; x < w; x++) {
      const top = h * (0.38 + 0.3 * fbm(noise, x / w * 8, 0.5, 4));
      for (let y = 0; y < h; y++) {
        const i = (y * w + x) * 4;
        const dy = y - top;
        if (dy < -3) continue;
        const line = Math.exp(-(dy * dy) / 6);                         // 白華潮線
        const wet = dy > 0 ? Math.min(1, dy / 40) * (0.35 + 0.25 * fbm(noise, x / w * 16, y / h * 6, 3)) : 0;
        const a = Math.max(line * 0.32, wet);
        const lc = line * 0.32 > wet;
        d0[i] = lc ? 206 : 20; d0[i + 1] = lc ? 202 : 24; d0[i + 2] = lc ? 186 : 20; d0[i + 3] = a * 255;
      }
    }
    g.putImageData(img0, 0, 0);
    speckle(g, w, h, { seed: seed + 6, count: 120, color: 'rgba(214,210,196,0.12)', min: 0.6, max: 2 });
  }
  // 左右（與 seep 的下緣）淡出
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ex = Math.min(x, w - 1 - x) / (w * 0.16);
    const ey = kind === 'seep' ? (h - 1 - y) / (h * 0.15) : y / (h * 0.05);
    const f = Math.min(1, ex) * Math.min(1, ey);
    d[(y * w + x) * 4 + 3] *= f * f * (3 - 2 * f);
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(canvas, { wrap: false });
}

/** 積水的形狀遮罩（灰階 → alphaMap）。 */
export function puddleMask(seed = 1, size = 256) {
  const { canvas, g } = makeCanvas(size, size);
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  const r = rng(seed);
  const noise = makeNoise(seed + 9, 64);
  const img = g.createImageData(size, size); const d = img.data;
  const blobs = [];
  for (let i = 0; i < 5; i++) blobs.push([0.5 + (r() - 0.5) * 0.35, 0.5 + (r() - 0.5) * 0.35, 0.18 + r() * 0.16]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    let f = 0;
    for (const [bx, by, br] of blobs) { const dd = Math.hypot(u - bx, (v - by) * 1.1) / br; f = Math.max(f, 1 - dd); }
    f += (fbm(noise, u * 6, v * 6, 4) - 0.5) * 0.55;
    const edge = Math.min(u, v, 1 - u, 1 - v) * 8;
    f = Math.min(f, edge);
    const a = Math.max(0, Math.min(1, (f - 0.05) * 5));
    const i = (y * size + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = a * 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(canvas, { wrap: false, color: false });
}

/** 防火門夾絲強化玻璃（RGBA）：淡綠玻璃（低 alpha）＋方格鐵絲網＋污痕、刮痕、一道細裂紋。 */
export function wiredGlassTexture() {
  const W = 384, H = 496;
  const { canvas, g } = makeCanvas(W, H);
  g.fillStyle = 'rgba(150,186,164,0.22)'; g.fillRect(0, 0, W, H);
  // 邊緣積垢
  const eg = g.createLinearGradient(0, 0, 0, H);
  eg.addColorStop(0, 'rgba(40,44,38,0.22)'); eg.addColorStop(0.12, 'rgba(40,44,38,0)');
  eg.addColorStop(0.82, 'rgba(40,44,38,0)'); eg.addColorStop(1, 'rgba(46,42,32,0.36)');
  g.fillStyle = eg; g.fillRect(0, 0, W, H);
  // 污痕／手印
  const r = rng(77);
  for (let i = 0; i < 26; i++) {
    const x = r() * W, y = H * (0.25 + r() * 0.7), rad = 8 + r() * 36;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(120,118,104,${0.05 + r() * 0.1})`); gr.addColorStop(1, 'rgba(120,118,104,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // 煙燻（上緣較髒）
  stain(g, W * 0.5, H * 0.05, W * 0.5, { seed: 78, color: [30, 30, 28], alpha: 0.16, blobs: 12 });
  // 鐵絲網：25 mm 方格
  const step = W / 24.8;
  g.lineWidth = 1.1;
  for (let x = step * 0.5; x < W; x += step) {
    g.strokeStyle = `rgba(48,50,47,${0.52 + r() * 0.2})`;
    g.beginPath(); g.moveTo(x + (r() - 0.5), 0); g.lineTo(x + (r() - 0.5) * 2, H); g.stroke();
  }
  for (let y = step * 0.5; y < H; y += step) {
    g.strokeStyle = `rgba(48,50,47,${0.52 + r() * 0.2})`;
    g.beginPath(); g.moveTo(0, y + (r() - 0.5)); g.lineTo(W, y + (r() - 0.5) * 2); g.stroke();
  }
  // 鐵絲點銹（暗褐，不要太飽和）
  for (let i = 0; i < 30; i++) {
    const x = Math.round(r() * 24) * step + step * 0.5, y = r() * H;
    g.fillStyle = `rgba(84,58,40,${0.25 + r() * 0.3})`; g.fillRect(x - 1, y - 2, 2, 3 + r() * 5);
  }
  // 刮痕
  g.strokeStyle = 'rgba(230,236,226,0.18)'; g.lineWidth = 0.8;
  for (let i = 0; i < 14; i++) {
    const x = r() * W, y = r() * H, a = (r() - 0.5) * 0.8, l = 10 + r() * 60;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  // 一道細裂紋（左上角）
  g.strokeStyle = 'rgba(235,245,238,0.42)'; g.lineWidth = 1.1;
  g.beginPath(); let cx = 6, cy = H * 0.08; g.moveTo(cx, cy);
  for (let i = 0; i < 9; i++) { cx += 9 + r() * 14; cy += (r() - 0.3) * 14; g.lineTo(cx, cy); }
  g.stroke();
  return canvasTexture(canvas, { wrap: false, anisotropy: 8 });
}

/** 玻璃上的散射光遮罩（加算混合用）：底層均勻＋污痕處更亮。 */
export function glassScatterTexture() {
  const W = 192, H = 248;
  const { canvas, g } = makeCanvas(W, H);
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(0, 0, W, H);
  const r = rng(79);
  for (let i = 0; i < 30; i++) {
    const x = r() * W, y = H * (0.2 + r() * 0.8), rad = 6 + r() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(255,255,255,${0.25 + r() * 0.4})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // 鐵絲網在逆光下是暗線
  const step = W / 24.8; g.strokeStyle = 'rgba(0,0,0,0.65)'; g.lineWidth = 1;
  g.globalCompositeOperation = 'destination-out';
  for (let x = step * 0.5; x < W; x += step) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = step * 0.5; y < H; y += step) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.globalCompositeOperation = 'source-over';
  return canvasTexture(canvas, { wrap: false });
}

/** 車燈眩光：柔和核心＋水平拉長的光紋（加算）。 */
export function glareTexture() {
  const S = 256;
  const { canvas, g } = makeCanvas(S, S);
  const c = S / 2;
  let gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,248,232,1)'); gr.addColorStop(0.08, 'rgba(255,240,214,0.85)');
  gr.addColorStop(0.3, 'rgba(255,226,186,0.22)'); gr.addColorStop(1, 'rgba(255,220,180,0)');
  g.fillStyle = gr; g.fillRect(0, 0, S, S);
  g.save(); g.translate(c, c); g.scale(1, 0.06);
  gr = g.createRadialGradient(0, 0, 0, 0, 0, c);
  gr.addColorStop(0, 'rgba(255,244,226,0.75)'); gr.addColorStop(1, 'rgba(255,244,226,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, c, 0, TAU); g.fill(); g.restore();
  return canvasTexture(canvas, { wrap: false });
}

/** 柔和圓形光暈（高斯狀衰減，沒有明顯邊緣）。rgb = 顏色 0..255。 */
export function haloTexture(rgb = [255, 255, 255], { size = 128, falloff = 5.5 } = {}) {
  const { canvas, g } = makeCanvas(size, size);
  const img = g.createImageData(size, size); const d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const rr = Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) / (size / 2);
    const a = Math.exp(-rr * rr * falloff) * Math.max(0, Math.min(1, (1 - rr) * 4));
    const i = (y * size + x) * 4; d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(canvas, { wrap: false });
}

/**
 * 消防外套布料（正面／袖子）：髒黃色防裂格紋、煙燻、乾掉的泡沫；
 * 反光條位置與 createCoatBack 對齊（距上緣 22–31%、79–88%）。
 * 回傳 { map, emissive }（emissive = 反光條遮罩，做手電筒的回歸反射）。
 */
export function coatFabricTextures() {
  const S = 512;
  const a = makeCanvas(S, S), m = makeCanvas(S, S);
  const g = a.g;
  fillNoise(g, S, S, { seed: 611, scale: 8, octaves: 4, c0: [168, 138, 76], c1: [200, 170, 102], contrast: 1.1 });
  // 防裂格紋
  g.strokeStyle = 'rgba(80,60,20,0.10)'; g.lineWidth = 1;
  for (let i = 0; i < S; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, S); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(S, i); g.stroke(); }
  // 煙燻：下緣與隨機塊
  const sg = g.createLinearGradient(0, S * 0.55, 0, S);
  sg.addColorStop(0, 'rgba(30,26,20,0)'); sg.addColorStop(1, 'rgba(30,26,20,0.55)');
  g.fillStyle = sg; g.fillRect(0, 0, S, S);
  stain(g, S * 0.3, S * 0.62, S * 0.3, { seed: 612, color: [34, 30, 24], alpha: 0.45, blobs: 18 });
  stain(g, S * 0.75, S * 0.4, S * 0.25, { seed: 613, color: [40, 34, 26], alpha: 0.35, blobs: 14 });
  stain(g, S * 0.6, S * 0.85, S * 0.3, { seed: 614, color: [24, 22, 18], alpha: 0.5, blobs: 14 });
  // 乾掉的滅火泡沫（灰白、邊緣清楚）
  stain(g, S * 0.2, S * 0.3, S * 0.12, { seed: 615, color: [214, 210, 196], alpha: 0.35, blobs: 10, soft: 0.25 });
  stain(g, S * 0.82, S * 0.7, S * 0.1, { seed: 616, color: [210, 206, 190], alpha: 0.3, blobs: 9, soft: 0.25 });
  speckle(g, S, S, { seed: 617, count: 420, color: 'rgba(20,18,14,0.35)', min: 0.5, max: 2.2 });
  // 反光條
  const strips = [[0.22, 0.31], [0.79, 0.88]];
  m.g.fillStyle = '#000'; m.g.fillRect(0, 0, S, S);
  for (const [t0, t1] of strips) {
    const y0 = t0 * S, y1 = t1 * S, e = 9;
    g.fillStyle = '#b8cf3e'; g.fillRect(0, y0, S, y1 - y0);                       // 螢光黃綠邊
    const sgr = g.createLinearGradient(0, y0 + e, 0, y1 - e);
    sgr.addColorStop(0, '#bfc3c4'); sgr.addColorStop(0.5, '#d6d9da'); sgr.addColorStop(1, '#aeb2b3');
    g.fillStyle = sgr; g.fillRect(0, y0 + e, S, y1 - y0 - 2 * e);                 // 銀色反光
    stain(g, S * 0.4, (y0 + y1) / 2, S * 0.3, { seed: 618 + y0, color: [40, 36, 30], alpha: 0.45, blobs: 12 }); // 反光條也髒了
    m.g.fillStyle = '#fff'; m.g.fillRect(0, y0 + e, S, y1 - y0 - 2 * e);
    m.g.fillStyle = '#555'; m.g.fillRect(0, y0, S, e); m.g.fillRect(0, y1 - e, S, e);
  }
  // 遮罩也要被煙燻壓暗（與上面反光條上的污漬位置一致）
  for (const [t0, t1] of strips) stain(m.g, S * 0.4, ((t0 + t1) / 2) * S, S * 0.3, { seed: 618 + t0 * S, color: [0, 0, 0], alpha: 0.45, blobs: 12 });
  // 縫線
  g.strokeStyle = 'rgba(60,46,20,0.45)'; g.setLineDash([4, 4]); g.lineWidth = 1.2;
  for (const y of [S * 0.215, S * 0.315, S * 0.785, S * 0.885]) { g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke(); }
  g.setLineDash([]);
  return { map: canvasTexture(a.canvas, { anisotropy: 8 }), emissive: canvasTexture(m.canvas) };
}

/** 地上的焦痕（RGBA）。 */
export function scorchTexture(seed = 5) {
  const S = 256;
  const { canvas, g } = makeCanvas(S, S);
  stain(g, S / 2, S / 2, S * 0.46, { seed, color: [46, 34, 24], alpha: 0.35, blobs: 20, soft: 0.8 });
  stain(g, S / 2, S / 2, S * 0.34, { seed: seed + 1, color: [12, 10, 9], alpha: 0.7, blobs: 18, soft: 0.6 });
  speckle(g, S, S, { seed: seed + 2, count: 260, color: 'rgba(150,146,138,0.35)', min: 0.6, max: 2.5 }); // 灰燼
  const img = g.getImageData(0, 0, S, S); const d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const rr = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
    d[(y * S + x) * 4 + 3] *= Math.max(0, Math.min(1, (1 - rr) * 3));
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(canvas, { wrap: false });
}

/** 指針式儀表盤（白底黑刻度）。 */
export function gaugeTexture(label = 'V', max = 500) {
  const S = 256;
  const { canvas, g } = makeCanvas(S, S);
  const c = S / 2;
  g.fillStyle = '#2a2c2a'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#e9e6da'; g.beginPath(); g.arc(c, c, S * 0.46, 0, TAU); g.fill();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  g.strokeStyle = '#b3261e'; g.lineWidth = 7;
  g.beginPath(); g.arc(c, c, S * 0.36, a0 + (a1 - a0) * 0.82, a1); g.stroke();
  g.strokeStyle = '#141414';
  for (let i = 0; i <= 50; i++) {
    const a = a0 + (a1 - a0) * (i / 50), big = i % 10 === 0;
    const r0 = S * (big ? 0.31 : 0.345), r1 = S * 0.39;
    g.lineWidth = big ? 3 : 1.4;
    g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke();
    if (big) {
      g.fillStyle = '#141414'; g.font = `600 17px ${FONTS.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(Math.round(max * i / 50)), c + Math.cos(a) * S * 0.25, c + Math.sin(a) * S * 0.25);
    }
  }
  g.fillStyle = '#141414'; g.font = `700 30px ${FONTS.ui}`; g.textAlign = 'center';
  g.fillText(label, c, c + S * 0.2);
  // 玻璃上的灰
  stain(g, c * 0.8, c * 1.3, S * 0.3, { seed: 91, color: [120, 112, 96], alpha: 0.18, blobs: 8 });
  g.textAlign = 'left';
  return canvasTexture(canvas, { wrap: false });
}

/** 消防栓箱的正面標示板（紅底白字）。 */
export function hosePlateTexture() {
  const W = 256, H = 64;
  const { canvas, g } = makeCanvas(W, H);
  g.fillStyle = '#a5170f'; g.fillRect(0, 0, W, H);
  fitText(g, '消防栓', W / 2, H * 0.74, W * 0.8, { size: 44, font: FONTS.ui, color: '#f4efe6', align: 'center', weight: '900' });
  speckle(g, W, H, { seed: 31, count: 60, color: 'rgba(30,10,8,0.25)', min: 0.5, max: 2 });
  return canvasTexture(canvas, { wrap: false });
}

/** 日光燈乳白燈罩：灰塵與死蟲。 */
export function diffuserTexture(seed = 3) {
  const W = 256, H = 64;
  const { canvas, g } = makeCanvas(W, H);
  g.fillStyle = '#e8e8e2'; g.fillRect(0, 0, W, H);
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, 'rgba(120,112,90,0.0)'); gr.addColorStop(0.5, 'rgba(120,112,90,0.25)'); gr.addColorStop(1, 'rgba(120,112,90,0.0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  speckle(g, W, H, { seed, count: 80, color: 'rgba(30,26,20,0.55)', min: 0.6, max: 1.8 });
  const r = rng(seed + 1);
  for (let i = 0; i < 6; i++) { // 死蟲剪影
    g.fillStyle = 'rgba(20,16,12,0.7)';
    g.beginPath(); g.ellipse(r() * W, H * (0.35 + r() * 0.3), 2 + r() * 2, 1 + r(), r() * TAU, 0, TAU); g.fill();
  }
  return canvasTexture(canvas, { wrap: false });
}

/** 日誌頁緣（側面紙張層次）。 */
export function pageEdgeTexture() {
  const W = 64, H = 256;
  const { canvas, g } = makeCanvas(W, H);
  g.fillStyle = '#cfc4a8'; g.fillRect(0, 0, W, H);
  const r = rng(41);
  for (let y = 0; y < H; y += 2) { g.fillStyle = `rgba(80,66,40,${0.1 + r() * 0.25})`; g.fillRect(0, y, W, 1); }
  const gr = g.createLinearGradient(0, 0, W, 0);
  gr.addColorStop(0, 'rgba(20,14,8,0.8)'); gr.addColorStop(0.35, 'rgba(60,40,20,0.25)'); gr.addColorStop(1, 'rgba(40,30,20,0.0)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  stain(g, W * 0.3, H * 0.7, W * 0.9, { seed: 42, color: [26, 18, 10], alpha: 0.6, blobs: 10 });
  return canvasTexture(canvas, { wrap: false });
}

/** 簡單的瓦楞紙箱。 */
export function cardboardTexture() {
  const S = 128;
  const { canvas, g } = makeCanvas(S, S);
  fillNoise(g, S, S, { seed: 51, scale: 6, c0: [118, 88, 54], c1: [146, 112, 70] });
  g.fillStyle = 'rgba(200,190,160,0.5)'; g.fillRect(0, S * 0.45, S, S * 0.1); // 膠帶
  stain(g, S * 0.3, S * 0.8, S * 0.3, { seed: 52, color: [50, 36, 20], alpha: 0.4 });
  return canvasTexture(canvas, { wrap: false });
}

/** 潮濕天花板的水漬（RGBA，圓形）。 */
export function ceilingStainTexture(seed = 61) {
  const S = 256;
  const { canvas, g } = makeCanvas(S, S);
  stain(g, S / 2, S / 2, S * 0.42, { seed, color: [74, 58, 34], alpha: 0.25, blobs: 18, soft: 0.4 });
  stain(g, S / 2, S / 2, S * 0.3, { seed: seed + 1, color: [20, 22, 18], alpha: 0.45, blobs: 14, soft: 0.8 });
  const img = g.getImageData(0, 0, S, S); const d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const rr = Math.hypot(x - S / 2, y - S / 2) / (S / 2);
    d[(y * S + x) * 4 + 3] *= Math.max(0, Math.min(1, (1 - rr) * 4));
  }
  g.putImageData(img, 0, 0);
  return canvasTexture(canvas, { wrap: false });
}

/** 積水用的簡易環境反射（昏暗廊道：上方較亮、帶一條燈管亮帶）。 */
export function wetEnvCube() {
  const S = 32;
  const face = (kind) => {
    const { canvas, g } = makeCanvas(S, S);
    if (kind === 'top') {
      g.fillStyle = '#2a2e33'; g.fillRect(0, 0, S, S);
      g.fillStyle = '#c9d4e0'; g.fillRect(0, S * 0.44, S, S * 0.12);       // 燈管（沿廊道方向）
    } else if (kind === 'bottom') { g.fillStyle = '#050505'; g.fillRect(0, 0, S, S); }
    else {
      const gr = g.createLinearGradient(0, 0, 0, S);
      gr.addColorStop(0, '#30353a'); gr.addColorStop(0.5, '#15181a'); gr.addColorStop(1, '#070808');
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
    }
    return canvas;
  };
  const tex = new THREE.CubeTexture([face('side'), face('side'), face('top'), face('bottom'), face('side'), face('side')]);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/** 髒污的烤漆（灰階污垢，用來壓暗純色材質）。 */
export function grimeTexture() {
  const S = 256;
  const { canvas, g } = makeCanvas(S, S);
  fillNoise(g, S, S, { seed: 71, scale: 6, octaves: 5, c0: [168, 166, 160], c1: [236, 234, 228] });
  stain(g, S * 0.5, S * 0.9, S * 0.5, { seed: 72, color: [70, 64, 56], alpha: 0.4, blobs: 12 });
  speckle(g, S, S, { seed: 73, count: 300, color: 'rgba(40,36,30,0.3)', min: 0.5, max: 2 });
  g.strokeStyle = 'rgba(250,248,240,0.35)'; g.lineWidth = 0.8;
  const r = rng(74);
  for (let i = 0; i < 26; i++) { const x = r() * S, y = r() * S, a = r() * TAU, l = 6 + r() * 30; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  return canvasTexture(canvas);
}

export { THREE };
