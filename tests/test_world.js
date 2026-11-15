'use strict';
// node tests/test_world.js  — headless tests for js/world.js with core + tree stubs
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
globalThis.window = globalThis;

const DT = 1 / 60;
function mkRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(s) { let h = 2166136261 >>> 0; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }

const DEF = { dmg: 10, fireRate: 1.6, projSpeed: 420, projCount: 1, pierce: 0, spread: 0.18, moveSpeed: 150, maxHp: 100, armor: 0, regen: 0, magnet: 70, crit: 0.05, critMul: 2, dashCd: 3, dashDist: 120, area: 1, orbitCount: 0, orbitDmg: 0, orbitRadius: 60, novaDmg: 0, novaCd: 0, thorns: 0, rootSlow: 0, chain: 0, burnDps: 0, trailDmg: 0, splitCount: 0, leech: 0, xpMul: 1, lightMul: 1, choices: 3 };

const OG = globalThis.OG = {};
OG.rng = mkRng; OG.hashSeed = hashSeed;
OG.bus = {
  h: {},
  on(n, f) { (this.h[n] = this.h[n] || []).push(f); },
  off(n, f) { this.h[n] = (this.h[n] || []).filter(x => x !== f); },
  emit(n, d) { const l = this.h[n]; if (l) for (let i = 0; i < l.length; i++) l[i](d); },
  clear() { this.h = {}; }
};
OG.game = { updates: [], addUpdate(f, o) { this.updates.push([f, o]); }, state: 'run' };
OG.input = { move: { x: 0, y: 0 }, dash: false };
OG.state = {
  run: { time: 0, seed: 'x', daily: false, level: 1, xp: 0, xpNext: 10, light: 0, kills: 0, rerolls: 0, over: false, result: null },
  player: { x: 0, y: 0, vx: 0, vy: 0, r: 14, hp: 100, maxHp: 100, invuln: 0, dashCd: 0, dashing: false, still: 0, rooted: false },
  enemies: [], projectiles: [], hazards: [], orbits: [], trails: [], pickups: [],
  stats: Object.assign({}, DEF),
  meta: { settings: { relax: false } }
};
OG.tree = {
  tr: { fire: 0, wind: 0, root: 0, stone: 0 }, xp: 0, levels: 0,
  track(b, n) { assert(Number.isFinite(n), 'track NaN ' + b); this.tr[b] += n; },
  addXp(n) { assert(Number.isFinite(n)); this.xp += n; },
  grantLevel() { this.levels++; }
};

vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'world.js'), 'utf8'), { filename: 'world.js' });
const W = OG.world, ST = OG.state, D = W.debug;
assert(OG.game.updates.length === 1 && OG.game.updates[0][1] === 10, 'registered addUpdate order 10');

function fresh(seed, stats) {
  OG.bus.clear();
  ST.run.over = false; ST.run.seed = seed;
  ST.stats = Object.assign({}, DEF, stats || {});
  ST.meta.settings.relax = false;
  OG.input.move.x = 0; OG.input.move.y = 0; OG.input.dash = false;
  OG.tree.tr = { fire: 0, wind: 0, root: 0, stone: 0 }; OG.tree.xp = 0; OG.tree.levels = 0;
  OG.rand = mkRng(hashSeed(seed));
  D.log = null;
  W.reset();
}
function step(n, bot) { for (let i = 0; i < n; i++) { if (bot) bot(i); W.update(DT); } }
function still(kind, x, y, hp) { const e = D.spawnEnemy(kind, x, y); e.speed = 0; e.hp = e.maxHp = hp || 1e9; e.dmg = 0; return e; }
function finite(o) { for (const k in o) { const v = o[k]; if (typeof v === 'number' && !Number.isFinite(v)) return k; } return null; }
function checkFinite() {
  let k = finite(ST.player); assert(!k, 'player.' + k);
  k = finite(ST.run); assert(!k, 'run.' + k);
  for (const arr of [ST.enemies, ST.projectiles, ST.hazards, ST.pickups, ST.orbits, ST.trails])
    for (const o of arr) { k = finite(o); assert(!k, 'NaN field ' + k); }
}
let passed = 0;
function test(name, fn) { const t0 = Date.now(); fn(); passed++; console.log('ok  ' + name + ' (' + (Date.now() - t0) + ' ms)'); }

