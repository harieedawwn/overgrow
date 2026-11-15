// node tests/test_meta.js
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
globalThis.window = globalThis;
const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', 'meta.js'), 'utf8');
const T0 = new Date(2026, 10, 15, 12, 0, 0).getTime();

function fresh(saved) {
  const H = {}, log = { events: [], zoom: 0, worldReset: 0, bonus: null, states: [], updates: [] };
  const OG = {
    cfg: {},
    bus: {
      on(n, f) { (H[n] = H[n] || []).push(f); }, off() {},
      emit(n, d) { log.events.push([n, d]); (H[n] || []).slice().forEach(f => f(d)); }
    },
    game: { state: 'title', setState(s) { const f = OG.game.state; OG.game.state = s; log.states.push(s); OG.bus.emit('state:change', { from: f, to: s }); },
            addUpdate(f) { log.updates.push(f); } },
    rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; },
    hashSeed(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; },
    save: { store: saved === undefined ? null : saved, load() { return this.store ? JSON.parse(JSON.stringify(this.store)) : null; }, write(o) { this.store = JSON.parse(JSON.stringify(o)); this.writes = (this.writes || 0) + 1; } },
    fmtTime(s) { s = Math.floor(s); const p = n => (n < 10 ? '0' : '') + n; return p(Math.floor(s / 60)) + ':' + p(s % 60); },
    state: { run: {}, player: { hp: 0, maxHp: 100, invuln: 0 }, meta: {}, tree: { growth: { fire: 0, wind: 0, root: 0, stone: 0 }, synergies: {} } },
    world: { reset() { log.worldReset++; } },
    tree: { reset(b) { log.bonus = b; } },
    render: { zoomOut(s, cb) { log.zoom++; log.cb = cb; } }
  };
  globalThis.OG = window.OG = OG;
  vm.runInThisContext(SRC, { filename: 'meta.js' });
  let t = T0; OG.meta.now = () => t; OG.setNow = v => { t = v; };
  return { OG, log };
}
const ev = (log, n) => log.events.filter(e => e[0] === n).map(e => e[1]);
function finish(OG, o) { Object.assign(OG.state.run, o); }

// 1 roots formula + clear bonus
{
  const { OG, log } = fresh(); OG.meta.init(); OG.meta.startRun({});
  finish(OG, { time: 400, level: 8, kills: 50, light: 4000 });
  OG.meta.endRun('death');
  assert.strictEqual(OG.state.meta.rootsTotal, 2); assert.strictEqual(OG.state.meta.roots, 2);
  assert.deepStrictEqual(ev(log, 'run:end')[0].rootsGained, 2);
  assert.strictEqual(log.zoom, 1); log.cb(); assert.strictEqual(ev(log, 'winter:show').length, 1);
  assert.strictEqual(OG.game.state, 'winter');
  OG.meta.startRun({}); finish(OG, { time: 900, level: 20, light: 12000 });   // lifetime 16000 -> 4 ; +2 ; clear +ceil(0.5)=1
  OG.meta.endRun('clear');
  assert.strictEqual(OG.state.meta.rootsTotal, 4); assert.strictEqual(OG.state.meta.roots, 5);
  assert.strictEqual(OG.state.meta.clears, 1); assert.strictEqual(OG.state.meta.seasons, 2);
  assert.strictEqual(OG.state.meta.best.time, 900); assert.ok(Math.abs(OG.state.meta.bestLpm - 800) < 1e-9 || OG.state.meta.bestLpm >= 600);
  OG.meta.endRun('death'); assert.strictEqual(OG.state.meta.seasons, 2, 'endRun is once per run');
  assert.ok(OG.save.store.meta.roots === 5);
  // bonus
  const b = OG.meta.bonus(false); assert.ok(Math.abs(b.xpMul - 1.12) < 1e-9 && Math.abs(b.lightMul - 1.12) < 1e-9);
  OG.meta.startRun({}); assert.deepStrictEqual(Object.keys(log.bonus).includes('xpMul'), true);
  OG.meta.startRun({ daily: true }); assert.deepStrictEqual(log.bonus, {});
}

