export const meta = {
  name: 'train-slices',
  description: 'Build every startable Train H/I slice in its own worktree, then verify each landed',
  whenToUse: 'A session that wants to advance Trains H and I. The caller passes the startable set from scripts/train-plan.mjs, so it is safe to run repeatedly — slices already built drop out of the list on their own.',
  phases: [
    { title: 'Build', detail: 'one worktree-isolated agent per startable slice' },
    { title: 'Verify', detail: 'a second agent re-reads the diff against the slice probe' },
  ],
};

/* Which slices to build comes from `args`, because this script cannot run the
 * CLI itself — workflow scripts have no filesystem. The calling session runs
 *   node scripts/train-plan.mjs next --json
 * and passes the rows in. That keeps the startable set derived from the tree in
 * exactly one place rather than re-implemented here.
 *
 * Two agents per slice, pipelined rather than barriered: a slice verifies the
 * moment its build finishes instead of waiting for the slowest sibling. */

const slices = Array.isArray(args) ? args : args?.next ?? [];
if (slices.length === 0) {
  log('No startable slice. Either both trains are built, or everything left waits on '
    + 'another slice or an owner decision.');
  return { built: [], note: 'nothing startable' };
}

log(`${slices.length} startable slice(s): ${slices.map((s) => s.id).join(', ')}`);

const BASE = args?.base ?? 'claude/train-h-i-quiz-nxieu1';

/* The three shapes a test takes when it asserts nothing. Stated once here and
 * interpolated into both prompts below, because a builder and a verifier need
 * the same list for opposite reasons and a rubric that drifts between them is
 * worse than no rubric. It cannot be imported from scripts/lib: workflow
 * scripts have no filesystem and no module resolution, so train-verify.mjs
 * carries its own copy — keep the two in step by hand. */
const VACUOUS = 'a mutation applied to a frozen object, a diff over an empty commit range, '
  + 'a comparison against a value the test itself computed, or a condition that holds '
  + 'however the source behaves';

const rulesFor = (slice) => `
Repo rules that are not optional here:
- You are ALREADY in your own isolated git worktree. Do not create another one.
- Your worktree may have been cut from main. The work these slices build on is
  on branch ${BASE}, which is ahead of main and NOT yet merged. Before you read
  anything or plan anything, run:
      git fetch origin ${BASE} && git checkout -B slice-${slice.id} FETCH_HEAD
  The branch name MUST carry your slice id. Worktrees in one repository share
  branch refs, so two lanes on a branch of the same name share one pointer:
  each commits on top of whatever the other last did, and each records the
  other's files as deletions. That happened on this train — three lanes were
  told to use one name and their commits had to be unpicked by hand.
  Then CONFIRM YOUR BASE CARRIES YOUR DEPENDENCIES, before you plan anything:

      node scripts/train-plan.mjs status

  Every slice listed under NEEDS for your slice must appear under BUILT. If one
  does not, your base is stale — the branch is only as current as the last push,
  and work can be integrated locally but not yet pushed. Fetch again; if it is
  still missing, STOP and report it rather than building. A lane that builds
  without its dependency does not fail, it reinvents: h11 was once started on a
  base without h7's mapView seam and set about rebuilding the very seam it was
  supposed to consume.
  If the fetch itself failed — no scripts/lib/train-plan.mjs at all — stop and
  report that too. A checkout still on main looks like a startable slice with
  nothing built yet, and rebuilding the whole train from there is a day lost.
- TDD, red before green. Every assertion you write must be SHOWN to fail on its
  own message before the code makes it pass — revert the fix, watch the failure,
  restore it. An assertion you never saw fail has proven nothing. The shapes to
  avoid: ${VACUOUS}. Several tests in this repo's recent history landed that way
  and each was caught only by trying to make it fail.
- Do NOT edit package.json, scripts/ci/manifest.mjs, or any shared registry or
  manifest. If your work needs wiring there, finish the module and report
  "NEEDS WIRING: <what>" in your summary. The integrator lands it. This is not a
  suggestion — parallel lanes editing shared files is how the tree gets corrupted.
- Do NOT edit version files; they are bumped on merge.
- Do NOT answer a question that scripts/train-plan.mjs lists as blocked on an
  owner decision. If your slice turns out to depend on one, stop and report it.
- Follow the repo's own standards docs: docs/agents/matt-standards.md and the
  CLAUDE.md policies it points at.
`;

