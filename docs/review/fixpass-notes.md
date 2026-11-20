# Review fix pass — what changed (source for docs updates)

## Fix pass — worktree-wf_9ca3cbda-0e3-1

### Summary
I finished all six priorities, each checked with screenshots and luminance measurements and committed on its own (5 fix commits on top of the WIP commit). After the final build, smoke-test passes for all 6 states and none of the runs logged console errors.

P1, fire-door phantom: I first verified the previous fixer's restaging, then made one change. The invisible car now reverses slowly from the west at 2–3.4 m/s. Its headlight uses a cookie-textured, soft-edged spotlight that casts a window-shaped patch on the south wall ahead and to the right of a player walking east. A head-and-shoulders silhouette proxy is drawn only into this light's shadow pass, so the player's stretched shadow sits inside the patch. The event lasts 4.1–4.7 s (rise 1.7 s, fall 2.0 s). The light cutoff, shadow filtering and roadway end caps no longer block the beam. In a natural walk with KeyW held, the patch and shadow are clearly visible in 6 consecutive frames. Max frame luminance change is 22.2% per 0.25 s. Edge cases: standing facing east 11.2%, facing the glass 9.1%, running 10.8%, walking backwards 4.5%, reduceFlicker 7.3%. My change: the flashlight dim (setFlashlightDim) now depends on facing, 0.3 facing east up to 0.85 facing west, ramped over 1.7 s. Before it, the walking-backwards case was 35%.

P2, glass and roadway: the glass base is now a dark, alpha-mapped MeshLambertMaterial with no specular. A separate faint, low-roughness additive layer gives only one or two sharp highlight dots. Roadway changes:
- The one lit sodium lamp moved to fireDoor.x + 3.5.
- The hl[1] SpotLight is now a permanent sodium fill at 950 cd. The scene's light count is unchanged.
- Road materials no longer use the corridor fog.
- I added a faint amber haze sprite behind the glass.
- There are now 800 ash flakes, concentrated in what the window can see.

The empty orange-lit road, lane line, lamp and ash read clearly with the flashlight on or off.

P3, CRT channel switch:
- The AGC factor no longer multiplies the room's screen light. Its largest per-frame step is now 5%; it was 40–66%.
- The per-channel brightness table is now measured (linear) instead of hand-typed. AGC is clamped to [0.35, 2.8] and recovers over 2.0 s.
- A new uPrevAGC uniform keeps the outgoing image at the brightness it was shown at.
- A new switch only starts after the previous 0.25 s transition ends.

On the CRT region, single switches now peak at 17.2% per 0.25 s (4→3); the frame peaks at 2.7%. Button-mashing 1,2,4,1,3 every 0.15 s gives 8.3% on the CRT and 0 reversals; it was 37.7% with 6 reversals.

P4, HD CAM-03: in HD only, the camera aims about 9° lower. For the first 7 swing cycles the firefighter looks up every other cycle, then every third as before. Across 120 samples, his head is at NDC −0.04 to −0.33 and his chest at −0.25 to −0.37, both above the OSD label band. The axe is at least partly above the band in 119 of 120 samples.

P5, side screens: both side monitors cross-fade (about 1.6 s) to low-contrast snow, brightness-matched to the text, when the main CRT shows STATIC. They come back during the HD boot. Over the blackout window the left screen region changes at most 8.3% per 0.25 s and the right 19.6%.

P6:
- The roadway is not drawn while the camera is in the control room; verified roadGroup.visible = false in MONITORING.
- The heartbeat reset after the headlights now uses the player's current zone. Back in the room it stays at 70/0.55 nine seconds later.

### Integration notes (for docs)
Cross-fixer API and files outside my area:

1. I depend on PlayerController.setFlashlightDim from the systems fixer, always via optional chaining. At event start I call ctx.player.setFlashlightDim?.(dimTo, rise=1.7). dimTo is 0.3 when the camera faces east, rising smoothly to 0.85 when it faces west. 0.3 s before the fade I call setFlashlightDim?.(1, fall+0.3). If the event ends while still dimmed, _hlEnd calls setFlashlightDim?.(1, 1.5). My tests emulated it with a smoothstep ramp of flashlightRig.maxIntensity.
2. Flashlight.js (not mine) places its bounce PointLight about 0.2–0.3 m in front of whatever the beam hits, including the fire-door glass. The Lambert glass makes this harmless now. If anyone gives the glass specular back, the big white glow returns.
3. At the 02:14 blackout the whole frame still drops 32% per 0.25 s (relative, floor 0.004; 18.7% against the local reference) around t+0.4–0.6 s. This comes from ControlRoom.setLighting('emergency') and the room lights, not my files. The side screens alone are now within 8–20%.

