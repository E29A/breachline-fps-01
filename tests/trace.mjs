// tests/trace.mjs — trace one match: positions + events every 10 sim-seconds.
import { createMatch, DT } from '../game/src/state.js';
import { stepMatch } from '../game/src/sim.js';
import { assignHolds, botsBuy } from '../game/src/bots.js';

const EMPTY = { lookX: 0, lookY: 0, moveX: 0, moveZ: 0, firing: false, reload: false, jump: false, crouch: false, walk: false, use: false };
const seed = Number(process.argv[2] ?? 1);
const state = createMatch(seed, false);
state.headless = true;
assignHolds(state);
botsBuy(state);
let steps = 0;
let nextPrint = 0;
let shots = 0, hits = 0;
while (state.phase !== 'over' && steps < 1500 * 60) {
  const evs = stepMatch(state, EMPTY, DT);
  for (const e of evs) if (e.type === 'shot') shots++;
  steps++;
  if (state.time >= nextPrint) {
    nextPrint += 10;
    const pos = state.agents.map((a) => `${a.name}${a.alive ? '' : '✝'}(${a.x.toFixed(0)},${a.z.toFixed(0)}|${a.mode}${a.target ? '→' + a.target.name : ''})`).join(' ');
    console.log(`t=${state.time.toFixed(0)} ph=${state.phase} ${state.phaseT.toFixed(0)}s score ${state.score.atk}-${state.score.def} shots=${shots} | ${pos}`);
  }
  if (state.round > 2) break;
}
console.log('kills:', state.agents.map((a) => `${a.name}:${a.kills}`).join(' '));
