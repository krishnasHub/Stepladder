import Phaser from 'phaser';
import { STAT_BARS } from '../abilities';
import { playDoubleJump, resumeAudio, toggleMuted } from '../audio';
import { pixelText } from '../font';
import { PALETTES } from '../palette';
import {
  TUFFLINGS,
  PREVIEW_MOODS,
  TufflingId,
  drawTufflingPreview,
  loadTufflingId,
  saveTufflingId,
} from '../tufflings';
import { VIRTUAL_H, VIRTUAL_W } from '../tuning';

/**
 * Previews are drawn at 3x on a graphics object scaled by an integer, so every
 * pixel stays on the grid. Coordinates below are in that native, unscaled space.
 */
const SCALE = 3;
const SLOT_X = [30, 63, 97, 130];
const FEET_Y = 46;
/** Top of the selection panel: clear of the subtitle, which ends at y 51 on screen. */
const PANEL_TOP = 20;
/**
 * The stat bars under the tagline: label, then five pips. Laid out left to
 * right from STATS_X, in screen pixels.
 */
const STATS_Y = 204;
const STATS_X = 122;
const PIP = 5;
const PIP_GAP = 2;
const STATS: ReadonlyArray<{ key: 'jump' | 'speed' | 'climb'; label: string; width: number }> = [
  { key: 'jump', label: 'Jump', width: 63 },
  { key: 'speed', label: 'Speed', width: 69 },
  { key: 'climb', label: 'Climb', width: 69 },
];
const STATS_GAP = 18;
/** Every tuffling acts out the same mood together, so they compare side by side. */
const MOOD_SECONDS = 2.2;

export class TufflingsScene extends Phaser.Scene {
  private selected = 0;
  private equipped: TufflingId = 'mochi';
  private g!: Phaser.GameObjects.Graphics;
  private names: Phaser.GameObjects.BitmapText[] = [];
  private inUse: Phaser.GameObjects.BitmapText[] = [];
  private txtTagline!: Phaser.GameObjects.BitmapText;
  private txtMood!: Phaser.GameObjects.BitmapText;
  private gStats!: Phaser.GameObjects.Graphics;
  private lastMood = -1;

  constructor() {
    super('Tufflings');
  }

  create(): void {
    const pal = PALETTES[0];
    this.cameras.main.setBackgroundColor(pal.bg);

    // The scene object is reused across visits; see MenuScene.
    this.names.length = 0;
    this.inUse.length = 0;
    this.lastMood = -1;

    this.equipped = loadTufflingId();
    this.selected = Math.max(0, TUFFLINGS.findIndex((p) => p.id === this.equipped));

    pixelText(this, VIRTUAL_W / 2, 22, 'Tufflings', { scale: 2, color: pal.ink, originX: 0.5 });
    pixelText(this, VIRTUAL_W / 2, 44, 'Pick your little stomper', { color: pal.env, originX: 0.5 });

    this.g = this.add.graphics().setScale(SCALE);

    TUFFLINGS.forEach((p, i) => {
      const x = SLOT_X[i] * SCALE;
      this.names.push(pixelText(this, x, 154, p.name, { originX: 0.5 }));
      this.inUse.push(pixelText(this, x, 166, 'In use', { color: pal.env, originX: 0.5 }));

      // A generous hit area around each tuffling, for mouse and touch.
      const zone = this.add.zone(x, 110, 96, 120).setInteractive();
      zone.on('pointerover', () => {
        this.selected = i;
        this.refresh();
      });
      zone.on('pointerdown', () => {
        this.selected = i;
        this.pick();
      });
    });

    this.txtTagline = pixelText(this, VIRTUAL_W / 2, 186, '', { color: pal.ink, originX: 0.5 });
    this.txtMood = pixelText(this, VIRTUAL_W / 2, 224, '', { color: pal.env, originX: 0.5 });

    // Stat labels; the pips are drawn in refresh() for whoever is selected.
    this.gStats = this.add.graphics();
    let sx = STATS_X;
    for (const st of STATS) {
      pixelText(this, sx, STATS_Y, st.label, { color: pal.env });
      sx += st.width + STATS_GAP;
    }

    pixelText(this, VIRTUAL_W / 2, VIRTUAL_H - 22, 'Left Right choose - Enter pick - ESC back', {
      color: pal.env,
      originX: 0.5,
    });

    const back = pixelText(this, 8, 8, '< Back', { color: pal.env });
    back.setInteractive(new Phaser.Geom.Rectangle(-4, -4, 52, 16), Phaser.Geom.Rectangle.Contains);
    back.on('pointerdown', () => this.back());

    this.input.once('pointerdown', resumeAudio);
    const kb = this.input.keyboard;
    kb?.once('keydown', resumeAudio);
    kb?.on('keydown-M', () => toggleMuted());
    kb?.on('keydown-LEFT', () => this.move(-1));
    kb?.on('keydown-A', () => this.move(-1));
    kb?.on('keydown-RIGHT', () => this.move(1));
    kb?.on('keydown-D', () => this.move(1));
    kb?.on('keydown-ENTER', () => this.pick());
    kb?.on('keydown-SPACE', () => this.pick());
    kb?.on('keydown-ESC', () => this.back());
    kb?.on('keydown-BACKSPACE', () => this.back());

    this.refresh();
  }

