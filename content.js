// Typing itself happens in background.js (real keystrokes via the debugger API).
// This script only lets the Esc key stop a run in progress.
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

  let running = false;

  runtime.onMessage.addListener((msg) => {
    if (msg.type === 'running') running = msg.value;
  });

  document.addEventListener(
    'keydown',
    (e) => {
      if (!running || !e.isTrusted || e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        runtime.sendMessage({ type: 'stop' });
      } catch {
        // extension was reloaded; the page needs a refresh
      }
    },
    true
  );
})();
