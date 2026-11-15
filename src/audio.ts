// Daily Stack — tiny synthesized sound effects (no audio files).
// One lazy AudioContext + master gain, created on the first call. Every entry
// point is safe before a user gesture: creation cannot throw, resume() rejection
// is swallowed, and each voice is wrapped so audio can never break gameplay.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function context(): AudioContext | null {
  if (ctx && ctx.state !== 'closed') {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return ctx;
  }

  const Ctor =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;

  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.2; // master volume
    master.connect(ctx.destination);
    void ctx.resume().catch(() => {}); // still blocked until the first gesture — fine
    return ctx;
  } catch {
    ctx = null;
    master = null;
    return null;
  }
}

interface ToneOptions {
  type?: OscillatorType;
  delay?: number;
  attack?: number;
  /** Pitch target for an exponential slide, e.g. a rising pickup blip. */
  slideTo?: number;
}

/** One enveloped oscillator note. */
function tone(freq: number, duration: number, peak: number, opts: ToneOptions = {}): void {
  const audioCtx = context();
  const out = master;
  if (!audioCtx || !out) return;

  const t = audioCtx.currentTime + (opts.delay ?? 0);
  const osc = audioCtx.createOscillator();
  const env = audioCtx.createGain();

  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(20, freq), t);
  if (opts.slideTo !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slideTo), t + duration);
  }

  const attack = Math.min(opts.attack ?? 0.006, duration * 0.5);
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + duration + 0.05);
  osc.onended = () => {
    osc.disconnect();
    env.disconnect();
  };
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // Never let a failed AudioContext operation surface into the game loop.
  }
}

export const sfx = {
  /** Soft rising blip when a block is picked up. */
  pickup(): void {
    safe(() => tone(430, 0.13, 0.45, { type: 'triangle', slideTo: 760, attack: 0.012 }));
  },

  /** Short wooden click/pluck when a block snaps into a cell. */
  snap(): void {
    safe(() => {
      tone(250, 0.075, 0.55, { type: 'triangle', slideTo: 150, attack: 0.003 });
      tone(900, 0.02, 0.12, { type: 'square', slideTo: 480, attack: 0.001 });
    });
  },

  /** Low, soft buzz for an impossible placement or rotation. */
  invalid(): void {
    safe(() => {
      tone(115, 0.2, 0.3, { type: 'triangle', slideTo: 95, attack: 0.012 });
      tone(121, 0.2, 0.2, { type: 'triangle', slideTo: 99, attack: 0.012 });
    });
  },

  /** Tiny tick for poke/ray UI buttons. */
  click(): void {
    safe(() => tone(1800, 0.018, 0.18, { type: 'triangle', attack: 0.001 }));
  },

  /** Two-note chime for advancing the tutorial. */
  step(): void {
    safe(() => {
      tone(880, 0.3, 0.28);
      tone(1760, 0.2, 0.05);
      tone(1318.5, 0.35, 0.26, { delay: 0.09 });
      tone(2637, 0.22, 0.045, { delay: 0.09 });
    });
  },

  /** Four-note major arpeggio (C5 E5 G5 C6) with a small shimmer on top. */
  win(): void {
    safe(() => {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      for (let i = 0; i < notes.length; i++) {
        const delay = i * 0.085;
        tone(notes[i], 0.45, 0.34, { type: 'triangle', delay, attack: 0.01 });
        tone(notes[i] * 2, 0.3, 0.06, { delay, attack: 0.01 });
      }
      // Sparkle tail.
      tone(2093, 0.6, 0.04, { delay: 0.32 });
      tone(2637, 0.7, 0.035, { delay: 0.36 });
    });
  },
};
