// =============================================================================
// intercom.js — 緊急對講機語音合成（ctx.SCRIPT.intercom[stage].segments）
//
//   每段依 kind 合成：static / breath / speech / knock / cough / axe / burst
//   * speech：無法辨識、但節奏與聲調像中文的呢喃。
//       音節數 = 該段文字中的中日韓字數（排除「滋」、標點與括號內的舞台指示）。
//       每個音節 = 聲門源（鋸齒波 ~110–150 Hz，抖動、片語尾音下降）→ 3 個共振峰帶通，
//       依小字典把字對應到聲母類型（塞音/擦音/鼻音…）、韻母母音序列與四聲調形。
//       「……」為停頓、「——」為拖長的尾音（哀求）。
//   * clean=false：對講機頻帶 300–3000 Hz ＋ 輕微失真 ＋ 雜訊底；「滋」= 該時間點的雜訊湧起。
//   * clean=true：沒有雜訊，面罩悶住（低通 ~2.5 kHz）＋ 少量房間殘響。
//   * 呼吸是 SCBA 空氣呼吸器面罩裡的喘息：吸氣時調節閥的嘶聲、吐氣閥的顫動——
//     第一次聽是「怪物」，回頭想才知道那是消防員的面罩。
//   輸出到 E.intercomIn（HRTF 定位在對講機面板，走 voice 匯流排：不受 setSilence 影響）。
// =============================================================================
import { Voice } from './Voice.js';
import { rand, chance, clamp, radioCurve } from './dsp.js';
import { click, hiss, knockSet, coughGroup, axeHit } from './synth.js';
import { DOOR_IR_GAIN } from './sfx.js';

// 混音（校準過：見 AudioEngine 測試）
export const MIX = {
  radioOut: 0.17,       // 非 clean 舞台整體
  cleanOut: 0.185,      // clean 舞台整體
  speech: 1.25,
  breath: 0.85,
  regulator: 0.2,
  staticBed: 1.8,
  crackle: 0.6,
  knock: 1.6,
  cough: 1.4,
  axe: 1.4,
  squelch: 0.8,
  doorDirect: 0.1,      // 敲門聲直接穿過防爆門（非 clean 舞台；相對於 knock）
  burstPeak: 4.6,       // burst 時雜訊底的最高值（約與語音同響：中等音量，不是尖峰）
  radioDrive: 2.2,
};

// 依舞台的說話者狀態：基頻、氣聲、強度、語速、顫抖
const PROFILES = [
  { f0: 118, breath: 0.6, intensity: 0.82, rate: 4.6, tremble: 0.010, tremHz: 5.2, jitter: 1.0 }, // 02:03 精疲力竭
  { f0: 128, breath: 0.48, intensity: 0.92, rate: 5.0, tremble: 0.012, tremHz: 5.6, jitter: 1.0 }, // 02:08 焦急
  { f0: 136, breath: 0.42, intensity: 1.0, rate: 5.2, tremble: 0.014, tremHz: 6.0, jitter: 1.1 },  // 02:13 破門前
  { f0: 146, breath: 0.34, intensity: 1.05, rate: 5.0, tremble: 0.02, tremHz: 6.2, jitter: 1.2 },  // 清晰錄音：哀求
];

