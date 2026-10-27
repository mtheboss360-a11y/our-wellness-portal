import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUICK_RESULTS, defaultReturnDate, quickOutcomeFor, runnerOutcomeLabel } from '../src/lib/runner-outcomes';
import { OUTCOMES } from '../server/outreach';

test('quick-hit choices map to real server outcomes rather than cosmetic checkmarks', () => {
  assert.deepEqual(QUICK_RESULTS.map(r => r.label), ['Accepted', 'Declined', 'Asked to come back']);
  assert.equal(quickOutcomeFor('accepted'), 'partner');
  assert.equal(quickOutcomeFor('declined'), 'declined');
  assert.equal(quickOutcomeFor('come-back'), 'follow-up');
  for (const r of QUICK_RESULTS) assert.ok(OUTCOMES[r.outcome], `${r.key} must be a valid server outcome`);
});
test('suggested return date is seven calendar days later (even across month end)', () => {
  assert.equal(defaultReturnDate('2026-10-27'), '2026-11-03');
  assert.equal(defaultReturnDate('2026-12-29'), '2027-01-05');
});

test('runner-facing completed-stop labels match the quick buttons', () => {
  assert.equal(runnerOutcomeLabel('partner', 'Partnership established'), 'Accepted');
  assert.equal(runnerOutcomeLabel('declined', 'Not interested'), 'Declined');
  assert.equal(runnerOutcomeLabel('follow-up', 'Follow-up required'), 'Asked to come back');
  assert.equal(runnerOutcomeLabel('materials', 'Materials dropped only'), 'Materials dropped only');
});
