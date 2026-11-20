# Review findings assigned to the 'room' fixer

Each finding below was verified by an independent reviewer (their evidence paths under /tmp/review-*/ still exist — scripts, logs and screenshots you may Read or reuse; their scripts point at /tmp/review-*/game.html, so copy & adapt them to your own build path).

---
## spec#0 [MAJOR] Ending: the charred-ruin transformation and the 'char recedes, hot coffee reappears' beat are never visible

Files: src/states/EndingLoopState.js, src/states/common.js, src/world/ControlRoom.js

**Description:** Requirement 10 asks for two visual beats: (a) while the smoke swallows the view, the control-room textures peel into a charred ruin; (b) when the view is pulled back to the desk, the char recedes and hot coffee reappears. In the build, setBurnt(1,{duration:12}) runs at the same time as cr.setSmoke(1,{duration:10}), postTo('smoke',1,11) and FOG.smoke (FogExp2 density 0.9, color #0a0806). By the time burnt passes about 0.35 the frame is already a flat brown haze, so you never see the burnt walls, cracked CRTs or falling ceiling tiles. The reset to the clean room then happens in resetInBlack() while fade = 1. It is an instant snap, so (b) is not shown either. In the writing shot and the slump shot the coffee mug is out of frame, so 'hot coffee reappears' is never seen. DESIGN-NOTES does not document any of this; it only covers the smoke lasting about 7 s instead of being instant (A1).

**Evidence:** Ending log (/tmp/review-spec/ending.log, ENDING_LOOP at speed 2): t=12.4 smoke .29 burnt .28 → t=14.0 smoke .55 burnt .48 → t=16.0 smoke .83 burnt .72 → t=19.8 smoke 1 burnt 1. At t=33.6 fade .99 burnt 1; at t=33.8 fade 1, burnt 0, coffee 0 (the snap happens in full black). /tmp/review-spec/smoke_sheet.png (smoke_9.5…11.5): from smoke ≈0.4 / burnt ≈0.36 (fog density 0.107→0.55) the frame has no visible features. /tmp/review-spec/end_20_sub.png, end_24.png and end_36.png are the same featureless brown under the monologue. /tmp/review-spec/burnt_ref.png (setBurnt(1) with no smoke) shows the charred asset exists but is never seen. /tmp/review-spec/end_84.png (writing) and end_102.png (slump, 02:00) show no coffee.

**Reviewer's suggested fix:** Start the burn earlier and faster: begin setBurnt about 1 s after the door starts moving, over about 4–5 s. Cap the visual smoke during the first monologue line (for example FOG.smoke.density ≈0.25–0.35 and postfx smoke ≤0.6 until burnt ≥0.9), then let it go to full black. For the return beat, fade to about 0.8 rather than 1. Then visibly run setSmoke(0), setBurnt(0,{duration:2.5}) and setCoffee(0), with the camera framing the desk, mug and steam (or widen WRITE_CAM so the steaming mug is in shot). If you keep the current approach, document it as a deliberate change in DESIGN-NOTES.

---
## playqa#1 [MAJOR] Ending smoke reads as a flat dark-brown screen; no billowing, and the charred room is never visible

Files: src/world/controlRoom/particles.js, src/world/ControlRoom.js, src/states/common.js, src/gfx/PostFX.js

**Description:** I confirmed the states agent's report. Three things hide the smoke. (1) The SmokeSystem sprites are almost black: ControlRoom.js:747 sets the tint to (0.016,0.015,0.014) plus a tiny share of light colour; measured sprite colour was (0.039,0.022,0.018). (2) They are SpriteMaterials with the default fog:true (particles.js:21) inside FOG.smoke (common.js:177, density 0.9, colour #0a0806). Even at density 0.4, a sprite more than 2 m away is mostly fog colour, so it is indistinguishable from the fog behind it. (3) PostFX then mixes up to 94% toward uSmokeColor (0.044,0.036,0.028) using low-amplitude, screen-locked noise and darkens by 42% (PostFX.js:134-141). The result is a uniform dark-brown frame with no world-space motion. The setBurnt(1) charred room and the console the camera turns back to during the monologue are not visible at any point before the fade to black.

**Evidence:** Natural run frames pb/F1_9s … F1_27s.png (grid /tmp/review-playqa/gF1.png). With subtitles excluded, mean luminance is about 20/255 and std is about 6 from 12 s to 27 s after the unlock (it was 14.6/24.7 before the door opened). Average RGB is about (24,19,15). At 1280x720, 15 s after the unlock (smoke 0.85, smokeLevel 0.90, fog 0.40, burnt 0.74, 64 sprites visible, opacity 0.5–0.66), hiding the whole smoke sprite group changed the frame by only a mean of 4.4/255 (fin/s1_normal.png vs fin/s2_no_sprites.png).

**Reviewer's suggested fix:** Make the smoke lit and readable instead of fog-coloured. Give the sprites a mid grey-brown base (≈0.12–0.25 linear) modulated by the room/emergency light, and use NormalBlending with softer alpha or a per-sprite noise rotation. Set fog:false on the smoke sprites, or cap their fog factor. Lower FOG.smoke density to about 0.25–0.35 for most of the sequence so the burnt room, door frame and console silhouettes stay legible 2–4 m away; push to full density only during the last ~2 s before the fade. In PostFX, reduce the maximum mix (≈0.6), scale the noise up and anchor it to the view direction or world so it drifts when the camera turns, and keep 'soft' light bloom so the orange 'ending' lights glow through.

---
## comfort#6 [MINOR] Ending smoke uses 88 separate Sprites (88 draw calls, heavy overdraw) on top of the full-screen smoke pass: 430 draw calls at +20 s

Files: src/world/controlRoom/particles.js, src/world/ControlRoom.js

**Description:** SmokeSystem creates 88 Sprite + SpriteMaterial pairs. Each is its own draw call, has its own material and can't be batched. They grow to 1.5-3.4 m across inside a 3 m tall room, so overdraw from the camera's position is large, while fog goes to 0.9 and postfx.smoke applies a 12-tap soft blur over the whole screen anyway. This is the only state above the 400-call rule of thumb.

**Evidence:** /tmp/review-comfort/perf.js ENDING (perf2.out, 640x360, same aspect as 1280x720 so culling is identical): before unlock 192 calls (main 86 + feed 106); door opening 178; smoke +12 s 308 (main 200); smoke +20 s 430 calls (main 322 + feed 108), 107k tris. Scene contains 107 sprites (88 smoke + 6 steam + others).

**Reviewer's suggested fix:** Replace them with one InstancedMesh (camera-facing quads in the vertex shader, per-instance opacity/size/rotation attributes) or a single Points/ShaderMaterial: 1 draw call. Cap concurrent visible particles to about 30, and fade sprites out as fog density passes about 0.5, since the fog and postfx smoke already hide them. Optionally stop rendering the CCTV feed (108 calls at 30 fps) once feeds.brightness < 0.15.

---
## playqa#6 [MINOR] Writing shot: on small windows the stage-direction subtitle covers the line being written

Files: src/states/EndingLoopState.js, src/states/common.js, src/systems/Subtitles.js

**Description:** The writing shot works at 1280x720: '鎖死防爆門。' is legible as it is written and the pen is visible. The stage direction is shown at 1.2 s and stays up through the whole 5.2 s pen stroke. Its dark radial scrim sits in the lower-middle of the frame, and the camera places the note's last line just above it. At 800x450 the scrim lies directly across '鎖死防爆門。' while it is being written; the line only becomes readable after the subtitle clears. The frame is also bottom-heavy: the note is in the lower centre, and the cam-panel's large '監視頻道選擇 CAM' lettering takes up the upper right.

**Evidence:** pb/F3_w4.png and pb/F3_w6_5.png at 800x450 (zoomed comparison /tmp/review-playqa/gF3z.png), against pb/F3_w8_6.png after the subtitle clears. 1280x720: subtitle box top 584 px (scrim from ≈565), pen at y=542, note centre y=488 (fin/w_1280_mid.png). 1920x1080: subtitle top 897, pen at y=813.

**Reviewer's suggested fix:** Show the direction before the pen starts and clear it as writing begins, or render 'direction' style at the top of the screen for this shot. Raise WRITE_CAM.lookAhead slightly (look a little lower) so the note sits at screen centre, and turn the camera slightly left so the CAM panel lettering leaves the frame.

---
## spec#2 [MAJOR] ENDING_LOOP: the unlock button is not the only interactable target

Files: src/states/common.js, src/states/EndingLoopState.js

**Description:** Requirement 10 says the blast-door emergency unlock button lights red and is the only interactable target. registerCommonInteractables gates everything only on playing() (= not TITLE and not endingStarted), and endingStarted is set only after the button is pressed. Before the press, the player can still inspect the coffee, sticky note, clock, blast door, intercom and vent panel, and can switch CAM-01..04. ARCHITECTURE softens this to '唯一關鍵互動', but DESIGN-NOTES does not record it as a deliberate change.

**Evidence:** /tmp/review-spec/s_axe.js in ENDING_LOOP evaluated every item's enabled(): ["stickyNote","coffee","cam1","cam2","cam3","cam4","clock","blastDoor","intercom","vent","unlock","fireDoorGlass","watch","logbook","coat"]. That is 15 enabled items, not 1. Code: common.js `const playing = () => !inState(ctx, STATES.TITLE) && !f().endingStarted;`

**Reviewer's suggested fix:** In registerCommonInteractables, wrap enabled so that while f().unlockArmed is true only id === 'unlock' returns true (for example `enabled: () => playing() && (!f().unlockArmed || o.id === 'unlock') && !!enabled()`). Alternatively add an Interaction allow-list that EndingLoopState sets on enter and clears on exit.

---
## playqa#2 [MAJOR] Intercom: 3D grille, button and LED are placed independently of the printed panel texture and overlap it

Files: src/world/controlRoom/buildFixtures.js, src/gfx/textures/props.js

**Description:** I confirmed the states agent's report. buildIntercom hard-codes its 3D parts and ignores the layout returned by intercomPanel() (speaker u/v/r, led, button). The slatted 'consoleDark' box, 0.17×0.11 m at y=+0.07 (buildFixtures.js:316-317), sits over the printed round speaker grille, whose lower third pokes out below it. The same box covers the lower half of the printed '緊急對講' header (text centre y≈+0.126, box top +0.125). The 3D chrome/grey call button at x=0, y=−0.07 (line 318 and following) sits between the printed green LED (x=−0.055) and the printed black '通話' button (x=+0.044), half-covering the printed button, so the panel shows two buttons. The real LED is a separate 3D dot at the top-right of the red band (line 333). Meanwhile the printed '通話燈' LED always looks lit green, which contradicts the idle description '對講機的通話燈是暗的。'. The player stands at this panel to answer it four times, so the overlap is seen up close.

**Evidence:** /tmp/review-playqa/close/intercom_close.png (1280x720, 0.5 m away): '緊急對講' lettering cut in half by the black slatted box, a second round grille visible underneath, two buttons side by side, a lit printed LED next to the dark 3D LED. Mapping the texture to the face (384×512 px onto 0.24×0.34 m) puts the printed grille at y=+0.031, r≈0.058; LED at (−0.055,−0.064); button at (+0.044,−0.064).

**Reviewer's suggested fix:** Place the 3D grille, button+ring and LED from the texture's returned layout (convert u/v to face-local x=(u−0.5)·0.24, y=(v−0.5)·0.34, and size them from r). Alternatively, remove the grille, LED and button from intercomPanel() and keep only the header band, the labels and the '連線' plate. Draw the printed LED unlit, or drop it, so the real LED is the only indicator.

---
## playqa#3 [MAJOR] Vent panel has the same texture/3D mismatch: two gauges, a covered label, and a 3D lever away from the printed lever slot

Files: src/world/controlRoom/buildFixtures.js, src/gfx/textures/props.js

**Description:** buildVentPanel ignores ventPanel()'s layout (gauge u/v/r, leds, lever). The 3D dial (CircleGeometry r=0.072 at y=+0.09, buildFixtures.js:362) and its chrome ring sit about 3.7 cm above the printed RPM gauge (centre y≈+0.053, ring r≈0.099). The printed gauge's lower arc and '主排風機 轉速' text show beneath it, so two gauges are visible: the 3D one is scaled 0–100, the printed one RPM×100 0–18. The 3D lever and its dark back plate (y −0.215…−0.045, line 383) cover the middle of the printed '主排風機' plate, which reads '主　機', and the middle '異常' LED. The printed lever slot with '運轉／重啟／拉下' labels sits at the bottom with nothing in it. The 3D status LED is at the right end of the title plate (line 378), while the printed 運轉/異常/停止 LEDs never change. When pulled down, the 3D knob hangs below the panel's bottom edge.

**Evidence:** /tmp/review-playqa/close/vent_close.png (1280x720), pb/C40_vent_fault.png and pb/C41_vent_after.png (grid /tmp/review-playqa/gC3.png). Mapping 512×640 px onto 0.385×0.485 m puts the printed gauge at y=+0.053, the plate at y −0.058…−0.094, the LEDs at y=−0.123, and the lever slot at y −0.173…−0.224.

**Reviewer's suggested fix:** Drive the 3D dial, needle, LED and lever pivot from the texture layout (gauge centre and radius, leds[1] for the fault light, lever.vTop/vBottom for the pivot and travel). Alternatively, strip the gauge, LEDs and slot from the canvas and keep only the plates and labels. Size the 3D dial to the printed ring, and keep the lever's down position inside the panel.

---
## playqa#4 [MAJOR] Side door to the maintenance corridor is stencilled '防爆門 / BLAST DOOR / B區'

Files: src/world/controlRoom/materials.js, src/world/controlRoom/buildFixtures.js, src/gfx/textures/materials.js

**Description:** The east side door's material is sideDoor: () => tm('steelDoor', …) (materials.js:52). The steelDoor canvas (textures/materials.js:182-200) bakes in the blast door's stencil '防爆門', 'BLAST DOOR' and a yellow 'B區' box. The side door is built from box slabs with this texture (buildFixtures.js:478), so it shows the blast-door lettering. DESIGN-NOTES B1 deliberately separates the two doors: the west blast door leads to B區, where the figure is, and the east side door leads to the maintenance corridor. Labelling the act-2 door '防爆門 B區' tells the player they are opening the door to the figure's corridor and undoes that separation.

**Evidence:** /tmp/review-playqa/close/sidedoor.png (MONITORING, 1280x720, x=2.6 facing east): large '防爆門' with the 'R' of DOOR and a yellow 'B區' frame on the lower door panel, under the '地下公務維修廊道' plate and the 緊急出口 sign. Compare with /tmp/review-playqa/close/blastdoor.png.

**Reviewer's suggested fix:** Give the side door its own map: a steelDoor variant without the stencil layers (add an option to steelDoor() to skip the white/yellow stencilLayer), or paintedMetal, optionally stencilled '維修廊道'. Also UV the 1.0×2.1 m leaf to its own proportions instead of the 1.7×2.3 m blast-door layout.

---
## playqa#9 [POLISH] Small framing and text-layout nits

**SCOPE NOTE: ONLY part (a) seated-pose LED clock crop is yours.**

Files: src/data/layout.js, src/world/feeds/channels.js, src/systems/Subtitles.js

**Description:** (a) In the default seated pose (pitch −0.05) the LED clock is cut in half by the top edge of the screen, so the key '02:00' prop is half out of frame in every seated shot. (b) In HD CAM-03 the firefighter stands in the lower part of the frame and the OSD target label runs across his legs and helmet. (c) The intercom 3 subtitle breaks as '…燒起來' / '了……退後…' because of text-wrap: balance.

**Evidence:** play2/B03_seated.png and pb/C0x_*.png (clock cropped at the top). /tmp/review-playqa/gE2.png (HD CAM-03 crops with the label over the figure). pb/C71_ic3_sub0.png (line break).

**Reviewer's suggested fix:** (a) Use SPAWN.seated pitch ≈ +0.02, or lower clock.y slightly. (b) Aim CAM-03's HD camera a little lower or move HD_SPOT about 0.3 m further from the camera so he sits above the bottom OSD band. (c) Insert a zero-width or space break at the segment boundary, or drop balance wrapping for the intercom lines.
