// mapdata.js — the Foundry: one original map, pure data, no three.js.
// A dusk smelting yard, 64 x 44 m. Three lanes (North / Mid / South), a
// catwalk over Mid, two sheds, two bomb sites A (north-east) and B (south-east).
// Attackers (Jackals) spawn west, defenders (Wardens) spawn east.

export const BOUNDS = { x0: -32, x1: 32, z0: -22, z1: 22 };
export const SITES = {
  A: { x: 24, z: -13.5, r: 5.5 },
  B: { x: 24, z: 13.5, r: 5.5 },
};
export const SPAWNS = {
  atk: [
    { x: -29, z: -6 }, { x: -29.5, z: -2 }, { x: -29, z: 2 },
    { x: -29.5, z: 6 }, { x: -28, z: 0 },
  ],
  def: [
    { x: 29, z: -16 }, { x: 29, z: -10 }, { x: 29, z: 10 },
    { x: 29, z: 16 }, { x: 27, z: 0 },
  ],
};

// Obstacles: axis-aligned boxes {x0,z0,x1,z1,h}. h is the top height; agents
// collide in XZ when their feet are below h. Walls h=4.2, crates lower.
// Lane-divider walls (z = -5 and z = +5) leave connectors at x in [-16,-12]
// and [12,16]; the sheds have a single door gap each.
export const OBSTACLES = [
  // Perimeter.
  { x0: -32, z0: -22, x1: 32, z1: -21.4, h: 4.2 },
  { x0: -32, z0: 21.4, x1: 32, z1: 22, h: 4.2 },
  { x0: -32, z0: -22, x1: -31.4, z1: 22, h: 4.2 },
  { x0: 31.4, z0: -22, x1: 32, z1: 22, h: 4.2 },
  // Lane dividers, north (z=-5) and south (z=+5).
  { x0: -32, z0: -5.3, x1: -16, z1: -4.7, h: 3.4 },
  { x0: -12, z0: -5.3, x1: 12, z1: -4.7, h: 3.4 },
  { x0: 16, z0: -5.3, x1: 32, z1: -4.7, h: 3.4 },
  { x0: -32, z0: 4.7, x1: -16, z1: 5.3, h: 3.4 },
  { x0: -12, z0: 4.7, x1: 12, z1: 5.3, h: 3.4 },
  { x0: 16, z0: 4.7, x1: 32, z1: 5.3, h: 3.4 },
  // Shed 1 (north-mid): walls with a door gap on its south face.
  { x0: -7, z0: -15, x1: -6.4, z1: -8, h: 3.6 },
  { x0: 2, z0: -15, x1: 2.6, z1: -8, h: 3.6 },
  { x0: -7, z0: -15, x1: 2.6, z1: -14.4, h: 3.6 },
  { x0: -7, z0: -8.6, x1: -3.4, z1: -8, h: 3.6 },
  { x0: -0.6, z0: -8.6, x1: 2.6, z1: -8, h: 3.6 },
  // Shed 2 (south-mid): door gap on its north face.
  { x0: -3, z0: 8, x1: -2.4, z1: 15, h: 3.6 },
  { x0: 6, z0: 8, x1: 6.6, z1: 15, h: 3.6 },
  { x0: -3, z0: 14.4, x1: 6.6, z1: 15, h: 3.6 },
  { x0: -3, z0: 8, x1: 0.4, z1: 8.6, h: 3.6 },
  { x0: 3.2, z0: 8, x1: 6.6, z1: 8.6, h: 3.6 },
  // Smelter blocks flanking Mid (cover + sightline breaks), split with a
  // 1.6 m walkable gap on the lane's centre line.
  { x0: -20, z0: -3.4, x1: -18.5, z1: -0.8, h: 2.6 },
  { x0: -20, z0: 0.8, x1: -18.5, z1: 3.4, h: 2.6 },
  { x0: 17, z0: -3.4, x1: 18.5, z1: -0.8, h: 2.6 },
  { x0: 17, z0: 0.8, x1: 18.5, z1: 3.4, h: 2.6 },
  // Crates.
  { x0: -24, z0: -18, x1: -21.5, z1: -15.5, h: 1.3 },
  { x0: -24, z0: 15.5, x1: -21.5, z1: 18, h: 1.3 },
  { x0: -13, z0: -19.5, x1: -10.5, z1: -17, h: 2.2 },
  { x0: 8, z0: -19.5, x1: 10.5, z1: -17, h: 1.3 },
  { x0: 12, z0: 16.5, x1: 14.5, z1: 19, h: 2.2 },
  { x0: -12, z0: 16.5, x1: -9.5, z1: 19, h: 1.3 },
  { x0: 20, z0: -3.5, x1: 22.5, z1: -1, h: 1.2 },
  { x0: 20, z0: 1, x1: 22.5, z1: 3.5, h: 1.2 },
  { x0: -25, z0: 3.5, x1: -22.5, z1: 6, h: 1.2 },
  { x0: 16, z0: -19.5, x1: 18.5, z1: -17, h: 1.2 },
  { x0: 16.5, z0: 16.5, x1: 19, z1: 19, h: 1.2 },
  // Site cover.
  { x0: 26, z0: -19, x1: 28.5, z1: -16.5, h: 1.3 },
  { x0: 26, z0: 16.5, x1: 28.5, z1: 19, h: 1.3 },
  { x0: 19, z0: -19.5, x1: 21.5, z1: -17, h: 2.2 },
  { x0: 19, z0: 17, x1: 21.5, z1: 19.5, h: 2.2 },
];