// 2 costs, caps, buying
{
  const { OG, log } = fresh(); OG.meta.init();
  assert.strictEqual(OG.meta.upgrades.length, 10);
  assert.strictEqual(OG.meta.cost('vo_cung'), 2);
  assert.strictEqual(OG.meta.buy('vo_cung'), false, 'no roots');
  assert.strictEqual(OG.state.meta.upgrades.vo_cung, undefined);
  OG.state.meta.roots = 1000;
  for (const u of OG.meta.upgrades) {
    for (let i = 0; i < u.maxRank; i++) {
      const exp = Math.max(1, Math.round(u.base * Math.pow(u.growth, i)));
      assert.strictEqual(OG.meta.cost(u.id), exp); assert.ok(OG.meta.buy(u.id));
    }
    assert.strictEqual(OG.meta.cost(u.id), null); assert.strictEqual(OG.meta.buy(u.id), false);
  }
  assert.strictEqual(OG.meta.cost('nope'), null);
  assert.ok(ev(log, 'roots:change').length >= 10);
  const b = OG.meta.bonus(false);
  assert.strictEqual(b.maxHp, 200); assert.strictEqual(b.choices, 1); assert.strictEqual(b.startLevel, 3); assert.strictEqual(b.rerolls, 5);
}

// 3 offline
{
  const { OG, log } = fresh({ v: 1, meta: { bestLpm: 1000, lastSeen: T0 - 3 * 3600 * 1000, lifetimeLight: 0 } });
  OG.meta.init();
  const g = ev(log, 'offline:gain')[0];
  assert.ok(g && Math.abs(g.light - 180 * 0.25 * 1000) < 1e-6 && g.seconds === 10800);
  assert.strictEqual(OG.state.meta.rootsTotal, Math.floor(Math.sqrt(45000 / 1000)));
  assert.strictEqual(OG.state.meta.roots, 6);
  // cap 8h with Rễ Sâu x2 (+20%)
  const b = fresh({ meta: { bestLpm: 100, lastSeen: T0 - 30 * 3600 * 1000, upgrades: { re_sau: 2 } } }); b.OG.meta.init();
  const g2 = ev(b.log, 'offline:gain')[0]; assert.ok(Math.abs(g2.light - 480 * 0.25 * 1.2 * 100) < 1e-6 && g2.seconds === 28800);
  // small gap
  const c = fresh({ meta: { bestLpm: 1000, lastSeen: T0 - 100 * 1000 } }); c.OG.meta.init();
  assert.strictEqual(ev(c.log, 'offline:gain').length, 0); assert.strictEqual(c.OG.state.meta.lifetimeLight, 0);
  // clock backwards
  const d = fresh({ meta: { bestLpm: 1000, lastSeen: T0 + 5 * 3600 * 1000 } }); d.OG.meta.init();
  assert.strictEqual(ev(d.log, 'offline:gain').length, 0); assert.strictEqual(d.OG.state.meta.lifetimeLight, 0);
  assert.strictEqual(d.OG.state.meta.lastSeen, T0);
}

// 4 daily seed
{
  const { OG, log } = fresh(); OG.meta.init();
  OG.meta.startRun({ daily: true }); const s1 = OG.state.run.seed; assert.strictEqual(OG.state.run.daily, true);
  OG.meta.startRun({ daily: true }); assert.strictEqual(OG.state.run.seed, s1);
  OG.setNow(new Date(2026, 10, 16, 3).getTime()); OG.meta.startRun({ daily: true }); assert.notStrictEqual(OG.state.run.seed, s1);
  OG.setNow(new Date(2026, 10, 15, 23, 59).getTime()); OG.meta.startRun({ daily: true }); assert.strictEqual(OG.state.run.seed, s1);
  assert.strictEqual(OG.state.run.seed, OG.hashSeed('overgrow-2026-11-15'));
  assert.strictEqual(OG.meta.dailyNumber(), 15);
  OG.setNow(new Date(2026, 10, 1, 8).getTime()); assert.strictEqual(OG.meta.dailyNumber(), 1);
  OG.setNow(new Date(2026, 11, 1, 8).getTime()); assert.strictEqual(OG.meta.dailyNumber(), 31);
  OG.meta.startRun({}); OG.meta.startRun({}); assert.strictEqual(typeof OG.state.run.seed, 'number');
  assert.strictEqual(ev(log, 'run:start')[0].daily, true);
  // daily bests, no bonus, no revive
  OG.state.meta.upgrades.hat_du_phong = 1;
  OG.meta.startRun({ daily: true }); OG.state.player.maxHp = 100; OG.bus.emit('player:dead', {});
  assert.strictEqual(OG.state.run.result, 'death');
  assert.strictEqual(OG.state.meta.daily.played, 1);
}

