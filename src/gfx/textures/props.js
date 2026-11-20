// =============================================================================
// LED 七段電子鐘、標籤、標誌牌、設備面板圖（向量繪製為主）。
// =============================================================================
import { FONTS } from '../canvasUtil.js';
import {
  rng, clamp, TAU, mkCanvas, smooth, field, grain, Pix, rgba, rivet, screw, scratches, stencilLayer,
  drawFitted, roundRect, hyp,
} from './core.js';

// -----------------------------------------------------------------------------
// LED 七段電子鐘（512×180）
// -----------------------------------------------------------------------------
const SEGMAP = {
  0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
  '-': 'g', ' ': '', '_': 'd', E: 'adefg', r: 'eg', o: 'cdeg',
};
const DIGIT_X = [30, 136, 292, 398];
const DW = 84, DH = 134, DT = 16, DGAP = 2.4, SLANT = 0.085, DY = 23;

function segPolys(x, y) {
  const T = DT, g = DGAP, w = DW, h = DH;
  const x0 = x + T / 2, x1 = x + w - T / 2, y0 = y + T / 2, ym = y + h / 2, y1 = y + h - T / 2;
  const hz = (xa, xb, yc) => [[xa + g, yc], [xa + T / 2 + g, yc - T / 2], [xb - T / 2 - g, yc - T / 2], [xb - g, yc], [xb - T / 2 - g, yc + T / 2], [xa + T / 2 + g, yc + T / 2]];
  const vt = (xc, ya, yb) => [[xc, ya + g], [xc + T / 2, ya + T / 2 + g], [xc + T / 2, yb - T / 2 - g], [xc, yb - g], [xc - T / 2, yb - T / 2 - g], [xc - T / 2, ya + T / 2 + g]];
  const cy = y + h / 2;
  const sl = (pts) => pts.map(([px, py]) => [px + (cy - py) * SLANT, py]);
  return {
    a: sl(hz(x0, x1, y0)), b: sl(vt(x1, y0, ym)), c: sl(vt(x1, ym, y1)), d: sl(hz(x0, x1, y1)),
    e: sl(vt(x0, ym, y1)), f: sl(vt(x0, y0, ym)), g: sl(hz(x0, x1, ym)),
  };
}
const ALL_SEGS = DIGIT_X.map((x) => segPolys(x, DY));
const polyPath = (g, pts, inset = 0) => {
  let cx = 0, cy = 0; for (const [x, y] of pts) { cx += x; cy += y; } cx /= pts.length; cy /= pts.length;
  g.beginPath();
  pts.forEach(([x, y], i) => { const px = x + (cx - x) * inset, py = y + (cy - y) * inset; if (i) g.lineTo(px, py); else g.moveTo(px, py); });
  g.closePath();
};
const COLON = [[256 + (DH * 0.5 - DH * 0.31) * SLANT, DY + DH * 0.31], [256 - (DH * 0.69 - DH * 0.5) * SLANT, DY + DH * 0.69]];

function clockBackground(W, H) {
  const { canvas, g } = mkCanvas(W, H);
  const n = field(W, H, { cells: 8, octaves: 3, seed: 311 }, 2), gr = grain(W, H, 312);
  const pix = new Pix(W, H);
  for (let i = 0; i < W * H; i++) { const v = 4 + 4 * n[i] + gr[i] * 2.5; pix.set(i, v * 1.25, v * 0.55, v * 0.5); }
  pix.putTo(g);
  // 未點亮的殘影段（煙燻壓克力後面看得見的暗紅段）
  g.fillStyle = 'rgb(38,7,6)';
  for (const d of ALL_SEGS) for (const k of 'abcdefg') { polyPath(g, d[k]); g.fill(); }
  for (const [x, y] of COLON) { g.beginPath(); g.arc(x, y, 7.5, 0, TAU); g.fill(); }
  return canvas;
}

