import test from 'node:test';
import assert from 'node:assert/strict';
import { publicCardProblem } from './public-card-errors.js';
import { publicCardErrorPage } from '../src/services/public-card-page.js';

test('public coupon failures use safe, distinct messages and retry rules', () => {
  for (const [error, code, status, retry] of [
    [{ status: 404, message: 'Business not found.' }, 'BUSINESS_UNAVAILABLE', 404, false],
    [{ status: 404 }, 'CARD_NOT_FOUND', 404, false],
    [{ status: 410, message: 'This card is disabled.' }, 'CARD_DISABLED', 410, false],
    [{ status: 410 }, 'CARD_UNAVAILABLE', 410, false],
    [{ status: 403, message: 'This business has paused its rewards.' }, 'BUSINESS_PAUSED', 403, false],
    [{ status: 429 }, 'RETRY_LATER', 429, true],
    [{ message: 'mongodb://private-user:private-password@internal-host' }, 'SERVICE_UNAVAILABLE', 503, true],
    [{ data: { code: 'CARD_EXPIRED' } }, 'CARD_EXPIRED', 410, false],
  ]) {
    const problem = publicCardProblem(error);
    assert.equal(problem.code, code);
    assert.equal(problem.status, status);
    assert.equal(problem.retry, retry);
    assert.ok(!JSON.stringify(problem).includes('private-password'));
  }
});

test('share error screens work without scripts, escape markup and do not leak exceptions', () => {
  const unavailable = publicCardErrorPage(publicCardProblem({ message: 'Business not found.' }), '/share/abc123');
  assert.match(unavailable, /<!doctype html>/);
  assert.match(unavailable, /This coupon is no longer available/);
  assert.match(unavailable, /noindex, nofollow/);
  assert.doesNotMatch(unavailable, /Business not found\.|<script|Create a|Try again/);
  const temporary = publicCardErrorPage(publicCardProblem({}), '/share/abc123?v=5&retry=1');
  assert.match(temporary, /href="\/share\/abc123\?v=5&amp;retry=1"/);
  assert.doesNotMatch(publicCardErrorPage(publicCardProblem({}), 'https://example.test'), /href=/);
  assert.doesNotMatch(publicCardErrorPage({ title: '<script>alert(1)</script>', description: '"unsafe"' }), /<script>/);
});