// 5 share text
{
  const { OG } = fresh(); OG.meta.init();
  const set = (g, run, syn) => { Object.assign(OG.state.tree.growth, g); Object.assign(OG.state.run, run); OG.state.tree.synergies = syn; };
  set({ fire: 10, wind: 0, root: 0, stone: 0 }, { time: 125, level: 7, result: 'death' }, {});
  assert.strictEqual(OG.meta.shareText(), '🌱 OVERGROW · Hạt Giống #15\n🔥🔥🔥🔥🔥\nSống 02:05 · Cấp 7 · 0 cộng hưởng');
  set({ fire: 3, wind: 3, root: 2, stone: 2 }, { time: 540, level: 12, result: 'clear' }, { a: true, b: true });
  assert.strictEqual(OG.meta.shareText(), '🌱 OVERGROW · Hạt Giống #15\n🔥🔥💨🌿🪨\nSống 09:00 · Cấp 12 · 2 cộng hưởng\nKhu Vườn nở hoa 🌸');
  set({ fire: 1, wind: 2, root: 3, stone: 4 }, { time: 905, level: 20, result: 'death' }, { a: true, b: true, c: true, d: false });
  assert.strictEqual(OG.meta.shareText(), '🌱 OVERGROW · Hạt Giống #15\n🔥💨🌿🪨🪨\nSống 15:05 · Cấp 20 · 3 cộng hưởng');
}

// 6 revive once per season
{
  const { OG, log } = fresh(); OG.meta.init(); OG.state.meta.upgrades.hat_du_phong = 1;
  OG.meta.startRun({}); OG.state.player.hp = 0; OG.state.player.maxHp = 130;
  OG.bus.emit('player:dead', {});
  assert.strictEqual(OG.state.run.over, false); assert.strictEqual(OG.state.player.hp, 130); assert.strictEqual(OG.state.player.invuln, 2);
  assert.strictEqual(ev(log, 'player:revive').length, 1); assert.strictEqual(OG.game.state, 'run');
  OG.bus.emit('player:dead', {}); assert.strictEqual(OG.state.run.over, true); assert.strictEqual(OG.state.run.result, 'death');
  OG.meta.startRun({}); OG.bus.emit('player:dead', {}); assert.strictEqual(ev(log, 'player:revive').length, 2, 'new season revives again');
  OG.bus.emit('boss:dead', { kind: 'core' }); assert.strictEqual(OG.state.run.over, false);
  OG.bus.emit('boss:dead', { kind: 'mother' }); assert.strictEqual(OG.state.run.result, 'clear');
  OG.bus.emit('synergy:found', { id: 'steam' }); assert.strictEqual(OG.state.meta.codex.steam, true);
}

// 7 migration + save triggers
{
  let r = fresh(null); r.OG.meta.init(); assert.deepStrictEqual(JSON.parse(JSON.stringify(r.OG.state.meta)), r.OG.meta.migrate(null));
  assert.strictEqual(r.OG.state.meta.settings.volume, 0.8);
  r = fresh({ roots: 7, upgrades: { vo_cung: 99, zzz: 3 }, settings: { mute: true }, best: { time: 60 }, daily: { date: 5 } });
  r.OG.meta.init(); const m = r.OG.state.meta;
  assert.strictEqual(m.roots, 7); assert.strictEqual(m.upgrades.vo_cung, 10); assert.strictEqual(m.upgrades.zzz, undefined);
  assert.strictEqual(m.settings.mute, true); assert.strictEqual(m.settings.shake, true); assert.strictEqual(m.settings.hints.tree, false);
  assert.strictEqual(m.best.time, 60); assert.strictEqual(m.best.level, 0); assert.strictEqual(m.daily.date, ''); assert.deepStrictEqual(m.codex, {});
  // settings:change saves; autosave 30 s
  const w = r.OG.save.writes || 0;
  r.OG.bus.emit('settings:change', { settings: { mute: false, volume: 0.3 } });
  assert.strictEqual(r.OG.save.store.meta.settings.volume, 0.3); assert.strictEqual(r.OG.save.store.meta.settings.shake, true);
  const w2 = r.OG.save.writes; for (let i = 0; i < 1799; i++) r.log.updates[0](1 / 60); assert.strictEqual(r.OG.save.writes, w2);
  r.log.updates[0](1 / 60); assert.strictEqual(r.OG.save.writes, w2 + 1);
}

