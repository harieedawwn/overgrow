'use strict';
// node tests/test_treeview.js
const fs = require('fs'), path = require('path'), vm = require('vm');
globalThis.window = globalThis;
const OG = window.OG = {};
OG.fmtTime = s => { s = Math.floor(s); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'treeview.js'), 'utf8'), { filename: 'treeview.js' });
const TV = OG.treeview;

let fails = 0;
function ok(cond, msg) { if (cond) console.log('  ok   ' + msg); else { fails++; console.log('  FAIL ' + msg); } }

// ---------------------------------------------------------------- stub ctx
function makeCtx(track) {
  const log = [], stack = [];
  let m = [1, 0, 0, 1, 0, 0], pts = [];
  const bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const sc = () => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
  const add = (x, y, r) => { pts.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5], (r || 0) * sc()]); };
  const flush = pad => {
    for (const p of pts) {
      bb.x0 = Math.min(bb.x0, p[0] - p[2] - pad); bb.x1 = Math.max(bb.x1, p[0] + p[2] + pad);
      bb.y0 = Math.min(bb.y0, p[1] - p[2] - pad); bb.y1 = Math.max(bb.y1, p[1] + p[2] + pad);
    }
  };
  const r3 = v => typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
  const state = { lineWidth: 1 };
  const impl = {
    save() { stack.push(m.slice()); }, restore() { m = stack.pop() || m; },
    translate(x, y) { m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; },
    scale(x, y) { m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; },
    beginPath() { pts = []; },
    moveTo(x, y) { add(x, y); }, lineTo(x, y) { add(x, y); },
    quadraticCurveTo(a, b, x, y) { add(x, y); }, bezierCurveTo(a, b, c, d, x, y) { add(x, y); },
    arc(x, y, r) { add(x, y, r); }, ellipse(x, y, rx, ry) { add(x, y, Math.max(rx, ry)); },
    arcTo(x1, y1) { add(x1, y1); }, closePath() { },
    fill() { flush(0); }, stroke() { flush(state.lineWidth * sc() / 2); },
    fillRect(x, y, w, h) { add(x, y); add(x + w, y + h); flush(0); pts = []; },
    fillText() { }, measureText(t) { return { width: t.length * 10 }; }, drawImage() { }, setTransform() { }
  };
  const target = {};
  return {
    log, bb,
    ctx: new Proxy(target, {
      get(_, k) {
        if (k in impl) return (...a) => { if (track) log.push(k + JSON.stringify(a.map(r3))); return impl[k](...a); };
        return state[k];
      },
      set(_, k, v) { state[k] = v; if (track) log.push('set ' + k + '=' + r3(v)); return true; }
    })
  };
}
function noopCtx() {
  const f = () => { };
  return new Proxy({}, { get: (_, k) => k === 'measureText' ? (() => ({ width: 1 })) : f, set: () => true });
}

// ---------------------------------------------------------------- fixtures
const BRS = ['fire', 'wind', 'root', 'stone'];
OG.tree = { skills: [], synergies: [] };
for (let i = 0; i < 40; i++) OG.tree.skills.push({ id: 's' + i, branch: BRS[i % 4], name: 'Kỹ năng ' + i });
for (let i = 0; i < 12; i++) OG.tree.synergies.push({ id: 'y' + i, name: 'Cộng hưởng ' + i, branches: [BRS[i % 4], BRS[(i + 1 + (i >> 2)) % 4 === i % 4 ? (i + 2) % 4 : (i + 1 + (i >> 2)) % 4]] });

function setState(o) {
  OG.state = {
    run: { seed: o.seed || 'abc', time: 540, level: 14, daily: !!o.daily },
    tree: { growth: o.growth || { fire: 0, wind: 0, root: 0, stone: 0 }, skills: o.skills || {}, synergies: o.syn || {}, order: o.order || [] },
    meta: { rootsTotal: o.roots || 0, seasons: 3 }
  };
}
function heavy(seed) {
  const skills = {}, order = []; let ranks = 0, t = 0;
  for (let i = 0; i < 28; i++) { const r = i < 22 ? 2 : 1; skills['s' + i] = r; ranks += r; order.push({ id: 's' + i, branch: BRS[i % 4], kind: 'skill', t: t++ }); }
  const syn = {};
  for (let i = 0; i < 12; i++) { syn['y' + i] = true; order.push({ id: 'y' + i, branch: BRS[i % 4], kind: 'synergy', t: t++ }); }
  return { seed: seed || 'heavy', growth: { fire: 9e5, wind: 4e5, root: 6e5, stone: 3e5 }, skills, syn, order, roots: 5e4, _ranks: ranks };
}
function light(seed) {
  return {
    seed: seed || 'light', growth: { fire: 300, wind: 20, root: 0, stone: 0 }, skills: { s0: 1, s4: 2, s1: 1 },
    order: [{ id: 's0', branch: 'fire', kind: 'skill' }, { id: 's4', branch: 'fire', kind: 'skill' }, { id: 's1', branch: 'wind', kind: 'skill' }], roots: 0
  };
}
let T0 = 100; TV._reset(); TV._setClock(() => T0);
function fresh(o, t) { TV._reset(); T0 = t === undefined ? 100 : t; TV._setClock(() => T0); setState(o); }
function run(o, rect, opts, t) { fresh(o, t); const c = makeCtx(true); TV.draw(c.ctx, rect[0], rect[1], rect[2], rect[3], opts); return c; }

