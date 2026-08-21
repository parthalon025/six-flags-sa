/**
 * Resolve the app's `@/*` import alias for plain Node tests.
 *
 * `apps/party-tracker/jsconfig.json` maps `@/*` to the app root, and Next
 * applies it at build time. Node does not, so every module under test that
 * uses the alias — partyRuntime.js is the only one in the party stack — is
 * unimportable from a test without this. Registering the hook is test-only
 * scaffolding: it changes resolution, never behaviour.
 *
 * Also fills in the extensionless specifiers the alias is used with
 * (`@/lib/party/client`), which bundler resolution allows and Node does not.
 */

import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const APP_ROOT = new URL('../../../apps/party-tracker/', import.meta.url);

/** Candidate files for one alias specifier, in the order a bundler tries them. */
function candidates(rest) {
  return [rest, `${rest}.js`, `${rest}.mjs`, `${rest}/index.js`];
}

export function installAppAlias() {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (!specifier.startsWith('@/')) return nextResolve(specifier, context);
      const rest = specifier.slice(2);
      for (const candidate of candidates(rest)) {
        const url = new URL(candidate, APP_ROOT);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
      throw new Error(`appAlias: nothing at ${specifier}`);
    },
  });
}

export const appModule = (rest) => pathToFileURL(fileURLToPath(new URL(rest, APP_ROOT))).href;
