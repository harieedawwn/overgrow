// node tests/sim_balance.js [--seasons 20] [--skill 1] [--render 0] [--quiet]
// Loads the real game modules (core, tree, world, meta, audio, render, treeview) in Node with a stub canvas,
// DOM, localStorage and Web Audio, then plays N seasons with a bot that flees danger and picks offers by a
// simple rule. Meta (roots, upgrades) persists between seasons. Prints the season table and checks.
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var args = process.argv.slice(2);
function opt(n, d) { var i = args.indexOf(n); return i > -1 ? +args[i + 1] : d; }
var SEASONS = opt('--seasons', 20), SKILL = opt('--skill', 1), RENDER_EVERY = opt('--render', 0), QUIET = args.indexOf('--quiet') > -1;
var CAP_TIME = opt('--cap', 1200);   // hard stop (s) if the final boss is still alive

globalThis.window = globalThis;

// ---- seeded Math.random so a simulation is repeatable
(function () { var a = opt('--seed', 12345) >>> 0; Math.random = function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();

// ---- stub canvas / DOM / storage / audio
var any = new Proxy(function () {}, { get: function (t, k) { return k === Symbol.toPrimitive ? function () { return 0; } : any; }, apply: function () { return any; }, set: function () { return true; } });
function makeCtx(canvas) {
  var props = {};
  return new Proxy({}, {
    get: function (t, k) {
      if (k === 'canvas') return canvas;
      if (k in props) return props[k];
      if (k === 'measureText') return function () { return { width: 10 }; };
      return function () { return any; };
    },
    set: function (t, k, v) { props[k] = v; return true; }
  });
}
function mkEl(tag) {
  var e = { tagName: String(tag).toUpperCase(), style: {}, children: [], width: 0, height: 0, dataset: {},
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    appendChild: function (c) { e.children.push(c); return c; }, addEventListener: function () {}, removeEventListener: function () {},
    setAttribute: function () {}, closest: function () { return null; }, remove: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 800, height: 600 }; },
    toDataURL: function () { return 'data:image/png;base64,AA=='; } };
  e.getContext = function () { return e._ctx || (e._ctx = makeCtx(e)); };
  return e;
}
var body = mkEl('body');
globalThis.document = { body: body, documentElement: mkEl('html'), hidden: false, visibilityState: 'visible',
  createElement: mkEl, getElementById: function () { return null; }, addEventListener: function () {}, fonts: null };
var store = {};
globalThis.localStorage = { getItem: function (k) { return k in store ? store[k] : null; }, setItem: function (k, v) { store[k] = String(v); }, removeItem: function (k) { delete store[k]; } };
globalThis.addEventListener = function () {}; globalThis.removeEventListener = function () {};
globalThis.innerWidth = 800; globalThis.innerHeight = 600; globalThis.devicePixelRatio = 1;
globalThis.matchMedia = function () { return { matches: false, addEventListener: function () {} }; };
globalThis.requestAnimationFrame = function () { return 0; };
var audioEvents = { sources: 0 };
function Param(v) { this.value = v || 0; }
['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'cancelScheduledValues', 'setTargetAtTime'].forEach(function (m) { Param.prototype[m] = function () {}; });
function ANode() { this.connect = function (n) { return n; }; this.disconnect = function () {}; }
var ACtxTime = 0;
function ACtx() { this.sampleRate = 8000; this.destination = new ANode(); this.state = 'running'; Object.defineProperty(this, 'currentTime', { get: function () { return ACtxTime; } }); this.resume = function () { return Promise.resolve(); }; this.suspend = function () {}; }
ACtx.prototype.createGain = function () { var n = new ANode(); n.gain = new Param(1); return n; };
ACtx.prototype.createBiquadFilter = function () { var n = new ANode(); n.frequency = new Param(); n.Q = new Param(); n.gain = new Param(); return n; };
ACtx.prototype.createDynamicsCompressor = function () { var n = new ANode(); ['threshold', 'knee', 'ratio', 'attack', 'release'].forEach(function (k) { n[k] = new Param(); }); return n; };
ACtx.prototype.createConvolver = function () { return new ANode(); };
ACtx.prototype.createWaveShaper = function () { return new ANode(); };
ACtx.prototype.createBuffer = function (ch, len) { var d = new Float32Array(len); return { getChannelData: function () { return d; }, duration: len / 8000 }; };
ACtx.prototype.createBufferSource = function () { var n = new ANode(); n.playbackRate = new Param(1); n.start = function () { audioEvents.sources++; }; n.stop = function () {}; return n; };
ACtx.prototype.createOscillator = function () { var n = new ANode(); n.frequency = new Param(); n.start = function () { audioEvents.sources++; }; n.stop = function () {}; return n; };
globalThis.AudioContext = ACtx;

// ---- load modules, capturing the update/render hooks (the real loop needs requestAnimationFrame)
function load(f) { vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), { filename: f }); }
load('core.js');
var OG = window.OG, updates = [], renders = [], seq = 0;
var origU = OG.game.addUpdate, origR = OG.game.addRender;
OG.game.addUpdate = function (fn, o) { updates.push({ fn: fn, o: +o || 0, s: seq++ }); updates.sort(function (a, b) { return a.o - b.o || a.s - b.s; }); };
OG.game.addRender = function (fn, o) { renders.push({ fn: fn, o: +o || 0, s: seq++ }); renders.sort(function (a, b) { return a.o - b.o || a.s - b.s; }); };
['tree.js', 'world.js', 'meta.js', 'audio.js', 'render.js', 'treeview.js'].forEach(load);

