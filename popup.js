const DEFAULTS = { text: '', delay: 40, jitter: true, startDelay: 800, mode: 'char', showOnSelect: true, target: 'auto', autoStartOnHighlight: false };

const $ = (id) => document.getElementById(id);
const els = {
  text: $('text'),
  delay: $('delay'),
  jitter: $('jitter'),
  startDelay: $('startDelay'),
  mode: $('mode'),
  showOnSelect: $('showOnSelect'),
  target: $('target'),
  autoStartOnHighlight: $('autoStartOnHighlight'),
};

const readSettings = () => ({
  text: els.text.value,
  delay: Number(els.delay.value),
  jitter: els.jitter.checked,
  startDelay: Number(els.startDelay.value) || 0,
  mode: els.mode.value,
  showOnSelect: els.showOnSelect.checked,
  target: els.target.value,
  autoStartOnHighlight: els.autoStartOnHighlight.checked,
});

const showError = (msg) => ($('status').textContent = msg);

const activeTabId = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('No active tab');
  return tab.id;
};

async function init() {
  const saved = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  els.text.value = saved.text;
  els.delay.value = saved.delay;
  els.jitter.checked = saved.jitter;
  els.startDelay.value = saved.startDelay;
  els.mode.value = saved.mode;
  els.showOnSelect.checked = saved.showOnSelect;
  els.target.value = saved.target;
  els.autoStartOnHighlight.checked = saved.autoStartOnHighlight;
  showTyperStatus();
  $('delayVal').textContent = `${saved.delay} ms`;
}

// The local typer (local-typer/start.bat) is optional: it only adds typing into other apps.
async function showTyperStatus() {
  const el = $('typerStatus');
  const state = await chrome.runtime.sendMessage({ type: 'typer-status' }).catch(() => 'off');
  if (state === 'ready') {
    el.textContent = 'Local typer connected: highlight text anywhere and it is typed into any app 5 seconds later.';
  } else if (state === 'rejected') {
    el.textContent = `A local typer is running but refuses this extension. Update the local-typer folder to the latest copy and restart start.bat, and load this extension from the repository folder (its ID must be hkoeibhbmihepmlljhjffbfppdopogkf; this one is ${chrome.runtime.id}).`;
  } else if (state === 'unpaired') {
    el.innerHTML = 'Local typer is running but did not accept this extension. <a href="#" id="pair">Open its page</a>, and make sure the extension ID matches the one in local-typer/server.js.';
    $('pair').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'http://localhost:8765' });
    });
  } else {
    el.textContent = 'Local typer not running (optional): typing stays inside this browser. Run local-typer/start.bat to type into any app.';
  }
}

function save() {
  const s = readSettings();
  $('delayVal').textContent = `${s.delay} ms`;
  chrome.storage.local.set(s);
}

Object.values(els).forEach((el) => el.addEventListener('input', save));

$('type').addEventListener('click', async () => {
  const settings = readSettings();
  if (!settings.text) return showError('Paste some text first.');
  chrome.storage.local.set(settings);

  try {
    const res = await chrome.runtime.sendMessage({ type: 'start', tabId: await activeTabId(), settings });
    if (!res?.ok) return showError(res?.error || 'Could not start typing.');
    window.close(); // hand focus back to the page so typing lands in the field
  } catch (err) {
    showError(`Cannot run on this page: ${err.message}`);
  }
});

$('stop').addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'stop', tabId: await activeTabId() });
  } catch {
    // nothing to stop
  }
});

init();
