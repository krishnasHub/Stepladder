/**
 * Hand-built levels, made in the editor (editor.html).
 *
 * A custom level is one ASCII grid, using the same characters as the chunk
 * library but a subset of them:
 *
 *   .  empty     #  platform     ^  spike
 *   T  turret    E  start        X  exit portal
 *
 * They live in this browser's localStorage for now. Nothing here imports
 * Phaser, so the editor page can use it without loading the game.
 */

import { PALETTES } from './palette';

export interface CustomLevel {
  id: string;
  name: string;
  /** Index into PALETTES. */
  palette: number;
  rows: string[];
  updatedAt: number;
}

export const TILES = {
  empty: '.',
  solid: '#',
  spike: '^',
  turret: 'T',
  start: 'E',
  portal: 'X',
} as const;

export type TileChar = (typeof TILES)[keyof typeof TILES];

export const MIN_W = 20;
export const MAX_W = 400;
export const MIN_H = 12;
export const MAX_H = 120;

/** A fresh level: flat ground, the start on the left, the portal on the right. */
export function newLevel(name = 'Untitled', w = 60, h = 17): CustomLevel {
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      if (y >= h - 2) row += TILES.solid;
      else if (y === h - 3 && x === 2) row += TILES.start;
      else if (y === h - 3 && x === w - 3) row += TILES.portal;
      else row += TILES.empty;
    }
    rows.push(row);
  }
  return { id: makeId(), name, palette: 0, rows, updatedAt: Date.now() };
}

let idCounter = 0;

/** Unique within one browser's library: time plus a counter, no randomness. */
export function makeId(): string {
  idCounter++;
  return `lvl-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/** Resize, keeping the level anchored to its bottom-left corner. */
export function resizeLevel(level: CustomLevel, w: number, h: number): CustomLevel {
  w = Math.max(MIN_W, Math.min(MAX_W, Math.round(w)));
  h = Math.max(MIN_H, Math.min(MAX_H, Math.round(h)));
  const oldH = level.rows.length;
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    const src = level.rows[y - (h - oldH)] ?? '';
    rows.push(src.slice(0, w).padEnd(w, TILES.empty));
  }
  return { ...level, rows };
}

// ---------------------------------------------------------------------------
// Checks. Errors stop a playtest; warnings are advice.
// ---------------------------------------------------------------------------

export interface LevelIssue {
  severity: 'error' | 'warning';
  message: string;
  x?: number;
  y?: number;
}

/** Matches the chunk validator: a turret needs this much sky to be stomped. */
const TURRET_HEADROOM = 3;

export function findAll(level: CustomLevel, ch: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  level.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === ch) out.push({ x, y });
  });
  return out;
}

export function checkLevel(level: CustomLevel): LevelIssue[] {
  const issues: LevelIssue[] = [];
  const at = (x: number, y: number): string => level.rows[y]?.[x] ?? TILES.empty;

  const starts = findAll(level, TILES.start);
  const portals = findAll(level, TILES.portal);

  if (starts.length === 0) issues.push({ severity: 'error', message: 'Place a start point.' });
  if (starts.length > 1) {
    for (const s of starts.slice(1))
      issues.push({ severity: 'error', message: 'Only one start point allowed.', ...s });
  }
  if (portals.length === 0) issues.push({ severity: 'error', message: 'Place an exit portal.' });
  if (portals.length > 1) {
    for (const p of portals.slice(1))
      issues.push({ severity: 'error', message: 'Only one exit portal allowed.', ...p });
  }

  for (const s of starts) {
    if (at(s.x, s.y + 1) !== TILES.solid) {
      issues.push({
        severity: 'warning',
        message: 'Start has no platform under it; a small one is added so you don’t spawn falling.',
        ...s,
      });
    }
  }

  for (const p of portals) {
    // The portal is two tiles tall: its own tile and the one above.
    if (at(p.x, p.y - 1) === TILES.solid) {
      issues.push({ severity: 'warning', message: 'Portal is half inside a platform above it.', ...p });
    }
  }

  for (const t of findAll(level, TILES.turret)) {
    for (let k = 1; k <= TURRET_HEADROOM && t.y - k >= 0; k++) {
      if (at(t.x, t.y - k) === TILES.solid) {
        issues.push({
          severity: 'warning',
          message: `Turret has only ${k - 1} clear tile${k - 1 === 1 ? '' : 's'} above it, so it can’t be stomped.`,
          ...t,
        });
        break;
      }
    }
  }

  if (!PALETTES[level.palette]) issues.push({ severity: 'error', message: 'Pick a palette.' });
  return issues;
}

// ---------------------------------------------------------------------------
// Storage: this browser only, for now.
// ---------------------------------------------------------------------------

const LIBRARY_KEY = 'foothold.customLevels';
const PLAYTEST_KEY = 'foothold.playtest';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Newest first. */
export function loadLibrary(): CustomLevel[] {
  const list = read<CustomLevel[]>(LIBRARY_KEY, []);
  return Array.isArray(list) ? list.filter(isLevel).sort((a, b) => b.updatedAt - a.updatedAt) : [];
}

export function saveToLibrary(level: CustomLevel): boolean {
  const list = loadLibrary().filter((l) => l.id !== level.id);
  list.unshift(level);
  return write(LIBRARY_KEY, list);
}

export function deleteFromLibrary(id: string): void {
  write(
    LIBRARY_KEY,
    loadLibrary().filter((l) => l.id !== id),
  );
}

export function setPlaytest(level: CustomLevel): boolean {
  return write(PLAYTEST_KEY, level);
}

export function getPlaytest(): CustomLevel | null {
  const l = read<CustomLevel | null>(PLAYTEST_KEY, null);
  return l && isLevel(l) ? l : null;
}

export function isLevel(v: unknown): v is CustomLevel {
  const l = v as CustomLevel;
  return (
    !!l &&
    typeof l.id === 'string' &&
    typeof l.name === 'string' &&
    typeof l.palette === 'number' &&
    Array.isArray(l.rows) &&
    l.rows.length > 0 &&
    l.rows.every((r) => typeof r === 'string' && r.length === l.rows[0].length)
  );
}
