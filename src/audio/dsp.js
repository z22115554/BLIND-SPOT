// =============================================================================
// dsp.js — AudioEngine 的程式化素材與小工具
//   * 可無縫循環的白／粉紅／棕噪音 AudioBuffer
//   * 程式化捲積殘響脈衝（衰減噪音）：'room'、'corridor'、'door'
//   * AudioParam 平滑過渡、包絡、波形整形曲線等輔助函式
// 全部即時生成：零外部音檔。
// =============================================================================
import { rng } from '../core/util.js';

export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(1e-9, g));
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];
export const chance = (p) => Math.random() < p;

/**
 * 平滑地把 AudioParam 帶到目標值（ramp 秒內到達 ~95%）。
 * 先「凍結」目前的自動化數值，避免 cancelScheduledValues 讓數值瞬間跳回舊值。
 */
export function glide(param, value, when, ramp = 0.15) {
  if (!param) return;
  const r = Math.max(0.15, ramp);
  try {
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(when);
    else { const v = param.value; param.cancelScheduledValues(when); param.setValueAtTime(v, when); }
  } catch { /* 某些實作在 hold 與 setTarget 交界會丟例外：退回單純 cancel */
    try { param.cancelScheduledValues(when); } catch { /* ignore */ }
  }
  param.setTargetAtTime(value, when, r / 3);
}

/** 單純的「從現在起趨近」：不取消既有事件（用於每幀更新的位置參數）。 */
export function follow(param, value, when, tc = 0.03) {
  param.setTargetAtTime(value, when, tc);
}

/** 打擊型包絡：0 →（線性 a 秒）→ peak → 以時間常數 tc 指數衰減。 */
export function perc(param, t, peak, a = 0.002, tc = 0.05) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + Math.max(0.0005, a));
  param.setTargetAtTime(0, t + Math.max(0.0005, a), Math.max(0.0005, tc));
}

/** 起-持-放包絡：0 →（a）→ peak，維持到 t+a+hold，再以 r（≈95% 到達）淡出。 */
export function asr(param, t, peak, a, hold, r) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + Math.max(0.001, a));
  param.setValueAtTime(peak, t + Math.max(0.001, a) + Math.max(0, hold));
  param.setTargetAtTime(0, t + Math.max(0.001, a) + Math.max(0, hold), Math.max(0.002, r / 3));
}

/** 溫和的對稱軟削波（tanh），normalize 到 ±1。 */
export function softClipCurve(drive = 2.5, n = 2048) {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * x) / norm;
  }
  return c;
}

/** 輕微不對稱的削波（偶次諧波：便宜的對講機喇叭音色）。 */
export function radioCurve(drive = 2.2, asym = 0.12, n = 2048) {
  const c = new Float32Array(n);
  const norm = Math.tanh(drive * (1 + asym));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(drive * (x + asym * x * x)) / norm;
  }
  return c;
}

// ---------------------------------------------------------------------------
// 噪音緩衝區
// ---------------------------------------------------------------------------
function rmsOf(d) { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / d.length); }

/** 生成 N+M 個樣本，再以等功率交叉淡化把尾巴接回開頭 → 循環點完全連續。 */
function loopable(N, M, gen) {
  const x = new Float32Array(N + M);
  gen(x);
  const out = new Float32Array(N);
  out.set(x.subarray(0, N));
  for (let i = 0; i < M; i++) {
    const a = i / M;
    out[i] = x[i] * Math.sqrt(a) + x[N + i] * Math.sqrt(1 - a);
  }
  return out;
}

function normalizeRms(d, target) {
  let mean = 0; for (let i = 0; i < d.length; i++) mean += d[i]; mean /= d.length;
  for (let i = 0; i < d.length; i++) d[i] -= mean;
  const r = rmsOf(d) || 1, k = target / r;
  for (let i = 0; i < d.length; i++) d[i] *= k;
  return d;
}

/**
 * @returns {{white:AudioBuffer, pink:AudioBuffer, brown:AudioBuffer}}
 * 單聲道、約 seconds 秒、RMS 皆正規化為 0.25（各色噪音進濾波器前響度一致）。
 */
export function makeNoiseBuffers(ac, seconds = 6, seed = 7) {
  return {
    white: makeNoiseBuffer(ac, 'white', seconds, seed),
    pink: makeNoiseBuffer(ac, 'pink', seconds, seed + 1),
    brown: makeNoiseBuffer(ac, 'brown', seconds, seed + 2),
  };
}

