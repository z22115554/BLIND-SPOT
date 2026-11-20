// =============================================================================
// 劇情物件貼圖：碎裂機械錶（錶面/錶背）、燒焦的交接日誌、消防外套背面、咖啡液面、隧道平面配置圖。
// =============================================================================
import { FONTS } from '../canvasUtil.js';
import {
  rng, clamp, TAU, mkCanvas, smooth, field, grain, worley, Pix, drip, crackPath, stencilLayer,
  drawFitted, roundRect, quoted, hash3, softStain as stain, hyp,
} from './core.js';
import { InkProcessor, inkLines, wrapHand, HAND } from './hand.js';

// -----------------------------------------------------------------------------
// 碎裂的機械錶錶面：02:14:08
// -----------------------------------------------------------------------------
export const WATCH_TIME = { h: 2, m: 14, s: 8 };
export function watchHandAngles({ h, m, s } = WATCH_TIME) {
  return {
    hour: ((h % 12) + m / 60 + s / 3600) * 30,   // 度，順時針，0 = 12 點
    minute: (m + s / 60) * 6,
    second: s * 6,
  };
}

export function watchFace() {
  const S = 512, C = S / 2, R = 246;
  const { canvas, g } = mkCanvas(S, S);
  // 太陽紋拉絲銀色錶盤（逐像素）
  const pix = new Pix(S, S);
  const gr = grain(S, S, 501);
  const mott = field(S, S, { cells: 4, octaves: 3, seed: 502 }, 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, dx = x + 0.5 - C, dy = y + 0.5 - C;
    const r = hyp(dx, dy);
    if (r > R + 1) { pix.set(i, 58, 58, 60); continue; }
    const a = Math.atan2(dy, dx);
    const ai = Math.floor((a + Math.PI) * 260);
    const brush = 0.9 + 0.1 * hash3(ai, 0, 7) + 0.05 * (gr[i] - 0.5);
    const bow = 0.12 * Math.cos(2 * (a + 0.8)) + 0.05 * Math.cos(4 * (a + 0.3));
    const k = (0.82 + bow) * brush * (0.97 + 0.04 * mott[i]) * (1 - 0.18 * smooth(R * 0.85, R, r));
    pix.set(i, 206 * k, 208 * k, 211 * k);
  }
  pix.putTo(g);
  g.save(); g.beginPath(); g.arc(C, C, R, 0, TAU); g.clip();
  // 分鐘刻度環
  const P = (deg, rr) => { const a = deg * Math.PI / 180; return [C + Math.sin(a) * rr, C - Math.cos(a) * rr]; };
  g.strokeStyle = '#26282a'; g.lineCap = 'butt';
  for (let k = 0; k < 60; k++) {
    const major = k % 5 === 0;
    const [x0, y0] = P(k * 6, R * 0.95), [x1, y1] = P(k * 6, R * (major ? 0.885 : 0.91));
    g.lineWidth = major ? 2.6 : 1.3; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  g.strokeStyle = 'rgba(30,30,32,0.6)'; g.lineWidth = 1;
  g.beginPath(); g.arc(C, C, R * 0.955, 0, TAU); g.stroke(); g.beginPath(); g.arc(C, C, R * 0.875, 0, TAU); g.stroke();
  // 時標（拋光棒狀，12 點為雙棒）
  const baton = (deg, off = 0, wdt = 11) => {
    g.save(); g.translate(C, C); g.rotate(deg * Math.PI / 180); g.translate(off, 0);
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-wdt / 2 + 2, -R * 0.84 + 3, wdt, R * 0.18);
    const lg = g.createLinearGradient(-wdt / 2, 0, wdt / 2, 0);
    lg.addColorStop(0, '#f6f7f8'); lg.addColorStop(0.5, '#9a9da2'); lg.addColorStop(0.51, '#5e6166'); lg.addColorStop(1, '#c9ccd0');
    g.fillStyle = lg; g.fillRect(-wdt / 2, -R * 0.84, wdt, R * 0.18);
    g.strokeStyle = 'rgba(20,20,22,0.7)'; g.lineWidth = 1; g.strokeRect(-wdt / 2, -R * 0.84, wdt, R * 0.18);
    g.restore();
  };
  for (let hh = 0; hh < 12; hh++) { if (hh === 0) { baton(0, -9, 9); baton(0, 9, 9); } else baton(hh * 30); }
  // 錶盤字樣（中性，不含品牌）
  drawFitted(g, 'AUTOMATIC', C, C + R * 0.36, 160, { size: 17, font: FONTS.ui, weight: '600', color: 'rgba(40,42,46,0.85)' });
  drawFitted(g, '21 JEWELS', C, C + R * 0.46, 120, { size: 11, font: FONTS.ui, weight: '500', color: 'rgba(40,42,46,0.75)' });
  drawFitted(g, '◆', C, C - R * 0.48, 40, { size: 18, font: FONTS.ui, color: 'rgba(40,42,46,0.85)' });
  // 內側水氣：黑灰色斑塊（指針底下也有）
  const rnd = rng(503);
  for (let i = 0; i < 6; i++) {
    const a = rnd() * TAU, d = R * (0.35 + rnd() * 0.55);
    stain(g, C + Math.cos(a) * d, C + Math.sin(a) * d, 40 + rnd() * 70, { seed: 510 + i, color: [44, 46, 48], alpha: 0.32, blobs: 10, soft: 0.85 });
  }
  const fog = g.createRadialGradient(C, C, R * 0.55, C, C, R);
  fog.addColorStop(0, 'rgba(60,62,64,0)'); fog.addColorStop(1, 'rgba(52,54,56,0.45)');
  g.fillStyle = fog; g.fillRect(0, 0, S, S);
  // 指針
  const ang = watchHandAngles();
  const dauphine = (deg, len, wdt, tail) => {
    g.save(); g.translate(C + 3, C + 5); g.rotate(deg * Math.PI / 180);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.moveTo(0, -len); g.lineTo(wdt / 2, 0); g.lineTo(0, tail); g.lineTo(-wdt / 2, 0); g.closePath(); g.fill();
    g.restore();
    g.save(); g.translate(C, C); g.rotate(deg * Math.PI / 180);
    g.fillStyle = '#eef0f2'; g.beginPath(); g.moveTo(0, -len); g.lineTo(-wdt / 2, 0); g.lineTo(0, tail); g.closePath(); g.fill();
    g.fillStyle = '#6c7076'; g.beginPath(); g.moveTo(0, -len); g.lineTo(wdt / 2, 0); g.lineTo(0, tail); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(20,20,24,0.8)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, -len); g.lineTo(wdt / 2, 0); g.lineTo(0, tail); g.lineTo(-wdt / 2, 0); g.closePath(); g.stroke();
    g.restore();
  };
  dauphine(ang.hour, R * 0.52, 20, R * 0.06);
  dauphine(ang.minute, R * 0.82, 15, R * 0.06);
  // 秒針（細、藍鋼色，帶配重尾）
  g.save(); g.translate(C + 2, C + 4); g.rotate(ang.second * Math.PI / 180);
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(0, R * 0.2); g.lineTo(0, -R * 0.9); g.stroke(); g.restore();
  g.save(); g.translate(C, C); g.rotate(ang.second * Math.PI / 180);
  g.strokeStyle = '#2b3a66'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(0, R * 0.2); g.lineTo(0, -R * 0.9); g.stroke();
  g.fillStyle = '#2b3a66'; g.beginPath(); g.ellipse(0, R * 0.16, 5, 9, 0, 0, TAU); g.fill();
  g.restore();
  const hub = g.createRadialGradient(C - 3, C - 3, 1, C, C, 10);
  hub.addColorStop(0, '#f2f3f4'); hub.addColorStop(1, '#4b4e53');
  g.fillStyle = hub; g.beginPath(); g.arc(C, C, 9, 0, TAU); g.fill();
  // 水珠
  for (let i = 0; i < 140; i++) {
    const a = rnd() * TAU, d = R * Math.sqrt(rnd()) * 0.98;
    const x = C + Math.cos(a) * d, y = C + Math.sin(a) * d + (rnd() < 0.4 ? R * 0.15 : 0);
    const r = 0.7 + Math.pow(rnd(), 2.5) * 5;
    g.fillStyle = 'rgba(40,42,44,0.4)'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    g.fillStyle = 'rgba(230,232,235,0.45)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.35, r * 0.35, 0, TAU); g.fill();
  }
  // 蜘蛛網狀裂痕（撞擊點在 7–8 點鐘方向）
  const ix = C - R * 0.34, iy = C + R * 0.3;
  const rays = [];
  const nr = 15;
  for (let k = 0; k < nr; k++) {
    const a0 = (k / nr) * TAU + (rnd() - 0.5) * 0.3;
    const pts = [[ix, iy]]; let a = a0, x = ix, y = iy, dist = 0;
    while (dist < R * 2.2) {
      const step = 8 + rnd() * 14; a += (rnd() - 0.5) * 0.35; x += Math.cos(a) * step; y += Math.sin(a) * step; dist += step;
      pts.push([x, y]);
      if (hyp(x - C, y - C) > R + 10) break;
    }
    rays.push(pts);
  }
  const at = (pts, d) => { // 沿射線距離 d 的點
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const seg = hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (acc + seg >= d) { const t = (d - acc) / seg; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; }
      acc += seg;
    }
    return null;
  };
  const crackLine = (pts, w) => {
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.strokeStyle = 'rgba(15,15,18,0.45)'; g.lineWidth = w + 1.2;
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x + 1, y + 1.2) : g.moveTo(x + 1, y + 1.2))); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.78)'; g.lineWidth = w;
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  };
  for (const pts of rays) crackLine(pts, 1.1);
  for (const d0 of [22, 48, 82, 125, 178, 240]) {
    for (let k = 0; k < nr; k++) {
      if (rnd() < 0.2 + d0 / 600) continue;
      const pa = at(rays[k], d0 * (0.9 + rnd() * 0.2)), pb = at(rays[(k + 1) % nr], d0 * (0.9 + rnd() * 0.2));
      if (!pa || !pb) continue;
      const mx = (pa[0] + pb[0]) / 2 + (rnd() - 0.5) * 10, my = (pa[1] + pb[1]) / 2 + (rnd() - 0.5) * 10;
      crackLine([pa, [mx, my], pb], 0.8);
    }
  }
  // 撞擊點的碎玻璃霧
  const halo = g.createRadialGradient(ix, iy, 0, ix, iy, 30);
  halo.addColorStop(0, 'rgba(255,255,255,0.55)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo; g.beginPath(); g.arc(ix, iy, 30, 0, TAU); g.fill();
  for (let i = 0; i < 40; i++) {
    const a = rnd() * TAU, d = rnd() * 20;
    crackPath(g, rnd, ix + Math.cos(a) * d, iy + Math.sin(a) * d, 2, 3 + rnd() * 4, { color: 'rgba(255,255,255,0.6)', width: 0.7 });
  }
  // 玻璃反光
  const gl = g.createLinearGradient(C - R, C - R, C, C);
  gl.addColorStop(0, 'rgba(255,255,255,0.16)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gl; g.beginPath(); g.ellipse(C - R * 0.25, C - R * 0.35, R * 0.7, R * 0.4, -0.7, 0, TAU); g.fill();
  g.restore();
  // 錶圈內緣陰影
  const rim = g.createRadialGradient(C, C, R * 0.93, C, C, R);
  rim.addColorStop(0, 'rgba(0,0,0,0)'); rim.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = rim; g.beginPath(); g.arc(C, C, R, 0, TAU); g.fill();
  return canvas;
}

// -----------------------------------------------------------------------------
// 錶背：同心圓拉絲不鏽鋼、刻字
// -----------------------------------------------------------------------------
export function watchBack(SCRIPT) {
  const S = 512, C = S / 2, R = 248;
  const { canvas, g } = mkCanvas(S, S);
  const pix = new Pix(S, S);
  const gr = grain(S, S, 521);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, dx = x + 0.5 - C, dy = y + 0.5 - C, r = hyp(dx, dy);
    if (r > R + 1) { pix.set(i, 40, 40, 42); continue; }
    const a = Math.atan2(dy, dx);
    const ring = 0.9 + 0.1 * hash3(Math.floor(r * 2.2), 0, 3) + 0.04 * (gr[i] - 0.5);
    const aniso = 0.14 * Math.cos(2 * (a - 0.7));
    let k = (0.78 + aniso) * ring;
    // 外圈拋光斜面
    if (r > R * 0.86) { const t = (r - R * 0.86) / (R * 0.14); k = 0.6 + 0.5 * Math.sin(t * Math.PI) * (0.8 + 0.2 * Math.cos(a + 2.2)); }
    pix.set(i, 190 * k, 192 * k, 196 * k);
  }
  pix.putTo(g);
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 2; g.beginPath(); g.arc(C, C, R * 0.86, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.beginPath(); g.arc(C, C, R * 0.86 + 2, 0, TAU); g.stroke();
  // 旋入式錶背的六個缺口
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + 0.3;
    g.save(); g.translate(C + Math.cos(a) * R * 0.93, C + Math.sin(a) * R * 0.93); g.rotate(a);
    g.fillStyle = '#2e3033'; g.fillRect(-7, -13, 14, 26); g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(5, -13, 2, 26);
    g.restore();
  }
  // 環形小字（刻印）
  const ringText = 'STAINLESS STEEL  ·  WATER RESISTANT  ·  SHOCK PROTECTED  ·  ';
  g.save(); g.translate(C, C);
  g.font = `600 15px ${FONTS.ui}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const chars = [...ringText]; const step = TAU / chars.length;
  chars.forEach((ch, k) => {
    const a = -Math.PI / 2 + k * step;
    g.save(); g.rotate(a + Math.PI / 2); g.translate(0, -R * 0.75);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillText(ch, 0.8, 1);
    g.fillStyle = 'rgba(40,42,46,0.75)'; g.fillText(ch, 0, 0);
    g.restore();
  });
  g.restore();
  // 刻字「給阿哲，值夜班注意安全」
  const body = (SCRIPT?.items?.watch?.body ?? []).join('');
  const msg = quoted(body, '給阿哲，值夜班注意安全', 0);
  const parts = msg.split(/(?<=，)/);
  const lines = parts.length > 1 ? [parts[0], parts.slice(1).join('')] : [msg];
  const engrave = (txt, y, size) => {
    drawFitted(g, txt, C + 1.2, y + 1.4, R * 1.2, { size, font: FONTS.serif, weight: '600', color: 'rgba(255,255,255,0.55)' });
    drawFitted(g, txt, C, y, R * 1.2, { size, font: FONTS.serif, weight: '600', color: 'rgba(36,38,42,0.92)' });
  };
  if (lines.length === 2) { engrave(lines[0], C - 34, 44); engrave(lines[1], C + 36, 44); } else engrave(lines[0], C, 40);
  // 細微的使用痕跡
  const rnd = rng(522);
  g.lineWidth = 0.7;
  for (let i = 0; i < 70; i++) {
    const r = rnd() * R * 0.85, a = rnd() * TAU, span = 0.05 + rnd() * 0.5;
    g.strokeStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '20,20,20'},${0.1 + rnd() * 0.18})`;
    g.beginPath(); g.arc(C, C, r, a, a + span); g.stroke();
  }
  return canvas;
}

