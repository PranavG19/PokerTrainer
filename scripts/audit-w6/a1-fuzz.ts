// Invariants 1-6: conservation, paid-in, real pot, termination, legality, side pots.
import { fuzz, printReport } from './lib.js';

const seeds = (n: number, off = 0): number[] => Array.from({ length: n }, (_, i) => i + 1 + off);

printReport('4x5000 @25/50, 40 hands/seed, 200 seeds', fuzz({
  seeds: seeds(200),
  stacks: [5000, 5000, 5000, 5000],
  sb: 25,
  bb: 50,
  handsPerSeed: 40,
  label: 'a',
}));

printReport('uneven short stacks 4-handed', fuzz({
  seeds: seeds(200, 1000),
  stacks: [300, 1200, 75, 5000],
  sb: 25,
  bb: 50,
  handsPerSeed: 40,
  label: 'b',
}));

printReport('very short: sub-blind stacks', fuzz({
  seeds: seeds(300, 2000),
  stacks: [30, 55, 120, 900],
  sb: 25,
  bb: 50,
  handsPerSeed: 30,
  label: 'c',
}));

printReport('heads-up 2 seats', fuzz({
  seeds: seeds(200, 3000),
  stacks: [1000, 1000],
  sb: 25,
  bb: 50,
  handsPerSeed: 40,
  label: 'd',
}));

printReport('6-handed mixed depths', fuzz({
  seeds: seeds(150, 4000),
  stacks: [5000, 2500, 900, 175, 60, 40],
  sb: 25,
  bb: 50,
  handsPerSeed: 40,
  label: 'e',
}));

printReport('3-handed all sub-BB', fuzz({
  seeds: seeds(300, 5000),
  stacks: [40, 40, 40],
  sb: 25,
  bb: 50,
  handsPerSeed: 20,
  label: 'f',
}));

printReport('sb==bb==1 tiny blinds deep', fuzz({
  seeds: seeds(150, 6000),
  stacks: [100, 100, 100, 100],
  sb: 1,
  bb: 2,
  handsPerSeed: 40,
  label: 'g',
}));