Layout and corridor (docs should mention these):

4. layout.js: CORRIDOR.headlightTriggerX changed from 16.5 to 18.4. The ROADWAY dims are unchanged.
5. CORRIDOR_TUNING: headlightDuration is removed (the length is now computed, 4.1–4.7 s, about 5.5 s under reduceFlicker). New knobs: headlightRise, headlightHold, headlightFall, headlightSpeed, headlightRiseTime, headlightSoftMin, headlightSoftV, headlightLaneZ, headlightAlignX, flashlightDim. headlightPeak is now 760, normalised to a 12 m car-to-wall distance.
6. Headlight light road.hl[0] carries a permanent 64² DataTexture cookie (SpotLight.map, set at build so no recompile) that is redrawn each frame during the event.
   - Its shadow map draws only pipe:* meshes and the new corridor/silhouette.js proxy. This uses onBeforeShadow/onAfterShadow drawRange filtering, set in Corridor.init().
   - ctx.player.shadowProxy is skipped for this one light only.
7. road.hl[1] is no longer a headlight. It is now a permanent sodium-coloured SpotLight (road.sodiumLight, 950 cd, distance cutoff 12.2 so it cannot reach the corridor's south wall). The total light count is unchanged.
   - The still-lit sodium lamp moved to x = fireDoor.x + 3.5 = 23.5 (roadwayDims().sodium).
8. Roadway geometry:
   - The end caps no longer cast shadows.
   - The asphalt, roadLines, walk and curbPaint materials have fog:false.
   - The ash shader has a new uFogMax uniform (0.55).
   - There are 800 ash particles.
   - A haze sprite was added.
9. Fire-door glass: objects.fireDoorGlass is now MeshLambertMaterial with color 0x5a625e. A new additive mesh struct.glassSheen (name fireDoorGlassSheen, raycast disabled) draws the highlight.
10. roadGroup is visible only when the camera is inside the corridor's x range. This was the previous fixer's change; I verified it.

Feeds:

11. CameraFeeds AGC:
   - New measured linear table FEED_LUM; the old FEED_MEAN is now used only for mode cross-fade lengths.
   - AGC is clamped to [0.35, 2.8] and recovers over AGC_DUR = 2.0 s.
   - New CRT uniform uPrevAGC.
   - AGC no longer touches controlRoom screenLight.
   - setChannel still updates the logical this.channel and emits at once. The displayed switch waits until the previous 0.25 s transition has finished.
12. SideScreen.update(dt, t, { …, snow }) is additive; snow is 0..1. The terminal material has a new uniform uSnow. CameraFeeds sets side snow to 1 while the main CRT shows STATIC and fades it out over the BOOT progress from 0.35 to 0.8; feeds.reset() clears it. Docs §8 should say the side monitors go to snow at 02:14 and come back with the HD boot in REVELATION.
13. CAM-03: in HD only, the camera aims about 9° lower (_aimHD; LD aim unchanged, applied in onVariant). Figure looks up every other cycle for its first 7 swing cycles, then every third as before.

State:

14. BlackoutCorridorState: the heartbeat reset 7 s after the headlights now uses the player's current zone.

## Fix pass — fix-systems

### Summary
All 18 findings assigned to the systems fixer are fixed in worktree branch fix-systems (commits a6f05f8, 624c00e, d9fdb0c). Each fix was checked in headless screenshots and/or measured with the reviewers' harnesses, adapted to my build. The one partial result is the verification run: the stock scripts/smoke-test.mjs stops with a Playwright 30 s screenshot timeout at MONITORING. That is machine load (load average 10-12 on 4 CPUs, from the other fixers' browsers): the old main-branch build also needed 35 s for the same 1280x720 screenshot. The same script with only the screenshot timeout raised passes all 6 states with zero console errors.

