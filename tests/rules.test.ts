import { describe, expect, it } from 'vitest';
import { destroyColor, destroyPiece } from '../src/sim/boosters';
import { applyMove, legalMoves, makeState, replay, stranded, won } from '../src/sim/rules';
import { solve } from '../src/sim/solver';
import { DOT, SHAPES } from '../src/sim/shapes';
import type { Level, PieceDef } from '../src/sim/types';

function tray(partial: Partial<Level> & Pick<Level, 'w' | 'h' | 'pieces' | 'gates'>): Level {
  const floor = partial.floor ?? new Uint8Array(partial.w * partial.h).fill(1);
  return {
    n: 1,
    w: partial.w,
    h: partial.h,
    floor,
    gates: partial.gates,
    pieces: partial.pieces,
    rooms: partial.rooms ?? [],
    timer: 60,
    label: 'Normal',
    variant: 'rect',
    hint: '',
    mechanics: [],
    fallback: false,
    metrics: { minMoves: 0, witnessMoves: 0, branching: 0, deadEndRatio: 0, forcedOrderings: 0, nodes: 0, setups: 0, pieces: partial.pieces.length, colors: 1, obstacles: 0 },
  };
}

const dot = (x: number, y: number, color: number, extra: Partial<PieceDef> = {}): PieceDef => ({
  shape: DOT, color, x, y, ice: 0, lock: 0, keys: 0, room: -1, ...extra,
});

describe('slides and gates', () => {
  it('sends a brick out in one drag when it fits the gate', () => {
    const level = tray({
      w: 4, h: 4,
      pieces: [dot(0, 2, 0)],
      gates: [{ dir: 0, along: 0, span: 1, color: 0, ice: 0 }],
    });
    const solved = solve(level);
    expect(solved.solved).toBe(true);
    expect(solved.minMoves).toBe(1);
    expect(replay(level, solved.moves)).toBe(true);
  });

  it('refuses a gate of the wrong color or the wrong width', () => {
    const wrongColor = tray({
      w: 4, h: 3,
      pieces: [dot(0, 0, 0)],
      gates: [{ dir: 0, along: 0, span: 1, color: 1, ice: 0 }],
    });
    expect(legalMoves(wrongColor, makeState(wrongColor)).some((m) => m.exit)).toBe(false);

    const wide = tray({
      w: 4, h: 3,
      pieces: [{ shape: 1, color: 0, x: 0, y: 0, ice: 0, lock: 0, keys: 0, room: -1 }],
      gates: [{ dir: 0, along: 0, span: 1, color: 0, ice: 0 }],
    });
    // Shape 1 is the first bar2 rotation (horizontal, span 2) if the catalog starts dot, bar2.
    expect(legalMoves(wide, makeState(wide)).some((m) => m.exit)).toBe(false);
  });

  it('lets the front brick leave before the one behind it', () => {
    const level = tray({
      w: 4, h: 4,
      pieces: [dot(0, 0, 1), dot(0, 1, 0)],
      gates: [
        { dir: 0, along: 0, span: 1, color: 1, ice: 0 },
        { dir: 1, along: 1, span: 1, color: 0, ice: 0 },
      ],
    });
    const solved = solve(level);
    expect(solved.solved).toBe(true);
    expect(solved.minMoves).toBe(2);
  });
});

