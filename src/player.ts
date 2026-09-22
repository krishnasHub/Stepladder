import { Ability, DEFAULT_ABILITY } from './abilities';
import { Assist, NO_ASSIST } from './assist';
import type { GameInput } from './input';
import { PLAYER_H, PLAYER_W, TILE, TUNING } from './tuning';
import { TileGrid } from './world';

/**
 * The player controller. The game lives or dies here.
 *
 * Fixed 60Hz steps, hand-rolled swept AABB against the tile grid. Phaser's
 * arcade physics would work, but coyote time, jump buffering, jump cutting and
 * corner correction all want exact control over the resolution order, and feel
 * is the whole product.
 */

export interface PlayerEvents {
  jumped: boolean;
  doubleJumped: boolean;
  landed: boolean;
  stomped: boolean;
  /**
   * A jump press that never became a jump — the buffer window expired with the
   * player airborne and out of jumps. This is the honest stress signal:
   * counting raw presses would flag a normal jump-then-double-jump as panic.
   */
  jumpWasted: boolean;
  /** Cracked their head on a ceiling with real upward speed behind it. */
  bonked: boolean;
  /** Grabbed a wall / a ceiling (climbers only). */
  grabbedWall: boolean;
  grabbedCeiling: boolean;
  /** Grip ran out and the climber fell off. Letting go on purpose is not this. */
  lostGrip: boolean;
}

export type Cling = 'none' | 'wall' | 'ceiling';

/**
 * A climber only grabs a wall near the top of its jump or on the way down.
 * Rising faster than this, a jump beside a wall just carries on upward, so a
 * normal hop onto a ledge doesn't snag on the ledge's side.
 */
const CLING_MAX_RISE = 80;
/** After letting go, no re-grab for this long, or holding toward the wall would re-cling at once. */
const RELEASE_COOLDOWN = 0.25;
/** Climbing up past the top of a wall hops you onto it. */
const MANTLE_VY = 170;
const MANTLE_VX = 70;

/**
 * Rising faster than this when a ceiling stops you counts as a bonk. Below it
 * the contact is a graze — usually corner correction nearly saving a jump — and
 * announcing that would be noise.
 */
const BONK_SPEED = 55;

export interface TrailPoint {
  x: number;
  y: number;
  life: number;
}

export class Player {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;

  grounded = false;
  facing = 1;
  alive = true;

  /** Jumps remaining in the air. 1 = double jump available. */
  jumpsLeft = 1;

  /** How this Tuffling moves. Mochi's numbers unless set otherwise. */
  ability: Ability = DEFAULT_ABILITY;

  /** Clinging to a wall or ceiling (climbers only). */
  cling: Cling = 'none';
  /** Which side the wall is on while wall-clinging: 1 right, -1 left. */
  clingSide = 0;
  /** Seconds of grip left. Refilled by landing or stomping. */
  grip = 0;
  private clingCooldown = 0;

  private coyote = 0;
  private buffer = 0;
  private cutApplied = false;
  private bufferPending = false;
  private wasGrounded = false;

  // Purely visual. Squash and stretch is most of why a rectangle reads as alive.
  scaleX = 1;
  scaleY = 1;
  trail: TrailPoint[] = [];
  private trailTimer = 0;
  private squashTimer = 0;
  private squashStrength = 1;

  events: PlayerEvents = {
    jumped: false,
    doubleJumped: false,
    landed: false,
    stomped: false,
    jumpWasted: false,
    bonked: false,
    grabbedWall: false,
    grabbedCeiling: false,
    lostGrip: false,
  };

  setAbility(a: Ability): void {
    this.ability = a;
    this.grip = a.cling?.grip ?? 0;
  }

  reset(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.grounded = false;
    this.wasGrounded = false;
    this.facing = 1;
    this.alive = true;
    this.jumpsLeft = 1;
    this.coyote = 0;
    this.buffer = 0;
    this.cutApplied = true;
    this.bufferPending = false;
    this.scaleX = 1;
    this.scaleY = 1;
    this.squashTimer = 0;
    this.trail.length = 0;
    this.cling = 'none';
    this.clingSide = 0;
    this.grip = this.ability.cling?.grip ?? 0;
    this.clingCooldown = 0;
  }

  get left(): number {
    return this.x - PLAYER_W / 2;
  }
  get top(): number {
    return this.y - PLAYER_H / 2;
  }

