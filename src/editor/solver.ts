/**
 * "Can this level be finished?" — answered with the game's own physics.
 *
 * An invisible player is driven through the level by a search over short input
 * bursts (left / right / nothing, with jump released, pressed or held), using
 * the real `Player.step`. Coyote time, the jump buffer, variable jump height,
 * the double jump and stomp bounces all behave exactly as in the game, so a
 * route found here is a route a player has.
 *
 * Each check is for one Tuffling, with its own abilities: Button's float,
 * Pepper's speed, Hugsy's clinging. Every level is meant to be finishable by all
 * four, so the editor runs it once for each.
 *
 * Bot bodies and spikes kill, bots can be stomped, and falling off the bottom
 * is death. Bots are held still at their starting spot: turrets never move, and
 * treating walkers and flyers the same way keeps every state free of the clock.
 * Turret BULLETS are ignored for the same reason: dodging shots is about
 * timing, not whether the level can be finished at all.
 *
 * No time limit. It explores every distinct state it can reach, nearest-to-the-
 * portal first, so it either finds a route or proves there is none (at the
 * search's resolution).
 */

import { abilityOf } from '../abilities';
import { NO_ASSIST } from '../assist';
import { Player } from '../player';
import type { TufflingId } from '../tufflings';
import { PLAYER_H, PLAYER_W } from '../tuning';
import { BuiltLevel, Rect, buildCustomLevel } from '../world';

/** Frames each input is held for. 4 frames is 67ms, well under human reaction. */
const BURST = 4;
const DT = 1 / 60;

export interface SolveProgress {
  kind: 'progress';
  explored: number;
  /** 0..1: how close the closest attempt so far got to the portal. */
  closest: number;
}

export interface SolveResult {
  kind: 'done';
  finished: boolean;
  explored: number;
  /** Player positions along the route (finished) or to the closest point reached. */
  path: { x: number; y: number }[];
  ms: number;
}

/** Everything about the player that affects physics. Visual fields ride along. */
const FIELDS = [
  'x',
  'y',
  'vx',
  'vy',
  'grounded',
  'facing',
  'jumpsLeft',
  'coyote',
  'buffer',
  'cutApplied',
  'bufferPending',
  'wasGrounded',
  'scaleX',
  'scaleY',
  'trailTimer',
  'squashTimer',
  'squashStrength',
  'cling',
  'clingSide',
  'grip',
  'clingCooldown',
] as const;

type PlayerState = Record<(typeof FIELDS)[number], number | boolean | string>;

interface Node {
  p: PlayerState;
  jumpHeld: boolean;
  prevJump: boolean;
  /** One char per bot, '1' alive / '0' stomped. */
  bots: string;
  /** Distance to the portal, for ordering. */
  h: number;
  trace: Trace;
}

/** Kept for every explored state, just enough to draw the route back. */
interface Trace {
  x: number;
  y: number;
  parent: Trace | null;
}

/** A plain input object shaped like GameInput, driven by the search. */
class ScriptedInput {
  left = false;
  right = false;
  jumpHeld = false;
  jumpQueued = false;
  prevJump = false;
  consumeJump(): boolean {
    const q = this.jumpQueued;
    this.jumpQueued = false;
    return q;
  }
}

/** Min-heap on `h`. */
class Heap {
  private a: Node[] = [];
  get size(): number {
    return this.a.length;
  }
  push(n: Node): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].h <= a[i].h) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Node | undefined {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length && last) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].h < a[m].h) m = l;
        if (r < a.length && a[r].h < a[m].h) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Check a hand-built level (editor rows) for one Tuffling. */
export function solve(
  rows: string[],
  tuffling: TufflingId = 'mochi',
  onProgress?: (p: SolveProgress) => void,
  aim: 'portal' | 'trophy' = 'portal',
): SolveResult {
  const level = buildCustomLevel(rows);
  return solveLevel(level, tuffling, onProgress, aim === 'trophy' ? level.trophy : undefined);
}

/**
 * Check any built level — hand-built or generated — for one Tuffling.
 * `target` swaps the portal for another spot, such as the level's trophy.
 */