// ---------------------------------------------------------------- tests
console.log('determinism');
{
  const a = run(heavy(), [10, 20, 300, 400], { detail: 'full' }), b = run(heavy(), [10, 20, 300, 400], { detail: 'full' });
  ok(a.log.length > 500, 'draws a real picture (' + a.log.length + ' calls)');
  ok(a.log.join('\n') === b.log.join('\n'), 'same state, fresh instances -> identical draw calls');
  fresh(heavy()); const c1 = makeCtx(true), c2 = makeCtx(true);
  TV.draw(c1.ctx, 0, 0, 300, 400, { detail: 'full' }); TV.draw(c2.ctx, 0, 0, 300, 400, { detail: 'full' });
  ok(c1.log.join('\n') === c2.log.join('\n'), 'same state, redraw -> identical draw calls');
  const d = run(heavy('other-seed'), [10, 20, 300, 400], { detail: 'full' });
  ok(a.log.join('\n') !== d.log.join('\n'), 'different seed -> different tree');
  const h2 = heavy(); h2.order = h2.order.slice().reverse();
  ok(run(h2, [10, 20, 300, 400], { detail: 'full' }).log.join('\n') !== a.log.join('\n'), 'different tree.order -> different tree');
  const l1 = run(light(), [0, 0, 200, 260], { detail: 'full' }), l2 = run(light('x'), [0, 0, 200, 260], { detail: 'full' });
  ok(l1.log.join('\n') !== l2.log.join('\n'), 'light trees with different seeds differ');
}

console.log('fits the rect');
{
  const states = { empty: { seed: 'e' }, light: light(), heavy: heavy(), extreme: (() => { const h = heavy('ex'); h.growth = { fire: 1e15, wind: 1e15, root: 1e15, stone: 1e15 }; h.roots = 1e12; for (let i = 28; i < 40; i++) { h.skills['s' + i] = 5; h.order.push({ id: 's' + i, branch: BRS[i % 4], kind: 'skill' }); } return h; })() };
  const rects = [[10, 20, 300, 400], [5, 5, 120, 120], [0, 0, 960, 760], [50, 50, 400, 300]];
  for (const n in states) for (const r of rects) for (const det of ['full', 'mini']) {
    const c = run(states[n], r, { detail: det });
    const eps = 0.5;
    const inside = c.bb.x0 >= r[0] - eps && c.bb.y0 >= r[1] - eps && c.bb.x1 <= r[0] + r[2] + eps && c.bb.y1 <= r[1] + r[3] + eps;
    if (!inside) console.log('    bb', JSON.stringify(c.bb), 'rect', r);
    ok(inside, n + ' ' + det + ' ' + r.join('x') + ' stays inside the rect');
    if (det === 'full') {
      const mx = Math.min(c.bb.x0 - r[0], r[0] + r[2] - c.bb.x1, c.bb.y0 - r[1], r[1] + r[3] - c.bb.y1);
      ok(mx >= Math.min(r[2], r[3]) * 0.0, n + ' margin ' + mx.toFixed(1) + 'px');
    }
  }
}

console.log('performance (50 skill ranks, 12 synergies)');
{
  const h = heavy(); fresh(h);
  const model = TV._build(); ok(h._ranks >= 50, 'fixture has ' + h._ranks + ' skill ranks and 12 synergies');
  const g = noopCtx();
  let t = process.hrtime.bigint(); TV.draw(g, 0, 0, 400, 520, { detail: 'full' }); let cold = Number(process.hrtime.bigint() - t) / 1e6;
  for (let i = 0; i < 30; i++) TV.draw(g, 0, 0, 400, 520, { detail: 'full' }); // warm up the JIT
  const N = 300; t = process.hrtime.bigint();
  for (let i = 0; i < N; i++) TV.draw(g, 0, 0, 400, 520, { detail: 'full' });
  const avg = Number(process.hrtime.bigint() - t) / 1e6 / N;
  console.log('    cold (model build + first draw): ' + cold.toFixed(2) + ' ms, warm redraw: ' + avg.toFixed(3) + ' ms');
  ok(avg < 4, 'full redraw averages ' + avg.toFixed(3) + ' ms (< 4 ms)');
  ok(cold < 40, 'cold build ' + cold.toFixed(1) + ' ms');
  const c = makeCtx(false); T0 = 100; TV.draw(c.ctx, 0, 0, 400, 520, { detail: 'full' });
  ok(TV._info().builds === 1, 'model is built once, not per frame (' + TV._info().builds + ' build)');
  // mini draw cost (no document in node -> direct paint path)
  t = process.hrtime.bigint(); for (let i = 0; i < N; i++) TV.draw(g, 0, 0, 120, 120, { detail: 'mini' });
  console.log('    mini direct paint: ' + (Number(process.hrtime.bigint() - t) / 1e6 / N).toFixed(3) + ' ms');
}

