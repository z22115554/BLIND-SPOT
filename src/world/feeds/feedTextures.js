// =============================================================================
// feedTextures — CCTV 頻道場景專用的程式化貼圖（全部 Canvas 即時生成、快取共用）
// 監視器畫面最高只有 640×480，貼圖刻意維持小尺寸（128–512），重點是「明暗結構」而非細節。
// =============================================================================
import * as THREE from 'three';
import { makeCanvas, canvasTexture, fillNoise, makeNoise, fbm, speckle, stain, streaks, fitText, FONTS } from '../../gfx/canvasUtil.js';
import { rng, clamp } from '../../core/util.js';

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}
/** 共用 image 的 repeat clone */
export function rep(tex, rx, ry) {
  const t = tex.clone();
  t.repeat.set(rx, ry);
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------
// 隧道壁磁磚（髒白色、灰縫、下緣煙垢）
// ---------------------------------------------------------------------------
export function tunnelTiles() {
  return cached('tiles', () => {
    const { canvas, g, w, h } = makeCanvas(256, 256);
    const r = rng(11);
    g.fillStyle = '#3c3b37'; g.fillRect(0, 0, w, h);
    const n = 8, s = w / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = 168 + r() * 26 - (r() < 0.08 ? 40 : 0);
        g.fillStyle = `rgb(${v},${v - 3},${v - 10})`;
        g.fillRect(x * s + 2, y * s + 2, s - 3, s - 3);
        g.fillStyle = 'rgba(255,255,255,0.10)';
        g.fillRect(x * s + 2, y * s + 2, s - 3, 2);
      }
    }
    // 污垢（乘色）
    const dirt = makeCanvas(w, h);
    fillNoise(dirt.g, w, h, { seed: 12, scale: 4, c0: [120, 115, 105], c1: [255, 252, 245], contrast: 1.6 });
    g.globalCompositeOperation = 'multiply';
    g.drawImage(dirt.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
    streaks(g, 0, w, 0, h, { seed: 13, count: 40, color: [40, 36, 30], alpha: 0.16, width: [2, 8] });
    return canvasTexture(canvas);
  });
}

// 拱頂噴漿混凝土（深灰、垂流）
export function archConcrete() {
  return cached('arch', () => {
    const { canvas, g, w, h } = makeCanvas(256, 256);
    fillNoise(g, w, h, { seed: 21, scale: 8, c0: [52, 51, 49], c1: [104, 101, 96], contrast: 1.3 });
    speckle(g, w, h, { seed: 22, count: 900, color: 'rgba(20,20,20,0.35)', min: 0.4, max: 1.4 });
    streaks(g, 0, w, 0, h, { seed: 23, count: 26, color: [25, 24, 22], alpha: 0.25, width: [2, 10] });
    return canvasTexture(canvas);
  });
}

// 柏油路面（整個路寬一張：u 0..1 = x -4.2..4.2，標線直接畫進去）
export function roadAsphalt() {
  return cached('road', () => {
    const W = 512, H = 512;
    const { canvas, g } = makeCanvas(W, H);
    fillNoise(g, W, H, { seed: 31, scale: 16, c0: [34, 34, 36], c1: [70, 69, 68], contrast: 1.2 });
    speckle(g, W, H, { seed: 32, count: 2600, color: 'rgba(150,150,150,0.25)', min: 0.3, max: 1.0 });
    speckle(g, W, H, { seed: 33, count: 1600, color: 'rgba(0,0,0,0.35)', min: 0.3, max: 1.2 });
    const X = (x) => ((x + 4.2) / 8.4) * W;
    // 輪跡（較暗、較平滑的帶）
    for (const cx of [-2.65, -0.95, 0.95, 2.65]) {
      const grd = g.createLinearGradient(X(cx - 0.45), 0, X(cx + 0.45), 0);
      grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.22)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(X(cx - 0.45), 0, X(cx + 0.45) - X(cx - 0.45), H);
    }
    // 標線：邊線＋中央雙白實線（隧道內禁止變換車道）
    const line = (x, wdt) => {
      g.fillStyle = 'rgba(214,212,200,0.92)';
      g.fillRect(X(x - wdt / 2), 0, Math.max(2, X(x + wdt / 2) - X(x - wdt / 2)), H);
    };
    line(-3.6, 0.15); line(3.6, 0.15); line(-0.11, 0.1); line(0.11, 0.1);
    // 標線磨損
    const wear = rng(34);
    g.fillStyle = 'rgba(48,48,48,0.55)';
    for (let i = 0; i < 260; i++) g.fillRect(wear() * W, wear() * H, 1 + wear() * 3, 1 + wear() * 5);
    return canvasTexture(canvas);
  });
}