describe('obstacles', () => {
  it('holds an iced brick until another one has left', () => {
    const level = tray({
      w: 4, h: 3,
      pieces: [dot(0, 0, 0, { ice: 1 }), dot(2, 0, 1)],
      gates: [
        { dir: 0, along: 0, span: 1, color: 0, ice: 0 },
        { dir: 0, along: 2, span: 1, color: 1, ice: 0 },
      ],
    });
    const start = makeState(level);
    expect(legalMoves(level, start).some((m) => m.i === 0)).toBe(false);
    const solved = solve(level);
    expect(solved.solved).toBe(true);
    expect(solved.moves[0].i).toBe(1);
  });

  it('keeps a padlock shut until the key brick exits', () => {
    const level = tray({
      w: 4, h: 3,
      pieces: [dot(0, 0, 0, { lock: 1 }), dot(2, 0, 1, { keys: 1 })],
      gates: [
        { dir: 0, along: 0, span: 1, color: 0, ice: 0 },
        { dir: 0, along: 2, span: 1, color: 1, ice: 0 },
      ],
    });
    expect(legalMoves(level, makeState(level)).some((m) => m.i === 0)).toBe(false);
    const solved = solve(level);
    expect(solved.solved).toBe(true);
    expect(replay(level, solved.moves)).toBe(true);
  });

  it('opens a shutter and then clears the brick inside', () => {
    const level = tray({
      w: 5, h: 5,
      pieces: [dot(0, 0, 0), dot(3, 4, 1, { room: 0 })],
      gates: [
        { dir: 0, along: 0, span: 1, color: 0, ice: 0 },
        { dir: 2, along: 3, span: 1, color: 1, ice: 0 },
      ],
      rooms: [{ x: 3, y: 3, w: 2, h: 2, openAfter: 1 }],
    });
    const start = makeState(level);
    expect(legalMoves(level, start).some((m) => m.i === 1)).toBe(false);
    const solved = solve(level);
    expect(solved.solved).toBe(true);
    expect(won(level, applyAll(level, solved.moves))).toBe(true);
  });
});

describe('boosters', () => {
  it('counts a rocket as a clear and lets a UFO take one color', () => {
    const level = tray({
      w: 4, h: 3,
      pieces: [dot(0, 1, 0, { ice: 1 }), dot(1, 1, 0), dot(2, 1, 1)],
      gates: [
        { dir: 0, along: 0, span: 1, color: 0, ice: 0 },
        { dir: 0, along: 2, span: 1, color: 1, ice: 0 },
      ],
    });
    const s = makeState(level);
    expect(destroyPiece(level, s, 1)).toBe(true);
    expect(s.clears).toBe(1);
    expect(legalMoves(level, s).some((m) => m.i === 0 && m.exit)).toBe(true);
    const s2 = makeState(level);
    expect(destroyColor(level, s2, 0)).toBe(2);
    expect(s2.out[2]).toBe(0);
  });
});

