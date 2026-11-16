// bots.js — bot brains: A* routes, roles, vision, hearing, grenades, plant/defuse.
// Bots share the player's weapons and physics; they only differ in how the
// inputs are chosen. All randomness flows through state.rng (seeded).

import { SITES, groundHeight } from './mapdata.js';
import {
  AGENT_RADIUS, EYE_HEIGHT, collideCircle, findPath,
  hasLOS, nearestReachableWaypoint, nearestWaypoint, rayWorld, waypointGraph,
} from './physics.js';
import {
  WEAPONS, applyBuy, buyPolicy, canSee, currentSpread, fireHitscan,
  throwGrenade,
} from './weapons.js';
import { DEFUSE_TIME, PLANT_TIME, aliveCount } from './state.js';

const TAU = Math.PI * 2;

function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Desired move velocity toward (tx,tz) at `speed`, with collision + gravity. */
export function moveToward(state, a, tx, tz, dt, speed) {
  const dx = tx - a.x, dz = tz - a.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.15) { a.vx *= 0.7; a.vz *= 0.7; a.moving = false; return; }
  const k = Math.min(1, (speed / Math.max(d, 0.001)) * 0.9);
  const wantX = (dx / d) * speed, wantZ = (dz / d) * speed;
  const accel = a.onGround ? 26 : 8;
  a.vx += clamp(wantX - a.vx, -accel * dt, accel * dt);
  a.vz += clamp(wantZ - a.vz, -accel * dt, accel * dt);
  a.moving = Math.hypot(a.vx, a.vz) > 0.5;
  stepBody(state, a, dt);
}

/** Integrate velocity, collide, settle on the ground (incl. ramps/catwalk). */
export function stepBody(state, a, dt) {
  a.x += a.vx * dt;
  a.z += a.vz * dt;
  collideCircle(a, AGENT_RADIUS, a.y);
  // Vertical: gravity + ground snap.
  a.vy -= 22 * dt;
  a.y += a.vy * dt;
  const g = groundHeight(a.x, a.z);
  if (a.y <= g) {
    a.y = g; a.vy = 0; a.onGround = true;
  } else if (a.y - g < 0.35 && a.vy <= 0) {
    // Step down small drops smoothly instead of falling off ledges.
    a.y = g; a.vy = 0; a.onGround = true;
  } else {
    a.onGround = a.y <= g + 0.01;
  }
  a.airborne = !a.onGround;
}

function pickGoal(state, a) {
  const g = waypointGraph();
  if (a.team === 'atk') {
    if (state.bomb.planted) {
      // Guard the planted bomb from a nearby waypoint.
      const s = SITES[state.bomb.site];
      return nearestWaypoint(s.x + (a.id % 3 - 1) * 6, s.z + (a.id % 2 ? 5 : -5));
    }
    const s = SITES[a.site];
    return nearestWaypoint(s.x, s.z);
  }
  // Defenders: hold their site, or retake a planted bomb.
  if (state.bomb.planted) {
    return nearestWaypoint(state.bomb.x, state.bomb.z);
  }
  if (a.holdPos) return a.holdPos.wp;
  return nearestWaypoint(a.x, a.z);
}

function repath(state, a) {
  const from = nearestReachableWaypoint(a.x, a.z, a.y);
  const to = pickGoal(state, a);
  a.path = findPath(from, to);
  a.pathI = 0;
  a.planT = state.time;
}

/** Defender hold assignments: 2 on A, 2 on B, 1 roaming Mid. */
export function assignHolds(state) {
  const defs = state.agents.filter((x) => x.team === 'def');
  const holds = [
    { x: 22, z: -13, yaw: -Math.PI / 2 }, { x: 27, z: -17, yaw: Math.PI },
    { x: 22, z: 13, yaw: -Math.PI / 2 }, { x: 27, z: 17, yaw: Math.PI },
    { x: 0, z: 0, yaw: -Math.PI / 2 },
  ];
  defs.forEach((d, i) => {
    const h = holds[i % holds.length];
    d.holdPos = { x: h.x, z: h.z, yaw: h.yaw, wp: nearestWaypoint(h.x, h.z) };
  });
}

/** Bots spend their money at the start of the buy phase. */
export function botsBuy(state) {
  for (const a of state.agents) {
    if (a.isPlayer) continue;
    const buys = buyPolicy(a.money, a.weapons, a.kevlar, state.rng);
    for (const b of buys) applyBuy(a, b);
  }
}

