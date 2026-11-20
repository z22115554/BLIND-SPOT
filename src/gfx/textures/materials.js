// =============================================================================
// 金屬／設備／塑膠／布料／封鎖線貼圖。每個產生器回傳 { map, bump?, rough? }（canvas）。
// 逐像素迴圈一律用純量 r/g/b 運算（不在迴圈內配置陣列，避免 GC 停頓）。
// =============================================================================
import { FONTS } from '../canvasUtil.js';
import {
  rng, clamp, TAU, mkCanvas, smooth, field, grain, worley, fieldToCanvas, Pix,
  wrapDraw, rivet, screw, scratches, drip, stencilLayer, hash3, hyp,
} from './core.js';

// -----------------------------------------------------------------------------
// 控制台鋼板（暖灰烤漆）：一片面板單元，四邊接縫、邊角掉漆、四角螺絲
// -----------------------------------------------------------------------------
export function metalPanel() {
  const W = 512, H = 512, N = W * H;
  const mott = field(W, H, { cells: 3, octaves: 4, seed: 101 }, 4);
  const peel = field(W, H, { cells: 110, octaves: 2, seed: 102 }, 2);
  const wearN = field(W, H, { cells: 18, octaves: 4, seed: 103 }, 2);
  const grime = field(W, H, { cells: 4, octaves: 5, seed: 104 }, 4);
  const gr = grain(W, H, 105);
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const de = Math.min(x, y, W - 1 - x, H - 1 - y);
    let k = (0.92 + 0.12 * mott[i]) * (0.985 + 0.03 * peel[i]);
    k *= 1 - 0.14 * smooth(14, 0, de) - 0.1 * smooth(0.55, 0.95, grime[i]) * smooth(0.45, 1, y / H);
    let r = 170 * k, g = 163 * k, b = 150 * k;
    const chip = smooth(16, 3, de) * smooth(0.5, 0.56, wearN[i]);
    const sv = 0.85 + 0.3 * peel[i];
    r += (78 * sv - r) * chip; g += (78 * sv - g) * chip; b += (80 * sv - b) * chip;
    let h = 0.6 + 0.04 * (peel[i] - 0.5) - 0.1 * chip;
    if (de < 2) { r = 36; g = 35; b = 33; h = 0.15; }
    else if (de < 4.5) {
      const lit = (x < 4.5 || y < 4.5) && !(W - 1 - x < 4.5 || H - 1 - y < 4.5);
      const m = lit ? 1.18 : 0.72; r *= m; g *= m; b *= m; h = 0.4 + (de - 2) * 0.08;
    }
    const n = (gr[i] - 0.5) * 6;
    pix.set(i, r + n, g + n, b + n); Hh[i] = h;
  }
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(Hh, W, H); const hg = bump.getContext('2d');
  const rnd = rng(106);
  scratches(g, rnd, 40, { x0: 30, y0: 160, x1: W - 30, y1: H - 30, len: [8, 70], angle: 0.1, spread: 1.4, light: [205, 200, 188], alpha: [0.12, 0.4], hg });
  scratches(g, rnd, 14, { x0: 30, y0: 30, x1: W - 30, y1: 200, len: [5, 30], light: [205, 200, 188], alpha: [0.1, 0.3], hg });
  // 手印、污漬
  for (let i = 0; i < 7; i++) {
    const x = 60 + rnd() * (W - 120), y = H * 0.55 + rnd() * H * 0.35;
    const rg = g.createRadialGradient(x, y, 0, x, y, 30);
    rg.addColorStop(0, 'rgba(40,34,28,0.08)'); rg.addColorStop(1, 'rgba(40,34,28,0)');
    g.fillStyle = rg; g.beginPath(); g.ellipse(x, y, 30, 20, rnd(), 0, TAU); g.fill();
  }
  for (const [x, y] of [[22, 22], [W - 22, 22], [22, H - 22], [W - 22, H - 22]]) screw(g, x, y, 7, { rot: rnd() * TAU, base: [150, 148, 140], hg });
  return { map: canvas, bump };
}

