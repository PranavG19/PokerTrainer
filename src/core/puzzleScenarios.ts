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
  {
    id: 'call-flush-draw-odds',
    title: 'Calling a flush draw when the price is right',
    setup:
      'You defend the big blind with 9♥8♥, the button opens, and the flop is A♥K♥2♣ — you have nine hearts to the nut-ish flush. The button bets small. Do the numbers say call?',
    seatCount: 3,
    // bb-defend layout: button on seat 1 → seat 0 is the BB (hero), seat 1 the opener, seat 2 the SB.
    // Postflop the BB (hero) acts first, so the hero checks, the opener bets, and the hero calls with
    // the right price — the fundamental pot-odds decision, played out.
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['9h', '8h'],
      ['Ac', 'Qd'],
      ['7s', '3d'],
    ],
    board: ['Ah', 'Kh', '2c', '4s', 'Jd'],
    // Preflop: opener raises to 125 (step 0 = hero calls), SB folds. Flop: hero checks first (step 1),
    // opener bets 75, hero calls getting the price with the flush draw (step 2).
    villainScript: [
      { kind: 'raise', to: 125 }, // seat 1 opens
      { kind: 'fold' }, // seat 2 (SB) folds
      { kind: 'bet', to: 75 }, // seat 1 c-bets the flop after the hero checks
    ],
    target: [
      {
        action: 'call',
        explanation:
          'A suited connector defending the big blind closing the action for one more bet is a routine call — you have a price and position is only one seat away.',
      },
      {
        action: 'check',
        explanation:
          'First to act on the flop with a draw, check to the raiser: they will c-bet most of their range, so you keep their bluffs in and get to continue with a hand that wants to see cards cheaply rather than announce its strength.',
      },
      {
        action: 'call',
        explanation:
          'Nine hearts give roughly a third of the pot in equity on the flop, and a small c-bet lays you far better than that price — call. This is pot odds in one move: the draw is worth more than the bet costs, so continuing prints even before you count the times you also make a better hand than a pair.',
      },
    ],
  },
  {
    id: 'fold-open-to-3bet',
    title: 'Folding a loose open facing a 3-bet',
    setup:
      'You open the button with A♦5♦ — a fine steal — but the big blind 3-bets. A suited ace likes to see a flop, yet against a re-raise it is on the wrong side of the range. Not every open gets to continue.',
    seatCount: 3,
    // btn-open layout: button on seat 0 (hero) opens first preflop. A blind can then 3-bet and the
    // action returns to the hero, who must decide whether the open can continue.
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (button). Seat 1 = SB. Seat 2 = BB (the 3-bettor).
    holes: [
      ['Ad', '5d'],
      ['7c', '2h'],
      ['Ks', 'Kh'], // KK for the 3-bettor — a hand that dominates A5s
    ],
    board: ['Qc', 'Jd', '6s', '3h', '9c'],
    // Hero opens (step 0), SB folds, BB 3-bets to 400; the hero folds facing the 3-bet (step 1).
    villainScript: [
      { kind: 'fold' }, // SB folds
      { kind: 'raise', to: 400 }, // BB 3-bets
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'A5s is a standard button open: suited, an ace blocker, and it flops straights and flushes. Stealing the blinds with it is routine and profitable.',
      },
      {
        action: 'fold',
        explanation:
          'Facing a 3-bet out of position, A5s is near the bottom of your opening range and dominated by the value hands that re-raise (AK/AQ/AA/KK/QQ). You can defend some suited aces by calling or 4-bet-bluffing, but a small offsuit-kicker suited ace with no initiative and no position is a clean fold. Opening wide is correct; continuing against strength with the weakest part of that range is the leak.',
      },
    ],
  },
  {
    id: 'barrel-turn-overpair',
    title: 'Barrelling the turn with an overpair',
    setup:
      'You open Q♥Q♠ from the cutoff, the big blind calls, and the flop is J♦7♣3♠. You bet, they call. The turn is the 2♥ — a total blank. Do you keep firing?',
    seatCount: 3,
    // cbet-dry-ace seating (button on seat 2): the hero (seat 0) acts FIRST on every postflop street,
    // so the hero bets the flop and can barrel the turn, with the caller acting after each bet.
    button: 2,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (CO/opener). Seat 1 = BB (caller). Seat 2 = button.
    holes: [
      ['Qh', 'Qs'],
      ['Ah', 'Td'],
      ['4s', '4d'],
    ],
    board: ['Jd', '7c', '3s', '2h', '8c'],
    // Button folds preflop, BB calls the open; on the flop the BB calls the hero's bet; on the turn
    // the BB calls again. The hero acts first each postflop street (see the trace), so villain
    // entries land after the hero's bet on that street.
    villainScript: [
      { kind: 'fold' }, // button folds preflop
      { kind: 'call' }, // BB calls the open
      { kind: 'call' }, // BB calls the flop bet
      { kind: 'call' }, // BB calls the turn bet
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'QQ is a premium cutoff open — a big pair that wants to build a pot against the blinds.',
      },
      {
        action: 'bet',
        explanation:
          'On J-7-3 your overpair is far ahead of a big-blind calling range: bet for value and to charge the draws and worse pairs that will pay you.',
      },
      {
        action: 'bet',
        explanation:
          'The 2 changes nothing — it completes no draw and improves nothing that called the flop. Keep betting: your overpair is still ahead, the caller’s range is capped to worse Jx and draws, and a second barrel builds the pot while denying equity. Value hands bet again on blank turns; checking here only lets a worse hand catch up or bluff you off the best hand.',
      },
    ],
  },
  {
    id: 'call-river-bluffcatch',
    title: 'Calling a river bluff-catch with second pair',
    setup:
      'You open T♣9♣ on the button, the big blind calls, and you check J♠9♦4♥ and the 2♣ turn back for pot control. On the 7♠ river the big blind — who has shown nothing all hand — fires a bet. Do you pay it off?',
    seatCount: 3,
    // pot-control-ip layout (button on seat 0 = hero): the hero opens preflop first, but is the button
    // so acts LAST on every postflop street. The live caller is the BB (seat 2), who therefore acts
    // first postflop — letting them bet INTO the hero on the river, the bluff-catch spot.
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (button/opener). Seat 1 = SB. Seat 2 = BB (caller/bluffer).
    holes: [
      ['Tc', '9c'],
      ['3s', '3d'], // SB: folds preflop
      ['Ah', 'Kh'], // BB: misses everything — ace-high, a pure bluff on the river
    ],
    board: ['Js', '9d', '4h', '2c', '7s'],
    // SB folds preflop, BB calls. Postflop the hero acts last, so on each street the BB acts first:
    // BB checks the flop, checks the turn, then bets the river as a bluff.
    villainScript: [
      { kind: 'fold' }, // SB folds the open
      { kind: 'call' }, // BB calls
      { kind: 'check' }, // BB checks the flop (acts first postflop)
      { kind: 'check' }, // BB checks the turn
      { kind: 'bet', to: 150 }, // BB bluffs the river
    ],
    target: [
      {
        action: 'raise',
        explanation: 'T9s is a standard button open — suited, connected, and it plays well in position.',
      },
      {
        action: 'check',
        explanation:
          'You flopped second pair on J-9-4. It has showdown value but is not strong enough to bet three streets; checking back controls the pot, keeps the bluffs in the caller’s range, and lets you get to showdown cheaply.',
      },
      {
        action: 'check',
        explanation:
          'The 2 is a blank and your hand has not improved. Keep pot-controlling: betting now only folds out worse and gets called by better, while checking keeps the pot small with a medium hand.',
      },
      {
        action: 'call',
        explanation:
          'The 7 completes no obvious draw, and a player who checked the flop and turn has a range full of missed draws and give-ups. Second pair beats every bluff, and you are getting a price — folding here is the over-fold that pays off every bluffer. When they have shown no strength and the price is right, one pair is enough to catch a bluff.',
      },
    ],
  },
  {
    id: 'fold-multiway-ajo',
    title: 'Folding A♠J♦ into a raise and a cold-call',
    setup:
      'Four-handed, you have A♠J♦ in the big blind. UTG raises to 3bb, the button cold-calls, and it folds to you. Heads-up AJo is a call — but a raise AND a caller in front is a different, much stronger, world.',
    seatCount: 4,
    // 4-handed with button on seat 2: SB=3, BB=0 (hero), first to act preflop = seat 1 (UTG). So the
    // hero (BB) acts LAST preflop, after UTG raises and the button cold-calls — the multiway spot.
    button: 2,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (BB). Seat 1 = UTG (raiser). Seat 2 = button (cold-caller). Seat 3 = SB.
    holes: [
      ['As', 'Jd'],
      ['Kc', 'Kd'], // UTG: a real hand that dominates AJo
      ['Qh', 'Qs'], // button cold-caller: also crushing AJo
      ['7c', '2h'], // SB: folds
    ],
    board: ['Td', '8s', '5c', '4h', '2d'],
    // UTG raises to 150, button calls, SB folds; the action reaches the hero, who folds.
    villainScript: [
      { kind: 'raise', to: 150 }, // seat 1 (UTG) opens
      { kind: 'call' }, // seat 2 (button) cold-calls
      { kind: 'fold' }, // seat 3 (SB) folds
    ],
    target: [
      {
        action: 'fold',
        explanation:
          'AJo is a trap hand multiway. A raise and a cold-call in front both beat it more often than not — you are dominated by AK/AQ/AJs and every over-pair, and when you flop a pair it is often the second-best one that pays off a better ace. Position is bad and the field is strong. Heads-up you would defend; against a raise plus a caller, folding is the disciplined, money-saving play. The strength of a bet doubles when someone else has already called it.',
      },
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