// -----------------------------------------------------------------------------
// 燒焦／泡水的紙張邊緣處理（逐像素：燒掉的部分 alpha = 0，炭黑邊、焦褐漸層）
// -----------------------------------------------------------------------------
function burnEdges(g, W, H, { seed = 1, base = 14, corner = null, amount = 1 } = {}) {
  const img = g.getImageData(0, 0, W, H); const d = img.data;
  const n = field(W, H, { cells: 6, octaves: 5, seed }, 4);
  const f = field(W, H, { cells: 24, octaves: 3, seed: seed + 1 }, 2);
  const hasC = !!corner, ccx = corner?.[0] ?? 0, ccy = corner?.[1] ?? 0, ccr = corner?.[2] ?? 0;
  const reach = base * amount * 1.7 + 4 + 34; // 超過這個距離的像素不受影響
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let de = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (hasC) { const dx = x - ccx, dy = y - ccy; de = Math.min(de, Math.sqrt(dx * dx + dy * dy) - ccr); }
    if (de > reach) continue;
    const i = y * W + x, p = i * 4;
    const t = de - (base * amount) * (0.5 + 1.2 * n[i]) - (f[i] - 0.5) * 8;
    if (t < 0) { d[p + 3] = 0; continue; }
    if (t >= 34) continue;
    const char = smooth(5, 0, t), toast = smooth(34, 2, t);
    let r = d[p], gg = d[p + 1], b = d[p + 2];
    r += (92 - r) * toast * 0.6; gg += (58 - gg) * toast * 0.65; b += (28 - b) * toast * 0.7;
    r += (16 - r) * char; gg += (13 - gg) * char; b += (11 - b) * char;
    d[p] = r; d[p + 1] = gg; d[p + 2] = b;
  }
  g.putImageData(img, 0, 0);
}

