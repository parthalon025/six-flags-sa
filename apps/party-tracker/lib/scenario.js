/**
 * Local scenario overlay — staged actions over live party/venue state.
 *
 * Scenarios are local to one phone (not replicated). Merging emits ordinary
 * commands so the party sees shared outcomes at one version bump.
 */

/** @typedef {{ id: string, label: string, steps: object[], createdAt: number }} Scenario */

const STORAGE_KEY = 'party-scenario-v1';

export function loadScenario() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveScenario(scenario) {
  if (typeof localStorage === 'undefined') return;
  if (!scenario) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(scenario));
}

export function createScenario(label = 'Plan') {
  return { id: `sc-${Date.now()}`, label, steps: [], createdAt: Date.now() };
}

/** Add a step referencing a place by stable id. */
export function addStep(scenario, step) {
  if (!scenario) return null;
  const next = {
    ...scenario,
    steps: [...scenario.steps, { id: `st-${Date.now()}`, ...step }],
  };
  saveScenario(next);
  return next;
}

export function clearScenario() {
  saveScenario(null);
}

/** Steps whose ride is reported down are struck through, not dropped. */
export function visibleSteps(scenario, rides = {}) {
  if (!scenario?.steps?.length) return [];
  return scenario.steps.map((step) => {
    const report = step.placeId ? rides[step.placeId] : null;
    const down = report?.status === 'down';
    return { ...step, down, reason: down ? report.note || 'Reported down' : null };
  });
}

/** Merge non-down steps into wire commands (meet moves, targets). */
export function mergeScenario(scenario, rides = {}) {
  const steps = visibleSteps(scenario, rides).filter((s) => !s.down);
  const ops = [];
  for (const step of steps) {
    if (step.kind === 'meet' && step.at) {
      ops.push({ kind: 'set-meet', body: { meet: { lat: step.at.lat, lng: step.at.lng, label: step.label } } });
    }
    if (step.kind === 'target' && step.placeId) {
      ops.push({ kind: 'set-target', body: { rideId: step.placeId } });
    }
  }
  return ops;
}
