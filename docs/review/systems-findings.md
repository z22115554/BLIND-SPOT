# Review findings assigned to the 'systems' fixer

Each finding below was verified by an independent reviewer (their evidence paths under /tmp/review-*/ still exist — scripts, logs and screenshots you may Read or reuse; their scripts point at /tmp/review-*/game.html, so copy & adapt them to your own build path).

---
## logic#0 [MAJOR] Main loop is not exception-safe: one throw in any module update freezes the game permanently

Files: src/main.js

**Description:** frame() in src/main.js (lines 129-160) calls ctx.player/interact/gaze/feeds/controlRoom/corridor/audio/subtitles/ui/inspect.update(), feeds.renderFeeds(), postfx.render() and inspect.renderOverlay() without any try/catch. requestAnimationFrame(frame) is the last statement (line 160). Only fsm.update is guarded, inside StateMachine.update. If any of these calls throws once, even from a one-frame glitch, the next frame is never scheduled. The game clock, story scripts, audio listener and rendering then stop for good, with no recovery and no error UI. The task spec lists 'errors thrown inside any module update not killing the loop' as a requirement.

**Evidence:** /tmp/review-logic/t_robust.js part (a): BS.corridor.update was wrapped so it throws exactly once. Result: 'game clock advanced after the single throw: 0.000 s' over 6 s, while an independent rAF probe in the same page counted 120 frames. Console: '[uncaught] Uncaught Error: transient test error'. BS.clock.time stayed at 1.8664 for good.

**Reviewer's suggested fix:** Schedule the next frame first (requestAnimationFrame(frame) at the top of frame()), or wrap each step: const step = (name, fn) => { try { fn(); } catch (e) { if (!errSeen[name]) { errSeen[name] = true; console.error(`[loop] ${name} failed`, e); } } }; then step('player', () => ctx.player.update(dt, t)); and so on for every update and render call. Optionally show ui.showError after N consecutive failures of the same step.

---
## logic#1 [MINOR] In drag-look fallback mode Esc does nothing: no pause, and settings (incl. reduce-flicker) unreachable mid-game

Files: src/systems/PlayerController.js, src/main.js, src/data/script.js

**Description:** 'pause:request' is only emitted from pointer-lock events: PlayerController._onLockChange (line 196), _onLockError (line 207), and visibilitychange in main.js:122. Without pointer lock (the documented fallback for iframe sandboxes, or when the first lock attempt had no user gesture) there is no key handler for Esc. The title legend still promises 'Esc：暫停' (script.js:161). The pause overlay is the only in-game place to change sensitivity, volume or the photosensitivity 'reduce flicker' option. A fallback-mode player cannot pause or reach these settings except by switching browser tabs.

**Evidence:** /tmp/review-logic/t_esc.js: after autostart, BS.player.dragMode === true and isLocked === false. page.keyboard.press('Escape'), then 600 ms later: 'drag mode, Esc pressed → paused = false pauseEl false'. Pressing P or Tab also does not pause. grep shows no Escape handler outside InspectView.js:176.

**Reviewer's suggested fix:** In PlayerController.init add: on(window,'keydown',e=>{ if (e.code==='Escape' && !e.repeat && !this.isLocked && !this.ctx.inspect?.isOpen && this.ctx.fsm?.currentName!==this.ctx.STATES.TITLE && !this.ctx.clock.paused) this.ctx.bus.emit('pause:request'); }). Inspect keeps priority for Esc. Optionally also bind P as a pause key in both modes.

---
## logic#2 [MINOR] Below ~10 fps the game clock runs slower than real time, so intercom subtitles fall behind the real-time voice audio

Files: src/core/GameClock.js, src/states/common.js, src/audio/AudioEngine.js

**Description:** GameClock.tick clamps every frame to 0.1 s × scale (GameClock.js:15). That guard is meant for tab switches, but it also applies to every frame on a slow machine. All story timing runs on game time, including playIntercom's segment loop (common.js:326 'await state.wait(seg.dur)') and the done/hold waits (common.js:328). The synthesized voice runs on the AudioContext clock (AudioEngine.playIntercom). Below 10 fps each subtitle segment appears later than the speech it captions, and the last lines appear after the voice has already finished.

