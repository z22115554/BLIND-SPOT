# Review findings assigned to the 'corridor' fixer

Each finding below was verified by an independent reviewer (their evidence paths under /tmp/review-*/ still exist — scripts, logs and screenshots you may Read or reuse; their scripts point at /tmp/review-*/game.html, so copy & adapt them to your own build path).

---
## spec#1 [MAJOR] Fire-door phantom: the headlight patch and the player's stretched shadow cannot be seen at the shipped intensity

Files: src/world/Corridor.js, src/world/corridor/roadway.js, src/systems/Flashlight.js

**Description:** Requirement 8 asks that, as the player passes the fire door, glaring headlights flash past and stretch the player's shadow onto the wall. In the build only the glass itself glows. Through the window, the near SpotLight (peak ≈2.5–2.9k cd, about 20 m to the wall, distance cutoff 27, decay 2) lights the south wall at about 2% of display range, so neither the patch nor the shadow shows up. With the flashlight on, which is always the case in the corridor because there is no toggle key, only the flashlight hotspot is visible. The geometry is also unfavourable. xAlign is clamped to fd.x+16 and the lane is 5 m from the glass, so the beam runs only about 20° off the corridor axis. The shadow therefore lands 1.5–2.5 m west of (behind) a player walking east, toward the switch room.

**Evidence:** /tmp/review-spec/s_hl6.js froze the clock at plan alignment (hl0 at x 34.39, intensity 2918 cd, player at 16.6, 2.4, flashlight off). The patch should land at world (15.16, 1.69, 2.79), screen px (396, 210). The 100×100 region there has mean 4.8/255 at the real intensity (/tmp/review-spec/hl6_normal.png). At 25× intensity it reads 31.7, and with shadowProxy.castShadow=false it reads 52.0 (hl6_x25*.png, /tmp/review-spec/hl6_sheet.png). So the shadow is rendered but invisible at the shipped intensity. /tmp/review-spec/hl3_off_1.3.png (peak, facing the south wall, flashlight off) is entirely black. /tmp/review-spec/hl3_on_1.3.png shows only the flashlight. /tmp/review-spec/hl4_sheet.png: walking east at peak, only the glass glows.

**Reviewer's suggested fix:** Raise CORRIDOR_TUNING.headlightPeak by roughly 10–25×, or raise the SpotLight distance cutoff and widen its angle. Move the phantom car's lane closer to the glass, or reduce the xAlign clamp, so the beam crosses the corridor more steeply and the shadow lands on the south wall beside or just ahead of the player. Briefly dim the flashlight (or its contribution on that wall) during the 2.9 s event. Add a screenshot assertion that the patch luminance exceeds a threshold.

---
## playqa#0 [MAJOR] Headlight phantom: the player's stretched shadow is effectively never seen, and the effect goes dark at its own peak

Files: src/world/Corridor.js, src/world/corridor/roadway.js, src/states/BlackoutCorridorState.js, src/systems/PlayerController.js

**Description:** I confirmed the states agent's report and found the cause. The SpotLight, shadow map, glass (castShadow:false) and shadowProxy all work: with the flashlight off and the sweep frozen at t=1.0 s, a window-shaped patch with the capsule shadow cut into it renders on the south wall (hl2/f4_t1.0_noflash.png). Four geometry problems stop a player from ever seeing it. (1) Corridor.triggerHeadlights picks xAlign so the beam passes through the player at tAlign=1.45 s. A ray from a car at x≈30–36 enters the window travelling mostly toward −X, so the patch and shadow land 1.5–3 m behind the player (south-west), while a player walking east to the trigger is looking east. (2) At that grazing angle (~17° to the wall), the capsule's shadow on the south wall is about 0.44 + 0.44·(xAlign−20)/5 ≈ 1.4–2 m wide in x. The lit footprint is only the 0.62 m window projection. At peak brightness the shadow therefore covers the whole patch, and there is no lit area around it for a silhouette to read against. (3) If the player has stopped (isMoving false), xAlign = 20+(20−px)·5/(pz−1.2) is clamped to fd.x+16 = 36, which is exactly ROADWAY.maxX. The roadway end cap there is built with cast:true. From tAlign on the car is behind that cap, so the corridor goes black at the peak. When walking, the car crosses x=36 at t≈2.0 s with env≈0.84, so the light cuts off abruptly instead of fading over 1.3 s. (4) The flashlight is far brighter than the patch and washes it out (hl2/f1_sw_flash.png). What a walking player actually sees is a bright hard-edged rectangle opposite the door early in the sweep (hl2/walk_00.png), then nothing. No shadow appears in any natural-walk frame (walk_01–03, pb/D30_hl_a.png, pb/D31_hl_b.png).

