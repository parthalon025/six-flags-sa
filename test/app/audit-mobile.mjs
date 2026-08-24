#!/usr/bin/env node
/**
 * Mobile-primary UI audit — multiple phone viewports + safe-area simulation.
 *
 *   npm start &
 *   CHROMIUM_PATH=/usr/local/bin/google-chrome node test/app/audit-mobile.mjs
 */
import { BASE, closeGate, go, launch } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'test', 'audit', 'mobile');
fs.mkdirSync(OUT, { recursive: true });

const KI = { latitude: 39.34395, longitude: -84.2673 };

const PHONES = [
  { id: 'iphone-se', width: 375, height: 667, dpr: 2, note: 'small phone' },
  { id: 'iphone-15', width: 390, height: 844, dpr: 3, note: 'primary', safeTop: 47, safeBot: 34 },
  { id: 'iphone-15-pro-max', width: 430, height: 932, dpr: 3, note: 'large phone', safeTop: 59, safeBot: 34 },
  { id: 'pixel-compact', width: 360, height: 780, dpr: 3, note: 'compact android' },
];

const CHROME = [
  '.wxChip', '.wxCard', '.iconBtn', '.tape', '.filterBadge', '.navBanner',
  '.fab', '.zoomBtn', '.mapKeyToggle', '.mapKeyBody', '.scaleBar',
  '.sheet', '.tabBar', '.navBar', '.routePreview', '.toast', '.grab',
  '.searchRow', '.brand', '.locateCard', '.locateGo',
];

function area(r) {
  return Math.max(0, r.width) * Math.max(0, r.height);
}
function intersection(a, b) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

async function collect(page) {
  return page.evaluate((selectors) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out = [];
    const seen = new Set();
    const pathFor = (el) => {
      const parts = [];
      let n = el;
      while (n && n.nodeType === 1 && n !== document.documentElement) {
        let p = n.tagName.toLowerCase();
        if (n.className && typeof n.className === 'string') {
          const cls = n.className.trim().split(/\s+/).slice(0, 3).join('.');
          if (cls) p += `.${cls}`;
        }
        parts.unshift(p);
        n = n.parentElement;
      }
      return parts.join('>');
    };
    const push = (el, kind) => {
      if (!el || seen.has(el)) return;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      // pointer-events:none still paints — count it for visual overlap unless it
      // is decorative map chrome that never receives taps (scale bar alone).
      if (style.pointerEvents === 'none' && Number(style.opacity) < 0.05) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return;
      seen.add(el);
      out.push({
        kind,
        className: typeof el.className === 'string' ? el.className : '',
        aria: el.getAttribute('aria-label') || '',
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 48),
        path: pathFor(el),
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
        clippedBottom: r.bottom > vh + 1,
        clippedRight: r.right > vw + 1,
        clippedTop: r.top < -1,
      });
    };
    for (const sel of selectors) document.querySelectorAll(sel).forEach((el) => push(el, sel));
    document.querySelectorAll('button, a, input, [role="button"], [role="slider"], [role="tab"]').forEach((el) => {
      push(el, 'interactive');
    });
    return { vw, vh, boxes: out };
  }, CHROME);
}

function label(b) {
  const name = b.aria || b.text || b.className.split(/\s+/).slice(0, 2).join('.') || b.kind;
  return `${b.kind} «${name.slice(0, 40)}» @(${b.x},${b.y} ${b.width}×${b.height})`;
}

