import Phaser from 'phaser';
import { resumeAudio, startMusic, toggleMuted } from '../audio';
import { pixelText } from '../font';
import { LEVELS, RUN_SEED, formatTime, loadProgress } from '../levels';
import { PALETTES } from '../palette';
import { TROPHIES, loadTrophies } from '../trophies';
import {
  TUFFLINGS,
  TufflingDef,
  TufflingId,
  blend,
  drawTufflingMini,
  drawTufflingPreview,
  loadTufflingId,
  tufflingById,
} from '../tufflings';
import { VIRTUAL_H, VIRTUAL_W } from '../tuning';

const ROW_H = 16;
const ROW_TOP = 96;
/** The Tufflings row sits under the levels, a little apart from them. */
const TUFFLINGS_ROW = LEVELS.length;
const TROPHIES_ROW = LEVELS.length + 1;
const ROW_COUNT = LEVELS.length + 2;
/**
 * The whole cast is on the title screen. The one you picked stands beside the
 * title at in-game size; the rest idle on little ledges out at the sides,
 * small and quiet so the screen stays calm, each doing its own thing.
 */
interface Spot {
  x: number;
  /** Where its feet rest, in screen pixels. */
  feetY: number;
  /** Which way it faces when settled: toward the title, or toward the middle. */
  facing: number;
}
/** Beside the title, its body centred on the lettering (the text's centre is y 40). */
const TITLE_SPOT: Spot = { x: 332, feetY: 47, facing: -1 };
const SIDE_SPOTS: readonly Spot[] = [
  { x: 62, feetY: 150, facing: 1 },
  { x: 418, feetY: 186, facing: -1 },
  { x: 62, feetY: 222, facing: 1 },
];
/** Switching Tufflings: everyone hops to their new spot. */
const HOP_MS = 900;
const HOP_ARC = 34;
/** The ones at the side, drawn this much smaller than their real size. */
const SIDE_SCALE = 0.6;
/** What they get up to, taking turns: stroll along the ledge, hop, or just rest. */
const IDLE_ACTS = ['wander', 'rest', 'hop', 'wander', 'rest', 'wander', 'hop', 'rest'] as const;
const IDLE_PERIOD = 2.8;

/** Who stood beside the title last time, so a new pick can hop up to take its place. */
let lastPick: TufflingId | null = null;

/** Who stands where, for a given pick: it takes the title, the rest fill the sides in roster order. */
function layout(pick: TufflingId): Map<TufflingId, Spot> {
  const m = new Map<TufflingId, Spot>();
  let side = 0;
  for (const t of TUFFLINGS) m.set(t.id, t.id === pick ? TITLE_SPOT : SIDE_SPOTS[side++]);
  return m;
}

export class MenuScene extends Phaser.Scene {
  private selected = 0;
  private rows: Phaser.GameObjects.BitmapText[] = [];
  private carets: Phaser.GameObjects.BitmapText[] = [];
  private unlocked = 0;
  private runSeed = RUN_SEED;
  private cast!: Phaser.GameObjects.Graphics;
  private moves: { def: TufflingDef; from: Spot; to: Spot }[] = [];
  private moveStart = -1;
  private tuffling = tufflingById(loadTufflingId());

  constructor() {
    super('Menu');
  }

  init(data: { runSeed?: number }): void {
    this.runSeed = data.runSeed ?? this.runSeed;
  }

