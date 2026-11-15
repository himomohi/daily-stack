import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  VisibilityState,
  createSystem,
} from '@iwsdk/core';
import type { Entity, World } from '@iwsdk/core';
import { GRID, PALETTE, pieceCells } from './blueprint.js';
import type { Piece } from './blueprint.js';
import { bus, game } from './state.js';

export const CELL = 0.06;
export const BLOCK = 0.056;
export const BAR_LENGTH = 0.116;
export const PLATE_THICKNESS = 0.012;
export const BOARD_HALF = (GRID * CELL) / 2;
export const TRAY_Z = BOARD_HALF + 0.13;

export function paletteIndex(color: number): number {
  for (let i = 0; i < PALETTE.length; i += 1) {
    if (PALETTE[i] === color) return i;
  }
  return color >= 0 && color < PALETTE.length ? color : 0;
}

export function paletteColor(color: number): number {
  if (color >= 0 && color < PALETTE.length) return PALETTE[color] ?? 0xffffff;
  return color;
}

const DESKTOP_X = 0;
const DESKTOP_Y = 1.05;
const DESKTOP_Z = -0.45;
const HEAD_FORWARD = 0.5;
const HEAD_DROP = 0.4;
const MIN_BOARD_Y = 0.6;
const MAX_BOARD_Y = 1.3;
const GHOST_SIZE = CELL * 0.99;
const GHOST_LIFT = 0.0015;
const GHOST_OPACITY = 0.22;
const GRID_LINE_Y = 0.001;
const TRAY_MAX_WIDTH = 0.52;
const TRAY_MAX_GAP = 0.075;

interface GhostPiece {
  pieceId: number;
  material: MeshStandardMaterial;
}

export const board = {
  root: new Group(),
  ghostGroup: new Group(),
  rootEntity: null as Entity | null,
  built: false,
};

board.root.name = 'boardRoot';
board.ghostGroup.name = 'ghostGrid';
board.root.add(board.ghostGroup);
board.root.position.set(DESKTOP_X, DESKTOP_Y, DESKTOP_Z);

const ghostPieces: GhostPiece[] = [];
const ghostByPiece = new Map<number, GhostPiece>();

let activeBoardSystem: BoardSystem | null = null;

function buildGridGeometry(): BufferGeometry {
  const values: number[] = [];
  for (let i = 0; i <= GRID; i += 1) {
    const offset = -BOARD_HALF + i * CELL;
    values.push(offset, GRID_LINE_Y, -BOARD_HALF, offset, GRID_LINE_Y, BOARD_HALF);
    values.push(-BOARD_HALF, GRID_LINE_Y, offset, BOARD_HALF, GRID_LINE_Y, offset);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(values), 3));
  return geometry;
}

function buildBoard(): void {
  if (board.built) return;
  board.built = true;

  const plate = new Mesh(
    new BoxGeometry(GRID * CELL, PLATE_THICKNESS, GRID * CELL),
    new MeshStandardMaterial({ color: 0xe8e8ee, roughness: 0.88, metalness: 0 }),
  );
  plate.name = 'boardPlate';
  plate.position.y = -PLATE_THICKNESS / 2;
  board.root.add(plate);

  const grid = new LineSegments(
    buildGridGeometry(),
    new LineBasicMaterial({
      color: 0x9b9ea8,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    }),
  );
  grid.name = 'boardGrid';
  board.root.add(grid);

  const cellGeometry = new BoxGeometry(GHOST_SIZE, GHOST_SIZE, GHOST_SIZE);
  for (const piece of game.blueprint.pieces) {
    const color = paletteColor(piece.color);
    const material = new MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthWrite: false,
      roughness: 0.45,
      metalness: 0,
    });
    const group = new Group();
    group.name = `ghost-${piece.id}`;
    for (const cell of pieceCells(piece)) {
      const box = new Mesh(cellGeometry, material);
      box.position.set(
        (cell[0] + 0.5 - GRID / 2) * CELL,
        cell[1] * CELL + CELL / 2 + GHOST_LIFT,
        (cell[2] + 0.5 - GRID / 2) * CELL,
      );
      group.add(box);
    }
    board.ghostGroup.add(group);
    const record: GhostPiece = { pieceId: piece.id, material };
    ghostPieces.push(record);
    ghostByPiece.set(piece.id, record);
  }
}

export function ensureBoard(world: World): Entity {
  buildBoard();
  const existing = board.rootEntity;
  if (existing) return existing;
  const created = world.createTransformEntity(board.root);
  board.rootEntity = created;
  return created;
}