// 小字典：字 → 聲母,韻母母音序列,鼻音韻尾,聲調（0 = 輕聲）
// 母音記號：a i u e o，E = ㄜ，r = 舌尖後母音（知/是），y = ㄩ
const LEX_SRC = {
  門: 'm,e,n,2', 打: 'd,a,,3', 不: 'b,u,,4', 開: 'k,ai,,1', 裡: 'l,i,,3', 面: 'm,ie,n,4', 有: ',ou,,3', 人: 'r,E,n,2', 嗎: 'm,a,,0',
  煙: ',ie,n,1', 太: 't,ai,,4', 大: 'd,a,,4', 了: 'l,E,,0', 我: ',uo,,3', 看: 'k,a,n,4', 見: 'j,ie,n,4', 控: 'k,o,ng,4', 制: 'zh,r,,4',
  室: 'sh,r,,4', 的: 'd,E,,0', 燈: 'd,E,ng,1', 亮: 'l,ia,ng,4', 著: 'zh,E,,0', 別: 'b,ie,,2', 鎖: 's,uo,,3', 快: 'k,uai,,4',
  聽: 't,i,ng,1', 得: 'd,E,,0', 到: 'd,ao,,4', 主: 'zh,u,,3', 排: 'p,ai,,2', 風: 'f,E,ng,1', 管: 'g,ua,n,3', 燒: 'sh,ao,,1',
  起: 'q,i,,3', 來: 'l,ai,,2', 退: 't,ue,,4', 後: 'h,ou,,4', 要: ',iao,,4', 破: 'p,o,,4', 值: 'zh,r,,2', 班: 'b,a,n,1', 員: ',ye,n,2',
  火: 'h,uo,,3', 勢: 'sh,r,,4', 蔓: 'm,a,n,4', 延: ',ie,n,2', 進: 'j,i,n,4', 濃: 'n,o,ng,2', 馬: 'm,a,,3', 上: 'sh,a,ng,4',
  會: 'h,ue,,4', 倒: 'd,ao,,4', 灌: 'g,ua,n,4', 去: 'q,y,,4', 把: 'b,a,,3', 防: 'f,a,ng,2', 爆: 'b,ao,,4', 解: 'j,ie,,3',
  救: 'j,iou,,4', 你: 'n,i,,3', 求: 'q,iou,,2', 啊: ',a,,0', 誰: 'sh,ue,,2', 在: 'z,ai,,4', 命: 'm,i,ng,4',
};
const LEX = {};
for (const [ch, s] of Object.entries(LEX_SRC)) {
  if (!s || ch.length !== 1) continue;
  const [ini, v, coda, tone] = s.split(',');
  LEX[ch] = { ini, v: v.split(''), coda, tone: Number(tone) };
}
const FALLBACK_INI = ['b', 'd', 'g', 'm', 'n', 'l', 'sh', 'j', 'h', 'z', '', 't', 'k'];
const FALLBACK_V = [['a'], ['i'], ['u'], ['E'], ['o'], ['a', 'i'], ['i', 'e'], ['u', 'o'], ['a', 'o']];
function lookup(ch) {
  if (LEX[ch]) return LEX[ch];
  const c = ch.codePointAt(0);
  return { ini: FALLBACK_INI[c % FALLBACK_INI.length], v: FALLBACK_V[(c >> 3) % FALLBACK_V.length], coda: ['', 'n', 'ng', ''][(c >> 5) % 4], tone: (c >> 7) % 5 };
}

const VOW = { a: [800, 1200, 2500], i: [300, 2300, 3000], u: [350, 800, 2400], e: [500, 1800, 2500], o: [500, 900, 2400], E: [520, 1250, 2450], r: [380, 1500, 2000], y: [300, 1900, 2400] };
const MURMUR = { m: [260, 1000, 2200], n: [260, 1600, 2500], l: [360, 1250, 2600], r: [380, 1350, 1800], ng: [270, 1100, 2300] };
const INI = {
  b: { k: 'stop', f: 800, asp: 0 }, p: { k: 'stop', f: 800, asp: 1 }, d: { k: 'stop', f: 3300, asp: 0 }, t: { k: 'stop', f: 3300, asp: 1 },
  g: { k: 'stop', f: 1900, asp: 0 }, k: { k: 'stop', f: 1900, asp: 1 },
  m: { k: 'nasal', m: 'm' }, n: { k: 'nasal', m: 'n' }, l: { k: 'nasal', m: 'l' }, r: { k: 'nasal', m: 'r' },
  f: { k: 'fric', f: 1600, q: 0.5, amp: 0.35, len: 0.085 }, s: { k: 'fric', f: 5200, q: 1.4, amp: 0.6, len: 0.1 },
  sh: { k: 'fric', f: 2900, q: 1.6, amp: 0.6, len: 0.1 }, x: { k: 'fric', f: 3800, q: 1.4, amp: 0.55, len: 0.1 },
  h: { k: 'asp', len: 0.08 },
  z: { k: 'affr', f: 5000, q: 1.4, len: 0.05, asp: 0 }, c: { k: 'affr', f: 5000, q: 1.4, len: 0.065, asp: 1 },
  zh: { k: 'affr', f: 2900, q: 1.6, len: 0.05, asp: 0 }, ch: { k: 'affr', f: 2900, q: 1.6, len: 0.065, asp: 1 },
  j: { k: 'affr', f: 3600, q: 1.4, len: 0.05, asp: 0 }, q: { k: 'affr', f: 3600, q: 1.4, len: 0.065, asp: 1 },
  '': { k: 'zero' },
};
// 聲調調形（相對基頻：起、中、尾）
const TONES = { 1: [1.12, 1.12, 1.1], 2: [0.93, 0.99, 1.13], 3: [0.9, 0.79, 0.84], 4: [1.2, 1.05, 0.83], 0: [0.96, 0.93, 0.9] };

