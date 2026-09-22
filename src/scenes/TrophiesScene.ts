import Phaser from 'phaser';
import { resumeAudio, toggleMuted } from '../audio';
import { pixelText } from '../font';
import { LEVELS } from '../levels';
import { PALETTES } from '../palette';
import { TROPHIES, drawTrophy, loadTrophies } from '../trophies';
import { blend } from '../tufflings';
import { VIRTUAL_H, VIRTUAL_W } from '../tuning';

/**
 * The trophy shelf: one spot for each level's trophy. Found ones bob and
 * twinkle; the rest are silhouettes with a hint of where to look. Purely for
 * showing off — nothing here changes how the game plays.
 *
 * Trophies are drawn at 3x on an integer-scaled graphics object, so every
 * pixel stays on the grid. Slot coordinates are in screen pixels.
 */
const SCALE = 3;
const COLS = 3;
const SLOT_W = 140;
const ROW_Y = [98, 180];

export class TrophiesScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private shelf!: Phaser.GameObjects.Graphics;
  private have = new Set<number>();

  constructor() {
    super('Trophies');
  }

  create(): void {
    const pal = PALETTES[0];
    this.cameras.main.setBackgroundColor(pal.bg);
    this.have = loadTrophies();

    pixelText(this, VIRTUAL_W / 2, 22, 'Trophies', { scale: 2, color: pal.ink, originX: 0.5 });
    pixelText(this, VIRTUAL_W / 2, 44, `${this.have.size} of ${TROPHIES.length} found`, {
      color: pal.env,
      originX: 0.5,
    });

    this.shelf = this.add.graphics();
    this.g = this.add.graphics().setScale(SCALE);

    const x0 = (VIRTUAL_W - COLS * SLOT_W) / 2;
    TROPHIES.forEach((t, i) => {
      const cx = x0 + (i % COLS) * SLOT_W + SLOT_W / 2;
      const y = ROW_Y[Math.floor(i / COLS)];
      const found = this.have.has(i);

      // A little shelf plank under each one.
      this.shelf.fillStyle(blend(pal.env, pal.bg, 0.35), 1);
      this.shelf.fillRect(cx - 34, y + 16, 68, 3);
      this.shelf.fillStyle(blend(pal.env, pal.bg, 0.6), 1);
      this.shelf.fillRect(cx - 30, y + 19, 4, 4);
      this.shelf.fillRect(cx + 26, y + 19, 4, 4);

      pixelText(this, cx, y + 28, found ? t.name : '???', { color: found ? pal.ink : pal.env, originX: 0.5 });
      pixelText(this, cx, y + 40, LEVELS[i]?.name ?? '', { color: pal.env, originX: 0.5 }).setAlpha(0.8);
    });

    pixelText(this, VIRTUAL_W / 2, VIRTUAL_H - 22, 'Each level hides one - ESC back', {
      color: pal.env,
      originX: 0.5,
    });
    const back = pixelText(this, 8, 8, '< Back', { color: pal.env });
    back.setInteractive(new Phaser.Geom.Rectangle(-4, -4, 52, 16), Phaser.Geom.Rectangle.Contains);
    back.on('pointerdown', () => this.scene.start('Menu'));

    this.input.once('pointerdown', resumeAudio);
    const kb = this.input.keyboard;
    kb?.once('keydown', resumeAudio);
    kb?.on('keydown-M', () => toggleMuted());
    kb?.on('keydown-ESC', () => this.scene.start('Menu'));
    kb?.on('keydown-BACKSPACE', () => this.scene.start('Menu'));
    kb?.on('keydown-ENTER', () => this.scene.start('Menu'));
  }

  override update(time: number): void {
    const pal = PALETTES[0];
    const t = time / 1000;
    const g = this.g;
    g.clear();
    const x0 = (VIRTUAL_W - COLS * SLOT_W) / 2;
    TROPHIES.forEach((tr, i) => {
      // Native (unscaled) coordinates: screen pixels divided by SCALE.
      const cx = (x0 + (i % COLS) * SLOT_W + SLOT_W / 2) / SCALE;
      const cy = (ROW_Y[Math.floor(i / COLS)] + 2) / SCALE;
      if (this.have.has(i)) {
        const bob = Math.round(Math.sin(t * 2.4 + i) * 1);
        drawTrophy(g, tr, cx, cy + bob);
        // A twinkle that wanders round the ones you have.
        const k = Math.floor(t * 2 + i) % 4;
        const [sx, sy] = [[-6, -4], [5, -5], [6, 3], [-5, 4]][k];
        g.fillStyle(0xffffff, 1);
        g.fillRect(Math.round(cx + sx), Math.round(cy + bob + sy), 1, 1);
      } else {
        drawTrophy(g, tr, cx, cy, { silhouette: blend(pal.env, pal.bg, 0.55) });
      }
    });
  }
}
