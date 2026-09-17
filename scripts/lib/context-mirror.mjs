/**
 * CONTEXT.md mirror audit — flag user-facing app copy that uses avoided vocabulary.
 *
 * Interface:
 *   contextMirrorScanRoots()
 *   parseContextAvoidRules(markdown)
 *   findAvoidMatchesInText(text, rules)
 *   auditContextMirror({ contextMarkdown, sources, roots, cwd })
 *   renderContextMirrorReport(audit)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAppPaths, isAppPath } from './app-paths.mjs';
import { normalizeRepoPath } from './repo-path.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mdx']);
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

/** Repo-relative roots scanned for user-facing copy. */
export function contextMirrorScanRoots() {
  return loadAppPaths().filter((p) => p.startsWith('apps/') || p.startsWith('packages/shared/'));
}

function normalizePath(file, cwd = root) {
  const rel = normalizeRepoPath(relative(cwd, file));
  return rel.startsWith('..') ? normalizeRepoPath(String(file)) : rel;
}

/** Parse glossary entries: canonical term plus forbidden surface forms from _Avoid_ lines. */
export function parseContextAvoidRules(markdown) {
  const rules = [];
  const blocks = String(markdown).split(/\n(?=\*\*[^*]+\*\*:)/);
  for (const block of blocks) {
    const termMatch = block.match(/\*\*([^*]+)\*\*:/);
    const avoidMatch = block.match(/^_Avoid_:\s*(.+)$/m);
    if (!termMatch || !avoidMatch) continue;
    const canonical = termMatch[1].trim();
    const forbidden = [];
    for (const segment of avoidMatch[1].split(';')) {
      for (const part of segment.split(',')) {
        const token = extractForbiddenToken(part);
        if (token) forbidden.push(token);
      }
    }
    if (forbidden.length) rules.push({ canonical, forbidden });
  }
  return rules;
}

function extractForbiddenToken(segment) {
  let s = segment.trim();
  if (!s) return null;
  s = s.replace(/\([^)]*\)/g, '').trim();
  s = s.split(/[—–]/)[0].trim();
  const quoted = s.match(/`([^`]+)`/);
  if (quoted) return quoted[1];
  const leading = s.match(/^([A-Za-z][A-Za-z0-9 /-]*?)(?:\s+in\b|\s+is\b|\s+as\b|\s+\(|\s+for\b|$)/);
  if (leading) {
    const token = leading[1].trim();
    if (token.length >= 2) return token;
  }
  return s.length >= 2 ? s : null;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find avoid-term hits in one string (typically a string literal). */
export function findAvoidMatchesInText(text, rules) {
  const findings = [];
  for (const rule of rules) {
    for (const forbidden of rule.forbidden) {
      const re = new RegExp(`\\b${escapeRegExp(forbidden)}\\b`, 'i');
      const match = re.exec(text);
      if (match) {
        findings.push({
          canonical: rule.canonical,
          forbidden,
          matched: match[0],
          excerpt: text.slice(0, 120),
        });
      }
    }
  }
  return findings;
}

const STRING_LITERAL_RE = /(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g;

function isUserFacingLiteral(value) {
  if (!value || value.length < 3) return false;
  if (value.includes('${')) return false;
  if (/^[\w./:@?&=-]+$/.test(value) && !/\s/.test(value)) return false;
  if (/^\/[\w/?&=.-]*$/.test(value)) return false;
  return true;
}

function extractStringLiterals(source) {
  const literals = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const match of line.matchAll(STRING_LITERAL_RE)) {
      const value = match[2];
      if (!isUserFacingLiteral(value)) continue;
      literals.push({ line: i + 1, column: match.index + 1, value });
    }
  }
  return literals;
}

function walkSourceFiles(dir, cwd, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (SKIP_DIRS.has(name)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      walkSourceFiles(abs, cwd, out);
      continue;
    }
    const rel = normalizePath(abs, cwd);
    if (!SOURCE_EXTENSIONS.has(name.slice(name.lastIndexOf('.')))) continue;
    if (rel.includes('/test/') || rel.includes('/__tests__/') || rel.includes('/app/api/')) {
      continue;
    }
    out.push({ path: rel, abs });
  }
  return out;
}

function listAppSources({ roots, cwd = root }) {
  const files = [];
  for (const scanRoot of roots) {
    const absRoot = join(cwd, scanRoot);
    try {
      walkSourceFiles(absRoot, cwd, files);
    } catch {
      // missing optional roots are ignored
    }
  }
  return files;
}

/**
 * Audit app copy against CONTEXT.md avoid vocabulary.
 * Returns { rules, findings, scannedFiles }.
 */
export function auditContextMirror({
  contextMarkdown,
  sources = null,
  roots = contextMirrorScanRoots(),
  cwd = root,
}) {
  const rules = parseContextAvoidRules(contextMarkdown);
  const findings = [];
  const fileSources =
    sources ??
    listAppSources({ roots, cwd }).map(({ path, abs }) => ({
      path,
      content: readFileSync(abs, 'utf8'),
    }));

  for (const { path, content } of fileSources) {
    if (!isAppPath(path, loadAppPaths())) continue;
    for (const literal of extractStringLiterals(content)) {
      for (const hit of findAvoidMatchesInText(literal.value, rules)) {
        findings.push({
          path,
          line: literal.line,
          column: literal.column,
          ...hit,
        });
      }
    }
  }

  findings.sort((a, b) =>
    a.path.localeCompare(b.path) ||
    a.line - b.line ||
    a.column - b.column ||
    a.forbidden.localeCompare(b.forbidden),
  );

  return {
    rules,
    findings,
    scannedFiles: fileSources.map((s) => s.path).sort(),
  };
}

export function renderContextMirrorReport(audit) {
  const lines = [
    '# Context mirror audit',
    '',
    'Advisory only — findings do not gate merges.',
    '',
    `Scanned ${audit.scannedFiles.length} file(s); ${audit.findings.length} finding(s).`,
    '',
  ];

  if (!audit.findings.length) {
    lines.push('No avoided vocabulary detected in user-facing string literals.');
    lines.push('');
    return lines.join('\n');
  }

  for (const finding of audit.findings) {
    lines.push(
      `- **${finding.path}:${finding.line}** — found \`${finding.matched}\` (avoid); prefer **${finding.canonical}**`,
    );
    lines.push(`  > ${finding.excerpt}`);
    lines.push('');
  }

  return lines.join('\n');
}
