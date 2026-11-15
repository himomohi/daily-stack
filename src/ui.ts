// Daily Stack — in-headset UI built from plain Three.js meshes and CanvasTextures.
// No uikit and no HTML inside XR: every surface is a mesh parented to the board
// root, so the whole UI follows the board when the player recenters.

import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  PokeInteractable,
  Pressed,
  RayInteractable,
  SRGBColorSpace,
  createSystem,
} from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { PALETTE } from './blueprint.js';
import { BOARD_HALF, ensureBoard } from './board.js';
import { Block, UIButton } from './game-components.js';
import { bus, game } from './state.js';
import { resetBlocks } from './blocks.js';
import { loadStreak } from './streak.js';
import { sfx } from './audio.js';

// --- layout -----------------------------------------------------------------

const PANEL_WIDTH = 0.3;
const PANEL_HEIGHT = 0.12;
const PANEL_Y = 0.22;
const PANEL_Z = -0.16; // just behind the board's back edge
const PANEL_TILT_DEG = 15; // tipped up towards the seated player
const PANEL_CANVAS_WIDTH = 1024;
const PANEL_CANVAS_HEIGHT = 410;

const BUTTON_WIDTH = 0.065;
const BUTTON_THICKNESS = 0.012;
const BUTTON_DEPTH = 0.035;
const BUTTON_Y = 0.02;
const BUTTON_Z = BOARD_HALF + 0.045;
const BUTTON_TILT_DEG = 35;
const BUTTON_SPACING = 0.09;
const BUTTON_DIP = 0.004;
const BUTTON_DIP_SECONDS = 0.12;
const BUTTON_COOLDOWN = 0.3;

const BUTTON_BASE_COLOR = 0x333a4a;
const BUTTON_HOVER_COLOR = 0x525f7d;

// --- win burst --------------------------------------------------------------

const PARTICLE_COUNT = 40;
const PARTICLE_LIFE = 1.4;
const PARTICLE_GRAVITY = 1.7;
const PARTICLE_SIZE = 0.014;

// --- text refresh -----------------------------------------------------------

const REDRAW_INTERVAL = 0.25; // at most four canvas repaints per second

// --- shared visual language (also used by the tutorial card) ----------------

export const UI_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const UI_MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const UI_TEXT = '#f4f6fb';
export const UI_MUTED = '#9aa1b1';
export const UI_ACCENT = '#6ea8ff';
export const UI_WARM = '#ffd447';

const CARD_FILL = 'rgba(20, 22, 28, 0.82)';
const CARD_STROKE = 'rgba(255, 255, 255, 0.10)';

const BUTTON_SPECS: { label: string; action: string }[] = [
  { label: 'Hint', action: 'hint' },
  { label: 'Reset', action: 'reset' },
  { label: 'Recenter', action: 'recenter' },
];

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** Dark rounded translucent card filling the whole canvas. */
export function paintCard(ctx: CanvasRenderingContext2D): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.save();
  roundedRect(ctx, 4, 4, width - 8, height - 8, 34);
  ctx.fillStyle = CARD_FILL;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = CARD_STROKE;
  ctx.stroke();
  ctx.restore();
}

function paintFlame(
  ctx: CanvasRenderingContext2D,
  x: number,
  baseline: number,
  width: number,
  height: number,
): void {
  const cx = x + width / 2;
  const top = baseline - height;
  ctx.save();

  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.bezierCurveTo(
    x + width * 0.96,
    top + height * 0.26,
    x + width * 0.9,
    baseline - height * 0.16,
    cx + width * 0.24,
    baseline,
  );
  ctx.bezierCurveTo(
    cx + width * 0.06,
    baseline + height * 0.08,
    x - width * 0.04,
    baseline - height * 0.42,
    cx,
    top,
  );
  ctx.closePath();
  const gradient = ctx.createLinearGradient(cx, top, cx, baseline);
  gradient.addColorStop(0, UI_WARM);
  gradient.addColorStop(1, '#ff7a3d');
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(cx, baseline - height * 0.72);
  ctx.bezierCurveTo(
    cx + width * 0.4,
    baseline - height * 0.5,
    cx + width * 0.32,
    baseline - height * 0.14,
    cx + width * 0.06,
    baseline - height * 0.02,
  );
  ctx.bezierCurveTo(
    cx - width * 0.14,
    baseline - height * 0.16,
    cx - width * 0.16,
    baseline - height * 0.5,
    cx,
    baseline - height * 0.72,
  );
  ctx.closePath();
  ctx.fillStyle = '#fff1c4';
  ctx.fill();
  ctx.restore();
}

