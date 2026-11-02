// Gameplay stills. Start a server first: npm run shots -- http://127.0.0.1:5173/
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:5173/';
mkdirSync('e2e-out', { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.goto(base);
await page.waitForFunction(() => (window as unknown as { __blockout?: { start: (n: number) => void } }).__blockout);
await page.screenshot({ path: 'e2e-out/title.png' });

async function board(n: number, name: string) {
  await page.evaluate((level) => (window as unknown as { __blockout: { start: (n: number) => void } }).__blockout.start(level), n);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `e2e-out/${name}.png` });
}

await board(1, 'level-1');
await board(14, 'level-14');
await board(18, 'level-18');
await board(19, 'level-19');
await board(66, 'level-66');

const drag = await page.evaluate(() => {
  const api = (window as unknown as { __blockout: { start: (n: number) => void; session: () => { geom: { cell: number; ox: number; oy: number }; level: { gates: { dir: number; along: number; color: number }[]; pieces: { color: number; x: number; y: number }[] }; live: { x: number; y: number }[] } } }).__blockout;
  api.start(1);
  const s = api.session();
  const piece = s.level.pieces[0];
  const gate = s.level.gates.find((g) => g.color === piece.color) ?? s.level.gates[0];
  const cx = s.geom.ox + (s.live[0].x + 0.5) * s.geom.cell;
  const cy = s.geom.oy + (s.live[0].y + 0.5) * s.geom.cell;
  const step = s.geom.cell * 3.2;
  const dx = gate.dir === 1 ? step : gate.dir === 3 ? -step : 0;
  const dy = gate.dir === 2 ? step : gate.dir === 0 ? -step : 0;
  return { cx, cy, dx, dy };
});
await page.mouse.move(drag.cx, drag.cy);
await page.mouse.down();
await page.mouse.move(drag.cx + drag.dx, drag.cy + drag.dy, { steps: 16 });
await page.waitForTimeout(400);
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: 'e2e-out/level-1-drag.png' });

await page.setViewportSize({ width: 1280, height: 800 });
await board(42, 'level-42-desktop');
await browser.close();
console.log('shots in e2e-out/');
