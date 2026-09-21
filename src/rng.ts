/**
 * Seeded RNG. This is load-bearing, not a convenience.
 *
 * Death restarts the level, and the level must regenerate identically so the
 * player can learn it. `Math.random()` must never appear anywhere else in this
 * codebase.
 */
export class Rng {
  private state: number;

  constructor(public readonly seed: number) {
    this.state = seed >>> 0;
  }

  /** mulberry32 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  bool(chance = 0.5): boolean {
    return this.next() < chance;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Weighted pick. `weights` must be the same length as `items` and sum > 0. */
  pickWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** A fresh independent stream, derived deterministically from this one. */
  fork(): Rng {
    return new Rng(Math.floor(this.next() * 0xffffffff));
  }
}

/** A seed that is stable for a given level, so "Level 3" is always Level 3. */
export function levelSeed(runSeed: number, levelIndex: number): number {
  return (Math.imul(runSeed ^ (levelIndex + 1), 0x9e3779b1) >>> 0) || 1;
}

export function randomSeed(): number {
  return (Date.now() ^ Math.floor(performance.now() * 1000)) >>> 0 || 1;
}
