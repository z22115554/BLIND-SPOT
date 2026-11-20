# 盲區交接 BLIND SPOT: duties in the control room (player-agency proposal, 「值班程序」)

> **中文摘要**：第三幕指控主角做了三件事：**鎖死防爆門、切斷通風、對門外求救置之不理**。但在第一幕，玩家親手做的只有拉通風拉桿這一件。門一開始就鎖好了，也沒有任何求救訊號可以讓他「不理」。
> 本提案把這三件事都變成夜班值班員的**例行公事**，讓玩家在中段每一分鐘都有事做，而且每件事都必須離開 CAM-03（他就在這時前進）：
> **02:00 親手轉動氣壓閥，鎖上防爆門**（三分鐘後對講機說「門……打不開……」）；
> **三輪定時巡檢**，在巡檢表上簽名，表上早已有自己的淡淡筆跡；
> **三次火警受信，親手按下「音響停止」**，其中一次是「手動報知機」，代表有人用手按了它；
> 一本**交接日誌**，會在你轉身的時候自己多出字。
> 每個動作都只留下痕跡，不說破真相。要到第三幕的事故調查摘要，玩家才會發現那全是自己的手做的。
> 一般玩家的監看段落約 **4 分 20 秒**。除了 02:12 刻意保留的真空時刻，沒有超過約 10 秒「沒事可做」的空檔。

Scope: `STATE_MONITORING` (02:00 → 02:14), plus small set-ups in `PrologueState` and payoffs in `restoredWorld` (Act 3).
Everything below is based on the current source as of `ea092f0`. Nothing in the repo was modified.
This proposal works on its own. Section 6.4 covers how it combines with `docs/pacing/proposal-feeds.md` and `docs/pacing/proposal-pacing.md`.

---

## 1. Diagnosis: why the middle is dead

### 1.1 Numbers (from `MonitoringState.run()`, `CLOCK.secondsPerMinute = 17`)

`run()` waits 17 s **after** each beat finishes, so gate time is added on top of the 17 s. Intercom lengths (sum of `segments[].dur` + `hold`) are 13.9 s, 12.5 s and 11.2 s. The lever takes about 1.4 s.

| Window | Clock | Time with nothing required | Required input in window | Figure limits | Max CAM-03 changes | How fast the CAM-03 "budget" is spent |
|---|---|---|---|---|---|---|
| W0 | 02:00 → 02:03 | **51 s** | none | {0,2} | 2 | Two look-aways (≥0.8 s seen, then ≥0.5 s unseen) spend it in about **5 s**. CAM-03 is then frozen for about 45 s. |
| W1 | 02:03 done → 02:05 | **34 s** | none | {1,3} | 1 | one glance |
| W2 | 02:05 done → 02:08 | **51 s** | none | {2,4} | 1 | one glance |
| W3 | 02:08 done → 02:13 | **85 s** (02:10 detune and 02:12 vacuum are automatic) | none | {4,5} → {5,6} | 2 | two glances |

* **Required inputs in the whole act: 4** (answer ×3, lever ×1). That is one input about every 70 s.
  Free clock time totals **221 s ≈ 3.7 min**. For a typical player (about 288 s for the act) that is **about 77 % idle**.
* **CAM-03 is the only thing that ever changes**, and the cap structure exhausts it within seconds of each window opening.
  A player who keeps watching sees **nothing at all**. That is the right rule, but nothing ever pulls the player's eyes away.
* **CAM-01/02/04 are static LD scenes.** About 2 s each shows everything, and nothing changes until Act 3. The owner's words are literally true.
* **Side screens** change only at 02:03/05/08/13 (left log) and 02:05/10 (right status).
* **Room**: the 11 Act-1 interactables (note, coffee, 4 CAM keys, clock, blast door, intercom-idle, vent-idle, side door) are all static one-liners. Meanwhile six props *look* like work but are decoration:
  the clipboard on the left wing already printed `設備巡檢表` (`LT.formTexture()`), the whiteboard `值班表`, binders `設備巡檢 / 緊急應變`, the desk phone, the radio, and a half-open filing drawer.
* **The objective** `監看各頻道監視器（CAM-01 ～ CAM-04）` promises a task, but it has no completion state and gives no feedback.

### 1.2 The real problem: the guilt is told, not enacted

Act 3 accuses the operator of three acts. `incidentReport` and `status.restored` say: the blast door was **locked from inside**, the main exhaust was **manually cut at 02:11**, and the rescuer died **outside the door while the operator did nothing**.
In Act 1 the player performs one of them (the lever, reframed in Act 3). The door is already locked when they wake, and there is no plea they can "ignore" except by not answering, which the game does not allow.
**The fix for the dead middle and the fix for the weak middle reveal are the same:** give the operator the routine duties through which those acts were committed. Make every duty point away from CAM-03, and let every return trip show the figure closer.

---

## 2. Design

### 2.1 Rules this design follows

1. **Every duty is real night-shift work** in a Taiwanese road-tunnel control room: lock-down, a timed CCTV patrol round (定時巡檢) signed on a form, the fire-alarm receiver (火警受信總機) and its `音響停止` button, and the handover log (交接日誌).
2. **Every duty takes the eyes off CAM-03.** That is the only way the figure moves, so duties *produce* the scare-free dread beat: *I did my job, and he got closer.*

   | Duty | Where the player looks | Unseen time per trip |
   |---|---|---|
   | Lock door | west wall, CRT 90° to the left | ≈ 8 s |
   | Patrol | CRT switched to CAM-01/02/04 (switching counts as unseen) | ≈ 6 s |
   | Sign form | left wing, about 45° down-left, then InspectView (gaze = unseen) | ≈ 8 s |
   | Fire panel | east wall, back to the CRT | ≈ 10 s |
   | Logbook | lower right desk + InspectView | ≈ 6 s |

3. **Every duty leaves a trace that Act 2/3 recontextualizes. None of them says the truth in Act 1** (see the spoiler check in §5).
4. **One verb per duty, no failure state, no punishing timer.** Ignored alarms silence themselves after 45 s, but the log still blames the operator (`延時設定`).
5. **No new HUD.** The existing objective line plus diegetic surfaces: the SYS LOG terminal, the clipboard form, the panel LCD and InspectView texts.
6. **Deliberately not done here:**
   * **Evolving the sticky note.** It is the ending's hinge (`setEndingWriting`, tallies) and 【原企劃文案】.
   * **New CAM channels.**
   * **Feed anomalies.** Those belong to the feeds proposal; the patrol round is the natural way to deliver them.

### 2.2 The elements

**D0. Lock the blast door (new gate at 02:00).** At wake-up the door is **unlocked**. The right screen reads `防爆門：未鎖定 ▲` and the door's status lamp is green. The sticky note the player just read ends with `鎖死防爆門。`.
The first objective is `鎖定防爆門`. The player walks to the west wall and uses the red `氣壓閥手輪`. The wheel spins 2.5 turns over about 1.7 s, the bolts slide home over 0.7 s, there is a pneumatic hiss, and the lamp turns red.
SYS LOG: `02:00 防爆門 手動上鎖（操作員）`. The door's inspect text then becomes the 原企劃 line `防爆門已從內部反鎖（氣壓閥鎖死狀態）。`, which now describes **the player's own act**.
Three minutes later the first intercom says `……門……打不開……`. The ending's `解除氣壓門鎖` undoes exactly this act.

