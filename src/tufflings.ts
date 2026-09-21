import Phaser from 'phaser';
import type { Palette } from './palette';

/**
 * Tufflings: the characters the player can pick. Every one shares the 10x14
 * hitbox; only the drawing differs.
 *
 * The eyes do all the talking. Each tuffling draws the same set of faces, and
 * exactly one face is ever showing — GameScene decides which, this module only
 * draws it. Faces are authored facing RIGHT and mirrored when facing left.
 */

export type Face =
  | 'default'
  | 'happy'
  | 'stressed'
  | 'focused'
  | 'thinking'
  | 'scared'
  | 'proud'
  | 'bonk'
  | 'dizzy'
  | 'sleepy'
  | 'starry';

export type TufflingId = 'dot' | 'button' | 'mochi' | 'peeper';

export interface Box {
  left: number;
  top: number;
  w: number;
  h: number;
}

type Mask = (x: number, y: number, w: number, h: number) => boolean;
type FaceFn = (pen: Pen, face: Face, t: number, pal: Palette, gaze: number) => void;

export interface TufflingDef {
  id: TufflingId;
  name: string;
  tagline: string;
  /** Drawn size at rest. Can differ from the hitbox; the hitbox never changes. */
  w: number;
  h: number;
  /** Soft shading, blush and dark button eyes, versus the flat classic look. */
  plush: boolean;
  /** Motion streak behind the body while focused. */
  streak: boolean;
  mask: Mask;
  faces: ReadonlySet<Face>;
  face: FaceFn;
}

// ---------------------------------------------------------------------------
// Colours and pixel patterns
// ---------------------------------------------------------------------------

export function blend(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

const SHINE = 0xffffff;
const SCLERA = 0xfffcf8;
const SWEAT = 0x8fd0f5;
const STAR = 0xffc93c;
const heartColor = (pal: Palette): number => blend(0xe8335f, pal.ink, 0.1);
const blushColor = (pal: Palette): number => blend(pal.player, 0xff5c7c, 0.5);

/**
 * A 5x4 heart. A 3x3 version was tried first and reads as a letter Y — there
 * are not enough pixels for the two lobes to register.
 */
const HEART = ['.#.#.', '#####', '.###.', '..#..'];
/** A motion streak trailing a forward-set eye. Deliberately unlike the squint. */
const FOCUS = ['##.##', '...##'];
const SWEAT_BEAD = ['.#', '##', '##'];
/** Thought dots rising away from the head: `[x, y, size]`. */
const THOUGHT_DOTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 5, 1],
  [2, 3, 1],
  [4, 0, 2],
];
/** One full "..." thought cycle, in seconds. */
const THOUGHT_CYCLE = 1.8;
const Z = ['####', '..#.', '.#..', '####'];
const PLUS = ['.#.', '###', '.#.'];
const CARET = ['.#.', '#.#'];
/** A 3x3 ring, walked clockwise. Dizzy pupils orbit it. */
const RING: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
  [0, 2],
  [0, 1],
];

function orbit(t: number, dir: 1 | -1): readonly [number, number] {
  const i = (((Math.floor(t * 10) * dir) % 8) + 8) % 8;
  return RING[i];
}

/** A quick blink every few seconds, now and then a double. Purely visual. */
function blinking(t: number): boolean {
  const p = t % 3.6;
  return p < 0.12 || (p > 1.9 && p < 2.0 && Math.floor(t / 3.6) % 3 === 1);
}

const twinkle = (t: number): boolean => Math.floor(t * 4) % 2 === 1;

// ---------------------------------------------------------------------------
// Drawing, mirrored to facing
// ---------------------------------------------------------------------------

/**
 * Draws in the tuffling's own coordinates, authored facing right. `f` clips to
 * the body so a squashed tuffling never grows face pixels in mid-air; `x` is for
 * things that belong outside the body — sweat, stars, thought dots.
 */
class Pen {
  constructor(
    readonly g: Phaser.GameObjects.Graphics,
    readonly box: Box,
    readonly facing: number,
    readonly mask: Mask,
  ) {}

  inside(lx: number, ly: number): boolean {
    const { w, h } = this.box;
    return lx >= 0 && ly >= 0 && lx < w && ly < h && this.mask(lx, ly, w, h);
  }

  private at(lx: number, width: number): number {
    return this.facing >= 0 ? this.box.left + lx : this.box.left + this.box.w - lx - width;
  }

