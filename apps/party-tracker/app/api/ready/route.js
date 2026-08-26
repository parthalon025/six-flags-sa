import { ping, usingRedis } from '@/lib/serverStore';
import { pingPostgres } from '@/lib/db/postgres';
import { json } from '@/app/api/_lib/http';
import { clerkConfigStatus, clerkConfigured } from '@/lib/clerkConfigured';

export const dynamic = 'force-dynamic';

/** See app/api/mailbox/[partyId]/route.js — one hop to the store, no more. */
export const maxDuration = 10;

/**
 * Readiness: can this instance actually serve a party right now. The memory
 * backend is always ready by definition; a configured Upstash that will not
 * answer is a 503, which is what keeps a broken instance out of a load
 * balancer's rotation instead of failing every request it is handed.
 * Postgres is probed in parallel when configured (#437).
 */
export async function GET() {
  const clerk = { mandatory: true, ...clerkConfigStatus(), configured: clerkConfigured() };
  const [storeProbe, postgresProbe] = await Promise.all([ping(), pingPostgres()]);

  if (!storeProbe.ok) {
    return json(
      {
        ready: false,
        backend: storeProbe.backend,
        error: storeProbe.error,
        durable: usingRedis,
        postgres: postgresProbe,
        clerk,
      },
      503,
    );
  }
  if (!postgresProbe.ok) {
    return json(
      {
        ready: false,
        backend: postgresProbe.backend,
        error: postgresProbe.error,
        durable: usingRedis,
        postgres: postgresProbe,
        clerk,
      },
      503,
    );
  }
  return json({
    ready: true,
    backend: storeProbe.backend,
    durable: usingRedis,
    postgres: postgresProbe,
    clerk,
  });
}
