'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
globalThis.window = globalThis;
var events = [], ticks = [];
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
var OG = globalThis.OG = {
  bus: { on: function () {}, off: function () {}, emit: function (n, d) { events.push({ name: n, data: d }); } },
  game: { state: 'run', setState: function (s) { var f = this.state; this.state = s; events.push({ name: 'state:change', data: { from: f, to: s } }); },
    addUpdate: function (fn) { ticks.push(fn); } },
  rng: mulberry
};
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'tree.js'), 'utf8'), { filename: 'tree.js' });
var T = OG.tree, fails = 0;
function ok(c, m) { if (!c) { fails++; console.log('FAIL: ' + m); } }
function fresh(seed, bonus) {
  events.length = 0; OG.game.state = 'run';
  OG.state = { run: { time: 0 }, player: { hp: 100, maxHp: 100 }, stats: {}, tree: {}, meta: { codex: {} } };
  OG.rand = OG.rng(seed); T.reset(bonus);
}
function count(n) { return events.filter(function (e) { return e.name === n; }).length; }
function lastOffer() { for (var i = events.length - 1; i >= 0; i--) if (events[i].name === 'levelup:offer') return events[i].data.options; return null; }
function take(id) {
  if (OG.game.state !== 'levelup') T.grantLevel();
  for (var i = 0; i < 500; i++) {
    var o = lastOffer();
    if (o && o.some(function (x) { return x.id === id; })) return T.choose(id);
    if (!T.reroll()) return false;
  }
  return false;
}
function maxAll() { T.skills.forEach(function (s) { for (var r = 0; r < s.maxRank; r++) ok(take(s.id), 'take ' + s.id); }); }

// content
ok(T.skills.length === 20 && T.synergies.length === 12, 'counts');
['fire', 'wind', 'root', 'stone'].forEach(function (b) { ok(T.skills.filter(function (s) { return s.branch === b; }).length === 5, '5 skills ' + b); });
ok(T.synergies.filter(function (s) { return s.secret; }).length === 2, '2 secret');
T.skills.concat(T.synergies).forEach(function (x) {
  ok(x.name.split(' ').length <= 3, 'name<=3 words ' + x.name); ok(x.desc.length <= 60, 'desc<=60 ' + x.id + ' ' + x.desc.length);
});
ok(T.synergies.some(function (s) { return s.name === 'Lốc Lửa'; }) && T.synergies.some(function (s) { return s.name === 'Pháo Đài Sống'; }), 'named synergies');
var sk = {}; T.skills.forEach(function (s) { sk[s.id] = s; });
T.synergies.forEach(function (y) {
  var br = Object.keys(y.req).map(function (id) { ok(!!sk[id] && y.req[id] <= sk[id].maxRank, 'req valid ' + y.id); return sk[id].branch; });
  ok(br.length === 2 && br[0] !== br[1] && y.branches.indexOf(br[0]) >= 0 && y.branches.indexOf(br[1]) >= 0, 'two branches ' + y.id);
});
// synergy key stat jump 1.5..3 (isolated)
var KEYS = { loc_lua: 'burnDps', sao_bang: 'projSpeed', tro_nuoi_re: 'leech', hoa_mat_troi: 'orbitDmg', nui_lua: 'dmg', da_nung: 'thorns', duong_hoa: 'trailDmg', phan_hoa: 'chain', tang_lan: 'moveSpeed', mat_bao: 'dashDist', phao_dai_song: 'thorns', vong_hoa_da: 'orbitDmg' };
T.synergies.forEach(function (y) {
  fresh(1); OG.state.tree.skills = JSON.parse(JSON.stringify(y.req));
  var a = Object.assign({}, T.recompute()); OG.state.tree.synergies[y.id] = true; var b = T.recompute();
  var ratio = b[KEYS[y.id]] / a[KEYS[y.id]];
  ok(ratio >= 1.5 - 1e-9 && ratio <= 3 + 1e-9, 'jump ' + y.id + ' ' + ratio);
  if (y.id === 'loc_lua') ok(b.orbitCount >= 2 && b.burnDps > 0 && b.orbitDmg > 0, 'Lốc Lửa features');
  if (y.id === 'phao_dai_song') ok(b.armor > a.armor && b.thorns >= 3 * a.thorns - 1e-9 && b.rootSlow > a.rootSlow, 'Pháo Đài features');
});

