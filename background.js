const DEFAULTS = { text: '', delay: 40, jitter: true, startDelay: 800, mode: 'char', showOnSelect: true, target: 'auto' };
const AUTOTYPE_SECONDS = 5;

const runs = new Map(); // tabId -> { stop: boolean }
let pending = null; // the highlight-triggered countdown in progress: { source, cancelled }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function flagError(tabId, title) {
  await chrome.action.setBadgeBackgroundColor({ color: '#c33', tabId });
  await chrome.action.setBadgeText({ text: '!', tabId });
  await chrome.action.setTitle({ title: `Copy Paste Typer: ${title}`, tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }).catch(() => {}), 6000);
}

function showProgress(tabId, percent) {
  chrome.action.setBadgeBackgroundColor({ color: '#2a7', tabId }).catch(() => {});
  chrome.action.setBadgeText({ text: `${percent}%`, tabId }).catch(() => {});
}

function notifyRunning(tabId, value) {
  chrome.tabs.sendMessage(tabId, { type: 'running', value }).catch(() => {});
}

function keyInfo(ch) {
  if (/[a-z]/i.test(ch)) {
    return { code: 'Key' + ch.toUpperCase(), vk: ch.toUpperCase().charCodeAt(0), shift: ch !== ch.toLowerCase() };
  }
  if (/[0-9]/.test(ch)) return { code: 'Digit' + ch, vk: ch.charCodeAt(0), shift: false };
  if (ch === ' ') return { code: 'Space', vk: 32, shift: false };
  return { code: '', vk: 0, shift: false };
}

async function typeChar(send, ch) {
  const cp = ch.codePointAt(0);

  if (ch === '\n') {
    const k = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', unmodifiedText: '\r', ...k });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    return;
  }

  // Tab would move focus in a plain field, and non-ASCII has no key mapping: insert as text.
  if (ch === '\t' || cp < 32 || cp > 126) {
    await send('Input.insertText', { text: ch });
    return;
  }

  const info = keyInfo(ch);
  const k = {
    key: ch,
    code: info.code,
    windowsVirtualKeyCode: info.vk,
    nativeVirtualKeyCode: info.vk,
    modifiers: info.shift ? 8 : 0,
  };
  await send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    text: ch,
    unmodifiedText: info.shift ? ch.toLowerCase() : ch,
    ...k,
  });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}

function buildUnits(text, mode) {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (mode === 'line') {
    // whitespace-only lines become empty so no trailing spaces are typed
    return clean.split('\n').map((l) => (l.trim() === '' ? '' : l));
  }
  return Array.from(clean);
}

async function pressKey(send, key, code, vk, modifiers = 0) {
  const k = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...k });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
}

// Code editors auto-indent each new line and auto-close brackets and quotes. Undo both so the
// text ends up exactly as pasted: the line's own indentation is typed on a clean line.
// Assumes the cursor is at the end of the document (an empty editor).
async function typeCodeLine(send, line, isFirst, isLast) {
  if (!isFirst) {
    // drop whatever indentation the editor inserted after Enter; the line brings its own
    await pressKey(send, 'Home', 'Home', 36, 8); // Shift+Home
    await pressKey(send, 'Delete', 'Delete', 46);
  }

  if (line) {
    await send('Input.insertText', { text: line });
    // a space closes any autocomplete popup, so Enter inserts a newline instead of accepting a suggestion
    await send('Input.insertText', { text: ' ' });
    await pressKey(send, 'Backspace', 'Backspace', 8);
  }

  // the cursor is at the end of the document, so anything after it is auto-closed brackets or quotes
  await pressKey(send, 'End', 'End', 35, 8); // Shift+End
  await pressKey(send, 'Delete', 'Delete', 46);

  if (!isLast) await typeChar(send, '\n');
}

async function loop(tabId, s, run) {
  const target = { tabId };
  const send = (method, params) => chrome.debugger.sendCommand(target, method, params);
  try {
    // Make the page behave as focused even though the popup / toolbar had focus.
    await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    notifyRunning(tabId, true);
    await sleep(s.startDelay);

    const units = buildUnits(s.text, s.mode);
    let lastPercent = -1;
    for (let i = 0; i < units.length; i++) {
      if (run.stop) break;

      const unit = units[i];
      if (s.mode === 'line') await typeCodeLine(send, unit, i === 0, i === units.length - 1);
      else await typeChar(send, unit);

      const percent = Math.floor(((i + 1) / units.length) * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        showProgress(tabId, percent);
      }

      // In line mode one pause covers a whole line's worth of keystrokes.
      const base = s.mode === 'line' ? s.delay * Math.min(Math.max(unit.length, 1), 12) : s.delay;
      await sleep(s.jitter ? base * (0.5 + Math.random()) : base);
    }
  } catch (err) {
    run.failed = true; // keep the red badge instead of clearing it below
    await flagError(tabId, err.message);
  } finally {
    runs.delete(tabId);
    notifyRunning(tabId, false);
    await chrome.debugger.detach({ tabId }).catch(() => {});
    if (!run.failed) chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
  }
}

