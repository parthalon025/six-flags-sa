export const meta = {
  name: 'train-verify',
  description: 'Adversarially verify slice work sitting in worktrees before it is integrated',
  whenToUse: 'After a fan-out produced slice work that was never verified — e.g. the session driving it died. The caller passes {slices:[{id,title,root}]}.',
  phases: [
    { title: 'Verify', detail: 'one sceptic per slice, reading the real diff' },
  ],
};

/* The build agents are gone; their worktrees are not. Each slice's probe now
 * reports built, but a probe answers "is the evidence there", not "is the
 * evidence honest" — and nothing has read these diffs. This is that read. */

const slices = args?.slices ?? [];
if (slices.length === 0) return { verdicts: [], note: 'nothing to verify' };

log(`verifying ${slices.length} slice(s): ${slices.map((s) => s.id).join(', ')}`);

const VERDICT = {
  type: 'object',
  additionalProperties: false,
  required: ['sliceId', 'probeHonest', 'testsCanFail', 'scopeClean', 'severity', 'findings', 'recommendation'],
  properties: {
    sliceId: { type: 'string' },
    probeHonest: {
      type: 'boolean',
      description: 'the capability really exists, vs a string placed where the probe greps',
    },
    testsCanFail: { type: 'boolean', description: 'every new assertion has a source change that breaks it' },
    scopeClean: { type: 'boolean', description: 'no shared manifest or out-of-slice file edited' },
    severity: { enum: ['clean', 'minor', 'major', 'blocker'] },
    findings: { type: 'array', items: { type: 'string' } },
    sharedFilesTouched: { type: 'array', items: { type: 'string' } },
    recommendation: { enum: ['integrate', 'integrate-with-fixes', 'rework', 'discard'] },
  },
};

const verdicts = await parallel(
  slices.map((s) => () =>
    agent(
      `Adversarially review uncommitted-or-committed slice work in a git worktree.

SLICE:    ${s.id} — ${s.title}
WORKTREE: ${s.root}

Read the ACTUAL diff. The work may be committed, staged, or unstaged, so look at
all three:
    cd ${s.root}
    git status --porcelain
    git diff HEAD          # unstaged + staged vs the worktree's HEAD
    git log --oneline -3

The branch this work belongs to is claude/train-h-i-quiz-nxieu1. To see the
slice's own contribution rather than the whole train's:
    git fetch origin claude/train-h-i-quiz-nxieu1
    git diff FETCH_HEAD                       # working tree vs the train branch

Answer these, defaulting to the sceptical answer when unsure:

1. probeHonest — Find slice ${s.id} in scripts/lib/train-plan.mjs (read it from
   /home/user/six-flags-sa/.claude/worktrees/train-h-bands/scripts/lib/train-plan.mjs
   if it is missing in the worktree) and read its \`probe\`. The probe now reports
   this slice built. Is that because the capability genuinely exists, or because
   a string landed where the probe greps? A comment, a variable name, or a
   string literal containing the needle is FRAUD, not completion. Say which.

2. testsCanFail — For every new or changed assertion, name the specific source
   change that would break it. An assertion over a frozen object, an empty
   commit range, a value the test itself computed, or a condition that holds
   vacuously is worthless. This repo has landed several; it is the primary
   defect class here, not a footnote. If a test cannot fail, say so and name it.

3. scopeClean — Lanes were forbidden from editing package.json,
   scripts/ci/manifest.mjs, and any shared registry or manifest; that wiring is
   the integrator's. List every shared file this diff touches. Note that the
   worktree also carries the train branch's own commits — do NOT report those as
   this slice's scope violations. Only what this slice added counts.

4. Correctness. Does the code do what the slice title says? Check it against the
   ADRs (docs/adr/, ADR-0019/0021 for train H, ADR-0020 for train I) and
   CONTEXT.md's Map-factory / Visual-factory split: imagery is EVIDENCE in the
   Map factory and GROUNDING in the Visual factory; the Visual factory restyles,
   never repositions, and never writes truth.

Run the repo's own checks if they are cheap and relevant (node on a single test
file). Do NOT modify anything — review only. Do NOT run the full gate.`,
      { label: `verify:${s.id}`, phase: 'Verify', schema: VERDICT, effort: 'high' },
    ),
  ),
);

const ok = verdicts.filter(Boolean);
return {
  clean: ok.filter((v) => v.recommendation === 'integrate').map((v) => v.sliceId),
  needsWork: ok.filter((v) => v.recommendation !== 'integrate'),
  all: ok,
};
