# Foothold — Design Document

A 2D procedurally-generated side-scroller. Pastel, near-monochrome pixel art.
Web-first, ported to iOS/Android.

Status: **MVP playable**. Six levels across all three orientations, running in
the browser and shippable as a single HTML file. See [README.md](README.md) to
run it. Remaining: pixel-art sprites, audio, Capacitor packaging.

---

## 1. Locked decisions

| Decision | Choice | Rationale |
|---|---|---|
| Engine | Phaser 3 + TypeScript + Vite | Arcade AABB physics, camera, input, audio, pooling built in. ~1MB gzipped. Ships to web and Capacitor unchanged. |
| Death model | One hit = death, instant restart (<0.5s, no menu) | Keeps levels tight, makes tuning honest, least code. |
| Level length | Short — ramp 45s (L1) to 90s (L5+) | Fits mobile sessions, keeps death cheap. Re-measure at M4. |
| Mobile | Web-first; Capacitor added at M7 | Touch designed in from day one, native shells once the game is fun. |

### Rejected

- **Unreal Engine** — no web export (HTML5 removed in UE 4.24, never returned in
  UE5). Pixel Streaming is server-side rendering, not a web game. Paper2D is
  minimally maintained and a blank UE5 mobile build is 50–100MB.
- **Godot 4** — good native mobile, but a 15–25MB wasm web export.
- **Hand-rolled Canvas2D** — viable (~50KB bundle) but costs 1–2 milestones
  re-implementing physics, camera, and pooling.

---

## 2. Core architecture: the progress vector

There are not three level types. There is **one system with a progress vector**.

Gravity always points **down**, in every level. What changes per level is the
direction of progress — a unit vector driving the camera, the chunk generator,
and the goal condition.

| Level | Progress vector | Feel |
|---|---|---|
| 1 | `(1, 0)` | Classic run right |
| 2 | `(0, -1)` | Vertical climb, platforms above |
| 3+ | `(0.7, -0.7)` | Diagonal ascent, mixed |

A `Director` owns the vector. It decides where the next chunk spawns, how the
camera leads the player, and when distance-along-axis crosses the level goal.

Levels are therefore **data**, not code:

```ts
{ id, axis, targetDistance, difficultyCurve, enemyMix, palette }
```

**Why not rotate gravity for level 2?** Rotated gravity disorients players and
doubles the collision edge cases. A vertical climb under normal gravity reads
instantly and reuses every line of the player controller.

### Camera rules

The camera is axis-aware, because what reads as good framing in a runner reads
as the camera fighting you in a climb.

- **Lead only along the direction of travel.** A `facing * 18` lead is correct
  when you run right; in a climb you step left and right constantly to line up
  jumps, and each turn swung the view 36px. Vertical levels lead *upward*
  instead, and never sideways.
- **Deadzone on the perpendicular axis.** Footwork inside the band moves the
  camera not at all — 56px in a climb, 30px vertically in a runner.
- **No per-chunk window on the perpendicular axis.** The original camera rebuilt
  its clamp from the current chunk ±1, and in a vertical level consecutive
  chunks drift sideways, so the allowed ranges barely overlapped (chunk 3:
  152→280, chunk 4: 280→408). Crossing a seam snapped the range 128px with no
  overlap, and stepping back across snapped it in reverse. X now clamps to the
  level's own bounds, which has no discontinuity.
- **Interpolate the band that remains.** Horizontal levels still need a
  chunk-relative Y band — that band *is* the kill plane — so it is interpolated
  across the seam rather than switched at it.
- **Snap on respawn.** Otherwise the first frame after a death violently
  corrects the camera into bounds (measured: a 136px jump in one frame).
- **The kill plane hangs off a high-water mark, not off the camera.** These were
  originally the same mechanism: a climb pinned the camera at its highest point,
  and "below the camera" meant death. That works only while every fall is fatal.
  Survive a fall onto a lower platform and the two jobs conflict — the camera
  stayed up and the player was alive, off-screen, guessing where they were.
  `minCamY` now only records the highest point reached and feeds the kill plane;
  the camera is free to pan back down.

  The invariant to preserve: **if you are alive, you can see yourself.** Verified
  by sweeping fall distances — survivable falls top out at 140px and every
  survivor lands at screen y 168, dead centre.

