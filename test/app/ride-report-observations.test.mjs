#!/usr/bin/env node
/**
 * Party E7.2 — ride report → observation series with offline queue (#328).
 *
 * Seams:
 *   observationFromRideReport — maps party ride down/open to wire rows
 *   observationFromQueueBandReport — maps queue-band taps to waitMin rows
 *   recordRideReportObservation / flushRideReportObservations — queue + drain
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const { observationFromRideReport, observationFromQueueBandReport } = await import(
  '../../apps/party-tracker/lib/observations/rideReport.js'
);
const { recordRideReportObservation, flushRideReportObservations } = await import(
  '../../apps/party-tracker/lib/observations/rideReportSync.js'
);

const PASS = [];
const FAIL = [];
const check = async (name, fn) => {
  try {
    await fn();
    PASS.push(name);
    console.log('  PASS', name);
  } catch (err) {
    FAIL.push(`${name} :: ${err.message}`);
    console.log('  FAIL', name, '->', err.message);
  }
};

console.log('\n--- ride report observations ---');

await check('observationFromRideReport maps down with party-report source', () => {
  const row = observationFromRideReport({
    id: 'obs_demo',
    venueId: 'kings-island',
    rideId: 'orion',
    status: 'down',
    ts: 1_700_000_000_000,
    authorId: 'usr_demo',
  });
  assert.ok(row);
  assert.equal(row.placeId, 'orion');
  assert.equal(row.status, 'down');
  assert.equal(row.source, 'party-report');
  assert.equal(row.id, 'obs_demo');
  assert.equal(row.ts, new Date(1_700_000_000_000).toISOString());
});

await check('observationFromRideReport maps open', () => {
  const row = observationFromRideReport({
    venueId: 'kings-island',
    rideId: 'orion',
    status: 'open',
    ts: '2026-09-20T12:00:00.000Z',
  });
  assert.ok(row);
  assert.equal(row.status, 'open');
});

await check('observationFromRideReport rejects retract/null status', () => {
  assert.equal(
    observationFromRideReport({
      venueId: 'kings-island',
      rideId: 'orion',
      status: null,
      ts: Date.now(),
    }),
    null,
  );
});

await check('observationFromQueueBandReport maps wait band with party-queue source', () => {
  const row = observationFromQueueBandReport({
    id: 'obs_queue',
    venueId: 'kings-island',
    rideId: 'orion',
    band: 'medium',
    ts: 1_700_000_000_000,
  });
  assert.ok(row);
  assert.equal(row.waitMin, 45);
  assert.equal(row.source, 'party-queue');
  assert.equal(row.status, undefined);
});

await check('record + flush preserves original ts and is idempotent on client id', async () => {
  const posted = [];
  const reportTs = 1_699_000_000_000;
  await recordRideReportObservation(
    {
      id: 'obs_repeat',
      venueId: 'kings-island',
      rideId: 'orion',
      status: 'down',
      ts: reportTs,
    },
    {
      append: async (row) => {
        posted.push(row);
      },
      queue: {
        entries: [],
        async load() {
          return [...this.entries];
        },
        async remove(id) {
          this.entries = this.entries.filter((e) => e.id !== id);
        },
        async append(entry) {
          if (this.entries.some((e) => e.id === entry.id)) return;
          this.entries.push(entry);
        },
      },
    },
  );
  assert.equal(posted.length, 1);
  assert.equal(posted[0].ts, new Date(reportTs).toISOString());

  posted.length = 0;
  await recordRideReportObservation(
    {
      id: 'obs_repeat',
      venueId: 'kings-island',
      rideId: 'orion',
      status: 'down',
      ts: reportTs,
    },
    {
      append: async (row) => {
        posted.push(row);
      },
      queue: {
        entries: [{ id: 'obs_repeat', ts: reportTs, kind: 'ride', detail: { venueId: 'kings-island', placeId: 'orion', status: 'down' } }],
        async load() {
          return [...this.entries];
        },
        async remove(id) {
          this.entries = this.entries.filter((e) => e.id !== id);
        },
        async append() {},
      },
    },
  );
  assert.equal(posted.length, 1, 're-record with same id does not double-post when still queued');
});

await check('flushRideReportObservations drains queue-band entries on reconnect', async () => {
  const pending = [
    {
      id: 'obs_queue_offline',
      ts: 1_697_000_000_000,
      kind: 'queue',
      detail: {
        venueId: 'kings-island',
        placeId: 'orion',
        waitMin: 45,
        source: 'party-queue',
        confidence: 'low',
      },
    },
  ];
  const posted = [];
  const result = await flushRideReportObservations({
    queue: {
      async load() {
        return [...pending];
      },
      async remove(id) {
        const idx = pending.findIndex((e) => e.id === id);
        if (idx >= 0) pending.splice(idx, 1);
      },
    },
    append: async (row) => {
      posted.push(row);
    },
  });
  assert.deepEqual(result, { flushed: 1, failed: 0 });
  assert.equal(posted[0].waitMin, 45);
  assert.equal(posted[0].source, 'party-queue');
  assert.equal(pending.length, 0);
});

await check('flushRideReportObservations drains offline queue on reconnect', async () => {
  const pending = [
    {
      id: 'obs_offline',
      ts: 1_698_000_000_000,
      kind: 'ride',
      detail: {
        venueId: 'kings-island',
        placeId: 'beast',
        status: 'down',
        source: 'party-report',
        confidence: 'low',
      },
    },
  ];
  const posted = [];
  const result = await flushRideReportObservations({
    queue: {
      async load() {
        return [...pending];
      },
      async remove(id) {
        const idx = pending.findIndex((e) => e.id === id);
        if (idx >= 0) pending.splice(idx, 1);
      },
    },
    append: async (row) => {
      posted.push(row);
    },
  });
  assert.deepEqual(result, { flushed: 1, failed: 0 });
  assert.equal(posted[0].placeId, 'beast');
  assert.equal(posted[0].ts, new Date(1_698_000_000_000).toISOString());
  assert.equal(pending.length, 0);
});

await check('record queues offline when POST fails then flush preserves original ts', async () => {
  const reportTs = 1_696_500_000_000;
  const queue = {
    entries: [],
    async load() {
      return [...this.entries];
    },
    async remove(id) {
      this.entries = this.entries.filter((e) => e.id !== id);
    },
    async append(entry) {
      if (this.entries.some((e) => e.id === entry.id)) return;
      this.entries.push(entry);
    },
  };
  const posted = [];
  await recordRideReportObservation(
    {
      id: 'obs_offline_record',
      venueId: 'kings-island',
      rideId: 'mystic-timbers',
      status: 'down',
      ts: reportTs,
    },
    {
      queue,
      append: async () => {
        throw new Error('offline');
      },
    },
  );
  assert.equal(queue.entries.length, 1, 'failed POST leaves entry queued');
  assert.equal(posted.length, 0);

  const result = await flushRideReportObservations({
    queue,
    append: async (row) => {
      posted.push(row);
    },
  });
  assert.deepEqual(result, { flushed: 1, failed: 0 });
  assert.equal(posted.length, 1);
  assert.equal(posted[0].ts, new Date(reportTs).toISOString());
  assert.equal(queue.entries.length, 0);
});

await check('double flushRideReportObservations does not double-post a drained entry', async () => {
  const pending = [
    {
      id: 'obs_double_flush',
      ts: 1_695_000_000_000,
      kind: 'ride',
      detail: {
        venueId: 'kings-island',
        placeId: 'orion',
        status: 'open',
        source: 'party-report',
        confidence: 'low',
      },
    },
  ];
  const posted = [];
  const queue = {
    async load() {
      return [...pending];
    },
    async remove(id) {
      const idx = pending.findIndex((e) => e.id === id);
      if (idx >= 0) pending.splice(idx, 1);
    },
  };
  const append = async (row) => {
    posted.push(row);
  };

  await flushRideReportObservations({ queue, append });
  await flushRideReportObservations({ queue, append });

  assert.equal(posted.length, 1, 'second flush on empty queue must not post again');
  assert.equal(pending.length, 0);
});

if (FAIL.length) {
  console.error(`\nride report observations tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' ', f);
  process.exit(1);
}
console.log(`\nride report observations tests: ${PASS.length} passed`);
