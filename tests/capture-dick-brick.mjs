import assert from 'node:assert/strict';
import { awardCandidate, projectedWinProbability } from '../scripts/capture-dick-brick.mjs';

const side = (manager, probability, projectedPoints) => ({ manager, managerId: manager, team: `${manager} team`, winProbability: probability, projectedPoints });
const snapshot = {
  matchups: [
    { id: 1, home: side('Favorite who won', 91.1, 150), away: side('A', 74.2, 128) },
    { id: 2, home: side('B', 63.5, 120), away: side('Favorite who lost', 86.4, 143) }
  ]
};

assert.equal(projectedWinProbability(100, 100), 50);
assert.ok(projectedWinProbability(112, 100) > 70 && projectedWinProbability(112, 100) < 75);
assert.equal(projectedWinProbability(80, 100), 15.9);
const award = awardCandidate(snapshot, [
  { id: 1, winner: 'HOME', home: { totalPoints: 123.45 }, away: { totalPoints: 111.11 } },
  { id: 2, winner: 'HOME', home: { totalPoints: 120 }, away: { totalPoints: 119.5 } }
]);
assert.equal(award.manager, 'Favorite who lost');
assert.equal(award.winProbability, 86.4);
assert.equal(award.opponent, 'B team');
assert.equal(award.finalScore, '119.50–120.00');
assert.equal(awardCandidate(snapshot, [{ id: 1, winner: 'HOME', home: {}, away: {} }]), null);
console.log('Passed: probability calibration, highest losing favorite selection, final-score receipt, and incomplete-score protection.');