// ---------------------------------------------------------------- player
test('movement: full speed in ~0.08 s, stop in ~0.06 s', () => {
  fresh('mv'); OG.input.move.x = 1;
  step(4); assert(ST.player.vx > 0 && ST.player.vx < 150, 'still accelerating at 4 ticks');
  step(1); assert(Math.abs(ST.player.vx - 150) < 1e-9, 'full at 5 ticks');
  OG.input.move.x = 0; step(3); assert(ST.player.vx > 0, 'not stopped at 3 ticks');
  step(1); assert(ST.player.vx === 0, 'stopped at 4 ticks');
  step(40); assert(ST.player.still > 0.5 && true);
});
test('movement: clamps to bounds', () => {
  fresh('bd', { moveSpeed: 400, maxHp: 1e9 }); OG.input.move.x = 1; step(60 * 8);
  assert(ST.player.x <= 2000 - 14 + 1e-6 && ST.player.x > 1900);
});
test('dash: dashDist in 0.15 s, invulnerable, cooldown', () => {
  fresh('ds'); OG.input.move.x = 1; OG.input.dash = true; step(1); OG.input.dash = false;
  const e = D.spawnEnemy('mold', ST.player.x + 30, 0); e.speed = 0; e.dmg = 50;
  let hurt = 0; OG.bus.on('player:hurt', () => hurt++);
  step(7); assert(ST.player.dashing, "still dashing at tick 8"); step(1); assert(!ST.player.dashing, "dash ends after 9 ticks");
  assert(Math.abs(ST.player.x - (120 + 150 * 0)) < 2.5 || ST.player.x > 118, 'dash distance ' + ST.player.x);
  assert(hurt === 0, 'no damage during dash');
  assert(ST.player.dashCd > 2.5, 'cooldown running');
});
test('hit: 0.6 s invulnerability, armor min 1, relax x0.25', () => {
  fresh('hit'); const e = D.spawnEnemy('mold', 0, 0); e.speed = 0; e.dmg = 10;
  let hurt = 0; OG.bus.on('player:hurt', () => hurt++); step(59);
  assert(hurt === 2, 'two hits in ~1 s, got ' + hurt);
  fresh('arm', { armor: 50 }); const e2 = D.spawnEnemy('mold', 0, 0); e2.speed = 0; e2.dmg = 10; let dm = 0;
  OG.bus.on('player:hurt', d => dm = d.dmg); step(2); assert(dm === 1, 'armor min 1');
  fresh('rel'); ST.meta.settings.relax = true; const e3 = D.spawnEnemy('mold', 0, 0); e3.speed = 0; e3.dmg = 100;
  OG.bus.on('player:hurt', d => dm = d.dmg); step(2); assert(Math.abs(dm - 25) < 1e-9, 'relax dmg ' + dm);
});
test('death: player:dead once; revive keeps playing', () => {
  fresh('dead'); let dead = 0; OG.bus.on('player:dead', () => dead++);
  const e = D.spawnEnemy('mold', 0, 0); e.speed = 0; e.dmg = 500; step(5);
  assert(dead === 1); const t = ST.run.time; step(20); assert(dead === 1 && ST.run.time === t, 'frozen after death');
  fresh('revive'); dead = 0; OG.bus.on('player:dead', () => { dead++; ST.player.hp = 100; ST.player.invuln = 2; });
  const e2 = D.spawnEnemy('mold', 0, 0); e2.speed = 0; e2.dmg = 500; step(200);
  assert(dead >= 1 && ST.player.hp > 0 && ST.run.time > 3, 'kept playing after revive');
});
test('regen and root slow', () => {
  fresh('rg', { regen: 5, rootSlow: 0.5 }); ST.player.hp = 50; step(60); assert(ST.player.hp > 54 && ST.player.hp < 56);
  step(30); assert(ST.player.rooted); const e = D.spawnEnemy('mold', 85, 0); e.dmg = 0; step(1); assert(e.slow === 0.5, 'slow ' + e.slow);
  const far = D.spawnEnemy('mold', 400, 0); step(1); assert(far.slow === 0);
});