**Evidence:** Measured plans: walking xAlign=29.93 (player x 16.8) and 30.87 (player x 17.2); stationary xAlign=36 (clamped). Frozen at tAlign with flashlight off, looking south-west at the predicted patch: almost entirely black, only a sliver near the pipes (hl2/f2_sw_noflash.png). The stationary-player freeze at tAlign is fully black (hl/grid1.png, bottom-right). Light log while walking: x=32.7 env 0.98 I=2299, then x=40.4 env 0.33 behind the cap. f5_noshadowcast.png (castShadow=false) shows the light does reach the south wall, so blocking and alignment are the problem, not the light itself. Screenshots are under /tmp/review-playqa/hl and /tmp/review-playqa/hl2.

**Reviewer's suggested fix:** Re-stage the event so the shadow lands in front of the player and inside a much larger lit area. Option A: move headlightTriggerX past the door (≈21–22). Bring the car from the WEST so at peak the beam crosses the player from behind-left and the shadow falls ahead and to the right on the south wall. Pick xc so incidence is closer to perpendicular, which keeps the shadow narrower than the patch. Option B (robust): keep the real light for the sweep, and add a projected decal or second, unshadowed wide 'scatter' light on the south wall, then cut a stretched silhouette into it (e.g. a projected texture following the player). Either way: clamp xAlign to ≤ ROADWAY.maxX−1 (or mark the end caps cast:false / move them past the sweep). During the event, briefly dim the flashlight (≈×0.35) or narrow it so the patch can read.

---
## comfort#0 [MAJOR] Headlight phantom produces a ~0.3 s flash on the near corridor wall (2.7x frame luminance up and back down), even though the light envelope ramps slowly

Files: src/world/Corridor.js, src/world/corridor/roadway.js, src/states/BlackoutCorridorState.js

**Description:** The intensity envelope in _hlFrame ramps over 1.3 s up and 1.3 s down, which is fine. But the car moves at plan.v = 11 m/s. The beam goes through a 0.62 m window, so the lit patch it casts sweeps across the near south wall (and the floor) in about 0.2-0.3 s. In the natural view when the event fires (walking east at x≈16.7), that wall covers about a quarter of the frame, so the frame brightens sharply and goes dark again almost at once. This breaks golden rule 2 (any change ≥0.4 s; ≤30% within 0.25 s) and DESIGN-NOTES A1's promise of a rise ≥0.6 s and a fall ≥1 s. reduceFlicker has no effect: triggerHeadlights/_hlFrame never read it.

**Evidence:** Per-frame mean linear luminance, measured in game time with an in-page canvas probe (/tmp/review-comfort/corridor.js, data in corridor-east.json and corridor-glass.json). Facing east: t=12.7 Y=0.0203 → 12.8 0.0224 → 12.9 0.0333 → 13.0 0.0542 → 13.1 0.0419 → 13.2 0.0222. So +167% then -59% inside 0.4 s while env was only 0.44→0.87. Max change in 0.25 s = 59% (limit 30%). Facing the fire-door glass: 0.0175→0.0328→0.0187 (+87% / -43%). Frames I looked at: /tmp/review-comfort/hl-east-12.80.png, hl-east-13.00.png (right wall flooded by the window-shaped patch) and hl-east-13.30.png (back to dark); also hl-glass-12.60.png.

