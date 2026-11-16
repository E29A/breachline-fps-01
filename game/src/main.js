// main.js — loop glue: sim <-> renderer <-> HUD <-> audio <-> input.
// Fixed-step 1/60 simulation; the browser only renders what the sim says.

import { createMatch, DT, BOMB_TIME } from './state.js';
import { stepMatch } from './sim.js';
import { assignHolds, botsBuy } from './bots.js';
import { applyBuy, BUY_MENU } from './weapons.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { AudioSys } from './audio.js';
import { Input } from './input.js';

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? (Math.floor(Math.random() * 1e9) + 1));
const shotMode = params.get('shot'); // start | play | end (screenshots)
const ffParam = Number(params.get('ff') ?? 0);
const EMPTY = { lookX: 0, lookY: 0, moveX: 0, moveZ: 0, firing: false, reload: false, jump: false, crouch: false, walk: false, use: false };

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message ?? e.error)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('unhandledrejection: ' + String(e.reason)));

const state = createMatch(seed, true);
assignHolds(state);
botsBuy(state);
state.spectating = false;
window.__state = state;

let renderer;
try {
  renderer = new Renderer(document.getElementById('game'));
} catch (err) {
  window.__errors.push('renderer: ' + String(err));
  document.getElementById('overlay-copy').textContent = 'WebGL 2 is unavailable in this browser: ' + String(err);
}
const hud = new Hud(document);
const audio = new AudioSys();
const input = new Input(renderer?.renderer.domElement ?? document.body);

let playing = false;
let lastHits = 0;
let lastHp = state.player.hp;
let lastPhase = state.phase;
let lastRound = state.round;
let lastBombBeep = -1;
let pendingThrow = null;
let pendingSwitch = null;

function startPlaying() {
  if (playing) return;
  playing = true;
  audio.ensure();
  hud.hideOverlay();
  input.lock();
}

hud.el.play.addEventListener('click', startPlaying);

let hadLock = false;
input.onLockChange = (locked) => {
  if (locked) hadLock = true;
  // Only auto-pause when a lock we actually held is lost (Esc mid-game),
  // not when the first lock attempt fails (headless / denied).
  if (!locked && hadLock && playing && !hud.buyOpen && !shotMode) {
    hud.setOverlay('BREACHLINE', 'Paused — click to keep playing. First to 7 rounds wins the match.', 'Resume');
    playing = false;
  }
};
// Clicking anywhere re-locks the pointer while playing.
document.addEventListener('click', () => {
  if (playing && !input.locked && !hud.buyOpen) input.lock();
});

input.onKey = (code, down) => {
  if (!down) return;
  if (code === 'KeyB' && state.phase === 'buy') {
    const open = !hud.buyOpen;
    hud.toggleBuy(open, state.player.money);
    if (open) input.unlock(); else input.lock();
    if (open) audio.buySound();
  }
  if (code === 'Escape' && hud.buyOpen) {
    hud.toggleBuy(false, state.player.money);
    input.lock();
  }
  if (code === 'Digit1') pendingSwitch = 'sidearm';
  if (code === 'Digit2') pendingSwitch = state.player.weapons.find((w) => w !== 'sidearm') ?? null;
  if (code === 'Digit4') pendingThrow = 'frag';
  if (code === 'Digit5') pendingThrow = 'smoke';
  if (code === 'Digit6') pendingThrow = 'flash';
};

hud.buildBuy((item) => {
  if (state.phase !== 'buy') { audio.denied(); return; }
  if (applyBuy(state.player, item)) audio.buySound();
  else audio.denied();
  hud.toggleBuy(false, state.player.money);
  input.lock();
});

