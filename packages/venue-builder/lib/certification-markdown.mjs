/**
 * Markdown renderer for certification.json documents — shared by CLI and inspect UI.
 */

/**
 * @param {import('./factory-types.mjs').CertificationDoc} doc
 */
export function renderCertificationMarkdown(doc) {
  const lines = [
    `# Certification — ${doc.venue.name}`,
    '',
    doc.certified ? '**Certified**' : '**Not certified**',
    '',
    '| Check | Pass | Evidence | Confidence |',
    '| --- | :-: | --- | --- |',
  ];
  for (const c of doc.checks) {
    lines.push(`| ${c.key} | ${c.pass ? '✅' : '❌'} | ${c.evidence.detail} | ${c.confidence} |`);
  }
  if (doc.ask?.blocking) {
    lines.push('', '## Blocking requests', '');
    for (const r of doc.ask.requests.filter((x) => x.blocking)) {
      lines.push(`- **${r.need}**: ${r.why}`);
    }
  }
  return lines.join('\n');
}