// Starts typing into whatever is focused in the tab; calling it again while running stops.
async function startTyping(tabId, settings) {
  const running = runs.get(tabId);
  if (running) {
    running.stop = true;
    return { ok: true };
  }
  if (!settings.text) return { ok: false, error: 'No text to type. Paste it in the popup first.' };

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // Only used so Esc can stop a run; typing works without it.
  chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] }).catch(() => {});

  const run = { stop: false };
  runs.set(tabId, run);
  loop(tabId, settings, run);
  return { ok: true };
}

// --- optional link to the Windows local typer (local-typer/start.bat) ----------------------
// When it is running and paired, typing goes through it, so it works in any app. Otherwise
// everything stays inside the browser as before. The token is handed over by the typer's own
// page (content.js reads it there), so no other page or program can drive it.

const TYPER_URL = 'http://127.0.0.1:8765';
const TYPER_ORIGINS = ['http://127.0.0.1:8765', 'http://localhost:8765'];

async function typerApi(path, body) {
  const { typerToken } = await chrome.storage.local.get({ typerToken: '' });
  const res = await fetch(TYPER_URL + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Token': typerToken, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(2000),
  });
  if (res.status === 403) throw new Error('Local typer was restarted. Open http://localhost:8765 once to reconnect.');
  return res.json();
}

// 'off' (not running), 'unpaired' (running, but this browser has no valid token), or 'ready'
async function typerState() {
  try {
    const hello = await (await fetch(TYPER_URL + '/api/hello', { signal: AbortSignal.timeout(1000) })).json();
    if (hello.app !== 'copy-paste-typer') return 'off';
  } catch {
    return 'off';
  }
  try {
    await typerApi('/api/status');
    return 'ready';
  } catch {
    return 'unpaired';
  }
}

const typerMode = (extensionMode) => (extensionMode === 'line' ? 'code' : 'char');

const typerSettings = (s) => ({ text: s.text, mode: typerMode(s.mode), delay: s.delay, jitter: s.jitter, startDelay: s.startDelay });

// True when the settings allow it and the typer is up and paired.
async function useTyper(settings) {
  return settings.target !== 'browser' && (await typerState()) === 'ready';
}

// Hands the text to the typer; it waits startDelayMs, then types into whatever window is active.
async function startViaTyper(settings, startDelayMs) {
  await typerApi('/api/state', typerSettings(settings));
  const res = await typerApi('/api/type', { startDelay: startDelayMs });
  return res.ok ? { ok: true } : { ok: false, error: res.error || 'Local typer could not start.' };
}

function stopTyper() {
  typerApi('/api/stop', {}).catch(() => {});
}

// Mirrors the typer's progress on the toolbar badge until it finishes.
async function followTyper(tabId) {
  for (;;) {
    await sleep(500);
    let st;
    try {
      st = await typerApi('/api/status');
    } catch {
      return;
    }
    if (st.error) return reportFailure({ tabId }, st.error);
    if (!st.running) return chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
    showProgress(tabId, st.progress);
  }
}

function sendCountdown(source, left, via) {
  chrome.tabs.sendMessage(source.tabId, { type: 'countdown', left, via }, { frameId: source.frameId }).catch(() => {});
}

function cancelAutotype() {
  if (!pending) return;
  pending.cancelled = true;
  if (pending.viaTyper) stopTyper();
  sendCountdown(pending.source, null);
  chrome.action.setBadgeText({ text: '' }).catch(() => {});
  pending = null;
}

// The highlighted text becomes the saved text, then after the countdown it is typed. With the
// local typer connected it goes into whichever app you switched to; otherwise into the active tab.
// Shows the reason in the on-page banner (the badge alone is easy to miss) and on the toolbar icon.
function reportFailure(source, message) {
  chrome.tabs.sendMessage(source.tabId, { type: 'autotype-error', error: message }, { frameId: source.frameId }).catch(() => {});
  flagError(source.tabId, message).catch(() => {});
}

