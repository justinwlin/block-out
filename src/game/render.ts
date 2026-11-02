// Canvas drawing for the tray: raised studded bricks in a framed tray, gates set into the wall.

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
  pieces: { x: number; y: number; out: boolean; lift: number; flash?: number; squash?: number }[];
  clears: number;
  keys: number;
  shake: number;
  particles: Particle[];
  texts: Floater[];
  dragId: number;
  /** Brick currently sliding out through a gate, or -1. */
  exitId: number;
  hoverId: number;
  symbols: boolean;
  reduce: boolean;
  time: number;
}

export function geomFor(viewW: number, viewH: number, boardW: number, boardH: number, safeTop: number, safeBot: number): Geom {
  const top = 92 + safeTop;
  const bot = 64 + safeBot;
  const frame = 0.48;
  const cell = Math.max(28, Math.min(88, Math.floor(Math.min(
    (viewW - 12) / (boardW + frame * 2),
    (viewH - top - bot) / (boardH + frame * 2),
  ))));
  const ox = Math.round((viewW - cell * boardW) / 2);
  const oy = Math.round(top + frame * cell + Math.max(0, (viewH - top - bot - cell * (boardH + frame * 2)) / 2));
  return { cell, ox, oy, viewW, viewH };
}

/** Frame wall thickness around the tray, in pixels. */
export function wallFor(cell: number): number {
  return Math.round(cell * 0.42);
}

export function paintColor(level: Level, color: number): { hex: string; deep: string; symbol: string } {
  if (level.variant === 'checker') {
    return color % 2 === 0
      ? { hex: '#f6f3ec', deep: '#a9a396', symbol: '○' }
      : { hex: '#3a3a44', deep: '#141418', symbol: '●' };
  }
  const c = COLORS[color % COLORS.length];
  return { hex: c.hex, deep: c.deep, symbol: c.symbol };
}