function analyze(boxes) {
  const findings = [];
  const leaves = boxes.filter((b) => !['.sheet', '.fabs', '.zoomPad'].includes(b.kind));
  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i];
      const b = leaves[j];
      if (a.path === b.path) continue;
      if (a.path.includes(b.path) || b.path.includes(a.path)) continue;
      if (a.path.includes('.sheet') && b.path.includes('.sheet')) continue;
      // Legend rows scrolled out of the key body are layout noise.
      const aKey = a.path.includes('.mapKey') && a.kind === 'interactive';
      const bKey = b.path.includes('.mapKey') && b.kind === 'interactive';
      if (aKey || bKey) {
        const other = aKey ? b : a;
        if (
          other.path.includes('.sheet') ||
          ['.searchRow', '.brand', '.grab', '.locateCard', '.mapKeyToggle', '.scaleBar', '.tabBar'].includes(other.kind)
        ) continue;
      }
      const hit = intersection(a, b);
      if (!hit) continue;
      const overlapArea = area(hit);
      const minArea = Math.min(area(a), area(b));
      const ratio = minArea ? overlapArea / minArea : 0;
      if (overlapArea < 80 || ratio < 0.08) continue;
      findings.push({
        type: 'overlap',
        severity: ratio > 0.35 || overlapArea > 400 ? 'high' : 'medium',
        a: label(a),
        b: label(b),
        ratio: Math.round(ratio * 100),
        overlapPx: Math.round(overlapArea),
      });
    }
  }
  for (const b of boxes) {
    if (!['.fab', '.zoomBtn', '.iconBtn', '.wxChip', '.mapKeyToggle', 'interactive'].includes(b.kind) && b.kind !== '.grab') continue;
    if (b.path.includes('.poiRow') || b.path.includes('.tier') || b.path.includes('.chip')) continue;
    if (b.width > 0 && b.height > 0 && (b.width < 40 || b.height < 40)) {
      // Expanded hit targets (::after) are intentional for chips.
      if (b.kind === '.grab') continue;
      findings.push({ type: 'tap-target', severity: 'medium', a: label(b), size: `${b.width}×${b.height}` });
    }
    if (b.clippedBottom || b.clippedRight || b.clippedTop) {
      findings.push({
        type: 'clipped',
        severity: 'medium',
        a: label(b),
        edges: [b.clippedTop && 'top', b.clippedBottom && 'bottom', b.clippedRight && 'right'].filter(Boolean),
      });
    }
  }
  return findings;
}

async function sheetStop(page, stop) {
  for (let i = 0; i < 6; i++) {
    const cls = await page.locator('.sheet').evaluate((e) => e.className).catch(() => '');
    if (cls.includes(stop)) return true;
    const grab = page.locator('.grab').or(page.getByRole('slider', { name: /Resize panel/ }));
    if (await grab.count()) await grab.first().click();
    await page.waitForTimeout(450);
  }
  return false;
}

async function injectSafeArea(context, top = 0, bot = 0) {
  if (!top && !bot) return;
  await context.addInitScript(({ top, bot }) => {
    const style = document.createElement('style');
    style.textContent = `:root { --sat: ${top}px; --sab: ${bot}px; }
      html { --top: ${top}px; --bot: ${bot}px; }
      /* Override env() fallbacks used in globals.css */
      .app, .sheet, .tabBar, .topbar, .wxChip, .filterBadge, .navBanner, .navBar, .routePreview, .fabs, .zoomPad, .mapFurniture {
        /* vars already read --top/--bot from :root in this app */
      }`;
    document.documentElement.style.setProperty('--top', `${top}px`);
    document.documentElement.style.setProperty('--bot', `${bot}px`);
    document.documentElement.appendChild(style);
  }, { top, bot });
}

const browser = await launch();
const report = { phones: [], generatedAt: new Date().toISOString() };
let highTotal = 0;

console.log('\nMobile UI audit → test/audit/mobile/\n');

