import type Phaser from 'phaser';

/**
 * Trophies: one tucked away in each level, purely to find and show off. They
 * do nothing for play — no score, no unlocks — and are often easiest to reach
 * with a particular Tuffling, which is a reason to try them all.
 *
 * Drawn as tiny pixel sprites in their own colours (not the level palette), so
 * a trophy always looks like the same object wherever it turns up.
 */

export interface Trophy {
  name: string;
  /** Pixel rows: '.' empty, then single-letter colour keys from `colors`. */
  pixels: string[];
  colors: Record<string, number>;
}

export const TROPHIES: readonly Trophy[] = [
  {
    name: 'Lost Button',
    pixels: ['..aaaaa..', '.abbbbba.', 'abbbbbbba', 'abcbbbcba', 'abbbbbbba', 'abcbbbcba', 'abbbbbbba', '.abbbbba.', '..aaaaa..'],
    colors: { a: 0x7a4a6e, b: 0xe98fb7, c: 0x7a4a6e },
  },
  {
    name: 'Tiny Crown',
    pixels: ['a...a...a', 'aa.aaa.aa', 'aaaaaaaaa', 'abacacaba', 'aaaaaaaaa', 'ddddddddd'],
    colors: { a: 0xf2c14e, b: 0xe8335f, c: 0x5b93c9, d: 0xc9962c },
  },
  {
    name: 'Star Sticker',
    pixels: ['....a....', '....a....', '...aaa...', 'aaaabaaaa', '.aaabaaa.', '..aaaaa..', '..aa.aa..', '.aa...aa.', '.a.....a.'],
    colors: { a: 0xffcf4a, b: 0xfff3b0 },
  },
  {
    name: 'Odd Sock',
    pixels: ['..aaaa', '..bbbb', '..aaaa', '..bbbb', '..aaaa', '.aaaaa', 'aaaaaa', 'aaaaa.', '.aaa..'],
    colors: { a: 0x6fc9b8, b: 0xfdfbf7 },
  },
  {
    name: 'Heart Balloon',
    pixels: ['.aa.aa.', 'abaaaaa', 'aaaaaaa', 'aaaaaaa', '.aaaaa.', '..aaa..', '...a...', '...c...', '..c....', '...c...'],
    colors: { a: 0xef5b7a, b: 0xffd3dd, c: 0x8a7f94 },
  },
  {
    name: 'Golden Acorn',
    pixels: ['...c...', '.aaaaa.', 'aaaaaaa', 'bbbbbbb', 'bbbdbbb', 'bbbbbbb', '.bbbbb.', '..bbb..'],
    colors: { a: 0x9c6b3f, b: 0xf2c14e, c: 0x6b4a2b, d: 0xfff3b0 },
  },
];

/** The trophy for a hand-built level: a little wrapped present. */
export const CUSTOM_TROPHY: Trophy = {
  name: 'Present',
  pixels: ['..b.b..', '...b...', 'aaabaaa', 'aaabaaa', 'bbbbbbb', 'aaabaaa', 'aaabaaa'],
  colors: { a: 0x8fc7e8, b: 0xef5b7a },
};

/** Colour mix, local so this module (and the editor) never loads the game. */
function blend(a: number, b: number, t: number): number {
  const ch = (sh: number): number => {
    const x = (a >> sh) & 255;
    const y = (b >> sh) & 255;
    return Math.round(x + (y - x) * t) << sh;
  };
  return ch(16) | ch(8) | ch(0);
}

export function trophyFor(levelIndex: number): Trophy {
  return TROPHIES[levelIndex % TROPHIES.length];
}

/**
 * Draw `t` centred on (cx, cy).
 *   ghostInto   a faint outline of itself, washed toward this colour: the
 *               level's trophy after you already have it
 *   silhouette  every pixel this one colour: a trophy not found yet
 */
export function drawTrophy(
  g: Pick<Phaser.GameObjects.Graphics, 'fillStyle' | 'fillRect'>,
  t: Trophy,
  cx: number,
  cy: number,
  style: { ghostInto?: number; silhouette?: number } = {},
): void {
  const h = t.pixels.length;
  const w = t.pixels[0].length;
  const x0 = Math.round(cx - w / 2);
  const y0 = Math.round(cy - h / 2);
  const ghost = style.ghostInto !== undefined;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = t.pixels[y][x];
      if (k === '.') continue;
      const c = t.colors[k];
      if (style.silhouette !== undefined) g.fillStyle(style.silhouette, 1);
      else if (ghost) g.fillStyle(blend(c, style.ghostInto!, 0.72), 0.7);
      else g.fillStyle(c, 1);
      g.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Which trophies you have. This browser only, guarded like progress.
// ---------------------------------------------------------------------------

const KEY = 'foothold.trophies';

export function loadTrophies(): Set<number> {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((n): n is number => typeof n === 'number') : []);
  } catch {
    return new Set();
  }
}

export function saveTrophy(levelIndex: number): void {
  try {
    const have = loadTrophies();
    have.add(levelIndex);
    localStorage.setItem(KEY, JSON.stringify([...have].sort((a, b) => a - b)));
  } catch {
    /* not persisted; it still counts for this visit */
  }
}
