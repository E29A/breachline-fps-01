// world.js — builds the Foundry as three.js geometry from mapdata.
// One dusk palette: blue-grey steel, rust, amber lamps, teal accents. All
// textures are canvas-generated; nothing loads over the network.

import * as THREE from 'three';
import { BOUNDS, FLOORS, OBSTACLES, RAMPS, SITES } from './mapdata.js';

export const PALETTE = {
  sky: 0x2a3348, fog: 0x2e3648, ground: 0x3a3f45,
  wall: 0x4a4f57, wallDark: 0x33373d, rust: 0x8a4a28, amber: 0xf0a830,
  teal: 0x2e8f86, jackal: 0xd98a2b, warden: 0x2e8f86, crate: 0x5d5648,
  shed: 0x6b4a3a, smelter: 0x55504a, catwalk: 0x3d434b,
};

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function noiseSpeckle(ctx, w, h, n, color, alpha) {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = Math.random() * alpha;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  ctx.globalAlpha = 1;
}

function concreteTex() {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = '#3a3f45'; ctx.fillRect(0, 0, w, h);
    noiseSpeckle(ctx, w, h, 2600, '#2c3036', 0.5);
    noiseSpeckle(ctx, w, h, 900, '#8a4a28', 0.25);
    ctx.strokeStyle = 'rgba(20,22,26,0.6)'; ctx.lineWidth = 2;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath(); ctx.moveTo(i * 128, 0); ctx.lineTo(i * 128, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(w, i * 128); ctx.stroke();
    }
    // Oil stains.
    for (let i = 0; i < 7; i++) {
      const g = ctx.createRadialGradient(Math.random() * w, Math.random() * h, 4, Math.random() * w, Math.random() * h, 40 + Math.random() * 60);
      g.addColorStop(0, 'rgba(15,15,18,0.5)'); g.addColorStop(1, 'rgba(15,15,18,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
  });
}

function metalTex(base, rustAmt) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    noiseSpeckle(ctx, w, h, 1400, '#1c1f24', 0.5);
    noiseSpeckle(ctx, w, h, Math.floor(900 * rustAmt), '#8a4a28', 0.55);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, w, 8); ctx.fillRect(0, h - 8, w, 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
    for (let y = 32; y < h; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  });
}

function hazardTex() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.fillStyle = '#c8932a'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1c1f24';
    for (let i = -2; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(i * 32, h); ctx.lineTo(i * 32 + 32, 0);
      ctx.lineTo(i * 32 + 48, 0); ctx.lineTo(i * 32 + 16, h);
      ctx.fill();
    }
  });
}

function letterTex(letter, color) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = color; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(128, 128, 96, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = 'bold 150px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, 128, 134);
  });
}