// 維修廊道牆面混凝土（淺灰、漏水痕）
export function corridorConcrete() {
  return cached('corrWall', () => {
    const { canvas, g, w, h } = makeCanvas(256, 256);
    fillNoise(g, w, h, { seed: 41, scale: 4, c0: [118, 116, 110], c1: [168, 165, 158], contrast: 1.2 });
    speckle(g, w, h, { seed: 42, count: 700, color: 'rgba(40,40,40,0.3)', min: 0.4, max: 1.3 });
    streaks(g, 0, w, 0, h, { seed: 43, count: 18, color: [70, 64, 52], alpha: 0.22, width: [2, 9] });
    stain(g, 70, 200, 60, { seed: 44, color: [70, 62, 48], alpha: 0.25 });
    stain(g, 200, 60, 50, { seed: 45, color: [70, 62, 48], alpha: 0.18 });
    return canvasTexture(canvas);
  });
}

// 維修廊道地面（深灰混凝土、補丁、裂縫）
export function corridorFloor() {
  return cached('corrFloor', () => {
    const { canvas, g, w, h } = makeCanvas(256, 256);
    fillNoise(g, w, h, { seed: 51, scale: 8, c0: [58, 57, 54], c1: [104, 101, 96], contrast: 1.25 });
    speckle(g, w, h, { seed: 52, count: 1100, color: 'rgba(20,20,20,0.35)', min: 0.4, max: 1.4 });
    stain(g, 128, 128, 90, { seed: 53, color: [30, 28, 26], alpha: 0.3 });
    const r = rng(54);
    g.strokeStyle = 'rgba(15,15,15,0.55)'; g.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) {
      let x = r() * w, y = r() * h;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 12; k++) { x += (r() - 0.5) * 22; y += r() * 18; g.lineTo(x, y); }
      g.stroke();
    }
    return canvasTexture(canvas);
  });
}

// 地面潮濕斑塊的粗糙度貼圖（資料貼圖：暗 = 光滑/濕）
export function wetRoughness() {
  return cached('wetRough', () => {
    const { canvas, g, w, h } = makeCanvas(128, 128);
    const noise = makeNoise(61, 128);
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = fbm(noise, (x / w) * 4, (y / h) * 4, 4);
        const wet = clamp((0.52 - v) * 6);       // 低窪處積水
        const r = 0.85 - wet * 0.5;
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = r * 255; img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return canvasTexture(canvas, { color: false });
  });
}

// 粉刷牆下半部的油漆（灰綠色、剝落）
export function paintedDado() {
  return cached('dado', () => {
    const { canvas, g, w, h } = makeCanvas(256, 128);
    fillNoise(g, w, h, { seed: 71, scale: 8, c0: [62, 74, 66], c1: [86, 99, 90], contrast: 1.1 });
    const r = rng(72);
    for (let i = 0; i < 26; i++) {
      stain(g, r() * w, r() * h, 6 + r() * 14, { seed: 73 + i, color: [140, 138, 130], alpha: 0.35, blobs: 6, soft: 0.2 });
    }
    streaks(g, 0, w, 0, h, { seed: 74, count: 14, color: [40, 36, 28], alpha: 0.25, width: [2, 6] });
    // 上緣的黃色警示細線
    g.fillStyle = 'rgba(170,150,60,0.9)'; g.fillRect(0, 0, w, 5);
    return canvasTexture(canvas);
  });
}

// 一般漆面金屬（帶刮痕、鏽點）
export function paintedMetal(seed = 81, c0 = [70, 72, 74], c1 = [110, 112, 112]) {
  return cached(`pm${seed}`, () => {
    const { canvas, g, w, h } = makeCanvas(128, 128);
    fillNoise(g, w, h, { seed, scale: 4, c0, c1, contrast: 1.1 });
    speckle(g, w, h, { seed: seed + 1, count: 160, color: 'rgba(90,50,25,0.35)', min: 0.5, max: 1.8 });
    return canvasTexture(canvas);
  });
}