**Reviewer's suggested fix:** Make the brightness at any one surface point ramp ≥0.4 s, not just the envelope. Options: (1) slow the car to about 3-4 m/s and lengthen headlightDuration to keep the 'sweep' feel; (2) widen and soften the window patch (larger SpotLight penumbra on hl[0], or a soft gradient mask on windowFx) so a wall point takes ≥0.5 s to go from 10% to 90%; (3) clamp I0 by how fast the patch moves across the view. Under reduceFlicker, drop the moving patch and keep only a slow, faint shadow. Re-run /tmp/review-comfort/corridor.js east|glass and confirm max Δ/0.25 s < 30%.

---
## spec#6 [MINOR] The empty roadway and falling ash are not visible through the fire-door glass in normal play

Files: src/world/corridor/structure.js, src/systems/Flashlight.js, src/world/corridor/roadway.js

**Description:** Requirement 8 says that when the player approaches the glass, the roadway is empty, with only falling ash. The glass uses an opaque wired-glass texture (opacity 1, colour 0xc8e6d2, roughness 0.06). Under the flashlight, which is always on in the corridor, it reads as a solid mint-green grid with a specular hotspot, and nothing behind it can be made out. Only the inspect-panel text conveys the empty roadway.

**Evidence:** /tmp/review-spec/glass_sheet.png (5 s after the headlights): with the flashlight on at 0.35 m and 1.1 m from the door the glass looks like an opaque grid with a few white specks. With the flashlight off (via debug) the view is mostly black with a small orange glimpse. Also /tmp/review-spec/glass_view.png.

**Reviewer's suggested fix:** Make the glass transmissive (opacity about 0.35–0.5, wire grid via alphaMap) and lower the flashlight's specular response on it. Make the sodium-lit asphalt and the ash particles near the glass bright enough to read through it, for example with a dim roadway fill light that turns on after the headlight event.

---
## playqa#5 [MINOR] Fire-door glass: the roadway and falling ash promised by the inspect text cannot be seen through the glass

Files: src/world/corridor/structure.js, src/world/corridor/tex.js, src/world/corridor/roadway.js, src/states/common.js

**Description:** The 'fireDoorGlass' inspect text says you look through the glass at an empty roadway with ash falling like snow. In practice the pane (MeshStandardMaterial, light-green colour 0xc8e6d2, map alpha ≈0.22, structure.js:345-349) catches the flashlight and renders as a flat, bright green tile. With the flashlight off it is pitch black. Nothing outside reads: the corridor FogExp2 (0.12) also applies to the roadway 5–15 m away, and the ash only lights up during the headlight sweep.

**Evidence:** /tmp/review-playqa/fin/glass_flash_on.png and glass_flash_on_angle.png (opaque green pane with hotspot), fin/glass_flash_off.png (black), pb/D40_firedoor.png (natural run after the sweep). Grid: /tmp/review-playqa/gGlass.png.

**Reviewer's suggested fix:** Make the glass mostly specular: dark low-albedo colour (≈0x1a2620), lower opacity, envMap/specular highlight only. Alternatively use an unlit additive smudge layer so the flashlight doesn't turn it into a lit tile. Make the roadway readable: fog:false (or a lower per-material fog factor) on the ash Points and the sodium pool, a faint permanent fill on the ash near the glass, and a slightly brighter sodium pool in the window's line of sight.

---
## playqa#8 [POLISH] The whole roadway set is rendered every frame while the player is in the control room

Files: src/world/Corridor.js

**Description:** Corridor.js:386 sets roadGroup.visible = (camPos.x > 5.5 && camPos.x < 34.5) || camPos.z < CORRIDOR.main.minZ. The control room spans z −3.5…3.5, so the second clause is true there and the roadway (tiles, arch, fans, sodium halo and 500 ash points) is drawn behind the walls for the whole of acts 1 and 3.

