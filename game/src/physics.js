// physics.js — AABB + raycast + waypoint graph, three-free.
// Agents are circles (r=0.42) in XZ with a foot height y; shots are rays
// tested against obstacle boxes and agent hit spheres (head / chest / legs).

import { BOUNDS, OBSTACLES, WAYPOINTS, groundHeight, waypointY } from './mapdata.js';

export const AGENT_RADIUS = 0.42;
export const EYE_HEIGHT = 1.62;
export const CROUCH_EYE = 1.15;

/** Push a circle out of every obstacle it overlaps (feet below the top). */
export function collideCircle(p, r, y) {
  for (const o of OBSTACLES) {
    if (y >= o.h) continue;
    const cx = Math.max(o.x0, Math.min(p.x, o.x1));
    const cz = Math.max(o.z0, Math.min(p.z, o.z1));
    const dx = p.x - cx;
    const dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      p.x = cx + (dx / d) * r;
      p.z = cz + (dz / d) * r;
    } else {
      // Centre inside the box: shove out along the smallest penetration axis.
      const pl = p.x - o.x0, pr = o.x1 - p.x, pt = p.z - o.z0, pb = o.z1 - p.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) p.x = o.x0 - r;
      else if (m === pr) p.x = o.x1 + r;
      else if (m === pt) p.z = o.z0 - r;
      else p.z = o.z1 + r;
    }
  }
  p.x = Math.max(BOUNDS.x0 + r, Math.min(BOUNDS.x1 - r, p.x));
  p.z = Math.max(BOUNDS.z0 + r, Math.min(BOUNDS.z1 - r, p.z));
}

/** Ray vs one AABB (box top at h, base y=0). Returns t or Infinity. */
export function rayBox(ox, oy, oz, dx, dy, dz, o) {
  let tmin = 0;
  let tmax = Infinity;
  const axes = [
    [ox, dx, o.x0, o.x1],
    [oy, dy, 0, o.h],
    [oz, dz, o.z0, o.z1],
  ];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return Infinity;
    } else {
      let t1 = (lo - p) / d;
      let t2 = (hi - p) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

/** Ray vs sphere. Returns t or Infinity. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}

/** Distance from the ray's first obstacle hit; Infinity when clear. */
export function rayWorld(ox, oy, oz, dx, dy, dz, maxDist = 200) {
  let best = maxDist;
  for (const o of OBSTACLES) {
    const t = rayBox(ox, oy, oz, dx, dy, dz, o);
    if (t < best) best = t;
  }
  return best;
}

/** True when the segment a->b is not blocked by any obstacle. */
export function hasLOS(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  return rayWorld(ax, ay, az, dx / len, dy / len, dz / len, len) >= len - 1e-6;
}

/** True when segment a->b passes through any smoke cloud sphere. */
export function smokeBlocks(ax, ay, az, bx, by, bz, smokes) {
  for (const s of smokes) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len2 = dx * dx + dy * dy + dz * dz;
    if (len2 < 1e-9) continue;
    let t = ((s.x - ax) * dx + (s.y - ay) * dy + (s.z - az) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + dx * t, py = ay + dy * t, pz = az + dz * t;
    const d2 = (px - s.x) ** 2 + (py - s.y) ** 2 + (pz - s.z) ** 2;
    if (d2 < s.r * s.r) return true;
  }
  return false;
}

// ---------------------------------------------------------------- waypoint graph

let graph = null;

/** Build the graph once: nodes are waypoints, edges link near nodes with a
 *  clear straight walk (no obstacle between them at agent height). */
export function waypointGraph() {
  if (graph) return graph;
  const nodes = WAYPOINTS.map((w) => ({ x: w.x, z: w.z, y: waypointY(w) }));
  const edges = nodes.map(() => []);
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d > 10.5) continue;
      // A catwalk node links to ramp nodes (2 m steps); the deck never links
      // straight to the ground (4 m drop).
      if (Math.abs(a.y - b.y) > 2.5) continue;
      const ay = a.y + 0.9, by = b.y + 0.9;
      if (!hasLOS(a.x, ay, a.z, b.x, by, b.z)) continue;
      // Also keep the straight XZ path clear of low boxes at walking height.
      let clear = true;
      for (const o of OBSTACLES) {
        if (o.h < 0.5) continue;
        const midY = Math.min(ay, by) - 0.4;
        if (midY >= o.h) continue;
        if (segmentHitsBox(a.x, a.z, b.x, b.z, o, AGENT_RADIUS)) { clear = false; break; }
      }
      if (!clear) continue;
      edges[i].push({ to: j, cost: d });
      edges[j].push({ to: i, cost: d });
    }
  }
  graph = { nodes, edges };
  return graph;
}

function segmentHitsBox(x0, z0, x1, z1, o, r) {
  // 2D segment vs inflated AABB (slab test).
  const dx = x1 - x0, dz = z1 - z0;
  let tmin = 0, tmax = 1;
  const axes = [[x0, dx, o.x0 - r, o.x1 + r], [z0, dz, o.z0 - r, o.z1 + r]];
  for (const [p, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
    else {
      let t1 = (lo - p) / d, t2 = (hi - p) / d;
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return false;
    }
  }
  return true;
}

/** Nearest waypoint index to (x,z). */
export function nearestWaypoint(x, z) {
  const { nodes } = waypointGraph();
  let best = 0, bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i].x - x) ** 2 + (nodes[i].z - z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Nearest waypoint an agent can actually walk to from (x,z): the segment
 *  must be clear and the height step small (a node across a wall, or on the
 *  catwalk deck from the ground, is never "nearest" for pathing). */
export function nearestReachableWaypoint(x, z, y = 0) {
  const { nodes } = waypointGraph();
  let best = -1, bd = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (Math.abs(n.y - y) > 2.5) continue;
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d >= bd) continue;
    if (!hasLOS(x, y + 0.9, z, n.x, n.y + 0.9, n.z)) continue;
    bd = d; best = i;
  }
  return best === -1 ? nearestWaypoint(x, z) : best;
}

/** A* path as a list of waypoint indices from `from` to `to`. */
export function findPath(from, to) {
  const { nodes, edges } = waypointGraph();
  const n = nodes.length;
  const open = [from];
  const g = new Array(n).fill(Infinity);
  const came = new Array(n).fill(-1);
  const closed = new Array(n).fill(false);
  g[from] = 0;
  const h = (i) => Math.hypot(nodes[i].x - nodes[to].x, nodes[i].z - nodes[to].z);
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (g[open[k]] + h(open[k]) < g[open[bi]] + h(open[bi])) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur === to) {
      const path = [cur];
      let c = cur;
      while (came[c] !== -1) { c = came[c]; path.unshift(c); }
      return path;
    }
    closed[cur] = true;
    for (const e of edges[cur]) {
      if (closed[e.to]) continue;
      const ng = g[cur] + e.cost;
      if (ng < g[e.to]) {
        g[e.to] = ng;
        came[e.to] = cur;
        if (!open.includes(e.to)) open.push(e.to);
      }
    }
  }
  return [to];
}
