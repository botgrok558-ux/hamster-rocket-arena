# Hamster Rocket Arena (test version)

A simple top-down survival shooter starring the Hamster Rocket hamster: endless cat hordes come at you from all sides, and you survive as long as you can. This is a separate test site; it may become a mode of the main Hamster Rocket demo later.

**Just a game for fun. No prizes, no rewards, no tokens to win.**

Play: https://botgrok558-ux.github.io/hamster-rocket-arena/

## Controls (manual aiming, no auto-fire)
- **Mobile:** left thumb is a floating stick to move. Right thumb is a floating stick to aim; it fires while you push it.
- **PC:** WASD / arrow keys to move, mouse to aim, click or hold to shoot (Space also shoots). P / Esc pauses, M toggles sound, Enter starts / plays again, 1 / 2 / 3 picks an upgrade card.
- The game pauses automatically when the tab is hidden.

## Arena
2400 × 2400 world units, much bigger than the screen. The camera follows the hamster and stops at the walls.

## Enemies (they just walk toward you)
- **Cat drone:** the basic enemy, most of the horde.
- **Fast kitten:** small and quick. Shows up after 40 s.
- **Big vacuum bot:** slow and tanky, drops 5 seeds. Shows up after 75 s.
- **Giant robo-cat (boss):** every 3 minutes. Big and slow, just walks at you (no bullets). Drops a pile of seeds and a heart.
- A "horde" ring of cats surrounds you every minute. Spawn rate, enemy count, HP and speed slowly ramp up over time.

## Progression
Defeated enemies drop sunflower seeds (XP). On level-up the game pauses and offers 3 random upgrade cards:
damage (+25%), fire rate (faster), multishot (+1 seed), move speed (+10%), max HP (+20, heals 20), pierce (+1 enemy).
Hearts occasionally drop and heal 25 HP.

## Scoring
Survival time (big timer) and kill counter. Game over shows time survived and kills; the best time and best kills are stored locally in `localStorage` (`hra_bestTime`, `hra_bestKills`).

## Debug
`?t=SECONDS` starts with the difficulty of that moment (e.g. `?t=300` for a big horde), `?boss=1` spawns the boss right away. Debug runs never overwrite the best.

## Code
- `arena.js`: self-contained game module (simulation, Canvas 2D rendering, camera, touch/mouse/keyboard input, WebAudio synth sounds). No dependencies.
  `HamsterArena.create({ canvas, assetBase, t, storagePrefix, onEvent })` returns `{ start({t0, boss, record}), choose(upgradeId), pause(), resume(), toggleMute(), state, best() }`.
  Events: `state`, `levelup` (3 choices), `gameover` (time, kills, best), `boss`, `mute`.
- `main.js`: page UI (overlays, upgrade cards, share on X).
- `i18n.js`: DE / EN / FR (browser auto-detect, choice remembered).
- `assets/`: art and fonts copied from the main demo.

No external requests, no CDN libraries, no tracking.
