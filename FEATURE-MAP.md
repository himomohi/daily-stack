# Daily Stack feature map

Each feature has a doc in `features/`. Status reflects checks run on 2026-11-15 in IWER (IWSDK Quest 3 emulator, hand input) and on the production build.

| Feature | Doc | Code | Verified |
| --- | --- | --- | --- |
| Landing card and XR entry | features/landing.md | index.html, src/index.ts | Production build loads with no console errors; Bombadil run, no violations after fix |
| Board placement in front of a seated user | features/board.md | src/board.ts | IWER: board placed 0.5 m ahead, 0.4 m below head |
| Daily seeded blueprint and ghost | features/blueprint.md | src/blueprint.ts, src/board.ts | Same tower for same date; 425 date keys validated |
| Hand grab and snap to grid | features/grab-snap.md | src/blocks.ts | IWER hand pinch: 8 of 8 pieces placed |
| Solve check and win card | features/win.md | src/check.ts, src/ui.ts | IWER: "Tower complete!" shown with time |
| Poke buttons (Hint, Reset, Recenter) | features/buttons.md | src/ui.ts | IWER fingertip press on Reset and Hint |
| First-run hand tutorial | features/tutorial.md | src/tutorial.ts | IWER: step cards advance on grab and place |
| Streak and best time | features/streak.md | src/streak.ts | Unit-style checks in the coding run (12 cases) |
| Sound | features/audio.md | src/audio.ts | Synthesized, no files |