export function render(ctx: CanvasRenderingContext2D, g: Geom, frame: Frame) {
  const { level } = frame;
  const { cell, ox, oy, viewW, viewH } = g;
  ctx.clearRect(0, 0, viewW, viewH);
  const bg = ctx.createLinearGradient(0, 0, 0, viewH);
  bg.addColorStop(0, '#2a3270');
  bg.addColorStop(0.5, '#1a1f4a');
  bg.addColorStop(1, '#10132e');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, viewW, viewH);

  const bw = cell * level.w;
  const bh = cell * level.h;
  const wall = wallFor(cell);

  // Frame: drop shadow, dark lip, flat lit face.
  const fr = Math.max(10, wall * 0.7);
  ctx.save();
  ctx.shadowColor = 'rgba(4, 6, 20, 0.6)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 14;
  round(ctx, ox - wall, oy - wall, bw + wall * 2, bh + wall * 2 + 6, fr);
  ctx.fillStyle = '#262c66';
  ctx.fill();
  ctx.restore();
  round(ctx, ox - wall, oy - wall, bw + wall * 2, bh + wall * 2, fr);
  const fg = ctx.createLinearGradient(0, oy - wall, 0, oy + bh + wall);
  fg.addColorStop(0, '#5862bd');
  fg.addColorStop(1, '#454ea3');
  ctx.fillStyle = fg;
  ctx.fill();
  round(ctx, ox - wall + 1.5, oy - wall + 1.5, bw + wall * 2 - 3, bh + wall * 2 - 3, fr - 1);
  ctx.strokeStyle = 'rgba(255,255,255,.16)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Recessed floor with a tight tile grid.
  const lip = Math.max(2, cell * 0.04);
  round(ctx, ox - lip, oy - lip, bw + lip * 2, bh + lip * 2, Math.max(4, cell * 0.1));
  ctx.fillStyle = '#10143a';
  ctx.fill();
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      const px = ox + x * cell;
      const py = oy + y * cell;
      if (!level.floor[y * level.w + x]) {
        ctx.fillStyle = '#4e57ae';
        ctx.fillRect(px - 0.5, py - 0.5, cell + 1, cell + 1);
        continue;
      }
      const checker = level.variant === 'checker' && (x + y) % 2 === 0;
      const inset = Math.max(1.5, cell * 0.025);
      round(ctx, px + inset, py + inset, cell - inset * 2, cell - inset * 2, cell * 0.08);
      ctx.fillStyle = checker ? '#252b62' : '#1c2152';
      ctx.fill();
    }
  }
  const isg = ctx.createLinearGradient(0, oy - lip, 0, oy + cell * 0.3);
  isg.addColorStop(0, 'rgba(0,0,0,.4)');
  isg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = isg;
  ctx.fillRect(ox - lip, oy - lip, bw + lip * 2, cell * 0.3);

  for (const gate of level.gates) drawGate(ctx, g, frame, gate);

  // Bricks are clipped to the floor so a brick leaving slides under its gate.
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox - 2, oy - cell * 0.3, bw + 4, bh + cell * 0.3 + 2);
  ctx.clip();
  const order = level.pieces.map((_, i) => i).sort((a, b) => {
    const ha = frame.dragId === a ? 1 : 0;
    const hb = frame.dragId === b ? 1 : 0;
    return ha - hb || frame.pieces[a].y - frame.pieces[b].y;
  });
  for (const i of order) {
    const p = level.pieces[i];
    const live = frame.pieces[i];
    if (!live || live.out) continue;
    if (p.room >= 0 && frame.clears < level.rooms[p.room].openAfter) continue;
    if (i === frame.exitId) {
      // Hard cut at the tray edge: the brick disappears into the gate.
      ctx.save();
      ctx.beginPath();
      ctx.rect(ox, oy, bw, bh);
      ctx.clip();
      drawPiece(ctx, g, frame, i);
      ctx.restore();
    } else drawPiece(ctx, g, frame, i);
  }
  ctx.restore();

  for (let r = 0; r < level.rooms.length; r++) {
    const room = level.rooms[r];
    if (frame.clears >= room.openAfter) continue;
    drawShutter(ctx, g, room.x, room.y, room.w, room.h, room.openAfter - frame.clears);
  }

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
  const wall = wallFor(cell);
  const span = gate.span * cell;
  const lip = Math.max(2, cell * 0.04);
  const inset = Math.max(2, cell * 0.035);
  const thick = wall - lip - inset;
  let x = 0;
  let y = 0;
  let w = 0;
  let h = 0;
  if (gate.dir === 0) { x = ox + gate.along * cell + inset; y = oy - lip - thick; w = span - inset * 2; h = thick; }
  if (gate.dir === 2) { x = ox + gate.along * cell + inset; y = oy + level.h * cell + lip; w = span - inset * 2; h = thick; }
  if (gate.dir === 3) { x = ox - lip - thick; y = oy + gate.along * cell + inset; w = thick; h = span - inset * 2; }
  if (gate.dir === 1) { x = ox + level.w * cell + lip; y = oy + gate.along * cell + inset; w = thick; h = span - inset * 2; }
  const hex = iced ? '#d6eef7' : col.hex;
  const deep = iced ? '#7fa9b9' : col.deep;
  const r = Math.max(4, Math.min(w, h) * 0.28);
  const d = Math.max(2, cell * 0.05);
  round(ctx, x, y, w, h, r);
  ctx.fillStyle = deep;
  ctx.fill();
  round(ctx, x, y, w, h - d, r);
  ctx.fillStyle = hex;
  ctx.fill();
  ctx.save();
  round(ctx, x, y, w, h - d, r);
  ctx.clip();
  const gg = ctx.createLinearGradient(0, y, 0, y + h);
  gg.addColorStop(0, 'rgba(255,255,255,.4)');
  gg.addColorStop(0.45, 'rgba(255,255,255,0)');
  ctx.fillStyle = gg;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
  const s = Math.min(w, h);
  if (iced) {
    const left = gate.ice - frame.clears;
    ctx.font = `700 ${Math.max(12, s * 0.62)}px Fredoka, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.strokeText(String(left), x + w / 2, y + (h - d) / 2 + 1);
    ctx.fillStyle = '#7a5a3a';
    ctx.fillText(String(left), x + w / 2, y + (h - d) / 2 + 1);
    return;
  }
  // One arrow, centered: the gate reads as a door, not a pattern.
  arrow(ctx, x + w / 2, y + (h - d) / 2, gate.dir, s * 0.5, deep);
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dir: Dir, s: number, shadow: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((dir - 1) * Math.PI / 2);
  const tri = () => {
    ctx.beginPath();
    ctx.moveTo(-s * 0.32, -s * 0.42);
    ctx.lineTo(s * 0.4, 0);
    ctx.lineTo(-s * 0.32, s * 0.42);
    ctx.closePath();
  };
  ctx.lineJoin = 'round';
  ctx.save();
  ctx.translate(0, 1.5);
  tri();
  ctx.fillStyle = shadow;
  ctx.strokeStyle = shadow;
  ctx.lineWidth = s * 0.18;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  tri();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = s * 0.18;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPiece(ctx: CanvasRenderingContext2D, g: Geom, frame: Frame, i: number) {
  const { cell, ox, oy } = g;
  const p = frame.level.pieces[i];
  const live = frame.pieces[i];
  const shape = SHAPES[p.shape];
  const col = paintColor(frame.level, p.color);
  const dragging = frame.dragId === i;
  const hot = dragging || frame.hoverId === i;
  const lift = live.lift;
  const squash = live.squash ?? 0;
  const set = new Set(shape.cells.map(([x, y]) => `${x},${y}`));
  const has = (x: number, y: number) => set.has(`${x},${y}`);
  const cx = ox + (live.x + shape.w / 2) * cell;
  const cy = oy + (live.y + shape.h / 2) * cell;
  const depth = Math.max(3, cell * 0.075);
  const face = hot ? mix(col.hex, '#ffffff', 0.12) : col.hex;
  ctx.save();
  ctx.translate(cx, cy - lift);
  ctx.scale(1 + squash * 0.15, 1 - squash * 0.45);
  ctx.translate(-cx, -cy);
  // Base (the brick's side wall) with a contact shadow.
  ctx.shadowColor = 'rgba(4, 6, 24, 0.5)';
  ctx.shadowBlur = dragging ? 18 : 4;
  ctx.shadowOffsetY = dragging ? 10 : 2;
  fillPiece(ctx, ox, oy, cell, live.x, live.y, shape.cells, has, col.deep, 0);
  ctx.shadowColor = 'transparent';
  // Top face, raised by `depth`.
  ctx.save();
  ctx.translate(0, -depth);
  // Lit rim: a lighter silhouette peeking out above the face.
  const rim = Math.max(1.5, cell * 0.025);
  fillPiece(ctx, ox, oy, cell, live.x, live.y, shape.cells, has, mix(face, '#ffffff', 0.35), 0);
  ctx.translate(0, rim);
  fillPiece(ctx, ox, oy, cell, live.x, live.y, shape.cells, has, face, 0);
  ctx.save();
  ctx.beginPath();
  tracePiece(ctx, ox, oy, cell, live.x, live.y, shape.cells, has, 0);
  ctx.clip();
  const top = oy + live.y * cell;
  const grad = ctx.createLinearGradient(0, top, 0, top + shape.h * cell);
  grad.addColorStop(0, 'rgba(255,255,255,.18)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(0,0,0,.08)');
  ctx.fillStyle = grad;
  ctx.fillRect(ox + live.x * cell, top, shape.w * cell, shape.h * cell);
  if ((live.flash ?? 0) > 0) {
    ctx.fillStyle = `rgba(255,255,255,${0.5 * (live.flash ?? 0)})`;
    ctx.fillRect(ox + live.x * cell, top, shape.w * cell, shape.h * cell);
  }
  ctx.restore();
  // Four studs per cell.
  const sr = cell * 0.125;
  for (const [dx, dy] of shape.cells) {
    for (const sx of [0.29, 0.71]) {
      for (const sy of [0.27, 0.69]) stud(ctx, ox + (live.x + dx + sx) * cell, oy + (live.y + dy + sy) * cell, sr, face, col.deep);
    }
  }
  const mx = ox + (live.x + (shape.w - 1) / 2) * cell + cell / 2;
  const my = oy + (live.y + (shape.h - 1) / 2) * cell + cell / 2;
  const frozen = frame.clears < p.ice;
  const locked = frame.keys < p.lock;
  if (frame.symbols && !frozen && !locked) {
    ctx.fillStyle = frame.level.variant === 'checker' && p.color % 2 === 1 ? '#fff' : 'rgba(0,0,0,.55)';
    ctx.font = `700 ${Math.max(12, cell * 0.3)}px Fredoka, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(col.symbol, mx, my + 1);
  }
  if (p.keys > 0) keyGlyph(ctx, mx + cell * 0.28, my - cell * 0.28, cell * 0.16);
  if (frozen) iceOverlay(ctx, ox, oy, cell, live.x, live.y, shape.cells, has);
  if (frozen) badge(ctx, mx, my, String(p.ice - frame.clears), '#e7f7ff', '#1b4c5c', cell);
  else if (locked) badge(ctx, mx, my, String(p.lock - frame.keys), '#ffe7a3', '#6a4a00', cell);
  ctx.restore();
  ctx.restore();
}