export function makeLedClock() {
  const W = 512, H = 180;
  const { canvas, g } = mkCanvas(W, H, false);
  const bg = clockBackground(W, H);
  const st = { text: '02:00', colon: true, dim: 0, key: '' };
  const segBright = (di, k) => 0.93 + 0.07 * ((di * 7 + k.charCodeAt(0)) * 0.6180339 % 1);
  const draw = () => {
    const key = `${st.text}|${st.colon}|${st.dim.toFixed(3)}`;
    if (key === st.key) return false;
    st.key = key;
    g.globalCompositeOperation = 'source-over';
    g.shadowBlur = 0;
    g.drawImage(bg, 0, 0);
    const b = 1 - 0.94 * clamp(st.dim);
    const digits = String(st.text).replace(':', '').padStart(4, ' ').slice(-4).split('');
    const lit = [];
    digits.forEach((ch, di) => { for (const k of SEGMAP[ch] ?? '') lit.push([ALL_SEGS[di][k], segBright(di, k)]); });
    const dots = st.colon ? COLON : [];
    if (b > 0.002) {
      // 1) 柔光（加法混合的模糊外暈）
      g.globalCompositeOperation = 'lighter';
      g.shadowColor = `rgba(255,24,8,${0.75 * b})`; g.shadowBlur = 26;
      g.fillStyle = `rgba(150,10,4,${0.55 * b})`;
      for (const [p] of lit) { polyPath(g, p); g.fill(); }
      for (const [x, y] of dots) { g.beginPath(); g.arc(x, y, 7.5, 0, TAU); g.fill(); }
      g.shadowBlur = 0;
      g.globalCompositeOperation = 'source-over';
      // 2) 發光段本體
      for (const [p, s] of lit) { g.fillStyle = `rgb(${255 * b * s},${34 * b * s},${18 * b * s})`; polyPath(g, p); g.fill(); }
      for (const [x, y] of dots) { g.fillStyle = `rgb(${255 * b},${34 * b},${18 * b})`; g.beginPath(); g.arc(x, y, 7.5, 0, TAU); g.fill(); }
      // 3) 熱點（段中央較亮偏橘）
      for (const [p] of lit) { g.fillStyle = `rgba(255,${120 * b + 20},${90 * b},${0.55 * b})`; polyPath(g, p, 0.55); g.fill(); }
      for (const [x, y] of dots) { g.fillStyle = `rgba(255,140,110,${0.55 * b})`; g.beginPath(); g.arc(x, y, 3.5, 0, TAU); g.fill(); }
    }
    // 表面的壓克力反光（極淡、固定）
    const sheen = g.createLinearGradient(0, 0, W * 0.6, H);
    sheen.addColorStop(0, 'rgba(255,255,255,0.035)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.fillStyle = sheen; g.fillRect(0, 0, W, H);
    return true;
  };
  draw();
  return {
    canvas, draw,
    setText(t) { st.text = (t == null ? '--:--' : String(t)); return draw(); },
    setColonVisible(on) { st.colon = !!on; return draw(); },
    setDim(v) { st.dim = Math.round(clamp(Number(v) || 0) * 400) / 400; return draw(); },
    get state() { return { ...st }; },
  };
}

// -----------------------------------------------------------------------------
// 小標籤
// -----------------------------------------------------------------------------
export function drawLabel(text, { w = 256, h = 64, bg = '#1c1c1c', fg = '#d8d8d8', size = 30, font = FONTS.ui, align = 'center', border = null, weight = '600' } = {}) {
  const { canvas, g } = mkCanvas(w, h, false);
  const opaque = bg && bg !== 'transparent' && bg !== 'none';
  if (opaque) {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    // 輕微磨損：雜點、邊緣變暗、細刮痕
    const rnd = rng((w * 31 + h * 17 + String(text).length * 7) >>> 0);
    for (let i = 0; i < (w * h) / 60; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${0.02 + rnd() * 0.04})`; g.fillRect(rnd() * w, rnd() * h, 1, 1); }
    const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.18)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
  }
  if (border) {
    const bw = Math.max(2, Math.round(Math.min(w, h) * 0.05));
    g.strokeStyle = border; g.lineWidth = bw; g.strokeRect(bw * 1.5, bw * 1.5, w - bw * 3, h - bw * 3);
  }
  const lines = String(text).split('\n');
  const pad = Math.max(6, Math.round(h * 0.12)) + (border ? Math.min(w, h) * 0.08 : 0);
  let s = size;
  const lh = () => s * 1.18;
  while (lines.length * lh() > h - pad && s > 8) s -= 1;
  const top = h / 2 - (lines.length * lh()) / 2 + lh() / 2;
  lines.forEach((ln, i) => {
    const x = align === 'left' ? pad : align === 'right' ? w - pad : w / 2;
    drawFitted(g, ln, x, top + i * lh() + s * 0.04, w - pad * 2, { size: s, font, weight, color: fg, align });
  });
  return canvas;
}

// -----------------------------------------------------------------------------
// 標誌牌
// -----------------------------------------------------------------------------
function runningMan(g, x, y, s, color) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.strokeStyle = color; g.fillStyle = color; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 0.11;
  g.beginPath(); g.arc(0.62, 0.13, 0.095, 0, TAU); g.fill();
  const seg = (pts) => { g.beginPath(); pts.forEach(([a, b], i) => (i ? g.lineTo(a, b) : g.moveTo(a, b))); g.stroke(); };
  seg([[0.56, 0.3], [0.42, 0.58]]);
  seg([[0.55, 0.32], [0.72, 0.44], [0.86, 0.36]]);
  seg([[0.55, 0.32], [0.38, 0.38], [0.26, 0.3]]);
  seg([[0.42, 0.58], [0.6, 0.72], [0.6, 0.93]]);
  seg([[0.42, 0.58], [0.3, 0.76], [0.1, 0.8]]);
  g.restore();
}

function brushedMetal(g, x, y, w, h, seed, base = [168, 170, 166]) {
  const rnd = rng(seed);
  g.fillStyle = rgba(base); g.fillRect(x, y, w, h);
  for (let i = 0; i < h * 1.6; i++) {
    const yy = y + rnd() * h, v = (rnd() - 0.5) * 50;
    g.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${Math.abs(v) / 255 * 0.9})`;
    g.fillRect(x + rnd() * w * 0.3, yy, w * (0.4 + rnd() * 0.6), 1);
  }
  const lg = g.createLinearGradient(x, y, x + w, y + h);
  lg.addColorStop(0, 'rgba(255,255,255,0.12)'); lg.addColorStop(0.5, 'rgba(0,0,0,0.04)'); lg.addColorStop(1, 'rgba(255,255,255,0.08)');
  g.fillStyle = lg; g.fillRect(x, y, w, h);
}

/** 刻字（凹陷）：亮邊在右下、暗字在上 */
function engraved(g, text, x, y, maxW, { size, font = FONTS.ui, weight = '700', dark = 'rgb(28,30,30)', light = 'rgba(255,255,255,0.45)', align = 'center' } = {}) {
  drawFitted(g, text, x + 1, y + 1.2, maxW, { size, font, weight, color: light, align });
  drawFitted(g, text, x, y, maxW, { size, font, weight, color: dark, align });
}

export function drawSign(text, { sub = '', w = 512, h = 160, style = 'plate', color = null } = {}) {
  const read = style === 'stencil';
  const { canvas, g } = mkCanvas(w, h, read);
  const rnd = rng((String(text).length * 131 + w + h * 7) >>> 0);
  const main = String(text ?? ''), small = String(sub ?? '');
  if (style === 'exit') {
    const lg = g.createLinearGradient(0, 0, 0, h);
    lg.addColorStop(0, '#16934a'); lg.addColorStop(1, '#0c6e34');
    g.fillStyle = lg; g.fillRect(0, 0, w, h);
    // 燈箱內部不均勻的光
    const rg = g.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.5, w * 0.6);
    rg.addColorStop(0, 'rgba(180,255,200,0.16)'); rg.addColorStop(1, 'rgba(0,30,10,0.25)');
    g.fillStyle = rg; g.fillRect(0, 0, w, h);
    const m = h * 0.1;
    g.strokeStyle = 'rgba(235,255,240,0.9)'; g.lineWidth = Math.max(2, h * 0.025); g.strokeRect(m * 0.5, m * 0.5, w - m, h - m);
    const s = h * 0.78;
    // 門＋奔跑的人
    g.fillStyle = 'rgba(240,255,244,0.96)';
    g.fillRect(m * 1.2, h / 2 - s * 0.45, s * 0.36, s * 0.9);
    g.fillStyle = '#0f7e3e'; g.fillRect(m * 1.2 + s * 0.06, h / 2 - s * 0.39, s * 0.24, s * 0.84);
    runningMan(g, m * 1.2 + s * 0.3, h / 2 - s * 0.45, s * 0.92, 'rgba(240,255,244,0.96)');
    const tx = m * 1.2 + s * 1.3;
    const tw = w - tx - m * 1.2;
    drawFitted(g, main, tx + tw / 2, small ? h * 0.42 : h * 0.52, tw, { size: h * (small ? 0.42 : 0.5), font: FONTS.ui, weight: '800', color: '#f2fff5' });
    if (small) drawFitted(g, small, tx + tw / 2, h * 0.76, tw, { size: h * 0.2, font: FONTS.ui, weight: '700', color: '#dff7e6' });
    // 髒污
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(20,30,20,${rnd() * 0.08})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 2 + rnd() * 10, 0, TAU); g.fill(); }
  } else if (style === 'warning') {
    g.fillStyle = '#e8b81c'; g.fillRect(0, 0, w, h);
    const bw = h * 0.07;
    g.strokeStyle = '#141414'; g.lineWidth = bw; g.strokeRect(bw, bw, w - bw * 2, h - bw * 2);
    const ts = h * 0.62, tx = h * 0.2 + ts / 2, ty = h * 0.5;
    g.fillStyle = '#141414';
    g.beginPath(); g.moveTo(tx, ty - ts * 0.5); g.lineTo(tx + ts * 0.55, ty + ts * 0.42); g.lineTo(tx - ts * 0.55, ty + ts * 0.42); g.closePath(); g.fill();
    g.fillStyle = '#e8b81c';
    g.beginPath(); g.moveTo(tx, ty - ts * 0.3); g.lineTo(tx + ts * 0.38, ty + ts * 0.32); g.lineTo(tx - ts * 0.38, ty + ts * 0.32); g.closePath(); g.fill();
    g.fillStyle = '#141414'; g.fillRect(tx - ts * 0.045, ty - ts * 0.14, ts * 0.09, ts * 0.28); g.beginPath(); g.arc(tx, ty + ts * 0.22, ts * 0.05, 0, TAU); g.fill();
    const x0 = h * 0.3 + ts, tw = w - x0 - bw * 3;
    drawFitted(g, main, x0 + tw / 2, small ? h * 0.42 : h * 0.52, tw, { size: h * (small ? 0.38 : 0.46), font: FONTS.ui, weight: '900', color: '#141414' });
    if (small) drawFitted(g, small, x0 + tw / 2, h * 0.75, tw, { size: h * 0.18, font: FONTS.ui, weight: '700', color: '#1e1e1e' });
    scratches(g, rnd, 18, { x0: 0, y0: 0, x1: w, y1: h, len: [5, 30], light: [250, 240, 200], alpha: [0.1, 0.3] });
    for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(60,40,10,${rnd() * 0.1})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 3 + rnd() * 14, 0, TAU); g.fill(); }
  } else if (style === 'stencil') {
    const c = color || [222, 220, 210];
    const layer = stencilLayer(w, h, (mg) => {
      mg.textAlign = 'center'; mg.textBaseline = 'middle';
      const ms = small ? h * 0.52 : h * 0.66;
      mg.font = `900 ${ms}px ${FONTS.stencil}`;
      const tw = mg.measureText(main).width;
      mg.save(); mg.translate(w / 2, small ? h * 0.38 : h * 0.52); if (tw > w * 0.92) mg.scale((w * 0.92) / tw, 1); mg.fillText(main, 0, 0); mg.restore();
      if (small) { mg.font = `700 ${h * 0.2}px ${FONTS.stencil}`; mg.fillText(small, w / 2, h * 0.82, w * 0.92); }
    }, { color: c, alpha: 0.86, seed: (main.length * 97 + 13) >>> 0, wear: 0.45, overspray: 0.3 });
    g.drawImage(layer, 0, 0);
  } else {
    // plate：拉絲金屬銘牌、刻字、四角鉚釘
    const r = Math.min(w, h) * 0.08;
    g.save(); roundRect(g, 1, 1, w - 2, h - 2, r); g.clip();
    brushedMetal(g, 0, 0, w, h, w * 3 + h);
    g.restore();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2; roundRect(g, 1, 1, w - 2, h - 2, r); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1.5; roundRect(g, 4, 4, w - 8, h - 8, r * 0.8); g.stroke();
    const fx = h * 0.16;
    engraved(g, main, w / 2, small ? h * 0.42 : h * 0.52, w - fx * 4, { size: h * (small ? 0.36 : 0.44) });
    if (small) engraved(g, small, w / 2, h * 0.76, w - fx * 4, { size: h * 0.17, weight: '600' });
    for (const [x, y] of [[fx, fx], [w - fx, fx], [fx, h - fx], [w - fx, h - fx]]) rivet(g, x, y, Math.max(3, h * 0.045), { base: [150, 152, 148] });
    // 指紋、氧化
    for (let i = 0; i < 12; i++) { const x = rnd() * w, y = rnd() * h; const rg = g.createRadialGradient(x, y, 0, x, y, h * 0.3); rg.addColorStop(0, 'rgba(60,50,30,0.07)'); rg.addColorStop(1, 'rgba(60,50,30,0)'); g.fillStyle = rg; g.fillRect(x - h * 0.3, y - h * 0.3, h * 0.6, h * 0.6); }
  }
  return canvas;
}

