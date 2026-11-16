// state.js — one store for the whole match: teams, agents, economy, rounds.
// Everything the sim and the renderer read lives here and nowhere else.

import { SPAWNS } from './mapdata.js';
import { WEAPONS } from './weapons.js';
import { hasLOS } from './physics.js';

export const DT = 1 / 60;
export const WIN_ROUNDS = 7;
export const MAX_ROUNDS = 13;
export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const BOMB_TIME = 35;
export const PLANT_TIME = 3.2;
export const DEFUSE_TIME = 5;

export const BOT_NAMES = {
  atk: ['Vex', 'Mara', 'Kilo', 'Dune'],
  def: ['Sable', 'Rook', 'Iris', 'Hale', 'Fenn'],
};

/** Deterministic RNG (mulberry32). */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fresh agent. slot 0 of the attackers is the human player. */
export function makeAgent(id, team, name, isPlayer, spawn) {
  return {
    id, team, name, isPlayer,
    alive: true, hp: 100, armor: 0, kevlar: false,
    x: spawn.x, z: spawn.z, y: 0, yaw: team === 'atk' ? Math.PI / 2 : -Math.PI / 2,
    pitch: 0, vx: 0, vz: 0, vy: 0, onGround: true,
    crouch: false, moving: false, airborne: false,
    weapon: 'sidearm', weapons: ['sidearm'], mag: 12, reserve: 36,
    grenades: {}, money: 800, kills: 0, deaths: 0,
    bloom: 0, recoil: 0, lastShot: -9, reloading: 0, switchT: 0,
    plantProgress: 0, defuseProgress: 0, blindUntil: 0, flashT: 0,
    // Bot brain (unused by the human).
    mode: 'advance', path: [], pathI: 0, target: null, lastSeen: null,
    lastSeenT: -99, holdPos: null, holdYaw: 0, reactUntil: 0,
    aimErr: 0.05, onTargetT: 0, site: null, planT: 0, strafeDir: 1,
    strafeT: 0, throwCooldown: 0, hasPlanted: false,
  };
}

/** A fresh match. `withPlayer` false replaces slot 0 with a bot (headless). */
export function createMatch(seed, withPlayer = true) {
  const rng = makeRng(seed);
  const state = {
    seed, rng, time: 0, round: 1,
    score: { atk: 0, def: 0 },
    phase: 'buy', phaseT: BUY_TIME, roundWinner: null, matchWinner: null,
    bomb: { planted: false, x: 0, z: 0, site: null, timer: 0, planter: null },
    agents: [], grenades: [], smokes: [], noise: [],
    events: [], feed: [], roundLog: [],
    stats: { plants: 0, defuses: 0, rounds: 0, shots: 0, hits: 0 },
    pendingWinner: null, headless: false,
    hasLOS: (ax, ay, az, bx, by, bz) => hasLOS(ax, ay, az, bx, by, bz),
  };
  for (let i = 0; i < 5; i++) {
    state.agents.push(makeAgent(i, 'atk', i === 0 ? 'You' : BOT_NAMES.atk[i - 1], withPlayer && i === 0, SPAWNS.atk[i]));
  }
  for (let i = 0; i < 5; i++) {
    state.agents.push(makeAgent(5 + i, 'def', BOT_NAMES.def[i], false, SPAWNS.def[i]));
  }
  state.player = state.agents[0];
  state.damageAgent = (target, dmg, attacker, cause) => damageAgent(state, target, dmg, attacker, cause);
  state.addFeed = (text, team) => { state.feed.push({ text, team, t: state.time }); if (state.feed.length > 8) state.feed.shift(); };
  resetRound(state);
  return state;
}

/** Reset positions, health and phase for a new round. Keep money/weapons. */
export function resetRound(state) {
  state.phase = 'buy';
  state.phaseT = BUY_TIME;
  state.roundWinner = null;
  state.bomb = { planted: false, x: 0, z: 0, site: null, timer: 0, planter: null };
  state.grenades = [];
  state.smokes = [];
  state.noise = [];
  state.agents.forEach((a, i) => {
    const spawn = a.team === 'atk' ? SPAWNS.atk[i % 5] : SPAWNS.def[i % 5];
    a.x = spawn.x; a.z = spawn.z; a.y = 0;
    a.yaw = a.team === 'atk' ? Math.PI / 2 : -Math.PI / 2;
    a.pitch = 0; a.vx = 0; a.vz = 0; a.vy = 0; a.onGround = true;
    a.alive = true; a.hp = 100;
    a.armor = a.kevlar ? 100 : 0;
    a.mag = WEAPONS[a.weapon].mag;
    a.reserve = WEAPONS[a.weapon].reserve;
    a.bloom = 0; a.recoil = 0; a.reloading = 0;
    a.plantProgress = 0; a.defuseProgress = 0; a.blindUntil = 0;
    a.mode = 'advance'; a.path = []; a.pathI = 0; a.target = null;
    a.lastSeen = null; a.lastSeenT = -99; a.holdPos = null;
    a.site = null; a.planT = 0; a.hasPlanted = false;
  });
  // Attackers pick a target site per round (majority vote, carrier decides).
  const site = state.rng() < 0.5 ? 'A' : 'B';
  for (const a of state.agents) if (a.team === 'atk') a.site = site;
  // Carrier: the second attacker (a bot) carries the bomb so the player is
  // never forced into the plant role; bots still plant when the player carries.
  state.carrier = state.agents[1];
}

/** Apply damage with kevlar soak; returns true when the target died. */
export function damageAgent(state, target, dmg, attacker, cause) {
  if (!target.alive) return false;
  let d = dmg;
  if (target.kevlar && target.armor > 0) {
    const soaked = Math.min(target.armor, d * 0.45);
    target.armor -= soaked;
    d -= soaked;
  }
  target.hp -= d;
  target.defuseProgress = 0;
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths++;
    if (attacker && attacker !== target) {
      attacker.kills++;
      attacker.money += 300;
      state.addFeed(`${attacker.name} ▸ ${target.name}${cause === 'head' ? ' (headshot)' : ''}`, attacker.team);
    } else {
      state.addFeed(`${target.name} died`, target.team);
    }
    state.events.push({ type: 'kill', attacker, target, cause, t: state.time });
    // Drop the bomb where the carrier fell.
    if (state.carrier === target && !state.bomb.planted) {
      state.bomb.x = target.x; state.bomb.z = target.z;
    }
    return true;
  }
  return false;
}

export function aliveCount(state, team) {
  return state.agents.filter((a) => a.team === team && a.alive).length;
}

export function teamOf(agent) {
  return agent.team === 'atk' ? 'Jackals' : 'Wardens';
}
