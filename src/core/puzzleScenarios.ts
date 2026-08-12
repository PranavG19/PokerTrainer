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
          'K-8-3 rainbow gives you nothing but two overcards that are not really overcards to a king, with only backdoor straight and flush outs. Betting only folds out worse and gets called by better; checking back keeps the pot small, realises your equity for free, and lets you bluff-catch or improve on later streets. Pot control in position is a bet you DON’T make.',
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
          'The 7 bricks nearly every draw — the board stayed rainbow until this spade, so only the straight gutshots were ever live and they all whiff — and a player who checked the flop and turn has a range full of missed draws and give-ups. Second pair beats every bluff, and you are getting a price — folding here is the over-fold that pays off every bluffer. When they have shown no strength and the price is right, one pair is enough to catch a bluff.',
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
  {
    id: 'set-mine-call-22',
    title: 'Set-mining 2♠2♣ vs an open and a cold-call',
    setup:
      'Four-handed, 100bb deep, you have 2♠2♣ in the big blind. UTG raises to 3bb, the button cold-calls, and it folds to you. Two players in, a cheap price to close, and deep stacks behind.',
    seatCount: 4,
    button: 2,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['2s', '2c'],
      ['Ad', 'Kd'],
      ['Js', 'Ts'],
      ['7d', '4c'],
    ],
    board: ['Qh', '9c', '5s', '8d', '3h'],
    villainScript: [
      { kind: 'raise', to: 150 },
      { kind: 'call' },
      { kind: 'fold' },
    ],
    target: [
      {
        action: 'call',
        explanation:
          '22 will flop a set only about one time in eight, so it is a pure implied-odds call: you are not calling on current pot odds but on the big pot you win the times you do hit. Two conditions make that math work here and both are met — stacks are deep (100bb, so there is a full stack to win when your set gets there) and the pot is multiway, giving two opponents who can pay you off. Flat to see a cheap flop and either flop a set or fold; 3-betting a hand that can only continue when it hits just bloats a pot you will usually have to surrender.',
      },
    ],
  },
  {
    id: 'squeeze-fold-weak',
    title: 'Folding K♣J♦ into a raise and a cold-call',
    setup:
      'Four-handed with K♣J♦ in the big blind. UTG raises to 3bb, the button cold-calls, and it folds to you. A raise AND a caller are already in front of you, and you are out of position with the whole hand still to play.',
    seatCount: 4,
    button: 2,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['Kc', 'Jd'],
      ['Ah', 'Ks'],
      ['Ad', 'Js'],
      ['7c', '2h'],
    ],
    board: ['Td', '8s', '5c', '4h', '9d'],
    villainScript: [
      { kind: 'raise', to: 150 },
      { kind: 'call' },
      { kind: 'fold' },
    ],
    target: [
      {
        action: 'fold',
        explanation:
          'K♣J♦ is a classic trap hand multiway: a raise and a cold-call both rep strength, and you are dominated by A♦J♠ and every K-x with a better kicker like A♥K♠, plus over-pairs. It is not strong enough to 3-bet for value — you\'d only be called by hands that beat you — yet it is far too dominated to flat profitably out of position, where you\'ll flop second-best top pairs that lose big pots and win small ones. Heads-up KJo can defend; against an open plus a caller, the extra strength in the field turns it into a fold.',
      },
    ],
  },
  {
    id: 'call-turn-implied-oesd',
    title: 'Calling the turn with a big draw on implied odds',
    setup:
      'You\'re on the button with T♥9♥, 100bb deep, and it folds to you. The small blind gets out of the way, the big blind calls your open, then leads the J♣8♠4♦ flop and barrels again on the 2♣ turn.',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['Th', '9h'],
      ['6s', '3c'],
      ['Ad', 'Jh'],
    ],
    board: ['Jc', '8s', '4d', '2c', '7s'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'bet', to: 100 },
      { kind: 'bet', to: 250 },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'T9s is a comfortable button open: a suited connector that plays well in position against both blinds and can flop straights, flushes and their draws to attack ranges that miss.',
      },
      {
        action: 'call',
        explanation:
          'J♣8♠4♦ hands you an open-ended straight draw — any Q or 7 completes it, eight outs. Facing one c-bet in position you have the price and, crucially, position to see another card and realize that draw\'s equity, so calling beats folding or raising a raw draw.',
      },
      {
        action: 'call',
        explanation:
          'The 2♣ bricks your draw but you still hold eight clean outs to the straight. This turn bet lays roughly 2.9-to-1, and even where the direct price is thin your position plus the implied odds — the extra chips you win when a Q or 7 arrives and the big blind pays off — make continuing clearly correct.',
      },
    ],
  },
  {
    id: 'value-raise-flop-set',
    title: 'Fast-playing top set on a wet board in position',
    setup:
      'You open the button, the big blind calls, and the flop comes 9♥8♥7♠ — about as wet as textures get, dripping with flush and straight draws. First to act, the big blind leads out into you. You have position and a big decision.',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['9c', '9d'],
      ['Qs', 'Jc'],
      ['Ah', '5h'],
    ],
    board: ['9h', '8h', '7s', 'Kd', '2c'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'bet', to: 100 },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'Pocket nines are a comfortable button open — a pair that plays well in position against the blinds and flops a set often enough to win a stack when it does. Take the lead with position for the rest of the hand.',
      },
      {
        action: 'raise',
        explanation:
          'You flopped top set on 9♥8♥7♠, one of the wettest boards in poker: the heart flush draw and a swarm of straight draws all have live equity against you. When the big blind leads into you, raise for value AND protection — fast-playing charges every draw the maximum and builds the pot while your hand is a huge favourite. Flatting invites a cheap turn that completes a flush or a straight and freezes your monster; in position on a wet board you deny that equity now rather than trapping and letting a free card beat you. This is the mirror of check-raising a set out of position — same hand, same logic, from the other side.',
      },
    ],
  },
  {
    id: 'overpair-fold-river-jam',
    title: 'Folding an overpair to a huge river jam',
    setup:
      'You open on the button, the big blind calls, and you bet the 9♠8♠4♦ flop and barrel the 2♥ turn — called both times. The 7♠ river puts a third spade out, and the big blind fires a huge overbet, jamming into you. Do you pay it off?',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['Jc', 'Jd'],
      ['2c', '2d'],
      ['As', 'Ks'],
    ],
    board: ['9s', '8s', '4d', '2h', '7s'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'check' },
      { kind: 'call' },
      { kind: 'check' },
      { kind: 'call' },
      { kind: 'bet', to: 1500 },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'Pocket jacks are a premium hand — open the button for value and to take the betting lead into the blinds with position.',
      },
      {
        action: 'bet',
        explanation:
          'On 9♠8♠4♦ your overpair is ahead of the big blind\'s calling range. Bet for value from worse pairs and to charge the flush and straight draws that will float you — checking a wet board only lets the field realize equity for free.',
      },
      {
        action: 'bet',
        explanation:
          'The 2♥ is a blank that completes no draw and shifts no ranges. Keep value-betting: jacks are still an overpair ahead of the draws and worse made hands that called the flop, and a second barrel builds the pot while denying the draws their equity.',
      },
      {
        action: 'fold',
        explanation:
          'The 7♠ is the worst card in the deck here: it fills the spade flush, completes the 5-6 straight, and lets slowplayed sets and two pairs arrive too. A pot-sized-plus jam on this runout is almost entirely value, and one pair beats none of it. Pot odds never rescue a hand that can only beat a bluff when the sizing screams value — an overpair is a fold to max river aggression on a board this coordinated.',
      },
    ],
  },
  {
    id: 'iso-3bet-vs-limp-reraise',
    title: 'Calling a 3-bet on the button with A♠K♥',
    setup:
      'Folded to you on the button, you open and the small blind folds — then the big blind 3-bets. 100bb deep, the action is back on you with one decision to make.',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['As', 'Kh'],
      ['7c', '2d'],
      ['Qd', 'Jd'],
    ],
    board: ['8h', '5s', '3c', 'Tc', '4h'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'raise', to: 400 },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'A♠K♥ is one of the strongest hands you can hold, and the button is the best seat: opening builds the pot with a hand that dominates most of what the blinds continue with and takes the betting lead in position for the whole hand.',
      },
      {
        action: 'call',
        explanation:
          'AKo dominates the suited broadways and worse aces that fill out a 3-betting range and races (near a coinflip) with the medium pairs like QQ and below — only AA and KK have it in bad shape, and those are a small slice of the range. It is far too strong to fold to a single re-raise. With position and a hand that plays well postflop, flatting keeps their bluffs in and avoids bloating the pot against the very top of their value, where a 4-bet only gets called by the hands that crush you. Folding AK here is one of the most common and expensive preflop leaks.',
      },
    ],
  },
  {
    id: 'raise-donk-bet-set',
    title: 'Raising a donk bet with a set',
    setup:
      'You open 7♣7♦ on the button and only the big blind calls. On the K♠7♥2♦ flop the big blind leads straight into you — a "donk bet" — before you have said anything. What do you do?',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['7c', '7d'],
      ['Ad', 'Qh'],
      ['Kh', 'Th'],
    ],
    board: ['Ks', '7h', '2d', '9c', '4s'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'bet', to: 150 },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          '7♣7♦ is a routine button open: a pocket pair with position, happy to win it preflop or flop a set in a single-raised pot.',
      },
      {
        action: 'raise',
        explanation:
          'A lead into the preflop raiser — a "donk bet" — is usually weak or capped, because players tend to check their strong hands to the aggressor. On K♠7♥2♦ you have a set of sevens, a hand almost never beaten here. Raise for value: build the pot now against the worse kings, pairs and draws that keep calling, rather than flatting and letting the board slow down. Calling only lets a cheap turn kill your action.',
      },
    ],
  },
  {
    id: 'overbet-river-nut-flush',
    title: 'Overbetting the river with the nut flush',
    setup:
      'You raise A♠5♠ on the button and the big blind calls. You bet the K♠8♠3♦ flop and they call; the 2♠ turn makes your nut flush, you bet again and they call. The river is the J♦ and the big blind checks to you a final time. How do you play each street?',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['As', '5s'],
      ['Qh', 'Jc'],
      ['Kd', 'Tc'],
    ],
    board: ['Ks', '8s', '3d', '2s', 'Jd'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'check' },
      { kind: 'call' },
      { kind: 'check' },
      { kind: 'call' },
      { kind: 'check' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'A♠5♠ is a standard button open: a suited ace that can make the nut flush, blocks the blinds’ strong aces, and plays well in position.',
      },
      {
        action: 'bet',
        explanation:
          'On K♠8♠3♦ you hold the nut-flush draw with an ace high. C-bet: you have big equity, fold out the weakest hands, and set yourself up to barrel hard the moment a third spade arrives.',
      },
      {
        action: 'bet',
        explanation:
          'The 2♠ brings in the nut flush. Keep betting for value — the worse flushes, two pair and sets that got here will pay you off, and there is no reason to slow down holding the best possible hand.',
      },
      {
        action: 'bet',
        explanation:
          'The J♦ changes nothing, and the big blind has only ever called, so their range is capped: one-pair hands and the occasional worse flush, but you hold the A♠ so no flush beats yours. This is the textbook OVERBET spot — against a capped range that can never raise you, a larger-than-pot bet extracts the most from the bluff-catchers that still look you up, and you risk nothing with the nuts.',
      },
    ],
  },
  {
    id: 'probe-turn-after-checkback',
    title: 'Probing the turn after the raiser gives up',
    setup:
      'You defend 9♠8♠ in the big blind against a button open. You check the K♦7♣3♥ flop and the button checks back. The turn is the 9♥ and it is on you again.',
    seatCount: 3,
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['9s', '8s'],
      ['Ad', 'Qc'],
      ['Jd', 'Tc'],
    ],
    board: ['Kd', '7c', '3h', '9h', '2s'],
    villainScript: [
      { kind: 'raise', to: 125 },
      { kind: 'fold' },
      { kind: 'check' },
    ],
    target: [
      {
        action: 'call',
        explanation:
          '9♠8♠ is a fine big-blind defend against a button open: a suited connector getting a great price to close the action, and it flops straights and flushes that play well enough to continue out of position.',
      },
      {
        action: 'check',
        explanation:
          'You have only backdoor draws on K♦7♣3♥, and it is a king-high board that favours the raiser. Check to them — leading into their range gains nothing, and checking keeps your own weak-and-strong hands together rather than turning your hand face up.',
      },
      {
        action: 'bet',
        explanation:
          'The button CHECKED BACK the flop, which caps their range — a real king almost always continuation-bets. The 9♥ pairs you, so you now likely hold the best hand. Lead the turn: this "probe bet" takes back the betting lead the raiser surrendered, charges their overcards and gutshots, and wins a pot they have already shown they do not want.',
      },
    ],
  },
  {
    id: 'blocker-3bet-bluff-a5s',
    title: '3-bet bluffing with a blocker',
    setup:
      'It folds to the button, who opens to 2.5bb. You are in the big blind with A♠5♠, 100bb deep, facing a wide, positional steal.',
    seatCount: 3,
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['As', '5s'],
      ['Jc', 'Ts'],
      ['7h', '2d'],
    ],
    board: ['2c', '9d', 'Kh', '4s', '8h'],
    villainScript: [
      { kind: 'raise', to: 125 },
      { kind: 'fold' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'A♠5♠ is a premium 3-bet BLUFF against a wide button open. The ace BLOCKS the strongest hands in their continuing range — AA, AK, AQ — so they fold more often and are less likely to have you crushed when they do call. It is not a pure bluff either: called, it makes the nut flush and wheel straights, so it realises its equity well. Attacking a loose open with blocker hands, not only with monsters, is what keeps you from being exploitably tight from the blinds.',
      },
    ],
  },
  {
    id: 'delayed-cbet-turn',
    title: 'Delaying the c-bet, then firing the turn',
    setup:
      'You open A♣J♦ on the button and the big blind calls. On T♠6♥3♦ they check and you check back. The turn is the J♣ — you now have top pair — and the big blind checks to you again. How do you play the flop and turn?',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['Ac', 'Jd'],
      ['7c', '2h'],
      ['Kd', 'Qh'],
    ],
    board: ['Ts', '6h', '3d', 'Jc', '4s'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'check' },
      { kind: 'check' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'A♣J♦ is a standard button open: an ace-high hand with a decent kicker that flops top pairs and gutshots and plays well heads-up in position.',
      },
      {
        action: 'check',
        explanation:
          'On T♠6♥3♦ you have only ace-high. Betting folds out the worse hands you beat and gets called by the pairs that beat you, so a c-bet here is mostly value-cutting yourself. Check back to keep the pot small, realise your equity for free, and disguise a hand that can improve — the delayed line.',
      },
      {
        action: 'bet',
        explanation:
          'The J♣ gives you top pair with a strong kicker, and the big blind has now checked twice — a range full of weak pairs, worse jacks, and busted floats. This is the delayed c-bet: because you checked the flop, your bet is disguised, and you charge the hands that would have folded to a flop bet but call once they have connected. Betting now takes the value the flop check set up.',
      },
    ],
  },
  {
    id: 'checkback-underpair-multiway',
    title: 'Checking back an underpair in a multiway pot',
    setup:
      'You open T♥T♠ on the button and both blinds call, so you take the K♠9♥5♣ flop three ways. Both blinds check to you. Do you continuation-bet?',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['Th', 'Ts'],
      ['Ad', 'Jc'],
      ['8h', '7h'],
    ],
    board: ['Ks', '9h', '5c', '2d', '4s'],
    villainScript: [
      { kind: 'call' },
      { kind: 'call' },
      { kind: 'check' },
      { kind: 'check' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'T♥T♠ is a clear button open: a strong pocket pair with position, ahead of most of what the blinds defend with.',
      },
      {
        action: 'check',
        explanation:
          'Both blinds called, so you are three-way, and K♠9♥5♣ puts an overcard to your tens on the board. Betting an underpair into two players turns showdown value into a bluff — worse hands fold, and any king (far likelier across two ranges) calls or raises you. Check back to keep the pot small and take a cheap turn card with a hand that is often still best but cannot stand pressure. Betting here mostly folds out what you beat and isolates you against what beats you.',
      },
    ],
  },
  {
    id: 'trap-flopped-set-dry',
    title: 'Trapping with a flopped set on a dry board',
    setup:
      'You open 9♦9♣ on the button and the big blind calls. The flop is K♠9♥2♦ — you have middle set on a dry, disconnected board. The big blind checks to you. Do you bet or trap?',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['9d', '9c'],
      ['Ah', 'Qs'],
      ['Jd', 'Tc'],
    ],
    board: ['Ks', '9h', '2d', '7c', '4s'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'check' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          '9♦9♣ is a routine button open: a middle pocket pair with position, happy to win preflop or flop a set in a single-raised pot.',
      },
      {
        action: 'check',
        explanation:
          'You flopped a set, but K♠9♥2♦ is bone dry — no flush draw, no straight draw, nothing that can outdraw you cheaply. Against a checking big blind, betting only folds out the air you dominate and gets called by the odd king. Check back to trap: let them catch a piece or turn a bluff on a later street, and keep their whole range in against a hand almost nothing beats. On a wet board you would fast-play to charge draws; here there are none to charge, so the value comes from disguise, not protection.',
      },
    ],
  },
  {
    id: 'call-3bet-oop-99',
    title: 'Flatting a 3-bet out of position',
    setup:
      'The button folds and you open 9♥9♠ from the small blind. The big blind 3-bets to 350, and it is back on you — 100bb deep, out of position with a middle pair. Do you 4-bet, call, or fold?',
    seatCount: 3,
    button: 2,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['9h', '9s'],
      ['As', 'Kd'],
      ['4c', '3d'],
    ],
    board: ['Qd', '8s', '5c', 'Jh', '2s'],
    villainScript: [
      { kind: 'fold' },
      { kind: 'raise', to: 350 },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          '9♥9♠ is a clear small-blind open: a middle pair is far ahead of the big blind’s range, and raising takes the initiative and denies them a cheap flop rather than limping into a passive pot out of position.',
      },
      {
        action: 'call',
        explanation:
          'Facing a 3-bet with 99 out of position, calling is the middle path between two worse options. Folding is far too tight — 99 crushes the big blind’s 3-bet bluffs, dominates their worse pairs, and flips only against overcards like A-K. 4-betting turns your hand into a bluff that only gets called by the hands that beat you (bigger pairs, AK) and folds out everything you dominate. Flatting keeps their bluffs in, keeps the pot controlled out of position, and lets you set-mine or stack off on a good flop. It is the disciplined line: not every strong hand wants to build a huge pot before the flop.',
      },
    ],
  },
  {
    id: 'river-bluff-blocker',
    title: 'Bluffing the river with the nut blocker',
    setup:
      'You raise A♠7♥ on the button and the big blind calls. You c-bet the K♠9♠4♥ flop and they call; the turn 2♣ checks through. The river is the J♠ — a third spade — and the big blind checks a final time. You have only ace-high, but the one spade you hold is the A♠. Do you give up or bluff?',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['As', '7h'],
      ['Qh', 'Jd'],
      ['Td', '9c'],
    ],
    board: ['Ks', '9s', '4h', '2c', 'Js'],
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
          'A♠7♥ is a routine button steal — every offsuit ace opens from the button, taking position and the betting lead against the blinds.',
      },
      {
        action: 'bet',
        explanation:
          'K♠9♠4♥ is a king-high board that favours your opening range far more than the big blind’s calling range, so a standard c-bet applies pressure with equity to spare: you hold a backdoor flush draw (the A♠ with the two board spades) and the ace as a live overcard. Bet to fold out the air and set up later barrels.',
      },
      {
        action: 'check',
        explanation:
          'The 2♣ is a total blank — you are still only ace-high, and the backdoor draws did not advance. There is nothing to value-bet and little to fold out that has called a flop bet, so check back, keep the pot small, and keep the A♠ live as a river bluffing card.',
      },
      {
        action: 'bet',
        explanation:
          'The J♠ puts a third spade out, so a flush is now possible — and you hold the A♠ without a second spade, so YOU have no flush but block the best one. Your hand is only ace-high, making this a pure bluff, but it is the right one: holding the A♠ means the big blind can never have the nut (ace-high) flush, so their check-and-call range is capped at worse flushes and one-pair hands that fold to a big bet. Bet, representing the flush you block them from holding. A busted hand is not an automatic give-up when you hold the card that removes villain’s strongest holding.',
      },
    ],
  },
  {
    id: '3bet-aqs-vs-btn-steal',
    title: '3-betting A♠Q♠ for value against a button steal',
    setup:
      'The button opens to 2.5bb trying to steal, the small blind folds, and you are in the big blind with A♠Q♠. Flatting is fine — but against a wide, weak stealing range there is a better option than just calling.',
    seatCount: 3,
    // bb-defend seating: button on seat 1 → seat 0 is the BB (hero), seat 1 is the opener/first to act,
    // seat 2 the SB. The opener's steal is the script's first entry; after the hero 3-bets it folds.
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['As', 'Qs'],
      ['Jd', 'Tc'],
      ['7h', '3d'],
    ],
    board: ['Kh', '8c', '5s', '2d', '9h'],
    // Seat 1 (button) opens to 125, SB folds, then the button folds to the hero's 3-bet. One decision.
    villainScript: [
      { kind: 'raise', to: 125 },
      { kind: 'fold' },
      { kind: 'fold' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'AQs dominates a button steal’s range and 3-betting is better than flatting here: it charges the many worse aces, kings and offsuit broadways to continue, denies their equity, seizes the initiative so you are not check-calling out of position, and folds out the raw air that would otherwise get to flop for free. A strong, suited, but still-vulnerable hand wants to build the pot and take control, not passively call and play a guessing game out of position.',
      },
    ],
  },
  {
    id: 'fold-weak-ace-to-ep-open',
    title: 'Folding a weak ace to an early open',
    setup:
      'An early-position player opens to 3bb and it folds to you in the big blind with A♠6♦, 100bb deep. It has an ace in it — but an offsuit ace-six against a tight opener is a trap, not a hand.',
    seatCount: 3,
    // bb-defend / fold-kq-to-utg seating: button on seat 1 → seat 0 is the BB (hero), seat 1 is the
    // opener and first to act preflop, seat 2 is the SB. The opener's raise is the script's first entry.
    button: 1,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    holes: [
      ['As', '6d'],
      ['Kh', 'Kc'],
      ['9c', '8d'],
    ],
    board: ['Qh', '7s', '2c', 'Td', '4h'],
    // Seat 1 opens to 150; the hero folds facing it. One decision, so the rest is never reached.
    villainScript: [{ kind: 'raise', to: 150 }],
    target: [
      {
        action: 'fold',
        explanation:
          'A6o is a domination trap against a tight early-position range: when an ace flops you are out-kicked by every better ace the opener has (AK, AQ, AJ, AT), and the six pairs into nothing. Out of position with no initiative, "it has an ace" is exactly the reasoning that loses money — fold the weak offsuit aces to early opens and keep the strong, suited, and connected hands. The ace on the front does not make a hand playable.',
      },
    ],
  },
  {
    id: 'fold-weak-pair-river-overbet',
    title: 'Folding a weak pair to a river overbet',
    setup:
      'You open K♣J♦ on the button, the big blind calls, and you check the Q♠J♥4♠ flop back with middle pair. The 8♦ turn checks through too. On the 3♥ river the big blind suddenly OVERBETS — more than the pot — into you. A pair of jacks felt fine a second ago. Does the size change the answer?',
    seatCount: 3,
    // pot-control-ip / call-river-bluffcatch layout: button on seat 0 = hero, so the hero opens
    // preflop but acts LAST postflop; the BB (seat 2) is the live caller and acts first on every
    // postflop street, letting them bet INTO the hero on the river.
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (button/opener). Seat 1 = SB (folds). Seat 2 = BB (caller, then river overbettor).
    holes: [
      ['Kc', 'Jd'],
      ['6s', '6d'],
      ['Ts', '9s'],
    ],
    board: ['Qs', 'Jh', '4s', '8d', '3h'],
    // SB folds preflop, BB calls. Postflop the hero acts last, so the BB acts first each street: checks
    // the flop, checks the turn, then OVERBETS the river (to 1200 into a ~300 pot — a polarising size).
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'check' },
      { kind: 'check' },
      { kind: 'bet', to: 1200 },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'KJs is a routine button open — suited, two broadway cards, and it plays well in position against the blinds.',
      },
      {
        action: 'check',
        explanation:
          'On Q♠J♥4♠ you have only middle pair (jacks) with a king kicker. It has showdown value but is not strong enough to bet for three streets; check back to control the pot and get to showdown cheaply, keeping the caller’s bluffs in.',
      },
      {
        action: 'check',
        explanation:
          'The 8♦ is a blank and your hand did not improve. Keep pot-controlling — betting a medium hand here only folds out worse and gets called by better.',
      },
      {
        action: 'fold',
        explanation:
          'The size is the whole read. A player who checked twice and then fires MORE THAN THE POT is polarised: at these stakes an overbet is weighted heavily toward the top of the range — sets (QQ, JJ, 44), two pair (QJ), the T9 straight — with only a thin slice of bluffs. Your pair of jacks with a king kicker beats none of that value and only chops or loses to the other one-pair hands that would bet this big. To call an overbet you need far more equity than you needed against the small stab in the bluff-catch spot, and one pair does not have it. Unlike a small bet into a passive line, a big overbet is not a bluff-catch — it is a fold. Reading the SIZE, not just the pair, is what this spot is teaching.',
      },
    ],
  },
  {
    id: 'fold-tptk-turn-flush-in',
    title: 'Laying down top pair when the flush gets there',
    setup:
      'You open A♦Q♣ on the button and the big blind calls. You c-bet the Q♠8♠4♦ flop with top pair, top kicker and they call. The turn is the 7♠ — a third spade — and now the big blind leads into you for a big bet. Top pair was ahead a moment ago. Is it still?',
    seatCount: 3,
    button: 0,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // Seat 0 = hero (button/opener). Seat 1 = SB. Seat 2 = BB (caller, then the turn donk-bettor).
    holes: [
      ['Ad', 'Qc'],
      ['5h', '5d'],
      ['Js', 'Ts'],
    ],
    board: ['Qs', '8s', '4d', '7s', '2c'],
    // SB folds preflop; BB calls the open, then check-CALLS the flop c-bet, then LEADS (donks) the turn.
    // Postflop the BB acts first each street: check (flop) → call the hero's c-bet → bet out on the turn.
    villainScript: [
      { kind: 'fold' },
      { kind: 'call' },
      { kind: 'check' },
      { kind: 'call' },
      { kind: 'raise', to: 900 },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'A♦Q♣ is a standard button open — a strong, dominating hand that wants to play a heads-up pot in position against the blinds.',
      },
      {
        action: 'bet',
        explanation:
          'You flopped top pair with the best kicker on Q♠8♠4♦. C-bet for value and to charge the spade and straight draws this semi-wet board gives the big blind’s range.',
      },
      {
        action: 'fold',
        explanation:
          'The 7♠ completes the flush, and the big blind LEADS into the preflop aggressor for a big bet — a line that is almost never a bluff at these stakes. A check-call flop then a turn donk-lead screams a made hand: flushes (the flush draw that just got there, J♠T♠ and other spade combos), sometimes two pair or a set. You hold no spade, so you cannot make the flush; against that range your top pair is drawing thin — a queen only gives you trips that still lose to a flush. One pair is rarely worth stacking off when the obvious draw arrives and a passive player suddenly bets big into you, so fold and keep the pot small.',
      },
    ],
  },
  {
    id: 'sb-raise-or-fold-ajo',
    title: 'The small blind raises or folds — it never limps',
    setup:
      'It folds to you in the small blind with A♦J♣, the big blind still to act. Only the big blind is left. Do you complete (limp), raise, or fold?',
    seatCount: 3,
    button: 2,
    smallBlind: 25,
    bigBlind: 50,
    startStack: 5000,
    // button:2 seats the hero (seat 0) in the SB. Seat 1 = BB, seat 2 = button. Preflop the button
    // acts first, then the hero (SB), then the BB — so the button folds before the hero decides.
    holes: [
      ['Ad', 'Jc'],
      ['Kd', 'Qs'],
      ['7s', '2h'],
    ],
    board: ['9h', '6c', '3s', 'Tc', '2d'],
    // The button folds to the hero; after the hero raises, the big blind folds to the open.
    villainScript: [
      { kind: 'fold' },
      { kind: 'fold' },
    ],
    target: [
      {
        action: 'raise',
        explanation:
          'AJo is far too strong to fold and must never be limped. Completing invites the big blind in for free and surrenders the initiative out of position; raising takes the pot uncontested a large share of the time and, when called, keeps you as the aggressor with a dominating hand. The small blind plays a raise-or-fold strategy — limping is the one option that is always wrong here.',
      },
    ],
  },
];

export function scenarioById(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
