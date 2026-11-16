// hud.js — DOM HUD: health, ammo, money, timer, score, feed, buy menu,
// plant/defuse bars, banners, damage vignette. Reads sim state each frame.

import { BUY_MENU, GRENADES, WEAPONS } from './weapons.js';
import { BOMB_TIME, BUY_TIME, ROUND_TIME } from './state.js';

export class Hud {
  constructor(root) {
    this.root = root;
    this.el = {};
    for (const id of ['hp', 'hp-bar', 'armor', 'ammo-mag', 'ammo-reserve', 'weapon-name',
      'money', 'timer', 'phase', 'score-atk', 'score-def', 'round-num', 'feed',
      'banner', 'banner-sub', 'buy', 'buy-list', 'channel', 'channel-label', 'channel-bar',
      'bomb-timer', 'vignette', 'blind', 'grenades', 'overlay', 'overlay-title',
      'overlay-copy', 'play', 'match-end', 'end-title', 'end-sub', 'crosshair']) {
      this.el[id] = root.querySelector('#' + id);
    }
    this.lastFeed = 0;
    this.buyOpen = false;
    this.bannerUntil = 0;
  }

  showBanner(text, sub, ms = 2600) {
    this.el.banner.textContent = text;
    this.el['banner-sub'].textContent = sub ?? '';
    this.el.banner.parentElement.classList.remove('hidden');
    this.bannerUntil = performance.now() + ms;
  }

  setOverlay(title, copy, button) {
    this.el['overlay-title'].textContent = title;
    this.el['overlay-copy'].textContent = copy;
    this.el.play.textContent = button;
    this.el.overlay.hidden = false;
  }

  hideOverlay() { this.el.overlay.hidden = true; }

  showMatchEnd(winner, score) {
    this.el['end-title'].textContent = winner === 'atk'
      ? 'JACKALS WIN THE MATCH' : winner === 'def' ? 'WARDENS WIN THE MATCH' : 'DRAW';
    this.el['end-sub'].textContent = `Final score — Jackals ${score.atk} : ${score.def} Wardens. Refresh to play again.`;
    this.el['match-end'].classList.remove('hidden');
  }

  /** Build the buy menu once; onBuy(item) is called for a clicked row. */
  buildBuy(onBuy) {
    const list = this.el['buy-list'];
    list.innerHTML = '';
    for (const item of BUY_MENU) {
      const row = document.createElement('button');
      row.className = 'buy-row';
      row.type = 'button';
      let name, price;
      if (item.kind === 'weapon') { name = WEAPONS[item.id].name; price = WEAPONS[item.id].price; }
      else if (item.kind === 'kevlar') { name = 'Kevlar Vest (45% soak)'; price = 650; }
      else { name = GRENADES[item.id].name + ' Grenade'; price = GRENADES[item.id].price; }
      row.innerHTML = `<span>${name}</span><b>$${price}</b>`;
      row.addEventListener('click', () => onBuy(item));
      list.appendChild(row);
    }
  }

  toggleBuy(open, money) {
    this.buyOpen = open;
    this.el.buy.classList.toggle('hidden', !open);
    if (open) this.el.money.textContent = '$' + money;
  }

  update(state, now, view = state.player) {
    const p = view;
    const w = WEAPONS[p.weapon];
    this.el.hp.textContent = Math.max(0, Math.ceil(p.hp));
    this.el['hp-bar'].style.width = Math.max(0, p.hp) + '%';
    this.el['hp-bar'].style.background = p.hp > 50 ? '#e9e6df' : p.hp > 25 ? '#f0a830' : '#d23c2e';
    this.el.armor.textContent = p.kevlar ? `KEVLAR ${Math.ceil(p.armor)}` : '';
    this.el['ammo-mag'].textContent = p.reloading > 0 ? '--' : p.mag;
    this.el['ammo-reserve'].textContent = '/ ' + p.reserve;
    this.el['weapon-name'].textContent = w.name + (p.reloading > 0 ? ' — reloading' : '');
    this.el.money.textContent = '$' + p.money;
    this.el['score-atk'].textContent = state.score.atk;
    this.el['score-def'].textContent = state.score.def;
    this.el['round-num'].textContent = 'ROUND ' + state.round + ' / 13';
    // Timer: buy / live / planted / end.
    let t = state.phaseT;
    let label = 'BUY PHASE';
    if (state.phase === 'live') { label = state.bomb.planted ? 'BOMB PLANTED' : 'ROUND'; t = state.phaseT; }
    if (state.phase === 'planted') label = 'BOMB';
    if (state.phase === 'end') label = 'ROUND OVER';
    if (state.phase === 'over') label = 'MATCH OVER';
    this.el.phase.textContent = label;
    this.el.timer.textContent = Math.max(0, Math.ceil(t));
    this.el.timer.style.color = (state.phase === 'planted' || t < 10) ? '#ff5a3c' : '#e9e6df';
    // Bomb timer bar.
    const planted = state.bomb.planted;
    this.el['bomb-timer'].classList.toggle('hidden', !planted);
    if (planted) {
      this.el['bomb-timer'].querySelector('b').textContent = state.phaseT.toFixed(1) + 's';
      this.el['bomb-timer'].querySelector('i').style.width = (100 * state.phaseT / BOMB_TIME) + '%';
    }
    // Plant / defuse channel.
    const prog = Math.max(p.plantProgress / 3.2, p.defuseProgress / 5);
    const chan = prog > 0.01;
    this.el.channel.classList.toggle('hidden', !chan);
    if (chan) {
      this.el['channel-label'].textContent = p.plantProgress > 0.01 ? 'PLANTING BOMB…' : 'DEFUSING…';
      this.el['channel-bar'].style.width = (100 * prog) + '%';
    }
    // Grenade counts.
    this.el.grenades.textContent = ['frag', 'smoke', 'flash']
      .map((k) => `${k.toUpperCase()} ${p.grenades[k] ?? 0}`).join('  ·  ');
    // Crosshair spread grows with bloom + movement.
    const spread = 4 + p.bloom * 260 + (p.moving ? 6 : 0) + (p.airborne ? 10 : 0);
    this.el.crosshair.style.setProperty('--gap', spread.toFixed(1) + 'px');
    // Kill feed.
    if (state.feed.length !== this.lastFeed) {
      this.lastFeed = state.feed.length;
      this.el.feed.innerHTML = state.feed.slice(-5).map((f) =>
        `<div class="${f.team}">${f.text}</div>`).join('');
    }
    // Banner expiry.
    if (now > this.bannerUntil) this.el.banner.parentElement.classList.add('hidden');
    // Damage vignette fades via CSS transition; blind overlay by flash.
    const blind = Math.max(0, p.blindUntil - state.time);
    this.el.blind.style.opacity = blind > 0 ? Math.min(1, blind).toFixed(2) : 0;
    // Match end.
    if (state.phase === 'over' && state.matchWinner !== undefined) {
      this.showMatchEnd(state.matchWinner, state.score);
    }
  }

  flashHitmarker(kill) {
    const hm = this.root.querySelector('#hitmarker');
    hm.classList.add('on');
    hm.classList.toggle('kill', !!kill);
    setTimeout(() => hm.classList.remove('on', 'kill'), 110);
  }

  flashDamage() {
    const v = this.el.vignette;
    v.style.opacity = '0.85';
    setTimeout(() => { v.style.opacity = '0'; }, 130);
  }
}
