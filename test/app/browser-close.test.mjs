#!/usr/bin/env node
/**
 * browser.mjs shutdown seams — party functional must exit, not wedge CI (#316).
 */
import assert from 'node:assert/strict';
import { withTimeout, simulateHostPhoneLost, closePhoneContext } from './browser.mjs';

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

await check('withTimeout resolves when the work finishes first', async () => {
  const out = await withTimeout(Promise.resolve('ok'), 500, 'fast');
  assert.equal(out, 'ok');
});

await check('withTimeout rejects when the work outlasts the bound', async () => {
  await assert.rejects(
    () =>
      withTimeout(
        new Promise((resolve) => setTimeout(resolve, 200)),
        20,
        'slow work',
      ),
    /slow work timed out after 20ms/,
  );
});

await check('simulateHostPhoneLost navigates to about:blank', async () => {
  const calls = [];
  const page = {
    goto: async (url, opts) => {
      calls.push({ url, opts });
    },
  };
  await simulateHostPhoneLost(page, { timeoutMs: 1000, label: 'host' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'about:blank');
});

await check('simulateHostPhoneLost drops only benign about:blank localStorage errors', async () => {
  const errors = [
    'A pageerror: Failed to read the localStorage property from Window: Access is denied for this document.',
    'A pageerror: real app bug',
  ];
  const page = {
    goto: async () => {},
  };
  await simulateHostPhoneLost(page, { timeoutMs: 1000, label: 'host', errors });
  assert.deepEqual(errors, ['A pageerror: real app bug']);
});

await check('closePhoneContext strips benign about:blank localStorage errors after blanking', async () => {
  const errors = [
    'D pageerror: Failed to read the localStorage property from Window: Access is denied for this document.',
    'D pageerror: real app bug',
  ];
  const phone = {
    label: 'D',
    errors,
    page: {
      isClosed: () => false,
      goto: async () => {},
    },
    context: {
      close: async () => {},
    },
  };
  await closePhoneContext(phone, { timeoutMs: 500, label: 'phone D' });
  assert.deepEqual(errors, ['D pageerror: real app bug']);
});

await check('closePhoneContext blanks the page before closing the context', async () => {
  const calls = [];
  const phone = {
    label: 'A',
    page: {
      isClosed: () => false,
      goto: async (url) => {
        calls.push(`goto:${url}`);
      },
    },
    context: {
      close: async () => {
        calls.push('close');
      },
    },
  };
  await closePhoneContext(phone, { timeoutMs: 500, label: 'phone A' });
  assert.deepEqual(calls, ['goto:about:blank', 'close']);
});

console.log(`\n==== ${PASS.length} passed, ${FAIL.length} failed ====`);
if (FAIL.length) {
  FAIL.forEach((f) => console.log(' !', f));
  process.exit(1);
}
