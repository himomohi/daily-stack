# Daily Stack spec (shared by all coding tasks)

Seated, hands-first mixed reality puzzle (Meta VR Start 2026, Gaming track). Every day a seeded blueprint
appears as a translucent ghost on a small board in front of the user; the user pinches/grabs blocks from a
tray and places them to rebuild it. Streak + best time in localStorage. Everything reachable within ~0.6 m.

## IWSDK facts (v1.1.0, verified from docs and node_modules/@iwsdk/core/dist)
- Import EVERYTHING three.js from '@iwsdk/core' (it re-exports Three: Mesh, BoxGeometry, MeshStandardMaterial,
  Group, Vector3, Quaternion, Euler, CanvasTexture, PlaneGeometry, Color, etc.). Never import 'three'.
- World is created in src/index.ts with `World.create(container, projectOptions)` where projectOptions comes from
  `import projectOptions from 'virtual:iwsdk-project'`. Config lives in iwsdk.config.json (mode "ar",
  handTracking true, grabbing true). Then `world.registerSystem(MySystem)`.
- Entities: `const e = world.createTransformEntity(object3D)` (optionally `(obj, parentEntity)`), `e.object3D`,
  `e.addComponent(C, {fields})`, `e.hasComponent(C)`, `e.dispose()` (never destroy()).
- Systems: `class S extends createSystem({ q: { required: [A], excluded: [B] } }) { init(){} update(dt, t){} }`
  `this.queries.q.entities`, `this.queries.q.subscribe('qualify'|'disqualify', (e)=>{})`, `this.world`,
  `this.player.head` (Object3D, use getWorldPosition), `this.cleanupFuncs.push(fn)`.
  To share state between systems use a plain module-level singleton (src/state.ts), not ECS globals.
- Grabbing: `OneHandGrabbable` {rotate, translate, rotateMin/Max, translateMin/Max} proximity grab; hand pinch
  grabs because GrabSystem.useHandPinchForGrab defaults to true. `TwoHandsGrabbable` {rotate, translate, scale,...}.
  `DistanceGrabbable` is ray based. Add `RayInteractable` too so desktop mouse/IWER can pick it.
  `Grabbed` is a transient tag set while held: query { required:[Block, Grabbed] } and use 'disqualify' to detect release.
  Do not add/remove Grabbed yourself.
- Buttons: add `PokeInteractable` (finger poke) AND `RayInteractable` (pinch-ray / mouse) to a mesh entity;
  `Pressed` and `Hovered` are transient tags. Detect a press with query {required:[Button, Pressed]} 'qualify'.
- Custom components: `createComponent('Name', { field: { type: Types.Int32, default: 0 } })` declared in a
  system-free module (src/game-components.ts) and listed in src/components.ts `defineComponents([...])`.
  Read with entity.getValue(C,'field'), write with entity.setValue(C,'field',v) (scalars only).
- `world.visibilityState` signal (VisibilityState.NonImmersive / Visible). `world.launchXR()`, `world.exitXR()`,
  `world.xrEnabled`.
- No allocations inside update loops (reuse Vector3 temps). Target 72 fps on Quest 3: low poly, shared materials,
  no shadows from small blocks, no postprocessing.

## Module contracts (keep these exact exports)
src/blueprint.ts (pure TS, no IWSDK import):
- `export const GRID = 4` (board is 4 x 4 cells), `export const MAX_LEVELS = 4`
- `export const PALETTE: number[]` 5 friendly colors (hex numbers, color-blind friendly: blue, orange, yellow, teal, pink)
- `export type Kind = 'cube' | 'bar'` (cube = 1 cell, bar = 2 cells long along local X)
- `export interface Piece { id: number; kind: Kind; x: number; y: number; z: number; rot: 0 | 1; color: number }`
  (x,z = grid cell of the piece origin 0..GRID-1, y = level 0..; rot 1 means bar runs along +Z instead of +X)
- `export function pieceCells(p: Pick<Piece,'kind'|'x'|'y'|'z'|'rot'>): [number,number,number][]`
- `export interface Blueprint { dateKey: string; seed: number; pieces: Piece[] }`
- `export function todayKey(d?: Date): string` local YYYY-MM-DD
- `export function mulberry32(seed: number): () => number`, `export function hashString(s: string): number`
- `export function generateBlueprint(dateKey: string): Blueprint` deterministic, 6 to 8 pieces (2 to 3 bars),
  every cell inside the grid, no overlaps, every piece with y>0 fully supported (each of its cells has a cell
  directly below), max height 3 levels, a nice tower-ish shape. Same date -> same blueprint.
src/streak.ts (pure TS + localStorage, key 'daily-stack-v1', safe if localStorage throws):
- `export interface StreakState { streak: number; bestStreak: number; lastWinDate: string | null; totalWins: number; bestTimes: Record<string, number> }`
- `export function loadStreak(): StreakState`
- `export function recordWin(dateKey: string, timeMs: number): StreakState & { isNewBest: boolean; alreadyWonToday: boolean }`
  (streak +1 if lastWinDate is the day before dateKey, unchanged if same day, else reset to 1)
- `export function hasWonToday(dateKey: string): boolean`
src/audio.ts (WebAudio synthesized sounds only, no audio files, lazy AudioContext created/resumed on first call,
master gain 0.2, every function safe to call before user gesture):
- `export const sfx: { pickup(): void; snap(): void; invalid(): void; click(): void; win(): void; step(): void }`
src/state.ts: `export const game = { blueprint, startTime: number | null, solved: boolean, tutorialStep: number, ... }`
  plus a tiny event emitter `export const bus = { on(evt, fn), emit(evt, payload) }` with events
  'placed', 'solved', 'reset', 'hint', 'recenter', 'tutorial-advance'.

## Layout (meters, world space, local-floor reference)
- Board root Group "boardRoot": positioned on XR start / recenter at head position + forward 0.42 m, y = head y - 0.40
  (clamped to 0.6..1.3), yaw facing the user. Desktop (non XR) default: (0, 1.05, -0.45).
- Cell size 0.06 m, block size 0.056 m (cube) and 0.116 x 0.056 x 0.056 (bar). Board plate 4x4 cells, thin slab 0.012 m, soft
  light gray with subtle grid lines. Ghost blueprint cells: same color as their target piece, opacity 0.22, depthWrite false.
- Tray: blocks start in a row 0.14 m in front of the board edge (closer to the user), slightly left/right spread, within reach.
- UI panel: 0.30 m above and slightly behind the board, tilted 15 degrees toward the user, inside a 40 degree FoV cone.
