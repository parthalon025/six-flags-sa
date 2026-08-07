import pkg from '@/package.json';
import { PROTOCOL_VERSION } from '@/lib/core/protocol';
import { json } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/**
 * `protocol` is the number that matters: a client whose PROTOCOL_VERSION does
 * not match cannot talk to this relay whatever the build version says.
 */
export function GET() {
  return json({ version: pkg.version, protocol: PROTOCOL_VERSION });
}
