// =============================================================================
// 程式化貼圖共用工具（HTML5 Canvas → THREE.CanvasTexture）
// 所有模組產生貼圖時都應該使用這裡的工具，確保風格一致且不依賴任何外部圖檔。
// =============================================================================
import * as THREE from 'three';
import { rng, clamp } from '../core/util.js';

// 字型堆疊（Canvas 與 CSS 共用）。手寫字優先使用系統楷體，沒有就退回一般字型。
export const FONTS = {
  ui: '"Noto Sans TC","PingFang TC","Microsoft JhengHei","Heiti TC","WenQuanYi Zen Hei","Source Han Sans TC",sans-serif',
  mono: '"Consolas","Menlo","Courier New","Noto Sans Mono CJK TC","WenQuanYi Zen Hei Mono",monospace',
  hand: '"Kaiti TC","BiauKai","STKaiti","DFKai-SB","KaiTi","標楷體","AR PL UKai TW","TW-Kai","Noto Serif TC","WenQuanYi Zen Hei",serif',
  serif: '"Noto Serif TC","Songti TC","PMingLiU","MingLiU","AR PL UMing TW","WenQuanYi Zen Hei",serif',
  stencil: '"Impact","Arial Black","Noto Sans TC","WenQuanYi Zen Hei",sans-serif',
};

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const g = canvas.getContext('2d');
  return { canvas, g, w, h };
}

// 把 canvas 包成貼圖。color = true 代表是顏色貼圖（sRGB），false 用於 roughness/bump/alpha 等資料貼圖。
export function canvasTexture(canvas, { repeat = [1, 1], color = true, wrap = true, anisotropy = 4, mipmaps = true } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  if (wrap) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = mipmaps;
  if (!mipmaps) tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// 可平鋪的 2D value noise（period 決定平鋪週期，讓貼圖接縫無痕）
export function makeNoise(seed = 1, period = 64) {
  const r = rng(seed);
  const n = period;
  const grid = new Float32Array(n * n);
  for (let i = 0; i < grid.length; i++) grid[i] = r();
  const at = (x, y) => grid[(((y % n) + n) % n) * n + (((x % n) + n) % n)];
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
// 分形布朗運動。scale = 第一層的格子數（需整除 period 以維持平鋪）
export function fbm(noise, x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp; amp *= gain; freq *= lacunarity;
  }
  return sum / norm;
}

// 用 fbm 填滿整張畫布：c0 → c1 之間依噪音插值（顏色為 [r,g,b] 0..255）
export function fillNoise(g, w, h, { seed = 1, scale = 8, octaves = 4, c0 = [90, 90, 90], c1 = [150, 150, 150], contrast = 1, alpha = 255 } = {}) {
  const noise = makeNoise(seed, 256);
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = fbm(noise, (x / w) * scale, (y / h) * scale, octaves);
      v = clamp((v - 0.5) * contrast + 0.5);
      const i = (y * w + x) * 4;
      d[i] = c0[0] + (c1[0] - c0[0]) * v;
      d[i + 1] = c0[1] + (c1[1] - c0[1]) * v;
      d[i + 2] = c0[2] + (c1[2] - c0[2]) * v;
      d[i + 3] = alpha;
    }
  }
  g.putImageData(img, 0, 0);
}

// 隨機斑點（灰塵、氣孔、鏽點）
export function speckle(g, w, h, { seed = 2, count = 400, color = 'rgba(0,0,0,0.25)', min = 0.5, max = 2 } = {}) {
  const r = rng(seed);
  g.fillStyle = color;
  for (let i = 0; i < count; i++) {
    g.beginPath();
    g.arc(r() * w, r() * h, min + r() * (max - min), 0, Math.PI * 2);
    g.fill();
  }
}