Measured over an identical synthetic climb, before and after: peak per-frame
sideways motion 10.5px → 1.8px, total sideways travel 1449px → 468px.

---

## 3. Determinism (load-bearing)

Because death restarts the level, the level must regenerate **identically** so
the player can learn it. Non-negotiable:

- **Seeded RNG only** (mulberry32). Zero `Math.random()` in the codebase —
  enforce with a lint rule.
- **Fixed 60Hz timestep** with an accumulator; rendering interpolates. No physics
  code reads `delta`.
- Level seed stored on entry; retry reuses it.
- Chunk selection, enemy placement, and enemy fire timers all draw from the
  seeded stream.

Free consequences: bugs replay from a seed, and "share this seed" becomes a
feature later.

---

## 4. Game feel

The game lives or dies here. Budget disproportionate time on M1.

### Constants (60fps, 16px tiles) — starting values, tuned by hand at M1

```
gravity          914 px/s²     jump apex 3.5 tiles in 0.35s
jumpVelocity     320 px/s
doubleJumpVel    260 px/s      weaker: a save, not a boost
runSpeed         140 px/s
accelGround     1200 px/s²     snappy
accelAir         600 px/s²     reduced control, still responsive
maxFallSpeed     420 px/s
stompBounce      240 px/s
```

### Derived reach (drives generator limits)

|  | Single jump | With double jump | Stomp + refreshed double |
|---|---|---|---|
| Airtime | 0.70s | 1.09s | — |
| Height | 3.5 tiles | 5.8 tiles | **4.3 tiles above the bot's head** |
| Horizontal reach | 6.1 tiles | 9.5 tiles | ~7 tiles from the bot |

The third column is the whole point of the stomp mechanic: a bot is a portable
piece of level geometry that grants 4.3 tiles of height *measured from wherever
it happens to be standing*. Bot ladders (stomp → bounce → stomp) chain this
without limit, which is what makes the level 2 vertical climb work.

### Forgiveness mechanics — all four required

- **Coyote time** — ~100ms jump grace after leaving a ledge
- **Jump buffer** — ~120ms; a jump pressed before landing still fires
- **Variable jump height** — release early, halve upward velocity
- **Corner correction** — nudge ~2px sideways when a jump clips a ledge corner

All constants live in one `tuning.ts`. Generator constraints are **derived from
them**, so retuning the jump automatically retunes what can be generated.

### Local difficulty assistance

After repeated deaths **in the same place**, the game quietly gives ground
there — and only there.

The key word is *local*. A blanket buff after N deaths would be wrong: it
punishes the player who is fine everywhere but one gap by trivialising the
whole level, and it rewrites a level they have otherwise learned. So assistance
keys off a trouble spot — deaths bucketed into 3-tile cells — and applies only
within `ASSIST_RADIUS` (150px) of one. That radius is generous because the jump
that fails begins well before the place you land.

Two kinds of help, in three tiers (`assist.ts`):

| Lever | At tier 3 |
|---|---|
| Coyote time, jump buffer | ×2.2 / ×2.0 |
| Jump power, air control | ×1.09 / ×1.45 |
| Projectile speed | ×0.6 |
| Fire interval, windup telegraph | ×1.7 / ×2.0 |

Plus, after `DEATHS_PER_SPOT_EASE` (4) deaths in one cell, the **terrain at that
cell** is widened: up to two ledge edges extend one tile toward each other,
closing the gap by up to two tiles. Capped at `MAX_SPOT_EASES` (4) per level.

Constraints this respects:

- **It never removes a bot.** In a `botGated` chunk the bot *is* the route;
  deleting it makes the chunk unsolvable.
- **It only ever adds floor**, to the outer edge of an existing ledge with
  headroom above. A route can become easier, never blocked. Verified across 103
  easings on all six levels: zero previously-standable tiles lost footing.
- **The rest of the level is untouched**, so everything learned still holds.
  Verified: a run with one death sees assist tier 0 and no terrain change.

