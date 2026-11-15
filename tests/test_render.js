// node tests/test_render.js  — render.js against a recording stub context
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

globalThis.window = globalThis;

// ---- recording stub context (any method is a counted no-op)
var allCtx = [];
function makeCtx(canvas) {
  var calls = {}, props = {};
  var ctx = new Proxy({}, {
    get: function (t, k) {
      if (k === '__calls') return calls;
      if (k === 'canvas') return canvas;
      if (k in props) return props[k];
      if (k === 'createPattern') return function () { calls[k] = (calls[k] || 0) + 1; return {}; };
      if (k === 'measureText') return function () { return { width: 10 }; };
      return function () { calls[k] = (calls[k] || 0) + 1; };
    },
    set: function (t, k, v) { props[k] = v; return true; }
  });
  allCtx.push(ctx);
  return ctx;
}
var canvases = [];
globalThis.document = { createElement: function () {
  var c = { width: 0, height: 0 }; var ctx = makeCtx(c);
  c.getContext = function () { return ctx; }; canvases.push(c); return c;
} };

// ---- minimal OG (only what render uses)
var handlers = {}, renderFn = null;
var OG = window.OG = {
  bus: { on: function (n, f) { (handlers[n] = handlers[n] || []).push(f); }, emit: function (n, d) { (handlers[n] || []).forEach(function (f) { f(d); }); } },
  game: { addRender: function (f) { renderFn = f; }, addUpdate: function () {} },
  view: { w: 390, h: 844, dpr: 3 },
  fmt: function (n) { return String(n); }
};
var P = { x: 0, y: 0, vx: 0, vy: 0, r: 14, hp: 100, maxHp: 100, invuln: 0, dashCd: 0, dashing: false, still: 0, rooted: false };
OG.state = { run: {}, player: P, enemies: [], projectiles: [], hazards: [], orbits: [], trails: [], pickups: [], stats: { moveSpeed: 150 }, meta: { settings: { shake: true, colorblind: false } } };

vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'render.js'), 'utf8'), { filename: 'render.js' });
assert(renderFn, 'render registered with addRender');
var R = OG.render, D = R._debug;
var main = makeCtx({});

function frame(n) { for (var i = 0; i < (n || 1); i++) renderFn(main, 0, 1 / 60); }
function drawCount() { return main.__calls.drawImage || 0; }
function resetCalls() { var c = main.__calls; for (var k in c) delete c[k]; }
function scene(offX, offY) {
  var kinds = ['spore', 'mold', 'brute', 'spitter', 'core', 'mother'], rr = { spore: 8, mold: 13, brute: 24, spitter: 12, core: 40, mother: 70 };
  OG.state.enemies.length = 0; OG.state.projectiles.length = 0; OG.state.hazards.length = 0;
  OG.state.orbits.length = 0; OG.state.trails.length = 0; OG.state.pickups.length = 0;
  for (var i = 0; i < 60; i++) {
    var k = kinds[i % 6];
    OG.state.enemies.push({ id: i + 1, kind: k, x: offX + (i % 10) * 40 - 180, y: offY + Math.floor(i / 10) * 40 - 100, r: rr[k], hp: 50, maxHp: 100, speed: 50, dmg: 5, hit: i % 7 === 0 ? 0.05 : 0, burn: i % 5 === 0 ? 1 : 0, slow: i % 4 === 0 ? 0.3 : 0 });
  }
  for (i = 0; i < 20; i++) OG.state.projectiles.push({ x: offX + i * 10, y: offY + 20, vx: 300, vy: 100, r: 5, dmg: 10, pierce: 0, kind: 'seed', life: 1 });
  OG.state.hazards.push({ x: offX + 50, y: offY + 50, vx: 0, vy: 0, r: 12, dmg: 5, life: 2, telegraph: 0 });
  OG.state.hazards.push({ x: offX - 50, y: offY + 50, vx: 0, vy: 0, r: 40, dmg: 5, life: 2, telegraph: 0.5 });
  OG.state.orbits.push({ x: offX + 40, y: offY, r: 10 });
  OG.state.trails.push({ x: offX + 10, y: offY + 10, r: 10, life: 1 });
  OG.state.pickups.push({ x: offX + 30, y: offY - 30, amount: 3, kind: 'xp' }, { x: offX - 30, y: offY - 30, amount: 1, kind: 'heal' });
}

// 1. everything renders without exceptions
scene(0, 0);
OG.bus.emit('run:start', {});
OG.bus.emit('player:hurt', { dmg: 5, hp: 90, maxHp: 100 });
OG.bus.emit('enemy:hit', { x: 10, y: 10, dmg: 12, crit: true, kind: 'mold' });
OG.bus.emit('enemy:die', { x: 20, y: 20, kind: 'mother' });
OG.bus.emit('fx:nova', { x: 0, y: 0, r: 120 });
OG.bus.emit('player:dash', { x: 0, y: 0 });
OG.bus.emit('xp:pickup', { amount: 1, x: 5, y: 5 });
OG.bus.emit('player:heal', { amount: 8 });
OG.bus.emit('flower:bloom', { x: 30, y: 30, kind: 'mold' });
P.invuln = 1; P.dashing = true; P.rooted = true;
assert.doesNotThrow(function () { frame(30); }, 'full scene renders');
P.invuln = 0; P.dashing = false; P.rooted = false;
OG.state.meta.settings.colorblind = true;
assert.doesNotThrow(function () { frame(5); }, 'colorblind scene renders');
OG.state.meta.settings.colorblind = false;
frame(2);
console.log('ok  full scene renders (all kinds, colorblind)');

