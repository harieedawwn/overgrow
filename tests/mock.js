/* Mock OG layer for testing ui.js without the other modules. Not shipped to the game. */
(function (OG) {
  'use strict';
  var Q = new URLSearchParams(location.search);
  /* ---- core ---- */
  var handlers = {};
  OG.bus = { on: function (n, f) { (handlers[n] = handlers[n] || []).push(f); }, off: function (n, f) { var a = handlers[n] || []; var i = a.indexOf(f); if (i > -1) a.splice(i, 1); },
    emit: function (n, d) { (handlers[n] || []).slice().forEach(function (f) { f(d); }); } };
  var upd = [], rnd = [];
  OG.game = { state: 'title', setState: function (s) { var from = this.state; this.state = s; OG.bus.emit('state:change', { from: from, to: s }); },
    addUpdate: function (f, o) { upd.push(f); }, addRender: function (f, o) { rnd.push([o || 0, f]); rnd.sort(function (a, b) { return a[0] - b[0]; }); } };
  OG.fmt = function (n) { var u = [[1e21, 'Thiên Hà'], [1e18, 'Đại Ngàn'], [1e15, 'Rừng'], [1e12, 'NTỷ'], [1e9, 'Tỷ'], [1e6, 'Tr'], [1e3, 'N']]; n = n || 0;
    for (var i = 0; i < u.length; i++) if (n >= u[i][0]) return (n / u[i][0]).toFixed(1).replace('.', ',') + ' ' + u[i][1]; return String(Math.floor(n)); };
  OG.fmtTime = function (s) { s = Math.max(0, Math.floor(s)); var m = Math.floor(s / 60), x = s % 60; return (m < 10 ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x; };
  OG.clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  OG.view = { w: innerWidth, h: innerHeight, dpr: Math.min(2, devicePixelRatio || 1) };
  OG.input = { move: { x: 0, y: 0 }, dash: false, pressDash: function () { window.__dash = (window.__dash || 0) + 1; }, stick: { active: false, ox: 0, oy: 0, x: 0, y: 0 } };
  OG.save = { load: function () { try { return JSON.parse(localStorage.getItem('overgrow.v1')); } catch (e) { return null; } }, write: function (o) { try { localStorage.setItem('overgrow.v1', JSON.stringify(o)); } catch (e) {} } };

  var saved = OG.save.load();
  OG.state = {
    run: { time: 0, seed: 1, daily: false, level: 1, xp: 0, xpNext: 10, light: 0, kills: 0, rerolls: 2, over: false, result: null },
    player: { x: 0, y: 0, vx: 0, vy: 0, r: 14, hp: 100, maxHp: 100, invuln: 0, dashCd: 0, dashing: false, still: 0, rooted: false },
    enemies: [], projectiles: [], hazards: [], orbits: [], trails: [], pickups: [],
    stats: { dashCd: 3 },
    tree: { growth: { fire: 5, wind: 3, root: 8, stone: 2 }, skills: { fire1: 2 }, synergies: {}, order: [] },
    meta: saved || { roots: 1240, rootsTotal: 4000, lifetimeLight: 0, bestLpm: 0, upgrades: { hp: 2, magnet: 1 }, codex: { s1: true, s3: true }, best: { time: 412, level: 9 }, seasons: 4, clears: 0, lastSeen: 0,
      daily: { date: '2026-11-15', bestTime: 357, bestLevel: 8, played: true }, settings: { mute: false, volume: 0.8, shake: true, colorblind: false, relax: false, hints: { move: false, tree: false } } }
  };
  if (Q.get('fresh')) OG.state.meta.settings.hints = { move: false, tree: false };
  if (Q.get('seen')) OG.state.meta.settings.hints = { move: true, tree: true };

  /* ---- tree ---- */
  var SK = [
    ['fire1', 'fire', 'Hạt Lửa', 'Đạn gây thêm sát thương và đốt cháy kẻ địch', 5],
    ['wind1', 'wind', 'Gió Cuốn', 'Chạy nhanh hơn, lướt xa hơn một đoạn dài', 4],
    ['root1', 'root', 'Rễ Bám', 'Kẻ địch đến gần bị chậm lại khi đứng yên', 5],
    ['stone1', 'stone', 'Vỏ Đá', 'Giảm sát thương nhận vào mỗi lần trúng đòn', 3],
    ['fire2', 'fire', 'Bão Tro', 'Vòng tro xoay quanh người', 3],
    ['wind2', 'wind', 'Lá Bay', 'Bắn nhiều đạn hơn mỗi lượt', 4]
  ];
  function opts(seed) {
    var o = [];
    for (var i = 0; i < 4; i++) { var s = SK[(i + seed) % SK.length]; o.push({ id: s[0], name: s[2], desc: s[3], branch: s[1], rank: (OG.state.tree.skills[s[0]] | 0), maxRank: s[4], isNew: !OG.state.tree.skills[s[0]], synergyHint: i === 1 ? 'Thêm 1 bậc Rễ để mở Cộng hưởng: Rừng Cháy' : '' }); }
    return o;
  }
  var SYN = [['Rừng Cháy', 'fire', 'root'], ['Bão Lửa', 'fire', 'wind'], ['Núi Lửa', 'fire', 'stone'], ['Mưa Rễ', 'wind', 'root'], ['Cát Bay', 'wind', 'stone'], ['Rừng Đá', 'root', 'stone']];
  var syn = [];
  for (var i = 0; i < 12; i++) { var b = SYN[i % 6]; syn.push({ id: 's' + (i + 1), name: b[0] + (i > 5 ? ' II' : ''), desc: 'Hai nhánh gặp nhau tạo ra sức mạnh lớn hơn nhiều lần.', branches: [b[1], b[2]], secret: i >= 9 }); }
  var rr = 0;
  OG.tree = { skills: SK.map(function (s) { return { id: s[0], branch: s[1], name: s[2], desc: s[3], maxRank: s[4] }; }), synergies: syn,
    choose: function (id) { window.__chosen = (window.__chosen || []); window.__chosen.push(id); OG.state.tree.skills[id] = (OG.state.tree.skills[id] | 0) + 1; },
    reroll: function () { if (OG.state.run.rerolls <= 0) return false; OG.state.run.rerolls--; rr++; OG.bus.emit('levelup:offer', { options: opts(rr + 2) }); return true; } };

  /* ---- meta ---- */
  var UP = ['Hạt khoẻ', 'Rễ sâu', 'Nam châm lá', 'Bước nhẹ', 'Ánh sáng đầu mùa', 'Máu xanh', 'Tay may', 'Đổi bài thêm', 'Nhiều lựa chọn'];
  OG.meta = { upgrades: UP.map(function (n, i) { return { id: 'u' + i, name: n, desc: 'Tăng sức mạnh khởi đầu cho mọi mùa sau, cộng dồn theo bậc.', maxRank: i === 3 ? 1 : 5 }; }),
    cost: function (id) { var u = OG.meta.upgrades.filter(function (x) { return x.id === id; })[0]; var r = OG.state.meta.upgrades[id] | 0; return r >= u.maxRank ? null : Math.round(40 * Math.pow(1.7, r)); },
    buy: function (id) { var c = OG.meta.cost(id); if (c == null || OG.state.meta.roots < c) return false; OG.state.meta.roots -= c; OG.state.meta.upgrades[id] = (OG.state.meta.upgrades[id] | 0) + 1; OG.bus.emit('roots:change', { roots: OG.state.meta.roots }); OG.meta.save(); return true; },
    save: function () { OG.save.write(OG.state.meta); },
    dailyNumber: function () { return 318; }, shareText: function () { return 'Overgrow #318\nMùa 07:42 · cấp 9\nhttps://example.com'; },
    startRun: function (o) { OG.state.run.daily = !!(o && o.daily); OG.state.run.time = 0; OG.state.run.level = 1; OG.state.run.rerolls = 2; OG.game.setState('run'); OG.bus.emit('run:start', { seed: 1, daily: !!(o && o.daily) }); },
    endRun: function (res) { OG.state.run.result = res; OG.bus.emit('run:end', { result: res, time: OG.state.run.time || 462, level: OG.state.run.level || 9, kills: 1234, light: 98765, rootsGained: 57 }); OG.game.setState('winter'); setTimeout(function () { OG.bus.emit('winter:show'); }, 120); } };
  OG.bus.on('settings:change', function () { OG.meta.save(); });

  /* ---- treeview / audio stubs ---- */
  var COL = { fire: '#E07A5F', wind: '#8FC1C9', root: '#A7C957', stone: '#B8A99A' };
  OG.treeview = {
    draw: function (ctx, x, y, w, h, o) {
      var t = Date.now() / 1000, cx = x + w / 2, by = y + h - 4, ink = '#1F2420';
      function br(x0, y0, len, ang, d, col) { if (d === 0) { ctx.fillStyle = '#A7C957'; ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x0, y0, Math.max(3, h * .02), 0, 7); ctx.fill(); ctx.stroke(); return; }
        var x1 = x0 + Math.sin(ang) * len, y1 = y0 - Math.cos(ang) * len; ctx.strokeStyle = ink; ctx.lineWidth = d * (o.detail === 'mini' ? 1.6 : 2.6) + 2; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = col || '#7a5c3c'; ctx.lineWidth = d * (o.detail === 'mini' ? 1.6 : 2.6); ctx.stroke();
        br(x1, y1, len * .74, ang - .5 + Math.sin(t) * .03, d - 1, ['#E07A5F', '#8FC1C9', '#A7C957', '#B8A99A'][d % 4]); br(x1, y1, len * .74, ang + .5, d - 1, ['#8FC1C9', '#A7C957', '#B8A99A', '#E07A5F'][d % 4]); }
      br(cx, by, h * .26, 0, 5, '#7a5c3c');
    }, shed: function () { window.__shed = (window.__shed || 0) + 1; },
    exportPNG: function () { var c = document.createElement('canvas'); c.width = 270; c.height = 338; var g = c.getContext('2d'); g.fillStyle = '#F2E8D0'; g.fillRect(0, 0, 270, 338); OG.treeview.draw(g, 0, 0, 270, 338, { detail: 'full' }); return c.toDataURL('image/png'); } };
  OG.audio = { unlock: function () { window.__unlock = (window.__unlock || 0) + 1; }, setMuted: function (b) { window.__muted = b; }, setVolume: function (v) { window.__vol = v; } };

  /* ---- boot: loop + fake world drawn on #game ---- */
  var booted = false;
  OG.boot = function () {
    if (booted) return; booted = true;
    var cv = document.getElementById('game'), ctx = cv.getContext('2d');
    function size() { var d = OG.view.dpr; cv.width = innerWidth * d; cv.height = innerHeight * d; OG.view.w = innerWidth; OG.view.h = innerHeight; }
    size(); addEventListener('resize', size);
    var last = performance.now();
    function loop(t) {
      var dt = Math.min(.1, (t - last) / 1000); last = t; var d = OG.view.dpr;
      ctx.setTransform(d, 0, 0, d, 0, 0); ctx.fillStyle = '#2E3A2F'; ctx.fillRect(0, 0, innerWidth, innerHeight);
      for (var i = 0; i < 40; i++) { ctx.fillStyle = ['#5E7D4A', '#E07A5F', '#8FC1C9', '#F4B942'][i % 4]; ctx.beginPath(); ctx.arc((i * 97) % innerWidth, (i * 61) % innerHeight, 5 + i % 5, 0, 7); ctx.fill(); }
      if (OG.game.state === 'run') { var r = OG.state.run, p = OG.state.player; r.time += dt * (Q.get('fast') ? 30 : 1); r.xp = (r.xp + dt * 2) % r.xpNext; r.light += dt * 900; r.kills += 1; p.dashCd = Math.max(0, p.dashCd - dt); if (Q.get('hurt')) p.hp = 22; }
      rnd.forEach(function (x) { x[1](ctx, 1, dt); });
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
    if (Q.get('screen') === 'offline') OG.bus.emit('offline:gain', { seconds: 11580, light: 4567890, rootsGained: 23 });
    OG.bus.emit('boot');
    scenario(Q.get('screen') || 'title');
  };

  function offer(n) { OG.bus.emit('levelup:offer', { options: opts(n || 0).slice(0, +(Q.get('n') || 4)) }); OG.state.run.level = 8; OG.game.setState('levelup'); }
  function scenario(s) {
    var st = OG.state, hud = function () { OG.meta.startRun({ daily: s === 'hud-daily' }); st.run.time = 247; st.run.level = 8; st.run.xp = 6; st.run.xpNext = 14; st.run.light = 12345678; st.run.kills = 400; st.player.hp = Q.get('hurt') ? 22 : 76; st.player.dashCd = 1.4; };
    setTimeout(function () {
      if (s === 'hud' || s === 'hud-daily') { hud(); OG.input.stick = { active: true, ox: 90, oy: innerHeight - 180, x: 120, y: innerHeight - 200 }; if (Q.get('toast')) setTimeout(function () { OG.bus.emit('synergy:found', { id: 's1', name: 'Rừng Cháy', desc: 'Lửa gặp Rễ: đạn để lại vệt cháy trên đất.', branches: ['fire', 'root'], first: true }); }, 300); }
      else if (s === 'levelup') { hud(); offer(0); }
      else if (s === 'pause') { hud(); OG.game.setState('paused'); }
      else if (s === 'settings') OG.ui.show('settings');
      else if (s === 'roots') OG.ui.show('roots');
      else if (s === 'codex') OG.ui.show('codex');
      else if (s === 'confirm') OG.ui.show('confirm', { title: 'Xoá dữ liệu?', text: 'Rễ, cây, sổ cộng hưởng và kỷ lục sẽ mất vĩnh viễn.', yes: 'Xoá hết', no: 'Giữ lại' });
      else if (s === 'winter' || s === 'winter-clear' || s === 'winter-daily') { hud(); OG.state.run.daily = s === 'winter-daily'; OG.bus.emit('run:start', { seed: 1, daily: s === 'winter-daily' }); OG.state.meta.best = { time: 300, level: 7 }; OG.bus.emit('run:start', { seed: 1, daily: s === 'winter-daily' }); OG.meta.endRun(s === 'winter-clear' ? 'clear' : 'death'); }
    }, 60);
  }
})(window.OG = window.OG || {});