  step(dt: number, input: GameInput, grid: TileGrid, assist: Assist = NO_ASSIST): void {
    const T = TUNING;
    const A = this.ability;
    const ev = this.events;
    ev.jumped = ev.doubleJumped = ev.landed = ev.stomped = ev.jumpWasted = false;
    ev.bonked = ev.grabbedWall = ev.grabbedCeiling = ev.lostGrip = false;
    if (this.clingCooldown > 0) this.clingCooldown -= dt;

    // Clinging is its own way of moving; the normal run-and-jump below is off.
    if (this.cling !== 'none') {
      this.stepCling(dt, input, grid);
      this.updateVisuals(dt);
      return;
    }

    // --- Horizontal -------------------------------------------------------
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (dir !== 0) {
      const accel = this.grounded ? A.accelGround : A.accelAir * assist.airControl;
      this.vx += dir * accel * dt;
      this.vx = Math.max(-A.runSpeed, Math.min(A.runSpeed, this.vx));
      this.facing = dir;
    } else {
      const fric = (this.grounded ? A.frictionGround : A.frictionAir) * dt;
      this.vx = this.vx > 0 ? Math.max(0, this.vx - fric) : Math.min(0, this.vx + fric);
    }

    // --- Jump: buffer + coyote -------------------------------------------
    if (input.consumeJump()) {
      // Pressed again while the last press was still unresolved. Mashing keeps
      // refreshing the buffer so it never expires — without this, fast mashing
      // registers as nothing at all, which is backwards.
      if (this.bufferPending) ev.jumpWasted = true;
      this.buffer = T.jumpBufferTime * assist.jumpBuffer;
      this.bufferPending = true;
    }
    if (this.buffer > 0) {
      this.buffer -= dt;
      if (this.buffer <= 0 && this.bufferPending) {
        // The window closed and nothing fired. That press was wasted too.
        this.bufferPending = false;
        ev.jumpWasted = true;
      }
    }

    if (this.buffer > 0) {
      if (this.grounded || this.coyote > 0) {
        this.vy = -A.jumpVelocity * assist.jumpPower;
        this.jumpsLeft = 1;
        this.buffer = 0;
        this.coyote = 0;
        this.grounded = false;
        this.cutApplied = false;
        this.bufferPending = false;
        this.squash();
        ev.jumped = true;
      } else if (this.jumpsLeft > 0) {
        this.vy = -A.doubleJumpVelocity * assist.jumpPower;
        this.jumpsLeft--;
        this.buffer = 0;
        this.cutApplied = false;
        this.bufferPending = false;
        this.squash(0.8);
        ev.doubleJumped = true;
      }
    }

    // --- Variable jump height --------------------------------------------
    if (!this.cutApplied && this.vy < 0 && !input.jumpHeld) {
      this.vy *= T.jumpCutMultiplier;
      this.cutApplied = true;
    }

    // --- Gravity ----------------------------------------------------------
    this.vy += (this.vy < 0 ? A.gravity : A.fallGravity) * dt;
    if (this.vy > A.maxFallSpeed) this.vy = A.maxFallSpeed;

    // --- Move and resolve, one axis at a time -----------------------------
    this.moveX(this.vx * dt, grid);
    this.moveY(this.vy * dt, grid);
    // moveY may have grabbed a ceiling.
    if (this.cling !== 'none') {
      this.updateVisuals(dt);
      return;
    }

    // --- Ground probe -----------------------------------------------------
    this.grounded = grid.overlapsSolid(this.left + 1, this.top + PLAYER_H, PLAYER_W - 2, 2);
    if (this.grounded) {
      this.coyote = TUNING.coyoteTime * assist.coyote;
      this.jumpsLeft = 1;
      if (A.cling) this.grip = A.cling.grip;
      if (!this.wasGrounded) {
        ev.landed = true;
        this.squashTimer = 0;
        this.scaleX = 1.35;
        this.scaleY = 0.68;
      }
    } else if (this.coyote > 0) {
      this.coyote -= dt;
    }
    this.wasGrounded = this.grounded;

    // --- Wall grab (climbers) ---------------------------------------------
    // Only when pushing INTO a wall, near the top of a jump or falling, with
    // grip to spare. Brushing past a wall, or rising past it, never sticks.
    if (A.cling && dir !== 0 && !this.grounded && this.vy > -CLING_MAX_RISE && this.canGrab()) {
      if (this.wallBeside(dir, grid)) {
        this.cling = 'wall';
        this.clingSide = dir;
        this.facing = dir;
        this.vx = 0;
        this.vy = 0;
        this.buffer = 0;
        this.bufferPending = false;
        ev.grabbedWall = true;
      }
    }

    this.updateVisuals(dt);
  }

