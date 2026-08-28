/**
 * Operator SCAN census (#389).
 *
 *   node test/scripts/redis-key-census.test.mjs
 */
import assert from 'node:assert/strict';
import {
  KEY_PREFIXES,
  censusFromKeys,
  classifyKey,
  formatCensus,
  runKeyCensus,
} from '../../scripts/lib/redis-key-census.mjs';

// Every known prefix classifies to its own id.
for (const { id, prefix } of KEY_PREFIXES) {
  assert.equal(classifyKey(`${prefix}abc123`), id, `${prefix} classifies as ${id}`);
}
assert.equal(classifyKey('unrelated:key'), 'other');
assert.equal(classifyKey('ki:unknown-kind:x'), 'other', 'a ki: prefix not in the table is other');

// censusFromKeys groups a flat key list correctly, including unrecognised ones.
{
  const keys = [
    'ki:party:1',
    'ki:party:2',
    'ki:code:abc',
    'ki:zbox:1',
    'ki:rl:partyCreate:1.2.3.4:1234',
    'ki:rl:partyCreate:1.2.3.4:1235',
    'ki:rl:mailboxWrite:party1:99',
    'ki:guest-traces:kings-island',
    'ki:world:cedar-point',
    'ki:subs:party1',
    'ki:seq:party1',
    'something:else',
  ];
  const census = censusFromKeys(keys);
  assert.equal(census.total, keys.length);
  assert.equal(census.counts.party, 2);
  assert.equal(census.counts.code, 1);
  assert.equal(census.counts.mailbox, 1);
  assert.equal(census.counts.rateLimit, 3);
  assert.equal(census.counts.guestTraces, 1);
  assert.equal(census.counts.world, 1);
  assert.equal(census.counts.subs, 1);
  assert.equal(census.counts.seq, 1);
  assert.equal(census.other, 1);
  const sum = Object.values(census.counts).reduce((a, b) => a + b, 0) + census.other;
  assert.equal(sum, census.total, 'counts + other must reconstruct total');
}

// Empty input is a valid, all-zero census, not an error.
{
  const empty = censusFromKeys([]);
  assert.equal(empty.total, 0);
  assert.equal(empty.other, 0);
  for (const { id } of KEY_PREFIXES) assert.equal(empty.counts[id], 0);
}

// formatCensus renders every bucket plus the total, in a stable, readable shape.
{
  const rendered = formatCensus(censusFromKeys(['ki:party:1', 'orphan:key']));
  assert.match(rendered, /Party state\s+1/);
  assert.match(rendered, /\(unrecognised prefix\)\s+1/);
  assert.match(rendered, /Total\s+2/);
}

// runKeyCensus pages through an injected SCAN until the cursor returns to
// '0', aggregating every page's keys — proving the pagination contract
// without a live Redis connection.
{
  const pages = [
    { cursor: '17', keys: ['ki:party:1', 'ki:party:2'] },
    { cursor: '42', keys: ['ki:rl:partyCreate:1.2.3.4:1'] },
    { cursor: '0', keys: ['ki:world:cedar-point'] },
  ];
  const calls = [];
  const scanPage = async (cursor) => {
    calls.push(cursor);
    return pages[calls.length - 1];
  };
  const census = await runKeyCensus({ scanPage });
  assert.deepEqual(calls, ['0', '17', '42'], 'cursor chain drives each successive SCAN call');
  assert.equal(census.pages, 3);
  assert.equal(census.total, 4);
  assert.equal(census.counts.party, 2);
  assert.equal(census.counts.rateLimit, 1);
  assert.equal(census.counts.world, 1);
}

// A SCAN that never returns cursor '0' fails loudly instead of looping forever.
{
  const scanPage = async (cursor) => ({ cursor: String(Number(cursor) + 1), keys: [] });
  await assert.rejects(
    () => runKeyCensus({ scanPage, maxPages: 5 }),
    /exceeded 5 SCAN pages/,
  );
}

console.log('redis-key-census: ok');