  /** Outside-the-body drawing, unclipped. */
  x(lx: number, ly: number, w: number, h: number, c: number): void {
    this.g.fillStyle(c, 1);
    this.g.fillRect(this.at(lx, w), this.box.top + ly, w, h);
  }

  /** Face drawing, clipped to the body. */
  f(lx: number, ly: number, w: number, h: number, c: number): void {
    this.g.fillStyle(c, 1);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        if (!this.inside(lx + i, ly + j)) continue;
        this.g.fillRect(this.at(lx + i, 1), this.box.top + ly + j, 1, 1);
      }
    }
  }

  pat(lx: number, ly: number, rows: readonly string[], c: number, clip = true): void {
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j];
      for (let i = 0; i < row.length; i++) {
        if (row[i] !== '#') continue;
        if (clip) this.f(lx + i, ly + j, 1, 1, c);
        else this.x(lx + i, ly + j, 1, 1, c);
      }
    }
  }

  /** Scale a row authored at rest height onto the current, squashed height. */
  row(n: number, restH: number): number {
    return Math.round((n * this.box.h) / restH);
  }
}

// ---------------------------------------------------------------------------
// Body shapes
// ---------------------------------------------------------------------------

/** Rounded top with exponent `n`, flatter base with exponent `nb`. */
const superellipse =
  (n: number, nb: number): Mask =>
  (x, y, w, h) => {
    const dx = (x + 0.5 - w / 2) / (w / 2);
    const dy = (y + 0.5 - h / 2) / (h / 2);
    const e = dy > 0 ? nb : n;
    return Math.abs(dx) ** e + Math.abs(dy) ** e <= 1.0001;
  };

/** The classic block: a rectangle missing one pixel at each corner. */
const roundedRect: Mask = (x, y, w, h) => !((x === 0 || x === w - 1) && (y === 0 || y === h - 1));

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

/** The original: background-coloured cut-outs, one mark per mood. */
const faceDot: FaceFn = (pen, face, _t, pal) => {
  const cut = pal.bg;
  const w = pen.box.w;
  const ex = w - 4;
  switch (face) {
    case 'stressed':
      pen.f(ex - 1, 4, 3, 1, cut);
      break;
    case 'happy':
      pen.pat(w - 6, 2, HEART, cut);
      break;
    case 'focused':
      pen.pat(w - 6, 3, FOCUS, cut);
      break;
    case 'scared':
      // Two wide eyes. Every other face here is one mark, so a pair reads
      // instantly as startled.
      pen.f(Math.round(w * 0.18), 3, 2, 2, cut);
      pen.f(Math.round(w * 0.58), 3, 2, 2, cut);
      break;
    default:
      pen.f(ex, 3, 2, 2, cut);
  }
};

/** The original's one-mark language, stuffed: a dark button eye set lower. */
const faceButton: FaceFn = (pen, face, t, pal, gaze) => {
  const ink = pal.ink;
  const w = pen.box.w;
  const ex = w - 4;
  const ey = pen.row(5, 14) + gaze;
  const blush = (): void => {
    pen.f(ex - 3, ey + 3, 2, 1, blushColor(pal));
    pen.f(ex + 2, ey + 3, 1, 1, blushColor(pal));
  };
  const button = (x: number, y: number): void => {
    pen.f(x, y, 2, 2, ink);
    pen.f(x, y, 1, 1, SHINE);
  };
  switch (face) {
    case 'happy': {
      const hx = w - 6;
      pen.pat(hx, ey - 1, HEART, heartColor(pal));
      pen.f(hx + 1, ey, 1, 1, SHINE);
      blush();
      break;
    }
    case 'stressed':
      pen.f(ex - 1, ey + 1, 3, 1, ink);
      break;
    case 'focused': {
      const fx = w - 6;
      pen.pat(fx, ey, FOCUS, ink);
      pen.f(fx + 3, ey, 1, 1, SHINE);
      blush();
      break;
    }
    case 'thinking':
      button(ex, ey - 1);
      blush();
      break;
    case 'scared':
      button(Math.round(w * 0.18), ey);
      button(Math.round(w * 0.58), ey);
      break;
    case 'proud':
      pen.pat(ex - 1, ey, CARET, ink);
      blush();
      break;
    case 'bonk':
      pen.pat(ex, ey - 1, ['#.', '.#', '#.'], ink);
      break;
    case 'dizzy': {
      pen.f(ex - 1, ey - 1, 3, 3, SCLERA);
      const [ox, oy] = orbit(t, 1);
      pen.f(ex - 1 + ox, ey - 1 + oy, 1, 1, ink);
      break;
    }
    case 'sleepy':
      pen.f(ex, ey + 1, 2, 1, ink);
      blush();
      break;
    case 'starry':
      pen.pat(ex - 1, ey - 1, PLUS, ink);
      pen.f(ex, ey, 1, 1, twinkle(t) ? SHINE : STAR);
      blush();
      break;
    default:
      if (blinking(t)) pen.f(ex, ey + 1, 2, 1, ink);
      else button(ex, ey);
      blush();
  }
};

