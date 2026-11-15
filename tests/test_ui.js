/* tests/test_ui.js — behaviour tests for js/ui.js against the mock OG layer (tests/mock.js).
 * Needs Playwright + Chromium:  node tests/test_ui.js    (exit 0 = pass) */
'use strict';
const path = require('path'), cp = require('child_process');
let pw;
try { pw = require('playwright'); } catch (e) { pw = require(path.join(cp.execSync('npm root -g').toString().trim(), 'playwright')); }
const URL = 'file://' + path.resolve(__dirname, 'harness.html');
let fails = 0, passes = 0;
function ok(c, m) { if (c) passes++; else { fails++; console.log('  FAIL: ' + m); } }
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await pw.chromium.launch();
  async function fresh(q, opts) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1024, height: 768 }, permissions: ['clipboard-read', 'clipboard-write'] }, opts || {}));
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.goto(URL + (q || '?screen=title')); await page.waitForTimeout(500); page.errs = errs; return page;
  }
  const vis = (p, sel) => p.$eval(sel, e => !e.hidden && e.getClientRects().length > 0).catch(() => false);

  console.log('title / navigation');
  let p = await fresh();
  ok(await vis(p, '#scr-title'), 'title visible');
  ok(/Hạt Giống Hôm Nay #318/.test(await p.textContent('.menu__daily')), 'daily button shows #n');
  ok(/05:57/.test(await p.textContent('#t-dbest')), 'best today shown');
  ok(await p.textContent('#t-roots') === '1,2 N', 'roots count via OG.fmt');
  ok(await p.evaluate(() => window.__unlock > 0) === false, 'audio not unlocked before gesture');
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
  ok(await p.evaluate(() => document.activeElement.getAttribute('data-act')) === 'roots', 'arrow keys move focus in menu');
  await p.evaluate(() => { window.__ev = []; ['ui:click', 'ui:hover'].forEach(n => OG.bus.on(n, d => window.__ev.push(n))); });
  await p.click('[data-act=settings]');
  ok(await p.evaluate(() => window.__unlock >= 1), 'audio.unlock on first gesture');
  ok((await p.evaluate(() => window.__ev)).includes('ui:click'), 'ui:click emitted');
  ok(await vis(p, '#scr-settings'), 'settings opens');
  await p.keyboard.press('Escape');
  ok(!(await vis(p, '#scr-settings')) && await vis(p, '#scr-title'), 'Esc closes settings back to title');
  await p.click('[data-act=codex]');
  ok((await p.textContent('#c-count')) === '2/12', 'codex counter 2/12');
  const cards = await p.$$eval('#c-grid .cx', a => a.map(e => e.textContent));
  ok(cards.length === 9, 'secret unfound synergies hidden (9 of 12 shown), got ' + cards.length);
  ok(cards.filter(t => t.includes('???')).length === 7, 'unfound show ???');
  ok(cards.some(t => t.includes('Rừng Cháy')), 'found shows name');
  ok(await p.$$eval('#c-grid .cx--hidden, #c-grid .cx:not(.cx--found) .stamp', a => a.length) >= 14, 'unfound show two stamps each');
  await p.keyboard.press('Escape');
  ok(p.errs.length === 0, 'no page errors: ' + p.errs.join('|'));

  console.log('settings persist');
  await p.click('[data-act=settings]');
  await p.click('label[for=s-cb]'); await p.click('label[for=s-shake]'); await p.click('label[for=s-relax]'); await p.click('label[for=s-sound]');
  await p.$eval('#s-vol', e => { e.value = 35; e.dispatchEvent(new Event('input', { bubbles: true })); });
  let s = await p.evaluate(() => OG.state.meta.settings);
  ok(s.colorblind === true && s.shake === false && s.relax === true && s.mute === true && Math.abs(s.volume - .35) < 1e-6, 'settings object updated ' + JSON.stringify(s));
  ok(await p.evaluate(() => document.documentElement.classList.contains('cb')), 'colorblind class on <html>');
  ok(await p.evaluate(() => window.__muted === true && Math.abs(window.__vol - .35) < 1e-6), 'audio.setMuted/setVolume called');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('overgrow.v1')).settings);
  ok(saved.colorblind === true && saved.mute === true, 'written to localStorage');
  await p.reload(); await p.waitForTimeout(400);
  await p.click('[data-act=settings]');
  ok(await p.$eval('#s-cb', e => e.checked) && !(await p.$eval('#s-sound', e => e.checked)) && !(await p.$eval('#s-shake', e => e.checked)), 'settings restored after reload');
  ok(await p.$eval('#s-vol', e => e.value) === '35', 'volume restored');
  console.log('wipe data');
  await p.click('[data-act=wipe]');
  ok(await vis(p, '#scr-confirm'), 'confirm screen shown (no window.confirm)');
  await p.click('#k-no'); ok(!(await vis(p, '#scr-confirm')), 'cancel closes confirm');
  ok(await p.evaluate(() => !!localStorage.getItem('overgrow.v1')), 'data kept after cancel');
  await p.click('[data-act=wipe]'); await p.click('#k-yes'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => !localStorage.getItem('overgrow.v1') || JSON.parse(localStorage.getItem('overgrow.v1')).roots === 1240), 'wipe removes saved key (mock re-seeds fresh state after reload)');
  await p.context().close();

  console.log('roots');
  p = await fresh('?screen=roots'); await p.waitForTimeout(300);
  ok(await vis(p, '#scr-roots'), 'roots open');
  const btns = await p.$$eval('[data-buy]', a => a.map(b => ({ d: b.disabled, t: b.textContent })));
  ok(btns.length === 9, '9 upgrades listed');
  ok(btns.some(b => /Đã đầy/.test(b.t) === false), 'costs shown');
  const before = await p.evaluate(() => OG.state.meta.roots);
  await p.click('[data-buy=u0]');
  const after = await p.evaluate(() => [OG.state.meta.roots, OG.state.meta.upgrades.u0]);
  ok(after[0] === before - 40 && after[1] === 1, 'buy() called and rank rose');
  ok((await p.textContent('#r-bank')) === (await p.evaluate(() => OG.fmt(OG.state.meta.roots))), 'bank updated');
  await p.evaluate(() => { OG.state.meta.roots = 5; OG.bus.emit('roots:change', { roots: 5 }); });
  ok(await p.$eval('[data-buy=u1]', b => b.disabled), 'disabled when unaffordable');
  await p.evaluate(() => { OG.state.meta.upgrades.u3 = 1; OG.state.meta.roots = 9999; OG.bus.emit('roots:change', {}); });
  ok(await p.$eval('[data-buy=u3]', b => b.disabled && /Đã đầy/.test(b.textContent)), 'disabled when maxed');
  ok(p.errs.length === 0, 'no page errors: ' + p.errs.join('|'));
  await p.context().close();

  console.log('level up');
  p = await fresh('?screen=hud&fresh=1'); await p.waitForTimeout(300);
  ok(await vis(p, '#hud'), 'hud visible during run');
  ok(await vis(p, '.hint'), 'first run shows move hint');
  ok((await p.textContent('.hint')).includes('tự động bắn'), 'hint text');
  ok(await p.evaluate(() => OG.state.meta.settings.hints.move === true), 'hint flag stored');
  await p.evaluate(() => { OG.bus.emit('levelup:offer', { options: window.__o = [
    { id: 'fire1', name: 'Hạt Lửa', desc: 'd', branch: 'fire', rank: 0, maxRank: 5, isNew: true, synergyHint: 'gần cộng hưởng' },
    { id: 'wind1', name: 'Gió Cuốn', desc: 'd', branch: 'wind', rank: 1, maxRank: 4, isNew: false, synergyHint: '' },
    { id: 'root1', name: 'Rễ Bám', desc: 'd', branch: 'root', rank: 0, maxRank: 5, isNew: true, synergyHint: '' }] });
    OG.game.setState('levelup'); window.__ch = []; const orig = OG.tree.choose; OG.tree.choose = id => { window.__ch.push(id); orig(id); }; });
  ok(await vis(p, '#scr-levelup'), 'levelup visible');
  ok(await p.$$eval('.skill', a => a.length) === 3, '3 cards');
  ok((await p.textContent('#lv-note')).includes('Cây mọc theo cách cậu chơi'), 'first level-up teaching note');
  ok(await p.$eval('.skill', e => e.textContent.includes('Mới')), 'MỚI tag on new');
  ok(await p.$eval('.skill', e => !!e.querySelector('.skill__syn')), 'synergyHint highlighted');
  await p.click('.skill[data-i="1"]', { force: true });         // inside the 0.35 s lock
  ok((await p.evaluate(() => window.__ch)).length === 0, 'click inside 0.35 s lock ignored');
  await p.keyboard.press('2');
  ok((await p.evaluate(() => window.__ch)).length === 0, 'key inside lock ignored');
  await wait(450);
  await p.click('.skill[data-i="1"]');
  ok(JSON.stringify(await p.evaluate(() => window.__ch)) === '["wind1"]', 'choose() called with the clicked card id');
  ok(await p.evaluate(() => OG.game.state) === 'run' && !(await vis(p, '#scr-levelup')), 'back to run');
  // queue: two offers, keyboard pick, no premature run
  await p.evaluate(() => { OG.bus.emit('levelup:offer', { options: window.__o }); OG.bus.emit('levelup:offer', { options: window.__o.slice(0, 2) }); OG.game.setState('levelup'); });
  ok(!(await p.textContent('#lv-note')).includes('Cây mọc theo cách cậu chơi'), 'teaching note only once');
  await wait(450); await p.keyboard.press('3');
  ok(JSON.stringify(await p.evaluate(() => window.__ch)) === '["wind1","root1"]', 'key 3 picks third card');
  ok(await p.evaluate(() => OG.game.state) === 'levelup' && await p.$$eval('.skill', a => a.length) === 2, 'queued second offer shown next');
  await wait(450);
  // reroll
  await p.evaluate(() => { OG.state.run.rerolls = 2; });
  await p.click('#lv-reroll');
  ok(await p.evaluate(() => OG.state.run.rerolls) === 1, 'reroll() called, count drops');
  ok(await p.$$eval('.skill', a => a.length) === 4, 'reroll replaced the cards with the new offer, not queued');
  ok((await p.textContent('#lv-rr')) === '1', 'reroll count shown');
  await wait(300); await p.keyboard.press('1');
  ok(await p.evaluate(() => OG.game.state) === 'run', 'run resumes after last pick');
  ok(p.errs.length === 0, 'no page errors: ' + p.errs.join('|'));
  await p.context().close();

  console.log('touch: dash, joystick, hint dismiss');
  p = await fresh('?screen=hud', { hasTouch: true, isMobile: true, viewport: { width: 390, height: 780 } });
  ok(await p.$eval('#h-dash', e => getComputedStyle(e).display !== 'none'), 'dash button visible on touch');
  ok(await p.$eval('#h-dash', e => e.classList.contains('ui-block')) && await p.$eval('#h-pause', e => e.classList.contains('ui-block')), 'touch buttons are .ui-block');
  await p.$eval('#h-dash', e => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' })));
  ok(await p.evaluate(() => window.__dash) === 1, 'dash press -> OG.input.pressDash()');
  ok(await p.$eval('#h-joy', e => e.classList.contains('on')), 'joystick drawn from OG.input.stick');
  const ring = await p.$eval('#h-ring', e => parseFloat(e.style.strokeDashoffset)); ok(ring > 0 && ring < 238, 'cooldown ring partially filled: ' + ring);
  await p.tap('#h-pause'); ok(await p.evaluate(() => OG.game.state) === 'paused' && await vis(p, '#scr-pause'), 'pause button pauses and shows pause screen');
  await p.click('[data-act=resume]'); ok(await p.evaluate(() => OG.game.state) === 'run', 'resume');
  await p.context().close();

  console.log('synergy toast');
  p = await fresh('?screen=hud&toast=1&seen=1'); await p.waitForTimeout(900);
  ok(await vis(p, '.toast'), 'toast shown');
  const tt = await p.textContent('.toast');
  ok(tt.includes('Cộng hưởng: Rừng Cháy!') && tt.includes('Khám phá đầu tiên'), 'toast text + first tag');
  await p.waitForTimeout(3300); ok(!(await vis(p, '.toast')), 'toast gone after ~2.5 s');
  await p.context().close();

  console.log('winter');
  p = await fresh('?screen=winter'); await p.waitForTimeout(2500);
  ok(await vis(p, '#scr-winter'), 'winter visible');
  ok((await p.textContent('#w-title')).startsWith('Mùa Đông'), 'title Mùa Đông');
  ok(await p.evaluate(() => window.__shed >= 1), 'treeview.shed() called');
  ok(await vis(p, '#w-rec'), 'Kỷ lục mới! shown');
  ok(await p.textContent('#w-time') === '04:07' && await p.textContent('#w-lv') === '8' && await p.textContent('#w-roots') === '+57', 'stats counted up: ' + await p.textContent('#w-time'));
  ok(!(await vis(p, '#w-share')), 'share hidden for non-daily');
  ok(!(await vis(p, '#w-clear')), 'no clear note on death');
  await p.click('#scr-winter [data-act=roots]'); ok(await vis(p, '#scr-roots'), 'roots from winter'); await p.keyboard.press('Escape');
  const dl = p.waitForEvent('download', { timeout: 3000 }).catch(() => null);
  await p.click('#scr-winter [data-act=photo]'); const d = await dl;
  ok(!!d && /\.png$/.test(d.suggestedFilename()), 'Lưu ảnh cây downloads a png');
  await p.context().close();
  p = await fresh('?screen=winter-daily'); await p.waitForTimeout(2500);
  ok(await vis(p, '#w-share'), 'share shown for daily');
  await p.evaluate(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); });
  await p.click('#w-share'); await p.waitForTimeout(200);
  ok((await p.textContent('#w-share-t')) === 'Đã chép!', 'clipboard fallback says Đã chép!');
  ok((await p.evaluate(() => navigator.clipboard.readText())).includes('Overgrow #318'), 'clipboard has share text');
  await p.context().close();
  p = await fresh('?screen=winter-clear'); await p.waitForTimeout(2200);
  ok((await p.textContent('#w-title')).startsWith('Khu Vườn đã nở hoa'), 'clear title');
  ok((await p.textContent('#w-clear')).includes('Màn 2: Khu Rừng — đang mọc...'), 'act 2 teaser');
  await p.click('#scr-winter [data-act=again]'); await p.waitForTimeout(200);
  ok(await p.evaluate(() => OG.game.state) === 'run' && await vis(p, '#hud'), 'Gieo mùa mới starts a run');
  await p.context().close();

  console.log('offline');
  p = await fresh('?screen=offline'); await p.waitForTimeout(300);
  ok(await vis(p, '#scr-offline'), 'offline dialog on title');
  const ot = await p.textContent('#scr-offline');
  ok(ot.includes('Lúc cậu vắng nhà...') && ot.includes('3 giờ 13 phút') && ot.includes('+4,6 Tr') && ot.includes('+23'), 'offline text: ' + ot.replace(/\s+/g, ' ').slice(0, 120));
  await p.click('[data-act=offline-ok]'); ok(!(await vis(p, '#scr-offline')), 'offline closes');
  await p.context().close();

  console.log('pause quit');
  p = await fresh('?screen=pause'); await p.waitForTimeout(300);
  await p.click('[data-act=quit]'); ok(await vis(p, '#scr-confirm'), 'quit asks to confirm');
  await p.click('#k-yes'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => OG.game.state) === 'winter', 'quit ends the season via meta.endRun');
  await p.context().close();

  await browser.close();
  console.log(`\n${passes} passed, ${fails} failed`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
