/**
 * The starter puzzle library. Each scenario is a hand-authored teaching spot with a fixed deal and a
 * target line. They are deliberately small and preflop-to-flop focused — the first things a beginner
 * must internalise (position, opening, 3-bet defence, c-betting the right texture).
 *
 * Cards are strings ('Ah'); seat 0 is the hero. The board is written in full (five cards) even when
 * the target line ends earlier — streets never reached are simply never dealt by the engine.
 */

import type { Scenario } from './puzzle.js';

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'btn-open-aks',
    title: 'Opening the button with AKs',
    setup: 'Folded to you on the button with A♠K♠, 100bb deep. The blinds are still to act.',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['As', 'Ks'],
      ['7d', '2c'],
      ['9h', '4s'],
    ],
    board: ['Ah', 'Kd', '7c', '2h', '9s'],
    // Both blinds fold to the open.
    villainScript: [
      { kind: 'fold' },
      { kind: 'fold' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'AKs is a premium hand and the button is the best seat: opening pressures both blinds and takes the lead with position for the whole hand.',
      },
    ],
  },
  {
    id: 'bb-defend-vs-btn',
    title: 'Defending the big blind vs a button open',
    setup:
      'The button opens to 2.5bb and folds to you in the big blind with Q♥J♥. You have a price and position is only one seat away.',
    seatCount: 3,
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (BB). Seat 1 = button (opener). Seat 2 = SB.
    holes: [
      ['Qh', 'Jh'],
      ['Ad', '5c'],
      ['8s', '3d'],
    ],
    board: ['Qc', 'Th', '4s', '7d', '2c'],
    // Button raises to 125, SB folds, then (after the hero calls) button checks the flop back.
    villainScript: [
      { kind: 'raise', to: 125 },
      { kind: 'fold' },
      { kind: 'check' },
    ],
    target: [
      {
        action: 'call',
        explanation:
          'QJs is far too strong to fold getting this price closing the action, and it flops well — but flatting keeps the opener’s bluffs in rather than 3-betting a hand that plays great in position postflop for the caller.',
      },
      {
        action: 'bet',
        explanation:
          'You flopped top pair with a strong kicker on Q-T-4. When it checks to you, bet for value and to charge the many draws this connected board gives their range.',
      },
    ],
  },
  {
    id: 'cbet-dry-ace',
    title: 'C-betting a dry ace-high board',
    setup:
      'You open A♣Q♦ from the cutoff, only the big blind calls, and the flop is A♦7♠2♣ — about as dry as boards come.',
    seatCount: 3,
    button: 2,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (CO/opener). Seat 1 = BB (caller). Seat 2 = button.
    holes: [
      ['Ac', 'Qd'],
      ['Kh', 'Jd'],
      ['6s', '6d'],
    ],
    board: ['Ad', '7s', '2c', 'Ts', '3h'],
    // Button folds preflop, BB calls the open, then checks the flop to the hero.
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'check' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'AQo is a clear cutoff open: a strong, dominating hand that wants to build a pot heads-up in position.',
      },
      {
        action: 'bet',
        explanation:
          'A dry A-7-2 board smashes your opening range and misses the caller’s. A small c-bet prints: you hold top pair top-kicker and their range has almost no continues, so bet for value and to deny the free card.',
      },
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
