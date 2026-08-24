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

import { register } from 'node:module';

const HOOK = new URL('./appAlias-hook.mjs', import.meta.url);

let installed = false;

export function installAppAlias() {
  if (installed) return;
  register(HOOK, import.meta.url);
  installed = true;
}
