const test = require('node:test');
const assert = require('node:assert/strict');
const { partitionRemoteDigest } = require('../src/services/syncDelta.ts');

test('delta digest separates missing rows from newer peer mutations', () => {
  const local = [
    { id: 'same', updated_at: '2026-08-01T00:00:00.000Z', revision: 1, is_deleted: false },
    { id: 'stale', updated_at: '2026-08-01T00:00:00.000Z', revision: 1, is_deleted: false },
    { id: 'newer-local', updated_at: '2026-08-03T00:00:00.000Z', revision: 3, is_deleted: false },
  ];
  const remote = [
    local[0],
    { id: 'stale', updated_at: '2026-08-02T00:00:00.000Z', revision: 2, is_deleted: true },
    { id: 'newer-local', updated_at: '2026-08-02T00:00:00.000Z', revision: 2, is_deleted: false },
    { id: 'missing', updated_at: '2026-08-02T00:00:00.000Z', revision: 0, is_deleted: false },
  ];

  assert.deepEqual(partitionRemoteDigest(remote, local), {
    missingIds: ['missing'],
    staleIds: ['stale'],
  });
});

test('delta digest deduplicates repeated peer entries', () => {
  const remote = [
    { id: 'missing', updated_at: '', revision: 0, is_deleted: false },
    { id: 'missing', updated_at: '', revision: 0, is_deleted: false },
  ];
  assert.deepEqual(partitionRemoteDigest(remote, []), {
    missingIds: ['missing'],
    staleIds: [],
  });
});
