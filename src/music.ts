import { Rng } from './rng';

/**
 * Generative ambient soundtrack — one theme for the title, one per level.
 *
 * Designed to be ignorable. The goal is music you can work or play over for
 * twenty minutes without it ever pulling your attention, which drove every
 * choice here:
 *
 *  - **No repeating melody.** A hook is a thing attention catches on, and a
 *    short loop becomes maddening once you notice the seam. Everything is
 *    generated on the fly from a seeded stream, so it never repeats exactly.
 *  - **No beat.** Rhythm entrains you to it. There is no percussion and no
 *    grid; notes arrive at irregular intervals.
 *  - **Slow envelopes.** Multi-second attacks and releases mean nothing ever
 *    "starts" sharply enough to be an event.
 *  - **Flat dynamics.** Every voice sits in a narrow volume band. Surprises in
 *    loudness are the fastest way to break concentration.
 *  - **Pentatonic and modal scales.** No semitone clashes are possible, so
 *    randomly chosen notes cannot land somewhere that demands resolution.
 *  - **Low-passed timbres.** High harmonics are what make a sound feel urgent.
 *
 * Two voices: a slow pad chord that crossfades every dozen seconds or so, and
 * occasional single chimes at irregular spacing.
 */

export interface MusicTheme {
  name: string;
  /** Semitones from C. */
  root: number;
  /** Interval pattern. All are pentatonic or modal — nothing can clash. */
  scale: number[];
  padWave: OscillatorType;
  chimeWave: OscillatorType;
  /** Seconds a pad chord is held before the next one fades in over it. */
  padSeconds: number;
  /** Seconds between chimes, picked randomly in this range. */
  chimeGap: [number, number];
  /** Lowpass cutoff in Hz. Lower is softer and further away. */
  brightness: number;
  /** Octave offset for the chime voice. */
  chimeOctave: number;
}

/**
 * Index 0 is the title screen; 1..6 are the levels. Each shifts root, mode and
 * timbre so a level sounds like its own place, while staying the same kind of
 * music throughout — switching between levels should never feel like a jolt.
 */
export const THEMES: MusicTheme[] = [
  {
    name: 'title',
    root: 0, // C major pentatonic — open and neutral
    scale: [0, 2, 4, 7, 9],
    padWave: 'sine',
    chimeWave: 'sine',
    padSeconds: 14,
    chimeGap: [7, 15],
    brightness: 1400,
    chimeOctave: 12,
  },
  {
    name: 'ground floor',
    root: 5, // F Lydian-ish — warm, grounded
    scale: [0, 2, 4, 7, 9, 11],
    padWave: 'sine',
    chimeWave: 'triangle',
    padSeconds: 13,
    chimeGap: [6, 13],
    brightness: 1500,
    chimeOctave: 12,
  },
  {
    name: 'the climb',
    root: 9, // A minor pentatonic — airier, a little wistful
    scale: [0, 3, 5, 7, 10],
    padWave: 'sine',
    chimeWave: 'sine',
    padSeconds: 15,
    chimeGap: [8, 16],
    brightness: 1300,
    chimeOctave: 24,
  },
  {
    name: 'ascent',
    root: 2, // D Dorian — gently hopeful
    scale: [0, 2, 3, 5, 7, 9],
    padWave: 'triangle',
    chimeWave: 'sine',
    padSeconds: 12,
    chimeGap: [6, 12],
    brightness: 1250,
    chimeOctave: 12,
  },
  {
    name: 'long haul',
    root: 7, // G major pentatonic — the slowest, for the longest level
    scale: [0, 2, 4, 7, 9],
    padWave: 'sine',
    chimeWave: 'triangle',
    padSeconds: 18,
    chimeGap: [9, 18],
    brightness: 1100,
    chimeOctave: 12,
  },
  {
    name: 'high rise',
    root: 4, // E minor pentatonic — thinner air
    scale: [0, 3, 5, 7, 10],
    padWave: 'sine',
    chimeWave: 'sine',
    padSeconds: 16,
    chimeGap: [7, 14],
    brightness: 1600,
    chimeOctave: 24,
  },
  {
    name: 'summit',
    root: 10, // Bb Lydian — widest and brightest
    scale: [0, 2, 4, 6, 7, 9],
    padWave: 'triangle',
    chimeWave: 'sine',
    padSeconds: 17,
    chimeGap: [8, 17],
    brightness: 1500,
    chimeOctave: 24,
  },
];