Main changes:
- **Main loop:** every update and render step has its own try/catch. Each failing step is logged once, the next frame is scheduled first, and ui.showError appears only after 240 consecutive failures of one step.
- **Boot:** runs in steps with a frame yield between them, so the '載入中…' message from index.html paints (first contentful paint at 124 ms). The title appears once boot finishes. ?autostart=1 boots synchronously so test timing is unchanged.
- **Precompile at boot:** compiles all shaders against the composer's HalfFloat target, pre-uploads every texture, and renders the whole scene once (hidden objects included) into a 64x64 target. The light set is unchanged. Shader program count now stays at 82 from boot through the corridor, the switch room and the ending smoke (reviewer measured 48→68 and 62→79). The worst first-corridor frame in SwiftShader dropped from about 5.5 s to 1.9 s.
- **Rendering cost:** canvas antialias is off; the composer uses 2x MSAA; pixel ratio is capped at 1.5. A new ResolutionGovernor steps resolution down after 3 s of slow frames (>21.5 ms) and back up after 10 s of fast ones, at least 4-6 s between changes, with growing back-off if a step-up fails. When the screen is fully black (fade ≥ 0.999) the 3D scene and feeds are not rendered: 0 render calls on the title.
- **DPR:** re-applied on resize, on matchMedia resolution change, and by a once-per-second check.
- **Esc:** pauses in drag-look mode. The inspect view still takes Esc first; Esc is ignored on the title or when already paused.
- **Flashlight:** new ramp curve whose maximum slope is 1.14x the average, so no 0.25 s window changes much more than 0.25/duration of the total. On/off now takes 1.1 s (1.6 s with reduceFlicker). The light's colour change no longer changes its brightness. Shorter positive durations are raised to that minimum; 0 still means instant.
- **setFlashlightDim(mult, durationSec):** implemented exactly as requested. It ramps in log space, takes 1.5x longer under reduceFlicker, and resets to 1 once the light is off.
- **Inspect view:**
  - Background dim now ramps brightness log-linearly: 1.6 s to dim, 2.2 s to recover, 1.5x with reduceFlicker. Object fade is 0.8 s in and 1.2 s out.
  - Left-clicks on the reading panel no longer close it; right-click, E and Esc still do. A fading panel no longer catches clicks.
  - Overflowing text gets a bottom fade and a '滾輪捲動 ▾' hint. Arrow keys and PageUp/PageDown scroll it. Windows 620 px tall or less use tighter typography.
  - The coffee is shown from above, at a steeper angle for stage 2.
- **Pause backdrop:** 1.4 s fade using exact log-brightness linear() curves (2.1 s with reduceFlicker).
- **Intercom subtitles:** each segment appears at whichever comes first, game time or audio time, measured from the voice start. AudioEngine.playIntercom now also returns startAt.
- **Subtitle line breaks:** each intercom segment is one unbreakable unit, so lines only break between segments.
- **Footsteps:** the extra step is now always played (chance 1) after a walk of at least 0.4 s.
- **Ventilation:** final stop is a 0.6 s vent ramp plus a 0.7 s spin-down sound, and the silence vacuum takes 0.8 s. The 40 s detune is unchanged.

### Integration notes (for docs)
**Edits outside my files (small, additive, worth checking at merge):**
- src/data/script.js: 2 lines added under hints: scrollInspect '滾輪捲動' and frameError (screen copy, kept in SCRIPT).
- src/audio/sfx.js: fanSpinDown minimum duration 1 → 0.6 s.
- src/states/common.js: only playIntercom changed (the segment loop and the done/hold waits).

**PostFX.js:**
- My changes: new exports dimToBrightness/brightnessToDim at the top (InspectView imports them; keep them if PostFX is rewritten), new isBlack(), an early return at the top of render(), composer samples 2, and the uDimMul line now calls dimToBrightness.
- The smoke code is untouched.

**API for the corridor fixer:**
- ctx.player.setFlashlightDim(mult = 1, durationSec = 0.8) exists exactly as specified. It ramps in log space on the comfort curve and takes 1.5x longer under reduceFlicker.
- setFlashlight(on, d): any positive d is raised to 1.1 s (1.6 s with reduceFlicker); d = 0 is still instant (common.js world reset).

