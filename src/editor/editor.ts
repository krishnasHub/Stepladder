/**
 * The level editor (editor.html). Dev-only: paint a level, pick a palette,
 * press Play to try it in the game. Levels are kept in this browser.
 *
 * Plain DOM and a 2D canvas — no Phaser — so it loads instantly and draws the
 * level the same way the game will: same palettes, same tile meanings.
 */

import {
  CustomLevel,
  LevelIssue,
  MAX_H,
  MAX_W,
  MIN_H,
  MIN_W,
  TILES,
  TileChar,
  checkLevel,
  deleteFromLibrary,
  isLevel,
  loadLibrary,
  makeId,
  newLevel,
  resizeLevel,
  saveToLibrary,
  setPlaytest,
} from '../customLevels';
import { PALETTES, Palette } from '../palette';
import type { SolveProgress, SolveResult } from './solver';

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

interface Tool {
  id: string;
  label: string;
  char: TileChar;
  key: string;
  /** Only one of these may exist; placing it moves it. */
  single?: boolean;
}

const TOOLS: Tool[] = [
  { id: 'platform', label: 'Platform', char: TILES.solid, key: '1' },
  { id: 'spike', label: 'Spike', char: TILES.spike, key: '2' },
  { id: 'turret', label: 'Turret', char: TILES.turret, key: '3' },
  { id: 'start', label: 'Start', char: TILES.start, key: '4', single: true },
  { id: 'portal', label: 'Exit portal', char: TILES.portal, key: '5', single: true },
  { id: 'eraser', label: 'Eraser', char: TILES.empty, key: '6' },
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let level: CustomLevel = loadLibrary()[0] ?? newLevel('My first level');
let tool: Tool = TOOLS[0];
let zoom = 24;
let hover: { x: number; y: number } | null = null;
let flash: { x: number; y: number; until: number } | null = null;
const undo: string[][] = [];
const redo: string[][] = [];

const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d')!;

const pal = (): Palette => PALETTES[level.palette] ?? PALETTES[0];
const W = (): number => level.rows[0].length;
const H = (): number => level.rows.length;
const at = (x: number, y: number): string => level.rows[y]?.[x] ?? TILES.empty;

// ---------------------------------------------------------------------------
// Drawing — mirrors how the game draws each thing
// ---------------------------------------------------------------------------

const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
function blend(a: number, b: number, t: number): number {
  const ch = (s: number): number => {
    const x = (a >> s) & 255;
    const y = (b >> s) & 255;
    return Math.round(x + (y - x) * t) << s;
  };
  return ch(16) | ch(8) | ch(0);
}

/** Draw one tile's contents at pixel (px, py), `z` pixels per tile. */
function drawTile(c: CanvasRenderingContext2D, ch: string, px: number, py: number, z: number, p: Palette, solidAbove: boolean): void {
  const s = z / 16;
  switch (ch) {
    case TILES.solid:
      c.fillStyle = hex(p.env);
      c.fillRect(px, py, z, z);
      if (!solidAbove) {
        c.fillStyle = hex(blend(p.env, 0xffffff, 0.22));
        c.fillRect(px, py, z, Math.max(1, Math.round(2 * s)));
      }
      break;
    case TILES.spike:
      c.fillStyle = hex(p.hazard);
      c.beginPath();
      c.moveTo(px + 3 * s, py + z);
      c.lineTo(px + z / 2, py + 4 * s);
      c.lineTo(px + z - 3 * s, py + z);
      c.closePath();
      c.fill();
      break;
    case TILES.turret: {
      const b = 12 * s;
      const bx = px + (z - b) / 2;
      const by = py + (z - b) / 2;
      c.fillStyle = hex(p.hazard);
      c.fillRect(bx, by, b, b);
      c.fillStyle = hex(blend(p.hazard, 0x000000, 0.25));
      c.fillRect(bx, by, b, 2 * s);
      break;
    }
    case TILES.start: {
      // A little Mochi standing on the tile below.
      const w = 12 * s;
      const h = 14 * s;
      const bx = px + (z - w) / 2;
      const by = py + z - h;
      c.fillStyle = hex(p.player);
      c.beginPath();
      c.roundRect(bx, by, w, h, [5 * s, 5 * s, 2 * s, 2 * s]);
      c.fill();
      c.fillStyle = hex(p.ink);
      c.fillRect(bx + 3 * s, by + 6 * s, 2 * s, 3 * s);
      c.fillRect(bx + 7 * s, by + 6 * s, 2 * s, 3 * s);
      break;
    }
    case TILES.portal: {
      // The goal is two tiles tall: this tile and the one above.
      const cx = px + z / 2;
      const cy = py;
      c.fillStyle = hex(p.player);
      c.beginPath();
      c.ellipse(cx, cy, 9 * s, 15.5 * s, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = hex(blend(p.bg, 0xffffff, 0.5));
      c.beginPath();
      c.ellipse(cx, cy, 6 * s, 12.5 * s, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = hex(blend(p.player, 0xffffff, 0.6));
      c.beginPath();
      c.ellipse(cx, cy, 2.5 * s, 5 * s, 0, 0, Math.PI * 2);
      c.fill();
      break;
    }
    default:
      break;
  }
}

let issues: LevelIssue[] = [];

function render(): void {
  const p = pal();
  const z = zoom;
  const w = W();
  const h = H();
  canvas.width = w * z;
  canvas.height = h * z;

  ctx.fillStyle = hex(p.bg);
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Grid, with every 10th line a touch stronger so distances are countable.
  for (let x = 0; x <= w; x++) {
    ctx.fillStyle = hex(blend(p.bg, p.ink, x % 10 === 0 ? 0.16 : 0.06));
    ctx.fillRect(x * z, 0, 1, canvas.height);
  }
  for (let y = 0; y <= h; y++) {
    ctx.fillStyle = hex(blend(p.bg, p.ink, (h - y) % 10 === 0 ? 0.16 : 0.06));
    ctx.fillRect(0, y * z, canvas.width, 1);
  }

  // Solids first, then everything that sits on or in front of them.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (at(x, y) === TILES.solid) drawTile(ctx, TILES.solid, x * z, y * z, z, p, at(x, y - 1) === TILES.solid);
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = at(x, y);
      if (ch !== TILES.solid && ch !== TILES.empty) drawTile(ctx, ch, x * z, y * z, z, p, false);
    }
  }

  // Cells with a problem get an outline.
  for (const i of issues) {
    if (i.x === undefined || i.y === undefined) continue;
    ctx.strokeStyle = i.severity === 'error' ? '#d63b3b' : '#d9982b';
    ctx.lineWidth = 2;
    ctx.strokeRect(i.x * z + 1, i.y * z + 1, z - 2, z - 2);
  }
  if (flash && performance.now() < flash.until) {
    ctx.strokeStyle = hex(p.ink);
    ctx.lineWidth = 3;
    ctx.strokeRect(flash.x * z - 2, flash.y * z - 2, z + 4, z + 4);
  }

  drawRoute();

  if (hover) {
    ctx.strokeStyle = hex(blend(p.ink, p.bg, 0.3));
    ctx.lineWidth = 1;
    ctx.strokeRect(hover.x * z + 0.5, hover.y * z + 0.5, z - 1, z - 1);
  }
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function setCell(x: number, y: number, ch: string): boolean {
  if (x < 0 || y < 0 || x >= W() || y >= H() || at(x, y) === ch) return false;
  const row = level.rows[y];
  level.rows[y] = row.slice(0, x) + ch + row.slice(x + 1);
  return true;
}

function place(x: number, y: number, t: Tool): void {
  if (x < 0 || y < 0 || x >= W() || y >= H()) return;
  if (t.single) {
    // Moving the start or portal: clear the old one first.
    for (let yy = 0; yy < H(); yy++) {
      const i = level.rows[yy].indexOf(t.char);
      if (i >= 0 && (i !== x || yy !== y)) setCell(i, yy, TILES.empty);
    }
  }
  setCell(x, y, t.char);
}

function snapshot(): void {
  undo.push(level.rows.slice());
  if (undo.length > 200) undo.shift();
  redo.length = 0;
}

/** `layout` is false for edits that can't change finishability (name, palette). */
function changed(layout = true): void {
  level.updatedAt = Date.now();
  issues = checkLevel(level);
  renderIssues();
  if (layout) scheduleCheck();
  render();
  scheduleSave();
}

// ---------------------------------------------------------------------------
// "Can it be finished?" — the real physics, searched in a worker (solver.ts)
// ---------------------------------------------------------------------------

type Check =
  | { state: 'waiting' }
  | { state: 'blocked' }
  | { state: 'running'; explored: number; closest: number; started: number }
  | { state: 'done'; result: SolveResult };

let check: Check = { state: 'waiting' };
let worker: Worker | null = null;
let checkTimer = 0;

/** Wait for a pause in editing, then check. Any edit cancels a running check. */
function scheduleCheck(): void {
  worker?.terminate();
  worker = null;
  window.clearTimeout(checkTimer);
  check = { state: 'waiting' };
  renderFinish();
  checkTimer = window.setTimeout(startCheck, 700);
}

function startCheck(): void {
  // No start or portal: nothing to search for yet.
  if (issues.some((i) => i.severity === 'error')) {
    check = { state: 'blocked' };
    renderFinish();
    render();
    return;
  }
  const w = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  check = { state: 'running', explored: 0, closest: 0, started: performance.now() };
  w.onmessage = (e: MessageEvent<SolveProgress | SolveResult>) => {
    if (worker !== w) return;
    if (e.data.kind === 'progress') {
      check = { ...(check as Extract<Check, { state: 'running' }>), explored: e.data.explored, closest: e.data.closest };
      renderFinish();
    } else {
      check = { state: 'done', result: e.data };
      w.terminate();
      worker = null;
      renderFinish();
      render();
    }
  };
  w.postMessage({ rows: level.rows });
  renderFinish();
  render();
}

const fmt = (n: number): string => n.toLocaleString();
const secs = (ms: number): string => (ms < 1000 ? `${Math.max(1, Math.round(ms))}ms` : `${(ms / 1000).toFixed(1)}s`);

function renderFinish(): void {
  const el = $('finish');
  el.className = 'finish';
  if (check.state === 'waiting') {
    el.innerHTML = '<strong>Checking soon…</strong><small>Waiting for you to pause</small>';
  } else if (check.state === 'blocked') {
    el.innerHTML = '<strong>Can it be finished?</strong><small>Fix the errors below first</small>';
  } else if (check.state === 'running') {
    const t = secs(performance.now() - check.started);
    el.innerHTML = `<strong>Checking…</strong><small>${fmt(check.explored)} moves tried · ${t}</small><small>Closest so far: ${Math.round(check.closest * 100)}% of the way</small>`;
  } else if (check.result.finished) {
    el.classList.add('yes');
    el.innerHTML = `<strong>✓ Can be finished</strong><small>Route found in ${secs(check.result.ms)} (${fmt(check.result.explored)} moves)</small>`;
  } else {
    el.classList.add('no');
    el.innerHTML = `<strong>✗ Can’t reach the portal</strong><small>Tried every route (${fmt(check.result.explored)} moves, ${secs(check.result.ms)})</small><small>The red line shows how far it gets</small>`;
  }
}

/** The route (or the attempt that got closest), drawn over the level. */
function drawRoute(): void {
  if (check.state !== 'done' || !$<HTMLInputElement>('show-route').checked) return;
  const { path, finished } = check.result;
  if (path.length < 2) return;
  const s = zoom / 16;
  ctx.save();
  ctx.strokeStyle = finished ? hex(pal().ink) : '#d63b3b';
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = Math.max(1.5, 2 * s);
  ctx.setLineDash([3 * s, 4 * s]);
  ctx.beginPath();
  path.forEach((p, i) => (i ? ctx.lineTo(p.x * s, p.y * s) : ctx.moveTo(p.x * s, p.y * s)));
  ctx.stroke();
  if (!finished) {
    // Mark where it got stuck.
    const end = path[path.length - 1];
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(2, 3 * s);
    const r = 6 * s;
    ctx.beginPath();
    ctx.moveTo(end.x * s - r, end.y * s - r);
    ctx.lineTo(end.x * s + r, end.y * s + r);
    ctx.moveTo(end.x * s + r, end.y * s - r);
    ctx.lineTo(end.x * s - r, end.y * s + r);
    ctx.stroke();
  }
  ctx.restore();
}

// Painting: a stroke is one undo step. Moves between samples are filled in
// with a line so a fast drag doesn't leave gaps.
let stroke: { tool: Tool; last: { x: number; y: number } } | null = null;

function cellAt(e: PointerEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: Math.floor((e.clientX - r.left) / zoom), y: Math.floor((e.clientY - r.top) / zoom) };
}

function paintLine(a: { x: number; y: number }, b: { x: number; y: number }, t: Tool): void {
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
  for (let i = 0; i <= n; i++) {
    place(Math.round(a.x + ((b.x - a.x) * i) / n), Math.round(a.y + ((b.y - a.y) * i) / n), t);
  }
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  const c = cellAt(e);
  const t = e.button === 2 ? TOOLS.find((x) => x.id === 'eraser')! : tool;
  canvas.setPointerCapture(e.pointerId);
  snapshot();
  stroke = { tool: t, last: c };
  place(c.x, c.y, t);
  changed();
});
canvas.addEventListener('pointermove', (e) => {
  const c = cellAt(e);
  hover = c.x >= 0 && c.y >= 0 && c.x < W() && c.y < H() ? c : null;
  $('cursor').textContent = hover
    ? `x ${hover.x}  y ${hover.y}  (${H() - 1 - hover.y} up from the bottom)`
    : '—';
  if (stroke && !stroke.tool.single) {
    paintLine(stroke.last, c, stroke.tool);
    stroke.last = c;
    changed();
  } else if (stroke) {
    place(c.x, c.y, stroke.tool);
    changed();
  } else {
    render();
  }
});
const endStroke = (): void => {
  stroke = null;
};
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);
canvas.addEventListener('pointerleave', () => {
  hover = null;
  if (!stroke) render();
});

