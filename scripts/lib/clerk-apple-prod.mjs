/**
 * Park Bound production Sign in with Apple invariants.
 * Spec: scripts/lib/clerk-apple-prod-spec.json
 */

export function at(obj, path) {
  return String(path)
    .split('.')
    .reduce((cur, key) => (cur == null ? undefined : cur[key]), obj);
}

export function evaluateClerkSignup(config, spec) {
  const violations = [];
  const expected = spec?.clerk_signup ?? {};
  for (const [path, want] of Object.entries(expected)) {
    const got = at(config, path);
    if (got !== want) {
      violations.push(`${path}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  return violations;
}

export function evaluateClerkConnection(config, spec) {
  const violations = [];
  const expected = spec?.clerk_connection ?? {};
  const apple = config?.connection_oauth_apple ?? {};
  for (const [key, want] of Object.entries(expected)) {
    const got = apple[key];
    if (got !== want) {
      violations.push(`connection_oauth_apple.${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
  }
  return violations;
}

export function evaluateProdPatchFile(prodPatch, spec) {
  const violations = evaluateClerkSignup(prodPatch, spec);
  return { ok: violations.length === 0, violations };
}

export function evaluateClerkAppleProd(pulled, spec) {
  const violations = [
    ...evaluateClerkConnection(pulled, spec),
    ...evaluateClerkSignup(pulled, spec),
  ];
  return { ok: violations.length === 0, violations };
}

export function appleDeveloperNotes(spec) {
  return spec?.apple_developer?.notes ?? [];
}
