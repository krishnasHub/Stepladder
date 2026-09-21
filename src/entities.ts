import { Rng } from './rng';
import { TILE } from './tuning';
import { SpawnKind, TileGrid } from './world';

/**
 * Bots and projectiles.
 *
 * Every timer is seeded and stepped at fixed dt, so a level replays identically
 * after a death. Nothing here reads wall-clock time.
 */

export const PROJECTILE_SPEED = 90;
const MAX_PROJECTILES = 256;

export class Projectile {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  life = 0;
  active = false;
  readonly r = 2.5;
}

export class ProjectilePool {
  readonly items: Projectile[] = [];

  constructor() {
    for (let i = 0; i < MAX_PROJECTILES; i++) this.items.push(new Projectile());
  }

  clear(): void {
    for (const p of this.items) p.active = false;
  }

  spawn(x: number, y: number, vx: number, vy: number): void {
    for (const p of this.items) {
      if (p.active) continue;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.life = 5;
      p.active = true;
      return;
    }
  }

  step(dt: number, grid: TileGrid): void {
    for (const p of this.items) {
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0 || grid.solidAtPx(p.x, p.y)) p.active = false;
    }
  }
}

export interface BotCtx {
  grid: TileGrid;
  playerX: number;
  playerY: number;
  projectiles: ProjectilePool;
}

export abstract class Bot {
  alive = true;
  /** Set for one step when killed, so the scene can spawn particles. */
  justKilled = false;
  /** 0..1, ramps during the fire windup. Drives the telegraph flash. */
  windup = 0;

  abstract readonly kind: SpawnKind;
  abstract readonly w: number;
  abstract readonly h: number;

  constructor(
    public x: number,
    public y: number,
  ) {}

  get left(): number {
    return this.x - this.w / 2;
  }
  get top(): number {
    return this.y - this.h / 2;
  }

  abstract step(dt: number, ctx: BotCtx): void;

  protected fireAt(ctx: BotCtx, speed = PROJECTILE_SPEED): void {
    const dx = ctx.playerX - this.x;
    const dy = ctx.playerY - this.y;
    const len = Math.hypot(dx, dy) || 1;
    ctx.projectiles.spawn(this.x, this.y, (dx / len) * speed, (dy / len) * speed);
  }

  kill(): void {
    this.alive = false;
    this.justKilled = true;
  }
}

/** Readability beats difficulty: every shot is telegraphed before it fires. */
const WINDUP_TIME = 0.25;

export class Turret extends Bot {
  readonly kind = 'turret' as const;
  readonly w = 12;
  readonly h = 12;
  private timer: number;
  private readonly interval: number;

  constructor(x: number, y: number, rng: Rng) {
    super(x, y);
    this.interval = rng.float(1.6, 2.3);
    this.timer = rng.float(0, this.interval); // desync identical turrets
  }

  step(dt: number, ctx: BotCtx): void {
    this.timer -= dt;
    this.windup = this.timer < WINDUP_TIME ? 1 - this.timer / WINDUP_TIME : 0;
    if (this.timer <= 0) {
      this.timer = this.interval;
      this.windup = 0;
      this.fireAt(ctx);
    }
  }
}

export class Walker extends Bot {
  readonly kind = 'walker' as const;
  readonly w = 12;
  readonly h = 13;
  private dir: number;
  private vy = 0;
  private timer: number;
  private readonly interval: number;
  private readonly speed: number;

  constructor(x: number, y: number, rng: Rng) {
    super(x, y);
    this.dir = rng.bool() ? 1 : -1;
    this.speed = rng.float(26, 38);
    this.interval = rng.float(2.0, 2.8);
    this.timer = rng.float(0, this.interval);
  }

  step(dt: number, ctx: BotCtx): void {
    const g = ctx.grid;

    // Fall onto whatever is below, then patrol it.
    this.vy = Math.min(300, this.vy + 914 * dt);
    this.y += this.vy * dt;
    if (g.overlapsSolid(this.left, this.top, this.w, this.h)) {
      const ty = Math.floor((this.top + this.h - 0.001) / TILE);
      this.y = ty * TILE - this.h / 2 - 0.001;
      this.vy = 0;
    }

    // Reverse at a wall or at the edge of the platform.
    const aheadX = this.x + this.dir * (this.w / 2 + 2);
    const wall = g.solidAtPx(aheadX, this.y);
    const floorAhead = g.solidAtPx(aheadX, this.y + this.h / 2 + 3);
    if (wall || !floorAhead) this.dir *= -1;
    else this.x += this.dir * this.speed * dt;

    // Shoot when roughly level with the player and within sight.
    this.timer -= dt;
    const aligned = Math.abs(ctx.playerY - this.y) < 26 && Math.abs(ctx.playerX - this.x) < 150;
    this.windup = aligned && this.timer < WINDUP_TIME ? 1 - this.timer / WINDUP_TIME : 0;
    if (this.timer <= 0) {
      this.timer = this.interval;
      this.windup = 0;
      if (aligned) {
        const s = Math.sign(ctx.playerX - this.x) || this.dir;
        ctx.projectiles.spawn(this.x, this.y, s * PROJECTILE_SPEED, 0);
      }
    }
  }
}

/**
 * Flyers bob in place with a small amplitude. That is deliberate: they are the
 * rungs of a bot ladder, and a rung that wanders is a rung you cannot trust.
 */
export class Flyer extends Bot {
  readonly kind = 'flyer' as const;
  readonly w = 13;
  readonly h = 10;
  private readonly baseY: number;
  private readonly baseX: number;
  private readonly phase: number;
  private readonly amp: number;
  private t = 0;
  private timer: number;
  private readonly interval: number;

  constructor(x: number, y: number, rng: Rng) {
    super(x, y);
    this.baseX = x;
    this.baseY = y;
    this.phase = rng.float(0, Math.PI * 2);
    this.amp = rng.float(5, 9);
    this.interval = rng.float(2.4, 3.2);
    this.timer = rng.float(0, this.interval);
  }

  step(dt: number, ctx: BotCtx): void {
    this.t += dt;
    this.y = this.baseY + Math.sin(this.t * 1.7 + this.phase) * this.amp;
    this.x = this.baseX + Math.sin(this.t * 0.9 + this.phase) * (this.amp * 0.5);

    this.timer -= dt;
    this.windup = this.timer < WINDUP_TIME ? 1 - this.timer / WINDUP_TIME : 0;
    if (this.timer <= 0) {
      this.timer = this.interval;
      this.windup = 0;
      ctx.projectiles.spawn(this.x, this.y + this.h / 2, 0, PROJECTILE_SPEED * 0.8);
    }
  }
}

export function createBot(kind: SpawnKind, x: number, y: number, rng: Rng): Bot {
  switch (kind) {
    case 'turret':
      return new Turret(x, y, rng);
    case 'walker':
      return new Walker(x, y, rng);
    case 'flyer':
      return new Flyer(x, y, rng);
  }
}