**Evidence:** /tmp/review-logic/t_lowfps.js simulates about 6 fps by adding 150 ms of main-thread work per frame, then answers the 02:03 call (stage 0, scripted length 12.4 s). Subtitle appends, measured on the audio clock, landed at [0.01, 3.69, 9.42, 14.44] s against a scripted [0, 2.2, 5.8, 8.8]. The final line '裡面……有人嗎……' appeared 2 s after the 12.4 s voice ended, and the call finished at 23.06 s. In t_fps4.js after a resume at 6.5 fps: game/real 0.44 vs audio/real 1.00.

**Reviewer's suggested fix:** Separate the stall guard from the per-frame cap. Clamp normal frames to about 0.25 s and treat realDt > 1 s (tab switch, debugger) as a stall clamped to 0.1 s. Alternatively drive playIntercom's segment appends from audio time when audio.ready, e.g. wait until audio.now() >= t0 + cumulative dur, with the game-clock wait as a fallback.

---
## logic#3 [MINOR] Inspect view closes on any left mousedown, including on its own reading panel or scrollbar (drag-look mode)

Files: src/systems/InspectView.js

**Description:** InspectView.init (lines 178-181) closes on every window mousedown with button 0 or 2. The reading panel has pointer-events:auto and an overflow-y scrollbar, and the footer advertises only 'E／右鍵／Esc 關閉'. In drag-look fallback mode the cursor is visible. When the logbook text overflows, which happens at 800x450, grabbing the scrollbar or clicking into the text closes the panel instead of scrolling. The mouse wheel still works.

**Evidence:** /tmp/review-logic/t_scroll.js at 800x450, BLACKOUT, logbook inspect: body scrollHeight 487 > clientHeight 275 (overflow true, dragMode true). Mouse down on the scrollbar at (756,120), drag 60 px, mouse up gives 'inspect open = false scrollTop 0'. At 1280x720 the same text fits (390/390).

**Reviewer's suggested fix:** In the mousedown handler, return early when this.panel.contains(e.target) (and possibly when e.target is in a bs-insp__body scrollbar). Alternatively, close on left click only when the player is pointer-locked, and on right click otherwise. That matches the advertised controls.

---
## spec#8 [POLISH] At short viewports the logbook's key last line is hidden below the fold with no scroll cue

Files: src/systems/InspectView.js

**Description:** The inspect body scrolls with the mouse wheel, but there is no visible cue (only a 6 px scrollbar at 0.2 alpha), and the close hint does not mention scrolling. At a 540 px tall window the line 『忘掉這一切。只要門鎖著，我就安全了。』 is hidden. It fits at 1024×768 and above.

**Evidence:** /tmp/review-spec/s_logbook.js at 960×540: scrollHeight 429 > clientHeight 351, lastVisible=false. At 1280×720, 1366×768 and 1920×1080 it fits. See /tmp/review-spec/item_logbook_inspect.png.

**Reviewer's suggested fix:** When bodyEl.scrollHeight > clientHeight, add a bottom fade and a '滾輪捲動' hint, or reduce line-height and font size with a max-height media query.

---
## logic#5 [POLISH] devicePixelRatio is never re-applied after browser zoom or moving to another monitor

Files: src/main.js, src/gfx/PostFX.js

**Description:** renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)) runs only once at boot (main.js:41). onResize (main.js:103-109) calls only renderer.setSize and postfx.setSize, and postfx.setSize reads renderer.getPixelRatio(). After a browser zoom, or after dragging the window to a HiDPI or LoDPI screen, the drawing buffer keeps the old ratio, so the image is blurry or rendered at an unnecessary resolution.

**Evidence:** /tmp/review-logic/t_dpr.js: CDP Emulation.setDeviceMetricsOverride deviceScaleFactor 1 → 1.5 gives devicePixelRatio 1.5, but BS.renderer.getPixelRatio() is still 1 and the canvas stays 640x360.