**D1. 定時巡檢: three patrol rounds (02:01, 02:06, 02:09).** A soft terminal beep sounds, and the SYS LOG prints `02:01 定時巡檢 第1輪` with a live footer `CAM-01 □ CAM-02 □ CAM-04 □`.
Each channel turns ■ after it has been on screen **and watched for 1.2 s** (`feeds.isChannelObserved(n)`). The objective then becomes `在設備巡檢表上簽核`.
The player uses the existing clipboard on the left wing (now interactive). InspectView shows the form, now a live CanvasTexture. Every cell is **already ticked in faint ink in the player's own handwriting**, and the new ticks land exactly on the ghosts.
The faint notes *change between visits*, just as the figure does:
* **Signing R1:** row 1 note `白車，駕駛不在`, and rows 2–3 are already faintly filled in.
* **Signing R2:** the faint `白車` in row 2 is now struck through; it was not before. Row 3 now has a note: `B區 不予處理`.
* **Signing R3:** the empty row 4 now reads faintly `02:14`, followed by a pen stroke that drags off the edge of the paper.

**D2. 火警受信: three fire alarms (02:04, 02:07, 02:11).** This is a new wall panel `火警受信總機` on the east wall, beside the vent panel. When it rings:
* the `B區` zone lamp breathes red;
* a soft two-tone chirp comes from the east wall every 4 s;
* the SYS LOG prints `02:04 火警受信 B區 偵煙#07` in amber.

The only working button is **`音響停止`**. Pressing it stops the chirp, leaves the lamp dim and steady, logs `音響停止（操作員）`, and opens a short inspect.
Masking tape on the panel, in the player's hand, says `B區 #07 老是誤報。響了按音響停止就好。` The `主車道` zone lamp is covered with black electrical tape, and a red rim glows around it.
* **Alarm 2 (02:07)** is a **manual call point** (`手動報知機 #B07`): *「手動報知機不會誤報。要有人用手按下去，它才會響。」* One minute later, intercom 2: `……別鎖……快開門……`.
* **Alarm 3 (02:11)** is every detector in B區 at once, including a heat detector. The player silences it anyway; it is the only button.

In Act 3, the incident report gains one line: **`02:04 起 B區火警受信三次，均於控制室消音。`**

**X1. 交接日誌: the logbook that writes itself (discovery, optional).** A clean copy of the same blue cloth logbook that the player will find burnt in Act 2 lies closed on the right of the desk, where the coffee used to be.
* **Stage 0:** tonight's page, in the player's hand, reads `01:58 4號緊急停車彎，白車一輛，已熄火。駕駛步行進入維修廊道。` / `02:00 接班。`, and every earlier page carries **the same date and the same lines**.
* **Stage 1, after the 02:05 vent gate:** the book is now **open** (the mesh is swapped only while unobserved). A quiet page rustle comes from behind the player, who is at the east wall. A new line with *the ink still wet*: `02:05 有人在敲防爆門。`
* **Stage 2, 02:12 vacuum:** the rustle, muffled. A last line trails off: `只要門鎖著，`. Act 2's burnt book completes it (`忘掉這一切。只要門鎖著，我就安全了。`).

The `01:58` entry matches the Act-3 report line `01:58 特種消防救援隊進入維修廊道。` to the minute: the "driver" the operator logged was the rescue team.

**M1. Micro (5 LOC).** From 02:08 on, inspecting the coffee appends one line to the 原企劃 sentence: `從你醒來到現在，它一點都沒有變涼。` This foreshadows the loop; the ending brings back the hot coffee.

**P1. Idle fast-forward (pacing glue).** A non-gate minute normally lasts 17 s. When **no duty is pending**, nothing is being inspected and no call is playing, the next minute arrives after **10 s**.
This never applies to the minutes into 02:11, 02:12 or 02:13, which protects the 40 s vent detune and the vacuum.

### 2.3 Minute by minute (typical player; wall seconds from MONITORING enter)

"Pending" holds a non-gate minute at its full 17 s; "idle" ends it after 10 s (P1). The CAM-03 column shows the usual figure index under the **unchanged** `GATE_LIMITS`.

| Clock | ≈ wall s | What happens / changes | How the player is cued | What the player does | CAM-03 (typical) | Story purpose → Act-3 payoff |
|---|---|---|---|---|---|---|
| **02:00 GATE (new)** | 0–10 | Door unlocked. Right screen `防爆門：未鎖定 ▲`, door lamp green. The clock holds at 02:00. | Objective `鎖定防爆門`; the green lamp; the note they just read. Nag hint at 20 s, then every 30 s. | Stands, walks to the west wall, `鎖定` the wheel (hiss, bolts, lamp turns red). Log `02:00 防爆門 手動上鎖（操作員）`. | 0 → **1** (the first time they turn away) | **You lock him out with your own hand**, at the minute the Act-3 report names. 3 min later: `門……打不開`. The ending's unlock is the mirror image. |
| 02:00 → 01 | 10–20 | Idle (P1). | Objective `持續監看 CAM-03`. | Walks back and sees he has moved. | (1) | First "he moved while I did what my note said". |
| **02:01** | 20–42 | **Patrol R1.** | Terminal beep, SYS LOG line plus □□□ footer, objective. | Presses CAM-01/02/04 and watches each 1.2 s (■). `簽核` on the clipboard: InspectView r1. | 1 → **2** | Faint ticks already in their hand: **loop**. `白車，駕駛不在` sets up the strike-through. |
| 02:02 | 37–47 | Quiet (R1 pending ends at about 40 s, then 10 s idle). | – | Back to CAM-03. | (2) | Breathing room. |
| 02:03 GATE | 47–66 | Intercom 1 (existing), at the wall beside the door they just locked. | Ring. | Answers. | capped 2 | Causality: lock → `門……打不開`. |
| **02:04** | 76–94 | **Fire alarm 1** (`偵煙器 #07`). | Chirp from the east wall (HRTF behind-right), B lamp breathing, SYS LOG amber, objective `火警受信總機在響`. Nag hint at 25 s. | Crosses the room, presses `音響停止`, short inspect: their own tape note, and the taped `主車道` lamp. | 2 → **3** if they looked at CAM-03 after the call | You silence a fire alarm because past-you told you to. The taped lamp = the CAM-02 HD fire. |
| 02:05 GATE | 95–101 | Vent fault (existing). The player is already a metre away. | Existing. | Pulls the lever. Afterwards: logbook stage 1, a rustle **behind them**. | 3 | Audio dislocation. The log line `02:05 有人在敲防爆門` matches Act 2 and the report's `02:05 救援隊員抵達…`. |
| **02:06** | 111–136 | **Patrol R2.** | As R1. | Patrols and signs (r2): the faint `白車` is now **struck through**; row 3 now says `B區 不予處理`. | 3 → **4** | Doubt about the car (HD CAM-04: no car). "No action on B區" = ignoring the rescuer. |
| **02:07** | 128–148 | **Fire alarm 2: manual call point `#B07`.** | As before. | Silences it. Inspect: `手動報知機不會誤報。要有人用手按下去，它才會響。` | capped 4 | **Someone in B區 is calling for help**, the first concrete hint that the figure is a person reporting a fire. |
| 02:08 GATE | 145–165 | Intercom 2 (existing) `……別鎖……快開門……`. | Ring (waits until alarm 2 is handled, at most 30 s). | Answers. | 4 → {4,5} | One minute after you silenced his alarm, he begs. |
| **02:09** | 175–196 | **Patrol R3.** | As R1. | Patrols and signs (r3): row 4 now faintly reads `02:14` and a stroke drags off the page. | 4 → **5** | The minute of death (watch `02:14:08`, the blackout, the ending clock). |
| 02:10 | 192 | Vent starts dying (existing, auto, 40 s detune). | Existing. | (finishing R3) | 5 | – |
| **02:11** | 209–218 | **Fire alarm 3**: `#07 #08 #09 定溫`. The rim of the taped lamp is redrawn brighter. | As before. | Silences it (it is the only button). | capped 5 | The fire is real and you silence it anyway. Act-3 report: `02:04 起 B區火警受信三次，均於控制室消音。` |
| 02:12 | 226–243 | Vent stops, vacuum, heartbeat (existing; full 17 s, no fast-forward). Logbook stage 2: a muffled rustle. | Silence. | Optional: reads `只要門鎖著，`. | {5,6} | Sets up Act 2's burnt-logbook last line. The vacuum stays a pure dread beat. |
| 02:13 GATE | 243–260 | Intercom 3 (existing), then the blackout. | Ring. | Answers. | **6 → 7** | – |