// ---------------------------------------------------------------- weapons / stats
function lost(e) { return e.maxHp - e.hp; }
test('seeds: auto-fire, range 520, projCount fan, shoot event rate <= 12/s', () => {
  fresh('sd', { projCount: 3, fireRate: 40 }); const e = still('mold', 600, 0); step(30); assert(ST.projectiles.length === 0, 'target out of 520');
  e.x = 300; let shots = 0; OG.bus.on('player:shoot', () => shots++); step(120);
  assert(shots > 15 && shots <= 25, 'shoot events ' + shots); assert(lost(e) > 0);
  fresh('fan', { projCount: 3, fireRate: 1 }); still('mold', 300, 0); step(61);
  assert(ST.projectiles.length >= 3, 'fan');
});
test('crit: crit=1 x3', () => {
  fresh('cr', { crit: 1, critMul: 3, fireRate: 4 }); still('mold', 200, 0); const hits = [];
  OG.bus.on('enemy:hit', h => hits.push([h.dmg, h.crit])); step(90);
  assert(hits.length > 0 && hits.every(h => h[1] && h[0] === 30));
});
test('pierce passes through, chain jumps', () => {
  fresh('p0', { fireRate: 4, crit: 0 }); const a0 = still('mold', 150, 0), b0 = still('mold', 300, 0); step(120);
  assert(lost(a0) > 0 && lost(b0) === 0, 'no pierce: only first');
  fresh('p1', { fireRate: 4, crit: 0, pierce: 1 }); const a1 = still('mold', 150, 0), b1 = still('mold', 300, 0); step(120);
  assert(lost(b1) > 0, 'pierce hits second');
  fresh('c0', { fireRate: 4, crit: 0 }); still('mold', 200, 0); const bc0 = still('mold', 200, 120); step(120);
  assert(lost(bc0) === 0);
  fresh('c1', { fireRate: 4, crit: 0, chain: 1 }); still('mold', 200, 0); const bc1 = still('mold', 200, 120); step(120);
  assert(lost(bc1) > 0, 'chain hits second');
});
test('orbit petals damage', () => {
  fresh('or', { fireRate: 0, orbitCount: 2, orbitDmg: 7 }); const e = still('mold', 60, 0); step(90);
  assert(ST.orbits.length === 2 && lost(e) >= 7);
});
test('nova damages, emits fx:nova, area scales', () => {
  fresh('nv', { fireRate: 0, novaCd: 1, novaDmg: 25, area: 2 }); const e = still('mold', 200, 0); let r = 0;
  OG.bus.on('fx:nova', n => r = n.r); step(70); assert(lost(e) >= 25 && r === 220, 'nova r ' + r);
});
test('burn DoT', () => {
  fresh('b0', { fireRate: 4, dmg: 1, crit: 0 }); const a = still('mold', 200, 0); step(200);
  fresh('b1', { fireRate: 4, dmg: 1, crit: 0, burnDps: 30 }); const b = still('mold', 200, 0); step(200);
  assert(lost(b) > lost(a) * 5 && lost(b) > 30, lost(a) + ' vs ' + lost(b));
});
test('dash trail damage', () => {
  fresh('t0', { fireRate: 0, trailDmg: 100 }); const e = still('mold', 60, 0); OG.input.move.x = 1; OG.input.dash = true; step(1); OG.input.dash = false; step(60);
  assert(lost(e) > 0, 'trail damaged');
  fresh('t1', { fireRate: 0 }); const f = still('mold', 60, 0); OG.input.move.x = 1; OG.input.dash = true; step(1); OG.input.dash = false; step(60); assert(lost(f) === 0);
});
test('thorns damage touching enemies', () => {
  fresh('th', { fireRate: 0, thorns: 40, maxHp: 1e9 }); const e = still('mold', 0, 0); step(40); assert(lost(e) > 0);
});
test('split seeds on kill', () => {
  fresh('s1', { fireRate: 4, dmg: 1000, crit: 0, splitCount: 12 }); still('mold', 500, 0, 500); const b = still('mold', 530, 45); step(120);
  assert(lost(b) > 0, 'split hit neighbour');
  fresh('s0', { fireRate: 4, dmg: 1000, crit: 0 }); still('mold', 500, 0, 500); const b0 = still('mold', 530, 45); step(120); assert(lost(b0) === 0);
});
test('kills: xp orb, light, flower, leech, magnet', () => {
  fresh('k', { fireRate: 4, dmg: 1000, leech: 5 }); ST.player.hp = 50; const ev = { die: 0, bloom: 0 };
  OG.bus.on('enemy:die', () => ev.die++); OG.bus.on('flower:bloom', () => ev.bloom++);
  still('spore', 60, 0, 5); step(100);
  assert(ev.die === 1 && ev.bloom === 1 && ST.run.kills === 1 && ST.run.light > 0.9, 'kill bookkeeping');
  assert(OG.tree.xp > 0 && OG.tree.tr.root > 0, 'xp collected'); assert(ST.player.hp === 55, 'leech ' + ST.player.hp);
  fresh('mg'); const near = D.addPickup(60, 0, 1, 'xp'), far = D.addPickup(300, 0, 1, 'xp'); step(30);
  assert(OG.tree.xp === 1 && far.pull === false && ST.pickups.length === 1);
});
test('orbs merge above 200', () => {
  fresh('mrg'); for (let i = 0; i < 500; i++) D.addPickup(-1500 + (i % 25) * 20, -1500 + Math.floor(i / 25) * 20, 1, 'xp');
  step(20); assert(ST.pickups.length <= 200, 'merged ' + ST.pickups.length);
  assert(Math.abs(ST.pickups.reduce((s, k) => s + k.amount, 0) - 500) < 1e-6, 'xp conserved');
});
test('enemies spread out (separation)', () => {
  fresh('sep', { fireRate: 0 }); const list = []; for (let i = 0; i < 40; i++) list.push(D.spawnEnemy('spore', 1000, 1000));
  step(120); let s = 0, c = 0; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) { s += Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y); c++; }
  assert(s / c > 12, 'mean pairwise ' + s / c);
});
test('spitter holds ~260 px and shoots hazards', () => {
  fresh('sp', { fireRate: 0, maxHp: 1e9 }); const e = D.spawnEnemy('spitter', 600, 0); let seen = 0;
  for (let i = 0; i < 600; i++) { step(1); seen = Math.max(seen, ST.hazards.length); }
  const d = Math.hypot(e.x - ST.player.x, e.y - ST.player.y); assert(d > 225 && d < 300, 'dist ' + d); assert(seen > 0);
});