/** Two tall button eyes, low and wide. */
const faceMochi: FaceFn = (pen, face, t, pal, gaze) => {
  const ink = pal.ink;
  const w = pen.box.w;
  const L = Math.round(w / 2) - 2;
  const R = L + 4;
  const ey = pen.row(6, 14) + gaze;
  const blush = (): void => {
    pen.f(L - 1, ey + 4, 2, 1, blushColor(pal));
    pen.f(R + 1, ey + 4, 2, 1, blushColor(pal));
  };
  const eye = (x: number, y: number): void => {
    pen.f(x, y, 2, 3, ink);
    pen.f(x, y, 1, 1, SHINE);
  };
  switch (face) {
    case 'happy': {
      const hx = Math.round(w / 2) - 5;
      const c = heartColor(pal);
      pen.pat(hx, ey - 1, HEART, c);
      pen.pat(hx + 5, ey - 1, HEART, c);
      pen.f(hx + 1, ey, 1, 1, SHINE);
      pen.f(hx + 6, ey, 1, 1, SHINE);
      blush();
      break;
    }
    case 'stressed':
      pen.f(L - 1, ey + 1, 3, 1, ink);
      pen.f(R, ey + 1, 3, 1, ink);
      break;
    case 'focused':
      pen.pat(L, ey + 1, ['.#', '##'], ink);
      pen.pat(R, ey + 1, ['.#', '##'], ink);
      blush();
      break;
    case 'thinking':
      eye(L + 1, ey - 2);
      eye(R + 1, ey - 2);
      blush();
      break;
    case 'scared':
      // Two eyes is the default here, so fear is white eyes with pinprick pupils.
      pen.f(L - 1, ey - 1, 3, 3, SCLERA);
      pen.f(R, ey - 1, 3, 3, SCLERA);
      pen.f(L, ey, 1, 1, ink);
      pen.f(R + 1, ey, 1, 1, ink);
      break;
    case 'proud':
      pen.pat(L - 1, ey, CARET, ink);
      pen.pat(R, ey, CARET, ink);
      blush();
      break;
    case 'bonk':
      pen.pat(L, ey, ['#.', '.#', '#.'], ink);
      pen.pat(R, ey, ['.#', '#.', '.#'], ink);
      break;
    case 'dizzy': {
      pen.f(L - 1, ey - 1, 3, 3, SCLERA);
      pen.f(R, ey - 1, 3, 3, SCLERA);
      // Opposite directions: one pair of eyes can do what one eye cannot.
      const [ax, ay] = orbit(t, 1);
      const [bx, by] = orbit(t, -1);
      pen.f(L - 1 + ax, ey - 1 + ay, 1, 1, ink);
      pen.f(R + bx, ey - 1 + by, 1, 1, ink);
      break;
    }
    case 'sleepy':
      pen.pat(L - 1, ey + 1, ['#.#', '.#.'], ink);
      pen.pat(R, ey + 1, ['#.#', '.#.'], ink);
      blush();
      break;
    case 'starry': {
      const c = twinkle(t) ? SHINE : STAR;
      pen.pat(L - 1, ey - 1, PLUS, ink);
      pen.pat(R, ey - 1, PLUS, ink);
      pen.f(L, ey, 1, 1, c);
      pen.f(R + 1, ey, 1, 1, c);
      blush();
      break;
    }
    default:
      if (blinking(t)) {
        pen.f(L, ey + 2, 2, 1, ink);
        pen.f(R, ey + 2, 2, 1, ink);
      } else {
        eye(L, ey);
        eye(R, ey);
      }
      blush();
  }
};

