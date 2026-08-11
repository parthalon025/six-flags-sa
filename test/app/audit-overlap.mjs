#!/usr/bin/env node
/**
 * UI overlap + usability audit.
 *
 * Walks major chrome states, detects intersecting interactive/chrome elements,
 * undersized tap targets, and off-screen clipping. Writes screenshots + a JSON
 * report under test/audit/.
 *
 *   npm start &
 *   CHROMIUM_PATH=/usr/local/bin/google-chrome node test/app/audit-overlap.mjs
 */
import { BASE, closeGate, dismissIntroSplash, dismissUpdateSplash, go, launch } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'test', 'audit');
fs.mkdirSync(OUT, { recursive: true });

const KI = { latitude: 39.34395, longitude: -84.2673 };
const VIEW = { width: 390, height: 844 };
const MIN_TAP = 40; // Apple HIG is 44; allow 40 for glass chips that are visually larger

const CHROME_SELECTORS = [
  '.wxChip',
  '.wxCard',
  '.topbarActions',
  '.topbarBrand',
  '.iconBtn',
  '.tape',
  '.filterBadge',
  '.navBanner',
  '.fabs',
  '.fab',
  '.zoomPad',
  '.zoomBtn',
  '.mapKey',
  '.mapKeyToggle',
  '.scaleBar',
  '.sheet',
  '.tabBar',
  '.navBar',
  '.routePreview',
  '.toast',
  '.gate',
  '.splash',
  '.intro',
  '.updateSplash',
  '.searchRow',
  '.grab',
  '.brand',
  '.glanceRail',
  '.glanceDigest',
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

function isAncestorPair(a, b) {
  return a.path.includes(b.path) || b.path.includes(a.path) || a.path.startsWith(b.path) || b.path.startsWith(a.path);
}

async function collectBoxes(page) {
  return page.evaluate((selectors) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out = [];
    const seen = new Set();

    const pathFor = (el) => {
      const parts = [];
      let n = el;
      while (n && n !== document.body) {
        let part = n.tagName.toLowerCase();
        if (n.id) part += `#${n.id}`;
        if (n.className && typeof n.className === 'string') {
          const cls = n.className.trim().split(/\s+/).slice(0, 4).join('.');
          if (cls) part += `.${cls}`;
        }
        parts.unshift(part);
        n = n.parentElement;
      }
      return parts.join('>');
    };

    const push = (el, kind) => {
      if (!el || seen.has(el)) return;
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      if (style.pointerEvents === 'none' && !el.classList.contains('scaleBar')) return;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      // Fully off-screen
      if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) return;
      seen.add(el);
      out.push({
        kind,
        tag: el.tagName.toLowerCase(),
        id: el.id || '',
        className: typeof el.className === 'string' ? el.className : '',
        aria: el.getAttribute('aria-label') || el.getAttribute('title') || '',
        text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        path: pathFor(el),
        z: style.zIndex,
        x: Math.round(r.x * 10) / 10,
        y: Math.round(r.y * 10) / 10,
        width: Math.round(r.width * 10) / 10,
        height: Math.round(r.height * 10) / 10,
        clippedTop: r.top < -1,
        clippedBottom: r.bottom > vh + 1,
        clippedLeft: r.left < -1,
        clippedRight: r.right > vw + 1,
      });
    };

    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => push(el, sel));
    }

    // Interactive controls not already covered
    document.querySelectorAll('button, a, input, [role="button"], [role="slider"], [role="tab"]').forEach((el) => {
      push(el, 'interactive');
    });

    return out;
  }, CHROME_SELECTORS);
}

