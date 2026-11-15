// Daily Stack — deterministic daily blueprint generation.
// Pure TypeScript (no IWSDK / Three / DOM), so it is trivially testable.

export const GRID = 4;

/** Hard cap on stack levels; generated puzzles top out at 3 levels (y = 0..2). */
export const MAX_LEVELS = 4;

/** Friendly, color-blind-friendly palette: blue, orange, yellow, teal, pink. */
export const PALETTE: number[] = [0x4c8dff, 0xff9f45, 0xffd447, 0x2ec4b6, 0xf26ca7];

export type Kind = 'cube' | 'bar';

export interface Piece {
  id: number;
  kind: Kind;
  /** Grid cell of the piece origin (x and z in 0..GRID-1). */
  x: number;
  y: number;
  z: number;
  /** 0: a bar runs along +X; 1: along +Z. Ignored for cubes. */
  rot: 0 | 1;
  color: number;
}

export interface Blueprint {
  dateKey: string;
  seed: number;
  pieces: Piece[];
}

/** Every grid cell a piece covers. A cube is one cell; a bar is two cells long. */
export function pieceCells(p: Pick<Piece, 'kind' | 'x' | 'y' | 'z' | 'rot'>): [number, number, number][] {
  if (p.kind === 'cube') return [[p.x, p.y, p.z]];
  return p.rot === 1
    ? [[p.x, p.y, p.z], [p.x, p.y, p.z + 1]]
    : [[p.x, p.y, p.z], [p.x + 1, p.y, p.z]];
}

/** Local calendar date as YYYY-MM-DD (what the player perceives as "today"). */
export function todayKey(d: Date = new Date()): string {
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Mulberry32 seeded PRNG: the same seed always yields the same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 32-bit hash: turns the date key into a stable seed. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// --- generation -------------------------------------------------------------

const MAX_Y = Math.min(MAX_LEVELS, 3) - 1;
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

interface Candidate {
  kind: Kind;
  x: number;
  y: number;
  z: number;
  rot: 0 | 1;
}

/** Pack a cell into one integer for a cheap occupancy set. */
const pack = (x: number, y: number, z: number): number => (y * GRID + z) * GRID + x;

const inGrid = (x: number, z: number): boolean => x >= 0 && x < GRID && z >= 0 && z < GRID;

/** True when a ground-level piece touches the existing structure. */
function touchesStructure(occupied: Set<number>, cells: [number, number, number][]): boolean {
  for (const [x, , z] of cells) {
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx;
      const nz = z + dz;
      if (inGrid(nx, nz) && occupied.has(pack(nx, 0, nz))) return true;
    }
  }
  return false;
}

/** Legal when in bounds, not overlapping, supported, and attached to the tower. */
function canPlace(occupied: Set<number>, c: Candidate): boolean {
  if (c.kind === 'bar' && (c.rot === 0 ? c.x + 1 >= GRID : c.z + 1 >= GRID)) return false;
  const cells = pieceCells(c);
  for (const [x, y, z] of cells) {
    if (!inGrid(x, z)) return false;
    if (occupied.has(pack(x, y, z))) return false;
    if (y > 0 && !occupied.has(pack(x, y - 1, z))) return false;
  }
  // Ground pieces must attach to the structure, keeping the sculpture connected.
  return occupied.size === 0 || c.y > 0 || touchesStructure(occupied, cells);
}

function candidates(occupied: Set<number>, kinds: readonly Kind[]): Candidate[] {
  const out: Candidate[] = [];
  for (let y = 0; y <= MAX_Y; y++) {
    for (let z = 0; z < GRID; z++) {
      for (let x = 0; x < GRID; x++) {
        if (kinds.includes('cube')) {
          const cube: Candidate = { kind: 'cube', x, y, z, rot: 0 };
          if (canPlace(occupied, cube)) out.push(cube);
        }
        if (kinds.includes('bar')) {
          for (const rot of [0, 1] as const) {
            const bar: Candidate = { kind: 'bar', x, y, z, rot };
            if (canPlace(occupied, bar)) out.push(bar);
          }
        }
      }
    }
  }
  return out;
}

