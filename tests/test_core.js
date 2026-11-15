// node tests/test_core.js  — exit 0 = pass
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

// ---- tiny DOM stubs ----
globalThis.window = globalThis;
var handlers = {};
function addL(type, fn) { (handlers[type] = handlers[type] || []).push(fn); }
function fire(type, ev) { ev = ev || {}; ev.type = type; (handlers[type] || []).forEach(function (f) { f(ev); }); return ev; }
globalThis.addEventListener = addL;
function el(tag) {
  return { tagName: tag, style: {}, children: [], addEventListener: addL,
    appendChild: function (c) { this.children.push(c); },
    getContext: function () { return { setTransform: function () {} }; },
    closest: function () { return null; } };
}
var byId = {};
globalThis.document = {
  body: el('BODY'), documentElement: el('HTML'), hidden: false, visibilityState: 'visible',
  addEventListener: addL,
  getElementById: function (id) { return byId[id] || null; },
  createElement: function (tag) {
    var e = el(tag.toUpperCase());
    Object.defineProperty(e, 'id', { set: function (v) { byId[v] = e; }, get: function () { return ''; } });
    return e;
  }
};
globalThis.innerWidth = 800; globalThis.innerHeight = 600; globalThis.devicePixelRatio = 3;
var rafCb = null;
globalThis.requestAnimationFrame = function (cb) { rafCb = cb; return 1; };
var timers = [], tid = 0;
globalThis.setTimeout = function (fn, ms) { timers.push({ id: ++tid, fn: fn, ms: ms }); return tid; };
globalThis.clearTimeout = function (id) { timers = timers.filter(function (x) { return x.id !== id; }); };
function runTimers() { var a = timers; timers = []; a.forEach(function (x) { x.fn(); }); }
var errLog = [];
console.error = function () { errLog.push([].slice.call(arguments)); };
var store = {};
globalThis.localStorage = {
  getItem: function (k) { return k in store ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); }
};

vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8'), { filename: 'core.js' });
var OG = window.OG;

var passed = 0;
function t(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.log('FAIL: ' + name + '\n  ' + (e && e.stack || e)); process.exitCode = 1; }
}
var T = 0;
function frameAt(ms) { rafCb(ms); }

// ---- state shape ----
t('state shape', function () {
  var s = OG.state;
  ['run', 'player', 'enemies', 'projectiles', 'hazards', 'orbits', 'trails', 'pickups', 'stats', 'tree', 'meta']
    .forEach(function (k) { assert(k in s, k); });
  assert.strictEqual(s.player.r, 14);
  assert.deepStrictEqual(s.meta.settings,
    { mute: false, volume: 0.8, shake: true, colorblind: false, relax: false, hints: { move: false, tree: false } });
  assert.strictEqual(s.stats.choices, 3);
  assert.strictEqual(OG.game.state, 'title');
  assert.strictEqual(typeof OG.rand(), 'number');
});

// ---- bus ----
t('bus on/off/emit (off during emit is safe)', function () {
  var got = [];
  function a(d) { got.push(['a', d]); }
  function b(d) { got.push(['b', d]); OG.bus.off('x', b); }
  OG.bus.on('x', a); OG.bus.on('x', b);
  OG.bus.emit('x', 1); OG.bus.emit('x', 2);
  assert.deepStrictEqual(got, [['a', 1], ['b', 1], ['a', 2]]);
  OG.bus.off('x', a); OG.bus.emit('x', 3);
  assert.strictEqual(got.length, 3);
  OG.bus.emit('nobody', 1);
});
t('bus listener exception isolated, logged once', function () {
  errLog.length = 0; var ok = 0;
  OG.bus.on('boom', function () { throw new Error('x'); });
  OG.bus.on('boom', function () { ok++; });
  OG.bus.emit('boom'); OG.bus.emit('boom'); OG.bus.emit('boom');
  assert.strictEqual(ok, 3); assert.strictEqual(errLog.length, 1);
});