// xp curve + queue of 3
fresh(2);
for (var n = 1; n < 40; n++) ok(T.xpNeed(n) === Math.round(5 * Math.pow(n, 1.6)), 'xp curve ' + n);
ok(OG.state.run.xpNext === 5, 'xpNext(1)=5');
T.addXp(49);
ok(OG.state.run.level === 4 && count('level:up') === 3 && count('levelup:offer') === 1 && OG.game.state === 'levelup', 'queue start');
T.choose(lastOffer()[0].id); ok(count('levelup:offer') === 2 && OG.game.state === 'levelup', 'queue 2nd');
T.choose(lastOffer()[0].id); ok(count('levelup:offer') === 3, 'queue 3rd');
T.choose(lastOffer()[0].id); ok(OG.game.state === 'run', 'queue done -> run');
// xpMul
fresh(3, { xpMul: 2 }); T.addXp(3); ok(OG.state.run.level === 2 && Math.abs(OG.state.run.xp - 1) < 1e-9, 'xpMul');
// grantLevel exactly one
fresh(4); T.grantLevel(); ok(OG.state.run.level === 2 && count('level:up') === 1 && count('levelup:offer') === 1 && OG.state.run.xpNext === T.xpNeed(2), 'grantLevel');
// startLevel
fresh(5, { startLevel: 3 });
ok(OG.state.run.level === 4 && count('levelup:offer') === 0, 'startLevel level, deferred');
ticks[0](1 / 60); ok(count('levelup:offer') === 1 && OG.game.state === 'levelup', 'startLevel first offer on tick');
for (var q = 0; q < 3; q++) T.choose(lastOffer()[0].id);
ok(count('levelup:offer') === 3 && OG.game.state === 'run', 'startLevel 3 offers');
// bonus fields
fresh(6, { maxHp: 50, dmgMul: 1.5, moveMul: 1.1, magnetMul: 2, lightMul: 2, rerolls: 2, choices: 1 });
var st = OG.state.stats;
ok(st.maxHp === 150 && OG.state.player.maxHp === 150 && Math.abs(st.dmg - 15) < 1e-9 && st.choices === 4 && OG.state.run.rerolls === 2 && st.lightMul === 2 && st.magnet === 140, 'bonus');
// hp ratio
fresh(7); OG.state.player.hp = 50; OG.state.tree.skills.root_hp = 1; T.recompute();
ok(Math.abs(OG.state.player.maxHp - 115) < 1e-9 && Math.abs(OG.state.player.hp - 57.5) < 1e-9, 'hp ratio');
// determinism of recompute
fresh(8); OG.state.tree.skills = { fire_dmg: 2, stone_hp: 3 }; var s1 = JSON.stringify(T.recompute()), s2 = JSON.stringify(T.recompute()); ok(s1 === s2, 'recompute deterministic');

// offers: size, no duplicates, no maxed
fresh(9, { choices: 2 }); OG.state.tree.skills = { fire_dmg: 5, fire_rate: 5, fire_ember: 5 }; T.recompute();
for (var z = 0; z < 200; z++) {
  fresh(100 + z, { choices: 2 }); OG.state.tree.skills = { fire_dmg: 5, fire_rate: 5, fire_ember: 5 }; T.recompute(); T.grantLevel();
  var o = lastOffer(), ids = o.map(function (x) { return x.id; });
  ok(o.length === 5, 'choices=5 (3+2) got ' + o.length);
  ok(new Set(ids).size === ids.length, 'no dup');
  ok(!ids.some(function (id) { return id === 'fire_dmg' || id === 'fire_rate' || id === 'fire_ember'; }), 'no maxed');
}
fresh(10); ok(true); T.grantLevel(); ok(lastOffer().length === 3, 'default 3');
// style bias
var fire = 0, tot = 0, topOther = 0;
for (var m = 0; m < 1000; m++) {
  fresh(1000 + m); T.track('fire', 5000); T.grantLevel();
  var oo = lastOffer(); oo.forEach(function (x) { tot++; if (x.branch === 'fire') fire++; });
  ok(oo.some(function (x) { return x.branch === 'fire'; }) && oo.some(function (x) { return x.branch !== 'fire'; }), 'top+other present');
}
console.log('fire share (pure fire): ' + (100 * fire / tot).toFixed(1) + '%'); ok(fire / tot >= 0.6, 'bias >= 60%');
var cf = 0, cw = 0, co = 0, ct = 0;
for (m = 0; m < 1000; m++) {
  fresh(5000 + m); T.track('fire', 50 * 100); T.track('wind', 400 * 100); T.grantLevel();
  lastOffer().forEach(function (x) { ct++; if (x.branch === 'fire') cf++; else if (x.branch === 'wind') cw++; else co++; });
}
console.log('mixed fire/wind/other: ' + (100 * cf / ct).toFixed(1) + '/' + (100 * cw / ct).toFixed(1) + '/' + (100 * co / ct).toFixed(1) + '%');
ok(cf / ct >= 0.25 && cw / ct >= 0.25 && co / ct <= 0.3, 'mixed stays mixed');
// synergy hint + weight
fresh(11); OG.state.tree.skills = { fire_ember: 3, wind_speed: 1 }; T.recompute();
var hints = 0, hintTot = 0;
for (m = 0; m < 300; m++) { fresh(7000 + m, {}); OG.state.tree.skills = { fire_ember: 3, wind_speed: 1 }; T.recompute(); T.grantLevel();
  lastOffer().forEach(function (x) { if (x.synergyHint) { hints++; ok(/^Sắp cộng hưởng: /.test(x.synergyHint), 'hint format'); ok(x.id === "wind_speed", 'hint on completer'); } }); }
