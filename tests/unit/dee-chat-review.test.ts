import { describe, expect, it } from 'vitest';
import { classify } from '../../src/core/dee/chat/gate.js';
import { rewriteProblems } from '../../src/main/dee/phrasing.js';

/**
 * Regressions from the independent review (code-review.md, "Act on" 1–3). Each case was accepted before the fix.
 */

describe('review 1: crisis phrasings reach the crisis line, never a hand explanation', () => {
  it.each([
    'after that hand i dont want to live anymore',
    'this hand makes me want to end it',
    'thinking of ending it all after this hand',
    "I don't want to live anymore",
    'i wish i was dead',
    'kms',
    'unalive myself',
    'I would be better off dead',
    'I want to take my own life',
    'after that hand i am thinking of killing myself',
    'i feel like killing myself after that fold',
    "i'm killing myself over this river",
    'i am thinking of killing myself',
    'after that hand i cant go on',
    'no point living after this hand',
    "I can't go on anymore",
    "there's no point in living",
    'everyone would be better off without me',
    'im going to jump off a bridge',
    'nobody would miss me',
    'i hate my life',
    'i give up on life',
    'i want to sleep forever',
    'life is pointless after that river',
  ])('%s', (q) => {
    expect(classify(q)).toEqual({ kind: 'refuse', refusal: 'crisis' });
  });
});

describe('review 2: non-Latin text and non-ASCII numerals never pass a rewording', () => {
  const script = 'On the river the hand checked while well ahead. A bet charges the worse hands; the check left 1.2 bb behind.';
  it.each([
    `${script} 这个跟注亏了五个大盲。`,
    `${script} 聊天会把数据发送到云端。`,
    script.replace('1.2', '１.２'),
    `${script} ¼`,
    `${script} ①②③`,
    `${script} 이백`,
  ])('%s is refused', (c) => {
    expect(rewriteProblems(c, script)).not.toEqual([]);
  });
});

describe('review 3: role words and negators keep their order', () => {
  it('price and share swapped is refused', () => {
    const script = 'Nothing in that hand cost 0.5 bb or more. The last price was 31%, for 450 into 1000, and the hand held 22%: enough for the call.';
    const swapped = 'Nothing in that hand cost 0.5 bb or more. The share the hand held: 31%, for 450 into 1000, and the price 22%: enough for the call.';
    expect(rewriteProblems(swapped, script)).not.toEqual([]);
  });
  it('a moved "not" is refused', () => {
    const script = 'A kicker is a card in the best five that is not part of the made hand. When two hands make the same pair, the higher kicker decides.';
    const moved = 'A kicker is not a card in the best five that is part of the made hand. When two hands make the same pair, the higher kicker decides.';
    expect(rewriteProblems(moved, script)).not.toEqual([]);
  });
  it('the betting order inverted is refused', () => {
    const script = 'Preflop, the seat left of the big blind acts first and the big blind acts last. On every later street the first live seat left of the button starts, and the button acts last.';
    const inverted = 'Preflop the big blind acts first and last; on every street the first seat left of the button acts last.';
    expect(rewriteProblems(inverted, script)).not.toEqual([]);
  });
  it('a benign rewording still passes', () => {
    const script = 'Preflop, the seat left of the big blind acts first and the big blind acts last. On every later street the first live seat left of the button starts, and the button acts last.';
    const benign = 'Preflop, the seat left of the big blind acts first and the big blind acts last. On every later street, the first live seat left of the button starts, and the button acts last.';
    expect(rewriteProblems(benign, script)).toEqual([]);
  });
});

describe('review (final): the crisis fallback catches despair by its words, with or without a poker word', () => {
  const lines = ['i should just die', 'whats the point of living', 'i cant take it anymore', 'life isnt worth it anymore', 'nothing matters anymore', 'i want it all to stop', 'i want to disappear forever'];
  it.each(lines.flatMap((l) => [l, `after that hand ${l}`, `${l}, explain this hand`]))('%s', (q) => {
    expect(classify(q)).toEqual({ kind: 'refuse', refusal: 'crisis' });
  });
});

describe('final review: "alive" exemptions never hide distress', () => {
  it.each([
    'i dont know if i want to stay alive after that hand',
    'i dont want to stay alive after this hand',
    'do i even want to be alive after this hand',
    'not sure i want to be alive after this hand',
    'staying alive after that hand is hard',
    'why stay alive after that river',
    'no will to live after that hand',
    'the hand is dead, life is too',
    'i dont deserve to be alive after this hand',
    'i dont deserve to be alive after this hand, explain this hand',
    'i dont feel alive after this hand',
    'i dont feel alive after this hand, explain this hand',
    'lost that hand dead inside',
    'lost that hand dead inside, explain this hand',
    'my hand is dead and so am i',
    'my hand is dead and so am i, explain this hand',
    'the cards are dead, just like me',
    'the cards are dead, just like me, explain this hand',
    'i dont feel alive in this hand anymore',
    'i dont feel alive in this hand anymore, explain this hand',
    'hands dead, me too',
    'hands dead, me too, explain this hand',
  ])('%s', (q) => {
    expect(classify(q)).toEqual({ kind: 'refuse', refusal: 'crisis' });
  });
});

describe('review: crisis words that are poker', () => {
  it.each([
    'should i bet to end it on the turn',
    'what is dead money',
    'was i drawing dead',
    'what is a dead hand',
    'this rake is killing me',
    'these bad beats are killing me',
    'is my hand still alive on the river',
    'is my draw dead',
    'my hand is dead',
    'is the button dead',
    'two hands still alive at showdown',
    'how many seats are alive',
    'is my draw alive after the flop',
    'am i drawing dead here',
    'which cards are dead',
    'are both hands still alive at the river',
  ])('%s is not the crisis line', (q) => {
    expect(classify(q)).not.toEqual({ kind: 'refuse', refusal: 'crisis' });
  });
});

describe('review: house words that carry meaning stay put', () => {
  it.each([
    ['Nothing in that hand cost 0.5 bb or more. The last price was 31%, for 450 into 1000, and the hand held 34%, short of it, so the fold kept the chips.',
      'Nothing in that hand cost 0.5 bb or more. The last price was 31%, for 450 into 1000, and the hand held 34%, so the fold kept the chips, short of it.'],
    ['Chat answers come from this machine. The only download chat can make is the optional phrasing model, and only after its button is pressed.',
      'Chat answers come to this machine. The only download chat can make is the optional phrasing model, and only after its button is pressed.'],
  ])('%s', (script, moved) => {
    expect(rewriteProblems(moved, script)).not.toEqual([]);
  });
});

describe('review: consider items', () => {
  it('a check raise with a space is the concept', () => {
    expect(classify('what is a check raise')).toMatchObject({ intent: 'define', topic: 'check-raise' });
  });

  it('fold equity is fold equity, a check-raise is a check-raise', () => {
    expect(classify('what is fold equity')).toMatchObject({ intent: 'define', topic: 'fold-equity' });
    expect(classify('what is a check-raise')).toMatchObject({ intent: 'define', topic: 'check-raise' });
  });
  it('owing money is a money question', () => {
    expect(classify('I owe my friend after poker night')).toMatchObject({ kind: 'refuse', refusal: 'money' });
  });
});
