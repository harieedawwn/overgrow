/* OVERGROW — ui.js
 * Every screen and the HUD as a DOM overlay on top of <canvas id="game">.
 * Concept: "a gardener's field notebook" (see css/style.css).
 *
 * Public API (CONTRACT): OG.ui.init() · OG.ui.show(screen)
 *   screens: title, hud, levelup, pause, settings, winter, roots, codex, offline, confirm
 *   extras : OG.ui.show('confirm', {title,text,yes,no,danger,onYes,onNo}) · OG.ui.show('photo', {src}) · OG.ui.close()
 */
(function (OG) {
  'use strict';

  OG.cfg = OG.cfg || {};
  var C = OG.cfg.ui = {
    inputLock: 0.35,      // s: level-up cards ignore input so a moving thumb never picks by accident
    rerollLock: 0.2,      // s: lock after a reroll swaps the cards
    toastTime: 2.5,       // s: synergy banner
    bossToastTime: 2.2,
    hintMoveTime: 7,      // s: "kéo để di chuyển" hint stays at most this long
    hintMoveDismiss: 1.2, // s: ...or until the player has been moving this long
    miniFps: 10,          // HUD mini tree
    bigTreeFps: 24,       // title / pause / winter trees
    countUp: 0.9,         // s: winter numbers count up
    goalTime: 900,        // s: the clock shows /15:00
    lowHp: 0.3
  };

  var bus = OG.bus, doc = document, root = doc.documentElement;
  var NS = 'http://www.w3.org/2000/svg';
  var reduceMotion = false;
  try { reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  /* ------------------------------------------------------------------ data */
  var BR = {
    fire:  { name: 'Lửa', color: '#E07A5F', icon: 'flame' },
    wind:  { name: 'Gió', color: '#8FC1C9', icon: 'wind' },
    root:  { name: 'Rễ',  color: '#A7C957', icon: 'root' },
    stone: { name: 'Đá',  color: '#B8A99A', icon: 'stone' }
  };
  var DEF_SETTINGS = { mute: false, volume: 0.8, shake: true, colorblind: false, relax: false, hints: { move: false, tree: false } };

  var P = {
    flame: '<path d="M12 21c-3.900 0-6.500-2.600-6.500-6.200 0-3 1.800-4.600 3.200-6.600C9.800 6.200 10.600 4.800 10.800 3c3.100 2 5 4.700 5.200 7.400.9-.5 1.500-1.400 1.800-2.600 1.500 1.800 2.200 3.800 2.200 6.100C20 18.400 16.600 21 12 21z"/><path d="M12 18.200c-1.500 0-2.500-1-2.500-2.400 0-1.400 1-2.100 2.500-3.800 1.500 1.700 2.500 2.400 2.500 3.800 0 1.400-1 2.400-2.500 2.400z"/>',
    wind: '<path d="M3 8h9a2.500 2.500 0 1 0-2.500-2.500"/><path d="M3 12h14a3 3 0 1 1-3 3"/><path d="M3 16.500h6"/>',
    root: '<circle cx="12" cy="5" r="2.200"/><path d="M12 7.200V21M12 11c0 3-4 4-4 7M12 11c0 3 4 4 4 7M8 18l-3 3M16 18l3 3"/>',
    stone: '<path d="M4 17l2.500-8 5-4.500 6 3.500 2.500 7.500-4 3.500H8z"/><path d="M6.500 9l5.500 3 6-.5M12 12l-1 8.500"/>',
    leaf: '<path d="M5 19C5 10 10 5 20 4c0 10-4.500 15-13 15z"/><path d="M5 19c3-5 6-8 11-11"/>',
    pause: '<path class="fl" d="M7.200 5h2.600c.7 0 1.200.5 1.200 1.200v11.600c0 .7-.5 1.200-1.200 1.200H7.200C6.500 19 6 18.500 6 17.800V6.200C6 5.500 6.500 5 7.200 5zM14.200 5h2.600c.7 0 1.200.5 1.200 1.200v11.600c0 .7-.5 1.200-1.200 1.200h-2.600c-.7 0-1.200-.5-1.200-1.200V6.200c0-.7.5-1.200 1.200-1.200z"/>',
    play: '<path class="fl" d="M8 5.200v13.600c0 .8.9 1.300 1.600.8l10-6.800c.6-.4.6-1.200 0-1.600l-10-6.800C8.900 3.900 8 4.400 8 5.200z"/>',
    sound: '<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z"/><path d="M15.500 9a4 4 0 0 1 0 6M18 6.500a8 8 0 0 1 0 11"/>',
    mute: '<path d="M4 9.500v5h3.500L12 18.500v-13L7.500 9.500z"/><path d="M16 9.500l5 5M21 9.500l-5 5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="6.500"/><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M18.700 5.300l-2.100 2.100M7.400 16.600l-2.100 2.100"/>',
    share: '<circle cx="18" cy="5.500" r="2.500"/><circle cx="6" cy="12" r="2.500"/><circle cx="18" cy="18.500" r="2.500"/><path d="M8.300 10.800l7.400-4.100M8.300 13.200l7.400 4.100"/>',
    book: '<path d="M12 6.500C10 5 7 4.500 4 5v13c3-.5 6 0 8 1.500 2-1.500 5-2 8-1.500V5c-3-.5-6 0-8 1.500z"/><path d="M12 6.500v13"/>',
    seed: '<path d="M12 3c4 3 6 6.500 6 10a6 6 0 0 1-12 0c0-3.500 2-7 6-10z"/><path d="M12 8.500V17M12 12.500l2.500-2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.500V5M12 19v2.500M2.500 12H5M19 12h2.500M5.300 5.300l1.800 1.800M16.900 16.900l1.800 1.800M18.700 5.300l-1.800 1.800M7.100 16.900l-1.800 1.800"/>',
    heart: '<path d="M12 20s-7.500-4.800-7.500-10.200A4.200 4.200 0 0 1 12 7.300a4.200 4.200 0 0 1 7.500 2.500C19.500 15.200 12 20 12 20z"/>',
    back: '<path d="M19 12H6M11 6l-6 6 6 6"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.500-3.800M4 13a8 8 0 0 0 14.500 3.800"/><path d="M20 4v5h-5M4 20v-5h5"/>',
    download: '<path d="M12 4v11M7 10.500l5 5 5-5M5 20h14"/>',
    check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
    trash: '<path d="M5 7h14M10 7V4.500h4V7M7 7l1 13h8l1-13M10.500 11v5.500M13.500 11v5.500"/>',
    spark: '<path d="M12 3l2.200 6.800L21 12l-6.800 2.200L12 21l-2.200-6.800L3 12l6.800-2.200z"/>',
    dash: '<path d="M5 6l6 6-6 6M12 6l6 6-6 6"/>',
    eye: '<path d="M2 12s3.500-6.500 10-6.500S22 12 22 12s-3.500 6.500-10 6.500S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    shake: '<rect x="8" y="5" width="8" height="14" rx="2"/><path d="M4 8.500v7M20 8.500v7M1.500 10.500v3M22.500 10.500v3"/>',
    moon: '<path d="M20 14.500A8.500 8.500 0 0 1 9.500 4 8.500 8.500 0 1 0 20 14.500z"/>',
    snow: '<path d="M12 3v18M4.200 7.500l15.600 9M4.200 16.500l15.600-9"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    skull: '<path d="M12 3C7.600 3 5 6 5 9.500c0 2.200 1 3.700 2.500 4.600V18h9v-3.900c1.500-.9 2.500-2.400 2.500-4.600C19 6 16.400 3 12 3z"/><path d="M9.500 18v2.500M14.500 18v2.500"/><circle cx="9.300" cy="10" r="1.400" class="fl"/><circle cx="14.700" cy="10" r="1.400" class="fl"/>'
  };
  function ic(n, cls) {
    return '<svg class="ic' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (P[n] || '') + '</svg>';
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stamp(b, cls, extra) {
    var d = BR[b] || BR.root;
    return '<span class="stamp ' + (cls || '') + '" style="--b:' + d.color + ';' + (extra || '') + '">' + ic(d.icon) + '</span>';
  }
  function fmt(n) { return OG.fmt ? OG.fmt(n || 0) : String(Math.floor(n || 0)); }
  function fmtTime(s) { return OG.fmtTime ? OG.fmtTime(s || 0) : '00:00'; }
  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  /* ------------------------------------------------------------- settings */
  function S() {
    var st = OG.state = OG.state || {};
    var m = st.meta = st.meta || {};
    if (!m.settings) m.settings = JSON.parse(JSON.stringify(DEF_SETTINGS));
    var s = m.settings;
    for (var k in DEF_SETTINGS) if (s[k] === undefined) s[k] = JSON.parse(JSON.stringify(DEF_SETTINGS[k]));
    if (!s.hints) s.hints = { move: false, tree: false };
    return s;
  }
  function applySettings() {
    var s = S();
    root.classList.toggle('cb', !!s.colorblind);
    root.classList.toggle('relax', !!s.relax);
    try { if (OG.audio && OG.audio.setMuted) OG.audio.setMuted(!!s.mute); } catch (e) {}
    try { if (OG.audio && OG.audio.setVolume) OG.audio.setVolume(s.volume); } catch (e) {}
  }
  function commitSettings() {
    applySettings();
    bus.emit('settings:change', { settings: S() });
    try { if (OG.meta && typeof OG.meta.save === 'function') OG.meta.save(); } catch (e) {}
  }

  /* ---------------------------------------------------------------- state */
  var inited = false, ui = OG.ui = OG.ui || {};
  var uiRoot, E = {};                // E: element refs
  var layers = [];                   // overlay stack: {name, el, opener, under}
  var mainName = 'none';             // title | levelup | pause | winter | none (hud is separate)
  var hudOn = false;
  var lastRun = null, prevBest = null, offlinePending = null;
  var offer = null, offerQueue = [], choosing = false, rerolling = false, lockUntil = 0, lockTimer = 0;
  var confirmOpts = null;
  var toastQ = [], toastCur = null;
  var hint = null;                   // {kind, t, el}
  var cache = {};
  var acc = { mini: 0, big: 0 };
  var lastT = now();
  var uiMeta = { moveT: 0 };

  var MAIN = { title: 1, levelup: 1, pause: 1, winter: 1 };

  /* ================================================================ build */
  function build() {
    uiRoot = doc.getElementById('ui');
    if (!uiRoot) {
      var app = doc.getElementById('app') || doc.body;
      uiRoot = doc.createElement('div'); uiRoot.id = 'ui'; app.appendChild(uiRoot);
    }
    uiRoot.innerHTML = '';
    var html = [
      titleHTML(), hudHTML(), levelupHTML(), pauseHTML(), settingsHTML(), winterHTML(),
      rootsHTML(), codexHTML(), offlineHTML(), confirmHTML(), photoHTML(),
      '<div class="toasts" id="toasts" aria-live="polite"></div>'
    ].join('');
    uiRoot.innerHTML = html;
    var ids = ['scr-title', 'hud', 'scr-levelup', 'scr-pause', 'scr-settings', 'scr-winter', 'scr-roots', 'scr-codex', 'scr-offline', 'scr-confirm', 'scr-photo', 'toasts'];
    ids.forEach(function (id) { E[id] = doc.getElementById(id); });
    E.title = E['scr-title']; E.levelup = E['scr-levelup']; E.pause = E['scr-pause']; E.settings = E['scr-settings'];
    E.winter = E['scr-winter']; E.roots = E['scr-roots']; E.codex = E['scr-codex']; E.offline = E['scr-offline'];
    E.confirm = E['scr-confirm']; E.photo = E['scr-photo']; E.hudEl = E.hud;
  }

  function flowerSvg(color, scale) {
    var petals = '';
    for (var i = 0; i < 5; i++) {
      var a = i * 72 * Math.PI / 180;
      petals += '<circle cx="' + (17 + Math.sin(a) * 7.500).toFixed(1) + '" cy="' + (15 - Math.cos(a) * 7.500).toFixed(1) + '" r="6" fill="' + color + '" stroke="#1F2420" stroke-width="2.500"/>';
    }
    return '<svg viewBox="0 0 34 44" style="transform:scale(' + scale + ');transform-origin:50% 100%" aria-hidden="true"><path d="M17 44V22" stroke="#1F2420" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M17 36c-5 0-8-2-9-6 5 0 8 2 9 6z" fill="#A7C957" stroke="#1F2420" stroke-width="2"/>' + petals + '<circle cx="17" cy="15" r="4.500" fill="#F4B942" stroke="#1F2420" stroke-width="2.500"/></svg>';
  }

  function titleHTML() {
    var rs = [-4, 3, -2, 4, -3, 2, -4, 3], ys = [.02, -.03, .03, -.02, .03, -.03, .02, -.02];
    var letters = 'OVERGROW'.split('').map(function (ch, i) {
      return '<span class="l' + (ch === 'O' ? ' o' : '') + '" aria-hidden="true" style="--r:' + rs[i] + 'deg;--y:' + ys[i] + 'em">' + ch + '</span>';
    }).join('');
    var sprout = '<svg class="sprout" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 39V15" fill="none" stroke="#1F2420" stroke-width="9" stroke-linecap="round"/><path d="M20 39V15" fill="none" stroke="#A7C957" stroke-width="3.500" stroke-linecap="round"/><path d="M20 17C10 17 4 11 4 3c9 0 15.500 4.500 16 14z" fill="#A7C957" stroke="#1F2420" stroke-width="3" stroke-linejoin="round"/><path d="M20 22c9 0 16-6 16-14-9 0-15.500 5-16 14z" fill="#A7C957" stroke="#1F2420" stroke-width="3" stroke-linejoin="round"/></svg>';
    var pos = [[5, '#E07A5F', 1], [16, '#8FC1C9', .8], [29, '#F4B942', 1.1], [66, '#A7C957', .9], [79, '#E07A5F', 1.15], [92, '#8FC1C9', .85]];
    var blooms = pos.map(function (p) { return '<span class="bloom scene" style="left:' + p[0] + '%;bottom:' + (4 + (p[0] % 5)) + '%">' + flowerSvg(p[1], p[2]) + '</span>'; }).join('');
    return '<section class="screen scr-title ui-block" id="scr-title" hidden aria-label="Màn hình chính">' +
      '<div class="scene title-bg"><div class="hill"><svg viewBox="0 0 400 80" preserveAspectRatio="none" aria-hidden="true"><path d="M0 30Q60 4 130 22T270 18T400 24V80H0Z" fill="#5E7D4A" stroke="#1F2420" stroke-width="3" vector-effect="non-scaling-stroke"/></svg></div>' + blooms + '</div>' +
      '<canvas class="scene title-tree" id="t-tree" aria-hidden="true"></canvas>' +
      '<div class="title-wrap">' +
      '<header class="brand"><h1 class="wordmark" aria-label="OVERGROW">' + sprout + letters + '</h1>' +
      '<p class="tagline">Mọc vượt giới hạn</p><p class="records" id="t-rec" hidden></p></header>' +
      '<nav class="card menu" aria-label="Menu chính"><i class="tape"></i>' +
      '<button class="btn btn--primary btn--xl" data-act="new" data-af>' + ic('seed') + '<span>Mùa mới</span></button>' +
      '<button class="btn menu__daily" data-act="daily"><span>Hạt Giống Hôm Nay #<span class="num" id="t-dn">1</span></span><small id="t-dbest"></small></button>' +
      '<div class="tiles">' +
      '<button class="btn btn--tile" data-act="roots">' + ic('root') + '<span>Rễ</span><span class="badge num" id="t-roots">0</span></button>' +
      '<button class="btn btn--tile" data-act="codex">' + ic('book') + '<span>Sổ Cộng Hưởng</span></button>' +
      '<button class="btn btn--tile" data-act="settings">' + ic('gear') + '<span>Cài đặt</span></button>' +
      '</div></nav></div></section>';
  }

  function hudHTML() {
    return '<div class="hud" id="hud" hidden>' +
      '<div class="xp" role="progressbar" aria-label="Kinh nghiệm" aria-valuemin="0" aria-valuemax="100"><i id="h-xp"></i></div>' +
      '<div class="hud-grid">' +
      '<div class="hud-stat"><div class="lvl" id="h-lvl" title="Cấp"><small>CẤP</small><span id="h-lv" class="num">1</span></div>' +
      '<div class="hp" id="h-hp">' + ic('heart') + '<div class="bar" role="progressbar" aria-label="Máu"><i id="h-hpf"></i><span class="hp__n num" id="h-hpn">100/100</span></div></div></div>' +
      '<div class="chip chip--clock" aria-label="Thời gian"><span class="num" id="h-time">00:00</span><small>/' + fmtTime(C.goalTime) + '</small></div>' +
      '<div class="chip chip--light" aria-label="Ánh sáng">' + ic('sun') + '<b class="num" id="h-light">0</b></div>' +
      '<button class="btn btn--icon pause-btn ui-block" id="h-pause" data-act="pause" aria-label="Tạm dừng">' + ic('pause') + '</button>' +
      '<div class="mini" aria-hidden="true"><canvas id="h-mini" width="120" height="120"></canvas></div>' +
      '</div>' +
      '<button class="dash ui-block" id="h-dash" aria-label="Lướt"><svg class="ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="disc" cx="50" cy="50" r="46"/><circle class="trk" cx="50" cy="50" r="38"/><circle class="prg" id="h-ring" cx="50" cy="50" r="38" stroke-dasharray="238.76" stroke-dashoffset="0"/></svg><span class="lbl">' + ic('dash') + '<span>Lướt</span></span></button>' +
      '<div class="joy" id="h-joy" aria-hidden="true"><div class="joy__base"></div><div class="joy__knob" id="h-knob"></div></div>' +
      '<div id="h-hint-slot"></div>' +
      '</div>';
  }

  function levelupHTML() {
    return '<section class="screen scr-levelup ui-block" id="scr-levelup" hidden role="dialog" aria-modal="true" aria-labelledby="lv-title">' +
      '<div class="lv-wrap"><div class="lv-head"><h2 class="lv-title" id="lv-title">' + ic('leaf') + '<span>Lên cấp <span class="num" id="lv-n">2</span>!</span></h2>' +
      '<p class="lv-note" id="lv-note">' + ic('leaf') + '<span id="lv-note-t">Chọn một thẻ để cây mọc thêm</span></p></div>' +
      '<div class="lv-cards locked" id="lv-cards" role="group" aria-label="Chọn một nâng cấp"></div>' +
      '<div class="lv-foot"><button class="btn" id="lv-reroll" data-act="reroll">' + ic('refresh') + '<span>Đổi bài</span><span class="badge num" id="lv-rr" style="background:var(--ink);color:var(--paper);font:700 13px/1 var(--font);padding:4px 8px 2px;border-radius:8px 3px 9px 4px">0</span></button>' +
      '<p class="lv-keys">Phím 1–4 để chọn · R để đổi bài</p></div></div></section>';
  }

  function pauseHTML() {
    return '<section class="screen ui-block" id="scr-pause" hidden role="dialog" aria-modal="true" aria-labelledby="p-title">' +
      '<div class="card pause-card"><i class="tape tape--wind"></i>' +
      '<div class="card__head"><h2 class="h2" id="p-title">Tạm nghỉ<small>Khu vườn đợi cậu quay lại</small></h2></div>' +
      '<div class="card__body"><div class="pause-tree"><canvas id="p-tree" aria-hidden="true"></canvas></div>' +
      '<div class="pause-meta"><span class="chip num" id="p-time">00:00</span><span class="chip">Cấp&nbsp;<span class="num" id="p-lv">1</span></span><span class="chip">' + ic('skull') + '<span class="num" id="p-kills">0</span></span></div>' +
      '<div class="btns"><button class="btn btn--primary btn--xl" data-act="resume" data-af>' + ic('play') + '<span>Tiếp tục</span></button>' +
      '<button class="btn" data-act="settings">' + ic('gear') + '<span>Cài đặt</span></button>' +
      '<button class="btn" data-act="quit">' + ic('x') + '<span>Bỏ mùa này</span></button></div></div></div></section>';
  }

  function rowSwitch(id, icon, t, d) {
    return '<label class="row" for="' + id + '"><span class="row__ic">' + ic(icon) + '</span><span class="row__t"><b>' + t + '</b><small>' + d + '</small></span><input type="checkbox" role="switch" class="sw" id="' + id + '"></label>';
  }
  function settingsHTML() {
    return '<section class="screen ui-block" id="scr-settings" hidden role="dialog" aria-modal="true" aria-labelledby="s-title">' +
      '<div class="card set-card"><i class="tape"></i>' +
      '<div class="card__head"><button class="btn btn--icon" data-act="back" aria-label="Quay lại">' + ic('back') + '</button><h2 class="h2" id="s-title">Cài đặt</h2></div>' +
      '<div class="card__body"><div class="rows">' +
      rowSwitch('s-sound', 'sound', 'Âm thanh', 'Bật hoặc tắt nhạc và tiếng động') +
      '<div class="row row--range"><span class="row__ic">' + ic('sound') + '</span><span class="row__t"><b>Âm lượng</b></span><span class="row__v num" id="s-volv">80%</span>' +
      '<input type="range" class="rng" id="s-vol" min="0" max="100" step="5" aria-label="Âm lượng"></div>' +
      rowSwitch('s-shake', 'shake', 'Rung màn hình', 'Màn hình rung khi trúng đòn hoặc khi boss xuất hiện') +
      rowSwitch('s-cb', 'eye', 'Chế độ mù màu', 'Thêm hình và chữ để phân biệt bốn nhánh') +
      rowSwitch('s-relax', 'leaf', 'Vườn Thư Giãn', 'Kẻ địch chậm và yếu hơn, chơi không áp lực') +
      '</div><div class="danger-zone"><button class="btn btn--wide" data-act="wipe">' + ic('trash') + '<span>Xoá dữ liệu</span></button><p>Xoá toàn bộ Rễ, cây, sổ cộng hưởng và kỷ lục trên máy này.</p></div></div></div></section>';
  }

  function winterHTML() {
    var snow = '';
    for (var i = 0; i < 16; i++) snow += '<i class="snow' + (i % 3 ? ' snow--b' : '') + '" style="left:' + ((i * 37 + 11) % 100) + '%;animation-delay:' + (-(i * 1.9)).toFixed(1) + 's"></i>';
    return '<section class="screen scr-winter ui-block" id="scr-winter" hidden role="dialog" aria-modal="true" aria-labelledby="w-title">' +
      '<div class="scene">' + snow + '</div>' +
      '<div class="card winter" id="w-card"><span class="tag tag--amber record" id="w-rec" hidden>Kỷ lục mới!</span><div class="card__head"><h2 class="h2" id="w-title">Mùa Đông<small id="w-sub"></small></h2></div>' +
      '<div class="winter__tree"><canvas id="w-tree" aria-hidden="true"></canvas></div>' +
      '<div class="winter__info">' +
      '<p class="clear-note" id="w-clear" hidden>' + ic('leaf') + '<span>Màn 2: Khu Rừng — đang mọc...</span></p>' +
      '<dl class="stats">' +
      '<div class="stat"><dt>Thời gian</dt><dd class="num" id="w-time">00:00</dd></div>' +
      '<div class="stat"><dt>Cấp</dt><dd class="num" id="w-lv">1</dd></div>' +
      '<div class="stat"><dt>Hạ gục</dt><dd class="num" id="w-kills">0</dd></div>' +
      '<div class="stat"><dt>Ánh sáng</dt><dd class="num" id="w-light">0</dd></div>' +
      '<div class="stat stat--roots"><dt>' + ic('root') + 'Rễ</dt><dd class="num" id="w-roots">+0</dd></div></dl>' +
      '<div class="w-btns" id="w-btns">' +
      '<button class="btn btn--primary btn--xl" data-act="again" data-af>' + ic('seed') + '<span>Gieo mùa mới</span></button>' +
      '<button class="btn btn--tile" data-act="roots">' + ic('root') + '<span>Rễ</span></button>' +
      '<button class="btn btn--tile" data-act="photo">' + ic('download') + '<span>Lưu ảnh cây</span></button>' +
      '<button class="btn btn--tile" data-act="share" id="w-share">' + ic('share') + '<span id="w-share-t">Chia sẻ</span></button>' +
      '<button class="btn btn--tile" data-act="title">' + ic('back') + '<span>Màn chính</span></button>' +
      '</div></div></div></section>';
  }

  function rootsHTML() {
    return '<section class="screen ui-block" id="scr-roots" hidden role="dialog" aria-modal="true" aria-labelledby="r-title">' +
      '<div class="card big-card"><i class="tape tape--root"></i>' +
      '<div class="card__head"><button class="btn btn--icon" data-act="back" aria-label="Quay lại">' + ic('back') + '</button><h2 class="h2" id="r-title">Rễ<small>Rễ ở lại mỗi mùa Đông</small></h2>' +
      '<span class="rootbank" aria-label="Rễ hiện có">' + ic('root') + '<b class="num" id="r-bank">0</b></span></div>' +
      '<div class="card__body" id="r-body"><div class="grid" id="r-grid"></div></div></div></section>';
  }

  function codexHTML() {
    return '<section class="screen ui-block" id="scr-codex" hidden role="dialog" aria-modal="true" aria-labelledby="c-title">' +
      '<div class="card big-card"><i class="tape tape--wind"></i>' +
      '<div class="card__head"><button class="btn btn--icon" data-act="back" aria-label="Quay lại">' + ic('back') + '</button><h2 class="h2" id="c-title">Sổ Cộng Hưởng<small>Hai nhánh gặp nhau sẽ nở ra điều mới</small></h2>' +
      '<span class="cx-count num" id="c-count" aria-label="Đã khám phá">0/12</span></div>' +
      '<div class="card__body"><div class="grid" id="c-grid"></div></div></div></section>';
  }

  function offlineHTML() {
    var art = '<svg class="off-art" viewBox="0 0 132 96" aria-hidden="true"><rect x="0" y="70" width="132" height="26" rx="6" fill="#5E7D4A" stroke="#1F2420" stroke-width="3"/>' +
      '<path d="M96 14a16 16 0 1 0 14 24 13 13 0 0 1-14-24z" fill="#F4B942" stroke="#1F2420" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M44 72V44" stroke="#1F2420" stroke-width="8" stroke-linecap="round"/><path d="M44 72V44" stroke="#A7C957" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M44 48C32 48 26 41 26 32c10 0 17 5 18 16z" fill="#A7C957" stroke="#1F2420" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M44 56c10 0 18-6 18-15-10 0-17 5-18 15z" fill="#A7C957" stroke="#1F2420" stroke-width="3" stroke-linejoin="round"/>' +
      '<circle cx="76" cy="62" r="6" fill="#E07A5F" stroke="#1F2420" stroke-width="2.500"/><circle cx="76" cy="62" r="2.200" fill="#F4B942"/></svg>';
    return '<section class="screen ui-block" id="scr-offline" hidden role="dialog" aria-modal="true" aria-labelledby="o-title">' +
      '<div class="card off-card"><i class="tape"></i><div class="card__body">' + art +
      '<h2 class="h2" id="o-title">Lúc cậu vắng nhà...</h2>' +
      '<ul class="off-lines"><li><span>Khu vườn đã mọc suốt</span><b class="num" id="o-time">0 phút</b></li>' +
      '<li><span>Ánh sáng thu được</span><b class="num" id="o-light">+0</b></li>' +
      '<li><span>Rễ nhận được</span><b class="num" id="o-roots">+0</b></li></ul>' +
      '<button class="btn btn--primary btn--xl btn--wide" data-act="offline-ok" data-af>' + ic('check') + '<span>Tuyệt!</span></button></div></div></section>';
  }

  function confirmHTML() {
    return '<section class="screen ui-block" id="scr-confirm" hidden role="dialog" aria-modal="true" aria-labelledby="k-title" aria-describedby="k-text">' +
      '<div class="card confirm-card"><div class="card__head"><h2 class="h2" id="k-title" style="text-align:center">Chắc chưa?</h2></div>' +
      '<div class="card__body"><p id="k-text"></p><div class="btns"><button class="btn" data-act="confirm-no" id="k-no" data-af>Giữ lại</button><button class="btn btn--danger" data-act="confirm-yes" id="k-yes">Đồng ý</button></div></div></div></section>';
  }

  function photoHTML() {
    return '<section class="screen ui-block" id="scr-photo" hidden role="dialog" aria-modal="true" aria-labelledby="ph-title">' +
      '<div class="card photo-card"><div class="card__head"><h2 class="h2" id="ph-title" style="text-align:center">Ảnh cây của cậu</h2></div>' +
      '<div class="card__body"><img id="ph-img" alt="Ảnh cây kỹ năng của mùa vừa rồi"><p>Nhấn giữ vào ảnh để lưu về máy.</p>' +
      '<button class="btn btn--primary btn--wide" data-act="back" data-af>' + ic('check') + '<span>Xong</span></button></div></div></section>';
  }

  /* ============================================================ navigation */
  function topScreen() {
    if (layers.length) return layers[layers.length - 1].el;
    return mainName !== 'none' && E[mainName] ? E[mainName] : null;
  }
  function focusables(scr) {
    if (!scr) return [];
    var list = scr.querySelectorAll('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
    return Array.prototype.filter.call(list, function (n) { return n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden'; });
  }
  function focusIn(scr) {
    if (!scr) return;
    var t = scr.querySelector('[data-af]:not(:disabled)') || focusables(scr)[0];
    if (t) { try { t.focus({ preventScroll: true }); } catch (e) { t.focus(); } }
  }
  function mainEl() { return mainName !== 'none' ? E[mainName] : null; }

  function setMain(name) {
    ['title', 'levelup', 'pause', 'winter'].forEach(function (n) { if (E[n]) { E[n].hidden = (n !== name); E[n].classList.remove('under'); } });
    mainName = MAIN[name] ? name : 'none';
    var wantHud = (name === 'hud' || name === 'levelup' || name === 'pause');
    hudOn = wantHud; E.hud.hidden = !wantHud;
    if (name === 'hud') mainName = 'none';
    if (wantHud) { cache = {}; }
    root.classList.toggle('in-run', wantHud);
    if (mainName !== 'none') focusIn(E[mainName]);
    return mainName;
  }

  function closeAllLayers(silent) {
    while (layers.length) popLayer(true);
    if (!silent) { var m = mainEl(); if (m) focusIn(m); }
  }
  function pushLayer(name, opts) {
    var scr = E[name]; if (!scr) return;
    if (layers.length && layers[layers.length - 1].name === name) return;
    var under = layers.length ? layers[layers.length - 1].el : mainEl();
    var rec = { name: name, el: scr, opener: doc.activeElement, under: under };
    layers.push(rec);
    if (under) under.classList.add('under');
    if (name === 'settings') renderSettings();
    else if (name === 'roots') renderRoots();
    else if (name === 'codex') renderCodex();
    else if (name === 'offline') renderOffline(opts);
    else if (name === 'confirm') renderConfirm(opts);
    else if (name === 'photo') { E['scr-photo'].querySelector('img').src = (opts && opts.src) || ''; }
    scr.hidden = false;
    focusIn(scr);
  }
  function popLayer(silent) {
    var rec = layers.pop(); if (!rec) return;
    rec.el.hidden = true;
    if (rec.under) rec.under.classList.remove('under');
    if (silent) return;
    var op = rec.opener;
    if (op && doc.body.contains(op) && op.getClientRects().length && !op.disabled) { try { op.focus({ preventScroll: true }); } catch (e) {} }
    else focusIn(topScreen());
  }
  function closeTop() {
    var top = layers[layers.length - 1];
    if (!top) return;
    if (top.name === 'confirm') { var o = confirmOpts; confirmOpts = null; popLayer(); if (o && o.onNo) o.onNo(); return; }
    if (top.name === 'offline') { offlinePending = null; }
    popLayer();
  }

  ui.show = function (name, opts) {
    if (!inited) ui.init();
    if (name === 'hud') { closeAllLayers(true); return setMain('hud'); }
    if (MAIN[name]) { closeAllLayers(true); return setMain(name); }
    if (E[name]) return pushLayer(name, opts);
  };
  ui.close = closeTop;

  /* ============================================================== screens */
  function renderTitle() {
    var m = (OG.state && OG.state.meta) || {};
    var dn = OG.meta && OG.meta.dailyNumber ? OG.meta.dailyNumber() : 1;
    E.title.querySelector('#t-dn').textContent = dn;
    E.title.querySelector('#t-roots').textContent = fmt(m.roots || 0);
    var d = m.daily || {};
    var best = (d.played || d.bestTime > 0) ? 'Tốt nhất hôm nay: ' + fmtTime(d.bestTime || 0) + (d.bestLevel ? ' · cấp ' + d.bestLevel : '') : 'Chưa chơi hôm nay';
    E.title.querySelector('#t-dbest').textContent = best;
    var rec = E.title.querySelector('#t-rec'), b = m.best || {};
    if (b.time > 0) { rec.hidden = false; rec.textContent = 'Kỷ lục ' + fmtTime(b.time) + ' · cấp ' + (b.level || 1) + (m.seasons ? ' · ' + m.seasons + ' mùa' : ''); }
    else rec.hidden = true;
  }

  function renderSettings() {
    var s = S();
    E.settings.querySelector('#s-sound').checked = !s.mute;
    var v = Math.round((s.volume == null ? 0.8 : s.volume) * 100);
    var vol = E.settings.querySelector('#s-vol'); vol.value = v; vol.style.setProperty('--p', v + '%');
    E.settings.querySelector('#s-volv').textContent = v + '%';
    vol.disabled = !!s.mute;
    E.settings.querySelector('#s-shake').checked = !!s.shake;
    E.settings.querySelector('#s-cb').checked = !!s.colorblind;
    E.settings.querySelector('#s-relax').checked = !!s.relax;
  }

  function renderConfirm(o) {
    confirmOpts = o || {};
    E.confirm.querySelector('#k-title').textContent = confirmOpts.title || 'Chắc chưa?';
    E.confirm.querySelector('#k-text').textContent = confirmOpts.text || '';
    var no = E.confirm.querySelector('#k-no'), yes = E.confirm.querySelector('#k-yes');
    no.textContent = confirmOpts.no || 'Giữ lại';
    yes.textContent = confirmOpts.yes || 'Đồng ý';
    yes.className = 'btn ' + (confirmOpts.danger === false ? 'btn--primary' : 'btn--danger');
    no.hidden = confirmOpts.noButton === false;
  }

  function fmtAway(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    var out = [];
    if (d) out.push(d + ' ngày');
    if (h) out.push(h + ' giờ');
    if (m || !out.length) out.push((m || (sec < 60 ? 1 : 0)) + ' phút');
    return out.join(' ');
  }
  function renderOffline(o) {
    o = o || offlinePending || {};
    E.offline.querySelector('#o-time').textContent = fmtAway(o.seconds);
    E.offline.querySelector('#o-light').textContent = '+' + fmt(o.light || 0);
    E.offline.querySelector('#o-roots').textContent = '+' + fmt(o.rootsGained || 0);
  }

  function pips(rank, max, color, nextOn) {
    var h = '<span class="pips" style="--b:' + color + '" aria-hidden="true">';
    if (max > 12) return '';
    for (var i = 0; i < max; i++) h += '<i class="pip' + (i < rank ? ' on' : (nextOn && i === rank ? ' next' : '')) + '"></i>';
    return h + '</span>';
  }

  /* ---- roots ---- */
  function renderRoots() {
    var m = OG.state.meta || {}, ups = (OG.meta && OG.meta.upgrades) || [];
    var roots = m.roots || 0, body = E.roots.querySelector('#r-body'), st = body.scrollTop;
    E.roots.querySelector('#r-bank').textContent = fmt(roots);
    var grid = E.roots.querySelector('#r-grid');
    if (!ups.length) { grid.innerHTML = '<p class="empty">Chưa có nâng cấp nào.</p>'; return; }
    grid.innerHTML = ups.map(function (u) {
      var rank = (m.upgrades && m.upgrades[u.id]) | 0, max = u.maxRank || 1, maxed = rank >= max;
      var cost = maxed ? null : (OG.meta.cost ? OG.meta.cost(u.id) : null);
      var can = cost != null && roots >= cost && !maxed;
      var btn;
      if (maxed || cost == null) btn = '<button class="btn" disabled data-buy="' + esc(u.id) + '" aria-label="' + esc(u.name) + ': đã đầy">' + ic('check') + '<span>Đã đầy</span></button>';
      else btn = '<button class="btn' + (can ? ' btn--primary' : '') + '" data-buy="' + esc(u.id) + '"' + (can ? '' : ' disabled') + ' aria-label="Mua ' + esc(u.name) + ', giá ' + esc(fmt(cost)) + ' Rễ' + (can ? '' : ', chưa đủ Rễ') + '"><span>Mua</span><span class="num">' + esc(fmt(cost)) + '</span>' + ic('root') + '</button>';
      return '<article class="up' + (maxed ? ' maxed' : '') + '" data-id="' + esc(u.id) + '"><h3>' + esc(u.name) + '</h3><p>' + esc(u.desc) + '</p>' +
        '<div class="up__row">' + pips(rank, max, '#A7C957', false) + '<small class="num" style="font:700 12.5px/1 var(--font);color:var(--dim)">' + rank + '/' + max + '</small></div>' + btn + '</article>';
    }).join('');
    body.scrollTop = st;
  }
  function buy(id) {
    var ok = false;
    try { ok = OG.meta.buy(id); } catch (e) { ok = false; }
    var m = OG.state.meta || {};
    var had = doc.activeElement && doc.activeElement.getAttribute && doc.activeElement.getAttribute('data-buy');
    renderRoots();
    E.title.querySelector('#t-roots').textContent = fmt(m.roots || 0);
    if (ok) {
      var card = E.roots.querySelector('.up[data-id="' + id + '"]');
      if (card) { card.classList.add('bought'); setTimeout(function () { card.classList.remove('bought'); }, 520); }
    }
    if (had) {
      var b = E.roots.querySelector('[data-buy="' + had + '"]');
      if (!b || b.disabled) b = E.roots.querySelector('[data-buy]:not(:disabled)') || E.roots.querySelector('[data-act="back"]');
      if (b) b.focus({ preventScroll: true });
    }
  }

  /* ---- codex ---- */
  function renderCodex() {
    var list = (OG.tree && OG.tree.synergies) || [], found = (OG.state.meta && OG.state.meta.codex) || {}, n = 0, html = '';
    list.forEach(function (s) {
      var f = !!found[s.id]; if (f) n++;
      if (!f && s.secret) return;                       // secret synergies stay hidden until found
      var a = s.branches[0], b = s.branches[1], an = (BR[a] || {}).name, bn = (BR[b] || {}).name;
      var stamps = f ? stamp(a, 'stamp--sm', '--r:-8deg') + '<span class="cx__plus" aria-hidden="true">+</span>' + stamp(b, 'stamp--sm', '--r:7deg')
        : stamp(a, 'stamp--sm stamp--ghost', '--r:-8deg') + '<span class="cx__plus" aria-hidden="true">+</span>' + stamp(b, 'stamp--sm stamp--ghost', '--r:7deg');
      html += '<article class="cx ' + (f ? 'cx--found' : '') + '"><div class="cx__top">' + stamps + '</div><span class="cx__names">' + esc(an) + ' + ' + esc(bn) + '</span>' +
        (f ? '<h3>' + esc(s.name) + '</h3><p>' + esc(s.desc) + '</p>' : '<h3>???</h3><p>Chưa khám phá. Thử cho hai nhánh này cùng mọc.</p>') + '</article>';
    });
    E.codex.querySelector('#c-grid').innerHTML = html || '<p class="empty">Chưa có gì trong sổ.</p>';
    E.codex.querySelector('#c-count').textContent = n + '/' + (list.length || 12);
  }

  /* ============================================================== level up */
  function curRank(opt) {
    var sk = OG.state && OG.state.tree && OG.state.tree.skills;
    if (sk && sk[opt.id] != null) return sk[opt.id] | 0;
    return opt.isNew ? 0 : (opt.rank | 0);
  }
  function showOffer(o) {
    offer = o; var opts = o.options || [];
    var lv = OG.state && OG.state.run ? OG.state.run.level : '';
    E.levelup.querySelector('#lv-n').textContent = lv || '';
    var html = opts.map(function (opt, i) {
      var b = BR[opt.branch] || BR.root, rank = curRank(opt), max = opt.maxRank || 1;
      var rot = [-1.2, .9, -.7, 1.1][i % 4];
      return '<button class="skill" data-i="' + i + '" style="--b:' + b.color + ';--i:' + i + ';--rot:' + rot + 'deg" aria-label="' + (i + 1) + ': ' + esc(opt.name) + ', nhánh ' + esc(b.name) + (opt.isNew ? ', mới' : '') + '">' +
        '<span class="skill__key" aria-hidden="true">' + (i + 1) + '</span>' +
        (opt.isNew ? '<span class="tag skill__new">Mới</span>' : '') +
        '<span class="skill__band">' + stamp(opt.branch, '', '--r:-6deg') + '<span class="skill__bn">' + esc(b.name) + '</span></span>' +
        '<span class="skill__body"><span class="skill__name">' + esc(opt.name) + '</span><span class="skill__desc">' + esc(opt.desc) + '</span></span>' +
        '<span class="skill__pips">' + pips(rank, max, b.color, true) + '<em>Bậc ' + Math.min(rank + 1, max) + '/' + max + '</em></span>' +
        (opt.synergyHint ? '<span class="skill__syn">' + ic('spark') + '<span>' + esc(opt.synergyHint) + '</span></span>' : '') + '</button>';
    }).join('');
    var cards = E.levelup.querySelector('#lv-cards');
    cards.style.setProperty('--n', Math.max(1, Math.min(4, opts.length)));
    cards.innerHTML = html;
    updateReroll();
    // one-time teaching note, no tutorial screen
    var s = S(), note = E.levelup.querySelector('#lv-note'), nt = E.levelup.querySelector('#lv-note-t');
    if (!s.hints.tree) { nt.textContent = 'Cây mọc theo cách cậu chơi'; note.style.background = 'var(--amber)'; s.hints.tree = true; bus.emit('settings:change', { settings: s }); try { if (OG.meta && OG.meta.save) OG.meta.save(); } catch (e) {} }
    else { nt.textContent = 'Chọn một thẻ để cây mọc thêm'; note.style.background = ''; }
    lock(C.inputLock);
    setMain('levelup');
    var first = cards.querySelector('.skill');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) {} }
  }
  function lock(sec) {
    lockUntil = now() + sec * 1000;
    var cards = E.levelup.querySelector('#lv-cards'); cards.classList.add('locked');
    E.levelup.querySelector('#lv-reroll').disabled = true;
    clearTimeout(lockTimer);
    lockTimer = setTimeout(function () { cards.classList.remove('locked'); updateReroll(); }, sec * 1000 + 20);
  }
  function locked() { return now() < lockUntil; }
  function updateReroll() {
    var left = (OG.state && OG.state.run && OG.state.run.rerolls) | 0, b = E.levelup.querySelector('#lv-reroll');
    E.levelup.querySelector('#lv-rr').textContent = left;
    b.disabled = left <= 0 || locked();
    b.setAttribute('aria-label', 'Đổi bài, còn ' + left + ' lượt');
  }
  function pick(i) {
    if (!offer || locked() || choosing) return;
    var opt = offer.options && offer.options[i]; if (!opt) return;
    var o = offer; offer = null; choosing = true;
    try { OG.tree.choose(opt.id); } catch (e) { choosing = false; throw e; }
    choosing = false;
    var next = offerQueue.shift();
    if (next) showOffer(next);
    else {
      mainName = 'none'; E.levelup.hidden = true;
      if (OG.game && OG.game.state === 'levelup') OG.game.setState('run');
      else setMain('hud');
    }
  }
  function reroll() {
    if (!offer || locked()) return;
    if (((OG.state.run.rerolls) | 0) <= 0) return;
    rerolling = true;
    var ok;
    try { ok = OG.tree.reroll(); } finally { rerolling = false; }
    updateReroll();
    if (ok === false) return;
  }
  function onOffer(o) {
    if (rerolling && offer) { showOffer(o); lock(C.rerollLock); return; }
    if (offer || choosing) { offerQueue.push(o); return; }
    showOffer(o);
  }

  /* ================================================================ HUD */
  function setText(key, node, v) { if (cache[key] !== v) { cache[key] = v; node.textContent = v; } }
  var H = {};
  function hudRefs() {
    H.xp = doc.getElementById('h-xp'); H.hpf = doc.getElementById('h-hpf'); H.hpn = doc.getElementById('h-hpn'); H.hp = doc.getElementById('h-hp');
    H.lv = doc.getElementById('h-lv'); H.lvl = doc.getElementById('h-lvl'); H.time = doc.getElementById('h-time'); H.light = doc.getElementById('h-light');
    H.ring = doc.getElementById('h-ring'); H.dash = doc.getElementById('h-dash'); H.joy = doc.getElementById('h-joy'); H.knob = doc.getElementById('h-knob');
    H.mini = doc.getElementById('h-mini'); H.slot = doc.getElementById('h-hint-slot'); H.xpBar = E.hud.querySelector('.xp');
  }
  function hudFrame() {
    var st = OG.state, run = st.run || {}, p = st.player || {}, stats = st.stats || {};
    var xr = run.xpNext > 0 ? OG.clamp ? OG.clamp(run.xp / run.xpNext, 0, 1) : Math.max(0, Math.min(1, run.xp / run.xpNext)) : 0;
    xr = Math.round(xr * 1000) / 1000;
    if (cache.xp !== xr) { cache.xp = xr; H.xp.style.transform = 'scaleX(' + xr + ')'; H.xpBar.setAttribute('aria-valuenow', Math.round(xr * 100)); }
    var hr = p.maxHp > 0 ? Math.max(0, Math.min(1, p.hp / p.maxHp)) : 0; hr = Math.round(hr * 1000) / 1000;
    if (cache.hp !== hr) { cache.hp = hr; H.hpf.style.transform = 'scaleX(' + hr + ')'; H.hp.classList.toggle('low', hr > 0 && hr <= C.lowHp); }
    setText('hpn', H.hpn, Math.ceil(Math.max(0, p.hp || 0)) + '/' + Math.ceil(p.maxHp || 0));
    var lvNow = run.level || 1;
    if (cache.lv !== lvNow) { if (cache.lv != null && !reduceMotion) { H.lvl.classList.remove('pop'); void H.lvl.offsetWidth; H.lvl.classList.add('pop'); } cache.lv = lvNow; H.lv.textContent = lvNow; }
    setText('time', H.time, fmtTime(run.time || 0));
    setText('light', H.light, fmt(run.light || 0));
    // dash cooldown ring
    var max = stats.dashCd || 3, cd = p.dashCd || 0, fr = cd > 0 ? Math.max(0, Math.min(1, 1 - cd / max)) : 1;
    fr = Math.round(fr * 100) / 100;
    if (cache.dash !== fr) {
      var was = cache.dash; cache.dash = fr;
      H.ring.style.strokeDashoffset = (238.76 * (1 - fr)).toFixed(1);
      var ready = fr >= 1; H.dash.classList.toggle('ready', ready);
      if (ready && was != null && was < 1 && !reduceMotion) { H.dash.classList.remove('flash'); void H.dash.offsetWidth; H.dash.classList.add('flash'); }
      H.dash.setAttribute('aria-disabled', ready ? 'false' : 'true');
    }
    // floating joystick drawn from OG.input.stick
    var s = OG.input && OG.input.stick, on = !!(s && s.active && OG.game && OG.game.state === 'run');
    if (on) {
      var R = 52, dx, dy;
      if (Math.abs(s.x) <= 1.001 && Math.abs(s.y) <= 1.001) { dx = s.x * R; dy = s.y * R; }
      else { dx = s.x - s.ox; dy = s.y - s.oy; var l = Math.sqrt(dx * dx + dy * dy); if (l > R) { dx = dx / l * R; dy = dy / l * R; } }
      H.joy.style.transform = 'translate(' + Math.round(s.ox - 62) + 'px,' + Math.round(s.oy - 62) + 'px)';
      H.knob.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    }
    if (cache.joy !== on) { cache.joy = on; H.joy.classList.toggle('on', on); }
  }

  /* ---- hints: one transient note each, ever ---- */
  function showHint(kind) {
    var s = S(); if (s.hints[kind] || hint) return;
    var touch = root.classList.contains('is-touch');
    var txt = touch ? 'Kéo để di chuyển — tự động bắn' : 'WASD hoặc giữ chuột để di chuyển — tự động bắn';
    var d = doc.createElement('div'); d.className = 'hint'; d.setAttribute('role', 'status');
    d.innerHTML = ic('wind') + '<span>' + txt + '</span>';
    H.slot.appendChild(d);
    hint = { kind: kind, t: 0, move: 0, el: d };
    s.hints[kind] = true; bus.emit('settings:change', { settings: s }); try { if (OG.meta && OG.meta.save) OG.meta.save(); } catch (e) {}
  }
  function endHint() {
    if (!hint) return; var d = hint.el; hint = null;
    d.classList.add('out'); setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 380);
  }
  function hintFrame(dt) {
    if (!hint) return;
    var mv = OG.input && OG.input.move, moving = (mv && (Math.abs(mv.x) + Math.abs(mv.y)) > .2) || (OG.input && OG.input.stick && OG.input.stick.active);
    hint.t += dt; hint.move = moving ? hint.move + dt : 0;
    if (hint.t > C.hintMoveTime || hint.move > C.hintMoveDismiss) endHint();
  }

  /* ---- toasts (synergy / boss), clock frozen while not running ---- */
  function toast(o) { toastQ.push(o); }
  function toastFrame(dt) {
    if (!toastCur && toastQ.length) {
      var o = toastQ.shift(), d = doc.createElement('div');
      d.className = 'toast' + (o.boss ? ' toast--boss' : '');
      d.setAttribute('role', 'status');
      d.innerHTML = (o.stamps ? '<div class="toast__stamps">' + o.stamps + '</div>' : '<div class="toast__stamps">' + ic('skull', '') + '</div>') +
        '<p class="toast__t">' + esc(o.title) + '</p>' + (o.desc ? '<p class="toast__d">' + esc(o.desc) + '</p>' : '<p class="toast__d"></p>') +
        (o.tag ? '<span class="tag tag--amber">' + esc(o.tag) + '</span>' : '');
      E.toasts = E.toasts || doc.getElementById('toasts');
      E.toasts.appendChild(d);
      toastCur = { el: d, t: 0, dur: o.dur || C.toastTime };
    }
    if (!toastCur) return;
    toastCur.t += dt;
    if (toastCur.t >= toastCur.dur) {
      var el = toastCur.el; toastCur = null; el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 320);
    }
  }

  /* ============================================================== canvases */
  function fitCanvas(cv) {
    var dpr = Math.min(2, (OG.view && OG.view.dpr) || window.devicePixelRatio || 1);
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;
    var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; }
    var c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    return { c: c, w: w, h: h };
  }
  function drawTree(cv, detail, inset) {
    var f = fitCanvas(cv); if (!f) return;
    try { if (OG.treeview && OG.treeview.draw) OG.treeview.draw(f.c, 0, 0, f.w, f.h * (inset || 1), { detail: detail }); } catch (e) { if (window.console) console.warn('[ui] treeview.draw', e); }
  }

  /* ================================================================ frame */
  function frame(ctx, alpha, realDt) {
    var t = now(), dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
    if (!inited) return;
    var state = OG.game && OG.game.state;
    if (hudOn && !E.hud.hidden) {
      hudFrame();
      acc.mini += dt;
      if (acc.mini >= 1 / C.miniFps) { acc.mini = 0; drawTree(H.mini, 'mini'); }
    }
    if (state === 'run') { toastFrame(dt); hintFrame(dt); }
    acc.big += dt;
    if (acc.big >= 1 / C.bigTreeFps) {
      acc.big = 0;
      if (!E.title.hidden && !E.title.classList.contains('under')) drawTree(E.title.querySelector('#t-tree'), 'full', .9);
      else if (!E.title.hidden) drawTree(E.title.querySelector('#t-tree'), 'full', .9);
      if (!E.winter.hidden && !E.winter.classList.contains('under')) drawTree(E.winter.querySelector('#w-tree'), 'full');
      if (!E.pause.hidden && !E.pause.classList.contains('under')) drawTree(E.pause.querySelector('#p-tree'), 'full');
    }
  }

  /* =============================================================== winter */
  function countUp(node, to, fmtFn, delay, dur) {
    if (reduceMotion || to <= 0) { node.textContent = fmtFn(to); return; }
    var t0 = now() + delay;
    node.textContent = fmtFn(0);
    (function step() {
      var k = (now() - t0) / (dur * 1000);
      if (k < 0) { requestAnimationFrame(step); return; }
      if (k >= 1) { node.textContent = fmtFn(to); return; }
      node.textContent = fmtFn(to * (1 - Math.pow(1 - k, 3)));
      requestAnimationFrame(step);
    })();
  }
  function showWinter() {
    var run = (OG.state && OG.state.run) || {}, r = lastRun || {};
    var res = r.result || run.result || 'death';
    var time = r.time != null ? r.time : run.time, level = r.level != null ? r.level : run.level;
    var kills = r.kills != null ? r.kills : run.kills, light = r.light != null ? r.light : run.light, gained = r.rootsGained || 0;
    var clear = res === 'clear';
    var w = E.winter;
    w.classList.toggle('is-clear', clear);
    w.querySelector('#w-title').firstChild.nodeValue = clear ? 'Khu Vườn đã nở hoa' : 'Mùa Đông';
    var m = OG.state.meta || {};
    var sub = clear ? 'Mùa Đông đã về, hẹn gặp ở màn sau' : 'Cây trút lá, rễ ở lại' + (m.seasons ? ' · mùa thứ ' + m.seasons : '');
    if (r.daily) sub += ' · Hạt Giống Hôm Nay #' + (OG.meta && OG.meta.dailyNumber ? OG.meta.dailyNumber() : 1);
    w.querySelector('#w-sub').textContent = sub;
    w.querySelector('#w-clear').hidden = !clear;
    var isRec = false;
    if (prevBest) isRec = (time > (prevBest.time || 0)) || (level > (prevBest.level || 0));
    w.querySelector('#w-rec').hidden = !isRec;
    setMain('winter');
    countUp(w.querySelector('#w-time'), time || 0, fmtTime, 250, C.countUp);
    countUp(w.querySelector('#w-lv'), level || 1, function (v) { return Math.round(Math.max(1, v)); }, 350, C.countUp);
    countUp(w.querySelector('#w-kills'), kills || 0, function (v) { return fmt(Math.round(v)); }, 450, C.countUp);
    countUp(w.querySelector('#w-light'), light || 0, function (v) { return fmt(Math.round(v)); }, 550, C.countUp);
    countUp(w.querySelector('#w-roots'), gained, function (v) { return '+' + fmt(Math.round(v)); }, 750, C.countUp);
    var share = w.querySelector('#w-share'), daily = !!r.daily;
    share.hidden = !daily;
    w.querySelector('#w-btns').classList.toggle('n2', !daily);
    w.querySelector('#w-share-t').textContent = 'Chia sẻ';
    try { if (OG.treeview && OG.treeview.shed) OG.treeview.shed(); } catch (e) {}
  }

  function copyText(text, done, fail) {
    function fallback() {
      var ta = doc.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-999px;top:0;opacity:0'; doc.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, text.length);
      var ok = false; try { ok = doc.execCommand('copy'); } catch (e) {}
      doc.body.removeChild(ta); ok ? done() : fail();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  function doShare() {
    var text = ''; try { text = OG.meta.shareText(); } catch (e) {}
    if (!text) return;
    var lab = E.winter.querySelector('#w-share-t');
    function copied() { lab.textContent = 'Đã chép!'; setTimeout(function () { lab.textContent = 'Chia sẻ'; }, 2000); }
    function manual() { pushLayer('confirm', { title: 'Chép đoạn này', text: text, yes: 'Xong', noButton: false, danger: false }); }
    if (navigator.share) {
      navigator.share({ text: text }).catch(function (err) { if (err && err.name === 'AbortError') return; copyText(text, copied, manual); });
    } else copyText(text, copied, manual);
  }
  function savePhoto() {
    var url = ''; try { url = OG.treeview.exportPNG(); } catch (e) {}
    if (!url) return;
    var B = window.Boot && window.Boot.env;
    if (B && (B.inApp || B.ios)) { pushLayer('photo', { src: url }); return; }
    var a = doc.createElement('a'); a.href = url; a.download = 'overgrow-cay.png'; a.rel = 'noopener';
    doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
  }

  function wipeData() {
    function nuke() { try { localStorage.removeItem('overgrow.v1'); } catch (e) {} }
    nuke();
    window.addEventListener('pagehide', nuke);
    window.addEventListener('beforeunload', nuke);
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 60);
  }

  /* ============================================================== actions */
  function startRun(daily) {
    closeAllLayers(true);
    if (OG.meta && OG.meta.startRun) OG.meta.startRun({ daily: !!daily });
  }
  var ACT = {
    'new': function () { startRun(false); },
    again: function () { startRun(false); },
    title: function () { closeAllLayers(true); if (OG.game) OG.game.setState('title'); },
    daily: function () { startRun(true); },
    roots: function () { pushLayer('roots'); },
    codex: function () { pushLayer('codex'); },
    settings: function () { pushLayer('settings'); },
    back: function () { closeTop(); },
    pause: function () { if (OG.game && OG.game.state === 'run') OG.game.setState('paused'); },
    resume: function () { closeAllLayers(true); if (OG.game) OG.game.setState('run'); },
    quit: function () {
      pushLayer('confirm', { title: 'Bỏ mùa này?', text: 'Mùa này sẽ kết thúc ngay, cậu vẫn nhận Rễ cho những gì đã làm được.', yes: 'Bỏ mùa', no: 'Chơi tiếp', onYes: function () { closeAllLayers(true); if (OG.meta && OG.meta.endRun) OG.meta.endRun('death'); } });
    },
    wipe: function () {
      pushLayer('confirm', { title: 'Xoá dữ liệu?', text: 'Rễ, cây, sổ cộng hưởng và kỷ lục sẽ mất vĩnh viễn. Không lấy lại được.', yes: 'Xoá hết', no: 'Giữ lại', onYes: wipeData });
    },
    'confirm-yes': function () { var o = confirmOpts; confirmOpts = null; popLayer(); if (o && o.onYes) o.onYes(); },
    'confirm-no': function () { closeTop(); },
    'offline-ok': function () { offlinePending = null; popLayer(); },
    reroll: function () { reroll(); },
    share: doShare,
    photo: savePhoto
  };

  function onClick(e) {
    var t = e.target.closest && e.target.closest('button, input');
    if (!t || !uiRoot.contains(t)) return;
    if (t.tagName === 'BUTTON') bus.emit('ui:click', { id: t.getAttribute('data-act') || t.getAttribute('data-buy') || t.id || 'btn' });
    var buyId = t.getAttribute && t.getAttribute('data-buy');
    if (buyId) { buy(buyId); return; }
    var sk = t.closest('.skill');
    if (sk) { pick(+sk.getAttribute('data-i')); return; }
    var act = t.getAttribute('data-act');
    if (act && ACT[act]) ACT[act](t);
  }
  var lastHover = null;
  function onOver(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    var t = e.target.closest && e.target.closest('button');
    if (t && t !== lastHover && !t.disabled) { lastHover = t; bus.emit('ui:hover', { id: t.getAttribute('data-act') || t.id || 'btn' }); }
    else if (!t) lastHover = null;
  }
  function onSetting(e) {
    var t = e.target, s = S();
    if (t.id === 's-sound') { s.mute = !t.checked; E.settings.querySelector('#s-vol').disabled = s.mute; }
    else if (t.id === 's-vol') { s.volume = (+t.value) / 100; t.style.setProperty('--p', t.value + '%'); E.settings.querySelector('#s-volv').textContent = t.value + '%'; }
    else if (t.id === 's-shake') s.shake = t.checked;
    else if (t.id === 's-cb') s.colorblind = t.checked;
    else if (t.id === 's-relax') s.relax = t.checked;
    else return;
    commitSettings();
  }

  function onKey(e) {
    if (!inited || e.altKey || e.ctrlKey || e.metaKey) return;
    var top = topScreen(); if (!top) return;
    var k = e.key, act = doc.activeElement;
    if (top === E.levelup && !layers.length) {
      if (k >= '1' && k <= '4') { e.preventDefault(); pick(+k - 1); return; }
      if (k === 'r' || k === 'R') { e.preventDefault(); reroll(); return; }
    }
    if (k === 'Escape') { if (layers.length) { e.preventDefault(); e.stopPropagation(); closeTop(); } return; }
    var items = focusables(top);
    if (!items.length) return;
    var idx = items.indexOf(act);
    if (k === 'Tab') {
      if (idx === -1) { e.preventDefault(); items[0].focus(); }
      else if (e.shiftKey && idx === 0) { e.preventDefault(); items[items.length - 1].focus(); }
      else if (!e.shiftKey && idx === items.length - 1) { e.preventDefault(); items[0].focus(); }
      return;
    }
    var fwd = k === 'ArrowDown' || k === 'ArrowRight', back = k === 'ArrowUp' || k === 'ArrowLeft';
    if (!fwd && !back) return;
    if (act && act.type === 'range' && (k === 'ArrowLeft' || k === 'ArrowRight')) return;
    e.preventDefault();
    var n = idx === -1 ? 0 : (idx + (fwd ? 1 : -1) + items.length) % items.length;
    items[n].focus();
    if (top !== E.levelup && items[n].scrollIntoView) { try { items[n].scrollIntoView({ block: 'nearest' }); } catch (er) {} }
  }

  var unlocked = false;
  function unlockAudio() {
    if (unlocked) return; unlocked = true;
    try { if (OG.audio && OG.audio.unlock) OG.audio.unlock(); } catch (e) {}
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (n) { window.removeEventListener(n, unlockAudio, true); });
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (n) { window.addEventListener(n, unlockAudio, true); });

  /* ================================================================ events */
  function dashDown(e) {
    e.preventDefault(); e.stopPropagation();
    if (OG.input && OG.input.pressDash) OG.input.pressDash();
    bus.emit('ui:click', { id: 'dash' });
  }

  function onState(e) {
    var to = e.to;
    if (!inited) return;
    if (to === 'run') {
      closeAllLayers(true);
      if (offer) { offer = null; offerQueue = []; }
      setMain('hud');
    } else if (to === 'levelup') {
      if (offer) setMain('levelup');
    } else if (to === 'paused') {
      closeAllLayers(true); setMain('pause');
      E.pause.querySelector('#p-time').textContent = fmtTime(OG.state.run.time);
      E.pause.querySelector('#p-lv').textContent = OG.state.run.level;
      E.pause.querySelector('#p-kills').textContent = fmt(OG.state.run.kills);
    } else if (to === 'winter') {
      closeAllLayers(true); setMain('none'); endHint();
    } else if (to === 'title') {
      closeAllLayers(true); setMain('title'); renderTitle();
    }
  }

  ui.init = function () {
    if (inited) return; inited = true;
    build(); hudRefs();
    applySettings();
    uiRoot.addEventListener('click', onClick);
    uiRoot.addEventListener('pointerover', onOver);
    uiRoot.addEventListener('input', onSetting);
    uiRoot.addEventListener('change', onSetting);
    doc.addEventListener('keydown', onKey, true);
    H.dash.addEventListener('pointerdown', dashDown);
    H.dash.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (OG.input && OG.input.pressDash) OG.input.pressDash(); } });
    E.toasts = doc.getElementById('toasts');
    renderTitle();
    setMain('title');
    var st = OG.game && OG.game.state;
    if (st && st !== 'title') onState({ to: st });
    if (offlinePending) pushLayer('offline', offlinePending);
    warmFonts();
  };
  /* load every weight/subset we use now, so later screens never flash a fallback face */
  function warmFonts() {
    if (!doc.fonts || !doc.fonts.load) return;
    var sample = 'Tiếng Việt ệặỗữờĩ Aa 0123';
    ['400 16px "Be Vietnam Pro"', '500 16px "Be Vietnam Pro"', '700 16px "Be Vietnam Pro"', '600 16px "Baloo 2"', '800 16px "Baloo 2"'].forEach(function (f) { try { doc.fonts.load(f, sample); } catch (e) {} });
  }
  var guardedInit = ui.init;
  if (window.Boot && window.Boot.guard) ui.init = window.Boot.guard(guardedInit, 'ui.init');

  /* subscribe at load: meta.init may fire offline:gain before ui.init runs */
  bus.on('boot', function () { ui.init(); });
  bus.on('offline:gain', function (d) {
    offlinePending = d;
    if (inited && mainName === 'title') pushLayer('offline', d);
  });
  bus.on('state:change', onState);
  bus.on('levelup:offer', onOffer);
  bus.on('run:start', function (d) {
    var m = (OG.state && OG.state.meta) || {};
    prevBest = m.best ? { time: m.best.time || 0, level: m.best.level || 0 } : { time: 0, level: 0 };
    lastRun = { daily: !!(d && d.daily) };
    if (inited) { toastQ = []; if (toastCur) { toastCur.el.remove(); toastCur = null; } endHint(); showHint('move'); }
  });
  bus.on('run:end', function (d) { lastRun = lastRun || {}; for (var k in d) lastRun[k] = d[k]; });
  bus.on('winter:show', function () { if (inited) showWinter(); });
  bus.on('roots:change', function () {
    if (!inited) return;
    var m = OG.state.meta || {};
    E.title.querySelector('#t-roots').textContent = fmt(m.roots || 0);
    if (!E.roots.hidden) renderRoots();
  });
  bus.on('settings:change', function () { if (inited) { applySettings(); if (!E.settings.hidden) renderSettings(); } });
  bus.on('level:up', function () { cache.lv = cache.lv; });
  bus.on('synergy:found', function (d) {
    var b = d.branches || [];
    toast({ title: 'Cộng hưởng: ' + d.name + '!', desc: d.desc, tag: d.first ? 'Khám phá đầu tiên' : '', stamps: stamp(b[0], 'stamp--sm', '--r:-8deg') + stamp(b[1], 'stamp--sm', '--r:7deg') });
  });
  bus.on('boss:spawn', function (d) {
    toast({ boss: true, title: d && d.kind === 'mother' ? 'Mẹ Sương Độc xuất hiện!' : 'Lõi Sương Độc xuất hiện!', dur: C.bossToastTime });
  });
  bus.on('state:change', function (e) { if (e.to === 'title' && inited) renderTitle(); });

  if (OG.game && OG.game.addRender) OG.game.addRender(frame, 50);

})(window.OG = window.OG || {});