/** Bias towards a compact, centered footprint that climbs instead of sprawling. */
function candidateWeight(c: Candidate, occupied: Set<number>): number {
  const cx = c.x + (c.kind === 'bar' && c.rot === 0 ? 0.5 : 0);
  const cz = c.z + (c.kind === 'bar' && c.rot === 1 ? 0.5 : 0);
  const center = (GRID - 1) / 2;
  let w = Math.max(0.25, 2.4 - (Math.abs(cx - center) + Math.abs(cz - center)) * 0.5);

  w *= 1 + c.y * 2.2; // prefer stacking upwards
  if (c.y === 0 && occupied.size > 0) w *= 0.4; // extend the base only when needed

  let neighbours = 0;
  for (const [x, y, z] of pieceCells(c)) {
    for (const [dx, dz] of NEIGHBOURS) {
      const nx = x + dx;
      const nz = z + dz;
      if (inGrid(nx, nz) && occupied.has(pack(nx, y, nz))) neighbours++;
    }
  }
  return w * (1 + neighbours * 0.35);
}

function pickCandidate(rng: () => number, list: Candidate[], occupied: Set<number>): Candidate {
  let total = 0;
  for (const c of list) total += candidateWeight(c, occupied);
  let r = rng() * total;
  for (const c of list) {
    r -= candidateWeight(c, occupied);
    if (r <= 0) return c;
  }
  return list[list.length - 1];
}

/** One deterministic build attempt; null means "retry with another seed". */
function attempt(dateKey: string, seed: number): Blueprint | null {
  const rng = mulberry32(seed);
  const count = 6 + Math.floor(rng() * 3); // 6..8 pieces
  const bars = 2 + (rng() < 0.5 ? 0 : 1); // 2..3 bars

  // Shuffle palette indices so neighbouring pieces rarely share a color.
  const colors = PALETTE.map((_, i) => i);
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const swap = colors[i];
    colors[i] = colors[j];
    colors[j] = swap;
  }

  const occupied = new Set<number>();
  const pieces: Piece[] = [];
  let barsLeft = bars;

  for (let i = 0; i < count; i++) {
    const left = count - i;
    const forceBar = left === barsLeft; // no spare slots left: bars must land here
    const kind: Kind = forceBar || (barsLeft > 0 && (i === 0 || rng() < 0.45)) ? 'bar' : 'cube';

    let list = candidates(occupied, [kind]);
    if (list.length === 0 && kind === 'bar' && !forceBar) list = candidates(occupied, ['cube']);
    if (list.length === 0) return null;

    const c = pickCandidate(rng, list, occupied);
    pieces.push({
      id: i,
      kind: c.kind,
      x: c.x,
      y: c.y,
      z: c.z,
      rot: c.rot,
      color: PALETTE[colors[i % colors.length]],
    });
    for (const [x, y, z] of pieceCells(c)) occupied.add(pack(x, y, z));
    if (c.kind === 'bar') barsLeft--;
  }

  if (barsLeft !== 0) return null;
  if (!pieces.some((p) => p.y > 1)) return null; // every puzzle needs a 3rd level
  return { dateKey, seed, pieces };
}

/** Hand-made valid fallback (6 pieces, 2 bars, 3 levels) if random attempts stall. */
function fallback(dateKey: string, seed: number): Blueprint {
  const pieces: Piece[] = [
    { id: 0, kind: 'bar', x: 1, y: 0, z: 1, rot: 0, color: PALETTE[0] },
    { id: 1, kind: 'bar', x: 1, y: 0, z: 2, rot: 0, color: PALETTE[1] },
    { id: 2, kind: 'cube', x: 0, y: 0, z: 1, rot: 0, color: PALETTE[2] },
    { id: 3, kind: 'cube', x: 1, y: 1, z: 1, rot: 0, color: PALETTE[3] },
    { id: 4, kind: 'cube', x: 2, y: 1, z: 1, rot: 0, color: PALETTE[4] },
    { id: 5, kind: 'cube', x: 1, y: 2, z: 1, rot: 0, color: PALETTE[0] },
  ];
  return { dateKey, seed, pieces };
}

/** Same dateKey -> identical blueprint (fixed seed plus bounded, seeded retries). */
export function generateBlueprint(dateKey: string): Blueprint {
  const seed = hashString(dateKey);
  for (let i = 0; i < 8; i++) {
    const generated = attempt(dateKey, (seed + i * 0x9e3779b9) >>> 0);
    if (generated) return generated;
  }
  return fallback(dateKey, seed);
}