  private canGrab(): boolean {
    return this.clingCooldown <= 0 && this.grip > 0;
  }

  /** Solid tiles directly beside the body on side `side`? */
  private wallBeside(side: number, grid: TileGrid): boolean {
    const x = side > 0 ? this.left + PLAYER_W : this.left - 1;
    return grid.overlapsSolid(x, this.top + 2, 1, PLAYER_H - 4);
  }

  /** Ceiling over the middle of the body: shimmying stops at the edge while still half under it. */
  private ceilingAbove(grid: TileGrid): boolean {
    return grid.overlapsSolid(this.x - 2, this.top - 1, 4, 1);
  }

  /** Let go: on purpose (jump), or because the grip gave out. Either way, fall. */
  private release(lostGrip: boolean): void {
    this.cling = 'none';
    this.clingSide = 0;
    this.vx = 0;
    this.vy = 0;
    this.clingCooldown = RELEASE_COOLDOWN;
    this.buffer = 0;
    this.bufferPending = false;
    this.cutApplied = true;
    if (lostGrip) this.events.lostGrip = true;
  }

  /**
   * Moving while clinging. On a wall, holding toward it climbs and holding
   * away slides down; on a ceiling, left and right shimmy. Jump lets go.
   * Grip drains the whole time, faster while moving. The double jump is left
   * exactly as it was: clinging never refreshes it.
   */
  private stepCling(dt: number, input: GameInput, grid: TileGrid): void {
    const C = this.ability.cling!;
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);

    if (input.consumeJump()) {
      this.release(false);
      return;
    }

    this.grip -= dt * (dir !== 0 ? C.moveDrain : 1);
    if (this.grip <= 0) {
      this.grip = 0;
      this.release(true);
      return;
    }

    if (this.cling === 'wall') {
      const side = this.clingSide;
      this.vx = 0;
      this.vy = dir === side ? -C.climbSpeed : dir === -side ? C.slideSpeed : 0;
      this.facing = side;
      this.moveY(this.vy * dt, grid);
      if (this.cling !== 'wall') return; // climbed into a ceiling and grabbed it

      // Slid down onto the floor: just standing now.
      if (grid.overlapsSolid(this.left + 1, this.top + PLAYER_H, PLAYER_W - 2, 2)) {
        this.cling = 'none';
        this.clingSide = 0;
        this.vy = 0;
        return;
      }
      if (!this.wallBeside(side, grid)) {
        const climbing = dir === side;
        this.cling = 'none';
        this.clingSide = 0;
        if (climbing) {
          // Over the top: a little hop that lands you on the ledge.
          this.vy = -MANTLE_VY;
          this.vx = side * MANTLE_VX;
          this.cutApplied = true;
        } else {
          this.vy = 0;
        }
      }
      return;
    }

