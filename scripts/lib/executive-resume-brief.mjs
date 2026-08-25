/**
 * Executive human brief — one fixed template filled from canonical facts.
 * Spec: docs/superpowers/specs/2026-08-25-executive-resume-human-brief-design.md
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { effortPhase, listEfforts, loadTickets } from './matt-workflow.mjs';
import { listCommittedWayfinderSlugs } from './wayfinder-committed.mjs';

export const FACTORY_HINTS = [
  'venue-builder',
  'venues/',
  'venues:',
  'train:',
  'train H',
  'train I',
  'display bake',
  'factory',
];
export const APP_HINTS = ['party-tracker', 'apps/party-tracker', 'clerk', 'profile', 'capacitor'];

const NOTHING_STANDING = 'Nothing in flight under this label set.';
const GH_LABELS = ['ready-for-agent', 'ready-for-human'];

function runGh(args, { cwd, runner = execFileSync }) {
  return runner('gh', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function blobMatchesHints(blob, hints) {
  if (!blob) return false;
  const lower = String(blob).toLowerCase();
  return hints.some((hint) => lower.includes(hint.toLowerCase()));
}

/** @param {{ blobs: string[], factoryHints: string[], appHints: string[] }} input */
export function classifyStanding({ blobs, factoryHints, appHints }) {
  return {
    factory: blobs.some((blob) => blobMatchesHints(blob, factoryHints)),
    app: blobs.some((blob) => blobMatchesHints(blob, appHints)),
  };
}

function collectStandingBlobs(resume) {
  const { now = {}, human = {}, inventory = {} } = resume;
  const blobs = [];
  if (now.task) blobs.push(now.task);
  if (now.nextStep) blobs.push(now.nextStep);
  if (now.branch) blobs.push(now.branch);
  if (now.worktree) blobs.push(now.worktree);
  if (human.notes) blobs.push(human.notes);
  if (Array.isArray(human.parkingLot)) blobs.push(...human.parkingLot);
  for (const wt of inventory.worktrees || []) {
    if (wt.slug) blobs.push(wt.slug);
    if (wt.branch) blobs.push(wt.branch);
    if (wt.path) blobs.push(wt.path);
  }
  for (const pr of inventory.draftPrs || []) {
    if (pr.title) blobs.push(pr.title);
  }
  return blobs.filter(Boolean);
}

function pickStandingLine(blobs, hints, nowTask) {
  if (blobMatchesHints(nowTask, hints)) return String(nowTask).trim();
  for (const blob of blobs) {
    if (blobMatchesHints(blob, hints)) return String(blob).trim();
  }
  return nowTask?.trim() || 'work in progress';
}

function buildStanding(blobs, hints, nowTask) {
  const matched = blobs.some((blob) => blobMatchesHints(blob, hints));
  if (!matched) return NOTHING_STANDING;
  return `In flight: ${pickStandingLine(blobs, hints, nowTask)}.`;
}

function composeOverview({ human, now, factoriesStanding, appStanding }) {
  if (human?.overview?.trim()) return human.overview.trim();
  const parts = [`Parkbound executive focus: ${now?.task?.trim() || '(unset)'}.`];
  const used = new Set(parts);
  for (const standing of [factoriesStanding, appStanding]) {
    const line = standing?.trim();
    if (!line || line === NOTHING_STANDING || used.has(line)) continue;
    parts.push(line);
    used.add(line);
  }
  return parts.join(' ');
}

function triageLabel(labels) {
  const names = (labels || []).map((l) => (typeof l === 'string' ? l : l.name));
  const matched = GH_LABELS.filter((name) => names.includes(name));
  if (!matched.length) return null;
  return matched.includes('ready-for-human') ? 'ready-for-human' : 'ready-for-agent';
}

/** @param {{ cwd: string, runner?: typeof execFileSync }} input */
export function gatherGithubHanging({ cwd, runner = execFileSync }) {
  const byNumber = new Map();
  for (const label of GH_LABELS) {
    const out = runGh(
      ['issue', 'list', '--label', label, '--state', 'open', '--json', 'number,title,labels'],
      { cwd, runner },
    );
    const issues = JSON.parse(out || '[]');
    for (const issue of issues) {
      const issueLabel = triageLabel(issue.labels);
      if (!issueLabel) continue;
      const existing = byNumber.get(issue.number);
      if (!existing) {
        byNumber.set(issue.number, {
          kind: 'github',
          title: issue.title,
          number: issue.number,
          label: issueLabel,
        });
      } else if (issueLabel === 'ready-for-human') {
        existing.label = 'ready-for-human';
      }
    }
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

function normalizeDeclaredVersion(version) {
  return String(version).replace(/^[\^~>=<]+/, '');
}

/** @param {string} root */
export function gatherClerkHealth(root) {
  try {
    const pkgPath = join(root, 'apps/party-tracker/package.json');
    const lockPath = join(root, 'package-lock.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    const declared =
      pkg.dependencies?.['@clerk/nextjs'] ?? pkg.devDependencies?.['@clerk/nextjs'] ?? null;
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    const locked =
      lock.packages?.['node_modules/@clerk/nextjs']?.version ??
      lock.dependencies?.['@clerk/nextjs']?.version ??
      null;
    if (!declared || !locked) return null;
    const ok = normalizeDeclaredVersion(declared) === locked;
    const detail = ok
      ? 'Clerk @clerk/nextjs matches lockfile.'
      : `Clerk @clerk/nextjs declared ${declared} but lockfile has ${locked}.`;
    return { ok, declared, locked, detail };
  } catch {
    return null;
  }
}

/** @param {{ resume: object, root: string, runner?: typeof execFileSync }} input */
export function gatherBriefFacts({ resume, root, runner = execFileSync }) {
  const warnings = [];
  for (const slug of listCommittedWayfinderSlugs()) {
    const mapPath = join(root, '.scratch', slug, 'map.md');
    if (!existsSync(mapPath)) {
      warnings.push(`Allowlisted wayfinder effort "${slug}" missing map.md`);
    }
  }

  const blobs = collectStandingBlobs(resume);
  const factoriesStanding = buildStanding(blobs, FACTORY_HINTS, resume.now?.task);
  const appStanding = buildStanding(blobs, APP_HINTS, resume.now?.task);
  const overview = composeOverview({
    human: resume.human,
    now: resume.now,
    factoriesStanding,
    appStanding,
  });

  let githubHanging = [];
  try {
    githubHanging = gatherGithubHanging({ cwd: root, runner });
  } catch {
    warnings.push('GitHub hanging inventory incomplete');
  }

  const hanging = [...githubHanging];
  for (const title of resume.human?.blockedOnMe || []) {
    hanging.push({ kind: 'blocked', title });
  }
  for (const title of resume.human?.parkingLot || []) {
    hanging.push({ kind: 'parking', title });
  }

  const clerkHealth = gatherClerkHealth(root);
  const wayfinder = gatherWayfinderFacts(root);

  return {
    overview,
    now: resume.now,
    factoriesStanding,
    appStanding,
    wayfinder,
    hanging,
    clerkHealth: clerkHealth ?? undefined,
    warnings: warnings.length ? warnings : undefined,
  };
}

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
