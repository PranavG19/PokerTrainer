// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderTeachDee, type TeachDeeProps } from '../../src/renderer/screens/contrast.js';
import type { FolioCard } from '../../src/core/folio.js';
import type { TaughtSet } from '../../src/core/progression/types.js';
import type { LexiconAttempt } from '../../src/core/lexicon.js';
import type { DayKey } from '../../src/core/localDay.js';

/**
 * The Teach Dee screen's wiring over core/teachDee.ts (tested on its own): the phases run pick → read → play →
 * repair, the learner commits before any reveal, the finished set is handed up exactly once, a rewrite goes to the
 * lexicon callback, and Character off removes Dee's lines but not the facts.
 */

const CARD: FolioCard = {
  conceptId: 'polarity-picks-the-size',
  text: 'Suited hands realise their equity better, so I bet them; offsuit I check',
  source: 'lesson',
  writtenOn: 20000 as DayKey,
  earlier: [],
  lastPolishedOn: 20000 as DayKey,
  tarnished: false,
  tarnish: 0,
  waveDay: 1,
  dueInDays: 1,
};

function mount(over: Partial<TeachDeeProps> = {}) {
  const finished: TaughtSet[] = [];
  const attempts: LexiconAttempt[] = [];
  let backs = 0;
  let clock = 1_760_000_000_000;
  const root = renderTeachDee({
    cards: [CARD],
    label: (id) => id,
    initialConcept: null,
    taught: [],
    rewritesDue: [],
    lexicon: [],
    dee: { tone: 'warm', character: true },
    principleOf: () => 'value or bluff',
    onFinished: (s) => finished.push(s),
    onLexiconAttempt: (a) => attempts.push(a),
    onBack: () => backs++,
    backLabel: 'Rulebook',
    onWriteRule: () => {},
    now: () => (clock += 1000),
    ...over,
  });
  document.body.replaceChildren(root);
  const q = (testid: string) => root.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  const qa = (testid: string) => [...root.querySelectorAll<HTMLElement>(`[data-testid="${testid}"]`)];
  return { root, q, qa, finished, attempts, backs: () => backs };
}

function playThrough(m: ReturnType<typeof mount>, move = 'passive'): void {
  m.q('teach-start')!.click();
  const total = Number(m.q('teach-play')!.dataset.total);
  for (let i = 0; i < total; i++) {
    expect(m.q('teach-reveal')).toBeNull();
    m.qa('teach-move').find((b) => b.dataset.move === move)!.click();
    expect(m.q('teach-reveal')).not.toBeNull();
    m.q('teach-next')!.click();
  }
}

describe('Teach Dee screen', () => {
  it('runs pick → read → play → repair and hands the finished set up once', () => {
    const m = mount();
    expect(m.root.dataset.phase).toBe('pick');
    m.q('teach-rule')!.click();
    expect(m.root.dataset.phase).toBe('read');
    expect(m.q('teach-reading')!.dataset.axis).toBe('suitedness');
    playThrough(m);
    expect(m.root.dataset.phase).toBe('repair');
    expect(m.finished).toHaveLength(1);
    expect(m.finished[0]).toMatchObject({ conceptId: CARD.conceptId, base: 'turn-probe', axis: 'suitedness', finding: 'too-broad', text: CARD.text });
    // A repaint (a diagnosis click) records nothing more.
    m.qa('teach-diagnose-option').find((b) => b.dataset.finding === 'wrong')!.click();
    expect(m.finished).toHaveLength(1);
    expect(m.q('teach-diagnosis')!.dataset.match).toBe('false');
    expect(m.q('teach-finding')!.dataset.finding).toBe('too-broad');
  });

  it('hides the finding until the learner has named what went wrong', () => {
    const m = mount({ initialConcept: CARD.conceptId });
    playThrough(m);
    expect(m.q('teach-finding')).toBeNull();
    expect(m.qa('teach-diagnose-option')).toHaveLength(5);
    expect(m.q('teach-rewrite')).toBeNull();
    m.qa('teach-diagnose-option').find((b) => b.dataset.finding === 'too-broad')!.click();
    expect(m.q('teach-finding')).not.toBeNull();
    expect(m.q('teach-rewrite')).not.toBeNull();
  });

  it('a rewrite goes to the lexicon; an accepted one can be taught straight away', () => {
    const m = mount({ initialConcept: CARD.conceptId });
    playThrough(m);
    m.qa('teach-diagnose-option')[0].click();
    const box = m.q('teach-rewrite-input') as HTMLTextAreaElement;
    box.value = '   ';
    m.q('teach-rewrite-submit')!.click();
    expect(m.attempts).toHaveLength(0);
    box.value = 'Suited connectors realise their equity well enough to bet';
    m.q('teach-rewrite-submit')!.click();
    expect(m.attempts).toHaveLength(1);
    expect(m.attempts[0]).toMatchObject({ conceptId: CARD.conceptId, outcome: 'accepted', flippingAxis: 'kickerGap' });
    m.q('teach-again')!.click();
    expect(m.root.dataset.phase).toBe('read');
    expect(m.q('teach-quote')!.textContent).toContain('Suited connectors realise');
  });

  it('a second set on the same rule deals new cards (its seed counts the sets taught)', () => {
    const holes = (taught: TaughtSet[]): string => {
      const m = mount({ initialConcept: CARD.conceptId, taught });
      m.q('teach-start')!.click();
      return m.qa('teach-hole').map((h) => h.textContent).join('|') + m.q('teach-play')!.dataset.spot;
    };
    const first = mount({ initialConcept: CARD.conceptId });
    playThrough(first);
    expect(holes(first.finished)).not.toBe(holes([]));
  });

  it('Character off: no Dee mark or line, and the plays read as the rule’s', () => {
    const m = mount({ initialConcept: CARD.conceptId, dee: { tone: 'warm', character: false } });
    expect(m.q('teach-dee-line')).toBeNull();
    m.q('teach-start')!.click();
    m.qa('teach-move')[0].click();
    expect(m.q('teach-dee-move')!.textContent).toMatch(/^The rule:/);
    expect(m.root.querySelector('[data-testid="dee-mark"]')).toBeNull();
  });

  it('an empty Folio says where a rule is written, and back leaves', () => {
    const m = mount({ cards: [] });
    expect(m.q('teach-empty')).not.toBeNull();
    m.q('teach-back')!.click();
    expect(m.backs()).toBe(1);
  });
});