function doUndo(): void {
  const prev = undo.pop();
  if (!prev) return;
  redo.push(level.rows.slice());
  level.rows = prev;
  syncSize();
  changed();
}
function doRedo(): void {
  const next = redo.pop();
  if (!next) return;
  undo.push(level.rows.slice());
  level.rows = next;
  syncSize();
  changed();
}

// ---------------------------------------------------------------------------
// Saving — this browser only
// ---------------------------------------------------------------------------

let saveTimer = 0;
function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  $('saved').textContent = 'Saving…';
  saveTimer = window.setTimeout(saveNow, 400);
}
function saveNow(): void {
  window.clearTimeout(saveTimer);
  const ok = saveToLibrary(level);
  $('saved').textContent = ok ? 'Saved in this browser' : 'Couldn’t save — browser storage is blocked';
  renderLibrary();
}

function renderLibrary(): void {
  const host = $('library');
  host.replaceChildren();
  for (const l of loadLibrary()) {
    const item = document.createElement('div');
    item.className = 'lib-item' + (l.id === level.id ? ' current' : '');
    const open = document.createElement('button');
    open.className = 'lib-open';
    open.innerHTML = `<span></span><small>${l.rows[0].length}×${l.rows.length} · ${PALETTES[l.palette]?.name ?? '?'}</small>`;
    (open.firstChild as HTMLElement).textContent = l.name || 'Untitled';
    open.addEventListener('click', () => openLevel(l));
    const del = document.createElement('button');
    del.className = 'lib-del';
    del.textContent = '×';
    del.title = `Delete ${l.name}`;
    del.setAttribute('aria-label', `Delete ${l.name}`);
    del.addEventListener('click', () => {
      if (!window.confirm(`Delete “${l.name}”? This can’t be undone.`)) return;
      deleteFromLibrary(l.id);
      if (l.id === level.id) openLevel(loadLibrary()[0] ?? newLevel('My first level'));
      else renderLibrary();
    });
    item.append(open, del);
    host.append(item);
  }
}

