# 《盲區交接》監看段落節奏重構提案 — Pacing Architecture

> **中文摘要**：目前 02:00→02:14 的監看段落大約 4 分 48 秒，其中約 3 分 41 秒（77%）玩家什麼都不用做，
> 而且四個頻道裡有三個是「看一次就沒事」的靜態畫面。本提案把時鐘從「固定秒數」改成**注意力驅動**：
> 有事待查就等你，查完了就往前走；每一分鐘都安排一個小事件（監視系統的「移動偵測」警示把你從 CAM-03 拉走，
> 他就在你移開視線時前進），並把 02:05 的敲門、02:11 的通風操作對齊日誌與事故調查摘要。
> 目標：一般玩家約 **4 分 20 秒**、任何時刻不會超過約 **24 秒**沒有東西可看或可做。

Scope: `STATE_MONITORING` (02:00 → 02:14) and its hand-off from `STATE_PROLOGUE`. Everything below is grounded in the
current source (`MonitoringState.js`, `common.js`, `CameraFeeds.js`, `channels.js`, `props.js`, `ControlRoom.js`,
`GazeSystem.js`, `audio/*`, `script.js`). Nothing in the repo was modified.

---

## 1. Diagnosis

### 1.1 The current timeline, measured from the code

Constants: `CLOCK.secondsPerMinute = 17`; `run()` does `wait(17)` **after** each beat completes, so gate durations are
*added* to the 17 s, never absorbed by them. Intercom lengths are the sums of `segments[].dur` plus `hold`:
stage 0 = 2.2+3.6+3.0+3.6 = **12.4 s** (+1.5 hold), stage 1 = 2.6+3.4+2.6+2.4 = **11.0 s** (+1.5), stage 2 =
2.4+3.0+1.6+3.2 = **10.2 s** (+1.0). The `Promise.race([done, wait(2)])` in `playIntercom` is already resolved when reached
(both started together), so it adds 0 s. `onVentRestart` takes 0.55+0.22 s lever tween + 0.6 s = ~1.4 s. `nag()` defaults:
first hint after **40 s**, then every **55 s**.

Prologue hand-off (`PrologueState`): 1.0 s black → 0.9 → 0.7 (CRT on) → 2.4 → 3.6 s sit-up = control at **8.6 s**; then
until the sticky note is read and closed (no hint at all until the 50 s timeout) → +1.2 s → MONITORING, which starts at
**02:00 again**. The wall clock therefore reads 02:00 for prologue (~30 s typical, ~59 s worst) **plus** 51 s.

Typical player (hears a ring and answers in ~7 s; reaches the vent panel in ~8 s):

| Clock | t (s) | What happens | Player must… | Dead time after it |
|---|---|---|---|---|
| 02:00 | 0 | (nothing new; prologue already sat on 02:00 for ~30 s) | – | **51 s** |
| 02:03 | 51 | ring → answer (~7 s) → call 13.9 s | answer | **34 s** (wait 17 ×2) |
| 02:05 | 106 | vent fault → walk + pull (~8 s) | pull lever | **51 s** |
| 02:08 | 165 | ring → answer → call 12.5 s | answer | **85 s** (02:10 vent dying + 02:12 vacuum are automatic) |
| 02:13 | 270 | ring → answer → call 11.2 s → BLACKOUT | answer | – |
| end | **≈ 288 s (4:48)** | | 4 actions, ~29 s of doing, ~38 s of listening | **221 s ≈ 3:41 (77 %)** |

### 1.2 Why the middle feels dead (root causes)

1. **The clock is time-driven, not attention-driven.** It advances every 17 s regardless of whether the player has anything
   left to look at, and gates only *lengthen* minutes. Nothing ever shortens a minute.
2. **Three of four channels have no state.** `Cam01/Cam02/Cam04` LD scenes are static (only `Cam02.update` animates the heat
   blob ±8 %). After the first sweep (~20 s) there is no reason to press CAM-01/02/04 again — exactly the owner's complaint.
3. **CAM-03 saturates.** Each gate window allows 1–2 figure steps (`GATE_LIMITS` `{0,2}`, `{1,3}`, `{2,4}`, `{4,5}`).
   A player who flips channels reaches `max` within ~10 s; for the remaining 40–75 s of the window the figure is capped and
   *every* screen is frozen. A player who stares at CAM-03 sees nothing at all until a gate forces them to turn.
4. **No cue system.** Even if something changed on another channel, the player would have no way to know. The SYS LOG
   only gains a line at gate minutes (`logLines` has 6 entries).
5. **Action spacing is lopsided:** 02:03, 02:05, 02:08, then a 5-minute stretch to 02:13 with zero required input.
6. **Story timing drift (bonus):** the vent is pulled at 02:05, but the Act-3 right screen says
   `主排風 手動切斷（02:11 操作員）` and the incident report says `02:11 主排風遭控制室內手動切斷`; meanwhile the logbook says
   `02:05 有人在敲防爆門` and the report `02:05 救援隊員抵達中央控制室防爆門外` — but nothing knocks at 02:05 in Act 1.
   The two strongest "you were there" plants are misaligned by six minutes.

---

## 2. Design

### 2.1 Principles

* **The system pulls you away; he moves.** A diegetic CCTV *video-motion-detection* (VMD / 移動偵測) alarm announces one
  change per minute on another channel. Checking it takes the player off CAM-03 — which is precisely when the figure is
  allowed to advance (seen ≥ 0.8 s → unseen ≥ 0.5 s). Coming back, he is closer. Cycle length ≈ 15 s.
* **Attention-driven clock.** A minute ends when (a) its minimum dwell has passed **and** nothing is pending **and** the
  player has had ≥ 4 s of calm since the last thing happened — or (b) its maximum dwell is reached. Reading/inspecting and
  intercom calls freeze the minute. Fast players are never made to wait; slow players are never rushed.
* **Announce some, hide some.** One announced cue per minute (tone + amber LED + OSD tag + log line) guarantees a floor of
  activity; one or two *unannounced* details reward players who sweep (frozen timestamp, a hose on the floor, a double
  exposure). This keeps it from turning into a checklist.
* **Every beat is a plant.** Each change foreshadows a specific Act-3 reveal (white car never existed / the fire and
  pile-up / zero visibility & tunnel closed / the figure is a firefighter / the operator cut the vent) without stating it.
* **CAM-03 stays sacred.** No new behaviour while CAM-03 is observed. The new CAM-03 VMD alarm only *reports* moves that
  already happened under the existing rule.
* **Content-agnostic architecture.** The beat table is data (`BEATS`), the cues are a dispatch map. Other proposals'
  content can be slotted into any minute without touching the clock logic.

### 2.2 The adaptive clock (formal)

Per minute `m` the table gives either a dwell window `[dMin, dMax]` (normal minute) or a gate plus a post-gate window.

