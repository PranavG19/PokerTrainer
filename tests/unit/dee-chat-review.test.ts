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

describe('review: crisis words that are poker', () => {
  it('"end it on the turn" is a poker question', () => {
    expect(classify('should i bet to end it on the turn')).not.toEqual({ kind: 'refuse', refusal: 'crisis' });
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
