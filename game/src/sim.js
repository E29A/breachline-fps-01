// sim.js — the fixed-step simulation (1/60 s), three-free.
// Owns the per-tick order: player input -> bots -> grenades -> bomb -> round.
// The browser renders this state; Node runs it headless for validation.

import { DT } from './state.js';
import { updateBot, stepBody } from './bots.js';
import { updateRound } from './round.js';
import {
  WEAPONS, currentSpread, detonateGrenade, fireHitscan,
  stepGrenade, throwGrenade,
} from './weapons.js';
import { EYE_HEIGHT } from './physics.js';
import { SITES } from './mapdata.js';

/** Apply one tick of player input. `input` is the frame's control state. */
export function stepPlayer(state, input, dt) {
  const p = state.player;
  if (!p.alive) return;
  if (state.time < p.blindUntil) input = { ...input, firing: false };
  p.yaw -= input.lookX * 0.0023;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch - input.lookY * 0.0023));
  p.pitch += p.recoil * 0.55;
  p.recoil = Math.max(0, p.recoil - dt * 0.12);
  p.bloom = Math.max(0, p.bloom - dt * 0.12);

  const w = WEAPONS[p.weapon];
  const speed = w.speed * (input.crouch ? 0.55 : 1) * (input.walk ? 0.6 : 1);
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  // input.moveX: strafe right, input.moveZ: forward.
  const mx = sin * input.moveZ + cos * input.moveX;
  const mz = cos * input.moveZ - sin * input.moveX;
  const accel = p.onGround ? 30 : 9;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  p.vx += clamp(mx * speed - p.vx, -accel * dt, accel * dt);
  p.vz += clamp(mz * speed - p.vz, -accel * dt, accel * dt);
  p.moving = Math.hypot(p.vx, p.vz) > 0.5;
  if (input.jump && p.onGround) { p.vy = 7.2; p.onGround = false; }
  p.crouch = !!input.crouch;
  stepBody(state, p, dt);

  // Reload.
  if (p.reloading > 0) {
    p.reloading -= dt;
    if (p.reloading <= 0) {
      const need = w.mag - p.mag;
      const take = Math.min(need, p.reserve);
      p.mag += take; p.reserve -= take;
    }
  } else if (input.reload && p.mag < w.mag && p.reserve > 0) {
    p.reloading = w.reload;
  }

  // Fire (not during the buy phase — the round has not started).
  if (input.firing && state.phase !== 'buy' && p.reloading <= 0 && state.time >= p.lastShot + w.rof) {
    if (p.mag > 0) {
      p.lastShot = state.time;
      p.mag--;
      p.bloom = Math.min(0.03, p.bloom + w.recoil * 0.2);
      p.recoil = Math.min(0.09, p.recoil + w.recoil);
      const dx = Math.sin(p.yaw) * Math.cos(p.pitch);
      const dy = Math.sin(p.pitch);
      const dz = Math.cos(p.yaw) * Math.cos(p.pitch);
      const spread = currentSpread(p, p.moving, p.airborne);
      const res = fireHitscan(state, p, dx, dy, dz, spread, (target, zone, dmg) => {
        state.damageAgent(target, dmg, p, zone);
      });
      state.stats.shots++;
      state.stats.hits += res.hits.length;
      state.noise.push({ x: p.x, y: p.y, z: p.z, radius: 30, kind: 'shot', t: state.time });
      state.events.push({
        type: 'shot', agent: p,
        from: { x: p.x, y: p.y + EYE_HEIGHT, z: p.z },
        to: res.end, wall: res.wallHit, t: state.time,
      });
    } else if (input.firing && p.reserve > 0) {
      p.reloading = w.reload;
    }
  }

  // Weapon switch.
  if (input.switchTo && input.switchTo !== p.weapon && p.weapons.includes(input.switchTo)) {
    p.weapon = input.switchTo;
    p.mag = WEAPONS[p.weapon].mag;
    p.reserve = WEAPONS[p.weapon].reserve;
    p.reloading = 0;
  }

  // Grenade throw.
  if (input.throwGrenade && p.grenades[input.throwGrenade] > 0) {
    const kind = input.throwGrenade;
    p.grenades[kind]--;
    const dx = Math.sin(p.yaw) * Math.cos(p.pitch);
    const dy = Math.sin(p.pitch);
    const dz = Math.cos(p.yaw) * Math.cos(p.pitch);
    throwGrenade(state, p, kind, dx, dy, dz);
  }

  // Plant / defuse channels (hold E).
  if (input.use) {
    if (p.team === 'atk' && !state.bomb.planted && state.phase === 'live') {
      const siteKey = Object.keys(SITES).find((k) => Math.hypot(p.x - SITES[k].x, p.z - SITES[k].z) < SITES[k].r);
      if (siteKey) {
        p.plantProgress += dt;
        if (p.plantProgress >= 3.2) {
          state.bomb.planted = true;
          state.bomb.x = p.x; state.bomb.z = p.z; state.bomb.site = siteKey;
          state.bomb.timer = 35; state.bomb.planter = p;
          state.phase = 'planted'; state.phaseT = 35;
          state.stats.plants++;
          p.money += 300;
          state.addFeed('You planted the bomb on site ' + siteKey, 'atk');
          state.events.push({ type: 'plant', agent: p, t: state.time });
        }
      }
    } else if (p.team === 'def' && state.bomb.planted) {
      const d = Math.hypot(p.x - state.bomb.x, p.z - state.bomb.z);
      if (d < 1.6) {
        p.defuseProgress += dt;
        if (p.defuseProgress >= 5) {
          state.stats.defuses++;
          p.money += 300;
          state.addFeed('You defused the bomb', 'def');
          state.events.push({ type: 'defuse', agent: p, t: state.time });
          state.pendingWinner = 'def';
        }
      }
    }
  } else {
    p.plantProgress = Math.max(0, p.plantProgress - dt * 2);
    p.defuseProgress = Math.max(0, p.defuseProgress - dt * 2);
  }
}

/** One fixed step of the whole match. */
export function stepMatch(state, input, dt = DT) {
  state.time += dt;
  if (state.phase !== 'over') {
    if (!state.headless) stepPlayer(state, input, dt);
    for (const a of state.agents) {
      if (!a.isPlayer || state.headless) updateBot(state, a, dt);
    }
    // Grenades.
    for (let i = state.grenades.length - 1; i >= 0; i--) {
      const g = state.grenades[i];
      if (stepGrenade(state, g, dt)) {
        detonateGrenade(state, g);
        state.events.push({ type: 'grenade', kind: g.kind, x: g.x, y: g.y, z: g.z, t: state.time });
        state.grenades.splice(i, 1);
      }
    }
    // Expire smoke and old noise.
    state.smokes = state.smokes.filter((s) => state.time < s.until);
    if (state.noise.length > 40) state.noise.splice(0, state.noise.length - 40);
    updateRound(state, dt);
  }
  // Drain per-tick events for the renderer (it reads then clears).
  const ev = state.events;
  state.events = [];
  return ev;
}
