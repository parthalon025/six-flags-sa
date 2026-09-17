#!/usr/bin/env node
/**
 * CONTEXT.md mirror audit — advisory vocabulary drift detection.
 *
 *   node test/scripts/context-mirror.test.mjs
 */
import assert from 'node:assert/strict';
import {
  parseContextAvoidRules,
  findAvoidMatchesInText,
  auditContextMirror,
  renderContextMirrorReport,
} from '../../scripts/lib/context-mirror.mjs';

const SAMPLE_CONTEXT = `# Glossary

**World**:
One park-scale map a visitor explores.
_Avoid_: Venue in product talk (builder/file term only); Park is a colloquial World

**Place**:
A named thing on a **World** map.
_Avoid_: POI (file label for \`*.pois.json\` only)
`;

const rules = parseContextAvoidRules(SAMPLE_CONTEXT);
assert.ok(rules.some((r) => r.canonical === 'World' && r.forbidden.includes('Venue')));
assert.ok(rules.some((r) => r.canonical === 'Place' && r.forbidden.includes('POI')));

const drift = findAvoidMatchesInText('Pick your Venue from the list', rules);
assert.equal(drift.length, 1);
assert.equal(drift[0].forbidden, 'Venue');
assert.equal(drift[0].canonical, 'World');

const clean = findAvoidMatchesInText('Pick your World from the list', rules);
assert.equal(clean.length, 0);

const audit = auditContextMirror({
  contextMarkdown: SAMPLE_CONTEXT,
  sources: [{ path: 'apps/party-tracker/app/demo.js', content: 'const label = "Your Venue";\n' }],
});
assert.equal(audit.findings.length, 1);
assert.match(audit.findings[0].path, /demo\.js$/);
assert.equal(audit.findings[0].line, 1);

const report = renderContextMirrorReport(audit);
assert.match(report, /# Context mirror audit/);
assert.match(report, /Venue/);
assert.match(report, /World/);

console.log('context-mirror tests ok');
