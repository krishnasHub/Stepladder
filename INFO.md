# Working notes

Context for picking this up later. [README.md](README.md) is how to run it,
[DESIGN.md](DESIGN.md) is why it is built the way it is. **This file is the
stuff that is not obvious from either** — invariants you can break by accident,
traps that cost real time in this environment, and how to actually verify a
change.

---

## 1. State

Playable MVP, six levels, everything below working and pushed to
`github.com/krishnasHub/Stepladder`.

Phaser 3 + TypeScript + Vite. No art assets, no audio assets, no font files —
the bitmap font, every sound, the music and all the graphics are generated at
runtime. That is why a single 1.3 MB HTML file is the whole game.

Start it with `./start.sh` (or `start.bat` / `.\start.ps1`). It picks a free
port from 5199 up and opens a browser.

---

## 2. Invariants — break these and something subtle goes wrong

Each of these exists because of a specific failure, not a preference.

| Invariant | Why |
|---|---|
| **No `Math.random()` anywhere** | Death restarts the level, and a level that regenerates differently can't be learned. Everything seeds off `Rng`. Even the death sound's noise burst is seeded. |
| **Physics never reads real frame delta** | Fixed 60 Hz accumulator. Reading `delta` reintroduces frame-rate dependence and breaks replay. |
| **A `botGated` chunk must have a pit under the gated jump** | There the bot *is* the route. Kill it, miss the landing, and without a pit you are stranded in a level you can no longer finish — worse than dying. |
| **Assist only ever ADDS floor, never removes a bot** | Removing a bot can make a `botGated` chunk unsolvable. Adding floor can only make a route easier, never block it. Verified over 103 easings, zero tiles lost footing. |
| **If the player is alive, they can see themselves** | The kill plane hangs off a high-water mark, *not* off the camera. When those were the same mechanism, surviving a fall left you alive and off-screen. |
| **Exactly one facial expression at a time** | `currentFace()` resolves the winner; the eye, thought dots, sweat bead and shiver all hang off that one value. |
| **Music peaks below the sound effects** | Effects must cut through. Music ~0.09, effects ~0.16. |
| **The single-file build is a classic script, not an ES module** | Browsers refuse `<script type="module">` from `file://`. A module build silently shows a blank page to anyone who double-clicks it. |
| **Chunks are validated at startup** | `validateChunks()` checks dimensions, seams, entry headroom and — for vertical chunks — whether every rung is reachable given the current jump physics. |

---

## 3. Environment traps

These all cost time in this project. They are environmental, not bugs in the
game, and they will happen again.

**A backgrounded tab throttles `requestAnimationFrame` to zero.** Scenes never
boot, `create()` never runs, and the game looks frozen or broken. Symptoms:
timers not advancing, `rows.length === 0`, input appearing dead. Drive frames
manually with `game.step(t, 16.667)` in a loop, or click into the page first.

**Vite HMR hands you a second copy of a module.** Importing `./audio` from the
console gives a *different instance* than the app is using, because Vite serves
the app's copy with a `?t=` cache-busting query. This made mute look broken
three separate times when it was fine. Use the dev handles instead:

```js
window.__game    // the Phaser game
window.__audio   // the real audio module instance
```

**Creating a second `AudioContext` from devtools froze the renderer** and
required closing the tab. Don't; use `window.__audio`.

**Killing a dev server often leaves the child alive.** Stopping the `npx`
wrapper does not always stop the `node` process holding the port. Check with
`netstat -ano | grep :PORT` and kill the actual PID.

**Port 5173 had a stale service worker from an unrelated project**, which
intercepted requests and served a completely different app. That is why the
start scripts default to 5199.

**`node -e` inside a bash heredoc eats backticks and `$`.** Several doc edits
silently lost their inline code spans this way. For anything containing
backticks, use the file-editing tools rather than a shell one-liner.

---

## 4. How to verify things

The pattern that worked throughout: **drive the simulation directly** rather
than trying to play the game through the browser.

```js
const s = window.__game.scene.getScene('Game');
s.gi.poll = () => {};            // take over input
s.levelIndex = 0; s.startLevel();
s.gi.right = true; s.gi.jumpQueued = true;
for (let i = 0; i < 600; i++) s.fixedStep(1 / 60);
```

This bypasses rAF entirely, runs deterministically, and is how the camera,
assist, expression and collision work was all checked.

**Audio: render it, don't count nodes.** Counting oscillators only proves code
ran. `OfflineAudioContext` gives you the actual samples:

