import Phaser from 'phaser';

/**
 * A built-in 5x7 pixel font.
 *
 * Phaser's Text object rasterises a system font INTO the low-res canvas, which
 * antialiases 8px glyphs into grey mush before we magnify the whole buffer 4x.
 * No `resolution` setting recovers detail that was never in the buffer.
 *
 * A bitmap font is authored on the pixel grid itself, so every upscale is a
 * clean integer multiply and the text stays perfectly sharp at any window size.
 * Generated into a texture at boot — no asset file, so the single-file build
 * stays single-file.
 *
 * Uppercase only. That is a deliberate arcade-panel look, and it halves the
 * glyph table; `pixelText` uppercases for you.
 */

const GLYPH_W = 5;
const GLYPH_H = 7;
const PAD = 1;
const PER_ROW = 16;

// Each glyph is 7 rows of 5 cells. '#' is on, '.' is off.
const GLYPHS: Record<string, string[]> = {
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..##.', '....#', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ',': ['.....', '.....', '.....', '.....', '.##..', '.##..', '.#...'],
  ':': ['.....', '.##..', '.##..', '.....', '.##..', '.##..', '.....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  '=': ['.....', '.....', '#####', '.....', '#####', '.....', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  "'": ['..#..', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '`': ['.#...', '..#..', '.....', '.....', '.....', '.....', '.....'],
  '(': ['...#.', '..#..', '.#...', '.#...', '.#...', '..#..', '...#.'],
  ')': ['.#...', '..#..', '...#.', '...#.', '...#.', '..#..', '.#...'],
  '<': ['...#.', '..#..', '.#...', '#....', '.#...', '..#..', '...#.'],
  '>': ['.#...', '..#..', '...#.', '....#', '...#.', '..#..', '.#...'],
  '%': ['#...#', '....#', '...#.', '..#..', '.#...', '#....', '#...#'],
  '_': ['.....', '.....', '.....', '.....', '.....', '.....', '#####'],
  '*': ['.....', '#.#.#', '.###.', '#####', '.###.', '#.#.#', '.....'],
};

export const FONT_KEY = 'pixel';
const TEX_KEY = 'pixel-font-tex';

/**
 * The size value Phaser treats as 1x for this font.
 *
 * `RetroFont.Parse` derives its internal `size` from glyph WIDTH, not height,
 * so this must be GLYPH_W. Passing GLYPH_H here renders at 1.4x — a fractional
 * scale, which reintroduces exactly the off-grid blur a bitmap font exists to
 * avoid. Only integer multiples of this value stay crisp.
 */
export const FONT_UNIT = GLYPH_W;

const CHARS = Object.keys(GLYPHS).join('');

/** Build the font texture once, at boot. */
export function createPixelFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.has(FONT_KEY)) return;

  const cols = PER_ROW;
  const rows = Math.ceil(CHARS.length / cols);

  const canvas = document.createElement('canvas');
  canvas.width = cols * (GLYPH_W + PAD);
  canvas.height = rows * (GLYPH_H + PAD);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('pixel font: could not get a 2d context');

  // White glyphs; colour comes from per-palette tinting at draw time.
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < CHARS.length; i++) {
    const glyph = GLYPHS[CHARS[i]];
    const gx = (i % cols) * (GLYPH_W + PAD);
    const gy = Math.floor(i / cols) * (GLYPH_H + PAD);
    for (let y = 0; y < GLYPH_H; y++) {
      const line = glyph[y];
      for (let x = 0; x < GLYPH_W; x++) {
        if (line[x] === '#') ctx.fillRect(gx + x, gy + y, 1, 1);
      }
    }
  }

  if (!scene.textures.exists(TEX_KEY)) scene.textures.addCanvas(TEX_KEY, canvas);

  scene.cache.bitmapFont.add(
    FONT_KEY,
    Phaser.GameObjects.RetroFont.Parse(scene, {
      image: TEX_KEY,
      'offset.x': 0,
      'offset.y': 0,
      width: GLYPH_W,
      height: GLYPH_H,
      chars: CHARS,
      charsPerRow: cols,
      'spacing.x': PAD,
      'spacing.y': PAD,
      lineSpacing: 3,
    }),
  );
}

export interface PixelTextOptions {
  /** Integer multiple of FONT_UNIT. Use 1, 2 or 3 to stay on the pixel grid. */
  scale?: number;
  color?: number;
  originX?: number;
  originY?: number;
}

/** Uppercases, since the font has no lowercase glyphs. */
export function upper(text: string): string {
  return text.toUpperCase();
}

export function pixelText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: PixelTextOptions = {},
): Phaser.GameObjects.BitmapText {
  const t = scene.add.bitmapText(x, y, FONT_KEY, upper(text), FONT_UNIT * (opts.scale ?? 1));
  t.setLetterSpacing(1);
  t.setOrigin(opts.originX ?? 0, opts.originY ?? 0);
  if (opts.color !== undefined) t.setTint(opts.color);
  return t;
}