var errors = [];
var origErr = console.error; console.error = function () { errors.push([].slice.call(arguments).join(' ')); };

// ---- tunable overrides: --cfg "world.spawnBase=0.8,tree.xpBase=3,world.kinds.mold.hp=15"
(function () {
  var i = args.indexOf('--cfg'); if (i < 0 || !args[i + 1]) return;
  args[i + 1].split(',').forEach(function (kv) {
    var m = kv.split('='), keys = m[0].trim().split('.'), o = OG.cfg;
    for (var k = 0; k < keys.length - 1; k++) o = o[keys[k]];
    var last = keys[keys.length - 1];
    if (!(last in o) && !Array.isArray(o)) throw new Error('unknown cfg ' + m[0]);
    o[last] = JSON.parse(m[1]);
  });
})();

// ---- main.js equivalent
OG.meta.init();
OG.boot();                       // document.body exists -> starts synchronously
OG.view.w = 800; OG.view.h = 600; OG.view.dpr = 1;
OG.bus.emit('resize', { w: 800, h: 600, dpr: 1 });
OG.audio.unlock();

// ---- bot
var S = OG.state, DT = 1 / 60;
var PAIRS = [['fire', 'wind'], ['root', 'stone'], ['fire', 'root'], ['wind', 'stone'], ['fire', 'stone'], ['wind', 'root']];
var target = PAIRS[0], offersTaken = 0, rerollsUsed = 0, hintsSeen = 0;
var synReq = {};
OG.tree.synergies.forEach(function (y) { if (y.branches.every(function (b) { return target.indexOf(b) > -1; })) for (var id in y.req) synReq[id] = true; });
function setTarget(p) {
  target = p; synReq = {};
  OG.tree.synergies.forEach(function (y) { if (y.branches.every(function (b) { return p.indexOf(b) > -1; })) for (var id in y.req) synReq[id] = Math.max(synReq[id] || 0, y.req[id]); });
}
function score(o) {
  var s = 0;
  if (o.synergyHint) s += 100;
  if (target.indexOf(o.branch) > -1) s += 10;
  if (synReq[o.id]) s += 30 + (o.rank <= synReq[o.id] ? 10 : -25);
  s += o.rank * 0.5;
  return s;
}
var pendingOffer = null;
OG.bus.on('levelup:offer', function (d) { pendingOffer = d.options; });
OG.bus.on('synergy:found', function () { synergiesFound++; });
var synergiesFound = 0;
function resolveOffers() {
  var guard = 0;
  while (S.stats && OG.game.state === 'levelup' && pendingOffer && guard++ < 50) {
    var opts = pendingOffer, best = null, bs = -1e9;
    opts.forEach(function (o) { var v = score(o); if (v > bs) { bs = v; best = o; } });
    if (bs < 25 && S.run.rerolls > 0) { rerollsUsed++; pendingOffer = null; if (OG.tree.reroll()) continue; pendingOffer = opts; }
    pendingOffer = null;
    if (OG.tree.choose(best.id)) offersTaken++;
    if (OG.game.state === 'levelup' && !pendingOffer) OG.game.setState('run');
  }
  if (OG.game.state === 'levelup' && !pendingOffer) OG.game.setState('run');
}
var diag = { hurts: 0, hurtSum: 0, xp: 0 };
var hurtLog = [], motherMin = 1, motherSeen = false;
OG.bus.on('player:hurt', function (d) { diag.hurts++; diag.hurtSum += d.dmg;
  var kinds = {}; S.enemies.forEach(function (e) { if (e.touch && !e.dead) kinds[e.kind] = (kinds[e.kind] || 0) + 1; });
  var hz = S.hazards.filter(function (h) { var dx = S.player.x - h.x, dy = S.player.y - h.y; return !h.telegraph && dx * dx + dy * dy < (h.r + 16) * (h.r + 16); }).length;
  hurtLog.push(S.run.time.toFixed(0) + 's -' + d.dmg.toFixed(0) + ' hp' + d.hp.toFixed(0) + ' ' + JSON.stringify(kinds) + ' hz' + hz); if (hurtLog.length > 8) hurtLog.shift(); });