// ---- state:change ----
t('setState emits state:change, game:pause, game:resume', function () {
  var ev = [];
  var f1 = function (d) { ev.push(d.from + '>' + d.to); }, f2 = function () { ev.push('pause'); }, f3 = function () { ev.push('resume'); };
  OG.bus.on('state:change', f1); OG.bus.on('game:pause', f2); OG.bus.on('game:resume', f3);
  OG.game.setState('run'); OG.game.setState('run'); OG.game.setState('bogus');
  OG.game.setState('paused'); OG.game.setState('run'); OG.game.setState('title');
  OG.bus.off('state:change', f1); OG.bus.off('game:pause', f2); OG.bus.off('game:resume', f3);
  assert.deepStrictEqual(ev, ['title>run', 'run>paused', 'pause', 'paused>run', 'resume', 'run>title']);
});

// ---- hooks (registered before boot so the loop sees them) ----
var counter = { n: 0 }, renders = { n: 0, alpha: [], dt: [] }, order = [];
OG.game.addUpdate(function () { counter.n++; }, 1000);
OG.game.addRender(function (ctx, a, dt) { renders.n++; renders.alpha.push(a); renders.dt.push(dt); assert(ctx); }, 1000);

// ---- boot ----
var resizes = [], bootCount = 0;
OG.bus.on('resize', function (d) { resizes.push(d); });
OG.bus.on('boot', function () { bootCount++; });
t('boot: canvas in #app, idempotent, dpr capped at 2', function () {
  OG.boot(); OG.boot();
  assert.strictEqual(bootCount, 1);
  assert(OG.canvas && OG.ctx && byId.app && byId.game);
  assert.strictEqual(byId.app.children[0], byId.game);
  assert.deepStrictEqual(OG.view, { w: 800, h: 600, dpr: 2 });
  assert.strictEqual(OG.canvas.width, 1600);
  assert.strictEqual(OG.canvas.style.touchAction, 'none');
  assert(rafCb, 'loop started');
});
t('resize emits only on change', function () {
  var n = resizes.length;
  fire('resize'); assert.strictEqual(resizes.length, n);
  globalThis.innerWidth = 400; globalThis.innerHeight = 800; fire('resize');
  assert.strictEqual(resizes.length, n + 1);
  assert.deepStrictEqual(resizes[n], { w: 400, h: 800, dpr: 2 });
  globalThis.innerWidth = 800; globalThis.innerHeight = 600; fire('resize');
});

// ---- loop math ----
[30, 60, 144].forEach(function (fps) {
  t('loop: 1 s at ' + fps + ' fps -> 60 updates +-1', function () {
    OG.game.setState('title'); T += 1000; frameAt(T);
    OG.game.setState('run');
    var before = counter.n;
    for (var i = 0; i < fps; i++) { T += 1000 / fps; frameAt(T); }
    var d = counter.n - before;
    assert(Math.abs(d - 60) <= 1, 'got ' + d);
  });
});
t('loop: catch-up capped at 5 steps, alpha in [0,1)', function () {
  OG.game.setState('run'); T += 1000 / 60; frameAt(T);
  var before = counter.n; T += 5000; frameAt(T);
  assert.strictEqual(counter.n - before, 5);
  renders.alpha.forEach(function (a) { assert(a >= 0 && a < 1, 'alpha ' + a); });
  assert(renders.dt[renders.dt.length - 1] <= 0.25 + 1e-9);
});
t('loop: no updates outside run, renders in every state', function () {
  ['title', 'paused', 'levelup', 'winter'].forEach(function (s) {
    OG.game.setState(s);
    var u = counter.n, r = renders.n;
    T += 100; frameAt(T); T += 100; frameAt(T);
    assert.strictEqual(counter.n, u, s); assert.strictEqual(renders.n, r + 2, s);
  });
});

