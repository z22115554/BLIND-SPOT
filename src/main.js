// =============================================================================
// 《盲區交接》BLIND SPOT — 進入點
// 建立 renderer / 共用 ctx / 所有模組，並驅動主迴圈。
// 模組建構順序很重要：建構子只能使用「之前已建立」的模組；跨模組連結放在 init()。
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

function boot() {
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');

  // ---- Renderer ---------------------------------------------------------------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (err) {
    document.body.innerHTML = '<p style="color:#ccc;font:16px sans-serif;padding:2em">此瀏覽器無法啟用 WebGL，請改用最新版 Chrome / Edge / Firefox / Safari。</p>';
    throw err;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
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

  // ---- 模組（順序 = 依賴順序）-------------------------------------------------
  ctx.textures = new TextureFactory(ctx);
  ctx.audio = new AudioEngine(ctx);
  ctx.ui = new UI(ctx);
  ctx.subtitles = new Subtitles(ctx);
  ctx.postfx = new PostFX(ctx);
  ctx.controlRoom = new ControlRoom(ctx);
  ctx.corridor = new Corridor(ctx);
  ctx.feeds = new CameraFeeds(ctx);
  ctx.player = new PlayerController(ctx);
  ctx.interact = new Interaction(ctx);
  ctx.gaze = new GazeSystem(ctx);
  ctx.inspect = new InspectView(ctx);
  ctx.fsm = new StateMachine(ctx);

  const modules = [ctx.textures, ctx.audio, ctx.ui, ctx.subtitles, ctx.postfx, ctx.controlRoom, ctx.corridor,
    ctx.feeds, ctx.player, ctx.interact, ctx.gaze, ctx.inspect];
  for (const m of modules) { try { m.init?.(); } catch (e) { console.error('[boot] init failed', m?.constructor?.name, e); } }

  registerStates(ctx);

  // ---- 視窗與暫停 ---------------------------------------------------------------
  const onResize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    ctx.postfx.setSize(w, h);
    ctx.bus.emit('resize', { w, h });
  };
  window.addEventListener('resize', onResize);

  // 暫停：PlayerController 在指標鎖定解除時 emit 'pause:request'；UI 點擊繼續時 emit 'pause:resume'
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
  function frame(now) {
    const realDt = (now - last) / 1000; last = now;
    ctx.clock.tick(realDt * timeScale);
    const dt = ctx.clock.dt, t = ctx.clock.time;

    ctx.fsm.update(dt, t);
    ctx.player.update(dt, t);
    ctx.interact.update(dt, t);
    ctx.gaze.update(dt, t);
    ctx.feeds.update(dt, t);
    ctx.controlRoom.update(dt, t);
    ctx.corridor.update(dt, t);
    ctx.audio.update(dt, t);
    ctx.subtitles.update(dt, t);
    ctx.ui.update(dt, t);
    ctx.inspect.update(dt, t);

    ctx.feeds.renderFeeds(renderer);            // CCTV → WebGLRenderTarget
    ctx.postfx.render(dt, t);                   // 主場景 + 後期處理
    ctx.inspect.renderOverlay(renderer);        // 檢視物件疊加層

    if (debug) {
      fpsAcc += realDt; fpsFrames++;
      if (fpsAcc > 0.5) {
        const p = ctx.player.position;
        ctx.ui.debugText(`${Math.round(fpsFrames / fpsAcc)} fps | ${ctx.fsm.currentName} | ${ctx.flags.clockText} | ` +
          `pos ${p.x.toFixed(1)},${p.z.toFixed(1)} | zone ${ctx.player.zone} | fig ${ctx.feeds.figureIndex} | ` +
          `obs ${ctx.gaze.mainScreenObserved ? 1 : 0} | ch ${ctx.feeds.channel} ${ctx.feeds.mode}`);
        fpsAcc = 0; fpsFrames = 0;
      }
    }
    requestAnimationFrame(frame);
  }

  // ---- 開始 ---------------------------------------------------------------
  const startState = params.get('state');
  ctx.fsm.go(STATES.TITLE, { next: startState && STATES[startState] ? STATES[startState] : STATES.PROLOGUE });
  requestAnimationFrame(frame);

  if (debug) window.BS = ctx; // 測試自動化與除錯用
  window.addEventListener('error', (e) => console.error('[uncaught]', e.message));
  return ctx;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