function openLevel(l: CustomLevel): void {
  saveNow();
  level = { ...l, rows: l.rows.slice() };
  undo.length = 0;
  redo.length = 0;
  syncFields();
  changed();
}

// ---------------------------------------------------------------------------
// Checks panel
// ---------------------------------------------------------------------------

function renderIssues(): void {
  const host = $('issues');
  host.replaceChildren();
  if (!issues.length) {
    const ok = document.createElement('div');
    ok.className = 'all-good';
    ok.textContent = 'Ready to play.';
    host.append(ok);
    return;
  }
  for (const i of issues) {
    const b = document.createElement('button');
    b.className = `issue ${i.severity}`;
    b.textContent = i.message + (i.x !== undefined ? ` (${i.x}, ${i.y})` : '');
    if (i.x !== undefined && i.y !== undefined) {
      const { x, y } = i;
      b.addEventListener('click', () => {
        flash = { x, y, until: performance.now() + 1200 };
        const stage = $('stage');
        stage.scrollTo({ left: x * zoom - stage.clientWidth / 2, top: y * zoom - stage.clientHeight / 2, behavior: 'smooth' });
        render();
        window.setTimeout(render, 1250);
      });
    }
    host.append(b);
  }
}

// ---------------------------------------------------------------------------
// Header controls
// ---------------------------------------------------------------------------