**Result:** about **260 s** for a typical player (current ≈ 288 s). Idle gaps are 10, 6.5, 10, 10, 10 and 7.5 s, plus the designed 17 s vacuum. The current design has gaps of 51/34/51/85 s.
Required actions go from 4 to 14: 1 lock, 3 patrol rounds (3 channel checks each), 3 signatures, 3 silences, 3 answers and 1 lever. That is about 20 discrete inputs, each action 5–20 s long.
A fast player (≈ 3:40) gets the same beats; a slow player (≈ 5:30) gets full 17 s minutes while duties are pending, and gates never start in the middle of a duty.

### 2.4 Payoff map (what each Act-1 act becomes)

| Act-1 act or trace | Act 2 | Act 3 |
|---|---|---|
| D0 `02:00 防爆門 手動上鎖（操作員）` | – | Report `02:00 中央控制室防爆門由內部上鎖。`; intercom stage 4 `快把防爆門解鎖`; the ending unlock |
| X1 `01:58 … 駕駛步行進入維修廊道。` | – | Report `01:58 特種消防救援隊進入維修廊道。` (same minute) |
| D2 tape `B區 #07 老是誤報…`, silences ×3, the manual call point | – | Report `02:04 起 B區火警受信三次，均於控制室消音。`; panel history `音響停止（操作員）` ×3; HD figure is a firefighter |
| D2 taped `主車道` lamp | – | CAM-02 HD fire and pile-up; in Act 3 the tape has curled from the heat |
| D1 struck `白車` | – | CAM-04 HD: `目標：無車輛` |
| D1 `B區 不予處理` | – | The rescuer died outside the door |
| D1 row 4 `02:14` + a stroke off the page | Watch `02:14:08` | Ending: the clock stops at 02:14, the operator slumps |
| X1 every page has the same date | Burnt book: `日期隱約是三年前的今天` | Report `（三年前）`; the loop |
| X1 `02:05 有人在敲防爆門。` / `只要門鎖著，` | The burnt book continues both lines | – |
| M1 coffee never cools | – | The ending: hot coffee returns |

### 2.5 Figure limits and the blind-spot rule

The CAM-03 rule and `GATE_LIMITS` are unchanged. With 10 look-away trips (lock, R1–R3, alarms 1–3, 3 calls, vent) and 7 steps, about two thirds of trips move him and the rest do not, which makes the pattern unpredictable.
The idle objective `持續監看 CAM-03` (replacing `monitor` while duties are on) nudges the player to *look* between duties. That sets `seenSinceMove`, so the next duty produces a step.
The only addition to A3 (DESIGN-NOTES) is a new **02:00 lock gate** at a fixed clock minute that needs a player action; it has the same shape as the 02:05 vent gate.

---

## 3. New copy (all 【補充文案】, Traditional Chinese, `src/data/script.js`)

Additions to existing blocks:

```js
// SCRIPT.verbs
lock: '鎖定',
sign: '簽核',

// SCRIPT.interact
blastDoorWheel: '防爆門氣壓閥手輪',
clipboard: '設備巡檢表',
firePanel: '火警受信總機',
fireSilence: '火警受信總機：音響停止',
deskLogbook: '交接日誌',

// SCRIPT.descriptions
blastDoorUnlocked: '氣壓閥沒有加壓，鎖栓縮在門框裡。現在從門外也打得開。',

// SCRIPT.objectives   (monitor kept for ?duties=0)
lockDoor: '鎖定防爆門',
watch03: '持續監看 CAM-03',
patrol: '定時巡檢：確認 CAM-01、CAM-02、CAM-04',
patrolSign: '在設備巡檢表上簽核',
fireAlarm: '火警受信總機在響',

// SCRIPT.hints
lockDoor: '防爆門在西牆。轉動門上的氣壓閥手輪就能上鎖。',
patrol: '用桌上的 CAM 按鈕切換頻道，每個畫面看一下。',
fireAlarm: '警報聲是從東牆傳來的。',

// SCRIPT.status
normalUnlocked: ['供電：正常', '通風：運轉中', '防爆門：未鎖定 ▲', '監控：低頻寬模式'],
```

New block `SCRIPT.duty`:

```js
duty: {
  // SYS LOG（{t} = HH:MM，{n} = 輪次）
  log: {
    doorLocked: '{t} 防爆門 手動上鎖（操作員）',
    patrolStart: '{t} 定時巡檢 第{n}輪',
    patrolDone: '{t} 定時巡檢 第{n}輪 完成',
    patrolCheck: '　CAM-01 {1}　CAM-02 {2}　CAM-04 {4}',
    mark: { done: '■', todo: '□' },          // CJK 字型一定有的方塊，不用 ✓
    fire: ['{t} 火警受信 B區 偵煙#07', '{t} 火警受信 B區 手動報知機', '{t} 火警受信 B區 多點動作'],
    fireSilenced: '{t} 火警 音響停止（操作員）',
    fireAutoSilenced: '{t} 火警 音響停止（延時設定）',
  },
  firePanel: {
    title: '火警受信總機',
    zones: ['A區', 'B區', 'C區', '主車道', '停車彎', '機房'],
    buttons: ['音響停止', '復歸'],
    tape: 'B區 #07 老是誤報。響了按音響停止就好。',
    lcd: {
      idle: ['系統正常', ''],
      ring: [['火警 B區', '偵煙器 #07'], ['火警 B區', '手動報知機 #B07'], ['火警 B區', '#07 #08 #09 定溫']],
      held: ['音響停止', '未復歸'],
      history: ['受信紀錄 3 件', '全部未復歸'],
    },
    body: {
      idle: [
        '六個區域燈都是暗的。只有「主車道」那一格被一小塊黑色電工膠帶貼住，膠帶邊緣透出一點紅光。',
        '面板下緣貼著一段紙膠帶，是你的字：',
        '*『B區 #07 老是誤報。響了按音響停止就好。』*',
      ],
      silenced: [
        ['警報聲停了。B區的燈還亮著，液晶螢幕寫著「偵煙器 #07」。', '面板下緣貼著一段紙膠帶，是你的字：', '*『B區 #07 老是誤報。響了按音響停止就好。』*'],
        ['警報聲停了。這一次，液晶螢幕寫的是「手動報知機 #B07」。', '手動報知機不會誤報。要有人用手按下去，它才會響。'],
        ['警報聲停了。B區三個偵煙器和一個定溫式偵熱器，全都在動作。', '「主車道」那塊電工膠帶的邊緣，紅光比剛才亮。'],
      ],
      restored: [
        '六個區域燈全亮著。「主車道」那塊電工膠帶已經烤得捲起來了。',
        '液晶螢幕上的受信紀錄只有三筆，三筆後面都是同一行字：',
        '「音響停止（操作員）」',
      ],
    },
  },
  patrolForm: {
    title: '設備巡檢表',
    header: '設備巡檢表（夜班）',
    sub: '雪嶺隧道中央控制室',
    cols: ['輪次', '時間', 'CAM-01', 'CAM-02', 'CAM-04', '備註', '簽核'],
    rows: ['第1輪', '第2輪', '第3輪', '第4輪'],
    footer: '每輪確認畫面正常後打勾、簽核。',
    ink: { r1: '白車，駕駛不在', r2: '白車', r3: 'B區 不予處理', r4: '02:14' },  // 表上的手寫字
    body: {
      peek: [
        '夜班的設備巡檢表。每一輪要確認 CAM-01、CAM-02、CAM-04。',
        '表格裡早就有人打過勾了。很淡，像被橡皮擦擦過，但還看得出來。筆跡是你的。',
      ],
      r1: ['你在第一輪那一行打勾、簽名。新的勾正好落在淡淡的舊勾上。', '備註欄的淡字寫著：', '*『白車，駕駛不在。』*', '下面兩行也已經淡淡地填好了。'],
      r2: ['你在第二輪那一行打勾、簽名。', '這一行備註欄裡淡淡的「白車」，被一條線劃掉了。上一輪看的時候，那條線還不在。', '第三輪那一行的備註，也多了字：', '*『B區 不予處理。』*'],
      r3: ['你在第三輪那一行打勾、簽名。', '最下面第四輪那一行原本是空的。現在那裡淡淡地寫著：', '*『02:14』*', '後面一道筆畫拖出了表格，一直拖到紙的邊緣。'],
    },
  },
  logbook: {
    title: '交接日誌',
    // 依階段累加顯示（stage 0 → 0..0，stage 2 → 0..2）
    stages: [
      ['封面寫著『雪嶺隧道中央控制室 — 交接日誌』。最新一頁是今晚，是你的字：',
       '*『01:58 4號緊急停車彎，白車一輛，已熄火。駕駛步行進入維修廊道。』*', '*『02:00 接班。』*',
       '往前翻，上一頁是同一個日期、同樣幾行字。再上一頁，也是。'],
      ['今晚那一頁的最後，多了一行。墨水還沒乾：', '*『02:05 有人在敲防爆門。』*'],
      ['再下面一行，筆畫越寫越歪，停在一半：', '*『只要門鎖著，』*'],
    ],
    // 3D 書頁上的手寫行（純氛圍；可讀內容在 InspectView）
    page: ['01:58 4號停車彎 白車一輛', '　駕駛步行進入維修廊道', '02:00 接班', '02:05 有人在敲防爆門', '只要門鎖著，'],
  },
  coffeeStillHot: '從你醒來到現在，它一點都沒有變涼。',
},
```