OG.bus.on('xp:pickup', function (d) { diag.xp += d.amount; });
var botT = 0, mvx = 0, mvy = 0, wantDash = false;
function bot() {
  if (botT-- > 0) { return; }
  botT = Math.round(6 / SKILL);          // reaction time: 100 ms at skill 1
  var P = S.player, E = S.enemies, H = S.hazards, dx = 0, dy = 0, i, e, d, w, R = 280, near = 1e9, nearE = null;
  for (i = 0; i < E.length; i++) {
    e = E[i]; if (e.dead) continue;
    var ex = P.x - e.x, ey = P.y - e.y; d = Math.sqrt(ex * ex + ey * ey) - e.r;
    if (d < near) { near = d; nearE = e; }
    if (d < R) { w = (1 - Math.max(d, 0) / R); w = w * w * (e.r > 20 ? 2.2 : 1); var l = Math.sqrt(ex * ex + ey * ey) || 1; dx += ex / l * w; dy += ey / l * w; }
  }
  for (i = 0; i < H.length; i++) {
    var h = H[i]; var hx = P.x - h.x, hy = P.y - h.y; d = Math.sqrt(hx * hx + hy * hy) - h.r;
    var reach = h.telegraph || h.zone ? 60 : 150;
    if (d < reach) { w = (1 - Math.max(d, 0) / reach) * 3; var hl = Math.sqrt(hx * hx + hy * hy) || 1; dx += hx / hl * w; dy += hy / hl * w; }
  }
  // arena walls
  var lim = 1750; if (P.x > lim) dx -= (P.x - lim) / 100; if (P.x < -lim) dx += (-lim - P.x) / 100;
  if (P.y > lim) dy -= (P.y - lim) / 100; if (P.y < -lim) dy += (-lim - P.y) / 100;
  var m = Math.sqrt(dx * dx + dy * dy);
  if (m > 0.12) {
    // slide sideways when pinned: add a perpendicular component so we orbit the crowd instead of backing into walls
    var s = m > 1.2 ? 0.7 : 0.35, px = -dy, py = dx;
    dx = dx / m + px / m * s; dy = dy / m + py / m * s; var n = Math.sqrt(dx * dx + dy * dy) || 1; mvx = dx / n; mvy = dy / n;
  } else {
    // calm: walk toward the closest xp orb, otherwise stand still (stone/rooted builds like this)
    var bo = null, bd = 380 * 380, PK = S.pickups;
    for (i = 0; i < PK.length; i++) { var k = PK[i], ox = k.x - P.x, oy = k.y - P.y, dd = ox * ox + oy * oy; if (dd < bd && !(k.kind === 'heal' && P.hp >= P.maxHp)) { bd = dd; bo = k; } }
    if (bo) { var ol = Math.sqrt(bd) || 1; mvx = (bo.x - P.x) / ol; mvy = (bo.y - P.y) / ol; } else { mvx = 0; mvy = 0; }
  }
  var inZone = false;
  for (i = 0; i < H.length; i++) { var z = H[i]; if (z.telegraph || z.zone) { var zx = P.x - z.x, zy = P.y - z.y; if (zx * zx + zy * zy < (z.r + 8) * (z.r + 8)) inZone = true; } }
  wantDash = !!(P.dashCd <= 0 && m > 0.3 && ((nearE && near < 14) || inZone));
}

