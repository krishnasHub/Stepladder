import { Rng } from './rng';

/**
 * A light, chirpy music-box soundtrack — one theme for the title, one per level.
 *
 * This replaced an ambient-pad version that came out sounding creepy, which is
 * worth recording because the failure was systematic rather than bad luck. Slow
 * sustained low drones, long attacks, minor modes, sparse irregular chimes and
 * heavy low-pass filtering are, between them, an almost exact recipe for horror
 * ambience. Every one of those choices was made in the name of being
 * unobtrusive, and together they produced dread.
 *
 * So this one inverts all of it:
 *
 *  - **Plucky, not sustained.** Fast attack, short decay — notes land and let
 *    go, like a music box. Nothing drones.
 *  - **Major only.** Every theme is major pentatonic. Minor pentatonic was
 *    doing a lot of the creepiness, and a major pentatonic still cannot clash.
 *  - **A real pulse.** A steady bass and offbeat chord stabs give it bounce.
 *    Rhythmic ambiguity was reading as unease.
 *  - **Up an octave.** The melody sits high and bright rather than sitting
 *    below the player in the low register.
 *  - **Open the filter.** Brightness is what makes a sound cheerful; darkness
 *    is what made it ominous.
 *  - **An actual tune.** A repeating phrase is fine here. Catchy beats eerie.
 */

export interface MusicTheme {
  name: string;
  /** Semitones from C. */
  root: number;
  bpm: number;
  melodyWave: OscillatorType;
  bassWave: OscillatorType;
  /** Lowpass cutoff in Hz. High, because bright is the whole point. */
  brightness: number;
  /** 16 steps of scale degrees; -1 is a rest. Degrees past 4 wrap up octaves. */
  melody: number[];
}

/** Major pentatonic. Cheerful, and no interval in it can sound wrong. */
const SCALE = [0, 2, 4, 7, 9];

/**
 * Index 0 is the title; 1..6 are the levels. They share a shape so moving
 * between them is never a jolt, but each has its own key and phrase.
 */
export const THEMES: MusicTheme[] = [
  {
    name: 'title',
    root: 0, // C
    bpm: 108,
    melodyWave: 'triangle',
    bassWave: 'triangle',
    brightness: 4200,
    melody: [0, 2, 4, -1, 7, 4, 2, -1, 4, 5, 7, -1, 4, 2, 0, -1],
  },
  {
    name: 'ground floor',
    root: 5, // F
    bpm: 112,
    melodyWave: 'triangle',
    bassWave: 'triangle',
    brightness: 4400,
    melody: [4, 4, -1, 2, 4, 7, -1, 4, 2, 0, -1, 2, 4, -1, 2, -1],
  },
  {
    name: 'the climb',
    root: 7, // G
    bpm: 116,
    melodyWave: 'square',
    bassWave: 'triangle',
    brightness: 3800,
    melody: [7, 5, 4, -1, 2, 4, 5, -1, 7, 9, 7, -1, 5, 4, 2, -1],
  },
  {
    name: 'ascent',
    root: 2, // D
    bpm: 114,
    melodyWave: 'triangle',
    bassWave: 'triangle',
    brightness: 4600,
    melody: [0, 4, 7, -1, 9, 7, 4, -1, 2, 5, 9, -1, 7, 4, 2, -1],
  },
  {
    name: 'long haul',
    root: 10, // Bb
    bpm: 104,
    melodyWave: 'triangle',
    bassWave: 'triangle',
    brightness: 4000,
    melody: [2, 4, -1, 7, 4, -1, 2, 0, 2, 4, 7, -1, 9, 7, 4, -1],
  },
  {
    name: 'high rise',
    root: 4, // E
    bpm: 120,
    melodyWave: 'square',
    bassWave: 'triangle',
    brightness: 4800,
    melody: [9, 7, -1, 4, 7, 9, -1, 11, 9, 7, 4, -1, 2, 4, 7, -1],
  },
  {
    name: 'summit',
    root: 9, // A
    bpm: 118,
    melodyWave: 'triangle',
    bassWave: 'triangle',
    brightness: 5000,
    melody: [0, 2, 4, 7, -1, 9, 7, 4, 2, 4, -1, 7, 9, -1, 7, -1],
  },
];