// 消防衣布料（髒卡其、煙燻）— HD 人影用
export function turnoutFabric() {
  return cached('turnout', () => {
    const { canvas, g, w, h } = makeCanvas(256, 256);
    fillNoise(g, w, h, { seed: 91, scale: 8, c0: [84, 70, 46], c1: [140, 118, 80], contrast: 1.2 });
    const r = rng(92);
    for (let i = 0; i < 9; i++) stain(g, r() * w, r() * h, 30 + r() * 50, { seed: 93 + i, color: [18, 14, 10], alpha: 0.5 });
    streaks(g, 0, w, h, h * 0.8, { seed: 95, count: 30, color: [15, 12, 9], alpha: 0.35, width: [2, 7], dir: -1 });
    speckle(g, w, h, { seed: 96, count: 400, color: 'rgba(10,8,6,0.45)', min: 0.5, max: 2.2 });
    return canvasTexture(canvas);
  });
}

// 消防頭盔漆面（髒黃色、煙燻、刮痕）
export function helmetPaint() {
  return cached('helmet', () => {
    const { canvas, g, w, h } = makeCanvas(128, 128);
    fillNoise(g, w, h, { seed: 191, scale: 4, c0: [150, 112, 34], c1: [196, 156, 56], contrast: 1.1 });
    const r = rng(192);
    for (let i = 0; i < 4; i++) stain(g, r() * w, r() * h * 0.5 + h * 0.5, 8 + r() * 14, { seed: 193 + i, color: [20, 14, 8], alpha: 0.45 });
    streaks(g, 0, w, h, h * 0.5, { seed: 199, count: 10, color: [16, 12, 8], alpha: 0.3, width: [1, 4], dir: -1 });
    g.strokeStyle = 'rgba(230,220,190,0.35)'; g.lineWidth = 1;
    for (let i = 0; i < 18; i++) { g.beginPath(); const x = r() * w, y = r() * h; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 20, y + (r() - 0.5) * 8); g.stroke(); }
    return canvasTexture(canvas);
  });
}

// 雨衣（LD 印象：濕亮的淺色塑膠布）
export function raincoatFabric() {
  return cached('raincoat', () => {
    const { canvas, g, w, h } = makeCanvas(128, 128);
    fillNoise(g, w, h, { seed: 97, scale: 4, c0: [150, 146, 120], c1: [200, 196, 168], contrast: 1.1 });
    streaks(g, 0, w, 0, h, { seed: 98, count: 20, color: [80, 80, 70], alpha: 0.2, width: [1, 4] });
    return canvasTexture(canvas);
  });
}