/** One big eye: a white, a pupil and a lid. The lid carries the mood. */
const facePeeper: FaceFn = (pen, face, t, pal, gaze) => {
  const ink = pal.ink;
  const w = pen.box.w;
  const ex = Math.round(w / 2) - 1;
  const ey = pen.row(4, 14);
  const lid = blend(pal.player, pal.ink, 0.45);
  const blush = (): void => {
    pen.f(ex - 3, ey + 6, 2, 1, blushColor(pal));
    pen.f(ex + 5, ey + 6, 1, 1, blushColor(pal));
  };
  /** The eye white from row `from` down; rows above stay lid. */
  const sclera = (from = 0): void => {
    for (let y = from; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        if ((x === 0 || x === 4) && (y === 0 || y === 4)) continue;
        pen.f(ex + x, ey + y, 1, 1, SCLERA);
      }
    }
    if (from > 0) pen.f(ex + (from === 4 ? 1 : 0), ey + from - 1, from === 4 ? 3 : 5, 1, lid);
  };
  const pupil = (x: number, y: number): void => {
    pen.f(x, y, 2, 2, ink);
    pen.f(x, y, 1, 1, SHINE);
  };
  switch (face) {
    case 'happy':
      pen.pat(ex, ey, HEART, heartColor(pal));
      pen.f(ex + 1, ey + 1, 1, 1, SHINE);
      blush();
      break;
    case 'stressed':
      sclera(3);
      pen.f(ex + 2 + (Math.floor(t * 12) % 2), ey + 3, 1, 2, ink);
      break;
    case 'focused':
      sclera(1);
      pen.f(ex + 2, ey + 1, 3, 1, lid);
      pupil(ex + 3, ey + 2);
      break;
    case 'thinking':
      sclera();
      pupil(ex + 3, ey + 1);
      blush();
      break;
    case 'scared':
      sclera();
      pen.f(ex + 2, ey + 2, 1, 1, ink);
      break;
    case 'proud':
      pen.pat(ex, ey + 1, ['..#..', '.#.#.', '#...#'], ink);
      blush();
      break;
    case 'bonk':
      pen.pat(ex + 1, ey, ['#..', '.#.', '..#', '.#.', '#..'], ink);
      break;
    case 'dizzy': {
      sclera();
      const [ox, oy] = orbit(t, 1);
      pen.f(ex + 1 + ox, ey + 1 + oy, 1, 1, ink);
      break;
    }
    case 'sleepy':
      if (t % 3 < 2) {
        sclera(4);
        pen.f(ex + 3, ey + 4, 1, 1, ink);
      } else {
        pen.f(ex, ey + 3, 5, 1, ink);
      }
      blush();
      break;
    case 'starry':
      sclera();
      pen.pat(ex + 1, ey + 1, PLUS, heartColor(pal));
      pen.f(ex + 2, ey + 2, 1, 1, twinkle(t) ? SHINE : STAR);
      blush();
      break;
    default:
      if (blinking(t)) pen.f(ex, ey + 3, 5, 1, ink);
      else {
        sclera();
        pupil(ex + 2, ey + 2 + gaze);
      }
      blush();
  }
};

// ---------------------------------------------------------------------------
// The roster
// ---------------------------------------------------------------------------

const CLASSIC_FACES: ReadonlySet<Face> = new Set<Face>([
  'default',
  'happy',
  'stressed',
  'focused',
  'thinking',
  'scared',
]);
const ALL_FACES: ReadonlySet<Face> = new Set<Face>([
  ...CLASSIC_FACES,
  'proud',
  'bonk',
  'dizzy',
  'sleepy',
  'starry',
]);

export const TUFFLINGS: readonly TufflingDef[] = [
  {
    id: 'mochi',
    name: 'Mochi',
    tagline: 'Two button eyes, low and wide',
    w: 12,
    h: 14,
    plush: true,
    streak: true,
    mask: superellipse(2.3, 4.5),
    faces: ALL_FACES,
    face: faceMochi,
  },
  {
    id: 'button',
    name: 'Button',
    tagline: 'One shiny button eye',
    w: 10,
    h: 14,
    plush: true,
    streak: false,
    mask: superellipse(3.2, 5),
    faces: ALL_FACES,
    face: faceButton,
  },
  {
    id: 'peeper',
    name: 'Peeper',
    tagline: 'One big eye that says it all',
    w: 12,
    h: 14,
    plush: true,
    streak: true,
    mask: superellipse(2.8, 5),
    faces: ALL_FACES,
    face: facePeeper,
  },
  {
    id: 'dot',
    name: 'Classic',
    tagline: 'The original block, six moods',
    w: 10,
    h: 14,
    plush: false,
    streak: false,
    mask: roundedRect,
    faces: CLASSIC_FACES,
    face: faceDot,
  },
];