export function cellCenter(gx: number, gy: number, gz: number, out: Vector3): Vector3 {
  return out.set(
    (gx + 0.5 - GRID / 2) * CELL,
    gy * CELL + BLOCK / 2,
    (gz + 0.5 - GRID / 2) * CELL,
  );
}

export function pieceCenter(
  kind: Piece['kind'],
  x: number,
  y: number,
  z: number,
  rot: 0 | 1,
  out: Vector3,
): Vector3 {
  const offsetX = kind === 'bar' && rot === 0 ? 1 : 0.5;
  const offsetZ = kind === 'bar' && rot === 1 ? 1 : 0.5;
  return out.set(
    (x + offsetX - GRID / 2) * CELL,
    y * CELL + BLOCK / 2,
    (z + offsetZ - GRID / 2) * CELL,
  );
}

export function traySlotPosition(slot: number, count: number, out: Vector3): Vector3 {
  const spacing = count > 1 ? Math.min(TRAY_MAX_GAP, TRAY_MAX_WIDTH / (count - 1)) : 0;
  return out.set((slot - (count - 1) / 2) * spacing, BLOCK / 2, TRAY_Z);
}

export function flashHint(pieceId?: number): void {
  activeBoardSystem?.flashHint(pieceId);
}

export class BoardSystem extends createSystem({}) {
  private headPosition = new Vector3();
  private headQuaternion = new Quaternion();
  private forward = new Vector3();
  private placementPending = false;
  private now = 0;
  private flashMaterial: MeshStandardMaterial | null = null;
  private flashEnd = 0;
  private hintIndex = 0;

  init(): void {
    ensureBoard(this.world);
    this.applyDesktopPose();
    if (this.visibilityState.peek() === VisibilityState.Visible) {
      this.placementPending = true;
    }
    this.cleanupFuncs.push(
      this.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible) {
          this.placementPending = true;
        } else if (state === VisibilityState.NonImmersive) {
          this.placementPending = false;
          this.applyDesktopPose();
        }
      }),
    );
    const offRecenter = bus.on('recenter', () => {
      this.placementPending = true;
    });
    if (typeof offRecenter === 'function') this.cleanupFuncs.push(offRecenter);
    const offHint = bus.on('hint', () => {
      this.flashHint();
    });
    if (typeof offHint === 'function') this.cleanupFuncs.push(offHint);
    activeBoardSystem = this;
    this.cleanupFuncs.push(() => {
      if (activeBoardSystem === this) activeBoardSystem = null;
    });
  }

  update(_delta: number, time: number): void {
    this.now = time;
    if (this.placementPending) {
      const state = this.visibilityState.peek();
      if (state === VisibilityState.Visible) {
        this.placeAtHead();
        this.placementPending = false;
      } else if (state === VisibilityState.NonImmersive) {
        this.applyDesktopPose();
        this.placementPending = false;
      }
    }
    this.updateFlash();
  }

  flashHint(pieceId?: number): void {
    if (this.flashMaterial) {
      this.flashMaterial.opacity = GHOST_OPACITY;
      this.flashMaterial.emissiveIntensity = 0;
      this.flashMaterial = null;
    }
    let record: GhostPiece | undefined;
    if (typeof pieceId === 'number') record = ghostByPiece.get(pieceId);
    if (!record && ghostPieces.length > 0) {
      record = ghostPieces[this.hintIndex % ghostPieces.length];
      this.hintIndex += 1;
    }
    if (!record) return;
    this.flashMaterial = record.material;
    this.flashEnd = this.now + 1.5;
  }

  private placeAtHead(): void {
    const head = this.player.head;
    head.getWorldPosition(this.headPosition);
    head.getWorldQuaternion(this.headQuaternion);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuaternion);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    const boardY = Math.min(MAX_BOARD_Y, Math.max(MIN_BOARD_Y, this.headPosition.y - HEAD_DROP));
    board.root.position.set(
      this.headPosition.x + this.forward.x * HEAD_FORWARD,
      boardY,
      this.headPosition.z + this.forward.z * HEAD_FORWARD,
    );
    board.root.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
  }

  private applyDesktopPose(): void {
    board.root.position.set(DESKTOP_X, DESKTOP_Y, DESKTOP_Z);
    board.root.rotation.set(0, 0, 0);
  }

  private updateFlash(): void {
    const material = this.flashMaterial;
    if (!material) return;
    if (this.now >= this.flashEnd) {
      material.opacity = GHOST_OPACITY;
      material.emissiveIntensity = 0;
      this.flashMaterial = null;
      return;
    }
    const pulse = 0.5 + 0.5 * Math.sin(this.now * 18);
    material.opacity = GHOST_OPACITY + 0.33 * pulse;
    material.emissiveIntensity = 0.2 + 0.9 * pulse;
  }
}