Edit to `incidentReport.lines` (9 lines; `防爆門：由內部反鎖。` is replaced by the 02:00 line):

```js
'01:45 隧道中段多車追撞，油罐車起火。',
'01:58 特種消防救援隊進入維修廊道。',
'02:00 中央控制室防爆門由內部上鎖。',            // 新增
'02:04 起 B區火警受信三次，均於控制室消音。',     // 新增
'02:05 救援隊員抵達中央控制室防爆門外。',
'02:11 主排風遭控制室內手動切斷。',
'02:14 中段供電中斷，濃煙倒灌。',
'救援隊員一名，於防爆門外殉職。',
'控制室值班員一名，於室內窒息身亡。',
```

Verbatim checks: no 【原企劃文案】 string changes. `prompts.blastDoorLocked` and `items.coffee.stages[0]` are reused verbatim; the coffee line is appended as a second paragraph. The logbook cover title is read from `items.logbook.body[0]`, as `logbookCover()` already does.

---

## 4. Implementation plan (file by file)

Total ≈ **1,000 LOC of runtime code**, plus about 60 lines of copy, about 50 lines of docs and about 250 lines of test scripts.

### 4.1 `src/states/duties.js`: NEW, ≈ 280 LOC (the director; the schedule constants are pure data)

```js
export const DUTY_SCHEDULE = [            // m = clock minute; delay = s after the minute's beat finished
  { m: 1,  delay: 1, kind: 'patrol', round: 1 },
  { m: 4,  delay: 3, kind: 'fire',   alarm: 0 },
  { m: 6,  delay: 1, kind: 'patrol', round: 2 },
  { m: 7,  delay: 3, kind: 'fire',   alarm: 1 },
  { m: 9,  delay: 1, kind: 'patrol', round: 3 },
  { m: 11, delay: 2, kind: 'fire',   alarm: 2 },
  { m: 12, delay: 4, kind: 'logbook', stage: 2 },
];                                        // logbook stage 1 is requested by ventGate() when it completes
export const PATROL_CAMS = [1, 2, 4];
export const PATROL_DWELL = 1.2;          // s of feeds.isChannelObserved(n)
export const CHIRP_EVERY = 4;             // s; first chirp at gain 0.6
export const FIRE_AUTO_SILENCE = 45;      // s → silence('auto')
export const GATE_WAITS_FOR_FIRE = 30;    // a gate never starts while an alarm < 30 s old is ringing
export const IDLE_MINUTE = 10;            // P1
export const FAST_OK = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); // target minutes that may be shortened
```

`class Duties` (constructed by MonitoringState; `this.enabled = ctx.params.get('duties') !== '0'`):

| Member | Behaviour |
|---|---|
| `pending()` | `!f.blastLocked \|\| f.patrol.active \|\| f.fire.ringing` |
| `lockGate()` | Sets the right screen to `normalUnlocked`, refreshes the objective, nags (`hints.lockDoor`, 20/30 s), then awaits `until(() => f.blastLocked)`. When disabled it resolves at once and `cr.setBlastLocked(true,{duration:0})`. |
| `onLock()` (bus `blastDoor:lock`) | Guards on `blastLocking`. Plays `sfx('pneumaticHiss',{position:P.blastDoor,gain:.55})`, awaits `cr.setBlastLocked(true,{duration:2.4})`, plays `sfx('unlatch',{gain:.7})`. Then sets the flags, logs `doorLocked`, sets the right screen to `normal` and refreshes the objective. |
| `onMinute(m)` | For each `DUTY_SCHEDULE` entry with `d.m === m`: `state.wait(d.delay).then(() => this.start(d))`. |
| `start({kind})` | **patrol**: `f.patrol = {round, active:true, ready:false, seen:{1:0,2:0,4:0}, done:{…false}}`; `sfx('termBeep')` at the left screen; log `patrolStart`; objective. **fire**: `f.fire = {…, idx, ringing:true, t:0, chirp:0}`; `cr.setFireAlarm(panelState())`; log `fire[idx]` (tone warn); objective; nag `hints.fireAlarm` 25/40 s. If a call is ringing or talking, the start is deferred until it ends. **logbook**: `f.logbookWanted = stage`. |
| `update(dt)` (from `MonitoringState.tick`) | **Patrol:** accumulate `seen[n]` while `feeds.isChannelObserved(n)`. At `PATROL_DWELL`: `done[n]=true`, `sfx('termBeep',{done:true})`, `refreshLog()`; when all three are done, `ready = true` and refresh the objective. **Fire:** `t += dt`; the chirp timer runs, but there is no chirp while `intercomRinging \|\| intercomTalking`; `t > FIRE_AUTO_SILENCE` → `silence('auto')`. **Logbook:** every 0.25 s, if `logbookWanted > logbookStage && !inspect.isOpen && !gaze.isObserved(cr.objects.deskLogbook,{maxAngleDeg:60})`, then `cr.setDeskLogbook({stage, open:true})` and `sfx('paper',{position, gain:.32})`. |
| `onSign()` (bus `patrol:sign`) | `active = ready = false`; `signed.push(round)`; `cr.setPatrolForm({signed, ghost})` (fresh ink for this row); `sfx('penScratch',{duration:.9,gain:.6})`; log `patrolDone`. On `inspect:close` with `id === 'clipboard'`: `ghost = signed.length`, then `cr.setPatrolForm(…)`. The ghost layer therefore changes **while nobody is looking at it**. |
| `silence(how)` (bus `fire:silence` → `'op'`) | `ringing=false`; `history.push({idx, m, how})`; `cr.pressFireButton()` (when op); `cr.setFireAlarm(panelState())`; log `fireSilenced` / `fireAutoSilenced`. When op, open inspect `firePanel.body.silenced[idx]` (dim ramp 0.9 s; gaze = unseen). |
| `beforeGate()` / `afterGate()` | `gateActive = true` and the objective is left alone. `beforeGate` awaits `until(() => !f.fire.ringing \|\| f.fire.t >= GATE_WAITS_FOR_FIRE)`, then silences an alarm that is still ringing with `'auto'`. `afterGate` clears the flag and refreshes the objective. |
| `objective()` | Priority: `fireAlarm` → `lockDoor` → `patrolSign` → `patrol` → `watch03`. Does nothing while `gateActive`. |
| `refreshLog()` | Calls `setLeftLog(ctx)`, which composes static and dynamic lines (§4.3). |
| `applySkipped(start)` | `start ≥ 1` → locked. Each scheduled duty with `d.m < start` is completed silently: patrol is signed, ghost = rounds; fire history is `'op'`; the logbook stage is `start > 5 ? 1 : 0`, then `start > 12 ? 2`. Log lines are added in bulk, then form, panel and logbook are redrawn. |
| `snapshot()` / `trace` / `complete(kind)` | Debug hooks (§6.3). `trace` records `{t, clock, ev}` for minute, dutyStart, dutyDone, gateStart, gateDone, figureMoved (`feeds:figureMoved`) and idleStart/idleEnd. |

