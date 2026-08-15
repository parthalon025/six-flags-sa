/**
 * Compose always-loaded agent docs from policy templates.
 *
 * Single source of truth: docs/agents/policies/*.md
 * Generated outputs: AGENTS.md, CLAUDE.md, .cursor/rules/*.mdc
 *
 * Follows writing-for-agents: slim context pointers in always-loaded docs;
 * full policy disclosed behind pointers.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const libDir = dirname(fileURLToPath(import.meta.url));
const root = join(libDir, '../../..');

const GITNEXUS_START = '<!-- gitnexus:start -->';
const GITNEXUS_END = '<!-- gitnexus:end -->';
const GENERATED_MARKER = '<!-- agent-docs:generated -->';

export function loadManifest(manifestPath = join(libDir, 'manifest.json')) {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

function policyHref(policyId, fromRoot = true) {
  const rel = `docs/agents/policies/${policyId}.md`;
  return fromRoot ? `./${rel}` : `../../${rel}`;
}

export function extractGitnexusBlock(content) {
  const start = content.indexOf(GITNEXUS_START);
  const end = content.indexOf(GITNEXUS_END);
  if (start === -1 || end === -1) return null;
  return content.slice(start, end + GITNEXUS_END.length).trimEnd();
}

function renderPolicyPointer(policy, { fromRoot = true } = {}) {
  const href = policyHref(policy.id, fromRoot);
  return `${policy.pointer} See [${policy.id} policy](${href}).`;
}

function renderCursorRule(policy) {
  const href = policyHref(policy.id, false);
  return [
    '---',
    `description: ${policy.cursorDescription}`,
    'alwaysApply: true',
    '---',
    '',
    `# ${policy.title}`,
    '',
    `${policy.pointer} See [${policy.id} policy](${href}).`,
    '',
  ].join('\n');
}

function renderStaticCursorRule(rule) {
  return [
    '---',
    `description: ${rule.description}`,
    'alwaysApply: true',
    '---',
    '',
    `# ${rule.title}`,
    '',
    rule.body,
    '',
  ].join('\n');
}

function renderAgentRoot(manifest, { variant, gitnexusBlock }) {
  const lines = [GENERATED_MARKER, ''];
  if (gitnexusBlock) {
    lines.push(gitnexusBlock, '');
  }
  for (const policy of manifest.policies) {
    lines.push(`## ${policy.heading}`, '', renderPolicyPointer(policy), '');
  }
  const skills = manifest.agentSkillsBlock;
  lines.push(`## ${skills.heading}`, '');
  for (const section of skills.sections) {
    lines.push(`### ${section.subheading}`, '', section.pointer, '');
  }
  if (variant === 'claude') {
    // CLAUDE.md gets no extra variant text — version conflict detail lives in the policy doc.
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * @returns {Map<string, string>} repo-relative path → file content
 */
export function composeAgentDocs({
  manifest = loadManifest(),
  rootDir = root,
  gitnexusBlocks = {},
} = {}) {
  const outputs = new Map();

  for (const [relPath, meta] of Object.entries(manifest.agentRoots)) {
    const existing = existsSync(join(rootDir, relPath))
      ? readFileSync(join(rootDir, relPath), 'utf8')
      : '';
    const gitnexusBlock =
      gitnexusBlocks[relPath] ?? extractGitnexusBlock(existing) ?? null;
    outputs.set(
      relPath,
      renderAgentRoot(manifest, { variant: meta.variant, gitnexusBlock }),
    );
  }

  for (const policy of manifest.policies) {
    outputs.set(join(manifest.cursorRulesDir, policy.cursorRule), renderCursorRule(policy));
  }

  for (const rule of manifest.staticCursorRules) {
    outputs.set(join(manifest.cursorRulesDir, rule.file), renderStaticCursorRule(rule));
  }

  return outputs;
}

export function writeAgentDocs(opts = {}) {
  const outputs = composeAgentDocs(opts);
  const rootDir = opts.rootDir ?? root;
  for (const [relPath, content] of outputs) {
    writeFileSync(join(rootDir, relPath), content, 'utf8');
  }
  return [...outputs.keys()];
}

export function checkAgentDocs(opts = {}) {
  const outputs = composeAgentDocs(opts);
  const rootDir = opts.rootDir ?? root;
  const drift = [];
  for (const [relPath, expected] of outputs) {
    const abs = join(rootDir, relPath);
    if (!existsSync(abs)) {
      drift.push({ path: relPath, reason: 'missing' });
      continue;
    }
    const actual = readFileSync(abs, 'utf8');
    if (actual !== expected) {
      drift.push({ path: relPath, reason: 'content drift' });
    }
  }
  return drift;
}

export function countTokensApprox(text) {
  return Math.ceil(text.length / 4);
}

export function measureSavings({ before, after }) {
  const beforeChars = Object.values(before).reduce((n, s) => n + s.length, 0);
  const afterChars = Object.values(after).reduce((n, s) => n + s.length, 0);
  return {
    beforeChars,
    afterChars,
    savedChars: beforeChars - afterChars,
    savedPct: beforeChars ? Math.round(((beforeChars - afterChars) / beforeChars) * 100) : 0,
  };
}