function syncFields(): void {
  $<HTMLInputElement>('name').value = level.name;
  $<HTMLSelectElement>('palette').value = String(level.palette);
  syncSize();
}
function syncSize(): void {
  $<HTMLInputElement>('w').value = String(W());
  $<HTMLInputElement>('h').value = String(H());
}

const paletteSel = $<HTMLSelectElement>('palette');
PALETTES.forEach((p, i) => {
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = `${p.name} (level ${i + 1})`;
  paletteSel.append(o);
});
paletteSel.addEventListener('change', () => {
  level.palette = Number(paletteSel.value);
  renderToolIcons();
  changed(false);
});

$<HTMLInputElement>('name').addEventListener('input', (e) => {
  level.name = (e.target as HTMLInputElement).value;
  changed(false);
});

$('resize').addEventListener('click', () => {
  const w = Number($<HTMLInputElement>('w').value);
  const h = Number($<HTMLInputElement>('h').value);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return;
  snapshot();
  level = resizeLevel(level, w, h);
  syncSize();
  if (w < MIN_W || w > MAX_W || h < MIN_H || h > MAX_H) {
    toast(`Size kept to ${MIN_W}–${MAX_W} wide and ${MIN_H}–${MAX_H} tall.`);
  }
  changed();
});

/** Grow the level. Height is added on top, width on the right. */
function extend(dw: number, dh: number): void {
  const w = Math.min(MAX_W, W() + dw);
  const h = Math.min(MAX_H, H() + dh);
  if (w === W() && h === H()) {
    toast(`Already at the maximum size (${MAX_W}×${MAX_H}).`);
    return;
  }
  snapshot();
  level = resizeLevel(level, w, h);
  syncSize();
  changed();
  // Show the new space: the top for height, the right edge for width.
  const stage = $('stage');
  if (dh) stage.scrollTo({ top: 0, behavior: 'smooth' });
  if (dw) stage.scrollTo({ left: stage.scrollWidth, behavior: 'smooth' });
}
$('extend-right').addEventListener('click', () => extend(10, 0));
$('extend-up').addEventListener('click', () => extend(0, 10));

