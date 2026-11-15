/* OVERGROW — render.js : "storybook garden at dusk"
   Draws OG.state onto the canvas. Sprites are painted once into cached offscreen
   canvases (per kind x zoom bucket x colorblind) and then only drawImage'd. */
(function (OG) {
  'use strict';

  OG.cfg = OG.cfg || {};
  var cfg = OG.cfg.render = {
    span: 720,                 // world px visible along the shorter screen side
    lead: 0.3, leadMax: 80,    // camera lead (seconds of velocity, max px)
    follow: 7,                 // camera follow speed (1/s)
    zoomOutSpan: 4300,         // world px fitted on the short side after zoomOut
    worldHalf: 2000,
    chunk: 512, chunkCache: 18, chunkMinZoom: 0.3,
    bloomScale: 0.25, bloomPop: 0.3, bloomMapMul: 1.6,
    flowerCap: 20000, flowerVisCap: 700, crispMinZoom: 0.18, crispFull: 0.3,
    flashSec: 0.08,
    numMax: 60, numLife: 0.8, fxMax: 120,
    shakeHurt: [5, 0.22], shakeBoss: [10, 0.55],
    vignette: false,
    maxSpritePx: 1024,
    buckets: [0.3, 0.45, 0.65, 0.9, 1.3, 1.8, 2.6, 3.6]
  };

  var TAU = Math.PI * 2;
  var PAL = {
    ground: '#2E3A2F', groundA: '#334236', groundB: '#293528', shadow: '#243026',
    grass: '#5E7D4A', grassDk: '#3C5233', grassLt: '#7F9F5E',
    paper: '#F2E8D0', ink: '#1F2420',
    amber: '#F4B942', amberLt: '#F9D27D',
    blight: '#7B6F8A', blightDk: '#5D536B', blightDeep: '#54496A', blightLt: '#9A8DAA', out: '#3B3346',
    haz: '#9F7FD1', hazLt: '#CDB8F0',
    fire: '#E07A5F', wind: '#8FC1C9', root: '#A7C957', rootDk: '#7E9C3E', stone: '#B8A99A',
    pebble: '#8A8678', pebbleLt: '#B1AC9A'
  };

  // ---------------------------------------------------------------- helpers
  function rng(seed) {                       // mulberry32, local so render has no hard deps
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function easeOut(p) { var q = 1 - p; return 1 - q * q * q; }
  function easeInOut(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function easeBack(p) { var c1 = 1.9, c3 = c1 + 1, q = p - 1; return 1 + c3 * q * q * q + c1 * q * q; }

  function makeCanvas(w, h) {
    var c;
    if (typeof document !== 'undefined' && document.createElement) c = document.createElement('canvas');
    else c = new OffscreenCanvas(w, h);
    c.width = w; c.height = h;
    return c;
  }

  var stats = { spriteBuilds: 0, chunkBuilds: 0, drawn: { enemies: 0, projectiles: 0, pickups: 0, hazards: 0, trails: 0, flowers: 0 } };

  // ---------------------------------------------------------------- state of the module
  var T = 0;                                  // accumulated real time (s)
  var cam = OG.render && OG.render.camera ? OG.render.camera : { x: 0, y: 0, zoom: 1 };
  var camInit = false, zoomAnim = null;
  var Z = 1, TX = 0, TY = 0;                  // base world->device transform
  var curS = 1, curCb = 0, inkM = 1;          // sprite build context
  var tableBase = 0, bucketIdx = 0, cbIdx = 0;
  var shakeAmp = 0, shakeT = 0, shakeDur = 1, shx = 0, shy = 0;
  var hurtUntil = 0;
  var pvx = 0, pvy = 0, lastPX = null, lastPY = 0, eyeX = 0, eyeY = 0.25, stretch = 0, blinkAt = 3;
  var tmax = 0.6, trailMax = 0.5;
  var hitRec = {}, hitRecN = 0;
  var stripePat = null, stripeCtx = null;

  // ---------------------------------------------------------------- sprite ids
  var NV = 4;                                 // variants per id
  var ID = { SPORE: 0, MOLD: 1, BRUTE: 2, SPITTER: 3, CORE: 4, MOTHER: 5, PLAYER: 6, SPROUT: 7,
             FLOWER: 8, /* 8..13 */ SEED: 14, XP: 15, HEAL: 16, HAZ: 17, PETAL: 18, FLAME: 19, TENDRIL: 20, LITTER: 21, NS: 22 };
  var KID = { spore: 0, mold: 1, brute: 2, spitter: 3, core: 4, mother: 5 };
  var ER = [8, 13, 24, 12, 40, 70];           // base radii from the contract
  var WOB_F = [9, 4.5, 2.4, 4, 1.6, 1.1], WOB_A = [0.07, 0.06, 0.035, 0.05, 0.02, 0.015];
  var FLOWER_R = [12, 15, 22, 15, 34, 80];

  var table = [];                             // sprite table

  function pickBucket(s) {
    var b = cfg.buckets, best = 0, bd = 1e9, ls = Math.log(s);
    for (var i = 0; i < b.length; i++) { var d = Math.abs(Math.log(b[i]) - ls); if (d < bd) { bd = d; best = i; } }
    return best;
  }

  function spr(id, v) {
    var i = tableBase + id * NV + v, s = table[i];
    if (s) return s;
    s = table[i] = build(id, v);
    return s;
  }

  // ---------------------------------------------------------------- sprite toolkit
  function mk(hw, hh, fn, tint) {
    var wW = hw * 2, hW = hh * 2, s = curS;
    var pw = Math.ceil(wW * s), ph = Math.ceil(hW * s), m = Math.max(pw, ph);
    if (m > cfg.maxSpritePx) { s *= cfg.maxSpritePx / m; pw = Math.ceil(wW * s); ph = Math.ceil(hW * s); }
    pw = Math.max(2, pw); ph = Math.max(2, ph);
    var c = makeCanvas(pw, ph), g = c.getContext('2d');
    g.setTransform(pw / wW, 0, 0, ph / hW, pw / 2, ph / 2);
    g.lineJoin = 'round'; g.lineCap = 'round';
    fn(g);
    if (tint) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = tint; g.fillRect(0, 0, pw, ph);
      g.globalCompositeOperation = 'source-over';
    }
    stats.spriteBuilds++;
    return { c: c, w: wW, h: hW, ox: hw, oy: hh };
  }
  function ink(R) { return Math.max(2.1, R * 0.12, 1.5 / curS) * inkM; }
  function circ(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, TAU); }
  function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, rx, ry, rot || 0, 0, TAU); }
  function shadow(g, x, y, rx, ry) { g.fillStyle = PAL.shadow; ell(g, x, y, rx, ry); g.fill(); }
  function strokeInk(g, col, w) { g.strokeStyle = col; g.lineWidth = w; g.stroke(); }

  function lumps(rnd, n, rx, ry, amp, rot, cx, cy) {
    var a = [];
    for (var i = 0; i < n; i++) {
      var ang = rot + i / n * TAU, rr = 1 + (rnd() - 0.5) * 2 * amp;
      a.push([cx + Math.cos(ang) * rx * rr, cy + Math.sin(ang) * ry * rr]);
    }
    return a;
  }
  function blobPath(g, pts) {
    var n = pts.length, p, q;
    g.beginPath();
    g.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
    for (var i = 0; i < n; i++) {
      p = pts[i]; q = pts[(i + 1) % n];
      g.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    g.closePath();
  }
  function polyPath(g, pts) {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
  }
  // filled shape + clipped shading + outline on top
  function shaded(g, pathFn, pts, fill, outline, lw, shadeFn) {
    pathFn(g, pts); g.fillStyle = fill; g.fill();
    if (shadeFn) { g.save(); pathFn(g, pts); g.clip(); shadeFn(g); g.restore(); }
    pathFn(g, pts); strokeInk(g, outline, lw);
  }
  function union(g, circles, fill, outline, w) {
    var i, c;
    g.fillStyle = outline;
    for (i = 0; i < circles.length; i++) { c = circles[i]; circ(g, c[0], c[1], c[2] + w); g.fill(); }
    g.fillStyle = fill;
    for (i = 0; i < circles.length; i++) { c = circles[i]; circ(g, c[0], c[1], c[2]); g.fill(); }
  }
  function eye(g, x, y, r, lx, ly, outline) {
    g.fillStyle = PAL.paper; circ(g, x, y, r); g.fill();
    strokeInk(g, outline || PAL.out, Math.max(1.1, r * 0.32));
    g.fillStyle = PAL.ink; circ(g, x + (lx || 0) * r * 0.32, y + (ly || 0.3) * r * 0.32, r * 0.52); g.fill();
    g.fillStyle = PAL.paper; circ(g, x + (lx || 0) * r * 0.32 - r * 0.18, y + (ly || 0.3) * r * 0.32 - r * 0.2, r * 0.17); g.fill();
  }
  function lens(g, len, wid) {                // leaf lens along +x centred at origin
    g.beginPath();
    g.moveTo(-len / 2, 0); g.quadraticCurveTo(0, -wid * 1.3, len / 2, 0); g.quadraticCurveTo(0, wid * 1.3, -len / 2, 0);
    g.closePath();
  }

  // ---------------------------------------------------------------- enemy sprites
  function bSpore(g, fl) {
    var R = 8, w = ink(R), rnd = rng(11), i, a;
    if (!fl) shadow(g, 0, R * 1.62, R * 0.8, R * 0.26);
    g.beginPath(); g.moveTo(0, R * 0.2); g.quadraticCurveTo(R * 0.4, R * 0.9, 0, R * 1.55);
    strokeInk(g, PAL.out, R * 0.36 + w * 2);
    strokeInk(g, PAL.blightDk, R * 0.36);
    var cs = [[0, -R * 0.1, R * 0.72]];
    for (i = 0; i < 7; i++) { a = i / 7 * TAU + 0.3; cs.push([Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.58 - R * 0.1, R * 0.38 + rnd() * R * 0.08]); }
    union(g, cs, PAL.blight, PAL.out, w);
    g.fillStyle = PAL.blightLt; circ(g, -R * 0.3, -R * 0.55, R * 0.2); g.fill();
    g.fillStyle = PAL.blightDk; circ(g, R * 0.38, R * 0.25, R * 0.14); g.fill();
    eye(g, -R * 0.26, -R * 0.02, R * 0.24, 0, 0.4); eye(g, R * 0.26, -R * 0.02, R * 0.24, 0, 0.4);
  }
  function bMold(g, fl) {
    var R = 13, w = ink(R), rnd = rng(23);
    if (!fl) shadow(g, 0, R * 0.92, R * 0.95, R * 0.3);
    var pts = lumps(rnd, 9, R, R * 0.94, 0.1, 0.3, 0, 0);
    shaded(g, blobPath, pts, PAL.blight, PAL.out, w, function (g) {
      g.fillStyle = PAL.blightDk; ell(g, R * 0.15, R * 0.78, R * 0.95, R * 0.45); g.fill();
      g.fillStyle = PAL.blightLt; ell(g, -R * 0.3, -R * 0.45, R * 0.42, R * 0.24, -0.5); g.fill();
      g.fillStyle = PAL.blightDk; circ(g, R * 0.5, -R * 0.3, R * 0.12); g.fill(); circ(g, -R * 0.55, R * 0.2, R * 0.1); g.fill();
    });
    eye(g, -R * 0.32, -R * 0.08, R * 0.24, 0, 0.4); eye(g, R * 0.32, -R * 0.08, R * 0.24, 0, 0.4);
    g.beginPath(); g.moveTo(-R * 0.18, R * 0.36); g.quadraticCurveTo(0, R * 0.5, R * 0.18, R * 0.36); strokeInk(g, PAL.out, w * 0.8);
  }
  function bBrute(g, fl) {
    var R = 24, w = ink(R) * 1.15, rnd = rng(37);
    if (!fl) shadow(g, 0, R * 0.9, R * 1.05, R * 0.3);
    var pts = lumps(rnd, 12, R * 1.06, R * 0.95, 0.06, 0.1, 0, 0);
    pts[2][0] *= 0.76; pts[2][1] *= 0.76; pts[8][0] *= 0.78; pts[8][1] *= 0.78;
    shaded(g, blobPath, pts, PAL.blightDk, PAL.out, w, function (g) {
      g.fillStyle = PAL.blight; ell(g, -R * 0.25, -R * 0.42, R * 0.7, R * 0.34, -0.3); g.fill();
      g.fillStyle = PAL.blightDeep; ell(g, R * 0.1, R * 0.85, R * 1.1, R * 0.45); g.fill();
      g.fillStyle = PAL.blightLt; circ(g, -R * 0.55, -R * 0.55, R * 0.1); g.fill(); circ(g, R * 0.5, -R * 0.5, R * 0.07); g.fill();
      g.fillStyle = PAL.out; circ(g, R * 0.62, R * 0.1, R * 0.1); g.fill(); circ(g, -R * 0.7, R * 0.25, R * 0.08); g.fill();
    });
    g.beginPath(); g.moveTo(pts[2][0] - R * 0.12, pts[2][1] + R * 0.02); g.quadraticCurveTo(pts[2][0] * 0.6, pts[2][1] * 0.5, pts[2][0] * 0.4, pts[2][1] * 0.1);
    strokeInk(g, PAL.out, w * 0.7);
    g.beginPath(); g.moveTo(pts[8][0] + R * 0.1, pts[8][1] - R * 0.05); g.quadraticCurveTo(pts[8][0] * 0.6, pts[8][1] * 0.6, pts[8][0] * 0.35, pts[8][1] * 0.2);
    strokeInk(g, PAL.out, w * 0.7);
    eye(g, -R * 0.3, -R * 0.02, R * 0.15, 0, 0.5); eye(g, R * 0.3, -R * 0.02, R * 0.15, 0, 0.5);
    g.beginPath(); g.moveTo(-R * 0.5, -R * 0.22); g.lineTo(-R * 0.15, -R * 0.1); strokeInk(g, PAL.out, w);
    g.beginPath(); g.moveTo(R * 0.5, -R * 0.22); g.lineTo(R * 0.15, -R * 0.1); strokeInk(g, PAL.out, w);
    g.beginPath(); g.moveTo(-R * 0.28, R * 0.34); g.lineTo(R * 0.28, R * 0.34); strokeInk(g, PAL.out, w * 0.9);
    g.fillStyle = PAL.paper;
    polyPath(g, [[-R * 0.22, R * 0.34], [-R * 0.12, R * 0.34], [-R * 0.17, R * 0.5]]); g.fill();
    polyPath(g, [[R * 0.12, R * 0.34], [R * 0.22, R * 0.34], [R * 0.17, R * 0.5]]); g.fill();
  }
  function bSpitter(g, fl) {
    var R = 12, w = ink(R), rnd = rng(41);
    if (!fl) shadow(g, 0, R * 0.95, R * 0.95, R * 0.3);
    var pts = lumps(rnd, 8, R * 0.95, R, 0.08, 0.2, -R * 0.1, 0);
    shaded(g, blobPath, pts, PAL.blight, PAL.out, w, function (g) {
      g.fillStyle = PAL.blightDk; ell(g, 0, R * 0.78, R, R * 0.42); g.fill();
      g.fillStyle = PAL.blightLt; ell(g, -R * 0.4, -R * 0.5, R * 0.38, R * 0.22, -0.5); g.fill();
    });
    // tube mouth, pointing right and a little down
    g.save(); g.translate(R * 0.55, R * 0.18); g.rotate(0.22);
    var tl = R * 0.95, tw = R * 0.3;
    g.beginPath(); g.rect(0, -tw, tl, tw * 2);
    g.fillStyle = PAL.blightDk; g.fill(); strokeInk(g, PAL.out, w);
    ell(g, tl, 0, tw * 0.55, tw * 1.15); g.fillStyle = PAL.haz; g.fill(); strokeInk(g, PAL.out, w * 0.9);
    g.beginPath(); g.moveTo(tl * 0.45, -tw); g.lineTo(tl * 0.45, tw); strokeInk(g, PAL.out, w * 0.7);
    g.restore();
    eye(g, -R * 0.3, -R * 0.28, R * 0.26, 0.6, 0.2); eye(g, R * 0.12, -R * 0.4, R * 0.2, 0.7, 0.2);
  }
  function bCore(g, fl) {
    var R = 40, w = ink(R) * 1.1, i;
    if (!fl) shadow(g, 0, R * 0.92, R * 1.1, R * 0.26);
    var rv = [1, 0.9, 1.04, 0.93, 1, 0.88, 1.05, 0.95], pts = [];
    for (i = 0; i < 8; i++) { var a = -Math.PI / 2 + 0.2 + i / 8 * TAU; pts.push([Math.cos(a) * R * rv[i] * 1.04, Math.sin(a) * R * rv[i] * 0.94]); }
    shaded(g, polyPath, pts, PAL.blightDk, PAL.out, w, function (g) {
      g.fillStyle = PAL.blight; polyPath(g, [pts[5], pts[6], pts[7], [0, -R * 0.1], [-R * 0.5, R * 0.1]]); g.fill();
      g.fillStyle = PAL.blightDeep; polyPath(g, [pts[1], pts[2], pts[3], [R * 0.2, R * 0.3]]); g.fill();
    });
    // moss lumps along the top
    var cs = [[-R * 0.55, -R * 0.78, R * 0.2], [-R * 0.22, -R * 0.9, R * 0.24], [R * 0.18, -R * 0.92, R * 0.22], [R * 0.52, -R * 0.74, R * 0.18]];
    union(g, cs, PAL.blight, PAL.out, w * 0.9);
    g.fillStyle = PAL.blightLt; circ(g, -R * 0.26, -R * 0.96, R * 0.07); g.fill();
    // glowing seams
    var cracks = [[[-R * 0.15, -R * 0.2], [-R * 0.4, -R * 0.45], [-R * 0.3, -R * 0.62], [-R * 0.55, -R * 0.82]],
                  [[R * 0.2, R * 0.05], [R * 0.5, -R * 0.05], [R * 0.45, R * 0.28], [R * 0.85, R * 0.4]],
                  [[-R * 0.1, R * 0.2], [-R * 0.3, R * 0.5], [-R * 0.18, R * 0.7], [-R * 0.4, R * 0.9]]];
    for (i = 0; i < cracks.length; i++) {
      g.beginPath(); g.moveTo(cracks[i][0][0], cracks[i][0][1]);
      for (var j = 1; j < 4; j++) g.lineTo(cracks[i][j][0], cracks[i][j][1]);
      strokeInk(g, PAL.out, w * 1.5); strokeInk(g, PAL.hazLt, w * 0.5);
    }
    eye(g, 0, -R * 0.02, R * 0.22, 0, 0.5);
    g.beginPath(); g.moveTo(-R * 0.3, -R * 0.26); g.lineTo(R * 0.28, -R * 0.2); strokeInk(g, PAL.out, w * 1.1);
  }
  function bMother(g, fl, phase) {
    var R = 70, w = ink(R) * 0.9, rnd = rng(59), i;
    if (!fl) shadow(g, 0, R * 1.0, R * 1.2, R * 0.2);
    var L1 = lumps(rnd, 18, R * 1.0, R * 0.58, 0.07, 0, 0, R * 0.34);
    var L2 = lumps(rnd, 16, R * 0.8, R * 0.5, 0.07, 0.2, 0, R * 0.0);
    var L3 = lumps(rnd, 14, R * 0.58, R * 0.38, 0.07, 0.1, 0, -R * 0.32);
    // crown of spore stalks
    var cx = [-0.4, -0.18, 0.06, 0.28, 0.46], cy = [-0.5, -0.78, -0.88, -0.74, -0.5];
    for (i = 0; i < 5; i++) {
      g.beginPath(); g.moveTo(cx[i] * R * 0.9, -R * 0.45); g.lineTo(cx[i] * R, cy[i] * R);
      strokeInk(g, PAL.out, R * 0.06 + w * 2); strokeInk(g, PAL.blightDk, R * 0.06);
    }
    var cs = [];
    for (i = 0; i < 5; i++) cs.push([cx[i] * R, cy[i] * R - R * 0.07, R * (0.1 + (i % 2) * 0.03)]);
    union(g, cs, PAL.blight, PAL.out, w * 0.8);
    shaded(g, blobPath, L1, PAL.blightDeep, PAL.out, w, function (g) {
      g.fillStyle = PAL.blightDk; ell(g, 0, R * 0.78, R * 1.1, R * 0.3); g.fill();
    });
    shaded(g, blobPath, L2, PAL.blightDk, PAL.out, w, function (g) {
      g.fillStyle = PAL.blightDeep; ell(g, 0, R * 0.42, R * 0.9, R * 0.2); g.fill();
    });
    shaded(g, blobPath, L3, PAL.blight, PAL.out, w, function (g) {
      g.fillStyle = PAL.blightLt; ell(g, -R * 0.15, -R * 0.55, R * 0.36, R * 0.14, -0.2); g.fill();
    });
    if (phase >= 2) {
      var cr = [[[-R * 0.55, R * 0.12], [-R * 0.4, R * 0.3], [-R * 0.5, R * 0.45], [-R * 0.3, R * 0.62]],
                [[R * 0.5, R * 0.05], [R * 0.36, R * 0.24], [R * 0.52, R * 0.4], [R * 0.34, R * 0.6]],
                [[R * 0.1, -R * 0.62], [R * 0.2, -R * 0.5], [R * 0.08, -R * 0.42]]];
      for (i = 0; i < cr.length; i++) {
        g.beginPath(); g.moveTo(cr[i][0][0], cr[i][0][1]);
        for (var j = 1; j < cr[i].length; j++) g.lineTo(cr[i][j][0], cr[i][j][1]);
        strokeInk(g, PAL.out, w * 1.4); strokeInk(g, PAL.amber, w * 0.55);
      }
    }
    var iris = phase === 0 ? PAL.hazLt : (phase === 1 ? PAL.amber : PAL.fire);
    var E = [[0.04, -0.32, 0.16], [-0.3, -0.2, 0.11], [0.36, -0.2, 0.1], [-0.12, -0.02, 0.09], [0.2, 0.0, 0.12], [-0.42, 0.04, 0.08],
             [0.52, 0.0, 0.07], [0.0, 0.16, 0.07], [-0.24, 0.2, 0.06], [0.3, 0.2, 0.06], [-0.1, -0.5, 0.06]];
    var ne = phase === 0 ? 7 : (phase === 1 ? 9 : 11);
    for (i = 0; i < ne; i++) {
      var ex = E[i][0] * R, ey = E[i][1] * R, er = E[i][2] * R;
      g.fillStyle = '#2A2230'; circ(g, ex, ey, er); g.fill(); strokeInk(g, PAL.out, w * 0.8);
      g.fillStyle = iris; circ(g, ex, ey + er * 0.08, er * 0.58); g.fill();
      g.fillStyle = PAL.ink; circ(g, ex, ey + er * 0.12, er * 0.28); g.fill();
      g.fillStyle = PAL.paper; circ(g, ex - er * 0.25, ey - er * 0.2, er * 0.16); g.fill();
    }
  }

  // ---------------------------------------------------------------- player & props
  function bPlayer(g, v) {                    // 0 body+shadow, 1 paper flash, 2 plain amber (ghost)
    var R = 14, w = Math.max(2.4, 1.5 / curS) * inkM;
    if (v === 0) shadow(g, 0, R * 1.0, R * 0.85, R * 0.28);
    if (v !== 1) { ell(g, 0, 0, R * 0.97, R * 1.04); strokeInk(g, PAL.paper, w * 2 + 3.2); }
    ell(g, 0, 0, R * 0.97, R * 1.04); g.fillStyle = PAL.amber; g.fill(); strokeInk(g, PAL.ink, w);
    g.fillStyle = PAL.amberLt; ell(g, -R * 0.32, -R * 0.36, R * 0.24, R * 0.36, -0.5); g.fill();
    g.fillStyle = '#E8955F'; ell(g, -R * 0.56, R * 0.26, R * 0.19, R * 0.12); g.fill(); ell(g, R * 0.56, R * 0.26, R * 0.19, R * 0.12); g.fill();
  }
  function bSprout(g) {
    var w = Math.max(2.0, 1.4 / curS) * inkM;
    g.beginPath(); g.moveTo(0, 2); g.lineTo(0, -5); strokeInk(g, PAL.ink, 4 + w); strokeInk(g, PAL.rootDk, 3.2);
    for (var s = -1; s <= 1; s += 2) {
      g.beginPath(); g.moveTo(0, -4);
      g.bezierCurveTo(s * 1, -11, s * 6, -15, s * 12, -12);
      g.bezierCurveTo(s * 11, -5, s * 6, -2, 0, -4);
      g.fillStyle = PAL.root; g.fill(); strokeInk(g, PAL.ink, w);
      g.beginPath(); g.moveTo(s * 1.5, -5); g.quadraticCurveTo(s * 6, -8, s * 9.5, -10.5); strokeInk(g, PAL.rootDk, 1.2);
    }
  }
  function bSeed(g) {                         // projectile: points +x
    var R = 6, w = Math.max(1.8, 1.4 / curS) * inkM;
    g.beginPath(); g.moveTo(R * 1.5, 0); g.bezierCurveTo(R * 0.7, -R * 0.95, -R * 0.95, -R, -R * 0.95, 0);
    g.bezierCurveTo(-R * 0.95, R, R * 0.7, R * 0.95, R * 1.5, 0); g.closePath();
    g.fillStyle = PAL.amberLt; g.fill(); strokeInk(g, PAL.ink, w);
    g.fillStyle = PAL.paper; circ(g, -R * 0.1, -R * 0.38, R * 0.22); g.fill();
  }
  function bXp(g) {                           // pickup seed, points up, with a leaf cap
    var R = 7.5, w = Math.max(1.8, 1.4 / curS) * inkM;
    shadow(g, 0, R * 1.35, R * 0.8, R * 0.26);
    g.beginPath(); g.moveTo(0, -R * 1.5); g.bezierCurveTo(R * 0.95, -R * 0.7, R, R * 0.95, 0, R * 1.05);
    g.bezierCurveTo(-R, R * 0.95, -R * 0.95, -R * 0.7, 0, -R * 1.5); g.closePath();
    g.fillStyle = PAL.amber; g.fill(); strokeInk(g, PAL.ink, w);
    g.fillStyle = PAL.amberLt; ell(g, -R * 0.3, -R * 0.1, R * 0.2, R * 0.4, 0.2); g.fill();
    g.save(); g.translate(R * 0.05, -R * 1.4); g.rotate(-0.7); lens(g, R * 1.1, R * 0.32); g.fillStyle = PAL.root; g.fill(); strokeInk(g, PAL.ink, w * 0.7); g.restore();
    if (curCb) { g.beginPath(); g.moveTo(-R * 0.5, R * 0.45); g.lineTo(R * 0.5, R * 0.45); strokeInk(g, PAL.ink, w * 0.9); }
  }
  function bHeal(g) {
    var R = 9, w = Math.max(1.8, 1.4 / curS) * inkM;
    shadow(g, 0, R * 1.2, R * 0.9, R * 0.26);
    g.save(); g.rotate(-0.8); lens(g, R * 2.3, R * 0.95);
    g.fillStyle = PAL.root; g.fill(); strokeInk(g, PAL.ink, w);
    g.beginPath(); g.moveTo(-R * 1.0, 0); g.lineTo(R * 0.95, 0); strokeInk(g, PAL.paper, w * 0.8);
    g.beginPath(); g.moveTo(-R * 0.1, 0); g.lineTo(R * 0.35, -R * 0.45); g.moveTo(R * 0.1, 0); g.lineTo(R * 0.5, R * 0.42); strokeInk(g, PAL.paper, w * 0.55);
    g.restore();
    g.beginPath(); g.moveTo(-R * 0.55, R * 0.6); g.lineTo(-R * 0.95, R * 1.0); strokeInk(g, PAL.ink, w * 1.3);
    if (curCb) { g.fillStyle = PAL.paper; circ(g, R * 0.7, -R * 0.2, R * 0.2); g.fill(); }
  }
  function bHaz(g) {                          // dripping violet blob
    var R = 10, w = Math.max(2.0, 1.5 / curS) * inkM, rnd = rng(71);
    var drops = [[-R * 0.4, R * 1.1, R * 0.2], [R * 0.45, R * 1.25, R * 0.15]];
    for (var i = 0; i < 2; i++) {
      var d = drops[i];
      g.beginPath(); g.moveTo(d[0], d[1] - R * 0.7); g.quadraticCurveTo(d[0] + d[2] * 1.4, d[1], d[0], d[1] + d[2] * 1.3);
      g.quadraticCurveTo(d[0] - d[2] * 1.4, d[1], d[0], d[1] - R * 0.7);
      g.fillStyle = PAL.haz; g.fill(); strokeInk(g, PAL.out, w * 0.9);
    }
    var pts = lumps(rnd, 8, R, R * 0.92, 0.1, 0.2, 0, 0);
    blobPath(g, pts); strokeInk(g, PAL.paper, w * 2 + 2.4);
    shaded(g, blobPath, pts, PAL.haz, PAL.out, w, function (g) {
      g.fillStyle = '#7F5FB3'; ell(g, R * 0.1, R * 0.6, R, R * 0.5); g.fill();
      if (curCb) {
        g.strokeStyle = PAL.out; g.lineWidth = w * 0.9;
        for (var k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(k * R * 0.55 - R, R); g.lineTo(k * R * 0.55 + R, -R); g.stroke(); }
      }
    });
    g.fillStyle = PAL.hazLt; ell(g, -R * 0.3, -R * 0.38, R * 0.3, R * 0.17, -0.5); g.fill();
    g.fillStyle = PAL.out; circ(g, -R * 0.25, 0, R * 0.1); g.fill(); circ(g, R * 0.2, 0.05 * R, R * 0.1); g.fill();
  }
  function bPetal(g) {
    var R = 10, w = Math.max(1.9, 1.4 / curS) * inkM;
    g.beginPath(); g.moveTo(0, -R * 1.25);
    g.bezierCurveTo(R * 0.95, -R * 0.45, R * 0.8, R * 0.6, 0, R * 0.95);
    g.bezierCurveTo(-R * 0.8, R * 0.6, -R * 0.95, -R * 0.45, 0, -R * 1.25); g.closePath();
    g.fillStyle = PAL.paper; g.fill(); strokeInk(g, PAL.ink, w);
    g.beginPath(); g.moveTo(0, -R * 0.9); g.lineTo(0, R * 0.55); strokeInk(g, PAL.amber, w * 0.9);
    g.fillStyle = PAL.fire; circ(g, 0, R * 0.62, R * 0.17); g.fill();
  }
  function bFlame(g) {
    var R = 4, w = Math.max(1.3, 1.2 / curS) * inkM;
    g.beginPath(); g.moveTo(0, -R * 1.7); g.bezierCurveTo(R * 0.9, -R * 0.6, R * 1.1, R * 0.5, 0, R); g.bezierCurveTo(-R * 1.1, R * 0.5, -R * 0.9, -R * 0.6, 0, -R * 1.7);
    g.closePath(); g.fillStyle = PAL.fire; g.fill(); strokeInk(g, PAL.ink, w);
    g.fillStyle = PAL.amber; ell(g, 0, R * 0.25, R * 0.4, R * 0.6); g.fill();
  }
  function bTendril(g) {                      // roots wrapping the lower half of a 13px enemy
    var R = 13, w = Math.max(1.4, 1.2 / curS) * inkM, xs = [-0.85, -0.05, 0.75];
    for (var i = 0; i < 3; i++) {
      var x = xs[i] * R, s = i === 1 ? -1 : 1;
      g.beginPath(); g.moveTo(x, R * 0.95); g.quadraticCurveTo(x + s * R * 0.5, R * 0.3, x - s * R * 0.1, -R * 0.1);
      g.quadraticCurveTo(x - s * R * 0.35, -R * 0.4, x - s * R * 0.05, -R * 0.55);
      strokeInk(g, PAL.ink, R * 0.2 + w); strokeInk(g, PAL.root, R * 0.2);
    }
  }
  function bLitter(g, v) {                    // trail: little leaf cluster
    var cols = [['#B5834A', '#8A6A3E'], ['#9AA04A', '#6E7A3A'], ['#C0694A', '#9B4F36']][v % 3], w = Math.max(1.2, 1.1 / curS) * inkM;
    var P = [[-9, 2, 0.5, 9], [0, -2, -0.3, 11], [8, 2, 0.9, 8]];
    for (var i = 0; i < 3; i++) {
      g.save(); g.translate(P[i][0], P[i][1]); g.rotate(P[i][2]); lens(g, P[i][3], 2.6);
      g.fillStyle = i === 1 ? cols[0] : cols[1]; g.fill(); strokeInk(g, PAL.ink, w); g.restore();
    }
  }

  // ---------------------------------------------------------------- flowers (vector, used by crisp sprites and the bloom map)
  var FCOLS = [[PAL.paper], [PAL.fire], [PAL.stone], [PAL.root], [PAL.fire, PAL.wind, PAL.root, PAL.stone, PAL.paper], [PAL.paper]];
  var FCEN = [PAL.wind, PAL.amber, PAL.fire, PAL.paper, PAL.amber, PAL.amber];
  function petals(g, n, rot, dist, rx, ry, cols, w) {
    var i;
    for (i = 0; i < n; i++) { g.save(); g.rotate(rot + i / n * TAU); ell(g, dist, 0, rx, ry); g.fillStyle = PAL.ink; g.fill(); strokeInk(g, PAL.ink, w * 2); g.restore(); }
    for (i = 0; i < n; i++) { g.save(); g.rotate(rot + i / n * TAU); ell(g, dist, 0, rx, ry); g.fillStyle = cols[i % cols.length]; g.fill(); g.restore(); }
  }
  function flowerVec(g, kid, v, R, w) {
    var rot = 0.2 + v * 0.42;
    if (kid === 5) {
      petals(g, 8, rot, R * 0.6, R * 0.34, R * 0.2, FCOLS[5], w);
      petals(g, 5, rot + 0.3, R * 0.34, R * 0.26, R * 0.19, FCOLS[4], w);
      circ(g, 0, 0, R * 0.2);
    } else {
      petals(g, 5, rot, R * 0.52, R * 0.42, R * 0.3, FCOLS[kid], w);
      circ(g, 0, 0, R * 0.27);
    }
    g.fillStyle = FCEN[kid]; g.fill(); strokeInk(g, PAL.ink, w);
  }
  function bFlower(g, kid, v) {
    var R = FLOWER_R[kid];
    flowerVec(g, kid, v, R, Math.max(1.6, R * 0.1, 1.3 / curS));
  }

  function build(id, v) {
    var tint = v === 3 && id < 6 ? PAL.paper : null;
    var fl = v === 3;
    switch (id) {
      case 0: return mk(14, 20, function (g) { bSpore(g, fl); }, tint);
      case 1: return mk(19, 18, function (g) { bMold(g, fl); }, tint);
      case 2: return mk(34, 33, function (g) { bBrute(g, fl); }, tint);
      case 3: return mk(25, 20, function (g) { bSpitter(g, fl); }, tint);
      case 4: return mk(56, 58, function (g) { bCore(g, fl); }, tint);
      case 5: return mk(92, 100, function (g) { bMother(g, fl, fl ? 0 : v); }, tint);
      case ID.PLAYER: return mk(22, 24, function (g) { bPlayer(g, v); }, v === 1 ? PAL.paper : null);
      case ID.SPROUT: return mk(16, 18, bSprout);
      case ID.SEED: return mk(12, 9, bSeed);
      case ID.XP: return mk(11, 15, bXp);
      case ID.HEAL: return mk(13, 15, bHeal);
      case ID.HAZ: return mk(15, 18, bHaz);
      case ID.PETAL: return mk(13, 15, bPetal);
      case ID.FLAME: return mk(7, 9, bFlame);
      case ID.TENDRIL: return mk(17, 17, bTendril);
      case ID.LITTER: return mk(18, 8, function (g) { bLitter(g, v); });
      default:
        if (id >= ID.FLOWER && id < ID.FLOWER + 6) {
          var kid = id - ID.FLOWER, hw = FLOWER_R[kid] * 1.08;
          return mk(hw, hw, function (g) { bFlower(g, kid, v); });
        }
    }
    return mk(8, 8, function (g) { circ(g, 0, 0, 5); g.fillStyle = PAL.paper; g.fill(); });
  }

  // ---------------------------------------------------------------- ground chunks
  var chunks = {}, chunkN = 0;
  function tuft(g, x, y, s, rnd) {
    var n = 3 + (rnd() * 2 | 0), i;
    for (i = 0; i < n; i++) {
      var f = i / (n - 1) - 0.5, tipx = x + f * s * 1.1 + (rnd() - 0.5) * s * 0.3, tipy = y - s * (0.7 + (1 - Math.abs(f) * 1.4) * 0.5 + rnd() * 0.2);
      g.beginPath(); g.moveTo(x + f * s * 0.35 - s * 0.14, y);
      g.quadraticCurveTo(x + f * s * 0.4, y - s * 0.5, tipx, tipy);
      g.quadraticCurveTo(x + f * s * 0.45 + s * 0.05, y - s * 0.4, x + f * s * 0.35 + s * 0.14, y);
      g.closePath(); g.fillStyle = Math.abs(f) < 0.2 ? PAL.grassLt : PAL.grass; g.fill(); strokeInk(g, PAL.grassDk, 1.3);
    }
  }
  function buildChunk(cx, cy) {
    var CH = cfg.chunk, c = makeCanvas(CH, CH), g = c.getContext('2d'), rnd = rng((cx + 40) * 73856093 ^ (cy + 40) * 19349663), i;
    g.lineJoin = 'round'; g.lineCap = 'round';
    g.fillStyle = PAL.ground; g.fillRect(0, 0, CH, CH);
    for (i = 0; i < 6; i++) {
      var r = 34 + rnd() * 38, px = r + 8 + rnd() * (CH - 2 * r - 16), py = r + 8 + rnd() * (CH - 2 * r - 16);
      blobPath(g, lumps(rnd, 8, r, r * 0.8, 0.18, rnd() * 6, px, py)); g.fillStyle = i % 2 ? PAL.groundA : PAL.groundB; g.fill();
    }
    for (i = 0; i < 26; i++) tuft(g, 16 + rnd() * (CH - 32), 26 + rnd() * (CH - 40), 8 + rnd() * 7, rnd);
    for (i = 0; i < 9; i++) {
      var qx = 14 + rnd() * (CH - 28), qy = 14 + rnd() * (CH - 28), qs = 3 + rnd() * 4;
      ell(g, qx, qy, qs * 1.3, qs, rnd() - 0.5); g.fillStyle = PAL.pebble; g.fill(); strokeInk(g, PAL.ink, 1.5);
      g.fillStyle = PAL.pebbleLt; ell(g, qx - qs * 0.3, qy - qs * 0.3, qs * 0.4, qs * 0.25, -0.4); g.fill();
    }
    var lc = ['#8A6A3E', '#9B4F36', '#6E7A3A', '#A8864A'];
    for (i = 0; i < 22; i++) {
      g.save(); g.translate(10 + rnd() * (CH - 20), 10 + rnd() * (CH - 20)); g.rotate(rnd() * TAU);
      lens(g, 7 + rnd() * 4, 2.2); g.fillStyle = lc[(rnd() * 4) | 0]; g.fill(); strokeInk(g, PAL.ink, 1.1); g.restore();
    }
    stats.chunkBuilds++;
    return c;
  }
  function getChunk(cx, cy) {
    var key = cy * 64 + cx, e = chunks[key];
    if (!e) { e = chunks[key] = { c: buildChunk(cx, cy), used: T }; chunkN++; }
    e.used = T;
    return e.c;
  }
  function pruneChunks() {
    if (chunkN <= cfg.chunkCache) return;
    var k, oldest = null, ot = 1e9;
    for (k in chunks) if (chunks[k].used < ot) { ot = chunks[k].used; oldest = k; }
    if (oldest !== null && ot < T) { delete chunks[oldest]; chunkN--; }
  }

  // ---------------------------------------------------------------- bloom map
  var bloom = { map: null, g: null, pending: [], n: 0, fx: [], fy: [], fk: [], fv: [], fs: [], grid: null, seed: rng(777) };
  function bloomInit() {
    if (bloom.map) return;
    var size = Math.ceil(cfg.worldHalf * 2 * cfg.bloomScale);
    bloom.map = makeCanvas(size, size);
    bloom.g = bloom.map.getContext('2d');
    bloom.g.lineJoin = 'round';
    bloom.grid = [];
    for (var i = 0; i < 256; i++) bloom.grid.push([]);
  }
  function paintBloom(f) {
    var g = bloom.g, s = cfg.bloomScale, R = FLOWER_R[f.k];
    g.setTransform(s, 0, 0, s, (f.x + cfg.worldHalf) * s, (f.y + cfg.worldHalf) * s);
    g.save(); g.scale(f.s * cfg.bloomMapMul, f.s * cfg.bloomMapMul);
    flowerVec(g, f.k, f.v, R, Math.max(2.4, R * 0.12));
    g.restore();
    if (bloom.n < cfg.flowerCap) {
      var i = bloom.n++;
      bloom.fx[i] = f.x; bloom.fy[i] = f.y; bloom.fk[i] = f.k; bloom.fv[i] = f.v; bloom.fs[i] = f.s;
      var cxl = clamp(((f.x + cfg.worldHalf) / 250) | 0, 0, 15), cyl = clamp(((f.y + cfg.worldHalf) / 250) | 0, 0, 15);
      bloom.grid[cyl * 16 + cxl].push(i);
    }
  }
  function flushBloom(all) {
    var p = bloom.pending, n = 0;
    while (n < p.length && (all || T - p[n].t0 >= cfg.bloomPop)) { paintBloom(p[n]); n++; }
    if (n) p.splice(0, n);
  }
  function onBloom(d) {
    bloomInit();
    var k = KID[d.kind]; if (k === undefined) k = 1;
    var r = bloom.seed();
    bloom.pending.push({ x: d.x, y: d.y, k: k, v: (r * 3) | 0, s: 0.88 + bloom.seed() * 0.26, t0: T });
    if (bloom.pending.length > 500) flushBloom(true);
  }

  // ---------------------------------------------------------------- effects & numbers (pools)
  var fx = [], fxNext = 0, nums = [], numNext = 0;
  (function () {
    var i;
    for (i = 0; i < cfg.fxMax; i++) fx.push({ on: false, type: 0, x: 0, y: 0, t0: 0, life: 1, r: 1, a: 0, n: 0, col: PAL.paper });
    for (i = 0; i < cfg.numMax; i++) nums.push({ on: false, x: 0, y: 0, t0: 0, text: '', crit: false, col: PAL.paper, dx: 0 });
  })();
  function addFx(type, x, y, r, life, n, col, a) {
    var f = fx[fxNext]; fxNext = (fxNext + 1) % fx.length;
    f.on = true; f.type = type; f.x = x; f.y = y; f.r = r; f.life = life; f.n = n || 0; f.col = col || PAL.paper; f.a = a || 0; f.t0 = T;
  }
  var NOVA = 1, BURST = 2, SPARK = 3, DUST = 4, TWINKLE = 5, LEAVES = 6;
  function addNum(x, y, text, crit, col) {
    var n = nums[numNext]; numNext = (numNext + 1) % nums.length;
    n.on = true; n.x = x; n.y = y; n.t0 = T; n.text = text; n.crit = !!crit; n.col = col; n.dx = (Math.random() - 0.5) * 16;
  }
  function numText(d) {
    d = Math.round(d);
    return d >= 10000 && OG.fmt ? OG.fmt(d) : String(d);
  }
  function startShake(pair) {
    if (!settings().shake && settings().shake !== undefined) return;
    if (pair[0] >= shakeAmp * (shakeT > 0 ? shakeT / shakeDur : 0)) { shakeAmp = pair[0]; shakeDur = pair[1]; shakeT = pair[1]; }
  }
  function settings() { return (OG.state && OG.state.meta && OG.state.meta.settings) || {}; }

  // ---------------------------------------------------------------- events
  var KBURST = { spore: [4, 14], mold: [6, 20], brute: [8, 34], spitter: [6, 20], core: [14, 70], mother: [18, 120] };
  function resetRunVisuals() {
    zoomAnim = null; camInit = false; lastPX = null; pvx = pvy = 0; stretch = 0; ghosts.length = 0;
    for (var i = 0; i < fx.length; i++) fx[i].on = false;
    for (i = 0; i < nums.length; i++) nums[i].on = false;
    shakeT = 0; hitRec = {}; hitRecN = 0; tmax = 0.6; trailMax = 0.5;
  }
  var ghosts = [];
  if (OG.bus) {
    OG.bus.on('flower:bloom', onBloom);
    OG.bus.on('enemy:hit', function (d) {
      addNum(d.x, d.y - 8, numText(d.dmg), d.crit, d.crit ? PAL.fire : PAL.paper);
      addFx(SPARK, d.x, d.y, d.crit ? 16 : 9, 0.22, 4, d.crit ? PAL.fire : PAL.paper, (d.x * 7 + d.y * 3) % 6);
    });
    OG.bus.on('enemy:die', function (d) {
      var kb = KBURST[d.kind] || KBURST.mold;
      addFx(BURST, d.x, d.y, kb[1], 0.4, kb[0], PAL.blight, d.x % 6);
      if (d.kind === 'core' || d.kind === 'mother') addFx(NOVA, d.x, d.y, kb[1] * 2, 0.6);
    });
    OG.bus.on('fx:nova', function (d) { addFx(NOVA, d.x, d.y, d.r, 0.45); });
    OG.bus.on('player:dash', function (d) { addFx(DUST, d.x, d.y, 22, 0.35, 5, PAL.grassLt, d.x % 6); });
    OG.bus.on('xp:pickup', function (d) { addFx(TWINKLE, d.x, d.y, 9, 0.28); });
    OG.bus.on('player:heal', function (d) {
      var P = OG.state.player;
      addNum(P.x, P.y - 24, '+' + numText(d.amount), false, PAL.root);
      addFx(LEAVES, P.x, P.y, 26, 0.55, 5, PAL.root, 0);
    });
    OG.bus.on('player:hurt', function () { hurtUntil = T + 0.1; startShake(cfg.shakeHurt); });
    OG.bus.on('boss:spawn', function () { startShake(cfg.shakeBoss); });
    OG.bus.on('boss:dead', function () { startShake(cfg.shakeBoss); });
    OG.bus.on('run:start', resetRunVisuals);
    OG.bus.on('settings:change', function () { table.length = 0; });
  }

  // ---------------------------------------------------------------- camera
  function updateCamera(dt, w, h) {
    var P = OG.state.player, base = Math.min(w, h) / cfg.span;
    if (zoomAnim) {
      var a = zoomAnim, p = clamp((T - a.t0) / a.dur, 0, 1), e = easeInOut(p);
      cam.x = a.fx + (a.tx - a.fx) * e; cam.y = a.fy + (a.ty - a.fy) * e;
      cam.zoom = Math.exp(Math.log(a.fz) + (Math.log(a.tz) - Math.log(a.fz)) * e);
      a.p = p;
      if (p >= 1 && !a.done) { a.done = true; var cb = a.cb; a.cb = null; if (cb) { try { cb(); } catch (err) { if (typeof console !== 'undefined') console.error(err); } } }
      return;
    }
    cam.zoom = base;
    var tx = P.x + clamp(pvx * cfg.lead, -cfg.leadMax, cfg.leadMax), ty = P.y + clamp(pvy * cfg.lead, -cfg.leadMax, cfg.leadMax);
    if (!camInit) { cam.x = tx; cam.y = ty; camInit = true; }
    else { var k = 1 - Math.exp(-cfg.follow * dt); cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; }
  }

  // ---------------------------------------------------------------- drawing
  var vis = [];
  function byY(a, b) { return a.y - b.y; }
  function setBase(ctx) { ctx.setTransform(Z, 0, 0, Z, TX, TY); }
  function put(ctx, sp, x, y, k, rot, sx, sy) {
    var c = Math.cos(rot), s = Math.sin(rot), kx = k * sx * Z, ky = k * sy * Z;
    ctx.setTransform(c * kx, s * kx, -s * ky, c * ky, TX + Z * x, TY + Z * y);
    ctx.drawImage(sp.c, -sp.ox, -sp.oy, sp.w, sp.h);
  }
  function isFlashing(e) {
    var hv = e.hit;
    if (!(hv > 0)) { var r0 = hitRec[e.id]; if (r0) r0.p = 0; return false; }
    var rec = hitRec[e.id];
    if (!rec) { rec = hitRec[e.id] = { p: 0, s: -9 }; if (++hitRecN > 3000) { hitRec = {}; hitRecN = 0; } }
    if (hv > rec.p || rec.p === 0) rec.s = T;
    rec.p = hv;
    return T - rec.s < cfg.flashSec;
  }

  function drawGround(ctx, w, h, dpr, L, R, Tp, B) {
    var HW = cfg.worldHalf, CH = cfg.chunk;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, w, h);
    setBase(ctx);
    ctx.fillStyle = PAL.ground; ctx.fillRect(-HW, -HW, HW * 2, HW * 2);
    if (cam.zoom >= cfg.chunkMinZoom) {
      var c0 = Math.max(0, Math.floor((L + HW) / CH)), c1 = Math.min(7, Math.floor((R + HW) / CH));
      var r0 = Math.max(0, Math.floor((Tp + HW) / CH)), r1 = Math.min(7, Math.floor((B + HW) / CH));
      for (var cy = r0; cy <= r1; cy++) for (var cx = c0; cx <= c1; cx++)
        ctx.drawImage(getChunk(cx, cy), cx * CH - HW - 0.5, cy * CH - HW - 0.5, CH + 1, CH + 1);
      pruneChunks();
    }
    ctx.strokeStyle = PAL.ink; ctx.lineWidth = 60; ctx.strokeRect(-HW - 30, -HW - 30, HW * 2 + 60, HW * 2 + 60);
    ctx.strokeStyle = PAL.grass; ctx.lineWidth = 8; ctx.strokeRect(-HW + 4, -HW + 4, HW * 2 - 8, HW * 2 - 8);
  }

  function drawBloom(ctx, L, R, Tp, B) {
    bloomInit();
    flushBloom(false);
    var z = cam.zoom, crisp = clamp((z - cfg.crispMinZoom) / (cfg.crispFull - cfg.crispMinZoom), 0, 1);
    var HW = cfg.worldHalf, s = cfg.bloomScale, i, n = 0;
    if (crisp < 1) {
      var sx = clamp((L + HW) * s, 0, bloom.map.width), sy = clamp((Tp + HW) * s, 0, bloom.map.height);
      var ex = clamp((R + HW) * s, 0, bloom.map.width), ey = clamp((B + HW) * s, 0, bloom.map.height);
      if (ex - sx > 1 && ey - sy > 1) {
        ctx.globalAlpha = 1 - crisp;
        ctx.drawImage(bloom.map, sx, sy, ex - sx, ey - sy, sx / s - HW, sy / s - HW, (ex - sx) / s, (ey - sy) / s);
        ctx.globalAlpha = 1;
      }
    }
    if (crisp > 0) {
      ctx.globalAlpha = crisp;
      var gx0 = clamp(((L - 30 + HW) / 250) | 0, 0, 15), gx1 = clamp(((R + 30 + HW) / 250) | 0, 0, 15);
      var gy0 = clamp(((Tp - 30 + HW) / 250) | 0, 0, 15), gy1 = clamp(((B + 30 + HW) / 250) | 0, 0, 15);
      for (var gy = gy0; gy <= gy1 && n < cfg.flowerVisCap; gy++) for (var gx = gx0; gx <= gx1; gx++) {
        var cell = bloom.grid[gy * 16 + gx];
        for (i = 0; i < cell.length; i++) {
          var f = cell[i], x = bloom.fx[f], y = bloom.fy[f];
          if (x < L - 40 || x > R + 40 || y < Tp - 40 || y > B + 40) continue;
          var sp = spr(ID.FLOWER + bloom.fk[f], bloom.fv[f]), k = bloom.fs[f];
          ctx.drawImage(sp.c, x - sp.ox * k, y - sp.oy * k, sp.w * k, sp.h * k);
          if (++n >= cfg.flowerVisCap) break;
        }
      }
      ctx.globalAlpha = 1;
    }
    stats.drawn.flowers = n;
    var p = bloom.pending;                    // popping flowers
    if (crisp > 0) for (i = 0; i < p.length; i++) {
      var q = p[i], age = (T - q.t0) / cfg.bloomPop;
      if (age < 0 || q.x < L - 40 || q.x > R + 40 || q.y < Tp - 40 || q.y > B + 40) continue;
      var sc = easeBack(clamp(age, 0, 1)) * q.s * 1.08, sp2 = spr(ID.FLOWER + q.k, q.v);
      put(ctx, sp2, q.x, q.y, sc, (1 - clamp(age, 0, 1)) * 0.8, 1, 1);
    }
    setBase(ctx);
  }

  function drawPickups(ctx, L, R, Tp, B) {
    var arr = OG.state.pickups, n = 0, cb = cbIdx;
    if (!arr) return;
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i], x = p.x, y = p.y;
      if (x < L - 24 || x > R + 24 || y < Tp - 30 || y > B + 24) continue;
      var heal = p.kind === 'heal', sp = spr(heal ? ID.HEAL : ID.XP, 0);
      var k = heal ? 1.1 : 1 + Math.min(0.6, Math.log(1 + (p.amount || 1)) * 0.12);
      var bob = Math.sin(T * 3.2 + x * 0.07 + y * 0.05) * 2.2, pulse = 1 + Math.sin(T * 5 + x) * 0.05;
      var kk = k * pulse;
      if (cb) { ctx.drawImage(sp.c, x - sp.ox * kk * 1.18, y + bob - sp.oy * kk * 1.18, sp.w * kk * 1.18, sp.h * kk * 1.18); }
      ctx.drawImage(sp.c, x - sp.ox * kk, y + bob - sp.oy * kk, sp.w * kk, sp.h * kk);
      n++;
    }
    stats.drawn.pickups = n;
  }

  function drawTrails(ctx, L, R, Tp, B) {
    var arr = OG.state.trails, n = 0;
    if (!arr || !arr.length) return;
    for (var i = 0; i < arr.length; i++) { if (arr[i].life > trailMax) trailMax = arr[i].life; }
    for (i = 0; i < arr.length; i++) {
      var t = arr[i], x = t.x, y = t.y, r = t.r || 10;
      if (x < L - r - 20 || x > R + r + 20 || y < Tp - r - 20 || y > B + r + 20) continue;
      var h = ((x * 7.3 + y * 13.1) | 0), v = ((h % 3) + 3) % 3, sp = spr(ID.LITTER, v);
      var a = clamp(t.life / trailMax * 2.5, 0, 1), k = Math.max(0.5, r / 10);
      if (a < 1) ctx.globalAlpha = a;
      put(ctx, sp, x, y, k, (h % 628) / 100, 1, 1);
      if (a < 1) ctx.globalAlpha = 1;
      n++;
    }
    setBase(ctx);
    stats.drawn.trails = n;
  }

  function drawEnemies(ctx, L, R, Tp, B) {
    var arr = OG.state.enemies, P = OG.state.player, vn = 0, i;
    if (!arr) return;
    for (i = 0; i < arr.length; i++) {
      var e = arr[i], m = (e.r || 12) * 1.9 + 24;
      if (e.x < L - m || e.x > R + m || e.y < Tp - m || e.y > B + m) continue;
      vis[vn++] = e;
    }
    vis.length = vn;
    vis.sort(byY);
    var fl, kid, e2, k, phase, sp, ws, rot, sx, sy, flip, id;
    for (i = 0; i < vn; i++) {
      e2 = vis[i]; kid = KID[e2.kind]; if (kid === undefined) kid = 1;
      id = e2.id || 0; k = (e2.r || ER[kid]) / ER[kid]; phase = 0;
      if (kid === 5 && e2.maxHp > 0) { var rr = e2.hp / e2.maxHp; phase = rr <= 0.33 ? 2 : (rr <= 0.66 ? 1 : 0); }
      fl = isFlashing(e2);
      sp = spr(kid, fl ? 3 : phase);
      ws = Math.sin(T * WOB_F[kid] + id * 1.7);
      sx = 1 + WOB_A[kid] * ws; sy = 1 - WOB_A[kid] * ws; rot = Math.sin(T * WOB_F[kid] * 0.6 + id * 2.3) * WOB_A[kid] * 0.7;
      flip = kid === 3 ? (e2.x > P.x ? -1 : 1) : ((id & 1) ? -1 : 1);
      put(ctx, sp, e2.x, e2.y, k, rot, sx * flip, sy);
      if (e2.slow > 0) put(ctx, spr(ID.TENDRIL, 0), e2.x, e2.y + ER[kid] * k * 0.05, k * ER[kid] / 13, 0, 1, 1);
      if (e2.burn > 0) {
        var f = spr(ID.FLAME, 0), rad = ER[kid] * k;
        for (var j = 0; j < 3; j++) {
          var ph = (T * 1.8 + j / 3 + id * 0.13) % 1, a = T * 2.4 + j * 2.09 + id;
          put(ctx, f, e2.x + Math.cos(a) * rad * 0.65, e2.y - rad * 0.15 - ph * rad * 1.05, (1 - ph * 0.55) * Math.max(0.8, rad / 16), 0, 1, 1);
        }
      }
    }
    setBase(ctx);
    for (i = 0; i < vn; i++) {                // boss health bars
      e2 = vis[i];
      if ((e2.kind === 'core' || e2.kind === 'mother') && e2.maxHp > 0) {
        kid = KID[e2.kind]; var bw = ER[kid] * (e2.r / ER[kid]) * 1.5, by = e2.y - e2.r * 1.25 - 12;
        ctx.fillStyle = PAL.ink; ctx.fillRect(e2.x - bw / 2 - 3, by - 3, bw + 6, 12);
        ctx.fillStyle = PAL.blightDk; ctx.fillRect(e2.x - bw / 2, by, bw, 6);
        ctx.fillStyle = PAL.fire; ctx.fillRect(e2.x - bw / 2, by, bw * clamp(e2.hp / e2.maxHp, 0, 1), 6);
      }
    }
    stats.drawn.enemies = vn;
    vis.length = 0;
  }

  function drawProjectiles(ctx, L, R, Tp, B) {
    var arr = OG.state.projectiles, n = 0, i, p, any = false;
    if (!arr || !arr.length) return;
    ctx.beginPath();
    for (i = 0; i < arr.length; i++) {
      p = arr[i];
      if (p.x < L - 30 || p.x > R + 30 || p.y < Tp - 30 || p.y > B + 30) continue;
      ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); any = true;
    }
    if (any) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = PAL.amberLt; ctx.lineWidth = 6; ctx.stroke();
      ctx.strokeStyle = PAL.paper; ctx.lineWidth = 2.4; ctx.stroke();
    }
    var sp = spr(ID.SEED, 0);
    for (i = 0; i < arr.length; i++) {
      p = arr[i];
      if (p.x < L - 30 || p.x > R + 30 || p.y < Tp - 30 || p.y > B + 30) continue;
      var sd = Math.sqrt(p.vx * p.vx + p.vy * p.vy) || 1, c = p.vx / sd, s = p.vy / sd, k = Math.max(0.7, (p.r || 5) / 5) * Z;
      ctx.setTransform(c * k, s * k, -s * k, c * k, TX + Z * p.x, TY + Z * p.y);
      ctx.drawImage(sp.c, -sp.ox, -sp.oy, sp.w, sp.h);
      n++;
    }
    setBase(ctx);
    stats.drawn.projectiles = n;
  }

  function drawPlayer(ctx, dt) {
    var P = OG.state.player, S = OG.state;
    var k = (P.r || 14) / 14, i;
    // velocity measured from position change so it works whatever unit P.vx uses
    if (lastPX !== null && dt > 0) {
      var ivx = (P.x - lastPX) / dt, ivy = (P.y - lastPY) / dt, q = 1 - Math.exp(-12 * dt);
      pvx += (ivx - pvx) * q; pvy += (ivy - pvy) * q;
    }
    lastPX = P.x; lastPY = P.y;
    var spd = Math.sqrt(pvx * pvx + pvy * pvy), ms = (S.stats && S.stats.moveSpeed) || 150;
    if (spd > 12) { var q2 = 1 - Math.exp(-14 * dt); eyeX += (pvx / spd - eyeX) * q2; eyeY += (pvy / spd - eyeY) * q2; }
    var dashing = !!P.dashing, tgt = dashing ? 0.5 : clamp(spd / ms, 0, 1.2) * 0.12;
    stretch += (tgt - stretch) * (1 - Math.exp(-18 * dt));
    var bounce = spd > 12 ? Math.abs(Math.sin(T * 14)) * 0.05 * clamp(spd / ms, 0, 1) : Math.sin(T * 2.6) * 0.018;
    var ang = spd > 12 ? Math.atan2(pvy, pvx) : Math.atan2(eyeY, eyeX), ca = Math.cos(ang), sa = Math.sin(ang);
    var sxs = 1 + stretch + bounce * 0.5, sys = 1 / (1 + stretch * 0.8) - bounce * 0.6;

    if (dashing) { ghosts.push({ x: P.x, y: P.y, t: T, a: ang, s: sxs, q: sys }); if (ghosts.length > 8) ghosts.shift(); }
    var gp = spr(ID.PLAYER, 2);
    for (i = ghosts.length - 1; i >= 0; i--) {
      var gh = ghosts[i], ga = 1 - (T - gh.t) / 0.28;
      if (ga <= 0) { ghosts.splice(i, 1); continue; }
      ctx.globalAlpha = ga * 0.45;
      var gc = Math.cos(gh.a), gs = Math.sin(gh.a), A = gh.s * gc * gc + gh.q * gs * gs, D = gh.s * gs * gs + gh.q * gc * gc, Bm = (gh.s - gh.q) * gs * gc;
      ctx.setTransform(Z * k * A, Z * k * Bm, Z * k * Bm, Z * k * D, TX + Z * gh.x, TY + Z * gh.y);
      ctx.drawImage(gp.c, -gp.ox, -gp.oy, gp.w, gp.h);
    }
    ctx.globalAlpha = 1;

    if (P.invuln > 0 && !dashing && ((T * 14) | 0) % 2 === 0) { setBase(ctx); return; }   // blink while invulnerable
    var A2 = sxs * ca * ca + sys * sa * sa, D2 = sxs * sa * sa + sys * ca * ca, B2 = (sxs - sys) * sa * ca;
    ctx.setTransform(Z * k * A2, Z * k * B2, Z * k * B2, Z * k * D2, TX + Z * P.x, TY + Z * P.y);
    var body = spr(ID.PLAYER, T < hurtUntil ? 1 : 0);
    ctx.drawImage(body.c, -body.ox, -body.oy, body.w, body.h);
    // sprout, swaying against the movement
    var so = spr(ID.SPROUT, 0), sway = Math.sin(T * 3.1) * 0.1 - clamp(pvx / ms, -1, 1) * 0.3;
    ctx.translate(0, -12); ctx.rotate(sway);
    ctx.drawImage(so.c, -so.ox, -so.oy + 1, so.w, so.h);
    ctx.rotate(-sway); ctx.translate(0, 12);
    // eyes
    if (T > blinkAt + 0.12) blinkAt = T + 2 + Math.random() * 3;
    var blink = T >= blinkAt && T < blinkAt + 0.12, ox = eyeX * 2.6, oy = eyeY * 1.8 - 1;
    ctx.fillStyle = PAL.ink; ctx.strokeStyle = PAL.ink; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    for (i = -1; i <= 1; i += 2) {
      var ex = i * 5 + ox, ey = -1.5 + oy;
      if (blink) { ctx.beginPath(); ctx.moveTo(ex - 2.4, ey); ctx.lineTo(ex + 2.4, ey); ctx.stroke(); }
      else {
        ctx.beginPath(); ctx.ellipse(ex, ey, 2.5, 3.3, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = PAL.paper; ctx.beginPath(); ctx.arc(ex - 0.7, ey - 1.2, 0.95, 0, TAU); ctx.fill(); ctx.fillStyle = PAL.ink;
      }
    }
    ctx.beginPath(); ctx.moveTo(ox * 0.5 - 2.2, 4.4 + oy * 0.4); ctx.quadraticCurveTo(ox * 0.5, 6.4 + oy * 0.4, ox * 0.5 + 2.2, 4.4 + oy * 0.4); ctx.lineWidth = 1.5; ctx.stroke();
    setBase(ctx);
    if (P.rooted) put(ctx, spr(ID.TENDRIL, 0), P.x, P.y + 3, k * 1.15, 0, 1, 1);
    setBase(ctx);
  }

  function drawOrbits(ctx, L, R, Tp, B) {
    var arr = OG.state.orbits, P = OG.state.player;
    if (!arr || !arr.length) return;
    var sp = spr(ID.PETAL, 0);
    for (var i = 0; i < arr.length; i++) {
      var o = arr[i];
      if (o.x < L - 30 || o.x > R + 30 || o.y < Tp - 30 || o.y > B + 30) continue;
      put(ctx, sp, o.x, o.y, Math.max(0.7, (o.r || 10) / 10), Math.atan2(o.y - P.y, o.x - P.x) + Math.PI / 2 + Math.sin(T * 8 + i) * 0.15, 1, 1);
    }
    setBase(ctx);
  }

  function getStripe(ctx) {
    if (stripePat && stripeCtx === ctx) return stripePat;
    var c = makeCanvas(16, 16), g = c.getContext('2d');
    g.fillStyle = PAL.haz; g.fillRect(0, 0, 16, 16);
    g.strokeStyle = PAL.out; g.lineWidth = 4; g.beginPath();
    g.moveTo(-4, 12); g.lineTo(12, -4); g.moveTo(4, 20); g.lineTo(20, 4); g.stroke();
    stripePat = ctx.createPattern(c, 'repeat'); stripeCtx = ctx;
    return stripePat;
  }
  function drawHazards(ctx, L, R, Tp, B) {
    var arr = OG.state.hazards, n = 0;
    if (!arr || !arr.length) return;
    var sp = spr(ID.HAZ, 0), cbOn = !!cbIdx, i, h;
    for (i = 0; i < arr.length; i++) { h = arr[i]; if (typeof h.telegraph === 'number' && h.telegraph > tmax) tmax = h.telegraph; }
    for (i = 0; i < arr.length; i++) {
      h = arr[i];
      var r = h.r || 10;
      if (h.x < L - r - 30 || h.x > R + r + 30 || h.y < Tp - r - 30 || h.y > B + r + 30) continue;
      if (h.telegraph) {
        var prog = typeof h.telegraph === 'number' ? clamp(1 - h.telegraph / tmax, 0, 1) : (T * 1.2) % 1;
        ctx.beginPath(); ctx.arc(h.x, h.y, Math.max(1, r * prog), 0, TAU);
        if (cbOn) { var pat = getStripe(ctx); if (pat) ctx.fillStyle = pat; } else { ctx.fillStyle = PAL.haz; ctx.globalAlpha = 0.55; }
        ctx.fill(); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.arc(h.x, h.y, r, 0, TAU);
        ctx.setLineDash([9, 7]); ctx.lineDashOffset = -T * 16;
        ctx.strokeStyle = PAL.ink; ctx.lineWidth = cbOn ? 8 : 6; ctx.stroke();
        ctx.strokeStyle = PAL.hazLt; ctx.lineWidth = cbOn ? 4 : 3; ctx.stroke();
        ctx.setLineDash([]);
      } else {
        var wob = Math.sin(T * 7 + h.x * 0.1) * 0.06, k = r / 10;
        ctx.drawImage(sp.c, h.x - sp.ox * k * (1 + wob), h.y - sp.oy * k * (1 - wob), sp.w * k * (1 + wob), sp.h * k * (1 - wob));
      }
      n++;
    }
    stats.drawn.hazards = n;
  }

  function drawFx(ctx, L, R, Tp, B) {
    var i, j, f, age, p;
    for (i = 0; i < fx.length; i++) {
      f = fx[i]; if (!f.on) continue;
      p = (T - f.t0) / f.life;
      if (p >= 1) { f.on = false; continue; }
      var m = f.type === NOVA ? f.r + 20 : 60;
      if (f.x < L - m || f.x > R + m || f.y < Tp - m || f.y > B + m) continue;
      var e = easeOut(p), px, py, d;
      if (f.type === NOVA) {
        var rr = Math.max(1, f.r * (0.12 + 0.88 * e));
        ctx.globalAlpha = 1 - p * p * 0.7;
        ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, TAU); ctx.strokeStyle = PAL.ink; ctx.lineWidth = 2 + 8 * (1 - p); ctx.stroke();
        ctx.beginPath(); ctx.arc(f.x, f.y, rr * 0.94, 0, TAU); ctx.strokeStyle = PAL.paper; ctx.lineWidth = 1 + 3 * (1 - p); ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (f.type === BURST || f.type === DUST || f.type === LEAVES) {
        ctx.fillStyle = f.col; ctx.strokeStyle = f.type === BURST ? PAL.out : PAL.ink; ctx.lineWidth = 1.4;
        for (j = 0; j < f.n; j++) {
          var ang = j / f.n * TAU + f.a, ds = 0.65 + ((j * 7) % 3) * 0.2;
          d = f.r * e * ds; px = f.x + Math.cos(ang) * d; py = f.y + Math.sin(ang) * d * (f.type === BURST ? 1 : 0.6) - (f.type === LEAVES ? e * f.r * 0.8 : 0) + (f.type === BURST ? p * p * 8 : 0);
          var sz = Math.max(0.6, f.r * (f.type === BURST ? 0.17 : 0.12) * (1 - p));
          ctx.beginPath(); ctx.arc(px, py, sz, 0, TAU); ctx.fill(); if (sz > 2) ctx.stroke();
        }
      } else if (f.type === SPARK) {
        ctx.strokeStyle = f.col; ctx.lineWidth = Math.max(0.8, 2.6 * (1 - p)); ctx.lineCap = 'round'; ctx.beginPath();
        for (j = 0; j < f.n; j++) {
          var a2 = j / f.n * TAU + f.a * 0.5 + 0.4, d0 = f.r * (0.25 + 0.5 * p), d1 = f.r * (0.55 + 0.8 * e);
          ctx.moveTo(f.x + Math.cos(a2) * d0, f.y + Math.sin(a2) * d0); ctx.lineTo(f.x + Math.cos(a2) * d1, f.y + Math.sin(a2) * d1);
        }
        ctx.stroke();
      } else if (f.type === TWINKLE) {
        var s1 = f.r * (1 - p * p), s2 = s1 * 0.3;
        ctx.fillStyle = PAL.amberLt; ctx.beginPath();
        ctx.moveTo(f.x, f.y - s1 - p * 6); ctx.lineTo(f.x + s2, f.y - s2 - p * 6); ctx.lineTo(f.x + s1, f.y - p * 6); ctx.lineTo(f.x + s2, f.y + s2 - p * 6);
        ctx.lineTo(f.x, f.y + s1 - p * 6); ctx.lineTo(f.x - s2, f.y + s2 - p * 6); ctx.lineTo(f.x - s1, f.y - p * 6); ctx.lineTo(f.x - s2, f.y - s2 - p * 6);
        ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawNumbers(ctx, w, h, dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    var lastFont = '';
    for (var i = 0; i < nums.length; i++) {
      var n = nums[i]; if (!n.on) continue;
      var p = (T - n.t0) / cfg.numLife;
      if (p >= 1) { n.on = false; continue; }
      var sx = (n.x - cam.x) * cam.zoom + w / 2 + shx + n.dx * p, sy = (n.y - cam.y) * cam.zoom + h / 2 + shy - easeOut(p) * 34;
      if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) continue;
      var size = (n.crit ? 22 : 15) * (p < 0.15 ? 0.6 + easeBack(p / 0.15) * 0.4 : 1);
      var font = '700 ' + Math.round(size) + 'px "Baloo 2", "Be Vietnam Pro", sans-serif';
      if (font !== lastFont) { ctx.font = font; lastFont = font; }
      ctx.globalAlpha = p > 0.65 ? 1 - (p - 0.65) / 0.35 : 1;
      ctx.lineWidth = n.crit ? 5 : 4; ctx.strokeStyle = PAL.ink; ctx.strokeText(n.text, sx, sy);
      ctx.fillStyle = n.col; ctx.fillText(n.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  function drawVignette(ctx, w, h, dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = PAL.ink; ctx.globalAlpha = 0.09;
    var bw = Math.min(w, h) * 0.07;
    for (var i = 0; i < 3; i++) {
      var ins = bw * (i + 0.5) * 0.55 + 0; ctx.lineWidth = bw * (1.6 - i * 0.45) ;
      ctx.strokeRect(ins - 0, ins - 0, w - ins * 2, h - ins * 2);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- main frame
  function frame(ctx, alpha, realDt) {
    var view = OG.view || { w: 800, h: 600, dpr: 1 }, w = view.w, h = view.h, dpr = view.dpr || 1;
    var dt = clamp(realDt || 1 / 60, 0, 0.1);
    T += dt;
    var st = OG.state, set = settings(), cb = set.colorblind ? 1 : 0;
    if (cb !== curCb) { curCb = cb; table.length = 0; }
    inkM = cb ? 1.7 : 1; cbIdx = cb;
    updateCamera(dt, w, h);
    // shake
    if (shakeT > 0 && set.shake !== false) {
      shakeT = Math.max(0, shakeT - dt);
      var amp = shakeAmp * (shakeT / shakeDur);
      shx = (Math.random() - 0.5) * 2 * amp; shy = (Math.random() - 0.5) * 2 * amp;
    } else { shx = shy = 0; if (shakeT > 0) shakeT = 0; }

    var z = cam.zoom;
    Z = z * dpr; TX = dpr * (w / 2 - cam.x * z + shx); TY = dpr * (h / 2 - cam.y * z + shy);
    bucketIdx = pickBucket(Z); curS = cfg.buckets[bucketIdx];
    tableBase = (bucketIdx * 2 + cb) * ID.NS * NV;

    var hw = w / (2 * z), hh = h / (2 * z), mg = 14;
    var L = cam.x - hw - mg, R = cam.x + hw + mg, Tp = cam.y - hh - mg, B = cam.y + hh + mg;

    drawGround(ctx, w, h, dpr, L, R, Tp, B);
    drawBloom(ctx, L, R, Tp, B);

    var ea = 1;
    if (zoomAnim) ea = 1 - clamp((zoomAnim.p || 0) * 1.8, 0, 1);
    if (ea > 0.01) {
      if (ea < 1) ctx.globalAlpha = ea;
      drawPickups(ctx, L, R, Tp, B);
      drawTrails(ctx, L, R, Tp, B);
      drawEnemies(ctx, L, R, Tp, B);
      drawProjectiles(ctx, L, R, Tp, B);
      drawPlayer(ctx, dt);
      drawOrbits(ctx, L, R, Tp, B);
      drawHazards(ctx, L, R, Tp, B);
      drawFx(ctx, L, R, Tp, B);
      drawNumbers(ctx, w, h, dpr);
      ctx.globalAlpha = 1;
    } else drawPlayer(ctx, 0);
    if (cfg.vignette) drawVignette(ctx, w, h, dpr);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------------------------------------------------------------- public API
  OG.render = {
    camera: cam,
    zoomOut: function (seconds, onDone) {
      var v = OG.view || { w: 800, h: 600 }, dur = Math.max(0.01, seconds || 0);
      zoomAnim = { t0: T, dur: dur, fx: cam.x, fy: cam.y, fz: cam.zoom || 1, tx: 0, ty: 0, tz: Math.min(v.w, v.h) / cfg.zoomOutSpan, cb: onDone, p: 0, done: false };
    },
    bloomSnapshot: function () { bloomInit(); flushBloom(true); return bloom.map; },
    worldToScreen: function (x, y) {
      var v = OG.view || { w: 800, h: 600 };
      return { x: (x - cam.x) * cam.zoom + v.w / 2, y: (y - cam.y) * cam.zoom + v.h / 2 };
    },
    _debug: {
      stats: stats,
      getSprite: function (kind, v) { var id = KID[kind]; return spr(id === undefined ? 1 : id, v || 0); },
      numCount: function () { var n = 0; for (var i = 0; i < nums.length; i++) if (nums[i].on) n++; return n; },
      shake: function () { return shakeT > 0 ? shakeAmp : 0; },
      bloomCount: function () { return bloom.n; }
    }
  };

  if (OG.game && OG.game.addRender) OG.game.addRender(frame, 10);
})(window.OG = window.OG || {});
