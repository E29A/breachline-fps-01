// render.js — syncs sim state to the three.js scene every frame.
// Pooled effects (tracers, flashes, smoke): no allocations in hot loops.
// Camera convention: forward = (sin yaw * cos pitch, sin pitch, cos yaw *
// cos pitch), so rotation.y = -yaw and rotation.x = pitch (order YXZ).

import * as THREE from 'three';
import { PALETTE, buildWorld } from './world.js';
import { EYE_HEIGHT, CROUCH_EYE } from './physics.js';
import { WEAPONS } from './weapons.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,220,120,1)');
  g.addColorStop(0.4, 'rgba(255,150,50,0.7)');
  g.addColorStop(1, 'rgba(255,120,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** One agent's mesh: capsule body, head, visor, gun; team-coloured. */
function makeAgentMesh(team) {
  const g = new THREE.Group();
  const color = team === 'atk' ? PALETTE.jackal : PALETTE.warden;
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2e3138, roughness: 0.9 });
  const accent = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.55, 4, 10), cloth);
  body.position.y = 1.02;
  g.add(body);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.34), accent);
  vest.position.set(0, 1.08, 0.06);
  g.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skin);
  head.position.y = 1.62;
  g.add(head);
  const helm = new THREE.Mesh(new THREE.SphereGeometry(0.23, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), cloth);
  helm.position.y = 1.64;
  g.add(helm);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.05),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.7 }));
  visor.position.set(0, 1.62, 0.19);
  g.add(visor);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.22), cloth);
  legL.position.set(-0.14, 0.38, 0);
  g.add(legL);
  const legR = legL.clone();
  legR.position.x = 0.14;
  g.add(legR);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.14, 0.85),
    new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.4, metalness: 0.6 }));
  gun.position.set(0.22, 1.15, 0.35);
  g.add(gun);
  g.userData = { body, head, visor, legL, legR, gun };
  return g;
}

/** A simple first-person gun viewmodel attached to the camera. */
function makeViewmodel() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e22, roughness: 0.35, metalness: 0.65 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xd98a2b, roughness: 0.5, metalness: 0.4 });
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.62), dark);
  g.add(receiver);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.42);
  g.add(barrel);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.22, 0.1), dark);
  mag.position.set(0, -0.15, -0.05);
  g.add(mag);
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.06, 0.03), accent);
  sight.position.set(0, 0.09, -0.1);
  g.add(sight);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.22), dark);
  stock.position.set(0, -0.01, 0.38);
  g.add(stock);
  g.position.set(0.26, -0.24, -0.55);
  return g;
}

