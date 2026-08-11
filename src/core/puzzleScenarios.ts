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
  {
    id: 'fold-kq-to-utg',
    title: 'Folding K♦Q♣ facing an early-position open',
    setup:
      'An early-position player opens to 3bb and it folds to you in the big blind with K♦Q♣, 100bb deep. It looks pretty — but who is doing the raising matters more than the two cards in your hand.',
    seatCount: 3,
    // Same seating as bb-defend-vs-btn: button on seat 1 → seat 0 is the BB (hero), seat 1 is the
    // opener and first to act preflop, seat 2 is the SB. The opener is seat 1, so the script's first
    // entry is its open; the hero then faces it with one decision.
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['Kd', 'Qc'],
      ['Ah', 'Js'],
      ['9c', '8d'],
    ],
    board: ['7h', '5s', '2c', 'Td', '4h'],
    // Seat 1 opens to 150; the hero folds facing it. One hero decision, so the rest is never reached.
    villainScript: [{ kind: 'raise', to: 150 }],
    target: [
      {
        action: 'fold',
        explanation:
          'KQo plays badly against a tight early-position opening range: it is dominated by AK/AQ/KK/QQ and rarely flops a pair it can stack off with. Out of position with no initiative, this is a clean fold — the discipline that separates a break-even player from a losing one is folding the hands that only look strong.',
      },
    ],
  },
  {
    id: '3bet-aa-vs-open',
    title: '3-betting A♠A♦ for value',
    setup:
      'A late-position player opens to 2.5bb and it folds to you in the big blind with A♠A♦. You could flat and keep them in — but with the best hand in poker, the goal is to build the pot now.',
    seatCount: 3,
    // Same seating as bb-defend-vs-btn: button on seat 1 makes seat 0 the BB (hero), seat 1 the
    // opener (first to act preflop), seat 2 the SB. So the villain opens BEFORE the hero acts, which
    // is what lets the hero 3-bet — the button-on-seat-0 layout would make the hero act first and no
    // 3-bet spot could exist.
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['As', 'Ad'],
      ['Kc', 'Qd'],
      ['7s', '3h'],
    ],
    board: ['Jh', '6c', '2d', '9s', '4c'],
    // Seat 1 opens to 125, seat 2 (SB) folds, then after the hero 3-bets seat 1 calls.
    villainScript: [
      { kind: 'raise', to: 125 },
      { kind: 'fold' },
      { kind: 'call' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'Aces want a big pot. 3-betting builds it immediately, charges worse hands to continue, and takes the betting lead — flatting lets the blinds in cheaply and turns your best-possible hand into a guessing game on later streets. Value your value.',
      },
    ],
  },
  {
    id: 'pot-control-ip',
    title: 'Checking back a marginal made hand in position',
    setup:
      'You open the button with J♠T♠, the big blind calls, and the flop is K♦8♣3♠. You have position and no pair — a good spot to control the pot, not build it.',
    seatCount: 3,
    // btn-open layout: button on seat 0 (hero). Preflop the hero opens first; postflop the hero (on
    // the button) acts LAST — in position — which is what makes checking back the flop possible.
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (button). Seat 1 = SB. Seat 2 = BB (the caller).
    holes: [
      ['Js', 'Ts'],
      ['4d', '2h'],
      ['Qc', '9d'],
    ],
    board: ['Kd', '8c', '3s', '6h', '5c'],
    // Preflop: hero opens (step 0), SB folds, BB calls. Flop: BB checks to the hero (step 1 = check
    // back). The line stops there — one open then a flop check-back is the whole lesson.
    villainScript: [
      { kind: 'fold' }, // SB folds the hero's open
      { kind: 'call' }, // BB calls
      { kind: 'check' }, // BB checks the flop to the hero
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'JTs is a fine button open: suited, connected, and it plays well in position against the blinds.',
      },
      {
        action: 'check',
        explanation:
          'K-8-3 rainbow gives you nothing but a gutshot and two overcards that are not really overcards to a king. Betting only folds out worse and gets called by better; checking back keeps the pot small, realises your equity for free, and lets you bluff-catch or improve on later streets. Pot control in position is a bet you DON’T make.',
      },
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
