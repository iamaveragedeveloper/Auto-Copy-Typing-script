// Runs in the page's own JavaScript world (manifest "world": "MAIN"). Code editors such as Monaco, Ace and
// CodeMirror 5 keep their selection internally, so the extension's isolated content script can't see it with
// window.getSelection(). It asks for it with a DOM event and reads the answer from an attribute on <html>.
(() => {
  if (window.__cpTyperBridge) return;
  window.__cpTyperBridge = true;
  const ATTR = 'data-cptyper-selection';

  const rectOf = (el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };

  function monaco(active) {
    const api = window.monaco && window.monaco.editor;
    if (!api || !api.getEditors) return null;
    const ed = api.getEditors().find((e) => e.getDomNode && e.getDomNode() && e.getDomNode().contains(active));
    const sel = ed && ed.getSelection();
    if (!sel || sel.isEmpty()) return null;
    const box = ed.getDomNode().getBoundingClientRect();
    const pos = ed.getScrolledVisiblePosition(sel.getEndPosition());
    const rect = pos
      ? { left: box.left + pos.left, right: box.left + pos.left, top: box.top + pos.top, bottom: box.top + pos.top + pos.height }
      : rectOf(ed.getDomNode());
    return { text: ed.getModel().getValueInRange(sel), rect };
  }

  function ace(active) {
    const el = active.closest && active.closest('.ace_editor');
    const ed = el && el.env && el.env.editor;
    const text = ed && ed.getSelectedText();
    return text ? { text, rect: rectOf(active) } : null;
  }

  function codeMirror5(active) {
    const el = active.closest && active.closest('.CodeMirror');
    const cm = el && el.CodeMirror;
    const text = cm && cm.getSelection();
    return text ? { text, rect: rectOf(active) } : null;
  }

  document.addEventListener('cptyper-get-selection', () => {
    const root = document.documentElement;
    root.removeAttribute(ATTR);
    try {
      const active = document.activeElement;
      if (!active) return;
      const found = monaco(active) || ace(active) || codeMirror5(active);
      if (found && found.text) root.setAttribute(ATTR, JSON.stringify(found));
    } catch {
      // an editor build we don't recognise; the normal selection path still applies
    }
  });
})();