  create(): void {
    const pal = PALETTES[0];
    this.cameras.main.setBackgroundColor(pal.bg);

    // Phaser reuses the scene instance across restarts, so create() runs again
    // on the same object. Without this, every trip back from the game pushes a
    // second set of rows onto the old ones and refresh() then updates destroyed
    // objects from the previous visit — which is exactly what made the arrow
    // keys look dead after pressing Esc.
    this.rows.length = 0;
    this.carets.length = 0;

    const progress = loadProgress();
    this.unlocked = progress.unlocked;
    // Start on the first level not yet beaten. Starting on the LAST unlocked
    // one left Down with nowhere to go, which reads as the keys not working.
    const firstUnbeaten = LEVELS.findIndex((_, i) => i <= this.unlocked && !progress.best[i]);
    this.selected = firstUnbeaten >= 0 ? firstUnbeaten : Math.min(this.unlocked, LEVELS.length - 1);

    const g = this.add.graphics();
    g.fillStyle(pal.bgAccent, 0.55);
    for (let i = 0; i < 10; i++) {
      g.fillRect(((i * 79) % VIRTUAL_W) - 24, 24 + ((i * 53) % (VIRTUAL_H - 60)), 58, 34);
    }

    pixelText(this, VIRTUAL_W / 2, 40, 'Foothold', {
      scale: 3,
      color: pal.ink,
      originX: 0.5,
      originY: 0.5,
    });

    this.tuffling = tufflingById(loadTufflingId());

    // Little ledges for the ones at the side.
    const ledges = this.add.graphics();
    for (const sp of SIDE_SPOTS) {
      ledges.fillStyle(blend(pal.env, pal.bg, 0.35), 1);
      ledges.fillRect(sp.x - 15, sp.feetY, 30, 2);
      ledges.fillStyle(blend(pal.env, pal.bg, 0.6), 1);
      ledges.fillRect(sp.x - 13, sp.feetY + 2, 26, 1);
    }

    // Everyone's spot now, and where they were last time: if the pick changed,
    // they all hop across to their new places.
    const pick = this.tuffling.id;
    const to = layout(pick);
    const from = lastPick && lastPick !== pick ? layout(lastPick) : to;
    this.moves = TUFFLINGS.map((def) => ({ def, from: from.get(def.id)!, to: to.get(def.id)! }));
    this.moveStart = -1;
    lastPick = pick;
    this.cast = this.add.graphics();

    pixelText(this, VIRTUAL_W / 2, 66, 'Stomp a bot to refresh your double jump', {
      color: pal.env,
      originX: 0.5,
    });

    LEVELS.forEach((lv, i) => {
      const locked = i > this.unlocked;
      const best = progress.best[i];
      const right = locked ? 'LOCKED' : best ? `${formatTime(best.time)}  X${best.deaths}` : '--';
      const y = ROW_TOP + i * ROW_H;

      // A caret rather than a scale bump: scaling a bitmap font off the pixel
      // grid is exactly the blurriness we just removed.
      this.carets.push(
        pixelText(this, VIRTUAL_W / 2 - 118, y, '>', { color: pal.player, originY: 0.5 }),
      );

      const t = pixelText(this, VIRTUAL_W / 2 - 100, y, `${i + 1}. ${lv.name}`, {
        color: locked ? pal.env : pal.ink,
        originY: 0.5,
      }).setAlpha(locked ? 0.5 : 1);

      pixelText(this, VIRTUAL_W / 2 + 118, y, right, {
        color: pal.env,
        originX: 1,
        originY: 0.5,
      }).setAlpha(locked ? 0.5 : 1);

      if (!locked) {
        // Generous hit area: the glyphs themselves are only 7px tall.
        t.setInteractive(
          new Phaser.Geom.Rectangle(-110, -ROW_H / 2, 240, ROW_H),
          Phaser.Geom.Rectangle.Contains,
        );
        t.on('pointerover', () => {
          this.selected = i;
          this.refresh();
        });
        t.on('pointerdown', () => {
          this.selected = i;
          this.start();
        });
      }
      this.rows.push(t);
    });

    // Tufflings: pick who does the jumping.
    const py = ROW_TOP + TUFFLINGS_ROW * ROW_H + 6;
    this.carets.push(pixelText(this, VIRTUAL_W / 2 - 118, py, '>', { color: pal.player, originY: 0.5 }));
    const pt = pixelText(this, VIRTUAL_W / 2 - 100, py, 'Tufflings', { color: pal.ink, originY: 0.5 });
    pixelText(this, VIRTUAL_W / 2 + 118, py, this.tuffling.name, {
      color: pal.env,
      originX: 1,
      originY: 0.5,
    });
    pt.setInteractive(new Phaser.Geom.Rectangle(-110, -ROW_H / 2, 240, ROW_H), Phaser.Geom.Rectangle.Contains);
    pt.on('pointerover', () => {
      this.selected = TUFFLINGS_ROW;
      this.refresh();
    });
    pt.on('pointerdown', () => {
      this.selected = TUFFLINGS_ROW;
      this.start();
    });
    this.rows.push(pt);

    // Trophies: the shelf of everything found so far.
    this.addExtraRow(TROPHIES_ROW, 'Trophies', `${loadTrophies().size}/${TROPHIES.length}`);

    pixelText(this, VIRTUAL_W / 2, VIRTUAL_H - 30, 'Arrows or A D - Space to jump', {
      color: pal.env,
      originX: 0.5,
    });
    pixelText(this, VIRTUAL_W / 2, VIRTUAL_H - 18, 'R restart - ESC menu - M mute - ` debug', {
      color: pal.env,
      originX: 0.5,
    }).setAlpha(0.75);

    startMusic(0);
    this.input.once('pointerdown', resumeAudio);
    this.input.keyboard?.once('keydown', resumeAudio);
    this.input.keyboard?.on('keydown-M', () => toggleMuted());

    const kb = this.input.keyboard;
    kb?.on('keydown-UP', () => this.move(-1));
    kb?.on('keydown-W', () => this.move(-1));
    kb?.on('keydown-DOWN', () => this.move(1));
    kb?.on('keydown-S', () => this.move(1));
    kb?.on('keydown-ENTER', () => this.start());
    kb?.on('keydown-SPACE', () => this.start());

    this.refresh();
  }

