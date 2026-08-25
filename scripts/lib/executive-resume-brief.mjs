/**
 * Executive human brief — one fixed template filled from canonical facts.
 * Spec: docs/superpowers/specs/2026-08-25-executive-resume-human-brief-design.md
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { effortPhase, listEfforts, loadTickets } from './matt-workflow.mjs';
import { listCommittedWayfinderSlugs } from './wayfinder-committed.mjs';

/**
 * @typedef {{
 *   overview?: string;
 *   now?: { task?: string; nextStep?: string; doneWhen?: string[] };
 *   factoriesStanding?: string;
 *   appStanding?: string;
 *   wayfinder?: Array<{
 *     slug: string;
 *     phase: string;
 *     destination?: string;
 *     tickets: Array<{ id: string; title: string; status: string }>;
 *   }>;
 *   hanging?: Array<
 *     | { kind: 'github'; title: string; number?: number; label?: string }
 *     | { kind: 'blocked'; title: string }
 *   >;
 *   clerkHealth?: { ok?: boolean; declared?: string; locked?: string; detail?: string };
 *   warnings?: string[];
 * }} BriefFacts
 */

function readDestination(mapPath) {
  if (!existsSync(mapPath)) return undefined;
  const body = readFileSync(mapPath, 'utf8');
  const part = body.split(/^##?\s+Destination\s*$/im)[1];
  if (!part) return undefined;
  const until = part.split(/^##\s+/m)[0] || part;
  const line = until
    .split('\n')
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .find((l) => l && !l.startsWith('#'));
  return line;
}

/** @param {string} root */
export function gatherWayfinderFacts(root) {
  const slugs = [...new Set([...listCommittedWayfinderSlugs(), ...listEfforts(root)])].sort();
  const out = [];
  for (const slug of slugs) {
    const dir = join(root, '.scratch', slug);
    const mapPath = join(dir, 'map.md');
    if (!existsSync(mapPath)) continue;
    const state = effortPhase(slug, root);
    const tickets = loadTickets(dir)
      .filter((t) => t.isWayfinder && ['open', 'claimed'].includes(t.status))
      .map((t) => ({ id: t.id, title: t.title, status: t.status }));
    out.push({
      slug,
      phase: state.phase,
      destination: readDestination(mapPath),
      tickets,
    });
  }
  return out;
}

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
