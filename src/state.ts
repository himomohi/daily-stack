// Daily Stack — shared runtime state and event bus.
// Plain module-level singletons: systems coordinate through these instead of
// stuffing game state into ECS globals (see SPEC "Systems" note).

import { generateBlueprint, todayKey, type Blueprint } from './blueprint.js';

const blueprint: Blueprint = generateBlueprint(todayKey());

export const game = {
  /** Today's deterministic puzzle (dateKey lives on the blueprint). */
  blueprint,
  /** performance.now() when the timed run started (first placement), else null. */
  startTime: null as number | null,
  /** True once every block matches the blueprint. */
  solved: false,
  /** Current guided-tutorial step; 0 is the first hint. */
  tutorialStep: 0,
  /** Hints revealed this run, useful for scoring and UI copy. */
  hints: 0,
  /** Last completion time for today in ms, if a previous win is known. */
  lastTimeMs: null as number | null,
};

export type GameEvent = 'grab' | 'placed' | 'solved' | 'reset' | 'hint' | 'recenter' | 'tutorial-advance';

// Payload shape depends on the event ('placed' carries a piece, 'reset' none, ...),
// so listeners accept anything and narrow as needed.
type Listener = (payload?: any) => void;

const listeners: Record<GameEvent, Set<Listener>> = {
  grab: new Set(),
  placed: new Set(),
  solved: new Set(),
  reset: new Set(),
  hint: new Set(),
  recenter: new Set(),
  'tutorial-advance': new Set(),
};

export const bus = {
  /** Subscribe to an event; returns an unsubscribe function. */
  on(evt: GameEvent, fn: Listener): () => void {
    listeners[evt].add(fn);
    return () => {
      listeners[evt].delete(fn);
    };
  },

  /** Notify every listener of an event. */
  emit(evt: GameEvent, payload?: unknown): void {
    for (const fn of listeners[evt]) fn(payload);
  },
};