// 不規則柔邊污漬（水漬、煙燻、焦痕的基本筆觸）
export function stain(g, x, y, radius, { seed = 3, color = [40, 30, 20], alpha = 0.5, blobs = 14, soft = 0.6 } = {}) {
  const r = rng(seed);
  for (let i = 0; i < blobs; i++) {
    const a = r() * Math.PI * 2, d = r() * radius * 0.6;
    const bx = x + Math.cos(a) * d, by = y + Math.sin(a) * d;
    const br = radius * (0.25 + r() * 0.5);
    const grd = g.createRadialGradient(bx, by, br * (1 - soft), bx, by, br);
    const al = alpha * (0.4 + r() * 0.6);
    grd.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${al})`);
    grd.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
    g.fillStyle = grd;
    g.beginPath(); g.arc(bx, by, br, 0, Math.PI * 2); g.fill();
  }
}

// 垂直流痕（牆面水漬、煙燻往上竄的痕跡用 dir = -1）
export function streaks(g, x0, x1, y, length, { seed = 4, count = 20, color = [50, 45, 35], alpha = 0.25, width = [1, 4], dir = 1 } = {}) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = x0 + r() * (x1 - x0);
    const len = length * (0.3 + r() * 0.7);
    const wdt = width[0] + r() * (width[1] - width[0]);
    const grd = g.createLinearGradient(x, y, x, y + len * dir);
    grd.addColorStop(0, `rgba(${color[0]},${color[1]},${color[2]},${alpha})`);
    grd.addColorStop(1, `rgba(${color[0]},${color[1]},${color[2]},0)`);
    g.fillStyle = grd;
    g.fillRect(x - wdt / 2, Math.min(y, y + len * dir), wdt, len);
  }
}

// 手寫字：逐字加入位置、旋轉、大小、濃淡的抖動。
// chars 參數可限制只畫前 N 個字（終幕「寫字動畫」用）。回傳最後一個字的位置（筆尖）。
export function handwriting(g, lines, x, y, { size = 40, lineHeight = 1.32, color = '#1b2a6b', seed = 7, jitter = 1, chars = Infinity, font = FONTS.hand, slant = -0.04 } = {}) {
  const r = rng(seed);
  let drawn = 0;
  let pen = { x, y };
  g.save();
  g.textBaseline = 'alphabetic';
  for (let li = 0; li < lines.length; li++) {
    let cx = x + (r() - 0.5) * size * 0.15 * jitter;
    const cy = y + li * size * lineHeight;
    for (const ch of lines[li]) {
      // 抖動值無論是否繪製都要先抽，確保動畫過程中字形不會跳動
      const dx = (r() - 0.5) * size * 0.06 * jitter;
      const dy = (r() - 0.5) * size * 0.08 * jitter;
      const rot = slant + (r() - 0.5) * 0.12 * jitter;
      const sc = 1 + (r() - 0.5) * 0.12 * jitter;
      const ink = 0.78 + r() * 0.22;
      const narrow = /[0-9A-Za-z，。、！？：；]/.test(ch);
      const adv = size * (narrow ? 0.62 : 0.98) * sc;
      if (drawn < chars) {
        g.save();
        g.translate(cx + dx, cy + dy);
        g.rotate(rot);
        g.scale(sc, sc);
        g.globalAlpha = ink;
        g.fillStyle = color;
        g.font = `${size}px ${font}`;
        g.fillText(ch, 0, 0);
        g.restore();
        pen = { x: cx + adv, y: cy };
      }
      drawn++;
      cx += adv;
    }
  }
  g.restore();
  return pen;
}

// 單行文字自動縮放塞進寬度
export function fitText(g, text, x, y, maxWidth, { size = 32, font = FONTS.ui, color = '#fff', align = 'left', weight = '' } = {}) {
  let s = size;
  g.font = `${weight} ${s}px ${font}`;
  while (g.measureText(text).width > maxWidth && s > 6) { s -= 1; g.font = `${weight} ${s}px ${font}`; }
  g.fillStyle = color; g.textAlign = align; g.fillText(text, x, y);
  g.textAlign = 'left';
  return s;
}

// 由灰階 canvas 產生法線貼圖 canvas（簡易 Sobel）
export function heightToNormal(srcCanvas, strength = 2) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const src = srcCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const { canvas, g } = makeCanvas(w, h);
  const out = g.createImageData(w, h);
  const H = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return canvas;
}

// 柔邊圓形粒子貼圖（灰燼、煙、光暈）
export function radialSprite(size = 64, { inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', soft = 1 } = {}) {
  const { canvas, g } = makeCanvas(size, size);
  const grd = g.createRadialGradient(size / 2, size / 2, size * 0.5 * (1 - soft), size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner); grd.addColorStop(1, outer);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  return canvas;
}