**Reviewer's suggested fix:** In onResize, call renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75)) before renderer.setSize/postfx.setSize. Also listen to matchMedia(`(resolution: ${devicePixelRatio}dppx)`) 'change' and re-arm it, because a DPR change without a CSS size change fires no resize event.

---
## comfort#1 [MAJOR] Flashlight switches on in 0.15 s: frame luminance jumps 22x in a single frame (and still 65% of its final level within 0.25 s in reduceFlicker mode)

Files: src/systems/PlayerController.js, src/systems/Flashlight.js, src/states/BlackoutCorridorState.js

**Description:** onFlashlight calls player.setFlashlight(true) with no duration. The default is `duration ?? (this._reduceFlicker ? 0.45 : 0.15)` (PlayerController.js:407), so the 34 cd cookie spot, the bounce light and the haze pass reach full power in 0.15 s. You pick the flashlight up facing the east wall in a nearly black emergency-lit room, so the whole frame goes from near-black to bright almost at once. This breaks golden rule 2 ('任何光源/畫面亮度變化 ≥ 0.4 秒'). The 0.45 s reduce ramp also fails the 30%/0.25 s rule, because smoothstep puts most of the change in the middle of the ramp.

**Evidence:** /tmp/review-comfort/blackout.js seated (data blackout-seated.json), standing at (2.6, 0.75) facing east: t=11.1 Y=0.00143 → 11.2 Y=0.03227 (+2160% in one 0.1 s frame) → 11.3 0.04301. reduceFlicker on (blackout-seated-reduce.json): 0.00131 → 0.00426 → 0.01648 → 0.03214 → 0.04155; the change in 0.25 s is 65% of the final level.

**Reviewer's suggested fix:** Default flashlight ramp of about 0.8 s (1.2 s under reduceFlicker), using a curve that is linear in log-luminance (e.g. level = (exp(k·t)-1)/(exp(k)-1)) instead of smoothstep, so every 0.25 s window stays under +30% of the final level. The warm-filament colour ramp already sells the 'bulb heating up' look, which fits a longer ramp. Use the same curve for setFlashlight(false, 0.6) in RevelationState.

---
## comfort#4 [MINOR] Inspect background dim exceeds the 30%/0.25 s rule (close: +49% in one frame, 2.1x in 0.2 s), contrary to the code comment

Files: src/systems/InspectView.js, src/gfx/PostFX.js

**Description:** DIM_IN 0.9 s / DIM_OUT 0.8 s use easeSine on dim, and PostFX maps dim to brightness as (1-0.9·dim)^1.3. Background brightness goes 1 ↔ 0.21 (about 4.8x), and the middle third of the sine ease produces large per-0.25 s changes. The comment at InspectView.js:27 claims '0.25 秒內整體亮度變化 < 30%'. This happens on every inspect (sticky note, coffee, clock, door, intercom, vent, side door, watch, logbook, coat, glass). It is player-initiated, so this is minor. reduceFlicker does not lengthen it. (The pause backdrop, which reveals rgba(2,2,2,0.8) in 0.45 s with CSS 'ease', has the same profile, but I did not measure it since it is DOM.)

**Evidence:** /tmp/review-comfort/monitor.js (monitor.json), seated, sticky note. Open: frame Y 0.0525→0.0343 in 0.2 s (-35%). Close: 0.0275 (dim .54) → 0.0410 (dim .39) → 0.0573 (dim .24): +49% in one 0.1 s frame, max 52% (hi-relative) within 0.25 s.

**Reviewer's suggested fix:** Ramp brightness, not dim, linearly in log space. For example, compute target mul = exp(lerp(ln 1, ln 0.21, k)) over ≥1.3 s and invert it to dim, or use DIM_IN/OUT ≈ 1.4 s with an ease whose maximum slope keeps |Δmul|/mul < 0.3 per 0.25 s. Lengthen by 1.5x under reduceFlicker. Apply the same idea to the .bs-pause opacity transition (linear, ≥0.6 s).

---
## comfort#5 [MINOR] Shaders compile lazily in the middle of play: 20 programs compile when first stepping into the corridor (multi-second stall in SwiftShader), and +17 during the ending smoke/burn climax

Files: src/world/Corridor.js, src/world/ControlRoom.js, src/main.js

