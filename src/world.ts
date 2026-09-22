import {
  ALL_CHUNKS,
  CHUNK_H,
  CHUNK_W,
  ChunkDef,
  ChunkFamily,
  STEP,
  findMarker,
} from './chunks';
import { Rng } from './rng';
import { PLAYER_H, TILE } from './tuning';

/**
 * Levels are built in full, up front, from a seed.
 *
 * At MVP scale (~16-33 chunks) the whole level is a few hundred KB of tiles and
 * a few dozen bots, so streaming and recycling buy nothing and cost bugs.
 * Terrain is drawn once into a Graphics and the camera just scrolls over it.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SpawnKind = 'turret' | 'walker' | 'flyer';

export interface Spawn {
  kind: SpawnKind;
  /** Pixel centre. */
  x: number;
  y: number;
}

export interface PlacedChunk {
  def: ChunkDef;
  /** Tile origin in world space. */
  ox: number;
  oy: number;
}

export class TileGrid {
  readonly data: Uint8Array;

  constructor(
    readonly minTx: number,
    readonly minTy: number,
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint8Array(w * h);
  }

  set(tx: number, ty: number, v: number): void {
    const lx = tx - this.minTx;
    const ly = ty - this.minTy;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return;
    this.data[ly * this.w + lx] = v;
  }

  solidAt(tx: number, ty: number): boolean {
    const lx = tx - this.minTx;
    const ly = ty - this.minTy;
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return false;
    return this.data[ly * this.w + lx] === 1;
  }

  solidAtPx(x: number, y: number): boolean {
    return this.solidAt(Math.floor(x / TILE), Math.floor(y / TILE));
  }

  /** Does an axis-aligned box overlap any solid tile? */
  overlapsSolid(x: number, y: number, w: number, h: number): boolean {
    const x0 = Math.floor(x / TILE);
    const x1 = Math.floor((x + w - 0.001) / TILE);
    const y0 = Math.floor(y / TILE);
    const y1 = Math.floor((y + h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (this.solidAt(tx, ty)) return true;
      }
    }
    return false;
  }
}

export interface BuiltLevel {
  grid: TileGrid;
  /** Merged terrain rectangles, in pixels. Drawn once. */
  terrain: Rect[];
  spikes: Rect[];
  spawns: Spawn[];
  chunks: PlacedChunk[];
  /** Player spawn, pixel centre. */
  startX: number;
  startY: number;
  goal: Rect;
  /** Unit vector of progress. */
  axis: { x: number; y: number };
  /** Total progress distance in px from start to goal. */
  totalDistance: number;
  /** World bounds in pixels. */
  bounds: Rect;
  /**
   * Hand-built levels: the camera simply follows the player within the bounds,
   * and the kill plane is the bottom of the bounds. Generated levels frame by
   * chunk instead.
   */
  freeCamera?: boolean;
  /** Where this level's trophy sits (pixel box), if it has one. */
  trophy?: Rect;
}

/** A trophy's pickup box: a tile-centred 12x12, a touch smaller than a tile. */
function trophyBox(tx: number, ty: number): Rect {
  return { x: tx * TILE + 2, y: ty * TILE + 2, w: TILE - 4, h: TILE - 4 };
}

/**
 * Trophy spots are marked 'C' in chunks, and a level usually contains several.
 * Exactly one is used: the one nearest 60% of the way through, so the trophy
 * sits in the meat of the level rather than at either end. Chosen from the
 * layout alone — no RNG draw — so it can never disturb the level's seed.
 */
function pickTrophySpot(placed: PlacedChunk[]): { tx: number; ty: number } | null {
  let best: { tx: number; ty: number } | null = null;
  let bestD = Infinity;
  const aim = (placed.length - 1) * 0.6;
  placed.forEach((p, i) => {
    const c = findMarker(p.def.rows, 'C');
    if (!c) return;
    const d = Math.abs(i - aim);
    if (d < bestD) {
      bestD = d;
      best = { tx: p.ox + c.x, ty: p.oy + c.y };
    }
  });
  return best;
}

export interface LevelBuildSpec {
  family: ChunkFamily;
  chunkCount: number;
  /** 0..1 multiplier on how fast difficulty ramps. */
  difficultyScale: number;
  /** Which bot kinds this level is allowed to use. */
  enemyMix: SpawnKind[];
}

