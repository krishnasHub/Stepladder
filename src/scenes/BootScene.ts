import Phaser from 'phaser';
import { createPixelFont } from '../font';
import { TUFFLING_IDS } from '../abilities';
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
    const params = new URLSearchParams(window.location.search);
    const playtest = params.has('playtest') ? getPlaytest() : null;
    if (playtest) {
      // `as` picks the Tuffling for this playtest only (the editor's Play as).
      const as = params.get('as');
      const playAs = TUFFLING_IDS.find((t) => t === as);
      this.scene.start('Game', { custom: playtest, runSeed: RUN_SEED, playAs });
      return;
    }
    this.scene.start('Menu', { runSeed: RUN_SEED });
  }
}
