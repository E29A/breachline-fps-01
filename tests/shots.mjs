// tests/shots.mjs — headless-Chrome screenshots via CDP (Node's WebSocket).
// Serves game/, loads each ?shot= URL, waits for window.__shotReady, then
// captures a JPEG and checks the gate's size limits. Usage: node tests/shots.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = JSON.parse(readFileSync(join(ROOT, 'shots.json'), 'utf8'));
const CHROME = process.env.CHROME ?? '/home/hatch/.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome';
const PORT = 8080;
const DEBUG_PORT = 9333;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(url, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('timeout waiting for ' + url);
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        this.pending.get(msg.id)(msg);
        this.pending.delete(msg.id);
      }
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    const p = new Promise((res) => this.pending.set(id, res));
    this.ws.send(JSON.stringify({ id, method, params }));
    const msg = await p;
    if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
    return msg.result;
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true });
    return r.result?.value;
  }
  close() { this.ws.close(); }
}

async function main() {
  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: ROOT, stdio: 'pipe' });
  await waitFor(`http://127.0.0.1:${PORT}/index.html`);
  console.log('server up');

  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'pipe' });
  await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  console.log('chrome up');

  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const cdp = new CDP(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  const results = [];
  for (const shot of SHOTS) {
    const url = `http://127.0.0.1:${PORT}/index.html${shot.query}`;
    await cdp.send('Page.navigate', { url });
    // Wait for the game to signal readiness (or time out).
    let ready = false;
    let errors = null;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      try {
        ready = await cdp.eval('window.__shotReady === true');
        if (ready) break;
      } catch { /* page still loading */ }
    }
    errors = await cdp.eval('JSON.stringify(window.__errors || [])').catch(() => 'unknown');
    // Let a few frames render, then capture.
    await sleep(1200);
    let quality = 82;
    let shot1;
    for (let attempt = 0; attempt < 3; attempt++) {
      shot1 = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality });
      const buf = Buffer.from(shot1.data, 'base64');
      const out = join(ROOT, 'screenshots', shot.name);
      writeFileSync(out, buf);
      if (buf.length <= 262144) break;
      quality -= 18;
    }
    const size = readFileSync(join(ROOT, 'screenshots', shot.name)).length;
    results.push({ name: shot.name, ready, errors, bytes: size, quality });
    console.log(`${shot.name}: ready=${ready} errors=${errors} bytes=${size} quality=${quality}`);
  }
  cdp.close();
  chrome.kill();
  server.kill();
  const bad = results.filter((r) => !r.ready || r.bytes > 262144);
  console.log(bad.length ? `FAIL: ${bad.map((b) => b.name).join(', ')}` : 'ALL SHOTS OK');
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
