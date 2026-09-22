# Working notes

Context for picking this up later. [README.md](README.md) is how to run it,
[DESIGN.md](DESIGN.md) is why it is built the way it is, and
[CONTEXT.md](CONTEXT.md) is the big picture: what the game is, who works on it,
and how. **This file is the stuff that is not obvious from any of those** —
invariants you can break by accident, traps that cost real time in this
environment, and how to actually verify a change.

---

## 1. State

Playable, six levels, four playable Tufflings with their own abilities, six
trophies, a dev-only level editor. Everything below is working and pushed to
`github.com/krishnasHub/Stepladder` (the repo keeps its old name; the game is
**Foothold**).

Phaser 3 + TypeScript + Vite. No art assets, no audio assets, no font files —
the bitmap font, every sound, the music, all the graphics and the favicon are
generated at runtime or inlined. That is why a single ~1.3 MB HTML file
(`dist-single/foothold.html`) is the whole game.

Start it with `./start.sh` (or `start.bat` / `.\start.ps1`). It picks a free
port from 5199 up and opens a browser. The editor is at `/editor.html` on the
same server.

---

## 2. Invariants — break these and something subtle goes wrong

Each of these exists because of a specific failure, not a preference.

| Invariant | Why |
|---|---|
| **No `Math.random()` anywhere** | Death restarts the level, and a level that regenerates differently can't be learned. Everything seeds off `Rng`. Even the death sound's noise burst is seeded; editor level ids use time + a counter. |
| **Physics never reads real frame delta** | Fixed 60 Hz accumulator. Reading `delta` reintroduces frame-rate dependence and breaks replay. |
| **Every level must be finishable by every Tuffling** | Abilities only open shortcuts. Checked, not assumed: the solver was run on all 6 levels × 4 Tufflings. That check is what found the flyer ladders too far apart for Hugsy. Re-run it after touching chunks or `abilities.ts` (§4). |
| **Fairness stays identical across Tufflings** | Hitbox (10×14), coyote time, jump buffer and corner correction live in `TUNING` and are the same for all four. Only `abilities.ts` differs. |
| **Mochi's ability numbers are exactly TUNING's** | `REACH`/`LIMITS` (and so chunk validation) derive from TUNING. Mochi is the reference; keep it that way or the validator checks the wrong character. |
| **A `botGated` chunk must have a pit under the gated jump** | There the bot *is* the route. Kill it, miss the landing, and without a pit you are stranded in a level you can no longer finish — worse than dying. |
| **A standing bot needs 3 clear tiles above it** | Otherwise it can't be stomped and becomes a wall. Old `v_turrets` had 2 and was practically unbeatable. `validateChunks()` enforces it. |
| **Assist only ever ADDS floor, never removes a bot** | Removing a bot can make a `botGated` chunk unsolvable. Adding floor can only make a route easier, never block it. |
| **If the player is alive, they can see themselves** | The kill plane hangs off a high-water mark, *not* off the camera. When those were the same mechanism, surviving a fall left you alive and off-screen. |
| **Exactly one facial expression at a time** | `currentFace()` resolves the winner; the eye, thought dots, sweat bead and shiver all hang off that one value. A face a Tuffling lacks is *skipped*, not replaced by the default. |
| **Trophy spots are chosen without the RNG** | `pickTrophySpot()` uses layout only (nearest 60% through). Drawing from the level's RNG would reshuffle every level. |
| **Playtest code paths are gated** | Hand-built levels (`freeCamera`, `buildCustomLevel`, `?playtest`) never touch normal levels. Normal levels must take exactly the old paths. |
| **The editor never ships** | `editor.html` is served by the dev server only; `vite build` only builds `index.html`. `src/editor/*`, `customLevels.ts` and `trophies.ts` import no Phaser, so the editor loads fast and the solver can run in node. |
| **Music peaks below the sound effects** | Effects must cut through. Music ~0.09, effects ~0.16. |
| **The single-file build is a classic script, not an ES module** | Browsers refuse `<script type="module">` from `file://`. A module build silently shows a blank page to anyone who double-clicks it. |
| **Don't rename storage keys** | `simple-jumper.progress.v1` and `stepladder.muted` keep old names on purpose; renaming wipes players' progress and settings. Old Tuffling ids (`dot`, `peeper`) are mapped to `hugsy`, `pepper` on load. |