ok(hints > 0, 'hints appear'); 
// reroll
fresh(12, { rerolls: 1 }); T.grantLevel(); var before = lastOffer().map(function (x) { return x.id; }).join();
ok(T.reroll() === true && T.reroll() === false && OG.state.run.rerolls === 0, 'reroll count');
ok(lastOffer().map(function (x) { return x.id; }).join() !== before, 'reroll differs');
// determinism
function script(seed) {
  fresh(seed); var log = [];
  for (var u = 0; u < 25; u++) { T.grantLevel(); var op = lastOffer(); log.push(op.map(function (x) { return x.id + x.rank + (x.synergyHint || ''); }).join('|')); T.track('wind', 800); T.choose(op[0].id); }
  return log.join('\n');
}
ok(script(77) === script(77), 'same seed identical'); ok(script(77) !== script(78), 'different seed differs');

// every synergy reachable & fires once
T.synergies.forEach(function (y) {
  fresh(300, { rerolls: 1e6 });
  for (var id in y.req) for (var r = 0; r < y.req[id]; r++) ok(take(id), 'take ' + id);
  var ev = events.filter(function (e) { return e.name === 'synergy:found' && e.data.id === y.id; });
  ok(ev.length === 1 && ev[0].data.first === true && OG.state.tree.synergies[y.id], 'reachable ' + y.id);
});
// first flag
fresh(301, { rerolls: 1e6 }); OG.state.meta.codex.sao_bang = true; take('fire_multi'); take('fire_multi'); take('wind_proj'); take('wind_proj');
var sf = events.filter(function (e) { return e.name === 'synergy:found' && e.data.id === 'sao_bang'; }); ok(sf.length === 1 && sf[0].data.first === false, 'first=false');
// everything maxed
fresh(302, { rerolls: 1e6 }); maxAll();
ok(count('synergy:found') === 12, 'all 12 found exactly once: ' + count('synergy:found'));
var all = OG.state.stats;
for (var k in all) ok(typeof all[k] === 'number' && isFinite(all[k]), 'finite ' + k);
ok(all.dmg > 0 && all.dmg < 1000 && all.maxHp > 100 && all.maxHp < 3000 && all.rootSlow <= 0.8 && all.crit <= 0.95 && all.dashCd >= 0.5 && all.moveSpeed > 50 && all.moveSpeed <= 500 && all.fireRate < 20 && all.armor < 100 && all.orbitCount <= 12 && all.choices === 3, 'sane maxed stats');
console.log('maxed stats: ' + JSON.stringify(all));
var lv = events.length; T.grantLevel(); ok(events.slice(lv).every(function (e) { return e.name !== 'levelup:offer'; }) && OG.game.state === 'run', 'no offer when all maxed');
// branch:grow throttle
fresh(303); for (var tk = 0; tk < 120; tk++) { T.track('fire', 100); T.track('wind', 800); ticks[0](1 / 60); }
var g = count('branch:grow'); console.log('branch:grow in 2s: ' + g); ok(g > 0 && g <= 9, 'grow throttle');
// normalisation
fresh(304); T.track('fire', 50); T.track('wind', 400); T.track('root', 5); T.track('stone', 2);
var gr = OG.state.tree.growth; ok(gr.fire === 1 && gr.wind === 1 && gr.root === 1 && gr.stone === 1, 'norm');

console.log('\nid | branch | name | desc');
T.skills.forEach(function (s) { console.log([s.id, s.branch, s.name, s.desc].join(' | ')); });
T.synergies.forEach(function (y) { console.log([y.id, y.branches.join('+') + (y.secret ? ' (bí mật)' : ''), y.name, y.desc].join(' | ')); });
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED'); process.exit(fails ? 1 : 0);