**Description:** Only the CCTV channel scenes are precompiled (CameraFeeds._precompile). Main-scene materials compile on first sight: the corridor/roadway/switch-room groups, their particle and decal materials, and the burnt/decal tiers that become visible during the ending. Program count grows from 64 at the title to 92 after a full loop. Each new program blocks the frame it first appears in. On ANGLE/D3D11 laptops that is typically 30-100 ms per program, so stepping through the side door and the ending's smoke climax will stutter visibly.

**Evidence:** /tmp/review-comfort/hitch.js (640x360, BLACKOUT): first teleport into the corridor at x=12 compiles programs 48→68; frame times 303, 1915, 3224, 429 ms. The second visit: 210-329 ms with 0 new programs. Switch room first visit: +1 program, 412-468 ms frames. Ending (/tmp/review-comfort/perf2.out): programs 62 (door opening) → 70 (+12 s smoke) → 79 (+20 s). Loop test: programs flat at 92 from loop 2 on, which confirms these are first-use compiles.

**Reviewer's suggested fix:** At boot, or during the 1 s black prologue opening, temporarily set swGroup/roadGroup/decal/crack/smoke meshes visible and call renderer.compileAsync(scene, camera) (r170 supports KHR_parallel_shader_compile), then restore visibility. Do the same for ControlRoom burnt/corruption variants before ENDING (for example during the REVELATION intercom). Make sure the light count stays constant so these programs are reused.

---
## comfort#7 [MINOR] 3-5 s synchronous boot with a black, unresponsive page and no loading text (#boot-msg style exists but no element)

Files: src/index.html, src/main.js, src/world/ControlRoom.js, src/world/Corridor.js, src/gfx/TextureFactory.js

**Description:** boot() builds every module synchronously on DOMContentLoaded. ControlRoom builds geometry, textures and PMREM; Corridor builds geometry and textures; CameraFeeds precompiles shaders. Then the first frame compiles the main programs. index.html defines a #boot-msg style but never renders that element, so the user sees a plain black page with no feedback.

**Evidence:** Instrumented copy (/tmp/review-comfort/instr, /tmp/review-comfort/boot.js, 1280x720 headless): boot:start→end 3.13 s (title) / 4.98 s (autostart). Per module: ControlRoom 1.20-1.50 s, Corridor 0.83-0.93 s (its own log: 'built in 930 ms'), CameraFeeds 0.36-0.40 s, Player 0.08-0.10 s, init 0.12 s. Texture generation (BS.textures.stats) 1.25-1.37 s over 41 entries; largest: logbook 119-212 ms, charred 109-117, steelDoor 101-112, corridorWall 81-127. First frame finished 6.6-8.0 s after navigation (SwiftShader inflates GL compile; the CPU canvas work is similar on real machines).

**Reviewer's suggested fix:** Put <div id="boot-msg">載入中…</div> into index.html, which needs no JS, and remove it in TitleState. Better: split boot into steps with await new Promise(requestAnimationFrame) between module constructions so the message actually paints. Defer corridor-only textures (logbook, coatBack, charred) to an idle callback, or generate them during the 1 s black prologue opening.

---
## comfort#8 [POLISH] Full 3D scene + post-processing are rendered behind fully black screens (title, ending choice/credits)

Files: src/main.js, src/gfx/PostFX.js, src/states/TitleState.js, src/states/EndingLoopState.js

**Description:** TitleState and the end-choice tick hold postfx.params.fade = 1, so every pixel is multiplied by 0. The loop still renders the control room (RenderPass with MSAA), the final pass and the output pass each frame. That wastes laptop battery and heat on menus where players may idle.

**Evidence:** /tmp/review-comfort/perf.out 'title (fade=1)': 135 draw calls, 53,050 triangles per frame while the canvas is black.

**Reviewer's suggested fix:** In PostFX.render: if fade ≥ 0.999, setRenderTarget(null), clear to black and return. Optionally also skip feeds.renderFeeds.

---
## comfort#9 [POLISH] Canvas created with antialias:true although all 3D is drawn into an MSAA composer target (wasted multisampled default framebuffer)

