# Hamster Rocket Arena (test version)

A small single-screen 2D arena shooter starring the Hamster Rocket hamster. Separate test site; it may become a mode of the main Hamster Rocket demo later.

**Just a game for fun. No prizes, no rewards, no tokens to win.**

Play: https://botgrok558-ux.github.io/hamster-rocket-arena/

## Controls
- **Mobile:** left thumb = floating joystick to move. Auto-aim + auto-fire at the nearest enemy. Optional: right thumb = aim stick (fires where you point).
- **PC:** WASD / arrow keys to move, mouse to aim, click or hold to shoot (Space also shoots). P / Esc = pause, M = sound on/off, Enter = start / play again.
- The game pauses automatically when the tab is hidden.

## Enemies
- **Cat drone:** fast, chases you. Shows up from wave 1.
- **Vacuum bot:** slow and tanky, sucks you in when you get close. From wave 2.
- **Mouse-trap mine:** stays put, arms after landing, explodes when you get close (shoot it from a distance; the blast also hurts nearby enemies). From wave 3.
- **Giant robo-cat (boss):** every 5th wave. Yarn-ball rings, aimed bursts, summons cat drones, charge attack, gets angrier below 50% HP.

## Power-ups
Triple shot (10 s), rapid fire (8 s), shield (7 s, blocks all damage and vacuum pull), heal (+35 HP). One spawns at the start of each wave from wave 2 on; enemies can drop more.

## Scoring
Points per kill × combo multiplier (×2 at 4 quick kills in a row, up to ×5), plus a wave-clear bonus. The best score and most waves survived are stored locally in `localStorage` (`hra_best`, `hra_bestWave`).

## Debug
`?wave=N` starts at wave N (e.g. `?wave=5` for the boss). Debug runs never overwrite the best score.

## Code
- `arena.js`: self-contained game module (simulation, Canvas 2D rendering, touch/mouse/keyboard input, WebAudio synth sounds). No dependencies.
  `HamsterArena.create({ canvas, assetBase, t, storagePrefix, onEvent })` returns `{ start(wave, {record}), pause(), resume(), toggleMute(), state, best() }`.
- `main.js`: page UI (overlays, buttons, share on X).
- `i18n.js`: DE / EN / FR (browser auto-detect, choice remembered).
- `assets/`: art and fonts copied from the main demo.

No external requests, no CDN libraries, no tracking.