### 4.2 `src/states/MonitoringState.js`: about +70 LOC

```js
async enter(data) {
  this.duties = new Duties(this);            // construct BEFORE the existing preset/skip code
  if (ctx.debug && window.BS) window.BS.duties = this.duties;
  …  // existing: applyPreset; parse ?clock; then
  //   if (start > 0) { this.duties.applySkipped(start); this.applySkipped(start); }
  //   (duties first, so the existing vent-state setRight() calls win for start > 10)
  this.on('blastDoor:lock', () => this.duties.onLock());
  this.on('patrol:sign',   () => this.duties.onSign());
  this.on('fire:silence',  () => this.duties.silence('op'));
  this.on('inspect:close', (p) => this.duties.onInspectClose(p));
  await this.run(start);
}
async run(start) {
  for (let m = start; m <= 13; m++) {
    if (m > start) await this.minute(m);
    this.setMinute(m);
    this.duties.onMinute(m);
    await this.beat(m);
  }
}
async minute(next) {   // P1
  const ctx = this.ctx, spm = ctx.CLOCK.secondsPerMinute, t0 = ctx.clock.time;
  const fast = this.duties.enabled && FAST_OK.has(next);
  await this.until(() => {
    const e = ctx.clock.time - t0;
    return e >= spm || (fast && e >= IDLE_MINUTE && !this.duties.pending()
      && !ctx.inspect?.isOpen && !ctx.flags.intercomTalking);
  });
}
// beat(): case 0 → this.limits(0); await this.duties.lockGate(); break;
// intercomGate() / ventGate() / case 13: await this.duties.beforeGate() before ringIntercom/ventFault, then this.duties.afterGate()
// ventGate(): after completion → this.duties.wantLogbook(1)
// setObjective(ctx,'monitor') in the existing gates → this.duties.objective()
// tick(dt): + this.duties.update(dt)
// exit(): + this.duties.dispose()  (stops the chirp timer; fire.ringing = false without logging)
```

### 4.3 `src/states/common.js`: about +110 LOC

* **`resetFlags`**: add
  `blastLocked:false, blastLocking:false, patrol:{round:0,active:false,ready:false,seen:{},done:{},signed:[],ghost:0}, fire:{idx:-1,ringing:false,t:0,history:[]}, logbookStage:0, logbookWanted:0, dutyLog:[]`.
* **`pushDutyLog(ctx, key, vars, tone)`**: formats `SCRIPT.duty.log[key]` with `{t}` (= `flags.clockText`), `{n}` and `{1}{2}{4}`, then appends `{m: minuteOf(t), text}`.
* **`setLeftLog`**: merge static `logLinesUpTo` with `flags.dutyLog`, using a stable sort by minute. Show the **last 7** lines, plus the patrol footer while `patrol.active`.
  Tone is `warn` while `fire.ringing` or the clock is ≥ 02:12. The cache key becomes `lines.join('\n')+'|'+tone`, replacing the length-based key, which would not notice footer changes.
* **`resetWorld`**: after `cr.reset()` call `cr.setBlastLocked(false,{duration:0})`, `cr.setFireAlarm({mode:'idle'})`, `cr.setPatrolForm({signed:[],ghost:0})`, `cr.setDeskLogbook({stage:0,open:false,visible:true})` and `setRight(ctx, 'normalUnlocked')`.
* **`lateMonitoringWorld` / `restoredWorld`**: set `blastLocked = true` and `cr.setBlastLocked(true,{duration:0})`, history of 3 `'op'` silences, form `{signed:[1,2,3], ghost:3}`, logbook stage 2.
  `restoredWorld` also uses `cr.setFireAlarm({mode:'restored', lcd: S.duty.firePanel.lcd.history})` and `cr.setDeskLogbook({visible:false})` (the book is gone; the player has seen it burnt in the corridor).
* **Interactables** (`registerCommonInteractables`):

```js
const canLock = () => inState(ctx, STATES.MONITORING) && !f().blastLocked;
// blastDoor: replace the existing entry
add({ id: 'blastDoor', object: cr.blastDoor, distance: 2.6,
  label: () => (canLock() ? I.blastDoorWheel : I.blastDoor),
  verb:  () => (canLock() ? V.lock : V.inspect),
  enabled: () => !f().endingStarted && !f().blastLocking,
  onUse: () => canLock() ? emit('blastDoor:lock')
    : openInspect(ctx, { id: 'blastDoor', title: I.blastDoor,
        body: [f().blastLocked ? S.prompts.blastDoorLocked : D.blastDoorUnlocked] }) });

add({ id: 'clipboard', object: cr.clipboard, distance: 2.1,
  label: I.clipboard, verb: () => (f().patrol?.ready ? V.sign : V.inspect),
  onUse: () => {
    const p = f().patrol, B = S.duty.patrolForm.body;
    const key = p.ready ? `r${p.round}` : (p.signed.length ? `r${p.signed.at(-1)}` : 'peek');
    if (p.ready) emit('patrol:sign', {});              // the ink is drawn synchronously, before the clone renders
    else T(() => ctx.audio?.sfx?.('paper', { position: wp(cr.clipboard), gain: 0.5 }));
    openInspect(ctx, { id: 'clipboard', title: S.duty.patrolForm.title, body: B[key], object: inspectClone(cr.clipboard) });
  } });

add({ id: 'firePanel', object: cr.firePanel, distance: 2.2,
  label: () => (f().fire?.ringing ? I.fireSilence : I.firePanel),
  verb:  () => (f().fire?.ringing ? V.press : V.inspect),
  onUse: () => f().fire?.ringing ? emit('fire:silence', {})
    : openInspect(ctx, { id: 'firePanel', title: I.firePanel, body: firePanelBody() }) });
  // firePanelBody(): restored → body.restored; last silenced idx → body.silenced[idx]; else body.idle

add({ id: 'deskLogbook', object: cr.deskLogbook, distance: 2.0,
  label: I.deskLogbook, verb: V.inspect, enabled: () => cr.deskLogbook?.visible !== false,
  onUse: () => { T(() => ctx.audio?.sfx?.('paper', { position: wp(cr.deskLogbook), gain: 0.7 }));
    openInspect(ctx, { id: 'deskLogbook', title: S.duty.logbook.title,
      body: S.duty.logbook.stages.slice(0, f().logbookStage + 1).flat(), object: inspectClone(cr.deskLogbook, true) }); } });

// coffee: stage 0 and clockText >= '02:08' in MONITORING → body = [...stages[0], S.duty.coffeeStillHot]
```

