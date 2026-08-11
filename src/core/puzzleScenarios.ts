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
          'QJs is far too strong to fold getting this price closing the action, and it flops well — but flatting keeps the opener’s bluff-heavy range in rather than 3-betting a hand that realises its equity fine as a call, even out of position.',
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
          'A dry A-7-2 board smashes your opening range and misses the caller’s. A small c-bet prints: you hold top pair with a strong queen kicker and their range has almost no continues, so bet for value and to deny the free card.',
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
          'Facing a 3-bet, A5s is near the bottom of your opening range and dominated by the value hands that re-raise (AK/AQ/AA/KK/QQ). You can defend some suited aces by calling or 4-bet-bluffing, but even in position a low-kicker suited ace with no initiative is a clean fold against a value-heavy re-raise. Opening wide is correct; continuing against strength with the weakest part of that range is the leak.',
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
          'The 7 bricks nearly every draw — the gutshots and the missed flush picks all whiff — and a player who checked the flop and turn has a range full of missed draws and give-ups. Second pair beats every bluff, and you are getting a price — folding here is the over-fold that pays off every bluffer. When they have shown no strength and the price is right, one pair is enough to catch a bluff.',
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
          'AJo is a trap hand multiway. A raise and a cold-call in front both beat it more often than not — you are dominated by AK/AQ and every over-pair (and even AJs only ever chops or draws out on you), and when you flop a pair it is often the second-best one that pays off a better ace. Position is bad and the field is strong. Heads-up you would defend; against a raise plus a caller, folding is the disciplined, money-saving play. The strength of a bet doubles when someone else has already called it.',
      },
    ],
  },
  {
    id: 'isolate-limper-aqs',
    title: 'Raising to isolate a limper with A♠Q♠',
    setup:
      'It folds to the button, who just calls the big blind — a limp, not a raise. The small blind folds and you are in the big blind with A♠Q♠. A limp is weakness; do you check your option, or make them pay for it?',
    seatCount: 3,
    // bb-defend seating (button on seat 1): seat 0 = BB (hero), seat 1 = button (first to act preflop),
    // seat 2 = SB. The button LIMPS (calls the BB) and the SB folds, so the action reaches the hero in
    // the BB with the option to check or raise — the isolation decision.
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (BB). Seat 1 = button (limper). Seat 2 = SB (folds).
    holes: [
      ['As', 'Qs'],
      ['Kc', '9d'], // button: a weak, limpable holding — dominated by AQ
      ['7h', '2d'], // SB: folds
    ],
    board: ['8c', '6h', '3s', 'Jd', '4c'],
    // Button limps (calls the BB), SB folds; the action reaches the hero, who raises. One decision, so
    // the streets past preflop are never reached.
    villainScript: [
      { kind: 'call' }, // button limps in
      { kind: 'fold' }, // SB folds
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'A limp caps the button’s range — a strong hand would have raised — so A♠Q♠ is well ahead and wants a bigger pot. With the small blind already folded you are heads-up against the limper, so raising to isolate builds the pot, charges him to continue, and takes the initiative with a hand that dominates the offsuit aces and broadways a limper shows up with. Checking your option lets a weak hand see a free flop and realise equity it has no right to; make them pay to play against you.',
      },
    ],
  },
  {
    id: 'squeeze-kk-vs-open-call',
    title: 'Squeezing K♥K♠ over an open and a call',
    setup:
      'Four-handed with K♥K♠ in the big blind. UTG raises to 3bb, the button flat-calls, and it folds to you. A raise AND a caller in front — with the second-best hand in poker, that crowd is an invitation, not a warning.',
    seatCount: 4,
    // Same verified 4-handed seating as fold-multiway-ajo: button on seat 2 → SB=3, BB=0 (hero), first
    // to act preflop = seat 1 (UTG). The hero (BB) acts LAST preflop, after UTG opens and the button
    // cold-calls — so the hero can squeeze (3-bet over an open + a call).
    button: 2,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (BB). Seat 1 = UTG (opener). Seat 2 = button (cold-caller). Seat 3 = SB.
    holes: [
      ['Kh', 'Ks'],
      ['Ad', 'Qc'], // UTG: a strong-but-dominated open
      ['Js', 'Ts'], // button: a speculative flat that hates a big raise
      ['6c', '2h'], // SB: folds
    ],
    board: ['9d', '7s', '3c', 'Qh', '4d'],
    // UTG opens to 150, button calls, SB folds; the action reaches the hero, who squeezes. One
    // decision, so the streets past preflop are never reached.
    villainScript: [
      { kind: 'raise', to: 150 }, // seat 1 (UTG) opens
      { kind: 'call' }, // seat 2 (button) cold-calls
      { kind: 'fold' }, // seat 3 (SB) folds
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'KK crushes both ranges: the opener rarely has AA/KK and the flat-caller has capped away their monsters by not 3-betting. Squeezing builds a huge pot with the best hand, charges two players to continue, and often wins the dead money outright when both give up. Flatting invites a cheap multiway flop where an ace or a coordinated board can freeze you — the opposite of what your hand wants. With a premium behind a raise and a call, the extra caller is a reason to raise BIGGER, not to slow down.',
      },
    ],
  },
  {
    id: 'checkraise-set-wet',
    title: 'Check-raising a set on a wet board',
    setup:
      'You defend the big blind with 7♥7♠, the button opens, and the flop is 7♦8♠9♥ — you flopped bottom set on a board screaming with straight and flush draws. First to act, do you lead, or check and let the raiser bet into you?',
    seatCount: 3,
    // bb-defend seating (button on seat 1): seat 0 = BB (hero), seat 1 = opener, seat 2 = SB. Postflop
    // the BB (hero) acts FIRST, so the hero checks, the opener c-bets, and the hero check-raises — the
    // order verified by tracing the engine (hero check → V1 bet → hero raise, action reopens).
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (BB). Seat 1 = button (opener/c-bettor). Seat 2 = SB (folds).
    holes: [
      ['7h', '7s'],
      ['Ad', 'Kd'], // opener: overcards + a backdoor draw — a hand that will happily c-bet
      ['Qc', '4s'], // SB: folds
    ],
    board: ['7d', '8s', '9h', '2c', '3d'],
    // Preflop: opener raises to 125 (step 0 = hero calls), SB folds. Flop: hero checks first (step 1),
    // opener c-bets 75, hero check-raises (step 2). One postflop decision after the raise, so the line
    // ends there — the check-raise is the whole lesson.
    villainScript: [
      { kind: 'raise', to: 125 }, // seat 1 opens
      { kind: 'fold' }, // seat 2 (SB) folds
      { kind: 'bet', to: 75 }, // seat 1 c-bets the flop after the hero checks
    ],
    target: [
      {
        action: 'call',
        explanation:
          'A pair defending the big blind closing the action for one bet is a routine call, and 77 flops a set often enough to make continuing easy.',
      },
      {
        action: 'check',
        explanation:
          'First to act with a monster, check to the pre-flop raiser: they c-bet most of their range, so checking keeps their bluffs and overcards in and sets up a raise, where leading would fold out everything you beat.',
      },
      {
        action: 'raise',
        explanation:
          'Bottom set on a connected 7-8-9 is a huge hand on a dangerous board — check-raise for value AND protection. Every overcard and the many straight draws this board gives (any T, 6, J or 5 makes or draws to a straight) have real equity against you, so charge them the maximum now rather than letting a free card complete the board. Slow-playing a wet board is how sets lose stacks; against a c-bet, raising builds the pot while your hand is the clear favourite and denies the equity that a cheap turn would hand your opponent.',
      },
    ],
  },
  {
    id: 'fold-flop-airball',
    title: 'Giving up when you completely miss',
    setup:
      'You defend the big blind with 8♣5♣ — a fine price preflop — and the button opens. The flop is A♦K♥7♠: no pair, no draw, nothing. They c-bet. A price to call preflop is not a licence to call the flop with air.',
    seatCount: 3,
    // bb-defend seating (button on seat 1): seat 0 = BB (hero), seat 1 = opener, seat 2 = SB. Postflop
    // the BB (hero) acts FIRST, so the hero checks, the opener c-bets, and the hero folds the whiff.
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (BB). Seat 1 = button (opener/c-bettor). Seat 2 = SB (folds).
    holes: [
      ['8c', '5c'],
      ['Ah', 'Qd'], // opener: top pair — a hand that c-bets this board for value
      ['Jd', '3h'], // SB: folds
    ],
    board: ['Ad', 'Kh', '7s', '2c', '9d'],
    // Preflop: opener raises to 125 (step 0 = hero calls), SB folds. Flop: hero checks first (step 1),
    // opener c-bets 75, hero folds the airball (step 2). One postflop decision, so the line ends there.
    villainScript: [
      { kind: 'raise', to: 125 }, // seat 1 opens
      { kind: 'fold' }, // seat 2 (SB) folds
      { kind: 'bet', to: 75 }, // seat 1 c-bets the flop after the hero checks
    ],
    target: [
      {
        action: 'call',
        explanation:
          'A suited hand closing the action in the big blind for one more bet has the price to defend and see a flop — routine.',
      },
      {
        action: 'check',
        explanation:
          'First to act on a flop that missed you completely, check: you have nothing to bet for, and leading into the raiser with air only builds a pot you will have to abandon.',
      },
      {
        action: 'fold',
        explanation:
          'A-K-7 is the worst board for 8♣5♣ — no pair, no straight draw, no flush draw, and it smashes the range of the player who raised and c-bet. You have almost no equity and no way to continue profitably; calling to "see a turn" or float a bluff just burns chips out of position with a hand that cannot improve to anything that wins. The price you got to defend preflop bought one flop, not a call-down. Folding the hands that whiff is where most of a big blind’s money is saved.',
      },
    ],
  },
  {
    id: 'call-3bet-ip-aqs',
    title: 'Calling a 3-bet in position with A♠Q♠',
    setup:
      'You open the button with A♠Q♠ and the big blind 3-bets. A5s folded here — but this is a much stronger hand, and you have position. Not every open folds to a re-raise; the strong ones with position continue.',
    seatCount: 3,
    // btn-open layout: button on seat 0 (hero) opens first, a blind 3-bets, and the action returns to
    // the hero — the same structure as fold-open-to-3bet, but with a hand that CALLS rather than folds.
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (button). Seat 1 = SB. Seat 2 = BB (the 3-bettor).
    holes: [
      ['As', 'Qs'],
      ['7c', '2c'], // SB: folds
      ['Ah', 'Jh'], // BB: a hand its 3-betting range contains and that AQs is ahead of
    ],
    board: ['Td', '9d', '4h', '3c', '2h'],
    // Hero opens (step 0), SB folds, BB 3-bets to 400; the hero calls in position (step 1). The line
    // ends at the call, so the flop is never reached — the preflop continue is the whole lesson.
    villainScript: [
      { kind: 'fold' }, // SB folds
      { kind: 'raise', to: 400 }, // BB 3-bets
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'A♠Q♠ is a premium button open — suited, two big cards, and it dominates the offsuit broadways the blinds defend with. Raising is automatic.',
      },
      {
        action: 'call',
        explanation:
          'Unlike A5s, A♠Q♠ is far too strong to fold to a 3-bet — it dominates the bluffs and flips with or beats much of a merged 3-betting range, and it flops top pair, flushes and straights. With position on the raiser, calling keeps their bluffs in and lets you realise that equity in a controlled pot, while 4-betting bloats the pot and folds out exactly the worse hands you want to keep. 3-betting is not a fold button; a strong hand with position calls and plays poker.',
      },
    ],
  },
  {
    id: '4bet-aa-vs-3bet',
    title: '4-betting A♣A♥ for value',
    setup:
      'You open the button with A♣A♥ and the big blind 3-bets. A5s folds and AQs calls here — but with the best hand in poker, flatting is a mistake. This is where you put the money in.',
    seatCount: 3,
    // btn-open layout: button on seat 0 (hero) opens, a blind 3-bets, and the action returns to the
    // hero — the top of the same tree as fold-open-to-3bet (fold) and call-3bet-ip-aqs (call): here, 4-bet.
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (button). Seat 1 = SB. Seat 2 = BB (the 3-bettor).
    holes: [
      ['Ac', 'Ah'],
      ['8c', '3d'], // SB: folds
      ['Kd', 'Ks'], // BB: KK — a hand that 3-bets and will stack off, so the value is real
    ],
    board: ['Qh', '7s', '2d', '5c', '9h'],
    // Hero opens (step 0), SB folds, BB 3-bets to 400; the hero 4-bets (step 1). The line ends at the
    // 4-bet — putting in the value raise is the whole lesson.
    villainScript: [
      { kind: 'fold' }, // SB folds
      { kind: 'raise', to: 400 }, // BB 3-bets
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'Pocket aces open from anywhere; the button is no exception. Raise and start building the pot with the best possible hand.',
      },
      {
        action: 'raise',
        explanation:
          'Facing a 3-bet with aces, 4-bet for value — flatting caps your range and lets a hand like KK or AK realise equity it should be paying dearly for. A 4-bet gets max value from KK (which almost never folds) and gets action from the stronger part of their range, while it wins the pot outright when the 3-bet was a bluff. You will rarely be beaten; the only mistake with aces here is playing them small. Charge the second-best hands the maximum while you hold the best one.',
      },
    ],
  },
  {
    id: 'value-bet-river-flush',
    title: 'Value-betting the river when your draw gets there',
    setup:
      'You open 9♥8♥ on the button and the big blind calls. On A♦7♥3♥ you have a flush draw; the BB bets, you call, and you call again on the T♠ turn. The river is the 6♥ — your flush is in. The BB checks. Do you check it back, or bet?',
    seatCount: 3,
    // pot-control-ip layout (button on seat 0 = hero): the hero opens preflop but, on the button, acts
    // LAST on every postflop street. The BB (seat 2) acts first postflop — betting into the draw on the
    // flop and turn, then checking the river when the flush completes, giving the hero the value spot.
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (button/opener). Seat 1 = SB (folds). Seat 2 = BB (bets the draw streets, gives up river).
    holes: [
      ['9h', '8h'],
      ['4d', '2c'], // SB: folds
      ['Ac', 'Ks'], // BB: top pair, bets flop and turn, then checks when the third heart lands
    ],
    board: ['Ad', '7h', '3h', 'Ts', '6h'],
    // SB folds preflop, BB calls the open. Postflop the hero acts last: BB c-bets the flop, the hero
    // calls the draw; BB bets the turn, the hero calls; the 6♥ completes the flush and the BB checks.
    villainScript: [
      { kind: 'fold' }, // SB folds the open
      { kind: 'call' }, // BB calls preflop
      { kind: 'bet', to: 100 }, // BB c-bets the flop (acts first postflop)
      { kind: 'bet', to: 250 }, // BB bets the turn
      { kind: 'check' }, // BB checks the river when the flush completes
    ],
    target: [
      {
        action: 'raise',
        explanation: '9♥8♥ is a fine button open — suited, connected, and it plays well in position.',
      },
      {
        action: 'call',
        explanation:
          'A nine-high flush draw with two live overcards to little of the board is an easy call in position: you have the price, the equity, and position to realise it on later streets.',
      },
      {
        action: 'call',
        explanation:
          'The Ten actually helps: you now have an open-ended straight draw (any 6 or Jack makes a straight) to go with the flush draw, so your equity has grown. Call getting a reasonable price with position — you keep the door open to the many rivers that complete your flush or straight.',
      },
      {
        action: 'bet',
        explanation:
          'Your flush got there and the big blind checked — do not check it back. This is the whole point of chasing the draw: when it comes in you have to get paid, or the times you missed cost you for nothing. Bet for value. A hand like top pair will often call, worse flushes and two pair pay you off, and checking back wins exactly the same as folding did on the missed rivers. Missing a value bet is as expensive as paying off a bluff; when you make the hand you were drawing to, charge for it.',
      },
    ],
  },
  {
    id: 'fold-3bet-bluff-to-4bet',
    title: 'Folding your 3-bet bluff to a 4-bet',
    setup:
      'It folds to the button, who opens to 3bb (150). The small blind folds, and the action is on you in the big blind with A♥ 5♥, 100bb deep.',
    seatCount: 3,
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['Ah', '5h'],
      ['Ks', 'Kd'],
      ['7c', '2d'],
    ],
    board: ['Qs', 'Js', '8d', '3c', '9h'],
    villainScript: [
      { kind: 'raise', to: 150 },
      { kind: 'fold' },
      { kind: 'raise', to: 1050 },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'A♥ 5♥ is a textbook light 3-bet: the ace blocks the opener\'s strongest value combos (AA/AK) and the suited wheel card gives you equity and playability when called. You re-raise as a bluff to fold out the button\'s weak opens and take the initiative — the value is in the fold equity, not in ace-high going to showdown.',
      },
      {
        action: 'fold',
        explanation:
          'The 4-bet is the tell: the button reps a range of KK+/AK that crushes you, and ace-high has far too little equity to call off 100bb. A light 3-bet is a bluff, not a hand that can continue against a re-raise — folding here is the plan, not weakness. Give the bluff up cheaply and keep your stack for a better spot; calling or 5-bet-jamming A5s just lights money on fire against a range that has you dominated.',
      },
    ],
  },
  {
    id: 'semibluff-checkraise-draw',
    title: 'Check-raising a big flush draw as a semi-bluff',
    setup:
      'You defend the big blind with A♠K♠, the button opens, and the flop comes Q♠8♠3♥. First to act, you check, and the opener continuation-bets. You have no pair yet — just the nut flush draw and two overcards. Call, or raise?',
    seatCount: 3,
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['As', 'Ks'],
      ['Qd', 'Jd'],
      ['7c', '2h'],
    ],
    board: ['Qs', '8s', '3h', '4c', '6d'],
    villainScript: [
      { kind: 'raise', to: 125 },
      { kind: 'fold' },
      { kind: 'bet', to: 75 },
    ],
    target: [
      {
        action: 'call',
        explanation:
          'A suited broadway defending the big blind closing the action for one more bet is a routine call — you have the price and a hand that flops flushes, straights and top pairs.',
      },
      {
        action: 'check',
        explanation:
          'First to act against the pre-flop raiser, check: they c-bet most of their range, so checking keeps their bluffs and worse hands in and sets up a raise, where leading out folds out the hands you want to attack.',
      },
      {
        action: 'raise',
        explanation:
          'This is the bluff mirror of check-raising a set. You have no made hand, but the nut flush draw plus two overcards is a monster of equity — you are close to a coin-flip against top pair even when called. Check-raising wins the pot outright when the opener gives up (fold equity NOW), and when called you have a huge draw to the best hand (equity LATER). Raising a strong draw beats calling because it adds the times they fold to the times you hit, and it lets YOU set the price instead of paying theirs.',
      },
    ],
  },
  {
    id: 'double-barrel-semibluff',
    title: 'Double-barrelling a turn semi-bluff',
    setup:
      'You open A♠K♠ from the small blind, the big blind calls, and the flop is Q♦ 8♠ 3♣. You bet, they call. The turn is the 5♠. Do you fire again?',
    seatCount: 3,
    button: 2,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['As', 'Ks'],
      ['Jh', 'Td'],
      ['6c', '6d'],
    ],
    board: ['Qd', '8s', '3c', '5s', '2d'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'call' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'A♠K♠ is a premium suited hand: raise to seize the initiative and build the pot as the pre-flop opener, playing your strongest high-card and backdoor equity aggressively against the big blind.',
      },
      {
        action: 'bet',
        explanation:
          'Q♦ 8♠ 3♣ completely misses your hand, but as the raiser you hold the range and nut advantage on this dry board. C-bet as a bluff — two overcards plus a backdoor flush mean you fold out the many hands that whiffed while keeping outs to improve when called.',
      },
      {
        action: 'bet',
        explanation:
          'The 5♠ gives you the nut flush draw to go with your two overcards — a genuine semi-bluff, not stubborn bluffing. Barrel again: the fold equity pressures the weak pairs and draws the big blind called the flop with, and even when called you can still make the nut flush or pair your ace or king. Here real outs back the aggression.',
      },
    ],
  },
  {
    id: 'fold-to-raise-on-cbet',
    title: 'Folding top pair weak kicker to a flop raise',
    setup:
      'You open K♦8♦ from the small blind, the big blind calls, and the flop is K♠9♥4♣. You continuation-bet and the big blind raises. What now?',
    seatCount: 3,
    button: 2,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['Kd', '8d'],
      ['9s', '9c'],
      ['Jc', 'Ts'],
    ],
    board: ['Ks', '9h', '4c', '2s', '7h'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'raise', to: 260 },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'K♦8♦ is a reasonable small-blind open against a lone big blind: a suited king with a blocker and some playability that wants to take the initiative heads-up rather than limp.',
      },
      {
        action: 'bet',
        explanation:
          'You flopped top pair on K♠9♥4♣, a dry board that misses most of a big-blind calling range. Bet for thin value and protection — you are ahead of the worse Kx, middle pairs and draws that will pay you, and you deny equity to overcards.',
      },
      {
        action: 'fold',
        explanation:
          'A raise represents a far stronger range than a call: sets, two pair and strong Kx that all dominate a weak kicker, while your hand beats almost nothing that wants to raise this dry a board. Top pair with a weak kicker bet for thin value, but it is not a hand to stack off — fold and keep the loss small. Calling off a marginal made hand into obvious strength is exactly the leak that turns one bet into a whole stack.',
      },
    ],
  },
  {
    id: 'fold-busted-draw-river',
    title: 'Folding the busted flush draw on the river',
    setup:
      'You open 8♥7♥ on the button and the big blind calls. On K♥9♥2♠ you have a flush draw; the BB bets and you call. The turn is the Q♦ and you call again, still drawing. The river is the J♣, the BB bets, and your flush never arrived. What do you do?',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['8h', '7h'],
      ['4d', '3c'],
      ['Ks', 'Qs'],
    ],
    board: ['Kh', '9h', '2s', 'Qd', 'Jc'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'bet', to: 100 },
      { kind: 'bet', to: 250 },
      { kind: 'bet', to: 600 },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          '8♥7♥ is a fine button open — suited and connected, it flops well and plays cleanly in position against the blinds.',
      },
      {
        action: 'call',
        explanation:
          'On K♥9♥2♠ you hold a live flush draw in position: you have the price, the equity, and position to realise it, so calling to see the turn is easy.',
      },
      {
        action: 'call',
        explanation:
          'The Q♦ misses you, but the flush draw is still worth a call getting a reasonable price with position and one card to come — you keep the door open to the heart that makes your hand.',
      },
      {
        action: 'fold',
        explanation:
          'The J♣ bricks: no heart, no pair for you, so you hold nothing but a busted draw that beats zero of the BB\'s value bets. A missed draw is worth exactly what a fold is worth — you cannot call a river bet with air just because you were drawing. Pot odds are meaningless when your hand can never win at showdown; let it go.',
      },
    ],
  },
  {
    id: 'thin-value-bet-river',
    title: 'Thin value on the river when checked to',
    setup:
      'You open Q♦J♠ on the button and the big blind calls. On Q♣8♥4♦ you bet and they call. The turn (2♣) and river (5♠) are both blanks, and the big blind checks to you on each. How do you play the last two streets?',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['Qd', 'Js'],
      ['7c', '2h'],
      ['Qh', '9c'],
    ],
    board: ['Qc', '8h', '4d', '2c', '5s'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'check' },
      { kind: 'call' },
      { kind: 'check' },
      { kind: 'check' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'Q♦J♠ is a standard button open: two broadway cards that flop top pair and strong draws, and they play well heads-up in position against the blinds.',
      },
      {
        action: 'bet',
        explanation:
          'On Q♣8♥4♦ you have top pair and a big edge over a big-blind calling range. Bet for value and to charge the worse queens, middle pairs, and draws that will pay you off.',
      },
      {
        action: 'check',
        explanation:
          'The 2♣ is a total blank, but top pair with a jack kicker is only a medium hand — good enough to want a showdown, not good enough to bet three streets. A second barrel mostly folds out what you beat and gets called by better queens (A♥Q / K♥Q). Check back to control the pot, keep the caller\'s bluffs and worse queens in, and set up a cheap river.',
      },
      {
        action: 'bet',
        explanation:
          'The 5♠ changes nothing and the big blind has now checked twice, so their range is full of worse queens, weak pairs, and busted draws that will look you up. Bet thin for value: you beat the hands that call, and a check throws that money away. Missing a thin value bet costs you exactly as much as paying off a bluff — bet the hands a worse hand calls.',
      },
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