**New ctx fields and URL params:**
- ctx.precompile({sync, warm}) → Promise<{before, after, ms}>. Call it during a black or fade moment only if someone adds meshes or materials after boot; currently the program count stays flat through the ending.
- ctx.resolution (ResolutionGovernor). New URL params: ?pr=N fixes the pixel ratio; ?adaptive=0 turns adaptive resolution off. Adaptive is also off under navigator.webdriver, so test screenshots keep a fixed resolution.
- AudioEngine.playIntercom now also returns startAt.
- Settings added to AudioEngine.tuning: extraStepChance 1 and the new extraStepMinWalk 0.4.

**Boot and test timing:**
- The real (non-autostart) boot is async and window.BS appears after precompile. In SwiftShader under load the title takes about 20 s. The stock smoke test's TITLE shot still showed the title, but a short --wait may capture the loading screen.
- ?autostart=1 boots synchronously, so shot.mjs and smoke timing are unchanged except about 6-9 s more boot inside goto in SwiftShader.

**For docs (I did not edit them):**
- ARCHITECTURE §4 ctx should list resolution and precompile.
- §8/§9 should mention: Esc pauses in drag mode; the main loop is exception-isolated; boot shows '載入中…' and precompiles.
- InspectView: a left click on the panel does not close it; dim takes 1.6 s in and 2.2 s out; there is a scroll cue.
- Flashlight ramp is 1.1/1.6 s (deliberately over the ~0.8 s brief, because the ≤30%/0.25 s rule cannot be met below about 0.85 s).
- Inspect and pause fades follow the rule using a log-brightness curve.
- The extra footstep is now deterministic (resolves DESIGN-NOTES gap spec#3).
- The vent stop is a quick spin-down and vacuum.
- GameClock's 0.1 s dt cap is unchanged; intercom subtitles use the audio clock instead.

**Not done / residual:**
- Inspect-scene shader variants (inspected materials under the inspect view's own lights) still compile on the first open of each item, hidden by the 0.8 s fade.
- Corridor-only textures are not deferred (Corridor.js is outside my scope).
- Not my scope, but flagged: the BLACKOUT_CORRIDOR direct-entry fade-in measured 53.7% per 0.25 s relative to the final level (blackout-seated.out 'fade-in FRAME').

## Fix pass — worktree-wf_9ca3cbda-0e3-2

### Summary
I took over from the interrupted WIP commit (c853b84). It built cleanly, so I checked every priority on fresh screenshots and measurements, reworked the ending until it held up, and committed three checkpoints (6c56d2c, 9a5de6a, 49c67e2).

**Priority 1 (the ending).** The smoke is now a single draw call: lit, billowing clouds that roll along the ceiling first and then bank down. The haze overlay tops out at 0.6 and drifts with the view instead of sticking to the screen. Fog stays at about 0.15 for most of the sequence and only gets thick in the last stretch before the fade.

What I added in this session:
- **Fire glow at the door.** The existing fill light slides to just inside the blast door and turns orange-red during the ending. It slowly varies by at most 9% with a period of 1.9 s or more, and is steady under reduceFlicker. The light count does not change. The short corridor behind the door glows, and smoke there is lit by it.
- **New char look.** Burnt surfaces crack into a network of blistered blocks, and only a few hot patches glow through the cracks. The spreading edge of the burn is now a soft, broken, dim red band. The old version looked like lightning bolts.
- **Earlier smoke.** It starts pouring in about 1.35 s after the door begins to move.
- **Return beat.** It starts from near-black (fade 0.95, no hard cut) on a shot of the desk and steaming mug. The char recedes to a fixed schedule: the ceiling clears fast and the desk slowly. The lighting goes back to normal after the fade-in instead of during it.
- **Fewer draw calls.** The corridor's light-free subtrees are hidden while the ending runs; this was about 80 calls of corridor geometry behind the walls. Each binder now takes 2 calls instead of 6.

Measured results:
- Peak draw calls during the smoke went from 430 to 246 (137 main + 109 CCTV feed).
- The worst brightness change in any 0.25 s window is 21.6% of the local peak (the camera turning toward the dark door). The stricter floored-relative measure, which the original build failed at 71.8%, still peaks at 41.6%, but only in near-black frames of the fade-out.

**Priority 2.** Before the press, the only enabled interactable is `unlock`; logged on every run.

**Priority 3.** The intercom and vent panel 3D parts now follow the textures' layouts: one grille, one call button, one LED (dark when idle), one gauge, three status LEDs, and the vent lever stays inside its slot when pulled. Close-ups confirm it.

**Priority 4.** The side door uses its own door texture with no blast-door stencil, and its UVs match the 1.0×2.1 m door. Confirmed in a close-up.

**Priority 5.** The default seated pitch is now 0.03, so the 02:00 clock is fully in frame at 960x540 and 1280x720. The slumped wake-up shot still shows the clock.

A few gaps:
- The return-beat screenshots (s2_35, s3_36) were taken just before the last change to the char-recede schedule; the luminance measurements do cover the final build.
- No ending run with reduceFlicker turned on.
- Several runs crashed partway because the machine was shared, so the contact sheet is stitched together from shorter runs.

### Integration notes (for docs)
1. **Changes in files other fixers edit.**
   - PostFX.js: everything is in the smoke code (uSmokeView/uSmokeMax uniforms, the smoke shader block, the `_smokeView()` method). One line is inside `render()`, right after `u.uSmokeColor.value.copy(this.smokeColor);`: `if (smoke > 0.001) this._smokeView(u);`. Keep it if the dim/fade/render edits from the other fixer touch that area.
   - common.js: only FOG presets, `updateAtmosphere`, `registerCommonInteractables`, `WRITE_CAM` and the new `MUG_CAM` / `mugPose()`. `playIntercom` is untouched.
   - layout.js: only `CONTROL_ROOM.coffee`, `CONTROL_ROOM.endingNote` and `SPAWN.writing` / `SPAWN.seated`.

2. **Things the docs should record (I did not edit docs/).**
   - **Coffee mug moved** to x=-0.8, between the left keyboard and the pen cup, so the mug and the ending note fit in one shot.
   - **SPAWN.seated pitch** is now 0.03 (was -0.05).
   - **Unlock-only interaction:** while `flags.unlockArmed`, `registerCommonInteractables` disables everything except 'unlock'. The architecture doc's '唯一關鍵互動' can now read '唯一互動'.
   - **Ending fire light:** the 'ending' lighting mode has `fire: 1`. The control room's fill PointLight slides to just inside the blast door and turns orange-red as the room burns. The scene's light count does not change.
   - **New ControlRoom fields:** `smokeLook` (tuning knobs: albedo, desat, top, low, warm, layerCol, layerK, haze, ember, front, fire), plus read-only `smokeColor`, `hazeColor`, `fireLevel`, `smokeLayerY`.
   - **Vent panel parts:** `parts.vent.leds` = {run, fault, stop}. `parts.vent.led` still exists and points at the fault LED.
   - **New texture** 'steelDoorSide' (SIDE_DOOR_LAYOUT in textures/materials.js). The intercom panel texture is now 384x544 and its layout gains `speaker.rim` and `button.well`.
   - **EndingLoopState timeline:**
     - It runs on keyframe tables driven by game time: SMOKE_KEYS, BURN_KEYS, POST_SMOKE_KEYS, FEED_KEYS, RECEDE_KEYS.
     - Smoke starts about 1.35 s after the door moves and stays moderate (fog ≈0.15, haze ≤0.6), going thick only at the end. This is a deliberate change from 'instantly floods', in line with DESIGN-NOTES A1.
     - The fade-out stops at 0.95 (near-black), and the world resets there.
     - The return holds on the mug for about 5 s while the char recedes, then the stage direction shows and clears before the pen starts.
     - The ending is about 2 s longer than before (end choice at roughly unlock + 62 s).
   - **Corridor hidden during the ending:** `EndingLoopState.hideCorridor()` hides the corridor group's light-free children from the door opening until `exit()`.

3. **Suggestion for the feeds fixer.** CameraFeeds could skip `renderFeeds` while `_bright < 0.15` and a frame already exists. That would remove the ~108 feed calls on alternate frames during the ending smoke. Peak is already 246, under the ~250 target, so this is optional.
