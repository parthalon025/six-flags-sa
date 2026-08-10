import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pkg from '@/package.json';
import { PROTOCOL_VERSION } from '@/lib/core/protocol';
import { json } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/** See app/api/mailbox/[partyId]/route.js — one hop to the store, no more. */
export const maxDuration = 10;

/** Written on prebuild by scripts/inject-version.mjs — one stamp per deploy. */
function readBuildStamp() {
  try {
    const doc = JSON.parse(readFileSync(join(process.cwd(), 'public/app-version.json'), 'utf8'));
    return {
      version: typeof doc.version === 'string' ? doc.version : pkg.version,
      built: typeof doc.built === 'string' ? doc.built : null,
    };
  } catch {
    return { version: pkg.version, built: null };
  }
}

/**
 * `protocol` is the number that matters: a client whose PROTOCOL_VERSION does
 * not match cannot talk to this relay whatever the build version says.
 */
export function GET() {
  const stamp = readBuildStamp();
  return json({ version: stamp.version, protocol: PROTOCOL_VERSION, built: stamp.built });
}
