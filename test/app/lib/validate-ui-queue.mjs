/**
 * Suite plan for validate-ui — which processes to run, and in what order.
 *
 * Kept apart from validate-ui.mjs because that file runs the suites the moment
 * it is imported; the planning is the part worth asserting on.
 *
 * Interface:
 *   buildQueue({ functional, grandma, parallel })
 */

/**
 * Serially the functional modules stay one process — the shape this suite has
 * always run in — because splitting them only pays when they can overlap, and
 * every extra process re-launches a browser.
 *
 * Every suite here drives its own browser, so they all cost about the same and
 * the queue runs in the order it is built. Reintroduce an ordering only when a
 * cheap suite joins, and give it a test that would fail without one.
 */
export function buildQueue({ functional = [], grandma = false, parallel = false } = {}) {
  const queue = [];
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
  return queue;
}
