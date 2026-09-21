import Phaser from 'phaser';
import { CHUNK_H, STEP } from '../chunks';
import { Assist, NO_ASSIST, assistFor } from '../assist';
import { playDeath, resumeAudio, toggleMuted } from '../audio';
import { Bot, ProjectilePool, createBot } from '../entities';
import { pixelText, upper } from '../font';
import { GameInput, TOUCH_BUTTONS } from '../input';
import { LEVELS, LevelDef, formatTime, recordCompletion } from '../levels';
import { Palette, paletteFor } from '../palette';
import { Player } from '../player';
import { Rng, levelSeed } from '../rng';
import {
  FIXED_DT,
  MAX_STEPS_PER_FRAME,
  PLAYER_H,
  PLAYER_W,
  TILE,
  TUNING,
  VIRTUAL_H,
  VIRTUAL_W,
} from '../tuning';
import { BuiltLevel, Rect, buildLevel } from '../world';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
}

type State = 'playing' | 'dying' | 'complete';

/**
 * Parallax depth. `scroll` is the scrollFactor, `mix` how far the terrain
 * colour is washed toward the background, `size` the block scale. Farther =
 * slower, fainter, smaller — the three cues that read as distance without blur.
 */
const BG_LAYERS = [
  { scroll: 0.15, mix: 0.88, size: 0.5 },
  { scroll: 0.3, mix: 0.78, size: 0.75 },
  { scroll: 0.5, mix: 0.66, size: 1.0 },
] as const;

/**
 * Area (px^2 of layer space) per background block. Tuned so roughly three or
 * four blocks per layer are on screen at once. Denser than this and the
 * background stops reading as depth and starts competing with the terrain the
 * player actually has to land on.
 */
const BG_AREA_PER_BLOCK = 36000;

/**
 * Assistance is LOCAL. It applies only within `ASSIST_RADIUS` of a spot the
 * player keeps dying at — never across the whole level. Someone who is fine
 * everywhere but one gap gets help at that gap and full difficulty elsewhere,
 * and a player who is not stuck never sees it at all.
 *
 * The radius is generous enough to cover the approach, since the jump that
 * fails begins well before the place you land.
 */
const ASSIST_RADIUS = 150;
/** Deaths in one spot before the terrain there is widened. */
const DEATHS_PER_SPOT_EASE = 4;
/** Cap on how many spots per level get terrain help, so a level cannot dissolve. */
const MAX_SPOT_EASES = 4;

/** Consecutive clean landings before the player can show a heart eye. */
const HEART_STREAK = 5;
/** Roughly one in four or five qualifying landings. */
const HEART_CHANCE = 0.22;
const HEART_TIME = 1.1;

/**
 * Stress: jump presses that produced no jump, scored with decay so it measures
 * a burst of mashing rather than a lifetime total. Roughly three wasted presses
 * inside ~1.5s trips it.
 */
const STRESS_THRESHOLD = 3;
/** Seconds for one wasted press to decay out of the score. */
const STRESS_DECAY = 1.5;
const STRESS_TIME = 1.3;

/**
 * Sustained running before the eye shifts to a focused look. Long enough that a
 * tap or a shuffle never triggers it — this should read as committed movement,
 * not as the face twitching every time you nudge the stick.
 */
const FOCUS_AFTER = 0.5;
/** Fraction of top speed that counts as running rather than drifting. */
const FOCUS_SPEED_FRAC = 0.82;

/**
 * The focused face, 5 wide, authored facing RIGHT and mirrored when facing left:
 *   # # . # #
 *   . . . # #
 * A motion streak trailing a forward-set eye. Deliberately unlike the stress
 * squint (a flat line) so the two never read as the same expression.
 */
const FOCUS_W = 5;
const FOCUS_PIXELS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [3, 0],
  [4, 0],
  [3, 1],
  [4, 1],
];

/** Standing still this long reads as stopping to think. */
const IDLE_AFTER = 5;
/** One full "..." thought cycle. */
const IDLE_CYCLE = 1.8;
/**
 * Thought dots, rising away from the head and mirrored to facing.
 * `[x, y, size]` inside a 6-wide box.
 */
const IDLE_DOTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 5, 1],
  [2, 3, 1],
  [4, 0, 2],
];
const IDLE_BOX_W = 6;

/**
 * Nervousness near a spot that has killed the player this many times. Set to
 * match the point where assistance begins, so the face and the help agree.
 * The radius is slightly wider than ASSIST_RADIUS so the nerves arrive first.
 */
const SCARED_HITS = 3;
const SCARED_RADIUS = 170;

/** A 2x3 sweat bead that drifts down and repeats while stressed. */
const SWEAT_PIXELS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [0, 2],
  [1, 2],
];

/**
 * A 5x4 heart, drawn pixel by pixel in place of the eye:
 *   . # . # .
 *   # # # # #
 *   . # # # .
 *   . . # . .
 * A 3x3 version was tried first and reads as a letter Y — there are not enough
 * pixels for the two lobes to register. Five wide still fits the 10px body.
 */