// ---- hook order & exception isolation ----
t('hooks: sorted by order (stable), exception isolated and logged once per hook', function () {
  var seq = [];
  OG.game.addUpdate(function () { seq.push('c5'); }, 5);
  OG.game.addUpdate(function () { seq.push('a-1'); }, -1);
  OG.game.addUpdate(function () { throw new Error('bad'); }, 2);
  OG.game.addUpdate(function () { seq.push('b2'); }, 2);
  OG.game.addUpdate(function () { seq.push('d5'); }, 5);
  OG.game.addRender(function () { throw new Error('rbad'); }, -5);
  errLog.length = 0;
  OG.game.setState('title'); T += 1000; frameAt(T); OG.game.setState('run');
  T += 1000 / 60; frameAt(T); T += 1000 / 60; frameAt(T); T += 1000 / 60; frameAt(T);
  assert.deepStrictEqual(seq.slice(0, 4), ['a-1', 'b2', 'c5', 'd5']);
  assert(seq.length >= 8, 'loop kept running');
  assert.strictEqual(errLog.length, 2, 'one log for the update hook, one for the render hook');
  var r = renders.n; T += 20; frameAt(T); assert.strictEqual(renders.n, r + 1);
});
t('hooks: state change mid-run stops further ticks', function () {
  var n = 0, armed = true;
  OG.game.addUpdate(function () { if (!armed) return; n++; OG.game.setState('levelup'); }, 2000);
  OG.game.setState('title'); T += 1000; frameAt(T); OG.game.setState('run');
  T += 100; frameAt(T);
  assert.strictEqual(n, 1); assert.strictEqual(OG.game.state, 'levelup');
  armed = false;
});

// ---- input ----
function key(code, extra) { var e = { code: code, target: null, preventDefault: function () { this.prevented = true; } }; for (var k in extra) e[k] = extra[k]; return e; }
function ptr(type, id, x, y, kind, extra) { var e = { pointerId: id, clientX: x, clientY: y, pointerType: kind, button: 0, target: null }; for (var k in extra) e[k] = extra[k]; return fire(type, e); }
function runState() { OG.game.setState('title'); OG.game.setState('run'); }

