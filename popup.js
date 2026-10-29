const DEFAULTS = { text: '', delay: 40, jitter: true, startDelay: 800, mode: 'char', showOnSelect: true };

const $ = (id) => document.getElementById(id);
const els = {
  text: $('text'),
  delay: $('delay'),
  jitter: $('jitter'),
  startDelay: $('startDelay'),
  mode: $('mode'),
  showOnSelect: $('showOnSelect'),
};

const readSettings = () => ({
  text: els.text.value,
  delay: Number(els.delay.value),
  jitter: els.jitter.checked,
  startDelay: Number(els.startDelay.value) || 0,
  mode: els.mode.value,
  showOnSelect: els.showOnSelect.checked,
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
  $('delayVal').textContent = `${saved.delay} ms`;
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
