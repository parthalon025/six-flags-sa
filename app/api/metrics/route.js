import { metrics, usingRedis } from '@/lib/serverStore';

export const dynamic = 'force-dynamic';

// Counters are per process. On serverless that means each instance reports its
// own slice and nothing sums them, so treat these as a sampled signal rather
// than an accounting record — the numbers are for spotting a stuck relay, not
// for billing.
const HELP = {
  parties_created: ['counter', 'Parties allocated'],
  parties_deleted: ['counter', 'Parties destroyed or expired on read'],
  party_reads: ['counter', 'Party record reads'],
  party_writes: ['counter', 'Party record writes'],
  members_evicted: ['counter', 'Members dropped for exceeding MEMBER_TTL_MS'],
  mailbox_posted: ['counter', 'Messages accepted into a mailbox'],
  mailbox_dropped: ['counter', 'Messages dropped for age or mailbox depth'],
  store_errors: ['counter', 'Store backend errors'],
  parties_resident: ['gauge', 'Parties held in this process (-1 when using Redis)'],
  mailboxes_resident: ['gauge', 'Mailboxes held in this process (-1 when using Redis)'],
  uptime_seconds: ['gauge', 'Process uptime'],
};

export function GET() {
  const values = metrics();
  const lines = [`# backend ${usingRedis ? 'upstash' : 'memory'}`];

  for (const [name, value] of Object.entries(values)) {
    const [type, help] = HELP[name] ?? ['gauge', name];
    const metric = `ki_${name}${type === 'counter' ? '_total' : ''}`;
    lines.push(`# HELP ${metric} ${help}`, `# TYPE ${metric} ${type}`, `${metric} ${value}`);
  }

  return new Response(`${lines.join('\n')}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