function axisUnit(family: ChunkFamily): { x: number; y: number } {
  const s = STEP[family];
  const len = Math.hypot(s.x, s.y);
  return { x: s.x / len, y: s.y / len };
}

/** Greedy rectangle merging. One colour everywhere, so merged rects look identical. */
function mergeRects(grid: TileGrid): Rect[] {
  const { w, h, minTx, minTy, data } = grid;
  const used = new Uint8Array(w * h);
  const out: Rect[] = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (data[i] !== 1 || used[i]) continue;

      // Extend right.
      let rw = 1;
      while (x + rw < w && data[i + rw] === 1 && !used[i + rw]) rw++;

      // Extend down while the full width stays solid and unused.
      let rh = 1;
      outer: while (y + rh < h) {
        const row = (y + rh) * w + x;
        for (let k = 0; k < rw; k++) {
          if (data[row + k] !== 1 || used[row + k]) break outer;
        }
        rh++;
      }

      for (let yy = 0; yy < rh; yy++) {
        used.fill(1, (y + yy) * w + x, (y + yy) * w + x + rw);
      }

      out.push({
        x: (minTx + x) * TILE,
        y: (minTy + y) * TILE,
        w: rw * TILE,
        h: rh * TILE,
      });
    }
  }
  return out;
}

/** How far below a chunk the visual ground extends, in tiles. */
const SKIRT_TILES = 12;

/**
 * Purely visual: extend solid ground downward past the bottom of each chunk so
 * terrain reads as ground rather than as floating slabs. Pits stay open, since
 * a pit has nothing solid on the chunk's bottom row to extend.
 *
 * Not added to the collision grid — it only ever sits below the kill plane.
 * Skipped for vertical levels, where a chunk's underside is the previous
 * chunk's playable space (and floating platforms are the intended look).
 */
function addGroundSkirt(terrain: Rect[], placed: PlacedChunk[], family: ChunkFamily): void {
  if (family === 'v') return;

  for (const p of placed) {
    const bottomRow = p.def.rows[CHUNK_H - 1];
    let run = -1;
    for (let x = 0; x <= CHUNK_W; x++) {
      const solid = x < CHUNK_W && bottomRow[x] === '#';
      if (solid && run < 0) {
        run = x;
      } else if (!solid && run >= 0) {
        terrain.push({
          x: (p.ox + run) * TILE,
          y: (p.oy + CHUNK_H) * TILE,
          w: (x - run) * TILE,
          h: SKIRT_TILES * TILE,
        });
        run = -1;
      }
    }
  }
}

function pickChunk(
  rng: Rng,
  family: ChunkFamily,
  maxDifficulty: number,
  recent: string[],
  drift: number,
  allowBotGated: boolean,
): ChunkDef {
  const pool = ALL_CHUNKS.filter((c) => c.family === family);
  let candidates = pool.filter(
    (c) => c.difficulty <= maxDifficulty && (allowBotGated || !c.botGated),
  );
  if (!candidates.length) candidates = pool.filter((c) => !c.botGated);
  if (!candidates.length) candidates = pool;

  // Avoid repeating a chunk too soon.
  const fresh = candidates.filter((c) => !recent.includes(c.id));
  const finalPool = fresh.length ? fresh : candidates;

  const weights = finalPool.map((c) => {
    const e = findMarker(c.rows, 'E')!;
    const x = findMarker(c.rows, 'X')!;
    let w = 1;

    // Favour the current difficulty band so levels ramp instead of averaging out.
    w *= 1 + c.difficulty * 0.35;

    // Counteract drift: prefer chunks that pull the run back toward its baseline.
    if (family === 'h') {
      const newDrift = drift + (x.y - e.y);
      w *= 1 / (1 + Math.abs(newDrift) * 0.25);
    } else if (family === 'v') {
      const newDrift = drift + (x.x - e.x);
      w *= 1 / (1 + Math.abs(newDrift) * 0.3);
    }
    return w;
  });

  return rng.pickWeighted(finalPool, weights);
}

