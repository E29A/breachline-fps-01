// tests/simtest.mjs — headless bot-vs-bot matches in Node (sim is three-free).
import { createMatch, DT } from '../game/src/state.js';
import { stepMatch } from '../game/src/sim.js';
import { assignHolds, botsBuy } from '../game/src/bots.js';
import { waypointGraph, findPath, nearestWaypoint } from '../game/src/physics.js';

const EMPTY = { lookX: 0, lookY: 0, moveX: 0, moveZ: 0, firing: false, reload: false, jump: false, crouch: false, walk: false, use: false };

export function runMatch(seed) {
  const state = createMatch(seed, false);
  state.headless = true;
  assignHolds(state);
  botsBuy(state);
  const maxSteps = 1500 * 60;
  let steps = 0;
  let lastRound = 0;
  let shots = 0;
  const perRound = [];
  while (state.phase !== 'over' && steps < maxSteps) {
    const evs = stepMatch(state, EMPTY, DT);
    for (const e of evs) if (e.type === 'shot') shots++;
    steps++;
    if (state.round !== lastRound) {
      perRound.push({ round: lastRound, plants: state.stats.plants, defuses: state.stats.defuses });
      lastRound = state.round;
    }
  }
  return {
    seed,
    finished: state.phase === 'over',
    winner: state.matchWinner,
    score: { ...state.score },
    rounds: state.stats.rounds,
    plants: state.stats.plants,
    defuses: state.stats.defuses,
    hitPct: state.stats.shots ? +(100 * state.stats.hits / state.stats.shots).toFixed(1) : 0,
    simSeconds: +(steps / 60).toFixed(1),
    kills: state.agents.reduce((n, a) => n + a.kills, 0),
    shots,
    roundLog: state.roundLog.map((r) => `R${r.round} ${r.winner} (${r.reason}) ${r.score.atk}-${r.score.def}`),
  };
}

function graphCheck() {
  const g = waypointGraph();
  // Every node reachable from node 0?
  const seen = new Set([0]);
  const q = [0];
  while (q.length) {
    const c = q.pop();
    for (const e of g.edges[c]) if (!seen.has(e.to)) { seen.add(e.to); q.push(e.to); }
  }
  const isolated = g.nodes.map((_, i) => i).filter((i) => g.edges[i].length === 0);
  return { nodes: g.nodes.length, edges: g.edges.reduce((n, e) => n + e.length, 0) / 2, reachable: seen.size, isolated };
}

const seeds = process.argv.slice(2).map(Number).filter(Boolean);
const list = seeds.length ? seeds : [1, 2, 3, 4, 5];
console.log('graph:', JSON.stringify(graphCheck()));
// Sanity: a path across the map exists (spawn -> site A, spawn -> site B).
console.log('path atk spawn -> A:', findPath(nearestWaypoint(-29, 0), nearestWaypoint(24, -13.5)).length, 'hops');
console.log('path atk spawn -> B:', findPath(nearestWaypoint(-29, 0), nearestWaypoint(24, 13.5)).length, 'hops');
console.log('path def spawn -> mid:', findPath(nearestWaypoint(27, 0), nearestWaypoint(0, 0)).length, 'hops');
for (const s of list) {
  const r = runMatch(s);
  console.log(`seed ${s}: finished=${r.finished} winner=${r.winner} score=${r.score.atk}-${r.score.def} rounds=${r.rounds} plants=${r.plants} defuses=${r.defuses} kills=${r.kills} shots=${r.shots} hit%=${r.hitPct} simTime=${r.simSeconds}s`);
  console.log('  ', r.roundLog.join(' | '));
}