    // Ceiling: shimmy, but never off the end. Stop at the edge instead.
    const px = this.x;
    this.vy = 0;
    this.vx = dir * C.shimmySpeed;
    if (dir !== 0) this.facing = dir;
    this.moveX(this.vx * dt, grid);
    if (!this.ceilingAbove(grid)) {
      this.x = px;
      this.vx = 0;
    }
  }

  private moveX(dx: number, grid: TileGrid): void {
    if (dx === 0) return;
    this.x += dx;
    if (!grid.overlapsSolid(this.left, this.top, PLAYER_W, PLAYER_H)) return;

    if (dx > 0) {
      const tx = Math.floor((this.left + PLAYER_W - 0.001) / TILE);
      this.x = tx * TILE - PLAYER_W / 2 - 0.001;
    } else {
      const tx = Math.floor(this.left / TILE);
      this.x = (tx + 1) * TILE + PLAYER_W / 2 + 0.001;
    }
    this.vx = 0;
  }

  private moveY(dy: number, grid: TileGrid): void {
    if (dy === 0) return;
    this.y += dy;
    if (!grid.overlapsSolid(this.left, this.top, PLAYER_W, PLAYER_H)) return;

    if (dy < 0) {
      // Corner correction: a jump that clips a ledge corner gets nudged past it
      // instead of stopping dead. This is invisible and enormously important.
      for (let off = 1; off <= TUNING.cornerCorrection; off++) {
        for (const s of [off, -off]) {
          if (!grid.overlapsSolid(this.left + s, this.top, PLAYER_W, PLAYER_H)) {
            this.x += s;
            return;
          }
        }
      }
      // Corner correction did not save it, so this is a real ceiling.
      const ty = Math.floor(this.top / TILE);
      this.y = (ty + 1) * TILE + PLAYER_H / 2 + 0.001;
      if (this.ability.cling && this.cling !== 'ceiling' && this.canGrab()) {
        // A climber grabs on instead of bonking.
        this.cling = 'ceiling';
        this.clingSide = 0;
        this.vx = 0;
        this.buffer = 0;
        this.bufferPending = false;
        this.events.grabbedCeiling = true;
      } else if (this.vy < -BONK_SPEED) {
        this.events.bonked = true;
      }
      this.vy = 0;
    } else {
      const ty = Math.floor((this.top + PLAYER_H - 0.001) / TILE);
      this.y = ty * TILE - PLAYER_H / 2 - 0.001;
      this.vy = 0;
    }
  }

  /**
   * Stomping a bot bounces the player AND refreshes the double jump.
   * That refresh is the core mechanic: it turns bots into terrain.
   */
  stompBounce(): void {
    this.cling = 'none';
    this.clingSide = 0;
    this.vy = -TUNING.stompBounce;
    this.jumpsLeft = 1;
    if (this.ability.cling) this.grip = this.ability.cling.grip;
    this.cutApplied = false;
    this.squash(0.9);
    this.events.stomped = true;
  }

  /**
   * Crouch at takeoff. Held for `jumpSquashTime`, then released into the
   * stretch — squish, spring, stretch. `strength` scales it down for the
   * weaker double jump.
   */
  private squash(strength = 1): void {
    this.scaleX = 1 + (TUNING.jumpSquashX - 1) * strength;
    this.scaleY = 1 - (1 - TUNING.jumpSquashY) * strength;
    this.squashTimer = TUNING.jumpSquashTime;
    this.squashStrength = strength;
  }

  private updateVisuals(dt: number): void {
    // While crouching, hold the pose: neither the easing nor the airborne
    // stretch below may touch it, or the crouch is cancelled the same frame.
    if (this.squashTimer > 0) {
      this.squashTimer -= dt;
      if (this.squashTimer <= 0) {
        this.scaleX = 1 - 0.32 * this.squashStrength;
        this.scaleY = 1 + 0.38 * this.squashStrength;
      }
      this.updateTrail(dt);
      return;
    }

    // Pressed flat against a wall, or hanging from a ceiling.
    if (this.cling !== 'none') {
      const kc = 1 - Math.pow(0.0001, dt);
      const sx = this.cling === 'wall' ? 0.84 : 1.08;
      const sy = this.cling === 'wall' ? 1.06 : 0.94;
      this.scaleX += (sx - this.scaleX) * kc;
      this.scaleY += (sy - this.scaleY) * kc;
      this.updateTrail(dt);
      return;
    }

    // Ease squash/stretch back to neutral.
    const k = 1 - Math.pow(0.0001, dt);
    this.scaleX += (1 - this.scaleX) * k;
    this.scaleY += (1 - this.scaleY) * k;

    // Airborne stretch proportional to vertical speed, so falls read as fast.
    if (!this.grounded) {
      const s = Math.min(0.22, Math.abs(this.vy) / TUNING.maxFallSpeed / 4);
      this.scaleY = Math.max(this.scaleY, 1 + s);
      this.scaleX = Math.min(this.scaleX, 1 - s * 0.7);
    }

    this.updateTrail(dt);
  }

  private updateTrail(dt: number): void {
    this.trailTimer -= dt;
    const moving = Math.abs(this.vx) > 40 || Math.abs(this.vy) > 60;
    if (moving && this.trailTimer <= 0) {
      this.trailTimer = 0.02;
      this.trail.push({ x: this.x, y: this.y, life: 0.22 });
      if (this.trail.length > 14) this.trail.shift();
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].life -= dt;
      if (this.trail[i].life <= 0) this.trail.splice(i, 1);
    }
  }
}