  override update(time: number): void {
    const pal = PALETTES[0];
    const t = time / 1000;
    const moodIndex = Math.floor(t / MOOD_SECONDS) % PREVIEW_MOODS.length;
    const { mood, label } = PREVIEW_MOODS[moodIndex];
    // Restart each mood's own little loop as it comes up.
    const moodT = (t % MOOD_SECONDS) + 0.3;

    if (moodIndex !== this.lastMood) {
      this.lastMood = moodIndex;
      this.txtMood.setText(`Feeling: ${label}`.toUpperCase());
    }

    const g = this.g;
    g.clear();
    TUFFLINGS.forEach((p, i) => {
      const cx = SLOT_X[i];
      if (i === this.selected) {
        // A soft spotlight behind the one under the cursor.
        g.fillStyle(pal.bgAccent, 1);
        g.fillRect(cx - 15, PANEL_TOP, 30, FEET_Y - PANEL_TOP);
      }
      g.fillStyle(i === this.selected ? pal.env : pal.bgAccent, 1);
      g.fillRect(cx - 11, FEET_Y, 22, 2);
      drawTufflingPreview(g, p, mood, cx, FEET_Y, 1, pal, moodT + i * 0.15);
    });
  }

  private move(d: number): void {
    const n = TUFFLINGS.length;
    this.selected = (this.selected + d + n) % n;
    this.refresh();
  }

  private pick(): void {
    const p = TUFFLINGS[this.selected];
    if (p.id === this.equipped) return;
    this.equipped = p.id;
    saveTufflingId(p.id);
    playDoubleJump();
    this.refresh();
  }

  private back(): void {
    this.scene.start('Menu');
  }

  private refresh(): void {
    const pal = PALETTES[0];
    TUFFLINGS.forEach((p, i) => {
      this.names[i].setTint(i === this.selected ? pal.player : pal.ink);
      this.inUse[i].setVisible(p.id === this.equipped);
    });
    this.txtTagline.setText(TUFFLINGS[this.selected].tagline.toUpperCase());

    const bars = STAT_BARS[TUFFLINGS[this.selected].id];
    const g = this.gStats;
    g.clear();
    let sx = STATS_X;
    for (const st of STATS) {
      const px0 = sx + st.width - 5 * (PIP + PIP_GAP) + PIP_GAP;
      for (let i = 0; i < 5; i++) {
        g.fillStyle(i < bars[st.key] ? pal.player : pal.bgAccent, 1);
        g.fillRect(px0 + i * (PIP + PIP_GAP), STATS_Y + 1, PIP, PIP);
      }
      sx += st.width + STATS_GAP;
    }
  }
}
