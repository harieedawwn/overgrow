(function (OG) {
  'use strict';
  OG.cfg = OG.cfg || {};
  var cfg = OG.cfg.meta = {
    saveVersion: 1,
    rootsDivisor: 30,          // rootsTotal = floor(sqrt(lifetimeLight / divisor))
    clearBonus: 0.25,          // extra roots on clear (rounded up)
    perRootBonus: 0.03,        // xpMul and lightMul per rootsTotal
    offlineMaxSec: 8 * 3600,
    offlineMinSec: 120,
    offlineRate: 0.25,         // fraction of bestLpm earned while away
    autosaveSec: 30,
    reviveInvuln: 2,
    dailyEpoch: [2026, 11, 1],
    minLpmSeconds: 30,         // runs shorter than this do not set bestLpm
    // base * growth^rank ; per = effect per rank
    upgrades: [
      { id: 'vo_cung',    name: 'Vỏ Cứng',       desc: '+20 máu tối đa mỗi bậc',          maxRank: 10, base: 2, growth: 1.25, per: 20 },
      { id: 'nhua_song',  name: 'Nhựa Sống',     desc: '+8% sát thương mỗi bậc',          maxRank: 10, base: 2, growth: 1.25, per: 0.08 },
      { id: 'chan_gio',   name: 'Chân Gió',      desc: '+4% tốc độ chạy mỗi bậc',         maxRank: 5,  base: 2, growth: 1.3,  per: 0.04 },
      { id: 're_hut',     name: 'Rễ Hút',        desc: '+15% tầm hút mỗi bậc',            maxRank: 5,  base: 2, growth: 1.3,  per: 0.15 },
      { id: 'hat_la',     name: 'Hạt Lạ',        desc: '+1 lần đổi lựa chọn mỗi bậc',     maxRank: 5,  base: 3, growth: 1.5,  per: 1 },
      { id: 'tan_rong',   name: 'Tán Rộng',      desc: '+1 lựa chọn khi lên cấp',         maxRank: 1,  base: 6, growth: 1,    per: 1 },
      { id: 'mam_som',    name: 'Mầm Sớm',       desc: 'Bắt đầu mùa ở cấp cao hơn (+1 cấp mỗi bậc)', maxRank: 3, base: 4, growth: 1.8, per: 1 },
      { id: 'hat_du_phong', name: 'Hạt Dự Phòng', desc: 'Hồi sinh một lần mỗi mùa với đầy máu', maxRank: 1, base: 5, growth: 1, per: 1 },
      { id: 're_sau',     name: 'Rễ Sâu',        desc: '+10% hiệu suất tăng trưởng khi vắng mặt mỗi bậc', maxRank: 5, base: 2, growth: 1.3, per: 0.10 },
      { id: 'anh_ban_mai', name: 'Ánh Ban Mai',  desc: '+10% ánh sáng mỗi bậc',           maxRank: 8,  base: 2, growth: 1.25, per: 0.10 }
    ]
  };

  var BR = ['fire', 'wind', 'root', 'stone'];
  var ICON = { fire: '🔥', wind: '💨', root: '🌿', stone: '🪨' };
  var started = false, saveTimer = 0, reviveUsed = false, applyingSettings = false;

  function now() { return OG.meta.now(); }
  function num(v, d) { return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : d; }
  function bool(v, d) { return typeof v === 'boolean' ? v : d; }
  function defaults() {
    return {
      roots: 0, rootsTotal: 0, lifetimeLight: 0, bestLpm: 0, upgrades: {}, codex: {},
      best: { time: 0, level: 0 }, seasons: 0, clears: 0, lastSeen: 0,
      daily: { date: '', bestTime: 0, bestLevel: 0, played: 0 },
      settings: { mute: false, volume: 0.8, shake: true, colorblind: false, relax: false, hints: { move: false, tree: false } }
    };
  }
  function findUp(id) {
    for (var i = 0; i < cfg.upgrades.length; i++) if (cfg.upgrades[i].id === id) return cfg.upgrades[i];
    return null;
  }
  // fill missing / invalid fields of an older or partial save with defaults
  function migrate(src) {
    var d = defaults();
    if (!src || typeof src !== 'object') return d;
    if (src.meta && typeof src.meta === 'object') src = src.meta;
    d.roots = Math.floor(num(src.roots, 0));
    d.lifetimeLight = num(src.lifetimeLight, 0);
    d.rootsTotal = Math.max(Math.floor(num(src.rootsTotal, 0)), rootsFor(d.lifetimeLight));
    d.bestLpm = num(src.bestLpm, 0);
    d.seasons = Math.floor(num(src.seasons, 0));
    d.clears = Math.floor(num(src.clears, 0));
    d.lastSeen = num(src.lastSeen, 0);
    var i, k, u;
    if (src.upgrades && typeof src.upgrades === 'object') {
      for (i = 0; i < cfg.upgrades.length; i++) {
        u = cfg.upgrades[i];
        var r = Math.floor(num(src.upgrades[u.id], 0));
        if (r > 0) d.upgrades[u.id] = Math.min(r, u.maxRank);
      }
    }
    if (src.codex && typeof src.codex === 'object') for (k in src.codex) if (src.codex[k] === true) d.codex[k] = true;
    if (src.best && typeof src.best === 'object') { d.best.time = num(src.best.time, 0); d.best.level = Math.floor(num(src.best.level, 0)); }
    if (src.daily && typeof src.daily === 'object') {
      d.daily.date = typeof src.daily.date === 'string' ? src.daily.date : '';
      d.daily.bestTime = num(src.daily.bestTime, 0);
      d.daily.bestLevel = Math.floor(num(src.daily.bestLevel, 0));
      d.daily.played = Math.floor(num(src.daily.played, 0));
    }
    var s = src.settings;
    if (s && typeof s === 'object') {
      d.settings.mute = bool(s.mute, false);
      d.settings.volume = Math.min(1, num(s.volume, 0.8));
      d.settings.shake = bool(s.shake, true);
      d.settings.colorblind = bool(s.colorblind, false);
      d.settings.relax = bool(s.relax, false);
      if (s.hints && typeof s.hints === 'object') {
        d.settings.hints.move = bool(s.hints.move, false);
        d.settings.hints.tree = bool(s.hints.tree, false);
      }
    }
    return d;
  }
  function rootsFor(light) { return Math.floor(Math.sqrt(Math.max(0, light) / cfg.rootsDivisor)); }
  function M() { return OG.state.meta; }
  function rank(id) { return M().upgrades[id] || 0; }

  function save() {
    var m = M();
    m.lastSeen = now();
    try { OG.save.write({ v: cfg.saveVersion, meta: m }); } catch (e) {}
  }
  function emitRoots() { OG.bus.emit('roots:change', { roots: M().roots }); }

  function dateKey() {
    var d = new Date(now());
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function dailyNumber() {
    var d = new Date(now()), e = cfg.dailyEpoch;
    var days = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(e[0], e[1] - 1, e[2])) / 86400000);
    return Math.max(1, days + 1);
  }

  // bonus handed to tree.reset; daily => {} so everyone is equal
  function bonus(daily) {
    if (daily) return {};
    var m = M(), t = m.rootsTotal * cfg.perRootBonus, b = {};
    function pu(id) { return findUp(id).per * rank(id); }
    b.maxHp = pu('vo_cung');
    b.dmgMul = 1 + pu('nhua_song');
    b.moveMul = 1 + pu('chan_gio');
    b.magnetMul = 1 + pu('re_hut');
    b.xpMul = 1 + t;
    b.lightMul = 1 + t + pu('anh_ban_mai');
    b.rerolls = pu('hat_la');
    b.choices = pu('tan_rong');
    if (rank('mam_som') > 0) b.startLevel = pu('mam_som'); // extra levels at season start (tree: missing = 0 = neutral)
    return b;
  }

  function cost(id) {
    var u = findUp(id);
    if (!u) return null;
    var r = rank(id);
    if (r >= u.maxRank) return null;
    return Math.max(1, Math.round(u.base * Math.pow(u.growth, r)));
  }
  function buy(id) {
    var c = cost(id);
    if (c === null || M().roots < c) return false;
    M().roots -= c;
    M().upgrades[id] = rank(id) + 1;
    save();
    emitRoots();
    return true;
  }

  function startRun(opts) {
    var daily = !!(opts && opts.daily), run = OG.state.run;
    var seed = daily ? OG.hashSeed('overgrow-' + dateKey()) : Math.floor(Math.random() * 4294967296) >>> 0;
    OG.rand = OG.rng(seed);
    run.seed = seed; run.daily = daily; run.over = false; run.result = null;
    run.time = 0; run.kills = 0; run.light = 0;
    reviveUsed = false; saveTimer = 0;
    OG.tree.reset(bonus(daily));   // stats first, so world.reset starts the player at the new max hp
    OG.world.reset();
    OG.game.setState('run');
    OG.bus.emit('run:start', { seed: seed, daily: daily });
  }

  function endRun(result) {
    var run = OG.state.run, m = M();
    if (run.over) return;
    run.over = true; run.result = result;
    var light = Math.max(0, run.light || 0), time = run.time || 0;
    m.lifetimeLight += light;
    var nt = rootsFor(m.lifetimeLight), gained = Math.max(0, nt - m.rootsTotal);
    if (result === 'clear') gained += Math.ceil(gained * cfg.clearBonus);
    m.rootsTotal = Math.max(m.rootsTotal, nt);
    m.roots += gained;
    if (time > m.best.time) m.best.time = time;
    if ((run.level || 0) > m.best.level) m.best.level = run.level;
    if (time >= cfg.minLpmSeconds) m.bestLpm = Math.max(m.bestLpm, light / (time / 60));
    m.seasons++;
    if (result === 'clear') m.clears++;
    if (run.daily) {
      var k = dateKey(), d = m.daily;
      if (d.date !== k) { d.date = k; d.bestTime = 0; d.bestLevel = 0; d.played = 0; }
      d.played++;
      if (time > d.bestTime) d.bestTime = time;
      if ((run.level || 0) > d.bestLevel) d.bestLevel = run.level;
    }
    save();
    OG.bus.emit('run:end', { result: result, time: time, level: run.level, kills: run.kills, light: light, rootsGained: gained });
    emitRoots();
    OG.game.setState('winter');
    if (OG.render && OG.render.zoomOut) OG.render.zoomOut(3, function () { OG.bus.emit('winter:show', {}); });
    else OG.bus.emit('winter:show', {});
  }

  function onDead() {
    var run = OG.state.run, p = OG.state.player;
    if (run.over) return;
    if (!reviveUsed && !run.daily && rank('hat_du_phong') > 0) {
      reviveUsed = true;
      p.hp = p.maxHp; p.invuln = cfg.reviveInvuln;
      OG.bus.emit('player:revive', {});
      return;
    }
    endRun('death');
  }

  function offline() {
    var m = M(), last = m.lastSeen, t = now();
    if (!last) return;
    var el = (t - last) / 1000;
    if (el < 0) { m.lastSeen = t; save(); return; }          // clock went backwards
    if (el < cfg.offlineMinSec) return;                       // too short
    el = Math.min(el, cfg.offlineMaxSec);
    var eff = 1 + findUp('re_sau').per * rank('re_sau');
    var light = (el / 60) * cfg.offlineRate * eff * m.bestLpm;
    if (light <= 0) { save(); return; }
    m.lifetimeLight += light;
    var nt = rootsFor(m.lifetimeLight), g = Math.max(0, nt - m.rootsTotal);
    m.rootsTotal = Math.max(m.rootsTotal, nt);
    m.roots += g;
    save();
    OG.bus.emit('offline:gain', { seconds: el, light: light, rootsGained: g });
  }

  function init() {
    if (started) return;
    started = true;
    var m = M(), fresh = migrate(OG.save.load()), k;
    for (k in m) delete m[k];
    for (k in fresh) m[k] = fresh[k];
    applyingSettings = true; OG.bus.emit('settings:change', { settings: m.settings }); applyingSettings = false;
    offline();
    emitRoots();
  }

  function shareText() {
    var run = OG.state.run, g = OG.state.tree.growth || {}, i, total = 0, q = [], sq = '';
    for (i = 0; i < 4; i++) total += Math.max(0, g[BR[i]] || 0);
    if (total <= 0) sq = '⬜⬜⬜⬜⬜';
    else {
      var cnt = [], used = 0, rem = [];
      for (i = 0; i < 4; i++) {
        var v = Math.max(0, g[BR[i]] || 0);
        cnt[i] = Math.floor(v * 5 / total); used += cnt[i]; rem.push({ i: i, r: (v * 5 / total) - cnt[i] });
      }
      rem.sort(function (a, b) { return b.r - a.r || a.i - b.i; });
      for (i = 0; used < 5; i = (i + 1) % 4, used++) cnt[rem[i].i]++;
      for (i = 0; i < 4; i++) for (var j = 0; j < cnt[i]; j++) sq += ICON[BR[i]];
    }
    var syn = 0, s = OG.state.tree.synergies || {};
    for (var key in s) if (s[key]) syn++;
    var out = '🌱 OVERGROW · Hạt Giống #' + dailyNumber() + '\n' + sq + '\n' +
      'Sống ' + OG.fmtTime(run.time || 0) + ' · Cấp ' + (run.level || 1) + ' · ' + syn + ' cộng hưởng';
    if (run.result === 'clear') out += '\nKhu Vườn nở hoa 🌸';
    return out;
  }

  OG.meta = {
    init: init, startRun: startRun, endRun: endRun, upgrades: cfg.upgrades, cost: cost, buy: buy,
    shareText: shareText, dailyNumber: dailyNumber, bonus: bonus, rank: rank, save: save,
    rootsFor: rootsFor, migrate: migrate, dateKey: dateKey,
    now: function () { return Date.now(); }
  };

  OG.bus.on('player:dead', onDead);
  OG.bus.on('boss:dead', function (d) { if (d && d.kind === 'mother') endRun('clear'); });
  OG.bus.on('synergy:found', function (d) { if (d && d.id) { M().codex[d.id] = true; save(); } });
  OG.bus.on('settings:change', function (d) {
    if (applyingSettings) return;
    if (d && d.settings && d.settings !== M().settings) M().settings = migrate({ settings: d.settings }).settings;
    save();
  });
  OG.game.addUpdate(function (dt) {
    saveTimer += dt;
    if (saveTimer >= cfg.autosaveSec - 1e-6) { saveTimer = 0; save(); }
  }, 20);
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('pagehide', function () { if (started) save(); });
  }
})(window.OG = window.OG || {});