// ---- NaN scan of OG.state
var nanHits = [];
function scanNaN(label) {
  var seen = new Set();
  (function walk(o, p, depth) {
    if (depth > 4 || o === null || typeof o !== 'object' || seen.has(o)) return; seen.add(o);
    if (Array.isArray(o)) { var lim = Math.min(o.length, 30); for (var i = 0; i < lim; i++) walk(o[i], p + '[' + i + ']', depth + 1); return; }
    for (var k in o) { var v = o[k]; if (typeof v === 'number') { if (v !== v || v === Infinity || v === -Infinity) nanHits.push(label + ' ' + p + '.' + k + '=' + v); } else walk(v, p + '.' + k, depth + 1); }
  })(S, 'state', 0);
}

// ---- shopping
var PRIORITY = ['nhua_song', 'vo_cung', 'hat_du_phong', 'tan_rong', 'chan_gio', 're_hut', 'hat_la', 'mam_som', 'anh_ban_mai', 're_sau'];
function shop() {
  var bought = 0, guard = 0;
  while (guard++ < 200) {
    var best = null, bv = 1e9;
    OG.meta.upgrades.forEach(function (u) {
      var c = OG.meta.cost(u.id); if (c === null || c > S.meta.roots) return;
      var v = (OG.meta.rank(u.id) / u.maxRank) * 10 + PRIORITY.indexOf(u.id) * 0.1;
      if (v < bv) { bv = v; best = u; }
    });
    if (!best) break;
    if (OG.meta.buy(best.id)) bought++; else break;
  }
  return bought;
}

// ---- one season
function tickAll() {
  for (var i = 0; i < updates.length; i++) updates[i].fn(DT);
}
function playSeason(idx) {
  setTarget(PAIRS[idx % PAIRS.length]);
  synergiesFound = 0; offersTaken = 0;
  var rootsBefore = S.meta.roots, totalBefore = S.meta.rootsTotal, ticks = 0, firstLevelups = [], lastLv = 1;
  OG.meta.startRun({ daily: false });
  botT = 0;
  var upTimes = [];
  while (!S.run.over && S.run.time < CAP_TIME) {
    if (OG.game.state === 'levelup') { resolveOffers(); continue; }
    if (OG.game.state !== 'run') break;
    bot();
    OG.input.move.x = mvx; OG.input.move.y = mvy; OG.input.dash = wantDash; wantDash = false;
    tickAll(); ticks++;
    if (S.run.time > 899) for (var q = 0; q < S.enemies.length; q++) if (S.enemies[q].kind === 'mother' && !S.enemies[q].dead) { motherSeen = true; motherMin = Math.min(motherMin, S.enemies[q].hp / S.enemies[q].maxHp); }
    if (S.run.level !== lastLv) { upTimes.push(+S.run.time.toFixed(1)); lastLv = S.run.level; }
    if (RENDER_EVERY && ticks % RENDER_EVERY === 0) { ACtxTime += RENDER_EVERY * DT; OG.ctx = OG.ctx || mkEl('canvas').getContext(); for (var r = 0; r < renders.length; r++) renders[r].fn(OG.ctx, 0.5, DT); }
    if (ticks % 600 === 0) scanNaN('s' + idx + ' t' + S.run.time.toFixed(0));
  }
  if (!S.run.over) OG.meta.endRun('death'); // time cap
  scanNaN('s' + idx + ' end');
  var gaps = [], prev = 0; upTimes.forEach(function (t) { gaps.push(t - prev); prev = t; });
  var maxGap = gaps.length ? Math.max.apply(null, gaps) : S.run.time;
  maxGap = Math.max(maxGap, S.run.time - prev);
  var rec = {
    n: idx + 1, result: S.run.result, time: S.run.time, level: S.run.level, syn: Object.keys(S.tree.synergies).length,
    skills: Object.keys(S.tree.skills).length, kills: S.run.kills, light: S.run.light,
    gained: S.meta.roots + 0 - rootsBefore, rootsTotal: S.meta.rootsTotal, maxGap: maxGap, build: target.join('+'), upTimes: upTimes,
    hpMax: S.stats.maxHp, dmg: S.stats.dmg
  };
  if (args.indexOf('--diag') > -1) { console.log('diag s' + (idx + 1) + ': motherMinHp ' + (motherSeen ? (motherMin * 100).toFixed(0) + '%' : '-') + ' hurts ' + diag.hurts + ' avg ' + (diag.hurtSum / Math.max(1, diag.hurts)).toFixed(1) + ' xpCollected ' + diag.xp.toFixed(0) + ' orbsLeft ' + S.pickups.length + ' enemies ' + S.enemies.length + ' lvTimes ' + upTimes.slice(0, 14).join(',')); motherMin = 1; motherSeen = false; diag.hurts = 0; diag.hurtSum = 0; diag.xp = 0; console.log('  last hits: ' + hurtLog.join(' | ')); hurtLog.length = 0; }
  var spent = shop();
  rec.bought = spent; rec.rootsLeft = S.meta.roots;
  return rec;
}