/** Perceive: nearest visible enemy, or a remembered position. */
function perceive(state, a) {
  let best = null, bd = Infinity;
  for (const e of state.agents) {
    if (!e.alive || e.team === a.team) continue;
    if (canSee(state, a, e)) {
      const d = Math.hypot(e.x - a.x, e.z - a.z);
      if (d < bd) { bd = d; best = e; }
    }
  }
  if (best) {
    if (a.target !== best) {
      a.target = best;
      // Defenders hold angles: they react a beat faster than a pusher.
      const base = a.team === 'def' ? 0.2 : 0.35;
      a.reactUntil = state.time + base + state.rng() * 0.3;
      a.onTargetT = 0;
    }
    a.lastSeen = { x: best.x, y: best.y, z: best.z };
    a.lastSeenT = state.time;
  } else if (a.target && state.time - a.lastSeenT > 1.2) {
    a.target = null;
    a.onTargetT = 0;
  }
  // Hearing: a recent loud noise nearby becomes a place to check. Defenders
  // do not abandon their site for distant noise — only for sounds close to
  // where they hold.
  if (!a.target && state.time - a.lastSeenT > 3) {
    for (let i = state.noise.length - 1; i >= 0; i--) {
      const n = state.noise[i];
      if (state.time - n.t > 2.5) continue;
      const d = Math.hypot(n.x - a.x, n.z - a.z);
      if (d < n.radius * 0.8 && d > 6) {
        if (a.team === 'def' && a.holdPos && Math.hypot(n.x - a.holdPos.x, n.z - a.holdPos.z) > 12) continue;
        a.lastSeen = { x: n.x, y: n.y ?? 0, z: n.z };
        a.lastSeenT = state.time;
        break;
      }
    }
  }
}

/** Aim the bot's yaw/pitch at a point; returns angle error vs the true point. */
function aimAt(state, a, tx, ty, tz, dt) {
  const dx = tx - a.x, dz = tz - a.z;
  const dist = Math.hypot(dx, dz) || 0.001;
  const wantYaw = Math.atan2(dx, dz);
  // Pitch follows the sim's convention: dy = sin(pitch), so a target below
  // eye level needs a negative pitch (no negation here).
  const wantPitch = Math.atan2(ty - (a.y + EYE_HEIGHT), dist);
  const turn = 7.5 * dt;
  a.yaw += clamp(angDiff(a.yaw, wantYaw), -turn, turn);
  a.pitch += clamp(wantPitch - a.pitch, -turn * 0.6, turn * 0.6);
  return Math.abs(angDiff(a.yaw, wantYaw)) + Math.abs(a.pitch - wantPitch);
}

/** Try to fire the bot's weapon at its target. */
function tryFire(state, a, dt) {
  const w = WEAPONS[a.weapon];
  if (a.mag <= 0) {
    if (a.reloading <= 0 && a.reserve > 0) a.reloading = w.reload;
    return;
  }
  if (a.reloading > 0 || state.time < a.lastShot + w.rof) return;
  if (state.time < a.reactUntil) return;
  if (state.time < a.blindUntil) return;
  const t = a.target;
  if (!t || !t.alive) return;
  const aimErr = aimAt(state, a, t.x, t.y + 1.0, t.z, dt);
  if (aimErr > 0.02) return; // still swinging onto the target
  // Burst discipline: autos fire short bursts, then pause.
  if (w.auto) {
    a.burst = (a.burst ?? 0) + 1;
    if (a.burst > 4) { a.burst = 0; a.lastShot = state.time + 0.45; return; }
  }
  a.lastShot = state.time;
  a.mag--;
  a.bloom = Math.min(0.03, a.bloom + w.recoil * 0.2);
  a.recoil = Math.min(0.09, a.recoil + w.recoil);
  const dx = Math.sin(a.yaw) * Math.cos(a.pitch);
  const dy = Math.sin(a.pitch);
  const dz = Math.cos(a.yaw) * Math.cos(a.pitch);
  // Aim error is shot dispersion that shrinks the longer the bot tracks.
  // Defenders, settled on an angle, shoot a touch steadier than pushers.
  const jBase = a.team === 'def' ? 0.01 : 0.012;
  const jitter = jBase * Math.exp(-a.onTargetT * 1.8) + 0.004;
  const spread = currentSpread(a, a.moving, a.airborne) + jitter;
  const res = fireHitscan(state, a, dx, dy, dz, spread, (target, zone, dmg) => {
    state.damageAgent(target, dmg, a, zone);
  });
  state.stats.shots++;
  state.stats.hits += res.hits.length;
  state.noise.push({ x: a.x, y: a.y, z: a.z, radius: 30, kind: 'shot', t: state.time });
  state.events.push({ type: 'shot', agent: a, from: { x: a.x, y: a.y + EYE_HEIGHT, z: a.z }, to: res.end, wall: res.wallHit, t: state.time });
}

