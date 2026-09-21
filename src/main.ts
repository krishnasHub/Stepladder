import Phaser from 'phaser';
import * as audio from './audio';
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

// Dev handles for debugging from the console.
//
// `__audio` matters more than it looks: importing './audio' from the console
// gives you a SECOND copy of the module, because Vite serves the app's copy
// with an HMR cache-busting query. Reading mute or music state off that copy
// reports on a module nothing is actually using. This is the real one.
if (import.meta.env.DEV) {
  const w = window as unknown as { __game: Phaser.Game; __audio: typeof audio };
  w.__game = game;
  w.__audio = audio;
}
