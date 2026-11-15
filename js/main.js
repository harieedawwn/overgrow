/* OVERGROW — main.js: entry point and glue.
 * Order matters: meta.init first (loads the save, applies settings, may emit offline:gain),
 * then OG.boot() which emits 'boot' -> ui.init and audio hook run with the real save already loaded.
 */
(function (OG) {
  'use strict';
  var Boot = window.Boot;
  function guard(fn, label) { return Boot && Boot.guard ? Boot.guard(fn, label) : fn; }

  function start() {
    if (!OG.boot) { if (window.console) console.warn('[overgrow] OG.boot missing: js/core.js did not load'); return; }
    OG.meta.init();     // save -> OG.state.meta, settings:change, offline gain
    OG.boot();          // canvas, input, loop, 'boot' -> ui.init (title screen), audio gesture hook
    if (OG.ui && OG.ui.init) OG.ui.init(); // idempotent: guarantees the UI exists even if 'boot' was missed

    // boot.js watchdog expects a heartbeat from Boot.loop; core runs its own rAF loop, so keep one cheap beat.
    if (Boot && Boot.loop) Boot.loop(function () {});

    // page hidden: core auto-pauses a running game; make sure the save is flushed too
    if (Boot && Boot.onPause) Boot.onPause(function () { try { OG.meta.save(); OG.save.flush(); } catch (e) {} });
  }

  guard(start, 'main')();
})(window.OG = window.OG || {});