```js
const off = new OfflineAudioContext(1, 22050 * 8, 22050);
const m = new Music();
m.attach({ ctx: off, out: off.destination });
m.setTheme(i);
for (let k = 0; k < steps; k++) m.playStep(k, k * stepSec);
const d = (await off.startRendering()).getChannelData(0);
```

Offline `currentTime` never advances, so the scheduler will not run itself —
call `playStep` directly across the window. Peak, RMS and crest factor
(peak/RMS) are what caught both real audio bugs: a 5.6× loudness spread between
themes, and pads that read as a drone rather than plucks.

**Screenshots of the game canvas only** (no browser chrome, no letterbox bars):
compute the canvas rect and `zoom` to it.

```js
const c = document.querySelector('canvas').getBoundingClientRect();
// scale = screenshotFrameWidth / window.innerWidth, then region = rect * scale
```

The player moves between the screenshot and the zoom call, so pin position in
`gi.poll` while leaving velocity alone — the state stays put but still reads as
"running" to the game logic.

**Watch for the test being wrong.** Several "bugs" in this project were faulty
harnesses: `[0..5].map(runLevel)` passing the array index as `maxSteps`, a bot
that never travelled far enough to unpin the camera, cycles that never let the
player land between attempts. If a result looks impossible, suspect the test
first.

---

## 5. Where to change what

| Want to change | Go to |
|---|---|
| Jump height, speed, gravity, coyote, buffer, squash | `src/tuning.ts` — generator limits derive from these automatically |
| Level list, length, enemy mix, assist threshold | `src/levels.ts` |
| Level geometry | `src/chunks.ts` — 24×16 ASCII, validated at startup |
| Difficulty assistance tiers | `src/assist.ts`, plus the constants at the top of `GameScene.ts` |
| Expressions and their precedence | `currentFace()` in `GameScene.ts`; pixel art in the `*_PIXELS` tables |
| Sound effects | `src/audio.ts` |
| Music themes and tunes | `src/music.ts` — `THEMES[].melody` are scale degrees, `-1` is a rest |
| Colours | `src/palette.ts` |
| Parallax and background blobs | `BG_LAYERS`, `BG_AREA_PER_BLOCK`, `BG_BLOBS_PER_LAYER` in `GameScene.ts` |

Press `` ` `` in game for a debug overlay: velocity, grounded, jumps left,
assist tier, trouble spots, active expression.

---

## 6. Open work

**Level 1 has no bots.** Its difficulty ramp (`difficultyScale: 0.6`) only ever
picks bot-free chunks, so the turret chunks never appear. The menu subtitle
promises "stomp a bot to refresh your double jump" and the tutorial level never
shows you one. Cheapest fix: let a `LevelDef` name a chunk that must be
included, so level 1 stays gentle but still teaches the hook.

**No stomp sound.** The signature mechanic is the only silent one. Death,
double jump and head bonk all have sounds.

**No live link.** `dist/` is gitignored, so nothing is deployed. A small GitHub
Actions workflow building on push and deploying to Pages would give a URL to
share instead of the 1.3 MB file.

**Level length unmeasured.** DESIGN.md says to re-measure real playtime at M4
and confirm 45–90s is right under one-hit death. Never done with a human
playing.

**Still on the roadmap:** pixel-art sprites (M8), Capacitor packaging for
iOS/Android (M7), level-complete sound.

---

## 7. Decisions already made — don't redo these

| Tried | Outcome |
|---|---|
| Unreal Engine | No web export at all since UE 4.24. Pixel Streaming is server-side rendering, not a web game. |
| Godot 4 | Good native mobile, but a 15–25 MB wasm web export. |
| Rotating gravity for the vertical level | Disorienting and doubles collision edge cases. A normal-gravity climb reuses the whole controller. |
| Noise-based level generation | Produces mush. Hand-authored ASCII chunks with a validator instead. |
| Phaser `Text` for UI | Rasterises a system font into the low-res canvas, so it is grey mush before upscaling. Built a 5×7 bitmap font. |
| Blanket difficulty assist after N deaths | Trivialises a whole level for someone stuck on one gap. Assistance is local to trouble spots. |
| Ambient pad soundtrack | Sounded creepy — slow low drones, long attacks, minor modes and heavy filtering are a horror-ambience recipe. Replaced with a plucky music box. |
| 3×3 heart for the happy eye | Reads as the letter Y. Three pixels cannot carry two lobes; it is 5×4. |
| Counting only expired jump buffers as "stress" | Mashing *refreshes* the buffer so it never expires — fast mashing registered as nothing. Also counts a press arriving while one is unresolved. |
