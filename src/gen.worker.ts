// Builds levels off the main thread, so a long search never freezes a drag.
import { generateLevel } from './sim/levelgen';

self.onmessage = (e: MessageEvent<number>) => {
  const n = e.data;
  (self as unknown as Worker).postMessage({ n, level: generateLevel(n) });
};