function analyze(boxes) {
  const findings = [];

  // Prefer leaf chrome over containers when reporting overlaps between
  // a parent and its child (those are expected stacking, not bugs).
  const leaves = boxes.filter((b) => {
    // Drop pure containers when we also have their children in the set
    if (b.kind === '.fabs' || b.kind === '.zoomPad' || b.kind === '.topbarActions' || b.kind === '.sheet') {
      return false;
    }
    // Modal overlays intentionally cover the app chrome behind them.
    if (b.kind === '.gate' || b.kind === '.splash' || b.kind === '.intro' || b.kind === '.updateSplash') {
      return false;
    }
    return true;
  });

  const isOverlayChrome = (b) =>
    b.kind === '.gate' || b.path.includes('.gate') || b.path.includes('.splash') || b.path.includes('.updateSplash');

  for (let i = 0; i < leaves.length; i++) {
    for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i];
      const b = leaves[j];
      if (isAncestorPair(a, b)) continue;
      // Same interactive counted twice via chrome + interactive
      if (a.path === b.path) continue;
      if (isOverlayChrome(a) || isOverlayChrome(b)) continue;
      const hit = intersection(a, b);
      if (!hit) continue;
      const overlapArea = area(hit);
      const minArea = Math.min(area(a), area(b));
      const ratio = minArea ? overlapArea / minArea : 0;
      // Ignore tiny grazes (< 8% of smaller element, or < 80px²)
      if (overlapArea < 80 && ratio < 0.08) continue;
      if (ratio < 0.08) continue;

      // Sheet content overlapping sheet chrome is expected — skip same-sheet pairs
      const aSheet = a.path.includes('.sheet');
      const bSheet = b.path.includes('.sheet');
      if (aSheet && bSheet) continue;

      // Legend rows scrolled inside .mapKeyBody still report full layout boxes;
      // overlaps with the sheet / toggle from clipped overflow are noise.
      const aKeyRow = a.path.includes('.mapKey') && a.kind === 'interactive';
      const bKeyRow = b.path.includes('.mapKey') && b.kind === 'interactive';
      if (aKeyRow || bKeyRow) {
        const other = aKeyRow ? b : a;
        if (
          other.path.includes('.sheet') ||
          other.kind === '.searchRow' ||
          other.kind === '.brand' ||
          other.kind === '.grab' ||
          other.kind === '.glanceRail' ||
          other.kind === '.mapKeyToggle' ||
          other.kind === '.scaleBar' ||
          other.kind === '.tabBar'
        ) {
          continue;
        }
      }

      findings.push({
        type: 'overlap',
        severity: ratio > 0.35 || overlapArea > 400 ? 'high' : 'medium',
        a: label(a),
        b: label(b),
        overlapPx: Math.round(overlapArea),
        ratio: Math.round(ratio * 100),
        box: hit,
      });
    }
  }

  for (const b of boxes) {
    if (b.kind !== 'interactive' && !b.kind.startsWith('.fab') && !b.kind.startsWith('.zoom') && b.kind !== '.iconBtn' && b.kind !== '.wxChip' && b.kind !== '.mapKeyToggle' && b.kind !== '.grab') {
      continue;
    }
    if (b.width > 0 && b.height > 0 && (b.width < MIN_TAP || b.height < MIN_TAP)) {
      // Text links inside lists are allowed to be shorter height if full row is tappable
      if (b.path.includes('.poiRow') || b.path.includes('.member') || b.path.includes('.tier')) continue;
      findings.push({
        type: 'tap-target',
        severity: 'medium',
        a: label(b),
        size: `${b.width}×${b.height}`,
      });
    }
    if (b.clippedTop || b.clippedBottom || b.clippedLeft || b.clippedRight) {
      findings.push({
        type: 'clipped',
        severity: 'medium',
        a: label(b),
        edges: [
          b.clippedTop && 'top',
          b.clippedBottom && 'bottom',
          b.clippedLeft && 'left',
          b.clippedRight && 'right',
        ].filter(Boolean),
      });
    }
  }

  return findings;
}

