/**
 * "Can this level be finished?" — answered with the game's own physics.
 *
 * An invisible player is driven through the level by a search over short input
 * bursts (left / right / nothing, with jump released, pressed or held), using
 * the real `Player.step`. Coyote time, the jump buffer, variable jump height,
 * the double jump and stomp bounces all behave exactly as in the game, so a
 * route found here is a route a player has.
 *
 * Turret bodies and spikes kill, turrets can be stomped, and falling off the
 * bottom is death. Turret BULLETS are ignored: dodging shots is about timing,
 * not whether the level can be finished at all, and modelling them would make
 * every state depend on the clock.
 *
 * No time limit. It explores every distinct state it can reach, nearest-to-the-
 * portal first, so it either finds a route or proves there is none (at the
 * search's resolution).
 */

import { NO_ASSIST } from '../assist';
import { Player } from '../player';
import { PLAYER_H, PLAYER_W } from '../tuning';
import { Rect, buildCustomLevel } from '../world';

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
] as const;

type PlayerState = Record<(typeof FIELDS)[number], number | boolean>;

interface Node {
  p: PlayerState;
  jumpHeld: boolean;
  prevJump: boolean;
  /** One char per turret, '1' alive / '0' stomped. */
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

export function solve(rows: string[], onProgress?: (p: SolveProgress) => void): SolveResult {
  const t0 = Date.now();
  const level = buildCustomLevel(rows);
  const grid = level.grid;
  const goal = level.goal;
  const gx = goal.x + goal.w / 2;
  const gy = goal.y + goal.h / 2;
  const startDist = Math.hypot(gx - level.startX, gy - level.startY) || 1;
  const killY = level.bounds.y + level.bounds.h;

  // Turrets never move, so each is just a box that can be stomped away.
  const turrets = level.spawns
    .filter((s) => s.kind === 'turret')
    .map((s) => ({ x: s.x, y: s.y, box: { x: s.x - 6, y: s.y - 6, w: 12, h: 12 } }));

  const player = new Player();
  const input = new ScriptedInput();

  const save = (): PlayerState => {
    const o = {} as PlayerState;
    const p = player as unknown as Record<string, number | boolean>;
    for (const k of FIELDS) o[k] = p[k];
    return o;
  };
  const load = (n: Node): void => {
    const p = player as unknown as Record<string, number | boolean>;
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
  // Packed into one number (bots handled separately), since building strings
  // for tens of millions of states is most of the cost.
  const botIds = new Map<string, number>();
  const key = (n: Node): number => {
    const p = n.p;
    let bot = botIds.get(n.bots);
    if (bot === undefined) {
      bot = botIds.size;
      botIds.set(n.bots, bot);
    }
    const xb = Math.round(((p.x as number) - level.bounds.x) / 3); // < 2^12 for 400 tiles
    const yb = Math.round(((p.y as number) - level.bounds.y) / 3); // < 2^10 for 120 tiles
    const vxb = Math.round((p.vx as number) / 30) + 8; // 4 bits
    const vyb = Math.max(0, Math.min(31, Math.round((p.vy as number) / 50) + 16)); // 5 bits
    const flags =
      ((p.jumpsLeft as number) > 0 ? 1 : 0) |
      (p.grounded ? 2 : 0) |
      ((p.coyote as number) > 0 ? 4 : 0) |
      (n.jumpHeld ? 8 : 0); // 4 bits
    // 12 + 10 + 4 + 5 + 4 = 35 bits, times the bot-state id: well within 2^53.
    return ((((xb * 1024 + yb) * 16 + vxb) * 32 + vyb) * 16 + flags) + bot * 2 ** 35;
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
  const seen = new Set<number>([key(root)]);
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
