// =============================================================================
// AudioEngine — Web Audio API 程式化音效引擎（零外部音檔）
// 【API 骨架 / CONTRACT STUB】實作者必須保留下列所有公開方法與回傳型別。
// 所有方法在 unlock() 之前被呼叫都必須安全地無作用（不可丟例外）。
//
// 響度紀律（零跳臉）：
//   * master → DynamicsCompressor（限幅）→ destination；任何單一音效峰值 ≤ 約 -10 dBFS。
//   * 任何層的音量變化都要用 ramp（≥ 0.15 秒），禁止瞬間大音量。
//   * 「恐怖」來自聲音的缺席與錯位（通風停止的真空感、延遲半拍的腳步），而非音量。
//
// 節點圖：
//   ambience 匯流排（hum / vent / room tone / corridor / rumble / smoke / alarm）
//       → 「聽覺真空」低通（20 kHz → ~300 Hz）＋ 壓低 → master
//   sfx 匯流排 → 較輕微的真空處理（20 kHz → 2.2 kHz）→ master
//   voice（對講機，HRTF 定位在對講機面板）、heartbeat、footsteps → master（不受 setSilence 影響）
//   master（音量）→ DynamicsCompressor（限幅）→ trim（抵銷壓縮器自動補償增益）→ destination
//                                                                     └→ this.analyser（測試用）
// 素材（unlock 時即時生成）：白/粉紅/棕噪音循環緩衝、捲積殘響 'room' 0.6 s / 'corridor' 2.4 s / 'door'。
// =============================================================================

/**
 * one-shot 音效名稱（sfx(name)）：
 *  'tubeStart'     日光燈啟動器的喀噠聲＋燈管點亮的微弱嗡聲
 *  'relayTrip'     遠處繼電器跳脫的悶響＋電力下降的嗚咽（不可大聲）
 *  'powerUp'       多個繼電器依序吸合＋電流嗡聲回升
 *  'button'        控制台按鈕
 *  'camSwitch'     頻道切換的繼電器喀噠＋CRT 高頻微響
 *  'lever'         金屬拉桿
 *  'unlatch'       門閂/電磁鎖解除
 *  'doorCreak'     厚重鐵門緩慢鉸鏈聲（低沉、長）
 *  'pneumaticHiss' 氣壓閥洩壓
 *  'heavySlide'    防爆門滑動的低頻摩擦（持續 opts.duration 秒）
 *  'paper'         翻動紙張
 *  'mug'           馬克杯放回桌面
 *  'metalTick'     管線熱脹冷縮的輕響
 *  'carPass'       防火門外車輛呼嘯而過（隔著玻璃悶住，多普勒）
 *  'breaker'       總開關推上的巨大但被包住的金屬聲
 *  'fanSpinUp' / 'fanSpinDown'
 *  'penScratch'    筆尖在紙上書寫（持續 opts.duration 秒）
 *  'bodySlump'     趴倒在桌上
 *  'flashlight'    手電筒開關
 *  'crtBoot'       CRT 啟動的消磁悶響（柔和）
 *  'staticBurst'   中等音量的雜訊爆音（快速淡出）
 *  'cough'         悶在面罩裡的咳嗽
 *  'doorThud'      門外破門斧劈在鋼門上的悶響（隔著厚鋼門，低沉、被包住，不可尖銳）
 * opts: { position?: THREE.Vector3（3D 定位，HRTF）, gain?: number, duration?: number }
 */
import { makeNoiseBuffer, makeImpulseResponse, glide, follow, dbToGain, clamp, rand, toPos } from './dsp.js';
import { Voice } from './Voice.js';
import { HumLayer, VentLayer, RoomToneLayer, CorridorLayer, RumbleLayer, SmokeLayer, AlarmLayer, HeartbeatLayer, RingLayer } from './layers.js';
import { SFX, AMBIENT, makeStepParams, playStep } from './sfx.js';
import { playIntercomStage, MIX as INTERCOM_MIX } from './intercom.js';

// 限幅器：threshold -18 dB / knee 6 / ratio 12 / attack 3 ms / release 250 ms
const LIMITER = { threshold: -18, knee: 6, ratio: 12, attack: 0.003, release: 0.25 };
// Web Audio 規範的 DynamicsCompressor 會自動加上補償增益 (1/fullRangeGain)^0.6。
// 以上述參數在 Chromium 實測為 +8.7 dB；trim 把它抵銷，讓 threshold 以下的訊號以 unity 通過、
// 而任何超過 threshold 的峰值都被壓在約 -15 dBFS 附近 → 真正的「天花板」。
const LIMITER_MAKEUP_DB = 8.7;

