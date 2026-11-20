// =============================================================================
// 《盲區交接》BLIND SPOT — 進入點
// 建立 renderer / 共用 ctx / 所有模組，並驅動主迴圈。
// 模組建構順序很重要：建構子只能使用「之前已建立」的模組；跨模組連結放在 init()。
// -----------------------------------------------------------------------------
// 開機流程（不阻塞畫面）：index.html 先畫出「載入中…」，boot 分段建構模組，段與段之間讓出一幀
// （requestAnimationFrame），訊息才畫得出來；全部建構完後預先編譯主場景所有材質的 shader
// （ctx.precompile()，避免第一次走進廊道/終幕時卡頓），然後才進入標題並移除載入訊息。
// ?autostart=1（測試/開發）：同步開機（load 事件之後遊戲就緒，自動化測試的時間基準不變）。
// 主迴圈：每一步都包在 try/catch 裡，單一模組一次例外不會讓整個迴圈停擺（每個步驟只記錄一次錯誤）。
// 解析度：像素比上限 1.5；畫面持續過慢時自動降一階（之後夠快再升回），變更間隔至少數秒，避免忽大忽小。
// =============================================================================
import * as THREE from 'three';
import { EventBus } from './core/EventBus.js';
import { GameClock } from './core/GameClock.js';
import { StateMachine, STATES } from './core/StateMachine.js';
import { Settings } from './core/Settings.js';
import * as util from './core/util.js';
import { SCRIPT, CLOCK } from './data/script.js';
import * as LAYOUT from './data/layout.js';

import { TextureFactory } from './gfx/TextureFactory.js';
import { PostFX } from './gfx/PostFX.js';
import { AudioEngine } from './audio/AudioEngine.js';
import { UI } from './systems/UI.js';
import { Subtitles } from './systems/Subtitles.js';
import { ControlRoom } from './world/ControlRoom.js';
import { Corridor } from './world/Corridor.js';
import { CameraFeeds } from './world/CameraFeeds.js';
import { PlayerController } from './systems/PlayerController.js';
import { Interaction } from './systems/Interaction.js';
import { GazeSystem } from './systems/GazeSystem.js';
import { InspectView } from './systems/InspectView.js';
import { registerStates } from './states/index.js';
import { ResolutionGovernor } from './core/resolution.js';

const nextFrame = () => new Promise((resolve) => {
  let done = false;
  const go = () => { if (!done) { done = true; resolve(); } };
  requestAnimationFrame(go);
  setTimeout(go, 120); // 背景分頁不會觸發 rAF：最多等 120 ms
});

