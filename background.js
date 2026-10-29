const DEFAULTS = { text: '', delay: 40, jitter: true, startDelay: 800, mode: 'char' };

const runs = new Map(); // tabId -> { stop: boolean }

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

const indentWidth = (line) => {
  let w = 0;
  for (const c of line) {
    if (c === ' ') w += 1;
    else if (c === '\t') w += 4;
    else break;
  }
  return w;
};

// Code editors auto-indent each new line and auto-close brackets. Undo both so the
// text ends up exactly as pasted: the line's own indentation is typed on a clean line.
// Assumes the cursor is at the end of the document (an empty editor).
async function typeCodeLine(send, line, isLast) {
  if (line) await send('Input.insertText', { text: line });

  const opens = (line.match(/[([{]/g) || []).length;
  const closes = (line.match(/[)\]}]/g) || []).length;
  if (opens > closes) {
    // the editor probably auto-inserted closers after the cursor; the source types its own later
    await pressKey(send, 'End', 'End', 35, 8); // Shift+End
    await pressKey(send, 'Delete', 'Delete', 46);
  }

  if (isLast) return;
  await send('Input.insertText', { text: '\n' });

  const width = indentWidth(line);
  if (width > 0 || /[:{(\[]\s*$/.test(line)) {
    // Shift+Tab outdents one level and does nothing on an unindented line
    const presses = Math.min(30, Math.ceil(width / 2) + 2);
    for (let i = 0; i < presses; i++) await pressKey(send, 'Tab', 'Tab', 9, 8);
  }
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
      if (s.mode === 'line') await typeCodeLine(send, unit, i === units.length - 1);
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

chrome.debugger.onDetach.addListener((source) => {
  const run = runs.get(source.tabId);
  if (run) run.stop = true; // user clicked Cancel on the "debugging" bar
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'start') {
    startTyping(msg.tabId, { ...DEFAULTS, ...msg.settings }).then(sendResponse);
    return true;
  }
  if (msg.type === 'stop') {
    const tabId = msg.tabId ?? sender.tab?.id;
    const run = runs.get(tabId);
    if (run) run.stop = true;
    sendResponse({ ok: true });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'type-saved') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  const settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  const res = await startTyping(tab.id, settings);
  if (!res.ok) await flagError(tab.id, res.error);
});
