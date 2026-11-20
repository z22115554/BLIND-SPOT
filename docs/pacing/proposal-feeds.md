# 盲區交接 BLIND SPOT: CCTV micro-events and motion-detect cues ("What the Cameras Saw")

Angle: make all four channels worth watching. Small, quiet, evolving LD anomalies on CAM-01/02/04 (plus a few extra CAM-03 behaviours). A diegetic motion-detect cue tells the player where to look. A small director spaces the events between the existing gates. Every anomaly is a piece of the Act-3 HD truth showing through the LD feed.

Two design principles hold the proposal together:

1. **Things change only in the blind spot.** No channel ever changes while it is on screen. The CAM-03 rule now covers the whole CCTV system: an anomaly is applied only while its channel is not displayed (CAM-03 keeps its own seen-then-unseen rule). The motion detector reports what you missed, never what you are looking at.
2. **Every LD anomaly is a fragment of the HD scene at the same coordinates.** Cones, soot, the tanker, the red-cross lane signals, the amber barricade lamps and the hose trail all sit exactly where their HD twins are. Act 3 becomes recognition ("those cones were real; that shape in the glow was the tanker") instead of exposition.

---

## 1. Diagnosis: why the middle is dead

### 1.1 Numbers (from `MonitoringState.js`, `CLOCK.secondsPerMinute = 17`)

| Window | Clock | Free clock time | Figure limits in window | Max CAM-03 changes possible |
|---|---|---|---|---|
| W0 | 02:00 → 02:03 | 3 × 17 = **51 s** | {0,2} | 2 |
| W1 | 02:03 done → 02:05 | 2 × 17 = **34 s** | {1,3} | 1 |
| W2 | 02:05 done → 02:08 | 3 × 17 = **51 s** | {2,4} | 1–2 |
| W3 | 02:08 done → 02:13 | 5 × 17 = **85 s** (02:10 detune and 02:12 vacuum are automatic) | {4,5} then {5,6} at 02:12 | 1 + 1 |

- Total act for an efficient player: 51 + about 20 (call 1) + 34 + about 8 (lever) + 51 + about 20 (call 2) + 85 + about 18 (call 3), which is **≈ 287 s**.
- **About 221 s (77 %) of that is "watch the monitors" time in which nothing is required.** Subtracting about 6 s of walking back after each gate leaves about 200 s of real idle time.
- In the 85 s window W3 the player can earn **one** figure advance (4→5) before 02:12.

### 1.2 Why watching gives nothing