// -----------------------------------------------------------------------------
// 設備面板圖
// -----------------------------------------------------------------------------
function panelBase(W, H, color, { seed = 1, screws = true, inset = 18 } = {}) {
  const { canvas, g } = mkCanvas(W, H);
  const mott = field(W, H, { cells: 3, octaves: 4, seed }, 4);
  const peel = field(W, H, { cells: Math.round(W / 6), octaves: 2, seed: seed + 3 }, 2);
  const gr = grain(W, H, seed + 1);
  const pix = new Pix(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const de = Math.min(x, y, W - 1 - x, H - 1 - y);
    let k = (0.9 + 0.14 * mott[i]) * (0.985 + 0.03 * peel[i]) + (gr[i] - 0.5) * 0.04;
    k *= 1 - 0.18 * smooth(10, 0, de);
    if (de < 3) k *= (x < 3 || y < 3) && !(W - 1 - x < 3 || H - 1 - y < 3) ? 1.25 : 0.65;
    pix.set(i, color[0] * k, color[1] * k, color[2] * k);
  }
  pix.putTo(g);
  const rnd = rng(seed + 7);
  scratches(g, rnd, Math.round(W * H / 9000), { x0: 10, y0: 10, x1: W - 10, y1: H - 10, len: [5, 40], light: color.map((v) => Math.min(255, v * 1.35 + 30)), alpha: [0.1, 0.35] });
  if (screws) for (const [x, y] of [[inset, inset], [W - inset, inset], [inset, H - inset], [W - inset, H - inset]]) screw(g, x, y, Math.max(5, Math.min(W, H) / 64), { rot: rnd() * TAU });
  return { canvas, g, rnd };
}

