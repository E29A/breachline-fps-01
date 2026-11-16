// tests/loadtest.mjs — live load test: plain index.html, click Play, run the
// game in real time for ~12 s, then report page errors + failed requests.
// Usage: node tests/loadtest.mjs
import { spawn } from 'node:child_process';

const ROOT = '/home/hatch/workspace/makefun/fps-bot-01';
const CHROME = '/home/hatch/.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, timeout = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const r = await fetch(url); if (r.ok) return true; } catch {}
    await sleep(250);
  }
  throw new Error('timeout ' + url);
}
class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map(); this.events = [];
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
      else if (m.method) this.events.push(m);
    };
  }
  async send(method, params = {}) {
    await this.ready;
    const id = ++this.id;
    const p = new Promise((res) => this.pending.set(id, res));
    this.ws.send(JSON.stringify({ id, method, params }));
    const m = await p;
    if (m.error) throw new Error(`${method}: ${m.error.message}`);
    return m.result;
  }
  async eval(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result?.value; }
  close() { this.ws.close(); }
}

const server = spawn('node', ['serve.ts', '--port', '8082'], { cwd: ROOT, stdio: 'pipe' });
await waitFor('http://127.0.0.1:8082/index.html');
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--remote-debugging-port=9336', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--window-size=1280,720', 'about:blank'], { stdio: 'pipe' });
await waitFor('http://127.0.0.1:9336/json/version');
const targets = await (await fetch('http://127.0.0.1:9336/json/list')).json();
const cdp = new CDP(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Network.enable');
await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8082/index.html?seed=42' });
await sleep(4000); // let the page load and the first frames render
const loaded = await cdp.eval('!!window.__state && window.__errors.length');
console.log('loaded, errors after load:', JSON.stringify(loaded));
// Click Play (pointer lock may not engage headless; the game must not break).
await cdp.eval(`document.getElementById('play').click(); 'clicked'`);
await sleep(12000); // ~12 s of real-time play (buy phase + live start)
const errors = await cdp.eval('JSON.stringify(window.__errors)');
const phase = await cdp.eval('JSON.stringify({phase: window.__state.phase, round: window.__state.round, hp: window.__state.player.hp, t: +window.__state.time.toFixed(1)})');
const failed = cdp.events.filter((e) => e.method === 'Network.loadingFailed' || (e.method === 'Network.responseReceived' && e.params.response.status >= 400));
const exceptions = cdp.events.filter((e) => e.method === 'Runtime.exceptionThrown');
console.log('errors:', errors);
console.log('state after 12s play:', phase);
console.log('failed requests:', failed.length, JSON.stringify(failed.map((f) => f.params?.errorText ?? f.params?.response?.url)));
console.log('uncaught exceptions:', exceptions.length);
const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
const { writeFileSync } = await import('node:fs');
writeFileSync('/tmp/loadtest.jpg', Buffer.from(shot.data, 'base64'));
console.log('screenshot saved to /tmp/loadtest.jpg');
cdp.close(); chrome.kill(); server.kill();
const ok = JSON.parse(errors).length === 0 && failed.length === 0 && exceptions.length === 0;
console.log(ok ? 'LOAD TEST OK' : 'LOAD TEST FAIL');
process.exit(ok ? 0 : 1);