async function boot() {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  // 測試/開發（?autostart=1）：同步開機；正式遊玩：分段開機（讓「載入中…」畫得出來）
  const syncBoot = params.has('autostart');
  const yieldFrame = syncBoot ? () => null : nextFrame;

  // ---- Renderer ---------------------------------------------------------------
  let renderer;
  try {
    // 預設 framebuffer 只會收到 OutputPass 的全螢幕四邊形：反鋸齒由 composer 的 MSAA 目標負責，這裡不需要
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  } catch (err) {
    document.body.innerHTML = '<p style="color:#ccc;font:16px sans-serif;padding:2em">此瀏覽器無法啟用 WebGL，請改用最新版 Chrome / Edge / Firefox / Safari。</p>';
    throw err;
  }
  const res = new ResolutionGovernor({ params });
  renderer.setPixelRatio(res.pixelRatio());
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.id = 'game-canvas';
  document.getElementById('app').appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  scene.fog = new THREE.FogExp2(0x050506, 0.02);
  const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.03, 120);
  camera.rotation.order = 'YXZ';
  scene.add(camera); // 讓掛在相機上的物件（手電筒）一起被渲染

  // ---- 共用 ctx ---------------------------------------------------------------
  const ctx = {
    THREE, renderer, scene, camera,
    bus: new EventBus(),
    clock: new GameClock(),
    settings: new Settings(),
    util, SCRIPT, CLOCK, LAYOUT, STATES,
    debug,
    params,
    // 劇情旗標（各狀態讀寫；直接跳關時由狀態自行補齊）
    flags: {
      clockText: CLOCK.start,
      corruption: 0,
      returnsFromCorridor: 0,
      hasFlashlight: false,
      powerRestored: false,
      itemsFound: { watch: false, logbook: false, coat: false },
      coffeeStage: 0,
      loopCount: 0,
    },
  };
  ctx.flags.loopCount = ctx.settings.get('loopCount') || 0;
  ctx.resolution = res;
  window.addEventListener('error', (e) => console.error('[uncaught]', e.message));

  // ---- 模組（順序 = 依賴順序；分段建構，段與段之間讓出一幀）-------------------------
  ctx.textures = new TextureFactory(ctx);
  ctx.audio = new AudioEngine(ctx);
  ctx.ui = new UI(ctx);
  ctx.subtitles = new Subtitles(ctx);
  ctx.postfx = new PostFX(ctx);
  await yieldFrame();
  ctx.controlRoom = new ControlRoom(ctx);
  await yieldFrame();
  ctx.corridor = new Corridor(ctx);
  await yieldFrame();
  ctx.feeds = new CameraFeeds(ctx);
  await yieldFrame();
  ctx.player = new PlayerController(ctx);
  ctx.interact = new Interaction(ctx);
  ctx.gaze = new GazeSystem(ctx);
  ctx.inspect = new InspectView(ctx);
  ctx.fsm = new StateMachine(ctx);

  const modules = [ctx.textures, ctx.audio, ctx.ui, ctx.subtitles, ctx.postfx, ctx.controlRoom, ctx.corridor,
    ctx.feeds, ctx.player, ctx.interact, ctx.gaze, ctx.inspect];
  for (const m of modules) { try { m.init?.(); } catch (e) { console.error('[boot] init failed', m?.constructor?.name, e); } }

  registerStates(ctx);

  // ---- Shader 預先編譯 ----------------------------------------------------------
  // renderer.compile 會走訪整個場景（包含目前隱藏的廊道/電閘室/焦黑與腐化層/濃煙粒子），以「目前的燈光組合」
  // 編譯每個材質的 program。必須在 composer 的 HalfFloat 目標下編譯（tone mapping / 色彩空間不同 = 不同 program）。
  // 燈光數量全程固定，所以這些 program 之後都會被直接沿用。狀態可在過場時再呼叫一次（例如終幕前）。
  ctx.precompile = (opts = {}) => precompile(ctx, opts);
  await yieldFrame();
  if (syncBoot) ctx.precompile({ sync: true });
  else await ctx.precompile();

  // ---- 視窗與暫停 ---------------------------------------------------------------
  const applySize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    // 瀏覽器縮放 / 換到不同 DPI 的螢幕：重新套用像素比
    renderer.setPixelRatio(res.pixelRatio());
    renderer.setSize(w, h);
    ctx.postfx.setSize(w, h);
    return { w, h };
  };
  const onResize = () => { const s = applySize(); ctx.bus.emit('resize', s); };
  window.addEventListener('resize', onResize);
  // devicePixelRatio 改變但 CSS 尺寸沒變（拖到另一台螢幕）不會觸發 resize：監聽 resolution media query
  const watchDpr = () => {
    try {
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      const onChange = () => { mq.removeEventListener?.('change', onChange); res.onDprChange(); lastDpr = window.devicePixelRatio; onResize(); watchDpr(); };
      mq.addEventListener?.('change', onChange);
    } catch (e) { /* 舊瀏覽器：只靠 resize */ }
  };
  watchDpr();
  // 保險：每秒比對一次 devicePixelRatio（某些環境改變 DPR 時兩種事件都不會發出）
  let lastDpr = window.devicePixelRatio, dprCheck = 0;
  const checkDpr = (realDt) => {
    dprCheck += realDt;
    if (dprCheck < 1) return;
    dprCheck = 0;
    if (window.devicePixelRatio !== lastDpr) { lastDpr = window.devicePixelRatio; onResize(); }
  };
  res.onApply = () => applySize();   // 自動解析度變更（不發出 'resize'：CSS 尺寸沒變）

  // 暫停：PlayerController 在指標鎖定解除時（或拖曳模式下按 Esc）emit 'pause:request'；UI 點擊繼續時 emit 'pause:resume'
  ctx.setPaused = (p) => {
    if (ctx.clock.paused === p) return;
    ctx.clock.paused = p;
    if (p) ctx.audio.suspend(); else ctx.audio.resume();
    ctx.ui.showPause(p);
    ctx.bus.emit(p ? 'game:paused' : 'game:resumed');
  };
  ctx.bus.on('pause:request', () => { if (ctx.fsm.currentName !== STATES.TITLE) ctx.setPaused(true); });
  ctx.bus.on('pause:resume', () => ctx.setPaused(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) ctx.bus.emit('pause:request'); });

  // ---- 主迴圈 ---------------------------------------------------------------
  const timeScale = Math.max(0.1, Math.min(20, Number(params.get('speed') || 1))); // 測試用加速
  ctx.clock.scale = timeScale;
  let last = performance.now();
  let fpsAcc = 0, fpsFrames = 0;

  // 例外隔離：每一步獨立 try/catch。同一步驟只記錄第一次錯誤（避免每幀洗版）；
  // 連續失敗太多幀（例如渲染持續失敗 = 畫面凍結）才顯示錯誤訊息。
  const fails = new Map();   // name → { total, streak }
  let errorShown = false;
  const step = (name, fn) => {
    try {
      fn();
      const f = fails.get(name);
      if (f) f.streak = 0;
    } catch (e) {
      let f = fails.get(name);
      if (!f) { f = { total: 0, streak: 0 }; fails.set(name, f); }
      f.total++; f.streak++;
      if (f.total === 1) console.error(`[loop] ${name} failed`, e);
      else if (f.total === 100) console.warn(`[loop] ${name} has failed 100 times`);
      if (f.streak === 240 && !errorShown) {
        errorShown = true;
        try { ctx.ui.showError(SCRIPT.hints?.frameError || ''); } catch (e2) { /* ignore */ }
      }
    }
  };

  function frame(now) {
    // 先排下一幀：就算下面任何一步（含錯誤處理本身）意外丟出例外，迴圈也不會停
    requestAnimationFrame(frame);
    const realDt = Math.max(0, (now - last) / 1000); last = now;
    step('clock', () => ctx.clock.tick(realDt * timeScale));
    const dt = ctx.clock.dt, t = ctx.clock.time;

    step('fsm', () => ctx.fsm.update(dt, t));
    step('player', () => ctx.player.update(dt, t));
    step('interact', () => ctx.interact.update(dt, t));
    step('gaze', () => ctx.gaze.update(dt, t));
    step('feeds', () => ctx.feeds.update(dt, t));
    step('controlRoom', () => ctx.controlRoom.update(dt, t));
    step('corridor', () => ctx.corridor.update(dt, t));
    step('audio', () => ctx.audio.update(dt, t));
    step('subtitles', () => ctx.subtitles.update(dt, t));
    step('ui', () => ctx.ui.update(dt, t));
    step('inspect', () => ctx.inspect.update(dt, t));

    // 全黑（標題、終幕選單）時不渲染 3D：PostFX 只清成黑色，監視器畫面也不必更新
    const black = ctx.postfx.isBlack?.() === true;
    if (!black) step('renderFeeds', () => ctx.feeds.renderFeeds(renderer));   // CCTV → WebGLRenderTarget
    step('postfx', () => ctx.postfx.render(dt, t));                            // 主場景 + 後期處理
    step('inspectOverlay', () => ctx.inspect.renderOverlay(renderer));         // 檢視物件疊加層

    if (!document.hidden && !ctx.clock.paused && !black) step('resolution', () => res.sample(realDt));
    step('dpr', () => checkDpr(realDt));

    if (debug) {
      fpsAcc += realDt; fpsFrames++;
      if (fpsAcc > 0.5) {
        step('debug', () => {
          const p = ctx.player.position;
          ctx.ui.debugText(`${Math.round(fpsFrames / fpsAcc)} fps | ${ctx.fsm.currentName} | ${ctx.flags.clockText} | ` +
            `pos ${p.x.toFixed(1)},${p.z.toFixed(1)} | zone ${ctx.player.zone} | fig ${ctx.feeds.figureIndex} | ` +
            `obs ${ctx.gaze.mainScreenObserved ? 1 : 0} | ch ${ctx.feeds.channel} ${ctx.feeds.mode} | pr ${renderer.getPixelRatio().toFixed(2)}`);
        });
        fpsAcc = 0; fpsFrames = 0;
      }
    }
  }

  // ---- 開始 ---------------------------------------------------------------
  if (debug) window.BS = ctx; // 測試自動化與除錯用
  const startState = params.get('state');
  ctx.fsm.go(STATES.TITLE, { next: startState && STATES[startState] ? STATES[startState] : STATES.PROLOGUE });
  last = performance.now();
  requestAnimationFrame((now) => { frame(now); removeBootMessage(); });
  return ctx;
}