export function solveLevel(
  level: BuiltLevel,
  tuffling: TufflingId = 'mochi',
  onProgress?: (p: SolveProgress) => void,
  target?: Rect,
): SolveResult {
  const t0 = Date.now();
  const grid = level.grid;
  const goal = target ?? level.goal;
  const gx = goal.x + goal.w / 2;
  const gy = goal.y + goal.h / 2;
  const startDist = Math.hypot(gx - level.startX, gy - level.startY) || 1;
  const killY = level.bounds.y + level.bounds.h;

  // Each bot is a box at its starting spot that kills on contact, unless stomped.
  const turrets = level.spawns.map((s) => {
    const h = s.kind === 'walker' ? 13 : 12;
    return { x: s.x, y: s.y, box: { x: s.x - 6, y: s.y - h / 2, w: 12, h } };
  });

  const player = new Player();
  player.setAbility(abilityOf(tuffling));
  const input = new ScriptedInput();

  const save = (): PlayerState => {
    const o = {} as PlayerState;
    const p = player as unknown as Record<string, number | boolean | string>;
    for (const k of FIELDS) o[k] = p[k];
    return o;
  };
  const load = (n: Node): void => {
    const p = player as unknown as Record<string, number | boolean | string>;
    for (const k of FIELDS) p[k] = n.p[k];
    player.alive = true;
    player.trail.length = 0;
    input.jumpHeld = n.jumpHeld;
    input.prevJump = n.prevJump;
  };

  // Mirrors GameScene.collide (minus bullets): returns 'dead', 'goal' or null.
  let bots = '';
  const collide = (): 'dead' | 'goal' | null => {
    const pb: Rect = { x: player.left, y: player.top, w: PLAYER_W, h: PLAYER_H };
    for (const s of level.spikes) if (overlaps(pb, s)) return 'dead';
    for (let i = 0; i < turrets.length; i++) {
      if (bots[i] !== '1') continue;
      const t = turrets[i];
      if (!overlaps(pb, t.box)) continue;
      if (player.vy > 0 && pb.y + pb.h <= t.y + 4) {
        bots = bots.slice(0, i) + '0' + bots.slice(i + 1);
        player.stompBounce();
      } else {
        return 'dead';
      }
    }
    if (overlaps(pb, goal)) return 'goal';
    if (player.y > killY) return 'dead';
    return null;
  };

  // Two states in the same bucket count as the same place. The buckets are what
  // make "impossible" provable in reasonable time, and they are deliberately a
  // few pixels wide: a route that only works to the exact pixel is one no
  // person can play, so merging it away costs nothing that matters.
  //
  // Packed into one number, since building strings for tens of millions of
  // states is most of the cost. Only once a bot has been stomped does the key
  // need a string, to carry which ones.
  const botIds = new Map<string, number>();
  const key = (n: Node): number | string => {
    const p = n.p;
    let bot = botIds.get(n.bots);
    if (bot === undefined) {
      bot = botIds.size;
      botIds.set(n.bots, bot);
    }
    const xb = Math.min(4095, Math.round(((p.x as number) - level.bounds.x) / 3)); // 12 bits
    const yb = Math.min(4095, Math.round(((p.y as number) - level.bounds.y) / 3)); // 12 bits
    const vxb = Math.max(0, Math.min(15, Math.round((p.vx as number) / 30) + 8)); // 4 bits
    const vyb = Math.max(0, Math.min(31, Math.round((p.vy as number) / 50) + 16)); // 5 bits
    const flags =
      ((p.jumpsLeft as number) > 0 ? 1 : 0) |
      (p.grounded ? 2 : 0) |
      ((p.coyote as number) > 0 ? 4 : 0) |
      (n.jumpHeld ? 8 : 0); // 4 bits
    // Climbers: which way they're clinging, and roughly how much grip is left.
    const cling = p.cling === 'wall' ? ((p.clingSide as number) > 0 ? 1 : 2) : p.cling === 'ceiling' ? 3 : 0; // 2 bits
    const grip = Math.min(15, Math.round((p.grip as number) / 0.25)); // 4 bits
    const cool = (p.clingCooldown as number) > 0 ? 1 : 0; // 1 bit
    // 12 + 12 + 4 + 5 + 4 + 2 + 4 + 1 = 44 bits: well within 2^53.
    const k = ((((((xb * 4096 + yb) * 16 + vxb) * 32 + vyb) * 16 + flags) * 4 + cling) * 16 + grip) * 2 + cool;
    return bot === 0 ? k : `${k}|${bot}`;
  };

  player.reset(level.startX, level.startY);
  input.prevJump = false;
  const rootTrace: Trace = { x: player.x, y: player.y, parent: null };
  const root: Node = {
    p: save(),
    jumpHeld: false,
    prevJump: false,
    bots: '1'.repeat(turrets.length),
    h: startDist,
    trace: rootTrace,
  };

  const open = new Heap();
  open.push(root);
  const seen = new Set<number | string>([key(root)]);
  let closest = root;
  let explored = 0;

  const toPath = (t: Trace): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = [];
    for (let c: Trace | null = t; c; c = c.parent) out.push({ x: c.x, y: c.y });
    return out.reverse();
  };

  while (open.size) {
    const node = open.pop()!;

    for (let dir = -1; dir <= 1; dir++) {
      // 0: jump released, 1: jump pressed (fresh), 2: jump kept held.
      for (let j = 0; j <= 2; j++) {
        if (j === 2 && !node.jumpHeld) continue;
        load(node);
        bots = node.bots;
        let outcome: 'dead' | 'goal' | null = null;

        for (let f = 0; f < BURST && !outcome; f++) {
          const jump = j !== 0;
          if (j === 1 && f === 0 && input.jumpHeld) input.jumpHeld = false;
          input.left = dir < 0;
          input.right = dir > 0;
          const prev = input.jumpHeld;
          input.jumpHeld = jump;
          input.jumpQueued = jump && !prev;
          input.prevJump = prev;
          player.step(DT, input as never, grid, NO_ASSIST);
          outcome = collide();
        }
        explored++;

        if (outcome === 'dead') continue;
        const trace: Trace = { x: player.x, y: player.y, parent: node.trace };
        if (outcome === 'goal') {
          return { kind: 'done', finished: true, explored, path: toPath(trace), ms: Date.now() - t0 };
        }

        const child: Node = {
          p: save(),
          jumpHeld: input.jumpHeld,
          prevJump: input.jumpHeld,
          bots,
          h: Math.hypot(gx - player.x, gy - player.y),
          trace,
        };
        const k = key(child);
        if (seen.has(k)) continue;
        seen.add(k);
        if (child.h < closest.h) closest = child;
        open.push(child);
      }
    }

    if (onProgress && explored % 20000 < 9) {
      onProgress({ kind: 'progress', explored, closest: Math.max(0, 1 - closest.h / startDist) });
    }
  }

  return { kind: 'done', finished: false, explored, path: toPath(closest.trace), ms: Date.now() - t0 };
}