// -----------------------------------------------------------------------------
// 一般公家機關灰綠色烤漆（可平鋪）
// -----------------------------------------------------------------------------
export function paintedMetal() {
  const W = 512, H = 512, N = W * H;
  const mott = field(W, H, { cells: 3, octaves: 5, seed: 111 }, 4);
  const peel = field(W, H, { cells: 120, octaves: 2, seed: 112 }, 2);
  const dust = field(W, H, { cells: 6, octaves: 4, seed: 113 }, 4);
  const roll = field(W, H, { cells: 2, cellsY: 30, octaves: 3, seed: 114 }, 2);
  const gr = grain(W, H, 115);
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const k = (0.9 + 0.16 * mott[i]) * (0.985 + 0.03 * peel[i]) * (0.98 + 0.04 * roll[i]);
    let r = 100 * k, g = 116 * k, b = 106 * k;
    const d = 0.16 * smooth(0.4, 1, dust[i]);
    r += (150 - r) * d; g += (152 - g) * d; b += (146 - b) * d;
    const n = (gr[i] - 0.5) * 5;
    pix.set(i, r + n, g + n, b + n);
    Hh[i] = 0.6 + 0.06 * (peel[i] - 0.5);
  }
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(Hh, W, H); const hg = bump.getContext('2d');
  const rnd = rng(116);
  // 掉漆（露出深色底漆/鏽）
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W, y = rnd() * H, R = 1.5 + Math.pow(rnd(), 2) * 9;
    const pts = []; const m = 7 + (rnd() * 5 | 0);
    for (let j = 0; j < m; j++) { const a = (j / m) * TAU; const rr = R * (0.55 + rnd() * 0.6); pts.push([Math.cos(a) * rr, Math.sin(a) * rr]); }
    const rusty = rnd() < 0.4;
    wrapDraw(W, H, x, y, R * 2, (xx, yy) => {
      const path = (c) => { c.beginPath(); pts.forEach(([px, py], j) => (j ? c.lineTo(xx + px, yy + py) : c.moveTo(xx + px, yy + py))); c.closePath(); };
      g.save(); g.translate(0.8, 0.8); path(g); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fill(); g.restore();
      path(g); g.fillStyle = rusty ? 'rgb(96,56,32)' : 'rgb(58,56,52)'; g.fill();
      path(hg); hg.fillStyle = 'rgb(110,110,110)'; hg.fill();
      if (rusty && rnd() < 0.6) drip(g, xx, yy + R * 0.5, 10 + rnd() * 40, R * 0.7, [110, 60, 30], 0.22, rnd, 1);
    });
  }
  scratches(g, rnd, 50, { x0: 10, y0: 10, x1: W - 10, y1: H - 10, len: [6, 50], light: [170, 176, 168], alpha: [0.1, 0.35], hg });
  return { map: canvas, bump };
}