const HEART_W = 5;
const HEART_PIXELS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [3, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [3, 1],
  [4, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [2, 3],
];

interface BgLayer {
  gfx: Phaser.GameObjects.Graphics;
  scroll: number;
  /** Blobs move, so they need their own graphics redrawn each frame. */
  blobGfx: Phaser.GameObjects.Graphics;
  mix: number;
  size: number;
  shapes: Rect[];
  /** Just the standable tops, without the pillar stubs. Blobs live on these. */
  platforms: Rect[];
  blobs: BgBlob[];
}

/**
 * A distant figure hopping about on a background platform.
 *
 * Deliberately faint: the player's colour is the one thing the eye tracks, so a
 * saturated blob back here would read as another actor — worst right after a
 * death, when you are scanning for yourself. These sit ~80% of the way to the
 * background colour and only on the two far layers.
 */
interface BgBlob {
  x: number;
  /** Feet position. */
  y: number;
  vx: number;
  vy: number;
  plat: Rect;
  dir: number;
  timer: number;
  grounded: boolean;
  scale: number;
}

/** Blobs per layer, nearest layer last. The near layer gets none. */
const BG_BLOBS_PER_LAYER = [4, 3, 0] as const;

function clamp(v: number, lo: number, hi: number): number {
  if (lo > hi) return (lo + hi) / 2;
  return v < lo ? lo : v > hi ? hi : v;
}

function blend(a: number, b: number, t: number): number {
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

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export class GameScene extends Phaser.Scene {
  private levelIndex = 0;
  private runSeed = 1;

  private def!: LevelDef;
  private palette!: Palette;
  private level!: BuiltLevel;

  private player = new Player();
  private bots: Bot[] = [];
  private projectiles = new ProjectilePool();
  private particles: Particle[] = [];
  private gi!: GameInput;

  private accum = 0;
  private state: State = 'playing';
  private stateTimer = 0;
  private deaths = 0;
  private elapsed = 0;
  private progress01 = 0;

  private camX = 0;
  private camY = 0;
  private maxCamX = -Infinity;
  private minCamY = Infinity;
  private stepLen = 1;

  private debug = false;

  private bgLayers: BgLayer[] = [];
  private blobRng = new Rng(1);
  private fxRng = new Rng(1);
  private jumpStreak = 0;
  private midJump = false;
  private heartTimer = 0;
  private stressScore = 0;
  private stressTimer = 0;
  private runTimer = 0;
  private runDir = 1;
  private idleTimer = 0;
  private scared = false;
  private assist: Assist = NO_ASSIST;
  private deathSpots = new Map<string, { cx: number; cy: number; hits: number }>();
  private easedSpots = new Set<string>();
  private gTerrain!: Phaser.GameObjects.Graphics;
  private gEnt!: Phaser.GameObjects.Graphics;
  private gHud!: Phaser.GameObjects.Graphics;
  private txtLevel!: Phaser.GameObjects.BitmapText;
  private txtStats!: Phaser.GameObjects.BitmapText;
  private txtCenter!: Phaser.GameObjects.BitmapText;
  private txtSub!: Phaser.GameObjects.BitmapText;
  private txtDebug!: Phaser.GameObjects.BitmapText;

  constructor() {
    super('Game');
  }

  init(data: { levelIndex?: number; runSeed?: number }): void {
    this.levelIndex = data.levelIndex ?? 0;
    this.runSeed = data.runSeed ?? 1;
  }

  create(): void {
    this.gi = new GameInput(this);

    this.bgLayers = BG_LAYERS.map((cfg, i) => ({
      gfx: this.add.graphics().setDepth(i * 2).setScrollFactor(cfg.scroll),
      scroll: cfg.scroll,
      blobGfx: this.add.graphics().setDepth(i * 2 + 1).setScrollFactor(cfg.scroll),
      mix: cfg.mix,
      size: cfg.size,
      shapes: [] as Rect[],
      platforms: [] as Rect[],
      blobs: [] as BgBlob[],
    }));
    this.gTerrain = this.add.graphics().setDepth(10);
    this.gEnt = this.add.graphics().setDepth(20);
    this.gHud = this.add.graphics().setDepth(100).setScrollFactor(0);

    this.txtLevel = pixelText(this, 8, 8, '').setScrollFactor(0).setDepth(101);
    this.txtStats = pixelText(this, VIRTUAL_W - 8, 8, '', { originX: 1 })
      .setScrollFactor(0)
      .setDepth(101);
    this.txtCenter = pixelText(this, VIRTUAL_W / 2, VIRTUAL_H / 2 - 14, '', {
      scale: 2,
      originX: 0.5,
      originY: 0.5,
    })
      .setScrollFactor(0)
      .setDepth(101);
    this.txtSub = pixelText(this, VIRTUAL_W / 2, VIRTUAL_H / 2 + 10, '', {
      originX: 0.5,
      originY: 0.5,
    })
      .setScrollFactor(0)
      .setDepth(101);
    this.txtDebug = pixelText(this, 8, 24, '').setScrollFactor(0).setDepth(101).setVisible(false);

    // Audio cannot start outside a user gesture.
    this.input.once('pointerdown', resumeAudio);
    this.input.keyboard?.once('keydown', resumeAudio);
    this.input.keyboard?.on('keydown-M', () => toggleMuted());

    this.input.keyboard?.on('keydown-BACKTICK', () => {
      this.debug = !this.debug;
      this.txtDebug.setVisible(this.debug);
    });

    this.startLevel();
  }

  // -------------------------------------------------------------------------
  // Level lifecycle
  // -------------------------------------------------------------------------

  private startLevel(): void {
    this.def = LEVELS[this.levelIndex];
    this.palette = paletteFor(this.levelIndex);

    // One seeded stream builds the terrain AND the bots, so a retry after death
    // reproduces the level exactly.
    const rng = new Rng(levelSeed(this.runSeed, this.levelIndex));
    this.level = buildLevel(
      {
        family: this.def.family,
        chunkCount: this.def.chunkCount,
        difficultyScale: this.def.difficultyScale,
        enemyMix: this.def.enemyMix,
      },
      rng,
    );
    this.spawnBots();

    const s = STEP[this.def.family];
    this.stepLen = Math.hypot(s.x, s.y) * TILE;

    const bgRng = rng.fork();
    this.bgLayers.forEach((layer, i) => {
      const built = this.makeBgLayer(bgRng, BG_LAYERS[i].scroll, BG_LAYERS[i].size);
      layer.shapes = built.shapes;
      layer.platforms = built.platforms;
    });
    this.resetBlobs();

    this.deaths = 0;
    this.elapsed = 0;
    this.deathSpots.clear();
    this.easedSpots.clear();
    this.assist = NO_ASSIST;
    this.cameras.main.setBackgroundColor(this.palette.bg);
    this.drawStaticLayers();
    this.respawn(true);

    this.txtLevel.setTint(this.palette.ink);
    this.txtStats.setTint(this.palette.ink);
    this.txtCenter.setTint(this.palette.ink);
    this.txtSub.setTint(this.palette.ink);
    this.txtDebug.setTint(this.palette.ink);

    this.showBanner('', this.def.hint, 2.2);
  }

  private respawn(fresh: boolean): void {
    this.player.reset(this.level.startX, this.level.startY);
    this.projectiles.clear();
    this.particles.length = 0;
    this.gi.reset();

    this.spawnBots();
    this.resetBlobs();
    this.fxRng = new Rng((levelSeed(this.runSeed, this.levelIndex) ^ 0x9ea27) >>> 0);
    this.jumpStreak = 0;
    this.midJump = false;
    this.heartTimer = 0;
    this.stressScore = 0;
    this.stressTimer = 0;
    this.runTimer = 0;
    this.idleTimer = 0;
    this.scared = false;

    this.camX = this.player.x - VIRTUAL_W / 2;
    this.camY = this.player.y - VIRTUAL_H * 0.55;
    this.maxCamX = -Infinity;
    this.minCamY = Infinity;
    this.state = 'playing';
    this.updateCamera(FIXED_DT, true);
    this.stateTimer = 0;
    this.accum = 0;
    if (fresh) this.progress01 = 0;
  }

  /**
   * Bots come from their own stream, derived from the level seed. Both the
   * first attempt and every retry call this, so the bots a player learns are
   * the bots they get back.
   */
  private spawnBots(): void {
    const rng = new Rng((levelSeed(this.runSeed, this.levelIndex) ^ 0x5bf03635) >>> 0);
    this.bots = this.level.spawns.map((sp) => createBot(sp.kind, sp.x, sp.y, rng));
  }

  /**
   * Distant platforms, so the level reads as one ledge in a world full of them.
   *
   * Depth comes from contrast and scale, not blur: a real blur fights the pixel
   * grid and costs a shader. Far layers are smaller, washed further toward the
   * background colour, and move less.
   *
   * Shapes are generated in each layer's OWN coordinate space. A layer with
   * scrollFactor s only shows world x in [cam*s, cam*s + VIRTUAL_W], so across
   * the whole level it needs to span bounds.w * s + VIRTUAL_W — spreading them
   * over the full level bounds would leave the far layers nearly empty.
   */
  private makeBgLayer(
    rng: Rng,
    scroll: number,
    sizeScale: number,
  ): { shapes: Rect[]; platforms: Rect[] } {
    const b = this.level.bounds;
    const originX = b.x * scroll;
    const originY = b.y * scroll;
    const spanX = b.w * scroll + VIRTUAL_W;
    const spanY = b.h * scroll + VIRTUAL_H;

    const count = Math.round(clamp((spanX * spanY) / BG_AREA_PER_BLOCK, 6, 48));
    const out: Rect[] = [];
    const platforms: Rect[] = [];

    for (let i = 0; i < count; i++) {
      // Platform proportions: wide and short, like the real terrain.
      const w = rng.int(3, 7) * TILE * sizeScale;
      const h = rng.int(1, 2) * TILE * sizeScale;
      const x = Math.round(originX + rng.float(0, spanX));
      const y = Math.round(originY + rng.float(0, spanY));
      const top: Rect = { x, y, w, h };
      out.push(top);
      if (w >= 3 * TILE * sizeScale) platforms.push(top);

      // Some get a stub of ground beneath, so they read as terrain rather than
      // as bars floating in the sky.
      if (rng.bool(0.3)) {
        const pw = Math.max(TILE * sizeScale, w * rng.float(0.35, 0.65));
        out.push({
          x: Math.round(x + (w - pw) * rng.float(0.15, 0.85)),
          y: y + h,
          w: pw,
          h: rng.int(2, 4) * TILE * sizeScale,
        });
      }
    }
    return { shapes: out, platforms };
  }

  /**
   * Distant figures, hopping about and occasionally missing a jump.
   *
   * Cosmetic, but stepped at fixed dt from a seeded stream like everything
   * else, so a retry after death looks identical rather than subtly different.
   */
  private spawnBlobs(layer: BgLayer, n: number, rng: Rng): BgBlob[] {
    const out: BgBlob[] = [];
    if (!layer.platforms.length) return out;
    for (let i = 0; i < n; i++) {
      const plat = rng.pick(layer.platforms);
      out.push({
        x: plat.x + rng.float(0.2, 0.8) * plat.w,
        y: plat.y,
        vx: 0,
        vy: 0,
        plat,
        dir: rng.bool() ? 1 : -1,
        timer: rng.float(0.5, 3),
        grounded: true,
        scale: layer.size,
      });
    }
    return out;
  }

  /** Reseeded on every level start and retry, so the background replays too. */
  private resetBlobs(): void {
    this.blobRng = new Rng((levelSeed(this.runSeed, this.levelIndex) ^ 0x1b0b1e5) >>> 0);
    this.bgLayers.forEach((layer, i) => {
      layer.blobs = this.spawnBlobs(layer, BG_BLOBS_PER_LAYER[i], this.blobRng);
    });
  }

  /**
   * Move a blob onto a platform near the current view.
   *
   * Background platforms are scattered over the whole level, so blobs pinned to
   * random ones are almost never near the player — a first pass put at most one
   * on screen across an entire climb. Recycling a small pool toward the view
   * keeps a couple of them visible without flooding the background.
   *
   * Targets are chosen just OUTSIDE the view so the move is never seen; the
   * blob then drifts into frame as the camera travels.
   */
  private recycleBlob(layer: BgLayer, b: BgBlob, rng: Rng): void {
    const vx = this.camX * layer.scroll;
    const vy = this.camY * layer.scroll;
    const near = layer.platforms.filter((pl) => {
      const inX = pl.x > vx - VIRTUAL_W && pl.x < vx + VIRTUAL_W * 2;
      const inY = pl.y > vy - VIRTUAL_H && pl.y < vy + VIRTUAL_H * 2;
      const onScreen =
        pl.x + pl.w > vx && pl.x < vx + VIRTUAL_W && pl.y + pl.h > vy && pl.y < vy + VIRTUAL_H;
      return inX && inY && !onScreen;
    });
    const pool = near.length ? near : layer.platforms;
    if (!pool.length) return;
    const plat = rng.pick(pool);
    b.plat = plat;
    b.x = plat.x + rng.float(0.2, 0.8) * plat.w;
    b.y = plat.y;
    b.vx = 0;
    b.vy = 0;
    b.grounded = true;
    b.timer = rng.float(0.4, 2.2);
  }

  private stepBlobs(dt: number): void {
    const rng = this.blobRng;
    for (const layer of this.bgLayers) {
      const vx = this.camX * layer.scroll;
      const vy = this.camY * layer.scroll;
      for (const b of layer.blobs) {
        // Drifted well clear of the view: bring it back around.
        if (
          b.grounded &&
          (b.x < vx - VIRTUAL_W ||
            b.x > vx + VIRTUAL_W * 2 ||
            b.y < vy - VIRTUAL_H ||
            b.y > vy + VIRTUAL_H * 2)
        ) {
          this.recycleBlob(layer, b, rng);
        }

        const g = 780 * b.scale;
        const edgeL = b.plat.x + 1;
        const edgeR = b.plat.x + b.plat.w - 1;

        if (b.grounded) {
          b.x += b.dir * 26 * b.scale * dt;
          if (b.x < edgeL) {
            b.x = edgeL;
            b.dir = 1;
          } else if (b.x > edgeR) {
            b.x = edgeR;
            b.dir = -1;
          }
          b.timer -= dt;
          if (b.timer <= 0) {
            b.timer = rng.float(0.7, 3.2);
            // Mostly a hop in place; sometimes a run off the edge, which is
            // how a game about falling ought to decorate itself.
            if (rng.bool(0.78)) {
              b.vy = -rng.float(120, 175) * b.scale;
              b.grounded = false;
            } else {
              b.vx = b.dir * rng.float(40, 60) * b.scale;
              b.vy = -60 * b.scale;
              b.grounded = false;
            }
          }
        } else {
          b.vy += g * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          const overPlat = b.x >= edgeL && b.x <= edgeR;
          if (b.vy > 0 && b.y >= b.plat.y && overPlat) {
            b.y = b.plat.y;
            b.vx = 0;
            b.vy = 0;
            b.grounded = true;
          } else if (b.y > b.plat.y + 260 * b.scale) {
            // Missed it. Pick a new home and carry on somewhere else.
            this.recycleBlob(layer, b, rng);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  override update(_time: number, delta: number): void {
    this.gi.poll();

    if (this.gi.menuPressed) {
      this.scene.start('Menu');
      return;
    }
    if (this.gi.restartPressed && this.state === 'playing') {
      this.die();
    }

    this.accum += Math.min(delta / 1000, 0.25);
    let steps = 0;
    while (this.accum >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      this.fixedStep(FIXED_DT);
      this.accum -= FIXED_DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_FRAME) this.accum = 0;

    this.render();
  }

  private fixedStep(dt: number): void {
    this.stepParticles(dt);
    this.stepBlobs(dt);

    if (this.state === 'dying') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.respawn(false);
      return;
    }
    if (this.state === 'complete') {
      this.stateTimer -= dt;
      if (this.stateTimer <= 0) this.advance();
      return;
    }

    this.elapsed += dt;
    const p = this.player;
    const grid = this.level.grid;
    this.assist = this.assistAt(p.x, p.y);

    p.step(dt, this.gi, grid, this.assist);

    if (p.events.landed) this.burst(p.x, p.y + PLAYER_H / 2, 4, this.palette.env, 40);
    if (p.events.doubleJumped) this.burst(p.x, p.y + PLAYER_H / 2, 6, this.palette.player, 55);

    // A jump "lands" successfully when it ends grounded rather than dead. After
    // a run of them, the player occasionally looks pleased with itself.
    if (p.events.jumped || p.events.doubleJumped || p.events.stomped) this.midJump = true;
    if (p.events.landed && this.midJump) {
      this.midJump = false;
      this.jumpStreak++;
      if (this.jumpStreak >= HEART_STREAK && this.fxRng.bool(HEART_CHANCE)) {
        this.heartTimer = HEART_TIME;
      }
    }
    if (this.heartTimer > 0) this.heartTimer -= dt;

    // Focus builds only while genuinely running, and resets the moment the
    // player turns around or lets go. Airborne still counts: a jump taken
    // mid-sprint is part of the same continuous movement, and dropping the
    // look for every jump would make it flicker.
    const running = Math.abs(p.vx) > TUNING.runSpeed * FOCUS_SPEED_FRAC;
    if (running && p.facing === this.runDir) this.runTimer += dt;
    else {
      this.runTimer = 0;
      this.runDir = p.facing;
    }

    // Standing still, on the ground, hands off the controls.
    const still = p.grounded && Math.abs(p.vx) < 4 && !this.gi.left && !this.gi.right;
    this.idleTimer = still ? this.idleTimer + dt : 0;

    // Nerves near somewhere that has killed them repeatedly.
    this.scared = false;
    for (const spot of this.deathSpots.values()) {
      if (spot.hits < SCARED_HITS) continue;
      if (Math.hypot(p.x - spot.cx, p.y - spot.cy) <= SCARED_RADIUS) {
        this.scared = true;
        break;
      }
    }

    // Stress: wasted presses accumulate, and decay when the player settles.
    this.stressScore = Math.max(0, this.stressScore - dt / STRESS_DECAY);
    if (p.events.jumpWasted) {
      this.stressScore += 1;
      if (this.stressScore >= STRESS_THRESHOLD) {
        this.stressTimer = STRESS_TIME;
        this.heartTimer = 0; // pleased and panicking are not the same face
      }
    }
    if (this.stressTimer > 0) this.stressTimer -= dt;

    const ctx = {
      grid,
      assist: this.assist,
      playerX: p.x,
      playerY: p.y,
      projectiles: this.projectiles,
    };
    for (const b of this.bots) if (b.alive) b.step(dt, ctx);
    this.projectiles.step(dt, grid);

    this.collide();
    if (this.state !== 'playing') return;

    this.updateCamera(dt);

    // Kill plane. This is what makes the bot-gated jumps safe — a missed
    // landing is a fast retry, not a softlock.
    //
    // In a climb it hangs from the highest point reached rather than the live
    // camera, so the camera is free to follow the player down onto a lower
    // platform without quietly making every fall survivable.
    const climbing = this.level.axis.y < -0.1;
    const floor = climbing && this.minCamY !== Infinity ? this.minCamY : this.camY;
    if (p.y > floor + VIRTUAL_H + 28) this.die();

    const ax = this.level.axis;
    const travelled = (p.x - this.level.startX) * ax.x + (p.y - this.level.startY) * ax.y;
    this.progress01 = clamp(travelled / this.level.totalDistance, 0, 1);
  }

  private collide(): void {
    const p = this.player;
    const pb: Rect = { x: p.left, y: p.top, w: PLAYER_W, h: PLAYER_H };

    for (const s of this.level.spikes) {
      if (rectsOverlap(pb, s)) return this.die();
    }

    for (const pr of this.projectiles.items) {
      if (!pr.active) continue;
      const cx = clamp(pr.x, pb.x, pb.x + pb.w);
      const cy = clamp(pr.y, pb.y, pb.y + pb.h);
      const dx = pr.x - cx;
      const dy = pr.y - cy;
      if (dx * dx + dy * dy <= pr.r * pr.r) return this.die();
    }

    for (const b of this.bots) {
      if (!b.alive) continue;
      const bb: Rect = { x: b.left, y: b.top, w: b.w, h: b.h };
      if (!rectsOverlap(pb, bb)) continue;

      // Stomp: falling, and the player's feet are above the bot's midline.
      if (p.vy > 0 && pb.y + pb.h <= b.y + 4) {
        b.kill();
        p.stompBounce();
        this.burst(b.x, b.y, 12, this.palette.hazard, 90);
        this.cameras.main.shake(90, 0.006);
      } else {
        return this.die();
      }
    }

    if (rectsOverlap(pb, this.level.goal)) this.complete();
  }

  /**
   * The vertical band the camera may occupy, interpolated across the chunk
   * seam rather than switching at it.
   *
   * A per-chunk window that snaps at the boundary makes the camera lurch every
   * time you cross one — and in a climb you cross them constantly, including
   * backwards when you step aside to line up a jump. Interpolating keeps the
   * bound continuous while still pinning the view near the current chunk,
   * which is what makes a pit lethal in horizontal levels.
   */
  private chunkBandY(idx: number, frac: number): { lo: number; hi: number } {
    const chunks = this.level.chunks;
    const a = chunks[clamp(idx, 0, chunks.length - 1)];
    const b = chunks[clamp(idx + 1, 0, chunks.length - 1)];
    const aTop = a.oy * TILE;
    const top = aTop + (b.oy * TILE - aTop) * frac;
    return { lo: top - 44, hi: top + CHUNK_H * TILE + 30 - VIRTUAL_H };
  }

  /** `snap` jumps straight to the target instead of easing — used on respawn. */
  private updateCamera(dt: number, snap = false): void {
    const p = this.player;
    const ax = this.level.axis;
    const b = this.level.bounds;

    const horizontal = Math.abs(ax.x) > 0.1;
    const vertical = ax.y < -0.1;

    const travelled = (p.x - this.level.startX) * ax.x + (p.y - this.level.startY) * ax.y;
    const raw = travelled / this.stepLen;
    const idx = clamp(Math.floor(raw), 0, this.level.chunks.length - 1);
    const frac = clamp(raw - Math.floor(raw), 0, 1);

    // --- Lead: only along the direction of travel --------------------------
    // Leading on the perpendicular axis swings the view every time the player
    // steps sideways to line up a jump, which reads as the camera fighting you.
    const leadX = vertical ? (horizontal ? 10 : 0) : p.facing * 18;
    const leadY = vertical ? -20 : 0;

    // --- Deadzone on the perpendicular axis --------------------------------
    // Small adjustments inside the band do not move the camera at all.
    const dzX = vertical ? (horizontal ? 24 : 56) : 0;
    const dzY = horizontal && !vertical ? 30 : 0;

    const curCX = this.camX + VIRTUAL_W / 2;
    const curCY = this.camY + VIRTUAL_H * 0.55;

    let tx: number;
    if (dzX > 0) {
      const d = p.x + leadX - curCX;
      tx = this.camX + (Math.abs(d) > dzX ? d - Math.sign(d) * dzX : 0);
    } else {
      tx = p.x - VIRTUAL_W / 2 + leadX;
    }

    let ty: number;
    if (dzY > 0) {
      const d = p.y + leadY - curCY;
      ty = this.camY + (Math.abs(d) > dzY ? d - Math.sign(d) * dzY : 0);
    } else {
      ty = p.y - VIRTUAL_H * 0.55 + leadY;
    }

    // --- Clamp -------------------------------------------------------------
    // X always uses the level's own bounds: stable, with no seam discontinuity.
    tx = clamp(tx, b.x, b.x + b.w - VIRTUAL_W);
    if (horizontal && !vertical) {
      // Purely horizontal: the chunk band on Y is what creates the kill plane.
      const band = this.chunkBandY(idx, frac);
      ty = clamp(ty, band.lo, band.hi);
    } else {
      // Climbs get their kill plane from the monotonic camera below.
      ty = clamp(ty, b.y, b.y + b.h - VIRTUAL_H);
    }

    const k = snap ? 1 : 1 - Math.pow(0.00005, dt);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;

    // Horizontally the camera never travels backward: that, plus the soft wall
    // below, is what keeps the player from walking out of frame.
    if (ax.x > 0.1) {
      this.camX = Math.max(this.camX, this.maxCamX === -Infinity ? this.camX : this.maxCamX);
      this.maxCamX = this.camX;
    }

    // Vertically it is free to pan back down. A climb used to pin the camera at
    // its highest point because the kill plane hung off it — so surviving a
    // fall onto a lower platform left the player alive but off-screen, guessing
    // where they were. `minCamY` is now only a high-water mark, recorded here
    // and used by the kill plane, so falling stays lethal without the camera
    // having to enforce it.
    if (vertical) {
      this.minCamY = Math.min(this.minCamY === Infinity ? this.camY : this.minCamY, this.camY);
    }

    // Soft wall at the trailing screen edge so you cannot walk out of view.
    if (ax.x > 0.1 && p.left < this.camX + 2) {
      p.x = this.camX + 2 + PLAYER_W / 2;
      if (p.vx < 0) p.vx = 0;
    }

    this.cameras.main.setScroll(Math.round(this.camX), Math.round(this.camY));
  }

  /** Coarse bucket for "roughly the same place", three tiles across. */
  private spotKey(x: number, y: number): string {
    return `${Math.floor(x / (TILE * 3))},${Math.floor(y / (TILE * 3))}`;
  }

  /**
   * Assistance in force at a position — the strongest of any trouble spot the
   * player is currently near. Away from trouble spots this returns NO_ASSIST,
   * so the level plays at full difficulty everywhere the player is coping.
   */
  private assistAt(x: number, y: number): Assist {
    const per = this.def.deathsPerAssistTier;
    if (per <= 0 || this.deathSpots.size === 0) return NO_ASSIST;

    let worst = 0;
    for (const spot of this.deathSpots.values()) {
      if (spot.hits < per) continue;
      if (Math.hypot(x - spot.cx, y - spot.cy) > ASSIST_RADIUS) continue;
      if (spot.hits > worst) worst = spot.hits;
    }
    return worst ? assistFor(worst, per) : NO_ASSIST;
  }

  /**
   * Widen the footing at one spot the player keeps failing.
   *
   * Scoped deliberately: only the tiles around a repeated death move, and only
   * once each. Everything else in the level stays exactly as learned. Easing a
   * choke point is safe in a way that reshuffling the level is not — the muscle
   * memory built at a spot you have died on five times is memory of a jump you
   * cannot make, so there is nothing there worth preserving.
   *
   * Only ever ADDS floor to the outer edge of an existing ledge, so a route can
   * be made easier but never blocked.
   */
  private easeTerrainNear(x: number, y: number): boolean {
    const grid = this.level.grid;
    const ptx = Math.floor(x / TILE);
    const pty = Math.floor(y / TILE);

    // Standable ledge edges near the death: solid, walkable on top, with a drop
    // immediately to one side.
    const edges: { tx: number; ty: number; dir: number; d: number }[] = [];
    for (let ty = pty - 7; ty <= pty + 3; ty++) {
      for (let tx = ptx - 9; tx <= ptx + 9; tx++) {
        if (!grid.solidAt(tx, ty) || grid.solidAt(tx, ty - 1)) continue;
        for (const dir of [-1, 1]) {
          // The neighbour must be open, and stay open above, or we would be
          // building a wall rather than a ledge.
          if (grid.solidAt(tx + dir, ty) || grid.solidAt(tx + dir, ty - 1)) continue;
          edges.push({ tx, ty, dir, d: Math.hypot(tx - ptx, (ty - pty) * 1.5) });
        }
      }
    }
    if (!edges.length) return false;
    edges.sort((a, b) => a.d - b.d);

    // Extend at most the two nearest edges — one tile each, so a gap closes by
    // up to two tiles at this spot and nowhere else.
    let changed = 0;
    const used = new Set<string>();
    for (const e of edges) {
      if (changed >= 2) break;
      const key = `${e.tx},${e.ty},${e.dir}`;
      if (used.has(key)) continue;
      used.add(key);
      const nx = e.tx + e.dir;
      grid.set(nx, e.ty, 1);
      this.level.terrain.push({ x: nx * TILE, y: e.ty * TILE, w: TILE, h: TILE });
      changed++;
    }

    if (changed) this.drawStaticLayers();
    return changed > 0;
  }

  private die(): void {
    if (this.state !== 'playing') return;

    // Record where this happened; enough deaths in one place earns a nudge.
    const key = this.spotKey(this.player.x, this.player.y);
    const spot = this.deathSpots.get(key) ?? { cx: this.player.x, cy: this.player.y, hits: 0 };
    spot.hits++;
    this.deathSpots.set(key, spot);

    if (
      spot.hits >= DEATHS_PER_SPOT_EASE &&
      !this.easedSpots.has(key) &&
      this.easedSpots.size < MAX_SPOT_EASES
    ) {
      if (this.easeTerrainNear(this.player.x, this.player.y)) this.easedSpots.add(key);
    }

    this.state = 'dying';
    this.stateTimer = TUNING.deathFreeze + TUNING.respawnDelay;
    playDeath();
    this.deaths++;
    this.jumpStreak = 0;
    this.heartTimer = 0;
    this.stressScore = 0;
    this.stressTimer = 0;
    this.runTimer = 0;
    this.idleTimer = 0;
    this.scared = false;
    this.player.alive = false;
    this.burst(this.player.x, this.player.y, 22, this.palette.player, 130);
    this.cameras.main.shake(160, 0.012);
  }

  private complete(): void {
    if (this.state !== 'playing') return;
    this.state = 'complete';
    this.stateTimer = 1.9;
    this.progress01 = 1;
    this.burst(this.player.x, this.player.y, 30, this.palette.player, 120);
    recordCompletion(this.levelIndex, this.elapsed, this.deaths);
    const last = this.levelIndex >= LEVELS.length - 1;
    this.showBanner(
      last ? 'ALL CLEAR' : 'LEVEL CLEAR',
      `${formatTime(this.elapsed)}   deaths ${this.deaths}`,
      1.9,
    );
  }

  private advance(): void {
    if (this.levelIndex >= LEVELS.length - 1) {
      this.scene.start('Menu');
      return;
    }
    this.levelIndex++;
    this.startLevel();
  }

  private showBanner(title: string, sub: string, seconds: number): void {
    this.txtCenter.setText(upper(title)).setAlpha(1);
    this.txtSub.setText(upper(sub)).setAlpha(1);
    this.tweens.add({
      targets: [this.txtCenter, this.txtSub],
      alpha: 0,
      delay: seconds * 1000 * 0.6,
      duration: seconds * 1000 * 0.4,
    });
  }

  // -------------------------------------------------------------------------
  // Particles
  // -------------------------------------------------------------------------

  private burst(x: number, y: number, n: number, color: number, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 3) * 0.4;
      const sp = speed * (0.45 + ((i * 37) % 55) / 100);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 25,
        life: 0.45,
        maxLife: 0.45,
        size: 2 + (i % 2),
        color,
      });
    }
    if (this.particles.length > 260) this.particles.splice(0, this.particles.length - 260);
  }

  private stepParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vy += 420 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private drawStaticLayers(): void {
    const pal = this.palette;

    // Each layer is the terrain colour washed toward the background. The
    // nearest is still clearly lighter than real terrain, so nothing in the
    // background can be mistaken for something you can stand on.
    for (const layer of this.bgLayers) {
      layer.gfx.clear();
      layer.gfx.fillStyle(blend(pal.env, pal.bg, layer.mix), 1);
      for (const s of layer.shapes) layer.gfx.fillRect(s.x, s.y, s.w, s.h);
    }

    this.gTerrain.clear();
    this.gTerrain.fillStyle(pal.env, 1);
    for (const r of this.level.terrain) this.gTerrain.fillRect(r.x, r.y, r.w, r.h);

    // Spikes as triangles so they read as dangerous at a glance.
    this.gTerrain.fillStyle(pal.hazard, 1);
    for (const s of this.level.spikes) {
      this.gTerrain.fillTriangle(s.x, s.y + s.h, s.x + s.w / 2, s.y, s.x + s.w, s.y + s.h);
    }
  }

  /** Distant figures. Redrawn each frame; the platforms behind them are static. */
  private drawBlobs(): void {
    const pal = this.palette;
    for (const layer of this.bgLayers) {
      const g = layer.blobGfx;
      g.clear();
      if (!layer.blobs.length) continue;

      // A fixed step more saturated than this layer's platforms, so a blob
      // reads against the block it stands on. Still nowhere near the player's
      // full saturation, and farther layers stay fainter than nearer ones.
      g.fillStyle(blend(pal.player, pal.bg, Math.max(0.35, layer.mix - 0.28)), 1);
      for (const b of layer.blobs) {
        const stretch = clamp(Math.abs(b.vy) / (420 * b.scale), 0, 0.3);
        const w = Math.max(3, Math.round(6 * b.scale * (1 - stretch * 0.6)));
        const h = Math.max(4, Math.round(8 * b.scale * (1 + stretch)));
        g.fillRect(Math.round(b.x - w / 2), Math.round(b.y - h), w, h);
      }
    }
  }

  private render(): void {
    const pal = this.palette;
    const g = this.gEnt;
    g.clear();
    this.drawBlobs();

    // --- Goal --------------------------------------------------------------
    const goal = this.level.goal;
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 5);
    g.fillStyle(blend(pal.player, 0xffffff, pulse * 0.5), 1);
    g.fillRect(goal.x + 3, goal.y, goal.w - 6, goal.h);
    g.fillStyle(pal.player, 1);
    g.fillRect(goal.x + 1, goal.y + goal.h - 3, goal.w - 2, 3);

    // --- Projectiles -------------------------------------------------------
    g.fillStyle(pal.hazard, 1);
    for (const pr of this.projectiles.items) {
      if (!pr.active) continue;
      g.fillRect(pr.x - pr.r, pr.y - pr.r, pr.r * 2, pr.r * 2);
    }

    // --- Bots --------------------------------------------------------------
    for (const b of this.bots) {
      if (!b.alive) continue;
      const c = b.windup > 0 ? blend(pal.hazard, 0xffffff, b.windup * 0.8) : pal.hazard;
      g.fillStyle(c, 1);
      g.fillRect(b.left, b.top, b.w, b.h);
      // A darker band on top marks the stompable face.
      g.fillStyle(blend(c, 0x000000, 0.25), 1);
      g.fillRect(b.left, b.top, b.w, 2);
    }

    // --- Player trail ------------------------------------------------------
    const p = this.player;
    if (p.alive) {
      for (const t of p.trail) {
        const a = (t.life / 0.22) * 0.3;
        g.fillStyle(pal.player, a);
        g.fillRect(t.x - 3, t.y - 4, 6, 8);
      }

      const w = PLAYER_W * p.scaleX;
      const h = PLAYER_H * p.scaleY;
      // A 1px shiver while nervous. Visual only — physics never sees it.
      const shiver = this.scared ? Math.floor(this.elapsed * 14) % 2 : 0;
      const px = p.x - w / 2 + shiver;
      const py = p.y + PLAYER_H / 2 - h; // anchored at the feet
      g.fillStyle(pal.player, 1);
      g.fillRoundedRect(px, py, w, h, 2);

      // Thought dots while idle, outside the body so they need the body colour.
      if (this.idleTimer >= IDLE_AFTER) {
        const phase = (this.idleTimer % IDLE_CYCLE) / IDLE_CYCLE;
        const shown = phase < 0.22 ? 1 : phase < 0.44 ? 2 : phase < 0.85 ? 3 : 0;
        const bx = Math.round(p.facing > 0 ? px + w * 0.5 : px + w * 0.5 - IDLE_BOX_W);
        const by = Math.round(py - 9);
        for (let i = 0; i < shown; i++) {
          const [dx, dy, size] = IDLE_DOTS[i];
          const mx = p.facing > 0 ? dx : IDLE_BOX_W - size - dx;
          g.fillRect(bx + mx, by + dy, size, size);
        }
      }
      // Facing notch, in the background colour, so it reads as an eye — or a
      // heart, when a run of clean landings has left the player pleased.
      g.fillStyle(pal.bg, 1);
      const ex = Math.round(p.facing > 0 ? px + w - 4 : px + 2);
      if (this.stressTimer > 0) {
        // Squint: a flat line reads as a screwed-shut eye at this size.
        g.fillRect(ex - 1, Math.round(py + 4), 3, 1);
      } else if (this.heartTimer === 0 && this.scared) {
        // Wide eyes. Two of them is the whole trick — every other expression
        // here uses one mark, so a pair reads instantly as startled.
        g.fillRect(Math.round(px + w * 0.18), Math.round(py + 3), 2, 2);
        g.fillRect(Math.round(px + w * 0.58), Math.round(py + 3), 2, 2);
      } else if (this.heartTimer === 0 && this.runTimer >= FOCUS_AFTER) {
        // Streak behind a forward-set eye, mirrored to face travel.
        const fx = Math.round(p.facing > 0 ? px + w - FOCUS_W - 1 : px + 1);
        const fy = Math.round(py + 3);
        for (const [dx, dy] of FOCUS_PIXELS) {
          const mx = p.facing > 0 ? dx : FOCUS_W - 1 - dx;
          g.fillRect(fx + mx, fy + dy, 1, 1);
        }
      } else if (this.heartTimer > 0) {
        // Keep the whole heart on the body, on whichever side the eye is.
        const hx = Math.round(p.facing > 0 ? px + w - HEART_W - 1 : px + 1);
        const hy = Math.round(py + 2);
        for (const [dx, dy] of HEART_PIXELS) g.fillRect(hx + dx, hy + dy, 1, 1);
      } else {
        g.fillRect(ex, py + 3, 2, 2);
      }

      // Sweat bead, off the trailing edge so it never sits on the face.
      if (this.stressTimer > 0) {
        const phase = (this.elapsed * 2.2) % 1;
        const sx = Math.round(p.facing > 0 ? px - 3 : px + w + 1);
        const sy = Math.round(py + phase * 7);
        g.fillStyle(pal.player, 1);
        for (const [dx, dy] of SWEAT_PIXELS) g.fillRect(sx + dx, sy + dy, 1, 1);
      }
    }

    // --- Particles ---------------------------------------------------------
    for (const q of this.particles) {
      g.fillStyle(q.color, Math.max(0, q.life / q.maxLife));
      g.fillRect(q.x, q.y, q.size, q.size);
    }

    if (this.debug) this.drawDebug(g);
    this.drawHud();
  }

  private drawDebug(g: Phaser.GameObjects.Graphics): void {
    const p = this.player;
    g.lineStyle(1, 0xff0000, 0.9);
    g.strokeRect(p.left, p.top, PLAYER_W, PLAYER_H);
    for (const b of this.bots) {
      if (!b.alive) continue;
      g.strokeRect(b.left, b.top, b.w, b.h);
    }
    g.lineStyle(1, 0x0000ff, 0.6);
    g.strokeRect(this.camX, this.camY + VIRTUAL_H + 28, VIRTUAL_W, 1);

    this.txtDebug.setText(
      [
        `vx ${p.vx.toFixed(0)}  vy ${p.vy.toFixed(0)}`,
        `grounded ${p.grounded ? 'Y' : 'N'}  jumps ${p.jumpsLeft}`,
        `bots ${this.bots.filter((b) => b.alive).length}  parts ${this.particles.length}`,
        `chunks ${this.level.chunks.length}  rects ${this.level.terrain.length}`,
        `assist ${this.assist.tier}  spots ${this.deathSpots.size}  eased ${this.easedSpots.size}`,
        `idle ${this.idleTimer.toFixed(1)}  run ${this.runTimer.toFixed(1)}  scared ${this.scared ? 'Y' : 'N'}`,
      ]
        .join('\n')
        .toUpperCase(),
    );
  }

  private drawHud(): void {
    const pal = this.palette;
    const g = this.gHud;
    g.clear();

    // Progress bar.
    const bw = 120;
    const bx = (VIRTUAL_W - bw) / 2;
    g.fillStyle(pal.ink, 0.18);
    g.fillRect(bx, 7, bw, 3);
    g.fillStyle(pal.player, 1);
    g.fillRect(bx, 7, bw * this.progress01, 3);

    this.txtLevel.setText(upper(`${this.levelIndex + 1}. ${this.def.name}`));
    this.txtStats.setText(upper(`${formatTime(this.elapsed)}  x${this.deaths}`));

    if (this.gi.touchActive) this.drawTouchButtons(g);
  }

  private drawTouchButtons(g: Phaser.GameObjects.Graphics): void {
    const pal = this.palette;
    const btn = (cx: number, cy: number, active: boolean, label: 'l' | 'r' | 'j') => {
      g.fillStyle(pal.ink, active ? 0.3 : 0.14);
      g.fillCircle(cx, cy, 19);
      g.fillStyle(pal.ink, active ? 0.85 : 0.5);
      if (label === 'j') {
        g.fillTriangle(cx, cy - 7, cx - 7, cy + 5, cx + 7, cy + 5);
      } else {
        const s = label === 'l' ? -1 : 1;
        g.fillTriangle(cx + s * 6, cy, cx - s * 4, cy - 7, cx - s * 4, cy + 7);
      }
    };
    btn(TOUCH_BUTTONS.left.cx, TOUCH_BUTTONS.left.cy, this.gi.left, 'l');
    btn(TOUCH_BUTTONS.right.cx, TOUCH_BUTTONS.right.cy, this.gi.right, 'r');
    btn(TOUCH_BUTTONS.jump.cx, TOUCH_BUTTONS.jump.cy, this.gi.jumpHeld, 'j');
  }
}