// ---------------------------------------------------------------------------
// 斷詞與時間規劃
// ---------------------------------------------------------------------------
/** 文字 → token 序列：syl（音節）/ pause / zi（「滋」：雜訊湧起）。 */
export function tokenize(text = '') {
  const out = [];
  let paren = 0;
  const markBack = (key) => { for (let i = out.length - 1; i >= 0 && out[i].type === 'syl'; i--) out[i][key] = true; };
  for (const ch of String(text)) {
    if (ch === '（' || ch === '(') { paren++; continue; }
    if (ch === '）' || ch === ')') { paren = Math.max(0, paren - 1); continue; }
    if (paren) continue;
    if (ch === '…') {
      const last = out[out.length - 1];
      if (!(last && last.type === 'pause' && last.kind === 'ellipsis')) out.push({ type: 'pause', kind: 'ellipsis', d: 0.42 });
      continue;
    }
    if (ch === '—' || ch === '－') { const last = out[out.length - 1]; if (last && (last.type === 'syl' || last.type === 'zi')) last.long = true; continue; }
    if ('，、,;；：:'.includes(ch)) { out.push({ type: 'pause', kind: 'comma', d: 0.22 }); continue; }
    if ('。.'.includes(ch)) { out.push({ type: 'pause', kind: 'stop', d: 0.32 }); continue; }
    if ('！!'.includes(ch)) { markBack('excl'); out.push({ type: 'pause', kind: 'excl', d: 0.24 }); continue; }
    if ('？?'.includes(ch)) { markBack('question'); out.push({ type: 'pause', kind: 'q', d: 0.26 }); continue; }
    if (ch === '滋') { out.push({ type: 'zi', d: 0.2 }); continue; }
    if (/[㐀-鿿豈-﫿]/.test(ch)) { out.push({ type: 'syl', ch, lex: lookup(ch) }); continue; }
  }
  // 片語：連續音節為一個片語
  let run = [];
  const flush = () => { run.forEach((s, i) => { s.pi = i; s.pn = run.length; s.final = i === run.length - 1; }); run = []; };
  for (const tk of out) { if (tk.type === 'syl') run.push(tk); else flush(); }
  flush();
  return out;
}

/** 音節數（測試用：= 中日韓字數，排除「滋」、標點與括號內文字）。 */
export function syllableCount(text) { return tokenize(text).filter((t) => t.type === 'syl').length; }

/** 把 token 排進 dur 秒內。回傳 { items:[{...token, t, d}], end }（相對段落起點）。 */
function planSegment(tokens, dur, prof) {
  const items = tokens.map((tk) => {
    if (tk.type !== 'syl') return { ...tk };
    let d = (1 / prof.rate) * rand(0.86, 1.16);
    if (tk.lex.tone === 0) d *= 0.72;
    if (tk.final) d *= 1.18;
    if (tk.long) d += 0.55;
    return { ...tk, d };
  });
  const lead = 0.1, tail = 0.15;
  const avail = Math.max(0.3, dur - lead - tail);
  let total = items.reduce((a, it) => a + it.d, 0);
  let start = lead;
  if (total > avail) {
    const k = avail / total;
    items.forEach((it) => { it.d *= k; });
  } else {
    let extra = avail - total;
    const pauses = items.filter((it) => it.type !== 'syl');
    const pTot = pauses.reduce((a, it) => a + it.d, 0);
    if (pTot > 0) {
      const add = Math.min(extra * 0.7, pTot * 1.2);
      pauses.forEach((p) => { p.d += add * (p.d / pTot); });
      extra -= add;
    }
    start += extra * 0.3;
  }
  let t = start;
  for (const it of items) { it.t = t; t += it.d; }
  return { items, end: t };
}

/** 段落中可放入「非語音」事件的空檔（相對時間）。 */
function gapsOf(plan, dur) {
  const gaps = [];
  if (!plan) return [{ t: 0, d: dur }];
  const syl = plan.items.filter((i) => i.type === 'syl');
  if (!syl.length) return [{ t: 0, d: dur }];
  if (syl[0].t > 0.25) gaps.push({ t: 0.05, d: syl[0].t - 0.1 });
  for (const it of plan.items) if (it.type !== 'syl' && it.d >= 0.25) gaps.push({ t: it.t, d: it.d });
  const last = syl[syl.length - 1];
  const tailStart = last.t + last.d;
  if (dur - tailStart > 0.2) gaps.push({ t: tailStart + 0.02, d: dur - tailStart - 0.02 });
  return gaps.sort((a, b) => b.d - a.d);
}