// -----------------------------------------------------------------------------
// 防爆門門扇（512×704，對應 1.7 m × 2.3 m 的門面，UV 0..1 只貼一次）
// 周框＋三道橫向加強肋（鉚釘列）、近底部黃黑警示帶、噴漆「防爆門」「B區」、刮痕與鏽。
// -----------------------------------------------------------------------------
// 版面（像素，canvas y 向下）：供 ControlRoom 對齊把手/門縫等幾何
export const STEEL_DOOR_LAYOUT = { w: 512, h: 704, frame: 34, ribs: [180, 350, 520], ribHalf: 11, band: [592, 640] };
export function steelDoor() {
  const W = 512, H = 704, N = W * H;
  const F = 34;                    // 周框寬
  const ribs = [180, 350, 520];    // 加強肋中心 y
  const RH = 11;                   // 加強肋半高
  const band = [592, 640];         // 警示帶
  const mott = field(W, H, { cells: 3, octaves: 5, seed: 121 }, 4);
  const peel = field(W, H, { cells: 100, cellsY: 138, octaves: 2, seed: 122 }, 2);
  const wearN = field(W, H, { cells: 14, octaves: 5, seed: 123 }, 2);
  const grime = field(W, H, { cells: 4, octaves: 5, seed: 124 }, 4);
  const gr = grain(W, H, 125);
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let y = 0; y < H; y++) {
    let ribD = 99; for (const ry of ribs) ribD = Math.min(ribD, Math.abs(y - ry));
    const bottom0 = y;
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const inFrame = x < F || x > W - 1 - F || y < F || y > H - 1 - F;
      const inRib = !inFrame && ribD < RH;
      const raised = inFrame || inRib;
      const k = (0.88 + 0.18 * mott[i]) * (0.98 + 0.04 * peel[i]);
      let r = 63 * k, g = 73 * k, b = 69 * k;
      let h = raised ? 0.85 : 0.5;
      // 警示帶
      if (!inFrame && y >= band[0] && y < band[1] && x >= F + 6 && x < W - F - 6) {
        const s = (x + y) % 64;
        const e = Math.min(s, Math.abs(s - 32), 64 - s) / Math.SQRT2;
        const aa = smooth(0, 1.2, e);
        const yel = s < 32 ? aa : 1 - aa;
        r = 30 + (214 * k - 30) * yel; g = 29 + (168 * k - 29) * yel; b = 27 + (36 * k - 27) * yel;
        const gm = 0.25 * smooth(0.4, 0.9, grime[i]);
        r += (92 - r) * gm; g += (84 - g) * gm; b += (64 - b) * gm;
        h = 0.56;
      }
      // 凸起部位邊緣掉漆
      if (raised) {
        let edgeD = Math.min(x, y, W - 1 - x, H - 1 - y);
        if (inFrame) edgeD = Math.min(edgeD, Math.abs(x - F), Math.abs(x - (W - 1 - F)), Math.abs(y - F), Math.abs(y - (H - 1 - F)));
        if (inRib) edgeD = Math.min(edgeD, RH - ribD);
        const chip = smooth(9, 1, edgeD) * smooth(0.52, 0.58, wearN[i]);
        if (chip > 0) {
          const sv = 0.8 + 0.35 * peel[i];
          r += (112 * sv - r) * chip; g += (113 * sv - g) * chip; b += (108 * sv - b) * chip;
          h -= 0.08 * chip;
        }
      }
      // 下緣污垢與鏽
      const bt = 0.55 * smooth(H - 110, H, bottom0 + (grime[i] - 0.5) * 50);
      r += (46 - r) * bt; g += (36 - g) * bt; b += (26 - b) * bt;
      const rs = 0.5 * smooth(H - 40, H, bottom0 + (wearN[i] - 0.5) * 30) * smooth(0.4, 0.7, wearN[i]);
      r += (98 - r) * rs; g += (52 - g) * rs; b += (26 - b) * rs;
      const gk = 1 - 0.12 * smooth(0.6, 0.95, grime[i]);
      const n = (gr[i] - 0.5) * 7;
      pix.set(i, r * gk + n, g * gk + n, b * gk + n); Hh[i] = h;
    }
  }
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(Hh, W, H); const hg = bump.getContext('2d');
  const rnd = rng(126);
  // 凸起部位的倒角光影（光從上方來）
  const hl = (x, y, w, h2) => { g.fillStyle = 'rgba(255,255,245,0.16)'; g.fillRect(x, y, w, h2); };
  const sh = (x, y, w, h2, a = 0.42) => { g.fillStyle = `rgba(0,0,0,${a})`; g.fillRect(x, y, w, h2); };
  hl(0, 0, W, 2); hl(0, 0, 2, H); sh(W - 2, 0, 2, H, 0.35); sh(0, H - 2, W, 2, 0.35);
  sh(F, F, W - 2 * F, 5, 0.38); sh(F, F, 3, H - 2 * F, 0.22); hl(W - F - 2, F, 2, H - 2 * F); hl(F, H - F - 2, W - 2 * F, 2);
  for (const ry of ribs) { hl(F, ry - RH, W - 2 * F, 2); sh(F, ry + RH, W - 2 * F, 5, 0.38); sh(F, ry + RH - 1, W - 2 * F, 1, 0.3); }
  // 鉚釘
  const rv = (x, y) => rivet(g, x, y, 5.2, { base: [70, 80, 76], hg, rust: rnd() < 0.3 ? 0.8 : 0.15, rnd });
  for (let x = F / 2; x <= W - F / 2 + 1; x += (W - F) / 14) { rv(x, F / 2); rv(x, H - F / 2); }
  for (let y = F / 2 + (H - F) / 19; y < H - F; y += (H - F) / 19) { rv(F / 2, y); rv(W - F / 2, y); }
  for (const ry of ribs) for (let x = F + 22; x < W - F - 10; x += 32) rv(x, ry);
  // 刮痕（中段較多，大致水平，推車/工具留下）
  scratches(g, rnd, 90, { x0: F, y0: 230, x1: W - F, y1: 560, len: [10, 110], angle: 0, spread: 0.5, light: [140, 144, 136], alpha: [0.12, 0.42], hg });
  scratches(g, rnd, 30, { x0: F, y0: F, x1: W - F, y1: H - F, len: [6, 40], light: [140, 144, 136], alpha: [0.1, 0.3] });
  for (let i = 0; i < 5; i++) { // 深刮痕帶鏽
    const x = F + 20 + rnd() * (W - 2 * F - 140), y = 380 + rnd() * 180, L = 40 + rnd() * 90;
    g.strokeStyle = 'rgba(25,22,20,0.6)'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(x, y); g.lineTo(x + L, y + (rnd() - 0.5) * 10); g.stroke();
    g.strokeStyle = 'rgba(120,64,30,0.45)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y + 1); g.lineTo(x + L, y + 1); g.stroke();
    drip(g, x + L * 0.5, y + 2, 15 + rnd() * 40, 2.5, [105, 55, 28], 0.25, rnd, 1);
  }
  // 噴漆模板字
  const white = stencilLayer(W, H, (mg) => {
    mg.textAlign = 'center'; mg.textBaseline = 'middle';
    mg.font = `900 104px ${FONTS.stencil}`;
    if ('letterSpacing' in mg) mg.letterSpacing = '14px';
    mg.fillText('防爆門', W / 2 + 7, 262);
    if ('letterSpacing' in mg) mg.letterSpacing = '9px';
    mg.font = `700 26px ${FONTS.stencil}`;
    mg.fillText('BLAST DOOR', W / 2 + 4, 318);
  }, { color: [218, 214, 200], alpha: 0.88, seed: 127, wear: 0.45 });
  g.drawImage(white, 0, 0);
  const yellow = stencilLayer(W, H, (mg) => {
    mg.textAlign = 'center'; mg.textBaseline = 'middle';
    mg.lineWidth = 7;
    mg.strokeRect(W / 2 - 92, 392, 184, 92);
    mg.font = `900 66px ${FONTS.stencil}`;
    mg.fillText('B區', W / 2, 440);
    mg.font = `700 22px ${FONTS.stencil}`;
    if ('letterSpacing' in mg) mg.letterSpacing = '6px';
    mg.fillText('公務維修廊道', W / 2 + 3, 503);
  }, { color: [226, 186, 58], alpha: 0.85, seed: 128, wear: 0.5 });
  g.drawImage(yellow, 0, 0);
  const L = STEEL_DOOR_LAYOUT;
  return {
    map: canvas, bump,
    layout: { aspect: W / H, frameU: L.frame / W, frameV: L.frame / H, ribsV: L.ribs.map((y) => 1 - y / H), hazardV: [1 - L.band[1] / H, 1 - L.band[0] / H] },
  };
}

