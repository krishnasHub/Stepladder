import { REACH, STOMP_RUNG_TILES, horizontalReachAt } from './tuning';

/**
 * The chunk grammar.
 *
 * Hand-authored 24x16 tile pieces, stitched at runtime. This is deliberately
 * not noise: noise produces mush and pure randomness produces unplayable
 * terrain. Authoring new content means typing ASCII.
 *
 * Legend
 *   .  empty        #  solid          ^  spike (deadly)
 *   E  entry        X  exit
 *   T  turret       W  walker         F  flyer
 *
 * Seam conventions (see `STEP` below):
 *   h  entry at col 0,  exit at col 23   -> next chunk placed to the right,
 *                                          vertically aligned to the exit
 *   v  entry at row 15, exit at row 0    -> next chunk placed above,
 *                                          horizontally aligned to the exit
 *   d  entry at (1,14), exit at (22,1)   -> fixed +24,-16 step
 */

export const CHUNK_W = 24;
export const CHUNK_H = 16;

export type ChunkFamily = 'h' | 'v' | 'd';

export interface ChunkDef {
  id: string;
  family: ChunkFamily;
  /** 0 = warmup, 3 = late-level. Gated by the difficulty ramp. */
  difficulty: number;
  /**
   * A bot is load-bearing traversal here. These MUST have a pit beneath the
   * gated jump so a missed landing is a death (fast retry) and not a softlock.
   */
  botGated?: boolean;
  rows: string[];
}

/** How far the next chunk is offset, per family. */
export const STEP: Record<ChunkFamily, { x: number; y: number }> = {
  h: { x: CHUNK_W, y: 0 },
  v: { x: 0, y: -CHUNK_H },
  d: { x: CHUNK_W, y: -CHUNK_H },
};

// ---------------------------------------------------------------------------
// Horizontal — level 1 and the horizontal stretches of later levels
// ---------------------------------------------------------------------------

const HORIZONTAL: ChunkDef[] = [
  {
    id: 'h_flat',
    family: 'h',
    difficulty: 0,
    rows: [
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      'E......................X',
      '####....#####....#######',
      '####....#####....#######',
      '####....#####....#######',
    ],
  },
  {
    id: 'h_platforms',
    family: 'h',
    difficulty: 1,
    rows: [
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '.....####...####........',
      '.....####...####........',
      '........................',
      'E......................X',
      '#####..........#########',
      '#####..........#########',
      '#####..........#########',
    ],
  },
  {
    id: 'h_tower',
    family: 'h',
    difficulty: 2,
    rows: [
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '..........#####.........',
      '..........#####.........',
      '.......T................',
      '.....####...............',
      '........................',
      '........................',
      'E......................X',
      '####...........#########',
      '####...........#########',
      '####...........#########',
    ],
  },
  {
    id: 'h_turret',
    family: 'h',
    difficulty: 2,
    rows: [
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '..........T.............',
      '.........####...........',
      'E......................X',
      '######.........#########',
      '######.........#########',
      '######.........#########',
    ],
  },
  {
    id: 'h_walker',
    family: 'h',
    difficulty: 2,
    rows: [
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      'E.....W.......^^.......X',
      '########################',
      '########################',
      '########################',
    ],
  },
  {
    id: 'h_gap_double',
    family: 'h',
    difficulty: 2,
    rows: [
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      'E......................X',
      '########......##########',
      '########......##########',
      '########......##########',
    ],
  },
  {
    id: 'h_spikes',
    family: 'h',
    difficulty: 3,
    rows: [
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      'E..^^....^^....^^......X',
      '########################',
      '########################',
      '########################',
    ],
  },
  {
    // The showcase. Double-jump to the flyer, stomp it, and the refreshed
    // double jump carries you to a ledge that is otherwise unreachable.
    // Pit beneath the whole gated section -> a miss is a death, not a softlock.
    id: 'h_botgate',
    family: 'h',
    difficulty: 3,
    botGated: true,
    rows: [
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '.......................X',
      '.................#######',
      '.................#######',
      '............F....#######',
      '.................#######',
      '.................#######',
      '.................#######',
      'E................#######',
      '#######..........#######',
      '#######..........#######',
      '#######..........#######',
    ],
  },
];

// ---------------------------------------------------------------------------
// Vertical — level 2, the climb
// ---------------------------------------------------------------------------

