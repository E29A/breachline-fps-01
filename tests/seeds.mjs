// tests/seeds.mjs — find seeds where the bot-driven player survives the
// screenshot fast-forward (32 s) and where a plant happens by 150 s.
import { createMatch, DT } from '../game/src/state.js';
import { stepMatch } from '../game/src/sim.js';
import { assignHolds, botsBuy } from '../game/src/bots.js';

const EMPTY = { lookX: 0, lookY: 0, moveX: 0, moveZ: 0, firing: false, reload: false, jump: false, crouch: false, walk: false, use: false };

for (let seed = 1; seed <= 16; seed++) {
  const state = createMatch(seed, false);
  state.headless = true;
  assignHolds(state);
  botsBuy(state);
  let alive32 = null, plantedAt = null, playerKills = 0;
  for (let i = 0; i < 150 * 60; i++) {
    stepMatch(state, EMPTY, DT);
    if (i === 32 * 60) alive32 = state.player.alive;
    if (plantedAt === null && state.bomb.planted) plantedAt = +state.time.toFixed(0);
    if (i > 32 * 60 && (state.phase === 'over' || state.round > 1)) break;
  }
  playerKills = state.player.kills;
  console.log(`seed ${seed}: alive@32s=${alive32} plantedAt=${plantedAt} playerKills=${playerKills} phase=${state.phase} round=${state.round} score=${state.score.atk}-${state.score.def}`);
}