`inspectClone(cr.clipboard)` shares the material, so InspectView renders the **live** form texture. The deskLogbook clone uses `fresh = true` so the open/closed visibility at that moment is copied.
The ending's `allowed(id)` filter already disables all of these once `unlockArmed`.

### 4.4 `src/world/ControlRoom.js`: about +110 LOC

* **`setBlastLocked(locked, {duration = 2.4} = {}) → Promise`**: reuses `_token('blast')` and `parts.blast.{wheel,bolts}`.
  The wheel turns `∓2.5π` in `0.7·duration` (`inOut`), then the bolts move `0.12 → 0` (locked) or `0 → 0.12` in `0.3·duration`. `_blastState` goes `'locking' → 'locked'` or becomes `'unlocked'`; `duration ≤ 0` snaps.
  The lamp branch in `update()` gains `'unlocked'` (green 0.7) and `'locking'` (amber, the same 1.4 s cosine as `'opening'`).
  `openBlastDoor()` already assumes bolts at 0, so the ending works unchanged after the player's lock. `reset()` stays locked, and `resetWorld` unlocks it explicitly.
* **`setFireAlarm({mode, idx, lcd})`**: `mode ∈ idle|ring|held|restored`. It redraws only the LCD rectangle of the face canvas (and the taped-lamp rim intensity: 0.25, or 0.45 at `idx === 2`; restored = curled tape) and stores `this._fire = {mode}`.
  In `update()`: master and B LEDs use `ring: k = rf ? 0.8 : 0.3 + 0.7·(0.5 − 0.5·cos(2πt/2.4))`, `held: 0.35`, `restored: all zones 0.35`, `idle: 0`, all × `power·live` like the other LEDs, through `_applyLed`.
* **`pressFireButton()`**: a 0.07 s / 0.16 s press tween on `parts.fire.btn`, copying `pressCamButton`.
* **`setPatrolForm(state)`**: `this.patrolForm.draw(state)`, then `texture.needsUpdate = true`.
* **`setDeskLogbook({stage, open, visible})`**: toggles the closed and open meshes and redraws the right page when `stage` changes.
* **`reset()`**: `setFireAlarm({mode:'idle'})`, `setPatrolForm({signed:[],ghost:0})`, `setDeskLogbook({stage:0,open:false,visible:true})`.

### 4.5 `src/world/controlRoom/buildFireAlarm.js`: NEW, about 170 LOC (called from `buildFixtures()`)

* Layout key `CONTROL_ROOM.firePanel = { x: 3.955, y: 1.42, z: -0.5 }`, facing −X (`rotation.y = −π/2`), on the east wall between the vent panel (z −1.6) and the flashlight box (z 0.75).
* **Body.** Batcher `rbox('panelGrey', 0.36, 0.46, 0.07, 0.008)` plus an `extRed` top band (0.36 × 0.06). A conduit `cyl('pipe', 0.012)` runs up to the east cable tray (`TY`), in the same style as the vent-panel pipes in `buildShell.buildServices`.
* **Face.** `PlaneGeometry(0.34, 0.44)` with a 512 × 640 CanvasTexture from `drawFireFace(g, S, state)`:
  * cream enamel `#d9d6cc`, with a red title band carrying `S.duty.firePanel.title`;
  * a 3 × 2 grid of zone windows (labels `zones`, each with a dark printed lamp socket);
  * the **`主車道` socket covered by a black electrical-tape quad** (rotated 0.08 rad, two sheen highlights) with a red radial rim, alpha from state;
  * an amber-on-black LCD rectangle (432 × 96, `FONTS.mono` 28 px, two lines, redrawn only on change);
  * printed `音響停止` and `復歸` labels;
  * a **masking-tape strip** (`#e8dcb0`, rotated −0.04) with `handwriting(g, [tape], …, { color: HAND.color, seed: HAND.seed + 7, size: 24 })`, the same hand as the sticky note.
* **LEDs**: `SingleLed({radius: .008, glowTex: room.glowTex, glowSize: .05})` for the master `火警` lamp and the 5 untaped zones, placed by canvas UV, the same `at(u,v)` approach as `buildVentPanel`. The taped zone has no LED; its glow is drawn into the canvas, so no sprite can bleed over the tape.
* **Physical button**: `CylinderGeometry(.024,.024,.018)` `extRed` over the printed `音響停止`, plus a small grey dummy `復歸` button. Add `hitbox(0.4, 0.5, 0.1)`.
* Exposes `room.objects.firePanel` and `room.parts.fire = { canvas, g, tex, leds, btn }`.
* **No lights; about 4 draw calls** (batched body + face + 2 buttons; the LEDs share `room.leds`-style sprites).

### 4.6 `src/world/controlRoom/patrolForm.js`: NEW, about 160 LOC

* `class PatrolForm { constructor(S); draw({signed, ghost}); texture; }`, with a 512 × 680 canvas and `canvasTexture(c, {wrap:false, anisotropy:8})`. It replaces `LT.formTexture()` on the clipboard.
* **Printed layer**: header and sub (`FONTS.ui`), a table with columns `[70, 70, 58, 58, 58, 120, 50]` px and 4 rows of 112 px, 1 px rules, the footer, and the existing `stain()` coffee ring.
* **Ink helpers**:
  * `tick(g, x, y, s, seed)`: a 3-point hand check stroke with jitter;
  * `sig(g, x, y, seed)`: a seeded Bézier scribble, so the signature never shows a name and the 阿哲 ambiguity in DESIGN-NOTES D1 is preserved;
  * text via `canvasUtil.handwriting()` in `HAND.color`.
* **Ghost layer** (drawn first): `globalAlpha .28`, ink `#7d8597`, the same seeds as the fresh layer plus a 0.6 px offset, so new ink lands on the ghost as a double-strike.
  * `ghost ≥ 0`: ticks in rows 1–3; notes `ink.r1` (row 1) and `ink.r2` (row 2).
  * `ghost ≥ 1`: a strike line through row-2 `白車`; row-3 note `ink.r3`.
  * `ghost ≥ 2`: row-4 time `ink.r4` plus a long wavy stroke (`bezierCurveTo`, width 2.2) from the 時間 cell out to `x = 512`.
* **Fresh layer**: for each `signed` row, ticks in the 3 CAM cells, the time (`clockText`) and the signature.

### 4.7 `src/world/controlRoom/deskLogbook.js`: NEW, about 130 LOC

