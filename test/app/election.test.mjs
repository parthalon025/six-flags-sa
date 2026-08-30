#!/usr/bin/env node
/**
 * lib/party/election.js — direct unit coverage for #311's two behavioural
 * defects that party-protocol.test.mjs's transcribed-peer harness does not
 * pin by name: a promoted host reasserting against a rival claim, and host
 * traffic during an open election cancelling it outright.
 *
 * (Simultaneous-promotion convergence and the battery-gap split-brain
 * resolution are already covered, through the full peer harness, by
 * party-protocol.test.mjs's "two phones that promote at once settle on the
 * total order" and "the election margin DOES resolve a split brain" checks
 * — not repeated here.)
 *
 * All timers are driven by hand: `now` is a mutable counter and every
 * setTimeout/setInterval the module would schedule is a no-op, so `tick()`
 * and the frame handlers are the only things that move state. That makes
 * every check below deterministic — no real waiting, no flakiness budget.
 */

import assert from 'node:assert/strict';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const code = warning?.code ?? rest.find((r) => typeof r === 'string');
  if (code === 'MODULE_TYPELESS_PACKAGE_JSON') return;
  emitWarning(warning, ...rest);
};

const APP = '../../apps/party-tracker/';
const { createElection } = await import(`${APP}lib/party/election.js`);
const { VICTORY } = await import(`${APP}lib/core/protocol.js`);

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

const HOST_TIMEOUT_MS = 12000;
const CLAIM_WINDOW_MS = 2500;

/** A fully hand-driven election: no real timer ever fires on its own. */
function makeElection(overrides = {}) {
  let nowMs = 1000;
  const sent = [];
  const election = createElection({
    selfId: 'self',
    getCandidate: () => ({ battery: 1, signal: 1, network: 1, performance: 1, joinOrder: 0 }),
    send: (kind, body) => {
      sent.push({ kind, body });
    },
    now: () => nowMs,
    hostTimeoutMs: HOST_TIMEOUT_MS,
    claimWindowMs: CLAIM_WINDOW_MS,
    setTimeoutFn: () => 0,
    clearTimeoutFn: () => {},
    setIntervalFn: () => 0,
    clearIntervalFn: () => {},
    ...overrides,
  });
  return {
    election,
    sent,
    advance(ms) {
      nowMs += ms;
    },
  };
}

console.log('\n--- election: #311 ---');

await check('host traffic during an open election cancels it (host was never gone)', () => {
  const { election, advance } = makeElection();
  election.start();
  advance(HOST_TIMEOUT_MS + 1);
  election.tick(); // beginElection(): nobody has claimed anything yet
  assert.equal(election.isElecting(), true, 'silence past the timeout opened an election');

  election.noteHostSeen('the-real-host');
  assert.equal(election.isElecting(), false, 'host traffic cancelled the election outright');
  assert.equal(election.isPromoted(), false, 'and did not promote us in the process');
  assert.equal(election.leader(), 'the-real-host');

  // And it stays cancelled — a tick that would otherwise have resolved a
  // still-open election must not resurrect one that was already stood down.
  advance(CLAIM_WINDOW_MS + HOST_TIMEOUT_MS + 1);
  election.tick();
  assert.equal(election.isPromoted(), false, 'no re-election ping-pong out of a cancelled round');
});

await check('a promoted host reasserts against a rival claim, rate-limited by the reassert gap', () => {
  const { election, sent, advance } = makeElection();
  election.start();
  advance(HOST_TIMEOUT_MS + 1);
  election.tick(); // begin
  advance(CLAIM_WINDOW_MS + HOST_TIMEOUT_MS + 1);
  election.tick(); // resolve -> nobody else claimed -> we promote
  assert.equal(election.isPromoted(), true);
  const victoriesAfterPromote = sent.filter((s) => s.kind === VICTORY).length;
  assert.equal(victoriesAfterPromote, 1, 'promote() sends its own VICTORY');

  // The reassert gap is measured from the VICTORY promote() itself just
  // sent, so a rival claim landing immediately after must not double up.
  election.handleClaim({ from: 'rival', body: { score: 1, joinOrder: 5 } });
  assert.equal(
    sent.filter((s) => s.kind === VICTORY).length,
    1,
    'no reassertion inside the gap opened by promote()’s own VICTORY',
  );

  // Once that gap has passed, a rival claiming lower than us — which we
  // outrank — earns a reassertion.
  advance(HOST_TIMEOUT_MS / 8 + 1);
  election.handleClaim({ from: 'rival', body: { score: 1, joinOrder: 5 } });
  assert.equal(sent.filter((s) => s.kind === VICTORY).length, 2, 'one reassertion for the claim');

  // A second claim arriving immediately after must NOT trigger a second
  // reassertion — that is the reassert-gap floor.
  election.handleClaim({ from: 'rival', body: { score: 1, joinOrder: 5 } });
  assert.equal(
    sent.filter((s) => s.kind === VICTORY).length,
    2,
    'rate-limited: no reassertion inside the reassert gap',
  );

  // Once the gap has passed, the next rival claim earns a fresh reassertion.
  advance(HOST_TIMEOUT_MS / 8 + 1);
  election.handleClaim({ from: 'rival', body: { score: 1, joinOrder: 5 } });
  assert.equal(
    sent.filter((s) => s.kind === VICTORY).length,
    3,
    'reasserted again once the gap had passed',
  );
});

await check('a serving host yields when a rival VICTORY outranks its own claim', () => {
  const { election, advance } = makeElection();
  election.start();
  advance(HOST_TIMEOUT_MS + 1);
  election.tick();
  advance(CLAIM_WINDOW_MS + HOST_TIMEOUT_MS + 1);
  election.tick();
  assert.equal(election.isPromoted(), true);

  let demoted = null;
  election.onDemote((e) => {
    demoted = e;
  });
  // An unscored VICTORY (UNSCORED_RANK_DEFAULTS) is unbeatable by design —
  // yielding to a host that is already serving is always safe.
  election.handleVictory({ from: 'rival-host', body: {} });
  assert.equal(election.isPromoted(), false, 'stood down for the already-serving rival');
  assert.equal(election.leader(), 'rival-host');
  assert.ok(demoted, 'the demote event fired so the runtime can react');
});

if (FAIL.length) {
  console.error(`election tests: ${FAIL.length} failed`);
  for (const f of FAIL) console.error(' !', f);
  process.exitCode = 1;
} else {
  console.log(`election tests: ${PASS.length} passed`);
}