**Evidence:** Seated console view in MONITORING: 192 draw calls, 59,118 triangles, 500 points per frame. With roadGroup forced hidden: 183 calls, 56,226 triangles, 0 points. With the whole corridor group hidden: 173 calls, 49,628 triangles (/tmp/review-playqa/perf2.js). Overall per-frame cost looks healthy: 55–262 calls, ≤87k triangles, 64–76 programs (perf.js).

**Reviewer's suggested fix:** Limit the z clause to the corridor's x range, e.g. (camPos.x > 5.5 && camPos.x < 34.5) || (camPos.z < minZ && camPos.x > 4.2). Alternatively hide the whole corridor group while zone === 'controlRoom' and the side door is closed.

---
## logic#4 [POLISH] Heartbeat reset 7 s after the headlight event ignores the player's current zone

Files: src/states/BlackoutCorridorState.js

**Description:** tick() (lines 164-167) schedules this.wait(7).then(() => setHeartbeat(f.powerRestored ? 56 : 62, … 0.38, 6)). If the player walks back into the control room within those 7 s, onZone('controlRoom') correctly sets the room heartbeat (70 bpm / 0.55). The delayed callback then overwrites it with the corridor values while the player stands in the room.

**Evidence:** /tmp/review-logic/t_corridor.js: teleport to x=17 (headlights), then back to the room. 1 s later heartbeat is {target 0.55, bpm 70}, zone controlRoom. 9 s later it is {target 0.38, bpm 62}, still zone controlRoom.

**Reviewer's suggested fix:** In the callback choose the value from this._zone: if (CORRIDOR_ZONES.includes(this._zone)) corridor values; else room values (70/0.55 before power, 56/0.22 after). Or re-run the onZone(to) heartbeat branch for the current zone.

---
## comfort#2 [MAJOR] CRT channel switch: the room's screen light steps 40-66% in one frame, and the AGC table over-corrects (up to 2.3x), so the CRT brightens ~73% within 0.2 s; button-mashing makes repeated flicker

Files: src/world/CameraFeeds.js, src/world/feeds/channels.js, src/gfx/shaders/CRTShader.js

**Description:** _beginSwitch sets this._agc = _agcFrom at once (anywhere from 0.33 to 3). The screen PointLight is then set to `L.intensity * SCALE * gain * bright * Math.sqrt(this._agc)`. L.intensity is smoothed, but the sqrt(agc) factor is applied after the smoothing, so the light that illuminates the desk and walls steps instantly. On top of that, FEED_MEAN (LD {1:51,2:31,3:25,4:40}) does not match the measured feed brightness, so the AGC that should hide the switch actually causes a brightness spike or dip. This breaks the CameraFeeds contract ('整體亮度不可突變') and golden rule 2 for light sources. Pressing the buttons rapidly turns this into repeated flicker on the CRT, which is where the player is looking.

**Evidence:** Instrumented BS.controlRoom.objects.screenLight.intensity (/tmp/review-comfort/agc.js): 3→1: 1.10→0.66 (-40% in one frame); 1→2: 1.21→1.97 (+63%); 2→4: -21%; 4→3: 1.10→1.83 (+66%), each followed by a ~1 s recovery. Frame and CRT-region luminance (/tmp/review-comfort/monitor.js, monitor.json; CRT = 13.5% of the seated frame): 1→2 frame Y 0.0913→0.1087 (+19%) in one frame; CRT 0.0334→0.0577 (+73%) within 0.2 s, then decays to 0.026. Rapid switching 1,2,4,1,3 every 0.15 s: CRT 42.5%/0.25 s with 4 opposing swings >10% within 1 s; frame 22% with 3 swings. Measured steady CRT means (linear) cam1 0.0336, cam2 0.0261, cam3 0.0168, cam4 0.0348. For 1→2 the needed gain is 1.29 but the applied AGC is 2.99 (2.3x too much); for 3→1 0.50 is needed but 0.33 is applied.

