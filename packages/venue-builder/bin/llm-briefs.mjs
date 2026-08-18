#!/usr/bin/env node
/**
 * LLM briefs — the agent provider's inbox. When the builder runs with
 * VENUE_LLM_PROVIDER=agent (the default inside an agent session with no API
 * key), every model prompt lands here as a brief; the invoking agent answers
 * it and reruns the stage that filed it.
 *
 *   npm run venues:llm-briefs                       # list pending briefs
 *   npm run venues:llm-briefs -- show <hash>        # full prompt to answer
 *   npm run venues:llm-briefs -- answer <hash> --file <f>   # or pipe stdin
 */

import { readFileSync } from 'node:fs';
import { pendingBriefs, answerBrief } from '../lib/venue-llm.mjs';

const argv = process.argv.slice(2);
const cmd = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'list';

if (cmd === 'list') {
  const briefs = pendingBriefs();
  if (!briefs.length) {
    console.log('No pending briefs.');
    process.exit(0);
  }
  for (const b of briefs) {
    const hint = (b.messages?.[b.messages.length - 1]?.content || '').slice(0, 100).replace(/\s+/g, ' ');
    console.log(`${b.hash.slice(0, 12)}  venue=${b.venue || '(global)'}  json=${b.expectsJson}  ${hint}…`);
  }
  console.log(`\n${briefs.length} pending. Read one: venues:llm-briefs -- show <hash>`);
} else if (cmd === 'show') {
  const briefs = pendingBriefs().filter((b) => b.hash.startsWith(argv[1] || ''));
  if (briefs.length !== 1) {
    console.error(briefs.length ? `Ambiguous (${briefs.length} matches)` : 'No pending brief matches.');
    process.exit(2);
  }
  console.log(JSON.stringify({ hash: briefs[0].hash, expectsJson: briefs[0].expectsJson, messages: briefs[0].messages }, null, 2));
} else if (cmd === 'answer') {
  const hash = argv[1];
  const fileIdx = argv.indexOf('--file');
  const content = fileIdx >= 0
    ? readFileSync(argv[fileIdx + 1], 'utf8')
    : readFileSync(0, 'utf8');
  try {
    const res = answerBrief(hash, content);
    console.log(`answered ${res.hash.slice(0, 12)} → ${res.file}`);
    console.log('Rerun the builder command that filed the brief to consume it.');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
} else {
  console.error('usage: llm-briefs.mjs [list | show <hash> | answer <hash> [--file f]]');
  process.exit(2);
}