/** 黑底白字的雕刻塑膠銘牌（traffolyte） */
function plate(g, x, y, w, h, text, { size = h * 0.55, bg = '#1e211f', fg = '#ebe7da', font = FONTS.ui, weight = '700', sub = null, rivets = true } = {}) {
  g.fillStyle = 'rgba(0,0,0,0.4)'; roundRect(g, x + 2, y + 3, w, h, 4); g.fill();
  g.fillStyle = bg; roundRect(g, x, y, w, h, 4); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1.5; roundRect(g, x + 1, y + 1, w - 2, h - 2, 4); g.stroke();
  const pad = rivets ? h * 0.45 : h * 0.2;
  if (sub) {
    drawFitted(g, text, x + w / 2, y + h * 0.4, w - pad * 2, { size, font, weight, color: fg });
    drawFitted(g, sub, x + w / 2, y + h * 0.78, w - pad * 2, { size: size * 0.42, font, weight: '500', color: fg });
  } else drawFitted(g, text, x + w / 2, y + h * 0.53, w - pad * 2, { size, font, weight, color: fg });
  if (rivets) for (const xx of [x + h * 0.22, x + w - h * 0.22]) rivet(g, xx, y + h / 2, Math.max(2.2, h * 0.08), { base: [140, 140, 136] });
}

/**
 * LED 燈座（鍍鉻環＋有色燈罩）。dark = true：燈罩畫成「沒點亮」的深色（真正的 3D LED 會疊在上面，
 * 貼圖本身不能看起來像亮著，否則會和 3D 指示燈的狀態矛盾）。
 */
