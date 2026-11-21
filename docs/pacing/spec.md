# 《盲區交接》Monitoring act (02:00 → 02:14): final pacing spec

> **中文摘要（給 owner）**
> 問題不是「太長」，而是「沒事做」：今天的 02:00→02:14 大約 4 分 48 秒，其中約 3 分 41 秒什麼都不用做，而且 CAM-01／02／04 看過一次就再也不會變。
> 這份規格做四件事：
> 1. **監視系統的「動態偵測」**：每分鐘最多一次，控制台 CAM 按鈕亮琥珀燈並響一聲輕柔的提示音，把你從 CAM-03 拉走；那個頻道的畫面在你沒看的時候變了。你一離開 CAM-03，他就可能往前一步。
> 2. **每一個變化都是第三幕高清真相的一小片**，就放在同一個位置：關上的車門、封閉號誌、拱頂下的黑煙、熱源裡的油罐車剪影、焦痕、時間停在 02:14:08。
> 3. **02:00 由你親手鎖死防爆門**（便利貼叫你做的），以及 **02:05 拉下通風拉桿後，防爆門傳來悶悶的敲門聲**，而此時 CAM-03 上的他還在走廊中段。
> 4. **安靜的分鐘會提早結束**（最少 11 秒；final 修正後 9 秒），但 02:10 的通風衰弱、02:12 的聽覺真空長度完全不動。
>
> 結果（原估計）：一般玩家約 **4 分 25 秒**；除了刻意保留的 02:12 真空，最長空檔約 18–20 秒（在 02:10 通風衰弱的那一分鐘），其他時間都在 12 秒以內。
>
> **final 修正（2026-11-21）**：原估計沒有算到「滑鼠玩家要低頭把準心對到控制台按鈕才能切頻道」。算進去之後，瀏覽器自動駕駛的
> 一般玩家這一幕是 **約 4 分 52 秒**（改版前 `?pace=0` 同條件 5 分 04 秒）：**長度只短了約 4%，改變的是「空檔」**——
> 最長空檔從 34 秒降到 20 秒，每分鐘都有事。詳見 DESIGN-NOTES E7。
> 原企劃文案一字不動；gate 結構、GATE_LIMITS、「先看見再移開才會動」規則都不變。

Status: FINAL, implementation-ready. Implement **after** the fix-pass worktrees are merged (`fix-systems`, `wf_9ca3cbda-0e3-1`, `wf_9ca3cbda-0e3-2`). Design against the current APIs and keep every diff additive. Before editing, re-read `CameraFeeds._beginSwitch/_meanOf/FEED_LUM` and `common.playIntercom`, because the fix pass touched both.

Reference prototype of the timing model (node only): `/tmp/claude-0/-home-user-BLIND-SPOT/ce241e67-75a7-5965-8877-93cdc03085bc/scratchpad/pacing/pace-proto.mjs` (`node pace-proto.mjs --runs 200 --dmin 11 --calm 3.5 --gap 11`).

---

## 0. Decisions (what was taken from where, and why)