/** 各 one-shot 音效的校準增益（量測：見 testsRun；目標峰值 -24 ～ -13 dBFS，音量 1.0、距離 ≤ 1 m）。 */
export const SFX_GAIN = {
  tubeStart: 0.22, relayTrip: 0.065, powerUp: 0.147, button: 0.24, camSwitch: 0.23, lever: 0.155, unlatch: 0.2,
  doorCreak: 0.32, pneumaticHiss: 0.19, heavySlide: 0.097, paper: 0.23, mug: 0.127, metalTick: 0.2, carPass: 0.098,
  breaker: 0.094, fanSpinUp: 0.097, fanSpinDown: 0.106, penScratch: 0.17, bodySlump: 0.134, flashlight: 0.41,
  crtBoot: 0.135, staticBurst: 0.46, cough: 0.19, doorThud: 0.1,
};
const FOOT_GAIN = 0.18;
const AMB_GAIN = { drip: 0.2, pipeTick: 0.32, groan: 0.08 };
const VERB_RETURN = { room: 0.8, corridor: 1.0, door: 0.6 };
const VERB_HP = { room: 130, corridor: 110, door: 40 };
const TINNITUS = dbToGain(-58);
/** sfx 的 HRTF 參數：inverse 距離模型、refDistance 1、rolloff 1.2 */
const PANNER_SFX = { ref: 1, rolloff: 1.2 };

const volCurve = (v) => Math.pow(clamp(Number(v), 0, 1), 1.5);

export class AudioEngine {
  constructor(ctx) {
    this.ctx = ctx;
    this.ac = null;      // AudioContext（unlock 後建立）
    this.ready = false;
    /** AnalyserNode（限幅器之後；測試/除錯用）。unlock 前為 null。 */
    this.analyser = null;
    this.bus = {};
    this.noise = null;
    this.ir = null;
    this._verbs = {};
    this._vol = null;
    this._paused = false;
    this._silence = 0;
    this._intercom = null;
    this._unlockPromise = null;
    this._pending = [];
    this._convPool = {};
    this.echo = { enabled: false, delay: 0.45, gain: 0.35, extraStep: true };
    this._stops = 0;
    this._foot = 0;
    this._lastStep = null;
    this._lastEcho = 0;
    this._lp = { x: 0, y: 1.2, z: -1.6 };
    this._lf = { x: 0, y: 0, z: -1 };
    /** 可調參數（整合時微調用） */
    this.tuning = { sfxGain: SFX_GAIN, footGain: FOOT_GAIN, extraStepChance: 0.7, extraStepAlwaysFirst: 3, echoBehind: 3.2 };
    /** 對講機各成分的混音（可調） */
    this.intercomMix = INTERCOM_MIX;
    // 持續音層：unlock 前只記錄目標值，unlock 後套用
    this.L = {
      hum: new HumLayer(this),
      vent: new VentLayer(this),
      room: new RoomToneLayer(this),
      corridor: new CorridorLayer(this),
      rumble: new RumbleLayer(this),
      smoke: new SmokeLayer(this),
      alarm: new AlarmLayer(this),
      heartbeat: new HeartbeatLayer(this),
      ring: new RingLayer(this),
    };
  }

  init() {
    const bus = this.ctx.bus;
    if (!bus) return;
    bus.on('player:step', (p) => {
      const sp = Number(p?.speed);
      const intensity = Number.isFinite(sp) && sp > 0 ? clamp(sp / 1.45, 0.6, 1.3) : 1;
      this.footstep({ surface: p?.surface || 'concrete', intensity });
    });
    bus.on('player:stopped', (p) => this._onStopped(p || {}));
  }

