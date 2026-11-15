/* OVERGROW audio.js - procedural Web Audio sound effects (no music, no files).
 * Garden palette: wood, leaves, soft wet squelches, air. Built on the game-sfx engine design
 * (layered transient + body + tail, shared reverb, compressor + limiter, voice limits).
 * Triggered only by contract events. API: OG.audio.unlock() / setMuted(b) / setVolume(v).
 * Extra (preview, tests): OG.audio.play(name, opts), names, renderOffline(name, opts, seconds), stats(). */
(function (OG) {
  'use strict';
  OG.cfg = OG.cfg || {};
  var C = OG.cfg.audio = {
    master: 0.85,        // master gain at volume 1
    duck: 0.3,           // gain factor while paused
    duckTime: 0.06, volTime: 0.03,
    maxVoices: 28,       // all sounds together
    reverb: 0.2, reverbSeconds: 1.4, reverbDecay: 0.3,
    noiseSeconds: 2,
    streakReset: 0.6, streakStep: 0.055, streakMax: 14,
    hurtDip: 800,        // low-pass frequency at the start of a hurt dip (Hz)
    // per sound: level (gain), max (voices at once), gap (min seconds between plays), jit (pitch +-), bus
    sounds: {
      seed_pop:     { level: 0.34, max: 4, gap: 1 / 12, jit: 0.08 },
      squelch:      { level: 0.95, max: 5, gap: 0.045, jit: 0.07 },
      squelch_crit: { level: 0.95, max: 3, gap: 0.05, jit: 0.05 },
      bloom:        { level: 0.55,  max: 5, gap: 0.035, jit: 0.07 },
      xp_tick:      { level: 0.75, max: 4, gap: 0.03, jit: 0 },
      level_up:     { level: 0.8,  max: 2, gap: 0.3, jit: 0.02 },
      skill_fire:   { level: 0.8,  max: 2, gap: 0.2, jit: 0.04 },
      skill_wind:   { level: 0.8,  max: 2, gap: 0.2, jit: 0.04 },
      skill_root:   { level: 0.8,  max: 2, gap: 0.2, jit: 0.04 },
      skill_stone:  { level: 0.85, max: 2, gap: 0.2, jit: 0.04 },
      synergy:      { level: 0.95, max: 2, gap: 0.5, jit: 0.02 },
      hurt:         { level: 0.9,  max: 3, gap: 0.12, jit: 0.05 },
      dash:         { level: 0.6,  max: 3, gap: 0.12, jit: 0.06 },
      nova:         { level: 0.8,  max: 3, gap: 0.08, jit: 0.05 },
      boss_spawn:   { level: 0.7,  max: 1, gap: 0.5, jit: 0 },
      boss_dead:    { level: 0.95, max: 1, gap: 0.5, jit: 0 },
      run_end:      { level: 0.8,  max: 1, gap: 0.5, jit: 0 },
      revive:       { level: 0.75, max: 1, gap: 0.5, jit: 0 },
      ui_click:     { level: 0.5,  max: 3, gap: 0.03, jit: 0.04, bus: 'ui' },
      ui_hover:     { level: 0.5,  max: 2, gap: 0.05, jit: 0.04, bus: 'ui' }
    }
  };

  var AC = (typeof window !== 'undefined') ? (window.AudioContext || window.webkitAudioContext) : null;
  var OAC = (typeof window !== 'undefined') ? (window.OfflineAudioContext || window.webkitOfflineAudioContext) : null;
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var vary = function (x, p) { return x * (1 + rnd(-p, p)); };

  /* ---------- graph (built once per context; all buffers pre-rendered here) ---------- */
  function makeNoise(ctx, kind) {
    var len = Math.floor(ctx.sampleRate * C.noiseSeconds), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0, i, w;
    for (i = 0; i < len; i++) {
      w = Math.random() * 2 - 1;
      if (kind === 'pink') {
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
      } else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    // crossfade the loop seam so looping never clicks
    var n = Math.floor(ctx.sampleRate * 0.01);
    for (i = 0; i < n; i++) { var k = i / n; d[len - n + i] = d[len - n + i] * (1 - k) + d[i] * k; }
    return buf;
  }
  function makeIR(ctx, seconds, decay) {
    var len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var c = 0; c < 2; c++) {
      var d = buf.getChannelData(c), lp = 0;
      for (var i = 0; i < len; i++) {
        var t = i / ctx.sampleRate;
        lp += ((Math.random() * 2 - 1) - lp) * (0.5 - 0.38 * Math.min(1, t / seconds));
        d[i] = lp * Math.exp(-t / decay) * (t < 0.004 ? t / 0.004 : 1);
      }
    }
    return buf;
  }
  function shaperCurve(k) {
    var n = 1024, c = new Float32Array(n), norm = Math.tanh(k);
    for (var i = 0; i < n; i++) c[i] = Math.tanh(k * (i / (n - 1) * 2 - 1)) / norm;
    return c;
  }
  function build(ctx) {
    var g = { ctx: ctx };
    g.master = ctx.createGain();                       // volume / mute / duck
    g.comp = ctx.createDynamicsCompressor();
    g.comp.threshold.value = -16; g.comp.knee.value = 8; g.comp.ratio.value = 3; g.comp.attack.value = 0.004; g.comp.release.value = 0.2;
    g.limiter = ctx.createDynamicsCompressor();
    g.limiter.threshold.value = -3; g.limiter.knee.value = 0; g.limiter.ratio.value = 20; g.limiter.attack.value = 0.001; g.limiter.release.value = 0.08;
    g.dip = ctx.createBiquadFilter(); g.dip.type = 'lowpass'; g.dip.frequency.value = 20000; g.dip.Q.value = 0.5;
    g.sfx = ctx.createGain(); g.ui = ctx.createGain();
    g.sfx.connect(g.dip); g.dip.connect(g.comp);
    g.comp.connect(g.limiter); g.ui.connect(g.limiter);
    g.limiter.connect(g.master); g.master.connect(ctx.destination);
    g.verb = ctx.createConvolver(); g.verb.buffer = makeIR(ctx, C.reverbSeconds, C.reverbDecay);
    g.verbIn = ctx.createGain(); g.verbIn.gain.value = C.reverb;
    g.verbIn.connect(g.verb); g.verb.connect(g.dip);
    g.noise = { white: makeNoise(ctx, 'white'), pink: makeNoise(ctx, 'pink'), brown: makeNoise(ctx, 'brown') };
    g.curve = shaperCurve(2.4);
    return g;
  }

  /* ---------- voice toolkit ---------- */
  function Voice(g, bus, o) {
    var ctx = g.ctx;
    this.ctx = ctx; this.g = g; this.p = o.pitch || 1; this.end = ctx.currentTime;
    this.out = ctx.createGain(); this.out.gain.value = o.vol == null ? 1 : o.vol;
    this.out.connect(bus === 'ui' ? g.ui : g.sfx);
    if (bus !== 'ui') { this.send = ctx.createGain(); this.send.gain.value = 0.7; this.out.connect(this.send); this.send.connect(g.verbIn); }
  }
  Voice.prototype.f = function (type, freq, Q) {
    var f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (Q != null) f.Q.value = Q; return f;
  };
  Voice.prototype.drive = function () { var s = this.ctx.createWaveShaper(); s.curve = this.g.curve; return s; };
  Voice.prototype.env = function (t, attack, peak, tau, hold) {
    var e = this.ctx.createGain(), p = e.gain; hold = hold || 0;
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + attack);
    if (hold) p.setValueAtTime(peak, t + attack + hold);
    p.setTargetAtTime(0, t + attack + hold, tau);
    var stop = t + attack + hold + tau * 7;
    if (stop > this.end) this.end = stop;
    return { node: e, stop: stop };
  };
  Voice.prototype.chain = function (src, nodes) {
    var n = src; for (var i = 0; i < nodes.length; i++) { n.connect(nodes[i]); n = nodes[i]; } n.connect(this.out);
  };
  // filtered noise burst: {type, attack, tau, gain, hold, filters, rate, drive, wet}
  Voice.prototype.noise = function (t, o) {
    var src = this.ctx.createBufferSource(); src.buffer = this.g.noise[o.type || 'white']; src.loop = true;
    src.playbackRate.value = (o.rate || 1) * Math.sqrt(this.p);
    var e = this.env(t, o.attack || 0.001, o.gain == null ? 1 : o.gain, o.tau || 0.05, o.hold);
    var nodes = (o.filters || []).slice(); if (o.drive) nodes.push(this.drive()); nodes.push(e.node);
    this.chain(src, nodes);
    if (o.wet) { var w = this.ctx.createGain(); w.gain.value = o.wet; e.node.connect(w); w.connect(this.g.verbIn); }
    src.start(t, rnd(0, C.noiseSeconds - 0.3)); src.stop(e.stop);
    return { filters: o.filters || [] };
  };
  // pitched sine with optional glide f0 -> f1
  Voice.prototype.tone = function (t, o) {
    var osc = this.ctx.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(o.f0 * this.p, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1 * this.p), t + (o.glide || 0.1));
    var e = this.env(t, o.attack || 0.002, o.gain == null ? 1 : o.gain, o.tau || 0.1, o.hold);
    var nodes = []; if (o.drive) nodes.push(this.drive()); nodes.push(e.node);
    this.chain(osc, nodes); osc.start(t); osc.stop(e.stop);
  };
  // many tiny noise bursts (leaves, crackle, debris); gain ramps with o.rise (1 = flat, >1 louder at the end)
  Voice.prototype.grains = function (t, n, span, o) {
    for (var i = 0; i < n; i++) {
      var x = i / Math.max(1, n - 1), tt = t + Math.pow(Math.random(), o.skew || 1) * span;
      this.noise(tt, { tau: rnd(o.tauMin || 0.003, o.tauMax || 0.012), gain: rnd(0.4, 1) * o.gain * (o.rise ? 0.25 + 0.75 * x : 1),
        filters: [this.f('bandpass', rnd(o.fMin, o.fMax), o.Q || 1.2)] });
    }
  };
  // noise with a swept band-pass (whooshes, gusts, swells): freqs [[time offset, Hz], ...]
  Voice.prototype.sweep = function (t, o) {
    var bp = this.f('bandpass', o.freqs[0][1], o.Q || 1.2);
    for (var i = 0; i < o.freqs.length; i++) {
      if (i === 0) bp.frequency.setValueAtTime(o.freqs[0][1], t + o.freqs[0][0]);
      else bp.frequency.exponentialRampToValueAtTime(o.freqs[i][1], t + o.freqs[i][0]);
    }
    var fl = [bp]; if (o.hp) fl.push(this.f('highpass', o.hp));
    this.noise(t, { type: o.type || 'pink', attack: o.attack, tau: o.tau, hold: o.hold, gain: o.gain, filters: fl, wet: o.wet });
  };

  /* ---------- textures reused by skill:gain and synergy:found ---------- */
  var TEX = {
    fire: function (a, t, g) {      // crackle
      a.grains(t, 16, 0.4, { gain: 0.9 * g, fMin: 1500, fMax: 6500, skew: 1.5, tauMin: 0.002, tauMax: 0.007 });
      a.noise(t, { type: 'pink', attack: 0.02, tau: 0.12, gain: 0.3 * g, filters: [a.f('lowpass', 650)], wet: 0.4 });
    },
    wind: function (a, t, g) {      // gust
      a.sweep(t, { freqs: [[0, 350], [0.18, 1500], [0.45, 600]], Q: 1.1, attack: 0.16, tau: 0.16, gain: 1.0 * g, hp: 250, wet: 0.5 });
      a.noise(t + 0.05, { attack: 0.14, tau: 0.12, gain: 0.12 * g, filters: [a.f('highpass', 4500)] });
    },
    root: function (a, t, g) {      // wooden creak
      var bp = a.f('bandpass', 260, 9), n = 9, i;
      bp.frequency.setValueAtTime(260, t);
      for (i = 1; i <= n; i++) bp.frequency.linearRampToValueAtTime(rnd(210, 430), t + i * 0.035);
      a.noise(t, { type: 'pink', attack: 0.03, tau: 0.1, hold: 0.12, gain: 1.1 * g, filters: [bp], wet: 0.3 });
      a.tone(t, { f0: 78, f1: 64, glide: 0.3, attack: 0.04, tau: 0.12, gain: 0.3 * g, drive: true });
    },
    stone: function (a, t, g) {     // thunk
      a.tone(t, { f0: 100, f1: 50, glide: 0.09, tau: 0.085, gain: 1.0 * g, drive: true });
      a.noise(t, { type: 'pink', tau: 0.035, gain: 0.55 * g, filters: [a.f('lowpass', 750)] });
      a.noise(t, { tau: 0.003, gain: 0.35 * g, filters: [a.f('highpass', 2200)] });
      a.tone(t, { f0: 640, tau: 0.02, gain: 0.08 * g });
    }
  };

  /* ---------- recipes: fn(a: Voice, t: start, o: options) ---------- */
  var R = {};
  R.seed_pop = function (a, t) {
    a.tone(t, { f0: 540, f1: 240, glide: 0.04, tau: 0.016, gain: 0.8 });
    a.noise(t, { tau: 0.006, gain: 0.4, filters: [a.f('bandpass', 1900, 2)] });
  };
  R.squelch = function (a, t) {
    a.sweep(t, { freqs: [[0, 650], [0.07, 230]], Q: 4, tau: 0.045, attack: 0.002, gain: 0.9, wet: 0.3 });
    a.tone(t, { f0: 165, f1: 85, glide: 0.07, tau: 0.04, gain: 0.55, drive: true });
    a.tone(t + 0.012, { f0: 280, f1: 620, glide: 0.04, tau: 0.016, gain: 0.16 });     // wet bubble
  };
  R.squelch_crit = function (a, t) {
    R.squelch(a, t, {});
    a.noise(t, { tau: 0.007, gain: 0.7, filters: [a.f('highpass', 2600)] });         // sharper snap
    a.tone(t, { f0: 950, f1: 420, glide: 0.03, tau: 0.02, gain: 0.45 });             // wooden crack
  };
  R.bloom = function (a, t) {
    a.tone(t, { f0: 430, f1: 175, glide: 0.05, tau: 0.03, gain: 0.8 });
    a.noise(t, { tau: 0.012, gain: 0.35, filters: [a.f('bandpass', 1500, 1.5)] });
    a.grains(t + 0.04, 10, 0.24, { gain: 0.5, fMin: 3000, fMax: 7500, skew: 1.2, tauMin: 0.004, tauMax: 0.014 });
    a.noise(t + 0.03, { attack: 0.05, tau: 0.09, gain: 0.16, filters: [a.f('highpass', 2500)], wet: 0.4 });
  };
  R.xp_tick = function (a, t) {
    a.noise(t, { tau: 0.004, gain: 0.6, filters: [a.f('bandpass', 2500, 5)] });
    a.tone(t, { f0: 880, f1: 760, glide: 0.01, tau: 0.01, gain: 0.5 });
  };
  R.level_up = function (a, t) {
    a.sweep(t, { freqs: [[0, 450], [0.3, 2800]], Q: 1.1, attack: 0.14, tau: 0.12, gain: 1.0, hp: 250, wet: 0.6 });
    a.noise(t + 0.05, { attack: 0.15, tau: 0.1, gain: 0.14, filters: [a.f('highpass', 4200)] });
    a.grains(t + 0.1, 8, 0.25, { gain: 0.4, fMin: 3500, fMax: 8000, rise: true });
    var k = t + 0.24;                                                                   // wooden knock
    a.tone(k, { f0: 200, f1: 105, glide: 0.06, tau: 0.055, gain: 1.0, drive: true });
    a.noise(k, { tau: 0.02, gain: 0.55, filters: [a.f('lowpass', 1000)] });
    a.noise(k, { tau: 0.004, gain: 0.45, filters: [a.f('bandpass', 2200, 3)] });
  };
  R.skill_fire = function (a, t) { TEX.fire(a, t, 1); };
  R.skill_wind = function (a, t) { TEX.wind(a, t, 1); };
  R.skill_root = function (a, t) { TEX.root(a, t, 1); };
  R.skill_stone = function (a, t) { TEX.stone(a, t, 1); };
  R.synergy = function (a, t, o) {
    var b = o.branches && o.branches.length ? o.branches : ['fire', 'wind'], first = !!o.first, i;
    a.tone(t, { f0: 72, f1: 36, glide: 0.3, tau: first ? 0.4 : 0.3, gain: 1.15, drive: true });           // deep wooden thump
    a.noise(t, { type: 'brown', attack: 0.004, tau: 0.22, gain: 0.9, filters: [a.f('lowpass', 320)], drive: true });
    a.tone(t, { f0: 190, f1: 92, glide: 0.07, tau: 0.06, gain: 0.8, drive: true });
    a.noise(t, { tau: 0.004, gain: 0.45, filters: [a.f('bandpass', 2000, 3)] });
    a.sweep(t + 0.05, { freqs: [[0, 500], [0.8, 3800]], Q: 1.0, attack: 0.7, tau: 0.3, hold: 0.1, gain: 0.8, hp: 220, wet: 0.9 });  // rising rustle swell
    a.grains(t + 0.2, 16, 0.8, { gain: 0.35, fMin: 3000, fMax: 8000, rise: true });
    for (i = 0; i < b.length && i < 2; i++) { if (TEX[b[i]]) TEX[b[i]](a, t + 0.08 + i * 0.28, 0.75); }    // the branch pair's textures
    a.noise(t + 0.95, { attack: 0.02, tau: 0.35, gain: 0.35, filters: [a.f('bandpass', 2600, 0.8)], wet: 0.9 }); // settling rustle
    if (first) a.tone(t + 0.02, { f0: 48, f1: 30, glide: 0.5, attack: 0.02, tau: 0.5, gain: 0.7 });
  };
  R.hurt = function (a, t, o) {
    a.tone(t, { f0: 125, f1: 55, glide: 0.08, tau: 0.075, gain: 1.0, drive: true });
    a.noise(t, { type: 'pink', tau: 0.05, gain: 0.8, filters: [a.f('lowpass', 520)] });
    a.noise(t, { tau: 0.003, gain: 0.12, filters: [a.f('highpass', 1800)] });
    // low-pass dip: the whole sfx bus darkens for a moment
    var f = a.g.dip.frequency, now = a.ctx.currentTime;
    f.cancelScheduledValues(now); f.setValueAtTime(C.hurtDip, now); f.setTargetAtTime(20000, now + 0.1, 0.12);
  };
  R.dash = function (a, t) {
    a.sweep(t, { freqs: [[0, 500], [0.1, 3000], [0.22, 900]], Q: 1.0, attack: 0.04, tau: 0.07, gain: 1.0, hp: 300 });
    a.noise(t, { attack: 0.03, tau: 0.06, gain: 0.2, filters: [a.f('highpass', 5000)] });
  };
  R.nova = function (a, t) {
    var lp = a.f('lowpass', 7000);
    lp.frequency.setValueAtTime(7000, t); lp.frequency.exponentialRampToValueAtTime(700, t + 0.3);
    a.noise(t, { attack: 0.004, tau: 0.14, gain: 0.9, filters: [lp], wet: 0.6 });
    a.tone(t, { f0: 150, f1: 55, glide: 0.18, tau: 0.14, gain: 0.8, drive: true });
    a.sweep(t, { freqs: [[0, 700], [0.25, 2200]], Q: 0.8, attack: 0.02, tau: 0.1, gain: 0.4, wet: 0.5 });
  };
  R.boss_spawn = function (a, t, o) {
    var big = o.kind === 'mother' ? 1.2 : 1, i;
    a.tone(t, { f0: 46, f1: 34, glide: 1.8, attack: 0.35, hold: 0.8, tau: 0.3, gain: 1.0 * big, drive: true });
    a.noise(t, { type: 'brown', attack: 0.4, hold: 0.9, tau: 0.35, gain: 1.0 * big, filters: [a.f('lowpass', 170)] });
    for (i = 0; i < 4; i++) {     // ground cracking
      var k = t + 0.2 + i * rnd(0.3, 0.5);
      a.noise(k, { type: 'brown', tau: 0.07, gain: 0.7, filters: [a.f('bandpass', rnd(160, 420), 2)] });
      a.grains(k, 4, 0.12, { gain: 0.25, fMin: 300, fMax: 1200 });
    }
  };
  R.boss_dead = function (a, t, o) {
    var big = o.kind === 'mother' ? 1.2 : 1;
    a.tone(t, { f0: 70, f1: 28, glide: 0.5, tau: 0.35, gain: 1.0 * big, drive: true });
    a.noise(t, { type: 'brown', attack: 0.01, tau: 0.45, gain: 1.0 * big, filters: [a.f('lowpass', 380)], drive: true });
    a.grains(t, 40, 1.2, { gain: 0.8, fMin: 200, fMax: 1900, skew: 0.8, tauMin: 0.02, tauMax: 0.06, Q: 1.4 });  // crumble
    a.sweep(t + 0.55, { freqs: [[0, 800], [0.9, 4200]], Q: 0.9, attack: 0.5, tau: 0.45, gain: 0.7, hp: 300, wet: 0.9 });  // bloom rustle
    a.grains(t + 0.5, 28, 1.3, { gain: 0.4, fMin: 3000, fMax: 8500, rise: true, skew: 1.1 });
  };
  R.run_end = function (a, t, o) {
    var p = o.result === 'clear' ? 1.1 : 0.95;
    a.sweep(t, { freqs: [[0, 300 * p], [0.9, 950 * p], [1.9, 260 * p]], Q: 0.8, attack: 0.55, hold: 0.3, tau: 0.6, gain: 1.0, hp: 150, wet: 0.8 });
    a.sweep(t + 0.1, { freqs: [[0, 1300], [1.2, 1700], [2, 1100]], Q: 9, attack: 0.7, hold: 0.2, tau: 0.5, gain: 0.1, wet: 0.8 });  // thin whistle in the cold
  };
  R.revive = function (a, t) {          // a rustle played backwards: swell, rising grain density, then a soft tap
    a.sweep(t, { freqs: [[0, 700], [0.6, 3800]], Q: 1.0, attack: 0.6, tau: 0.02, gain: 0.8, hp: 300, wet: 0.5 });
    a.grains(t, 20, 0.6, { gain: 0.5, fMin: 3000, fMax: 8000, skew: 0.5, rise: true });
    a.tone(t + 0.62, { f0: 310, f1: 190, glide: 0.04, tau: 0.03, gain: 0.7 });
    a.noise(t + 0.62, { tau: 0.012, gain: 0.4, filters: [a.f('bandpass', 1800, 2)], wet: 0.5 });
  };
  R.ui_click = function (a, t) {
    a.noise(t, { tau: 0.004, gain: 0.5, filters: [a.f('bandpass', 3600, 1)] });              // paper
    a.tone(t, { f0: 430, f1: 300, glide: 0.012, tau: 0.012, gain: 0.35 });                    // wood
    a.noise(t, { type: 'pink', tau: 0.01, gain: 0.2, filters: [a.f('lowpass', 900)] });
  };
  R.ui_hover = function (a, t) {
    a.noise(t, { tau: 0.003, gain: 0.45, filters: [a.f('bandpass', 5200, 1.5)] });
    a.tone(t, { f0: 720, f1: 600, glide: 0.008, tau: 0.006, gain: 0.15 });
  };

  /* ---------- engine state ---------- */
  var ctx = null, g = null, voices = [], lastPlay = {}, lastXp = -9, streak = 0;
  var muted = false, volume = 0.8, ducked = false, unlocked = false, hooked = false;
  var played = 0, dropped = 0;

  function now() { return ctx ? ctx.currentTime : 0; }
  function targetGain() { return muted ? 0 : volume * C.master * (ducked ? C.duck : 1); }
  function applyGain(fast) {
    if (!g) return;
    var p = g.master.gain, t = ctx.currentTime;
    p.cancelScheduledValues(t); p.setTargetAtTime(targetGain(), t, fast ? C.duckTime : C.volTime);
  }
  function ensure() {
    if (ctx) return true;
    if (!AC) return false;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; return false; } }
    g = build(ctx);
    g.master.gain.value = targetGain();
    return true;
  }
  function readSettings() {
    var s = OG.state && OG.state.meta && OG.state.meta.settings;
    if (s) setSettings(s);
  }
  function setSettings(s) {
    if (!s) return;
    if (typeof s.mute === 'boolean') muted = s.mute;
    if (typeof s.volume === 'number') volume = Math.max(0, Math.min(1, s.volume));
    applyGain();
  }
  function unlock() {
    if (!ensure()) return;
    try { if (ctx.state !== 'running') { var p = ctx.resume(); if (p && p.catch) p.catch(function () {}); } } catch (e) {}
    if (!unlocked) {
      try { var b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) {} // iOS unlock
      readSettings(); applyGain();
      unlocked = true;
    }
  }
  function kill(rec) {
    var t = now();
    try { rec.v.out.gain.cancelScheduledValues(t); rec.v.out.gain.setTargetAtTime(0, t, 0.01); } catch (e) {}
    var i = voices.indexOf(rec); if (i > -1) voices.splice(i, 1);
  }
  // returns the voice record or null when throttled / silent
  function play(name, o) {
    var cfg = C.sounds[name], fn = R[name];
    if (!cfg || !fn) return null;
    if (!ctx || !g || muted || volume <= 0) return null;
    if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} dropped++; return null; }
    var t = ctx.currentTime, i;
    if (lastPlay[name] != null && t - lastPlay[name] < cfg.gap - 1e-6) { dropped++; return null; }
    for (i = voices.length - 1; i >= 0; i--) if (voices[i].end < t) voices.splice(i, 1);
    var same = [];
    for (i = 0; i < voices.length; i++) if (voices[i].name === name) same.push(voices[i]);
    if (same.length >= cfg.max) kill(same[0]);
    if (voices.length >= C.maxVoices) kill(voices[0]);
    lastPlay[name] = t;
    var opts = {}; for (var k in (o || {})) opts[k] = o[k];
    opts.pitch = (opts.pitch || 1) * (cfg.jit ? vary(1, cfg.jit) : 1);
    opts.vol = (opts.vol == null ? 1 : opts.vol) * cfg.level * vary(1, 0.08);
    var v = new Voice(g, cfg.bus || 'sfx', opts);
    fn(v, t + 0.004, opts);
    var rec = { name: name, v: v, end: v.end };
    voices.push(rec); played++;
    return rec;
  }

  /* ---------- offline render (tests / sound check) ---------- */
  function renderOffline(name, o, seconds, sampleRate) {
    if (!OAC || !R[name]) return Promise.reject(new Error('no offline audio or unknown sound'));
    sampleRate = sampleRate || 48000; seconds = seconds || 3;
    var oc = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate), og = build(oc), cfg = C.sounds[name];
    og.master.gain.value = C.master * 0.8;
    var opts = {}; for (var k in (o || {})) opts[k] = o[k];
    opts.pitch = opts.pitch || 1; opts.vol = (opts.vol == null ? 1 : opts.vol) * cfg.level;
    R[name](new Voice(og, cfg.bus || 'sfx', opts), 0.01, opts);
    return oc.startRendering();
  }

  /* ---------- event wiring ---------- */
  var KIND_PITCH = { spore: 1.3, mold: 1, brute: 0.7, spitter: 1.05, core: 0.6, mother: 0.5 };
  var EV = {
    'player:shoot': function () { play('seed_pop'); },
    'enemy:hit': function (d) { play(d && d.crit ? 'squelch_crit' : 'squelch', { pitch: (d && KIND_PITCH[d.kind]) || 1 }); },
    'enemy:die': function (d) { play('bloom', { pitch: (d && KIND_PITCH[d.kind]) || 1 }); },
    'xp:pickup': function () {
      var t = now();
      streak = (t - lastXp < C.streakReset) ? Math.min(streak + 1, C.streakMax) : 0;
      lastXp = t;
      if (!play('xp_tick', { pitch: 1 + streak * C.streakStep })) { /* throttled: streak still advanced */ }
    },
    'level:up': function () { play('level_up'); },
    'skill:gain': function (d) { var b = d && d.branch; play(b === 'wind' ? 'skill_wind' : b === 'root' ? 'skill_root' : b === 'stone' ? 'skill_stone' : 'skill_fire'); },
    'synergy:found': function (d) { play('synergy', { branches: d && d.branches, first: d && d.first }); },
    'player:hurt': function () { play('hurt'); },
    'player:dash': function () { play('dash'); },
    'fx:nova': function () { play('nova'); },
    'boss:spawn': function (d) { play('boss_spawn', { kind: d && d.kind }); },
    'boss:dead': function (d) { play('boss_dead', { kind: d && d.kind }); },
    'run:end': function (d) { play('run_end', { result: d && d.result }); },
    'player:revive': function () { play('revive'); },
    'ui:click': function () { play('ui_click'); },
    'ui:hover': function () { play('ui_hover'); },
    'settings:change': function (d) { setSettings(d && d.settings ? d.settings : d); },
    'game:pause': function () { ducked = true; applyGain(true); },
    'game:resume': function () { ducked = false; applyGain(true); },
    'state:change': function (d) { if (d && d.from === 'paused' && d.to !== 'paused' && ducked) { ducked = false; applyGain(true); } }
  };
  Object.keys(EV).forEach(function (n) { OG.bus.on(n, EV[n]); });

  // first user gesture unlocks audio (iOS Safari, Zalo/Facebook in-app browsers); hooked on boot, not at load
  function hook() {
    if (hooked || typeof window === 'undefined' || !window.addEventListener) return;
    hooked = true;
    var evs = ['pointerdown', 'touchstart', 'touchend', 'mousedown', 'keydown'];
    function go() {
      unlock();
      if (ctx && ctx.state === 'running') evs.forEach(function (e) { window.removeEventListener(e, go, true); });
    }
    evs.forEach(function (e) { window.addEventListener(e, go, true); });
    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('visibilitychange', function () {
        if (!ctx) return;
        if (document.hidden) { try { if (ctx.state === 'running' && ctx.suspend) ctx.suspend(); } catch (e) {} }
        else { try { ctx.resume(); } catch (e) {} }
      });
    }
    readSettings();
  }
  OG.bus.on('boot', hook);

  OG.audio = {
    unlock: unlock,
    setMuted: function (b) { muted = !!b; applyGain(); },
    setVolume: function (v) { volume = Math.max(0, Math.min(1, +v || 0)); applyGain(); },
    play: play,
    renderOffline: renderOffline,
    names: Object.keys(R),
    events: Object.keys(EV),
    stats: function () { return { played: played, dropped: dropped, voices: voices.length, muted: muted, volume: volume, ducked: ducked, gain: g ? g.master.gain.value : null, streak: streak }; }
  };
})(window.OG = window.OG || {});
