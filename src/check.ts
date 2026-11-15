import { createSystem } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { GRID, MAX_LEVELS, pieceCells } from './blueprint.js';
import type { Kind } from './blueprint.js';
import { paletteIndex } from './board.js';
import { Block } from './game-components.js';
import { bus, game } from './state.js';
import { recordWin } from './streak.js';
import { sfx } from './audio.js';

const CELL_COUNT = GRID * GRID * MAX_LEVELS;
const targetKeys: number[] = [];
const targetColors: number[] = [];
const targetKinds: number[] = [];
const targetUsed = new Uint8Array(64);
let targetCellCount = 0;
let preparedDateKey = '';
let preparedSeed = Number.NaN;

function cellIndex(x: number, y: number, z: number): number {
  return y * GRID * GRID + z * GRID + x;
}

function keyForCells(cells: [number, number, number][]): number {
  if (cells.length === 0) return -1;
  const first = cellIndex(cells[0][0], cells[0][1], cells[0][2]);
  if (cells.length === 1) return first * CELL_COUNT + first;
  const second = cellIndex(cells[1][0], cells[1][1], cells[1][2]);
  return first < second ? first * CELL_COUNT + second : second * CELL_COUNT + first;
}

function prepareTargets(): void {
  const blueprint = game.blueprint;
  if (preparedDateKey === blueprint.dateKey && preparedSeed === blueprint.seed) return;
  preparedDateKey = blueprint.dateKey;
  preparedSeed = blueprint.seed;
  targetKeys.length = 0;
  targetColors.length = 0;
  targetKinds.length = 0;
  targetCellCount = 0;
  for (const piece of blueprint.pieces) {
    const cells = pieceCells(piece);
    targetKeys.push(keyForCells(cells));
    targetColors.push(paletteIndex(piece.color));
    targetKinds.push(piece.kind === 'bar' ? 1 : 0);
    targetCellCount += cells.length;
  }
}

export function isSolved(entities: Iterable<Entity>): boolean {
  prepareTargets();
  if (targetKeys.length === 0) return false;
  targetUsed.fill(0);
  let filled = 0;

  for (const entity of entities) {
    if (entity.getValue(Block, 'placed') !== true) continue;
    const kind: Kind = entity.getValue(Block, 'kind') === 1 ? 'bar' : 'cube';
    const color = entity.getValue(Block, 'color') ?? -1;
    const x = entity.getValue(Block, 'gx') ?? -1;
    const y = entity.getValue(Block, 'gy') ?? -1;
    const z = entity.getValue(Block, 'gz') ?? -1;
    const rot: 0 | 1 = entity.getValue(Block, 'rot') === 1 ? 1 : 0;
    const cells = pieceCells({ kind, x, y, z, rot });
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      if (
        cell[0] < 0 ||
        cell[0] >= GRID ||
        cell[1] < 0 ||
        cell[1] >= MAX_LEVELS ||
        cell[2] < 0 ||
        cell[2] >= GRID
      ) {
        return false;
      }
    }
    const key = keyForCells(cells);
    const blockKind = kind === 'bar' ? 1 : 0;
    let matched = -1;
    for (let t = 0; t < targetKeys.length; t += 1) {
      if (
        targetKeys[t] === key &&
        targetColors[t] === color &&
        targetKinds[t] === blockKind &&
        targetUsed[t] === 0
      ) {
        matched = t;
        break;
      }
    }
    if (matched < 0) return false;
    targetUsed[matched] = 1;
    filled += cells.length;
  }

  return filled === targetCellCount;
}

export class CheckSystem extends createSystem({
  blocks: { required: [Block] },
}) {
  private completed = false;

  init(): void {
    const offPlaced = bus.on('placed', () => {
      this.evaluate();
    });
    if (typeof offPlaced === 'function') this.cleanupFuncs.push(offPlaced);
    const offGrab = bus.on('grab', () => {
      if (game.startTime === null) game.startTime = performance.now();
    });
    if (typeof offGrab === 'function') this.cleanupFuncs.push(offGrab);
    const offReset = bus.on('reset', () => {
      this.completed = false;
      game.solved = false;
      game.startTime = null;
    });
    if (typeof offReset === 'function') this.cleanupFuncs.push(offReset);
  }

  private evaluate(): void {
    if (this.completed) return;
    if (!isSolved(this.queries.blocks.entities)) return;
    this.completed = true;
    game.solved = true;
    const started = game.startTime;
    const timeMs = started === null ? 0 : Math.max(0, Math.round(performance.now() - started));
    const streak = recordWin(game.blueprint.dateKey, timeMs);
    sfx.win();
    bus.emit('solved', { timeMs, streak });
  }
}
