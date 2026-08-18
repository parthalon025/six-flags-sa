/**
 * Suite plan for validate-ui — which processes to run, and in what order.
 *
 * Kept apart from validate-ui.mjs because that file runs the suites the moment
 * it is imported; the planning is the part worth asserting on.
 *
 * Interface:
 *   buildQueue({ contract, functional, grandma, parallel })
 */

/** Browser suites dominate the wall clock, so they start first. */
function cost(suite) {
  if (suite.id.startsWith('functional:')) return 2;
  if (suite.id === 'grandma') return 2;
  return 0;
}

/**
 * Serially the functional modules stay one process — the shape this suite has
 * always run in — because splitting them only pays when they can overlap, and
 * every extra process re-launches a browser.
 */
export function buildQueue({
  contract = false,
  functional = [],
  grandma = false,
  parallel = false,
} = {}) {
  const queue = [];
  if (contract) {
    queue.push({
      id: 'coverage-contract',
      name: 'Critical-path coverage contract',
      script: 'coverage-contract.mjs',
      args: [],
    });
  }
  if (grandma) {
    queue.push({
      id: 'grandma',
      name: 'Grandma test (first-time visitor personas)',
      script: 'grandma.mjs',
      args: [],
    });
  }
  if (functional.length) {
    if (parallel) {
      for (const id of functional) {
        queue.push({
          id: `functional:${id}`,
          name: `E2E functional suite (${id})`,
          script: 'functional.mjs',
          args: [`--modules=${id}`],
        });
      }
    } else {
      const list = functional.join(',');
      queue.push({
        id: `functional:${list}`,
        name: `E2E functional suite (${list})`,
        script: 'functional.mjs',
        args: [`--modules=${list}`],
      });
    }
  }
  // Longest first: the pool is only as fast as its slowest late start.
  return queue.sort((x, y) => cost(y) - cost(x));
}