function ledBezel(g, x, y, r, tint, { dark = false } = {}) {
  const rg = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.2, x, y, r * 1.45);
  rg.addColorStop(0, '#f4f4f0'); rg.addColorStop(0.5, '#9a9c98'); rg.addColorStop(1, '#3a3c3a');
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(x + 2, y + 3, r * 1.45, 0, TAU); g.fill();
  g.fillStyle = rg; g.beginPath(); g.arc(x, y, r * 1.4, 0, TAU); g.fill();
  const lens = g.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
  if (dark) {
    lens.addColorStop(0, rgba(tint.map((v) => v * 0.28 + 14))); lens.addColorStop(0.6, rgba(tint.map((v) => v * 0.12 + 6))); lens.addColorStop(1, rgba(tint.map((v) => v * 0.05 + 4)));
  } else {
    lens.addColorStop(0, rgba(tint.map((v) => Math.min(255, v * 0.9 + 60)))); lens.addColorStop(0.5, rgba(tint.map((v) => v * 0.45))); lens.addColorStop(1, rgba(tint.map((v) => v * 0.18)));
  }
  g.fillStyle = lens; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.fillStyle = `rgba(255,255,255,${dark ? 0.25 : 0.5})`; g.beginPath(); g.ellipse(x - r * 0.35, y - r * 0.4, r * 0.28, r * 0.16, -0.6, 0, TAU); g.fill();
}

function textAt(g, text, x, y, size, { color = '#1d1f1e', weight = '700', align = 'center', font = FONTS.ui, maxW = 1e4 } = {}) {
  drawFitted(g, text, x, y, maxW, { size, font, weight, color, align });
}

function hazardStripes(g, x, y, w, h, period = 40) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#e2b11f'; g.fillRect(x, y, w, h);
  g.fillStyle = '#1a1917';
  for (let s = -h - period; s < w + h; s += period) {
    g.beginPath(); g.moveTo(x + s, y); g.lineTo(x + s + period / 2, y); g.lineTo(x + s + period / 2 + h, y + h); g.lineTo(x + s + h, y + h); g.closePath(); g.fill();
  }
  g.restore();
}

function ventPanel() {
  const W = 512, H = 640;
  const { canvas, g, rnd } = panelBase(W, H, [104, 118, 108], { seed: 401 });
  plate(g, 56, 32, W - 112, 56, '通風系統控制面板', { size: 30 });
  // 轉速表
  const cx = 256, cy = 250, R = 118;
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(cx + 3, cy + 5, R + 16, 0, TAU); g.fill();
  const ring = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
  ring.addColorStop(0, '#d9dad5'); ring.addColorStop(0.5, '#6c6e6a'); ring.addColorStop(1, '#2a2c2a');
  g.fillStyle = ring; g.beginPath(); g.arc(cx, cy, R + 14, 0, TAU); g.fill();
  g.fillStyle = '#e6e3d6'; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
  const yel = g.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
  yel.addColorStop(0, 'rgba(200,180,120,0)'); yel.addColorStop(1, 'rgba(160,140,90,0.25)');
  g.fillStyle = yel; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
  const MAX = 1800, a0 = -135 * Math.PI / 180, a1 = 135 * Math.PI / 180;
  const ang = (v) => a0 + (a1 - a0) * (v / MAX);
  const P = (a, r) => [cx + Math.sin(a) * r, cy - Math.cos(a) * r];
  const arcBand = (v0, v1, col) => {
    g.strokeStyle = col; g.lineWidth = 12; g.beginPath();
    g.arc(cx, cy, R * 0.8, ang(v0) - Math.PI / 2, ang(v1) - Math.PI / 2); g.stroke();
  };
  arcBand(900, 1350, '#3f8f4f'); arcBand(1350, 1600, '#d29a22'); arcBand(1600, 1800, '#b33a2c');
  g.strokeStyle = '#1b1b1b'; g.lineCap = 'butt';
  for (let v = 0; v <= MAX; v += 50) {
    const major = v % 300 === 0, mid = v % 100 === 0;
    const [x0, y0] = P(ang(v), R * 0.94), [x1, y1] = P(ang(v), R * (major ? 0.74 : mid ? 0.82 : 0.87));
    g.lineWidth = major ? 3 : mid ? 1.8 : 1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    if (major) { const [tx, ty] = P(ang(v), R * 0.6); textAt(g, String(v / 100), tx, ty, 19, { weight: '700' }); }
  }
  textAt(g, 'RPM ×100', cx, cy + R * 0.42, 15, { weight: '600' });
  textAt(g, '主排風機 轉速', cx, cy + R * 0.62, 16, { weight: '700' });
  // 指針軸心（指針由 3D 模型提供）
  const hub = g.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, 12);
  hub.addColorStop(0, '#888'); hub.addColorStop(1, '#111');
  g.fillStyle = hub; g.beginPath(); g.arc(cx, cy, 11, 0, TAU); g.fill();
  const gl = g.createLinearGradient(cx - R, cy - R, cx, cy);
  gl.addColorStop(0, 'rgba(255,255,255,0.22)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gl; g.beginPath(); g.ellipse(cx - R * 0.25, cy - R * 0.35, R * 0.75, R * 0.45, -0.6, 0, TAU); g.fill();
  plate(g, 146, 392, 220, 44, '主排風機', { size: 27 });
  // 指示燈（燈罩畫成未點亮；3D LED 疊在上面）
  const LY = 462;
  const leds = [[150, '運轉', [70, 200, 90]], [256, '異常', [235, 160, 40]], [362, '停止', [220, 50, 40]]];
  for (const [x, lab, tint] of leds) { ledBezel(g, x, LY, 13, tint, { dark: true }); textAt(g, lab, x, LY + 30, 17, { color: '#121413' }); }
  // 拉桿槽（放得比面板下緣高一些：3D 拉桿從槽中伸出，拉下時桿頭也還在面板內）
  const sx = 256, sy0 = 516, sy1 = 568;
  g.fillStyle = '#2d302e'; roundRect(g, sx - 52, sy0 - 12, 104, sy1 - sy0 + 24, 8); g.fill();
  g.fillStyle = '#0b0c0b'; roundRect(g, sx - 9, sy0, 18, sy1 - sy0, 9); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5; roundRect(g, sx - 52, sy0 - 12, 104, sy1 - sy0 + 24, 8); g.stroke();
  textAt(g, '運轉', sx + 62, sy0 + 2, 15, { align: 'left', color: '#121413' });
  textAt(g, '重啟', sx + 62, sy1 - 2, 15, { align: 'left', color: '#121413' });
  g.fillStyle = '#121413';
  g.beginPath(); g.moveTo(sx - 80, sy0 + 8); g.lineTo(sx - 70, sy0 + 8); g.lineTo(sx - 70, sy1 - 18); g.lineTo(sx - 62, sy1 - 18); g.lineTo(sx - 75, sy1 - 2); g.lineTo(sx - 88, sy1 - 18); g.lineTo(sx - 80, sy1 - 18); g.closePath(); g.fill();
  textAt(g, '拉下', sx - 120, (sy0 + sy1) / 2, 15, { color: '#121413' });
  // 小貼紙
  g.save(); g.translate(432, 586); g.rotate(0.04);
  g.fillStyle = '#e4bf2c'; g.fillRect(-36, -20, 72, 40);
  textAt(g, '非經授權', 0, -8, 12, { color: '#1a1a1a' }); textAt(g, '請勿操作', 0, 9, 12, { color: '#1a1a1a' });
  g.restore();
  void rnd;
  return {
    canvas,
    layout: {
      gauge: { u: cx / W, v: 1 - cy / H, r: R / W, minDeg: -135, maxDeg: 135, max: MAX, green: [900, 1350], amber: [1350, 1600], red: [1600, 1800] },
      leds: leds.map(([x, label, c]) => ({ u: x / W, v: 1 - LY / H, r: 13 / W, label, color: c })),
      lever: { u: sx / W, vTop: 1 - sy0 / H, vBottom: 1 - sy1 / H },
    },
  };
}