```
elapsed e      += dt  unless HOLD           HOLD = inspect.isOpen ∨ intercomRinging ∨ intercomTalking ∨ ventRestarting
                                                 (∨ looking at a side screen ≤ 12°, optional "reading" hold)
pending P      = unacknowledged alerts (any channel)   — an alert is acked by viewing that channel on the main CRT ≥ 1.2 s
quietAt        = e at the last {cue fired, alert acked, figure moved, call ended}
canFlip        = ¬gateOpen ∧ ( e ≥ dMax  ∨  (P = ∅ ∧ e ≥ dMin ∧ e − quietAt ≥ PACE.calm) )
```

`PACE.calm = 4 s` (a breath after the last thing, so a minute never flips the instant you ack). Gates (`intercom`, `vent`)
hold the clock exactly as today; after the gate completes, the post-window `[pMin, pMax]` applies with the same rule.
At `dMax` the minute flips even with alerts pending (they carry over; nothing can deadlock except the two story gates, which
have nags). `PACE.scale` multiplies every window (URL `?pace=`), so the whole act can be stretched/shrunk with one knob.

**OSD seconds.** `CameraFeeds._timestamp` currently derives seconds from `secondsPerMinute`. With variable minutes it would
freeze at :59 or jump backwards. New rule: MonitoringState publishes `ctx.flags.clockSec`, computed as
`60·e / planned` where `planned = dMax` while something is pending, else `max(dMin, quietAt + calm)`; the displayed value is
**monotonic** (never decreases) and catches up at ≤ 8 s/s, resets to 0 on flip, and runs at the nominal 60/17 s/s during a
held gate (clamping at :59, as today). `CLOCK.secondsPerMinute` stays as the fallback for other states.

### 2.3 Target length