t('input: keyboard move, diagonal normalised, dash lasts one tick', function () {
  runState();
  fire('keydown', key('KeyD'));
  T += 1000 / 60 + 1; frameAt(T);
  assert.deepStrictEqual([OG.input.move.x, OG.input.move.y], [1, 0]);
  fire('keydown', key('KeyW'));
  T += 1000 / 60 + 1; frameAt(T);
  assert(Math.abs(Math.hypot(OG.input.move.x, OG.input.move.y) - 1) < 1e-9);
  assert(OG.input.move.y < 0);
  fire('keyup', key('KeyD')); fire('keyup', key('KeyW'));
  var seen = [];
  OG.game.addUpdate(function () { seen.push(OG.input.dash); }, 3000);
  var e = key('Space'); fire('keydown', e); assert(e.prevented);
  T += 1000 / 60 + 1; frameAt(T); T += 1000 / 60 + 1; frameAt(T);
  assert.deepStrictEqual(seen.slice(-2), [true, false]);
  fire('keyup', key('Space'));
  OG.input.pressDash(); T += 1000 / 60 + 1; frameAt(T);
  assert.strictEqual(seen[seen.length - 1], true);
  fire('keyup', key('KeyA'));
});
t('input: Esc / P toggle run <-> paused, repeat ignored', function () {
  runState();
  fire('keydown', key('Escape')); assert.strictEqual(OG.game.state, 'paused');
  fire('keydown', key('Escape', { repeat: true })); assert.strictEqual(OG.game.state, 'paused');
  fire('keydown', key('KeyP')); assert.strictEqual(OG.game.state, 'run');
  OG.game.setState('title'); fire('keydown', key('Escape')); assert.strictEqual(OG.game.state, 'title');
});
t('input: auto-pause on blur and on visibility hidden', function () {
  runState(); fire('blur'); assert.strictEqual(OG.game.state, 'paused');
  runState(); document.hidden = true; document.visibilityState = 'hidden'; fire('visibilitychange');
  assert.strictEqual(OG.game.state, 'paused');
  document.hidden = false; document.visibilityState = 'visible'; fire('visibilitychange');
  assert.strictEqual(OG.game.state, 'paused', 'no auto-resume');
});
t('input: floating joystick, dead zone, left 60% only, .ui-block ignored', function () {
  runState();
  ptr('pointerdown', 1, 600, 300, 'touch');            // 600 > 0.6*800 = 480: ignored
  assert.strictEqual(OG.input.stick.active, false);
  ptr('pointerdown', 2, 300, 300, 'touch', { target: { closest: function (s) { return s === '.ui-block' ? {} : null; } } });
  assert.strictEqual(OG.input.stick.active, false);
  ptr('pointerdown', 3, 300, 300, 'touch');
  var s = OG.input.stick;
  assert(s.active && s.ox === 300 && s.oy === 300);
  ptr('pointermove', 3, 305, 300, 'touch');            // 5/60 = 0.083 < 0.12
  assert.deepStrictEqual([OG.input.move.x, OG.input.move.y], [0, 0]);
  ptr('pointermove', 3, 500, 300, 'touch');            // far right, clamped
  assert.strictEqual(s.x, 360); assert.strictEqual(OG.input.move.x, 1);
  ptr('pointermove', 3, 300, 330, 'touch');            // 0.5 down
  assert(OG.input.move.y > 0.3 && OG.input.move.y < 0.5 && OG.input.move.x === 0);
  ptr('pointermove', 9, 100, 100, 'touch');            // other finger ignored
  assert(OG.input.move.y > 0.3);
  ptr('pointerup', 3, 300, 330, 'touch');
  assert.strictEqual(s.active, false); assert.strictEqual(OG.input.move.y, 0);
});
t('input: mouse hold moves toward pointer; keyboard beats mouse', function () {
  runState(); T += 20; frameAt(T); // prime: visibility-visible reset the frame clock, so this frame has dt 0
  ptr('pointerdown', 1, 700, 300, 'mouse');            // view centre is (400,300)
  assert(OG.input.move.x > 0.9 && Math.abs(OG.input.move.y) < 1e-9);
  fire('keydown', key('KeyA'));
  T += 20; frameAt(T);
  assert.strictEqual(OG.input.move.x, -1, 'keyboard wins over mouse');
  fire('keyup', key('KeyA'));
  ptr('pointerup', 1, 700, 300, 'mouse');
  T += 20; frameAt(T); assert.strictEqual(OG.input.move.x, 0);
  ptr('pointerdown', 1, 700, 300, 'mouse', { button: 2 });
  assert.strictEqual(OG.input.move.x, 0, 'right button ignored');
});
t('input: leaving run clears stick and dash', function () {
  runState(); ptr('pointerdown', 4, 100, 100, 'touch'); OG.input.pressDash();
  OG.game.setState('levelup');
  assert.strictEqual(OG.input.stick.active, false); assert.strictEqual(OG.input.dash, false);
});
t('input: touchmove on canvas is cancelled (no page scroll)', function () {
  var e = { target: byId.game, cancelable: true, preventDefault: function () { this.p = true; } };
  fire('touchmove', e); assert(e.p);
});

// ---- RNG ----
t('rng: same seed -> same 1000 values, in [0,1); different seeds differ', function () {
  var a = OG.rng(12345), b = OG.rng(12345), c = OG.rng(12346), same = 0, diff = 0;
  for (var i = 0; i < 1000; i++) {
    var x = a(), y = b(), z = c();
    assert(x >= 0 && x < 1); assert.strictEqual(x, y);
    if (x !== z) diff++; else same++;
  }
  assert(diff > 990, 'diff ' + diff);
  var s1 = OG.rng('2026-11-15'), s2 = OG.rng('2026-11-15'), s3 = OG.rng('2026-11-16');
  assert.strictEqual(s1(), s2()); assert.notStrictEqual(OG.rng('2026-11-15')(), s3());
  var m = 0; var r = OG.rng(7); for (i = 0; i < 10000; i++) m += r();
  assert(Math.abs(m / 10000 - 0.5) < 0.02);
});
t('hashSeed: stable uint32 (FNV-1a reference values)', function () {
  assert.strictEqual(OG.hashSeed(''), 2166136261);
  assert.strictEqual(OG.hashSeed('a'), 3826002220);
  assert.strictEqual(OG.hashSeed('foobar'), 0xbf9cf968);
  assert.strictEqual(OG.hashSeed('Sương Độc'), OG.hashSeed('Sương Độc'));
  assert.notStrictEqual(OG.hashSeed('2026-11-15'), OG.hashSeed('2026-11-16'));
  var h = OG.hashSeed('x'); assert(h >= 0 && h <= 4294967295 && Number.isInteger(h));
});

