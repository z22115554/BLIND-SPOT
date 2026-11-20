// =============================================================================
// Voice — 一次性（或持續層）音效的節點容器
//   * 追蹤自己建立的所有節點與音源；結束時（以 AudioContext 時間計，暫停會一起凍結）
//     自動 stop + disconnect，避免節點洩漏。
//   * 提供精簡的合成積木：g() 增益、bq() 濾波、osc() 振盪器、noise() 噪音、conv() 捲積、send() 殘響送出。
//   * position → HRTF PannerNode（inverse 距離模型）。
// =============================================================================
import { glide, perc, asr, toPos } from './dsp.js';

/** 常數訊號源：ConstantSourceNode（舊版 Safari 退回「全 1 的循環緩衝 → GainNode」）。回傳 { node, param }。 */
export function constSource(ac, value) {
  if (typeof ac.createConstantSource === 'function') {
    const n = ac.createConstantSource(); n.offset.value = value;
    return { node: n, param: n.offset, out: n };
  }
  if (!ac.__ones) { const b = ac.createBuffer(1, 128, ac.sampleRate); b.getChannelData(0).fill(1); ac.__ones = b; }
  const n = ac.createBufferSource(); n.buffer = ac.__ones; n.loop = true;
  const g = ac.createGain(); g.gain.value = value; n.connect(g);
  return { node: n, param: g.gain, out: g, extra: g };
}

export class Voice {
  /**
   * @param {import('./AudioEngine.js').AudioEngine} E
   * @param {AudioNode} dest 目的地（通常是某條匯流排）
   * @param {{gain?:number, position?:object, panner?:object, pan?:number, bus?:string}} opts
   */
  constructor(E, dest, { gain = 1, position = null, panner = null, pan = null, bus = 'sfx' } = {}) {
    this.E = E;
    this.ac = E.ac;
    this.bus = bus;
    this.nodes = [];
    this.sources = [];
    this.done = false;
    this.endTime = 0;
    this._sent = null;
    this._wet = {};
    this._borrowed = [];
    this._stoppedEarly = false;
    // out：合成節點的匯流點（unity）。整體音量由 level（ConstantSource）同時驅動乾聲 vol 與所有殘響送出，
    // 所以淡出/opts.gain 會一致地作用在乾聲與殘響上。
    this.out = this.g(1);
    const lv = constSource(this.ac, gain);
    this.level = lv.node;
    this._levelParam = lv.param;
    this._levelOut = lv.out;
    this.track(this.level);
    if (lv.extra) this.track(lv.extra);
    this.sources.push(this.level);
    this.level.start();
    this.vol = this.g(0);
    this._levelOut.connect(this.vol.gain);
    this.out.connect(this.vol);
    let tail = this.vol;
    const pos = toPos(position);
    if (pos) {
      this.panner = this.track(E.makePanner(pos, panner || {}));
      tail.connect(this.panner); tail = this.panner;
    } else if (pan != null && typeof this.ac.createStereoPanner === 'function') {
      const sp = this.track(this.ac.createStereoPanner());
      sp.pan.value = Math.max(-1, Math.min(1, pan));
      tail.connect(sp); tail = sp;
    }
    tail.connect(dest);
  }

  track(n) { this.nodes.push(n); return n; }
  _src(n, t0, t1) {
    this.sources.push(n);
    n._t1 = t1;
    try { n.start(Math.max(0, t0)); } catch (e) { /* already started */ }
    if (t1 != null) { try { n.stop(Math.max(t0 + 0.001, t1)); } catch { /* ignore */ } this.endTime = Math.max(this.endTime, t1); }
    return n;
  }