// -----------------------------------------------------------------------------
// 黃黑斜紋警示（可平鋪、磨損）
// -----------------------------------------------------------------------------
export function hazard() {
  const W = 256, H = 256, N = W * H, P = 64;
  const wearN = field(W, H, { cells: 30, octaves: 3, seed: 131 }, 1);
  const dirt = field(W, H, { cells: 4, octaves: 5, seed: 132 }, 2);
  const mott = field(W, H, { cells: 6, octaves: 3, seed: 133 }, 2);
  const gr = grain(W, H, 134);
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const s = (x + y) % P;
    const e = Math.min(Math.abs(s - P / 2), s, P - s) / Math.SQRT2;
    const aa = smooth(0, 1.0, e);
    const yel = s < P / 2 ? aa : 1 - aa;
    const k = 0.9 + 0.15 * mott[i];
    let r = 30 * k + (196 * k) * yel, g = 29 * k + (147 * k) * yel, b = 27 * k + (7 * k) * yel;
    // 掉漆：小塊、偏向斜紋邊緣與髒污處
    const chip = smooth(0.8, 0.83, wearN[i] + 0.1 * (1 - smooth(0, 3, e)) + 0.06 * dirt[i]);
    const sv = 0.85 + 0.3 * gr[i];
    r += (104 * sv - r) * chip; g += (104 * sv - g) * chip; b += (100 * sv - b) * chip;
    const dd = 0.35 * smooth(0.45, 0.95, dirt[i]);
    r += (70 - r) * dd; g += (60 - g) * dd; b += (44 - b) * dd;
    const n = (gr[i] - 0.5) * 8;
    pix.set(i, r + n, g + n, b + n);
    Hh[i] = 0.6 - 0.12 * chip;
  }
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(Hh, W, H);
  scratches(g, rng(135), 40, { x0: 4, y0: 4, x1: W - 4, y1: H - 4, len: [4, 30], width: [0.5, 1], light: [150, 148, 140], alpha: [0.12, 0.4], hg: bump.getContext('2d') });
  return { map: canvas, bump };
}

