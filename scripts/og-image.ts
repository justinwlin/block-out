// Link-preview card, 1200×630. Fredoka is inlined so the title does not fall back to Times.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const font = readFileSync('node_modules/@fontsource/fredoka/files/fredoka-latin-700-normal.woff2').toString('base64');

const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face {
    font-family: Fredoka;
    src: url(data:font/woff2;base64,${font}) format('woff2');
    font-weight: 700;
    font-display: block;
  }
  html,body{margin:0;width:1200px;height:630px;overflow:hidden}
  body{display:flex;background:#1a100c;font-family:Fredoka,"Avenir Next","Segoe UI",sans-serif;color:#fff8ee}
  .copy{width:560px;padding:72px 64px;display:flex;flex-direction:column;justify-content:center}
  h1{font-size:92px;line-height:.88;margin:0 0 18px;letter-spacing:-2px;font-weight:700}
  p{font-size:28px;line-height:1.35;margin:0;color:#f4e7d0;font-weight:700}
  small{margin-top:28px;font-size:20px;letter-spacing:.04em;color:#ffc43d;font-weight:700}
  .stage{flex:1;display:grid;place-items:center}
</style>
<body>
  <div class="copy">
    <h1>Block<br>Out</h1>
    <p>Slide every brick out through its own gate.</p>
    <small>Free · no ads · plays offline</small>
  </div>
  <div class="stage">
    <svg viewBox="0 0 280 240" width="520" height="446">
      <rect x="8" y="16" width="250" height="206" rx="24" fill="#6a4328"/>
      <rect x="16" y="24" width="234" height="190" rx="18" fill="#f4e7d0"/>
      <rect x="118" y="2" width="64" height="16" rx="6" fill="#ff4d4d"/>
      <path d="M142 12l8-6 8 6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- connected L -->
      <path d="M36 48h70a12 12 0 0 1 12 12v22h36a12 12 0 0 1 12 12v36a12 12 0 0 1-12 12H48a12 12 0 0 1-12-12V60a12 12 0 0 1 12-12z" fill="#ff4d4d" stroke="#9d2430" stroke-width="3"/>
      <circle cx="68" cy="78" r="11" fill="#ffd0cc"/>
      <circle cx="98" cy="112" r="11" fill="#ffd0cc"/>
      <circle cx="132" cy="112" r="11" fill="#ffd0cc"/>
      <!-- separate bar, gap visible -->
      <rect x="186" y="58" width="40" height="92" rx="12" fill="#3c7dff" stroke="#1a3f93" stroke-width="3"/>
      <circle cx="206" cy="86" r="9" fill="#d6e4ff"/>
      <circle cx="206" cy="118" r="9" fill="#d6e4ff"/>
      <!-- separate square -->
      <rect x="150" y="156" width="52" height="44" rx="12" fill="#67d34a" stroke="#1d6a16" stroke-width="3"/>
      <circle cx="176" cy="178" r="9" fill="#e7ffd8"/>
    </svg>
  </div>
</body>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: 'public/og.png' });
await browser.close();
console.log('wrote public/og.png');