function waterRing(g, x, y, r, rnd, a = 0.3) {
  for (let k = 0; k < 2; k++) {
    g.strokeStyle = `rgba(120,86,44,${a * (k ? 0.5 : 1)})`; g.lineWidth = k ? 1 : 2.2;
    g.beginPath();
    for (let s = 0; s <= 48; s++) {
      const ang = (s / 48) * TAU, rr = r * (1 + (k ? -0.04 : 0)) + Math.sin(ang * 3 + x) * 2 + (rnd() - 0.5) * 1.5;
      const px = x + Math.cos(ang) * rr, py = y + Math.sin(ang) * rr;
      if (s) g.lineTo(px, py); else g.moveTo(px, py);
    }
    g.stroke();
  }
  g.fillStyle = `rgba(150,110,60,${a * 0.18})`; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}

// -----------------------------------------------------------------------------
// 交接日誌：封面
// -----------------------------------------------------------------------------
export function logbookCover(SCRIPT) {
  const W = 512, H = 680;
  const mott = field(W, H, { cells: 3, octaves: 5, seed: 531 }, 4);
  const gr = grain(W, H, 532);
  const pix = new Pix(W, H);
  // 布紋：經線/緯線各自的粗細明暗（只跟欄/列有關，預先算好）
  const colT = new Float32Array(W), rowT = new Float32Array(H);
  for (let x = 0; x < W; x++) colT[x] = 0.06 * hash3(x >> 1, 0, 3);
  for (let y = 0; y < H; y++) rowT[y] = 0.06 * hash3(0, y >> 1, 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const weave = ((x & 1) ^ (y & 1)) ? 1.05 : 0.95;
    const thread = 0.94 + colT[x] + rowT[y];
    const de = Math.min(x, y, W - 1 - x, H - 1 - y);
    const wear = smooth(14, 0, de) * (0.5 + 0.5 * gr[i]);
    const spine = x < 46 ? 0.8 + 0.08 * Math.sin(x * 0.7) : 1;
    let k = weave * thread * (0.88 + 0.2 * mott[i]) * spine;
    let r = 32 * k, gg = 38 * k, b = 50 * k;
    r += (96 - r) * wear * 0.6; gg += (100 - gg) * wear * 0.6; b += (106 - b) * wear * 0.6;
    pix.set(i, r, gg, b);
  }
  const { canvas, g } = pix.toCanvas();
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(44, 0, 3, H);
  g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(47, 0, 1.5, H);
  // 銘牌（金屬框＋米色紙標籤）
  const body = SCRIPT?.items?.logbook?.body?.[0] ?? '';
  const title = quoted(body, '雪嶺隧道中央控制室 — 交接日誌', 0);
  const [t1, t2] = title.split(/\s*[—–-]\s*/);
  const px = 112, py = 132, pw = 330, ph = 170;
  g.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(g, px + 3, py + 5, pw, ph, 6); g.fill();
  const fr = g.createLinearGradient(px, py, px + pw, py + ph);
  fr.addColorStop(0, '#b9b7ae'); fr.addColorStop(0.5, '#77756e'); fr.addColorStop(1, '#4b4a45');
  g.fillStyle = fr; roundRect(g, px, py, pw, ph, 6); g.fill();
  g.fillStyle = '#ddd3b8'; g.fillRect(px + 12, py + 12, pw - 24, ph - 24);
  drawFitted(g, t1 || title, px + pw / 2, py + 58, pw - 50, { size: 30, font: FONTS.serif, weight: '700', color: '#2a2622' });
  g.fillStyle = 'rgba(42,38,34,0.6)'; g.fillRect(px + 40, py + 84, pw - 80, 1.5);
  drawFitted(g, t2 || '', px + pw / 2, py + 118, pw - 60, { size: 48, font: FONTS.serif, weight: '900', color: '#2a2622' });
  // 標籤泛黃水漬
  const rnd = rng(533);
  stain(g, px + pw * 0.7, py + ph * 0.75, 70, { seed: 534, color: [140, 100, 50], alpha: 0.25, blobs: 10, soft: 0.8 });
  // 布面的水漬潮線（淺色鹽析）
  for (let i = 0; i < 3; i++) {
    const x = 120 + rnd() * 300, y = 380 + rnd() * 230, r = 60 + rnd() * 90;
    g.strokeStyle = `rgba(150,148,136,${0.18 + rnd() * 0.1})`; g.lineWidth = 2 + rnd() * 2;
    g.beginPath();
    for (let s = 0; s <= 60; s++) { const a = (s / 60) * TAU; const rr = r * (1 + 0.15 * Math.sin(a * 3 + i) + 0.06 * Math.sin(a * 7)); if (s) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8); else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.8); }
    g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.beginPath(); g.ellipse(x, y, r * 0.95, r * 0.75, 0, 0, TAU); g.fill();
  }
  // 煙燻
  stain(g, W - 60, H - 80, 200, { seed: 535, color: [10, 8, 6], alpha: 0.55, blobs: 16, soft: 0.8 });
  stain(g, W - 20, 30, 90, { seed: 536, color: [10, 8, 6], alpha: 0.4, blobs: 10, soft: 0.8 });
  // 燒掉的右下角
  burnEdges(g, W, H, { seed: 537, base: 3, corner: [W + 30, H + 30, 150], amount: 1 });
  return canvas;
}

