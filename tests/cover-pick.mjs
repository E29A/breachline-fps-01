// tests/cover-pick.mjs — capture ?shot=play frames for several seeds into /tmp/covers.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

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
    this.ws = new WebSocket(wsUrl); this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)(m); this.pending.delete(m.id); }
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

const seeds = process.argv.slice(2).map(Number);
const ff = Number(process.env.FF ?? 32);
mkdirSync('/tmp/covers', { recursive: true });
const server = spawn('node', ['serve.ts', '--port', '8081'], { cwd: ROOT, stdio: 'pipe' });
await waitFor('http://127.0.0.1:8081/index.html');
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-dev-shm-usage',
  '--remote-debugging-port=9335', '--use-gl=angle', '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader', '--window-size=1280,720', '--hide-scrollbars', 'about:blank'], { stdio: 'pipe' });
await waitFor('http://127.0.0.1:9335/json/version');
const targets = await (await fetch('http://127.0.0.1:9335/json/list')).json();
const cdp = new CDP(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
for (const seed of seeds) {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:8081/index.html?shot=play&seed=${seed}&ff=${ff}` });
  let ready = false;
  for (let i = 0; i < 60; i++) { await sleep(500); try { ready = await cdp.eval('window.__shotReady === true'); if (ready) break; } catch {} }
  await sleep(800);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 80 });
  writeFileSync(`/tmp/covers/play-seed${seed}-ff${ff}.jpg`, Buffer.from(shot.data, 'base64'));
  const info = await cdp.eval('JSON.stringify({hp: window.__state.player.hp, alive: window.__state.player.alive, x: +window.__state.player.x.toFixed(1), z: +window.__state.player.z.toFixed(1), phase: window.__state.phase, score: window.__state.score})');
  console.log(`seed ${seed}: ready=${ready} ${info}`);
}
cdp.close(); chrome.kill(); server.kill();
process.exit(0);