const VERTICAL: ChunkDef[] = [
  // Rule for every vertical chunk: the rows immediately above E stay clear and
  // the first platform is offset sideways. E is where the player ARRIVES from
  // the chunk below, so anything solid above it is an unenterable pocket.
  {
    id: 'v_stairs',
    family: 'v',
    difficulty: 0,
    rows: [
      '..........X.............',
      '........####............',
      '........................',
      '........................',
      '.........####...........',
      '........................',
      '........................',
      '.....####...............',
      '........................',
      '........................',
      '.........####...........',
      '........................',
      '........................',
      '.....####...............',
      '........................',
      '....E...................',
    ],
  },
  {
    // Wider offsets: every hop here wants the double jump.
    id: 'v_zigzag',
    family: 'v',
    difficulty: 1,
    rows: [
      '.....X..................',
      '....####................',
      '........................',
      '........................',
      '.............####.......',
      '........................',
      '........................',
      '.....####...............',
      '........................',
      '........................',
      '..............####......',
      '........................',
      '........................',
      '......####..............',
      '........................',
      '..E.....................',
    ],
  },
  {
    id: 'v_turrets',
    family: 'v',
    difficulty: 2,
    rows: [
      '..........X.............',
      '........####............',
      '........................',
      '..........T.............',
      '.........####...........',
      '........................',
      '........................',
      '.....####...............',
      '........................',
      '........................',
      '.........####...........',
      '........................',
      '......T.................',
      '.....####...............',
      '........................',
      '....E...................',
    ],
  },
  {
    id: 'v_gauntlet',
    family: 'v',
    difficulty: 3,
    rows: [
      '.....X..................',
      '....####................',
      '........................',
      '........................',
      '............#####.......',
      '........................',
      '......W.................',
      '....#####...............',
      '........................',
      '........................',
      '.............#####......',
      '........................',
      '.......T................',
      '.....#####..............',
      '........................',
      '...E....................',
    ],
  },
  {
    // The bot ladder. Three flyers stacked with nothing else to stand on:
    // stomp -> bounce -> refreshed double jump -> stomp again. This is the
    // primary traversal verb of the vertical level.
    id: 'v_botladder',
    family: 'v',
    difficulty: 3,
    botGated: true,
    rows: [
      '..........X.............',
      '.........####...........',
      '........................',
      '........................',
      '..........F.............',
      '........................',
      '........................',
      '........................',
      '..........F.............',
      '........................',
      '........................',
      '........................',
      '..........F.............',
      '........................',
      '........................',
      '..........E.............',
    ],
  },
];

// ---------------------------------------------------------------------------
// Diagonal — level 3+, bottom-left to top-right
// ---------------------------------------------------------------------------

const DIAGONAL: ChunkDef[] = [
  {
    id: 'd_ramp',
    family: 'd',
    difficulty: 1,
    rows: [
      '........................',
      '......................X.',
      '....................####',
      '........................',
      '........................',
      '...............####.....',
      '...............####.....',
      '........................',
      '........................',
      '.........####...........',
      '.........####...........',
      '........................',
      '.....####...............',
      '.....####...............',
      '.E......................',
      '####....................',
    ],
  },
  {
    id: 'd_mixed',
    family: 'd',
    difficulty: 2,
    rows: [
      '........................',
      '......................X.',
      '....................####',
      '........................',
      '...............T........',
      '..............#####.....',
      '..............#####.....',
      '........................',
      '........................',
      '........#####...........',
      '........#####...........',
      '........................',
      '.....####...............',
      '.....####...............',
      '.E...^..................',
      '########................',
    ],
  },
  {
    id: 'd_spikes',
    family: 'd',
    difficulty: 3,
    rows: [
      '........................',
      '......................X.',
      '....................####',
      '........................',
      '........................',
      '...............####.....',
      '...............####.....',
      '........................',
      '..........^.............',
      '.........####...........',
      '.........####...........',
      '.......W................',
      '.....####...............',
      '.....####...............',
      '.E......................',
      '####....................',
    ],
  },
  {
    id: 'd_botgate',
    family: 'd',
    difficulty: 3,
    botGated: true,
    rows: [
      '........................',
      '......................X.',
      '....................####',
      '........................',
      '........................',
      '...............F........',
      '........................',
      '........................',
      '........................',
      '..........F.............',
      '........................',
      '........................',
      '.....####...............',
      '.....####...............',
      '.E......................',
      '####....................',
    ],
  },
];

export const ALL_CHUNKS: ChunkDef[] = [...HORIZONTAL, ...VERTICAL, ...DIAGONAL];

export function chunksFor(family: ChunkFamily): ChunkDef[] {
  return ALL_CHUNKS.filter((c) => c.family === family);
}

// ---------------------------------------------------------------------------
// Validation — runs at startup in dev so typos surface immediately
// ---------------------------------------------------------------------------

export interface ChunkIssue {
  id: string;
  problem: string;
}

export function findMarker(rows: string[], ch: string): { x: number; y: number } | null {
  for (let y = 0; y < rows.length; y++) {
    const x = rows[y].indexOf(ch);
    if (x >= 0) return { x, y };
  }
  return null;
}

