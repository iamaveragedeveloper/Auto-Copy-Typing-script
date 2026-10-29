// Local "paste here, type anywhere" server. Zero dependencies; Windows only for the typing helper.
//   node server.js            -> http://localhost:8765 , hotkey Alt+Q
//   HOTKEY=Ctrl+Alt+T PORT=9000 node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT) || 8765;
const HOTKEY = process.env.HOTKEY || 'Alt+Q';
const STATE_FILE = path.join(__dirname, 'state.json');
const TOKEN = crypto.randomBytes(24).toString('hex');
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

const DEFAULT_STATE = { text: '', mode: 'code', delay: 30, jitter: true, startDelay: 300 };

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

function sanitize(input) {
  return {
    text: typeof input.text === 'string' ? input.text.slice(0, 1_000_000) : '',
    mode: input.mode === 'char' ? 'char' : 'code',
    delay: clamp(Math.round(Number(input.delay)), 0, 1000),
    jitter: !!input.jitter,
    startDelay: clamp(Math.round(Number(input.startDelay)), 0, 30000),
  };
}

function loadState() {
  try {
    return sanitize({ ...DEFAULT_STATE, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) });
  } catch {
    return { ...DEFAULT_STATE };
  }
}

let state = loadState();
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

function parseHotkey(spec) {
  const parts = spec.split('+').map((p) => p.trim().toLowerCase());
  const mods = { alt: 1, ctrl: 2, control: 2, shift: 4, win: 8 };
  let modMask = 0;
  let vk = 0;
  for (const p of parts.slice(0, -1)) {
    if (!(p in mods)) throw new Error(`Unknown modifier "${p}" in HOTKEY`);
    modMask |= mods[p];
  }
  const key = parts[parts.length - 1];
  if (/^[a-z0-9]$/.test(key)) vk = key.toUpperCase().charCodeAt(0);
  else if (/^f([1-9]|1[0-2])$/.test(key)) vk = 0x70 + Number(key.slice(1)) - 1;
  else throw new Error(`Unsupported key "${key}" in HOTKEY (use A-Z, 0-9 or F1-F12)`);
  if (!modMask) throw new Error('HOTKEY needs at least one modifier, e.g. Alt+Q');
  return { modMask, vk };
}

const status = { helperReady: false, running: false, progress: 0, error: null };
let helper = null;

function startHelper() {
  if (process.platform !== 'win32') {
    status.error = 'The typing helper only works on Windows.';
    return;
  }
  const { modMask, vk } = parseHotkey(HOTKEY);
  // A helper left over from a previous run keeps the hotkey and can type alongside the new one, garbling the output.
  spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | Where-Object { $_.CommandLine -like '*helper.ps1*-Mods*' -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
    { windowsHide: true }
  );
  helper = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'helper.ps1'), '-Mods', String(modMask), '-Vk', String(vk)],
    { windowsHide: true }
  );

  let buf = '';
  helper.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      handleHelperLine(buf.slice(0, nl).trim());
      buf = buf.slice(nl + 1);
    }
  });
  helper.stderr.on('data', (d) => {
    status.error = d.toString('utf8').trim().split('\n')[0];
    console.error('[helper]', d.toString('utf8').trim());
  });
  helper.on('exit', () => {
    status.helperReady = false;
    status.running = false;
    status.error = status.error || 'Typing helper stopped.';
  });
}

function handleHelperLine(line) {
  if (line === 'READY') {
    status.helperReady = true;
    status.error = null;
    console.log(`Hotkey ${HOTKEY} is active.`);
  } else if (line === 'HOTKEY') {
    if (status.running) sendToHelper('STOP');
    else startTyping(state.startDelay);
  } else if (line === 'STARTED') {
    status.running = true;
    status.progress = 0;
    status.error = null;
  } else if (line.startsWith('PROGRESS ')) {
    status.progress = Number(line.slice(9));
  } else if (line === 'DONE') {
    status.running = false;
  } else if (line.startsWith('ERROR ')) {
    status.error = line.slice(6);
    console.error('[helper]', status.error);
  }
}

const sendToHelper = (line) => helper && helper.stdin.writable && helper.stdin.write(line + '\n');

function startTyping(startDelay) {
  if (!status.helperReady) return { ok: false, error: status.error || 'Typing helper is not ready.' };
  if (status.running) return { ok: false, error: 'Already typing.' };
  if (!state.text.trim()) return { ok: false, error: 'No text saved yet.' };

  const b64 = Buffer.from(state.text, 'utf8').toString('base64');
  status.running = true; // helper confirms with STARTED; set now so a double press stops instead of restarting
  status.progress = 0;
  sendToHelper(`TYPE ${state.mode} ${state.delay} ${state.jitter ? 1 : 0} ${startDelay} ${b64}`);
  return { ok: true };
}

// --- HTTP ---------------------------------------------------------------

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2_000_000) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Block other websites (and DNS-rebinding tricks) from driving a local service that types keystrokes.
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, { error: 'Bad host' });
  // The optional browser extension calls in from a chrome-extension:// origin. Websites can't forge that
  // origin, and every /api/ call below still needs the token, which only this server's own page contains.
  const origin = req.headers.origin;
  const fromExtension = !!origin && origin.startsWith('chrome-extension://');
  if (origin && !fromExtension && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return send(res, 403, { error: 'Bad origin' });

  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').replaceAll('__TOKEN__', TOKEN).replace('__HOTKEY__', HOTKEY);
    return send(res, 200, html, 'text/html; charset=utf-8');
  }

  // lets the extension tell whether the typer is running before it has a token
  if (req.method === 'GET' && url === '/api/hello') return send(res, 200, { app: 'copy-paste-typer' });

  if (!url.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  if (req.headers['x-token'] !== TOKEN) return send(res, 403, { error: 'Bad token' });

  try {
    if (req.method === 'GET' && url === '/api/state') return send(res, 200, { state, status, hotkey: HOTKEY });
    if (req.method === 'GET' && url === '/api/status') return send(res, 200, status);
    if (req.method === 'POST' && url === '/api/state') {
      state = sanitize(JSON.parse(await readBody(req)));
      saveState();
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url === '/api/type') {
      const { startDelay } = JSON.parse((await readBody(req)) || '{}');
      return send(res, 200, startTyping(clamp(Math.round(Number(startDelay)), 0, 30000)));
    }
    if (req.method === 'POST' && url === '/api/stop') {
      sendToHelper('STOP');
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (err) {
    return send(res, 400, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Copy Paste Typer running at http://localhost:${PORT}`);
  console.log('Paste your text there, click into the other app, then press the hotkey.');
});

try {
  startHelper();
} catch (err) {
  status.error = err.message;
  console.error(err.message);
}

const shutdown = () => {
  if (helper) helper.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', () => helper && helper.kill());