/** 單一顏色的循環噪音（unlock 後分批生成用）。 */
export function makeNoiseBuffer(ac, color, seconds = 6, seed = 7) {
  const sr = ac.sampleRate, N = Math.floor(sr * seconds), M = Math.floor(sr * 0.05);
  const r = rng(seed);
  let data;
  if (color === 'pink') {
    data = loopable(N, M, (x) => {
      // Paul Kellet 精緻版粉紅噪音
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < x.length; i++) {
        const w = r() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
        b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
        x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362; b6 = w * 0.115926;
      }
    });
  } else if (color === 'brown') {
    data = loopable(N, M, (x) => {
      let b = 0;
      for (let i = 0; i < x.length; i++) { b = (b + 0.02 * (r() * 2 - 1)) / 1.02; x[i] = b; }
    });
  } else {
    data = loopable(N, M, (x) => { for (let i = 0; i < x.length; i++) x[i] = r() * 2 - 1; });
  }
  const b = ac.createBuffer(1, N, sr);
  b.getChannelData(0).set(normalizeRms(data, 0.25));
  return b;
}

// ---------------------------------------------------------------------------
// 捲積脈衝響應
// ---------------------------------------------------------------------------
/**
 * 衰減噪音殘響：每個聲道獨立噪音（去相關），隨時間變暗（時變二階低通）。
 * early: [[秒, 振幅], ...] 早期反射；flutter: { period, count, amp, decay } 平行牆面的顫動回聲。
 */
function decayIR(ac, r, { dur, rt60, fcStart, fcEnd, predelay = 0, fadeIn = 0.006, early = [], flutter = null, tailGain = 0.35 }) {
  const sr = ac.sampleRate, N = Math.max(16, Math.floor(dur * sr));
  const buf = ac.createBuffer(2, N, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let y1 = 0, y2 = 0;
    const p0 = Math.floor(predelay * sr);
    // 逐樣本只做乘法：包絡以常數倍率衰減、濾波係數每 32 樣本更新一次（unlock 在點擊處理中同步執行，要快）
    const kEnv = Math.exp(-6.9078 / (rt60 * sr));
    const fadeN = Math.max(1, fadeIn * sr);
    let env = 1, a = 0;
    for (let i = p0; i < N; i++) {
      const j = i - p0;
      if ((j & 31) === 0) {
        const fc = fcStart * Math.pow(fcEnd / fcStart, Math.min(1, j / sr / dur));
        a = Math.exp(-2 * Math.PI * fc / sr);
      }
      const w = r() * 2 - 1;
      y1 = (1 - a) * w + a * y1; y2 = (1 - a) * y1 + a * y2;
      d[i] = y2 * env * (j < fadeN ? j / fadeN : 1);
      env *= kEnv;
    }
    // 尾巴正規化：前 60ms 的 RMS = tailGain
    const win = Math.min(N - p0, Math.floor(0.06 * sr));
    let s = 0; for (let i = p0; i < p0 + win; i++) s += d[i] * d[i];
    const k = tailGain / (Math.sqrt(s / Math.max(1, win)) || 1);
    for (let i = p0; i < N; i++) d[i] *= k;
    // 早期反射（左右聲道時間略錯開）
    for (const [tm, amp] of early) {
      const idx = Math.floor((tm + (ch ? 0.0007 : 0) + (r() - 0.5) * 0.0004) * sr);
      if (idx >= 0 && idx < N - 2) {
        const sgn = r() < 0.5 ? -1 : 1;
        d[idx] += amp * sgn; d[idx + 1] += amp * 0.45 * sgn; d[idx + 2] += amp * 0.15 * sgn;
      }
    }
    if (flutter) {
      for (let k2 = 1; k2 <= flutter.count; k2++) {
        const idx = Math.floor((predelay + flutter.period * k2 + (ch ? 0.0011 : 0)) * sr);
        if (idx < N - 3) {
          const amp = flutter.amp * Math.pow(flutter.decay, k2) * (k2 % 2 ? 1 : -1);
          d[idx] += amp; d[idx + 1] += amp * 0.6; d[idx + 2] += amp * 0.25; d[idx + 3] += amp * 0.08;
        }
      }
    }
  }
  return buf;
}

