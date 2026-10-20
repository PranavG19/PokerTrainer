import { describe, expect, it } from 'vitest';
import { momentKey } from '../../src/renderer/components/moment.js';

describe('the moment plays once per session, not once per kind per day', () => {
  it('two assessment blocks or two story tables on one day are two moments; one re-diffed session is one', () => {
    const day = 20746;
    const a1 = momentKey('assessment', day, { assessments: 1, storyTables: 0 });
    const a2 = momentKey('assessment', day, { assessments: 2, storyTables: 0 });
    expect(a1).not.toBe(a2);
    expect(momentKey('assessment', day, { assessments: 1, storyTables: 5 })).toBe(a1);
    expect(momentKey('story-table', day, { assessments: 0, storyTables: 3 })).not.toBe(momentKey('story-table', day, { assessments: 0, storyTables: 4 }));
  });

  it('the Ticket and the twelfth hand happen once a day by nature', () => {
    expect(momentKey('ticket', 1, { assessments: 9, storyTables: 9 })).toBe(momentKey('ticket', 1, { assessments: 0, storyTables: 0 }));
    expect(momentKey('table-hands', 1, { assessments: 0, storyTables: 0 })).not.toBe(momentKey('table-hands', 2, { assessments: 0, storyTables: 0 }));
  });
});