export function buildLevel(spec: LevelBuildSpec, rng: Rng): BuiltLevel {
  const { family, chunkCount } = spec;
  const step = STEP[family];
  const placed: PlacedChunk[] = [];
  const recent: string[] = [];
  let drift = 0;

  let ox = 0;
  let oy = 0;

  for (let i = 0; i < chunkCount; i++) {
    const t = chunkCount <= 1 ? 1 : i / (chunkCount - 1);
    // Ramp 0 -> 3, scaled per level. First two chunks are always a warmup.
    let maxDiff = Math.min(3, Math.floor(t * 3 * spec.difficultyScale + 0.35));
    if (i < 2) maxDiff = Math.min(maxDiff, i);

    const def = pickChunk(rng, family, maxDiff, recent.slice(-3), drift, i > 1);

    if (placed.length) {
      const prev = placed[placed.length - 1];
      const prevExit = findMarker(prev.def.rows, 'X')!;
      const entry = findMarker(def.rows, 'E')!;

      if (family === 'h') {
        ox = prev.ox + step.x;
        oy = prev.oy + prevExit.y - entry.y;
        drift += prevExit.y - entry.y;
      } else if (family === 'v') {
        ox = prev.ox + prevExit.x - entry.x;
        oy = prev.oy + step.y;
        drift += prevExit.x - entry.x;
      } else {
        ox = prev.ox + step.x;
        oy = prev.oy + step.y;
      }
    }

    placed.push({ def, ox, oy });
    recent.push(def.id);
  }

  // --- Bounds -------------------------------------------------------------
  let minTx = Infinity;
  let minTy = Infinity;
  let maxTx = -Infinity;
  let maxTy = -Infinity;
  for (const p of placed) {
    minTx = Math.min(minTx, p.ox);
    minTy = Math.min(minTy, p.oy);
    maxTx = Math.max(maxTx, p.ox + CHUNK_W);
    maxTy = Math.max(maxTy, p.oy + CHUNK_H);
  }
  // Pad so the camera and kill plane have room.
  minTx -= 2;
  minTy -= 4;
  maxTx += 2;
  maxTy += 4;

  const grid = new TileGrid(minTx, minTy, maxTx - minTx, maxTy - minTy);
  const spikes: Rect[] = [];
  const spawns: Spawn[] = [];

  for (const p of placed) {
    for (let y = 0; y < CHUNK_H; y++) {
      const row = p.def.rows[y];
      for (let x = 0; x < CHUNK_W; x++) {
        const ch = row[x];
        const tx = p.ox + x;
        const ty = p.oy + y;
        const px = tx * TILE;
        const py = ty * TILE;

        switch (ch) {
          case '#':
            grid.set(tx, ty, 1);
            break;
          case '^':
            // Slightly inset so a graze doesn't read as unfair.
            spikes.push({ x: px + 3, y: py + 7, w: TILE - 6, h: TILE - 7 });
            break;
          case 'T':
            if (spec.enemyMix.includes('turret'))
              spawns.push({ kind: 'turret', x: px + TILE / 2, y: py + TILE / 2 });
            break;
          case 'W':
            if (spec.enemyMix.includes('walker'))
              spawns.push({ kind: 'walker', x: px + TILE / 2, y: py + TILE / 2 });
            break;
          case 'F':
            if (spec.enemyMix.includes('flyer'))
              spawns.push({ kind: 'flyer', x: px + TILE / 2, y: py + TILE / 2 });
            break;
          default:
            break;
        }
      }
    }
  }

  // --- Start and goal -----------------------------------------------------
  const first = placed[0];
  const entry = findMarker(first.def.rows, 'E')!;
  const startTx = first.ox + entry.x;
  const startTy = first.oy + entry.y;
  const startX = startTx * TILE + TILE / 2;
  // Rest the player's feet on the tile below the entry marker.
  const startY = (startTy + 1) * TILE - PLAYER_H / 2;

  // Vertical chunks put E on the bottom row because the player normally arrives
  // from the chunk below. The first chunk has no chunk below it, so without a
  // pad the player spawns in mid-air and falls straight through the kill plane.
  if (!grid.solidAt(startTx, startTy + 1)) {
    for (let dx = -2; dx <= 2; dx++) grid.set(startTx + dx, startTy + 1, 1);
  }

  const terrain = mergeRects(grid);
  addGroundSkirt(terrain, placed, family);

  const last = placed[placed.length - 1];
  const exit = findMarker(last.def.rows, 'X')!;
  const goalX = (last.ox + exit.x) * TILE;
  const goalY = (last.oy + exit.y) * TILE;
  const goal: Rect = { x: goalX - 2, y: goalY - TILE, w: TILE + 4, h: TILE * 2 };

  const axis = axisUnit(family);
  const totalDistance =
    (goalX + TILE / 2 - startX) * axis.x + (goalY + TILE / 2 - startY) * axis.y;

  const spot = pickTrophySpot(placed);

  return {
    grid,
    terrain,
    spikes,
    spawns,
    chunks: placed,
    startX,
    startY,
    goal,
    axis,
    totalDistance: Math.max(1, totalDistance),
    bounds: {
      x: minTx * TILE,
      y: minTy * TILE,
      w: (maxTx - minTx) * TILE,
      h: (maxTy - minTy) * TILE,
    },
    trophy: spot ? trophyBox(spot.tx, spot.ty) : undefined,
  };
}

