// Canvas drawing for the tray. Bricks are original: beveled studs on a cream tray.

import { SHAPES } from '../sim/shapes';
import { COLORS, type Dir, type Level } from '../sim/types';

export interface Geom {
  cell: number;
  ox: number;
  oy: number;
  viewW: number;
  viewH: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}

export interface Floater {
  x: number;
  y: number;
  life: number;
  text: string;
  color: string;
}

export interface Frame {
  level: Level;
  pieces: { x: number; y: number; out: boolean; lift: number }[];
  clears: number;
  keys: number;
  shake: number;
  particles: Particle[];
  texts: Floater[];
  dragId: number;
  symbols: boolean;
  reduce: boolean;
  time: number;
}

export function geomFor(viewW: number, viewH: number, boardW: number, boardH: number, safeTop: number, safeBot: number): Geom {
  const top = 92 + safeTop;
  const bot = 124 + safeBot;
  const gate = 0.78;
  const cell = Math.max(28, Math.min(72, Math.floor(Math.min(
    (viewW - 28) / (boardW + gate * 2),
    (viewH - top - bot) / (boardH + gate * 2),
  ))));
  const ox = Math.round((viewW - cell * boardW) / 2);
  const oy = Math.round(top + gate * cell + Math.max(0, (viewH - top - bot - cell * (boardH + gate * 2)) / 2));
  return { cell, ox, oy, viewW, viewH };
}

export function paintColor(level: Level, color: number): { hex: string; deep: string; symbol: string } {
  if (level.variant === 'checker') {
    return color % 2 === 0
      ? { hex: '#f6f3ec', deep: '#b7b1a4', symbol: '○' }
      : { hex: '#242424', deep: '#050505', symbol: '●' };
  }
  const c = COLORS[color % COLORS.length];
  return { hex: c.hex, deep: c.deep, symbol: c.symbol };
}

