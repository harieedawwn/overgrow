/* OVERGROW — world.js : gameplay simulation (no drawing).
 * Writes: player, enemies, projectiles, hazards, orbits, trails, pickups, run.time/kills/light.
 * Notes: xpMul and lightMul are applied here (world implements STATS).
 *        thorns = damage per second dealt to enemies touching the player (applied in 0.25 s pulses).
 *        Event payload objects are reused (do not keep references to them).
 */
(function (OG) {
  'use strict';

  var cfg = (OG.cfg = OG.cfg || {});
  var C = (cfg.world = {
    bound: 2000,
    accelTime: 0.08, stopTime: 0.06,
    dashTime: 0.15, hitInvuln: 0.6,
    targetRange: 520, chainRange: 160,
    projR: 5, projLife: 1.5, projMax: 900, shootEventRate: 12,
    hitFlash: 0.1, burnTime: 3,
    orbitSpin: 3.2, petalR: 12, orbitHitCd: 0.4,
    novaRadius: 110,
    trailR: 26, trailLife: 2.5, trailEvery: 0.03, trailMax: 80,
    thornEvery: 0.25,
    splitSpeedMul: 0.8, splitDmgMul: 0.5, splitLife: 0.7,
    fireTrackR: 180, windNearR: 220, stillTime: 0.5, rootSlowR: 90,
    cap: 350, spawnBase: 0.4, spawnPerSec: 0.002, spawnMaxPerTick: 8,
    ringMin: 500, ringMax: 700, bossRing: 450,
    hpDouble: 90, dmgGrow: 1.5, dmgGrowTime: 90, lightGrow: 60, xpGrow: 120,
    relaxDmg: 0.25, relaxSpawn: 0.6,
    sepSpeed: 140, sepNeighbors: 6, sepScan: 24,
    spitHold: 260, spitSpeed: 180, spitEvery: 2.4, spitRange: 460, spitR: 7, spitLife: 4.5,
    coreSlamEvery: 4.5, coreSlamRange: 420, slamR: 100, slamTelegraph: 0.8, slamActive: 0.25, slamDmgMul: 1.3,
    motherBurstEvery: [3.6, 2.6, 1.8], motherBurstN: [10, 14, 20],
    motherBurstSpeed: 150, motherBurstR: 9, motherBurstLife: 5, motherBurstDmgMul: 0.5,
    motherMinionEvery: [1.8, 1.2, 0.8], motherMinionCount: [2, 3, 4], motherSpawnBoost: 0.1,
    orbMax: 200, mergeEvery: 0.2, pullStart: 140, pullAccel: 2200, pullMax: 1000, pickupR: 6, healFrac: 0.15,
    bosses: [
      { t: 180, kind: 'core' }, { t: 360, kind: 'core' }, { t: 540, kind: 'core' },
      { t: 720, kind: 'core' }, { t: 900, kind: 'mother' }
    ],
    kinds: {
      spore:   { r: 8,  hp: 6,    speed: 112, dmg: 3,  xp: 1,  light: 1 },
      mold:    { r: 13, hp: 20,   speed: 66,  dmg: 5, xp: 2,  light: 2 },
      brute:   { r: 24, hp: 140,  speed: 42,  dmg: 11, xp: 8,  light: 6 },
      spitter: { r: 12, hp: 16,   speed: 58,  dmg: 4,  xp: 3,  light: 3 },
      core:    { r: 40, hp: 150,  speed: 30,  dmg: 14, xp: 40, light: 100 },
      mother:  { r: 70, hp: 120,  speed: 22,  dmg: 5, xp: 0,  light: 1000 }
    },
    defStats: {
      dmg: 10, fireRate: 1.6, projSpeed: 420, projCount: 1, pierce: 0, spread: 0.18, moveSpeed: 150,
      maxHp: 100, armor: 0, regen: 0, magnet: 70, crit: 0.05, critMul: 2, dashCd: 3, dashDist: 120,
      area: 1, orbitCount: 0, orbitDmg: 0, orbitRadius: 60, novaDmg: 0, novaCd: 0, thorns: 0,
      rootSlow: 0, chain: 0, burnDps: 0, trailDmg: 0, splitCount: 0, leech: 0, xpMul: 1, lightMul: 1, choices: 3
    }
  });

  var DEF = C.defStats, KINDS = C.kinds, TWO_PI = Math.PI * 2;
  var B = C.bound;

  // ---- module state ----
  var st, P, E, PJ, HZ, OR, TR, PK, run, S, inp;
  var epool = [], ppool = [], hpool = [], tpool = [], kpool = [];
  var liveCount = 0, nextId = 0, tick = 0;
  var bossIdx = 0, motherAlive = false, motherPhase = 0;
  var spawnAcc = 0, fireT = 0, novaT = 0, thornT = 0, trailT = 0, orbitAng = 0, shootEmitT = -1, mergeCd = 0;
  var deadSent = false, lastMaxHp = 100;
  var dashT = 0, dashDx = 1, dashDy = 0, dashSpeed = 0, lastDx = 1, lastDy = 0;
  var moveDist = 0, xpCount = 0, relaxOn = false;
  var crng = function () { return 0.5; };
  var fallbackRand = null;

  // spatial hash (cell 64) for enemies
  var GW = 64, OFF = 2048, INV = 1 / 64;
  var head = new Int32Array(GW * GW), nxt = new Int32Array(1536);
  var qa = new Int32Array(1536), qb = new Int32Array(1536);
  var maxEr = 24;

  // orb merge grid
  var MG = 64, mergeStamp = new Int32Array(MG * MG), mergeRef = new Array(MG * MG), mergeGen = 0;

  // reusable event payloads
  var evHit = { x: 0, y: 0, dmg: 0, crit: false, kind: '' };
  var evDie = { x: 0, y: 0, kind: '' };
  var evBloom = { x: 0, y: 0, kind: '' };
  var evNova = { x: 0, y: 0, r: 0 };
  var evShoot = { x: 0, y: 0 };
  var evDash = { x: 0, y: 0 };
  var evHurt = { dmg: 0, hp: 0, maxHp: 0 };
  var evHeal = { amount: 0 };
  var evXp = { amount: 0, x: 0, y: 0 };
  var evBoss = { kind: '' };

  var dbg = { log: null };

  function emit(name, data) { if (OG.bus) OG.bus.emit(name, data); }
  function R() { return (typeof OG.rand === 'function' ? OG.rand : fallbackRand)(); }

  function bind() {
    st = OG.state; P = st.player; E = st.enemies; PJ = st.projectiles; HZ = st.hazards;
    OR = st.orbits; TR = st.trails; PK = st.pickups; run = st.run;
    if (!st.stats) st.stats = {};
    S = st.stats; inp = OG.input;
  }
  function ensureStats() {
    if (S.dmg === undefined || S.fireRate === undefined) {
      for (var k in DEF) if (S[k] === undefined) S[k] = DEF[k];
    }
  }
  function clampB(v) { return v < -B ? -B : (v > B ? B : v); }

  // ---- pools ----
  function newEnemy() {
    return { id: 0, kind: '', x: 0, y: 0, r: 0, hp: 0, maxHp: 0, speed: 0, dmg: 0, hit: 0, burn: 0, slow: 0,
      cd: 0, cd2: 0, orbitCd: 0, dead: false, boss: false, phase: 1, touch: false };
  }
  function addProjectile(x, y, vx, vy, dmg, pierce, chain, gen, life) {
    var p = ppool.pop();
    if (!p) p = { x: 0, y: 0, vx: 0, vy: 0, r: 0, dmg: 0, pierce: 0, kind: 'seed', life: 0, hits: [], chainLeft: 0, gen: 0 };
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.r = C.projR; p.dmg = dmg; p.pierce = pierce;
    p.kind = 'seed'; p.life = life; p.hits.length = 0; p.chainLeft = chain; p.gen = gen;
    PJ.push(p);
    return p;
  }
  function addHazard(x, y, vx, vy, r, dmg, life, telegraph, zone, next) {
    var h = hpool.pop();
    if (!h) h = { x: 0, y: 0, vx: 0, vy: 0, r: 0, dmg: 0, life: 0, telegraph: false, zone: false, next: 0 };
    h.x = x; h.y = y; h.vx = vx; h.vy = vy; h.r = r; h.dmg = dmg; h.life = life;
    h.telegraph = telegraph; h.zone = zone; h.next = next;
    HZ.push(h);
    return h;
  }
  function addPickup(x, y, amount, kind) {
    var k = kpool.pop();
    if (!k) k = { x: 0, y: 0, amount: 0, kind: 'xp', pull: false, sp: 0 };
    k.x = x; k.y = y; k.amount = amount; k.kind = kind; k.pull = false; k.sp = 0;
    PK.push(k);
    return k;
  }

  // ---- spatial hash ----
  function cellOf(v) {
    var c = ((v + OFF) * INV) | 0;
    return c < 0 ? 0 : (c >= GW ? GW - 1 : c);
  }
  function buildHash() {
    head.fill(-1);
    maxEr = 24;
    var n = E.length, i, e, c;
    for (i = 0; i < n && i < nxt.length; i++) {
      e = E[i];
      if (e.dead) continue;
      c = cellOf(e.y) * GW + cellOf(e.x);
      nxt[i] = head[c]; head[c] = i;
      if (e.r > maxEr) maxEr = e.r;
    }
  }
  // fills out[] with indices of live enemies whose circle overlaps circle (x,y,rad); returns count
  function query(x, y, rad, out) {
    var rr = rad + maxEr;
    var x0 = cellOf(x - rr), x1 = cellOf(x + rr), y0 = cellOf(y - rr), y1 = cellOf(y + rr);
    var n = 0, cx, cy, j, e, dx, dy, m;
    for (cy = y0; cy <= y1; cy++) {
      for (cx = x0; cx <= x1; cx++) {
        for (j = head[cy * GW + cx]; j >= 0; j = nxt[j]) {
          e = E[j];
          if (e.dead) continue;
          dx = e.x - x; dy = e.y - y; m = rad + e.r;
          if (dx * dx + dy * dy <= m * m && n < out.length) out[n++] = j;
        }
      }
    }
    return n;
  }

  // ---- enemies ----
  function pickKind(t, r) {
    var late = t >= 120;
    var wSpore = 6 * Math.max(0.15, 1 - t / 500);
    var wMold = 3 + Math.min(t / 150, 3);
    var wBrute = late ? Math.min(1 + (t - 120) / 200, 3) : 0;
    var wSpit = late ? Math.min(1 + (t - 120) / 250, 2.5) : 0;
    var x = r * (wSpore + wMold + wBrute + wSpit);
    if ((x -= wSpore) < 0) return 'spore';
    if ((x -= wMold) < 0) return 'mold';
    if ((x -= wBrute) < 0) return 'brute';
    return late ? 'spitter' : 'mold';
  }
  function recycleFarthest() {
    var n = E.length, i, e, d2, best = null, bd = -1, px = P.x, py = P.y, dx, dy;
    for (i = 0; i < n; i++) {
      e = E[i];
      if (e.dead || e.boss) continue;
      dx = e.x - px; dy = e.y - py; d2 = dx * dx + dy * dy;
      if (d2 > bd) { bd = d2; best = e; }
    }
    if (!best) return false;
    best.dead = true; liveCount--;
    return true;
  }
  function spawnEnemy(kind, x, y) {
    if (liveCount >= C.cap && !recycleFarthest()) return null;
    var K = KINDS[kind], t = run.time;
    var e = epool.pop() || newEnemy();
    e.id = ++nextId; e.kind = kind;
    e.x = clampB(x); e.y = clampB(y); e.r = K.r;
    e.maxHp = K.hp * Math.pow(2, t / C.hpDouble); e.hp = e.maxHp;
    e.dmg = K.dmg * Math.pow(C.dmgGrow, t / C.dmgGrowTime);
    e.speed = K.speed; e.hit = 0; e.burn = 0; e.slow = 0; e.orbitCd = 0;
    e.dead = false; e.touch = false; e.phase = 1;
    e.boss = (kind === 'core' || kind === 'mother');
    e.cd = kind === 'spitter' ? 1 + crng() * 1.5 : (kind === 'core' ? 2 : (kind === 'mother' ? 2 : 0));
    e.cd2 = kind === 'mother' ? 3 : 0;
    E.push(e); liveCount++;
    return e;
  }
  function spawnRandom(t) {
    var kind = pickKind(t, R());
    var a = R() * TWO_PI;
    var d = C.ringMin + R() * (C.ringMax - C.ringMin);
    if (dbg.log) dbg.log.push(kind);
    spawnEnemy(kind, P.x + Math.cos(a) * d, P.y + Math.sin(a) * d);
  }
  function spawnBoss(kind) {
    var a = crng() * TWO_PI;
    var e = spawnEnemy(kind, P.x + Math.cos(a) * C.bossRing, P.y + Math.sin(a) * C.bossRing);
    if (!e) return;
    if (kind === 'mother') { motherAlive = true; motherPhase = 1; }
    evBoss.kind = kind; emit('boss:spawn', evBoss);
  }
  function updateSpawner(dt) {
    var t = run.time;
    while (bossIdx < C.bosses.length && t >= C.bosses[bossIdx].t) { spawnBoss(C.bosses[bossIdx].kind); bossIdx++; }
    var rate = (C.spawnBase + t * C.spawnPerSec) * (relaxOn ? C.relaxSpawn : 1);
    if (motherAlive) rate *= 1 + C.motherSpawnBoost * motherPhase;
    spawnAcc += rate * dt;
    var n = 0;
    while (spawnAcc >= 1) { spawnAcc -= 1; if (n++ < C.spawnMaxPerTick) spawnRandom(t); }
  }

  // ---- damage / kill ----
  function hurtPlayer(raw) {
    if (P.invuln > 0 || P.dashing || P.hp <= 0) return false;
    var d = raw * (relaxOn ? C.relaxDmg : 1) - S.armor;
    if (d < 1) d = 1;
    P.hp -= d; P.invuln = C.hitInvuln;
    OG.tree.track('stone', d);
    evHurt.dmg = d; evHurt.hp = P.hp; evHurt.maxHp = P.maxHp;
    emit('player:hurt', evHurt);
    return true;
  }
  function dealDamage(e, dmg, crit, seed, proj) {
    if (e.dead) return;
    e.hp -= dmg; e.hit = C.hitFlash;
    evHit.x = e.x; evHit.y = e.y; evHit.dmg = dmg; evHit.crit = crit; evHit.kind = e.kind;
    emit('enemy:hit', evHit);
    if (seed) {
      var dx = e.x - P.x, dy = e.y - P.y;
      if (dx * dx + dy * dy <= C.fireTrackR * C.fireTrackR) OG.tree.track('fire', dmg);
      if (S.burnDps > 0) e.burn = C.burnTime;
    }
    if (e.hp <= 0) kill(e, proj);
  }
  function splitSeeds(e, proj) {
    var n = Math.floor(S.splitCount), i, a, a0 = crng() * TWO_PI, sp = S.projSpeed * C.splitSpeedMul, p;
    for (i = 0; i < n; i++) {
      if (PJ.length >= C.projMax) return;
      a = a0 + i * TWO_PI / n;
      p = addProjectile(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, proj.dmg * C.splitDmgMul, 0, 0, 1, C.splitLife);
      p.hits.push(e.id);
    }
  }
  function kill(e, proj) {
    if (e.dead) return;
    e.dead = true; e.hp = 0; liveCount--;
    var t = run.time, K = KINDS[e.kind], i, a;
    run.kills++;
    run.light += K.light * (1 + t / C.lightGrow) * S.lightMul;
    if (K.xp > 0) addPickup(e.x, e.y, K.xp * (1 + t / C.xpGrow), 'xp');
    evDie.x = e.x; evDie.y = e.y; evDie.kind = e.kind; emit('enemy:die', evDie);
    evBloom.x = e.x; evBloom.y = e.y; evBloom.kind = e.kind; emit('flower:bloom', evBloom);
    if (proj && proj.gen === 0 && S.splitCount > 0) splitSeeds(e, proj);
    if (e.boss) {
      evBoss.kind = e.kind; emit('boss:dead', evBoss);
      if (e.kind === 'core') {
        for (i = 0; i < 3; i++) {
          a = i * TWO_PI / 3 + 0.5;
          addPickup(e.x + Math.cos(a) * 40, e.y + Math.sin(a) * 40, P.maxHp * C.healFrac, 'heal');
        }
        OG.tree.grantLevel();
      } else {
        motherAlive = false; motherPhase = 0;
      }
    }
  }

  // ---- player ----
  function startDash(mx, my, ml) {
    var dx, dy, sp;
    if (ml > 0.2) { dx = mx / ml; dy = my / ml; }
    else {
      sp = Math.sqrt(P.vx * P.vx + P.vy * P.vy);
      if (sp > 20) { dx = P.vx / sp; dy = P.vy / sp; } else { dx = lastDx; dy = lastDy; }
    }
    dashDx = dx; dashDy = dy; dashT = C.dashTime; P.dashing = true; P.dashCd = S.dashCd;
    dashSpeed = S.dashDist / C.dashTime; trailT = 0;
    if (P.invuln < C.dashTime) P.invuln = C.dashTime;
    evDash.x = P.x; evDash.y = P.y; emit('player:dash', evDash);
  }
  function addTrail() {
    if (TR.length >= C.trailMax) return;
    var t = tpool.pop() || { x: 0, y: 0, r: 0, life: 0 };
    t.x = P.x; t.y = P.y; t.r = C.trailR * S.area; t.life = C.trailLife;
    TR.push(t);
  }
  function updatePlayer(dt) {
    var mx = inp.move.x, my = inp.move.y, ml = Math.sqrt(mx * mx + my * my), ox = P.x, oy = P.y;
    if (ml > 1) { mx /= ml; my /= ml; ml = 1; }
    if (ml > 0.2) { lastDx = mx / ml; lastDy = my / ml; }

    if (S.maxHp !== lastMaxHp) {
      if (S.maxHp > lastMaxHp) P.hp += S.maxHp - lastMaxHp;
      lastMaxHp = S.maxHp; P.maxHp = S.maxHp;
      if (P.hp > P.maxHp) P.hp = P.maxHp;
    }
    if (P.invuln > 0) { P.invuln -= dt; if (P.invuln < 0) P.invuln = 0; }
    if (P.dashCd > 0) { P.dashCd -= dt; if (P.dashCd < 0) P.dashCd = 0; }
    if (inp.dash && P.dashCd <= 0 && !P.dashing) startDash(mx, my, ml);

    if (P.dashing) {
      var stepT = dashT < dt ? dashT : dt;
      P.vx = dashDx * dashSpeed; P.vy = dashDy * dashSpeed;
      P.x += P.vx * stepT; P.y += P.vy * stepT;
      dashT -= dt;
      if (S.trailDmg > 0) { trailT -= dt; if (trailT <= 0) { trailT = C.trailEvery; addTrail(); } }
      if (dashT <= 1e-6) { P.dashing = false; P.vx = mx * S.moveSpeed; P.vy = my * S.moveSpeed; }
      P.still = 0;
    } else {
      var tvx = mx * S.moveSpeed, tvy = my * S.moveSpeed;
      var dvx = tvx - P.vx, dvy = tvy - P.vy, dl = Math.sqrt(dvx * dvx + dvy * dvy);
      var maxStep = (ml > 0.02 ? S.moveSpeed / C.accelTime : S.moveSpeed / C.stopTime) * dt;
      if (dl <= maxStep) { P.vx = tvx; P.vy = tvy; }
      else { P.vx += dvx / dl * maxStep; P.vy += dvy / dl * maxStep; }
      P.x += P.vx * dt; P.y += P.vy * dt;
      if (ml < 0.05) P.still += dt; else P.still = 0;
    }
    var lim = B - P.r;
    if (P.x < -lim) { P.x = -lim; if (P.vx < 0) P.vx = 0; } else if (P.x > lim) { P.x = lim; if (P.vx > 0) P.vx = 0; }
    if (P.y < -lim) { P.y = -lim; if (P.vy < 0) P.vy = 0; } else if (P.y > lim) { P.y = lim; if (P.vy > 0) P.vy = 0; }

    P.rooted = P.still > C.stillTime && S.rootSlow > 0;
    if (P.still > C.stillTime) OG.tree.track('stone', dt);
    if (S.regen > 0 && P.hp > 0 && P.hp < P.maxHp) { P.hp += S.regen * dt; if (P.hp > P.maxHp) P.hp = P.maxHp; }
    var mdx = P.x - ox, mdy = P.y - oy;
    moveDist = Math.sqrt(mdx * mdx + mdy * mdy);
  }

  // ---- enemy AI ----
  function coreAI(e, dt, d) {
    e.cd -= dt;
    if (e.cd <= 0 && d < C.coreSlamRange) {
      e.cd = C.coreSlamEvery;
      addHazard(P.x, P.y, 0, 0, C.slamR, 0, C.slamTelegraph, true, true, e.dmg * C.slamDmgMul);
    }
  }
  function motherAI(e, dt) {
    var f = e.hp / e.maxHp, ph = f > 0.66 ? 1 : (f > 0.33 ? 2 : 3), i, n, a, a0, cnt;
    e.phase = ph; motherPhase = ph;
    e.cd -= dt;
    if (e.cd <= 0) {
      e.cd = C.motherBurstEvery[ph - 1];
      n = C.motherBurstN[ph - 1]; a0 = crng() * TWO_PI;
      for (i = 0; i < n; i++) {
        a = a0 + i * TWO_PI / n;
        addHazard(e.x, e.y, Math.cos(a) * C.motherBurstSpeed, Math.sin(a) * C.motherBurstSpeed,
          C.motherBurstR, e.dmg * C.motherBurstDmgMul, C.motherBurstLife, false, false, 0);
      }
    }
    e.cd2 -= dt;
    if (e.cd2 <= 0) {
      e.cd2 = C.motherMinionEvery[ph - 1];
      cnt = C.motherMinionCount[ph - 1];
      for (i = 0; i < cnt; i++) {
        a = crng() * TWO_PI;
        spawnEnemy(crng() < 0.5 ? 'spore' : 'mold', e.x + Math.cos(a) * (e.r + 30), e.y + Math.sin(a) * (e.r + 30));
      }
    }
  }
  function updateEnemies(dt) {
    var n = E.length, px = P.x, py = P.y, i, e, dx, dy, d2, d, sp, k, mv, sx, sy, nearD2 = 1e18;
    var rooted = P.rooted, slowR = C.rootSlowR * S.area, slowR2 = slowR * slowR;
    var rs = S.rootSlow > 0.8 ? 0.8 : S.rootSlow, burnDps = S.burnDps;
    for (i = 0; i < n; i++) {
      e = E[i];
      if (e.dead) continue;
      if (e.hit > 0) { e.hit -= dt; if (e.hit < 0) e.hit = 0; }
      if (e.orbitCd > 0) e.orbitCd -= dt;
      if (e.burn > 0) {
        e.burn -= dt;
        if (burnDps > 0) { e.hp -= burnDps * dt; if (e.hp <= 0) { kill(e, null); continue; } }
      }
      dx = px - e.x; dy = py - e.y; d2 = dx * dx + dy * dy; d = Math.sqrt(d2);
      if (d < 0.001) d = 0.001;
      e.slow = (rooted && d2 < slowR2) ? rs : 0;
      sp = e.speed * (1 - e.slow);
      k = e.kind;
      if (k === 'spitter') {
        e.cd -= dt;
        if (e.cd <= 0 && d < C.spitRange) {
          e.cd = C.spitEvery + crng() * 0.6;
          addHazard(e.x, e.y, dx / d * C.spitSpeed, dy / d * C.spitSpeed, C.spitR, e.dmg, C.spitLife, false, false, 0);
        }
        mv = 0; sx = 0;
        if (d > C.spitHold + 30) mv = sp;
        else if (d < C.spitHold - 30) mv = -sp * 0.7;
        else sx = sp * 0.4 * ((e.id & 1) ? 1 : -1);
        e.x += dx / d * mv * dt - dy / d * sx * dt;
        e.y += dy / d * mv * dt + dx / d * sx * dt;
      } else {
        if (k === 'core') coreAI(e, dt, d);
        else if (k === 'mother') motherAI(e, dt);
        if (d > 1) { e.x += dx / d * sp * dt; e.y += dy / d * sp * dt; }
      }
      e.x = clampB(e.x); e.y = clampB(e.y);
      if (d2 < nearD2) nearD2 = d2;
    }
    if (moveDist > 0 && nearD2 < C.windNearR * C.windNearR) OG.tree.track('wind', moveDist);
  }
  function separate(dt) {
    var n = E.length, i, e, o, cx, cy, j, dx, dy, d, d2, md, ov, w, sx, sy, cnt, scan, k, xx, yy, par = tick & 1;
    for (i = par; i < n; i += 2) {
      e = E[i];
      if (e.dead || e.boss) continue;
      cx = cellOf(e.x); cy = cellOf(e.y); sx = 0; sy = 0; cnt = 0; scan = 0;
      for (yy = cy - 1; yy <= cy + 1; yy++) {
        if (yy < 0 || yy >= GW) continue;
        for (xx = cx - 1; xx <= cx + 1; xx++) {
          if (xx < 0 || xx >= GW) continue;
          for (j = head[yy * GW + xx]; j >= 0 && cnt < C.sepNeighbors && scan < C.sepScan; j = nxt[j]) {
            scan++;
            if (j === i) continue;
            o = E[j];
            dx = e.x - o.x; dy = e.y - o.y; md = e.r + o.r; d2 = dx * dx + dy * dy;
            if (d2 >= md * md) continue;
            cnt++;
            d = Math.sqrt(d2);
            if (d < 0.01) { dx = ((e.id * 37) % 11) - 5 + 0.5; dy = ((e.id * 53) % 13) - 6 + 0.5; d = Math.sqrt(dx * dx + dy * dy); }
            ov = (md - d) / md; w = o.r / (e.r + o.r) * 2;
            sx += dx / d * ov * w; sy += dy / d * ov * w;
          }
        }
      }
      if (cnt) {
        k = C.sepSpeed * dt * 2;
        e.x = clampB(e.x + sx * k); e.y = clampB(e.y + sy * k);
      }
    }
  }
  function contact(dt) {
    var n = E.length, i, e, dx, dy, m, any = false;
    for (i = 0; i < n; i++) {
      e = E[i];
      if (e.dead) { e.touch = false; continue; }
      dx = e.x - P.x; dy = e.y - P.y; m = P.r + e.r * 0.9;
      if (dx * dx + dy * dy < m * m) { e.touch = true; any = true; hurtPlayer(e.dmg); }
      else e.touch = false;
    }
    thornT += dt;
    if (thornT >= C.thornEvery) {
      thornT -= C.thornEvery;
      if (any && S.thorns > 0) {
        for (i = 0; i < n; i++) {
          e = E[i];
          if (!e.dead && e.touch) dealDamage(e, S.thorns * C.thornEvery, false, false, null);
        }
      }
    }
  }

  // ---- weapons ----
  function findNearest(x, y, range) {
    var n = E.length, i, e, dx, dy, d2, b2 = range * range, best = null;
    for (i = 0; i < n; i++) {
      e = E[i];
      if (e.dead) continue;
      dx = e.x - x; dy = e.y - y; d2 = dx * dx + dy * dy;
      if (d2 < b2) { b2 = d2; best = e; }
    }
    return best;
  }
  function fireSeeds(tgt) {
    var n = Math.floor(S.projCount); if (n < 1) n = 1;
    var a0 = Math.atan2(tgt.y - P.y, tgt.x - P.x), i, a, ch = Math.floor(S.chain), pr = Math.floor(S.pierce);
    for (i = 0; i < n; i++) {
      if (PJ.length >= C.projMax) break;
      a = a0 + (i - (n - 1) / 2) * S.spread;
      addProjectile(P.x, P.y, Math.cos(a) * S.projSpeed, Math.sin(a) * S.projSpeed, S.dmg, pr, ch, 0, C.projLife);
    }
    if (run.time - shootEmitT >= 1 / C.shootEventRate - 1e-6) {
      shootEmitT = run.time; evShoot.x = P.x; evShoot.y = P.y; emit('player:shoot', evShoot);
    }
  }
  function updateShooting(dt) {
    if (S.fireRate <= 0) return;
    var interval = 1 / S.fireRate, guard = 0, tgt;
    fireT += dt;
    if (fireT < interval) return;
    tgt = findNearest(P.x, P.y, C.targetRange);
    if (!tgt) { fireT = interval; return; }
    while (fireT >= interval && guard++ < 4) { fireT -= interval; fireSeeds(tgt); }
    if (fireT > interval) fireT = interval;
  }
  function hasHit(p, id) {
    var h = p.hits, i;
    for (i = 0; i < h.length; i++) if (h[i] === id) return true;
    return false;
  }
  function chainTarget(p, from) {
    var n = query(from.x, from.y, C.chainRange, qb), j, e, dx, dy, d2, bd = 1e18, best = null;
    for (j = 0; j < n; j++) {
      e = E[qb[j]];
      if (e.dead || hasHit(p, e.id)) continue;
      dx = e.x - from.x; dy = e.y - from.y; d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = e; }
    }
    return best;
  }
  function updateProjectiles(dt) {
    var i, j, n, p, e, remove, crit, dmg, nt, dx, dy, d, sp, cc = S.crit, cm = S.critMul, lim = B + 100;
    for (i = PJ.length - 1; i >= 0; i--) {
      p = PJ[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      remove = p.life <= 0 || p.x < -lim || p.x > lim || p.y < -lim || p.y > lim;
      if (!remove) {
        n = query(p.x, p.y, p.r, qa);
        for (j = 0; j < n; j++) {
          e = E[qa[j]];
          if (e.dead || hasHit(p, e.id)) continue;
          crit = crng() < cc;
          dmg = crit ? p.dmg * cm : p.dmg;
          p.hits.push(e.id);
          dealDamage(e, dmg, crit, true, p);
          if (p.pierce > 0) { p.pierce--; continue; }
          if (p.chainLeft > 0) {
            nt = chainTarget(p, e);
            if (nt) {
              p.chainLeft--;
              dx = nt.x - p.x; dy = nt.y - p.y; d = Math.sqrt(dx * dx + dy * dy); if (d < 0.001) d = 0.001;
              sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
              p.vx = dx / d * sp; p.vy = dy / d * sp;
              if (p.life < 0.5) p.life = 0.5;
              break;
            }
          }
          remove = true; break;
        }
      }
      if (remove) { ppool.push(p); PJ[i] = PJ[PJ.length - 1]; PJ.pop(); }
    }
  }
  function updateOrbits(dt) {
    var n = Math.floor(S.orbitCount), i, j, k, o, e, a, rad, pr;
    if (n < 0) n = 0;
    while (OR.length < n) OR.push({ x: 0, y: 0, r: 0 });
    if (OR.length > n) OR.length = n;
    if (n === 0) return;
    orbitAng += C.orbitSpin * dt;
    rad = S.orbitRadius * S.area; pr = C.petalR * S.area;
    for (i = 0; i < n; i++) {
      o = OR[i];
      a = orbitAng + i * TWO_PI / n;
      o.x = P.x + Math.cos(a) * rad; o.y = P.y + Math.sin(a) * rad; o.r = pr;
      if (S.orbitDmg > 0) {
        k = query(o.x, o.y, o.r, qa);
        for (j = 0; j < k; j++) {
          e = E[qa[j]];
          if (e.dead || e.orbitCd > 0) continue;
          e.orbitCd = C.orbitHitCd;
          dealDamage(e, S.orbitDmg, false, false, null);
        }
      }
    }
  }
  function updateNova(dt) {
    if (!(S.novaCd > 0 && S.novaDmg > 0)) { novaT = 0; return; }
    novaT += dt;
    if (novaT < S.novaCd) return;
    novaT = 0;
    var rad = C.novaRadius * S.area, n = query(P.x, P.y, rad, qa), j, e;
    for (j = 0; j < n; j++) { e = E[qa[j]]; if (!e.dead) dealDamage(e, S.novaDmg, false, false, null); }
    evNova.x = P.x; evNova.y = P.y; evNova.r = rad; emit('fx:nova', evNova);
  }
  function updateTrails(dt) {
    var i, j, n, t, e, dmg = S.trailDmg * dt;
    for (i = TR.length - 1; i >= 0; i--) {
      t = TR[i];
      t.life -= dt;
      if (t.life <= 0) { tpool.push(t); TR[i] = TR[TR.length - 1]; TR.pop(); continue; }
      if (dmg > 0) {
        n = query(t.x, t.y, t.r, qa);
        for (j = 0; j < n; j++) {
          e = E[qa[j]];
          if (e.dead) continue;
          e.hp -= dmg;
          if (e.hp <= 0) kill(e, null);
        }
      }
    }
  }

  // ---- hazards & pickups ----
  function updateHazards(dt) {
    var i, h, dx, dy, m, lim = B + 100;
    for (i = HZ.length - 1; i >= 0; i--) {
      h = HZ[i];
      if (h.telegraph) {
        h.life -= dt;
        if (h.life <= 0) { h.telegraph = false; h.life = C.slamActive; h.dmg = h.next; }
        continue;
      }
      h.x += h.vx * dt; h.y += h.vy * dt; h.life -= dt;
      if (h.life <= 0 || h.x < -lim || h.x > lim || h.y < -lim || h.y > lim) {
        hpool.push(h); HZ[i] = HZ[HZ.length - 1]; HZ.pop(); continue;
      }
      dx = P.x - h.x; dy = P.y - h.y; m = h.r + P.r * 0.8;
      if (dx * dx + dy * dy < m * m && hurtPlayer(h.dmg) && !h.zone) {
        hpool.push(h); HZ[i] = HZ[HZ.length - 1]; HZ.pop();
      }
    }
  }
  function mergeOrbs() {
    var cell = 96, pass = 0, i, k, cx, cy, ci, t, a, b, inv;
    while (xpCount > C.orbMax && pass < 4) {
      mergeGen++; inv = 1 / cell;
      for (i = PK.length - 1; i >= 0; i--) {
        k = PK[i];
        if (k.kind !== 'xp' || k.pull) continue;
        cx = ((k.x + OFF) * inv) | 0; cy = ((k.y + OFF) * inv) | 0;
        if (cx < 0) cx = 0; else if (cx >= MG) cx = MG - 1;
        if (cy < 0) cy = 0; else if (cy >= MG) cy = MG - 1;
        ci = cy * MG + cx;
        if (mergeStamp[ci] === mergeGen) {
          t = mergeRef[ci]; a = t.amount; b = k.amount;
          t.x = (t.x * a + k.x * b) / (a + b); t.y = (t.y * a + k.y * b) / (a + b);
          t.amount = a + b;
          kpool.push(k); PK[i] = PK[PK.length - 1]; PK.pop(); xpCount--;
        } else { mergeStamp[ci] = mergeGen; mergeRef[ci] = k; }
      }
      cell *= 2; pass++;
    }
  }
  function updatePickups(dt) {
    var i, k, dx, dy, d2, d, step, amt, healed, leechAcc = 0, px = P.x, py = P.y;
    var mag2 = S.magnet * S.magnet, take = P.r + C.pickupR, take2 = take * take;
    xpCount = 0;
    for (i = PK.length - 1; i >= 0; i--) {
      k = PK[i];
      dx = px - k.x; dy = py - k.y; d2 = dx * dx + dy * dy;
      if (k.kind === 'xp') {
        if (!k.pull && d2 < mag2) { k.pull = true; k.sp = C.pullStart; }
        if (k.pull) {
          k.sp += C.pullAccel * dt; if (k.sp > C.pullMax) k.sp = C.pullMax;
          d = Math.sqrt(d2); step = k.sp * dt;
          if (step >= d) { k.x = px; k.y = py; d2 = 0; }
          else { k.x += dx / d * step; k.y += dy / d * step; d2 = (d - step) * (d - step); }
        }
        if (d2 < take2) {
          amt = k.amount * S.xpMul;
          OG.tree.addXp(amt); OG.tree.track('root', amt);
          evXp.amount = amt; evXp.x = k.x; evXp.y = k.y; emit('xp:pickup', evXp);
          if (S.leech > 0 && P.hp > 0 && P.hp < P.maxHp) {
            healed = Math.min(S.leech, P.maxHp - P.hp); P.hp += healed; leechAcc += healed;
          }
          kpool.push(k); PK[i] = PK[PK.length - 1]; PK.pop();
          continue;
        }
        xpCount++;
      } else if (d2 < take2 && P.hp > 0 && P.hp < P.maxHp) {
        healed = Math.min(k.amount, P.maxHp - P.hp); P.hp += healed;
        evHeal.amount = healed; emit('player:heal', evHeal);
        kpool.push(k); PK[i] = PK[PK.length - 1]; PK.pop();
      }
    }
    if (leechAcc > 0) { evHeal.amount = leechAcc; emit('player:heal', evHeal); }
    mergeCd -= dt;
    if (xpCount > C.orbMax && mergeCd <= 0) { mergeCd = C.mergeEvery; mergeOrbs(); }
  }

  function sweep() {
    var i, e;
    for (i = E.length - 1; i >= 0; i--) {
      e = E[i];
      if (e.dead) { E[i] = E[E.length - 1]; E.pop(); epool.push(e); }
    }
  }
  function deathCheck() {
    if (P.hp <= 0) {
      if (!deadSent) {
        deadSent = true; P.hp = 0;
        emit('player:dead', null);
        if (P.hp > 0) deadSent = false;
      }
    } else {
      deadSent = false;
      if (P.hp > P.maxHp) P.hp = P.maxHp;
    }
  }

  // ---- public ----
  function reset() {
    bind(); ensureStats();
    var i;
    for (i = 0; i < E.length; i++) epool.push(E[i]); E.length = 0;
    for (i = 0; i < PJ.length; i++) ppool.push(PJ[i]); PJ.length = 0;
    for (i = 0; i < HZ.length; i++) hpool.push(HZ[i]); HZ.length = 0;
    for (i = 0; i < TR.length; i++) tpool.push(TR[i]); TR.length = 0;
    for (i = 0; i < PK.length; i++) kpool.push(PK[i]); PK.length = 0;
    OR.length = 0;
    liveCount = 0; nextId = 0; tick = 0; bossIdx = 0; motherAlive = false; motherPhase = 0;
    spawnAcc = 0; fireT = 0; novaT = 0; thornT = 0; trailT = 0; orbitAng = 0; shootEmitT = -1; mergeCd = 0;
    deadSent = false; dashT = 0; dashDx = 1; dashDy = 0; lastDx = 1; lastDy = 0; moveDist = 0; xpCount = 0;
    P.x = 0; P.y = 0; P.vx = 0; P.vy = 0; P.r = 14;
    P.maxHp = S.maxHp; P.hp = P.maxHp; lastMaxHp = S.maxHp;
    P.invuln = 0; P.dashCd = 0; P.dashing = false; P.still = 0; P.rooted = false;
    run.time = 0; run.kills = 0; run.light = 0;
    var seed = run.seed;
    if (typeof seed !== 'number') seed = OG.hashSeed ? OG.hashSeed(String(seed)) : 1;
    crng = OG.rng ? OG.rng((seed ^ 0x9E3779B9) >>> 0) : Math.random;
    fallbackRand = OG.rng ? OG.rng(seed >>> 0) : Math.random;
  }
  function update(dt) {
    bind(); ensureStats();
    if (run.over) return;
    if (deadSent && P.hp <= 0) return;
    tick++;
    relaxOn = !!(st.meta && st.meta.settings && st.meta.settings.relax);
    run.time += dt;
    updatePlayer(dt);
    updateSpawner(dt);
    updateEnemies(dt);
    buildHash();
    separate(dt);
    contact(dt);
    updateShooting(dt);
    updateProjectiles(dt);
    updateOrbits(dt);
    updateNova(dt);
    updateTrails(dt);
    updateHazards(dt);
    updatePickups(dt);
    sweep();
    deathCheck();
  }

  dbg.spawnEnemy = function (kind, x, y) { bind(); return spawnEnemy(kind, x, y); };
  dbg.addProjectile = function (x, y, vx, vy, dmg, pierce, chain, gen, life) { bind(); return addProjectile(x, y, vx, vy, dmg, pierce, chain, gen, life); };
  dbg.addPickup = function (x, y, amount, kind) { bind(); return addPickup(x, y, amount, kind); };
  dbg.dealDamage = function (e, dmg) { bind(); dealDamage(e, dmg, false, false, null); };
  dbg.live = function () { return liveCount; };

  OG.world = { reset: reset, update: update, debug: dbg };
  if (OG.game && OG.game.addUpdate) OG.game.addUpdate(update, 10);
})(window.OG = window.OG || {});