// -----------------------------------------------------------------------------
// 鏽蝕鋼板
// -----------------------------------------------------------------------------
export function rust() {
  const W = 256, H = 256, N = W * H;
  const wl = worley(W, H, { cells: 16, seed: 141 });
  const m1 = field(W, H, { cells: 5, octaves: 5, seed: 142 }, 1);
  const m2 = field(W, H, { cells: 12, octaves: 4, seed: 143 }, 1);
  const fine = field(W, H, { cells: 90, octaves: 2, seed: 144 }, 1);
  const gr = grain(W, H, 145);
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, j = i;
    const crack = smooth(0.06, 0.0, wl.f2[j] - wl.f1[j]);
    const plate = 1 - clamp(wl.f1[j] / 0.75);
    const t1 = smooth(0.25, 0.75, m1[i]);
    let r = 64 + 62 * t1, g = 34 + 30 * t1, b = 20 + 10 * t1;
    const t2 = smooth(0.62, 0.9, m2[i]) * 0.8;
    r += (172 - r) * t2; g += (98 - g) * t2; b += (46 - b) * t2;
    const fk = 0.85 + 0.3 * fine[i]; r *= fk; g *= fk; b *= fk;
    const keep = smooth(0.78, 0.82, m1[i] * 0.6 + m2[i] * 0.5) * 0.85; // 殘留的舊漆
    r += (88 - r) * keep; g += (96 - g) * keep; b += (90 - b) * keep;
    const ck = crack * 0.8;
    r += (30 - r) * ck; g += (18 - g) * ck; b += (12 - b) * ck;
    const pit = gr[i] < 0.015 ? 0.6 : 0;
    const n = (gr[i] - 0.5) * 12;
    pix.set(i, r * (1 - pit) + n, g * (1 - pit) + n, b * (1 - pit) + n);
    Hh[i] = 0.45 + 0.25 * plate + 0.15 * (fine[i] - 0.5) - 0.25 * crack - 0.3 * pit + 0.1 * keep;
  }
  const { canvas } = pix.toCanvas();
  return { map: canvas, bump: fieldToCanvas(Hh, W, H) };
}

// -----------------------------------------------------------------------------
// 排水溝格柵（RGBA：孔為透明）。承載扁鋼沿 V，橫向連接桿沿 U。
// -----------------------------------------------------------------------------
export function grate() {
  const W = 256, H = 256, N = W * H;
  const mott = field(W, H, { cells: 4, octaves: 4, seed: 151 }, 2);
  const rustN = field(W, H, { cells: 8, octaves: 4, seed: 152 }, 2);
  const gr = grain(W, H, 153);
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  const BX = 32, BW = 7, CY = 64, CW = 6;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const bx = x % BX, cy = y % CY;
    const isBar = bx < BW, isCross = cy < CW;
    if (!isBar && !isCross) { pix.set(i, 60, 58, 54, 0); Hh[i] = 0; continue; }
    let prof;
    if (isBar) prof = 0.7 + 0.45 * Math.sin(((bx + 0.5) / BW) * Math.PI);
    else prof = 0.6 + 0.35 * Math.sin(((cy + 0.5) / CW) * Math.PI);
    if (isBar && isCross) prof = Math.max(prof, 0.95);
    const k = prof * (0.8 + 0.35 * mott[i]);
    let r = 98 * k, g = 101 * k, b = 99 * k;
    const rt = 0.75 * smooth(0.58, 0.8, rustN[i]);
    r += (104 - r) * rt; g += (58 - g) * rt; b += (30 - b) * rt;
    const dt = 0.4 * smooth(0.3, 0.0, rustN[i]);
    r += (30 - r) * dt; g += (28 - g) * dt; b += (24 - b) * dt;
    const n = (gr[i] - 0.5) * 14;
    pix.set(i, r + n, g + n, b + n, 255);
    Hh[i] = prof * 0.8;
  }
  return { map: pix.toCanvas().canvas, bump: fieldToCanvas(Hh, W, H) };
}

