// node tests/test_audio.js - audio.js against a Web Audio stub. Exit code 0 = pass.
'use strict';
var fs = require('fs'), vm = require('vm'), path = require('path');
var fails = 0;
function ok(c, m) { if (!c) { fails++; console.log('FAIL ' + m); } else console.log('ok   ' + m); }

function makeEnv(opts) {
  opts = opts || {};
  var env = { time: 0, created: { buffers: 0, sources: 0, osc: 0 }, started: 0, listeners: {}, resumed: 0 };
  function Param(v) { this.value = v || 0; }
  Param.prototype.setValueAtTime = function (v) { this.value = v; };
  Param.prototype.linearRampToValueAtTime = function () {};
  Param.prototype.exponentialRampToValueAtTime = function () {};
  Param.prototype.cancelScheduledValues = function () {};
  Param.prototype.setTargetAtTime = function (v) { this.value = v; };
  function Node() { this.connect = function (n) { return n; }; }
  function Ctx() {
    this.sampleRate = 8000; this.destination = new Node(); this.state = opts.suspended ? 'suspended' : 'running';
    Object.defineProperty(this, 'currentTime', { get: function () { return env.time; } });
    this.resume = function () { env.resumed++; this.state = 'running'; return Promise.resolve(); };
    this.suspend = function () { this.state = 'suspended'; };
  }
  Ctx.prototype.createGain = function () { var n = new Node(); n.gain = new Param(1); return n; };
  Ctx.prototype.createBiquadFilter = function () { var n = new Node(); n.frequency = new Param(); n.Q = new Param(); n.gain = new Param(); return n; };
  Ctx.prototype.createDynamicsCompressor = function () { var n = new Node(); ['threshold', 'knee', 'ratio', 'attack', 'release'].forEach(function (k) { n[k] = new Param(); }); return n; };
  Ctx.prototype.createConvolver = function () { return new Node(); };
  Ctx.prototype.createWaveShaper = function () { return new Node(); };
  Ctx.prototype.createBuffer = function (ch, len) { env.created.buffers++; var d = new Float32Array(len); return { getChannelData: function () { return d; }, duration: len / 8000 }; };
  Ctx.prototype.createBufferSource = function () { env.created.sources++; var n = new Node(); n.playbackRate = new Param(1); n.start = function () { env.started++; }; n.stop = function () {}; return n; };
  Ctx.prototype.createOscillator = function () { env.created.osc++; var n = new Node(); n.frequency = new Param(); n.start = function () { env.started++; }; n.stop = function () {}; return n; };
  var handlers = {};
  env.OG = { cfg: {}, state: { meta: { settings: { mute: false, volume: 0.8 } } }, bus: {
    on: function (n, f) { (handlers[n] = handlers[n] || []).push(f); },
    off: function () {},
    emit: function (n, d) { (handlers[n] || []).slice().forEach(function (f) { f(d); }); } } };
  var win = { OG: env.OG, AudioContext: opts.noAudio ? undefined : Ctx, addEventListener: function (n, f) { (env.listeners[n] = env.listeners[n] || []).push(f); }, removeEventListener: function () {} };
  var sandbox = { window: win, document: { hidden: false, addEventListener: function (n, f) { env.listeners[n] = (env.listeners[n] || []).concat([f]); } }, console: console, Math: Math, Float32Array: Float32Array, Promise: Promise };
  sandbox.globalThis = sandbox; vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'audio.js'), 'utf8'), sandbox, { filename: 'audio.js' });
  env.audio = env.OG.audio; env.bus = env.OG.bus;
  // spy on plays
  env.log = []; var orig = env.audio.play;
  return env;
}
function names(env) { return env.audio.stats().played; }

// 1. load without audio support never throws
var e0 = makeEnv({ noAudio: true });
e0.bus.emit('boot'); e0.audio.unlock(); e0.bus.emit('player:shoot', {}); e0.audio.setMuted(true);
ok(e0.audio.stats().played === 0, 'no AudioContext: no throw, nothing played');

// 2. nothing before unlock
var e = makeEnv();
e.bus.emit('boot'); e.bus.emit('player:shoot', {});
ok(names(e) === 0, 'events before unlock are ignored');
ok(e.listeners.pointerdown && e.listeners.visibilitychange, 'boot hooks first-gesture unlock and visibilitychange');
e.audio.unlock();
var buffersAfterUnlock = e.created.buffers;
ok(buffersAfterUnlock >= 4, 'noise + reverb buffers pre-rendered at unlock (' + buffersAfterUnlock + ')');
e.audio.unlock();
ok(e.created.buffers === buffersAfterUnlock, 'unlock is idempotent');