| Decision | Source | Why |
|---|---|---|
| Skeleton: a minute-anchored director with at most one announced change per non-gate minute, plus one post-gate "re-entry" event after call 1 and call 2. | pacing + engineering | Fixes "nothing to do" without a clock rewrite. |
| Content: blind-spot-only LD anomalies, each an HD-twin fragment at the same coordinates. | feeds | Answers the owner's literal complaint. Act 3 becomes recognition. |
| Cue language: 動態偵測 / VMD only (LED, soft tone, OSD tag, SYS LOG line, prompt suffix). | feeds + pacing | One attention language. |
| Light attention clock: non-gate minutes may end early (≥ 11 s); 02:10, 02:11 and 02:12 are never shortened. | engineering (pacing Tier-0) | Gives roughly −25 s typical with minimal risk. |
| CAM-03 alarm with a 3–6 s delay, cancelled if the player is back. LED and OSD only, no tone. | pacing | Reports moves without becoming a mechanical "you looked away" tell. |
| 02:05 soft knock in the post-vent window. | pacing / experience | Audio dislocation. Makes the 原企劃 logbook line `02:05 有人在敲防爆門` true. |
| **Vent gate stays at 02:05.** | engineering | Keeps A3 and the owner-approved beat. Instead, the two 【補充文案】 Act-3 strings are retimed 02:11 → 02:05 (2 characters), which fixes the existing mismatch (DESIGN-NOTES B3 always meant the player's 02:05 lever). |
| **D0: the player locks the blast door at 02:00** (new gate, kill switch `?lock=0`). | agency D0 | Strongest enactment of the reveal for its cost. Fills the dead 02:00 minute and produces the first figure step. |
| Subtle figure sub-poses at the window cap, default on (`?subposes=0`). | feeds, constrained by both judges | With GATE_LIMITS unchanged only 7 steps exist; sub-poses pay back look-aways in capped windows. They are never more lens-facing than the base pose. |
| Exactly one time anomaly: CAM-04 OSD frozen at `02:14:08`. | pacing | Pays off the Act-2 watch and the 02:14 trip. |
| `01:58:41` stamp on the first CAM-04 alert. | experience (optional) | Deniable now ("the driver walked off"). Matches the report line `01:58 特種消防救援隊進入維修廊道` in Act 3. |
| Cross-channel OSD alarm line `▲ CAM-04` on the watched channel. | pacing | The player stares at the CRT, so the cue must also appear there. A small static line, DVR-style. |

**Rejected:** moving the vent gate; the full PaceClock rewrite; per-minute figure limits; patrol rounds; the self-writing logbook; the fire panel; police-tape double exposure; the CAM-04 rewind to 02:00; the `liftUp` and lens-facing sub-poses; any "watch it happen" on-screen ramp; ringing alarms; CAM-05; new main-room props; `layout.js` edits; `main.js` edits.

---

## 1. What the player experiences

You wake at 02:00 and read your own note: *鎖死防爆門。* The side screen says `防爆門：未鎖定` and the door lamp is green, so you walk to the west wall and turn the pneumatic wheel yourself. The SYS LOG writes `02:00 防爆門 手動上鎖（操作員）`. When you sit back down, the figure on CAM-03 has taken a step.

A minute later the CAM-04 button breathes amber and the console gives a soft two-note chime. On the CRT a small `▲ CAM-04` appears. You switch: the white car is exactly as the note said, and the tag reads `▲ 動態偵測 01:58:41`. Something moved there before you woke up.

From then on, roughly once a minute, a channel you are not watching changes:
- the north portal's lane signals read ✕ and `隧道封閉` while the OSD still says `狀態：正常`;
- three minutes after you locked the door, right after the voice says `……門……打不開……`, the white car's door is shut and its dome light is off;
- a dark band of smoke gathers under the far crown of CAM-02 a minute after you pulled the ventilation lever;
- soot climbs the bay wall behind the car;
- after the second call, the far tunnel has gone dark and something enormous lies across the lanes inside the heat glare.

Every time you look away, he may move. When you come back he is closer, or he has changed posture, and his trail of dark wet floor is longer.

At 02:05, right after you "restart" the ventilation, someone knocks softly on the blast door behind you, while CAM-03 still shows him far down the corridor.

At 02:10 the fan begins to die. If you happen to check CAM-04 now, its clock is stopped at `02:14:08`.

At 02:12 the room goes silent except for your heartbeat. At 02:13 the last call comes.

---

## 2. Final beat table

"≈ s" is wall-clock seconds from MONITORING enter for the *typical* persona (simulation seed 3; the prologue is not included). Figure: `{min,max}` limits are exactly as today, and "→ n" is the typical index change. "sub" means the capped-window sub-pose (§3.4). "VMD" means the full motion-detect cue (§3.2).

| Clock | ≈ s | Event (all feed changes applied only while that channel is NOT displayed) | Cue | Player action | Figure | Story purpose → Act-3 payoff |
|---|---|---|---|---|---|---|
| **02:00 GATE (new)** | 0–25 | Door starts **unlocked**: right screen `防爆門：未鎖定`, door lamp green. The clock holds at 02:00 until locked. Lock = wheel turns 2.5 turns in 1.7 s, then bolts home in 0.7 s; sfx `lever` → `unlatch` + `pneumaticHiss`(0.5). Lamp → red. Log `02:00 防爆門 手動上鎖（操作員）`. Right screen → `normal`. Then an early-flip dwell of ≥ 11 s. | Objective `鎖死防爆門`; nag hint at 20 s, then every 30 s. | Walks to the west wall, 上鎖, walks back. | {0,2}: → 1 while away (seen in the prologue). | **You lock him out with your own hand**, exactly as your note told you. Mirrors the ending's `解除氣壓門鎖` and the report's `防爆門：由內部反鎖。`. |
| 02:01 | 25–38 | **m4a CAM-04**: alert with **nothing changed**. Tag stamp = `01:58:41`; log `01:58 CAM-04 動態偵測` (sorts above `02:00`). | VMD | Learns the CAM buttons, memorises the car, returns. | → 2 | Tutorial and baseline. "What moved?" Act 3: `01:58 特種消防救援隊進入維修廊道。` |
| 02:02 | 38–49 | **m1b CAM-01**: lane signals ↓ → ✕ (dimmer in B&W), VMS `濃霧／減速慢行` → `隧道封閉`. The OSD label still says `狀態：正常`. | VMD | Checks CAM-01. | capped → **sub(2)**: head lowered | The system's "normal" is a lie; the tunnel is closed. HD `狀態：封閉`, same gantry. |
| **02:03 GATE** | 49–86 | Intercom 1 (unchanged). **Post-gate (+6 s): m4b CAM-04** driver door closed, dome light and glow off. | ring; then VMD | Answers at the west wall, beside the door they locked; walks back (he moved); checks CAM-04. | after call {1,3}: → 3; m4b check → **sub(3)** | `……門……打不開……` three minutes after you locked it. Who shut the car door? HD: there never was a car. |
| 02:04 | 86–98 | Quiet minute (early flip after ≥ 11 s of calm). | – | Watches CAM-03. | {1,3} | Breathing room. |
| **02:05 GATE** | 98–120 | Vent fault → lever (unchanged). Log `02:05 主排風 手動操作`. **Knock** (§3.6): 3 gloved knocks, then 2 more after 2.4 s, at the blast door, once the player has watched CAM-03 for ≥ 1 s (or forced at +13 s). Log `02:05 防爆門 震動感測` 1 s later. The blast-door inspect gains `鋼板摸起來是溫的。` | existing vent cues; the knock is HRTF audio from behind-left | Pulls the lever; hears the knock while **CAM-03 shows him ≈ 5.6 m away**; may go and touch the door. | after gate {2,4}: → 4 | Audio dislocation: he is far on screen *and* at the door (B2). Logbook `02:05 有人在敲防爆門`; report `02:05 救援隊員抵達…` and (retimed) `02:05 主排風遭控制室內手動切斷。` |
| 02:06 | 120–131 | **m2b CAM-02**: a dark smoke band under the far crown (sprites at z ≤ −40), swallowing the far lamp glows. | VMD | Checks CAM-02. | capped → **sub(4)**: hand to chest | Smoke gathers one minute after *your* lever. HD ceiling smoke; Act 3 `手動切斷`. |
| 02:07 | 131–142 | **m4c CAM-04**: a large soot plume on the bay wall behind the car, plus 3 cones along the bay edge (HD transforms). | VMD | Checks CAM-04. | capped, sub used → **no change** | Fire and police have already been here. HD: the same soot and cones, plus tape. |
| **02:08 GATE** | 142–178 | Intercom 2 (unchanged). **Post-gate (+6 s): m2c CAM-02**: far lamps (z < −40) dark, and tanker and truck-cab **silhouettes** at the HD transforms, cut into the heat glow. | ring; then VMD | Answers; back (he moved); checks CAM-02. | after call {4,5}: → 5; m2c check → **sub(5)**: reaching arm drops | `……煙太大了……` → `熱源殘留` gets a body. HD: the burning tanker in that exact spot. |
| 02:09 | 178–191 | **m1c CAM-01**: fog darkens and thickens toward smoke; two amber lamps glow low and near (the HD barricade-lamp positions). | VMD | Checks CAM-01. | capped → no change | Something was set up across the lanes; visibility is collapsing. HD barricades, `能見度：0%`. |
| 02:10 (protected) | 191–208 | Vent starts dying (existing 40 s detune). **Uncued m4d**: CAM-04 OSD time frozen at `02:14:08`, REC dot faded out. *(T2 uncued m3a: CAM-03 haze.)* | audible decay only | Sweepers find the frozen clock. | {4,5} | `02:14:08` = the watch in Act 2 and the 02:14 trip. The only time anomaly. |
| 02:11 (protected) | 208–225 | **m2d CAM-02**: smoke band advances to z ≈ −16, heat glow dulled (×0.75). | VMD | Checks CAM-02. | capped → no change | The smoke is coming north, toward you. |
| 02:12 (protected) | 225–242 | Vent stops → vacuum + heartbeat (unchanged). **No cues, no tones, no new alerts.** *(T2 uncued m2e: smoke near the CAM-02 lens.)* | silence | Stares at CAM-03. | {5,6} | Dread peak. |
| **02:13 GATE** | 242–262 | Intercom 3 → blackout (unchanged). | ring | Answers. | ring {6,7}: → 6; answer {7,7}: → 7 | `我要破門了` at the door (A3). |

Totals (typical): ≈ **262–270 s** (today ≈ 288 s). There are 8 announced cues (CAM-01/02/04) and 0–2 CAM-03 alarms. Figure paybacks: 6 steps plus 4 sub-poses. 3 look-aways deliberately return "no change" (02:07, 02:09, 02:11), which builds the pre-vacuum dread.

---

## 3. Rules

### 3.1 Blind-spot purity and the HD-twin rule
1. **No discrete feed change while that channel is displayed.**
   - Channels 1, 2 and 4 change only when `feeds.channel !== n && feeds.shownChannel !== n`.
   - CAM-03 keeps its existing rule: it changes only while `!mainScreenObserved` (it may be shown while the player is at a wall) and after unobserved ≥ 0.5 s.
   - Enforced twice: in the director, and by a hard guard in `CameraFeeds.setAnomalyStage` (§7.2).
2. **Every LD anomaly is a fragment of its HD scene at the same coordinates and transforms.** It is added to the channel's `ld` group, so HD hides it automatically.
3. **Never change the light count.** Change light `intensity` only, never `light.visible`. Build every anomaly object at construction time. At runtime, change only `visible` on meshes and sprites, `opacity`, `color`, `intensity`, `fog.color/density`, and swaps of `map` from one non-null texture to another. Never toggle `transparent`, `fog`, or a map's presence (both cause a recompile).
4. **No "watch it happen" ramps.** Every stage is an instantaneous swap in the blind spot.

### 3.2 VMD (動態偵測) cue language: the only new attention language

| Layer | Spec |
|---|---|
| Console LED | `room.camLeds[n-1]` shows amber while channel *n* has an unacknowledged alert. Breathing: `k = 0.3 + 0.7·(0.5 − 0.5·cos(2πt/2.4))`, giving a 2.4 s cosine. With `reduceFlicker`, steady 0.8. The level fades in and out with `alertLevel(n)` (damped λ = 4, about 0.6 s). Colour blend: `green·sel·(1−al) + amber·al·breath`, so the selected channel cross-fades rather than popping. LED-only: no PointLight. |
| Tone `vmdTone` | Channels 1, 2 and 4 only. A soft relay click, then two low-passed sine pips (1046 → 784 Hz), HRTF at that CAM button (`points.camButtons[n-1]`). Peak ≤ −28 dBFS at the seat. Played once on raise, plus **one** reminder 12 s later if still unacknowledged and not observed. Never while ringing or talking, and never after `ventStopped` (02:12). |
| OSD alarm line (on whatever channel is shown) | Right-aligned under the timestamp: `▲ CAM-04` (all alerted channels ≠ shown, ascending). Static text. It changes only when the alert set changes. |
| OSD tag (on the alerted channel) | Under the CAM id: `▲ 動態偵測 HH:MM:SS`, where the stamp is the feed time **when the change was applied** (CAM-03: when the move happened; m4a: `01:58:41`). Latched when the channel is switched in, kept for the whole visit, cleared on switch-away. It appears on a shown channel only if that channel is not observed (in practice CAM-03 while the player is at a wall). |
| SYS LOG | `HH:MM CAM-0n 動態偵測`, merged into the left screen in time order (the last 8 lines are kept). CAM-03: at most one line per clock minute. |
| Prompt | Aiming at an alerted button shows `按下　切換至 CAM-0n（動態偵測）`. This also serves colour-blind players. |
| Ack | `feeds.isChannelObserved(n)` held continuously for **1.0 s**. Then the alert is deleted and `feeds:alertAck {channel}` is emitted; the LED fades; the tag stays until switch-away. |
| One-time hint | If the first alert of the run is not acknowledged within 20 s: `ui.hint(SCRIPT.hints.motion, 5)`, once per run. |
| Mode change | Leaving LD (blackout STATIC, HD) clears all alerts, tags and frozen times. |

### 3.3 CAM-03 alarm (report only)
On `feeds:figureMoved {index, sub}` while `!isChannelObserved(3)`:
- record `stamp = feeds.clockStamp()`;
- schedule `due = now + U(3, 6)` (seeded rng).

When due:
- **cancel** if `feeds.seenSinceMove || isChannelObserved(3)`;
- also cancel if held, within POST_HOLD, or `ventStopped`;
- otherwise `raiseAlert(3, {stamp})` with no tone (LED, OSD line, tag and log only).

The tag `▲ 動態偵測 …` then sits directly above the original label `偵測到靜態人形物體`, a motion alarm on a "static" object, and that contradiction stays on screen. The rule that moves the figure is untouched.

### 3.4 Sub-poses (capped-window payback)
In `CameraFeeds._blindSpot`, add an `else if` after the existing advance branch. All of these must hold:
- `subPoses`;
- `unobservedTime ≥ 0.5`;
- `seenSinceMove`;
- `figureIndex ≥ limits.max`;
- `!figureSub`;
- `figureIndex ≤ 5`.

Then:
- `figureSub = true`, `seenSinceMove = false`, `unobservedTime = 0`;
- apply the pose;
- emit `feeds:figureMoved {index, sub:true}`.

`figureIndex++` and `setFigureIndex()` reset `figureSub = false`. At most one sub-pose per index; never at 6 or 7. The heartbeat and A3 key off `figureIndex` and are unaffected. The trail does **not** change on a sub-pose.

`LD_SUBPOSES` are joint overrides merged over the base LD pose. They are subtle, and **never add yaw or pitch toward the lens**. The values are starting points; tune them from screenshots.

| idx | base | sub-pose (override) | reads as |
|---|---|---|---|
| 0 | wall | `neck [0.30,0,0], head [0.28,0,0.07]` | forehead against the wall |
| 1 | wall2 | `rShoulder [-1.05,0,-0.12], rElbow [-0.55,0,0]` | palm raised flat on the wall |
| 2 | side | `neck [0.45,0.12,0], head [0.42,0.12,0.05]` (yaw ≤ base) | looking down at the floor |
| 3 | bowed | `chest [0.18,0,0], lShoulder [0.12,0,0.06], rShoulder [0.12,0,-0.06]` | shoulders sag, arms hang |
| 4 | bowed2 | `lShoulder [-0.5,0,0.3], lElbow [-1.6,0,0]` | hand to chest |
| 5 | reach | `rShoulder [-0.25,0,-0.14], rElbow [-0.2,0,0]` | reaching arm drops, tired |

### 3.5 The 02:00 lock gate (D0)
- **World state:**
  - `resetWorld` (prologue start and loop reset) leaves the blast door **unlocked**: `cr.setBlastLocked(false,{duration:0})`, `setRight(ctx,'normalUnlocked')`.
  - `lateMonitoringWorld` and `restoredWorld` lock it with `duration 0`.
  - `?clock>02:00` skips lock it as well.
  - `?lock=0` or `?pace=0` keeps today's behaviour (the door starts locked and there is no gate).
- **Gate** (`beat(0)`): `this.limits(0)` first (so the very first turn-away pays a step). Then:
  1. set `flags.lockPending = true` and objective `lockDoor`;
  2. `nag(() => flags.lockPending, S.hints.lockDoor, 20, 30)`;
  3. `await until(() => flags.blastLocked)`.
- **Interaction:** while `inState(MONITORING) && lockPending`, the `blastDoor` interactable has label `I.blastDoorWheel`, verb `V.lock`, and emits `blastDoor:lock`. `MonitoringState.onLock()` then:
  1. sets `blastLocking = true`;
  2. plays sfx `lever` at `points.blastDoor`;
  3. awaits `cr.setBlastLocked(true,{duration:2.4})`, playing `unlatch` and `pneumaticHiss` (gain 0.5) when the bolts start (+1.7 s);
  4. sets `blastLocked = true`, `lockPending = false`, `blastLocking = false`;
  5. logs `status.lockLog(clockText)`; sets the right screen to `normal` and the objective to `monitor`.
- **Inspect text:**
  - before locking (prologue): `D.blastDoorUnlocked`;
  - after locking: `[S.prompts.blastDoorLocked]` (原企劃, verbatim), plus `D.blastDoorWarm` once `doorKnocked && !powerRestored`.
- **Ending:** unchanged. `openBlastDoor()` reads the current bolt position.

### 3.6 The 02:05 knock
- **Anchor:** `beatDoneAt` of minute 5 (lever done).
- **Eligible:** from +3 s, and only when all of these hold:
  - not held, not ringing or talking, no inspect open;
  - the player is ≥ 2.5 m (XZ) from `points.blastDoor`;
  - `isChannelObserved(3)` has held continuously ≥ 1.0 s, **or** +13 s has passed.
- **Skipped** (never late) if not fired by +16.5 s.
- **Sequence:** `doorKnock {count:3, amp:1}` → +2.4 s `doorKnock {count:2, amp:0.8}` → +1.0 s log `status.knockLog(clockText)` and `flags.doorKnocked = true`.
- No other sound is layered on it: no tone, no stinger. The knock is the 02:05 minute's required event, so that minute cannot flip early before it completes.

---

## 4. Timing model (exact)

All constants live in `src/states/monitoringDirector.js` (zero imports).

```js
export const PACE = {
  SPM: 17,          // = CLOCK.secondsPerMinute = DWELL_MAX (ctor option spm overrides; ?spm=N debug)
  DWELL_MIN: 11,    // earliest flip, measured from the minute's beatDoneAt (non-protected minutes)
  CALM: 3.5,        // seconds since the last mark required for an early flip
  RUSH: 1.0,        // early flip: OSD seconds run to :59 over this long, then flip
  LEAD: 1.5,        // a minute's event becomes eligible LEAD s after the flip
  POST_HOLD: 6,     // after any hold ends (lock, ring, talk, ventFault, ventRestarting) and after post-gate
  MIN_GAP: 11,      // min seconds between two announced (cued) events
  ACK: 1.0,         // (CameraFeeds) observed seconds to acknowledge
  REMIND: 12,       // single tone reminder for an unacked cued alert
  HINT_AFTER: 20,   // one-time motion hint
  CAM3_LAT: [3, 6], // CAM-03 alarm latency (uniform)
  LATE: 2,          // an event deferred ≥ 2 minutes is applied uncued
  BASELINE: 1.5,    // needsBaseline: channel observed ≥ 1.5 s before, else uncued
  PROTECTED: [10, 11, 12],
  KNOCK: { after: 3, watch: 1.0, force: 13, giveUp: 16.5, minDoorDist: 2.5, second: 2.4, logDelay: 1.0 },
};
```

**Marks** (these reset CALM): minute flip, beat done, alert raised, alert acked, figure moved (step or sub), knock played.

**Holds:** `flags.lockPending || blastLocking || intercomRinging || intercomTalking || ventFault || ventRestarting`. On the held → not held edge, `holdUntil = now + POST_HOLD`. `inspect.isOpen` is not a hold, but it blocks new fires and early flips.

**Minute loop** (`MonitoringState.run`):
```js
for (let m = start; m <= 13; m++) {
  if (m > start) await (this.director ? this.until(() => this.director.canFlip(ctx.clock.time)) : this.wait(spm));
  this.setMinute(m);
  this.director?.onMinute(m, ctx.clock.time);        // minuteT0 = now; beatDoneAt = null; rush = null; mark
  await this.beat(m);
  this.director?.onBeatDone(m, ctx.clock.time);      // beatDoneAt = now; if the beat was a gate: holdUntil = now + POST_HOLD; mark
}
```

**`canFlip(now)`** (called every frame by `until`):
```
if beatDoneAt == null → false                                   // gate still running
e = now − beatDoneAt
if e ≥ SPM → flip                                                // today's behaviour = the maximum
if rushT0 != null → (now − rushT0 ≥ RUSH) ? flip : false
if minute ∈ PROTECTED or minute ≥ 13 or early disabled → false
if e ≥ DWELL_MIN ∧ ¬held ∧ ¬inspectOpen ∧ now ≥ holdUntil ∧ no unacked alert (any channel, incl. CAM-03)
   ∧ now − lastMark ≥ CALM ∧ ¬minutePending() → rushT0 = now; k0 = k; return false
return false
```
`minutePending()` is true if any of these holds:
- a scheduled event with `ev.m ≤ minute` is unfired **and** is not deferred because its channel is shown;
- (minute 5) the knock sequence is not done or skipped;
- a cued event in this minute is waiting only on MIN_GAP.

**OSD seconds.** The director publishes `ctx.flags.minuteK` every tick:
- normally `k = min(0.999, (now − minuteT0)/SPM)`;
- during the rush, `k = k0 + (0.999 − k0)·smoothstep(0,1,(now − rushT0)/RUSH)`;
- `k` is monotonic within a minute and resets to 0 on the flip.

`CameraFeeds._timestamp` uses `sec = floor(60·minuteK)` when `Number.isFinite(flags.minuteK)`, otherwise today's formula. In gate minutes `k` saturates at :59, exactly as today. Seconds never run backwards.

**Schedule** (`SCHEDULE` in the same file; minute-anchored):

| id | m | ch | kind / stage | cue | anchor | needsBaseline | tier |
|---|---|---|---|---|---|---|---|
| m4a | 1 | 4 | stage 0 (no visual change), `stamp:'first'` | ✓ | flip + LEAD | – | 0 |
| m1b | 2 | 1 | stage 1 | ✓ | flip + LEAD | – | 0 |
| m4b | 3 | 4 | stage 1 | ✓ | beatDone + POST_HOLD | ✓ | 0 |
| knock | 5 | – | knock (§3.6) | audio | beatDone + 3 | – | 0 |
| m2b | 6 | 2 | stage 1 | ✓ | flip + LEAD | – | 0 |
| m4c | 7 | 4 | stage 2 | ✓ | flip + LEAD | ✓ | 1 |
| m2c | 8 | 2 | stage 2 | ✓ | beatDone + POST_HOLD | – | 1 |
| m1c | 9 | 1 | stage 2 | ✓ | flip + LEAD | – | 1 |
| m4d | 10 | 4 | freeze `02:14:08` | ✗ | flip + LEAD | – | 1 |
| m3a | 10 | 3 | stage 1 (haze) | ✗ | flip + 4 s, CAM-03 unobserved ≥ 0.5 s | – | 2 |
| m2d | 11 | 2 | stage 3 | ✓ | flip + LEAD | – | 0 |
| m2e | 12 | 2 | stage 4 | ✗ | flip + 6 s | – | 2 |

**Fire rules** (inside `tick`, at most one fire per tick, walking `SCHEDULE` in order):
- Skip anything not yet eligible.
- If held, inspecting or `now < holdUntil` → no fires.
- Channels 1, 2 and 4 shown → defer (continue to the next event). CAM-03 observed, or unobserved < 0.5 s → defer.
- `late = minute − ev.m ≥ LATE` → apply uncued.
- `cue = ev.cue ∧ ¬late ∧ ¬ventStopped ∧ (¬needsBaseline ∨ seen[ch] ≥ BASELINE)`.
- If cue and `now − lastCueAt < MIN_GAP` → stop for this tick (keep the order).
- Apply via `io.apply(ch, stage)` (or `io.freeze`). If it returns false (guard refused), retry later.
- If cue:
  1. `stamp = ev.stamp === 'first' ? io.firstStamp() : io.clockStamp()`;
  2. `io.raise(ch,{stamp})`, then `io.tone(ch)`, then `io.log('motion',{ch, hhmm: stamp.slice(0,5)})`;
  3. `lastCueAt = now`; mark.
- `io.trace({...})` for every fire, apply, alert, ack, knock and flip.

**fastForward(start)** (`?clock=`): for every `ev.m < start`:
- apply the stage or freeze with `force` (the screen is black at that moment);
- no alerts and no sounds;
- push the SYS LOG lines the run would have produced: `lockLog('02:00')`; `motionLog` for each cued event using its minute (or `01:58` for m4a); `ventManualLog('02:05')` and `knockLog('02:05')` if `start > 5`; set `flags.doorKnocked`.

**Simulated results** (prototype, 200 runs each; constants above; GATE_LIMITS unchanged; sub-poses not modelled):

| persona | act length p10 / p50 / p90 | max idle outside the vacuum | cued alerts | figure at blackout |
|---|---|---|---|---|
| eager (reacts 2–3.5 s) | 4:01 / 4:03 / 4:06 | ≈ 20 s (in the 02:10 decay) | 8 | 7 |
| **typical** (3.5–6 s) | **4:22 / 4:25 / 4:30** | ≈ 18 s (02:10 decay) | 8 (+0–2 CAM-03) | 7 |
| starer (never presses CAM) | 5:04 / 5:06 / 5:08 | ≈ 7 s* | 8 (never acked) | 7 |
| passive (slow, ignores 60 %) | 5:04 / 5:10 / 5:15 | ≈ 18 s | 8 | 7 |

\*The starer's alerts stay pending, so every minute runs the full 17 s. Today: ≈ 4:48 with idle stretches of 51 / 34 / 51 / 85 s.

**Tuning knobs:**
- If play-testing still says "slow": `DWELL_MIN 9, CALM 3` (≈ 4:12 typical).
- If it feels rushed: `DWELL_MIN 13` (≈ 4:40).
- Never shorten `PROTECTED`. Never let the act drop below 3:45 for the eager persona.

---

## 5. Copy (all new text is 【補充文案】 in `src/data/script.js`; no 【原企劃文案】 changes)

Additions inside existing objects:
```js
verbs:        { /* … */ lock: '上鎖' },                                              // 【補充文案】
interact:     { /* … */
  blastDoorWheel: '防爆門氣壓閥手輪',                                                // 【補充文案】02:00 上鎖互動
  camButtonAlert: (n) => `切換至 CAM-0${n}（動態偵測）`,                               // 【補充文案】
},
descriptions: { /* … */
  blastDoorUnlocked: '氣壓閥沒有加壓，鎖栓縮在門框裡。',                               // 【補充文案】上鎖前（序幕）
  blastDoorWarm: '鋼板摸起來是溫的。',                                                // 【補充文案】02:05 敲門後附加
  coffeeStill: '從你醒來到現在，它一點都沒有變涼。',                                   // 【補充文案】T2：02:08 起附加
},
objectives:   { /* … */ lockDoor: '鎖死防爆門' },                                     // 【補充文案】
hints:        { /* … */
  lockDoor: '防爆門在西牆。轉動門上的氣壓閥手輪即可上鎖。',                             // 【補充文案】nag 20 s / 30 s
  motion: '控制台的 CAM 按鈕亮起琥珀燈：該頻道偵測到動態。',                             // 【補充文案】首次提示 20 秒未查看
},
status: { /* … */
  normalUnlocked: ['供電：正常', '通風：運轉中', '防爆門：未鎖定', '監控：低頻寬模式'],   // 【補充文案】
  lockLog: (hhmm) => `${hhmm} 防爆門 手動上鎖（操作員）`,                              // 【補充文案】SYS LOG
  motionLog: (hhmm, n) => `${hhmm} CAM-0${n} 動態偵測`,                               // 【補充文案】SYS LOG
  ventManualLog: (hhmm) => `${hhmm} 主排風 手動操作`,                                 // 【補充文案】SYS LOG（拉桿）
  knockLog: (hhmm) => `${hhmm} 防爆門 震動感測`,                                      // 【補充文案】SYS LOG
},
```
New blocks:
```js
// 【補充文案】監視器動態偵測（CCTV 微事件）
feedUI: {
  motionTag: (stamp) => `▲ 動態偵測 ${stamp}`,                          // 被警示頻道：CAM id 下方
  alarmLine: (chs) => `▲ ${chs.map((n) => `CAM-0${n}`).join(' ')}`,    // 目前畫面：時間戳下方
  firstStamp: '01:58:41',                                              // 第一次 CAM-04 警示的偵測時間
  frozenTime: '02:14:08',                                              // CAM-04 停住的時間戳
},
// 【補充文案】頻道場景內的標誌文字（原本硬寫在 channels.js 的「隧道封閉」移入）
feedSigns: { vmsFog: ['濃霧', '減速慢行'], vmsClosed: ['隧道封閉'] },
```
Corrections to existing 【補充文案】 (DESIGN-NOTES B3 always meant the player's 02:05 lever):
- `status.restored[1]`: `'通風：主排風 手動切斷（02:11 操作員）'` → `'通風：主排風 手動切斷（02:05 操作員）'`
- `incidentReport.lines[3]`: `'02:11 主排風遭控制室內手動切斷。'` → `'02:05 主排風遭控制室內手動切斷。'` (same position, right after the 02:05 arrival line)

Prose budget: 5 short sentences, plus system tokens and log templates. Nothing states fire rescue, firefighter, "no car", "three years" or guilt.

---

## 6. Procedural build notes (per element)

General rules:
- Everything is in each channel's `ld` group and built in `installAnomalies(channels, SCRIPT)`, which is called from `createChannels(SCRIPT)` before `CameraFeeds.init()._precompile`.
- r170 `compile()` traverses **all** meshes (only lights use `traverseVisible`), so hidden anomaly objects are precompiled with no extra step.
- `setStage(k)` is **idempotent and absolute**: it computes the full LD state for stage *k* from scratch. Skip, reset and debug all use the same path.
- Each channel gets `stage`, `maxStage` and `meanScale` (the LD frame-mean multiplier vs stage 0; estimated values below, to be replaced by measurement, §9.3).

### 6.1 CAM-01 (camera [−3.5,5.0,2.5] → [0.6,−3.2,−40]; LD fog 0x6a6e72 / 0.095)

Build:
- **LD gantry**: copy of the HD gantry. `mesh(mergeList([boxG(9.6,0.25,0.3,0,5.1,-10), boxG(0.25,1.3,0.25,-4.6,4.45,-10), boxG(0.25,1.3,0.25,4.6,4.45,-10), boxG(0.9,0.9,0.3,±1.9,4.45,-10), boxG(3.0,0.9,0.25,0,5.75,-10.05)]), gantryM)`. Fogged normally, so it reads as a dim shape.
- **Signal faces**: 2 × `plane(0.78,0.78, TX.laneSignalTexture('arrow'), {pos:[±1.9,4.45,-9.84], basic:true, color:C(1.8,1.8,1.8)})`. They share **one** material `ldSigMat`, with `material.fog = false` set at build (LED emitters punch through fog).
- **Signal halos**: 2 × `glow(C(0.5,1.0,0.6),[1.8,1.8],[±1.9,4.45,-9.7],{opacity:0.45, fog:false})`.
- **VMS**: `plane(2.8,0.7, TX.vmsTexture(SCRIPT.feedSigns.vmsFog), {pos:[0,5.75,-9.91], basic:true, color:C(1.7,1.7,1.7)})`, with `fog=false` and material `ldVmsMat`.
- **Barricade lamps**: `glow(C(1,0.62,0.2),[1.6,1.6],[-2.4,1.2,-6.6],{opacity:0.6})` and `[1.6,1.2,-7.1]` (the HD lamp positions), hidden.
- In `Cam01`'s constructor, keep references `this.ldLampGlows` (tunnel lamp glows z > −40) and `this.ldPortalGlows` (the two z −95 glows).

| stage | state | meanScale (est.) |
|---|---|---|
| 0 | arrows; VMS fog text; halos green 0.45; lamps hidden; fog 0x6a6e72/0.095; bg same; portal and lamp glows at base opacity | 1.0 |
| 1 (m1b) | `ldSigMat.map = laneSignalTexture('x')`; `ldVmsMat.map = vmsTexture(vmsClosed)`; halos `C(1,0.25,0.15)`, opacity 0.35 (dimmer in B&W: luminance ≈ 0.24 vs 0.74) | 0.98 |
| 2 (m1c) | stage 1 + `fogs.LD.color.setHex(0x4e4d4b)`, `fogs.LD.density = 0.12`, `bg.LD.setHex(0x4e4d4b)` (mutate in place); portal glows × 0.35; lamp glows × 0.6; barricade lamps visible | 0.78 |

Also use `SCRIPT.feedSigns.vmsClosed` for the **HD** VMS (this removes the hard-coded `'隧道封閉'`).

Legibility fallback: scale the signal faces and the VMS ×1.35 if the contact sheet does not read.

### 6.2 CAM-02 (camera [−3.4,5.1,1.0] → [0.9,−3.4,−34]; LD fog 0x34383b / 0.024)

Build:
- Keep `this.ldLights` (the 3 PointLights; z −4 / −20 / −38) and `this.ldLampGlows` (with z).
- **Smoke band**: 14 sprites `SpriteMaterial({map: TX.smokeSprite(141), color:0x141414, transparent:true, opacity:0.55, depthWrite:false, fog:true})`, scale 6–9 × 3–4, at y 5.4–6.2, x ∈ [−3,3] (seeded rng 141), z from −72 to −6 in 5 m steps. `renderOrder = 5`, so they draw after the additive lamp glows and darken them. All hidden.
- **Far-lamp shells**: for each `tun.lamps` with `on>0 && z<-40`, a box that fully encloses the lit fixture (match buildTunnel's fixture dims, ≈ `boxG(0.3,0.13,1.24,…)`). Merged into one mesh, `std({color:0x1c1c1b})`, hidden.
- **Silhouettes**: `silhouetteOf(buildTanker({seed:3}))` at (0.6,0,−27.5) rotY 0.52; `silhouetteOf(buildTruckCab({seed:4}))` at (−3.2,0,−34.5) rot (0,1.25,0.06). These are the exact HD transforms. Hidden.
- `Cam02.update` (LD): multiply both blob opacities by `this.blobGain ?? 1`.

| stage | state | meanScale (est.) |
|---|---|---|
| 0 | all hidden; blobGain 1; ldLights[2] intensity 20 | 1.0 |
| 1 (m2b) | smoke sprites with z ≤ −40 visible | 0.97 |
| 2 (m2c) | + shells visible; lamp glows with z < −40 hidden; `ldLights[2].intensity = 8`; silhouettes visible | 0.88 |
| 3 (m2d) | stage 2 + smoke z ≤ −16 visible; blobGain 0.75 | 0.80 |
| 4 (m2e, T2) | smoke z ≤ −4; blobGain 0.6 | 0.72 |

### 6.3 CAM-03 (camera above the blast door, corridor to −Z)

- **`HOSE_PATH`**: move the HD hose control points out of `_buildHDDressing` into a module-level `export const HOSE_PATH = [[-1.6,-15.2],[-0.7,-14.4],[-0.1,-12.6],[0.45,-10.5],[0.2,-8.2],[-0.35,-6.0],[-0.1,-3.9],[0.3,-2.3],[0.15,-1.3],[-0.25,-0.9]]`. HD keeps using it unchanged.
- **Trail (wet streak, not a hose)**: a flat ribbon (2 triangles per segment) along `CatmullRomCurve3(HOSE_PATH at y 0.006).getSpacedPoints(160)`, ordered corner → door (z increasing). Width 0.14 (fallback 0.22). Material `MeshStandardMaterial({color:0x050505, roughness:0.15, metalness:0, transparent:true, opacity:0.75, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2})`; the glossy specular catches the IR spot and reads as wet. Placed in `ld`.
  - `reach(zTarget)`: `geometry.setDrawRange(0, 6·count)`, where `count` = number of spaced points with `z ≤ zTarget` (no rebuilds).
- **Hook**: wrap `Cam03.setFigurePose(i, sub)`. After the original call, **only if `i` changed**: `trail.reach(i >= 2 ? FIGURE_WAYPOINTS[i].z - 0.35 : null)` (`null` hides it). The trail therefore changes only when the figure steps, i.e. only in the blind spot.
- **Haze (m3a, T2)**: 6 sprites `smokeSprite`, colour 0x3a3a3a, opacity 0.22, scale 1.6–2.4, at y 2.3–2.6, z −14…−4, hidden. Stage 1: visible; `farLamp.intensity 1.4→0.9`; farFill `1.6→1.05` (keep a ref); far glow sprite opacity `0.7→0.45`. meanScale 0.9.

### 6.4 CAM-04 (camera [−1.6,4.7,−9.2] → [6.2,0.2,−19]; bayX 8.4, bayH 4.4)

- **props.js `buildSedan`**: when `doorOpen>0`, set `car.userData.parts = { hinge, dome /*PointLight or null*/, domeLampMat /*MeshBasicMaterial*/ }`.
- **Dome glow** (new, part of the **baseline**, for legibility): after `car.updateMatrixWorld(true)`, add `glow(C(1,0.9,0.7),[1.3,0.8], dome.getWorldPosition(), {opacity:0.45})` to `ld` (≈ 8×5 LD px of soft light).
- **Soot**: the HD planes, re-created in `ld`: `plane(9.5,4.4,TX.sootPlume(131),{pos:[8.388,2.2,-20],rot:[0,-π/2,0],decal:true,roughness:1})` and `plane(7.5,4.4,TX.sootPlume(132),{pos:[8.386,2.3,-15.2],…})`. Hidden.
- **Cones**: 3 × `cone(coneM, stripeM)` at the HD posts `[4.75,-11.2] [5.05,-16.6] [5.1,-22.4]`, `rotation.y = i·1.3`. Hidden.

| stage | state | meanScale (est.) |
|---|---|---|
| 0 | `hinge.rotation.y = −0.95`; `dome.intensity = 0.35`; `domeLampMat.color (1.5,1.3,1.0)`; dome glow visible; soot and cones hidden | 1.0 |
| 1 (m4b) | `hinge.rotation.y = −0.02`; `dome.intensity = 0` (intensity only); `domeLampMat.color (0.05,0.05,0.05)`; dome glow hidden | 0.98 |
| 2 (m4c) | stage 1 + soot + cones visible | 0.9 |

- **Freeze (m4d)**: CameraFeeds only. `feeds.setFrozenTime(4, SCRIPT.feedUI.frozenTime)` makes the CAM-04 OSD time read `02:14:08` and the REC dot target 0. The dot fades over ≈ 0.6 s via `_recK` damp; in practice it is already gone by the time the channel is switched in.

### 6.5 Room and audio
- **ControlRoom cam LEDs**: the blend in §3.2, using `reduce` from `update()` scope. Glow factor 0.45.
- **ControlRoom `setBlastLocked(locked, {duration=2.4})` → Promise**:
  - `tok = _token('blast')`;
  - wheel `w0 + dir·e·2.5π` over 0.7·duration (`inOut`), then bolts `b0 → (locked ? 0 : 0.12)` over 0.3·duration;
  - `_blastState`: `'locking'|'unlocking'` → `'locked'|'unlocked'`;
  - `duration ≤ 0` snaps;
  - getter `blastLocked`.
  - Lamp branch: `'unlocked'` → green 0.7; `'locking'|'unlocking'` → amber cosine 1.4 s (steady 0.6 with reduce); existing states unchanged. `reset()` stays as today (locked); `resetWorld` unlocks explicitly.
- **`sfx.vmdTone(v,t)`**:
  1. `lp = v.bq('lowpass',2400,0.7)`; `v.chain(lp, v.out)`;
  2. `click(v,lp,t,{f:1800,Q:1.2,peak:0.12,tc:0.003})`;
  3. `tone(v,lp,t+0.09,1046,0.05,0.035,{a:0.012})`;
  4. `tone(v,lp,t+0.25,784,0.045,0.045,{a:0.012})`;
  5. `v.send(v.out,'room',0.12)`; `return 0.8`.
  - Start value `SFX_GAIN.vmdTone = 0.10`; calibrate to ≤ −28 dBFS at the seat.
- **`sfx.doorKnock(v,t,o)`**:
  1. `pre = v.g(1)`; `v.chain(pre, v.bq('lowpass',520,0.7), v.conv('door'), v.g(DOOR_IR_GAIN), v.out)`;
  2. `knockSet(v,pre,t,{count:1, amp:0.7·(o.amp??1)})`;
  3. if `(o.count??3) > 1`: `knockSet(v,pre,t+0.3,{count:(o.count??3)−1, spacing:0.3, amp:o.amp??1})`;
  4. `v.send(v.out,'room',0.12)`; `return 2.2`.
  - Start value `SFX_GAIN.doorKnock = 0.06` (doorThud is 0.1); calibrate to ≤ −28 dBFS at the seat.
  - Add both to the `AudioEngine` header list.

---

## 7. Interfaces (freeze these first)

### 7.1 Channel (WP-A provides; WP-B consumes)
- `ch.stage`, `ch.maxStage` (1: 2, 2: 4, 3: 1, 4: 2), `ch.meanScale`, `ch.setStage(k)` (idempotent, absolute, clamps).
- `Cam03.setFigurePose(i, sub = false)` → `figure.setPose(i, sub)`; the trail updates on `i` change only.
- `createChannels(SCRIPT)`; `export const HOSE_PATH`; `props.silhouetteOf(group, color = 0x060606)`; `car.userData.parts`.
- `Figure.setPose(index, sub = false)`, `export const LD_SUBPOSE_MAX = 5`.

### 7.2 CameraFeeds (WP-B provides; WP-C consumes)
- `get shownChannel()`.
- `raiseAlert(n, { stamp } = {}) → stamp`. LD only. Records `{stamp, t0, obs}`, emits `feeds:alert {channel, stamp}`. It is not a no-op if already alerted: it refreshes the stamp.
- `alerts` (object n → record), `isAlerted(n)`, `alertLevel(n)` (smoothed 0..1), `clearAlerts()`.
- `setAnomalyStage(n, k, { force = false } = {}) → bool`.
  - **Guard:** refuse (warn, return false) when `mode==='LD'` and (n ≠ 3: `n === channel || n === _shownChannel`; n = 3: shown and `gaze.mainScreenObserved`), unless `force`.
  - Calls `channels[n].setStage(k)`; sets `_needRender` if shown.
- `anomalyStage(n)`.
- `setFrozenTime(n, text|null)`.
- `clockStamp()` → `HH:MM:SS` of the room clock (uses `minuteK`).
- `subPoses` (bool, default true), `figureSub`.
- Events: `feeds:alert`, `feeds:alertAck {channel}`, `feeds:figureMoved {index, sub}`.
- Ack runs inside `update()` right after `_blindSpot`.
- AGC: `_beginSwitch` uses `FEED_LUM[v][n] · ms(n)` for both sides, and `_meanOf('LD', n)` uses `FEED_MEAN.LD[n] · ms(n)`, where `ms(n) = channels[n].meanScale ?? 1` (LD only).
- `reset()`: all `setStage(0)`, `clearAlerts()`, frozen cleared, `figureSub = false`, `_tagShown = null`.
- `_beginMode(m !== 'LD')`: `clearAlerts()` and clear frozen.

### 7.3 ControlRoom, audio, script (WP-B and WP-C)
- `cr.setBlastLocked(locked, {duration}) → Promise`, `cr.blastLocked`.
- `audio.sfx('vmdTone', {position})`, `audio.sfx('doorKnock', {position, count, amp})`.
- `SCRIPT.feedUI.*`, `SCRIPT.feedSigns.*` and §5 keys. **WP-C lands `script.js` first.**

### 7.4 Director (WP-C, pure)
```js
new MonitoringDirector({ sense, io, pace = PACE, schedule = SCHEDULE, rng, spm, early = true })
onMinute(m, now); onBeatDone(m, now); canFlip(now) → bool; tick(dt, now);
onFigureMoved({index, sub}, now); onAlertAck({channel}, now); fastForward(start);
fire(id); forceFlip(); dump(); get trace
```
`sense()` returns:
```
{ held, inspectOpen, ventStopped, clockText, channel, shownChannel, observed(n), unobserved3, seenSinceMove,
  anyAlert, alerted(n), playerDoorDist }
```
`io` provides:
```
apply(ch, stage, {force}) → bool, freeze(ch), raise(ch, {stamp}) → stamp, clockStamp(), firstStamp(), tone(ch),
knock(count, amp), knocked(), log(kind, {ch, hhmm}), minuteK(k), hint(), trace(entry)
```
`io.log` kinds: `'motion'` and `'knock'`. MonitoringState formats them with `SCRIPT.status.*` and calls `pushLog`.

---

## 8. Comfort, performance and spoiler checks

| Element | Brightness / flashing | Sound | Jump-scare risk | reduceFlicker |
|---|---|---|---|---|
| Feed stages | Never on screen (director plus hard guard). Switching into a darkened stage uses AGC × meanScale, so the switch ramps like today (0.25 s roll + 2.0 s AGC, ≤ 30 % per 0.25 s; measured in §9.4). | – | Nothing new appears near any lens. The closest new objects are CAM-01 amber lamps at ≈ 9.6 m in fog, CAM-04 cones at ≈ 7 m, and the CAM-03 trail on the floor. | All static, no new animation. |
| Cam LEDs | 4.5 mm indicator with a glow sprite; 2.4 s cosine; fades in and out over ≈ 0.6 s; frame impact < 0.1 %. | – | none | steady 0.8 |
| OSD tag / alarm line | Small static text (< 2 % of the CRT). The tag changes only on switch, or on CAM-03 while unobserved. | – | none | same |
| CAM-04 freeze | OSD text plus the REC dot faded (≈ 0.6 s); applied off-screen; no glitch, no dropout. | – | none | same |
| vmdTone | – | ≤ −28 dBFS, LP 2.4 kHz, ≥ 12 ms attack, ≤ 2 per alert, none during ring, call or after 02:12. | Known console UI sound, not a stinger. | – |
| Knock | – | ≤ −28 dBFS, LP 520 Hz, door IR, first knock 0.7×. Never with the player ≤ 2.5 m from the door, during a call or during an inspect. Nothing layered on it. | Audio dislocation only (rule §3.5), soft and far. | – |
| Lock gate | Lamp colour lerp (exp −8·dt) on a small lamp. | Existing calibrated sfx (`lever`, `unlatch`, `pneumaticHiss` 0.5). | none | – |
| Sub-poses | Same discrete swap as existing advances, only while unobserved, never more lens-facing than base, none at 6 or 7. | – | Same level as the existing index swaps. | – |
| Performance | **No new lights anywhere**; intensity-only changes. Extra draw calls: CAM-01 ≈ 8, CAM-02 ≈ 18, CAM-03 ≈ 7, CAM-04 ≈ 8. Only the shown channel renders, at 10 fps. Hidden objects are precompiled by r170 `compile()`. Director, alert tick and LEDs cost is negligible. | | | |

**Spoiler check.** Each plant has a deniable Act-1 reading and a definite Act-3 reading.

| Plant | Act-1 reading (deniable) | Act-3 recognition |
|---|---|---|
| lock | "the note told me to" | 由內部反鎖 |
| 01:58 | "the driver walked off" | rescue team entered |
| car door shut | "the driver came back?" | no car |
| ✕ / 隧道封閉 vs 正常 | "glitchy sign" | 封閉 |
| knock while he is far | "the driver at the door?" | he was always at the door |
| warm steel | "hot room?" | fire behind it |
| smoke after the lever | "fog" | manual cut, 倒灌 |
| silhouettes | "an accident?" | pile-up and tanker fire |
| soot / cones | "old marks?" | police tape and soot |
| trail | "he's wet / dragging something" | hose |
| 02:14:08 | "DVR glitch" | watch, trip |

None of them states fire rescue, firefighter, "no car", "three years" or "you did it".

---

## 9. Acceptance tests

### 9.1 Node pacing simulation (no browser; safe on the saturated machine)
`node scripts/pacing-sim.mjs [--runs 200] [--persona all|eager|typical|starer|passive] [--table] [--seed N]` (WP-C).
- Imports the real `src/states/monitoringDirector.js` (zero imports) and `src/data/script.js` (intercom durations from `segments`).
- Fakes `sense` and `io`, and mirrors `_blindSpot` with GATE_LIMITS and sub-poses.
- Start from `pace-proto.mjs`.

Assertions (exit 1 on failure):
- typical p50 ∈ [250, 285] s; eager p10 ≥ 225 s; all personas finish ≤ 360 s;
- figure index 7 at blackout for every run;
- max idle (no gate, no task, no pending alert) outside [02:12 flip, end] ≤ 21 s for eager and typical;
- cued alerts on CAM-01/02/04 ∈ [7, 8] for eager and typical; CAM-03 alarms ≤ 4;
- no cue while held or within POST_HOLD; spacing between cued alerts ≥ MIN_GAP;
- fake `io.apply` never called for a shown channel (it throws);
- the knock fires in minute 5 for eager, typical and starer;
- `minuteK` is monotonic within each minute and never > 0.999;
- the protected minutes always last exactly SPM.

### 9.2 Browser timing harness at `?speed=N` (run only when the CPUs are free)
`node scripts/pacing-run.mjs [--html dist/blind-spot.html] [--speed 3] [--persona typical] [--runs 3]` (WP-B).
- **Setup:** Playwright with the `smoke-test.mjs` launch flags, viewport 960×540. URL `?debug=1&autostart=1&state=MONITORING&speed=N&pacelog=1&seed=K`.
- **Autopilot:** `page.evaluate` loop every 100 ms real time. Seated pose `{x:0,z:-1.6,yaw:0,pitch:0.03,seated:true}` (the CRT is observed).
  - On a new alert `n≠3`: after the react time, `BS.feeds.setChannel(n)`; after ack + look, `setChannel(3)`.
  - On a CAM-03 alert: `setChannel(3)`.
  - `flags.lockPending`: `BS.player.teleport({x:-3.1,z:-0.4,yaw:Math.PI/2,seated:false})`, wait for the walk time, `BS.bus.emit('blastDoor:lock')`, wait for `flags.blastLocked`, walk time, reseat.
  - `flags.intercomRinging`: teleport `{x:-3.2,z:-1.55,yaw:Math.PI/2}`, answer delay, `BS.bus.emit('intercom:answer')`, wait for `!intercomTalking`, walk, reseat.
  - `flags.ventFault`: teleport `{x:3.2,z:-1.6,yaw:-Math.PI/2}`, `BS.bus.emit('vent:restart')`, back.
  - Abort with a message if `BS.gaze.mainScreenObserved` is false while seated.
- **Measures (game time, `BS.clock.time`):** act length from the first frame in `STATE_MONITORING` to `STATE_BLACKOUT_CORRIDOR`; the longest stretch between consecutive "new cue/event" entries in `window.__paceLog` (kinds `alert`, `gate`, `knock`, `ventDying`, `vacuum`, `seenMove`, `callStart`), reported with and without the [ventStop, call 3] vacuum.
- **Assertions:**
  - act length ∈ [235, 300] s (typical);
  - the max gap excluding the vacuum ≤ 22 s;
  - ≥ 7 cued alerts;
  - no trace entry `apply` with `ch === shownChannel`;
  - `feeds.figureIndex === 7` before blackout;
  - zero console errors and page errors.
  - Print a per-minute table (copyable for the owner).

### 9.3 LD screenshots of each micro-event (WP-A, when the CPUs are free)
`node scripts/feed-stages.mjs [--html …]`
- For n ∈ 1..4 and k ∈ 0..maxStage (plus the CAM-04 freeze and the CAM-03 trail at indices 2/4/6):
  1. load `?debug=1&autostart=1&state=MONITORING&pace=0`;
  2. `BS.feeds.setChannel(n)`, then `BS.feeds.setAnomalyStage(n,k,{force:true})`;
  3. wait 2.5 s of game time (AGC settle);
  4. save (a) the seated in-room view at 800×450 (like `base_800.png`) as `test-output/feeds/cam{n}_s{k}_room.png`, and (b) `BS.feeds.debugBlit(BS.renderer)` at 960×720 as `_crt.png`.
- Build `test-output/feeds/sheet.html` (stage 0 beside each stage) and screenshot it to `sheet.png`.
- Compute the CRT-region mean per stage in-page (draw the PNG to a canvas, `getImageData`) and print `mean(k)/mean(0)` next to `meanScale(k)`; update the `meanScale` constants to the measured values.
- **Pass:**
  - for every cued stage, a reviewer can name the change from the 800 px room view;
  - `|measured − meanScale| < 0.05`;
  - the trail is visible, and reads as a streak rather than a hose, at indices 4–6.

### 9.4 Comfort probes (verifier, when the CPUs are free)
- **Switch luminance:** for each darkened stage, sample the CRT-region frame mean every frame across `setChannel(3→n→3)`. Max change per 0.25 s ≤ 30 % (reuse the `/tmp/review-comfort/agc.js` approach).
- **LED:** with `reduceFlicker` on, the amber LED stays constant over 3 s; with it off, the period is 2.4 s and the lamp ramps ≥ 0.4 s.
- **Audio:** the `vmdTone` and `doorKnock` peaks at the seated listener are ≤ −28 dBFS (reuse `/tmp/review-comfort/audio.js`). During a full autopilot act nothing exceeds −10 dBFS.
- **Hitch:** the frame time on the first view of each stage is ≤ 50 ms above baseline (the `/tmp/review-comfort/hitch.js` pattern).

### 9.5 Owner play-test
Play once with defaults and once with `?pace=0` (today's build). Questions:
1. Did you always have something to look at or do?
2. Did anything change while you were watching it? (It must be "no".)
3. Did the knock land while he was far away on CAM-03?
4. In Act 3, which details did you recognise (01:58, car door, ✕ sign, smoke, tanker shape, soot, 02:14:08, the lock, 02:05)?
5. Did any moment feel like a jump scare?

Paste the `?pacelog=1` summary table.

---

## 10. Debug hooks and URL flags

**URL flags:**
- `?pace=0`: today's build (no director, no light clock, no lock gate, no knock, no sub-poses).
- `?lock=0`: no lock gate (the door starts locked).
- `?subposes=0`
- `?spm=N`: SPM = N, with DWELL_MIN scaled by N/17.
- `?pacelog=1`: one console line per flip, `[pace] 02:05 +98.6s dur=22.3 pend=[] cues=4`, plus a summary table at blackout.
- `?seed=N`: director rng.
- Existing: `?debug=1`, `?state=MONITORING`, `?clock=02:MM` (runs fastForward), `?speed=N`.

**Hooks** (`?debug=1`, `window.BS = ctx`):
- `BS.director` (alias set by MonitoringState while active):
  - `.dump()` → `{minute, e, k, rush, held, holdUntil, lastMark, lastCueAt, next, fired, alerts}`;
  - `.fire('m2c')`; `.forceFlip()`; `.trace`.
- `window.__paceLog`: an array of `{t, minute, kind, ch, id, cue, stamp}`; every director trace is pushed here.
- `BS.feeds`:
  - `.setAnomalyStage(n,k,{force:true})`, `.anomalyStage(n)`;
  - `.raiseAlert(n)`, `.alerts`, `.alertLevel(n)`, `.clearAlerts()`;
  - `.setFrozenTime(4,'02:14:08')`;
  - `.subPoses = false`, `.figureSub`, `.shownChannel`.
- `BS.controlRoom.setBlastLocked(true|false,{duration})`
- `BS.audio.sfx('vmdTone')`, `BS.audio.sfx('doorKnock',{count:3})`

---

## 11. Work packages

All three start from the merged main. Phase 0 (all, 15 min): read this spec and freeze §7. WP-C commits the `script.js` additions first. Merge order: **A and B** (inert without the director: stages stay 0, no alerts), then **C** (wires everything). Then run §9.1 (anyone), §9.2–9.4 (verifier, CPUs free). Each package flags any shared-file touch in its hand-off.

### WP-A: Feed content (≈ 330 LOC + script)
**Owns:** `src/world/feeds/anomalies.js` (new), `src/world/feeds/channels.js`, `src/world/feeds/props.js`, `src/world/Figure.js`, `scripts/feed-stages.mjs` (new).
1. `channels.js`:
   - `export const HOSE_PATH`; the HD hose uses it;
   - keep refs (`Cam01.ldLampGlows/ldPortalGlows`, `Cam02.ldLights/ldLampGlows`, `Cam03.farFill/farGlow`);
   - `Cam02.update` uses `blobGain`;
   - the HD VMS uses `SCRIPT.feedSigns.vmsClosed`;
   - `createChannels(SCRIPT)` calls `installAnomalies(chs, SCRIPT)`;
   - `Cam03.setFigurePose(i, sub=false)`.
2. `props.js`: `car.userData.parts`; `export function silhouetteOf(group, color)` with one shared `MeshBasicMaterial({color, fog:true})`.
3. `anomalies.js`: §6.1–6.4 builds and `setStage` tables; per-channel `stage`, `maxStage`, `meanScale`; the CAM-03 trail with the wrapper on index change.
4. `Figure.js`: `LD_SUBPOSES` (§3.4) and `setPose(index, sub=false)`, merging overrides over the base pose. LD only, no animation.
5. Self-check via `BS.feeds.channels[n].setStage(k)` in a dev build. Run `feed-stages.mjs` when the CPUs are free; replace the `meanScale` estimates with the measurements.

**Done when:** every stage renders as specified; the contact sheet passes §9.3; there are no new lights; the HD views are unchanged.

### WP-B: Alert plumbing, OSD, room hardware, audio, browser harness (≈ 300 LOC + harness)
**Owns:** `src/world/CameraFeeds.js`, `src/world/feeds/OSD.js`, `src/world/ControlRoom.js`, `src/audio/sfx.js`, `src/audio/AudioEngine.js`, `scripts/pacing-run.mjs` (new).
1. `CameraFeeds`:
   - pass `ctx.SCRIPT` to `createChannels`;
   - add the §7.2 API (alerts, ack in `update`, `alertLevel` damp, `shownChannel`, `setAnomalyStage` with the guard, `setFrozenTime`, `clockStamp`);
   - `_timestamp` uses `minuteK`;
   - `_updateOSD` gains `tag`, `alarm`, `recOff` and frozen `time`;
   - `_tagShown` latch in `_beginSwitch` (plus CAM-03 while unobserved);
   - AGC × meanScale in `_beginSwitch` and `_meanOf`;
   - sub-pose branch in `_blindSpot`; `_applyFigure` passes `figureSub`; track `_shownSub`;
   - `_recK` fade on `uRec.w`;
   - `reset()` and `_beginMode()` clearing.
2. `OSD.draw`:
   - `state.tag` → `shadowText(tag, mx, my+30, {size:19, font:FONTS.ui, weight:''})`;
   - `state.alarm` → `shadowText(alarm, W-mx, my+58, {size:18, align:'right', weight:''})`;
   - `state.recOff` → `this.rec.on = false` (keep u, v, r). All of these are included in the JSON key.
3. `ControlRoom`: the cam LED blend (§3.2); `setBlastLocked` and the `blastLocked` getter; lamp states `unlocked`, `locking` and `unlocking`.
4. `sfx.js` and `AudioEngine.js`: `vmdTone`, `doorKnock`, SFX_GAIN entries, header docs.
5. `scripts/pacing-run.mjs` (§9.2). Calibrate the SFX gains with the audio probe when the CPUs are free.

**Done when:** `BS.feeds.raiseAlert(4)` lights the amber LED, draws the alarm line on CAM-03, and the tag on CAM-04 after switching; it acks after 1 s; the guard refuses on-screen stage changes; switching luminance passes §9.4; `setBlastLocked` animates and the ending still opens the door.

### WP-C: Director, clock, state wiring, copy, docs, node sim (≈ 520 LOC + sim)
**Owns:** `src/states/monitoringDirector.js` (new), `src/states/MonitoringState.js`, `src/states/common.js`, `src/data/script.js`, `scripts/pacing-sim.mjs` (new), `docs/DESIGN-NOTES.md`, `docs/ARCHITECTURE.md`.
1. `script.js`: the §5 additions and the two corrections. **Commit this first.**
2. `monitoringDirector.js`: `PACE`, `SCHEDULE` and `MonitoringDirector` per §4 and §7.4. Zero imports; seeded rng (mulberry32) passed in.
3. `MonitoringState.js`:
   - flags `paceOn`, `lockOn`, `subposes` from params; `feeds.subPoses = …`;
   - build `sense()` and `io` (formats copy, calls `pushLog`, `audio.sfx`, `ui.hint`, `__paceLog`, `?pacelog`); `ctx.director` alias in debug;
   - `run()` per §4;
   - `beat(0)` lock gate and `onLock()` (§3.5);
   - `onVentRestart` pushes `ventManualLog`; `onBeatDone(5)` anchors the knock;
   - `applySkipped(start)`: lock with duration 0 and `director.fastForward(start)`;
   - bus hooks (`feeds:figureMoved`, `feeds:alertAck`, `blastDoor:lock`);
   - `StoryState.nag()` has a single `_nagTok`, so a new nag silently cancels the previous one. Use `nag()` **only** for the lock gate (it ends before any other nag starts). The director's motion hint is a one-shot through `io.hint()` guarded by `flags.motionHintShown`, never `nag()`;
   - `tick` → `director.tick(dt, now)`;
   - `exit()`: `director = null`, `flags.minuteK = null`, `clearAlerts` unless going to BLACKOUT, delete the `ctx.director` alias;
   - update the header beat table.
4. `common.js`:
   - `resetFlags`: add `blastLocked, lockPending, blastLocking, doorKnocked, logExtra: [], minuteK: null, motionHintShown`;
   - `points()`: add `camButtons`;
   - `export pushLog(ctx, text, at)`;
   - `setLeftLog`: merge static and dynamic lines, stable-sorted by HH:MM (static first within the same minute), last 8, content-based cache key;
   - a `paceFlags(ctx)` helper;
   - `resetWorld`: unlock plus `normalUnlocked` when lock is on;
   - `lateMonitoringWorld` / `restoredWorld`: lock;
   - interactables: the `blastDoor` lock/inspect variants (keep `!endingStarted`), the cam-button label function, and the T2 coffee line.
   - Do **not** touch `playIntercom` (owned by the fix pass).
5. `scripts/pacing-sim.mjs` (§9.1); start from `pace-proto.mjs`.
6. Docs:
   - ARCHITECTURE §5: new events. §8: MONITORING table with the 02:00 lock gate, the light clock, the director and the 02:05 knock; §8 REVELATION text `02:05`.
   - DESIGN-NOTES: new **A5** (VMD, blind-spot purity, HD-twin rule, light clock, sub-poses); an A3 addendum (02:00 gate; limits unchanged); a B3 fix (02:05).

**Done when:** the §9.1 sim passes; `?pace=0` reproduces today's flow; `?clock=02:09` starts with all earlier stages, locks and log lines in place; the build passes; a grep finds no hard-coded CJK strings in the new code.

---

## 12. Cut list (ship any prefix)
- **Tier 0** (fixes the complaint on its own): VMD system and director; light clock; CAM-03 alarm; m4a, m1b, m4b, m2b, m2d; the knock; the copy.
- **Tier 1:** D0 lock gate; sub-poses; m4c; m2c; m1c; the m4d freeze; the CAM-03 trail; `ventManualLog`; the 02:05 retime.
- **Tier 2:** m3a haze; m2e; the coffee line; `?pacelog` summary table.
- **Deferred** (ideas noted, not in this pass): the taped 主車道 fire-zone lamp; moving the vent gate to 02:11.

---

## 13. Open questions for the owner (default in brackets)
1. **The 02:00 lock gate** [on; `?lock=0` to disable]. It changes the first minute and the loop's start state.
2. **The Act-3 timestamp correction 02:11 → 02:05** [applied; 2 characters to revert]. Moving the vent lever itself to 02:11 was rejected for this pass.
3. **Sub-poses** [on, subtle; `?subposes=0`]. Is CAM-03 change frequency right, or too much?
4. **Act length** [≈ 4:25 typical in the sim; ≈ 4:52 in the browser autopilot once the look-down to press a CAM button is modelled, vs 5:04 for `?pace=0` — see DESIGN-NOTES E7]. Use `DWELL_MIN` to trade length for breathing room.
5. **The `01:58:41` stamp** on the first CAM-04 alert and the cross-channel `▲ CAM-0n` OSD line on the watched screen [both on]. Does either feel too "UI"?
