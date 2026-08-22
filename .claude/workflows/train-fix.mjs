export const meta = {
  name: 'train-fix',
  description: 'Apply the verifier findings to slice work sitting in its own worktree, then commit it',
  whenToUse: 'After train-verify returned integrate-with-fixes. Caller passes {slices:[{id,root,fixes}]}.',
  phases: [{ title: 'Fix', detail: 'one agent per slice, in the worktree that already holds the work' }],
};

/* These worktrees already hold the work. Do NOT give these agents fresh
 * isolation — a new worktree would be empty and they would rebuild the slice
 * from nothing. Each edits in place and commits, so the integrator has a real
 * commit to merge rather than a pile of unstaged files. */

const slices = args?.slices ?? [];
if (slices.length === 0) return { fixed: [], note: 'nothing to fix' };

const RESULT = {
  type: 'object',
  additionalProperties: false,
  required: ['sliceId', 'applied', 'skipped', 'committed', 'redVerified'],
  properties: {
    sliceId: { type: 'string' },
    applied: { type: 'array', items: { type: 'string' } },
    skipped: { type: 'array', items: { type: 'string' }, description: 'findings deliberately not fixed, each with why' },
    committed: { type: 'boolean' },
    commitSha: { type: 'string' },
    redVerified: { type: 'boolean', description: 'true only if each changed assertion was watched to fail first' },
    testsRun: { type: 'array', items: { type: 'string' } },
    notesForIntegrator: { type: 'array', items: { type: 'string' } },
  },
};

const results = await parallel(
  slices.map((s) => () =>
    agent(
      `Apply review findings to slice ${s.id}, in the worktree that already holds the work.

WORKTREE: ${s.root}
Work there and ONLY there. The work is present as uncommitted changes and/or a
commit; \`git status --porcelain\` and \`git diff HEAD\` show it. Do NOT create a
new worktree — a fresh one would be empty and you would rebuild the slice from
nothing.

An adversarial reviewer read the real diff and found these. Fix them:

${s.fixes.map((f, i) => `${i + 1}. ${f}`).join('\n\n')}

Rules:
- Fix ONLY what is listed. Do not widen the slice, refactor adjacent code, or
  "improve" anything you were not asked about. The diff is already reviewed;
  every extra line is an unreviewed line.
- A finding you judge wrong is fine to skip — put it in \`skipped\` with the
  reason. Do not silently ignore one, and do not fake a fix.
- Red before green. Any assertion you add or change must be WATCHED to fail
  first: make the fix, revert the source, see the new assertion fail on its own
  message, restore. Report redVerified honestly; a false is useful, a wrong true
  poisons the integration.
- Where a finding says a test cannot fail, the fix is to make it able to fail —
  either assert the real behaviour behind the constant, or delete the assertion
  if nothing behavioural is behind it. Do not paper over it.
- Do NOT edit package.json, scripts/ci/manifest.mjs, or any shared registry or
  manifest. Unwired tests stay unwired — report them in notesForIntegrator with
  the exact npm script they belong in, and the integrator lands it.
- Do NOT edit apps/party-tracker/public/app-version.json (bumped on merge).
- Run the test files your change touches and report them in testsRun.

Finish by committing IN THAT WORKTREE with a message that says what changed and
why, and report the sha. Leave the worktree clean.`,
      { label: `fix:${s.id}`, phase: 'Fix', schema: RESULT, effort: 'high' },
    ),
  ),
);

const ok = results.filter(Boolean);
return {
  committed: ok.filter((r) => r.committed).map((r) => ({ id: r.sliceId, sha: r.commitSha })),
  uncommitted: ok.filter((r) => !r.committed).map((r) => r.sliceId),
  redNotVerified: ok.filter((r) => !r.redVerified).map((r) => r.sliceId),
  skipped: ok.flatMap((r) => (r.skipped ?? []).map((x) => `${r.sliceId}: ${x}`)),
  forIntegrator: ok.flatMap((r) => (r.notesForIntegrator ?? []).map((x) => `${r.sliceId}: ${x}`)),
};
