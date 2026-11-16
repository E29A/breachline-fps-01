// weapons.js — weapon definitions, hitscan fire, grenades, buy policy.
// Shared by the player and the bots: one fire function, one damage model.

import { rayBox, raySphere, rayWorld, smokeBlocks } from './physics.js';
import { OBSTACLES } from './mapdata.js';

// damage: base chest damage. head x4, leg x0.75. falloff: full damage to
// falloff[0] m, linear down to falloff[1] x at falloff[1] m.
export const WEAPONS = {
  sidearm: {
    name: 'P9 Sidearm', price: 0, damage: 26, headMult: 4, legMult: 0.75,
    rof: 0.16, mag: 12, reserve: 36, reload: 1.5, spread: 0.011, moveSpread: 0.02,
    airSpread: 0.05, recoil: 0.011, auto: false, pellets: 1, falloff: [12, 40, 0.55],
    speed: 4.6, range: 60,
  },
  scatterjack: {
    name: 'Scatterjack', price: 900, damage: 11, headMult: 4, legMult: 0.75,
    rof: 0.85, mag: 6, reserve: 24, reload: 2.6, spread: 0.045, moveSpread: 0.03,
    airSpread: 0.07, recoil: 0.045, auto: false, pellets: 8, falloff: [6, 18, 0.35],
    speed: 4.3, range: 40,
  },
  raptor: {
    name: 'Raptor-9', price: 1100, damage: 30, headMult: 4, legMult: 0.75,
    rof: 0.1, mag: 30, reserve: 90, reload: 2.2, spread: 0.013, moveSpread: 0.028,
    airSpread: 0.06, recoil: 0.014, auto: true, pellets: 1, falloff: [18, 55, 0.6],
    speed: 4.5, range: 90,
  },
  longarm: {
    name: 'VK-7 Longarm', price: 2700, damage: 78, headMult: 4, legMult: 0.75,
    rof: 1.15, mag: 5, reserve: 20, reload: 3.1, spread: 0.004, moveSpread: 0.035,
    airSpread: 0.08, recoil: 0.05, auto: false, pellets: 1, falloff: [30, 90, 0.7],
    speed: 4.2, range: 120,
  },
};

export const GRENADES = {
  frag: { name: 'Frag', price: 300, radius: 6.5, maxDmg: 95 },
  smoke: { name: 'Smoke', price: 250, radius: 4.2, duration: 15 },
  flash: { name: 'Flash', price: 200, radius: 20, duration: 2.6 },
};

export const BUY_MENU = [
  { id: 'scatterjack', kind: 'weapon' },
  { id: 'raptor', kind: 'weapon' },
  { id: 'longarm', kind: 'weapon' },
  { id: 'kevlar', kind: 'kevlar', price: 650 },
  { id: 'frag', kind: 'grenade' },
  { id: 'smoke', kind: 'grenade' },
  { id: 'flash', kind: 'grenade' },
];

/** The buy policy bots use (and the player menu offers): spend sensibly. */
export function buyPolicy(money, owned, hasKevlar, rng) {
  const buys = [];
  let m = money;
  const want = m >= 2900 ? 'longarm' : m >= 1500 ? 'raptor' : m >= 1000 ? 'scatterjack' : null;
  if (want && !owned.includes(want) && m >= WEAPONS[want].price) {
    buys.push({ id: want, kind: 'weapon' });
    m -= WEAPONS[want].price;
  }
  if (!hasKevlar && m >= 650 && rng() < 0.8) { buys.push({ id: 'kevlar', kind: 'kevlar' }); m -= 650; }
  if (m >= 300 && rng() < 0.55) { buys.push({ id: 'frag', kind: 'grenade' }); m -= 300; }
  if (m >= 250 && rng() < 0.6) { buys.push({ id: 'smoke', kind: 'grenade' }); m -= 250; }
  if (m >= 200 && rng() < 0.5) { buys.push({ id: 'flash', kind: 'grenade' }); m -= 200; }
  return buys;
}

export function applyBuy(agent, item) {
  if (item.kind === 'weapon') {
    const w = WEAPONS[item.id];
    if (agent.money < w.price || agent.weapons.includes(item.id)) return false;
    agent.money -= w.price;
    agent.weapons.push(item.id);
    agent.weapon = item.id;
    agent.mag = w.mag;
    agent.reserve = w.reserve;
    return true;
  }
  if (item.kind === 'kevlar') {
    if (agent.money < 650 || agent.kevlar) return false;
    agent.money -= 650;
    agent.kevlar = true;
    agent.armor = 100;
    return true;
  }
  const g = GRENADES[item.id];
  if (agent.money < g.price || (agent.grenades[item.id] ?? 0) >= 2) return false;
  agent.money -= g.price;
  agent.grenades[item.id] = (agent.grenades[item.id] ?? 0) + 1;
  return true;
}