* Layout key `CONTROL_ROOM.deskLogbook = { x: 0.8, z: -2.48, ry: -0.18 }`. That spot is free since `coffee` moved to x −0.8 in `ea092f0`. It is about 1.3 m from the seat.
* **Closed book**: `BoxGeometry(0.215, 0.026, 0.3)` with `[edge, edge, cover, back, edge, edge]`. The cover map is `logbookCover(S, { burnt: false })` (§4.9) and the edges use `TX.pageEdgeTexture()`.
* **Open book**: two `PlaneGeometry(0.205, 0.29)` pages (±0.105 m, `rotation.z ±0.04` for the V), a thin spine `CylinderGeometry`, and 512 × 720 page canvases.
  * The left page holds "earlier nights": the same three lines in three ink densities.
  * The right page holds tonight: `S.duty.logbook.page` lines up to the stage, written with `handwriting()` in `HAND.color`. Stage 2's last line uses `jitter: 2.2` and slant drift.
* Add `hitbox(0.45, 0.06, 0.32)` and expose `room.objects.deskLogbook`.

### 4.8 `src/world/controlRoom/buildConsole.js`: about +20 / −12 LOC

* Turn the batched clipboard (`M = T({x:-1.62, …, ry:0.18})`) into its own `Group 'clipboard'`: the board `rbox` mesh, the clip, and the form plane using `room.patrolForm.texture`.
  Read the position from the new layout key `CONTROL_ROOM.clipboard = { x: -1.62, z: -2.47, ry: 0.18 }`, add `hitbox(0.26, 0.04, 0.34)`, and set `room.objects.clipboard = group`.
* Call `buildDeskLogbook(room)`.

### 4.9 Textures and audio: about +45 LOC

* `src/gfx/textures/items.js`: `logbookCover(SCRIPT, { burnt = true } = {})` skips the two soot `stain()` calls and `burnEdges()` when `burnt` is false. `TextureFactory.createLogbook({ burnt })` passes it through.
* `src/audio/sfx.js`:
  * `panelChirp(v, t)`: `tone(v,o,t,1175,.5,.09,{a:.012})`, then `tone(v,o,t+.13,880,.5,.12,{a:.012})`, `v.send(o,'room',.18)`, returns 0.6. This is a soft annunciator pip, not a bell.
  * `termBeep(v, t, o)`: a single `tone(..., o.done ? 990 : 660, .4, .07, {a:.008})`.
  * `AudioEngine.SFX_GAIN`: `panelChirp: 0.12, termBeep: 0.08` (targets −26 and −30 dBFS at 1 m, then calibrated with the existing analyser method). Add both to the header list.

### 4.10 `src/data/layout.js` (shared file: flag it in the final report): +3 keys

`clipboard`, `firePanel` and `deskLogbook` in `CONTROL_ROOM` (values above).

### 4.11 `src/states/PrologueState.js`: no change

`resetWorld` (§4.3) already shows `normalUnlocked` and the green lamp during the prologue. A player who inspects the door before reading the note gets `D.blastDoorUnlocked`, which points them toward the note.

### 4.12 Docs: about 50 lines

* `ARCHITECTURE.md` §8: new rows `02:00 GATE 鎖定防爆門` and the duty schedule; new bus events `blastDoor:lock`, `patrol:sign`, `fire:silence`; new `ControlRoom` methods.
* `DESIGN-NOTES.md`: new section **A5 第一幕的值班工作（玩家能動性）**, with the thesis from §1.2, the payoff map, `?duties=0`, and why the sticky note does not evolve.
* Update the `MonitoringState.js` header table.

---

## 5. Comfort and golden-rule check

| Element | Visual change | Frame brightness | Audio | `reduceFlicker` | Jump-scare / spoiler check |
|---|---|---|---|---|---|
| D0 lock | Wheel 1.7 s, bolts 0.7 s; door lamp (≈1 cm LED) green → amber breathing → red, with an 8/s colour lerp | < 0.5 % of the frame | `pneumaticHiss` ×0.55 (≈ −21 dBFS), `unlatch` ×0.7; existing calibrated sounds | Lamp breathing becomes steady amber | Nothing appears; the player stands at a closed door. **Spoiler:** none, since the note told them to do it. |
| D1 patrol | SYS LOG text and footer; channel switches use the existing AGC crossfade | The side-screen tone uses the existing shader damp | `termBeep` ≤ −30 dBFS, attack 8 ms | Unchanged (existing terminal handling) | None. **Spoiler:** the faint ticks are uncanny but unexplained; `白車` is struck through while the car is still visibly on CAM-04, so it is doubt, not proof. |
| D1 form ink | The texture changes at signing (seen in InspectView) and the ghost layer changes after closing (unobserved) | Paper-sized area, ink only | `penScratch` ×0.6 for 0.9 s | – | The change is narrated in text, never shown as a pop. |
| D2 panel lamps | Two LEDs breathe with a 2.4 s cosine (0.3 → 1.0), meeting the ≥ 0.4 s period rule | LED plus 5 cm glow sprite: ≪ 1 % of the frame | – | **Steady 0.8** | – |
| D2 chirp | – | – | Two sine pips, 12 ms attack; target **≤ −26 dBFS** at 1 m (first pip ×0.6), every 4 s, at most 45 s per alarm. Muted during ring and calls; muffled by `setSilence` after 02:12. | – | Soft, expected and placed in space (HRTF from the east wall). It is a cue, not a stinger, and is never louder than the intercom ring. |
| D2 LCD / tape rim redraw | Text in a 13 × 4 cm area | ≪ 1 % | – | – | **Spoiler:** the taped lamp reads as "broken"; the manual call point says "a person", which the note already claims ("the driver"). |
| D2 silence inspect | InspectView dim ramp 0.9 s (existing, compliant) | Existing | `button` ×0.8 | Existing | – |
| X1 logbook | Closed/open swap **only while not within 60° of view** and no inspect is open | Never seen | `paper` ×0.32 (≈ −30 dBFS); muffled during the vacuum | – | Audio dislocation (§3.5). No sudden sound, nothing near the camera. **Spoiler:** `02:05 有人在敲防爆門` matches what intercom 2 implies anyway. |
| M1 coffee | Text only | – | – | – | – |
| P1 fast-forward | The clock ticks sooner (existing per-minute changes only) | – | – | – | Never applied to 02:11/12/13, so the vacuum and detune keep their length. |
| Performance | No new lights. About +7 draw calls (panel 4, logbook 2, clipboard 1). Three 512 × ~680 canvases (≈ 4 MB VRAM). The gaze raycast for the logbook runs at most every 0.25 s and only while a stage is waiting. | | | | |

Every ramp is ≥ 0.4 s or confined to a sub-1 % LED area, and no sound exceeds the existing −10 dBFS ceiling (the targets sit 15 dB below it). Nothing is placed in front of the camera.

---

## 6. Risks, cut list, testing

### 6.1 Risks and mitigations

| Risk | Mitigation |
|---|---|
| **It feels like chores** and kills the atmosphere the owner likes | Every duty is 5–20 s and ends in a discovery. There is no fail state. Alarms silence themselves. The 02:12 vacuum is left untouched. Patrol dwell is 1.2 s, not "watch for 10 s". If play-testing says "busy", cut R3 first (§6.2). |
| **Too much walking** (west → east → west) | The trips *are* the blind spot. Each is ≤ 7.5 m (≈ 5 s at 1.45 m/s). The fire panel sits next to the vent panel, so FA1 and the 02:05 vent fault share a single trip. |
| **Audio clutter** (ring, chirp, beep, heartbeat) | No chirp while ringing or talking. A gate waits (≤ 30 s) for an alarm to be handled, then auto-silences it. `termBeep` only plays at round start and on ticks. |
| **Spoils the reveal** | §5 spoiler column. No line in Act 1 says car / firefighter / three years / death. Every clue is deniable until the Act-3 report puts the timestamps side by side. |
| **The lock gate changes A3** | It is a fixed-minute gate with a player action, the same shape as 02:05. Document it as A5. The CAM-03 rule and `GATE_LIMITS` are unchanged. |
| **Loop / direct-entry consistency** | `resetWorld` unlocks and clears everything; `lateMonitoringWorld` and `restoredWorld` set the completed state; `applySkipped` handles `?clock=`. Test matrix in §6.3. |
| **Conflicts with fixes in flight** (`ControlRoom`, `CameraFeeds`, `common.js` were touched in `ea092f0` / today) | Only additive APIs are used: `setBlastLocked`, `setFireAlarm`, `setPatrolForm`, `setDeskLogbook`; `feeds.isChannelObserved` (present at L214); `interact.trigger`. The only behaviour edits are the `blastDoor` interactable and `setLeftLog`'s cache key. |
| **Incident report line count** (8 → 9) | The SideScreen auto-fits (`lh = min(38, avail/lines)`). At 9 lines the font is about 19 px. Check with `side_left`-style shots; fallback: drop `02:00 …` and keep `防爆門：由內部反鎖。`. |
| **Copy volume** | About 60 strings, all in one `duty` block. Bodies are 2–4 short paragraphs, each with at most one handwriting quote. |