// Sound effects peak around 0.16. Music sits well under that on purpose, so
// effects always cut through and the score never competes with the game.
const PAD_VOLUME = 0.022;
const CHIME_VOLUME = 0.03;
const TICK_MS = 250;
const LOOKAHEAD = 1.5;

export interface MusicDeps {
  ctx: AudioContext;
  out: AudioNode;
}

export class Music {
  private timer: ReturnType<typeof setInterval> | null = null;
  private theme = THEMES[0];
  private rng = new Rng(0x5eeda11);
  private nextPad = 0;
  private nextChime = 0;
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

  /**
   * Switch themes without a seam: the pad already sounding is left to fade out
   * on its own long release while the next theme's first chord fades in under
   * it. A hard cut between levels would be the most attention-grabbing moment
   * in the whole soundtrack.
   */
  setTheme(index: number): void {
    const i = ((index % THEMES.length) + THEMES.length) % THEMES.length;
    const next = THEMES[i];
    if (next === this.theme) return;
    this.theme = next;
    if (this.filter && this.deps) {
      this.filter.frequency.setTargetAtTime(next.brightness, this.deps.ctx.currentTime, 2);
    }
    // Bring the next chord forward a little so the change is audible within a
    // few seconds rather than after a full pad length.
    if (this.deps) this.nextPad = Math.min(this.nextPad, this.deps.ctx.currentTime + 2);
  }

  start(): void {
    if (this.timer || !this.deps) return;
    const now = this.deps.ctx.currentTime;
    this.nextPad = Math.max(this.nextPad, now + 0.2);
    this.nextChime = Math.max(this.nextChime, now + this.rng.float(2, 5));
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const d = this.deps;
    if (!d) return;
    const now = d.ctx.currentTime;

    while (this.nextPad < now + LOOKAHEAD) {
      this.pad(Math.max(this.nextPad, now));
      this.nextPad += this.theme.padSeconds;
    }
    while (this.nextChime < now + LOOKAHEAD) {
      this.chime(Math.max(this.nextChime, now));
      const [lo, hi] = this.theme.chimeGap;
      this.nextChime += this.rng.float(lo, hi);
    }
  }

  /** A slow chord, three notes stacked out of the scale, well below the melody. */
  private pad(time: number): void {
    const t = this.theme;
    const base = this.rng.int(0, t.scale.length - 1);
    const degrees = [base, base + 2, base + 4];
    const hold = t.padSeconds;

    for (let i = 0; i < degrees.length; i++) {
      const deg = degrees[i];
      const octave = Math.floor(deg / t.scale.length);
      const semi = t.root + t.scale[deg % t.scale.length] + octave * 12 - 24;
      // Attack is capped rather than a flat fraction of the hold: scaling it
      // with padSeconds made the slower themes spend their whole life ramping
      // and land measurably quieter than the faster ones, which is exactly the
      // kind of level-to-level loudness jump this music must not have.
      const attack = Math.min(4, hold * 0.35);
      // A touch of detune keeps the chord from sounding sterile.
      this.voice(time, semi, hold, PAD_VOLUME, t.padWave, attack, i === 0 ? 0 : 3);
    }
  }

  /** A single note, high and soft, at irregular intervals. */
  private chime(time: number): void {
    const t = this.theme;
    const deg = this.rng.int(0, t.scale.length - 1);
    const semi = t.root + t.scale[deg] + t.chimeOctave - 12;
    this.voice(time, semi, 4.5, CHIME_VOLUME, t.chimeWave, 0.6, 0);
  }

  private voice(
    time: number,
    semitone: number,
    hold: number,
    vol: number,
    wave: OscillatorType,
    attack: number,
    detuneCents: number,
  ): void {
    const d = this.deps;
    if (!d || !this.bus) return;

    const osc = d.ctx.createOscillator();
    osc.type = wave;
    osc.frequency.value = 261.63 * Math.pow(2, semitone / 12);
    osc.detune.value = detuneCents;

    const g = d.ctx.createGain();
    // Long attack and an equally long release: nothing here ever "starts".
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vol, time + attack);
    g.gain.setValueAtTime(vol, time + hold * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, time + hold);

    osc.connect(g);
    g.connect(this.bus);
    osc.start(time);
    osc.stop(time + hold + 0.1);
  }
}