Why easing a choke point is safe when reshuffling a level is not: the muscle
memory built at a spot you have died on five times is memory of a jump you
cannot make. There is nothing there worth preserving. Elsewhere, there is.

Timing does necessarily change under assistance — slower shots are the point —
so the strict "identical replay" property holds only until help arrives. The
*spatial* layout, which is what a player actually memorises, changes at a
trouble spot and nowhere else.

---

## 5. Procedural generation — chunk grammar

Not noise. Noise produces mush; pure randomness produces unplayable terrain.

- Hand-author ~20 chunks as ASCII strings, each **24 × 16 tiles (384 × 256 px)** —
  exactly one screen wide, 1.2 screens tall.
- Each chunk declares an **entry height band** and **exit height band**.
- At runtime, pick from chunks whose entry band matches the current exit band,
  weighted by a **difficulty value** ramping with distance. A repeat-spacing rule
  prevents the same chunk twice within N picks.
- Stitch, spawn entities, recycle chunks behind the camera.

Authoring new content = typing ASCII. No tooling needed.

### Generator constraints (70% of theoretical max)

| Constraint | Single-jump section | Double-jump guaranteed | Bot-gated |
|---|---|---|---|
| Max gap | 4 tiles | 6 tiles | 5 tiles from bot |
| Max step-up | 3 tiles | 5 tiles | 3 tiles above bot's head |

Chunks are validated against these at build time, not runtime.

### Bot-gated chunks

A chunk may declare `botGated: true`, meaning a bot is **load-bearing
traversal** — the only route past a section. These unlock the third constraint
column, but carry one mandatory rule:

> **Every bot-gated jump must have a kill-plane beneath it.**

Without it, a player who stomps the bot and misses the landing has destroyed
their own route: the bot is dead, the ledge is unreachable, and there is no way
to die. That is a softlock, which in a one-hit-death game is strictly worse than
dying — it forces a manual restart and breaks the fast-retry rhythm.

With a pit below, a missed landing becomes an ordinary death and feeds straight
back into the instant-restart loop. Failure stays fast.

Rejected alternative: **respawning bots on a timer.** It solves the softlock but
undercuts the kill — the player earned that bot's death and should keep it.
The pit is cheaper and reads better.

The chunk validator enforces this: `botGated` chunks without a kill-plane under
the gated jump fail the build.

### Level sizing

- 140px/s × 45s = 6,300px = **~16 chunks** (level 1)
- 140px/s × 90s = 12,600px = **~33 chunks** (level 5+)

---

## 6. Enemies & combat

Three archetypes behind one AI interface:

- **Turret** — static, fires on an interval along a fixed axis. Windup flash
  ~250ms before firing. Readability beats difficulty.
- **Walker** — patrols a platform, fires toward the player when in line.
- **Flyer** — sine-wave path, drops projectiles. Level 3+.

**Stomp kill:** `velocity.y > 0` AND player feet overlap the bot's top third →
bot dies, player bounces (240 px/s) **and the double jump refreshes**.

This is the core mechanic, not a detail. The refresh makes a bot a portable
piece of level geometry granting 4.3 tiles of height from wherever it stands,
which means:

- **Bots become terrain.** Routes can be gated behind a stomp, reaching ledges
  that are otherwise unreachable (see §5, bot-gated chunks).
- **Bot ladders.** Stomp → bounce → stomp chains gain height without limit.
  This is the primary traversal verb for the level 2 vertical climb.
- **Killing is movement.** The player is never choosing between fighting and
  progressing; the two are the same action.

Constraint: bot-gated routes require a kill-plane beneath them (§5) to avoid
softlocks.

**Projectiles:** slow (~90 px/s), clearly visible, object-pooled.

**Hitboxes:** the player's hitbox is slightly *smaller* than the sprite. Always
favor the player.

---

## 7. Art & rendering

- **Virtual resolution 480 × 270**, integer-scaled nearest-neighbor, letterboxed.
  `pixelArt: true`, `roundPixels: true`. Everything authored at this scale.
  Multiplies exactly to 1920×1080 (4×) and 960×540 (2×).
