import pkg from '@/package.json';
import { json } from '@/app/api/_lib/http';

export const dynamic = 'force-dynamic';

/** See app/api/mailbox/[partyId]/route.js — one hop to the store, no more. */
export const maxDuration = 10;

/**
 * Liveness only — deliberately does not touch the store. Transports probe this
 * to decide whether a base URL is worth trying at all (see probeMailboxHealth),
 * so it has to answer fast and it has to answer even when Redis is down.
 * Whether the backend actually works is /api/ready's question.
 */
export function GET() {
  return json({ ok: true, uptime: Math.round(process.uptime()), version: pkg.version });
}