export class Renderer {
  constructor(container) {
    const { scene, bombGroup, bombLampMat, bombLight, siteRings } = buildWorld();
    this.scene = scene;
    this.bombGroup = bombGroup;
    this.bombLampMat = bombLampMat;
    this.bombLight = bombLight;
    this.siteRings = siteRings;
    this.camera = new THREE.PerspectiveCamera(74, 1, 0.08, 220);
    this.camera.rotation.order = 'YXZ';
    this.camera.add(makeViewmodel());
    this.viewmodel = this.camera.children[0];
    // A small warm light on the camera so the viewmodel and near ground read.
    const camLight = new THREE.PointLight(0xffc98a, 2.5, 6, 1.5);
    camLight.position.set(0.2, 0.2, 0.2);
    this.camera.add(camLight);
    scene.add(this.camera);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    container.appendChild(this.renderer.domElement);

    // Agent meshes (10, pooled by id).
    this.agentMeshes = new Map();
    // Tracers: stretched boxes, pooled.
    this.tracers = [];
    const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.9 });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1), tracerMat);
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    // Muzzle flashes: additive sprites, pooled.
    this.flashes = [];
    const fTex = flashTexture();
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.visible = false;
      s.scale.set(0.7, 0.7, 1);
      scene.add(s);
      this.flashes.push({ sprite: s, life: 0 });
    }
    // Smoke puffs: translucent spheres, pooled.
    this.smokes = [];
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false });
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), smokeMat.clone());
      m.visible = false;
      scene.add(m);
      this.smokes.push({ mesh: m, life: 0 });
    }
    this.time = 0;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /** Place the camera at an agent's eyes (or a spectate target). */
  setCamera(agent) {
    const eye = agent.crouch ? CROUCH_EYE : EYE_HEIGHT;
    this.camera.position.set(agent.x, agent.y + eye, agent.z);
    this.camera.rotation.y = -agent.yaw;
    this.camera.rotation.x = agent.pitch;
    // Viewmodel kick from recoil.
    this.viewmodel.position.z = -0.55 + agent.recoil * 1.2;
    this.viewmodel.position.y = -0.24 + agent.recoil * 0.35;
    this.viewmodel.visible = agent.alive;
  }

  /** One frame: sync agents, bomb, effects; consume the tick's events. */
  render(state, events, dt) {
    this.time += dt;
    for (const a of state.agents) {
      let mesh = this.agentMeshes.get(a.id);
      if (!mesh) {
        mesh = makeAgentMesh(a.team);
        this.agentMeshes.set(a.id, mesh);
        this.scene.add(mesh);
      }
      mesh.visible = true;
      mesh.position.set(a.x, a.y, a.z);
      // The model faces +Z; sim forward is (sin yaw, cos yaw), so rotation.y = yaw.
      if (!a.alive) {
        mesh.rotation.set(-Math.PI / 2, 0, 0);
        mesh.position.y = a.y + 0.25;
      } else {
        mesh.rotation.set(0, a.yaw, 0);
        // Walk bob.
        const bob = a.moving ? Math.sin(this.time * 11 + a.id) * 0.03 : 0;
        mesh.position.y = a.y + bob;
        mesh.userData.legL.rotation.x = a.moving ? Math.sin(this.time * 11 + a.id) * 0.5 : 0;
        mesh.userData.legR.rotation.x = a.moving ? -Math.sin(this.time * 11 + a.id) * 0.5 : 0;
      }
      // Hide the player themselves (first person) unless spectating.
      if (a === state.player && !state.spectating) mesh.visible = false;
    }
    // Bomb.
    this.bombGroup.visible = state.bomb.planted;
    if (state.bomb.planted) {
      this.bombGroup.position.set(state.bomb.x, state.bomb.y, state.bomb.z);
      const blink = Math.sin(this.time * (state.phaseT < 10 ? 14 : 6)) > 0;
      this.bombLampMat.color.setHex(blink ? 0xff2020 : 0x550000);
      this.bombLight.intensity = blink ? 6 : 0;
    }
    // Site rings pulse when the bomb is live there.
    for (const [key, ring] of Object.entries(this.siteRings)) {
      ring.material.opacity = state.bomb.planted && state.bomb.site === key
        ? 0.5 + 0.4 * Math.sin(this.time * 8)
        : 0.55;
    }
    // Events: shots -> tracer + muzzle flash; grenades -> smoke puff.
    for (const e of events) {
      if (e.type === 'shot') this.spawnTracer(e.from, e.to);
      if (e.type === 'grenade' && e.kind === 'smoke') this.spawnSmoke(e.x, e.y, e.z);
    }
    // Muzzle flashes from live agents that just fired (event-driven above
    // covers the tracer; the flash sits at the shooter's muzzle).
    for (const e of events) {
      if (e.type !== 'shot') continue;
      const a = e.agent;
      if (!a || !a.alive) continue;
      _v1.set(a.x + Math.sin(a.yaw) * 0.5, a.y + (a.crouch ? 1.1 : 1.5), a.z + Math.cos(a.yaw) * 0.5);
      this.spawnFlash(_v1);
    }
    // Smoke clouds follow the sim's live smokes.
    let si = 0;
    for (const s of state.smokes) {
      if (si >= this.smokes.length) break;
      const p = this.smokes[si++];
      p.mesh.visible = true;
      p.mesh.position.set(s.x, s.y, s.z);
      const grow = 1 + 0.15 * Math.sin(this.time * 2 + si);
      p.mesh.scale.set(s.r * grow, s.r * 0.8 * grow, s.r * grow);
      p.mesh.material.opacity = 0.45;
    }
    for (; si < this.smokes.length; si++) this.smokes[si].mesh.visible = false;
    // Decay pooled effects.
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.09) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      f.life -= dt;
      f.sprite.material.opacity = Math.max(0, f.life / 0.07);
      if (f.life <= 0) f.sprite.visible = false;
    }
    this.renderer.render(this.scene, this.camera);
  }

  spawnTracer(from, to) {
    const t = this.tracers.find((x) => !x.mesh.visible) ?? this.tracers[0];
    _v1.set(from.x, from.y, from.z);
    _v2.set(to.x, to.y, to.z);
    const len = _v1.distanceTo(_v2);
    if (len < 0.5) return;
    t.mesh.visible = true;
    t.life = 0.09;
    t.mesh.position.copy(_v1).lerp(_v2, 0.5);
    t.mesh.lookAt(_v2);
    t.mesh.scale.set(1, 1, len);
    t.mesh.material.opacity = 0.9;
  }

  spawnFlash(pos) {
    const f = this.flashes.find((x) => !x.sprite.visible) ?? this.flashes[0];
    f.sprite.visible = true;
    f.life = 0.07;
    f.sprite.position.copy(pos);
    f.sprite.material.opacity = 1;
    const s = 0.55 + Math.random() * 0.3;
    f.sprite.scale.set(s, s, 1);
  }

  spawnSmoke(x, y, z) {
    const s = this.smokes.find((p) => !p.mesh.visible);
    if (!s) return;
    s.mesh.visible = true;
    s.mesh.position.set(x, y, z);
    s.mesh.scale.set(4, 3, 4);
  }
}
