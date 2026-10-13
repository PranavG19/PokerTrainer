/** Seeded PRNG. Determinism is the foundation of every e2e assertion in this app. */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates. Mutates and returns the array so callers can chain. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/**
 * A source of cryptographically secure random bytes. Core has no crypto import of its own (it also runs
 * in the renderer), so the caller injects one: `node:crypto.randomBytes` in main, never `Math.random`.
 * Only multiplayer deals use it; solo play keeps the seeded mulberry32 above for reproducible training.
 */
export type RandomBytes = (length: number) => Uint8Array;

/** An unbiased integer in [0, bound) from 32 random bits, rejecting the biased tail. */
export function uniformInt(bound: number, next32: () => number): number {
  if (!Number.isInteger(bound) || bound < 1 || bound > 2 ** 32) throw new RangeError(`bound ${bound}`);
  const limit = 2 ** 32 - (2 ** 32 % bound);
  for (;;) {
    const value = next32();
    if (value < limit) return value % bound;
  }
}

/** 32-bit words read off a byte source, refilled in blocks so a 52-card shuffle is one or two calls. */
export function wordsFrom(random: RandomBytes): () => number {
  let pool: Uint8Array = new Uint8Array(0);
  let offset = 0;
  return () => {
    if (offset + 4 > pool.length) {
      pool = random(256);
      offset = 0;
    }
    const value = ((pool[offset] << 24) | (pool[offset + 1] << 16) | (pool[offset + 2] << 8) | pool[offset + 3]) >>> 0;
    offset += 4;
    return value;
  };
}

/** Fisher-Yates driven by unbiased 32-bit draws. Mutates and returns the array, like shuffle(). */
export function shuffleWith<T>(items: T[], next32: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = uniformInt(i + 1, next32);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