/** 「隔著鋼製防爆門」的傳遞響應：極重的低通、鋼板低頻模態、短殘響。 */
function doorIR(ac, r) {
  const sr = ac.sampleRate, dur = 0.7, N = Math.floor(dur * sr);
  const buf = ac.createBuffer(2, N, sr);
  const modes = [[64, 0.20, 1.0], [97, 0.17, 0.8], [139, 0.13, 0.6], [188, 0.10, 0.42], [251, 0.07, 0.28], [337, 0.05, 0.16]];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // 鋼板模態：以遞迴旋轉（衰減的複數相量）產生，避免逐樣本 sin/exp
    const M = modes.map(([f, tau, amp]) => {
      const w = 2 * Math.PI * f * (1 + (ch ? 0.006 : 0)) / sr, dec = Math.exp(-1 / (tau * sr)), p = r() * Math.PI * 2;
      return { c: Math.cos(w) * dec, s: Math.sin(w) * dec, re: Math.cos(p), im: Math.sin(p), amp: amp * 0.35 };
    });
    let y1 = 0, y2 = 0, a = 0;
    let eDirect = 1.6, eNoise = 0.5;
    const kDirect = Math.exp(-1 / (0.004 * sr)), kNoise = Math.exp(-1 / (0.16 * sr));
    const n30 = Math.floor(0.03 * sr), n2 = 0.002 * sr, n10 = 0.01 * sr;
    for (let i = 0; i < N; i++) {
      let s = 0;
      // 直達成分：被鋼板吃掉高頻後的鈍化脈衝
      if (i < n30) s += eDirect;
      eDirect *= kDirect;
      // 鋼板模態
      const att = i < n2 ? i / n2 : 1;
      for (let m = 0; m < M.length; m++) {
        const o = M[m];
        s += o.amp * o.im * att;
        const re = o.re * o.c - o.im * o.s; o.im = o.re * o.s + o.im * o.c; o.re = re;
      }
      // 暗沉的殘響噪音（門外的廊道）
      s += (r() * 2 - 1) * eNoise * (i < n10 ? i / n10 : 1);
      eNoise *= kNoise;
      // 整體再低通（約 420 Hz → 隨時間更暗）
      if ((i & 31) === 0) a = Math.exp(-2 * Math.PI * 420 * Math.pow(0.45, i / sr / dur) / sr);
      y1 = (1 - a) * s + a * y1; y2 = (1 - a) * y1 + a * y2;
      d[i] = y2;
    }
  }
  return buf;
}

/** @returns {{room:AudioBuffer, corridor:AudioBuffer, door:AudioBuffer}} */
/** 單一 IR：'room'（0.6 s 小控制室）/ 'corridor'（2.4 s 暗沉混凝土廊道）/ 'door'（隔著鋼門）。 */
export function makeImpulseResponse(ac, name, seed = 11) {
  const r = rng(seed + name.length * 101);
  if (name === 'room') {
    return decayIR(ac, r, {
      dur: 0.6, rt60: 0.48, fcStart: 5200, fcEnd: 1300, predelay: 0.002,
      early: [[0.0042, 0.55], [0.0068, 0.42], [0.0105, 0.36], [0.0151, 0.28], [0.0217, 0.22], [0.0290, 0.15]],
      tailGain: 0.3,
    });
  }
  if (name === 'corridor') {
    return decayIR(ac, r, {
      dur: 2.4, rt60: 2.2, fcStart: 3200, fcEnd: 320, predelay: 0.006, fadeIn: 0.012,
      early: [[0.0093, 0.42], [0.0141, 0.3], [0.0236, 0.26], [0.047, 0.18], [0.108, 0.16], [0.214, 0.11], [0.33, 0.06]],
      flutter: { period: 0.0094, count: 14, amp: 0.22, decay: 0.8 },
      tailGain: 0.28,
    });
  }
  return doorIR(ac, r);
}

/** @returns {{room:AudioBuffer, corridor:AudioBuffer, door:AudioBuffer}} */
export function makeImpulseResponses(ac, seed = 11) {
  return { room: makeImpulseResponse(ac, 'room', seed), corridor: makeImpulseResponse(ac, 'corridor', seed), door: makeImpulseResponse(ac, 'door', seed) };
}

/** 由諧波振幅表建立 PeriodicWave（第 0 項為 DC，忽略）。 */
export function periodicWave(ac, amps, phases = null) {
  const n = amps.length + 1;
  const real = new Float32Array(n), imag = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    const p = phases ? phases[i - 1] : 0;
    real[i] = amps[i - 1] * Math.sin(p);
    imag[i] = amps[i - 1] * Math.cos(p);
  }
  return ac.createPeriodicWave(real, imag, { disableNormalization: false });
}

/** {x,y,z} 或 THREE.Vector3 → 純物件（容錯）。 */
export function toPos(p, fallback = null) {
  if (!p) return fallback;
  const x = Number(p.x), y = Number(p.y ?? 1.2), z = Number(p.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return fallback;
  return { x, y: Number.isFinite(y) ? y : 1.2, z };
}