- **CAM-01 and CAM-04 have literally zero updates in LD.** `Cam01.update` and `Cam04.update` both `return` unless the variant is HD. CAM-02's only LD motion is the ±8 %, about 4 s breathing of the heat blob. After a 15-second tour the information gain from those three channels is **0** for the remaining 3.5 minutes.
- **No cue exists.** Nothing ever tells the player that something happened somewhere else, so there is never a reason to look away.
- **The core mechanic is starved.** The blind-spot rule needs the player to look away. The design gives no reason to do so except the gates (intercom on the west wall, vent on the east wall). So the strongest moment ("he moved while I wasn't looking") happens only 3–4 times, always right after a gate, and the player never chose it.
- **Each CAM-03 window is capped** (GATE_LIMITS). A player who does look away voluntarily gets at most 1–2 changes per window, then "nothing to do" (the owner's exact words).
- **The objective `監看各頻道監視器（CAM-01 ～ CAM-04）` makes a promise the game never pays off.**
- **The Act-3 reveal has no seeds in LD.** HD CAM-01 (barricade, red ✕, `隧道封閉`), HD CAM-02 (tanker, ceiling smoke), HD CAM-04 (cones, tape, soot) and the HD CAM-03 hose all appear from nowhere. The reveal reads as new information, not as a realisation.

---

## 2. Design

### 2.1 The loop (about 15–25 s per cycle, about 10 cycles per act)

```
watch CAM-03 ─▶ console LED on CAM-0X starts breathing amber + soft relay tick from that side
     ▲                          │
     │                          ▼
     │        press CAM-0X → OSD shows 「▲ 動態偵測 02:06:28」 → find what changed
     │        (compare against the last visit; the SYS LOG records the time)
     │                          │   (CAM-03 is now unseen → figure may advance)
     │                          ▼
     └── CAM-03 LED starts breathing ("motion" where the static figure is) → press CAM-03
             → he is closer / has turned his head / the drag mark is longer,
               and the OSD stamp shows he moved during the seconds you were away.
```

The micro-events give the player a reason to look away. Looking away is what lets the figure advance. The CAM-03 alert then calls them back to see the result. Neither system works without the other.

### 2.2 Diegetic attention cue: 動態偵測 (motion detection)

| Layer | What | Where it is built |
|---|---|---|
| **Console LED** | Each CAM button already has a `SingleLed` (`room.camLeds`, green = current channel). While channel *n* has an unacknowledged alert, its LED **breathes amber** with a 2.4 s period, brightness 0.3→1.0, cosine-smooth (the same family as the unlock button and the intercom ring). With `reduceFlicker` on it is a **steady** amber at 0.8. If the alerted channel is also the current channel, green fades into amber. The LED panel is in view at the bottom of the frame while the player watches the main CRT (see `/tmp/review-playqa/base_800.png`). | `ControlRoom.update` reads `feeds.alertLevel(n)`, smoothed over about 0.6 s. |
| **Soft relay tick** | A new `motionTick` sfx: a quiet relay pull-in click followed by two low-passed sine pips (1046 → 784 Hz, about 80 ms each), peak about −26 dBFS. It is HRTF-placed at that channel's button (x = −0.36…+0.36), so it comes from the console and is subtly left or right. One reminder after 10 s and another after 20 s if the alert is still unacknowledged, then silence (the LED keeps breathing). No ticks play while the intercom is ringing or a call is in progress. After 02:12 the existing `setSilence` lowpass on the sfx bus muffles the tick by itself. | `sfx.js` (+ `SFX_GAIN.motionTick`) |
| **OSD tag** | On the alerted channel, a line under the CAM id: `▲ 動態偵測 02:06:28`. The stamp is the feed timestamp at the moment the change was applied. The tag stays for the rest of that visit and is gone on the next visit. It never appears or disappears while the channel is on screen. | `OSD.draw(state.tag)` |
| **SYS LOG** | The left terminal appends `02:06 CAM-02 動態偵測` (the last 8 lines are kept and they scroll). Lines are appended in order of occurrence, which matters for CAM-04's `02:00` line at 02:11 (see m4d). | `common.setLeftLog` merges `ctx.flags.motionLog` |
| **Prompt** | When the player aims at an alerted button, the prompt reads `按下　切換至 CAM-04（動態偵測）` (a text cue that also helps colour-blind players). | `registerCommonInteractables` label becomes a function |
| **Ack** | The alert on channel *n* clears once `feeds.isChannelObserved(n)` has held for **≥ 1.0 s**: the LED fades out over about 0.6 s, reminders stop, and `feeds:alertAck` is emitted. | `CameraFeeds._alertTick` |
| **One-time hint** | If the very first alert is not acknowledged within 20 s, show `ui.hint(SCRIPT.hints.motion, 5)` once. | director |

CAM-03 gets the same cue whenever the figure advances or changes sub-pose while unseen. That happens every time, by definition. Its OSD then shows `▲ 動態偵測 …` directly above the original label `偵測到靜態人形物體`: a motion alert on a "static" object. This contradiction, kept on screen, quietly says that the figure is alive and acting.

### 2.3 Minute by minute

Wall-clock seconds assume a typical player (6 s walk to a wall panel, 4–8 s reaction to a cue, 2–4 s spent looking). "Figure" means what happens on CAM-03 when the player looks away for that check, within the unchanged GATE_LIMITS. Every figure change also raises a CAM-03 alert (LED + tick + OSD stamp).

| Clock | ≈ wall s | What happens / changes | Cue | Player does | Story purpose → Act-3 payoff |
|---|---|---|---|---|---|
| 02:00 | 0 | Act starts after the note. CAM-03 on screen, figure 0, limits {0,2}. | – | Settles in. | – |
| 02:00:18 | ~5 | **m4a CAM-04 baseline.** The scene is unchanged: white car, driver door open, dome light lit. Only the detection stamp is new: `▲ 動態偵測 02:00:18`, i.e. the moment the driver walked off. | CAM-04 LED + tick (right side) | Presses CAM-04 and memorises the car. **Figure 0→1.** | Teaches the cue and sets the baseline. The same stamp comes back in m4d (loop). HD: empty bay. |
| ~02:00:35 | ~11 | CAM-03 alert (figure moved). | CAM-03 LED + tick | Returns: he stands further from the wall. The OSD stamp falls inside the seconds they were on CAM-04. | The core payoff, learned in the first 15 s. |
| 02:01 | ~21 | **m1a CAM-01.** Two dim headlights deep in the fog (z −38, low), with a faint scatter halo. | LED + tick | Checks. **Figure 1→2.** Returns. | "Things that never arrive": on every later visit the lights are exactly where they were. Payoff: Act-2 fire-door glass (`剛才閃過的刺眼車燈已經消失…空無一物`); HD: tunnel closed, no traffic. |
| 02:02 | ~38 | **m2a CAM-02.** Every tunnel lamp beyond the heat blob is dark; the lit tube is shorter. | LED + tick (left of centre) | Checks. Figure capped at 2 → **sub-pose: the hood turns toward the camera.** | Something is eating the tunnel from the far end. HD: lamps dead (`onVariant` already darkens them), fire. |
| 02:03 gate | 51–73 | Intercom 1 (`……門……打不開……`). **Director held.** | ring (existing) | Answers at the west wall. | unchanged |
| 02:03 + 6 s | ~80 | **m4b CAM-04.** The driver door is now **closed** and the dome light is off. No feed ever showed anyone come back. | LED + tick | Checks. **Figure 2→3.** | Who closed it? It echoes `門……打不開` from the call they just heard. Plants doubt about the driver and the car. HD: there never was a car. |
| 02:04 | 90–107 | Quiet (≤ 17 s). | – | Free tour, or stares at CAM-03. | Breathing room. |
| 02:05 gate | 107–116 | Vent fault → pull the lever (existing). Held. | existing | – | – |
| 02:05 + 6 s | ~122 | **m2b CAM-02.** A dark smoke band has gathered under the crown at the far end (front at z −40), **six seconds after the player "restarted" the ventilation.** | LED + tick | Checks. **Figure 3→4.** The drag mark first appears behind him. | The player's role: smoke gathers right after *their* lever. Payoff: HD ceiling smoke plus the right-hand panel `主排風 手動切斷（02:11 操作員）`. |
| 02:06 | ~141 | **m1b CAM-01.** The gantry lane signals have flipped from green ↓ to red ✕, and the VMS reads `隧道封閉` instead of `濃霧／減速慢行`. **The OSD still says `狀態：正常`.** | LED + tick | Checks. Capped → **sub-pose: head lowered, arms hang.** | The system's "normal" is a lie; something closed the tunnel. HD: the same gantry, signals and VMS, plus `狀態：封閉`. |
| 02:07 | 150–167 | Quiet. | – | – | – |
| 02:08 gate | 167–188 | Intercom 2 (`……煙太大了……別鎖……`). Held. | existing | – | – |
| 02:08 + 6 s | ~194 | **m2c CAM-02.** In the glare of the heat blob, a long dark shape lies across the road: the silhouettes of the tanker and truck cab, at the HD coordinates. | LED + tick | Checks. **Figure 4→5.** The drag mark is now clearly a long wet trail from the corner to his feet. | `熱源殘留` has a body. HD: the overturned tanker sits in that exact spot on screen, burning. |
| 02:09 | ~211 | **m4c CAM-04.** A soot plume has crept up the bay wall behind the car, and three traffic cones stand along the bay edge. | LED + tick | Checks. Capped → **sub-pose: one hand raised to his chest.** | Fire and police have already been here. HD: the same cones (now with tape) and the same soot. |
| 02:10 | 222 | Vent starts dying (existing 40 s detune). **m3a CAM-03, uncued:** applied while CAM-03 is unobserved, the far lamp dims and a thin haze hangs under the ceiling. | none (motion detection cannot see haze) | A player returning to CAM-03 notices the corridor is hazier. | Smoke has reached B區. HD: smoke-filled corridor and fire at the corner. |
| 02:10 + | ~230 | **m2d CAM-02.** The smoke band now reaches z −18 and the blob is dulled. | LED + tick | Checks. Returns: **no CAM-03 alert, no move** (capped, sub-pose used). That absence is itself unsettling. | The smoke is coming toward you. |
| 02:11 | ~242 | **m4d CAM-04.** The car is back exactly as it was at 02:00: door open, dome lit, no soot or cones. The feed **timestamp reads 02:00:xx** (11 minutes behind the room clock and staying behind), and the tag reads `▲ 動態偵測 02:00:18`, the same stamp as m4a. The SYS LOG appends `02:00 CAM-04 動態偵測` **below** the 02:1x lines. | LED + tick | Checks, and is confused. | The car is a replay. This foreshadows the loop reset (02:14 → 02:00 at the ending) without saying "no car". HD: empty bay. |
| 02:12 | 256 | Vent stops → vacuum + heartbeat (existing). Limits {5,6}. Director quiet for 6 s. | – | – | – |
| 02:12 + 6 s | ~262 | **m1c CAM-01.** The headlights are gone. Two amber lamps glow low and **near** (z ≈ −7) in a darker, thicker fog (the barricade positions). The tick is muffled by the vacuum. | LED + tick | Checks. **Figure 5→6 ('lift', looking up into the lens).** | Did the lights "arrive"? No: they are barricade lamps. HD: the barricade amber lamps at the exact coordinates, visibility 0 %. |
| 02:12 + | ~266 | **m2e CAM-02, uncued:** the smoke band reaches the camera. | none | – | – |
| 02:13 gate | 273–292 | Intercom 3. The figure reaches 7 while the player answers (existing). Blackout. | existing | – | unchanged |

Totals:
- **11 cued micro-events and 2 uncued ones.**
- **About 9 CAM-03 alerts:** 6 advances and 3 sub-poses before 02:13.
- The longest stretch with nothing to find is the two **≤ 17 s** quiet windows (02:04 and 02:07), deliberately kept as breathing room. Before, the longest was 85 s.

### 2.4 What the player sees when they come back to CAM-03

- The 0.25 s channel-switch roll (existing) reveals a new frame:
  - a new position, or a new pose at the same spot (head turned over the shoulder, toward the lens);
  - a longer **drag mark**: a wet, dark trail from the corner to his heels, which grows only when he moves;
  - an OSD stamp that falls inside the seconds the player spent on another channel. That is proof that he moves exactly when they look away.
- The CAM-03 LED stops breathing after one second of watching. Nothing changes while they watch.
- In W3 the player sometimes comes back to find **no change and no alert**. The pattern breaks, the player waits for it, and the heartbeat starts at 02:12.

### 2.5 Director rules (pacing that adapts to the player)

Events are **not** fired on a fixed timeline. Each event has an `at` time (when it becomes eligible) and a `by` time (when it is forced), both as fractional minutes. The director fires the next eligible event only when the player is ready for it:

- **Ready ("quiet")** means: ≥ 12 s since the last cued fire, ≥ 5 s since the last acknowledgement, and no unacknowledged cued alert on CAM-01/02/04.
- **Forced** at `by`, even if an earlier alert is still pending.
- **Held** while the intercom is ringing or talking and while the vent fault or restart is active, plus 6 s after each hold and 6 s after `ventStop` (let the vacuum land).
- **Deferred** while that channel is the one on screen (`feeds.channel === ch || feeds.shownChannel === ch`). The director moves on to the next eligible event on another channel. When the player finally switches away, the change is applied, and **the alert lights up the moment they leave**, which fits the blind-spot rule.
- **Baseline first.** A "comparison" event (m4b, m4c, m4d, m1b, m1c) requires that the player has viewed that channel for ≥ 1.5 s at least once. Otherwise it is downgraded to an uncued apply, so the alert never says "something changed" about a scene they never saw.
- **`minuteF` is capped** at `minute + 0.999` during clock holds, so events tied to 02:04 cannot fire while the clock still reads 02:03.
- **The figure contract is untouched.** GATE_LIMITS, the seen-then-unseen rule and the 02:13 arrival all stay as they are. The director only creates reasons to look away. Sub-poses are an extra CAM-03 behaviour that applies **only when the figure is at `limits.max`** (one per index, never at index 7), so the A3 coherence in DESIGN-NOTES holds.

Keep `secondsPerMinute = 17`. The dread needs duration; the problem was emptiness, not length. The schedule is expressed in fractional minutes, so if play-testing still says "long", dropping to 15 (an act about 25 s shorter) needs no schedule edits.

---

## 3. New copy (all 【補充文案】, Traditional Chinese, in `src/data/script.js`)

No 【原企劃文案】 string changes. `cams[n].ld` labels are shown exactly as before, and the tag is an extra OSD line.

```js
// 【補充文案】監視器動態偵測（CCTV 微事件）
feedUI: {
  motionTag: (stamp) => `▲ 動態偵測 ${stamp}`,          // OSD：CAM id 下方一行
},
// 【補充文案】頻道場景內的標誌文字（原本硬寫在 channels.js 的「隧道封閉」一併移入）
feedSigns: {
  vmsFog: ['濃霧', '減速慢行'],                           // CAM-01 LD 可變資訊標誌（正常時）
  vmsClosed: ['隧道封閉'],                                // CAM-01 LD m1b 之後 ＆ HD（沿用）
},
```

Additions inside existing objects:

```js
status: {
  // …existing…
  motionLog: (hhmm, n) => `${hhmm} CAM-0${n} 動態偵測`,    // 【補充文案】SYS LOG
  // （可選，C 級）拉下通風拉桿後：
  ventManualLog: (hhmm) => `${hhmm} 主排風 手動操作`,      // 【補充文案】
},
interact: {
  // …existing…
  camButtonAlert: (n) => `切換至 CAM-0${n}（動態偵測）`,   // 【補充文案】
},
hints: {
  // …existing…
  motion: '琥珀色指示燈：該頻道偵測到動態',                // 【補充文案】首次警示 20 秒未查看時提示一次
},
```

Total: 4 short strings, 2 templates and 1 optional log line.

`ventManualLog` is optional. It appends `02:05 主排風 手動操作` to the SYS LOG when the lever is pulled. "Manual operation" is not "restart"; Act 3's `主排風 手動切斷（02:11 操作員）` completes the thought. Cut it if it feels too pointed.

---

## 4. Implementation plan (file by file)

Ground rules for the implementer:
- New code goes into **two new files** to stay clear of the bug-fix pass currently touching `channels.js` and `CameraFeeds.js`. Edits to existing files are small hooks.
- **Never change the number of lights** in a feed scene at runtime: change `intensity` only. Never toggle `light.visible`, because three r170 rebuilds programs when the light count changes and that hitches.
- New anomaly objects are **sprites, planes and merged meshes** in the channel's `ld` group, so HD hides them automatically through `setVariant`.

### 4.1 `src/world/feeds/anomalies.js` (new, ≈ 230 LOC)

```js
export function installAnomalies(channels, SCRIPT) { … }   // 由 createChannels(SCRIPT) 呼叫
// 每個頻道得到：ch.stage = 0, ch.maxStage, ch.meanScale = 1, ch.setStage(k, { all = false } = {})
//   all = true：把所有異常物件同時顯示（只用於 precompile）
```

Each `setStage(k)` is **idempotent and absolute**: it computes the full LD state for stage *k* from scratch. Skipping (`?clock=`), resetting (the loop) and debugging (`BS.feeds.setAnomalyStage`) therefore all use the same path.

**CAM-01** (camera at [−3.5, 5.0, 2.5] aimed at [0.6, −3.2, −40]; LD fog 0x6a6e72 / 0.095)

| Stage | State |
|---|---|
| build | **LD gantry** at z −10, copying the HD gantry dims: beam y 5.1, posts at x ±4.6, signal boxes at x ±1.9 y 4.45, VMS box y 5.75. Merged, `gantryM`. Signal faces are 2 × `plane(0.78, 0.78, TX.laneSignalTexture('arrow'), {basic:true})` with `material.fog = false`, colour 1.1 (LED emitters punch through fog). VMS face: `plane(2.8, 0.7, TX.vmsTexture(SCRIPT.feedSigns.vmsFog), {basic:true})`, `fog:false`, colour 1.0. **Headlights:** `glow(C(1,0.97,0.9),[1.1,0.7],[0.2,0.75,-38],{opacity:0.32,fog:false})`, the same at x 1.7, plus a halo `glow([5,2.5], opacity 0.08)`. **Amber lamps:** `glow(C(1,0.62,0.2),[1.4,1.4],[-2.4,1.2,-6.6],{opacity:0.55})` and `[1.6,1.2,-7.1]` (the HD barricade lamp positions). |
| 0 | Arrows; VMS fog text; headlights hidden; amber hidden; fog as built. |
| 1 (m1a) | Headlights visible. |
| 2 (m1b) | `sigMat.map = TX.laneSignalTexture('x')`; `vmsMat.map = TX.vmsTexture(SCRIPT.feedSigns.vmsClosed)`. Swapping one non-null map for another needs no recompile. |
| 3 (m1c) | Headlights hidden; amber visible. `fogs.LD.color.setHex(0x55585b)`, `fogs.LD.density = 0.108`, `bg.LD.setHex(0x55585b)` (mutate the existing objects). Portal glows at 0.5× opacity. `meanScale = 0.8`. |

**CAM-02** (camera at [−3.4, 5.1, 1.0] aimed at [0.9, −3.4, −34])

| Stage | State |
|---|---|
| build | **Far-lamp shells:** for each `tun.lamps` entry with `on > 0 && z < -40`, add `boxG(0.3, 0.13, 1.24, x, y + 0.1, z)`. The box fully encloses the lit fixture, so there is no z-fighting. Merge them into one dark mesh (`std({color:0x1c1c1b})`). Collect the far LD lamp glow sprites (`ld.children` sprites with `z < -40`, excluding blob and blobCore). **Smoke band:** 16 sprites, `TX.smokeSprite(141)`, colour 0x161616, opacity 0.5, scale 5–8, along the crown (y 5.6–6.3, x ±2.8 jitter) from z −72 to −2 in steps of 4.5 m, all hidden. **Silhouettes:** `silhouetteOf(buildTanker({seed:3}))` at (0.6, 0, −27.5) with rotation y 0.52, and `silhouetteOf(buildTruckCab({seed:4}))` at (−3.2, 0, −34.5) with rotation (0, 1.25, 0.06), i.e. exactly the HD transforms. |
| 0 | Shells hidden, band hidden, silhouettes hidden. |
| 1 (m2a) | Shells visible; far glows hidden; the LD PointLight at z −38 goes from intensity 20 to 9. `meanScale 0.92`. |
| 2 (m2b) | Band front = −40 (sprites with z ≤ front visible). |
| 3 (m2c) | + silhouettes visible. |
| 4 (m2d) | Band front = −18; `this.blobGain = 0.7`. `meanScale 0.85`. |
| 5 (m2e) | Band front = −3. `meanScale 0.8`. |

The silhouettes were checked with geometry: the ray from the camera through the tanker centre lands at y ≈ −3 on the z −60 blob plane, which is inside the blob (y −5.4…8.6). The black shape therefore cuts into the lower glow (the sprites are depth-tested).

**CAM-03**

| Stage | State |
|---|---|
| build | **Drag mark:** a flat ribbon of width 0.16 along `HOSE_PATH` (the HD hose points, exported from `channels.js`), built from `curve.getSpacedPoints(120)` ordered from the corner toward the door. `MeshStandardMaterial({color:0x0b0b0b, roughness:0.25, transparent:true, opacity:0.7, polygonOffset:true, polygonOffsetFactor:-2, depthWrite:false})` at y 0.008, in `ld`. Length is controlled with `geometry.setDrawRange(0, 6*i)`, with no rebuilds. **Haze:** 6 static sprites (`smokeSprite`, 0x3a3a3a, opacity 0.22, scale 1.6–2.4) at y 2.4–2.6, z −12…−3, hidden. |
| hook | Wrap `Cam03.setFigurePose(i, sub)`: after the original, call `drag.reach(i >= 2 ? FIGURE_WAYPOINTS[i].z + 0.35 : null)` (the last spaced point with z ≤ target; `null` hides it). It therefore changes **only** when the figure moves, i.e. only when unseen. |
| 1 (m3a) | `farLamp.intensity 1.4 → 0.85`, `farFill 1.6 → 1.0`, far glow sprite opacity 0.7 → 0.45, haze visible. `meanScale 0.9`. |

**CAM-04** (camera at [−1.6, 4.7, −9.2] aimed at [6.2, 0.2, −19])

| Stage | State |
|---|---|
| build | `this.car.userData.parts = { hinge, dome, domeLamp }` (see props.js). **Soot:** `plane(9.5, 4.4, TX.sootPlume(131), {decal:true})` at the HD position `[bayX-0.012, 2.2, -20]` with the HD rotation, opacity 0.45, plus `sootPlume(135)` at 0.35, both in `ld` and hidden. **Cones:** 3 × `cone(coneM, stripeM)` at the HD posts `[4.75,-11.2] [5.05,-16.6] [5.1,-22.4]` with HD rotations `i*1.3`, hidden. |
| 0 / 3 | `hinge.rotation.y = -0.95`; `dome.intensity = 0.35`; domeLamp colour (1.5, 1.3, 1.0); soot and cones hidden. |
| 1 (m4b) | `hinge.rotation.y = -0.02`; `dome.intensity = 0` (intensity only, never `visible`); domeLamp colour 0.05. |
| 2 (m4c) | Stage 1 + soot + cones. `meanScale 0.9`. |

m4d sets stage 3 (visually identical to stage 0) and `feeds.timeShift[4] = -minute` (−11).

### 4.2 `src/states/monitoringDirector.js` (new, ≈ 190 LOC; **no three.js import**, so node can unit-test it)

```js
export const MICRO = [
  // at / by：小數分鐘（02:00 = 0）；stage：頻道異常階段；cue：是否觸發動態偵測；needsBaseline：比較型事件
  { id: 'm4a', ch: 4, at: 0.30, by: 0.70, stage: 0, cue: true },
  { id: 'm1a', ch: 1, at: 1.00, by: 1.90, stage: 1, cue: true },
  { id: 'm2a', ch: 2, at: 2.00, by: 2.90, stage: 1, cue: true },
  { id: 'm4b', ch: 4, at: 3.00, by: 4.60, stage: 1, cue: true, needsBaseline: true },
  { id: 'm2b', ch: 2, at: 5.00, by: 5.90, stage: 2, cue: true },
  { id: 'm1b', ch: 1, at: 6.40, by: 7.50, stage: 2, cue: true, needsBaseline: true },
  { id: 'm2c', ch: 2, at: 8.00, by: 9.30, stage: 3, cue: true },
  { id: 'm4c', ch: 4, at: 9.30, by: 10.30, stage: 2, cue: true, needsBaseline: true },
  { id: 'm3a', ch: 3, at: 10.00, by: 10.00, stage: 1, cue: false },
  { id: 'm2d', ch: 2, at: 10.40, by: 11.20, stage: 4, cue: true },
  { id: 'm4d', ch: 4, at: 11.00, by: 11.80, stage: 3, cue: true, needsBaseline: true, stampFrom: 'm4a', shiftToStart: true },
  { id: 'm1c', ch: 1, at: 12.10, by: 12.60, stage: 3, cue: true, needsBaseline: true },
  { id: 'm2e', ch: 2, at: 12.50, by: 12.90, stage: 5, cue: false },
];
const MIN_GAP = 12, ACK_GAP = 5, POST_HOLD = 6, REMIND_EVERY = 10, REMIND_MAX = 2, BASELINE_SEC = 1.5;

export class MicroDirector {
  constructor(state, io, schedule = MICRO) {/* ctx = state.ctx; fired:Set, stamps:{}, seen:{1..4:0}, lastFire, lastAck, holdUntil, log:[] */}
  get minuteF() { const s = this.state; return s.minute + Math.min(0.999, (this.ctx.clock.time - s.minuteT0) / s.spm); }
  held() { const f = this.ctx.flags; return f.intercomRinging || f.intercomTalking || f.ventFault || f.ventRestarting || this.now < this.holdUntil; }
  quiet(sec) { this.holdUntil = Math.max(this.holdUntil, this.now + sec); }
  tick(dt) {
    // 1. baseline 計時：isChannelObserved(n) 累計 → seen[n]
    // 2. hold 邊緣：held→!held 時 quiet(POST_HOLD)；held 時 return（但仍更新 seen）
    // 3. 提醒聲：對每個未 ack 的警示，若 !isChannelObserved(n)、距上次 ≥ REMIND_EVERY、次數 < REMIND_MAX → tick(n)
    // 4. 依序走 schedule：未到 at 就 break；未 quiet 且未到 by 就 break；canApply 為 false 就 continue（該頻道正顯示中）
    //    → fire(ev)；每 tick 最多一個
  }
  canApply(ev) { const fd = this.ctx.feeds;
    return ev.ch === 3 ? (!fd.isChannelObserved(3) && fd.unobservedTime >= 0.5)
                       : (fd.channel !== ev.ch && fd.shownChannel !== ev.ch); }
  fire(ev) {
    const fd = this.ctx.feeds;
    fd.setAnomalyStage(ev.ch, ev.stage);
    if (ev.shiftToStart) fd.timeShift[ev.ch] = -this.state.minute;
    const cue = ev.cue && (!ev.needsBaseline || this.seen[ev.ch] >= BASELINE_SEC);
    if (cue) { fd.raiseAlert(ev.ch, { stamp: ev.stampFrom ? this.stamps[ev.stampFrom] : undefined });
               this.stamps[ev.id] = fd.alerts[ev.ch].stamp; this.tickSound(ev.ch); this.logLine(ev.ch); this.lastFire = this.now; }
    this.fired.add(ev.id); this.log.push({ id: ev.id, t: this.now, minuteF: this.minuteF, cue });
    this.ctx.bus.emit('micro:fire', { id: ev.id, channel: ev.ch, cue });
  }
  onFigureMoved({ index, sub }) { /* !isChannelObserved(3) → raiseAlert(3)；!held → tickSound(3)；logLine(3) */ }
  onAck({ channel }) { this.lastAck = this.now; }
  fastForward(start) { for (const ev of this.schedule) if (Math.floor(ev.at) < start) { /* setAnomalyStage, timeShift, fired.add — no alert */ } }
  // 副作用一律經由 MonitoringState 注入的 io（本檔零 import → node 可直接測）：
  //   io.tick(n)      → ctx.audio.sfx('motionTick', { position: points(ctx).camButtons[n-1] })
  //   io.logLine(n,s) → flags.motionLog.push(S.status.motionLog(s.slice(0,5), n)); setLeftLog(..., { force: true })
  //   io.hint()       → ui.hint(S.hints.motion, 5)（只一次）
  tickSound(n) { this.io.tick(n); }
  logLine(n) { this.io.logLine(n, this.ctx.feeds.alerts[n]?.stamp); }
  dump() { return { minuteF: this.minuteF, held: this.held(), alerts: Object.keys(this.ctx.feeds.alerts), next: this.schedule.find((e) => !this.fired.has(e.id))?.id, log: this.log }; }
}
```

The director file has **zero imports**. All side effects go through the `io` object that MonitoringState builds, which is where `common.js` (and so three.js) is used. Add `camButtons: [V(...)…]` to `points()` in common.js, computed from `LAYOUT.CONTROL_ROOM.camButtons` (`xs`, y 0.82, z −2.36), for the tick position. `T()` inside the director is a local 3-line try/catch.

### 4.3 `src/states/MonitoringState.js` (≈ +45 LOC)

- `enter()`:
  - `this.spm = Number(ctx.params?.get?.('spm')) || ctx.CLOCK.secondsPerMinute` (debug only).
  - `this.director = ctx.params?.get?.('micro') === '0' ? null : new MicroDirector(this, makeMicroIO(ctx))`. `makeMicroIO` (≈ 15 LOC, in MonitoringState or common.js) wraps `audio.sfx('motionTick')`, the SYS LOG push plus `setLeftLog({force})`, and the one-time `ui.hint`.
  - `if (start > 0) this.director?.fastForward(start)`.
  - `this.on('feeds:figureMoved', (p) => this.director?.onFigureMoved(p))`.
  - `this.on('feeds:alertAck', (p) => this.director?.onAck(p))`.
- `run()` uses `this.spm`. `setMinute(m)` also sets `this.minute = m; this.minuteT0 = ctx.clock.time`.
- `ventStop()`: `this.director?.quiet(6)`.
- `onVentRestart()` (optional C): push `S.status.ventManualLog(clockText)` into `flags.motionLog`.
- `tick()`: `this.director?.tick(dt)`. With debug on, also `ctx.ui.debugText(…)`. `main.js` already writes the debug line, so instead expose `ctx.flags._microDebug = director.dump().next` and append it in main's debug line (one shared-file edit; optional).
- `exit()`: `T(() => ctx.feeds.clearAlerts())` unless going to BLACKOUT (power off darkens the LEDs anyway; clearing is still the safer choice).

### 4.4 `src/world/CameraFeeds.js` (≈ +110 LOC)

- Fields: `alerts = {}`, `_alertK = {1:0,2:0,3:0,4:0}`, `_watch = {1:0,…}`, `_tag = {}` (stamp shown on the next draw), `timeShift = {1:0,2:0,3:0,4:0}`, `figureSub = false`, `subPoses = true`.
- `get shownChannel() { return this._shownChannel; }`
- `raiseAlert(n, { stamp } = {})`: only when `mode === 'LD'`. `stamp ??= this._timestamp(this._t, n)`. Set `alerts[n] = { stamp, t0 }` and `_tag[n] = stamp`. If `this._shownChannel === n`, force an OSD redraw next frame (this happens only for CAM-03 while the player looks at the room). Emit `feeds:alert`.
- `alertLevel(n)` returns `_alertK[n]`. `clearAlerts()`.
- `_alertTick(dt)`: per channel, if `alerts[n] && isChannelObserved(n)`, add to `_watch[n]`; at ≥ 1.0 s, delete the alert and emit `feeds:alertAck`. Otherwise `_watch[n] = 0`. Then `_alertK[n] = damp(_alertK[n], alerts[n] ? 1 : 0, 5, dt)`.
- `_beginSwitch(n)`: clear `_tag[prev]` if `!alerts[prev]` (the tag vanishes on leaving, never on screen). `_beginMode(m)`: if `m !== 'LD'`, call `clearAlerts()`, `_tag = {}`, `timeShift = {…0}`.
- `_timestamp(t, n = this._shownChannel)`: `const text = addMinutes(clockText, this.timeShift[n] || 0)` (seconds logic unchanged).
- `_updateOSD`: add `tag: this._tag[ch] ? S.feedUI.motionTag(this._tag[ch]) : null` to the feed state.
- `setAnomalyStage(n, k)`: `channels[n].setStage(k)`, then `_needRender = true` if shown.
- `_meanOf` and `_beginSwitch` AGC: multiply `FEED_MEAN.LD[ch]` by `channels[ch].meanScale` (LD only).
- `_blindSpot`: after the existing advance branch, add:

```js
else if (this.unobservedTime >= 0.5 && this.seenSinceMove && this.subPoses
         && this.figureIndex >= this.limits.max && !this.figureSub && this.figureIndex < FIGURE_STEPS - 1) {
  this.figureSub = true; this.seenSinceMove = false; this.unobservedTime = 0; this._applyFigure();
  this.ctx.bus.emit('feeds:figureMoved', { index: this.figureIndex, sub: true });
}
```

  `figureIndex++` sets `figureSub = false`. `_applyFigure()` calls `setFigurePose(this.figureIndex, this.figureSub)`.
- `_precompile()`: inside the LD loop, call `ch.setStage?.(ch.maxStage, { all: true })` before `r.compile`, and `ch.setStage?.(0)` after. `compile()` uses `traverseVisible`, so hidden anomaly objects would otherwise compile on first view and hitch.
- `reset()`: `setStage(0)` on all channels; clear alerts and tags; `timeShift = {…0}`; `figureSub = false`.

### 4.5 Small hooks in existing files

| File | Change | LOC |
|---|---|---|
| `feeds/channels.js` | `export const HOSE_PATH = [...]` (move the pts array out of `_buildHDDressing`); in `Cam02.update` multiply blob opacities by `(this.blobGain ?? 1)`; HD VMS uses `SCRIPT.feedSigns.vmsClosed`; `createChannels(SCRIPT)` → `installAnomalies(chs, SCRIPT)`; `Cam03.setFigurePose(i, sub)` passes `sub` to `figure.setPose`. CameraFeeds passes `ctx.SCRIPT` into `createChannels`. | ~15 |
| `feeds/props.js` | `buildSedan`: `car.userData.parts = { hinge, dome, domeLamp }` (null when `doorOpen = 0`). New `silhouetteOf(group, color = 0x050505)`: one shared `MeshBasicMaterial`, `group.traverse(o => o.isMesh && (o.material = mat))`. | ~15 |
| `world/Figure.js` | `LD_SUBPOSES` keyed by waypoint index, plus `setPose(index, sub = false)`. When `sub`, apply `LD_SUBPOSES[index]`, defined as joint deltas over the base pose. Indicative values: 0 `wallTurn` (neck [0.14,0.25,0], head [0.1,0.45,0.05]); 1 `wall2Turn` (head yaw 0.6 toward the camera); 2 `sideLook` (head fully to the lens); 3 `bowedLow` (neck 0.5, shoulders drop); 4 `bowed2Hand` (lElbow −1.1, lWrist −0.6: hand at chest); 5 `reachFar` (rShoulder −0.95); 6 `liftUp` (head −0.32: looking up into the lens). LD only, no animation. | ~35 |
| `feeds/OSD.js` | `if (state.tag) shadowText(state.tag, mx, my + 32, { size: 19, font: FONTS.ui, weight: '' });` | ~4 |
| `ControlRoom.js` | In `update`, the cam-LED block becomes `sel*(1-al)*green + al*breath*amber`, scaled by `power*live`. `breath = reduce ? 0.8 : 0.3 + 0.7*(0.5 - 0.5*cos(2πt/2.4))`, `glowK 0.45`. | ~12 |
| `audio/sfx.js` + `AudioEngine.js` | Add `motionTick(v, t)` using the `synth.js` helpers `click(v, dest, t, opts)` and `tone(v, dest, t, f, peak, tc, opts)` (the 6th argument is a decay time constant): lowpass 2.4 kHz; `click(v, lp, t, {f:1800, Q:1.2, peak:0.18, tc:0.003})`; `tone(v, lp, t+0.09, 1046, 0.05, 0.03, {a:0.008})`; `tone(v, lp, t+0.21, 784, 0.045, 0.04, {a:0.008})`; `v.send(lp, 'room', 0.15)`; return 0.6. Add `SFX_GAIN.motionTick ≈ 0.12` (calibrate to about −26 dBFS at 1 m) and a doc line in the header list. | ~25 |
| `states/common.js` | `resetFlags`: `motionLog: []`. `logLinesUpTo` returns `[...base, ...flags.motionLog]` (order of occurrence) and then `.slice(-8)`. `setLeftLog` key becomes `${lines.length}|${lines.at(-1)}|${tone}`, with a `{force}` option. The cam-button `label` becomes `() => ctx.feeds?.alerts?.[n] ? I.camButtonAlert(n) : I.camButton(n)`. `points()` gains `camButtons`. | ~25 |
| `data/script.js` | Section 3 keys. | ~12 |
| `docs/DESIGN-NOTES.md` | New **A5: CCTV micro-events / motion detection** (the two principles, director rules, the figure sub-pose exception). `ARCHITECTURE.md` §5 gains the events `feeds:alert`, `feeds:alertAck` and `micro:fire`. | ~30 |

**Total ≈ 750 LOC of production code**, plus about 290 for the test scripts (§6). About 65 % of it is in the two new files.

---

## 5. Comfort and golden-rule check

| Element | Brightness / flashing | Sound | Jump-scare risk | reduceFlicker |
|---|---|---|---|---|
| Console amber LED | An indicator, not a light source: 4.5 mm LED + glow sprite (`SingleLed`, no PointLight). Breathing at 2.4 s, cosine (same family as the intercom ring at 1.2 s and the unlock button at 2.4 s). Frame-brightness impact is under 0.1 %. Fades in and out over about 0.6 s. | – | none | **Steady** 0.8 amber, no breathing. |
| `motionTick` | – | Peak about −26 dBFS (rule ≤ −10). Low-passed at 2.4 kHz, no transient above the existing `camSwitch`. Played ≤ 3 times per alert and ≥ 10 s apart, never during ringing or a call, and muffled by the vacuum after 02:12. | none: a known soft console sound, not a stinger | unchanged |
| OSD `▲ 動態偵測` tag | Static text. Appears only as part of the 0.25 s channel-switch crossfade and is removed only on switch-away. Never blinks and never changes while on screen. | – | none | unchanged |
| Every feed anomaly | Applied **only while its channel is not displayed**, so there is no on-screen transition at all. Per-channel LD mean shift is ≤ 20 % (CAM-01 m1c −20 %, CAM-02 stage 5 −20 %, the rest ≤ 10 %) and is compensated in the AGC through `meanScale`, so switching into a changed channel ramps exactly like today (0.25 s roll + 1.1 s AGC, ≤ 30 %/0.25 s). | – | Nothing new appears near any lens. Closest new objects: CAM-01 amber lamps at about 9.6 m in fog, CAM-04 cones at about 7 m, CAM-02 smoke band (a soft dark gradient that arrives over 4 steps across 7 minutes). | All static (no animated sprites in LD). |
| CAM-01 headlights / amber | Static glows, opacity ≤ 0.55, no sweep, no flicker. | – | none | – |
| CAM-02 silhouettes | Dark shapes 28–35 m away, darkening only. | – | none | – |
| CAM-03 drag mark / haze / far lamp dim | Darkening only. Applied only while CAM-03 is unobserved (same rule as the figure). | – | none | – |
| Figure sub-poses | Same discrete pose-swap mechanic as the existing advances. Never while observed. Closest is `liftUp` at index 6 (2.65 m), identical in distance to the existing 'lift' pose. Can be disabled with `feeds.subPoses = false`. | – | Same level as the existing index 6. If play-testers find `liftUp` too intense, swap it for a quieter `liftHood` (head 0). | – |
| Performance | No new lights in any scene (main or feed). Per-channel extra draw calls: CAM-01 ≈ 8, CAM-02 ≈ 22, CAM-03 ≈ 7, CAM-04 ≈ 11. Only the shown channel renders, at 10 fps. Precompiled at init, so there is no first-view hitch. Director, alert tick and LED cost are negligible. | – | – | – |
| Copy | No 【原企劃文案】 changes. The tag sits beside the original label. All new strings are 【補充文案】 in `script.js`. `隧道封閉` moves from hard-coded into `SCRIPT.feedSigns`. | | | |
| Spoilers | Nothing says "no car", "fire", "rescuer" or "you did it". Each beat is a contradiction the player can explain away (door closed, status normal versus a closure sign, a shape in the glare, a time stamp), and every one is confirmed by an HD object at the same spot. | | | |

---

## 6. Risks, cut list, testing

### 6.1 Risks and mitigations

1. **Busier but less dread.** The act could turn into a "whack-a-LED" chore.
   - The director's quiet rules (≥ 12 s between cues, 6 s after every gate and after the vacuum starts) and the two ≤ 17 s quiet windows are tuning constants (`MIN_GAP`, `POST_HOLD`).
   - Two uncued changes (m3a, m2e) and the W3 returns with "no CAM-03 change" keep it from becoming mechanical.
   - Tune in play-tests: if busy, raise `MIN_GAP` to 16 and drop m2a.
2. **LD legibility at 160×120.** Changes were sized for that resolution: the door panel is about 8 LD px, soot is a large dark plume on a bright wall, the tanker is a large dark cut in a bright glow, the smoke band covers the whole crown. Cones (about 5 px) and the drag mark (about 2 px) are the weakest, and the OSD tag tells the player where to look.
   - Verify with `feeds.debugBlit` before/after pairs (§6.3).
   - Fallback: cone scale 1.4, drag width 0.24.
3. **Shader hitches.** Mitigated by `setStage(maxStage, {all:true})` before precompile and by intensity-only light changes. Check with the existing hitch script (`/tmp/review-comfort/hitch.js` pattern).
4. **Players who never press buttons.** Nothing breaks:
   - Events still apply (forced at `by`).
   - LEDs breathe, ticks stop after 2 reminders, and the one-time hint appears.
   - Gates and the figure behave exactly as today. The act length is identical (the clock drives it).
5. **Merge conflicts with the ongoing bug-fix pass.** Most code is in the two new files, and the hooks in `channels.js`, `CameraFeeds.js` and `ControlRoom.js` are under 15 lines each. Implement after the fix pass merges.
6. **Interplay with A3.** GATE_LIMITS and the gate clock are untouched. Sub-poses happen only at `limits.max` and never at index 7. The heartbeat still keys off `figureIndex`. The 02:13 arrival is unchanged (answering forces `{7,7}`).
7. **Colour-blind players** cannot rely on amber versus green. Breathing versus steady, the `（動態偵測）` prompt suffix and the OSD tag all carry the same information.

### 6.2 Cut list (implement top-down; ship any prefix)

- **A (must; about 60 % of the value):**
  - Alert system: LED, tick, OSD tag, acknowledgement, prompt label.
  - Director with the hold/quiet/defer/baseline rules.
  - CAM-03 alert on every figure move.
  - m4a, m4b, m4d (CAM-04 baseline, door closed, reset to 02:00 + timeShift).
  - m1a and m1b (headlights; red ✕ + `隧道封閉`).
  - m2b and m2d (smoke band).
  - New copy.
- **B (should):** m2c silhouettes, m4c soot + cones, m1c amber + darker fog, CAM-03 drag mark, SYS LOG lines.
- **C (could):** figure sub-poses, m3a haze, m2a far lamps, m2e, `ventManualLog`, the one-time hint, the debug HUD hook.

If only A ships, W3 still gets m2d and m4d. Promote m1c to A if W3 feels thin.

### 6.3 How to test

**Debug hooks** (with `?debug=1`, `window.BS = ctx`):
- `?state=MONITORING&clock=02:09`: `fastForward` applies every earlier stage and the CAM-04 time shift (no alerts).
- `?micro=0`: director off (A/B against the current build).
- `?spm=6`: fast clock for smoke runs.
- `BS.feeds.setAnomalyStage(2, 3)`, `BS.feeds.raiseAlert(4)`, `BS.feeds.alerts`, `BS.feeds.alertLevel(4)`, `BS.feeds.timeShift`, `BS.feeds.subPoses = false`.
- `BS.fsm.current.director.dump()` gives `{minuteF, held, alerts, next, log}`. `BS.fsm.current.director.fire(BS.fsm.current.director.schedule.find(e => e.id === 'm2c'))` fires one event.

**1. Pure-node pacing simulation** (`scripts/pacing-sim.mjs`, new, about 140 LOC, **no browser**, safe on the saturated machine):
- Imports `monitoringDirector.js` and `data/script.js` (neither imports three).
- Fakes: a `clock` stepped at 0.05 s; `feeds` with `channel`, `shownChannel`, `alerts`, `isChannelObserved`, `unobservedTime`, a 15-line mirror of `_blindSpot` plus the sub-pose rule, and `setAnomalyStage`; `flags`; and the MonitoringState minute/gate loop (gate durations taken from `SCRIPT.intercom[i].segments` + 6 s walk + 1.5 s hold).
- Three player models:
  - **eager**: reacts in 2–4 s, looks for 2–3 s;
  - **typical**: reacts in 4–8 s, looks for 2–4 s, does a voluntary channel tour with 15 % chance per 5 s;
  - **passive**: only answers gates.
- Output: a timeline table (event fire, ack, figure moves, gates, minute) and metrics.

Assertions:
- act length is 270–330 s for eager and typical;
- max idle gap (no pending alert, no gate, no event in progress) is ≤ 20 s for eager and typical;
- every cued event fires before `by + 0.5` minute;
- no cue fires during a hold;
- figure index is 7 at blackout for all models;
- the passive model finishes with no errors.

Run with `node scripts/pacing-sim.mjs --runs 200 --seed 1` and print percentiles.

**2. In-browser autopilot run** (`scripts/pacing-run.mjs`, new, about 150 LOC, Playwright like `scripts/shot.mjs`; **run only when the CPU is free**):
- URL `?debug=1&autostart=1&state=MONITORING&speed=3`.
- A 250 ms polling loop:
  - if `BS.feeds.alerts` has *n*: `BS.feeds.setChannel(n)` while seated looking at the CRT (observed);
  - if ringing: teleport to face the west wall, wait 2 s, `BS.bus.emit('intercom:answer')`;
  - if `ventFault`: face east, `BS.bus.emit('vent:restart')`, then reseat.
- Record `micro:fire`, `feeds:alert`, `feeds:alertAck` and `feeds:figureMoved` with `BS.clock.time` into `window.__log`, then dump it.
- Assert the same metrics as the simulation, plus zero console errors and a ≤ 50 ms frame-time spike on the first view of each stage (hitch check).

**3. Legibility and brightness sheets** (shot.mjs `--steps`). For each channel *n* and stage *k*:
- `BS.feeds.setAnomalyStage(n,k); BS.feeds.setChannel(n)`, wait 1.6 s, take a `debugBlit` screenshot.
- Assemble a contact sheet (stage 0 next to each stage) and eyeball that every cued change is visible at a 960×720 view.
- Measure frame-mean luminance per shot with the `/tmp/review-comfort` analysis approach. Assert `|mean(k)/mean(0) − meanScale(k)| < 0.08`, and across a channel switch into each stage, ≤ 30 % change per 0.25 s window.

**4. Audio:** render `motionTick` through the analyser path used for `audio-v1.json` in `/tmp/review-comfort` and assert a peak of ≤ −20 dBFS at gain 1.

**5. Owner play-test script:**
- Play once with defaults and once with `?micro=0`.
- Questions:
  - (a) Did you always know where to look next?
  - (b) Did you ever see something change on screen while you were watching it? (It must be "no".)
  - (c) In Act 3, which HD details did you recognise?
  - (d) Did any moment feel like a jump scare?
- Then tune `MIN_GAP`, cut m2a/m2e, or toggle `subPoses`.
