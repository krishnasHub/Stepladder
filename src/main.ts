import Phaser from 'phaser';
import { validateChunks } from './chunks';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { MenuScene } from './scenes/MenuScene';
import { VIRTUAL_H, VIRTUAL_W } from './tuning';

// Surface authoring typos loudly rather than shipping a broken chunk.
const issues = validateChunks();
if (issues.length) {
  console.error('[chunks] validation failed:');
  for (const i of issues) console.error(`  ${i.id}: ${i.problem}`);
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIRTUAL_W,
  height: VIRTUAL_H,
  pixelArt: true,
  roundPixels: true,
  backgroundColor: '#20222e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  fps: { target: 60 },
  scene: [BootScene, MenuScene, GameScene],
});

// Dev handle for debugging from the console. Stripped by nothing, but harmless.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