// ---------------------------------------------------------------------------
// 語音
// ---------------------------------------------------------------------------
function synthSpeech(v, dest, tSeg, plan, prof) {
  const syls = plan.items.filter((i) => i.type === 'syl');
  if (!syls.length) return;
  const t0 = tSeg, t1 = tSeg + plan.end + 0.4;
  const f0 = prof.f0;
  const s1 = v.osc('sawtooth', f0, t0, t1);
  const s2 = v.osc('sawtooth', f0 * 1.006, t0, t1);
  const src = v.g(1);
  s1.connect(src); v.chain(s2, v.g(0.35), src);
  // 抖動（jitter）與恐懼的顫抖（tremble）
  const jit = v.noise('brown', t0, t1);
  const jg = v.g(f0 * 0.06 * prof.jitter);
  jit.connect(jg); jg.connect(s1.frequency); jg.connect(s2.frequency);
  const trem = v.osc('sine', prof.tremHz, t0, t1);
  const tg = v.g(f0 * prof.tremble);
  trem.connect(tg); tg.connect(s1.frequency); tg.connect(s2.frequency);
  const voicing = v.g(0);
  src.connect(voicing);
  const asp = v.noise('white', t0, t1);
  const aspG = v.g(0);
  v.chain(asp, v.bq('highpass', 500, 0.7), aspG);
  const fin = v.g(1);
  voicing.connect(fin); aspG.connect(fin);
  const F = [v.bq('bandpass', 600, 5), v.bq('bandpass', 1500, 9), v.bq('bandpass', 2500, 11)];
  const FG = [1.0, 1.5, 0.85];
  const fout = v.g(1);
  F.forEach((f, i) => { fin.connect(f); v.chain(f, v.g(FG[i]), fout); });
  v.chain(fin, v.bq('lowpass', 320, 0.7), v.g(0.1), fout);
  const cn = v.noise('white', t0, t1);
  const cbp = v.bq('bandpass', 3000, 1.2);
  const cg = v.g(0);
  v.chain(cn, cbp, cg, fout);
  v.chain(fout, v.g(MIX.speech), dest);

  const setF0 = (val, at, tc) => { s1.frequency.setTargetAtTime(val, at, tc); s2.frequency.setTargetAtTime(val * 1.006, at, tc); };
  const setForm = (fr, at, tc, sc = 1) => { for (let i = 0; i < 3; i++) F[i].frequency.setTargetAtTime(fr[i] * (i === 0 ? sc : 1), at, tc); };

  plan.items.forEach((it, idx) => {
    if (it.type !== 'syl') return;
    const ts = tSeg + it.t, d = it.d;
    const lx = it.lex, I = INI[lx.ini] || INI[''];
    const next = plan.items[idx + 1];
    const connected = next && next.type === 'syl';
    const amp = prof.intensity * (lx.tone === 0 ? 0.75 : 1) * (it.excl ? 1.22 : 1) * rand(0.88, 1.08) * (it.final ? 0.94 : 1);
    const fsc = it.excl ? 1.08 : 1;
    const firstV = VOW[lx.v[0]] || VOW.a;
    let vOn = ts;
    switch (I.k) {
      case 'stop': {
        cbp.frequency.setValueAtTime(I.f, ts); cbp.Q.setValueAtTime(1, ts);
        cg.gain.setValueAtTime(0, ts); cg.gain.linearRampToValueAtTime(0.55 * amp, ts + 0.002); cg.gain.setTargetAtTime(0, ts + 0.003, 0.011);
        vOn = ts + (I.asp ? 0.062 : 0.02);
        if (I.asp) { aspG.gain.setTargetAtTime(0.55 * amp, ts + 0.006, 0.006); aspG.gain.setTargetAtTime(0, vOn - 0.01, 0.01); }
        setForm(firstV, ts, 0.01, fsc);
        break;
      }
      case 'fric': {
        cbp.frequency.setValueAtTime(I.f, ts); cbp.Q.setValueAtTime(I.q, ts);
        cg.gain.setValueAtTime(0, ts); cg.gain.linearRampToValueAtTime(I.amp * amp, ts + 0.025); cg.gain.setTargetAtTime(0, ts + I.len, 0.012);
        vOn = ts + I.len * 0.85;
        setForm(firstV, ts + 0.02, 0.012, fsc);
        break;
      }
      case 'affr': {
        cbp.frequency.setValueAtTime(I.f, ts); cbp.Q.setValueAtTime(I.q, ts);
        cg.gain.setValueAtTime(0, ts); cg.gain.linearRampToValueAtTime(0.6 * amp, ts + 0.003); cg.gain.setTargetAtTime(0.4 * amp, ts + 0.006, 0.01);
        cg.gain.setTargetAtTime(0, ts + I.len, 0.01);
        vOn = ts + I.len * 0.9 + (I.asp ? 0.03 : 0);
        if (I.asp) { aspG.gain.setTargetAtTime(0.45 * amp, ts + I.len * 0.7, 0.008); aspG.gain.setTargetAtTime(0, vOn - 0.008, 0.01); }
        setForm(firstV, ts + 0.02, 0.012, fsc);
        break;
      }
      case 'asp': {
        setForm(firstV, ts, 0.008, fsc);
        aspG.gain.setTargetAtTime(0.6 * amp, ts, 0.008); aspG.gain.setTargetAtTime(0, ts + I.len, 0.012);
        vOn = ts + I.len * 0.8;
        break;
      }
      case 'nasal': {
        setForm(MURMUR[I.m] || MURMUR.m, ts, 0.008);
        voicing.gain.setTargetAtTime(0.42 * amp, ts, 0.01);
        vOn = ts + Math.min(0.06, d * 0.3);
        break;
      }
      default: setForm(firstV, ts, 0.01, fsc); vOn = ts;
    }
    vOn = Math.min(vOn, ts + d * 0.55);
    const codaLen = lx.coda ? Math.min(0.075, d * 0.3) : 0;
    const tOff = ts + d - 0.035;
    const vEnd = Math.max(vOn + 0.02, ts + d - codaLen - 0.01);
    // 母音（雙/三母音依序滑過）
    const nV = lx.v.length;
    lx.v.forEach((sym, k) => {
      const tv = vOn + (vEnd - vOn) * (nV === 1 ? 0 : k / nV);
      setForm(VOW[sym] || VOW.a, tv, k ? 0.04 : 0.014, fsc);
    });
    if (lx.coda) setForm(MURMUR[lx.coda] || MURMUR.n, vEnd, 0.018);
    // 聲調
    const tone = (TONES[lx.tone] || TONES[0]).slice();
    const base = f0 * (1 - 0.09 * (it.pi / Math.max(1, it.pn - 1))) * (it.excl ? 1.2 : 1);
    if (it.final && !it.question) tone[2] *= 0.88;
    if (it.question) tone[2] *= 1.1;
    if (it.long) { tone[0] = 1.2; tone[1] = 1.06; tone[2] = 0.7; }
    setF0(base * tone[0], Math.max(t0, vOn - 0.02), 0.02);
    setF0(base * tone[1], vOn + (tOff - vOn) * 0.45, it.long ? 0.12 : 0.04);
    setF0(base * tone[2], vOn + (tOff - vOn) * 0.75, it.long ? 0.25 : 0.05);
    // 發聲包絡
    voicing.gain.setTargetAtTime(amp, vOn, 0.012);
    if (it.long) voicing.gain.setTargetAtTime(amp * 0.7, vOn + d * 0.5, 0.2);
    if (lx.coda) voicing.gain.setTargetAtTime(amp * 0.5, vEnd, 0.015);
    voicing.gain.setTargetAtTime(connected ? 0.12 * amp : 0, tOff, connected ? 0.015 : 0.022);
    // 氣聲（疲憊、喘）
    aspG.gain.setTargetAtTime(prof.breath * 0.3 * amp, vOn + 0.005, 0.02);
    aspG.gain.setTargetAtTime(0, tOff, 0.02);
  });
}

