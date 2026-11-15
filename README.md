# Daily Stack

A seated, hands-first mixed reality puzzle for Meta Quest 3 / 3S. Every day a new blueprint appears as a glowing ghost tower on a small board in front of you. Pinch the blocks from the tray, drop them onto the board, and rebuild today's tower. Come back tomorrow to keep your streak alive.

Built for the Meta VR Start Developer Competition 2026 (Gaming track, New Experience division).

Play: https://daily-stack-xr.vercel.app (open in the Meta Quest Browser and tap "Enter mixed reality")

## How to play

1. Sit down. The board appears about 40 cm in front of you, just below eye level, on top of your real room (passthrough).
2. Pinch a block in the tray (thumb and index finger) and move it over the board.
3. Let go above a glowing spot. The block snaps to the grid and drops to the lowest free level.
4. Bars can be turned: rotate your wrist while holding, or hold with two hands and turn.
5. Fill every ghost cell with a block of the same color to finish the tower.

Buttons in front of the board are poked with a fingertip (or pinched from a distance):

- Hint: pulses one ghost piece you still need.
- Reset: sends every block back to the tray and restarts the timer.
- Recenter: moves the board in front of your current head position.

No controllers are needed at any point, including the first-run tutorial. Controllers still work if you prefer them.

## Daily puzzle and streak

- The blueprint is generated from today's date with a seeded random generator, so everyone gets the same tower on the same day.
- 6 to 8 pieces (cubes and two-cell bars), up to 3 levels, every piece supported.
- Your streak, best streak, total wins and best time per day are stored only in your browser (localStorage). No account, no server.

## Design notes

- Seated, 2 ft radius: everything (board, tray, buttons, status panel) is within about 0.6 m and inside a narrow field of view.
- Passthrough with purpose: the session requests `immersive-ar`, so the puzzle sits on your real desk.
- 3-step hand-shown tutorial on first launch (pinch, drop, turn), skippable, never shown again after completion.
- Sounds are synthesized at runtime with the Web Audio API. No audio files, no music.
- Performance: shared geometries and materials, no shadows on small blocks, canvas UI redrawn at most 4 times per second, no allocations in update loops. Target 72 fps on Quest 3.

## Tech

- [Immersive Web SDK (IWSDK)](https://github.com/facebook/immersive-web-sdk) 1.1 on three.js, TypeScript, Vite
- WebXR hand tracking, `OneHandGrabbable` / `TwoHandsGrabbable` grabbing with hand pinch, `PokeInteractable` buttons
- Tested with IWER (the IWSDK WebXR emulator, Meta Quest 3 profile, hand input mode)
- Static hosting on Vercel

## Run locally

```bash
npm install
npm run dev        # IWSDK dev server with the IWER emulator
npm run build      # static build in dist/
npm run preview
```

Requires Node.js 20.19+.

## Project layout

- `src/blueprint.ts` daily seeded blueprint generator
- `src/board.ts` board, grid, ghost tower, placement in front of the user
- `src/blocks.ts` grabbable blocks, snap to grid, tray
- `src/check.ts` solve check and win
- `src/ui.ts` status panel, poke buttons, win card and particles
- `src/tutorial.ts` 3-step hand tutorial
- `src/streak.ts` localStorage streak and best times
- `src/audio.ts` synthesized sound effects
- `FEATURE-MAP.md` and `features/` feature docs

## License

MIT, see [LICENSE](LICENSE). The project was started from the official IWSDK starter template (MIT).