/** Grenade tactics: smoke a push, flash a site entry, frag a known position. */
function tryGrenade(state, a, dt) {
  if (state.time < a.throwCooldown) return;
  const g = a.grenades;
  const site = SITES[a.site ?? 'A'];
  if (a.team === 'atk' && !state.bomb.planted) {
    const dSite = Math.hypot(site.x - a.x, site.z - a.z);
    if (dSite < 20 && (g.smoke ?? 0) > 0 && state.rng() < 0.25) {
      a.grenades.smoke--;
      a.throwCooldown = state.time + 6;
      const dx = (site.x - a.x) / dSite, dz = (site.z - a.z) / dSite;
      throwGrenade(state, a, 'smoke', dx, 0.25, dz);
      return;
    }
    if (dSite < 14 && (g.flash ?? 0) > 0 && state.rng() < 0.3) {
      a.grenades.flash--;
      a.throwCooldown = state.time + 6;
      const dx = (site.x - a.x) / dSite, dz = (site.z - a.z) / dSite;
      throwGrenade(state, a, 'flash', dx, 0.35, dz);
      return;
    }
  }
  if (a.lastSeen && state.time - a.lastSeenT < 2 && (g.frag ?? 0) > 0) {
    const d = Math.hypot(a.lastSeen.x - a.x, a.lastSeen.z - a.z);
    if (d < 22 && d > 4 && state.rng() < 0.35) {
      a.grenades.frag--;
      a.throwCooldown = state.time + 8;
      const dx = (a.lastSeen.x - a.x) / d, dz = (a.lastSeen.z - a.z) / d;
      throwGrenade(state, a, 'frag', dx, 0.45, dz);
    }
  }
}

function inSite(a, siteKey) {
  const s = SITES[siteKey];
  return Math.hypot(a.x - s.x, a.z - s.z) < s.r;
}