  // ---- 節點積木 ---------------------------------------------------------------
  g(v = 1) { const n = this.ac.createGain(); n.gain.value = v; return this.track(n); }
  bq(type, f, Q = 0.707, gainDb = 0) {
    const n = this.ac.createBiquadFilter();
    n.type = type; n.frequency.value = f; n.Q.value = Q; n.gain.value = gainDb;
    return this.track(n);
  }
  osc(type, f, t0, t1, detune = 0) {
    const n = this.ac.createOscillator();
    if (typeof type === 'string') n.type = type; else n.setPeriodicWave(type);
    n.frequency.value = f; n.detune.value = detune;
    this.track(n);
    return this._src(n, t0, t1);
  }
  /** 循環噪音（隨機起點 → 每次去相關）。 */
  noise(color, t0, t1, rate = 1) {
    const n = this.ac.createBufferSource();
    n.buffer = this.E.noise[color] || this.E.noise.white;
    n.loop = true;
    n.playbackRate.value = rate;
    this.track(n);
    this.sources.push(n);
    n._t1 = t1;
    const off = Math.random() * Math.max(0.01, n.buffer.duration - 0.05);
    n.start(Math.max(0, t0), off);
    if (t1 != null) { n.stop(Math.max(t0 + 0.001, t1)); this.endTime = Math.max(this.endTime, t1); }
    return n;
  }
  /** 捲積器（向引擎的池子借用：設定 buffer 的 FFT 分割很貴，不能每個音效都新建）。 */
  conv(name) {
    const c = this.E.borrowConv(name);
    this._borrowed.push(c);
    return c;
  }
  shaper(curve, oversample = '2x') {
    const s = this.ac.createWaveShaper();
    s.curve = curve; s.oversample = oversample;
    return this.track(s);
  }
  merger(n = 2) { return this.track(this.ac.createChannelMerger(n)); }
  /** 依序串接，回傳最後一個節點。 */
  chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
  /** 殘響送出（共用的捲積器在引擎上，輸出回到指定匯流排）；與乾聲一起受 level 控制。 */
  send(node, irName, amount, bus = this.bus) {
    const inp = this.E.verbIn(irName, bus);
    if (!inp || amount <= 0) return null;
    const key = `${irName}:${bus}`;
    if (!this._wet[key]) {
      const w = this.g(0);
      this._levelOut.connect(w.gain);
      w.connect(inp);
      this._wet[key] = w;
    }
    const s = this.g(amount);
    node.connect(s); s.connect(this._wet[key]);
    return s;
  }
  /** 整體音量參數（淡入淡出用）。 */
  get gainParam() { return this._levelParam; }

  // ---- 包絡 -------------------------------------------------------------------
  perc(param, t, peak, a, tc) { perc(param, t, peak, a, tc); }
  asr(param, t, peak, a, hold, r) { asr(param, t, peak, a, hold, r); }

  // ---- 生命週期 -----------------------------------------------------------------
  /** 宣告結束時間：之後（AudioContext 時間）自動清理所有節點。 */
  finish(endT) {
    if (this.done) return this;
    const ac = this.ac;
    this.endTime = Math.max(this.endTime, endT);
    if (this._sent) { try { this._sent.stop(this.endTime + 0.05); } catch { /* ignore */ } return this; }
    const s = constSource(ac, 0).node;
    const z = ac.createGain(); z.gain.value = 0;
    s.connect(z); z.connect(this.E.sink);
    s.onended = () => { try { z.disconnect(); } catch { /* ignore */ } this.dispose(); };
    s.start(ac.currentTime);
    s.stop(this.endTime + 0.05);
    this._sent = s;
    return this;
  }

  /** 平滑淡出並提早結束。 */
  stop(fade = 0.25) {
    if (this.done) return;
    const now = this.ac.currentTime;
    const f = Math.max(0.15, fade);
    glide(this._levelParam, 0, now, f);
    const end = now + f * 1.7 + 0.05;
    for (const n of this.sources) {
      if (n === this.level) continue;
      if (n._t1 == null || n._t1 > end) { try { n.stop(end); } catch { /* ignore */ } n._t1 = end; }
    }
    if (this._sent) { try { this._sent.stop(end + 0.05); } catch { /* ignore */ } }
    else this.finish(end);
    this.endTime = end;
    this._stoppedEarly = true;
  }

  /** 立刻停止並斷開（僅在增益已趨近 0 時使用）。 */
  kill() {
    for (const n of this.sources) { try { n.stop(); } catch { /* ignore */ } }
    if (this._sent) { try { this._sent.stop(); } catch { /* ignore */ } }
    this.dispose();
  }

  dispose() {
    if (this.done) return;
    this.done = true;
    try { this.level.stop(); } catch { /* ignore */ }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
    this.nodes.length = 0;
    // 提早停止的捲積器內部可能還有殘響尾巴 → 不放回池子
    for (const c of this._borrowed) this.E.returnConv(c, !this._stoppedEarly);
    this._borrowed.length = 0;
    this.sources.length = 0;
    this.onDispose?.();
  }
}
