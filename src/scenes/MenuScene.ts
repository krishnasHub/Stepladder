import Phaser from 'phaser';
import { resumeAudio, startMusic, toggleMuted } from '../audio';
import { pixelText } from '../font';
import { LEVELS, RUN_SEED, formatTime, loadProgress } from '../levels';
import { PALETTES } from '../palette';
import { VIRTUAL_H, VIRTUAL_W } from '../tuning';

const ROW_H = 16;
const ROW_TOP = 96;

export class MenuScene extends Phaser.Scene {
  private selected = 0;
  private rows: Phaser.GameObjects.BitmapText[] = [];
  private carets: Phaser.GameObjects.BitmapText[] = [];
  private unlocked = 0;
  private runSeed = RUN_SEED;

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
  private move(d: number): void {
    const n = LEVELS.length;
    this.selected = (this.selected + d + n) % n;
    this.refresh();
  }

  private refresh(): void {
    const pal = PALETTES[0];
    this.rows.forEach((t, i) => {
      const on = i === this.selected;
      const locked = i > this.unlocked;
      this.carets[i].setVisible(on);
      this.carets[i].setTint(locked ? pal.env : pal.player);
      t.setTint(locked ? pal.env : on ? pal.player : pal.ink);
    });
  }

  private start(): void {
    if (this.selected > this.unlocked) return;
    this.scene.start('Game', { levelIndex: this.selected, runSeed: this.runSeed });
  }
}