// ---------------------------------------------------------------- spawner / bosses
test('spawner: deterministic per seed, rate, mix, cap', () => {
  const run = (seed, mover) => { fresh(seed, { maxHp: 1e9, fireRate: 0 }); D.log = []; step(150 * 60, mover); const l = D.log; D.log = null; return l; };
  const a = run('daily-1'), b = run('daily-1'), c = run('daily-2'), m = run('daily-1', () => { OG.input.move.x = 1; });
  assert(a.length === b.length && a.every((k, i) => k === b[i]), 'same seed same sequence');
  assert(a.join() !== c.join(), 'different seed differs');
  assert(m.join() === a.join(), 'sequence independent of player');
  const expect = 1.2 * 150 + 150 * 150 / 80; assert(Math.abs(a.length - expect) < 3, 'count ' + a.length + ' vs ' + expect);
  const early = a.slice(0, 117 + 1); assert(!early.some(k => k === 'brute' || k === 'spitter'), 'no brutes/spitters before 2:00');
  assert(a.some(k => k === 'brute') && a.some(k => k === 'spitter'), 'brutes & spitters later');
  fresh('cap', { fireRate: 0 }); for (let i = 0; i < 400; i++) D.spawnEnemy('mold', 100 + i, 100); step(1);
  assert(ST.enemies.length <= 350 && D.live() <= 350, 'cap ' + ST.enemies.length);
});
test('enemy scaling: hp x2 / 90 s, dmg x1.5 / 90 s', () => {
  fresh('sc'); const a = D.spawnEnemy('mold', 900, 900); ST.run.time = 90; const b = D.spawnEnemy('mold', 900, 900);
  assert(Math.abs(b.maxHp / a.maxHp - 2) < 1e-9 && Math.abs(b.dmg / a.dmg - 1.5) < 1e-9);
});
test('core: telegraph hazard 0.8 s then slam; level + heals on death', () => {
  fresh('core', { maxHp: 1e9, fireRate: 0 }); ST.run.time = 179.5; let bs = null; OG.bus.on('boss:spawn', b => bs = ST.run.time + ':' + b.kind);
  let tele = null, t0 = 0, t1 = 0, hp0 = 0, dead = 0; OG.bus.on('boss:dead', () => dead++);
  for (let i = 0; i < 60 * 8 && !t1; i++) {
    step(1);
    if (!tele) { tele = ST.hazards.find(h => h.telegraph); if (tele) { t0 = ST.run.time; assert(tele.dmg === 0); } }
    else if (!tele.telegraph) { t1 = ST.run.time; hp0 = tele.dmg; }
  }
  assert(bs && bs.endsWith(':core') && Math.abs(parseFloat(bs) - 180) < 0.02, 'core spawn ' + bs);
  assert(tele && t1 && Math.abs(t1 - t0 - 0.8) < 0.03 && hp0 > 0, 'telegraph ' + (t1 - t0));
  const core = ST.enemies.find(e => e.kind === 'core'); D.dealDamage(core, 1e12); step(1);
  assert(dead === 1 && OG.tree.levels === 1 && ST.pickups.filter(k => k.kind === 'heal').length === 3, 'core death rewards');
});
test('mother: 3 phases, bursts, boss:dead mother', () => {
  fresh('mom', { maxHp: 1e9, fireRate: 0 }); ST.run.time = 899.5; const evs = []; OG.bus.on('boss:dead', b => evs.push(b.kind));
  step(60); const m = ST.enemies.find(e => e.kind === 'mother'); assert(m, 'mother spawned at 900');
  step(300); assert(m.phase === 1 && ST.hazards.length > 0, 'phase1 bursts');
  m.hp = m.maxHp * 0.6; step(2); assert(m.phase === 2); m.hp = m.maxHp * 0.3; step(2); assert(m.phase === 3);
  D.dealDamage(m, 1e15); step(1); assert(evs.length === 1 && evs[0] === 'mother');
  assert(ST.run.light >= 1000);
});

