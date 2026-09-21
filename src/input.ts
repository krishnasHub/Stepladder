import Phaser from 'phaser';
import { VIRTUAL_H, VIRTUAL_W } from './tuning';

/**
 * One input surface for keyboard and touch. Touch is designed in from the
 * start rather than retrofitted, so the mobile build is a packaging step and
 * not a rewrite.
 *
 * Hit areas are deliberately much larger than the drawn buttons.
 */

export interface TouchZone {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BTN_R = 19; // drawn radius
const PAD = 14;

export const TOUCH_BUTTONS = {
  left: { cx: PAD + BTN_R, cy: VIRTUAL_H - PAD - BTN_R },
  right: { cx: PAD + BTN_R * 3 + 10, cy: VIRTUAL_H - PAD - BTN_R },
  jump: { cx: VIRTUAL_W - PAD - BTN_R, cy: VIRTUAL_H - PAD - BTN_R },
};

/** Generous invisible hit areas, extending well past the visible buttons. */
const HIT: Record<'left' | 'right' | 'jump', TouchZone> = {
  left: { x: 0, y: VIRTUAL_H * 0.4, w: 62, h: VIRTUAL_H * 0.6 },
  right: { x: 62, y: VIRTUAL_H * 0.4, w: 66, h: VIRTUAL_H * 0.6 },
  jump: { x: VIRTUAL_W * 0.58, y: VIRTUAL_H * 0.25, w: VIRTUAL_W * 0.42, h: VIRTUAL_H * 0.75 },
};

function inZone(z: TouchZone, x: number, y: number): boolean {
  return x >= z.x && x < z.x + z.w && y >= z.y && y < z.y + z.h;
}

export class GameInput {
  left = false;
  right = false;
  jumpHeld = false;
  /** Set on the rising edge of jump; the player controller consumes it. */
  jumpQueued = false;
  restartPressed = false;
  menuPressed = false;

  /** True once the player has touched the screen — reveals the touch buttons. */
  touchActive = false;

  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private prevJump = false;
  private prevRestart = false;
  private prevMenu = false;

  constructor(private scene: Phaser.Scene) {
    const kb = scene.input.keyboard;
    if (kb) {
      this.keys = kb.addKeys(
        'LEFT,RIGHT,A,D,SPACE,UP,W,R,ESC',
      ) as Record<string, Phaser.Input.Keyboard.Key>;
      // Stop the browser scrolling the page on arrow keys / space.
      kb.addCapture(['LEFT', 'RIGHT', 'UP', 'SPACE']);
    }
    // Three simultaneous touches: left/right + jump, plus a spare.
    scene.input.addPointer(2);
  }

  /** Poll once per rendered frame, before the fixed-step simulation runs. */
  poll(): void {
    const k = this.keys;
    const down = (key?: Phaser.Input.Keyboard.Key) => !!key && key.isDown;

    let left = down(k.LEFT) || down(k.A);
    let right = down(k.RIGHT) || down(k.D);
    let jump = down(k.SPACE) || down(k.UP) || down(k.W);

    // Touch: union of every active pointer.
    let tLeft = false;
    let tRight = false;
    let tJump = false;
    for (const p of this.scene.input.manager.pointers) {
      if (!p.isDown) continue;
      this.touchActive = this.touchActive || p.wasTouch;
      if (inZone(HIT.left, p.x, p.y)) tLeft = true;
      else if (inZone(HIT.right, p.x, p.y)) tRight = true;
      else if (inZone(HIT.jump, p.x, p.y)) tJump = true;
    }

    this.left = left || tLeft;
    this.right = right || tRight;
    this.jumpHeld = jump || tJump;

    // Rising edge -> queue a jump. The buffer window lives in the player.
    if (this.jumpHeld && !this.prevJump) this.jumpQueued = true;
    this.prevJump = this.jumpHeld;

    const restart = down(k.R);
    this.restartPressed = restart && !this.prevRestart;
    this.prevRestart = restart;

    const menu = down(k.ESC);
    this.menuPressed = menu && !this.prevMenu;
    this.prevMenu = menu;
  }

  consumeJump(): boolean {
    const q = this.jumpQueued;
    this.jumpQueued = false;
    return q;
  }

  reset(): void {
    this.left = this.right = this.jumpHeld = false;
    this.jumpQueued = false;
    this.prevJump = true; // require a fresh press after a reset
  }
}
