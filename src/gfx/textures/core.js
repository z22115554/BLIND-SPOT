// =============================================================================
// TextureFactory 內部工具：快速、可平鋪的噪音場（value-noise fbm / Worley）、
// 像素緩衝、常用的 Canvas 筆觸（鉚釘、螺絲、刮痕、流痕、噴漆字）。
// 所有函式都是確定性的（同 seed → 同一張圖）。
// =============================================================================
import { rng } from '../../core/util.js';

export { rng };
export const TAU = Math.PI * 2;
/** 比 Math.hypot 快很多的二維長度（熱迴圈用） */
export const hyp = (a, b) => Math.sqrt(a * a + b * b);
/** 與 util.clamp 相同語意，但寫成可被內聯的形式（熱迴圈用） */
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

/** 建立 canvas。read = true 時以 willReadFrequently 建立（純 CPU，像素讀寫快，不經 GPU 回讀）。 */
export function mkCanvas(w, h, read = true) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d', read ? { willReadFrequently: true } : undefined);
  return { canvas, g, w, h };
}

export const smooth = (e0, e1, x) => { let t = (x - e0) / (e1 - e0); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

/** 32-bit 整數雜湊 → [0,1) */
export function hash3(x, y, s) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * 可平鋪的 value-noise fbm 場（每個 octave 都有獨立的晶格，不會出現自我重複）。
 * W×H 輸出解析度；cells = 第一層橫向格數；cellsY 預設依長寬比。值域約 0..1（normalize = true 時拉伸到 0..1）。
 */
export function fbmField(W, H, { cells = 4, cellsY = null, octaves = 4, gain = 0.5, lac = 2, seed = 1, ridged = false, normalize = true } = {}) {
  const out = new Float32Array(W * H);
  let cx = cells, cy = cellsY ?? Math.max(1, Math.round(cells * H / W));
  let amp = 1;
  const x0 = new Int32Array(W), x1 = new Int32Array(W), tx = new Float32Array(W);
  for (let o = 0; o < octaves; o++) {
    const r = rng((seed * 7919 + o * 104729) >>> 0);
    const lat = new Float32Array(cx * cy);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let x = 0; x < W; x++) {
      const f = (x / W) * cx; const i = Math.floor(f); const t = f - i;
      x0[x] = i % cx; x1[x] = (i + 1) % cx; tx[x] = t * t * (3 - 2 * t);
    }
    for (let y = 0; y < H; y++) {
      const f = (y / H) * cy; const i = Math.floor(f); let t = f - i; t = t * t * (3 - 2 * t);
      const r0 = (i % cy) * cx, r1 = ((i + 1) % cy) * cx;
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const a = lat[r0 + x0[x]], b = lat[r0 + x1[x]], c = lat[r1 + x0[x]], d = lat[r1 + x1[x]];
        const u = tx[x];
        const top = a + (b - a) * u, bot = c + (d - c) * u;
        let v = top + (bot - top) * t;
        if (ridged) v = 1 - Math.abs(v * 2 - 1);
        out[row + x] += v * amp;
      }
    }
    amp *= gain;
    cx = Math.max(1, Math.round(cx * lac)); cy = Math.max(1, Math.round(cy * lac));
  }
  if (normalize) stretch(out); else { let n = 0, a = 1; for (let o = 0; o < octaves; o++) { n += a; a *= gain; } for (let i = 0; i < out.length; i++) out[i] /= n; }
  return out;
}