export function render(ctx: CanvasRenderingContext2D, g: Geom, frame: Frame) {
  const { level } = frame;
  const { cell, ox, oy, viewW, viewH } = g;
  ctx.clearRect(0, 0, viewW, viewH);
  const bg = ctx.createLinearGradient(0, 0, 0, viewH);
  bg.addColorStop(0, '#3b2618');
  bg.addColorStop(0.45, '#24160f');
  bg.addColorStop(1, '#120c09');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, viewW, viewH);

  const sx = frame.reduce ? 0 : Math.sin(frame.time * 47) * frame.shake;
  const sy = frame.reduce ? 0 : Math.cos(frame.time * 53) * frame.shake * 0.8;
  ctx.save();
  ctx.translate(sx, sy);

  const pad = Math.round(cell * 0.22);
  round(ctx, ox - pad, oy - pad, cell * level.w + pad * 2, cell * level.h + pad * 2, 18);
  ctx.fillStyle = '#6a4328';
  ctx.fill();
  round(ctx, ox - pad + 3, oy - pad + 3, cell * level.w + pad * 2 - 6, cell * level.h + pad * 2 - 6, 15);
  ctx.fillStyle = '#f4e7d0';
  ctx.fill();

  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const px = ox + x * cell;
      const py = oy + y * cell;
      if (!level.floor[y * level.w + x]) {
        ctx.fillStyle = '#3b2618';
        ctx.fillRect(px - 1, py - 1, cell + 2, cell + 2);
        continue;
      }
      const checker = level.variant === 'checker' && (x + y) % 2 === 0;
      ctx.fillStyle = checker ? 'rgba(90,70,48,.16)' : 'rgba(120,90,50,.06)';
      const inset = 3;
      round(ctx, px + inset, py + inset, cell - inset * 2, cell - inset * 2, 6);
      ctx.fill();
    }
  }

  for (const gate of level.gates) drawGate(ctx, g, frame, gate);

  for (let i = 0; i < level.pieces.length; i++) {
    const p = level.pieces[i];
    const live = frame.pieces[i];
    if (!live || live.out) continue;
    if (p.room >= 0 && frame.clears < level.rooms[p.room].openAfter) continue;
    drawPiece(ctx, g, frame, i);
  }

  for (let r = 0; r < level.rooms.length; r++) {
    const room = level.rooms[r];
    if (frame.clears >= room.openAfter) continue;
    drawShutter(ctx, g, room.x, room.y, room.w, room.h, room.openAfter - frame.clears);
  }

  ctx.restore();

  for (const p of frame.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    round(ctx, p.x, p.y, p.size, p.size, 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.font = `700 ${Math.max(14, cell * 0.42)}px Fredoka, sans-serif`;
  ctx.textAlign = 'center';
  for (const t of frame.texts) {
    ctx.globalAlpha = Math.max(0, Math.min(1, t.life));
    ctx.fillStyle = t.color;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}

function drawGate(ctx: CanvasRenderingContext2D, g: Geom, frame: Frame, gate: Level['gates'][number]) {
  const { cell, ox, oy } = g;
  const { level } = frame;
  const col = paintColor(level, gate.color);
  const iced = frame.clears < gate.ice;
  const span = gate.span * cell;
  const thick = Math.max(8, cell * 0.34);
  let x = 0;
  let y = 0;
  let w = thick;
  let h = thick;
  if (gate.dir === 0) { x = ox + gate.along * cell; y = oy - thick - 2; w = span; h = thick; }
  if (gate.dir === 2) { x = ox + gate.along * cell; y = oy + level.h * cell + 2; w = span; h = thick; }
  if (gate.dir === 3) { x = ox - thick - 2; y = oy + gate.along * cell; w = thick; h = span; }
  if (gate.dir === 1) { x = ox + level.w * cell + 2; y = oy + gate.along * cell; w = thick; h = span; }
  ctx.fillStyle = iced ? '#d5e7ee' : col.hex;
  round(ctx, x, y, w, h, 7);
  ctx.fill();
  ctx.strokeStyle = iced ? '#7ea8b5' : col.deep;
  ctx.lineWidth = 2;
  ctx.stroke();
  chevron(ctx, x + w / 2, y + h / 2, gate.dir, Math.min(w, h) * 0.45, iced ? '#3d6c7c' : '#fff');
  if (iced) {
    const left = gate.ice - frame.clears;
    ctx.fillStyle = '#14343d';
    ctx.font = `700 ${Math.max(11, cell * 0.34)}px Fredoka, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(left), x + w / 2, y + h / 2);
  }
}

function drawPiece(ctx: CanvasRenderingContext2D, g: Geom, frame: Frame, i: number) {
  const { cell, ox, oy } = g;
  const p = frame.level.pieces[i];
  const live = frame.pieces[i];
  const shape = SHAPES[p.shape];
  const col = paintColor(frame.level, p.color);
  const lift = live.lift + (frame.dragId === i ? 5 : 0);
  ctx.save();
  ctx.translate(0, -lift);
  if (frame.dragId === i) ctx.shadowColor = 'rgba(0,0,0,.35)';
  if (frame.dragId === i) ctx.shadowBlur = 16;
  if (frame.dragId === i) ctx.shadowOffsetY = 8;
  for (const [dx, dy] of shape.cells) {
    const x = ox + (live.x + dx) * cell;
    const y = oy + (live.y + dy) * cell;
    brick(ctx, x, y, cell, col.hex, col.deep);
  }
  ctx.shadowColor = 'transparent';
  const cx = ox + (live.x + (shape.w - 1) / 2) * cell + cell / 2;
  const cy = oy + (live.y + (shape.h - 1) / 2) * cell + cell / 2;
  const frozen = frame.clears < p.ice;
  const locked = frame.keys < p.lock;
  if (frame.symbols && !frozen) {
    ctx.fillStyle = p.color % 2 === 1 && frame.level.variant === 'checker' ? '#fff' : 'rgba(0,0,0,.45)';
    ctx.font = `700 ${Math.max(12, cell * 0.38)}px Fredoka, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(col.symbol, cx, cy + cell * 0.22);
  }
  if (p.keys > 0) keyGlyph(ctx, cx + cell * 0.28, cy - cell * 0.28, cell * 0.22);
  if (frozen) badge(ctx, cx, cy, String(p.ice - frame.clears), '#e7f7ff', '#1b4c5c');
  else if (locked) badge(ctx, cx, cy, String(p.lock - frame.keys), '#ffe7a3', '#6a4a00');
  ctx.restore();
}

function drawShutter(ctx: CanvasRenderingContext2D, g: Geom, x: number, y: number, w: number, h: number, left: number) {
  const { cell, ox, oy } = g;
  const px = ox + x * cell + 2;
  const py = oy + y * cell + 2;
  const pw = w * cell - 4;
  const ph = h * cell - 4;
  round(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = '#8a5a32';
  ctx.fill();
  ctx.save();
  round(ctx, px, py, pw, ph, 10);
  ctx.clip();
  for (let i = 6; i < ph; i += 8) {
    ctx.fillStyle = i % 16 === 6 ? '#a56b3e' : '#6e4528';
    ctx.fillRect(px, py + i, pw, 5);
  }
  ctx.restore();
  badge(ctx, px + pw / 2, py + ph / 2, String(left), '#fff6d8', '#5c3b16');
  ctx.fillStyle = '#ffd56a';
  const cx = px + pw / 2;
  const cy = py + 16;
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy);
  ctx.lineTo(cx - 6, cy - 8);
  ctx.lineTo(cx - 2, cy);
  ctx.lineTo(cx + 2, cy - 8);
  ctx.lineTo(cx + 6, cy);
  ctx.lineTo(cx + 10, cy - 8);
  ctx.lineTo(cx + 12, cy);
  ctx.lineTo(cx - 12, cy);
  ctx.fill();
}

function brick(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number, hex: string, deep: string) {
  const m = Math.max(2, cell * 0.08);
  round(ctx, x + m, y + m + 2, cell - m * 2, cell - m * 2, cell * 0.18);
  ctx.fillStyle = deep;
  ctx.fill();
  round(ctx, x + m, y + m, cell - m * 2, cell - m * 2, cell * 0.18);
  ctx.fillStyle = hex;
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.38)';
  round(ctx, x + m + 3, y + m + 3, cell - m * 2 - 8, (cell - m * 2) * 0.28, 4);
  ctx.fill();
  const cx = x + cell / 2;
  const cy = y + cell / 2 - cell * 0.06;
  const r = cell * 0.16;
  ctx.beginPath();
  ctx.fillStyle = deep;
  ctx.arc(cx, cy + 1.5, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = hex;
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = 'rgba(255,255,255,.7)';
  ctx.arc(cx - r * 0.28, cy - r * 0.32, r * 0.32, 0, Math.PI * 2);
  ctx.fill();
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, ink: string) {
  ctx.beginPath();
  ctx.fillStyle = fill;
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = '700 14px Fredoka, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 1);
}

function keyGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#ffe08a';
  ctx.strokeStyle = '#8a5a00';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(0, 0, s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.6, 0);
  ctx.lineTo(s * 2.1, 0);
  ctx.lineTo(s * 2.1, s * 0.55);
  ctx.moveTo(s * 1.5, 0);
  ctx.lineTo(s * 1.5, s * 0.4);
  ctx.stroke();
  ctx.restore();
}

function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, dir: Dir, s: number, color: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(dir * Math.PI / 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.4, -s * 0.35);
  ctx.lineTo(s * 0.15, 0);
  ctx.lineTo(-s * 0.4, s * 0.35);
  ctx.stroke();
  ctx.restore();
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function burst(particles: Particle[], x: number, y: number, color: string, n: number) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 160;
    particles.push({
      x, y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 40,
      life: 0.45 + Math.random() * 0.35,
      max: 0.8,
      color,
      size: 4 + Math.random() * 6,
    });
  }
}

export function stepFx(frame: Frame, dt: number) {
  for (const p of frame.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 420 * dt;
  }
  frame.particles = frame.particles.filter((p) => p.life > 0);
  for (const t of frame.texts) {
    t.life -= dt;
    t.y -= 18 * dt;
  }
  frame.texts = frame.texts.filter((t) => t.life > 0);
  frame.shake *= Math.pow(0.04, dt);
  if (frame.shake < 0.15) frame.shake = 0;
}

