import { ChunkFamily } from './chunks';
import { SpawnKind } from './world';

/**
 * A fixed run seed, so every player gets the same levels. Learning a level and
 * comparing times only works if 'Level 3' means the same thing for everyone.
 */
export const RUN_SEED = 0x5eed1e;

export interface LevelDef {
  name: string;
  family: ChunkFamily;
  chunkCount: number;
  /** Multiplier on the 0 -> 3 difficulty ramp across the level. */
  difficultyScale: number;
  enemyMix: SpawnKind[];
  hint: string;
}

/**
 * Levels are data. The progress vector (derived from `family`) is what makes
 * horizontal, vertical and diagonal the same system.
 */
export const LEVELS: LevelDef[] = [
  {
    name: 'Ground Floor',
    family: 'h',
    chunkCount: 12,
    difficultyScale: 0.6,
    enemyMix: ['turret'],
    hint: 'Move right. Double jump with a second tap.',
  },
  {
    name: 'The Climb',
    family: 'v',
    chunkCount: 11,
    difficultyScale: 0.8,
    enemyMix: ['turret', 'flyer'],
    hint: 'Climb. Stomp a bot to refresh your double jump.',
  },
  {
    name: 'Ascent',
    family: 'd',
    chunkCount: 11,
    difficultyScale: 0.9,
    enemyMix: ['turret', 'walker', 'flyer'],
    hint: 'Up and to the right.',
  },
  {
    name: 'Long Haul',
    family: 'h',
    chunkCount: 20,
    difficultyScale: 1,
    enemyMix: ['turret', 'walker', 'flyer'],
    hint: 'Everything you have learned, for longer.',
  },
  {
    name: 'High Rise',
    family: 'v',
    chunkCount: 16,
    difficultyScale: 1.1,
    enemyMix: ['turret', 'walker', 'flyer'],
    hint: 'Bot ladders. Do not look down.',
  },
  {
    name: 'Summit',
    family: 'd',
    chunkCount: 18,
    difficultyScale: 1.25,
    enemyMix: ['turret', 'walker', 'flyer'],
    hint: 'The long diagonal.',
  },
];

// ---------------------------------------------------------------------------
// Progress, stored per-browser. Every access is guarded: private windows and
// blocked site data make localStorage throw or return nothing.
// ---------------------------------------------------------------------------

// Deliberately still the old working-title key. Renaming it would silently wipe
// every existing player's unlocked levels and best times.
const KEY = 'simple-jumper.progress.v1';

export interface Progress {
  unlocked: number; // highest unlocked level index
  best: Record<number, { time: number; deaths: number }>;
}

const DEFAULT: Progress = { unlocked: 0, best: {} };

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT, best: {} };
    const p = JSON.parse(raw) as Progress;
    return {
      unlocked: Math.max(0, Math.min(LEVELS.length - 1, p.unlocked ?? 0)),
      best: p.best ?? {},
    };
  } catch {
    return { ...DEFAULT, best: {} };
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private window or blocked storage: progress is simply not persisted */
  }
}

export function recordCompletion(levelIndex: number, time: number, deaths: number): Progress {
  const p = loadProgress();
  p.unlocked = Math.max(p.unlocked, Math.min(LEVELS.length - 1, levelIndex + 1));
  const prev = p.best[levelIndex];
  if (!prev || time < prev.time) p.best[levelIndex] = { time, deaths };
  saveProgress(p);
  return p;
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