// ---------------------------------------------------------------------------
// 粒子精靈
// ---------------------------------------------------------------------------
/** 煙（白色 RGBA，fbm 形狀＋柔邊；顏色由材質決定） */
export function smokeSprite(seed = 101) {
  return cached(`smoke${seed}`, () => {
    const S = 128;
    const { canvas, g } = makeCanvas(S, S);
    const noise = makeNoise(seed, 64);
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x / S - 0.5, dy = y / S - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) * 2;
        const n = fbm(noise, (x / S) * 5, (y / S) * 5, 5);
        const a = clamp((1 - d) * 1.4) * clamp((n - 0.28) * 2.2);
        const i = (y * S + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = a * a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 柔邊光暈 */
export function glowSprite() {
  return cached('glow', () => {
    const S = 128;
    const { canvas, g } = makeCanvas(S, S);
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.55)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 火焰（白→黃→橘，尖頂；顏色在 additive 下即為發光色） */
export function flameSprite(seed = 111) {
  return cached(`flame${seed}`, () => {
    const W = 64, H = 128;
    const { canvas, g } = makeCanvas(W, H);
    const noise = makeNoise(seed, 32);
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W - 0.5, v = 1 - y / H; // v: 0 底 → 1 頂
        const width = 0.42 * Math.pow(1 - v, 0.7) * (0.75 + 0.5 * fbm(noise, x / W * 3, y / H * 4, 3));
        const d = Math.abs(u) / Math.max(0.001, width);
        let a = clamp(1 - d) * clamp(v * 6) * clamp((1 - v) * 1.4);
        a = a * a;
        const heat = clamp(1 - d * 0.9) * (1 - v * 0.8);
        const i = (y * W + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = clamp(0.35 + heat * 0.65) * 230;
        img.data[i + 2] = clamp(heat * heat) * 140;
        img.data[i + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 柔邊陰影（黑色、中心不透明） */
export function shadowBlob() {
  return cached('shadowBlob', () => {
    const S = 64;
    const { canvas, g } = makeCanvas(S, S);
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.9)');
    grd.addColorStop(0.45, 'rgba(0,0,0,0.55)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 拉長的投影（v = 0 腳底不透明 → v = 1 末端透明） */
export function longShadow() {
  return cached('longShadow', () => {
    const W = 64, H = 128;
    const { canvas, g } = makeCanvas(W, H);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      const width = 0.36 + v * 0.22;
      const a = Math.pow(1 - v, 1.4) * 0.85;
      const grd = g.createLinearGradient(0, 0, W, 0);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(0.5 - width / 2, 'rgba(0,0,0,0)');
      grd.addColorStop(0.5, `rgba(0,0,0,${a})`);
      grd.addColorStop(0.5 + width / 2, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd; g.fillRect(0, H - 1 - y, W, 1);
    }
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 焦黑煙燻痕跡（RGBA 黑色、往上竄的形狀） */
export function sootPlume(seed = 121) {
  return cached(`soot${seed}`, () => {
    const W = 256, H = 256;
    const { canvas, g } = makeCanvas(W, H);
    const noise = makeNoise(seed, 64);
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const u = x / W - 0.5, v = 1 - y / H; // 0 底 → 1 頂
        const spread = 0.12 + v * 0.38;
        const n = fbm(noise, x / W * 6, y / H * 6, 5);
        const core = clamp(1 - Math.abs(u) / spread);
        let a = core * clamp(0.3 + v * 0.9) * clamp((1 - v) * 3 + 0.4) * clamp((n - 0.25) * 2.4);
        a = clamp(a * 1.5);
        const i = (y * W + x) * 4;
        img.data[i] = 10; img.data[i + 1] = 8; img.data[i + 2] = 6;
        img.data[i + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 燃燒中的油池（發光貼圖：黑底、橘色裂紋狀火光） */
export function fuelFire() {
  return cached('fuelFire', () => {
    const S = 256;
    const { canvas, g } = makeCanvas(S, S);
    const noise = makeNoise(131, 64);
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = x / S - 0.5, dy = y / S - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) * 2;
        const n = fbm(noise, x / S * 6, y / S * 6, 5);
        const v = clamp((n - 0.35) * 3) * clamp((1 - d) * 2.5);
        const i = (y * S + x) * 4;
        img.data[i] = 255 * clamp(v * 1.2);
        img.data[i + 1] = 150 * v * v;
        img.data[i + 2] = 40 * v * v * v;
        img.data[i + 3] = 255 * clamp(v * 1.6 + clamp(1 - d) * 0.35);
      }
    }
    g.putImageData(img, 0, 0);
    return canvasTexture(canvas, { wrap: false });
  });
}

// ---------------------------------------------------------------------------
// 標誌與文字貼圖（環境標示，皆為雪嶺隧道的設施用語）
// ---------------------------------------------------------------------------
/** 褪色的警方封鎖線 */
export function policeTape() {
  return cached('tape', () => {
    const W = 512, H = 48;
    const { canvas, g } = makeCanvas(W, H);
    g.fillStyle = '#c9b45a'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(30,26,18,0.85)';
    g.fillRect(0, 3, W, 3); g.fillRect(0, H - 6, W, 3);
    g.font = `bold 24px ${FONTS.ui}`;
    g.textBaseline = 'middle';
    for (let x = 6; x < W; x += 256) g.fillText('警戒線　禁止進入', x, H / 2 + 1);
    // 褪色、髒污
    const fade = makeCanvas(W, H);
    fillNoise(fade.g, W, H, { seed: 141, scale: 12, c0: [150, 140, 120], c1: [255, 250, 235], contrast: 1.4 });
    g.globalCompositeOperation = 'multiply'; g.drawImage(fade.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
    return canvasTexture(canvas, { wrap: true });
  });
}

/** 一般告示牌。style: 'blue' 藍底白字 | 'green' 綠底白字 | 'red' 紅底白字 | 'orange' | 'plate' 金屬銘牌 */
export function signTexture(text, { sub = '', w = 256, h = 96, style = 'blue', size = 44, dirt = 0.3 } = {}) {
  return cached(`sign:${style}:${text}:${sub}:${w}x${h}`, () => {
    const { canvas, g } = makeCanvas(w, h);
    const bg = { blue: '#1d4f9c', green: '#16804a', red: '#b2231b', orange: '#d5661a', plate: '#8d9093', black: '#151515' }[style] || '#333';
    const fg = style === 'plate' ? '#1a1a1a' : '#f2f2ee';
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(6, 6, w - 12, h - 12);
    g.textBaseline = 'middle';
    if (sub) {
      fitText(g, text, w / 2, h * 0.4, w - 28, { size, font: FONTS.ui, color: fg, align: 'center', weight: 'bold' });
      fitText(g, sub, w / 2, h * 0.76, w - 28, { size: size * 0.42, font: FONTS.ui, color: fg, align: 'center' });
    } else {
      fitText(g, text, w / 2, h / 2 + 2, w - 28, { size, font: FONTS.ui, color: fg, align: 'center', weight: 'bold' });
    }
    if (dirt > 0) {
      const d = makeCanvas(w, h);
      fillNoise(d.g, w, h, { seed: text.length * 7 + 3, scale: 5, c0: [150, 145, 135], c1: [255, 255, 255], contrast: 1.2 + dirt });
      g.globalCompositeOperation = 'multiply'; g.drawImage(d.canvas, 0, 0);
      g.globalCompositeOperation = 'source-over';
    }
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 牆面噴漆字（透明底） */
export function stencilTexture(text, { w = 512, h = 128, color = 'rgba(225,222,210,0.85)', size = 96, font = FONTS.stencil } = {}) {
  return cached(`stencil:${text}:${w}x${h}:${color}`, () => {
    const { canvas, g } = makeCanvas(w, h);
    g.textBaseline = 'middle';
    fitText(g, text, w / 2, h / 2 + 4, w - 16, { size, font, color, align: 'center', weight: 'bold' });
    // 噴漆的斑駁：隨機擦掉
    const r = rng(text.length * 13 + 5);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.6})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 4, 1 + r() * 4);
    }
    g.globalCompositeOperation = 'source-over';
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 可變資訊標誌（LED 點陣字：琥珀色），lines 為 1–2 行 */
export function vmsTexture(lines, { color = [255, 170, 40], w = 512, h = 128 } = {}) {
  return cached(`vms:${lines.join('|')}:${color.join(',')}`, () => {
    // 先在小畫布上畫字，再放大成點陣
    const cols = 128, rows = 32;
    const small = makeCanvas(cols, rows);
    small.g.fillStyle = '#000'; small.g.fillRect(0, 0, cols, rows);
    small.g.textBaseline = 'middle';
    if (lines.length === 1) {
      fitText(small.g, lines[0], cols / 2, rows / 2 + 1, cols - 6, { size: 24, font: FONTS.ui, color: '#fff', align: 'center', weight: 'bold' });
    } else {
      fitText(small.g, lines[0], cols / 2, rows * 0.28, cols - 6, { size: 13, font: FONTS.ui, color: '#fff', align: 'center', weight: 'bold' });
      fitText(small.g, lines[1], cols / 2, rows * 0.74, cols - 6, { size: 13, font: FONTS.ui, color: '#fff', align: 'center', weight: 'bold' });
    }
    const src = small.g.getImageData(0, 0, cols, rows).data;
    const { canvas, g } = makeCanvas(w, h);
    g.fillStyle = '#060606'; g.fillRect(0, 0, w, h);
    const cw = w / cols, ch = h / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = src[(y * cols + x) * 4] / 255;
        const on = v > 0.45 ? 1 : 0.07;
        g.fillStyle = `rgb(${Math.round(color[0] * on)},${Math.round(color[1] * on)},${Math.round(color[2] * on)})`;
        g.beginPath(); g.arc((x + 0.5) * cw, (y + 0.5) * ch, cw * 0.42, 0, Math.PI * 2); g.fill();
      }
    }
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 車道管制號誌：'arrow' 綠色向下箭頭 | 'x' 紅色叉 */
export function laneSignalTexture(kind) {
  return cached(`lcs:${kind}`, () => {
    const S = 128;
    const { canvas, g } = makeCanvas(S, S);
    g.fillStyle = '#050505'; g.fillRect(0, 0, S, S);
    const col = kind === 'x' ? '#ff3a24' : '#3cff7a';
    g.strokeStyle = col; g.fillStyle = col; g.lineCap = 'round';
    if (kind === 'x') {
      g.lineWidth = 16;
      g.beginPath(); g.moveTo(30, 30); g.lineTo(98, 98); g.moveTo(98, 30); g.lineTo(30, 98); g.stroke();
    } else {
      g.lineWidth = 14;
      g.beginPath(); g.moveTo(64, 22); g.lineTo(64, 92); g.stroke();
      g.beginPath(); g.moveTo(34, 70); g.lineTo(64, 106); g.lineTo(94, 70); g.closePath(); g.fill();
    }
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 綠色避難指示（奔跑小人 + 箭頭，無文字） */
export function exitSignTexture() {
  return cached('exitSign', () => {
    const W = 256, H = 96;
    const { canvas, g } = makeCanvas(W, H);
    g.fillStyle = '#0f9a4c'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#f2fff4';
    // 門框
    g.fillRect(20, 14, 52, 68); g.fillStyle = '#0f9a4c'; g.fillRect(28, 22, 36, 60);
    g.fillStyle = '#f2fff4';
    // 小人
    g.beginPath(); g.arc(108, 26, 9, 0, Math.PI * 2); g.fill();
    g.lineWidth = 9; g.strokeStyle = '#f2fff4'; g.lineCap = 'round';
    g.beginPath(); g.moveTo(104, 38); g.lineTo(96, 60); g.lineTo(84, 78); g.moveTo(96, 60); g.lineTo(112, 70); g.lineTo(108, 84);
    g.moveTo(102, 44); g.lineTo(118, 52); g.moveTo(102, 44); g.lineTo(88, 50); g.stroke();
    // 箭頭
    g.beginPath(); g.moveTo(150, 48); g.lineTo(220, 48); g.stroke();
    g.beginPath(); g.moveTo(236, 48); g.lineTo(206, 26); g.lineTo(206, 70); g.closePath(); g.fill();
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 細碎殘骸／灰燼的地面貼花（RGBA） */
export function debrisDecal(seed = 151) {
  return cached(`debris${seed}`, () => {
    const S = 256;
    const { canvas, g } = makeCanvas(S, S);
    stain(g, S / 2, S / 2, S * 0.42, { seed, color: [12, 10, 8], alpha: 0.6, blobs: 22 });
    const r = rng(seed + 1);
    for (let i = 0; i < 160; i++) {
      const v = r() < 0.3 ? 140 + r() * 80 : 20 + r() * 40;
      g.fillStyle = `rgba(${v},${v},${v * 0.95},${0.5 + r() * 0.5})`;
      const x = S / 2 + (r() - 0.5) * S * 0.8, y = S / 2 + (r() - 0.5) * S * 0.8;
      g.save(); g.translate(x, y); g.rotate(r() * 6.28);
      g.fillRect(-1, -1, 1 + r() * 6, 1 + r() * 3); g.restore();
    }
    return canvasTexture(canvas, { wrap: false });
  });
}

/** 焦黑漆面（燒過的車殼） */
export function charredPaint(seed = 161) {
  return cached(`charred${seed}`, () => {
    const { canvas, g, w, h } = makeCanvas(128, 128);
    fillNoise(g, w, h, { seed, scale: 4, c0: [12, 11, 10], c1: [58, 50, 44], contrast: 1.5 });
    speckle(g, w, h, { seed: seed + 1, count: 300, color: 'rgba(120,70,40,0.4)', min: 0.5, max: 2 });
    return canvasTexture(canvas);
  });
}