- **Text is a built-in 5×7 bitmap font** (`src/font.ts`), generated into a
  texture at boot. Phaser's `Text` rasterizes a system font *into* the low-res
  canvas, antialiasing small glyphs to grey mush before the whole buffer is
  magnified — no `resolution` setting recovers detail that was never in the
  buffer. A bitmap font is authored on the pixel grid, so every upscale is a
  clean integer multiply. Uppercase only, which is both the arcade look and half
  the glyph table.
  - Gotcha: `RetroFont.Parse` derives its size unit from glyph **width**, not
    height. Scale must be a multiple of `FONT_UNIT` (5) or text renders at a
    fractional scale and blurs again.
- **Ground skirt**: solid ground is extended downward past the bottom of each
  chunk, visually only. Without it the taller viewport shows empty space under
  the terrain and ground reads as floating slabs. Pits stay open because a pit
  has nothing solid on the chunk's bottom row to extend.
- **4 pastel colors total**: player, environment, hazard/bot, background. Stored
  as a swappable palette object — re-tinting per level makes levels feel distinct
  for near-zero work.
- **Three parallax layers of background platforms**, so a level reads as one
  ledge in a world full of them. Each layer is the terrain colour washed toward
  the background; farther layers are smaller, fainter, and scroll slower.
  - Depth comes from contrast and scale, **not blur** — a real blur fights the
    pixel grid and would cost a shader.
  - The nearest layer is still two-thirds of the way to the background colour.
    That gap is a gameplay constraint, not taste: nothing in the background may
    be mistakable for something you can stand on.
  - Density is tuned to ~3-5 blocks per layer on screen (`BG_AREA_PER_BLOCK`).
    The first attempt was ~3x denser and the background stopped reading as depth
    and started competing with the real terrain.
  - Shapes are generated in each layer's **own** coordinate space. A layer with
    scrollFactor `s` only ever shows world x in `[cam*s, cam*s + VIRTUAL_W]`, so
    it must span `bounds.w * s + VIRTUAL_W`. Scattering them across the full
    level bounds instead would leave the far layers nearly empty.
- **Background blobs**: distant figures hopping on those platforms, and
  sometimes missing and falling. Atmosphere — the world is full of jumpers.
  - They use the **player's hue, heavily washed** toward the background, and
    only on the two far layers. The player's colour is the one thing the eye
    tracks, so a saturated figure back there would read as another actor —
    worst right after a death, when you are scanning for yourself.
  - Tuned to ~1 on screen on average. Turn it up via `BG_BLOBS_PER_LAYER`, and
    the contrast via the `layer.mix - 0.28` in `drawBlobs`.
  - A small pool is **recycled toward the camera**, onto platforms just outside
    the view. Pinning them to random platforms put at most one on screen across
    an entire climb, because background platforms are spread over the whole
    level and almost none are ever near the player.
  - Cosmetic, but stepped at fixed dt from a seeded stream and reset on respawn,
    so the determinism invariant stays simple to state: everything replays.
- **Programmatic shapes first, sprites later.** A single-color rounded rect with
  squash-and-stretch plus a motion trail reads beautifully and needs no art.
  Pixel sheets (idle/run/jump/fall, 4–6 frames) swap in at M8. This decouples
  "is the game fun" from "do I have art."
- **Takeoff is crouch → spring → stretch**, not just stretch. The crouch
  (`jumpSquashX/Y`) is *held* for `jumpSquashTime` before releasing into the
  stretch; without the hold, the easing and the airborne-stretch rule both
  overwrite it on the same frame and it never reads. Measured: four frames at
  1.32 × 0.70, then 0.68 × 1.38 easing back to neutral.
- **The eye becomes a heart** after `HEART_STREAK` (5) consecutive jumps that
  ended in a landing rather than a death, on roughly one in 4–5 qualifying
  landings. Measured 1 in 4.9, never before the streak, and reset on death.
  - It is a **5×4** heart. A 3×3 was tried first and reads as a letter Y —
    three pixels cannot carry two lobes.