// -----------------------------------------------------------------------------
// 老舊塑膠（CRT 外殼：米灰色細顆粒咬花、泛黃；plasticBeige：較光滑的米色）
// -----------------------------------------------------------------------------
export function plastic({ bezel = true } = {}) {
  const W = 256, H = 256, N = W * H;
  const seed = bezel ? 161 : 171;
  const yell = field(W, H, { cells: 3, octaves: 4, seed }, 2);
  const stip = field(W, H, { cells: bezel ? 64 : 48, octaves: 2, seed: seed + 1 }, 1);
  const grime = field(W, H, { cells: 4, octaves: 5, seed: seed + 2 }, 2);
  const gr = grain(W, H, seed + 3);
  const base = bezel ? [176, 170, 154] : [198, 188, 164];
  const yl = bezel ? [182, 168, 128] : [204, 186, 138];
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = 0.55 * smooth(0.35, 0.9, yell[i]);
    const tex = bezel ? (stip[i] - 0.5) * 0.08 + (gr[i] - 0.5) * 0.06 : (stip[i] - 0.5) * 0.03 + (gr[i] - 0.5) * 0.025;
    const k = (1 + tex) * (1 - 0.14 * smooth(0.55, 0.95, grime[i]));
    pix.set(i, (base[0] + (yl[0] - base[0]) * t) * k, (base[1] + (yl[1] - base[1]) * t) * k, (base[2] + (yl[2] - base[2]) * t) * k);
    Hh[i] = 0.5 + (bezel ? 0.35 : 0.12) * (stip[i] - 0.5) + (bezel ? 0.2 : 0.06) * (gr[i] - 0.5);
  }
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(Hh, W, H);
  scratches(g, rng(seed + 4), bezel ? 16 : 10, { x0: 8, y0: 8, x1: W - 8, y1: H - 8, len: [4, 26], light: [222, 216, 200], alpha: [0.1, 0.3], width: [0.5, 1] });
  return { map: canvas, bump };
}

// -----------------------------------------------------------------------------
// 管線（U 繞圓周、V 沿管長）：淺灰烤漆＋褪色紅色識別帶與流向箭頭
// -----------------------------------------------------------------------------
export function pipe() {
  const W = 256, H = 512, N = W * H;
  const mott = field(W, H, { cells: 3, octaves: 5, seed: 181 }, 2);
  const fade = field(W, H, { cells: 10, octaves: 4, seed: 182 }, 2);
  const dirt = field(W, H, { cells: 4, octaves: 5, seed: 183 }, 2);
  const gr = grain(W, H, 184);
  const band = [0.42 * H, 0.58 * H];
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const k = 0.9 + 0.16 * mott[i];
    let r = 152 * k, g = 155 * k, b = 148 * k;
    if (y >= band[0] && y < band[1]) { // 褪色、粉化的紅色識別帶
      const f = 0.35 * smooth(0.3, 0.9, fade[i]) + 0.1;
      r = 152 * k + (176 - 152 * k) * f; g = 64 * k + (150 - 64 * k) * f; b = 54 * k + (140 - 54 * k) * f;
    }
    const dt = 0.35 * smooth(0.5, 0.95, dirt[i]);
    r += (62 - r) * dt; g += (54 - g) * dt; b += (44 - b) * dt;
    const joint = y < 7 || y > H - 7;
    if (joint) { const m = y < 2 || y > H - 3 ? 0.55 : 0.85; r *= m; g *= m; b *= m; }
    const n = (gr[i] - 0.5) * 7;
    pix.set(i, r + n, g + n, b + n);
    Hh[i] = joint ? (y < 2 || y > H - 3 ? 0.3 : 0.75) : 0.55 + 0.04 * (gr[i] - 0.5);
  }
  const { canvas, g } = pix.toCanvas();
  const bump = fieldToCanvas(Hh, W, H);
  // 流向箭頭（白色噴漆，沿 V）
  const arrow = stencilLayer(W, H, (mg) => {
    for (const cx of [W * 0.25, W * 0.75]) {
      mg.beginPath();
      const y0 = band[0] + 12, y1 = band[1] - 12, s = 18;
      mg.moveTo(cx - s * 0.45, y1); mg.lineTo(cx - s * 0.45, y0 + s * 1.3); mg.lineTo(cx - s, y0 + s * 1.3);
      mg.lineTo(cx, y0); mg.lineTo(cx + s, y0 + s * 1.3); mg.lineTo(cx + s * 0.45, y0 + s * 1.3); mg.lineTo(cx + s * 0.45, y1); mg.closePath(); mg.fill();
    }
  }, { color: [226, 222, 210], alpha: 0.7, seed: 185, wear: 0.4 });
  g.drawImage(arrow, 0, 0);
  const rnd = rng(186);
  for (let i = 0; i < 30; i++) {
    const x = rnd() * W, y = rnd() * H, r = 0.8 + rnd() * 3;
    g.fillStyle = `rgba(${100 + rnd() * 30},${52 + rnd() * 16},${26},${0.3 + rnd() * 0.4})`;
    g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  }
  return { map: canvas, bump };
}

