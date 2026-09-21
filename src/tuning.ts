/**
 * Every number that defines how the game feels lives here.
 *
 * The generator's limits are DERIVED from these (see `REACH`), so retuning the
 * jump automatically retunes what the level generator is allowed to build.
 */

export const TILE = 16;

/**
 * Virtual render resolution. Integer-scaled, nearest-neighbour, letterboxed.
 * 480x270 is a clean 16:9 that multiplies exactly to 1920x1080 (4x) and
 * 960x540 (2x), and gives the player more look-ahead than 384x216 did.
 */
export const VIRTUAL_W = 480;
export const VIRTUAL_H = 270;

/** Physics runs at a fixed 60Hz. Nothing in the simulation reads real delta. */
export const FIXED_DT = 1 / 60;
/** Never simulate more than this many steps in one frame (tab-switch guard). */
export const MAX_STEPS_PER_FRAME = 5;

export const TUNING = {
  gravity: 914, // px/s^2  -> 3.5 tile apex in 0.35s
  jumpVelocity: 320, // px/s
  doubleJumpVelocity: 260, // px/s  weaker: a save, not a boost
  runSpeed: 140, // px/s
  accelGround: 1200, // px/s^2  snappy
  accelAir: 600, // px/s^2  reduced control, still responsive
  frictionGround: 1500, // px/s^2
  frictionAir: 260, // px/s^2
  maxFallSpeed: 420, // px/s
  stompBounce: 240, // px/s

  // --- Forgiveness. All four are required; the game feels dead without them. ---
  coyoteTime: 0.1, // s of jump grace after leaving a ledge
  jumpBufferTime: 0.12, // s a jump press stays queued before landing
  jumpCutMultiplier: 0.45, // release early -> upward velocity scaled by this
  cornerCorrection: 3, // px of sideways nudge when a jump clips a ledge corner

  // --- Feel extras ---
  // A brief crouch held at takeoff before the stretch kicks in. The hold is
  // what makes it read as the character gathering itself rather than a glitch.
  jumpSquashTime: 0.07, // s
  jumpSquashX: 1.32,
  jumpSquashY: 0.7,

  deathFreeze: 0.35, // s of hitstop before the level resets
  respawnDelay: 0.15, // s of black before the retry begins
} as const;

/** Player collision box. Deliberately narrower than the drawn sprite. */
export const PLAYER_W = 10;
export const PLAYER_H = 14;

function reach() {
  const { gravity: g, jumpVelocity: v1, doubleJumpVelocity: v2, runSpeed, stompBounce } = TUNING;

  const h1 = (v1 * v1) / (2 * g); // single-jump apex
  const tUp1 = v1 / g;
  const air1 = tUp1 * 2;

  // Double jump fired at the apex of the first.
  const h2 = h1 + (v2 * v2) / (2 * g);
  const air2 = tUp1 + v2 / g + Math.sqrt((2 * h2) / g);

  // Stomp bounce, then the refreshed double jump. Measured from the bot's head.
  const hStomp = (stompBounce * stompBounce) / (2 * g) + (v2 * v2) / (2 * g);
  const airStomp = stompBounce / g + v2 / g + Math.sqrt((2 * hStomp) / g);

  return {
    singleHeightPx: h1,
    singleHeightTiles: h1 / TILE,
    singleAirtime: air1,
    singleRunTiles: (runSpeed * air1) / TILE,

    doubleHeightPx: h2,
    doubleHeightTiles: h2 / TILE,
    doubleAirtime: air2,
    doubleRunTiles: (runSpeed * air2) / TILE,

    stompHeightPx: hStomp,
    stompHeightTiles: hStomp / TILE,
    stompRunTiles: (runSpeed * airStomp) / TILE,
  };
}

export const REACH = reach();

/**
 * How far horizontally the player can still travel while arriving `dyTiles`
 * ABOVE the takeoff point. Landing high costs you distance, so a flat "max
 * jump length" is the wrong constraint for a ledge above you.
 *
 * Returns -1 when that height is out of reach entirely.
 */
export function horizontalReachAt(dyTiles: number, double: boolean): number {
  const { gravity: g, runSpeed } = TUNING;
  const hMax = double ? REACH.doubleHeightPx : REACH.singleHeightPx;
  const air = double ? REACH.doubleAirtime : REACH.singleAirtime;
  const h = dyTiles * TILE;
  if (h > hMax) return -1;
  // Time until the arc comes back down to height h.
  const t = air - Math.sqrt(Math.max(0, (2 * (hMax - h)) / g));
  return (runSpeed * Math.min(t, air)) / TILE;
}

/** Height gained from a stomp bounce plus the refreshed double jump, in tiles. */
export const STOMP_RUNG_TILES = REACH.stompHeightTiles;

/**
 * What the generator may build, at ~70% of theoretical reach so the player
 * always has margin. Chunks are validated against these.
 */
export const LIMITS = {
  maxGapSingle: Math.floor(REACH.singleRunTiles * 0.7), // 4 tiles
  maxGapDouble: Math.floor(REACH.doubleRunTiles * 0.7), // 6 tiles
  maxStepUpSingle: Math.floor(REACH.singleHeightTiles * 0.85), // 3 tiles
  maxStepUpDouble: Math.floor(REACH.doubleHeightTiles * 0.85), // 5 tiles
  maxStepUpBotGated: Math.floor(REACH.stompHeightTiles * 0.7), // 3 tiles above head
};
