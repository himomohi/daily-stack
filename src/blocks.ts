import {
  BoxGeometry,
  Euler,
  Grabbed,
  GrabSystem,
  Mesh,
  MeshStandardMaterial,
  OneHandGrabbable,
  Quaternion,
  RayInteractable,
  TwoHandsGrabbable,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { GRID, MAX_LEVELS, PALETTE, mulberry32, pieceCells } from './blueprint.js';
import type { Kind, Piece } from './blueprint.js';
import { Block } from './game-components.js';
import {
  BAR_LENGTH,
  BLOCK,
  BOARD_HALF,
  CELL,
  board,
  ensureBoard,
  paletteIndex,
  pieceCenter,
  traySlotPosition,
} from './board.js';
import { bus, game } from './state.js';
import { sfx } from './audio.js';

const SNAP_REACH = BOARD_HALF + 0.03;
const SNAP_CEILING = 0.25;
const SNAP_FLOOR = -0.02;
const SNAP_DURATION = 0.08;
const TRAY_DURATION = 0.18;

interface BlockAnimation {
  fromPosition: Vector3;
  toPosition: Vector3;
  fromQuaternion: Quaternion;
  toQuaternion: Quaternion;
  elapsed: number;
  duration: number;
}

interface BlockRecord {
  entity: Entity;
  mesh: Mesh<BoxGeometry, MeshStandardMaterial>;
  piece: Piece;
  slot: number;
  anim: BlockAnimation | null;
}

const cubeGeometry = new BoxGeometry(BLOCK, BLOCK, BLOCK);
const barGeometry = new BoxGeometry(BAR_LENGTH, BLOCK, BLOCK);
const blockMaterials: (MeshStandardMaterial | undefined)[] = [];

let activeBlockSystem: BlockSystem | null = null;

function blockMaterial(colorIndex: number): MeshStandardMaterial {
  const index = colorIndex >= 0 && colorIndex < PALETTE.length ? colorIndex : 0;
  const existing = blockMaterials[index];
  if (existing) return existing;
  const material = new MeshStandardMaterial({
    color: PALETTE[index] ?? 0xffffff,
    roughness: 0.5,
    metalness: 0.02,
  });
  blockMaterials[index] = material;
  return material;
}

function trayYaw(kind: Kind): number {
  return kind === 'bar' ? Math.PI / 2 : 0;
}

function trayOrder(count: number, seed: number): number[] {
  const order: number[] = [];
  for (let i = 0; i < count; i += 1) order.push(i);
  const random = mulberry32(seed);
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  return order;
}

function cellIndex(x: number, y: number, z: number): number {
  return y * GRID * GRID + z * GRID + x;
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function resetBlocks(): void {
  activeBlockSystem?.resetToTray();
}

/** Piece id of the block resting in the first (left-most) tray slot, if any. */
export function getFirstTrayPieceId(): number | null {
  return activeBlockSystem?.getFirstTrayPieceId() ?? null;
}

export class BlockSystem extends createSystem({
  blocks: { required: [Block] },
  held: { required: [Block, Grabbed] },
}) {
  private records: BlockRecord[] = [];
  private occupancy = new Uint8Array(GRID * GRID * MAX_LEVELS);
  private ignoredReleases = new Set<number>();
  private worldPosition = new Vector3();
  private localPosition = new Vector3();
  private targetPosition = new Vector3();
  private worldQuaternion = new Quaternion();
  private boardQuaternion = new Quaternion();
  private localQuaternion = new Quaternion();
  private targetQuaternion = new Quaternion();
  private localEuler = new Euler(0, 0, 0, 'YXZ');
  private upAxis = new Vector3(0, 1, 0);
  private snapX = 0;
  private snapZ = 0;

  init(): void {
    const parent = ensureBoard(this.world);
    this.createBlocks(parent);
    this.cleanupFuncs.push(
      this.queries.held.subscribe('qualify', (entity) => this.onGrabbed(entity)),
    );
    this.cleanupFuncs.push(
      this.queries.held.subscribe('disqualify', (entity) => this.onReleased(entity)),
    );
    const offReset = bus.on('reset', () => this.resetToTray());
    if (typeof offReset === 'function') this.cleanupFuncs.push(offReset);
    activeBlockSystem = this;
    this.cleanupFuncs.push(() => {
      if (activeBlockSystem === this) activeBlockSystem = null;
    });
  }

  update(delta: number): void {
    for (let i = 0; i < this.records.length; i += 1) {
      const record = this.records[i];
      const animation = record.anim;
      if (!animation) continue;
      animation.elapsed += delta;
      let t = animation.duration > 0 ? animation.elapsed / animation.duration : 1;
      if (t > 1) t = 1;
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      record.mesh.position.lerpVectors(animation.fromPosition, animation.toPosition, eased);
      record.mesh.quaternion.slerpQuaternions(
        animation.fromQuaternion,
        animation.toQuaternion,
        eased,
      );
      if (t >= 1) {
        record.mesh.position.copy(animation.toPosition);
        record.mesh.quaternion.copy(animation.toQuaternion);
        record.anim = null;
      }
    }
  }

  /** Piece id in tray slot 0; records are created in tray-slot order. */
  getFirstTrayPieceId(): number | null {
    return this.records.length > 0 ? this.records[0].piece.id : null;
  }

  resetToTray(): void {
    const grab = this.world.getSystem(GrabSystem);
    const count = this.records.length;
    for (let i = 0; i < count; i += 1) {
      const record = this.records[i];
      record.anim = null;
      if (record.entity.hasComponent(Grabbed)) {
        this.ignoredReleases.add(record.entity.index);
        grab?.forceRelease(record.entity);
      }
      record.entity.setValue(Block, 'placed', false);
      traySlotPosition(record.slot, count, this.targetPosition);
      record.mesh.position.copy(this.targetPosition);
      record.mesh.rotation.set(0, trayYaw(record.piece.kind), 0);
    }
  }

  private createBlocks(parent: Entity): void {
    const blueprint = game.blueprint;
    const count = blueprint.pieces.length;
    const order = trayOrder(count, blueprint.seed);
    for (let slot = 0; slot < count; slot += 1) {
      const piece = blueprint.pieces[order[slot]];
      const colorIndex = paletteIndex(piece.color);
      const geometry = piece.kind === 'bar' ? barGeometry : cubeGeometry;
      const mesh = new Mesh(geometry, blockMaterial(colorIndex));
      mesh.name = `block-${piece.id}`;
      traySlotPosition(slot, count, mesh.position);
      mesh.rotation.set(0, trayYaw(piece.kind), 0);
      const entity = this.world.createTransformEntity(mesh, parent);
      entity.addComponent(Block, {
        pieceId: piece.id,
        kind: piece.kind === 'bar' ? 1 : 0,
        color: colorIndex,
        placed: false,
        gx: piece.x,
        gy: piece.y,
        gz: piece.z,
        rot: piece.rot,
      });
      entity.addComponent(RayInteractable);
      entity.addComponent(OneHandGrabbable, { rotate: true, translate: true });
      entity.addComponent(TwoHandsGrabbable, { rotate: true, translate: true, scale: false });
      this.records.push({ entity, mesh, piece, slot, anim: null });
    }
  }

  private onGrabbed(entity: Entity): void {
    const record = this.findRecord(entity.index);
    if (!record) return;
    record.anim = null;
    if (record.entity.getValue(Block, 'placed') === true) {
      record.entity.setValue(Block, 'placed', false);
    }
    sfx.pickup();
    bus.emit('grab', { pieceId: record.piece.id });
  }

  private onReleased(entity: Entity): void {
    const record = this.findRecord(entity.index);
    if (!record) return;
    if (this.ignoredReleases.delete(entity.index)) return;

    const mesh = record.mesh;
    mesh.updateWorldMatrix(true, false);
    board.root.updateWorldMatrix(true, false);
    mesh.getWorldPosition(this.worldPosition);
    this.localPosition.copy(this.worldPosition);
    board.root.worldToLocal(this.localPosition);

    if (this.isOverBoard() && this.trySnap(record)) return;
    this.returnToTray(record);
  }

  private isOverBoard(): boolean {
    return (
      Math.abs(this.localPosition.x) <= SNAP_REACH &&
      Math.abs(this.localPosition.z) <= SNAP_REACH &&
      this.localPosition.y >= SNAP_FLOOR &&
      this.localPosition.y <= SNAP_CEILING
    );
  }

  private trySnap(record: BlockRecord): boolean {
    const kind = record.piece.kind;
    const rot: 0 | 1 = kind === 'bar' ? this.nearestBarRotation(record.mesh) : 0;
    this.computeSnapCell(kind, rot);
    this.buildOccupancy(record.entity.index);
    const level = this.findLevel(kind, this.snapX, this.snapZ, rot);
    if (level < 0) return false;

    pieceCenter(kind, this.snapX, level, this.snapZ, rot, this.targetPosition);
    this.targetQuaternion.setFromAxisAngle(this.upAxis, rot * (Math.PI / 2));
    this.animateTo(record, this.targetPosition, this.targetQuaternion, SNAP_DURATION);
    record.entity.setValue(Block, 'placed', true);
    record.entity.setValue(Block, 'gx', this.snapX);
    record.entity.setValue(Block, 'gy', level);
    record.entity.setValue(Block, 'gz', this.snapZ);
    record.entity.setValue(Block, 'rot', rot);
    sfx.snap();
    bus.emit('placed', { pieceId: record.piece.id });
    return true;
  }

  private nearestBarRotation(mesh: Mesh<BoxGeometry, MeshStandardMaterial>): 0 | 1 {
    board.root.getWorldQuaternion(this.boardQuaternion);
    mesh.getWorldQuaternion(this.worldQuaternion);
    this.localQuaternion.copy(this.boardQuaternion).invert().multiply(this.worldQuaternion);
    this.localEuler.setFromQuaternion(this.localQuaternion, 'YXZ');
    const quarter = Math.round(this.localEuler.y / (Math.PI / 2));
    return ((quarter % 2) + 2) % 2 === 1 ? 1 : 0;
  }

  private computeSnapCell(kind: Kind, rot: 0 | 1): void {
    const cx = this.localPosition.x / CELL + GRID / 2;
    const cz = this.localPosition.z / CELL + GRID / 2;
    if (kind === 'bar' && rot === 0) {
      this.snapX = clampInt(Math.round(cx - 1), 0, GRID - 2);
      this.snapZ = clampInt(Math.round(cz - 0.5), 0, GRID - 1);
    } else if (kind === 'bar') {
      this.snapX = clampInt(Math.round(cx - 0.5), 0, GRID - 1);
      this.snapZ = clampInt(Math.round(cz - 1), 0, GRID - 2);
    } else {
      this.snapX = clampInt(Math.round(cx - 0.5), 0, GRID - 1);
      this.snapZ = clampInt(Math.round(cz - 0.5), 0, GRID - 1);
    }
  }

  private buildOccupancy(excludeIndex: number): void {
    this.occupancy.fill(0);
    const entities = this.queries.blocks.entities;
    for (const entity of entities) {
      if (entity.index === excludeIndex) continue;
      if (entity.getValue(Block, 'placed') !== true) continue;
      const kind: Kind = entity.getValue(Block, 'kind') === 1 ? 'bar' : 'cube';
      const x = entity.getValue(Block, 'gx') ?? 0;
      const y = entity.getValue(Block, 'gy') ?? 0;
      const z = entity.getValue(Block, 'gz') ?? 0;
      const rot: 0 | 1 = entity.getValue(Block, 'rot') === 1 ? 1 : 0;
      const cells = pieceCells({ kind, x, y, z, rot });
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[i];
        const cx = cell[0];
        const cy = cell[1];
        const cz = cell[2];
        if (cx < 0 || cx >= GRID || cy < 0 || cy >= MAX_LEVELS || cz < 0 || cz >= GRID) continue;
        this.occupancy[cellIndex(cx, cy, cz)] = 1;
      }
    }
  }

  private findLevel(kind: Kind, x: number, z: number, rot: 0 | 1): number {
    for (let level = 0; level < MAX_LEVELS; level += 1) {
      const cells = pieceCells({ kind, x, y: level, z, rot });
      let fits = true;
      for (let i = 0; i < cells.length; i += 1) {
        const cell = cells[i];
        const cx = cell[0];
        const cy = cell[1];
        const cz = cell[2];
        if (cx < 0 || cx >= GRID || cy < 0 || cy >= MAX_LEVELS || cz < 0 || cz >= GRID) {
          fits = false;
          break;
        }
        if (this.occupancy[cellIndex(cx, cy, cz)] === 1) {
          fits = false;
          break;
        }
        if (cy > 0 && this.occupancy[cellIndex(cx, cy - 1, cz)] === 0) {
          fits = false;
          break;
        }
      }
      if (fits) return level;
    }
    return -1;
  }

  private returnToTray(record: BlockRecord): void {
    traySlotPosition(record.slot, this.records.length, this.targetPosition);
    this.targetQuaternion.setFromAxisAngle(this.upAxis, trayYaw(record.piece.kind));
    this.animateTo(record, this.targetPosition, this.targetQuaternion, TRAY_DURATION);
    record.entity.setValue(Block, 'placed', false);
    sfx.invalid();
  }

  private animateTo(
    record: BlockRecord,
    position: Vector3,
    quaternion: Quaternion,
    duration: number,
  ): void {
    let animation = record.anim;
    if (!animation) {
      animation = {
        fromPosition: new Vector3(),
        toPosition: new Vector3(),
        fromQuaternion: new Quaternion(),
        toQuaternion: new Quaternion(),
        elapsed: 0,
        duration,
      };
      record.anim = animation;
    }
    animation.fromPosition.copy(record.mesh.position);
    animation.fromQuaternion.copy(record.mesh.quaternion);
    animation.toPosition.copy(position);
    animation.toQuaternion.copy(quaternion);
    animation.elapsed = 0;
    animation.duration = duration;
  }

  private findRecord(index: number): BlockRecord | undefined {
    for (let i = 0; i < this.records.length; i += 1) {
      if (this.records[i].entity.index === index) return this.records[i];
    }
    return undefined;
  }
}