// 3. every event maps to the right sound
var map = [
  ['player:shoot', {}, 'seed_pop'], ['enemy:hit', { crit: false, kind: 'mold' }, 'squelch'], ['enemy:hit', { crit: true }, 'squelch_crit'],
  ['enemy:die', { kind: 'spore' }, 'bloom'], ['xp:pickup', { amount: 1 }, 'xp_tick'], ['level:up', { level: 2 }, 'level_up'],
  ['skill:gain', { branch: 'fire' }, 'skill_fire'], ['skill:gain', { branch: 'wind' }, 'skill_wind'], ['skill:gain', { branch: 'root' }, 'skill_root'], ['skill:gain', { branch: 'stone' }, 'skill_stone'],
  ['synergy:found', { branches: ['fire', 'root'], first: true }, 'synergy'], ['player:hurt', { dmg: 5 }, 'hurt'], ['player:dash', {}, 'dash'], ['fx:nova', {}, 'nova'],
  ['boss:spawn', { kind: 'core' }, 'boss_spawn'], ['boss:dead', { kind: 'mother' }, 'boss_dead'], ['run:end', { result: 'death' }, 'run_end'],
  ['player:revive', {}, 'revive'], ['ui:click', {}, 'ui_click'], ['ui:hover', {}, 'ui_hover']
];
var origPlay = e.audio.play, seen = [];
// wrap via stats delta: after each event advance time so throttles never interfere
map.forEach(function (m) {
  e.env = e; e.time += 5;
  var before = e.audio.stats().played;
  e.bus.emit(m[0], m[1]);
  ok(e.audio.stats().played === before + 1, m[0] + ' -> ' + m[2]);
  ok(e.audio.names.indexOf(m[2]) > -1, 'sound exists: ' + m[2]);
});
// every contract event in the requirements has a handler
['player:shoot', 'enemy:hit', 'enemy:die', 'xp:pickup', 'level:up', 'skill:gain', 'synergy:found', 'player:hurt', 'player:dash', 'fx:nova', 'boss:spawn', 'boss:dead', 'run:end', 'player:revive', 'ui:click', 'ui:hover', 'settings:change', 'game:pause', 'game:resume']
  .forEach(function (n) { ok(e.audio.events.indexOf(n) > -1, 'handler for ' + n); });
ok(e.audio.names.length === 20, 'sound count ' + e.audio.names.length);

// 4. throttling: shoot max 12/s and 4 voices
function burst(env, ev, data, count, seconds) {
  var s0 = env.audio.stats().played, i;
  for (i = 0; i < count; i++) { env.time += seconds / count; env.bus.emit(ev, data); }
  return env.audio.stats().played - s0;
}
e.time += 10;
var n1 = burst(e, 'player:shoot', {}, 120, 1);     // 120 shots in 1 s of game time
ok(n1 <= 12, 'player:shoot throttled to <=12/s (got ' + n1 + ')');
ok(n1 >= 9, 'player:shoot still plays about 12/s (got ' + n1 + ')');
e.time += 10; var same0 = e.audio.stats().played;
for (var i = 0; i < 50; i++) e.bus.emit('player:shoot', {});     // same instant
ok(e.audio.stats().played - same0 <= 1, 'same-instant shots collapse to one');
e.time += 10;
var cap = 0; for (i = 0; i < 30; i++) { e.time += 0.09; e.bus.emit('player:shoot', {}); cap = Math.max(cap, e.audio.stats().voices); }
ok(cap <= 4, 'shoot voices never exceed 4 (peak ' + cap + ')');

