/**
 * Quiet difficulty assistance.
 *
 * After enough deaths on one level, the game gives a little ground. What it
 * gives is deliberately constrained:
 *
 *   It NEVER moves terrain, resizes gaps, or removes bots.
 *
 * Levels regenerate identically from a seed so the player can learn them — that
 * is the point of the whole determinism rule. Shifting platforms between
 * attempts would throw away the muscle memory those deaths bought, which is the
 * opposite of help. And removing a bot can make a `botGated` chunk unsolvable,
 * since there the bot *is* the route.
 *
 * So the geometry stays put and the player gets bigger instead. "Move the
 * platform 8px closer" and "reach 8px further" are the same event from the
 * player's seat; only one of them rewrites the level under their feet.
 *
 * Timing does necessarily change — slower shots are the whole idea — but the
 * spatial layout, which is what you actually memorise, never does.
 */
export interface Assist {
  /** 0 = no assistance. */
  tier: number;
  // Multipliers. >1 is more generous except where noted.
  coyote: number;
  jumpBuffer: number;
  jumpPower: number;
  airControl: number;
  /** <1 = slower, more dodgeable projectiles. */
  projectileSpeed: number;
  /** >1 = enemies fire less often. */
  fireInterval: number;
  /** >1 = longer telegraph before a shot. */
  windup: number;
}

export const NO_ASSIST: Assist = {
  tier: 0,
  coyote: 1,
  jumpBuffer: 1,
  jumpPower: 1,
  airControl: 1,
  projectileSpeed: 1,
  fireInterval: 1,
  windup: 1,
};

const TIERS: Assist[] = [
  NO_ASSIST,
  {
    tier: 1,
    coyote: 1.4,
    jumpBuffer: 1.4,
    jumpPower: 1.03,
    airControl: 1.15,
    projectileSpeed: 0.85,
    fireInterval: 1.2,
    windup: 1.3,
  },
  {
    tier: 2,
    coyote: 1.8,
    jumpBuffer: 1.7,
    jumpPower: 1.06,
    airControl: 1.3,
    projectileSpeed: 0.72,
    fireInterval: 1.45,
    windup: 1.6,
  },
  {
    tier: 3,
    coyote: 2.2,
    jumpBuffer: 2.0,
    jumpPower: 1.09,
    airControl: 1.45,
    projectileSpeed: 0.6,
    fireInterval: 1.7,
    windup: 2.0,
  },
];

export const MAX_ASSIST_TIER = TIERS.length - 1;

/**
 * `deathsPerTier` comes from the level: a long level earns more attempts before
 * the game starts helping, because deaths there are cheaper to accumulate.
 */
export function assistFor(deaths: number, deathsPerTier: number): Assist {
  if (deathsPerTier <= 0) return NO_ASSIST;
  const tier = Math.min(MAX_ASSIST_TIER, Math.floor(deaths / deathsPerTier));
  return TIERS[tier];
}
