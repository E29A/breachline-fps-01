// round.js — the round state machine: buy -> live -> planted -> end -> next.
// Win conditions: elimination, bomb detonation (attackers), defuse or timer
// expiry with the bomb unplanted (defenders). First to 7 rounds wins.

import {
  BOMB_TIME, BUY_TIME, MAX_ROUNDS, ROUND_TIME, WIN_ROUNDS,
  aliveCount, resetRound, teamOf,
} from './state.js';
import { assignHolds, botsBuy } from './bots.js';

const END_TIME = 4.5;

/** End the current round, pay out, and either start the next or end the match. */
export function endRound(state, winner, reason) {
  if (state.phase === 'end' || state.phase === 'over') return;
  state.roundWinner = winner;
  state.score[winner]++;
  state.stats.rounds++;
  const winMoney = 1400, loseMoney = 1000;
  for (const a of state.agents) {
    a.money += a.team === winner ? winMoney : loseMoney;
    a.money = Math.min(a.money, 16000);
  }
  state.roundLog.push({ round: state.round, winner, reason, score: { ...state.score } });
  state.addFeed(
    `${teamOf({ team: winner })} take round ${state.round} — ${reason}`,
    winner,
  );
  state.events.push({ type: 'round-end', winner, reason, t: state.time });
  const matchOver = state.score[winner] >= WIN_ROUNDS || state.round >= MAX_ROUNDS;
  if (matchOver) {
    state.matchWinner = state.score.atk === state.score.def
      ? (state.score.atk >= WIN_ROUNDS ? winner : null)
      : (state.score.atk > state.score.def ? 'atk' : 'def');
    // A 6-6 after 13 rounds is a draw; otherwise the leader wins.
    if (state.round >= MAX_ROUNDS && state.score.atk === state.score.def) state.matchWinner = null;
    state.phase = 'over';
    state.phaseT = 6;
  } else {
    state.phase = 'end';
    state.phaseT = END_TIME;
  }
}

/** Advance the round clock; called once per fixed step. */
export function updateRound(state, dt) {
  if (state.phase === 'over') return;
  if (state.pendingWinner) {
    const w = state.pendingWinner;
    state.pendingWinner = null;
    endRound(state, w, 'bomb defused');
    return;
  }
  state.phaseT -= dt;
  if (state.phase === 'buy') {
    if (state.phaseT <= 0) {
      state.phase = 'live';
      state.phaseT = ROUND_TIME;
      state.events.push({ type: 'round-start', t: state.time });
    }
    return;
  }
  if (state.phase === 'end') {
    if (state.phaseT <= 0) {
      state.round++;
      resetRound(state);
      assignHolds(state);
      botsBuy(state);
    }
    return;
  }
  // live or planted: check elimination first.
  const atkAlive = aliveCount(state, 'atk');
  const defAlive = aliveCount(state, 'def');
  if (atkAlive === 0 && !state.bomb.planted) {
    endRound(state, 'def', 'Jackals eliminated');
    return;
  }
  if (defAlive === 0) {
    if (state.bomb.planted) {
      // Nobody left to defuse: the bomb still has to go off.
      if (state.phaseT <= 0) endRound(state, 'atk', 'bomb detonated');
      return;
    }
    endRound(state, 'atk', 'Wardens eliminated');
    return;
  }
  if (atkAlive === 0 && state.bomb.planted) {
    // Attackers dead after the plant: defenders must still defuse in time.
    if (state.phaseT <= 0) endRound(state, 'atk', 'bomb detonated');
    return;
  }
  if (state.phase === 'live' && state.phaseT <= 0) {
    endRound(state, 'def', 'time expired');
    return;
  }
  if (state.phase === 'planted' && state.phaseT <= 0) {
    state.bomb.timer = 0;
    endRound(state, 'atk', 'bomb detonated');
  }
}