if (args.indexOf('--maxed') > -1) { // what-if: all upgrades maxed, rootsTotal from --roots
  OG.meta.upgrades.forEach(function (u) { S.meta.upgrades[u.id] = u.maxRank; });
  S.meta.rootsTotal = opt('--roots', 300); S.meta.lifetimeLight = S.meta.rootsTotal * S.meta.rootsTotal * OG.cfg.meta.rootsDivisor;
}
var t0 = Date.now(), rows = [];
for (var s = 0; s < SEASONS; s++) {
  var rec = playSeason(s); rows.push(rec);
  if (!QUIET) process.stderr.write('season ' + rec.n + ' ' + rec.result + ' ' + OG.fmtTime(rec.time) + ' L' + rec.level + ' syn' + rec.syn + ' (' + ((Date.now() - t0) / 1000).toFixed(0) + 's)\n');
  OG.game.setState('title');
}

function pad(v, n) { v = String(v); while (v.length < n) v += ' '; return v; }
console.log('\nSEASON TABLE  (bot skill ' + SKILL + ', seed ' + opt('--seed', 12345) + ')');
console.log(pad('#', 3) + pad('end', 8) + pad('result', 8) + pad('level', 7) + pad('syn', 5) + pad('skills', 8) + pad('kills', 7) + pad('light', 10) + pad('+roots', 8) + pad('rootsTot', 9) + pad('maxLvGap', 9) + pad('hp', 6) + 'build');
rows.forEach(function (r) {
  console.log(pad(r.n, 3) + pad(OG.fmtTime(r.time), 8) + pad(r.result, 8) + pad(r.level, 7) + pad(r.syn, 5) + pad(r.skills, 8) + pad(r.kills, 7) + pad(OG.fmt(r.light), 10) + pad(r.gained, 8) + pad(r.rootsTotal, 9) + pad(r.maxGap.toFixed(0) + 's', 9) + pad(Math.round(r.hpMax), 6) + r.build);
});
var firstClear = rows.findIndex(function (r) { return r.result === 'clear'; });
console.log('\nfirst season ends at ' + OG.fmtTime(rows[0].time) + ' | first clear: ' + (firstClear < 0 ? 'none' : 'season ' + (firstClear + 1)) + ' | clears: ' + rows.filter(function (r) { return r.result === 'clear'; }).length + '/' + rows.length);
console.log('audio sources started: ' + audioEvents.sources + ' | stub console.error: ' + errors.length + ' | NaN/Infinity hits: ' + nanHits.length + ' | wall ' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
if (nanHits.length) console.log(nanHits.slice(0, 10).join('\n'));
if (args.indexOf('--json') > -1) fs.writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify(rows, null, 1));
process.exit(errors.length || nanHits.length ? 1 : 0);
