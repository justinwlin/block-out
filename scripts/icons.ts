// Renders public/icons/icon.svg to the PNG sizes the manifest and iOS need.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad] of [
  ['favicon-64.png', 64, 0],
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  ['apple-touch-icon.png', 180, 0],
  ['icon-maskable-512.png', 512, 0.14],
] as const) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  const offset = Math.round((size - inner) / 2);
  await page.setContent(
    `<body style="margin:0;background:#1a100c;width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" x="${offset}" y="${offset}" `)}</body>`,
  );
  await page.screenshot({ path: `public/icons/${name}` });
}
await browser.close();
console.log('icons written');
