// Does the tolerant parser actually drop unusable override entries on a round trip?
import { deserialize, serialize } from '../../src/core/session.js';

const corrupt = {
  bankroll: 10000, hands: [], rebuys: 0,
  stats: { handsPlayed: 20, vpipHands: 5, pfrHands: 3, evLossBb: 4, leaks: {}, leakCostBb: {} },
  calibration: { total: 0, correct: 0, sureWrong: 0 },
  coachedMode: false, spokenVerdicts: false,
  recommender: {
    overrides: [{ timestamp: 'not-a-number', recommended: 5 }, null, 'nonsense',
                { timestamp: 123, recommended: 'real', chosen: 'x' }],
    consecutiveDeclines: -99,
    preferred: ['not-a-real-source', 42, 'mastery'],
  },
};
const state = deserialize(corrupt);
console.log('after deserialize:', JSON.stringify(state.recommender, null, 2));
console.log('after re-serialize:', JSON.stringify(serialize(state).recommender, null, 2));