// 5. 300 simultaneous deaths
e.time += 10; var d0 = e.audio.stats().played;
for (i = 0; i < 300; i++) e.bus.emit('enemy:die', { kind: 'spore' });
ok(e.audio.stats().played - d0 <= 1, '300 deaths at one instant start <=1 sound');
e.time += 10; d0 = e.audio.stats().played; var maxV = 0;
for (i = 0; i < 300; i++) { e.time += 0.004; e.bus.emit('enemy:die', { kind: 'mold' }); maxV = Math.max(maxV, e.audio.stats().voices); }
ok(e.audio.stats().played - d0 < 60, '300 deaths in 1.2 s -> ' + (e.audio.stats().played - d0) + ' sounds');
ok(maxV <= 28, 'total voices stay <= 28 (peak ' + maxV + ')');
// mixed storm
e.time += 10; maxV = 0;
var evs = ['enemy:hit', 'enemy:die', 'xp:pickup', 'player:shoot', 'fx:nova', 'player:hurt', 'skill:gain', 'level:up'];
for (i = 0; i < 2000; i++) { e.time += 0.002; e.bus.emit(evs[i % evs.length], { branch: 'fire', kind: 'mold' }); maxV = Math.max(maxV, e.audio.stats().voices); }
ok(maxV <= 28, 'mixed storm keeps voices <= 28 (peak ' + maxV + ')');

// 6. nothing allocated per play
var b0 = e.created.buffers; for (i = 0; i < 200; i++) { e.time += 0.2; e.bus.emit('enemy:hit', {}); e.bus.emit('player:hurt', {}); }
ok(e.created.buffers === b0, 'no buffers allocated while playing');

// 7. xp streak rises and resets after 0.6 s
e.time += 10; e.bus.emit('xp:pickup', {}); var s1 = e.audio.stats().streak;
e.time += 0.1; e.bus.emit('xp:pickup', {}); e.time += 0.1; e.bus.emit('xp:pickup', {});
ok(e.audio.stats().streak === s1 + 2, 'xp streak climbs (' + e.audio.stats().streak + ')');
e.time += 0.5; e.bus.emit('xp:pickup', {});
ok(e.audio.stats().streak === s1 + 3, 'xp streak survives a 0.5 s gap');
e.time += 0.7; e.bus.emit('xp:pickup', {});
ok(e.audio.stats().streak === 0, 'xp streak resets after 0.6 s');

// 8. mute, volume, pause duck
e.time += 10;
var vol = e.audio.stats().gain; ok(Math.abs(vol - 0.8 * e.OG.cfg.audio.master) < 1e-9, 'master gain follows volume 0.8 (' + vol + ')');
e.bus.emit('settings:change', { settings: { mute: false, volume: 0.4, shake: true } });
ok(Math.abs(e.audio.stats().gain - 0.4 * e.OG.cfg.audio.master) < 1e-9, 'settings:change sets volume 0.4');
e.bus.emit('game:pause');
ok(Math.abs(e.audio.stats().gain - 0.4 * e.OG.cfg.audio.master * 0.3) < 1e-9, 'game:pause ducks to 30%');
e.bus.emit('game:resume');
ok(Math.abs(e.audio.stats().gain - 0.4 * e.OG.cfg.audio.master) < 1e-9, 'game:resume restores');
e.bus.emit('settings:change', { settings: { mute: true, volume: 0.4 } });
e.time += 10; var m0 = e.audio.stats().played, st0 = e.started;
['player:shoot', 'level:up', 'synergy:found', 'ui:click'].forEach(function (n) { e.time += 1; e.bus.emit(n, { branches: ['fire', 'wind'] }); });
ok(e.audio.stats().played === m0 && e.started === st0 && e.audio.stats().gain === 0, 'mute: no sound starts, gain 0');
e.audio.setMuted(false); e.time += 1; e.bus.emit('ui:click');
ok(e.audio.stats().played === m0 + 1, 'unmute plays again');
e.audio.setVolume(0); e.time += 1; e.bus.emit('ui:click');
ok(e.audio.stats().played === m0 + 1, 'volume 0 plays nothing');
e.audio.setVolume(0.8);

// 9. synergy layers both branch textures (more nodes than a skill sound)
e.time += 10; var sA = e.started; e.bus.emit('synergy:found', { branches: ['fire', 'wind'], first: false }); var synNodes = e.started - sA;
e.time += 10; sA = e.started; e.bus.emit('skill:gain', { branch: 'fire' }); var skNodes = e.started - sA;
ok(synNodes > skNodes * 2, 'synergy is much richer than a skill sound (' + synNodes + ' vs ' + skNodes + ' sources)');

// 10. suspended context: resume attempted, nothing thrown
var e2 = makeEnv({ suspended: true }); e2.bus.emit('boot'); e2.audio.unlock();
e2.OG.audio.unlock();
ok(e2.resumed >= 1, 'unlock resumes a suspended context');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall tests passed');
process.exit(fails ? 1 : 0);