---

## 3. Environment traps

These all cost time in this project. They are environmental, not bugs in the
game, and they will happen again.

**A backgrounded tab throttles `requestAnimationFrame` to zero** — and heavily
throttles `setTimeout`. Scenes never boot and the game looks frozen. Drive
frames manually with `game.step(t, 16.667)`. For long async work in a
background tab, yield with a `MessageChannel`, not `setTimeout`.

**To freeze a moment for a screenshot, sleep the loop:** `__game.loop.sleep()`,
then step by hand. Otherwise the real loop keeps running between tool calls and
the state you set up is gone by the time the screenshot happens. Tweens run on
the loop clock too, so a paused banner stays on screen — hide it
(`tweens.killAll()`, set text alpha 0).

**Browser screenshots time out while the CPU is busy** (a solver running, a
big build). Just retry; it usually works on the second try. Compute the
canvas crop from `getBoundingClientRect()` × (frame width / `innerWidth`) and
re-check the frame size if a crop comes out wrong.

**Never kill processes by image name.** `taskkill /IM node.exe` once took out
the dev server *and* Visual Studio's node helpers on this machine. Stop the
specific background task or PID only.

**Killing a dev server often leaves the child alive.** Stopping the `npx`
wrapper does not always stop the `node` process holding the port. Check with
`netstat -ano | grep :PORT` and kill that PID.

**Vite HMR hands you a second copy of a module.** Importing `./audio` from the
console gives a *different instance* than the app is using. Use the dev handles:

```js
window.__game    // the Phaser game
window.__audio   // the real audio module instance
```

**Creating a second `AudioContext` from devtools froze the renderer.** Don't;
use `window.__audio`.

**Port 5173 had a stale service worker from an unrelated project.** That is why
the start scripts default to 5199.

**Shell quoting.** `node -e` inside a bash heredoc eats backticks and `$`; bash
heredocs sometimes fail to parse long edit scripts; Windows PowerShell 5.1
splits `git commit -m` arguments at embedded double quotes. Write edit scripts
and commit messages to a file and run / `git commit -F` that.

**Replacing by text in chunk rows hits the wrong row.** Many rows are identical
(`'........................'`); edit chunk rows by position, never by value.

**Testing in the browser touches the user's saved data** (their picked
Tuffling, trophies, progress, playtest level). Back up the `localStorage` keys
first and restore them after. Touching a trophy saves it.

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

**The solver (`src/editor/solver.ts`) is the real test for "can this be
finished".** It drives an invisible player with the real `Player.step` through
every distinct state (best-first toward the goal, states bucketed a few px
wide). It runs in node via esbuild, since nothing it imports loads Phaser:

```ts
import { solveLevel } from './src/editor/solver';
const level = buildLevel(spec, new Rng(levelSeed(RUN_SEED, i)));   // as GameScene does
solveLevel(level, 'hugsy');                  // -> { finished, explored, path, ms }
solveLevel(level, 'hugsy', undefined, level.trophy);   // aim at the trophy instead
```

Bundle with `npx esbuild script.ts --bundle --platform=node` and run with
`node --max-old-space-size=8192`. Finishable levels answer in seconds; proving
one *unfinishable* is exhaustive and can take minutes. It treats walkers and
flyers as standing still at their spawn and ignores bullets.

Physics tests for abilities (grab, climb, mantle, shimmy, grip running out)
were plain node scripts calling `Player.step` on a `buildCustomLevel` room.
Let the player **settle 3 frames** before pressing jump — `reset()` leaves
`grounded` false, so a jump on frame 0 is a double jump. That caught two
faulty tests.

**Audio: render it, don't count nodes.** `OfflineAudioContext` gives you the
actual samples:

```js
const off = new OfflineAudioContext(1, 22050 * 8, 22050);
const m = new Music();
m.attach({ ctx: off, out: off.destination });
m.setTheme(i);
for (let k = 0; k < steps; k++) m.playStep(k, k * stepSec);
const d = (await off.startRendering()).getChannelData(0);
```

