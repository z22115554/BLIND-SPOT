// =============================================================================
// uiCommon — UI / Subtitles / InspectView 共用的 DOM 小工具
// （HTML 跳脫、**粗體** / *斜體* 標記解析、樣式注入、淡入淡出）
// =============================================================================

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** HTML 跳脫（所有來自文案的字串都必須先經過這裡才能放進 innerHTML）。 */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/**
 * 簡易標記 → 安全 HTML：先跳脫，再把 **粗體** → <strong>、*斜體* → <em>。
 * sfx = true 時，把全形括號內的聲音描述（例如「（急促且沉重的喘息聲）」）包成 .bs-sfx（字幕用）。
 */
export function renderMarkup(s, { sfx = false } = {}) {
  let h = escapeHtml(s);
  h = h.replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*]+?)\*/g, '<em>$1</em>');
  if (sfx) h = h.replace(/（[^（）]*）/g, '<span class="bs-sfx">$&</span>');
  return h;
}

/** 整段文字是否完全包在一組 *斜體* 之內（日誌的手寫段落）。 */
export function isWhollyItalic(s) {
  const t = String(s ?? '').trim();
  if (t.length < 3 || t[0] !== '*' || t[t.length - 1] !== '*' || t.startsWith('**')) return false;
  return (t.match(/\*/g) || []).length === 2;
}

/** 注入 <style>（同一 id 只注入一次）。 */
export function injectStyle(id, css) {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const st = document.createElement('style');
  st.id = id;
  st.textContent = css;
  document.head.appendChild(st);
}

/** #ui-root（萬一模板沒有就自己建立一個，確保不丟例外）。 */
export function uiRoot() {
  let root = document.getElementById('ui-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'ui-root';
    root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:10';
    document.body.appendChild(root);
  }
  return root;
}

/** 建立元素：el('div', 'cls a', '文字') */
export function el(tag, cls = '', text = null) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * 以 CSS opacity 轉場淡入/淡出元素（.is-on = 可見）。淡出完成後設 hidden（不擋滑鼠、不佔版面）。
 * 只做緩慢的透明度變化，符合「不得閃爍」規則。回傳 Promise（轉場時間結束時 resolve）。
 */
export function reveal(node, on, ms = 500) {
  if (!node) return Promise.resolve();
  node._bsFade = (node._bsFade || 0) + 1;
  const tok = node._bsFade;
  node.style.transitionDuration = `${Math.max(0, ms)}ms`;
  if (on) {
    if (node.hidden) {
      node.hidden = false;
      void node.offsetWidth; // 強制重排，讓 opacity 由 0 開始轉場
    }
    node.classList.add('is-on');
  } else {
    node.classList.remove('is-on');
  }
  return new Promise((resolve) => {
    setTimeout(() => {
      if (!on && node._bsFade === tok) node.hidden = true;
      resolve();
    }, Math.max(0, ms) + 30);
  });
}

/** 共用 CSS token（UI 先注入；Subtitles / InspectView 也會呼叫，確保單獨使用時也有變數）。 */
export function baseCss(FONTS) {
  return `
#ui-root {
  --bs-fg: var(--fg, #d9d4c7);
  --bs-dim: var(--dim, #8a857a);
  --bs-accent: var(--accent, #d8b04a);
  --bs-alert: var(--alert, #b3362c);
  --bs-amber: rgba(216, 176, 74, 0.82);
  --bs-amber-soft: rgba(216, 176, 74, 0.38);
  --bs-rule: rgba(217, 212, 199, 0.14);
  --bs-rule-strong: rgba(217, 212, 199, 0.3);
  --bs-bright: #f1ecdf;
  --bs-shadow: 0 0 0.3em rgba(0, 0, 0, 0.95), 0 0 1.1em rgba(0, 0, 0, 0.6);
  --bs-ui: ${FONTS.ui};
  --bs-mono: ${FONTS.mono};
  --bs-serif: ${FONTS.serif};
  --bs-hand: ${FONTS.hand};
  font-family: var(--bs-ui);
  font-size: clamp(13px, calc(7px + 0.4vw + 0.2vh), 30px);
  line-height: 1.5;
  color: var(--bs-fg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
#ui-root [hidden] { display: none !important; }
#ui-root *, #ui-root *::before, #ui-root *::after { box-sizing: border-box; }
`;
}