function paintStatus(
  ctx: CanvasRenderingContext2D,
  dateKey: string,
  timer: string,
  streak: number,
  placed: number,
  total: number,
): void {
  const right = PANEL_CANVAS_WIDTH - 44;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  ctx.textAlign = 'left';
  ctx.fillStyle = UI_TEXT;
  ctx.font = `700 58px ${UI_FONT}`;
  ctx.fillText('Daily Stack', 44, 94);

  ctx.fillStyle = UI_MUTED;
  ctx.font = `500 26px ${UI_FONT}`;
  ctx.fillText(dateKey, 44, 134);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fillRect(44, 168, PANEL_CANVAS_WIDTH - 88, 2);

  ctx.fillStyle = UI_TEXT;
  ctx.font = `700 122px ${UI_MONO}`;
  ctx.fillText(timer, 42, 330);

  ctx.textAlign = 'right';
  ctx.fillStyle = UI_TEXT;
  ctx.font = `700 40px ${UI_FONT}`;
  const streakText = `Streak ${streak}`;
  ctx.fillText(streakText, right, 94);
  const streakWidth = ctx.measureText(streakText).width;
  paintFlame(ctx, right - streakWidth - 46, 94, 30, 40);

  ctx.fillStyle = UI_MUTED;
  ctx.font = `600 34px ${UI_FONT}`;
  ctx.fillText(`Placed ${placed} / ${total}`, right, 330);
  ctx.restore();
}

function paintWin(
  ctx: CanvasRenderingContext2D,
  timer: string,
  streak: number,
  best: string,
): void {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  ctx.fillStyle = UI_TEXT;
  ctx.font = `700 58px ${UI_FONT}`;
  ctx.fillText('Tower complete!', 512, 110);

  ctx.fillStyle = UI_WARM;
  roundedRect(ctx, 462, 128, 100, 7, 4);
  ctx.fill();

  ctx.fillStyle = UI_TEXT;
  ctx.font = `700 112px ${UI_MONO}`;
  ctx.fillText(timer, 512, 272);

  ctx.fillStyle = UI_MUTED;
  ctx.font = `600 34px ${UI_FONT}`;
  ctx.fillText(`Streak ${streak} · Best today ${best}`, 512, 334);

  ctx.font = `500 27px ${UI_FONT}`;
  ctx.fillText('Come back tomorrow for a new blueprint', 512, 380);
  ctx.restore();
}

function paintButtonLabel(ctx: CanvasRenderingContext2D, label: string): void {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = UI_TEXT;
  let size = Math.round(height * 0.42);
  ctx.font = `600 ${size}px ${UI_FONT}`;
  const measured = ctx.measureText(label).width;
  const maxWidth = width * 0.84;
  if (measured > maxWidth) {
    size = Math.max(12, Math.floor((size * maxWidth) / measured));
    ctx.font = `600 ${size}px ${UI_FONT}`;
  }
  ctx.fillText(label, width / 2, height / 2 + Math.round(size * 0.04));
}

function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface ButtonRecord {
  entity: Entity;
  mesh: Mesh<BoxGeometry, MeshStandardMaterial>;
  action: string;
  baseY: number;
  dipUntil: number;
  cooldown: number;
}