function label(b) {
  const name = b.aria || b.text || b.className.split(/\s+/).slice(0, 3).join('.') || b.kind;
  return `${b.kind} «${name.slice(0, 50)}» @(${b.x},${b.y} ${b.width}×${b.height})`;
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  shot  ${name}`);
}

async function auditState(page, name) {
  await page.waitForTimeout(500);
  await shot(page, name);
  const boxes = await collectBoxes(page);
  const findings = analyze(boxes);
  const high = findings.filter((f) => f.severity === 'high');
  const med = findings.filter((f) => f.severity !== 'high');
  console.log(`  audit ${name}: ${boxes.length} boxes, ${high.length} high, ${med.length} medium`);
  for (const f of high.slice(0, 12)) {
    if (f.type === 'overlap') console.log(`    HIGH overlap ${f.ratio}% (${f.overlapPx}px²): ${f.a}  ×  ${f.b}`);
    else console.log(`    HIGH ${f.type}: ${f.a} ${f.size || f.edges?.join(',') || ''}`);
  }
  for (const f of med.slice(0, 8)) {
    if (f.type === 'overlap') console.log(`    med  overlap ${f.ratio}%: ${f.a}  ×  ${f.b}`);
    else console.log(`    med  ${f.type}: ${f.a} ${f.size || f.edges?.join(',') || ''}`);
  }
  return { name, boxCount: boxes.length, findings, boxes };
}

async function sheetStop(page, stop) {
  for (let i = 0; i < 6; i++) {
    const cls = await page.locator('.sheet').evaluate((e) => e.className).catch(() => '');
    if (cls.includes(stop)) return;
    const grab = page.locator('.grab').or(page.getByRole('slider', { name: /Resize panel/ }));
    if (await grab.count()) await grab.first().click();
    await page.waitForTimeout(450);
  }
}

async function setTheme(page, theme) {
  const want = theme === 'day' ? 'daylight map' : 'night map';
  const btn = page.locator(`button[aria-label*="${want}"]`);
  if (await btn.count()) {
    await btn.click();
    await page.waitForTimeout(600);
  }
}

const browser = await launch();
const ctx = await browser.newContext({
  viewport: VIEW,
  deviceScaleFactor: 2,
  permissions: ['geolocation'],
  geolocation: KI,
  locale: 'en-US',
});
const page = await ctx.newPage();
const report = [];

console.log('\nUI overlap audit → test/audit/\n');

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
report.push(await auditState(page, '01-landing'));

await closeGate(page);
await page.waitForTimeout(1500);
report.push(await auditState(page, '02-map-peek'));

await setTheme(page, 'day');
report.push(await auditState(page, '03-map-day'));

await sheetStop(page, 'shut');
report.push(await auditState(page, '04-sheet-shut'));

await sheetStop(page, 'peek');
report.push(await auditState(page, '05-sheet-peek'));

await sheetStop(page, 'half');
report.push(await auditState(page, '06-sheet-half'));

await sheetStop(page, 'full');
report.push(await auditState(page, '07-sheet-full'));

await go(page, 'Party');
await page.waitForTimeout(700);
report.push(await auditState(page, '08-party'));

await go(page, 'Rider height');
await page.waitForTimeout(700);
report.push(await auditState(page, '09-rides'));

// Height filter badge over map
const tier = page.locator('.tier:has-text("46")').first();
if (await tier.count()) {
  await tier.click();
  await page.waitForTimeout(500);
}
await go(page, 'Explore');
await sheetStop(page, 'peek');
report.push(await auditState(page, '10-height-badge'));

await go(page, 'Me');
await page.waitForTimeout(700);
report.push(await auditState(page, '11-settings'));

await go(page, 'Explore');
await sheetStop(page, 'peek');
const wx = page.locator('.wxChip');
if (await wx.count()) {
  await wx.click();
  await page.waitForTimeout(500);
  report.push(await auditState(page, '12-weather-open'));
  await wx.click().catch(() => {});
  await page.waitForTimeout(400);
}

// Map key — only when the sheet leaves enough map visible
await sheetStop(page, 'peek');
const keyToggle = page.locator('.mapKeyToggle');
if (await keyToggle.count()) {
  await keyToggle.click();
  await page.waitForTimeout(500);
  report.push(await auditState(page, '13-map-key'));
  // Close before later flows so the open legend does not pollute them.
  await keyToggle.click();
  await page.waitForTimeout(400);
}

// Compass / bearing
const bearingBtn = page.locator('button[aria-label*="bearing"], button[aria-label*="north"]').first();
if (await bearingBtn.count()) {
  await bearingBtn.click();
  await page.waitForTimeout(700);
  report.push(await auditState(page, '14-compass-tape'));
}

// Search + route preview
await sheetStop(page, 'peek');
const search = page.locator('.field[aria-label="Search places"]');
if (await search.count()) {
  await search.fill('beast');
  await page.waitForTimeout(800);
  report.push(await auditState(page, '15-search'));
  await page.locator('.poiRow .poiMain').first().click().catch(() => {});
  await page.waitForTimeout(600);
  report.push(await auditState(page, '16-place-detail'));
  const walkBtn = page.locator('button:has-text("Go")').first();
  if (await walkBtn.count()) {
    await walkBtn.click();
    await page.waitForTimeout(2000);
    report.push(await auditState(page, '17-route-preview'));
  }
}

// Desktop / wide layout
const wide = await browser.newContext({
  viewport: { width: 1024, height: 768 },
  deviceScaleFactor: 1,
  permissions: ['geolocation'],
  geolocation: KI,
  locale: 'en-US',
});
const pageW = await wide.newPage();
await pageW.goto(BASE, { waitUntil: 'domcontentloaded' });
await closeGate(pageW);
await pageW.waitForTimeout(1500);
report.push(await auditState(pageW, '18-desktop'));

// Fresh visitor gate
const fresh = await browser.newContext({
  viewport: VIEW,
  deviceScaleFactor: 2,
  locale: 'en-US',
});
await fresh.addInitScript(() => {
  localStorage.removeItem('tracker-intro-seen');
  localStorage.removeItem('tracker-release-notes-seen');
});
const pageF = await fresh.newPage();
await pageF.goto(BASE, { waitUntil: 'domcontentloaded' });
await pageF.waitForTimeout(800);
report.push(await auditState(pageF, '19-intro'));
await dismissIntroSplash(pageF);
await pageF.waitForTimeout(500);
report.push(await auditState(pageF, '20-update-or-gate'));
await dismissUpdateSplash(pageF);
await pageF.waitForTimeout(500);
report.push(await auditState(pageF, '21-gps-gate'));

await browser.close();

const allFindings = report.flatMap((r) => r.findings.map((f) => ({ state: r.name, ...f })));
const high = allFindings.filter((f) => f.severity === 'high');
const medium = allFindings.filter((f) => f.severity !== 'high');

const summary = {
  generatedAt: new Date().toISOString(),
  viewport: VIEW,
  states: report.map((r) => ({
    name: r.name,
    boxCount: r.boxCount,
    high: r.findings.filter((f) => f.severity === 'high').length,
    medium: r.findings.filter((f) => f.severity !== 'high').length,
  })),
  high,
  medium,
  totals: { high: high.length, medium: medium.length, states: report.length },
};

fs.writeFileSync(path.join(OUT, 'overlap-report.json'), JSON.stringify(summary, null, 2));

console.log('\n' + '='.repeat(60));
console.log(`  States: ${report.length}`);
console.log(`  HIGH findings: ${high.length}`);
console.log(`  medium findings: ${medium.length}`);
console.log(`  Report: test/audit/overlap-report.json`);
console.log('='.repeat(60) + '\n');

if (high.length) process.exitCode = 1;