$<HTMLInputElement>('zoom').addEventListener('input', (e) => {
  zoom = Number((e.target as HTMLInputElement).value);
  render();
});

$('new').addEventListener('click', () => {
  openLevel(newLevel(`Level ${loadLibrary().length + 1}`));
  toast('New level');
});

$('export').addEventListener('click', () => {
  saveNow();
  const blob = new Blob([JSON.stringify(level, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(level.name || 'level').replace(/[^\w-]+/g, '-').toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

const importFile = $<HTMLInputElement>('import-file');
$('import').addEventListener('click', () => importFile.click());
importFile.addEventListener('change', async () => {
  const f = importFile.files?.[0];
  importFile.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text()) as unknown;
    if (!isLevel(data)) throw new Error('not a level');
    // A fresh id, so importing never overwrites a level you already have.
    openLevel({ ...data, id: makeId(), updatedAt: Date.now() });
    toast(`Imported “${data.name}”`);
  } catch {
    toast('That file isn’t a Foothold level.');
  }
});

function play(): void {
  const errors = issues.filter((i) => i.severity === 'error');
  if (errors.length) {
    toast(`Fix first: ${errors[0].message}`);
    return;
  }
  saveNow();
  if (!setPlaytest(level)) {
    toast('Couldn’t hand the level to the game — browser storage is blocked.');
    return;
  }
  // A named window: pressing Play again reloads the same game tab.
  window.open(`/?playtest=${encodeURIComponent(level.id)}`, 'foothold-playtest');
}
$('play').addEventListener('click', play);

// ---------------------------------------------------------------------------
// Tool buttons
// ---------------------------------------------------------------------------

const toolButtons: HTMLButtonElement[] = [];
function renderToolIcons(): void {
  TOOLS.forEach((t, i) => {
    const c = toolButtons[i].querySelector('canvas')!;
    const g = c.getContext('2d')!;
    const p = pal();
    g.fillStyle = hex(p.bg);
    g.fillRect(0, 0, 22, 22);
    if (t.id === 'eraser') {
      g.strokeStyle = hex(p.ink);
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(6, 6);
      g.lineTo(16, 16);
      g.moveTo(16, 6);
      g.lineTo(6, 16);
      g.stroke();
    } else if (t.id === 'portal') {
      g.save();
      g.translate(0, 11);
      drawTile(g, t.char, 3, 0, 16, p, false);
      g.restore();
    } else {
      drawTile(g, t.char, 3, 3, 16, p, false);
    }
  });
}

TOOLS.forEach((t) => {
  const b = document.createElement('button');
  b.className = 'tool';
  b.id = `tool-${t.id}`;
  b.innerHTML = `<canvas width="22" height="22"></canvas><span>${t.label}</span><kbd>${t.key}</kbd>`;
  b.setAttribute('aria-pressed', String(t === tool));
  b.addEventListener('click', () => selectTool(t));
  toolButtons.push(b);
  $('tools').append(b);
});

function selectTool(t: Tool): void {
  tool = t;
  toolButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(TOOLS[i] === t)));
}

window.addEventListener('keydown', (e) => {
  const typing = (e.target as HTMLElement).matches('input, select, textarea');
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    play();
    return;
  }
  if (typing) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) doRedo();
    else doUndo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    doRedo();
    return;
  }
  const t = TOOLS.find((x) => x.key === e.key);
  if (t && !e.ctrlKey && !e.metaKey && !e.altKey) selectTool(t);
});

// ---------------------------------------------------------------------------

let toastTimer = 0;
function toast(msg: string): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 2400);
}

$('show-route').addEventListener('change', render);

syncFields();
renderToolIcons();
issues = checkLevel(level);
renderIssues();
scheduleCheck();
render();
saveNow();