export const DEFAULT_TUFFLING: TufflingId = 'mochi';

export function tufflingById(id: TufflingId): TufflingDef {
  return TUFFLINGS.find((p) => p.id === id) ?? TUFFLINGS[0];
}

// Stored per-browser, guarded like progress: private windows and blocked site
// data make localStorage throw or return nothing.
const KEY = 'foothold.tuffling';

export function loadTufflingId(): TufflingId {
  try {
    const v = localStorage.getItem(KEY);
    if (v && TUFFLINGS.some((p) => p.id === v)) return v as TufflingId;
  } catch {
    /* fall through to the default */
  }
  return DEFAULT_TUFFLING;
}

export function saveTufflingId(id: TufflingId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* not persisted; the pick still holds for this session's scenes */
  }
}

// ---------------------------------------------------------------------------
// Drawing a tuffling
// ---------------------------------------------------------------------------

/**
 * Draw `def` showing `face` inside `box` (integer pixels, feet at the bottom).
 * `t` drives blinks and little loops; `gaze` is -1 looking up, 1 looking down.
 * A face the tuffling does not have falls back to its default.
 */
export function drawTuffling(
  g: Phaser.GameObjects.Graphics,
  def: TufflingDef,
  face: Face,
  box: Box,
  facing: number,
  pal: Palette,
  t: number,
  gaze = 0,
): void {
  const pen = new Pen(g, box, facing, def.mask);
  const { w, h } = box;

  // Body, one horizontal run at a time. Plush bodies are lit from the top-left
  // with a shaded base, so they read as stuffed rather than cut from card.
  const lit = blend(pal.player, 0xffffff, 0.3);
  const shade = blend(pal.player, 0x000000, 0.13);
  for (let y = 0; y < h; y++) {
    let runStart = -1;
    let runColor = 0;
    for (let x = 0; x <= w; x++) {
      let c = -1;
      if (x < w && pen.inside(x, y)) {
        c = pal.player;
        if (def.plush) {
          if (!pen.inside(x, y + 1)) c = shade;
          else if (!pen.inside(x, y - 1) && x < w * 0.55) c = lit;
        }
      }
      if (c !== runColor || c === -1) {
        if (runStart >= 0) pen.x(runStart, y, x - runStart, 1, runColor);
        runStart = c === -1 ? -1 : x;
        runColor = c;
      }
    }
  }

  // Too thin to carry a face (the last sliver squeezing into the portal).
  const shown = def.faces.has(face) ? face : 'default';
  if (w >= 5) def.face(pen, shown, t, pal, gaze);
  drawExtras(pen, def, shown, t, pal);
}