### 6.2 Cut list (implement in this order; stop when out of time)

1. **D0 lock gate**: about 120 LOC including copy. Highest value per line, since it creates the strongest guilt link (lock → `門……打不開` → report → unlock).
2. **D2 fire panel, 3 alarms, and the report line**: about 300 LOC. Cheaper fallback: no 3D panel; put the `音響停止` interaction on the right console wing's existing `消防` label strip and the LCD lines on the right side screen.
3. **D1 patrol with static ghosts**: about 250 LOC. Cut order inside D1: ghost evolution (keep stage 0 only), then R3, then the clipboard signing (auto-complete on three ■; the form stays inspectable).
4. **P1 idle fast-forward**: about 20 LOC. Drop it if `proposal-pacing.md`'s adaptive clock lands; expose `duties.pending()` to that director instead.
5. **X1 logbook**: about 160 LOC. Cut the open/closed mesh swap first (inspect stages and rustle only).
6. **M1 coffee and the Act-3 panel history**: about 15 LOC.

Not recommended now:
* a desk-phone duty (`通報拋錨車輛` → busy tone and a last-call LCD), because it needs new phone audio;
* a drawer full of identical sticky notes, because it duplicates the loop clue already carried by D1 and X1.

### 6.3 How to test

**Debug hooks** (with `?debug=1`):
* `BS.duties.snapshot()` → `{minute, gateActive, pending, blastLocked, patrol:{round,done,ready,signed,ghost}, fire:{idx,ringing,t,history}, logbook:{stage,wanted}, idleFor}`.
* `BS.duties.complete('lock'|'patrol'|'sign'|'fire')` emits the same bus events a player would; for patrol it sets `done[n]` as if each channel had been watched.
* `BS.duties.trace` → `[{t, clock, ev}]`.
* `?duties=0` gives the current behaviour (an A/B and regression switch).
* Existing: `?state=MONITORING&autostart=1`, `?clock=02:06`, `?speed=4`.

**Direct-entry matrix** (screenshot plus snapshot each, with `scripts/shot.mjs`):

| Entry | Expect |
|---|---|
| `?state=PROLOGUE` | Door lamp green; right screen `未鎖定 ▲`; panel idle; form ghost 0; logbook closed |
| `?state=MONITORING` | Objective `鎖定防爆門`; the clock holds at 02:00 for more than 17 s with no input |
| `?clock=02:06` | Locked; R1 signed with ghost 1; FA1 silenced (history 1); logbook stage 1, open; SYS LOG shows the three dynamic lines |
| `?clock=02:13` | Everything complete; ghost 3; history 3; logbook stage 2 |
| `?state=BLACKOUT_CORRIDOR` / `REVELATION` / `ENDING_LOOP` | Locked; `restored` panel and LCD history in REVELATION/ENDING; logbook hidden in REVELATION and later; the incident report has 9 lines and is readable |
| Ending → `再次交接` | Unlocked again; duties reset; tallies are unaffected |

Shots to add:
* door wheel: `--eval "BS.player.teleport({x:-3.25,z:-0.2,yaw:Math.PI/2,pitch:0,seated:false})"`;
* panel ringing: `--eval "BS.duties.complete('lock'); BS.duties.start({kind:'fire',alarm:1}); BS.player.teleport({x:3.25,z:-0.5,yaw:-Math.PI/2,pitch:0,seated:false})"`;
* form after R2: `?clock=02:09` plus `BS.interact.trigger('clipboard')`;
* logbook open: `?clock=02:13`, teleported over the desk.

**Pure timing simulation** (no browser; safe to run anytime): `scripts/duty-sim.mjs`, about 120 LOC.
* It imports `DUTY_SCHEDULE`, `IDLE_MINUTE` and `FAST_OK` from `src/states/duties.js`; the constants block has no THREE import, so split it into `dutySchedule.js` if needed. It also uses the `SCRIPT.intercom` durations.
* It simulates three player profiles: reaction time 1 / 3 / 8 s, walk speed 1.45 m/s, room coordinates from `LAYOUT`, read time 4 / 8 / 14 s.
* It prints the timeline table from §2.3 and asserts:
  * typical act length **230–290 s**;
  * max idle gap **≤ 12 s** outside the 02:12 minute;
  * at least 7 look-away trips that follow a CAM-03 view (so all 7 figure steps are reachable);
  * no chirp window overlapping a ring or call window.

**Headless bot** (run later, when the 4-CPU machine is free, with SwiftShader at `?speed=3&debug=1&autostart=1&state=MONITORING`): `scripts/duty-bot.mjs`, about 150 LOC with playwright.
* It drives the game only through `BS` and asserts as above:
  * sit and face the CRT (`teleport` to the seat) to watch;
  * `BS.feeds.setChannel(n)` for patrol;
  * teleport plus `BS.interact.trigger('blastDoor'|'clipboard'|'firePanel'|'intercom'|'vent')` for actions.
* It records `BS.duties.trace` and `feeds:figureMoved`.
* It checks that **every figure move happened while `!gaze.mainScreenObserved`** and that the figure reaches 7 before `STATE_BLACKOUT_CORRIDOR`.

**Audio and comfort**:
* Peak-meter `panelChirp`, `termBeep` and the lock sequence with the existing analyser method used for `SFX_GAIN`; targets ≤ −26, ≤ −30 and ≤ −18 dBFS.
* Capture frames at 10 Hz through the lock and an alarm (seated and standing; `reduceFlicker` on and off) and verify that the mean-luminance change over every 0.25 s window is ≤ 30 %. Expect under 1 %, because only LEDs change.

### 6.4 Compatibility with the other two proposals

* **Motion-detection alerts** (`proposal-feeds.md` / `proposal-pacing.md`): the alerts are event-driven ("look at n now") and the patrol is routine ("check all"), so they complement each other. If both ship, keep R1 and R3, let the alerts fill 02:06, and have an alert acknowledgement also tick the open round. The patrol then guarantees the player visits every changed channel.
  Keep the sounds distinct: the alert tick comes from the console, the fire chirp from the east wall.
* **Vent gate moved to 02:11** (pacing proposal): move FA3 to `{ m: 10, delay: 3 }` so the player is already at the east wall when the 02:11 vent beat comes. Logbook stage 1 then triggers on the proposed 02:05 knock (`flags.doorKnocked`) instead of the vent gate, which makes `02:05 有人在敲防爆門。` literal. The report line `02:04 起 …三次` still holds.
* **Adaptive clock**: replace P1 with that director and feed it `duties.pending()` and `duties.beforeGate()`.
