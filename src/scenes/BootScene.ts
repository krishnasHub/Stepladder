import Phaser from 'phaser';
import { createPixelFont } from '../font';
import { getPlaytest } from '../customLevels';
import { RUN_SEED } from '../levels';

/**
 * Builds the pixel font texture, then hands off to the menu — or, when opened
 * from the editor's Play button (`?playtest`), straight into that level.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    createPixelFont(this);
    const playtest = new URLSearchParams(window.location.search).has('playtest') ? getPlaytest() : null;
    if (playtest) {
      this.scene.start('Game', { custom: playtest, runSeed: RUN_SEED });
      return;
    }
    this.scene.start('Menu', { runSeed: RUN_SEED });
  }
}