/** Damage at range with falloff. */
export function damageAt(w, dist, zone) {
  const [a, b, minF] = w.falloff;
  let f = 1;
  if (dist > a) f = Math.max(minF, 1 - ((dist - a) / (b - a)) * (1 - minF));
  let d = w.damage * f;
  if (zone === 'head') d *= w.headMult;
  else if (zone === 'leg') d *= w.legMult;
  return d;
}

/** Hit spheres of an agent: head, chest, legs (centres relative to feet). */
export function hitSpheres(a) {
  const crouch = a.crouch ? 0.72 : 1;
  return [
    { zone: 'head', y: a.y + 1.52 * crouch, r: 0.22 },
    { zone: 'chest', y: a.y + 1.02 * crouch, r: 0.36 },
    { zone: 'leg', y: a.y + 0.45 * crouch, r: 0.32 },
  ];
}

/**
 * Fire one trigger pull from `shooter` along direction (dx,dy,dz) with a
 * spread cone. Returns {hits, wallT, tracerEnd} and applies damage through
 * `onHit(target, zone, dmg, dist)`. Pellets fan out from the same origin.
 */
export function fireHitscan(state, shooter, dx, dy, dz, spreadRad, onHit) {
  const w = WEAPONS[shooter.weapon];
  const eyeY = shooter.y + (shooter.crouch ? 1.15 : 1.62);
  const ox = shooter.x, oy = eyeY, oz = shooter.z;
  const hits = [];
  let wallT = rayWorld(ox, oy, oz, dx, dy, dz);
  let endT = wallT;
  for (let p = 0; p < w.pellets; p++) {
    // Random direction inside the spread cone (uniform disc).
    const a = state.rng() * Math.PI * 2;
    const r = spreadRad * Math.sqrt(state.rng());
    const px = Math.cos(a) * r, py = Math.sin(a) * r;
    // Orthonormal basis around (dx,dy,dz).
    const ux = -dz, uz = dx;
    const ul = Math.hypot(ux, uz) || 1;
    const vx = -dy * dx, vy = 1 - dy * dy, vz = -dy * dz;
    let nx = dx + (ux / ul) * px + vx * py;
    let ny = dy + vy * py;
    let nz = dz + (uz / ul) * px + vz * py;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;
    let bestT = Math.min(wallT, w.range);
    let bestTarget = null, bestZone = null;
    for (const t of state.agents) {
      if (t === shooter || !t.alive || t.team === shooter.team) continue;
      for (const s of hitSpheres(t)) {
        const tt = raySphere(ox, oy, oz, nx, ny, nz, t.x, s.y, t.z, s.r);
        if (tt < bestT) { bestT = tt; bestTarget = t; bestZone = s.zone; }
      }
    }
    if (bestTarget) {
      const dist = bestT;
      const dmg = damageAt(w, dist, bestZone);
      hits.push({ target: bestTarget, zone: bestZone, dmg, dist });
      onHit(bestTarget, bestZone, dmg, dist);
      if (bestT < endT) endT = bestT;
    }
  }
  const end = {
    x: ox + dx * endT, y: oy + dy * endT, z: oz + dz * endT,
  };
  return { hits, wallT, end, wallHit: wallT < w.range };
}

/** Spread (radians) for an agent this tick: bloom + movement + air, crouch bonus.
 *  The movement penalty scales with actual speed, so a slow strafe costs less. */
export function currentSpread(agent, moving, airborne) {
  const w = WEAPONS[agent.weapon];
  let s = w.spread + agent.bloom;
  if (moving) {
    const f = Math.min(1, Math.hypot(agent.vx, agent.vz) / 4.5);
    s += w.moveSpread * f;
  }
  if (airborne) s += w.airSpread;
  if (agent.crouch) s *= 0.7;
  return s;
}