// -----------------------------------------------------------------------------
// 防疲勞橡膠墊（圓點凸紋）
// -----------------------------------------------------------------------------
export function rubberMat() {
  const W = 256, H = 256, N = W * H, S = 32, R = 9;
  const dust = field(W, H, { cells: 4, octaves: 5, seed: 191 }, 2);
  const gr = grain(W, H, 192);
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const row = Math.round(y / S); const off = (row % 2) * (S / 2);
    const cxp = Math.round((x - off) / S) * S + off, cyp = row * S;
    const d = hyp(x - cxp, y - cyp);
    const coin = 1 - smooth(R - 1.2, R + 0.6, d);
    const rimT = (d - R + 1) / 1.1, rim = rimT > -3 && rimT < 3 ? Math.exp(-rimT * rimT) : 0;
    const ny = (y - cyp) / R;
    let v = 34 + coin * (8 - ny * 6) + rim * (ny < 0 ? 12 : -6);
    const du = smooth(0.4, 0.9, dust[i]) * (1 - coin) * 0.45;
    const n = (gr[i] - 0.5) * 8;
    pix.set(i, v + (96 - v) * du + n, v + (92 - v) * du + n, v + 1 + (86 - v) * du + n);
    Hh[i] = 0.25 + 0.6 * coin;
  }
  return { map: pix.toCanvas().canvas, bump: fieldToCanvas(Hh, W, H) };
}

// -----------------------------------------------------------------------------
// 辦公椅布料（深藍灰編織、起毛球、污漬）
// -----------------------------------------------------------------------------
export function fabricSeat() {
  const W = 256, H = 256, N = W * H, P = 4;
  const heather = field(W, H, { cells: 32, octaves: 2, seed: 201 }, 1);
  const stain = field(W, H, { cells: 3, octaves: 5, seed: 202 }, 2);
  const gr = grain(W, H, 203);
  const pix = new Pix(W, H); const Hh = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const cx = (x / P) | 0, cy = (y / P) | 0;
    const fx = (x % P + 0.5) / P, fy = (y % P + 0.5) / P;
    const over = (cx + cy) & 1;
    const prof = over ? Math.sin(fy * Math.PI) : Math.sin(fx * Math.PI);
    const thread = over ? hash3(cx, 0, 7) : hash3(0, cy, 9);
    const k = (0.62 + 0.42 * prof) * (0.9 + 0.2 * thread) * (0.92 + 0.16 * heather[i]) * (1 - 0.25 * smooth(0.62, 0.85, stain[i]));
    const n = (gr[i] - 0.5) * 6;
    pix.set(i, 50 * k + n, 56 * k + n, 70 * k + n);
    Hh[i] = 0.3 + 0.5 * prof;
  }
  const { canvas, g } = pix.toCanvas();
  const rnd = rng(204);
  for (let i = 0; i < 220; i++) { // 毛球
    const x = rnd() * W, y = rnd() * H;
    g.fillStyle = `rgba(${110 + rnd() * 40},${114 + rnd() * 40},${128 + rnd() * 40},${0.15 + rnd() * 0.3})`;
    g.beginPath(); g.arc(x, y, 0.6 + rnd() * 1.3, 0, TAU); g.fill();
  }
  return { map: canvas, bump: fieldToCanvas(Hh, W, H) };
}

