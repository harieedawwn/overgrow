(function (OG) {
  'use strict';

  // ---------------------------------------------------------------- tunables
  OG.cfg = OG.cfg || {};
  var C = OG.cfg.treeview = {
    ink: '#1F2420', paper: '#F2E8D0', ground: '#2E3A2F', grass: '#5E7D4A', grassHi: '#7C9A5E', amber: '#F4B942',
    branchColor: { fire: '#E07A5F', wind: '#8FC1C9', root: '#A7C957', stone: '#B8A99A' },
    // [fill, highlight]
    bark: {
      trunk: ['#8A6A4A', '#AA8561'], fire: ['#9C6249', '#BA7E64'], wind: ['#9C8E7A', '#B8AB96'],
      stone: ['#867A6D', '#A29586'], root: ['#B58A5E', '#CEA87C'], perm: ['#A8805A', '#C29B73']
    },
    leafCol: {
      fire: ['#E07A5F', '#EB9378', '#CF6249'],
      wind: ['#8FC1C9', '#B5DBE1', '#7FB1BB'],
      root: ['#A7C957', '#8FB44A', '#C0D872'],
      stone: ['#B8A99A', '#CDC0B1', '#A39687'],
      sap: ['#8FB05A', '#A7C957', '#7C9E4C']
    },
    boxW: 62, boxTop: 108, boxBottom: 40,   // design box in "units" (ground line = y 0)
    margin: 0.04,                           // fraction of the rect kept empty
    ow: 0.7,                                // ink outline width in units
    miniMinPx: 1.1,                         // minimum outline thickness in px on the HUD
    halo: 0.9,                              // paper die-cut rim around the tree on dark backgrounds
    growSec: 0.6, leafPopSec: 0.35, synergySec: 1, shedSec: 2, easeRate: 5,
    perBough: 6,                            // skills carried by one bough before a sub-bough is grown
    card: { w: 1080, h: 1350 }
  };

  var TAU = Math.PI * 2, D2R = Math.PI / 180, PI = Math.PI;
  var BR = ['fire', 'wind', 'root', 'stone'];
  var NAMES = { fire: 'Lửa', wind: 'Gió', root: 'Rễ', stone: 'Đá' };

  // ----------------------------------------------------------------- helpers
  function hashStr(s) {
    s = String(s);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function wrapAng(a) { while (a > PI) a -= TAU; while (a <= -PI) a += TAU; return a; }
  function easeOutCubic(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }
  function easeOutBack(t) {
    if (t <= 0) return 0; if (t >= 1) return 1;
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function fmtTime(s) {
    if (OG.fmtTime) return OG.fmtTime(s);
    s = Math.max(0, Math.floor(s || 0));
    var m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function clock() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() / 1000 : Date.now() / 1000;
  }

  // ------------------------------------------------------------ persistent state
  var S;
  function freshS() {
    return {
      init: false, seed: null, nSk: 0, nSyn: 0,
      tw: {}, rank: {}, rankT: {}, syn: {},
      animUntil: 0, shedStart: -1,
      cur: null, tgt: null, lastT: 0, easing: false,
      model: null, sig: '', ver: 0, builds: 0,
      cache: null, cacheKey: '', clock: clock
    };
  }
  S = freshS();

  // ------------------------------------------------------------- reading state
  function readState() {
    var s = OG.state || {}, t = s.tree || {}, r = s.run || {}, m = s.meta || {}, g = t.growth || {};
    return {
      seed: r.seed == null ? 'seed' : String(r.seed),
      growth: { fire: +g.fire || 0, wind: +g.wind || 0, root: +g.root || 0, stone: +g.stone || 0 },
      skills: t.skills || {}, synergies: t.synergies || {}, order: t.order || [],
      rootsTotal: +m.rootsTotal || 0
    };
  }
  function skillBranch(id, fb) {
    var L = OG.tree && OG.tree.skills;
    if (L) for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i].branch;
    return BR.indexOf(fb) >= 0 ? fb : 'fire';
  }
  function synergyInfo(id) {
    var L = OG.tree && OG.tree.synergies;
    if (L) for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
    return null;
  }
  function collect(st) {
    var seen = {}, sk = { fire: [], wind: [], root: [], stone: [] }, syn = [], ord = st.order, i, e, r;
    for (i = 0; i < ord.length; i++) {
      e = ord[i]; if (!e) continue;
      if (e.kind === 'synergy') {
        if (!seen['y' + e.id]) { seen['y' + e.id] = 1; syn.push({ id: e.id, hint: e.branch }); }
      } else {
        if (seen['s' + e.id]) continue;
        r = st.skills[e.id]; if (r === undefined) r = 1; if (!(r > 0)) continue;
        seen['s' + e.id] = 1; sk[skillBranch(e.id, e.branch)].push({ id: e.id, rank: r });
      }
    }
    var k;
    for (k in st.skills) if (!seen['s' + k] && st.skills[k] > 0) { seen['s' + k] = 1; sk[skillBranch(k, 'fire')].push({ id: k, rank: st.skills[k] }); }
    for (k in st.synergies) if (st.synergies[k] && !seen['y' + k]) { seen['y' + k] = 1; syn.push({ id: k }); }
    // resolve the two branches of each synergy
    var ranked = BR.slice().sort(function (a, b) { return (st.growth[b] - st.growth[a]) || (BR.indexOf(a) - BR.indexOf(b)); });
    for (i = 0; i < syn.length; i++) {
      var inf = synergyInfo(syn[i].id), a, b;
      if (inf && inf.branches && inf.branches.length >= 2) { a = inf.branches[0]; b = inf.branches[1]; }
      else { a = BR.indexOf(syn[i].hint) >= 0 ? syn[i].hint : ranked[0]; b = ranked[0] === a ? ranked[1] : ranked[0]; }
      syn[i].a = a; syn[i].b = b; syn[i].name = inf ? inf.name : syn[i].id;
    }
    return { sk: sk, syn: syn };
  }

  function targets(st, col) {
    var f = {}, tot = 0, ranksTotal = 0, b, ranks = {};
    for (var i = 0; i < 4; i++) {
      b = BR[i]; ranks[b] = 0;
      for (var j = 0; j < col.sk[b].length; j++) ranks[b] += col.sk[b][j].rank;
      ranksTotal += ranks[b]; tot += st.growth[b];
    }
    for (i = 0; i < 4; i++) {
      b = BR[i];
      if (st.growth[b] <= 0 && ranks[b] <= 0) { f[b] = 0; continue; }
      var m = 0.6 * clamp01(Math.log(1 + st.growth[b]) / Math.LN10 / 4.5) + 0.4 * Math.min(1, ranks[b] / 10);
      f[b] = clamp(0.15 + 0.85 * m, 0.15, 1);
    }
    f.P = 1 - Math.exp(-(ranksTotal + 3 * col.syn.length + 2 * Math.log(1 + tot) / Math.LN10) / 22);
    f.rf = 0.2 + 0.8 * clamp01(Math.log(1 + st.rootsTotal) / Math.LN10 / 5.5);
    return f;
  }
  var KEYS = ['fire', 'wind', 'root', 'stone', 'P', 'rf'];

  // --------------------------------------------------------------- geometry
  var SPEC = {
    fire:  { tt: 0.62, a: -140, bend: 55, len: [26, 50], w: [3.8, 1.1], wob: 0.10, tl: 18, tw: [1.6, 0.35], off: [0.65, 1.0] },
    wind:  { tt: 1.0,  a: -72,  bend: 50, len: [40, 66], w: [2.4, 0.5], wob: 0.05, tl: 36, tw: [1.0, 0.25], off: [0.3, 0.5] },
    stone: { tt: 0.3,  a: -18,  bend: 22, len: [20, 34], w: [6.2, 3.0], wob: 0.16, tl: 12, tw: [2.8, 1.3],  off: [0.9, 1.2] },
    root:  { tt: 0,    a: 158,  bend: -30, len: [16, 28], w: [3.4, 0.9], wob: 0.12, tl: 11, tw: [1.6, 0.35], off: [0.7, 1.0] }
  };
  var LEAF_S = { fire: 3.8, wind: 3.6, root: 2.3, stone: 3.4 };

  function makeCL(x0, y0, h0, len, bend, n, wob, rng) {
    var c = [x0, y0], hd = [h0], x = x0, y = y0, h = h0, st = len / n;
    for (var i = 0; i < n; i++) {
      h += bend / n + (rng() - 0.5) * wob;
      x += Math.cos(h) * st; y += Math.sin(h) * st;
      c.push(x, y); hd.push(h);
    }
    return { c: c, hd: hd };
  }
  function widths(n, w0, w1, knots, ph) {
    var w = [];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1), v = w1 + (w0 - w1) * Math.pow(1 - t, 0.9);
      if (knots) { var s = Math.sin(t * TAU * 1.6 + ph); v *= 1 + 0.32 * (s > 0 ? s * s : 0); }
      w.push(v);
    }
    return w;
  }
  function polyFrom(sh, p) {
    var c = sh.c, w = sh.w, n = w.length, xs = [], ys = [], ws = [], i;
    var fl = p * (n - 1), k = Math.floor(fl), fr = fl - k;
    if (p >= 1) { k = n - 1; fr = 0; }
    for (i = 0; i <= k; i++) { xs.push(c[2 * i]); ys.push(c[2 * i + 1]); ws.push(w[i]); }
    if (fr > 0.001 && k < n - 1) {
      xs.push(lerp(c[2 * k], c[2 * k + 2], fr)); ys.push(lerp(c[2 * k + 1], c[2 * k + 3], fr)); ws.push(lerp(w[k], w[k + 1], fr));
    }
    var m = xs.length, L = [], R = [], tx = 0, ty = 0;
    if (p < 1) ws[m - 1] *= 0.55;
    for (i = 0; i < m; i++) {
      var j0 = i > 0 ? i - 1 : 0, j1 = i < m - 1 ? i + 1 : m - 1;
      tx = xs[j1] - xs[j0]; ty = ys[j1] - ys[j0];
      var l = Math.sqrt(tx * tx + ty * ty) || 1; tx /= l; ty /= l;
      L.push(xs[i] - ty * ws[i] / 2, ys[i] + tx * ws[i] / 2);
      R.push(xs[i] + ty * ws[i] / 2, ys[i] - tx * ws[i] / 2);
    }
    var ring = [];
    for (i = 0; i < m; i++) ring.push(L[2 * i], L[2 * i + 1]);
    ring.push(xs[m - 1] + tx * ws[m - 1] * 0.75, ys[m - 1] + ty * ws[m - 1] * 0.75);
    for (i = m - 1; i >= 0; i--) ring.push(R[2 * i], R[2 * i + 1]);
    return ring;
  }
  function sample(sh, t) {
    var n = sh.w.length, f = clamp01(t) * (n - 1), k = Math.min(n - 2, Math.floor(f)), r = f - k;
    return {
      x: lerp(sh.c[2 * k], sh.c[2 * k + 2], r), y: lerp(sh.c[2 * k + 1], sh.c[2 * k + 3], r),
      h: lerp(sh.hd[k], sh.hd[k + 1], r), w: lerp(sh.w[k], sh.w[k + 1], r)
    };
  }

  // ---------------------------------------------------------------- the model
  function buildModel(st, cur, col) {
    var seedS = st.seed;
    var m = (hashStr(seedS + '|m') & 1) ? 1 : -1;
    var RN = function (key) { return mulberry(hashStr(seedS + '|' + key)); };
    var M = { bark: [], rbark: [], leaves: [], rleaves: [], pebbles: [], syn: [], dots: [], tufts: [], sap: null,
      soil: null, grassW: 40, bb: { x0: 0, x1: 0, y0: 0, y1: 0 }, fit: 1, ver: 0 };
    var bb = M.bb;
    function ext(x, y, r) {
      if (x - r < bb.x0) bb.x0 = x - r; if (x + r > bb.x1) bb.x1 = x + r;
      if (y - r < bb.y0) bb.y0 = y - r; if (y + r > bb.y1) bb.y1 = y + r;
    }
    function mkShape(cl, w0, w1, colr, birth, dur, knots, ph, root) {
      var w = widths(cl.hd.length, w0, w1, knots, ph);
      var sh = { c: cl.c, hd: cl.hd, w: w, col: colr[0], hl: colr[1], birth: birth, dur: dur, wmax: w0 };
      sh.poly = polyFrom(sh, 1);
      for (var i = 0; i < w.length; i++) ext(cl.c[2 * i], cl.c[2 * i + 1], w[i] / 2 + 0.6);
      (root ? M.rbark : M.bark).push(sh);
      return sh;
    }
    function leaf(list, k, x, y, rot, s, rng, birth) {
      list.push({ k: k, x: x, y: y, rot: rot, s: s, v: rng(), birth: birth, fd: rng() * 0.6, ph: rng() * TAU, sp: (rng() - 0.5) * 6 });
      ext(x, y, s * (k === 'wind' ? 2.8 : 1.5));
    }
    var P = cur.P;

    // --- trunk
    var rt = RN('trunk');
    var H = 22 + 30 * P;
    var tcl = makeCL(0, 2, -PI / 2, H + 2, (rt() - 0.5) * 0.5, 10, 0.05, rt);
    var tw = widths(11, 4.6 + 3.6 * P, 2.2 + 1.4 * P, false, 0);
    for (var ti = 0; ti < 11; ti++) { var tt0 = ti / 10; tw[ti] += 5 * Math.pow(Math.max(0, 1 - tt0 * 5), 2); }
    var trunk = { c: tcl.c, hd: tcl.hd, w: tw, col: C.bark.trunk[0], hl: C.bark.trunk[1], birth: -1e9, dur: 1, wmax: tw[0] };
    trunk.poly = polyFrom(trunk, 1); M.bark.push(trunk);
    for (ti = 0; ti < 11; ti++) ext(tcl.c[2 * ti], tcl.c[2 * ti + 1], tw[ti] / 2 + 0.6);

    // --- branches
    var mains = {};
    function twig(parent, tpar, side, kind, sk, f, rng, bendWind) {
      var sp = SPEC[kind], p = sample(parent, tpar);
      var h = p.h + side * lerp(sp.off[0], sp.off[1], rng());
      if (kind === 'root' && Math.sin(h) < 0.15) h = Math.cos(h) > 0 ? 0.3 : PI - 0.3;
      var rank = Math.min(sk.rank, 5);
      var L = sp.tl * (0.6 + 0.4 * (1 - tpar)) * (0.75 + 0.06 * rank) * (0.7 + 0.3 * f);
      var bend;
      if (kind === 'fire') bend = clamp(wrapAng(-PI / 2 - h) * 0.6, -0.9, 0.9);
      else if (kind === 'wind') bend = bendWind * (0.6 + 0.4 * rng());
      else if (kind === 'stone') bend = clamp(wrapAng(PI / 2 - h) * 0.2, -0.4, 0.4);
      else bend = clamp(wrapAng(PI / 2 - h) * 0.5, -0.7, 0.7);
      var cl = makeCL(p.x, p.y, h, L, bend, 6, 0.12, rng);
      var birth = S.tw[sk.id] === undefined ? -1e9 : S.tw[sk.id];
      var colr = C.bark[kind];
      var sh = mkShape(cl, Math.min(sp.tw[0] * (0.85 + 0.3 * rng()), p.w * 0.9), sp.tw[1], colr, birth, C.growSec, kind === 'stone', rng() * 6, kind === 'root');
      var list = kind === 'root' ? M.rleaves : M.leaves;
      var nL = 1 + rank, rk = S.rankT[sk.id], from = rk ? rk.from : 1e9, ls = LEAF_S[kind] * (0.8 + 0.1 * rank);
      for (var i = 0; i < nL; i++) {
        var t = i === 0 ? 1 : 0.3 + 0.62 * (i - 1) / Math.max(1, nL - 1);
        var q = sample(sh, t), sd = (i % 2 ? 1 : -1), rot, lx = q.x, ly = q.y;
        if (i === 0) rot = q.h; else { rot = q.h + sd * 0.9; lx += -Math.sin(q.h) * sd * 1.1; ly += Math.cos(q.h) * sd * 1.1; }
        var lb;
        if (rk && i >= from) lb = rk.t + (i - from) * 0.06;
        else lb = birth < 0 ? -1e9 : birth + C.growSec * 0.75 + i * 0.06;
        leaf(list, kind, lx, ly, rot, ls * (i === 0 ? 1.2 : 0.85), rng, lb);
      }
      return sh;
    }

    var order = ['root', 'stone', 'fire', 'wind'];
    for (var oi = 0; oi < 4; oi++) {
      var b = order[oi], f = cur[b];
      if (f < 0.012) continue;
      var sp = SPEC[b], rng = RN(b + ':main'), isRoot = b === 'root';
      var at = isRoot ? { x: 0, y: 1.5, w: 4 } : sample(trunk, sp.tt);
      var h0 = m > 0 ? sp.a * D2R : PI - sp.a * D2R, bendA = sp.bend * D2R * m;
      var ramp = Math.min(1, f * 6), len = (sp.len[0] + (sp.len[1] - sp.len[0]) * f) * ramp;
      var cl = makeCL(at.x, at.y, h0, len, bendA, 12, sp.wob, rng);
      var main = mkShape(cl, Math.min(sp.w[0] * (0.55 + 0.45 * f), at.w * 1.1 + 1) * ramp + 0.3, sp.w[1] * ramp + 0.2, C.bark[b], -1e9, 1, b === 'stone', rng() * 6, isRoot);
      mains[b] = main;
      var list = isRoot ? M.rleaves : M.leaves;
      var ls = LEAF_S[b] * (0.5 + 0.7 * f) * ramp;
      var tips = b === 'root' ? [1, 0.75, 0.5, 0.3] : [1, 0.88];
      for (var li = 0; li < tips.length; li++) {
        var q = sample(main, tips[li]), sd = li % 2 ? 1 : -1;
        leaf(list, b, q.x - Math.sin(q.h) * sd * (li ? 1.2 : 0), q.y + Math.cos(q.h) * sd * (li ? 1.2 : 0), q.h + (li ? sd * 0.8 : 0), ls * (li ? 0.8 : 1.2), rng, -1e9);
      }
      var first = (hashStr(seedS + '|' + b + 'side') & 1) ? 1 : -1;
      var bendWind = (sp.bend * m > 0 ? 1 : -1) * 0.9;
      var sk = col.sk[b], subs = [];
      for (var i = 0; i < sk.length; i++) {
        var trng = RN('tw:' + sk[i].id), parent, tpar, side;
        if (i < C.perBough) { parent = main; tpar = Math.min(0.9, 0.2 + 0.13 * i); side = ((i + (first > 0 ? 0 : 1)) % 2) ? 1 : -1; }
        else {
          var si = Math.floor((i - C.perBough) / C.perBough), j = (i - C.perBough) % C.perBough;
          if (!subs[si]) {
            var sd2 = (si % 2 ? 1 : -1) * first, pm = sample(main, Math.min(0.85, 0.38 + 0.14 * si));
            var scl = makeCL(pm.x, pm.y, pm.h + sd2 * 0.75, len * 0.55, bendA * 0.5, 8, sp.wob, RN(b + ':sub' + si));
            subs[si] = mkShape(scl, Math.min(sp.w[0] * 0.45, pm.w * 0.8), sp.w[1] * 0.8, C.bark[b], -1e9, 1, b === 'stone', si, isRoot);
          }
          parent = subs[si]; tpar = 0.25 + 0.13 * j; side = (j % 2) ? 1 : -1;
        }
        twig(parent, tpar, side, b, sk[i], f, trng, bendWind);
      }
      // pebbles at the base of the stone bough
      if (b === 'stone') {
        var pr = RN('pebbles'), cnt = 2 + Math.floor(7 * f), dirx = Math.cos(h0) >= 0 ? 1 : -1;
        for (i = 0; i < cnt; i++) {
          var sgn = i % 4 === 3 ? -dirx : dirx;
          var px = sgn * (5 + pr() * (10 + 14 * f)), rx = (1.4 + pr() * 2.4) * ramp;
          M.pebbles.push({ x: px, y: 0.2 - pr() * 0.6, rx: rx, ry: rx * (0.55 + pr() * 0.2), v: pr() });
          ext(px, 0, rx + 1);
        }
      }
    }

    // --- permanent roots (grow with meta.rootsTotal)
    var rr = RN('roots'), rf = cur.rf, nf = 3 + ((rf - 0.2) / 0.8) * 5, slots = [90, 64, 116, 40, 140, 78, 102, 22];
    var c1 = clamp01((rf - 0.25) / 0.3), c2 = clamp01((rf - 0.55) / 0.3);
    var rbb = { x: 0, y: 0 };
    for (var k = 0; k < 8; k++) {
      var rp = clamp01(nf - k), a = (slots[k] + (rr() - 0.5) * 14) * D2R;
      var lenR = (6 + 20 * rf) * (0.8 + 0.4 * rr()) * (1 + 0.45 * Math.abs(Math.cos(a))) * rp;
      var rb = (rr() - 0.5) * 0.9, rx0 = (rr() - 0.5) * 5;
      if (rp < 0.03) continue;
      var rcl = makeCL(rx0, 1.5, a, lenR, rb, 9, 0.2, rr);
      var rs = mkShape(rcl, (2.6 * (0.7 + 0.3 * rp)), 0.5, C.bark.perm, -1e9, 1, false, 0, true);
      var kids = [[0.5, c1, 0.58], [0.78, c2, 0.5]];
      for (var kk = 0; kk < 2; kk++) {
        var ka = kids[kk]; if (ka[1] < 0.03) continue;
        var pp = sample(rs, ka[0]), sdk = ((k + kk) % 2) ? 1 : -1;
        var hk = pp.h + sdk * 0.62; if (Math.sin(hk) < 0.2) hk = Math.cos(hk) > 0 ? 0.35 : PI - 0.35;
        var kcl = makeCL(pp.x, pp.y, hk, lenR * ka[2] * ka[1], -sdk * 0.25, 6, 0.2, rr);
        mkShape(kcl, Math.min(1.7, pp.w * 0.8), 0.35, C.bark.perm, -1e9, 1, false, 0, true);
      }
    }
    // soil block sized to enclose every root
    var ry = 0, rxm = 0, i2;
    for (i2 = 0; i2 < M.rbark.length; i2++) {
      var sh2 = M.rbark[i2];
      for (var q2 = 0; q2 < sh2.w.length; q2++) { ry = Math.max(ry, sh2.c[2 * q2 + 1]); rxm = Math.max(rxm, Math.abs(sh2.c[2 * q2])); }
    }
    var GW = Math.max(32 + 10 * rf, rxm * 1.06 + 5), D = Math.max(16 + 20 * rf, ry * 1.08 + 5);
    M.soil = { gw: GW, d: D }; M.grassW = GW;
    ext(-GW, 0, 3); ext(GW, 0, 3); ext(0, D, 3);
    var dr = RN('soil');
    for (i2 = 0; i2 < 14; i2++) M.dots.push({ x: (dr() * 2 - 1) * GW * 0.85, y: 6 + dr() * (D - 10), r: 0.7 + dr() * 1.3 });
    for (i2 = 0; i2 < 9; i2++) M.tufts.push({ x: (dr() * 2 - 1) * (GW - 4), s: 2 + dr() * 2.2, v: dr() });

    // --- sapling leaves while the tree is tiny
    var sapS = clamp01(1 - P * 5);
    if (sapS > 0.15) {
      var tp = sample(trunk, 1), sr = RN('sap');
      leaf(M.leaves, 'sap', tp.x, tp.y, tp.h - 0.9, 4.2 * sapS, sr, -1e9);
      leaf(M.leaves, 'sap', tp.x, tp.y, tp.h + 0.9, 4.2 * sapS, sr, -1e9);
    }

    // --- fused synergy blossoms
    var pairCount = {}, placed = [];
    for (var si2 = 0; si2 < col.syn.length; si2++) {
      var sy = col.syn[si2], pk = sy.a + sy.b;
      var A = anchor(sy.a), B = anchor(sy.b);
      var dx = B.x - A.x, dy = B.y - A.y, ln = Math.sqrt(dx * dx + dy * dy) || 1, nx = -dy / ln, ny = dx / ln;
      var cnt2 = pairCount[pk] = (pairCount[pk] || 0) + 1;
      var d = Math.max(7, 0.32 * ln) * (1 + 0.55 * (cnt2 - 1)), mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      var C1 = { x: mx + nx * d, y: my + ny * d }, C2 = { x: mx - nx * d, y: my - ny * d };
      var Cc = scoreC(C1) <= scoreC(C2) ? C1 : C2, dir = Cc === C1 ? 1 : -1;
      for (var it = 0; it < 5; it++) {
        var hit = false;
        for (var pi = 0; pi < placed.length; pi++) {
          if (Math.abs(placed[pi].x - Cc.x) < 10 && Math.abs(placed[pi].y - Cc.y) < 10) { Cc = { x: Cc.x + nx * dir * 8, y: Cc.y + ny * dir * 8 }; hit = true; }
        }
        if (!hit) break;
      }
      placed.push(Cc);
      var birth = S.syn[sy.id] === undefined ? -1e9 : S.syn[sy.id];
      M.syn.push({ x: Cc.x, y: Cc.y, A: A, B: B, ca: C.branchColor[sy.a], cb: C.branchColor[sy.b], birth: birth, R: 6, fd: (si2 * 0.13) % 0.6, ph: si2 });
      ext(Cc.x, Cc.y, 7.5);
    }
    function anchor(bn) {
      var sh = mains[bn];
      if (sh) { var q = sample(sh, 0.62); return { x: q.x, y: q.y }; }
      var q2 = sample(trunk, 0.5); return { x: q2.x, y: q2.y };
    }
    function scoreC(p) { return ((Math.abs(p.x) < 10 && p.y > -H - 4 && p.y < 2) ? 100 : 0) + p.y * 0.05; }

    // --- fit into the design box (rarely needed)
    var fx = Math.max(Math.abs(bb.x0), Math.abs(bb.x1)) || 1;
    M.fit = Math.min(1, C.boxW / fx, bb.y0 < 0 ? C.boxTop / -bb.y0 : 1, bb.y1 > 0 ? C.boxBottom / bb.y1 : 1);
    return M;
  }

  // ---------------------------------------------------------- state tracking
  function track(st, col, now) {
    var ids = [], i, b;
    for (i = 0; i < 4; i++) for (var j = 0; j < col.sk[BR[i]].length; j++) ids.push(col.sk[BR[i]][j]);
    var fresh = false;
    if (!S.init) {
      S.init = true; S.seed = st.seed;
    } else if (st.seed !== S.seed || ids.length < S.nSk || col.syn.length < S.nSyn) {
      S.tw = {}; S.rank = {}; S.rankT = {}; S.syn = {}; S.shedStart = -1; S.seed = st.seed; S.cur = null; fresh = true;
      S.cache = null;
    }
    var known = S.nSk > 0 || S.nSyn > 0 || fresh || S.knownOnce;
    var anyKnown = false; for (b in S.rank) { anyKnown = true; break; }
    var animate = fresh || anyKnown || S.knownOnce;
    for (i = 0; i < ids.length; i++) {
      var sk = ids[i];
      if (S.rank[sk.id] === undefined) {
        S.rank[sk.id] = sk.rank;
        if (animate) { S.tw[sk.id] = now; S.rankT[sk.id] = { t: now, from: 0 }; S.animUntil = Math.max(S.animUntil, now + C.growSec + 0.9); }
      } else if (sk.rank > S.rank[sk.id]) {
        S.rankT[sk.id] = { t: now, from: 1 + Math.min(S.rank[sk.id], 5) };
        S.rank[sk.id] = sk.rank; S.animUntil = Math.max(S.animUntil, now + C.leafPopSec + 0.5);
      }
    }
    for (i = 0; i < col.syn.length; i++) {
      var id = col.syn[i].id;
      if (S.syn[id] === undefined) {
        S.syn[id] = animate ? now : -1e9;
        if (animate) S.animUntil = Math.max(S.animUntil, now + C.synergySec + 0.8);
      }
    }
    S.knownOnce = true;
    S.nSk = ids.length; S.nSyn = col.syn.length;
  }

  function structSig(st, col) {
    var s = st.seed + '|';
    for (var i = 0; i < 4; i++) {
      var l = col.sk[BR[i]];
      for (var j = 0; j < l.length; j++) s += l[j].id + ':' + l[j].rank + ',';
      s += ';';
    }
    for (i = 0; i < col.syn.length; i++) s += col.syn[i].id + ',';
    return s;
  }

  function prepare(st, now) {
    var col = collect(st);
    track(st, col, now);
    var T = targets(st, col), i, k;
    if (!S.cur) { S.cur = {}; for (i = 0; i < KEYS.length; i++) S.cur[KEYS[i]] = T[KEYS[i]]; S.easing = false; }
    else {
      var dt = clamp(now - S.lastT, 0, 0.1), kf = 1 - Math.exp(-C.easeRate * dt), moving = false;
      for (i = 0; i < KEYS.length; i++) {
        k = KEYS[i];
        var d = T[k] - S.cur[k];
        if (Math.abs(d) < 0.003) S.cur[k] = T[k]; else { S.cur[k] += d * kf; moving = true; }
      }
      S.easing = moving;
    }
    S.lastT = now;
    var q = '';
    for (i = 0; i < KEYS.length; i++) q += Math.round(S.cur[KEYS[i]] * 400) + ',';
    var sig = structSig(st, col) + '#' + q + '#' + Math.round(st.rootsTotal);
    if (sig !== S.sig || !S.model) {
      S.model = buildModel(st, S.cur, col); S.model.ver = ++S.ver; S.sig = sig; S.builds++;
    }
    S.tgt = T;
    return S.model;
  }

  function shedState(now) {
    if (S.shedStart < 0) return 0;
    return (now - S.shedStart) < C.shedSec + 0.05 ? 1 : 2;
  }

  // ---------------------------------------------------------------- painting
  function tracePoly(g, P) {
    var n = P.length >> 1;
    g.moveTo((P[0] + P[2]) / 2, (P[1] + P[3]) / 2);
    for (var i = 1; i <= n; i++) {
      var a = (i % n) * 2, b = ((i + 1) % n) * 2;
      g.quadraticCurveTo(P[a], P[a + 1], (P[a] + P[b]) / 2, (P[a + 1] + P[b + 1]) / 2);
    }
    g.closePath();
  }
  function polyOf(sh, now, final) {
    if (final) return sh.poly;
    var p = (now - sh.birth) / sh.dur;
    if (p >= 1) return sh.poly;
    if (p <= 0.02) return null;
    return polyFrom(sh, easeOutCubic(p));
  }
  function paintBark(g, shapes, ow, o, now, rootSide) {
    var polys = [], cols = [], i, P;
    for (i = 0; i < shapes.length; i++) { P = polyOf(shapes[i], now, o.final); if (P) { polys.push(P); cols.push(shapes[i]); } }
    if (o.halo && !rootSide) {
      g.fillStyle = C.paper; g.strokeStyle = C.paper; g.lineWidth = 2 * (ow + C.halo);
      for (i = 0; i < polys.length; i++) { if (cols[i].wmax < 2.6) continue; g.beginPath(); tracePoly(g, polys[i]); g.fill(); g.stroke(); }
    }
    g.fillStyle = C.ink; g.strokeStyle = C.ink; g.lineWidth = 2 * ow;
    for (i = 0; i < polys.length; i++) { g.beginPath(); tracePoly(g, polys[i]); g.fill(); g.stroke(); }
    for (i = 0; i < polys.length; i++) { g.fillStyle = cols[i].col; g.beginPath(); tracePoly(g, polys[i]); g.fill(); }
    if (!o.mini) {
      g.lineWidth = 0.55; g.globalAlpha = 0.75;
      for (i = 0; i < polys.length; i++) {
        var sh = cols[i];
        if (sh.wmax < 2.6 || polys[i] !== sh.poly) continue;
        g.strokeStyle = sh.hl; g.beginPath();
        var n = sh.w.length, last = Math.floor(n * 0.85);
        for (var j = 0; j < last; j++) {
          var j0 = Math.max(0, j - 1), j1 = Math.min(n - 1, j + 1);
          var tx = sh.c[2 * j1] - sh.c[2 * j0], ty = sh.c[2 * j1 + 1] - sh.c[2 * j0 + 1], l = Math.sqrt(tx * tx + ty * ty) || 1;
          var px = sh.c[2 * j] - ty / l * sh.w[j] * 0.22, py = sh.c[2 * j + 1] + tx / l * sh.w[j] * 0.22;
          if (j === 0) g.moveTo(px, py); else g.lineTo(px, py);
        }
        g.stroke();
      }
      g.globalAlpha = 1;
    }
  }

  function drawLeaf(g, L, x, y, rot, sc, ow) {
    var cols = C.leafCol[L.k], colr = cols[L.v < 0.34 ? 0 : (L.v < 0.67 ? 1 : 2)], r = L.s * sc, i, a;
    g.fillStyle = colr; g.strokeStyle = C.ink; g.lineWidth = ow * 0.9;
    if (L.k === 'fire') {
      g.beginPath();
      for (i = 0; i < 5; i++) {
        a = rot + i * 1.2566; var cx = x + Math.cos(a) * r * 0.62, cy = y + Math.sin(a) * r * 0.62;
        g.moveTo(cx + r * 0.52, cy); g.arc(cx, cy, r * 0.52, 0, TAU);
      }
      g.fill(); g.stroke();
      g.fillStyle = C.amber; g.beginPath(); g.arc(x, y, r * 0.3, 0, TAU); g.fill(); g.stroke();
    } else if (L.k === 'wind' || L.k === 'sap') {
      var len = r * (L.k === 'sap' ? 2.2 : 2.9), wd = r * (L.k === 'sap' ? 0.7 : 0.62);
      var cs = Math.cos(rot), sn = Math.sin(rot), tx = x + cs * len, ty = y + sn * len, mx = x + cs * len * 0.5, my = y + sn * len * 0.5;
      g.beginPath(); g.moveTo(x, y);
      g.quadraticCurveTo(mx - sn * wd * 2, my + cs * wd * 2, tx, ty);
      g.quadraticCurveTo(mx + sn * wd * 2, my - cs * wd * 2, x, y);
      g.closePath(); g.fill(); g.stroke();
      g.lineWidth = ow * 0.5; g.beginPath(); g.moveTo(x, y); g.lineTo(x + cs * len * 0.82, y + sn * len * 0.82); g.stroke();
    } else if (L.k === 'root') {
      g.beginPath();
      g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU);
      g.moveTo(x + r * 0.7 + r * 0.8, y - r * 0.3); g.arc(x + r * 0.7, y - r * 0.3, r * 0.8, 0, TAU);
      g.moveTo(x - r * 0.6 + r * 0.75, y + r * 0.3); g.arc(x - r * 0.6, y + r * 0.3, r * 0.75, 0, TAU);
      g.fill(); g.stroke();
    } else {
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = cols[2]; g.beginPath(); g.arc(x - r * 0.28, y - r * 0.25, r * 0.34, 0, TAU); g.fill();
    }
  }

  function drawFused(g, Y, u, ow) {
    var R = Y.R, i, k;
    // two stems from the branches
    var p = clamp01(u * 2.2);
    if (p > 0) {
      var ends = [[Y.A, Y.ca], [Y.B, Y.cb]];
      for (i = 0; i < 2; i++) {
        var A = ends[i][0], mx = (A.x + Y.x) / 2 + (i ? 2.5 : -2.5), my = (A.y + Y.y) / 2 - 2;
        var cx = lerp(A.x, mx, p), cy = lerp(A.y, my, p);
        var ex = lerp(lerp(A.x, mx, p), lerp(mx, Y.x, p), p), ey = lerp(lerp(A.y, my, p), lerp(my, Y.y, p), p);
        g.beginPath(); g.moveTo(A.x, A.y); g.quadraticCurveTo(cx, cy, ex, ey);
        g.lineCap = 'round'; g.strokeStyle = C.ink; g.lineWidth = 1.1 + 2 * ow; g.stroke();
        g.strokeStyle = ends[i][1]; g.lineWidth = 1.1; g.stroke();
      }
    }
    for (k = 0; k < 8; k++) {
      var pu = easeOutBack(clamp01(u * 1.5 - k * 0.06 - 0.1));
      if (pu <= 0) continue;
      var a = k * TAU / 8 + (1 - clamp01(u)) * 1.4, d = R * 0.58 * pu;
      g.fillStyle = k % 2 ? Y.cb : Y.ca; g.strokeStyle = C.ink; g.lineWidth = ow * 0.9;
      g.beginPath(); g.ellipse(Y.x + Math.cos(a) * d, Y.y + Math.sin(a) * d, R * 0.5 * pu, R * 0.31 * pu, a, 0, TAU);
      g.fill(); g.stroke();
    }
    var cu = easeOutBack(clamp01(u * 1.6 - 0.35));
    if (u < 0.35) { // the bud
      var bs = easeOutBack(clamp01(u * 3));
      g.fillStyle = Y.ca; g.strokeStyle = C.ink; g.lineWidth = ow * 0.9;
      g.beginPath(); g.arc(Y.x, Y.y, R * 0.28 * bs, 0, TAU); g.fill(); g.stroke();
    }
    if (cu > 0) {
      g.fillStyle = C.paper; g.strokeStyle = C.ink; g.lineWidth = ow * 0.9;
      g.beginPath(); g.arc(Y.x, Y.y, R * 0.34 * cu, 0, TAU); g.fill(); g.stroke();
      g.fillStyle = C.amber; g.beginPath(); g.arc(Y.x, Y.y, R * 0.15 * cu, 0, TAU); g.fill();
    }
  }

  function backdrop(g, x, y, w, h, o) {
    if (o.paper) { g.fillStyle = C.paper; g.fillRect(x, y, w, h); }
    if (o.backdrop && w > 4 && h > 4) {
      x += 0.7; y += 0.7; w -= 1.4; h -= 1.4;   // keep the 1.4 px ink border inside the rect
      var r = Math.min(w, h) * 0.12;
      g.fillStyle = C.paper; g.strokeStyle = C.ink; g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arcTo(x + w, y, x + w, y + r, r);
      g.lineTo(x + w, y + h - r); g.arcTo(x + w, y + h, x + w - r, y + h, r);
      g.lineTo(x + r, y + h); g.arcTo(x, y + h, x, y + h - r, r);
      g.lineTo(x, y + r); g.arcTo(x, y, x + r, y, r);
      g.closePath(); g.fill(); g.stroke();
    }
  }

  function paint(g, M, x, y, w, h, now, o) {
    g.save();
    backdrop(g, x, y, w, h, o);
    var bw = 2 * C.boxW, bh = C.boxTop + C.boxBottom;
    var u0 = Math.min(w * (1 - 2 * C.margin) / bw, h * (1 - 2 * C.margin) / bh), u = u0 * M.fit;
    var ox = x + w / 2, oy = y + (h - bh * u0) / 2 + C.boxTop * u0;
    if (o.fitBB) { // export card: frame the real content instead of the design box
      var bbx = M.bb, cw = (bbx.x1 - bbx.x0) * M.fit, ch = (bbx.y1 - bbx.y0) * M.fit;
      u = Math.min(w * 0.94 / cw, h * 0.94 / ch, u0 * 2.2);
      ox = x + w / 2 - (bbx.x0 + bbx.x1) / 2 * M.fit * u / M.fit;
      oy = y + h / 2 - (bbx.y0 + bbx.y1) / 2 * u;
    }
    g.translate(ox, oy); g.scale(u, u);
    g.lineJoin = 'round'; g.lineCap = 'round';
    var ow = o.mini ? Math.max(C.ow, C.miniMinPx / u) : C.ow;
    var shed = o.final ? -1 : (S.shedStart >= 0 ? now - S.shedStart : -1);
    var GW = M.soil.gw, D = M.soil.d, i, L;

    // soil
    function soilPath() {
      g.beginPath(); g.moveTo(-GW, 2); g.lineTo(GW, 2);
      g.bezierCurveTo(GW, D * 0.92, GW * 0.78, D, 0, D);
      g.bezierCurveTo(-GW * 0.78, D, -GW, D * 0.92, -GW, 2); g.closePath();
    }
    if (o.halo) { g.fillStyle = C.paper; g.strokeStyle = C.paper; g.lineWidth = 2 * (ow * 1.6 + C.halo); soilPath(); g.fill(); g.stroke(); }
    g.fillStyle = C.ground; g.strokeStyle = C.ink; g.lineWidth = ow * 3.2; soilPath(); g.fill(); g.stroke();
    if (!o.mini) {
      g.fillStyle = '#3F4D40';
      for (i = 0; i < M.dots.length; i++) { g.beginPath(); g.arc(M.dots[i].x, M.dots[i].y, M.dots[i].r, 0, TAU); g.fill(); }
    }

    // roots (permanent system + root branch) and their moss
    paintBark(g, M.rbark, ow, o, now, true);
    paintLeaves(g, M.rleaves, now, shed, ow, o);

    // grass lip with its ink outline
    function grassPath() {
      g.beginPath(); g.moveTo(-GW, 3.2); g.lineTo(-GW, -0.8);
      var n = 12, sx = 2 * GW / n;
      for (var k = 0; k < n; k++) g.quadraticCurveTo(-GW + sx * (k + 0.5), k % 2 ? -2.6 : 0.8, -GW + sx * (k + 1), -0.8);
      g.lineTo(GW, 3.2); g.closePath();
    }
    if (o.halo) { g.fillStyle = C.paper; g.strokeStyle = C.paper; g.lineWidth = 2 * (ow * 1.4 + C.halo); grassPath(); g.fill(); g.stroke(); }
    g.fillStyle = C.grass; g.strokeStyle = C.ink; g.lineWidth = ow * 2.8; grassPath(); g.fill(); g.stroke();
    if (!o.mini) {
      g.fillStyle = C.grassHi; g.lineWidth = ow * 0.8;
      for (i = 0; i < M.tufts.length; i++) {
        var T = M.tufts[i];
        g.beginPath(); g.moveTo(T.x - T.s * 0.6, -0.4); g.lineTo(T.x - T.s * 0.35, -T.s * 1.3); g.lineTo(T.x, -0.4);
        g.lineTo(T.x + T.s * 0.3, -T.s * 1.7); g.lineTo(T.x + T.s * 0.6, -0.4); g.closePath(); g.fill(); g.stroke();
      }
    }

    // trunk and boughs
    paintBark(g, M.bark, ow, o, now, false);

    // pebbles
    g.strokeStyle = C.ink; g.lineWidth = ow * 0.9;
    for (i = 0; i < M.pebbles.length; i++) {
      var Pb = M.pebbles[i];
      g.fillStyle = Pb.v < 0.5 ? '#B8A99A' : '#CDC0B1';
      g.beginPath(); g.ellipse(Pb.x, Pb.y - Pb.ry * 0.6, Pb.rx, Pb.ry, 0, 0, TAU); g.fill(); g.stroke();
    }

    paintLeaves(g, M.leaves, now, shed, ow, o);

    // synergy blossoms
    if (shed < C.shedSec) {
      for (i = 0; i < M.syn.length; i++) {
        var Y = M.syn[i], ag = o.final ? 1e9 : now - Y.birth, fall = 0;
        if (shed >= 0) {
          fall = clamp01((shed - Y.fd) / 1.4); if (fall >= 1) continue;
          g.globalAlpha = fall > 0.8 ? 1 - (fall - 0.8) / 0.2 : 1;
          if (Y.y < 0 && fall > 0) { var gy = -2; var Z = { x: Y.x + Math.sin(fall * 5 + Y.ph) * 5 * fall, y: Y.y + (gy - Y.y) * fall * fall, A: Y.A, B: Y.B, ca: Y.ca, cb: Y.cb, R: Y.R }; drawFused(g, Z, 1, ow); g.globalAlpha = 1; continue; }
        }
        drawFused(g, Y, ag / C.synergySec, ow);
        g.globalAlpha = 1;
      }
    }
    g.restore();
  }

  function paintLeaves(g, list, now, shed, ow, o) {
    if (shed >= C.shedSec) return;
    for (var i = 0; i < list.length; i++) {
      var L = list[i], x = L.x, y = L.y, rot = L.rot, sc = 1, a = 1;
      if (!o.final) {
        var age = now - L.birth;
        if (age < C.leafPopSec) { sc = easeOutBack(age / C.leafPopSec); if (sc <= 0) continue; }
      }
      if (shed >= 0 && !(L.k === 'sap' && false)) {
        var q = clamp01((shed - L.fd) / 1.4);
        if (q >= 1) continue;
        if (q > 0) {
          var gy = -2 + (L.ph / TAU) * 3;
          if (y < 0) y = y + (gy - y) * q * q;
          x += Math.sin(q * 5 + L.ph) * 5 * q + q * L.sp;
          rot += q * L.sp * 0.8;
          a = q > 0.8 ? 1 - (q - 0.8) / 0.2 : 1;
        }
      }
      if (a !== 1) g.globalAlpha = a;
      drawLeaf(g, L, x, y, rot, sc, ow);
      if (a !== 1) g.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ public
  function hasDoc() { return typeof document !== 'undefined' && document.createElement; }

  function draw(ctx, x, y, w, h, opts) {
    opts = opts || {};
    var mini = opts.detail === 'mini', now = S.clock();
    var st = readState();
    var M = prepare(st, now);
    var ss = shedState(now);
    var animating = now < S.animUntil || S.easing || ss === 1;
    var o = { mini: mini, final: false, paper: !!opts.paper, backdrop: mini ? opts.backdrop !== false : !!opts.backdrop };
    o.halo = opts.halo !== undefined ? !!opts.halo : (!o.paper && !o.backdrop);
    if (mini && !animating && hasDoc() && w > 0 && h > 0) {
      var dpr = (OG.view && OG.view.dpr) || 1, pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
      var key = M.ver + '|' + ss + '|' + pw + 'x' + ph + '|' + (o.backdrop ? 1 : 0) + (o.paper ? 1 : 0);
      if (!S.cache || S.cacheKey !== key) {
        var cv = (S.cache && S.cache.width === pw && S.cache.height === ph) ? S.cache : document.createElement('canvas');
        cv.width = pw; cv.height = ph;
        var g = cv.getContext('2d');
        g.setTransform(pw / w, 0, 0, ph / h, 0, 0);
        paint(g, M, 0, 0, w, h, now, o);
        S.cache = cv; S.cacheKey = key;
      }
      ctx.drawImage(S.cache, x, y, w, h);
      return;
    }
    paint(ctx, M, x, y, w, h, now, o);
  }

  function shed() {
    S.shedStart = S.clock();
    S.animUntil = Math.max(S.animUntil, S.shedStart + C.shedSec + 0.1);
    S.cache = null;
  }

  function wrapText(g, text, maxW, maxLines) {
    var words = text.split(' '), lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var t = cur ? cur + ' ' + words[i] : words[i];
      if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = words[i]; } else cur = t;
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      var l = lines[maxLines - 1];
      while (l.length > 1 && g.measureText(l + '…').width > maxW) l = l.slice(0, -1);
      lines[maxLines - 1] = l.replace(/[\s·,]+$/, '') + '…';
    }
    return lines;
  }

  function exportPNG() {
    if (!hasDoc()) return null;
    var W = C.card.w, Hh = C.card.h, cv = document.createElement('canvas');
    cv.width = W; cv.height = Hh;
    var g = cv.getContext('2d'), st = readState(), col = collect(st), T = targets(st, col);
    var M = buildModel(st, T, col);
    var s = OG.state || {}, run = s.run || {}, meta = s.meta || {};
    var FT = '"Baloo 2", "Be Vietnam Pro", sans-serif', FB = '"Be Vietnam Pro", "Baloo 2", sans-serif';
    g.fillStyle = C.paper; g.fillRect(0, 0, W, Hh);
    // frame
    function rr(inset, rad) {
      var a = inset, b = W - inset, c = inset, d = Hh - inset;
      g.beginPath(); g.moveTo(a + rad, c); g.lineTo(b - rad, c); g.arcTo(b, c, b, c + rad, rad); g.lineTo(b, d - rad); g.arcTo(b, d, b - rad, d, rad);
      g.lineTo(a + rad, d); g.arcTo(a, d, a, d - rad, rad); g.lineTo(a, c + rad); g.arcTo(a, c, a + rad, c, rad); g.closePath();
    }
    g.strokeStyle = C.ink; g.lineWidth = 6; rr(30, 38); g.stroke();
    g.globalAlpha = 0.45; g.lineWidth = 2; rr(46, 28); g.stroke(); g.globalAlpha = 1;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillStyle = C.ink; g.font = '800 124px ' + FT; g.fillText('OVERGROW', W / 2, 190);
    var season = Math.max(1, meta.seasons || 1), sub = 'Mùa ' + season;
    if (run.daily && OG.meta && OG.meta.dailyNumber) sub += '  ·  Hạt giống ngày #' + OG.meta.dailyNumber();
    g.font = '600 46px ' + FT; g.fillStyle = '#4A5A3C'; g.fillText(sub, W / 2, 258);
    paint(g, M, 70, 285, 940, 740, 1e9, { mini: false, final: true, paper: false, backdrop: false, halo: false, fitBB: true });
    // stats
    g.strokeStyle = C.ink; g.globalAlpha = 0.5; g.lineWidth = 3; g.beginPath(); g.moveTo(130, 1050); g.lineTo(W - 130, 1050); g.stroke(); g.globalAlpha = 1;
    var cols = [[210, fmtTime(run.time || 0), 'Sống sót'], [540, String(run.level || 1), 'Cấp độ'], [870, String(col.syn.length), 'Cộng hưởng']];
    for (var i = 0; i < 3; i++) {
      g.fillStyle = C.ink; g.font = '700 76px ' + FT; g.fillText(cols[i][1], cols[i][0], 1128);
      g.font = '500 28px ' + FB; g.globalAlpha = 0.72; g.fillText(cols[i][2], cols[i][0], 1170); g.globalAlpha = 1;
    }
    g.font = '600 30px ' + FB; g.fillStyle = C.ink;
    var txt = col.syn.length ? col.syn.map(function (y) { return y.name; }).join('  ·  ') : 'Chưa nở đóa hoa cộng hưởng nào mùa này';
    var lines = wrapText(g, txt, 900, 2);
    for (i = 0; i < lines.length; i++) g.fillText(lines[i], W / 2, 1232 + i * 42);
    g.font = '500 24px ' + FB; g.globalAlpha = 0.6; g.fillText('Mỗi mùa, một cái cây của riêng bạn', W / 2, 1290); g.globalAlpha = 1;
    return cv.toDataURL('image/png');
  }

  OG.treeview = {
    draw: draw, shed: shed, exportPNG: exportPNG,
    // test / tooling hooks
    _reset: function () { S = freshS(); },
    _setClock: function (fn) { S.clock = fn; },
    _info: function () { return { builds: S.builds, ver: S.ver, model: S.model, state: S }; },
    _build: function () { var st = readState(), col = collect(st); return buildModel(st, targets(st, col), col); }
  };

  if (OG.bus && OG.bus.on) {
    OG.bus.on('run:start', function () { S.shedStart = -1; S.cache = null; });
  }
})(window.OG = window.OG || {});
