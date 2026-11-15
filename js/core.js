/* OVERGROW — core.js: loop, state, bus, input, save, RNG, formatting. Loads first. */
(function (OG) {
  'use strict';

  // ---------- tunables ----------
  OG.cfg = OG.cfg || {};
  var CFG = OG.cfg.core = {
    step: 1 / 60,          // fixed tick (s)
    maxSteps: 5,           // max catch-up ticks per frame
    maxFrame: 0.25,        // clamp for one frame's real dt (s)
    maxDpr: 2,
    stickRadius: 60,       // CSS px
    stickDead: 0.12,
    stickZone: 0.6,        // left 60% of the screen starts the joystick
    mouseDead: 12,         // px around the player where the mouse gives no move
    mouseFull: 80,         // px at which the mouse gives full speed
    saveKey: 'overgrow.v1',
    saveDelay: 500,        // ms, max wait before a write hits storage
    resizeRetry: [120, 400] // ms, re-measure after orientationchange (stale values on iOS)
  };

  var STATES = { title: 1, run: 1, levelup: 1, paused: 1, winter: 1 };
  var EPS = 1e-9;

  function warnOnce(owner, label, err) {
    if (owner.warned) return;
    owner.warned = true;
    try { console.error('[OVERGROW] ' + label + ' threw (logged once):', err); } catch (e) {}
  }

  // ---------- math helpers ----------
  OG.clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  OG.lerp = function (a, b, t) { return a + (b - a) * t; };
  OG.dist2 = function (ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };

  // ---------- event bus ----------
  // Copy-on-write listener arrays: on/off during emit never disturb the running emit.
  var listeners = Object.create(null);
  OG.bus = {
    on: function (name, fn) {
      if (typeof fn !== 'function') return;
      var a = listeners[name];
      listeners[name] = a ? a.concat([{ fn: fn, warned: false }]) : [{ fn: fn, warned: false }];
    },
    off: function (name, fn) {
      var a = listeners[name];
      if (!a) return;
      for (var i = 0; i < a.length; i++) {
        if (a[i].fn === fn) { listeners[name] = a.slice(0, i).concat(a.slice(i + 1)); return; }
      }
    },
    emit: function (name, data) {
      var a = listeners[name];
      if (!a) return;
      for (var i = 0; i < a.length; i++) {
        try { a[i].fn(data); } catch (e) { warnOnce(a[i], 'listener for "' + name + '"', e); }
      }
    }
  };

  // ---------- RNG ----------
  OG.hashSeed = function (s) { // FNV-1a, uint32
    s = String(s);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };
  OG.rng = function (seed) { // mulberry32
    var a = (typeof seed === 'string') ? OG.hashSeed(seed) : ((Number(seed) || 0) >>> 0);
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  OG.rand = OG.rng(OG.hashSeed('overgrow')); // meta replaces this at run start

  // ---------- number formatting ----------
  var UNITS = [['', 1], ['N', 1e3], ['Tr', 1e6], ['Tỷ', 1e9], ['NTỷ', 1e12],
               ['Rừng', 1e15], ['Đại Ngàn', 1e18], ['Thiên Hà', 1e21]];
  // 3 significant digits; above 999 a unit suffix with at least one decimal ("1,0 Rừng"), up to two ("3,45 Tr").
  OG.fmt = function (n) {
    n = Number(n);
    if (n !== n) return '0';
    if (n === Infinity) return '∞';
    if (n === -Infinity) return '-∞';
    var neg = n < 0, a = Math.abs(n);
    if (a < 0.005) return '0';
    var i = 0;
    while (i < 7 && a >= UNITS[i + 1][1]) i++;
    var s;
    for (;;) {
      var m = a / UNITS[i][1];
      if (i === 0) {
        var r = Number(m.toPrecision(3));
        if (r >= 1000) { i = 1; continue; }
        s = String(r);
      } else {
        var d = m >= 100 ? 0 : (m >= 10 ? 1 : 2);
        var f = m.toFixed(d);
        if (Number(f) >= 1000 && i < 7) { i++; continue; }
        if (d > 0 && f.indexOf('.') >= 0) {
          f = f.replace(/0+$/, '');
          if (f.charAt(f.length - 1) === '.') f += '0';
        }
        s = f;
      }
      break;
    }
    return (neg ? '-' : '') + s.replace('.', ',') + (i ? ' ' + UNITS[i][0] : '');
  };
  OG.fmtTime = function (sec) {
    sec = Number(sec);
    var s = isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
    var mm = Math.floor(s / 60), ss = s % 60;
    return (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
  };

  // ---------- save ----------
  var pendingSave = null, hasPending = false, saveTimer = null;
  function storage() { try { return window.localStorage || null; } catch (e) { return null; } }
  function flushSave() {
    if (saveTimer !== null) { try { clearTimeout(saveTimer); } catch (e) {} saveTimer = null; }
    if (!hasPending) return;
    var obj = pendingSave;
    pendingSave = null; hasPending = false;
    try {
      var st = storage(), s = JSON.stringify(obj);
      if (st && s !== undefined) st.setItem(CFG.saveKey, s);
    } catch (e) { /* private mode, quota, cyclic data: the game goes on */ }
  }
  OG.save = {
    load: function () {
      try {
        flushSave(); // read-your-writes
        var st = storage();
        if (!st) return null;
        var raw = st.getItem(CFG.saveKey);
        if (raw === null || raw === undefined) return null;
        var v = JSON.parse(raw);
        return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
      } catch (e) { return null; }
    },
    // Stores the reference; it is serialised when the timer fires, so the latest content wins.
    write: function (obj) {
      try {
        pendingSave = obj; hasPending = true;
        if (saveTimer === null) saveTimer = setTimeout(flushSave, CFG.saveDelay);
      } catch (e) {}
    },
    flush: flushSave
  };

  // ---------- state ----------
  OG.state = {
    run: { time: 0, seed: 0, daily: false, level: 1, xp: 0, xpNext: 0, light: 0, kills: 0, rerolls: 0, over: false, result: null },
    player: { x: 0, y: 0, vx: 0, vy: 0, r: 14, hp: 100, maxHp: 100, invuln: 0, dashCd: 0, dashing: false, still: 0, rooted: false },
    enemies: [], projectiles: [], hazards: [], orbits: [], trails: [], pickups: [],
    stats: {
      dmg: 10, fireRate: 1.6, projSpeed: 420, projCount: 1, pierce: 0, spread: 0.18, moveSpeed: 150,
      maxHp: 100, armor: 0, regen: 0, magnet: 70, crit: 0.05, critMul: 2, dashCd: 3, dashDist: 120,
      area: 1, orbitCount: 0, orbitDmg: 0, orbitRadius: 60, novaDmg: 0, novaCd: 0, thorns: 0,
      rootSlow: 0, chain: 0, burnDps: 0, trailDmg: 0, splitCount: 0, leech: 0, xpMul: 1, lightMul: 1, choices: 3
    },
    tree: { growth: { fire: 0, wind: 0, root: 0, stone: 0 }, skills: {}, synergies: {}, order: [] },
    meta: {
      roots: 0, rootsTotal: 0, lifetimeLight: 0, bestLpm: 0, upgrades: {}, codex: {},
      best: { time: 0, level: 0 }, seasons: 0, clears: 0, lastSeen: 0,
      daily: { date: '', bestTime: 0, bestLevel: 0, played: false },
      settings: { mute: false, volume: 0.8, shake: true, colorblind: false, relax: false, hints: { move: false, tree: false } }
    }
  };

  // ---------- game: state machine + hooks ----------
  var updateHooks = [], renderHooks = [], hookSeq = 0;
  function addHook(list, fn, order) {
    if (typeof fn !== 'function') return list;
    var next = list.concat([{ fn: fn, order: Number(order) || 0, seq: hookSeq++, warned: false }]);
    next.sort(function (a, b) { return a.order - b.order || a.seq - b.seq; });
    return next;
  }

  var game = OG.game = {
    state: 'title',
    setState: function (s) {
      if (!STATES[s]) return;
      var from = game.state;
      if (from === s) return;
      game.state = s;
      if (from === 'run') resetTransientInput();
      OG.bus.emit('state:change', { from: from, to: s });
      if (s === 'paused') OG.bus.emit('game:pause');
      else if (from === 'paused' && s === 'run') OG.bus.emit('game:resume');
    },
    addUpdate: function (fn, order) { updateHooks = addHook(updateHooks, fn, order); },
    addRender: function (fn, order) { renderHooks = addHook(renderHooks, fn, order); }
  };

  function togglePause() {
    if (game.state === 'run') game.setState('paused');
    else if (game.state === 'paused') game.setState('run');
  }
  function autoPause() { if (game.state === 'run') game.setState('paused'); }

  // ---------- view ----------
  OG.view = { w: 0, h: 0, dpr: 1 };

  // ---------- input ----------
  var stick = { active: false, ox: 0, oy: 0, x: 0, y: 0, r: CFG.stickRadius };
  var input = OG.input = {
    move: { x: 0, y: 0 },
    dash: false,
    stick: stick,
    pressDash: function () { dashPending = true; }
  };
  var dashPending = false;
  var keys = Object.create(null);
  var stickId = null;
  var mouse = { down: false, id: null, x: 0, y: 0 };

  function resetTransientInput() {
    stick.active = false; stickId = null;
    mouse.down = false; mouse.id = null;
    dashPending = false; input.dash = false;
    input.move.x = 0; input.move.y = 0;
  }
  function clearKeys() { for (var k in keys) delete keys[k]; }

  function playerScreen() {
    try {
      var p = OG.state.player;
      if (OG.render && typeof OG.render.worldToScreen === 'function') {
        var s = OG.render.worldToScreen(p.x, p.y);
        if (s) {
          var sx = s.x !== undefined ? s.x : s[0], sy = s.y !== undefined ? s.y : s[1];
          if (isFinite(sx) && isFinite(sy)) return { x: sx, y: sy };
        }
      }
    } catch (e) {}
    return { x: OG.view.w / 2, y: OG.view.h / 2 };
  }

  function computeMove() {
    var x = 0, y = 0, len;
    // 1) touch stick
    if (stick.active) {
      var vx = (stick.x - stick.ox) / stick.r, vy = (stick.y - stick.oy) / stick.r;
      len = Math.sqrt(vx * vx + vy * vy);
      if (len >= CFG.stickDead) {
        var mag = Math.min(len, 1);
        var sc = ((mag - CFG.stickDead) / (1 - CFG.stickDead)) / len;
        x = vx * sc; y = vy * sc;
      }
    }
    // 2) keyboard
    if (x === 0 && y === 0) {
      var kx = ((keys.KeyD || keys.ArrowRight) ? 1 : 0) - ((keys.KeyA || keys.ArrowLeft) ? 1 : 0);
      var ky = ((keys.KeyS || keys.ArrowDown) ? 1 : 0) - ((keys.KeyW || keys.ArrowUp) ? 1 : 0);
      if (kx || ky) { len = Math.sqrt(kx * kx + ky * ky); x = kx / len; y = ky / len; }
    }
    // 3) mouse: hold to walk toward the pointer
    if (x === 0 && y === 0 && mouse.down) {
      var p = playerScreen(), dx = mouse.x - p.x, dy = mouse.y - p.y;
      len = Math.sqrt(dx * dx + dy * dy);
      if (len > CFG.mouseDead) {
        var m = Math.min(1, (len - CFG.mouseDead) / (CFG.mouseFull - CFG.mouseDead));
        x = dx / len * m; y = dy / len * m;
      }
    }
    input.move.x = x; input.move.y = y;
  }

  function isTyping(t) {
    var n = t && t.tagName;
    return n === 'INPUT' || n === 'TEXTAREA' || n === 'SELECT' || !!(t && t.isContentEditable);
  }
  function keyCode(e) {
    if (e.code) return e.code;
    var k = e.key;
    if (!k) return '';
    if (k === ' ') return 'Space';
    if (k.length === 1) return 'Key' + k.toUpperCase();
    if (k === 'Shift') return 'ShiftLeft';
    if (k === 'Esc') return 'Escape';
    return k;
  }
  var GAME_KEYS = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };

  function onKeyDown(e) {
    if (isTyping(e.target)) return;
    var c = keyCode(e);
    if (GAME_KEYS[c] && e.preventDefault) e.preventDefault();
    keys[c] = true;
    if (e.repeat) return;
    if (c === 'Escape' || c === 'KeyP') togglePause();
    else if ((c === 'Space' || c === 'ShiftLeft' || c === 'ShiftRight') && game.state === 'run') dashPending = true;
  }
  function onKeyUp(e) { delete keys[keyCode(e)]; }

  function blocked(t) { return !!(t && t.closest && t.closest('.ui-block')); }

  function onPointerDown(e) {
    if (game.state !== 'run' || blocked(e.target)) return;
    if (e.pointerType === 'touch') {
      if (stickId !== null || e.clientX > OG.view.w * CFG.stickZone) return;
      stickId = e.pointerId;
      stick.active = true;
      stick.ox = stick.x = e.clientX; stick.oy = stick.y = e.clientY;
    } else {
      if (e.button !== 0) return;
      mouse.down = true; mouse.id = e.pointerId; mouse.x = e.clientX; mouse.y = e.clientY;
    }
    computeMove();
  }
  function onPointerMove(e) {
    if (e.pointerType === 'touch') {
      if (e.pointerId !== stickId || !stick.active) return;
      var dx = e.clientX - stick.ox, dy = e.clientY - stick.oy, len = Math.sqrt(dx * dx + dy * dy);
      if (len > stick.r) { dx = dx / len * stick.r; dy = dy / len * stick.r; }
      stick.x = stick.ox + dx; stick.y = stick.oy + dy;
    } else {
      mouse.x = e.clientX; mouse.y = e.clientY;
    }
    computeMove();
  }
  function onPointerUp(e) {
    if (e.pointerType === 'touch') {
      if (e.pointerId !== stickId) return;
      stick.active = false; stickId = null;
    } else if (mouse.down && (e.type === 'pointercancel' || e.button === 0)) {
      mouse.down = false; mouse.id = null;
    }
    computeMove();
  }

  // ---------- canvas, viewport ----------
  var booted = false, canvasEl = null, app = null;

  function measure() {
    var vv = window.visualViewport, w, h;
    if (vv && Math.abs((vv.scale || 1) - 1) < 0.01) { w = vv.width; h = vv.height; }
    else { w = window.innerWidth || (document.documentElement && document.documentElement.clientWidth) || 1;
           h = window.innerHeight || (document.documentElement && document.documentElement.clientHeight) || 1; }
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    var dpr = Math.min(CFG.maxDpr, Math.max(1, Number(window.devicePixelRatio) || 1));
    return { w: w, h: h, dpr: dpr };
  }
  function applySize() {
    if (!canvasEl) return;
    var m = measure(), v = OG.view;
    if (m.w === v.w && m.h === v.h && m.dpr === v.dpr) return;
    v.w = m.w; v.h = m.h; v.dpr = m.dpr;
    app.style.width = m.w + 'px'; app.style.height = m.h + 'px';
    canvasEl.style.width = m.w + 'px'; canvasEl.style.height = m.h + 'px';
    canvasEl.width = Math.round(m.w * m.dpr); canvasEl.height = Math.round(m.h * m.dpr);
    OG.bus.emit('resize', { w: m.w, h: m.h, dpr: m.dpr });
  }
  function onOrientation() {
    applySize();
    for (var i = 0; i < CFG.resizeRetry.length; i++) setTimeout(applySize, CFG.resizeRetry[i]);
  }

  function setupCanvas() {
    app = document.getElementById('app');
    if (!app) { app = document.createElement('div'); app.id = 'app'; document.body.appendChild(app); }
    canvasEl = document.getElementById('game');
    if (!canvasEl) { canvasEl = document.createElement('canvas'); canvasEl.id = 'game'; app.appendChild(canvasEl); }
    var de = document.documentElement, b = document.body;
    if (de && de.style) { de.style.overflow = 'hidden'; de.style.overscrollBehavior = 'none'; }
    if (b && b.style) { b.style.margin = '0'; b.style.overflow = 'hidden'; b.style.overscrollBehavior = 'none'; }
    var as = app.style;
    as.position = 'fixed'; as.left = '0'; as.top = '0'; as.overflow = 'hidden';
    as.touchAction = 'none'; as.userSelect = 'none'; as.webkitUserSelect = 'none';
    as.webkitTouchCallout = 'none'; as.webkitTapHighlightColor = 'transparent';
    canvasEl.style.display = 'block'; canvasEl.style.touchAction = 'none';
    OG.canvas = canvasEl;
    OG.ctx = canvasEl.getContext('2d');
    applySize();
  }

  function setupInput() {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    // block scroll / pinch / context menu on the play area
    document.addEventListener('touchmove', function (e) {
      if (e.target === canvasEl && e.cancelable) e.preventDefault();
    }, { passive: false });
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) {
      document.addEventListener(n, function (e) { if (e.preventDefault) e.preventDefault(); }, { passive: false });
    });
    canvasEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    window.addEventListener('wheel', function (e) { if (e.ctrlKey && e.preventDefault) e.preventDefault(); }, { passive: false });

    window.addEventListener('resize', applySize);
    window.addEventListener('orientationchange', onOrientation);
    if (window.visualViewport && window.visualViewport.addEventListener) {
      window.visualViewport.addEventListener('resize', applySize);
    }

    window.addEventListener('blur', function () { clearKeys(); resetStickAndMouse(); autoPause(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden || document.visibilityState === 'hidden') {
        clearKeys(); resetStickAndMouse(); autoPause(); flushSave();
      } else { lastTime = null; applySize(); }
    });
    window.addEventListener('pagehide', flushSave);
  }
  function resetStickAndMouse() {
    stick.active = false; stickId = null; mouse.down = false; mouse.id = null; computeMove();
  }

  // ---------- loop ----------
  var acc = 0, lastTime = null, loopOn = false;
  var raf = function (cb) {
    return (window.requestAnimationFrame || function (f) { return setTimeout(function () { f(Date.now()); }, 16); })(cb);
  };

  function runHooks(list, a, b, c) {
    for (var i = 0; i < list.length; i++) {
      var h = list[i];
      try { h.fn(a, b, c); } catch (e) { warnOnce(h, 'hook (order ' + h.order + ')', e); }
    }
  }

  function frame(now) {
    raf(frame);
    if (typeof now !== 'number') now = Date.now();
    var real = lastTime === null ? 0 : (now - lastTime) / 1000;
    lastTime = now;
    if (!(real > 0)) real = 0;
    if (real > CFG.maxFrame) real = CFG.maxFrame;

    var DT = CFG.step, alpha = 0;
    if (game.state === 'run') {
      acc += real;
      var n = 0;
      while (acc >= DT - EPS && n < CFG.maxSteps) {
        acc -= DT; if (acc < 0) acc = 0;
        n++;
        computeMove();
        input.dash = dashPending; dashPending = false;
        runHooks(updateHooks, DT);
        if (game.state !== 'run') break;
      }
      if (game.state !== 'run') acc = 0;
      else if (acc >= DT - EPS) acc %= DT; // spiral guard: drop what we could not simulate
      alpha = OG.clamp(acc / DT, 0, 1);
    } else {
      acc = 0;
    }

    var ctx = OG.ctx;
    if (ctx && ctx.setTransform) ctx.setTransform(OG.view.dpr, 0, 0, OG.view.dpr, 0, 0); // hooks draw in CSS px
    runHooks(renderHooks, ctx, alpha, real);
  }

  // ---------- boot ----------
  OG.boot = function () {
    if (booted) return;
    booted = true;
    function start() {
      setupCanvas();
      setupInput();
      if (!loopOn) { loopOn = true; raf(frame); }
      OG.bus.emit('boot');
    }
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  };

})(window.OG = window.OG || {});