// ---- fmt ----
var FMT = [
  [0, '0'], [NaN, '0'], [undefined, '0'], [5, '5'], [999, '999'], [12.5, '12,5'], [0.5, '0,5'],
  [1000, '1,0 N'], [1200, '1,2 N'], [12345, '12,3 N'], [123456, '123 N'], [999499, '999 N'], [999999, '1,0 Tr'],
  [3450000, '3,45 Tr'], [5.6e9, '5,6 Tỷ'], [7.8e12, '7,8 NTỷ'], [1e15, '1,0 Rừng'], [1e18, '1,0 Đại Ngàn'],
  [1e21, '1,0 Thiên Hà'], [-1500, '-1,5 N'], [-42, '-42'], [999.6, '1,0 N'], [1e-9, '0'], [-0, '0'], ['2500', '2,5 N'],
  [4.2e24, '4200 Thiên Hà'], [Infinity, '∞']
];
t('fmt: ' + FMT.length + ' cases', function () {
  FMT.forEach(function (c) { assert.strictEqual(OG.fmt(c[0]), c[1], 'fmt(' + String(c[0]) + ')'); });
});
t('fmtTime', function () {
  [[0, '00:00'], [5, '00:05'], [59.9, '00:59'], [60, '01:00'], [905, '15:05'], [900, '15:00'], [4500, '75:00'], [-3, '00:00'], [NaN, '00:00'], [Infinity, '00:00']]
    .forEach(function (c) { assert.strictEqual(OG.fmtTime(c[0]), c[1], 'fmtTime(' + c[0] + ')'); });
});
t('clamp / lerp / dist2', function () {
  assert.strictEqual(OG.clamp(5, 0, 3), 3); assert.strictEqual(OG.clamp(-1, 0, 3), 0); assert.strictEqual(OG.clamp(2, 0, 3), 2);
  assert.strictEqual(OG.lerp(10, 20, 0.5), 15); assert.strictEqual(OG.dist2(0, 0, 3, 4), 25);
});

// ---- save ----
t('save: round trip, debounce 500 ms, flush on pagehide, latest wins', function () {
  var o = { a: 1 };
  timers = []; store = {};
  OG.save.write(o); o.a = 2; OG.save.write(o);
  assert.strictEqual(timers.length, 1); assert.strictEqual(timers[0].ms, 500);
  assert(!('overgrow.v1' in store));
  runTimers();
  assert.strictEqual(store['overgrow.v1'], '{"a":2}');
  assert.deepStrictEqual(OG.save.load(), { a: 2 });
  OG.save.write({ b: 1 }); fire('pagehide');
  assert.strictEqual(store['overgrow.v1'], '{"b":1}'); assert.strictEqual(timers.length, 0);
  OG.save.write({ c: 1 }); assert.deepStrictEqual(OG.save.load(), { c: 1 }, 'load sees pending write');
});
t('save: corrupted / non-object JSON -> null', function () {
  store['overgrow.v1'] = '{not json'; assert.strictEqual(OG.save.load(), null);
  store['overgrow.v1'] = '[1,2]'; assert.strictEqual(OG.save.load(), null);
  store['overgrow.v1'] = '42'; assert.strictEqual(OG.save.load(), null);
  delete store['overgrow.v1']; assert.strictEqual(OG.save.load(), null);
});
t('save: throwing localStorage never throws', function () {
  var real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: function () { throw new Error('denied'); },
    setItem: function () { throw new Error('QuotaExceededError'); }
  };
  assert.strictEqual(OG.save.load(), null);
  OG.save.write({ x: 1 }); OG.save.flush(); runTimers();
  Object.defineProperty(globalThis, 'localStorage', { get: function () { throw new Error('SecurityError'); }, configurable: true });
  assert.strictEqual(OG.save.load(), null);
  OG.save.write({ x: 1 }); OG.save.flush();
  var cyc = {}; cyc.self = cyc;
  Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true });
  OG.save.write(cyc); OG.save.flush();
  OG.save.write(undefined); OG.save.flush();
});

console.log(process.exitCode ? 'SOME TESTS FAILED' : 'core: all ' + passed + ' tests passed');