describe('one-way bricks, gate limits, paint', () => {
  it('keeps a one-way brick on its axis', () => {
    const level = tray({
      w: 4, h: 4,
      pieces: [dot(1, 1, 0, { axis: 1 })],
      gates: [{ dir: 0, along: 1, span: 1, color: 0, ice: 0 }, { dir: 1, along: 1, span: 1, color: 0, ice: 0 }],
    });
    const moves = legalMoves(level, makeState(level));
    expect(moves.every((m) => m.dir === 1 || m.dir === 3)).toBe(true);
    expect(moves.some((m) => m.exit && m.dir === 1)).toBe(true);
    expect(moves.some((m) => m.exit && m.dir === 0)).toBe(false);
  });

  it('lets a narrower brick out anywhere inside a wider gate', () => {
    const level = tray({
      w: 4, h: 3,
      pieces: [dot(1, 1, 0), dot(3, 2, 0)],
      gates: [{ dir: 0, along: 0, span: 3, color: 0, ice: 0 }],
    });
    const s = makeState(level);
    // Column 1 sits inside the 3-wide gate over columns 0-2; column 3 does not.
    expect(legalMoves(level, s).some((m) => m.i === 0 && m.exit && m.dir === 0)).toBe(true);
    expect(legalMoves(level, s).some((m) => m.i === 1 && m.exit)).toBe(false);
    const solved = solve(level);
    expect(solved.solved).toBe(true);
    expect(replay(level, solved.moves)).toBe(true);
  });

  it('closes a limited gate after its uses', () => {
    const level = tray({
      w: 3, h: 3,
      pieces: [dot(0, 0, 0), dot(0, 2, 0)],
      gates: [{ dir: 3, along: 0, span: 1, color: 0, ice: 0, uses: 1 }, { dir: 3, along: 2, span: 1, color: 0, ice: 0, uses: 1 }],
    });
    const s = makeState(level);
    applyMove(level, s, { i: 0, dir: 3, dist: 1, exit: true });
    expect(s.passed[0]).toBe(1);
    // Brick 1 slides up to row 0, but that gate is spent; it has to use its own.
    applyMove(level, s, { i: 1, dir: 0, dist: 2, exit: false });
    expect(legalMoves(level, s).some((m) => m.i === 1 && m.exit)).toBe(false);
    applyMove(level, s, { i: 1, dir: 2, dist: 2, exit: false });
    expect(legalMoves(level, s).some((m) => m.i === 1 && m.exit && m.dir === 3)).toBe(true);
  });

  it('proves a trap: spending the only gate another brick fits is a dead end', () => {
    const level = tray({
      w: 3, h: 2,
      pieces: [dot(0, 0, 0), dot(2, 0, 0)],
      gates: [{ dir: 3, along: 0, span: 1, color: 0, ice: 0, uses: 1 }, { dir: 2, along: 0, span: 1, color: 0, ice: 0 }],
    });
    // Brick 1 only slides sideways, so the limited left gate is its only way out.
    level.pieces[1].axis = 1;
    const s = makeState(level);
    expect(stranded(level, s)).toBe(false);
    applyMove(level, s, { i: 0, dir: 3, dist: 1, exit: true });
    expect(stranded(level, s)).toBe(true);
    expect(solve(level, 4000, Infinity, s).exhausted).toBe(true);
    const solved = solve(level);
    expect(solved.solved).toBe(true);
    expect(solved.moves.some((m) => m.i === 0 && m.exit && m.dir === 3)).toBe(false);
  });

  it('keeps its color when a slide ends on two paints of different colors', () => {
    const level = tray({
      w: 4, h: 3,
      pieces: [{ shape: SHAPES.findIndex((sh) => sh.w === 2 && sh.h === 1 && sh.cells.length === 2), color: 1, x: 0, y: 0, ice: 0, lock: 0, keys: 0, room: -1 }],
      gates: [{ dir: 1, along: 0, span: 1, color: 1, ice: 0 }],
    });
    level.paint = [{ x: 2, y: 1, color: 0 }, { x: 3, y: 1, color: 2 }, { x: 0, y: 2, color: 0 }, { x: 1, y: 2, color: 0 }];
    const s = makeState(level);
    applyMove(level, s, { i: 0, dir: 2, dist: 1, exit: false });
    applyMove(level, s, { i: 0, dir: 1, dist: 2, exit: false });
    expect(s.color[0]).toBe(1);
    // Two tiles of the same color still paint.
    applyMove(level, s, { i: 0, dir: 3, dist: 2, exit: false });
    applyMove(level, s, { i: 0, dir: 2, dist: 1, exit: false });
    expect(s.color[0]).toBe(0);
  });

  it('recolors a brick whose slide ends on paint, and the solver uses it', () => {
    const level = tray({
      w: 4, h: 3,
      pieces: [dot(0, 1, 1)],
      gates: [{ dir: 1, along: 1, span: 1, color: 0, ice: 0 }],
    });
    level.paint = [{ x: 2, y: 1, color: 0 }];
    const s = makeState(level);
    expect(legalMoves(level, s).some((m) => m.exit)).toBe(false);
    applyMove(level, s, { i: 0, dir: 1, dist: 2, exit: false });
    expect(s.color[0]).toBe(0);
    expect(legalMoves(level, s).some((m) => m.exit && m.dir === 1)).toBe(true);
    const solved = solve(level);
    expect(solved.solved).toBe(true);
    expect(replay(level, solved.moves)).toBe(true);
  });
});

function applyAll(level: Level, moves: { i: number; dir: 0 | 1 | 2 | 3; dist: number; exit: boolean }[]) {
  const s = makeState(level);
  for (const m of moves) applyMove(level, s, m);
  return s;
}