// ---------------------------------------------------------------------------
// 面罩裡的喘息（SCBA）
// ---------------------------------------------------------------------------
function synthBreath(v, dest, tSeg, dur, plan, level) {
  const t0 = tSeg, t1 = tSeg + dur + 0.3;
  const n = v.noise('white', t0, t1);
  const bp = v.bq('bandpass', 1200, 1.0);
  const g = v.g(0);
  const cav = v.bq('peaking', 900, 1.5, 5);
  const mask = v.bq('lowpass', 1700, 0.7);
  v.chain(n, bp, g, cav, mask, dest);
  const rn = v.noise('white', t0, t1);
  const rg = v.g(0);
  v.chain(rn, v.bq('bandpass', 3050, 3.5), rg, dest);
  const fl = v.osc('sine', 24, t0, t1);
  const fd = v.g(0);
  fl.connect(fd); fd.connect(g.gain);
  const go = v.osc('sawtooth', 98, t0, t1);
  const gg = v.g(0);
  v.chain(go, v.bq('bandpass', 520, 3), gg, cav);
  const L = level * MIX.breath;
  const R = MIX.regulator * level;

  const inhale = (t, d, a) => {
    bp.frequency.setValueAtTime(1350, t); bp.frequency.linearRampToValueAtTime(1900, t + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(L * 0.9 * a, t + d * 0.7); g.gain.linearRampToValueAtTime(0, t + d);
    rg.gain.setValueAtTime(0, t); rg.gain.linearRampToValueAtTime(R * a, t + 0.03); rg.gain.setValueAtTime(R * 0.85 * a, t + d * 0.8); rg.gain.linearRampToValueAtTime(0, t + d);
  };
  const exhale = (t, d, a) => {
    bp.frequency.setValueAtTime(820, t); bp.frequency.linearRampToValueAtTime(560, t + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(L * a, t + 0.06); g.gain.linearRampToValueAtTime(L * 0.5 * a, t + d * 0.6); g.gain.linearRampToValueAtTime(0, t + d);
    fd.gain.setValueAtTime(0, t); fd.gain.linearRampToValueAtTime(L * 0.3 * a, t + 0.05); fd.gain.linearRampToValueAtTime(0, t + d);
    if (chance(0.4)) {
      go.frequency.setValueAtTime(rand(92, 110), t); go.frequency.linearRampToValueAtTime(rand(78, 88), t + d);
      gg.gain.setValueAtTime(0, t); gg.gain.linearRampToValueAtTime(L * 0.3 * a, t + 0.08); gg.gain.linearRampToValueAtTime(0, t + d * 0.8);
    }
  };
  const syls = plan ? plan.items.filter((i) => i.type === 'syl') : [];
  if (!syls.length) {
    let t = t0 + rand(0.03, 0.12);
    while (t < t0 + dur - 0.4) {
      const ti = rand(0.24, 0.32), te = rand(0.34, 0.46);
      inhale(t, ti, rand(0.85, 1));
      const tex = t + ti + rand(0.01, 0.05);
      if (tex + te > t0 + dur - 0.05) break;
      exhale(tex, te, rand(0.85, 1));
      t = tex + te + rand(0.03, 0.12);
    }
  } else {
    let lastEnd = t0;
    for (const it of plan.items) {
      if (it.type === 'syl' || it.d < 0.2) continue;
      const t = tSeg + it.t + 0.03;
      if (t < lastEnd) continue;
      const d = Math.max(0.12, Math.min(0.32, it.d - 0.07));
      inhale(t, d, 0.85);
      lastEnd = t + d + 0.01;
    }
    const last = syls[syls.length - 1];
    const te = tSeg + last.t + last.d + 0.04;
    if (t0 + dur - te > 0.45 && te >= lastEnd) exhale(te, Math.min(0.5, t0 + dur - te - 0.05), 0.7);
  }
}

// ---------------------------------------------------------------------------
// 主程式：播放一個舞台
// ---------------------------------------------------------------------------
/**
 * @returns {Voice} 可 .stop(fade)
 */
export function playIntercomStage(E, stage, stageIndex) {
  const ac = E.ac;
  const segs = (stage?.segments || []).map((s) => ({ text: String(s.text || ''), dur: Math.max(0, Number(s.dur) || 0), kind: new Set(s.kind || []) }));
  const total = segs.reduce((a, s) => a + s.dur, 0);
  const clean = !!stage?.clean;
  const noise = clamp(Number(stage?.noise ?? 0.6), 0, 1);
  const prof = PROFILES[clamp(stageIndex | 0, 0, PROFILES.length - 1)];
  const reduce = !!E.ctx.settings?.get?.('reduceFlicker');
  const t0 = ac.currentTime + 0.04;
  const v = new Voice(E, E.intercomIn, { gain: clean ? MIX.cleanOut : MIX.radioOut, bus: 'voice' });

  // ---- 處理鏈 ----
  const voiceIn = v.g(1);
  const doorIn = v.g(1);
  const doorConv = v.conv('door');
  v.chain(doorIn, doorConv, v.g(DOOR_IR_GAIN), voiceIn);
  if (!clean) {
    // 即時通話：敲門聲同時「實體地」從防爆門傳進來（定位在西牆的防爆門，經過 sfx 匯流排）
    const bd = E.ctx.LAYOUT?.CONTROL_ROOM?.blastDoor;
    if (bd) {
      const pn = v.track(E.makePanner({ x: bd.x + 0.05, y: 1.25, z: bd.z }, { ref: 1.2, rolloff: 1 }));
      v.chain(doorConv, v.bq('lowpass', 520, 0.7), v.g(MIX.doorDirect * DOOR_IR_GAIN), pn);
      pn.connect(E.bus.sfx);
    }
  }
  let staticIn = null;
  if (clean) {
    const post = v.chain(voiceIn, v.bq('highpass', 140, 0.7), v.bq('peaking', 1050, 1.4, 3.5), v.bq('lowpass', 2500, 0.7), v.bq('lowpass', 2800, 0.6), v.g(1));
    post.connect(v.out);
    v.send(post, 'room', 0.2, 'voice');
  } else {
    const post = v.chain(voiceIn, v.bq('highpass', 300, 0.75), v.bq('highpass', 320, 0.6), v.bq('peaking', 1800, 1.2, 4),
      v.g(MIX.radioDrive), v.shaper(radioCurve(2.2, 0.12)), v.g(1 / MIX.radioDrive * 1.6),
      v.bq('lowpass', 3000, 0.75), v.bq('lowpass', 3100, 0.6), v.g(1));
    post.connect(v.out);
    v.send(post, 'room', 0.1, 'voice');
    staticIn = v.g(1);
    v.chain(staticIn, v.bq('highpass', 280, 0.7), v.bq('lowpass', 3300, 0.7), v.out);
  }

  // ---- 雜訊底（非 clean）：整段共用一組節點 ----
  let bed = null, crk = null;
  const zis = [], bursts = [];
  if (!clean) {
    const sN = v.noise('white', t0, t0 + total + 0.4);
    bed = v.g(0);
    v.chain(sN, v.bq('bandpass', 1700, 0.55), bed, staticIn);
    const cN = v.noise('white', t0, t0 + total + 0.4);
    crk = v.g(0);
    v.chain(cN, v.bq('highpass', 2400, 0.7), crk, staticIn);
    // 接通的「喀沙」
    hiss(v, staticIn, t0, { f: 2000, Q: 0.5, peak: MIX.squelch, a: 0.005, hold: 0.07, r: 0.06 });
  }

  // ---- 逐段 ----
  let tSeg = t0;
  const bedPts = [];
  segs.forEach((seg, si) => {
    const K = seg.kind;
    const isLast = si === segs.length - 1;
    const tokens = tokenize(seg.text);
    const plan = K.has('speech') ? planSegment(tokens, seg.dur, prof) : null;
    if (plan) synthSpeech(v, voiceIn, tSeg, plan, prof);
    if (K.has('breath')) synthBreath(v, voiceIn, tSeg, seg.dur, plan, 1);
    const gaps = gapsOf(plan, seg.dur);
    if (K.has('knock')) {
      const g = gaps[0];
      const at = g && g.d >= 0.6 ? g.t + 0.05 : Math.max(0.1, seg.dur - 0.95);
      knockSet(v, doorIn, tSeg + at, { count: 3, spacing: rand(0.24, 0.3), amp: MIX.knock * (si >= 2 ? 1.12 : 1) });
    }
    if (K.has('axe')) {
      const hits = [];
      for (let x = 0.3; x < seg.dur - 0.35; x += rand(1.12, 1.3)) hits.push(x);
      hits.forEach((x, i) => axeHit(v, doorIn, tSeg + x, MIX.axe * (i === hits.length - 1 && isLast ? 0.75 : rand(0.88, 1))));
    }
    if (K.has('cough')) {
      if (plan) {
        const syl = plan.items.filter((i) => i.type === 'syl');
        const endT = syl.length ? syl[syl.length - 1].t + syl[syl.length - 1].d : 0;
        const at = Math.min(endT + 0.04, Math.max(0.05, seg.dur - 0.45));
        coughGroup(v, voiceIn, tSeg + at, { count: isLast ? 2 : 3, amp: MIX.cough, f0: prof.f0 * 1.05 });
      } else if (K.has('axe')) {
        coughGroup(v, voiceIn, tSeg + 0.62, { count: 3, amp: MIX.cough, f0: prof.f0 * 1.05 });
        if (seg.dur > 3.2) coughGroup(v, voiceIn, tSeg + Math.min(2.95, seg.dur - 1.6), { count: 4, amp: MIX.cough * 0.9, f0: prof.f0 });
      } else {
        coughGroup(v, voiceIn, tSeg + 0.1, { count: 4, amp: MIX.cough, f0: prof.f0 * 1.05 });
      }
    }
    // 雜訊：每段的底噪強度
    if (!clean) {
      const lvl = MIX.staticBed * noise * (K.has('static') ? 1 : 0.34) * (plan ? 0.78 : 1);
      bedPts.push({ t: tSeg, lvl, end: tSeg + seg.dur, crackleRate: (K.has('static') ? 22 : 7) * noise });
      if (plan) for (const it of plan.items) if (it.type === 'zi') zis.push({ t: tSeg + it.t, d: it.d, long: !!it.long });
      if (!plan) {
        // 純雜訊段裡的「滋」：平均分布
        const zs = tokens.filter((tk) => tk.type === 'zi');
        zs.forEach((z, i) => zis.push({ t: tSeg + seg.dur * (i + 1) / (zs.length + 1) - 0.1, d: 0.25, long: !!z.long }));
      }
      if (K.has('burst')) {
        const z = zis.filter((q) => q.t >= tSeg && q.long).pop();
        const at = z ? z.t : tSeg + Math.max(0.2, seg.dur - 1.15);
        bursts.push({ t: at, cut: isLast });
        if (z) zis.splice(zis.indexOf(z), 1);
      }
    }
    tSeg += seg.dur;
  });

  if (!clean && bed) {
    const p = bed.gain;
    p.setValueAtTime(0, t0);
    const busy = (t) => zis.some((z) => t > z.t - 0.05 && t < z.t + z.d + 0.35) || bursts.some((b) => t > b.t - 0.05);
    for (const s of bedPts) {
      p.setTargetAtTime(s.lvl, s.t, 0.08);
      let x = s.t + rand(0.12, 0.3);
      while (x < s.end - 0.16) { if (!busy(x)) p.setTargetAtTime(s.lvl * rand(0.55, 1), x, 0.05); x += rand(0.12, 0.35); }
    }
    for (const z of zis) {
      const s = bedPts.find((b) => z.t >= b.t && z.t < b.end) || bedPts[0];
      const top = Math.min(MIX.staticBed * 1.6, s.lvl * 2.4 + MIX.staticBed * noise * 0.4);
      // 以 dB 線性（指數）上升 0.12 秒：是「湧起」而不是「爆開」
      p.setValueAtTime(Math.max(1e-4, s.lvl), z.t);
      p.exponentialRampToValueAtTime(Math.max(1e-4, top), z.t + 0.12);
      p.setTargetAtTime(s.lvl, Math.max(z.t + z.d, z.t + 0.13), 0.08);
    }
    for (const b of bursts) {
      // 0.3 秒（dB 線性）湧到中等音量，再約 0.8 秒衰減（絕不是尖峰）
      const s = bedPts.find((q) => b.t >= q.t && b.t < q.end) || bedPts[bedPts.length - 1];
      const top = Math.min(MIX.burstPeak, MIX.staticBed * Math.max(0.5, noise) * 3.5);
      p.setValueAtTime(Math.max(1e-4, s.lvl), b.t);
      p.exponentialRampToValueAtTime(Math.max(1e-4, top), b.t + 0.3);
      p.setTargetAtTime(b.cut ? 0 : MIX.staticBed * noise * 0.3, b.t + 0.31, 0.27);
    }
    // 結尾的「喀沙」與斷線
    const tEnd = t0 + total;
    const hasCut = bursts.some((b) => b.cut);
    if (!hasCut) {
      p.setTargetAtTime(0, tEnd - 0.12, 0.04);
      hiss(v, staticIn, tEnd - 0.2, { f: 2100, Q: 0.5, peak: MIX.squelch * 0.9, a: 0.005, hold: 0.06, r: 0.05 });
    }
    // 劈啪顆粒（依時間排序、不重疊）
    const cp = crk.gain;
    cp.setValueAtTime(0, t0);
    let x = t0 + 0.05;
    const amp0 = MIX.crackle * noise * (reduce ? 0.5 : 1);
    while (x < tEnd - 0.08) {
      const s = bedPts.find((b) => x >= b.t && x < b.end) || bedPts[bedPts.length - 1];
      const inZi = zis.some((z) => x > z.t && x < z.t + z.d) || bursts.some((b) => x > b.t && x < b.t + 0.9);
      const rate = s.crackleRate * (inZi ? 2.5 : 1) + 1;
      const len = rand(0.002, 0.016);
      const a = amp0 * rand(0.15, 1) * (inZi ? 1.3 : 1);
      if (reduce) { cp.setTargetAtTime(a, x, 0.004); cp.setTargetAtTime(0, x + len + 0.006, 0.006); }
      else { cp.setValueAtTime(0, x); cp.linearRampToValueAtTime(a, x + 0.0008); cp.setTargetAtTime(0, x + len, 0.002); }
      x += len + 0.006 + (-Math.log(1 - Math.random()) / rate);
    }
    cp.setTargetAtTime(0, tEnd - 0.05, 0.01);
  }

  // clean：錄音的開始與結束的極輕微「喀」
  if (clean) {
    click(v, voiceIn, t0, { f: 900, Q: 0.7, peak: 0.08, tc: 0.004 });
    click(v, voiceIn, t0 + total - 0.12, { f: 900, Q: 0.7, peak: 0.06, tc: 0.004 });
  }

  v.finish(t0 + total + 1.4);
  v.total = total;
  return v;
}