// 384×544（與 3D 面板 0.24×0.34 m 同比例，圓形不會被拉扁）；喇叭格柵、通話燈座、通話鍵凹座的位置
// 由 layout 交給 buildIntercom，3D 按鍵/LED/格柵外圈都對齊這裡畫的位置（每樣東西只有一個）。
function intercomPanel() {
  const W = 384, H = 544;
  const { canvas, g } = panelBase(W, H, [176, 172, 160], { seed: 411 });
  // 紅色頂帶
  g.fillStyle = '#a52a22'; g.fillRect(14, 26, W - 28, 78);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(14, 100, W - 28, 4);
  // 話筒圖示
  g.save(); g.translate(64, 70); g.rotate(-0.45);
  g.strokeStyle = '#f5efe6'; g.fillStyle = '#f5efe6'; g.lineCap = 'round'; g.lineWidth = 9;
  g.beginPath(); g.arc(0, 16, 25, Math.PI * 1.18, Math.PI * 1.82); g.stroke();
  for (const sgn of [-1, 1]) {
    const a = Math.PI * 1.5 + sgn * Math.PI * 0.34;
    g.save(); g.translate(Math.cos(a) * 25, 16 + Math.sin(a) * 25); g.rotate(a + Math.PI / 2 + sgn * 0.25);
    roundRect(g, -11, -2, 22, 13, 5); g.fill();
    g.restore();
  }
  g.restore();
  textAt(g, '緊急對講', 222, 66, 44, { color: '#f7f1e8', weight: '900', maxW: 230 });
  // 喇叭格柵
  const cx = W / 2, cy = 218, R = 84;
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.arc(cx + 2, cy + 3, R + 10, 0, TAU); g.fill();
  g.fillStyle = '#8f8c82'; g.beginPath(); g.arc(cx, cy, R + 9, 0, TAU); g.fill();
  g.fillStyle = '#b9b5a8'; g.beginPath(); g.arc(cx, cy, R + 4, 0, TAU); g.fill();
  const sp = 12;
  for (let row = -9; row <= 9; row++) for (let col = -9; col <= 9; col++) {
    const x = cx + col * sp + (row % 2 ? sp / 2 : 0), y = cy + row * sp * 0.87;
    if (hyp(x - cx, y - cy) > R - 4) continue;
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(x + 0.8, y + 1, 3.6, 0, TAU); g.fill();
    g.fillStyle = '#0d0d0c'; g.beginPath(); g.arc(x, y, 3.4, 0, TAU); g.fill();
  }
  // 通話燈（燈罩畫成未點亮；3D LED 疊在上面）與通話鍵凹座（3D 按鍵嵌在裡面）
  const lx = 104, ly = 372, lr = 12;
  ledBezel(g, lx, ly, lr, [70, 200, 90], { dark: true });
  textAt(g, '通話燈', lx, ly + 38, 18);
  const bx = 262, by = 372, br = 40;
  g.fillStyle = 'rgba(0,0,0,0.4)'; g.beginPath(); g.arc(bx + 2, by + 4, br + 10, 0, TAU); g.fill();
  const rg = g.createLinearGradient(bx - br, by - br, bx + br, by + br);
  rg.addColorStop(0, '#dcdcd6'); rg.addColorStop(1, '#4a4c48');
  g.fillStyle = rg; g.beginPath(); g.arc(bx, by, br + 9, 0, TAU); g.fill();
  g.fillStyle = '#1b1c1b'; g.beginPath(); g.arc(bx, by, br + 2, 0, TAU); g.fill();
  textAt(g, '通話', bx, by + br + 30, 24, { weight: '900' });
  plate(g, 34, 478, W - 68, 40, '連線：B區 公務維修廊道', { size: 19 });
  return {
    canvas,
    layout: {
      speaker: { u: cx / W, v: 1 - cy / H, r: R / W, rim: (R + 9) / W },
      led: { u: lx / W, v: 1 - ly / H, r: lr / W },
      button: { u: bx / W, v: 1 - by / H, r: br / W, well: (br + 2) / W },
    },
  };
}

