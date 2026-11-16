// tests/hittest.mjs — direct check of fireHitscan at fixed ranges.
import { createMatch } from '../game/src/state.js';
import { fireHitscan, currentSpread } from '../game/src/weapons.js';

const state = createMatch(7, false);
state.headless = true;
const shooter = state.agents[0];
const target = state.agents[5];
shooter.weapon = 'raptor';
shooter.mag = 999;
target.team = 'def';

function trial(dist, spread, n = 200) {
  // Place target due east of shooter, both on open ground at mid.
  shooter.x = 0; shooter.z = 0; shooter.y = 0; shooter.yaw = Math.PI / 2; shooter.pitch = 0;
  target.x = dist; target.z = 0; target.y = 0; target.alive = true; target.hp = 10000;
  let hits = 0, head = 0, dmg = 0;
  for (let i = 0; i < n; i++) {
    const dx = Math.sin(shooter.yaw), dy = 0, dz = Math.cos(shooter.yaw);
    const res = fireHitscan(state, shooter, dx, dy, dz, spread, (t, zone, d) => {
      hits++; dmg += d; if (zone === 'head') head++;
    });
    void res;
  }
  return { dist, spread, hits, hitPct: (100 * hits / n).toFixed(1), head, avgDmg: (dmg / Math.max(1, hits)).toFixed(1) };
}

console.log('raptor spread 0.013 (base):', JSON.stringify(trial(10, 0.013)));
console.log('raptor spread 0.013 (base):', JSON.stringify(trial(20, 0.013)));
console.log('raptor spread 0.05:', JSON.stringify(trial(15, 0.05)));
console.log('raptor spread 0.10:', JSON.stringify(trial(15, 0.10)));
// Pitch check: shooter aiming slightly down at chest from eye height.
shooter.x = 0; shooter.z = 0; shooter.y = 0; shooter.yaw = Math.PI / 2;
target.x = 15; target.z = 0; target.y = 0;
const dx = Math.sin(shooter.yaw) * Math.cos(-0.04), dy = Math.sin(-0.04), dz = Math.cos(shooter.yaw) * Math.cos(-0.04);
let hits = 0;
for (let i = 0; i < 200; i++) {
  fireHitscan(state, shooter, dx, dy, dz, 0.013, () => hits++);
}
console.log('pitched -0.04 rad at 15m hits:', hits, '/200');
