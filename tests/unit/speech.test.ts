import { describe, expect, it } from 'vitest';
import { SPEECH_MAX_CHARS, speakableText } from '../../src/main/speech.js';
import {
  deserialize,
  emptySession,
  recordHand,
  serialize,
  setCoachedMode,
  setSpokenVerdicts,
} from '../../src/core/session.js';

describe('speakableText', () => {
  it('passes an ordinary coach verdict through unchanged', () => {
    const verdict = 'Folding with 44% pot share when only 25% was needed costs ~1.1 bb.';
    expect(speakableText(verdict)).toBe(verdict);
  });

  it('returns null when there is nothing to say', () => {
    expect(speakableText('')).toBe(null);
    expect(speakableText('   ')).toBe(null);
    expect(speakableText('\n\t  \r ')).toBe(null);
  });

  it('flattens newlines and runs of whitespace into single spaces', () => {
    expect(speakableText('Calling 50\ninto a  75 pot\tneeds 40%.')).toBe(
      'Calling 50 into a 75 pot needs 40%.',
    );
  });

  it('strips control characters rather than passing them into an argv', () => {
    expect(speakableText('bad\u0000verdict\u0007here\u007f')).toBe('bad verdict here');
  });

  /**
   * The cap is the anti-overlap guarantee's partner: `say` holds its process open for roughly a
   * second per five words, so an unbounded string narrates over the hands that follow it.
   */
  it('caps long text at the documented maximum', () => {
    const long = 'word '.repeat(200);
    const spoken = speakableText(long);
    expect(spoken).not.toBe(null);
    expect((spoken ?? '').length).toBeLessThanOrEqual(SPEECH_MAX_CHARS);
  });

  it('cuts a long verdict on a word boundary, never mid-word', () => {
    const long = `${'alpha '.repeat(60)}omega`;
    const spoken = speakableText(long) ?? '';
    expect(spoken.length).toBeLessThanOrEqual(SPEECH_MAX_CHARS);
    // Every retained token is a whole word from the input.
    for (const token of spoken.split(' ')) expect(token).toBe('alpha');
  });

  it('still speaks an unbroken over-long token rather than falling silent', () => {
    const wall = 'x'.repeat(SPEECH_MAX_CHARS * 2);
    expect(speakableText(wall)).toBe('x'.repeat(SPEECH_MAX_CHARS));
  });

  /**
   * Shell metacharacters are deliberately PRESERVED. The safety property lives at the argv boundary
   * in speak(), not in a filter here: sanitising the text would both imply the text reaches a shell
   * and silently mangle a verdict. If this ever starts stripping, the argv test in voice.spec.ts is
   * what must catch a regression — not this.
   */
  it('preserves shell metacharacters instead of pretending to sanitise them', () => {
    const nasty = 'You lost $50; rm -rf ~ && echo `pwned` | tee /tmp/x';
    expect(speakableText(nasty)).toBe(nasty);
  });

  it('does not treat a leading dash as anything special — that is the -- separator’s job', () => {
    expect(speakableText('--voice=evil')).toBe('--voice=evil');
  });
});

describe('spokenVerdicts preference', () => {
  it('is OFF in a fresh session', () => {
    expect(emptySession().spokenVerdicts).toBe(false);
  });

  it('setSpokenVerdicts flips the flag without touching anything else', () => {
    const on = setSpokenVerdicts(emptySession(), true);
    expect(on.spokenVerdicts).toBe(true);
    expect(setSpokenVerdicts(on, false).spokenVerdicts).toBe(false);
    expect({ ...on, spokenVerdicts: false }).toEqual(emptySession());
  });

  it('does not mutate the state it is given', () => {
    const before = emptySession();
    const snapshot = JSON.stringify(before);
    setSpokenVerdicts(before, true);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('is independent of coached mode — narration is not a coached-mode feature', () => {
    const spoken = setSpokenVerdicts(emptySession(), true);
    expect(spoken.coachedMode).toBe(false);
    const coached = setCoachedMode(emptySession(), true);
    expect(coached.spokenVerdicts).toBe(false);
  });

  it('survives a serialize/deserialize round-trip', () => {
    const state = setSpokenVerdicts(emptySession(), true);
    const revived = deserialize(JSON.parse(JSON.stringify(serialize(state))));
    expect(revived).toEqual(state);
    expect(revived.spokenVerdicts).toBe(true);
  });

  it('survives recording a hand', () => {
    const after = recordHand(setSpokenVerdicts(emptySession(), true), {
      handNumber: 1,
      hole: ['As', 'Kd'],
      board: [],
      net: -50,
      vpip: true,
      pfr: false,
      grades: [],
    });
    expect(after.spokenVerdicts).toBe(true);
  });

  /** A save file that says nothing about narration must come back silent. */
  it('a legacy save with no spokenVerdicts field loads OFF', () => {
    const legacy = { bankroll: 12000, hands: [], stats: {}, coachedMode: true };
    const revived = deserialize(legacy);
    expect(revived.coachedMode).toBe(true);
    expect(revived.spokenVerdicts).toBe(false);
  });

  /** Only a real `true` may switch a voice on: a truthy string must not. */
  it('a corrupt spokenVerdicts value loads OFF', () => {
    for (const value of ['yes', 1, {}, [], 'true', null]) {
      expect(deserialize({ spokenVerdicts: value }).spokenVerdicts).toBe(false);
    }
  });
});
