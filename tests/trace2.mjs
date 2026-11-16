// tests/trace2.mjs — trace one bot's path state in detail.
import { createMatch, DT } from '../game/src/state.js';
import { stepMatch } from '../game/src/sim.js';
import { assignHolds, botsBuy } from '../game/src/bots.js';
import { waypointGraph } from '../game/src/physics.js';

const EMPTY = { lookX: 0, lookY: 0, moveX: 0, moveZ: 0, firing: false, reload: false, jump: false, crouch: false, walk: false, use: false };
const seed = Number(process.argv[2] ?? 1);
const watchName = process.argv[3] ?? 'Dune';
const state = createMatch(seed, false);
state.headless = true;
assignHolds(state);
botsBuy(state);
const bot = state.agents.find((a) => a.name === watchName);
const nodes = waypointGraph().nodes;
let steps = 0;
let nextPrint = 0;
while (state.phase !== 'over' && steps < 1500 * 60) {
  stepMatch(state, EMPTY, DT);
  steps++;
  if (state.time >= nextPrint && state.phase === 'live') {
    nextPrint += 2;
    const pathStr = bot.path.map((i) => `${i}(${nodes[i].x},${nodes[i].z})`).join('>');
    console.log(`t=${state.time.toFixed(0)} ${bot.name} pos=(${bot.x.toFixed(1)},${bot.z.toFixed(1)}) mode=${bot.mode} pathI=${bot.pathI}/${bot.path.length} mag=${bot.mag} reloading=${bot.reloading.toFixed(2)} reserve=${bot.reserve} target=${bot.target?.name ?? '-'} path=${pathStr}`);
  }
  if (state.round > 1) break;
}
