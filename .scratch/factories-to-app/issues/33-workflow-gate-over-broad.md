# 33: One parked effort froze every builder change in the repo

**What to build:** Narrow `workflowBlockReason` to judge the effort the diff belongs to.

**Blocked by:** None

**Status:** resolved

## Evidence

`scripts/lib/matt-workflow.mjs :: workflowBlockReason` gated any diff touching
`packages/venue-builder/`, then looped **every** effort and blocked if **any one** of them was in
a phase forbidding `implement`:

```js
for (const slug of efforts) {
  const result = checkIntent({ cwd, effort: slug, intent: 'implement' });
  if (!result.ok) return `${result.message}\nRun: npm run workflow:next`;
}
```

`g1-village-green` sits at phase `spec`. That one fact blocked **all** builder work — including
this branch, whose effort `factories-to-app` is at phase `implement` and is the effort the work
actually serves. The block message named an effort the diff did not touch and demanded `/to-spec`
on it.

## Why it was wrong

The gate exists to catch builder code written ahead of *its own* effort's thinking. That is a
claim about the effort the work belongs to — not about the least advanced effort on disk. As
written it asked "does any effort forbid implement?", so parking a second effort at `spec` froze
the repo's builder surface until someone wrote a spec for unrelated work.

Left alone it also teaches the wrong lesson: the only ways past it are to manufacture a spec to
clear a push, or to skip the hook. Both are worse than the gate not firing.

## The fix

- A diff that edits an effort's own `.scratch/<slug>/` files **names** that effort; judge it, and
  only it. This branch names `factories-to-app`, which allows implement.
- When the diff names none, weigh them all — but block only when **no** candidate effort is ready,
  rather than when any single one is not.

## Acceptance

- [x] Builder diff is not blocked by an unrelated effort parked at an early phase
- [x] Builder diff **is** still blocked when no effort is ready to implement — the guarantee the
      gate exists for, asserted on a fixture tree holding only a foggy effort
- [x] A diff advancing a foggy effort's own files is judged on that effort, not excused by a ready
      one elsewhere
- [x] Non-builder diffs remain out of scope
- [x] Tests fail on their own messages before the fix (verified)

## Notes

Covered in `test/scripts/matt-workflow.test.mjs`, registered under `ci-gate` in
`scripts/ci/test-estate.mjs`. The narrowing must never become "return null" — the fixture tree
with only a foggy effort is what stops that.