**Reviewer's suggested fix:** (1) Move sqrt(agc) into _lightTarget.intensity before the exp smoothing, or leave the AGC out of the room light entirely, so the screen light never steps. (2) Recalibrate FEED_MEAN from real data. Best is to measure each channel's mean in _precompile (render each channel/variant once, then readRenderTargetPixels on a small mip or a 16×12 downsample) instead of a hand-typed table. Also clamp the AGC to about [0.6, 1.6]. (3) Optionally debounce channel presses (ignore presses while _switch > 0) so mashing can't stack transitions.

---
## spec#5 [MINOR] HD CAM-03 reveal shot: the firefighter is cropped at the frame bottom behind the OSD label; mask and axe only intermittently visible

Files: src/world/feeds/channels.js, src/world/Figure.js, src/world/feeds/OSD.js

**Description:** Requirement 9 says CAM-03 should clearly show the figure in a melted mask and rescue uniform, holding a breaching axe. The HD firefighter (HD_SPOT z=-1.55) sits in the bottom third of the frame. His torso is cut off by the frame edge and the bottom-left status label is drawn across his body. Most of the time his head is bowed so only the helmet top shows; the melted mask is readable only in the 'look' pause, every third cycle. The axe is fully off-screen in about a fifth of the samples.

**Evidence:** /tmp/review-spec/hd_cam3.png and hd_cam3_0..2.png: helmet top only, label over the body. /tmp/review-spec/axe_sheet.png (12 frames): mask visible in 2, axe visible when raised. /tmp/review-spec/s_axe2.js projected the axe bbox into the CAM-03 camera: 25 of 113 samples had no corner on screen, and the head NDC y ranged from -0.30 to -0.59.

**Reviewer's suggested fix:** Move HD_SPOT about 0.6–0.9 m further from the door, or tilt or raise the CAM-03 camera, so the full upper body and the whole axe arc sit above the label band. Alternatively make the look-up beat more frequent the first time CAM-03 HD is shown, or move the OSD label up or give it a dark band.

---
## playqa#9 [POLISH] Small framing and text-layout nits

**SCOPE NOTE: ONLY part (b) HD CAM-03 framing is yours.**

Files: src/data/layout.js, src/world/feeds/channels.js, src/systems/Subtitles.js

**Description:** (a) In the default seated pose (pitch −0.05) the LED clock is cut in half by the top edge of the screen, so the key '02:00' prop is half out of frame in every seated shot. (b) In HD CAM-03 the firefighter stands in the lower part of the frame and the OSD target label runs across his legs and helmet. (c) The intercom 3 subtitle breaks as '…燒起來' / '了……退後…' because of text-wrap: balance.

**Evidence:** play2/B03_seated.png and pb/C0x_*.png (clock cropped at the top). /tmp/review-playqa/gE2.png (HD CAM-03 crops with the label over the figure). pb/C71_ic3_sub0.png (line break).

**Reviewer's suggested fix:** (a) Use SPAWN.seated pitch ≈ +0.02, or lower clock.y slightly. (b) Aim CAM-03's HD camera a little lower or move HD_SPOT about 0.3 m further from the camera so he sits above the bottom OSD band. (c) Insert a zero-width or space break at the segment boundary, or drop balance wrapping for the intercom lines.

---
## spec#7 [POLISH] Blackout: the side system monitors keep showing text instead of snow

Files: src/states/BlackoutCorridorState.js, src/world/feeds/SideScreen.js

**Description:** Requirement 8 says that at 02:14 all monitors become snow. Only the main CRT switches to STATIC. The two side screens keep rendering amber/red status text (SYS LOG and '中段繼電器跳脫').

**Evidence:** /tmp/review-spec/bo_room.png: the main CRT shows snow with 'NO SIGNAL｜訊號中斷', while the left and right side screens show text.

**Reviewer's suggested fix:** Give SideScreen a static/no-signal mode for the first few seconds of the blackout (low-contrast, stable mean brightness, as the CRT does), or document the side screens as UPS-powered in DESIGN-NOTES.
