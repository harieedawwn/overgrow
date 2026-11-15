/* fit.js — keeps a game/app UI fitted to any screen without scrolling.
 * Sets --ui on <html>: a scale factor from the visible size versus a design size, clamped.
 * Usage:  Fit.init({ designW: 1280, designH: 720, min: 0.75, max: 1.35 });
 *         Fit.onChange(({w, h, ui, portrait}) => relayout());
 *         Fit.canvas(canvas, { maxDpr: 2 })  -> keeps a canvas backing store sized to its box * capped DPR
 * Phones get the larger of the two scales clamped to min so touch targets stay usable; the CSS also
 * enforces a 44px floor for buttons.
 */
(function () {
  'use strict';
  var w = window, root = document.documentElement;
  var cfg = { designW: 1280, designH: 720, min: 0.75, max: 1.35 }, subs = [], state = {};
  function size() {
    var vv = w.visualViewport;
    return { w: vv ? vv.width : w.innerWidth, h: vv ? vv.height : w.innerHeight };
  }
  function apply() {
    var s = size(), portrait = s.h >= s.w;
    var dw = portrait ? cfg.designH : cfg.designW, dh = portrait ? cfg.designW : cfg.designH;
    var ui = Math.min(s.w / dw, s.h / dh);
    ui = Math.max(cfg.min, Math.min(cfg.max, ui));
    root.style.setProperty('--ui', ui.toFixed(3));
    state = { w: s.w, h: s.h, ui: ui, portrait: portrait };
    for (var i = 0; i < subs.length; i++) { try { subs[i](state); } catch (e) { console.error(e); } }
  }
  var raf = 0;
  function schedule() { if (!raf) raf = w.requestAnimationFrame(function () { raf = 0; apply(); }); }
  function init(opts) {
    for (var k in opts) cfg[k] = opts[k];
    apply();
    w.addEventListener('resize', schedule);
    w.addEventListener('orientationchange', function () { setTimeout(apply, 250); });
    if (w.visualViewport) w.visualViewport.addEventListener('resize', schedule);
    return state;
  }
  /* Canvas sizing: CSS size from layout, backing store = CSS size * min(devicePixelRatio, maxDpr) * quality */
  function canvas(c, opts) {
    opts = opts || {};
    var maxDpr = opts.maxDpr || 2, ctl = { quality: 1, dpr: 1, onResize: opts.onResize || null };
    function resize() {
      var r = c.getBoundingClientRect();
      var dpr = Math.min(w.devicePixelRatio || 1, maxDpr) * ctl.quality;
      ctl.dpr = dpr;
      var W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; if (ctl.onResize) ctl.onResize(W, H, dpr, r.width, r.height); }
    }
    ctl.resize = resize;
    ctl.setQuality = function (q) { ctl.quality = Math.max(0.5, Math.min(1, q)); resize(); };
    if (w.ResizeObserver) new ResizeObserver(resize).observe(c); else w.addEventListener('resize', resize);
    resize();
    return ctl;
  }
  w.Fit = { init: init, onChange: function (f) { subs.push(f); if (state.w) f(state); }, canvas: canvas, get state() { return state; } };
})();