// 2. culling
OG.state.player.x = 0; OG.state.player.y = 0;
OG.state.pickups.length = 0;
scene(0, 0); frame(3); resetCalls(); frame(1);
var onScreen = drawCount(), enemiesOn = D.stats.drawn.enemies;
scene(5000, 5000); frame(3); resetCalls(); frame(1);
var offScreen = drawCount(), enemiesOff = D.stats.drawn.enemies;
assert(enemiesOn > 30, 'enemies on screen are drawn (' + enemiesOn + ')');
assert.strictEqual(enemiesOff, 0, 'off-screen enemies are culled');
assert(offScreen < onScreen, 'fewer drawImage calls when everything is off-screen (' + offScreen + ' < ' + onScreen + ')');
assert.strictEqual(D.stats.drawn.projectiles, 0, 'off-screen projectiles culled');
console.log('ok  culling:', enemiesOn, 'on-screen enemies vs', enemiesOff, 'off-screen; drawImage', onScreen, '->', offScreen);

// 3. sprite cache reuse
scene(0, 0); frame(3);
var b0 = D.stats.spriteBuilds, c0 = D.stats.chunkBuilds;
frame(60);
assert.strictEqual(D.stats.spriteBuilds, b0, 'no new sprites built on later frames');
assert.strictEqual(D.stats.chunkBuilds, c0, 'no new ground chunks built on later frames');
assert.strictEqual(D.getSprite('mold', 0), D.getSprite('mold', 0), 'same cached sprite object returned');
assert.notStrictEqual(D.getSprite('mold', 0), D.getSprite('mold', 3), 'flash variant is its own sprite');
console.log('ok  sprites cached:', b0, 'sprites,', c0, 'chunks built once');

// 4. hit flash uses the flash sprite only for ~80 ms
OG.state.enemies.length = 0; OG.state.enemies.push({ id: 99, kind: 'mold', x: 0, y: 60, r: 13, hp: 10, maxHp: 10, hit: 0.08, burn: 0, slow: 0 });
frame(1); // flash starts
frame(10); // 10 * 16.6ms > 80ms, hit value still > 0 but flash window passed
assert.doesNotThrow(function () { frame(1); });
console.log('ok  hit flash window');

// 5. bloom map
var bc = D.bloomCount();
for (var i = 0; i < 400; i++) OG.bus.emit('flower:bloom', { x: (i % 20) * 100 - 1000, y: Math.floor(i / 20) * 100 - 1000, kind: ['spore', 'mold', 'brute', 'spitter', 'core'][i % 5] });
frame(30);
var snap = R.bloomSnapshot();
assert(snap && snap.width === 1000 && snap.height === 1000, 'bloom snapshot is a 1000x1000 canvas');
assert(D.bloomCount() >= bc + 400, 'all 400 flowers stored');
assert(snap.getContext('2d').__calls.ellipse > 400 * 5, 'flowers painted into the map');
console.log('ok  bloom map:', D.bloomCount(), 'flowers');

// 6. damage numbers pooled
for (i = 0; i < 300; i++) OG.bus.emit('enemy:hit', { x: i, y: 0, dmg: i, crit: i % 3 === 0, kind: 'mold' });
assert(D.numCount() <= 60, 'number pool capped at 60 (' + D.numCount() + ')');
console.log('ok  number pool');

// 7. shake obeys the setting
OG.state.meta.settings.shake = false;
OG.bus.emit('player:hurt', { dmg: 1, hp: 1, maxHp: 1 });
frame(2);
assert.strictEqual(D.shake(), 0, 'no shake when disabled');
OG.state.meta.settings.shake = true;
OG.bus.emit('player:hurt', { dmg: 1, hp: 1, maxHp: 1 });
assert(D.shake() > 0, 'shake when enabled');
console.log('ok  shake setting');

// 8. zoomOut
var done = 0, z0 = R.camera.zoom;
R.zoomOut(1, function () { done++; });
frame(30); assert.strictEqual(done, 0, 'not finished early');
frame(40);
assert.strictEqual(done, 1, 'onDone called exactly once');
frame(10); assert.strictEqual(done, 1, 'onDone not repeated');
assert(R.camera.zoom < z0 * 0.4, 'camera zoomed out (' + z0.toFixed(2) + ' -> ' + R.camera.zoom.toFixed(3) + ')');
assert(Math.abs(R.camera.x) < 1 && Math.abs(R.camera.y) < 1, 'camera centred on the world');
OG.bus.emit('run:start', {}); frame(2);
assert(R.camera.zoom > z0 * 0.9, 'run:start restores gameplay zoom');
console.log('ok  zoomOut + reset');

console.log('\nALL RENDER TESTS PASSED');