// Sound effects peak around 0.16. Music stays under that so effects cut through.
const MELODY_VOLUME = 0.05;
const BASS_VOLUME = 0.045;
const STAB_VOLUME = 0.022;

const TICK_MS = 60;
const LOOKAHEAD = 0.4;

export interface MusicDeps {
  ctx: AudioContext;
  out: AudioNode;
}

export class Music {
  private timer: ReturnType<typeof setInterval> | null = null;
  private theme = THEMES[0];
  private rng = new Rng(0x5eeda11);
  private step = 0;
  private nextStepTime = 0;
  private bus: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private deps: MusicDeps | null = null;

  get running(): boolean {
    return this.timer !== null;
  }

  get themeName(): string {
    return this.theme.name;
  }

  attach(deps: MusicDeps): void {
    if (this.deps) return;
    this.deps = deps;
    this.bus = deps.ctx.createGain();
    this.bus.gain.value = 1;
    this.filter = deps.ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = this.theme.brightness;
    this.bus.connect(this.filter);
    this.filter.connect(deps.out);
  }

  /** Switch themes on the next phrase boundary, so the tune never cuts mid-bar. */
  setTheme(index: number): void {
    const i = ((index % THEMES.length) + THEMES.length) % THEMES.length;
    const next = THEMES[i];
    if (next === this.theme) return;
    this.theme = next;
    this.step = 0;
    if (this.filter && this.deps) {
      this.filter.frequency.setTargetAtTime(next.brightness, this.deps.ctx.currentTime, 0.4);
    }
  }

  start(): void {
    if (this.timer || !this.deps) return;
    this.nextStepTime = Math.max(this.nextStepTime, this.deps.ctx.currentTime + 0.12);
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private stepSeconds(): number {
    return 60 / this.theme.bpm / 2; // eighth notes
  }

  private tick(): void {
    const d = this.deps;
    if (!d) return;
    const now = d.ctx.currentTime;
    while (this.nextStepTime < now + LOOKAHEAD) {
      this.playStep(this.step, Math.max(this.nextStepTime, now));
      this.nextStepTime += this.stepSeconds();
      this.step++;
    }
  }

  /** Semitone for a scale degree, wrapping up an octave every five degrees. */
  private semitone(degree: number): number {
    const octave = Math.floor(degree / SCALE.length);
    return this.theme.root + SCALE[degree % SCALE.length] + octave * 12;
  }

  private playStep(i: number, time: number): void {
    const t = this.theme;
    const s = i % 16;

    // Bass on the downbeats: root, then the fifth halfway through.
    if (s === 0 || s === 8) {
      this.note(time, this.semitone(s === 0 ? 0 : 3) - 24, 0.34, BASS_VOLUME, t.bassWave);
    }

    // Offbeat chord stabs — this is most of the bounce.
    if (s % 4 === 2) {
      const base = s < 8 ? 0 : 2;
      this.note(time, this.semitone(base) - 12, 0.16, STAB_VOLUME, 'triangle');
      this.note(time, this.semitone(base + 2) - 12, 0.16, STAB_VOLUME, 'triangle');
    }

    const deg = t.melody[s];
    if (deg < 0) return;
    // Small variation so the loop does not sit perfectly still: now and then a
    // note pops an octave. The phrase still reads as the same tune.
    const lift = this.rng.bool(0.12) ? 12 : 0;
    this.note(time, this.semitone(deg) + 12 + lift, 0.24, MELODY_VOLUME, t.melodyWave);
  }

  /** Plucked: near-instant attack, quick decay. Nothing here sustains. */
  private note(
    time: number,
    semitone: number,
    dur: number,
    vol: number,
    wave: OscillatorType,
  ): void {
    const d = this.deps;
    if (!d || !this.bus) return;

    const osc = d.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = 261.63 * Math.pow(2, semitone / 12);

    // A square carries far more harmonic energy than a triangle, so at equal
    // amplitude it reads both louder and harsher. Trim it so the square themes
    // sit at the same perceived level as the rest.
    const level = wave === 'square' ? vol * 0.72 : vol;

    const g = d.ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(level, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);

    osc.connect(g);
    g.connect(this.bus);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }
}