console.log('growth animation');
{
  fresh(light(), 100); const g0 = makeCtx(true); TV.draw(g0.ctx, 0, 0, 300, 400, { detail: 'full' });
  const o = light(); o.skills.s8 = 1; o.order = o.order.concat([{ id: 's8', branch: 'fire', kind: 'skill' }]); o.growth.fire = 400;
  setState(Object.assign(o, { seed: 'light' }));
  T0 = 100.1; const a = makeCtx(true); TV.draw(a.ctx, 0, 0, 300, 400, { detail: 'full' });
  T0 = 100.3; const b = makeCtx(true); TV.draw(b.ctx, 0, 0, 300, 400, { detail: 'full' });
  for (T0 = 100.3; T0 < 103; T0 += 1 / 60) TV.draw(noopCtx(), 0, 0, 300, 400, { detail: 'full' }); // frames pass, easing settles
  T0 = 103; const c = makeCtx(true); TV.draw(c.ctx, 0, 0, 300, 400, { detail: 'full' });
  ok(a.log.join() !== b.log.join() && b.log.join() !== c.log.join(), 'new twig changes frame to frame while extending (0.6 s)');
  T0 = 104; const d = makeCtx(true); TV.draw(d.ctx, 0, 0, 300, 400, { detail: 'full' });
  ok(c.log.join() === d.log.join(), 'once grown the picture is stable (static -> cacheable)');
  ok(c.log.length > g0.log.length, 'the new twig added shapes and leaves');

  // synergy unfold: 1 s
  fresh(heavy(), 100); TV.draw(makeCtx(false).ctx, 0, 0, 300, 400, { detail: 'full' });
  const h2 = heavy(); h2.syn.y99 = true; h2.order.push({ id: 'y99', branch: 'fire', kind: 'synergy' });
  OG.tree.synergies.push({ id: 'y99', name: 'Mới', branches: ['fire', 'root'] });
  setState(Object.assign(h2, { seed: 'heavy' }));
  const s = [100.05, 100.5, 101.2, 101.4].map(t => { T0 = t; const k = makeCtx(true); TV.draw(k.ctx, 0, 0, 300, 400, { detail: 'full' }); return k.log.join('\n'); });
  ok(s[0] !== s[1] && s[1] !== s[2], 'fused blossom unfolds over time');
  ok(s[2] === s[3], 'blossom finished unfolding after 1 s');
}

console.log('shed keeps the roots');
{
  fresh(heavy(), 200); TV.draw(makeCtx(false).ctx, 0, 0, 300, 400, { detail: 'full' });
  const before = makeCtx(true); TV.draw(before.ctx, 0, 0, 300, 400, { detail: 'full' });
  TV.shed();
  T0 = 200.5; const mid = makeCtx(true); TV.draw(mid.ctx, 0, 0, 300, 400, { detail: 'full' });
  T0 = 201.2; const mid2 = makeCtx(true); TV.draw(mid2.ctx, 0, 0, 300, 400, { detail: 'full' });
  T0 = 202.3; const after = makeCtx(true); TV.draw(after.ctx, 0, 0, 300, 400, { detail: 'full' });
  ok(mid.log.join() !== before.log.join() && mid.log.join() !== mid2.log.join(), 'leaves are falling during the 2 s');
  ok(after.log.length < before.log.length * 0.8 && after.log.length > 150, 'after 2 s leaves are gone (' + before.log.length + ' -> ' + after.log.length + ' calls), bark and roots remain');
  const a2 = makeCtx(true); T0 = 205; TV.draw(a2.ctx, 0, 0, 300, 400, { detail: 'full' });
  ok(a2.log.join() === after.log.join(), 'shed state is stable afterwards');
  // roots grow with rootsTotal
  const depth = r => { fresh(Object.assign(light(), { roots: r }), 300); return TV._build().soil.d; };
  const d0 = depth(0), d1 = depth(1000), d2 = depth(1e7);
  ok(d0 < d1 && d1 < d2, 'root system gets deeper with rootsTotal (' + d0.toFixed(1) + ' < ' + d1.toFixed(1) + ' < ' + d2.toFixed(1) + ')');
  // new season clears the shed
  fresh(heavy(), 400); TV.draw(makeCtx(false).ctx, 0, 0, 300, 400, { detail: 'full' }); TV.shed(); T0 = 410;
  setState({ seed: 'next-season' }); T0 = 411; const ns = makeCtx(true); TV.draw(ns.ctx, 0, 0, 300, 400, { detail: 'full' });
  ok(TV._info().state.shedStart === -1, 'a new season (new seed / empty tree) ends the shed');
}

console.log('exportPNG without a DOM');
ok(TV.exportPNG() === null, 'returns null when there is no document (browser-only)');

if (fails) { console.log('\n' + fails + ' FAILED'); process.exit(1); }
console.log('\nall passed');