for (const phone of PHONES) {
  console.log(`\n=== ${phone.id} (${phone.width}×${phone.height}) — ${phone.note} ===`);
  const ctx = await browser.newContext({
    viewport: { width: phone.width, height: phone.height },
    deviceScaleFactor: phone.dpr,
    isMobile: true,
    hasTouch: true,
    permissions: ['geolocation'],
    geolocation: KI,
    locale: 'en-US',
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  await injectSafeArea(ctx, phone.safeTop || 0, phone.safeBot || 0);
  const page = await ctx.newPage();
  const phoneOut = path.join(OUT, phone.id);
  fs.mkdirSync(phoneOut, { recursive: true });
  const states = [];

  const run = async (name, setup) => {
    if (setup) await setup(page);
    await page.waitForTimeout(500);
    const file = path.join(phoneOut, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    const { boxes } = await collect(page);
    const findings = analyze(boxes);
    const high = findings.filter((f) => f.severity === 'high');
    const medium = findings.filter((f) => f.severity !== 'high');
    highTotal += high.length;
    console.log(`  ${name}: ${boxes.length} boxes, ${high.length} high, ${medium.length} med`);
    for (const f of high.slice(0, 8)) {
      console.log(`    HIGH ${f.type} ${f.ratio || ''}%: ${f.a} × ${f.b}`);
    }
    for (const f of medium.filter((x) => x.type === 'overlap').slice(0, 4)) {
      console.log(`    med overlap ${f.ratio}%: ${f.a} × ${f.b}`);
    }
    states.push({ name, high: high.length, medium: medium.length, findings: high.concat(medium.slice(0, 12)) });
  };

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await closeGate(page);
  await page.waitForTimeout(1500);

  await run('01-peek');
  await run('02-shut', async (p) => sheetStop(p, 'shut'));
  await run('03-peek', async (p) => sheetStop(p, 'peek'));
  await run('04-half', async (p) => sheetStop(p, 'half'));
  await run('05-party', async (p) => { await go(p, 'Party'); await p.waitForTimeout(600); });
  await run('06-plan', async (p) => {
    await go(p, 'Rider height');
    await p.waitForTimeout(500);
    const tier = p.locator('.tier:has-text("46")').first();
    if (await tier.count()) await tier.click();
    await p.waitForTimeout(400);
  });
  await run('07-explore-badge', async (p) => {
    await go(p, 'Explore');
    await sheetStop(p, 'peek');
  });
  await run('08-weather', async (p) => {
    const wx = p.locator('.wxChip');
    if (await wx.count()) {
      await wx.click();
      await p.waitForTimeout(500);
    }
  });
  await run('09-map-key', async (p) => {
    const wx = p.locator('.wxChip[aria-expanded="true"]');
    if (await wx.count()) await wx.click();
    await p.waitForTimeout(300);
    await sheetStop(p, 'peek');
    const key = p.locator('.mapKeyToggle');
    if (await key.count()) {
      await key.click();
      await p.waitForTimeout(500);
    }
  });
  await run('10-search-route', async (p) => {
    const key = p.locator('.mapKeyToggle[aria-expanded="true"]');
    if (await key.count()) await key.click();
    await sheetStop(p, 'peek');
    const search = p.locator('.field[aria-label="Search places"]');
    if (await search.count()) {
      await search.fill('beast');
      await p.waitForTimeout(700);
      await p.locator('.poiRow .poiMain').first().click().catch(() => {});
      await p.waitForTimeout(500);
      const walk = p.locator('button[aria-label="Walk me there"], button:has-text("Go")').first();
      if (await walk.count()) {
        await walk.click();
        await p.waitForTimeout(2000);
      }
    }
  });

  // Thumb-zone check: FABs and tab bar within reachable bands
  const thumb = await page.evaluate(() => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const fabs = [...document.querySelectorAll('.fab')].map((el) => {
      const r = el.getBoundingClientRect();
      return { y: r.y, bottom: vh - r.bottom, right: vw - r.right };
    });
    const tabs = document.querySelector('.tabBar')?.getBoundingClientRect();
    return {
      fabCount: fabs.length,
      fabsInLowerHalf: fabs.filter((f) => f.y > vh * 0.45).length,
      tabBottomGap: tabs ? Math.round(vh - tabs.bottom) : null,
      tabHeight: tabs ? Math.round(tabs.height) : null,
    };
  });
  console.log(`  thumb: fabs=${thumb.fabCount} lowerHalf=${thumb.fabsInLowerHalf} tabH=${thumb.tabHeight} botGap=${thumb.tabBottomGap}`);

  report.phones.push({ ...phone, states, thumb });
  await ctx.close();
}

await browser.close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...report, highTotal }, null, 2));
console.log(`\n${'='.repeat(60)}\n  Mobile audit done — HIGH total: ${highTotal}\n  Report: test/audit/mobile/report.json\n${'='.repeat(60)}\n`);
if (highTotal) process.exitCode = 1;
