// Daily Stack — three-step, hand-first tutorial. Almost no text: a pulsing ring
// around the first tray block, a small card with a drawn icon, and a Skip poke
// button. Every mesh is parented to the board root so it follows a recenter.

import {
  BoxGeometry,
  CanvasTexture,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PokeInteractable,
  Pressed,
  RayInteractable,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { ensureBoard, flashHint, traySlotPosition } from './board.js';
import { getFirstTrayPieceId } from './blocks.js';
import { UIButton } from './game-components.js';
import { bus, game } from './state.js';
import { sfx } from './audio.js';
import { UI_ACCENT, UI_FONT, UI_MUTED, UI_TEXT, UI_WARM, paintCard, roundedRect } from './ui.js';

const CARD_SIZE = 0.12;
const CARD_CANVAS = 512;
const CARD_X = -0.25;
const CARD_Y = 0.18;
const CARD_Z = 0.08;
const CARD_YAW_DEG = 26; // turn the card toward the player
const CARD_TILT_DEG = 15;

const RING_RADIUS = 0.045;
const RING_TUBE = 0.0032;
const RING_LIFT = 0.012;

const STEP_COUNT = 3;
const STEP_DONE = 3;
const STEP_TIMEOUT = 6;
const HINT_REPEAT = 1.6;
const STORAGE_KEY = 'daily-stack-tutorial-done';

const SKIP_BASE_COLOR = 0x333a4a;
const SKIP_HOVER_COLOR = 0x525f7d;

const STEP_LINES: string[][] = [
  ['Pinch a block'],
  ['Drop it on a', 'glowing spot'],
  ['Turn bars with', 'your hand or', 'two hands'],
];

function readDone(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDone(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Storage unavailable: the tutorial just runs again next session.
  }
}

function paintPinchIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.fillStyle = '#4c8dff';
  roundedRect(ctx, cx - 30, cy - 30, 60, 60, 12);
  ctx.fill();

  ctx.lineCap = 'round';
  ctx.lineWidth = 30;
  ctx.strokeStyle = '#efe6da';
  ctx.beginPath();
  ctx.moveTo(cx - 122, cy + 88);
  ctx.quadraticCurveTo(cx - 104, cy + 8, cx - 40, cy - 4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 122, cy + 88);
  ctx.quadraticCurveTo(cx + 104, cy + 8, cx + 40, cy - 4);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx - 40, cy - 4, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + 40, cy - 4, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintDownArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  ctx.save();
  ctx.strokeStyle = UI_ACCENT;
  ctx.fillStyle = UI_ACCENT;
  ctx.lineCap = 'round';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 86);
  ctx.lineTo(cx, cy + 26);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 44, cy + 14);
  ctx.lineTo(cx + 44, cy + 14);
  ctx.lineTo(cx, cy + 84);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = UI_WARM;
  roundedRect(ctx, cx - 46, cy + 106, 92, 24, 8);
  ctx.fill();
  ctx.restore();
}

function paintTurnArrow(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
  const radius = 74;
  ctx.save();

  ctx.translate(cx, cy);
  ctx.rotate(-Math.PI / 7);
  ctx.fillStyle = '#ff9f45';
  roundedRect(ctx, -46, -16, 92, 32, 10);
  ctx.fill();
  ctx.restore();

  ctx.save();
  const start = Math.PI * 0.18;
  const end = Math.PI * 1.5;
  ctx.strokeStyle = '#eef2fb';
  ctx.lineWidth = 15;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, start, end);
  ctx.stroke();

  const tipX = cx + Math.cos(end) * radius;
  const tipY = cy + Math.sin(end) * radius;
  const tangentX = -Math.sin(end);
  const tangentY = Math.cos(end);
  const normalX = Math.cos(end);
  const normalY = Math.sin(end);
  ctx.fillStyle = '#eef2fb';
  ctx.beginPath();
  ctx.moveTo(tipX + tangentX * 26, tipY + tangentY * 26);
  ctx.lineTo(tipX - tangentX * 10 + normalX * 20, tipY - tangentY * 10 + normalY * 20);
  ctx.lineTo(tipX - tangentX * 10 - normalX * 20, tipY - tangentY * 10 - normalY * 20);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function paintStepIcon(ctx: CanvasRenderingContext2D, step: number, cx: number, cy: number): void {
  if (step === 0) {
    paintPinchIcon(ctx, cx, cy);
  } else if (step === 1) {
    paintDownArrow(ctx, cx, cy);
  } else {
    paintTurnArrow(ctx, cx, cy);
  }
}