// ---------------------------------------------------------------- performance
test('perf: 350 enemies + 300 projectiles < 2 ms per tick', () => {
  fresh('perf', { maxHp: 1e12, fireRate: 0, orbitCount: 4, orbitDmg: 1, novaCd: 2, novaDmg: 1 });
  const r = mkRng(7); ST.run.time = 300; let total = 0, n = 0;
  for (let t = 0; t < 700; t++) {
    while (ST.enemies.length < 350) { const a = r() * 6.283, d = 80 + r() * 600; const e = D.spawnEnemy(r() < 0.5 ? 'spore' : 'mold', Math.cos(a) * d, Math.sin(a) * d); e.hp = e.maxHp = 1e15; }
    while (ST.projectiles.length < 300) { const a = r() * 6.283; D.addProjectile(Math.cos(a) * 50, Math.sin(a) * 50, Math.cos(a) * 420, Math.sin(a) * 420, 1, 3, 0, 0, 1.2); }
    ST.run.time = 300;
    const t0 = process.hrtime.bigint(); W.update(DT); const dt = Number(process.hrtime.bigint() - t0) / 1e6;
    if (t >= 100) { total += dt; n++; }
  }
  const avg = total / n; console.log('    avg tick ' + avg.toFixed(3) + ' ms'); assert(avg < 2, 'avg ' + avg);
});

// ---------------------------------------------------------------- 15 minute headless run
test('15-minute headless run with flee bot: no exceptions/NaN, cap, boss times', () => {
  fresh('marathon', { maxHp: 400, armor: 2, regen: 1, orbitCount: 3, orbitDmg: 10, novaCd: 4, novaDmg: 30, burnDps: 5, chain: 1, pierce: 1, projCount: 2, splitCount: 2, trailDmg: 20, thorns: 5, rootSlow: 0.3, leech: 1, area: 1.3 });
  const bosses = []; let deaths = 0, maxEnemies = 0, maxHz = 0;
  OG.bus.on('boss:spawn', b => bosses.push([ST.run.time, b.kind]));
  OG.bus.on('player:dead', () => { deaths++; ST.player.hp = ST.player.maxHp; ST.player.invuln = 2; });
  OG.bus.on('boss:dead', b => { if (b.kind === 'mother') { /* keep fighting */ } });
  const bot = () => {
    let best = null, bd = 1e18; const p = ST.player;
    for (const e of ST.enemies) { const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (d < bd) { bd = d; best = e; } }
    let mx = 0, my = 0;
    if (best && bd < 400 * 400) { const d = Math.sqrt(bd) || 1; mx = (p.x - best.x) / d; my = (p.y - best.y) / d; }
    const dist = Math.hypot(p.x, p.y); if (dist > 1400) { mx -= p.x / dist * 1.5; my -= p.y / dist * 1.5; }
    const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
    OG.input.move.x = mx; OG.input.move.y = my; OG.input.dash = !!(best && bd < 70 * 70 && p.dashCd <= 0);
  };
  const total = 15 * 60 * 60 + 600;
  for (let i = 0; i < total; i++) {
    bot(); W.update(DT);
    if (ST.enemies.length > maxEnemies) maxEnemies = ST.enemies.length;
    if (ST.hazards.length > maxHz) maxHz = ST.hazards.length;
    if (i % 300 === 0) checkFinite();
  }
  checkFinite();
  assert(maxEnemies <= 350, 'cap ' + maxEnemies);
  const want = [[180, 'core'], [360, 'core'], [540, 'core'], [720, 'core'], [900, 'mother']];
  assert(bosses.length === 5, 'boss count ' + JSON.stringify(bosses));
  want.forEach((w, i) => assert(bosses[i][1] === w[1] && Math.abs(bosses[i][0] - w[0]) < 0.02, 'boss ' + i + ' ' + bosses[i]));
  console.log('    kills ' + ST.run.kills + ' deaths ' + deaths + ' maxEnemies ' + maxEnemies + ' maxHazards ' + maxHz + ' level-ups ' + OG.tree.levels + ' t=' + ST.run.time.toFixed(1));
});

console.log('\nALL ' + passed + ' TESTS PASSED');
process.exit(0);