function skyTex() {
  return canvasTexture(16, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1a2233');
    g.addColorStop(0.55, '#2a3348');
    g.addColorStop(0.78, '#7a5232');
    g.addColorStop(0.88, '#c77b2e');
    g.addColorStop(1, '#3a3f45');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
}

function box(w, h, d, mat, x, y, z, ry = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

/** Build the whole static scene. Returns { scene, bombLamp, siteRings }. */
export function buildWorld() {
  const scene = new THREE.Scene();
  scene.background = skyTex();
  scene.fog = new THREE.Fog(0x39415a, 30, 95);

  const hemi = new THREE.HemisphereLight(0x8a97b5, 0x3a2e22, 1.15);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xff9a3c, 2.0);
  sun.position.set(-40, 18, -12);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x5a6a8a, 0.7);
  fill.position.set(30, 25, 20);
  scene.add(fill);

  const concrete = new THREE.MeshStandardMaterial({ map: concreteTex(), roughness: 0.95 });
  concrete.map.wrapS = concrete.map.wrapT = THREE.RepeatWrapping;
  concrete.map.repeat.set(8, 6);
  const wallMat = new THREE.MeshStandardMaterial({ map: metalTex('#4a4f57', 0.7), roughness: 0.85 });
  const wallDark = new THREE.MeshStandardMaterial({ map: metalTex('#33373d', 0.9), roughness: 0.9 });
  const rustMat = new THREE.MeshStandardMaterial({ map: metalTex('#6b4a3a', 1), roughness: 0.9 });
  const crateMat = new THREE.MeshStandardMaterial({ map: metalTex('#5d5648', 0.8), roughness: 0.9 });
  const smeltMat = new THREE.MeshStandardMaterial({ map: metalTex('#55504a', 1), roughness: 0.85 });
  const catMat = new THREE.MeshStandardMaterial({ map: metalTex('#3d434b', 0.5), roughness: 0.8, metalness: 0.4 });
  const hazardMat = new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.9 });
  hazardMat.map.wrapS = THREE.RepeatWrapping;

  // Ground.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(64, 44), concrete);
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  // Obstacles from mapdata: walls tall, crates low, sheds rusty.
  for (const o of OBSTACLES) {
    const w = o.x1 - o.x0, d = o.z1 - o.z0;
    const cx = (o.x0 + o.x1) / 2, cz = (o.z0 + o.z1) / 2;
    let mat = wallMat;
    if (o.h <= 1.35) mat = crateMat;
    else if (o.h <= 2.6) mat = smeltMat;
    else if (o.h <= 3.6 && w < 7 && d < 8) mat = rustMat;
    const m = box(w, o.h, d, mat, cx, o.h / 2, cz);
    scene.add(m);
    if (o.h >= 3.4 && w > 6) {
      // Hazard stripe along the top edge of long walls.
      const stripe = box(w, 0.12, 0.5, hazardMat, cx, o.h + 0.01, cz);
      scene.add(stripe);
    }
  }

  // Catwalk deck + ramps + railings.
  for (const f of FLOORS) {
    const w = f.x1 - f.x0, d = f.z1 - f.z0;
    scene.add(box(w, 0.25, d, catMat, (f.x0 + f.x1) / 2, f.y - 0.12, (f.z0 + f.z1) / 2));
    scene.add(box(w, 0.9, 0.08, catMat, (f.x0 + f.x1) / 2, f.y + 0.45, f.z0 + 0.04));
    scene.add(box(w, 0.9, 0.08, catMat, (f.x0 + f.x1) / 2, f.y + 0.45, f.z1 - 0.04));
  }
  for (const r of RAMPS) {
    const len = Math.hypot(r.x1 - r.x0, r.y1 - r.y0);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, 4), catMat);
    m.position.set((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2, 0);
    m.rotation.z = Math.atan2(r.y1 - r.y0, r.x1 - r.x0);
    scene.add(m);
  }

  // Bomb sites: glowing ground rings + floating letters.
  const siteRings = {};
  for (const [key, s] of Object.entries(SITES)) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(s.r - 0.25, s.r, 48),
      new THREE.MeshBasicMaterial({ color: PALETTE.amber, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(s.x, 0.03, s.z);
    scene.add(ring);
    siteRings[key] = ring;
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(3.4, 3.4),
      new THREE.MeshBasicMaterial({ map: letterTex(key, '#f0a830'), transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    letter.position.set(s.x, 3.4, s.z);
    scene.add(letter);
  }

  // Smokestacks with lit windows.
  const stackMat = new THREE.MeshStandardMaterial({ map: metalTex('#3d3a36', 1), roughness: 0.9 });
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffb347 });
  for (const [sx, sz] of [[-30, -19], [30, 19]]) {
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 2.2, 16, 12), stackMat);
    stack.position.set(sx, 8, sz);
    scene.add(stack);
    for (let i = 0; i < 4; i++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), winMat);
      win.position.set(sx + 1.65, 2 + i * 3.2, sz);
      win.rotation.y = Math.PI / 2;
      scene.add(win);
    }
  }

  // Barrels and pipes as set dressing.
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8, metalness: 0.3 });
  const barrelMat2 = new THREE.MeshStandardMaterial({ color: 0x2e5f5a, roughness: 0.8, metalness: 0.3 });
  const barrelSpots = [[-25, -10, 0], [-25, -9, 1], [25, -6, 0], [25, -5, 1], [-14, 18, 0], [10, -18, 1], [-18, 19, 0]];
  for (const [bx, bz, v] of barrelSpots) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12), v ? barrelMat2 : barrelMat);
    b.position.set(bx, 0.65, bz);
    scene.add(b);
  }
  const pipeMat = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.7, metalness: 0.5 });
  for (const [px, pz, len, ry] of [[-31, 0, 44, Math.PI / 2], [0, -21, 64, 0], [0, 21, 64, 0]]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, len, 8), pipeMat);
    // ry 0: pipe runs along X (rotate Y-axis cylinder about Z); else along Z.
    pipe.rotation.z = ry === 0 ? Math.PI / 2 : 0;
    pipe.rotation.x = ry === 0 ? 0 : Math.PI / 2;
    pipe.position.set(px, 0.35, pz);
    scene.add(pipe);
  }

  // Amber lamps over the sites and mid.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffc46b });
  const lamps = [];
  for (const [lx, lz] of [[24, -13.5], [24, 13.5], [0, 0], [-20, 0], [20, 0]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 5.4, 6), wallDark);
    pole.position.set(lx, 2.7, lz);
    scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lampMat);
    bulb.position.set(lx, 5.5, lz);
    scene.add(bulb);
    const light = new THREE.PointLight(0xffa63c, 22, 20, 1.8);
    light.position.set(lx, 5.2, lz);
    scene.add(light);
    lamps.push(light);
  }

  // The bomb: a small device with a blinking lamp, hidden until planted.
  const bombGroup = new THREE.Group();
  const bombBody = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.35),
    new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.6 }));
  bombBody.position.y = 0.11;
  bombGroup.add(bombBody);
  const bombLampMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
  const bombLamp = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), bombLampMat);
  bombLamp.position.set(0, 0.3, 0);
  bombGroup.add(bombLamp);
  const bombLight = new THREE.PointLight(0xff2020, 0, 9, 1.5);
  bombLight.position.y = 0.6;
  bombGroup.add(bombLight);
  bombGroup.visible = false;
  scene.add(bombGroup);

  return { scene, bombGroup, bombLampMat, bombLight, siteRings, lamps };
}
