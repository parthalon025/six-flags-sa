/**
 * Agent-handoff watch — decision + gh scoping for
 * .github/workflows/agent-handoff-watch.yml.
 *
 * Interface:
 *   shouldTriage(event)
 *   assertScopedGhArgs(args, allowedIssueNumber)
 */

const AGENT_HANDOFF_LABEL = 'agent-handoff';

/** Does this `issues` webhook event warrant running the triage skill? */
export function shouldTriage(event) {
  if (!event || typeof event !== 'object') return false;
  if (event.action === 'opened') {
    const labels = event.issue?.labels ?? [];
    return labels.some((label) => label?.name === AGENT_HANDOFF_LABEL);
  }
  if (event.action === 'labeled') {
    return event.label?.name === AGENT_HANDOFF_LABEL;
  }
  return false;
}

const ISSUE_SCOPED_SUBCOMMANDS = new Set(['view', 'comment', 'edit']);
const UNSCOPED_READ_SUBCOMMANDS = new Set(['list']);

/**
 * Throws unless `args` (a `gh` argv, e.g. `['issue', 'comment', '42', ...]`)
 * is a read, or a comment/label write, scoped to exactly `allowedIssueNumber`.
 * `gh issue list` and `gh search issues` are read-only across the whole repo
 * (needed for the triage skill's duplicate check) and are always allowed.
 * Everything else — close, delete, reopen, `gh pr`, `gh repo`, `gh api`, or
 * any issue/comment/edit naming a different issue — is refused.
 */
export function assertScopedGhArgs(args, allowedIssueNumber) {
  if (!Array.isArray(args) || args.length < 2) {
    throw new Error('agent-handoff-gh: expected a gh subcommand, e.g. "issue view 42"');
  }
  const [group, subcommand, ...rest] = args;

  if (group === 'search' && subcommand === 'issues') return;

  if (group !== 'issue') {
    throw new Error(`agent-handoff-gh: "gh ${group}" is not allowed in this workflow`);
  }
  if (UNSCOPED_READ_SUBCOMMANDS.has(subcommand)) return;
  if (!ISSUE_SCOPED_SUBCOMMANDS.has(subcommand)) {
    throw new Error(`agent-handoff-gh: "gh issue ${subcommand}" is not allowed in this workflow`);
  }

  const target = rest[0];
  if (String(target) !== String(allowedIssueNumber)) {
    throw new Error(
      `agent-handoff-gh: refusing "gh issue ${subcommand} ${target}" — this run may only touch issue #${allowedIssueNumber}`,
    );
  }
}
