import Phaser from 'phaser';
import { createPixelFont } from '../font';
import { RUN_SEED } from '../levels';

/** Builds the pixel font texture, then hands off to the menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    createPixelFont(this);
    this.scene.start('Menu', { runSeed: RUN_SEED });
  }
}