Files: src/main.js, src/gfx/PostFX.js

**Description:** The default framebuffer only ever gets the OutputPass full-screen quad, so its MSAA buys nothing. It costs a multisampled backbuffer plus a resolve every frame at up to 1.75 DPR.

**Evidence:** getContextAttributes().antialias === true and composer renderTarget2.samples === 4 (/tmp/review-comfort/texmem.js).

**Reviewer's suggested fix:** new WebGLRenderer({ antialias: false, ... }) and keep MSAA on the composer target, which PostFX already configures. Keep the fallback path in PostFX._failed in mind: it would lose AA, which is acceptable for a fallback.

---
## comfort#3 [MAJOR] Lighting cost: 15 always-visible lights (6 spot, 9 point, 2 shadow-casting, 1 cookie) are evaluated per fragment in every zone, rendered into a 4x MSAA HalfFloat target at up to 1.75 DPR: high risk of <60 fps on laptop iGPUs

**SCOPE NOTE: ONLY the renderer-level mitigations are yours (pixel-ratio cap / adaptive resolution, composer MSAA samples, skipping the haze pass when weak). Do NOT change the number of lights in ControlRoom/Corridor (other fixers own those files; changing light counts mid-game causes shader recompiles).**

Files: src/world/ControlRoom.js, src/world/Corridor.js, src/world/corridor/roadway.js, src/systems/Flashlight.js, src/systems/PlayerController.js, src/main.js, src/gfx/PostFX.js

**Description:** three.js forward shading compiles NUM_SPOT/POINT_LIGHTS from every visible light and loops over all of them for each MeshStandardMaterial fragment, whatever their intensity or distance cut-off. The main scene always has 15 lights: 3 room spots + fill + screen point + unlock point (ControlRoom), 5 corridor points + 2 headlight spots (Corridor, lightRig always visible), and the flashlight spot (castShadow + map cookie) + bounce point (Player). In the control room only 5 are non-zero (measured), so about 2/3 of the per-fragment light loop is wasted, and the corridor is similar (7-12 active). Every fragment also carries 2 PCFSoft spot-shadow lookups and a spot-light map. That combines with RenderPass into a HalfFloat target with 4 MSAA samples (2 at pr ≥1.5), pixelRatio up to 1.75 (≈3360×1890 on a 1080p panel at 175%), the 12-tap soft pass during smoke/inspect, and the flashlight haze, which is another full-screen 8-sample ray-march pass. Draw-call counts are fine. The fragment-lighting load is the main risk on Intel Iris Xe / UHD class GPUs.

**Evidence:** Scene traversal (/tmp/review-comfort/perf.js, perf.out / perf2.out): lights total 15 {SpotLight:6, PointLight:9}, shadow-casting 2 (playerFlashlight 512², headlight 1024²). Active (intensity>0): title 0, seated room 5, blackout room 5, flashlight on 7, corridor 7, switch room powered 12, revelation 10, ending 10-11. Composer renderTarget2.samples = 4 (pr 1), type HalfFloat, canvas context antialias = true (/tmp/review-comfort/texmem.js). main.js: renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75)).

**Reviewer's suggested fix:** Keep the light count constant but small: use a pool of about 3 spot + 3 point lights that each zone repositions and re-parameterises (room uses its 3 tubes + fill; corridor uses the 2-3 fixtures nearest the camera, which the distance cut-offs already imply). Then shader light counts never change and nothing recompiles. Alternatively, toggle the corridor lightRig and the room lights' .visible by zone during black/fade moments, after precompiling both variants. Cap pixelRatio at about 1.25 by default, with an adaptive-resolution step if frame time > 16.7 ms. Use samples 2 instead of 4 for the composer. Skip the haze pass when its strength is low.

---
## spec#3 [MINOR] The 'one extra footstep after stopping' is probabilistic and skipped for short walks

Files: src/audio/AudioEngine.js

**Description:** Requirement 8 says that when the player suddenly stops, the system still plays one extra footstep before silence. _onStopped returns early unless walkedFor > 1.0 s. After the first three stops it plays the extra step only with probability extraStepChance = 0.7. Neither rule is documented as deliberate in DESIGN-NOTES.