/** 預先編譯主場景（含隱藏物件）的所有 shader program。@returns {Promise<{before:number, after:number, ms:number}>} */
function precompile(ctx, { sync = false } = {}) {
  const { renderer, scene, camera, postfx } = ctx;
  const t0 = performance.now();
  const before = renderer.info.programs?.length ?? 0;
  const prevTarget = renderer.getRenderTarget();
  const done = () => {
    const r = { before, after: renderer.info.programs?.length ?? 0, ms: Math.round(performance.now() - t0) };
    if (ctx.debug) console.info(`[boot] precompile: programs ${r.before} → ${r.after} in ${r.ms} ms`);
    return r;
  };
  let p = null;
  try {
    camera.updateMatrixWorld();
    // composer 的場景目標（HalfFloat，線性輸出、不做 tone mapping）——與實際渲染相同的 program 變體
    const target = postfx?.composer?.readBuffer || null;
    renderer.setRenderTarget(target);
    if (sync || typeof renderer.compileAsync !== 'function') renderer.compile(scene, camera);
    else p = renderer.compileAsync(scene, camera);
  } catch (e) {
    console.warn('[boot] precompile failed', e);
  } finally {
    renderer.setRenderTarget(prevTarget);
  }
  if (!p) return Promise.resolve(done());
  // 最多等 20 秒（某些驅動不回報完成狀態時不會卡在載入畫面）
  return Promise.race([p, new Promise((r) => setTimeout(r, 20000))]).then(done, (e) => { console.warn('[boot] precompile', e); return done(); });
}

function removeBootMessage() {
  const el = document.getElementById('boot-msg');
  if (!el) return;
  el.style.opacity = '0';
  setTimeout(() => el.remove(), 700);
}

function start() {
  boot().catch((e) => {
    console.error('[boot] failed', e);
    const el = document.getElementById('boot-msg');
    if (el) el.remove();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