export class UISystem extends createSystem({
  blocks: { required: [Block] },
  hoveredButtons: { required: [UIButton, Hovered] },
  pressedButtons: { required: [UIButton, Pressed] },
}) {
  private buttons: ButtonRecord[] = [];
  private panelCtx: CanvasRenderingContext2D | null = null;
  private panelTexture: CanvasTexture | null = null;
  private streak = 0;
  private lastSeconds = -1;
  private redrawTimer = 0;
  private dirty = true;
  private winVisible = false;
  private winTimeMs = 0;
  private winStreak = 0;
  private winBestMs = 0;
  private now = 0;

  private particles: Points<BufferGeometry, PointsMaterial> | null = null;
  private particleMaterial: PointsMaterial | null = null;
  private particlePositions: Float32Array | null = null;
  private particleVelocities: Float32Array | null = null;
  private particleAttribute: Float32BufferAttribute | null = null;
  private particleAge = 0;
  private particleActive = false;

  init(): void {
    const parent = ensureBoard(this.world);
    this.streak = loadStreak().streak;
    this.createPanel(parent);
    this.createButtons(parent);
    this.createParticles(parent);
    this.drawPanel();

    this.cleanupFuncs.push(
      this.queries.hoveredButtons.subscribe('qualify', (entity) => this.setHovered(entity, true)),
    );
    this.cleanupFuncs.push(
      this.queries.hoveredButtons.subscribe('disqualify', (entity) => this.setHovered(entity, false)),
    );
    this.cleanupFuncs.push(
      this.queries.pressedButtons.subscribe('qualify', (entity) => this.onPressed(entity)),
    );

    this.cleanupFuncs.push(
      bus.on('placed', () => {
        this.dirty = true;
      }),
      bus.on('grab', () => {
        this.dirty = true;
      }),
      bus.on('reset', () => this.onReset()),
      bus.on('solved', (payload) => this.onSolved(payload)),
    );
  }

  update(delta: number, time: number): void {
    this.now = time;

    for (let i = 0; i < this.buttons.length; i += 1) {
      const button = this.buttons[i];
      if (button.cooldown > 0) button.cooldown -= delta;
      if (button.dipUntil > 0 && this.now >= button.dipUntil) {
        button.dipUntil = 0;
        button.mesh.position.y = button.baseY;
      }
    }

    this.redrawTimer += delta;
    if (this.redrawTimer >= REDRAW_INTERVAL) {
      this.redrawTimer = 0;
      const seconds = this.elapsedSeconds();
      const timerChanged = !this.winVisible && seconds !== this.lastSeconds;
      if (this.dirty || timerChanged) {
        this.lastSeconds = seconds;
        this.dirty = false;
        this.drawPanel();
      }
    }

    this.updateParticles(delta);
  }

  private createPanel(parent: Entity): void {
    const canvas = document.createElement('canvas');
    canvas.width = PANEL_CANVAS_WIDTH;
    canvas.height = PANEL_CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.panelCtx = ctx;

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.panelTexture = texture;

    const mesh = new Mesh(
      new PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT),
      new MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    mesh.name = 'statusPanel';
    mesh.position.set(0, PANEL_Y, PANEL_Z);
    mesh.rotation.set(-(PANEL_TILT_DEG * Math.PI) / 180, 0, 0);
    this.world.createTransformEntity(mesh, parent);
  }

  private createButtons(parent: Entity): void {
    for (let i = 0; i < BUTTON_SPECS.length; i += 1) {
      const x = (i - (BUTTON_SPECS.length - 1) / 2) * BUTTON_SPACING;
      this.createButton(parent, BUTTON_SPECS[i].label, BUTTON_SPECS[i].action, x);
    }
  }

  private createButton(parent: Entity, label: string, action: string, x: number): void {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) paintButtonLabel(ctx, label);

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;

    const mesh = new Mesh(
      new BoxGeometry(BUTTON_WIDTH, BUTTON_THICKNESS, BUTTON_DEPTH),
      new MeshStandardMaterial({
        color: BUTTON_BASE_COLOR,
        roughness: 0.62,
        metalness: 0.06,
        emissive: 0x0b0f18,
      }),
    );
    mesh.name = `ui-button-${action}`;
    mesh.position.set(x, BUTTON_Y, BUTTON_Z);
    mesh.rotation.set((BUTTON_TILT_DEG * Math.PI) / 180, 0, 0);

    const labelMesh = new Mesh(
      new PlaneGeometry(BUTTON_WIDTH * 0.88, BUTTON_DEPTH * 0.72),
      new MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    labelMesh.name = `ui-button-label-${action}`;
    labelMesh.position.set(0, BUTTON_THICKNESS / 2 + 0.0006, 0);
    labelMesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.add(labelMesh);

    const entity = this.world.createTransformEntity(mesh, parent);
    entity.addComponent(UIButton, { action });
    entity.addComponent(PokeInteractable);
    entity.addComponent(RayInteractable);

    this.buttons.push({ entity, mesh, action, baseY: BUTTON_Y, dipUntil: 0, cooldown: 0 });
  }

  private createParticles(parent: Entity): void {
    const geometry = new BufferGeometry();
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const color = new Color();
    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      color.setHex(PALETTE[i % PALETTE.length] ?? 0xffffff);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    const positionAttribute = new Float32BufferAttribute(positions, 3);
    positionAttribute.setUsage(DynamicDrawUsage);
    geometry.setAttribute('position', positionAttribute);
    geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));

    const material = new PointsMaterial({
      size: PARTICLE_SIZE,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      depthWrite: false,
      sizeAttenuation: true,
      toneMapped: false,
    });

    const points = new Points(geometry, material);
    points.name = 'winBurst';
    points.frustumCulled = false;
    points.visible = false;
    points.position.set(0, 0.05, 0);
    this.world.createTransformEntity(points, parent);

    this.particles = points;
    this.particleMaterial = material;
    this.particlePositions = positions;
    this.particleVelocities = new Float32Array(PARTICLE_COUNT * 3);
    this.particleAttribute = positionAttribute;
  }

  private setHovered(entity: Entity, hovered: boolean): void {
    const record = this.findButton(entity);
    if (!record) return;
    record.mesh.material.color.setHex(hovered ? BUTTON_HOVER_COLOR : BUTTON_BASE_COLOR);
  }

  private onPressed(entity: Entity): void {
    const record = this.findButton(entity);
    if (!record) return;
    if (record.cooldown > 0) return;

    if (record.action === 'hint') {
      game.hints += 1;
      sfx.click();
      bus.emit('hint');
    } else if (record.action === 'reset') {
      sfx.click();
      bus.emit('reset');
      resetBlocks();
    } else if (record.action === 'recenter') {
      sfx.click();
      bus.emit('recenter');
    } else {
      return; // another module owns this button (the tutorial's Skip)
    }

    record.cooldown = BUTTON_COOLDOWN;
    record.dipUntil = this.now + BUTTON_DIP_SECONDS;
    record.mesh.position.y = record.baseY - BUTTON_DIP;
  }

  private onSolved(payload: unknown): void {
    const data = payload as
      | { timeMs?: number; streak?: { streak?: number; bestTimes?: Record<string, number> } }
      | undefined;
    const timeMs = data && typeof data.timeMs === 'number' ? data.timeMs : this.elapsedMs();
    const state = data?.streak;
    const streak = state && typeof state.streak === 'number' ? state.streak : this.streak;
    const best = state?.bestTimes?.[game.blueprint.dateKey];

    this.winVisible = true;
    this.winTimeMs = timeMs;
    this.winStreak = streak;
    this.winBestMs = typeof best === 'number' ? best : timeMs;
    this.streak = streak;
    game.lastTimeMs = timeMs;
    this.lastSeconds = this.elapsedSeconds();
    this.dirty = false;
    this.drawPanel();
    this.burst();
  }

  private onReset(): void {
    this.winVisible = false;
    this.dirty = true;
    this.stopParticles();
    this.drawPanel();
  }

  private drawPanel(): void {
    const ctx = this.panelCtx;
    const texture = this.panelTexture;
    if (!ctx || !texture) return;

    ctx.clearRect(0, 0, PANEL_CANVAS_WIDTH, PANEL_CANVAS_HEIGHT);
    paintCard(ctx);
    if (this.winVisible) {
      paintWin(ctx, formatTime(this.winTimeMs), this.winStreak, formatTime(this.winBestMs));
    } else {
      paintStatus(
        ctx,
        game.blueprint.dateKey,
        formatTime(this.elapsedMs()),
        this.streak,
        this.countPlaced(),
        game.blueprint.pieces.length,
      );
    }
    texture.needsUpdate = true;
  }

  private countPlaced(): number {
    let count = 0;
    for (const entity of this.queries.blocks.entities) {
      if (entity.getValue(Block, 'placed') === true) count += 1;
    }
    return count;
  }

  private elapsedMs(): number {
    if (game.solved && game.lastTimeMs !== null) return game.lastTimeMs;
    const start = game.startTime;
    if (start === null) return 0;
    return Math.max(0, performance.now() - start);
  }

  private elapsedSeconds(): number {
    return Math.floor(this.elapsedMs() / 1000);
  }

  private burst(): void {
    const positions = this.particlePositions;
    const velocities = this.particleVelocities;
    const attribute = this.particleAttribute;
    const points = this.particles;
    if (!positions || !velocities || !attribute || !points) return;

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const offset = i * 3;
      positions[offset] = (Math.random() - 0.5) * 0.06;
      positions[offset + 1] = Math.random() * 0.05;
      positions[offset + 2] = (Math.random() - 0.5) * 0.06;

      const angle = Math.random() * Math.PI * 2;
      const speed = 0.1 + Math.random() * 0.22;
      velocities[offset] = Math.cos(angle) * speed;
      velocities[offset + 1] = 0.32 + Math.random() * 0.42;
      velocities[offset + 2] = Math.sin(angle) * speed;
    }

    attribute.needsUpdate = true;
    points.visible = true;
    if (this.particleMaterial) this.particleMaterial.opacity = 1;
    this.particleAge = 0;
    this.particleActive = true;
  }

  private updateParticles(delta: number): void {
    const points = this.particles;
    const material = this.particleMaterial;
    const positions = this.particlePositions;
    const velocities = this.particleVelocities;
    const attribute = this.particleAttribute;
    if (!this.particleActive || !points || !material || !positions || !velocities || !attribute) {
      return;
    }

    this.particleAge += delta;
    if (this.particleAge >= PARTICLE_LIFE) {
      this.particleActive = false;
      points.visible = false;
      return;
    }

    for (let i = 0; i < PARTICLE_COUNT; i += 1) {
      const offset = i * 3;
      velocities[offset + 1] -= PARTICLE_GRAVITY * delta;
      positions[offset] += velocities[offset] * delta;
      positions[offset + 1] += velocities[offset + 1] * delta;
      positions[offset + 2] += velocities[offset + 2] * delta;
    }
    attribute.needsUpdate = true;
    material.opacity = 1 - this.particleAge / PARTICLE_LIFE;
  }

  private stopParticles(): void {
    this.particleActive = false;
    if (this.particles) this.particles.visible = false;
  }

  private findButton(entity: Entity): ButtonRecord | undefined {
    for (let i = 0; i < this.buttons.length; i += 1) {
      if (this.buttons[i].entity.index === entity.index) return this.buttons[i];
    }
    return undefined;
  }
}