/** 線性拉伸到 0..1（以 0.5% / 99.5% 分位近似：用 min/max 再略收） */
export function stretch(f) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < f.length; i++) { const v = f[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = mx - mn || 1;
  for (let i = 0; i < f.length; i++) f[i] = (f[i] - mn) / span;
  return f;
}

/** 雙線性重取樣（環繞、可分離：先橫向後縱向），把低解析度噪音場放大成貼圖解析度 */
export function resample(src, sw, sh, W, H) {
  if (sw === W && sh === H) return src;
  const tmp = new Float32Array(W * sh);
  const xa = new Int32Array(W), xb = new Int32Array(W), xt = new Float32Array(W);
  const sx = sw / W, sy = sh / H;
  for (let x = 0; x < W; x++) { const f = (x + 0.5) * sx - 0.5; const i = Math.floor(f); xt[x] = f - i; xa[x] = ((i % sw) + sw) % sw; xb[x] = (xa[x] + 1) % sw; }
  for (let y = 0; y < sh; y++) {
    const ro = y * sw, to = y * W;
    for (let x = 0; x < W; x++) { const a = src[ro + xa[x]]; tmp[to + x] = a + (src[ro + xb[x]] - a) * xt[x]; }
  }
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const f = (y + 0.5) * sy - 0.5; const i = Math.floor(f); const t = f - i;
    const y0 = ((i % sh) + sh) % sh, r0 = y0 * W, r1 = ((y0 + 1) % sh) * W, o = y * W;
    for (let x = 0; x < W; x++) { const v = tmp[r0 + x]; out[o + x] = v + (tmp[r1 + x] - v) * t; }
  }
  return out;
}

