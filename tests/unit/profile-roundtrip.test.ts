import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../../src/core/session.js';

/**
 * The downgrade hole: deserialize builds a fresh object from the keys it knows and serialize writes only
 * those, so a build that loads a profile written by a newer one and saves it erases the newer fields.
 */
describe('unknown profile keys survive a load and save', () => {
  it('keeps a top-level key this build does not know', () => {
    const onDisk = { bankroll: 9000, hands: [], stats: {}, futureFeature: { kept: [1, 2, 3] } };
    const saved = serialize(deserialize(JSON.parse(JSON.stringify(onDisk))));
    expect(saved.futureFeature).toEqual({ kept: [1, 2, 3] });
    expect(saved.bankroll).toBe(9000);
  });
});