| Persona (model) | Monitoring act | Max gap without a cue/action | vs. today |
|---|---|---|---|
| Fast (acks in ~5 s, answers in 4 s) | **≈ 3:45** | ≈ 10 s | today ≈ 4:35, gap 85 s |
| **Typical** (acks ~8 s, lingers 3 s, answers 6 s) | **≈ 4:20** | ≈ 14 s | today ≈ 4:48, gap 85 s |
| Explorer (lingers 8 s, inspects things) | ≈ 5:45 | ≈ 18 s | today ≈ 4:55 (inspecting does not pause today's clock) |
| CRT-starer (never presses a CAM button) | ≈ 5:35 | 24 s (a cue every minute) | today ≈ 4:48 |
| Near-AFK (answers only after nags) | ≈ 6:05 | 24 s + nags at 18/30 s | today ≈ 7:00 (nags at 40/55 s) |

I deliberately target **4:20 typical (window 3:45–6:30)** rather than 6–8 min: today's act is already 4:48 and the owner
calls it slow; the cure is density, not length. Act 1 should be ≈ 30 % of a ~15-minute game. If after play-testing the act
feels rushed, raise `PACE.scale` to 1.25 (≈ 5:10 typical; max gap ≈ 30 s) — do **not** add dwell without adding beats.

### 2.4 Two structural moves (recommended)

1. **Knock at 02:05.** The firefighter's knock on the blast door, heard while CAM-03 shows him ~10 m away. Realises the
   logbook line `02:05 有人在敲防爆門` and the report line `02:05 救援隊員抵達…防爆門外`, and plants the B2 reading
   ("he was always at the door") through audio dislocation — the golden rules' own fear source.
2. **Move the vent gate from 02:05 to 02:11.** The player's last act before the blackout becomes the act that kills them both,
   at the exact minute the Act-3 screens accuse (`手動切斷（02:11 操作員）`). Causality is audible: "重啟" → the fan spins
   up, sags and dies within ~15 s → 02:12 vacuum. It also fixes action spacing: 02:03 / (02:05 optional) / 02:08 / 02:11 /
   02:13 instead of 02:03 / 02:05 / 02:08 / — / 02:13.

*Fallback if the owner wants the vent kept at 02:05 (Option A):* keep `ventGate` at m = 5, move the knock to 02:06
(log `02:06 防爆門 震動感測`), keep 02:10 `ventDying(40 s→dwell)` as today, and use 02:09/02:11 as plain channel minutes
(hose at 02:09, lamps at 02:11). Everything else in this proposal is unchanged.

### 2.5 Minute-by-minute (recommended version)

`t` = expected wall-clock seconds from MONITORING start for the **typical** persona. "Cue" = how the player knows.
"VMD cue" means: soft two-note console tone (`vmdTone`), the channel's CAM-button LED pulses amber (cosine, 1.6 s),
main-CRT OSD tag `▲ CAM-0n …` under the timestamp, and a SYS LOG line. Figure limits are applied at the minute flip;
gate rows show *ring → while answering*.

| Clock | t | Dwell | What happens / changes | Cue | Player does | Figure {min,max} | Story purpose / foreshadows |
|---|---|---|---|---|---|---|---|
| **02:00** | 0 | [8, 12] | Note just closed (prologue already held 02:00 ~30 s). SYS LOG `02:00 值班交接完成`. | objective 監看各頻道 | settle, first look | {0,1} | Baseline: all LD labels say 正常. |
| **02:01** | ~10 | [14, 24] | CAM-04 VMD. **Nothing visibly changed** — car, open door, dome light, exactly as the note says. | VMD cue (CAM-04) | learns the CAM buttons; looks at the white car; returns → he may have taken his first step | {0,1} | Reinforces the false story ("the driver just walked off"); establishes the CAM-04 baseline the 02:07 beat will break. Doubles as the button tutorial. |
| **02:02** | ~26 | [14, 24] | CAM-02: the heat blob swells (×1.3 size, +12 % opacity) over **8 s**, a second smaller blob fades in nearer (z −42). Ramp starts at the cue, so the player arrives mid-swell. | VMD cue `熱源讀值上升` | watches it grow | {1,2} | "熱源殘留" is not residue — something is burning and spreading (HD CAM-02: fire, pile-up). |
| **02:03** GATE | ~42 | post [8, 18] | Intercom 1 (stage 0). Ring 1.5 s after the flip. During the call he is forced to index 2; the CAM-03 VMD raised during the call is **silent** and its tone plays once when the call ends. | ring + amber intercom LED; nag at 18 s / 30 s; after call: CAM-03 VMD | walk to west wall (back to CRT), answer, listen; walk back → he is closer | ring {1,2} → answer {2,2} | First contact; SCBA breathing reads as "monster". Post-call re-entry beat replaces 34 s of nothing. |
| **02:04** | ~73 | [14, 24] | CAM-01: a lane-control signal on an LD gantry changes ↓ → ✕ (1 s crossfade, applied in the blind spot). The OSD label still says `狀態：正常`. | VMD cue `車道號誌變更`; log `北口車道號誌 切換：封閉` | checks CAM-01 | {2,3} | The tunnel has been closed by someone outside; the OSD "lies" (HD CAM-01 `狀態：封閉`). |
| **02:05** | ~89 | [14, 22] | **Knock**: 3 soft gloved knocks on the blast door, +2 more after 2.5 s. Triggered at the first moment ≥ 3 s into the minute when the player has watched CAM-03 for ≥ 1 s (figure ≈ 10 m away on screen), else at +10 s. Log line 1 s later. Blast-door inspect gains a 2nd paragraph `鋼板摸起來是溫的。` | HRTF audio from behind-left; log `02:05 防爆門 震動感測` | optional: walk to the door and inspect (back to CRT → he steps) | {2,3} | Audio dislocation (he is far on screen *and* at the door) → "he was always at the door"; warm steel = fire behind it; realises logbook 02:05 and report 02:05. |
| **02:06** | ~106 | [14, 24] | CAM-02: grey smoke starts rolling along the tunnel crown toward the camera (opacity ramp 15 s). | VMD cue (CAM-02) | checks CAM-02 | {3,4} | Smoke is moving north, toward the control room (濃煙倒灌). |
| **02:07** | ~122 | [14, 24] | CAM-04: the driver door is now **closed**, dome light off (blind-spot swap), and a faint **double exposure** — police tape across the bay and soot on the wall — fades in to ≤ 25 % over the car (4 s). | VMD cue `影像訊號異常` | checks CAM-04 — and remembers the door was open at 02:01 | {3,4} | Doubt about the note: who closed the door? The car sits on top of a truer image (HD CAM-04: no car, tape, soot). |
| **02:08** GATE | ~138 | post [8, 18] | Intercom 2 (stage 1, knocks in the call). Same post-call CAM-03 re-entry beat. | ring, nag | answer | ring {3,4} → answer {4,4} | "控制室的燈亮著……別鎖" — urgency. |
| **02:09** | ~167 | [14, 22] | Vent starts to labour (`AMB.ventLabor`, 6 s ramp; gauge jitters). Right screen `通風：轉速不穩`. **Unannounced:** on CAM-03 a pale line — a hose — now trails along the floor from the far corner to just behind him (revealed only when he moves). Vent inspect text changes. | audible detune; log `主排風 轉速不穩`; right screen | optional: inspect vent panel | {4,5} | The "figure" drags a hose (firefighter). Sets up 02:11. |
| **02:10** | ~182 | [14, 24] | CAM-02: tunnel lamps die one by one **far → near** (5 lamps, 1.2 s fades, 2 s stagger; nearest two survive). **Unannounced:** CAM-01 fog thickens and darkens into smoke (12 s); CAM-04 timestamp freezes at **02:14:08**, REC dot fades out. Right screen `供電：電壓不穩`. | VMD cue (CAM-02); log `中段照明 迴路異常` | watches the dark advance (a 10 s "watch it happen" beat), sweeps | {4,5} | Darkness approaching; mid-section power failing (02:14 relay trip); CAM-01 → 0 % visibility; CAM-04 is a frozen recording stuck at the second the watch in Act 2 will show. |
| **02:11** GATE | ~200 | post fixed 14 | Vent fault: overspeed ▲ (`AMB.ventFault`), amber vent LED, objective `重啟通風系統` (nag 15/30 s). Pull → `fanSpinUp`, a 1.6 s recovery, then it sags for 12 s (`AMB.ventDying`, gauge .62 → .20). Log `02:11 主排風 手動操作`; right screen `通風：手動操作中`. | overspeed whine; amber LED (east wall); objective | walk to the east wall (back to CRT), pull | {5,5} (forced while walking) | **The act.** The player's own hand at 02:11 kills the fan → Act 3 `主排風 手動切斷（02:11 操作員）` and the report line `02:11 主排風遭控制室內手動切斷`. |
| **02:12** | ~224 | [14, 18] | Fan stops (`fanSpinDown`, 4 s), auditory vacuum (`setSilence(.6, 6)`), heartbeat fades in (5 s). Log `主排風 停止`. **No other cue** — deliberate silence. | absence of sound; heartbeat | looks at CAM-03; heartbeat rate follows his index | {5,6} | Dread peak; the room can no longer breathe. |
| **02:13** GATE | ~240 | final | Intercom 3 (stage 2); while answering he arrives at the door. → BLACKOUT_CORRIDOR. | ring | answer | ring {6,7} → answer {7,7} | "我要破門了" — coherent with the figure at the door (A3). |
| end | **≈ 258 s (4:18)** | | | | | | |

**Tension curve.** 02:00–02:02 *quiet/curious* (the system works, small changes, false narrative reinforced) → 02:03
first contact → 02:04–02:07 *unease* (closures, the knock, smoke, the car is wrong) → 02:08 urgency → 02:09–02:10
*dread build* (the world's windows close: vent labours, lights die, CAM-01 blinded, CAM-04 frozen) → 02:11 the player's
act → 02:12 vacuum + heartbeat (stillness) → 02:13 call → blackout.

**Beat budget rules** (enforced by the table, check in review): ≤ 1 announced cue per minute; no announced cue inside a
gate minute; no two announced cues < 10 s apart; tones are suppressed while ringing/talking and played once afterwards.

### 2.6 The CAM-03 alarm (re-entry loop)

On `feeds:figureMoved` while the player is not viewing CAM-03, schedule a CAM-03 VMD alarm after a **3–6 s latency**.
At that time: if `feeds.seenSinceMove` is already true (the player came back and saw him), cancel; otherwise raise it
(`▲ CAM-03 移動偵測`, log via `vmdLine`, max one CAM-03 log line per minute). This:

* catches players who linger elsewhere and sends them back, so each minute ends with the player having *seen* his latest
  position (which re-arms `seenSinceMove` for the next see → unsee step);
* is never instantaneous, so it does not become a mechanical "you just looked away" tell;
* contradicts CAM-03's own original OSD label `偵測到靜態人形物體` — the system calls him static *and* reports motion.

### 2.7 Figure limits and how they pace the approach

| Minutes | {min,max} | Waypoint z (m from door) | Notes |
|---|---|---|---|
| 02:00–01 | {0,1} | 15.6 → 12.7 | First step possible from 02:00 on (one per see→unsee). |
| 02:02 | {1,2} | → 10.0 | `min 1`: anyone who has looked away at all has seen him take a step. |
| 02:03 ring / answer | {1,2} / {2,2} | 10.0 | Forced during the call (min-forced steps need only 0.5 s unseen). |
| 02:04–05 | {2,3} | → 7.6 | The 02:05 knock happens while he is 7.6–10 m away on screen. |
| 02:06–07 | {3,4} | → 5.6 | |
| 02:08 ring / answer | {3,4} / {4,4} | 5.6 | |
| 02:09–10 | {4,5} | → 3.9 | Hose reveal tracks him. |
| 02:11 | {5,5} | 3.9 | Forced while the player walks to the vent. |
| 02:12 | {5,6} | → 2.65 | Heartbeat 70 → 73 bpm. |
| 02:13 ring / answer | {6,7} / {7,7} | → 1.32 (door) | Heartbeat 76 bpm. |

Compared with today, max grows by ~1 every 2 minutes instead of jumping per gate, so the approach is spread over the whole
act instead of saturating early. A player who *never* watches CAM-03 still sees a steady approach via the `min` schedule.

### 2.8 Vent-dying and heartbeat adaptation

* **Vent dying** is no longer a free-running 40 s auto beat at 02:10. It starts at the lever pull and is tied to the fixed
  14 s post-window of 02:11: `fanSpinUp` + `setVent({level .42, rate 1.08, detune .08}, 1.2)`, after 1.6 s
  `setVent(AMB.ventDying, 12)` and the gauge tween `lerp(.62, .20, k)` over the same 12 s (`this._dying = {t0, dur}`).
  At the 02:12 flip the existing `ventStop()` ramps level → 0 over 4 s. Total audible decline ≈ 16 s (today: 34 s of a
  40 s ramp, cut off by `ventStop`).
* **Pre-fault labour** (02:09): `AMB.ventLabor = { level: .40, rate: .92, detune: .18 }`, 6 s ramp; gauge auto-jitter.
* **Heartbeat** starts at 02:12 as today (`setHeartbeat(70 + 3·(idx−5), .62 + .07·(idx−5), 5)` via `tick`), so it lasts
  ≈ 16 s (02:12 window) + ≈ 19 s (02:13 ring + call) ≈ 35 s (today ≈ 34 s). Its rate is driven by the figure index, so
  the player's own looking-away audibly speeds their heart.
* **Vacuum** (`setSilence(.6, 6)`) needs ≥ 6 s to land; the 02:12 window is [14, 18].

---

## 3. New copy (all 【補充文案】, Traditional Chinese, in `src/data/script.js`)

No 【原企劃文案】 string is changed. Existing lines that stay are marked "existing".

```js
status: {
  // …existing leftTitle / rightTitle / normal / ventDying / blackout / restored / bandwidth / noSignal…
  // 【補充文案】SYS LOG（依事件逐行出現；其他狀態以時間過濾 logLines）
  log: {
    handover:   '02:00 值班交接完成',          // existing
    cam4Vmd:    '02:01 CAM-04 移動偵測',
    cam2Heat:   '02:02 CAM-02 熱源讀值上升',
    ic1:        '02:03 緊急對講機 來電',        // existing
    cam1Lane:   '02:04 北口車道號誌 切換：封閉',
    door:       '02:05 防爆門 震動感測',
    cam2Smoke:  '02:06 CAM-02 移動偵測',
    cam4Sig:    '02:07 CAM-04 影像訊號異常',
    ic2:        '02:08 緊急對講機 來電',        // existing
    ventLabor:  '02:09 主排風 轉速不穩',
    lamps:      '02:10 中段照明 迴路異常',
    ventFault:  '02:11 通風系統 轉速異常',      // moved from 02:05
    ventManual: '02:11 主排風 手動操作',
    ventStop:   '02:12 主排風 停止',
    ic3:        '02:13 緊急對講機 來電',        // existing
    trip:       '02:14 中段繼電器跳脫',         // existing
  },
  logLines: null,                               // filled below: Object.values(SCRIPT.status.log)
  vmdLine: (hhmm, n) => `${hhmm} CAM-0${n} 移動偵測`,   // dynamic CAM-03 lines
  // 右螢幕（機電狀態）
  ventUnstable:  ['供電：正常',     '通風：轉速不穩',   '防爆門：鎖定', '監控：低頻寬模式'],
  powerUnstable: ['供電：電壓不穩', '通風：轉速不穩',   '防爆門：鎖定', '監控：低頻寬模式'],
  ventFault:     ['供電：電壓不穩', '通風：轉速異常 ▲', '防爆門：鎖定', '監控：低頻寬模式'], // [0] edited
  ventManual:    ['供電：電壓不穩', '通風：手動操作中', '防爆門：鎖定', '監控：低頻寬模式'],
},
// 【補充文案】監視系統移動偵測（主 CRT 疊字）
vmd: {
  kinds: { motion: '移動偵測', signal: '影像訊號異常', heat: '熱源讀值上升', lane: '車道號誌變更' },
  tag: (n, kindText) => `▲ CAM-0${n} ${kindText}`,
  frozenTime: '02:14:08',          // CAM-04 停住的時間戳（＝錶停住的時間）
},
hints:        { /* … */ camButtons: '按下控制台前緣的 CAM 按鈕切換頻道' },
interact:     { /* … */ camButtonAlert: (n) => `切換至 CAM-0${n}（▲）` },
descriptions: { /* … */ blastDoorWarm: '鋼板摸起來是溫的。',
                        ventLabor: '轉速表的指針不時往下掉，又被拉回來。' },
```

After the `SCRIPT` literal: `SCRIPT.status.logLines = Object.values(SCRIPT.status.log);` (keeps the array the other
states and `?clock=` time-filter rely on). Total new text: 11 log lines, 3 right-screen variants, 4 OSD words, 1 hint,
1 label, 2 inspect sentences. Everything is a system string or a terse sensory note — no exposition.

---

## 4. Implementation plan (file by file)

Estimated total ≈ 900 LOC, ~1–1.5 engineer-days. New logic lives in **new files** where possible to avoid conflicts with
the bug-fix pass currently touching `CameraFeeds.js` / `channels.js`.

### 4.1 `src/states/pacing.js` — NEW, pure (no THREE, no DOM) · ~170 LOC

Shared by `MonitoringState` and the headless simulator.

```js
export const PACE = {
  scale: 1, cueLead: 1.5, calm: 4, ackSeconds: 1.2, cam3Latency: [3, 6], alertExpire: 60,
  nag: { answer: [18, 30], vent: [15, 30] }, secCatchUp: 8, nominalSpm: 17, ventPost: 14,
};
export const BEATS = [
  { m: 0,  dwell: [8, 12],  limits: [0, 1] },
  { m: 1,  dwell: [14, 24], limits: [0, 1], cue: 'cam4Vmd' },
  { m: 2,  dwell: [14, 24], limits: [1, 2], cue: 'cam2Heat' },
  { m: 3,  gate: 'intercom', stage: 0, limits: [1, 2], answer: [2, 2], post: [8, 18] },
  { m: 4,  dwell: [14, 24], limits: [2, 3], cue: 'cam1Lane' },
  { m: 5,  dwell: [14, 22], limits: [2, 3], cue: 'doorKnock' },
  { m: 6,  dwell: [14, 24], limits: [3, 4], cue: 'cam2Smoke' },
  { m: 7,  dwell: [14, 24], limits: [3, 4], cue: 'cam4Ghost' },
  { m: 8,  gate: 'intercom', stage: 1, limits: [3, 4], answer: [4, 4], post: [8, 18] },
  { m: 9,  dwell: [14, 22], limits: [4, 5], cue: 'ventLabor' },
  { m: 10, dwell: [14, 24], limits: [4, 5], cue: 'cam2Lamps' },
  { m: 11, gate: 'vent', limits: [5, 5], post: [14, 14] },
  { m: 12, dwell: [14, 18], limits: [5, 6], cue: 'vacuum' },
  { m: 13, gate: 'intercom', stage: 2, limits: [6, 7], answer: [7, 7], final: true },
];

export class PaceClock {
  constructor({ scale = 1 } = {})            // t (wall, unpaused), rows[], maxGap, lastMark
  begin(m, { gate = false, window = null, secFrom = 0 })   // e = 0, quietAt = 0, pending = new Set()
  openPost(window)                            // gate done → normal rule with post window; e = 0
  add(key) / ack(key)                         // pending set; ack → quietAt = e; mark()
  mark(kind)                                  // player-noticeable event: updates quietAt + gap stats
  tick(dt, held)                              // t += dt; if (!held && !gate) e += dt; if (held) lastMark = t; _sec(dt)
  get canFlip()                               // rule from §2.2 with window × scale
  planned()                                   // pending ? dMax : min(dMax, max(dMin, quietAt + calm))
  _sec(dt)                                    // monotonic seconds, catch-up ≤ secCatchUp s/s; gate → nominal 60/17 s/s
  get seconds()                               // floor(sec) 0..59
  summary()                                   // [{m, start, dur, cues, acks}], total, maxGap, maxGapAt
}
```

`held` time does not count toward gaps (reading/listening *is* activity).

### 4.2 `src/states/MonitoringState.js` — rewrite of `run/beat/applySkipped`, keeps `onVentRestart/ventStop/tick` · ~+130 LOC net

```js
async run(start) {
  for (let m = start; m <= 13; m++) {
    const b = BEATS[m];
    this.setMinute(m);                                   // LED clock + side-screen clock (log is event-driven now)
    this.pace.begin(m, { gate: !!b.gate, window: b.dwell, secFrom: m === start ? (this.ctx.flags.clockSec ?? 0) : 0 });
    setLimits(this.ctx, ...b.limits);
    if (b.gate === 'intercom') { if (await this.intercomGate(b)) return; }   // returns true on the final call
    else if (b.gate === 'vent') await this.ventGate(b);
    else this.wait(PACE.cueLead).then(() => this.cue(b.cue));
    await this.until(() => this.pace.canFlip);
  }
}
```

* `intercomGate(b)`: `wait(cueLead)` → `ringIntercom` → `pushLog('ic…')` → `pace.mark('ring')` →
  `nag(…, ...PACE.nag.answer)` → `event('intercom:answer')` → `setLimits(...b.answer)` → `playIntercom(this, b.stage,
  b.final ? { hold: 1.0 } : undefined)` → final: `fsm.go(BLACKOUT_CORRIDOR)` and return true; else `setObjective('monitor')`,
  `feeds.flushSilentAlerts()`, `pace.mark('callEnd')`, `pace.openPost(b.post)`.
* `ventGate(b)`: `wait(cueLead)` → existing fault block (flags.ventFault, LED fault, `setVent(AMB.ventFault, 3)`,
  `setRight('ventFault','warn')`) + `pushLog('ventFault')` + objective + `nag(...PACE.nag.vent)` → `until(ventCut &&
  !ventRestarting)` → `pace.openPost([PACE.ventPost, PACE.ventPost])`.
* `onVentRestart()`: as today up to `fanSpinUp`; then `setVent({level:.42, rate:1.08, detune:.08}, 1.2)`,
  `pushLog('ventManual')`, `setRight('ventManual','warn')`, `wait(1.6)` → `this.ventDying(PACE.ventPost - 2)`.
  `ventDying(dur)` stores `{t0, dur}`; `tick` gauge uses `lerp(.62, .20, k)` with that `dur`. `VENT_DYING_SECONDS` removed.
* `cue(key)` dispatch (data-driven):

```js
const CUES = {
  cam4Vmd:   { alert: [4, 'motion'], log: 'cam4Vmd' },
  cam2Heat:  { anomaly: [2, 'heat', 1, { duration: 8 }], alert: [2, 'heat'], log: 'cam2Heat' },
  cam1Lane:  { anomaly: [1, 'laneClosed', 1, { duration: 1, whenUnseen: true }], alert: [1, 'lane'], log: 'cam1Lane' },
  doorKnock: { run: 'knock' },                                         // trigger logic in tick, see below
  cam2Smoke: { anomaly: [2, 'smoke', 1, { duration: 15 }], alert: [2, 'motion'], log: 'cam2Smoke' },
  cam4Ghost: { anomaly: [4, 'ghost', 1, { duration: 4, whenUnseen: true }], also: [[4, 'doorClosed', 1, { whenUnseen: true }]],
               alert: [4, 'signal'], log: 'cam4Sig' },
  ventLabor: { run: 'ventLabor', also: [[3, 'hose', 1, {}]], log: 'ventLabor', right: 'ventUnstable' },
  cam2Lamps: { anomaly: [2, 'lampsOut', 1, { duration: 10 }], alert: [2, 'motion'], log: 'lamps', right: 'powerUnstable',
               also: [[1, 'smoke', 1, { duration: 12 }], [4, 'frozen', 1, { whenUnseen: true }]] },
  vacuum:    { run: 'ventStop', log: 'ventStop', right: 'ventDying' },
};
```

  For `whenUnseen` anomalies the alert is raised from the anomaly's `onApplied` callback, so the tone never precedes the
  change. Every cue calls `pace.mark('cue')`.
* **Bus wiring** (in `enter`): `feeds:alert` → `pace.add('cam'+n)`; `feeds:alertAck` → `pace.ack('cam'+n)`;
  `feeds:figureMoved` → `pace.mark('fig')` and, if `!feeds.isChannelObserved(3)`, schedule the CAM-03 alarm
  (`this._cam3 = { at: pace.t + rand(...PACE.cam3Latency) }`).
* **`tick(dt)`** adds: `held = inspect.isOpen || intercomRinging || intercomTalking || ventRestarting`;
  `pace.tick(dt, held)`; `ctx.flags.clockSec = pace.seconds`; CAM-03 alarm check (`if (feeds.seenSinceMove) cancel; else
  feeds.raiseAlert(3, 'motion', { silent: ringing || talking })` + one `vmdLine` per minute); knock trigger
  (`k.t += dt`; fire when `k.t ≥ 3 && observed(3) for ≥ 1 s`, or `k.t ≥ 10`; never while ringing/talking/inspecting):
  `audio.sfx('doorKnock', { position: points.blastDoor, count: 3, gain: .85 })`, `wait(2.5)` → `count: 2, gain: .7`,
  `wait(1)` → `pushLog('door')`, `flags.doorKnocked = true`, `pace.mark('knock')`; ignored-alert nudge: when two
  alerts have reached their minute's `dMax` unacked → `ui.hint(S.hints.camButtons, 5)` once. Existing gauge and heartbeat
  code stays.
* **`applySkipped(start)`** (for `?clock=`): loop `BEATS` with `m < start`: set limits/figure index to that beat's
  `answer ?? limits[0]`, reveal its log keys, apply its anomalies with `{ duration: 0 }` (no alerts), vent states for
  m ≥ 9 / 11 / 12 as today's blocks re-keyed (labour / cut+lever down+dying / stopped+silence+heartbeat).
* **`exit()`**: `feeds.clearAlerts()`, drop deferred anomaly jobs, `flags.clockSec = null`, `flags.logRevealed` kept
  (Blackout appends the 02:14 line through the rule below).
* Expose `ctx.pace = this.pace` (so `BS.pace` works in debug).

### 4.3 `src/states/common.js` · ~35 LOC

* `resetFlags`: add `logRevealed: null, clockSec: null, doorKnocked: false, ventLabor: false`.
* `pushLog(ctx, keyOrText)`: resolves `S.status.log[key] ?? key`, appends to `flags.logRevealed` if absent, calls `setLeftLog`.
* `setLeftLog(ctx, clockText, tone)`: if `Array.isArray(flags.logRevealed)` → `lines = [...revealed, ...static lines with
  time ≤ clockText and > last revealed time]` (this is how BLACKOUT's `setLeftLog(ctx,'02:14')` appends the relay-trip line);
  else today's time filter. Show the **last 8** lines; cache key = joined content (not `length|tone`).
* `AMB.ventLabor = { level: .40, rate: .92, detune: .18 }`.
* Interactables: blast door body → `f().doorKnocked && !f().powerRestored ? [S.prompts.blastDoorLocked,
  D.blastDoorWarm] : [S.prompts.blastDoorLocked]` (original line stays verbatim and first); `ventStatusText()` → `D.ventLabor`
  when `ventLabor && !ventFault && !ventCut`; CAM button `label: () => feeds.alerts?.has(n) ? I.camButtonAlert(n) :
  I.camButton(n)`.
* `MonitoringState` calls `nag(pred, text, ...PACE.nag.*)` — `StoryState.nag` signature unchanged.

### 4.4 `src/world/CameraFeeds.js` · ~95 LOC

* `this.alerts = new Map()` (n → `{ kind, obs, t0, silent }`), `this._deferred = []`.
* `raiseAlert(n, kind = 'motion', { silent = false } = {})`: only in `LD`; no-op if already raised; cap 3 (drop oldest);
  `controlRoom.setCamAlarm(n-1, true)`; unless silent `audio.sfx('vmdTone', { position: camButtons[n-1] world pos })`;
  emit `feeds:alert {channel, kind}`.
* `flushSilentAlerts()`: one tone if any silent alert is pending, then clear the `silent` flags.
* `_alertTick(dt)` (in `update`, after `_blindSpot`): ack the shown channel's alert after `isChannelObserved(n)` ≥ 1.2 s →
  `setCamAlarm(n-1,false)`, emit `feeds:alertAck {channel, kind}`; expire alerts after 60 s (LED off, no ack event).
* `clearAlerts()`; `reset()` also clears alerts, deferred jobs and calls `ch.resetAnomalies()` on all channels.
* `setAnomaly(n, key, value = 1, { duration = 0, whenUnseen = false, onApplied = null } = {})`: immediate → `ch.setAnomaly`;
  `whenUnseen` → queued, applied once `!(channel === n && gaze.mainScreenObserved)` has held for 0.5 s (same threshold as the
  figure). Every frame: `for (ch of channels) if (ch.tickAnomalies(dt)) this._needRender = true;` (all four, cheap scalar
  ramps — so ramps progress while another channel is shown).
* OSD state (`_updateOSD`): `alert: tag of the newest pending alert` (`SCRIPT.vmd.tag(n, kinds[kind])`, or the same for the
  shown channel); CAM-04 frozen: `time = SCRIPT.vmd.frozenTime`, `recDot: false` (only when `_shownMode === 'LD'`).
  REC dot fades: `this._recOn = damp(this._recOn, recDot ? 1 : 0, 4, dt)` → `u.uRec.value.w = r > 0 ? this._recOn : 0`.
* `_timestamp`: `if (Number.isFinite(flags.clockSec)) sec = flags.clockSec` (else today's formula).
* AGC: `_beginSwitch` / `_meanOf` use `FEED_MEAN.LD[n] * (this.channels[n].meanScaleLD ?? 1)` so CAM-01's darkening
  smoke does not break the ≤ 30 %/0.25 s rule on channel switches.

### 4.5 `src/world/feeds/anomalies.js` — NEW · ~200 LOC; plus small hooks in `channels.js` (~20 LOC) and `props.js` (3 LOC)

`installAnomalies(channels)` is called once in the `CameraFeeds` constructor after `createChannels()`. It adds to every
`FeedChannel`: `anom` (key → `{v, from, to, t, dur}`), `setAnomaly(key, v, dur)`, `tickAnomalies(dt)` (linear ramps, calls
`hooks[key](v)` on change, returns changed), `resetAnomalies()` (snap all to 0), `meanScaleLD = 1`. All new meshes go into
the channel's **`ld` group** (invisible in HD automatically). No new lights — existing ones are modulated.

| Channel · key | Procedural build | Hook `(v: 0→1)` |
|---|---|---|
| CAM-01 `laneClosed` | A separate LD-only gantry in the `ld` group, same dimensions as the HD one (`mergeList([boxG(9.6,.25,.3,0,5.1,−10), two legs])` + two `boxG(.9,.9,.3)` heads at x ±1.9), dark std material; per head two `plane(.78,.78, TX.laneSignalTexture('down' / 'x'), {basic:true, opacity})` stacked 2 mm apart. | `go.opacity = 1−v`, `stop.opacity = v` (transparent basic mats). |
| CAM-01 `smoke` | none (uses `fogs.LD`, portal glows, the three LD PointLights — store them as `this.ldPortalGlows`, `this.ldLights` in `Cam01`). | fog colour lerp `#6a6e72 → #3d3b39`, density `.095 → .15`, glows × (1−.9v), lights × (1−.5v), `meanScaleLD = 1 − .35v`. |
| CAM-02 `heat` | second blob: `glow(C(1,.9,.78), [10,5], [−1.6, 1.0, −42], {opacity:0, fog:false})`. `Cam02.update` uses `this.blobBase` instead of literal `.85`. | blob scale `[26,14]·(1+.3v)`, `blobBase = .85 + .1v`, blob2 opacity `.6v`. |
| CAM-02 `smoke` | `this.ldSmoke = new SmokeField({ count: 14, box: {min:[−5,4.2,−60], max:[5,6.3,−20]}, vel:[0,0,.35], size:[5,9], color: 0x9a9a98, opacity: .55, seed: 43 })` in `ld`; `Cam02.update` (LD branch) calls `ldSmoke.update(dt, t, { opacity: anom.smoke.v })` when > 0. | opacity scalar only. |
| CAM-02 `lampsOut` | store the LD lamp glows (`this.ldLampGlows`, with base opacity) and the 3 LD PointLights sorted by z (far first). | lamp i (far → near, nearest 2 excluded) gets `k_i = 1 − smoothstep(i·s, i·s + f, v)` with `s = .2`, `f = .12` (= 1.2 s of 10 s; `f = .2` with reduceFlicker); glow opacity × k, light intensity × (.35 + .65k). |
| CAM-03 `hose` | export the HD hose control points from `channels.js` as `HOSE_PTS`; build an LD copy `TubeGeometry(curve, 90, 0.055, 6)` scaled y .6, `std({ color: 0x9a968e, roughness: .6 })` so it catches the IR spot; pre-sample curve z per segment. Wrap `setFigurePose` so the reveal follows the figure. | `visible = v > 0`; `geometry.setDrawRange(0, 36 · segsBehind(figureZ − .35))` (6 radial × 6 indices per segment). Changes only when the figure changes ⇒ only in the blind spot. |
| CAM-04 `doorClosed` | `props.buildSedan`: add `car.userData.doorHinge = hinge`, `car.userData.dome = dome` and its emissive mat (3 LOC). | `hinge.rotation.y = −.95(1−v)`, dome intensity `.35(1−v)`, dome mat colour × (1−v). Applied whenUnseen ⇒ instantaneous swap is never on screen. |
| CAM-04 `ghost` | LD group `ghost`: 3 `tapeRibbon`s on the HD post positions (`TX.policeTape()`), 2 `plane(…, TX.sootPlume(131/132), {decal:true})` on the bay wall; all materials `transparent, depthWrite:false, opacity 0`. | opacity = base·v (tape .35, soot .3); ramp 4 s (8 s with reduceFlicker). |
| CAM-04 `frozen` | — | `osdFrozen = v > .5` (read by `CameraFeeds._updateOSD`). |

Memory: ≈ 12 new meshes/sprites + 14 smoke sprites, all in offscreen feed scenes rendered at 10 fps, one channel at a time.

### 4.6 `src/world/feeds/OSD.js` · ~15 LOC

`draw(state)`: if `state.alert` → draw it right-aligned under the timestamp (`my + 60`), size 18, `FONTS.ui`, with the
existing `shadowText` (LD shader makes it monochrome anyway); if `state.recDot === false` → skip storing a REC dot
position (`this.rec.r = 0` is replaced by the fading `_recOn` in CameraFeeds). Both fields are part of the JSON key, so
redraws happen only on change.

### 4.7 `src/world/ControlRoom.js` · ~15 LOC

`setCamAlarm(index, on)` → `this._camAlarm[index] = !!on`; `reset()` clears. In `update`, the CAM LED loop becomes:
alarm → `led.set(LED_COLORS.amber, (reduce ? .8 : .45 + .55·(.5 − .5·cos(2πt/1.6))) · power · live)`; otherwise today's green
logic.

### 4.8 `src/audio/sfx.js` + `AudioEngine.js` · ~35 LOC

* `vmdTone(v, t)`: two sine notes 1046 Hz → 784 Hz, 0.16 s each, 0.06 s gap, 30 ms attack, 120 ms release, through a 3 kHz
  low-pass, `v.send(out, 'room', .1)`; returns 0.6.
* `doorKnock(v, t, o)`: `pre → lowpass 520 Hz (Q .7) → conv('door') → g(DOOR_IR_GAIN) → out`;
  `knockSet(v, pre, t, { count: o.count ?? 3, spacing: .28, amp: 1 })` with the first knock at 0.7× (edit `knockSet` call
  or scale per knock); `v.send(out, 'room', .12)`; returns 2.0.
* `SFX_GAIN.vmdTone` / `SFX_GAIN.doorKnock`: calibrate to peaks of **≤ −30 dBFS** and **≤ −28 dBFS** at the seated position
  (see §6.3); add both to the header list.

### 4.9 `src/states/PrologueState.js` (hand-off) · ~10 LOC

* Note hint: `this.nag(() => !ctx.flags.noteRead, ctx.SCRIPT.objectives.prologue, 20, 20)` after control is given;
  `NOTE_TIMEOUT` 50 → 40 s.
* `tick()`: once the CRT is on, `ctx.flags.clockSec = Math.min(45, Math.floor(elapsed))` so the OSD seconds continue
  monotonically into MONITORING's minute 0 (which starts from `secFrom = flags.clockSec`).

### 4.10 Docs · ~40 lines

`docs/ARCHITECTURE.md` §8: new beat table (02:03 / 02:08 / 02:11 / 02:13 gates; adaptive clock; VMD events
`feeds:alert` / `feeds:alertAck` in §5). `docs/DESIGN-NOTES.md`: rewrite A3 ("節拍閘門" → "注意力驅動時鐘＋節拍閘門"), add
"A5 監視系統移動偵測" and "B6 02:05 敲門／02:11 通風操作對齊日誌與事故調查摘要". Update the `MonitoringState` header table.

### 4.11 `scripts/pace-sim.mjs` — NEW (headless timing harness) · ~140 LOC

Imports only `src/states/pacing.js` and `src/data/script.js` (pure data; intercom durations come from `segments`). Steps a
`PaceClock` at dt = 0.1 s with persona models (`notice, switch, linger, back, answer, lever, inspectP`), a simplified gaze
model (`view ∈ {cam1..4, away}`) and the exact figure rule (seen ≥ .8 / unseen ≥ .5, limits from `BEATS`). Prints the
per-minute table, total, max gap and where it occurred; exits non-zero if: typical total ∉ [240, 330] s, any non-AFK
persona's max gap > 26 s, any normal minute < `dMin·scale`, or the figure is not at 7 when the final call ends.
(`scripts/*` is a shared folder: this is an *added* file, flag it in the hand-off report.)

---

## 5. Comfort & golden-rule check

| New element | Brightness / motion | Audio | reduceFlicker | Verdict |
|---|---|---|---|---|
| Adaptive clock | none (LED clock digits change as today) | – | – | ✓ |
| CAM-button amber LED | 4.5 mm LED, cosine 1.6 s, 0.45–1.0 | – | steady 0.8 | ✓ period ≥ 0.4 s, tiny area |
| OSD alert tag | static text ≈ 1.5 % of the CRT; appears with an OSD redraw (no blink) | – | same | ✓ |
| CAM-04 REC dot removal | 7.5 px dot fades over ~0.6 s | – | same | ✓ |
| `vmdTone` | – | ≤ −30 dBFS at seat, 30 ms attack, soft sines; silent during calls; ≤ 1 per alert | – | ✓ not loud, predictable UI sound |
| `doorKnock` | – | ≤ −28 dBFS at seat, LP 520 Hz, door IR, first knock 0.7×; never during a call/inspect | – | ✓ quiet audio dislocation (rule §3.5), no stinger, no visual |
| CAM-04 door/dome | blind-spot swap — never visible while it happens | – | – | ✓ |
| CAM-04 ghost | ≤ 25 % opacity, small region, 4 s ramp | – | 8 s ramp | ✓ |
| CAM-02 heat | ≤ +12 % CRT mean over 8 s | – | ramp ×1.5 | ✓ (< 1 %/0.25 s) |
| CAM-02 smoke | ≤ 10 % mean over 15 s | – | – | ✓ |
| CAM-02 lamps out | each lamp 1.2 s fade, 2 s stagger; total ≈ −25 % mean over 10 s | – | 2.0 s fades | ✓ (< 1 %/0.25 s) |
| CAM-01 lane signal | 0.6 % of screen, 1 s crossfade | – | 1.6 s | ✓ |
| CAM-01 smoke | ≈ −30 % mean over 12 s; AGC mean scaled so switches stay within budget | – | – | ✓ |
| CAM-03 hose | only changes together with a figure move (blind spot) | – | – | ✓ CAM-03 rule intact |
| CAM-03 alarm | report only, 3–6 s latency, never on CAM-03 while observed | tone as above | – | ✓ |
| Vent labour / fault / dying | gauge needle only | layer ramps ≥ 1.2 s (6 s, 3 s, 12 s) | – | ✓ |
| Room | **no new room lights, no new objects near the camera, nothing in the room moves** | | | ✓ rule §3.3 |

Rejected on comfort/rule grounds: dimming CAM-03's far lamp while observable (would change the figure's appearance under
observation); any brightness "glitch" or frame dropout on CAM-04 (flash); more intercom calls (dilutes the three original
calls); a distance readout on CAM-03 (too gamey); CAM-05 (out of scope).

---

## 6. Risks, cut list, testing

### 6.1 Risks and mitigations

| Risk | Mitigation |
|---|---|
| Alerts turn the act into a checklist. | ≤ 1 announced cue/min; 02:01 alert shows *nothing changed*; unannounced details at 02:09/02:10; CAM-03 alarm latency; 02:12 has no cue at all. |
| Players never discover the CAM buttons. | 02:01 alert + amber LED on the button + label `切換至 CAM-04（▲）`; hint `camButtons` after two ignored alerts. |
| The clock races for skilled players. | `dMin` 14 s + 4 s calm floor; holds for inspect/calls; total floor ≈ 3:45. |
| Merge conflicts with the ongoing fix pass. | New logic in `pacing.js` and `feeds/anomalies.js`; hooks in existing files are small and listed above. |
| Moving the vent gate breaks assumptions elsewhere. | Only `MonitoringState` + `logLines` + docs reference 02:05-vent; `lateMonitoringWorld`/`restoredWorld` only set flags. Option A fallback in §2.4. |
| Loop restart leaves anomalies/alerts on. | `feeds.reset()` → `resetAnomalies` + `clearAlerts`; `ControlRoom.reset()` clears `_camAlarm`; `resetFlags` clears log/sec. |
| `?clock=` skips leave the world inconsistent. | `applySkipped` iterates `BEATS` and applies anomalies with `duration: 0`. |
| OSD seconds jump backwards at the hand-off. | Prologue publishes `clockSec`; minute 0 starts from it; display is monotonic. |
| Audio levels drift after calibration. | Measure both new SFX with the existing analyser path; limiter still caps at ≈ −15 dBFS. |

### 6.2 Cut list (implement in this order; stop where time runs out)

1. **Tier 0 — fixes the complaint on its own (~0.5 day):** `PaceClock` + new `run()` loop + per-minute limits + VMD alert
   system (LED, OSD tag, tone, log, ack) + CAM-03 latency alarm + `cam4Vmd`, `cam2Heat`, `cam1Lane`, `doorKnock` +
   event-driven SYS LOG + shorter nags + prologue hand-off.
2. **Tier 1 — the story alignment:** vent gate → 02:11 (+ `ventLabor`, `ventManual`), `cam2Lamps`, `cam4 frozen`,
   `cam3 hose`, blast-door `鋼板摸起來是溫的。`.
3. **Tier 2 — polish:** `cam2Smoke`, `cam4Ghost` + door closed, `cam1 smoke`, right-screen variants, button label suffix,
   "reading the side screen" hold, debug HUD line.
4. **Emergency 30-minute fallback:** keep today's beats; replace `wait(spm)` with `until(pace.canFlip)` using dwell
   [8, 14] for every non-gate minute and the CAM-03 alarm only. Cuts dead time from 221 s to ≈ 110 s with zero new content.

### 6.3 How to test

* **Headless timing (no browser, safe on the busy machine):** `node scripts/pace-sim.mjs [--persona typical] [--scale 1]`
  → per-minute table, total, max gap; CI-style thresholds in §4.11. Run all personas after every tuning change.
* **In-game debug hooks** (`?debug=1`): `BS.pace.info()` → `{minute, e, window, pending, planned, sec}`;
  `BS.pace.flip()` (force the next minute); `BS.pace.summary()` (console.table of minute durations and gaps);
  `BS.feeds.raiseAlert(2, 'motion')`; `BS.feeds.setAnomaly(4, 'ghost', 1, { duration: 0 })`; `BS.feeds.alerts`.
  URL: `?state=MONITORING&clock=02:09` (skip; anomalies applied instantly), `?pace=0.5` (half-length run for quick checks),
  `?pacelog=1` (console line per beat: `[pace] 02:05 +88.6s dur=16.2 pend=[] gap=7.4`, summary at blackout so the owner can
  paste one table after a play-test), existing `?speed=4`. Optional one-line addition to the shared `main.js` HUD:
  `| pace ${ctx.flags.paceDebug || ''}`.
* **Screenshots (when CPU is free):** `node scripts/shot.mjs --state MONITORING --eval "BS.feeds.setChannel(4);
  BS.feeds.setAnomaly(4,'ghost',1,{duration:0});BS.feeds.setAnomaly(4,'frozen',1)" --after 1` for each anomaly key, LD
  before/after; check the hose is visible at figure index 4–6 (pale line catching the IR spot) and the lane ✕ reads at
  160×120.
* **Comfort:** reuse `/tmp/review-comfort/agc.js`-style frame-mean sampling on CAM-01 smoke, CAM-02 lamps and channel switches
  into CAM-01 after the smoke (assert ≤ 30 %/0.25 s); reuse the audio analyser script to measure `vmdTone`/`doorKnock`
  peaks at the seat (assert ≤ −30/−28 dBFS) with `reduceFlicker` on and off.
* **Owner play-test checklist:** (1) did you ever wait with nothing to do? (2) did you notice the knock happening while he
  was far away on CAM-03? (3) did the 02:11 lever feel like *your* act when you read the Act-3 screens? (4) total time from
  `?pacelog=1` summary.