  /**
   * Wraps, and moves over locked rows too. Clamping to the unlocked range meant
   * a key press could do nothing at all — which is indistinguishable from the
   * key not working. `start()` still refuses to launch a locked level, so the
   * caret landing there just shows you what you have not reached yet.
   */
  override update(time: number): void {
    const pal = PALETTES[0];
    const g = this.cast;
    g.clear();
    const t = time / 1000;
    if (this.moveStart < 0) this.moveStart = time;
    const p = Math.min(1, (time - this.moveStart) / HOP_MS);
    const e = 1 - Math.pow(1 - p, 2);

    this.moves.forEach(({ def, from, to }) => {
      // Mid-hop to a new spot, growing or shrinking on the way.
      if (from !== to && p < 1) {
        const x = from.x + (to.x - from.x) * e;
        const feet = from.feetY + (to.feetY - from.feetY) * e - Math.sin(Math.PI * e) * HOP_ARC;
        const facing = Math.sign(to.x - from.x) || to.facing;
        const s0 = from === TITLE_SPOT ? 1 : SIDE_SCALE;
        const s1 = to === TITLE_SPOT ? 1 : SIDE_SCALE;
        const sc = s0 + (s1 - s0) * e;
        if (sc > 0.95) drawTufflingPreview(g, def, 'default', Math.round(x), Math.round(feet), facing, pal, t);
        else drawTufflingMini(g, def, Math.round(x), Math.round(feet), facing, pal, t, sc);
        return;
      }

      // Beside the title: facing it, hopping now and then.
      if (to === TITLE_SPOT) {
        drawTufflingPreview(g, def, t % 4 < 1 ? 'happy' : 'default', to.x, to.feetY, to.facing, pal, t);
        return;
      }

      // At the side, doing its own thing. Each keeps its own schedule.
      const k = SIDE_SPOTS.indexOf(to);
      const tt = t + k * 1.3 + 0.7;
      const n = Math.floor(tt / IDLE_PERIOD);
      const u = (tt % IDLE_PERIOD) / IDLE_PERIOD;
      const act = IDLE_ACTS[(n + k * 3) % IDLE_ACTS.length];
      let x = to.x;
      let feet = to.feetY;
      let facing = to.facing;
      if (act === 'wander') {
        // Stroll out along the ledge and back, with a little step bob.
        const dir = n % 2 ? 1 : -1;
        x = to.x + dir * 8 * Math.sin(Math.PI * u);
        facing = u < 0.5 ? dir : -dir;
        feet -= Math.floor(t * 8) % 2;
      } else if (act === 'hop' && u < 0.3) {
        feet -= Math.round(5 * Math.sin((Math.PI * u) / 0.3));
      }
      drawTufflingMini(g, def, Math.round(x), feet, facing, pal, t, SIDE_SCALE);
    });
  }

  /** A row under the levels that opens another screen, with a note on the right. */
  private addExtraRow(row: number, label: string, note: string): void {
    const pal = PALETTES[0];
    const y = ROW_TOP + row * ROW_H + 6;
    this.carets.push(pixelText(this, VIRTUAL_W / 2 - 118, y, '>', { color: pal.player, originY: 0.5 }));
    const t = pixelText(this, VIRTUAL_W / 2 - 100, y, label, { color: pal.ink, originY: 0.5 });
    pixelText(this, VIRTUAL_W / 2 + 118, y, note, { color: pal.env, originX: 1, originY: 0.5 });
    t.setInteractive(new Phaser.Geom.Rectangle(-110, -ROW_H / 2, 240, ROW_H), Phaser.Geom.Rectangle.Contains);
    t.on('pointerover', () => {
      this.selected = row;
      this.refresh();
    });
    t.on('pointerdown', () => {
      this.selected = row;
      this.start();
    });
    this.rows.push(t);
  }

  private move(d: number): void {
    const n = ROW_COUNT;
    this.selected = (this.selected + d + n) % n;
    this.refresh();
  }

  private refresh(): void {
    const pal = PALETTES[0];
    this.rows.forEach((t, i) => {
      const on = i === this.selected;
      const locked = i < LEVELS.length && i > this.unlocked;
      this.carets[i].setVisible(on);
      this.carets[i].setTint(locked ? pal.env : pal.player);
      t.setTint(locked ? pal.env : on ? pal.player : pal.ink);
    });
  }

  private start(): void {
    if (this.selected === TROPHIES_ROW) {
      this.scene.start('Trophies');
      return;
    }
    if (this.selected === TUFFLINGS_ROW) {
      this.scene.start('Tufflings');
      return;
    }
    if (this.selected > this.unlocked) return;
    this.scene.start('Game', { levelIndex: this.selected, runSeed: this.runSeed });
  }
}