/** Throw a grenade: returns a live grenade object added to state.grenades. */
export function throwGrenade(state, agent, kind, dx, dy, dz) {
  const eyeY = agent.y + (agent.crouch ? 1.15 : 1.62);
  const g = {
    kind, x: agent.x, y: eyeY, z: agent.z,
    vx: dx * 13, vy: dy * 13 + 3.2, vz: dz * 13,
    t: 0, fuse: kind === 'frag' ? 1.6 : 1.1, owner: agent,
  };
  state.grenades.push(g);
  return g;
}

/** Step one grenade: bounce off walls/floor, detonate on fuse. */
export function stepGrenade(state, g, dt) {
  g.t += dt;
  g.vy -= 18 * dt;
  g.x += g.vx * dt;
  g.y += g.vy * dt;
  g.z += g.vz * dt;
  const gy = 0.12;
  if (g.y < gy) { g.y = gy; g.vy = Math.abs(g.vy) * 0.35; g.vx *= 0.6; g.vz *= 0.6; }
  for (const o of OBSTACLES) {
    if (g.y > o.h) continue;
    if (g.x > o.x0 && g.x < o.x1 && g.z > o.z0 && g.z < o.z1) {
      // Simple bounce: push back along the smallest axis.
      const pl = g.x - o.x0, pr = o.x1 - g.x, pt = g.z - o.z0, pb = o.z1 - g.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) { g.x = o.x0; g.vx = -Math.abs(g.vx) * 0.4; }
      else if (m === pr) { g.x = o.x1; g.vx = Math.abs(g.vx) * 0.4; }
      else if (m === pt) { g.z = o.z0; g.vz = -Math.abs(g.vz) * 0.4; }
      else { g.z = o.z1; g.vz = Math.abs(g.vz) * 0.4; }
    }
  }
  if (g.t >= g.fuse) return true; // detonate
  return false;
}

/** A grenade's detonation effects. Returns an event list for the HUD/feed. */
export function detonateGrenade(state, g) {
  const events = [];
  if (g.kind === 'frag') {
    const def = GRENADES.frag;
    for (const a of state.agents) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - g.x, (a.y + 0.9) - g.y, a.z - g.z);
      if (d < def.radius) {
        const dmg = def.maxDmg * (1 - d / def.radius) * 0.7 + def.maxDmg * 0.3 * (1 - d / def.radius);
        state.damageAgent(a, dmg, g.owner, 'frag');
        events.push({ type: 'frag-hit', target: a, dmg });
      }
    }
    state.noise.push({ x: g.x, y: g.y, z: g.z, radius: 34, kind: 'explosion', t: state.time });
  } else if (g.kind === 'smoke') {
    state.smokes.push({ x: g.x, y: Math.max(1.2, g.y), z: g.z, r: GRENADES.smoke.radius, until: state.time + GRENADES.smoke.duration });
  } else if (g.kind === 'flash') {
    for (const a of state.agents) {
      if (!a.alive || a === g.owner) continue;
      const d = Math.hypot(a.x - g.x, (a.y + 1.2) - g.y, a.z - g.z);
      if (d > GRENADES.flash.radius) continue;
      // Flash blinds only when the burst is in front of the agent and visible.
      const fx = Math.sin(a.yaw), fz = Math.cos(a.yaw);
      const tx = g.x - a.x, tz = g.z - a.z;
      const dot = (fx * tx + fz * tz) / (Math.hypot(tx, tz) || 1);
      const los = state.hasLOS ? state.hasLOS(a.x, a.y + 1.2, a.z, g.x, g.y, g.z) : true;
      if (dot > -0.2 && los) {
        const strength = Math.max(0.25, 1 - d / GRENADES.flash.radius);
        a.blindUntil = Math.max(a.blindUntil, state.time + GRENADES.flash.duration * strength);
        events.push({ type: 'flash-hit', target: a });
      }
    }
  }
  return events;
}

/** Can `a` see `b` right now (range, cone, LOS, smoke)? */
export function canSee(state, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const dist = Math.hypot(dx, dz);
  const range = 30;
  if (dist > range) return false;
  const ay = a.y + (a.crouch ? 1.15 : 1.62);
  const by = b.y + (b.crouch ? 1.0 : 1.1);
  const fwdX = Math.sin(a.yaw), fwdZ = Math.cos(a.yaw);
  const dot = (fwdX * dx + fwdZ * dz) / (dist || 1);
  if (dot < 0.12) return false; // ~83-degree half cone
  if (!state.hasLOS(a.x, ay, a.z, b.x, by, b.z)) return false;
  if (smokeBlocks(a.x, ay, a.z, b.x, by, b.z, state.smokes)) return false;
  return true;
}