  // ---- 生命週期 ---------------------------------------------------------------
  /** 必須在使用者手勢（click）的同步呼叫堆疊中呼叫。建立 AudioContext 與整個節點圖。回傳 Promise。 */
  unlock() {
    if (this.ac) {
      if (!this._paused) this._resumeCtx();
      return this._unlockPromise || Promise.resolve();
    }
    const AC = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
    if (!AC) { console.warn('[audio] Web Audio API 不可用，遊戲將以靜音進行'); return Promise.resolve(); }
    try {
      this.ac = new AC({ latencyHint: 'interactive' });
    } catch (e) {
      try { this.ac = new AC(); } catch (e2) { console.warn('[audio] 無法建立 AudioContext', e2); this.ac = null; return Promise.resolve(); }
    }
    // 同一個手勢堆疊內 resume（Safari / Chrome 自動播放政策）
    const resumed = this._resumeCtx();
    let built = false;
    try { this._build(); built = true; } catch (e) { console.error('[audio] 建立節點圖失敗', e); }
    if (this._paused) { try { this.ac.suspend(); } catch { /* ignore */ } }
    // 若自動播放政策仍擋住，下一次任何點擊/按鍵時再試一次
    const retry = () => { if (this.ac && this.ac.state === 'suspended' && !this._paused) this._resumeCtx(); };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, retry, { capture: true, passive: true });
    // 程式化素材（噪音、殘響 IR）分批在之後的幾個工作中生成，避免點擊處理函式卡住主執行緒；
    // 期間呼叫的持續層只記錄目標值，sfx/對講機排入佇列，素材完成後立即套用（序幕開頭本來就有 1 秒黑畫面）。
    const assets = new Promise((resolve) => {
      if (!built) { resolve(); return; }
      const ac = this.ac;
      this.ir = {};
      this.noise = {};
      const steps = [
        () => { this.noise.white = makeNoiseBuffer(ac, 'white', 5, 7); },
        () => { this.noise.pink = makeNoiseBuffer(ac, 'pink', 5, 8); this.noise.brown = makeNoiseBuffer(ac, 'brown', 5, 9); },
        () => { this.ir.room = makeImpulseResponse(ac, 'room'); this.ir.door = makeImpulseResponse(ac, 'door'); },
        () => { this.ir.corridor = makeImpulseResponse(ac, 'corridor'); },
        'ready',
        // 預先建立共用殘響與捲積器池（設定 ConvolverNode.buffer 會在主執行緒做 FFT 分割：廊道 IR 約 17 ms）
        () => { this.verbIn('room', 'sfx'); this.verbIn('room', 'footsteps'); },
        () => { this.verbIn('room', 'voice'); this.verbIn('room', 'ambience'); },
        () => { this._convPool.door = [this._makeConv('door'), this._makeConv('door')]; },
        () => { this.verbIn('corridor', 'footsteps'); },
        () => { this.verbIn('corridor', 'ambience'); },
        () => { this.verbIn('corridor', 'sfx'); },
        () => { this._convPool.door.push(this._makeConv('door')); },
      ];
      const run = () => {
        const step = steps.shift();
        if (step === 'ready') {
          this.ready = true;
          try { this._applyWanted(); this._flushPending(); } catch (e) { console.error('[audio] 套用音層失敗', e); }
          resolve();
        } else if (step) {
          try { step(); } catch (e) { console.error('[audio] 素材生成失敗', e); if (!this.ready) { steps.length = 0; resolve(); return; } }
        }
        if (steps.length) setTimeout(run, 0);
      };
      setTimeout(run, 0);
    });
    this._unlockPromise = Promise.race([
      Promise.all([resumed, assets]),
      new Promise((r) => setTimeout(r, 2500)), // 不讓呼叫端永遠等待（非劇情計時）
    ]).then(() => {});
    return this._unlockPromise;
  }

  /** 素材完成前呼叫的 sfx / 對講機（1 秒內）補播。 */
  _flushPending() {
    const now = performance.now();
    const list = this._pending.splice(0);
    for (const p of list) {
      if (p.cancelled || now - p.at > 1000) continue;
      if (p.kind === 'sfx') p.handle = this.sfx(p.name, p.opts);
      else if (p.kind === 'intercom' && !this._intercom) {
        try { this._intercom = playIntercomStage(this, this.ctx.SCRIPT.intercom[p.stage], p.stage); } catch (e) { console.error('[audio] playIntercom', e); }
      }
    }
  }

  _resumeCtx() {
    try { const p = this.ac?.resume?.(); return p && typeof p.then === 'function' ? p.catch(() => {}) : Promise.resolve(); }
    catch { return Promise.resolve(); }
  }

  suspend() {
    this._paused = true;
    if (this.ac && this.ac.state === 'running') { try { this.ac.suspend().catch(() => {}); } catch { /* ignore */ } }
  }

  resume() {
    this._paused = false;
    if (this.ac && this.ac.state !== 'closed') this._resumeCtx();
  }

  setMasterVolume(v) {
    const vol = clamp(Number(v), 0, 1);
    if (!Number.isFinite(vol)) return;
    this._vol = vol;
    if (!this.master) return;
    glide(this.master.gain, volCurve(vol), this.now(), 0.15);
  }

  now() { return this.ac ? this.ac.currentTime : 0; }

  _build() {
    const ac = this.ac;
    const G = (v = 1) => { const g = ac.createGain(); g.gain.value = v; return g; };
    this.sink = G(0); this.sink.connect(ac.destination);

    const vol = this.ctx.settings?.get?.('volume');
    this._settingsVol = vol;
    this._vol = this._vol ?? (Number.isFinite(Number(vol)) && vol != null ? clamp(Number(vol), 0, 1) : 0.8);
    this.master = G(volCurve(this._vol));
    this.limiter = ac.createDynamicsCompressor();
    this.limiter.threshold.value = LIMITER.threshold;
    this.limiter.knee.value = LIMITER.knee;
    this.limiter.ratio.value = LIMITER.ratio;
    this.limiter.attack.value = LIMITER.attack;
    this.limiter.release.value = LIMITER.release;
    this.trim = G(dbToGain(-LIMITER_MAKEUP_DB));
    this.master.connect(this.limiter); this.limiter.connect(this.trim); this.trim.connect(ac.destination);
    this.analyser = ac.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    this.trim.connect(this.analyser);

    const B = this.bus = {};
    B.ambience = G(1);
    this.silLP = ac.createBiquadFilter(); this.silLP.type = 'lowpass'; this.silLP.frequency.value = 20000; this.silLP.Q.value = 0.5;
    this.silGain = G(1);
    B.ambience.connect(this.silLP); this.silLP.connect(this.silGain); this.silGain.connect(this.master);
    B.sfx = G(1);
    this.sfxLP = ac.createBiquadFilter(); this.sfxLP.type = 'lowpass'; this.sfxLP.frequency.value = 20000; this.sfxLP.Q.value = 0.5;
    this.sfxDuck = G(1);
    B.sfx.connect(this.sfxLP); this.sfxLP.connect(this.sfxDuck); this.sfxDuck.connect(this.master);
    B.voice = G(1); B.voice.connect(this.master);
    B.heartbeat = G(1); B.heartbeat.connect(this.master);
    B.footsteps = G(1); B.footsteps.connect(this.master);

    // 對講機面板（HRTF）
    const ic = this.ctx.LAYOUT?.CONTROL_ROOM?.intercom || { x: -3.96, y: 1.45, z: -1.55 };
    this.intercomIn = G(1);
    this.intercomPanner = this.makePanner({ x: ic.x + 0.04, y: ic.y, z: ic.z }, { ref: 1.2, rolloff: 1 });
    this.intercomIn.connect(this.intercomPanner); this.intercomPanner.connect(B.voice);
    // 「身後」：腳步回音與多出來的一步
    // rolloff 0：方位交給 HRTF，音量由回音 gain 決定（+4 dB 補償 HRTF 背後的衰減與 1.2 kHz 低通）
    this.behindIn = G(1.6);
    this.behindPanner = this.makePanner({ x: 0, y: 0.25, z: 0 }, { ref: 1, rolloff: 0 });
    this.behindIn.connect(this.behindPanner); this.behindPanner.connect(B.footsteps);
    // 聽覺真空時極微弱的耳鳴（heartbeat 匯流排：不受 setSilence 低通影響）
    const tn = ac.createOscillator(); tn.frequency.value = 7150;
    const tv = ac.createOscillator(); tv.frequency.value = 0.31;
    const tvg = G(18); tv.connect(tvg); tvg.connect(tn.frequency);
    this.tinnitusG = G(0);
    tn.connect(this.tinnitusG); this.tinnitusG.connect(B.heartbeat);
    tn.start(); tv.start();

    this._updateListener(ac.currentTime, true);
  }

  /** unlock 前呼叫過的持續層設定 → 套用。 */
  _applyWanted() {
    for (const L of Object.values(this.L)) {
      if (L === this.L.vent) { if (L.target > 0) L.setParams({ level: L.target, rate: L.rate, detune: L.detune }, L.ramp || 1); }
      else if (L === this.L.heartbeat) { if (L.target > 0) { L.setBpm(L.bpmTarget, L.bpmRamp || 1); L.set(L.target, L.ramp || 1); } }
      else if (L.target > 0) L.set(L.target, L.ramp || 1);
    }
    if (this._silence > 0) this.setSilence(this._silence, 1);
  }

  /** HRTF PannerNode（inverse 距離模型）。o: { ref, rolloff } */
  makePanner(pos, o = {}) {
    const ac = this.ac;
    const p = ac.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = o.ref ?? 1;
    p.rolloffFactor = o.rolloff ?? 1.2;
    p.maxDistance = 200;
    const q = toPos(pos, { x: 0, y: 1.2, z: 0 });
    if (p.positionX) { p.positionX.value = q.x; p.positionY.value = q.y; p.positionZ.value = q.z; }
    else p.setPosition(q.x, q.y, q.z);
    return p;
  }

  _makeConv(name) {
    const c = this.ac.createConvolver();
    c.normalize = true;
    c.buffer = this.ir[name];
    c.__ir = name;
    return c;
  }
  /** 借出一個捲積器（池子空了才新建）。 */
  borrowConv(name) {
    const pool = this._convPool[name] || (this._convPool[name] = []);
    return pool.pop() || this._makeConv(name);
  }
  /** 歸還捲積器；reuse = false 時直接丟棄。 */
  returnConv(c, reuse = true) {
    try { c.disconnect(); } catch { /* ignore */ }
    const pool = this._convPool[c.__ir] || (this._convPool[c.__ir] = []);
    if (reuse && pool.length < 4) pool.push(c);
  }

  /** 共用捲積殘響的送出端（每個「IR × 匯流排」一個，延遲建立）。 */
  verbIn(ir, busName) {
    if (!this.ac || !this.ir?.[ir] || !this.bus[busName]) return null;
    const key = `${ir}:${busName}`;
    if (!this._verbs[key]) {
      const ac = this.ac;
      const inp = ac.createGain();
      const c = ac.createConvolver(); c.normalize = true; c.buffer = this.ir[ir];
      // 程式化 IR 的能量集中在低頻 → 回送端先高通，避免殘響轟隆
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = VERB_HP[ir] ?? 100; hp.Q.value = 0.6;
      const ret = ac.createGain(); ret.gain.value = VERB_RETURN[ir] ?? 0.5;
      inp.connect(c); c.connect(hp); hp.connect(ret); ret.connect(this.bus[busName]);
      this._verbs[key] = inp;
    }
    return this._verbs[key];
  }

  /** 依玩家所在區域回傳殘響空間名稱。 */
  space() {
    const z = this.ctx.player?.zone;
    return !z || z === 'controlRoom' || z === 'doorway' || z === 'outside' ? 'room' : 'corridor';
  }

  listenerPos() { return { ...this._lp }; }

  /** 小工具：建立一次性 Voice 並在 fn 回傳的秒數後自動清理。 */
  spawn(fn, { bus = 'sfx', gain = 1, position = null, panner = null } = {}) {
    if (!this.ready) return null;
    const t = this.now() + 0.01;
    const v = new Voice(this, this.bus[bus], { gain, position, panner, bus });
    const d = fn(v, t, {}, this);
    v.finish(t + (Number(d) || 1));
    return v;
  }
  spawnInto(dest, fn, t) {
    if (!this.ready) return null;
    const v = new Voice(this, dest, { gain: 1 });
    const d = fn(v, t);
    v.finish(t + (Number(d) || 1));
    return v;
  }
  ambientEvent(kind, level = 1) {
    const fn = AMBIENT[kind];
    if (!fn || !this.ready) return;
    const L = this._lp;
    const ang = rand(0, Math.PI * 2);
    const dist = kind === 'groan' ? rand(14, 26) : rand(3, 12);
    const pos = { x: L.x + Math.cos(ang) * dist, y: kind === 'drip' ? rand(0.05, 0.5) : rand(1.6, 2.4), z: L.z + Math.sin(ang) * dist };
    this.spawn(fn, { bus: 'ambience', gain: (AMB_GAIN[kind] || 0.3) * level, position: pos, panner: { ref: 2.5, rolloff: 1 } });
  }

  /** 每幀：listener 跟隨 ctx.camera；處理自動化（隨機滴水、管線聲等）。 */
  update(dt, t) {
    if (!this.ready) return;
    const now = this.ac.currentTime;
    try {
      this._updateListener(now);
      // 設定面板改了音量（Settings 沒有事件）→ 只在設定值「改變」時套用，不覆蓋直接呼叫 setMasterVolume 的結果
      const vol = this.ctx.settings?.get?.('volume');
      if (vol != null && vol !== this._settingsVol) { this._settingsVol = vol; this.setMasterVolume(vol); }
      for (const L of Object.values(this.L)) L.tick(now);
    } catch (e) {
      if (!this._updErr) { this._updErr = true; console.error('[audio] update', e); }
    }
  }

  _updateListener(now, snap = false) {
    const cam = this.ctx.camera;
    if (!cam || !this.ac) return;
    if (typeof cam.updateWorldMatrix === 'function') cam.updateWorldMatrix(true, false);
    const e = cam.matrixWorld?.elements;
    if (!e) return;
    const px = e[12], py = e[13], pz = e[14];
    let fx = -e[8], fy = -e[9], fz = -e[10];
    let ux = e[4], uy = e[5], uz = e[6];
    const fl = Math.hypot(fx, fy, fz) || 1, ul = Math.hypot(ux, uy, uz) || 1;
    fx /= fl; fy /= fl; fz /= fl; ux /= ul; uy /= ul; uz /= ul;
    if (![px, py, pz, fx, fy, fz, ux, uy, uz].every(Number.isFinite)) return;
    // 相機沒動就不再排程自動化事件
    const k = this._lk;
    if (!snap && k && Math.abs(k[0] - px) + Math.abs(k[1] - py) + Math.abs(k[2] - pz) < 1e-4 &&
      Math.abs(k[3] - fx) + Math.abs(k[4] - fy) + Math.abs(k[5] - fz) + Math.abs(k[6] - ux) + Math.abs(k[7] - uy) + Math.abs(k[8] - uz) < 1e-5) return;
    this._lk = [px, py, pz, fx, fy, fz, ux, uy, uz];
    this._lp = { x: px, y: py, z: pz };
    this._lf = { x: fx, y: fy, z: fz };
    const L = this.ac.listener;
    const tc = snap ? 0.001 : 0.025;
    if (L.positionX) {
      follow(L.positionX, px, now, tc); follow(L.positionY, py, now, tc); follow(L.positionZ, pz, now, tc);
      follow(L.forwardX, fx, now, tc); follow(L.forwardY, fy, now, tc); follow(L.forwardZ, fz, now, tc);
      follow(L.upX, ux, now, tc); follow(L.upY, uy, now, tc); follow(L.upZ, uz, now, tc);
    } else {
      try { L.setPosition(px, py, pz); L.setOrientation(fx, fy, fz, ux, uy, uz); } catch { /* ignore */ }
    }
    // 身後的回音點：水平方向後方 ~3.2 m、略偏右、貼近地面
    let hx = fx, hz = fz;
    const hl = Math.hypot(hx, hz);
    if (hl < 0.2) { hx = this._hf?.x ?? 0; hz = this._hf?.z ?? -1; } else { hx /= hl; hz /= hl; this._hf = { x: hx, z: hz }; }
    const back = this.tuning.echoBehind;
    const bx = px - hx * back + (-hz) * 0.45, bz = pz - hz * back + hx * 0.45;
    const P = this.behindPanner;
    if (P) {
      if (P.positionX) { follow(P.positionX, bx, now, 0.05); follow(P.positionY, 0.25, now, 0.05); follow(P.positionZ, bz, now, 0.05); }
      else { try { P.setPosition(bx, 0.25, bz); } catch { /* ignore */ } }
    }
  }

  // ---- 持續音層（全部冪等，ramp 秒數內平滑過渡）----------------------------------
  /** 日光燈電流嗡鳴（60Hz 基頻＋諧波＋細微劈啪）。level 0..1 */
  setHum(level, ramp = 1) { this.L.hum.set(level, ramp); }
  /** 通風扇白噪音。level 音量、rate 轉速 0..1（低轉速 = 更低沉、出現拍頻）、detune 變調程度 0..1（音高不穩地下滑）。level 0 = 停止。 */
  setVent({ level = 0.5, rate = 1, detune = 0 } = {}, ramp = 2) { this.L.vent.setParams({ level, rate, detune }, ramp); }
  /** 房間底噪（空調殘響、極低頻空氣感）。 */
  setRoomTone(level, ramp = 2) { this.L.room.set(level, ramp); }
  /** 廊道環境：遠處滴水、管線輕響、極遠處低頻隆隆（隨機排程）。 */
  setCorridorAmbience(level, ramp = 2) { this.L.corridor.set(level, ramp); }
  /** 隧道深處低頻轟鳴（火場/車道）。 */
  setTunnelRumble(level, ramp = 3) { this.L.rumble.set(level, ramp); }
  /** 低頻心跳（被「感覺到」而非聽到）。bpm 50..110 */
  setHeartbeat(bpm, level, ramp = 2) {
    const hb = this.L.heartbeat;
    hb.setBpm(bpm, ramp);
    hb.set(level, ramp);
  }
  /** 聽覺真空：0..1。對除了腳步/心跳/對講機以外的所有層做低通＋壓低，製造耳壓感。 */
  setSilence(amount, ramp = 3) {
    this._silence = clamp(Number(amount) || 0, 0, 1);
    if (!this.ready) return;
    const a = this._silence, now = this.now(), r = Math.max(0.15, Number(ramp) || 0.15);
    glide(this.silLP.frequency, 20000 * Math.pow(300 / 20000, a), now, r);
    glide(this.silGain.gain, 1 - 0.82 * a, now, r);
    glide(this.sfxLP.frequency, 20000 * Math.pow(2200 / 20000, a), now, r);
    glide(this.sfxDuck.gain, 1 - 0.3 * a, now, r);
    glide(this.tinnitusG.gain, TINNITUS * a * a, now, r * 1.5);
  }
  /** 低沉雙音警報（不可尖銳）。 */
  setAlarm(on, { level = 0.25 } = {}) {
    this.L.alarm.set(on ? clamp(Number(level) || 0.25, 0, 1) : 0, on ? 1.2 : 1.0);
  }
  /** 終幕：警報音高滑動、變形成日光燈電流聲。回傳 Promise（duration 秒後完成）。 */
  morphAlarmToHum(duration = 6) {
    const d = Math.max(0.5, Number(duration) || 6);
    const hum = this.L.hum, alarm = this.L.alarm;
    const humTarget = Math.max(hum.target, 0.6);
    if (this.ready) {
      const now = this.now();
      if (alarm.on && alarm.target > 0) alarm.morph(d, now);
      else alarm.set(0, 0.5);
      // 從 30% 開始把嗡聲淡入，結束時完全取代警報
      this.ctx.clock.wait(d * 0.3).then(() => this.setHum(humTarget, d * 0.7));
    } else {
      alarm.target = 0;
      hum.target = humTarget;
    }
    return this.ctx.clock.wait(d);
  }
  /** 濃煙湧入的呼嘯（濾波噪音）。 */
  setSmokeRoar(level, ramp = 2) { this.L.smoke.set(level, ramp); }
  /** 對講機來電：柔和的週期性蜂鳴（定位在對講機面板）。 */
  setIntercomRing(on) { this.L.ring.set(on ? 1 : 0, on ? 0.3 : 0.4); }

  /**
   * 播放對講機語音：stageIndex 0..3 對應 ctx.SCRIPT.intercom[stageIndex]。
   * 依 segments 的 dur 與 kind 合成（static / breath / speech / knock / cough / axe / burst）。
   * speech = 共振峰濾波噪音模擬的人聲呢喃（音節數 ≈ 該段中文字數），clean=false 時再經對講機頻帶（300–3000Hz）與雜訊。
   * 開始播放時會自動停止來電鈴聲。
   * @returns {{ duration: number, done: Promise<void> }}
   */
  playIntercom(stageIndex) {
    const stage = this.ctx.SCRIPT?.intercom?.[stageIndex];
    const segs = stage?.segments || [];
    const duration = segs.reduce((a, s) => a + (Number(s.dur) || 0), 0);
    const done = this.ctx.clock.wait(duration);
    if (this.ready && segs.length) {
      try {
        this.setIntercomRing(false);
        this.stopIntercom(0.3);
        this._intercom = playIntercomStage(this, stage, stageIndex);
      } catch (e) {
        console.error('[audio] playIntercom', e);
      }
    } else if (this.ac && segs.length) {
      this.setIntercomRing(false);
      this._pending.push({ kind: 'intercom', stage: stageIndex, at: performance.now() });
    }
    return { duration, done };
  }
  /** （額外）中止正在播放的對講機語音（平滑淡出）。 */
  stopIntercom(fade = 0.4) {
    const v = this._intercom;
    this._intercom = null;
    if (v && !v.done) v.stop(fade);
  }

  /** 腳步聲（由 'player:step' 事件自動觸發，也可直接呼叫）。surface: 'vinyl' | 'concrete' | 'metal' */
  footstep({ surface = 'concrete', intensity = 1 } = {}) {
    if (!this.ready) return;
    try {
      const t = this.now() + 0.005;
      this._foot ^= 1;
      const p = makeStepParams(surface, intensity, this._foot);
      const v = new Voice(this, this.bus.footsteps, { gain: this.tuning.footGain * p.gain, pan: p.pan, bus: 'footsteps' });
      v.finish(t + playStep(v, t, p));
      this._lastStep = { t, p };
      if (this.echo.enabled) {
        const te = t + this.echo.delay;
        this._echoStep(te, p, this.echo.gain);
        this._lastEcho = te;
      }
    } catch (e) {
      console.error('[audio] footstep', e);
    }
  }
  _echoStep(t, p, gain, heavy = false) {
    const v = new Voice(this, this.behindIn, { gain: this.tuning.footGain * p.gain * gain, bus: 'footsteps' });
    v.finish(t + playStep(v, t, p, { echo: true, heavy }));
  }
  _onStopped({ walkedFor } = {}) {
    if (!this.ready || !this.echo.enabled || !this.echo.extraStep || !this._lastStep) return;
    if (!(Number(walkedFor) > 1.0)) return;
    this._stops++;
    if (this._stops > this.tuning.extraStepAlwaysFirst && Math.random() > this.tuning.extraStepChance) return;
    try {
      const now = this.now();
      const base = (this._lastEcho || now) + this.echo.delay * rand(0.95, 1.12);
      const t = Math.max(now + 0.08, base);
      // 「多出一步」：不是你的那一步——另一隻腳、稍重
      const last = this._lastStep.p;
      const p = makeStepParams(last.surface, last.intensity, this._foot ^ 1);
      p.gain = last.gain * 1.04;
      this._echoStep(t, p, this.echo.gain * 1.1, true);
      this._lastEcho = t;
    } catch (e) {
      console.error('[audio] extra step', e);
    }
  }
  /** 廊道延遲回音：每步在 delay 秒後播放微弱、低通的鞋底摩擦回音；停下時（'player:stopped'）再多播一步。 */
  setFootstepEcho({ enabled = false, delay = 0.45, gain = 0.35, extraStep = true } = {}) {
    this.echo = {
      enabled: !!enabled,
      delay: clamp(Number(delay) || 0.45, 0.05, 2),
      gain: Number.isFinite(Number(gain)) ? clamp(Number(gain), 0, 1) : 0.35,
      extraStep: extraStep !== false,
    };
  }

  /** one-shot 音效，見檔頭清單。回傳 { stop() }。 */
  sfx(name, opts = {}) {
    const noop = { stop() {} };
    if (!this.ready) {
      // 已 unlock、素材仍在生成：排入佇列（不會遺失序幕開頭的音效）
      if (this.ac && SFX[name] && this._pending.length < 32) {
        const p = { kind: 'sfx', name, opts: opts || {}, at: performance.now(), cancelled: false, handle: null };
        this._pending.push(p);
        return { stop: (fade) => { p.cancelled = true; p.handle?.stop(fade); } };
      }
      return noop;
    }
    const fn = SFX[name];
    if (!fn) { console.warn(`[audio] 未知的音效 "${name}"`); return noop; }
    try {
      const o = opts || {};
      const t = this.now() + 0.01;
      const gain = (this.tuning.sfxGain[name] ?? 0.4) * clamp(Number(o.gain ?? 1), 0, 2);
      const v = new Voice(this, this.bus.sfx, { gain, position: o.position, panner: PANNER_SFX, bus: 'sfx' });
      const d = fn(v, t, o, this);
      v.finish(t + (Number(d) || 2));
      return { stop: (fade = 0.25) => v.stop(fade), duration: Number(d) || 0 };
    } catch (e) {
      console.error('[audio] sfx failed', name, e);
      return noop;
    }
  }

  // ---- 額外的公開輔助 -------------------------------------------------------------
  /** （額外）把所有持續層、對講機、回音一起平滑關掉（循環重置用）。 */
  silenceAll(ramp = 1.5) {
    for (const L of Object.values(this.L)) L.set(0, ramp);
    this.stopIntercom(ramp);
    this.setSilence(0, ramp);
    this.setFootstepEcho({ enabled: false });
  }
  /** （額外）除錯用：各層目前目標值。 */
  getState() {
    const o = { ready: this.ready, state: this.ac?.state ?? 'none', silence: this._silence, echo: { ...this.echo } };
    for (const [k, L] of Object.entries(this.L)) o[k] = { target: L.target, on: L.on };
    o.vent.rate = this.L.vent.rate; o.vent.detune = this.L.vent.detune; o.heartbeat.bpm = this.L.heartbeat.bpmTarget;
    return o;
  }
}