/** 在噪音場上以任意（浮點、環繞）座標做雙線性取樣 */
export function sampleField(f, W, H, x, y) {
  const fx = Math.floor(x), fy = Math.floor(y), tx = x - fx, ty = y - fy;
  const x0 = ((fx % W) + W) % W, y0 = ((fy % H) + H) % H, x1 = (x0 + 1) % W, y1 = (y0 + 1) % H;
  const a = f[y0 * W + x0], b = f[y0 * W + x1], c = f[y1 * W + x0], d = f[y1 * W + x1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

/** 低解析度 fbm 再放大：W×H 輸出、以 1/div 解析度計算（低頻噪音不需要全解析度） */
export function field(W, H, opts = {}, div = 4) {
  const w = Math.max(8, Math.round(W / div)), h = Math.max(8, Math.round(H / div));
  // 超過低解析度可表現的 octave 只會產生混疊，直接略過
  const cells = opts.cells ?? 4;
  const maxOct = Math.max(1, Math.floor(Math.log2(Math.max(1, w / cells))) + 1);
  const o = { ...opts, octaves: Math.min(opts.octaves ?? 4, maxOct) };
  return resample(fbmField(w, h, o), w, h, W, H);
}

/** 白噪音（每像素）。共用一塊預先產生的大緩衝，依 seed 取不同的位移視窗（唯讀！） */
let GRAIN = null;
export function grain(W, H, seed = 1) {
  const n = W * H;
  if (!GRAIN) { const r = rng(9137); GRAIN = new Float32Array(1 << 20); for (let i = 0; i < GRAIN.length; i++) GRAIN[i] = r(); }
  if (n > GRAIN.length) { const r = rng(seed); const out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = r(); return out; }
  const off = (Math.imul(seed | 0, 2654435761) >>> 0) % (GRAIN.length - n + 1);
  return GRAIN.subarray(off, off + n);
}

/**
 * 可平鋪的 Worley（細胞）噪音。回傳 f1、f2（以格子為單位的距離）與最近特徵點的格子 id。
 */
export function worley(W, H, { cells = 8, cellsY = null, seed = 1, jitter = 0.9 } = {}) {
  const cx = cells, cy = cellsY ?? Math.max(1, Math.round(cells * H / W));
  const r = rng(seed);
  const fx = new Float32Array(cx * cy), fy = new Float32Array(cx * cy);
  for (let i = 0; i < cx * cy; i++) { fx[i] = 0.5 + (r() - 0.5) * jitter; fy[i] = 0.5 + (r() - 0.5) * jitter; }
  const f1 = new Float32Array(W * H), f2 = new Float32Array(W * H), id = new Int32Array(W * H);
  // 每欄預先算好三個鄰格的環繞索引與相對位移
  const colW = new Int32Array(W * 3), colD = new Float32Array(W * 3);
  for (let x = 0; x < W; x++) {
    const u = ((x + 0.5) / W) * cx; const ci = Math.floor(u);
    for (let di = -1; di <= 1; di++) { const ii = ci + di; colW[x * 3 + di + 1] = ((ii % cx) + cx) % cx; colD[x * 3 + di + 1] = ii - u; }
  }
  const rowB = new Int32Array(3), rowD = new Float64Array(3);
  for (let y = 0; y < H; y++) {
    const v = ((y + 0.5) / H) * cy; const cj = Math.floor(v);
    for (let dj = -1; dj <= 1; dj++) { const jj = cj + dj; rowB[dj + 1] = (((jj % cy) + cy) % cy) * cx; rowD[dj + 1] = jj - v; }
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let d1 = 9, d2 = 9, best = 0;
      const c3 = x * 3;
      for (let a = 0; a < 3; a++) {
        const rb = rowB[a], rd = rowD[a];
        for (let b = 0; b < 3; b++) {
          const k = rb + colW[c3 + b];
          const dx = colD[c3 + b] + fx[k], dy = rd + fy[k];
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
        }
      }
      const i = row + x;
      f1[i] = Math.sqrt(d1); f2[i] = Math.sqrt(d2); id[i] = best;
    }
  }
  return { f1, f2, id, cx, cy };
}

/** 灰階 Float32 場（0..1）→ canvas（用於 bump / roughness） */
export function fieldToCanvas(f, W, H, { lo = 0, hi = 1 } = {}) {
  const { canvas, g } = mkCanvas(W, H);
  const img = g.createImageData(W, H); const d = img.data;
  for (let i = 0, p = 0; i < f.length; i++, p += 4) {
    const v = (lo + (hi - lo) * clamp(f[i])) * 255;
    d[p] = d[p + 1] = d[p + 2] = v; d[p + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return canvas;
}

/** RGB(A) 像素緩衝 → canvas */
export class Pix {
  constructor(W, H) { this.W = W; this.H = H; this.img = new ImageData(W, H); this.d = this.img.data; }
  set(i, r, g, b, a = 255) { const d = this.d, p = i << 2; d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = a; }
  toCanvas() {
    const { canvas, g } = mkCanvas(this.W, this.H);
    this.putTo(g);
    return { canvas, g };
  }
  putTo(g, x = 0, y = 0) { g.putImageData(this.img, x, y); }
}

export const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** 在可平鋪貼圖上畫東西：靠近邊緣時在對側重複畫一次，讓接縫連續 */
export function wrapDraw(W, H, x, y, margin, fn) {
  const xs = [x], ys = [y];
  if (x < margin) xs.push(x + W); if (x > W - margin) xs.push(x - W);
  if (y < margin) ys.push(y + H); if (y > H - margin) ys.push(y - H);
  for (const xx of xs) for (const yy of ys) fn(xx, yy);
}

/** 預先畫好的鉚釘精靈（依顏色與半徑快取）：避免每顆鉚釘都建立漸層 */
const _rivetCache = new Map();
function rivetSprite(r, base) {
  const key = `${r.toFixed(2)}|${base.join(',')}`;
  let s = _rivetCache.get(key);
  if (s) return s;
  const S = Math.ceil(r * 2 + 6), c = S / 2;
  const col = mkCanvas(S, S, false), bump = mkCanvas(S, S, false);
  const g = col.g;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath(); g.arc(c + r * 0.35, c + r * 0.45, r * 1.08, 0, TAU); g.fill();
  const grd = g.createRadialGradient(c - r * 0.4, c - r * 0.45, r * 0.1, c, c, r);
  grd.addColorStop(0, rgba(base.map((v) => Math.min(255, v * 1.75 + 20))));
  grd.addColorStop(0.45, rgba(base));
  grd.addColorStop(1, rgba(base.map((v) => v * 0.45)));
  g.fillStyle = grd; g.beginPath(); g.arc(c, c, r, 0, TAU); g.fill();
  const hgr = bump.g.createRadialGradient(c, c, 0, c, c, r);
  hgr.addColorStop(0, 'rgb(255,255,255)'); hgr.addColorStop(0.6, 'rgb(215,215,215)'); hgr.addColorStop(1, 'rgba(160,160,160,0.0)');
  bump.g.fillStyle = hgr; bump.g.beginPath(); bump.g.arc(c, c, r * 1.05, 0, TAU); bump.g.fill();
  s = { col: col.canvas, bump: bump.canvas, c };
  _rivetCache.set(key, s);
  return s;
}

/** 半球形鉚釘（左上受光）。g 為顏色畫布；hg 為高度畫布（可省略）。 */
export function rivet(g, x, y, r, { base = [90, 96, 92], hg = null, rust = 0, rnd = Math.random } = {}) {
  const sp = rivetSprite(r, base);
  g.drawImage(sp.col, x - sp.c, y - sp.c);
  if (rust > 0) {
    const a = rust * (0.4 + rnd() * 0.6);
    g.fillStyle = `rgba(110,52,20,${a * 0.55})`;
    g.beginPath(); g.arc(x + r * 0.2, y + r * 0.3, r * 0.8, 0, TAU); g.fill();
    // 鏽水往下流
    const len = r * (3 + rnd() * 9);
    const lg = g.createLinearGradient(x, y, x, y + len);
    lg.addColorStop(0, `rgba(105,50,22,${a * 0.5})`); lg.addColorStop(1, 'rgba(105,50,22,0)');
    g.fillStyle = lg; g.fillRect(x - r * 0.35, y, r * 0.7, len);
  }
  if (hg) hg.drawImage(sp.bump, x - sp.c, y - sp.c);
}

/**
 * 與 canvasUtil.stain 相同的柔邊污漬（同樣的亂數序列、同樣的外觀），
 * 但每個斑塊改用快取的漸層精靈 drawImage（大面積徑向漸層在軟體 Canvas 上很慢）。
 */
const _stainCache = new Map();
export function softStain(g, x, y, radius, { seed = 3, color = [40, 30, 20], alpha = 0.5, blobs = 14, soft = 0.6 } = {}) {
  const key = `${color.join(',')}|${soft}`;
  let spr = _stainCache.get(key);
  if (!spr) {
    const S = 128, c = S / 2;
    const m = mkCanvas(S, S, false);
    const grd = m.g.createRadialGradient(c, c, c * (1 - soft), c, c, c);
    grd.addColorStop(0, rgba(color, 1)); grd.addColorStop(1, rgba(color, 0));
    m.g.fillStyle = grd; m.g.fillRect(0, 0, S, S);
    spr = m.canvas; _stainCache.set(key, spr);
  }
  const r = rng(seed);
  g.save();
  for (let i = 0; i < blobs; i++) {
    const a = r() * TAU, d = r() * radius * 0.6;
    const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
    const br = radius * (0.25 + r() * 0.5);
    g.globalAlpha = alpha * (0.4 + r() * 0.6);
    g.drawImage(spr, bx - br, by - br, br * 2, br * 2);
  }
  g.restore();
}

/** 十字螺絲頭 */
export function screw(g, x, y, r, { rot = 0, base = [150, 150, 146], hg = null } = {}) {
  g.fillStyle = 'rgba(0,0,0,0.4)';
  g.beginPath(); g.arc(x + r * 0.25, y + r * 0.3, r * 1.1, 0, TAU); g.fill();
  const grd = g.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  grd.addColorStop(0, rgba(base.map((v) => Math.min(255, v * 1.5)))); grd.addColorStop(0.6, rgba(base)); grd.addColorStop(1, rgba(base.map((v) => v * 0.5)));
  g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.save(); g.translate(x, y); g.rotate(rot);
  g.strokeStyle = 'rgba(20,20,20,0.85)'; g.lineWidth = Math.max(1, r * 0.28); g.lineCap = 'round';
  g.beginPath(); g.moveTo(-r * 0.6, 0); g.lineTo(r * 0.6, 0); g.moveTo(0, -r * 0.6); g.lineTo(0, r * 0.6); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = Math.max(0.6, r * 0.1);
  g.beginPath(); g.moveTo(-r * 0.6, r * 0.18); g.lineTo(r * 0.6, r * 0.18); g.stroke();
  g.restore();
  if (hg) { hg.fillStyle = 'rgb(225,225,225)'; hg.beginPath(); hg.arc(x, y, r, 0, TAU); hg.fill(); hg.fillStyle = 'rgb(120,120,120)'; hg.fillRect(x - r * 0.6, y - r * 0.12, r * 1.2, r * 0.24); hg.fillRect(x - r * 0.12, y - r * 0.6, r * 0.24, r * 1.2); }
}

/** 細刮痕：亮線（漆面刮到金屬）＋一側暗邊 */
export function scratches(g, rnd, n, { x0 = 0, y0 = 0, x1 = 512, y1 = 512, len = [10, 60], angle = null, spread = Math.PI, light = [210, 205, 195], alpha = [0.15, 0.45], width = [0.6, 1.4], hg = null } = {}) {
  g.save(); g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
    const a = angle == null ? rnd() * TAU : angle + (rnd() - 0.5) * spread;
    const L = len[0] + rnd() * (len[1] - len[0]);
    const bend = (rnd() - 0.5) * L * 0.15;
    const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
    const mx = (x + ex) / 2 - Math.sin(a) * bend, my = (y + ey) / 2 + Math.cos(a) * bend;
    const w = width[0] + rnd() * (width[1] - width[0]);
    const al = alpha[0] + rnd() * (alpha[1] - alpha[0]);
    g.strokeStyle = `rgba(0,0,0,${al * 0.5})`; g.lineWidth = w;
    g.beginPath(); g.moveTo(x + 0.7, y + 0.7); g.quadraticCurveTo(mx + 0.7, my + 0.7, ex + 0.7, ey + 0.7); g.stroke();
    g.strokeStyle = rgba(light, al); g.lineWidth = w * 0.8;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(mx, my, ex, ey); g.stroke();
    if (hg) { hg.strokeStyle = 'rgba(40,40,40,0.5)'; hg.lineWidth = w; hg.beginPath(); hg.moveTo(x, y); hg.quadraticCurveTo(mx, my, ex, ey); hg.stroke(); }
  }
  g.restore();
}

/**
 * 往下（dir=1）或往上（dir=-1）的不規則流痕：一個略蜿蜒、往尾端變細的多邊形，
 * 以沿長度方向的漸層填色（一次填滿，比逐段描線快很多）。
 */
export function drip(g, x, y, len, w, color, alpha, rnd, dir = 1) {
  const steps = Math.max(4, Math.min(40, Math.round(len / 8)));
  const L = [], R = [];
  let cx = x, drift = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const yy = y + len * t * dir;
    const half = Math.max(0.35, w * 0.5 * (1 - t * 0.65) * (0.85 + rnd() * 0.3));
    L.push([cx - half, yy]); R.push([cx + half, yy]);
    drift += (rnd() - 0.5) * w * 0.12; drift *= 0.8;
    cx += drift;
  }
  const lg = g.createLinearGradient(x, y, x, y + len * dir);
  lg.addColorStop(0, rgba(color, alpha)); lg.addColorStop(0.7, rgba(color, alpha * 0.45)); lg.addColorStop(1, rgba(color, 0));
  g.fillStyle = lg;
  g.beginPath(); g.moveTo(L[0][0], L[0][1]);
  for (let i = 1; i < L.length; i++) g.lineTo(L[i][0], L[i][1]);
  for (let i = R.length - 1; i >= 0; i--) g.lineTo(R[i][0], R[i][1]);
  g.closePath(); g.fill();
  // 尾端的水珠
  if (dir > 0 && rnd() < 0.5) { g.fillStyle = rgba(color, alpha * 0.3); g.beginPath(); g.arc(cx, y + len, Math.max(0.6, w * 0.3), 0, TAU); g.fill(); }
}

/** 以偏移量讀取噪音場（同一個場平移半張圖即可當作另一個不相關的場使用；仍可平鋪） */
export function offsetField(f, W, H, ox = W >> 1, oy = H >> 1) {
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = ((y + oy) % H) * W, o = y * W;
    const head = W - (ox % W);
    out.set(f.subarray(sy + (ox % W), sy + W), o);
    out.set(f.subarray(sy, sy + (ox % W)), o + head);
  }
  return out;
}