// -----------------------------------------------------------------------------
// 交接日誌：內頁（橫線紙、焦邊、水漬、與便利貼同一隻手的筆跡）
// -----------------------------------------------------------------------------
export function logbookPage(SCRIPT) {
  const W = 512, H = 680;
  const mott = field(W, H, { cells: 3, octaves: 5, seed: 541 }, 4);
  const fib = field(W, H, { cells: 64, cellsY: 170, octaves: 2, seed: 542 }, 2);
  const gr = grain(W, H, 543);
  const pix = new Pix(W, H);
  for (let i = 0; i < W * H; i++) {
    const k = (0.92 + 0.1 * mott[i]) * (0.985 + 0.03 * fib[i]) + (gr[i] - 0.5) * 0.03;
    const yel = smooth(0.4, 1, mott[i]) * 0.5;
    pix.set(i, 228 * k, (218 - 10 * yel) * k, (194 - 26 * yel) * k);
  }
  const { canvas, g } = pix.toCanvas();
  // 印刷：表頭、橫線、紅色邊線
  const top = 112, gap = 34;
  g.fillStyle = 'rgba(70,90,140,0.55)';
  for (let y = top; y < H - 30; y += gap) g.fillRect(24, y, W - 48, 1.2);
  g.fillStyle = 'rgba(180,60,60,0.5)'; g.fillRect(68, 30, 1.3, H - 60); g.fillRect(72, 30, 1.3, H - 60);
  drawFitted(g, '交接日誌', W - 40, 46, 200, { size: 20, font: FONTS.serif, weight: '700', color: 'rgba(60,70,100,0.8)', align: 'right' });
  drawFitted(g, '日期', 84, 62, 60, { size: 17, font: FONTS.ui, weight: '600', color: 'rgba(60,70,100,0.8)', align: 'left' });
  g.fillStyle = 'rgba(60,70,100,0.6)'; g.fillRect(124, 72, 160, 1.2);
  drawFitted(g, '值班員', 300, 62, 60, { size: 17, font: FONTS.ui, weight: '600', color: 'rgba(60,70,100,0.8)', align: 'left' });
  g.fillRect(360, 72, 120, 1.2);
  // 筆跡
  const size = 26;
  // 與便利貼同一套墨水處理（扭曲尺度依字級縮放）；整頁共用一個處理器
  const proc = new InkProcessor(W, H, { seed: 4242, cellPx: 22 * (28 / 44) });
  const ink = mkCanvas(W, H);
  const body = SCRIPT?.items?.logbook?.body ?? [];
  const entriesText = quoted(body[1] ?? '', '');
  const lastText = quoted(body[3] ?? '', '');
  const entries = entriesText ? entriesText.split(/(?=\d{2}:\d{2})/).map((s) => s.trim()).filter(Boolean) : [];
  const maxW = W - 84 - 34;
  let row = 0;
  const base = (r) => top + gap * r - 7;
  // 日期欄：被水暈開、無法辨識（直接以模糊疊上，不經墨水處理）
  const smear = mkCanvas(W, 120, false);
  inkLines(smear, ['＿＿年＿＿月＿＿日'], 132, 68, { size: 20, seed: 77, jitter: 1.4 });
  g.save(); g.globalAlpha = 0.3; g.filter = 'blur(2.2px)'; g.drawImage(smear.canvas, 0, 0); g.restore();
  ink.g.clearRect(0, 0, W, H);
  // 時間「01:45」：數字照常手寫，冒號用兩個墨點（避免全形冒號置中造成的空隙）
  const timeLine = (line, x, y, seed, jitter) => {
    const m = /^(\d{1,2})[:：](\d{2})(.*)$/.exec(line);
    if (!m) return inkLines(ink, [line], x, y, { size, seed, jitter });
    const p1 = inkLines(ink, [m[1]], x, y, { size, seed, jitter });
    const cx = p1.x + size * 0.08;
    ink.g.fillStyle = HAND.color;
    for (const dy of [0.1, 0.42]) { ink.g.beginPath(); ink.g.arc(cx, y - size * dy, size * 0.06, 0, TAU); ink.g.fill(); }
    return inkLines(ink, [m[2] + m[3]], cx + size * 0.14, y, { size, seed: seed + 7, jitter });
  };
  entries.forEach((e, k) => {
    const lines = wrapHand(e, maxW, size);
    const jitter = 1 + k * 0.4; // 越寫越慌
    lines.forEach((ln, li) => timeLine(ln, 84, base(row + li), HAND.seed + 31 * (k + 1) + li, jitter));
    row += lines.length;
  });
  // 最後一頁的那兩句：與便利貼完全同一隻手（同函式、同顏色、同抖動、同字形扭曲）
  if (lastText) {
    row += 2;
    const lines = wrapHand(lastText, maxW, 30).length > 1 ? lastText.split(/(?<=。)/).filter(Boolean) : [lastText];
    lines.forEach((ln, li) => inkLines(ink, [ln], 86, base(row + li) + 3, { size: 30, seed: HAND.seed + li, jitter: 1 }));
    row += lines.length;
  }
  // 整頁的墨水一次處理
  proc.apply(ink.canvas, g, { amp: 1.4, erode: 0.5 });
  // 水漬：內頁中段的潮線（墨水被暈淡）
  const rnd = rng(544);
  const wy = base(2) - 10;
  const wash = g.createRadialGradient(330, wy, 10, 330, wy, 110);
  wash.addColorStop(0, 'rgba(226,214,186,0.35)'); wash.addColorStop(1, 'rgba(226,214,186,0)');
  g.fillStyle = wash; g.beginPath(); g.ellipse(330, wy, 120, 80, 0.3, 0, TAU); g.fill();
  waterRing(g, 330, wy, 92, rnd, 0.28);
  waterRing(g, 120, H - 120, 46, rnd, 0.32);
  waterRing(g, 150, H - 104, 44, rnd, 0.2);
  // 煙燻與焦邊（右上角燒得最嚴重）
  stain(g, W - 30, 20, 160, { seed: 545, color: [40, 26, 14], alpha: 0.35, blobs: 14, soft: 0.85 });
  stain(g, 30, H - 20, 120, { seed: 546, color: [40, 26, 14], alpha: 0.3, blobs: 12, soft: 0.85 });
  burnEdges(g, W, H, { seed: 547, base: 10, corner: [W + 20, -20, 120], amount: 1 });
  return canvas;
}

