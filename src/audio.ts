import { Rng } from './rng';

/**
 * Tiny synthesised sound. No audio files — the single-file build stays a single
 * file, and there is nothing to load or fail to load.
 *
 * Browsers refuse to start audio outside a user gesture, so the context is
 * created lazily and `resumeAudio()` must be called from a real input event.
 * Everything here degrades to silence rather than throwing: a blocked or
 * missing AudioContext must never take the game down with it.
 */

const MUTE_KEY = 'stepladder.muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let failed = false;
let muted = loadMuted();

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isMuted(): boolean {
  return muted;
}

export function toggleMuted(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* private window: the preference just will not persist */
  }
  if (master) master.gain.value = muted ? 0 : 1;
  return muted;
}

function ensure(): AudioContext | null {
  if (ctx || failed) return ctx;
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) {
      failed = true;
      return null;
    }
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);

    // A short noise burst for the front of the death sound. Seeded, because
    // `Math.random()` is banned across this codebase.
    const rng = new Rng(0xd1ced1ce);
    const len = Math.floor(ctx.sampleRate * 0.06);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (rng.next() * 2 - 1) * (1 - i / len);
  } catch {
    failed = true;
    ctx = null;
  }
  return ctx;
}

/** Call from a real user gesture, or the browser will keep audio suspended. */
export function resumeAudio(): void {
  const c = ensure();
  if (c && c.state === 'suspended') void c.resume();
}

/**
 * The death sound: a soft square gliding down a couple of octaves with a puff
 * on the front. Deflating, not punishing — you are about to retry in half a
 * second, so it should not scold.
 */
export function playDeath(): void {
  const c = ensure();
  if (!c || !master || muted) return;
  try {
    const t = c.currentTime;

    const osc = c.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(640, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.28);

    // Roll the top off the square so it stays soft, in keeping with the palette.
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.3);

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);

    osc.connect(lp);
    lp.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + 0.36);

    if (noiseBuf) {
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      const ng = c.createGain();
      ng.gain.setValueAtTime(0.1, t);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      src.connect(ng);
      ng.connect(master);
      src.start(t);
    }
  } catch {
    /* never let a sound take the game down */
  }
}
