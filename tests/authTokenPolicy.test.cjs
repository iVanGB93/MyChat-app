const test = require('node:test');
const assert = require('node:assert/strict');
const { getJwtExpiryMs, tokenNeedsRefresh } = require('../src/services/authTokenPolicy.ts');

function jwtWithExpiry(expSeconds) {
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds }))
    .toString('base64url');
  return `header.${payload}.signature`;
}

test('reads expiry from a base64url JWT payload', () => {
  assert.equal(getJwtExpiryMs(jwtWithExpiry(1_700_000_000)), 1_700_000_000_000);
});

test('refreshes only inside the requested validity margin', () => {
  const now = 1_700_000_000_000;
  assert.equal(tokenNeedsRefresh(jwtWithExpiry(1_700_000_300), 120_000, now), false);
  assert.equal(tokenNeedsRefresh(jwtWithExpiry(1_700_000_030), 120_000, now), true);
});

test('malformed access tokens are refreshed safely', () => {
  assert.equal(getJwtExpiryMs('not-a-jwt'), null);
  assert.equal(tokenNeedsRefresh('not-a-jwt'), true);
});

