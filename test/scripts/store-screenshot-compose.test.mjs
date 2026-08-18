#!/usr/bin/env node
/**
 * Store marketing-frame composition: HTML templating, headline/subhead
 * escaping, and exact iOS 6.7" pixels (1290×2796) — driven with a stubbed
 * Playwright page object so no browser is spun up (#474).
 *
 *   node test/scripts/store-screenshot-compose.test.mjs
 */
import assert from 'node:assert/strict';
import { IOS_MARKETING, composeMarketingFrame } from '../../scripts/lib/store-screenshot-compose.mjs';

assert.deepEqual(IOS_MARKETING, { width: 1290, height: 2796 }, 'Apple 6.7" display marketing size');

function makeStubPage(screenshotResult = Buffer.from('fake-png-bytes')) {
  const calls = { setViewportSize: [], setContent: [], waitForTimeout: [], screenshot: [] };
  const page = {
    async setViewportSize(size) {
      calls.setViewportSize.push(size);
    },
    async setContent(html, opts) {
      calls.setContent.push({ html, opts });
    },
    async waitForTimeout(ms) {
      calls.waitForTimeout.push(ms);
    },
    async screenshot(opts) {
      calls.screenshot.push(opts);
      return screenshotResult;
    },
  };
  return { page, calls };
}

// Happy path: viewport, content, timing, and screenshot options.
{
  const { page, calls } = makeStubPage();
  const rawPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const result = await composeMarketingFrame(page, {
    rawPng,
    headline: 'Plan Your Day',
    subhead: 'Wait times & maps, offline',
  });

  assert.deepEqual(calls.setViewportSize[0], IOS_MARKETING, 'renders at exact Apple 6.7" pixels');
  assert.equal(calls.setContent.length, 1, 'sets the composed HTML exactly once');
  assert.equal(calls.setContent[0].opts.waitUntil, 'load');
  assert.deepEqual(calls.waitForTimeout, [150], 'waits for the fonts/layout settle delay');
  assert.deepEqual(calls.screenshot[0], { type: 'png', fullPage: false });
  assert.deepEqual(result, Buffer.from('fake-png-bytes'), 'returns the page.screenshot() result');

  const html = calls.setContent[0].html;
  assert.match(html, /<h1>Plan Your Day<\/h1>/);
  assert.match(html, /<p>Wait times &amp; maps, offline<\/p>/, 'ampersand in subhead is escaped');
  assert.match(html, new RegExp(`width:\\s*${IOS_MARKETING.width}px`), 'body width matches IOS_MARKETING');
  assert.match(html, new RegExp(`height:\\s*${IOS_MARKETING.height}px`), 'body height matches IOS_MARKETING');
  assert.match(
    html,
    new RegExp(`src="data:image/png;base64,${rawPng.toString('base64')}"`),
    'raw screenshot PNG is embedded as a base64 data URI',
  );
}

// HTML escaping of headline/subhead (via the exported entry point — escapeHtml
// itself is not exported, so this is the only reachable surface for it).
{
  const { page, calls } = makeStubPage();
  await composeMarketingFrame(page, {
    rawPng: Buffer.from('x'),
    headline: `<b>Bold</b> & "Quoted"`,
    subhead: `It's <i>great</i> & "true"`,
  });

  const html = calls.setContent[0].html;
  assert.match(
    html,
    /<h1>&lt;b&gt;Bold&lt;\/b&gt; &amp; &quot;Quoted&quot;<\/h1>/,
    'headline escapes &, <, >, and "',
  );
  assert.match(
    html,
    /<p>It's &lt;i&gt;great&lt;\/i&gt; &amp; &quot;true&quot;<\/p>/,
    'subhead escapes &, <, >, and " (apostrophes are left as-is)',
  );
  assert.doesNotMatch(html, /<b>Bold<\/b>/, 'raw headline markup must not survive unescaped');
  assert.doesNotMatch(html, /<i>great<\/i>/, 'raw subhead markup must not survive unescaped');
}

console.log('store-screenshot-compose: ok');