function breakerPanel() {
  const W = 480, H = 640;
  const { canvas, g } = panelBase(W, H, [120, 128, 122], { seed: 421 });
  // 危險標示
  g.fillStyle = '#efe9da'; roundRect(g, 40, 30, W - 80, 128, 6); g.fill();
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 3; roundRect(g, 46, 36, W - 92, 116, 4); g.stroke();
  const tx = 112, ty = 98, ts = 92;
  g.fillStyle = '#1a1a1a'; g.beginPath(); g.moveTo(tx, ty - ts * 0.55); g.lineTo(tx + ts * 0.58, ty + ts * 0.42); g.lineTo(tx - ts * 0.58, ty + ts * 0.42); g.closePath(); g.fill();
  g.fillStyle = '#f0c21e'; g.beginPath(); g.moveTo(tx, ty - ts * 0.4); g.lineTo(tx + ts * 0.45, ty + ts * 0.34); g.lineTo(tx - ts * 0.45, ty + ts * 0.34); g.closePath(); g.fill();
  g.fillStyle = '#1a1a1a'; g.beginPath(); // 閃電
  g.moveTo(tx + 6, ty - 26); g.lineTo(tx - 12, ty + 6); g.lineTo(tx - 1, ty + 6); g.lineTo(tx - 8, ty + 30); g.lineTo(tx + 13, ty - 4); g.lineTo(tx + 2, ty - 4); g.closePath(); g.fill();
  textAt(g, '危險', 290, 74, 46, { color: '#b3261e', weight: '900' });
  textAt(g, '高壓電　非專業人員請勿操作', 290, 124, 19, { color: '#1a1a1a', maxW: 250 });
  plate(g, 60, 172, W - 120, 64, '隧道中段供電', { size: 32, sub: '主斷路器　MCB-B2' });
  // 拉桿面板
  const sx = W / 2, sy0 = 306, sy1 = 490;
  g.fillStyle = 'rgba(0,0,0,0.45)'; roundRect(g, sx - 78, sy0 - 26, 160, sy1 - sy0 + 56, 10); g.fill();
  const esc = g.createLinearGradient(sx - 80, 0, sx + 80, 0);
  esc.addColorStop(0, '#5a5e5a'); esc.addColorStop(0.5, '#3e423f'); esc.addColorStop(1, '#2c2f2c');
  g.fillStyle = esc; roundRect(g, sx - 80, sy0 - 30, 160, sy1 - sy0 + 60, 10); g.fill();
  g.fillStyle = '#080808'; roundRect(g, sx - 13, sy0, 26, sy1 - sy0, 13); g.fill();
  textAt(g, 'ON　入', sx, sy0 - 15, 20, { color: '#e8e4d6', weight: '900' });
  textAt(g, 'OFF　切', sx, sy1 + 15, 20, { color: '#e8e4d6', weight: '900' });
  g.fillStyle = '#3f8f4f'; g.fillRect(sx - 64, sy0, 8, 60); g.fillStyle = '#b33a2c'; g.fillRect(sx - 64, sy1 - 60, 8, 60);
  // 狀態燈
  const leds = [[W - 70, 330, '供電', [70, 200, 90]], [W - 70, 420, '跳脫', [235, 150, 40]]];
  for (const [x, y, lab, c] of leds) { ledBezel(g, x, y, 12, c); textAt(g, lab, x, y + 34, 17, { color: '#101210' }); }
  plate(g, 60, 566, W - 120, 52, '監控頻寬限制', { size: 26, sub: '復電後連動解除' });
  return {
    canvas,
    layout: {
      lever: { u: sx / W, vTop: 1 - sy0 / H, vBottom: 1 - sy1 / H },
      leds: leds.map(([x, y, label, color]) => ({ u: x / W, v: 1 - y / H, r: 12 / W, label, color })),
    },
  };
}

