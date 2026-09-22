# Context

The big picture, for anyone (or any session) picking this project up cold.
[README.md](README.md) is how to run and play it, [DESIGN.md](DESIGN.md) is
why it works the way it does, and [INFO.md](INFO.md) is the working notes:
invariants, traps and how to verify. This page is **what the game is, who's in
it, and how work on it happens.**

---

## What Foothold is

A small, cute, pastel 2D platformer that runs in the browser. Six levels in
three directions — run right, climb up, go diagonally — built from hand-made
ASCII chunks and regenerated identically from a fixed seed, so a level can be
learned. One-hit deaths with an instant retry, and quiet help at spots where
you keep dying.

**The hook:** stomping a bot kills it, bounces you, and refreshes your double
jump. Bots aren't just obstacles, they're rungs. Tagline: *"The things trying
to kill you are also the only way up."*

It ships as one self-contained ~1.3 MB HTML file (`npm run build:single` →
`dist-single/foothold.html`): no art, sound or font files, everything is
generated in code.

**Names.** The game was called *Stepladder*, then renamed **Foothold**. The
GitHub repo is still `krishnasHub/Stepladder` on purpose, the folder is
`simple-jumper`, and some storage keys keep old names so saves survive.

---

## The Tufflings

The playable characters are **Tufflings** (one *Tuffling*) — cute but tough,
plush-looking, and never meant to resemble a real animal. The eyes do all the
talking: each has a set of faces (delighted, stressed, nervous, focused,
thinking, sleepy, proud, ouch, dizzy, starry…), and exactly one shows at a
time.

| Tuffling | Looks | Plays |
|---|---|---|
| **Mochi** (default) | two button eyes, low and wide | the all-rounder; the reference tuning |
| **Button** | one shiny button eye | light: jumps highest, floats down, a bit slower |
| **Pepper** | one big eye with a lid | zippy: fastest, shorter jump, slides when stopping |
| **Hugsy** | the original flat block | the climber: slowest, lowest jumps, clings to walls and ceilings |

The rule behind them: **every level is finishable by every Tuffling**; their
differences only open shortcuts and change the ride. Pick one on the
**Tufflings** screen; the pick is saved per browser.

**Hugsy** clings by moving *into* a wall (toward = climb, away = slide down),
grabs ceilings automatically and shimmies along them, and lets go with jump.
Grip drains while clinging and refills on landing or a stomp. Sounds: a soft
thump on a wall, "woo-hoo!" on a ceiling, "d'oh" when grip runs out.

---

## What's in the game

- **Six levels:** Ground Floor, The Climb, Ascent, Long Haul, High Rise, Summit.
- **Exit portal** you squeeze into at the end of each level.
- **Trophies:** one per level, tucked away, purely to show off on the
  **Trophies** shelf (Lost Button, Tiny Crown, Star Sticker, Odd Sock, Heart
  Balloon, Golden Acorn). No gameplay value, kept once found.
- **Title screen:** your Tuffling beside the title; the others small on ledges
  at the sides, doing their own thing. Switching picks hops them into place.
- **Music and sound,** all synthesised: a chirpy music-box theme per level.
- **Level editor** (dev only, `http://localhost:5199/editor.html`): paint
  platforms, spikes, turrets, start, portal and a trophy; pick a palette;
  **Play as** any Tuffling; and a background check that plays the level with
  the game's own physics to prove each Tuffling can finish it (and reach the
  trophy), drawing the route. Levels save in the browser; **Export** to JSON.
- **`custom-levels/`:** exported editor levels that are playable but not
  shipped. Nothing there is loaded by the game.

---

## How the pieces fit

```
tuning.ts      shared feel numbers (fairness)       abilities.ts   per-Tuffling movement
chunks.ts      ASCII chunk library + validator      tufflings.ts   bodies, faces, drawing
world.ts       stitch chunks -> a level; editor levels -> a level
player.ts      the controller (and Hugsy's clinging)
entities.ts    turret / walker / flyer bots           trophies.ts   the six trophies
scenes/        Boot, Menu (title), Tufflings, Trophies, Game
editor/        editor page, solver (finishability search), worker
customLevels.ts  editor level format, checks, storage
```

---

## How we work

- **Nothing is committed or pushed until the user says so.** Work is
  experimental until it's been tried; changes stay in the working tree, and a
  commit happens on an explicit "commit and push".
- **Verify, don't assume.** Changes get checked by driving the real
  simulation, by the solver, and by looking in the browser — and the result is
  reported as it is, including failures.
- **Discuss design before building** when there's a real choice to make;
  present options with a recommendation.
- **Test without touching the user's data.** Back up and restore saved picks,
  trophies and progress around browser testing.
- The user plays the game and gives feedback on feel and look ("too cluttered",
  "make it cuter"); small, visible iterations work well.

---

## Where it stands

Everything described above works and is pushed. The loose ends, in order of
likely interest, are in [INFO.md § Open work](INFO.md#6-open-work): Hugsy on
the user's custom level, trophies that need a specific Tuffling's shortcut,
level 1 never showing a bot, a stomp sound, and a hosted link to share.

**Ideas raised but not started:** Tuffling-specific faces for abilities beyond
Hugsy's, per-Tuffling best times, checking whether a level is *comfortable*
(not just possible) for each Tuffling, moving finished custom levels into the
shipped game, pixel-art sprites, and mobile packaging.

**Naming notes.** "Tufflings" was picked from a shortlist (Footlings,
Hopplings, Snuglets, Plumplings, Tufflings); it's invented, which is good for
avoiding trademark clashes, but still worth a trademark search before any
public release. Avoid "Puffkins" (a real toy brand), anything "-mallow", and
"Velcro".