**Watch for the test being wrong.** Several "bugs" in this project were faulty
harnesses: the array index passed as `maxSteps`, a jump pressed before the
player had landed, text replacements hitting the first identical chunk row. If
a result looks impossible, suspect the test first.

---

## 5. Where to change what

| Want to change | Go to |
|---|---|
| Shared feel: coyote, buffer, squash, stomp bounce | `src/tuning.ts` — generator limits derive from these |
| How a Tuffling moves: speed, jump, float, grip | `src/abilities.ts` (Mochi = TUNING); stat bars in `STAT_BARS` |
| How a Tuffling looks: bodies, faces, pixel art | `src/tufflings.ts` |
| Which face shows, and when | `currentFace()` and the timers at the top of `GameScene.ts` |
| Hugsy's clinging | `stepCling()` and the wall/ceiling grab in `src/player.ts` |
| Level list, length, enemy mix, assist threshold | `src/levels.ts` |
| Level geometry, trophy spots (`C`) | `src/chunks.ts` — 24×16 ASCII, validated at startup |
| The six trophies | `src/trophies.ts` |
| Difficulty assistance tiers | `src/assist.ts`, plus the constants at the top of `GameScene.ts` |
| Sound effects | `src/audio.ts` |
| Music themes and tunes | `src/music.ts` — `THEMES[].melody` are scale degrees, `-1` is a rest |
| Colours | `src/palette.ts` |
| Title screen cast and ledges | `TITLE_SPOT`, `SIDE_SPOTS`, `SIDE_SCALE` in `MenuScene.ts` |
| The level editor | `editor.html`, `src/editor/editor.ts`; format + checks in `src/customLevels.ts` |
| Parallax and background blobs | `BG_LAYERS`, `BG_AREA_PER_BLOCK`, `BG_BLOBS_PER_LAYER` in `GameScene.ts` |

Press `` ` `` in game for a debug overlay: velocity, grounded, jumps left,
assist tier, trouble spots, active expression, Tuffling, cling state and grip.

---

## 6. Open work

**Hugsy on "My first level"** (the user's editor level, `custom-levels/`): the
editor's check was still running at 92% after several minutes when stopped.
Hugsy may not be able to finish it. Let the check run to the end.

**Shortcut trophies.** The plan was for some trophies to need a particular
Tuffling (Button's float, Hugsy's climb). All six are currently reachable by
everyone. The editor's trophy check shows who can reach one.

**Level 1 has no bots.** Its difficulty ramp and `enemyMix: ['turret']` never
produce a bot, so the tutorial level never shows the stomp the title promises.
Cheapest fix: let a `LevelDef` name a chunk that must be included.

**No stomp sound.** The signature mechanic is the only silent one.

**No live link.** `dist/` is gitignored, so nothing is deployed. A GitHub
Actions workflow deploying to Pages would give a URL to share.

**Level length unmeasured** with a human playing.

**Solver approximations.** Walkers and flyers are held still at their spawn,
and the horizontal levels' real kill plane (the camera band) is stricter than
the solver's (the bottom of the level). Both are fine for "is there a route",
not for "is it comfortable".

**Still on the roadmap:** pixel-art sprites, Capacitor packaging for
iOS/Android, level-complete sound, moving custom levels from `custom-levels/`
into the shipped game.

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
| Ambient pad soundtrack | Sounded creepy. Replaced with a plucky music box. |
| 3×3 heart for the happy eye | Reads as the letter Y. It is 5×4. |
| Counting only expired jump buffers as "stress" | Mashing *refreshes* the buffer so it never expires. Also counts a press arriving while one is unresolved. |
| Solid block as the exit | Looked like a bot. The exit is a hollow portal you squeeze into. |
| Wall-grab on any contact for Hugsy | Snags every hop onto a step. Grabs only when pushing into a wall near the apex or falling (rising < 80 px/s). |
| Hugsy hopping off walls with jump | User chose: jump just lets go and drops. Hugsy climbs by holding toward the wall. |
| Flyer ladders four rows apart | Only Mochi could clear them. Three rows. |
| Full-size, fully animated Tufflings at the sides of the title | Too cluttered. They are 60% size with a simple face. |
| String state keys in the solver | Most of its time. Packed into one number. |
