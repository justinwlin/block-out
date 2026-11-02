// Link-preview card, 1200×630. Drawn here so it does not depend on a running game.
import { chromium } from 'playwright';

const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden}
  body{display:flex;background:#1a100c;font-family:Georgia,serif;color:#fff8ee}
  .copy{width:560px;padding:72px 64px;display:flex;flex-direction:column;justify-content:center}
  h1{font-size:92px;line-height:.9;margin:0 0 18px;letter-spacing:-2px}
  p{font-size:28px;line-height:1.35;margin:0;color:#f4e7d0}
  small{margin-top:28px;font-size:20px;letter-spacing:.04em;color:#ffc43d}
  .stage{flex:1;display:grid;place-items:center}
  svg{width:520px;height:460px}
</style>
<body>
  <div class="copy">
    <h1>Block<br>Out</h1>
    <p>Slide every brick out through its own gate.</p>
    <small>Free · no ads · plays offline</small>
  </div>
  <div class="stage">
    <svg viewBox="0 0 260 230">
      <rect x="8" y="18" width="244" height="194" rx="22" fill="#6a4328"/>
      <rect x="16" y="26" width="228" height="178" rx="16" fill="#f4e7d0"/>
      <rect x="108" y="4" width="70" height="18" rx="6" fill="#ff4d4d"/>
      <path d="M136 16l8-6 8 6" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>
      <rect x="236" y="78" width="18" height="36" rx="6" fill="#3c7dff"/>
      <rect x="34" y="46" width="62" height="62" rx="12" fill="#ff4d4d"/>
      <circle cx="65" cy="77" r="10" fill="#ffd0cc"/>
      <rect x="108" y="46" width="62" height="30" rx="10" fill="#3c7dff"/>
      <rect x="140" y="46" width="30" height="62" rx="10" fill="#3c7dff"/>
      <circle cx="155" cy="77" r="8" fill="#d6e4ff"/>
      <rect x="40" y="124" width="30" height="62" rx="10" fill="#ffc43d"/>
      <rect x="70" y="156" width="62" height="30" rx="10" fill="#67d34a"/>
      <circle cx="101" cy="171" r="8" fill="#e5ffd8"/>
      <rect x="150" y="124" width="62" height="62" rx="12" fill="#b06bff"/>
      <circle cx="181" cy="155" r="10" fill="#edd6ff"/>
    </svg>
  </div>
</body>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.screenshot({ path: 'public/og.png' });
await browser.close();
console.log('wrote public/og.png');