export function validateChunks(): ChunkIssue[] {
  const issues: ChunkIssue[] = [];
  const seen = new Set<string>();

  for (const c of ALL_CHUNKS) {
    if (seen.has(c.id)) issues.push({ id: c.id, problem: 'duplicate id' });
    seen.add(c.id);

    if (c.rows.length !== CHUNK_H) {
      issues.push({ id: c.id, problem: `has ${c.rows.length} rows, expected ${CHUNK_H}` });
      continue;
    }
    let widthOk = true;
    c.rows.forEach((r, i) => {
      if (r.length !== CHUNK_W) {
        issues.push({ id: c.id, problem: `row ${i} is ${r.length} chars, expected ${CHUNK_W}` });
        widthOk = false;
      }
      const bad = r.replace(/[.#EXTWF^]/g, '');
      if (bad.length) issues.push({ id: c.id, problem: `row ${i} has unknown chars "${bad}"` });
    });
    if (!widthOk) continue;

    const e = findMarker(c.rows, 'E');
    const x = findMarker(c.rows, 'X');
    if (!e) issues.push({ id: c.id, problem: 'missing entry marker E' });
    if (!x) issues.push({ id: c.id, problem: 'missing exit marker X' });
    if (!e || !x) continue;

    // Seam conventions must hold or chunks will not connect.
    if (c.family === 'h') {
      if (e.x !== 0) issues.push({ id: c.id, problem: `entry must be in col 0, found col ${e.x}` });
      if (x.x !== CHUNK_W - 1)
        issues.push({ id: c.id, problem: `exit must be in col ${CHUNK_W - 1}, found col ${x.x}` });
    } else if (c.family === 'v') {
      if (e.y !== CHUNK_H - 1)
        issues.push({ id: c.id, problem: `entry must be in row ${CHUNK_H - 1}, found row ${e.y}` });
      if (x.y !== 0) issues.push({ id: c.id, problem: `exit must be in row 0, found row ${x.y}` });
    } else {
      if (e.x !== 1 || e.y !== 14)
        issues.push({ id: c.id, problem: `entry must be at (1,14), found (${e.x},${e.y})` });
      if (x.x !== 22 || x.y !== 1)
        issues.push({ id: c.id, problem: `exit must be at (22,1), found (${x.x},${x.y})` });
    }

    // A bot-gated chunk without bots is a softlock waiting to happen.
    if (c.botGated) {
      const hasBot = c.rows.some((r) => /[TWF]/.test(r));
      if (!hasBot) issues.push({ id: c.id, problem: 'botGated but contains no bots' });
    }

    if (c.family === 'v') issues.push(...checkVerticalLadder(c, e));
  }
  return issues;
}

interface Platform {
  y: number;
  x0: number;
  x1: number;
}

/**
 * Standable surfaces: a solid tile with nothing solid directly above it. In a
 * bot-gated chunk, flyers count as rungs too — that is the entire point of
 * those chunks.
 */
function platformsOf(rows: string[], includeFlyers: boolean): Platform[] {
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < CHUNK_H; y++) {
    for (let x = 0; x < CHUNK_W; x++) {
      const ch = rows[y][x];
      if (ch === '#') {
        if (y === 0 || rows[y - 1][x] !== '#') cells.push({ x, y });
      } else if (includeFlyers && ch === 'F') {
        cells.push({ x, y });
      }
    }
  }
  cells.sort((a, b) => a.y - b.y || a.x - b.x);

  const out: Platform[] = [];
  for (const c of cells) {
    const last = out[out.length - 1];
    if (last && last.y === c.y && c.x === last.x1 + 1) last.x1 = c.x;
    else out.push({ y: c.y, x0: c.x, x1: c.x });
  }
  return out;
}

/**
 * Walk the climb bottom-up and confirm every rung is actually reachable from
 * the one below it. This is the check that catches an unclimbable chunk before
 * a player ever loads it.
 */
function checkVerticalLadder(c: ChunkDef, entry: { x: number; y: number }): ChunkIssue[] {
  const issues: ChunkIssue[] = [];
  const plats = platformsOf(c.rows, !!c.botGated).sort((a, b) => b.y - a.y);

  // The player arrives standing at E, feet on the row below it.
  let cur: Platform = { y: entry.y + 1, x0: entry.x - 2, x1: entry.x + 2 };

  for (const p of plats) {
    if (p.y >= cur.y) continue;
    const dy = cur.y - p.y;
    const dx = p.x1 < cur.x0 ? cur.x0 - p.x1 : p.x0 > cur.x1 ? p.x0 - cur.x1 : 0;

    const single = dy <= REACH.singleHeightTiles && dx <= horizontalReachAt(dy, false);
    const double = dy <= REACH.doubleHeightTiles && dx <= horizontalReachAt(dy, true);
    // A stomp rung carries you higher, but only in a chunk that provides bots.
    const stomp = c.botGated && dy <= STOMP_RUNG_TILES;

    if (!single && !double && !stomp) {
      issues.push({
        id: c.id,
        problem: `rung at row ${p.y} is unreachable: ${dy} up / ${dx} across (max ${horizontalReachAt(dy, true).toFixed(1)} across at that height)`,
      });
    }
    cur = p;
  }
  return issues;
}