/** One bot tick. */
export function updateBot(state, a, dt) {
  if (!a.alive || state.phase === 'over' || state.phase === 'end') return;
  // No combat during the buy phase: bots stage just outside spawn, and do
  // not acquire targets until the round starts.
  if (state.phase === 'buy') {
    const g = waypointGraph().nodes[nearestWaypoint(a.x + (a.team === 'atk' ? 3 : -3), a.z)];
    moveToward(state, a, g.x, g.z, dt, WEAPONS[a.weapon].speed * 0.6);
    return;
  }
  if (state.time < a.blindUntil) {
    // Blinded: freeze, face away from the flash slowly.
    a.yaw += dt * 0.4;
    a.vx *= 0.8; a.vz *= 0.8;
    stepBody(state, a, dt);
    return;
  }
  perceive(state, a);
  if (a.target) a.onTargetT += dt; else a.onTargetT = 0;
  a.bloom = Math.max(0, a.bloom - dt * 0.12);
  a.recoil = Math.max(0, a.recoil - dt * 0.16);
  // Reloads finish here (the player reloads in sim.js).
  if (a.reloading > 0) {
    a.reloading -= dt;
    if (a.reloading <= 0) {
      const w = WEAPONS[a.weapon];
      const take = Math.min(w.mag - a.mag, a.reserve);
      a.mag += take; a.reserve -= take;
    }
  } else if (!a.target && a.mag < WEAPONS[a.weapon].mag * 0.4 && a.reserve > 0) {
    a.reloading = WEAPONS[a.weapon].reload; // top up between fights
  }

  const w = WEAPONS[a.weapon];
  const speed = w.speed * (a.crouch ? 0.55 : 1);

  // --- Bomb interactions take priority ---
  // Any attacker standing in a site plants (the carrier is just the bot the
  // team follows); the channel pauses while an enemy is close and watching.
  if (a.team === 'atk' && !state.bomb.planted && state.phase === 'live') {
    if (inSite(a, a.site)) {
      // Planting is loud and obvious: any enemy close by stops it, even
      // one facing the wrong way; further out they must have line of sight.
      const nearEnemy = state.agents.some((e) => {
        if (!e.alive || e.team === a.team) return false;
        const d = Math.hypot(e.x - a.x, e.z - a.z);
        return d < 10 || (d < 16 && canSee(state, e, a));
      });
      if (!nearEnemy || a.target === null) {
        a.mode = 'plant';
        a.plantProgress += dt;
        a.vx = 0; a.vz = 0; a.moving = false;
        if (a.plantProgress >= PLANT_TIME) {
          state.bomb.planted = true;
          state.bomb.x = a.x; state.bomb.z = a.z; state.bomb.site = a.site;
          state.bomb.timer = 35; state.bomb.planter = a;
          state.phase = 'planted'; state.phaseT = 35;
          state.stats.plants++;
          a.hasPlanted = true;
          a.money += 300;
          state.addFeed(`${a.name} planted the bomb on site ${a.site}`, 'atk');
          state.events.push({ type: 'plant', agent: a, t: state.time });
        }
        stepBody(state, a, dt);
        return;
      }
    }
  }
  if (a.team === 'def' && state.bomb.planted) {
    const d = Math.hypot(a.x - state.bomb.x, a.z - state.bomb.z);
    if (d < 1.6 && !a.target) {
      a.mode = 'defuse';
      a.defuseProgress += dt;
      a.vx = 0; a.vz = 0; a.moving = false;
      if (a.defuseProgress >= DEFUSE_TIME) {
        state.stats.defuses++;
        a.money += 300;
        state.addFeed(`${a.name} defused the bomb`, 'def');
        state.events.push({ type: 'defuse', agent: a, t: state.time });
        state.pendingWinner = 'def';
      }
      stepBody(state, a, dt);
      return;
    }
  }
  a.plantProgress = Math.max(0, a.plantProgress - dt * 2);
  a.defuseProgress = Math.max(0, a.defuseProgress - dt * 2);

  // --- Combat: stop and shoot when a target is visible ---
  if (a.target && a.target.alive) {
    a.mode = 'engage';
    // Late in the round, attackers push the site while firing instead of
    // stopping to duel in mid — otherwise rounds time out with nobody home.
    const latePush = a.team === 'atk' && state.phase === 'live' && state.phaseT < 35 && !state.bomb.planted;
    if (latePush) {
      if (!a.path.length || state.time - a.planT > 3) repath(state, a);
      const nodes = waypointGraph().nodes;
      if (a.pathI < a.path.length) {
        const wp = nodes[a.path[a.pathI]];
        if (Math.hypot(wp.x - a.x, wp.z - a.z) < 1.1) a.pathI++;
        else moveToward(state, a, wp.x, wp.z, dt, speed);
      }
      tryFire(state, a, dt);
      return;
    }
    // Strafe while engaging.
    a.strafeT -= dt;
    if (a.strafeT <= 0) { a.strafeDir = state.rng() < 0.5 ? -1 : 1; a.strafeT = 0.5 + state.rng() * 0.8; }
    const t = a.target;
    const dx = t.x - a.x, dz = t.z - a.z;
    const dist = Math.hypot(dx, dz) || 1;
    const px = -dz / dist * a.strafeDir, pz = dx / dist * a.strafeDir;
    const back = dist < 7 ? -1 : 0.2;
    moveToward(state, a, a.x + px * 2 + (dx / dist) * back * 2, a.z + pz * 2 + (dz / dist) * back * 2, dt, speed * 0.55);
    tryFire(state, a, dt);
    tryGrenade(state, a, dt);
    return;
  }

  // --- Hold / rotate / push ---
  if (a.team === 'def' && !state.bomb.planted && a.holdPos && state.time - a.lastSeenT > 4) {
    const d = Math.hypot(a.holdPos.x - a.x, a.holdPos.z - a.z);
    if (d > 1.2) {
      a.mode = 'hold';
      moveToward(state, a, a.holdPos.x, a.holdPos.z, dt, speed * 0.8);
      return;
    }
    a.mode = 'hold';
    a.crouch = state.rng() < 0.001;
    const turn = 2.2 * dt;
    a.yaw += clamp(angDiff(a.yaw, a.holdPos.yaw + Math.sin(state.time * 0.3 + a.id) * 0.8), -turn, turn);
    a.vx = 0; a.vz = 0; a.moving = false;
    stepBody(state, a, dt);
    return;
  }
  a.crouch = false;

  // Push along the waypoint path; replan when the goal or situation changed.
  if (!a.path.length || state.time - a.planT > 3 || a.mode === 'guard') repath(state, a);
  const nodes = waypointGraph().nodes;
  if (a.pathI >= a.path.length) {
    // Arrived: attackers wait in/near the site; defenders re-hold.
    if (a.team === 'atk' && !state.bomb.planted) {
      const s = SITES[a.site];
      moveToward(state, a, s.x + Math.sin(a.id * 2.1) * 2, s.z + Math.cos(a.id * 1.7) * 2, dt, speed * 0.5);
    } else {
      a.path = []; a.planT = state.time;
    }
    tryGrenade(state, a, dt);
    return;
  }
  const wp = nodes[a.path[a.pathI]];
  const d = Math.hypot(wp.x - a.x, wp.z - a.z);
  if (d < 1.1) { a.pathI++; return; }
  // Face the direction of travel while pushing.
  const wantYaw = Math.atan2(wp.x - a.x, wp.z - a.z);
  a.yaw += clamp(angDiff(a.yaw, wantYaw), -6 * dt, 6 * dt);
  a.mode = state.bomb.planted ? 'retake' : 'advance';
  moveToward(state, a, wp.x, wp.z, dt, speed);
  tryGrenade(state, a, dt);
}

