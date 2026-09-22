/**
 * What makes each Tuffling play differently.
 *
 * Every Tuffling can finish every level; abilities only open shortcuts and make
 * for a different ride. So each strength comes with a cost, and the things
 * that decide how FAIR the game feels — the hitbox, coyote time, the jump
 * buffer, corner correction — are the same for all of them and stay in TUNING.
 *
 * Mochi is the reference: its numbers are exactly TUNING's, so choosing Mochi
 * plays the game as it has always played.
 */

import { TUNING, TILE } from './tuning';
import type { TufflingId } from './tufflings';

export interface ClingAbility {
  /** Seconds of grip on a full stamina bar, while hanging still. */
  grip: number;
  /** Grip drains this many times faster while climbing or shimmying. */
  moveDrain: number;
  /** Up a wall, while holding toward it. px/s */
  climbSpeed: number;
  /** Down a wall, while holding away from it. px/s */
  slideSpeed: number;
  /** Along a ceiling. px/s */
  shimmySpeed: number;
}

export interface Ability {
  runSpeed: number;
  accelGround: number;
  accelAir: number;
  frictionGround: number;
  frictionAir: number;
  jumpVelocity: number;
  doubleJumpVelocity: number;
  /** Gravity while rising. */
  gravity: number;
  /** Gravity while falling. Lower than `gravity` is what floating feels like. */
  fallGravity: number;
  maxFallSpeed: number;
  /** Walls and ceilings. Null: slides off them like everyone else. */
  cling: ClingAbility | null;
}

const MOCHI: Ability = {
  runSpeed: TUNING.runSpeed,
  accelGround: TUNING.accelGround,
  accelAir: TUNING.accelAir,
  frictionGround: TUNING.frictionGround,
  frictionAir: TUNING.frictionAir,
  jumpVelocity: TUNING.jumpVelocity,
  doubleJumpVelocity: TUNING.doubleJumpVelocity,
  gravity: TUNING.gravity,
  fallGravity: TUNING.gravity,
  maxFallSpeed: TUNING.maxFallSpeed,
  cling: null,
};

export const ABILITIES: Record<TufflingId, Ability> = {
  mochi: MOCHI,

  // Light: jumps higher and drifts down slowly. The cost is on the ground —
  // a little slower — and in the air, where floating makes landings less exact.
  button: {
    ...MOCHI,
    runSpeed: 125,
    accelAir: 520,
    jumpVelocity: 345,
    doubleJumpVelocity: 280,
    fallGravity: 560,
    maxFallSpeed: 250,
  },

  // Zippy: fast off the mark and fast at the top. It pays with a slightly
  // shorter jump and a little slide when it stops.
  pepper: {
    ...MOCHI,
    runSpeed: 180,
    accelGround: 1500,
    accelAir: 700,
    frictionGround: 700,
    jumpVelocity: 305,
    doubleJumpVelocity: 250,
  },

  // The climber, not the runner: slower on the ground, lower jumps (the
  // double jump included), but it can cling to walls and ceilings until its
  // grip runs out.
  hugsy: {
    ...MOCHI,
    runSpeed: 110,
    accelGround: 1100,
    jumpVelocity: 295,
    doubleJumpVelocity: 225,
    cling: {
      grip: 2.5,
      moveDrain: 1.8,
      climbSpeed: 55,
      slideSpeed: 80,
      shimmySpeed: 55,
    },
  },
};

/**
 * The 1-5 ratings shown on the Tufflings screen. Hand-set rather than computed,
 * so the bars say what matters at a glance instead of splitting hairs.
 */
export const STAT_BARS: Record<TufflingId, { jump: number; speed: number; climb: number }> = {
  mochi: { jump: 3, speed: 3, climb: 0 },
  button: { jump: 5, speed: 2, climb: 0 },
  pepper: { jump: 2, speed: 5, climb: 0 },
  hugsy: { jump: 1, speed: 1, climb: 5 },
};

/** Every Tuffling, in roster order. Kept here (no Phaser) so tools can use it. */
export const TUFFLING_IDS: readonly TufflingId[] = ['mochi', 'button', 'pepper', 'hugsy'];

export function abilityOf(id: TufflingId): Ability {
  return ABILITIES[id] ?? MOCHI;
}

export { MOCHI as DEFAULT_ABILITY };

/** Single-jump and double-jump apex heights, in tiles. For stat bars and docs. */
export function jumpHeights(a: Ability): { single: number; double: number } {
  const h1 = (a.jumpVelocity * a.jumpVelocity) / (2 * a.gravity);
  const h2 = h1 + (a.doubleJumpVelocity * a.doubleJumpVelocity) / (2 * a.gravity);
  return { single: h1 / TILE, double: h2 / TILE };
}