// 8 season table from a simple power model
{
  const { OG } = fresh(); OG.meta.init();
  const order = ['nhua_song', 'anh_ban_mai', 'vo_cung', 'mam_som', 'tan_rong', 'chan_gio', 're_hut', 'hat_la', 're_sau', 'hat_du_phong'];
  // threat grows 3x per 90 s (hp x2, dmg x1.5); in-run power grows 3^(0.8 t/90); T = 420 + 410 ln(P)
  const K = 90 / (0.2 * Math.log(3)), G = 0.8 * Math.log(3) / 90;
  const power = b => b.dmgMul * Math.pow(1 + (b.maxHp || 0) / 150, 0.8) * Math.pow(b.moveMul, 0.5) * Math.pow(b.xpMul, 0.7) *
    (1 + 0.1 * (b.startLevel || 0)) * Math.pow(b.magnetMul, 0.2) * (1 + 0.1 * (b.choices || 0)) * (1 + 0.02 * (b.rerolls || 0)) *
    (OG.meta.rank('hat_du_phong') ? 1.1 : 1);
  const rows = []; let prevT = 0, clearSeason = 0;
  for (let s = 1; s <= 12; s++) {
    const b = OG.meta.bonus(false), P = power(b);
    const T = Math.min(900, 420 + K * Math.log(P));
    const light = 14700 * Math.pow(2, (T - 420) / 180) * b.lightMul; // kills are worth more as enemies scale
    OG.meta.startRun({}); Object.assign(OG.state.run, { time: T, level: Math.floor(T / 50) + 1, light, kills: 0 });
    const before = OG.state.meta.roots; OG.meta.endRun(T >= 900 ? 'clear' : 'death');
    const gained = OG.state.meta.roots - before; let bought = 0, c;
    for (;;) {
      const af = order.filter(id => (c = OG.meta.cost(id)) !== null && c <= OG.state.meta.roots);
      if (!af.length) break; OG.meta.buy(af[0]); bought++;
    }
    // time needed next season to reach this season's best, with next season's power
    const P2 = power(OG.meta.bonus(false)), tReach = T - Math.log(P2 / P) / G;
    rows.push({ season: s, time: Math.round(T), light: Math.round(light), gained, bought, roots: OG.state.meta.roots, rootsTotal: OG.state.meta.rootsTotal, nextReachPct: Math.round(100 * tReach / T) });
    if (T >= 900 && !clearSeason) clearSeason = s;
    prevT = T;
  }
  console.log('Season table (model):'); console.table(rows);
  assert.ok(rows[0].time >= 360 && rows[0].time <= 540, 'first season 6-9 min');
  assert.ok(rows[0].bought >= 1 && rows[0].bought <= 2, 'first season buys 1-2 upgrades, got ' + rows[0].bought);
  for (let i = 0; i < 8; i++) assert.ok(rows[i].gained >= 1, 'every season has progress, s' + (i + 1));
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].time >= rows[i - 1].time, 'time never regresses');
  console.log('clear season (model):', clearSeason);
  // informational only: the model's clear season / reach% depend on guessed light and power curves, to be re-tuned against the real game
  console.log('model note: clearSeason=' + (clearSeason || 'none in 12') + ', nextReachPct ~' + rows[5].nextReachPct + '% (target 60%)');
}
console.log('test_meta OK');