function drawExtras(pen: Pen, def: TufflingDef, face: Face, t: number, pal: Palette): void {
  const { w } = pen.box;

  if (face === 'thinking') {
    const phase = (t % THOUGHT_CYCLE) / THOUGHT_CYCLE;
    const shown = phase < 0.22 ? 1 : phase < 0.44 ? 2 : phase < 0.85 ? 3 : 0;
    const c = def.plush ? blend(pal.ink, pal.bg, 0.45) : pal.player;
    const bx = Math.round(w * 0.5);
    for (let i = 0; i < shown; i++) {
      const [dx, dy, s] = THOUGHT_DOTS[i];
      pen.x(bx + dx, dy - 9, s, s, c);
    }
  }

  // Sweat bead, off the trailing edge so it never sits on the face.
  if (face === 'stressed') {
    const sy = Math.round(((t * 2.2) % 1) * 7);
    pen.pat(-3, sy, SWEAT_BEAD, def.plush ? SWEAT : pal.player, false);
    if (def.plush) pen.x(-2, sy + 1, 1, 1, SHINE);
  }

  if (!def.plush) return;

  if (face === 'focused' && def.streak) {
    const c = blend(pal.player, pal.bg, 0.5);
    for (let i = 0; i < 3; i++) {
      const len = 2 + ((Math.floor(t * 12) + i) % 3);
      pen.x(-2 - len, 4 + i * 3, len, 1, c);
    }
  }

  // Stars circling the head after a bonk.
  if (face === 'bonk') {
    for (let i = 0; i < 3; i++) {
      const a = t * 5 + i * 2.094;
      pen.x(Math.round(w / 2 + Math.cos(a) * 5), -3 + Math.round(Math.sin(a) * 1.6), 1, 1, STAR);
    }
  }

  if (face === 'sleepy') {
    const c = blend(pal.ink, pal.bg, 0.4);
    const p = (t % 2.4) / 2.4;
    pen.pat(w, -4 - Math.round(p * 5), Z, c, false);
    if (p > 0.5) pen.x(w - 2, -1, 2, 1, c);
  }

  if (face === 'starry') {
    const spots: ReadonlyArray<readonly [number, number, number]> = [
      [-3, -2, 0],
      [w + 1, 1, 0.33],
      [w - 3, -6, 0.66],
    ];
    for (const [sx, sy, off] of spots) {
      if ((t * 1.6 + off) % 1 < 0.5) {
        pen.pat(sx - 1, sy - 1, PLUS, STAR, false);
        pen.x(sx, sy, 1, 1, SHINE);
      } else {
        pen.x(sx, sy, 1, 1, STAR);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Previews (menus), where there is no physics to supply the motion
// ---------------------------------------------------------------------------

/** A mood to preview: every face, plus a jump to show the eyes following it. */
export type PreviewMood = Face | 'jump';

export const PREVIEW_MOODS: ReadonlyArray<{ mood: PreviewMood; label: string }> = [
  { mood: 'default', label: 'Just hanging out' },
  { mood: 'happy', label: 'Delighted' },
  { mood: 'stressed', label: 'Stressed' },
  { mood: 'focused', label: 'Focused' },
  { mood: 'thinking', label: 'Thinking' },
  { mood: 'scared', label: 'Nervous' },
  { mood: 'jump', label: 'Whee!' },
  { mood: 'proud', label: 'Proud' },
  { mood: 'bonk', label: 'Ouch' },
  { mood: 'dizzy', label: 'Dizzy' },
  { mood: 'sleepy', label: 'Sleepy' },
  { mood: 'starry', label: 'Starry-eyed' },
];

/**
 * Draw a tuffling acting out `mood` with its feet at (`cx`, `feetY`), animated
 * by `t`. The classic block has none of the new faces and just stands there
 * for those, which is honest about what it does in game.
 */
export function drawTufflingPreview(
  g: Phaser.GameObjects.Graphics,
  def: TufflingDef,
  mood: PreviewMood,
  cx: number,
  feetY: number,
  facing: number,
  pal: Palette,
  t: number,
): void {
  const face: Face = mood === 'jump' ? 'default' : def.faces.has(mood) ? mood : 'default';
  let yOff = 0;
  let dw = 0;
  let dh = 0;
  let dx = 0;
  let gaze = 0;

  // Breathing, for the plush ones at rest.
  if (def.plush && (face === 'default' || face === 'thinking' || face === 'scared' || face === 'starry')) {
    dh = t % 2.4 < 1.2 ? 0 : -1;
  }
  if (face === 'scared') dx = Math.floor(t * 14) % 2;
  if (def.plush) {
    if (face === 'happy' || face === 'proud') {
      const p = t % 1.0;
      if (p < 0.32) yOff = -Math.round((face === 'happy' ? 4 : 3) * Math.sin((Math.PI * p) / 0.32));
      else if (p < 0.4) {
        dh = -1;
        dw = 1;
      }
    } else if (face === 'focused') {
      yOff = -(Math.floor(t * 9) % 2);
    } else if (face === 'bonk') {
      const p = t % 1.6;
      if (p < 0.12) {
        dh = -2;
        dw = 2;
      } else if (p < 0.25) {
        dh = -1;
        dw = 1;
      }
    } else if (face === 'dizzy') {
      dx = Math.round(Math.sin(t * 5));
    } else if (face === 'sleepy') {
      dh = t % 3 < 1.5 ? 0 : -1;
    }
  }
  if (mood === 'jump') {
    const p = t % 1.4;
    if (p < 1.0) {
      yOff = -Math.round(13 * Math.sin(Math.PI * p));
      dh = 1;
      dw = -1;
      gaze = p < 0.4 ? -1 : p > 0.6 ? 1 : 0;
    } else if (p < 1.1) {
      dh = -2;
      dw = 2;
    }
  }

  const w = def.w + dw;
  const h = def.h + dh;
  drawTuffling(
    g,
    def,
    face,
    { left: Math.round(cx - w / 2) + dx, top: feetY - h + yOff, w, h },
    facing,
    pal,
    t,
    gaze,
  );
}
