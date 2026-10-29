// Typing itself happens in background.js (real keystrokes via the debugger API).
// This script (1) lets the Esc key stop a run or countdown, and (2) tracks what you highlight
// and offers a "Type in 5s" button next to it.
(() => {
  const runtime = chrome.runtime;
  if (window.__cpTyperAlive && window.__cpTyperAlive()) return;
  window.__cpTyperAlive = () => {
    try {
      return !!runtime.id;
    } catch {
      return false;
    }
  };

  const AUTOTYPE_SECONDS = 5; // the countdown itself runs in background.js; this is only for the label
  let running = false;
  let counting = false;
  let enabled = true;
  let current = null; // { text, rect } of the highlight the button is offered for

  const send = (msg) => {
    try {
      runtime.sendMessage(msg);
    } catch {
      // extension was reloaded; the page needs a refresh
    }
  };

  // On the local typer's own page, hand its access token to the extension so the two can pair.
  const isTyperPage = location.origin === 'http://127.0.0.1:8765' || location.origin === 'http://localhost:8765';
  if (isTyperPage) {
    const grab = () => {
      const meta = document.querySelector('meta[name="cptyper-token"]');
      if (meta && /^[0-9a-f]{48}$/.test(meta.content)) send({ type: 'typer-token', token: meta.content });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', grab);
    else grab();
  }

  try {
    chrome.storage.local.get({ showOnSelect: true }).then((v) => (enabled = v.showOnSelect !== false));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.showOnSelect) return;
      enabled = changes.showOnSelect.newValue !== false;
      if (!enabled && !counting) hide();
    });
  } catch {
    // storage unavailable (stale script); the button just stays on
  }

  // --- floating widget (shadow DOM so page styles can't touch it) -----------------------

  let host = null;
  let ui = null;

  function build() {
    host = document.createElement('div');
    host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647; top: 0; left: 0;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font: 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; }
        .card { display: none; flex-direction: column; align-items: stretch; gap: 6px; padding: 8px; max-width: 290px; border-radius: 12px;
                background: #15161c; color: #f3f4f8; border: 1px solid rgba(255,255,255,.12);
                box-shadow: 0 8px 28px rgba(0,0,0,.35); user-select: none; }
        .card.show { display: flex; animation: pop .14s ease-out; }
        @keyframes pop { from { opacity: 0; transform: translateY(4px) scale(.97); } to { opacity: 1; transform: none; } }
        button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 7px;
                 padding: 7px 12px; border-radius: 8px; font-weight: 600; white-space: nowrap; }
        .go { background: #6c63ff; color: #fff; }
        .go:hover { background: #7f77ff; }
        .go svg { width: 15px; height: 15px; }
        .cancel { color: #c5c7d3; font-weight: 500; }
        .cancel:hover { background: rgba(255,255,255,.1); color: #fff; }
        .count { display: none; align-items: center; gap: 10px; padding: 2px 4px 2px 8px; }
        .num { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center;
               background: #6c63ff; font-weight: 700; font-size: 16px; font-variant-numeric: tabular-nums; }
        .msg b { display: block; font-weight: 600; }
        .msg span { color: #aab; font-size: 12px; }
        .tip { padding: 2px 4px 0; }
        .tip b { display: block; font-weight: 600; }
        .tip span { color: #b4b7c6; font-size: 12px; }
        .card.counting { max-width: 420px; }
        .card.counting .go, .card.counting .tip { display: none; }
        .card.counting .count { display: flex; }
      </style>
      <div class="card" id="card">
        <div class="tip"><b id="tipTitle"></b><span id="tipText"></span></div>
        <button class="go" id="go" title="Types the highlighted text into the next field you click">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>
          <span id="goLabel">Type in ${AUTOTYPE_SECONDS}s</span>
        </button>
        <div class="count">
          <div class="num" id="num">${AUTOTYPE_SECONDS}</div>
          <div class="msg"><b id="msgTitle">Go to the target place now</b><span id="hint">Click inside the field to type into</span></div>
          <button class="cancel" id="cancel">Cancel</button>
        </div>
      </div>`;
    ui = {
      card: root.getElementById('card'),
      tipTitle: root.getElementById('tipTitle'),
      tipText: root.getElementById('tipText'),
      msgTitle: root.getElementById('msgTitle'),
      go: root.getElementById('go'),
      num: root.getElementById('num'),
      hint: root.getElementById('hint'),
      cancel: root.getElementById('cancel'),
    };

    // keep the page's highlight alive when the widget is pressed
    host.addEventListener('mousedown', (e) => e.preventDefault(), true);

    ui.go.addEventListener('click', () => {
      if (!current) return;
      const chars = current.text.length;
      heard = false;
      showCountdown(AUTOTYPE_SECONDS); // immediate feedback; background.js takes over the ticking
      ui.hint.textContent = `${chars.toLocaleString()} character${chars === 1 ? '' : 's'} · click inside the field to type into`;
      try {
        if (!window.__cpTyperAlive()) throw new Error('reloaded');
        runtime.sendMessage({ type: 'autotype', text: current.text, isCode: current.code }).catch(() => showReloadedError());
      } catch {
        showReloadedError();
      }
      // if the extension never answers, say so instead of leaving a dead button
      setTimeout(() => {
        if (counting && !heard && !errorShown) showError('The extension did not respond. Refresh this page (F5), highlight again and retry.');
      }, 2500);
    });
    ui.cancel.addEventListener('click', () => {
      send({ type: 'cancel-autotype' });
      if (errorShown) {
        counting = false;
        errorShown = false;
        hide();
      }
    });
    (document.documentElement || document).appendChild(host);
  }

  function hide() {
    if (ui) ui.card.classList.remove('show', 'counting');
  }

  function place(rect) {
    const w = ui.card.offsetWidth || 150;
    const h = ui.card.offsetHeight || 44;
    let left = Math.min(Math.max(8, rect.right - w), window.innerWidth - w - 8);
    let top = rect.bottom + 10;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 10);
    host.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function showAt(rect, info) {
    if (!host) build();
    ui.tipTitle.textContent = `${info.chars.toLocaleString()} character${info.chars === 1 ? '' : 's'} ${info.code ? 'of code ' : ''}highlighted`;
    if (!ui.card.classList.contains('show')) {
      // with the optional local typer connected the text can go into any app, not just this browser
      ui.tipText.textContent = `Click Type in ${AUTOTYPE_SECONDS}s, then go to the target place and click inside the field.`;
      runtime.sendMessage({ type: 'typer-status' }).then((state) => {
        if (state === 'ready') ui.tipText.textContent = `Click Type in ${AUTOTYPE_SECONDS}s, then go to any app and click inside the field.`;
      }).catch(() => {});
    }
    ui.card.classList.add('show');
    place(rect);
  }

  // The countdown pill sits in a corner so it never covers the field you need to click.
  function placeInCorner() {
    host.style.transform = `translate(${Math.max(8, window.innerWidth - ui.card.offsetWidth - 20)}px, ${Math.max(8, window.innerHeight - ui.card.offsetHeight - 20)}px)`;
  }

  let heard = false; // background.js has answered the click
  let errorShown = false;
  let errorTimer;

  function showCountdown(left, via) {
    if (!host) build();
    counting = true;
    errorShown = false;
    clearTimeout(errorTimer);
    ui.cancel.textContent = 'Cancel';
    ui.num.textContent = left;
    ui.msgTitle.textContent = via === 'typer' ? 'Go to any app now' : 'Go to the target place now';
    ui.card.classList.add('show', 'counting');
    placeInCorner();
  }

  function showError(text) {
    if (!host) build();
    counting = true;
    errorShown = true;
    ui.cancel.textContent = 'Close';
    ui.num.textContent = '!';
    ui.msgTitle.textContent = "Couldn't start typing";
    ui.hint.textContent = text;
    ui.card.classList.add('show', 'counting');
    placeInCorner();
    clearTimeout(errorTimer);
    errorTimer = setTimeout(() => {
      counting = false;
      errorShown = false;
      hide();
    }, 12000);
  }

  const showReloadedError = () => showError('The extension was reloaded. Refresh this page (F5), highlight again and retry.');

  // --- tracking the highlight -----------------------------------------------------------

  const EDITOR_SELECTOR = '.monaco-editor, .ace_editor, .CodeMirror, .cm-editor';
  const CODE_BLOCK_SELECTOR = `pre, code, kbd, samp, .hljs, .highlight, .prettyprint, [class*="language-"], ${EDITOR_SELECTOR}`;

  // Copied code is full of characters that look like spaces but break compilers.
  const cleanText = (t) =>
    t.replace(/\r\n?/g, '\n').replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/[\u200b-\u200d\u2060\ufeff]/g, '');

  const CODE_HINTS = [
    /[{};]\s*$/m,
    /=>|->|::|\+\+|--|&&|\|\||[=!<>]=|<<|>>/,
    /^\s*(def|class|import|from|function|const|let|var|return|if|else|elif|for|while|try|catch|except|switch|case|public|private|protected|static|void|int|float|double|string|bool|#include|using|package|fn|func|struct|enum|interface|async|await|print|console|System)\b/m,
    /\b\w+\s*\([^)\n]*\)/,
    /^\s*(#|\/\/|\/\*|\*\s)/m,
    /^( {2,}|\t)\S/m,
    /[\[\]{}]\s*[,;]?\s*$/m,
  ];

  function looksLikeCode(text, node) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    if (el && el.closest && el.closest(CODE_BLOCK_SELECTOR)) return true;
    const hits = CODE_HINTS.filter((re) => re.test(text)).length;
    if (text.includes('\n')) return hits >= 2;
    return hits >= 2 || (hits >= 1 && /[{};=]/.test(text));
  }

  // Code editors keep their selection internally; page-bridge.js (page world) can read it.
  function readEditorSelection() {
    const el = document.activeElement;
    if (!el || !el.closest || !el.closest(EDITOR_SELECTOR)) return null;
    const root = document.documentElement;
    document.dispatchEvent(new CustomEvent('cptyper-get-selection'));
    const raw = root.getAttribute('data-cptyper-selection');
    root.removeAttribute('data-cptyper-selection');
    if (!raw) return null;
    try {
      const found = JSON.parse(raw);
      return found && found.text ? { text: found.text, rect: found.rect, code: true } : null;
    } catch {
      return null;
    }
  }

  function readSelection() {
    const fromEditor = readEditorSelection();
    if (fromEditor) return fromEditor;

    const el = document.activeElement;
    if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|search|url|tel|email)$/i.test(el.type)))) {
      try {
        if (el.selectionStart !== el.selectionEnd) {
          const text = el.value.slice(el.selectionStart, el.selectionEnd);
          return { text, rect: el.getBoundingClientRect(), code: looksLikeCode(text, el) };
        }
      } catch {
        // some input types have no selection API
      }
      return null;
    }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    const rects = range.getClientRects();
    const text = sel.toString();
    return {
      text,
      rect: rects.length ? rects[rects.length - 1] : range.getBoundingClientRect(),
      code: looksLikeCode(text, range.commonAncestorContainer),
    };
  }

  // The highlight becomes the text to type right away (Alt+Q and the popup use it too), as code mode when it looks like code.
  let sentKey = null;
  let sentTimer;
  function publish(s) {
    clearTimeout(sentTimer);
    sentTimer = setTimeout(() => {
      const key = `${s.code ? 'code' : 'text'}:${s.text}`;
      if (key === sentKey) return;
      sentKey = key;
      send({ type: 'selection', text: s.text, isCode: s.code });
    }, 350);
  }

  function refresh() {
    if (counting || running || !enabled || isTyperPage) return;
    const s = readSelection();
    if (s && s.text.trim()) {
      s.text = cleanText(s.text);
      current = s;
      showAt(s.rect, { chars: s.text.length, code: s.code });
      publish(s);
    } else {
      current = null;
      hide();
    }
  }

  const later = () => setTimeout(refresh, 15);
  document.addEventListener('mouseup', later, true);
  document.addEventListener('keyup', (e) => {
    if (e.shiftKey || e.key === 'Shift' || e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a')) later();
  }, true);

  let scrollQueued = false;
  window.addEventListener('scroll', () => {
    if (scrollQueued || counting || !current) return;
    scrollQueued = true;
    requestAnimationFrame(() => {
      scrollQueued = false;
      refresh();
    });
  }, true);

  // --- messages from background.js ------------------------------------------------------

  runtime.onMessage.addListener((msg) => {
    if (msg.type === 'running') {
      running = msg.value;
      if (running) hide();
    } else if (msg.type === 'countdown') {
      heard = true;
      if (errorShown) return;
      if (msg.left) {
        showCountdown(msg.left, msg.via);
      } else {
        counting = false;
        hide();
      }
    } else if (msg.type === 'autotype-error') {
      heard = true;
      showError(msg.error);
    }
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if ((!running && !counting) || !e.isTrusted || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      send({ type: counting ? 'cancel-autotype' : 'stop' });
    },
    true
  );
})();