// -----------------------------------------------------------------------------
// 消防救援外套背面
// -----------------------------------------------------------------------------
export function coatBack(SCRIPT) {
  const W = 512, H = 512;
  const dirt = field(W, H, { cells: 4, octaves: 5, seed: 551 }, 4);
  const mott = field(W, H, { cells: 10, octaves: 3, seed: 552 }, 2);
  const foamN = field(W, H, { cells: 7, octaves: 5, seed: 556 }, 4);
  const sootN = field(W, H, { cells: 3, octaves: 5, seed: 557 }, 4);
  const gr = grain(W, H, 553);
  const strips = [[112, 160], [404, 452]];
  const pix = new Pix(W, H);
  for (let y = 0; y < H; y++) {
    const s = strips.find(([a, c]) => y >= a && y < c);
    const textBand = smooth(176, 186, y) * smooth(238, 228, y); // 字樣附近不放泡沫
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      // 防裂格紋（ripstop）＋細編織
      const weave = ((x & 1) ^ ((y >> 1) & 1)) ? 1.03 : 0.97;
      const rip = (x % 16 === 0 || y % 16 === 0) ? 0.94 : 1;
      const k = weave * rip * (0.92 + 0.12 * mott[i]) + (gr[i] - 0.5) * 0.05;
      let r = 192 * k, g = 162 * k, b = 94 * k;
      if (s) {
        const ly = y - s[0], hgt = s[1] - s[0];
        if (ly < 9 || ly >= hgt - 9) { r = 196 * k; g = 222 * k; b = 58 * k; } // 螢光黃綠邊
        else { // 銀色反光條（微稜鏡格紋）
          const prism = ((x + ly * 2) % 6 < 3 ? 1.05 : 0.95) * (((x - ly * 2) % 6 + 6) % 6 < 3 ? 1.03 : 0.97);
          const v = 198 * prism * (0.93 + 0.1 * mott[i]);
          r = v; g = v * 1.01; b = v * 1.03;
        }
      }
      // 污垢（下襬、兩側較重）
      const edge = smooth(80, 0, Math.min(x, W - 1 - x)) * 0.45 + smooth(H * 0.72, H, y) * 0.55;
      const dk = clamp(0.24 * smooth(0.45, 0.9, dirt[i]) + 0.32 * edge * (0.6 + 0.4 * dirt[i]));
      r *= 1 - dk; g *= 1 - dk * 1.04; b *= 1 - dk * 0.92;
      // 煙燻：不規則的大片黑灰（肩部與下襬較重）
      const sw = 0.35 + 0.65 * Math.max(smooth(150, 0, y), smooth(300, H, y));
      const so = smooth(0.48, 0.85, sootN[i]) * sw * 0.7;
      r += (22 - r) * so; g += (19 - g) * so; b += (16 - b) * so;
      // 乾掉的滅火泡沫：硬邊、薄、帶粗糙顆粒的米白色殼
      const fm = smooth(0.73, 0.78, foamN[i]) * (1 - textBand) * (s ? 0.5 : 1);
      if (fm > 0) {
        const crust = (0.75 + 0.4 * gr[i]) * 0.3 * fm;
        r += (214 - r) * crust; g += (208 - g) * crust; b += (186 - b) * crust;
      }
      pix.set(i, r, g, b);
    }
  }
  const { canvas, g } = pix.toCanvas();
  // 縫線
  g.save(); g.setLineDash([5, 4]); g.strokeStyle = 'rgba(80,62,30,0.5)'; g.lineWidth = 1.3;
  for (const x of [34, 478]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  g.beginPath(); g.moveTo(0, 60); g.quadraticCurveTo(W / 2, 78, W, 60); g.stroke();
  for (const [a, c] of strips) for (const y of [a + 2, c - 2]) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  g.restore();
  g.fillStyle = 'rgba(0,0,0,0.2)'; for (const x of [32, 476]) g.fillRect(x, 0, 2, H);
  // 字樣（褪色但清晰）
  const body = SCRIPT?.items?.coat?.body?.[0] ?? '';
  const unit = quoted(body, '雪嶺隧道特種消防救援隊', 0);
  const letters = stencilLayer(W, H, (mg) => {
    mg.textAlign = 'center'; mg.textBaseline = 'middle';
    mg.font = `900 40px ${FONTS.ui}`;
    const tw = mg.measureText(unit).width;
    mg.save(); mg.translate(W / 2, 206); if (tw > W - 80) mg.scale((W - 80) / tw, 1); mg.fillText(unit, 0, 0); mg.restore();
  }, { color: [26, 28, 36], alpha: 0.84, seed: 554, wear: 0.28, overspray: 0.0 });
  g.drawImage(letters, 0, 0);
  const rnd = rng(555);
  // 泡沫與煙灰往下流的痕跡
  for (let i = 0; i < 7; i++) {
    const x = 40 + rnd() * (W - 80), y = 250 + rnd() * 140;
    drip(g, x, y, 30 + rnd() * 90, 3 + rnd() * 6, i % 2 ? [24, 20, 16] : [212, 208, 188], 0.13, rnd, 1);
  }
  // 小燒孔
  for (const [x, y, r] of [[300, 470, 4], [110, 300, 3], [440, 360, 2.5]]) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r * 3);
    rg.addColorStop(0, 'rgba(8,6,4,1)'); rg.addColorStop(0.35, 'rgba(34,22,12,0.85)'); rg.addColorStop(1, 'rgba(80,50,20,0)');
    g.fillStyle = rg; g.beginPath(); g.arc(x, y, r * 3, 0, TAU); g.fill();
  }
  return canvas;
}