- **Expressions, in priority order.** Each uses a visually distinct number of
  marks so two states can never be mistaken for each other at 10×14 pixels:

  | State | Face | Trigger |
  |---|---|---|
  | Stressed | flat squint + sweat bead | mashing jump with nothing to spend |
  | Delighted | 5×4 heart | 5 clean landings, then ~1 in 4–5 |
  | Focused | streak + forward eye | 0.5s above 82% of top speed, one direction |
  | Thinking | "..." rising off the head | standing still for 5s |
  | Nervous | **two** wide eyes + 1px shiver | within 170px of a spot that killed them 3× |
  | Default | single 2×2 dot | — |

  Exactly one is ever active. `currentFace()` resolves the winner, and the eye,
  the thought dots, the sweat bead and the shiver all hang off that one value,
  so two can never appear at once — by construction rather than by discipline.

  **Nervous is last on purpose.** It is true of a whole *region*, while every
  other state is true of a *moment*, and a moment says more about what the
  player is doing right now. So sprinting through a feared gap shows focus, and
  stopping to think in one shows thinking; the wide eyes appear only when
  nothing else is happening.

  The nervous threshold matches where assistance begins, so the face and the
  help agree: the player looks worried at exactly the gap the game has decided
  to ease. Its radius is slightly wider, so the nerves arrive first.

  The shiver is applied to the drawn position only — physics never sees it.
- **The eye shifts to a focused look while sprinting** — a motion streak
  trailing a forward-set eye, mirrored to the direction of travel. It engages
  only after `FOCUS_AFTER` (0.5s) above `FOCUS_SPEED_FRAC` (82%) of top speed in
  one unbroken direction, so a tap or a shuffle never triggers it.
  - Airborne still counts. A jump taken mid-sprint is part of the same
    continuous movement, and dropping the look on every jump would make the
    face flicker.
  - Measured: engages after 0.58s of running (0.12s of acceleration plus the
    threshold), drops 83ms after release, resets instantly on a turn, survives
    a jump mid-sprint, and a 0.2s tap never trips it.
  - Deliberately unlike the stress squint — a streak-plus-eye versus a flat
    line — so the two never read as the same expression.
- **The eye squints and a sweat bead appears** when the player is mashing jump.
  Stress and delight are mutually exclusive; triggering stress clears the heart.

  Detecting it honestly is the whole problem. Counting raw presses flags a
  normal jump-then-double-jump as panic. The real signal is a press that
  **produced no jump**, which is two distinct cases:

  1. the buffer window expired without anything firing, and
  2. a press arrived while a previous press was still unresolved.

  Case 2 is not optional. Mashing continuously *refreshes* the 120ms buffer, so
  it never expires — with only case 1, fast mashing registers as nothing at all,
  which is exactly backwards. Measured before adding it: 0 detections while
  mashing.

  Wasted presses accumulate into `stressScore` and decay over `STRESS_DECAY`, so
  it measures a burst rather than a lifetime total. Verified:

  | scenario | wasted | stressed |
  |---|---|---|
  | jump + double jump, repeated | 0 | no |
  | skilled jump-buffering (15/15 buffered jumps fired) | 0 | no |
  | mashing mid-air, out of jumps | 7 | yes, after 4 |
- **Tufflings.** The player picks a character, a *Tuffling*, from the title
  screen; Mochi is the default. Four ship: Mochi (two button eyes), Button
  (one shiny eye), Pepper (one big eye with a lid) and Hugsy (the original
  block). All share the 10×14 hitbox. How they look lives in
  `src/tufflings.ts`, how they move in `src/abilities.ts`, and the choice is
  saved per browser.
  - Plush bodies are lit from the top-left with a shaded base and carry blush
    on content moods, which drains when stressed or nervous.
  - Six more faces on top of the six above, slotted into the same one-face
    precedence: **ouch** (head bonk), **dizzy** (respawning within 8s of the
    previous death), **proud** (a stomp), **starry** (the exit portal on
    screen), **sleepy** (12s idle). Order: ouch › stressed › dizzy › proud ›
    delighted › starry › focused › sleepy › thinking › nervous › default.
  - Two layers that are not moods: a blink every few seconds, and a gaze that
    follows a jump up and a fall down. They touch only the resting faces, so
    they never fight the one-face rule.
  - Hugsy adds three climbing faces above all of those while it clings:
    **climb** on a wall, **hang** from a ceiling, and **strain** (squint,
    sweat, shiver) once grip drops below 0.8s.
