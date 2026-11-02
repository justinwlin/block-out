import { describe, expect, it } from 'vitest';
import { destroyColor, destroyPiece } from '../src/sim/boosters';
import { applyMove, legalMoves, makeState, replay, won } from '../src/sim/rules';
import { solve } from '../src/sim/solver';
import { DOT } from '../src/sim/shapes';
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

function applyAll(level: Level, moves: { i: number; dir: 0 | 1 | 2 | 3; dist: number; exit: boolean }[]) {
  const s = makeState(level);
  for (const m of moves) applyMove(level, s, m);
  return s;
}