function unlockPanel() {
  const W = 512, H = 512;
  const { canvas, g } = mkCanvas(W, H);
  hazardStripes(g, 0, 0, W, H, 64);
  // 磨損
  const n = field(W, H, { cells: 22, octaves: 4, seed: 431 }, 2), gr = grain(W, H, 432);
  const img = g.getImageData(0, 0, W, H); const d = img.data;
  for (let i = 0; i < W * H; i++) {
    const p = i * 4, chip = smooth(0.74, 0.77, n[i]), k = 0.85 + 0.2 * n[i] + (gr[i] - 0.5) * 0.08;
    for (let c = 0; c < 3; c++) d[p + c] = (d[p + c] * k) * (1 - chip) + 100 * chip;
  }
  g.putImageData(img, 0, 0);
  const m = 58;
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(m - 2, m - 2, W - 2 * m + 6, W - 2 * m + 8);
  g.fillStyle = '#262826'; g.fillRect(m, m, W - 2 * m, H - 2 * m);
  g.strokeStyle = 'rgba(255,255,255,0.15)'; g.lineWidth = 2; g.strokeRect(m + 2, m + 2, W - 2 * m - 4, H - 2 * m - 4);
  textAt(g, '防爆門', W / 2, m + 52, 56, { color: '#f1ece0', weight: '900' });
  textAt(g, '緊急解鎖', W / 2, m + 112, 40, { color: '#e35a46', weight: '900' });
  const cx = W / 2, cy = 318, R = 92;
  g.strokeStyle = '#b3261e'; g.lineWidth = 10; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, R + 7, 0, TAU); g.stroke();
  g.fillStyle = '#121312'; g.beginPath(); g.arc(cx, cy, R - 6, 0, TAU); g.fill();
  textAt(g, '氣壓閥洩壓', W / 2, H - m - 22, 20, { color: '#d8d3c6', weight: '700' });
  for (const [x, y] of [[m + 16, m + 16], [W - m - 16, m + 16], [m + 16, H - m - 16], [W - m - 16, H - m - 16]]) screw(g, x, y, 6, { rot: x * 0.1 });
  return { canvas, layout: { button: { u: cx / W, v: 1 - cy / H, r: (R - 6) / W } } };
}

function flashlightBoxPanel() {
  const W = 384, H = 512;
  const { canvas, g } = panelBase(W, H, [170, 42, 32], { seed: 441 });
  plate(g, 40, 34, W - 80, 70, '緊急照明', { size: 40, bg: '#f2eee4', fg: '#a3231a' });
  // 觀察窗
  const wx = 64, wy = 140, ww = W - 128, wh = 250;
  g.fillStyle = '#1a1310'; roundRect(g, wx - 8, wy - 8, ww + 16, wh + 16, 10); g.fill();
  const glass = g.createLinearGradient(wx, wy, wx + ww, wy + wh);
  glass.addColorStop(0, '#2b2724'); glass.addColorStop(1, '#141210');
  g.fillStyle = glass; roundRect(g, wx, wy, ww, wh, 6); g.fill();
  // 手電筒圖示（白色）
  g.save(); g.translate(W / 2, wy + wh / 2); g.rotate(-0.5);
  g.fillStyle = 'rgba(240,236,228,0.9)';
  roundRect(g, -70, -16, 100, 32, 6); g.fill();
  g.beginPath(); g.moveTo(30, -16); g.lineTo(62, -28); g.lineTo(62, 28); g.lineTo(30, 16); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(240,236,228,0.8)'; g.lineWidth = 5; g.lineCap = 'round';
  for (const a of [-0.45, 0, 0.45]) { g.beginPath(); g.moveTo(74 + Math.cos(a) * 4, Math.sin(a) * 22); g.lineTo(100 + Math.cos(a) * 18, Math.sin(a) * 50); g.stroke(); }
  g.restore();
  const sh = g.createLinearGradient(wx, wy, wx + ww * 0.6, wy + wh * 0.6);
  sh.addColorStop(0, 'rgba(255,255,255,0.14)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.fillStyle = sh; roundRect(g, wx, wy, ww, wh, 6); g.fill();
  textAt(g, '停電時取用', W / 2, 440, 28, { color: '#f4ede2', weight: '800' });
  return { canvas, layout: { window: { u0: wx / W, v0: 1 - (wy + wh) / H, u1: (wx + ww) / W, v1: 1 - wy / H } } };
}

function camPanel(SCRIPT) {
  const W = 1024, H = 256;
  const { canvas, g } = panelBase(W, H, [58, 60, 60], { seed: 451, inset: 16 });
  textAt(g, '監視頻道選擇', 40, 28, 18, { color: '#cfcac0', align: 'left', weight: '700' });
  textAt(g, 'CCTV CHANNEL SELECT', W - 40, 28, 14, { color: '#9d9890', align: 'right', weight: '600' });
  const buttons = [];
  for (let i = 0; i < 4; i++) {
    const cx = 128 + i * 256, cy = 140;
    const cam = SCRIPT?.cams?.[i + 1];
    g.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(g, cx - 70, cy - 54, 140, 108, 12); g.fill();
    g.fillStyle = '#1d1f1f'; roundRect(g, cx - 66, cy - 50, 132, 100, 10); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 2; roundRect(g, cx - 66, cy - 50, 132, 100, 10); g.stroke();
    textAt(g, cam?.id ?? `CAM-0${i + 1}`, cx, 64, 26, { color: '#ebe6d8', weight: '800' });
    textAt(g, cam?.place ?? '', cx, 222, 18, { color: '#b9b4a8', weight: '600', maxW: 230 });
    ledBezel(g, cx + 94, cy - 34, 7, [70, 200, 90]);
    buttons.push({ u: cx / W, v: 1 - cy / H, led: { u: (cx + 94) / W, v: 1 - (cy - 34) / H } });
  }
  return { canvas, layout: { buttons } };
}

export function drawPanel(kind, SCRIPT) {
  switch (kind) {
    case 'vent': return ventPanel();
    case 'intercom': return intercomPanel();
    case 'breaker': return breakerPanel();
    case 'unlock': return unlockPanel();
    case 'flashlightBox': return flashlightBoxPanel();
    case 'camPanel': return camPanel(SCRIPT);
    default: return null;
  }
}