function spectateTarget() {
  const allies = state.agents.filter((a) => a.team === 'atk' && a.alive && !a.isPlayer);
  if (!allies.length) return state.agents.find((a) => a.alive) ?? state.player;
  let best = allies[0];
  let bd = Infinity;
  for (const a of allies) {
    const d = (a.x - state.player.x) ** 2 + (a.z - state.player.z) ** 2;
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

function handleEvents(events) {
  for (const e of events) {
    if (e.type === 'shot' && e.agent === state.player) audio.shot(state.player.weapon, 0);
    else if (e.type === 'shot' && e.agent) {
      const d = Math.hypot(e.agent.x - state.player.x, e.agent.z - state.player.z);
      if (d < 40) audio.shot(e.agent.weapon, d);
    }
    if (e.type === 'kill' && e.attacker === state.player) {
      hud.flashHitmarker(true);
      audio.hitmarker(true);
    }
    if (e.type === 'plant') {
      hud.showBanner('BOMB PLANTED', `Site ${state.bomb.site} — defend it, Jackals.`);
      audio.plantBeep();
    }
    if (e.type === 'defuse') {
      hud.showBanner('BOMB DEFUSED', 'Wardens take the round.');
      audio.defuseBeep();
    }
    if (e.type === 'round-end') {
      const won = e.winner === 'atk';
      hud.showBanner(won ? 'JACKALS TAKE THE ROUND' : 'WARDENS TAKE THE ROUND', e.reason);
      audio.roundSting(won);
    }
  }
  // Hitmarker on any pellet the player landed (stats counter).
  if (state.stats.hits > lastHits) {
    hud.flashHitmarker(false);
    audio.hitmarker(false);
    lastHits = state.stats.hits;
  }
  // Damage flash.
  if (state.player.hp < lastHp) hud.flashDamage();
  lastHp = state.player.hp;
  // Bomb beep once a second while planted.
  if (state.bomb.planted) {
    const sec = Math.ceil(state.phaseT);
    if (sec !== lastBombBeep) { lastBombBeep = sec; audio.bombBeep(); }
  }
  // Round start banner.
  if (state.phase !== lastPhase) {
    if (state.phase === 'live' && state.round !== lastRound) {
      lastRound = state.round;
      hud.showBanner(`ROUND ${state.round}`, `Plant the bomb on site ${state.player.site}. First to 7.`);
    }
    if (state.phase === 'over') {
      audio.matchSting(state.matchWinner === 'atk');
      hud.showMatchEnd(state.matchWinner, state.score);
    }
    lastPhase = state.phase;
  }
}

let acc = 0;
let lastT = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dtMs = Math.min(100, now - lastT);
  lastT = now;
  if (!playing) {
    // Still render the scene behind the overlay so the menu is alive.
    renderer.setCamera(state.player);
    renderer.render(state, [], 0);
    hud.update(state, now);
    return;
  }
  acc += dtMs / 1000;
  let steps = 0;
  const extra = { switchTo: pendingSwitch, throwGrenade: pendingThrow };
  pendingSwitch = null;
  pendingThrow = null;
  const inputFrame = input.frameInput(extra);
  const frameEvents = [];
  while (acc >= DT && steps < 5) {
    const events = stepMatch(state, inputFrame, DT);
    handleEvents(events);
    frameEvents.push(...events);
    acc -= DT;
    steps++;
    // Only the first tick of the frame carries the look deltas.
    inputFrame.lookX = 0;
    inputFrame.lookY = 0;
  }
  if (acc > DT * 5) acc = 0;
  // Footsteps.
  if (state.player.moving && state.player.onGround) audio.footstep(false);
  // Camera: player, or a spectated ally when dead.
  state.spectating = !state.player.alive;
  const cam = state.spectating ? spectateTarget() : state.player;
  renderer.setCamera(cam);
  renderer.render(state, frameEvents, dtMs / 1000);
  hud.update(state, now, cam);
}

window.addEventListener('resize', () => {
  renderer.resize(window.innerWidth, window.innerHeight);
});
renderer.resize(window.innerWidth, window.innerHeight);

// --- Screenshot modes (?shot=start|play|end): auto-play, no pointer lock ---
if (shotMode) {
  playing = true;
  hud.hideOverlay();
  audio.ensure = () => {};
  const ffSeconds = shotMode === 'play' ? (ffParam > 0 ? ffParam : 20) : shotMode === 'end' ? 150 : 0;
  if (ffSeconds > 0) {
    state.headless = true;
    const steps = Math.floor(ffSeconds * 60);
    for (let i = 0; i < steps; i++) {
      stepMatch(state, EMPTY, DT);
      if (shotMode === 'end' && (state.phase === 'planted' || state.phase === 'over')) break;
      if (shotMode === 'end' && state.phase === 'end') break;
    }
    state.headless = false;
    state.events = [];
  }
  // A few live ticks so the renderer has a fresh frame to show.
  for (let i = 0; i < 5; i++) stepMatch(state, EMPTY, DT);
  state.spectating = !state.player.alive;
  const shotCam = state.spectating ? spectateTarget() : state.player;
  renderer.setCamera(shotCam);
  renderer.render(state, [], 0);
  hud.update(state, performance.now(), shotCam);
  window.__shotReady = true;
}

requestAnimationFrame(frame);