/** Visual ground below a hand-built level's bottom row, in tiles. */
const CUSTOM_SKIRT_TILES = 12;

/**
 * Build a level from one hand-drawn grid (see customLevels.ts). Same tile
 * characters and rules as chunks, just one piece instead of many.
 */
export function buildCustomLevel(rows: string[]): BuiltLevel {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;

  // Room around the drawn area: to the sides for the camera, above for jumps,
  // and a little below so a fall has somewhere to go before the kill plane.
  const minTx = -2;
  const minTy = -6;
  const maxTx = w + 2;
  const maxTy = h + 3;

  const grid = new TileGrid(minTx, minTy, maxTx - minTx, maxTy - minTy);
  const spikes: Rect[] = [];
  const spawns: Spawn[] = [];
  let start = { x: 1, y: h - 3 };
  let exit = { x: w - 2, y: h - 3 };
  let trophy: Rect | undefined;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x * TILE;
      const py = y * TILE;
      switch (rows[y][x]) {
        case '#':
          grid.set(x, y, 1);
          break;
        case '^':
          spikes.push({ x: px + 3, y: py + 7, w: TILE - 6, h: TILE - 7 });
          break;
        case 'T':
          spawns.push({ kind: 'turret', x: px + TILE / 2, y: py + TILE / 2 });
          break;
        case 'E':
          start = { x, y };
          break;
        case 'X':
          exit = { x, y };
          break;
        case 'C':
          trophy ??= trophyBox(x, y);
          break;
        default:
          break;
      }
    }
  }

  // Never spawn falling: a start with nothing under it gets a small ledge.
  if (!grid.solidAt(start.x, start.y + 1)) {
    for (let dx = -1; dx <= 1; dx++) grid.set(start.x + dx, start.y + 1, 1);
  }

  const terrain = mergeRects(grid);
  // Ground on the bottom row carries on downward, so it reads as ground.
  let run = -1;
  for (let x = 0; x <= w; x++) {
    const solid = x < w && rows[h - 1][x] === '#';
    if (solid && run < 0) run = x;
    else if (!solid && run >= 0) {
      terrain.push({ x: run * TILE, y: h * TILE, w: (x - run) * TILE, h: CUSTOM_SKIRT_TILES * TILE });
      run = -1;
    }
  }

  const startX = start.x * TILE + TILE / 2;
  const startY = (start.y + 1) * TILE - PLAYER_H / 2;
  const goalX = exit.x * TILE;
  const goalY = exit.y * TILE;
  const goal: Rect = { x: goalX - 2, y: goalY - TILE, w: TILE + 4, h: TILE * 2 };

  // Progress runs straight from the start to the portal, whichever way that is.
  const dx = goalX + TILE / 2 - startX;
  const dy = goalY + TILE / 2 - startY;
  const len = Math.hypot(dx, dy) || 1;

  return {
    grid,
    terrain,
    spikes,
    spawns,
    chunks: [],
    startX,
    startY,
    goal,
    axis: { x: dx / len, y: dy / len },
    totalDistance: len,
    bounds: {
      x: minTx * TILE,
      y: minTy * TILE,
      w: (maxTx - minTx) * TILE,
      h: (maxTy - minTy) * TILE,
    },
    freeCamera: true,
    trophy,
  };
}
