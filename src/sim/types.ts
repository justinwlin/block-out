// Shared puzzle types. Directions: 0 north, 1 east, 2 south, 3 west.

export type Dir = 0 | 1 | 2 | 3;

export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;

export type Label = 'Warmup' | 'Normal' | 'Hard' | 'Super Hard';
export type Variant = 'rect' | 'U' | 'chambers' | 'checker';

export interface Shape {
  name: string;
  cells: readonly (readonly [number, number])[];
  w: number;
  h: number;
  /** Lowest level number that may roll this shape. */
  minLevel: number;
}

export interface Gate {
  dir: Dir;
  /** Starting column for a north/south gate, starting row for an east/west gate. */
  along: number;
  span: number;
  color: number;
  /** Clears required before the gate accepts a brick. */
  ice: number;
}

export interface PieceDef {
  shape: number;
  color: number;
  x: number;
  y: number;
  /** Clears required before this brick may move. */
  ice: number;
  /** Keys required before this brick may move. */
  lock: number;
  /** Keys this brick awards when it exits. */
  keys: number;
  /** Room index, or -1 if the brick starts on the tray. */
  room: number;
}

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  openAfter: number;
}

export interface Move {
  i: number;
  dir: Dir;
  dist: number;
  exit: boolean;
}

export interface Metrics {
  minMoves: number;
  witnessMoves: number;
  branching: number;
  deadEndRatio: number;
  forcedOrderings: number;
  nodes: number;
  setups: number;
  pieces: number;
  colors: number;
  obstacles: number;
}

export interface Level {
  /** 1-based level number. */
  n: number;
  w: number;
  h: number;
  /** 1 = floor, including cells hidden under a shutter. */
  floor: Uint8Array;
  gates: Gate[];
  pieces: PieceDef[];
  rooms: Room[];
  timer: number;
  label: Label;
  variant: Variant;
  hint: string;
  mechanics: string[];
  metrics: Metrics;
  /** True when every interesting attempt failed and a trivial tray shipped. */
  fallback: boolean;
}

export interface SimState {
  x: Int16Array;
  y: Int16Array;
  out: Uint8Array;
  clears: number;
  keys: number;
}

export const COLORS = [
  { id: 'coral', hex: '#ff4d4d', deep: '#9d2430', symbol: '●' },
  { id: 'blue', hex: '#3c7dff', deep: '#1a3f93', symbol: '■' },
  { id: 'lime', hex: '#67d34a', deep: '#1d6a16', symbol: '▲' },
  { id: 'gold', hex: '#ffc43d', deep: '#8a5b00', symbol: '★' },
  { id: 'violet', hex: '#b06bff', deep: '#5c2896', symbol: '◆' },
  { id: 'teal', hex: '#2ad4c7', deep: '#0c6e68', symbol: '✚' },
] as const;