- **Tuffling abilities.** The rule: **every Tuffling can finish every level.**
  Abilities only open shortcuts and change the ride, so every strength has a
  cost, and nothing that decides fairness differs — the hitbox, coyote time,
  the jump buffer and corner correction stay in `TUNING` for all four.

  | | run px/s | jump (tiles) | double (tiles) | other |
  |---|---|---|---|---|
  | Mochi | 140 | 3.50 | 5.81 | — the reference; its numbers are TUNING's |
  | Button | 125 | 4.07 | 6.75 | falls at 560 px/s² (vs 914), max fall 250 |
  | Pepper | 180 | 3.18 | 5.32 | accelerates faster, slides further stopping |
  | Hugsy | 110 | 2.98 | 4.71 | clings to walls and ceilings |

  - **Hugsy's grip.** Walls: grabbed only when pushing *into* one near the top
    of a jump or falling (rising faster than 80 px/s it carries on up, so a
    hop onto a step doesn't snag on its side). Toward climbs (55 px/s), away
    slides (80 px/s), neither hangs. Ceilings: grabbed automatically instead
    of the bonk; left/right shimmy (55 px/s), stopping while still half under
    the edge. Climbing past the top of a wall hops you onto it. Jump lets go
    and simply drops. Grip is 2.5s, drained 1.8× faster while moving,
    refilled by landing or a stomp; clinging never refreshes the double jump.
  - **Sounds.** Wall grab: a soft thump. Ceiling grab: "woo-hoo!" Grip running
    out: the d'oh. Letting go on purpose: silent.
  - **Checked, not assumed.** The editor's finishability search runs once per
    Tuffling with its own physics, and the six real levels were checked the
    same way. That check is what found the flyer ladders (`v_botladder`,
    `d_botgate`) too far apart for Hugsy — four rows, tuned for Mochi only —
    now three.
- **Trophies.** One per level, purely to find and show off on the title
  screen's **Trophies** shelf. Chunks mark candidate spots with `C`; each
  level uses the one nearest 60% of the way through, chosen from the layout
  alone so it never draws from, or disturbs, the level's RNG. Found trophies
  are kept the moment they're touched; afterwards the spot shows a faint
  outline. Every trophy was checked reachable by every Tuffling.
- Player: ~10 × 14 px hitbox; tufflings draw 10–12 wide.

---

## 8. Mobile

Designed touch-first from day one, not retrofitted.

- **Lock landscape** on all levels. A vertical level suits portrait, but rotating
  the device between levels is bad UX; landscape gives level 1 its look-ahead.
- Left/right zones bottom-left, jump bottom-right. Invisible hit areas extend
  well past the visible buttons. Multitouch required. Keyboard supported in
  parallel for desktop.
- Safe-area insets (notches), disable pinch-zoom and pull-to-refresh, pause on
  app-background.
- Perf: pool everything, cull off-screen, zero allocation in the update loop.

**Shipping gate:** iOS needs a Mac + Xcode + $99/yr Apple account. Android needs
Android Studio + $25 one-time. No code depends on this.

---

## 9. Milestones

| # | Deliverable | Notes |
|---|---|---|
| M0 ✅ | Vite + Phaser + TS scaffold, fixed-timestep loop, 384×216 pipeline, seeded RNG, palette | Foundations. Determinism in from the start. |
| M1 ✅ | Player controller on a static hand-made level. All four forgiveness mechanics. Debug overlay: hitboxes, velocity, live constants. | **Go/no-go.** If jumping isn't fun here, nothing downstream saves it. |
| M2 ✅ | Chunk grammar + Director + level 1 horizontal, seeded, deterministic | First real gameplay |
| M3 ✅ | Turret + walker bots, projectiles, stomp kill, death + instant restart | Now it's a game |
| M4 ✅ | Level completion, HUD, progress meter, transitions. **Measure real playtime, confirm level length.** | Loop closes |
| M5 ✅ | Vertical (L2) + diagonal (L3) directors | Proves the progress-vector abstraction |
| M6 ⬜ | Juice: particles, screenshake, hit-stop, SFX, music | Where "fine" becomes "fun" |
| M7 ⬜ | Touch controls + Capacitor + real device testing | Ship target |
| M8 ⬜ | Pixel-art sprites, save data, level select, polish | Finish |

---

## 10. Open questions

- Level length under one-hit death: 60–90s may be long (Super Meat Boy runs
  20–40s). Ramping 45s → 90s; re-measure at M4 with a controller in hand.
- Scoring / time-attack layer? Not planned. Determinism makes leaderboards and
  ghost replays cheap to add later if wanted.
- Audio: death and double jump so far. It is **synthesised at runtime**
  (`audio.ts`) rather than loaded, so the single-file build stays a single file
  and there is nothing that can fail to load. A soft square gliding down two
  octaves with a noise puff on the front — deflating rather than scolding,
  since you are retrying half a second later.
  - The AudioContext is created lazily and resumed from a real input event,
    because browsers refuse to start audio outside a user gesture.
  - Everything degrades to silence rather than throwing; verified that a
    simulated Web Audio failure neither propagates nor stops the game.
  - `M` mutes, persisted. Muted creates no audio nodes at all rather than
    zeroing a gain.
  - The **double jump** gets a 0.1s rising blip at well under half the death
    sound's volume. It earns one more than most actions: everything else lands
    on something and the contact sells itself, while the double jump happens in
    mid-air with nothing to hit, so audio is the clearest confirmation it fired
    rather than being eaten. It also repeats constantly, hence the restraint.
  - **Background music** (`music.ts`): a light, chirpy music-box score, one
    theme for the title and one per level. Plucky notes (fast attack, short
    decay), major pentatonic only, a steady bass with offbeat chord stabs, the
    melody up an octave, and an open filter.
    - **The first attempt was ambient and came out creepy**, which is worth
      recording because the failure was systematic rather than bad luck. Slow
      sustained low drones, long attacks, minor modes, sparse irregular chimes
      and heavy low-pass filtering are between them an almost exact recipe for
      horror ambience. Every one of those was chosen to be *unobtrusive*, and
      together they produced dread. Optimising against attention turns out to
      be a short walk from optimising for unease.
    - So the rewrite inverts each of them, and accepts a repeating phrase:
      catchy beats eerie.
    - Verified by rendering every theme through an `OfflineAudioContext` and
      measuring the samples, since the character claim is the whole point:

      | | ambient (creepy) | music box |
      |---|---|---|
      | crest factor | 3.3 | **10–12** (transients, not drone) |
      | zero-crossing rate | low | **1400–2700/s** (bright) |
      | audible fraction | 0.94 (continuous) | **0.18–0.25** (notes with space) |

    - Peaks sit within 10% of each other and under the 0.16 sound-effect peak.
      Square-wave themes are trimmed to 0.72, since a square carries far more
      harmonic energy than a triangle and reads louder and harsher at equal
      amplitude — untrimmed they were 1.25x the others.
  - **Head bonk**: a small comedic d'oh, plus a few chips off the ceiling. A
    sawtooth swept through a narrow bandpass is what makes it read as a voice
    rather than a beep -- the moving filter peak imitates a vowel formant
    sliding down, which is most of what a d'oh actually is. Pitch and filter
    fall together so it lands like a shrug.
    - Only fires above `BONK_SPEED` (55 px/s upward). Below that the contact
      is a graze, usually corner correction nearly saving a jump, and calling
      that out would be noise. Verified: zero false positives across repeated
      open-air jumping, and exactly one event on a real ceiling.
    - Rate-limited to one per 0.22s. A player wedged under a ledge can touch
      it on consecutive frames, and a stutter of d'ohs stops being funny
      immediately. Verified: twelve calls in one instant produce one sound.
  - Still open: stomp and level-complete sounds.
