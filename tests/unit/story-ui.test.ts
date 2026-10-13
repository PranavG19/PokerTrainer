// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { defaultProgression } from '../../src/core/progression/persist.js';
import { buildRoute, type LoggedDecision } from '../../src/core/story/route.js';
import { renderStoryStrip } from '../../src/renderer/screens/story.js';

const charged = (street: LoggedDecision['street'], evLossBb: number): LoggedDecision => ({
  street,
  action: 'fold',
  toCall: 100,
  verdict: { severity: 'serious', evLossBb, principle: 'pot odds' },
});

describe('the Home strip', () => {
  it('a personalized next chapter names its data: the hands read, the leak and its cost', () => {
    const route = buildRoute([{ decisions: [charged('river', 3)] }, { decisions: [charged('river', 2)] }], defaultProgression().story);
    const strip = renderStoryStrip({ route, unmasked: () => false, onOpen: () => undefined });
    expect(strip.dataset.venue).toBe('night-train');
    expect(strip.textContent).toContain('built from your last 2 hands: folding to bets the price said to call, 5.0 bb');
    expect(strip.title).toBe(route.chapters[0].citation);
  });

  it('a new player’s strip claims no leak', () => {
    const strip = renderStoryStrip({ route: buildRoute([], defaultProgression().story), unmasked: () => false, onOpen: () => undefined });
    expect(strip.textContent).toContain('Next: The Lighthouse, its regular, still masked');
    expect(strip.textContent).not.toContain('built from');
  });
});
