/**
 * Wrap a raw in-app PNG in an App Store marketing frame (headline + device).
 * Renders in Playwright at exact Apple 6.7" pixels (1290×2796).
 */
export const IOS_MARKETING = { width: 1290, height: 2796 };

export async function composeMarketingFrame(page, { rawPng, headline, subhead }) {
  const b64 = rawPng.toString('base64');
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    width: ${IOS_MARKETING.width}px;
    height: ${IOS_MARKETING.height}px;
    font-family: "SF Pro Display", "Segoe UI", system-ui, -apple-system, sans-serif;
    background: linear-gradient(165deg, #eef7f2 0%, #f8f4ec 42%, #fdeee8 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: hidden;
  }
  .copy {
    flex: 0 0 auto;
    padding: 96px 72px 48px;
    text-align: center;
  }
  h1 {
    font-size: 74px;
    line-height: 1.05;
    letter-spacing: -0.03em;
    font-weight: 800;
    color: #1a2744;
    max-width: 1100px;
  }
  p {
    margin-top: 28px;
    font-size: 38px;
    line-height: 1.35;
    color: #4a5568;
    max-width: 980px;
  }
  .device {
    flex: 1 1 auto;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-bottom: 64px;
    width: 100%;
  }
  .bezel {
    width: 934px;
    border-radius: 52px;
    padding: 14px;
    background: linear-gradient(145deg, #2a2a2e, #0f0f12);
    box-shadow:
      0 48px 120px rgba(26, 39, 68, 0.28),
      0 12px 32px rgba(0, 0, 0, 0.18);
  }
  .screen {
    border-radius: 40px;
    overflow: hidden;
    line-height: 0;
  }
  .screen img {
    width: 906px;
    height: auto;
    display: block;
  }
</style>
</head>
<body>
  <div class="copy">
    <h1>${escapeHtml(headline)}</h1>
    <p>${escapeHtml(subhead)}</p>
  </div>
  <div class="device">
    <div class="bezel">
      <div class="screen">
        <img alt="" src="data:image/png;base64,${b64}" />
      </div>
    </div>
  </div>
</body>
</html>`;

  await page.setViewportSize(IOS_MARKETING);
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForTimeout(150);
  return page.screenshot({ type: 'png', fullPage: false });
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