// -----------------------------------------------------------------------------
// 警方封鎖線（1024×64，U 沿膠帶方向平鋪）：「警戒線 請勿越過 POLICE LINE」
// -----------------------------------------------------------------------------
export function policeTape() {
  const W = 1024, H = 64;
  const { canvas, g } = mkCanvas(W, H);
  g.fillStyle = 'rgb(236,200,44)'; g.fillRect(0, 0, W, H);
  const text = '警戒線　請勿越過　POLICE LINE';
  g.font = `900 34px ${FONTS.ui}`;
  const tw = g.measureText(text).width;
  const stripeW = 74;
  const count = Math.max(1, Math.floor(W / (tw + stripeW + 40)));
  const unit = W / count;
  for (let k = 0; k < count; k++) {
    const x0 = k * unit;
    // 斜紋分隔塊
    g.save(); g.beginPath(); g.rect(x0, 6, stripeW, H - 12); g.clip();
    g.fillStyle = 'rgb(22,20,18)';
    for (let s = -H; s < stripeW + H; s += 18) { g.beginPath(); g.moveTo(x0 + s, 6); g.lineTo(x0 + s + 9, 6); g.lineTo(x0 + s + 9 - (H - 12), H - 6); g.lineTo(x0 + s - (H - 12), H - 6); g.closePath(); g.fill(); }
    g.restore();
    const cx = x0 + stripeW + (unit - stripeW) / 2;
    g.save(); g.translate(cx, H / 2 + 1);
    const sx = Math.min(1, (unit - stripeW - 24) / tw);
    g.scale(sx, 1);
    g.fillStyle = 'rgb(20,18,16)'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 0, 0);
    g.restore();
  }
  // 上下緣的黑邊
  g.fillStyle = 'rgb(28,26,22)'; g.fillRect(0, 0, W, 4); g.fillRect(0, H - 4, W, 4);
  // 褪色、皺摺、髒污、煙燻
  const img = g.getImageData(0, 0, W, H); const d = img.data;
  const fade = field(W, H, { cells: 16, cellsY: 1, octaves: 4, seed: 211 }, 2);
  const soot = field(W, H, { cells: 8, cellsY: 1, octaves: 5, seed: 212 }, 2);
  const gr = grain(W, H, 213);
  const rnd = rng(214);
  // 皺摺：預先算成每欄（含斜率）的明暗偏移表
  const crease = new Float32Array(W * 2);
  for (let c = 0; c < 14; c++) {
    const cx = rnd() * W, w = 0.5 + rnd() * 2.5, sgn = rnd() < 0.5 ? -1 : 1;
    for (let x = Math.max(0, Math.floor(cx - 30)); x < Math.min(W * 2, cx + 30); x++) { const dx = x - cx; crease[x] += sgn * Math.exp(-(dx * dx) / (w * w)) * (dx > 0 ? 1 : -1); }
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, p = i * 4;
    let r = d[p], gg = d[p + 1], b = d[p + 2];
    const f = (0.15 + 0.25 * fade[i]) * 0.5;
    r += (232 - r) * f; gg += (222 - gg) * f; b += (180 - b) * f;
    const cx = Math.max(0, Math.min(W * 2 - 1, Math.round(x - (y - H / 2) * 0.3)));
    const sk = 1 + crease[cx] * 0.08 - 0.45 * smooth(0.55, 0.95, soot[i]);
    const n = (gr[i] - 0.5) * 16;
    d[p] = r * sk + n; d[p + 1] = gg * sk + n; d[p + 2] = b * sk + n;
  }
  g.putImageData(img, 0, 0);
  return { map: canvas };
}
