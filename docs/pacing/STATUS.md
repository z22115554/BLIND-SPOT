# 中段節奏重做：進度與接續方式（存檔點）

最後更新：2026-11-20 12:27 UTC（因五小時用量上限暫停前的存檔）

## 已完成並已在本分支（ccr-98a0543d-oehy6f）

- 審查修正全部合併：廊道/監視畫面、主控室/終幕、系統層。內容見 `docs/review/fixpass-notes.md`。
- 這版已打包成 `dist/blind-spot.html`，煙霧測試 6/6 通過，Artifact 也是這一版。
- 中段節奏設計定稿：`docs/pacing/spec.md`。三份提案在 `docs/pacing/proposal-*.md`。
- 三個工作包的進度以 checkpoint 合併進本分支的 `src/`。三包合起來可以打包，但**尚未整合驗證**，`dist/`、`index.html` 仍是上面那個穩定版。

| 工作包 | 分支 | 狀態 |
|---|---|---|
| WP-A 畫面內容 | `wp-a` | `anomalies.js` 四台攝影機的各階段異常、`setStage` API、LD 細微姿勢、可讀性調整、`feed-stages.mjs` 截圖工具 |
| WP-B 提示系統 | `wp-b` | CameraFeeds 動態偵測 API（alert/ack/stage guard/凍結時間/OSD 標記）；CAM 按鈕琥珀燈；`setBlastLocked`；`vmdTone`/`doorKnock`（座位峰值約 -30 dBFS）；`pacing-run.mjs` 自動計時工具（WIP） |
| WP-C 導演/時鐘 | `wp-c` | `script.js` 補充文案與 02:05 修正；`monitoringDirector.js`（PACE/SCHEDULE，零 import）；`MonitoringState` 接線；02:00 鎖門閘門；敲門/日誌；`common.js`；`pacing-sim.mjs` 節點模擬 |

## 尚未完成

1. 各工作包代理在暫停時可能還沒做完。接續時先看各分支 `git log c0f21d5..wp-x`，以及代理最後的進度。
2. **整合**：在 `pacing-int` worktree 合併 wp-a/b/c，接好介面，然後跑這些：
   - `node scripts/pacing-sim.mjs`
   - `scripts/pacing-run.mjs`（`?speed=N` 量這一幕的長度和最長空檔，目標見 spec §2/§9）
   - 每個異常的截圖、舒適度量測、煙霧測試
3. 修正審查時留下的殘餘項目：
   - 02:14 跳電時主控室燈光每 0.25 s 降約 32%（`ControlRoom.setLighting('emergency')`）
   - 直接進入 BLACKOUT_CORRIDOR 的淡入
   - 終幕在 reduceFlicker 模式下還沒跑過
4. 審查：一位審查員實際試玩監看這一幕，一位審查程式與迴歸問題；之後修正。
5. 文件：依 `docs/review/fixpass-notes.md` 和各工作包的 docNotes，更新 ARCHITECTURE / DESIGN-NOTES / README。
6. 完整打包：`node scripts/build.mjs` 會同時產生 `dist/blind-spot.html` 和根目錄 `index.html`。之後提交、推送，並更新 Artifact。

## 接續指令（同一個 session）

- 實作 workflow 的指令稿：`~/.claude/projects/-home-user-BLIND-SPOT/<session>/workflows/scripts/blindspot-pacing-implement-wf_fcfc4198-acb.js`。
  - WP-C 與 WP-A：run `wf_fcfc4198-acb`，args `["wp-c","wp-a"]`。
  - WP-B：run `wf_c8103348-172`，args `["wp-b"]`。
  - 用 `resumeFromRunId` 重跑時，已完成的 agent 會從快取回傳；被中斷的 agent 會重新開始。prompt 說明它要從 worktree 現有的提交接著做。
- prompt 檔在 scratchpad 的 `impl/prompt-wp-*.md`。如果 scratchpad 不見了，可以照 spec §11 重寫。
- 背景自動存檔腳本在 scratchpad 的 `autosave.sh`：每 10 分鐘把 wp-a/b/c/pacing-int 的新提交合併到本分支並推送。

## GitHub Pages

打包時會在根目錄產生 `index.html`，另有 `.nojekyll`。到 Settings → Pages 選 Deploy from a branch，分支 `ccr-98a0543d-oehy6f`，資料夾 `/ (root)`。私有倉庫在免費方案下需要先公開。

## 更新 2026-11-20 14:30 UTC

- 三個工作包都已合併：WP-B、WP-C 已完成。WP-A 被限額中斷，剩下「實測各階段 meanScale」，已交給整合者處理。實作報告在 `docs/pacing/results/`。
- **整合 → 審查 → 修正**的 workflow 已在 `pacing-int` worktree 啟動。
  - run id `wf_abcae2af-01b`，指令稿 `workflows/scripts/blindspot-pacing-integrate-wf_abcae2af-01b.js`。
  - 中斷後用 `resumeFromRunId` 重跑：已完成的階段從快取取回，被中斷的代理會從 `pacing-int` 現有的提交接著做。
- 自動存檔每 10 分鐘把 `pacing-int` 合併到本分支並推送。
