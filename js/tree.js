(function (OG) {
  'use strict';
  OG.cfg = OG.cfg || {};

  // ---------- tunables ----------
  var CFG = OG.cfg.tree = {
    xpBase: 3, xpExp: 1.6,
    norm: { fire: 50, wind: 400, root: 5, stone: 2 }, // raw signal -> comparable growth
    shareBoost: 3,        // weight = (1 + shareBoost * share) ^ biasPow
    biasPow: 3,           // sharpens style bias (plain linear 1+3*share cannot reach 60% fire)
    synergyWeight: 2,
    growEmitInterval: 0.25, // => at most 4 branch:grow per second
    caps: { rootSlow: 0.8, crit: 0.95, dashCdMin: 0.5, fireRate: 15, moveSpeed: 500,
            projCount: 12, orbitCount: 12, chain: 8, splitCount: 6, choicesMin: 1, choicesMax: 6 }
  };

  var BRANCHES = ['fire', 'wind', 'root', 'stone'];

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function emit(n, d) { if (OG.bus) OG.bus.emit(n, d); }

  function baseStats() {
    return { dmg: 10, fireRate: 1.6, projSpeed: 420, projCount: 1, pierce: 0, spread: 0.18, moveSpeed: 150,
      maxHp: 100, armor: 0, regen: 0, magnet: 70, crit: 0.05, critMul: 2, dashCd: 3, dashDist: 120, area: 1,
      orbitCount: 0, orbitDmg: 0, orbitRadius: 60, novaDmg: 0, novaCd: 0, thorns: 0, rootSlow: 0, chain: 0,
      burnDps: 0, trailDmg: 0, splitCount: 0, leech: 0, xpMul: 1, lightMul: 1, choices: 3 };
  }

  // ---------- skills (5 per branch) ----------
  var SK = [
    // Lửa
    { id: 'fire_ember', branch: 'fire', name: 'Hạt Lửa', maxRank: 5, desc: 'Đốt cháy địch: +5 sát thương/giây mỗi cấp',
      fx: function (r, s) { s.burnDps += 5 * r; } },
    { id: 'fire_dmg', branch: 'fire', name: 'Hạt Nóng', maxRank: 5, desc: '+20% sát thương hạt mỗi cấp',
      fx: function (r, s) { s.dmg *= 1 + 0.2 * r; } },
    { id: 'fire_rate', branch: 'fire', name: 'Bắn Dồn', maxRank: 5, desc: '+12% tốc độ bắn mỗi cấp',
      fx: function (r, s) { s.fireRate *= 1 + 0.12 * r; } },
    { id: 'fire_multi', branch: 'fire', name: 'Chùm Hạt', maxRank: 3, desc: '+1 hạt mỗi lần bắn, tản rộng thêm 10%',
      fx: function (r, s) { s.projCount += r; s.spread *= 1 + 0.1 * r; } },
    { id: 'fire_crit', branch: 'fire', name: 'Mắt Lửa', maxRank: 4, desc: '+8% chí mạng, +25% sát thương chí mạng',
      fx: function (r, s) { s.crit += 0.08 * r; s.critMul += 0.25 * r; } },
    // Gió
    { id: 'wind_trail', branch: 'wind', name: 'Vệt Gió', maxRank: 5, desc: 'Để lại vệt gió: +6 sát thương/giây mỗi cấp',
      fx: function (r, s) { s.trailDmg += 6 * r; } },
    { id: 'wind_speed', branch: 'wind', name: 'Chân Gió', maxRank: 5, desc: '+10% tốc độ chạy mỗi cấp',
      fx: function (r, s) { s.moveSpeed *= 1 + 0.1 * r; } },
    { id: 'wind_dash', branch: 'wind', name: 'Lướt Gió', maxRank: 4, desc: 'Lướt hồi nhanh hơn 12%, xa hơn 15% mỗi cấp',
      fx: function (r, s) { s.dashCd *= 1 - 0.12 * r; s.dashDist *= 1 + 0.15 * r; } },
    { id: 'wind_proj', branch: 'wind', name: 'Hạt Xuyên', maxRank: 3, desc: '+1 xuyên địch, +12% tốc độ hạt mỗi cấp',
      fx: function (r, s) { s.pierce += r; s.projSpeed *= 1 + 0.12 * r; } },
    { id: 'wind_chain', branch: 'wind', name: 'Gió Lan', maxRank: 3, desc: 'Sát thương nảy thêm +1 địch mỗi cấp',
      fx: function (r, s) { s.chain += r; } },
    // Rễ
    { id: 'root_petal', branch: 'root', name: 'Cánh Hoa', maxRank: 4, desc: '+1 cánh hoa quay quanh (10+ sát thương)',
      fx: function (r, s) { s.orbitCount += r; s.orbitDmg += 10 + 3 * (r - 1); } },
    { id: 'root_magnet', branch: 'root', name: 'Rễ Hút', maxRank: 5, desc: '+30% tầm hút kinh nghiệm mỗi cấp',
      fx: function (r, s) { s.magnet *= 1 + 0.3 * r; } },
    { id: 'root_xp', branch: 'root', name: 'Mầm Trí Tuệ', maxRank: 5, desc: '+12% kinh nghiệm nhận được mỗi cấp',
      fx: function (r, s) { s.xpMul *= 1 + 0.12 * r; } },
    { id: 'root_heal', branch: 'root', name: 'Hồi Xanh', maxRank: 4, desc: '+0,6 máu/giây, +0,5 máu mỗi hạt XP mỗi cấp',
      fx: function (r, s) { s.regen += 0.6 * r; s.leech += 0.5 * r; } },
    { id: 'root_hp', branch: 'root', name: 'Thân Dày', maxRank: 5, desc: '+15% máu tối đa mỗi cấp',
      fx: function (r, s) { s.maxHp *= 1 + 0.15 * r; } },
    // Đá
    { id: 'stone_skin', branch: 'stone', name: 'Vỏ Đá', maxRank: 4, desc: 'Phản 6 sát thương, đứng yên làm chậm địch 10%',
      fx: function (r, s) { s.thorns += 6 * r; s.rootSlow += 0.1 * r; } },
    { id: 'stone_armor', branch: 'stone', name: 'Da Sần', maxRank: 5, desc: '+2 giáp mỗi cấp',
      fx: function (r, s) { s.armor += 2 * r; } },
    { id: 'stone_hp', branch: 'stone', name: 'Tảng Đá', maxRank: 5, desc: '+30 máu tối đa mỗi cấp',
      fx: function (r, s) { s.maxHp += 30 * r; } },
    { id: 'stone_area', branch: 'stone', name: 'Bụi Đá', maxRank: 4, desc: '+12% vùng ảnh hưởng mỗi cấp',
      fx: function (r, s) { s.area *= 1 + 0.12 * r; } },
    { id: 'stone_hammer', branch: 'stone', name: 'Búa Đá', maxRank: 4, desc: '+20% sát thương, -5% tốc chạy mỗi cấp',
      fx: function (r, s) { s.dmg *= 1 + 0.2 * r; s.moveSpeed *= 1 - 0.05 * r; } }
  ];

  function nova(s, mul, cd) {
    s.novaDmg = Math.max(s.novaDmg, s.dmg * mul);
    s.novaCd = s.novaCd > 0 ? Math.min(s.novaCd, cd) : cd;
  }

  // ---------- synergies (2 per branch pair; 2 secret) ----------
  var SY = [
    { id: 'loc_lua', name: 'Lốc Lửa', branches: ['fire', 'wind'], secret: false, key: 'burnDps',
      req: { fire_ember: 3, wind_speed: 2 }, desc: 'Cánh hoa lửa quay quanh: +2 cánh, đốt ×2',
      fx: function (s) { s.burnDps *= 2; s.orbitCount += 2; s.orbitDmg += 8 + 0.5 * s.burnDps; s.orbitRadius *= 1.25; } },
    { id: 'sao_bang', name: 'Sao Băng', branches: ['fire', 'wind'], secret: false, key: 'projSpeed',
      req: { fire_multi: 2, wind_proj: 2 }, desc: 'Hạt thẳng như tên: xuyên +3, nhanh ×1,6',
      fx: function (s) { s.projSpeed *= 1.6; s.pierce += 3; s.spread *= 0.5; } },
    { id: 'tro_nuoi_re', name: 'Tro Nuôi Rễ', branches: ['fire', 'root'], secret: false, key: 'leech',
      req: { fire_ember: 3, root_heal: 2 }, desc: 'Địch cháy nuôi bạn: hồi máu từ XP ×3, đốt +30%',
      fx: function (s) { s.leech *= 3; s.burnDps *= 1.3; } },
    { id: 'hoa_mat_troi', name: 'Hoa Mặt Trời', branches: ['fire', 'root'], secret: false, key: 'orbitDmg',
      req: { fire_dmg: 3, root_petal: 2 }, desc: 'Nổ lửa mỗi 6 giây (5× sát thương), cánh hoa ×2',
      fx: function (s) { s.orbitDmg *= 2; nova(s, 5, 6); s.area *= 1.2; } },
    { id: 'nui_lua', name: 'Núi Lửa', branches: ['fire', 'stone'], secret: true, key: 'dmg',
      req: { fire_dmg: 4, stone_hammer: 3 }, desc: 'Hạt vỡ thành 3 mảnh, sát thương ×1,5',
      fx: function (s) { s.dmg *= 1.5; s.splitCount += 3; } },
    { id: 'da_nung', name: 'Đá Nung', branches: ['fire', 'stone'], secret: false, key: 'thorns',
      req: { fire_ember: 2, stone_skin: 3 }, desc: 'Chạm vào bị đốt: phản ×2,5, đốt +30%, giáp +3',
      fx: function (s) { s.thorns *= 2.5; s.burnDps *= 1.3; s.armor += 3; } },
    { id: 'duong_hoa', name: 'Đường Hoa', branches: ['wind', 'root'], secret: false, key: 'trailDmg',
      req: { wind_trail: 3, root_petal: 2 }, desc: 'Vệt gió nở hoa: vệt ×2,5, +1 cánh, hút ×1,5',
      fx: function (s) { s.trailDmg *= 2.5; s.orbitCount += 1; s.magnet *= 1.5; } },
    { id: 'phan_hoa', name: 'Phấn Hoa', branches: ['wind', 'root'], secret: false, key: 'chain',
      req: { wind_chain: 2, root_xp: 2 }, desc: 'Gió mang phấn: nảy ×2, kinh nghiệm +40%, hút +30%',
      fx: function (s) { s.chain *= 2; s.xpMul *= 1.4; s.magnet *= 1.3; } },
    { id: 'tang_lan', name: 'Tảng Lăn', branches: ['wind', 'stone'], secret: false, key: 'moveSpeed',
      req: { wind_speed: 3, stone_skin: 2 }, desc: 'Lăn như đá: chạy ×1,5, phản ×2, giáp +3',
      fx: function (s) { s.moveSpeed *= 1.5; s.thorns *= 2; s.armor += 3; } },
    { id: 'mat_bao', name: 'Mắt Bão', branches: ['wind', 'stone'], secret: true, key: 'dashDist',
      req: { wind_dash: 3, stone_armor: 3 }, desc: 'Bão đá nổ định kỳ (4× sát thương), lướt xa ×1,5',
      fx: function (s) { s.dashDist *= 1.5; nova(s, 4, Math.max(2, s.dashCd * 2)); s.area *= 1.2; } },
    { id: 'phao_dai_song', name: 'Pháo Đài Sống', branches: ['root', 'stone'], secret: false, key: 'thorns',
      req: { stone_skin: 3, root_hp: 3 }, desc: 'Giáp ×2 (+6), phản ×3, rễ làm chậm thêm 30%',
      fx: function (s) { s.armor = s.armor * 2 + 6; s.thorns *= 3; s.rootSlow += 0.3; } },
    { id: 'vong_hoa_da', name: 'Vòng Hoa Đá', branches: ['root', 'stone'], secret: false, key: 'orbitDmg',
      req: { root_petal: 3, stone_area: 3 }, desc: 'Cánh hoa cứng: +2 cánh, sát thương ×2, giáp +3',
      fx: function (s) { s.orbitDmg *= 2; s.orbitCount += 2; s.orbitRadius *= 1.4; s.armor += 3; } }
  ];

  var SKMAP = {}, i;
  for (i = 0; i < SK.length; i++) SKMAP[SK[i].id] = SK[i];

  // ---------- stats ----------
  function calc(ranks, syns, bonus) {
    var s = baseStats(), b = bonus || {}, k, c = CFG.caps;
    s.maxHp += num(b.maxHp, 0);
    s.dmg *= num(b.dmgMul, 1);
    s.moveSpeed *= num(b.moveMul, 1);
    s.magnet *= num(b.magnetMul, 1);
    s.xpMul *= num(b.xpMul, 1);
    s.lightMul *= num(b.lightMul, 1);
    s.choices += num(b.choices, 0);
    for (k = 0; k < SK.length; k++) { var r = ranks[SK[k].id] | 0; if (r > 0) SK[k].fx(r, s); }
    for (k = 0; k < SY.length; k++) if (syns[SY[k].id]) SY[k].fx(s);
    s.rootSlow = clamp(s.rootSlow, 0, c.rootSlow);
    s.crit = clamp(s.crit, 0, c.crit);
    s.dashCd = Math.max(c.dashCdMin, s.dashCd);
    s.fireRate = Math.min(c.fireRate, s.fireRate);
    s.moveSpeed = Math.min(c.moveSpeed, s.moveSpeed);
    s.armor = Math.max(0, s.armor);
    s.projCount = clamp(Math.round(s.projCount), 1, c.projCount);
    s.pierce = Math.max(0, Math.round(s.pierce));
    s.orbitCount = clamp(Math.round(s.orbitCount), 0, c.orbitCount);
    s.chain = clamp(Math.round(s.chain), 0, c.chain);
    s.splitCount = clamp(Math.round(s.splitCount), 0, c.splitCount);
    s.choices = clamp(Math.round(s.choices), c.choicesMin, c.choicesMax);
    return s;
  }

  // ---------- module state ----------
  var curBonus = {}, pending = 0, offering = false, current = null, dirty = {}, growT = 0;

  function need(n) { return Math.round(CFG.xpBase * Math.pow(Math.max(1, n), CFG.xpExp)); }

  function recompute() {
    var S = OG.state, t = S.tree, p = S.player;
    var s = calc(t.skills || {}, t.synergies || {}, curBonus);
    if (!S.stats) S.stats = {};
    for (var k in s) S.stats[k] = s[k];
    if (p) {
      var old = p.maxHp;
      if (old > 0 && isFinite(p.hp)) p.hp = (p.hp / old) * s.maxHp;
      p.maxHp = s.maxHp;
    }
    return S.stats;
  }

  function ensureStats() { if (!OG.state.stats || OG.state.stats.dmg === undefined) recompute(); }

  function codexHas(id) { var m = OG.state.meta; return !!(m && m.codex && m.codex[id]); }

  // synergy that taking skill `sk` (rank+1) would complete, or null
  function completes(sk) {
    var cur = OG.state.tree.skills, syns = OG.state.tree.synergies;
    for (var a = 0; a < SY.length; a++) {
      var y = SY[a], nd = y.req[sk.id];
      if (syns[y.id] || nd === undefined) continue;
      var have = cur[sk.id] | 0;
      if (have >= nd || have + 1 < nd) continue;
      var ok = true;
      for (var id in y.req) if (id !== sk.id && (cur[id] | 0) < y.req[id]) { ok = false; break; }
      if (ok) return y;
    }
    return null;
  }

  function getRand() { return typeof OG.rand === 'function' ? OG.rand : Math.random; }

  function removeItem(list, it) { var x = list.indexOf(it); if (x >= 0) list.splice(x, 1); }

  function draw(avoid) {
    var S = OG.state, t = S.tree, rand = getRand(), k;
    ensureStats();
    var all = [];
    for (k = 0; k < SK.length; k++) if ((t.skills[SK[k].id] | 0) < SK[k].maxRank) all.push(SK[k]);
    var want = Math.min(S.stats.choices | 0, all.length);
    if (want <= 0) return [];
    var pool = all;
    if (avoid) {
      var f = all.filter(function (c) { return avoid.indexOf(c.id) < 0; });
      if (f.length >= want) pool = f;
    }
    var sum = 0, topB = null, best = 0, g = t.growth;
    for (k = 0; k < BRANCHES.length; k++) {
      sum += g[BRANCHES[k]] || 0;
      if ((g[BRANCHES[k]] || 0) > best) { best = g[BRANCHES[k]]; topB = BRANCHES[k]; }
    }
    var W = {}, H = {};
    pool.forEach(function (c) {
      var share = sum > 0 ? (g[c.branch] || 0) / sum : 0.25;
      var w = Math.pow(1 + CFG.shareBoost * share, CFG.biasPow);
      var h = completes(c);
      if (h) { w *= CFG.synergyWeight; H[c.id] = h; }
      W[c.id] = w;
    });
    function pickW(list) {
      var tot = 0, x;
      for (x = 0; x < list.length; x++) tot += W[list[x].id];
      var r = rand() * tot, it = list[list.length - 1];
      for (x = 0; x < list.length; x++) { r -= W[list[x].id]; if (r < 0) { it = list[x]; break; } }
      return it;
    }
    var list = pool.slice(), picks = [], p;
    if (want >= 2) {
      if (topB) {
        var inTop = list.filter(function (c) { return c.branch === topB; });
        if (inTop.length) { p = pickW(inTop); picks.push(p); removeItem(list, p); }
      }
      if (!picks.length) { p = pickW(list); picks.push(p); removeItem(list, p); topB = p.branch; }
      var others = list.filter(function (c) { return c.branch !== topB; });
      if (others.length) { p = pickW(others); picks.push(p); removeItem(list, p); }
    }
    while (picks.length < want && list.length) { p = pickW(list); picks.push(p); removeItem(list, p); }
    for (k = picks.length - 1; k > 0; k--) { var j = Math.floor(rand() * (k + 1)); var tmp = picks[k]; picks[k] = picks[j]; picks[j] = tmp; }
    return picks.map(function (c) {
      var cur = t.skills[c.id] | 0, h = H[c.id];
      return { id: c.id, name: c.name, desc: c.desc, branch: c.branch, rank: cur + 1, maxRank: c.maxRank, isNew: cur === 0,
        synergyHint: h ? 'Sắp cộng hưởng: ' + (h.secret && !codexHas(h.id) ? '???' : h.name) : null };
    });
  }

  function offer(opts) { current = opts; emit('levelup:offer', { options: opts }); }

  function pump() {
    if (offering) return;
    while (pending > 0) {
      pending--;
      var o = draw();
      if (o.length) {
        offering = true; offer(o);
        if (OG.game.state !== 'levelup') OG.game.setState('levelup');
        return;
      }
    }
    if (OG.game.state === 'levelup') OG.game.setState('run');
  }

  function checkSynergies() {
    var S = OG.state, t = S.tree, found = [];
    for (var a = 0; a < SY.length; a++) {
      var y = SY[a];
      if (t.synergies[y.id]) continue;
      var ok = true;
      for (var id in y.req) if ((t.skills[id] | 0) < y.req[id]) { ok = false; break; }
      if (!ok) continue;
      t.synergies[y.id] = true;
      t.order.push({ id: y.id, branch: y.branches[0], kind: 'synergy', t: (S.run && S.run.time) || 0 });
      found.push({ y: y, first: !codexHas(y.id) });
    }
    return found;
  }

  // ---------- public API ----------
  function reset(bonus) {
    var S = OG.state, b = curBonus = bonus || {};
    if (!S.tree) S.tree = {};
    var t = S.tree;
    t.growth = { fire: 0, wind: 0, root: 0, stone: 0 }; t.skills = {}; t.synergies = {}; t.order = [];
    pending = 0; offering = false; current = null; dirty = {}; growT = 0;
    var n = Math.max(0, Math.floor(num(b.startLevel, 0)));
    S.run.level = 1 + n; S.run.xp = 0; S.run.xpNext = need(S.run.level);
    S.run.rerolls = Math.max(0, Math.floor(num(b.rerolls, 0)));
    pending = n; // offers start on the first run tick (state is set to 'run' after reset)
    recompute();
  }

  function track(branch, n) {
    var d = CFG.norm[branch];
    if (!d || !(n > 0)) return;
    var g = n / d, t = OG.state.tree;
    t.growth[branch] = (t.growth[branch] || 0) + g;
    dirty[branch] = (dirty[branch] || 0) + g;
  }

  function addXp(n) {
    if (!(n > 0)) return;
    var r = OG.state.run;
    ensureStats();
    r.xp += n * OG.state.stats.xpMul;
    while (r.xp >= r.xpNext) {
      r.xp -= r.xpNext; r.level++; r.xpNext = need(r.level); pending++;
      emit('level:up', { level: r.level });
    }
    pump();
  }

  function grantLevel() {
    var r = OG.state.run;
    r.level++; r.xpNext = need(r.level); pending++;
    emit('level:up', { level: r.level });
    pump();
  }

  function choose(id) {
    if (!offering || !current || !SKMAP[id]) return false;
    if (!current.some(function (o) { return o.id === id; })) return false;
    var S = OG.state, t = S.tree, sk = SKMAP[id];
    var rank = (t.skills[id] | 0) + 1;
    t.skills[id] = rank;
    t.order.push({ id: id, branch: sk.branch, kind: 'skill', t: (S.run && S.run.time) || 0 });
    recompute();
    var found = checkSynergies();
    if (found.length) recompute();
    emit('skill:gain', { id: id, branch: sk.branch, rank: rank });
    found.forEach(function (f) {
      emit('synergy:found', { id: f.y.id, name: f.y.name, desc: f.y.desc, branches: f.y.branches.slice(), first: f.first });
    });
    offering = false; current = null;
    pump();
    return true;
  }

  function reroll() {
    var r = OG.state.run;
    if (!offering || !current || !(r.rerolls > 0)) return false;
    var o = draw(current.map(function (x) { return x.id; }));
    if (!o.length) return false;
    r.rerolls--;
    offer(o);
    return true;
  }

  function update(dt) {
    growT += dt;
    if (growT >= CFG.growEmitInterval) {
      var bb = null, bv = 0;
      for (var k = 0; k < BRANCHES.length; k++) if ((dirty[BRANCHES[k]] || 0) > bv) { bv = dirty[BRANCHES[k]]; bb = BRANCHES[k]; }
      if (bb) { dirty[bb] = 0; growT = 0; emit('branch:grow', { branch: bb, total: OG.state.tree.growth[bb] }); }
      else growT = CFG.growEmitInterval;
    }
    if (pending > 0 && !offering) pump();
  }

  OG.tree = {
    reset: reset, track: track, addXp: addXp, grantLevel: grantLevel, choose: choose, reroll: reroll,
    recompute: recompute, xpNeed: need,
    skills: SK.map(function (s) { return { id: s.id, branch: s.branch, name: s.name, desc: s.desc, maxRank: s.maxRank }; }),
    synergies: SY.map(function (y) { return { id: y.id, name: y.name, desc: y.desc, branches: y.branches.slice(), secret: y.secret, req: y.req }; })
  };

  if (OG.game && OG.game.addUpdate) OG.game.addUpdate(update, 5);
})(window.OG = window.OG || {});