// Walkable floor slabs above ground: the catwalk (y=4) over Mid and its ramps.
export const FLOORS = [
  { x0: -10, z0: -2, x1: 10, z1: 2, y: 4 }, // catwalk deck
];
export const RAMPS = [
  { x0: -14, z0: -2, x1: -10, z1: 2, y0: 0, y1: 4 }, // west ramp up
  { x0: 10, z0: -2, x1: 14, z1: 2, y0: 4, y1: 0 }, // east ramp down
];

/** Ground height at (x,z): catwalk deck, ramps, else 0. */
export function groundHeight(x, z) {
  for (const f of FLOORS) if (x >= f.x0 && x <= f.x1 && z >= f.z0 && z <= f.z1) return f.y;
  for (const r of RAMPS) {
    if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) {
      const t = (x - r.x0) / (r.x1 - r.x0);
      return r.y0 + (r.y1 - r.y0) * t;
    }
  }
  return 0;
}

// Waypoints: ~44 nodes over lanes, connectors, sheds, sites, catwalk, ramps.
export const WAYPOINTS = [
  // Attacker spawn + west mid.
  { x: -29, z: 0 }, { x: -26, z: -2 }, { x: -26, z: 2 }, { x: -22, z: 0 },
  // North lane west -> east (detours around shed 1, which blocks z=-12).
  { x: -28, z: -12 }, { x: -22, z: -12 }, { x: -16, z: -12 }, { x: -10, z: -12 },
  { x: -8, z: -17 }, { x: 0, z: -17.5 }, { x: 6, z: -17 }, { x: 8, z: -12 }, { x: 14, z: -12 },
  { x: 19, z: -13.5 }, { x: 24, z: -13.5 }, { x: 28, z: -13.5 },
  // South lane west -> east (detours around shed 2).
  { x: -28, z: 12 }, { x: -22, z: 12 }, { x: -16, z: 12 }, { x: -10, z: 12 },
  { x: -8, z: 17 }, { x: 0, z: 17.5 }, { x: 6, z: 17 }, { x: 8, z: 12 }, { x: 14, z: 12 },
  { x: 19, z: 13.5 }, { x: 24, z: 13.5 }, { x: 28, z: 13.5 },
  // Mid lane + connectors.
  { x: -14, z: 0 }, { x: -8, z: 0 }, { x: 0, z: 0 }, { x: 8, z: 0 },
  { x: 14, z: 0 }, { x: 22, z: 0 }, { x: 26, z: 0 },
  // Connectors north/south.
  { x: -14, z: -8 }, { x: -14, z: 8 }, { x: 14, z: -8 }, { x: 14, z: 8 },
  // Shed doors double as strip nodes along the shed faces (flank routes).
  { x: -8, z: -6.5 }, { x: -2, z: -6.5 }, { x: 4, z: -6.5 },
  { x: -8, z: 6.5 }, { x: 1.8, z: 6.5 }, { x: 4, z: 6.5 },
  // Catwalk (y=4 via groundHeight).
  { x: -12, z: 0 }, { x: -5, z: 0 }, { x: 5, z: 0 }, { x: 12, z: 0 },
  // Defender spawn.
  { x: 27, z: -6 }, { x: 27, z: 6 },
];

export function waypointY(wp) {
  return groundHeight(wp.x, wp.z);
}