// -----------------------------------------------------------------------------
// 咖啡液面（俯視；圓形填滿畫布，圓外為白色陶瓷杯緣）
// -----------------------------------------------------------------------------
export function coffeeSurface(stage = 0) {
  const S = 256, C = S / 2, R = 124;
  const pix = new Pix(S, S);
  const n = field(S, S, { cells: 4, octaves: 4, seed: 601 + stage }, 2);
  const gr = grain(S, S, 602);
  const wl = stage === 2 ? worley(S, S, { cells: 9, seed: 603 }) : null;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x, r = hyp(x + 0.5 - C, y + 0.5 - C) / R;
    let cr, cg, cb;
    if (r > 1) { const v = 206 - 24 * smooth(1, 1.05, r); cr = v; cg = v - 4; cb = v - 10; }
    else if (stage === 0) {
      const k = 0.85 + 0.25 * n[i];
      const edge = smooth(0.93, 1, r);
      cr = 22 * k + (78 - 22 * k) * edge; cg = 12 * k + (48 - 12 * k) * edge; cb = 6 * k + (24 - 6 * k) * edge;
    } else if (stage === 1) {
      const k = 0.85 + 0.3 * n[i];
      const edge = smooth(0.9, 1, r);
      const film = 40 * smooth(0.55, 0.85, n[i]) * 0.25; // 油膜
      cr = 34 * k + (86 - 34 * k) * edge + film; cg = 22 * k + (60 - 22 * k) * edge + film; cb = 13 * k + (38 - 13 * k) * edge + film;
    } else {
      // 以噪音扭曲取樣座標，讓龜裂線彎曲不規則
      const wx = Math.min(S - 1, Math.max(0, Math.round(x + (n[i] - 0.5) * 18))), wy = Math.min(S - 1, Math.max(0, Math.round(y + (n[(i + 97 * S) % (S * S)] - 0.5) * 18)));
      const j = wy * S + wx;
      const edge = wl.f2[j] - wl.f1[j];
      const crack = smooth(0.06, 0.0, edge) * 0.6;
      const flake = 1 - clamp(wl.f1[j] / 0.7);
      const ringA = 0.5 + 0.5 * Math.sin(r * 60 + n[i] * 6);
      const v = 26 + 18 * flake + 10 * ringA * smooth(0.6, 1, r) + 10 * gr[i];
      cr = v * 1.25; cg = v * 0.9; cb = v * 0.62;
      cr += (140 - cr) * crack; cg += (104 - cg) * crack; cb += (70 - cb) * crack;
      const ring = smooth(0.82, 0.98, r) * 0.6;
      cr += (96 - cr) * ring; cg += (64 - cg) * ring; cb += (40 - cb) * ring;
    }
    const nn = (gr[i] - 0.5) * (stage === 0 ? 3 : 8);
    pix.set(i, cr + nn, cg + nn, cb + nn);
  }
  const { canvas, g } = pix.toCanvas();
  const rnd = rng(604 + stage);
  g.save(); g.beginPath(); g.arc(C, C, R, 0, TAU); g.clip();
  if (stage === 0) {
    // 日光燈管的倒影＋柔和反光
    const sh = g.createRadialGradient(C - 30, C - 34, 4, C - 30, C - 34, 80);
    sh.addColorStop(0, 'rgba(255,240,220,0.18)'); sh.addColorStop(1, 'rgba(255,240,220,0)');
    g.fillStyle = sh; g.fillRect(0, 0, S, S);
    g.save(); g.translate(C - 22, C - 40); g.rotate(-0.35); g.scale(1, 0.16);
    const tube = g.createRadialGradient(0, 0, 0, 0, 0, 50);
    tube.addColorStop(0, 'rgba(255,252,240,0.62)'); tube.addColorStop(0.55, 'rgba(255,252,240,0.38)'); tube.addColorStop(1, 'rgba(255,252,240,0)');
    g.fillStyle = tube; g.beginPath(); g.arc(0, 0, 50, 0, TAU); g.fill();
    g.restore();
    // 杯緣的小泡泡
    for (let i = 0; i < 26; i++) {
      const a = rnd() * TAU, d = R * (0.86 + rnd() * 0.1), r = 1 + rnd() * 3;
      const x = C + Math.cos(a) * d, y = C + Math.sin(a) * d;
      g.fillStyle = 'rgba(150,100,60,0.5)'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      g.fillStyle = 'rgba(255,240,220,0.6)'; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, TAU); g.fill();
    }
  } else if (stage === 1) {
    // 暗淡的反光
    const sh = g.createRadialGradient(C - 30, C - 34, 4, C - 30, C - 34, 70);
    sh.addColorStop(0, 'rgba(220,210,190,0.1)'); sh.addColorStop(1, 'rgba(220,210,190,0)');
    g.fillStyle = sh; g.fillRect(0, 0, S, S);
    // 浮灰：細小灰色碎屑，靠杯緣聚集
    for (let i = 0; i < 260; i++) {
      const edgeBias = rnd() < 0.55;
      const a = rnd() * TAU, d = R * (edgeBias ? 0.75 + rnd() * 0.22 : Math.sqrt(rnd()) * 0.9);
      const x = C + Math.cos(a) * d, y = C + Math.sin(a) * d;
      const s = 0.5 + Math.pow(rnd(), 3) * 3.5;
      const v = 120 + rnd() * 90;
      g.fillStyle = `rgba(${v},${v - 2},${v - 6},${0.4 + rnd() * 0.5})`;
      g.beginPath();
      const m = 5; for (let k = 0; k < m; k++) { const aa = (k / m) * TAU + rnd(); const rr = s * (0.5 + rnd() * 0.7); if (k) g.lineTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr); else g.moveTo(x + Math.cos(aa) * rr, y + Math.sin(aa) * rr); }
      g.closePath(); g.fill();
    }
  } else {
    // 焦灰
    for (let i = 0; i < 200; i++) {
      const a = rnd() * TAU, d = R * Math.sqrt(rnd());
      const v = 90 + rnd() * 60;
      g.fillStyle = `rgba(${v},${v - 3},${v - 7},${0.2 + rnd() * 0.4})`;
      g.beginPath(); g.arc(C + Math.cos(a) * d, C + Math.sin(a) * d, 0.5 + rnd() * 2, 0, TAU); g.fill();
    }
    stain(g, C + 20, C + 10, 60, { seed: 605, color: [10, 8, 6], alpha: 0.4, blobs: 10, soft: 0.85 });
  }
  g.restore();
  // 液面與杯壁交界的細陰影線
  g.strokeStyle = stage === 2 ? 'rgba(60,40,24,0.5)' : 'rgba(30,18,10,0.6)'; g.lineWidth = 2;
  g.beginPath(); g.arc(C, C, R, 0, TAU); g.stroke();
  return canvas;
}