/** 隨機蜿蜒細線（裂縫、纖維、裂紋） */
export function crackPath(g, rnd, x, y, steps, stepLen, { angle = rnd() * TAU, wander = 0.6, color = 'rgba(0,0,0,0.5)', width = 1, branch = 0, taper = true } = {}) {
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
  let a = angle, cx = x, cy = y;
  const pts = [[cx, cy]];
  for (let i = 0; i < steps; i++) {
    a += (rnd() - 0.5) * wander;
    cx += Math.cos(a) * stepLen; cy += Math.sin(a) * stepLen;
    pts.push([cx, cy]);
    if (branch > 0 && rnd() < branch) {
      crackPath(g, rnd, cx, cy, Math.max(2, Math.floor((steps - i) * 0.5)), stepLen * 0.8, { angle: a + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.7), wander, color, width: width * 0.6, branch: 0, taper });
    }
  }
  g.strokeStyle = color;
  if (!taper) {
    g.lineWidth = width;
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.stroke();
  } else {
    for (let i = 1; i < pts.length; i++) {
      g.lineWidth = Math.max(0.4, width * (1 - (i / pts.length) * 0.7));
      g.beginPath(); g.moveTo(pts[i - 1][0], pts[i - 1][1]); g.lineTo(pts[i][0], pts[i][1]); g.stroke();
    }
  }
  g.restore();
  return pts;
}

