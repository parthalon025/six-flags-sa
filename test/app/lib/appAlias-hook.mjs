import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP_ROOT = new URL('../../../apps/party-tracker/', import.meta.url);

function candidates(rest) {
  return [rest, `${rest}.js`, `${rest}.mjs`, `${rest}/index.js`];
}

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
  const rest = specifier.slice(2);
  for (const candidate of candidates(rest)) {
    const url = new URL(candidate, APP_ROOT);
    if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
  }
  throw new Error(`appAlias: nothing at ${specifier}`);
}