function iceOverlay(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  cell: number,
  ax: number,
  ay: number,
  cells: readonly (readonly [number, number])[],
  has: (x: number, y: number) => boolean,
) {
  ctx.save();
  ctx.beginPath();
  tracePiece(ctx, ox, oy, cell, ax, ay, cells, has, 0);
  ctx.fillStyle = 'rgba(214, 240, 255, 0.55)';
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,.7)';
  ctx.lineWidth = 2;
  for (const [dx, dy] of cells) {
    const x = ox + (ax + dx) * cell;
    const y = oy + (ay + dy) * cell;
    ctx.beginPath();
    ctx.moveTo(x + cell * 0.18, y + cell * 0.7);
    ctx.lineTo(x + cell * 0.42, y + cell * 0.3);
    ctx.moveTo(x + cell * 0.55, y + cell * 0.82);
    ctx.lineTo(x + cell * 0.8, y + cell * 0.45);
    ctx.stroke();
  }
  ctx.restore();
}

function fillPiece(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  cell: number,
  ax: number,
  ay: number,
  cells: readonly (readonly [number, number])[],
  has: (x: number, y: number) => boolean,
  color: string,
  grow: number,
) {
  ctx.beginPath();
  tracePiece(ctx, ox, oy, cell, ax, ay, cells, has, grow);
  ctx.fillStyle = color;
  ctx.fill();
}