/** 隨機折線的點（不畫），供批次描線使用 */
export function wormPoints(rnd, x, y, steps, stepLen, wander = 0.6, angle = rnd() * TAU) {
  let a = angle, cx = x, cy = y;
  const pts = [[cx, cy]];
  for (let i = 0; i < steps; i++) { a += (rnd() - 0.5) * wander; cx += Math.cos(a) * stepLen; cy += Math.sin(a) * stepLen; pts.push([cx, cy]); }
  return pts;
}

/**
 * 批次繪圖：同樣式的大量小圖形（斑點、氣孔、細紋）合併成一條路徑一次填色/描線，
 * 在軟體 Canvas 上比逐一 fill() 快一個數量級。樣式請先量化，避免產生太多批次。
 */
export function batcher() {
  const fills = new Map(), strokes = new Map();
  const push = (m, k, f) => { let a = m.get(k); if (!a) { a = []; m.set(k, a); } a.push(f); };
  return {
    fill(style, fn) { push(fills, style, fn); },
    stroke(style, width, fn) { push(strokes, `${style}|${width}`, fn); },
    dot(style, x, y, r) { push(fills, style, (g) => { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }); },
    poly(style, width, pts) { push(strokes, `${style}|${width}`, (g) => { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); }); },
    flush(g) {
      for (const [style, fns] of fills) { g.fillStyle = style; g.beginPath(); for (const f of fns) f(g); g.fill(); }
      g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
      for (const [k, fns] of strokes) {
        const i = k.lastIndexOf('|');
        g.strokeStyle = k.slice(0, i); g.lineWidth = +k.slice(i + 1);
        g.beginPath(); for (const f of fns) f(g); g.stroke();
      }
      g.restore();
      fills.clear(); strokes.clear();
    },
  };
}
/** 量化（批次分組用） */
export const qz = (v, steps) => Math.round(v * steps) / steps;

