/**
 * Park Bound Apple Developer inventory — Identifiers vs Xcode vs Keys vs Connect.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SPEC = join(dirname(fileURLToPath(import.meta.url)), 'apple-developer.json');

export function loadAppleDeveloper(specPath = DEFAULT_SPEC) {
  return JSON.parse(readFileSync(specPath, 'utf8'));
}

export function surfaces(item) {
  return [...(item?.surfaces ?? [])];
}

export function siwaWeb(spec) {
  const web = spec.siwaWeb ?? {};
  return { domain: web.domain, returnUrl: web.returnUrl };
}

export function laterIdentifierIds(spec) {
  return spec.items
    .filter((row) => row.status === 'later' && surfaces(row).includes('identifiers'))
    .map((row) => row.id);
}

export function neverCreate(spec) {
  return spec.items.filter((row) => row.status === 'never').map((row) => row.id);
}

function plistStringsForKey(plistText, key) {
  const block = plistText.match(
    new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`),
  );
  if (!block) return [];
  return [...block[1].matchAll(/<string>([^<]*)<\/string>/g)].map((m) => m[1]);
}

function plistStringForKey(plistText, key) {
  const hit = plistText.match(
    new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`),
  );
  return hit ? hit[1] : '';
}

export function shellGaps(plistText, entitlementsText, spec) {
  const gaps = [];
  const modes = spec.items.find((row) => row.id === 'background-modes');
  if (modes?.status === 'now') {
    const have = plistStringsForKey(plistText, 'UIBackgroundModes');
    for (const key of modes.plistKeys ?? []) {
      if (!have.includes(key)) gaps.push(`missing UIBackgroundModes ${key}`);
    }
  }
  const push = spec.items.find((row) => row.id === 'push-notifications');
  if (push?.status === 'now') {
    const env = plistStringForKey(entitlementsText, 'aps-environment');
    if (env !== 'production' && env !== 'development') {
      gaps.push('missing aps-environment');
    }
  }
  const domains = spec.items.find((row) => row.id === 'associated-domains');
  if (domains?.status === 'now' && domains.applinksHost) {
    const entries = plistStringsForKey(
      entitlementsText,
      'com.apple.developer.associated-domains',
    );
    const want = `applinks:${domains.applinksHost}`;
    if (!entries.includes(want)) gaps.push(`missing ${want}`);
  }
  const appGroup = spec.items.find((row) => row.id === 'app-group');
  if (appGroup?.status === 'now' && appGroup.value) {
    const groups = plistStringsForKey(
      entitlementsText,
      'com.apple.security.application-groups',
    );
    if (!groups.includes(appGroup.value)) {
      gaps.push(`missing application-group ${appGroup.value}`);
    }
  }
  return gaps;
}
