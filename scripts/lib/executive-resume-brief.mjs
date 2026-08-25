/**
 * Executive human brief — one fixed template filled from canonical facts.
 * Spec: docs/superpowers/specs/2026-08-25-executive-resume-human-brief-design.md
 */

/** @param {import('./executive-resume-brief.mjs').BriefFacts | object} facts */
export function fillHumanBrief(facts) {
  const lines = ['# Executive brief', ''];

  lines.push('## Overview', facts.overview?.trim() || '_Set NOW and human notes — overview is composed from facts._', '');

  lines.push('## NOW');
  const task = facts.now?.task?.trim() || '_(unset — set before coding)_';
  lines.push(task);
  if (facts.now?.nextStep?.trim()) lines.push(`Next: ${facts.now.nextStep.trim()}`);
  if (facts.now?.doneWhen?.length) {
    for (const d of facts.now.doneWhen) lines.push(`- Done when: ${d}`);
  }
  lines.push('');

  lines.push('## Factories', facts.factoriesStanding?.trim() || 'Nothing in flight under this label set.', '');
  lines.push('## App', facts.appStanding?.trim() || 'Nothing in flight under this label set.', '');

  lines.push('## Wayfinder');
  if (!facts.wayfinder?.length) {
    lines.push('No active wayfinder map.');
  } else {
    const anyTickets = facts.wayfinder.some((w) => w.tickets?.length);
    if (!anyTickets) {
      lines.push('Maps clear — no open decision tickets.');
    }
    for (const w of facts.wayfinder) {
      lines.push(`**${w.slug}** — phase \`${w.phase}\``);
      if (w.destination?.trim()) lines.push(`Destination: ${w.destination.trim()}`);
      for (const t of w.tickets || []) {
        lines.push(`- ${t.title}${t.id ? ` (${t.id})` : ''} · ${t.status}`);
      }
    }
  }
  lines.push('');

  lines.push('## Hanging / waiting on you');
  if (!facts.hanging?.length) {
    lines.push('- _(none)_');
  } else {
    for (const h of facts.hanging) {
      if (h.kind === 'github') {
        const num = h.number != null ? ` (#${h.number})` : '';
        const lab = h.label ? ` · \`${h.label}\`` : '';
        lines.push(`- ${h.title}${num}${lab}`);
      } else {
        lines.push(`- ${h.title}`);
      }
    }
  }
  lines.push('');

  if (facts.clerkHealth?.detail) {
    lines.push(`_Version: ${facts.clerkHealth.detail}_`, '');
  }
  if (facts.warnings?.length) {
    lines.push('⚠️ Brief warnings:');
    for (const w of facts.warnings) lines.push(`- ${w}`);
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