/** One rounded silhouette for the whole piece, with a gap only on the outside. */
function tracePiece(
  ctx: CanvasRenderingContext2D,
  ox: number,
  oy: number,
  cell: number,
  ax: number,
  ay: number,
  cells: readonly (readonly [number, number])[],
  has: (x: number, y: number) => boolean,
  grow: number,
) {
  const gap = Math.max(1.5, cell * 0.03) - grow;
  const radius = Math.max(3, cell * 0.11);
  const bleed = 0.5;
  for (const [dx, dy] of cells) {
    const l = has(dx - 1, dy);
    const r = has(dx + 1, dy);
    const u = has(dx, dy - 1);
    const d = has(dx, dy + 1);
    // Extend into each same-brick neighbor so the cells fuse into one solid body.
    const x0 = ox + (ax + dx) * cell + (l ? -bleed : gap);
    const y0 = oy + (ay + dy) * cell + (u ? -bleed : gap);
    const x1 = ox + (ax + dx + 1) * cell - (r ? -bleed : gap);
    const y1 = oy + (ay + dy + 1) * cell - (d ? -bleed : gap);
    // Round a corner only where both of its sides are open edges of the brick.
    addCorners(ctx, x0, y0, x1 - x0, y1 - y0, [
      !l && !u ? radius : 0,
      !r && !u ? radius : 0,
      !r && !d ? radius : 0,
      !l && !d ? radius : 0,
    ]);
  }
}

function drawShutter(ctx: CanvasRenderingContext2D, g: Geom, x: number, y: number, w: number, h: number, left: number) {
  const { cell, ox, oy } = g;
  const px = ox + x * cell + 2;
  const py = oy + y * cell + 2;
  const pw = w * cell - 4;
  const ph = h * cell - 4;
  round(ctx, px, py, pw, ph, 10);
  ctx.fillStyle = '#3a4288';
  ctx.fill();
  ctx.save();
  round(ctx, px, py, pw, ph, 10);
  ctx.clip();
  for (let i = 6; i < ph; i += 8) {
    ctx.fillStyle = i % 16 === 6 ? '#4f59ac' : '#2c336e';
    ctx.fillRect(px, py + i, pw, 5);
  }
  ctx.restore();
  badge(ctx, px + pw / 2, py + ph / 2, String(left), '#fff6d8', '#2b2f66', cell);
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

function stud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hex: string, deep: string) {
  const side = r * 0.38;
  // Soft contact shadow, then the cylinder wall, then a lit domed cap.
  ctx.beginPath();
  ctx.fillStyle = 'rgba(0,0,0,.16)';
  ctx.arc(x + r * 0.12, y + side + r * 0.14, r * 1.02, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = mix(hex, deep, 0.45);
  ctx.arc(x, y + side, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - r, y, r * 2, side);
  const cap = ctx.createLinearGradient(x, y - r, x, y + r);
  cap.addColorStop(0, mix(hex, '#ffffff', 0.32));
  cap.addColorStop(1, mix(hex, '#ffffff', 0.04));
  ctx.beginPath();
  ctx.fillStyle = cap;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function mix(hex: string, withHex: string, t: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(withHex);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, fill: string, ink: string, cell = 52) {
  const r = Math.max(12, cell * 0.25);
  ctx.beginPath();
  ctx.fillStyle = fill;
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.font = `700 ${Math.round(r * 1.1)}px Fredoka, sans-serif`;
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

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  addRound(ctx, x, y, w, h, r);
}

function addCorners(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: [number, number, number, number]) {
  const m = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = r.map((v) => Math.max(0, Math.min(v, m)));
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr) ctx.arcTo(x + w, y, x + w, y + tr, tr); else ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - br);
  if (br) ctx.arcTo(x + w, y + h, x + w - br, y + h, br); else ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl) ctx.arcTo(x, y + h, x, y + h - bl, bl); else ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + tl);
  if (tl) ctx.arcTo(x, y, x + tl, y, tl); else ctx.lineTo(x, y);
  ctx.closePath();
}

function addRound(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
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
  frame.shake = 0;
}