// -----------------------------------------------------------------------------
// 雪嶺隧道 平面配置圖（1024×640，泛黃印刷圖）
// -----------------------------------------------------------------------------
export function tunnelMap(SCRIPT) {
  const W = 1024, H = 640;
  const mott = field(W, H, { cells: 4, octaves: 5, seed: 621 }, 4);
  const gr = grain(W, H, 622);
  const pix = new Pix(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const de = Math.min(x, y, W - 1 - x, H - 1 - y);
    const age = 0.25 * smooth(60, 0, de) + 0.3 * smooth(0.5, 1, mott[i]);
    const k = 0.95 + 0.06 * mott[i] + (gr[i] - 0.5) * 0.03;
    pix.set(i, (226 - 30 * age) * k, (217 - 40 * age) * k, (186 - 62 * age) * k);
  }
  const { canvas, g } = pix.toCanvas();
  const ink = 'rgba(44,56,78,0.88)', inkL = 'rgba(44,56,78,0.55)', red = 'rgba(176,52,40,0.85)';
  const T = (txt, x, y, size, o = {}) => drawFitted(g, txt, x, y, o.maxW ?? 400, { size, font: o.font ?? FONTS.ui, weight: o.weight ?? '700', color: o.color ?? ink, align: o.align ?? 'center' });
  // 標題
  T('雪嶺隧道　平面配置圖', 56, 54, 40, { align: 'left', weight: '900', maxW: 560 });
  T('XUELING TUNNEL — GENERAL LAYOUT ／ 避難設施及監控配置', 58, 92, 15, { align: 'left', weight: '600', maxW: 560, color: inkL });
  g.fillStyle = ink; g.fillRect(56, 106, 560, 2.5);
  // 隧道主體
  const x0 = 110, x1 = 930;
  const tubes = [{ y: 214, name: '北上線' }, { y: 330, name: '南下線' }];
  const th = 40;
  for (const t of tubes) {
    g.fillStyle = 'rgba(236,228,200,0.9)'; g.fillRect(x0, t.y - th / 2, x1 - x0, th);
    g.strokeStyle = ink; g.lineWidth = 3; g.strokeRect(x0, t.y - th / 2, x1 - x0, th);
    g.save(); g.setLineDash([14, 10]); g.strokeStyle = inkL; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x0 + 6, t.y); g.lineTo(x1 - 6, t.y); g.stroke(); g.restore();
    T(t.name, x0 - 54, t.y, 18);
  }
  // 洞口
  T('北口', x0 - 4, tubes[0].y - 54, 18, { weight: '800' });
  T('南口', x1 + 4, tubes[1].y + 56, 18, { weight: '800' });
  for (const [x, y, dir] of [[x0 + 60, tubes[0].y, -1], [x1 - 60, tubes[1].y, 1]]) { // 行車方向箭頭
    g.fillStyle = inkL; g.beginPath(); g.moveTo(x + dir * 22, y); g.lineTo(x - dir * 4, y - 9); g.lineTo(x - dir * 4, y + 9); g.closePath(); g.fill();
  }
  // 聯絡道（人行／車行交替）
  const yA = tubes[0].y + th / 2, yB = tubes[1].y - th / 2;
  for (let k = 0; k < 7; k++) {
    const x = x0 + 100 + k * 105, car = k % 3 === 1;
    if (car) { g.fillStyle = 'rgba(236,228,200,0.9)'; g.fillRect(x - 12, yA, 24, yB - yA); g.strokeStyle = ink; g.lineWidth = 2; g.strokeRect(x - 12, yA, 24, yB - yA); }
    else { g.save(); g.strokeStyle = ink; g.lineWidth = 2.5; g.setLineDash([6, 5]); g.beginPath(); g.moveTo(x, yA); g.lineTo(x, yB); g.stroke(); g.restore(); }
  }
  // 緊急停車彎 1–6
  const bays = [];
  for (let k = 0; k < 6; k++) {
    const top = k % 2 === 0;
    const x = x0 + 150 + k * 125;
    const ty = top ? tubes[0].y - th / 2 : tubes[1].y + th / 2;
    const dir = top ? -1 : 1;
    g.fillStyle = 'rgba(236,228,200,0.95)';
    g.beginPath(); g.moveTo(x - 34, ty); g.lineTo(x - 20, ty + dir * 16); g.lineTo(x + 20, ty + dir * 16); g.lineTo(x + 34, ty); g.closePath(); g.fill();
    g.strokeStyle = ink; g.lineWidth = 2.5; g.stroke();
    const cy = ty + dir * 34;
    g.fillStyle = 'rgba(232,224,196,1)'; g.beginPath(); g.arc(x, cy, 13, 0, TAU); g.fill();
    g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.arc(x, cy, 13, 0, TAU); g.stroke();
    T(String(k + 1), x, cy + 1, 17, { weight: '900' });
    bays.push([x, ty, dir]);
  }
  // 中央控制室＋公務維修廊道＋電閘室
  const crx = 560, cry = 456;
  g.save(); g.setLineDash([10, 6]); g.strokeStyle = 'rgba(100,70,40,0.9)'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(crx + 60, cry); g.lineTo(820, cry); g.lineTo(820, cry + 50); g.stroke();
  g.beginPath(); g.moveTo(crx - 60, cry); g.lineTo(400, cry); g.lineTo(400, tubes[1].y + th / 2 + 2); g.stroke();
  g.restore();
  T('公務維修廊道', 700, cry - 16, 15, { color: 'rgba(100,70,40,0.95)' });
  T('B區', 450, cry - 16, 15, { color: 'rgba(100,70,40,0.95)', weight: '900' });
  g.fillStyle = 'rgba(214,200,160,0.95)'; g.fillRect(crx - 60, cry - 26, 120, 52);
  g.strokeStyle = ink; g.lineWidth = 3; g.strokeRect(crx - 60, cry - 26, 120, 52);
  T('中央控制室', crx, cry, 19, { weight: '900', maxW: 112 });
  g.fillStyle = 'rgba(214,200,160,0.95)'; g.fillRect(790, cry + 50, 60, 34); g.strokeStyle = ink; g.lineWidth = 2; g.strokeRect(790, cry + 50, 60, 34);
  T('電閘室', 820, cry + 67, 14, { weight: '800', maxW: 56 });
  // 現在位置
  g.fillStyle = red; g.beginPath(); g.arc(crx - 80, cry + 40, 8, 0, TAU); g.fill();
  T('現在位置', crx - 80, cry + 62, 15, { color: red, weight: '900' });
  // 監視攝影機
  const cam = (x, y, label, dirA = 0) => {
    g.save(); g.translate(x, y); g.rotate(dirA);
    g.fillStyle = red; g.fillRect(-10, -6, 18, 12); g.beginPath(); g.moveTo(8, -4); g.lineTo(16, -8); g.lineTo(16, 8); g.lineTo(8, 4); g.closePath(); g.fill();
    g.restore();
    T(label, x, y - 18, 13, { color: red, weight: '800' });
  };
  const camId = (n) => SCRIPT?.cams?.[n]?.id ?? `CAM-0${n}`;
  cam(x0 + 26, tubes[0].y - 46, camId(1), 0);
  cam((x0 + x1) / 2 + 10, tubes[1].y + 2, camId(2), Math.PI);
  cam(452, cry + 22, camId(3), Math.PI);
  const b4 = bays[3];
  cam(b4[0] + 52, b4[1] + b4[2] * 26, camId(4), Math.PI);
  // 圖例
  const lx = 690, ly = 528, lw = 300, lh = 92;
  g.fillStyle = 'rgba(232,222,190,0.9)'; g.fillRect(lx, ly, lw, lh); g.strokeStyle = ink; g.lineWidth = 2; g.strokeRect(lx, ly, lw, lh);
  T('圖例', lx + 26, ly + 16, 14, { weight: '900' });
  const leg = [
    [(x, y) => { g.strokeStyle = ink; g.lineWidth = 2; g.strokeRect(x - 10, y - 6, 20, 12); }, '車行聯絡道'],
    [(x, y) => { g.save(); g.setLineDash([4, 3]); g.strokeStyle = ink; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x - 10, y); g.lineTo(x + 10, y); g.stroke(); g.restore(); }, '人行聯絡道'],
    [(x, y) => { g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, TAU); g.stroke(); }, '緊急停車彎'],
    [(x, y) => { g.save(); g.setLineDash([6, 4]); g.strokeStyle = 'rgba(100,70,40,0.9)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x - 10, y); g.lineTo(x + 10, y); g.stroke(); g.restore(); }, '公務維修廊道'],
    [(x, y) => { g.fillStyle = red; g.fillRect(x - 8, y - 5, 14, 10); }, '監視攝影機'],
    [(x, y) => { g.fillStyle = red; g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill(); }, '現在位置'],
  ];
  leg.forEach(([icon, label], k) => {
    const cx = lx + 30 + (k % 2) * 150, cy = ly + 38 + Math.floor(k / 2) * 22;
    icon(cx, cy); T(label, cx + 18, cy + 1, 13, { align: 'left', weight: '600' });
  });
  // 指北針、比例尺
  g.save(); g.translate(950, 60);
  g.strokeStyle = ink; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 26, 0, TAU); g.stroke();
  g.fillStyle = ink; g.beginPath(); g.moveTo(-22, 0); g.lineTo(10, -7); g.lineTo(10, 7); g.closePath(); g.fill();
  g.restore();
  T('N', 910, 60, 18, { weight: '900' });
  g.fillStyle = ink; g.fillRect(60, 586, 200, 3);
  for (let k = 0; k <= 4; k++) g.fillRect(60 + k * 50, 578, 2, 14);
  g.fillRect(60, 580, 50, 9); g.fillRect(160, 580, 50, 9);
  T('0', 60, 604, 12); T('500', 160, 604, 12); T('1000 m', 268, 604, 12);
  T('雪嶺隧道管理站　製', 60, 626, 12, { align: 'left', weight: '500', color: inkL });
  // 老化：膠帶、水漬、折痕、圖釘孔
  const rnd = rng(623);
  for (const [x, y, a] of [[24, 20, -0.5], [W - 24, 22, 0.5], [26, H - 22, 0.45], [W - 26, H - 20, -0.4]]) {
    g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = 'rgba(214,196,130,0.5)'; g.fillRect(-36, -12, 72, 24);
    g.strokeStyle = 'rgba(150,130,70,0.35)'; g.lineWidth = 1; g.strokeRect(-36, -12, 72, 24); g.restore();
  }
  stain(g, 880, 470, 120, { seed: 624, color: [150, 110, 50], alpha: 0.22, blobs: 14, soft: 0.8 });
  g.strokeStyle = 'rgba(130,90,40,0.25)'; g.lineWidth = 2;
  g.beginPath(); g.ellipse(880, 470, 110, 80, 0.2, 0, TAU); g.stroke();
  for (const x of [W / 3, (2 * W) / 3]) { g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(x - 1, 0, 2, H); g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(x + 1, 0, 2, H); }
  g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(0, H / 2 - 1, W, 2);
  for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(90,70,40,${rnd() * 0.15})`; g.fillRect(rnd() * W, rnd() * H, 1 + rnd() * 2, 1 + rnd() * 2); }
  return canvas;
}