function paintSkipLabel(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = UI_TEXT;
  ctx.font = `600 46px ${UI_FONT}`;
  ctx.fillText('Skip', ctx.canvas.width / 2, ctx.canvas.height / 2 + 2);
}

export class TutorialSystem extends createSystem({
  hoveredButtons: { required: [UIButton, Hovered] },
  pressedButtons: { required: [UIButton, Pressed] },
}) {
  private cardMesh: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
  private cardCtx: CanvasRenderingContext2D | null = null;
  private cardTexture: CanvasTexture | null = null;
  private ringMesh: Mesh<TorusGeometry, MeshBasicMaterial> | null = null;
  private ringMaterial: MeshBasicMaterial | null = null;
  private skipEntity: Entity | null = null;
  private skipMaterial: MeshStandardMaterial | null = null;

  private step = 0;
  private stepTime = 0;
  private active = false;
  private hintPieceId: number | null = null;
  private hintCooldown = 0;

  init(): void {
    const parent = ensureBoard(this.world);
    const done = readDone();

    this.step = done ? STEP_DONE : 0;
    this.active = !done;
    game.tutorialStep = this.step;

    this.createRing(parent);
    this.createCard(parent);

    this.cleanupFuncs.push(
      this.queries.hoveredButtons.subscribe('qualify', (entity) => this.setSkipHovered(entity, true)),
    );
    this.cleanupFuncs.push(
      this.queries.hoveredButtons.subscribe('disqualify', (entity) => this.setSkipHovered(entity, false)),
    );
    this.cleanupFuncs.push(
      this.queries.pressedButtons.subscribe('qualify', (entity) => this.onPressed(entity)),
    );

    this.cleanupFuncs.push(
      bus.on('grab', () => this.onGrab()),
      bus.on('placed', () => this.onPlaced()),
    );

    if (done) {
      this.hide();
    } else {
      this.showStep(0);
    }
  }

  update(delta: number, time: number): void {
    if (!this.active) return;

    if (this.step === 0) {
      const ring = this.ringMesh;
      const material = this.ringMaterial;
      if (ring && material) {
        const pulse = 0.5 + 0.5 * Math.sin(time * 4.5);
        const scale = 1 + pulse * 0.12;
        ring.scale.set(scale, scale, scale);
        ring.position.y = RING_LIFT + pulse * 0.005;
        material.opacity = 0.4 + pulse * 0.45;
      }
    } else if (this.step === 1) {
      this.hintCooldown -= delta;
      if (this.hintCooldown <= 0) {
        this.hintCooldown = HINT_REPEAT;
        if (this.hintPieceId !== null) flashHint(this.hintPieceId);
      }
    } else if (this.step === 2) {
      this.stepTime += delta;
      if (this.stepTime >= STEP_TIMEOUT) this.finish();
    }
  }

  private createRing(parent: Entity): void {
    const slot = new Vector3();
    traySlotPosition(0, game.blueprint.pieces.length, slot);

    const material = new MeshBasicMaterial({
      color: 0xa9c8ff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      toneMapped: false,
    });
    const mesh = new Mesh(new TorusGeometry(RING_RADIUS, RING_TUBE, 8, 40), material);
    mesh.name = 'tutorialRing';
    mesh.position.set(slot.x, RING_LIFT, slot.z);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.visible = false;
    this.world.createTransformEntity(mesh, parent);

    this.ringMesh = mesh;
    this.ringMaterial = material;
  }

  private createCard(parent: Entity): void {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_CANVAS;
    canvas.height = CARD_CANVAS;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.cardCtx = ctx;

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.cardTexture = texture;

    const mesh = new Mesh(
      new PlaneGeometry(CARD_SIZE, CARD_SIZE),
      new MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.name = 'tutorialCard';
    mesh.position.set(CARD_X, CARD_Y, CARD_Z);
    mesh.rotation.set(
      -(CARD_TILT_DEG * Math.PI) / 180,
      (CARD_YAW_DEG * Math.PI) / 180,
      0,
    );
    mesh.visible = false;
    const cardEntity = this.world.createTransformEntity(mesh, parent);
    this.cardMesh = mesh;

    const skipMaterial = new MeshStandardMaterial({
      color: SKIP_BASE_COLOR,
      roughness: 0.62,
      metalness: 0.06,
      emissive: 0x0b0f18,
    });
    const skip = new Mesh(new BoxGeometry(0.038, 0.007, 0.014), skipMaterial);
    skip.name = 'tutorialSkip';
    skip.position.set(0, -0.047, 0.008);
    mesh.add(skip);

    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256;
    labelCanvas.height = 128;
    const labelCtx = labelCanvas.getContext('2d');
    if (labelCtx) paintSkipLabel(labelCtx);
    const labelTexture = new CanvasTexture(labelCanvas);
    labelTexture.colorSpace = SRGBColorSpace;

    const label = new Mesh(
      new PlaneGeometry(0.03, 0.011),
      new MeshBasicMaterial({
        map: labelTexture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    label.name = 'tutorialSkipLabel';
    label.position.set(0, 0, 0.0076);
    skip.add(label);

    const entity = this.world.createTransformEntity(skip, cardEntity);
    entity.addComponent(UIButton, { action: 'skip-tutorial' });
    entity.addComponent(PokeInteractable);
    entity.addComponent(RayInteractable);

    this.skipEntity = entity;
    this.skipMaterial = skipMaterial;
  }

  private showStep(step: number): void {
    this.step = step;
    game.tutorialStep = step;
    this.stepTime = 0;
    this.active = true;

    if (this.cardMesh) this.cardMesh.visible = true;
    if (this.ringMesh) this.ringMesh.visible = step === 0;
    this.drawCard();
  }

  private drawCard(): void {
    const ctx = this.cardCtx;
    const texture = this.cardTexture;
    if (!ctx || !texture) return;

    const step = this.step;
    ctx.clearRect(0, 0, CARD_CANVAS, CARD_CANVAS);
    paintCard(ctx);

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = UI_MUTED;
    ctx.font = `600 26px ${UI_FONT}`;
    ctx.fillText(`STEP ${step + 1} OF ${STEP_COUNT}`, 36, 64);

    for (let i = 0; i < STEP_COUNT; i += 1) {
      ctx.beginPath();
      ctx.arc(476 - i * 30, 52, 8, 0, Math.PI * 2);
      ctx.fillStyle = i <= step ? UI_TEXT : 'rgba(255, 255, 255, 0.22)';
      ctx.fill();
    }

    paintStepIcon(ctx, step, 256, 175);

    const lines = STEP_LINES[step] ?? [];
    ctx.textAlign = 'center';
    ctx.fillStyle = UI_TEXT;
    ctx.font = `600 36px ${UI_FONT}`;
    let y = 356 - (lines.length - 1) * 22;
    for (let i = 0; i < lines.length; i += 1) {
      ctx.fillText(lines[i], 256, y);
      y += 44;
    }

    texture.needsUpdate = true;
  }

  private advance(step: number): void {
    this.showStep(step);
    if (step === 1) {
      const pieceId = getFirstTrayPieceId();
      this.hintPieceId = pieceId;
      this.hintCooldown = HINT_REPEAT;
      if (pieceId !== null) flashHint(pieceId);
      else flashHint();
    }
    sfx.step();
    bus.emit('tutorial-advance', { step });
  }

  private finish(): void {
    if (!this.active) return;
    this.active = false;
    this.step = STEP_DONE;
    game.tutorialStep = STEP_DONE;
    writeDone();
    this.hide();
    sfx.step();
    bus.emit('tutorial-advance', { step: STEP_DONE });
  }

  private hide(): void {
    if (this.cardMesh) this.cardMesh.visible = false;
    if (this.ringMesh) this.ringMesh.visible = false;

    const skip = this.skipEntity;
    if (skip) {
      if (skip.hasComponent(PokeInteractable)) skip.removeComponent(PokeInteractable);
      if (skip.hasComponent(RayInteractable)) skip.removeComponent(RayInteractable);
    }
  }

  private onGrab(): void {
    if (!this.active || this.step !== 0) return;
    this.advance(1);
  }

  private onPlaced(): void {
    if (!this.active) return;
    if (this.step === 1) this.advance(2);
    else if (this.step === 2) this.finish();
  }

  private onPressed(entity: Entity): void {
    if (!this.active) return;
    const skip = this.skipEntity;
    if (!skip || entity.index !== skip.index) return;
    sfx.click();
    this.finish();
  }

  private setSkipHovered(entity: Entity, hovered: boolean): void {
    const skip = this.skipEntity;
    const material = this.skipMaterial;
    if (!skip || !material || entity.index !== skip.index) return;
    material.color.setHex(hovered ? SKIP_HOVER_COLOR : SKIP_BASE_COLOR);
  }
}