const BUILD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sliceId', 'status', 'summary', 'filesChanged', 'testsAdded', 'redVerified'],
  properties: {
    sliceId: { type: 'string' },
    status: { enum: ['built', 'partial', 'blocked'] },
    summary: { type: 'string', description: 'what now exists that did not before' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    testsAdded: { type: 'array', items: { type: 'string' } },
    redVerified: {
      type: 'boolean',
      description: 'true only if every new assertion was watched to fail before it passed',
    },
    needsWiring: { type: 'array', items: { type: 'string' } },
    blockedOn: { type: 'string' },
    worktree: { type: 'string', description: 'absolute path to the worktree you built in' },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sliceId', 'probeWouldPass', 'testsAreReal', 'findings'],
  properties: {
    sliceId: { type: 'string' },
    probeWouldPass: { type: 'boolean' },
    testsAreReal: {
      type: 'boolean',
      description: 'false if any new test cannot fail — the vacuous-test check',
    },
    findings: { type: 'array', items: { type: 'string' } },
  },
};

const results = await pipeline(
  slices,
  (slice) =>
    agent(
      `Build slice ${slice.id} of train ${slice.train} in the six-flags-sa repo.

SLICE: ${slice.title}
SIZE:  ${slice.size}
NEEDS: ${(slice.needs ?? []).join(', ') || '(nothing)'}

Read these first, in this order, and let them tell you what the slice means:
  1. docs/adr/ — ADR-0019 and ADR-0021 for train H, ADR-0020 for train I.
  2. CONTEXT.md — the Map factory / Visual factory split. Imagery is EVIDENCE in
     the Map factory and GROUNDING in the Visual factory; the Visual factory
     restyles, never repositions, and never writes truth. Do not blur them.
  3. scripts/lib/train-plan.mjs — find slice ${slice.id} and read its \`probe\`.
     That predicate is the acceptance criterion. Your work is done when it goes
     true HONESTLY: satisfy what it is checking for, never the literal string.
     Writing the probe's needle into a comment to make it pass is fraud, and the
     verifier that reads your diff next is looking for exactly that.
${rulesFor(slice)}
Report against the schema. Set redVerified true only if you actually watched
each new assertion fail first. A false there is fine and useful; a wrong true
poisons everything downstream.`,
      { label: `build:${slice.id}`, phase: 'Build', schema: BUILD_SCHEMA, isolation: 'worktree' },
    ),
  (build, slice) => {
    if (!build || build.status === 'blocked') return { build, verdict: null, slice };
    return agent(
      `Adversarially review the work claimed for slice ${slice.id} ("${slice.title}").

The builder reported: ${JSON.stringify(build, null, 2)}

Its worktree is at ${build.worktree ?? '(unreported — find it under .claude/worktrees/)'}.
Read the actual diff there, against the branch the slice was built on:
\`git fetch origin ${BASE} && git diff FETCH_HEAD...HEAD\`. Diffing against main
would show you the whole train's work and drown the slice. Do not take the
summary's word for anything.

Answer three questions, and default to the sceptical answer when unsure:
1. Would slice ${slice.id}'s probe in scripts/lib/train-plan.mjs pass against
   this tree for the RIGHT reason — the capability exists — rather than because
   a string was placed where the probe looks?
2. Can every new test actually fail? Pick each new assertion, work out what
   change to the source would break it, and say so. Vacuous means ${VACUOUS}.
   This is the single most common defect in this repo's recent history; find it.
3. What is wrong, missing, or out of scope? Include files touched outside the
   slice, and any shared manifest edited when it should have been reported as
   NEEDS WIRING.`,
      { label: `verify:${slice.id}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' },
    ).then((verdict) => ({ build, verdict, slice }));
  },
);

const rows = results.filter(Boolean);
const clean = rows.filter((r) => r.build?.status === 'built' && r.verdict?.probeWouldPass && r.verdict?.testsAreReal);
const suspect = rows.filter((r) => !clean.includes(r));

log(`${clean.length} slice(s) built and verified; ${suspect.length} need the integrator's attention`);

return {
  built: clean.map((r) => ({ id: r.slice.id, worktree: r.build.worktree, summary: r.build.summary })),
  suspect: suspect.map((r) => ({
    id: r.slice.id,
    status: r.build?.status ?? 'no result',
    findings: r.verdict?.findings ?? [],
    testsAreReal: r.verdict?.testsAreReal ?? null,
    redVerified: r.build?.redVerified ?? null,
    blockedOn: r.build?.blockedOn ?? null,
  })),
  needsWiring: rows.flatMap((r) => (r.build?.needsWiring ?? []).map((w) => `${r.slice.id}: ${w}`)),
};