async function beginAutotype(text, isCode, source) {
  try {
    await runAutotype(text, isCode, source);
  } catch (err) {
    pending = null;
    reportFailure(source, err.message || String(err));
  }
}

async function runAutotype(text, isCode, source) {
  cancelAutotype();
  const job = { source, cancelled: false, viaTyper: false };
  pending = job;
  sendCountdown(source, AUTOTYPE_SECONDS); // acknowledge the click right away
  const saved = { mode: isCode ? 'line' : 'char' };
  await chrome.storage.local.set({ text, ...saved });
  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)), text, ...saved };

  if (await useTyper(settings)) {
    // the typer does its own waiting, so this keeps working even if the browser is minimised
    const res = await startViaTyper(settings, AUTOTYPE_SECONDS * 1000).catch((err) => ({ ok: false, error: err.message }));
    if (job.cancelled) return;
    if (!res.ok) {
      pending = null;
      return reportFailure(source, `Local typer: ${res.error}`);
    }
    job.viaTyper = true;
  }
  const via = job.viaTyper ? 'typer' : 'browser';

  for (let left = AUTOTYPE_SECONDS; left > 0; left--) {
    if (job.cancelled) return;
    sendCountdown(source, left, via);
    chrome.action.setBadgeBackgroundColor({ color: '#e8890c' }).catch(() => {});
    chrome.action.setBadgeText({ text: String(left) }).catch(() => {});
    await sleep(1000);
  }
  if (job.cancelled) return;

  pending = null;
  sendCountdown(source, null);
  chrome.action.setBadgeText({ text: '' }).catch(() => {});

  if (job.viaTyper) return followTyper(source.tabId);

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || runs.has(tab.id)) return;
  const res = await startTyping(tab.id, { ...settings, startDelay: 0 });
  if (!res.ok) reportFailure(source, `${res.error} (the browser can only type into web pages; run local-typer/start.bat to type into other apps)`);
}

chrome.debugger.onDetach.addListener((source) => {
  const run = runs.get(source.tabId);
  if (run) run.stop = true; // user clicked Cancel on the "debugging" bar
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'start') {
    const settings = { ...DEFAULTS, ...msg.settings };
    (async () => {
      if (settings.text && (await useTyper(settings))) {
        return startViaTyper(settings, settings.startDelay).catch((err) => ({ ok: false, error: err.message }));
      }
      return startTyping(msg.tabId, settings);
    })().then(sendResponse);
    return true;
  }
  if (msg.type === 'typer-status') {
    typerState().then(sendResponse);
    return true;
  }
  if (msg.type === 'typer-token') {
    // only accepted from the typer's own page, never from any other site
    if (TYPER_ORIGINS.includes(sender.origin) && typeof msg.token === 'string' && /^[0-9a-f]{48}$/.test(msg.token)) {
      chrome.storage.local.set({ typerToken: msg.token });
    }
    sendResponse({ ok: true });
  }
  if (msg.type === 'autotype' && sender.tab && msg.text) {
    beginAutotype(msg.text, !!msg.isCode, { tabId: sender.tab.id, frameId: sender.frameId });
    sendResponse({ ok: true });
  }
  if (msg.type === 'selection' && msg.text) {
    // every highlight becomes the text to type, in code mode when it looks like code
    const saved = { text: msg.text, mode: msg.isCode ? 'line' : 'char' };
    chrome.storage.local.set(saved);
    // keep the local typer's saved text in step too, so its hotkey types the highlight in any app
    chrome.storage.local.get(DEFAULTS).then(async (stored) => {
      const settings = { ...DEFAULTS, ...stored, ...saved };
      if (await useTyper(settings)) typerApi('/api/state', typerSettings(settings)).catch(() => {});
    });
  }
  if (msg.type === 'cancel-autotype') {
    cancelAutotype();
    sendResponse({ ok: true });
  }
  if (msg.type === 'stop') {
    cancelAutotype();
    stopTyper();
    const tabId = msg.tabId ?? sender.tab?.id;
    const run = runs.get(tabId);
    if (run) run.stop = true;
    sendResponse({ ok: true });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'type-saved') return;
  if (pending) return cancelAutotype();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  const res = await startTyping(tab.id, settings);
  if (!res.ok) await flagError(tab.id, res.error);
});