**Evidence:** /tmp/review-spec/s_extra.js, with echo enabled, ran 40 stops after a 3 s walk. Per-stop extra-step pattern: 1110111111011011110001111101011011100111 (29/40 = 72%). A stop after a 0.8 s walk gave 0 extra steps. Code: `if (!(Number(walkedFor) > 1.0)) return;` and `if (this._stops > this.tuning.extraStepAlwaysFirst && Math.random() > this.tuning.extraStepChance) return;`. The 0.45 s echo itself is correct: scheduled times are exactly step+0.455 s (/tmp/review-spec/corridor.log STEPS).

**Reviewer's suggested fix:** Set tuning.extraStepChance = 1 and lower the walkedFor threshold to about 0.4 s, or document the randomisation as a deliberate anti-habituation choice in DESIGN-NOTES.

---
## spec#9 [POLISH] 'Ambient sound suddenly disappearing' is implemented as multi-second fades

Files: src/states/MonitoringState.js, src/audio/AudioEngine.js

**Description:** Requirement 1 lists 'ambient sound suddenly disappearing' as a fear source. At 02:12 the vent level goes to 0 over 4 s and setSilence ramps over 6 s, so the vacuum creeps in rather than cuts out. This fits Requirement 7's 'slowly detunes and finally stops', but the sudden-absence effect is lost. The golden rule only requires ramps ≥0.15 s, so a much shorter cut would still comply.

**Evidence:** MonitoringState.ventStop(): `setVent({level:0,...}, 4)` and `setSilence(0.6, 6)`.

**Reviewer's suggested fix:** Keep the 40 s detune, but make the final stop and the vacuum quick, for example setVent level 0 over about 0.4–0.6 s and setSilence over about 0.8 s, so the absence is felt as an abrupt hole.

---
## playqa#9 [POLISH] Small framing and text-layout nits

**SCOPE NOTE: ONLY part (c) the subtitle line-break is yours.**

Files: src/data/layout.js, src/world/feeds/channels.js, src/systems/Subtitles.js

**Description:** (a) In the default seated pose (pitch −0.05) the LED clock is cut in half by the top edge of the screen, so the key '02:00' prop is half out of frame in every seated shot. (b) In HD CAM-03 the firefighter stands in the lower part of the frame and the OSD target label runs across his legs and helmet. (c) The intercom 3 subtitle breaks as '…燒起來' / '了……退後…' because of text-wrap: balance.

**Evidence:** play2/B03_seated.png and pb/C0x_*.png (clock cropped at the top). /tmp/review-playqa/gE2.png (HD CAM-03 crops with the label over the figure). pb/C71_ic3_sub0.png (line break).

**Reviewer's suggested fix:** (a) Use SPAWN.seated pitch ≈ +0.02, or lower clock.y slightly. (b) Aim CAM-03's HD camera a little lower or move HD_SPOT about 0.3 m further from the camera so he sits above the bottom OSD band. (c) Insert a zero-width or space break at the segment boundary, or drop balance wrapping for the intercom lines.

---
## playqa#7 [POLISH] Coffee stage changes are not visible in the inspect preview

Files: src/states/common.js, src/systems/InspectView.js, src/world/ControlRoom.js

**Description:** The stage 1 text ('冷掉…浮著灰燼') and stage 2 text ('乾涸裂開…焦灰') appear in the inspect panel. The 3D preview shows the mug side-on in 'spin' mode, so the cup contents are never visible, and the mug looks like an almost identical clean white cup at every stage (stage 2 has only a faint dark crack line).

**Evidence:** pb/E09_coffee1.png (stage 1) and pb/F01_coffee2.png (stage 2), against play2/B05_seated_right_coffee.png (stage 0, steam). Grid: /tmp/review-playqa/gE3.png.

**Reviewer's suggested fix:** For id 'coffee', open the inspect with a tilted view (e.g. tiltGroup rotation.x ≈ 0.6) so the liquid surface or dry crust is visible. Apply the room's dirt/burn uniforms, or a stage-specific stain decal, to the preview mug.