/**
 * 牆面噴漆模板字：先畫柔和的外噴霧（overspray），再畫主體；以噪音遮罩做出不均勻的漆面與剝落。
 * 回傳一張 RGBA canvas（透明底），由呼叫者 drawImage 疊上去。
 */
export function stencilLayer(W, H, draw, { color = [230, 226, 212], alpha = 0.9, seed = 5, wear = 0.35, overspray = 0.25 } = {}) {
  const { canvas: m, g: mg } = mkCanvas(W, H);
  mg.fillStyle = '#fff'; mg.strokeStyle = '#fff';
  draw(mg);
  const s = mg.getImageData(0, 0, W, H).data;
  // 只處理有畫到的範圍（外擴噴霧半徑）
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (s[(y * W + x) * 4 + 3]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return m;
  const pad = 10;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(W - 1, x1 + pad); y1 = Math.min(H - 1, y1 + pad);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const A = new Float32Array(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) A[y * bw + x] = s[((y + y0) * W + x + x0) * 4 + 3] / 255;
  // 噴霧：把遮罩模糊後當作外圈
  const blur = boxBlur(boxBlur(A, bw, bh, 3), bw, bh, 3);
  const n = field(bw, bh, { cells: Math.max(3, Math.round(bw / 40)), octaves: 4, seed }, 2);
  const fine = grain(bw, bh, seed + 1);
  const out = new Pix(bw, bh);
  for (let i = 0; i < bw * bh; i++) {
    const core = A[i] * clamp(1 - wear * smooth(0.45, 0.85, n[i]) * 1.4 - (fine[i] < 0.12 * wear ? 0.5 : 0));
    const halo = blur[i] * overspray * (0.6 + 0.4 * n[i]);
    const a = clamp(Math.max(core, halo)) * alpha * (0.85 + 0.15 * fine[i]);
    out.set(i, color[0], color[1], color[2], a * 255);
  }
  mg.clearRect(0, 0, W, H);
  out.putTo(mg, x0, y0);
  return m;
}

/** 可分離盒狀模糊（環繞邊界不處理，夾邊） */
export function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    let acc = 0; const row = y * W;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = acc * k;
      acc += src[row + Math.min(W - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc * k;
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

/** 以字距縮放把一行字塞進寬度（不改變字高） */
export function drawFitted(g, text, x, y, maxW, { size = 32, font, weight = '', color = '#fff', align = 'center', stroke = null, spacing = 0 } = {}) {
  g.save();
  g.font = `${weight} ${size}px ${font}`;
  if ('letterSpacing' in g && spacing) g.letterSpacing = `${spacing}px`;
  const w = g.measureText(text).width;
  const sx = w > maxW ? maxW / w : 1;
  g.translate(x, y); g.scale(sx, 1);
  g.textAlign = align; g.textBaseline = 'middle';
  if (stroke) { g.strokeStyle = stroke.color; g.lineWidth = stroke.width; g.lineJoin = 'round'; g.strokeText(text, 0, 0); }
  g.fillStyle = color; g.fillText(text, 0, 0);
  g.restore();
  return w * sx;
}

/** 圓角矩形路徑 */
export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}

/** 由 SCRIPT 字串中抽出『…』或「…」引號內的文字（找不到時回傳 fallback） */
export function quoted(str, fallback = '', index = 0) {
  if (typeof str !== 'string') return fallback;
  const m = [...str.matchAll(/[『「]([^』」]+)[』」]/g)];
  return m[index]?.[1] ?? fallback;
}
